/* =========================================================
   ABYSS DIVER — 3D 자유 유영 심해 탐험 슈팅
   Three.js 기반, 빌드 없이 단일 페이지로 실행
   ========================================================= */
import * as THREE from 'three';
import { Sound } from './audio.js?v=20261117c4';
import { World, ZONES, SURFACE_Y, DEPTH_SCALE, terrainHeight, zoneIndexForDepth } from './world.js?v=20261117c4';
import { RenderPipeline, QUALITY } from './render.js?v=20261117c4';
import {
  makeSubmarine, makeShark, makeHammerhead, makePuffer, makeLionfish,
  makeAnglerfish, makeJellyfish, makeKraken, spriteGlow, swim, setSwimRate, ANIM,
  makeHumpbackWhale, makeBlueWhale, makeOrca, makeSpermWhale,
  makeMantaRay, makeEagleRay, makeStingray, makeTurtle,
} from './models.js?v=20261117c4';
import { FX } from './fx.js?v=20261117c4';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

const BEST_KEY = 'abyss-diver-best';
// 산호 언덕 위에서 시작 — 앞쪽으로 해저 협곡이 깊게 떨어진다
const START_POS = new THREE.Vector3(-20, terrainHeight(-20, 60) + 11, 60);

/* ---------------- 내구력 · 충돌 · 수압 밸런스 ---------------- */
const BASE_MAX_HULL = 100;       // 기본 최대 내구력
const SUB_R = 1.7;               // 잠수정 충돌 반경
const REGEN_DELAY = 3;           // 마지막 피격 후 회복 시작까지 (초)
const REGEN_RATE = 5.5;          // 초당 회복량
const REGEN_FADE_FROM = 450;     // 이 수심까지는 정상 회복
const REGEN_FADE_TO = 1500;      // 이 수심부터는 회복이 거의 멈춘다
const REGEN_FLOOR = 0.18;        // 심연에서 남는 회복 비율
const PRESSURE_START = 500;      // 수압이 내구력을 깎기 시작하는 수심(m)
/* 수심(m) → 초당 내구력 감소 — 1,000m에서 바로 티지지 않고 2,500m+까지 완만하게 오른다 */
const PRESSURE_CURVE = [
  [500, 0.30],
  [900, 0.85],
  [1300, 1.50],
  [1800, 2.40],
  [2400, 3.80],
  [2800, 4.60],
];
const DMG_CONTACT = 14;          // 적 생물 접촉
const DMG_SPIKE = 18;            // 복어·아귀 폭발
const DMG_ORB = 12;              // 크라켄 구체
const DMG_BOSS = 22;             // 크라켄 몸통 접촉
const MAX_HULL_CAP = 360;        // 선체 보강 반복 상한

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
  qualityBtns: $('quality-btns'),
  qualityNote: $('quality-note'),
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
let renderer, scene, camera, world, fx, player, pipeline;
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const QUALITY_KEY = 'abyss.quality';          // 'auto' | 'high' | 'medium' | 'low'
let qualityMode = 'auto';
let autoPreset = IS_IOS ? 'medium' : 'high';
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
  lift: 26,
  turnRate: 1.65,          // 좌/우 조이스틱 최대 선회 속도 (rad/s)
  bob: 0,
  bobPhase: 0,
};

const forward = new THREE.Vector3();
const horizontal = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const camTmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/* ---------------- 카메라 (로블록스식 오빗) ----------------
   yaw/pitch 는 카메라가 바라보는 방향, dist 는 잠수정에서 카메라까지의 거리.
   · 화면 빈 곳 한 손가락 드래그 → 시점 회전 (멀티터치 지원)
   · 두 손가락 핀치 / 마우스 휠 → 3D 줌 (2.5 ~ 26 유닛) */
const CAM = {
  yaw: 0,
  pitch: -0.24,
  dist: 15,
  distNow: 15,
  minDist: 2.5,
  maxDist: 26,
  targetY: 1.15,
};
const camLook = new THREE.Vector3(0, 0, -1);   // 카메라가 보는 방향(단위벡터)
const aim = new THREE.Vector3(0, 0, -1);       // 조준 방향(화면 중앙)

function camDirFrom(out, yaw, pitch) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/* 시점·줌 공통 연산 — 포인터 핸들러·휠이 모두 이 함수를 쓴다 */
const LOOK_SENS = 0.0055;
const PITCH_MIN = -1.2;
const PITCH_MAX = 1.15;

/* 마지막으로 사용자가 시점을 직접 건드린 시각(초).
   이 직후에는 자동 추적 카메라가 시점을 가로채지 않는다. */
let lastLookAt = -10;
const nowSec = () => performance.now() * 0.001;

function applyLook(dx, dy) {
  CAM.yaw -= dx * LOOK_SENS;
  CAM.pitch = clamp(CAM.pitch - dy * LOOK_SENS, PITCH_MIN, PITCH_MAX);
  lastLookAt = nowSec();
}

function applyPinch(d0, d, base) {
  const from = base === undefined ? CAM.dist : base;
  CAM.dist = clamp(from * (d0 / (d || 1)), CAM.minDist, CAM.maxDist);
}

function applyZoom(deltaY, deltaMode) {
  const k = deltaMode === 1 ? 0.05 : 0.0018;
  CAM.dist = clamp(CAM.dist * (1 + deltaY * k), CAM.minDist, CAM.maxDist);
}

