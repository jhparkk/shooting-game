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
  slabRockGeometry, columnRockGeometry, pebbleClusterGeometry,
  tableCoralGeometry, anemoneCoralGeometry,
  kelpGeometry, leafyPlantGeometry, grassTuftGeometry, paintGradient, paint, mulberry,
} from './models.js?v=20261117c4';
import { getTextures } from './textures.js?v=20261117c4';
import { Atmosphere } from './atmosphere.js?v=20261117c4';

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
    fog: 0x1c8a92, density: 0.0044,
    skyTop: 0xaeeae4, skyMid: 0x44b0b6, skyBottom: 0x1c8a92,
    hemiSky: 0xd8f5f2, hemiGround: 0x2b6f6a, hemi: 0.82,
    ambient: 0xa6e2e4, ambientI: 0.44,
    sun: 0xfffdf0, sunI: 2.05, glow: 1.0,
    // 밝은 산호초 팔레트 — 자연스러운 코랄 핑크·오렌지·연보라·에메랄드·황금빛.
    // 형광 원색이 아니라 햇빛 아래 실제 산호가 띠는 색으로, 개체마다 조금씩 다르다.
    coral: [
      0xe08a72, 0xd9735c, 0xe8a05a, 0xd98f9c, 0xb793c9, 0xe4c274,
      0x8fc0a5, 0xd47f8e, 0xefbf8a, 0xa98fc0, 0xe6b04e, 0x7fb8ac,
    ],
  },
  {
    name: '중층 해저 협곡',
    fog: 0x0f5d7d, density: 0.0062,
    skyTop: 0x67b8c9, skyMid: 0x1a7d9c, skyBottom: 0x0f5d7d,
    hemiSky: 0xc4e6ee, hemiGround: 0x155a63, hemi: 0.76,
    ambient: 0x86c8d8, ambientI: 0.42,
    sun: 0xfdf8ea, sunI: 1.05, glow: 0.58,
    coral: [0xc08a74, 0xa9848f, 0xb59a72, 0x8fa89c, 0xbb8f79, 0xa5968f],
  },
  {
    name: '심해 해구',
    fog: 0x082c46, density: 0.0076,
    skyTop: 0x16466f, skyMid: 0x061d33, skyBottom: 0x020810,
    hemiSky: 0x6d95c2, hemiGround: 0x08182b, hemi: 0.62,
    ambient: 0x4a6a8c, ambientI: 0.54,
    sun: 0xc8d8ff, sunI: 0.62, glow: 0.30,
    coral: [0x5a6470, 0x646b6c, 0x4f5a60, 0x5e6570, 0x566067],
  },
  {
    name: '초심해 심연',
    fog: 0x051a2e, density: 0.0132,
    skyTop: 0x0b2749, skyMid: 0x030c1d, skyBottom: 0x010306,
    hemiSky: 0x38598f, hemiGround: 0x04060e, hemi: 0.56,
    ambient: 0x273c60, ambientI: 0.48,
    sun: 0x9db8e8, sunI: 0.24, glow: 0.15,
    coral: [0x3c4652, 0x47505c, 0x384250, 0x434a54, 0x3a4450],
  },
  {
    name: '극심해 해구',
    fog: 0x020d1c, density: 0.0175,
    skyTop: 0x041230, skyMid: 0x010414, skyBottom: 0x000103,
    hemiSky: 0x1c3478, hemiGround: 0x02030a, hemi: 0.42,
    ambient: 0x1a2a54, ambientI: 0.40,
    sun: 0x8aa8dd, sunI: 0.14, glow: 0.08,
    coral: [0x333d47, 0x3b4551, 0x2f3742, 0x40444a, 0x36404c],
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
          // 지평선(수평 방향)은 안개색과 같게, 위로 갈수록 표층의 밝은 물빛
          vec3 c = mix(bottom * 0.94, mid, smoothstep(0.02, 0.46, vY));
          c = mix(c, top, smoothstep(0.44, 0.99, vY));
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

    this.rim = new THREE.DirectionalLight(0x86bcc8, 0.16);
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
      emissive: 0x0e0c0a,   // 완전히 검게 죽지 않도록 아주 옅은 산란광
    });
    /* 산호·해초는 얇은 가지라 태양을 정면으로 받지 못해 새까맣게 죽는다.
       실제 수중에서는 산란광이 안쪽까지 스며들므로 간접광을 조금 올려 준다. */
    const boostIndirect = (mat, k) => {
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <lights_fragment_end>',
          '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse *= ' + k.toFixed(2) + ';'
        );
      };
      mat.customProgramCacheKey = () => 'indirect' + k;
      return mat;
    };
    boostIndirect(this.coralMat, 3.0);
    this.kelpMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    boostIndirect(this.kelpMat, 1.25);
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
   *
   * 실사감의 핵심 두 가지
   *  1) UV 를 정점마다 상자 투영하지 않고 **월드 좌표에서 프래그먼트마다** 만든다.
   *     (예전엔 삼각형마다 투영 축이 달라져 바닥에 '그물' 무늬가 생겼다)
   *  2) 텍스처는 미세 결만 담당하고, 큰 얼룩·패치 변화는 셰이더의 월드 노이즈가
   *     만든다. 그래서 타일이 반복되는 느낌이 사라진다.
   *  여기에 텍스처 높이값의 화면 미분으로 만든 미세 노멀(요철)을 더해,
   *  탐조등이 비출 때 실제 모래알·암석 입자가 읽힌다.
   */
  _terrainMaterial() {
    const t = this.tex;
    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      map: t.sand,              // USE_MAP 만 켜 둔다 (실제 uv 는 셰이더가 만든다)
      // 넓고 센 스페큘러는 비스듬한 탐조등 아래에서 '비단'처럼 번들거린다 —
      // 젖은 암반의 좁고 약한 광택만 남긴다
      specular: 0x121a1d,
      shininess: 24,
    });
    const uni = {
      uSand: { value: t.sand },
      uCoralSand: { value: t.coralSand },
      uPebble: { value: t.pebble },
      uLimestone: { value: t.limestone },
      uRock: { value: t.rock },
      uAlgae: { value: t.algae },
      uBasalt: { value: t.basalt },
      uCaustics: { value: t.caustics },
      uMacro: { value: t.macro },
      uSandN: { value: t.sandNormal },
      uCoralSandN: { value: t.coralSandNormal },
      uPebbleN: { value: t.pebbleNormal },
      uLimestoneN: { value: t.limestoneNormal },
      uRockN: { value: t.rockNormal },
      uBasaltN: { value: t.basaltNormal },
      uTime: { value: 0 },
      uCausticI: { value: 1 },
      uDetail: { value: 1 },
      uBump: { value: 0.034 },
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
        'uniform sampler2D uSand;\nuniform sampler2D uCoralSand;\nuniform sampler2D uPebble;\n' +
        'uniform sampler2D uLimestone;\nuniform sampler2D uRock;\nuniform sampler2D uAlgae;\n' +
        'uniform sampler2D uBasalt;\nuniform sampler2D uCaustics;\nuniform sampler2D uMacro;\n' +
        'uniform float uTime;\nuniform float uCausticI;\n' +
        'uniform sampler2D uSandN;\nuniform sampler2D uCoralSandN;\nuniform sampler2D uPebbleN;\n' +
        'uniform sampler2D uLimestoneN;\nuniform sampler2D uRockN;\nuniform sampler2D uBasaltN;\n' +
        'uniform float uDetail;\nuniform float uBump;\n' +
        // 값 노이즈 — 월드 좌표 기반이라 어디서도 반복되지 않는다
        'float abyssHash(vec2 p){ p = fract(p * vec2(127.13, 311.7)); p += dot(p, p + 34.53); return fract(p.x * p.y); }\n' +
        'float abyssNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); ' +
        'float a = abyssHash(i); float b = abyssHash(i + vec2(1.0, 0.0)); float c = abyssHash(i + vec2(0.0, 1.0)); ' +
        'float d = abyssHash(i + vec2(1.0, 1.0)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }\n' +
        'float abyssFbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 3; i++) { s += abyssNoise(p) * a; p *= 2.03; a *= 0.5; } return s / 0.875; }\n' +
        shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
          vec3 wp = vWPosV;
          vec3 nw = normalize( vWNrmV );
          float up = clamp( nw.y, 0.0, 1.0 );
          // 완만한 바닥 ↔ 급한 벽면 — 경사에 따라 모래와 암반이 저절로 갈린다
          float flatK = smoothstep( 0.58, 0.86, up );

          /* ---- 월드 좌표 큰 변화 (타일 반복을 지운다) ---- */
          float m1 = abyssFbm( wp.xz * 0.016 );                 // ~60 유닛 패치
          float m2 = abyssFbm( wp.xz * 0.072 + 13.7 );          // ~14 유닛
          float m3 = abyssNoise( wp.xz * 0.29 + 5.3 );          // ~3.5 유닛

          /* ---- 지대(바이옴)를 가르는 저주파 노이즈 ----
             같은 언덕 안에서도 밝은 산호 모래 · 자갈밭 · 석회암 선반 · 이끼 암반이
             자연스럽게 갈리고, 넓은 바닥이 한 가지 질감으로만 덮이지 않는다. */
          float pCoral  = abyssFbm( wp.xz * 0.023 + 3.1 );      // 밝은 산호 모래
          float pPebble = abyssFbm( wp.xz * 0.041 + 17.3 );     // 자갈 · 조약돌 지대
          float pLime   = abyssFbm( wp.xz * 0.029 + 41.9 );     // 석회암 선반
          float pMoss   = abyssFbm( wp.xz * 0.034 + 63.7 );     // 이끼 낀 암반

          /* ---- 매크로 노이즈 : 텍스처 타일을 지우는 저주파 변조 ---- */
          vec3 mcA = texture2D( uMacro, wp.xz * 0.011 ).rgb;
          vec3 mcB = texture2D( uMacro, wp.xz * 0.047 + 0.37 ).rgb;
          vec2 warp = ( mcA.rg - 0.5 ) * 0.26;

          /* ---- 모래 : 월드 XZ 투영 (+ 노이즈 워프) ---- */
          vec2 suv = wp.xz * 0.17 / clamp( up, 0.55, 1.0 ) + warp;
          // 백사장 — 햇빛을 받아 밝다
          vec3 sandyC = texture2D( uSand, suv ).rgb * ( 0.88 + 0.26 * mcB.b );
          sandyC = mix( sandyC, sandyC * vec3( 0.94, 0.92, 0.88 ), smoothstep( 0.52, 0.88, m3 ) );
          // 옅은 분홍빛 산호 모래 — 산호 부스러기가 섞인 밝은 패치
          vec3 coralSandC = texture2D( uCoralSand, suv * 0.86 + 3.4 ).rgb * ( 1.00 + 0.24 * mcB.b );
          float coralK = smoothstep( 0.44, 0.74, pCoral + ( m2 - 0.5 ) * 0.28 ) * 0.92;
          vec3 flatC = mix( sandyC, coralSandC, coralK );
          flatC *= 0.90 + 0.20 * m2;

          /* ---- 자갈 · 조약돌 지대 — 굵은 자갈이 드러난 바닥 ---- */
          vec3 pebC = texture2D( uPebble, suv * 0.66 + 8.1 ).rgb * ( 0.86 + 0.26 * mcB.r );
          float pebK = smoothstep( 0.55, 0.82, pPebble ) * ( 0.55 + 0.45 * m3 );
          flatC = mix( flatC, pebC, pebK * 0.94 );

          /* ---- 밝은 석회암 바닥 — 마모된 판이 넓게 깔린 곳 ---- */
          vec3 limeC = texture2D( uLimestone, suv * 0.72 + 21.0 ).rgb * ( 0.94 + 0.20 * mcB.b );
          float limeK = smoothstep( 0.58, 0.86, pLime );
          flatC = mix( flatC, limeC, limeK * 0.88 );

          /* ---- 암벽 : 수직 투영 (벽면에서 늘어나지 않게 두 방향을 섞는다) ---- */
          /* 벽면 투영 — 노멀에 수직인 '수평 방향'을 축으로 삼는다.
             두 축(x,y)/(z,y)을 섞으면 대각선 벽에서 한 축이 늘어나
             빗질한 듯한 줄무늬가 생겼다. 이렇게 하면 어떤 방향의 벽이든
             늘어나지 않고, 텍스처 조회도 한 번으로 끝난다. */
          vec2 hdir = vec2( -nw.z, nw.x );
          float hlen = length( hdir );
          hdir = hlen > 1e-3 ? hdir / hlen : vec2( 1.0, 0.0 );
          vec2 ruv = vec2( dot( wp.xz, hdir ) * 0.115, wp.y * 0.15 ) + warp * 0.6;
          vec4 rA = texture2D( uRock, ruv );
          vec3 rockyC = rA.rgb;
          // 암반 위 이끼 · 해조류 — 초록빛 패치
          vec3 algaeC = texture2D( uAlgae, ruv * 0.62 + 7.0 ).rgb;
          float algaeK = smoothstep( 0.42, 0.74, pMoss ) * ( 0.5 + 0.5 * smoothstep( 0.25, 0.8, m2 ) );
          rockyC = mix( rockyC, algaeC * vec3( 0.88, 1.00, 0.86 ), algaeK * 0.62 );
          // 성긴 석회암 선반 — 층이 진 밝은 판이 벽을 가로지른다
          vec3 limeWall = texture2D( uLimestone, ruv * 0.72 + 5.5 ).rgb;
          rockyC = mix( rockyC, limeWall, smoothstep( 0.60, 0.88, pLime ) * 0.6 );
          rockyC *= 0.90 + 0.26 * mcB.r;

          /* ---- 수심이 깊으면 현무암·침전물 ---- */
          float deepK = smoothstep( -110.0, -420.0, wp.y );
          // 현무암도 벽면 축(ruv)으로 투영 — (y, x+z) 축은 경사면에서 한 방향이
          // 늘어나 탐조등 아래 '폭포' 같은 줄무늬를 만들었다
          vec2 buv = ruv * 0.72 + vec2( 0.21, 0.37 );
          vec3 basaltC = texture2D( uBasalt, buv ).rgb * ( 0.86 + 0.30 * m2 );
          // 깊은 바닥에도 밝은 퇴적물이 패치로 고인다 — 바닥이 한 색으로 죽지 않게
          vec3 deepSed = texture2D( uSand, suv * 0.9 + 11.0 ).rgb;
          float sedK = smoothstep( 0.52, 0.86, pCoral ) * 0.55;
          flatC = mix( flatC, deepSed, sedK );

          vec3 detail = mix( rockyC, flatC, flatK );
          detail = mix( detail, basaltC, deepK * 0.88 );

          // 알베도 — 햇빛 받는 모래·석회암은 밝고, 암반은 중간, 현무암은 어둡다
          detail *= mix( 1.0, 1.10, flatK );
          detail *= mix( vec3( 1.0 ), vec3( 1.03, 1.0, 0.94 ), flatK );   // 따뜻한 모래빛
          detail *= mix( 1.0, 0.82, deepK );                              // 깊은 곳은 가라앉은 톤
          detail *= mix( vec3( 1.0 ), vec3( 0.76, 0.82, 0.92 ), deepK );  // 현무암은 푸르게
          // 아주 미세한 입자 결 — 확대해도 플라스틱처럼 매끈해 보이지 않게
          detail *= 0.94 + 0.12 * m3;

          /* ---- 수중 빛무늬(caustics) : 얕은 평지에만, 넓게 번지는 빛 덩어리 ---- */
          float cFade = smoothstep( -340.0, -20.0, wp.y );
          vec2 cuv = wp.xz * 0.038;
          float ca = texture2D( uCaustics, cuv + vec2( uTime * 0.019, uTime * 0.013 ) ).r;
          float cb = texture2D( uCaustics, cuv * 1.33 + vec2( -uTime * 0.015, uTime * 0.012 ) ).r;
          float cshape = smoothstep( 0.18, 0.95, ca * 0.55 + cb * 0.65 );
          cshape = cshape * cshape;
          float cpatch = smoothstep( 0.30, 0.82, abyssFbm( wp.xz * 0.032 + 21.0 ) );
          float caustic = cshape * cpatch * cFade * ( 0.02 + 0.98 * up * up * up ) * uCausticI;
          detail *= 1.0 + caustic * 0.14;

          /* ---- 법선 요철 : 노멀맵을 지형의 투영 축에 맞춰 적용 ---- */
          vec3 nS = texture2D( uSandN, suv ).xyz * 2.0 - 1.0;
          vec3 nCS = texture2D( uCoralSandN, suv * 0.86 + 3.4 ).xyz * 2.0 - 1.0;
          vec3 nPB = texture2D( uPebbleN, suv * 0.66 + 8.1 ).xyz * 2.0 - 1.0;
          vec3 nLS = texture2D( uLimestoneN, suv * 0.72 + 21.0 ).xyz * 2.0 - 1.0;
          vec3 nR = texture2D( uRockN, ruv ).xyz * 2.0 - 1.0;
          vec3 nB = texture2D( uBasaltN, buv ).xyz * 2.0 - 1.0;
          // 평평한 바닥의 요철은 '그 바닥이 실제로 무엇인지'를 따라간다
          vec3 nFlat = mix( nS, nCS, coralK );
          nFlat = mix( nFlat, nPB, pebK * 0.94 );
          nFlat = mix( nFlat, nLS, limeK * 0.88 );
          vec3 nTan = mix( nR, nFlat, flatK );
          nTan = mix( nTan, nB, deepK * 0.88 );
          // 모래는 (X,Z) 축, 벽면은 (수평방향, Y) 축
          vec3 tngS = vec3( 1.0, 0.0, 0.0 );
          vec3 bitS = vec3( 0.0, 0.0, 1.0 );
          vec3 tngR = vec3( hdir.x, 0.0, hdir.y );
          vec3 bitR = vec3( 0.0, 1.0, 0.0 );
          vec3 tng = normalize( mix( tngR, tngS, flatK ) );
          vec3 bit = normalize( mix( bitR, bitS, flatK ) );
          vec3 nPerturb = normalize( nw + ( tng * nTan.x + bit * nTan.y ) * uBump );

          diffuseColor.rgb *= detail;
          `
        )
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
          /* 노멀맵(굽어 둔 요철)을 월드 공간에서 적용하고 뷰 공간으로 넘긴다 */
          normal = normalize( mat3( viewMatrix ) * nPerturb );
          `
        )
        .replace(
          'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;',
          `
          // 물에 젖은 표면의 비스듬한 광택 — 가장자리로 갈수록 물빛이 얇게 덮인다
          vec3 vdir = normalize( cameraPosition - vWPosV );
          float fres = pow( 1.0 - clamp( dot( normalize( vWNrmV ), vdir ), 0.0, 1.0 ), 4.0 );
          vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance
            + vec3( 0.58, 0.93, 1.0 ) * caustic * ( 0.05 + 0.07 * up )
            + vec3( 0.34, 0.68, 0.88 ) * fres * ( 0.014 + 0.035 * up );
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
    this.tpl = {
      rock: [], rockLo: [], branch: [], blob: [], tube: [], fan: [], brain: [], tuft: [],
      slab: [], column: [], pebble: [], table: [], anemone: [],
      kelp: [], leaf: [], grass: [],
    };
    // 가까운 바위는 고세그먼트(부드러운 곡면), 먼 바위는 가벼운 형상
    for (let i = 0; i < 5; i++) this.tpl.rock.push(paint(rockGeometry(1, 500 + i * 91, 2), 0xffffff));
    for (let i = 0; i < 3; i++) this.tpl.rockLo.push(paint(rockGeometry(1, 700 + i * 53, 1), 0xffffff));
    // 바위 종류 다양화 — 층진 석회암 판 · 주상 절리 기둥 · 조약돌 무리
    for (let i = 0; i < 4; i++) this.tpl.slab.push(paint(slabRockGeometry(1, 1330 + i * 61), 0xffffff));
    for (let i = 0; i < 4; i++) this.tpl.column.push(paint(columnRockGeometry(1, 1440 + i * 67), 0xffffff));
    for (let i = 0; i < 4; i++) this.tpl.pebble.push(paint(pebbleClusterGeometry(1, 1550 + i * 71), 0xffffff));
    for (let i = 0; i < 7; i++) this.tpl.branch.push(branchCoralGeometry(0xffffff, 610 + i * 37));
    for (let i = 0; i < 7; i++) this.tpl.blob.push(blobCoralGeometry(0xffffff, 720 + i * 41));
    for (let i = 0; i < 5; i++) this.tpl.tube.push(tubeCoralGeometry(0xffffff, 830 + i * 43));
    for (let i = 0; i < 6; i++) this.tpl.fan.push(fanCoralGeometry(0xffffff, 940 + i * 47));
    for (let i = 0; i < 5; i++) this.tpl.brain.push(brainCoralGeometry(0xffffff, 1050 + i * 53));
    for (let i = 0; i < 6; i++) this.tpl.tuft.push(tuftCoralGeometry(0xffffff, 1160 + i * 59));
    // 판(테이블) 산호 · 말미잘/폴립 군락
    for (let i = 0; i < 4; i++) this.tpl.table.push(tableCoralGeometry(0xffffff, 1670 + i * 73));
    for (let i = 0; i < 4; i++) this.tpl.anemone.push(anemoneCoralGeometry(0xffffff, 1780 + i * 79));
    // 수초·해초 세 가지 형태 (같은 흔들림 셰이더를 공유)
    for (let i = 0; i < 4; i++) this.tpl.kelp.push(kelpGeometry(1, 1, 1900 + i * 83));
    for (let i = 0; i < 4; i++) this.tpl.leaf.push(leafyPlantGeometry(1, 0.42, 2010 + i * 89));
    for (let i = 0; i < 4; i++) this.tpl.grass.push(grassTuftGeometry(1, 0.8, 2120 + i * 97));
    this._tint = new THREE.Color();
  }

  /** 템플릿을 복제하고 칠한다 — top 을 주면 위로 갈수록 밝아지는 그라데이션 */
  _clonePainted(tpl, color, top) {
    const g = tpl.clone();
    if (top !== undefined) return paintGradient(g, color, top);
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

        // 색은 '밝기·음영'만 담는다 — 표면의 갈색·회색은 셰이더의 월드 텍스처가 만든다
        const flatness = clamp01((uny - 0.35) / 0.55);   // 1 = 평지
        const dkRaw = clamp01((SURFACE_Y - y) / 1000);
        const dk = Math.pow(dkRaw, 0.7);
        // 간이 앰비언트 오클루전 — 골짜기(이웃보다 낮은 곳)는 어둡게, 마루는 밝게.
        // 그림자 맵 없이도 깊이감이 생긴다.
        const avgN = (hL + hR + hD + hU) * 0.25;
        const bowl = clamp01((avgN - y) / (d * 0.75));
        const ridge = clamp01((y - avgN) / (d * 0.75));
        const ao = clamp01(1.0 - bowl * 0.62 + ridge * 0.08);
        const lit = (0.70 - dk * 0.14) * (0.90 + flatness * 0.10) * ao;
        fc.setHSL(0.10, 0.015 + (1 - flatness) * 0.02, clamp01(lit));
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

    /* --- 바위 (모든 청크 · 먼 곳에서도 실루엣을 만들어 준다) ---
       수심과 지형에 따라 다른 돌이 놓인다.
       얕은 산호 지대: 조약돌 무리 · 석회암 선반 · 이끼 낀 둥근 바위 · 굴러온 바위
       중층: 층진 석회암 판과 현무암 기둥   /   심해: 주상 절리 기둥과 부서진 현무암 */
    const geos = [flatFloor];
    const rockCount = detail ? 10 : 4;
    const rockCol = new THREE.Color();
    for (let i = 0; i < rockCount; i++) {
      const lx = (rnd() - 0.5) * CHUNK * 0.94;
      const lz = (rnd() - 0.5) * CHUNK * 0.94;
      const gy = getTerrainHeight(ox + lx, oz + lz);
      const deep = gy < -150;
      const mid = gy < -32;
      const pick = rnd();
      let tpl;
      let r;
      let hue = 0.09;
      let sat = 0.06;
      let lig = 0.24;
      let flat = 1;
      if (!detail) {
        // 먼 청크 — 실루엣만 있으면 되므로 가벼운 형상
        tpl = this.tpl.rockLo[Math.floor(rnd() * this.tpl.rockLo.length)];
        r = 1.8 + rnd() * 4.6;
        lig = 0.14 + rnd() * 0.10;
        if (deep) { hue = 0.58; sat = 0.05; }
      } else if (deep) {
        // 심해 — 주상 절리 기둥과 부서진 현무암
        if (pick < 0.55) {
          tpl = this.tpl.column[Math.floor(rnd() * this.tpl.column.length)];
          r = 1.3 + rnd() * 2.4;
        } else {
          tpl = this.tpl.rock[Math.floor(rnd() * this.tpl.rock.length)];
          r = 1.2 + rnd() * 3.0;
        }
        hue = 0.58; sat = 0.05; lig = 0.13 + rnd() * 0.09;
      } else if (mid) {
        // 협곡 · 중층 — 층진 석회암 판과 굴러온 바위, 가끔 기둥
        if (pick < 0.42) {
          tpl = this.tpl.slab[Math.floor(rnd() * this.tpl.slab.length)];
          r = 1.8 + rnd() * 3.4; hue = 0.11; sat = 0.07; lig = 0.27 + rnd() * 0.10;
        } else if (pick < 0.68) {
          tpl = this.tpl.column[Math.floor(rnd() * this.tpl.column.length)];
          r = 1.2 + rnd() * 2.2; hue = 0.58; sat = 0.04; lig = 0.16 + rnd() * 0.08;
        } else {
          tpl = this.tpl.rock[Math.floor(rnd() * this.tpl.rock.length)];
          r = 1.4 + rnd() * 3.0; lig = 0.19 + rnd() * 0.10;
        }
      } else if (pick < 0.24) {
        // 얕은 바닥의 조약돌 무리 — 모래에 굴러다니는 둥근 자갈
        tpl = this.tpl.pebble[Math.floor(rnd() * this.tpl.pebble.length)];
        r = 1.4 + rnd() * 2.4; hue = 0.10; sat = 0.08; lig = 0.30 + rnd() * 0.12; flat = 0.7;
      } else if (pick < 0.48) {
        // 석회암 선반 — 햇빛 받는 밝은 판
        tpl = this.tpl.slab[Math.floor(rnd() * this.tpl.slab.length)];
        r = 1.6 + rnd() * 3.2; hue = 0.11; sat = 0.08; lig = 0.30 + rnd() * 0.12;
      } else if (pick < 0.68) {
        // 이끼 낀 둥근 바위
        tpl = this.tpl.rock[Math.floor(rnd() * this.tpl.rock.length)];
        r = 1.2 + rnd() * 2.4; hue = 0.22; sat = 0.16; lig = 0.20 + rnd() * 0.09;
      } else {
        // 굴러온 둥근 바위
        tpl = this.tpl.rock[Math.floor(rnd() * this.tpl.rock.length)];
        r = 1.0 + rnd() * 2.8; hue = 0.09; sat = 0.06; lig = 0.22 + rnd() * 0.12;
      }
      // 회갈색 현무암 ~ 이끼 낀 암반 ~ 밝은 석회암 — 원색 없이 낮은 채도로
      const geo = this._clonePainted(tpl, rockCol.setHSL(hue, sat, lig).getHex());
      const m = new THREE.Matrix4();
      m.makeRotationFromEuler(new THREE.Euler(
        (rnd() - 0.5) * 0.22, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.22
      ));
      m.scale(new THREE.Vector3(r, r * (0.8 + rnd() * 0.4) * flat, r));
      // 해저에 파묻혀 앉은 느낌 — 바닥보다 살짝 아래에 놓는다
      m.setPosition(lx, gy - r * 0.08 * flat, lz);
      geo.applyMatrix4(m);
      geos.push(geo);
    }

    /* --- 바닥에 흩어진 잔돌 · 자갈 조각 (바위 사이를 메운다) --- */
    if (detail) {
      for (let i = 0; i < 6; i++) {
        const lx = (rnd() - 0.5) * CHUNK * 0.96;
        const lz = (rnd() - 0.5) * CHUNK * 0.96;
        const gy = getTerrainHeight(ox + lx, oz + lz);
        const pebble = this.tpl.pebble[Math.floor(rnd() * this.tpl.pebble.length)];
        const sc = 0.35 + rnd() * 0.75;
        const light = gy < -60 ? 0.15 + rnd() * 0.08 : 0.24 + rnd() * 0.14;
        const hue2 = gy < -60 ? 0.58 : 0.09;
        const geo = this._clonePainted(pebble, rockCol.setHSL(hue2, 0.07, light).getHex());
        const m = new THREE.Matrix4();
        m.makeRotationY(rnd() * Math.PI * 2);
        m.scale(new THREE.Vector3(sc, sc * (0.6 + rnd() * 0.5), sc));
        m.setPosition(lx, gy - sc * 0.06, lz);
        geo.applyMatrix4(m);
        geos.push(geo);
      }
    }

    /* --- 산호초 --- */
    if (detail) {
      const coralGeos = [];
      const zone = this.zone;
      const tmpCol = new THREE.Color();
      const rockTone = new THREE.Color(0x6b6459);
      /* 같은 팔레트라도 개체마다 색이 조금씩 다르고, 바닥 암반 톤이 섞여 있다 —
         실제 산호는 한 색으로 칠한 플라스틱이 아니다 */
      const coralPick = () => {
        const base = zone.coral[Math.floor(rnd() * zone.coral.length)];
        tmpCol.set(base).lerp(rockTone, 0.02 + rnd() * 0.06);
        tmpCol.offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.10, (rnd() - 0.5) * 0.05);
        return tmpCol.getHex();
      };
      // 가지 끝·군체 위쪽은 햇빛을 받아 밝다 — 위로 갈수록 옅어지는 그라데이션
      const tipCol = new THREE.Color();
      const tipOf = (hex) => tipCol.set(hex).offsetHSL(0.004, 0.05, 0.11).getHex();

      const pickCoralTpl = (kind) => {
        if (kind < 0.24) return this.tpl.branch[Math.floor(rnd() * this.tpl.branch.length)];
        if (kind < 0.34) return this.tpl.fan[Math.floor(rnd() * this.tpl.fan.length)];
        if (kind < 0.50) return this.tpl.brain[Math.floor(rnd() * this.tpl.brain.length)];
        if (kind < 0.63) return this.tpl.blob[Math.floor(rnd() * this.tpl.blob.length)];
        if (kind < 0.72) return this.tpl.tube[Math.floor(rnd() * this.tpl.tube.length)];
        if (kind < 0.87) return this.tpl.table[Math.floor(rnd() * this.tpl.table.length)];
        return this.tpl.anemone[Math.floor(rnd() * this.tpl.anemone.length)];
      };

      for (let i = 0; i < 46; i++) {
        const lx = (rnd() - 0.5) * CHUNK * 0.94;
        const lz = (rnd() - 0.5) * CHUNK * 0.94;
        const wx = ox + lx;
        const wz = oz + lz;
        const gy = getTerrainHeight(wx, wz);
        if (gy < -34) continue;                 // 수심 90m 보다 깊은 곳에는 산호를 심지 않는다
        const slope = slopeAt(wx, wz);
        if (slope > 1.45) continue;             // 수직에 가까운 벽에는 심지 않는다
        const steep = slope > 0.7;              // 절벽 경사면 — 작고 단단한 산호 위주
        const color = coralPick();
        const tip = tipOf(color);
        const tpl = pickCoralTpl(rnd());

        // 산호 군락 — 한 자리에 1~3 개를 모아 심어 밀도를 높인다
        const clump = 1 + Math.floor(rnd() * (steep ? 2 : 3));
        for (let c = 0; c < clump; c++) {
          const dx = c === 0 ? 0 : (rnd() - 0.5) * 4.2;
          const dz = c === 0 ? 0 : (rnd() - 0.5) * 4.2;
          const cgy = c === 0 ? gy : getTerrainHeight(wx + dx, wz + dz);
          let geo = this._clonePainted(tpl, color, tip);
          if (geo.index) geo = geo.toNonIndexed();   // 바퀴·산호를 섞어 병합하려면 인덱스 여부를 통일
          const big = this.tpl.blob.indexOf(tpl) >= 0 || this.tpl.brain.indexOf(tpl) >= 0 ||
            this.tpl.table.indexOf(tpl) >= 0;
          const sc = (2.1 + rnd() * 2.7) * (steep ? 0.78 : 1.0) * (big ? 0.72 : 1.0);
          const m = new THREE.Matrix4();
          m.makeRotationY(rnd() * Math.PI * 2);
          m.scale(new THREE.Vector3(sc, sc * (0.9 + rnd() * 0.7), sc));
          m.setPosition(lx + dx, cgy + 0.08, lz + dz);
          geo.applyMatrix4(m);
          coralGeos.push(geo);
        }
      }
      // 산호 카펫 — 바닥과 경사면을 작은 산호 다발 · 말미잘로 촘촘히 덮는다
      for (let i = 0; i < 52; i++) {
        const lx = (rnd() - 0.5) * CHUNK * 0.96;
        const lz = (rnd() - 0.5) * CHUNK * 0.96;
        const wx = ox + lx;
        const wz = oz + lz;
        const gy = getTerrainHeight(wx, wz);
        if (gy < -30) continue;
        if (slopeAt(wx, wz) > 2.0) continue;
        const useAnemone = rnd() < 0.28;
        const tpl = useAnemone
          ? this.tpl.anemone[Math.floor(rnd() * this.tpl.anemone.length)]
          : this.tpl.tuft[Math.floor(rnd() * this.tpl.tuft.length)];
        const color = coralPick();
        let geo = this._clonePainted(tpl, color, tipOf(color));
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
        const cc = coralPick();
        let geo = this._clonePainted(tpl, tmpCol.set(cc).lerp(new THREE.Color(0x8d8676), 0.72).getHex());
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

    /* --- 해초 · 수초 (다시마 · 넓은잎 수초 · 가는잎 해초) --- */
    if (detail) {
      const kelpGeos = [];
      for (let i = 0; i < 44; i++) {
        const lx = (rnd() - 0.5) * CHUNK * 0.96;
        const lz = (rnd() - 0.5) * CHUNK * 0.96;
        const wx = ox + lx;
        const wz = oz + lz;
        const gy = getTerrainHeight(wx, wz);
        if (gy < -34) continue;              // 수심 90m 보다 깊은 곳에는 수초 숲이 없다
        if (slopeAt(wx, wz) > 1.35) continue;
        const depth01 = clamp01((8 - gy) / 42);          // 얕을수록 무성하다
        if (rnd() < depth01 * 0.42) continue;            // 깊어지면 성기게
        const sizeK = 1 - depth01 * 0.35;
        const kind = rnd();
        let tpl;
        let sxz;
        let sy;
        if (kind < 0.34) {
          // 다시마 — 키 큰 리본 잎
          tpl = this.tpl.kelp[Math.floor(rnd() * this.tpl.kelp.length)];
          sxz = 0.8 + rnd() * 0.7;
          sy = (3.4 + rnd() * 5.4) * sizeK;
        } else if (kind < 0.66) {
          // 넓은잎 수초 — 로제트처럼 퍼지는 잎 군락
          tpl = this.tpl.leaf[Math.floor(rnd() * this.tpl.leaf.length)];
          sxz = 1.1 + rnd() * 1.3;
          sy = (1.6 + rnd() * 2.4) * sizeK;
        } else {
          // 가는잎 해초 — 촘촘히 솟은 잎
          tpl = this.tpl.grass[Math.floor(rnd() * this.tpl.grass.length)];
          sxz = 1.0 + rnd() * 1.1;
          sy = (1.3 + rnd() * 2.3) * sizeK;
        }
        // 군락 — 같은 자리에 몇 포기씩 모아 심어 숲처럼 보이게
        const n = kind < 0.34 ? 2 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const geo = tpl.clone();           // 템플릿의 초록 그라데이션 색을 그대로 쓴다
          const m = new THREE.Matrix4();
          m.makeRotationY(rnd() * Math.PI * 2);
          const jx = (rnd() - 0.5) * 3.2;
          const jz = (rnd() - 0.5) * 3.2;
          m.scale(new THREE.Vector3(sxz * (0.8 + rnd() * 0.45), sy * (0.7 + rnd() * 0.55), sxz * (0.8 + rnd() * 0.45)));
          m.setPosition(lx + jx, getTerrainHeight(wx + jx, wz + jz) - 0.25, lz + jz);
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
    // 산호초를 따라 가까이 헤엄치게 — 너무 멀면 작은 점으로만 보인다
    const dist = 38 + rnd() * 88;
    const cx = px + Math.cos(ang) * dist;
    const cz = pz + Math.sin(ang) * dist;
    const gy = getTerrainHeight(cx, cz);
    school.center.set(
      cx,
      gy < -12 ? Math.max(gy + 16, -20) : gy + 7 + rnd() * 9,
      cz
    );
    school.radius = 16 + rnd() * 30;
    school.seeded = true;
  }

  _buildSchools() {
    const rnd = mulberry(918);
    this._schoolRnd = rnd;
    /* 어종이 다른 떼가 섞여 헤엄친다 — 은빛+주황 지느러미, 파랑, 노랑, 코랄, 줄무늬 */
    const plan = [
      { kind: 'silver', count: 30, scale: 1.15 },
      { kind: 'silver', count: 26, scale: 1.0 },
      { kind: 'tang', count: 28, scale: 1.15 },
      { kind: 'yellow', count: 26, scale: 1.05 },
      { kind: 'coral', count: 34, scale: 0.9 },
      { kind: 'striped', count: 24, scale: 1.25 },
      { kind: 'silver', count: 30, scale: 1.05 },
      { kind: 'tang', count: 26, scale: 1.0 },
      { kind: 'yellow', count: 24, scale: 0.95 },
      { kind: 'coral', count: 30, scale: 0.85 },
    ];
    for (let s = 0; s < plan.length; s++) {
      const cfg = plan[s];
      const count = cfg.count;
      const inst = makeFishSchool(count, cfg.kind);
      const school = {
        kind: cfg.kind,
        mesh: inst,
        offsets: [],
        center: new THREE.Vector3(),
        radius: 16 + rnd() * 30,
        angle: rnd() * 6.28,
        angular: (0.05 + rnd() * 0.09) * (rnd() > 0.5 ? 1 : -1),
        bob: rnd() * 6.28,
        scale: cfg.scale * (0.95 + rnd() * 0.2),
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
    // 색은 정점 색(밝기)·텍스처·조명이 만든다 — 재질 색은 중립으로 둔다
    this.floorMats.forEach((m) => m.color.setHex(0xffffff));
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
        scl.setScalar(o.s * s.scale * 0.85);
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
