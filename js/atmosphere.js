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

  /* 방향파 하나 — 파고(h)와 기울기(g)를 함께 쌓는다 */
  void addWave(inout float h, inout vec2 g, inout float amp, vec2 p, vec2 dir, float len, float a, float speed, float t) {
    float k = 6.2831853 / len;
    float ph = dot(p, dir) * k + t * speed;
    h += sin(ph) * a;
    g += dir * (cos(ph) * a * k);
    amp += abs(a);
  }

  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;

    vec3 view = normalize(vWorld - uCamPos);
    float dist = length(vWorld - uCamPos);
    float upness = view.y;

    /* 거리에 따라 고주파 성분을 감쇠 — 멀리서 지글거림(에일리어싱)이 생기지 않게 */
    float fMid = 1.0 - smoothstep(16.0, 70.0, dist);
    float fNear = 1.0 - smoothstep(7.0, 26.0, dist);

    /* ---- 파도 합성 : 방향이 서로 다른 7개 성분 ----
       실제 수면은 규칙적인 격자가 아니라, 서로 다른 방향의 너울이 겹쳐
       부서지며 흩어진 빛의 세포를 만든다. */
    float h = 0.0;
    vec2 g = vec2(0.0);
    float amp = 0.0;
    addWave(h, g, amp, p, normalize(vec2(0.82, 0.57)), 33.0, 0.86, 0.34, t);
    addWave(h, g, amp, p, normalize(vec2(-0.38, 0.92)), 22.0, 0.72, 0.46, t);
    addWave(h, g, amp, p, normalize(vec2(0.95, -0.31)), 12.6, 0.56 * (0.35 + 0.65 * fMid), 0.62, t);
    addWave(h, g, amp, p, normalize(vec2(-0.61, -0.79)), 8.3, 0.44 * (0.3 + 0.7 * fMid), 0.82, t);
    addWave(h, g, amp, p, normalize(vec2(0.27, 0.96)), 5.1, 0.30 * fNear, 1.15, t);
    addWave(h, g, amp, p, normalize(vec2(-0.87, 0.49)), 3.2, 0.21 * fNear, 1.55, t);
    addWave(h, g, amp, p, normalize(vec2(0.59, -0.81)), 2.1, 0.14 * fNear, 2.05, t);

    float hn = h / max(amp, 0.001);              // -1 .. 1 로 정규화한 파고
    vec2 gn = g / max(amp, 0.001);               // 무차원 기울기
    vec3 nrm = normalize(vec3(-gn.x * 1.15, 1.0, -gn.y * 1.15));

    /* 스넬의 창 — 수직에서 48.6°(cos 0.66) 안쪽만 하늘이 보이고,
       바깥은 전반사 거울이 된다. 경계는 잔물결 따라 흔들린다. */
    float edge = 0.655 + hn * 0.020 + gn.y * 0.03;
    float win = smoothstep(edge - 0.05, edge + 0.05, upness);

    /* 창 안쪽 — 잔물결에 부서진 하늘빛 (밝은 마루 + 어두운 골) */
    float crest = smoothstep(-0.35, 0.85, hn);
    vec3 inCol = uSurfaceColor * (0.34 + 0.62 * crest);
    inCol += uSurfaceColor * pow(crest, 3.0) * 0.55;          // 마루의 밝은 세포
    inCol *= 0.86 + 0.30 * smoothstep(-0.9, 0.9, hn);

    /* 창 가장자리 — 프레넬로 밝아지는 테두리 (여기가 '수면'으로 읽히는 경계) */
    float rim = smoothstep(edge - 0.13, edge - 0.01, upness) * (1.0 - smoothstep(edge + 0.01, edge + 0.09, upness));
    inCol += uSurfaceColor * rim * 0.42;

    /* 창 바깥 — 전반사: 물속이 거울에 비친 어두운 청록, 잔물결에 깨진 반사광 */
    float mir = smoothstep(-0.75, 0.75, hn);
    vec3 outCol = uDeepColor * (0.55 + 0.42 * mir);
    outCol += uSurfaceColor * pow(max(hn, 0.0), 4.0) * 0.10;   // 거울에 비친 밝은 물결
    outCol *= 0.94 + 0.12 * smoothstep(0.2, 1.0, upness);

    vec3 col = mix(outCol, inCol, win);

    /* 태양 반사를 잔물결이 깨뜨린 반짝임 — 창 안팎 모두에서 보인다 */
    vec3 reflDir = reflect(view, nrm);
    float sd = max(0.0, dot(reflDir, uSunDir));
    float glitter = pow(sd, 260.0) * (0.55 + 1.35 * win);
    col += uSunColor * glitter * (1.0 - smoothstep(20.0, 120.0, dist));

    /* 태양이 수면을 뚫고 보이는 작은 원반 + 후광 */
    float sunUp = max(0.0, dot(view, uSunDir));
    col += uSunColor * pow(sunUp, 420.0) * 1.15 * (1.0 - uDeep * 0.8);
    col += uSunColor * pow(sunUp, 26.0) * 0.055 * (1.0 - uDeep * 0.7);

    /* 거리에 따른 안개 — 멀어지면 물빛 하늘에 자연스럽게 녹아든다 */
    float fogF = 1.0 - exp(-pow(dist * uFogDensity * 0.78, 2.0));
    col = mix(col, uFogColor * 0.96, clamp(fogF, 0.0, 1.0));
    float alpha = 1.0 - smoothstep(150.0, 400.0, dist);
    gl_FragColor = vec4(col, alpha);
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

    float nearFade = smoothstep(2.6, 9.0, depth);
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
    const geo = new THREE.PlaneGeometry(1000, 1000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.surfaceUni = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uSurfaceColor: { value: new THREE.Color(0.60, 0.84, 0.90) },
      uDeepColor: { value: new THREE.Color(0.045, 0.23, 0.31) },
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
      transparent: true,
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
      uColor: { value: new THREE.Color(0.66, 0.85, 0.92) },
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
      c.setHSL(0.47 + Math.random() * 0.14, 0.12 + Math.random() * 0.2, 0.58 + Math.random() * 0.28);
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
    const N = 900;
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

    this.bioUni = this._particleUniforms({ size: 0.16, opacity: 0.0, drift: 0.45, box: 150, pulse: 0.7 });
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
    this.bioUni.uOpacity.value = bioK * 1.15;
    this.bio.visible = bioK > 0.02;
  }
}
