/* =========================================================
   ABYSS DIVER — 3D 심해 탐험 슈팅
   Three.js 기반, 빌드 없이 단일 페이지로 실행
   ========================================================= */
import * as THREE from 'three';
import { Sound } from './audio.js';
import { World, ZONES } from './world.js';
import { makeSubmarine, makeShark, makeJellyfish, makeMine, makeBoss, spriteGlow } from './models.js';
import { FX } from './fx.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);

const BEST_KEY = 'abyss-diver-best';

const LIMIT_X = 10.5;
const LIMIT_Y_MIN = -5.2;
const LIMIT_Y_MAX = 6.2;

/* ---------------- DOM ---------------- */
const canvas = $('game');
const el = {
  hud: $('hud'),
  score: $('hud-score'),
  best: $('hud-best'),
  depth: $('hud-depth-val'),
  zone: $('hud-zone'),
  hull: $('hud-hull'),
  shield: $('hud-shield'),
  shieldVal: $('shield-val'),
  powerups: $('powerups'),
  bombs: $('hud-bombs'),
  bombBtn: $('btn-bomb'),
  mute: $('btn-mute'),
  muteIcon: $('mute-icon'),
  pause: $('btn-pause'),
  bossBar: $('boss-bar'),
  bossFill: $('boss-bar-fill'),
  bossHp: $('boss-bar-hp'),
  reticle: $('reticle'),
  banner: $('wave-banner'),
  toast: $('toast'),
  flash: $('flash'),
  startScreen: $('screen-start'),
  pauseScreen: $('screen-pause'),
  overScreen: $('screen-over'),
  startBest: $('start-best'),
  overScore: $('over-score'),
  overBest: $('over-best'),
  overWave: $('over-wave'),
  overDepth: $('over-depth'),
  newRecord: $('new-record'),
  pauseScore: $('pause-score'),
  pauseDepth: $('pause-depth'),
  pauseWave: $('pause-wave'),
  loading: $('loading'),
};

/* ---------------- 사운드 ---------------- */
const sound = new Sound();

/* ---------------- 상태 ---------------- */
const G = {
  state: 'menu',
  score: 0,
  best: 0,
  wave: 1,
  kills: 0,
  waveGoal: 0,
  depth: 12,
  maxDepth: 12,
  dist: 0,
  hull: 5,
  maxHull: 5,
  shield: 0,
  bombs: 1,
  multi: 0,
  rapid: 0,
  speed: 16,
  invuln: 0,
  fireTimer: 0,
  spawnTimer: 1.6,
  pingTimer: 9,
  bubbleTimer: 3,
  pendingWave: 0,
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

/* ---------------- 렌더러 / 씬 ---------------- */
let renderer, scene, camera, world, fx, player;
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
const clock = new THREE.Clock();

const enemies = [];
const torpedoes = [];
const items = [];
const orbs = [];

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
  renderer.toneMappingExposure = 1.02;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 3.2, 10.5);

  world = new World(scene);
  fx = new FX(scene);

  /* --- 플레이어 잠수정 --- */
  const sub = makeSubmarine();
  sub.group.position.set(0, 0, 0);
  scene.add(sub.group);
  player = {
    obj: sub.group,
    prop: sub.propeller,
    spot: sub.spot,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    tx: 0,
    ty: 0,
    roll: 0,
    pitch: 0,
    bob: 0,
  };

  buildPools();
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.state === 'playing') togglePause(true);
  });
}

/* ---------------- 오브젝트 풀 ---------------- */
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

let torpGeo, torpMat, itemGeos, itemMats, orbGeo, orbMat;

function buildPools() {
  torpGeo = new THREE.CapsuleGeometry(0.13, 0.5, 3, 8);
  torpGeo.rotateX(Math.PI / 2);
  torpMat = new THREE.MeshBasicMaterial({ color: 0xc8feff });

  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(torpGeo, torpMat);
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    torpedoes.push({ mesh: m, vel: new THREE.Vector3(), life: 0, active: false });
  }

  itemGeos = {
    multi: new THREE.OctahedronGeometry(0.5, 0),
    rapid: new THREE.TetrahedronGeometry(0.52, 0),
    shield: new THREE.IcosahedronGeometry(0.5, 0),
    bomb: new THREE.DodecahedronGeometry(0.5, 0),
  };
  itemMats = {
    multi: new THREE.MeshBasicMaterial({ color: 0xff8fb4 }),
    rapid: new THREE.MeshBasicMaterial({ color: 0x8fe4ff }),
    shield: new THREE.MeshBasicMaterial({ color: 0xa8b8ff }),
    bomb: new THREE.MeshBasicMaterial({ color: 0xffce6b }),
  };

  orbGeo = new THREE.SphereGeometry(0.42, 10, 8);
  orbMat = new THREE.MeshBasicMaterial({ color: 0xff9d6b });
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(orbGeo, orbMat);
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    orbs.push({ mesh: m, vel: new THREE.Vector3(), life: 0, active: false });
  }
}

