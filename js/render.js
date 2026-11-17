/* =========================================================
   ABYSS DIVER — 수중 렌더 파이프라인
   ---------------------------------------------------------
   · 장면을 HDR(하프플로트) 렌더타깃에 그린 뒤 후처리로 합성한다
   · 블룸(밝은 곳 번짐) → 태양 빛줄기(god rays) → 색보정·비네트·필름 그레인
   · 아이폰 사파리를 위해 전부 저해상도 1~2패스로 처리하고,
     화질 프리셋(고/중/저)과 자동 하향으로 프레임을 지킨다
   ========================================================= */
import * as THREE from 'three';

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/* 색공간·톤매핑은 합성 패스에서 한 번만 한다 (ACES 근사) */
const ACES = /* glsl */ `
vec3 abyssAces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
`;

/* 화질 프리셋 — 픽셀비율·블룸·빛줄기·색수차·입자 밀도 */
export const QUALITY = {
  high: {
    name: '고화질', pixelRatio: 2.0, bloom: true, bloomScale: 0.5, rays: true, raySteps: 12,
    chromatic: true, grain: 0.012, particles: 1.0, wobble: 1.0,
  },
  medium: {
    name: '중간', pixelRatio: 1.5, bloom: true, bloomScale: 0.34, rays: true, raySteps: 8,
    chromatic: false, grain: 0.018, particles: 0.7, wobble: 1.0,
  },
  low: {
    name: '저사양', pixelRatio: 1.0, bloom: false, bloomScale: 0.25, rays: false, raySteps: 6,
    chromatic: false, grain: 0.024, particles: 0.45, wobble: 0.6,
  },
};

