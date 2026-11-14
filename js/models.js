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
  hull: new THREE.MeshPhongMaterial({ color: 0xf2e3c4, shininess: 70, specular: 0x557788 }),
  hullDark: new THREE.MeshPhongMaterial({ color: 0xd9c9a8, shininess: 40, specular: 0x334455 }),
  accent: new THREE.MeshPhongMaterial({ color: 0xff9a3c, shininess: 60, specular: 0x996633 }),
  glass: new THREE.MeshPhongMaterial({
    color: 0x9ef6ff, emissive: 0x1d7681, emissiveIntensity: 0.9,
    transparent: true, opacity: 0.62, shininess: 110, specular: 0xffffff,
  }),
  metal: new THREE.MeshPhongMaterial({ color: 0x6d7d8a, shininess: 120, specular: 0xd0e6ff }),
  metalDark: new THREE.MeshPhongMaterial({ color: 0x2b3540, shininess: 90, specular: 0x88aacc }),
  eyeRed: new THREE.MeshBasicMaterial({ color: 0xff3b3b }),
  eyeYellow: new THREE.MeshBasicMaterial({ color: 0xffd457 }),
  bone: new THREE.MeshLambertMaterial({ color: 0xf4f7ea }),
  darkFlesh: new THREE.MeshPhongMaterial({ color: 0x1d2b3a, shininess: 30 }),
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
  body.scale(0.95, 0.86, 2.0);
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

  // 전조등
  const lampGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.26, 10);
  lampGeo.rotateX(Math.PI / 2);
  const lampL = mesh(lampGeo, MET.eyeYellow, -0.46, 0.22, -1.72);
  const lampR = mesh(lampGeo, MET.eyeYellow, 0.46, 0.22, -1.72);
  g.add(lampL, lampR);

  // 전조등 빛 원뿔(가짜 볼륨)
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xbdf4ff, transparent: true, opacity: 0.1,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const coneGeo = new THREE.ConeGeometry(2.6, 15, 14, 1, true);
  coneGeo.rotateX(-Math.PI / 2);
  coneGeo.translate(0, 0, -7.4);
  const beam = new THREE.Mesh(coneGeo, coneMat);
  beam.position.set(0, 0.18, -1.6);
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
   기계 상어
   ========================================================= */
let _sharkGeo = null;
function sharkGeometry() {
  if (_sharkGeo) return _sharkGeo;
  const body = new THREE.SphereGeometry(1, 14, 10);
  body.scale(0.72, 0.7, 1.95);
  const snout = new THREE.ConeGeometry(0.62, 1.1, 10);
  snout.rotateX(-Math.PI / 2);
  const dorsal = new THREE.ConeGeometry(0.36, 0.9, 4);
  const pec = new THREE.BoxGeometry(1.0, 0.07, 0.42);
  const tooth = new THREE.ConeGeometry(0.07, 0.22, 4);
  const tailFin = new THREE.ConeGeometry(0.42, 1.25, 4);
  tailFin.rotateX(Math.PI / 2);

  const parts = [
    placed(body, [0, 0, 0], [0, 0, 0], [1, 1, 1], 0x6d7d8a),
    placed(snout, [0, 0.02, -2.05], [0, 0, 0], [1, 1, 1], 0x7d8e9c),
    placed(dorsal, [0, 0.62, 0.1], [0, 0, Math.PI], [1, 1, 1], 0x2f3b47),
    placed(pec, [-0.78, -0.28, -0.5], [0, 0, 0.42], [1, 1, 1], 0x2f3b47),
    placed(pec, [0.78, -0.28, -0.5], [0, 0, -0.42], [1, 1, 1], 0x2f3b47),
    placed(tailFin, [0, 0, 2.35], [0, 0, 0], [0.5, 1.7, 1], 0x2f3b47),
  ];
  for (let i = 0; i < 5; i++) {
    parts.push(placed(tooth, [-0.28 + i * 0.14, -0.28, -1.85], [Math.PI, 0, 0], [1, 1, 1], 0xf4f7ea));
  }
  const fin = new THREE.ConeGeometry(0.42, 1.25, 4);
  fin.rotateX(Math.PI / 2);
  parts.push(placed(fin, [0, 0, 2.4], [0, 0, 0], [0.45, 1.5, 1], 0x3c4a58));

  _sharkGeo = mergeGeometries(parts, false);
  return _sharkGeo;
}

