// 水瀬市ドライブ：メインループ・カメラ・時間/天候・UI・入力
import { Renderer } from './renderer.js';
import { City } from './city.js';
import { GB } from './geo.js';
import { M4, clamp, lerp, rng } from './math.js';
import { buildPlayerCar, MIRA_COLORS, MODELS, VARIATIONS, buildCar, buildMiraNPC } from './carmodels.js';
import { Player } from './player.js';
import { Traffic } from './traffic.js';
import { Sound, Music, TRACKS } from './audio.js';
import { saveGame, loadGame } from './save.js';
import { L } from './textures.js';

const $ = id => document.getElementById(id);
const S = { camD: 5.6, camH: 2.2, npc: 30, auto: 1, draw: 380, res: 0.85, vol: 0.7, assist: 1, dbg: 0, flow: 1, weather: 'auto', bgm: 'auto', bgmVol: 0.5 };
const START = { x: -60, z: -379.9, yaw: Math.PI / 2 };
const WARPS = [['駅前（スタート地点）', -60, -379.9, Math.PI / 2], ['国道ロードサイド（片側3車線）', 620, -5.25, Math.PI / 2], ['バイパス（高架の手前）', 1005.25, -420, 0], ['みなせ峠 入口', -501.5, -1020, Math.PI], ['道の駅 みなせ峠', 'pad'], ['水瀬川の橋', 1.6, 470, 0], ['田園地帯', -998.4, 1300, 0], ['水瀬工業団地', -1700, -4.9, Math.PI / 2], ['郊外住宅地', -998.4, -760, 0], ['路面電車の通り（中心部）', -300, 4.9, -Math.PI / 2]];
let color = 0, state = 'load', R, city, player, traffic, snd, music, car = {}, npcMesh = [], npcLod = [], meshes = {};
let gameMin = 7 * 60 + 30, weather = 'clear', wetK = 0, cloudK = 0, rainK = 0, weatherT = 240;
let camMode = 0, cam = { p: [0, 50, 0], look: [0, 0, 0] }, lightMode = 0, wink = 0, winkYaw = 0, horn = false, T = 0;
let perfT = 0, perfN = 0, perfK = 1, resK = 1, lastSave = 0, distName = '', selYaw = 0, prevState = 'title';
const keys = {}, touch = {};

