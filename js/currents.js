/* =========================================================
   ABYSS DIVER — 바다의 흐름(해류)
   ---------------------------------------------------------
   · 늘 흐르는 느린 해류 + 가끔 몰아치는 '강한 해류'(해류 띠 · 돌발 해류)
   · 흐름장은 (x, z, 시간) 만으로 정해지는 해석적 함수 — JS(물리)와
     셰이더(유선)가 같은 식을 써서 눈에 보이는 흐름과 실제 밀림이 일치한다
   · 방향·세기가 바뀌는 속도는 아주 느리다(1분에 몇 도 수준).
     돌발 해류도 1분~2분에 한 번, 10~14초만 몰아친다.
   · 세기는 잠수정 전진(32 유닛/초)보다 훨씬 약해서, 최대 해류를
     정면으로 거슬러도 전진이 막히지 않는다
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

/* ---------------- 해류 세기 상수 ----------------
   잠수정: 전진 32 유닛/초 · 후진 18 · 선회 1.65 rad/s
   해류는 최대 15 유닛/초까지만 — 역해류에서도 60% 이상 전진한다 */
const CURRENT = {
  base: 3.0,        // 기본 해류 세기
  baseVar: 1.4,     // 기본 세기의 오르내림
  jetBoost: 7.0,    // 해류 띠가 더하는 세기
  burstGain: 0.55,  // 돌발 해류 배율
  speedCap: 15,     // 최대 해류 속도(유닛/초)
  strengthRef: 16,  // HUD 세기 100% 기준
};

/* 돌발 해류 주기 — 아주 가끔, 짧게 */
const BURST_WAIT = { min: 65, max: 110 };
const BURST_LEN = { min: 10, max: 14 };
const BURST_FIRST = { min: 40, max: 75 };   // 첫 돌발은 조금 일찍

/* ---------------- 흐름장 (JS) ----------------
   큰 소용돌이 두어 개가 겹친 느린 흐름. 위치마다 방향이 조금씩 달라
   넓은 바다를 지나며 해류의 방향이 서서히 바뀐다. 시간 계수는 아주 작아서
   같은 자리에 머물러도 방향이 급히 돌아가지 않는다(1분에 2~3도). */
export function flowAngle(x, z, t) {
  return (
    0.9 * Math.sin(x * 0.0040 + t * 0.012) +
    1.1 * Math.cos(z * 0.0035 - t * 0.010) +
    2.2 * Math.sin((x - z) * 0.0016 + t * 0.0075)
  );
}

/** 느린 기본 해류의 세기(유닛/초) */
export function flowSpeed(x, z, t) {
  return CURRENT.base +
    CURRENT.baseVar * Math.sin(x * 0.0060 + t * 0.018) * Math.cos(z * 0.0050 - t * 0.013);
}

/** 해류 띠 — 폭이 좁은 빠른 물줄기가 바다를 가로지른다 (0=밖, 1=한가운데)
    띠가 지나가는 속도도 느리다 — 한 자리에서 몇 초 만에 스쳐 지나가지 않는다 */
export function jetBand(x, z, t) {
  const a = 0.5 + 0.5 * Math.sin(x * 0.0280 - z * 0.0120 + t * 0.095);
  const b = 0.5 + 0.5 * Math.sin(-x * 0.0080 + z * 0.0340 - t * 0.072);
  return Math.max(smoothstep(0.70, 0.99, a), smoothstep(0.74, 1.0, b) * 0.88);
}

/** 그 자리의 해류 세기(유닛/초) — burst 는 돌발 해류 배율(0~1) */
export function currentSpeed(x, z, t, burst) {
  const jet = jetBand(x, z, t);
  return Math.min(
    CURRENT.speedCap,
    (flowSpeed(x, z, t) + CURRENT.jetBoost * jet) * (1 + CURRENT.burstGain * (burst || 0))
  );
}

/** 그 자리의 해류 벡터 (수평, 유닛/초) — burst 는 돌발 해류 배율(0~1) */
export function currentAt(x, z, t, burst, out) {
  const ang = flowAngle(x, z, t);
  const speed = currentSpeed(x, z, t, burst);
  const o = out || new THREE.Vector3();
  o.set(Math.cos(ang) * speed, 0, Math.sin(ang) * speed);
  return o;
}

