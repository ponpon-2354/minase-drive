// NPC交通AI：道路ネットワーク（直線・曲線・高低差）追従、IDM車間制御、信号/一時停止、右折待ち、車線変更、
// 駐車場の入出庫、路面電車（電停・折り返し）、駅前ロータリーの周回車両
import { clamp, angDiff, bez, M4 } from './math.js';
import { pickModel, pickColor } from './carmodels.js';

const STYLES = [
  { name: '慎重', f: 0.86, T: 1.8, ak: 0.8, bk: 0.85 },
  { name: '標準', f: 1.0, T: 1.4, ak: 1.0, bk: 1.0 },
  { name: 'やや速い', f: 1.1, T: 1.05, ak: 1.2, bk: 1.15 }
];
export const TRAM_M = { id: -1, name: '路面電車', cat: 'tram', L: 18.4, W: 2.4, acc: 0.9, vmax: 11, colors: [] };

export class Traffic {
  constructor(city, R) {
    this.city = city; this.R = R; this.cars = []; this.byEdge = new Map(); this.base = 30; this.perfK = 1; this.nextId = 1;
    this.stats = { spawned: 0, parkedNow: 0 };
    this.initSpecial();
  }
  timeFactor(h) {
    if (h < 5) return 0.3; if (h < 7) return 0.6; if (h < 9) return 1.0; if (h < 16) return 0.75; if (h < 19) return 1.0; if (h < 22) return 0.6; return 0.4;
  }
  // ---- 路面電車・ロータリー（常駐） ----
  initSpecial() {
    const city = this.city, tr = city.tramRoute;
    if (tr) for (const [route, idx] of [['east', 1], ['west', 3]]) {
      const e = tr[route][idx];
      const c = this.mk(TRAM_M, { rgb: [1, 1, 1] }, e, 0, e.len * 0.3, STYLES[1]);
      c.tram = true; c.persist = true; c.route = route; c.ri = idx; c.served = null; this.plan(c);
      this.cars.push(c);
    }
    for (const lp of city.loops) lp.cars.forEach((d, i) => {
      const n = lp.pts.length, k = Math.floor(i * n / lp.cars.length), p = lp.pts[k];
      const c = { id: this.nextId++, m: d.m, tint: d.rgb, x: p[0], z: p[1], y: 0, yaw: 0, v: 0, st: 'loop', loop: lp, li: (k + 1) % n, persist: true, stuck: 0, ghost: 0, hitT: 0, wink: 0, brake: false, dwell: 0, drv: { f: 1, T: 1.4, a: 1.5, b: 3 } };
      this.cars.push(c);
    });
  }
  mk(m, col, e, k, s, st) {
    const city = this.city, p = city.lanePos(e, k, s);
    const c = {
      id: this.nextId++, m, col, tint: col.rgb, x: p[0], z: p[1], y: city.yAt(e, s), yaw: city.headAt(e, s), v: 0, st: 'lane', e: e.id, k, s, lat: 0,
      drv: { f: st.f * (0.95 + this.R() * 0.1), T: st.T, a: m.acc * st.ak, b: 3.0 * st.bk, style: st.name }, stuck: 0, ghost: 0, hitT: 0, wink: 0, brake: false
    };
    return c;
  }
  // ---- 経路 ----
  plan(c) {
    const city = this.city, e = city.edges[c.e], node = city.nodes[e.to];
    c.conn = null; c.committed = false; c.stopDone = false; c.stopT = 0; c.parkPlan = null;
    if (c.tram) {
      const list = city.tramRoute[c.route];
      c.ri = list.indexOf(e);
      const nx = list[c.ri + 1];
      c.next = nx ? { e: nx.id, k: 0, turn: 0 } : null;
      return;
    }
    let opts = node.out.map(i => city.edges[i]).filter(o => o.id !== e.rev);
    if (!opts.length) opts = e.rev != null ? [city.edges[e.rev]] : city.nodes[e.to].out.map(i => city.edges[i]);
    const turnOf = o => { const cr = e.dEnd[0] * o.d[1] - e.dEnd[1] * o.d[0]; return Math.abs(cr) < 0.3 ? 0 : cr > 0 ? 1 : -1; };
    const w = opts.map(o => (turnOf(o) === 0 ? 0.5 : 0.25) * (0.35 + o.dens));
    let t = w.reduce((a, b) => a + b, 0), x = this.R() * t, pick = opts[0];
    for (let i = 0; i < opts.length; i++) { x -= w[i]; if (x <= 0) { pick = opts[i]; break; } }
    const turn = turnOf(pick);
    const k2 = turn > 0 ? 0 : turn < 0 ? pick.lanes - 1 : Math.min(c.k, pick.lanes - 1);
    c.next = { e: pick.id, k: k2, turn };
    if (e.lots.length && c.m.cat !== 'trk' && this.R() < 0.22 && c.s < 10) {
      const lot = e.lots[this.R() * e.lots.length | 0];
      const free = lot.slots.filter(s => !s.occ);
      if (free.length && lot.sE - c.s > 25) { const sl = free[this.R() * free.length | 0]; sl.occ = c; c.parkPlan = { lot, slot: sl }; }
    }
  }
  getConn(c) {
    if (c.conn && c.conn.k === c.k) return c.conn;
    if (!c.next) return null;
    const city = this.city, e = city.edges[c.e], e2 = city.edges[c.next.e];
    const p0 = city.lanePos(e, c.k, e.len), p2 = city.lanePos(e2, c.next.k, 0), d1 = e.dEnd, d2 = e2.d;
    let p1;
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 0.2) p1 = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
    else { const t = ((p2[0] - p0[0]) * d2[1] - (p2[1] - p0[1]) * d2[0]) / den; p1 = [p0[0] + d1[0] * t, p0[1] + d1[1] * t]; }
    const tab = [0]; let prev = p0, len = 0;
    for (let i = 1; i <= 12; i++) { const q = bez(p0, p1, p2, i / 12); len += Math.hypot(q[0] - prev[0], q[1] - prev[1]); tab.push(len); prev = q; }
    c.conn = { p0, p1, p2, len, tab, k: c.k, wait: len * 0.3, y: city.yAt(e, e.len) };
    if (c.next.turn > 0) {
      const n = city.nodes[e.to], lx = d1[1], lz = -d1[0];
      for (let d = 0; d < len; d += 0.5) {
        const q = this.connAt(c.conn, d);
        if ((q[0] - n.x) * lx + (q[1] - n.z) * lz < 1.05) { c.conn.wait = Math.max(0, d - c.m.L * 0.42); break; }
      }
    }
    return c.conn;
  }
  connAt(cn, d) {
    d = clamp(d, 0, cn.len);
    let i = 1; while (i < 12 && cn.tab[i] < d) i++;
    const t = (i - 1 + (d - cn.tab[i - 1]) / Math.max(1e-6, cn.tab[i] - cn.tab[i - 1])) / 12;
    const p = bez(cn.p0, cn.p1, cn.p2, t), q = bez(cn.p0, cn.p1, cn.p2, Math.min(1, t + 0.02)), r = bez(cn.p0, cn.p1, cn.p2, Math.max(0, t - 0.02));
    return [p[0], p[1], Math.atan2(q[0] - r[0], q[1] - r[1])];
  }
  pathPoint(c, d) {
    const city = this.city;
    if (c.st === 'lane') {
      const e = city.edges[c.e], s = c.s + d;
      if (s <= e.len || !c.next) return city.lanePos(e, c.k, Math.min(s, e.len), c.lat);
      const cn = this.getConn(c), r = s - e.len;
      if (r <= cn.len) return this.connAt(cn, r);
      return city.lanePos(city.edges[c.next.e], c.next.k, r - cn.len);
    }
    if (c.st === 'inter') {
      const cn = c.conn, r = c.d + d;
      if (r <= cn.len) return this.connAt(cn, r);
      const e2 = city.edges[c.next.e];
      return city.lanePos(e2, c.next.k, Math.min(r - cn.len, e2.len));
    }
    return [c.x + Math.sin(c.yaw) * d, c.z + Math.cos(c.yaw) * d];
  }
  // ---- 生成・削除 ----
  spawn(px, pz, planes) {
    const city = this.city, R = this.R;
    for (let tries = 0; tries < 30; tries++) {
      const e = city.edges[R() * city.edges.length | 0];
      if (R() > e.dens) continue;
      const s = 8 + R() * Math.max(1, e.len - 30), k = R() * e.lanes | 0;
      const p = city.lanePos(e, k, s), y = city.yAt(e, s);
      const d = Math.hypot(p[0] - px, p[1] - pz);
      if (d < 45 || d > 235) continue;
      if (d < 150 && M4.sphereIn(planes, p[0], y + 1, p[1], 3)) continue;
      if (this.cars.some(o => (o.x - p[0]) ** 2 + (o.z - p[1]) ** 2 < (o.tram ? 400 : 144))) continue;
      const m = pickModel(R), col = pickColor(m, R), st = STYLES[R() * 3 | 0];
      const c = this.mk(m, col, e, k, s, st);
      c.v = Math.min(e.lim / 3.6 * c.drv.f, m.vmax, city.vcAt(e, s)) * 0.7;
      this.plan(c);
      this.cars.push(c); this.stats.spawned++;
      return c;
    }
    return null;
  }
  remove(c) {
    if (c.parkPlan && c.parkPlan.slot.occ === c) c.parkPlan.slot.occ = null;
    if (c.parkPlan && c.parkPlan.lot.gate === c) c.parkPlan.lot.gate = null;
    const i = this.cars.indexOf(c); if (i >= 0) this.cars.splice(i, 1);
  }
  // ---- 更新 ----
  update(dt, T, hour, player, env, planes) {
    const city = this.city, px = player.x, pz = player.z;
    // 周辺の道路量（車線長×交通密度）で目標台数を決める：中心部・幹線は多く、郊外は少なく、山間部はごく少なく
    if (!this.areaT || Math.abs(T - this.areaT) > 1) {
      this.areaT = T; let D = 0;
      for (const e of city.edges) {
        if (!e.samp) { e.samp = []; for (let s = 0; s <= e.len; s += 40) e.samp.push(city.lanePos(e, 0, s)); }
        let k = 0; for (const p of e.samp) if ((p[0] - px) ** 2 + (p[1] - pz) ** 2 < 220 * 220) k++;
        D += k * 40 * e.dens * (0.6 + 0.4 * e.lanes);
      }
      this.area = clamp(D / 2400, 0.04, 1.0);
    }
    this.target = Math.round(this.base * this.timeFactor(hour) * this.area * this.perfK);
    const moving = this.cars.filter(c => c.st !== 'park' && !c.persist).length;
    if (moving < this.target) this.spawn(px, pz, planes);
    for (const c of [...this.cars]) {
      if (c.persist) continue;
      const d2 = (c.x - px) ** 2 + (c.z - pz) ** 2;
      const vis = M4.sphereIn(planes, c.x, c.y + 1, c.z, 3);
      if (d2 > 285 * 285 || (moving > this.target + 6 && d2 > 160 * 160 && !vis) || (c.stuck > 40 && !vis)) this.remove(c);
    }
    this.byEdge.clear();
    const add = (id, o) => { let a = this.byEdge.get(id); if (!a) this.byEdge.set(id, a = []); a.push(o); };
    for (const c of this.cars) {
      if (c.st === 'lane') add(c.e, c);
      else if ((c.st === 'wp' || c.st === 'join') && c.parkPlan && (c.st === 'join' || (!c.exiting && c.wi < 2))) {
        const e = c.parkPlan.lot.edge, s = (c.x - e.x0) * e.d[0] + (c.z - e.z0) * e.d[1];
        add(e.id, { s, k: e.lanes - 1, v: 0, m: c.m, proxy: c });
      }
    }
    const ob = this.cars.map(c => ({ c, x: c.x, z: c.z, y: c.y, fx: Math.sin(c.yaw), fz: Math.cos(c.yaw), hl: c.m.L / 2 - c.m.W / 2, r: c.m.W / 2, v: c.v }));
    ob.push({ c: player, x: px, z: pz, y: player.y, fx: Math.sin(player.yaw), fz: Math.cos(player.yaw), hl: 1.0, r: 0.74, v: Math.abs(player.vx), player: true });
    this.ob = ob;
    this.blink = (T % 0.8) < 0.4;
    let parked = 0;
    for (const c of this.cars) {
      const near = (c.x - px) ** 2 + (c.z - pz) ** 2 < 140 * 140;
      if (c.st === 'park') { parked++; this.updPark(c, dt); continue; }
      if (c.st === 'wp') { this.updWp(c, dt); continue; }
      if (c.st === 'join') { this.updJoin(c, dt, player); continue; }
      if (c.st === 'loop') { this.updLoop(c, dt); continue; }
      if (c.st === 'dwell') { this.updDwell(c, dt); continue; }
      this.updDrive(c, dt, T, near || c.tram, env, player);
    }
    this.stats.parkedNow = parked;
  }
  idm(c, v, v0, gap, dv, s0) {
    const a = c.drv.a, b = c.drv.b;
    const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
    if (gap === Infinity) return a * free;
    const ss = s0 + Math.max(0, v * c.drv.T + v * dv / (2 * Math.sqrt(a * b)));
    return a * (free - (ss / Math.max(gap, 0.05)) ** 2);
  }
  sense(c, look) {
    let best = Infinity, vl = 0;
    const W2 = c.m.W / 2, step = 1.5, d0 = c.m.L / 2 + 0.4;
    const cand = [];
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    for (const o of this.ob) {
      if (o.c === c || Math.abs(o.y - c.y) > 3) continue;
      const dx = o.x - c.x, dz = o.z - c.z, dd = dx * dx + dz * dz;
      if (dd > (look + o.hl + 8) ** 2) continue;
      if (dx * fx + dz * fz < -1 - o.hl) continue;
      cand.push(o);
    }
    if (!cand.length) return { gap: Infinity, vl: 0 };
    for (let d = d0; d < look; d += step) {
      const p = this.pathPoint(c, d);
      for (const o of cand) {
        const ax = o.x - o.fx * o.hl, az = o.z - o.fz * o.hl, bx = o.x + o.fx * o.hl, bz = o.z + o.fz * o.hl;
        const vx = bx - ax, vz = bz - az, t = clamp(((p[0] - ax) * vx + (p[1] - az) * vz) / Math.max(1e-6, vx * vx + vz * vz), 0, 1);
        const qx = ax + vx * t - p[0], qz = az + vz * t - p[1];
        if (qx * qx + qz * qz < (o.r + W2 * 0.75) ** 2) {
          const g = d - c.m.L / 2 - 0.2;
          if (g < best) { best = g; vl = o.v * (o.fx * fx + o.fz * fz); }
        }
      }
      if (best < Infinity) break;
    }
    return { gap: Math.max(0, best), vl };
  }
  laneFree(e, k, s, self) {
    const a = this.byEdge.get(e.id); if (!a) return true;
    for (const o of a) {
      if (o === self || o.proxy === self || o.k !== k) continue;
      const half = o.tram ? 10 : 0, vs = self.v, vo = o.v || 0;
      if (o.s <= s && s - o.s < 9 + half + Math.max(0, vo - vs) * 2.5) return false;
      if (o.s > s && o.s - s < 11 + half + Math.max(0, vs - vo) * 2) return false;
    }
    return true;
  }
  crossClear(node, axis, self) {
    for (const o of this.ob) {
      if (o.c === self) continue;
      const dx = o.x - node.x, dz = o.z - node.z;
      if (Math.abs(dx) < node.hx + 0.5 && Math.abs(dz) < node.hz + 0.5 && Math.abs(o.y - self.y) < 3) return false;
      const d = Math.hypot(dx, dz); if (d > 32 || o.v < 1) continue;
      const along = axis === 'ns' ? Math.abs(o.fx) > 0.7 : Math.abs(o.fz) > 0.7;
      if (along && (dx * o.fx + dz * o.fz) < 0) return false;
    }
    return true;
  }
  oncoming(c, node, e) {
    const d = e.dEnd;
    for (const o of this.ob) {
      if (o.c === c) continue;
      const dx = o.x - node.x, dz = o.z - node.z;
      const ahead = dx * d[0] + dz * d[1];
      if (ahead < 0 || ahead > 42) continue;
      if (Math.abs(dx * d[1] - dz * d[0]) > 8) continue;
      if (o.fx * d[0] + o.fz * d[1] > -0.7 || o.v < 1.2) continue;
      if (!o.player && o.c.st === 'inter' && o.c.next && o.c.next.turn > 0) continue;
      return true;
    }
    return false;
  }
  updDrive(c, dt, T, near, env, player) {
    const city = this.city, m = c.m;
    let e = city.edges[c.e];
    let v0 = Math.min(e.lim / 3.6 * c.drv.f, m.vmax) * env.speedK;
    let acc = Infinity, waiting = false;
    const apply = (gap, dv, s0) => { const a = this.idm(c, c.v, v0, gap, dv, s0); if (a < acc) acc = a; };
    if (c.st === 'lane') {
      // カーブ手前の減速
      if (e.vc) for (const ah of [0, 10, 22, 36, 52]) { const vc = city.vcAt(e, c.s + ah); v0 = Math.min(v0, Math.sqrt(vc * vc + 2 * 2.2 * ah)); }
      const want = c.tram ? 0 : c.parkPlan ? e.lanes - 1 : c.next.turn > 0 ? 0 : c.next.turn < 0 ? e.lanes - 1 : c.k;
      if (want !== c.k && c.s < e.len - 10 && Math.abs(c.lat) < 0.2 && this.laneFree(e, want, c.s, c)) { c.lat = (c.k - want) * e.lw; c.k = want; c.conn = null; }
      c.lat -= Math.sign(c.lat) * Math.min(Math.abs(c.lat), 1.1 * dt);
      const toEnd = e.len - c.s - m.L / 2;
      if (c.next && c.next.turn !== 0) v0 = Math.min(v0, Math.sqrt(4.6 ** 2 + 2 * 1.6 * Math.max(0, toEnd)));
      // 路面電車：電停と終点
      if (c.tram) {
        for (const st of city.tramStops) if (st.e === e.id && st.s > c.s - 0.5 && c.served !== st) {
          const g = st.s - c.s; apply(Math.max(0, g), c.v, 0.1); waiting = true;
          if (g < 0.6 && c.v < 0.2) { c.served = st; c.st = 'dwell'; c.dwell = 14 + this.R() * 8; c.v = 0; return; }
        }
        if (!c.next) {
          const g = e.len - 14 - c.s; apply(Math.max(0, g), c.v, 0.1); waiting = true;
          if (g < 0.6 && c.v < 0.2) { c.st = 'dwell'; c.dwell = 20; c.terminal = true; c.v = 0; return; }
        }
      }
      if (c.parkPlan) {
        const pp = c.parkPlan, toLot = pp.lot.sE - 7 - c.s;
        v0 = Math.min(v0, Math.sqrt(3 ** 2 + 2 * 1.4 * Math.max(0, toLot)));
        if (toLot < 1) {
          if (c.k === e.lanes - 1 && c.v < 5) { this.enterLot(c); return; }
          pp.slot.occ = null; c.parkPlan = null;
        }
      }
      if (e.ctrl === 'signal' && !c.committed) {
        const sg = city.sig(city.nodes[e.to], e.axis, T);
        if (sg === 'g') { if (toEnd < 2) c.committed = true; }
        else {
          const stopD = c.v * c.v / (2 * 3.6);
          if (sg === 'y' && stopD > toEnd - 0.5 && toEnd < 25) c.committed = true;
          else { apply(Math.max(0, toEnd - 0.6), c.v, 0.4); waiting = true; }
        }
      } else if (e.ctrl === 'stop' && !c.stopDone) {
        apply(Math.max(0, toEnd - 0.4), c.v, 0.3); waiting = true;
        if (toEnd < 2.0 && c.v < 0.4) { c.stopT += dt; if (c.stopT > 1.0 && this.crossClear(city.nodes[e.to], e.axis, c)) c.stopDone = true; }
      }
      if (near && c.ghost <= 0) { const sn = this.sense(c, Math.min(42, 8 + c.v * 2.6)); if (sn.gap < Infinity) apply(sn.gap, c.v - sn.vl, 2.0); }
      else {
        const a = this.byEdge.get(c.e); let best = null;
        if (a) for (const o of a) if (o !== c && o.k === c.k && o.s > c.s && (!best || o.s < best.s)) best = o;
        if (best) apply(best.s - c.s - (best.m.L + m.L) / 2, c.v - best.v, 2.0);
      }
    } else {
      const cn = c.conn;
      if (c.next.turn !== 0) v0 = Math.min(v0, c.next.turn > 0 ? 5.2 : 4.4);
      if (c.next.turn > 0 && !c.goRight) {
        if (this.oncoming(c, city.nodes[e.to], e)) { if (c.d < cn.wait + 0.5) { apply(Math.max(0, cn.wait - c.d), c.v, 0.2); waiting = true; } }
        else if (c.d > cn.wait - 1.5) c.goRight = true;
      }
      if (c.ghost <= 0) { const sn = this.sense(c, Math.min(30, 8 + c.v * 2.4)); if (sn.gap < Infinity) apply(sn.gap, c.v - sn.vl, 1.6); }
    }
    if (c.hitT > 0) { c.hitT -= dt; apply(0.5, c.v, 0.5); }
    if (acc === Infinity) acc = this.idm(c, c.v, v0, Infinity, 0, 2);
    // 坂道（上りでわずかに加速が鈍る）
    acc = clamp(acc, -8.5, c.drv.a * (1 - clamp(c.slope || 0, -0.1, 0.1) * 3));
    c.brake = acc < -0.6 || c.v < 0.2;
    c.v = Math.max(0, c.v + acc * dt);
    if (c.v < 0.1 && !waiting) { c.stuck += dt; if (c.stuck > 9 && c.ghost <= 0 && !c.tram) c.ghost = 2.5; } else if (c.v > 0.5) c.stuck = 0;
    if (c.ghost > 0) c.ghost -= dt;
    let px, pz, hy, entered = false;
    if (c.st === 'lane') {
      c.s += c.v * dt;
      if (c.s >= e.len && c.next) { this.getConn(c); c.st = 'inter'; c.d = c.s - e.len; c.goRight = false; entered = true; }
      else {
        c.s = Math.min(c.s, e.len);
        const p = city.lanePos(e, c.k, c.s, c.lat); px = p[0]; pz = p[1];
        hy = city.headAt(e, c.s) + (c.v > 0.5 && Math.abs(c.lat) > 0.01 ? clamp(-Math.sign(c.lat) * 1.1 / Math.max(c.v, 2), -0.2, 0.2) : 0);
        const y0 = city.yAt(e, c.s); c.slope = (city.yAt(e, c.s + 2) - city.yAt(e, c.s - 2)) / 4; c.y = y0;
      }
    }
    if (c.st === 'inter') {
      if (!entered) c.d += c.v * dt;
      const cn = c.conn;
      if (c.d >= cn.len) {
        const r = c.d - cn.len;
        c.e = c.next.e; c.k = c.next.k; c.s = r; c.lat = 0; c.st = 'lane';
        e = city.edges[c.e]; this.plan(c);
        const p = city.lanePos(e, c.k, c.s); px = p[0]; pz = p[1]; hy = city.headAt(e, c.s); c.y = city.yAt(e, c.s);
      } else { const p = this.connAt(cn, c.d); px = p[0]; pz = p[1]; hy = p[2]; c.y = cn.y; c.slope = 0; }
    }
    c.x = px; c.z = pz;
    const dy = angDiff(c.yaw, hy);
    c.yaw += clamp(dy, -3.0 * dt, 3.0 * dt);
    if (Math.abs(dy) < 0.4) c.yaw += dy * Math.min(1, dt * 8);
    const toEnd2 = c.st === 'lane' ? e.len - c.s : 0;
    c.wink = c.parkPlan ? -1 : c.next && (c.st === 'inter' || toEnd2 < 35) ? c.next.turn : 0;
    if (Math.abs(c.lat) > 0.3 && c.st === 'lane') c.wink = c.lat > 0 ? 1 : -1;
  }
  // 路面電車の停車・折り返し
  updDwell(c, dt) {
    c.v = 0; c.brake = true; c.dwell -= dt;
    if (c.dwell > 0) return;
    if (!c.terminal) { c.st = 'lane'; return; }
    // 渡り線で反対側の線路へ（両運転台のため向きだけ反転）
    const city = this.city, other = c.route === 'east' ? 'west' : 'east', e2 = city.tramRoute[other][0];
    const s2 = clamp((c.x - e2.x0) * e2.d[0] + (c.z - e2.z0) * e2.d[1], 0, e2.len), a = city.lanePos(e2, 0, s2 + 14), b = city.lanePos(e2, 0, s2 + 30);
    c.yaw += Math.PI; c.terminal = false;
    c.wps = [{ x: a[0], z: a[1] }, { x: b[0], z: b[1], last: true }]; c.wi = 0; c.st = 'wp'; c.exiting = false;
    c.tramNext = { route: other, e: e2, s: s2 + 30 };
  }
  updLoop(c, dt) {
    const lp = c.loop, n = lp.pts.length;
    if (c.dwell > 0) { c.dwell -= dt; c.v = 0; c.brake = true; c.wink = -1; return; }
    const w = lp.pts[c.li], dx = w[0] - c.x, dz = w[1] - c.z, dist = Math.hypot(dx, dz);
    let vt = 4.2;
    for (const o of this.ob) {
      if (o.c === c) continue;
      const ox = o.x - c.x, oz = o.z - c.z, od = Math.hypot(ox, oz);
      if (od < c.m.L / 2 + o.hl + 3 && (ox * Math.sin(c.yaw) + oz * Math.cos(c.yaw)) > od * 0.6) { vt = 0; break; }
    }
    c.v += clamp(vt - c.v, -5 * dt, 1.5 * dt); c.v = Math.max(0, c.v); c.brake = c.v < 0.3;
    const step = c.v * dt;
    if (dist > 0.01) { const ty = Math.atan2(dx, dz); c.yaw += clamp(angDiff(c.yaw, ty), -1.2 * dt, 1.2 * dt); if (Math.abs(angDiff(c.yaw, ty)) > 1) c.yaw = ty; }
    if (step >= dist) {
      c.x = w[0]; c.z = w[1];
      if (lp.stops.includes(c.li)) c.dwell = 12 + this.R() * 25;
      c.li = (c.li + 1) % n;
    } else { c.x += dx / dist * step; c.z += dz / dist * step; }
    c.wink = 0;
  }
  // ---- 駐車場 ----
  enterLot(c) {
    const { lot, slot } = c.parkPlan, f = lot.f, e = lot.edge, city = this.city;
    const r = slot.row, aw = lot.aisle(r);
    const q = city.lanePos(e, e.lanes - 1, lot.sE - 3, 0.8);
    const curb = f.W(lot.entU, -lot.sw - 0.8), inside = f.W(lot.entU, 1.8), a1 = f.W(lot.entU, aw), a2 = f.W(slot.u + (slot.u > lot.entU ? -2.5 : 2.5), aw);
    c.wps = [{ x: q[0], z: q[1] }, { x: curb[0], z: curb[1] }, { x: inside[0], z: inside[1] }, { x: a1[0], z: a1[1] }, { x: a2[0], z: a2[1] }, { x: slot.x, z: slot.z, last: true }];
    c.wi = 0; c.st = 'wp'; c.exiting = false; c.v = Math.min(c.v, 3);
  }
  updWp(c, dt) {
    const w = c.wps[c.wi];
    const dx = w.x - c.x, dz = w.z - c.z, dist = Math.hypot(dx, dz);
    let vt = w.rev ? 1.4 : c.tram ? 3.5 : 2.8;
    if (w.last) vt = Math.min(vt, dist * 0.9 + (c.tram ? 2 : 0.25));
    for (const o of this.ob) {
      if (o.c === c) continue;
      const ox = o.x - c.x, oz = o.z - c.z, od = Math.hypot(ox, oz);
      if (od < c.m.L / 2 + 2.5 && dist > 0.01 && (ox * dx + oz * dz) / (od * dist + 1e-6) > 0.5 && !(o.c.st === 'park' && od > 2.6)) { vt = 0; break; }
    }
    // 駐車場の出入口は1台ずつ（入口通路の占有）
    const lot = !c.tram && c.parkPlan && c.parkPlan.lot;
    if (lot) {
      const need = (!c.exiting && c.wi >= 1 && c.wi <= 3) || (c.exiting && c.wi >= 1);
      if (need) {
        if (lot.gate && lot.gate !== c && this.cars.includes(lot.gate)) {
          if (!c.exiting && c.wi <= 1) { // 入口がふさがっている：入庫をあきらめて通過
            const e = this.city.edges[c.e], sNow = clamp((c.x - e.x0) * e.d[0] + (c.z - e.z0) * e.d[1], 0, e.len - 0.1), lp = this.city.lanePos(e, e.lanes - 1, sNow);
            c.parkPlan.slot.occ = null; c.parkPlan = null; c.st = 'lane'; c.k = e.lanes - 1; c.s = sNow; c.lat = Math.hypot(c.x - lp[0], c.z - lp[1]) * 0; c.conn = null;
            return;
          }
          vt = 0;
        } else lot.gate = c;
      }
      if (!c.exiting && c.wi >= 4 && lot.gate === c) lot.gate = null;
    }
    c.v += clamp(vt - c.v, -4 * dt, 1.5 * dt); c.v = Math.max(0, c.v);
    if (vt === 0 && c.v < 0.3) c.v = 0;
    c.brake = vt < c.v || c.v < 0.2;
    const step = c.v * dt;
    if (dist > 0.01) {
      const md = Math.atan2(dx, dz), ty = w.rev ? md + Math.PI : md;
      if (dist > 0.4) c.yaw += clamp(angDiff(c.yaw, ty), -Math.max(0.5, c.v / 2.6) * dt, Math.max(0.5, c.v / 2.6) * dt);
    }
    if (step >= dist) {
      c.x = w.x; c.z = w.z; c.wi++;
      if (c.wi >= c.wps.length) {
        if (c.tram) { const t = c.tramNext; c.route = t.route; c.e = t.e.id; c.k = 0; c.s = t.s; c.lat = 0; c.st = 'lane'; c.served = null; this.plan(c); return; }
        if (!c.exiting) { c.st = 'park'; c.v = 0; c.yaw = c.parkPlan.slot.yaw; c.parkT = 20 + this.R() * 55; }
        else { c.st = 'join'; c.v = 0; }
      }
    } else { c.x += dx / dist * step; c.z += dz / dist * step; }
    c.wink = c.tram ? 0 : c.exiting ? -1 : (c.wi < 3 ? -1 : 0);
  }
  updPark(c, dt) {
    c.parkT -= dt; c.brake = false; c.wink = 0;
    if (c.parkT <= 0) {
      const { lot, slot } = c.parkPlan, f = lot.f, aw = lot.aisle(slot.row);
      const back = f.W(slot.u, aw), mid = f.W(lot.entU + (slot.u > lot.entU ? 2.5 : -2.5), aw), a1 = f.W(lot.entU, aw), inside = f.W(lot.entU, 1.6), curb = f.W(lot.entU, -lot.sw - 0.4);
      c.wps = [{ x: back[0], z: back[1], rev: true }, { x: mid[0], z: mid[1] }, { x: a1[0], z: a1[1] }, { x: inside[0], z: inside[1] }, { x: curb[0], z: curb[1], last: true }];
      c.wi = 0; c.st = 'wp'; c.exiting = true;
    }
  }
  updJoin(c, dt, player) {
    const { lot, slot } = c.parkPlan, e = lot.edge;
    c.brake = true; c.wink = -1;
    const a = this.byEdge.get(e.id) || [];
    // 前方（入口付近）が空いていて、後方から走ってくる車がいなければ合流（停止中の列の前には譲ってもらう）
    let clear = !a.some(o => o.proxy !== c && !(o.proxy && o.proxy.parkPlan && o.proxy.parkPlan.lot === lot) && o.k === e.lanes - 1 && ((o.s > lot.sE - 2 && o.s < lot.sE + 10) || (o.s > lot.sE - 38 && o.s <= lot.sE - 2 && o.v > 1.5)));
    const jp = this.city.lanePos(e, e.lanes - 1, lot.sE + 2);
    if (Math.hypot(player.x - jp[0], player.z - jp[1]) < 18) clear = false;
    for (const o of this.cars) if (o !== c && o.st === 'inter' && o.next && o.next.e === e.id) clear = false;
    if (clear) {
      if (lot.gate === c) lot.gate = null;
      slot.occ = null; c.parkPlan = null;
      c.st = 'lane'; c.e = e.id; c.k = e.lanes - 1; c.s = lot.sE + 1;
      const lanePt = this.city.lanePos(e, c.k, c.s);
      c.lat = Math.hypot(c.x - lanePt[0], c.z - lanePt[1]);
      c.v = 1.5; this.plan(c);
    }
  }
  carL(c, lights) { return [lights, c.brake ? 1 : 0, (c.wink < 0 && this.blink) ? 1 : 0, (c.wink > 0 && this.blink) ? 1 : 0]; }
}
