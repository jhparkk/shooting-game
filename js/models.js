/* =========================================================
   ABYSS DIVER — 절차적 3D 모델 빌더
   외부 모델 파일 없이 Three.js 기본 도형을 조합해 만든다.
   ========================================================= */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
   백상아리 — 살아 있는 상어
   ========================================================= */
let _sharkGeo = null;
function sharkGeometry() {
  if (_sharkGeo) return _sharkGeo;
  const BACK = 0x5d6c76;
  const BELLY = 0xf1f6f5;
  const FIN = 0x4c5860;

  const body = new THREE.SphereGeometry(1, 16, 12);
  body.scale(0.68, 0.62, 1.95);
  const belly = new THREE.SphereGeometry(1, 14, 10);
  belly.scale(0.6, 0.44, 1.76);
  const snout = new THREE.ConeGeometry(0.52, 1.05, 10);
  snout.rotateX(-Math.PI / 2);
  const dorsal = new THREE.ConeGeometry(0.5, 1.2, 4);
  const dorsal2 = new THREE.ConeGeometry(0.2, 0.42, 4);
  const pec = new THREE.ConeGeometry(0.42, 1.15, 4);
  pec.rotateZ(Math.PI / 2);
  const pelvic = new THREE.ConeGeometry(0.1, 0.3, 4);
  const tooth = new THREE.ConeGeometry(0.06, 0.2, 4);
  const eye = new THREE.SphereGeometry(0.075, 6, 5);
  const gill = new THREE.BoxGeometry(0.03, 0.3, 0.06);

  const parts = [
    placed(body, [0, 0, 0], [0, 0, 0], [1, 1, 1], BACK),
    placed(belly, [0, -0.22, 0.05], [0, 0, 0], [1, 1, 1], BELLY),
    placed(snout, [0, -0.02, -2.05], [0, 0, 0], [1, 1, 1], BACK),
  ];
  // 등지느러미 (얇은 삼각 날)
  parts.push(placed(dorsal, [0, 0.5, 0.1], [0.22, 0, 0], [0.16, 1, 1.55], FIN));
  parts.push(placed(dorsal2, [0, 0.34, 1.5], [0.2, 0, 0], [0.14, 1, 1.2], FIN));
  // 가슴지느러미
  parts.push(placed(pec, [-0.62, -0.16, -0.34], [0, 0.25, 0.35], [1, 1, 0.9], FIN));
  parts.push(placed(pec, [0.62, -0.16, -0.34], [0, -0.25, -0.35], [1, 1, 0.9], FIN));
  // 배지느러미
  parts.push(placed(pelvic, [-0.4, -0.4, 1.5], [0.4, 0, 0.5], [1, 1, 1], FIN));
  parts.push(placed(pelvic, [0.4, -0.4, 1.5], [0.4, 0, -0.5], [1, 1, 1], FIN));
  // 눈
  parts.push(placed(eye, [-0.44, 0.16, -1.72], [0, 0, 0], [1, 1, 1], 0x10161a));
  parts.push(placed(eye, [0.44, 0.16, -1.72], [0, 0, 0], [1, 1, 1], 0x10161a));
  // 입 라인 + 이빨
  parts.push(placed(new THREE.BoxGeometry(0.62, 0.05, 0.5), [0, -0.28, -1.85], [0.05, 0, 0], [1, 1, 1], 0x3a2226));
  for (let i = 0; i < 7; i++) {
    parts.push(placed(tooth, [-0.24 + i * 0.08, -0.24, -2.02], [Math.PI, 0, 0], [1, 1, 1], 0xf7fbf4));
  }
  // 아가미
  for (let i = 0; i < 4; i++) {
    parts.push(placed(gill, [-0.6, 0, -0.85 + i * 0.16], [0, 0, 0.2], [1, 1, 1], 0x3f4a52));
    parts.push(placed(gill, [0.6, 0, -0.85 + i * 0.16], [0, 0, -0.2], [1, 1, 1], 0x3f4a52));
  }

  _sharkGeo = mergeGeometries(parts, false);
  return _sharkGeo;
}

