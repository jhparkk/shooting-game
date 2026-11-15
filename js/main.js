/* =========================================================
   ABYSS DIVER — 3D 자유 유영 심해 탐험 슈팅
   Three.js 기반, 빌드 없이 단일 페이지로 실행
   ========================================================= */
import * as THREE from 'three';
import { Sound } from './audio.js?v=20261116g';
import { World, ZONES, SURFACE_Y, DEPTH_SCALE, terrainHeight, zoneIndexForDepth } from './world.js?v=20261116g';
import {
  makeSubmarine, makeShark, makeHammerhead, makePuffer, makeLionfish,
  makeAnglerfish, makeJellyfish, makeKraken, spriteGlow, swim, ANIM,
  makeHumpbackWhale, makeBlueWhale, makeOrca, makeSpermWhale,
  makeMantaRay, makeEagleRay, makeStingray, makeTurtle,
} from './models.js?v=20261116g';
import { FX } from './fx.js?v=20261116g';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

const BEST_KEY = 'abyss-diver-best';
// 산호 언덕 위에서 시작 — 앞쪽으로 해저 협곡이 깊게 떨어진다
const START_POS = new THREE.Vector3(-20, terrainHeight(-20, 60) + 7, 60);

/* ---------------- 내구력 · 충돌 · 수압 밸런스 ---------------- */
const BASE_MAX_HULL = 100;       // 기본 최대 내구력
const SUB_R = 1.7;               // 잠수정 충돌 반경
const REGEN_DELAY = 3;           // 마지막 피격 후 회복 시작까지 (초)
const REGEN_RATE = 5.5;          // 초당 회복량
const REGEN_FADE_FROM = 450;     // 이 수심까지는 정상 회복
const REGEN_FADE_TO = 950;       // 이 수심부터는 회복이 거의 멈춘다
const REGEN_FLOOR = 0.16;        // 심연에서 남는 회복 비율
const PRESSURE_START = 460;      // 수압이 내구력을 깎기 시작하는 수심(m)
const PRESSURE_FULL = 1300;      // 수압 감소가 최대가 되는 수심(m)
const PRESSURE_RATE_MIN = 0.45;  // 460m 에서 초당 감소량
const PRESSURE_RATE_MAX = 2.5;   // 1,300m 에서 초당 감소량
const DMG_CONTACT = 14;          // 적 생물 접촉
const DMG_SPIKE = 18;            // 복어·아귀 폭발
const DMG_ORB = 12;              // 크라켄 구체
const DMG_BOSS = 22;             // 크라켄 몸통 접촉
const MAX_HULL_CAP = 300;        // 선체 보강 반복 상한

/* ---------------- DOM ---------------- */
const canvas = $('game');
const el = {
  hud: $('hud'),
  score: $('hud-score'),
  best: $('hud-best'),
  depth: $('hud-depth-val'),
  zone: $('hud-zone'),
  dur: $('dur'),
  durFill: $('dur-fill'),
  durVal: $('dur-val'),
  durMax: $('dur-max'),
  durFlag: $('dur-flag'),
  shield: $('hud-shield'),
  shieldVal: $('shield-val'),
  powerups: $('powerups'),
  bombs: $('hud-bombs'),
  bombBtn: $('btn-bomb'),
  fireBtn: $('btn-fire'),
  upBtn: $('btn-up'),
  downBtn: $('btn-down'),
  joystick: $('joystick'),
  knob: $('joy-knob'),
  mute: $('btn-mute'),
  muteIcon: $('mute-icon'),
  pause: $('btn-pause'),
  bossBar: $('boss-bar'),
  bossFill: $('boss-bar-fill'),
  bossHp: $('boss-bar-hp'),
  reticle: $('reticle'),
  banner: $('notice-banner'),
  toast: $('toast'),
  flash: $('flash'),
  startScreen: $('screen-start'),
  pauseScreen: $('screen-pause'),
  overScreen: $('screen-over'),
  startBest: $('start-best'),
  overScore: $('over-score'),
  overBest: $('over-best'),
  overZone: $('over-zone'),
  overDepth: $('over-depth'),
  newRecord: $('new-record'),
  pauseScore: $('pause-score'),
  pauseDepth: $('pause-depth'),
  pauseZone: $('pause-zone'),
  loading: $('loading'),
  compass: $('hud-compass'),
  ribbon: $('compass-ribbon'),
  heading: $('hud-heading'),
  bearing: $('hud-bearing'),
};

const sound = new Sound();

/* ---------------- 상태 ---------------- */
const G = {
  state: 'menu',
  score: 0,
  best: 0,
  depth: 0,
  maxDepth: 0,
  hull: BASE_MAX_HULL,
  maxHull: BASE_MAX_HULL,
  sinceHit: 99,
  pressure: 0,
  regen: false,
  bumpCd: 0,
  shield: 0,
  bombs: 1,
  multi: 0,
  rapid: 0,
  invuln: 0,
  fireTimer: 0,
  spawnTimer: 1.6,
  pingTimer: 9,
  bubbleTimer: 0.2,
  krakenCd: 30,
  krakenSeen: false,
  shake: 0,
  elapsed: 0,
  flashTimer: 0,
  boss: null,
  zoneIndex: 0,
  lowFpsChecks: 0,
};

try {
  G.best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
} catch (e) {
  G.best = 0;
}

/* ---------------- 렌더러 ---------------- */
let renderer, scene, camera, world, fx, player;
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
const clock = new THREE.Clock();

const enemies = [];
const torpedoes = [];
const items = [];
const orbs = [];

/* ---------------- 플레이어 ---------------- */
const P = {
  pos: START_POS.clone(),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  roll: 0,
  speed: 32,
  backSpeed: 18,
  lift: 24,
  turnRate: 1.7,
  bob: 0,
  bobPhase: 0,
};

const forward = new THREE.Vector3();
const horizontal = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function computeForward(out) {
  const cy = Math.cos(P.yaw);
  const sy = Math.sin(P.yaw);
  const cp = Math.cos(P.pitch);
  const sp = Math.sin(P.pitch);
  return out.set(-sy * cp, sp, -cy * cp);
}

function computeHorizontal(out) {
  return out.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
}

/* ---------------- 입력 ---------------- */
const joy = { move: 0, turn: 0, lift: 0 };
const kb = { move: 0, turn: 0, lift: 0 };
const input = { move: 0, turn: 0, lift: 0, fire: false };
const keys = new Set();
const joyState = { active: false, id: null, cx: 0, cy: 0, radius: 60 };
let fireKeyHeld = false;
let btnFiring = false;
let mouseFiring = false;

/* ---------------- 초기화 ---------------- */
function initThree() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.2, 520);
  camera.position.set(0, 9, 78);

  world = new World(scene);
  fx = new FX(scene);

  const sub = makeSubmarine();
  sub.group.rotation.order = 'YXZ';
  scene.add(sub.group);
  player = {
    obj: sub.group,
    prop: sub.propeller,
    spot: sub.spot,
    beam: sub.beam,
    frontLight: sub.frontLight,
    under: sub.under,
  };
  P.pos.copy(START_POS);
  updateSubTransform(0);

  buildPools();
  bindTouchGuards();
  bindInput();
  bindButtons();
  buildCompass();
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.state === 'playing') togglePause(true);
  });
}

/* ---------------- 풀 ---------------- */
let torpGeo, torpMat, itemGeos, itemMats, itemHalo, orbGeo, orbMat;

function buildPools() {
  torpGeo = new THREE.CapsuleGeometry(0.16, 0.6, 3, 8);
  torpGeo.rotateX(Math.PI / 2);
  torpMat = new THREE.MeshBasicMaterial({ color: 0xd8feff });

  for (let i = 0; i < 28; i++) {
    const m = new THREE.Mesh(torpGeo, torpMat);
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    torpedoes.push({ mesh: m, vel: new THREE.Vector3(), life: 0, active: false });
  }

  itemGeos = {
    multi: new THREE.OctahedronGeometry(0.62, 0),
    rapid: new THREE.TetrahedronGeometry(0.66, 0),
    shield: new THREE.IcosahedronGeometry(0.62, 0),
    bomb: new THREE.DodecahedronGeometry(0.62, 0),
    hull: new THREE.TorusGeometry(0.52, 0.19, 8, 18),          // 선체 보강 모듈
    repair: new THREE.BoxGeometry(0.82, 0.82, 0.82),           // 긴급 수리 키트
  };
  itemMats = {
    multi: new THREE.MeshBasicMaterial({ color: 0xff8fb4 }),
    rapid: new THREE.MeshBasicMaterial({ color: 0x8fe4ff }),
    shield: new THREE.MeshBasicMaterial({ color: 0xa8b8ff }),
    bomb: new THREE.MeshBasicMaterial({ color: 0xffce6b }),
    hull: new THREE.MeshBasicMaterial({ color: 0x6dffcf }),
    repair: new THREE.MeshBasicMaterial({ color: 0xa9ff8c }),
  };
  itemHalo = {
    multi: 0xff8fb4, rapid: 0x8fe4ff, shield: 0xa8b8ff,
    bomb: 0xffce6b, hull: 0x6dffcf, repair: 0xa9ff8c,
  };

  orbGeo = new THREE.SphereGeometry(0.5, 10, 8);
  orbMat = new THREE.MeshBasicMaterial({ color: 0xff9d6b });
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(orbGeo, orbMat);
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    orbs.push({ mesh: m, vel: new THREE.Vector3(), life: 0, active: false });
  }
}

