/* =========================================================
   ABYSS DIVER — 절차적 텍스처 공장
   · 외부 이미지 파일 없이 CanvasTexture 를 코드로 그린다
   · 전부 이음새 없이 반복(tileable)되도록 주기 노이즈만 사용
   · 아이폰 WebGL 을 위해 256px(diffuse) / 128px(bump) 로 가볍게 유지
   · 한 번만 만들어 게임 전체가 공유한다 (캐시)
   ========================================================= */
import * as THREE from 'three';

const TAU = Math.PI * 2;

/* ---------------- 주기 값 노이즈 ---------------- */
function hashu(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** period 격자에서 이어지는 2D 값 노이즈 (0..1) */
function noise2(x, y, period, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const p = period | 0;
  const xa = ((x0 % p) + p) % p;
  const ya = ((y0 % p) + p) % p;
  const xb = (xa + 1) % p;
  const yb = (ya + 1) % p;
  const a = hashu(xa, ya, seed);
  const b = hashu(xb, ya, seed);
  const c = hashu(xa, yb, seed);
  const d = hashu(xb, yb, seed);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

/** 여러 옥타브 합성 — u,v 는 0..1, 결과도 이음새 없음 */
function fbm(u, v, base, oct, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = base;
  for (let i = 0; i < oct; i++) {
    sum += noise2(u * f, v * f, f, seed + i * 137) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** 이음새 없는 워리(Worley) 노이즈 — f1, f2 (셀 단위 거리) */
function worley(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const px = cx + hashu(wx, wy, seed);
      const py = cy + hashu(wx, wy, seed + 917);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2 };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/* ---------------- 캔버스 유틸 ---------------- */
function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function toTexture(cv, opts) {
  const o = opts || {};
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = o.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = o.aniso || 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  return t;
}

/** 픽셀 루프를 돌며 diffuse + height 두 장을 한 번에 만든다 */
function bakePair(size, fn) {
  const cvA = canvasOf(size);
  const cvB = canvasOf(size);
  const ctxA = cvA.getContext('2d');
  const ctxB = cvB.getContext('2d');
  const imgA = ctxA.createImageData(size, size);
  const imgB = ctxB.createImageData(size, size);
  const A = imgA.data;
  const B = imgB.data;
  const out = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      fn(x / size, v, out);
      A[i] = out[0];
      A[i + 1] = out[1];
      A[i + 2] = out[2];
      A[i + 3] = 255;
      const h = out[3];
      B[i] = h;
      B[i + 1] = h;
      B[i + 2] = h;
      B[i + 3] = 255;
    }
  }
  ctxA.putImageData(imgA, 0, 0);
  ctxB.putImageData(imgB, 0, 0);
  // 평균 밝기를 0.80 근처로 정규화 — 깊은 바다의 어두운 현무암 텍스처가
  // 지형을 "까맣게" 만들지 않도록, 대비는 남기고 밝기만 맞춘다.
  normalize(imgA, A, 0.78, 3.0);
  ctxA.putImageData(imgA, 0, 0);
  return [cvA, cvB];
}

/** 캔버스 픽셀의 평균 밝기를 target 에 맞춘다 (완전히 평탄해지지 않게 k 상한) */
function normalize(img, data, target, maxK) {
  let sum = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) sum += data[i];
  const mean = sum / n / 255;
  if (mean < 0.02) return;
  // 대비를 너무 깎지 않는다 — 밝은 모래 텍스처가 '민무늬 회색'이 되던 원인
  // 평균만 0.80 으로 맞추고, 대비는 오히려 키운다 — 정규화가 대비를 깎아
  // 모든 바닥 텍스처가 '민무늬 회색'이 되던 문제를 없앤다
  const k = Math.min(maxK, Math.max(1.35, (0.55 / mean) * 1.8));
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = target + (data[i + c] / 255 - mean) * k;
      data[i + c] = v < 0 ? 0 : v > 1 ? 255 : (v * 255) | 0;
    }
  }
}

/* =========================================================
   모래 — 잔물결 + 조개 부스러기
   ========================================================= */
