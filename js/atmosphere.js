/* =========================================================
   ABYSS DIVER — 물속 대기(대기광) 연출
   ---------------------------------------------------------
   · 수면(위에서 내려다보는 밝은 천장): 스넬의 창 + 잔물결 하이라이트
   · 표층 신광(빛줄기): 인스턴스 쿼드 한 번의 드로우로 22가닥
   · 부유물(마린 스노우)과 심해 생물 발광: GPU 가 카메라 주위를 감싸며
     좌표를 스스로 되감기 때문에 CPU 부담이 없다
   · 모두 절차적 셰이더 — 외부 이미지 파일을 쓰지 않는다
   ========================================================= */
import * as THREE from 'three';

const TAU = Math.PI * 2;

/* ---------------- 수면 ---------------- */
const SURFACE_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SURFACE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCamPos;
  uniform vec3 uSurfaceColor;
  uniform vec3 uDeepColor;
  uniform vec3 uFogColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uFogDensity;
  uniform float uDeep;
  varying vec3 vWorld;

  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;

    /* 잔물결 노멀 — 여러 방향의 파동을 겹친다 */
    vec2 n = vec2(0.0);
    n += vec2(cos(p.x * 0.31 + t * 0.75), cos(p.y * 0.27 - t * 0.66)) * 0.55;
    n += vec2(cos(p.x * 0.83 - p.y * 0.61 + t * 1.5), cos(p.y * 0.74 + p.x * 0.52 - t * 1.25)) * 0.32;
    n += vec2(cos(p.x * 2.1 + p.y * 1.7 + t * 2.3), cos(p.y * 1.9 - p.x * 1.5 + t * 2.0)) * 0.17;
    n += vec2(cos(p.x * 5.3 - p.y * 4.1 - t * 3.1), cos(p.y * 4.7 + p.x * 3.9 + t * 2.9)) * 0.07;

    vec3 view = normalize(vWorld - uCamPos);
    float dist = length(vWorld - uCamPos);
    float upness = view.y;

    /* 스넬의 창 — 수직에서 48.6° 안쪽만 하늘빛이 보이고, 바깥은 거울처럼 어둡다 */
    float windowEdge = 0.63 + n.x * 0.035;
    float win = smoothstep(windowEdge - 0.10, windowEdge + 0.06, upness);

    vec3 col = mix(uDeepColor, uSurfaceColor, win);

    /* 잔물결에 부서지는 빛 — 격자무늬가 아니라 자연스럽게 흩어진 반짝임 */
    float c1 = sin(p.x * 1.13 + t * 0.72 + n.x * 2.1) * sin(p.y * 1.05 - t * 0.61 + n.y * 2.3);
    float c2 = sin((p.x + p.y) * 1.71 - t * 1.05) * sin((p.x - p.y) * 1.37 + t * 0.87);
    float c3 = sin(p.x * 3.3 - p.y * 2.8 + t * 1.9) * sin(p.y * 3.0 + p.x * 2.4 - t * 1.5);
    float sparkle = pow(max(c1 * 0.55 + c2 * 0.45, 0.0), 6.5) * 1.9
                  + pow(max(c3, 0.0), 9.0) * 0.9;
    /* 큰 덩어리로 끊어 타일처럼 보이지 않게 */
    sparkle *= 0.45 + 0.55 * (sin(p.x * 0.11 + t * 0.05) * sin(p.y * 0.13 - t * 0.04) * 0.5 + 0.5);
    col += uSurfaceColor * sparkle * (0.38 + win * 0.75);

    /* 태양 반사 — 잔물결 노멀이 태양 쪽을 향할 때만 강하게 */
    vec3 nrm = normalize(vec3(n.x * 0.55, 1.0, n.y * 0.55));
    float sunSpec = pow(max(dot(nrm, uSunDir), 0.0), 26.0);
    col += uSunColor * sunSpec * 1.5 * (1.0 - uDeep * 0.8);

    /* 태양이 비치는 곳 — 아주 밝은 원반과 그 주변 후광 */
    float sd = max(0.0, dot(view, uSunDir));
    col += uSunColor * pow(sd, 160.0) * 2.2 * (1.0 - uDeep * 0.85);
    col += uSunColor * pow(sd, 8.0) * 0.16 * (1.0 - uDeep * 0.7);

    /* 거리에 따른 안개 — 수면도 물빛에 잠긴다 */
    float fogF = 1.0 - exp(-pow(dist * uFogDensity * 0.9, 2.0));
    col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ---------------- 빛줄기(신광) ---------------- */