function toast(msg, t = 1600) { const el = $('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), t); }
function show(id) { for (const s of ['load', 'title', 'select', 'settings', 'howto', 'pause']) $(s).classList.toggle('on', s === id); }
const frame = () => new Promise(r => requestAnimationFrame(r));

// ---------------- 起動 ----------------
async function boot() {
  const bar = $('lbar'), msg = $('lmsg');
  try {
    R = new Renderer($('gl'));
    bar.style.width = '15%'; msg.textContent = '道路ネットワークと街区を生成中…'; await frame();
    city = new City();
    bar.style.width = '45%'; msg.textContent = '車両モデル（50車種）を生成中…'; await frame();
    for (const m of MODELS) { const g = new GB(); buildCar(m, g, { lod: 0 }); npcMesh[m.id] = R.mesh(g.build()); const g1 = new GB(); buildCar(m, g1, { lod: 1 }); npcLod[m.id] = R.mesh(g1.build()); }
    const pc = buildPlayerCar(); car.def = pc;
    for (const k of ['body', 'glass', 'interior', 'wheel', 'wheelR', 'steer', 'needle']) car[k] = R.mesh(pc[k].build());
    { const g = new GB(); buildMiraNPC(g); npcMesh[0] = R.mesh(g.build()); }
    meshes.global = R.mesh(city.global.build()); meshes.gdecal = R.mesh(city.globalDecal.build()); meshes.tram = R.mesh(city.tramGeo.build());
    meshes.mtn = R.mesh(city.mountains.build()); meshes.train = R.mesh(city.trainGeo.build());
    meshes.sky = R.mesh(skyDome()); meshes.lamps = R.mesh(lampGeo()); meshes.rain = R.mesh(rainGeo(), R.gl.LINES); meshes.studio = R.mesh(studioGeo());
    bar.style.width = '60%'; msg.textContent = '周辺エリアを読み込み中…'; await frame();
    player = new Player(city); player.reset(START.x, START.z, START.yaw);
    traffic = new Traffic(city, rng(Date.now() & 0xffff));
    snd = new Sound(); music = new Music(snd);
    { const si = snd.init.bind(snd); snd.init = () => { si(); music.init(); music.mode = S.bgm; music.setVol(S.bgmVol); }; }
    const sv = await loadGame();
    if (sv) applySave(sv);
    // 開始地点周辺のチャンクを先に読み込む
    const near = city.chunks.map(c => [c, Math.hypot(c.x - player.x, c.z - player.z)]).sort((a, b) => a[1] - b[1]);
    let k = 0;
    for (const [c, d] of near) { if (d < S.draw + 300) { city.buildChunk(c, R); k++; if (k % 3 === 0) { bar.style.width = (60 + Math.min(38, k * 2)) + '%'; await frame(); } } }
    buildMinimap();
    initUI();
    $('mContinue').hidden = !sv;
    show('title'); state = 'title';
    console.log('city stats', city.stats, 'lotsAI', city.stats.lotsAI, 'aabbs', city.aabbs.length, 'variations', VARIATIONS);
    window.G = { get player() { return player; }, get traffic() { return traffic; }, city, S, R, setCam: m => { camMode = m; }, setTime: h => { gameMin = h * 60; }, setWeather: w => { S.weather = w; weather = w; }, tp: (x, z, yaw) => player.reset(x, z, yaw, 1000), state: () => state, sel: () => openSelect('title'), stats: () => ({ fps: tick.fps, ms: loop.ms, draws: R.stats.draws, tris: R.stats.tris, npc: traffic.cars.length, target: traffic.target, parked: traffic.stats.parkedNow, chunks: city.chunks.filter(c => c.m).length }) };
    requestAnimationFrame(loop);
  } catch (e) { console.error(e); $('err').textContent = 'エラー: ' + e.message; }
}

function skyDome() {
  const g = new GB(), n = 16, rs = [0, 0.08, 0.2, 0.45, 0.75, 1];
  for (let i = 0; i < n; i++) for (let j = 0; j < rs.length - 1; j++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, e0 = rs[j] * Math.PI / 2, e1 = rs[j + 1] * Math.PI / 2;
    const P = (a, e) => [Math.cos(a) * Math.cos(e), Math.sin(e) - 0.05, Math.sin(a) * Math.cos(e)];
    const c0 = [rs[j], 0, 0], c1 = [rs[j + 1], 0, 0];
    g.vert(P(a0, e0), [0, 1, 0], c0, [0, 0], 6, 0); g.vert(P(a1, e0), [0, 1, 0], c0, [0, 0], 6, 0); g.vert(P(a1, e1), [0, 1, 0], c1, [0, 0], 6, 0);
    g.vert(P(a0, e0), [0, 1, 0], c0, [0, 0], 6, 0); g.vert(P(a1, e1), [0, 1, 0], c1, [0, 0], 6, 0); g.vert(P(a0, e1), [0, 1, 0], c1, [0, 0], 6, 0);
  }
  return g.build();
}
function lampGeo() { // 信号灯（ローカル：-z面）。左から青・黄・赤（運転者から見て）
  const g = new GB(), cols = [[0.1, 0.95, 0.75], [1, 0.72, 0.08], [1, 0.12, 0.08]], xs = [0.42, 0, -0.42];
  for (let k = 0; k < 3; k++) for (let i = 0; i < 10; i++) {
    const a0 = i / 10 * Math.PI * 2, a1 = (i + 1) / 10 * Math.PI * 2, r = 0.15;
    g.tri([xs[k], 0, -0.17], [xs[k] + Math.cos(a0) * r, Math.sin(a0) * r, -0.17], [xs[k] + Math.cos(a1) * r, Math.sin(a1) * r, -0.17], { c: cols[k], mat: 12 + k });
  }
  return g.build();
}
function rainGeo() {
  const g = new GB(), r = rng(5);
  for (let i = 0; i < 900; i++) { const x = (r() - 0.5) * 50, y = r() * 24, z = (r() - 0.5) * 50; g.line([x, y, z], [x + 0.05, y - 0.9, z], [0.75, 0.78, 0.85]); }
  return g.build();
}
function studioGeo() {
  const g = new GB();
  g.cyl(0, -0.05, 0, 3.4, 0.05, 32, { c: [0.25, 0.26, 0.29] });
  g.flat(-40, -40, 40, 40, -0.06, { c: [0.08, 0.085, 0.1] });
  return g.build();
}

// ---------------- 環境（時間・天候） ----------------
const KEYS = [
  [0, [0.02, 0.03, 0.07], [0.05, 0.07, 0.16], [0.05, 0.06, 0.1], [0.12, 0.13, 0.2], 1],
  [4.8, [0.02, 0.03, 0.07], [0.05, 0.07, 0.16], [0.05, 0.06, 0.1], [0.12, 0.13, 0.2], 1],
  [6.0, [0.62, 0.52, 0.52], [0.32, 0.38, 0.6], [0.75, 0.5, 0.35], [0.33, 0.33, 0.4], 0.55],
  [7.5, [0.7, 0.78, 0.86], [0.36, 0.55, 0.85], [1.0, 0.92, 0.8], [0.44, 0.46, 0.52], 0],
  [12, [0.72, 0.8, 0.9], [0.3, 0.52, 0.88], [1.05, 1.0, 0.94], [0.47, 0.49, 0.54], 0],
  [16.3, [0.74, 0.76, 0.82], [0.36, 0.52, 0.8], [1.0, 0.86, 0.68], [0.44, 0.43, 0.47], 0],
  [17.6, [0.95, 0.6, 0.42], [0.35, 0.4, 0.62], [0.95, 0.55, 0.3], [0.38, 0.33, 0.36], 0.3],
  [18.6, [0.32, 0.26, 0.38], [0.12, 0.14, 0.3], [0.3, 0.22, 0.3], [0.2, 0.2, 0.3], 0.85],
  [19.8, [0.03, 0.04, 0.09], [0.05, 0.07, 0.17], [0.06, 0.07, 0.12], [0.13, 0.14, 0.22], 1],
  [24, [0.02, 0.03, 0.07], [0.05, 0.07, 0.16], [0.05, 0.06, 0.1], [0.12, 0.13, 0.2], 1]
];
function envAt(h) {
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = clamp((h - a[0]) / (b[0] - a[0]), 0, 1);
  const mix = (u, v) => u.map((x, k) => lerp(x, v[k], t));
  return { fog: mix(a[1], b[1]), zen: mix(a[2], b[2]), sunC: mix(a[3], b[3]), amb: mix(a[4], b[4]), night: lerp(a[5], b[5], t) };
}
function envUniforms(dt) {
  const h = gameMin / 60;
  // 天候の遷移
  const tc = weather === 'cloudy' ? 1 : weather === 'rain' ? 1 : 0, tr = weather === 'rain' ? 1 : 0;
  cloudK += clamp(tc - cloudK, -dt * 0.15, dt * 0.15); rainK += clamp(tr - rainK, -dt * 0.2, dt * 0.2);
  wetK += clamp(tr - wetK, -dt * 0.03, dt * 0.08);
  const E = envAt(h);
  const gray = c => { const l = (c[0] + c[1] + c[2]) / 3; return c.map(x => lerp(x, l, 0.75)); };
  let fog = E.fog, zen = E.zen;
  fog = fog.map((x, k) => lerp(x, gray(E.fog)[k] * (1 - rainK * 0.25), cloudK));
  zen = zen.map((x, k) => lerp(x, gray(E.zen)[k] * 1.1 * (1 - rainK * 0.3), cloudK));
  const sunC = E.sunC.map(x => x * (1 - cloudK * 0.55 - rainK * 0.2)), amb = E.amb.map(x => x * (1 - rainK * 0.12));
  const night = clamp(E.night + rainK * 0.25 + cloudK * 0.08, 0, 1);
  const a = (h - 6) / 12 * Math.PI, up = Math.sin(a);
  const sun = up > 0.05 ? norm([Math.cos(a) * 0.75, up, 0.45]) : norm([0.3, 0.8, 0.4]);
  const draw = S.draw;
  const fogN = lerp(120, 30, rainK) , fogF = lerp(draw + 220, 330, rainK);
  return { fog, zen, sun, sunC, amb, night, wet: wetK, fogN, fogF, hour: h };
}
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
function autoWeather(dtMin) {
  if (S.weather !== 'auto') { weather = S.weather; return; }
  weatherT -= dtMin;
  if (weatherT <= 0) {
    const r = Math.random(); const nw = r < 0.5 ? 'clear' : r < 0.8 ? 'cloudy' : 'rain';
    if (nw !== weather) toast({ clear: '天気：晴れ', cloudy: '天気：曇り', rain: '天気：雨が降ってきた' }[nw]);
    weather = nw; weatherT = 180 + Math.random() * 240;
  }
}

// ---------------- 入力 ----------------
function initUI() {
  // タッチボタン
  const hold = (id, k) => {
    const el = $(id);
    const on = e => { e.preventDefault(); touch[k] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (_) { } snd.init(); };
    const off = e => { touch[k] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
  };
  hold('bL', 'left'); hold('bR', 'right'); hold('bA', 'thr'); hold('bB', 'brk'); hold('tHorn', 'horn');
  const tap = (id, f) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); snd.init(); f(); });
  tap('tBgm', cycleBgm); tap('tCam', cycleCam); tap('tLight', cycleLight); tap('tWL', () => setWink(-1)); tap('tWR', () => setWink(1)); tap('tRev', toggleRev); tap('tMenu', pause);
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (state === 'drive') {
      if (e.code === 'KeyC') cycleCam(); if (e.code === 'KeyL') cycleLight(); if (e.code === 'KeyQ') setWink(-1); if (e.code === 'KeyE') setWink(1);
      if (e.code === 'KeyR') toggleRev(); if (e.code === 'KeyM') cycleBgm(); if (e.code === 'Escape' || e.code === 'KeyP') pause();
    } else if (state === 'pause' && e.code === 'Escape') resume();
    if (state === 'drive' && /Arrow|Space/.test(e.code)) e.preventDefault();
    snd.init();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; for (const k in touch) touch[k] = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (state === 'drive') { doSave(true); pause(); } snd.suspend(); } else snd.resume(); });
  // メニュー
  $('mStart').onclick = () => { snd.init(); if ($('mContinue').hidden) startDrive(); else { player.reset(START.x, START.z, START.yaw); startDrive(); } };
  $('mContinue').onclick = () => { snd.init(); startDrive(); };
  $('mVehicle').onclick = () => openSelect('title');
  $('mSettings').onclick = () => openSettings('title');
  $('mHow').onclick = () => { show('howto'); prevState = 'title'; };
  $('howBack').onclick = () => show('title');
  $('selBack').onclick = () => closeSelect();
  $('selOk').onclick = () => { closeSelect(); doSave(true); };
  $('setBack').onclick = () => { applySettings(); doSave(true); show(prevState === 'pause' ? 'pause' : 'title'); };
  $('pResume').onclick = resume; $('pVehicle').onclick = () => openSelect('pause'); $('pSettings').onclick = () => openSettings('pause');
  $('pSave').onclick = async () => { const w = await doSave(true); toast('セーブしました（' + w + '）'); };
  $('pRespawn').onclick = () => { const w = WARPS[+$('pWarp').value]; if (w[1] === 'pad') { const p = city.restPad; player.reset((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, 0); } else player.reset(w[1], w[2], w[3], 1000); cam.mode = -1; resume(); };
  $('pWarp').innerHTML = WARPS.map((w, i) => `<option value="${i}">${w[0]}</option>`).join('');
  $('pTitle').onclick = async () => { await doSave(true); $('mContinue').hidden = false; state = 'title'; show('title'); setHud(false); };
  // 色チップ
  $('chips').innerHTML = MIRA_COLORS.map((c, i) => `<button class="chip" data-i="${i}" style="background:${c.hex}" aria-label="${c.name}"></button>`).join('');
  $('chips').onclick = e => { const b = e.target.closest('.chip'); if (b) { color = +b.dataset.i; markChips(); } };
}
function markChips() { document.querySelectorAll('.chip').forEach((b, i) => b.classList.toggle('on', i === color)); $('cname').textContent = MIRA_COLORS[color].name; }
function openSelect(from) { prevState = from; state = 'select'; show('select'); setHud(false); markChips(); }
function closeSelect() { if (prevState === 'pause') { state = 'pause'; show('pause'); } else { state = 'title'; show('title'); } }
function openSettings(from) {
  prevState = from; show('settings');
  $('sTime').value = 'keep'; $('sFlow').value = String(S.flow); $('sWeather').value = S.weather;
  $('sCamD').value = S.camD; $('sCamH').value = S.camH; $('sNpc').value = String(S.npc); $('sAuto').value = String(S.auto);
  $('sBgm').value = S.bgm; $('sBgmVol').value = S.bgmVol; $('sDraw').value = S.draw; $('sRes').value = S.res; $('sVol').value = S.vol; $('sAssist').value = String(S.assist); $('sDbg').value = String(S.dbg);
}
function applySettings() {
  const t = $('sTime').value; if (t !== 'keep') gameMin = parseFloat(t) * 60;
  S.flow = +$('sFlow').value; S.weather = $('sWeather').value; if (S.weather !== 'auto') weather = S.weather;
  S.camD = +$('sCamD').value; S.camH = +$('sCamH').value; S.npc = +$('sNpc').value; S.auto = +$('sAuto').value;
  S.draw = +$('sDraw').value; S.res = +$('sRes').value; S.vol = +$('sVol').value; S.assist = +$('sAssist').value; S.dbg = +$('sDbg').value;
  S.bgm = $('sBgm').value; S.bgmVol = +$('sBgmVol').value; music.mode = S.bgm; music.setVol(S.bgmVol);
  snd.setVol(S.vol); player.assist = !!S.assist; perfK = 1; resK = 1;
}
function startDrive() { state = 'drive'; show(null); setHud(true); toast('水瀬市へようこそ　' + MIRA_COLORS[color].name + ' のミライース'); }
function pause() { if (state !== 'drive') return; state = 'pause'; show('pause'); setHud(false); $('pInfo').textContent = `NPC ${traffic.cars.length}台（駐車中 ${traffic.stats.parkedNow}）／ 車両データ ${MODELS.length}車種・${VARIATIONS}通り`; }
function resume() { state = 'drive'; show(null); setHud(true); }
function setHud(on) { $('hud').classList.toggle('on', on); $('touch').classList.toggle('on', on); }
function cycleBgm() {
  const modes = ['auto', ...TRACKS.map(t => t.id), 'off'], i = (modes.indexOf(S.bgm) + 1) % modes.length;
  S.bgm = modes[i]; music.mode = S.bgm;
  toast('BGM：' + (S.bgm === 'auto' ? '自動（場所・時間・天気で選曲）' : S.bgm === 'off' ? 'OFF' : TRACKS.find(t => t.id === S.bgm).name), 1600);
}
function cycleCam() { camMode = (camMode + 1) % 3; toast(['三人称視点', '運転席視点', 'ボンネット視点'][camMode], 900); }
function cycleLight() { lightMode = (lightMode + 1) % 3; toast('ライト：' + ['自動', 'ON', 'OFF'][lightMode], 900); }
function setWink(d) { wink = wink === d ? 0 : d; winkYaw = player.yaw; }
function toggleRev() { if (Math.abs(player.vx) < 1) { player.gearReq = true; } else toast('停止してから切り替えてください', 1000); }