function bakeSand(size) {
  return bakePair(size, (u, v, o) => {
    /* 진짜 모래밭처럼 — 큰 얼룩은 줄이고, 알갱이·조개 부스러기·잔자갈의
       작고 또렷한 점이 바닥을 채우게 한다. (큰 얼룩이 많으면 멀리서
       '나뭇결' 같은 얼룩으로 뭉개진다) */
    const blotch = fbm(u, v, 2, 3, 131);          // 아주 옅은 젖은/마른 패치
    const patch = fbm(u, v, 7, 3, 733);           // 중간 얼룩
    const warp = fbm(u, v, 4, 2, 127);            // 잔물결을 휘게 하는 노이즈
    const fine = noise2(u * 64, v * 64, 64, 3);   // 모래알 덩어리
    const grain = noise2(u * 190, v * 190, 190, 9); // 낟알
    const chip = worley(u, v, 24, 971);           // 잔자갈 · 조개 부스러기
    const chipK = 1 - smooth(0.0, 0.14, chip.f1);
    const shell = worley(u, v, 8, 313);           // 큰 조개 조각
    const shellK = 1 - smooth(0.0, 0.09, shell.f1);
    /* 잔물결 — 서로 다른 두 방향의 파를 겹쳐 한쪽으로 빗질한 줄무늬가 생기지 않게 */
    const ripA = Math.sin((v * 7 + u * 1.4 + warp * 3.0) * TAU);
    const ripB = Math.sin((u * 11 - v * 2.0 + warp * 2.4) * TAU);

    let shade = 0.88
      + (blotch - 0.5) * 0.05
      + (patch - 0.5) * 0.10
      + (fine - 0.5) * 0.19
      + (grain - 0.5) * 0.15
      + ripA * 0.022 + ripB * 0.016;
    shade *= 1 - chipK * 0.20 - shellK * 0.14;
    // 조개 부스러기는 살짝 더 하얗고, 잔자갈은 살짝 어둡다
    shade += shellK * 0.06;

    o[0] = clamp01(shade * 1.0) * 255;
    o[1] = clamp01(shade * 0.972) * 255;
    o[2] = clamp01(shade * 0.915) * 255;
    o[3] = clamp01(0.5 + (fine - 0.5) * 0.30 + (grain - 0.5) * 0.30
      + ripA * 0.14 + ripB * 0.10 - chipK * 0.34 - shellK * 0.22) * 255;
  });
}

/* =========================================================
   암벽 — 지층 줄무늬 + 균열
   ========================================================= */
function bakeRock(size) {
  return bakePair(size, (u, v, o) => {
    /* 암반: 얕은 지층 띠 + 입자 결. 균열은 아주 드물고 옅게 —
       예전엔 균열 '그물'이 바닥까지 덮여 만화처럼 보였다. */
    const strata = fbm(u * 0.6, v * 6.0, 6, 4, 21);
    const lump = fbm(u, v, 3, 4, 89);
    const fine = noise2(u * 110, v * 110, 110, 5);
    const grain = noise2(u * 22, v * 22, 22, 313);
    const ridge = 1 - Math.abs(fbm(u * 1.1, v * 1.1, 4, 3, 133) * 2 - 1);
    const crackMask = smooth(0.86, 1.0, fbm(u, v, 2, 2, 777));
    const crack = smooth(0.97, 1.0, ridge) * crackMask;

    let shade = 0.50
      + (strata - 0.5) * 0.20
      + (lump - 0.5) * 0.20
      + (grain - 0.5) * 0.10
      + (fine - 0.5) * 0.09;
    shade *= 1 - crack * 0.12;
    // 이끼·규조가 붙은 듯한 아주 옅은 청록기
    const moss = smooth(0.58, 0.92, fbm(u, v, 5, 3, 201)) * 0.22;
    o[0] = clamp01(shade * 0.98 - moss * 0.05) * 255;
    o[1] = clamp01(shade * 0.99 + moss * 0.02) * 255;
    o[2] = clamp01(shade * 0.95 - moss * 0.01) * 255;
    o[3] = clamp01(0.54 + (strata - 0.5) * 0.44 + (grain - 0.5) * 0.3 + (fine - 0.5) * 0.22 - crack * 0.35) * 255;
  });
}