/* ---------------- 입력 ---------------- */
const keys = new Set();
let dragging = false;
let lastPointer = { x: 0, y: 0 };

function bindInput() {
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    if (e.pointerType === 'mouse') {
      setTargetFromPointer(e.clientX, e.clientY);
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) { /* noop */ }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      setTargetFromPointer(e.clientX, e.clientY);
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const kx = (2 * LIMIT_X) / window.innerWidth;
    const ky = (LIMIT_Y_MAX - LIMIT_Y_MIN) / window.innerHeight;
    player.tx = clamp(player.tx + dx * kx * 1.05, -LIMIT_X, LIMIT_X);
    player.ty = clamp(player.ty - dy * ky * 1.05, LIMIT_Y_MIN, LIMIT_Y_MAX);
  });

  const end = (e) => {
    dragging = false;
    if (e && e.pointerType && canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { dragging = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'p' || k === 'escape') {
      if (G.state === 'playing') togglePause(true);
      else if (G.state === 'paused') togglePause(false);
    }
    if (k === 'm') toggleMute();
    if (k === ' ' || k === 'spacebar') {
      e.preventDefault();
      useBomb();
    }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => {
    keys.clear();
    dragging = false;
    if (G.state === 'playing') togglePause(true);
  });
}

function setTargetFromPointer(cx, cy) {
  const nx = (cx / window.innerWidth) * 2 - 1;
  const ny = (cy / window.innerHeight) * 2 - 1;
  player.tx = clamp(nx * LIMIT_X * 1.15, -LIMIT_X, LIMIT_X);
  player.ty = clamp(-ny * LIMIT_Y_MAX * 1.1, LIMIT_Y_MIN, LIMIT_Y_MAX);
}

/* ---------------- UI 헬퍼 ---------------- */
function setText(node, value) {
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}

function buildHearts() {
  el.hull.innerHTML = '';
  for (let i = 0; i < G.maxHull; i++) {
    const d = document.createElement('div');
    d.className = 'heart';
    el.hull.appendChild(d);
  }
}