/* ---------------- iOS 사파리 확대 차단 (게임 조작 영역) ---------------- */
/* 문서·창 수준의 가드(제스처·핀치·더블탭·휠)는 js/zoom-guard.js 가 먼저 설치한다.
   여기서는 게임 화면·HUD·조이스틱에서 한 손가락 터치의 기본 동작(스크롤·선택·콜아웃)을
   막아, 조이스틱을 끄는 동안 화면이 밀리거나 확대되지 않게 한다.
   클릭으로 동작하는 버튼은 건드리지 않는다. */
function bindTouchGuards() {
  const CLICKABLE = 'button, a, input, select, textarea, label, .screen';
  const skip = (t) => !!(t && t.closest && t.closest(CLICKABLE));
  const hold = (e) => {
    if (e.cancelable !== false) e.preventDefault();
  };
  function guard(e) {
    if (!e.touches || e.touches.length > 1) { hold(e); return; } // 두 손가락 = 핀치 줌
    if (skip(e.target)) return;                                   // 버튼 클릭은 그대로
    hold(e);
  }
  [canvas, el.hud, el.joystick].forEach((node) => {
    if (!node) return;
    node.addEventListener('touchstart', guard, { passive: false });
    node.addEventListener('touchmove', guard, { passive: false });
  });
}

