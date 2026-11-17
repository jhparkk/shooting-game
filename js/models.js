/* =========================================================
   ABYSS DIVER — 절차적 3D 모델 빌더
   · 회전체(lathe) 몸통으로 만든 매끄러운 유선형 어류
   · 등·배지느러미 / 가슴지느러미 / 배지느러미 / 갈라진 꼬리지느러미
   · 눈(흰자+검은자), 등·배 투톤 피부, 줄무늬·반점
   · 정점 셰이더 기반 유영(tail-wagging) 애니메이션
   ========================================================= */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTextures } from './textures.js?v=20261118b3';

/** 표면 텍스처(피부·금속) — 처음 필요할 때 한 번만 굽는다 */
let _skinSet = null;
function skins() {
  if (!_skinSet) _skinSet = getTextures();
  return _skinSet;
}

/** 생물 피부 질감(미세 얼룩 + 범프)을 재질에 입힌다 */
function addSkin(mat, bump) {
  const t = skins();
  if (!mat.map) {
    mat.map = t.skin;
    mat.bumpMap = t.skinBump;
    mat.bumpScale = bump === undefined ? 0.5 : bump;
  }
  return mat;
}

/** 금속 패널/리벳 텍스처 */
function addMetal(mat, bump) {
  const t = skins();
  if (!mat.map) {
    mat.map = t.metal;
    mat.bumpMap = t.metalBump;
    mat.bumpScale = bump === undefined ? 0.6 : bump;
  }
  return mat;
}

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
  /* 밝은 노란 선체 — 어두운 심해에서도 잠수정이 한눈에 보이도록
     옅은 자체 발광을 섞는다(금속 패널 텍스처는 그대로) */
  hull: addMetal(new THREE.MeshPhongMaterial({
    color: 0xf7c400, shininess: 44, specular: 0x8a9096,
    emissive: 0x2a1f00, emissiveIntensity: 1,
  }), 0.18),
  hullDark: addMetal(new THREE.MeshPhongMaterial({
    color: 0xd9a400, shininess: 30, specular: 0x6b7176,
    emissive: 0x1e1500, emissiveIntensity: 1,
  }), 0.18),
  accent: new THREE.MeshPhongMaterial({ color: 0x2e3438, shininess: 40, specular: 0x66707a }),
  glass: new THREE.MeshPhongMaterial({
    color: 0x9fc3c8, emissive: 0x123033, emissiveIntensity: 0.55,
    transparent: true, opacity: 0.62, shininess: 160, specular: 0xffffff,
  }),
  metal: addMetal(new THREE.MeshPhongMaterial({ color: 0x7c858a, shininess: 90, specular: 0xa8b6c0 })),
  metalDark: addMetal(new THREE.MeshPhongMaterial({ color: 0x282d31, shininess: 60, specular: 0x66717c }), 0.45),
  eyeRed: new THREE.MeshBasicMaterial({ color: 0xff3b3b }),
  eyeYellow: new THREE.MeshBasicMaterial({ color: 0xfff0c2 }),
  bone: new THREE.MeshLambertMaterial({ color: 0xe9ece0 }),
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

/* 종별 유영 박자 — 게임 쪽에서 실제 이동 속도에 맞춰 바꾼다.
   (재질은 종마다 하나를 함께 쓰므로, 박자도 종 단위로 맞춘다) */
const SWIM_RATE = {};

/** 헤엄 박자 배율 (1 = 기본 속도) — 빠르게 헤엄칠수록 꼬리질이 잦아진다 */
export function setSwimRate(kind, factor) {
  const r = SWIM_RATE[kind];
  if (!r) return;
  const f = factor < 0.62 ? 0.62 : factor > 1.55 ? 1.55 : factor;
  r.u.value = r.base * f;
}

/** 유영 셰이더 재질 — 몸통이 좌우로 S 자로 흔들린다 */
function swimMaterial(params, bend, kind) {
  const mat = new THREE.MeshPhongMaterial(params);
  // 물고기 떼는 피부 텍스처의 세포 무늬가 '점박이'처럼 보여서 쓰지 않는다
  if (params && params.vertexColors && params.noSkin !== true) addSkin(mat, 0.45);
  const rate = bend.rateU || (bend.rateU = { value: bend.speed });
  if (kind) SWIM_RATE[kind] = { u: rate, base: bend.speed };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ANIM.time;
    shader.uniforms.uBendAmp = { value: bend.amp };
    shader.uniforms.uBendFreq = { value: bend.freq };
    shader.uniforms.uBendSpeed = rate;
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
          // 머리는 거의 고정, 뒤쪽 몸통·꼬리로 갈수록 크게 휘는 좌우 S자 파동
          float ph = uTime * uBendSpeed + seed - bt * uBendFreq;
          float k = smoothstep(0.0, 1.0, bt);
          k = k * k * (0.6 + 0.4 * bt);
          transformed.x += sin(ph) * uBendAmp * k;
          transformed.y += cos(ph * 0.7) * uBendAmp * 0.16 * k;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'swimBend';
  return mat;
}

/** 고래 유영 셰이더 재질 — 좌우가 아니라 위아래(Y축) S자 파동.
 *  머리는 안정적이고 허리에서 꼬리로 갈수록 위아래 진폭이 커진다. */
function whaleSwimMaterial(params, cfg, kind) {
  const mat = new THREE.MeshPhongMaterial(params);
  if (params && params.vertexColors) addSkin(mat, cfg.bump === undefined ? 0.5 : cfg.bump);
  const amp = { value: cfg.amp };
  const freq = { value: cfg.freq };
  const rate = cfg.rateU || (cfg.rateU = { value: cfg.speed });
  if (kind) SWIM_RATE[kind] = { u: rate, base: cfg.speed };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ANIM.time;
    shader.uniforms.uBodyAmp = amp;
    shader.uniforms.uBodyFreq = freq;
    shader.uniforms.uBodyRate = rate;
    shader.vertexShader =
      `uniform float uTime;
       uniform float uBodyAmp;
       uniform float uBodyFreq;
       uniform float uBodyRate;
       attribute float aBend;
      ` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float bt = aBend;
          float seed = modelMatrix[3].x * 0.11 + modelMatrix[3].z * 0.07;
          float ph = uTime * uBodyRate + seed - bt * uBodyFreq;
          float k = smoothstep(0.0, 1.0, bt);
          k = k * k * (0.55 + 0.45 * bt);
          // 위아래 물결 — 허리에서 꼬리로 갈수록 크게
          transformed.y += sin(ph) * uBodyAmp * k;
          // 파동을 따라 몸이 아주 살짝 옆으로도 흐른다 (고래는 좌우로 흔들지 않는다)
          transformed.x += sin(ph + 1.15) * uBodyAmp * 0.06 * k;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'whaleBend';
  return mat;
}

/** 그룹의 조각 전부를 감싸는 안쪽 그룹 — 몸통 전체의 부력(뜨고 가라앉기)용 */
function heaveCore(g) {
  const core = new THREE.Group();
  while (g.children.length) core.add(g.children[0]);
  g.add(core);
  return core;
}

/** 꼬리지느러미를 몸통 좌표계에 그대로 붙인다.
 *  지오메트리를 꼬리자루 위치(dz, dy)로 옮긴 뒤 몸통과 **같은 aBend(굽힘 계수)** 를 심는다.
 *  그러면 별도 그룹 이동·회전 없이 몸통 정점 셰이더가 꼬리 끝까지 하나의 연속된 곡선으로 휜다
 *  → 꼬리자루(peduncle)와 꼬리지느러미 사이에 틈이나 어긋남이 생기지 않는다. */
function flukeInBody(geo, dz, dy, z0, z1) {
  geo.translate(0, dy, dz);
  return bendify(geo, z0, z1);
}

/** 굽힘 계수를 모두 0 으로 — 꼬리 조각은 그룹 변환으로만 움직인다 */
function noBend(geo) {
  bendify(geo, 0, 1);
  const ab = geo.attributes.aBend;
  for (let i = 0; i < ab.count; i++) ab.setX(i, 0);
  return geo;
}

/** 같은 위상으로 꼬리 그룹을 흔든다 (셰이더 굽힘과 이어지게) */
function tailSwing(m, t) {
  const b = m.bend;
  if (!b || !m.tail) return;
  const spd = b.rateU ? b.rateU.value : b.speed;
  const seed = m.group.position.x * 0.11 + m.group.position.z * 0.07;
  const ph = t * spd + seed - m.tailT * b.freq;
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

  // 후미 추진 링 — 실제 잠수정처럼 어두운 금속 테 (발광 최소)
  const thr = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.05, 6, 18),
    new THREE.MeshPhongMaterial({ color: 0x3a4145, emissive: 0x0b1e20, emissiveIntensity: 1, shininess: 50, specular: 0x8a97a0 })
  );
  thr.position.set(0, 0, 1.72);
  g.add(thr);
  // 전조등
  const lampGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.26, 10);
  lampGeo.rotateX(Math.PI / 2);
  const lampL = mesh(lampGeo, MET.eyeYellow, -0.46, 0.22, -1.72);
  const lampR = mesh(lampGeo, MET.eyeYellow, 0.46, 0.22, -1.72);
  g.add(lampL, lampR);

  // 전조등 빛 원뿔 — 껍질이 아니라 '빛의 부피'처럼 보이게 셰이더로 그린다
  //  · 실루엣(법선이 시선과 수직)에서는 투명, 중심으로 갈수록 밝다
  //  · 끝으로 갈수록 옅어지고, 물결 따라 미세하게 일렁인다
  const coneMat = new THREE.ShaderMaterial({
    uniforms: {
      uI: { value: 0.03 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0.62, 0.93, 1.0) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vLocal;
      varying vec3 vNrmV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vLocal = position;
        vNrmV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uI;
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vLocal;
      varying vec3 vNrmV;
      varying vec3 vViewDir;
      void main() {
        float ndv = abs(dot(normalize(vNrmV), normalize(vViewDir)));
        float core = smoothstep(0.0, 0.62, ndv);
        // 램프(원뿔 꼭대기)에서 멀어질수록 옅어진다
        float axial = clamp((-vLocal.z - 0.4) / 24.0, 0.0, 1.0);
        float fade = pow(1.0 - axial, 1.35) * smoothstep(0.0, 0.10, axial);
        float ripple = 0.78 + 0.22 * sin(axial * 26.0 - uTime * 2.4 + vUv.x * 9.0);
        float a = core * fade * ripple * uI;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const coneGeo = new THREE.ConeGeometry(7.2, 24, 26, 1, true);
  coneGeo.rotateX(Math.PI / 2);
  coneGeo.translate(0, 0, -12.4);
  const beam = new THREE.Mesh(coneGeo, coneMat);
  beam.position.set(0, 0.18, -1.8);
  beam.frustumCulled = false;
  g.add(beam);

  // 전조등 렌즈의 빛무리
  g.add(spriteGlow(0xd8f8ff, 0.62, 0.62).translateX(-0.46).translateY(0.22).translateZ(-1.85));
  g.add(spriteGlow(0xd8f8ff, 0.62, 0.62).translateX(0.46).translateY(0.22).translateZ(-1.85));

  // 안테나
  const ant = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5), MET.metalDark, 0, 0.85, -0.1);
  ant.rotation.z = 0.16;
  g.add(ant);
  g.add(spriteGlow(0x9fe4ec, 0.34, 0.32).translateY(1.28));

  // 조명
  const spot = new THREE.SpotLight(0xcdf6ff, 26, 80, 0.5, 0.72, 1.1);
  spot.position.set(0, 0.25, -1.8);
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, -4.5, -20);
  g.add(spot, spotTarget);
  spot.target = spotTarget;

  const under = new THREE.PointLight(0x74b9c4, 3, 14, 1.6);
  under.position.set(0, -0.9, 0.4);
  g.add(under);

  // 전방 근거리 보조광 — 심해에서 바로 앞 바위·생물이 환하게 비친다
  const frontLight = new THREE.PointLight(0xd8f6ff, 0, 30, 1.35);
  frontLight.position.set(0, 0.15, -3.1);
  g.add(frontLight);

  return { group: g, propeller: prop, spot, beam, frontLight, under };
}

