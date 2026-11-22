// 都市の拡張部分（フェーズ4）：山間部（みなせ峠・トンネル）、地形、バイパス高架、河川と橋、
// 郊外住宅地・工業団地・郊外ロードサイド・田園・河川敷、鉄道、路面電車
import { roadExtras } from './props.js';
import { farmV4, townExtras, shadowsAndFar, cherry, cemetery, farmCenter } from './extras.js';
import { GB } from './geo.js';
import { L } from './textures.js';
import { rng, clamp } from './math.js';
import { pickModel, pickColor, MODELS } from './carmodels.js';
import { LINES, XL, BYP_X, bypY, mkSpec, polyInfo, WHITE, YEL, PAL_HOUSE, PAL_ROOF, PAL_WALL } from './city.js';

const TX0 = -2600, TX1 = 2600, TZ0 = -2600, TZ1 = -1000, TS = 10; // 地形グリッド
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// 自然地形の高さ
export function natH(x, z) {
  if (z >= -1000) return 0;
  const t = smooth((-z - 1000) / 700);
  const hills = (18 * Math.sin(x / 137 + 1.3) * Math.cos(z / 161) + 10 * Math.sin((x - z) / 71) + 6 * Math.sin(x / 37) * Math.sin(z / 43)) * t;
  const ridge = 105 * Math.exp(-((x / 170) ** 2)) * smooth((-z - 1450) / 180);
  const edge = Math.max(0, Math.abs(x) - 1800) * 0.25 * t;
  return 115 * t + hills + ridge + edge;
}
// 山道の制御点（左側：x=-500 から登り、トンネルを抜けて x=500 へ下る）
const MCP = [[-500, -1000], [-500, -1060], [-540, -1150], [-680, -1230], [-760, -1330], [-640, -1400], [-500, -1420], [-470, -1500], [-560, -1570], [-430, -1650], [-260, -1690], [-170, -1692], [-60, -1692], [60, -1692], [170, -1692], [260, -1682], [420, -1620], [540, -1530], [430, -1450], [560, -1380], [700, -1290], [650, -1180], [540, -1110], [500, -1060], [500, -1000]];