let _sharkTailGeo = null;
let _sharkMat = null;
export function makeShark() {
  if (!_sharkMat) {
    _sharkMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 110, specular: 0xbfe0ff });
  }
  if (!_sharkTailGeo) {
    _sharkTailGeo = new THREE.ConeGeometry(0.42, 1.25, 4);
    _sharkTailGeo.rotateX(Math.PI / 2);
    _sharkTailGeo.scale(0.5, 1.7, 1);
    _sharkTailGeo.translate(0, 0, 2.4);
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(sharkGeometry(), _sharkMat);
  g.add(body);

  // 움직이는 꼬리
  const tail = new THREE.Group();
  const tf = new THREE.Mesh(_sharkTailGeo, MET.metalDark);
  tail.add(tf);
  g.add(tail);

  // 붉은 눈빛
  const eg = spriteGlow(0xff3b3b, 1.3, 0.75);
  eg.position.set(0, 0.18, -1.7);
  g.add(eg);

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
  const tGeo = new THREE.CylinderGeometry(0.03, 0.012, 1.8, 4);
  tGeo.translate(0, -0.9, 0);
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
      color: color, emissive: color, emissiveIntensity: 0.6,
      transparent: true, opacity: 0.5, shininess: 80, side: THREE.DoubleSide,
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
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.55, depthWrite: false })
  );
  g.add(tentacles);

  const glow = spriteGlow(color, 4.4, 0.5);
  g.add(glow);
  return { group: g, bell, tentacles, rim, glow };
}

/* =========================================================
   기뢰
   ========================================================= */
let _mineGeo = null;
function mineGeometry() {
  if (_mineGeo) return _mineGeo;
  const parts = [placed(new THREE.SphereGeometry(0.85, 12, 10), [0, 0, 0], [0, 0, 0], [1, 1, 1], 0x2b3540)];
  const spikeG = new THREE.ConeGeometry(0.14, 0.62, 5);
  const dirs = [];
  for (let i = 0; i < 6; i++) {
    dirs.push(new THREE.Vector3(Math.cos((i / 6) * Math.PI * 2), 0, Math.sin((i / 6) * Math.PI * 2)));
  }
  dirs.push(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0));
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  dirs.forEach((d) => {
    const geo = spikeG.clone();
    q.setFromUnitVectors(up, d);
    m.compose(d.clone().multiplyScalar(0.95), q, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    parts.push(paint(geo, 0x6d7d8a));
  });
  _mineGeo = mergeGeometries(parts, false);
  return _mineGeo;
}
let _mineMat = null;

export function makeMine() {
  if (!_mineMat) _mineMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: 0x9ec4e6 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mineGeometry(), _mineMat));

  const blink = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2b2b })
  );
  blink.position.set(0, 0, -0.82);
  g.add(blink);
  const glow = spriteGlow(0xff3b3b, 1.6, 0.9);
  glow.position.copy(blink.position);
  g.add(glow);

  return { group: g, blink, glow };
}

/* =========================================================
   거대 심해 보스 (아귀)
   ========================================================= */
