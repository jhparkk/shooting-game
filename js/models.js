/* =========================================================
   ABYSS DIVER — 절차적 3D 모델 빌더
   · 회전체(lathe) 몸통으로 만든 매끄러운 유선형 어류
   · 등·배지느러미 / 가슴지느러미 / 배지느러미 / 갈라진 꼬리지느러미
   · 눈(흰자+검은자), 등·배 투톤 피부, 줄무늬·반점
   · 정점 셰이더 기반 유영(tail-wagging) 애니메이션
   ========================================================= */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 모든 어류가 함께 쓰는 시간 유니폼 (게임 루프에서 증가) */
export const ANIM = { time: { value: 0 } };

/* ---------------- 공용 텍스처/머티리얼 ---------------- */
let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(200,255,255,0.65)');
  g.addColorStop(0.6, 'rgba(120,240,255,0.16)');
  g.addColorStop(1, 'rgba(80,220,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

export function spriteGlow(color, size, opacity) {
  const m = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: color,
    transparent: true,
    opacity: opacity === undefined ? 0.85 : opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, 1);
  return s;
}

export function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const MET = {
  hull: new THREE.MeshPhongMaterial({ color: 0xffc172, shininess: 78, specular: 0x6b8fa8 }),
  hullDark: new THREE.MeshPhongMaterial({ color: 0xe89a45, shininess: 46, specular: 0x334455 }),
  accent: new THREE.MeshPhongMaterial({ color: 0x2b3d55, shininess: 70, specular: 0x7799bb }),
  glass: new THREE.MeshPhongMaterial({
    color: 0x9ef6ff, emissive: 0x1f8b96, emissiveIntensity: 1.1,
    transparent: true, opacity: 0.66, shininess: 120, specular: 0xffffff,
  }),
  metal: new THREE.MeshPhongMaterial({ color: 0x6d7d8a, shininess: 120, specular: 0xd0e6ff }),
  metalDark: new THREE.MeshPhongMaterial({ color: 0x2b3540, shininess: 90, specular: 0x88aacc }),
  eyeRed: new THREE.MeshBasicMaterial({ color: 0xff3b3b }),
  eyeYellow: new THREE.MeshBasicMaterial({ color: 0xffd457 }),
  bone: new THREE.MeshLambertMaterial({ color: 0xf4f7ea }),
  darkFlesh: new THREE.MeshPhongMaterial({ color: 0x33475c, shininess: 26, specular: 0x4a6a88, emissive: 0x0a1a28, emissiveIntensity: 0.7 }),
};

function mesh(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  if (x !== undefined) m.position.set(x, y, z);
  return m;
}

/** 원본 지오메트리를 변환·색칠해 복사한다 (병합용) */
function placed(geo, p, r, s, color) {
  const g = geo.clone();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(p[0], p[1], p[2]),
    q,
    new THREE.Vector3(s[0], s[1], s[2])
  );
  g.applyMatrix4(m);
  return paint(g, color);
}

/* =========================================================
   어류 공용 빌더
   ========================================================= */

/** 이동/회전/크기를 지오메트리에 구워 넣는다 */
function xf(geo, p, r, s) {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0)
  );
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0),
    q,
    new THREE.Vector3(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1)
  );
  geo.applyMatrix4(m);
  return geo;
}

/**
 * 몸통 — z 축(머리 -z → 꼬리 +z)을 따라 늘어선 매끄러운 회전체.
 * profile: [[z, 반지름], ...]   sx: 옆으로 납작한 정도, sy: 세로 배율
 */
function bodyGeometry(profile, opts) {
  const o = opts || {};
  const radial = o.radial || 20;
  const pts = profile
    .map(([z, r]) => new THREE.Vector2(Math.max(0.0015, r), z))
    .sort((a, b) => a.y - b.y);
  const geo = new THREE.LatheGeometry(pts, radial);
  geo.rotateX(Math.PI / 2);            // 회전축을 +Z 로
  geo.scale(o.sx === undefined ? 1 : o.sx, o.sy === undefined ? 1 : o.sy, 1);
  return geo;
}

/** 프로파일에서 특정 z 위치의 몸통 반지름 */
function radiusAt(profile, z) {
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const lo = Math.min(a[0], b[0]);
    const hi = Math.max(a[0], b[0]);
    if (z >= lo && z <= hi) {
      const t = (z - a[0]) / (b[0] - a[0] || 1);
      return mix(a[1], b[1], t);
    }
  }
  return profile[profile.length - 1][1];
}

/**
 * 등·배 투톤 피부 + 줄무늬/반점 (정점 색)
 * opt: { back, belly, halfHeight, blend, stripe:{color,freq,phase,width,mix},
 *        spot:{color,size,mix}, bellyGlow }
 */
function paintSkin(geo, opt) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  const back = new THREE.Color(opt.back);
  const belly = new THREE.Color(opt.belly);
  const c = new THREE.Color();
  const other = new THREE.Color();
  const hh = opt.halfHeight || 0.5;
  const lo = opt.blend ? opt.blend[0] : -0.28;
  const hi = opt.blend ? opt.blend[1] : 0.26;
  const wave = opt.wave === undefined ? 0.12 : opt.wave;
  const st = opt.stripe;
  const sp = opt.spot;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // 등·배 경계를 물결지게 해 단조로운 가로선을 없앤다
    const yy = y + Math.sin(z * 1.9 + x * 2.2) * wave * hh;
    const t = smoothstep(lo, hi, yy / hh);
    c.copy(belly).lerp(back, t);
    // 배 쪽에 살짝 밝은 반사
    if (opt.bellyGlow !== false) {
      c.offsetHSL(0, 0, (1 - t) * 0.045);
    }
    if (st) {
      const ph = (z - (st.phase || 0)) * st.freq + Math.sin(x * 3.1) * (st.wobble === undefined ? 0.5 : st.wobble);
      const s = Math.sin(ph);
      const soft = st.soft === undefined ? 0.15 : st.soft;
      const kw = smoothstep(soft, soft + 0.4, s);
      c.lerp(other.set(st.color), kw * (st.mix === undefined ? 0.92 : st.mix));
      if (st.dark !== undefined) {
        const kd = smoothstep(soft, soft + 0.4, -s);
        c.lerp(other.set(st.dark), kd * (st.darkMix === undefined ? 0.45 : st.darkMix));
      }
    }
    if (sp) {
      const h = Math.sin(x * 21.7 + y * 13.3 + z * 17.9) * 43758.5453;
      const f = h - Math.floor(h);
      if (f > (sp.threshold === undefined ? 0.82 : sp.threshold)) {
        other.set(sp.color);
        c.lerp(other, (sp.mix === undefined ? 0.8 : sp.mix) * (0.3 + 0.7 * t));
      }
    }
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * 얇은 판(지느러미) — xy 평면 도형을 두께만큼 밀어낸다.
 * points: [[x, y], ...]  smooth: 스플라인으로 부드럽게 잇는다
 */
function plate(points, thickness, opts) {
  const o = opts || {};
  const t = thickness === undefined ? 0.05 : thickness;
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  if (o.smooth) {
    shape.splineThru(points.slice(1).map(([a, b]) => new THREE.Vector2(a, b)));
  } else {
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: t,
    bevelEnabled: true,
    bevelThickness: t * 0.45,
    bevelSize: t * 0.7,
    bevelSegments: 2,
    steps: 1,
    curveSegments: o.curveSegments || 8,
  });
  geo.translate(0, 0, -t * 0.7);
  return geo;
}

/** 세로 지느러미(등·꼬리) — (뒤로, 위로) 좌표계 → 몸통의 z-y 평면 */
function vfin(points, thickness, color, opt) {
  const g = plate(points, thickness, opt);
  g.rotateY(-Math.PI / 2);              // +x → +z(뒤), +y → +y
  return paint(g, color);
}

/** 가로 지느러미(가슴·배) — (옆으로, 앞뒤) 좌표계 → 몸통의 x-z 평면 */
function hfin(points, thickness, color, opt) {
  const g = plate(points, thickness, opt);
  g.rotateX(-Math.PI / 2);              // +y → -z(앞)
  return paint(g, color);
}

/** 순수 원뿔(이빨·가시) — 부드러운 6각 */
function spikeGeo(r, h, seg) {
  const g = new THREE.ConeGeometry(r, h, seg || 6, 1, false);
  return g;
}