// ---------------- セーブ ----------------
function applySave(sv) {
  if (sv.color != null) color = sv.color;
  if (sv.x != null) player.reset(sv.x, sv.z, sv.yaw);
  if (sv.time != null) gameMin = sv.time;
  if (sv.weather) weather = sv.weather;
  if (sv.settings) Object.assign(S, sv.settings);
  player.assist = !!S.assist; snd.setVol(S.vol); if (music) { music.mode = S.bgm; music.setVol(S.bgmVol); }
}
async function doSave() {
  lastSave = T;
  return saveGame({ v: 1, color, x: player.x, z: player.z, yaw: player.yaw, time: gameMin, weather, settings: { ...S }, at: Date.now() });
}

// ---------------- ミニマップ ----------------
let MM;
const MMX0 = -2100, MMZ0 = -2100, MMS = 0.32;
function buildMinimap() {
  const W = Math.ceil(4200 * MMS);
  MM = document.createElement('canvas'); MM.width = W; MM.height = W;
  const c = MM.getContext('2d'), X = x => (x - MMX0) * MMS, Z = z => (z - MMZ0) * MMS, rect = (r, col) => { c.fillStyle = col; c.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * MMS, (r.z1 - r.z0) * MMS); };
  c.fillStyle = '#33452c'; c.fillRect(0, 0, W, W);
  c.fillStyle = '#26381f'; c.fillRect(0, 0, W, Z(-1000));
  for (const r of city.mm.green) rect(r, '#3d5a2c');
  rect({ x0: -505, x1: 505, z0: -505, z1: 505 }, '#3b3d3a');
  for (const r of city.mm.water) rect(r, '#2e5f86');
  for (const r of city.mm.lots) rect(r, '#4a4a48');
  for (const r of city.mm.blds) rect(r, '#6c6d74');
  for (const l of city.mm.lanes) {
    c.fillStyle = c.strokeStyle = l.kind === 'art' || l.kind === 'nat' ? '#f0d9a0' : l.kind === 'byp' ? '#9fd0f0' : l.kind === 'lane' ? '#8d8d88' : '#d8d8d0';
    if (l.poly) { c.lineWidth = 2 * l.w * MMS; c.beginPath(); l.poly.forEach((p, i) => i ? c.lineTo(X(p[0]), Z(p[1])) : c.moveTo(X(p[0]), Z(p[1]))); c.stroke(); continue; }
    const ext = l.kind === 'lane' ? 0 : l.w;
    if (l.axis === 'ns') c.fillRect(X(l.c - l.w), Z(l.a - ext), 2 * l.w * MMS, (l.b - l.a + 2 * ext) * MMS);
    else c.fillRect(X(l.a - ext), Z(l.c - l.w), (l.b - l.a + 2 * ext) * MMS, 2 * l.w * MMS);
  }
  c.fillStyle = '#9aa3b5'; c.fillRect(0, Z(-450), W, 10 * MMS);
}
function drawMinimap() {
  const cv = $('mm'), c = cv.getContext('2d'), W = cv.width, k = 2.4 * 0.5 / MMS * (player.kmh > 70 ? 0.7 : 1);
  c.save(); c.clearRect(0, 0, W, W); c.beginPath(); c.arc(W / 2, W / 2, W / 2, 0, 7); c.clip();
  c.fillStyle = '#2c3b27'; c.fillRect(0, 0, W, W);
  c.translate(W / 2, W / 2); c.rotate(Math.PI + player.yaw); c.scale(k, k);
  c.translate(-(player.x - MMX0) * MMS, -(player.z - MMZ0) * MMS);
  c.drawImage(MM, 0, 0);
  c.fillStyle = '#ffffff';
  for (const n of traffic.cars) { c.fillRect((n.x - MMX0) * MMS - 0.8, (n.z - MMZ0) * MMS - 0.8, 1.6, 1.6); }
  // 信号（現在の状態）
  for (const h of city.sigHeads) {
    const dx = h.x - player.x, dz = h.z - player.z; if (dx * dx + dz * dz > 120 * 120) continue;
    const s = city.sig(h.node, h.axis, T); c.fillStyle = s === 'g' ? '#19c3a0' : s === 'y' ? '#ffb63a' : '#ff4b3a';
    c.fillRect((h.x - MMX0) * MMS - 0.7, (h.z - MMZ0) * MMS - 0.7, 1.4, 1.4);
  }
  c.restore();
  c.fillStyle = '#ffb63a'; c.beginPath(); c.moveTo(W / 2, W / 2 - 12); c.lineTo(W / 2 - 8, W / 2 + 9); c.lineTo(W / 2, W / 2 + 4); c.lineTo(W / 2 + 8, W / 2 + 9); c.fill();
  c.fillStyle = '#fff'; c.font = '700 18px sans-serif'; c.textAlign = 'center';
  const nx = Math.sin(-(Math.PI + player.yaw)), ny = -Math.cos(-(Math.PI + player.yaw));
  void nx; void ny;
  const a = Math.PI + player.yaw, px = W / 2 + Math.sin(a) * (W / 2 - 16) * -1, py = W / 2 - Math.cos(a) * (W / 2 - 16) * -1;
  c.fillText('N', W / 2 + Math.sin(a) * (W / 2 - 18), W / 2 - Math.cos(a) * (W / 2 - 18) + 6); void px; void py;
}

