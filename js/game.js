/* =========================================================
   NEON STRIKER — 네온 아케이드 우주 슈팅
   순수 Canvas 2D + Web Audio. 빌드 없이 바로 동작.
   ========================================================= */
(function () {
  "use strict";

  /* =======================================================
     1. 유틸
     ======================================================= */
  var TAU = Math.PI * 2;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var rnd = function (a, b) { return b === undefined ? Math.random() * a : a + Math.random() * (b - a); };
  var damp = function (a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); };
  var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); };
  var dist = function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); };

  var PAL = {
    cyan: [34, 230, 255],
    magenta: [255, 60, 190],
    amber: [255, 190, 60],
    red: [255, 70, 90],
    green: [90, 255, 180],
    blue: [100, 140, 255],
    purple: [160, 100, 255],
    white: [235, 245, 255]
  };
  var col = function (key, a) {
    var c = PAL[key] || PAL.white;
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (a === undefined ? 1 : a) + ")";
  };

  /* =======================================================
     2. 저장소 (localStorage)
     ======================================================= */
  var KEY_BEST = "neonstriker.best.v1";
  var KEY_MUTE = "neonstriker.muted.v1";
  function loadNum(k, d) {
    try {
      var v = window.localStorage.getItem(k);
      if (v === null || v === undefined) return d;
      var n = parseInt(v, 10);
      return isNaN(n) ? d : n;
    } catch (e) { return d; }
  }
  function saveNum(k, v) {
    try { window.localStorage.setItem(k, String(v)); } catch (e) {}
  }

  /* =======================================================
     3. 오디오 (없으면 무음 동작)
     ======================================================= */
  var NOOP = function () {};
  var SFX = window.SFX || {
    unlock: NOOP, isMuted: function () { return true; }, setMuted: NOOP,
    shoot: NOOP, hit: NOOP, explode: NOOP, bossDie: NOOP, hurt: NOOP,
    shieldBreak: NOOP, pickup: NOOP, bomb: NOOP, wave: NOOP, bossWarn: NOOP, gameover: NOOP
  };

  /* =======================================================
     4. DOM
     ======================================================= */
  var $ = function (id) { return document.getElementById(id); };
  var cv = $("game");
  var ctx = cv.getContext("2d", { alpha: false });

  var ui = {
    hud: $("hud"),
    score: $("hud-score"),
    best: $("hud-best"),
    wave: $("hud-wave"),
    hearts: $("hud-hearts"),
    combo: $("hud-combo"),
    bombs: $("hud-bombs"),
    bombBtn: $("btn-bomb"),
    muteBtn: $("btn-mute"),
    muteIcon: $("mute-icon"),
    bossBar: $("boss-bar"),
    bossFill: $("boss-bar-fill"),
    bossHp: $("boss-bar-hp"),
    startBest: $("start-best"),
    pauseScore: $("pause-score"),
    pauseWave: $("pause-wave"),
    overScore: $("over-score"),
    overBest: $("over-best"),
    overWave: $("over-wave"),
    newRecord: $("new-record"),
    screens: {
      start: $("screen-start"),
      pause: $("screen-pause"),
      over: $("screen-over")
    }
  };

  /* =======================================================
     5. 캔버스 · 배경 · 별
     ======================================================= */
  var W = 360, H = 640, DPR = 1, SC = 1;
  var BOUND = { l: 20, r: 340, t: 80, b: 600 };
  var bgCanvas = null;
  var stars = [];
  var T = 0;                 // 전체 경과 시간(초)

  function buildBackground() {
    bgCanvas = document.createElement("canvas");
    bgCanvas.width = Math.max(2, Math.round(W));
    bgCanvas.height = Math.max(2, Math.round(H));
    var g = bgCanvas.getContext("2d");
    if (!g) return;

    var base = g.createLinearGradient(0, 0, W * 0.4, H);
    base.addColorStop(0, "#0a0322");
    base.addColorStop(0.42, "#06020f");
    base.addColorStop(1, "#02010a");
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    // 성운
    var blob = function (cx, cy, rad, color) {
      var rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      rg.addColorStop(0, color);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
    };
    var big = Math.max(W, H);
    blob(W * 0.88, H * 0.1, big * 0.62, "rgba(255,60,190,0.13)");
    blob(W * 0.06, H * 0.86, big * 0.58, "rgba(34,230,255,0.11)");
    blob(W * 0.5, H * 0.45, big * 0.9, "rgba(90,50,180,0.10)");

    // 비네트
    var vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.68)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);

    // 스캔라인
    g.globalAlpha = 0.055;
    g.fillStyle = "#000000";
    for (var y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    g.globalAlpha = 1;
  }

  function newStar(anywhere) {
    var z = rnd(0.18, 1);
    return {
      x: rnd(W),
      y: anywhere ? rnd(H) : -8,
      z: z,
      r: rnd(0.5, 1.7),
      tw: rnd(TAU),
      tws: rnd(0.7, 2.6)
    };
  }

  function buildStars() {
    var count = clamp(Math.round((W * H) / 7200), 80, 240);
    stars = [];
    for (var i = 0; i < count; i++) stars.push(newStar(true));
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    var rect = cv.getBoundingClientRect();
    var w = rect.width || window.innerWidth || 360;
    var h = rect.height || window.innerHeight || 640;
    W = Math.max(260, Math.round(w));
    H = Math.max(380, Math.round(h));
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    SC = clamp(Math.min(W / 430, H / 800), 0.7, 1.5);
    buildBackground();
    buildStars();
    updateBounds();
    if (player) {
      player.tx = clamp(player.tx, BOUND.l, BOUND.r);
      player.ty = clamp(player.ty, BOUND.t, BOUND.b);
      player.x = clamp(player.x, BOUND.l, BOUND.r);
      player.y = clamp(player.y, BOUND.t, BOUND.b);
    }
    var b = boss;
    if (b) b.y = Math.min(b.y, H * 0.22);
  }

  function updateBounds() {
    BOUND.l = 18 * SC;
    BOUND.r = W - 18 * SC;
    BOUND.t = Math.max(76, H * 0.1);
    BOUND.b = H - 32 * SC;
  }

  /* =======================================================
     6. 발광 스프라이트
     ======================================================= */
  var SPR = {};
  var glowCache = {};

  function glow(key, size) {
    var cacheKey = key + "@" + size;
    if (glowCache[cacheKey]) return glowCache[cacheKey];
    var c = document.createElement("canvas");
    c.width = c.height = size * 2;
    var g = c.getContext("2d");
    if (g) {
      var grd = g.createRadialGradient(size, size, 0, size, size, size);
      grd.addColorStop(0, "rgba(255,255,255,0.95)");
      grd.addColorStop(0.18, col(key, 0.85));
      grd.addColorStop(0.5, col(key, 0.24));
      grd.addColorStop(1, col(key, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, size * 2, size * 2);
    }
    glowCache[cacheKey] = c;
    return c;
  }

  function initSprites() {
    var keys = ["cyan", "magenta", "amber", "red", "green", "blue", "purple", "white"];
    for (var i = 0; i < keys.length; i++) SPR[keys[i]] = glow(keys[i], 24);
    SPR.boss = glow("purple", 64);
  }

  function spr(key) { return SPR[key] || SPR.white; }

  /* =======================================================
     7. 게임 상태
     ======================================================= */
  var game = {
    state: "menu",           // menu | playing | paused | over
    score: 0,
    best: loadNum(KEY_BEST, 0),
    wave: 0,
    combo: 0,
    comboT: 0,
    bestNew: false,
    banner: null,
    muted: loadNum(KEY_MUTE, 0) === 1
  };

  var player = null;
  var boss = null;
  var bullets = [];
  var ebullets = [];
  var enemies = [];
  var pickups = [];
  var particles = [];
  var rings = [];
  var texts = [];
  var timers = [];

  var waveState = { n: 0, kind: "normal", pending: [], idx: 0, t: 0, intro: 0, clearT: 1.2, clearing: false, bossSpawned: false, bossLevel: 1 };

  var shake = 0;
  var flash = 0;
  var flashColor = "255,255,255";
  var starSpeed = 0.45;

  var keys = {};
  var activePointer = null;

  /* =======================================================
     8. 작은 도우미들
     ======================================================= */
  function after(sec, fn) { timers.push({ t: sec, fn: fn }); }

  function updateTimers(dt) {
    for (var i = timers.length - 1; i >= 0; i--) {
      var tm = timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        timers.splice(i, 1);
        try { tm.fn(); } catch (e) {}
      }
    }
  }

  function compact(arr) {
    var w = 0;
    for (var i = 0; i < arr.length; i++) {
      if (!arr[i].remove) arr[w++] = arr[i];
    }
    arr.length = w;
  }

  function addShake(v) { shake = Math.min(26, shake + v); }

  function burst(x, y, key, count, speed, life, size) {
    if (particles.length > 420) return;
    for (var i = 0; i < count; i++) {
      var a = rnd(TAU);
      var sp = speed * rnd(0.25, 1);
      var lf = life * rnd(0.6, 1.2);
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: lf, max: lf,
        size: size * rnd(0.5, 1.3),
        drag: rnd(2.2, 4.2),
        spr: spr(key)
      });
    }
  }

  function floatText(x, y, text, key, size) {
    texts.push({ x: x, y: y, text: text, life: 0.9, max: 0.9, color: key || "white", size: size || 12 });
  }

  function showBanner(text, sub, dur, key) {
    game.banner = { text: text, sub: sub || "", t: dur, dur: dur, color: key || "cyan" };
  }

  function updateBanner(dt) {
    if (game.banner) {
      game.banner.t -= dt;
      if (game.banner.t <= 0) game.banner = null;
    }
  }

  /* =======================================================
     9. 플레이어
     ======================================================= */
  function makePlayer() {
    return {
      x: W / 2, y: H * 0.8, tx: W / 2, ty: H * 0.8,
      r: 11 * SC,
      hp: 3, maxHp: 3,
      shield: 0, multi: 0, rapid: 0,
      bombs: 1, fireCd: 0.2, invuln: 1.4,
      tilt: 0, dead: false
    };
  }

  function updatePlayer(dt) {
    var p = player;
    if (!p || p.dead) return;

    p.invuln = Math.max(0, p.invuln - dt);
    p.multi = Math.max(0, p.multi - dt);
    p.rapid = Math.max(0, p.rapid - dt);

    var px = p.x;
    p.x = damp(p.x, p.tx, 24, dt);
    p.y = damp(p.y, p.ty, 24, dt);

    var vx = dt > 0 ? (p.x - px) / dt : 0;
    var wantTilt = clamp(vx / (900 * SC), -0.3, 0.3);
    p.tilt = damp(p.tilt, wantTilt, 14, dt);

    // 자동 연사
    p.fireCd -= dt;
    if (p.fireCd <= 0) {
      firePlayer();
      p.fireCd = p.rapid > 0 ? 0.085 : 0.125;
    }
  }

  function firePlayer() {
    var p = player;
    var speed = (p.rapid > 0 ? 1120 : 940) * SC;
    var y = p.y - p.r * 1.15;

    if (p.multi > 0) {
      for (var k = -1; k <= 1; k++) {
        var a = -Math.PI / 2 + k * 0.135;
        bullets.push({
          x: p.x + k * 7 * SC, y: y,
          vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          r: 3.1 * SC, dmg: 1, life: 2.4, remove: false
        });
      }
    } else {
      bullets.push({
        x: p.x, y: y, vx: 0, vy: -speed,
        r: 3.4 * SC, dmg: 1.15, life: 2.4, remove: false
      });
    }
    // 총구 화염
    for (var i = 0; i < 2; i++) {
      particles.push({
        x: p.x + rnd(-2, 2) * SC, y: y,
        vx: rnd(-40, 40) * SC, vy: rnd(-120, -40) * SC,
        life: 0.16, max: 0.16, size: 3.2 * SC, drag: 3, spr: spr("cyan")
      });
    }
    SFX.shoot();
  }

  function damagePlayer() {
    var p = player;
    if (!p || p.dead || p.invuln > 0 || game.state !== "playing") return;

    game.combo = 0;
    if (p.shield > 0) {
      p.shield = 0;
      p.invuln = 1.5;
      addShake(7);
      flash = 0.3;
      flashColor = "120,210,255";
      burst(p.x, p.y, "blue", 20, 300, 0.6, 5);
      rings.push({ x: p.x, y: p.y, r: p.r, maxR: 90 * SC, life: 0.45, max: 0.45, color: "blue", w: 3 });
      floatText(p.x, p.y - 34 * SC, "실드 파괴", "blue", 13);
      SFX.shieldBreak();
    } else {
      p.hp--;
      p.invuln = 2.0;
      p.multi = 0;
      p.rapid = 0;
      addShake(15);
      flash = 0.5;
      flashColor = "255,80,110";
      burst(p.x, p.y, "red", 24, 330, 0.75, 5.5);
      SFX.hurt();
      if (p.hp <= 0) gameOver();
    }
    syncHud();
  }

  function useBomb() {
    var p = player;
    if (!p || p.dead || game.state !== "playing" || p.bombs <= 0) return;

    p.bombs--;
    p.invuln = Math.max(p.invuln, 0.8);
    addShake(20);
    flash = 0.55;
    flashColor = "255,215,130";
    SFX.bomb();

    // 적탄 소거
    for (var i = 0; i < ebullets.length; i++) {
      burst(ebullets[i].x, ebullets[i].y, "amber", 2, 150, 0.3, 2.6);
    }
    ebullets.length = 0;

    // 전체 타격
    for (var j = 0; j < enemies.length; j++) {
      var e = enemies[j];
      if (e.remove || e.dying) continue;
      hitEnemy(e, e.type === "boss" ? 34 : 999, e.x, e.y);
    }

    rings.push({ x: p.x, y: p.y, r: 24 * SC, maxR: Math.max(W, H) * 1.15, life: 0.8, max: 0.8, color: "amber", w: 5 });
    rings.push({ x: p.x, y: p.y, r: 10 * SC, maxR: Math.max(W, H) * 0.7, life: 0.55, max: 0.55, color: "white", w: 3 });
    syncHud();
  }

  /* =======================================================
     10. 점수 · 콤보
     ======================================================= */
  function comboMult() { return 1 + Math.min(3, Math.floor(game.combo / 10)); }

  function addScore(base) {
    var gain = Math.round(base * comboMult() / 5) * 5;
    game.score += gain;
    return gain;
  }

  /* =======================================================
     11. 적 정의 · 웨이브
     ======================================================= */
  var ENEMY = {
    scout: { r: 15, hp: 2, score: 100, fire: 2.5, amp: 26, color: "magenta" },
    dart: { r: 14, hp: 3, score: 180, fire: 2.0, amp: 76, color: "amber" },
    heavy: { r: 27, hp: 16, score: 520, fire: 2.8, amp: 62, color: "red" }
  };

  function spawnEnemy(type, x) {
    var base = ENEMY[type];
    if (!base) return null;
    var x0 = clamp(x, 42 * SC, W - 42 * SC);
    var e = {
      type: type, x: x0, y: -34 * SC, r: base.r * SC,
      hp: 0, maxHp: 0, t: 0, phase: rnd(TAU),
      fireCd: base.fire * rnd(0.6, 1.2),
      flash: 0, score: base.score, color: base.color,
      baseX: x0, amp: base.amp * SC, remove: false, dying: false
    };
    e.hp = e.maxHp = Math.round(base.hp * (1 + (game.wave - 1) * 0.12));
    enemies.push(e);
    return e;
  }

  function buildWave(n) {
    var list = [];
    var count = Math.round(4 + n * 1.5);
    if (count > 26) count = 26;
    var gap = clamp(0.78 - n * 0.028, 0.26, 0.78);
    var t = 0.15;

    for (var i = 0; i < count; i++) {
      var type = "scout";
      var roll = Math.random();
      if (n >= 4 && roll < 0.16) type = "heavy";
      else if (n >= 2 && roll < 0.62) type = "dart";
      list.push({ at: t, type: type, x: rnd(W * 0.12, W * 0.88) });
      t += gap * rnd(0.72, 1.28);
    }

    // 소규모 편대: 같은 높이에서 좌우로 동시 진입
    if (n >= 3) {
      var pairAt = t + 0.4;
      var cx = rnd(W * 0.28, W * 0.72);
      list.push({ at: pairAt, type: "scout", x: cx - 42 * SC });
      list.push({ at: pairAt, type: "scout", x: cx + 42 * SC });
    }

    waveState.pending = list;
    waveState.idx = 0;
    waveState.t = 0;
  }

  function waveTip(n) {
    if (n === 1) return "드래그로 조종 · 자동 연사";
    if (n === 2) return "요격기 등장 — 지그재그를 피하세요";
    if (n === 4) return "장갑기 등장 — 집중 포화로 격파";
    if (n === 5) return "멀티샷 아이템을 노리세요";
    var left = 3 - (n % 3);
    return "보스까지 " + left + " 웨이브";
  }

  function startWave(n) {
    game.wave = n;
    waveState.n = n;
    waveState.pending = [];
    waveState.idx = 0;
    waveState.t = 0;
    waveState.clearT = 1.15;
    waveState.clearing = false;
    waveState.bossSpawned = false;

    if (n % 3 === 0) {
      waveState.kind = "boss";
      waveState.bossLevel = Math.floor(n / 3);
      waveState.intro = 2.3;
      showBanner("WARNING", "WAVE " + n + " · 보스 접근 중", 2.3, "magenta");
      SFX.bossWarn();
    } else {
      waveState.kind = "normal";
      waveState.intro = 1.35;
      showBanner("WAVE " + n, waveTip(n), 1.35, "cyan");
      buildWave(n);
      SFX.wave();
    }
    syncHud();
  }

  function updateWaves(dt) {
    if (waveState.clearing) return;

    if (waveState.intro > 0) {
      waveState.intro -= dt;
      if (waveState.intro <= 0 && waveState.kind === "boss" && !waveState.bossSpawned) {
        spawnBoss(waveState.bossLevel);
        waveState.bossSpawned = true;
      }
      return;
    }

    waveState.t += dt;

    while (waveState.idx < waveState.pending.length && waveState.pending[waveState.idx].at <= waveState.t) {
      var s = waveState.pending[waveState.idx++];
      spawnEnemy(s.type, s.x);
    }

    var done = waveState.idx >= waveState.pending.length && enemies.length === 0;
    if (done) {
      waveState.clearT -= dt;
      if (waveState.clearT <= 0) completeWave();
    } else {
      waveState.clearT = 1.15;
    }
  }

  function completeWave() {
    waveState.clearing = true;
    var bonus = 100 * game.wave;
    game.score += bonus;
    showBanner("WAVE CLEAR", "+" + fmt(bonus) + " 보너스", 1.5, "green");
    SFX.wave();
    syncHud();
    after(1.7, function () {
      if (game.state === "playing") startWave(game.wave + 1);
    });
  }

  /* =======================================================
     12. 적 업데이트
     ======================================================= */
  function updateEnemies(dt) {
    var p = player;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.remove) continue;
      e.t += dt;
      if (e.flash > 0) e.flash -= dt;

      if (e.type === "boss") updateBoss(e, dt);
      else if (e.type === "scout") updateScout(e, dt);
      else if (e.type === "dart") updateDart(e, dt);
      else updateHeavy(e, dt);

      if (e.remove) continue;

      if (e.type !== "boss" && e.y > H + 90 * SC) {
        e.remove = true;
        continue;
      }

      if (p && !p.dead && !e.dying) {
        if (e.type === "boss") {
          if (dist(e.x, e.y, p.x, p.y) < e.r * 0.85 + p.r) damagePlayer();
        } else {
          var rr = e.r * 0.75 + p.r;
          if (dist(e.x, e.y, p.x, p.y) < rr) {
            damagePlayer();
            killEnemy(e);
          }
        }
      }
    }
    compact(enemies);
    if (boss && boss.remove) boss = null;
  }

  function updateScout(e, dt) {
    var sp = (88 + Math.min(60, game.wave * 3)) * SC;
    e.y += sp * dt;
    e.x = e.baseX + Math.sin(e.t * 1.7 + e.phase) * e.amp;

    e.fireCd -= dt;
    if (e.fireCd <= 0 && e.y > 0 && e.y < H * 0.8) {
      eShoot(e.x, e.y + e.r * 0.8, Math.PI / 2 + rnd(-0.07, 0.07), 235 * SC, "magenta", 4 * SC);
      e.fireCd = ENEMY.scout.fire * rnd(0.85, 1.25) * clamp(1 - game.wave * 0.02, 0.6, 1);
    }
  }

  function updateDart(e, dt) {
    var sp = (118 + Math.min(70, game.wave * 4)) * SC;
    e.y += sp * dt;
    e.x = e.baseX + Math.sin(e.t * 2.6 + e.phase) * e.amp;
    e.rot = Math.cos(e.t * 2.6 + e.phase) * 0.45;

    e.fireCd -= dt;
    if (e.fireCd <= 0 && e.y > 0 && player && !player.dead) {
      var ang = Math.atan2(player.y - e.y, player.x - e.x);
      eShoot(e.x, e.y + e.r * 0.4, ang, 300 * SC, "amber", 4.4 * SC);
      e.fireCd = ENEMY.dart.fire * rnd(0.8, 1.2);
    }
  }

  function updateHeavy(e, dt) {
    var targetY = H * 0.2 + Math.sin(e.phase) * H * 0.05;
    if (e.y < targetY) {
      e.y += (112 + Math.min(50, game.wave * 3)) * SC * dt;
    } else {
      e.y = targetY + Math.sin(e.t * 1.2) * 9 * SC;
      e.x = e.baseX + Math.sin(e.t * 0.8 + e.phase) * e.amp;
    }
    e.rot = (e.rot || 0) + dt * 0.7;

    e.fireCd -= dt;
    if (e.fireCd <= 0 && e.y > 0) {
      var base = player && !player.dead ? Math.atan2(player.y - e.y, player.x - e.x) : Math.PI / 2;
      for (var k = -1; k <= 1; k++) {
        eShoot(e.x, e.y + e.r * 0.45, base + k * 0.3, 225 * SC, "red", 5 * SC);
      }
      e.fireCd = ENEMY.heavy.fire * rnd(0.85, 1.15);
    }
  }

  function eShoot(x, y, angle, speed, key, r) {
    if (ebullets.length > 220) return;
    ebullets.push({
      x: x, y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: r, color: key, life: 9, t: 0, remove: false
    });
  }

  function hitEnemy(e, dmg, hx, hy) {
    if (e.remove || e.dying) return;
    e.hp -= dmg;
    e.flash = 0.08;
    burst(hx, hy, "white", 2, 150, 0.22, 2.4);
    SFX.hit();
    if (e.type === "boss") addShake(1.3);
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    if (e.remove || e.dying) return;

    if (e.type === "boss") {
      bossDie(e);
      return;
    }

    e.remove = true;
    game.combo++;
    game.comboT = 2.8;
    var gain = addScore(e.score);
    var big = e.type === "heavy";
    burst(e.x, e.y, e.color, big ? 26 : 14, big ? 380 : 250, big ? 0.9 : 0.6, big ? 6 : 4.2);
    rings.push({ x: e.x, y: e.y, r: e.r * 0.6, maxR: e.r * (big ? 3.8 : 2.5), life: 0.45, max: 0.45, color: e.color, w: 2.4 });
    addShake(big ? 7 : 3);
    SFX.explode(big);

    if (big) floatText(e.x, e.y - 8, "+" + fmt(gain), "amber", 13);

    var chance = big ? 0.5 : e.type === "dart" ? 0.16 : 0.1;
    if (Math.random() < chance) dropPickup(e.x, e.y);
  }

  /* =======================================================
     13. 보스
     ======================================================= */
  function spawnBoss(level) {
    var r = 54 * SC;
    var hp = 95 + level * 65;
    var b = {
      type: "boss", x: W / 2, y: -r * 1.8, r: r,
      hp: hp, maxHp: hp, score: 2500 + level * 300,
      t: 0, flash: 0, entering: true, dying: false,
      fireCd: 1.9, pat: 0, remove: false, color: "purple"
    };
    enemies.push(b);
    boss = b;
    syncHud();
  }

  function updateBoss(b, dt) {
    if (b.entering) {
      b.y += H * 0.42 * dt;
      if (b.y >= H * 0.17) {
        b.y = H * 0.17;
        b.entering = false;
        b.wait = 1.4;
        b.targetX = W / 2;
      }
      return;
    }
    if (b.dying) return;

    var ratio = clamp(b.hp / b.maxHp, 0, 1);

    // "이동 → 정지 후 사격" 리듬: 화면이 넓어도 추적 가능한 속도로만 움직인다.
    if (b.wait > 0) {
      b.wait -= dt;
      if (b.wait <= 0) {
        b.targetX = W / 2 + rnd(-1, 1) * Math.min(W * 0.34, 330 * SC);
      }
    } else {
      var sp = 205 * SC * (ratio < 0.4 ? 1.4 : 1);
      var dx = b.targetX - b.x;
      if (Math.abs(dx) > 2) {
        b.x += clamp(dx, -sp * dt, sp * dt);
      } else {
        b.x = b.targetX;
        b.wait = rnd(1.3, 2.1) * (ratio < 0.4 ? 0.75 : 1);
      }
    }

    b.y = H * 0.17 + Math.sin(b.t * 1.5) * 13 * SC;

    b.fireCd -= dt * (ratio < 0.35 ? 1.45 : ratio < 0.65 ? 1.2 : 1);
    if (b.fireCd <= 0) bossAttack(b, ratio);
  }

  function bossAttack(b, ratio) {
    var speed = 260 * SC;
    b.pat = (b.pat + 1) % 3;

    if (b.pat === 0) {
      // 조준 부채꼴 5발
      var ang = player && !player.dead ? Math.atan2(player.y - b.y, player.x - b.x) : Math.PI / 2;
      for (var k = -2; k <= 2; k++) {
        eShoot(b.x, b.y + b.r * 0.55, ang + k * 0.19, speed, "purple", 5 * SC);
      }
    } else if (b.pat === 1) {
      // 원형 탄막
      var n = ratio < 0.35 ? 22 : 16;
      var off = rnd(TAU);
      for (var i = 0; i < n; i++) {
        eShoot(b.x, b.y, off + (i * TAU) / n, speed * 0.72, "magenta", 4.6 * SC);
      }
    } else {
      // 3점사 조준
      var a2 = player && !player.dead ? Math.atan2(player.y - b.y, player.x - b.x) : Math.PI / 2;
      for (var j = 0; j < 3; j++) {
        (function (bb, bxx, byy, aa, idx) {
          after(idx * 0.13, function () {
            if (boss === bb && !bb.dying && game.state === "playing") {
              eShoot(bxx(), byy(), aa, speed * 1.18, "red", 5 * SC);
            }
          });
        })(b, function () { return b.x; }, function () { return b.y + b.r * 0.4; }, a2, j);
      }
    }

    var base = 2.0 - (1 - ratio) * 0.75;
    if (ratio < 0.35) base *= 0.72;
    b.fireCd = Math.max(0.5, base * rnd(0.9, 1.1));
  }

  function bossDie(b) {
    b.dying = true;
    b.flash = 0.1;
    addShake(24);
    flash = 0.6;
    flashColor = "200,140,255";
    SFX.bossDie();

    game.combo++;
    game.comboT = 3;
    var gain = addScore(b.score);
    floatText(b.x, b.y - b.r * 0.5, "+" + fmt(gain), "magenta", 18);
    syncHud();

    for (var k = 0; k < 11; k++) {
      (function (idx) {
        after(idx * 0.12, function () {
          if (!b) return;
          var ex = b.x + rnd(-b.r, b.r);
          var ey = b.y + rnd(-b.r * 0.7, b.r * 0.7);
          burst(ex, ey, idx % 3 === 0 ? "white" : "purple", 16, 340, 0.85, 6);
          rings.push({ x: ex, y: ey, r: 8 * SC, maxR: 80 * SC, life: 0.4, max: 0.4, color: "magenta", w: 2 });
          addShake(6);
          SFX.explode(idx % 4 === 0);
        });
      })(k);
    }

    after(1.55, function () {
      var bx = b.x, by = b.y, br = b.r;
      b.remove = true;
      boss = null;
      burst(bx, by, "white", 44, 560, 1.1, 8);
      rings.push({ x: bx, y: by, r: br, maxR: br * 5, life: 0.7, max: 0.7, color: "white", w: 4 });
      dropPickup(bx - 42 * SC, by);
      dropPickup(bx, by, "bomb");
      dropPickup(bx + 42 * SC, by);
      syncHud();
    });
  }

  /* =======================================================
     14. 탄 · 아이템
     ======================================================= */
  function updateBullets(dt) {
    for (var i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.y < -40 || b.y > H + 40 || b.x < -40 || b.x > W + 40) {
        bullets.splice(i, 1);
        continue;
      }
      for (var j = 0; j < enemies.length; j++) {
        var e = enemies[j];
        if (e.remove || e.dying) continue;
        var dx = b.x - e.x, dy = b.y - e.y;
        var rr = e.r * 0.92 + b.r;
        if (dx * dx + dy * dy < rr * rr) {
          hitEnemy(e, b.dmg, b.x, b.y);
          bullets.splice(i, 1);
          break;
        }
      }
    }
  }

  function updateEnemyBullets(dt) {
    var p = player;
    for (var i = ebullets.length - 1; i >= 0; i--) {
      var b = ebullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.t += dt;
      b.life -= dt;
      if (b.life <= 0 || b.y < -50 || b.y > H + 50 || b.x < -50 || b.x > W + 50) {
        ebullets.splice(i, 1);
        continue;
      }
      if (p && !p.dead && p.invuln <= 0) {
        var dx = b.x - p.x, dy = b.y - p.y;
        var rr = b.r + p.r;
        if (dx * dx + dy * dy < rr * rr) {
          burst(b.x, b.y, b.color, 7, 200, 0.4, 3.2);
          ebullets.splice(i, 1);
          damagePlayer();
        }
      }
    }
  }

  var PICK_INFO = {
    multi: { name: "멀티샷", key: "cyan" },
    rapid: { name: "스피드업", key: "green" },
    shield: { name: "실드", key: "blue" },
    bomb: { name: "필살기", key: "amber" }
  };

  function dropPickup(x, y, forceType) {
    var type = forceType;
    if (!type) {
      var roll = Math.random();
      type = roll < 0.32 ? "multi" : roll < 0.62 ? "rapid" : roll < 0.86 ? "shield" : "bomb";
    }
    pickups.push({
      x: clamp(x, 24 * SC, W - 24 * SC),
      y: y,
      vx: rnd(-60, 60) * SC,
      vy: rnd(-140, -40) * SC,
      type: type,
      t: 0,
      ph: rnd(TAU),
      remove: false
    });
  }

  function updatePickups(dt) {
    var p = player;
    for (var i = pickups.length - 1; i >= 0; i--) {
      var k = pickups[i];
      k.t += dt;

      if (p && !p.dead) {
        var dx = p.x - k.x, dy = p.y - k.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < 120 * SC) {
          k.vx += (dx / d) * 1500 * SC * dt;
          k.vy += (dy / d) * 1500 * SC * dt;
        }
      }

      k.vy += 120 * SC * dt;             // 약한 중력
      k.vx *= 1 - 1.6 * dt;
      k.vy *= 1 - 1.6 * dt;
      k.x += k.vx * dt + Math.sin(k.t * 2 + k.ph) * 8 * SC * dt;
      k.y += k.vy * dt;

      if (k.y > H + 40) { pickups.splice(i, 1); continue; }

      if (p && !p.dead && dist(k.x, k.y, p.x, p.y) < 24 * SC + p.r) {
        applyPickup(k);
        pickups.splice(i, 1);
      }
    }
  }

  function applyPickup(k) {
    var p = player;
    var info = PICK_INFO[k.type];
    if (!p) return;
    if (k.type === "multi") p.multi = 15;
    else if (k.type === "rapid") p.rapid = 15;
    else if (k.type === "shield") p.shield = 1;
    else if (k.type === "bomb") p.bombs = Math.min(3, p.bombs + 1);

    burst(k.x, k.y, info.key, 16, 260, 0.55, 4);
    rings.push({ x: k.x, y: k.y, r: 6 * SC, maxR: 46 * SC, life: 0.35, max: 0.35, color: info.key, w: 2 });
    floatText(p.x, p.y - 38 * SC, info.name + "!", info.key, 13);
    SFX.pickup();
    syncHud();
  }

  /* =======================================================
     15. 파티클 · 링 · 텍스트
     ======================================================= */
  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      var dragF = Math.exp(-p.drag * dt);
      p.vx *= dragF;
      p.vy *= dragF;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function updateRings(dt) {
    for (var i = rings.length - 1; i >= 0; i--) {
      var r = rings[i];
      r.life -= dt;
      if (r.life <= 0) { rings.splice(i, 1); continue; }
      var k = 1 - r.life / r.max;
      r.cur = r.r + (r.maxR - r.r) * (1 - Math.pow(1 - k, 2));
    }
  }

  function updateTexts(dt) {
    for (var i = texts.length - 1; i >= 0; i--) {
      var t = texts[i];
      t.life -= dt;
      t.y -= 34 * dt;
      if (t.life <= 0) texts.splice(i, 1);
    }
  }

  /* =======================================================
     16. 렌더링
     ======================================================= */
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var sx = 0, sy = 0;
    if (shake > 0.4) {
      sx = rnd(-shake, shake);
      sy = rnd(-shake, shake);
    }

    ctx.save();
    ctx.translate(sx, sy);

    if (bgCanvas) ctx.drawImage(bgCanvas, -12, -12, W + 24, H + 24);
    else { ctx.fillStyle = "#05010f"; ctx.fillRect(-12, -12, W + 24, H + 24); }

    drawStars();
    drawRings();
    drawPickups();
    drawEnemies();
    drawBullets();
    drawEnemyBullets();
    drawPlayer();
    drawParticles();
    drawTexts();

    ctx.restore();

    drawBanner();
    drawFx();
  }

  function drawStars() {
    var speed = starSpeed;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.5 + 0.5 * Math.abs(Math.sin(s.tw + T * s.tws));
      var size = s.r * (0.45 + s.z * 0.9);
      var a = (0.16 + s.z * 0.62) * tw;
      ctx.fillStyle = "rgba(" + (196 + Math.round(50 * s.z)) + ",228,255," + a.toFixed(3) + ")";
      var len = speed > 0.8 && s.z > 0.72 ? size * (2 + s.z * 4) : size;
      ctx.fillRect(s.x, s.y, size, len);
    }
  }

  // shadowBlur 는 iOS 에서 비싸므로, 넓은 반투명 스트로크 + 얇은 본선으로 네온을 흉내낸다.
  function neonStroke(key, w, a) {
    var al = a === undefined ? 1 : a;
    ctx.strokeStyle = col(key, 0.14 * al);
    ctx.lineWidth = w * 3.4;
    ctx.stroke();
    ctx.strokeStyle = col(key, 0.9 * al);
    ctx.lineWidth = w;
    ctx.stroke();
  }

  function drawRings() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      var k = clamp(r.life / r.max, 0, 1);
      ctx.globalAlpha = k * 0.85;
      ctx.strokeStyle = col(r.color, 0.9);
      ctx.lineWidth = Math.max(0.6, r.w * k);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.cur || r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPickups() {
    for (var i = 0; i < pickups.length; i++) {
      var k = pickups[i];
      var info = PICK_INFO[k.type];
      var bob = Math.sin(k.t * 6) * 2 * SC;
      var r = 13 * SC;

      ctx.save();
      ctx.translate(k.x, k.y + bob);

      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(k.t * 8);
      var gs = r * 4;
      ctx.drawImage(spr(info.key), -gs / 2, -gs / 2, gs, gs);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fillStyle = "rgba(6,10,24,0.82)";
      ctx.fill();
      neonStroke(info.key, 2 * SC, 1);

      ctx.fillStyle = col(info.key, 1);
      ctx.font = "800 " + (13 * SC).toFixed(1) + "px " + FONT_MONO;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(k.type === "multi" ? "M" : k.type === "rapid" ? "S" : k.type === "shield" ? "D" : "B", 0, 1 * SC);
      ctx.restore();
    }
  }

  function drawBullets() {
    var i, b, g = spr("cyan");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < bullets.length; i++) {
      b = bullets[i];
      var w = b.r * 8;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(g, b.x - w / 2, b.y - w / 2, w, w);
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#ffffff";
    for (i = 0; i < bullets.length; i++) {
      b = bullets[i];
      ctx.fillRect(b.x - b.r * 0.45, b.y - b.r * 2.6, b.r * 0.9, b.r * 5.2);
    }
    ctx.restore();
  }

  function drawEnemyBullets() {
    var i, b, g;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < ebullets.length; i++) {
      b = ebullets[i];
      g = spr(b.color);
      var w = b.r * 7;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(g, b.x - w / 2, b.y - w / 2, w, w);
    }
    ctx.restore();

    ctx.save();
    for (i = 0; i < ebullets.length; i++) {
      b = ebullets[i];
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.8, 0, TAU);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.25, 0, TAU);
      ctx.strokeStyle = col(b.color, 0.55);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer() {
    var p = player;
    if (!p || p.dead) return;

    var flick = p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0;
    var r = p.r * 1.35;

    ctx.save();
    ctx.globalAlpha = flick ? 0.4 : 1;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.tilt * 0.5);

    // 엔진 화염
    ctx.globalCompositeOperation = "lighter";
    var fl = (16 + Math.sin(T * 45) * 4) * SC;
    ctx.globalAlpha *= 0.9;
    ctx.drawImage(spr("cyan"), -r * 0.42, r * 0.45, r * 0.84, fl * 1.6);
    ctx.globalAlpha = flick ? 0.4 : 1;
    ctx.globalCompositeOperation = "source-over";

    // 선체
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.35);
    ctx.lineTo(r * 0.58, -r * 0.12);
    ctx.lineTo(r * 0.98, r * 0.55);
    ctx.lineTo(r * 0.34, r * 0.34);
    ctx.lineTo(0, r * 0.78);
    ctx.lineTo(-r * 0.34, r * 0.34);
    ctx.lineTo(-r * 0.98, r * 0.55);
    ctx.lineTo(-r * 0.58, -r * 0.12);
    ctx.closePath();

    var grd = ctx.createLinearGradient(0, -r, 0, r);
    grd.addColorStop(0, "#f2feff");
    grd.addColorStop(0.35, "#42e2ff");
    grd.addColorStop(0.75, "#1a7ea8");
    grd.addColorStop(1, "#0a2f4a");
    ctx.fillStyle = grd;
    ctx.fill();
    neonStroke("cyan", 1.8 * SC, 1);

    // 콕핏
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.3, r * 0.2, r * 0.42, 0, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();

    ctx.restore();

    // 실드 링
    if (p.shield > 0) {
      ctx.save();
      var pulse = 1 + Math.sin(T * 6) * 0.05;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(T * 6);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 2.0 * pulse, 0, TAU);
      ctx.strokeStyle = col("cyan", 0.85);
      ctx.lineWidth = 2 * SC;
      ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = col("cyan", 0.4);
      ctx.fill();
      ctx.restore();
    }

    // 멀티샷 / 스피드업 표시
    if (p.multi > 0 || p.rapid > 0) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.textAlign = "center";
      ctx.font = "700 " + (9 * SC).toFixed(1) + "px " + FONT_MONO;
      var label = p.multi > 0 && p.rapid > 0 ? "MULTI+SPD" : p.multi > 0 ? "MULTI" : "SPEED";
      ctx.fillStyle = p.multi > 0 && p.rapid > 0 ? col("amber", 0.9) : p.multi > 0 ? col("cyan", 0.9) : col("green", 0.9);
      ctx.fillText(label, p.x, p.y + p.r * 3.2);
      ctx.restore();
    }
  }

  function drawEnemies() {
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.remove) continue;
      if (e.type === "boss") drawBoss(e);
      else if (e.type === "scout") drawScout(e);
      else if (e.type === "dart") drawDart(e);
      else drawHeavy(e);
    }
  }

  function drawScout(e) {
    var r = e.r;
    var hurt = e.flash > 0;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.sin(e.t * 1.7 + e.phase) * 0.13);

    ctx.beginPath();
    ctx.moveTo(0, r * 1.05);
    ctx.lineTo(r * 0.92, -r * 0.15);
    ctx.lineTo(r * 0.42, -r * 0.95);
    ctx.lineTo(0, -r * 0.35);
    ctx.lineTo(-r * 0.42, -r * 0.95);
    ctx.lineTo(-r * 0.92, -r * 0.15);
    ctx.closePath();
    ctx.fillStyle = hurt ? "rgba(255,255,255,0.95)" : "rgba(58,8,48,0.9)";
    ctx.fill();
    neonStroke(hurt ? "white" : "magenta", 1.8 * SC, 1);

    if (!hurt) {
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(spr("magenta"), -r * 0.85, -r * 0.93, r * 1.7, r * 1.7);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.beginPath();
    ctx.arc(0, -r * 0.08, r * 0.19, 0, TAU);
    ctx.fillStyle = hurt ? "#ffffff" : "#ffd6f2";
    ctx.fill();
    ctx.restore();
  }

  function drawDart(e) {
    var r = e.r;
    var hurt = e.flash > 0;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.rot || 0);

    // 날개
    ctx.beginPath();
    ctx.moveTo(0, r * 1.25);
    ctx.lineTo(r * 0.72, -r * 0.2);
    ctx.lineTo(r * 0.26, -r * 0.95);
    ctx.lineTo(-r * 0.26, -r * 0.95);
    ctx.lineTo(-r * 0.72, -r * 0.2);
    ctx.closePath();
    ctx.fillStyle = hurt ? "rgba(255,255,255,0.95)" : "rgba(52,30,4,0.92)";
    ctx.fill();
    neonStroke(hurt ? "white" : "amber", 1.8 * SC, 1);

    ctx.beginPath();
    ctx.moveTo(0, r * 0.85);
    ctx.lineTo(0, -r * 0.6);
    ctx.strokeStyle = hurt ? "#ffffff" : col("amber", 0.55);
    ctx.lineWidth = 1.4 * SC;
    ctx.stroke();

    if (!hurt) {
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(spr("amber"), -r * 0.8, -r * 0.95, r * 1.6, r * 1.6);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.beginPath();
    ctx.arc(0, -r * 0.15, r * 0.17, 0, TAU);
    ctx.fillStyle = hurt ? "#ffffff" : "#fff0c9";
    ctx.fill();
    ctx.restore();
  }

  function drawHeavy(e) {
    var r = e.r;
    var hurt = e.flash > 0;
    var hr = clamp(e.hp / e.maxHp, 0, 1);

    ctx.save();
    ctx.translate(e.x, e.y);

    // 장갑 육각
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = -Math.PI / 2 + (i * TAU) / 6;
      var px = Math.cos(a) * r;
      var py = Math.sin(a) * r * 0.95;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    var grd = ctx.createLinearGradient(0, -r, 0, r);
    grd.addColorStop(0, hurt ? "#ffffff" : "#3a0c18");
    grd.addColorStop(0.55, hurt ? "#ffd9df" : "#1b050d");
    grd.addColorStop(1, hurt ? "#ffffff" : "#4a1020");
    ctx.fillStyle = grd;
    ctx.fill();
    neonStroke(hurt ? "white" : "red", 2.4 * SC, 1);

    // 회전 내부 링
    ctx.save();
    ctx.rotate(e.rot || 0);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.66, 0.3, 0.3 + TAU * 0.7);
    ctx.strokeStyle = hurt ? "#ffffff" : col("red", 0.6);
    ctx.lineWidth = 2 * SC;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.66, Math.PI + 0.3, Math.PI + 0.3 + TAU * 0.5);
    ctx.stroke();
    ctx.restore();

    // 코어
    if (!hurt) {
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(spr("red"), -r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, TAU);
    ctx.fillStyle = hurt ? "#ffffff" : "rgba(255," + Math.round(60 + 150 * hr) + "," + Math.round(70 + 60 * hr) + ",0.95)";
    ctx.fill();
    ctx.restore();
  }

  function drawBoss(b) {
    var r = b.r;
    var hurt = b.flash > 0;
    var ratio = clamp(b.hp / b.maxHp, 0, 1);

    ctx.save();
    ctx.translate(b.x, b.y);

    // 후광
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.34 + 0.14 * Math.sin(b.t * 2.6);
    var gs = r * 5.4;
    ctx.drawImage(SPR.boss, -gs / 2, -gs / 2, gs, gs);
    ctx.restore();

    // 외곽 회전 링
    ctx.save();
    ctx.rotate(b.t * 0.55);
    ctx.strokeStyle = hurt ? "#ffffff" : col("magenta", 0.72);
    ctx.lineWidth = 2 * SC;
    ctx.setLineDash([r * 0.24, r * 0.18]);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.28, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 본체
    ctx.beginPath();
    ctx.moveTo(0, r * 0.98);
    ctx.lineTo(r * 0.52, r * 0.58);
    ctx.lineTo(r * 1.32, r * 0.16);
    ctx.lineTo(r * 1.5, -r * 0.38);
    ctx.lineTo(r * 0.78, -r * 0.78);
    ctx.lineTo(-r * 0.78, -r * 0.78);
    ctx.lineTo(-r * 1.5, -r * 0.38);
    ctx.lineTo(-r * 1.32, r * 0.16);
    ctx.lineTo(-r * 0.52, r * 0.58);
    ctx.closePath();
    var grd = ctx.createLinearGradient(0, -r, 0, r);
    grd.addColorStop(0, hurt ? "#ffffff" : "#2c1157");
    grd.addColorStop(0.5, hurt ? "#ffd8f6" : "#100628");
    grd.addColorStop(1, hurt ? "#ffffff" : "#3a1670");
    ctx.fillStyle = grd;
    ctx.fill();
    neonStroke(hurt ? "white" : "magenta", 2.4 * SC, 1);

    // 측면 포탑
    for (var s = -1; s <= 1; s += 2) {
      ctx.save();
      ctx.translate(s * r * 1.02, r * 0.12);
      ctx.beginPath();
      ctx.rect(-r * 0.16, -r * 0.1, r * 0.32, r * 0.62);
      ctx.fillStyle = hurt ? "#ffffff" : "rgba(12,4,26,0.95)";
      ctx.fill();
      ctx.lineWidth = 1.6 * SC;
      ctx.strokeStyle = hurt ? "#ffffff" : col("purple", 0.9);
      ctx.stroke();
      ctx.restore();
    }

    // 코어
    var pulse = 1 + Math.sin(b.t * 5.2) * 0.07;
    ctx.beginPath();
    ctx.arc(0, r * 0.05, r * 0.44 * pulse, 0, TAU);
    var cg = ctx.createRadialGradient(0, r * 0.05, 0, 0, r * 0.05, r * 0.46 * pulse);
    cg.addColorStop(0, "#ffffff");
    cg.addColorStop(0.45, col("magenta", 0.95));
    cg.addColorStop(1, "rgba(120,20,200,0.15)");
    ctx.fillStyle = hurt ? "#ffffff" : cg;
    ctx.shadowColor = col("magenta", 1);
    ctx.shadowBlur = 26 * SC;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(0, r * 0.05, r * 0.6, 0, TAU);
    ctx.strokeStyle = "rgba(255,255,255," + (0.35 + 0.35 * ratio) + ")";
    ctx.lineWidth = 1.4 * SC;
    ctx.stroke();

    ctx.restore();
  }

  function drawParticles() {
    if (!particles.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var k = clamp(p.life / p.max, 0, 1);
      var s = p.size * (0.35 + k * 1.05);
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.drawImage(p.spr, p.x - s, p.y - s, s * 2, s * 2);
    }
    ctx.restore();
  }

  function drawTexts() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      var k = clamp(t.life / t.max, 0, 1);
      ctx.globalAlpha = k;
      ctx.font = "800 " + (t.size * SC).toFixed(1) + "px " + FONT;
      ctx.fillStyle = col(t.color, 1);
      ctx.shadowColor = col(t.color, 0.9);
      ctx.shadowBlur = 12 * SC;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }

  var FONT = '"Pretendard", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  var FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  function drawBanner() {
    var b = game.banner;
    if (!b) return;
    var k = 1 - b.t / b.dur;
    var a = Math.min(1, k * 7) * Math.min(1, b.t * 2.4);
    var scale = 1 + (1 - Math.min(1, k * 4)) * 0.16;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, H * 0.34);
    ctx.scale(scale, scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "900 " + (30 * SC).toFixed(1) + "px " + FONT;
    ctx.fillStyle = "#f4feff";
    ctx.shadowColor = col(b.color, 0.95);
    ctx.shadowBlur = 26 * SC;
    ctx.fillText(b.text, 0, 0);

    if (b.sub) {
      ctx.shadowBlur = 10 * SC;
      ctx.font = "700 " + (12.5 * SC).toFixed(1) + "px " + FONT;
      ctx.fillStyle = "rgba(215,235,255,0.82)";
      ctx.fillText(b.sub, 0, 27 * SC);
    }
    ctx.restore();
  }

  function drawFx() {
    if (flash > 0.001) {
      ctx.save();
      ctx.fillStyle = "rgba(" + flashColor + "," + (flash * 0.42).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // 위험 상태(체력 1) 경고 비네트
    if (player && !player.dead && player.hp === 1 && game.state === "playing") {
      var a = 0.1 + 0.07 * Math.sin(T * 6.5);
      var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
      g.addColorStop(0, "rgba(255,20,60,0)");
      g.addColorStop(1, "rgba(255,20,60," + a.toFixed(3) + ")");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* =======================================================
     17. HUD 동기화
     ======================================================= */
  var last = { score: -1, best: -1, wave: -1, hp: -1, shield: -1, bombs: -1, combo: -1, bossPct: -1, bossHp: -1 };

  function syncHud() {
    if (!player) return;

    if (game.score !== last.score) {
      last.score = game.score;
      ui.score.textContent = fmt(game.score);
    }
    if (game.best !== last.best) {
      last.best = game.best;
      ui.best.textContent = fmt(game.best);
    }
    if (game.wave !== last.wave) {
      last.wave = game.wave;
      ui.wave.textContent = String(game.wave);
    }
    if (player.hp !== last.hp || player.shield !== last.shield) {
      last.hp = player.hp;
      last.shield = player.shield;
      var html = "";
      for (var i = 0; i < player.maxHp; i++) {
        html += '<i class="heart' + (i < player.hp ? "" : " off") + '">♥</i>';
      }
      if (player.shield > 0) html += '<i class="heart shield">◈</i>';
      ui.hearts.innerHTML = html;
    }
    if (player.bombs !== last.bombs) {
      last.bombs = player.bombs;
      ui.bombs.textContent = String(player.bombs);
      ui.bombBtn.classList.toggle("off", player.bombs <= 0);
    }
    var cm = game.combo >= 10 ? comboMult() : 0;
    if (cm !== last.combo) {
      last.combo = cm;
      ui.combo.textContent = cm ? "COMBO x" + cm : "";
      ui.combo.classList.toggle("on", cm > 0);
    }

    var b = boss;
    if (!b || b.entering || b.dying || game.state !== "playing") {
      if (last.bossPct !== -1) {
        last.bossPct = -1;
        ui.bossBar.classList.add("hidden");
      }
    } else {
      ui.bossBar.classList.remove("hidden");
      var pct = Math.round(clamp(b.hp / b.maxHp, 0, 1) * 1000) / 10;
      if (pct !== last.bossPct) {
        last.bossPct = pct;
        ui.bossFill.style.width = pct + "%";
      }
      var hpTxt = Math.max(0, Math.ceil(b.hp)) + " / " + b.maxHp;
      if (hpTxt !== last.bossHp) {
        last.bossHp = hpTxt;
        ui.bossHp.textContent = hpTxt;
      }
    }
  }

  /* =======================================================
     18. 화면 전환 · 게임 흐름
     ======================================================= */
  function showScreen(name) {
    for (var k in ui.screens) {
      if (!ui.screens.hasOwnProperty(k)) continue;
      ui.screens[k].classList.toggle("hidden", k !== name);
    }
    ui.hud.classList.toggle("hud-hidden", name === "start");

    if (name === "start") {
      ui.startBest.textContent = fmt(game.best);
    } else if (name === "pause") {
      ui.pauseScore.textContent = fmt(game.score);
      ui.pauseWave.textContent = String(game.wave);
    } else if (name === "over") {
      ui.overScore.textContent = fmt(game.score);
      ui.overBest.textContent = fmt(game.best);
      ui.overWave.textContent = String(Math.max(1, game.wave));
      ui.newRecord.classList.toggle("hidden", !game.bestNew);
    }
  }

  function hideScreens() {
    for (var k in ui.screens) {
      if (!ui.screens.hasOwnProperty(k)) continue;
      ui.screens[k].classList.add("hidden");
    }
    ui.hud.classList.remove("hud-hidden");
  }

  function resetWorld() {
    bullets.length = 0;
    ebullets.length = 0;
    enemies.length = 0;
    pickups.length = 0;
    particles.length = 0;
    rings.length = 0;
    texts.length = 0;
    timers.length = 0;
    boss = null;
    shake = 0;
    flash = 0;
    game.combo = 0;
    game.comboT = 0;
    starSpeed = 1;
    player = makePlayer();
  }

  function startGame() {
    SFX.unlock();
    resetWorld();
    game.score = 0;
    game.bestNew = false;
    game.banner = null;
    game.state = "playing";
    last.score = -1;
    last.wave = -1;
    last.combo = -1;
    last.hp = -1;
    last.bombs = -1;
    hideScreens();
    syncHud();
    startWave(1);
  }

  function pauseGame() {
    if (game.state !== "playing") return;
    game.state = "paused";
    starSpeed = 0.15;
    showScreen("pause");
  }

  function resumeGame() {
    if (game.state !== "paused") return;
    game.state = "playing";
    starSpeed = 1;
    hideScreens();
    rafLast = 0;
  }

  function goMenu() {
    game.state = "menu";
    game.banner = null;
    starSpeed = 0.45;
    player = null;
    bullets.length = 0;
    ebullets.length = 0;
    enemies.length = 0;
    pickups.length = 0;
    particles.length = 0;
    rings.length = 0;
    texts.length = 0;
    timers.length = 0;
    boss = null;
    flash = 0;
    shake = 0;
    showScreen("start");
    ui.bossBar.classList.add("hidden");
    last.bossPct = -1;
  }

  function gameOver() {
    var p = player;
    if (!p) return;
    p.dead = true;
    game.state = "over";
    starSpeed = 0.55;
    burst(p.x, p.y, "cyan", 40, 440, 1.1, 7);
    burst(p.x, p.y, "white", 20, 260, 0.9, 5);
    rings.push({ x: p.x, y: p.y, r: 8 * SC, maxR: 200 * SC, life: 0.8, max: 0.8, color: "cyan", w: 4 });
    addShake(20);
    flash = 0.65;
    flashColor = "255,90,120";
    SFX.gameover();

    game.bestNew = game.score > game.best;
    if (game.bestNew) {
      game.best = game.score;
      saveNum(KEY_BEST, game.best);
    }
    syncHud();
    ui.bossBar.classList.add("hidden");
    last.bossPct = -1;

    after(0.85, function () {
      if (game.state === "over") showScreen("over");
    });
  }

  /* =======================================================
     19. 입력
     ======================================================= */
  function pointerWorld(e) {
    var rect = cv.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function setTarget(x, y, isTouch) {
    if (!player) return;
    var lift = isTouch ? Math.min(112, H * 0.135) : 0;
    player.tx = clamp(x, BOUND.l, BOUND.r);
    player.ty = clamp(y - lift, BOUND.t, BOUND.b);
  }

  function bindInput() {
    cv.addEventListener("pointerdown", function (e) {
      SFX.unlock();
      if (game.state !== "playing") return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      activePointer = e.pointerId;
      var w = pointerWorld(e);
      setTarget(w.x, w.y, e.pointerType !== "mouse");
      if (cv.setPointerCapture) {
        try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      }
      e.preventDefault();
    }, { passive: false });

    cv.addEventListener("pointermove", function (e) {
      if (game.state !== "playing") return;
      if (e.pointerType === "mouse") {
        var w = pointerWorld(e);
        setTarget(w.x, w.y, false);
      } else if (activePointer === e.pointerId) {
        var w2 = pointerWorld(e);
        setTarget(w2.x, w2.y, true);
        e.preventDefault();
      }
    }, { passive: false });

    function endPointer(e) {
      if (activePointer === e.pointerId) activePointer = null;
    }
    cv.addEventListener("pointerup", endPointer);
    cv.addEventListener("pointercancel", endPointer);

    // iOS: 스크롤/확대/롱프레스 차단
    cv.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
    cv.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
    document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    window.addEventListener("keydown", function (e) {
      SFX.unlock();
      var k = e.key || "";
      var lower = k.toLowerCase();

      if (k === " " || k === "Spacebar" || e.code === "Space") {
        e.preventDefault();
        if (game.state === "playing") useBomb();
        else if (game.state === "paused") resumeGame();
      }
      if (lower === "p" || k === "Escape") {
        if (game.state === "playing") pauseGame();
        else if (game.state === "paused") resumeGame();
      }
      if (k === "Enter") {
        if (game.state === "menu" || game.state === "over") startGame();
        else if (game.state === "paused") resumeGame();
      }
      if (lower === "m") toggleMute();
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") e.preventDefault();

      keys[lower] = true;
      keys[e.code] = true;
    });

    window.addEventListener("keyup", function (e) {
      var k = e.key || "";
      keys[k.toLowerCase()] = false;
      keys[e.code] = false;
    });

    window.addEventListener("blur", function () {
      keys = {};
      if (game.state === "playing") pauseGame();
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden && game.state === "playing") pauseGame();
    });

    var resizeTimer = 0;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { resize(); }, 120);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onResize);
    }

    ui.bombBtn.addEventListener("click", function (e) {
      e.preventDefault();
      useBomb();
    });
    ui.muteBtn.addEventListener("click", function (e) {
      e.preventDefault();
      toggleMute();
    });
    $("btn-pause").addEventListener("click", function (e) {
      e.preventDefault();
      pauseGame();
    });
    $("btn-start").addEventListener("click", function (e) { e.preventDefault(); startGame(); });
    $("btn-resume").addEventListener("click", function (e) { e.preventDefault(); resumeGame(); });
    $("btn-restart").addEventListener("click", function (e) { e.preventDefault(); startGame(); });
    $("btn-again").addEventListener("click", function (e) { e.preventDefault(); startGame(); });
    $("btn-menu").addEventListener("click", function (e) { e.preventDefault(); goMenu(); });
  }

  function updateKeys(dt) {
    if (!player) return;
    var kx = 0, ky = 0;
    if (keys["arrowleft"] || keys["a"] || keys["KeyA"]) kx -= 1;
    if (keys["arrowright"] || keys["d"] || keys["KeyD"]) kx += 1;
    if (keys["arrowup"] || keys["w"] || keys["KeyW"]) ky -= 1;
    if (keys["arrowdown"] || keys["s"] || keys["KeyS"]) ky += 1;
    if (kx || ky) {
      var sp = 460 * SC * dt;
      player.tx = clamp(player.tx + kx * sp, BOUND.l, BOUND.r);
      player.ty = clamp(player.ty + ky * sp, BOUND.t, BOUND.b);
    }
  }

  function toggleMute() {
    game.muted = !game.muted;
    SFX.setMuted(game.muted);
    saveNum(KEY_MUTE, game.muted ? 1 : 0);
    updateMuteIcon();
    if (!game.muted) {
      SFX.unlock();
      SFX.pickup();
    }
  }

  function updateMuteIcon() {
    ui.muteIcon.textContent = game.muted ? "🔇" : "🔊";
    ui.muteBtn.classList.toggle("muted", game.muted);
    ui.muteBtn.setAttribute("aria-label", game.muted ? "소리 켜기" : "소리 끄기");
  }

  /* =======================================================
     20. 메인 루프
     ======================================================= */
  var rafLast = 0;

  function update(dt) {
    T += dt;

    if (game.state === "playing") {
      updateKeys(dt);
      updatePlayer(dt);
      updateBullets(dt);
      updateEnemyBullets(dt);
      updateWaves(dt);
      updateEnemies(dt);
      updatePickups(dt);
      updateTimers(dt);
      updateBanner(dt);
      syncHud();

      if (game.comboT > 0) {
        game.comboT -= dt;
        if (game.comboT <= 0) {
          game.combo = 0;
          syncHud();
        }
      }
    } else if (game.state === "over") {
      updateTimers(dt);
      updateBanner(dt);
    }

    if (game.state !== "paused") {
      updateParticles(dt);
      updateRings(dt);
      updateTexts(dt);
    }

    // 별 (상태별 속도)
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y += (16 + 105 * s.z) * dt * starSpeed;
      if (s.y > H + 6) {
        s.y = -6;
        s.x = rnd(W);
      }
    }

    shake = Math.max(0, shake - dt * 48);
    flash = Math.max(0, flash - dt * 2.4);
  }

  function frame(ts) {
    window.requestAnimationFrame(frame);
    if (!rafLast) rafLast = ts;
    var dt = (ts - rafLast) / 1000;
    rafLast = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;      // 프레임 튐 방지
    update(dt);
    render();
  }

  /* =======================================================
     21. 부팅
     ======================================================= */
  function boot() {
    resize();
    initSprites();
    bindInput();
    SFX.setMuted(game.muted);
    updateMuteIcon();
    game.state = "menu";
    showScreen("start");
    syncHud();
    window.addEventListener("pointerdown", function once() {
      SFX.unlock();
      window.removeEventListener("pointerdown", once);
    }, { passive: true });
    window.requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
