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
export const FLOOR_Y = -14;
export const ARENA = 168;

export const ZONES = [
  {
    name: '산호초 지대',
    fog: 0x2fbfb2, density: 0.0048,
    skyTop: 0xb8fff4, skyMid: 0x33b3b8, skyBottom: 0x0a5f74,
    hemiSky: 0xd9fffb, hemiGround: 0x2f8f86, hemi: 0.95,
    ambient: 0x9ff0e8, ambientI: 0.5,
    sun: 0xfffbee, sunI: 1.5,
    coral: [0xff8a72, 0xffbe5c, 0xef86e0, 0xffa8cf, 0xfff07a, 0x86efd8],
  },
  {
    name: '해저 협곡',
    fog: 0x2ba5c4, density: 0.0055,
    skyTop: 0xa9ecff, skyMid: 0x2596bb, skyBottom: 0x075a7c,
    hemiSky: 0xd2f6ff, hemiGround: 0x1f7d94, hemi: 0.9,
    ambient: 0x8fe0f5, ambientI: 0.48,
    sun: 0xfdf8ec, sunI: 1.45,
    coral: [0xe07a9a, 0xe0a255, 0xb884e8, 0x7fc2d8, 0xc47a68],
  },
  {
    name: '산호 군락',
    fog: 0x1f8fbe, density: 0.0062,
    skyTop: 0x98e4ff, skyMid: 0x1f86b4, skyBottom: 0x064c72,
    hemiSky: 0xccf4ff, hemiGround: 0x1a708c, hemi: 0.85,
    ambient: 0x86d8f2, ambientI: 0.45,
    sun: 0xfdf6e6, sunI: 1.4,
    coral: [0x7ff0ff, 0xc08bff, 0xff8ad4, 0x6cf0c0, 0xa8ffff],
  },
];