// ---------------- メインループ ----------------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  T += dt;
  const t0 = performance.now();
  try { tick(dt); } catch (e) { console.error(e); $('err').textContent = e.message; }
  loop.ms = (loop.ms || 0) * 0.95 + (performance.now() - t0) * 0.05;
}
function tick(dt) {
  R.resize(S.res * resK);
  const aspect = R.cv.width / R.cv.height;
  if (state === 'select') { renderSelect(dt, aspect); return; }
  const driving = state === 'drive';
  // 時間
  if (driving || state === 'title') { gameMin = (gameMin + dt * S.flow) % 1440; autoWeather(dt * S.flow); }
  const env = envUniforms(driving || state === 'title' ? dt : 0);
  // 入力→物理
  if (driving) {
    const thr = (keys.ArrowUp || keys.KeyW || touch.thr) ? 1 : 0, brk = (keys.ArrowDown || keys.KeyS || keys.Space || touch.brk) ? 1 : 0;
    const st = ((keys.ArrowLeft || keys.KeyA || touch.left) ? 1 : 0) - ((keys.ArrowRight || keys.KeyD || touch.right) ? 1 : 0);
    player.input = { thr, brk, steer: st };
    horn = !!(keys.KeyH || touch.horn);
    const n = Math.ceil(dt / 0.008), h = dt / n;
    for (let i = 0; i < n; i++) player.step(h, { rain: rainK > 0.5 }, traffic.cars);
    if (player.hit > 0.15) { snd.thump(player.hit * 0.6); player.hit = 0; } else player.hit *= 0.9;
    // ウインカー自動キャンセル
    if (wink && Math.abs(player.steer) < 0.05 && Math.abs(((player.yaw - winkYaw + 9 * Math.PI) % (2 * Math.PI)) - Math.PI) > 1.1) wink = 0;
  }
  // カメラ
  const pM = M4.trs(player.x, player.y, player.z, player.yaw, player.pitch + (player.slopeV || 0), player.roll);
  const fwd = [Math.sin(player.yaw), 0, Math.cos(player.yaw)];
  let near = 0.3, fov = 60;
  if (state === 'title' || state === 'load') {
    const a = T * 0.05;
    cam.p = [START.x + 40 + Math.cos(a) * 160, 95, START.z + 120 + Math.sin(a) * 160]; cam.look = [START.x + 40, 0, START.z + 120];
  } else if (camMode === 0) {
    const tp = [player.x - fwd[0] * S.camD, player.y + S.camH, player.z - fwd[2] * S.camD];
    const k = 1 - Math.exp(-dt * 7);
    if (cam.mode !== 0) { cam.p = tp; cam.mode = 0; }
    cam.p = cam.p.map((v, i) => lerp(v, tp[i], k));
    // 建物にめり込みにくいよう距離を保つ
    const dx = cam.p[0] - player.x, dz = cam.p[2] - player.z, d = Math.hypot(dx, dz);
    if (d > S.camD * 1.25) { cam.p[0] = player.x + dx / d * S.camD * 1.25; cam.p[2] = player.z + dz / d * S.camD * 1.25; }
    cam.look = [player.x + fwd[0] * 3, player.y + 0.9, player.z + fwd[2] * 3];
  } else {
    const eye = camMode === 1 ? car.def.eye : [0, 1.06, 0.72];
    cam.p = M4.apply(pM, ...eye); const f2 = M4.apply(pM, eye[0], eye[1] - 0.04, eye[2] + 1);
    cam.look = f2; cam.mode = camMode; near = camMode === 1 ? 0.05 : 0.15; fov = camMode === 1 ? 66 : 62;
  }
  const up = camMode > 0 && state !== 'title' ? [pM[4], pM[5], pM[6]] : [0, 1, 0];
  const view = M4.lookAt(cam.p, cam.look, up), proj = M4.persp(fov * Math.PI / 180, aspect, near, 4300);
  const vp = M4.mul(proj, view), planes = M4.frustum(vp);
  // 交通
  if (driving || state === 'title') {
    traffic.base = S.npc; traffic.perfK = perfK;
    traffic.update(dt, T, env.hour, player, { speedK: rainK > 0.5 ? 0.85 : 1 }, planes);
  }
  // チャンクの読み込み・解放
  streamChunks();
  // 描画
  const lightsOn = lightMode === 1 || (lightMode === 0 && (env.night > 0.35 || rainK > 0.5));
  const hP = M4.apply(pM, 0, 0.75, car.def.p.L / 2), hD = norm([fwd[0], -0.07, fwd[2]]);
  const inTun = city.inTunnelXZ(cam.p[0], cam.p[2]) && city.mtnRoadAt(player.x, player.z);
  if (inTun) { env.sunC = env.sunC.map(x => x * 0.1); env.amb = env.amb.map(x => x * 0.45); env.fog = env.fog.map(x => x * 0.35); }
  if (music) {
    const z = player.z, rural = z > 600 || Math.abs(player.x) > 1500 || (player.x < -500 && Math.abs(z) < 500);
    const tr = music.update({ night: env.night > 0.6, rain: rainK > 0.5, mountain: z < -1050, rural }, driving || state === 'title');
    if (tr !== tick.track) { tick.track = tr; if (tr && driving) toast('♪ ' + tr.name, 2200); }
  }
  R.frame({ vp, fog: env.fog, sun: env.sun, sunC: env.sunC, amb: env.amb, cam: cam.p, fogN: env.fogN, fogF: env.fogF, night: env.night, wet: env.wet, hOn: lightsOn ? 1 : 0, hP, hD });
  drawWorld(env, planes, pM, lightsOn);
  // サウンド・HUD
  if (driving) {
    let npcNear = 0; for (const c of traffic.cars) { const d2 = (c.x - player.x) ** 2 + (c.z - player.z) ** 2; npcNear += c.v / 14 / (1 + d2 / 60); }
    snd.update({ rpm: player.rpm, thr: player.input.thr, kmh: player.kmh, brake: player.input.brk, slip: player.slip, rain: rainK > 0.4, horn, npcNear, cityK: Math.abs(player.x) < 300 && Math.abs(player.z) < 420 ? 1 : 0.3, cockpit: camMode > 0 });
    const b = (T % 0.8) < 0.4; if (wink && b !== tick.b) snd.tick(); tick.b = b;
    hud(env, lightsOn, b);
    if (T - lastSave > 15) doSave();
  } else if (snd.ok) snd.update({ rpm: 800, thr: 0, kmh: 0, brake: 0, slip: 0, rain: false, horn: false, npcNear: 0, cityK: 0, cockpit: false });
  // 性能自動調整
  perfT += dt; perfN++;
  if (perfT > 2) {
    const fps = perfN / perfT; tick.fps = fps;
    if (S.auto && driving) {
      if (fps < 28) { perfK = Math.max(0.5, perfK - 0.15); resK = Math.max(0.65, resK - 0.08); }
      else if (fps > 52) { perfK = Math.min(1, perfK + 0.1); resK = Math.min(1, resK + 0.05); }
    }
    perfT = 0; perfN = 0;
  }
}
function streamChunks() {
  let built = false;
  const p = state === 'title' ? cam.look : [player.x, 0, player.z];
  for (const c of city.chunks) {
    const d = Math.hypot(c.x - p[0], c.z - p[2]);
    if (!c.m && d < S.draw + 280 && !built) { city.buildChunk(c, R); built = true; }
    else if (c.m && d > S.draw + 560) city.freeChunk(c, R);
  }
}
function drawWorld(env, planes, pM, lightsOn) {
  const r = R, gl = r.gl;
  // 空
  gl.depthMask(false); r.draw(meshes.sky, new Float32Array([4000, 0, 0, 0, 0, 4000, 0, 0, 0, 0, 4000, 0, cam.p[0], cam.p[1], cam.p[2], 1]), env.zen); gl.depthMask(true);
  r.draw(meshes.mtn); r.draw(meshes.global);
  r.decal(1); r.draw(meshes.gdecal); r.decal(0);
  const vis = [];
  for (const c of city.chunks) if (c.m) {
    const d = Math.hypot(c.x - cam.p[0], c.z - cam.p[2]);
    if (d < S.draw + 180 && M4.sphereIn(planes, c.x, 10, c.z, 185)) vis.push(c);
  }
  for (const c of vis) r.draw(c.m.s);
  r.decal(1); for (const c of vis) r.draw(c.m.d1);
  r.decal(3); for (const c of vis) r.draw(c.m.d2); r.decal(0);
  for (const c of vis) r.draw(c.m.lines);
  // 信号灯
  const T0 = T;
  for (const h of city.sigHeads) {
    const dx = h.x - cam.p[0], dz = h.z - cam.p[2]; if (dx * dx + dz * dz > 260 * 260) continue;
    if (!M4.sphereIn(planes, h.x, h.y, h.z, 1)) continue;
    const s = city.sig(h.node, h.axis, T0);
    r.draw(meshes.lamps, M4.trs(h.x, h.y, h.z, h.yaw), null, null, s === 'g' ? [1, 0, 0] : s === 'y' ? [0, 1, 0] : [0, 0, 1]);
  }
  r.gl.uniform3fv(r.u.uSig, [0, 0, 0]);
  // 電車（高架）
  const tx = ((T * 14) % 4800) - 2400;
  if (Math.abs(tx - cam.p[0]) < S.draw + 200) r.draw(meshes.train, M4.trs(tx, 0, -446.2, 0, 0, 0));
  // NPC車両
  const lightsNpc = env.night > 0.35 || rainK > 0.5 ? 1 : 0;
  const mtx = new Float32Array(16);
  for (const c of traffic.cars) {
    const dx = c.x - cam.p[0], dz = c.z - cam.p[2];
    if (dx * dx + dz * dz > (S.draw + 50) ** 2 || !M4.sphereIn(planes, c.x, 1, c.z, 3.5)) continue;
    M4.trs(c.x, c.y || 0, c.z, c.yaw, (c.brake && c.v > 1 ? 0.012 : 0) - Math.atan(c.slope || 0), 0, mtx);
    if (c.tram) { r.draw(meshes.tram, mtx, null, [lightsNpc, 0, 0, 0]); continue; }
    r.draw((dx * dx + dz * dz < 3600 || c.m.id === 0 ? npcMesh : npcLod)[c.m.id], mtx, c.tint, traffic.carL(c, lightsNpc));
  }
  // プレイヤー車両
  const blink = (T % 0.8) < 0.4, pl = player, def = car.def, tint = MIRA_COLORS[color].rgb;
  const carL = [lightsOn ? 1 : 0, pl.braking ? 1 : 0, wink < 0 && blink ? 1 : 0, wink > 0 && blink ? 1 : 0];
  const showBody = state !== 'drive' || camMode !== 2 || true;
  if (showBody) r.draw(car.body, pM, tint, carL);
  const base = M4.trs(pl.x, pl.y, pl.z, pl.yaw, pl.slopeV || 0, 0);
  for (const [wx, wz, front] of def.wheelPos) {
    const lm = M4.trs(wx, def.p.r, wz, front ? pl.steer : 0, pl.wheelRot, 0);
    r.draw(wx < 0 ? car.wheelR : car.wheel, M4.mul(base, lm));
  }
  r.draw(car.interior, pM);
  const sp = def.steerPos;
  r.draw(car.steer, M4.mul(pM, M4.trs(sp[0], sp[1], sp[2], 0, 0.42, -pl.steer * 4)));
  const th = 0.75 * Math.PI + Math.min(140, pl.kmh) / 140 * 1.5 * Math.PI;
  const mp = def.meterPos;
  r.draw(car.needle, M4.mul(pM, M4.trs(mp[0], mp[1], mp[2], 0, 0, th - 1.5 * Math.PI)));
  // 半透明
  r.blend('alpha'); r.alpha(camMode === 1 && state === 'drive' ? 0.12 : 0.8); r.draw(car.glass, pM, null, null);
  if (rainK > 0.05) { r.alpha(0.35 * rainK); r.draw(meshes.rain, M4.trs(cam.p[0], cam.p[1] - 8 - ((T * 22) % 24) + 12, cam.p[2], 0)); }
  if (env.night > 0.05) { r.blend('add'); r.alpha(env.night * 0.5); for (const c of vis) r.draw(c.m.glow); }
  r.alpha(1); r.blend(null);
}