/* ---------------- 입력 바인딩 ---------------- */
function bindInput() {
  /* --- 조이스틱 --- */
  const base = el.joystick.querySelector('.joy-base');

  function joyStart(e) {
    if (joyState.active) return;
    e.preventDefault();
    joyState.active = true;
    joyState.id = e.pointerId;
    const rect = base.getBoundingClientRect();
    joyState.cx = rect.left + rect.width / 2;
    joyState.cy = rect.top + rect.height / 2;
    joyState.radius = rect.width * 0.42;
    try { base.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    joyMove(e);
  }
  function joyMove(e) {
    if (!joyState.active || e.pointerId !== joyState.id) return;
    e.preventDefault();
    let dx = e.clientX - joyState.cx;
    let dy = e.clientY - joyState.cy;
    const r = joyState.radius;
    const len = Math.hypot(dx, dy);
    if (len > r) {
      dx = (dx / len) * r;
      dy = (dy / len) * r;
    }
    const nx = dx / r;
    const ny = dy / r;
    const dead = 0.13;
    joy.turn = Math.abs(nx) < dead ? 0 : (nx - Math.sign(nx) * dead) / (1 - dead);
    joy.move = Math.abs(ny) < dead ? 0 : -(ny - Math.sign(ny) * dead) / (1 - dead);
    el.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  }
  function joyEnd(e) {
    if (e && joyState.id !== null && e.pointerId !== joyState.id) return;
    joyState.active = false;
    joyState.id = null;
    joy.move = 0;
    joy.turn = 0;
    el.knob.style.transform = 'translate(0px, 0px)';
  }
  base.addEventListener('pointerdown', joyStart);
  base.addEventListener('pointermove', joyMove);
  base.addEventListener('pointerup', joyEnd);
  base.addEventListener('pointercancel', joyEnd);
  base.addEventListener('lostpointercapture', joyEnd);

  /* --- 누르고 있는 버튼 --- */
  function holdButton(node, onDown, onUp) {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      node.classList.add('held');
      try { node.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      onDown();
    });
    const up = () => {
      node.classList.remove('held');
      onUp();
    };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('lostpointercapture', up);
  }
  holdButton(el.fireBtn, () => { btnFiring = true; }, () => { btnFiring = false; });
  holdButton(el.upBtn, () => { joy.lift = 1; }, () => { if (joy.lift > 0) joy.lift = 0; });
  holdButton(el.downBtn, () => { joy.lift = -1; }, () => { if (joy.lift < 0) joy.lift = 0; });

  /* --- PC: 마우스 클릭 발사 --- */
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') mouseFiring = true;
  });
  window.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') mouseFiring = false;
  });

  /* --- 키보드 --- */
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'm') toggleMute();
    if (k === 'b') useBomb();
    if (k === 'p' || k === 'escape') {
      if (G.state === 'playing') togglePause(true);
      else if (G.state === 'paused') togglePause(false);
    }
    if (k === ' ' || k === 'spacebar') {
      e.preventDefault();
      fireKeyHeld = true;
    }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === ' ' || k === 'spacebar') fireKeyHeld = false;
  });
  window.addEventListener('blur', () => {
    keys.clear();
    fireKeyHeld = false;
    mouseFiring = false;
    btnFiring = false;
    joy.move = 0; joy.turn = 0; joy.lift = 0;
    if (G.state === 'playing') togglePause(true);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function updateInput() {
  kb.move = 0;
  kb.turn = 0;
  kb.lift = 0;
  if (keys.has('w') || keys.has('ㅈ') || keys.has('arrowup')) kb.move += 1;
  if (keys.has('s') || keys.has('ㄴ') || keys.has('arrowdown')) kb.move -= 1;
  if (keys.has('a') || keys.has('ㅁ') || keys.has('arrowleft')) kb.turn -= 1;
  if (keys.has('d') || keys.has('ㅇ') || keys.has('arrowright')) kb.turn += 1;
  if (keys.has('q') || keys.has('r') || keys.has('shift')) kb.lift += 1;
  if (keys.has('e') || keys.has('f')) kb.lift -= 1;

  input.move = clamp(joy.move + kb.move, -1, 1);
  input.turn = clamp(joy.turn + kb.turn, -1, 1);
  input.lift = clamp(joy.lift + kb.lift, -1, 1);
  input.fire = btnFiring || fireKeyHeld || mouseFiring;
}

/* ---------------- UI ---------------- */
function setText(node, value) {
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}

/* ---------------- 내구력 HUD · 수압 · 자동 회복 ---------------- */
let durShownWidth = -1;
let durShownCls = '';

function updateDurabilityHud() {
  if (!el.durFill) return;
  const k = clamp(G.hull / G.maxHull, 0, 1);
  const w = Math.round(k * 1000) / 10;
  if (w !== durShownWidth) {
    durShownWidth = w;
    el.durFill.style.width = w + '%';
  }
  setText(el.durVal, Math.ceil(G.hull - 0.001));
  setText(el.durMax, Math.round(G.maxHull));
  const cls = k <= 0.3 ? 'danger' : k <= 0.6 ? 'warn' : 'safe';
  const full = cls + (G.regen ? ' regen' : '');
  if (full !== durShownCls) {
    durShownCls = full;
    el.dur.classList.toggle('safe', cls === 'safe');
    el.dur.classList.toggle('warn', cls === 'warn');
    el.dur.classList.toggle('danger', cls === 'danger');
    el.dur.classList.toggle('regen', !!G.regen);
    el.dur.setAttribute('aria-valuenow', String(Math.round(G.hull)));
    el.dur.setAttribute('aria-valuemax', String(Math.round(G.maxHull)));
  }
  if (el.durFlag) {
    const show = G.pressure > 0 && G.state === 'playing';
    if (el.durFlag.classList.contains('hidden') === show) el.durFlag.classList.toggle('hidden', !show);
  }
}

/** 수심별 수압 감소량 (내구력/초) — 1,000m 언저리는 완만하고 심연으로 갈수록 급해진다 */
function pressureRateAt(depth) {
  if (depth < PRESSURE_START) return 0;
  const t = clamp((depth - PRESSURE_START) / (PRESSURE_FULL - PRESSURE_START), 0, 1);
  return PRESSURE_RATE_MIN + (PRESSURE_RATE_MAX - PRESSURE_RATE_MIN) * Math.pow(t, 1.8);
}

/** 수심별 자동 회복 배율 — 450m 까지는 정상, 심연으로 갈수록 줄어든다 */
function regenScaleAt(depth) {
  if (depth <= REGEN_FADE_FROM) return 1;
  const t = clamp((depth - REGEN_FADE_FROM) / (REGEN_FADE_TO - REGEN_FADE_FROM), 0, 1);
  return 1 - (1 - REGEN_FLOOR) * (t * t * (3 - 2 * t));
}

/** 매 프레임: 수압 감소 + 3초 후 자동 회복 */
function updateDurability(dt) {
  if (G.state !== 'playing') return;
  G.sinceHit += dt;
  G.pressure = pressureRateAt(G.depth);

  if (G.pressure > 0) {
    G.hull -= G.pressure * dt;
    if (G.hull <= 0) {
      G.hull = 0;
      refreshHud();
      gameOver();
      return;
    }
  }

  const scale = regenScaleAt(G.depth);
  if (scale > 0 && G.sinceHit >= REGEN_DELAY && G.hull < G.maxHull) {
    G.hull = Math.min(G.maxHull, G.hull + REGEN_RATE * scale * dt);
    G.regen = true;
  } else {
    G.regen = false;
  }

  if (G.bumpCd > 0) G.bumpCd = Math.max(0, G.bumpCd - dt);
}

let bannerTimer = 0;
function banner(text, ms) {
  el.banner.textContent = text;
  el.banner.classList.add('show');
  bannerTimer = (ms || 2000) / 1000;
}

let toastTimer = 0;
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  toastTimer = 1.6;
}

function updatePowerups() {
  const list = [];
  if (G.multi > 0) list.push(`<span class="pu multi">🎯 멀티 어뢰 ${Math.ceil(G.multi)}s</span>`);
  if (G.rapid > 0) list.push(`<span class="pu rapid">⚡ 연사 ${Math.ceil(G.rapid)}s</span>`);
  const html = list.join('');
  if (el.powerups.dataset.html !== html) {
    el.powerups.innerHTML = html;
    el.powerups.dataset.html = html;
  }
}

/* ---------------- 나침반 (무한 바다의 방위) ---------------- */
const COMPASS_WINDOW = 118;
const COMPASS_CYCLE = 360;
const HEADING_NAMES = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

function buildCompass() {
  if (!el.ribbon) return;
  const cards = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  let html = '';
  for (let cyc = 0; cyc < 3; cyc++) {
    const base = cyc * COMPASS_CYCLE;
    for (let d = 0; d < 360; d += 15) {
      if (d % 45 === 0) {
        const i = d / 45;
        const cls = i === 0 ? 'card n' : (i % 2 === 0 ? 'card' : 'sub');
        html += `<span class="${cls}" style="left:${base + d}px">${cards[i]}</span>`;
      } else {
        html += `<i style="left:${base + d}px"></i>`;
      }
    }
  }
  el.ribbon.innerHTML = html;
}

let compassBearing = -1;
function updateCompass() {
  if (!el.ribbon) return;
  // forward = (-sin(yaw), 0, -cos(yaw)) → yaw 0 이 북(-Z), 시계방향이 동(+X)
  let deg = (-P.yaw * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  if (Math.abs(deg - compassBearing) > 0.2) {
    compassBearing = deg;
    const x = COMPASS_WINDOW / 2 - (deg + COMPASS_CYCLE);
    el.ribbon.style.transform = `translateX(${x.toFixed(1)}px)`;
    if (el.bearing) setText(el.bearing, `${Math.round(deg)}°`);
    if (el.heading) setText(el.heading, HEADING_NAMES[Math.round(deg / 45) % 8]);
  }
}

function refreshHud() {
  setText(el.score, G.score.toLocaleString('ko-KR'));
  setText(el.best, G.best.toLocaleString('ko-KR'));
  setText(el.depth, Math.floor(G.depth));
  const zi = zoneIndexForDepth(G.depth);
  G.zoneIndex = zi;
  setText(el.zone, ZONES[zi].name);
  setText(el.bombs, G.bombs);
  el.bombBtn.classList.toggle('empty', G.bombs <= 0);
  el.bombBtn.classList.toggle('ready', G.bombs > 0);
  if (G.shield > 0) {
    el.shield.classList.remove('hidden');
    setText(el.shieldVal, G.shield);
  } else {
    el.shield.classList.add('hidden');
  }
  updatePowerups();
  updateCompass();
  updateDurabilityHud();
}

/* ---------------- 게임 시작/종료 ---------------- */
function resetGame() {
  for (const e of enemies) scene.remove(e.obj);
  enemies.length = 0;
  if (G.boss) removeBoss();
  for (const t of torpedoes) { t.active = false; t.mesh.visible = false; }
  for (const o of orbs) { o.active = false; o.mesh.visible = false; }
  for (const it of items) scene.remove(it.obj);
  items.length = 0;
  fx.clear();

  G.score = 0;
  G.depth = 0;
  G.maxDepth = 0;
  G.hull = BASE_MAX_HULL;
  G.maxHull = BASE_MAX_HULL;
  G.sinceHit = 99;
  G.pressure = 0;
  G.regen = false;
  G.bumpCd = 0;
  G.shield = 0;
  G.bombs = 1;
  G.multi = 0;
  G.rapid = 0;
  G.invuln = 1.6;
  G.fireTimer = 0;
  G.spawnTimer = 1.4;
  G.krakenCd = 24;
  G.krakenSeen = false;
  G.shake = 0;
  G.elapsed = 0;
  G.zoneIndex = 0;

  P.pos.copy(START_POS);
  P.vel.set(0, 0, 0);
  P.yaw = 0;
  P.pitch = 0;
  P.roll = 0;
  P.bob = 0;
  joy.move = 0;
  joy.turn = 0;
  joy.lift = 0;
  input.move = 0;
  input.turn = 0;
  input.lift = 0;
  input.fire = false;
  btnFiring = false;
  mouseFiring = false;
  fireKeyHeld = false;
  el.knob.style.transform = 'translate(0px, 0px)';
  player.obj.visible = true;

  world.reset();
  updateSubTransform(0);
  updateHeadlight(0, true);
  snapCamera();

  durShownWidth = -1;
  durShownCls = '';
  refreshHud();
  seedAmbientLife();
}

function startGame() {
  sound.init();
  sound.resume();
  sound.startAmbient();
  el.startScreen.classList.add('hidden');
  el.overScreen.classList.add('hidden');
  el.pauseScreen.classList.add('hidden');
  el.hud.classList.remove('hud-hidden');
  resetGame();
  G.state = 'playing';
  banner('잠수 시작', 1800);
  sound.sonar();
}

function gameOver() {
  G.state = 'over';
  G.shake = 1.3;
  sound.gameOver();
  sound.explode('big');
  fx.burst(P.pos.x, P.pos.y, P.pos.z, 60, {
    colors: [0xffd9a0, 0xff9a5a, 0xffffff, 0x9dfcff],
    speed: 16, size: 2.6, life: 1.1,
  });
  fx.flash(P.pos, 0xffc28a, 14, 0.6);
  player.obj.visible = false;

  const isRecord = G.score > G.best;
  if (isRecord) {
    G.best = G.score;
    try { localStorage.setItem(BEST_KEY, String(G.best)); } catch (e) { /* noop */ }
  }
  setText(el.overScore, G.score.toLocaleString('ko-KR'));
  setText(el.overBest, G.best.toLocaleString('ko-KR'));
  if (el.overZone) setText(el.overZone, ZONES[zoneIndexForDepth(G.maxDepth)].name);
  setText(el.overDepth, `${Math.floor(G.maxDepth)} m`);
  el.newRecord.classList.toggle('hidden', !isRecord);

  setTimeout(() => {
    if (G.state !== 'over') return;
    el.overScreen.classList.remove('hidden');
    el.hud.classList.add('hud-hidden');
  }, 900);
  refreshHud();
}

function togglePause(on) {
  if (on && G.state === 'playing') {
    G.state = 'paused';
    setText(el.pauseScore, G.score.toLocaleString('ko-KR'));
    setText(el.pauseDepth, `${Math.floor(G.depth)} m`);
    if (el.pauseZone) setText(el.pauseZone, ZONES[zoneIndexForDepth(G.depth)].name);
    el.pauseScreen.classList.remove('hidden');
    input.fire = false;
    btnFiring = false;
    mouseFiring = false;
    fireKeyHeld = false;
    joy.move = 0;
    joy.turn = 0;
    joy.lift = 0;
  } else if (!on && G.state === 'paused') {
    G.state = 'playing';
    el.pauseScreen.classList.add('hidden');
    clock.getDelta();
  }
}

function toggleMute() {
  const m = sound.toggle();
  el.muteIcon.textContent = m ? '🔇' : '🔊';
  if (!m) sound.resume();
}

/* ---------------- 자연 생태계 (오픈 바다) ---------------- */
/** 수심대별 목표 개체수와 등장 간격 — 파도(웨이브) 없이 주변에서 저절로 순환한다 */
function ecoAt(depth) {
  if (depth < 150) return { cap: 6, min: 1.8, max: 3.4 };
  if (depth < 550) return { cap: 8, min: 1.5, max: 2.8 };
  if (depth < 1000) return { cap: 9, min: 1.3, max: 2.5 };
  return { cap: 7, min: 1.9, max: 3.4 };
}

function seedAmbientLife() {
  G.spawnTimer = 2.2;
  G.krakenCd = 24;
}

/* 수적 생물 — 깊은 심해(700m+)에서만 드물게 조우하는 전설 */
const KRAKEN_DEPTH = 700;

function maybeSpawnKraken(dt) {
  if (G.state !== 'playing' || G.boss) return;
  if (G.depth < KRAKEN_DEPTH) {
    if (G.krakenCd < 8) G.krakenCd = 8;
    return;
  }
  G.krakenCd -= dt;
  if (G.krakenCd > 0) return;
  if (Math.random() < dt * 0.06) {
    spawnKraken();
    G.krakenCd = 170;
  }
}

function spawnKraken() {
  const b = makeKraken();
  const hp = 40 + Math.round(Math.max(0, G.depth - 600) / 100) * 6;
  computeForward(forward);
  b.group.position.copy(P.pos).addScaledVector(forward, 76);
  b.group.position.y = clamp(
    b.group.position.y,
    terrainHeight(b.group.position.x, b.group.position.z) + 18,
    SURFACE_Y - 16
  );
  b.group.rotation.order = 'YXZ';
  const scale = 1.65 + Math.min(0.5, Math.max(0, G.depth - 600) / 1600);
  b.group.scale.setScalar(scale);
  scene.add(b.group);
  G.boss = {
    obj: b.group,
    arms: b.arms,
    tentacles: b.tentacles,
    hp,
    maxHp: hp,
    scale,
    phase: Math.random() * 6.28,
    angle: Math.random() * 6.28,
    fire: 2.2,
    hit: 0,
    dead: false,
  };
  el.bossBar.classList.remove('hidden');
  el.bossBar.setAttribute('aria-hidden', 'false');
  updateBossBar();
  banner('심해의 전설 · 크라켄 출현', 2900);
  sound.bossWarn();
  G.shake = 0.8;
  G.krakenSeen = true;
}

function krakenDefeated() {
  G.score += 2600;
  toast('크라켄 격퇴 +2600');
  if (G.boss) removeBoss();
  G.krakenCd = 170;
  sound.waveClear();
  refreshHud();
}

function updateBossBar() {
  if (!G.boss) return;
  const k = clamp(G.boss.hp / G.boss.maxHp, 0, 1);
  el.bossFill.style.width = `${k * 100}%`;
  setText(el.bossHp, `${Math.max(0, G.boss.hp)} / ${G.boss.maxHp}`);
}

function removeBoss() {
  if (!G.boss) return;
  const g = G.boss.obj;
  scene.remove(g);
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  G.boss = null;
  el.bossBar.classList.add('hidden');
  el.bossBar.setAttribute('aria-hidden', 'true');
}

/* ---------------- 적 (살아 있는 해양 생물) ---------------- */
const ENEMY_STATS = {
  shark: { hp: 2, r: 1.7, score: 130 },   // 백상아리
  hammer: { hp: 3, r: 2.0, score: 180 },  // 귀상어
  puffer: { hp: 2, r: 1.6, score: 90 },   // 독가시 복어
  lion: { hp: 1, r: 1.5, score: 110 },    // 쏠배감펭
  jelly: { hp: 1, r: 1.4, score: 90 },    // 발광 해파리
  angler: { hp: 2, r: 1.6, score: 140 },  // 심해 아귀
};

/** 수심에 따라 그 깊이에 사는 생물이 나온다 */
function pickEnemyType(depth) {
  const roll = Math.random();
  if (depth < 150) {
    if (roll < 0.28) return 'puffer';
    if (roll < 0.54) return 'lion';
    if (roll < 0.76) return 'shark';
    if (roll < 0.9) return 'jelly';
    return 'hammer';
  }
  if (depth < 550) {
    if (roll < 0.26) return 'shark';
    if (roll < 0.48) return 'hammer';
    if (roll < 0.64) return 'angler';
    if (roll < 0.84) return 'jelly';
    return 'lion';
  }
  if (depth < 1000) {
    if (roll < 0.4) return 'angler';
    if (roll < 0.64) return 'jelly';
    if (roll < 0.84) return 'hammer';
    return 'shark';
  }
  if (roll < 0.5) return 'angler';
  if (roll < 0.8) return 'jelly';
  if (roll < 0.93) return 'hammer';
  return 'shark';
}

function makeEnemyModel(type) {
  if (type === 'shark') return makeShark();
  if (type === 'hammer') return makeHammerhead();
  if (type === 'puffer') return makePuffer();
  if (type === 'lion') return makeLionfish();
  if (type === 'angler') return makeAnglerfish();
  const palette = [0xb98bff, 0x7de8ff, 0xff9edb, 0xa8ffd8];
  return makeJellyfish(palette[Math.floor(Math.random() * palette.length)]);
}

function spawnEnemy() {
  computeForward(forward);
  const ahead = Math.random() < 0.72 ? 1 : -0.35;
  const ang = Math.atan2(forward.x * ahead, forward.z * ahead) + rand(-1.15, 1.15);
  const dist = rand(52, 92);
  const x = P.pos.x + Math.sin(ang) * dist;
  const z = P.pos.z + Math.cos(ang) * dist;
  const ground = terrainHeight(x, z);
  const y = clamp(P.pos.y + rand(-13, 13), ground + 3.5, SURFACE_Y - 8);

  const type = pickEnemyType(G.depth);
  const stats = ENEMY_STATS[type];
  const model = makeEnemyModel(type);
  const obj = model.group;

  obj.position.set(x, y, z);
  obj.rotation.order = 'YXZ';
  const scale = 1.0 + Math.random() * 0.35;
  obj.scale.setScalar(scale);
  scene.add(obj);

  const speed =
    type === 'shark' ? rand(12, 16) :
    type === 'hammer' ? rand(9, 12) :
    type === 'jelly' ? rand(4, 7) :
    type === 'angler' ? rand(4, 6.5) :
    rand(2.4, 4.2);

  enemies.push({
    type,
    obj,
    parts: model,
    hp: stats.hp,
    maxHp: stats.hp,
    r: stats.r * scale,
    score: stats.score,
    scale0: scale,
    phase: Math.random() * 6.28,
    speed,
    hit: 0,
    dead: false,
    kb: new THREE.Vector3(),
    bumpCd: 0,
    hitCd: 0,
    swirl: rand(1.0, 2.2),
    age: 0,
    swayAmp: rand(1.5, 4),
  });
}

function damageEnemy(e, dmg) {
  e.hp -= dmg;
  e.hit = 0.16;
  const p = e.obj.position;
  fx.burst(p.x, p.y, p.z, 4, { colors: [0xc8feff, 0xffffff], speed: 7, size: 1.2, life: 0.3 });
  sound.hit();
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    killEnemy(e);
  }
}

function killEnemy(e) {
  const p = e.obj.position;
  const big = e.type === 'shark' || e.type === 'hammer';
  const colors =
    e.type === 'jelly' ? [0xd9a6ff, 0x9dfcff, 0xffffff] :
    e.type === 'angler' ? [0x9dfcff, 0xd8fff4, 0xffffff] :
    e.type === 'puffer' ? [0xffe08a, 0xffc06b, 0xffffff] :
    [0xffd9a0, 0xff9a5a, 0xffffff];
  fx.burst(p.x, p.y, p.z, big ? 22 : 12, {
    colors,
    speed: big ? 12 : 8, size: big ? 2.0 : 1.5, life: 0.7,
  });
  fx.flash(p, e.type === 'jelly' ? 0xd6b0ff : 0xffb070, big ? 7 : 5, 0.3);
  sound.explode(big ? 'small' : 'tiny');

  G.score += e.score;
  scene.remove(e.obj);
  const idx = enemies.indexOf(e);
  if (idx >= 0) enemies.splice(idx, 1);

  // 깊은 심해일수록 선체 보강·수리 키트가 더 자주 나온다
  const dropChance = 0.16 + Math.min(0.16, G.depth / 7000);
  if (Math.random() < dropChance) dropItem(p.x, p.y, p.z);
  refreshHud();
}

function dropItem(x, y, z, forced) {
  // 선체 보강 · 긴급 수리도 꾸준히 나오도록 가중치를 둔다
  const pool = G.depth > 450 ? DEEP_ITEM_POOL : ITEM_POOL;
  const t = forced || pool[Math.floor(Math.random() * pool.length)];
  const mesh = new THREE.Mesh(itemGeos[t], itemMats[t]);
  const halo = spriteGlow(itemHalo[t], 3.0, 0.78);
  mesh.add(halo);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  items.push({ obj: mesh, type: t, phase: Math.random() * 6.28, age: 0 });
}

/* ---------------- 발사 ---------------- */
function fire() {
  computeForward(forward);
  const nose = tmpVec.copy(P.pos).addScaledVector(forward, 2.6);
  const count = G.multi > 0 ? 3 : 1;
  for (let i = 0; i < count; i++) {
    const t = torpedoes.find((x) => !x.active);
    if (!t) break;
    const spread = count === 0 ? 0 : (i - (count - 1) / 2) * 0.1;
    const v = forward.clone().applyAxisAngle(UP, spread);
    t.active = true;
    t.life = 1.8;
    t.mesh.visible = true;
    t.mesh.position.copy(nose);
    t.mesh.position.x += (i - (count - 1) / 2) * 0.4;
    t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.clone().normalize());
    t.vel.copy(v).multiplyScalar(96);
    t.trail = 0;
  }
  sound.shoot();
}