let _sharkTailGeo = null;
function sharkTailGeometry() {
  if (_sharkTailGeo) return _sharkTailGeo;
  const FIN = 0x4c5860;
  const upper = new THREE.ConeGeometry(0.42, 1.35, 4);
  const lower = new THREE.ConeGeometry(0.28, 0.8, 4);
  _sharkTailGeo = mergeGeometries([
    placed(upper, [0, 0.55, 0.32], [0, 0, 0.5], [0.12, 1, 1.4], FIN),
    placed(lower, [0, -0.35, 0.3], [0, 0, -0.35], [0.12, 1, 1.3], FIN),
  ], false);
  return _sharkTailGeo;
}

let _sharkMat = null;
export function makeShark() {
  if (!_sharkMat) {
    _sharkMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 22, specular: 0x2a4453 });
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(sharkGeometry(), _sharkMat);
  g.add(body);
  const tail = new THREE.Group();
  tail.position.set(0, 0, 1.95);
  tail.add(new THREE.Mesh(sharkTailGeometry(), _sharkMat));
  g.add(tail);
  return { group: g, tail, body };
}

/* =========================================================
   귀상어(해머헤드)
   ========================================================= */
let _hammerGeo = null;
function hammerGeometry() {
  if (_hammerGeo) return _hammerGeo;
  const BACK = 0x6f7669;
  const BELLY = 0xeef3ea;
  const FIN = 0x565c50;

  const body = new THREE.SphereGeometry(1, 16, 12);
  body.scale(0.62, 0.56, 1.95);
  const belly = new THREE.SphereGeometry(1, 14, 10);
  belly.scale(0.54, 0.38, 1.74);
  const head = new THREE.SphereGeometry(1, 14, 10);
  head.scale(1.3, 0.2, 0.46);
  const dorsal = new THREE.ConeGeometry(0.62, 1.6, 4);
  const dorsal2 = new THREE.ConeGeometry(0.24, 0.5, 4);
  const pec = new THREE.ConeGeometry(0.46, 1.25, 4);
  pec.rotateZ(Math.PI / 2);
  const eye = new THREE.SphereGeometry(0.1, 6, 5);
  const mouth = new THREE.BoxGeometry(0.5, 0.06, 0.42);

  const parts = [
    placed(body, [0, 0, 0], [0, 0, 0], [1, 1, 1], BACK),
    placed(belly, [0, -0.2, 0.05], [0, 0, 0], [1, 1, 1], BELLY),
    placed(head, [0, 0.02, -1.95], [0, 0, 0], [1, 1, 1], BACK),
    placed(dorsal, [0, 0.62, 0.05], [0.26, 0, 0], [0.15, 1, 1.5], FIN),
    placed(dorsal2, [0, 0.36, 1.55], [0.22, 0, 0], [0.13, 1, 1.2], FIN),
    placed(pec, [-0.6, -0.14, -0.3], [0, 0.28, 0.4], [1, 1, 0.95], FIN),
    placed(pec, [0.6, -0.14, -0.3], [0, -0.28, -0.4], [1, 1, 0.95], FIN),
    placed(mouth, [0, -0.16, -2.05], [0.04, 0, 0], [1, 1, 1], 0x3a2a2a),
  ];
  // 망치 머리 양 끝의 눈
  parts.push(placed(eye, [-1.18, 0.04, -2.0], [0, 0, 0], [1, 1, 1], 0x121417));
  parts.push(placed(eye, [1.18, 0.04, -2.0], [0, 0, 0], [1, 1, 1], 0x121417));

  _hammerGeo = mergeGeometries(parts, false);
  return _hammerGeo;
}

let _hammerTailGeo = null;
function hammerTailGeometry() {
  if (_hammerTailGeo) return _hammerTailGeo;
  const FIN = 0x565c50;
  const upper = new THREE.ConeGeometry(0.5, 1.7, 4);
  const lower = new THREE.ConeGeometry(0.3, 0.9, 4);
  _hammerTailGeo = mergeGeometries([
    placed(upper, [0, 0.7, 0.35], [0, 0, 0.55], [0.12, 1, 1.45], FIN),
    placed(lower, [0, -0.4, 0.3], [0, 0, -0.4], [0.12, 1, 1.35], FIN),
  ], false);
  return _hammerTailGeo;
}