/** 두 각도의 최단 차이 (-π ~ π) */
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 카메라를 잠수정 기준 기본 위치로 돌린다 */
function resetCameraView() {
  CAM.yaw = P.yaw;
  CAM.pitch = -0.24;
  CAM.dist = 15;
}

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
    // 아이폰은 MSAA 비용이 커서 픽셀비율로 대신한다 (후처리 파이프라인이 가장자리를 부드럽게)
    antialias: !IS_IOS,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  if (IS_IOS) pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // 톤매핑은 후처리 합성 패스에서 한 번만 한다 (HDR 로 그린 뒤 ACES)
  renderer.toneMapping = THREE.NoToneMapping;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.2, 520);
  camera.position.set(0, 9, 78);

  world = new World(scene);
  world.setCamera(camera);
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

  // 후처리 파이프라인 (블룸·빛줄기·색보정·비네트)
  pipeline = new RenderPipeline(renderer, scene, camera);
  loadQuality();
  applyQuality(currentPreset());

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

  /* --- 시점 회전(드래그) · 3D 줌(핀치·휠) — 멀티터치 분리 ---
     터치는 touch 이벤트(identifier)로, 마우스·펜은 pointer 이벤트로 처리한다.
     두 경로를 섞지 않으므로 같은 손가락이 두 번 반영되지 않는다. */
  const lookPointers = new Map();   // 마우스·펜: pointerId -> {x, y}
  const touchPts = new Map();       // 터치: identifier -> {x, y}
  let pinch = null;                 // { d0, base }
  let tap = null;                   // 마우스 클릭(발사) 판정

  function startPinch(d0) {
    pinch = { d0: d0 || 1, base: CAM.dist };
    tap = null;
  }

  /* ---------------- 터치: 한 손가락 회전 / 두 손가락 줌 ---------------- */
  const touchList = (e) => Array.from(e.touches || []);

  function onTouchStart(e) {
    if (e.cancelable !== false) e.preventDefault();
    const ts = touchList(e);
    touchPts.clear();
    for (const t of ts) touchPts.set(t.identifier, { x: t.clientX, y: t.clientY });
    if (ts.length === 1) {
      pinch = null;
    } else if (ts.length >= 2) {
      const a = ts[0];
      const b = ts[1];
      startPinch(Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
    }
  }

  function onTouchMove(e) {
    if (e.cancelable !== false) e.preventDefault();
    const ts = touchList(e);
    if (ts.length >= 2) {
      const a = ts[0];
      const b = ts[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      if (!pinch) startPinch(d);
      // 손을 벌리면 줌인(가까이), 오므리면 줌아웃
      applyPinch(pinch.d0, d, pinch.base);
      for (const t of ts) touchPts.set(t.identifier, { x: t.clientX, y: t.clientY });
      return;
    }
    if (ts.length === 1) {
      pinch = null;
      const t = ts[0];
      const p = touchPts.get(t.identifier);
      if (!p) {
        touchPts.set(t.identifier, { x: t.clientX, y: t.clientY });
        return;
      }
      applyLook(t.clientX - p.x, t.clientY - p.y);
      p.x = t.clientX;
      p.y = t.clientY;
    }
  }

  function onTouchEnd(e) {
    const ts = touchList(e);
    for (const id of [...touchPts.keys()]) {
      let still = false;
      for (const t of ts) if (t.identifier === id) still = true;
      if (!still) touchPts.delete(id);
    }
    if (ts.length < 2) pinch = null;
    if (ts.length === 1) {
      touchPts.set(ts[0].identifier, { x: ts[0].clientX, y: ts[0].clientY });
    }
  }

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('touchcancel', onTouchEnd);

  /* ---------------- 마우스 · 펜 ---------------- */
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button > 0) return;
    lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch = null;
    tap = e.pointerType === 'mouse'
      ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }
      : null;
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const p = lookPointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (tap && tap.id === e.pointerId) tap.moved += Math.abs(dx) + Math.abs(dy);
    applyLook(dx, dy);
  }, { passive: false });

  function endLook(e) {
    if (e.pointerType === 'touch') return;
    if (!lookPointers.has(e.pointerId)) return;
    lookPointers.delete(e.pointerId);
    pinch = null;
    // PC: 드래그 없이 짧게 클릭하면 한 발 발사
    if (tap && tap.id === e.pointerId) {
      const quick = performance.now() - tap.t < 420 && tap.moved < 8;
      tap = null;
      if (quick && G.state === 'playing') fire();
    }
  }
  window.addEventListener('pointerup', endLook);
  window.addEventListener('pointercancel', endLook);

  /* PC: 마우스 휠 = 3D 줌 */
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    applyZoom(e.deltaY, e.deltaMode);
  }, { passive: false });

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
  // WASD·방향키 = 전진/후진/좌회전/우회전 (조이스틱과 같은 조향)
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