function renderSelect(dt, aspect) {
  selYaw += dt * 0.5;
  const pM = M4.trs(0, 0, 0, selYaw, 0, 0);
  const view = M4.lookAt([4.4, 1.8, 4.4], [0, aspect < 1 ? -0.9 : -0.2, 0], [0, 1, 0]), proj = M4.persp(aspect < 1 ? 1.0 : 0.7, aspect, 0.1, 200);
  const vp = M4.mul(proj, view);
  R.frame({ vp, fog: [0.08, 0.085, 0.1], sun: norm([0.4, 0.8, 0.5]), sunC: [1, 0.97, 0.92], amb: [0.42, 0.44, 0.5], cam: [4.4, 1.8, 4.4], fogN: 30, fogF: 120, night: 0, wet: 0, hOn: 0, hP: [0, 0, 0], hD: [0, 0, 1] });
  R.draw(meshes.studio);
  const def = car.def, tint = MIRA_COLORS[color].rgb;
  R.draw(car.body, pM, tint, [0.6, 0, 0, 0]);
  for (const [wx, wz] of def.wheelPos) R.draw(wx < 0 ? car.wheelR : car.wheel, M4.mul(pM, M4.trs(wx, def.p.r, wz, 0, 0, 0)));
  R.draw(car.interior, pM);
  R.blend('alpha'); R.alpha(0.6); R.draw(car.glass, pM); R.alpha(1); R.blend(null);
}