/* =========================================================
   백상아리 — 유선형 몸통 · 회청색 등 / 흰 배
   ========================================================= */
const SHARK_BEND = { amp: 0.22, freq: 3.6, speed: 3.2, wag: 0.46 };

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
      SHARK_BEND, 'shark'
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
const HAMMER_BEND = { amp: 0.22, freq: 3.4, speed: 2.9, wag: 0.48 };

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
      HAMMER_BEND, 'hammer'
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
const PUFFER_BEND = { amp: 0.1, freq: 3.0, speed: 2.2, wag: 0.34 };

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
  const spikeG = spikeGeo(0.05, 0.42, 6);
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
      d.clone().multiplyScalar(0.84),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    geo.applyMatrix4(m);
    spikeParts.push(paint(geo, 0xe0ab5e));
  }
  _pufferSpikeGeo = mergeGeometries(spikeParts, false);

  if (!_pufferMat) {
    _pufferMat = swimMaterial(
      { vertexColors: true, shininess: 34, specular: 0x6b5a30 },
      PUFFER_BEND, 'puffer'
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
const LION_BEND = { amp: 0.15, freq: 3.2, speed: 2.6, wag: 0.38 };

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
      LION_BEND, 'lion'
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
    }, ANGLER_BEND, 'angler');
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
  const skin = addSkin(new THREE.MeshPhongMaterial({
    color: KRAKEN.mantle, shininess: 42, specular: 0xb07090,
    emissive: 0x2a0a18, emissiveIntensity: 0.55,
  }), 0.7);
  const skinDark = addSkin(new THREE.MeshPhongMaterial({
    color: KRAKEN.mantleDark, shininess: 30, specular: 0x7a5060,
  }), 0.6);
  const limbMat = addSkin(new THREE.MeshPhongMaterial({
    vertexColors: true, shininess: 16, specular: 0x5a3a48,
    emissive: 0x24080f, emissiveIntensity: 0.5,
  }), 0.7);

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
   관상용 대형 생물 — 고래 4종 · 가오리 3종 · 바다거북
   · 회전체(lathe) 몸통 + 병합 디테일(주름·혹·무늬 패치·지느러미)
   · 각 모델은 update(t) 로 꼬리·날개를 부드럽게 움직인다
   ========================================================= */

const cl = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 조각들을 비인덱스로 통일해 병합 */
function mergeParts(list) {
  return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

/** 타원체 — 몸통 표면을 살짝 뚫고 나와 무늬 패치처럼 보인다 */
function ellipsePatch(parts, color, p, s, r) {
  const g = new THREE.SphereGeometry(1, 14, 10);
  g.scale(s[0], s[1], s[2]);
  parts.push(xf(paint(g, color), p, r));
}

/** 곡선을 따라가는 가는 관 (배 주름·촉수) */
function tubeAlong(pts, radius, color, segs, radial) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, segs || 18, radius, radial || 5, false);
  return paint(g, color);
}

/** 모서리가 둥근 상자 (향유고래의 각진 머리) */
function roundedBox(w, h, d, r, seg) {
  const s = seg || 6;
  const g = new THREE.BoxGeometry(w, h, d, s, s, s);
  const pos = g.attributes.position;
  const hx = Math.max(0.001, w / 2 - r);
  const hy = Math.max(0.001, h / 2 - r);
  const hz = Math.max(0.001, d / 2 - r);
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(cl(v.x, -hx, hx), cl(v.y, -hy, hy), cl(v.z, -hz, hz));
    v.sub(c);
    const l = v.length() || 0.0001;
    v.multiplyScalar(r / l);
    pos.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------
   혹등고래 — 긴 날개형 가슴지느러미(앞날 혹 돌기) · 배 주름
   --------------------------------------------------------- */
const HUMP_PROFILE = [
  [-8.8, 0.07], [-8.4, 0.72], [-7.7, 1.24], [-6.8, 1.6], [-5.6, 1.86],
  [-4.0, 2.02], [-1.9, 2.06], [0.4, 1.9], [2.4, 1.62], [4.2, 1.26],
  [5.8, 0.88], [6.9, 0.56], [7.5, 0.4],
];
let _humpGeo = null;
let _humpFluke = null;
let _humpMat = null;
/** 위아래 S자 파동 · 가슴지느러미 노 젓기 */
const HUMP_SWIM = { amp: 1.5, freq: 2.5, speed: 0.9, bump: 0.6 };

function humpbackGeometry() {
  if (_humpGeo) return _humpGeo;
  const profile = HUMP_PROFILE;
  const BACK = 0x35474f;
  const BELLY = 0xeae6d8;
  const FIN = 0x26353d;

  const body = bodyGeometry(profile, { radial: 26, sx: 0.94, sy: 0.95 });
  paintSkin(body, {
    back: BACK, belly: BELLY, halfHeight: 1.95, blend: [-0.52, 0.06], wave: 0.16,
    stripe: { color: 0x93a8b0, freq: 1.15, phase: 0, mix: 0.22, soft: 0.45, wobble: 0.9 },
  });
  const parts = [body];

  // 배 주름 (ventral pleats) — 아래턱부터 배까지 길게 이어진 홈
  for (let i = 0; i < 13; i++) {
    const x = (i / 12 - 0.5) * 2.5;
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const z = -8.1 + k * 0.79;
      const r = radiusAt(profile, z) * 0.94;
      const y = -Math.sqrt(Math.max(0.0025, r * r - x * x)) * 0.88;
      pts.push(new THREE.Vector3(x, y, z));
    }
    parts.push(tubeAlong(pts, 0.05, 0xc2bba8, 22, 4));
  }

  // 머리·턱의 혹 돌기 (tubercles)
  const rnd = mulberry(4711);
  for (let i = 0; i < 30; i++) {
    const z = -8.5 + rnd() * 2.6;
    const r = radiusAt(profile, z);
    const a = (rnd() - 0.5) * 2.1;
    const g = new THREE.SphereGeometry(0.09 + rnd() * 0.08, 6, 5);
    parts.push(xf(paint(g, 0x8a9aa0), [
      Math.sin(a) * r * 0.86,
      Math.cos(a) * r * 0.86,
      z,
    ]));
  }

  // 작은 등지느러미 (등의 혹 위)
  parts.push(xf(vfin([
    [-0.55, 0], [-0.42, 0.42], [-0.2, 0.6], [0.04, 0.46], [0.22, 0],
  ], 0.1, FIN), [0, 1.5, 2.05], [0, 0, 0], [1, 1, 1]));

  // 입 라인 — 아래턱을 따라 길게 이어지는 선
  const jawPts = [];
  for (let k = 0; k <= 10; k++) {
    const z = -8.5 + k * 0.42;
    const r = radiusAt(profile, z) * 0.94;
    jawPts.push(new THREE.Vector3(r * 0.97, -r * 0.42, z));
  }
  parts.push(tubeAlong(jawPts, 0.055, 0x5f7078, 18, 4));

  // 눈 — 몸통 표면에 살짝 나오게
  for (const s of [-1, 1]) {
    const ez = -6.4;
    const ex = radiusAt(profile, ez) * 0.94 * 0.96;
    eyeParts(parts, ex * s, -0.26, ez, 0.13, s);
  }

  _humpGeo = assemble(parts, -1.4, 7.5);
  return _humpGeo;
}

function humpbackFlukeGeometry() {
  if (_humpFluke) return _humpFluke;
  const pts = [
    [-4.0, -0.14], [-3.2, 0.52], [-2.1, 0.82], [-1.1, 0.72], [-0.42, 0.44],
    [0, 0.3], [0.42, 0.44], [1.1, 0.72], [2.1, 0.82], [3.2, 0.52], [4.0, -0.14],
    [2.6, -0.52], [1.4, -0.78], [0.5, -0.66], [0, -0.56], [-0.5, -0.66],
    [-1.4, -0.78], [-2.6, -0.52],
  ];
  _humpFluke = flukeInBody(
    hfin(pts, 0.18, 0x2b3a42, { smooth: true, curveSegments: 10 }),
    7.1, 0.08, -1.4, 7.5
  );
  return _humpFluke;
}

function humpbackPectoral(sign) {
  const C = 0xe4e0d2;
  const parts = [];
  const pts = [
    [0, 0.62], [1.3, 0.6], [2.7, 0.48], [3.9, 0.24], [4.9, -0.1],
    [5.2, -0.46], [4.5, -0.66], [3.2, -0.66], [1.6, -0.5], [0.2, -0.3],
  ].map(([x, y]) => [x * sign, y]);
  parts.push(hfin(pts, 0.15, C, { smooth: true }));
  // 앞날개를 따라 난 혹 돌기
  const rnd = mulberry(sign > 0 ? 71 : 72);
  for (let i = 0; i < 8; i++) {
    const t = 0.1 + i * 0.115;
    const x = t * 5.1 * sign;
    const y = 0.6 - t * 0.66;
    const g = new THREE.SphereGeometry(0.075 + rnd() * 0.05, 6, 5);
    parts.push(xf(paint(g, 0xd6d0bf), [x, 0, -y]));
  }
  return mergeParts(parts);
}

export function makeHumpbackWhale() {
  const geo = humpbackGeometry();
  if (!_humpMat) {
    _humpMat = whaleSwimMaterial({
      vertexColors: true, shininess: 24, specular: 0x4d6473, side: THREE.DoubleSide,
    }, HUMP_SWIM, 'humpback');
  }
  const g = new THREE.Group();
  const core = new THREE.Group();
  g.add(core);
  core.add(new THREE.Mesh(geo, _humpMat));

  // 꼬리지느러미 — 몸통과 같은 메시 좌표계·같은 굽힘 필드 (일체형 유영)
  const fluke = new THREE.Mesh(humpbackFlukeGeometry(), _humpMat);
  core.add(fluke);

  const fins = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(1.55 * s, -0.85, -3.1);
    pivot.add(new THREE.Mesh(humpbackPectoral(s), _humpMat));
    core.add(pivot);
    fins.push({ pivot, sign: s });
  }

  return {
    group: g, core, fluke, fins, tail: null,
    update(t) {
      const b = HUMP_SWIM;
      const rate = b.rateU ? b.rateU.value : b.speed;
      const f = rate / b.speed;
      const seed = g.position.x * 0.11 + g.position.z * 0.07;
      // 꼬리지느러미는 몸통 셰이더가 같은 위상으로 함께 휜다 (JS 이동 없음)
      // 가슴지느러미 — 노 젓듯 크게 위아래로, 앞뒤로도 살짝
      const fa = t * 0.6 * f + seed;
      for (const fin of fins) {
        const beat = Math.sin(fa + (fin.sign > 0 ? 0.45 : 0));
        fin.pivot.rotation.z = fin.sign * (-0.26 + beat * 0.24);
        fin.pivot.rotation.x = Math.sin(fa + 1.25) * 0.13;
        fin.pivot.rotation.y = fin.sign * (0.3 + beat * 0.06);
      }
      // 부력 — 몸 전체가 아주 느리게 떠오르고 가라앉는다
      core.position.y = Math.sin(t * 0.42 * f + seed) * 0.13;
    },
  };
}

