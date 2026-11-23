// プレイヤー車両（ミライース）の物理：自転車モデル＋タイヤ横力（摩擦円）＋CVT
// v0.3：後退旋回の修正、クリープ／坂道、壁でのスライド、路面種別、スタック自動復帰
import { clamp } from './math.js';
import { MIRA } from './carmodels.js';

// 路面種別：0=草地・畑 1=舗装 2=歩道 3=砂利・敷地
// 路面：草地・砂利は少し滑りやすいだけで、速度の上限（抵抗による頭打ち）は設けない
const SURF = { 0: { mu: 0.75, rr: 0.02, drag: 0 }, 1: { mu: 1, rr: 0.012, drag: 0 }, 2: { mu: 0.95, rr: 0.015, drag: 0 }, 3: { mu: 0.88, rr: 0.016, drag: 0 } };

export class Player {
  constructor(city) {
    this.city = city;
    this.p = MIRA;
    this.m = 670 + 75;          // 車重670kg＋乗員
    this.a = 0.98; this.b = MIRA.wb - 0.98; // 重心〜前後軸（FFで前寄り）
    this.Iz = this.m * this.a * this.b * 1.05;
    this.reset(0, 0, 0);
    this.input = { thr: 0, brk: 0, steer: 0 };
    this.assist = true;
  }
  reset(x, z, yaw, cy = 0.5) {
    Object.assign(this, { x, z, y: this.city ? this.city.groundY(x, z, cy) : 0, yaw, vx: 0, vy: 0, w: 0, steer: 0, rpm: 800, gear: 'D', pitch: 0, roll: 0, pv: 0, rv: 0, wheelRot: 0, slip: 0, hit: 0, accel: 0, braking: false, stopT: 0, holdT: 0, stuckT: 0, stuckP: [x, z], surf: 1, aeb: 0, gearReq: false, gearResult: null, wallPivot: 0, needRescue: false });
    this.onReset && this.onReset(); // 表示（ギア表示・Rボタン）を実状態に合わせる
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get kmh() { return Math.abs(this.vx) * 3.6; }
  step(dt, env, npcs) {
    this.T0 = (this.T0 || 0) + dt;
    const inp = this.input, g = 9.81;
    // 路面（雨は濡れ具合で連続的にグリップ低下）
    const surf = this.city.surfaceAt ? this.city.surfaceAt(this.x, this.z, this.y) : 1;
    if (surf === 2 && this.surf === 1 && Math.abs(this.vx) > 3) { this.vx *= 0.82; this.hit = Math.max(this.hit, 0.2); this.curb = 1; } // 縁石に乗り上げ
    this.surf = surf;
    const S = SURF[surf], mu = S.mu * (1 - 0.28 * (env.wet || 0));
    const v = this.vx;
    if (this.gearReq) { this.gearResult = Math.abs(v) < 1.0 ? 'ok' : 'ng'; if (this.gearResult === 'ok') this.gear = this.gear === 'D' ? 'R' : 'D'; this.gearReq = false; }
    let thr = inp.thr, brk = Math.max(inp.brk, this.aeb || 0);
    const dir = this.gear === 'R' ? -1 : 1;
    // ステアリング（速度感応・簡単操作向け）
    const maxSt = 0.55 / (1 + Math.abs(v) * 0.055);
    const target = inp.steer * maxSt;
    const rate = (Math.abs(target) > Math.abs(this.steer) ? 1.6 : 2.8);
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    // エンジン（3気筒658cc 36kW/6800rpm、CVT）
    const P = 36000 * 0.86, Fmax = 3100;
    let Fdrive = 0;
    if (thr > 0) {
      if (dir > 0 && v < -0.3) { brk = Math.max(brk, thr); thr = 0; }
      else if (dir < 0 && v > 0.3) { brk = Math.max(brk, thr); thr = 0; }
      else Fdrive = dir * thr * Math.min(Fmax, P / Math.max(Math.abs(v), 2.5));
      if (dir < 0) Fdrive = clamp(Fdrive, -1400, 0);
      // 速度の目安（千葉指示）：草地・砂利の農道は約50km/h、住宅街は約70km/h でアクセルが効かなくなる（ブレーキはかけない）
      const cap = (surf === 0 || surf === 3) ? 50 / 3.6 : this.zoneCap || 0;
      if (cap && Math.abs(v) > cap - 1.5) Fdrive *= clamp((cap - Math.abs(v)) / 1.5, 0, 1);
    }
    // クリープ：ブレーキを離しているときだけ（AT/CVT車の挙動）
    const creep = thr < 0.05 && brk < 0.05;
    if (creep && Math.abs(v) < 1.6) Fdrive = dir * 300;
    if (dir > 0 && v * 3.6 > 140) Fdrive = Math.min(Fdrive, 0); // リミッター
    if (dir < 0 && v < -6) Fdrive = 0;
    const Frr = S.rr * this.m * g * Math.sign(v), Fdrag = (0.5 * 1.2 * 0.32 * 1.95 + S.drag) * v * Math.abs(v);
    const Fbrk = brk * this.m * g * 0.75 * Math.min(1, mu / 0.9); // 乾燥時最大0.75g。雨は摩擦側だけで低下
    const Feb = thr < 0.05 ? 260 * Math.sign(v) * Math.min(1, Math.abs(v) / 3) : 0;
    // タイヤ横力：低速では速度に応じて弱め、運動学モデルに任せる（後退旋回で固まる不具合の修正）
    const lowK = clamp((Math.abs(v) - 0.5) / 2.5, 0, 1);
    const vxa = Math.max(Math.abs(v), 1.0);
    const Nf = this.m * g * this.b / MIRA.wb, Nr = this.m * g * this.a / MIRA.wb;
    const Cf = 52000, Cr = 58000;
    const af = Math.atan2(this.vy + this.w * this.a, vxa) - this.steer * Math.sign(v || dir);
    const ar = Math.atan2(this.vy - this.w * this.b, vxa);
    const fxf = Math.min(Math.abs(Fdrive), mu * Nf * 0.9) + Fbrk * 0.65;
    const fyfMax = Math.sqrt(Math.max(0, (mu * Nf) ** 2 - fxf ** 2)) + 200, fyrMax = mu * Nr;
    const Fyf = clamp(-Cf * af, -fyfMax, fyfMax) * lowK, Fyr = clamp(-Cr * ar, -fyrMax, fyrMax) * lowK;
    this.slip = Math.max(Math.abs(Fyf) / (fyfMax + 1) > 0.98 && Math.abs(v) > 8 ? 1 : 0, (Math.abs(Fyr) / (fyrMax + 1) > 0.98 && Math.abs(v) > 6) ? 1 : 0);
    // 坂道：重力の進行方向成分
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), cy = this.y + 0.5;
    const gF = this.city.groundY(this.x + fx * 1.2, this.z + fz * 1.2, cy), gB = this.city.groundY(this.x - fx * 1.2, this.z - fz * 1.2, cy);
    this.slope = clamp((gF - gB) / 2.4, -0.4, 0.4);
    const Fg = this.m * g * Math.sin(Math.atan(this.slope));
    // 坂道発進補助：ブレーキを離してから1秒は保持し、その後はクリープに負ければゆっくりずり下がる
    if (brk > 0.05) this.holdT = 1.0; else this.holdT = Math.max(0, this.holdT - dt);
    const hold = (brk > 0.05 && Math.abs(Fg) < Fbrk + 50) || (this.holdT > 0 && thr < 0.05 && Math.abs(v) < 0.2);
    let Fx = Fdrive - Frr - Fdrag - Feb - Fyf * Math.sin(this.steer) - (hold && Math.abs(v) < 0.1 ? 0 : Fg);
    const ax = Fx / this.m + this.vy * this.w;
    const bAcc = Fbrk / this.m;
    let nvx = v + ax * dt;
    if (bAcc > 0) { if (Math.abs(nvx) <= bAcc * dt) nvx = 0; else nvx -= Math.sign(nvx) * bAcc * dt; }
    if (hold && Math.abs(nvx) < 0.05) nvx = 0;
    this.accel = (nvx - v) / dt;
    this.vx = nvx;
    // 横・ヨー
    const ay = (Fyf * Math.cos(this.steer) + Fyr) / this.m - this.vx * this.w;
    const aw = (this.a * Fyf * Math.cos(this.steer) - this.b * Fyr) / this.Iz;
    this.vy += ay * dt; this.w += aw * dt;
    const piv = (this.wallPivot || 0) > 0; if (piv) this.wallPivot -= dt; // 壁際での向き変え中は低速の運動学的な補正をかけない
    const kin = piv ? 0 : clamp(1 - (Math.abs(this.vx) - 1.5) / 3, 0, 1);
    if (kin > 0) {
      const wk = this.vx * Math.tan(this.steer) / MIRA.wb;
      this.w += (wk - this.w) * kin; this.vy *= 1 - kin;
    }
    if (this.assist && !piv) { this.vy *= 1 - Math.min(1, dt * 2.5); const wk = this.vx * Math.tan(this.steer) / MIRA.wb; this.w += (wk - this.w) * Math.min(1, dt * 2.0); }
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const ox = this.x, oz = this.z;
    this.yaw += this.w * dt;
    this.x += (s * this.vx + c * this.vy) * dt;
    this.z += (c * this.vx - s * this.vy) * dt;
    this.collide(ox, oz, npcs, dt);
    const latA = this.vx * this.w;
    const kp = 60, cp = 9;
    this.pv += (-kp * (this.pitch - clamp(-this.accel * 0.006, -0.05, 0.05)) - cp * this.pv) * dt; this.pitch += this.pv * dt;
    this.slopeV = (this.slopeV || 0) + (-Math.atan(this.slope || 0) - (this.slopeV || 0)) * Math.min(1, dt * 10);
    this.rv += (-kp * (this.roll - clamp(latA * 0.006, -0.06, 0.06)) - cp * this.rv) * dt; this.roll += this.rv * dt;
    this.wheelRot += this.vx * dt / MIRA.r;
    const gy = this.city.groundY(this.x, this.z, this.y + 0.5); this.y += (gy - this.y) * Math.min(1, dt * 12);
    const kmh = Math.abs(this.vx) * 3.6;
    let rt = kmh < 1 ? 800 + thr * 1800 : Math.max(1100 + kmh * 22, 1500 + thr * (2600 + kmh * 28));
    if (thr < 0.05 && kmh > 5) rt = 1000 + kmh * 18;
    rt = Math.min(rt, 6800);
    this.rpm += (rt - this.rpm) * Math.min(1, dt * 4);
    // ブレーキランプ：ブレーキ入力中か、完全停止直後1秒だけ
    if (Math.abs(this.vx) < 0.05) this.stopT += dt; else this.stopT = 0;
    this.braking = brk > 0.05 || (this.stopT > 0 && this.stopT < 1);
    // スタック検出：アクセルを踏んでいるのに3秒まったく動けない
    if (thr > 0.5) {
      this.stuckT += dt;
      if (Math.hypot(this.x - this.stuckP[0], this.z - this.stuckP[1]) > 0.6) { this.stuckT = 0; this.stuckP = [this.x, this.z]; }
      if (this.stuckT > 3) { this.stuckT = 0; this.stuckP = [this.x, this.z]; this.needRescue = true; }
    } else { this.stuckT = 0; this.stuckP = [this.x, this.z]; }
  }
  corners() {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), hl = MIRA.L / 2, hw = MIRA.W / 2, out = [];
    for (const [lx, lz] of [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl], [hw, 0], [-hw, 0], [0, hl], [0, -hl]]) out.push([this.x + lx * c + lz * s, this.z - lx * s + lz * c]);
    return out;
  }
  collide(ox, oz, npcs, dt = 0.008) {
    const city = this.city;
    // 市の外周と川：見えない壁として扱い、壁と同じく法線方向だけ止めて滑らせる（位置を戻して止める方式だと抜け出せなくなる）
    { const Lb = 2040; let bn = null;
      for (const p of this.corners()) {
        let nx = 0, nz = 0, d = 0;
        if (p[0] > Lb) { nx = -1; d = p[0] - Lb; } else if (p[0] < -Lb) { nx = 1; d = -Lb - p[0]; }
        else if (p[1] > Lb) { nz = -1; d = p[1] - Lb; } else if (p[1] < -Lb) { nz = 1; d = -Lb - p[1]; }
        else if (p[1] > 530 && p[1] < 600 && this.y < 0.6 && !(city.bridges || []).some(b => Math.abs(p[0] - b.x) < b.hw + 0.4)) { if (this.z < 565) { nz = -1; d = p[1] - 530; } else { nz = 1; d = 600 - p[1]; } }
        if (d > 0 && (!bn || d > bn.d)) bn = { nx, nz, d, river: Math.abs(p[0]) <= Lb && Math.abs(p[1]) <= Lb };
      }
      if (bn) { this.x += bn.nx * bn.d; this.z += bn.nz * bn.d; this.contact(bn.nx, bn.nz, bn.d, dt); this.edgeHit = bn.river ? 2 : 1; }
    }
    for (let it = 0; it < 2; it++) {
      const boxes = city.query(this.x, this.z, 3);
      let pushX = 0, pushZ = 0;
      const yy = this.y;
      for (const p of this.corners()) for (const b of boxes) {
        if (yy + 1.3 < b.y0 || yy + 0.35 > b.y1 || b.kind === 'p') continue;
        if (b.nb != null && !city.shopCarsOn(b.nb, this.hour ?? 12)) continue; // 閉店後に帰った駐車車両 // 高さ35cm未満の段差（縁石・水路の縁など）は乗り越えられる
        if (p[0] > b.x0 && p[0] < b.x1 && p[1] > b.z0 && p[1] < b.z1) {
          const dl = p[0] - b.x0, dr = b.x1 - p[0], dt2 = p[1] - b.z0, db = b.z1 - p[1], m = Math.min(dl, dr, dt2, db);
          let px = 0, pz = 0;
          if (m === dl) px = -dl; else if (m === dr) px = dr; else if (m === dt2) pz = -dt2; else pz = db;
          if (Math.abs(px) > Math.abs(pushX)) pushX = px; if (Math.abs(pz) > Math.abs(pushZ)) pushZ = pz;
        }
      }
      // 柱・樹木・標識など（円柱として扱う）
      for (const b of boxes) if (b.kind === 'p' && !(yy + 1.3 < b.y0 || yy > b.y1)) {
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, r = Math.max(0.25, (b.x1 - b.x0) / 2);
        const c = Math.cos(this.yaw), s = Math.sin(this.yaw), dx = cx - this.x, dz = cz - this.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c, hw = MIRA.W / 2 + r, hl = MIRA.L / 2 + r;
        if (Math.abs(lx) < hw && Math.abs(lz) < hl) {
          const pl = hw - Math.abs(lx), pf = hl - Math.abs(lz);
          if (pl < pf) { const k = -Math.sign(lx) * pl; pushX += k * c; pushZ += -k * s; } else { const k = -Math.sign(lz) * pf; pushX += k * s; pushZ += k * c; }
        }
      }
      if (pushX || pushZ) { this.x += pushX; this.z += pushZ; const l = Math.hypot(pushX, pushZ); this.contact(pushX / l, pushZ / l, l, dt); } else break;
    }
    // 線分の壁：法線方向だけ止め、接線方向には滑る
    for (const w of this.city.wallsNear(this.x, this.z, 4)) {
      if (this.y + 1.2 < w.y0 || this.y > w.y1) continue;
      const vx = w.x1 - w.x0, vz = w.z1 - w.z0, L2 = vx * vx + vz * vz || 1;
      for (const p of this.corners()) {
        const t = clamp(((p[0] - w.x0) * vx + (p[1] - w.z0) * vz) / L2, 0, 1), qx = p[0] - (w.x0 + vx * t), qz = p[1] - (w.z0 + vz * t), d = Math.hypot(qx, qz);
        if (d < 0.25) {
          let nx, nz;
          const cx = this.x - (w.x0 + vx * t), cz = this.z - (w.z0 + vz * t), cl = Math.hypot(cx, cz) || 1;
          if (d > 1e-5) { nx = qx / d; nz = qz / d; if (nx * cx + nz * cz < 0) { nx = -nx; nz = -nz; } } else { nx = cx / cl; nz = cz / cl; }
          const k = 0.25 - d; this.x += nx * k; this.z += nz * k; this.contact(nx, nz, k, dt);
        }
      }
    }
    // NPC車両：車体中心どうしを結ぶ方向に確実に押し分け、相手も止める
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const parts = [];
    for (const n0 of npcs) { if (n0.m.semi && n0.tr) { const S = n0.m.semi; parts.push({ x: n0.tr.x, z: n0.tr.z, yaw: n0.tr.yaw, y: n0.y, m: { L: S.tL, W: n0.m.W }, src: n0 }, { x: n0.trl.x, z: n0.trl.z, yaw: n0.trl.yaw, y: n0.y, m: { L: S.kL, W: n0.m.W }, src: n0 }); } else parts.push(n0); }
    for (const n of parts) {
      const dx = n.x - this.x, dz = n.z - this.z;
      if (dx * dx + dz * dz > (n.tram ? 196 : n.m.L > 9 ? 100 : 49) || Math.abs((n.y || 0) - this.y) > 3) continue;
      const nc = Math.cos(n.yaw), ns = Math.sin(n.yaw), nl = n.m.L / 2 - n.m.W / 2, nr = n.m.W / 2;
      const bs = n.tram ? [-nl, -nl * 0.66, -nl * 0.33, 0, nl * 0.33, nl * 0.66, nl] : n.m.L > 7 ? [-nl, -nl * 0.66, -nl * 0.33, 0, nl * 0.33, nl * 0.66, nl] : [-nl, 0, nl];
      let deep = 0, px0 = 0, pz0 = 0;
      for (const a of [-1.1, 0, 1.1]) {
        const px = this.x + s * a, pz = this.z + c * a;
        for (const b of bs) {
          const qx = n.x + ns * b, qz = n.z + nc * b;
          const ex = px - qx, ez = pz - qz, d = Math.hypot(ex, ez), r = 0.72 + nr;
          if (d < r) { const k = r - d; if (k > deep) { deep = k; if (d > 0.05) { px0 = ex / d; pz0 = ez / d; } else { px0 = -dx; pz0 = -dz; } } }
        }
      }
      if (deep > 0) {
        // めり込みが深いときは車体中心どうしの向きで分離（方向が定まらず固定されるのを防ぐ）
        if (deep > 0.4) { const l = Math.hypot(dx, dz) || 1; px0 = -dx / l; pz0 = -dz / l; }
        const l = Math.hypot(px0, pz0) || 1; px0 /= l; pz0 /= l;
        this.x += px0 * deep; this.z += pz0 * deep;
        this.contact(px0, pz0, deep, dt, n.m.L > 6 ? 0.3 : 0.55);
        const nn = n.src || n; nn.hitT = 4; nn.hazard = 4; nn.pushedBy = { x: this.x, z: this.z };
      }
    }
  }
  // 接触応答：法線方向の速度だけ消す（浅い角度なら滑り続ける）。新しい衝突のときだけ衝撃を記録
  contact(nx, nz, depth, dt, massK = 1) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    let wx = s * this.vx + c * this.vy, wz = c * this.vx - s * this.vy;
    const sp0 = Math.hypot(wx, wz);
    if (nx || nz) {
      const vn = wx * nx + wz * nz;
      if (vn < 0) {
        const imp = -vn;
        wx -= vn * nx * (1 + 0.2 * Math.min(1, imp / 5)); wz -= vn * nz * (1 + 0.2 * Math.min(1, imp / 5));
        // 接線方向の摩擦（正面衝突ほど強く減速）
        // 当たり続けている間（0.3秒以内の再接触）は、タイヤが向きを戻すぶんの法線成分で何度も減速しないようにする
        const sus = this.cT != null && this.T0 - this.cT < 0.3 && imp < 2.5; this.cT = this.T0 || 0;
        const tk = sus ? 1 - Math.min(0.02, imp / Math.max(sp0, 0.1) * 0.05) : Math.max(0, 1 - imp / Math.max(sp0, 0.1) * 0.6 * massK);
        const fk = tk * 0.5 + 0.5 * (1 - dt * 0.35); wx *= fk; wz *= fk; // こすり続けるときの減速は弱く（ガードレールで止まらず滑る）
        if (imp > 1.2) this.hit = Math.max(this.hit, Math.min(1, imp / 8));
      }
    } else { wx *= -0.2; wz *= -0.2; }
    this.vx = wx * s + wz * c; this.vy = wx * c - wz * s;
    this.w *= 1 - Math.min(1, dt * 6);
    // 壁に押し付けたままハンドルを切ってアクセルを踏んだら、その場で向きを変えられるようにする（壁際で動けなくなるのを防ぐ）
    const inp = this.input || {};
    // 浅い角度で壁に当たったまま進むときは、車の向きを壁に沿わせて滑らせる（こすったまま止まってしまうのを防ぐ）
    if ((nx || nz) && Math.abs(this.vx) > 0.3) {
      const hx = Math.sin(this.yaw) * Math.sign(this.vx), hz = Math.cos(this.yaw) * Math.sign(this.vx), into = -(hx * nx + hz * nz);
      if (into > 0.02 && into < 0.8) { let tx = -nz, tz = nx; if (tx * hx + tz * hz < 0) { tx = -tx; tz = -tz; } const want = Math.atan2(tx * Math.sign(this.vx), tz * Math.sign(this.vx)); let d = want - this.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; this.yaw += clamp(d, -2.6 * dt, 2.6 * dt); }
    }
    if ((nx || nz) && inp.thr > 0.3 && Math.abs(this.steer) > 0.05) { const sg = Math.sign(this.steer) * (this.gear === 'R' ? -1 : 1); if (Math.abs(this.w) < 0.6) this.w = sg * 0.6; this.wallPivot = 0.15; }
    void depth;
  }
}
