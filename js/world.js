/* =========================================================
   ABYSS DIVER — 무한히 이어지는 바다
   · 고정 아레나·외곽 벽 없이 (x, z) 어디서나 이어지는 절차적 해저
   · 플레이어를 중심으로 청크(3D 타일)를 실시간 생성·재활용하는 스트리밍
   · 멀어진 청크는 geometry 를 dispose 하고 재사용 풀로 돌려 메모리를 유지
   ========================================================= */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  makeHumpbackWhale, makeBlueWhale, makeOrca, makeSpermWhale,
  makeMantaRay, makeEagleRay, makeStingray, makeTurtle,
  makeFishSchool, glowTexture, setSwimRate,
  rockGeometry, branchCoralGeometry, blobCoralGeometry, tubeCoralGeometry,
  fanCoralGeometry, brainCoralGeometry, tuftCoralGeometry,
  kelpGeometry, paint, mulberry,
} from './models.js?v=20261116p';
import { getTextures } from './textures.js?v=20261117a';
import { Atmosphere } from './atmosphere.js?v=20261117a';

/* 텍스처 좌표 — 월드 1유닛당 uv. 한 장이 약 16유닛을 덮는다 */
const UV_WORLD = 0.0625;

export const SURFACE_Y = 34;
export const FLOOR_Y = -50;      // 얕은 해구 바닥 (수심 약 113m)
export const BANK_Y = 21;        // 산호 언덕 봉우리 (수심 약 18m)
export const SHELF_Y = 9;        // 산호 지대 평지 (수심 약 34m)
export const CANYON_FLOOR = -215; // 중층 해저 협곡 바닥 (수심 약 336m)
export const TRENCH_FLOOR = -470; // 심해 해구 대지 (수심 약 680m)
export const ABYSS_FLOOR = -950;  // 초심해 심연 바닥 (수심 약 1,330m)
export const HADAL_FLOOR = -1985; // 극심해 해구 바닥 (수심 약 2,730m · 마리아나 해구급)

/** 수심(m) 환산 계수 — 월드 1단위 = 1.35m */
export const DEPTH_SCALE = 1.35;

/* 수심 구간별 물빛 — 표층 산호대 → 중층 협곡 → 심해 해구 → 초심해 심연 → 극심해 해구
   실제 수중 촬영처럼 '가까운 것은 진하고, 먼 것은 물빛 안개에 잠기는' 톤으로 맞춘다.
   skyBottom 은 안개색과 같게 두어 지평선이 자연스럽게 이어진다. */
export const ZONES = [
  {
    name: '표층 산호대',
    fog: 0x157a99, density: 0.0056,
    skyTop: 0xb4f6f2, skyMid: 0x2aa6dc, skyBottom: 0x157a99,
    hemiSky: 0xd8fbff, hemiGround: 0x1f6f8f, hemi: 0.82,
    ambient: 0x9cdef6, ambientI: 0.38,
    sun: 0xfffdf2, sunI: 1.85, glow: 1.0,
    coral: [0xff5f8a, 0xff8a3c, 0xffc247, 0xe86ee0, 0xb07bff, 0x35e0c8, 0xff8fb8, 0xffe07a],
  },
  {
    name: '중층 해저 협곡',
    fog: 0x0a5586, density: 0.0098,
    skyTop: 0x5cc2ea, skyMid: 0x0a5586, skyBottom: 0x053a63,
    hemiSky: 0xc2ecff, hemiGround: 0x14505f, hemi: 0.78,
    ambient: 0x7fd0f0, ambientI: 0.4,
    sun: 0xfdf8ec, sunI: 1.05, glow: 0.6,
    coral: [0xe07a9a, 0xe0a255, 0xb884e8, 0x7fc2d8, 0xc47a68],
  },
  {
    name: '심해 해구',
    fog: 0x062a55, density: 0.0135,
    skyTop: 0x164a8e, skyMid: 0x061c40, skyBottom: 0x01060f,
    hemiSky: 0x4d7fd8, hemiGround: 0x050f26, hemi: 0.44,
    ambient: 0x30508f, ambientI: 0.3,
    sun: 0xc8d8ff, sunI: 0.34, glow: 0.3,
    coral: [0x6fa8ff, 0x9fd8ff, 0xb08fff, 0x5fe0d0, 0x7f94ff],
  },
  {
    name: '초심해 심연',
    fog: 0x031430, density: 0.0165,
    skyTop: 0x08204a, skyMid: 0x020a1e, skyBottom: 0x000306,
    hemiSky: 0x2a4a90, hemiGround: 0x03060e, hemi: 0.4,
    ambient: 0x1d3163, ambientI: 0.3,
    sun: 0x9db8e8, sunI: 0.2, glow: 0.15,
    coral: [0x3f6cc0, 0x6f8fe0, 0x8f6fd8, 0x3fc0c0, 0x5f74d0],
  },
  {
    name: '극심해 해구',
    fog: 0x010815, density: 0.0205,
    skyTop: 0x03102b, skyMid: 0x010413, skyBottom: 0x000103,
    hemiSky: 0x1a3570, hemiGround: 0x02030a, hemi: 0.36,
    ambient: 0x16244c, ambientI: 0.3,
    sun: 0x8aa8dd, sunI: 0.12, glow: 0.08,
    coral: [0x2e5aa8, 0x4f74c8, 0x6a4fc0, 0x2d9d9d, 0x46628f],
  },
];

/* 물빛이 바뀌는 수심(m) 경계 — 0~150 / 150~550 / 550~1,000 / 1,000~1,800 / 1,800+ */
export const ZONE_DEPTHS = [150, 550, 1000, 1800];
/** 구역 경계에서 물빛이 섞이는 폭(m) */
const ZONE_BLEND = 160;

/** 수심(m) → 어느 두 구역 사이를 얼마나 섞을지 */
export function zoneBlendAt(depth) {
  for (let i = 0; i < ZONE_DEPTHS.length; i++) {
    const b = ZONE_DEPTHS[i];
    if (depth < b + ZONE_BLEND) {
      if (depth <= b - ZONE_BLEND) return { a: i, b: i, u: 0 };
      const t = (depth - (b - ZONE_BLEND)) / (ZONE_BLEND * 2);
      return { a: i, b: i + 1, u: t * t * (3 - 2 * t) };
    }
  }
  const last = ZONES.length - 1;
  return { a: last, b: last, u: 0 };
}

/* 대형 관상 생물의 충돌체 설정 — 종마다 몸 비율이 달라 따로 둔다
   radius: 가장 긴 축 길이 대비 구체 반지름
   n: 가장 긴 축 방향 구체 개수, m: 두 번째 축 방향 구체 개수(있으면 그리드) */
const CREATURE_COLLIDER = {
  humpback: { radius: 0.15, n: 5 },
  blue: { radius: 0.14, n: 6 },
  orca: { radius: 0.15, n: 5 },
  sperm: { radius: 0.15, n: 5 },
  manta: { radius: 0.12, n: 3, m: 3 },    // 납작하고 넓은 가오리는 격자로 고르게 덮는다
  eagle: { radius: 0.12, n: 3, m: 3 },
  stingray: { radius: 0.2, n: 3, m: 3 },
  turtle: { radius: 0.4, n: 2 },
};

/* 관상용 생물 종 — 모델 생성기 */
const CREATURE_KINDS = {
  humpback: { make: makeHumpbackWhale },
  blue: { make: makeBlueWhale },
  orca: { make: makeOrca },
  sperm: { make: makeSpermWhale },
  manta: { make: makeMantaRay },
  eagle: { make: makeEagleRay },
  stingray: { make: makeStingray },
  turtle: { make: makeTurtle },
};

export function zoneIndexForDepth(depth) {
  for (let i = 0; i < ZONE_DEPTHS.length; i++) {
    if (depth < ZONE_DEPTHS[i]) return i;
  }
  return ZONE_DEPTHS.length;
}

/* ---------------- 청크 스트리밍 설정 ---------------- */
export const CHUNK = 96;          // 청크 한 변 (월드 단위)
const SEG = 16;                   // 청크당 격자 분할 (6 유닛 간격)
const VIEW = 3;                   // 시야 청크 반경 → 7×7 = 49 청크 (반경 336)
const DETAIL = 2;                 // 이 반경 안의 청크에 산호·해초·아치 (5×5)
const BUILD_BUDGET_MS = 6;        // 프레임당 청크 생성 예산
const BUILD_MAX_PER_FRAME = 1;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/** 낮은 주파수 지형 노이즈 (사인 합성 — 어디서나 연속) */
function terrainNoise(x, z) {
  return (
    Math.sin(x * 0.017 + Math.cos(z * 0.013) * 1.7) * 0.55 +
    Math.cos(z * 0.021 + Math.sin(x * 0.011) * 1.3) * 0.45 +
    Math.sin((x + z) * 0.009) * 0.35 +
    Math.sin(x * 0.043 + z * 0.031) * 0.22
  );
}

/** 넓은 범위의 함몰/융기 (평지 수심을 흔든다) */
function basinNoise(x, z) {
  return (
    Math.sin(x * 0.0072 + 0.8) * Math.cos(z * 0.0061 - 0.4) +
    0.6 * Math.sin((x + z) * 0.0045 + 2.1)
  );
}