const ITEM_POOL = [
  'multi', 'rapid', 'shield', 'bomb',
  'hull', 'repair', 'repair',
  'multi', 'rapid', 'hull', 'repair',
];

/* 깊은 심해(450m+) — 수압을 버틸 수 있게 선체 보강·수리 비중을 높인다 */
const DEEP_ITEM_POOL = [
  'hull', 'repair', 'hull', 'repair', 'hull',
  'bomb', 'multi', 'rapid', 'shield', 'repair',
];

/* ---------------- 아이템 ---------------- */
function collectItem(it) {
  sound.pickup();
  const p = it.obj.position;
  if (it.type === 'multi') {
    G.multi = Math.min(26, G.multi + 13);
    toast('멀티 어뢰 · 3발 동시 발사');
  } else if (it.type === 'rapid') {
    G.rapid = Math.min(26, G.rapid + 13);
    toast('연사 강화 · 발사 속도 2배');
  } else if (it.type === 'shield') {
    G.shield = Math.min(4, G.shield + 2);
    toast('수중 실드 · 피해 2회 흡수');
  } else if (it.type === 'hull') {
    // 최대 내구력 자체가 늘어난다 (+ 현재 내구력도 회복)
    G.maxHull = Math.min(MAX_HULL_CAP, G.maxHull + 20);
    G.hull = Math.min(G.maxHull, G.hull + 25);
    durShownWidth = -1;
    durShownCls = '';
    toast(`선체 보강 · 최대 내구력 +20 (${Math.round(G.maxHull)})`);
    fx.ring(p.clone(), 0x6dffcf, 14, 0.6);
    fx.burst(p.x, p.y, p.z, 14, { colors: [0x6dffcf, 0xd8fff4, 0xffffff], speed: 9, size: 1.6, life: 0.6 });
  } else if (it.type === 'repair') {
    G.hull = Math.min(G.maxHull, G.hull + 35);
    toast('긴급 수리 키트 · 내구력 +35');
    fx.ring(p.clone(), 0xa9ff8c, 12, 0.55);
    fx.burst(p.x, p.y, p.z, 12, { colors: [0xa9ff8c, 0xe8ffd8, 0xffffff], speed: 8, size: 1.5, life: 0.55 });
  } else {
    G.bombs = Math.min(5, G.bombs + 1);
    toast('음파 폭탄 +1');
  }
  refreshHud();
}