/** 눈 — 흰자 + 검은자(작은 반사점 포함) */
function eyeParts(parts, x, y, z, size, outward) {
  const white = new THREE.SphereGeometry(size, 10, 8);
  white.scale(1, 1, 0.85);
  parts.push(xf(paint(white, 0xf8fdff), [x, y, z]));
  const pupil = new THREE.SphereGeometry(size * 0.56, 8, 6);
  pupil.scale(1, 1, 0.75);
  const ox = (outward === undefined ? (x >= 0 ? 1 : -1) : outward) * size * 0.52;
  parts.push(xf(paint(pupil, 0x0b1014), [x + ox, y + size * 0.05, z - size * 0.34]));
  const glint = new THREE.SphereGeometry(size * 0.2, 6, 5);
  parts.push(xf(paint(glint, 0xffffff), [x + ox * 1.25, y + size * 0.34, z - size * 0.5]));
  return parts;
}

/** 병합 후 꼬리 쪽으로 갈수록 커지는 굽힘 계수(aBend)를 심는다 */
function bendify(geo, z0, z1) {
  const p = geo.attributes.position;
  const arr = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    arr[i] = clamp01((p.getZ(i) - z0) / (z1 - z0));
  }
  geo.setAttribute('aBend', new THREE.BufferAttribute(arr, 1));
  return geo;
}

/** 조각들을 하나의 지오메트리로 (굽힘 계수 포함) */
function assemble(parts, z0, z1) {
  // 인덱스가 있는 조각과 없는 조각을 섞으면 병합이 실패한다 — 모두 비인덱스로 통일
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false);
  merged.computeBoundingSphere();
  bendify(merged, z0, z1);
  return merged;
}

/** 유영 셰이더 재질 — 몸통이 좌우로 S 자로 흔들린다 */
function swimMaterial(params, bend) {
  const mat = new THREE.MeshPhongMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ANIM.time;
    shader.uniforms.uBendAmp = { value: bend.amp };
    shader.uniforms.uBendFreq = { value: bend.freq };
    shader.uniforms.uBendSpeed = { value: bend.speed };
    shader.vertexShader =
      'uniform float uTime;\nuniform float uBendAmp;\nuniform float uBendFreq;\nuniform float uBendSpeed;\nattribute float aBend;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float bt = aBend;
          float seed = modelMatrix[3].x * 0.11 + modelMatrix[3].z * 0.07;
          #ifdef USE_INSTANCING
            seed = instanceMatrix[3].x * 0.11 + instanceMatrix[3].z * 0.07;
          #endif
          float ph = uTime * uBendSpeed + seed - bt * uBendFreq;
          float k = bt * bt;
          transformed.x += sin(ph) * uBendAmp * k;
          transformed.y += cos(ph * 0.7) * uBendAmp * 0.16 * k;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'swimBend';
  return mat;
}

/** 같은 위상으로 꼬리 그룹을 흔든다 (셰이더 굽힘과 이어지게) */
function tailSwing(m, t) {
  const b = m.bend;
  if (!b || !m.tail) return;
  const seed = m.group.position.x * 0.11 + m.group.position.z * 0.07;
  const ph = t * b.speed + seed - m.tailT * b.freq;
  const k = m.tailT * m.tailT;
  m.tail.position.x = Math.sin(ph) * b.amp * k;
  m.tail.position.y = Math.cos(ph * 0.7) * b.amp * 0.16 * k;
  m.tail.rotation.y = Math.sin(ph) * b.wag;
}

/**
 * 어류 모델의 유영 갱신 — 모든 어류에 공통.
 * t 는 ANIM.time.value 와 같은 값이어야 몸통 굽힘과 꼬리가 맞는다.
 */
export function swim(m, t) {
  if (!m) return;
  tailSwing(m, t);
  if (m.fins) {
    for (let i = 0; i < m.fins.length; i++) {
      const f = m.fins[i];
      f.obj.rotation[f.axis] = f.base + Math.sin(t * f.speed + f.phase) * f.amp;
    }
  }
  if (m.jaw) {
    m.jaw.rotation.x = m.jawBase + Math.sin(t * 1.3) * 0.06;
  }
}

/* =========================================================
   플레이어 잠수정
   ========================================================= */
export function makeSubmarine() {
  const g = new THREE.Group();

  const body = new THREE.SphereGeometry(1, 18, 14);
  body.scale(0.86, 0.78, 2.05);
  g.add(mesh(body, MET.hull));

  // 하부 선체
  const belly = new THREE.SphereGeometry(1, 16, 10);
  belly.scale(0.86, 0.5, 1.85);
  const bellyMesh = mesh(belly, MET.hullDark, 0, -0.42, 0);
  g.add(bellyMesh);

  // 조종석 돔
  const dome = new THREE.SphereGeometry(0.62, 16, 12);
  dome.scale(1, 0.95, 1.25);
  g.add(mesh(dome, MET.glass, 0, 0.46, -0.5));
  const domeRim = new THREE.TorusGeometry(0.56, 0.06, 6, 20);
  const rimMesh = mesh(domeRim, MET.accent, 0, 0.5, -0.5);
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.scale.set(1, 1.2, 1);
  g.add(rimMesh);

  // 앞 노즈콘
  const nose = new THREE.ConeGeometry(0.5, 1.3, 16);
  nose.rotateX(-Math.PI / 2);
  g.add(mesh(nose, MET.accent, 0, -0.02, -2.1));

  // 몸통 링
  const ring = new THREE.TorusGeometry(0.9, 0.075, 6, 22);
  const ringMesh = mesh(ring, MET.accent, 0, 0, 0.55);
  ringMesh.rotation.y = Math.PI / 2;
  ringMesh.scale.set(0.85, 0.98, 1);
  g.add(ringMesh);
  const ring2 = ringMesh.clone();
  ring2.position.z = 1.2;
  ring2.scale.set(0.72, 0.85, 1);
  g.add(ring2);

  // 수직 꼬리 날개
  const finGeo = new THREE.BoxGeometry(0.1, 0.95, 0.85);
  const fin = mesh(finGeo, MET.accent, 0, 0.85, 1.15);
  fin.rotation.x = -0.14;
  g.add(fin);

  // 좌우 날개
  const wingGeo = new THREE.BoxGeometry(1.15, 0.1, 0.62);
  const wingL = mesh(wingGeo, MET.accent, -1.15, -0.1, 0.35);
  wingL.rotation.z = 0.22;
  const wingR = mesh(wingGeo, MET.accent, 1.15, -0.1, 0.35);
  wingR.rotation.z = -0.22;
  g.add(wingL, wingR);

  // 스크류
  const prop = new THREE.Group();
  prop.position.set(0, 0, 1.98);
  prop.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 10), MET.metalDark, 0, 0, 0));
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.2), MET.metal);
    blade.position.y = 0.34;
    blade.rotation.z = 0.45;
    const holder = new THREE.Group();
    holder.rotation.z = (i / 4) * Math.PI * 2;
    holder.add(blade);
    prop.add(holder);
  }
  prop.rotation.x = Math.PI / 2;
  g.add(prop);

  // 후미 추진 링
  const thr = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.05, 6, 18),
    new THREE.MeshBasicMaterial({ color: 0x2ec8c8 })
  );
  thr.position.set(0, 0, 1.72);
  g.add(thr);
  // 전조등
  const lampGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.26, 10);
  lampGeo.rotateX(Math.PI / 2);
  const lampL = mesh(lampGeo, MET.eyeYellow, -0.46, 0.22, -1.72);
  const lampR = mesh(lampGeo, MET.eyeYellow, 0.46, 0.22, -1.72);
  g.add(lampL, lampR);

  // 전조등 빛 원뿔(가짜 볼륨)
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xbdf4ff, transparent: true, opacity: 0.05,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const coneGeo = new THREE.ConeGeometry(1.9, 20, 16, 1, true);
  coneGeo.rotateX(Math.PI / 2);
  coneGeo.translate(0, 0, -10.4);
  const beam = new THREE.Mesh(coneGeo, coneMat);
  beam.position.set(0, 0.18, -1.8);
  g.add(beam);

  // 안테나
  const ant = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5), MET.metalDark, 0, 0.85, -0.1);
  ant.rotation.z = 0.16;
  g.add(ant);
  g.add(spriteGlow(0x8ff8ff, 0.9, 0.7).translateY(1.3));

  // 조명
  const spot = new THREE.SpotLight(0xcdf6ff, 26, 80, 0.5, 0.72, 1.1);
  spot.position.set(0, 0.25, -1.8);
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, -1.2, -26);
  g.add(spot, spotTarget);
  spot.target = spotTarget;

  const under = new THREE.PointLight(0x54e6ff, 6, 16, 1.6);
  under.position.set(0, -0.9, 0.4);
  g.add(under);

  return { group: g, propeller: prop, spot, beam };
}

/* =========================================================
   백상아리 — 유선형 몸통 · 회청색 등 / 흰 배
   ========================================================= */
const SHARK_BEND = { amp: 0.15, freq: 3.3, speed: 3.4, wag: 0.40 };

let _sharkGeo = null;
let _sharkTailGeo = null;
let _sharkMat = null;