/** 대륙 규모의 느린 기복 — 아주 먼 거리를 지나도 같은 풍경이 반복되지 않게 */
function swellNoise(x, z) {
  return (
    Math.sin(x * 0.0021 + 1.2) * Math.cos(z * 0.0017 - 0.6) +
    0.55 * Math.sin((x - z) * 0.0013 + 0.4)
  );
}

/** 해저 협곡·해구의 세기 (0 = 평지, 1 = 골짜기 한가운데) */
function trenchStrength(x, z) {
  // 남북으로 굽이치는 주 협곡
  const pathX = 52 * Math.sin(z * 0.0105) + 14 * Math.sin(z * 0.026 + 1.1);
  const d1 = Math.abs(x - pathX);
  const w1 = 27 + 9 * Math.sin(z * 0.021);
  const v1 = Math.exp(-(d1 * d1) / (w1 * w1));
  // 동서로 가로지르는 지협곡
  const pathZ = -22 + 30 * Math.sin(x * 0.014 + 0.6);
  const d2 = Math.abs(z - pathZ);
  const w2 = 23 + 7 * Math.sin(x * 0.028);
  const v2 = Math.exp(-(d2 * d2) / (w2 * w2));
  return Math.min(1, v1 * 0.95 + v2 * 0.8);
}

/** 대륙 규모의 심해 분지 — 아주 먼 거리를 지나도 같은 풍경이 반복되지 않게 */
function basinField(x, z) {
  return (
    Math.sin(x * 0.0024 + 1.3) * Math.cos(z * 0.0021 - 0.7) +
    0.62 * Math.sin((x + z) * 0.0017 + 2.1) +
    0.34 * Math.cos((x - z) * 0.0031 + 0.5) +
    0.16 * Math.sin(x * 0.0093 - z * 0.0071 + 0.9)
  );
}

/** 시작 지점(산호 언덕)은 얕은 대지로 남긴다 — 바깥으로 나가야 심해가 열린다 */
function startGuard(x, z) {
  const d = Math.hypot(x + 20, z - 60);
  return smoothstep(240, 620, d);
}

/** 시작 지점에서 헤엄쳐 나가면 만나는 대표 심연 — 반드시 1,300m 깊이까지 내려간다 */
function abyssCore(x, z) {
  const d = Math.hypot((x - 120) * 0.95, z + 760);
  return smoothstep(700, 235, d);
}

/** 심연 한가운데 있는 극심해 해구(마리아나 해구급) — 2,700m 바닥까지 이어진다 */
function hadalCore(x, z) {
  const d = Math.hypot((x - 210) * 0.92, z + 1430);
  return smoothstep(620, 190, d);
}

/**
 * 해저 높이 (월드 y) — 모든 (x, z) 에서 연속. 경계 없음.
 *  · 산호 언덕 봉우리 y≈21        → 수심 약 18m
 *  · 산호 지대 평지   y≈-5~9     → 수심 약 34~53m
 *  · 해저 협곡 바닥   y≈-215      → 수심 약 336m
 *  · 심해 해구 대지   y≈-470      → 수심 약 680m
 *  · 초심해 심연      y≈-950      → 수심 약 1,330m
 *  · 극심해 해구      y≈-1,985    → 수심 약 2,730m
 * 수심(m) = (SURFACE_Y - y) * DEPTH_SCALE
 */
export function getTerrainHeight(x, z) {
  const hill = smoothstep(-0.35, 0.75, terrainNoise(x, z));
  const shelf = SHELF_Y - 14 * (0.5 + 0.5 * Math.tanh(basinNoise(x, z) * 1.6))
    + swellNoise(x, z) * 5.5;
  let h = shelf + hill * (BANK_Y - shelf);
  h += terrainNoise(x * 2.7, z * 2.7) * 0.9;

  // 1) 중층 해저 협곡 — 얕은 산호대를 가로지르는 깊은 골짜기
  const v = trenchStrength(x, z);
  if (v > 0.0015) {
    const deep = CANYON_FLOOR + 9 * Math.sin(x * 0.05) * Math.cos(z * 0.047)
      + 5 * Math.sin((x + z) * 0.03);
    h = h * (1 - v) + deep * v;
  }

  // 2) 심해 해구 대지 → 3) 초심해 심연 → 4) 극심해 해구 (대륙 규모의 완만한 함몰)
  const guard = startGuard(x, z);
  if (guard > 0.0015) {
    const b = basinField(x, z);
    const t1 = smoothstep(0.12, 1.0, b) * guard;
    const t2 = Math.max(smoothstep(1.0, 1.72, b), abyssCore(x, z)) * guard;
    if (t1 > 0.0015) {
      const f1 = TRENCH_FLOOR
        + 14 * Math.sin(x * 0.018 + 1.2) * Math.cos(z * 0.016)
        + 7 * Math.sin(x * 0.0062 - z * 0.0081 + 0.4);
      h = h * (1 - t1) + f1 * t1;
    }
    if (t2 > 0.0015) {
      const f2 = ABYSS_FLOOR
        + 12 * Math.sin(x * 0.021 - 0.7) * Math.cos(z * 0.018 + 1.1)
        + 6 * Math.sin((x + z) * 0.0105);
      h = h * (1 - t2) + f2 * t2;
    }
    const t3 = Math.max(smoothstep(1.72, 2.42, b), hadalCore(x, z)) * guard;
    if (t3 > 0.0015) {
      const f3 = HADAL_FLOOR
        + 16 * Math.sin(x * 0.017 + 0.9) * Math.cos(z * 0.014 - 1.3)
        + 9 * Math.sin((x - z) * 0.0082 + 0.6);
      h = h * (1 - t3) + f3 * t3;
    }
  }
  return h;
}

/** 기존 호출부 호환 */
export const terrainHeight = getTerrainHeight;

/** 수심(m) */
export function depthAt(x, z) {
  return Math.max(0, (SURFACE_Y - getTerrainHeight(x, z)) * DEPTH_SCALE);
}

/** 경사(기울기) — 급한 벽에는 산호를 심지 않는다 */
function slopeAt(x, z, e = 1.5) {
  const dx = (getTerrainHeight(x + e, z) - getTerrainHeight(x - e, z)) / (2 * e);
  const dz = (getTerrainHeight(x, z + e) - getTerrainHeight(x, z - e)) / (2 * e);
  return Math.hypot(dx, dz);
}