function updateHearts() {
  const kids = el.hull.children;
  for (let i = 0; i < kids.length; i++) {
    kids[i].classList.toggle('empty', i >= G.hull);
  }
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
  toastTimer = 1.5;
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

function refreshHud() {
  setText(el.score, G.score.toLocaleString('ko-KR'));
  setText(el.best, G.best.toLocaleString('ko-KR'));
  setText(el.depth, Math.floor(G.depth));
  setText(el.zone, ZONES[G.zoneIndex].name);
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
}

/* ---------------- 게임 시작/종료 ---------------- */
function resetGame() {
  // 적/투사체/아이템 정리
  for (const e of enemies) scene.remove(e.obj);
  enemies.length = 0;
  if (G.boss) {
    removeBoss();
  }
  for (const t of torpedoes) { t.active = false; t.mesh.visible = false; }
  for (const o of orbs) { o.active = false; o.mesh.visible = false; }
  for (const it of items) scene.remove(it.obj);
  items.length = 0;
  fx.clear();

  G.score = 0;
  G.wave = 1;
  G.kills = 0;
  G.depth = 12;
  G.maxDepth = 12;
  G.dist = 0;
  G.hull = G.maxHull;
  G.shield = 0;
  G.bombs = 1;
  G.multi = 0;
  G.rapid = 0;
  G.speed = 16;
  G.invuln = 1.4;
  G.fireTimer = 0;
  G.spawnTimer = 1.2;
  G.pendingWave = 0;
  G.shake = 0;
  G.elapsed = 0;
  G.zoneIndex = 0;

  player.x = player.tx = 0;
  player.y = player.ty = 0;
  player.vx = player.vy = 0;
  player.roll = 0;
  player.pitch = 0;
  player.obj.visible = true;
  player.obj.position.set(0, 0, 0);
  player.obj.rotation.set(0, 0, 0);
  player.obj.scale.setScalar(0.92);

  world.zoneIndex = -1;
  world.setZone(0);
  world.reset();

  buildHearts();
  updateHearts();
  refreshHud();

  startWave(1);
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
  G.shake = 1.2;
  sound.gameOver();
  sound.explode('big');
  fx.burst(player.x, player.y, 0, 60, {
    colors: [0xffd9a0, 0xff9a5a, 0xffffff, 0x9dfcff],
    speed: 16, size: 2.4, life: 1.1,
  });
  fx.flash(new THREE.Vector3(player.x, player.y, 0), 0xffc28a, 14, 0.6);
  player.obj.visible = false;

  const isRecord = G.score > G.best;
  if (isRecord) {
    G.best = G.score;
    try { localStorage.setItem(BEST_KEY, String(G.best)); } catch (e) { /* noop */ }
  }
  setText(el.overScore, G.score.toLocaleString('ko-KR'));
  setText(el.overBest, G.best.toLocaleString('ko-KR'));
  setText(el.overWave, G.wave);
  setText(el.overDepth, `${Math.floor(G.maxDepth)} m`);
  el.newRecord.classList.toggle('hidden', !isRecord);

  setTimeout(() => {
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
    setText(el.pauseWave, G.wave);
    el.pauseScreen.classList.remove('hidden');
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

/* ---------------- 웨이브 ---------------- */
function startWave(n) {
  G.wave = n;
  G.kills = 0;
  const zone = n <= 2 ? 0 : n <= 4 ? 1 : 2;
  G.zoneIndex = zone;
  world.setZone(zone);
  G.speed = 15 + Math.min(11, n * 1.1);
  G.spawnTimer = 1.1;

  if (n % 3 === 0) {
    G.waveGoal = Infinity;
    spawnBoss(n);
    banner(`웨이브 ${n} · 심해 포식자 출현`, 2600);
    sound.bossWarn();
  } else {
    G.waveGoal = 5 + n * 2;
    banner(`웨이브 ${n} · ${ZONES[zone].name}`, 2000);
  }
  refreshHud();
}

function waveCleared() {
  const bonus = 180 + G.wave * 60;
  G.score += bonus;
  toast(`웨이브 보너스 +${bonus}`);
  if (G.boss) removeBoss();
  G.pendingWave = 2.2;
  sound.waveClear();
  refreshHud();
}

/* ---------------- 보스 ---------------- */
function spawnBoss(wave) {
  const b = makeBoss();
  const hp = 26 + Math.floor(wave / 3) * 10;
  b.group.position.set(0, 0.5, -78);
  b.group.scale.setScalar(1.05 + Math.min(0.5, wave * 0.02));
  scene.add(b.group);
  G.boss = {
    obj: b.group,
    jaw: b.jaw,
    tail: b.tail,
    lure: b.lure,
    hp,
    maxHp: hp,
    phase: 0,
    x: 0,
    y: 0.5,
    fire: 2.0,
    hit: 0,
    dead: false,
  };
  el.bossBar.classList.remove('hidden');
  el.bossBar.setAttribute('aria-hidden', 'false');
  updateBossBar();
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
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  G.boss = null;
  el.bossBar.classList.add('hidden');
  el.bossBar.setAttribute('aria-hidden', 'true');
}

/* ---------------- 적 ---------------- */
function spawnEnemy() {
  const wave = G.wave;
  const roll = Math.random();
  let type = 'shark';
  if (roll > 0.74) type = 'mine';
  else if (roll > 0.42) type = 'jelly';

  const x = clamp(rand(-1, 1) * (7 + Math.random() * 5), -LIMIT_X - 1.5, LIMIT_X + 1.5);
  const y = rand(-4.5, 5.5);
  let obj;
  let hp;
  let r;
  let score;
  if (type === 'shark') {
    const m = makeShark();
    obj = m.group;
    hp = 2;
    r = 1.5;
    score = 130;
  } else if (type === 'jelly') {
    const palette = [0xb98bff, 0x7de8ff, 0xff9edb, 0xa8ffd8];
    const m = makeJellyfish(palette[Math.floor(Math.random() * palette.length)]);
    obj = m.group;
    hp = 1;
    r = 1.25;
    score = 90;
  } else {
    const m = makeMine();
    obj = m.group;
    hp = 2;
    r = 1.3;
    score = 70;
  }

  obj.position.set(x, y, -118);
  const scale = 0.9 + Math.random() * 0.35;
  obj.scale.setScalar(scale);
  scene.add(obj);

  enemies.push({
    type,
    obj,
    hp,
    maxHp: hp,
    r: r * scale,
    score,
    scale0: scale,
    x,
    y,
    phase: Math.random() * 6.28,
    baseX: x,
    baseY: y,
    speed: type === 'shark' ? rand(9, 13) : type === 'jelly' ? rand(4, 7) : rand(2, 4),
    hit: 0,
    dead: false,
    swirl: rand(1.2, 2.6),
    age: 0,
  });
}

function damageEnemy(e, dmg) {
  e.hp -= dmg;
  e.hit = 0.16;
  const p = e.obj.position;
  fx.burst(p.x, p.y, p.z, 4, { colors: [0xc8feff, 0xffffff], speed: 7, size: 1.1, life: 0.3 });
  sound.hit();
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    killEnemy(e);
  }
}

function killEnemy(e) {
  const p = e.obj.position;
  const big = e.type === 'shark';
  fx.burst(p.x, p.y, p.z, big ? 22 : 12, {
    colors: e.type === 'jelly'
      ? [0xd9a6ff, 0x9dfcff, 0xffffff]
      : [0xffd9a0, 0xff9a5a, 0xffffff],
    speed: big ? 12 : 8, size: big ? 1.9 : 1.4, life: 0.7,
  });
  fx.flash(new THREE.Vector3(p.x, p.y, p.z), e.type === 'jelly' ? 0xd6b0ff : 0xffb070, big ? 7 : 5, 0.3);
  sound.explode(big ? 'small' : 'tiny');

  G.score += e.score;
  G.kills++;
  scene.remove(e.obj);
  const idx = enemies.indexOf(e);
  if (idx >= 0) enemies.splice(idx, 1);

  // 아이템 드롭
  if (Math.random() < 0.15) dropItem(p.x, p.y, p.z);

  refreshHud();
}

function dropItem(x, y, z, forced) {
  const types = ['multi', 'rapid', 'shield', 'bomb'];
  const t = forced || types[Math.floor(Math.random() * types.length)];
  const mesh = new THREE.Mesh(itemGeos[t], itemMats[t]);
  const halo = spriteGlow(
    t === 'multi' ? 0xff8fb4 : t === 'rapid' ? 0x8fe4ff : t === 'shield' ? 0xa8b8ff : 0xffce6b,
    2.6, 0.7
  );
  mesh.add(halo);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  items.push({ obj: mesh, type: t, x, y, z, phase: Math.random() * 6.28, age: 0 });
}

/* ---------------- 발사 ---------------- */
function aimDirection(out) {
  // 잠수정 정면(레티클 중앙) 방향
  return out.set(0, 0, -1);
}

function fire() {
  const nose = tmpVec.set(player.x, player.y - 0.05, -2.1);
  const dir = aimDirection(tmpVec2);
  const count = G.multi > 0 ? 3 : 1;
  for (let i = 0; i < count; i++) {
    const t = torpedoes.find((x) => !x.active);
    if (!t) break;
    const spread = count === 1 ? 0 : (i - (count - 1) / 2) * 0.13;
    const v = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
    v.y += (count === 1 ? 0 : (i - 1) * 0.012);
    t.active = true;
    t.life = 1.7;
    t.mesh.visible = true;
    t.mesh.position.copy(nose);
    t.mesh.position.x += (i - (count - 1) / 2) * 0.35;
    t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.clone().normalize());
    t.vel.copy(v).multiplyScalar(92);
    t.trail = 0;
  }
  sound.shoot();
}

/* ---------------- 아이템 ---------------- */
function collectItem(it) {
  sound.pickup();
  if (it.type === 'multi') {
    G.multi = Math.min(26, G.multi + 13);
    toast('멀티 어뢰 · 3발 동시 발사');
  } else if (it.type === 'rapid') {
    G.rapid = Math.min(26, G.rapid + 13);
    toast('연사 강화 · 발사 속도 2배');
  } else if (it.type === 'shield') {
    G.shield = Math.min(4, G.shield + 2);
    toast('수중 실드 · 피해 2회 흡수');
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
  const origin = new THREE.Vector3(player.x, player.y, -4);
  fx.ring(origin, 0x9dfff2, 70, 1.0);
  fx.flash(origin, 0xbdfff6, 26, 0.4);
  fx.burst(player.x, player.y, -4, 40, {
    colors: [0xbdfff6, 0x9dfcff, 0xffffff], speed: 24, size: 2.2, life: 0.9,
  });
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const d = e.obj.position.distanceTo(origin);
    if (d < 70) {
      damageEnemy(e, 6);
    }
  }
  if (G.boss && G.boss.obj.position.distanceTo(origin) < 80) {
    damageBoss(10);
  }
  refreshHud();
}

/* ---------------- 플레이어 피해 ---------------- */
function hurtPlayer(amount) {
  if (G.state !== 'playing' || G.invuln > 0) return;
  if (G.shield > 0) {
    G.shield--;
    G.invuln = 0.7;
    sound.hit();
    fx.ring(new THREE.Vector3(player.x, player.y, 0), 0xa8b8ff, 12, 0.5);
    G.shake = 0.35;
    refreshHud();
    return;
  }
  G.hull -= amount;
  G.invuln = 1.5;
  G.shake = 0.85;
  sound.damage();
  el.flash.classList.add('on');
  G.flashTimer = 0.16;
  refreshHud();
  updateHearts();
  if (G.hull <= 0) {
    G.hull = 0;
    updateHearts();
    gameOver();
  }
}

/* ---------------- 보스 피해 ---------------- */
function damageBoss(dmg) {
  if (!G.boss || G.boss.dead) return;
  const b = G.boss;
  b.hp -= dmg;
  b.hit = 0.12;
  const p = b.obj.position;
  fx.burst(p.x, p.y + 1.5, p.z - 3, 5, {
    colors: [0xffe0a0, 0xffb070, 0xffffff], speed: 9, size: 1.4, life: 0.4,
  });
  sound.hit();
  updateBossBar();
  if (b.hp <= 0) {
    b.dead = true;
    const pos = p.clone();
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        if (!G.boss && i > 0) return;
        fx.burst(
          pos.x + rand(-3, 3), pos.y + rand(-2, 2), pos.z + rand(-3, 3), 18,
          { colors: [0xffd9a0, 0xff7b4a, 0xffffff], speed: 14, size: 2.6, life: 0.9 }
        );
      }, i * 110);
    }
    fx.flash(pos, 0xffc27a, 22, 0.7);
    fx.ring(pos, 0xffc27a, 30, 0.9);
    sound.explode('big');
    G.shake = 1.4;
    G.score += 2200 + G.wave * 120;
    for (let i = 0; i < 3; i++) {
      dropItem(pos.x + rand(-3, 3), pos.y + rand(-1, 2), pos.z + 4, ['multi', 'rapid', 'shield'][i]);
    }
    setTimeout(() => {
      removeBoss();
      G.kills = Infinity;
      waveCleared();
    }, 700);
  }
}