function sharkGeometry() {
  if (_sharkGeo) return _sharkGeo;
  const BACK = 0x60727c;
  const BELLY = 0xf4f9f8;
  const FIN = 0x4e5d66;
  const DARK = 0x3c4a52;
  const TOOTH = 0xfbfdf6;

  const profile = [
    [-2.15, 0.025], [-1.96, 0.13], [-1.72, 0.25], [-1.42, 0.37], [-1.05, 0.47],
    [-0.60, 0.55], [-0.10, 0.585], [0.40, 0.55], [0.90, 0.45], [1.30, 0.33],
    [1.65, 0.22], [1.90, 0.155], [2.02, 0.135],
  ];
  const body = bodyGeometry(profile, { radial: 22, sx: 0.74, sy: 0.99 });
  paintSkin(body, { back: BACK, belly: BELLY, halfHeight: 0.585, blend: [-0.46, 0.16], wave: 0.2 });

  const parts = [body];

  // 등지느러미 (큰 삼각형, 뒤로 젖혀진 끝)
  parts.push(xf(vfin([
    [-0.34, 0.50], [-0.06, 0.86], [0.18, 1.20], [0.30, 1.28],
    [0.36, 1.02], [0.55, 0.66], [0.70, 0.50],
  ], 0.07, FIN), [0, 0.02, 0.02], [0, 0, 0], [1, 1, 0.92]));

  // 제2등지느러미
  parts.push(xf(vfin([
    [-0.16, 0.28], [-0.02, 0.46], [0.10, 0.48], [0.16, 0.30],
  ], 0.05, FIN), [0, 0.0, 1.32], [0, 0, 0], [1, 1, 1]));

  // 뒷지느러미
  parts.push(xf(vfin([
    [-0.14, -0.26], [0.0, -0.42], [0.12, -0.44], [0.14, -0.26],
  ], 0.05, FIN), [0, 0, 1.40], [0, 0, 0], [1, 1, 1]));

  // 가슴지느러미 (좌우 · 뒤로 살짝 젖힘)
  for (const s of [-1, 1]) {
    parts.push(xf(hfin([
      [0, 0.46], [0.52, 0.18], [0.96, -0.12], [1.22, -0.34],
      [0.82, -0.46], [0.30, -0.40], [0, -0.16],
    ].map(([x, y]) => [x * s, y]), 0.055, FIN),
      [0.09 * s, -0.13, -0.55], [0, 0, -0.20 * s], [1, 1, 1]));
  }

  // 배지느러미
  for (const s of [-1, 1]) {
    parts.push(xf(hfin([
      [0, 0.16], [0.24, 0.02], [0.30, -0.14], [0.14, -0.16], [0, -0.06],
    ].map(([x, y]) => [x * s, y]), 0.045, FIN),
      [0.09 * s, -0.36, 1.16], [0, 0, 0], [1, 1, 1]));
  }

  // 눈 (흰자 + 검은자)
  const reye = radiusAt(profile, -1.62) * 0.74;
  for (const s of [-1, 1]) {
    eyeParts(parts, reye * 0.86 * s, 0.17, -1.62, 0.098, s);
  }

  // 아가미 (얇은 홈)
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -0.92 + i * 0.15;
      const rr = radiusAt(profile, z) * 0.74;
      const g = new THREE.BoxGeometry(0.022, 0.28, 0.045);
      parts.push(xf(paint(g, DARK), [rr * 0.94 * s, -0.02, z], [0, 0, 0.16 * s], [1, 1, 1]));
    }
  }

  // 입 — 아래턱 라인 + 작은 이빨 (몸통 표면에 붙인다)
  const mz = -1.80;
  const mr = radiusAt(profile, mz);
  const mouthGeo = new THREE.SphereGeometry(1, 14, 8);
  mouthGeo.scale(mr * 0.95, 0.05, 0.40);
  parts.push(xf(paint(mouthGeo, 0x2a1e20), [0, -mr * 0.84, mz], [0.14, 0, 0], [1, 1, 1]));
  for (let i = 0; i < 5; i++) {
    const t = (i / 4 - 0.5) * 2;
    const tooth = spikeGeo(0.021, 0.085, 5);
    parts.push(xf(paint(tooth, TOOTH),
      [t * mr * 0.55, -mr * 0.84, mz - 0.06], [Math.PI - 0.15, 0, 0], [1, 1, 1]));
  }

  _sharkGeo = assemble(parts, -0.9, 2.02);
  return _sharkGeo;
}

function sharkTailGeometry() {
  if (_sharkTailGeo) return _sharkTailGeo;
  const FIN = 0x4e5d66;
  // 초승달 꼬리 — 위아래 갈라진 날
  const g = vfin([
    [0.00, 0.10], [0.20, 0.40], [0.46, 0.80], [0.62, 1.02],
    [0.40, 0.42], [0.26, 0.04], [0.34, -0.34], [0.42, -0.66],
    [0.24, -0.44], [0.06, -0.12],
  ], 0.075, FIN, { smooth: true, curveSegments: 10 });
  // 굽힘은 꼬리 그룹 회전으로 표현하므로 계수를 0 으로 둔다
  bendify(g, 0, 1);
  const ab = g.attributes.aBend;
  for (let i = 0; i < ab.count; i++) ab.setX(i, 0);
  _sharkTailGeo = g;
  return _sharkTailGeo;
}

export function makeShark() {
  if (!_sharkMat) {
    _sharkMat = swimMaterial(
      { vertexColors: true, shininess: 26, specular: 0x33454f },
      SHARK_BEND
    );
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(sharkGeometry(), _sharkMat));
  const tail = new THREE.Group();
  tail.position.set(0, 0, 2.00);
  tail.add(new THREE.Mesh(sharkTailGeometry(), _sharkMat));
  g.add(tail);
  return {
    group: g, tail, body: g.children[0],
    bend: SHARK_BEND, tailT: 0.93, fins: [],
  };
}

/* =========================================================
   귀상어(해머헤드) — 넓은 머리 날개
   ========================================================= */
const HAMMER_BEND = { amp: 0.16, freq: 3.1, speed: 3.0, wag: 0.44 };

let _hammerGeo = null;
let _hammerTailGeo = null;
let _hammerMat = null;

function cephalofoil(span, opts) {
  const o = opts || {};
  const pts = [
    [-1.0, 0.015], [-0.92, 0.10], [-0.68, 0.17], [-0.30, 0.205], [0.05, 0.21],
    [0.42, 0.20], [0.74, 0.145], [0.94, 0.06],
  ].map(([t, r]) => new THREE.Vector2(Math.max(0.01, r), t * span));
  const geo = new THREE.LatheGeometry(pts, 16);
  geo.rotateZ(-Math.PI / 2);                    // 축을 X(좌우) 로
  geo.scale(o.sx === undefined ? 1 : o.sx, 0.55, 1.7);  // 납작 + 앞뒤로 넓게
  return geo;
}