/* ---------------------------------------------------------
   범고래 — 흑백 패턴(눈 뒤 흰 패치·안장 무늬·흰 배) · 높은 등지느러미
   --------------------------------------------------------- */
const ORCA_PROFILE = [
  [-4.9, 0.05], [-4.5, 0.44], [-3.9, 0.82], [-3.0, 1.08], [-1.9, 1.24],
  [-0.6, 1.27], [0.8, 1.17], [2.2, 0.96], [3.4, 0.68], [4.3, 0.4], [4.8, 0.22],
];
let _orcaGeo = null;
let _orcaFluke = null;
let _orcaMat = null;
const ORCA_SWIM = { amp: 0.62, freq: 2.4, speed: 1.55, bump: 0.35 };

function orcaGeometry() {
  if (_orcaGeo) return _orcaGeo;
  const profile = ORCA_PROFILE;
  const BLACK = 0x141a20;
  const WHITE = 0xf4f7f7;

  const body = bodyGeometry(profile, { radial: 26, sx: 0.93, sy: 0.97 });
  paintSkin(body, {
    back: BLACK, belly: WHITE, halfHeight: 1.2, blend: [-0.34, 0.16], wave: 0.2,
  });
  const parts = [body];

  // 눈 뒤 흰 패치 (postocular patch)
  for (const s of [-1, 1]) {
    const r = radiusAt(profile, -3.35) * 0.93;
    ellipsePatch(parts, WHITE, [r * 0.98 * s, 0.1, -3.35], [r * 0.16, 0.22, 0.62]);
  }
  // 안장 무늬 (등지느러미 뒤 옅은 회색)
  ellipsePatch(parts, 0x9aa7ae, [0, radiusAt(profile, 1.5) * 0.96, 1.5], [0.46, 0.14, 0.64]);
  // 흰 턱
  ellipsePatch(parts, WHITE, [0, -radiusAt(profile, -3.9) * 0.82, -3.9], [0.52, 0.18, 0.78]);

  // 높고 날렵한 등지느러미
  parts.push(xf(vfin([
    [-0.62, 0], [-0.4, 1.35], [-0.12, 1.78], [0.1, 1.42], [0.2, 0.72], [0.34, 0],
  ], 0.13, BLACK), [0, 1.05, 0.1], [0, 0, 0], [1, 1, 1]));

  // 눈 — 흰 패치 안쪽
  for (const s of [-1, 1]) {
    const ez = -3.7;
    const ex = radiusAt(profile, ez) * 0.93 * 0.96;
    eyeParts(parts, ex * s, 0.02, ez, 0.1, s);
  }
  // 입 라인
  const mouth = new THREE.BoxGeometry(1.1, 0.06, 0.5);
  parts.push(xf(paint(mouth, 0x0a0e12), [0, -0.5, -4.4], [0.06, 0, 0], [1, 1, 1]));

  _orcaGeo = assemble(parts, -1.2, 4.8);
  return _orcaGeo;
}

function orcaFlukeGeometry() {
  if (_orcaFluke) return _orcaFluke;
  const pts = [
    [-1.55, -0.06], [-1.0, 0.28], [-0.4, 0.36], [0, 0.2], [0.4, 0.36],
    [1.0, 0.28], [1.55, -0.06], [0.7, -0.32], [0, -0.38], [-0.7, -0.32],
  ];
  _orcaFluke = flukeInBody(
    hfin(pts, 0.12, 0x11171c, { smooth: true, curveSegments: 8 }),
    4.55, 0.02, -1.2, 4.8
  );
  return _orcaFluke;
}

/** 범고래 — 노 젓는 모양의 둥근 가슴지느러미 */
function orcaPectoral(sign) {
  const parts = [];
  parts.push(hfin([
    [0, 0.3], [0.75, 0.16], [1.45, -0.2], [1.55, -0.62],
    [1.1, -0.72], [0.4, -0.5], [0, -0.24],
  ].map(([x, y]) => [x * sign, y]), 0.09, 0x11171c, { smooth: true }));
  return mergeParts(parts);
}

export function makeOrca() {
  const geo = orcaGeometry();
  if (!_orcaMat) {
    _orcaMat = whaleSwimMaterial({
      vertexColors: true, shininess: 68, specular: 0x8fa8b8, side: THREE.DoubleSide,
    }, ORCA_SWIM, 'orca');
  }
  const g = new THREE.Group();
  const core = new THREE.Group();
  g.add(core);
  core.add(new THREE.Mesh(geo, _orcaMat));

  const fluke = new THREE.Mesh(orcaFlukeGeometry(), _orcaMat);
  core.add(fluke);

  const fins = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.95 * s, -0.5, -1.9);
    pivot.add(new THREE.Mesh(orcaPectoral(s), _orcaMat));
    core.add(pivot);
    fins.push({ pivot, sign: s });
  }

  return {
    group: g, core, fluke, fins, tail: null,
    update(t) {
      const b = ORCA_SWIM;
      const rate = b.rateU ? b.rateU.value : b.speed;
      const f = rate / b.speed;
      const seed = g.position.x * 0.11 + g.position.z * 0.07;
      const fa = t * 0.85 * f + seed;
      for (const fin of fins) {
        const beat = Math.sin(fa + (fin.sign > 0 ? 0.4 : 0));
        fin.pivot.rotation.z = fin.sign * (-0.16 + beat * 0.2);
        fin.pivot.rotation.x = Math.sin(fa + 1.2) * 0.11;
      }
      core.position.y = Math.sin(t * 0.5 * f + seed) * 0.06;
    },
  };
}

/* ---------------------------------------------------------
   향유고래 — 거대하고 각진 사각 머리 · 주름진 어두운 몸통
   --------------------------------------------------------- */
const SPERM_PROFILE = [
  [-3.2, 1.55], [-2.2, 1.82], [-1.0, 1.98], [0.6, 1.92], [2.4, 1.66],
  [4.2, 1.28], [5.8, 0.88], [6.9, 0.56], [7.5, 0.36],
];
let _spermGeo = null;
let _spermFluke = null;
let _spermMat = null;
const SPERM_SWIM = { amp: 1.0, freq: 2.1, speed: 0.95, bump: 0.75 };

function spermGeometry() {
  if (_spermGeo) return _spermGeo;
  const profile = SPERM_PROFILE;
  const SKIN = 0x4a453d;
  const BELLY = 0x9c9384;

  const body = bodyGeometry(profile, { radial: 24, sx: 0.92, sy: 0.95 });
  paintSkin(body, { back: SKIN, belly: BELLY, halfHeight: 1.9, blend: [-0.44, 0.12], wave: 0.24 });
  const parts = [body];

  // 각진 사각 머리
  const head = roundedBox(3.2, 3.4, 5.8, 1.25, 8);
  head.translate(0, 0.24, -4.3);
  parts.push(paint(head, SKIN));
  // 머리 앞면의 살짝 좁아지는 주둥이
  const snout = roundedBox(2.6, 2.4, 0.9, 0.6, 5);
  snout.translate(0, 0.08, -7.2);
  parts.push(paint(snout, 0x565046));
  // 머리와 몸통을 잇는 매끄러운 어깨
  ellipsePatch(parts, SKIN, [0, 0.12, -1.9], [1.66, 1.84, 1.7]);

  // 아래턱 — 가늘고 긴 턱 + 이빨
  const jaw = roundedBox(1.05, 0.55, 4.4, 0.22, 5);
  jaw.translate(0, -1.45, -4.9);
  parts.push(paint(jaw, 0x3d3830));
  for (let i = 0; i < 9; i++) {
    const z = -6.4 + i * 0.44;
    const g = new THREE.ConeGeometry(0.08, 0.24, 5);
    parts.push(xf(paint(g, 0xf2f4ea), [0, -1.26, z], [Math.PI, 0, 0], [1, 1, 1]));
  }

  // 몸통 주름 — 배와 옆면의 가로 홈
  const rnd = mulberry(5150);
  for (let i = 0; i < 13; i++) {
    const z = 0.2 + i * 0.55;
    const r = radiusAt(profile, z) * 0.995;
    const ring = new THREE.TorusGeometry(r, 0.018, 4, 24);
    parts.push(xf(paint(ring, 0x4c463c), [0, 0, z], [0, 0, 0], [1, 0.95, 1]));
  }

  // 등 혹 (작은 등지느러미)
  parts.push(xf(vfin([
    [-0.4, 0], [-0.22, 0.4], [0.05, 0.5], [0.3, 0.28], [0.36, 0],
  ], 0.09, 0x3e392f), [0, 1.5, 2.9], [0, 0, 0], [1, 1, 1]));

  // 작은 가슴지느러미 (앞쪽 아래)
  for (const s of [-1, 1]) {
    parts.push(xf(hfin([
      [0, 0.26], [0.5, 0.1], [0.78, -0.24], [0.62, -0.42], [0.2, -0.28], [0, -0.1],
    ].map(([x, y]) => [x * s, y]), 0.08, 0x3e392f, { smooth: true }),
      [1.6 * s, -0.7, -1.6], [0, 0, -0.2 * s], [1, 1, 1]));
  }

  // 눈 (머리 뒤 아래)
  for (const s of [-1, 1]) {
    const ez = -2.1;
    const ex = radiusAt(profile, ez) * 0.92 * 0.96;
    eyeParts(parts, ex * s, -0.5, ez, 0.12, s);
  }
  // 왼쪽 앞머리 분기공
  const blow = new THREE.SphereGeometry(0.18, 8, 6);
  blow.scale(1.6, 0.4, 1);
  parts.push(xf(paint(blow, 0x2f2b25), [-1.0, 2.05, -7.0]));

  _spermGeo = assemble(parts, -1.6, 7.5);
  return _spermGeo;
}

function spermFlukeGeometry() {
  if (_spermFluke) return _spermFluke;
  const pts = [
    [-3.0, -0.1], [-2.2, 0.4], [-1.2, 0.62], [-0.4, 0.44], [0, 0.24],
    [0.4, 0.44], [1.2, 0.62], [2.2, 0.4], [3.0, -0.1],
    [1.6, -0.46], [0.6, -0.62], [0, -0.5], [-0.6, -0.62], [-1.6, -0.46],
  ];
  _spermFluke = flukeInBody(
    hfin(pts, 0.15, 0x424038, { smooth: true, curveSegments: 8 }),
    7.2, 0.08, -1.6, 7.5
  );
  return _spermFluke;
}

export function makeSpermWhale() {
  const geo = spermGeometry();
  if (!_spermMat) {
    _spermMat = whaleSwimMaterial({
      vertexColors: true, shininess: 16, specular: 0x5a5346, side: THREE.DoubleSide,
    }, SPERM_SWIM, 'sperm');
  }
  const g = new THREE.Group();
  const core = new THREE.Group();
  g.add(core);
  core.add(new THREE.Mesh(geo, _spermMat));
  const fluke = new THREE.Mesh(spermFlukeGeometry(), _spermMat);
  core.add(fluke);
  return {
    group: g, core, fluke, fins: [], tail: null,
    update(t) {
      const b = SPERM_SWIM;
      const rate = b.rateU ? b.rateU.value : b.speed;
      const f = rate / b.speed;
      const seed = g.position.x * 0.11 + g.position.z * 0.07;
      core.position.y = Math.sin(t * 0.36 * f + seed) * 0.12;
    },
  };
}

/* ---------------------------------------------------------
   대왕고래 — 거대한 유선형 몸체 · 청회색 얼룩 · 긴 체형
   --------------------------------------------------------- */