function hud(env, lightsOn, blink) {
  $('sV').textContent = Math.round(player.kmh);
  $('rpmI').style.width = (player.rpm / 7000 * 100).toFixed(1) + '%';
  $('gear').textContent = player.gear;
  $('iWL').classList.toggle('on', wink < 0 && blink); $('iWR').classList.toggle('on', wink > 0 && blink);
  $('iLight').classList.toggle('on', lightsOn);
  const h = Math.floor(gameMin / 60), m = Math.floor(gameMin % 60);
  const w = { clear: '晴れ', cloudy: '曇り', rain: '雨' }[weather];
  const dn = city.district(player.x, player.z);
  if (dn !== distName) { distName = dn; $('iDist').textContent = dn; }
  $('iTime').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}　${w}`;
  drawMinimap();
  if (S.dbg) {
    const loaded = city.chunks.filter(c => c.m).length;
    $('dbg').textContent = `FPS ${(tick.fps || 0).toFixed(0)}  draw ${R.stats.draws}  tri ${(R.stats.tris / 1000).toFixed(0)}k\nNPC ${traffic.cars.length}/${traffic.target}  chunk ${loaded}/${city.chunks.length}\npos ${player.x.toFixed(0)}, ${player.z.toFixed(0)}`;
  } else $('dbg').textContent = '';
}

boot();