/* ---------------- 메인 루프 ---------------- */
let acc = 0;
let frames = 0;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  // FPS 적응형 화질
  frames++;
  acc += dt;
  if (acc > 2.5) {
    const fps = frames / acc;
    frames = 0;
    acc = 0;
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
    // 일시정지: 이펙트만 유지
    fx.update(0, camera);
  }

  renderer.render(scene, camera);
}

function updateIdle(dt) {
  G.elapsed += dt;
  world.update(dt, 7, G.elapsed);
  fx.update(dt, camera);

  // 메뉴에서는 잠수정이 살짝 떠다닌다
  const px = Math.sin(G.elapsed * 0.32) * 4.2;
  const py = Math.sin(G.elapsed * 0.5) * 1.1;
  player.obj.position.set(px, py, 0);
  player.obj.rotation.z = Math.sin(G.elapsed * 0.32) * -0.18;
  player.obj.rotation.y = Math.sin(G.elapsed * 0.44) * 0.06;
  player.obj.rotation.x = Math.sin(G.elapsed * 0.6) * 0.05;
  player.prop.rotation.z += dt * 7;

  const camX = px * 0.5 + Math.sin(G.elapsed * 0.2) * 0.8;
  camera.position.lerp(tmpVec.set(camX, 3.4 + py * 0.5, 11), 1 - Math.exp(-2 * dt));
  camera.lookAt(px * 0.6, py * 0.8 + 0.4, -20);

  if (G.state === 'menu') {
    G.pingTimer -= dt;
    if (G.pingTimer <= 0) {
      G.pingTimer = 11 + Math.random() * 6;
      sound.init();
      if (sound.ac && sound.ac.state === 'running') sound.sonar();
    }
  }
}

