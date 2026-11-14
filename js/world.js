/* =========================================================
   ABYSS DIVER — 수중 환경
   해저 지형 · 산호초 · 해초 · 빛줄기 · 플랑크톤 · 대형 해양 생물
   ========================================================= */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  makeWhale, makeManta, makeTurtle, makeFishSchool,
  rockGeometry, branchCoralGeometry, blobCoralGeometry, tubeCoralGeometry,
  kelpGeometry, glowTexture, spriteGlow, paint, mulberry,
} from './models.js';

export const ZONES = [
  {
    name: '산호초 지대',
    fog: 0x0a5b6d, density: 0.017,
    hemiSky: 0x9fe8f0, hemiGround: 0x073039, hemi: 0.85,
    dir: 1.15, dirColor: 0xd6f7ff,
    tint: 0xffffff,
    skyTop: 0x2b9aa8, skyMid: 0x08495c, skyBottom: 0x02141f,
    coral: [0xff7f6b, 0xffb347, 0xd96bd0, 0xff9ecb, 0xf7e04f, 0x7de0d0],
    kelp: 0x2f6b34,
  },
  {
    name: '해저 협곡',
    fog: 0x073e56, density: 0.020,
    hemiSky: 0x7ccbe0, hemiGround: 0x06222e, hemi: 0.66,
    dir: 0.95, dirColor: 0xbce8ff,
    tint: 0xa8c6d8,
    skyTop: 0x1a7188, skyMid: 0x063347, skyBottom: 0x020f1b,
    coral: [0xd06a8a, 0xc98f4a, 0x9b6bd0, 0x6fa8b8, 0xb86b5a],
    kelp: 0x2b5738,
  },
  {
    name: '심해 발광 지대',
    fog: 0x040c24, density: 0.023,
    hemiSky: 0x4d6ea8, hemiGround: 0x040a1c, hemi: 0.42,
    dir: 0.38, dirColor: 0x7fa8e0,
    tint: 0x7c88e0,
    skyTop: 0x081a38, skyMid: 0x030a1e, skyBottom: 0x01030a,
    coral: [0x6ef0ff, 0xb47bff, 0xff6ec7, 0x4ae0b0, 0x9affff],
    kelp: 0x18404f,
  },
];

const SEG_LEN = 70;
const SEG_COUNT = 3;
const FIELD_W = 96;
const FLOOR_Y = -10;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 세그먼트 경계에서도 이어지는 해저 높이 (로컬 x,z 기준) */
function floorHeight(x, z) {
  const tz = ((z + SEG_LEN / 2) / SEG_LEN) * Math.PI * 2;
  const h =
    Math.sin(tz * 2) * 1.5 +
    Math.cos(tz) * 1.1 +
    Math.sin(x * 0.16 + tz) * 0.9 +
    Math.cos(x * 0.37) * 0.4 +
    Math.sin(x * 0.08) * 1.2;
  return FLOOR_Y + h - 2.4;
}