/** 수심별 수압 감소량 (내구력/초) — 500m부터 시작해 2,800m에서 최대 */
function pressureRateAt(depth) {
  if (depth < PRESSURE_START) return 0;
  const pts = PRESSURE_CURVE;
  for (let i = 1; i < pts.length; i++) {
    if (depth <= pts[i][0]) {
      const [d0, r0] = pts[i - 1];
      const [d1, r1] = pts[i];
      const t = (depth - d0) / (d1 - d0);
      return r0 + (r1 - r0) * t;
    }
  }
  return pts[pts.length - 1][1];
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
  _camClose = false;
  setSubVisible(true);
  resetCameraView();

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
  if (depth < 1800) return { cap: 8, min: 1.6, max: 3.0 };
  return { cap: 7, min: 1.9, max: 3.4 };   // 극심해 해구 — 생물이 드물다
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
  const hp = Math.min(96, 40 + Math.round(Math.max(0, G.depth - 600) / 120) * 6);
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
/* 상어류(백상아리·귀상어)가 사는 가장 깊은 수심 — 이보다 깊은 심해에는 스폰도, 개체도 없다 */
const SHARK_DEPTH_MAX = 650;
const SHARK_FADE_TIME = 1.5;

const ENEMY_STATS = {
  shark: { hp: 2, r: 1.7, score: 130 },   // 백상아리
  hammer: { hp: 3, r: 2.0, score: 180 },  // 귀상어
  puffer: { hp: 2, r: 1.6, score: 90 },   // 독가시 복어
  lion: { hp: 1, r: 1.5, score: 110 },    // 쏠배감펭
  jelly: { hp: 1, r: 1.4, score: 90 },    // 발광 해파리
  angler: { hp: 2, r: 1.6, score: 140 },  // 심해 아귀
};

/** 수심에 따라 그 깊이에 사는 생물이 나온다 — 상어류는 650m 까지만 */
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
  if (depth < SHARK_DEPTH_MAX) {
    // 550~650m — 상어류가 마지막으로 보이는 경계층
    if (roll < 0.4) return 'angler';
    if (roll < 0.62) return 'jelly';
    if (roll < 0.82) return 'hammer';
    return 'shark';
  }
  if (depth < 1300) {
    // 심해 해구 — 상어 대신 아귀와 발광 해파리
    if (roll < 0.55) return 'angler';
    return 'jelly';
  }
  if (depth < 2000) {
    if (roll < 0.46) return 'angler';
    return 'jelly';
  }
  // 초심해 심연·극심해 해구 — 아주 드문 아귀와 발광 해파리뿐
  if (roll < 0.36) return 'angler';
  return 'jelly';
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

function spawnEnemy(opt) {
  const o = opt || {};
  computeForward(forward);
  const ahead = Math.random() < 0.72 ? 1 : -0.35;
  const ang = Math.atan2(forward.x * ahead, forward.z * ahead) + rand(-1.15, 1.15);
  const dist = rand(52, 92);
  const x = o.x !== undefined ? o.x : P.pos.x + Math.sin(ang) * dist;
  const z = o.z !== undefined ? o.z : P.pos.z + Math.cos(ang) * dist;
  const ground = terrainHeight(x, z);
  const y = o.y !== undefined ? o.y : clamp(P.pos.y + rand(-13, 13), ground + 3.5, SURFACE_Y - 8);

  const type = o.type || pickEnemyType(G.depth);
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
  return enemies[enemies.length - 1];
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
  const dropChance = 0.18 + Math.min(0.22, G.depth / 5200);
  if (Math.random() < dropChance) dropItem(p.x, p.y, p.z);
  refreshHud();
}

function dropItem(x, y, z, forced) {
  // 선체 보강 · 긴급 수리도 꾸준히 나오도록 가중치를 둔다
  const pool = G.depth > 1500 ? HADAL_ITEM_POOL : G.depth > 450 ? DEEP_ITEM_POOL : ITEM_POOL;
  const t = forced || pool[Math.floor(Math.random() * pool.length)];
  const mesh = new THREE.Mesh(itemGeos[t], itemMats[t]);
  const halo = spriteGlow(itemHalo[t], 3.0, 0.78);
  mesh.add(halo);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  items.push({ obj: mesh, type: t, phase: Math.random() * 6.28, age: 0 });
}

/* ---------------- 발사 ---------------- */
/* 상하 소프트 자동 조준 —
   정면 기준 좌우 ±12°, 상하 ±15° 창 안의 가장 가까운 적을 찾아
   어뢰의 **상하(pitch) 각도만** 부드럽게 보정한다. 좌우 방향은 플레이어 조준을 존중한다. */
const AIM_WIN_YAW = (12 * Math.PI) / 180;
const AIM_WIN_PITCH = (15 * Math.PI) / 180;
const assistDir = new THREE.Vector3();
const noseVec = new THREE.Vector3();
const assistInfo = { on: false, dyaw: 0, dpitch: 0, corr: 0, d: 0, target: null };

function softAim(fromPos, dir) {
  const aimYaw = Math.atan2(-dir.x, -dir.z);              // 화면 정면의 수평 방위
  const aimPitch = Math.asin(clamp(dir.y, -1, 1));        // 화면 정면의 상하 각도
  let best = null;
  let bestScore = Infinity;

  const consider = (p) => {
    const vx = p.x - fromPos.x;
    const vy = p.y - fromPos.y;
    const vz = p.z - fromPos.z;
    const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (d < 2 || d > 170) return;                         // 바로 앞·사거리 밖은 건너뛴다
    const hd = Math.hypot(vx, vz) || 1e-4;
    const dyaw = angDiff(Math.atan2(-vx, -vz), aimYaw);
    const dpitch = Math.atan2(vy, hd) - aimPitch;
    if (Math.abs(dyaw) > AIM_WIN_YAW) return;             // 좌우 ±12° 밖은 조준을 존중
    if (Math.abs(dpitch) > AIM_WIN_PITCH) return;         // 상하 ±15° 밖은 보정하지 않는다
    const score = Math.abs(dpitch) * 1.7 + Math.abs(dyaw) + d * 0.0015;
    if (score < bestScore) {
      bestScore = score;
      best = { dyaw, dpitch, d };
    }
  };

  for (const e of enemies) {
    if (e.exiting !== undefined) continue;                // 떠나가는 개체는 겨냥하지 않는다
    consider(e.obj.position);
  }
  if (G.boss && !G.boss.dead) consider(G.boss.obj.position);

  if (!best) {
    assistInfo.on = false;
    assistInfo.dyaw = 0;
    assistInfo.dpitch = 0;
    assistInfo.corr = 0;
    assistInfo.target = null;
    return dir;
  }

  // 창 가장자리에서는 조금만, 정면에 가까울수록 끝까지 — 부드럽게 끌어당긴다
  const k = Math.min(1, Math.abs(best.dpitch) / AIM_WIN_PITCH);
  const weight = k < 0.72 ? 1 : 1 - ((k - 0.72) / 0.28) * 0.45;
  const corr = best.dpitch * weight;
  const newPitch = clamp(aimPitch + corr, -1.3, 1.1);
  const cp = Math.cos(newPitch);

  assistInfo.on = true;
  assistInfo.dyaw = best.dyaw;
  assistInfo.dpitch = best.dpitch;
  assistInfo.corr = newPitch - aimPitch;
  assistInfo.d = best.d;

  return assistDir.set(-Math.sin(aimYaw) * cp, Math.sin(newPitch), -Math.cos(aimYaw) * cp);
}

function fire() {
  // 화면 중앙(조준선) 방향으로 발사 — 카메라를 돌리면 그쪽으로 나간다
  noseVec.copy(P.pos).addScaledVector(aim, 2.2);
  const dir = softAim(noseVec, aim);
  const count = G.multi > 0 ? 3 : 1;
  for (let i = 0; i < count; i++) {
    const t = torpedoes.find((x) => !x.active);
    if (!t) break;
    const spread = count === 0 ? 0 : (i - (count - 1) / 2) * 0.1;
    const v = dir.clone().applyAxisAngle(UP, spread);
    t.active = true;
    t.life = 1.8;
    t.mesh.visible = true;
    t.mesh.position.copy(noseVec);
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

/* 초심해·극심해(1,500m+) — 2,500m 바닥까지 버티도록 보강 위주 */
const HADAL_ITEM_POOL = [
  'hull', 'repair', 'hull', 'repair', 'hull', 'repair',
  'shield', 'hull', 'repair', 'bomb', 'rapid', 'hull',
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
    player.frontLight.distance = 20 + deep * 82;
  }
  // 잠수정 아래를 밝히는 빛무리 — 급한 사면을 따라 내려갈 때 발밑이 보이게
  if (player.under) {
    player.under.intensity += ((6 + deep * 320) - player.under.intensity) * k;
    player.under.distance = 20 + deep * 150;
  }

  // 전방 빛줄기(원뿔) — 심해에서 또렷해진다
  const beam = player.beam;
  if (beam && beam.material.uniforms) {
    const u = beam.material.uniforms;
    u.uI.value += ((0.02 + deep * 0.13) - u.uI.value) * k;
    u.uTime.value += dt;
    const widen = 1 + deep * 0.55;
    const stretch = 1 + deep * 1.2;
    beam.scale.set(widen, widen, stretch);
  }

  // 부유물이 탐조등 안에서 반짝이도록 (atmosphere.js)
  if (world && world.atmo) {
    player.spot.getWorldPosition(_beamPos);
    if (player.spot.target) {
      player.spot.target.getWorldPosition(_beamTarget);
      _beamDir.subVectors(_beamTarget, _beamPos).normalize();
    }
    world.atmo.setBeam(
      _beamPos, _beamDir,
      Math.cos(Math.min(1.4, player.spot.angle) * 0.85),
      Math.min(260, player.spot.distance * 0.9),
      0.25 + deep * 1.05
    );
  }
}

const _beamPos = new THREE.Vector3();
const _beamTarget = new THREE.Vector3();
const _beamDir = new THREE.Vector3(0, 0, -1);

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

  /* --- 탱크 조향 ---
     왼쪽 조이스틱 상/하 = 전진·후진, 좌/우 = 잠수정 좌회전·우회전(yaw).
     대각선으로 밀면 달리면서 부드럽게 선회한다. */
  const turnIn = clamp(input.turn, -1, 1);
  const driveIn = clamp(input.move, -1, 1);
  P.yaw -= turnIn * P.turnRate * dt;          // 오른쪽 = 우회전(시계방향)

  // 기울기: 선회 방향으로 몸을 기울인다
  const targetRoll = clamp(-turnIn * 0.4, -0.5, 0.5);
  P.roll += (targetRoll - P.roll) * damp(5.5, dt);

  // 추진 — 방향은 잠수정이 바라보는 정면
  computeHorizontal(horizontal);
  const thrust = driveIn >= 0 ? driveIn * P.speed : driveIn * P.backSpeed;
  // 깊은 심해일수록 상승·하강이 빠르다 (2,500m+까지 답답하지 않게 오가도록 — 최대 약 148 m/s)
  const liftSpeed = P.lift + Math.min(84, Math.max(0, G.depth) * 0.045);
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

  // 기울기 — 상승·하강과 조준 시점을 함께 따른다
  const aimW = clamp(Math.abs(driveIn) * 0.35 + (input.fire ? 0.65 : 0), 0, 1);
  const targetPitch = clamp(
    clamp(P.vel.y * 0.02, -0.26, 0.26) + CAM.pitch * 0.5 * aimW,
    -0.95, 0.95
  );
  P.pitch += (targetPitch - P.pitch) * damp(6, dt);

  updateSubTransform(dt);

  // 수심
  G.depth = Math.max(0, (SURFACE_Y - P.pos.y) * DEPTH_SCALE);
  if (G.depth > G.maxDepth) G.maxDepth = G.depth;

  // 기포 흘리기 — 잠수정 뒤로 맑은 공기방울이 솟아오른다
  G.bubbleTimer -= dt;
  if (G.bubbleTimer <= 0) {
    G.bubbleTimer = 0.11;
    computeForward(forward);
    const bx = P.pos.x - forward.x * 2.4 + rand(-0.3, 0.3);
    const by = P.pos.y - forward.y * 2.4 - 0.2;
    const bz = P.pos.z - forward.z * 2.4;
    fx.emit(
      bx, by, bz,
      rand(-0.8, 0.8), rand(0.4, 1.4), rand(-0.8, 0.8),
      0xe6ffff, rand(0.7, 1.5), rand(1.2, 2.0), 0.9, 0.7
    );
    // 잠수정 프로펠러가 만들어 내는 진짜 공기방울
    if (Math.random() < 0.6) {
      fx.bubble(
        bx + rand(-0.5, 0.5), by + rand(-0.3, 0.3), bz + rand(-0.5, 0.5),
        rand(0.45, 1.1), rand(2.2, 3.6), rand(2.2, 4.2)
      );
    }
  }
}

/* ---------------- 카메라 ---------------- */
function snapCamera() {
  camDirFrom(camLook, CAM.yaw, CAM.pitch);
  CAM.distNow = CAM.dist;
  const lift = Math.min(1.9, CAM.distNow * 0.13);
  camera.position.set(
    P.pos.x - camLook.x * CAM.distNow,
    P.pos.y + CAM.targetY - camLook.y * CAM.distNow + lift,
    P.pos.z - camLook.z * CAM.distNow
  );
  const gy = terrainHeight(camera.position.x, camera.position.z) + 1.8;
  if (camera.position.y < gy) camera.position.y = gy;
  if (camera.position.y > SURFACE_Y - 1.2) camera.position.y = SURFACE_Y - 1.2;
  camera.lookAt(
    P.pos.x + camLook.x * 30,
    P.pos.y + CAM.targetY + camLook.y * 30,
    P.pos.z + camLook.z * 30
  );
  camera.getWorldDirection(aim);
}

let _camClose = false;
function setSubVisible(v) {
  player.obj.traverse((o) => {
    if (o.isMesh) o.visible = v;
  });
}

function updateCamera(dt) {
  // 카메라가 잠수정 뒤를 부드럽게 따라간다
  //  · 사용자가 오른쪽 빈 화면을 드래그하는 동안은 시점을 가로채지 않는다
  //  · 조이스틱으로 달리거나 선회할 때는 잠수정 진행 방향 뒤로 정렬된다
  const sinceLook = nowSec() - lastLookAt;
  const turning = Math.abs(input.turn) > 0.12;
  const driving = turning || Math.abs(input.move) > 0.1;
  if (sinceLook > 0.35 && driving) {
    const k = turning ? 7.5 : 3.2;
    CAM.yaw += angDiff(P.yaw, CAM.yaw) * damp(k, dt);
  }

  camDirFrom(camLook, CAM.yaw, CAM.pitch);
  CAM.distNow += (CAM.dist - CAM.distNow) * damp(11, dt);

  const shake = G.shake;
  const sx = shake > 0 ? rand(-1, 1) * shake * 0.45 : 0;
  const sy = shake > 0 ? rand(-1, 1) * shake * 0.45 : 0;
  const tx = P.pos.x;
  const ty = P.pos.y + CAM.targetY;
  const tz = P.pos.z;
  // 가까이 당길수록 위쪽 보정을 줄여 1인칭처럼 자연스럽게
  const lift = Math.min(1.9, CAM.distNow * 0.13);

  camTmp.set(
    tx - camLook.x * CAM.distNow + sx,
    ty - camLook.y * CAM.distNow + lift + sy,
    tz - camLook.z * CAM.distNow
  );
  // 해저 지형·수면 클램핑 (카메라가 바닥을 뚫지 않게)
  const gy = terrainHeight(camTmp.x, camTmp.z) + 1.8;
  if (camTmp.y < gy) camTmp.y = gy;
  if (camTmp.y > SURFACE_Y - 1.2) camTmp.y = SURFACE_Y - 1.2;

  camera.position.lerp(camTmp, damp(CAM.distNow < 7 ? 17 : 9, dt));
  const gy2 = terrainHeight(camera.position.x, camera.position.z) + 1.6;
  if (camera.position.y < gy2) camera.position.y = gy2;

  camera.lookAt(
    tx + camLook.x * 30,
    ty + camLook.y * 30,
    tz + camLook.z * 30
  );
  camera.rotation.z += P.roll * 0.12;
  camera.getWorldDirection(aim);

  // 아주 가까이 당기면 잠수정 몸체를 숨겨 1인칭 조종석 시점처럼
  const close = CAM.distNow < 4.6;
  if (close !== _camClose) {
    _camClose = close;
    setSubVisible(!close);
  }

  /* 미세 흔들림 — 물속 부력에 떠 있는 느낌 (아주 작게) */
  applyCameraSway(dt);

  G.shake = Math.max(0, G.shake - dt * 2.2);
}

/* 카메라가 물에 떠 있는 듯한 아주 미세한 흔들림 */
const _swayT = { v: 0 };
function applyCameraSway(dt) {
  _swayT.v += dt;
  const t = _swayT.v;
  const amp = 1 + Math.min(0.6, G.shake);
  camera.position.x += (Math.sin(t * 0.37) * 0.055 + Math.sin(t * 0.91 + 1.7) * 0.025) * amp;
  camera.position.y += (Math.cos(t * 0.29) * 0.045 + Math.sin(t * 1.13 + 0.6) * 0.018) * amp;
  camera.position.z += (Math.sin(t * 0.33 + 2.2) * 0.04 + Math.cos(t * 0.77) * 0.02) * amp;
  camera.rotation.z += Math.sin(t * 0.23) * 0.0035;
}

/* ---------------- 적 갱신 ---------------- */
/** 종별 기준 속도 — 이보다 빨리 헤엄치는 개체가 많을수록 꼬리 박자가 잦아진다 */
const SWIM_BASE_SPEED = { shark: 14, hammer: 10.5, puffer: 3.3, lion: 3.3, angler: 5.2 };
const swimRateNow = {};

function updateSwimRates(dt) {
  const sum = {};
  const n = {};
  for (const e of enemies) {
    const base = SWIM_BASE_SPEED[e.type];
    if (!base) continue;
    sum[e.type] = (sum[e.type] || 0) + e.speed;
    n[e.type] = (n[e.type] || 0) + 1;
  }
  for (const k in sum) {
    const want = Math.max(0.7, Math.min(1.45, sum[k] / n[k] / SWIM_BASE_SPEED[k]));
    const cur = swimRateNow[k] === undefined ? want : swimRateNow[k];
    swimRateNow[k] = cur + (want - cur) * Math.min(1, dt * 1.2);
    setSwimRate(k, swimRateNow[k]);
  }
}

function updateEnemies(dt) {
  updateSwimRates(dt);
  const pp = P.pos;
  // 깊은 심해로 내려가면 상어류는 얕은 쪽으로 떠나간다 (스폰도 끊긴다)
  const deepNow = G.depth > SHARK_DEPTH_MAX;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const o = e.obj;
    e.age += dt;
    e.phase += dt * e.swirl;
    if (e.bumpCd > 0) e.bumpCd -= dt;
    if (e.hitCd > 0) e.hitCd -= dt;

    // 퇴장 중인 상어 — 멀어지며 서서히 사라진다
    if (e.exiting !== undefined) {
      e.exiting -= dt;
      o.position.y += 4.5 * dt;
      o.scale.setScalar(e.scale0 * Math.max(0, e.exiting / SHARK_FADE_TIME));
      if (e.exiting <= 0) {
        scene.remove(o);
        enemies.splice(i, 1);
      }
      continue;
    }
    if (deepNow && (e.type === 'shark' || e.type === 'hammer') && e.exiting === undefined) {
      e.exiting = SHARK_FADE_TIME;
      continue;
    }

    tmpVec.copy(pp).sub(o.position);
    const dist = tmpVec.length() || 1;
    tmpVec.multiplyScalar(1 / dist);

    if (e.type === 'shark' || e.type === 'hammer') {
      // 유도 돌진 + 좌우 흔들림
      const side = tmpVec2.set(-tmpVec.z, 0, tmpVec.x).normalize();
      o.position.addScaledVector(tmpVec, e.speed * dt);
      o.position.addScaledVector(side, Math.sin(e.phase * 2) * e.swayAmp * dt);
      o.position.y += Math.sin(e.phase * 1.7) * 1.6 * dt;
      const yaw = Math.atan2(-tmpVec.x, -tmpVec.z);
      // 급하게 방향을 틀수록 몸을 안쪽으로 기울인다 (banking roll)
      const dYaw = e.prevYaw === undefined ? 0 : angDiff(yaw, e.prevYaw);
      e.prevYaw = yaw;
      const turnRate = dt > 0 ? dYaw / dt : 0;
      const bankWant = Math.max(-0.45, Math.min(0.45, turnRate * 0.1));
      e.bank = (e.bank || 0) + (bankWant - (e.bank || 0)) * Math.min(1, dt * 5);
      o.rotation.y = yaw;
      o.rotation.x = Math.asin(clamp(tmpVec.y, -1, 1)) * 0.7;
      o.rotation.z = Math.sin(e.phase * 2) * 0.14 + e.bank;
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
  forward.copy(aim);
  let best = null;
  let bestScore = -Infinity;
  for (const e of enemies) {
    if (e.exiting !== undefined) continue;   // 떠나가는 상어는 겨냥하지 않는다
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

/* ---------------- 화질 프리셋 ---------------- */
function currentPreset() {
  if (qualityMode !== 'auto' && QUALITY[qualityMode]) return qualityMode;
  return autoPreset;
}

function loadQuality() {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v === 'auto' || QUALITY[v]) qualityMode = v;
  } catch (e) { /* noop */ }
}

function applyQuality(name) {
  const preset = QUALITY[name] || QUALITY.high;
  pixelRatio = Math.min(window.devicePixelRatio || 1, preset.pixelRatio);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.userData.viewHeight = Math.round(window.innerHeight * pixelRatio);
  if (pipeline) {
    pipeline.setQuality(name);
    pipeline.resize(true);
  }
  if (world) world.setQuality(preset);
  updateQualityUI();
}

function setQualityMode(mode) {
  qualityMode = QUALITY[mode] ? mode : 'auto';
  // 자동으로 돌아오면 기기 기준값에서 다시 시작한다 (자동 하향은 그 뒤에 판단)
  if (qualityMode === 'auto') {
    autoPreset = IS_IOS ? 'medium' : 'high';
    G.lowWindows = 0;
    G.runTime = 0;
  }
  try { localStorage.setItem(QUALITY_KEY, qualityMode); } catch (e) { /* noop */ }
  applyQuality(currentPreset());
}

function updateQualityUI() {
  if (!el.qualityBtns) return;
  const cur = qualityMode === 'auto' ? 'auto' : qualityMode;
  Array.prototype.forEach.call(el.qualityBtns.children, (b) => {
    b.classList.toggle('on', b.dataset.q === cur);
  });
  if (el.qualityNote) {
    el.qualityNote.textContent = qualityMode === 'auto'
      ? '자동 · 현재 ' + (QUALITY[currentPreset()] || QUALITY.high).name
      : (QUALITY[cur] || QUALITY.high).name;
  }
}

/** 프레임이 무너지면 자동 모드에서 한 단계씩 내린다 */
function autoTune(fps) {
  if (qualityMode !== 'auto' || G.runTime < 6) return;
  if (fps < 46) {
    G.lowWindows = (G.lowWindows || 0) + 1;
    if (G.lowWindows >= 2) {
      G.lowWindows = 0;
      if (autoPreset === 'high') { autoPreset = 'medium'; applyQuality('medium'); }
      else if (autoPreset === 'medium') { autoPreset = 'low'; applyQuality('low'); }
    }
  } else if (fps > 54) {
    G.lowWindows = 0;
  }
}

/* ---------------- 프레임 렌더 ---------------- */
const _sunDir = new THREE.Vector3(-0.31, 0.93, 0.23).normalize();
const _sunWorld = new THREE.Vector3();
const _upWorld = new THREE.Vector3();
const _camDirV = new THREE.Vector3();

function renderFrame(dt) {
  if (pipeline) {
    if (pipeline.ok) {
      const depth = Math.max(0, G.depth || 0);
      const u = pipeline.uni;
      u.uDepth.value = Math.min(1, depth / 900);
      // 깊어질수록 노출을 조금 올려 심해가 완전히 검게 죽지 않게
      u.uExposure.value = 1.12 + 0.34 * Math.min(1, depth / 1400);
      /* 표층에서만 위에서 내려오는 밝은 물빛
   — 얕을수록 화면 위쪽이 환하고, 깊어지면 사라진다 */
      u.uTopGlow.value = 0.055 * Math.max(0, 1 - depth / 700);
      /* 하늘(위쪽) 방향을 화면 좌표로 — 물빛 돔의 중심 */
      _upWorld.copy(camera.position).addScaledVector(UP, 80).project(camera);
      if (_upWorld.z < 1) {
        u.uUpUV.value.set(_upWorld.x * 0.5 + 0.5, _upWorld.y * 0.5 + 0.5);
        u.uUpI.value = 0.10 * Math.max(0.28, 1 - depth / 1400);
      } else {
        u.uUpI.value = 0.035;
      }
      // 맑고 생동감 있는 바다 — 채도를 살짝 올려 색이 회색으로 죽지 않게
      u.uSat.value = 1.08 + 0.10 * Math.min(1, depth / 1200);
      /* 태양 빛줄기는 바라보는 방향과 수심에 따라 세기가 달라진다 */
      _sunWorld.copy(camera.position).addScaledVector(_sunDir, 420);
      camera.getWorldDirection(_camDirV);
      const toward = Math.max(0, _camDirV.dot(_sunDir));
      const k = Math.max(0, 1 - depth / 460);
      pipeline.setSun(_sunWorld, camera, 0.85 * k * k * (0.18 + 0.82 * toward * toward));
    }
    pipeline.render(dt);
  } else {
    renderer.render(scene, camera);
  }
}

/* ---------------- 루프 ---------------- */
let acc = 0;
let frames = 0;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  ANIM.time.value += dt;
  G.runTime = (G.runTime || 0) + dt;

  frames++;
  acc += dt;
  if (acc > 2.5) {
    const fps = frames / acc;
    frames = 0;
    acc = 0;
    G.fps = Math.round(fps);
    autoTune(fps);
  }

  if (G.state === 'playing') {
    updateGame(dt);
  } else if (G.state === 'menu' || G.state === 'over') {
    updateIdle(dt);
  } else {
    fx.update(0, camera);
  }

  renderFrame(dt);
}

function updateIdle(dt) {
  G.elapsed += dt;
  if (_camClose) {
    _camClose = false;
    setSubVisible(true);
  }
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

/* ---------------- 해저 기포 분출구 ----------------
   참고 이미지처럼 바닥에서 맑은 공기방울 기둥이 수직으로 솟아오른다. */
const vents = [];
function updateVentBubbles(dt) {
  // 주변에 분출구가 모자라면 해저에 새로 생긴다
  for (let tries = 0; tries < 10 && vents.length < 3; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = 16 + Math.random() * 72;
    const x = P.pos.x + Math.cos(a) * r;
    const z = P.pos.z + Math.sin(a) * r;
    const gy = terrainHeight(x, z);
    if (gy > SURFACE_Y - 8) continue;
    if (Math.abs(gy - P.pos.y) > 70) continue;      // 너무 위·아래 바닥은 건너뛴다
    vents.push({ x, y: gy + 0.5, z, t: Math.random() * 0.9 });
  }
  for (let i = vents.length - 1; i >= 0; i--) {
    const v = vents[i];
    const away = Math.hypot(v.x - P.pos.x, v.z - P.pos.z);
    if (away > 165) {
      vents.splice(i, 1);
      continue;
    }
    v.t -= dt;
    if (v.t > 0) continue;
    v.t = 0.1 + Math.random() * 0.16;
    fx.bubble(
      v.x + rand(-0.7, 0.7), v.y + rand(0, 1.4), v.z + rand(-0.7, 0.7),
      rand(0.5, 1.5), rand(3.4, 5.2), rand(2.4, 4.2)
    );
    if (Math.random() < 0.28) {
      fx.bubble(
        v.x + rand(-1.4, 1.4), v.y + rand(1.0, 4.0), v.z + rand(-1.4, 1.4),
        rand(0.4, 0.9), rand(2.6, 4.0), rand(2.0, 3.4)
      );
    }
  }
}

function updateGame(dt) {
  G.elapsed += dt;
  const t = G.elapsed;

  updatePlayer(dt);
  updateCamera(dt);
  world.update(dt, P.pos);
  updateVentBubbles(dt);

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
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  camera.userData.viewHeight = Math.round(h * pixelRatio);
  if (pipeline) pipeline.resize(true);
}

/* ---------------- 검증용: 생물 모델 미리보기 ---------------- */
const PREVIEW_MAKERS = {
  humpback: makeHumpbackWhale, blue: makeBlueWhale, orca: makeOrca, sperm: makeSpermWhale,
  manta: makeMantaRay, eagle: makeEagleRay, stingray: makeStingray, turtle: makeTurtle,
  shark: makeShark, hammer: makeHammerhead, puffer: makePuffer,
  lion: makeLionfish, angler: makeAnglerfish,
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
    // 어류·상어는 몸통 S자 파동을 공용 유영 함수로 그린다
    if (p.model && p.model.bend) swim(p.model, ANIM.time.value);
  }
}

function bindButtons() {
  if (el.qualityBtns) {
    el.qualityBtns.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('.qbtn') : null;
      if (!b) return;
      e.preventDefault();
      setQualityMode(b.dataset.q);
    });
  }

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
  $('btn-cam').addEventListener('click', () => {
    resetCameraView();
    if (G.state === 'playing') toast('시점 초기화 · 줌 15');
  });
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