let _hammerMat = null;
export function makeHammerhead() {
  if (!_hammerMat) {
    _hammerMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 18, specular: 0x2a3a33 });
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(hammerGeometry(), _hammerMat);
  g.add(body);
  const tail = new THREE.Group();
  tail.position.set(0, 0, 1.95);
  tail.add(new THREE.Mesh(hammerTailGeometry(), _hammerMat));
  g.add(tail);
  return { group: g, tail, body };
}

/* =========================================================
   발광 해파리
   ========================================================= */
let _jellyGeo = null;
let _jellyTentGeo = null;
function jellyGeometries() {
  if (_jellyGeo) return;
  const bell = new THREE.SphereGeometry(0.85, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const rim = new THREE.TorusGeometry(0.8, 0.055, 6, 20);
  rim.rotateX(Math.PI / 2);
  const core = new THREE.SphereGeometry(0.3, 8, 6);
  _jellyGeo = mergeGeometries([
    placed(rim, [0, 0, 0], [0, 0, 0], [1, 1, 1], 0xffffff),
  ], false);
  _jellyGeoCore = core;
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
let _jellyGeoCore = null;
let _jellyBell = null;

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
   독가시 복어 — 부풀어 오르는 가시 복어
   ========================================================= */
let _pufferBodyGeo = null;
let _pufferSpikeGeo = null;
function pufferGeometries() {
  if (_pufferBodyGeo) return;
  const BODY = 0xf0cd6a;
  const BELLY = 0xfff4d2;
  const FIN = 0xe0b45c;

  const body = new THREE.SphereGeometry(0.92, 16, 12);
  body.scale(1, 0.94, 1.12);
  const belly = new THREE.SphereGeometry(0.86, 14, 10);
  belly.scale(1, 0.6, 1.08);
  const dorsal = new THREE.ConeGeometry(0.22, 0.5, 4);
  const caudal = new THREE.ConeGeometry(0.34, 0.55, 4);
  caudal.rotateX(Math.PI / 2);
  const pec = new THREE.ConeGeometry(0.2, 0.45, 4);
  pec.rotateZ(Math.PI / 2);
  const eye = new THREE.SphereGeometry(0.14, 8, 6);
  const pupil = new THREE.SphereGeometry(0.07, 6, 5);
  const mouth = new THREE.TorusGeometry(0.13, 0.05, 6, 12);

  const parts = [
    placed(body, [0, 0, 0], [0, 0, 0], [1, 1, 1], BODY),
    placed(belly, [0, -0.3, 0], [0, 0, 0], [1, 1, 1], BELLY),
    placed(dorsal, [0, 0.86, 0.12], [0.1, 0, 0], [0.35, 1, 1], FIN),
    placed(caudal, [0, 0.1, 1.02], [0, 0, 0], [1, 1, 1], FIN),
    placed(pec, [-0.88, -0.05, -0.1], [0, 0, 0.25], [1, 1, 1], FIN),
    placed(pec, [0.88, -0.05, -0.1], [0, 0, -0.25], [1, 1, 1], FIN),
    placed(mouth, [0, -0.12, -0.98], [0, 0, 0], [1, 1, 1], 0xb07a48),
  ];
  // 눈 (흰자 + 검은 동자)
  parts.push(placed(eye, [-0.34, 0.28, -0.8], [0, 0, 0], [1, 1, 1], 0xfdf6e2));
  parts.push(placed(eye, [0.34, 0.28, -0.8], [0, 0, 0], [1, 1, 1], 0xfdf6e2));
  parts.push(placed(pupil, [-0.36, 0.29, -0.9], [0, 0, 0], [1, 1, 1], 0x14100c));
  parts.push(placed(pupil, [0.36, 0.29, -0.9], [0, 0, 0], [1, 1, 1], 0x14100c));

  // 등·배의 검은 반점
  const spot = new THREE.SphereGeometry(0.07, 6, 4);
  const R = 0.9;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const b = -0.9 + (i % 3) * 0.5;
    parts.push(placed(spot,
      [Math.cos(a) * R * 0.8, 0.35 + b * 0.35, Math.sin(a) * R * 0.85],
      [0, 0, 0], [1, 1, 1], 0x4a3320));
  }

  _pufferBodyGeo = mergeGeometries(parts, false);

  // 가시 — 공 모양으로 고르게 뻗은 삼각침
  const spikeG = new THREE.ConeGeometry(0.075, 0.5, 4);
  const spikeParts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const n = 36;
  for (let i = 0; i < n; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const d = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    );
    const geo = spikeG.clone();
    const q = new THREE.Quaternion().setFromUnitVectors(up, d);
    const m = new THREE.Matrix4().compose(
      d.clone().multiplyScalar(0.88),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    geo.applyMatrix4(m);
    spikeParts.push(paint(geo, 0xdca24a));
  }
  _pufferSpikeGeo = mergeGeometries(spikeParts, false);
}

let _pufferMat = null;
let _pufferSpikeMat = null;
export function makePuffer() {
  pufferGeometries();
  if (!_pufferMat) {
    _pufferMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 34, specular: 0x6b5a30 });
    _pufferSpikeMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x8a7340 });
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(_pufferBodyGeo, _pufferMat);
  const spikes = new THREE.Mesh(_pufferSpikeGeo, _pufferSpikeMat);
  g.add(body, spikes);
  return { group: g, body, spikes, tail: null };
}

