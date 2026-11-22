// 人物（運転者・歩行者）と二輪車のローポリモデル、歩行者の簡易AI
// 運転者は 年代3 × 性別2 × 服装3 = 18 通りをパラメータから生成（実在人物・キャラクターではない汎用の人形）
import { rng } from './math.js';

export const AGES = ['若年', '中年', 'シニア'], SEXES = ['男性', '女性'], OUTFITS = ['カジュアル', 'スーツ', '作業着'];
const SKIN = [[0.93, 0.78, 0.66], [0.88, 0.72, 0.6], [0.85, 0.7, 0.6]];
const HAIR = [[0.12, 0.09, 0.07], [0.2, 0.15, 0.1], [0.72, 0.72, 0.7]];
function outfitCols(o, R) {
  if (o === 1) return { top: [0.14, 0.17, 0.28], inner: [0.95, 0.95, 0.95], leg: [0.2, 0.21, 0.26], shoe: [0.08, 0.07, 0.06] };
  if (o === 2) return { top: [0.35, 0.42, 0.3], inner: [0.3, 0.36, 0.26], leg: [0.25, 0.28, 0.22], shoe: [0.15, 0.12, 0.1] };
  const tops = [[0.85, 0.3, 0.25], [0.25, 0.5, 0.75], [0.95, 0.92, 0.85], [0.4, 0.6, 0.4], [0.9, 0.75, 0.3], [0.55, 0.4, 0.6]];
  return { top: tops[R() * tops.length | 0], inner: [0.95, 0.95, 0.95], leg: [0.25, 0.32, 0.5], shoe: [0.85, 0.85, 0.85] };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// pose: 'sit'（運転席。hands=[左手, 右手]の目標位置）/ 'walk0' / 'walk1' / 'stand' / 'ride'
export function buildPerson(gb, p) {
  const R = rng((p.seed || 1) * 97 + p.age * 13 + p.sex * 7 + p.outfit), sex = p.sex, age = p.age;
  const H = (sex ? 1.58 : 1.71) * (age === 2 ? 0.97 : 1), k = H / 1.7, skin = { c: SKIN[age] }, hair = { c: HAIR[age === 2 ? 2 : R() < 0.2 ? 1 : 0] };
  const C = outfitCols(p.outfit, R), top = { c: C.top }, leg = { c: C.leg }, shoe = { c: C.shoe };
  const pose = p.pose || 'stand', sit = pose === 'sit' || pose === 'ride';
  const hipY = sit ? 0 : 0.86 * k, sw = pose === 'walk0' ? 1 : pose === 'walk1' ? -1 : 0;
  const lean = sit ? -0.12 : 0.02 * Math.abs(sw); // 座ると背もたれに寄りかかる
  const shY = hipY + 0.5 * k, neck = [0, shY + 0.04 * k, lean * 0.5 * k], hw = (sex ? 0.17 : 0.2) * k;
  // 胴体（上着）・腰
  gb.box(-hw, hipY, -0.11 * k + lean * 0.3, hw, shY, 0.11 * k + lean * 0.3, top);
  if (p.outfit === 1) gb.box(-0.05 * k, shY - 0.18 * k, 0.11 * k + lean * 0.3, 0.05 * k, shY, 0.115 * k + lean * 0.3, { c: C.inner }); // シャツの襟元
  gb.box(-hw * 0.95, hipY - 0.1 * k, -0.11 * k, hw * 0.95, hipY + 0.02, 0.11 * k, leg);
  // 頭・髪
  const hy = shY + 0.06 * k, hz = lean * 0.6 * k;
  gb.box(-0.085 * k, hy, hz - 0.1 * k, 0.085 * k, hy + 0.22 * k, hz + 0.1 * k, skin);
  gb.box(-0.095 * k, hy + 0.15 * k, hz - 0.115 * k, 0.095 * k, hy + 0.255 * k, hz + 0.09 * k, hair);
  if (sex) gb.box(-0.1 * k, hy + 0.02 * k, hz - 0.13 * k, 0.1 * k, hy + 0.2 * k, hz - 0.04 * k, hair); // 長い後ろ髪
  else gb.box(-0.095 * k, hy + 0.08 * k, hz - 0.12 * k, 0.095 * k, hy + 0.17 * k, hz - 0.07 * k, hair);
  if (age === 2 && !sex) gb.box(-0.06 * k, hy + 0.09 * k, hz + 0.1 * k, 0.06 * k, hy + 0.12 * k, hz + 0.105 * k, { c: [0.2, 0.2, 0.2] }); // 眼鏡
  if (p.helmet) gb.box(-0.12 * k, hy + 0.1 * k, hz - 0.13 * k, 0.12 * k, hy + 0.3 * k, hz + 0.13 * k, { c: p.helmet });
  // 脚
  for (const s of [-1, 1]) {
    const hx = s * hw * 0.5;
    if (sit) { const knee = [hx, hipY + 0.05, 0.42 * k], foot = [hx * 1.1, hipY - 0.38 * k, 0.55 * k]; gb.beam([hx, hipY, 0.02], knee, 0.075 * k, leg); gb.beam(knee, foot, 0.065 * k, leg); gb.cbox(foot[0], foot[1] + 0.03, foot[2] + 0.06, 0.1 * k, 0.07, 0.22 * k, shoe); }
    else { const a = sw * s * 0.38, knee = [hx, hipY * 0.5, Math.sin(a) * hipY * 0.5], foot = [hx, 0.05, Math.sin(a) * hipY * 0.85 + (a < 0 ? -0.04 : 0.04)]; gb.beam([hx, hipY, 0], knee, 0.07 * k, leg); gb.beam(knee, foot, 0.06 * k, leg); gb.cbox(foot[0], 0.04, foot[2] + 0.05, 0.1 * k, 0.08, 0.24 * k, shoe); }
  }
  // 腕（運転中はハンドルを握る）
  for (const s of [-1, 1]) {
    const sh = [s * (hw + 0.035 * k), shY - 0.05 * k, lean * 0.3 * k];
    let hand;
    if (p.hands) hand = p.hands[s < 0 ? 0 : 1];
    else { const a = -sw * s * 0.45; hand = [s * (hw + 0.06 * k), shY - 0.55 * k, Math.sin(a) * 0.5 * k]; }
    const mid = [(sh[0] + hand[0]) / 2 + s * 0.06 * k, (sh[1] + hand[1]) / 2 - 0.05 * k, (sh[2] + hand[2]) / 2 - (p.hands ? 0.05 : 0)];
    gb.beam(sh, mid, 0.06 * k, top); gb.beam(mid, hand, 0.05 * k, p.outfit === 1 ? top : top);
    gb.cbox(hand[0], hand[1], hand[2], 0.08 * k, 0.08 * k, 0.09 * k, skin);
  }
  return { H, eyeY: hy + 0.13 * k, eyeZ: hz + 0.1 * k };
}
// 運転者：目の位置 eye（車体座標）と、ハンドル中心 steer から、座面基準のモデルを置く
export function buildDriver(gb, sel, eye, steer, steerR = 0.18) {
  const tmp = { age: sel.age, sex: sel.sex, outfit: sel.outfit, pose: 'sit', seed: 3 };
  // まず仮に作って目の高さを測り、目が eye に来るよう平行移動
  const probe = buildPerson({ box() { }, beam() { }, cbox() { } }, tmp);
  const ox = eye[0], oy = eye[1] - probe.eyeY, oz = eye[2] - probe.eyeZ;
  const hands = [[steer[0] - ox - steerR * 0.9, steer[1] - oy + 0.04, steer[2] - oz - 0.03], [steer[0] - ox + steerR * 0.9, steer[1] - oy + 0.04, steer[2] - oz - 0.03]];
  gb.setXf(ox, oy, oz, 0); buildPerson(gb, { ...tmp, hands }); gb.clearXf();
}
export function buildBike(gb, rgb, rider = true, seed = 1) { // 自転車＋乗員（原点＝車体中心、+z前）
  const c = { c: rgb, mat: 1 }, blk = { c: [0.1, 0.1, 0.1] };
  for (const z of [-0.55, 0.55]) gb.cylX(0, 0.34, z, 0.34, 0.04, 8, blk, false);
  gb.beam([0, 0.34, -0.55], [0, 0.82, 0.05], 0.025, c); gb.beam([0, 0.82, 0.05], [0, 0.34, 0.55], 0.025, c); gb.beam([0, 0.45, -0.12], [0, 0.88, -0.25], 0.025, c);
  gb.beam([0, 0.82, 0.4], [0, 1.0, 0.45], 0.02, c); gb.box(-0.28, 0.98, 0.42, 0.28, 1.02, 0.48, blk); gb.cbox(0, 0.9, -0.25, 0.12, 0.05, 0.22, blk);
  gb.cbox(0, 0.88, 0.62, 0.3, 0.2, 0.25, { c: [0.4, 0.4, 0.42] });
  if (rider) { const R = rng(seed); gb.setXf(0, 0.92, -0.3, 0); buildPerson(gb, { age: R() * 3 | 0, sex: R() < 0.5 ? 1 : 0, outfit: R() < 0.7 ? 0 : 2, pose: 'ride', seed, hands: [[-0.26, 0.1, 0.72], [0.26, 0.1, 0.72]] }); gb.clearXf(); }
}
export function buildMoto(gb, rgb, seed = 1) { // 原付スクーター＋乗員（ヘルメット）
  const c = { c: rgb, mat: 1 }, blk = { c: [0.1, 0.1, 0.1] };
  for (const z of [-0.62, 0.62]) gb.cylX(0, 0.25, z, 0.25, 0.1, 10, blk);
  gb.box(-0.2, 0.3, -0.75, 0.2, 0.7, 0.1, c); gb.box(-0.16, 0.3, 0.1, 0.16, 0.5, 0.5, c); gb.box(-0.18, 0.5, 0.42, 0.18, 1.05, 0.62, c);
  gb.box(-0.17, 0.7, -0.6, 0.17, 0.8, 0.05, blk); gb.box(-0.33, 1.02, 0.5, 0.33, 1.06, 0.56, blk);
  gb.cbox(0, 0.92, 0.63, 0.16, 0.1, 0.03, { c: [1, 1, 0.9], mat: 2 }); gb.cbox(0, 0.62, -0.76, 0.14, 0.06, 0.03, { c: [0.9, 0.1, 0.1], mat: 4 });
  const R = rng(seed); gb.setXf(0, 0.82, -0.32, 0); buildPerson(gb, { age: R() < 0.5 ? 0 : 1, sex: R() < 0.3 ? 1 : 0, outfit: R() < 0.5 ? 0 : 2, pose: 'ride', seed, helmet: [[0.9, 0.9, 0.9], [0.15, 0.15, 0.15], [0.8, 0.15, 0.1]][R() * 3 | 0], hands: [[-0.3, 0.22, 0.8], [0.3, 0.22, 0.8]] }); gb.clearXf();
}

// ---- 歩行者：歩道を歩き、角では引き返すか立ち止まる。車が近づくと道をあける ----
export class Peds {
  constructor(city, R) { this.city = city; this.R = R; this.list = []; this.cand = []; this.ct = 0; this.target = 0; }
  update(dt, player, hour, zone, perfK, rain) {
    const city = this.city, R = this.R, px = player.x, pz = player.z;
    const base = { center: 26, res: 14, sub: 6, farm: 2, mtn: 0 }[zone] ?? 4;
    const tf = hour < 5 ? 0.1 : hour < 7 ? 0.4 : hour < 20 ? 1 : hour < 23 ? 0.5 : 0.2;
    this.target = Math.round(base * tf * Math.max(0.5, perfK) * (rain ? 0.6 : 1));
    this.ct -= dt;
    if (this.ct <= 0) { // 近くの歩道候補
      this.ct = 1.5; this.cand = [];
      for (const e of city.edges) { if (!e.straight || e.sp.sw <= 0) continue; const a = city.edgePt(e, 0, 0); for (let s = 6; s < e.len - 6; s += 15) { const x = a[0] + e.d[0] * s, z = a[2] + e.d[1] * s, d = Math.hypot(x - px, z - pz); if (d > 40 && d < 140) this.cand.push([e, s]); } }
    }
    if (this.list.length < this.target && this.cand.length) {
      const [e, s] = this.cand[R() * this.cand.length | 0], sp = e.sp, o = sp.hw + 0.6 + R() * Math.max(0.2, sp.sw - 1.2);
      const p = city.edgePt(e, s, o);
      if (!city.inDrive(p[0], p[2], 0.3)) this.list.push({ e, s, o, dir: R() < 0.5 ? 1 : -1, v: 1.1 + R() * 0.5, t: R() * 9, wait: 0, type: R() * 12 | 0, x: p[0], z: p[2], yaw: 0, dodge: 0 });
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const q = this.list[i], e = q.e;
      if (Math.hypot(q.x - px, q.z - pz) > 180) { this.list.splice(i, 1); continue; }
      if (q.wait > 0) { q.wait -= dt; q.moving = false; }
      else {
        q.s += q.dir * q.v * dt; q.t += dt * q.v * 1.6; q.moving = true;
        if (q.s < 2 || q.s > e.len - 2) { q.s = Math.max(2, Math.min(e.len - 2, q.s)); q.wait = R() < 0.5 ? 2 + R() * 6 : 0; q.dir = -q.dir; } // 角で立ち止まる（信号待ち）→ 引き返す
        else if (R() < dt * 0.02) q.wait = 2 + R() * 5; // 店先などで立ち止まる
      }
      let p = city.edgePt(e, q.s, q.o);
      // 車が近づいたら道をあける（歩道に乗り上げてきた場合も）
      const dx = p[0] - player.x, dz = p[2] - player.z, d = Math.hypot(dx, dz);
      if (d < 3.2 && Math.abs(player.vx) > 0.3) q.dodge = Math.min(2.2, q.dodge + dt * 3); else q.dodge = Math.max(0, q.dodge - dt * 0.5);
      if (q.dodge > 0) { const sg = (dx * e.d[1] - dz * e.d[0]) >= 0 ? 1 : -1; p = city.edgePt(e, q.s, q.o + sg * q.dodge); }
      q.x = p[0]; q.z = p[2]; q.yaw = Math.atan2(e.d[0] * q.dir, e.d[1] * q.dir);
    }
  }
}
