/* =========================================================
   ABYSS DIVER — 바다의 흐름(해류)
   ---------------------------------------------------------
   · 늘 흐르는 느린 해류 + 가끔 몰아치는 '강한 해류'(해류 띠 · 돌발 해류)
   · 흐름장은 (x, z, 시간) 만으로 정해지는 해석적 함수 — JS(물리)와
     셰이더(유선)가 같은 식을 써서 눈에 보이는 흐름과 실제 밀림이 일치한다
   · 유선(flow streak)은 카메라 주위로 좌표를 되감아 그리는 단일
     LineSegments 한 번의 드로우콜 — CPU 갱신 없음
   ========================================================= */
import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/* ---------------- 흐름장 (JS) ----------------
   큰 소용돌이 두어 개가 겹친 느린 흐름. 위치마다 방향이 조금씩 달라
   넓은 바다를 지나며 해류의 방향이 서서히 바뀐다. */
export function flowAngle(x, z, t) {
  return (
    0.9 * Math.sin(x * 0.0040 + t * 0.050) +
    1.1 * Math.cos(z * 0.0035 - t * 0.040) +
    2.2 * Math.sin((x - z) * 0.0016 + t * 0.030)
  );
}

/** 느린 기본 해류의 세기(유닛/초) */
export function flowSpeed(x, z, t) {
  return 4.6 + 2.4 * Math.sin(x * 0.0060 + t * 0.070) * Math.cos(z * 0.0050 - t * 0.050);
}

/** 해류 띠 — 폭이 좁은 빠른 물줄기가 바다를 가로지른다 (0=밖, 1=한가운데) */
export function jetBand(x, z, t) {
  const a = 0.5 + 0.5 * Math.sin(x * 0.0280 - z * 0.0120 + t * 0.55);
  const b = 0.5 + 0.5 * Math.sin(-x * 0.0080 + z * 0.0340 - t * 0.42);
  return Math.max(smoothstep(0.62, 0.96, a), smoothstep(0.66, 0.98, b) * 0.85);
}

/** 그 자리의 해류 벡터 (수평, 유닛/초) — burst 는 돌발 해류 배율(0~1) */
export function currentAt(x, z, t, burst, out) {
  const ang = flowAngle(x, z, t);
  const jet = jetBand(x, z, t);
  // 강한 띠 안에서는 흐름 방향이 띠를 따라 조금 더 곧게 뻗는다
  const speed = Math.min(30, (flowSpeed(x, z, t) + 18.5 * jet) * (1 + 0.95 * (burst || 0)));
  const dx = Math.cos(ang) * speed;
  const dz = Math.sin(ang) * speed;
  const o = out || new THREE.Vector3();
  o.set(dx, 0, dz);
  return o;
}