/**
 * 생물 체급 → 해류에 밀리는 비율.
 * 몸길이(월드 유닛)가 길수록 해류의 영향을 덜 받는다.
 *   소형 어류(≈1 유닛) 0.8~1.0 · 중형(3~6 유닛) 0.35~0.6
 *   대형·상어·고래(10 유닛 이상) 0.1~0.25
 */
export function currentWeightForLength(length) {
  const L = Math.max(0.4, length || 1);
  return Math.min(1, Math.max(0.1, Math.pow(1 / L, 0.6)));
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
    float a = 0.9 * sin(p.x * 0.0040 + t * 0.012)
            + 1.1 * cos(p.y * 0.0035 - t * 0.010)
            + 2.2 * sin((p.x - p.y) * 0.0016 + t * 0.0075);
    return vec2(cos(a), sin(a));
  }

  void main() {
    float t = uTime;
    vec3 p = aPos * uBox;
    vec2 f = flowDir(p.xz, t);
    float spd = 3.0 + 1.4 * sin(p.x * 0.0060 + t * 0.018) * cos(p.y * 0.0050 - t * 0.013);

    /* 시간에 따라 흐름 방향으로 밀려난다 — 흐르는 물의 결 */
    p.xz += f * (t * (spd * 0.30 + 6.0 * uStrength) + aSeed * 53.0);

    /* 카메라 주위로 되감아 무한히 이어지게 (조각이 상자 경계에서 끊기지 않도록
       되감기는 기준점만 옮기고, 조각 길이는 그 뒤에 더한다) */
    vec3 rel = mod(p - uCam + vec3(uBox * 0.5), vec3(uBox)) - vec3(uBox * 0.5);
    vec3 world = uCam + rel;

    /* 조각 길이 — 해류가 강할수록 길고 밝게 흐른다 */
    float len = (1.0 + 4.4 * uStrength) * (0.45 + aSeed);
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

const randRange = (r) => r.min + Math.random() * (r.max - r.min);

export class Currents {
  constructor(scene, opts) {
    const o = opts || {};
    this.scene = scene;
    this.time = 0;
    this.burst = 0;            // 0 = 잔잔, 1 = 돌발 강한 해류
    this.burstT = 0;
    this.eventT = randRange(BURST_FIRST);
    this.onBurst = null;       // (강도) => void — 게임 쪽에서 안내·소리
    this.speed = 0;
    this.strength = 0;
    this.angle = 0;
    this.jet = 0;
    this.bursts = 0;           // 지금까지 몰아친 돌발 해류 횟수(검증용)
    this.burstAt = [];         // 각 돌발 해류가 시작된 시각(검증용)
    this._vec = new THREE.Vector3();
    this._sample = new THREE.Vector3();
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
      uColor: { value: new THREE.Color(0x9fe8ff) },
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
    this.eventT = randRange(BURST_FIRST);
    this.bursts = 0;
    this.burstAt.length = 0;
  }

  /** 돌발 해류 진행 — 잠잠하다가 아주 가끔 몰아친다 */
  _tickEvent(dt) {
    if (this.burstT > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) this.eventT = randRange(BURST_WAIT);
    } else {
      this.eventT -= dt;
      if (this.eventT <= 0) {
        this.burstT = randRange(BURST_LEN);
        this.bursts++;
        this.burstAt.push(this.time);
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
    this.speed = currentSpeed(x, z, t, this.burst);
    this.strength = clamp01(this.speed / CURRENT.strengthRef);

    const u = this.uni;
    u.uTime.value = t;
    u.uStrength.value = this.strength;
    u.uOpacity.value = 0.20 + 0.42 * this.strength;
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

  /** 임의의 자리 (x, z) 의 해류 벡터 — 물고기·해양 생물도 같은 흐름을 탄다 */
  at(x, z, out) {
    const o = out || this._sample;
    const s = currentSpeed(x, z, this.time, this.burst);
    const a = flowAngle(x, z, this.time);
    o.set(Math.cos(a) * s, 0, Math.sin(a) * s);
    return o;
  }

  state() {
    return {
      speed: this.speed,
      strength: this.strength,
      angle: this.angle,
      jet: this.jet,
      burst: this.burst,
      eventT: this.eventT,
      burstT: this.burstT,
      bursts: this.bursts,
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
    const grade = k >= 0.78 ? '매우 강함' : k >= 0.52 ? '강함' : k >= 0.28 ? '보통' : '약함';
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