function catmull(cp, step) {
  const out = [];
  for (let i = 0; i < cp.length - 1; i++) {
    const p0 = cp[Math.max(0, i - 1)], p1 = cp[i], p2 = cp[i + 1], p3 = cp[Math.min(cp.length - 1, i + 2)];
    const n = Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(cp[cp.length - 1].slice());
  return out;
}

export function buildWorld(city, phase) {
  if (phase === 'pre') return pre(city);
  return post(city);
}

// ============ 前処理：山道・地形・バイパス・橋 ============
function pre(city) {
  const sp = mkSpec('mtn', 'ns', 0), hw = sp.hw;
  // --- 山道の中心線と高さ ---
  const P = catmull(MCP, 5);
  const pi0 = polyInfo(P.map(p => [p[0], p[1], 0]));
  const N = P.length, cum = pi0.cum;
  const inTun = i => Math.abs(P[i][0]) <= 150 && Math.abs(P[i][1] + 1692) < 12;
  let y = P.map(p => natH(p[0], p[1]));
  // 平滑化（トンネル部を除く）
  for (let pass = 0; pass < 3; pass++) {
    const ny = y.slice();
    for (let i = 0; i < N; i++) { if (inTun(i)) continue; let s = 0, n = 0; for (let k = -18; k <= 18; k++) { const j = i + k; if (j >= 0 && j < N && !inTun(j)) { s += y[j]; n++; } } ny[i] = s / n; }
    y = ny;
  }
  let ta = -1, tb = -1; for (let i = 0; i < N; i++) if (inTun(i)) { if (ta < 0) ta = i; tb = i; }
  for (let i = ta; i <= tb; i++) y[i] = y[ta - 1] + (y[tb + 1] - y[ta - 1]) * (cum[i] - cum[ta - 1]) / (cum[tb + 1] - cum[ta - 1]);
  y[0] = 0; y[N - 1] = 0;
  // 勾配を最大9%に
  // 勾配の上限（入口150mは3%、300mまで5%、それ以外6.5%）。両端を0に固定してから前後に制限をかけ、収束するまで繰り返す
  const gm = i => (cum[i] < 150 || cum[N - 1] - cum[i] < 150) ? 0.03 : (cum[i] < 300 || cum[N - 1] - cum[i] < 300) ? 0.05 : 0.065;
  for (let it = 0; it < 12; it++) {
    y[0] = 0; y[N - 1] = 0;
    for (let i = 1; i < N; i++) { const g = (cum[i] - cum[i - 1]) * gm(i); y[i] = clamp(y[i], y[i - 1] - g, y[i - 1] + g); }
    y[N - 1] = 0;
    for (let i = N - 2; i >= 0; i--) { const g = (cum[i + 1] - cum[i]) * gm(i); y[i] = clamp(y[i], y[i + 1] - g, y[i + 1] + g); }
  }
  y[0] = 0; y[N - 1] = 0;
  // 入口の縦断曲線：最初と最後の150mを滑らかな曲線（S字）でつなぐ
  for (const end of [0, 1]) {
    const idx = i => end ? N - 1 - i : i, dist = i => end ? cum[N - 1] - cum[idx(i)] : cum[idx(i)];
    let k = 0; while (k < N - 1 && dist(k) < 150) k++;
    const yk = y[idx(k)], Lk = dist(k) || 1;
    for (let i = 0; i < k; i++) { const t = dist(i) / Lk; y[idx(i)] = yk * t * t * (3 - 2 * t); }
  }
  const full = P.map((p, i) => [p[0], p[1], y[i]]);
  const mtn = { full, cum, ta: cum[ta] - 4, tb: cum[tb] + 4, hw };
  city.mtn = mtn;
  // ネットワークに追加
  const A = city.nodeAt(-500, -1000), B = city.nodeAt(500, -1000);
  A.mtnNS = true; B.mtnNS = true;
  city.pendingSegs.push({ A, B, road: { axis: 'ns', c: 0, a: 0, b: 0, sp }, full, tunnel: [[mtn.ta, mtn.tb]] });
  city.finalizeNetwork();
  // 山道の空間ハッシュ（地面判定・伐採・植林用）
  const mh = new Map(), segs = [];
  for (let i = 0; i < N - 1; i++) {
    const s = { a: full[i], b: full[i + 1], s0: cum[i], s1: cum[i + 1], tun: inTun(i) && inTun(i + 1) };
    segs.push(s);
    for (let gx = Math.floor(Math.min(s.a[0], s.b[0]) / 50) - 1; gx <= Math.floor(Math.max(s.a[0], s.b[0]) / 50) + 1; gx++)
      for (let gz = Math.floor(Math.min(s.a[1], s.b[1]) / 50) - 1; gz <= Math.floor(Math.max(s.a[1], s.b[1]) / 50) + 1; gz++) {
        const k = gx * 9973 + gz; let a = mh.get(k); if (!a) mh.set(k, a = []); a.push(s);
      }
  }
  const nearest = (x, z) => {
    const a = mh.get(Math.floor(x / 50) * 9973 + Math.floor(z / 50)); if (!a) return null;
    let best = null, bd = 1e9;
    for (const s of a) {
      const vx = s.b[0] - s.a[0], vz = s.b[1] - s.a[1], t = clamp(((x - s.a[0]) * vx + (z - s.a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1);
      const qx = s.a[0] + vx * t - x, qz = s.a[1] + vz * t - z, d = qx * qx + qz * qz;
      if (d < bd) { bd = d; best = { d: Math.sqrt(d), y: s.a[2] + (s.b[2] - s.a[2]) * t, tun: s.tun, s: s.s0 + (s.s1 - s.s0) * t }; }
    }
    return best;
  };
  city.mtnNearest = nearest;
  city.mtnRoadAt = (x, z) => { if (z > -995) return null; const n = nearest(x, z); return n && n.d < hw + 0.8 ? n : null; };
  // 休憩所（道の駅）の平場
  let pi = 0, bd = 1e9; for (let i = 0; i < N; i++) { const d = Math.hypot(P[i][0] + 470, P[i][1] + 1500); if (d < bd) { bd = d; pi = i; } }
  const nrm = pi0.nrm[pi], padC = [P[pi][0] - nrm[0] * 24, P[pi][1] - nrm[1] * 24], padY = y[pi];
  const pad = { x0: padC[0] - 20, x1: padC[0] + 20, z0: padC[1] - 15, z1: padC[1] + 15, y: padY };
  city.restPad = pad;
  // --- 地形グリッド（山道に沿って切り盛り） ---
  const NX = (TX1 - TX0) / TS + 1, NZ = (TZ1 - TZ0) / TS + 1;
  const H = new Float32Array(NX * NZ), carved = new Uint8Array(NX * NZ), tflag = new Uint8Array(NX * NZ);
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
    const x = TX0 + ix * TS, z = TZ0 + iz * TS;
    let h = natH(x, z);
    const n = nearest(x, z);
    const inside = n && n.s > mtn.ta + 1 && n.s < mtn.tb - 1;
    if (inside) { if (n.d < hw + 14) { h = Math.max(h, n.y + 9); tflag[iz * NX + ix] = 1; } }
    else if (n) {
      const r0 = hw + 8, r1 = r0 + 45;
      if (n.d < r1) { const k = smooth((n.d - r0) / (r1 - r0)); const nh = (n.y - 0.6) * (1 - k) + h * k; if (Math.abs(nh - h) > 0.5) carved[iz * NX + ix] = 1; h = nh; }
    }
    // 休憩所
    const dx = Math.max(pad.x0 - x, 0, x - pad.x1), dz = Math.max(pad.z0 - z, 0, z - pad.z1), dp = Math.hypot(dx, dz);
    if (dp < 30) { const k = smooth(dp / 30); h = (pad.y - 0.3) * (1 - k) + h * k; carved[iz * NX + ix] = 1; }
    if (n && !inside && n.d < hw + 14 && (Math.abs(n.s - mtn.ta) < 25 || Math.abs(n.s - mtn.tb) < 25)) tflag[iz * NX + ix] = 2;
    if (z > -1012) h = Math.min(h, 0) - 0.05;
    H[iz * NX + ix] = h;
  }
  city.terrainY = (x, z) => {
    if (z >= -1000 || x < TX0 || x > TX1 || z < TZ0) return 0;
    if (x > pad.x0 && x < pad.x1 && z > pad.z0 && z < pad.z1) return pad.y;
    const fx = (x - TX0) / TS, fz = (z - TZ0) / TS, ix = Math.min(NX - 2, fx | 0), iz = Math.min(NZ - 2, fz | 0), tx = fx - ix, tz = fz - iz;
    const h00 = H[iz * NX + ix], h10 = H[iz * NX + ix + 1], h01 = H[(iz + 1) * NX + ix], h11 = H[(iz + 1) * NX + ix + 1];
    return tx + tz < 1 ? h00 + (h10 - h00) * tx + (h01 - h00) * tz : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  };
  city.terrain = { H, carved, tflag, NX, NZ };
  // --- バイパス高架の路面（地面判定用） ---
  const bs = mkSpec('byp', 'ns', BYP_X);
  city.surfaces.push({ x0: BYP_X - bs.hw - 0.2, x1: BYP_X + bs.hw + 0.2, z0: -300, z1: 300, y: (x, z) => bypY(z) });
  city.bypassProps = e => bypassProps(city, e);
  // --- 橋 ---
  city.bridges = XL.map(x => { const r = city.roads.find(r => r.axis === 'ns' && r.c === x && r.a <= 520 && r.b >= 610); return r ? { x, hw: r.sp.hw + 0.1, sp: r.sp } : null; }).filter(Boolean);
}

// ============ バイパスの高架構造 ============
function bypassProps(city, e) {
  if (e.seg.fwd !== e) return;
  const sp = e.sp, hw = sp.hw, natExt = mkSpec('nat', 'ew', 0).ext;
  for (let z = -300; z < 300; z += 10) {
    const z2 = z + 10, y0 = bypY(z), y1 = bypY(z2);
    if (y0 < 0.05 && y1 < 0.05) continue;
    for (const s of [-1, 1]) city.addWall(BYP_X + s * (hw + 0.15), z, BYP_X + s * (hw + 0.15), z2, Math.min(y0, y1) - 0.4, Math.max(y0, y1) + 1.1);
    city.add(BYP_X, z + 5, g => {
      const c = [0.74, 0.74, 0.72];
      for (const s of [-1, 1]) {
        const x0 = BYP_X + s * (hw + 0.3), x1 = BYP_X + s * hw;
        g.s.quadN([x0, y0, z], [x0, y1, z2], [x0, y1 + 1.05, z2], [x0, y0 + 1.05, z], [s, 0, 0], { c });
        g.s.quadN([x1, y0, z], [x1, y1, z2], [x1, y1 + 1.05, z2], [x1, y0 + 1.05, z], [-s, 0, 0], { c });
        g.s.quadN([x0, y0 + 1.05, z], [x1, y0 + 1.05, z], [x1, y1 + 1.05, z2], [x0, y1 + 1.05, z2], [0, 1, 0], { c: [0.8, 0.8, 0.78] });
      }
      if (y0 > 1.5) { // 床版の下面と側面
        g.s.quadN([BYP_X - hw - 0.3, y0 - 1.1, z], [BYP_X + hw + 0.3, y0 - 1.1, z], [BYP_X + hw + 0.3, y1 - 1.1, z2], [BYP_X - hw - 0.3, y1 - 1.1, z2], [0, -1, 0], { c: [0.55, 0.55, 0.53] });
        for (const s of [-1, 1]) g.s.quadN([BYP_X + s * (hw + 0.3), y0 - 1.1, z], [BYP_X + s * (hw + 0.3), y1 - 1.1, z2], [BYP_X + s * (hw + 0.3), y1, z2], [BYP_X + s * (hw + 0.3), y0, z], [s, 0, 0], { c: [0.68, 0.68, 0.66] });
      }
    });
  }
  // 橋脚
  for (let z = -255; z <= 255; z += 30) {
    const yy = bypY(z); if (yy < 3 || Math.abs(z) < natExt + 2) continue;
    city.addBox(BYP_X - 1.2, z - 0.9, BYP_X + 1.2, z + 0.9, 'p', -50, yy - 1.2);
    city.add(BYP_X, z, g => { g.s.box(BYP_X - 1.1, -0.05, z - 0.8, BYP_X + 1.1, yy - 1.1, z + 0.8, { c: [0.66, 0.66, 0.64] }); g.s.box(BYP_X - hw, yy - 1.9, z - 0.9, BYP_X + hw, yy - 1.1, z + 0.9, { c: [0.66, 0.66, 0.64] }); });
  }
  // 国道をまたぐ部分は門型の橋脚
  for (const z of [-natExt - 2.5, natExt + 2.5]) for (const s of [-1, 1]) {
    city.addBox(BYP_X + s * hw - 0.6, z - 0.6, BYP_X + s * hw + 0.6, z + 0.6, 'p', -50, 7);
    city.add(BYP_X, z, g => g.s.box(BYP_X + s * hw - 0.55, -0.05, z - 0.55, BYP_X + s * hw + 0.55, bypY(z) - 1.1, z + 0.55, { c: [0.66, 0.66, 0.64] }));
  }
  // 照明・速度標識
  for (let z = -240; z <= 240; z += 40) city.add(BYP_X, z, g => { const yy = bypY(z); g.s.cyl(BYP_X + hw + 0.15, yy + 1, z, 0.08, 7, 6, { c: [0.6, 0.62, 0.62] }, false); g.s.beam([BYP_X + hw + 0.15, yy + 8, z], [BYP_X + hw - 2.5, yy + 8.2, z], 0.05, { c: [0.6, 0.62, 0.62] }); g.s.cbox(BYP_X + hw - 2.5, yy + 8.1, z, 0.5, 0.14, 0.3, { c: [1, 0.92, 0.75], mat: 8 }); });
}

// ============ 後処理：郊外・河川・鉄道など ============
function post(city) {
  const G = city.global, R = rng(4242);
  // 地面・遠景用の下地
  G.flat(-6000, -6000, 6000, 6000, -25, { c: [0.35, 0.45, 0.3] });
  G.flat(-4000, -1000, 4000, 530, -0.05, { c: [1, 1, 1], lay: L.GRASS }, 20);
  G.flat(-4000, 600, 4000, 4000, -0.05, { c: [1, 1, 1], lay: L.GRASS }, 20);
  for (const s of [-1, 1]) G.flat(s > 0 ? TX1 : -4000, -4000, s > 0 ? 4000 : TX0, -1000, -0.05, { c: [0.6, 0.75, 0.55], lay: L.FOREST }, 30);
  // --- 川（水瀬川）と堤防 ---
  G.flat(-4000, 536, 4000, 594, -1.9, { c: [1, 1, 1], lay: L.WATER, mat: 21 }, 10);
  G.quadN([-4000, -0.05, 530], [4000, -0.05, 530], [4000, -1.9, 538], [-4000, -1.9, 538], [0, 1, 0.2], { c: [0.45, 0.55, 0.32], lay: L.GRASS }, [[0, 0], [400, 0], [400, 1], [0, 1]]);
  G.quadN([-4000, -1.9, 592], [4000, -1.9, 592], [4000, -0.05, 600], [-4000, -0.05, 600], [0, 1, -0.2], { c: [0.45, 0.55, 0.32], lay: L.GRASS }, [[0, 0], [400, 0], [400, 1], [0, 1]]);
  city.mm.water.push({ x0: -2000, x1: 2000, z0: 534, z1: 596 });
  for (const b of city.bridges) {
    const x = b.x, hw = b.hw;
    for (const s of [-1, 1]) city.addWall(x + s * (hw + 0.2), 529, x + s * (hw + 0.2), 601, -1, 1.3);
    city.add(x, 565, g => {
      g.s.box(x - hw - 0.5, -1.3, 524, x + hw + 0.5, -0.02, 606, { c: [0.62, 0.62, 0.6], noTop: true });
      for (const s of [-1, 1]) { g.s.box(x + s * (hw + 0.2) - 0.25, 0, 529, x + s * (hw + 0.2) + 0.25, 0.75, 601, { c: [0.82, 0.82, 0.8] }); g.s.box(x + s * (hw + 0.2) - 0.06, 0.75, 529, x + s * (hw + 0.2) + 0.06, 1.15, 601, { c: [0.35, 0.45, 0.6] }); }
      for (const z of [548, 566, 584]) g.s.box(x - 1.5, -4, z - 1.2, x + 1.5, -1.3, z + 1.2, { c: [0.55, 0.55, 0.53] });
      for (const z of [529, 601]) for (const s of [-1, 1]) g.s.cbox(x + s * (hw + 0.2), 0.9, z, 0.5, 1.8, 0.5, { c: [0.7, 0.7, 0.68] });
    });
  }
  // --- 山間部 ---
  buildMountain(city);
  // --- 外周エリア ---
  const ZB = [-1000, -500, 0, 500, 1000, 1500, 2000];
  const extOf = (axis, c, along) => { let e = 0; for (const r of city.roads) if (r.axis === axis && r.c === c && r.a <= along && along <= r.b) e = Math.max(e, r.sp.ext); return e; };
  city.carRate = 0.4;
  for (let i = 0; i < XL.length - 1; i++) for (let j = 0; j < ZB.length - 1; j++) {
    const xa = XL[i], xb = XL[i + 1], za = ZB[j], zb = ZB[j + 1];
    if (xa >= -500 && xb <= 500 && za >= -500 && zb <= 500) continue; // 中心市街地
    const mx = (xa + xb) / 2, mz = (za + zb) / 2;
    const r = { x0: xa + extOf('ns', xa, mz), x1: xb - extOf('ns', xb, mz), z0: za + extOf('ew', za, mx), z1: zb - extOf('ew', zb, mx) };
    const Rc = rng(i * 97 + j * 13 + 1);
    const zone = zoneOf(xa, za);
    if (zone === 'river') {
      const n = { ...r, z1: 528 }, s = { ...r, z0: 604 };
      riverPark(city, n, Rc, 's');
      if (xa >= -1000 && xb <= 1000) suburb(city, s, Rc, {}); else farm(city, s, Rc);
    } else if (zone === 'sub') suburb(city, r, Rc, { shrine: xa === -500 && za === -1000, school: xa === 1000 && za === -1000 });
    else if (zone === 'ind') industrial(city, r, Rc);
    else if (zone === 'road') roadside(city, r, Rc, za < 0 ? 's' : 'n', xa);
    else farm(city, r, Rc);
  }
  city.carRate = 0.6;
  // --- 高架鉄道（z=-445）を東西に延長 ---
  railway(city);
  // --- 路面電車（中心部の z=0 通り） ---
  tram(city);
  // 地区名
  city.zoneName = (x, z) => {
    if (z < -1000) return city.mtnRoadAt(x, z) && city.inTunnelXZ(x, z) ? '水瀬トンネル' : '山間部（みなせ峠）';
    if (z > 528 && z < 602) return '水瀬川（河川沿い）';
    if (Math.abs(x - BYP_X) < 12 && Math.abs(z) < 300) return '水瀬バイパス（高架）';
    if (x >= -500 && x <= 500 && z >= -500 && z <= 500) return city.coreDistrict(x, z);
    let xa = XL[0]; for (const v of XL) if (v <= x) xa = v;
    let za = ZB[0]; for (const v of ZB) if (v <= z) za = v;
    if (Math.abs(z) < 30 && x > 500) return '国道（郊外ロードサイド）';
    return { sub: '郊外住宅地', ind: '水瀬工業団地', road: '郊外ロードサイド', farm: '田園地帯', river: z < 560 ? '水瀬川河川敷' : '郊外住宅地' }[zoneOf(xa, za)] || '郊外';
  };
  const tb = city.tunnelBox;
  city.inTunnelXZ = (x, z) => x > tb.x0 && x < tb.x1 && z > tb.z0 && z < tb.z1;
  // 市の外周（見えない壁の位置）に柵を立てて、ここが行き止まりだと分かるようにする
  { const Lb = 2041, G2 = city.global, o = { c: [0.85, 0.85, 0.82] }, po = { c: [0.55, 0.55, 0.52] };
    for (const [ax, sgn] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) for (let t = -Lb; t < Lb; t += 20) {
      const P = u => ax === 'x' ? [sgn * Lb, u] : [u, sgn * Lb], a = P(t), b = P(t + 20);
      if (ax === 'z' && sgn > 0 && false) continue;
      const ya = city.terrainY(a[0], a[1]), yb = city.terrainY(b[0], b[1]);
      if ((a[1] > 530 && a[1] < 600) || (b[1] > 530 && b[1] < 600)) { if (ax === 'x') continue; }
      const n = ax === 'x' ? [-sgn, 0, 0] : [0, 0, -sgn];
      G2.quadN([a[0], ya + 0.55, a[1]], [b[0], yb + 0.55, b[1]], [b[0], yb + 0.9, b[1]], [a[0], ya + 0.9, a[1]], n, o);
      G2.box(a[0] - 0.08, ya - 0.2, a[1] - 0.08, a[0] + 0.08, ya + 1.0, a[1] + 0.08, po);
    } }
  roadExtras(city);
  townExtras(city);
  shadowsAndFar(city);
  // 遠景の山並み
  const M = new GB(), RM = rng(77);
  for (let k = 0; k < 80; k++) { // 北は高い山、東西と南は低い山並み（全周）
    const a = -Math.PI + k / 80 * Math.PI * 2, north = Math.cos(a) > 0.2, dist = (north ? 3000 : 3300) + RM() * 700;
    const cx = Math.sin(a) * dist, cz = -Math.cos(a) * dist - (north ? 600 : 0), r = 420 + RM() * 420, h = north ? 260 + RM() * 320 : 90 + RM() * 170;
    const c = [0.34 + RM() * 0.06, 0.45 + RM() * 0.06, 0.4 + RM() * 0.05];
    for (let s = 0; s < 6; s++) {
      const a0 = s / 6 * Math.PI * 2, a1 = (s + 1) / 6 * Math.PI * 2;
      M.tri([cx + Math.cos(a0) * r, -1, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, -1, cz + Math.sin(a1) * r], [cx + RM() * 40, h, cz + RM() * 40], { c, mat: 9 }, [0, 0], [0, 0], [0, 0], [cx, h / 3, cz]);
    }
  }
  city.mountains = M;
  // 電車・路面電車の車体
  const T = new GB();
  for (let k = 0; k < 4; k++) { // 4両編成（線路中心に原点）
    T.box(k * 20.5, 9.0, -1.45, k * 20.5 + 20, 12.4, 1.45, { c: [0.92, 0.93, 0.93], mat: 3, side: { lay: L.TRAINWIN, tw: 5, th: 3.4 } });
    T.box(k * 20.5 + 1, 12.4, -1.2, k * 20.5 + 19, 12.6, 1.2, { c: [0.6, 0.6, 0.62] });
    for (const bx of [3, 17]) { T.box(k * 20.5 + bx - 1.3, 8.4, -1.1, k * 20.5 + bx + 1.3, 9.0, 1.1, { c: [0.2, 0.2, 0.22] }); }
    if (k === 1 || k === 2) { const px = k * 20.5 + 10; T.beam([px - 1, 12.6, 0], [px, 13.0, 0], 0.03, { c: [0.25, 0.25, 0.25] }); T.beam([px, 13.0, 0], [px + 1, 12.6, 0], 0.03, { c: [0.25, 0.25, 0.25] }); T.box(px - 0.1, 12.95, -0.8, px + 0.1, 13.02, 0.8, { c: [0.25, 0.25, 0.25] }); }
  }
  for (const [x, f] of [[-0.02, 1], [82.02, -1]]) for (const s of [-1, 1]) { T.box(x - 0.02, 9.6, s * 0.9 - 0.15, x + 0.02, 9.8, s * 0.9 + 0.15, { c: [1, 1, 0.9], mat: 2 }); void f; }
  city.trainGeo = T;
  const TR = new GB();
  for (const [z0, z1] of [[-9, -3.1], [-2.9, 2.9], [3.1, 9]]) TR.box(-1.2, 0.35, z0, 1.2, 3.3, z1, { c: [1, 1, 1], mat: 3, side: { lay: L.TRAMWIN, tw: 5.9, th: 2.95 }, top: { lay: L.ROOF, tw: 4 } });
  for (const z of [-9.02, 9.02]) TR.box(-1.15, 1.6, z - 0.01, 1.15, 2.9, z + 0.01, { c: [0.15, 0.2, 0.25] });
  for (const z of [-9.03, 9.03]) for (const s of [-1, 1]) TR.box(s * 0.85 - 0.12, 0.9, z - 0.01, s * 0.85 + 0.12, 1.05, z + 0.01, { c: [1, 1, 0.9], mat: 2 });
  TR.box(-0.5, 3.3, -1.5, 0.5, 3.5, 1.5, { c: [0.3, 0.3, 0.32] });
  TR.beam([0, 3.5, 0], [0.3, 4.6, -0.8], 0.03, { c: [0.2, 0.2, 0.2] }); TR.beam([0.3, 4.6, -0.8], [0, 5.5, 0], 0.03, { c: [0.2, 0.2, 0.2] });
  TR.box(-0.8, 5.45, -0.1, 0.8, 5.55, 0.1, { c: [0.2, 0.2, 0.2] });
  TR.flat(-1.3, -9.2, 1.3, 9.2, 0.05, { c: [0.05, 0.05, 0.06], mat: 5 });
  city.tramGeo = TR;
}

function zoneOf(xa, za) {
  if (za === -1000) return Math.abs(xa + 250) <= 1250 + 1 && xa >= -1500 && xa <= 1000 ? 'sub' : 'farm';
  if (za === -500 || za === 0) return xa <= -1500 ? 'ind' : xa === -1000 ? 'sub' : xa >= 500 ? 'road' : 'core';
  if (za === 500) return 'river';
  return 'farm';
}

// ============ 山間部 ============
function buildMountain(city) {
  const { H, carved, tflag, NX, NZ } = city.terrain, mtn = city.mtn, e = city.edges.find(x => x.sp.kind === 'mtn'), hw = mtn.hw;
  // 地形メッシュ（チャンク単位）
  for (let cz0 = TZ0; cz0 < TZ1; cz0 += 250) for (let cx0 = TX0; cx0 < TX1; cx0 += 250) {
    const x0 = cx0, z0 = cz0, x1 = Math.min(TX1, cx0 + 250), z1 = Math.min(TZ1, cz0 + 250);
    city.add((x0 + x1) / 2, (z0 + z1) / 2, g => {
      for (let z = z0; z < z1; z += TS) for (let x = x0; x < x1; x += TS) {
        const ix = (x - TX0) / TS, iz = (z - TZ0) / TS;
        const h = (a, b) => H[(iz + b) * NX + ix + a], cv = carved[iz * NX + ix] || carved[iz * NX + ix + 1] || carved[(iz + 1) * NX + ix];
        const tf = [tflag[iz * NX + ix], tflag[iz * NX + ix + 1], tflag[(iz + 1) * NX + ix], tflag[(iz + 1) * NX + ix + 1]];
        if (tf.includes(1) && tf.includes(2)) continue; // 坑口の段差部分は坑口壁で隠す
        const p00 = [x, h(0, 0), z], p10 = [x + TS, h(1, 0), z], p01 = [x, h(0, 1), z + TS], p11 = [x + TS, h(1, 1), z + TS];
        const hh = (p00[1] + p11[1]) / 2, k = 0.85 + Math.sin(x * 0.013 + z * 0.021) * 0.08;
        const o = cv ? { c: [0.78 * k, 0.8 * k, 0.62 * k], lay: L.GRASS } : { c: hh > 160 ? [0.82 * k, 0.88 * k, 0.8 * k] : [0.9 * k, 1 * k, 0.9 * k], lay: L.FOREST };
        g.s.tri(p00, p01, p11, o, [x / 14, z / 14], [x / 14, (z + TS) / 14], [(x + TS) / 14, (z + TS) / 14], [x + 5, -2000, z + 5]);
        g.s.tri(p00, p11, p10, o, [x / 14, z / 14], [(x + TS) / 14, (z + TS) / 14], [(x + TS) / 14, z / 14], [x + 5, -2000, z + 5]);
      }
      // 針葉樹
      const Rt = rng(Math.abs(x0 * 7 + z0 * 13) + 1);
      if (x0 < -2000 || x1 > 2000) return;
      for (let z = z0 + 6; z < z1; z += 22) for (let x = x0 + 6; x < x1; x += 22) {
        const tx = x + (Rt() - 0.5) * 16, tz = z + (Rt() - 0.5) * 16;
        if (tz > -1030) continue;
        if (city.terraceRect && tx > city.terraceRect.x0 - 4 && tx < city.terraceRect.x1 + 4 && tz > city.terraceRect.z0 - 4 && tz < city.terraceRect.z1 + 4) continue;
        const n = city.mtnNearest(tx, tz); if (n && n.d < hw + 11) continue;
        const pd = city.restPad; if (tx > pd.x0 - 8 && tx < pd.x1 + 8 && tz > pd.z0 - 8 && tz < pd.z1 + 8) continue;
        const ty = city.terrainY(tx, tz), s = 0.8 + Rt() * 0.7;
        conifer(g.s, tx, ty, tz, s, Rt);
      }
    });
  }
  // 棚田（山すその斜面。段ごとに水平な田と石垣）
  { const T0 = { x0: -760, x1: -664, z0: -1136, z1: -1040 }; city.terraceRect = T0; let n = 0;
    const cells = []; for (let x = T0.x0; x < T0.x1; x += 16) for (let z = T0.z0; z < T0.z1; z += 16) { const nn = city.mtnNearest(x + 8, z + 8); if (nn && nn.d < hw + 12) continue; cells.push([x, z, Math.round(city.terrainY(x + 8, z + 8) * 2) / 2]); }
    for (const [x, z, y] of cells) { n++; city.add(x + 8, z + 8, g => { const lo = Math.min(...[[0, 0], [16, 0], [0, 16], [16, 16]].map(([a, b]) => city.terrainY(x + a, z + b))) - 0.5; g.s.box(x + 0.2, lo, z + 0.2, x + 15.8, y + 0.25, z + 15.8, { c: [0.6, 0.58, 0.52], lay: L.ROCK, side: { lay: L.ROCK, tw: 3, th: 3 }, noTop: true }); g.d1.flat(x + 0.6, z + 0.6, x + 15.4, z + 15.4, y + 0.05, { c: [1, 1, 1], lay: (x + z) % 32 ? L.PADDY : L.WATERPAD }, 8); g.s.box(x + 0.2, y, z + 0.2, x + 15.8, y + 0.3, z + 0.6, { c: [0.5, 0.62, 0.38], lay: L.GRASS }); }); }
    city.stats.terraces = n; }
  // 遠景用の粗い地形（40m格子）：チャンクが読み込まれる前でも山肌と峠道の帯が見えるように
  city.farTerrain = new Map();
  { const S2 = 40;
    for (let z = TZ0; z < TZ1; z += S2) for (let x = TX0; x < TX1; x += S2) {
      const ch = city.chunkAt(x + S2 / 2, z + S2 / 2); let L2 = city.farTerrain.get(ch); if (!L2) { L2 = []; city.farTerrain.set(ch, L2); } L2.push([x, z]);
    }
    for (const [ch, L2] of city.farTerrain) city.farTerrain.set(ch, g => { for (const [x, z] of L2) { const h = (a, b) => city.terrainY(x + a, z + b) - 0.4, hh = h(20, 20), k = 0.85 + Math.sin(x * 0.013 + z * 0.021) * 0.08, o = { c: hh > 160 ? [0.36 * k, 0.45 * k, 0.36 * k] : [0.3 * k, 0.42 * k, 0.28 * k] }; g.quadN([x, h(0, 0), z], [x + S2, h(S2, 0), z], [x + S2, h(S2, S2), z + S2], [x, h(0, S2), z + S2], [0, 1, 0], o); } });
    // 峠道の帯（遠くからでも道筋が分かる）
    const F = mtn.full; for (let i = 0; i < F.length - 1; i += 4) { const a = F[i], b = F[Math.min(F.length - 1, i + 4)], ch = city.chunkAt(a[0], a[1]), prev = city.farTerrain.get(ch); city.farTerrain.set(ch, g => { prev && prev(g); const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = dz / l * (hw + 0.5), nz = -dx / l * (hw + 0.5); g.quadN([a[0] - nx, a[2] + 0.1, a[1] - nz], [a[0] + nx, a[2] + 0.1, a[1] + nz], [b[0] + nx, b[2] + 0.1, b[1] + nz], [b[0] - nx, b[2] + 0.1, b[1] - nz], [0, 1, 0], { c: [0.35, 0.35, 0.36] }); }); }
  }
  // 道路面・区画線・ガードレール
  const full = mtn.full, pi = polyInfo(full), N = full.length;
  const off = (i, o) => [full[i][0] + pi.nrm[i][0] * o, full[i][2] + 0.06, full[i][1] + pi.nrm[i][1] * o];
  const pdN = (pt) => { const pd = city.restPad; return pt[0] > pd.x0 - 8 && pt[0] < pd.x1 + 8 && pt[2] > pd.z0 - 8 && pt[2] < pd.z1 + 8; };
  const noRail = i => pi.cum[i] < 35 || pi.cum[N - 1] - pi.cum[i] < 35; // 交差点付近はガードレールなし
  // 待避所（2か所）：山側に幅3m×長さ30mの舗装を広げる
  const L0 = pi.cum[N - 1], pulls = [];
  function inT0(i) { return pi.cum[i] > mtn.ta - 40 && pi.cum[i] < mtn.tb + 40; }
  for (const f of [0.28, 0.72]) { let i = 0; while (i < N - 1 && pi.cum[i] < L0 * f) i++; while (inT0(i)) i += 10; pulls.push({ s0: pi.cum[i] - 15, s1: pi.cum[i] + 15, i }); }
  const inPull = s => pulls.find(p => s > p.s0 - 4 && s < p.s1 + 4);
  // ガードレールは谷側（路肩の外が1.2m以上低い）だけ。描画と当たり判定は同じ判定を使う
  const valley = (i, s) => { const p = off(i, s * (hw + 7)); return city.terrainY(p[0], p[2]) < full[i][2] - 1.2; };
  for (const p of pulls) p.side = valley(p.i, 1) ? -1 : 1;
  // ガードレールは両側に設置（路肩の外へ落ちないように）。切るのは 交差点付近・待避所の側・道の駅の入口側 だけ
  const padC = [(city.restPad.x0 + city.restPad.x1) / 2, (city.restPad.z0 + city.restPad.z1) / 2];
  const padGap = (i, s) => { const p = off(i, s * (hw + 0.45)), q = off(i, -s * (hw + 0.45)); return pdN(p) && Math.hypot(p[0] - padC[0], p[2] - padC[1]) < Math.hypot(q[0] - padC[0], q[2] - padC[1]); };
  const railAt = (i, s) => !noRail(i) && !noRail(i + 1) && !(inPull(pi.cum[i]) && inPull(pi.cum[i]).side === s) && !padGap(i, s) && !padGap(i + 1, s);
  city.pullouts = pulls;
  city.mtnRail = { railAt, valley };
  const inT = i => pi.cum[i] > mtn.ta - 12 && pi.cum[i] < mtn.tb + 12;
  for (let i0 = 0; i0 < N - 1; i0 += 20) {
    const i1 = Math.min(N - 1, i0 + 20), mid = full[(i0 + i1) >> 1];
    city.add(mid[0], mid[1], g => {
      for (let i = i0; i < i1; i++) {
        const tn = inT(i) || inT(i + 1);
        const asph = { c: tn ? [0.55, 0.55, 0.55] : [1, 1, 1], mat: 7, lay: L.ASPHALT };
        const a = off(i, -hw - 0.6), b = off(i + 1, -hw - 0.6), c = off(i + 1, hw + 0.6), d = off(i, hw + 0.6);
        g.d1.quadN(a, b, c, d, [0, 1, 0], asph, [[a[0] / 8, a[2] / 8], [b[0] / 8, b[2] / 8], [c[0] / 8, c[2] / 8], [d[0] / 8, d[2] / 8]]);
        if (!tn) for (const s of [-1, 1]) { // 路肩（砂利）で切り盛りの境目を隠す
          const e0 = off(i, s * (hw + 0.6)), e1 = off(i + 1, s * (hw + 0.6)), f1 = off(i + 1, s * (hw + 3.2)), f0 = off(i, s * (hw + 3.2));
          f0[1] -= 0.25; f1[1] -= 0.25;
          g.d1.quadN(e0, e1, f1, f0, [0, 1, 0], { c: [0.78, 0.74, 0.66], lay: L.FIELD }, [[e0[0] / 4, e0[2] / 4], [e1[0] / 4, e1[2] / 4], [f1[0] / 4, f1[2] / 4], [f0[0] / 4, f0[2] / 4]]);
        }
        const ln = (o0, o1, col) => g.d2.quadN(off(i, o0), off(i + 1, o0), off(i + 1, o1), off(i, o1), [0, 1, 0], { c: col });
        ln(-0.08, 0.08, YEL); ln(hw - 0.35, hw - 0.2, WHITE); ln(-hw + 0.2, -hw + 0.35, WHITE);
        const pu = inPull(pi.cum[i]);
        if (pu && !tn) { const s = pu.side, a = off(i, s * (hw + 0.6)), b = off(i + 1, s * (hw + 0.6)), c = off(i + 1, s * (hw + 3.6)), d = off(i, s * (hw + 3.6)); c[1] = b[1]; d[1] = a[1]; g.d1.quadN(a, b, c, d, [0, 1, 0], { c: [0.95, 0.95, 0.95], mat: 7, lay: L.ASPHALT }, [[a[0] / 8, a[2] / 8], [b[0] / 8, b[2] / 8], [c[0] / 8, c[2] / 8], [d[0] / 8, d[2] / 8]]); }
        if (tn) continue;
        // 矢羽根（積雪時の道路端を示す紅白ポール）
        if (i % 8 === 0 && full[i][1] < -1080) for (const s of [-1, 1]) { const p = off(i, s * (hw + 1.4)); if (pdN(p) || (pu && pu.side === s)) continue; g.det.cyl(p[0], p[1] - 0.06, p[2], 0.035, 4.6, 4, { c: [0.95, 0.95, 0.95] }); for (let k = 0; k < 4; k++) g.det.cyl(p[0], p[1] + 0.4 + k * 1.0, p[2], 0.04, 0.5, 4, { c: [0.9, 0.15, 0.1] }); g.det.cbox(p[0] - pi.nrm[i][0] * s * 0.2, p[1] + 4.3, p[2] - pi.nrm[i][1] * s * 0.2, 0.35, 0.5, 0.35, { c: [0.95, 0.85, 0.1] }); }
        // ガードレール（谷側のみ）
        for (const s of [-1, 1]) {
          if (!railAt(i, s)) continue;
          const o = s * (hw + 0.45), p = off(i, o), q = off(i + 1, o);
          g.s.quadN([p[0], p[1] + 0.45, p[2]], [q[0], q[1] + 0.45, q[2]], [q[0], q[1] + 0.8, q[2]], [p[0], p[1] + 0.8, p[2]], [pi.nrm[i][0] * s, 0, pi.nrm[i][1] * s], { c: [0.9, 0.9, 0.88] });
          if (i % 1 === 0) g.s.cbox(p[0], p[1] + 0.35, p[2], 0.1, 0.7, 0.1, { c: [0.6, 0.6, 0.6] });
        }
      }
    });
    for (let i = i0; i < i1; i++) if (!inT(i) && !inT(i + 1)) for (const s of [-1, 1]) {
      if (!railAt(i, s)) continue;
      const o = s * (hw + 0.45), p = off(i, o), q = off(i + 1, o);
      // 描画と同じ railAt() で判定（道の駅の入口・待避所は開いている）
      city.addWall(p[0], p[2], q[0], q[2], Math.min(p[1], q[1]) - 1.2, Math.max(p[1], q[1]) + 1.0);
    }
  }
  // 急カーブの警戒標識と速度標識
  let lastSign = -999;
  for (let i = 2; i < N - 2; i++) {
    const s = pi.cum[i]; if (s - lastSign < 120 || inT(i)) continue;
    const a = pi.dirs[i - 2], b = pi.dirs[i + 1], turn = a[0] * b[1] - a[1] * b[0];
    if (Math.abs(turn) > 0.18) { lastSign = s; const p = off(Math.max(0, i - 8), hw + 1.0), d = pi.dirs[Math.max(0, i - 8)]; city.add(p[0], p[2], g => { g.det.setXf(0, p[1] - 0.06, 0, 0); city.signPole(g.det, p[0], p[2], d, L.CURVE, 0.7, 0.7, 2.0, 1); g.det.clearXf(); }); }
  }
  // カーブミラー（見通しの悪いカーブの外側）
  let mir = 0, lastM = -999;
  for (let i = 4; i < N - 4 && mir < 14; i++) {
    const s = pi.cum[i]; if (s - lastM < 110 || inT(i) || inPull(s)) continue;
    const a = pi.dirs[i - 4], b = pi.dirs[i + 3], turn = a[0] * b[1] - a[1] * b[0];
    if (Math.abs(turn) < 0.22) continue;
    const side = turn > 0 ? 1 : -1, p = off(i, side * (hw + 1.0));
    if (pdN(p)) continue;
    lastM = s; mir++;
    const yaw = Math.atan2(-pi.nrm[i][0] * side, -pi.nrm[i][1] * side);
    city.addBox(p[0] - 0.1, p[2] - 0.1, p[0] + 0.1, p[2] + 0.1, 'p');
    city.add(p[0], p[2], g => city.curveMirror(g.det, p[0], p[2], yaw, p[1] - 0.06));
  }
  city.stats.mtnMirrors = mir;
  for (const [i, dir] of [[6, 1], [N - 7, -1]]) { const p = off(i, (hw + 1.0) * dir); const d = dir > 0 ? pi.dirs[i] : [-pi.dirs[i][0], -pi.dirs[i][1]]; city.add(p[0], p[2], g => { g.det.setXf(0, p[1] - 0.06, 0, 0); city.signPole(g.det, p[0], p[2], d, L.SP40, 0.6, 0.6, 2.2); g.det.clearXf(); }); }
  // トンネル
  let ia = 0, ib = 0; for (let i = 0; i < N; i++) { if (pi.cum[i] <= mtn.ta - 12) ia = i; if (pi.cum[i] <= mtn.tb + 12) ib = i; }
  ib = Math.min(N - 1, ib + 1);
  let tx0 = 1e9, tx1 = -1e9, tz0 = 1e9, tz1 = -1e9;
  for (let i = ia; i < ib; i++) {
    const wo = hw + 0.9, p = full[i], q = full[i + 1];
    tx0 = Math.min(tx0, p[0], q[0]); tx1 = Math.max(tx1, p[0], q[0]); tz0 = Math.min(tz0, p[1] - wo, q[1] - wo); tz1 = Math.max(tz1, p[1] + wo, q[1] + wo);
    for (const s of [-1, 1]) { const a = off(i, s * wo), b = off(i + 1, s * wo); city.addWall(a[0], a[2], b[0], b[2], Math.min(a[1], b[1]) - 1, Math.max(a[1], b[1]) + 6); }
  }
  city.tunnelBox = { x0: tx0, x1: tx1, z0: tz0, z1: tz1 };
  city.tunnels.push(city.tunnelBox);
  for (let i0 = ia; i0 < ib; i0 += 15) {
    const i1 = Math.min(ib, i0 + 15), mid = full[(i0 + i1) >> 1];
    city.add(mid[0], mid[1], g => {
      for (let i = i0; i < i1; i++) {
        const wo = hw + 0.9;
        const arc = [[-wo, 0], [-wo, 4.4], [-wo * 0.7, 5.8], [0, 6.4], [wo * 0.7, 5.8], [wo, 4.4], [wo, 0]];
        for (let k = 0; k < arc.length - 1; k++) {
          const a = off(i, arc[k][0]), b = off(i + 1, arc[k][0]), c = off(i + 1, arc[k + 1][0]), d = off(i, arc[k + 1][0]);
          a[1] += arc[k][1]; b[1] += arc[k][1]; c[1] += arc[k + 1][1]; d[1] += arc[k + 1][1];
          const ccol = k === 0 || k === arc.length - 2 ? [0.62, 0.62, 0.6] : [0.4, 0.4, 0.4];
          g.s.tri(a, b, c, { c: ccol, lay: L.TUNNELWALL }, [0, 0], [1, 0], [1, 1], [full[i][0], full[i][2] + 3, full[i][1]]);
          g.s.tri(a, c, d, { c: ccol, lay: L.TUNNELWALL }, [0, 0], [1, 1], [0, 1], [full[i][0], full[i][2] + 3, full[i][1]]);
        }
        if (i % 3 === 0) for (const s of [-1, 1]) { const p = off(i, s * (wo - 0.1)); g.s.cbox(p[0], p[1] + 4.6, p[2], 0.25, 0.18, 0.8, { c: [1, 0.62, 0.25], mat: 18 }); }
      }
    });
  }
  // 坑口（ポータル）
  for (const [i, dir] of [[ia, 1], [ib, -1]]) {
    const p = full[i], d = pi.dirs[Math.min(i, pi.dirs.length - 1)], yaw = Math.atan2(d[0], d[1]), wo = hw + 0.9;
    city.add(p[0], p[1], g => {
      g.s.setXf(p[0], p[2], p[1], yaw);
      const fz = dir > 0 ? -0.5 : 0.5, c = { c: [0.7, 0.7, 0.68] };
      g.s.box(-wo - 9, -1, fz - 0.6, -wo, 14, fz + 0.6, c); g.s.box(wo, -1, fz - 0.6, wo + 9, 14, fz + 0.6, c);
      g.s.box(-wo, 6.6, fz - 0.6, wo, 14, fz + 0.6, c);
      g.s.panel(-3.5, fz - 0.62 * dir, 3.5, fz - 0.62 * dir, 7.5, 9.25, 0, [0, 0, -dir], { c: [1, 1, 1], mat: 16, lay: L.SG_TUNNEL }, dir > 0 ? undefined : [[1, 1], [0, 1], [0, 0], [1, 0]]);
      g.s.clearXf();
    });
  }
  // 休憩所（道の駅 みなせ峠）
  const pd = city.restPad;
  city.add((pd.x0 + pd.x1) / 2, (pd.z0 + pd.z1) / 2, g => {
    g.d1.flat(pd.x0, pd.z0, pd.x1, pd.z1, pd.y, { c: [0.95, 0.95, 0.95], mat: 7, lay: L.ASPHALT }, 8);
    g.s.box(pd.x0 + 4, pd.y, pd.z0 + 2, pd.x0 + 22, pd.y + 4.2, pd.z0 + 11, { c: [0.6, 0.45, 0.32], mat: 3, side: { lay: L.SHOP, tw: 6, th: 4.2 } });
    g.s.gable(pd.x0 + 4, pd.z0 + 2, pd.x0 + 22, pd.z0 + 11, pd.y + 4.2, 2.6, { c: [0.3, 0.32, 0.36], lay: L.KAWARA, tw: 2, gc: [0.6, 0.45, 0.32] });
    for (let k = 0; k < 3; k++) g.s.box(pd.x0 + 24 + k * 1.1, pd.y, pd.z0 + 2, pd.x0 + 25 + k * 1.1, pd.y + 1.8, pd.z0 + 2.8, { c: [0.85, 0.2 + k * 0.25, 0.2], mat: 18 });
    g.s.panel(pd.x0 + 7, pd.z0 + 11, pd.x0 + 19, pd.z0 + 11, pd.y + 4.4, pd.y + 7.4, 0.05, [0, 0, 1], { c: [1, 1, 1], mat: 16, lay: L.SG_MICHI });
    for (let k = 0; k < 6; k++) { const x = pd.x0 + 6 + k * 2.8; g.d2.flat(x - 0.06, pd.z1 - 6, x + 0.06, pd.z1 - 1, pd.y, { c: WHITE }); }
  });
  city.addBox(pd.x0 + 4, pd.z0 + 2, pd.x0 + 22, pd.z0 + 11);
  city.mm.lots.push({ x0: pd.x0, x1: pd.x1, z0: pd.z0, z1: pd.z1 });
  const Rp = rng(55);
  // 道の駅の中心から峠道へ出る通り道には駐車車両を置かない
  const pcx = (pd.x0 + pd.x1) / 2, pcz = (pd.z0 + pd.z1) / 2; let rx = pcx, rz = pcz; { let bd = 1e9; for (const q of full) { const d = Math.hypot(q[0] - pcx, q[1] - pcz); if (d < bd) { bd = d; rx = q[0]; rz = q[1]; } } }
  pd.exit = [rx, rz];
  const onPath = (x, z) => { const vx = rx - pcx, vz = rz - pcz, t = Math.max(0, Math.min(1, ((x - pcx) * vx + (z - pcz) * vz) / (vx * vx + vz * vz))); return Math.hypot(pcx + vx * t - x, pcz + vz * t - z) < 5; };
  for (let k = 0; k < 4; k++) if (Rp() < 0.7) { const m = pickModel(Rp), c = pickColor(m, Rp), x = pd.x0 + 7.4 + k * 2.8, z = pd.z1 - 3.5; if (onPath(x, z)) continue; city.addCarBox(x, z, Math.PI, m); city.add(x, z, g => city.bakeCar(g.det, m, c, x, z, Math.PI, pd.y)); }
  void e;
}
function conifer(gb, x, y, z, s, R) {
  const h = 9 * s, r = 2.4 * s, c = [0.55 + R() * 0.15, 0.75 + R() * 0.15, 0.55];
  gb.cyl(x, y - 0.5, z, 0.25 * s, 2.2 * s, 4, { c: [0.35, 0.27, 0.2] }, false);
  for (let k = 0; k < 6; k++) {
    const a0 = k / 6 * Math.PI * 2, a1 = (k + 1) / 6 * Math.PI * 2;
    gb.tri([x + Math.cos(a0) * r, y + 1.5 * s, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y + 1.5 * s, z + Math.sin(a1) * r], [x, y + h, z], { c, lay: L.TREE }, [0, 1], [1, 1], [0.5, 0], [x, y + h * 0.3, z]);
  }
}

// ============ 郊外住宅地 ============
function suburb(city, r, R, opt) {
  const W = r.x1 - r.x0, D = r.z1 - r.z0;
  if (W < 30 || D < 30) return;
  const nx = Math.max(1, Math.round(W / 120)), nz = Math.max(1, Math.round(D / 120));
  const xs = [], zs = [];
  for (let i = 1; i < nx; i++) xs.push(r.x0 + W * i / nx);
  for (let i = 1; i < nz; i++) zs.push(r.z0 + D * i / nz);
  // 生活道路（プレイヤー用）
  for (const x of xs) { city.add(x, (r.z0 + r.z1) / 2, g => g.d1.flat(x - 2.5, r.z0 - 2, x + 2.5, r.z1 + 2, 0, { c: [0.95, 0.95, 0.95], mat: 7, lay: L.ASPHALT }, 8)); city.mm.lanes.push({ axis: 'ns', c: x, a: r.z0, b: r.z1, w: 2.5, kind: 'lane' }); }
  for (const z of zs) { city.add((r.x0 + r.x1) / 2, z, g => g.d1.flat(r.x0 - 2, z - 2.5, r.x1 + 2, z + 2.5, 0, { c: [0.95, 0.95, 0.95], mat: 7, lay: L.ASPHALT }, 8)); city.mm.lanes.push({ axis: 'ew', c: z, a: r.x0, b: r.x1, w: 2.5, kind: 'lane' }); }
  const bx = [r.x0, ...xs.flatMap(x => [x - 2.5, x + 2.5]), r.x1], bz = [r.z0, ...zs.flatMap(z => [z - 2.5, z + 2.5]), r.z1];
  let special = 0;
  for (let i = 0; i < bx.length; i += 2) for (let j = 0; j < bz.length; j += 2) {
    const sb = { x0: bx[i], x1: bx[i + 1], z0: bz[j], z1: bz[j + 1] };
    const w = sb.x1 - sb.x0, d = sb.z1 - sb.z0; if (w < 25 || d < 25) continue;
    city.add((sb.x0 + sb.x1) / 2, (sb.z0 + sb.z1) / 2, g => g.s.flat(sb.x0, sb.z0, sb.x1, sb.z1, 0, { c: [0.8, 0.78, 0.7], lay: L.FIELD }, 6));
    const dep = 17;
    // 特別な区画（神社・学校・公園・マンション）
    if (opt.shrine && special === 0) { special++; shrine(city, sb); continue; }
    if (opt.school && special === 0 && w > 80 && d > 80) { special++; city.genFacility({ ...sb, R, bx: 0, bz: 0 }, 'E', 'n'); continue; }
    city.fillParcels({ x0: sb.x0, x1: sb.x1, z0: sb.z0, z1: sb.z0 + dep }, 'n', R);
    city.fillParcels({ x0: sb.x0, x1: sb.x1, z0: sb.z1 - dep, z1: sb.z1 }, 's', R);
    if (d - 2 * dep > 14) {
      city.fillParcels({ x0: sb.x0, x1: sb.x0 + dep, z0: sb.z0 + dep, z1: sb.z1 - dep }, 'w', R);
      city.fillParcels({ x0: sb.x1 - dep, x1: sb.x1, z0: sb.z0 + dep, z1: sb.z1 - dep }, 'e', R);
    }
    const ir = { x0: sb.x0 + dep + 1, x1: sb.x1 - dep - 1, z0: sb.z0 + dep + 1, z1: sb.z1 - dep - 1 };
    if (ir.x1 - ir.x0 > 20 && ir.z1 - ir.z0 > 20) {
      const k = R();
      if (k < 0.3) park(city, ir, R);
      else if (k < 0.55) { const f = city.frame(ir, 's'); city.building(f, 2, f.F - 2, 2, Math.min(f.D - 2, 18), { R, floors: 3 + (R() * 6 | 0), fh: 2.95, fh0: 0, lay: L.MANSION, tw: 13.6, th: 11.8, col: PAL_WALL[R() * 10 | 0] }); }
      else if (k < 0.8) city.add((ir.x0 + ir.x1) / 2, (ir.z0 + ir.z1) / 2, g => g.d1.flat(ir.x0, ir.z0, ir.x1, ir.z1, 0.02, { c: [0.85, 1, 0.85], lay: L.PADDY }, 10));
    }
  }
}
function park(city, r, R) {
  city.addBox(r.x1 - 7, r.z0 + 2, r.x1 - 3, r.z0 + 5); city.stats.parkToilets = (city.stats.parkToilets || 0) + 1;
  const trees = []; for (let k = 0; k < 8; k++) trees.push([r.x0 + 3 + R() * (r.x1 - r.x0 - 6), r.z0 + 3 + R() * (r.z1 - r.z0 - 6), R() * 1e6 | 0]);
  city.mm.lots.push(r);
  city.add((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, g => {
    g.d1.flat(r.x0, r.z0, r.x1, r.z1, 0.02, { c: [0.9, 1, 0.85], lay: L.GRASS }, 8);
    for (const [x, z, s] of trees) city.tree(g.det, x, z, rng(s));
    // ベンチ・トイレ・花壇
    for (const k of [0, 1]) { const bx = r.x0 + 4 + k * 6, bz = r.z1 - 3; g.s.box(bx, 0.4, bz - 0.25, bx + 1.8, 0.48, bz + 0.25, { c: [0.6, 0.42, 0.28] }); for (const dx of [0.1, 1.6]) g.s.box(bx + dx, 0, bz - 0.2, bx + dx + 0.1, 0.4, bz + 0.2, { c: [0.4, 0.4, 0.4] }); }
    g.s.box(r.x1 - 7, 0, r.z0 + 2, r.x1 - 3, 2.8, r.z0 + 5, { c: [0.85, 0.82, 0.75] }); g.s.box(r.x1 - 7.3, 2.8, r.z0 + 1.7, r.x1 - 2.7, 3.0, r.z0 + 5.3, { c: [0.4, 0.4, 0.42] });
    for (let k = 0; k < 4; k++) { const px = r.x0 + 3 + k * 3; g.s.box(px, 0, r.z0 + 1, px + 1.6, 0.5, r.z0 + 1.8, { c: [0.7, 0.68, 0.62] }); g.s.box(px + 0.1, 0.5, r.z0 + 1.1, px + 1.5, 0.75, r.z0 + 1.7, { c: [0.9, 0.4 + k * 0.1, 0.5], lay: L.TREE }); }
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    g.s.box(cx - 2, 0, cz - 0.3, cx + 2, 2.2, cz + 0.3, { c: [0.85, 0.3, 0.2] }); // ブランコ
    g.s.box(cx + 4, 0, cz - 1, cx + 6, 0.4, cz + 1, { c: [0.9, 0.8, 0.5] }); // 砂場
  });
}
function shrine(city, r) {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, R = rng(9);
  city.mm.lots.push(r);
  city.add(cx, cz, g => {
    g.d1.flat(r.x0, r.z0, r.x1, r.z1, 0.02, { c: [0.85, 0.8, 0.7], lay: L.FIELD }, 4);
    g.d1.flat(cx - 2, r.z1 - 1, cx + 2, cz + 6, 0.03, { c: [0.75, 0.73, 0.68], lay: L.SIDEWALK }, 2); // 参道
    const tz = r.z1 - 6, red = { c: [0.8, 0.18, 0.12] };
    for (const s of [-1, 1]) g.s.cyl(cx + s * 2.6, 0, tz, 0.25, 5.6, 8, red);
    g.s.box(cx - 3.8, 5.2, tz - 0.3, cx + 3.8, 5.6, tz + 0.3, { c: [0.15, 0.12, 0.1] });
    g.s.box(cx - 3.3, 4.4, tz - 0.22, cx + 3.3, 4.7, tz + 0.22, red);
    g.s.panel(cx - 0.6, tz + 0.23, cx + 0.6, tz + 0.23, 4.7, 5.15, 0.01, [0, 0, 1], { c: [1, 1, 1], mat: 16, lay: L.SG_SHRINE });
    // 拝殿
    g.s.box(cx - 5, 0, cz - 6, cx + 5, 3.6, cz + 2, { c: [0.55, 0.38, 0.25] });
    g.s.gable(cx - 5, cz - 6, cx + 5, cz + 2, 3.6, 3.2, { c: [0.25, 0.3, 0.28], lay: L.KAWARA, tw: 2, gc: [0.55, 0.38, 0.25] }, 1.2);
    for (const s of [-1, 1]) { g.s.cbox(cx + s * 2.2, 0.8, cz + 5, 0.5, 1.6, 0.5, { c: [0.7, 0.7, 0.68] }); g.s.cbox(cx + s * 2.2, 1.8, cz + 5, 0.7, 0.5, 0.7, { c: [0.7, 0.7, 0.68] }); }
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; city.tree(g.det, cx + Math.cos(a) * (r.x1 - r.x0) * 0.42, cz + Math.sin(a) * (r.z1 - r.z0) * 0.42, R); }
  });
  city.addBox(cx - 5, cz - 6, cx + 5, cz + 2);
  if (r.x1 - r.x0 > 90 && r.z1 - r.z0 > 70) cemetery(city, r.x0 + 22, r.z0 + 31); // 境内の一角に寺と墓地
  for (const s of [-1, 1]) city.addBox(cx + s * 2.6 - 0.3, r.z1 - 6.3, cx + s * 2.6 + 0.3, r.z1 - 5.7, 'p');
}

// ============ 工業団地 ============
function industrial(city, r, R) {
  const W = r.x1 - r.x0, D = r.z1 - r.z0, nx = 2, nz = 2;
  const truck = MODELS.find(m => m.name === '小型トラック(2t)');
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const sb = { x0: r.x0 + W * i / nx + 3, x1: r.x0 + W * (i + 1) / nx - 3, z0: r.z0 + D * j / nz + 3, z1: r.z0 + D * (j + 1) / nz - 3 };
    const side = j === 0 ? 'n' : 's', f = city.frame(sb, side);
    city.add((sb.x0 + sb.x1) / 2, (sb.z0 + sb.z1) / 2, g => g.s.flat(sb.x0 - 3, sb.z0 - 3, sb.x1 + 3, sb.z1 + 3, 0, { c: [0.85, 0.85, 0.83], lay: L.ROOF }, 10));
    const k = R(), sign = [L.SG_FACTORY, L.SG_SOKO, L.SG_INDUS2][R() * 3 | 0];
    if (k < 0.45) city.building(f, 8, f.F * 0.7, 30, f.D - 20, { R, floors: 1, fh: 9, fh0: 0, lay: L.METAL, tw: 6, th: 9, col: [0.85, 0.87, 0.86], roof: 'saw', sign, signY: 5, roofItems: false });
    else city.building(f, 8, f.F * 0.7, 30, f.D - 20, { R, floors: 1, fh: 11, fh0: 0, lay: L.METAL, tw: 6, th: 11, col: [0.78 + R() * 0.1, 0.8, 0.82], roof: 'gable', rise: 2, sign, signY: 7, roofItems: false });
    city.lot(f, f.F * 0.72, f.F - 4, 0, Math.min(60, f.D - 10), R, { fill: 0.5 });
    // 煙突・タンク
    const t = f.W(f.F * 0.35, f.D - 12);
    if (R() < 0.6) { (city.smokes = city.smokes || []).push([t[0], 36, t[1]]); city.addBox(t[0] - 1.6, t[1] - 1.6, t[0] + 1.6, t[1] + 1.6, 'p'); city.add(t[0], t[1], g => { for (let k2 = 0; k2 < 6; k2++) g.s.cyl(t[0], k2 * 6, t[1], 1.5, 6, 10, { c: k2 % 2 ? [0.85, 0.2, 0.15] : [0.95, 0.95, 0.95] }); }); }
    const t2 = f.W(f.F * 0.55, f.D - 10);
    if (R() < 0.5) { city.addBox(t2[0] - 6, t2[1] - 6, t2[0] + 6, t2[1] + 6); city.add(t2[0], t2[1], g => { g.s.cyl(t2[0], 0, t2[1], 6, 9, 14, { c: [0.85, 0.86, 0.84] }); }); }
    // トラック
    const ty = f.W(12, 14), yaw = Math.atan2(f.inv[0], f.inv[1]) + Math.PI / 2;
    for (let q = 0; q < 3; q++) { const p = f.W(12 + q * 5, 18); city.addCarBox(p[0], p[1], yaw, truck); city.add(p[0], p[1], g => city.bakeCar(g.det, truck, { rgb: q % 2 ? [0.95, 0.95, 0.95] : [0.6, 0.75, 0.85] }, p[0], p[1], yaw)); }
    void ty;
  }
}

// ============ 郊外ロードサイド（国道沿い） ============
const RS_LIST = ['DEALER', 'GYUDON', 'GAS2', 'PACHI', 'SUSHI', 'HOMEC', 'BOOKS2', 'DEALER2', 'CONBINI', 'TIRE', 'GAS', 'FAMIRES', 'MALL2', 'DRUG', 'DENKI', 'BURGER', 'SUPER', 'RAMEN', 'CONBINI2'];
let rsIdx = 0;
function roadside(city, r, R, side, xa) {
  const f = city.frame(r, side);
  let u = 2;
  while (u < f.F - 30) {
    const k = RS_LIST[rsIdx++ % RS_LIST.length], big = ['HOMEC', 'MALL2', 'DENKI', 'SUPER', 'PACHI'].includes(k);
    const w = k === 'MALL2' ? 170 : big ? 95 : 48 + R() * 14;
    if (u + w > f.F - 2) break;
    const ld = big ? 46 : 28, bd = k === 'MALL2' ? 70 : big ? 40 : 18;
    const sign = L['SG_' + k];
    if (k.startsWith('GAS')) { city.gasStation(f, u, u + 40, R, sign); u += 44; continue; }
    city.lot(f, u, u + w, 0, ld, R, { fill: k.startsWith('DEALER') ? 0.85 : 0.3, ai: !k.startsWith('DEALER'), sign, signH: big ? 8 : 6 });
    city.building(f, u + 3, u + w - 3, ld + 1, ld + 1 + bd, { R, floors: k === 'MALL2' ? 3 : 1, fh: k === 'MALL2' ? 5 : big ? 8 : 4.5, fh0: 0, lay: big ? L.METAL : L.SHOP, tw: 6, th: big ? 8 : 4.5, col: big ? [0.9, 0.9, 0.88] : [0.96, 0.95, 0.93], sign, signY: big ? 5 : 3, signH: big ? 4 : 1.8, roofItems: big });
    u += w + 4;
  }
  const back = city.frect(f, 0, f.F, 100, f.D);
  if (xa === 500) suburb(city, back, R, {}); else farm(city, back, R);
}

// ============ 田園地帯 ============
function farm(city, r, R) { if (!city.stats.riceCenter && r.x1 - r.x0 > 200 && r.z1 - r.z0 > 150 && r.z0 > 600) { farmCenter(city, r.x0 + 40, r.z0 + 30); return farmV4(city, { ...r, z0: r.z0 + 70 }, R); } return farmV4(city, r, R); }
function farmOld(city, r, R) {
  const W = r.x1 - r.x0, D = r.z1 - r.z0; if (W < 20 || D < 20) return;
  const pw = 42, pd = 32, cols = Math.floor(W / pw), rows = Math.floor(D / pd);
  // 農家の集落
  const hx = r.x0 + 20 + R() * (W - 70), hz = r.z0 + 20 + R() * (D - 70), hr = { x0: hx, x1: hx + 50, z0: hz, z1: hz + 40 };
  const tint = R() < 0.25 ? [1.1, 1.0, 0.6] : [0.95, 1.05, 0.95];
  city.add((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, g => {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x0 = r.x0 + i * pw + 1.2, z0 = r.z0 + j * pd + 1.2, x1 = x0 + pw - 2.4, z1 = z0 + pd - 2.4;
      if (x1 > hr.x0 - 2 && x0 < hr.x1 + 2 && z1 > hr.z0 - 2 && z0 < hr.z1 + 2) continue;
      const v = 0.92 + ((i * 7 + j * 3) % 5) * 0.03;
      g.d1.flat(x0, z0, x1, z1, -0.05, { c: [tint[0] * v, tint[1] * v, tint[2] * v], lay: (i + j) % 9 === 4 ? L.FIELD : L.PADDY }, 12);
    }
  });
  city.mm.green.push(r);
  // 屋敷林つきの農家
  const Rh = rng(R() * 1e6 | 0);
  for (let k = 0; k < 2; k++) {
    const x = hx + 4 + k * 24, z = hz + 8, w = 12 + Rh() * 3, d = 9 + Rh() * 2, wc = PAL_HOUSE[Rh() * 10 | 0], rc = PAL_ROOF[Rh() * 7 | 0];
    city.addBox(x, z, x + w, z + d); city.stats.houses++; city.mm.blds.push({ x0: x, x1: x + w, z0: z, z1: z + d });
    city.add(x, z, g => {
      g.s.box(x, 0, z, x + w, 5.6, z + d, { c: wc, mat: 3, side: { lay: L.HOUSE, tw: 7, th: 5.6 } });
      g.s.gable(x, z, x + w, z + d, 5.6, 2.8, { c: rc, lay: L.KAWARA, tw: 2, gc: wc }, 0.6);
    });
  }
  const sx = hx + 10, sz = hz + 26;
  city.addBox(sx, sz, sx + 12, sz + 8);
  const kt = MODELS.find(m => m.name === 'ハイゼットトラック');
  city.addCarBox(hx + 30, hz + 31, Math.PI / 2, kt);
  city.add(sx, sz, g => {
    g.s.box(sx, 0, sz, sx + 12, 4.5, sz + 8, { c: [0.7, 0.72, 0.74], side: { lay: L.METAL, tw: 6, th: 4.5 } });
    g.s.gable(sx, sz, sx + 12, sz + 8, 4.5, 1.6, { c: [0.55, 0.3, 0.25], lay: L.METAL, tw: 3 }, 0.3);
    city.bakeCar(g.det, kt, { rgb: [0.95, 0.95, 0.95] }, hx + 30, hz + 31, Math.PI / 2);
    for (let t = 0; t < 12; t++) { const a = t / 12 * Math.PI * 2; city.tree(g.det, hx + 25 + Math.cos(a) * 30, hz + 20 + Math.sin(a) * 24, Rh); }
  });
}
// ============ 河川敷 ============
function riverPark(city, r, R) {
  if (r.z1 - r.z0 < 6) return;
  city.mm.green.push(r);
  const trees = []; for (let x = r.x0 + 8; x < r.x1; x += 18) trees.push([x, r.z1 - 3]);
  city.add((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, g => {
    g.d1.flat(r.x0, r.z0, r.x1, r.z1, -0.05, { c: [0.9, 1, 0.85], lay: L.GRASS }, 8);
    g.d1.flat(r.x0, r.z0 + 2, r.x1, r.z0 + 4.5, -0.04, { c: [0.85, 0.8, 0.72], lay: L.SIDEWALK }, 2); // 遊歩道
    for (const [x, z] of trees) cherry(g.det, x, z, R, 0.9);
    for (let x = r.x0 + 40; x < r.x1 - 10; x += 120) g.s.box(x, 0, r.z0 + 5, x + 1.6, 0.45, r.z0 + 5.5, { c: [0.6, 0.45, 0.3] });
  });
  const p = [r.x0 + 6, r.z0 + 1];
  city.add(p[0], p[1], g => city.poleSign(g.det, p[0], p[1], city.frame(r, 'n'), L.SG_RIVERPARK, 3));
}

// ============ 鉄道 ============
function railway(city) {
  const RZ = -445, roadX = [...LINES, ...XL];
  const isRoad = x => roadX.some(c => Math.abs(x - c) < 14);
  for (let x0 = -2200; x0 < 2200; x0 += 100) {
    city.add(x0 + 50, RZ, g => {
      g.s.box(x0, 7, RZ - 5, x0 + 100, 8.2, RZ + 5, { c: [0.72, 0.72, 0.7] });
      g.s.box(x0, 8.2, RZ - 5, x0 + 100, 9.4, RZ - 4.7, { c: [0.72, 0.72, 0.7] }); g.s.box(x0, 8.2, RZ + 4.7, x0 + 100, 9.4, RZ + 5, { c: [0.72, 0.72, 0.7] });
      for (const zr of [-2.4, -0.9, 0.9, 2.4]) g.s.box(x0, 8.2, RZ + zr - 0.05, x0 + 100, 8.35, RZ + zr + 0.05, { c: [0.4, 0.35, 0.3] });
      for (let x = x0 + 10; x < x0 + 100; x += 25) if (!isRoad(x)) g.s.box(x - 1, -0.3, RZ - 2, x + 1, 7, RZ + 2, { c: [0.68, 0.68, 0.66] });
      for (let x = x0; x < x0 + 100; x += 50) g.s.cyl(x, 8.2, RZ + 4.5, 0.08, 6, 4, { c: [0.5, 0.5, 0.5] }, false);
      // 架線（各線路の中心の上）
      for (const zc of [-1.65, 1.65]) g.lines.line([x0, 13.0, RZ + zc], [x0 + 100, 13.0, RZ + zc], [0.15, 0.15, 0.15]);
      for (let x = x0; x < x0 + 100; x += 50) g.s.beam([x, 13.3, RZ - 4.5], [x, 13.3, RZ + 4.5], 0.05, { c: [0.5, 0.5, 0.5] });
      if (x0 >= 0 && x0 < 200) { // 水瀬駅の高架ホーム（相対式2面）
        g.s.box(x0 + 5, 14.0, RZ - 4.8, x0 + 95, 14.3, RZ + 4.8, { c: [0.55, 0.6, 0.62] });
        for (const s of [-1, 1]) {
          g.s.box(x0 + 5, 8.2, RZ + s * 3.15 - 0.7, x0 + 95, 9.25, RZ + s * 3.15 + 0.7, { c: [0.8, 0.8, 0.78], top: { lay: L.TACTILE, tw: 2 } });
          for (let x = x0 + 15; x < x0 + 95; x += 20) g.s.cyl(x, 9.25, RZ + s * 3.9, 0.08, 4.75, 6, { c: [0.6, 0.62, 0.64] });
          g.s.panel(x0 + 44, RZ + s * 3.6, x0 + 56, RZ + s * 3.6, 11.0, 12.5, 0, [0, 0, -s], { c: [1, 1, 1], mat: 16, lay: L.SG_STATION }, s > 0 ? undefined : [[1, 1], [0, 1], [0, 0], [1, 0]]);
          // 階段（ホームから地上へ）
          for (let k = 0; k < 10; k++) g.s.box(x0 + 70 + k * 1.6, 0, RZ + s * 5.2 - 0.9, x0 + 71.6 + k * 1.6, 9.25 - k * 0.92, RZ + s * 5.2 + 0.9, { c: [0.72, 0.72, 0.7] });
        }
      }
    });
    for (let x = x0 + 10; x < x0 + 100; x += 25) if (!isRoad(x)) city.addBox(x - 1, RZ - 2, x + 1, RZ + 2, 'p', -50, 7);
  }
}

// ============ 路面電車 ============
function tram(city) {
  const xs = LINES;
  const east = [], west = [];
  for (let i = 0; i < xs.length - 1; i++) { east.push(city.edgeXY(xs[i], 0, xs[i + 1], 0)); west.unshift(city.edgeXY(xs[i + 1], 0, xs[i], 0)); }
  city.tramRoute = { east, west };
  const rails = [0.53, -0.53];
  for (const e of [...east, ...west]) {
    const mid = city.edgePt(e, e.len / 2, 0);
    city.add(mid[0], mid[2], g => {
      const o = e.base + 0.5 * e.lw;
      for (const r of rails) city.band(g.d2, e, -6, e.len + 6, o + r - 0.04, o + r + 0.04, { c: [0.5, 0.5, 0.53] });
      // 架線柱と架線
      for (let s = 10; s < e.len; s += 30) {
        const p = city.edgePt(e, s, e.sp.hw + 1.2);
        g.s.cyl(p[0], 0, p[2], 0.12, 6.4, 6, { c: [0.45, 0.5, 0.45] });
        const q = city.edgePt(e, s, o);
        g.lines.line([p[0], 6.0, p[2]], [q[0], 5.7, q[2]], [0.15, 0.15, 0.15]);
      }
      const a = city.edgePt(e, -6, o), b = city.edgePt(e, e.len + 6, o);
      g.lines.line([a[0], 5.6, a[2]], [b[0], 5.6, b[2]], [0.12, 0.12, 0.12]);
    });
    for (let s = 10; s < e.len; s += 30) { const p = city.edgePt(e, s, e.sp.hw + 1.2); city.addBox(p[0] - 0.2, p[2] - 0.2, p[0] + 0.2, p[2] + 0.2, 'p'); }
  }
  // 電停（各方向3か所）
  for (const [list, idx] of [[east, [1, 3, 6]], [west, [1, 4, 6]]]) for (const k of idx) {
    const e = list[k], s = e.len * 0.5;
    city.tramStops.push({ e: e.id, s });
    const o = e.base + 0.5 * e.lw, p = city.edgePt(e, s, e.sp.hw + 0.8);
    city.add(p[0], p[2], g => {
      city.band(g.d2, e, s - 9, s + 9, o - 1.5, o - 1.35, { c: YEL }); city.band(g.d2, e, s - 9, s + 9, o + 1.35, o + 1.5, { c: YEL });
    });
  }
}
