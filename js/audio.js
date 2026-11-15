/* =========================================================
   ABYSS DIVER — 수중 음향 엔진 (Web Audio API 실시간 합성)
   오디오 파일 없이 소나 핑 · 어뢰 · 폭발 · 기포음을 만든다.
   ========================================================= */

export class Sound {
  constructor() {
    this.ac = null;
    this.master = null;
    this.muted = false;
    this.noise = null;
    this.drone = null;
    this.lastShot = 0;
    this.lastHit = 0;
    this.ready = false;
  }

  init() {
    if (this.ac) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ac = new AC();
    } catch (e) {
      this.ac = null;
      return false;
    }
    const ac = this.ac;
    this.master = ac.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ac.destination);

    // 폭발·기포용 노이즈 버퍼
    const len = Math.floor(ac.sampleRate * 1.6);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.ready = true;
    return true;
  }

  resume() {
    if (!this.ac) this.init();
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  }

  setMuted(v) {
    this.muted = !!v;
    if (this.master) {
      const t = this.ac.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, t, 0.08);
    }
  }

  toggle() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /* ---------- 저수준 헬퍼 ---------- */
  _osc(type, f0, f1, dur, gain, delay) {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noiseBurst(dur, gain, filterType, f0, f1, q, delay) {
    const ac = this.ac;
    if (!ac || !this.noise) return;
    const t = ac.currentTime + (delay || 0);
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = ac.createBiquadFilter();
    flt.type = filterType || 'lowpass';
    flt.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    flt.Q.value = q || 1;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  /* ---------- 수중 앰비언트 ---------- */
  startAmbient() {
    if (!this.ac || this.drone) return;
    const ac = this.ac;
    const t = ac.currentTime;
    const g = ac.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.11, t, 1.4);
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 300;
    const o1 = ac.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 46;
    const o2 = ac.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 69.5;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(flt.frequency);
    o1.connect(flt);
    o2.connect(flt);
    flt.connect(g);
    g.connect(this.master);
    o1.start();
    o2.start();
    lfo.start();
    this.drone = { g, o1, o2, lfo };
  }

  /* ---------- 게임 효과음 ---------- */
  sonar() {
    if (!this.ac) return;
    this._osc('sine', 1180, 760, 0.85, 0.16);
    this._osc('sine', 1180, 760, 1.5, 0.05, 0.26);
  }

  shoot() {
    if (!this.ac) return;
    const now = this.ac.currentTime;
    if (now - this.lastShot < 0.055) return;
    this.lastShot = now;
    this._osc('triangle', 520, 190, 0.13, 0.055);
    this._noiseBurst(0.1, 0.035, 'bandpass', 1400, 500, 1.4);
  }

  hit() {
    if (!this.ac) return;
    const now = this.ac.currentTime;
    if (now - this.lastHit < 0.04) return;
    this.lastHit = now;
    this._osc('square', 880, 1180, 0.05, 0.03);
  }

  explode(size) {
    if (!this.ac) return;
    const big = size === 'big';
    this._noiseBurst(big ? 1.1 : 0.42, big ? 0.5 : 0.22, 'lowpass', big ? 1100 : 900, 90, 1);
    this._osc('sine', big ? 110 : 170, big ? 28 : 55, big ? 0.9 : 0.35, big ? 0.3 : 0.13);
  }

  pickup() {
    if (!this.ac) return;
    this._osc('sine', 660, 990, 0.12, 0.1);
    this._osc('sine', 990, 1480, 0.16, 0.08, 0.09);
  }

  damage() {
    if (!this.ac) return;
    this._noiseBurst(0.5, 0.4, 'lowpass', 700, 120, 2);
    this._osc('sawtooth', 190, 48, 0.42, 0.16);
  }

  /** 큰 생물과 부딪혔을 때의 둔탁한 충격음 */
  bump() {
    if (!this.ac) return;
    this._noiseBurst(0.22, 0.2, 'lowpass', 460, 110, 1.3);
    this._osc('sine', 128, 52, 0.26, 0.11);
  }

  bomb() {
    if (!this.ac) return;
    this._osc('sine', 1500, 180, 1.0, 0.22);
    this._noiseBurst(1.2, 0.32, 'lowpass', 2400, 160, 1);
  }

  waveClear() {
    if (!this.ac) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this._osc('sine', f, f, 0.3, 0.1, i * 0.09));
  }

  bossWarn() {
    if (!this.ac) return;
    this._osc('sawtooth', 72, 48, 1.6, 0.2);
    this._osc('sawtooth', 108, 72, 1.6, 0.11, 0.05);
    this._noiseBurst(1.4, 0.14, 'lowpass', 500, 90, 1);
  }

  gameOver() {
    if (!this.ac) return;
    const notes = [440, 349.2, 261.6, 164.8];
    notes.forEach((f, i) => this._osc('sine', f, f * 0.98, 0.5, 0.13, i * 0.16));
  }

  bubble() {
    if (!this.ac) return;
    this._osc('sine', 420 + Math.random() * 300, 900, 0.09, 0.028);
  }
}