function hammerGeometry() {
  if (_hammerGeo) return _hammerGeo;
  const BACK = 0x6f776a;
  const BELLY = 0xeef4ec;
  const FIN = 0x565e52;
  const DARK = 0x3f463c;
  const TOOTH = 0xfbfdf6;

  const profile = [
    [-1.92, 0.03], [-1.70, 0.16], [-1.40, 0.30], [-1.05, 0.42], [-0.65, 0.50],
    [-0.20, 0.535], [0.35, 0.50], [0.85, 0.40], [1.25, 0.29], [1.60, 0.19],
    [1.85, 0.14], [1.98, 0.13],
  ];
  const body = bodyGeometry(profile, { radial: 22, sx: 0.76, sy: 0.97 });
  paintSkin(body, { back: BACK, belly: BELLY, halfHeight: 0.54, blend: [-0.34, 0.3] });

  const parts = [body];

  // 망치 모양 머리
  const head = cephalofoil(1.05, {});
  parts.push(xf(paintSkin(head, { back: BACK, belly: BELLY, halfHeight: 0.2, blend: [-0.5, 0.4] }),
    [0, 0.03, -1.74], [0, 0, 0], [1, 1, 1]));

  // 등지느러미 (길고 뾰족)
  parts.push(xf(vfin([
    [-0.36, 0.48], [-0.10, 0.90], [0.10, 1.34], [0.22, 1.46],
    [0.32, 1.10], [0.54, 0.66], [0.66, 0.48],
  ], 0.07, FIN), [0, 0.0, 0.0], [0, 0, 0], [1, 1, 0.9]));

  // 제2등지느러미
  parts.push(xf(vfin([
    [-0.14, 0.26], [0.0, 0.44], [0.12, 0.46], [0.15, 0.28],
  ], 0.05, FIN), [0, 0.0, 1.28], [0, 0, 0], [1, 1, 1]));

  // 가슴지느러미
  for (const s of [-1, 1]) {
    parts.push(xf(hfin([
      [0, 0.34], [0.40, 0.12], [0.78, -0.12], [0.92, -0.30],
      [0.60, -0.40], [0.22, -0.34], [0, -0.12],
    ].map(([x, y]) => [x * s, y]), 0.055, FIN),
      [0.08 * s, -0.20, -0.48], [0, 0, -0.20 * s], [1, 1, 1]));
  }

  // 배지느러미
  for (const s of [-1, 1]) {
    parts.push(xf(hfin([
      [0, 0.14], [0.22, 0.02], [0.28, -0.12], [0.12, -0.14], [0, -0.06],
    ].map(([x, y]) => [x * s, y]), 0.045, FIN),
      [0.08 * s, -0.33, 1.08], [0, 0, 0], [1, 1, 1]));
  }

  // 눈 — 망치 끝
  for (const s of [-1, 1]) {
    eyeParts(parts, 0.99 * s, 0.03, -1.78, 0.09, s);
  }

  // 입
  const mouth = new THREE.BoxGeometry(0.46, 0.05, 0.36);
  parts.push(xf(paint(mouth, 0x2a2c22), [0, -0.20, -1.90], [0.04, 0, 0], [1, 1, 1]));
  for (let i = 0; i < 6; i++) {
    const t = (i / 5 - 0.5) * 2;
    parts.push(xf(paint(spikeGeo(0.03, 0.13, 5), TOOTH),
      [t * 0.19, -0.19, -1.92], [Math.PI, 0, 0], [1, 1, 1]));
  }
  // 아가미 홈
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -0.72 + i * 0.14;
      const rr = radiusAt(profile, z) * 0.76;
      const g = new THREE.BoxGeometry(0.02, 0.26, 0.04);
      parts.push(xf(paint(g, DARK), [rr * 0.94 * s, -0.02, z], [0, 0, 0.16 * s], [1, 1, 1]));
    }
  }

  _hammerGeo = assemble(parts, -0.8, 1.98);
  return _hammerGeo;
}

function hammerTailGeometry() {
  if (_hammerTailGeo) return _hammerTailGeo;
  const FIN = 0x565e52;
  const g = vfin([
    [0.00, 0.10], [0.24, 0.52], [0.44, 0.96], [0.56, 1.16],
    [0.36, 0.46], [0.24, 0.02], [0.30, -0.36], [0.36, -0.62],
    [0.20, -0.40], [0.05, -0.10],
  ], 0.07, FIN, { smooth: true, curveSegments: 10 });
  bendify(g, 0, 1);
  const ab = g.attributes.aBend;
  for (let i = 0; i < ab.count; i++) ab.setX(i, 0);
  _hammerTailGeo = g;
  return _hammerTailGeo;
}

export function makeHammerhead() {
  if (!_hammerMat) {
    _hammerMat = swimMaterial(
      { vertexColors: true, shininess: 20, specular: 0x2d3a32 },
      HAMMER_BEND
    );
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(hammerGeometry(), _hammerMat));
  const tail = new THREE.Group();
  tail.position.set(0, 0, 1.96);
  tail.add(new THREE.Mesh(hammerTailGeometry(), _hammerMat));
  g.add(tail);
  return {
    group: g, tail, body: g.children[0],
    bend: HAMMER_BEND, tailT: 0.94, fins: [],
  };
}

/* =========================================================
   발광 해파리
   ========================================================= */
let _jellyGeo = null;
let _jellyTentGeo = null;
let _jellyGeoCore = null;
let _jellyBell = null;