function useBomb() {
  if (G.state !== 'playing' || G.bombs <= 0) return;
  G.bombs--;
  sound.bomb();
  G.shake = 0.9;
  const origin = P.pos.clone();
  fx.ring(origin, 0x9dfff2, 92, 1.0);
  fx.flash(origin, 0xbdfff6, 30, 0.4);
  fx.burst(origin.x, origin.y, origin.z, 40, {
    colors: [0xbdfff6, 0x9dfcff, 0xffffff], speed: 26, size: 2.4, life: 0.9,
  });
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.obj.position.distanceTo(origin) < 95) damageEnemy(e, 6);
  }
  if (G.boss && G.boss.obj.position.distanceTo(origin) < 110) damageBoss(10);
  refreshHud();
}

/* ---------------- 피해 ---------------- */
function hurtPlayer(amount) {
  if (G.state !== 'playing' || G.invuln > 0) return;
  // 맞은 순간부터 3초 동안은 자동 회복이 멈춘다
  G.sinceHit = 0;
  G.regen = false;
  if (G.shield > 0) {
    G.shield--;
    G.invuln = 0.7;
    sound.hit();
    fx.ring(P.pos.clone(), 0xa8b8ff, 12, 0.5);
    G.shake = 0.35;
    refreshHud();
    return;
  }
  G.hull -= amount;
  G.invuln = 1.6;
  G.shake = 0.9;
  sound.damage();
  el.flash.classList.add('on');
  G.flashTimer = 0.18;
  if (G.hull <= 0) {
    G.hull = 0;
    refreshHud();
    gameOver();
    return;
  }
  refreshHud();
}

function damageBoss(dmg) {
  if (!G.boss || G.boss.dead) return;
  const b = G.boss;
  b.hp -= dmg;
  b.hit = 0.12;
  const p = b.obj.position;
  fx.burst(p.x, p.y + 1.2, p.z, 5, {
    colors: [0xffe0a0, 0xffb070, 0xffffff], speed: 9, size: 1.5, life: 0.4,
  });
  sound.hit();
  updateBossBar();
  if (b.hp <= 0) {
    b.dead = true;
    const pos = p.clone();
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        if (G.state !== 'playing') return;
        fx.burst(
          pos.x + rand(-3, 3), pos.y + rand(-2, 2), pos.z + rand(-3, 3), 18,
          { colors: [0xffd9a0, 0xff7b4a, 0xffffff], speed: 14, size: 2.8, life: 0.9 }
        );
      }, i * 110);
    }
    fx.flash(pos, 0xffc27a, 24, 0.7);
    fx.ring(pos, 0xffc27a, 34, 0.9);
    sound.explode('big');
    G.shake = 1.4;
    for (let i = 0; i < 3; i++) {
      dropItem(pos.x + rand(-3, 3), pos.y + rand(-1, 2), pos.z, ['multi', 'hull', 'repair'][i]);
    }
    setTimeout(() => {
      if (G.state !== 'playing') return;
      krakenDefeated();
    }, 900);
  }
}

/* ---------------- 플레이어 갱신 ---------------- */
function updateSubTransform(dt) {
  P.bob += dt * 1.5;
  const bobY = Math.sin(P.bob) * 0.12;
  player.obj.position.set(P.pos.x, P.pos.y + bobY, P.pos.z);
  player.obj.rotation.set(P.pitch, P.yaw, P.roll);
  player.prop.rotation.z += dt * (12 + Math.abs(input.move) * 26);
}

/* ---------------- 탐조등 — 깊고 어두운 심해일수록 강해진다 ---------------- */
const HEADLIGHT_FROM = 150;  // 이 수심부터 불빛이 강해지기 시작
const HEADLIGHT_TO = 900;    // 이 수심에서 최대

function updateHeadlight(dt, instant) {
  if (!player || !player.spot) return;
  const t = clamp((G.depth - HEADLIGHT_FROM) / (HEADLIGHT_TO - HEADLIGHT_FROM), 0, 1);
  const deep = t * t * (3 - 2 * t);            // 부드러운 상승
  const k = instant ? 1 : damp(2.6, dt);
  const spot = player.spot;

  const targetIntensity = 17 + deep * 420;
  spot.intensity += (targetIntensity - spot.intensity) * k;
  spot.angle = 0.42 + deep * 0.24;
  spot.distance = 74 + deep * 260;
  spot.penumbra = 0.72 - deep * 0.2;

  // 바로 앞을 밝히는 보조광 (심해에서 확실히 비친다)
  if (player.frontLight) {
    player.frontLight.intensity += (deep * 110 - player.frontLight.intensity) * k;
    player.frontLight.distance = 18 + deep * 52;
  }
  // 잠수정 아래를 밝히는 빛무리 — 급한 사면을 따라 내려갈 때 발밑이 보이게
  if (player.under) {
    player.under.intensity += ((6 + deep * 150) - player.under.intensity) * k;
    player.under.distance = 16 + deep * 62;
  }

  // 전방 빛줄기(원뿔) — 심해에서 또렷해진다
  const beam = player.beam;
  if (beam) {
    beam.material.opacity += ((0.03 + deep * 0.12) - beam.material.opacity) * k;
    const widen = 1 + deep * 0.5;
    const stretch = 1 + deep * 1.15;
    beam.scale.set(widen, widen, stretch);
  }
}

function clampToWorld(pos, vel) {
  // 무한 바다 — 수평 경계는 없고 해저·수면만 막는다
  const ground = terrainHeight(pos.x, pos.z) + 4.5;
  if (pos.y < ground) {
    pos.y = ground;
    if (vel && vel.y < 0) vel.y = 0;
  }
  if (pos.y > SURFACE_Y - 7) {
    pos.y = SURFACE_Y - 7;
    if (vel && vel.y > 0) vel.y = 0;
  }
}

function updatePlayer(dt) {
  updateInput();

  // 회전
  P.yaw -= input.turn * P.turnRate * dt;
  const targetRoll = clamp(-input.turn * 0.5, -0.55, 0.55);
  P.roll += (targetRoll - P.roll) * damp(6, dt);

  // 추진
  computeHorizontal(horizontal);
  const thrust = input.move >= 0 ? input.move * P.speed : input.move * P.backSpeed;
  // 깊은 심해일수록 상승·하강이 빠르다 (1,000m 이상을 답답하지 않게 오가도록)
  const liftSpeed = P.lift + Math.min(64, Math.max(0, G.depth) * 0.075);
  const desired = tmpVec2.set(
    horizontal.x * thrust,
    input.lift * liftSpeed,
    horizontal.z * thrust
  );
  const accel = 3.2;
  P.vel.x += (desired.x - P.vel.x) * damp(accel, dt);
  P.vel.y += (desired.y - P.vel.y) * damp(accel, dt);
  P.vel.z += (desired.z - P.vel.z) * damp(accel, dt);

  P.pos.addScaledVector(P.vel, dt);
  clampToWorld(P.pos, P.vel);

  // 기울기(상승/하강에 반응)
  const targetPitch = clamp(P.vel.y * 0.022, -0.42, 0.42);
  P.pitch += (targetPitch - P.pitch) * damp(5, dt);

  updateSubTransform(dt);

  // 수심
  G.depth = Math.max(0, (SURFACE_Y - P.pos.y) * DEPTH_SCALE);
  if (G.depth > G.maxDepth) G.maxDepth = G.depth;

  // 기포 흘리기
  G.bubbleTimer -= dt;
  if (G.bubbleTimer <= 0) {
    G.bubbleTimer = 0.11;
    computeForward(forward);
    fx.emit(
      P.pos.x - forward.x * 2.4 + rand(-0.3, 0.3),
      P.pos.y - forward.y * 2.4 - 0.2,
      P.pos.z - forward.z * 2.4,
      rand(-0.8, 0.8), rand(0.4, 1.4), rand(-0.8, 0.8),
      0xe6ffff, rand(0.7, 1.5), rand(1.2, 2.0), 0.9, 0.7
    );
  }
}

/* ---------------- 카메라 ---------------- */
function snapCamera() {
  computeForward(forward);
  camera.position.copy(P.pos).addScaledVector(forward, -14.5).add(new THREE.Vector3(0, 6.2, 0));
  camera.lookAt(P.pos.x + forward.x * 30, P.pos.y + forward.y * 30 + 0.6, P.pos.z + forward.z * 30);
}

function updateCamera(dt) {
  computeForward(forward);
  const shakeX = G.shake > 0 ? rand(-1, 1) * G.shake * 0.55 : 0;
  const shakeY = G.shake > 0 ? rand(-1, 1) * G.shake * 0.55 : 0;
  const target = tmpVec.copy(P.pos).addScaledVector(forward, -14.5);
  target.y += 6.2 + shakeY;
  target.x += shakeX;
  camera.position.lerp(target, damp(5.0, dt));
  const minY = terrainHeight(camera.position.x, camera.position.z) + 3.2;
  if (camera.position.y < minY) camera.position.y = minY;
  camera.lookAt(
    P.pos.x + forward.x * 34,
    P.pos.y + forward.y * 34 + 0.8,
    P.pos.z + forward.z * 34
  );
  camera.rotation.z += P.roll * 0.14;
  G.shake = Math.max(0, G.shake - dt * 2.2);
}

