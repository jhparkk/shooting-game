/* =========================================================
   ABYSS DIVER — 3D 자유 유영 심해 탐험 슈팅
   Three.js 기반, 빌드 없이 단일 페이지로 실행
   ========================================================= */
import * as THREE from 'three';
import { Sound } from './audio.js?v=20261120z7';
import { World, ZONES, SURFACE_Y, DEPTH_SCALE, terrainHeight, zoneIndexForDepth } from './world.js?v=20261120z7';
import { RenderPipeline, QUALITY } from './render.js?v=20261120z7';
import {
  makeSubmarine, makeShark, makeHammerhead, makePuffer, makeLionfish,
  makeAnglerfish, makeJellyfish, makeKraken, spriteGlow, swim, setSwimRate, ANIM,
  makeMegalodon, makeLeviathan, makeVoidQueen,
  makeHumpbackWhale, makeBlueWhale, makeOrca, makeSpermWhale,
  makeMantaRay, makeEagleRay, makeStingray, makeTurtle,
} from './models.js?v=20261120z7';
import { FX } from './fx.js?v=20261120z7';
import { Currents, currentWeightForLength } from './currents.js?v=20261120z7';

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
/* 수심(m) → 초당 내구력 감소 — 1,000m에서 바로 티지지 않고 3,500m+까지 완만하게 오른다 */
const PRESSURE_CURVE = [
  [500, 0.30],
  [900, 0.85],
  [1300, 1.50],
  [1800, 2.40],
  [2400, 3.80],
  [2800, 4.60],
  [3200, 5.20],
  [3600, 5.80],
];
/* 심해 적응 — 처음 닿는 수심 이정표마다 압력 저항이 오른다.
   최대 내구력은 오르지 않는다 — 선체 보강 모듈로만 100 → 500 까지 올린다. */
