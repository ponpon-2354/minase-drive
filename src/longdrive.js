// 長距離ドライブモードの進行管理：時刻（現実45分＝ゲーム内24時間）・走行距離・疲労度と連続運転時間・休憩・到着・HUD・ナビ・交通・セーブ
// 第6章の疲労度：連続運転4時間で90%（休憩が必要）に達するよう、運転中は 90%/240分 の割合で上がり、それ以降も上がり続ける（操作は奪わない）
import { LongWorld, SEASONS, DIST_SCALE, TIME_SCALE, ROUTE_LEN, LANE_U, FAC_KM } from './ld_world.js?v=0.7.0';
import { MODELS, pickColor, plateClass, isCommercial } from './carmodels.js?v=0.7.0';
import { rng, clamp, lerp } from './math.js?v=0.7.0';
import { GB } from './geo.js?v=0.7.0';
import { saveLD, clearLD, addClear } from './save.js?v=0.7.0';
import { SEASON_NAMES, AGE_OPTS, OUTFIT_OPTS, SEAT_OPTS, driverChar } from './passengers.js?v=0.7.0';

export const FLOW = TIME_SCALE / 60; // ゲーム内の分 / 現実の秒（32分/60秒）
export const REST_MIN = 45, START_MIN = 9 * 60;
export const FATIGUE_STAGES = [[0, '通常', '#7fe08a'], [30, '軽い疲労', '#d8e070'], [50, '疲労', '#ffc04a'], [70, '強い疲労', '#ff8a3a'], [90, '休憩が必要', '#ff4b3a']];
export function fatigueStage(f) { let s = FATIGUE_STAGES[0]; for (const q of FATIGUE_STAGES) if (f >= q[0]) s = q; return s; }
export const hhmm = m => { m = Math.round(m); const h = Math.floor(m / 60), mm = m % 60; return `${String(h % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
export const dur = m => { m = Math.round(m); return `${Math.floor(m / 60)}時間${String(m % 60).padStart(2, '0')}分`; };

// ---- 長距離用の交通（本線の上下線を走る車。休憩施設の駐車車両は景観に焼き込み済み） ----
class LDTraffic {
  constructor(world) { this.w = world; this.cars = []; this.R = rng(5); this.stats = { parkedNow: 0 }; this.events = []; this.target = 14; this.zoneTarget = 14; this.moving = 0; this.base = 1; this.perfK = 1; this.wet = 0; this.drawDist = 400; this.zone = 'byp';
    this.pool = MODELS.filter(m => !m.semi && m.L < 12 && m.cat !== 'bike'); }
  carL(c, lN) { return [lN, c.brake ? 1 : 0, 0, 0]; }
  remove(c) { const i = this.cars.indexOf(c); if (i >= 0) this.cars.splice(i, 1); }
  spawn(ps, ahead) {
    const R = this.R, dir = R() < 0.5 ? 1 : -1, lane = R() < 0.6 ? 0 : 1, u = dir * LANE_U[lane];
    let s = ps + (ahead ? 1 : -1) * (350 + R() * 300); if (s < 20 || s > ROUTE_LEN - 60) return;
    if (this.cars.some(c => c.dir === dir && c.lane === lane && Math.abs(c.s - s) < 40)) return;
    const m = this.pool[(R() * this.pool.length) | 0], col = pickColor(m, R), big = isCommercial(m) && m.L > 6;
    const v = (lane === 0 ? 74 + R() * 12 : 92 + R() * 14) / 3.6 * (big ? 0.88 : 1);
    this.cars.push({ s, u, dir, lane, v, v0: v, m, tint: col.rgb, plate: { cls: plateClass(m), i: (R() * 64) | 0 }, x: 0, z: 0, y: 0, yaw: 0, slope: 0, brake: false });
  }
  update(dt, T, hour, player, opt) {
    const w = this.w, pp = w.project(player.x, player.z), ps = pp.s;
    this.cars = this.cars.filter(c => Math.abs(c.s - ps) < 800 && c.s > 5 && c.s < ROUTE_LEN - 40);
    const N = Math.round(this.target * (this.base || 1));
    let tries = 0; while (this.cars.length < N && tries++ < 4) this.spawn(ps, this.R() < 0.6);
    this.moving = 0;
    for (const c of this.cars) {
      // 前の車（同じ向き・同じ車線）と自車に追いつかないように
      let gap = 1e9, lead = null; for (const o of this.cars) if (o !== c && o.dir === c.dir && o.lane === c.lane) { const d = (o.s - c.s) * c.dir; if (d > 0 && d < gap) { gap = d; lead = o; } }
      const pd = (ps - c.s) * c.dir; if (pd > 0 && Math.abs(pp.u - c.u) < 2.2 && pd < gap) { gap = pd; lead = { v: Math.max(0, player.vx) * (c.dir > 0 ? 1 : -1) * c.dir }; }
      let vt = c.v0 * (opt && opt.speedK || 1);
      if (lead && gap < 60) vt = Math.min(vt, Math.max(0, lead.v) * (gap < 25 ? 0.8 : 1) + (gap - 25) * 0.15);
      // 走行車線で詰まったら追越車線へ（空いていれば）
      if (c.dir > 0 && lead && gap < 50 && c.lane === 0 && !this.cars.some(o => o !== c && o.dir > 0 && o.lane === 1 && Math.abs(o.s - c.s) < 35) && !(Math.abs(pp.u - LANE_U[1]) < 2 && Math.abs(ps - c.s) < 30)) { c.lane = 1; }
      if (c.dir > 0 && c.lane === 1 && (!lead || gap > 120) && this.R() < dt * 0.05 && !this.cars.some(o => o !== c && o.dir > 0 && o.lane === 0 && Math.abs(o.s - c.s) < 40)) c.lane = 0;
      const ut = c.dir * LANE_U[c.lane]; c.u += clamp(ut - c.u, -1.2 * dt, 1.2 * dt);
      c.brake = vt < c.v - 0.3; c.v += clamp(vt - c.v, -4 * dt, 1.5 * dt);
      c.s += c.dir * c.v * dt; if (c.v > 0.5) this.moving++;
      const at = w.at(c.s), p = w.pos(c.s, c.u); c.x = p[0]; c.y = p[1]; c.z = p[2]; c.yaw = at.h + (c.dir < 0 ? Math.PI : 0) + (ut - c.u) * -0.04 * c.dir;
      c.slope = (w.roadY(c.s + c.dir * 2) - w.roadY(c.s - c.dir * 2)) / 4;
    }
  }
}

export class LongDrive {
  // ctx：{ R, toast, $, snd, getMin, setMin, player, onMovie(kind, info, done) }
  constructor(ctx, cfg, sv = null) {
    this.ctx = ctx; this.cfg = cfg; this.season = cfg.season; this.D = SEASONS[cfg.season];
    this.world = new LongWorld(cfg.season); this.city = this.world.W;
    this.traffic = new LDTraffic(this.world);
    this.peds = { list: [], update() { } };
    this.st = sv && sv.st ? sv.st : { totalKm: 0, driveMin: 0, contMin: 0, fatigue: 0, rests: 0, restedIds: [], restLog: [], phase: 'drive', startAt: Date.now(), maxS: 0, notice: 0 };
    this.avgV = 80; this.hudT = 0; this.saveT = 0; this.lastPos = null; this.restLock = null;
    this.party = [{ ch: driverChar(cfg.driver, cfg.season), role: 'driver', name: 'あなた' }, ...cfg.passengers.map((p, i) => ({ ch: p.ch, seat: p.seat, role: 'p' + (i + 1), name: passengerLabel(p.ch) }))];
    this.nav = this.makeNav(); this.minimap();
  }
  get flow() { return FLOW; }
  startPose() { const p = this.world.pos(20, LANE_U[0]), at = this.world.at(20); return { x: p[0], z: p[2], yaw: at.h, y: p[1] }; }
  poseAtS(s, u = LANE_U[0]) { const p = this.world.pos(s, u), at = this.world.at(s); return { x: p[0], z: p[2], yaw: at.h, y: p[1] }; }
  progressS(player) { const p = this.world.project(player.x, player.z); return p.s; }
  // 毎フレーム（運転中）
  update(dt, player, gSpd) {
    const st = this.st, w = this.world, min = dt * FLOW;
    // 走行距離（表示km）：実際に移動した距離×32
    if (this.lastPos) { const d = Math.hypot(player.x - this.lastPos[0], player.z - this.lastPos[1]); if (d < 30) st.totalKm += d * DIST_SCALE / 1000; }
    this.lastPos = [player.x, player.z];
    st.driveMin += min; st.contMin += min;
    st.fatigue = clamp(st.fatigue + min * (st.fatigue < 90 ? 90 / 240 : 10 / 60), 0, 100);
    const p = w.project(player.x, player.z); st.maxS = Math.max(st.maxS, p.s); this.s = p.s; this.u = p.u;
    this.avgV += (clamp(gSpd * 3.6, 30, 130) - this.avgV) * (1 - Math.exp(-dt / 25));
    // 4時間の前後で休憩を強く勧める（案内だけ。操作は奪わない）
    const next = this.nextFac();
    if (st.contMin >= 210 && st.notice < 1) { st.notice = 1; this.ctx.toast(`連続運転がまもなく4時間です。${next ? next.name + ' で休憩しましょう' : '休憩しましょう'}`, 4000); this.ctx.snd && this.ctx.snd.stationBell(); }
    if (st.contMin >= 240 && st.notice < 2) { st.notice = 2; this.ctx.toast(`4時間連続で運転しました。休憩が必要です${next ? '（' + next.name + ' まで ' + this.kmTo(next.s).toFixed(0) + 'km）' : ''}`, 5000); this.ctx.snd && this.ctx.snd.stationBell(); }
    // 休憩施設の入口 → 休憩ムービー
    const f = w.facAt(p.s, p.u);
    if (f && p.u * f.side > 9.6 && p.s - f.s > -6 && p.s - f.s < 40) { if (this.restLock !== f.id) { this.restLock = f.id; this.startRest(f); return; } }
    else if (!f) this.restLock = null;
    // 目的地の駐車場 → エンディング
    if (p.s > ROUTE_LEN + 4 && Math.abs(p.u) < 45) { this.startEnding(); return; }
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.2; this.hud(player, gSpd); }
    this.saveT -= dt; if (this.saveT <= 0) { this.saveT = 10; this.save(player); }
  }
  kmTo(s) { return Math.max(0, (s - (this.s || 0))) * DIST_SCALE / 1000; }
  nextFac() { const s = this.s || 0; return this.world.fac.find(f => f.s > s - 20); }
  remainKm() { return Math.max(0, ROUTE_LEN - (this.s || 0)) * DIST_SCALE / 1000; }
  etaMin() { return this.ctx.getMin() + this.remainKm() / Math.max(30, this.avgV) * 60; }
  hud(player, gSpd) {
    const $ = this.ctx.$, st = this.st, fs = fatigueStage(st.fatigue), next = this.nextFac(), el = $('ldhud'); if (!el) return;
    $('ldTime').textContent = hhmm(this.ctx.getMin());
    $('ldWhere').textContent = this.world.sectionName(this.s || 0);
    $('ldDest').textContent = this.D.dest;
    $('ldRemain').textContent = `${this.remainKm().toFixed(0)}km`;
    $('ldEta').textContent = hhmm(this.etaMin());
    $('ldCont').textContent = dur(st.contMin);
    $('ldFatBar').style.width = st.fatigue.toFixed(0) + '%'; $('ldFatBar').style.background = fs[2];
    $('ldFat').textContent = `${st.fatigue.toFixed(0)}% ${fs[1]}`;
    $('ldNext').textContent = next ? `${next.name} ${this.kmTo(next.s).toFixed(0)}km` : '目的地まで休憩施設なし';
    el.classList.toggle('warn', st.fatigue >= 70 || st.contMin >= 240);
    el.classList.toggle('alert', st.fatigue >= 90);
  }
  // ---- 休憩 ----
  startRest(f) {
    this.st.restEnterS = this.s || f.s; // 施設内（入口→出口）を走ったぶんの距離を、休憩後に総走行距離へ足す
    const st = this.st; st.phase = 'rest'; st.restFac = f.id; this.saveNow();
    const from = this.ctx.getMin();
    this.ctx.onMovie('rest', { fac: f, party: this.party, season: this.season, from, to: from + REST_MIN }, () => this.finishRest(f));
  }
  finishRest(f) {
    const st = this.st, from = this.ctx.getMin();
    this.ctx.setMin(from + REST_MIN);
    st.contMin = 0; st.fatigue = Math.max(0, st.fatigue - 75); st.rests++; st.restedIds.push(f.id); st.restLog.push({ id: f.id, name: f.name, at: hhmm(from), to: hhmm(from + REST_MIN) }); st.notice = 0; st.phase = 'drive'; st.restFac = null;
    st.totalKm += Math.max(0, f.s + 250 - (st.restEnterS ?? f.s)) * DIST_SCALE / 1000; st.restEnterS = null;
    this.restLock = f.id;
    // 出口付近（加速車線の手前）に置いて本線へ
    const pl = this.ctx.player, ex = this.world.pos(f.s + 250, 11.7), at = this.world.at(f.s + 250);
    pl.reset(ex[0], ex[2], at.h, f.y + 1); pl.parked = false; this.lastPos = null;
    this.ctx.toast(`${f.name}で45分休憩しました（${hhmm(from)}〜${hhmm(from + REST_MIN)}）。連続運転時間をリセット`, 4200);
    this.saveNow();
  }
  // ---- 到着 ----
  startEnding() {
    const st = this.st; st.phase = 'ending'; st.arriveMin = this.ctx.getMin(); this.saveNow();
    this.ctx.onMovie('ending', { party: this.party, season: this.season, dest: this.D.dest }, () => this.finishEnding());
  }
  finishEnding() {
    const st = this.st; st.phase = 'clear';
    const rec = { season: this.season, seasonName: SEASON_NAMES[this.season], dest: this.D.dest, km: st.totalKm, driveMin: st.driveMin, totalMin: (st.arriveMin || this.ctx.getMin()) - START_MIN, rests: st.rests, people: this.party.length, restLog: st.restLog, at: Date.now() };
    addClear(rec); clearLD(); this.clearRec = rec;
    this.ctx.onClear(rec);
  }
  rescue(player) { const p = this.world.project(player.x, player.z), s = clamp(p.s, 10, ROUTE_LEN - 10), q = this.poseAtS(s); player.reset(q.x, q.z, q.yaw, q.y + 1); }
  // ---- セーブ（市街地のセーブとは別のキー） ----
  saveData(player) { return { v: 1, mode: 'longdrive', cfg: this.cfg, st: this.st, pos: player ? { x: player.x, z: player.z, yaw: player.yaw, y: player.y } : null, min: this.ctx.getMin(), at: Date.now() }; }
  save(player) { return saveLD(this.saveData(player || this.ctx.player)); }
  saveNow() { return this.save(this.ctx.player); }
  // ---- ナビ（地図ボタン：路線全体と施設、目的地まで案内） ----
  makeNav() {
    const self = this;
    return {
      update() { }, clear() { }, close() { },
      drawMini(c, X, Z, k) { const d = self.world.dest; if (d) { c.fillStyle = '#ff4b3a'; c.beginPath(); c.arc(X(d.x), Z(d.z), 6 / k, 0, 7); c.fill(); } for (const f of self.world.fac) { const p = self.world.pos(f.s + 100, 60); c.fillStyle = f.type === 'MICHI' ? '#5fd35f' : '#4aa3ff'; c.fillRect(X(p[0]) - 4 / k, Z(p[2]) - 4 / k, 8 / k, 8 / k); } },
      open(MM) { const cv = self.ctx.$('mapC'); if (!cv) return; const r = cv.getBoundingClientRect(), dpr = devicePixelRatio; cv.width = r.width * dpr; cv.height = r.height * dpr; const c = cv.getContext('2d'), b = self.world.bb, sc = Math.min(cv.width / (b.x1 - b.x0), cv.height / (b.z1 - b.z0)) * 0.95, ox = (cv.width - (b.x1 - b.x0) * sc) / 2, oz = (cv.height - (b.z1 - b.z0) * sc) / 2, X = x => ox + (x - b.x0) * sc, Z = z => oz + (z - b.z0) * sc;
        c.fillStyle = '#1a2418'; c.fillRect(0, 0, cv.width, cv.height); c.strokeStyle = '#e8d8a8'; c.lineWidth = 4 * dpr; c.beginPath(); for (let s = 0; s <= ROUTE_LEN; s += 50) { const p = self.world.pos(s, 0); s ? c.lineTo(X(p[0]), Z(p[2])) : c.moveTo(X(p[0]), Z(p[2])); } c.stroke();
        c.font = `800 ${15 * dpr}px sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
        const lab = (x, z, t, col) => { c.fillStyle = col; c.beginPath(); c.arc(X(x), Z(z), 6 * dpr, 0, 7); c.fill(); c.lineWidth = 4 * dpr; c.strokeStyle = 'rgba(0,0,0,.7)'; c.strokeText(t, X(x) + 10 * dpr, Z(z)); c.fillStyle = '#fff'; c.fillText(t, X(x) + 10 * dpr, Z(z)); };
        const s0 = self.world.pos(0, 0); lab(s0[0], s0[2], '水瀬東IC（出発）', '#ffb63a');
        for (const f of self.world.fac) { const p = self.world.pos(f.s, 0); lab(p[0], p[2], `${f.name}（${f.km}km）`, f.type === 'MICHI' ? '#5fd35f' : '#4aa3ff'); }
        const d = self.world.dest; lab(d.x, d.z, `${self.D.dest}（400km）`, '#ff4b3a');
        const pl = self.ctx.player; c.fillStyle = '#ffb63a'; c.beginPath(); c.arc(X(pl.x), Z(pl.z), 9 * dpr, 0, 7); c.fill();
        c.fillStyle = '#fff'; c.font = `700 ${13 * dpr}px sans-serif`; c.fillText(`目的地まで ${self.remainKm().toFixed(0)}km ／ 到着予想 ${hhmm(self.etaMin())}`, 12 * dpr, cv.height - 20 * dpr); }
    };
  }
  // ミニマップの下地（路線・施設）
  minimap() {
    const b = this.world.bb, S = 0.12, cv = document.createElement('canvas'); cv.width = Math.ceil((b.x1 - b.x0) * S); cv.height = Math.ceil((b.z1 - b.z0) * S);
    const c = cv.getContext('2d'), X = x => (x - b.x0) * S, Z = z => (z - b.z0) * S;
    c.fillStyle = this.season === 'winter' ? '#6f7680' : this.season === 'autumn' ? '#4a3a25' : '#2c3b27'; c.fillRect(0, 0, cv.width, cv.height);
    if (this.season === 'summer') { c.fillStyle = '#2d5a86'; for (let s = 1200; s < 7000; s += 60) { const z = this.world.zoneW(s, -1); if ((z.sea || 0) + (z.bay || 0) + (z.harbor || 0) < 0.3) continue; const p = this.world.pos(s, -300); c.beginPath(); c.arc(X(p[0]), Z(p[2]), 300 * S, 0, 7); c.fill(); } }
    c.strokeStyle = '#c9c4b5'; c.lineWidth = 21 * S + 2; c.lineCap = 'round'; c.beginPath(); for (let s = -150; s <= ROUTE_LEN + 60; s += 20) { const p = this.world.pos(s, 0); s > -150 ? c.lineTo(X(p[0]), Z(p[2])) : c.moveTo(X(p[0]), Z(p[2])); } c.stroke();
    c.fillStyle = '#9a9690'; for (const f of this.world.fac) { for (let lz = 0; lz < 220; lz += 10) { const p = this.world.pos(f.s + lz, 60); c.fillRect(X(p[0]) - 50 * S, Z(p[2]) - 50 * S, 100 * S, 100 * S); } }
    this.mm = { canvas: cv, x0: b.x0, z0: b.z0, s: S, labels: [...this.world.fac.map(f => { const p = this.world.pos(f.s + 100, 70); return [f.name, p[0], p[2]]; }), [this.D.dest, this.world.dest.x, this.world.dest.z], ['水瀬東IC', this.world.pos(0, 0)[0], this.world.pos(0, 0)[2]]] };
  }
  // ---- 季節の演出（雪・花びら・湯けむり）：main の描画の最後に呼ぶ ----
  extraDraw(r, cam, T, M4, meshes) {
    const se = this.season;
    if (!this.fx) { this.fx = []; const R = rng(3); for (let i = 0; i < 160; i++) this.fx.push([R() * 60 - 30, R() * 24, R() * 60 - 30, R()]);
      const g = new GB(), col = se === 'winter' ? [1, 1, 1] : [1, 0.72, 0.84]; g.quadN([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 1], { c: col, mat: 5 }); g.quadN([-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0], [0, 0, -1], { c: col, mat: 5 }); this.fxMesh = r.mesh(g.build()); }
    r.blend('alpha'); r.gl.depthMask(false);
    if (se === 'winter' || se === 'spring') { // 雪・桜の花びら（カメラの周りを回して使う）
      const fall = se === 'winter' ? 2.2 : 1.1, near = this.world.zoneW(this.s || 0, 1);
      const amt = se === 'winter' ? 1 : Math.min(1, (near.sakura || 0) + (near.sakuraT || 0) + (near.town || 0) + (near.river || 0) * 0.5);
      if (amt > 0.05) { r.alpha(0.85 * amt);
        for (const [x0, y0, z0, ph] of this.fx) { const y = ((y0 - T * fall * (0.7 + ph * 0.6)) % 24 + 24) % 24, x = cam.p[0] + ((x0 + Math.sin(T * 0.7 + ph * 9) * 1.5 + 30 - cam.p[0] % 60 + 120) % 60) - 30, z = cam.p[2] + ((z0 + 30 - cam.p[2] % 60 + 120) % 60) - 30; const m = M4.trs(x, cam.p[1] - 8 + y, z, T * (1 + ph) + ph * 6, ph * 3, 0); const s = se === 'winter' ? 0.06 : 0.07; for (const k of [0, 1, 2]) { m[k] *= s; m[4 + k] *= s; m[8 + k] *= s; } r.draw(this.fxMesh, m); } }
    }
    for (const q of this.world.steam || []) { if (!q) continue; const dx = q[0] - cam.p[0], dz = q[2] - cam.p[2]; if (dx * dx + dz * dz > 250 * 250) continue;
      for (let k = 0; k < 5; k++) { const ph = (T * 0.15 + k / 5) % 1, s = 1.5 + ph * 5; r.alpha(0.45 * (1 - ph)); const m = M4.trs(q[0] + ph * 2, q[1] + ph * 9, q[2], Math.atan2(cam.p[0] - q[0], cam.p[2] - q[2]), 0, 0); for (const i of [0, 1, 2]) { m[i] *= s; m[4 + i] *= s; m[8 + i] *= s; } r.draw(meshes.puff, m); } }
    r.gl.depthMask(true); r.alpha(1); r.blend(null);
  }
}
export function passengerLabel(ch) { const a = (AGE_OPTS.find(q => q[0] === ch.age) || [0, ''])[1].replace('（約9歳）', ''); return ch.age === 'child' ? (ch.sex ? '女の子' : '男の子') : `${a}${ch.sex ? '女性' : '男性'}`; }
export function outfitName(id) { return (OUTFIT_OPTS.find(o => o[0] === id) || [0, id])[1]; }
export function seatName(id) { return (SEAT_OPTS.find(o => o[0] === id) || [0, id])[1]; }
export { FAC_KM, SEASONS, ROUTE_LEN, DIST_SCALE };