function updateGame(dt) {
  G.elapsed += dt;
  const t = G.elapsed;

  /* --- 플레이어 이동 --- */
  if (keys.has('arrowleft') || keys.has('a') || keys.has('ㅁ')) player.tx -= 17 * dt;
  if (keys.has('arrowright') || keys.has('d') || keys.has('ㅇ')) player.tx += 17 * dt;
  if (keys.has('arrowup') || keys.has('w') || keys.has('ㅈ')) player.ty += 13 * dt;
  if (keys.has('arrowdown') || keys.has('s') || keys.has('ㄴ')) player.ty -= 13 * dt;
  player.tx = clamp(player.tx, -LIMIT_X, LIMIT_X);
  player.ty = clamp(player.ty, LIMIT_Y_MIN, LIMIT_Y_MAX);

  const prevX = player.x;
  const prevY = player.y;
  const damp = 1 - Math.exp(-9 * dt);
  player.x += (player.tx - player.x) * damp;
  player.y += (player.ty - player.y) * damp;
  player.vx = (player.x - prevX) / Math.max(dt, 0.0001);
  player.vy = (player.y - prevY) / Math.max(dt, 0.0001);

  const targetRoll = clamp(-player.vx * 0.045, -0.55, 0.55);
  const targetPitch = clamp(player.vy * 0.035, -0.35, 0.35);
  player.roll += (targetRoll - player.roll) * Math.min(1, dt * 6);
  player.pitch += (targetPitch - player.pitch) * Math.min(1, dt * 6);

  player.bob += dt * 1.6;
  const bobY = Math.sin(player.bob) * 0.09;
  player.obj.position.set(player.x, player.y + bobY, 0.2);
  player.obj.rotation.set(player.pitch, player.roll * 0.35, player.roll);

  player.prop.rotation.z += dt * (10 + G.speed * 0.9);

  /* --- 기포 흘리기 --- */
  G.bubbleTimer -= dt;
  if (G.bubbleTimer <= 0) {
    G.bubbleTimer = 0.12;
    fx.emit(
      player.x + rand(-0.3, 0.3), player.y - 0.2, 1.6,
      rand(-0.6, 0.6), rand(0.3, 1.1), rand(3, 6),
      0xd6ffff, rand(0.6, 1.4), rand(1.2, 2.0), 0.9, 0.7
    );
  }

  /* --- 전진 & 수심 --- */
  G.dist += G.speed * dt;
  G.depth = 12 + G.dist * 0.055;
  if (G.depth > G.maxDepth) G.maxDepth = G.depth;

  /* --- 카메라 --- */
  const shakeX = G.shake > 0 ? rand(-1, 1) * G.shake * 0.5 : 0;
  const shakeY = G.shake > 0 ? rand(-1, 1) * G.shake * 0.5 : 0;
  const camTarget = tmpVec.set(
    player.x * 0.62 + shakeX,
    player.y * 0.62 + 3.0 + shakeY,
    9.6
  );
  camera.position.lerp(camTarget, 1 - Math.exp(-5.5 * dt));
  camera.lookAt(player.x * 0.92, player.y + 1.15, -26);
  camera.rotation.z += player.roll * 0.06;
  G.shake = Math.max(0, G.shake - dt * 2.2);

  /* --- 월드 --- */
  world.update(dt, G.speed, t);

  /* --- 발사 --- */
  G.fireTimer -= dt;
  const interval = G.rapid > 0 ? 0.088 : 0.176;
  if (G.fireTimer <= 0) {
    G.fireTimer = interval;
    fire();
  }

  /* --- 파워업 타이머 --- */
  if (G.multi > 0) G.multi = Math.max(0, G.multi - dt);
  if (G.rapid > 0) G.rapid = Math.max(0, G.rapid - dt);
  if (G.invuln > 0) G.invuln = Math.max(0, G.invuln - dt);

  /* --- 사운드 스케줄 --- */
  G.pingTimer -= dt;
  if (G.pingTimer <= 0) {
    G.pingTimer = 12 + Math.random() * 8;
    sound.sonar();
  }

  /* --- 스폰 --- */
  if (!G.boss && G.waveGoal !== Infinity) {
    G.spawnTimer -= dt;
    if (G.spawnTimer <= 0 && enemies.length < 14) {
      const base = Math.max(0.42, 1.5 - G.wave * 0.075);
      G.spawnTimer = base * rand(0.7, 1.3);
      spawnEnemy();
    }
  }

  updateEnemies(dt, t);
  updateBoss(dt, t);
  updateTorpedoes(dt);
  updateOrbs(dt);
  updateItems(dt, t);
  fx.update(dt, camera);

  /* --- 웨이브 진행 --- */
  if (G.pendingWave > 0) {
    G.pendingWave -= dt;
    if (G.pendingWave <= 0) startWave(G.wave + 1);
  } else if (!G.boss && G.kills >= G.waveGoal) {
    waveCleared();
  }

  /* --- UI --- */
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
  el.reticle.classList.toggle('locked', !!findTarget());
}

