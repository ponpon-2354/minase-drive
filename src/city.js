// 架空都市「水瀬市」：道路ネットワーク・信号・街区・建物・駐車場・チャンク管理
// v0.2：約4km四方（x,z = -2000〜2000）。中心市街地（1km四方）＋郊外・工業団地・ロードサイド・河川・田園・山間部
import { GB, hex } from './geo.js';
import { L } from './textures.js';
import { rng, clamp } from './math.js';
import { buildCar, pickModel, pickColor, MODELS } from './carmodels.js';
import { buildWorld } from './world.js';

export const LINES = [-500, -375, -250, -125, 0, 125, 250, 375, 500];
export const XL = [-2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000];
const SPECS = {
  art: { kind: 'art', lanes: 2, lw: 3.25, sw: 3.5, lim: 50, sh: 0.5, rank: 5 },
  nat: { kind: 'nat', lanes: 3, lw: 3.5, sw: 3.5, lim: 60, sh: 0.75, rank: 6 },
  byp: { kind: 'byp', lanes: 2, lw: 3.5, sw: 0, lim: 60, sh: 1.25, rank: 5 },
  ring: { kind: 'ring', lanes: 1, lw: 3.5, sw: 2.0, lim: 50, sh: 0.5, rank: 3 },
  shop: { kind: 'shop', lanes: 1, lw: 3.0, sw: 2.5, lim: 30, sh: 0.3, rank: 1.5, oneway: 1, fixedHw: 3.3 },
  minor: { kind: 'minor', lanes: 1, lw: 3.0, sw: 0, lim: 40, sh: 0.5, rank: 1 },
  out: { kind: 'out', lanes: 1, lw: 3.25, sw: 0, lim: 50, sh: 0.75, rank: 2 },
  mtn: { kind: 'mtn', lanes: 1, lw: 3.0, sw: 0, lim: 40, sh: 0.75, rank: 1 }
};
export function mkSpec(kind, axis, c) {
  const s = { ...SPECS[kind], axis, c };
  s.hw = s.fixedHw || s.lanes * s.lw + s.sh; s.ext = s.hw + s.sw;
  return s;
}
function coreKind(axis, c) {
  if ((axis === 'ns' && c === 0) || (axis === 'ew' && (c === 0 || c === -375))) return 'art';
  if (Math.abs(c) === 500) return 'ring';
  if (axis === 'ns' && c === -250) return 'shop';
  return 'minor';
}
// 中心市街地の街区生成用（従来どおり）
export const RS = { ns: LINES.map(c => mkSpec(coreKind('ns', c), 'ns', c)), ew: LINES.map(c => mkSpec(coreKind('ew', c), 'ew', c)) };
// バイパス（x=1000）の高架：国道(z=0)を立体交差でまたぐ
export const BYP_X = 1000;
export function bypY(z) { const f = clamp((290 - Math.abs(z)) / 150, 0, 1); return 9 * f * f * (3 - 2 * f); }

// 街区の用途（中心市街地8x8）
const DMAP = ['RRABSOAR', 'RHHOOOAR', 'RHHOPOAR', 'RAKCODDD', 'RFEUQDDD', 'RRARRAMI', 'RRRRRANI', 'RRARRRII'];
const DNAME = { R: '住宅街', A: '住宅街（集合住宅）', B: '駅前地区', S: '駅前地区', O: '中心市街地・オフィス街', H: '水瀬銀座商店街', P: '中心市街地', C: '中心市街地（市役所）', K: '中心市街地', F: '住宅街', E: '文教地区', U: '商業地区', Q: '中心市街地（病院）', D: 'ロードサイド商業地区', M: '大型商業施設地区', N: '大型商業施設地区', I: '工業団地' };

export const CH = 250, CX0 = -2000, CZ0 = -2000, NCX = 16, NCZ = 16;
const WHITE = [0.95, 0.95, 0.93], YEL = [0.95, 0.75, 0.15];
const PAL_WALL = ['#efefea', '#e6dcc8', '#d9d4cc', '#c8c2b6', '#e9e2d0', '#b9b2a8', '#ddd8cf', '#a99f92', '#f2eee4', '#cfc8bd'].map(hex);
const PAL_HOUSE = ['#f1efe8', '#e8dcc4', '#d8cfc2', '#c9b9a0', '#efe6d6', '#b8a890', '#dfe3e2', '#8c7b6b', '#f4f0e6', '#c4c8c0'].map(hex);
const PAL_ROOF = ['#3a3d45', '#4a4f5a', '#6b4b3a', '#2f3e5a', '#5a5f63', '#7a3a2a', '#3d4a3d'].map(hex);
export { PAL_WALL, PAL_HOUSE, PAL_ROOF, WHITE, YEL };

// ポリライン情報（累積長・向き・頂点の左法線）
export function polyInfo(pts) {
  const cum = [0], dirs = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1], l = Math.hypot(dx, dz) || 1e-6;
    cum.push(cum[i - 1] + l); dirs.push([dx / l, dz / l]);
  }
  const nrm = pts.map((_, i) => {
    const a = dirs[Math.max(0, i - 1)], b = dirs[Math.min(dirs.length - 1, i)];
    let x = a[0] + b[0], z = a[1] + b[1]; const l = Math.hypot(x, z) || 1; x /= l; z /= l;
    const k = 1 / Math.max(0.5, x * b[0] + z * b[1]); // 角での幅を保つ
    return [z * k, -x * k];
  });
  return { cum, dirs, nrm, len: cum[cum.length - 1] };
}
function subPoly(pts, s0, s1) {
  const { cum } = polyInfo(pts), out = [];
  const at = s => { let i = 0; while (i < cum.length - 2 && cum[i + 1] < s) i++; const t = (s - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]); const a = pts[i], b = pts[i + 1]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  out.push(at(s0));
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 + 0.01 && cum[i] < s1 - 0.01) out.push(pts[i]);
  out.push(at(s1));
  return out;
}

