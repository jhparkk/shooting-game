/* =========================================================
   ABYSS DIVER — 무한히 이어지는 바다
   · 고정 아레나·외곽 벽 없이 (x, z) 어디서나 이어지는 절차적 해저
   · 플레이어를 중심으로 청크(3D 타일)를 실시간 생성·재활용하는 스트리밍
   · 멀어진 청크는 geometry 를 dispose 하고 재사용 풀로 돌려 메모리를 유지
   ========================================================= */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  makeWhale, makeManta, makeTurtle, makeFishSchool, glowTexture,
  rockGeometry, branchCoralGeometry, blobCoralGeometry, tubeCoralGeometry,
  kelpGeometry, paint, mulberry,
} from './models.js?v=20261115d';

export const SURFACE_Y = 34;
export const FLOOR_Y = -50;   // 해구 바닥 (수심 약 113m)
export const BANK_Y = 21;     // 산호 언덕 봉우리 (수심 약 18m)
export const SHELF_Y = 9;     // 산호 지대 평지 (수심 약 34m)

/** 수심(m) 환산 계수 — 월드 1단위 = 1.35m */
export const DEPTH_SCALE = 1.35;

/* 수심 구간별 물빛 — 얕은 산호 언덕 → 해저 협곡 → 심해 해구 */
export const ZONES = [
  {
    name: '산호 언덕',
    fog: 0x39c6bb, density: 0.0042,
    skyTop: 0xbdf9ef, skyMid: 0x35b2b6, skyBottom: 0x0a5f74,
    hemiSky: 0xd9fffb, hemiGround: 0x2f8f86, hemi: 0.95,
    ambient: 0x9ff0e8, ambientI: 0.5,
    sun: 0xfffbee, sunI: 1.5,
    coral: [0xff8a72, 0xffbe5c, 0xef86e0, 0xffa8cf, 0xfff07a, 0x86efd8],
  },
  {
    name: '해저 협곡',
    fog: 0x1e93c8, density: 0.0064,
    skyTop: 0x9fe6ff, skyMid: 0x1c7fb8, skyBottom: 0x063f6e,
    hemiSky: 0xd2f6ff, hemiGround: 0x1a708c, hemi: 0.8,
    ambient: 0x8fe0f5, ambientI: 0.44,
    sun: 0xfdf8ec, sunI: 1.2,
    coral: [0xe07a9a, 0xe0a255, 0xb884e8, 0x7fc2d8, 0xc47a68],
  },
  {
    name: '심해 해구',
    fog: 0x0a2a72, density: 0.0105,
    skyTop: 0x2f6bc0, skyMid: 0x0d2f6e, skyBottom: 0x020a20,
    hemiSky: 0x6fa8ff, hemiGround: 0x081a3a, hemi: 0.5,
    ambient: 0x3f6cc0, ambientI: 0.32,
    sun: 0xd8e8ff, sunI: 0.55,
    coral: [0x6fa8ff, 0x9fd8ff, 0xb08fff, 0x5fe0d0, 0x7f94ff],
  },
];

/* 물빛이 바뀌는 수심(m) 경계 */
export const ZONE_DEPTHS = [38, 72];
/** 물빛 그라디언트가 완료되는 수심 */
const DEPTH_GRADIENT_END = 95;

/* 대형 관상 생물의 충돌체 설정
   radius: 가장 긴 축 길이 대비 구체 반지름
   n: 가장 긴 축 방향 구체 개수, m: 두 번째 축 방향 구체 개수(있으면 그리드) */
const CREATURE_COLLIDER = {
  whale: { radius: 0.16, n: 4 },
  manta: { radius: 0.13, n: 3, m: 2 },   // 납작하고 넓은 가오리는 앞뒤 두 줄로 덮는다
  turtle: { radius: 0.4, n: 2 },
};