/* =========================================================
   밝은 산호 모래 — 하얀 모래알 + 분홍·주황 산호 부스러기
   (참고 이미지의 맑은 산호초 지대 바닥)
   ========================================================= */
function bakeCoralSand(size) {
  return bakePair(size, (u, v, o) => {
    const warp = fbm(u, v, 4, 3, 1213);
    const rip = Math.sin((v * 14 + u * 2.4 + warp * 2.6) * TAU);
    const rip2 = Math.sin((v * 31 - u * 3.1 + warp * 3.2) * TAU);
    const grain = noise2(u * 260, v * 260, 260, 1201);
    // 산호 부스러기 — 작은 조각이 흩어져 있다
    const bits = worley(u, v, 34, 1217);
    const piece = 1 - smooth(0.0, 0.24, bits.f1);
    const warm = fbm(u, v, 11, 2, 1223);
    let shade = 0.90 + rip * 0.018 + rip2 * 0.012 + (grain - 0.5) * 0.08;
    shade *= 1 - piece * 0.09;
    const pink = smooth(0.66, 0.94, warm) * piece;
    o[0] = clamp01(shade * 1.0 + pink * 0.05) * 255;
    o[1] = clamp01(shade * 0.985 - pink * 0.02) * 255;
    o[2] = clamp01(shade * 0.955) * 255;
    o[3] = clamp01(0.5 + rip * 0.22 + (grain - 0.5) * 0.24 - piece * 0.18) * 255;
  });
}

/* =========================================================
   산호석 · 석회암 암초 — 다공질에 분홍·주황·보랏빛이 흩어진 암초
   ========================================================= */
function bakeReef(size) {
  return bakePair(size, (u, v, o) => {
    const cell = worley(u, v, 15, 1311);
    const pore = 1 - smooth(0.0, 0.3, cell.f1);       // 산호 구멍
    const cell2 = worley(u, v, 6, 1319);
    const lump = fbm(u, v, 6, 4, 1321);
    const fine = noise2(u * 210, v * 210, 210, 1327);
    let shade = 0.82 + (lump - 0.5) * 0.26 + (fine - 0.5) * 0.1;
    shade *= 1 - pore * 0.15;   // 구멍 대비를 낮춰 먼 거리에서 그물 무늬로 보이지 않게
    shade *= 0.86 + smooth(0.03, 0.2, cell2.f2 - cell2.f1) * 0.2;
    // 색 — 아주 옅은 분홍·주황·회보라가 패치로 (바다 속에서는 대부분 회갈색)
    const pick = fbm(u, v, 9, 3, 1333);
    const pink = smooth(0.60, 0.86, pick) * 0.55;
    const orange = smooth(0.44, 0.28, pick) * 0.4;
    const violet = smooth(0.88, 0.99, pick) * 0.35;
    o[0] = clamp01(shade * 1.0 + pink * 0.09 + orange * 0.11 + violet * 0.03) * 255;
    o[1] = clamp01(shade * 0.97 + pink * 0.02 + orange * 0.06 - violet * 0.02) * 255;
    o[2] = clamp01(shade * 0.95 + pink * 0.05 - orange * 0.04 + violet * 0.09) * 255;
    o[3] = clamp01(0.58 + (lump - 0.5) * 0.44 - pore * 0.36 + (fine - 0.5) * 0.18) * 255;
  });
}

/* =========================================================
   자갈 · 조약돌 지대 — 둥근 돌이 촘촘히 깔린 바닥
   (굵은 자갈·조약돌이 모래 사이로 드러난 얕은 바닥)
   ========================================================= */