function streakTexture() {
  const w = 128;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < 12; i++) {
    const x = 6 + Math.random() * (w - 12);
    const width = 2 + Math.random() * 14;
    const grad = ctx.createLinearGradient(x - width, 0, x + width, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${0.16 + Math.random() * 0.26})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - width, 0, width * 2, h);
  }
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.2, 'rgba(0,0,0,1)');
  fade.addColorStop(0.8, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  const fadeH = ctx.createLinearGradient(0, 0, w, 0);
  fadeH.addColorStop(0, 'rgba(0,0,0,0)');
  fadeH.addColorStop(0.22, 'rgba(0,0,0,1)');
  fadeH.addColorStop(0.78, 'rgba(0,0,0,1)');
  fadeH.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fadeH;
  ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bubbleTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(220,255,255,0.0)');
  g.addColorStop(0.6, 'rgba(230,255,255,0.12)');
  g.addColorStop(0.84, 'rgba(245,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : 0);

export class World {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.zoneIndex = 0;
    this.zone = ZONES[0];
    this.zoneTarget = ZONES[0];
    this.kelpUniform = { value: 0 };
    this.creatures = [];
    this.schools = [];
    this.depthT = 0;

    // 청크 스트리밍 상태
    this.chunks = new Map();     // "cx,cz" -> 레코드
    this.pool = [];              // 재사용 대기 레코드
    this.queue = [];             // 생성 대기 중인 [cx, cz, detail]
    this._ccx = null;
    this._ccz = null;
    this.stat = { built: 0, disposed: 0, peak: 0 };

    // 구역별 색을 매 프레임 새로 만들지 않도록 캐시
    this.zoneCols = ZONES.map((z) => ({
      fog: new THREE.Color(z.fog),
      skyTop: new THREE.Color(z.skyTop),
      skyMid: new THREE.Color(z.skyMid),
      skyBottom: new THREE.Color(z.skyBottom),
      hemiSky: new THREE.Color(z.hemiSky),
      hemiGround: new THREE.Color(z.hemiGround),
      ambient: new THREE.Color(z.ambient),
      sun: new THREE.Color(z.sun),
    }));
    this._c = new THREE.Color();
    this._c2 = new THREE.Color();

    this._buildMaterials();
    this._buildTemplates();
    this._buildSky();
    this._buildLights();
    this._buildFarFloor();
    this._buildBubbles();
    this.atmo = new Atmosphere(scene);
    this._buildVents();
    this._buildSchools();
    this._buildCreatures();
    this.setZone(0);
  }

  /* ---------------- 물빛 하늘 ---------------- */
  _buildSky() {
    const geo = new THREE.SphereGeometry(468, 32, 20);
    const z = this.zone;
    this.skyUniforms = {
      top: { value: new THREE.Color(z.skyTop) },
      mid: { value: new THREE.Color(z.skyMid) },
      bottom: { value: new THREE.Color(z.skyBottom) },
      uSunDir: { value: new THREE.Vector3(-0.31, 0.93, 0.23).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.98, 0.88) },
      uGlow: { value: 1.0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying float vY;
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vY = vDir.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 mid;
        uniform vec3 bottom;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uGlow;
        varying float vY;
        varying vec3 vDir;
        void main() {
          float t = clamp(vY * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(bottom, mid, smoothstep(0.24, 0.55, t));
          c = mix(c, top, smoothstep(0.54, 1.0, t));
          // 표면 위 태양 — 수중에서 보면 퍼진 빛덩어리로 보인다
          float sd = max(0.0, dot(vDir, uSunDir));
          c += uSunColor * pow(sd, 7.0) * 0.10 * uGlow;
          c += uSunColor * pow(sd, 60.0) * 0.55 * uGlow;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2(this.zone.fog, this.zone.density);
  }

  _buildLights() {
    const z = this.zone;
    this.ambient = new THREE.AmbientLight(z.ambient, z.ambientI);
    this.scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(z.hemiSky, z.hemiGround, z.hemi);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(z.sun, z.sunI);
    this.sun.position.set(-40, 120, 30);
    this.scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(0x8ff0ff, 0.35);
    this.rim.position.set(60, -20, -60);
    this.scene.add(this.rim);
  }

  /* ---------------- 청크용 재질 (공유) ---------------- */
  _buildMaterials() {
    this.tex = getTextures();
    this.rockMat = this._terrainMaterial();
    this.coralMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      map: this.tex.coral,
      bumpMap: this.tex.coralBump,
      bumpScale: 0.34,
      specular: 0x2a3a3a,
      shininess: 14,
    });
    this.kelpMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const kelpTime = this.kelpUniform;
    this.kelpMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = kelpTime;
      shader.vertexShader = 'uniform float uTime;\nattribute float aSway;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        vec3 transformed = vec3( position );
        float hh = aSway;
        float swayA = sin(uTime * 1.3 + position.x * 0.22 + position.z * 0.16) * 0.9 * hh * hh;
        float swayB = cos(uTime * 0.9 + position.x * 0.14) * 0.55 * hh * hh;
        transformed.x += swayA;
        transformed.z += swayB;
        `
      );
    };
    this.floorMats = [this.rockMat, this.coralMat, this.kelpMat];
  }

  /**
   * 해저 지형 재질 — 수심에 따라 모래 → 암벽 → 심해 현무암으로 표면이 바뀌고,
   * 그 위에 실시간 수중 빛무늬(caustics)가 일렁인다.
   * (MeshPhongMaterial + onBeforeCompile 주입으로 아이폰에서도 가볍게)
   */
  _terrainMaterial() {
    const t = this.tex;
    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      map: t.sand,              // USE_MAP 활성화 (vMapUv 사용) — 셰이더에서 직접 블렌딩
      bumpMap: t.sandBump,
      bumpScale: 0.32,
      specular: 0x2c4145,
      shininess: 7,
    });
    const uni = {
      uSand: { value: t.sand },
      uCoralSand: { value: t.coralSand },
      uRock: { value: t.rock },
      uAlgae: { value: t.algae },
      uReef: { value: t.reef },
      uBasalt: { value: t.basalt },
      uCaustics: { value: t.caustics },
      uTime: { value: 0 },
      uCausticI: { value: 1 },
    };
    this.terrainUniforms = uni;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uni);
      shader.vertexShader =
        'varying vec3 vWPosV;\nvarying vec3 vWNrmV;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vWPosV = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNrmV = normalize(mat3(modelMatrix) * objectNormal);`
        );
      shader.fragmentShader =
        'varying vec3 vWPosV;\nvarying vec3 vWNrmV;\n' +
        'uniform sampler2D uSand;\nuniform sampler2D uCoralSand;\nuniform sampler2D uRock;\n' +
        'uniform sampler2D uAlgae;\nuniform sampler2D uReef;\nuniform sampler2D uBasalt;\n' +
        'uniform sampler2D uCaustics;\nuniform float uTime;\nuniform float uCausticI;\n' +
        // 패치 바이옴용 값 노이즈 — 월드 좌표로 텍스처가 자연스럽게 섞이게 한다
        'float abyssHash(vec2 p){ p = fract(p * vec2(127.13, 311.7)); p += dot(p, p + 34.53); return fract(p.x * p.y); }\n' +
        'float abyssNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); ' +
        'float a = abyssHash(i); float b = abyssHash(i + vec2(1.0, 0.0)); float c = abyssHash(i + vec2(0.0, 1.0)); ' +
        'float d = abyssHash(i + vec2(1.0, 1.0)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }\n' +
        'float abyssFbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 3; i++) { s += abyssNoise(p) * a; p *= 2.03; a *= 0.5; } return s / 0.875; }\n' +
        shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
          vec2 tuv = vMapUv;
          vec3 cSand = texture2D( uSand, tuv ).rgb;
          vec3 cCoralSand = texture2D( uCoralSand, tuv * 1.37 ).rgb;
          vec3 cRock = texture2D( uRock, tuv * 0.72 ).rgb;
          vec3 cAlgae = texture2D( uAlgae, tuv * 0.86 ).rgb;
          vec3 cReef = texture2D( uReef, tuv * 1.12 ).rgb;
          vec3 cBasalt = texture2D( uBasalt, tuv * 0.9 ).rgb;

          // 패치 바이옴 — 같은 언덕 안에서도 모래밭·해조 암반·산호초 암벽이 섞인다
          float pBig = abyssFbm( vWPosV.xz * 0.021 );
          float pMid = abyssFbm( vWPosV.xz * 0.075 + 11.3 );
          float pFine = abyssNoise( vWPosV.xz * 0.34 + 3.7 );

          float sandK = smoothstep( -20.0, 8.0, vWPosV.y );
          float deepK = smoothstep( -120.0, -430.0, vWPosV.y );
          float flatK = smoothstep( 0.33, 0.62, vWNrmV.y );
          float sandW = sandK * flatK;

          // 평지 — 보통 모래 ↔ 밝고 분홍빛이 도는 산호 모래
          vec3 sandy = mix( cSand, cCoralSand, smoothstep( 0.36, 0.78, pMid ) );
          // 벽면 — 회색 암벽 ↔ 이끼·해조류 낀 암반 ↔ 다채로운 산호석 암초
          vec3 rocky = mix( cRock, cAlgae, smoothstep( 0.36, 0.62, pBig ) );
          rocky = mix( rocky, cReef, smoothstep( 0.30, 0.72, pMid ) * ( 0.7 + 0.3 * pFine ) );

          vec3 detail = mix( rocky, sandy, sandW );
          // 얕은 산호 지대 — 암초에 분홍·주황 기운을 살짝 얹어 힐링감을 더한다
          float reefK = smoothstep( -40.0, 6.0, vWPosV.y ) * smoothstep( 0.34, 0.86, pFine ) * ( 0.35 + 0.65 * ( 1.0 - flatK ) );
          detail = mix( detail, detail * vec3( 1.26, 0.88, 1.04 ), reefK * 0.5 );
          detail = mix( detail, cBasalt, deepK );
          detail *= 1.18;
          // 얕은 모래밭은 밝고 따뜻하게 — 진짜 백사장 느낌
          detail *= mix( vec3( 1.0 ), vec3( 1.10, 1.08, 1.04 ), sandW );

          // 수중 빛무늬 — 표면색을 밝히고(곱셈) 약간의 빛을 더한다(덧셈)
          float upK = clamp( vWNrmV.y, 0.0, 1.0 );
          float cFade = smoothstep( -360.0, -20.0, vWPosV.y );
          vec2 cuv = vWPosV.xz * 0.14;
          float ca = texture2D( uCaustics, cuv + vec2( uTime * 0.012, uTime * 0.008 ) ).r;
          float cb = texture2D( uCaustics, cuv * 2.31 + vec2( -uTime * 0.015, uTime * 0.012 ) ).r;
          // 셀 경계의 날카로운 선 대신, 큰 패치 안에서만 부드럽게 번지는 빛
          float cshape = smoothstep( 0.30, 1.05, ca * 0.72 + cb * 0.5 );
          float cpatch = smoothstep( 0.34, 0.78, abyssFbm( vWPosV.xz * 0.045 + 21.0 ) );
          float caustic = cshape * cpatch * cFade * ( 0.16 + 0.84 * upK ) * uCausticI;
          detail *= 1.0 + caustic * 0.42;
          diffuseColor.rgb *= detail;
          `
        ).replace(
          'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;',
          `
          vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance
            + vec3( 0.58, 0.93, 1.0 ) * caustic * 0.03;
          `
        );
    };
    return mat;
  }

  /** 지형/바위 지오메트리의 uv 를 월드 좌표 기준으로 다시 심는다 */
  _worldUv(geo, ox, oz) {
    const ua = geo.attributes.uv;
    const pa = geo.attributes.position;
    if (!ua || !pa || ua.count !== pa.count) return;
    for (let i = 0; i < ua.count; i++) {
      ua.setXY(i, (pa.getX(i) + ox) * UV_WORLD, (pa.getZ(i) + oz) * UV_WORLD);
    }
    ua.needsUpdate = true;
  }

  /* ---------------- 지형 소품 템플릿 (한 번만 만들어 재사용) ---------------- */
  _buildTemplates() {
    this.tpl = { rock: [], branch: [], blob: [], tube: [], fan: [], brain: [], tuft: [] };
    for (let i = 0; i < 5; i++) this.tpl.rock.push(paint(rockGeometry(1, 500 + i * 91), 0xffffff));
    for (let i = 0; i < 7; i++) this.tpl.branch.push(branchCoralGeometry(0xffffff, 610 + i * 37));
    for (let i = 0; i < 7; i++) this.tpl.blob.push(blobCoralGeometry(0xffffff, 720 + i * 41));
    for (let i = 0; i < 5; i++) this.tpl.tube.push(tubeCoralGeometry(0xffffff, 830 + i * 43));
    for (let i = 0; i < 6; i++) this.tpl.fan.push(fanCoralGeometry(0xffffff, 940 + i * 47));
    for (let i = 0; i < 5; i++) this.tpl.brain.push(brainCoralGeometry(0xffffff, 1050 + i * 53));
    for (let i = 0; i < 6; i++) this.tpl.tuft.push(tuftCoralGeometry(0xffffff, 1160 + i * 59));
    this._tint = new THREE.Color();
  }

  /** 템플릿을 복제하고 단색으로 칠한다 (색 배열을 새로 만들지 않는다) */
  _clonePainted(tpl, color) {
    const g = tpl.clone();
    const c = this._tint.set(color);
    if (!g.attributes.color) paint(g, 0xffffff);
    const arr = g.attributes.color.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = c.r;
      arr[i + 1] = c.g;
      arr[i + 2] = c.b;
    }
    return g;
  }

  /* ---------------- 먼 바다 바닥 (경계를 안개로 덮는다) ---------------- */
  _buildFarFloor() {
    const geo = new THREE.CircleGeometry(1800, 32);
    geo.rotateX(-Math.PI / 2);
    this.farMat = new THREE.MeshBasicMaterial({ color: this.zone.fog, fog: true, depthWrite: true });
    this.farFloor = new THREE.Mesh(geo, this.farMat);
    this.farFloor.position.y = HADAL_FLOOR - 40;
    this.farFloor.frustumCulled = false;
    this.farFloor.renderOrder = -5;
    this.scene.add(this.farFloor);
  }

  /* ---------------- 청크 한 개 만들기 ---------------- */
  _acquireRecord() {
    if (this.pool.length) return this.pool.pop();
    const group = new THREE.Group();
    const terrain = new THREE.Mesh(new THREE.BufferGeometry(), this.rockMat);
    const coral = new THREE.Mesh(new THREE.BufferGeometry(), this.coralMat);
    const kelp = new THREE.Mesh(new THREE.BufferGeometry(), this.kelpMat);
    coral.visible = false;
    kelp.visible = false;
    group.add(terrain, coral, kelp);
    this.scene.add(group);
    return { group, terrain, coral, kelp, cx: 0, cz: 0, key: '' };
  }

  _releaseRecord(rec, key) {
    rec.terrain.geometry.dispose();
    rec.terrain.geometry = new THREE.BufferGeometry();
    if (rec.coral.geometry.attributes.position) rec.coral.geometry.dispose();
    rec.coral.geometry = new THREE.BufferGeometry();
    if (rec.kelp.geometry.attributes.position) rec.kelp.geometry.dispose();
    rec.kelp.geometry = new THREE.BufferGeometry();
    rec.coral.visible = false;
    rec.kelp.visible = false;
    rec.group.visible = false;
    this.chunks.delete(key);
    this.pool.push(rec);
    this.stat.disposed++;
  }

  _buildChunk(cx, cz, detail) {
    const key = cx + ',' + cz;
    const ox = cx * CHUNK;
    const oz = cz * CHUNK;
    const seed = ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
    const rnd = mulberry(seed);

    const rec = this._acquireRecord();
    rec.cx = cx;
    rec.cz = cz;
    rec.key = key;
    rec.group.position.set(ox, 0, oz);
    rec.group.visible = true;

    /* --- 바닥 (확장 격자에서 높이를 구해 노멀까지 한 번에) --- */
    const N = SEG + 1;                 // 청크 정점 수 (한 변)
    const d = CHUNK / SEG;
    const E = SEG + 3;                 // 한 칸씩 더 넓힌 격자 (이음선 없는 노멀)
    const H = new Float32Array(E * E);
    const half = CHUNK / 2;
    for (let j = 0; j < E; j++) {
      for (let i = 0; i < E; i++) {
        H[j * E + i] = getTerrainHeight(
          ox - half - d + i * d,
          oz - half - d + j * d
        );
      }
    }
    const hAt = (i, j) => H[(j + 1) * E + (i + 1)];
    const vpos = new Float32Array(N * N * 3);
    const vcol = new Float32Array(N * N * 3);
    const vnor = new Float32Array(N * N * 3);
    const fc = new THREE.Color();
    const vuv = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k3 = (j * N + i) * 3;
        const lx = -half + i * d;
        const lz = -half + j * d;
        const y = hAt(i, j);
        vpos[k3] = lx;
        vpos[k3 + 1] = y;
        vpos[k3 + 2] = lz;
        const wx = ox + lx;
        const wz = oz + lz;

        // 노멀 (이웃 높이에서)
        const hL = hAt(i - 1, j);
        const hR = hAt(i + 1, j);
        const hD = hAt(i, j - 1);
        const hU = hAt(i, j + 1);
        const nx = hL - hR;
        const ny = 2 * d;
        const nz = hD - hU;
        const len = Math.hypot(nx, ny, nz) || 1;
        const unx = nx / len;
        const uny = ny / len;
        const unz = nz / len;
        vnor[k3] = unx;
        vnor[k3 + 1] = uny;
        vnor[k3 + 2] = unz;

        // 색 — 평평한 바닥은 모래, 벽면은 암벽(gray)
        const flatness = clamp01((uny - 0.35) / 0.55);   // 1 = 평지
        const n =
          Math.sin(wx * 0.15 + wz * 0.07) * 0.5 +
          Math.cos(wz * 0.13 - wx * 0.09) * 0.5;
        const kk = clamp01((n + 1.15) / 2.3);
        const dkRaw = clamp01((SURFACE_Y - y) / 1000);
        const dk = Math.pow(dkRaw, 0.7);
        // 벽면은 큰 패치로 색이 갈린다 — 회백색 암벽 · 이끼 초록 · 산호 분홍/보라
        const wall = 1 - flatness;
        const wpatch = Math.sin(wx * 0.041 + wz * 0.017) * 0.5 + Math.cos(wz * 0.031 - wx * 0.026) * 0.5;
        const hue = 0.10 + dk * 0.45 + wall * (0.09 + wpatch * 0.19);
        const sat = 0.07 + flatness * 0.10 + wall * (0.08 + Math.max(0, wpatch) * 0.10);
        const lit = (0.56 - dk * 0.28 + kk * 0.05) * (0.82 + flatness * 0.18);
        fc.setHSL(hue, Math.max(0.02, sat), clamp01(lit));
        vcol[k3] = fc.r;
        vcol[k3 + 1] = fc.g;
        vcol[k3 + 2] = fc.b;

        // uv — 면이 향한 방향에 맞춰 투영 (벽이늘어나지 않게)
        const ax = Math.abs(unx);
        const ay = Math.abs(uny);
        const az = Math.abs(unz);
        const u2 = (j * N + i) * 2;
        if (ay >= ax && ay >= az) {
          vuv[u2] = wx * UV_WORLD;
          vuv[u2 + 1] = wz * UV_WORLD;
        } else if (ax >= az) {
          vuv[u2] = wz * UV_WORLD;
          vuv[u2 + 1] = y * UV_WORLD;
        } else {
          vuv[u2] = wx * UV_WORLD;
          vuv[u2 + 1] = y * UV_WORLD;
        }
      }
    }
    // 정점 격자 → 삼각형 (비인덱스, 위를 향하는 감김)
    const cells = SEG * SEG;
    const fpos = new Float32Array(cells * 18);
    const fnor = new Float32Array(cells * 18);
    const fcolOut = new Float32Array(cells * 18);
    const fuv = new Float32Array(cells * 12);
    let o18 = 0;
    let o12 = 0;
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * N + i;
        const b = (j + 1) * N + i;
        const c = j * N + (i + 1);
        const dd = (j + 1) * N + (i + 1);
        const order = [a, b, c, c, b, dd];
        for (let t = 0; t < 6; t++) {
          const s = order[t] * 3;
          fpos[o18] = vpos[s];
          fpos[o18 + 1] = vpos[s + 1];
          fpos[o18 + 2] = vpos[s + 2];
          fnor[o18] = vnor[s];
          fnor[o18 + 1] = vnor[s + 1];
          fnor[o18 + 2] = vnor[s + 2];
          fcolOut[o18] = vcol[s];
          fcolOut[o18 + 1] = vcol[s + 1];
          fcolOut[o18 + 2] = vcol[s + 2];
          o18 += 3;
          const vi = order[t];
          fuv[o12] = vuv[vi * 2];
          fuv[o12 + 1] = vuv[vi * 2 + 1];
          o12 += 2;
        }
      }
    }
    const floorGeo = new THREE.BufferGeometry();
    floorGeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    floorGeo.setAttribute('normal', new THREE.BufferAttribute(fnor, 3));
    floorGeo.setAttribute('color', new THREE.BufferAttribute(fcolOut, 3));
    floorGeo.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
    const flatFloor = floorGeo;

    /* --- 바위 (모든 청크 · 먼 곳에서도 실루엣을 만들어 준다) --- */
    const geos = [flatFloor];
    const rockCount = detail ? 12 : 5;
    const rockCol = new THREE.Color();
    for (let i = 0; i < rockCount; i++) {
      const lx = (rnd() - 0.5) * CHUNK * 0.94;
      const lz = (rnd() - 0.5) * CHUNK * 0.94;
      const r = (detail ? 1.1 : 2.0) + rnd() * (detail ? 3.0 : 5.0);
      const tpl = this.tpl.rock[Math.floor(rnd() * this.tpl.rock.length)];
      const g = rnd() < 0.84 ? 0.2 + rnd() * 0.14 : 0.34 + rnd() * 0.12;
      const geo = this._clonePainted(tpl, rockCol.setHSL(0.09, 0.12, g).getHex());
      const m = new THREE.Matrix4();
      m.makeRotationY(rnd() * Math.PI * 2);
      m.scale(new THREE.Vector3(r, r, r));
      m.setPosition(lx, getTerrainHeight(ox + lx, oz + lz) + r * 0.16, lz);
      geo.applyMatrix4(m);
      this._worldUv(geo, ox, oz);
      geos.push(geo);
    }

    /* --- 바위 아치 (가끔) --- */
    if (detail && rnd() < 0.22) {
      const ax = (rnd() - 0.5) * CHUNK * 0.5;
      const az = (rnd() - 0.5) * CHUNK * 0.5;
      const gy = getTerrainHeight(ox + ax, oz + az);
      if (gy > -4) {
        const R = 13 + rnd() * 8;
        const rot = rnd() * Math.PI * 2;
        const n = 9;
        for (let i = 0; i < n; i++) {
          const a = (i / (n - 1)) * Math.PI;
          const rr = 2.0 + rnd() * 1.5;
          const tpl = this.tpl.rock[Math.floor(rnd() * this.tpl.rock.length)];
          const geo = this._clonePainted(tpl, new THREE.Color().setHSL(0.33, 0.24, 0.16 + rnd() * 0.12).getHex());
          const m = new THREE.Matrix4();
          m.makeRotationY(rnd() * Math.PI * 2);
          m.scale(new THREE.Vector3(rr, rr, rr));
          m.setPosition(
            ax + Math.cos(a) * R * Math.cos(rot),
            gy + 1.5 + Math.sin(a) * R * 1.05,
            az + Math.cos(a) * R * Math.sin(rot)
          );
          geo.applyMatrix4(m);
          this._worldUv(geo, ox, oz);
          geos.push(geo);
        }
      }
    }

    const terrainGeo = mergeGeometries(geos, false);
    rec.terrain.geometry = terrainGeo;
    terrainGeo.computeBoundingSphere();

    /* --- 산호초 --- */
    if (detail) {
      const coralGeos = [];
      const zone = this.zone;
      const tmpCol = new THREE.Color();
      for (let i = 0; i < 42; i++) {
        const lx = (rnd() - 0.5) * CHUNK * 0.94;
        const lz = (rnd() - 0.5) * CHUNK * 0.94;
        const wx = ox + lx;
        const wz = oz + lz;
        const gy = getTerrainHeight(wx, wz);
        if (gy < -34) continue;                 // 수심 90m 보다 깊은 곳에는 산호를 심지 않는다
        const slope = slopeAt(wx, wz);
        if (slope > 1.45) continue;             // 수직에 가까운 벽에는 심지 않는다
        const steep = slope > 0.7;              // 절벽 경사면 — 작고 단단한 산호 위주
        const color = zone.coral[Math.floor(rnd() * zone.coral.length)];
        const kind = rnd();
        let tpl;
        if (kind < 0.26) tpl = this.tpl.branch[Math.floor(rnd() * this.tpl.branch.length)];
        else if (kind < 0.46) tpl = this.tpl.fan[Math.floor(rnd() * this.tpl.fan.length)];
        else if (kind < 0.64) tpl = this.tpl.brain[Math.floor(rnd() * this.tpl.brain.length)];
        else if (kind < 0.82) tpl = this.tpl.blob[Math.floor(rnd() * this.tpl.blob.length)];
        else tpl = this.tpl.tube[Math.floor(rnd() * this.tpl.tube.length)];

        // 산호 군락 — 한 자리에 1~3 개를 모아 심어 밀도를 높인다
        const clump = 1 + Math.floor(rnd() * (steep ? 2 : 3));
        for (let c = 0; c < clump; c++) {
          const dx = c === 0 ? 0 : (rnd() - 0.5) * 4.2;
          const dz = c === 0 ? 0 : (rnd() - 0.5) * 4.2;
          const cgy = c === 0 ? gy : getTerrainHeight(wx + dx, wz + dz);
          let geo = this._clonePainted(tpl, color);
          if (geo.index) geo = geo.toNonIndexed();   // 바퀴·산호를 섞어 병합하려면 인덱스 여부를 통일
          const sc = (1.38 + rnd() * 2.0) * (steep ? 0.78 : 1.0);
          const m = new THREE.Matrix4();
          m.makeRotationY(rnd() * Math.PI * 2);
          m.scale(new THREE.Vector3(sc, sc * (0.9 + rnd() * 0.7), sc));
          m.setPosition(lx + dx, cgy + 0.08, lz + dz);
          geo.applyMatrix4(m);
          coralGeos.push(geo);
        }
      }
      // 산호 카펫 — 바닥과 경사면을 작은 산호 다발로 촘촘히 덮는다
      for (let i = 0; i < 46; i++) {
        const lx = (rnd() - 0.5) * CHUNK * 0.96;
        const lz = (rnd() - 0.5) * CHUNK * 0.96;
        const wx = ox + lx;
        const wz = oz + lz;
        const gy = getTerrainHeight(wx, wz);
        if (gy < -30) continue;
        if (slopeAt(wx, wz) > 2.0) continue;
        const tpl = this.tpl.tuft[Math.floor(rnd() * this.tpl.tuft.length)];
        const color = zone.coral[Math.floor(rnd() * zone.coral.length)];
        let geo = this._clonePainted(tpl, color);
        if (geo.index) geo = geo.toNonIndexed();
        const sc = 0.8 + rnd() * 1.5;
        const m = new THREE.Matrix4();
        m.makeRotationY(rnd() * Math.PI * 2);
        m.scale(new THREE.Vector3(sc, sc * (0.8 + rnd() * 0.8), sc));
        m.setPosition(lx, gy + 0.05, lz);
        geo.applyMatrix4(m);
        coralGeos.push(geo);
      }
      // 색이 산호 같은 작은 암초 덩이 — 바닥에 다채로운 색 반점을 준다
      for (let i = 0; i < 7; i++) {
        const lx = (rnd() - 0.5) * CHUNK * 0.9;
        const lz = (rnd() - 0.5) * CHUNK * 0.9;
        const wx = ox + lx;
        const wz = oz + lz;
        const gy = getTerrainHeight(wx, wz);
        if (gy < -30) continue;
        const tpl = this.tpl.rock[Math.floor(rnd() * this.tpl.rock.length)];
        const cc = zone.coral[Math.floor(rnd() * zone.coral.length)];
        let geo = this._clonePainted(tpl, tmpCol.set(cc).lerp(new THREE.Color(0xcfc6b4), 0.62).getHex());
        if (geo.index) geo = geo.toNonIndexed();
        const sc = 0.55 + rnd() * 1.1;
        const m = new THREE.Matrix4();
        m.makeRotationY(rnd() * Math.PI * 2);
        m.scale(new THREE.Vector3(sc, sc * 0.8, sc));
        m.setPosition(lx, gy + sc * 0.1, lz);
        geo.applyMatrix4(m);
        coralGeos.push(geo);
      }
      if (coralGeos.length) {
        const g = mergeGeometries(coralGeos, false);
        g.computeBoundingSphere();
        rec.coral.geometry = g;
        rec.coral.visible = true;
      }
    }

    /* --- 해초 --- */
    if (detail) {
      const kelpGeos = [];
      for (let i = 0; i < 22; i++) {
        const lx = (rnd() - 0.5) * CHUNK * 0.94;
        const lz = (rnd() - 0.5) * CHUNK * 0.94;
        const wx = ox + lx;
        const wz = oz + lz;
        const gy = getTerrainHeight(wx, wz);
        if (gy < 1) continue;              // 해초 숲은 얕은 언덕에만
        if (slopeAt(wx, wz) > 0.95) continue;
        const h = 4.5 + rnd() * 11;
        const w = 0.7 + rnd() * 0.8;
        // 다시마 군락 — 같은 자리에 2~3 포기를 다른 높이로
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const geo = kelpGeometry(h * (0.65 + rnd() * 0.6), w, 300 + seed * 13 + i * 7 + k);
          const m = new THREE.Matrix4();
          m.makeRotationY(rnd() * Math.PI * 2);
          m.setPosition(lx + (rnd() - 0.5) * 3.4, gy - 0.3, lz + (rnd() - 0.5) * 3.4);
          geo.applyMatrix4(m);
          kelpGeos.push(geo);
        }
      }
      if (kelpGeos.length) {
        const g = mergeGeometries(kelpGeos, false);
        g.computeBoundingSphere();
        rec.kelp.geometry = g;
        rec.kelp.visible = true;
      }
    }

    this.chunks.set(key, rec);
    this.stat.built++;
    if (this.chunks.size > this.stat.peak) this.stat.peak = this.chunks.size;
    return rec;
  }

  /* ---------------- 스트리밍 갱신 ---------------- */
  _refreshAround(px, pz) {
    const ccx = Math.round(px / CHUNK);
    const ccz = Math.round(pz / CHUNK);
    if (ccx === this._ccx && ccz === this._ccz) return;
    this._ccx = ccx;
    this._ccz = ccz;

    // 멀어진 청크 정리
    for (const [key, rec] of this.chunks) {
      if (Math.max(Math.abs(rec.cx - ccx), Math.abs(rec.cz - ccz)) > VIEW) {
        this._releaseRecord(rec, key);
      }
    }

    // 필요한 청크 수집 (가까운 순)
    const need = [];
    for (let dz = -VIEW; dz <= VIEW; dz++) {
      for (let dx = -VIEW; dx <= VIEW; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const key = cx + ',' + cz;
        if (this.chunks.has(key)) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        need.push({ cx, cz, ring, d: dx * dx + dz * dz });
      }
    }
    need.sort((a, b) => a.d - b.d);
    this.queue = need;
  }

  _streamChunks(playerPos) {
    this._px = playerPos.x;
    this._pz = playerPos.z;
    this._refreshAround(playerPos.x, playerPos.z);
    if (!this.queue.length) return;
    const deadline = now() + BUILD_BUDGET_MS;
    let built = 0;
    while (this.queue.length && built < BUILD_MAX_PER_FRAME) {
      const job = this.queue.shift();
      const key = job.cx + ',' + job.cz;
      if (this.chunks.has(key)) continue;
      this._buildChunk(job.cx, job.cz, job.ring <= DETAIL);
      built++;
      if (now() > deadline) break;
    }
  }

  /** 디버그/검증용 */
  chunkStats() {
    let detailChunks = 0;
    for (const rec of this.chunks.values()) {
      if (rec.coral.visible) detailChunks++;
    }
    return {
      loaded: this.chunks.size,
      detail: detailChunks,
      queued: this.queue.length,
      built: this.stat.built,
      disposed: this.stat.disposed,
      peak: this.stat.peak,
      center: [this._ccx, this._ccz],
      playerChunk: [Math.round(this._px / CHUNK), Math.round(this._pz / CHUNK)],
    };
  }

  /* ---------------- 기포 ---------------- */
  /* 위로 솟는 잔기포 — 수면까지 올라가면 아래에서 다시 시작한다.
     (빛줄기·부유물·생물발광은 atmosphere.js 가 맡는다) */
  _buildBubbles() {
    const bubbleCount = 260;
    const bGeo = new THREE.BufferGeometry();
    const bp = new Float32Array(bubbleCount * 3);
    this.bubbleData = [];
    for (let i = 0; i < bubbleCount; i++) {
      bp[i * 3] = (Math.random() - 0.5) * 320;
      bp[i * 3 + 1] = SURFACE_Y - 4 - Math.random() * 260;
      bp[i * 3 + 2] = (Math.random() - 0.5) * 320;
      this.bubbleData.push({ rise: 0.7 + Math.random() * 2.0, sway: Math.random() * 6.28 });
    }
    bGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    this.bubbles = new THREE.Points(
      bGeo,
      new THREE.PointsMaterial({
        map: bubbleTexture(), size: 0.55, transparent: true, opacity: 0.5,
        depthWrite: false, sizeAttenuation: true, color: 0xeaffff,
        blending: THREE.AdditiveBlending,
      })
    );
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 6;
    this.scene.add(this.bubbles);
  }

  /* ---------------- 극심해 열수구 불빛 (2,000m+ 분위기) ---------------- */
  _buildVents() {
    const glow = glowTexture();
    this.ventMat = new THREE.MeshLambertMaterial({
      color: 0x241d18,
      emissive: 0x2a0f06,   // 완전 검은 실루엣이 되지 않게 열기를 살짝 머금게
      emissiveIntensity: 0.85,
    });
    this.vents = [];
    for (let i = 0; i < 16; i++) {
      const group = new THREE.Group();
      const h = 5 + Math.random() * 9;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.4 + Math.random() * 1.2, h, 7, 1),
        this.ventMat
      );
      cone.position.y = h / 2 - 0.6;
      cone.rotation.y = Math.random() * 6.28;
      group.add(cone);

      // 굴뚝 끝에서 타오르는 열기 — 주황 불빛
      const ember = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color: 0xff7d33, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      ember.position.y = h + 0.3;
      ember.scale.setScalar(6 + Math.random() * 5);
      group.add(ember);

      // 굴뚝을 타고 오르는 푸른 생물 발광
      const cool = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color: 0x58e2ff, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      cool.position.y = h * 0.45;
      cool.scale.setScalar(3 + Math.random() * 2.5);
      group.add(cool);

      group.visible = false;
      group.userData = { ember, cool, phase: Math.random() * 6.28, emberScale: ember.scale.x };
      this.scene.add(group);
      this.vents.push(group);
    }
  }

  _seedVent(v, px, pz, playerY) {
    for (let tries = 0; tries < 6; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 240;
      const x = px + Math.cos(ang) * dist;
      const z = pz + Math.sin(ang) * dist;
      const gy = getTerrainHeight(x, z);
      v.position.set(x, gy - 0.5, z);
      if (gy < playerY - 3) return;
    }
  }

  /* ---------------- 물고기 떼 ---------------- */
  _seedSchool(school, rnd, px, pz) {
    const ang = rnd() * Math.PI * 2;
    const dist = 70 + rnd() * 110;
    const cx = px + Math.cos(ang) * dist;
    const cz = pz + Math.sin(ang) * dist;
    const gy = getTerrainHeight(cx, cz);
    school.center.set(
      cx,
      gy < -12 ? Math.max(gy + 16, -20) : gy + 9 + rnd() * 7,
      cz
    );
    school.radius = 26 + rnd() * 44;
    school.seeded = true;
  }

  _buildSchools() {
    const rnd = mulberry(918);
    this._schoolRnd = rnd;
    for (let s = 0; s < 8; s++) {
      const count = 28;
      const inst = makeFishSchool(count);
      const school = {
        mesh: inst,
        offsets: [],
        center: new THREE.Vector3(),
        radius: 26 + rnd() * 44,
        angle: rnd() * 6.28,
        angular: (0.04 + rnd() * 0.08) * (rnd() > 0.5 ? 1 : -1),
        bob: rnd() * 6.28,
        scale: 1.1 + rnd() * 0.6,
        seeded: false,
        rnd: mulberry(900 + s * 37),
      };
      school.center.set((rnd() - 0.5) * 150, 6 + rnd() * 10, (rnd() - 0.5) * 150);
      for (let i = 0; i < count; i++) {
        school.offsets.push({
          x: (rnd() - 0.5) * 9,
          y: (rnd() - 0.5) * 4,
          z: (rnd() - 0.5) * 9,
          p: rnd() * 6.28,
          s: 0.7 + rnd() * 0.6,
        });
      }
      this.schools.push(school);
      this.scene.add(inst);
    }
  }

  /* ---------------- 대형 관상 생물 ---------------- */
  /**
   * 대형 생물용 충돌 구체 목록 — 몸통을 축 따라 여러 구로 덮는다.
   * (긴 몸통을 구분해 밀어내기 위함. radiusFactor 는 가장 긴 축 길이 대비 반지름)
   */
  _creatureColliders(group, kind) {
    const box = new THREE.Box3().setFromObject(group);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return [];
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const dims = [['x', size.x], ['y', size.y], ['z', size.z]];
    dims.sort((a, b) => b[1] - a[1]);
    const axis = dims[0][0];
    const L = dims[0][1];
    const cfg = CREATURE_COLLIDER[kind] || CREATURE_COLLIDER.humpback;
    const r = Math.max(0.6, L * cfg.radius);
    const half = Math.max(0, L / 2 - r * 0.9);
    const list = [];

    if (cfg.m) {
      // 두 축에 걸친 구체 그리드 (넓고 납작한 생물)
      const axis2 = dims[1][0];
      const L2 = dims[1][1];
      const half2 = Math.max(0, L2 / 2 - r * 0.9);
      for (let j = 0; j < cfg.m; j++) {
        const t2 = cfg.m === 1 ? 0 : (j / (cfg.m - 1)) * 2 - 1;
        for (let i = 0; i < cfg.n; i++) {
          const t = cfg.n === 1 ? 0 : (i / (cfg.n - 1)) * 2 - 1;
          const s = { x: center.x, y: center.y, z: center.z, r };
          s[axis] = center[axis] + t * half;
          s[axis2] = center[axis2] + t2 * half2;
          list.push(s);
        }
      }
      return list;
    }

    for (let i = 0; i < cfg.n; i++) {
      const t = cfg.n === 1 ? 0 : (i / (cfg.n - 1)) * 2 - 1;
      const s = { x: center.x, y: center.y, z: center.z, r };
      s[axis] = center[axis] + t * half;
      list.push(s);
    }
    return list;
  }

  /** 종별 모델 · 고유 수심대(band, 단위 m) · 유영 반경 */
  _buildCreatures() {
    const rnd = mulberry(3131);
    const plan = [
      { kind: 'humpback', scale: 1.1, band: [10, 190], radius: 132, angular: 0.03, clearance: 12 },
      { kind: 'blue', scale: 1.05, band: [15, 260], radius: 168, angular: -0.021, clearance: 14 },
      { kind: 'orca', scale: 1.15, band: [10, 400], radius: 116, angular: 0.043, clearance: 10 },
      { kind: 'sperm', scale: 1.3, band: [380, 2700], radius: 138, angular: 0.026, clearance: 16 },
      { kind: 'sperm', scale: 1.1, band: [320, 2550], radius: 178, angular: -0.022, clearance: 18 },
      { kind: 'manta', scale: 1.15, band: [5, 210], radius: 106, angular: 0.05, clearance: 7 },
      { kind: 'manta', scale: 1.4, band: [10, 280], radius: 142, angular: -0.04, clearance: 9 },
      { kind: 'eagle', scale: 1.15, band: [5, 180], radius: 94, angular: 0.06, clearance: 6 },
      { kind: 'stingray', scale: 1.25, band: [20, 440], radius: 80, angular: 0.048, clearance: 4 },
      { kind: 'turtle', scale: 1.15, band: [5, 140], radius: 90, angular: 0.07, clearance: 5 },
      { kind: 'turtle', scale: 1.0, band: [5, 170], radius: 114, angular: -0.06, clearance: 6 },
    ];
    for (const p of plan) {
      const obj = CREATURE_KINDS[p.kind].make();
      const c = {
        kind: p.kind,
        obj,
        t: rnd() * 6.28,
        center: new THREE.Vector3((rnd() - 0.5) * 80, 0, (rnd() - 0.5) * 80),
        radius0: p.radius,
        radius: p.radius,
        angle: rnd() * 6.28,
        angular: p.angular,
        band: p.band,
        depth: p.band[0],
        clearance: p.clearance,
        bobPhase: rnd() * 6.28,
        scale: p.scale,
        seeded: false,
        rnd: mulberry(4000 + Math.floor(rnd() * 1000)),
      };
      obj.group.scale.setScalar(p.scale);
      obj.group.rotation.order = 'YXZ';
      this.scene.add(obj.group);
      c.colliders = this._creatureColliders(obj.group, p.kind);
      let reach = 0;
      for (const s of c.colliders) {
        reach = Math.max(reach, Math.hypot(s.x, s.y, s.z) + s.r);
      }
      c.cullR = reach + 24;
      this.creatures.push(c);
    }
  }

  /** 플레이어 주변·플레이어 수심대에 맞춰 생물을 다시 자리잡게 한다 */
  _seedCreature(c, px, pz, playerDepth) {
    const rnd = c.rnd;
    const ang = rnd() * Math.PI * 2;
    const dist = 70 + rnd() * 90;
    c.center.set(px + Math.cos(ang) * dist, 0, pz + Math.sin(ang) * dist);
    c.depth = Math.min(c.band[1], Math.max(c.band[0], playerDepth + (rnd() - 0.5) * 90));
    c.angle = rnd() * Math.PI * 2;
    c.radius = c.radius0 * (0.85 + rnd() * 0.4);
    c.seeded = true;
  }

  /* ---------------- 구역 ---------------- */
  setZone(index) {
    const i = Math.max(0, Math.min(ZONES.length - 1, index));
    this.zoneIndex = i;
    this.zone = ZONES[i];
    this.zoneTarget = ZONES[i];
    // 바닥 색은 항상 산호 지대 톤을 기본으로 (물빛은 update 에서 수심에 따라 변한다)
    const tint = new THREE.Color(ZONES[0].coral[0]).lerp(new THREE.Color(0xffffff), 0.9);
    this.floorMats.forEach((m) => m.color.copy(tint));
  }

  /* ---------------- 업데이트 ---------------- */
  /** 대기 연출(atmosphere)이 카메라 시점을 알아야 해서 한 번 넘겨둔다 */
  setCamera(cam) {
    this._cameraForAtmo = cam;
    if (this.atmo) this.atmo.camera = cam;
  }

  /** 화질 프리셋을 대기 연출에도 전달 */
  setQuality(preset) {
    if (this.atmo) this.atmo.setQuality(preset);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.kelpUniform.value = this.time;

    // 청크 스트리밍
    this._streamChunks(playerPos);

    // 수심에 따른 물빛 전환 — 표층 산호대에서 극심해 해구까지 다섯 단계
    const depth = Math.max(0, (SURFACE_Y - playerPos.y) * DEPTH_SCALE);
    this.depthT = clamp01(depth / ZONE_DEPTHS[ZONE_DEPTHS.length - 1]);
    this.zoneIndex = zoneIndexForDepth(depth);
    const blend = zoneBlendAt(depth);
    const a = blend.a;
    const b = blend.b;
    const u = blend.u;
    const c0 = this.zoneCols[a];
    const c1 = this.zoneCols[b];
    const z0 = ZONES[a];
    const z1 = ZONES[b];
    const k = Math.min(1, dt * 2.2);
    const tc = this._c;

    if (this.scene.fog) {
      this.scene.fog.color.lerp(tc.copy(c0.fog).lerp(c1.fog, u), k);
      this.scene.fog.density += (mix(z0.density, z1.density, u) - this.scene.fog.density) * k;
      this.farMat.color.copy(this.scene.fog.color);
    }
    this.hemi.intensity += (mix(z0.hemi, z1.hemi, u) - this.hemi.intensity) * k;
    this.hemi.color.lerp(tc.copy(c0.hemiSky).lerp(c1.hemiSky, u), k);
    this.hemi.groundColor.lerp(tc.copy(c0.hemiGround).lerp(c1.hemiGround, u), k);
    this.ambient.color.lerp(tc.copy(c0.ambient).lerp(c1.ambient, u), k);
    this.ambient.intensity += (mix(z0.ambientI, z1.ambientI, u) - this.ambient.intensity) * k;
    this.sun.intensity += (mix(z0.sunI, z1.sunI, u) - this.sun.intensity) * k;
    this.sun.color.lerp(tc.copy(c0.sun).lerp(c1.sun, u), k);
    this.skyUniforms.top.value.lerp(tc.copy(c0.skyTop).lerp(c1.skyTop, u), k);
    this.skyUniforms.mid.value.lerp(tc.copy(c0.skyMid).lerp(c1.skyMid, u), k);
    this.skyUniforms.bottom.value.lerp(tc.copy(c0.skyBottom).lerp(c1.skyBottom, u), k);
    this.skyUniforms.uGlow.value += (mix(z0.glow === undefined ? 0.5 : z0.glow, z1.glow === undefined ? 0.5 : z1.glow, u) - this.skyUniforms.uGlow.value) * k;

    // 수면·빛줄기·부유물·생물발광 (atmosphere.js)
    if (this.atmo && this._cameraForAtmo) {
      this.atmo.update(
        dt, playerPos, this._cameraForAtmo, depth,
        this.scene.fog.color, this.scene.fog.density,
        this.skyUniforms.uSunDir.value,
        this.sun.intensity
      );
    }

    // 실시간 수중 빛무늬 시간·세기
    if (this.terrainUniforms) {
      this.terrainUniforms.uTime.value = this.time;
      this.terrainUniforms.uCausticI.value = mix(z0.sunI, z1.sunI, u) * 0.75;
    }

    // 기포 — 수면까지 올라간 뒤 플레이어 주변에서 다시 시작
    const bpos = this.bubbles.geometry.attributes.position;
    const ba = bpos.array;
    for (let i = 0; i < this.bubbleData.length; i++) {
      const d = this.bubbleData[i];
      ba[i * 3] += Math.sin(this.time * 0.6 + d.sway) * dt * 0.5;
      ba[i * 3 + 1] += d.rise * dt;
      ba[i * 3 + 2] += Math.cos(this.time * 0.5 + d.sway) * dt * 0.3;
      const dx = ba[i * 3] - playerPos.x;
      const dz = ba[i * 3 + 2] - playerPos.z;
      if (ba[i * 3 + 1] > SURFACE_Y - 1 || dx * dx + dz * dz > 260 * 260) {
        ba[i * 3 + 1] = playerPos.y - 60 - Math.random() * 50;
        ba[i * 3] = playerPos.x + (Math.random() - 0.5) * 300;
        ba[i * 3 + 2] = playerPos.z + (Math.random() - 0.5) * 300;
      }
    }
    bpos.needsUpdate = true;

    // 부유물은 atmosphere.js 가 GPU 로 처리한다 (CPU 순회 없음)

    // 물고기 떼 (원형 유영) — 무한 바다이므로 플레이어를 따라 새로 자리잡는다
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler(0, 0, 0, 'YXZ');
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let speedSum = 0;
    let speedN = 0;
    for (const s of this.schools) {
      const far = Math.hypot(s.center.x - playerPos.x, s.center.z - playerPos.z) > 250;
      if (far) this._seedSchool(s, s.rnd, playerPos.x, playerPos.z);
      s.angle += s.angular * dt;
      const cx = s.center.x + Math.cos(s.angle) * s.radius;
      const cz = s.center.z + Math.sin(s.angle) * s.radius;
      const cy = s.center.y + Math.sin(this.time * 0.5 + s.bob) * 3.5;
      const heading = Math.atan2(-Math.sin(s.angle) * Math.sign(s.angular), Math.cos(s.angle) * Math.sign(s.angular));
      // 떼 전체가 선회 방향 안쪽으로 기울고, 한 마리씩 조금씩 다른 자세로 흔들린다
      const bank = -Math.sign(s.angular) * 0.2;
      // 떼가 빨리 도는 동안에는 꼬리질도 자주 해진다
      speedSum += Math.abs(s.angular) * s.radius;
      speedN += 1;
      for (let i = 0; i < s.offsets.length; i++) {
        const o = s.offsets[i];
        pos.set(
          cx + o.x + Math.sin(this.time * 1.1 + o.p) * 1.1,
          cy + o.y + Math.cos(this.time * 1.4 + o.p) * 0.6,
          cz + o.z + Math.cos(this.time * 1.1 + o.p) * 1.4
        );
        eul.set(
          Math.sin(this.time * 1.4 + o.p) * 0.12,
          heading + Math.sin(this.time * 2 + o.p) * 0.2,
          bank + Math.sin(this.time * 2 + o.p) * 0.12
        );
        q.setFromEuler(eul);
        scl.setScalar(o.s * s.scale * 0.55);
        m.compose(pos, q, scl);
        s.mesh.setMatrixAt(i, m);
      }
      s.mesh.instanceMatrix.needsUpdate = true;
    }
    if (speedN) {
      const want = Math.min(1.25, Math.max(0.8, speedSum / speedN / 5));
      this.schoolRate = this.schoolRate === undefined ? want : this.schoolRate + (want - this.schoolRate) * Math.min(1, dt * 0.6);
      setSwimRate('school', this.schoolRate);
    }

    // 대형 생물 — 플레이어의 수심대에 맞는 종이 주변에 머문다
    for (const c of this.creatures) {
      c.t += dt;
      c.angle += c.angular * dt;
      const far = Math.hypot(c.center.x - playerPos.x, c.center.z - playerPos.z) > 300 + c.radius;
      const want = Math.min(c.band[1], Math.max(c.band[0], depth));
      const drift = Math.abs(c.depth - want) > 240;
      if (!c.seeded || far || drift) this._seedCreature(c, playerPos.x, playerPos.z, depth);

      const g = c.obj.group;
      // 원 궤도 위에서 반지름을 살짝 흔들며 도는 부드러운 유영 — 딱딱한 원운동을 벗어난다
      const R = c.radius * (1 + Math.sin(c.t * 0.23 + c.bobPhase * 1.7) * 0.07);
      const cx = c.center.x + Math.cos(c.angle) * R;
      const cz = c.center.z + Math.sin(c.angle) * R;
      const ground = getTerrainHeight(cx, cz) + c.clearance;
      const wantY = SURFACE_Y - c.depth / DEPTH_SCALE;
      // 이 종이 머물 수 있는 가장 얕은 수심조차 해저보다 아래라면 숨긴다
      const shallowestY = SURFACE_Y - c.band[0] / DEPTH_SCALE;
      const hide = shallowestY < ground - 3;
      if (g.visible === hide) g.visible = !hide;
      if (hide) continue;
      let cy = wantY
        + Math.sin(c.t * 0.35 + c.bobPhase) * 2.4
        + Math.sin(c.t * 0.92 + c.bobPhase * 2.3) * 0.7;
      if (cy < ground) cy = ground;
      if (cy > SURFACE_Y - 4) cy = SURFACE_Y - 4;
      const dir = c.angular >= 0 ? 1 : -1;
      const vx = -Math.sin(c.angle) * dir;
      const vz = Math.cos(c.angle) * dir;
      const speed = Math.abs(c.angular) * R;
      const vy = c.lastY === undefined || dt <= 0 ? 0 : (cy - c.lastY) / dt;
      c.lastY = cy;
      if (c.roll === undefined) { c.roll = 0; c.pitch = 0; }
      // 선회 방향 안쪽으로 몸을 기울이고(bank), 오르내릴 때 머리가 진행 방향을 따라 기운다(pitch)
      const bankWant = -dir * Math.min(0.34, 0.1 + speed * 0.016) +
        Math.sin(c.t * 0.4 + c.bobPhase) * 0.03;
      const pitchWant = Math.max(-0.3, Math.min(0.3, Math.atan2(vy, Math.max(1.2, speed)) * 0.85));
      const kk = Math.min(1, dt * 1.8);
      c.roll += (bankWant - c.roll) * kk;
      c.pitch += (pitchWant - c.pitch) * kk;
      g.position.set(cx, cy, cz);
      g.rotation.y = Math.atan2(-vx, -vz);
      g.rotation.z = c.roll;
      g.rotation.x = c.pitch;
      if (c.obj.update) c.obj.update(c.t);
    }

    // 극심해 열수구 — 1,800m 아래에서만 바닥 가까이에 모습을 드러낸다
    const ventK = clamp01((depth - 1500) / 480);
    if (ventK > 0.01 || this._ventsOn) {
      this._ventsOn = ventK > 0.01;
      for (const v of this.vents) {
        if (ventK <= 0.01) { v.visible = false; continue; }
        const vd = v.position;
        const dx = vd.x - playerPos.x;
        const dz = vd.z - playerPos.z;
        if (dx * dx + dz * dz > 320 * 320 || vd.y > playerPos.y - 2) {
          this._seedVent(v, playerPos.x, playerPos.z, playerPos.y);
        }
        const u = v.userData;
        const pulse = 0.65 + 0.35 * Math.sin(this.time * 1.7 + u.phase);
        u.ember.material.opacity = ventK * (0.45 + pulse * 0.5);
        u.cool.material.opacity = ventK * 0.32 * pulse;
        u.ember.scale.setScalar(u.emberScale * (0.85 + pulse * 0.3));
        v.visible = vd.y < playerPos.y - 2;
      }
    }

    // 하늘 돔·먼 바닥은 플레이어를 따라간다
    this.sky.position.set(playerPos.x, playerPos.y, playerPos.z);
    this.farFloor.position.set(playerPos.x, HADAL_FLOOR - 40, playerPos.z);
  }

  reset() {
    this.time = 0;
    this.setZone(0);
  }

  /**
   * 대형 관상 생물(고래·만타가오리·거북)과의 충돌 — 플레이어를 밖으로 밀어낸다.
   * 데미지는 없고, 불러준 쪽(main.js)이 충격음·카메라 흔들림을 처리한다.
   * @returns {number} 이번 호출에서 밀려난 거리 합 (0 이면 충돌 없음)
   */
  resolveCreatureCollisions(pos, radius, vel) {
    let pushed = 0;
    for (const c of this.creatures) {
      const list = c.colliders;
      if (!list || !list.length) continue;
      const g = c.obj.group;
      if (!g.visible) continue;
      const dx = pos.x - g.position.x;
      const dy = pos.y - g.position.y;
      const dz = pos.z - g.position.z;
      const cull = c.cullR || 80;
      if (dx * dx + dy * dy + dz * dz > cull * cull) continue;

      const cos = Math.cos(g.rotation.y);
      const sin = Math.sin(g.rotation.y);
      // 월드 → 생물 로컬 (y축 회전만 고려)
      let lx = dx * cos - dz * sin;
      let ly = dy;
      let lz = dx * sin + dz * cos;
      let lastX = pos.x;
      let lastY = pos.y;
      let lastZ = pos.z;

      // 구체들이 서로 겹치므로 여러 번 반복해 완전히 밖으로 내보낸다
      for (let pass = 0; pass < 3; pass++) {
        let movedThisPass = false;
        for (const s of list) {
          const ox = lx - s.x;
          const oy = ly - s.y;
          const oz = lz - s.z;
          const rr = s.r + radius;
          const d2 = ox * ox + oy * oy + oz * oz;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 0.0001;
          const nx = ox / d;
          const ny = oy / d;
          const nz = oz / d;
          const overlap = rr - d;

          // 로컬 법선 → 월드
          const wx = nx * cos + nz * sin;
          const wz = -nx * sin + nz * cos;
          pos.x += wx * overlap;
          pos.y += ny * overlap;
          pos.z += wz * overlap;

          if (vel) {
            const vn = vel.x * wx + vel.y * ny + vel.z * wz;
            if (vn < 0) {
              vel.x -= wx * vn * 1.7;
              vel.y -= ny * vn * 1.7;
              vel.z -= wz * vn * 1.7;
            }
          }

          // 같은 생물의 다음 구체도 갱신된 위치로 판정
          lx += nx * overlap;
          ly += ny * overlap;
          lz += nz * overlap;
          pushed += overlap;
          movedThisPass = true;
        }
        if (!movedThisPass) break;
      }

    }
    return pushed;
  }
}