/* =========================================================
   쏠배감펭(lionfish) — 긴 독가시 지느러미를 편 채 떠다니는 물고기
   ========================================================= */
let _lionGeo = null;
let _lionFinGeo = null;
function lionGeometries() {
  if (_lionGeo) return;
  const BODY = 0xd2542f;
  const STRIPE = 0xfff1e2;
  const FIN = 0xe8794a;

  const body = new THREE.SphereGeometry(1, 16, 12);
  body.scale(0.42, 0.6, 1.05);
  const head = new THREE.SphereGeometry(1, 14, 10);
  head.scale(0.4, 0.44, 0.5);
  const eye = new THREE.SphereGeometry(0.1, 8, 6);
  const mouth = new THREE.BoxGeometry(0.24, 0.09, 0.16);

  const parts = [
    placed(body, [0, 0, 0], [0, 0, 0], [1, 1, 1], BODY),
    placed(head, [0, 0.04, -0.9], [0, 0, 0], [1, 1, 1], BODY),
    placed(eye, [-0.2, 0.18, -1.16], [0, 0, 0], [1, 1, 1], 0x1b1310),
    placed(eye, [0.2, 0.18, -1.16], [0, 0, 0], [1, 1, 1], 0x1b1310),
    placed(mouth, [0, -0.16, -1.22], [0.1, 0, 0], [1, 1, 1], 0x8a3a2a),
  ];
  // 흰 세로 줄무늬
  for (let i = 0; i < 4; i++) {
    parts.push(placed(new THREE.BoxGeometry(0.5, 0.86 - i * 0.08, 0.09),
      [0, 0.02, -0.36 + i * 0.34], [0, 0, 0], [1, 1, 1], STRIPE));
  }
  _lionGeo = mergeGeometries(parts, false);

  const finParts = [];
  const ray = new THREE.ConeGeometry(0.035, 1.35, 4);
  // 등지느러미 — 위로 부채꼴
  for (let i = 0; i < 8; i++) {
    const t = (i / 7 - 0.5) * 2;
    finParts.push(placed(ray,
      [0, 0.45 + Math.abs(t) * 0.05, 0.55 - i * 0.22],
      [0, 0, t * 0.85], [1, i < 4 ? 1 : 0.7, 1], FIN));
  }
  // 큰 가슴지느러미 — 좌우 부채
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < 5; i++) {
      const t = (i / 4 - 0.5) * 2;
      finParts.push(placed(ray,
        [s * 0.32, -0.05, -0.2],
        [t * 1.1, 0, s * (1.15 + Math.abs(t) * 0.2)], [1, 0.95, 1], FIN));
    }
  }
  _lionFinGeo = mergeGeometries(finParts, false);
}

let _lionMat = null;
let _lionFinMat = null;
export function makeLionfish() {
  lionGeometries();
  if (!_lionMat) {
    _lionMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x8a4a30 });
    _lionFinMat = new THREE.MeshPhongMaterial({
      vertexColors: true, shininess: 26, specular: 0x5a3320,
      side: THREE.DoubleSide, transparent: true, opacity: 0.92,
    });
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(_lionGeo, _lionMat);
  const fins = new THREE.Mesh(_lionFinGeo, _lionFinMat);
  g.add(body, fins);
  return { group: g, body, fins, tail: null };
}

/* =========================================================
   심해 아귀 — 유인 돌기를 밝히는 심해 포식자
   ========================================================= */