/* ---------------- 적 갱신 ---------------- */
function updateEnemies(dt) {
  const pp = P.pos;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const o = e.obj;
    e.age += dt;
    e.phase += dt * e.swirl;
    if (e.bumpCd > 0) e.bumpCd -= dt;
    if (e.hitCd > 0) e.hitCd -= dt;

    tmpVec.copy(pp).sub(o.position);
    const dist = tmpVec.length() || 1;
    tmpVec.multiplyScalar(1 / dist);

    if (e.type === 'shark' || e.type === 'hammer') {
      // 유도 돌진 + 좌우 흔들림
      const side = tmpVec2.set(-tmpVec.z, 0, tmpVec.x).normalize();
      o.position.addScaledVector(tmpVec, e.speed * dt);
      o.position.addScaledVector(side, Math.sin(e.phase * 2) * e.swayAmp * dt);
      o.position.y += Math.sin(e.phase * 1.7) * 1.6 * dt;
      o.rotation.y = Math.atan2(-tmpVec.x, -tmpVec.z);
      o.rotation.x = Math.asin(clamp(tmpVec.y, -1, 1)) * 0.7;
      o.rotation.z = Math.sin(e.phase * 2) * 0.3;
    } else if (e.type === 'jelly') {
      o.position.addScaledVector(tmpVec, e.speed * dt);
      o.position.x += Math.sin(e.phase) * dt * 2.2;
      o.position.y += Math.cos(e.phase * 1.4) * dt * 1.6;
      const pulse = 1 + Math.sin(e.phase * 2.6) * 0.09;
      o.scale.setScalar(e.scale0 * pulse);
      o.rotation.y = Math.atan2(-tmpVec.x, -tmpVec.z);
      o.rotation.z = Math.sin(e.phase) * 0.16;
    } else if (e.type === 'puffer') {
      // 느긋하게 다가오며 몸을 부풀린다
      o.position.addScaledVector(tmpVec, e.speed * dt);
      o.position.y += Math.sin(e.phase * 1.1) * 0.6 * dt;
      const puff = 1 + Math.sin(e.phase * 1.5) * 0.16;
      if (e.parts.body) e.parts.body.scale.setScalar(puff);
      if (e.parts.spikes) e.parts.spikes.scale.setScalar(0.82 + puff * 0.22);
      o.rotation.y = Math.atan2(-tmpVec.x, -tmpVec.z);
      o.rotation.z = Math.sin(e.phase * 0.8) * 0.12;
    } else if (e.type === 'lion') {
      // 지느러미를 펄럭이며 떠다닌다
      o.position.addScaledVector(tmpVec, e.speed * dt);
      o.position.x += Math.sin(e.phase * 1.3) * dt * 1.8;
      o.rotation.y = Math.atan2(-tmpVec.x, -tmpVec.z);
      o.rotation.z = Math.sin(e.phase * 1.1) * 0.14;
    } else {
      // 심해 아귀 — 유인 돌기를 흔들며 다가온다
      o.position.addScaledVector(tmpVec, e.speed * dt);
      o.position.y += Math.sin(e.phase * 0.9) * 0.8 * dt;
      o.rotation.y = Math.atan2(-tmpVec.x, -tmpVec.z);
      o.rotation.x = Math.asin(clamp(tmpVec.y, -1, 1)) * 0.3;
    }

    // 부딪힘 반동 (밀려난 뒤 서서히 멈춘다)
    if (e.kb.lengthSq() > 0.0025) {
      o.position.addScaledVector(e.kb, dt);
      e.kb.multiplyScalar(Math.max(0, 1 - 3.4 * dt));
    } else if (e.kb.lengthSq() > 0) {
      e.kb.set(0, 0, 0);
    }

    // 유영(몸통 S자 + 꼬리 흔들기) — 해양 생물 모델 공통
    if (e.parts && e.parts.bend) swim(e.parts, ANIM.time.value);

    if (e.type === 'angler') {
      if (e.parts.jaw) e.parts.jaw.rotation.x = 0.06 + Math.abs(Math.sin(e.phase * 1.4)) * 0.46;
      if (e.parts.lure) e.parts.lure.position.z = -1.50 + Math.sin(e.phase * 1.8) * 0.18;
      if (e.parts.glow && e.parts.lure) e.parts.glow.position.copy(e.parts.lure.position);
    }

    // 수면·해저 지형 클램프
    const ground = terrainHeight(o.position.x, o.position.z) + 2.2;
    if (o.position.y < ground) o.position.y = ground;
    if (o.position.y > SURFACE_Y - 3) o.position.y = SURFACE_Y - 3;

    if (e.hit > 0) {
      e.hit -= dt;
      if (e.type !== 'jelly' && e.type !== 'puffer') o.scale.setScalar(e.scale0 * (1 + e.hit * 0.9));
    } else if (e.type !== 'jelly' && e.type !== 'puffer') {
      o.scale.setScalar(e.scale0);
    }

    // 접촉 — 관통하지 않고 서로 밀려난다
    const dx = o.position.x - pp.x;
    const dy = o.position.y - pp.y;
    const dz = o.position.z - pp.z;
    const rr = e.r + SUB_R;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2) || 0.0001;
      const nx = dx / d;
      const ny = dy / d;
      const nz = dz / d;
      const overlap = rr - d;

      // 적은 뒤로 크게, 잠수정은 살짝 밀려나며 튕긴다
      o.position.x += nx * overlap * 0.78;
      o.position.y += ny * overlap * 0.78;
      o.position.z += nz * overlap * 0.78;
      e.kb.x += nx * (5.5 + overlap * 2.4);
      e.kb.y += ny * (5.5 + overlap * 2.4);
      e.kb.z += nz * (5.5 + overlap * 2.4);

      pp.x -= nx * overlap * 0.32;
      pp.y -= ny * overlap * 0.32;
      pp.z -= nz * overlap * 0.32;
      const vn = P.vel.x * nx + P.vel.y * ny + P.vel.z * nz;
      if (vn > 0) {
        P.vel.x -= nx * vn * 1.5;
        P.vel.y -= ny * vn * 1.5;
        P.vel.z -= nz * vn * 1.5;
      }

      if (e.bumpCd <= 0) {
        e.bumpCd = 0.35;
        G.shake = Math.max(G.shake, 0.3);
        sound.bump();
      }

      if (e.hitCd <= 0) {
        e.hitCd = 0.9;
        if (e.type === 'puffer' || e.type === 'angler') {
          // 가시·이빨에 닿으면 크게 터지며 사라진다
          fx.burst(o.position.x, o.position.y, o.position.z, 20, {
            colors: [0xffe08a, 0xffb06b, 0xffffff], speed: 12, size: 2.0, life: 0.7,
          });
          fx.flash(o.position, 0xffb066, 9, 0.32);
          sound.explode('big');
          hurtPlayer(DMG_SPIKE);
          enemies.splice(i, 1);
          scene.remove(o);
          continue;
        }
        hurtPlayer(DMG_CONTACT);
      }
    }

    // 너무 멀어지면 정리
    if (dist > 300) {
      enemies.splice(i, 1);
      scene.remove(o);
    }
  }
}
/* ---------------- 보스 갱신 ---------------- */
function updateBoss(dt) {
  const b = G.boss;
  if (!b) return;
  b.phase += dt;
  const o = b.obj;

  tmpVec.copy(P.pos).sub(o.position);
  const dist = tmpVec.length() || 1;
  tmpVec.multiplyScalar(1 / dist);

  if (dist > 32) {
    o.position.addScaledVector(tmpVec, 14 * dt);
  } else {
    // 선회
    const side = tmpVec2.set(-tmpVec.z, 0, tmpVec.x).normalize();
    o.position.addScaledVector(side, Math.sin(b.phase * 0.7) * 14 * dt);
    o.position.y += Math.sin(b.phase * 0.9) * 6 * dt;
  }
  o.rotation.y = Math.atan2(-tmpVec.x, -tmpVec.z);
  o.rotation.x = Math.asin(clamp(tmpVec.y, -1, 1)) * 0.35;
  o.rotation.z = Math.sin(b.phase * 1.2) * 0.08;

  // 다리·촉수 흔들림
  if (b.arms) {
    for (let i = 0; i < b.arms.length; i++) {
      const arm = b.arms[i];
      const ph = arm.pivot.userData.phase;
      arm.limb.rotation.x = Math.sin(b.phase * 1.1 + ph) * 0.15;
      arm.limb.rotation.y = Math.sin(b.phase * 0.8 + ph * 1.3) * 0.16;
      arm.limb.rotation.z = Math.cos(b.phase * 0.9 + ph) * 0.1;
    }
  }
  if (b.tentacles) {
    for (let i = 0; i < b.tentacles.length; i++) {
      const tt = b.tentacles[i];
      const ph = tt.pivot.userData.phase;
      tt.limb.rotation.x = Math.sin(b.phase * 0.7 + ph) * 0.22;
      tt.limb.rotation.y = Math.sin(b.phase * 1.3 + ph) * 0.26;
      tt.limb.rotation.z = Math.cos(b.phase * 0.6 + ph) * 0.14;
    }
  }

  // 해저·수면을 뚫지 않는다
  const ground = terrainHeight(o.position.x, o.position.z) + 12;
  if (o.position.y < ground) o.position.y = ground;
  if (o.position.y > SURFACE_Y - 14) o.position.y = SURFACE_Y - 14;

  if (b.hit > 0) {
    b.hit -= dt;
    o.scale.setScalar(b.scale * (1 + b.hit * 0.4));
  } else {
    o.scale.setScalar(b.scale);
  }

  // 발사
  b.fire -= dt;
  if (b.fire <= 0 && dist < 90) {
    b.fire = 1.6;
    const count = b.hp < b.maxHp * 0.5 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const orb = orbs.find((x) => !x.active);
      if (!orb) break;
      const dir = tmpVec.clone();
      dir.applyAxisAngle(UP, (i - (count - 1) / 2) * 0.12);
      dir.y += rand(-0.05, 0.12);
      orb.active = true;
      orb.life = 7;
      orb.mesh.visible = true;
      orb.mesh.position.copy(o.position).addScaledVector(dir, 5);
      orb.vel.copy(dir.normalize()).multiplyScalar(24);
    }
    sound.shoot();
  }

  // 몸통·촉수 접촉은 resolveBossContact() 에서 처리한다
}