export class RenderPipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.ok = true;
    this.qualityName = 'high';
    this.preset = QUALITY.high;

    this.size = new THREE.Vector2(1, 1);
    this.dpr = 1;

    this.uni = {
      tScene: { value: null },
      tBloom: { value: null },
      tRays: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uExposure: { value: 1.02 },
      uBloom: { value: 0.62 },
      uBloomTint: { value: new THREE.Color(0.62, 0.9, 1.0) },
      uRayI: { value: 0.0 },
      uSunUV: { value: new THREE.Vector2(0.5, 0.9) },
      uSat: { value: 1.12 },
      uVig: { value: 0.42 },
      uGrain: { value: 0.012 },
      uWobble: { value: 1.0 },
      uCA: { value: 1.0 },
      uTopGlow: { value: 0.0 },
      uSurfaceTint: { value: new THREE.Color(0.45, 0.95, 1.0) },
      uShadowTint: { value: new THREE.Color(0.86, 0.97, 1.12) },
      uHighTint: { value: new THREE.Color(1.04, 1.0, 0.95) },
      uDepth: { value: 0 },
      uFade: { value: 1 },
    };

    try {
      this._init();
    } catch (e) {
      this.ok = false;
      this.error = e;
      if (typeof console !== 'undefined') console.warn('post-processing unavailable', e);
      // 폴백: 후처리 없이 직접 그린다 (톤매핑은 렌더러가 되돌려 받는다)
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.92;
    }
  }

  _target(w, h, o = {}) {
    return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      type: THREE.HalfFloatType,
      depthBuffer: !!o.depth,
      stencilBuffer: false,
      generateMipmaps: false,
      samples: o.samples || 0,
    });
  }

  _init() {
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    this.sceneRT = this._target(2, 2, { depth: true, samples: isIOS ? 0 : 2 });
    this.bloomA = this._target(2, 2);
    this.bloomB = this._target(2, 2);
    this.rayA = this._target(2, 2);
    this.rayB = this._target(2, 2);

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quadMesh = new THREE.Mesh(this.quadGeo, null);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: 0.72 },
        uKnee: { value: 0.35 },
        uTexel: { value: new THREE.Vector2(0.001, 0.001) },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uThreshold, uKnee;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
          c += texture2D(tDiffuse, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
          c += texture2D(tDiffuse, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
          c += texture2D(tDiffuse, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
          c *= 0.25;
          float l = max(c.r, max(c.g, c.b));
          float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
          soft = soft * soft / (4.0 * uKnee + 1e-4);
          float contrib = max(soft, l - uThreshold) / max(l, 1e-4);
          gl_FragColor = vec4(c * contrib, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uDir;
        varying vec2 vUv;
        void main() {
          vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227;
          s += (texture2D(tDiffuse, vUv + uDir * 1.385).rgb + texture2D(tDiffuse, vUv - uDir * 1.385).rgb) * 0.316;
          s += (texture2D(tDiffuse, vUv + uDir * 3.231).rgb + texture2D(tDiffuse, vUv - uDir * 3.231).rgb) * 0.070;
          gl_FragColor = vec4(s, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.rayMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uSun: { value: new THREE.Vector2(0.5, 0.85) },
        uLen: { value: 0.62 },
        uDecay: { value: 0.945 },
        uSteps: { value: 12 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uSun;
        uniform float uLen, uDecay, uSteps;
        varying vec2 vUv;
        void main() {
          const int MAXS = 12;
          int steps = int(uSteps);
          vec2 delta = (uSun - vUv) * uLen / float(steps);
          vec2 uv = vUv;
          vec3 sum = vec3(0.0);
          float w = 1.0;
          float tot = 0.0;
          for (int i = 0; i < MAXS; i++) {
            if (i >= steps) break;
            uv += delta;
            vec3 s = texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
            sum += s * w;
            tot += w;
            w *= uDecay;
          }
          gl_FragColor = vec4(sum / max(tot, 1e-4), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    const u = this.uni;
    this.compMat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform sampler2D tBloom;
        uniform sampler2D tRays;
        uniform vec2 uResolution;
        uniform float uTime, uExposure, uBloom, uRayI, uSat, uVig, uGrain;
        uniform float uWobble, uCA, uTopGlow, uDepth;
        uniform vec2 uSunUV;
        uniform vec3 uBloomTint, uSurfaceTint, uShadowTint, uHighTint;
        varying vec2 vUv;
        ${ACES}
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        void main() {
          vec2 uv = vUv;
          float r = length(uv - 0.5);

          /* 물속 미세 굴절 — 화면이 아주 천천히 일렁인다 */
          vec2 wob = vec2(
            sin(uv.y * 21.0 + uTime * 1.15) + sin(uv.y * 9.0 - uTime * 0.63),
            cos(uv.x * 18.0 + uTime * 0.97) + cos(uv.x * 7.0 + uTime * 0.51)
          ) * (0.00085 * uWobble * (0.35 + 0.65 * r * 2.2));
          vec2 duv = clamp(uv + wob, vec2(0.0), vec2(1.0));

          /* 색수차 — 가장자리로 갈수록 물이 빛을 갈라놓는다 */
          vec2 ca = (uv - 0.5) * (0.0032 * uCA * (0.4 + r));
          vec3 col;
          if (uCA > 0.01) {
            col.r = texture2D(tScene, duv - ca).r;
            col.g = texture2D(tScene, duv).g;
            col.b = texture2D(tScene, duv + ca).b;
          } else {
            col = texture2D(tScene, duv).rgb;
          }

          /* 번짐 — 물속에서 빛이 퍼지는 느낌 */
          vec3 bloom = texture2D(tBloom, uv).rgb;
          col += bloom * uBloomTint * uBloom;

          /* 표층에서 내려오는 빛기둥 (스크린 공간 산란) */
          if (uRayI > 0.001) {
            vec3 rays = texture2D(tRays, uv).rgb;
            float near = 1.0 - smoothstep(0.0, 0.85, length(uv - uSunUV));
            col += rays * vec3(0.62, 0.93, 1.0) * uRayI * (0.35 + 0.65 * near);
          }

          /* 위에서 내려오는 밝은 물빛 — 아래로 갈수록 어두워진다 */
          float topK = pow(clamp(1.0 - uv.y, 0.0, 1.0), 2.3);
          col += uSurfaceTint * topK * uTopGlow;

          /* HDR → ACES 톤매핑 */
          vec3 mapped = abyssAces(col * uExposure);

          /* 색보정: 그림자는 청록, 하이라이트는 따뜻하게 */
          float lum = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
          mapped *= mix(uShadowTint, uHighTint, smoothstep(0.1, 0.72, lum));
          mapped = mix(vec3(lum), mapped, uSat);
          /* 부드러운 S 커브 — 물속 특유의 또렷한 대비 */
          mapped = clamp(mapped, 0.0, 1.0);
          mapped = mapped * mapped * (3.0 - 2.0 * mapped) * 0.34 + mapped * 0.66;
          /* 깊은 곳은 검정을 살짝 띄워 물빛이 남게 */
          mapped += uSurfaceTint * 0.012 * smoothstep(0.2, 1.0, uDepth);

          /* 비네트 */
          float vig = 1.0 - uVig * pow(clamp(r * 1.34, 0.0, 1.0), 2.6);
          mapped *= vig;
          /* 필름 그레인 + 디더링(밴딩 제거) */
          float g = hash12(uv * uResolution + uTime * 37.0) - 0.5;
          mapped += g * uGrain;
          gl_FragColor = vec4(max(mapped, 0.0), 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    /* 샘플러가 비어 있지 않도록 1x1 검정 텍스처를 기본값으로 둔다 */
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
    this.uni.tBloom.value = black;
    this.uni.tRays.value = black;
    this.uni.tScene.value = black;
    this._black = black;

    this._tmpV = new THREE.Vector3();
    this._sunNdc = new THREE.Vector3();
  }

  get isHigh() { return this.qualityName === 'high'; }

  setQuality(name) {
    const p = QUALITY[name] || QUALITY.high;
    this.qualityName = QUALITY[name] ? name : 'high';
    this.preset = p;
    this.uni.uCA.value = p.chromatic ? 1.0 : 0.0;
    this.uni.uGrain.value = p.grain;
    this.uni.uWobble.value = p.wobble;
    this.uni.uBloom.value = p.bloom ? 0.62 : 0.0;
    this.rayMat.uniforms.uSteps.value = p.raySteps;
    this.resize(true);
  }

  /** 드로잉 버퍼 크기(픽셀)에 맞춰 렌더타깃 재생성 */
  resize(force) {
    if (!this.ok) return;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(this.size);
    const w = Math.max(2, size.x);
    const h = Math.max(2, size.y);
    if (!force && w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;

    this.sceneRT.setSize(w, h);
    const bs = this.preset.bloomScale;
    const bw = Math.max(2, Math.round(w * bs));
    const bh = Math.max(2, Math.round(h * bs));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
    this.brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.uni.uResolution.value.set(w, h);
    this._bw = bw;
    this._bh = bh;
  }

  /** 태양(표층 광원) 위치 → 화면 좌표. 화면 뒤쪽이면 빛줄기를 끈다 */
  setSun(sunWorld, camera, strength) {
    if (!this.ok) return;
    const v = this._sunNdc.copy(sunWorld).project(camera);
    const behind = v.z > 1.0 || v.z < -1.0;
    const u = this.uni;
    u.uSunUV.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    u.uRayI.value = behind ? 0 : strength;
    this.rayMat.uniforms.uSun.value.copy(u.uSunUV.value);
  }

  _pass(mat, target) {
    this.quadMesh.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(dt) {
    const r = this.renderer;
    if (!this.ok) {
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
      return;
    }
    this.resize();
    this.uni.uTime.value += dt;

    /* 1) 장면 → HDR 타깃 */
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, this.camera);

    /* 2) 블룸 (1/4 해상도에서 가로·세로 블러 두 번) */
    if (this.preset.bloom) {
      this.brightMat.uniforms.tDiffuse.value = this.sceneRT.texture;
      this._pass(this.brightMat, this.bloomA);

      const bl = this.blurMat.uniforms;
      bl.tDiffuse.value = this.bloomA.texture;
      bl.uDir.value.set(1.4 / this._bw, 0);
      this._pass(this.blurMat, this.bloomB);

      bl.tDiffuse.value = this.bloomB.texture;
      bl.uDir.value.set(0, 1.4 / this._bh);
      this._pass(this.blurMat, this.bloomA);

      // 한 번 더 크게 번지게 (넓고 부드러운 후광)
      bl.tDiffuse.value = this.bloomA.texture;
      bl.uDir.value.set(2.6 / this._bw, 0);
      this._pass(this.blurMat, this.bloomB);
      bl.tDiffuse.value = this.bloomB.texture;
      bl.uDir.value.set(0, 2.6 / this._bh);
      this._pass(this.blurMat, this.bloomA);

      this.uni.tBloom.value = this.bloomA.texture;

      /* 3) 태양 빛줄기 — 밝은 부분을 태양 쪽으로 방사형 블러 */
      if (this.preset.rays && this.uni.uRayI.value > 0.001) {
        this.rayMat.uniforms.tDiffuse.value = this.bloomA.texture;
        this._pass(this.rayMat, this.rayA);
        this.uni.tRays.value = this.rayA.texture;
      } else {
        this.uni.uRayI.value = 0;
      }
    } else {
      this.uni.uBloom.value = 0;
      this.uni.uRayI.value = 0;
    }

    /* 4) 합성 */
    this.uni.tScene.value = this.sceneRT.texture;
    r.setRenderTarget(null);
    this.quadMesh.material = this.compMat;
    r.render(this.quadScene, this.quadCam);
  }

  dispose() {
    [this.sceneRT, this.bloomA, this.bloomB, this.rayA, this.rayB].forEach((t) => t && t.dispose());
    this.quadGeo.dispose();
    [this.brightMat, this.blurMat, this.rayMat, this.compMat].forEach((m) => m && m.dispose());
  }
}