function jellyGeometries() {
  if (_jellyGeo) return;
  const bell = new THREE.SphereGeometry(0.85, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const rim = new THREE.TorusGeometry(0.8, 0.055, 6, 22);
  rim.rotateX(Math.PI / 2);
  _jellyGeo = mergeGeometries([paint(rim, 0xffffff)], false);
  _jellyGeoCore = new THREE.SphereGeometry(0.3, 8, 6);
  _jellyBell = bell;

  const parts = [];
  const tGeo = new THREE.CylinderGeometry(0.03, 0.012, 2.4, 4);
  tGeo.translate(0, -1.2, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(placed(tGeo, [Math.cos(a) * 0.48, -0.12, Math.sin(a) * 0.48],
      [Math.sin(a) * 0.18, 0, Math.cos(a) * 0.18], [1, 1, 1], 0xffffff));
  }
  _jellyTentGeo = mergeGeometries(parts, false);
}

export function makeJellyfish(color) {
  jellyGeometries();
  const g = new THREE.Group();

  const bell = new THREE.Mesh(
    _jellyBell,
    new THREE.MeshPhongMaterial({
      color: color, emissive: color, emissiveIntensity: 0.75,
      transparent: true, opacity: 0.4, shininess: 90, side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  g.add(bell);

  const rim = new THREE.Mesh(
    _jellyGeo,
    new THREE.MeshBasicMaterial({ color: 0xe9b6ff, transparent: true, opacity: 0.85, depthWrite: false })
  );
  g.add(rim);

  const core = new THREE.Mesh(
    _jellyGeoCore,
    new THREE.MeshBasicMaterial({ color: 0xffe4ff, transparent: true, opacity: 0.9, depthWrite: false })
  );
  g.add(core);

  const tentacles = new THREE.Mesh(
    _jellyTentGeo,
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.42, depthWrite: false })
  );
  g.add(tentacles);

  const glow = spriteGlow(color, 5.2, 0.32);
  g.add(glow);
  return { group: g, bell, tentacles, rim, glow };
}

/* =========================================================
   독가시 복어 — 둥근 몸통 · 짧은 부채 꼬리
   ========================================================= */
const PUFFER_BEND = { amp: 0.07, freq: 2.4, speed: 2.2, wag: 0.30 };

let _pufferBodyGeo = null;
let _pufferTailGeo = null;
let _pufferSpikeGeo = null;
let _pufferMat = null;
let _pufferSpikeMat = null;

function pufferGeometries() {
  if (_pufferBodyGeo) return;
  const BODY = 0xd9aa52;
  const BELLY = 0xfff5d8;
  const FIN = 0xe0b45c;
  const SPOT = 0x5a3f22;
  const MOUTH = 0xc08a58;

  const profile = [
    [-0.96, 0.03], [-0.86, 0.34], [-0.70, 0.58], [-0.50, 0.74], [-0.26, 0.84],
    [0.00, 0.87], [0.26, 0.83], [0.50, 0.72], [0.70, 0.55], [0.84, 0.34],
    [0.92, 0.18],
  ];
  const body = bodyGeometry(profile, { radial: 22, sx: 0.94, sy: 0.92 });
  paintSkin(body, {
    back: BODY, belly: BELLY, halfHeight: 0.80, blend: [-0.42, 0.34],
    spot: { color: SPOT, threshold: 0.90, mix: 0.5 },
  });
  const parts = [body];

  // 등지느러미 · 뒷지느러미 (부드러운 부채)
  parts.push(xf(vfin([
    [-0.20, 0.70], [-0.06, 0.94], [0.10, 0.96], [0.22, 0.72],
  ], 0.05, FIN, { smooth: true }), [0, 0.0, 0.16], [0, 0, 0], [1, 1, 1]));
  parts.push(xf(vfin([
    [-0.20, -0.70], [-0.06, -0.92], [0.10, -0.94], [0.22, -0.70],
  ], 0.05, FIN, { smooth: true }), [0, 0.0, 0.20], [0, 0, 0], [1, 1, 1]));

  // 가슴지느러미 (작고 둥글다)
  for (const s of [-1, 1]) {
    parts.push(xf(hfin([
      [0, 0.16], [0.20, 0.06], [0.26, -0.10], [0.12, -0.16], [0, -0.08],
    ].map(([x, y]) => [x * s, y]), 0.04, FIN, { smooth: true }),
      [0.80 * s, -0.06, -0.10], [0, 0.3 * s, -0.25 * s], [1, 1, 1]));
  }

  // 눈 (크고 동그랗다) + 입
  for (const s of [-1, 1]) {
    eyeParts(parts, 0.42 * s, 0.21, -0.76, 0.105, s);
  }
  const mouth = new THREE.TorusGeometry(0.085, 0.032, 6, 14);
  parts.push(xf(paint(mouth, MOUTH), [0, -0.14, -0.90], [0, 0, 0], [1, 1, 1]));

  _pufferBodyGeo = assemble(parts, -0.7, 0.9);

  // 꼬리 — 짧은 부채 (세로)
  const tail = vfin([
    [0, 0.26], [0.24, 0.40], [0.38, 0.30], [0.42, 0.02],
    [0.36, -0.24], [0.20, -0.34], [0, -0.22],
  ], 0.04, FIN, { smooth: true });
  bendify(tail, 0, 1);
  const ab = tail.attributes.aBend;
  for (let i = 0; i < ab.count; i++) ab.setX(i, 0);
  _pufferTailGeo = tail;

  // 가시 — 부드러운 6각 침
  const spikeG = spikeGeo(0.045, 0.30, 6);
  const spikeParts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const n = 72;
  for (let i = 0; i < n; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const d = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    );
    const geo = spikeG.clone();
    const q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize());
    const m = new THREE.Matrix4().compose(
      d.clone().multiplyScalar(0.80),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    geo.applyMatrix4(m);
    spikeParts.push(paint(geo, 0xd9a252));
  }
  _pufferSpikeGeo = mergeGeometries(spikeParts, false);

  if (!_pufferMat) {
    _pufferMat = swimMaterial(
      { vertexColors: true, shininess: 34, specular: 0x6b5a30 },
      PUFFER_BEND
    );
    _pufferSpikeMat = new THREE.MeshPhongMaterial({
      vertexColors: true, shininess: 70, specular: 0x8a7340,
    });
  }
}

export function makePuffer() {
  pufferGeometries();
  const g = new THREE.Group();
  const body = new THREE.Mesh(_pufferBodyGeo, _pufferMat);
  const spikes = new THREE.Mesh(_pufferSpikeGeo, _pufferSpikeMat);
  const tail = new THREE.Group();
  tail.position.set(0, 0, 0.90);
  tail.add(new THREE.Mesh(_pufferTailGeo, _pufferMat));
  g.add(body, spikes, tail);
  return {
    group: g, body, spikes, tail,
    bend: PUFFER_BEND, tailT: 0.95, fins: [],
  };
}

/* =========================================================
   쏠배감펭(lionfish) — 세로로 넓적한 몸 · 줄무늬 · 부채 지느러미
   ========================================================= */
const LION_BEND = { amp: 0.11, freq: 2.9, speed: 2.6, wag: 0.34 };

let _lionGeo = null;
let _lionTailGeo = null;
let _lionFanL = null;
let _lionFanR = null;
let _lionMat = null;
let _lionFinMat = null;

function lionGeometries() {
  if (_lionGeo) return;
  const BODY = 0xc4482c;
  const STRIPE = 0xfff0e0;
  const FIN = 0xe8764d;
  const DARK = 0x8f2f1e;

  const profile = [
    [-1.02, 0.03], [-0.92, 0.20], [-0.78, 0.36], [-0.60, 0.50], [-0.36, 0.60],
    [-0.06, 0.655], [0.24, 0.62], [0.50, 0.50], [0.72, 0.34], [0.88, 0.18],
    [0.96, 0.10],
  ];
  const body = bodyGeometry(profile, { radial: 20, sx: 0.40, sy: 1.02 });
  paintSkin(body, {
    back: BODY, belly: 0xa8381f, halfHeight: 0.66,
    blend: [-0.75, 0.55], wave: 0.3,
    stripe: {
      color: 0xfff2e4, freq: 16.0, phase: -0.55, mix: 0.95,
      dark: 0x7c2413, darkMix: 0.55, soft: 0.2, wobble: 0.45,
    },
  });

  const parts = [body];

  // 등지느러미 — 물결치는 막 + 긴 가시 줄
  parts.push(xf(vfin([
    [-0.44, 0.48], [-0.24, 0.84], [0.00, 0.97], [0.22, 0.88],
    [0.44, 0.93], [0.66, 0.80], [0.88, 0.60], [1.00, 0.44],
    [0.86, 0.40], [0.48, 0.43], [0.10, 0.45], [-0.30, 0.45],
  ], 0.028, FIN, { smooth: true }), [0, 0, 0], [0, 0, 0], [1, 1, 1]));

  const rayParts = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const z = -0.30 + t * 1.10;
    const h = 0.62 - Math.abs(t - 0.34) * 0.34;
    const g = spikeGeo(0.022, h, 5);
    const lean = -0.22 + t * 0.5;
    rayParts.push(xf(paint(g, 0xf2c6a8), [0, 0.50 + h * 0.42, z], [lean, 0, 0], [1, 1, 1]));
  }
  parts.push(mergeGeometries(rayParts, false));

  // 배지느러미 · 뒷지느러미 가시
  const lowRays = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const h = 0.40 - t * 0.13;
    const g = spikeGeo(0.02, h, 5);
    lowRays.push(xf(paint(g, FIN), [0, -0.44 - h * 0.44, 0.0 + t * 0.62],
      [Math.PI + 0.28 - t * 0.5, 0, 0], [1, 1, 1]));
  }
  parts.push(mergeGeometries(lowRays, false));

  // 눈 (몸통 옆면)
  for (const s of [-1, 1]) {
    eyeParts(parts, 0.30 * s, 0.20, -0.80, 0.085, s);
  }
  // 입
  const mouth = new THREE.BoxGeometry(0.24, 0.10, 0.16);
  parts.push(xf(paint(mouth, DARK), [0, -0.16, -0.98], [0.12, 0, 0], [1, 1, 1]));

  _lionGeo = assemble(parts, -0.9, 0.95);

  // 꼬리 — 큰 부채
  const tail = vfin([
    [0.00, 0.10], [0.22, 0.46], [0.40, 0.62], [0.52, 0.52],
    [0.46, 0.10], [0.52, -0.34], [0.40, -0.56], [0.20, -0.42],
  ], 0.035, FIN, { smooth: true });
  bendify(tail, 0, 1);
  const ab = tail.attributes.aBend;
  for (let i = 0; i < ab.count; i++) ab.setX(i, 0);
  _lionTailGeo = tail;

  // 가슴지느러미 부채 (좌우 · 퍼덕임)
  function fan(sign) {
    const shape = new THREE.Shape();
    const n = 24;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = -0.62 + (i / n) * 1.68;
      const r = 0.86 + Math.sin(i * 2.6) * 0.018;
      pts.push([Math.cos(a) * r * 0.92 * sign, Math.sin(a) * r]);
    }
    shape.moveTo(0, 0);
    for (const [x, y] of pts) shape.lineTo(x, y);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.022, bevelEnabled: false, steps: 1, curveSegments: 6,
    });
    geo.rotateX(-Math.PI / 2);    // 수평으로 눕힌 부채
    geo.rotateZ(0.30 * sign);     // 바깥으로 살짝 기울임
    return paint(geo, 0xef8f66);
  }
  _lionFanL = fan(-1);
  _lionFanR = fan(1);

  if (!_lionMat) {
    _lionMat = swimMaterial(
      { vertexColors: true, shininess: 44, specular: 0x8a4a30 },
      LION_BEND
    );
    _lionFinMat = new THREE.MeshPhongMaterial({
      vertexColors: true, shininess: 22, specular: 0x5a3320,
      side: THREE.DoubleSide, transparent: true, opacity: 0.88,
    });
  }
}

export function makeLionfish() {
  lionGeometries();
  const g = new THREE.Group();
  const body = new THREE.Mesh(_lionGeo, _lionMat);
  g.add(body);

  const pivotL = new THREE.Group();
  pivotL.position.set(-0.28, -0.02, -0.22);
  pivotL.add(new THREE.Mesh(_lionFanL, _lionFinMat));
  const pivotR = new THREE.Group();
  pivotR.position.set(0.28, -0.02, -0.22);
  pivotR.add(new THREE.Mesh(_lionFanR, _lionFinMat));
  g.add(pivotL, pivotR);

  const tail = new THREE.Group();
  tail.position.set(0, 0, 0.92);
  tail.add(new THREE.Mesh(_lionTailGeo, _lionFinMat));
  g.add(tail);

  return {
    group: g, body, tail, bend: LION_BEND, tailT: 0.95,
    fins: [
      { obj: pivotL, axis: 'z', base: 0.15, amp: 0.30, speed: 2.1, phase: 0.0 },
      { obj: pivotR, axis: 'z', base: -0.15, amp: -0.30, speed: 2.1, phase: 0.0 },
    ],
  };
}

/* =========================================================
   심해 아귀 — 큰 입 · 유인 돌기
   ========================================================= */
const ANGLER_BEND = { amp: 0.08, freq: 2.0, speed: 1.9, wag: 0.26 };

let _anglerGeo = null;
let _anglerJawGeo = null;
let _anglerTailGeo = null;
let _anglerMat = null;
let _anglerJawMat = null;

