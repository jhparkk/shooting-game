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
  return [cvA, cvB];
}

/* =========================================================
   모래 — 잔물결 + 조개 부스러기
   ========================================================= */
function bakeSand(size) {
  return bakePair(size, (u, v, o) => {
    const warp = fbm(u, v, 3, 3, 11);
    const warp2 = fbm(u, v, 6, 2, 47);
    // 물결: u 축으로 흐르고 v 축으로 천천히 흔들린다
    const rip = Math.sin((v * 7 + u * 1.2 + warp * 2.6 + warp2 * 1.1) * TAU);
    const rip2 = Math.sin((v * 19 + warp2 * 2.2 + warp * 1.4) * TAU);
    const grain = noise2(u * 256, v * 256, 256, 3);
    const shell = fbm(u, v, 24, 2, 71);

    // 밝기: 물결 마루 + 미세 모래알
    const shade = 0.80
      + rip * 0.10
      + rip2 * 0.04
      + (grain - 0.5) * 0.16
      + (shell - 0.5) * 0.16;

    const r = clamp01(shade * 0.97 + 0.02);
    const g = clamp01(shade * 0.96 + 0.02);
    const b = clamp01(shade * 0.92 + 0.02);
    o[0] = (r * 255) | 0;
    o[1] = (g * 255) | 0;
    o[2] = (b * 255) | 0;
    o[3] = clamp01(0.52 + rip * 0.3 + (grain - 0.5) * 0.3) * 255;
  });
}

/* =========================================================
   암벽 — 지층 줄무늬 + 균열
   ========================================================= */
function bakeRock(size) {
  return bakePair(size, (u, v, o) => {
    // 지층: v 를 눌러 가로 띠를 만들고, u 로 흔들어 자연스럽게
    const strata = fbm(u * 0.6, v * 7.5, 6, 4, 21);
    const lump = fbm(u, v, 4, 4, 89);
    const fine = noise2(u * 200, v * 200, 200, 5);
    // 능선 패턴으로 균열선
    const ridge = 1 - Math.abs(fbm(u * 1.4, v * 1.4, 5, 3, 133) * 2 - 1);
    const crack = smooth(0.90, 0.995, ridge + fine * 0.03);

    let shade = 0.46 + (strata - 0.5) * 0.34 + (lump - 0.5) * 0.26 + (fine - 0.5) * 0.10;
    shade *= 1 - crack * 0.55;
    // 이끼·규조가 붙은 듯한 녹회색
    const moss = smooth(0.55, 0.9, fbm(u, v, 5, 3, 201)) * 0.28;
    o[0] = clamp01(shade * 0.94 - moss * 0.14) * 255;
    o[1] = clamp01(shade * 1.00 + moss * 0.10) * 255;
    o[2] = clamp01(shade * 0.88 - moss * 0.06) * 245;
    o[3] = clamp01(0.55 + (strata - 0.5) * 0.7 + (fine - 0.5) * 0.2 - crack * 0.4) * 255;
  });
}

/* =========================================================
   심해 현무암 — 주상 절리 균열
   ========================================================= */
function bakeBasalt(size) {
  return bakePair(size, (u, v, o) => {
    const w = worley(u, v, 7, 313);
    const edge = smooth(0.02, 0.13, w.f2 - w.f1);          // 셀 경계 = 균열
    const lump = fbm(u, v, 8, 3, 401);
    const fine = noise2(u * 220, v * 220, 220, 7);
    let shade = 0.20 + (lump - 0.5) * 0.16 + (fine - 0.5) * 0.06;
    shade *= 0.55 + edge * 0.45;
    o[0] = clamp01(shade * 0.94) * 255;
    o[1] = clamp01(shade * 0.97) * 255;
    o[2] = clamp01(shade * 1.22 + 0.02) * 255;
    o[3] = clamp01(0.45 + edge * 0.5 + (fine - 0.5) * 0.15) * 255;
  });
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
      // 두 겹의 셀 경계를 겹쳐 물결처럼 흔든다 — 가는 선만 남긴다
      const a = worley(u, v, 5, 91);
      const b = worley(u + 0.31, v + 0.17, 8, 457);
      const ea = 1 - smooth(0.0, 0.058, a.f2 - a.f1);
      const eb = 1 - smooth(0.0, 0.044, b.f2 - b.f1);
      let c = Math.pow(ea * 0.82 + eb * 0.58, 1.35) * 1.3;
      // 큰 덩어리로 나타났다 사라지는 패치 (진짜 수중 빛무늬처럼)
      const patch = fbm(u, v, 3, 3, 1301);
      c *= 0.30 + 0.95 * smooth(0.25, 0.75, patch);
      c = clamp01(c);
      const i = (y * size + x) * 4;
      D[i] = (c * 255) | 0;
      D[i + 1] = (c * 255) | 0;
      D[i + 2] = (c * 255) | 0;
      D[i + 3] = 255;
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
    const cell = worley(u, v, 11, 613);
    const pore = 1 - smooth(0.0, 0.26, cell.f1);          // 작은 구멍
    const lump = fbm(u, v, 9, 3, 777);
    let shade = 0.86 + (lump - 0.5) * 0.22;
    shade *= 1 - pore * 0.42;
    o[0] = clamp01(shade) * 255;
    o[1] = clamp01(shade * 0.99) * 255;
    o[2] = clamp01(shade * 0.96) * 255;
    o[3] = clamp01(0.6 + (lump - 0.5) * 0.5 - pore * 0.5) * 255;
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
  const [rockCv, rockH] = bakeRock(256);
  const [basCv, basH] = bakeBasalt(256);
  const [coralCv, coralH] = bakeCoral(128);
  const [metalCv, metalH] = bakeMetal(256);
  const [orgCv, orgH] = bakeOrganic(128);
  const causticCv = bakeCaustics(256);

  SET = {
    /* 해저 지형 */
    sand: toTexture(sandCv, { srgb: true, aniso: 8 }),
    sandBump: toTexture(bakeScaled(sandH, 128), { aniso: 4 }),
    rock: toTexture(rockCv, { srgb: true, aniso: 8 }),
    rockBump: toTexture(bakeScaled(rockH, 128), { aniso: 4 }),
    basalt: toTexture(basCv, { srgb: true, aniso: 8 }),
    basaltBump: toTexture(bakeScaled(basH, 128), { aniso: 4 }),
    caustics: toTexture(causticCv, { aniso: 4 }),
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

/** 만든 캔버스를 더 작은 해상도로 다시 굽는다 (bump 용) */
function bakeScaled(cv, size) {
  const out = canvasOf(size);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cv, 0, 0, size, size);
  return out;
}