/* ---------------- 유선 셰이더 ---------------- */
const STREAK_VERT = /* glsl */ `
  attribute vec3 aPos;
  attribute float aSeed;
  attribute float aEnd;
  uniform vec3 uCam;
  uniform float uBox;
  uniform float uTime;
  uniform float uStrength;
  uniform float uViewHeight;
  uniform float uTanHalfFov;
  varying float vA;
  varying float vBright;

  /* JS 의 flowAngle / flowSpeed 와 같은 식 — 보이는 흐름 = 실제 흐름 */
  vec2 flowDir(vec2 p, float t) {
    float a = 0.9 * sin(p.x * 0.0040 + t * 0.050)
            + 1.1 * cos(p.y * 0.0035 - t * 0.040)
            + 2.2 * sin((p.x - p.y) * 0.0016 + t * 0.030);
    return vec2(cos(a), sin(a));
  }

  void main() {
    float t = uTime;
    vec3 p = aPos * uBox;
    vec2 f = flowDir(p.xz, t);
    float spd = 4.6 + 2.4 * sin(p.x * 0.0060 + t * 0.070) * cos(p.y * 0.0050 - t * 0.050);

    /* 시간에 따라 흐름 방향으로 밀려난다 — 흐르는 물의 결 */
    p.xz += f * (t * (spd * 0.30 + 6.0 * uStrength) + aSeed * 53.0);

    /* 카메라 주위로 되감아 무한히 이어지게 (조각이 상자 경계에서 끊기지 않도록
       되감기는 기준점만 옮기고, 조각 길이는 그 뒤에 더한다) */
    vec3 rel = mod(p - uCam + vec3(uBox * 0.5), vec3(uBox)) - vec3(uBox * 0.5);
    vec3 world = uCam + rel;

    /* 조각 길이 — 해류가 강할수록 길고 밝게 흐른다 */
    float len = (1.6 + 7.0 * uStrength) * (0.45 + aSeed);
    world += vec3(f.x, 0.0, f.y) * mix(-0.5, 0.5, aEnd) * len;

    vec4 mv = viewMatrix * vec4(world, 1.0);
    float depth = max(0.15, -mv.z);
    vec3 toP = world - uCam;
    float nearFade = smoothstep(2.2, 8.0, depth);
    float farFade = 1.0 - smoothstep(uBox * 0.26, uBox * 0.46, length(rel));
    vA = nearFade * farFade;
    vBright = 0.30 + 0.70 * uStrength;
    vA *= 0.35 + 0.65 * (0.5 + 0.5 * sin(t * 2.1 + aSeed * 37.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const STREAK_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  varying float vBright;
  void main() {
    float a = vA * uOpacity * vBright;
    if (a <= 0.001) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Currents {
  constructor(scene, opts) {
    const o = opts || {};
    this.scene = scene;
    this.time = 0;
    this.burst = 0;            // 0 = 잔잔, 1 = 돌발 강한 해류
    this.burstT = 0;
    this.eventT = 12 + Math.random() * 14;
    this.onBurst = null;       // (강도) => void — 게임 쪽에서 안내·소리
    this.speed = 0;
    this.strength = 0;
    this.angle = 0;
    this.jet = 0;
    this._vec = new THREE.Vector3();
    this.count = o.count || 520;
    this.box = 170;
    this.quality = 1;
    this._build();
  }

  _build() {
    const N = this.count;
    const pos = new Float32Array(N * 2 * 3);
    const seed = new Float32Array(N * 2);
    const end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      const s = Math.random();
      for (let k = 0; k < 2; k++) {
        const v = i * 2 + k;
        pos[v * 3] = x;
        pos[v * 3 + 1] = y;
        pos[v * 3 + 2] = z;
        seed[v] = s;
        end[v] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPos', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));

    this.uni = {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: this.box },
      uTime: { value: 0 },
      uStrength: { value: 0 },
      uViewHeight: { value: 800 },
      uTanHalfFov: { value: 1 },
      uColor: { value: new THREE.Color(0xbdf6ff) },
      uOpacity: { value: 0.5 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uni,
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    this.scene.add(this.lines);
  }

  setQuality(k) {
    this.quality = k === undefined ? 1 : k;
    const n = Math.max(90, Math.round(this.count * this.quality));
    this.lines.geometry.setDrawRange(0, n * 2);
  }

  reset() {
    this.time = 0;
    this.burst = 0;
    this.burstT = 0;
    this.eventT = 12 + Math.random() * 14;
  }

  /** 돌발 해류 진행 — 잠잠하다가 가끔 몰아친다 */
  _tickEvent(dt) {
    if (this.burstT > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) this.eventT = 22 + Math.random() * 26;
    } else {
      this.eventT -= dt;
      if (this.eventT <= 0) {
        this.burstT = 8 + Math.random() * 6;
        if (this.onBurst) this.onBurst(1);
      }
    }
    const want = this.burstT > 0 ? 1 : 0;
    const k = want > this.burst ? 0.55 : 0.32;      // 빠르게 몰아치고 천천히 잦아든다
    this.burst += (want - this.burst) * (1 - Math.exp(-k * dt));
  }

  /**
   * 프레임 갱신 — 흐름 상태를 계산하고 유선을 그린다.
   * @returns {{speed:number, strength:number, angle:number, jet:number, burst:number}}
   */
  update(dt, playerPos, camera) {
    this.time += dt;
    this._tickEvent(dt);

    const x = playerPos.x;
    const z = playerPos.z;
    const t = this.time;
    this.angle = flowAngle(x, z, t);
    this.jet = jetBand(x, z, t);
    this.speed = Math.min(30, (flowSpeed(x, z, t) + 18.5 * this.jet) * (1 + 0.95 * this.burst));
    this.strength = clamp01(this.speed / 26);

    const u = this.uni;
    u.uTime.value = t;
    u.uStrength.value = this.strength;
    u.uOpacity.value = 0.30 + 0.55 * this.strength;
    if (camera) {
      u.uCam.value.copy(camera.position);
      const tan = Math.tan((camera.fov * Math.PI) / 360);
      u.uTanHalfFov.value = tan;
      u.uViewHeight.value = Math.max(360, camera.userData.viewHeight || 900);
    }
    return this.state();
  }

  /** 지금 이 자리의 해류 벡터 (유닛/초) */
  vector(out) {
    const o = out || this._vec;
    const s = this.speed;
    o.set(Math.cos(this.angle) * s, 0, Math.sin(this.angle) * s);
    return o;
  }

  state() {
    return {
      speed: this.speed,
      strength: this.strength,
      angle: this.angle,
      jet: this.jet,
      burst: this.burst,
    };
  }

  /** HUD 표시용 — 방향(8방위)과 세기 등급 */
  hud() {
    const deg = ((this.angle * 180) / Math.PI);
    const dir = Math.atan2(Math.cos(this.angle), -Math.sin(this.angle)); // 월드 방위(북=0)
    let degN = (dir * 180) / Math.PI;
    degN = ((degN % 360) + 360) % 360;
    const names = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    const k = this.strength;
    const grade = k >= 0.72 ? '매우 강함' : k >= 0.5 ? '강함' : k >= 0.26 ? '보통' : '약함';
    return {
      angle: this.angle,
      deg: degN,
      dirName: names[Math.round(degN / 45) % 8],
      pct: Math.round(k * 100),
      grade,
      strong: k >= 0.5,
      burst: this.burst > 0.35,
      speed: this.speed,
    };
  }
}