export function makeAnglerfish() {
  const g = new THREE.Group();
  const skin = new THREE.MeshPhongMaterial({
    color: 0x2d3f52, shininess: 26, specular: 0x33506b, emissive: 0x081420, emissiveIntensity: 0.6,
  });
  const jawMat = new THREE.MeshPhongMaterial({ color: 0x3a4d60, shininess: 18, specular: 0x2a3a48 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 11), skin);
  body.scale.set(0.95, 0.85, 0.8);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 11), skin);
  head.scale.set(1.05, 0.9, 0.7);
  head.position.set(0, 0.05, -0.85);
  g.add(head);

  // 입 (아래턱이 열린다)
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.28, -1.1);
  const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), jawMat);
  jawMesh.scale.set(0.95, 0.28, 0.6);
  jawMesh.position.set(0, -0.1, -0.18);
  jaw.add(jawMesh);
  g.add(jaw);

  // 이빨
  const toothG = new THREE.ConeGeometry(0.07, 0.28, 4);
  for (let i = 0; i < 7; i++) {
    const t = -0.45 + (i / 6) * 0.9;
    const tt = new THREE.Mesh(toothG, MET.bone);
    tt.position.set(t, -0.3, -1.35);
    tt.rotation.x = Math.PI;
    g.add(tt);
    const tb = new THREE.Mesh(toothG, MET.bone);
    tb.position.set(t, -0.16, -1.28);
    tb.scale.setScalar(0.8);
    jaw.add(tb);
  }

  // 눈
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xa9f0ff });
  const eyeG = new THREE.SphereGeometry(0.11, 8, 6);
  g.add(mesh(eyeG, eyeMat, -0.34, 0.32, -1.42));
  g.add(mesh(eyeG, eyeMat, 0.34, 0.32, -1.42));

  // 꼬리 지느러미
  const tailG = new THREE.ConeGeometry(0.45, 0.7, 4);
  tailG.rotateX(Math.PI / 2);
  const tail = new THREE.Mesh(tailG, skin);
  tail.position.set(0, 0, 0.95);
  tail.scale.set(1, 1.3, 1);
  g.add(tail);

  // 유인 돌기
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.5, 5), skin);
  stalk.position.set(0.2, 0.85, -1.0);
  stalk.rotation.x = -0.5;
  g.add(stalk);
  const lure = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xc8fff4 })
  );
  lure.position.set(0.2, 1.55, -1.6);
  g.add(lure);
  const glow = spriteGlow(0x8ffff0, 3.6, 0.8);
  glow.position.copy(lure.position);
  g.add(glow);

  return { group: g, jaw, lure, glow, tail };
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
  const parts = [];
  let px = 0;
  let py = 0;
  let pz = 0;
  let ang = 0;
  let r = thick;
  const suckerG = new THREE.SphereGeometry(0.09, 5, 4);
  for (let i = 0; i < segCount; i++) {
    const L = len / segCount;
    const geo = new THREE.CylinderGeometry(r * 0.76, r, L, 7);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -L / 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, 0, 0));
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(px, py, pz), q, new THREE.Vector3(1, 1, 1)
    );
    geo.applyMatrix4(m);
    parts.push(paint(geo, color));

    // 빨판
    for (let s = 0; s < 2; s++) {
      const sg = suckerG.clone();
      const off = new THREE.Vector3(0, -r * 0.72, -(L * (0.3 + s * 0.5)))
        .applyQuaternion(q);
      sg.translate(px + off.x, py + off.y, pz + off.z);
      parts.push(paint(sg, KRAKEN.sucker));
    }

    const dir = new THREE.Vector3(0, 0, -L).applyQuaternion(q);
    px += dir.x;
    py += dir.y;
    pz += dir.z;
    ang += curl;
    r *= 0.84;
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
    vertexColors: true, shininess: 36, specular: 0x9a6078,
    emissive: 0x24080f, emissiveIntensity: 0.5,
  });

  // 머리 + 몸통(망토)
  const mantle = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), skin);
  mantle.scale.set(2.4, 2.3, 3.7);
  mantle.position.set(0, 0, 1.1);
  g.add(mantle);

  const tipG = new THREE.ConeGeometry(1.9, 3.2, 12);
  tipG.rotateX(-Math.PI / 2);
  const tip = new THREE.Mesh(tipG, skin);
  tip.position.set(0, 0, 5.4);
  g.add(tip);

  // 망토 끝의 지느러미
  const finG = new THREE.ConeGeometry(1.5, 2.2, 3);
  finG.rotateX(Math.PI / 2);
  const finL = mesh(finG, skinDark, -1.6, 0.2, 4.6);
  finL.rotation.z = 0.9;
  finL.scale.set(0.16, 1, 1);
  const finR = mesh(finG, skinDark, 1.6, 0.2, 4.6);
  finR.rotation.z = -0.9;
  finR.scale.set(0.16, 1, 1);
  g.add(finL, finR);

  // 머리
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), skin);
  head.scale.set(2.1, 1.9, 1.5);
  head.position.set(0, -0.1, -2.0);
  g.add(head);

  // 큰 눈
  const eyeWhite = new THREE.MeshPhongMaterial({
    color: 0xf0d9a0, shininess: 90, emissive: 0x6a4a10, emissiveIntensity: 0.7,
  });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0a0408 });
  const eyeG = new THREE.SphereGeometry(0.72, 14, 10);
  const pupilG = new THREE.SphereGeometry(0.34, 10, 8);
  [-1.5, 1.5].forEach((x) => {
    g.add(mesh(eyeG, eyeWhite, x, 0.35, -2.9));
    const p = mesh(pupilG, pupilMat, x, 0.35, -3.42);
    p.scale.set(0.5, 1.15, 0.5);
    g.add(p);
  });

  // 부리(입)
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 6), MET.bone);
  beak.rotation.x = Math.PI * 0.62;
  beak.position.set(0, -1.05, -2.9);
  g.add(beak);

  // 다리 8가닥
  const arms = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 1.15, Math.sin(a) * 1.0, -2.2);
    const geo = krakenLimb(5, 5.0 + (i % 2) * 0.8, 0.62, 0.16, KRAKEN.arm);
    const limb = new THREE.Mesh(geo, limbMat);
    pivot.add(limb);
    pivot.rotation.z = a - Math.PI / 2;
    pivot.userData.baseZ = pivot.rotation.z;
    pivot.userData.phase = i * 1.7;
    g.add(pivot);
    arms.push(pivot);
  }

  // 긴 촉수 2가닥
  const tentacles = [];
  [-1, 1].forEach((side, i) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.3, -0.6, -2.4);
    const geo = krakenLimb(7, 8.5, 0.34, 0.1, KRAKEN.arm);
    const limb = new THREE.Mesh(geo, limbMat);
    pivot.add(limb);
    pivot.rotation.z = side * 0.28;
    pivot.userData.baseZ = pivot.rotation.z;
    pivot.userData.phase = 0.8 + i * 2.1;
    g.add(pivot);
    tentacles.push(pivot);
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
   물고기 떼 (InstancedMesh)
   ========================================================= */
