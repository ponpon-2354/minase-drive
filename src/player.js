// プレイヤー車両（ミライース）の物理：自転車モデル＋タイヤ横力（摩擦円）＋CVT
import { clamp } from './math.js';
import { MIRA } from './carmodels.js';

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
    Object.assign(this, { x, z, y: this.city ? this.city.groundY(x, z, cy) : 0, yaw, vx: 0, vy: 0, w: 0, steer: 0, rpm: 800, gear: 'D', revT: 0, pitch: 0, roll: 0, pv: 0, rv: 0, wheelRot: 0, slip: 0, hit: 0, accel: 0, braking: false });
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get kmh() { return Math.abs(this.vx) * 3.6; }
  step(dt, env, npcs) {
    const inp = this.input, mu = env.rain ? 0.72 : 1.0, g = 9.81;
    // ギア：R（後退）はボタンで切替（停止付近のみ）
    const v = this.vx;
    if (this.gearReq) { if (Math.abs(v) < 1.0) this.gear = this.gear === 'D' ? 'R' : 'D'; this.gearReq = false; }
    let thr = inp.thr, brk = inp.brk;
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
    }
    if (thr < 0.05 && brk < 0.05 && Math.abs(v) < 1.6) Fdrive = dir * 320; // クリープ（CVT）
    if (dir > 0 && v * 3.6 > 140) Fdrive = Math.min(Fdrive, 0); // リミッター
    if (dir < 0 && v < -6) Fdrive = 0;
    const Frr = 0.012 * this.m * g * Math.sign(v), Fdrag = 0.5 * 1.2 * 0.32 * 1.95 * v * Math.abs(v);
    const Fbrk = brk * this.m * g * 0.92 * mu * (env.rain ? 0.9 : 1);
    // エンジンブレーキ
    const Feb = thr < 0.05 ? 260 * Math.sign(v) * Math.min(1, Math.abs(v) / 3) : 0;
    // タイヤ横力
    const vxa = Math.max(Math.abs(v), 0.5);
    const Nf = this.m * g * this.b / MIRA.wb, Nr = this.m * g * this.a / MIRA.wb;
    const Cf = 52000, Cr = 58000;
    let af = Math.atan2(this.vy + this.w * this.a, vxa) - this.steer * Math.sign(v || 1);
    let ar = Math.atan2(this.vy - this.w * this.b, vxa);
    const fxf = Math.abs(Fdrive) + Fbrk * 0.65;
    const fyfMax = Math.sqrt(Math.max(0, (mu * Nf) ** 2 - fxf ** 2)) + 200, fyrMax = mu * Nr;
    let Fyf = clamp(-Cf * af, -fyfMax, fyfMax), Fyr = clamp(-Cr * ar, -fyrMax, fyrMax);
    this.slip = Math.max(Math.abs(Fyf) / (fyfMax + 1) > 0.98 && Math.abs(v) > 8 ? 1 : 0, (Math.abs(Fyr) / (fyrMax + 1) > 0.98 && Math.abs(v) > 6) ? 1 : 0);
    // 縦方向
    // 坂道：重力の進行方向成分
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), cy = this.y + 0.5;
    const gF = this.city.groundY(this.x + fx * 1.2, this.z + fz * 1.2, cy), gB = this.city.groundY(this.x - fx * 1.2, this.z - fz * 1.2, cy);
    this.slope = clamp((gF - gB) / 2.4, -0.4, 0.4);
    const Fg = this.m * g * Math.sin(Math.atan(this.slope));
    let Fx = Fdrive - Frr - Fdrag - Feb - Fyf * Math.sin(this.steer) - (Math.abs(v) > 0.05 || thr > 0.05 || Math.abs(Fg) > Fbrk ? Fg : 0);
    let ax = Fx / this.m + this.vy * this.w;
    // ブレーキ（停止を越えて逆転しない）
    const bAcc = Fbrk / this.m;
    let nvx = v + ax * dt;
    if (bAcc > 0) { if (Math.abs(nvx) <= bAcc * dt) nvx = 0; else nvx -= Math.sign(nvx) * bAcc * dt; }
    if (thr < 0.05 && Math.abs(nvx) < 0.05) nvx = 0;
    this.accel = (nvx - v) / dt;
    this.vx = nvx;
    // 横・ヨー
    const ay = (Fyf * Math.cos(this.steer) + Fyr) / this.m - this.vx * this.w;
    const aw = (this.a * Fyf * Math.cos(this.steer) - this.b * Fyr) / this.Iz;
    this.vy += ay * dt; this.w += aw * dt;
    // 低速時は運動学モデルへブレンド（停止時の振動防止）
    const kin = clamp(1 - (Math.abs(this.vx) - 1.5) / 3, 0, 1);
    if (kin > 0) {
      const wk = this.vx * Math.tan(this.steer) / MIRA.wb;
      this.w += (wk - this.w) * kin; this.vy *= 1 - kin;
    }
    // 走行アシスト（横滑り抑制）
    if (this.assist) { this.vy *= 1 - Math.min(1, dt * 2.5); const wk = this.vx * Math.tan(this.steer) / MIRA.wb; this.w += (wk - this.w) * Math.min(1, dt * 2.0); }
    // 位置更新
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const ox = this.x, oz = this.z;
    this.yaw += this.w * dt;
    this.x += (s * this.vx + c * this.vy) * dt;
    this.z += (c * this.vx - s * this.vy) * dt;
    this.collide(ox, oz, npcs);
    // 車体姿勢（サスペンション：ばね・ダンパー）
    const latA = this.vx * this.w;
    const kp = 60, cp = 9;
    this.pv += (-kp * (this.pitch - clamp(-this.accel * 0.006, -0.05, 0.05)) - cp * this.pv) * dt; this.pitch += this.pv * dt;
    this.slopeV = (this.slopeV || 0) + (-Math.atan(this.slope || 0) - (this.slopeV || 0)) * Math.min(1, dt * 10);
    this.rv += (-kp * (this.roll - clamp(latA * 0.006, -0.06, 0.06)) - cp * this.rv) * dt; this.roll += this.rv * dt;
    this.wheelRot += this.vx * dt / MIRA.r;
    // 高さ（郊外の土地は低い）
    const gy = this.city.groundY(this.x, this.z, this.y + 0.5); this.y += (gy - this.y) * Math.min(1, dt * 12);
    // 回転数（CVTらしい挙動）
    const kmh = Math.abs(this.vx) * 3.6;
    let rt = kmh < 1 ? 800 + thr * 1800 : Math.max(1100 + kmh * 22, 1500 + thr * (2600 + kmh * 28));
    if (thr < 0.05 && kmh > 5) rt = 1000 + kmh * 18;
    rt = Math.min(rt, 6800);
    this.rpm += (rt - this.rpm) * Math.min(1, dt * 4);
    this.braking = brk > 0.05 || (thr < 0.05 && Math.abs(this.vx) < 0.1);
  }
  corners() {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), hl = MIRA.L / 2, hw = MIRA.W / 2, out = [];
    for (const [lx, lz] of [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl], [hw, 0], [-hw, 0], [0, hl], [0, -hl]]) out.push([this.x + lx * c + lz * s, this.z - lx * s + lz * c]);
    return out;
  }
  collide(ox, oz, npcs) {
    const city = this.city;
    // 走行範囲
    if (!city.allowed(this.x, this.z)) { this.x = ox; this.z = oz; this.bump(0.25); }
    // 建物・構造物（AABB）
    for (let it = 0; it < 2; it++) {
      const boxes = city.query(this.x, this.z, 3);
      let pushX = 0, pushZ = 0;
      const yy = this.y;
      for (const p of this.corners()) for (const b of boxes) {
        if (yy + 1.3 < b.y0 || yy > b.y1) continue;
        if (p[0] > b.x0 && p[0] < b.x1 && p[1] > b.z0 && p[1] < b.z1) {
          const dl = p[0] - b.x0, dr = b.x1 - p[0], dt = p[1] - b.z0, db = b.z1 - p[1], m = Math.min(dl, dr, dt, db);
          let px = 0, pz = 0;
          if (m === dl) px = -dl; else if (m === dr) px = dr; else if (m === dt) pz = -dt; else pz = db;
          if (Math.abs(px) > Math.abs(pushX)) pushX = px; if (Math.abs(pz) > Math.abs(pushZ)) pushZ = pz;
        }
      }
      // 小さい柱が車体の辺に刺さる場合
      for (const b of boxes) if (b.kind === 'p' && !(yy + 1.3 < b.y0 || yy > b.y1)) {
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        const c = Math.cos(this.yaw), s = Math.sin(this.yaw), dx = cx - this.x, dz = cz - this.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c, hw = MIRA.W / 2 + 0.2, hl = MIRA.L / 2 + 0.2;
        if (Math.abs(lx) < hw && Math.abs(lz) < hl) {
          const pl = hw - Math.abs(lx), pf = hl - Math.abs(lz);
          if (pl < pf) { const k = -Math.sign(lx) * pl; pushX += k * c; pushZ += -k * s; } else { const k = -Math.sign(lz) * pf; pushX += k * s; pushZ += k * c; }
        }
      }
      if (pushX || pushZ) { this.x += pushX; this.z += pushZ; this.bump(Math.min(1, Math.hypot(pushX, pushZ) * 4), pushX, pushZ); } else break;
    }
    // 線分の壁（ガードレール・高架の壁・橋の欄干・トンネル）
    for (const w of this.city.wallsNear(this.x, this.z, 4)) {
      if (this.y + 1.2 < w.y0 || this.y > w.y1) continue;
      const vx = w.x1 - w.x0, vz = w.z1 - w.z0, L2 = vx * vx + vz * vz || 1;
      for (const p of this.corners()) {
        const t = clamp(((p[0] - w.x0) * vx + (p[1] - w.z0) * vz) / L2, 0, 1), qx = p[0] - (w.x0 + vx * t), qz = p[1] - (w.z0 + vz * t), d = Math.hypot(qx, qz);
        if (d < 0.25 && d > 1e-5) {
          // 車体の中心側へ押し戻す
          let nx = qx / d, nz = qz / d; const cx = this.x - (w.x0 + vx * t), cz = this.z - (w.z0 + vz * t);
          if (nx * cx + nz * cz < 0) { nx = -nx; nz = -nz; }
          const k = 0.25 - d; this.x += nx * k; this.z += nz * k; this.bump(Math.min(1, k * 4), nx, nz);
        } else if (d <= 1e-5) { const cx = this.x - p[0], cz = this.z - p[1], l = Math.hypot(cx, cz) || 1; this.x += cx / l * 0.25; this.z += cz / l * 0.25; }
      }
    }
    // NPC車両（円3つで近似）
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    for (const n of npcs) {
      const dx = n.x - this.x, dz = n.z - this.z;
      if (dx * dx + dz * dz > (n.tram ? 196 : 49) || Math.abs((n.y || 0) - this.y) > 3) continue;
      const nc = Math.cos(n.yaw), ns = Math.sin(n.yaw), nl = n.m.L / 2 - n.m.W / 2, nr = n.m.W / 2;
      const bs = n.tram ? [-nl, -nl * 0.66, -nl * 0.33, 0, nl * 0.33, nl * 0.66, nl] : [-nl, 0, nl];
      for (const a of [-1.1, 0, 1.1]) {
        const px = this.x + s * a, pz = this.z + c * a;
        for (const b of bs) {
          const qx = n.x + ns * b, qz = n.z + nc * b;
          const ex = px - qx, ez = pz - qz, d = Math.hypot(ex, ez), r = 0.72 + nr;
          if (d < r && d > 0.001) {
            const k = (r - d); this.x += ex / d * k; this.z += ez / d * k;
            this.bump(Math.min(1, k * 3), ex / d, ez / d); n.hitT = 1.5;
          }
        }
      }
    }
  }
  bump(k, nx = 0, nz = 0) {
    // 衝突面の法線方向の速度成分を除去
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    let wx = s * this.vx + c * this.vy, wz = c * this.vx - s * this.vy;
    const l = Math.hypot(nx, nz);
    if (l > 0) { nx /= l; nz /= l; const vn = wx * nx + wz * nz; if (vn < 0) { wx -= vn * nx * 1.3; wz -= vn * nz * 1.3; } }
    else { wx *= -0.2; wz *= -0.2; }
    const sp = Math.hypot(wx, wz);
    this.hit = Math.max(this.hit, Math.min(1, Math.abs(this.speed - sp) / 8 + k * 0.2));
    this.vx = wx * s + wz * c; this.vy = wx * c - wz * s;
    this.vx *= 0.85; this.w *= 0.5;
  }
}
