/* =========================================================
   ABYSS DIVER — 밝은 열대 바다의 자유 탐험 공간
   고정된 3D 아레나(해저 지형 · 산호초 · 바위 아치 · 빛줄기)
   플레이어가 직접 앞/뒤/좌/우/상/하로 유영한다.
   ========================================================= */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  makeWhale, makeManta, makeTurtle, makeFishSchool, glowTexture,
  rockGeometry, branchCoralGeometry, blobCoralGeometry, tubeCoralGeometry,
  kelpGeometry, paint, mulberry,
} from './models.js';

export const SURFACE_Y = 34;
export const FLOOR_Y = -50;   // 해구 바닥 (수심 약 113m)
export const BANK_Y = 21;     // 산호 언덕 봉우리 (수심 약 18m)
export const SHELF_Y = 9;     // 산호 지대 평지 (수심 약 34m)
export const RIM_Y = 18;      // 아레나 외곽의 얕은 암벽
export const ARENA = 168;

/** 수심(m) 환산 계수 — 월드 1단위 = 1.35m */
export const DEPTH_SCALE = 1.35;

/* 수심 구간별 물빛 — 얕은 산호 언덕 → 해저 협곡 → 심해 해구 */
export const ZONES = [
  {
    name: '산호 언덕',
    fog: 0x49d8c4, density: 0.0036,
    skyTop: 0xc4fff4, skyMid: 0x3fc0c2, skyBottom: 0x0a6b7e,
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

export function zoneIndexForDepth(depth) {
  return depth < ZONE_DEPTHS[0] ? 0 : depth < ZONE_DEPTHS[1] ? 1 : 2;
}

const CHUNKS = 3;
const CHUNK_SIZE = (ARENA * 2) / CHUNKS;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/** 낮은 주파수 지형 노이즈 (사인 합성 — 청크 경계에서도 연속) */
function terrainNoise(x, z) {
  return (
    Math.sin(x * 0.017 + Math.cos(z * 0.013) * 1.7) * 0.55 +
    Math.cos(z * 0.021 + Math.sin(x * 0.011) * 1.3) * 0.45 +
    Math.sin((x + z) * 0.009) * 0.35 +
    Math.sin(x * 0.043 + z * 0.031) * 0.22
  );
}

/** 넓은 범위의 함몰/융기 (평지 수심을 40~55m 사이로 흔든다) */
function basinNoise(x, z) {
  return (
    Math.sin(x * 0.0072 + 0.8) * Math.cos(z * 0.0061 - 0.4) +
    0.6 * Math.sin((x + z) * 0.0045 + 2.1)
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
 * 해저 높이 (월드 y)
 *  · 산호 언덕 봉우리 y≈21 → 수심 약 18m
 *  · 산호 지대 평지   y≈-5~9 → 수심 약 34~53m
 *  · 해저 협곡 바닥   y≈-50   → 수심 약 113m
 * 수심(m) = (SURFACE_Y - y) * DEPTH_SCALE
 */
export function getTerrainHeight(x, z) {
  const hill = smoothstep(-0.35, 0.75, terrainNoise(x, z));
  const shelf = SHELF_Y - 14 * (0.5 + 0.5 * Math.tanh(basinNoise(x, z) * 1.6));
  let h = shelf + hill * (BANK_Y - shelf);
  h += terrainNoise(x * 2.7, z * 2.7) * 0.9;

  const v = trenchStrength(x, z);
  const deep = FLOOR_Y +
    5 * Math.sin(x * 0.05) * Math.cos(z * 0.047) +
    2.5 * Math.sin((x + z) * 0.03);
  h = h * (1 - v) + deep * v;

  // 아레나 바깥은 얕은 암벽으로 둘러싼다
  const rim = smoothstep(ARENA * 0.70, ARENA * 0.97, Math.max(Math.abs(x), Math.abs(z)));
  return h + (RIM_Y - h) * rim;
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

    this._buildSky();
    this._buildLights();
    this._buildFloor();
    this._buildArches();
    this._buildRays();
    this._buildParticles();
    this._buildSchools();
    this._buildCreatures();
    this.setZone(0);
  }

  /* ---------------- 물빛 하늘 ---------------- */
  _buildSky() {
    const geo = new THREE.SphereGeometry(420, 32, 20);
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

  /* ---------------- 해저 ---------------- */
  _buildFloor() {
    this.chunks = [];
    const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const coralMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const kelpMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const kelpTime = this.kelpUniform;
    kelpMat.onBeforeCompile = (shader) => {
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
    this.floorMats = [rockMat, coralMat, kelpMat];
    const zone = this.zone;

    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const ox = -ARENA + cx * CHUNK_SIZE + CHUNK_SIZE / 2;
        const oz = -ARENA + cz * CHUNK_SIZE + CHUNK_SIZE / 2;
        const seed = cx * 31 + cz * 17 + 7;
        const rnd = mulberry(seed * 131 + 3);
        const group = new THREE.Group();
        group.position.set(ox, 0, oz);

        /* 바닥 */
        const floorGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 32, 32);
        floorGeo.rotateX(-Math.PI / 2);
        const fp = floorGeo.attributes.position;
        const fcol = new Float32Array(fp.count * 3);
        const fc = new THREE.Color();
        for (let i = 0; i < fp.count; i++) {
          const wx = fp.getX(i) + ox;
          const wz = fp.getZ(i) + oz;
          const y = terrainHeight(wx, wz);
          fp.setY(i, y);
          const n =
            Math.sin(wx * 0.15 + wz * 0.07) * 0.5 +
            Math.cos(wz * 0.13 - wx * 0.09) * 0.5;
          const k = clamp01((n + 1.15) / 2.3);
          // 깊을수록 모래빛에서 차가운 푸른 빛으로, 어둡게
          const dk = clamp01((SURFACE_Y - y) / 90);
          fc.setHSL(0.40 + dk * 0.2 - k * 0.03, 0.44 - dk * 0.14, 0.34 - dk * 0.19 + k * 0.05);
          fcol[i * 3] = fc.r;
          fcol[i * 3 + 1] = fc.g;
          fcol[i * 3 + 2] = fc.b;
        }
        // 청크 경계에서도 이어지는 해석적 노멀
        const nrm = floorGeo.attributes.normal;
        const eps = 0.6;
        for (let i = 0; i < fp.count; i++) {
          const wx = fp.getX(i) + ox;
          const wz = fp.getZ(i) + oz;
          const hL = terrainHeight(wx - eps, wz);
          const hR = terrainHeight(wx + eps, wz);
          const hD = terrainHeight(wx, wz - eps);
          const hU = terrainHeight(wx, wz + eps);
          const nx = hL - hR;
          const ny = 2 * eps;
          const nz = hD - hU;
          const len = Math.hypot(nx, ny, nz) || 1;
          nrm.setXYZ(i, nx / len, ny / len, nz / len);
        }
        floorGeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
        group.add(new THREE.Mesh(floorGeo, rockMat));

        /* 바위 + 산호 + 해초 */
        const rockGeos = [];
        const coralGeos = [];
        const kelpGeos = [];
        for (let i = 0; i < 22; i++) {
          const lx = (rnd() - 0.5) * CHUNK_SIZE * 0.95;
          const lz = (rnd() - 0.5) * CHUNK_SIZE * 0.95;
          const r = 1.0 + rnd() * 2.6;
          const geo = rockGeometry(r, 900 + seed * 13 + i);
          const m = new THREE.Matrix4();
          m.makeRotationY(rnd() * Math.PI * 2);
          m.setPosition(lx, terrainHeight(ox + lx, oz + lz) + r * 0.15, lz);
          geo.applyMatrix4(m);
          const g = 0.2 + rnd() * 0.14;
          paint(geo, new THREE.Color().setHSL(0.36, 0.16, g).getHex());
          rockGeos.push(geo);
        }
        for (let i = 0; i < 44; i++) {
          const lx = (rnd() - 0.5) * CHUNK_SIZE * 0.92;
          const lz = (rnd() - 0.5) * CHUNK_SIZE * 0.92;
          const wx = ox + lx;
          const wz = oz + lz;
          const gy = terrainHeight(wx, wz);
          // 깊은 골짜기 바닥과 급한 벽에는 산호를 심지 않는다
          if (gy < -3) continue;
          if (slopeAt(wx, wz) > 0.85) continue;
          const color = zone.coral[Math.floor(rnd() * zone.coral.length)];
          const kind = rnd();
          let geo;
          if (kind < 0.45) geo = branchCoralGeometry(color, 700 + seed * 17 + i);
          else if (kind < 0.78) geo = blobCoralGeometry(color, 800 + seed * 19 + i);
          else geo = tubeCoralGeometry(color, 900 + seed * 23 + i);
          const sc = 1.5 + rnd() * 2.6;
          const m = new THREE.Matrix4();
          m.makeRotationY(rnd() * Math.PI * 2);
          m.scale(new THREE.Vector3(sc, sc * (0.9 + rnd() * 0.7), sc));
          m.setPosition(lx, gy + 0.1, lz);
          geo.applyMatrix4(m);
          coralGeos.push(geo);
        }
        for (let i = 0; i < 22; i++) {
          const lx = (rnd() - 0.5) * CHUNK_SIZE * 0.94;
          const lz = (rnd() - 0.5) * CHUNK_SIZE * 0.94;
          const wx = ox + lx;
          const wz = oz + lz;
          const gy = terrainHeight(wx, wz);
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

        if (rockGeos.length) group.add(new THREE.Mesh(mergeGeometries(rockGeos, false), rockMat));
        if (coralGeos.length) group.add(new THREE.Mesh(mergeGeometries(coralGeos, false), coralMat));
        if (kelpGeos.length) group.add(new THREE.Mesh(mergeGeometries(kelpGeos, false), kelpMat));

        this.scene.add(group);
        this.chunks.push({ group, rockMat, coralMat, kelpMat });
      }
    }
  }

  /* ---------------- 바위 아치(수중 터널) ---------------- */
  _buildArches() {
    this.arches = [];
    const rnd = mulberry(4242);
    const spots = [
      { x: -40, z: 20, r: 17, rot: 0.5 },
      { x: 40, z: -70, r: 20, rot: -0.9 },
      { x: -90, z: 40, r: 15, rot: 2.1 },
      { x: -58, z: -52, r: 18, rot: 1.2 },
    ];
    for (const s of spots) {
      const geos = [];
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1)) * Math.PI;
        const lx = Math.cos(a) * s.r;
        const ly = Math.sin(a) * s.r * 1.05;
        const rr = 3.4 + rnd() * 2.6;
        const geo = rockGeometry(rr, 3000 + i * 7 + Math.floor(s.x));
        const m = new THREE.Matrix4();
        m.makeRotationY(rnd() * Math.PI * 2);
        m.setPosition(lx, ly, (rnd() - 0.5) * 3);
        geo.applyMatrix4(m);
        paint(geo, new THREE.Color().setHSL(0.33, 0.24, 0.16 + rnd() * 0.12).getHex());
        geos.push(geo);
      }
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      mesh.position.set(s.x, terrainHeight(s.x, s.z) + 2, s.z);
      mesh.rotation.y = s.rot;
      this.scene.add(mesh);
      this.arches.push(mesh);
    }
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
        (Math.random() - 0.5) * ARENA * 1.7,
        SURFACE_Y - 46 + Math.random() * 20,
        (Math.random() - 0.5) * ARENA * 1.7
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
      bp[i * 3] = (Math.random() - 0.5) * ARENA * 1.8;
      bp[i * 3 + 1] = FLOOR_Y + Math.random() * (SURFACE_Y - FLOOR_Y);
      bp[i * 3 + 2] = (Math.random() - 0.5) * ARENA * 1.8;
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
      sp[i * 3] = (Math.random() - 0.5) * ARENA * 1.8;
      sp[i * 3 + 1] = FLOOR_Y + Math.random() * (SURFACE_Y - FLOOR_Y);
      sp[i * 3 + 2] = (Math.random() - 0.5) * ARENA * 1.8;
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

    const planCount = 190;
    const pGeo = new THREE.BufferGeometry();
    const pp = new Float32Array(planCount * 3);
    const pc = new Float32Array(planCount * 3);
    const col = new THREE.Color();
    for (let i = 0; i < planCount; i++) {
      pp[i * 3] = (Math.random() - 0.5) * ARENA * 1.8;
      pp[i * 3 + 1] = FLOOR_Y + Math.random() * (SURFACE_Y - FLOOR_Y);
      pp[i * 3 + 2] = (Math.random() - 0.5) * ARENA * 1.8;
      col.setHSL(0.47 + Math.random() * 0.16, 0.9, 0.68);
      pc[i * 3] = col.r;
      pc[i * 3 + 1] = col.g;
      pc[i * 3 + 2] = col.b;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    this.plank = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        map: glowTexture(), size: 1.6, transparent: true, opacity: 0.7,
        depthWrite: false, sizeAttenuation: true, vertexColors: true,
        blending: THREE.AdditiveBlending,
      })
    );
    this.plank.frustumCulled = false;
    this.scene.add(this.plank);
  }

  /* ---------------- 물고기 떼 ---------------- */
  _buildSchools() {
    const rnd = mulberry(918);
    for (let s = 0; s < 6; s++) {
      const count = 24;
      const inst = makeFishSchool(count);
      const cx = (rnd() - 0.5) * 150;
      const cz = (rnd() - 0.5) * 150;
      const gy = terrainHeight(cx, cz);
      const school = {
        mesh: inst,
        offsets: [],
        center: new THREE.Vector3(
          cx,
          gy < -12 ? gy + 16 : gy + 9 + rnd() * 7,
          cz
        ),
        radius: 26 + rnd() * 44,
        angle: rnd() * 6.28,
        angular: (0.04 + rnd() * 0.08) * (rnd() > 0.5 ? 1 : -1),
        bob: rnd() * 6.28,
        scale: 1.1 + rnd() * 0.6,
      };
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
        center: new THREE.Vector3((rnd() - 0.5) * 40, p.y, (rnd() - 0.5) * 40),
        radius: p.radius,
        angle: rnd() * 6.28,
        angular: p.angular,
        y: p.y,
        bobPhase: rnd() * 6.28,
        scale: p.scale,
      };
      obj.group.scale.setScalar(p.scale);
      obj.group.rotation.order = 'YXZ';
      this.scene.add(obj.group);
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

    // 빛줄기 살랑임
    for (const r of this.rays) {
      r.material.opacity = 0.22 + Math.sin(this.time * 0.7 + r.userData.phase) * 0.08;
      r.rotation.z = Math.sin(this.time * 0.12 + r.userData.phase) * 0.08;
    }

    // 기포
    const bpos = this.bubbles.geometry.attributes.position;
    const ba = bpos.array;
    for (let i = 0; i < this.bubbleData.length; i++) {
      const d = this.bubbleData[i];
      ba[i * 3] += Math.sin(this.time * 0.6 + d.sway) * dt * 0.5;
      ba[i * 3 + 1] += d.rise * dt;
      ba[i * 3 + 2] += Math.cos(this.time * 0.5 + d.sway) * dt * 0.3;
      if (ba[i * 3 + 1] > SURFACE_Y - 1) {
        ba[i * 3 + 1] = FLOOR_Y + 1;
        ba[i * 3] = (Math.random() - 0.5) * ARENA * 1.8;
        ba[i * 3 + 2] = (Math.random() - 0.5) * ARENA * 1.8;
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

    const ppos = this.plank.geometry.attributes.position;
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

    // 물고기 떼 (원형 유영)
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const s of this.schools) {
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
      const g = c.obj.group;
      const R = c.radius;
      const cx = c.center.x + Math.cos(c.angle) * R;
      const cz = c.center.z + Math.sin(c.angle) * R;
      const ground = terrainHeight(cx, cz) + 7;
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

    // 하늘 돔은 플레이어를 따라간다
    this.sky.position.set(playerPos.x * 0.2, 0, playerPos.z * 0.2);
  }

  reset() {
    this.time = 0;
    this.setZone(0);
  }
}