export function makeBoss() {
  const g = new THREE.Group();

  const bodyG = new THREE.SphereGeometry(1, 18, 14);
  bodyG.scale(2.9, 2.5, 3.9);
  g.add(mesh(bodyG, MET.darkFlesh));

  const headG = new THREE.SphereGeometry(1, 16, 12);
  headG.scale(2.7, 2.4, 2.1);
  g.add(mesh(headG, MET.darkFlesh, 0, 0.1, -2.9));

  // 아래턱 (회전 피벗)
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.9, -3.4);
  const jawG = new THREE.SphereGeometry(1, 12, 8);
  jawG.scale(2.3, 0.55, 1.9);
  const jawMesh = new THREE.Mesh(jawG, new THREE.MeshPhongMaterial({ color: 0x2c3a4c, shininess: 20 }));
  jawMesh.position.set(0, -0.1, -0.4);
  jaw.add(jawMesh);
  g.add(jaw);

  // 이빨
  const toothG = new THREE.ConeGeometry(0.17, 0.75, 5);
  for (let i = 0; i < 9; i++) {
    const x = -1.85 + (i / 8) * 3.7;
    const t = new THREE.Mesh(toothG, MET.bone);
    t.position.set(x, -0.62, -3.9);
    t.rotation.x = Math.PI;
    t.rotation.z = (Math.random() - 0.5) * 0.25;
    g.add(t);
    const t2 = new THREE.Mesh(toothG, MET.bone);
    t2.position.set(x, -0.15, -3.85);
    t2.scale.setScalar(0.85);
    jaw.add(t2);
  }

  // 눈
  const eyeG = new THREE.SphereGeometry(0.36, 10, 8);
  g.add(mesh(eyeG, MET.eyeYellow, -1.15, 1.15, -4.2));
  g.add(mesh(eyeG, MET.eyeYellow, 1.15, 1.15, -4.2));
  const eg = spriteGlow(0xffd457, 4.5, 0.85);
  eg.position.set(-1.15, 1.15, -4.3);
  g.add(eg);
  const eg2 = eg.clone();
  eg2.position.x = 1.15;
  g.add(eg2);

  // 유인 돌기(루어)
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 3.4, 6), MET.darkFlesh);
  stalk.position.set(0.15, 3.0, -2.6);
  stalk.rotation.x = -0.55;
  g.add(stalk);
  const lure = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xa8ffe8 })
  );
  lure.position.set(0.15, 4.3, -4.4);
  g.add(lure);
  const lureGlow = spriteGlow(0x8ffff0, 9, 0.9);
  lureGlow.position.copy(lure.position);
  g.add(lureGlow);

  const light = new THREE.PointLight(0x8ffce8, 60, 46, 1.5);
  light.position.copy(lure.position);
  g.add(light);

  // 가슴지느러미
  const finG = new THREE.SphereGeometry(1, 10, 8);
  finG.scale(2.2, 0.22, 1.1);
  const fl = mesh(finG, MET.darkFlesh, -2.4, -0.6, 0.2);
  fl.rotation.z = 0.4;
  const fr = mesh(finG, MET.darkFlesh, 2.4, -0.6, 0.2);
  fr.rotation.z = -0.4;
  g.add(fl, fr);

  // 꼬리
  const tail = new THREE.Group();
  tail.position.set(0, 0, 3.6);
  const tailG = new THREE.ConeGeometry(1.0, 2.4, 6);
  tailG.rotateX(Math.PI / 2);
  const tm = new THREE.Mesh(tailG, MET.darkFlesh);
  tm.position.z = 1.1;
  tm.scale.set(1.7, 1.0, 1);
  tail.add(tm);
  g.add(tail);

  return { group: g, jaw, tail, lure, lureGlow, light };
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
  finG.scale(4.6, 0.26, 1.15);
  const finL = mesh(finG, belly, -4.2, -0.9, -3.2);
  finL.rotation.z = 0.55;
  finL.rotation.y = 0.28;
  const finR = mesh(finG, belly, 4.2, -0.9, -3.2);
  finR.rotation.z = -0.55;
  finR.rotation.y = -0.28;
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
    color: 0x2c4a63, shininess: 24, side: THREE.DoubleSide,
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
  const geo = new THREE.SphereGeometry(0.35 + rnd() * 0.35, 8, 6);
  geo.scale(1 + rnd() * 0.5, 0.55 + rnd() * 0.5, 1 + rnd() * 0.4);
  geo.translate(0, 0.25, 0);
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
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * height;
    const sway = Math.sin(t * 2.2 + seed) * 0.16 * t;
    const w = width * (1 - t * 0.55);
    pos.push(-w / 2, y, sway);
    pos.push(w / 2, y, sway);
    nor.push(0, 0, 1, 0, 0, 1);
    uv.push(0, t, 1, t);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const col = new THREE.Color().setHSL(0.28 + rnd() * 0.12, 0.55, 0.22 + rnd() * 0.12);
  return paint(g, col.getHex());
}