const BLUE_PROFILE = [
  [-11.8, 0.06], [-11.3, 0.5], [-10.5, 0.98], [-9.2, 1.36], [-7.4, 1.64],
  [-5.0, 1.84], [-2.0, 1.92], [1.2, 1.8], [4.0, 1.5], [6.6, 1.08],
  [8.6, 0.66], [9.9, 0.34], [10.6, 0.22],
];
let _blueGeo = null;
let _blueFluke = null;
let _blueMat = null;
const BLUE_SWIM = { amp: 1.75, freq: 2.3, speed: 0.8, bump: 0.45 };

function blueGeometry() {
  if (_blueGeo) return _blueGeo;
  const profile = BLUE_PROFILE;
  const BACK = 0x54697d;
  const BELLY = 0xd5dde0;

  const body = bodyGeometry(profile, { radial: 26, sx: 0.9, sy: 0.93 });
  paintSkin(body, {
    back: BACK, belly: BELLY, halfHeight: 1.85, blend: [-0.55, 0.1], wave: 0.18,
    spot: { color: 0x93a9b8, threshold: 0.9, mix: 0.45 },
  });
  const parts = [body];

  // 목·배 주름
  for (let i = 0; i < 15; i++) {
    const x = (i / 14 - 0.5) * 2.3;
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const z = -10.6 + k * 0.92;
      const r = radiusAt(profile, z) * 0.9;
      const y = -Math.sqrt(Math.max(0.0025, r * r - x * x)) * 0.88;
      pts.push(new THREE.Vector3(x, y, z));
    }
    parts.push(tubeAlong(pts, 0.04, 0xc3c9c4, 22, 4));
  }

  // 등지느러미 (아주 작고 뒤쪽)
  parts.push(xf(vfin([
    [-0.5, 0], [-0.3, 0.36], [0.0, 0.44], [0.26, 0.22], [0.34, 0],
  ], 0.09, 0x44586b), [0, 1.28, 4.4], [0, 0, 0], [1, 1, 1]));

  // 눈
  for (const s of [-1, 1]) {
    const ez = -8.6;
    const ex = radiusAt(profile, ez) * 0.9 * 0.96;
    eyeParts(parts, ex * s, -0.28, ez, 0.1, s);
  }

  _blueGeo = assemble(parts, -2.0, 10.6);
  return _blueGeo;
}

function blueFlukeGeometry() {
  if (_blueFluke) return _blueFluke;
  const pts = [
    [-4.2, -0.1], [-3.3, 0.46], [-1.9, 0.66], [-0.6, 0.5], [0, 0.26],
    [0.6, 0.5], [1.9, 0.66], [3.3, 0.46], [4.2, -0.1],
    [2.2, -0.46], [1.0, -0.64], [0, -0.5], [-1.0, -0.64], [-2.2, -0.46],
  ];
  _blueFluke = flukeInBody(
    hfin(pts, 0.15, 0x44586b, { smooth: true, curveSegments: 8 }),
    10.2, 0.06, -2.0, 10.6
  );
  return _blueFluke;
}

function bluePectoral(sign) {
  return hfin([
    [0, 0.5], [1.2, 0.46], [2.5, 0.3], [3.5, 0.02], [3.9, -0.34],
    [3.4, -0.5], [2.3, -0.44], [1.1, -0.32], [0, -0.16],
  ].map(([x, y]) => [x * sign, y]), 0.1, 0x8fa4b2, { smooth: true });
}

export function makeBlueWhale() {
  const geo = blueGeometry();
  if (!_blueMat) {
    _blueMat = whaleSwimMaterial({
      vertexColors: true, shininess: 20, specular: 0x6a8296, side: THREE.DoubleSide,
    }, BLUE_SWIM, 'blue');
  }
  const g = new THREE.Group();
  const core = new THREE.Group();
  g.add(core);
  core.add(new THREE.Mesh(geo, _blueMat));

  const fluke = new THREE.Mesh(blueFlukeGeometry(), _blueMat);
  core.add(fluke);

  const fins = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(1.2 * s, -0.8, -3.6);
    pivot.add(new THREE.Mesh(bluePectoral(s), _blueMat));
    core.add(pivot);
    fins.push({ pivot, sign: s });
  }
  return {
    group: g, core, fluke, fins, tail: null,
    update(t) {
      const b = BLUE_SWIM;
      const rate = b.rateU ? b.rateU.value : b.speed;
      const f = rate / b.speed;
      const seed = g.position.x * 0.11 + g.position.z * 0.07;
      const fa = t * 0.5 * f + seed;
      for (const fin of fins) {
        const beat = Math.sin(fa + (fin.sign > 0 ? 0.4 : 0));
        fin.pivot.rotation.z = fin.sign * (-0.22 + beat * 0.18);
        fin.pivot.rotation.x = Math.sin(fa + 1.2) * 0.1;
      }
      core.position.y = Math.sin(t * 0.3 * f + seed) * 0.16;
    },
  };
}

/* ---------------------------------------------------------
   가오리 공용 — 날개(곡면) 생성기
   spec: { span, front(u), back(u), thick(u), dihedral(u), top, bottom, spot }
   --------------------------------------------------------- */
function wingGeometry(spec) {
  const ns = spec.ns || 18;
  const nv = spec.nv || 12;
  const span = spec.span;
  const top = new THREE.Color(spec.top);
  const bot = new THREE.Color(spec.bottom);
  const spotCol = spec.spot ? new THREE.Color(spec.spot.color) : null;
  const pos = [];
  const col = [];
  const idx = [];
  const row = nv + 1;
  const tmp = new THREE.Color();

  for (let side = 0; side < 2; side++) {
    const base = side * (ns + 1) * row;
    for (let i = 0; i <= ns; i++) {
      const u = i / ns;
      const x = u * span;
      const zf = spec.front(u);
      const zb = spec.back(u);
      for (let j = 0; j <= nv; j++) {
        const v = j / nv;
        const z = zf + (zb - zf) * v;
        const bulge = Math.pow(Math.sin(Math.PI * v), 0.55);
        const th = spec.thick(u) * bulge;
        const y = spec.dihedral(u) + (side === 0 ? th : -th);
        pos.push(x * (spec.flip ? -1 : 1), y, z);
        if (side === 0) {
          tmp.copy(top);
          if (spotCol) {
            const h = Math.sin(x * 3.7 + z * 5.1) * 43758.5453;
            const f = h - Math.floor(h);
            if (f > spec.spot.threshold) tmp.lerp(spotCol, spec.spot.mix * (0.2 + 0.8 * u));
          }
        } else {
          tmp.copy(bot);
        }
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (let i = 0; i < ns; i++) {
      for (let j = 0; j < nv; j++) {
        const a = base + i * row + j;
        const b = base + (i + 1) * row + j;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  planarUV(g, 0.42);
  return g;
}

/** 지오메트리에 위에서 내려다본 평면 uv 를 심는다 (uv 가 없는 날개·원반용) */
function planarUV(g, scale) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const s = scale === undefined ? 0.35 : scale;
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * s;
    uv[i * 2 + 1] = p.getZ(i) * s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** 날개 펄럭임 — 끝으로 갈수록 크게 물결친다 (정점 셰이더) */
let _flapKey = 0;
function flapMaterial(params, cfg) {
  const mat = new THREE.MeshPhongMaterial(params);
  if (params && params.vertexColors) addSkin(mat, 0.38);
  const amp = { value: cfg.amp };
  const freq = { value: cfg.freq };
  const speed = { value: cfg.speed };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFlapAmp = amp;
    shader.uniforms.uFlapFreq = freq;
    shader.uniforms.uFlapSpeed = speed;
    shader.vertexShader =
      'uniform float uTime;\nuniform float uFlapAmp;\nuniform float uFlapFreq;\nuniform float uFlapSpeed;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float s = clamp(abs(position.x) / ${cfg.span.toFixed(2)}, 0.0, 1.0);
          transformed.y += sin(uTime * uFlapSpeed - s * uFlapFreq) * uFlapAmp * s * s;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'flap' + (++_flapKey);
  mat.side = THREE.DoubleSide;
  return mat;
}

/* ---------------------------------------------------------
   만타가오리 — 넓은 다이아몬드 날개 · 앞 뿔지느러미 · 흰 배
   --------------------------------------------------------- */
let _mantaMat = null;
let _mantaWing = null;

function mantaWings() {
  if (_mantaWing) return _mantaWing;
  _mantaWing = wingGeometry({
    span: 5.8,
    ns: 20,
    nv: 12,
    front: (u) => -1.5 + 2.5 * u * u,
    back: (u) => 2.3 - 0.95 * u,
    thick: (u) => 0.26 * (1 - u * 0.75),
    dihedral: (u) => -0.1 + u * u * 0.55,
    top: 0x36485a,
    bottom: 0xf0f4f4,
    spot: { color: 0x8ba0b2, threshold: 0.93, mix: 0.35 },
  });
  return _mantaWing;
}

export function makeMantaRay() {
  if (!_mantaMat) {
    _mantaMat = flapMaterial(
      { vertexColors: true, shininess: 22, specular: 0x3c4e5e },
      { amp: 0.5, freq: 4.2, speed: 2.0, span: 5.8 }
    );
  }
  const g = new THREE.Group();
  const SKIN = 0x2e3d4a;
  const BELLY = 0xeef3f3;

  // 몸통 (납작한 판)
  const bodyG = bodyGeometry([
    [-2.4, 0.06], [-2.1, 0.5], [-1.6, 0.92], [-0.8, 1.2], [0.2, 1.24],
    [1.2, 1.05], [1.9, 0.7], [2.3, 0.35],
  ], { radial: 18, sx: 1.25, sy: 0.34 });
  paintSkin(bodyG, { back: SKIN, belly: BELLY, halfHeight: 0.45, blend: [-0.6, 0.1] });
  g.add(new THREE.Mesh(bodyG, _mantaMat));

  const wing = mantaWings();
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.7 * s, 0.02, 0.1);
    const m = new THREE.Mesh(wing, _mantaMat);
    if (s < 0) m.scale.x = -1;
    pivot.add(m);
    g.add(pivot);
    wings.push({ pivot, sign: s });
  }

  // 머리 앞 뿔지느러미 (cephalic lobes)
  for (const s of [-1, 1]) {
    const lobe = new THREE.CylinderGeometry(0.13, 0.2, 1.5, 8);
    lobe.rotateX(Math.PI / 2);
    lobe.scale(1, 1, 1);
    const part = paint(lobe, 0x243141);
    g.add(new THREE.Mesh(xf(part, [0.45 * s, -0.05, -2.6], [0.3, 0.22 * s, 0]), _mantaMat));
    const tip = new THREE.SphereGeometry(0.15, 8, 6);
    g.add(new THREE.Mesh(xf(paint(tip, 0x1e2a36), [0.62 * s, -0.12, -3.25], null, [1, 0.85, 1]), _mantaMat));
  }

  // 입 (앞쪽 아래)
  const mouth = new THREE.BoxGeometry(0.8, 0.05, 0.28);
  g.add(new THREE.Mesh(xf(paint(mouth, 0x141a22), [0, -0.24, -2.3]), _mantaMat));

  // 배쪽 아가미 슬릿 5쌍 + 반점
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const slit = new THREE.BoxGeometry(0.055, 0.03, 0.52);
      g.add(new THREE.Mesh(
        xf(paint(slit, 0x8fa2a8), [0.42 * s + i * 0.12 * s, -0.32, -0.5 + i * 0.05], [0, 0, 0.16 * s]),
        _mantaMat
      ));
    }
    for (let i = 0; i < 4; i++) {
      const dot = new THREE.SphereGeometry(0.07, 6, 5);
      g.add(new THREE.Mesh(
        xf(paint(dot, 0xc8d4d6), [(0.5 + i * 0.28) * s, -0.29, 0.5 - i * 0.22], null, [1, 0.4, 1]),
        _mantaMat
      ));
    }
  }

  // 눈
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.11, 8, 6);
    g.add(new THREE.Mesh(xf(paint(e, 0x0a0e12), [0.78 * s, 0.04, -1.95]), _mantaMat));
  }

  // 긴 꼬리
  const tail = new THREE.Group();
  tail.position.set(0, 0.02, 2.2);
  const tailG = new THREE.CylinderGeometry(0.07, 0.015, 5.6, 6);
  tailG.rotateX(Math.PI / 2);
  tailG.translate(0, 0, 2.8);
  tail.add(new THREE.Mesh(paint(tailG, 0x243141), _mantaMat));
  g.add(tail);

  const core = heaveCore(g);

  return {
    group: g, core, wings, tail, fins: [],
    update(t) {
      const beat = t * 2.0;
      for (const w of wings) {
        // 어깨 관절이 크게 오르내리고, 날개 끝은 셰이더가 조금 늦게 따라온다
        w.pivot.rotation.z = w.sign * (0.14 + Math.sin(beat + (w.sign > 0 ? 0.06 : 0)) * 0.46);
        w.pivot.rotation.x = Math.sin(beat + 1.4) * 0.07;
        w.pivot.rotation.y = w.sign * Math.sin(beat * 0.5) * 0.05;
      }
      // 날갯짓 박자에 맞춘 부력 — 몸통 전체가 떠오르고 가라앉는다
      core.position.y = Math.cos(beat + 0.35) * 0.26;
      core.rotation.z = Math.sin(beat + 1.0) * 0.05;
      // 뒤따라 흐르는 꼬리 물결
      tail.rotation.z = Math.sin(t * 1.05 - 0.8) * 0.16;
      tail.rotation.x = Math.sin(t * 0.7 - 0.5) * 0.1;
    },
  };
}