function anglerGeometries() {
  if (_anglerGeo) return;
  const SKIN = 0x3a5064;
  const BELLY = 0x6b8298;
  const TOOTH = 0xf2f7ea;

  // 머리가 크게 부푼 몸통
  const profile = [
    [-1.30, 0.04], [-1.14, 0.34], [-0.94, 0.60], [-0.66, 0.80], [-0.30, 0.92],
    [0.06, 0.94], [0.42, 0.84], [0.72, 0.60], [0.94, 0.32], [1.06, 0.14],
  ];
  const body = bodyGeometry(profile, { radial: 20, sx: 0.86, sy: 0.86 });
  paintSkin(body, { back: SKIN, belly: BELLY, halfHeight: 0.9, blend: [-0.5, 0.2] });
  const parts = [body];

  // 위턱 이빨
  for (let i = 0; i < 8; i++) {
    const t = (i / 7 - 0.5) * 2;
    const g = spikeGeo(0.028, 0.17, 5);
    parts.push(xf(paint(g, TOOTH), [t * 0.32, -0.32, -1.16 + Math.abs(t) * 0.16],
      [Math.PI - 0.3, 0, 0], [1, 1, 1]));
  }
  // 눈 (작고 밝다)
  for (const s of [-1, 1]) {
    eyeParts(parts, 0.44 * s, 0.34, -1.02, 0.075, s);
  }
  // 가슴지느러미 (둥근 부채)
  for (const s of [-1, 1]) {
    parts.push(xf(hfin([
      [0, 0.20], [0.24, 0.16], [0.34, -0.02], [0.26, -0.20], [0.04, -0.16],
    ].map(([x, y]) => [x * s, y]), 0.04, SKIN, { smooth: true }),
      [0.70 * s, -0.34, -0.62], [0, 0.2 * s, -0.3 * s], [1, 1, 1]));
  }

  _anglerGeo = assemble(parts, -0.7, 1.05);

  // 아래턱 (열린다)
  const jawProfile = [
    [-0.62, 0.02], [-0.5, 0.22], [-0.28, 0.36], [0.0, 0.40], [0.24, 0.32], [0.42, 0.18],
  ];
  const jaw = bodyGeometry(jawProfile, { radial: 16, sx: 0.84, sy: 0.5 });
  paintSkin(jaw, { back: SKIN, belly: BELLY, halfHeight: 0.34, blend: [-0.4, 0.3] });
  const jawParts = [jaw];
  for (let i = 0; i < 7; i++) {
    const t = (i / 6 - 0.5) * 2;
    const g = spikeGeo(0.024, 0.15, 5);
    jawParts.push(xf(paint(g, TOOTH), [t * 0.28, 0.15, -0.58 + Math.abs(t) * 0.14],
      [0.3, 0, 0], [1, 1, 1]));
  }
  _anglerJawGeo = mergeGeometries(jawParts, false);
  bendify(_anglerJawGeo, -0.7, 1.05);

  // 꼬리 — 둥근 부채
  const tail = vfin([
    [0.0, 0.14], [0.24, 0.40], [0.40, 0.46], [0.50, 0.26],
    [0.48, -0.02], [0.38, -0.30], [0.16, -0.34], [-0.02, -0.14],
  ], 0.045, SKIN, { smooth: true });
  bendify(tail, 0, 1);
  const ab = tail.attributes.aBend;
  for (let i = 0; i < ab.count; i++) ab.setX(i, 0);
  _anglerTailGeo = tail;

  if (!_anglerMat) {
    _anglerMat = swimMaterial({
      vertexColors: true, shininess: 30, specular: 0x3a5468,
      emissive: 0x081420, emissiveIntensity: 0.55,
    }, ANGLER_BEND);
    _anglerJawMat = swimMaterial({
      vertexColors: true, shininess: 20, specular: 0x2a3a48,
    }, ANGLER_BEND);
  }
}

export function makeAnglerfish() {
  anglerGeometries();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(_anglerGeo, _anglerMat));

  const jaw = new THREE.Group();
  jaw.position.set(0, -0.34, -1.14);
  jaw.add(new THREE.Mesh(_anglerJawGeo, _anglerJawMat));
  g.add(jaw);

  const tail = new THREE.Group();
  tail.position.set(0, 0, 1.04);
  tail.add(new THREE.Mesh(_anglerTailGeo, _anglerJawMat));
  g.add(tail);

  // 유인 돌기 — 머리에서 앞으로 휘어진 줄기
  const stalkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.14, 0.72, -0.78),
    new THREE.Vector3(0.18, 1.16, -0.86),
    new THREE.Vector3(0.16, 1.50, -1.16),
    new THREE.Vector3(0.12, 1.58, -1.44),
  ]);
  const stalk = new THREE.Mesh(new THREE.TubeGeometry(stalkCurve, 12, 0.035, 6, false), _anglerMat);
  g.add(stalk);
  const lure = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xc8fff4 })
  );
  lure.position.set(0.12, 1.58, -1.50);
  g.add(lure);
  const glow = spriteGlow(0x8ffff0, 3.4, 0.8);
  glow.position.copy(lure.position);
  g.add(glow);

  return {
    group: g, jaw, lure, glow, tail,
    jawBase: 0.10, bend: ANGLER_BEND, tailT: 0.95, fins: [],
  };
}

/* =========================================================
   거대 대왕오징어 보스 — 크라켄
   ========================================================= */
const KRAKEN = {
  mantle: 0x8c3a52,
  mantleDark: 0x6c2a40,
  arm: 0x7a3248,
  sucker: 0xe0b0be,
};

/** 아래로 말리는 다리·촉수 한 가닥 */
function krakenLimb(segCount, len, thick, curl, color) {
  // 곡선을 따라 가늘어지는 매끈한 다리 — TubeGeometry 를 직접 가공한다
  const pts = [];
  const p = new THREE.Vector3(0, 0, 0);
  let ang = 0;
  for (let i = 0; i <= segCount; i++) {
    pts.push(p.clone());
    const L = len / segCount;
    const dir = new THREE.Vector3(0, -Math.sin(ang), -Math.cos(ang));
    p.addScaledVector(dir, L);
    ang += curl;
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const segs = segCount * 6;
  const radial = 8;
  const geo = new THREE.TubeGeometry(curve, segs, thick, radial, false);
  const pos = geo.attributes.position;
  const c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const k = 1 - Math.pow(t, 0.75) * 0.92;   // 끝으로 갈수록 가늘게
    curve.getPointAt(t, c);
    for (let j = 0; j <= radial; j++) {
      const vi = i * (radial + 1) + j;
      pos.setXYZ(
        vi,
        c.x + (pos.getX(vi) - c.x) * k,
        c.y + (pos.getY(vi) - c.y) * k,
        c.z + (pos.getZ(vi) - c.z) * k
      );
    }
  }
  geo.computeVertexNormals();
  paint(geo, color);

  // 빨판 (아랫면을 따라 작은 구슬)
  const parts = [geo];
  const suckerG = new THREE.SphereGeometry(0.075, 6, 5);
  for (let i = 2; i < segs - 2; i += 3) {
    const t = i / segs;
    const k = 1 - Math.pow(t, 0.75) * 0.92;
    curve.getPointAt(t, c);
    const off = thick * k * 0.8;
    const sg = suckerG.clone();
    sg.scale(new THREE.Vector3(1, 0.6, 1));
    sg.translate(c.x, c.y - off, c.z);
    parts.push(paint(sg, KRAKEN.sucker));
  }
  return mergeGeometries(parts, false);
}