const SHAFT_VERT = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec2 aSize;
  attribute float aSeed;
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  varying float vDist;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vec3 center = aOffset;
    vec3 toCam = cameraPosition - center;
    toCam.y = 0.0;
    float len = length(toCam);
    toCam = len > 0.001 ? toCam / len : vec3(0.0, 0.0, 1.0);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    vec3 wp = center + right * (position.x * aSize.x) + vec3(0.0, 1.0, 0.0) * (position.y * aSize.y);
    vDist = length(wp - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const SHAFT_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vSeed;
  varying float vDist;
  void main() {
    float edgeX = pow(sin(clamp(vUv.x, 0.0, 1.0) * 3.14159), 1.7);
    float edgeY = smoothstep(0.0, 0.62, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
    float streak = 0.52
      + 0.30 * sin(vUv.y * 7.0 + uTime * 0.55 + vSeed * 6.28)
      + 0.22 * sin(vUv.x * 11.0 + vSeed * 3.7 + uTime * 0.37);
    /* 셔머 — 물결 따라 빛줄기가 흔들린다 */
    float shimmer = 0.75 + 0.25 * sin(vUv.y * 2.0 - uTime * 0.8 + vSeed * 5.0);
    float nearFade = smoothstep(3.0, 16.0, vDist);
    float a = edgeX * edgeY * max(streak, 0.0) * shimmer * nearFade * uIntensity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/* ---------------- 부유물·발광 입자 ---------------- */
const PARTICLE_VERT = /* glsl */ `
  attribute vec3 aPos;
  attribute float aSeed;
  attribute vec3 aTint;
  uniform vec3 uCam;
  uniform vec3 uBox;
  uniform float uTime;
  uniform float uSize;
  uniform float uTanHalfFov;
  uniform float uViewHeight;
  uniform float uOpacity;
  uniform float uDrift;
  uniform vec3 uBeamPos;
  uniform vec3 uBeamDir;
  uniform float uBeamCos;
  uniform float uBeamRange;
  uniform float uBeamI;
  uniform float uPulse;
  varying float vBright;
  varying vec3 vTint;

  void main() {
    vec3 p = aPos * uBox;
    /* 각 입자마다 느린 표류 + 아래로 가라앉기 */
    float sp = 0.35 + aSeed * 0.65;
    p.y -= uTime * (0.55 + aSeed * 0.7) * uDrift;
    p.x += sin(uTime * 0.32 + aSeed * 31.0) * 2.4;
    p.z += cos(uTime * 0.27 + aSeed * 17.0) * 2.4;

    /* 카메라(플레이어) 주위로 좌표를 되감아 무한히 이어지게 한다 */
    vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 world = uCam + rel;

    vec4 mv = viewMatrix * vec4(world, 1.0);
    float depth = max(0.15, -mv.z);

    /* 크기 어테뉴에이션 — 가까운 입자는 크게, 먼 입자는 작게 */
    gl_PointSize = clamp(uSize * (0.55 + aSeed) * uViewHeight / (depth * uTanHalfFov * 2.0), 0.8, 46.0);

    /* 탐조등 안에 들어온 입자는 밝게 빛난다 */
    vec3 toP = world - uBeamPos;
    float along = dot(toP, uBeamDir);
    float beamK = 0.0;
    if (along > 0.0 && uBeamI > 0.01) {
      float cosA = dot(normalize(toP), uBeamDir);
      beamK = smoothstep(uBeamCos, min(1.0, uBeamCos + 0.10), cosA)
            * (1.0 - smoothstep(uBeamRange * 0.55, uBeamRange, along)) * uBeamI;
    }

    float nearFade = smoothstep(0.25, 2.2, depth);
    float farFade = 1.0 - smoothstep(uBox.x * 0.30, uBox.x * 0.52, length(rel));
    float twinkle = 0.62 + 0.38 * sin(uTime * 1.7 * sp + aSeed * 44.0);
    vBright = uOpacity * nearFade * farFade * mix(0.32 + 0.55 * twinkle, 1.9, clamp(beamK, 0.0, 1.0));
    if (uPulse > 0.01) {
      vBright *= 1.0 + uPulse * (0.6 + 0.9 * sin(uTime * 1.9 + aSeed * 61.0));
    }
    vTint = aTint;
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  varying float vBright;
  varying vec3 vTint;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = smoothstep(1.0, 0.05, d);
    a *= a;
    /* 살짝 번지는 후광 */
    a += smoothstep(1.0, 0.25, d) * 0.35;
    gl_FragColor = vec4(vTint * a * vBright, a * vBright);
  }
`;

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.quality = 1;
    this._buildSurface();
    this._buildShafts();
    this._buildSnow();
    this._buildBiolume();
    this.beam = {
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      cos: 0.75,
      range: 80,
      intensity: 0,
    };
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /* ---------- 수면 ---------- */
  _buildSurface() {
    const geo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.surfaceUni = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uSurfaceColor: { value: new THREE.Color(0.72, 1.05, 1.12) },
      uDeepColor: { value: new THREE.Color(0.055, 0.30, 0.42) },
      uFogColor: { value: new THREE.Color(0x1f9fdc) },
      uSunDir: { value: new THREE.Vector3(-0.31, 0.93, 0.23).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.98, 0.88) },
      uFogDensity: { value: 0.004 },
      uDeep: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.surfaceUni,
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      side: THREE.DoubleSide,
      depthWrite: false,
      transparent: false,
      fog: false,
    });
    this.surface = new THREE.Mesh(geo, mat);
    this.surface.frustumCulled = false;
    this.surface.renderOrder = -8;
    this.scene.add(this.surface);
  }

  /* ---------- 빛줄기 ---------- */
  _buildShafts() {
    const COUNT = 22;
    this.shaftCount = COUNT;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.shaftData = [];
    const off = new Float32Array(COUNT * 3);
    const size = new Float32Array(COUNT * 2);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const w = 26 + Math.random() * 54;
      const h = 190 + Math.random() * 170;
      this.shaftData.push({
        x: (Math.random() - 0.5) * 380,
        y: 34 - h * 0.44 + Math.random() * 26,
        z: (Math.random() - 0.5) * 380,
        w,
        h,
        seed: Math.random(),
        phase: Math.random() * TAU,
      });
      size[i * 2] = w;
      size[i * 2 + 1] = h;
      seed[i] = Math.random();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.instanceCount = COUNT;

    this.shaftUni = {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uColor: { value: new THREE.Color(0.72, 0.95, 1.0) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.shaftUni,
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.shafts = new THREE.Mesh(geo, mat);
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 4;
    this.scene.add(this.shafts);
    this._shaftOff = geo.attributes.aOffset;
    this._syncShafts();
  }

  _syncShafts() {
    const a = this._shaftOff.array;
    for (let i = 0; i < this.shaftCount; i++) {
      const s = this.shaftData[i];
      a[i * 3] = s.x;
      a[i * 3 + 1] = s.y;
      a[i * 3 + 2] = s.z;
    }
    this._shaftOff.needsUpdate = true;
  }

  /* ---------- 마린 스노우 ---------- */
  _buildSnow() {
    const N = 1400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const tint = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      pos[i * 3] = Math.random();
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = Math.random();
      seed[i] = Math.random();
      c.setHSL(0.47 + Math.random() * 0.14, 0.35 + Math.random() * 0.4, 0.62 + Math.random() * 0.3);
      tint[i * 3] = c.r;
      tint[i * 3 + 1] = c.g;
      tint[i * 3 + 2] = c.b;
    }
    geo.setAttribute('aPos', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.snowUni = this._particleUniforms({ size: 0.085, opacity: 0.55, drift: 1.0, box: 120, pulse: 0 });
    this.snow = new THREE.Points(geo, this._particleMaterial(this.snowUni));
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 6;
    this.scene.add(this.snow);
    this.snowCount = N;
  }

  /* ---------- 심해 생물 발광 ---------- */
  _buildBiolume() {
    const N = 420;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const tint = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      pos[i * 3] = Math.random();
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = Math.random();
      seed[i] = Math.random();
      c.setHSL(0.46 + Math.random() * 0.18, 0.85, 0.55 + Math.random() * 0.25);
      tint[i * 3] = c.r;
      tint[i * 3 + 1] = c.g;
      tint[i * 3 + 2] = c.b;
    }
    geo.setAttribute('aPos', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.bioUni = this._particleUniforms({ size: 0.30, opacity: 0.0, drift: 0.45, box: 180, pulse: 0.7 });
    this.bio = new THREE.Points(geo, this._particleMaterial(this.bioUni));
    this.bio.frustumCulled = false;
    this.bio.renderOrder = 7;
    this.scene.add(this.bio);
    this.bioCount = N;
  }

  _particleUniforms(o) {
    return {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(o.box, o.box * 0.6, o.box) },
      uTime: { value: 0 },
      uSize: { value: o.size },
      uTanHalfFov: { value: 1 },
      uViewHeight: { value: 800 },
      uOpacity: { value: o.opacity },
      uDrift: { value: o.drift },
      uBeamPos: { value: new THREE.Vector3() },
      uBeamDir: { value: new THREE.Vector3(0, 0, -1) },
      uBeamCos: { value: 0.8 },
      uBeamRange: { value: 80 },
      uBeamI: { value: 0 },
      uPulse: { value: o.pulse },
    };
  }

  _particleMaterial(uni) {
    return new THREE.ShaderMaterial({
      uniforms: uni,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
  }

  /* ---------- 프레임 갱신 ---------- */
  setBeam(pos, dir, cos, range, intensity) {
    const b = this.beam;
    b.pos.copy(pos);
    b.dir.copy(dir).normalize();
    b.cos = cos;
    b.range = range;
    b.intensity = intensity;
  }

  /** 화질 프리셋: 입자 수를 줄인다 (그리기는 그대로, instanceCount 만) */
  setQuality(preset, fov, viewHeight) {
    const k = preset.particles === undefined ? 1 : preset.particles;
    if (this.snow) {
      this.snow.geometry.setDrawRange(0, Math.max(80, Math.round(this.snowCount * k)));
    }
    if (this.bio) {
      this.bio.geometry.setDrawRange(0, Math.max(60, Math.round(this.bioCount * k)));
    }
    if (fov) this._fov = fov;
    if (viewHeight) this._viewH = viewHeight;
  }

  update(dt, playerPos, camera, depth, fogColor, fogDensity, sunDir, sunI) {
    this.time += dt;
    const t = this.time;

    /* 수면은 플레이어를 따라다니고 카메라 위치로 시선 계산 */
    this.surface.position.set(playerPos.x, 34, playerPos.z);
    const su = this.surfaceUni;
    su.uTime.value = t;
    su.uCamPos.value.copy(camera.position);
    su.uFogColor.value.copy(fogColor);
    su.uFogDensity.value = fogDensity;
    su.uDeep.value = Math.min(1, depth / 320);
    if (sunDir) su.uSunDir.value.copy(sunDir).normalize();

    /* 빛줄기 — 표층에서만. 수심 320m 아래로는 사라진다 */
    const shaftK = Math.max(0, 1 - depth / 320);
    this.shaftUni.uTime.value = t;
    this.shaftUni.uIntensity.value = 0.42 * shaftK * shaftK;
    this.shafts.visible = shaftK > 0.02;
    if (this.shafts.visible) {
      for (let i = 0; i < this.shaftCount; i++) {
        const s = this.shaftData[i];
        const dx = s.x - playerPos.x;
        const dz = s.z - playerPos.z;
        if (dx * dx + dz * dz > 300 * 300) {
          s.x = playerPos.x + (Math.random() - 0.5) * 380;
          s.z = playerPos.z + (Math.random() - 0.5) * 380;
          s.y = 34 - s.h * 0.44 + Math.random() * 26;
        }
      }
      this._syncShafts();
    }

    /* 부유물·발광 입자 — 카메라를 중심으로 감싼다 */
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const viewH = this._viewH || Math.max(360, camera.userData.viewHeight || 900);
    [this.snowUni, this.bioUni].forEach((u) => {
      u.uTime.value = t;
      u.uCam.value.copy(camera.position);
      u.uTanHalfFov.value = tan;
      u.uViewHeight.value = viewH;
      u.uBeamPos.value.copy(this.beam.pos);
      u.uBeamDir.value.copy(this.beam.dir);
      u.uBeamCos.value = this.beam.cos;
      u.uBeamRange.value = this.beam.range;
      u.uBeamI.value = this.beam.intensity;
    });

    /* 마린 스노우는 수심이 깊을수록 희미하고 차갑게 */
    this.snowUni.uOpacity.value = 0.42 - 0.16 * Math.min(1, depth / 900);
    /* 생물 발광은 350m 아래부터 서서히 나타난다 */
    const bioK = Math.max(0, Math.min(1, (depth - 300) / 500));
    this.bioUni.uOpacity.value = bioK * 0.85;
    this.bio.visible = bioK > 0.02;
  }
}