/* ---------------------------------------------------------
   매가오리 — 어두운 등 위 선명한 흰 반점 · 뾰족한 오리주둥이 · 채찍 꼬리
   --------------------------------------------------------- */
let _eagleMat = null;
let _eagleWing = null;

function eagleWings() {
  if (_eagleWing) return _eagleWing;
  _eagleWing = wingGeometry({
    span: 4.4,
    ns: 20,
    nv: 12,
    front: (u) => -0.9 + 3.0 * u * u,
    back: (u) => 1.9 - 1.5 * u,
    thick: (u) => 0.18 * (1 - u * 0.7),
    dihedral: (u) => -0.15 + u * u * 0.75,
    top: 0x1c2836,
    bottom: 0xdfe6e6,
    spot: { color: 0xeaf2f2, threshold: 0.87, mix: 0.85 },
  });
  return _eagleWing;
}

export function makeEagleRay() {
  if (!_eagleMat) {
    _eagleMat = flapMaterial(
      { vertexColors: true, shininess: 24, specular: 0x3a4a58 },
      { amp: 0.4, freq: 4.6, speed: 2.3, span: 4.4 }
    );
  }
  const g = new THREE.Group();
  const SKIN = 0x1c2836;

  // 몸통 — 앞이 솟은 연 모양
  const bodyG = bodyGeometry([
    [-2.6, 0.05], [-2.2, 0.34], [-1.6, 0.66], [-0.7, 0.9], [0.3, 0.86],
    [1.2, 0.6], [1.8, 0.3], [2.1, 0.12],
  ], { radial: 16, sx: 0.82, sy: 0.6 });
  paintSkin(bodyG, {
    back: SKIN, belly: 0xe4eaea, halfHeight: 0.55, blend: [-0.5, 0.12],
    spot: { color: 0xe8f0f0, threshold: 0.94, mix: 0.5 },
  });
  // 몸통을 살짝 솟구치게
  bodyG.translate(0, 0.12, 0);
  g.add(new THREE.Mesh(bodyG, _eagleMat));

  const wing = eagleWings();
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.5 * s, 0.06, 0.05);
    const m = new THREE.Mesh(wing, _eagleMat);
    if (s < 0) m.scale.x = -1;
    pivot.add(m);
    g.add(pivot);
    wings.push({ pivot, sign: s });
  }

  // 뾰족한 오리주둥이 머리
  const bill = new THREE.ConeGeometry(0.42, 1.5, 10);
  bill.rotateX(-Math.PI / 2);
  bill.scale(1.15, 0.5, 1);
  g.add(new THREE.Mesh(xf(paint(bill, SKIN), [0, 0.05, -2.7]), _eagleMat));
  const billTop = new THREE.SphereGeometry(0.42, 10, 8);
  billTop.scale(1.1, 0.45, 1.5);
  g.add(new THREE.Mesh(xf(paint(billTop, 0x22303f), [0, 0.06, -2.2]), _eagleMat));

  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.1, 8, 6);
    g.add(new THREE.Mesh(xf(paint(e, 0xf6f8ea), [0.4 * s, 0.18, -1.95]), _eagleMat));
    const p = new THREE.SphereGeometry(0.055, 6, 5);
    g.add(new THREE.Mesh(xf(paint(p, 0x080a0c), [0.44 * s, 0.19, -2.0]), _eagleMat));
  }

  // 긴 채찍 꼬리
  const tail = new THREE.Group();
  tail.position.set(0, 0.02, 1.9);
  const tpts = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    tpts.push(new THREE.Vector3(0, -k * 0.4, k * 7.4));
  }
  tail.add(new THREE.Mesh(tubeAlong(tpts, 0.055, SKIN, 16, 5), _eagleMat));
  const spine = new THREE.ConeGeometry(0.09, 0.5, 5);
  spine.rotateX(Math.PI / 2);
  tail.add(new THREE.Mesh(xf(paint(spine, 0xd8dcd2), [0, 0.02, 1.1]), _eagleMat));
  g.add(tail);

  const core = heaveCore(g);

  return {
    group: g, core, wings, tail, fins: [],
    update(t) {
      const beat = t * 2.3;
      for (const w of wings) {
        w.pivot.rotation.z = w.sign * (0.18 + Math.sin(beat + (w.sign > 0 ? 0.05 : 0)) * 0.4);
        w.pivot.rotation.x = Math.sin(beat + 1.5) * 0.06;
        w.pivot.rotation.y = w.sign * Math.sin(beat * 0.5) * 0.06;
      }
      core.position.y = Math.cos(beat + 0.5) * 0.22;
      core.rotation.z = Math.sin(beat + 1.1) * 0.05;
      tail.rotation.x = Math.sin(beat * 0.6 - 0.7) * 0.14;
      tail.rotation.z = Math.sin(beat * 0.45 - 0.4) * 0.1;
    },
  };
}

/* ---------------------------------------------------------
   노랑가오리 — 둥글넓적한 원반 몸체 · 부드러운 가장자리 날개짓
   --------------------------------------------------------- */
let _stingMat = null;
let _stingDiscTop = null;
let _stingDiscBot = null;