export function makeKraken() {
  const g = new THREE.Group();
  const skin = new THREE.MeshPhongMaterial({
    color: KRAKEN.mantle, shininess: 42, specular: 0xb07090,
    emissive: 0x2a0a18, emissiveIntensity: 0.55,
  });
  const skinDark = new THREE.MeshPhongMaterial({
    color: KRAKEN.mantleDark, shininess: 30, specular: 0x7a5060,
  });
  const limbMat = new THREE.MeshPhongMaterial({
    vertexColors: true, shininess: 16, specular: 0x5a3a48,
    emissive: 0x24080f, emissiveIntensity: 0.5,
  });

  // 머리 + 몸통(망토)
  const mantle = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), skin);
  mantle.scale.set(2.2, 2.1, 4.2);
  mantle.position.set(0, 0.1, 1.4);
  g.add(mantle);

  const tipG = new THREE.ConeGeometry(1.9, 3.6, 12);
  tipG.rotateX(-Math.PI / 2);
  const tip = new THREE.Mesh(tipG, skin);
  tip.position.set(0, 0.1, 6.0);
  g.add(tip);

  // 망토 끝의 지느러미
  const finG = new THREE.ConeGeometry(1.5, 2.6, 3);
  finG.rotateX(Math.PI / 2);
  const finL = mesh(finG, skinDark, -1.7, 0.3, 5.2);
  finL.rotation.z = 0.9;
  finL.scale.set(0.16, 1, 1);
  const finR = mesh(finG, skinDark, 1.7, 0.3, 5.2);
  finR.rotation.z = -0.9;
  finR.scale.set(0.16, 1, 1);
  g.add(finL, finR);

  // 머리
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), skin);
  head.scale.set(1.95, 1.8, 1.5);
  head.position.set(0, -0.1, -2.1);
  g.add(head);

  // 큰 눈 (금빛 홍채 + 가로 동공)
  const eyeWhite = new THREE.MeshPhongMaterial({
    color: 0xf7e2a8, shininess: 90, emissive: 0x8a6a18, emissiveIntensity: 0.9,
  });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0a0408 });
  const eyeG = new THREE.SphereGeometry(0.62, 14, 10);
  const pupilG = new THREE.SphereGeometry(0.32, 10, 8);
  [-1.32, 1.32].forEach((x) => {
    g.add(mesh(eyeG, eyeWhite, x, 0.42, -3.0));
    const p = mesh(pupilG, pupilMat, x, 0.42, -3.5);
    p.scale.set(1.25, 0.45, 0.5);
    g.add(p);
  });

  // 부리(입)
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 6), MET.bone);
  beak.rotation.x = Math.PI * 0.62;
  beak.position.set(0, -1.05, -2.9);
  g.add(beak);

  // 다리 8가닥 — 앞쪽으로 부채꼴로 뻗친다
  const arms = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 1.0, Math.sin(a) * 0.9 - 0.15, -2.4);
    const spread = 0.34;
    const dir = new THREE.Vector3(
      Math.cos(a) * spread, Math.sin(a) * spread - 0.12, -1
    ).normalize();
    pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const limb = new THREE.Mesh(
      krakenLimb(6, 6.2 + (i % 2) * 0.9, 0.56, 0.12, KRAKEN.arm), limbMat
    );
    pivot.add(limb);
    pivot.userData.phase = i * 1.7;
    g.add(pivot);
    arms.push({ pivot, limb });
  }

  // 긴 촉수 2가닥
  const tentacles = [];
  [-1, 1].forEach((side, i) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.15, -0.5, -2.5);
    const dir = new THREE.Vector3(side * 0.42, -0.16, -1).normalize();
    pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const limb = new THREE.Mesh(
      krakenLimb(8, 10.5, 0.32, 0.08, KRAKEN.arm), limbMat
    );
    pivot.add(limb);
    pivot.userData.phase = 0.8 + i * 2.1;
    g.add(pivot);
    tentacles.push({ pivot, limb });
  });

  // 몸통 발광 점
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });
  const dotG = new THREE.SphereGeometry(0.12, 6, 5);
  for (let i = 0; i < 9; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    g.add(mesh(dotG, dotMat,
      side * (1.9 - Math.floor(i / 2) * 0.16),
      -0.9 + Math.floor(i / 2) * 0.62,
      0.6 + Math.floor(i / 2) * 0.5));
  }

  return { group: g, arms, tentacles, glow: null };
}

/* =========================================================
   관상용 대형 생물 — 대왕고래 / 만타가오리 / 바다거북
   ========================================================= */
export function makeWhale() {
  const g = new THREE.Group();
  const skin = new THREE.MeshPhongMaterial({ color: 0x3d6285, shininess: 18 });
  const belly = new THREE.MeshPhongMaterial({ color: 0x9db4bf, shininess: 10 });

  const bodyG = new THREE.SphereGeometry(1, 20, 14);
  bodyG.scale(3.1, 2.85, 8.6);
  g.add(mesh(bodyG, skin));

  const belG = new THREE.SphereGeometry(1, 18, 12);
  belG.scale(2.75, 2.2, 7.6);
  const bel = mesh(belG, belly, 0, -1.0, -0.3);
  g.add(bel);

  const headG = new THREE.SphereGeometry(1, 18, 12);
  headG.scale(2.5, 2.4, 2.6);
  g.add(mesh(headG, skin, 0, -0.2, -7.4));

  // 입 라인
  const mouthG = new THREE.BoxGeometry(4.0, 0.24, 1.7);
  const mouth = mesh(mouthG, belly, 0, -1.25, -8.0);
  mouth.rotation.x = 0.06;
  g.add(mouth);

  // 긴 가슴지느러미(혹등고래)
  const finG = new THREE.SphereGeometry(1, 10, 8);
  finG.scale(3.6, 0.22, 1.0);
  const finL = mesh(finG, belly, -3.4, -1.5, -1.6);
  finL.rotation.z = 0.72;
  finL.rotation.y = 0.5;
  const finR = mesh(finG, belly, 3.4, -1.5, -1.6);
  finR.rotation.z = -0.72;
  finR.rotation.y = -0.5;
  g.add(finL, finR);

  // 등지느러미
  const dorsalG = new THREE.ConeGeometry(0.8, 1.1, 5);
  const dorsal = mesh(dorsalG, skin, 0, 2.5, 2.2);
  dorsal.rotation.z = Math.PI;
  dorsal.scale.set(0.7, 1, 1.4);
  g.add(dorsal);

  // 꼬리(수평)
  const fluke = new THREE.Group();
  fluke.position.set(0, 0, 8.4);
  const flG = new THREE.SphereGeometry(1, 12, 8);
  flG.scale(4.4, 0.3, 1.5);
  const fl = new THREE.Mesh(flG, skin);
  fl.position.z = 1.0;
  fluke.add(fl);
  const notchG = new THREE.ConeGeometry(1.0, 2.0, 4);
  notchG.rotateX(Math.PI / 2);
  const notch = new THREE.Mesh(notchG, skin);
  notch.position.set(0, 0, 1.4);
  notch.scale.set(0.5, 0.2, 1);
  fluke.add(notch);
  g.add(fluke);

  // 등 피부 주름
  for (let i = 0; i < 5; i++) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 0.16), belly);
    groove.position.set(0, -1.1, -4.4 + i * 1.25);
    g.add(groove);
  }

  return { group: g, fluke, fins: [finL, finR] };
}

export function makeManta() {
  const g = new THREE.Group();
  const skinMat = new THREE.MeshPhongMaterial({
    color: 0x54809c, shininess: 26, side: THREE.DoubleSide,
  });
  const bellyMat = new THREE.MeshPhongMaterial({
    color: 0xbfd6e0, shininess: 12, side: THREE.DoubleSide,
  });

  const bodyG = new THREE.SphereGeometry(1, 14, 10);
  bodyG.scale(1.5, 0.34, 2.5);
  g.add(mesh(bodyG, skinMat));

  // 날개 형상
  function wingShape(sign) {
    const s = new THREE.Shape();
    s.moveTo(0, 0.9);
    s.lineTo(sign * 6.2, 1.9);
    s.lineTo(sign * 7.4, 0.2);
    s.lineTo(sign * 3.6, -1.5);
    s.lineTo(0, -1.4);
    s.lineTo(0, 0.9);
    return new THREE.ShapeGeometry(s, 8);
  }

  const wingL = new THREE.Mesh(wingShape(-1), skinMat);
  wingL.rotation.x = -Math.PI / 2;
  const wingR = new THREE.Mesh(wingShape(1), skinMat);
  wingR.rotation.x = -Math.PI / 2;

  const pivotL = new THREE.Group();
  pivotL.position.set(-0.5, 0, 0);
  pivotL.add(wingL);
  const pivotR = new THREE.Group();
  pivotR.position.set(0.5, 0, 0);
  pivotR.add(wingR);
  g.add(pivotL, pivotR);

  // 배쪽 밝은 면
  const bellyPatch = new THREE.Mesh(new THREE.CircleGeometry(2.2, 18), bellyMat);
  bellyPatch.rotation.x = Math.PI / 2;
  bellyPatch.position.y = -0.28;
  bellyPatch.scale.set(1, 1.8, 1);
  g.add(bellyPatch);

  // 머리 지느러미
  const cephG = new THREE.BoxGeometry(0.4, 0.2, 1.3);
  const c1 = mesh(cephG, skinMat, -0.55, 0, -2.5);
  c1.rotation.y = 0.2;
  const c2 = mesh(cephG, skinMat, 0.55, 0, -2.5);
  c2.rotation.y = -0.2;
  g.add(c1, c2);

  // 꼬리
  const tailG = new THREE.CylinderGeometry(0.11, 0.02, 6.0, 5);
  const tail = mesh(tailG, skinMat, 0, 0, 4.4);
  tail.rotation.x = Math.PI / 2;
  g.add(tail);

  return { group: g, wingL: pivotL, wingR: pivotR, tail };
}