/* ---------------- 검증용: 시점·줌 자체 테스트 (?camtest) ----------------
   실제 손가락 대신 합성 Touch/Pointer 이벤트를 게임 화면에 던져
   "이벤트 → 핸들러 → 카메라 상태" 경로가 살아 있는지 확인한다.
   (js/zoom-guard.js 의 ?zoomtest 와 같은 방식, 평소에는 돌지 않는다) */
async function runCamSelfTest() {
  const R = (window.__camTest = {});
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = el.joystick.querySelector('.joy-base');
  const touch = (id, x, y) => new Touch({ identifier: id, target: canvas, clientX: x, clientY: y });
  const fireTouch = (type, touches, changed) => {
    const ev = new TouchEvent(type, {
      touches, targetTouches: touches, changedTouches: changed || touches,
      bubbles: true, cancelable: true,
    });
    canvas.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  try {
    if (G.state !== 'playing') startGame();
    await wait(400);

    /* 1) 한 손가락 드래그 → 시점 회전 (yaw·pitch) */
    const y0 = CAM.yaw;
    const p0 = CAM.pitch;
    fireTouch('touchstart', [touch(1, 1200, 420)], [touch(1, 1200, 420)]);
    for (let i = 1; i <= 8; i++) {
      const t = touch(1, 1200 - i * 22, 420 + i * 9);
      fireTouch('touchmove', [t], [t]);
    }
    fireTouch('touchend', [], [touch(1, 1024, 492)]);
    R.drag = {
      yaw: +CAM.yaw.toFixed(4), pitch: +CAM.pitch.toFixed(4),
      dYaw: +(CAM.yaw - y0).toFixed(4), dPitch: +(CAM.pitch - p0).toFixed(4),
      pass: Math.abs(CAM.yaw - y0) > 0.3 && CAM.pitch < p0 - 0.02,
    };

    /* 2) 두 손가락 핀치 → 3D 줌인·줌아웃 (최소·최대 거리 클램프) */
    // (a) 벌리면 줌인 — 최소 거리까지
    CAM.dist = 15;
    fireTouch('touchstart', [touch(2, 700, 500), touch(3, 1000, 500)], [touch(3, 1000, 500)]);
    for (let i = 1; i <= 8; i++) {
      const a = touch(2, 700 - i * 100, 500);
      const b = touch(3, 1000 + i * 100, 500);
      fireTouch('touchmove', [a, b], [b]);
    }
    const nearDist = CAM.dist;
    fireTouch('touchend', [], [touch(2, 700, 500), touch(3, 1000, 500)]);
    // (b) 오므리면 줌아웃 — 최대 거리까지
    CAM.dist = 15;
    fireTouch('touchstart', [touch(4, 600, 500), touch(5, 900, 500)], [touch(5, 900, 500)]);
    for (let i = 1; i <= 8; i++) {
      const a = touch(4, 600 + i * 20, 500);
      const b = touch(5, 900 - i * 20, 500);
      fireTouch('touchmove', [a, b], [b]);
    }
    const farDist = CAM.dist;
    fireTouch('touchend', [], [touch(4, 760, 500), touch(5, 740, 500)]);
    R.pinch = {
      near: +nearDist.toFixed(2), far: +farDist.toFixed(2),
      min: CAM.minDist, max: CAM.maxDist,
      pass: nearDist <= CAM.minDist + 0.01 && farDist >= CAM.maxDist - 0.01,
    };

    /* 3) 마우스 휠 줌 */
    CAM.dist = 15;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
    const wheelIn = CAM.dist;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 900, bubbles: true, cancelable: true }));
    const wheelOut = CAM.dist;
    R.wheel = { in: +wheelIn.toFixed(2), out: +wheelOut.toFixed(2), pass: wheelIn < 14 && wheelOut > wheelIn };

    /* 4) 조이스틱(왼손) + 시점(오른손) 동시 — 멀티터치 분리 */
    CAM.dist = 15;
    resetCameraView();
    base.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 91, pointerType: 'touch', bubbles: true, cancelable: true, clientX: 150, clientY: 820,
    }));
    base.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 91, pointerType: 'touch', bubbles: true, clientX: 150, clientY: 780,
    }));
    const joySnap = { move: +joy.move.toFixed(2), turn: +joy.turn.toFixed(2) };
    const yawBefore = CAM.yaw;
    const pitchBefore = CAM.pitch;
    fireTouch('touchstart', [touch(6, 1500, 380)], [touch(6, 1500, 380)]);
    for (let i = 1; i <= 8; i++) {
      const t = touch(6, 1500 - i * 20, 380 + i * 6);
      fireTouch('touchmove', [t], [t]);
    }
    fireTouch('touchend', [], [touch(6, 1340, 428)]);
    R.multiTouch = {
      joy: joySnap,
      dYaw: +(CAM.yaw - yawBefore).toFixed(4), dPitch: +(CAM.pitch - pitchBefore).toFixed(4),
      pass: Math.abs(joySnap.move) > 0.1 && Math.abs(CAM.yaw - yawBefore) > 0.1 && CAM.pitch < pitchBefore - 0.01,
    };
    base.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 91, pointerType: 'touch', bubbles: true, clientX: 150, clientY: 780,
    }));

    /* 5) 시점 초기화 버튼과 같은 경로 */
    resetCameraView();
    R.reset = { yaw: +CAM.yaw.toFixed(3), pitch: +CAM.pitch.toFixed(3), dist: CAM.dist };
    R.pass = !!(R.drag.pass && R.pinch.pass && R.wheel.pass && R.multiTouch.pass);
    R.errors = window.__errors || [];
  } catch (err) {
    R.fail = String(err && err.message ? err.message : err);
    R.pass = false;
  }
  return R;
}