/* ---------------- 보스 몸통 접촉 — 관통 금지 ---------------- */
function resolveBossContact() {
  const b = G.boss;
  if (!b) return;
  const BOSS_CONTACT_R = 8.4 * (b.scale / 1.45);
  const o = b.obj.position;
  let dx = P.pos.x - o.x;
  let dy = P.pos.y - o.y;
  let dz = P.pos.z - o.z;
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
  if (d >= BOSS_CONTACT_R) return;
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  const overlap = BOSS_CONTACT_R - d;
  P.pos.x += nx * overlap;
  P.pos.y += ny * overlap;
  P.pos.z += nz * overlap;
  const vn = P.vel.x * nx + P.vel.y * ny + P.vel.z * nz;
  if (vn < 0) {
    P.vel.x -= nx * vn * 1.5;
    P.vel.y -= ny * vn * 1.5;
    P.vel.z -= nz * vn * 1.5;
  }
  if (G.bumpCd <= 0) {
    G.bumpCd = 0.5;
    G.shake = Math.max(G.shake, 0.5);
    sound.bump();
  }
  hurtPlayer(DMG_BOSS);
}

/* ---------------- 대형 관상 생물 충돌 — 데미지 없이 밀려난다 ---------------- */
function resolveCreatureContacts() {
  if (!world || !world.resolveCreatureCollisions) return;
  const pushed = world.resolveCreatureCollisions(P.pos, SUB_R, P.vel);
  if (pushed <= 0) return;
  if (G.bumpCd <= 0) {
    G.bumpCd = 0.6;
    G.shake = Math.max(G.shake, 0.34);
    sound.bump();
    fx.flash(P.pos, 0xbfefff, 6, 0.22);
    // 살짝 부딪히는 물결
    fx.ring(P.pos.clone(), 0xbfefff, 9, 0.4);
  }
}

/* ---------------- 어뢰 ---------------- */
function findTarget(fromPos, coneCos) {
  computeForward(forward);
  let best = null;
  let bestScore = -Infinity;
  for (const e of enemies) {
    const dx = e.obj.position.x - fromPos.x;
    const dy = e.obj.position.y - fromPos.y;
    const dz = e.obj.position.z - fromPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1 || d > 140) continue;
    const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / d;
    if (dot < (coneCos === undefined ? 0.9 : coneCos)) continue;
    const s = dot * 2 - d * 0.004;
    if (s > bestScore) {
      bestScore = s;
      best = e;
    }
  }
  if (G.boss && !G.boss.dead) {
    const p = G.boss.obj.position;
    const dx = p.x - fromPos.x;
    const dy = p.y - fromPos.y;
    const dz = p.z - fromPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / d;
    if (dot > 0.93) return { obj: { position: p }, boss: true };
  }
  return best;
}

function updateTorpedoes(dt) {
  for (const tor of torpedoes) {
    if (!tor.active) continue;
    tor.life -= dt;
    if (tor.life <= 0) {
      tor.active = false;
      tor.mesh.visible = false;
      continue;
    }

    const target = findTarget(tor.mesh.position, 0.62);
    if (target) {
      const desired = tmpVec.copy(target.obj.position).sub(tor.mesh.position).normalize().multiplyScalar(96);
      tor.vel.lerp(desired, Math.min(1, dt * 3.4));
    }
    tor.mesh.position.addScaledVector(tor.vel, dt);
    tor.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpVec2.copy(tor.vel).normalize());

    tor.trail = (tor.trail || 0) + dt;
    if (tor.trail > 0.035) {
      tor.trail = 0;
      fx.emit(tor.mesh.position.x, tor.mesh.position.y, tor.mesh.position.z,
        rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4), 0x9dfcff, 1.0, 0.35, 0, 2.4);
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const dx = e.obj.position.x - tor.mesh.position.x;
      const dy = e.obj.position.y - tor.mesh.position.y;
      const dz = e.obj.position.z - tor.mesh.position.z;
      const rr = e.r + 0.8;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        damageEnemy(e, 1);
        tor.active = false;
        tor.mesh.visible = false;
        break;
      }
    }
    if (!tor.active) continue;

    if (G.boss && !G.boss.dead) {
      const b = G.boss.obj.position;
      const dx = b.x - tor.mesh.position.x;
      const dy = b.y - tor.mesh.position.y;
      const dz = b.z - tor.mesh.position.z;
      if (dx * dx + dy * dy + dz * dz < 46) {
        damageBoss(1);
        tor.active = false;
        tor.mesh.visible = false;
        continue;
      }
    }

    if (tor.mesh.position.distanceTo(P.pos) > 190) {
      tor.active = false;
      tor.mesh.visible = false;
    }
  }
}

function updateOrbs(dt) {
  for (const o of orbs) {
    if (!o.active) continue;
    o.life -= dt;
    if (o.life <= 0) {
      o.active = false;
      o.mesh.visible = false;
      continue;
    }
    o.mesh.position.addScaledVector(o.vel, dt);
    fx.emit(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z,
      rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3), 0xffa070, 1.2, 0.4, 0, 2);

    const dx = o.mesh.position.x - P.pos.x;
    const dy = o.mesh.position.y - P.pos.y;
    const dz = o.mesh.position.z - P.pos.z;
    if (dx * dx + dy * dy + dz * dz < 9) {
      hurtPlayer(DMG_ORB);
      o.active = false;
      o.mesh.visible = false;
      fx.burst(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, 10, {
        colors: [0xffa070, 0xffe0a0], speed: 8, size: 1.5, life: 0.4,
      });
      continue;
    }
    if (o.mesh.position.distanceTo(P.pos) > 260) {
      o.active = false;
      o.mesh.visible = false;
    }
  }
}

function updateItems(dt, t) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.age += dt;
    it.obj.rotation.y += dt * 2.2;
    it.obj.rotation.x += dt * 1.3;
    it.obj.position.y += Math.sin(t * 2 + it.phase) * dt * 0.8;

    const dx = it.obj.position.x - P.pos.x;
    const dy = it.obj.position.y - P.pos.y;
    const dz = it.obj.position.z - P.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 400) {
      const f = Math.min(1, dt * 3.6) * (1 - d2 / 400);
      it.obj.position.x -= dx * f;
      it.obj.position.y -= dy * f;
      it.obj.position.z -= dz * f;
    }
    if (d2 < 16) {
      collectItem(it);
      items.splice(i, 1);
      scene.remove(it.obj);
      continue;
    }
    if (it.age > 24) {
      items.splice(i, 1);
      scene.remove(it.obj);
    }
  }
}

/* ---------------- 루프 ---------------- */
let acc = 0;
let frames = 0;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  ANIM.time.value += dt;

  frames++;
  acc += dt;
  if (acc > 2.5) {
    const fps = frames / acc;
    frames = 0;
    acc = 0;
    G.fps = Math.round(fps);
    if (fps < 45 && pixelRatio > 1 && G.lowFpsChecks < 2) {
      pixelRatio = Math.max(1, pixelRatio - 0.5);
      renderer.setPixelRatio(pixelRatio);
      G.lowFpsChecks++;
    }
  }

  if (G.state === 'playing') {
    updateGame(dt);
  } else if (G.state === 'menu' || G.state === 'over') {
    updateIdle(dt);
  } else {
    fx.update(0, camera);
  }

  renderer.render(scene, camera);
}

function updateIdle(dt) {
  G.elapsed += dt;
  if (G.state === 'menu') {
    P.bob += dt * 0.6;
    P.yaw = Math.sin(G.elapsed * 0.18) * 0.5;
    P.pitch = Math.sin(G.elapsed * 0.3) * 0.06;
    player.obj.visible = true;
    player.obj.position.set(START_POS.x, START_POS.y + Math.sin(P.bob) * 0.3, START_POS.z);
    player.obj.rotation.set(P.pitch, P.yaw, Math.sin(G.elapsed * 0.4) * 0.1);
    player.prop.rotation.z += dt * 8;
    const orbit = G.elapsed * 0.12;
    camera.position.set(
      START_POS.x + Math.sin(orbit) * 15,
      START_POS.y + 5 + Math.sin(G.elapsed * 0.3) * 1.2,
      START_POS.z + Math.cos(orbit) * 15
    );
    camera.lookAt(START_POS.x, START_POS.y - 2, START_POS.z - 14);
    if (G.pingTimer !== undefined) {
      G.pingTimer -= dt;
      if (G.pingTimer <= 0) {
        G.pingTimer = 11 + Math.random() * 6;
        sound.init();
        if (sound.ac && sound.ac.state === 'running') sound.sonar();
      }
    }
  }
  world.update(dt, P.pos);
  updatePreviews();
  fx.update(dt, camera);
}