export function zoneIndexForDepth(depth) {
  return depth < ZONE_DEPTHS[0] ? 0 : depth < ZONE_DEPTHS[1] ? 1 : 2;
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

/**
 * 해저 높이 (월드 y) — 모든 (x, z) 에서 연속. 경계 없음.
 *  · 산호 언덕 봉우리 y≈21 → 수심 약 18m
 *  · 산호 지대 평지   y≈-5~9 → 수심 약 34~53m
 *  · 해저 협곡 바닥   y≈-50   → 수심 약 113m
 * 수심(m) = (SURFACE_Y - y) * DEPTH_SCALE
 */
export function getTerrainHeight(x, z) {
  const hill = smoothstep(-0.35, 0.75, terrainNoise(x, z));
  const shelf = SHELF_Y - 14 * (0.5 + 0.5 * Math.tanh(basinNoise(x, z) * 1.6))
    + swellNoise(x, z) * 5.5;
  let h = shelf + hill * (BANK_Y - shelf);
  h += terrainNoise(x * 2.7, z * 2.7) * 0.9;

  const v = trenchStrength(x, z);
  const deep = FLOOR_Y +
    5 * Math.sin(x * 0.05) * Math.cos(z * 0.047) +
    2.5 * Math.sin((x + z) * 0.03);
  h = h * (1 - v) + deep * v;
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
    this._buildRays();
    this._buildParticles();
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
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying float vY;
        void main() {
          vY = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 mid;
        uniform vec3 bottom;
        varying float vY;
        void main() {
          float t = clamp(vY * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(bottom, mid, smoothstep(0.24, 0.55, t));
          c = mix(c, top, smoothstep(0.54, 1.0, t));
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
    this.rockMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.coralMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
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

  /* ---------------- 지형 소품 템플릿 (한 번만 만들어 재사용) ---------------- */
  _buildTemplates() {
    this.tpl = { rock: [], branch: [], blob: [], tube: [] };
    for (let i = 0; i < 5; i++) this.tpl.rock.push(paint(rockGeometry(1, 500 + i * 91), 0xffffff));
    for (let i = 0; i < 7; i++) this.tpl.branch.push(branchCoralGeometry(0xffffff, 610 + i * 37));
    for (let i = 0; i < 7; i++) this.tpl.blob.push(blobCoralGeometry(0xffffff, 720 + i * 41));
    for (let i = 0; i < 5; i++) this.tpl.tube.push(tubeCoralGeometry(0xffffff, 830 + i * 43));
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
    const geo = new THREE.CircleGeometry(1500, 32);
    geo.rotateX(-Math.PI / 2);
    this.farMat = new THREE.MeshBasicMaterial({ color: this.zone.fog, fog: true, depthWrite: true });
    this.farFloor = new THREE.Mesh(geo, this.farMat);
    this.farFloor.position.y = FLOOR_Y - 26;
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
        const n =
          Math.sin(wx * 0.15 + wz * 0.07) * 0.5 +
          Math.cos(wz * 0.13 - wx * 0.09) * 0.5;
        const kk = clamp01((n + 1.15) / 2.3);
        const dk = clamp01((SURFACE_Y - y) / 90);
        fc.setHSL(0.38 + dk * 0.22 - kk * 0.04, 0.52 - dk * 0.18, 0.3 - dk * 0.17 + kk * 0.05);
        vcol[k3] = fc.r;
        vcol[k3 + 1] = fc.g;
        vcol[k3 + 2] = fc.b;
        const hL = hAt(i - 1, j);
        const hR = hAt(i + 1, j);
        const hD = hAt(i, j - 1);
        const hU = hAt(i, j + 1);
        const nx = hL - hR;
        const ny = 2 * d;
        const nz = hD - hU;
        const len = Math.hypot(nx, ny, nz) || 1;
        vnor[k3] = nx / len;
        vnor[k3 + 1] = ny / len;
        vnor[k3 + 2] = nz / len;
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
          fuv[o12] = ((order[t] % N) / SEG);
          fuv[o12 + 1] = (Math.floor(order[t] / N) / SEG);
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
      const geo = this._clonePainted(tpl, rockCol.setHSL(0.36, 0.16, g).getHex());
      const m = new THREE.Matrix4();
      m.makeRotationY(rnd() * Math.PI * 2);
      m.scale(new THREE.Vector3(r, r, r));
      m.setPosition(lx, getTerrainHeight(ox + lx, oz + lz) + r * 0.16, lz);
      geo.applyMatrix4(m);
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
          geos.push(geo);
        }
      }
    }

    const terrainGeo = mergeGeometries(geos, false);
    rec.terrain.geometry = terrainGeo;
    terrainGeo.computeBoundingSphere();

    /* --- 산호 --- */
    if (detail) {
      const coralGeos = [];
      const zone = this.zone;
      for (let i = 0; i < 26; i++) {
        const lx = (rnd() - 0.5) * CHUNK * 0.92;
        const lz = (rnd() - 0.5) * CHUNK * 0.92;
        const wx = ox + lx;
        const wz = oz + lz;
        const gy = getTerrainHeight(wx, wz);
        if (gy < -3) continue;                 // 깊은 골짜기 바닥에는 산호를 심지 않는다
        if (slopeAt(wx, wz) > 0.85) continue;  // 급한 벽에도 심지 않는다
        const color = zone.coral[Math.floor(rnd() * zone.coral.length)];
        const kind = rnd();
        let tpl;
        if (kind < 0.45) tpl = this.tpl.branch[Math.floor(rnd() * this.tpl.branch.length)];
        else if (kind < 0.78) tpl = this.tpl.blob[Math.floor(rnd() * this.tpl.blob.length)];
        else tpl = this.tpl.tube[Math.floor(rnd() * this.tpl.tube.length)];
        const geo = this._clonePainted(tpl, color);
        const sc = 2.0 + rnd() * 3.0;
        const m = new THREE.Matrix4();
        m.makeRotationY(rnd() * Math.PI * 2);
        m.scale(new THREE.Vector3(sc, sc * (0.9 + rnd() * 0.7), sc));
        m.setPosition(lx, gy + 0.1, lz);
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
      for (let i = 0; i < 13; i++) {
        const lx = (rnd() - 0.5) * CHUNK * 0.94;
        const lz = (rnd() - 0.5) * CHUNK * 0.94;
        const wx = ox + lx;
        const wz = oz + lz;
        const gy = getTerrainHeight(wx, wz);
        if (gy < 2) continue;              // 해초 숲은 얕은 언덕에만
        if (slopeAt(wx, wz) > 0.7) continue;
        const h = 4 + rnd() * 9;
        const w = 0.7 + rnd() * 0.7;
        const geo = kelpGeometry(h, w, 300 + seed * 13 + i);
        const m = new THREE.Matrix4();
        m.makeRotationY(rnd() * Math.PI * 2);
        m.setPosition(lx, gy - 0.3, lz);
        geo.applyMatrix4(m);
        kelpGeos.push(geo);
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

  /* ---------------- 빛줄기 ---------------- */
  _buildRays() {
    this.rayTex = streakTexture();
    this.rays = [];
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.rayTex,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        color: 0xe8fffb,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(18 + Math.random() * 24, 130), mat);
      m.position.set(
        (Math.random() - 0.5) * 340,
        SURFACE_Y - 46 + Math.random() * 20,
        (Math.random() - 0.5) * 340
      );
      m.rotation.z = (Math.random() - 0.5) * 0.3;
      m.rotation.y = Math.random() * Math.PI;
      m.userData.phase = Math.random() * 6.28;
      this.scene.add(m);
      this.rays.push(m);
    }
  }

  /* ---------------- 부유물 ---------------- */
  _buildParticles() {
    const bubbleCount = 320;
    const bGeo = new THREE.BufferGeometry();
    const bp = new Float32Array(bubbleCount * 3);
    this.bubbleData = [];
    for (let i = 0; i < bubbleCount; i++) {
      bp[i * 3] = (Math.random() - 0.5) * 320;
      bp[i * 3 + 1] = FLOOR_Y + Math.random() * (SURFACE_Y - FLOOR_Y);
      bp[i * 3 + 2] = (Math.random() - 0.5) * 320;
      this.bubbleData.push({ rise: 0.7 + Math.random() * 2.0, sway: Math.random() * 6.28 });
    }
    bGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    this.bubbles = new THREE.Points(
      bGeo,
      new THREE.PointsMaterial({
        map: bubbleTexture(), size: 0.9, transparent: true, opacity: 0.6,
        depthWrite: false, sizeAttenuation: true, color: 0xeaffff,
        blending: THREE.NormalBlending,
      })
    );
    this.bubbles.frustumCulled = false;
    this.scene.add(this.bubbles);

    const snowCount = 520;
    const sGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(snowCount * 3);
    for (let i = 0; i < snowCount; i++) {
      sp[i * 3] = (Math.random() - 0.5) * 320;
      sp[i * 3 + 1] = FLOOR_Y + Math.random() * (SURFACE_Y - FLOOR_Y);
      sp[i * 3 + 2] = (Math.random() - 0.5) * 320;
    }
    sGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(
      sGeo,
      new THREE.PointsMaterial({
        map: glowTexture(), size: 0.7, transparent: true, opacity: 0.5,
        depthWrite: false, sizeAttenuation: true, color: 0xf2ffff,
        blending: THREE.AdditiveBlending,
      })
    );
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);

    // 관상 플랑크톤 (수심에 따라 반짝임)
    const PLAN_N = 190;
    const plGeo = new THREE.BufferGeometry();
    const plp = new Float32Array(PLAN_N * 3);
    const plc = new Float32Array(PLAN_N * 3);
    const col = new THREE.Color();
    for (let i = 0; i < PLAN_N; i++) {
      plp[i * 3] = (Math.random() - 0.5) * 320;
      plp[i * 3 + 1] = FLOOR_Y + Math.random() * (SURFACE_Y - FLOOR_Y);
      plp[i * 3 + 2] = (Math.random() - 0.5) * 320;
      col.setHSL(0.47 + Math.random() * 0.16, 0.9, 0.68);
      plc[i * 3] = col.r;
      plc[i * 3 + 1] = col.g;
      plc[i * 3 + 2] = col.b;
    }
    plGeo.setAttribute('position', new THREE.BufferAttribute(plp, 3));
    plGeo.setAttribute('color', new THREE.BufferAttribute(plc, 3));
    this.plankton = new THREE.Points(
      plGeo,
      new THREE.PointsMaterial({
        map: glowTexture(), size: 1.6, transparent: true, opacity: 0.7,
        depthWrite: false, sizeAttenuation: true, vertexColors: true,
        blending: THREE.AdditiveBlending,
      })
    );
    this.plankton.frustumCulled = false;
    this.scene.add(this.plankton);
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
    for (let s = 0; s < 6; s++) {
      const count = 24;
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
    const cfg = CREATURE_COLLIDER[kind] || CREATURE_COLLIDER.whale;
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

  _buildCreatures() {
    const rnd = mulberry(3131);
    const plan = [
      { kind: 'whale', radius: 112, y: 22, scale: 1.6, angular: 0.035 },
      { kind: 'whale', radius: 140, y: 28, scale: 1.35, angular: -0.026 },
      { kind: 'manta', radius: 104, y: 16, scale: 1.7, angular: 0.055 },
      { kind: 'manta', radius: 132, y: 12, scale: 1.4, angular: -0.05 },
      { kind: 'turtle', radius: 88, y: 12, scale: 1.0, angular: 0.08 },
      { kind: 'turtle', radius: 108, y: 15, scale: 1.2, angular: -0.07 },
    ];
    for (const p of plan) {
      let obj;
      if (p.kind === 'whale') obj = makeWhale();
      else if (p.kind === 'manta') obj = makeManta();
      else obj = makeTurtle();
      const c = {
        kind: p.kind,
        obj,
        t: rnd() * 6.28,
        center: new THREE.Vector3((rnd() - 0.5) * 60, p.y, (rnd() - 0.5) * 60),
        radius: p.radius,
        angle: rnd() * 6.28,
        angular: p.angular,
        y: p.y,
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
  update(dt, playerPos) {
    this.time += dt;
    this.kelpUniform.value = this.time;

    // 청크 스트리밍
    this._streamChunks(playerPos);

    // 수심에 따른 물빛 전환 — 얕은 에메랄드에서 깊은 코발트로
    const depth = Math.max(0, (SURFACE_Y - playerPos.y) * DEPTH_SCALE);
    const t = clamp01(depth / DEPTH_GRADIENT_END);
    this.depthT = t;
    this.zoneIndex = zoneIndexForDepth(depth);
    let a = 0;
    let b = 1;
    let u;
    const split = 0.55;
    if (t < split) {
      a = 0; b = 1; u = t / split;
    } else {
      a = 1; b = 2; u = (t - split) / (1 - split);
    }
    u = u * u * (3 - 2 * u);
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

    // 빛줄기 살랑임 + 플레이어 주변으로 재배치
    for (const r of this.rays) {
      r.material.opacity = 0.22 + Math.sin(this.time * 0.7 + r.userData.phase) * 0.08;
      r.rotation.z = Math.sin(this.time * 0.12 + r.userData.phase) * 0.08;
      const dx = r.position.x - playerPos.x;
      const dz = r.position.z - playerPos.z;
      if (dx * dx + dz * dz > 340 * 340) {
        r.position.x = playerPos.x + (Math.random() - 0.5) * 320;
        r.position.z = playerPos.z + (Math.random() - 0.5) * 320;
      }
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
        ba[i * 3 + 1] = Math.max(playerPos.y - 40, FLOOR_Y) + Math.random() * 30;
        ba[i * 3] = playerPos.x + (Math.random() - 0.5) * 300;
        ba[i * 3 + 2] = playerPos.z + (Math.random() - 0.5) * 300;
      }
    }
    bpos.needsUpdate = true;

    // 부유물은 플레이어 주변으로 재배치
    const spos = this.snow.geometry.attributes.position;
    const sa = spos.array;
    for (let i = 0; i < sa.length; i += 3) {
      sa[i + 1] -= dt * 0.25;
      sa[i] += Math.sin(this.time * 0.4 + i) * dt * 0.2;
      if (sa[i + 1] < FLOOR_Y) sa[i + 1] = SURFACE_Y;
      const dx = sa[i] - playerPos.x;
      const dz = sa[i + 2] - playerPos.z;
      if (dx * dx + dz * dz > 240 * 240) {
        sa[i] = playerPos.x + (Math.random() - 0.5) * 260;
        sa[i + 1] = playerPos.y + (Math.random() - 0.5) * 60;
        sa[i + 2] = playerPos.z + (Math.random() - 0.5) * 260;
      }
    }
    spos.needsUpdate = true;

    const ppos = this.plankton.geometry.attributes.position;
    const pa = ppos.array;
    for (let i = 0; i < pa.length; i += 3) {
      pa[i] += Math.sin(this.time * 0.5 + i) * dt * 0.5;
      pa[i + 1] += Math.cos(this.time * 0.4 + i * 0.5) * dt * 0.4;
      const dx = pa[i] - playerPos.x;
      const dy = pa[i + 1] - playerPos.y;
      const dz = pa[i + 2] - playerPos.z;
      if (dx * dx + dy * dy + dz * dz > 200 * 200) {
        pa[i] = playerPos.x + (Math.random() - 0.5) * 220;
        pa[i + 1] = playerPos.y + (Math.random() - 0.5) * 50;
        pa[i + 2] = playerPos.z + (Math.random() - 0.5) * 220;
      }
    }
    ppos.needsUpdate = true;

    // 물고기 떼 (원형 유영) — 무한 바다이므로 플레이어를 따라 새로 자리잡는다
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const s of this.schools) {
      const far = Math.hypot(s.center.x - playerPos.x, s.center.z - playerPos.z) > 250;
      if (far) this._seedSchool(s, s.rnd, playerPos.x, playerPos.z);
      s.angle += s.angular * dt;
      const cx = s.center.x + Math.cos(s.angle) * s.radius;
      const cz = s.center.z + Math.sin(s.angle) * s.radius;
      const cy = s.center.y + Math.sin(this.time * 0.5 + s.bob) * 3.5;
      const heading = Math.atan2(-Math.sin(s.angle) * Math.sign(s.angular), Math.cos(s.angle) * Math.sign(s.angular));
      for (let i = 0; i < s.offsets.length; i++) {
        const o = s.offsets[i];
        pos.set(
          cx + o.x + Math.sin(this.time * 1.1 + o.p) * 1.1,
          cy + o.y + Math.cos(this.time * 1.4 + o.p) * 0.6,
          cz + o.z + Math.cos(this.time * 1.1 + o.p) * 1.4
        );
        q.setFromAxisAngle(yAxis, heading + Math.PI + Math.sin(this.time * 2 + o.p) * 0.2);
        scl.setScalar(o.s * s.scale * 0.55);
        m.compose(pos, q, scl);
        s.mesh.setMatrixAt(i, m);
      }
      s.mesh.instanceMatrix.needsUpdate = true;
    }

    // 대형 생물
    for (const c of this.creatures) {
      c.t += dt;
      c.angle += c.angular * dt;
      const far = Math.hypot(
        c.center.x + Math.cos(c.angle) * c.radius - playerPos.x,
        c.center.z + Math.sin(c.angle) * c.radius - playerPos.z
      ) > 300;
      if (far) {
        const ang = c.rnd() * Math.PI * 2;
        const dist = 120 + c.rnd() * 120;
        c.center.set(playerPos.x + Math.cos(ang) * dist, c.y, playerPos.z + Math.sin(ang) * dist);
        c.seeded = true;
      }
      const g = c.obj.group;
      const R = c.radius;
      const cx = c.center.x + Math.cos(c.angle) * R;
      const cz = c.center.z + Math.sin(c.angle) * R;
      const ground = getTerrainHeight(cx, cz) + 7;
      const cy = Math.max(
        c.center.y + Math.sin(c.t * 0.35 + c.bobPhase) * 2.4,
        ground
      );
      const vx = -Math.sin(c.angle) * Math.sign(c.angular);
      const vz = Math.cos(c.angle) * Math.sign(c.angular);
      g.position.set(cx, cy, cz);
      g.rotation.y = Math.atan2(-vx, -vz);
      g.rotation.z = Math.sin(c.t * 0.5) * 0.08;

      if (c.kind === 'whale') {
        c.obj.fluke.rotation.x = Math.sin(c.t * 0.85 + c.bobPhase) * 0.45;
        c.obj.fluke.rotation.z = Math.sin(c.t * 0.4) * 0.08;
        c.obj.fins.forEach((f, fi) => {
          f.rotation.y = (fi === 0 ? 1 : -1) * (0.5 + Math.sin(c.t * 0.7 + c.bobPhase) * 0.12);
        });
      } else if (c.kind === 'manta') {
        const flap = Math.sin(c.t * 1.7 + c.bobPhase) * 0.6;
        c.obj.wingL.rotation.z = flap;
        c.obj.wingR.rotation.z = -flap;
        c.obj.tail.rotation.z = Math.sin(c.t * 1.2) * 0.14;
      } else {
        c.obj.flippers.forEach((f) => {
          f.rotation.z = f.userData.base + Math.sin(c.t * 1.5 + f.userData.phase) * 0.45;
        });
      }
    }

    // 하늘 돔·먼 바닥은 플레이어를 따라간다
    this.sky.position.set(playerPos.x, 0, playerPos.z);
    this.farFloor.position.set(playerPos.x, FLOOR_Y - 26, playerPos.z);
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