/* ---------------- 검증용: 조이스틱 조향 자체 테스트 (?steertest) ----------------
   실제 손가락 대신 합성 Pointer 이벤트를 조이스틱에 던져
   "좌/우 = 선회(yaw)", "상/하 = 전진/후진", "카메라 뒤따라오기"를 확인한다. */
async function runSteerSelfTest() {
  const R = (window.__steerTest = {});
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = el.joystick.querySelector('.joy-base');
  const rect = base.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const rad = rect.width * 0.42;
  const ev = (type, x, y) => base.dispatchEvent(new PointerEvent(type, {
    pointerId: 77, pointerType: 'touch', isPrimary: true,
    bubbles: true, cancelable: true, clientX: x, clientY: y,
  }));

  try {
    if (G.state !== 'playing') startGame();
    await wait(400);

    const t0 = () => G.elapsed;

    /* 1) 오른쪽으로 밀면 우회전 — yaw 가 줄어든다 (게임 시간 기준 각속도) */
    let e0 = t0();
    const yaw0 = P.yaw;
    ev('pointerdown', cx, cy);
    ev('pointermove', cx + rad * 0.95, cy);
    await wait(1500);
    const dtR = Math.max(0.001, t0() - e0);
    const yawRight = P.yaw;
    const rateR = (yawRight - yaw0) / dtR;
    R.turnRight = {
      dYaw: +(yawRight - yaw0).toFixed(3),
      gameSeconds: +dtR.toFixed(2),
      radPerSec: +rateR.toFixed(2),
      joyTurn: +joy.turn.toFixed(2),
      pass: rateR < -0.9 && joy.turn > 0.5,
    };

    /* 2) 왼쪽으로 밀면 좌회전 — yaw 가 늘어난다 */
    e0 = t0();
    ev('pointermove', cx - rad * 0.95, cy);
    await wait(1500);
    const dtL = Math.max(0.001, t0() - e0);
    const yawLeft = P.yaw;
    const rateL = (yawLeft - yawRight) / dtL;
    R.turnLeft = {
      dYaw: +(yawLeft - yawRight).toFixed(3),
      radPerSec: +rateL.toFixed(2),
      pass: rateL > 0.9,
    };

    /* 3) 위로 밀면 전진 — 잠수정이 바라보는 쪽으로 나아간다 */
    ev('pointerup', cx, cy);
    await wait(150);
    const yawFwd = P.yaw;
    const fwdDir = new THREE.Vector3(-Math.sin(yawFwd), 0, -Math.cos(yawFwd));
    const velAlong = (d) => P.vel.x * d.x + P.vel.z * d.z;
    // 기기의 프레임레이트와 무관하게, 실제로 전진 속도가 붙을 때까지 기다린다
    const waitSpeed = async (sign, thr, maxMs) => {
      const t0 = performance.now();
      while (performance.now() - t0 < maxMs) {
        if (sign * velAlong(fwdDir) > thr) break;
        await wait(200);
      }
      return sign * velAlong(fwdDir);
    };

    const q0 = P.pos.clone();
    e0 = t0();
    ev('pointerdown', cx, cy);
    ev('pointermove', cx, cy - rad * 0.95);
    const vFwd = await waitSpeed(1, 18, 20000);
    await wait(1500);
    const dtF = Math.max(0.001, t0() - e0);
    const p1 = P.pos.clone();
    const movedDist = Math.hypot(p1.x - q0.x, p1.z - q0.z);
    const fwdDot = movedDist > 0.01
      ? ((p1.x - q0.x) * fwdDir.x + (p1.z - q0.z) * fwdDir.z) / movedDist
      : 0;
    R.forward = {
      speed: +vFwd.toFixed(1),
      moved: +movedDist.toFixed(2),
      unitsPerSec: +(movedDist / dtF).toFixed(1),
      dot: +fwdDot.toFixed(3),
      camGap: +Math.abs(angDiff(P.yaw, CAM.yaw)).toFixed(3),
      pass: vFwd > 15 && movedDist / dtF > 10 && fwdDot > 0.85,
    };

    /* 4) 아래로 밀면 후진 — 정면 반대쪽으로 물러난다 */
    ev('pointermove', cx, cy + rad * 0.95);
    const vBack = await waitSpeed(-1, 3, 25000);
    const q1 = P.pos.clone();
    e0 = t0();
    await wait(1500);
    const dtB = Math.max(0.001, t0() - e0);
    const p3 = P.pos.clone();
    const backDist = Math.hypot(p3.x - q1.x, p3.z - q1.z);
    const backDot = backDist > 0.01
      ? ((p3.x - q1.x) * fwdDir.x + (p3.z - q1.z) * fwdDir.z) / backDist
      : 0;
    R.backward = {
      speed: +vBack.toFixed(1),
      moved: +backDist.toFixed(2),
      unitsPerSec: +(backDist / dtB).toFixed(1),
      dot: +backDot.toFixed(3),
      pass: vBack > 2 && backDist / dtB > 3 && backDot < -0.5,
    };
    ev('pointerup', cx, cy);

    /* 5) 선회하는 동안 카메라가 잠수정 뒤를 따라온다 */
    ev('pointerdown', cx, cy);
    ev('pointermove', cx + rad * 0.95, cy);
    await wait(1800);
    const gap = Math.abs(angDiff(P.yaw, CAM.yaw));
    R.camFollow = { gap: +gap.toFixed(3), pass: gap < 0.35 };
    ev('pointerup', cx, cy);
    await wait(150);

    /* 6) 수심별 스폰 표 — 650m 아래에는 상어류가 없다 */
    const table = {};
    for (const d of [100, 400, 600, 700, 1000, 1500, 2000, 2500]) {
      const t = {};
      for (let i = 0; i < 500; i++) {
        const k = pickEnemyType(d);
        t[k] = (t[k] || 0) + 1;
      }
      table[d] = t;
    }
    R.spawnTable = table;
    const sharkFree = [700, 1000, 1500, 2000, 2500].every((d) => !table[d].shark && !table[d].hammer);
    R.sharkFreeDeeperThan650 = sharkFree;

    /* 7) 해구 깊이 — 2,500m 아래 바닥이 실제로 존재하는가 */
    R.deepestTerrain = window.__abyss.maxTerrainDepth(1800);
    R.pass = !!(R.turnRight.pass && R.turnLeft.pass && R.forward.pass &&
      R.backward.pass && R.camFollow.pass && sharkFree &&
      R.deepestTerrain.depth >= 2500);
    R.errors = (window.__errors || []).slice(0, 5);
  } catch (err) {
    R.fail = String(err && err.message ? err.message : err);
    R.pass = false;
  }
  return R;
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
  renderFrame(0);

  setTimeout(() => el.loading.classList.add('done'), 180);
  setTimeout(() => { el.loading.style.display = 'none'; }, 800);

  G.pingTimer = 4;
  const params = new URLSearchParams(location.search);
  if (params.has('debug') || params.has('steertest')) {
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
        beamOpacity: player.beam && player.beam.material.uniforms ? player.beam.material.uniforms.uI.value : null,
        beamScale: player.beam ? player.beam.scale.z : null,
      }),
      cam: () => ({
        yaw: +CAM.yaw.toFixed(3), pitch: +CAM.pitch.toFixed(3),
        dist: +CAM.dist.toFixed(2), distNow: +CAM.distNow.toFixed(2),
        subYaw: +P.yaw.toFixed(3), subPitch: +P.pitch.toFixed(3),
        pos: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
        aim: [+aim.x.toFixed(3), +aim.y.toFixed(3), +aim.z.toFixed(3)],
        subVisible: !_camClose,
        errors: (window.__errors || []).length,
        fps: G.fps || 0,
      }),
      setCam: (yaw, pitch, dist) => {
        if (yaw !== undefined && yaw !== null) CAM.yaw = yaw;
        if (pitch !== undefined && pitch !== null) CAM.pitch = pitch;
        if (dist !== undefined && dist !== null) CAM.dist = dist;
        snapCamera();
      },
      CAM, aim, applyLook, applyPinch, applyZoom, resetCameraView, snapCamera,
      camTest: () => window.__camTest,
      joyInput: () => ({ move: joy.move, turn: joy.turn, lift: joy.lift }),
      texInfo: () => {
        const t = world.tex || {};
        return { keys: Object.keys(t), ms: t.ms };
      },
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
      /* 조향·추적 검증용 */
      steer: () => ({
        subYaw: +P.yaw.toFixed(3),
        camYaw: +CAM.yaw.toFixed(3),
        camGap: +angDiff(P.yaw, CAM.yaw).toFixed(3),
        move: +joy.move.toFixed(2), turn: +joy.turn.toFixed(2),
        vel: +P.vel.length().toFixed(2),
        pos: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)],
      }),
      enemyCounts: () => {
        const c = {};
        for (const e of enemies) c[e.type] = (c[e.type] || 0) + 1;
        return c;
      },
      /* ---- 자동 조준·기포·고래 꼬리 검증용 ---- */
      assist: () => Object.assign({}, assistInfo),
      spawnAt: (type, x, y, z) => {
        const e = spawnEnemy({ type, x, y, z });
        if (!e) return null;
        return {
          type: e.type, hp: e.hp, r: +e.r.toFixed(2),
          pos: [+e.obj.position.x.toFixed(2), +e.obj.position.y.toFixed(2), +e.obj.position.z.toFixed(2)],
        };
      },
      clearEnemies: () => {
        for (const e of enemies) scene.remove(e.obj);
        enemies.length = 0;
        return true;
      },
      torpInfo: () => torpedoes.filter((t) => t.active).map((t) => {
        const sp = t.vel.length() || 1;
        return {
          pos: [+t.mesh.position.x.toFixed(2), +t.mesh.position.y.toFixed(2), +t.mesh.position.z.toFixed(2)],
          pitch: +((Math.asin(clamp(t.vel.y / sp, -1, 1)) * 180) / Math.PI).toFixed(2),
          speed: +sp.toFixed(1),
        };
      }),
      bubbles: () => fx.bubblesAlive(),
      /* 고래 꼬리지느러미가 몸통과 한 곡선으로 이어지는지 수치로 확인 */
      seamInfo: (kind) => {
        const makers = {
          humpback: makeHumpbackWhale, orca: makeOrca,
          sperm: makeSpermWhale, blue: makeBlueWhale,
        };
        const make = makers[kind || 'humpback'] || makeHumpbackWhale;
        const m = make();
        m.group.position.set(0, 0, 0);
        m.group.updateMatrixWorld(true);
        const meshes = [];
        m.core.traverse((o) => {
          if (o.isMesh && o.geometry.attributes && o.geometry.attributes.aBend) meshes.push(o);
        });
        if (meshes.length < 2) return { kind, meshes: meshes.length, pass: false };
        meshes.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count);
        const body = meshes[0];
        const fluke = meshes[meshes.length - 1];
        const zr = (mesh) => {
          const p = mesh.geometry.attributes.position;
          let lo = Infinity;
          let hi = -Infinity;
          const ab = mesh.geometry.attributes.aBend;
          let abLo = Infinity;
          let abHi = -Infinity;
          for (let i = 0; i < p.count; i++) {
            const z = p.getZ(i);
            if (z < lo) lo = z;
            if (z > hi) hi = z;
            const b = ab.getX(i);
            if (b < abLo) abLo = b;
            if (b > abHi) abHi = b;
          }
          return { zMin: +lo.toFixed(3), zMax: +hi.toFixed(3), bendMin: +abLo.toFixed(3), bendMax: +abHi.toFixed(3) };
        };
        const bw = new THREE.Vector3();
        const fw = new THREE.Vector3();
        body.getWorldPosition(bw);
        fluke.getWorldPosition(fw);
        const bz = zr(body);
        const fz = zr(fluke);
        return {
          kind: kind || 'humpback',
          body: bz, fluke: fz,
          sameMaterial: body.material === fluke.material,
          sameWorldOrigin: +bw.distanceTo(fw).toFixed(5),
          overlap: +(bz.zMax - fz.zMin).toFixed(3),   // 몸통 끝과 꼬리 앞날이 겹치는 길이
          bendContinuous: !(fz.bendMin > bz.bendMax + 0.001),
          pass: body.material === fluke.material && bw.distanceTo(fw) < 1e-4 && bz.zMax - fz.zMin > 0,
        };
      },
      spawnTable: (depth, n) => {
        const c = {};
        const total = n || 400;
        for (let i = 0; i < total; i++) {
          const t = pickEnemyType(depth);
          c[t] = (c[t] || 0) + 1;
        }
        return c;
      },
      /** 이 지역에서 가장 깊은 해저 수심(m) — 해구 확장 검증용 */
      maxTerrainDepth: (r) => {
        const R = r || 1800;
        let best = 0;
        let at = [0, 0];
        for (let x = -R; x <= R; x += 60) {
          for (let z = -R; z <= R; z += 60) {
            const d = (SURFACE_Y - terrainHeight(x, z)) * DEPTH_SCALE;
            if (d > best) { best = d; at = [x, z]; }
          }
        }
        return { depth: +best.toFixed(0), at };
      },
      /** 수면 바로 아래에서 바닥까지 실제로 내려가 본다 (수압·버팀 검증용) */
      fullDescent: async (m) => {
        const target = m || 2500;
        const t0 = performance.now();
        G.hull = G.maxHull = Math.max(G.maxHull, 300);
        P.pos.set(210, SURFACE_Y - 6, -1430);
        P.vel.set(0, 0, 0);
        G.depth = 0;
        joy.lift = -1;
        let minHull = G.hull;
        while (G.depth < target && performance.now() - t0 < 45000) {
          await new Promise((r) => setTimeout(r, 100));
          minHull = Math.min(minHull, G.hull);
          if (G.state !== 'playing') break;
        }
        joy.lift = 0;
        const y = P.pos.y;
        await new Promise((r) => setTimeout(r, 700));
        return {
          depth: +G.depth.toFixed(0),
          seconds: +((performance.now() - t0) / 1000).toFixed(1),
          hullLeft: +G.hull.toFixed(0),
          minHull: +minHull.toFixed(0),
          groundY: +terrainHeight(P.pos.x, P.pos.z).toFixed(1),
          y: +y.toFixed(1),
          state: G.state,
        };
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
  if (params.has('camtest')) {
    runCamSelfTest();
  }
  if (params.has('steertest')) {
    runSteerSelfTest();
  }
}

boot();