function updateGame(dt) {
  G.elapsed += dt;
  const t = G.elapsed;

  updatePlayer(dt);
  updateCamera(dt);
  world.update(dt, P.pos);

  // 발사
  if (input.fire) {
    G.fireTimer -= dt;
    if (G.fireTimer <= 0) {
      G.fireTimer = G.rapid > 0 ? 0.085 : 0.17;
      fire();
    }
  } else {
    G.fireTimer = Math.max(0, G.fireTimer - dt);
  }

  if (G.multi > 0) G.multi = Math.max(0, G.multi - dt);
  if (G.rapid > 0) G.rapid = Math.max(0, G.rapid - dt);
  if (G.invuln > 0) G.invuln = Math.max(0, G.invuln - dt);

  // 사운드 스케줄
  G.pingTimer -= dt;
  if (G.pingTimer <= 0) {
    G.pingTimer = 12 + Math.random() * 8;
    sound.sonar();
  }

  // 자연 생태계 — 수심대에 맞는 개체수가 주변을 떠돈다
  const eco = ecoAt(G.depth);
  G.spawnTimer -= dt;
  if (G.spawnTimer <= 0) {
    if (enemies.length < eco.cap) {
      spawnEnemy();
      G.spawnTimer = rand(eco.min, eco.max);
    } else {
      G.spawnTimer = 1.2;
    }
  }
  maybeSpawnKraken(dt);

  updateEnemies(dt);
  updateBoss(dt);
  resolveBossContact();
  resolveCreatureContacts();
  clampToWorld(P.pos, P.vel);
  updateSubTransform(0);
  updateHeadlight(dt);
  updateDurability(dt);
  if (G.state !== 'playing') return;
  updateTorpedoes(dt);
  updateOrbs(dt);
  updateItems(dt, t);
  updatePreviews();
  fx.update(dt, camera);

  if (G.flashTimer > 0) {
    G.flashTimer -= dt;
    if (G.flashTimer <= 0) el.flash.classList.remove('on');
  }
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) el.banner.classList.remove('show');
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) el.toast.classList.remove('show');
  }

  refreshHud();
  updateReticle();
}

let reticleTick = 0;
function updateReticle() {
  reticleTick++;
  if (reticleTick % 4 !== 0) return;
  el.reticle.classList.toggle('locked', !!findTarget(P.pos));
}

/* ---------------- 기타 ---------------- */
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(pixelRatio);
}

/* ---------------- 검증용: 생물 모델 미리보기 ---------------- */
const PREVIEW_MAKERS = {
  humpback: makeHumpbackWhale, blue: makeBlueWhale, orca: makeOrca, sperm: makeSpermWhale,
  manta: makeMantaRay, eagle: makeEagleRay, stingray: makeStingray, turtle: makeTurtle,
  kraken: makeKraken,
};
const previews = [];

function clearPreviews() {
  for (const p of previews) scene.remove(p.group);
  previews.length = 0;
}

function previewCreature(kind, opts) {
  const o = opts || {};
  clearPreviews();
  const make = PREVIEW_MAKERS[kind];
  if (!make) return null;
  const m = make();
  computeForward(forward);
  const dist = o.dist || 34;
  const pos = P.pos.clone().addScaledVector(forward, dist);
  m.group.position.copy(pos);
  m.group.rotation.order = 'YXZ';
  m.group.rotation.set(o.pitch || 0, P.yaw + (o.turn === undefined ? Math.PI * 0.72 : o.turn), 0);
  m.group.scale.setScalar(o.scale || 1);
  scene.add(m.group);
  previews.push({ kind, group: m.group, model: m });
  return { kind, pos: [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)], scale: o.scale || 1 };
}

function updatePreviews() {
  for (const p of previews) {
    if (p.model && p.model.update) p.model.update(ANIM.time.value);
  }
}

function bindButtons() {
  $('btn-start').addEventListener('click', startGame);
  $('btn-again').addEventListener('click', startGame);
  $('btn-menu').addEventListener('click', () => {
    el.overScreen.classList.add('hidden');
    el.pauseScreen.classList.add('hidden');
    el.startScreen.classList.remove('hidden');
    el.hud.classList.add('hud-hidden');
    setText(el.startBest, G.best.toLocaleString('ko-KR'));
    resetGame();
    G.state = 'menu';
    if (G.boss) removeBoss();
    for (const e of enemies) scene.remove(e.obj);
    enemies.length = 0;
    P.pos.copy(START_POS);
    P.yaw = 0;
    G.pingTimer = 3;
  });
  $('btn-resume').addEventListener('click', () => togglePause(false));
  $('btn-restart').addEventListener('click', startGame);
  el.pause.addEventListener('click', () => togglePause(G.state === 'playing'));
  el.mute.addEventListener('click', toggleMute);
  // 음파 폭탄: 조이스틱을 잡은 채 두 번째 손가락으로 누르면(멀티터치) 사파리가
  // click 을 생략할 수 있어 pointerdown 에서 먼저 처리하고, 뒤따르는 click 은 중복으로 본다.
  let bombUsedAt = -1e9;
  el.bombBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    bombUsedAt = performance.now();
    useBomb();
  });
  el.bombBtn.addEventListener('click', () => {
    if (performance.now() - bombUsedAt < 700) return;
    useBomb();
  });
}

function boot() {
  try {
    initThree();
  } catch (e) {
    el.loading.innerHTML = '<p style="padding:24px;text-align:center;line-height:1.6">이 브라우저에서 3D 그래픽(WebGL)을 시작할 수 없습니다.<br />사파리 최신 버전에서 다시 시도해 주세요.</p>';
    return;
  }
  setText(el.startBest, G.best.toLocaleString('ko-KR'));
  setText(el.best, G.best.toLocaleString('ko-KR'));
  snapCamera();
  G.depth = (SURFACE_Y - P.pos.y) * DEPTH_SCALE;
  G.maxDepth = G.depth;
  world.update(0, P.pos);
  renderer.render(scene, camera);

  setTimeout(() => el.loading.classList.add('done'), 180);
  setTimeout(() => { el.loading.style.display = 'none'; }, 800);

  G.pingTimer = 4;
  if (new URLSearchParams(location.search).has('debug')) {
    window.__abyss = {
      G, P, enemies, items, orbs, world, renderer, camera, scene, player, torpedoes,
      startGame, spawnKraken, maybeSpawnKraken, damageBoss, removeBoss, spawnEnemy, useBomb,
      ecoAt, previewCreature, clearPreviews,
      dropItem, collectItem, hurtPlayer, updateHeadlight, resolveCreatureContacts,
      pressureRateAt, regenScaleAt,
      hull: () => ({
        hull: G.hull, maxHull: G.maxHull, sinceHit: G.sinceHit,
        pressure: G.pressure, regen: G.regen,
        barWidth: el.durFill ? el.durFill.style.width : null,
        barClass: el.dur ? el.dur.className : null,
        flag: el.durFlag ? !el.durFlag.classList.contains('hidden') : null,
        text: el.durVal ? el.durVal.textContent + '/' + el.durMax.textContent : null,
      }),
      light: () => ({
        intensity: player.spot.intensity, angle: player.spot.angle,
        distance: player.spot.distance,
        beamOpacity: player.beam ? player.beam.material.opacity : null,
        beamScale: player.beam ? player.beam.scale.z : null,
      }),
      creatures: () => world.creatures.map((c) => ({
        kind: c.kind,
        pos: [+c.obj.group.position.x.toFixed(2), +c.obj.group.position.y.toFixed(2), +c.obj.group.position.z.toFixed(2)],
        colliders: c.colliders.length,
        cullR: +c.cullR.toFixed(1),
        box: c.colliders.map((s) => +s.r.toFixed(2)),
      })),
      chunks: () => world.chunkStats(),
      setPos: (x, z, dy) => {
        P.pos.set(x, terrainHeight(x, z) + (dy === undefined ? 7 : dy), z);
        P.vel.set(0, 0, 0);
        snapCamera();
      },
      setPos3: (x, y, z) => {
        P.pos.set(x, y, z);
        P.vel.set(0, 0, 0);
        snapCamera();
      },
      depthTo: (m) => {
        // 요청한 수심까지 내려갈 수 있는 가까운 해구를 찾아 이동한다 (검증용)
        const targetY = SURFACE_Y - m / DEPTH_SCALE;
        let best = null;
        for (let r = 0; r <= 1800 && !best; r += 40) {
          for (let a = 0; a < 24; a++) {
            const ang = (a / 24) * Math.PI * 2;
            const x = P.pos.x + Math.cos(ang) * r;
            const z = P.pos.z + Math.sin(ang) * r;
            if (terrainHeight(x, z) + 5 < targetY) { best = { x, z }; break; }
          }
        }
        if (!best) return { depth: G.depth, found: false };
        P.pos.set(best.x, targetY, best.z);
        P.vel.set(0, 0, 0);
        G.depth = Math.max(0, (SURFACE_Y - P.pos.y) * DEPTH_SCALE);
        G.maxDepth = Math.max(G.maxDepth, G.depth);
        updateSubTransform(0);
        snapCamera();
        return {
          depth: +G.depth.toFixed(1), found: true,
          at: [+best.x.toFixed(0), +best.z.toFixed(0)],
          terrainDepth: +(((SURFACE_Y - terrainHeight(best.x, best.z)) * DEPTH_SCALE)).toFixed(1),
        };
      },
      depthInfo: () => ({
        depth: +G.depth.toFixed(1),
        zone: ZONES[zoneIndexForDepth(G.depth)].name,
        zoneIndex: zoneIndexForDepth(G.depth),
        pressure: +pressureRateAt(G.depth).toFixed(2),
        regenScale: +regenScaleAt(G.depth).toFixed(2),
        terrainY: +terrainHeight(P.pos.x, P.pos.z).toFixed(1),
        y: +P.pos.y.toFixed(1),
      }),
      terrain: (x, z) => terrainHeight(x, z),
      setInput: (o) => {
        if (o.fire !== undefined) btnFiring = !!o.fire;
        if (o.lift !== undefined) joy.lift = o.lift;
        if (o.move !== undefined) joy.move = o.move;
        if (o.turn !== undefined) joy.turn = o.turn;
      },
      previewCreature, clearPreviews,
      previews: () => previews.map((p) => p.kind),
      creatureModels: () => ({
        humpback: makeHumpbackWhale, blue: makeBlueWhale, orca: makeOrca,
        sperm: makeSpermWhale, manta: makeMantaRay, eagle: makeEagleRay,
        stingray: makeStingray, turtle: makeTurtle,
      }),
    };
  }
  loop();
}

boot();