function bakePebble(size) {
  return bakePair(size, (u, v, o) => {
    const w = worley(u, v, 11, 3413);            // 큰 조약돌
    const w2 = worley(u, v, 27, 3419);           // 잔자갈
    const dome = 1 - smooth(0.0, 0.80, w.f1);    // 돌의 둥근 윗면
    const gap = smooth(0.52, 1.0, w.f2 - w.f1);  // 돌 사이 틈(그늘)
    const dome2 = 1 - smooth(0.0, 0.72, w2.f1);
    const grain = noise2(u * 170, v * 170, 170, 3427);
    const tone = fbm(u, v, 6, 3, 3433);          // 돌마다 다른 색
    let shade = 0.80 + (tone - 0.5) * 0.30 + (grain - 0.5) * 0.10
      + dome * 0.13 + dome2 * 0.05;
    shade *= 1 - gap * 0.40;
    // 자갈 색 — 회청 · 베이지 · 옅은 분홍이 섞인다
    const warm = smooth(0.52, 0.86, tone);
    const cool = smooth(0.46, 0.18, tone);
    o[0] = clamp01(shade * 1.0 + warm * 0.05) * 255;
    o[1] = clamp01(shade * 0.975 + warm * 0.01 - cool * 0.01) * 255;
    o[2] = clamp01(shade * 0.935 - warm * 0.03 + cool * 0.06) * 255;
    o[3] = clamp01(0.46 + dome * 0.34 + dome2 * 0.10 - gap * 0.34) * 255;
  });
}

/* =========================================================
   밝은 석회암 — 수평으로 이어지는 얕은 층리와 마모된 면
   ========================================================= */
function bakeLimestone(size) {
  return bakePair(size, (u, v, o) => {
    const warp = fbm(u, v, 3, 3, 3503) * 0.9;
    const layer = Math.sin((v * 5.0 + warp) * TAU);        // 수평 층리
    const strata = fbm(u * 0.7, v * 4.2, 6, 3, 3509);
    const lump = fbm(u, v, 5, 4, 3511);                    // 넓은 마모
    const fine = noise2(u * 150, v * 150, 150, 3517);
    const pit = worley(u, v, 19, 3523);
    const hole = 1 - smooth(0.0, 0.18, pit.f1);             // 드문 작은 구멍
    let shade = 0.90 + layer * 0.035 + (strata - 0.5) * 0.14
      + (lump - 0.5) * 0.12 + (fine - 0.5) * 0.07;
    shade *= 1 - hole * 0.10;
    o[0] = clamp01(shade * 1.0) * 255;
    o[1] = clamp01(shade * 0.985) * 255;
    o[2] = clamp01(shade * 0.94) * 255;
    o[3] = clamp01(0.54 + layer * 0.12 + (lump - 0.5) * 0.26
      + (fine - 0.5) * 0.18 - hole * 0.2) * 255;
  });
}

/* =========================================================
   이끼 · 해조류가 낀 암반 — 녹청색 조류가 흐르는 바위
   ========================================================= */
function bakeAlgaeRock(size) {
  return bakePair(size, (u, v, o) => {
    const strata = fbm(u * 0.7, v * 5.5, 6, 4, 1409);
    const lump = fbm(u, v, 5, 4, 1411);
    const fine = noise2(u * 190, v * 190, 190, 1417);
    // 위로 자라 오르는 해조류 결
    const weed = smooth(0.5, 0.86, fbm(u * 1.3, v * 0.55, 7, 3, 1423));
    const fuzzy = smooth(0.55, 0.95, fbm(u, v, 26, 2, 1429));
    let shade = 0.5 + (strata - 0.5) * 0.3 + (lump - 0.5) * 0.26 + (fine - 0.5) * 0.1;
    const green = weed * (0.18 + fuzzy * 0.18);
    o[0] = clamp01(shade * 0.95 - green * 0.12) * 255;
    o[1] = clamp01(shade * 1.0 + green * 0.2) * 255;
    o[2] = clamp01(shade * 0.92 - green * 0.02) * 255;
    o[3] = clamp01(0.52 + (strata - 0.5) * 0.6 + (fine - 0.5) * 0.22 + green * 0.2) * 255;
  });
}

/* =========================================================
   심해 현무암 — 주상 절리 균열
   ========================================================= */