export class City {
  constructor() {
    this.nodes = []; this.nmap = new Map(); this.edges = []; this.emap = new Map(); this.lots = []; this.aabbs = []; this.hash = new Map(); this.walls = []; this.whash = new Map();
    this.chunks = []; this.sigHeads = []; this.mm = { blds: [], lots: [], lanes: [], polys: [], water: [], green: [] };
    this.stats = { buildings: 0, houses: 0, parked: 0, lotsAI: 0 };
    this.surfaces = []; this.tunnels = []; this.tramStops = []; this.loops = [];
    for (let cz = 0; cz < NCZ; cz++) for (let cx = 0; cx < NCX; cx++) this.chunks.push({ cx, cz, x: CX0 + cx * CH + CH / 2, z: CZ0 + cz * CH + CH / 2, cmds: [], m: null });
    this.global = new GB(); this.globalDecal = new GB();
    this.buildNetwork();
    buildWorld(this, 'pre');   // 山道・地形（道路ジオメトリより先に必要）
    this.buildRoads();
    for (let bz = 0; bz < 8; bz++) for (let bx = 0; bx < 8; bx++) this.genBlock(bx, bz);
    buildWorld(this, 'post');  // 郊外・河川・鉄道・路面電車など
  }
  // ---------- チャンク ----------
  chunkAt(x, z) {
    const cx = Math.max(0, Math.min(NCX - 1, Math.floor((x - CX0) / CH))), cz = Math.max(0, Math.min(NCZ - 1, Math.floor((z - CZ0) / CH)));
    return this.chunks[cz * NCX + cx];
  }
  add(x, z, fn) { this.chunkAt(x, z).cmds.push(fn); }
  buildChunk(ch, R) {
    const g = { s: new GB(), d1: new GB(), d2: new GB(), glow: new GB(), lines: new GB(), glass: new GB() };
    for (const f of ch.cmds) f(g);
    ch.m = { s: R.mesh(g.s.build()), d1: R.mesh(g.d1.build()), d2: R.mesh(g.d2.build()), glow: R.mesh(g.glow.build()), lines: R.mesh(g.lines.build(), R.gl.LINES) };
    ch.tris = (g.s.count + g.d1.count + g.d2.count) / 3;
  }
  freeChunk(ch, R) { if (!ch.m) return; for (const k in ch.m) R.free(ch.m[k]); ch.m = null; }
  // ---------- 衝突 ----------
  addBox(x0, z0, x1, z1, kind = 'b', y0 = -50, y1 = 1000) {
    const b = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), kind, y0, y1 };
    this.aabbs.push(b);
    for (let gx = Math.floor(b.x0 / 25); gx <= Math.floor(b.x1 / 25); gx++) for (let gz = Math.floor(b.z0 / 25); gz <= Math.floor(b.z1 / 25); gz++) {
      const k = gx * 10007 + gz; let a = this.hash.get(k); if (!a) this.hash.set(k, a = []); a.push(b);
    }
    return b;
  }
  query(x, z, r) {
    const out = new Set();
    for (let gx = Math.floor((x - r) / 25); gx <= Math.floor((x + r) / 25); gx++) for (let gz = Math.floor((z - r) / 25); gz <= Math.floor((z + r) / 25); gz++) {
      const a = this.hash.get(gx * 10007 + gz); if (a) for (const b of a) out.add(b);
    }
    return out;
  }
  // 線分の壁（ガードレール・高架の防護壁など）
  addWall(x0, z0, x1, z1, y0, y1) {
    const w = { x0, z0, x1, z1, y0, y1 };
    this.walls.push(w);
    for (let gx = Math.floor(Math.min(x0, x1) / 25); gx <= Math.floor(Math.max(x0, x1) / 25); gx++) for (let gz = Math.floor(Math.min(z0, z1) / 25); gz <= Math.floor(Math.max(z0, z1) / 25); gz++) {
      const k = gx * 10007 + gz; let a = this.whash.get(k); if (!a) this.whash.set(k, a = []); a.push(w);
    }
  }
  wallsNear(x, z, r) {
    const out = new Set();
    for (let gx = Math.floor((x - r) / 25); gx <= Math.floor((x + r) / 25); gx++) for (let gz = Math.floor((z - r) / 25); gz <= Math.floor((z + r) / 25); gz++) {
      const a = this.whash.get(gx * 10007 + gz); if (a) for (const b of a) out.add(b);
    }
    return out;
  }
  allowed(x, z) {
    if (x < -2040 || x > 2040 || z < -2040 || z > 2040) return false;
    if (z > 530 && z < 600) { // 川：橋の上だけ通行可
      for (const b of this.bridges) if (Math.abs(x - b.x) < b.hw) return true;
      return false;
    }
    return true;
  }
  // 地面の高さ（現在の高さ cy を考慮して高架と地上を区別）
  groundY(x, z, cy = 0) {
    let y = this.terrainY(x, z);
    const m = this.mtnRoadAt ? this.mtnRoadAt(x, z) : null;
    if (m) y = m.y;
    for (const s of this.surfaces) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) { const ys = s.y(x, z); if (cy > ys - 1.6 && ys > y) y = ys; }
    return y;
  }
  district(x, z) { return this.zoneName ? this.zoneName(x, z) : ''; }
  coreDistrict(x, z) {
    let bx = 0, bz = 0; while (bx < 7 && x > LINES[bx + 1]) bx++; while (bz < 7 && z > LINES[bz + 1]) bz++;
    return DNAME[DMAP[bz][bx]];
  }
  // ---------- 道路ネットワーク ----------
  buildNetwork() {
    const roads = this.roads = [];
    const R = (axis, c, a, b, kind) => roads.push({ axis, c, a, b, sp: mkSpec(kind, axis, c) });
    for (const c of LINES) { R('ns', c, -500, 500, coreKind('ns', c)); R('ew', c, -500, 500, coreKind('ew', c)); }
    for (const x of XL) {
      R('ns', x, -1000, -500, x === 0 ? 'art' : Math.abs(x) === 500 ? 'ring' : x === BYP_X ? 'byp' : 'out');
      if (Math.abs(x) >= 1000) R('ns', x, -500, 500, x === BYP_X ? 'byp' : 'out');
      R('ns', x, 500, 2000, x === BYP_X ? 'byp' : x === 0 ? 'art' : 'out');
    }
    R('ew', -1000, -2000, 2000, 'out');
    for (const z of [-500, 500]) { R('ew', z, -2000, -500, 'out'); R('ew', z, 500, 2000, 'out'); }
    R('ew', 0, -2000, -500, 'art'); R('ew', 0, 500, 2000, 'nat');
    for (const z of [1000, 1500, 2000]) R('ew', z, -2000, 2000, 'out');
    const gradeSep = (ns, ew) => ns.c === BYP_X && ew.c === 0;
    // 交差点
    const node = (x, z) => {
      const k = x + ',' + z; let n = this.nmap.get(k);
      if (!n) { n = { id: this.nodes.length, x, z, ns: [], ew: [], out: [], inn: [], hx: 0, hz: 0, ctrl: 'none', off: 0 }; this.nodes.push(n); this.nmap.set(k, n); }
      return n;
    };
    for (const a of roads) if (a.axis === 'ns') for (const b of roads) if (b.axis === 'ew') {
      if (b.a <= a.c && a.c <= b.b && a.a <= b.c && b.c <= a.b && !gradeSep(a, b)) {
        const n = node(a.c, b.c);
        if (!n.ns.includes(a)) n.ns.push(a); if (!n.ew.includes(b)) n.ew.push(b);
      }
    }
    for (const n of this.nodes) { n.hx = Math.max(...n.ns.map(r => r.sp.ext)); n.hz = Math.max(...n.ew.map(r => r.sp.ext)); }
    // 道路ごとに交差点を並べて区間をつくる
    this.segs = [];
    for (const r of roads) {
      const ns = this.nodes.filter(n => (r.axis === 'ns' ? n.x === r.c && n.ns.includes(r) : n.z === r.c && n.ew.includes(r)))
        .sort((p, q) => r.axis === 'ns' ? p.z - q.z : p.x - q.x);
      for (let i = 0; i < ns.length - 1; i++) this.segs.push({ A: ns[i], B: ns[i + 1], road: r });
    }
    // 交差点の制御（隣接数を先に数える）
    const nb = new Map(); for (const n of this.nodes) nb.set(n, new Set());
    for (const s of this.segs) { nb.get(s.A).add(s.B); nb.get(s.B).add(s.A); }
    this.extraNb = nb;
    this.finishNodes = () => {
      for (const n of this.nodes) {
        const deg = nb.get(n).size;
        const rNS = Math.max(0, ...n.ns.map(r => r.sp.rank), ...(n.mtnNS ? [1] : [])), rEW = Math.max(0, ...n.ew.map(r => r.sp.rank));
        if (deg <= 2) n.ctrl = 'none';
        else if (Math.max(rNS, rEW) >= 5) n.ctrl = 'signal';
        else n.ctrl = rNS < rEW ? 'stopNS' : rEW < rNS ? 'stopEW' : 'stopNS';
        n.off = ((Math.abs(n.x) / 125 * 7 + Math.abs(n.z) / 125 * 3) % 9) * 6;
      }
    };
    // 山道など追加区間を受け付けてから確定する
    this.pendingSegs = [];
  }
  finalizeNetwork() {
    for (const s of this.pendingSegs) { this.extraNb.get(s.A).add(s.B); this.extraNb.get(s.B).add(s.A); this.segs.push(s); }
    this.finishNodes();
    for (const s of this.segs) {
      const { A, B, road } = s, sp = road.sp;
      const full = s.full || this.straightFull(A, B, road);
      const e1 = this.mkEdge(A, B, sp, road.axis, full, s);
      s.fwd = e1;
      if (!sp.oneway) { const e2 = this.mkEdge(B, A, sp, road.axis, full.slice().reverse(), s); e1.rev = e2.id; e2.rev = e1.id; }
    }
  }
  straightFull(A, B, road) {
    if (road.c !== BYP_X || road.axis !== 'ns' || (A.z > 400 || B.z < -400)) return [[A.x, A.z, 0], [B.x, B.z, 0]];
    const pts = []; const n = Math.ceil(Math.abs(B.z - A.z) / 10);
    for (let i = 0; i <= n; i++) { const z = A.z + (B.z - A.z) * i / n; pts.push([A.x, z, bypY(z)]); }
    return pts;
  }
  mkEdge(A, B, sp, axis, full, seg) {
    const fi = polyInfo(full);
    const ax0 = axis === 'ns' ? A.hz : A.hx, ax1 = axis === 'ns' ? B.hz : B.hx;
    const trimA = ax0 + (A.ctrl === 'signal' ? 5.0 : 1.2), trimB = ax1 + (B.ctrl === 'signal' ? 5.0 : 1.2);
    const pts = subPoly(full, trimA, fi.len - trimB);
    const pi = polyInfo(pts);
    const straight = pts.length === 2 && pts[0][2] === 0 && pts[1][2] === 0;
    const mustStop = B.ctrl === 'signal' ? 'signal' : (B.ctrl === 'stopNS' && axis === 'ns') || (B.ctrl === 'stopEW' && axis === 'ew') ? 'stop' : null;
    const e = {
      id: this.edges.length, from: A.id, to: B.id, d: pi.dirs[0], dEnd: pi.dirs[pi.dirs.length - 1], axis, sp, lanes: sp.lanes, lw: sp.lw, lim: sp.lim,
      base: sp.oneway ? -sp.lanes * sp.lw / 2 : 0, x0: pts[0][0], z0: pts[0][1], len: pi.len, pts, cum: pi.cum, dirs: pi.dirs, nrm: pi.nrm, straight,
      ctrl: mustStop, lots: [], seg, tunnel: seg.tunnel ? (seg.fwd ? seg.tunnel.map(([a, b]) => [fi.len - b - trimA, fi.len - a - trimA]) : seg.tunnel.map(([a, b]) => [a - trimA, b - trimA])) : null
    };
    const cx = (A.x + B.x) / 2, cz = (A.z + B.z) / 2;
    e.dens = { art: 1.0, nat: 1.1, byp: 0.6, ring: 0.5, shop: 0.5, minor: 0.42, out: 0.3, mtn: 0.05 }[sp.kind] * (Math.abs(cx) < 260 && Math.abs(cz) < 400 ? 1.3 : 1);
    if (!straight) { // カーブでの制限速度（横G 2.6m/s²）
      e.vc = pts.map((_, i) => {
        if (i === 0 || i === pts.length - 1) return 99;
        const a = pi.dirs[i - 1], b = pi.dirs[i], ang = Math.acos(clamp(a[0] * b[0] + a[1] * b[1], -1, 1));
        const ds = (pi.cum[i + 1] - pi.cum[i - 1]) / 2, R = ang > 1e-4 ? ds / ang : 1e5;
        return Math.sqrt(2.6 * R);
      });
    }
    this.edges.push(e); this.emap.set(A.id + '-' + B.id, e); A.out.push(e.id); B.inn.push(e.id);
    return e;
  }
  nodeAt(x, z) { return this.nmap.get(x + ',' + z); }
  edgeXY(x0, z0, x1, z1) { const a = this.nodeAt(x0, z0), b = this.nodeAt(x1, z1); return a && b ? this.emap.get(a.id + '-' + b.id) : null; }
  segIdx(e, s) {
    const c = e.cum; if (s <= 0) return 0; if (s >= e.len) return c.length - 2;
    let lo = 0, hi = c.length - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m] <= s) lo = m; else hi = m - 1; }
    return lo;
  }
  // 車線中心座標（左側通行：進行方向の左側に車線、k=0が中央寄り）
  lanePos(e, k, s, lat = 0) {
    const off = e.base + (k + 0.5) * e.lw + lat;
    if (e.straight) return [e.x0 + e.d[0] * s + e.d[1] * off, e.z0 + e.d[1] * s - e.d[0] * off];
    const i = this.segIdx(e, s), t = clamp((s - e.cum[i]) / Math.max(1e-6, e.cum[i + 1] - e.cum[i]), 0, 1), a = e.pts[i], b = e.pts[i + 1], na = e.nrm[i], nb = e.nrm[i + 1];
    const nx = na[0] + (nb[0] - na[0]) * t, nz = na[1] + (nb[1] - na[1]) * t;
    return [a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + nz * off];
  }
  yAt(e, s) {
    if (e.straight) return 0;
    const i = this.segIdx(e, s), t = clamp((s - e.cum[i]) / Math.max(1e-6, e.cum[i + 1] - e.cum[i]), 0, 1);
    return e.pts[i][2] + (e.pts[i + 1][2] - e.pts[i][2]) * t;
  }
  headAt(e, s) {
    if (e.straight) return Math.atan2(e.d[0], e.d[1]);
    const i = this.segIdx(e, s), t = clamp((s - e.cum[i]) / Math.max(1e-6, e.cum[i + 1] - e.cum[i]), 0, 1);
    const a = e.dirs[Math.max(0, i - 1)], b = e.dirs[i], c = e.dirs[Math.min(e.dirs.length - 1, i + 1)];
    const p = t < 0.5 ? [a[0] + (b[0] - a[0]) * (t + 0.5), a[1] + (b[1] - a[1]) * (t + 0.5)] : [b[0] + (c[0] - b[0]) * (t - 0.5), b[1] + (c[1] - b[1]) * (t - 0.5)];
    return Math.atan2(p[0], p[1]);
  }
  vcAt(e, s) { if (!e.vc) return 99; return e.vc[Math.min(e.vc.length - 1, this.segIdx(e, s) + 1)]; }
  inTunnel(e, s) { if (!e.tunnel) return false; for (const [a, b] of e.tunnel) if (s > a && s < b) return true; return false; }
  // 信号：周期54秒 NS青22→黄3→全赤2→EW青22→黄3→全赤2
  sig(node, axis, T) {
    const p = ((T + node.off) % 54 + 54) % 54;
    if (axis === 'ns') return p < 22 ? 'g' : p < 25 ? 'y' : 'r';
    return p >= 27 && p < 49 ? 'g' : p >= 49 && p < 52 ? 'y' : 'r';
  }
  // 道路上の点（中心線から左へ o、高さつき）
  edgePt(e, s, o) {
    if (e.straight) return [e.x0 + e.d[0] * s + e.d[1] * o, 0, e.z0 + e.d[1] * s - e.d[0] * o];
    const p = this.lanePos({ ...e, base: 0, lw: 0 }, 0, s, o);
    return [p[0], this.yAt(e, s), p[1]];
  }
  // エッジに沿った帯（区画線・路面など）。曲線は頂点ごとに分割
  band(gb, e, s0, s1, o0, o1, o, dy = 0) {
    if (s1 <= s0) return;
    const cuts = [s0]; if (!e.straight) for (const c of e.cum) if (c > s0 + 0.01 && c < s1 - 0.01) cuts.push(c); cuts.push(s1);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a0 = this.edgePt(e, cuts[i], o0), a1 = this.edgePt(e, cuts[i + 1], o0), b1 = this.edgePt(e, cuts[i + 1], o1), b0 = this.edgePt(e, cuts[i], o1);
      for (const p of [a0, a1, b1, b0]) p[1] += dy;
      gb.quadN(a0, a1, b1, b0, [0, 1, 0], o);
    }
  }
  // ---------- 道路ジオメトリ ----------
  buildRoads() {
    const asph = { c: [1, 1, 1], mat: 7, lay: L.ASPHALT };
    for (const sg of this.segs) {
      const e = sg.fwd, sp = e.sp, A = this.nodes[e.from], B = this.nodes[e.to], axis = e.axis;
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
      this.mm.lanes.push({ axis, c: axis === 'ns' ? A.x : A.z, a: axis === 'ns' ? Math.min(A.z, B.z) : Math.min(A.x, B.x), b: axis === 'ns' ? Math.max(A.z, B.z) : Math.max(A.x, B.x), w: sp.hw, kind: sp.kind, poly: sg.full ? sg.full : null });
      if (sg.full) continue; // 山道は world.js で描画
      const c = axis === 'ns' ? A.x : A.z, p0 = axis === 'ns' ? Math.min(A.z, B.z) : Math.min(A.x, B.x), p1 = axis === 'ns' ? Math.max(A.z, B.z) : Math.max(A.x, B.x);
      const nLo = (axis === 'ns' ? A.z < B.z : A.x < B.x) ? A : B, nHi = nLo === A ? B : A;
      const crossA = axis === 'ns' ? nLo.hz : nLo.hx, crossB = axis === 'ns' ? nHi.hz : nHi.hx;
      const elevated = !e.straight;
      // 区間をチャンク境界で分割して登録（長い道路も遠方で解放されるように）
      const step = 125;
      for (let q0 = p0; q0 < p1 - 0.01; q0 += step) {
        const q1 = Math.min(p1, q0 + step);
        const cx = axis === 'ns' ? c : (q0 + q1) / 2, cz = axis === 'ns' ? (q0 + q1) / 2 : c;
        this.add(cx, cz, g => {
          if (!elevated) {
            if (axis === 'ns') g.d1.flat(c - sp.hw, q0, c + sp.hw, q1, 0, asph, 8); else g.d1.flat(q0, c - sp.hw, q1, c + sp.hw, 0, asph, 8);
          } else {
            const s0 = q0 - p0, s1 = q1 - p0; // 北→南方向の距離（バイパスはNS）
            const ys = z => bypY(z);
            for (let z = q0; z < q1 - 0.01; z += 10) {
              const z2 = Math.min(q1, z + 10), y0 = ys(z), y1 = ys(z2);
              g.d1.quadN([c - sp.hw, y0, z], [c + sp.hw, y0, z], [c + sp.hw, y1, z2], [c - sp.hw, y1, z2], [0, 1, 0], { ...asph }, [[(c - sp.hw) / 8, z / 8], [(c + sp.hw) / 8, z / 8], [(c + sp.hw) / 8, z2 / 8], [(c - sp.hw) / 8, z2 / 8]]);
            }
            void s0; void s1;
          }
          if (sp.sw > 0 && !elevated) for (const s of [1, -1]) {
            const o0 = c + s * sp.hw, o1 = c + s * sp.ext;
            const a = Math.max(q0, p0 + crossA), b = Math.min(q1, p1 - crossB);
            if (b <= a) continue;
            const o = { c: [0.78, 0.77, 0.74], top: { lay: L.SIDEWALK, tw: 2 } };
            if (axis === 'ns') g.s.box(Math.min(o0, o1), 0, a, Math.max(o0, o1), 0.12, b, o); else g.s.box(a, 0, Math.min(o0, o1), b, 0.12, Math.max(o0, o1), o);
          }
        });
      }
    }
    // 交差点の歩道コーナー
    for (const n of this.nodes) {
      const swN = Math.max(...n.ns.map(r => r.sp.sw)), swE = Math.max(...n.ew.map(r => r.sp.sw));
      const hwN = Math.max(...n.ns.map(r => r.sp.hw)), hwE = Math.max(...n.ew.map(r => r.sp.hw));
      if (swN > 0 && swE > 0) this.add(n.x, n.z, g => {
        for (const sx of [1, -1]) for (const sz of [1, -1]) {
          const xa = n.x + sx * hwN, xb = n.x + sx * (hwN + swN), za = n.z + sz * hwE, zb = n.z + sz * (hwE + swE);
          g.s.box(Math.min(xa, xb), 0, Math.min(za, zb), Math.max(xa, xb), 0.12, Math.max(za, zb), { c: [0.78, 0.77, 0.74], top: { lay: L.SIDEWALK, tw: 2 } });
        }
      });
    }
    // 区画線・停止線・横断歩道・標識・街灯など（エッジ単位）
    for (const e of this.edges) {
      const A = this.nodes[e.from], B = this.nodes[e.to], sp = e.sp, fwd = e.seg.fwd === e;
      const ow = !!sp.oneway;
      const W = (gb, s0, s1, o0, o1, c) => this.band(gb, e, s0, s1, o0, o1, { c, mat: 0 });
      // チャンクごとに分けて登録
      for (let q0 = 0; q0 < e.len; q0 += 125) {
        const q1 = Math.min(e.len, q0 + 125), mid = this.edgePt(e, (q0 + q1) / 2, 0);
        const first = q0 === 0, last = q1 >= e.len;
        this.add(mid[0], mid[2], g => {
          const d2 = g.d2;
          if (fwd && !ow && sp.kind !== 'mtn') {
            if (sp.kind === 'minor' || sp.kind === 'out') { for (let s = q0; s < q1; s += 10) W(d2, s, Math.min(s + 5, q1), -0.07, 0.07, WHITE); }
            else W(d2, q0, q1, -0.08, 0.08, YEL);
          }
          for (let k = 1; k < e.lanes; k++) {
            const o = e.base + k * e.lw;
            for (let s = q0; s < Math.min(q1, e.len - 30); s += 13) W(d2, s, Math.min(s + 6, q1, e.len - 30), o - 0.07, o + 0.07, WHITE);
            if (last) W(d2, Math.max(0, e.len - 30), e.len, o - 0.07, o + 0.07, WHITE);
          }
          if (sp.kind !== 'mtn') { W(d2, q0, q1, sp.hw - 0.35, sp.hw - 0.2, WHITE); if (ow) W(d2, q0, q1, -sp.hw + 0.2, -sp.hw + 0.35, WHITE); }
          if (last && e.ctrl) W(d2, e.len - 0.45, e.len, e.base, e.base + e.lanes * e.lw + 0.2, WHITE);
          const zebra = (s0, s1, oLo, oHi) => { for (let o = oLo + 0.3; o < oHi - 0.2; o += 0.9) W(d2, s0, s1, o, Math.min(o + 0.45, oHi), WHITE); };
          if (last && B.ctrl === 'signal') zebra(e.len + 0.5, e.len + 4.5, ow ? -sp.hw : 0, sp.hw);
          if (first && A.ctrl === 'signal') zebra(-4.5, -0.5, ow ? -sp.hw : 0, sp.hw);
          if (last && e.lanes >= 2 && e.len > 60 && e.straight) { // 右折レーン矢印
            const s = e.len - 18, o = e.base + 0.5 * e.lw, P = (a, b) => this.edgePt(e, a, b);
            W(d2, s - 3, s, o - 0.1, o + 0.1, WHITE);
            d2.quadN(P(s, o - 0.1), P(s + 0.4, o - 0.8), P(s + 0.9, o - 0.8), P(s + 0.3, o + 0.1), [0, 1, 0], { c: WHITE });
          }
        });
      }
      this.edgeProps(e, A, B);
    }
    // 信号機
    for (const n of this.nodes) {
      if (n.ctrl === 'signal') {
        for (const eid of n.inn) {
          const e = this.edges[eid], sp = e.sp;
          if (!e.straight && e.len < 1) continue;
          const d = e.dEnd, left = [d[1], -d[0]];
          const ext = e.axis === 'ns' ? n.hz : n.hx;
          const px = n.x + d[0] * (ext + 1.2) + left[0] * (sp.hw + 0.8), pz = n.z + d[1] * (ext + 1.2) + left[1] * (sp.hw + 0.8);
          const arm = Math.max(2.5, sp.hw * 0.75);
          const hx = px - left[0] * arm, hz = pz - left[1] * arm;
          const yaw = Math.atan2(d[0], d[1]);
          this.sigHeads.push({ node: n, axis: e.axis, x: hx, y: 5.3, z: hz, yaw });
          this.add(n.x, n.z, g => {
            g.s.cyl(px, 0, pz, 0.13, 6.2, 8, { c: [0.55, 0.56, 0.55] });
            g.s.beam([px, 5.75, pz], [hx - left[0] * 0.7, 5.75, hz - left[1] * 0.7], 0.06, { c: [0.55, 0.56, 0.55] });
            g.s.setXf(hx, 5.3, hz, yaw);
            g.s.cbox(0, 0, 0, 1.3, 0.46, 0.32, { c: [0.45, 0.47, 0.46] });
            for (const x of [-0.42, 0, 0.42]) g.s.cbox(x, 0.2, -0.22, 0.36, 0.05, 0.14, { c: [0.4, 0.42, 0.41] });
            g.s.clearXf();
            g.s.cbox(px, 3.0, pz, 0.32, 0.6, 0.25, { c: [0.45, 0.47, 0.46] });
          });
          this.addBox(px - 0.2, pz - 0.2, px + 0.2, pz + 0.2, 'p');
        }
      } else if (n.ctrl === 'stopNS' || n.ctrl === 'stopEW') {
        const R = rng(n.id * 13), sx = R() < 0.5 ? 1 : -1, sz = R() < 0.5 ? 1 : -1;
        const mx = n.x + sx * (n.hx + 0.8), mz = n.z + sz * (n.hz + 0.8);
        this.add(n.x, n.z, g => {
          g.s.cyl(mx, 0, mz, 0.05, 3.0, 6, { c: [0.95, 0.45, 0.1] });
          g.s.setXf(mx, 3.0, mz, Math.atan2(-sx, -sz));
          const o = { c: [0.95, 0.45, 0.1] }, m = { c: [0.75, 0.8, 0.85] };
          for (let k = 0; k < 10; k++) {
            const a0 = k / 10 * Math.PI * 2, a1 = (k + 1) / 10 * Math.PI * 2;
            g.s.tri([0, 0, 0.05], [Math.cos(a0) * 0.42, Math.sin(a0) * 0.42, 0.05], [Math.cos(a1) * 0.42, Math.sin(a1) * 0.42, 0.05], m);
            g.s.tri([0, 0, 0.0], [Math.cos(a0) * 0.45, Math.sin(a0) * 0.45, 0.0], [Math.cos(a1) * 0.45, Math.sin(a1) * 0.45, 0.0], o);
          }
          g.s.clearXf();
        });
      }
    }
  }
  // 道路わきの設備
  edgeProps(e, A, B) {
    const sp = e.sp, R = rng(e.id * 31 + 7), fwd = e.seg.fwd === e;
    if (sp.kind === 'mtn' || !e.straight) { if (sp.kind === 'byp') this.bypassProps(e); return; }
    const side = (s, o) => this.edgePt(e, s, sp.hw + o);
    const nearByp = (p) => Math.abs(p[0] - BYP_X) < 25 && Math.abs(p[2]) < 300;
    const cx = (A.x + B.x) / 2, cz = (A.z + B.z) / 2;
    const items = [];
    if (e.len > 40) items.push(['sp', 8]);
    if (e.ctrl === 'stop') items.push(['stop', e.len - 1]);
    if (sp.oneway) { items.push(['ow', 20]); }
    if ((sp.kind === 'art' || sp.kind === 'nat') && e.len > 80 && B.ctrl === 'signal' && e.id % 3 === 0) items.push(['guide', e.len - 45]);
    for (const [t, s] of items) {
      const p = side(s, sp.sw > 0 ? 0.8 : 0.6);
      this.add(p[0], p[2], g => {
        if (t === 'sp') this.signPole(g.s, p[0], p[2], e.d, sp.lim === 30 ? L.SP30 : sp.lim === 40 ? L.SP40 : sp.lim === 60 ? L.SP60 : L.SP50, 0.6, 0.6, 2.2);
        else if (t === 'stop') this.signPole(g.s, p[0], p[2], e.d, L.STOP, 0.8, 0.7, 2.0);
        else if (t === 'guide') this.signPole(g.s, p[0], p[2], e.d, L.GUIDE, 2.6, 1.3, 3.2, 0);
        else if (t === 'ow') this.signPole(g.s, p[0], p[2], [-e.d[0], -e.d[1]], L.ONEWAY, 0.9, 0.9, 2.3, 0);
      });
    }
    if (sp.oneway) { // 逆走側の入口に車両進入禁止
      const q = this.edgePt(e, e.len + 1.5, -sp.hw - 0.6);
      this.add(q[0], q[2], g => this.signPole(g.s, q[0], q[2], [-e.d[0], -e.d[1]], L.NOENTRY, 0.6, 0.6, 2.2));
    }
    if (sp.kind === 'art' || sp.kind === 'nat') {
      for (let s = 6; s < e.len - 4; s += 16) { const p = side(s, sp.sw - 1.0); if (nearByp(p)) continue; this.add(p[0], p[2], g => this.tree(g.s, p[0], p[2], rng(e.id * 7 + s))); this.addBox(p[0] - 0.25, p[2] - 0.25, p[0] + 0.25, p[2] + 0.25, 'p'); }
      for (let s = 14; s < e.len; s += 32) { const p = side(s, 0.5); if (nearByp(p)) continue; this.add(p[0], p[2], g => this.streetLight(g, p[0], p[2], e.d, sp.hw * 0.4)); }
    } else if (sp.kind === 'ring' || sp.kind === 'byp') {
      if (fwd) for (let s = 20; s < e.len; s += 45) { const p = side(s, 0.6); this.add(p[0], p[2], g => this.streetLight(g, p[0], p[2], e.d, sp.hw * 0.5)); }
    } else if (fwd) { // 電柱（片側）と電線
      const spacing = 30; let prev = null;
      for (let s = 4; s < e.len; s += spacing) {
        const p = side(s, sp.sw > 0 ? sp.sw - 0.4 : 0.5), pr = prev;
        const lamp = (s / spacing | 0) % (sp.kind === 'out' ? 4 : 2) === 0;
        this.add(p[0], p[2], g => {
          this.utilPole(g, p[0], p[2], e.d, lamp);
          if (pr) for (const [ox, oy] of [[-0.6, 9.4], [0.6, 9.4], [0, 8.3]]) g.lines.line([pr[0] + e.d[1] * ox, oy, pr[2] - e.d[0] * ox], [p[0] + e.d[1] * ox, oy, p[2] - e.d[0] * ox], [0.1, 0.1, 0.1]);
        });
        this.addBox(p[0] - 0.2, p[2] - 0.2, p[0] + 0.2, p[2] + 0.2, 'p');
        prev = p;
      }
    }
    void R; void cx; void cz;
  }
  signPole(gb, x, z, d, lay, w, h, y, cut = 1) {
    gb.cyl(x, 0, z, 0.04, y + h * 0.5, 6, { c: [0.7, 0.72, 0.72] });
    const r = [-d[1], d[0]];
    gb.quadN([x - r[0] * w / 2 - d[0] * 0.06, y, z - r[1] * w / 2 - d[1] * 0.06], [x + r[0] * w / 2 - d[0] * 0.06, y, z + r[1] * w / 2 - d[1] * 0.06],
      [x + r[0] * w / 2 - d[0] * 0.06, y + h, z + r[1] * w / 2 - d[1] * 0.06], [x - r[0] * w / 2 - d[0] * 0.06, y + h, z - r[1] * w / 2 - d[1] * 0.06], [-d[0], 0, -d[1]], { c: [1, 1, 1], lay, mat: cut ? 17 : 0 });
    gb.quadN([x - r[0] * w / 2 - d[0] * 0.04, y, z - r[1] * w / 2 - d[1] * 0.04], [x + r[0] * w / 2 - d[0] * 0.04, y, z + r[1] * w / 2 - d[1] * 0.04],
      [x + r[0] * w / 2 - d[0] * 0.04, y + h, z + r[1] * w / 2 - d[1] * 0.04], [x - r[0] * w / 2 - d[0] * 0.04, y + h, z - r[1] * w / 2 - d[1] * 0.04], [d[0], 0, d[1]], { c: [0.6, 0.62, 0.62], lay: cut ? lay : 0, mat: cut ? 17 : 0 });
  }
  tree(gb, x, z, R) {
    const s = 0.8 + R() * 0.5;
    gb.cyl(x, 0, z, 0.15 * s, 2.2 * s, 5, { c: [0.35, 0.27, 0.2] }, false);
    const c = [0.55 + R() * 0.2, 0.75 + R() * 0.2, 0.5 + R() * 0.1];
    const o = { c, lay: L.TREE };
    const y = 2.0 * s, r = 2.0 * s, t = 4.2 * s;
    const pts = [[r, 0], [0, r], [-r, 0], [0, -r]];
    for (let k = 0; k < 4; k++) {
      const a = pts[k], b = pts[(k + 1) % 4];
      gb.tri([x + a[0], y + t * 0.35, z + a[1]], [x + b[0], y + t * 0.35, z + b[1]], [x, y + t, z], o, [0, 1], [1, 1], [0.5, 0], [x, y + t * 0.4, z]);
      gb.tri([x + a[0], y + t * 0.35, z + a[1]], [x + b[0], y + t * 0.35, z + b[1]], [x, y, z], o, [0, 0], [1, 0], [0.5, 1], [x, y + t * 0.4, z]);
    }
  }
  streetLight(g, x, z, d, arm) {
    const l = [d[1], -d[0]]; // 歩道→車道方向は -left
    const hx = x - l[0] * arm, hz = z - l[1] * arm;
    g.s.cyl(x, 0, z, 0.09, 8, 6, { c: [0.6, 0.62, 0.62] }, false);
    g.s.beam([x, 7.9, z], [hx, 8.1, hz], 0.05, { c: [0.6, 0.62, 0.62] });
    g.s.cbox(hx, 8.0, hz, 0.5, 0.14, 0.3, { c: [1, 0.92, 0.75], mat: 8 });
    g.glow.flat(hx - 7, hz - 7, hx + 7, hz + 7, 0.06, { c: [1, 0.85, 0.62], mat: 5, lay: L.GLOW });
    this.addBox(x - 0.15, z - 0.15, x + 0.15, z + 0.15, 'p');
  }
  utilPole(g, x, z, d, lamp) {
    g.s.cyl(x, 0, z, 0.17, 10, 6, { c: [0.66, 0.66, 0.63] });
    const l = [d[1], -d[0]];
    g.s.beam([x - l[0] * 0.8, 9.4, z - l[1] * 0.8], [x + l[0] * 0.8, 9.4, z + l[1] * 0.8], 0.06, { c: [0.4, 0.4, 0.4] });
    if ((Math.abs(x * 3 + z) | 0) % 3 === 0) g.s.cyl(x + d[0] * 0.35, 6.5, z + d[1] * 0.35, 0.3, 0.9, 6, { c: [0.55, 0.57, 0.56] });
    if (lamp) {
      const hx = x - l[0] * 1.1, hz = z - l[1] * 1.1;
      g.s.beam([x, 5.5, z], [hx, 5.7, hz], 0.03, { c: [0.6, 0.6, 0.6] });
      g.s.cbox(hx, 5.62, hz, 0.35, 0.1, 0.18, { c: [0.95, 0.95, 1], mat: 8 });
      g.glow.flat(hx - 4.5, hz - 4.5, hx + 4.5, hz + 4.5, 0.06, { c: [0.75, 0.8, 0.9], mat: 5, lay: L.GLOW });
    }
  }
  // ---------- 街区 ----------
  blockRect(bx, bz) {
    return { x0: LINES[bx] + RS.ns[bx].ext, x1: LINES[bx + 1] - RS.ns[bx + 1].ext, z0: LINES[bz] + RS.ew[bz].ext, z1: LINES[bz + 1] - RS.ew[bz + 1].ext };
  }
  // 街区内の座標系：u=道路沿い, w=道路から奥へ
  frame(r, side) {
    if (side === 's') return { F: r.x1 - r.x0, D: r.z1 - r.z0, W: (u, w) => [r.x0 + u, r.z1 - w], inv: [0, -1], side };
    if (side === 'n') return { F: r.x1 - r.x0, D: r.z1 - r.z0, W: (u, w) => [r.x1 - u, r.z0 + w], inv: [0, 1], side };
    if (side === 'e') return { F: r.z1 - r.z0, D: r.x1 - r.x0, W: (u, w) => [r.x1 - w, r.z1 - u], inv: [-1, 0], side };
    return { F: r.z1 - r.z0, D: r.x1 - r.x0, W: (u, w) => [r.x0 + w, r.z0 + u], inv: [1, 0], side };
  }
  frect(f, u0, u1, w0, w1) {
    const a = f.W(u0, w0), b = f.W(u1, w1);
    return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
  }
  genBlock(bx, bz) {
    const t = DMAP[bz][bx], r = this.blockRect(bx, bz), R = rng(bx * 131 + bz * 977 + 5);
    const B = { ...r, bx, bz, R, t };
    const resGround = 'RAF'.includes(t);
    this.add((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, g => g.s.flat(r.x0 - 0.01, r.z0 - 0.01, r.x1 + 0.01, r.z1 + 0.01, 0, { c: resGround ? [0.8, 0.78, 0.7] : [0.85, 0.85, 0.83], lay: resGround ? L.FIELD : L.ROOF, mat: 0 }, resGround ? 6 : 10));
    const sideOf = () => { // 主要道路に面する側
      if (RS.ew[bz + 1].kind === 'art') return 's'; if (RS.ew[bz].kind === 'art') return 'n';
      if (RS.ns[bx].kind === 'art') return 'w'; if (RS.ns[bx + 1].kind === 'art') return 'e'; return 's';
    };
    switch (t) {
      case 'R': this.genRes(B); break;
      case 'A': this.genApt(B); break;
      case 'O': this.genOffice(B); break;
      case 'H': this.genShotengai(B, bx === 1 ? 'e' : 'w'); break;
      case 'S': this.genStation(B); break;
      case 'B': this.genBus(B); break;
      case 'D': this.genRoadside(B, bz === 3 ? 's' : 'n'); break;
      default: this.genFacility(B, t, sideOf());
    }
  }
  // 住宅街：街区内に生活道路（幅4m）を2本通し、戸建て中心に配置
  genRes(B) {
    const W = B.x1 - B.x0, la = B.x0 + W / 3, lb = B.x0 + W * 2 / 3;
    for (const lx of [la, lb]) {
      this.add(lx, (B.z0 + B.z1) / 2, g => g.d1.flat(lx - 2, B.z0 - RS.ew[B.bz].ext + RS.ew[B.bz].hw, lx + 2, B.z1 + RS.ew[B.bz + 1].ext - RS.ew[B.bz + 1].hw, 0, { c: [0.95, 0.95, 0.95], mat: 7, lay: L.ASPHALT }, 8));
      this.mm.lanes.push({ axis: 'ns', c: lx, a: B.z0, b: B.z1, w: 2, kind: 'lane' });
    }
    const strips = [[B.x0, la - 2], [la + 2, lb - 2], [lb + 2, B.x1]];
    for (const [sx0, sx1] of strips) {
      const mid = (sx0 + sx1) / 2;
      this.fillParcels({ x0: sx0, x1: mid, z0: B.z0, z1: B.z1 }, 'w', B.R);
      this.fillParcels({ x0: mid, x1: sx1, z0: B.z0, z1: B.z1 }, 'e', B.R);
    }
  }
  // 帯状の領域を間口方向に区画割りして住宅等を配置
  fillParcels(r, side, R, opt = {}) {
    const f = this.frame(r, side), n = Math.max(1, Math.round(f.F / (opt.pw || 12.5))), pw = f.F / n;
    for (let k = 0; k < n; k++) {
      const pr = this.frect(f, k * pw, (k + 1) * pw, 0, f.D);
      const x = R();
      if (x < 0.7 || opt.housesOnly) this.house(pr, side, R);
      else if (x < 0.82) this.apartment(pr, side, R);
      else if (x < 0.89) this.tsukiParking(pr, side, R);
      else if (x < 0.94) this.add((pr.x0 + pr.x1) / 2, (pr.z0 + pr.z1) / 2, g => { g.s.flat(pr.x0 + 1, pr.z0 + 1, pr.x1 - 1, pr.z1 - 1, 0.03, { c: [0.75, 0.62, 0.45], lay: L.FIELD }, 3); });
      else this.smallShop(pr, side, R);
    }
  }
  house(pr, side, R) {
    const f = this.frame(pr, side), D = Math.min(f.D, 20), set = D > 14 ? 5.4 : 2.2;
    const depth = Math.min(9.5, D - set - 1), w0 = set, w1 = set + depth, u0 = 1.0, u1 = f.F - 1.0;
    if (depth < 4 || u1 - u0 < 5) return;
    const b = this.frect(f, u0, u1, w0, w1);
    if (this.railBlock(this.frect(f, 0, f.F, 0, f.D))) return;
    const floors = R() < 0.82 ? 2 : 1, H = floors * 2.8, wc = PAL_HOUSE[R() * PAL_HOUSE.length | 0], rc = PAL_ROOF[R() * PAL_ROOF.length | 0];
    const flat = R() < 0.18, car = set > 4 && R() < (this.carRate ?? 0.6), carM = car ? pickModel(R) : null, carC = car ? pickColor(carM, R) : null;
    const dp = f.W(f.F * 0.3, w0 - 0.02), dirIn = f.inv, wallSplit = f.F * 0.5;
    const carP = f.W(f.F * 0.5, set / 2), carYaw = Math.atan2(dirIn[0], dirIn[1]);
    this.addBox(b.x0, b.z0, b.x1, b.z1);
    if (car) this.addCarBox(carP[0], carP[1], carYaw, carM);
    this.stats.houses++; this.mm.blds.push(b);
    const wallA = f.W(0.2, 0.25), wallB = f.W(wallSplit - 1.8, 0.4), wallC = f.W(wallSplit + 1.8, 0.25), wallD = f.W(f.F - 0.2, 0.4);
    const hasWall = R() < 0.7;
    if (hasWall) { this.addBox(wallA[0], wallA[1], wallB[0], wallB[1], 'w'); this.addBox(wallC[0], wallC[1], wallD[0], wallD[1], 'w'); }
    this.add((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, g => {
      g.s.box(b.x0, 0, b.z0, b.x1, H, b.z1, { c: wc, mat: 3, side: { lay: L.HOUSE, tw: 7, th: 5.6 }, top: { lay: L.ROOF, tw: 6 } });
      if (flat) g.s.box(b.x0 - 0.2, H, b.z0 - 0.2, b.x1 + 0.2, H + 0.3, b.z1 + 0.2, { c: [0.7, 0.7, 0.68] });
      else g.s.gable(b.x0, b.z0, b.x1, b.z1, H, 2.0, { c: rc, lay: L.KAWARA, tw: 2, gc: wc });
      // 玄関
      const n = [-dirIn[0], 0, -dirIn[1]], a = f.W(f.F * 0.3 - 0.5, w0), c = f.W(f.F * 0.3 + 0.5, w0);
      g.s.panel(a[0], a[1], c[0], c[1], 0, 2.1, 0.03, n, { c: [0.35, 0.25, 0.18] });
      void dp;
      if (hasWall) { // ブロック塀
        g.s.box(Math.min(wallA[0], wallB[0]), 0, Math.min(wallA[1], wallB[1]), Math.max(wallA[0], wallB[0]), 1.2, Math.max(wallA[1], wallB[1]), { c: [0.72, 0.72, 0.7] });
        g.s.box(Math.min(wallC[0], wallD[0]), 0, Math.min(wallC[1], wallD[1]), Math.max(wallC[0], wallD[0]), 1.2, Math.max(wallC[1], wallD[1]), { c: [0.72, 0.72, 0.7] });
      }
      if (car) this.bakeCar(g.s, carM, carC, carP[0], carP[1], carYaw);
      if (R && floors === 2 && (b.x1 - b.x0) > 7) { // ベランダ
        const v0 = f.W(f.F * 0.45, w0 - 0.9), v1 = f.W(f.F - 1.6, w0);
        g.s.box(Math.min(v0[0], v1[0]), 2.8, Math.min(v0[1], v1[1]), Math.max(v0[0], v1[0]), 3.8, Math.max(v0[1], v1[1]), { c: [0.85, 0.85, 0.83] });
      }
    });
  }
  apartment(pr, side, R) {
    const f = this.frame(pr, side), D = Math.min(f.D, 22);
    const b = this.frect(f, 1, f.F - 1, 6, Math.min(D - 1, 16));
    if (b.x1 - b.x0 < 4 || b.z1 - b.z0 < 4 || this.railBlock(this.frect(f, 0, f.F, 0, f.D))) return;
    const floors = 2 + (R() < 0.4 ? 1 : 0), fh = 2.9, H = floors * fh, c = PAL_WALL[R() * PAL_WALL.length | 0];
    this.addBox(b.x0, b.z0, b.x1, b.z1); this.stats.buildings++; this.mm.blds.push(b);
    const cars = [];
    for (let k = 0; k < Math.floor((f.F - 2) / 2.6); k++) if (R() < 0.6) { const m = pickModel(R); cars.push([f.W(1.5 + k * 2.6, 2.8), m, pickColor(m, R)]); }
    const yaw = Math.atan2(f.inv[0], f.inv[1]);
    for (const [p, m] of cars) this.addCarBox(p[0], p[1], yaw, m);
    this.add((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, g => {
      g.s.box(b.x0, 0, b.z0, b.x1, H, b.z1, { c, mat: 3, side: { lay: L.APT, tw: 13.6, th: fh * 4 }, top: { lay: L.ROOF, tw: 6 } });
      g.s.box(b.x0 - 0.3, H, b.z0 - 0.3, b.x1 + 0.3, H + 0.35, b.z1 + 0.3, { c: [0.6, 0.6, 0.6] });
      const lr = this.frect(f, 0.5, f.F - 0.5, 0, 5.4);
      g.d1.flat(lr.x0, lr.z0, lr.x1, lr.z1, 0, { c: [0.9, 0.9, 0.9], mat: 7, lay: L.ASPHALT }, 8);
      for (const [p, m, cc] of cars) this.bakeCar(g.s, m, cc, p[0], p[1], yaw);
    });
  }
  tsukiParking(pr, side, R) {
    const f = this.frame(pr, side);
    const lr = this.frect(f, 0.5, f.F - 0.5, 0, Math.min(f.D, 18));
    this.staticLot(f, lr, R, L.SG_TSUKI, 0.6);
  }
  smallShop(pr, side, R) {
    const f = this.frame(pr, side);
    const signs = [L.SG_SHOP1, L.SG_SHOP2, L.SG_SHOP3, L.SG_SHOP4, L.SG_SHOP5, L.SG_SHOP6, L.SG_SHOP7, L.SG_RAMEN, L.SG_CONBINI2];
    this.building(f, 1, f.F - 1, 1.5, Math.min(f.D - 1, 12), { floors: 1, fh: 2.9, lay: L.HOUSE, tw: 7, th: 5.6, glay: L.SHOP, fh0: 3.4, col: PAL_HOUSE[R() * 10 | 0], sign: signs[R() * signs.length | 0], R });
  }
  // 汎用建物（frame座標で配置、正面は道路側）
  building(f, u0, u1, w0, w1, o) {
    const b = this.frect(f, u0, u1, w0, w1), R = o.R;
    if (b.x1 - b.x0 < 2 || b.z1 - b.z0 < 2 || this.railBlock(b)) return null;
    const fh0 = o.fh0 ?? o.fh, H = fh0 + o.floors * o.fh;
    this.addBox(b.x0, b.z0, b.x1, b.z1); this.stats.buildings++; this.mm.blds.push(b);
    const n = [-f.inv[0], 0, -f.inv[1]];
    const items = [];
    if (o.roofItems !== false && H > 8) for (let k = 0; k < 3 + (R() * 4 | 0); k++) items.push([b.x0 + 1.5 + R() * (b.x1 - b.x0 - 3), b.z0 + 1.5 + R() * (b.z1 - b.z0 - 3), 0.8 + R() * 1.5, 0.6 + R() * 1.2, R() < 0.25]);
    const sa = f.W(u0 + (u1 - u0) * 0.12, w0), sb = f.W(u1 - (u1 - u0) * 0.12, w0);
    const signW = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]), signH = Math.min(signW / 4, o.signH || 1.6);
    const sc = f.W((u0 + u1) / 2, w0), tng = [(sb[0] - sa[0]) / signW, (sb[1] - sa[1]) / signW];
    this.add((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, g => {
      if (fh0 > 0 && o.glay != null) g.s.box(b.x0, 0, b.z0, b.x1, fh0, b.z1, { c: o.gcol || [1, 1, 1], mat: 3, side: { lay: o.glay, tw: o.gtw || 6, th: fh0 }, noTop: true });
      g.s.box(b.x0, o.glay != null ? fh0 : 0, b.z0, b.x1, H, b.z1, { c: o.col, mat: 3, side: { lay: o.lay, tw: o.tw, th: o.th }, top: { lay: L.ROOF, tw: 8 } });
      if (o.roof === 'gable') g.s.gable(b.x0, b.z0, b.x1, b.z1, H, o.rise || 2, { c: o.rcol || [0.5, 0.52, 0.55], lay: L.METAL, tw: 3, gc: o.col }, 0.3);
      else if (o.roof === 'saw') {
        const tooth = 8;
        for (let x = b.x0; x < b.x1 - 0.1; x += tooth) {
          const x2 = Math.min(b.x1, x + tooth);
          g.s.quadN([x, H, b.z0], [x, H, b.z1], [x2, H + 3, b.z1], [x2, H + 3, b.z0], [-0.35, 0.94, 0], { c: [0.6, 0.62, 0.64], lay: L.METAL });
          g.s.quadN([x2, H, b.z0], [x2, H, b.z1], [x2, H + 3, b.z1], [x2, H + 3, b.z0], [1, 0, 0], { c: [0.5, 0.65, 0.75], mat: 3, lay: L.OFFICE2 });
        }
      } else if (H > 6) { // パラペット
        g.s.box(b.x0, H, b.z0, b.x1, H + 0.8, b.z0 + 0.25, { c: o.col }); g.s.box(b.x0, H, b.z1 - 0.25, b.x1, H + 0.8, b.z1, { c: o.col });
        g.s.box(b.x0, H, b.z0, b.x0 + 0.25, H + 0.8, b.z1, { c: o.col }); g.s.box(b.x1 - 0.25, H, b.z0, b.x1, H + 0.8, b.z1, { c: o.col });
      }
      for (const [x, z, sx, sz, tank] of items) {
        if (tank) { g.s.cyl(x, H, z, 0.9, 0.5, 6, { c: [0.5, 0.5, 0.5] }); g.s.cyl(x, H + 0.5, z, 1.0, 1.6, 8, { c: [0.85, 0.85, 0.82] }); }
        else g.s.box(x - sx / 2, H, z - sz / 2, x + sx / 2, H + 0.9, z + sz / 2, { c: [0.78, 0.79, 0.8] });
      }
      if (o.sign != null) {
        const y0 = Math.max(0.4, (o.signY ?? fh0) + 0.25), w = Math.min(signW, signH * 4), h = w / 4;
        g.s.panel(sc[0] - tng[0] * w / 2, sc[1] - tng[1] * w / 2, sc[0] + tng[0] * w / 2, sc[1] + tng[1] * w / 2, y0, y0 + h, 0.06, n, { c: [1, 1, 1], mat: 16, lay: o.sign });
      }
      if (o.roofSign != null && H > 10) {
        const w = Math.min(signW * 0.8, 14), h = w / 4;
        g.s.panel(sc[0] - tng[0] * w / 2, sc[1] - tng[1] * w / 2, sc[0] + tng[0] * w / 2, sc[1] + tng[1] * w / 2, H + 1, H + 1 + h, -1.5, n, { c: [1, 1, 1], mat: 16, lay: o.roofSign });
      }
      if (o.awning) { // 庇
        const a = f.W(u0, w0), c2 = f.W(u1, w0 - 1.6);
        g.s.box(Math.min(a[0], c2[0]), fh0 - 0.1, Math.min(a[1], c2[1]), Math.max(a[0], c2[0]), fh0 + 0.1, Math.max(a[1], c2[1]), { c: o.awning });
      }
    });
    return b;
  }
  // 駐車場（静的に駐車車両を焼き込む。aiEdgeがあればNPCが利用できる）
  lot(f, u0, u1, w0, w1, R, opt = {}) {
    const lr = this.frect(f, u0, u1, w0, w1);
    if (this.railBlock(lr)) return null;
    const depth = w1 - w0, rows = Math.max(1, Math.floor((depth - 6) / 11) + (depth >= 12 ? 0 : 0));
    const entU = opt.entU ?? (u0 + u1) / 2;
    const slots = [];
    const yaw = Math.atan2(f.inv[0], f.inv[1]);
    for (let r = 0; r < rows; r++) {
      const band = w0 + 6 + r * 11;
      if (band + 5 > w1 + 0.01) break;
      for (let u = u0 + 1.4; u + 1.3 < u1; u += 2.6) {
        if (Math.abs(u - entU) < 2.6) continue;
        const p = f.W(u, band + 2.5);
        slots.push({ x: p[0], z: p[1], yaw, u, row: r, band, occ: null });
      }
    }
    const L0 = { id: this.lots.length, f, slots, entU, w0, aisle: r => w0 + 3 + r * 11, rect: lr, edge: null, sE: 0 };
    // 静的駐車
    const baked = [];
    for (const s of slots) if (R() < (opt.fill ?? 0.35)) { s.occ = 'static'; const m = pickModel(R); baked.push([s, m, pickColor(m, R)]); this.addCarBox(s.x, s.z, s.yaw, m); }
    this.stats.parked += baked.length;
    this.mm.lots.push(lr);
    this.add((lr.x0 + lr.x1) / 2, (lr.z0 + lr.z1) / 2, g => {
      g.d1.flat(lr.x0, lr.z0, lr.x1, lr.z1, 0, { c: [0.95, 0.95, 0.95], mat: 7, lay: L.ASPHALT }, 8);
      for (const s of slots) {
        for (const du of [-1.3, 1.3]) {
          const a = f.W(s.u + du - 0.06, s.band), b = f.W(s.u + du + 0.06, s.band + 5);
          g.d2.flat(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), 0, { c: WHITE });
        }
        const cs = f.W(s.u, s.band + 4.6); g.s.cbox(cs[0], 0.07, cs[1], f.side === 'n' || f.side === 's' ? 1.4 : 0.2, 0.14, f.side === 'n' || f.side === 's' ? 0.2 : 1.4, { c: [0.7, 0.7, 0.68] });
      }
      for (const [s, m, c] of baked) this.bakeCar(g.s, m, c, s.x, s.z, s.yaw);
      if (opt.sign != null) { const p = f.W(u0 + 1, w0 + 0.5); this.poleSign(g.s, p[0], p[1], f, opt.sign, opt.signH || 4.5); }
    });
    // NPC用：対応する道路エッジ（駐車場が進行方向の左側になる向き）
    if ((opt.ai || opt.bx != null) && w0 < 3) {
      const d = [-f.inv[1], f.inv[0]], ep = f.W(entU, 0);
      let best = null, bo = 1e9, bs = 0;
      for (const e of this.edges) {
        if (!e.straight || e.d[0] * d[0] + e.d[1] * d[1] < 0.99) continue;
        const rx = ep[0] - e.x0, rz = ep[1] - e.z0, sE = rx * e.d[0] + rz * e.d[1], o = rx * e.d[1] - rz * e.d[0];
        if (sE < 14 || sE > e.len - 22 || o < 0 || o > e.sp.ext + 3) continue;
        if (o < bo) { bo = o; best = e; bs = sE; }
      }
      if (best && slots.some(s => !s.occ)) { L0.edge = best; L0.sE = bs; L0.sw = bo - best.sp.hw; best.lots.push(L0); this.stats.lotsAI++; }
    }
    this.lots.push(L0);
    return L0;
  }
  staticLot(f, lr, R, sign, fill) {
    if (this.railBlock(lr)) return;
    const cars = [], yaw = Math.atan2(f.inv[0], f.inv[1]);
    const n = Math.floor((f.F - 1) / 2.6);
    for (let k = 0; k < n; k++) if (R() < fill) { const m = pickModel(R); const p = f.W(1.8 + k * 2.6, Math.min(f.D, 18) - 3); cars.push([p, m, pickColor(m, R)]); this.addCarBox(p[0], p[1], yaw, m); }
    this.stats.parked += cars.length; this.mm.lots.push(lr);
    this.add((lr.x0 + lr.x1) / 2, (lr.z0 + lr.z1) / 2, g => {
      g.d1.flat(lr.x0, lr.z0, lr.x1, lr.z1, 0, { c: [0.85, 0.85, 0.85], mat: 7, lay: L.ASPHALT }, 8);
      for (let k = 0; k <= n; k++) { const a = f.W(0.5 + k * 2.6 - 0.05, Math.min(f.D, 18) - 5.5), b = f.W(0.5 + k * 2.6 + 0.05, Math.min(f.D, 18) - 0.5); g.d2.flat(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), 0, { c: WHITE }); }
      for (const [p, m, c] of cars) this.bakeCar(g.s, m, c, p[0], p[1], yaw);
      if (sign != null) { const p = f.W(0.6, 0.4); this.poleSign(g.s, p[0], p[1], f, sign, 2.6); }
    });
  }
  poleSign(gb, x, z, f, lay, h) {
    gb.cyl(x, 0, z, 0.12, h, 6, { c: [0.6, 0.6, 0.6] });
    const t = [-f.inv[1], f.inv[0]], w = h > 4 ? 3.2 : 2.0, hh = w / 4;
    for (const s of [1, -1]) {
      const n = [t[0] * s, 0, t[1] * s];
      const a = [x - f.inv[0] * w / 2 * s, z - f.inv[1] * w / 2 * s], b = [x + f.inv[0] * w / 2 * s, z + f.inv[1] * w / 2 * s];
      gb.panel(a[0], a[1], b[0], b[1], h, h + hh, 0.06, n, { c: [1, 1, 1], mat: 16, lay });
    }
    gb.box(x - 0.1 - Math.abs(f.inv[0]) * w / 2, h - 0.05, z - 0.1 - Math.abs(f.inv[1]) * w / 2, x + 0.1 + Math.abs(f.inv[0]) * w / 2, h + hh + 0.05, z + 0.1 + Math.abs(f.inv[1]) * w / 2, { c: [0.3, 0.3, 0.3], noTop: false });
    this.addBox(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 'p');
  }
  railBlock(b) { return b.z0 < -438 && b.z1 > -452; }
  addCarBox(x, z, yaw, m) {
    const c = Math.abs(Math.cos(yaw)) > 0.5, hl = m.L / 2, hw = m.W / 2;
    this.addBox(x - (c ? hw : hl), z - (c ? hl : hw), x + (c ? hw : hl), z + (c ? hl : hw), 'c');
  }
  bakeCar(gb, m, c, x, z, yaw, y = 0) { gb.setXf(x, y, z, yaw); buildCar(m, gb, { paint: c.rgb, lod: 1 }); gb.clearXf(); }

  genApt(B) {
    const R = B.R, mx = (B.x0 + B.x1) / 2;
    for (const [r, side] of [[{ x0: B.x0, x1: mx, z0: B.z0, z1: B.z1 }, 'w'], [{ x0: mx, x1: B.x1, z0: B.z0, z1: B.z1 }, 'e']]) {
      const f = this.frame(r, side), half = f.F / 2;
      for (let k = 0; k < 2; k++) {
        if (R() < 0.7) {
          const floors = 5 + (R() * 7 | 0);
          this.building(f, k * half + 4, (k + 1) * half - 4, 16, f.D - 3, { floors, fh: 2.95, fh0: 0, lay: L.MANSION, tw: 13.6, th: 11.8, col: PAL_WALL[R() * 10 | 0], R });
          this.lot(f, k * half + 2, (k + 1) * half - 2, 0, 13, R, { fill: 0.55 });
        } else {
          this.fillParcels(this.frect(f, k * half, (k + 1) * half, 0, f.D), side, R);
        }
      }
    }
  }
  genOffice(B) {
    const R = B.R, W = B.x1 - B.x0, D = B.z1 - B.z0;
    const signs = [L.SG_OFFICE_A, L.SG_OFFICE_B, L.SG_BANK, L.SG_HOTEL, L.SG_DEPT, null, null];
    const gsigns = [L.SG_CONBINI2, L.SG_RAMEN, L.SG_SHOP3, L.SG_SHOP5, L.SG_SHOP4, L.SG_BURGER, null];
    const cw = W / 3, cd = D / 3;
    const central = Math.abs(B.bx - 3.5) < 1.6 && B.bz < 4;
    let coin = R() < 0.6 ? (R() * 9 | 0) : -1;
    for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
      if (a === 1 && c === 1) continue;
      const r = { x0: B.x0 + c * cw, x1: B.x0 + (c + 1) * cw, z0: B.z0 + a * cd, z1: B.z0 + (a + 1) * cd };
      const side = a === 0 ? 'n' : a === 2 ? 's' : c === 0 ? 'w' : 'e';
      const f = this.frame(r, side);
      if (a * 3 + c === coin) { this.lot(f, 1, f.F - 1, 0, Math.min(f.D, 17), R, { fill: 0.5, sign: L.SG_COINP, signH: 3 }); continue; }
      const floors = central ? 5 + (R() * 9 | 0) : 3 + (R() * 6 | 0);
      const kind = R(), sg = signs[R() * signs.length | 0];
      const lay = sg === L.SG_HOTEL ? L.HOTEL : kind < 0.5 ? L.OFFICE : L.OFFICE2;
      this.building(f, 1.5, f.F - 1.5, 1.0, f.D - (a === 1 ? 1 : 6), { floors, fh: 3.6, fh0: 4.0, lay, tw: lay === L.HOTEL ? 14 : 14, th: 14.4, glay: L.SHOP, col: PAL_WALL[R() * 10 | 0], gcol: [0.9, 0.9, 0.9], sign: gsigns[R() * gsigns.length | 0], roofSign: sg, signY: 4.0, R });
    }
    // 中央：中庭・駐車場
    const r = { x0: B.x0 + cw, x1: B.x0 + 2 * cw, z0: B.z0 + cd, z1: B.z0 + 2 * cd };
    this.add((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, g => { for (let k = 0; k < 4; k++) this.tree(g.s, r.x0 + 6 + k * (cw - 12) / 3, (r.z0 + r.z1) / 2, rng(k + B.bx)); });
  }
  genShotengai(B, side) {
    const R = B.R, f = this.frame(B, side);
    const signs = [L.SG_SHOP1, L.SG_SHOP2, L.SG_SHOP3, L.SG_SHOP4, L.SG_SHOP5, L.SG_SHOP6, L.SG_SHOP7, L.SG_RAMEN, L.SG_CONBINI2, L.SG_DRUG, L.SG_BANK];
    let u = 1;
    while (u < f.F - 6) {
      const w = 6 + R() * 4, floors = 1 + (R() * 3 | 0);
      this.building(f, u, Math.min(u + w, f.F - 1), 0.3, 12, { floors, fh: 2.9, fh0: 3.6, lay: R() < 0.5 ? L.APT : L.HOUSE, tw: R() < 0.5 ? 13.6 : 7, th: 11.6, glay: R() < 0.8 ? L.SHOP : L.SHUTTER, col: PAL_HOUSE[R() * 10 | 0], sign: signs[R() * signs.length | 0], signY: 3.7, awning: [0.75, 0.2, 0.2], R, roofItems: false });
      u += w + 0.4;
    }
    // アーケード風の連続庇と柱
    const rd = RS.ns[side === 'e' ? B.bx + 1 : B.bx];
    const a = f.W(0, -rd.sw + 0.2), b = f.W(f.F, 0);
    this.add((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, g => {
      g.s.box(Math.min(a[0], b[0]), 3.3, Math.min(a[1], b[1]), Math.max(a[0], b[0]), 3.45, Math.max(a[1], b[1]), { c: [0.85, 0.85, 0.8] });
      for (let k = 2; k < f.F; k += 6) { const p = f.W(k, -rd.sw + 0.35); g.s.cyl(p[0], 0, p[1], 0.08, 3.3, 6, { c: [0.6, 0.6, 0.6] }); }
    });
    for (let k = 2; k < f.F; k += 6) { const p = f.W(k, -rd.sw + 0.35); this.addBox(p[0] - 0.1, p[1] - 0.1, p[0] + 0.1, p[1] + 0.1, 'p'); }
    // 商店街ゲート（道路をまたぐ看板）
    if (side === 'w') for (const gz of [B.z0 + 4, B.z1 - 4]) {
      const x = LINES[B.bx], hw = rd.ext + 0.3;
      this.add(x, gz, g => {
        for (const s of [-1, 1]) g.s.cbox(x + s * hw, 3.2, gz, 0.4, 6.4, 0.4, { c: [0.7, 0.15, 0.15] });
        g.s.cbox(x, 6.6, gz, hw * 2 + 0.6, 1.4, 0.3, { c: [0.7, 0.15, 0.15] });
        for (const s of [1, -1]) g.s.panel(x - s * 4.4, gz, x + s * 4.4, gz, 5.95, 7.25, 0.16, [0, 0, s], { c: [1, 1, 1], mat: 16, lay: L.SG_SHOTEN });
      });
      for (const s of [-1, 1]) this.addBox(x + s * hw - 0.2, gz - 0.2, x + s * hw + 0.2, gz + 0.2, 'p');
    }
    // 裏側は住宅
    const back = this.frect(f, 0, f.F, 14, f.D);
    const bs = side === 'e' ? 'w' : 'e';
    this.fillParcels(back, bs, R);
  }
  genStation(B) {
    const R = B.R, f = this.frame(B, 's');
    // 高架駅舎（1階コンコース）
    this.building(f, 8, f.F - 8, 34, 52, { floors: 1, fh: 6.2, fh0: 0, lay: L.OFFICE2, tw: 16, th: 6.2, col: [0.86, 0.86, 0.84], sign: L.SG_STATION, signY: 4.2, signH: 2.6, R, roofItems: false });
    // 駅前ロータリー（時計回り）
    const cu = f.F / 2, cw = 17, c = f.W(cu, cw), RO = 15, RI = 6;
    const dr = this.frect(f, cu - 12, cu + 12, -4, 6);
    this.mm.lots.push(dr, this.frect(f, cu - RO, cu + RO, cw - RO, cw + RO));
    this.add(c[0], c[1], g => {
      g.d1.flat(dr.x0, dr.z0, dr.x1, dr.z1, 0, { c: [0.95, 0.95, 0.95], mat: 7, lay: L.ASPHALT }, 8);
      for (let k = 0; k < 32; k++) {
        const a0 = k / 32 * Math.PI * 2, a1 = (k + 1) / 32 * Math.PI * 2;
        g.d1.tri([c[0], 0, c[1]], [c[0] + Math.cos(a0) * RO, 0, c[1] + Math.sin(a0) * RO], [c[0] + Math.cos(a1) * RO, 0, c[1] + Math.sin(a1) * RO], { c: [0.95, 0.95, 0.95], mat: 7, lay: L.ASPHALT }, [c[0] / 8, c[1] / 8], [(c[0] + Math.cos(a0) * RO) / 8, (c[1] + Math.sin(a0) * RO) / 8], [(c[0] + Math.cos(a1) * RO) / 8, (c[1] + Math.sin(a1) * RO) / 8], [c[0], -1, c[1]]);
        // 外周の白線
        const p = (a, r) => [c[0] + Math.cos(a) * r, 0, c[1] + Math.sin(a) * r];
        if (k % 2 === 0) g.d2.quadN(p(a0, RO - 0.5), p(a1, RO - 0.5), p(a1, RO - 0.35), p(a0, RO - 0.35), [0, 1, 0], { c: WHITE });
      }
      g.s.cyl(c[0], 0, c[1], RI, 0.25, 24, { c: [0.75, 0.74, 0.7] });
      g.s.cyl(c[0], 0.25, c[1], RI - 0.4, 0.02, 24, { c: [0.45, 0.65, 0.35], lay: L.GRASS });
      g.s.cyl(c[0], 0, c[1], 0.15, 5.5, 8, { c: [0.3, 0.3, 0.3] }); // 時計塔
      g.s.cbox(c[0], 5.9, c[1], 0.9, 0.9, 0.9, { c: [0.95, 0.95, 0.92] });
      for (let k = 0; k < 4; k++) this.tree(g.s, c[0] + Math.cos(k * 1.57 + 0.6) * 3.6, c[1] + Math.sin(k * 1.57 + 0.6) * 3.6, rng(k + 3));
      // タクシー乗り場の標識・上屋
      const t = f.W(cu - 4, cw + RO + 1.5), t2 = f.W(cu + 8, cw + RO + 3);
      this.poleSign(g.s, t[0], t[1], f, L.SG_TAXI, 2.6);
      g.s.box(Math.min(t[0], t2[0]), 3.0, Math.min(t[1], t2[1]), Math.max(t[0], t2[0]) + 4, 3.2, Math.max(t[1], t2[1]), { c: [0.55, 0.6, 0.62] });
    });
    this.addBox(c[0] - RI + 0.6, c[1] - RI + 0.6, c[0] + RI - 0.6, c[1] + RI - 0.6, 'w', -50, 0.6);
    // 周回経路（地図上で時計回り：北→東→南→西）
    const pts = []; const rr = 10.5;
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; pts.push([c[0] + Math.sin(a) * rr, c[1] - Math.cos(a) * rr]); }
    const taxi = MODELS.find(m => m.name === 'クラウン'), ha = MODELS.find(m => m.name === 'ハイエース');
    this.loops.push({ pts, stops: [0], cars: [{ m: taxi, rgb: [0.85, 0.7, 0.2] }, { m: taxi, rgb: [0.1, 0.1, 0.12] }, { m: ha, rgb: [0.95, 0.95, 0.95] }] });
    this.staticLot(this.frame(this.frect(f, 0, f.F, 72, f.D), 's'), this.frect(f, 4, f.F - 4, 72, f.D - 2), R, L.SG_COINP, 0.5);
  }
  genBus(B) {
    const R = B.R, f = this.frame(B, 's');
    const lr = this.frect(f, 4, f.F - 30, 0, 40);
    this.add((lr.x0 + lr.x1) / 2, (lr.z0 + lr.z1) / 2, g => {
      g.d1.flat(lr.x0, lr.z0, lr.x1, lr.z1, 0, { c: [0.9, 0.9, 0.9], mat: 7, lay: L.ASPHALT }, 8);
      for (let k = 0; k < 4; k++) { // バス乗り場の上屋
        const p0 = f.W(10 + k * 20, 14), p1 = f.W(22 + k * 20, 17);
        g.s.box(Math.min(p0[0], p1[0]), 3.2, Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), 3.4, Math.max(p0[1], p1[1]), { c: [0.4, 0.55, 0.5] });
        for (const t of [0.15, 0.85]) { const q = f.W(10 + k * 20 + t * 12, 15.5); g.s.cyl(q[0], 0, q[1], 0.08, 3.2, 6, { c: [0.6, 0.6, 0.6] }); }
        // バス（静的）
        const bp = f.W(16 + k * 20, 8.5);
        this.bus(g.s, bp[0], bp[1], Math.PI / 2 * (f.side === 's' ? 1 : 1), k);
      }
    });
    for (let k = 0; k < 4; k++) { const bp = f.W(16 + k * 20, 8.5); this.addBox(bp[0] - 5.5, bp[1] - 1.3, bp[0] + 5.5, bp[1] + 1.3, 'c'); }
    this.building(f, f.F - 28, f.F - 3, 2, 22, { floors: 2, fh: 3.5, fh0: 3.8, lay: L.OFFICE2, tw: 16, th: 14, glay: L.SHOP, col: [0.85, 0.88, 0.86], sign: L.SG_BUS, R });
    this.fillParcels(this.frect(f, 0, f.F, 46, f.D), 's', R);
  }
  bus(gb, x, z, yaw, k) {
    gb.setXf(x, 0, z, yaw);
    const c = k % 2 ? [0.15, 0.55, 0.35] : [0.85, 0.85, 0.82];
    gb.box(-1.25, 0.35, -5.4, 1.25, 3.0, 5.4, { c, side: { lay: L.TRAINWIN, tw: 3.5, th: 3.0 } });
    gb.box(-1.24, 1.2, 5.38, 1.24, 2.8, 5.42, { c: [0.15, 0.18, 0.22] });
    for (const zz of [-3.6, 3.6]) for (const s of [1, -1]) gb.cylX(s * 1.1, 0.48, zz, 0.48, 0.3, 8, { c: [0.08, 0.08, 0.08] });
    gb.clearXf();
  }
  // 沿道商業：道路側に駐車場、その奥に店舗
  genRoadside(B, side) {
    const R = B.R, f = this.frame(B, side);
    const sets = { '5,3': ['CONBINI', 'DRUG', 'FAMIRES'], '6,3': ['GAS', 'BURGER', 'DEALER'], '7,3': ['PACHI', 'RAMEN', 'CONBINI2'], '5,4': ['DENKI', 'CONBINI'], '6,4': ['HOMEC'], '7,4': ['SUPER', 'DRUG'] };
    const list = sets[B.bx + ',' + B.bz] || ['CONBINI'];
    const seg = f.F / list.length;
    list.forEach((k, i) => {
      const u0 = i * seg, u1 = (i + 1) * seg, big = ['DENKI', 'HOMEC', 'SUPER', 'PACHI'].includes(k);
      const ld = big ? 34 : 22, bd = big ? 32 : 16;
      const sign = L['SG_' + k];
      if (k === 'GAS') {
        const c0 = f.W(u0 + 6, 5), c1 = f.W(u1 - 6, 17);
        const cr = { x0: Math.min(c0[0], c1[0]), x1: Math.max(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]), z1: Math.max(c0[1], c1[1]) };
        const lr = this.frect(f, u0 + 1, u1 - 1, 0, 24);
        this.mm.lots.push(lr);
        this.add((cr.x0 + cr.x1) / 2, (cr.z0 + cr.z1) / 2, g => {
          g.d1.flat(lr.x0, lr.z0, lr.x1, lr.z1, 0, { c: [0.9, 0.9, 0.88], mat: 7, lay: L.ASPHALT }, 8);
          g.s.box(cr.x0, 5.2, cr.z0, cr.x1, 6.2, cr.z1, { c: [0.95, 0.95, 0.95], mat: 8 });
          for (const t of [0.25, 0.75]) for (const q of [0.3, 0.7]) { const p = [cr.x0 + (cr.x1 - cr.x0) * t, cr.z0 + (cr.z1 - cr.z0) * q]; g.s.cbox(p[0], 2.6, p[1], 0.4, 5.2, 0.4, { c: [0.9, 0.9, 0.9] }); g.s.cbox(p[0] + 0.8, 0.8, p[1], 0.7, 1.6, 0.5, { c: [0.1, 0.35, 0.75] }); }
          const n = [-f.inv[0], 0, -f.inv[1]], a = f.W(u0 + 7, 5), b = f.W(u1 - 7, 5);
          g.s.panel(a[0], a[1], b[0], b[1], 5.25, 6.15, 0.05, n, { c: [1, 1, 1], mat: 16, lay: sign });
          g.glow.flat(cr.x0, cr.z0, cr.x1, cr.z1, 0.07, { c: [0.9, 0.9, 1.0], mat: 5, lay: L.GLOW });
        });
        for (const t of [0.25, 0.75]) for (const q of [0.3, 0.7]) { const p = [cr.x0 + (cr.x1 - cr.x0) * t, cr.z0 + (cr.z1 - cr.z0) * q]; this.addBox(p[0] - 0.3, p[1] - 0.3, p[0] + 1.2, p[1] + 0.3, 'p'); }
        this.building(f, u0 + 6, u1 - 6, 26, 36, { floors: 1, fh: 3.6, lay: L.SHOP, tw: 6, th: 3.6, col: [0.92, 0.92, 0.92], R, roofItems: false });
        const pp = f.W(u0 + 1.5, 1.2); this.add(pp[0], pp[1], g => this.poleSign(g.s, pp[0], pp[1], f, sign, 6.5));
        return;
      }
      this.lot(f, u0 + 1, u1 - 1, 0, ld, R, { fill: k === 'DEALER' ? 0.9 : 0.25, bx: B.bx, bz: B.bz, sign: k === 'DEALER' ? null : sign, signH: 6 });
      this.building(f, u0 + 3, u1 - 3, ld + 1, ld + 1 + bd, { floors: 1, fh: big ? 7 : 4.2, fh0: 0, lay: big ? L.METAL : L.SHOP, tw: 6, th: big ? 7 : 4.2, glay: big ? L.SHOP : null, col: big ? [0.88, 0.88, 0.86] : [0.95, 0.95, 0.95], sign, signY: big ? 4.4 : 2.9, signH: big ? 3.2 : 1.6, R, roofItems: big });
    });
    const used = 34 + 33 + 4;
    if (f.D - used > 18) this.fillParcels(this.frect(f, 0, f.F, used, f.D), side === 's' ? 'n' : 's', R);
  }
  genFacility(B, t, side) {
    const R = B.R, f = this.frame(B, side);
    const P = { R, roofItems: true };
    if (t === 'C') { // 市役所
      this.building(f, 14, f.F - 14, 40, 70, { ...P, floors: 6, fh: 3.8, fh0: 4.5, lay: L.OFFICE2, tw: 16, th: 15.2, glay: L.SHOP, col: [0.82, 0.8, 0.74], sign: L.SG_CITY, signY: 4.6, signH: 2.2 });
      this.lot(f, 4, f.F - 4, 0, 34, R, { fill: 0.4, bx: B.bx, bz: B.bz, sign: L.PARK_P });
      this.fillParcels(this.frect(f, 0, f.F, 74, f.D), side === 's' ? 'n' : 's', R, { housesOnly: false });
    } else if (t === 'P') { // 郵便局・銀行
      this.building(f, 2, 30, 18, 38, { ...P, floors: 1, fh: 3.6, fh0: 4, lay: L.OFFICE2, tw: 16, th: 14.4, glay: L.SHOP, col: [0.92, 0.9, 0.86], sign: L.SG_POST, signY: 4.1 });
      this.lot(f, 2, 30, 0, 16, R, { fill: 0.3 });
      this.building(f, 34, 60, 2, 30, { ...P, floors: 3, fh: 3.6, fh0: 4.2, lay: L.OFFICE, tw: 14, th: 14.4, glay: L.SHOP, col: [0.75, 0.78, 0.76], sign: L.SG_BANK, signY: 4.3 });
      this.building(f, 64, f.F - 2, 2, 40, { ...P, floors: 7, fh: 3.6, fh0: 4.2, lay: L.OFFICE, tw: 14, th: 14.4, glay: L.SHOP, col: [0.86, 0.86, 0.86], sign: L.SG_CONBINI2, roofSign: L.SG_OFFICE_B, signY: 4.3 });
      this.genOfficeBack(f, R, 44);
    } else if (t === 'K') { // 警察署
      this.building(f, 10, 60, 18, 44, { ...P, floors: 4, fh: 3.6, fh0: 4, lay: L.OFFICE, tw: 14, th: 14.4, glay: L.SHOP, col: [0.85, 0.85, 0.82], sign: L.SG_POLICE, signY: 4.1 });
      this.lot(f, 10, 60, 0, 16, R, { fill: 0.5 });
      this.building(f, 66, f.F - 4, 4, 36, { ...P, floors: 6, fh: 2.95, fh0: 0, lay: L.MANSION, tw: 13.6, th: 11.8, col: PAL_WALL[3] });
      this.fillParcels(this.frect(f, 0, f.F, 50, f.D), side === 's' ? 'n' : 's', R);
    } else if (t === 'F') { // 消防署
      const b = this.building(f, 8, 44, 10, 30, { ...P, floors: 2, fh: 3.4, fh0: 5, lay: L.OFFICE2, tw: 16, th: 13.6, glay: L.SHUTTER, gtw: 4, gcol: [0.85, 0.2, 0.2], col: [0.9, 0.9, 0.88], sign: L.SG_FIRE, signY: 5.2 });
      if (b) { const tx = b.x1 - 3, tz = (b.z0 + b.z1) / 2; this.add(tx, tz, g => g.s.box(tx - 1.5, 0, tz - 1.5, tx + 1.5, 22, tz + 1.5, { c: [0.85, 0.2, 0.2] })); }
      const fr = this.frect(f, 8, 44, 0, 10); this.add((fr.x0 + fr.x1) / 2, (fr.z0 + fr.z1) / 2, g => g.d1.flat(fr.x0, fr.z0, fr.x1, fr.z1, 0, { c: [0.9, 0.9, 0.9], mat: 7, lay: L.ASPHALT }, 8));
      this.fillParcels(this.frect(f, 50, f.F, 0, f.D / 2), side, R);
      this.fillParcels(this.frect(f, 0, f.F, f.D / 2, f.D), side === 's' ? 'n' : 's', R);
    } else if (t === 'E') { // 学校
      const fr = this.frect(f, 6, f.F - 6, 4, 60);
      this.mm.lots.push(fr);
      this.add((fr.x0 + fr.x1) / 2, (fr.z0 + fr.z1) / 2, g => {
        g.d1.flat(fr.x0, fr.z0, fr.x1, fr.z1, 0, { c: [1, 1, 1], lay: L.FIELD }, 4);
        // 外周フェンス
        g.s.box(fr.x0, 0, fr.z0, fr.x1, 1.8, fr.z0 + 0.06, { c: [0.3, 0.5, 0.35] }); g.s.box(fr.x0, 0, fr.z1 - 0.06, fr.x1, 1.8, fr.z1, { c: [0.3, 0.5, 0.35] });
        g.s.box(fr.x0, 0, fr.z0, fr.x0 + 0.06, 1.8, fr.z1, { c: [0.3, 0.5, 0.35] }); g.s.box(fr.x1 - 0.06, 0, fr.z0, fr.x1, 1.8, fr.z1, { c: [0.3, 0.5, 0.35] });
        for (let k = 0; k < 8; k++) this.tree(g.s, fr.x0 + 4 + k * (fr.x1 - fr.x0 - 8) / 7, fr.z0 + 2, rng(k * 3));
      });
      this.addBox(fr.x0, fr.z0, fr.x1, fr.z0 + 0.1, 'w'); this.addBox(fr.x0, fr.z1 - 0.1, fr.x1, fr.z1, 'w');
      this.addBox(fr.x0, fr.z0, fr.x0 + 0.1, fr.z1, 'w'); this.addBox(fr.x1 - 0.1, fr.z0, fr.x1, fr.z1, 'w');
      this.building(f, 6, f.F - 30, 66, 80, { ...P, floors: 4, fh: 3.6, fh0: 0, lay: L.OFFICE2, tw: 16, th: 14.4, col: [0.92, 0.9, 0.84], sign: L.SG_SCHOOL, signY: 10, signH: 2 });
      this.building(f, f.F - 26, f.F - 4, 64, 90, { ...P, floors: 1, fh: 8, fh0: 0, lay: L.METAL, tw: 6, th: 8, col: [0.8, 0.85, 0.9], roof: 'gable', rise: 3, rcol: [0.35, 0.45, 0.6], roofItems: false });
    } else if (t === 'U') { // スーパー＋ドラッグストア
      this.lot(f, 2, 62, 0, 30, R, { fill: 0.3, bx: B.bx, bz: B.bz, sign: L.SG_SUPER, signH: 6, entU: 32 });
      this.building(f, 4, 60, 31, 62, { ...P, floors: 1, fh: 6, fh0: 0, lay: L.METAL, tw: 6, th: 6, glay: null, col: [0.95, 0.93, 0.88], sign: L.SG_SUPER, signY: 3.6, signH: 2.5 });
      this.lot(f, 66, f.F - 2, 0, 22, R, { fill: 0.3, sign: L.SG_DRUG, signH: 5 });
      this.building(f, 68, f.F - 4, 23, 42, { ...P, floors: 1, fh: 4.5, fh0: 0, lay: L.SHOP, tw: 6, th: 4.5, col: [0.95, 0.95, 0.95], sign: L.SG_DRUG, signY: 2.9 });
      this.fillParcels(this.frect(f, 0, f.F, 66, f.D), side === 's' ? 'n' : 's', R);
    } else if (t === 'Q') { // 病院
      this.building(f, 30, f.F - 6, 24, 70, { ...P, floors: 7, fh: 3.5, fh0: 4.5, lay: L.HOTEL, tw: 14, th: 14, glay: L.SHOP, col: [0.95, 0.95, 0.94], sign: L.SG_HOSP, signY: 4.6, roofSign: L.SG_HOSP, signH: 2.2 });
      this.lot(f, 2, f.F - 2, 0, 22, R, { fill: 0.45, bx: B.bx, bz: B.bz, sign: L.PARK_P, entU: 14 });
      this.lot(f, 2, 28, 24, 70, R, { fill: 0.6 });
      this.fillParcels(this.frect(f, 0, f.F, 76, f.D), side === 'w' ? 'e' : 'w', R);
    } else if (t === 'M') { // 大型ショッピングセンター
      this.lot(f, 2, f.F - 2, 0, 50, R, { fill: 0.3, bx: B.bx, bz: B.bz, sign: L.SG_MALL, signH: 8 });
      this.building(f, 6, f.F - 6, 52, f.D - 3, { ...P, floors: 3, fh: 4.5, fh0: 0, lay: L.METAL, tw: 6, th: 13.5, col: [0.93, 0.92, 0.9], sign: L.SG_MALL, signY: 8, signH: 3.5 });
    } else if (t === 'N') { // ホームセンター・家電量販店
      this.lot(f, 2, 56, 0, 40, R, { fill: 0.25, bx: B.bx, bz: B.bz, sign: L.SG_HOMEC, signH: 7 });
      this.building(f, 4, 54, 42, f.D - 4, { ...P, floors: 1, fh: 8, fh0: 0, lay: L.METAL, tw: 6, th: 8, col: [0.9, 0.9, 0.88], sign: L.SG_HOMEC, signY: 4.5, signH: 3 });
      this.lot(f, 60, f.F - 2, 0, 34, R, { fill: 0.25, sign: L.SG_DENKI, signH: 7 });
      this.building(f, 62, f.F - 4, 36, f.D - 4, { ...P, floors: 2, fh: 4.5, fh0: 0, lay: L.METAL, tw: 6, th: 9, col: [0.92, 0.92, 0.92], sign: L.SG_DENKI, signY: 5, signH: 3 });
    } else if (t === 'I') { // 工業団地
      for (let k = 0; k < 2; k++) {
        const r = { x0: B.x0, x1: B.x1, z0: B.z0 + k * (B.z1 - B.z0) / 2, z1: B.z0 + (k + 1) * (B.z1 - B.z0) / 2 };
        const ff = this.frame(r, k ? 's' : 'n');
        if (R() < 0.5) this.building(ff, 4, ff.F * 0.6, 14, ff.D - 4, { ...P, floors: 1, fh: 7, fh0: 0, lay: L.METAL, tw: 6, th: 7, col: [0.85, 0.87, 0.86], roof: 'saw', sign: L.SG_FACTORY, signY: 4, roofItems: false });
        else this.building(ff, 4, ff.F * 0.6, 14, ff.D - 4, { ...P, floors: 1, fh: 9, fh0: 0, lay: L.METAL, tw: 6, th: 9, col: [0.78, 0.8, 0.82], roof: 'gable', rise: 1.5, sign: L.SG_SOKO, signY: 6, roofItems: false });
        this.lot(ff, ff.F * 0.62, ff.F - 2, 0, ff.D - 4, R, { fill: 0.5 });
        const tr = this.frect(ff, 4, ff.F * 0.6, 0, 12);
        this.add((tr.x0 + tr.x1) / 2, (tr.z0 + tr.z1) / 2, g => g.d1.flat(tr.x0, tr.z0, tr.x1, tr.z1, 0, { c: [0.85, 0.85, 0.85], mat: 7, lay: L.ASPHALT }, 8));
      }
    }
  }
  genOfficeBack(f, R, w0) {
    const n = 3, pw = f.F / n;
    for (let k = 0; k < n; k++) this.building(f, k * pw + 2, (k + 1) * pw - 2, w0, f.D - 2, { R, floors: 3 + (R() * 5 | 0), fh: 3.6, fh0: 0, lay: R() < 0.5 ? L.OFFICE : L.APT, tw: 14, th: 14.4, col: PAL_WALL[R() * 10 | 0] });
  }
  // ---------- 郊外・河川・山・鉄道 ----------
}
