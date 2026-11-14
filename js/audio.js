/* =========================================================
   NEON STRIKER — 레트로 아케이드 효과음 엔진
   Web Audio API 로 실시간 합성 (오디오 파일 없음)
   ========================================================= */
(function () {
  "use strict";

  var ac = null;          // AudioContext
  var master = null;      // 마스터 게인
  var noiseBuf = null;    // 화이트 노이즈 버퍼 (폭발음용)
  var muted = false;
  var unlocked = false;
  var lastShot = 0;       // 연사 사운드 스로틀
  var lastHit = 0;

  function init() {
    if (ac) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ac = new AC();
    } catch (e) {
      ac = null;
      return false;
    }
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ac.destination);

    // 폭발용 노이즈 1회 생성
    try {
      var len = Math.floor(ac.sampleRate * 0.7);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      noiseBuf = null;
    }
    return true;
  }

  // 첫 사용자 제스처에서 호출: 컨텍스트 생성 + 재개
  function unlock() {
    if (!init()) return;
    if (ac.state === "suspended" && ac.resume) {
      try { ac.resume(); } catch (e) {}
    }
    unlocked = true;
  }

  function ok() {
    return ac && master && !muted;
  }

  function tone(o) {
    if (!ok()) return;
    try {
      var t0 = ac.currentTime + (o.delay || 0);
      var dur = o.dur || 0.1;
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.type = o.type || "square";
      osc.frequency.setValueAtTime(o.freq || 440, t0);
      if (o.to) {
        if (o.freq > 0 && o.to > 0) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);
        } else {
          osc.frequency.linearRampToValueAtTime(Math.max(1, o.to), t0 + dur);
        }
      }
      var peak = o.gain === undefined ? 0.15 : o.gain;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(dur * 0.2, 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (e) {}
  }

  function noise(o) {
    if (!ok() || !noiseBuf) return;
    try {
      var t0 = ac.currentTime + (o.delay || 0);
      var dur = o.dur || 0.3;
      var src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      var f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = o.q === undefined ? 0.9 : o.q;
      f.frequency.setValueAtTime(o.from || 1600, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(60, o.to || 180), t0 + dur);
      var g = ac.createGain();
      var peak = o.gain === undefined ? 0.25 : o.gain;
      g.gain.setValueAtTime(peak, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.03);
    } catch (e) {}
  }

  var SFX = {
    unlock: unlock,

    isMuted: function () { return muted; },

    setMuted: function (v) {
      muted = !!v;
      if (master) {
        try {
          master.gain.value = muted ? 0 : 0.55;
        } catch (e) {}
      }
    },

    /* 플레이어 발사 */
    shoot: function () {
      if (!ok()) return;
      var t = ac.currentTime;
      if (t - lastShot < 0.055) return;
      lastShot = t;
      tone({ freq: 1250, to: 480, type: "square", dur: 0.055, gain: 0.035 });
      tone({ freq: 2600, to: 1200, type: "triangle", dur: 0.03, gain: 0.015 });
    },

    /* 탄 명중 */
    hit: function () {
      if (!ok()) return;
      var t = ac.currentTime;
      if (t - lastHit < 0.045) return;
      lastHit = t;
      tone({ freq: 520, to: 300, type: "triangle", dur: 0.05, gain: 0.05 });
    },

    /* 적 폭발 */
    explode: function (big) {
      noise({ dur: big ? 0.5 : 0.26, gain: big ? 0.34 : 0.2, from: big ? 1500 : 1900, to: big ? 90 : 220 });
      tone({ freq: big ? 120 : 190, to: 40, type: "sine", dur: big ? 0.45 : 0.22, gain: big ? 0.3 : 0.16 });
    },

    /* 보스 격파 */
    bossDie: function () {
      noise({ dur: 1.1, gain: 0.4, from: 2200, to: 60 });
      tone({ freq: 160, to: 30, type: "sawtooth", dur: 1.0, gain: 0.28 });
      tone({ freq: 320, to: 60, type: "square", dur: 0.7, gain: 0.12, delay: 0.1 });
    },

    /* 플레이어 피격 */
    hurt: function () {
      noise({ dur: 0.4, gain: 0.3, from: 900, to: 120 });
      tone({ freq: 240, to: 55, type: "sawtooth", dur: 0.42, gain: 0.24 });
    },

    /* 실드 소모 */
    shieldBreak: function () {
      tone({ freq: 900, to: 200, type: "sine", dur: 0.25, gain: 0.2 });
      tone({ freq: 1800, to: 700, type: "triangle", dur: 0.18, gain: 0.1, delay: 0.02 });
    },

    /* 아이템 획득 */
    pickup: function () {
      tone({ freq: 660, type: "square", dur: 0.09, gain: 0.14 });
      tone({ freq: 990, type: "square", dur: 0.12, gain: 0.12, delay: 0.07 });
      tone({ freq: 1320, type: "triangle", dur: 0.1, gain: 0.08, delay: 0.14 });
    },

    /* 필살기 폭탄 */
    bomb: function () {
      noise({ dur: 0.9, gain: 0.4, from: 2600, to: 70 });
      tone({ freq: 420, to: 32, type: "sine", dur: 0.85, gain: 0.32 });
      tone({ freq: 1400, to: 120, type: "square", dur: 0.3, gain: 0.1, delay: 0.02 });
    },

    /* 웨이브 시작 */
    wave: function () {
      tone({ freq: 523, type: "square", dur: 0.09, gain: 0.1 });
      tone({ freq: 659, type: "square", dur: 0.09, gain: 0.1, delay: 0.09 });
      tone({ freq: 784, type: "square", dur: 0.14, gain: 0.1, delay: 0.18 });
    },

    /* 보스 경고 */
    bossWarn: function () {
      for (var i = 0; i < 3; i++) {
        tone({ freq: 180, type: "sawtooth", dur: 0.16, gain: 0.13, delay: i * 0.3 });
        tone({ freq: 132, type: "sawtooth", dur: 0.16, gain: 0.13, delay: i * 0.3 + 0.15 });
      }
    },

    /* 게임 오버 */
    gameover: function () {
      var notes = [440, 349, 262, 175];
      for (var i = 0; i < notes.length; i++) {
        tone({ freq: notes[i], to: notes[i] * 0.82, type: "sawtooth", dur: 0.3, gain: 0.14, delay: i * 0.16 });
      }
      noise({ dur: 0.8, gain: 0.16, from: 800, to: 80, delay: 0.1 });
    }
  };

  window.SFX = SFX;
})();