function bakeBasalt(size) {
  return bakePair(size, (u, v, o) => {
    /* 현무암 — 주상 절리 '그물'을 없애고, 옅은 세로 결 + 입자만 남긴다 */
    const w = worley(u, v, 5, 313);
    const edge = smooth(0.0, 0.42, w.f2 - w.f1);
    const lump = fbm(u, v, 7, 3, 401);
    const fine = noise2(u * 110, v * 110, 110, 7);
    const grain = noise2(u * 24, v * 24, 24, 719);
    let shade = 0.30 + (lump - 0.5) * 0.12 + (grain - 0.5) * 0.10 + (fine - 0.5) * 0.06;
    shade *= 0.84 + edge * 0.16;
    o[0] = clamp01(shade * 0.95) * 255;
    o[1] = clamp01(shade * 0.97) * 255;
    o[2] = clamp01(shade * 1.08) * 255;
    o[3] = clamp01(0.5 + edge * 0.28 + (grain - 0.5) * 0.3 + (fine - 0.5) * 0.16) * 255;
  });
}

/* =========================================================
   매크로 노이즈 — 물결·균열 없는 저주파 3채널(UV 워프·밝기 변화용)
   텍스처 타일 반복을 지우는 데 쓴다.
   ========================================================= */
function bakeMacro(size) {
  const cv = canvasOf(size);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const D = img.data;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = (y * size + x) * 4;
      D[i] = clamp01(fbm(u, v, 3, 4, 9001)) * 255;
      D[i + 1] = clamp01(fbm(u, v, 3, 4, 17551)) * 255;
      D[i + 2] = clamp01(fbm(u, v, 5, 3, 26107)) * 255;
      D[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/* =========================================================
   수중 빛무늬(Caustics) — 워리 셀 경계가 만드는 그물
   ========================================================= */
function bakeCaustics(size) {
  const cv = canvasOf(size);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const D = img.data;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // 셀 경계를 휘게 만들어 곧은 선 대신 물결 모양으로
      const wu = u + (fbm(u, v, 3, 2, 7) - 0.5) * 0.26;
      const wv = v + (fbm(u, v, 3, 2, 23) - 0.5) * 0.26;
      /* 세포 '경계선'이 아니라 세포 '안쪽'이 밝은 부드러운 빛 덩어리.
         실제 수면 렌즈가 모래에 맺히는 무늬는 얇은 선이 아니라 넓은 빛무리다. */
      const a = worley(wu, wv, 4, 91);
      const b = worley(wu + 0.37, wv + 0.21, 7, 457);
      const ca = Math.pow(1 - smooth(0.0, 0.85, a.f1), 2.1);
      const cb = Math.pow(1 - smooth(0.0, 0.62, b.f1), 2.6);
      let c = ca * 0.85 + cb * 0.5;
      // 큰 덩어리로 나타났다 사라지는 패치 (진짜 수중 빛무늬처럼)
      const patch = fbm(u, v, 3, 3, 1301);
      c *= 0.22 + 1.05 * smooth(0.22, 0.78, patch);
      c = clamp01(c);
      const i = (y * size + x) * 4;
      D[i] = (c * 255) | 0;
      D[i + 1] = (c * 255) | 0;
      D[i + 2] = (c * 255) | 0;
      D[i + 3] = 255;
    }
  }
  /* 부드럽게 두 번 흐리게 — 세포 경계의 얇은 선이 모래에 '금 간' 무늬로 보이지 않게 */
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Uint8ClampedArray(D);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = (x + dx + size) % size;
            const yy = (y + dy + size) % size;
            sum += tmp[(yy * size + xx) * 4];
          }
        }
        const v = sum / 25;
        const i = (y * size + x) * 4;
        D[i] = v; D[i + 1] = v; D[i + 2] = v;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/* =========================================================
   산호 · 바위 표면의 다공질 결
   ========================================================= */