const CHUNKS = 3;
const CHUNK_SIZE = (ARENA * 2) / CHUNKS;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 바닥 높이 (월드 좌표) */
export function terrainHeight(x, z) {
  const h =
    Math.sin(x * 0.021) * 2.6 +
    Math.cos(z * 0.019) * 2.2 +
    Math.sin((x + z) * 0.013) * 1.8 +
    Math.cos(x * 0.052 + z * 0.041) * 0.9 +
    Math.sin(x * 0.11) * Math.cos(z * 0.09) * 0.4;
  const edge = Math.max(Math.abs(x), Math.abs(z)) / ARENA;
  return FLOOR_Y + h + Math.pow(clamp01(edge), 3) * 16;
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

    this._buildSky();
    this._buildLights();
    this._buildFloor();
    this._buildArches();
    this._buildRays();
    this._buildParticles();
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
        const floorGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 22, 22);
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
          fc.setHSL(0.40 - k * 0.05, 0.42, 0.2 + k * 0.16);
          fcol[i * 3] = fc.r;
          fcol[i * 3 + 1] = fc.g;
          fcol[i * 3 + 2] = fc.b;
        }
        floorGeo.computeVertexNormals();
        floorGeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
        group.add(new THREE.Mesh(floorGeo, rockMat));

        /* 바위 + 산호 + 해초 */
        const rockGeos = [];
        const coralGeos = [];
        const kelpGeos = [];
        for (let i = 0; i < 18; i++) {
          const lx = (rnd() - 0.5) * CHUNK_SIZE * 0.95;
          const lz = (rnd() - 0.5) * CHUNK_SIZE * 0.95;
          const r = 1.0 + rnd() * 2.4;
          const geo = rockGeometry(r, 900 + seed * 13 + i);
          const m = new THREE.Matrix4();
          m.makeRotationY(rnd() * Math.PI * 2);
          m.setPosition(lx, terrainHeight(ox + lx, oz + lz) + r * 0.15, lz);
          geo.applyMatrix4(m);
          const g = 0.2 + rnd() * 0.14;
          paint(geo, new THREE.Color().setHSL(0.36, 0.16, g).getHex());
          rockGeos.push(geo);
        }
        for (let i = 0; i < 38; i++) {
          const lx = (rnd() - 0.5) * CHUNK_SIZE * 0.92;
          const lz = (rnd() - 0.5) * CHUNK_SIZE * 0.92;
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
          m.setPosition(lx, terrainHeight(ox + lx, oz + lz) + 0.1, lz);
          geo.applyMatrix4(m);
          coralGeos.push(geo);
        }
        for (let i = 0; i < 18; i++) {
          const lx = (rnd() - 0.5) * CHUNK_SIZE * 0.94;
          const lz = (rnd() - 0.5) * CHUNK_SIZE * 0.94;
          const h = 4 + rnd() * 9;
          const w = 0.7 + rnd() * 0.7;
          const geo = kelpGeometry(h, w, 300 + seed * 13 + i);
          const m = new THREE.Matrix4();
          m.makeRotationY(rnd() * Math.PI * 2);
          m.setPosition(lx, terrainHeight(ox + lx, oz + lz) - 0.3, lz);
          geo.applyMatrix4(m);
          kelpGeos.push(geo);
        }

        group.add(new THREE.Mesh(mergeGeometries(rockGeos, false), rockMat));
        group.add(new THREE.Mesh(mergeGeometries(coralGeos, false), coralMat));
        group.add(new THREE.Mesh(mergeGeometries(kelpGeos, false), kelpMat));

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
      { x: -58, z: -52, r: 17, rot: 0.5 },
      { x: 64, z: -18, r: 20, rot: -0.9 },
      { x: -20, z: 74, r: 15, rot: 2.1 },
      { x: 92, z: 66, r: 18, rot: 1.2 },
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
    for (let s = 0; s < 5; s++) {
      const count = 24;
      const inst = makeFishSchool(count);
      const school = {
        mesh: inst,
        offsets: [],
        center: new THREE.Vector3((rnd() - 0.5) * 150, FLOOR_Y + 16 + rnd() * 22, (rnd() - 0.5) * 150),
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
      { kind: 'whale', radius: 92, y: 20, scale: 1.6, angular: 0.035 },
      { kind: 'whale', radius: 128, y: 26, scale: 1.35, angular: -0.026 },
      { kind: 'manta', radius: 84, y: 14, scale: 1.7, angular: 0.06 },
      { kind: 'manta', radius: 118, y: 8, scale: 1.4, angular: -0.05 },
      { kind: 'turtle', radius: 58, y: 6, scale: 1.0, angular: 0.09 },
      { kind: 'turtle', radius: 76, y: 11, scale: 1.2, angular: -0.08 },
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
    const tint = new THREE.Color(this.zone.coral[0]).lerp(new THREE.Color(0xffffff), 0.9);
    this.floorMats.forEach((m) => m.color.copy(tint));
  }

  /* ---------------- 업데이트 ---------------- */
  update(dt, playerPos) {
    this.time += dt;
    this.kelpUniform.value = this.time;

    // 안개/조명 전환
    const tz = this.zoneTarget;
    const k = Math.min(1, dt * 0.7);
    if (this.scene.fog) {
      this.scene.fog.color.lerp(new THREE.Color(tz.fog), k);
      this.scene.fog.density += (tz.density - this.scene.fog.density) * k;
    }
    this.hemi.intensity += (tz.hemi - this.hemi.intensity) * k;
    this.hemi.color.lerp(new THREE.Color(tz.hemiSky), k);
    this.hemi.groundColor.lerp(new THREE.Color(tz.hemiGround), k);
    this.ambient.color.lerp(new THREE.Color(tz.ambient), k);
    this.ambient.intensity += (tz.ambientI - this.ambient.intensity) * k;
    this.sun.intensity += (tz.sunI - this.sun.intensity) * k;
    this.sun.color.lerp(new THREE.Color(tz.sun), k);
    this.skyUniforms.top.value.lerp(new THREE.Color(tz.skyTop), k);
    this.skyUniforms.mid.value.lerp(new THREE.Color(tz.skyMid), k);
    this.skyUniforms.bottom.value.lerp(new THREE.Color(tz.skyBottom), k);

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
      const cy = c.center.y + Math.sin(c.t * 0.35 + c.bobPhase) * 2.4;
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