export function makeTurtle() {
  const g = new THREE.Group();
  const shellMat = new THREE.MeshPhongMaterial({ color: 0x4a6f46, shininess: 45 });
  const shellDark = new THREE.MeshPhongMaterial({ color: 0x37522f, shininess: 30 });
  const skinMat = new THREE.MeshPhongMaterial({ color: 0x86a06a, shininess: 18 });

  const shellG = new THREE.SphereGeometry(1, 16, 12);
  shellG.scale(1.15, 0.52, 1.5);
  g.add(mesh(shellG, shellMat));

  // 등딱지 무늬
  for (let i = 0; i < 5; i++) {
    const plate = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5), shellDark);
    plate.position.set(Math.cos(i * 1.3) * 0.45, 0.45, (i - 2) * 0.5);
    plate.scale.set(1, 0.3, 1.3);
    g.add(plate);
  }

  // 배딱지
  const plasG = new THREE.SphereGeometry(1, 12, 8);
  plasG.scale(1.0, 0.2, 1.35);
  g.add(mesh(plasG, new THREE.MeshPhongMaterial({ color: 0xc9c08a, shininess: 20 }), 0, -0.3, 0));

  // 목 + 머리
  const neck = mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.7, 8), skinMat, 0, 0.05, -1.55);
  neck.rotation.x = Math.PI / 2;
  g.add(neck);
  const head = mesh(new THREE.SphereGeometry(0.42, 10, 8), skinMat, 0, 0.02, -2.05);
  head.scale.set(1, 0.9, 1.25);
  g.add(head);
  g.add(mesh(new THREE.SphereGeometry(0.075, 6, 5), MET.eyeYellow, -0.24, 0.16, -2.32));
  g.add(mesh(new THREE.SphereGeometry(0.075, 6, 5), MET.eyeYellow, 0.24, 0.16, -2.32));

  // 지느러미 4개
  const flipG = new THREE.SphereGeometry(1, 8, 6);
  flipG.scale(0.85, 0.1, 0.4);
  const flippers = [];
  const specs = [
    [-0.95, 0, -1.05, 0.5],
    [0.95, 0, -1.05, -0.5],
    [-0.85, 0, 1.05, 0.4],
    [0.85, 0, 1.05, -0.4],
  ];
  specs.forEach(([x, y, z, rz], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const f = new THREE.Mesh(flipG, skinMat);
    f.position.x = x > 0 ? 0.5 : -0.5;
    pivot.add(f);
    pivot.rotation.z = rz;
    pivot.userData.base = rz;
    pivot.userData.phase = i * 1.1;
    g.add(pivot);
    flippers.push(pivot);
  });

  return { group: g, flippers };
}

/* =========================================================
   관상 물고기 떼 (InstancedMesh)
   ========================================================= */
const SCHOOL_BEND = { amp: 0.085, freq: 2.6, speed: 6.5, wag: 0.0 };
let _schoolGeo = null;
let _schoolMat = null;

export function makeFishGeometry() {
  if (_schoolGeo) return _schoolGeo;
  const GRAY_BACK = 0.60;
  const id = 0xffffff;

  const profile = [
    [-0.50, 0.02], [-0.40, 0.09], [-0.28, 0.155], [-0.12, 0.195],
    [0.06, 0.19], [0.22, 0.145], [0.33, 0.09], [0.40, 0.05],
  ];
  const body = bodyGeometry(profile, { radial: 12, sx: 0.62, sy: 1.0 });
  paintSkin(body, { back: 0x9a9a9a, belly: id, halfHeight: 0.2, blend: [-0.36, 0.2] });

  const parts = [body];
  // 꼬리 — 갈라진 부채
  const tail = vfin([
    [0.00, 0.05], [0.13, 0.20], [0.20, 0.24], [0.16, 0.02],
    [0.21, -0.22], [0.12, -0.19], [0.00, -0.05],
  ], 0.03, 0xb8b8b8, { smooth: true });
  parts.push(xf(tail, [0, 0, 0.38], [0, 0, 0], [1, 1, 1]));
  // 등지느러미
  const dorsal = vfin([
    [-0.10, 0.17], [0.02, 0.30], [0.12, 0.31], [0.12, 0.17],
  ], 0.022, 0xa8a8a8);
  parts.push(xf(dorsal, [0, 0, 0.0], [0, 0, 0], [1, 1, 1]));
  // 배지느러미
  const pelvic = vfin([
    [-0.04, -0.14], [0.04, -0.22], [0.10, -0.22], [0.08, -0.14],
  ], 0.018, 0xa8a8a8);
  parts.push(xf(pelvic, [0, 0, 0.14], [0, 0, 0], [1, 1, 1]));
  // 눈
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.045, 6, 5);
    parts.push(xf(paint(eye, 0x101418), [0.095 * s, 0.06, -0.34], [0, 0, 0], [1, 1, 1]));
  }
  // 가슴지느러미
  for (const s of [-1, 1]) {
    const fin = hfin([
      [0, 0.06], [0.10, 0.02], [0.13, -0.05], [0.04, -0.05],
    ].map(([x, y]) => [x * s, y]), 0.014, 0xa8a8a8);
    parts.push(xf(fin, [0.10 * s, -0.04, -0.18], [0, 0, 0], [1, 1, 1]));
  }
  _schoolGeo = assemble(parts, -0.4, 0.55);
  return _schoolGeo;
}

export function makeFishSchool(count) {
  const geo = makeFishGeometry();
  if (!_schoolMat) {
    _schoolMat = swimMaterial({
      vertexColors: true, shininess: 30, specular: 0x556677,
    }, SCHOOL_BEND);
  }
  const inst = new THREE.InstancedMesh(geo, _schoolMat, count);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const palette = [0xffd166, 0xff8f6b, 0x6be0ff, 0xff9ecb, 0xa6ff9e, 0xfff3b0];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    c.setHex(palette[i % palette.length]);
    inst.setColorAt(i, c);
  }
  inst.count = count;
  inst.frustumCulled = false;
  return inst;
}

/* =========================================================
   해저 지형 요소들 (월드에서 병합해 사용)
   ========================================================= */
export function rockGeometry(radius, seed) {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // 위치 기반 해시 — 같은 자리의 정점은 같은 변위를 받아 표면이 찢어지지 않는다
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.017) * 43758.5453;
    const f = 0.86 + (h - Math.floor(h)) * 0.3;
    pos.setXYZ(i, x * f, y * f * 0.82, z * f);
  }
  geo.computeVertexNormals();
  return geo;
}

/** 가지형 산호 */
export function branchCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const trunkH = 1.0 + rnd() * 1.1;
  const trunk = new THREE.CylinderGeometry(0.09, 0.16, trunkH, 5);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(paint(trunk, color));

  const branches = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < branches; i++) {
    const h = 0.6 + rnd() * 0.8;
    const b = new THREE.CylinderGeometry(0.045, 0.09, h, 5);
    b.translate(0, h / 2, 0);
    const m = new THREE.Matrix4();
    const e = new THREE.Euler((rnd() - 0.5) * 1.0, rnd() * Math.PI * 2, (rnd() - 0.5) * 1.0);
    m.makeRotationFromEuler(e);
    m.setPosition((rnd() - 0.5) * 0.3, trunkH * (0.55 + rnd() * 0.4), (rnd() - 0.5) * 0.3);
    b.applyMatrix4(m);
    parts.push(paint(b, color));
  }
  return mergeGeometries(parts, false);
}

/** 부채형/뇌형 산호 */
export function blobCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const geo = new THREE.SphereGeometry(0.30 + rnd() * 0.26, 10, 8);
  geo.scale(1 + rnd() * 0.45, 0.5 + rnd() * 0.4, 1 + rnd() * 0.35);
  geo.translate(0, 0.2, 0);
  return paint(geo, color);
}

/** 관형 스펀지 산호 */
export function tubeCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const n = 3;
  for (let i = 0; i < n; i++) {
    const h = 0.6 + rnd() * 1.2;
    const g = new THREE.CylinderGeometry(0.1, 0.14, h, 7, 1, true);
    g.translate(0, h / 2, 0);
    const m = new THREE.Matrix4();
    m.makeTranslation((i - 1) * 0.22 + (rnd() - 0.5) * 0.1, 0, (rnd() - 0.5) * 0.3);
    g.applyMatrix4(m);
    parts.push(paint(g, color));
  }
  return mergeGeometries(parts, false);
}

/** 해초 잎 (병합 + 정점 셰이더 흔들림) */
export function kelpGeometry(height, width, seed) {
  const rnd = mulberry(seed);
  const segs = 7;
  const pos = [];
  const idx = [];
  const nor = [];
  const uv = [];
  const sway = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * height;
    const swayZ = Math.sin(t * 2.2 + seed) * 0.16 * t;
    const w = width * (1 - t * 0.55);
    pos.push(-w / 2, y, swayZ);
    pos.push(w / 2, y, swayZ);
    nor.push(0, 0, 1, 0, 0, 1);
    uv.push(0, t, 1, t);
    sway.push(t, t);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  const col = new THREE.Color().setHSL(0.28 + rnd() * 0.12, 0.55, 0.22 + rnd() * 0.12);
  return paint(g, col.getHex());
}