const ADAPT_STEPS = [600, 1200, 2000, 2800, 3400];
const ADAPT_RESIST = 0.12;       // 단계마다 수압 12% 경감 (5단계 = 60%)
const DMG_CONTACT = 14;          // 적 생물 접촉
const DMG_SPIKE = 18;            // 복어·아귀 폭발
const DMG_ORB = 12;              // 크라켄 구체
const DMG_BOSS = 22;             // 크라켄 몸통 접촉
const MAX_HULL_CAP = 500;        // 최대 내구력 상한 (선체 보강 모듈로만 도달)
const HULL_HEAL_AT_CAP = 50;     // 최대치일 때 선체 보강 모듈이 대신 회복하는 양

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
  bossLabel: $('boss-bar-label'),
  current: $('current'),
  currentArrow: $('current-arrow'),
  currentFill: $('current-fill'),
  currentGrade: $('current-grade'),
  currentDir: $('current-dir'),
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
  deepBossCd: 45,
  deepBossSeen: false,
  adapt: 0,
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
let renderer, scene, camera, world, fx, player, pipeline, currents;
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
const curVec = new THREE.Vector3();
const curVec2 = new THREE.Vector3();
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

  /* 해류 — 늘 흐르는 물결과 가끔 몰아치는 강한 해류 */
  currents = new Currents(scene);
  world.setCurrents(currents);   // 물고기·해양 생물도 같은 해류를 탄다
  currents.onBurst = () => {
    if (G.state !== 'playing') return;
    banner('⚠ 강한 해류가 몰아칩니다 · 조향이 밀립니다', 2600);
    sound.currentRush();
    G.shake = Math.max(G.shake, 0.45);
  };

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
  // 초심해 보스는 사방으로 구체를 뿌리므로 넉넉히
  for (let i = 0; i < 36; i++) {
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
    if (show) setText(el.durFlag, `⚠ 심해 수압 −${G.pressure.toFixed(1)}/s`);
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
  // 심해 적응 단계마다 수압을 8%씩 덜 받는다 (5단계 = 40% 경감)
  G.pressure = pressureRateAt(G.depth) * (1 - ADAPT_RESIST * G.adapt);

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

/* ---------------- 심해 적응 — 처음 닿는 수심 이정표 ----------------
   깊은 곳에 처음 발을 들일 때마다 수압 저항만 올라간다(최대 내구력은 그대로).
   5단계(3,400m)까지 오르면 수압을 60% 덜 받는다. */
function checkDepthMilestones() {
  let leveled = 0;
  while (G.adapt < ADAPT_STEPS.length && G.maxDepth >= ADAPT_STEPS[G.adapt]) {
    G.adapt++;
    leveled++;
    durShownWidth = -1;
    durShownCls = '';
    fx.ring(P.pos.clone(), 0x9dfff2, 30, 0.9);
    fx.burst(P.pos.x, P.pos.y, P.pos.z, 26, {
      colors: [0x9dfff2, 0xd8fff4, 0xffffff], speed: 12, size: 1.8, life: 0.8,
    });
    sound.waveClear();
  }
  if (!leveled) return;
  banner(`심해 적응 ${G.adapt}단계 · 수압 ${Math.round(ADAPT_RESIST * G.adapt * 100)}% 경감`, 2600);
  toast(`선체 개량 · 수압 ${Math.round(ADAPT_RESIST * G.adapt * 100)}% 경감`);
  refreshHud();
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

/* ---------------- 해류 HUD — 방향 화살표 + 세기 ---------------- */
let curShownDeg = 9999;
let curShownPct = -1;
let curShownGrade = '';
let curShownDir = '';
let curShownStrong = null;
let curShownBurst = null;

function updateCurrentHud() {
  if (!el.current || !currents) return;
  const h = currents.hud();

  // 화면 기준 방향 — 카메라가 보는 쪽이 위
  const camB = Math.atan2(camLook.x, -camLook.z);
  const curB = Math.atan2(Math.cos(currents.angle), -Math.sin(currents.angle));
  let rel = curB - camB;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const deg = Math.round((rel * 180) / Math.PI);
  if (deg !== curShownDeg) {
    curShownDeg = deg;
    if (el.currentArrow) el.currentArrow.style.transform = `rotate(${deg}deg)`;
  }
  const pct = Math.max(3, Math.round(h.pct));
  if (pct !== curShownPct) {
    curShownPct = pct;
    if (el.currentFill) el.currentFill.style.width = pct + '%';
  }
  if (h.grade !== curShownGrade) {
    curShownGrade = h.grade;
    setText(el.currentGrade, h.grade);
  }
  if (h.dirName !== curShownDir) {
    curShownDir = h.dirName;
    setText(el.currentDir, h.dirName);
  }
  if (h.strong !== curShownStrong) {
    curShownStrong = h.strong;
    el.current.classList.toggle('strong', h.strong);
  }
  if (h.burst !== curShownBurst) {
    curShownBurst = h.burst;
    el.current.classList.toggle('burst', h.burst);
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
  updateCurrentHud();
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
  G.deepBossCd = 40;
  G.deepBossSeen = false;
  G.adapt = 0;
  if (currents) currents.reset();
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
  G.deepBossCd = 40;
}

/* ---------------- 보스 ----------------
   · 700m+ 심해: 전설의 대왕오징어 크라켄 (기존)
   · 3,000m+ 최심해: 크라켄보다 두 배 이상 강한 보스 3종
   기존 크라켄 기준값 — HP 40~96 · 구체 12 · 몸통 접촉 22 · 격퇴 2,600점
   초심해 보스는 HP 2.5~3.3배, 공격 2배 이상, 보상은 3~4배로 크게 올렸다. */
const KRAKEN_DEPTH = 700;
const DEEP_BOSS_DEPTH = 3000;

const BOSS_DEFS = {
  kraken: {
    name: '거대 대왕오징어 · 크라켄',
    shortName: '크라켄',
    hp: (depth) => Math.min(960, 400 + Math.round(Math.max(0, depth - 600) / 120) * 60),
    scale: (depth) => 1.65 + Math.min(0.5, Math.max(0, depth - 600) / 1600),
    contactR: (scale) => 8.4 * (scale / 1.45),
    contactDmg: DMG_BOSS,
    orbDmg: DMG_ORB,
    orbSpeed: 24,
    orbScale: 1,
    score: 2600,
    drops: ['multi', 'hull', 'repair'],
    bombs: 0,
    repair: 40,
    clearance: 18,
    banner: '심해의 전설 · 크라켄 출현',
  },
  megalodon: {
    name: '고대 상어 · 메갈로돈',
    shortName: '메갈로돈',
    hp: () => 2400,                // 크라켄 최대(960)의 2.5배
    scale: () => 2.35,
    contactR: (scale) => 7.0 * (scale / 2.35),
    contactDmg: 44,                // 크라켄 몸통(22)의 2배
    orbDmg: 26,                    // 크라켄 구체(12)의 2.2배
    orbSpeed: 34,
    orbScale: 1.5,
    score: 7600,
    drops: ['multi', 'rapid', 'hull', 'repair', 'shield'],
    bombs: 1,
    repair: 90,
    clearance: 24,
    banner: '3,000m의 포식자 · 메갈로돈',
  },
  leviathan: {
    name: '고대 수룡 · 레비아탄',
    shortName: '레비아탄',
    hp: () => 2300,                // 크라켄 최대(960)의 2.4배
    scale: () => 1.90,
    contactR: (scale) => 3.0 * (scale / 1.90),
    contactDmg: 36,                // 46 → 36 (몸에 닿았을 때만 아프다)
    orbDmg: 22,                    // 28 → 22
    orbSpeed: 22,                  // 30 → 22 (피할 수 있는 속도)
    orbScale: 1.35,
    score: 8600,
    drops: ['multi', 'rapid', 'hull', 'repair', 'shield'],
    bombs: 1,
    repair: 100,
    clearance: 22,
    banner: '고대의 거인 · 레비아탄 출현',
  },
  queen: {
    name: '심연 해파리 여왕 · 루미나',
    shortName: '루미나',
    hp: () => 3200,                // 3.3배
    scale: () => 1.75,
    contactR: (scale) => 7.6 * (scale / 1.75),
    contactDmg: 46,
    orbDmg: 26,
    orbSpeed: 26,
    orbScale: 1.6,
    score: 9600,
    drops: ['multi', 'rapid', 'hull', 'repair', 'shield', 'bomb'],
    bombs: 2,
    repair: 120,
    clearance: 26,
    banner: '발광하는 여왕 · 루미나',
  },
};

/** 보스 등장 공통 처리 — 위치·크기·체력·HUD 바 */
function beginBoss(kind, model, opts) {
  const def = BOSS_DEFS[kind];
  const o = model.group;
  const hp = def.hp(G.depth);
  const scale = def.scale(G.depth);
  computeForward(forward);
  o.position.copy(P.pos).addScaledVector(forward, (opts && opts.dist) || 76);
  o.position.y = clamp(
    o.position.y,
    terrainHeight(o.position.x, o.position.z) + def.clearance,
    SURFACE_Y - 16
  );
  o.rotation.order = 'YXZ';
  o.scale.setScalar(scale);
  scene.add(o);
  /* 심해는 탐조등 밖이 칠흑이라, 보스 몸에서 새어 나오는 빛을 하나 달아
     거대한 실루엣이 어둠 속에서도 읽히게 한다 */
  const aura = new THREE.PointLight(
    kind === 'kraken' ? 0xff9ec0 : kind === 'megalodon' ? 0x7fe4ff : kind === 'leviathan' ? 0x86ffd8 : 0xc79dff,
    150, 96, 2
  );
  // 몸 '안'에 두면 바깥면이 빛을 못 받는다 — 몸 밖 위쪽 앞에 두어 자기 몸을 비춘다
  aura.position.set(0, 3.4, -5.6);
  o.add(aura);
  G.boss = {
    kind,
    def,
    obj: o,
    model,
    hp,
    maxHp: hp,
    scale,
    contactR: def.contactR(scale),
    contactDmg: def.contactDmg,
    phase: Math.random() * 6.28,
    angle: Math.random() * 6.28,
    fire: 1.8,
    hit: 0,
    dead: false,
    mode: 'stalk',
    modeT: 0,
    t: 0,
    chargeCd: kind === 'leviathan' ? 7.5 : 5,
    chargeDir: new THREE.Vector3(0, 0, -1),
    shockCd: 7,
    aura,
    contactPts: [],
  };
  // 몸을 따라 늘어놓은 충돌 구 (수룡 레비아탄) — 위치는 매 프레임 갱신한다
  if (model.hull) {
    for (const h of model.hull) {
      G.boss.contactPts.push({ p: new THREE.Vector3(), r: h.r * scale, x: h.x, y: h.y, z: h.z });
    }
  }
  if (el.bossLabel) el.bossLabel.textContent = def.name;
  el.bossBar.classList.toggle('deep', kind !== 'kraken');
  el.bossBar.classList.remove('hidden');
  el.bossBar.setAttribute('aria-hidden', 'false');
  updateBossBar();
  banner(def.banner, 2900);
  sound.bossWarn();
  G.shake = 0.8;
  return G.boss;
}

function spawnKraken() {
  const b = beginBoss('kraken', makeKraken(), { dist: 76 });
  G.krakenSeen = true;
  return b;
}

const DEEP_BOSS_KINDS = ['megalodon', 'leviathan', 'queen'];
let lastDeepBoss = '';
function spawnDeepBoss(kind) {
  let k = kind;
  if (!k) {
    k = DEEP_BOSS_KINDS[Math.floor(Math.random() * DEEP_BOSS_KINDS.length)];
    if (k === lastDeepBoss) {
      k = DEEP_BOSS_KINDS[(DEEP_BOSS_KINDS.indexOf(k) + 1) % DEEP_BOSS_KINDS.length];
    }
  }
  lastDeepBoss = k;
  const model = k === 'megalodon'
    ? makeMegalodon()
    : k === 'leviathan' ? makeLeviathan() : makeVoidQueen();
  const b = beginBoss(k, model, { dist: k === 'leviathan' ? 58 : 52 });
  G.deepBossSeen = true;
  return b;
}

/** 이 수심에 어울리는 보스가 나타날 때가 되었는가 */
function maybeSpawnBoss(dt) {
  if (G.state !== 'playing' || G.boss) return;

  // 3,000m 아래 — 초심해 보스 3종
  if (G.depth >= DEEP_BOSS_DEPTH) {
    G.deepBossCd -= dt;
    if (G.deepBossCd <= 0 && Math.random() < dt * 0.10) {
      spawnDeepBoss();
      G.deepBossCd = 165;
    }
  } else if (G.deepBossCd < 22) {
    G.deepBossCd = 22;
  }

  // 700m 아래 — 크라켄
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

/* 이전 이름 유지 (다른 곳에서 부르는 곳이 있다) */
const maybeSpawnKraken = maybeSpawnBoss;

function bossDefeated() {
  const b = G.boss;
  if (!b) return;
  const def = b.def;
  const pos = b.obj.position.clone();
  G.score += def.score;
  if (def.bombs) G.bombs = Math.min(6, G.bombs + def.bombs);
  // 보상 — 점수 + 아이템 여러 개 + 선체 회복 + 음파 폭탄
  for (let i = 0; i < def.drops.length; i++) {
    const a = (i / def.drops.length) * Math.PI * 2;
    dropItem(pos.x + Math.cos(a) * 3.4, pos.y + rand(-1, 2), pos.z + Math.sin(a) * 3.4, def.drops[i]);
  }
  G.hull = Math.min(G.maxHull, G.hull + def.repair);
  toast(`${def.shortName} 격퇴 +${def.score.toLocaleString('ko-KR')}`);
  removeBoss();
  if (b.kind === 'kraken') G.krakenCd = 170;
  else G.deepBossCd = 165;
  sound.waveClear();
  banner(`${def.shortName} 격퇴 · 보상 획득`, 2500);
  refreshHud();
}

function updateBossBar() {
  if (!G.boss) return;
  const k = clamp(G.boss.hp / G.boss.maxHp, 0, 1);
  el.bossFill.style.width = `${k * 100}%`;
  // 체력이 네 자리가 되어도 읽히도록 천 단위로 끊어 쓴다 (2,300 / 2,300)
  setText(el.bossHp,
    `${Math.max(0, Math.round(G.boss.hp)).toLocaleString('ko-KR')} / ${Math.round(G.boss.maxHp).toLocaleString('ko-KR')}`);
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
  shark: { hp: 20, r: 1.7, score: 130 },   // 백상아리
  hammer: { hp: 30, r: 2.0, score: 180 },  // 귀상어
  puffer: { hp: 20, r: 1.6, score: 90 },   // 독가시 복어
  lion: { hp: 10, r: 1.5, score: 110 },    // 쏠배감펭
  jelly: { hp: 10, r: 1.4, score: 90 },    // 발광 해파리
  angler: { hp: 20, r: 1.6, score: 140 },  // 심해 아귀
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
    // 해류 영향 계수 — 체급(몸길이≈반지름×3.5)이 클수록 덜 밀린다
    currentW: currentWeightForLength(stats.r * scale * 3.5),
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

/* 어뢰 한 발의 위력 — 19~25. 심해 생물의 체력이 10배가 된 만큼 함께 올렸다.
   (체력 2,400 의 메갈로돈을 22평균으로 109발 ≈ 18초에 잡는 균형) */
const TORPEDO_DMG_MIN = 19;
const TORPEDO_DMG_MAX = 25;
function torpedoDamage() {
  return TORPEDO_DMG_MIN + Math.floor(Math.random() * (TORPEDO_DMG_MAX - TORPEDO_DMG_MIN + 1));
}
/* 음파 폭탄 — 어뢰 10발 남짓의 위력 */
const BOMB_DMG_ENEMY = 120;
const BOMB_DMG_BOSS = 220;

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
    const before = G.maxHull;
    G.maxHull = Math.min(MAX_HULL_CAP, G.maxHull + 20);
    durShownWidth = -1;
    durShownCls = '';
    if (G.maxHull > before) {
      // 최대 내구력 자체가 늘어난다 (+ 현재 내구력도 회복)
      G.hull = Math.min(G.maxHull, G.hull + 25);
      toast(`선체 보강 · 최대 내구력 +20 (${Math.round(G.maxHull)})`);
      fx.ring(p.clone(), 0x6dffcf, 14, 0.6);
      fx.burst(p.x, p.y, p.z, 14, { colors: [0x6dffcf, 0xd8fff4, 0xffffff], speed: 9, size: 1.6, life: 0.6 });
    } else if (G.hull < G.maxHull - 0.5) {
      // 이미 최대 내구력 — 보강재를 비상 수리로 돌려 현재 내구력을 회복한다
      G.hull = Math.min(G.maxHull, G.hull + HULL_HEAL_AT_CAP);
      toast(`선체 보강 한계 · 비상 수리 내구력 +${HULL_HEAL_AT_CAP} (${Math.ceil(G.hull)}/${Math.round(G.maxHull)})`);
      fx.ring(p.clone(), 0x9dffc9, 18, 0.7);
      fx.burst(p.x, p.y, p.z, 18, { colors: [0x9dffc9, 0xd8fff4, 0xffffff], speed: 11, size: 1.8, life: 0.7 });
      el.dur && el.dur.classList.add('heal');
      setTimeout(() => el.dur && el.dur.classList.remove('heal'), 520);
    } else {
      toast(`선체 보강 · 이미 최대 내구력 (${Math.round(G.maxHull)})`);
    }
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
    if (e.obj.position.distanceTo(origin) < 95) damageEnemy(e, BOMB_DMG_ENEMY);
  }
  if (G.boss && G.boss.obj.position.distanceTo(origin) < 110) damageBoss(BOMB_DMG_BOSS);
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
    fx.ring(pos, 0xffc27a, 40, 0.9);
    sound.explode('big');
    G.shake = 1.4;
    setTimeout(() => {
      if (G.state !== 'playing') return;
      bossDefeated();
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

  const targetIntensity = 15 + deep * 180;
  spot.intensity += (targetIntensity - spot.intensity) * k;
  spot.angle = 0.42 + deep * 0.24;
  spot.distance = 74 + deep * 260;
  spot.penumbra = 0.72 - deep * 0.2;

  // 바로 앞을 밝히는 보조광 (심해에서 확실히 비친다)
  if (player.frontLight) {
    player.frontLight.intensity += (deep * 38 - player.frontLight.intensity) * k;
    player.frontLight.distance = 20 + deep * 82;
  }
  // 잠수정 아래를 밝히는 빛무리 — 급한 사면을 따라 내려갈 때 발밑이 보이게
  if (player.under) {
    player.under.intensity += ((6 + deep * 190) - player.under.intensity) * k;
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
  /* 강한 해류 속에서는 키가 조금 둔해진다 — 조향 저하는 최대 17% */
  const curStrength = currents ? currents.strength : 0;
  P.yaw -= turnIn * P.turnRate * (1 - 0.18 * curStrength) * dt;   // 오른쪽 = 우회전(시계방향)

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

  /* 해류에 밀린다 — 잔잔할 때는 살짝, 강한 해류·돌발 해류에서는 흘러가되
     최대 (15 × 0.74 ≈ 11 유닛/초)로 전진 32 를 막지 못한다.
     역해류를 정면으로 거슬러도 60% 이상 전진해 빠져나올 수 있다. */
  if (currents) {
    currents.vector(curVec);
    P.pos.addScaledVector(curVec, dt * (0.55 + 0.2 * curStrength));
  }
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
  checkDepthMilestones();

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
  CAM.distNow = (world && world.caveInside && world.caveInside(P.pos)) ? Math.min(CAM.dist, 6.4) : CAM.dist;
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
  /* 동굴 안에서는 카메라를 몸 가까이 당긴다 — 15유닛 뒤면 암벽 속으로 들어간다 */
  const inCave = world && world.caveInside ? world.caveInside(P.pos) : 0;
  const wantDist = inCave ? Math.min(CAM.dist, 6.4) : CAM.dist;
  CAM.distNow += (wantDist - CAM.distNow) * damp(inCave ? 7 : 11, dt);
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
  // 동굴 암벽 — 카메라가 벽을 뚫고 밖을 비추지 않도록 밀어낸다
  if (world && world.resolveSolidCollisions) {
    world.resolveSolidCollisions(camTmp, 1.0, null, { cavesOnly: true });
  }

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

    // 해류 — 적 물고기(상어·복어·해파리·아귀)도 같은 흐름에 밀린다
    if (currents) {
      currents.at(o.position.x, o.position.z, curVec2);
      o.position.addScaledVector(curVec2, dt * e.currentW);
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
function fireOrbs(b, dir, count, spread, speed, dmg, from) {
  const def = b.def;
  const origin = from || b.obj.position;
  for (let i = 0; i < count; i++) {
    const orb = orbs.find((x) => !x.active);
    if (!orb) return;
    const d = dir.clone();
    if (count > 1) d.applyAxisAngle(UP, (i - (count - 1) / 2) * spread);
    d.y += rand(-0.03, 0.09);
    d.normalize();
    orb.active = true;
    orb.life = 8;
    orb.dmg = dmg || def.orbDmg;
    orb.mesh.visible = true;
    orb.mesh.scale.setScalar(def.orbScale || 1);
    orb.mesh.position.copy(origin).addScaledVector(d, 5 + b.scale * 2.4);
    orb.vel.copy(d).multiplyScalar(speed || def.orbSpeed);
  }
  sound.shoot();
}

/** 사방으로 퍼지는 구체 고리 (여왕의 패턴) */
function fireOrbRing(b, count, speed, yBias) {
  const def = b.def;
  const origin = b.obj.position;
  for (let i = 0; i < count; i++) {
    const orb = orbs.find((x) => !x.active);
    if (!orb) return;
    const a = (i / count) * Math.PI * 2 + b.phase * 0.4;
    const d = new THREE.Vector3(Math.cos(a), (yBias || 0) + Math.sin(a * 3) * 0.06, Math.sin(a)).normalize();
    orb.active = true;
    orb.life = 9;
    orb.dmg = def.orbDmg;
    orb.mesh.visible = true;
    orb.mesh.scale.setScalar(def.orbScale || 1);
    orb.mesh.position.copy(origin).addScaledVector(d, 6 + b.scale * 2);
    orb.vel.copy(d).multiplyScalar(speed || def.orbSpeed * 0.8);
  }
  sound.shoot();
}

function updateBoss(dt) {
  const b = G.boss;
  if (!b) return;
  b.phase += dt;
  b.t += dt;

  if (b.kind === 'megalodon') updateMegalodon(b, dt);
  else if (b.kind === 'leviathan') updateLeviathan(b, dt);
  else if (b.kind === 'queen') updateVoidQueen(b, dt);
  else updateKrakenBoss(b, dt);

  const o = b.obj;
  // 해류 — 거대 보스도 완전히 무관하지 않다. 체급 대비 아주 약하게만 밀린다
  if (currents) {
    currents.at(o.position.x, o.position.z, curVec2);
    o.position.addScaledVector(curVec2, dt * 0.12);
  }
  // 해저·수면을 뚫지 않는다
  const ground = terrainHeight(o.position.x, o.position.z) + 10;
  if (o.position.y < ground) o.position.y = ground;
  if (o.position.y > SURFACE_Y - 14) o.position.y = SURFACE_Y - 14;

  if (b.hit > 0) {
    b.hit -= dt;
    o.scale.setScalar(b.scale * (1 + b.hit * 0.35));
  } else {
    o.scale.setScalar(b.scale);
  }
  // 플레이어가 너무 멀리 달아나면(깊은 곳의 빠른 상승·하강) 다시 따라붙는다
  if (o.position.distanceToSquared(P.pos) > 190 * 190) {
    computeForward(forward);
    o.position.copy(P.pos).addScaledVector(forward, 68);
    o.position.y = clamp(
      o.position.y,
      terrainHeight(o.position.x, o.position.z) + b.def.clearance,
      SURFACE_Y - 16
    );
    if (b.model.segs) {
      for (let i = 0; i < b.model.segs.length; i++) {
        b.model.segs[i].position.set(0, 0, (i + 1) * 1.55);
      }
    }
    // 몸통 충돌 구는 updateLeviathan 이 매 프레임 자세에 맞춰 다시 놓는다
    if (!b.model.hull) for (const c of b.contactPts) c.p.copy(o.position);
    fx.flash(o.position.clone(), 0x9fe8ff, 12, 0.35);
    sound.sonar();
  }
  if (b.aura) b.aura.intensity = 150 + Math.sin(b.phase * 1.7) * 24;
  if (b.model && b.model.update) b.model.update(b.phase);
}

/* ---- 크라켄 — 천천히 다가와 선회하며 구체를 뿌린다 ---- */
function updateKrakenBoss(b, dt) {
  const o = b.obj;
  tmpVec.copy(P.pos).sub(o.position);
  const dist = tmpVec.length() || 1;
  tmpVec.multiplyScalar(1 / dist);

  if (dist > 32) {
    o.position.addScaledVector(tmpVec, 14 * dt);
  } else {
    const side = tmpVec2.set(-tmpVec.z, 0, tmpVec.x).normalize();
    o.position.addScaledVector(side, Math.sin(b.phase * 0.7) * 14 * dt);
    o.position.y += Math.sin(b.phase * 0.9) * 6 * dt;
  }
  o.rotation.y = Math.atan2(-tmpVec.x, -tmpVec.z);
  o.rotation.x = Math.asin(clamp(tmpVec.y, -1, 1)) * 0.35;
  o.rotation.z = Math.sin(b.phase * 1.2) * 0.08;

  if (b.model.arms) {
    for (let i = 0; i < b.model.arms.length; i++) {
      const arm = b.model.arms[i];
      const ph = arm.pivot.userData.phase;
      arm.limb.rotation.x = Math.sin(b.phase * 1.1 + ph) * 0.15;
      arm.limb.rotation.y = Math.sin(b.phase * 0.8 + ph * 1.3) * 0.16;
      arm.limb.rotation.z = Math.cos(b.phase * 0.9 + ph) * 0.1;
    }
  }
  if (b.model.tentacles) {
    for (let i = 0; i < b.model.tentacles.length; i++) {
      const tt = b.model.tentacles[i];
      const ph = tt.pivot.userData.phase;
      tt.limb.rotation.x = Math.sin(b.phase * 0.7 + ph) * 0.22;
      tt.limb.rotation.y = Math.sin(b.phase * 1.3 + ph) * 0.26;
      tt.limb.rotation.z = Math.cos(b.phase * 0.6 + ph) * 0.14;
    }
  }

  b.fire -= dt;
  if (b.fire <= 0 && dist < 90) {
    b.fire = 1.6;
    fireOrbs(b, tmpVec, b.hp < b.maxHp * 0.5 ? 3 : 2, 0.12, b.def.orbSpeed, b.def.orbDmg);
  }
}

/* ---- 메갈로돈 — 노려보다가 아가리를 벌리고 몸통째 돌진한다 ---- */
function updateMegalodon(b, dt) {
  const o = b.obj;
  tmpVec.copy(P.pos).sub(o.position);
  const dist = tmpVec.length() || 1;
  tmpVec.multiplyScalar(1 / dist);

  if (b.mode === 'charge') {
    b.modeT -= dt;
    o.position.addScaledVector(b.chargeDir, 64 * dt);
    o.rotation.y = Math.atan2(-b.chargeDir.x, -b.chargeDir.z);
    o.rotation.x = Math.asin(clamp(b.chargeDir.y, -1, 1)) * 0.4;
    o.rotation.z = Math.sin(b.phase * 9) * 0.05;
    // 돌진 중에도 어뢰를 흘린다
    b.fire -= dt;
    if (b.fire <= 0) {
      b.fire = 0.55;
      fireOrbs(b, b.chargeDir, 1, 0, b.def.orbSpeed * 0.9, b.def.orbDmg);
    }
    if (b.modeT <= 0) {
      b.mode = 'recover';
      b.modeT = 1.2;
      b.chargeCd = 4.6 + Math.random() * 2.4;
    }
  } else if (b.mode === 'windup') {
    // 몸을 낮추고 아가리를 벌린 채 겨냥한다 — 피할 틈을 주는 예고
    b.modeT -= dt;
    o.position.addScaledVector(tmpVec, 5 * dt);
    o.rotation.y = Math.atan2(-tmpVec.x, -tmpVec.z);
    o.rotation.x = 0.12;
    o.rotation.z = Math.sin(b.phase * 14) * 0.04;
    if (b.modeT <= 0) {
      b.mode = 'charge';
      b.modeT = 1.25;
      b.chargeDir.copy(tmpVec);
    }
  } else if (b.mode === 'recover') {
    b.modeT -= dt;
    o.rotation.y = Math.atan2(-tmpVec.x, -tmpVec.z);
    o.position.y += Math.sin(b.phase * 1.4) * 1.2 * dt;
    if (b.modeT <= 0) b.mode = 'stalk';
  } else {
    // 선회하며 거리를 좁힌다
    const want = 44;
    if (dist > want) o.position.addScaledVector(tmpVec, Math.min(26, (dist - want) * 0.6 + 6) * dt);
    const side = tmpVec2.set(-tmpVec.z, 0, tmpVec.x).normalize();
    o.position.addScaledVector(side, Math.sin(b.phase * 0.55) * 12 * dt);
    o.rotation.y = Math.atan2(-tmpVec.x, -tmpVec.z);
    o.rotation.x = Math.asin(clamp(tmpVec.y, -1, 1)) * 0.2;
    o.rotation.z = Math.sin(b.phase * 0.9) * 0.05;
    b.chargeCd -= dt;
    b.fire -= dt;
    if (b.fire <= 0 && dist < 105) {
      b.fire = 3.2;
      fireOrbs(b, tmpVec, 3, 0.14, b.def.orbSpeed, b.def.orbDmg);
    }
    if (b.chargeCd <= 0 && dist < 100) {
      b.mode = 'windup';
      b.modeT = 0.85;
    }
  }

  // 아가리 — 예고·돌진에서 크게 벌어진다 (음의 회전 = 아래로 벌어짐)
  const jawTarget = b.mode === 'charge' ? -0.78 : b.mode === 'windup' ? -0.44 : -0.20;
  b.model.jaw.rotation.x += (jawTarget - b.model.jaw.rotation.x) * Math.min(1, dt * 5);
}

/* ---- 고대 수룡 레비아탄 — 느릿하게 배회하다 묵직하게 몸통째 돌진한다 ----
   예전에는 16마디 사슬이 초당 30으로 플레이어를 감아 돌며 구체를 쏟아 냈다.
   이제는 무거운 수룡답게 느리게 순항하고, 돌진 전 예고(1.7초)와 돌진 후
   회복(2.6초)을 넉넉히 두어 피하고 반격할 틈을 만든다. */
const LEVI_AI = {
  cruise: 12,        // 순항 추격 (기존 30)
  charge: 30,        // 돌진 (메갈로돈 64의 절반 이하)
  turn: 0.95,        // 선회 계수 (기존 2.2)
  orbit: 46,         // 유지 거리
  windup: 1.7,       // 돌진 예고
  recover: 2.6,      // 돌진 후 회복
};

function updateLeviathan(b, dt) {
  const o = b.obj;
  const enraged = b.hp < b.maxHp * 0.5;
  tmpVec.copy(P.pos).sub(o.position);
  const dist = tmpVec.length() || 1;
  tmpVec.multiplyScalar(1 / dist);

  if (b.mode === 'charge') {
    // 정해진 방향으로 몸통째 밀고 나간다 — 방향을 꺾지 않아 비껴 피할 수 있다
    b.modeT -= dt;
    o.position.addScaledVector(b.chargeDir, LEVI_AI.charge * dt);
    o.rotation.y = Math.atan2(-b.chargeDir.x, -b.chargeDir.z);
    o.rotation.x = Math.asin(clamp(b.chargeDir.y, -1, 1)) * 0.30;
    o.rotation.z = Math.sin(b.phase * 3.2) * 0.05;
    if (b.modeT <= 0) {
      b.mode = 'recover';
      b.modeT = LEVI_AI.recover;
      b.chargeCd = (enraged ? 6.5 : 8) + Math.random() * 2.5;
    }
  } else if (b.mode === 'windup') {
    // 머리를 치켜들고 아가리를 크게 벌린 채 겨냥한다 — 넉넉한 예고
    b.modeT -= dt;
    o.position.addScaledVector(tmpVec, 4.0 * dt);          // 아주 천천히 밀고 들어온다
    const yawWant = Math.atan2(-tmpVec.x, -tmpVec.z);
    o.rotation.y += angDiff(o.rotation.y, yawWant) * Math.min(1, dt * 1.6);
    o.rotation.x = -0.10;
    o.rotation.z = Math.sin(b.phase * 2.2) * 0.03;
    if (b.modeT <= 0) {
      b.mode = 'charge';
      b.modeT = 1.45;
      b.chargeDir.copy(tmpVec);
      G.shake = Math.max(G.shake, 0.45);
    }
  } else if (b.mode === 'recover') {
    // 무거운 몸을 되돌린다 — 이때가 반격의 틈
    b.modeT -= dt;
    o.rotation.y += angDiff(o.rotation.y, Math.atan2(-tmpVec.x, -tmpVec.z)) * Math.min(1, dt * 0.6);
    o.position.y += Math.sin(b.phase * 0.9) * 1.0 * dt;
    if (b.modeT <= 0) b.mode = 'stalk';
  } else {
    // 순항 — 넓게 돌며 천천히 거리를 좁힌다 (사슬 대신 묵직한 선회)
    const want = LEVI_AI.orbit + Math.sin(b.phase * 0.45) * 5;
    const close = dist > want
      ? Math.min(LEVI_AI.cruise, (dist - want) * 0.5 + 2)
      : -2.0;
    o.position.addScaledVector(tmpVec, close * dt);
    const side = tmpVec2.set(-tmpVec.z, 0, tmpVec.x).normalize();
    o.position.addScaledVector(side, Math.sin(b.phase * 0.38) * 6 * dt);
    o.position.y += Math.sin(b.phase * 0.5) * 1.6 * dt;
    const yawWant = Math.atan2(-tmpVec.x, -tmpVec.z);
    o.rotation.y += angDiff(o.rotation.y, yawWant) * Math.min(1, dt * LEVI_AI.turn);
    o.rotation.x = Math.asin(clamp(tmpVec.y, -1, 1)) * 0.22;
    o.rotation.z = Math.sin(b.phase * 0.75) * 0.06;

    b.chargeCd -= dt;
    b.fire -= dt;
    if (b.fire <= 0 && dist < 100) {
      b.fire = enraged ? 1.35 : 1.95;
      fireOrbs(b, tmpVec, enraged ? 3 : 2, 0.12, b.def.orbSpeed, b.def.orbDmg);
    }
    if (b.chargeCd <= 0 && dist < 78 && dist > 14) {
      b.mode = 'windup';
      b.modeT = LEVI_AI.windup;
      G.shake = Math.max(G.shake, 0.22);
    }
  }

  // 아가리 — 예고·돌진에서 크게 벌어진다 (음의 회전 = 아래로)
  const jawTarget = b.mode === 'charge' ? -0.62 : b.mode === 'windup' ? -0.40 : -0.05;
  if (b.model.jaw) {
    b.model.jaw.rotation.x += (jawTarget - b.model.jaw.rotation.x) * Math.min(1, dt * 4.5);
  }
  // 벌린 아가리에서 새는 빛 — 예고를 눈으로도 알 수 있게
  if (b.model.mouthGlow) {
    const gTarget = b.mode === 'charge' ? 0.42 : b.mode === 'windup' ? 0.26 : 0;
    b.model.mouthGlow.material.opacity += (gTarget - b.model.mouthGlow.material.opacity) * Math.min(1, dt * 4);
  }

  // 몸 충돌 구 — 몸통을 따라 늘어놓은 구를 실제 자세에 맞춰 옮긴다
  if (b.model.hull) {
    o.updateMatrixWorld(true);
    for (let i = 0; i < b.contactPts.length; i++) {
      const c = b.contactPts[i];
      if (c.x === undefined) continue;
      c.p.set(c.x, c.y, c.z).applyMatrix4(o.matrixWorld);
    }
  }
}

/* ---- 여왕 루미나 — 사방으로 구체 고리를 뿌리고, 가까이 오면 전기 충격 ---- */
function updateVoidQueen(b, dt) {
  const o = b.obj;
  tmpVec.copy(P.pos).sub(o.position);
  const dist = tmpVec.length() || 1;
  tmpVec.multiplyScalar(1 / dist);

  // 천천히 다가오며 위아래로 맥동하듯 떠다닌다
  const want = 40;
  if (dist > want) o.position.addScaledVector(tmpVec, 8 * dt);
  else o.position.addScaledVector(tmpVec, -3.5 * dt);
  o.position.y += Math.sin(b.phase * 0.8) * 3.4 * dt;
  o.rotation.y += dt * 0.18;
  o.rotation.z = Math.sin(b.phase * 0.6) * 0.06;

  b.fire -= dt;
  if (b.fire <= 0) {
    b.fire = b.hp < b.maxHp * 0.5 ? 2.6 : 3.6;
    fireOrbRing(b, 12, b.def.orbSpeed * 0.85, 0.05);
    // 정면으로도 한 줄
    tmpVec.copy(P.pos).sub(o.position).normalize();
    fireOrbs(b, tmpVec, 3, 0.1, b.def.orbSpeed, b.def.orbDmg);
  }

  // 가까이 붙으면 전기 충격 — 우산에서 고리가 퍼진다
  b.shockCd -= dt;
  if (b.shockCd <= 0 && dist < 34) {
    b.shockCd = 6.5;
    fx.ring(o.position.clone(), 0xbf7dff, 30, 0.9);
    fx.flash(o.position.clone(), 0xd0a0ff, 16, 0.5);
    fx.burst(o.position.x, o.position.y, o.position.z, 22, {
      colors: [0xd0a0ff, 0x9dfcff, 0xffffff], speed: 20, size: 2.2, life: 0.7,
    });
    sound.explode('big');
    G.shake = Math.max(G.shake, 0.7);
    hurtPlayer(24);
  }
}

/* ---------------- 보스 몸통 접촉 — 관통 금지 ---------------- */
function resolveBossContact() {
  const b = G.boss;
  if (!b) return;
  const pts = b.contactPts && b.contactPts.length
    ? b.contactPts
    : [{ p: b.obj.position, r: b.contactR }];
  let touched = 0;
  for (let i = 0; i < pts.length; i++) {
    const c = pts[i];
    const R = c.r || b.contactR;
    const dx = P.pos.x - c.p.x;
    const dy = P.pos.y - c.p.y;
    const dz = P.pos.z - c.p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
    if (d >= R) continue;
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    const overlap = R - d;
    P.pos.x += nx * overlap;
    P.pos.y += ny * overlap;
    P.pos.z += nz * overlap;
    const vn = P.vel.x * nx + P.vel.y * ny + P.vel.z * nz;
    if (vn < 0) {
      P.vel.x -= nx * vn * 1.5;
      P.vel.y -= ny * vn * 1.5;
      P.vel.z -= nz * vn * 1.5;
    }
    touched = 1;
  }
  if (!touched) return;
  if (G.bumpCd <= 0) {
    G.bumpCd = 0.5;
    G.shake = Math.max(G.shake, 0.6);
    sound.bump();
  }
  hurtPlayer(b.contactDmg || DMG_BOSS);
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

/* ---------------- 바위·동굴 충돌 — 바위에 부딪히면 튕겨 나간다 -------------
   지형(바닥·절벽)은 높이 함수로 이미 막혀 있었지만, 해저에 놓인 바위와
   큰 바위 동굴은 그냥 통과했다. 충돌 구체로 막고, 들어가는 속도만큼
   되튕기게 한다. (동굴 통로 한가운데는 비어 있어 그대로 지나갈 수 있다) */
function resolveSolidContacts() {
  if (!world || !world.resolveSolidCollisions) return 0;
  const pushed = world.resolveSolidCollisions(P.pos, SUB_R, P.vel);
  if (pushed <= 0) return 0;
  if (G.bumpCd <= 0) {
    G.bumpCd = 0.5;
    G.shake = Math.max(G.shake, 0.30);
    sound.bump();
    fx.ring(P.pos.clone(), 0xdfeee4, 7, 0.32);
  }
  return pushed;
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
        damageEnemy(e, torpedoDamage());
        tor.active = false;
        tor.mesh.visible = false;
        break;
      }
    }
    if (!tor.active) continue;

    if (G.boss && !G.boss.dead) {
      // 보스 몸통을 따라 늘어놓은 충돌 구(수룡) 또는 중심 구에 맞으면 명중
      const b = G.boss;
      const pts = b.contactPts && b.contactPts.length ? b.contactPts : null;
      let hit = false;
      if (pts) {
        for (let i = 0; i < pts.length; i++) {
          const c = pts[i];
          const rr = (c.r || b.contactR) + 0.9;
          const dx = c.p.x - tor.mesh.position.x;
          const dy = c.p.y - tor.mesh.position.y;
          const dz = c.p.z - tor.mesh.position.z;
          if (dx * dx + dy * dy + dz * dz < rr * rr) { hit = true; break; }
        }
      } else {
        const p = b.obj.position;
        const rr = b.contactR + 0.9;
        const dx = p.x - tor.mesh.position.x;
        const dy = p.y - tor.mesh.position.y;
        const dz = p.z - tor.mesh.position.z;
        if (dx * dx + dy * dy + dz * dz < rr * rr) hit = true;
      }
      if (hit) {
        damageBoss(torpedoDamage());
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
      hurtPlayer(o.dmg || DMG_ORB);
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
  if (currents) currents.setQuality(preset.particles === undefined ? 1 : preset.particles);
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
      u.uExposure.value = 0.94 + 0.20 * Math.min(1, depth / 1400);
      /* 표층에서만 위에서 내려오는 밝은 물빛
   — 얕을수록 화면 위쪽이 환하고, 깊어지면 사라진다 */
      u.uTopGlow.value = 0.026 * Math.max(0, 1 - depth / 700);
      /* 하늘(위쪽) 방향을 화면 좌표로 — 물빛 돔의 중심 */
      _upWorld.copy(camera.position).addScaledVector(UP, 80).project(camera);
      if (_upWorld.z < 1) {
        u.uUpUV.value.set(_upWorld.x * 0.5 + 0.5, _upWorld.y * 0.5 + 0.5);
        u.uUpI.value = 0.058 * Math.max(0.16, 1 - depth / 1400);
      } else {
        u.uUpI.value = 0.035;
      }
      // 맑고 생동감 있는 바다 — 채도를 살짝 올려 색이 회색으로 죽지 않게
      u.uSat.value = 1.02 + 0.08 * Math.min(1, depth / 1200);
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
  if (currents) currents.update(dt, P.pos, camera);
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
  if (currents) currents.update(dt, P.pos, camera);
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
  maybeSpawnBoss(dt);

  updateEnemies(dt);
  updateBoss(dt);
  resolveBossContact();
  resolveCreatureContacts();
  resolveSolidContacts();
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
      startGame, spawnKraken, spawnDeepBoss, maybeSpawnBoss, damageBoss, removeBoss, spawnEnemy, useBomb,
      currents: () => (currents ? Object.assign(currents.state(), { hud: currents.hud() }) : null),
      currentHud: () => ({
        arrow: el.currentArrow ? el.currentArrow.style.transform : null,
        fill: el.currentFill ? el.currentFill.style.width : null,
        grade: el.currentGrade ? el.currentGrade.textContent : null,
        dir: el.currentDir ? el.currentDir.textContent : null,
        cls: el.current ? el.current.className : null,
      }),
      burstCurrent: (on) => {
        if (!currents) return null;
        currents.burstT = on === false ? 0 : 30;
        currents.burst = on === false ? 0 : 1;
        currents.eventT = 999;
        return currents.state();
      },
      /** 임의 지점의 해류 벡터 — 물고기·해양 생물도 같은 흐름을 쓴다 */
      currentAt: (x, z) => {
        if (!currents) return null;
        const v = currents.at(x, z, curVec2);
        return { speed: +Math.hypot(v.x, v.z).toFixed(2), x: +v.x.toFixed(2), z: +v.z.toFixed(2) };
      },
      /** 돌발 해류 주기 실측용 — 남은 대기·지속 시간과 지금까지 몰아친 횟수 */
      currentTimeline: () => (currents ? {
        t: +currents.time.toFixed(1),
        eventT: +currents.eventT.toFixed(1),
        burstT: +currents.burstT.toFixed(1),
        burst: +currents.burst.toFixed(3),
        bursts: currents.bursts,
        burstAt: currents.burstAt.map((v) => +v.toFixed(1)),
        speed: +currents.speed.toFixed(2),
      } : null),
      /** 검증용 — 한 프레임을 강제로 그린다 (배경 탭에서 rAF 가 멈출 때) */
      paint: (dt) => {
        renderFrame(dt || 1 / 60);
        return true;
      },
      /** 검증용 — 렌더 없이 게임 시간을 강제로 진행한다 (배경 탭에서 rAF 가 멈출 때) */
      step: (sec, dt) => {
        const d = dt || 1 / 60;
        const n = Math.max(1, Math.round((sec || 0.1) / d));
        for (let i = 0; i < n; i++) {
          if (G.state === 'playing') updateGame(d);
          else updateIdle(d);
        }
        return {
          elapsed: +G.elapsed.toFixed(3),
          state: G.state,
          pos: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
          vel: [+P.vel.x.toFixed(2), +P.vel.y.toFixed(2), +P.vel.z.toFixed(2)],
          current: currents ? +currents.speed.toFixed(2) : null,
        };
      },
      /** 물고기·대형 생물·적·보스의 해류 영향 계수와 실제 밀린 변위 */
      fishCurrent: () => ({
        currents: currents ? { speed: +currents.speed.toFixed(2), burst: +currents.burst.toFixed(2) } : null,
        schools: world.schools.map((s) => ({
          kind: s.kind,
          bodyLen: +s.bodyLen.toFixed(2),
          w: +s.currentW.toFixed(2),
          fishW: [+Math.min(...s.offsets.map((o) => o.cw)).toFixed(2), +Math.max(...s.offsets.map((o) => o.cw)).toFixed(2)],
          drift: +Math.hypot(s.drift.x, s.drift.z).toFixed(2),
          fishDrift: +Math.hypot(s.offsets[0].dx, s.offsets[0].dz).toFixed(2),
          fishDriftMax: +Math.max(...s.offsets.map((o) => Math.hypot(o.dx, o.dz))).toFixed(2),
        })),
        creatures: world.creatures.map((c) => ({
          kind: c.kind,
          bodyLen: +c.bodyLen.toFixed(1),
          w: +c.currentW.toFixed(2),
          drift: +Math.hypot(c.drift.x, c.drift.z).toFixed(2),
          visible: c.obj.group.visible,
        })),
        enemies: enemies.slice(0, 10).map((e) => ({ type: e.type, w: +e.currentW.toFixed(2) })),
        boss: G.boss ? { kind: G.boss.kind, w: 0.12 } : null,
      }),
      /** 해류 실측 — 주변에서 가장 센 해류 지점으로 옮겨 정면 역해류 전진을 잰다
          stage: 'start' → 준비, 'read' → 중간 측정, 'end' → 종료 */
      thrustTest: (stage) => {
        if (!currents) return null;
        if (!stage || stage === 'start') {
          currents.burstT = 120;      // 측정 동안 최대 해류 고정
          currents.burst = 1;
          currents.eventT = 999;
          let best = { s: -1, x: P.pos.x, z: P.pos.z };
          for (let r = 0; r <= 96; r += 8) {
            for (let a = 0; a < 32; a++) {
              const ang = (a / 32) * Math.PI * 2;
              const x = P.pos.x + Math.cos(ang) * r;
              const z = P.pos.z + Math.sin(ang) * r;
              const v = currents.at(x, z, curVec2);
              const s = Math.hypot(v.x, v.z);
              if (s > best.s) best = { s, x, z };
            }
          }
          const gy = terrainHeight(best.x, best.z);
          P.pos.set(best.x, Math.max(gy + 8, P.pos.y), best.z);
                    P.vel.set(0, 0, 0);
          const v = currents.at(P.pos.x, P.pos.z, curVec2);
          const vlen = Math.hypot(v.x, v.z) || 1;
          const d = { x: -v.x / vlen, z: -v.z / vlen };   // 해류를 정면으로 거스르는 방향
          P.yaw = Math.atan2(-d.x, -d.z);
          updateSubTransform(0);
          snapCamera();
          joy.move = 1;
          joy.turn = 0;
          joy.lift = 0;
          window.__thrust = { t0: performance.now(), e0: G.elapsed, p0: P.pos.clone(), dir: d };
          return {
            stage: 'start',
            at: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)],
            current: { speed: +vlen.toFixed(2), x: +v.x.toFixed(2), z: +v.z.toFixed(2) },
            yaw: +P.yaw.toFixed(3),
          };
        }
        const T = window.__thrust;
        if (!T) return null;
        if (stage === 'end') { joy.move = 0; }
        const sec = Math.max(0.001, G.elapsed - T.e0);   // 게임 시간 기준(프레임과 무관)
        const dx = P.pos.x - T.p0.x;
        const dz = P.pos.z - T.p0.z;
        // + = 해류를 거슬러 나아간 거리(전진), - = 해류에 밀려 밀린 거리
        const along = dx * T.dir.x + dz * T.dir.z;
        const cur = currents.at(P.pos.x, P.pos.z, curVec2);
        return {
          stage: stage || 'read',
          sec: +sec.toFixed(2),
          along: +along.toFixed(2),
          netSpeed: +(along / Math.max(sec, 0.001)).toFixed(2),
          thrustSpeed: +(P.vel.x * T.dir.x + P.vel.z * T.dir.z).toFixed(2),
          currentSpeed: +Math.hypot(cur.x, cur.z).toFixed(2),
          currentPush: +(Math.hypot(cur.x, cur.z) * (0.55 + 0.2 * currents.strength)).toFixed(2),
          pos: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)],
        };
      },
      /** 보스 모델을 눈앞에 세워 둔다 (검증용) */
      showBossModel: (kind, dist, yawOff) => {
        const made = kind === 'leviathan' ? makeLeviathan()
          : kind === 'queen' ? makeVoidQueen()
            : kind === 'megalodon' ? makeMegalodon() : makeKraken();
        const g = made.group;
        computeForward(forward);
        g.position.copy(P.pos).addScaledVector(forward, dist || 17);
        g.rotation.order = 'YXZ';
        g.rotation.y = P.yaw + Math.PI + (yawOff || 0);   // 머리가 카메라를 향하게 (yawOff 로 옆모습)
        g.scale.setScalar(kind === 'kraken' ? 1.8 : kind === 'leviathan' ? 1.9 : 1.5);
        scene.add(g);
        const l = new THREE.PointLight(0xbfe9ff, 420, 70, 2);
        l.position.copy(g.position).add(new THREE.Vector3(0, 7, -9));
        scene.add(l);
        const l2 = new THREE.PointLight(0xffffff, 300, 60, 2);
        l2.position.copy(P.pos);
        scene.add(l2);
        window.__modelPreview = { g, l, l2 };
        return { kind, pos: [+g.position.x.toFixed(1), +g.position.y.toFixed(1), +g.position.z.toFixed(1)] };
      },
      clearBossModel: () => {
        const p = window.__modelPreview;
        if (!p) return null;
        scene.remove(p.g);
        scene.remove(p.l);
        scene.remove(p.l2);
        p.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        window.__modelPreview = null;
        return true;
      },
      bossInfo: () => (G.boss ? {
        kind: G.boss.kind,
        name: G.boss.def.name,
        hp: G.boss.hp,
        maxHp: G.boss.maxHp,
        score: G.boss.def.score,
        contactDmg: G.boss.contactDmg,
        orbDmg: G.boss.def.orbDmg,
        scale: +G.boss.scale.toFixed(2),
        mode: G.boss.mode,
        modeT: +G.boss.modeT.toFixed(2),
        chargeCd: +G.boss.chargeCd.toFixed(2),
        contactPts: G.boss.contactPts.length,
        dist: +G.boss.obj.position.distanceTo(P.pos).toFixed(1),
        pos: [+G.boss.obj.position.x.toFixed(2), +G.boss.obj.position.y.toFixed(2), +G.boss.obj.position.z.toFixed(2)],
        hull: G.boss.model && G.boss.model.hull ? G.boss.model.hull.length : 0,
        label: el.bossLabel ? el.bossLabel.textContent : null,
        segs: G.boss.model && G.boss.model.segs ? G.boss.model.segs.length : 0,
        barWidth: el.bossFill ? el.bossFill.style.width : null,
      } : null),
      adapt: () => ({
        stage: G.adapt,
        maxHull: G.maxHull,
        hull: +G.hull.toFixed(1),
        cap: MAX_HULL_CAP,
        steps: ADAPT_STEPS,
        pressureRaw: +pressureRateAt(G.depth).toFixed(2),
        pressureEff: +(pressureRateAt(G.depth) * (1 - ADAPT_RESIST * G.adapt)).toFixed(2),
        resist: +(ADAPT_RESIST * G.adapt).toFixed(2),
        text: el.durVal ? el.durVal.textContent + '/' + el.durMax.textContent : null,
        wait: +((SURFACE_Y - P.pos.y) * DEPTH_SCALE).toFixed(0),
      }),
      /** 원하는 수심으로 잠수정을 옮긴다 (수압·심해 적응·최대 내구력 검증용) */
      gotoDepth: (m) => {
        const y = SURFACE_Y - Math.max(0, m || 0) / DEPTH_SCALE;
        P.pos.set(180, y, -1420);
        P.vel.set(0, 0, 0);
        G.depth = Math.max(0, (SURFACE_Y - P.pos.y) * DEPTH_SCALE);
        if (G.depth > G.maxDepth) G.maxDepth = G.depth;
        updateSubTransform(0);
        snapCamera();
        return {
          depth: +G.depth.toFixed(0),
          y: +P.pos.y.toFixed(1),
          maxHull: G.maxHull,
          hull: +G.hull.toFixed(1),
          adapt: G.adapt,
        };
      },
      pressureRateAt, regenScaleAt,
      ecoAt, previewCreature, clearPreviews,
      dropItem, collectItem, hurtPlayer, updateHeadlight, resolveCreatureContacts,
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
      /* ---- 바위·동굴 검증용 ---- */
      caves: () => (world.caves || []).filter((c) => c.key).map((c) => ({
        key: c.key,
        pos: [+c.center.x.toFixed(1), +c.center.y.toFixed(1), +c.center.z.toFixed(1)],
        axis: [+c.axis.x.toFixed(2), +c.axis.z.toFixed(2)],
        bore: +c.bore.toFixed(1),
        halfLength: +(c.halfLength || 0).toFixed(1),
        cols: c.cols.length,
      })),
      /** 동굴 아가리 앞으로 이동 — 동굴 구경/통과 검증 */
      goCave: (which, back) => {
        const list = (world.caves || []).filter((c) => c.key);
        if (!list.length) return null;
        const c = list[Math.min(list.length - 1, which || 0)];
        const away = back === undefined ? 1 : back;
        const d = (c.halfLength || 20) + 16;
        const px = c.center.x - c.axis.x * d * away;
        const pz = c.center.z - c.axis.z * d * away;
        P.pos.set(px, c.center.y + 0.4, pz);
        P.yaw = Math.atan2(-c.axis.x * away, -c.axis.z * away);
        P.vel.set(0, 0, 0);
        CAM.yaw = P.yaw;
        CAM.pitch = -0.06;
        snapCamera();
        return {
          key: c.key,
          pos: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)],
          dist: +Math.hypot(P.pos.x - c.center.x, P.pos.z - c.center.z).toFixed(1),
          bore: +c.bore.toFixed(1),
        };
      },
      /** 통로 안으로 들어가 정면을 본다 — 내부 컷 */
      goCaveIn: (which) => {
        const list = (world.caves || []).filter((c) => c.key);
        if (!list.length) return null;
        const c = list[Math.min(list.length - 1, which || 0)];
        const d = (c.halfLength || 20) - 6;
        P.pos.set(c.center.x - c.axis.x * d, c.center.y, c.center.z - c.axis.z * d);
        P.yaw = Math.atan2(-c.axis.x, -c.axis.z);
        P.vel.set(0, 0, 0);
        CAM.yaw = P.yaw;
        CAM.pitch = -0.02;
        snapCamera();
        return { key: c.key, inside: world.caveInside(P.pos), pos: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)] };
      },
      /** 유효한 바위·동굴 충돌체 개수와, 실제로 튕기는지 수치 확인 */
      solidTest: (speed) => {
        const v0 = speed || 22;
        const out = { caves: [], chunkRocks: 0 };
        let chunkCol = null;
        for (const rec of world.chunks.values()) {
          if (rec.cols && rec.cols.length) {
            out.chunkRocks += rec.cols.length;
            if (!chunkCol) chunkCol = rec.cols[0];
          }
        }
        const cave = (world.caves || []).find((c) => c.key && c.cols.length);
        out.caveCols = cave ? cave.cols.length : 0;

        const probe = (s, label, from) => {
          const n = from || { x: 1, y: 0, z: 0 };
          const pos = new THREE.Vector3(
            s.x + n.x * (s.r + SUB_R - 0.9),
            s.y + n.y * (s.r + SUB_R - 0.9),
            s.z + n.z * (s.r + SUB_R - 0.9)
          );
          const vel = new THREE.Vector3(-n.x * v0, -n.y * v0, -n.z * v0);
          const d0 = pos.clone().sub(new THREE.Vector3(s.x, s.y, s.z)).length();
          const pushed = world.resolveSolidCollisions(pos, SUB_R, vel, label === 'cave' ? { cavesOnly: true } : {});
          const d1 = pos.clone().sub(new THREE.Vector3(s.x, s.y, s.z)).length();
          return {
            pushed: +pushed.toFixed(2),
            distBefore: +d0.toFixed(2),
            distAfter: +d1.toFixed(2),
            minDist: +(s.r + SUB_R).toFixed(2),
            velBefore: +v0.toFixed(1),
            velAlongBefore: +v0.toFixed(2),   // 벽을 향한 속도
            velAlongAfter: +(vel.x * -n.x + vel.y * -n.y + vel.z * -n.z).toFixed(2),
            velAfterLen: +vel.length().toFixed(2),
            bounced: (vel.x * -n.x + vel.y * -n.y + vel.z * -n.z) < 0,  // 벽 쪽 속도가 반대로 뒤집혔다
            clear: d1 >= s.r + SUB_R - 0.05,   // 밀려난 뒤 구체 밖으로 나왔는가
          };
        };
        if (cave) {
          // 통로 축에서 벽을 향해 돌진하는 잠수정 (아가리 쪽 구체)
          const s = cave.cols[Math.floor(cave.cols.length * 0.5)];
          const ax = cave.axis.x, az = cave.axis.z;
          const along = (s.x - cave.center.x) * ax + (s.z - cave.center.z) * az;
          let rx = s.x - cave.center.x - ax * along;
          const ry = s.y - cave.center.y;
          let rz = s.z - cave.center.z - az * along;
          const rl = Math.hypot(rx, ry, rz) || 1;
          const nrm = { x: rx / rl, y: ry / rl, z: rz / rl };   // 축 → 벽 방향
          out.caves.push(probe(s, 'cave', nrm));
        }
        if (chunkCol) {
          out.chunkRock = probe(chunkCol, 'rock', { x: 1, y: 0, z: 0 });
        }
        return out;
      },
      /** 실제 게임 루프로 벽에 돌진시켜 본다 (속도 반전 확인) */
      liveBump: async (secs) => {
        const cave = (world.caves || []).find((c) => c.key && c.cols.length);
        if (!cave) return { ok: false, reason: 'no cave' };
        const s = cave.cols[Math.floor(cave.cols.length / 2)];
        const pos = new THREE.Vector3(s.x + (s.r + SUB_R + 6), s.y, s.z);
        P.pos.copy(pos);
        P.vel.copy(new THREE.Vector3(-24, 0, 0));
        P.yaw = Math.atan2(24, 0);       // -x 쪽을 본다
        const t0 = performance.now();
        await new Promise((r) => setTimeout(r, (secs || 0.6) * 1000));
        return {
          ok: true,
          ms: Math.round(performance.now() - t0),
          pos: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
          wallDist: +P.pos.distanceTo(new THREE.Vector3(s.x, s.y, s.z)).toFixed(2),
          minDist: +(s.r + SUB_R).toFixed(2),
          vel: [+P.vel.x.toFixed(2), +P.vel.y.toFixed(2), +P.vel.z.toFixed(2)],
          outward: P.pos.x - s.x > 0,
        };
      },
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
        G.hull = G.maxHull;                 // 최대치까지 채우고 내려간다 (최대 내구력은 건드리지 않는다)
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