export function makeFishGeometry() {
  const body = new THREE.SphereGeometry(0.22, 8, 6);
  body.scale(0.55, 0.85, 2.0);
  const tail = new THREE.ConeGeometry(0.18, 0.42, 4);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, 0, 0.52);
  const geo = mergeGeometries([body, tail], false);
  return geo;
}

export function makeFishSchool(count) {
  const geo = makeFishGeometry();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(geo, mat, count);
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
  const geo = new THREE.IcosahedronGeometry(radius, 0);
  const pos = geo.attributes.position;
  const rnd = mulberry(seed);
  for (let i = 0; i < pos.count; i++) {
    const f = 0.72 + rnd() * 0.55;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.8, pos.getZ(i) * f);
  }
  geo.computeVertexNormals();
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

/** 가지형 산호 */
export function branchCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const trunkH = 1.0 + rnd() * 1.1;
  const trunk = new THREE.CylinderGeometry(0.09, 0.14, trunkH, 5);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(paint(trunk, color));

  const branches = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < branches; i++) {
    const h = 0.55 + rnd() * 0.7;
    const b = new THREE.CylinderGeometry(0.05, 0.08, h, 4);
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
  const geo = new THREE.SphereGeometry(0.28 + rnd() * 0.24, 8, 6);
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
    const g = new THREE.CylinderGeometry(0.1, 0.14, h, 6, 1, true);
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