function bakeCoral(size) {
  return bakePair(size, (u, v, o) => {
    const cell = worley(u, v, 13, 613);
    const pore = 1 - smooth(0.0, 0.22, cell.f1);          // 작은 구멍
    const lump = fbm(u, v, 9, 3, 777);
    let shade = 0.88 + (lump - 0.5) * 0.18;
    shade *= 1 - pore * 0.22;   // 구멍 대비를 낮춰 '물방울 무늬'처럼 보이지 않게
    o[0] = clamp01(shade) * 255;
    o[1] = clamp01(shade * 0.99) * 255;
    o[2] = clamp01(shade * 0.96) * 255;
    o[3] = clamp01(0.6 + (lump - 0.5) * 0.5 - pore * 0.3) * 255;
  });
}

/* =========================================================
   잠수정 금속 패널 — 이음선 · 리벳 · 스크래치
   ========================================================= */
function bakeMetal(size) {
  return bakePair(size, (u, v, o) => {
    // 패널 이음선 (4x3 격자)
    const gx = Math.abs(((u * 4) % 1) - 0.5);
    const gy = Math.abs(((v * 3) % 1) - 0.5);
    const seam = Math.max(smooth(0.47, 0.5, gx), smooth(0.47, 0.5, gy));
    // 리벳: 이음선을 따라 규칙적으로
    const rx = ((u * 4) % 1) - 0.5;
    const ry = ((v * 3) % 1) - 0.5;
    const near = Math.min(Math.abs(rx), Math.abs(ry));
    const along = Math.abs(rx) < Math.abs(ry) ? ((v * 3 * 12) % 1) : ((u * 4 * 12) % 1);
    const rivet = near < 0.05 && Math.abs(along - 0.5) < 0.09 ? 1 : 0;
    const scratch = smooth(0.62, 0.9, fbm(u * 0.7, v * 3.2, 4, 3, 811));
    const fine = noise2(u * 180, v * 180, 180, 17);

    let shade = 0.62 + (fine - 0.5) * 0.07 + scratch * 0.10;
    shade *= 1 - seam * 0.45;
    shade += rivet * 0.28;
    o[0] = clamp01(shade * 0.98) * 255;
    o[1] = clamp01(shade * 1.0) * 255;
    o[2] = clamp01(shade * 1.04) * 255;
    o[3] = clamp01(0.45 + rivet * 0.45 + scratch * 0.2 - seam * 0.4) * 255;
  });
}

/* =========================================================
   생물 피부 — 미세 얼룩 + 잔주름
   ========================================================= */
function bakeOrganic(size) {
  return bakePair(size, (u, v, o) => {
    const blotch = fbm(u, v, 7, 4, 991);
    const cell = worley(u, v, 16, 1009);
    const scale = 1 - smooth(0.0, 0.34, cell.f1);
    const streak = Math.sin((v * 9 + fbm(u, v, 4, 2, 55) * 3) * TAU) * 0.5 + 0.5;
    let shade = 0.90 + (blotch - 0.5) * 0.26;
    shade *= 1 - scale * 0.12;
    shade += (streak - 0.5) * 0.05;
    o[0] = clamp01(shade) * 255;
    o[1] = clamp01(shade * 0.995) * 255;
    o[2] = clamp01(shade * 0.99) * 255;
    o[3] = clamp01(0.5 + (blotch - 0.5) * 0.8 - scale * 0.35) * 255;
  });
}

/* =========================================================
   공개 API — 한 번만 만들어 재사용
   ========================================================= */
let SET = null;