/* ---------------- 적 업데이트 ---------------- */
function updateEnemies(dt, t) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const o = e.obj;
    e.age += dt;
    e.phase += dt * e.swirl;

    if (e.type === 'shark') {
      o.position.z += (G.speed + e.speed) * dt;
      const targetX = player.x + Math.sin(e.phase) * 3.2;
      o.position.x += (targetX - o.position.x) * Math.min(1, dt * 0.9);
      o.position.y += (player.y - o.position.y) * Math.min(1, dt * 0.45) + Math.sin(e.phase * 2) * dt * 1.4;
      o.rotation.z = Math.sin(e.phase * 2) * 0.35;
      o.rotation.y = Math.sin(e.phase) * 0.22;
      if (o.children[1]) o.children[1].rotation.y = Math.sin(e.phase * 3.4) * 0.5;
    } else if (e.type === 'jelly') {
      o.position.z += (G.speed * 0.72 + e.speed) * dt;
      o.position.x += Math.sin(e.phase) * dt * 2.4;
      o.position.y += Math.cos(e.phase * 1.4) * dt * 1.8;
      const pulse = 1 + Math.sin(e.phase * 2.6) * 0.09;
      o.scale.setScalar(e.scale0 * pulse);
      o.rotation.z = Math.sin(e.phase) * 0.16;
    } else {
      o.position.z += G.speed * 0.6 * dt;
      o.rotation.y += dt * 0.8;
      o.rotation.x += dt * 0.35;
      const bl = o.children[1];
      if (bl && bl.material) {
        bl.material.opacity = 0.35 + Math.abs(Math.sin(e.phase * 2)) * 0.65;
        bl.visible = Math.sin(e.phase * 3) > -0.3;
      }
    }

    // 피격 반동
    if (e.hit > 0) {
      e.hit -= dt;
      const s = 1 + e.hit * 0.9;
      if (e.type !== 'jelly') o.scale.setScalar(s);
    }

    // 플레이어 충돌
    const dz = o.position.z;
    if (dz > -3.2 && dz < 2.8) {
      const dx = o.position.x - player.x;
      const dy = o.position.y - player.y;
      if (dx * dx + dy * dy < (e.r + 1.25) * (e.r + 1.25)) {
        if (e.type === 'mine') {
          fx.burst(o.position.x, o.position.y, o.position.z, 20, {
            colors: [0xffd9a0, 0xff7b4a, 0xffffff], speed: 12, size: 2, life: 0.7,
          });
          fx.flash(o.position.clone(), 0xffaa66, 9, 0.35);
          sound.explode('big');
        }
        hurtPlayer(1);
        enemies.splice(i, 1);
        scene.remove(o);
        continue;
      }
    }

    // 통과한 적 제거
    if (dz > 16) {
      enemies.splice(i, 1);
      scene.remove(o);
    }
  }
}