function discGeometry(rings, segs, R, rz, top, bottom, edge) {
  const pos = [];
  const col = [];
  const idx = [];
  const cTop = new THREE.Color(top);
  const cBot = new THREE.Color(bottom);
  const cEdge = new THREE.Color(edge);
  const row = segs;
  for (let side = 0; side < 2; side++) {
    const base = side * (rings * row + 1);
    // 중심점
    pos.push(0, side === 0 ? 0.12 : -0.1, 0);
    const cc = side === 0 ? cTop : cBot;
    col.push(cc.r, cc.g, cc.b);
    for (let i = 1; i <= rings; i++) {
      const t = i / rings;
      for (let j = 0; j < row; j++) {
        const a = (j / row) * Math.PI * 2;
        const ripple = 1 + 0.035 * Math.cos(a * 3);
        const x = Math.cos(a) * R * t * ripple;
        const z = Math.sin(a) * rz * t * ripple - 0.25;
        const y = (side === 0 ? 0.12 : -0.1) * (1 - t * 0.8) + (side === 0 ? 0.02 : -0.02);
        pos.push(x, y, z);
        let c = side === 0 ? cTop : cBot;
        if (side === 0 && t > 0.55) {
          const h = Math.sin(x * 2.6 + z * 3.4) * 43758.5453;
          const f = h - Math.floor(h);
          if (f > 0.7) c = cTop.clone().lerp(cEdge, 0.55);
        }
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < row; j++) {
      idx.push(base, base + 1 + ((j + 1) % row), base + 1 + j);
    }
    for (let i = 1; i < rings; i++) {
      for (let j = 0; j < row; j++) {
        const a = base + 1 + (i - 1) * row + j;
        const b = base + 1 + (i - 1) * row + ((j + 1) % row);
        const c = a + row;
        const d = b + row;
        if (side === 0) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  planarUV(g, 0.4);
  return g;
}

/** 원반 전체가 앞→뒤로 물결치는 재질 */
let _discKey = 0;
function discMaterial(params, cfg) {
  const mat = new THREE.MeshPhongMaterial(params);
  if (params && params.vertexColors) addSkin(mat, 0.4);
  const amp = { value: cfg.amp };
  const speed = { value: cfg.speed };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRipAmp = amp;
    shader.uniforms.uRipSpeed = speed;
    shader.vertexShader =
      'uniform float uTime;\nuniform float uRipAmp;\nuniform float uRipSpeed;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float r = clamp(length(position.xz) / ${cfg.radius.toFixed(2)}, 0.0, 1.0);
          // 앞→뒤로 미끄러지는 물결 + 가장자리 전체가 한 박자에 날개짓하는 맥동
          float w = sin(uTime * uRipSpeed - position.z * 1.15) * 0.55
                  + sin(uTime * uRipSpeed - r * 2.6) * 0.45;
          transformed.y += w * uRipAmp * (0.2 + 0.8 * r * r);
        }`
      );
  };
  mat.customProgramCacheKey = () => 'disc' + (++_discKey);
  mat.side = THREE.DoubleSide;
  return mat;
}

export function makeStingray() {
  if (!_stingMat) {
    _stingMat = discMaterial(
      { vertexColors: true, shininess: 26, specular: 0x867a4e },
      { amp: 0.28, speed: 2.3, radius: 3.1 }
    );
    _stingDiscTop = discGeometry(7, 26, 3.1, 2.9, 0xb08a4a, 0xd9d3c0, 0x6d5228);
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(_stingDiscTop, _stingMat));

  // 눈 (등쪽 앞)
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.12, 8, 6);
    g.add(new THREE.Mesh(xf(paint(e, 0x1a1610), [0.55 * s, 0.2, -2.0]), _stingMat));
  }
  // 분수공
  for (const s of [-1, 1]) {
    const sp = new THREE.SphereGeometry(0.07, 6, 5);
    g.add(new THREE.Mesh(xf(paint(sp, 0x5a4526), [0.82 * s, 0.16, -1.55]), _stingMat));
  }

  // 채찍 꼬리 + 가시
  const tail = new THREE.Group();
  tail.position.set(0, 0.05, 2.6);
  const pts = [];
  for (let i = 0; i <= 7; i++) {
    const k = i / 7;
    pts.push(new THREE.Vector3(0, -k * 0.25, k * 4.4));
  }
  tail.add(new THREE.Mesh(tubeAlong(pts, 0.06, 0x8c6f3c, 14, 5), _stingMat));
  const barb = new THREE.ConeGeometry(0.11, 0.62, 5);
  barb.rotateX(Math.PI / 2);
  tail.add(new THREE.Mesh(xf(paint(barb, 0x3d3226), [0, 0.02, 1.6]), _stingMat));
  g.add(tail);

  const core = heaveCore(g);

  return {
    group: g, core, tail, wings: [], fins: [],
    update(t) {
      const beat = t * 2.3;
      // 납작한 원반이 날개짓 박자에 맞춰 떠오르고 가라앉는다
      core.position.y = Math.cos(beat + 0.3) * 0.26;
      core.rotation.z = Math.sin(beat + 0.9) * 0.06;
      core.rotation.x = Math.sin(beat * 0.5) * 0.04;
      tail.rotation.x = Math.sin(beat * 0.55 - 0.8) * 0.2;
      tail.rotation.z = Math.sin(beat * 0.42 - 0.5) * 0.24;
    },
  };
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
  const flippers = [];  const specs = [
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

  const core = heaveCore(g);

  return {
    group: g, core, head, flippers,
    update(t) {
      for (let i = 0; i < flippers.length; i++) {
        const p = flippers[i];
        const front = i < 2;
        // 앞지느린발은 크게, 뒤지느린발은 반 박자 늦게 작게 — 8자 노 젓기
        const beat = t * 1.55 + (front ? 0 : Math.PI * 0.8) + (i % 2 ? 0.2 : 0);
        p.rotation.z = p.userData.base + Math.sin(beat) * (front ? 0.62 : 0.26);
        p.rotation.x = Math.cos(beat) * (front ? 0.38 : 0.18);
      }
      // 몸통이 살짝 피치·롤링하며 떠간다
      core.position.y = Math.sin(t * 1.55 + 0.4) * 0.06;
      core.rotation.z = Math.sin(t * 0.5) * 0.07;
      core.rotation.x = Math.sin(t * 1.55 + 2.0) * 0.035;
      head.rotation.y = Math.sin(t * 0.5) * 0.12;
    },
  };
}

/* =========================================================
   관상 물고기 떼 (InstancedMesh)
   ========================================================= */
const SCHOOL_BEND = { amp: 0.13, freq: 4.2, speed: 6.0, wag: 0.0 };
const _schoolGeo = Object.create(null);
const _schoolMat = Object.create(null);

/* 산호초를 헤엄치는 어종 — 몸통·지느러미 색과 무늬가 다르다.
   은빛 몸통 + 주황 지느러미(참고 사진)를 기본으로, 열대 산호초의
   파랑·노랑·코랄·줄무늬 어종을 더한다. */
export const FISH_KINDS = {
  silver: {
    back: 0x8098a8, belly: 0xf6fbfd, blend: [-0.36, 0.06],
    fin: 0xff8f3a, tail: 0xff7d2a, dorsal: 0xffa650,
    emissive: 0x141a1d,
  },
  tang: {
    back: 0x1f79b8, belly: 0x6ab8e2, blend: [-0.44, 0.08],
    fin: 0xffd447, tail: 0xffcf36, dorsal: 0x2a86c4,
    stripe: { color: 0x123a63, freq: 5.5, phase: 0.1, soft: 0.55, mix: 0.35 },
    emissive: 0x0d2230,
  },
  yellow: {
    back: 0xf7c222, belly: 0xffe487, blend: [-0.42, 0.18],
    fin: 0xffe066, tail: 0xffdf5c, dorsal: 0xffd23c,
    emissive: 0x2a1f00,
  },
  coral: {
    back: 0xe4643f, belly: 0xf8bd97, blend: [-0.44, 0.14],
    fin: 0xd9568f, tail: 0xe06898, dorsal: 0xe4643f,
    emissive: 0x2a1208,
  },
  striped: {
    back: 0xf2e7c2, belly: 0xfffbf0, blend: [-0.42, 0.18],
    fin: 0xffd75e, tail: 0xffd75e, dorsal: 0xffd75e,
    stripe: { color: 0x27366b, freq: 15, phase: 0.02, soft: 0.12, mix: 0.72 },
    emissive: 0x2a2718,
  },
};

export function makeFishGeometry(variant) {
  const key = FISH_KINDS[variant] ? variant : 'silver';
  if (_schoolGeo[key]) return _schoolGeo[key];
  const v = FISH_KINDS[key];

  const profile = [
    [-0.50, 0.02], [-0.40, 0.10], [-0.28, 0.175], [-0.12, 0.225],
    [0.06, 0.215], [0.22, 0.165], [0.33, 0.10], [0.40, 0.055],
  ];
  const body = bodyGeometry(profile, { radial: 14, sx: 0.72, sy: 1.0 });
  paintSkin(body, {
    back: v.back, belly: v.belly, halfHeight: 0.2, blend: v.blend,
    stripe: v.stripe,
  });

  const parts = [body];
  // 꼬리 — 갈라진 부채
  const tail = vfin([
    [0.00, 0.04], [0.10, 0.16], [0.16, 0.19], [0.13, 0.02],
    [0.17, -0.18], [0.10, -0.15], [0.00, -0.04],
  ], 0.026, v.tail, { smooth: true });
  parts.push(xf(tail, [0, 0, 0.38], [0, 0, 0], [1, 1, 1]));
  // 등지느러미
  const dorsal = vfin([
    [-0.09, 0.19], [0.02, 0.28], [0.11, 0.28], [0.11, 0.19],
  ], 0.022, v.dorsal);
  parts.push(xf(dorsal, [0, 0, 0.0], [0, 0, 0], [1, 1, 1]));
  // 배지느러미
  const pelvic = vfin([
    [-0.04, -0.14], [0.04, -0.22], [0.10, -0.22], [0.08, -0.14],
  ], 0.018, v.fin);
  parts.push(xf(pelvic, [0, 0, 0.14], [0, 0, 0], [1, 1, 1]));
  // 눈
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.05, 6, 5);
    parts.push(xf(paint(eye, 0x0d1114), [0.095 * s, 0.06, -0.34], [0, 0, 0], [1, 1, 1]));
    // 눈테의 밝은 고리 — 작은 점이지만 얼굴이 살아 보인다
    const rim = new THREE.SphereGeometry(0.062, 6, 5);
    parts.push(xf(paint(rim, 0xf2f6f4), [0.093 * s, 0.06, -0.335], [0, 0, 0], [1, 1, 1]));
  }
  // 가슴지느러미
  for (const s of [-1, 1]) {
    const fin = hfin([
      [0, 0.06], [0.10, 0.02], [0.13, -0.05], [0.04, -0.05],
    ].map(([x, y]) => [x * s, y]), 0.014, v.fin);
    parts.push(xf(fin, [0.10 * s, -0.04, -0.18], [0, 0, 0], [1, 1, 1]));
  }
  _schoolGeo[key] = assemble(parts, -0.4, 0.58);
  return _schoolGeo[key];
}

/** 떼 하나 = 한 어종(InstancedMesh). 개체별로 아주 옅은 색 차이만 둔다 */
export function makeFishSchool(count, variant) {
  const key = FISH_KINDS[variant] ? variant : 'silver';
  const v = FISH_KINDS[key];
  const geo = makeFishGeometry(key);
  if (!_schoolMat[key]) {
    _schoolMat[key] = swimMaterial({
      vertexColors: true, shininess: 52, specular: 0x93a2aa,
      emissive: v.emissive,   // 물속 산란광 — 원거리에서 검은 점으로 죽지 않게
      noSkin: true,
    }, SCHOOL_BEND, 'school');
  }
  const inst = new THREE.InstancedMesh(geo, _schoolMat[key], count);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const palette = [0xffffff, 0xf2f6f4, 0xfff8ea, 0xe8f2f4, 0xfaeee0, 0xf6f2ff];
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
/** 매끄러운 3차원 덩어리 함수 — 정점을 유기적으로 밀어낸다 (이음새 없음) */
function lump3(x, y, z, s) {
  const a = Math.sin(x * 1.9 + s * 0.7) * Math.cos(y * 1.6 - s * 0.4) * Math.sin(z * 2.1 + s * 1.1);
  const b = Math.sin(x * 4.3 - s * 0.3 + z * 0.6) * Math.cos(y * 3.7 + s * 0.9);
  const c = Math.sin(x * 8.1 + s * 1.7) * Math.cos(z * 7.3 - s * 0.5);
  return a * 0.62 + b * 0.28 + c * 0.10;
}

/**
 * 해저 바위 — 각진 다면체(플랫 셰이딩) 대신,
 * 매끄럽게 이어진 고세그먼트 구를 여러 옥타브 노이즈로 일그러뜨린 유기적 형상.
 * (모서리·각이 보이면 바로 '레고/만화' 느낌이 나므로 정점을 병합해 부드럽게 음영진다)
 */
export function rockGeometry(radius, seed, detail) {
  let geo = new THREE.IcosahedronGeometry(radius, detail === undefined ? 2 : detail);
  geo = mergeVertices(geo, 1e-4);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const s = (seed % 97) * 0.31;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const f = 1
      + lump3(v.x * 1.5, v.y * 1.5, v.z * 1.5, s) * 0.27
      + lump3(v.x * 3.6 + 4.0, v.y * 3.6, v.z * 3.6, s + 2.3) * 0.11
      + lump3(v.x * 7.9, v.y * 7.9 + 2.0, v.z * 7.9, s + 4.1) * 0.05;
    // 아래로 갈수록 살짝 넓어지고 납짝해진다 — 해저에 파묻혀 앉은 바위
    const widen = 1 + Math.max(0, -v.y) * 0.16;
    pos.setXYZ(
      i,
      v.x * radius * f * widen,
      v.y * radius * f * 0.70,
      v.z * radius * f * widen
    );
  }
  geo.computeVertexNormals();
  // 병합 대상(지형 격자)이 비인덱스이므로 정점을 풀어 둔다 — 노멀은 이미 매끄럽게 계산됨
  return geo.toNonIndexed();
}

/** 가지형 산호 — 밑동이 굵고 끝으로 갈수록 가늘어지는, 둥글게 굽은 가지 */
export function branchCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const trunkH = 0.95 + rnd() * 0.95;
  const trunk = new THREE.CylinderGeometry(0.15, 0.26, trunkH, 7, 2);
  trunk.translate(0, trunkH / 2, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const t = tp.getY(i) / trunkH;
    tp.setX(i, tp.getX(i) + Math.sin(t * 2.2 + rnd() * 0.05) * 0.06);
  }
  trunk.computeVertexNormals();
  parts.push(paint(trunk, color));

  const branches = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < branches; i++) {
    const h = 0.45 + rnd() * 0.62;
    const b = new THREE.CylinderGeometry(0.045, 0.10, h, 6, 2);
    b.translate(0, h / 2, 0);
    const bp = b.attributes.position;
    const bend = (rnd() - 0.5) * 0.5;
    for (let k = 0; k < bp.count; k++) {
      const t = bp.getY(k) / h;
      bp.setX(k, bp.getX(k) + bend * h * t * t);
    }
    b.computeVertexNormals();
    const m = new THREE.Matrix4();
    const e = new THREE.Euler((rnd() - 0.5) * 0.9, rnd() * Math.PI * 2, (rnd() - 0.5) * 1.1);
    m.makeRotationFromEuler(e);
    m.setPosition((rnd() - 0.5) * 0.34, trunkH * (0.5 + rnd() * 0.45), (rnd() - 0.5) * 0.34);
    b.applyMatrix4(m);
    parts.push(paint(b, color));
    // 가지 끝의 작은 혹 — 뾰족한 원뿔 대신 산호 폴립 덩어리
    if (rnd() < 0.65) {
      const knob = new THREE.SphereGeometry(0.055 + rnd() * 0.04, 6, 4);
      knob.applyMatrix4(new THREE.Matrix4().makeTranslation(
        (rnd() - 0.5) * 0.34 + bend * 0.4, trunkH * (0.55 + rnd() * 0.4), (rnd() - 0.5) * 0.34
      ));
      parts.push(paint(knob, color));
    }
  }
  return mergeGeometries(parts, false);
}

/** 부채형/뇌형 산호 */
export function blobCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const geo = new THREE.SphereGeometry(0.22 + rnd() * 0.17, 10, 8);
  geo.scale(1 + rnd() * 0.45, 0.5 + rnd() * 0.4, 1 + rnd() * 0.35);
  geo.translate(0, 0.2, 0);
  return paint(geo, color);
}

/** 부채산호 — 부챗살처럼 펼쳐진 가는 가지 (끝으로 갈수록 가늘고 부드럽게 휜다) */
export function fanCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const R = 0.95 + rnd() * 0.75;
  const n = 8 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1) - 0.5) * 1.6 + (rnd() - 0.5) * 0.06;
    const h = R * (0.62 + Math.cos(a * 1.02) * 0.68) * (0.72 + rnd() * 0.45);
    const r0 = 0.055 + rnd() * 0.030;
    const g = new THREE.CylinderGeometry(r0 * 0.45, r0, h, 4, 4);
    g.translate(0, h / 2, 0);
    // 가지가 바깥으로 완만하게 휘도록
    const p = g.attributes.position;
    const curl = (0.10 + rnd() * 0.12) * Math.sign(a || 1);
    for (let k = 0; k < p.count; k++) {
      const t = p.getY(k) / h;
      p.setX(k, p.getX(k) + curl * h * t * t);
    }
    g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(a));
    parts.push(paint(g, color));
  }
  // 부채 받침 줄기
  const stem = new THREE.CylinderGeometry(0.045, 0.075, 0.42, 5);
  stem.translate(0, 0.21, 0);
  parts.push(paint(stem, color));
  return mergeGeometries(parts, false);
}

/** 뇌산호 — 반구 위에 굽이치는 골(정맥) */
export function brainCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const r = 0.44 + rnd() * 0.34;
  const geo = new THREE.SphereGeometry(r, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const groove = Math.sin(x * 15 + Math.sin(z * 9.5) * 1.7) * 0.5 + 0.5;
    const k = 1 - groove * 0.05;
    pos.setXYZ(i, x * k, y * 0.9, z * k);
  }
  geo.computeVertexNormals();
  return paint(geo, color);
}

/** 작은 산호 다발 — 바닥을 촘촘히 덮는 낮은 군체 (뷁족한 원뿔 대신 둥근 혹) */
export function tuftCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const n = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const r = 0.10 + rnd() * 0.10;
    const g = new THREE.SphereGeometry(r, 7, 5);
    g.scale(1, 0.72 + rnd() * 0.5, 1);
    const m = new THREE.Matrix4().makeTranslation(
      (rnd() - 0.5) * 0.72, r * 0.45, (rnd() - 0.5) * 0.72
    );
    g.applyMatrix4(m);
    parts.push(paint(g, color));
  }
  return mergeGeometries(parts, false);
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

/** 아래→위 색 그라데이션 (산호 가지 끝·조약돌 윗면·잎사귀 끝을 밝게) */
export function paintGradient(geo, colorA, colorB, yMin, yMax) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const a = new THREE.Color(colorA);
  const b = new THREE.Color(colorB);
  const c = new THREE.Color();
  let lo = yMin;
  let hi = yMax;
  if (lo === undefined || hi === undefined) {
    geo.computeBoundingBox();
    lo = geo.boundingBox.min.y;
    hi = geo.boundingBox.max.y;
  }
  const span = Math.max(1e-3, hi - lo);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - lo) / span));
    c.copy(a).lerp(b, t * t * (3 - 2 * t));
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** 판상형 석회암 선반 — 납작한 바위 판이 층층이 겹쳐 쌓인 바위 */
export function slabRockGeometry(radius, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const layers = 2 + Math.floor(rnd() * 3);
  let y = -radius * 0.08;
  for (let i = 0; i < layers; i++) {
    const r = radius * (1 - i * 0.17) * (0.78 + rnd() * 0.34);
    const g = rockGeometry(r, seed + i * 37, 1);
    // 눌러서 판처럼 — 위로 갈수록 조금씩 작아진다
    g.scale(1 + rnd() * 0.24, 0.15 + rnd() * 0.13, 0.76 + rnd() * 0.34);
    g.rotateY(rnd() * Math.PI * 2);
    g.translate((rnd() - 0.5) * radius * 0.32, y + r * 0.1, (rnd() - 0.5) * radius * 0.32);
    y += r * 0.2;
    parts.push(g);
  }
  return mergeGeometries(parts, false);
}

/** 주상 절리 현무암 기둥 — 각이 살아 있는 돌기둥 무리 (심해 지대) */
export function columnRockGeometry(radius, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const h = radius * (1.15 + rnd() * 1.9);
    const rr = radius * (0.26 + rnd() * 0.22);
    const g = new THREE.CylinderGeometry(rr * (0.84 + rnd() * 0.22), rr, h, 6, 3);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      const a = Math.atan2(z, x);
      const wob = Math.sin(a * 3 + y * 0.8 + i * 1.7) * 0.08 * rr;
      p.setXYZ(k, x + Math.cos(a) * wob, y, z + Math.sin(a) * wob);
    }
    g.computeVertexNormals();
    g.rotateY(rnd() * Math.PI * 2);
    g.rotateZ((rnd() - 0.5) * 0.22);
    g.translate((rnd() - 0.5) * radius * 1.0, h / 2 - radius * 0.18, (rnd() - 0.5) * radius * 1.0);
    parts.push(g);
  }
  return mergeGeometries(parts, false);
}

/** 조약돌 무리 — 모래 위에 굴러다니는 둥근 자갈 군집 */
export function pebbleClusterGeometry(radius, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const n = 6 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const r = radius * (0.16 + rnd() * 0.26);
    const g = rockGeometry(r, seed + i * 13, 1);
    g.scale(1 + rnd() * 0.3, 0.4 + rnd() * 0.26, 1 + rnd() * 0.3);
    g.rotateY(rnd() * Math.PI * 2);
    const a = rnd() * Math.PI * 2;
    const d = radius * Math.sqrt(rnd()) * 0.95;
    g.translate(Math.cos(a) * d, r * (0.1 + rnd() * 0.22), Math.sin(a) * d);
    parts.push(g);
  }
  return mergeGeometries(parts, false);
}

/**
 * 큰 바위 동굴 — 거대한 암반 덩어리에 자연스러운 통로가 뚫린 구조.
 *
 * 예쁜 둥근 바위를 동그랗게 쌓아 만든 '무지개 아치'와 달리,
 * 하나의 유기적인 암반 덩어리(매끄러운 타원체 + 여러 옥타브 요철)에
 * 굽이치는 통로가 뚫려 있다. 통로는 잠수정이 그대로 지나갈 수 있고,
 * 입구는 둥근 드릴 구멍이 아니라 잔물결처럼 삐뚤빼뚤한 자연 동굴 아가리다.
 *
 * 좌표계: 통로 축 = 로컬 Z (원점 통과), 반환하는 colliders 도 로컬 좌표.
 * geo 는 인덱스 지오메트리라 정점 수가 적다 (통로 안쪽·바깥쪽 한 덩어리).
 */
export function rockCaveGeometry(seed, opts) {
  const o = opts || {};
  const rnd = mulberry(seed);
  const A = o.halfLength === undefined ? 22 : o.halfLength;   // 축 방향 반길이
  const B = o.radius === undefined ? 20 : o.radius;           // 최대 외곽 반지름
  const bore = o.bore === undefined ? 6.4 : o.bore;           // 통로 반지름
  const NS = o.segU === undefined ? 34 : o.segU;              // 축 방향 분할
  const NA = o.segA === undefined ? 44 : o.segA;              // 둘레 분할
  const ky = 0.86;                                            // 세로로 살짝 눌러 앉은 암반

  const s1 = rnd() * 6.28, s2 = rnd() * 6.28, s3 = rnd() * 6.28;
  const s4 = rnd() * 6.28, s5 = rnd() * 6.28, s6 = rnd() * 6.28;

  /* 단면 형상 — 완전한 원이 아니라 비대칭으로 불룩한 암반 */
  const section = (a) => 1 + 0.15 * Math.cos(a * 2 + s1) + 0.085 * Math.cos(a * 3 - s2)
    + 0.05 * Math.cos(a * 5 + s3);

  /* 외곽 요철 — 낮은 주파수의 큰 혹 + 잔 요철. 입구 쪽으로 갈수록 조금씩 다르다 */
  const lump = (a, u) =>
    0.20 * Math.sin(a * 3 + u * 4.1 + s3) +
    0.11 * Math.sin(a * 5 - u * 2.3 + s4) +
    0.07 * Math.sin(a * 9 + u * 7.7 + s5) +
    0.05 * Math.sin(u * 11.3 + s6 + a * 2);

  /* 통로 반지름 — 가운데는 일정하고, 아가리에서 살짝 벌어지는 나팔 모양 */
  const boreAt = (u, a) => bore * (1 + 0.32 * smoothstep(0.68, 1.0, Math.abs(u)))
    * (1 + 0.085 * Math.sin(a * 4 + u * 1.7 + s2) + 0.05 * Math.sin(a * 7 - u * 3.1 + s1));

  /* 바깥 반지름 — 타원체를 요철로 흔든 것 */
  const outerAt = (u, a) => {
    const base = B * section(a) * Math.sqrt(Math.max(0, 1 - u * u)) * (1 + 0.10 * u);
    return base * (1 + lump(a, u));
  };

  /* 각도마다 통로 입구의 u 를 찾는다 (바깥면이 통로에 맞닿는 곳) — 삐뚤빼뚤한 아가리 */
  const rimU = (a) => {
    let lo = 0.45, hi = 1.0;
    for (let k = 0; k < 22; k++) {
      const m = (lo + hi) * 0.5;
      if (outerAt(m, a) > boreAt(m, a)) lo = m; else hi = m;
    }
    return hi;
  };

  const pos = [];       // 정점 좌표
  const idx = [];       // 삼각형

  const stitch = (map, flip) => {
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NA; j++) {
        const j2 = (j + 1) % NA;
        const a0 = map[i][j], a1 = map[i + 1][j], a2 = map[i + 1][j2], a3 = map[i][j2];
        if (flip) idx.push(a0, a1, a2, a0, a2, a3);
        else idx.push(a0, a2, a1, a0, a3, a2);
      }
    }
  };

  /* 각도마다 아가리 위치가 달라 삼각형이 이어지도록, u 범위를 각도별로 잡는다 */
  const rims = [];
  for (let j = 0; j < NA; j++) rims.push(rimU((j / NA) * Math.PI * 2));
  /* 이웃 각도와 너무 튀지 않게 두 번 부드럽게 (삐뚤빼뚤함은 남긴다) */
  for (let pass = 0; pass < 2; pass++) {
    const src = rims.slice();
    for (let j = 0; j < NA; j++) {
      rims[j] = (src[(j + NA - 1) % NA] + src[j] * 2 + src[(j + 1) % NA]) * 0.25;
    }
  }

  const rowOf = (radiusFn, yScale) => {
    const map = [];
    for (let i = 0; i <= NS; i++) {
      const row = [];
      for (let j = 0; j < NA; j++) {
        const a = (j / NA) * Math.PI * 2;
        const u = -rims[j] + 2 * rims[j] * (i / NS);
        let r = radiusFn(u, a);
        if (i === 0 || i === NS) r = boreAt(u, a);
        row.push(pos.length / 3);
        pos.push(r * Math.cos(a), r * Math.sin(a) * yScale, u * A);
      }
      map.push(row);
    }
    return map;
  };

  const outerMap = rowOf(outerAt, ky);
  stitch(outerMap, false);          // 바깥면 — 법선이 바깥을 향하도록
  const innerMap = rowOf((u, a) => boreAt(u, a), 0.92);
  stitch(innerMap, true);           // 통로 안쪽 — 법선이 축을 향하도록

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);

  /* 이음선을 합쳐 부드러운 음영 — 각진 로우폴리 느낌이 나지 않게 */
  const merged = mergeVertices(geo, 1e-4);
  merged.computeVertexNormals();

  /* 정점 색 — 위로 갈수록 밝은 암반, 통로 안쪽은 조금 어둡게 (빛이 덜 든다) */
  const p = merged.attributes.position;
  const nrm = merged.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const col = new THREE.Color();
  const hue = o.hue === undefined ? 0.098 : o.hue;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const upk = clamp01(nrm.getY(i) * 0.5 + 0.5);
    // 통로 안쪽 면은 빛이 덜 들어 어둡다 (법선이 축을 향한다)
    const inner = nrm.getX(i) * x + nrm.getY(i) * y < 0 ? 1 : 0;
    let lig = 0.235 + 0.145 * upk + 0.035 * Math.sin(y * 0.7 + s1)
      + 0.022 * Math.sin(x * 0.9 + s4) + 0.018 * Math.sin((x + y) * 1.7 + s5);
    lig *= 1 - 0.30 * inner;
    col.setHSL(hue, 0.055 + 0.02 * inner, clamp01(lig));
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeBoundingSphere();

  /* ---- 충돌체 : 통로 벽의 두께 한가운데를 구체로 채운다 ----
     안쪽에서도 바깥에서도 벽에 부딪히면 밀려나고, 통로 한가운데는 비어 있다. */
  const colliders = [];
  const NC = 18;   // 축 방향
  const AC = 10;   // 둘레
  for (let i = 0; i < NC; i++) {
    const u = -0.94 + (1.88) * (i / (NC - 1));
    for (let j = 0; j < AC; j++) {
      const a = (j / AC) * Math.PI * 2;
      const ro = outerAt(u, a);
      const ri = boreAt(u, a);
      const th = ro - ri;
      if (th < 2.6) continue;
      const rm = ri + th * 0.5;
      colliders.push({
        x: rm * Math.cos(a),
        y: rm * Math.sin(a) * ky,
        z: u * A,
        r: Math.max(1.5, th * 0.45 - 0.3),
      });
    }
  }

  return {
    geo: merged,
    colliders,
    halfLength: A,
    radius: B,
    bore: bore,
    rim: rims,
  };
}

/** 테이블(판) 산호 — 짧은 줄기 위로 펼쳐진 얇은 판, 가장자리가 물결친다 */
export function tableCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const R = 0.72 + rnd() * 0.72;
  const stalkH = 0.32 + rnd() * 0.5;
  const stalk = new THREE.CylinderGeometry(R * 0.16, R * 0.26, stalkH, 7, 1);
  stalk.translate(0, stalkH / 2, 0);
  parts.push(paint(stalk, color));

  const plate = new THREE.CylinderGeometry(R, R * 0.84, R * 0.12, 18, 3);
  const p = plate.attributes.position;
  const wob = new Float32Array(6);
  for (let i = 0; i < 6; i++) wob[i] = rnd();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rim = Math.hypot(x, z) / R;
    // 판 가장자리를 물결치게 하고, 가운데를 살짝 들어 올린다
    const k = 1 + (Math.sin(a * 5 + wob[0] * 6.3) * 0.07 + Math.sin(a * 3 + wob[1] * 6.3) * 0.05) * rim;
    p.setXYZ(i, x * k, y + (1 - rim) * R * 0.1 + Math.sin(a * 4 + wob[2] * 6.3) * 0.03 * rim, z * k);
  }
  plate.computeVertexNormals();
  plate.translate(0, stalkH, 0);
  parts.push(paint(plate, color));
  return mergeGeometries(parts, false);
}

/** 말미잘 · 폴립 군락 — 둥근 몸체에서 뻗은 촉수가 물결에 흔들린다 */
export function anemoneCoralGeometry(color, seed) {
  const rnd = mulberry(seed);
  const parts = [];
  const R = 0.3 + rnd() * 0.22;
  const base = new THREE.SphereGeometry(R, 9, 6);
  base.scale(1, 0.62, 1);
  base.translate(0, R * 0.4, 0);
  parts.push(paint(base, color));
  const c0 = new THREE.Color(color);
  const tip = c0.clone().offsetHSL(0, 0.06, 0.14);
  const n = 9 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.35;
    const d = R * (0.45 + rnd() * 0.5);
    const h = R * (1.0 + rnd() * 1.3);
    const t = new THREE.CylinderGeometry(R * 0.05, R * 0.095, h, 4, 1);
    const p = t.attributes.position;
    const bend = 0.16 + rnd() * 0.14;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      const tt = (y + h / 2) / h;
      p.setX(k, p.getX(k) + Math.cos(a) * tt * tt * h * bend);
      p.setZ(k, p.getZ(k) + Math.sin(a) * tt * tt * h * bend);
    }
    t.computeVertexNormals();
    t.translate(Math.cos(a) * d, h / 2 + R * 0.32, Math.sin(a) * d);
    parts.push(paintGradient(t, color, tip));
  }
  return mergeGeometries(parts, false);
}

/* ---- 잎 모양 띠(blade) — 수초·해초가 함께 쓰는 기본 조각 ---- */
function ribbonBlade(h, w, segs, lean, leanZ, twist, baseC, tipC, wide) {
  const pos = [];
  const nor = [];
  const uv = [];
  const sway = [];
  const col = [];
  const idx = [];
  const c = new THREE.Color();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * h;
    const cx = lean * t * t * h * 0.3;
    const cz = leanZ * t * t * h * 0.3;
    const profile = wide
      ? 0.32 + Math.sin(Math.min(1, t * 1.12) * Math.PI * 0.94) * 0.95 - t * 0.30
      : 0.40 + Math.sin(Math.min(1, t * 1.42) * Math.PI * 0.78) * 0.85 - t * 0.45;
    const ww = Math.max(0.02, w * profile);
    const a = twist * t;
    const dx = Math.cos(a) * ww * 0.5;
    const dz = Math.sin(a) * ww * 0.5;
    pos.push(cx - dx, y, cz - dz, cx + dx, y, cz + dz);
    nor.push(0, 0, 1, 0, 0, 1);
    uv.push(0, t, 1, t);
    sway.push(t, t);
    c.copy(baseC).lerp(tipC, Math.min(1, t * 1.1));
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (i < segs) {
      const o = i * 2;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** 넓은 잎 수초 — 로제트처럼 사방으로 뻗은 잎이 부챗살로 흔들린다 */
export function leafyPlantGeometry(height, width, seed) {
  const rnd = mulberry(seed);
  const leaves = 5 + Math.floor(rnd() * 5);
  const parts = [];
  const base = new THREE.Color();
  const tipC = new THREE.Color();
  for (let b = 0; b < leaves; b++) {
    const h = height * (0.5 + rnd() * 0.62);
    const w = width * (0.9 + rnd() * 0.9);
    const dir = (b / leaves) * Math.PI * 2 + rnd() * 0.6;
    const lean = 0.5 + rnd() * 0.85;
    base.setHSL(0.235 + rnd() * 0.05, 0.52, 0.20 + rnd() * 0.07);
    tipC.setHSL(0.205 + rnd() * 0.05, 0.62, 0.36 + rnd() * 0.10);
    const g = ribbonBlade(
      h, w, 5,
      lean, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.8,
      base, tipC, true
    );
    g.rotateY(dir);
    g.translate(0, -0.05, 0);
    parts.push(g);
  }
  return mergeGeometries(parts, false);
}

/** 가는 잎 해초 군락 — 촘촘히 솟은 가는 잎이 물결 따라 살랑인다 */
export function grassTuftGeometry(height, width, seed) {
  const rnd = mulberry(seed);
  const blades = 9 + Math.floor(rnd() * 7);
  const parts = [];
  const base = new THREE.Color();
  const tipC = new THREE.Color();
  for (let b = 0; b < blades; b++) {
    const h = height * (0.45 + rnd() * 0.75);
    const w = width * (0.16 + rnd() * 0.16);
    const lean = (rnd() - 0.5) * 1.5;
    const leanZ = (rnd() - 0.5) * 1.5;
    base.setHSL(0.245 + rnd() * 0.055, 0.55, 0.19 + rnd() * 0.08);
    tipC.setHSL(0.215 + rnd() * 0.05, 0.66, 0.38 + rnd() * 0.12);
    const g = ribbonBlade(
      h, w, 4,
      lean, leanZ, (rnd() - 0.5) * 1.6,
      base, tipC, false
    );
    g.translate((rnd() - 0.5) * width * 1.6, -0.04, (rnd() - 0.5) * width * 1.6);
    parts.push(g);
  }
  return mergeGeometries(parts, false);
}

/** 해초 잎 — 여러 가닥이 모인 다시마 군락 (병합 + 정점 셰이더 흔들림) */
export function kelpGeometry(height, width, seed) {
  const rnd = mulberry(seed);
  const blades = 3 + Math.floor(rnd() * 3);
  const parts = [];
  const base = new THREE.Color();
  const tipC = new THREE.Color();
  const c = new THREE.Color();
  for (let b = 0; b < blades; b++) {
    const h = height * (0.55 + rnd() * 0.65);
    const w = width * (0.26 + rnd() * 0.32);
    const segs = 7;
    const lean = (rnd() - 0.5) * 0.9;          // 바깥으로 기우는 방향
    const leanZ = (rnd() - 0.5) * 0.9;
    const twist = (rnd() - 0.5) * 1.2;         // 잎이 비틀리는 정도
    const ox = (rnd() - 0.5) * width * 0.9;
    const oz = (rnd() - 0.5) * width * 0.9;
    const pos = [];
    const nor = [];
    const uv = [];
    const sway = [];
    const col = [];
    const idx = [];
    // 햇빛을 받아 싱그러운 초록 — 예전엔 너무 어두워 거의 검게 보였다
    base.setHSL(0.215 + rnd() * 0.05, 0.52, 0.20 + rnd() * 0.07);
    tipC.setHSL(0.19 + rnd() * 0.055, 0.60, 0.36 + rnd() * 0.11);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = t * h;
      const cx = ox + lean * t * t * h * 0.22;
      const cz = oz + leanZ * t * t * h * 0.22;
      const ww = w * (0.45 + Math.sin(Math.min(1, t * 1.45) * Math.PI * 0.75)) * (1 - t * 0.55);
      const a = twist * t;
      const dx = Math.cos(a) * ww * 0.5;
      const dz = Math.sin(a) * ww * 0.5;
      pos.push(cx - dx, y, cz - dz, cx + dx, y, cz + dz);
      nor.push(0, 0, 1, 0, 0, 1);
      uv.push(0, t, 1, t);
      sway.push(t, t);
      c.copy(base).lerp(tipC, Math.min(1, t * 1.25));
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < segs) {
        const o = i * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    parts.push(g);
  }
  return mergeGeometries(parts, false);
}