function streakTexture() {
  const w = 128;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) {
    const x = 8 + Math.random() * (w - 16);
    const width = 3 + Math.random() * 16;
    const grad = ctx.createLinearGradient(x - width, 0, x + width, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${0.14 + Math.random() * 0.22})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - width, 0, width * 2, h);
  }
  // 위아래 페이드
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.25, 'rgba(0,0,0,1)');
  fade.addColorStop(0.75, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
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
  g.addColorStop(0.62, 'rgba(200,250,255,0.18)');
  g.addColorStop(0.82, 'rgba(230,255,255,0.65)');
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
    this.creatureTimer = { whale: 8, manta: 4, turtle: 6 };
    this.schools = [];

    this._buildSky();
    this._buildLights();
    this._buildSegments();
    this._buildRays();
    this._buildParticles();
    this._buildSchools();
  }

  /* ---------------- 하늘(물빛 그라데이션) ---------------- */
  _buildSky() {
    const geo = new THREE.SphereGeometry(300, 24, 16);
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
          vec3 c = mix(bottom, mid, smoothstep(0.28, 0.56, t));
          c = mix(c, top, smoothstep(0.55, 1.0, t));
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
    this.hemi = new THREE.HemisphereLight(z.hemiSky, z.hemiGround, z.hemi);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(z.dirColor, z.dir);
    this.sun.position.set(-14, 40, 8);
    this.scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(0x66e0ff, 0.35);
    this.rim.position.set(12, -8, -30);
    this.scene.add(this.rim);
  }

  /* ---------------- 해저 세그먼트 ---------------- */
  _buildSegments() {
    this.segments = [];
    for (let i = 0; i < SEG_COUNT; i++) {
      const seg = this._makeSegment(i);
      seg.group.position.z = 40 - i * SEG_LEN;
      this.scene.add(seg.group);
      this.segments.push(seg);
    }
  }

  _makeSegment(seed) {
    const group = new THREE.Group();
    const zone = this.zone;
    const rnd = mulberry(1000 + seed * 37);

    /* --- 바닥 --- */
    const floorGeo = new THREE.PlaneGeometry(FIELD_W, SEG_LEN, 26, 26);
    floorGeo.rotateX(-Math.PI / 2);
    const fp = floorGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      fp.setY(i, floorHeight(fp.getX(i), fp.getZ(i)));
    }
    floorGeo.computeVertexNormals();
    // 지형 명암: 모래 결정과 기복에 따른 색 변화
    const fcol = new Float32Array(fp.count * 3);
    const fc = new THREE.Color();
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i);
      const y = fp.getY(i);
      const z = fp.getZ(i);
      const n =
        Math.sin(x * 0.62 + z * 0.14) * 0.5 +
        Math.cos(z * 0.48 - x * 0.2) * 0.5 +
        Math.sin(x * 1.7) * Math.cos(z * 1.3) * 0.25;
      const k = clamp01((n + 1.25) / 2.5);
      const crest = clamp01((y - FLOOR_Y + 4.0) / 6.0);
      fc.setHSL(0.48 - k * 0.04, 0.18, 0.075 + k * 0.06 + crest * 0.03);
      fcol[i * 3] = fc.r;
      fcol[i * 3 + 1] = fc.g;
      fcol[i * 3 + 2] = fc.b;
    }
    floorGeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
    const floorMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    group.add(floor);

    /* --- 바위 --- */
    const rockGeos = [];
    for (let i = 0; i < 16; i++) {
      const r = 0.8 + rnd() * 2.6;
      const geo = rockGeometry(r, 500 + seed * 11 + i);
      const m = new THREE.Matrix4();
      m.makeRotationY(rnd() * Math.PI * 2);
      const x = (rnd() - 0.5) * 44;
      const z = (rnd() - 0.5) * SEG_LEN;
      m.setPosition(x, floorHeight(x, z) - r * 0.15, z);
      geo.applyMatrix4(m);
      const shade = 0.07 + rnd() * 0.1;
      paint(geo, new THREE.Color().setHSL(0.52, 0.16, shade).getHex());
      rockGeos.push(geo);
    }
    const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const rocks = new THREE.Mesh(mergeGeometries(rockGeos, false), rockMat);
    group.add(rocks);

    /* --- 산호 --- */
    const coralGeos = [];
    for (let i = 0; i < 18; i++) {
      const color = zone.coral[Math.floor(rnd() * zone.coral.length)];
      const kind = rnd();
      let geo;
      if (kind < 0.45) geo = branchCoralGeometry(color, 700 + seed * 17 + i);
      else if (kind < 0.78) geo = blobCoralGeometry(color, 800 + seed * 19 + i);
      else geo = tubeCoralGeometry(color, 900 + seed * 23 + i);
      const scale = 0.55 + rnd() * 0.9;
      const m = new THREE.Matrix4();
      m.makeRotationY(rnd() * Math.PI * 2);
      m.scale(new THREE.Vector3(scale, scale * (0.8 + rnd() * 0.6), scale));
      const cx = (rnd() - 0.5) * 36;
      const cz = (rnd() - 0.5) * SEG_LEN;
      m.setPosition(cx, floorHeight(cx, cz) - 0.15, cz);
      geo.applyMatrix4(m);
      coralGeos.push(geo);
    }
    const coralMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const corals = new THREE.Mesh(mergeGeometries(coralGeos, false), coralMat);
    group.add(corals);

    /* --- 해초 --- */
    const kelpGeos = [];
    for (let i = 0; i < 22; i++) {
      const h = 3 + rnd() * 6.5;
      const w = 0.45 + rnd() * 0.5;
      const geo = kelpGeometry(h, w, 300 + seed * 13 + i);
      const m = new THREE.Matrix4();
      m.makeRotationY(rnd() * Math.PI * 2);
      const kx = (rnd() - 0.5) * 42;
      const kz = (rnd() - 0.5) * SEG_LEN;
      m.setPosition(kx, floorHeight(kx, kz) - 0.3, kz);
      geo.applyMatrix4(m);
      kelpGeos.push(geo);
    }
    const kelpMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const kelpTime = this.kelpUniform;
    kelpMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = kelpTime;
      shader.vertexShader = 'uniform float uTime;\nattribute float aSway;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        vec3 transformed = vec3( position );
        float hh = aSway;
        float swayA = sin(uTime * 1.35 + position.x * 0.3 + position.z * 0.18) * 0.85 * hh * hh;
        float swayB = cos(uTime * 0.9 + position.x * 0.16) * 0.5 * hh * hh;
        transformed.x += swayA;
        transformed.z += swayB;
        `
      );
    };
    const kelp = new THREE.Mesh(mergeGeometries(kelpGeos, false), kelpMat);
    group.add(kelp);

    return { group, materials: [floorMat, rockMat, coralMat, kelpMat], seed };
  }

  /* ---------------- 수면 빛줄기 ---------------- */
  _buildRays() {
    this.rayTex = streakTexture();
    this.rays = [];
    const group = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.rayTex,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        color: 0xd8ffff,
      });
      const g = new THREE.PlaneGeometry(16 + Math.random() * 16, 90);
      const m = new THREE.Mesh(g, mat);
      m.position.set((Math.random() - 0.5) * 70, 6 + Math.random() * 10, -Math.random() * 150);
      m.rotation.z = (Math.random() - 0.5) * 0.35;
      m.userData.drift = 0.4 + Math.random() * 0.5;
      group.add(m);
      this.rays.push(m);
    }
    this.scene.add(group);
  }

  /* ---------------- 플랑크톤 / 기포 ---------------- */
  _buildParticles() {
    // 기포
    const bubbleCount = 220;
    const bGeo = new THREE.BufferGeometry();
    const bp = new Float32Array(bubbleCount * 3);
    this.bubbleData = [];
    for (let i = 0; i < bubbleCount; i++) {
      bp[i * 3] = (Math.random() - 0.5) * 80;
      bp[i * 3 + 1] = FLOOR_Y + Math.random() * 30;
      bp[i * 3 + 2] = -Math.random() * 160;
      this.bubbleData.push({ rise: 0.6 + Math.random() * 1.8, sway: Math.random() * 6.28 });
    }
    bGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    const bMat = new THREE.PointsMaterial({
      map: bubbleTexture(), size: 0.75, transparent: true, opacity: 0.55,
      depthWrite: false, sizeAttenuation: true, color: 0xd6ffff,
    });
    this.bubbles = new THREE.Points(bGeo, bMat);
    this.bubbles.frustumCulled = false;
    this.scene.add(this.bubbles);

    // 해양 눈(부유물)
    const snowCount = 420;
    const sGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(snowCount * 3);
    for (let i = 0; i < snowCount; i++) {
      sp[i * 3] = (Math.random() - 0.5) * 80;
      sp[i * 3 + 1] = -14 + Math.random() * 40;
      sp[i * 3 + 2] = -Math.random() * 150;
    }
    sGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(
      sGeo,
      new THREE.PointsMaterial({
        map: glowTexture(), size: 0.5, transparent: true, opacity: 0.32,
        depthWrite: false, sizeAttenuation: true, color: 0xbfeaff,
        blending: THREE.AdditiveBlending,
      })
    );
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);

    // 발광 플랑크톤
    const planCount = 140;
    const pGeo = new THREE.BufferGeometry();
    const pp = new Float32Array(planCount * 3);
    const pc = new Float32Array(planCount * 3);
    const col = new THREE.Color();
    for (let i = 0; i < planCount; i++) {
      pp[i * 3] = (Math.random() - 0.5) * 70;
      pp[i * 3 + 1] = -10 + Math.random() * 32;
      pp[i * 3 + 2] = -Math.random() * 140;
      col.setHSL(0.48 + Math.random() * 0.25, 0.85, 0.62);
      pc[i * 3] = col.r;
      pc[i * 3 + 1] = col.g;
      pc[i * 3 + 2] = col.b;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    this.plank = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        map: glowTexture(), size: 1.5, transparent: true, opacity: 0.65,
        depthWrite: false, sizeAttenuation: true, vertexColors: true,
        blending: THREE.AdditiveBlending,
      })
    );
    this.plank.frustumCulled = false;
    this.scene.add(this.plank);
  }

  /* ---------------- 물고기 떼 ---------------- */
  _buildSchools() {
    const rand = mulberry(77);
    for (let s = 0; s < 4; s++) {
      const count = 26;
      const inst = makeFishSchool(count);
      const school = {
        mesh: inst,
        offsets: [],
        base: new THREE.Vector3((rand() - 0.5) * 42, -6 + rand() * 14, -Math.random() * 130),
        speed: 1.0 + rand() * 0.5,
        phase: rand() * 6.28,
        scale: 0.4 + rand() * 0.32,
      };
      for (let i = 0; i < count; i++) {
        school.offsets.push({
          x: (rand() - 0.5) * 6.5,
          y: (rand() - 0.5) * 3.0,
          z: (rand() - 0.5) * 6.5,
          p: rand() * 6.28,
          s: 0.7 + rand() * 0.6,
        });
      }
      this.schools.push(school);
      this.scene.add(inst);
    }
  }

  /* ---------------- 관상용 대형 생물 ---------------- */
  _spawnCreature(kind) {
    let obj;
    let scale = 1;
    if (kind === 'whale') {
      obj = makeWhale();
      scale = 1.35 + Math.random() * 0.35;
    } else if (kind === 'manta') {
      obj = makeManta();
      scale = 1.4 + Math.random() * 0.5;
    } else {
      obj = makeTurtle();
      scale = 0.85 + Math.random() * 0.4;
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    const c = {
      kind,
      obj,
      t: 0,
      baseX: side * (kind === 'whale' ? 9 + Math.random() * 12 : 13 + Math.random() * 14),
      y: kind === 'whale' ? 6.5 + Math.random() * 6 : 4 + Math.random() * 10,
      driftX: -side * (0.8 + Math.random() * 0.8),
      driftY: (Math.random() - 0.5) * 0.9,
      speed: 1.05 + Math.random() * 0.35,
      phase: Math.random() * 6.28,
    };
    obj.group.scale.setScalar(scale);
    obj.group.position.set(c.baseX, c.y, -96);
    obj.group.rotation.y = c.baseX > 0 ? 0.5 : -0.5;
    this.scene.add(obj.group);
    this.creatures.push(c);
  }

  setZone(index) {
    const i = Math.max(0, Math.min(ZONES.length - 1, index));
    if (i === this.zoneIndex) return;
    this.zoneIndex = i;
    this.zone = ZONES[i];
    this.zoneTarget = ZONES[i];
  }

  _recycle(seg) {
    seg.group.position.z -= SEG_LEN * SEG_COUNT;
    this._applyTint(seg);
  }

  _applyTint(seg) {
    const tint = new THREE.Color(this.zone.tint);
    seg.materials.forEach((m) => {
      if (m.color) m.color.copy(tint);
    });
  }

  update(dt, speed) {
    this.time += dt;
    this.kelpUniform.value = this.time;

    // 안개·조명을 목표 구역으로 부드럽게 전환
    const tz = this.zoneTarget;
    const k = Math.min(1, dt * 0.55);
    if (this.scene.fog) {
      this.scene.fog.color.lerp(new THREE.Color(tz.fog), k);
      this.scene.fog.density += (tz.density - this.scene.fog.density) * k;
    }
    this.hemi.intensity += (tz.hemi - this.hemi.intensity) * k;
    this.hemi.color.lerp(new THREE.Color(tz.hemiSky), k);
    this.hemi.groundColor.lerp(new THREE.Color(tz.hemiGround), k);
    this.sun.intensity += (tz.dir - this.sun.intensity) * k;
    this.sun.color.lerp(new THREE.Color(tz.dirColor), k);
    this.skyUniforms.top.value.lerp(new THREE.Color(tz.skyTop), k);
    this.skyUniforms.mid.value.lerp(new THREE.Color(tz.skyMid), k);
    this.skyUniforms.bottom.value.lerp(new THREE.Color(tz.skyBottom), k);

    // 해저 스크롤
    for (const seg of this.segments) {
      seg.group.position.z += speed * dt;
      if (seg.group.position.z > 60) this._recycle(seg);
    }

    // 빛줄기
    for (const ray of this.rays) {
      ray.position.z += speed * dt * ray.userData.drift;
      if (ray.position.z > 30) {
        ray.position.z = -150 - Math.random() * 30;
        ray.position.x = (Math.random() - 0.5) * 70;
      }
    }

    // 기포
    const bpos = this.bubbles.geometry.attributes.position;
    const ba = bpos.array;
    for (let i = 0; i < this.bubbleData.length; i++) {
      const d = this.bubbleData[i];
      ba[i * 3] += Math.sin(this.time * 0.7 + d.sway) * 0.006;
      ba[i * 3 + 1] += d.rise * dt;
      ba[i * 3 + 2] += speed * dt * 0.9;
      if (ba[i * 3 + 1] > 22) {
        ba[i * 3 + 1] = FLOOR_Y - 1;
        ba[i * 3] = (Math.random() - 0.5) * 80;
        ba[i * 3 + 2] = -Math.random() * 160;
      }
      if (ba[i * 3 + 2] > 35) ba[i * 3 + 2] -= 195;
    }
    bpos.needsUpdate = true;

    // 부유물
    const spos = this.snow.geometry.attributes.position;
    const sa = spos.array;
    for (let i = 0; i < sa.length; i += 3) {
      sa[i + 2] += speed * dt * 0.35;
      sa[i + 1] -= dt * 0.12;
      if (sa[i + 2] > 40) sa[i + 2] -= 190;
      if (sa[i + 1] < -16) sa[i + 1] = 24;
    }
    spos.needsUpdate = true;

    const ppos = this.plank.geometry.attributes.position;
    const pa = ppos.array;
    for (let i = 0; i < pa.length; i += 3) {
      pa[i + 2] += speed * dt * 0.55;
      pa[i] += Math.sin(this.time * 0.6 + i) * 0.004;
      if (pa[i + 2] > 35) pa[i + 2] -= 175;
    }
    ppos.needsUpdate = true;

    // 물고기 떼
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (const s of this.schools) {
      s.base.z += speed * dt * s.speed;
      s.base.x += Math.sin(this.time * 0.3 + s.phase) * speed * dt * 0.12;
      if (s.base.z > 28) {
        s.base.z -= 175;
        s.base.x = (Math.random() - 0.5) * 42;
        s.base.y = -6 + Math.random() * 14;
      }
      for (let i = 0; i < s.offsets.length; i++) {
        const o = s.offsets[i];
        pos.set(
          s.base.x + o.x + Math.sin(this.time * 1.2 + o.p) * 0.9,
          s.base.y + o.y + Math.cos(this.time * 1.5 + o.p) * 0.5,
          s.base.z + o.z + Math.cos(this.time * 1.2 + o.p) * 1.4
        );
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI + Math.sin(this.time * 2 + o.p) * 0.18);
        scl.setScalar(o.s * s.scale);
        m.compose(pos, q, scl);
        s.mesh.setMatrixAt(i, m);
      }
      s.mesh.instanceMatrix.needsUpdate = true;
    }

    // 대형 생물
    const timers = this.creatureTimer;
    timers.whale -= dt;
    timers.manta -= dt;
    timers.turtle -= dt;
    if (timers.whale <= 0) {
      timers.whale = 26 + Math.random() * 16;
      if (!this.creatures.some((c) => c.kind === 'whale')) this._spawnCreature('whale');
    }
    if (timers.manta <= 0) {
      timers.manta = 17 + Math.random() * 12;
      if (this.creatures.filter((c) => c.kind === 'manta').length < 2) this._spawnCreature('manta');
    }
    if (timers.turtle <= 0) {
      timers.turtle = 14 + Math.random() * 12;
      if (this.creatures.filter((c) => c.kind === 'turtle').length < 2) this._spawnCreature('turtle');
    }

    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      c.t += dt;
      c.obj.group.position.z += speed * dt * c.speed;
      c.obj.group.position.x = c.baseX + c.driftX * c.t;
      c.obj.group.position.y = c.y + Math.sin(c.t * 0.7 + c.phase) * 1.4 + c.driftY * c.t;

      if (c.kind === 'whale') {
        c.obj.fluke.rotation.x = Math.sin(c.t * 0.9 + c.phase) * 0.42;
        c.obj.fluke.rotation.z = Math.sin(c.t * 0.45) * 0.08;
        c.obj.fins.forEach((f, fi) => {
          f.rotation.y = (fi === 0 ? 1 : -1) * (0.28 + Math.sin(c.t * 0.8 + c.phase) * 0.12);
        });
        c.obj.group.rotation.z = Math.sin(c.t * 0.4) * 0.06;
      } else if (c.kind === 'manta') {
        const flap = Math.sin(c.t * 1.9 + c.phase) * 0.55;
        c.obj.wingL.rotation.z = flap;
        c.obj.wingR.rotation.z = -flap;
        c.obj.tail.rotation.z = Math.sin(c.t * 1.3) * 0.16;
        c.obj.group.rotation.z = Math.sin(c.t * 0.6) * 0.12;
      } else {
        c.obj.flippers.forEach((f) => {
          f.rotation.z = f.userData.base + Math.sin(c.t * 1.6 + f.userData.phase) * 0.5;
        });
        c.obj.group.rotation.z = Math.sin(c.t * 0.5) * 0.1;
      }

      // 카메라를 지나면 제거
      if (c.obj.group.position.z > 40) {
        this.scene.remove(c.obj.group);
        this.creatures.splice(i, 1);
      }
    }

    // 하늘돔은 카메라를 따라간다
    this.sky.position.set(0, 0, -40);
  }

  reset() {
    for (const c of this.creatures) this.scene.remove(c.obj.group);
    this.creatures.length = 0;
    this.creatureTimer = { whale: 9, manta: 5, turtle: 7 };
    this.segments.forEach((seg, i) => {
      seg.group.position.z = 40 - i * SEG_LEN;
      this._applyTint(seg);
    });
    for (const s of this.schools) {
      s.base.set((Math.random() - 0.5) * 42, -6 + Math.random() * 14, -Math.random() * 130);
    }
  }
}