/* ---------------- 보스 업데이트 ---------------- */
function updateBoss(dt, t) {
  const b = G.boss;
  if (!b) return;
  b.phase += dt;
  const o = b.obj;
  const baseScale = 1.05 + Math.min(0.5, G.wave * 0.02);
  o.scale.setScalar(baseScale);

  const targetZ = -34;
  if (o.position.z < targetZ) {
    o.position.z += 16 * dt;
  } else {
    o.position.z = targetZ + Math.sin(b.phase * 0.5) * 3;
  }
  b.x = Math.sin(b.phase * 0.55) * 9.5;
  b.y = 0.5 + Math.sin(b.phase * 0.8) * 2.4;
  o.position.x += (b.x - o.position.x) * Math.min(1, dt * 1.6);
  o.position.y += (b.y - o.position.y) * Math.min(1, dt * 1.6);
  o.rotation.y = -Math.cos(b.phase * 0.55) * 0.35;
  o.rotation.z = Math.sin(b.phase * 0.8) * 0.1;

  b.tail.rotation.y = Math.sin(b.phase * 2.2) * 0.35;
  const jawOpen = 0.16 + Math.abs(Math.sin(b.phase * 1.6)) * 0.4;
  b.jaw.rotation.x = -jawOpen;
  b.lure.position.y = 4.3 + Math.sin(b.phase * 1.3) * 0.35;
  if (b.lureGlow) b.lureGlow.position.copy(b.lure.position);

  if (b.hit > 0) {
    b.hit -= dt;
    o.scale.setScalar(baseScale * (1 + b.hit * 0.4));
  }

  // 발사
  b.fire -= dt;
  if (b.fire <= 0 && o.position.z > -60) {
    b.fire = Math.max(0.8, 1.9 - G.wave * 0.03);
    const count = G.wave >= 9 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const orb = orbs.find((x) => !x.active);
      if (!orb) break;
      const start = new THREE.Vector3(
        o.position.x + rand(-1.5, 1.5),
        o.position.y + rand(-0.6, 1.2),
        o.position.z + 4.5
      );
      const dir = new THREE.Vector3(
        player.x - start.x + (i - (count - 1) / 2) * 3,
        player.y - start.y,
        6
      ).normalize();
      orb.active = true;
      orb.life = 7;
      orb.mesh.visible = true;
      orb.mesh.position.copy(start);
      orb.vel.copy(dir).multiplyScalar(21 + G.wave * 0.4);
    }
    sound.shoot();
  }

  // 접촉 피해
  const d = o.position.distanceTo(new THREE.Vector3(player.x, player.y, 0));
  if (d < 7) hurtPlayer(1);
}

/* ---------------- 어뢰 ---------------- */
function updateTorpedoes(dt) {
  for (const tor of torpedoes) {
    if (!tor.active) continue;
    tor.life -= dt;
    if (tor.life <= 0) {
      tor.active = false;
      tor.mesh.visible = false;
      continue;
    }

    // 소프트 호밍
    const target = findTarget(tor.mesh.position, 0.55);
    if (target) {
      const desired = tmpVec.copy(target.obj.position).sub(tor.mesh.position).normalize().multiplyScalar(92);
      tor.vel.lerp(desired, Math.min(1, dt * 3.2));
    }
    tor.mesh.position.addScaledVector(tor.vel, dt);
    tor.mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      tmpVec2.copy(tor.vel).normalize()
    );

    // 꼬리 잔광
    tor.trail = (tor.trail || 0) + dt;
    if (tor.trail > 0.035) {
      tor.trail = 0;
      fx.emit(tor.mesh.position.x, tor.mesh.position.y, tor.mesh.position.z,
        rand(-0.4, 0.4), rand(-0.4, 0.4), 6, 0x9dfcff, 0.9, 0.35, 0, 2.4);
    }

    // 명중 판정
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const dx = e.obj.position.x - tor.mesh.position.x;
      const dy = e.obj.position.y - tor.mesh.position.y;
      const dz = e.obj.position.z - tor.mesh.position.z;
      const rr = e.r + 0.7;
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
      if (dx * dx + dy * dy + dz * dz < 30) {
        damageBoss(1);
        tor.active = false;
        tor.mesh.visible = false;
        continue;
      }
    }

    if (tor.mesh.position.z < -150 || Math.abs(tor.mesh.position.x) > 40) {
      tor.active = false;
      tor.mesh.visible = false;
    }
  }
}

