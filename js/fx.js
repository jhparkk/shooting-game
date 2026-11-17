/* =========================================================
   ABYSS DIVER — 파티클 / 폭발 / 음파 링 이펙트
   ========================================================= */
import * as THREE from 'three';
import { glowTexture } from './models.js?v=20261117b8';

/** 기포(공기방울) 스프라이트 — 밝은 테두리 + 속이 빈 맑은 원 */
let _bubbleTex = null;
function bubbleTexture() {
  if (_bubbleTex) return _bubbleTex;
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = s;
  cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s * 0.40, s * 0.36, s * 0.04, s * 0.5, s * 0.5, s * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.34, 'rgba(228,250,255,0.20)');
  g.addColorStop(0.72, 'rgba(214,246,255,0.26)');
  g.addColorStop(0.90, 'rgba(240,255,255,0.80)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(233,253,255,0.6)';
  ctx.lineWidth = s * 0.045;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  _bubbleTex = new THREE.CanvasTexture(cv);
  _bubbleTex.colorSpace = THREE.SRGBColorSpace;
  return _bubbleTex;
}

export class FX {
  constructor(scene, max = 420) {
    this.scene = scene;
    this.max = max;
    this.head = 0;

    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.buoy = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, max);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: glowTexture() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (420.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * a, a);
        }
      `,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // 음파 링 풀
    this.rings = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.RingGeometry(0.86, 1, 40);
      const m = new THREE.MeshBasicMaterial({
        color: 0x9dfff2, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, t: 0, life: 1, maxR: 10, active: false });
    }

    // 섬광 스프라이트 풀
    this.flashes = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xffffff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false,
      }));
      s.visible = false;
      s.frustumCulled = false;
      this.scene.add(s);
      this.flashes.push({ sprite: s, t: 0, life: 1, size: 4, active: false });
    }

    /* ---------------- 기포 풀 ---------------- */
    this.bubMax = 260;
    this.bubHead = 0;
    this.bTime = 0;
    const B = this.bubMax;
    this.bPos = new Float32Array(B * 3);
    this.bSize = new Float32Array(B);
    this.bAlpha = new Float32Array(B);
    this.bLife = new Float32Array(B);
    this.bMaxLife = new Float32Array(B);
    this.bRise = new Float32Array(B);
    this.bPhase = new Float32Array(B);
    this.bBase = new Float32Array(B);
    this.bTint = new Float32Array(B * 3);
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(this.bPos, 3));
    bgeo.setAttribute('aColor', new THREE.BufferAttribute(this.bTint, 3));
    bgeo.setAttribute('aSize', new THREE.BufferAttribute(this.bSize, 1));
    bgeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.bAlpha, 1));
    bgeo.setDrawRange(0, B);
    const bmat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: bubbleTexture() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (420.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * t.rgb, a);
        }
      `,
    });
    this.bubblePoints = new THREE.Points(bgeo, bmat);
    this.bubblePoints.frustumCulled = false;
    this.bubblePoints.renderOrder = 2;
    this.scene.add(this.bubblePoints);
  }

  /* ---------------- 기포 ---------------- */
  /** 공기방울 하나 — 위로 봉긋 솟아오르며 좌우로 흔들린다 */
  bubble(x, y, z, size, life, rise, tint) {
    const i = this.bubHead;
    this.bubHead = (this.bubHead + 1) % this.bubMax;
    this.bPos[i * 3] = x;
    this.bPos[i * 3 + 1] = y;
    this.bPos[i * 3 + 2] = z;
    this.bSize[i] = size || 1;
    this.bBase[i] = size || 1;
    this.bLife[i] = life || 3;
    this.bMaxLife[i] = life || 3;
    this.bRise[i] = rise === undefined ? 5 : rise;
    this.bPhase[i] = Math.random() * 6.28;
    const c = tint === undefined ? 0xeafcff : tint;
    const col = new THREE.Color(c);
    this.bTint[i * 3] = col.r;
    this.bTint[i * 3 + 1] = col.g;
    this.bTint[i * 3 + 2] = col.b;
    this.bAlpha[i] = 0.0;
  }

  /** 살아 있는 기포 수 (검증용) */
  bubblesAlive() {
    let n = 0;
    for (let i = 0; i < this.bubMax; i++) if (this.bLife[i] > 0) n++;
    return n;
  }

  _updateBubbles(dt) {
    this.bTime += dt;
    const t = this.bTime;
    for (let i = 0; i < this.bubMax; i++) {
      if (this.bLife[i] <= 0) {
        if (this.bAlpha[i] !== 0) this.bAlpha[i] = 0;
        continue;
      }
      this.bLife[i] -= dt;
      if (this.bLife[i] <= 0) {
        this.bAlpha[i] = 0;
        this.bSize[i] = 0;
        continue;
      }
      const ph = this.bPhase[i];
      this.bPos[i * 3 + 1] += this.bRise[i] * dt;
      this.bPos[i * 3] += Math.sin(t * 2.1 + ph) * 1.1 * dt;
      this.bPos[i * 3 + 2] += Math.cos(t * 1.7 + ph * 1.3) * 0.9 * dt;
      const k = this.bLife[i] / this.bMaxLife[i];
      const pop = k > 0.9 ? (1 - k) / 0.1 : 1;       // 생길 때 살짝 커진다
      this.bAlpha[i] = 0.72 * Math.min(1, k * 4) * pop;
      this.bSize[i] = this.bBase[i] * (0.7 + (1 - k) * 0.5);
    }
    const g = this.bubblePoints.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }

  _slot() {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    return i;
  }

  emit(x, y, z, vx, vy, vz, color, size, life, buoy, drag) {
    const i = this._slot();
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.baseSize[i] = size;
    this.size[i] = size;
    this.baseAlpha[i] = 0.9;
    this.alpha[i] = 0.9;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.buoy[i] = buoy || 0;
    this.drag[i] = drag === undefined ? 1.6 : drag;
  }

  burst(x, y, z, count, opts = {}) {
    const colors = opts.colors || [0xbdfbff, 0x7de8ff, 0xffffff];
    const speed = opts.speed || 9;
    const size = opts.size || 1.4;
    const life = opts.life || 0.6;
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.8));
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.emit(x, y, z, dir.x, dir.y, dir.z, c, size * (0.5 + Math.random()), life * (0.6 + Math.random() * 0.7), opts.buoy || 0, opts.drag);
    }
  }

  ring(pos, color, maxR, life) {
    const r = this.rings.find((x) => !x.active) || this.rings[0];
    r.active = true;
    r.t = 0;
    r.life = life || 0.8;
    r.maxR = maxR || 12;
    r.mesh.position.copy(pos);
    r.mesh.material.color.set(color || 0x9dfff2);
    r.mesh.material.opacity = 0.9;
    r.mesh.scale.setScalar(0.4);
    r.mesh.visible = true;
  }

  flash(pos, color, size, life) {
    const f = this.flashes.find((x) => !x.active) || this.flashes[0];
    f.active = true;
    f.t = 0;
    f.life = life || 0.35;
    f.size = size || 6;
    f.sprite.position.copy(pos);
    f.sprite.material.color.set(color || 0xffffff);
    f.sprite.material.opacity = 1;
    f.sprite.scale.setScalar(f.size);
    f.sprite.visible = true;
  }

  update(dt, camera) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.buoy[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;

      const k = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, k * 2.6);
      this.size[i] = this.baseSize[i] * (0.55 + 0.45 * k);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const scale = 0.4 + (r.maxR - 0.4) * (1 - Math.pow(1 - k, 2.2));
      r.mesh.scale.setScalar(scale);
      r.mesh.material.opacity = 0.85 * (1 - k);
      if (camera) r.mesh.quaternion.copy(camera.quaternion);
    }

    for (const f of this.flashes) {
      if (!f.active) continue;
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        f.active = false;
        f.sprite.visible = false;
        continue;
      }
      f.sprite.scale.setScalar(f.size * (1 + k * 1.6));
      f.sprite.material.opacity = (1 - k) * 0.95;
    }

    this._updateBubbles(dt);
  }

  clear() {
    for (let i = 0; i < this.max; i++) {
      this.life[i] = 0;
      this.alpha[i] = 0;
      this.size[i] = 0;
    }
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const f of this.flashes) {
      f.active = false;
      f.sprite.visible = false;
    }
    for (let i = 0; i < this.bubMax; i++) {
      this.bLife[i] = 0;
      this.bAlpha[i] = 0;
      this.bSize[i] = 0;
    }
  }
}