export function getTextures() {
  if (SET) return SET;
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;

  const [sandCv, sandH] = bakeSand(256);
  const [cSandCv, cSandH] = bakeCoralSand(256);
  const [reefCv, reefH] = bakeReef(256);
  const [algaeCv, algaeH] = bakeAlgaeRock(256);
  const [rockCv, rockH] = bakeRock(256);
  const [basCv, basH] = bakeBasalt(256);
  const [pebCv, pebH] = bakePebble(256);
  const [limCv, limH] = bakeLimestone(256);
  const [coralCv, coralH] = bakeCoral(128);
  const [metalCv, metalH] = bakeMetal(256);
  const [orgCv, orgH] = bakeOrganic(128);
  const causticCv = bakeCaustics(256);
  const macroCv = bakeMacro(256);

  SET = {
    /* 해저 지형 */
    sand: toTexture(sandCv, { srgb: true, aniso: 2 }),
    sandBump: toTexture(bakeScaled(sandH, 128), { aniso: 4 }),
    coralSand: toTexture(cSandCv, { srgb: true, aniso: 2 }),
    coralSandBump: toTexture(bakeScaled(cSandH, 128), { aniso: 4 }),
    reef: toTexture(reefCv, { srgb: true, aniso: 8 }),
    reefBump: toTexture(bakeScaled(reefH, 128), { aniso: 4 }),
    algae: toTexture(algaeCv, { srgb: true, aniso: 8 }),
    algaeBump: toTexture(bakeScaled(algaeH, 128), { aniso: 4 }),
    rock: toTexture(rockCv, { srgb: true, aniso: 2 }),
    rockBump: toTexture(bakeScaled(rockH, 128), { aniso: 4 }),
    basalt: toTexture(basCv, { srgb: true, aniso: 2 }),
    basaltBump: toTexture(bakeScaled(basH, 128), { aniso: 4 }),
    pebble: toTexture(pebCv, { srgb: true, aniso: 2 }),
    pebbleBump: toTexture(bakeScaled(pebH, 128), { aniso: 4 }),
    limestone: toTexture(limCv, { srgb: true, aniso: 2 }),
    limestoneBump: toTexture(bakeScaled(limH, 128), { aniso: 4 }),
    caustics: toTexture(causticCv, { aniso: 4 }),
    macro: toTexture(macroCv, { aniso: 4 }),
    /* 노멀맵 — 높이맵에서 한 번만 굽는다 (프래그먼트 미분 범프는
       원거리에서 빗질한 줄무늬를 만들어 실사감을 망쳤다) */
    sandNormal: toTexture(heightToNormal(bakeScaled(sandH, 128), 1.0), { aniso: 2 }),
    rockNormal: toTexture(heightToNormal(bakeScaled(rockH, 128), 1.1), { aniso: 2 }),
    basaltNormal: toTexture(heightToNormal(bakeScaled(basH, 128), 0.9), { aniso: 2 }),
    pebbleNormal: toTexture(heightToNormal(bakeScaled(pebH, 128), 1.9), { aniso: 2 }),
    limestoneNormal: toTexture(heightToNormal(bakeScaled(limH, 128), 1.0), { aniso: 2 }),
    coralSandNormal: toTexture(heightToNormal(bakeScaled(cSandH, 128), 1.5), { aniso: 2 }),
    /* 산호 · 암초 */
    coral: toTexture(coralCv, { srgb: true }),
    coralBump: toTexture(bakeScaled(coralH, 128)),
    /* 잠수정 */
    metal: toTexture(metalCv, { srgb: true, aniso: 8 }),
    metalBump: toTexture(bakeScaled(metalH, 128)),
    /* 생물 피부 */
    skin: toTexture(orgCv, { srgb: true }),
    skinBump: toTexture(bakeScaled(orgH, 128)),
    ms: Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0),
  };
  return SET;
}

/** 높이(height) 캔버스 → 탄젠트 공간 노멀맵 (타일 이음새 유지) */
function heightToNormal(cv, strength) {
  const size = cv.width;
  const src = cv.getContext('2d').getImageData(0, 0, size, size).data;
  const out = canvasOf(size);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(size, size);
  const D = img.data;
  const H = (x, y) => src[((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nx = -dx;
      const ny = -dy;
      const l = Math.hypot(nx, ny, 1) || 1;
      const i = (y * size + x) * 4;
      D[i] = ((nx / l) * 0.5 + 0.5) * 255;
      D[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      D[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      D[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** 만든 캔버스를 더 작은 해상도로 다시 굽는다 (bump 용) */
function bakeScaled(cv, size) {
  const out = canvasOf(size);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cv, 0, 0, size, size);
  return out;
}