/* ---------------- 조준 대상 찾기 ---------------- */
const forward = new THREE.Vector3();
function findTarget(fromPos, coneCos) {
  const from = fromPos || new THREE.Vector3(player.x, player.y, 0);
  camera.getWorldDirection(forward);
  let best = null;
  let bestScore = -Infinity;
  for (const e of enemies) {
    const dx = e.obj.position.x - from.x;
    const dy = e.obj.position.y - from.y;
    const dz = e.obj.position.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1 || dist > 95) continue;
    const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / dist;
    if (dot < (coneCos === undefined ? 0.9 : coneCos)) continue;
    const s = dot * 2 - dist * 0.006;
    if (s > bestScore) {
      bestScore = s;
      best = e;
    }
  }
  if (G.boss && !G.boss.dead) {
    const p = G.boss.obj.position;
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const dz = p.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 1) {
      const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / dist;
      if (dot > 0.92) return { obj: { position: p }, boss: true };
    }
  }
  return best;
}

/* ---------------- 보스 탄 ---------------- */
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
      rand(-0.3, 0.3), rand(-0.3, 0.3), 2, 0xffa070, 1.1, 0.4, 0, 2);

    const dx = o.mesh.position.x - player.x;
    const dy = o.mesh.position.y - player.y;
    const dz = o.mesh.position.z - 0;
    if (dx * dx + dy * dy + dz * dz < 6.5) {
      hurtPlayer(1);
      o.active = false;
      o.mesh.visible = false;
      fx.burst(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, 10, {
        colors: [0xffa070, 0xffe0a0], speed: 8, size: 1.4, life: 0.4,
      });
      continue;
    }
    if (o.mesh.position.z > 14) {
      o.active = false;
      o.mesh.visible = false;
    }
  }
}

/* ---------------- 아이템 ---------------- */
function updateItems(dt, t) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.age += dt;
    it.obj.position.z += G.speed * 0.85 * dt;
    it.obj.position.y += Math.sin(t * 2 + it.phase) * dt * 0.9;
    it.obj.rotation.y += dt * 2.2;
    it.obj.rotation.x += dt * 1.3;

    const dx = it.obj.position.x - player.x;
    const dy = it.obj.position.y - player.y;
    const dz = it.obj.position.z;

    // 자석 효과
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 90) {
      const f = Math.min(1, dt * 3.4) * (1 - d2 / 90);
      it.obj.position.x -= dx * f;
      it.obj.position.y -= dy * f;
      it.obj.position.z -= dz * f * 0.7;
    }

    if (d2 < 12) {
      collectItem(it);
      items.splice(i, 1);
      scene.remove(it.obj);
      continue;
    }
    if (it.obj.position.z > 14) {
      items.splice(i, 1);
      scene.remove(it.obj);
    }
  }
}

/* ---------------- 리사이즈 ---------------- */
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(pixelRatio);
}

/* ---------------- 버튼 ---------------- */
function bindButtons() {
  $('btn-start').addEventListener('click', startGame);
  $('btn-again').addEventListener('click', startGame);
  $('btn-menu').addEventListener('click', () => {
    G.state = 'menu';
    G.pingTimer = 3;
    el.overScreen.classList.add('hidden');
    el.pauseScreen.classList.add('hidden');
    el.startScreen.classList.remove('hidden');
    el.hud.classList.add('hud-hidden');
    setText(el.startBest, G.best.toLocaleString('ko-KR'));
    resetGame();
    G.state = 'menu';
    player.obj.visible = true;
    G.waveGoal = 0;
    G.kills = 0;
    G.pendingWave = 0;
    if (G.boss) removeBoss();
    for (const e of enemies) scene.remove(e.obj);
    enemies.length = 0;
  });
  $('btn-resume').addEventListener('click', () => togglePause(false));
  $('btn-restart').addEventListener('click', startGame);
  el.pause.addEventListener('click', () => togglePause(G.state === 'playing'));
  el.mute.addEventListener('click', toggleMute);
  el.bombBtn.addEventListener('click', useBomb);
}

/* ---------------- 부트 ---------------- */
function boot() {
  try {
    initThree();
  } catch (e) {
    el.loading.innerHTML = '<p style="padding:24px;text-align:center;line-height:1.6">이 브라우저에서 3D 그래픽(WebGL)을 시작할 수 없습니다.<br />사파리 최신 버전에서 다시 시도해 주세요.</p>';
    return;
  }
  bindInput();
  bindButtons();
  buildHearts();
  setText(el.startBest, G.best.toLocaleString('ko-KR'));
  setText(el.best, G.best.toLocaleString('ko-KR'));
  camera.position.set(0, 3.4, 11);
  camera.lookAt(0, 0.5, -20);
  world.update(0, 0, 0);
  renderer.render(scene, camera);

  setTimeout(() => el.loading.classList.add('done'), 180);
  setTimeout(() => { el.loading.style.display = 'none'; }, 800);

  G.pingTimer = 4;
  loop();
}

boot();
