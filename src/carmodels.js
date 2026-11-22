// 車両モデル：ミライース（プレイヤー）＋NPC 50車種のパラメトリック・ローポリモデル
// ※実車の正確な再現ではなく、寸法・シルエットを参考にした簡易モデル（仮モデル）。ロゴ・エンブレムは含まない。
import { GB, hex } from './geo.js';
import { clamp } from './math.js';
import { L } from './textures.js';

const C = { // 汎用カラー（実車の市販色を参考にした近似色）
  W: ['ホワイト', '#eeeeec'], PW: ['パールホワイト', '#e9e6dc'], S: ['シルバー', '#b4b8bc'], BK: ['ブラック', '#151517'],
  G: ['グレー', '#6b6f74'], BE: ['ベージュ', '#d6c5a5'], BL: ['ブルー', '#2e5c99'], LB: ['ライトブルー', '#8db3d3'],
  R: ['レッド', '#b01f29'], BR: ['ブラウン', '#6a4a36'], GR: ['グリーン', '#4d7858'], MG: ['ミントグリーン', '#a7c9b5'],
  PK: ['ピンク', '#e6b3b7'], Y: ['イエロー', '#e3c23c'], OR: ['オレンジ', '#d6782c'], NV: ['ネイビー', '#25314d'],
  DR: ['ダークレッド', '#6c1a22'], KH: ['カーキ', '#7b785b'], DG: ['ダークグレー', '#3d4044'], GD: ['ゴールド', '#b49a64']
};
const cols = s => s.split(' ').map(k => C[k]);

// カテゴリ既定値
const CAT = {
  kei: { L: 3.395, W: 1.475, H: 1.52, wb: 2.46, belt: 0.95, hood: 0.78, ws: 1.0, wsT: 1.78, rgb: 0.14, rg: 0.32, r: 0.27, rear: 'hatch', plate: 'k', perf: [2.1, 33, 1.0], w: 1.3 },
  sh: { L: 3.395, W: 1.475, H: 1.78, wb: 2.46, belt: 1.02, hood: 0.86, ws: 0.86, wsT: 1.62, rgb: 0.07, rg: 0.12, r: 0.28, rear: 'box', plate: 'k', slide: 1, perf: [1.9, 32, 0.95], w: 1.5 },
  cmp: { L: 3.95, W: 1.69, H: 1.5, wb: 2.55, belt: 0.97, hood: 0.8, ws: 1.2, wsT: 2.05, rgb: 0.2, rg: 0.5, r: 0.3, rear: 'hatch', plate: 'w', perf: [2.5, 38, 1.0], w: 1.1 },
  sed: { L: 4.65, W: 1.78, H: 1.45, wb: 2.7, belt: 0.92, hood: 0.8, ws: 1.55, wsT: 2.4, rgb: 0.95, rg: 1.55, r: 0.32, rear: 'sedan', plate: 'w', perf: [2.8, 40, 1.0], w: 0.6 },
  mv: { L: 4.7, W: 1.73, H: 1.86, wb: 2.85, belt: 1.08, hood: 0.96, ws: 1.05, wsT: 1.85, rgb: 0.08, rg: 0.14, r: 0.32, rear: 'box', plate: 'w', slide: 1, perf: [2.3, 38, 0.9], w: 0.9 },
  suv: { L: 4.4, W: 1.8, H: 1.66, wb: 2.65, belt: 1.06, hood: 0.96, ws: 1.35, wsT: 2.15, rgb: 0.18, rg: 0.45, r: 0.36, rear: 'hatch', plate: 'w', rails: 1, perf: [2.6, 39, 0.95], w: 0.8 },
  wag: { L: 4.5, W: 1.75, H: 1.47, wb: 2.67, belt: 0.92, hood: 0.8, ws: 1.4, wsT: 2.25, rgb: 0.14, rg: 0.35, r: 0.32, rear: 'hatch', plate: 'w', perf: [2.7, 40, 1.0], w: 0.5 },
  van: { L: 4.25, W: 1.69, H: 1.53, wb: 2.55, belt: 0.95, hood: 0.8, ws: 1.2, wsT: 2.0, rgb: 0.06, rg: 0.1, r: 0.3, rear: 'box', plate: 'w', perf: [2.0, 34, 0.9], w: 0.5 },
  trk: { L: 3.395, W: 1.475, H: 1.78, wb: 1.9, belt: 1.05, hood: 1.0, ws: 0.25, wsT: 0.66, cab: 1.45, r: 0.27, rear: 'truck', plate: 'k', perf: [1.6, 30, 0.9], w: 0.8 }
};

// [名称(参考車種), メーカー, カテゴリ, 上書き, 色]
const DEFS = [
  // 軽自動車 12
  ['ミライース', 'ダイハツ', 'kei', { H: 1.5, hood: 0.78 }, 'W PW S BK R LB'],
  ['アルト', 'スズキ', 'kei', { H: 1.525, hood: 0.8, light: 'round', wsT: 1.72 }, 'W S BK R BE'],
  ['ワゴンR', 'スズキ', 'kei', { H: 1.65, belt: 0.98, ws: 0.92, wsT: 1.65, rg: 0.2 }, 'PW S BK BL MG'],
  ['ムーヴ', 'ダイハツ', 'kei', { H: 1.63, belt: 0.98, ws: 0.95, wsT: 1.65, rg: 0.22, light: 'slim' }, 'PW S BK DR BL'],
  ['ムーヴキャンバス', 'ダイハツ', 'kei', { H: 1.655, belt: 0.98, ws: 0.9, wsT: 1.55, rg: 0.14, light: 'round', two: 1, slide: 1 }, 'PK MG BE LB W'],
  ['N-WGN', 'ホンダ', 'kei', { H: 1.675, belt: 0.99, ws: 0.92, wsT: 1.62, rg: 0.2, light: 'round' }, 'PW S BK LB BE'],
  ['N-ONE', 'ホンダ', 'kei', { H: 1.545, light: 'round', ws: 0.98, wsT: 1.75, rg: 0.28, two: 1 }, 'W BK R Y G'],
  ['デイズ', '日産', 'kei', { H: 1.64, belt: 0.98, ws: 0.94, wsT: 1.64, rg: 0.2, grille: 0.6 }, 'PW S BK BL BR'],
  ['eKワゴン', '三菱', 'kei', { H: 1.64, belt: 0.98, ws: 0.94, wsT: 1.64, rg: 0.22, grille: 0.4 }, 'W S BK BE NV'],
  ['ハスラー', 'スズキ', 'kei', { H: 1.68, belt: 1.0, hood: 0.88, ws: 0.88, wsT: 1.52, rg: 0.12, r: 0.29, light: 'round', two: 1, rails: 1 }, 'OR LB Y W G'],
  ['タフト', 'ダイハツ', 'kei', { H: 1.63, belt: 1.0, hood: 0.88, ws: 0.88, wsT: 1.55, rg: 0.1, r: 0.29, light: 'slim', rails: 1 }, 'KH W BK S OR'],
  ['ラパン', 'スズキ', 'kei', { H: 1.525, ws: 0.95, wsT: 1.62, rg: 0.12, light: 'round', grille: 0.1 }, 'BE PK W LB MG'],
  // 軽スーパーハイトワゴン 8
  ['タント', 'ダイハツ', 'sh', { H: 1.755 }, 'PW S BK BE LB'],
  ['タントカスタム', 'ダイハツ', 'sh', { H: 1.755, light: 'slim', grille: 1 }, 'PW BK S DR NV'],
  ['N-BOX', 'ホンダ', 'sh', { H: 1.79, ws: 0.82, wsT: 1.55, light: 'round' }, 'PW S BK BE MG GD'],
  ['N-BOXカスタム', 'ホンダ', 'sh', { H: 1.79, ws: 0.82, wsT: 1.55, light: 'slim', grille: 1 }, 'PW BK S DR NV'],
  ['スペーシア', 'スズキ', 'sh', { H: 1.785, ws: 0.84, wsT: 1.58, light: 'round', grille: 0.3 }, 'PW S BE MG OR'],
  ['スペーシアカスタム', 'スズキ', 'sh', { H: 1.785, ws: 0.84, wsT: 1.58, light: 'slim', grille: 1 }, 'PW BK S DG'],
  ['ルークス', '日産', 'sh', { H: 1.78, grille: 0.7, light: 'slim' }, 'PW S BK BE BL'],
  ['eKスペース', '三菱', 'sh', { H: 1.78, grille: 0.5 }, 'PW S BK LB'],
  // コンパクトカー 8
  ['ヤリス', 'トヨタ', 'cmp', { L: 3.94, H: 1.5, ws: 1.25, wsT: 2.1, rg: 0.55, light: 'slim' }, 'PW S BK R BL OR'],
  ['アクア', 'トヨタ', 'cmp', { L: 4.05, H: 1.485, ws: 1.25, wsT: 2.2, rg: 0.62, light: 'slim' }, 'PW S BK BL BE'],
  ['フィット', 'ホンダ', 'cmp', { L: 3.995, H: 1.54, ws: 1.05, wsT: 2.05, rg: 0.45, light: 'round' }, 'PW S BK LB BE'],
  ['ノート', '日産', 'cmp', { L: 4.045, H: 1.52, ws: 1.2, wsT: 2.1, rg: 0.5, grille: 0.6, light: 'slim' }, 'PW S BK BL R'],
  ['ルーミー', 'トヨタ', 'cmp', { L: 3.7, H: 1.735, belt: 1.02, hood: 0.9, ws: 0.95, wsT: 1.7, rgb: 0.08, rg: 0.12, rear: 'box', slide: 1, grille: 0.8 }, 'PW S BK BL BR'],
  ['スイフト', 'スズキ', 'cmp', { L: 3.86, H: 1.5, ws: 1.2, wsT: 2.0, rg: 0.5, light: 'slim' }, 'W S BK R BL'],
  ['ソリオ', 'スズキ', 'cmp', { L: 3.79, H: 1.745, belt: 1.02, hood: 0.9, ws: 0.95, wsT: 1.7, rgb: 0.08, rg: 0.12, rear: 'box', slide: 1 }, 'PW S BK LB BE'],
  ['MAZDA2', 'マツダ', 'cmp', { L: 4.065, H: 1.5, ws: 1.35, wsT: 2.2, rg: 0.55, grille: 0.7, light: 'slim' }, 'W S BK DR NV'],
  // セダン 5
  ['カローラ', 'トヨタ', 'sed', { L: 4.495, H: 1.435, light: 'slim' }, 'PW S BK BL G'],
  ['プリウス', 'トヨタ', 'sed', { L: 4.6, H: 1.43, ws: 1.45, wsT: 2.45, rgb: 0.3, rg: 1.05, rear: 'hatch', light: 'slim' }, 'PW S BK BL R'],
  ['クラウン', 'トヨタ', 'sed', { L: 4.93, W: 1.8, H: 1.455, ws: 1.7, wsT: 2.6, grille: 1 }, 'PW BK S NV'],
  ['カムリ', 'トヨタ', 'sed', { L: 4.885, W: 1.84, H: 1.445, grille: 0.8, light: 'slim' }, 'PW BK S DR'],
  ['MAZDA3セダン', 'マツダ', 'sed', { L: 4.66, W: 1.795, H: 1.445, ws: 1.75, wsT: 2.6, grille: 0.7 }, 'W S BK DR G'],
  // ミニバン 6
  ['シエンタ', 'トヨタ', 'mv', { L: 4.26, W: 1.695, H: 1.695, belt: 1.02, wb: 2.75, r: 0.3, light: 'round' }, 'PW S BK BE KH'],
  ['フリード', 'ホンダ', 'mv', { L: 4.31, W: 1.695, H: 1.755, belt: 1.03, wb: 2.74, r: 0.3 }, 'PW S BK BL BE'],
  ['ノア', 'トヨタ', 'mv', { H: 1.895, grille: 0.9, light: 'slim' }, 'PW BK S NV'],
  ['ヴォクシー', 'トヨタ', 'mv', { H: 1.895, grille: 1, light: 'slim', hood: 1.0 }, 'PW BK S G'],
  ['セレナ', '日産', 'mv', { H: 1.87, grille: 0.8 }, 'PW S BK BL BR'],
  ['アルファード', 'トヨタ', 'mv', { L: 4.995, W: 1.85, H: 1.935, wb: 3.0, belt: 1.15, hood: 1.05, grille: 1.3, light: 'slim' }, 'PW BK S'],
  // SUV 5
  ['ヤリスクロス', 'トヨタ', 'suv', { L: 4.18, W: 1.765, H: 1.59, r: 0.34, light: 'slim' }, 'PW S BK BE KH OR'],
  ['ライズ', 'ダイハツ', 'suv', { L: 3.995, W: 1.695, H: 1.62, r: 0.33, grille: 0.7 }, 'PW S BK R BL'],
  ['ハリアー', 'トヨタ', 'suv', { L: 4.74, W: 1.855, H: 1.66, rg: 0.7, light: 'slim', rails: 0 }, 'PW BK S DR'],
  ['CX-5', 'マツダ', 'suv', { L: 4.575, W: 1.845, H: 1.69, grille: 0.9, light: 'slim' }, 'W S BK DR G'],
  ['ヴェゼル', 'ホンダ', 'suv', { L: 4.33, W: 1.79, H: 1.59, rg: 0.6, light: 'slim', rails: 0 }, 'PW S BK BL G'],
  // ハッチバック・ステーションワゴン 2
  ['カローラツーリング', 'トヨタ', 'wag', { L: 4.495, W: 1.745, H: 1.46 }, 'PW S BK BL'],
  ['レヴォーグ', 'スバル', 'wag', { L: 4.755, W: 1.795, H: 1.5, hood: 0.84, grille: 0.6 }, 'PW S BK BL DG'],
  // 商用バン 2
  ['プロボックス', 'トヨタ', 'van', {}, 'W S PW G'],
  ['ハイエース', 'トヨタ', 'van', { L: 4.695, W: 1.695, H: 1.98, wb: 2.57, belt: 1.18, hood: 1.12, ws: 0.32, wsT: 0.95, r: 0.32, slide: 1 }, 'W S BK PW'],
  // トラック 2
  ['ハイゼットトラック', 'ダイハツ', 'trk', {}, 'W S LB G'],
  ['小型トラック(2t)', 'いすゞ等', 'trk', { L: 4.7, W: 1.7, H: 2.0, wb: 2.5, cab: 1.65, belt: 1.35, hood: 1.3, ws: 0.15, wsT: 0.55, r: 0.36, plate: 'w', perf: [1.5, 28, 0.8], w: 0.4 }, 'W S LB G']
];

export const MODELS = DEFS.map(([name, maker, cat, ov, cs], id) => {
  const p = { ...CAT[cat], ...ov, id, name, maker, cat };
  p.colors = cols(cs).map(([n, h]) => ({ name: n, hex: h, rgb: hex(h) }));
  // 色の出現重み（白・パール・シルバー・黒は多め、同色ばかりにならない程度）
  p.cw = p.colors.map(c => /ホワイト|パール/.test(c.name) ? 1.6 : /シルバー|ブラック/.test(c.name) ? 1.3 : 1.0);
  // 車種ごとの性能：[加速, 最高速, 旋回]
  p.acc = p.perf[0]; p.vmax = p.perf[1]; p.turn = p.perf[2];
  return p;
});
export const VARIATIONS = MODELS.reduce((a, m) => a + m.colors.length, 0);
export const CAT_NAMES = { kei: '軽自動車', sh: '軽スーパーハイトワゴン', cmp: 'コンパクトカー', sed: 'セダン', mv: 'ミニバン', suv: 'SUV', wag: 'ステーションワゴン', van: '商用バン', trk: 'トラック' };

export function pickModel(R) {
  let t = 0; for (const m of MODELS) t += m.w; let x = R() * t;
  for (const m of MODELS) { x -= m.w; if (x <= 0) return m; } return MODELS[0];
}
export function pickColor(m, R) {
  let t = 0; for (const w of m.cw) t += w; let x = R() * t;
  for (let i = 0; i < m.cw.length; i++) { x -= m.cw[i]; if (x <= 0) return m.colors[i]; } return m.colors[0];
}

// プレイヤー：ダイハツ ミライース（LA350S型の寸法を参考）
export const MIRA = { ...CAT.kei, name: 'ミライース', L: 3.395, W: 1.475, H: 1.5, wb: 2.455, belt: 0.97, hood: 0.77, ws: 0.9975, wsT: 1.5775, rgb: 0.14, rg: 0.34, r: 0.278, light: 'slim', grille: 0.15, _zf: 1.2, _zr: -1.255 };
export const MIRA_COLORS = [
  { name: 'セラミックグリーンメタリック', hex: '#9dbcae' },
  { name: 'スカイブルーメタリック', hex: '#7ea6c9' },
  { name: 'ブライトシルバーメタリック', hex: '#bfc3c7' },
  { name: 'ファイアークォーツレッドメタリック', hex: '#a3202b' },
  { name: 'ブラックマイカメタリック', hex: '#19191d' }
].map(c => ({ ...c, rgb: hex(c.hex) }));

const DARK = [0.06, 0.06, 0.07], GLASS = [0.12, 0.15, 0.19], TIRE = [0.07, 0.07, 0.07];

// 車体を GB に出力。opt: {paint: rgb|null, lod: 0|1, player: bool, glass: GB(透明ガラス用), noWheels}
export function buildCar(p, gb, opt = {}) {
  const lod = opt.lod || 0;
  const Lh = p.L / 2, Wh = p.W / 2, r = p.r, yb = r * 0.6, belt = p.belt, H = p.H;
  const paint = opt.paint ? { c: opt.paint, mat: 0 } : { c: [1, 1, 1], mat: 1 };
  const dark = { c: DARK }, zW = Lh - p.ws, zFt = Lh - p.wsT;
  const truck = p.rear === 'truck', cabR = truck ? Lh - p.cab : -Lh;
  const zRb = truck ? cabR + 0.03 : -Lh + p.rgb, zRt = truck ? cabR + 0.08 : -Lh + p.rg;
  // 下部ボディ
  const rearTop = p.rear === 'sedan' ? belt - 0.02 : belt;
  const lower = [[cabR + (truck ? 0 : 0.1), yb], [cabR, yb + 0.14], [cabR + 0.03, rearTop], [zW, belt + 0.02], [Lh - 0.16, p.hood], [Lh, p.hood - 0.16], [Lh, yb + 0.16], [Lh - 0.12, yb]];
  gb.loft(lower, () => Wh, paint, opt.player ? { stripO: i => i === 2 ? null : paint } : {});
  // キャビン（ガラス）
  const tum = (p.rear === 'box' ? 0.09 : 0.13);
  const hwG = y => Wh - 0.05 - Math.max(0, (y - belt) / (H - belt)) * tum;
  const gh = [[zRb, belt], [zRt, H - 0.05], [zFt, H - 0.05], [zW, belt + 0.02]];
  if (opt.player) {
    opt.glass.loft(gh, y => hwG(y) + 0.002, { c: [0.3, 0.36, 0.42] });
    // ピラー
    const pil = (z0, y0, z1, y1, t) => { for (const s of [1, -1]) gb.beam([s * (hwG(y0) - t * 0.7), y0, z0], [s * (hwG(y1) - t * 0.7), y1, z1], t, paint); };
    pil(zW, belt + 0.02, zFt, H - 0.05, 0.035); // Aピラー
    pil(zRb + 0.04, belt, zRt + 0.04, H - 0.05, 0.05); // Cピラー
    const zB = (zW + zRb) / 2 - 0.05; pil(zB, belt, zB - 0.02, H - 0.05, 0.04); // Bピラー
    // ベルトライン下の内張り
  } else {
    gb.loft(gh, hwG, { c: GLASS });
  }
  // ルーフ
  const roofC = p.two ? { c: [0.93, 0.93, 0.9] } : paint;
  gb.loft([[zRt - 0.02, H - 0.06], [zRt + 0.03, H], [zFt - 0.03, H], [zFt + 0.02, H - 0.06]], () => hwG(H) + 0.012, roofC);
  if (p.rails) for (const s of [1, -1]) gb.box(s * (hwG(H) - 0.08) - 0.025, H, zRt + 0.1, s * (hwG(H) - 0.08) + 0.025, H + 0.06, zFt - 0.1, { c: [0.15, 0.15, 0.15] });
  // トラック荷台
  if (truck) {
    const bedY = r * 2 + 0.12;
    gb.box(-Wh, bedY - 0.12, -Lh, Wh, bedY, cabR - 0.05, { c: [0.25, 0.25, 0.26] });
    gb.box(-Wh, bedY - 0.35, -Lh + 0.2, Wh, bedY - 0.12, cabR - 0.3, dark);
    const gc = paint;
    gb.box(-Wh, bedY, -Lh, Wh, bedY + 0.32, -Lh + 0.04, gc);
    gb.box(-Wh, bedY, -Lh, -Wh + 0.04, bedY + 0.32, cabR - 0.06, gc);
    gb.box(Wh - 0.04, bedY, -Lh, Wh, bedY + 0.32, cabR - 0.06, gc);
    gb.box(-Wh, bedY, cabR - 0.1, Wh, bedY + 0.45, cabR - 0.05, { c: [0.2, 0.2, 0.2] });
  }
  // フロント：グリル・ライト・バンパー
  const g = p.grille ?? 0.3;
  const gw = Wh * (0.45 + g * 0.35), gh2 = 0.08 + g * 0.16;
  gb.box(-gw, p.hood - 0.16 - gh2, Lh - 0.03, gw, p.hood - 0.15, Lh + 0.012, { c: g > 0.8 ? [0.22, 0.22, 0.24] : DARK });
  if (!lod) gb.box(-Wh * 0.5, yb + 0.05, Lh - 0.03, Wh * 0.5, yb + 0.14, Lh + 0.012, dark); // 下部開口
  const lt = p.light || 'std';
  const lw = lt === 'round' ? 0.2 : lt === 'slim' ? 0.36 : 0.3, lhgt = lt === 'slim' ? 0.1 : lt === 'round' ? 0.17 : 0.15;
  const lx0 = Wh - 0.05;
  for (const s of [1, -1]) {
    const xa = s * lx0, xb = s * (lx0 - lw);
    gb.box(Math.min(xa, xb), p.hood - 0.15 - lhgt, Lh - 0.06, Math.max(xa, xb), p.hood - 0.15, Lh + 0.015, { c: [1, 1, 0.92], mat: 2 });
    // ウインカー（前）
    if (!lod) gb.box(Math.min(s * (Wh - 0.02), s * (Wh - 0.1)), p.hood - 0.32, Lh - 0.08, Math.max(s * (Wh - 0.02), s * (Wh - 0.1)), p.hood - 0.26, Lh + 0.013, { c: [1, 0.55, 0.05], mat: s > 0 ? 10 : 11 });
  }
  // ナンバー
  const plateL = p.plate === 'k' ? L.PLATE_K : L.PLATE_W;
  gb.quadN([-0.165, yb + 0.16, Lh + 0.02], [0.165, yb + 0.16, Lh + 0.02], [0.165, yb + 0.325, Lh + 0.02], [-0.165, yb + 0.325, Lh + 0.02], [0, 0, 1], { c: [1, 1, 1], lay: plateL });
  // リア
  const rz = truck ? -Lh : -Lh;
  const tTop = truck ? r * 2 + 0.05 : belt - 0.02, tBot = truck ? r * 2 - 0.15 : belt - 0.3;
  for (const s of [1, -1]) {
    const xa = s * (Wh - 0.02), xb = s * (Wh - 0.2);
    gb.box(Math.min(xa, xb), tBot, rz - 0.015, Math.max(xa, xb), tTop, rz + 0.03, { c: [0.8, 0.05, 0.05], mat: 4 });
    if (!lod) gb.box(Math.min(xa, xb), tBot - 0.08, rz - 0.016, Math.max(xa, xb), tBot - 0.01, rz + 0.03, { c: [1, 0.55, 0.05], mat: s > 0 ? 10 : 11 });
  }
  const rpY = truck ? r * 2 - 0.25 : yb + 0.3;
  gb.quadN([-0.165, rpY, rz - 0.02], [0.165, rpY, rz - 0.02], [0.165, rpY + 0.165, rz - 0.02], [-0.165, rpY + 0.165, rz - 0.02], [0, 0, -1], { c: [1, 1, 1], lay: plateL }, [[1, 1], [0, 1], [0, 0], [1, 0]]);
  gb.box(-Wh + 0.05, yb, rz - 0.03, Wh - 0.05, yb + 0.12, rz + 0.05, dark);
  // ミラー
  if (!lod) for (const s of [1, -1]) {
    const xa = s * Wh, xb = s * (Wh + 0.12);
    gb.box(Math.min(xa, xb), belt + 0.04, zW - 0.12, Math.max(xa, xb), belt + 0.16, zW - 0.02, paint);
  }
  // ドアの線・ホイールハウス
  if (lod === 0) {
    const ln = (z, y0, y1) => { for (const s of [1, -1]) gb.quadN([s * (Wh + 0.004), y0, z - 0.008], [s * (Wh + 0.004), y0, z + 0.008], [s * (Wh + 0.004), y1, z + 0.008], [s * (Wh + 0.004), y1, z - 0.008], [s, 0, 0], dark); };
    const df = zW - 0.04, dm = (zW + zRb) / 2 - 0.05;
    if (!truck) { ln(df, yb + 0.12, belt); ln(dm, yb + 0.1, belt); ln(zRb + 0.15, yb + 0.12, belt); }
    if (p.slide) for (const s of [1, -1]) gb.quadN([s * (Wh + 0.004), belt - 0.06, dm], [s * (Wh + 0.004), belt - 0.06, zRb + 0.1], [s * (Wh + 0.004), belt - 0.045, zRb + 0.1], [s * (Wh + 0.004), belt - 0.045, dm], [s, 0, 0], dark);
  }
  const zf = Lh - (p.L - p.wb) / 2 + (truck ? 0.25 : 0.05), zr = zf - p.wb;
  p._zf = zf; p._zr = zr;
  for (const z of [zf, zr]) for (const s of [1, -1]) {
    gb.quadN([s * (Wh + 0.003), 0.02, z - r - 0.06], [s * (Wh + 0.003), 0.02, z + r + 0.06], [s * (Wh + 0.003), r * 2 + 0.05, z + r + 0.06], [s * (Wh + 0.003), r * 2 + 0.05, z - r - 0.06], [s, 0, 0], { c: [0.03, 0.03, 0.03] });
  }
  if (!opt.noWheels) for (const z of [zf, zr]) for (const s of [1, -1]) wheel(gb, s * (Wh - 0.08), r, z, r, lod, s, p);
  // 影（ブロブ）
  gb.flat(-Wh - 0.05, -Lh - 0.05, Wh + 0.05, Lh + 0.05, 0.05, { c: [0.05, 0.05, 0.055], mat: 5 });
}

export function wheel(gb, x, y, z, r, lod, side, p) {
  const w = 0.17, seg = lod ? 6 : 12;
  if (lod) { gb.cylX(x, y, z, r, w, seg, { c: TIRE }, false); return; }
  const hub = p && (p.grille > 0.8 || p.cat === 'suv') ? [0.75, 0.76, 0.78] : [0.62, 0.63, 0.65];
  gb.cylX(x, y, z, r, w, seg, { c: TIRE }, true, { c: TIRE });
  gb.cylX(x + side * (w / 2 + 0.004), y, z, r * 0.62, 0.01, seg, { c: hub }, true);
  if (!lod) for (let i = 0; i < 4; i++) { // スポーク表現
    const a = i / 4 * Math.PI * 2;
    gb.cbox(x + side * (w / 2 + 0.012), y + Math.cos(a) * r * 0.3, z + Math.sin(a) * r * 0.3, 0.01, 0.07, 0.07, { c: [0.25, 0.25, 0.27] });
  }
}


// ===== ミライース（LA350S型を参考）：断面を前後方向につないだローポリ車体 =====
// 断面：[z, 半幅, 下端, ベルトライン, 上端]
const MIRA_SEC = [
  [-1.6975, 0.66, 0.30, 0.96, 0.975], [-1.675, 0.70, 0.25, 0.97, 1.02], [-1.62, 0.725, 0.21, 0.98, 1.22], [-1.54, 0.735, 0.185, 0.98, 1.41],
  [-1.47, 0.7375, 0.175, 0.98, 1.485], [-1.2, 0.7375, 0.17, 0.98, 1.5], [-0.6, 0.7375, 0.17, 0.975, 1.5], [0.0, 0.7375, 0.17, 0.97, 1.5],
  [0.12, 0.7375, 0.17, 0.97, 1.485], [0.32, 0.735, 0.17, 0.97, 1.31], [0.52, 0.735, 0.175, 0.97, 1.13], [0.70, 0.733, 0.18, 0.97, 0.985],
  [0.74, 0.732, 0.18, 0.97, 0.955], [1.1, 0.728, 0.19, 0.97, 0.9], [1.4, 0.715, 0.21, 0.97, 0.84], [1.56, 0.69, 0.25, 0.97, 0.785],
  [1.65, 0.645, 0.29, 0.97, 0.71], [1.6975, 0.585, 0.32, 0.97, 0.625]
];
function miraSection([z, hw, yb, belt, top]) {
  const t = clamp((top - belt) / (1.5 - belt), 0, 1);
  const p4y = Math.min(belt - 0.04, top - 0.03), p3y = Math.min(0.6, p4y - 0.05), p2y = Math.min(yb + 0.17, p3y - 0.05);
  const P = [[0, yb], [hw * 0.92, yb], [hw, p2y], [hw * 1.0, p3y], [hw * 0.985, p4y], [hw * 0.95, Math.min(belt, top)]];
  if (top <= belt + 0.001) P.push([hw * 0.86, top + 0.004], [hw * 0.55, top + 0.012], [0, top + 0.02]);
  else P.push([hw * (0.95 - 0.12 * t), belt + (top - belt) * 0.9], [hw * (0.95 - 0.23 * t), top], [0, top + 0.012]);
  void z;
  return P;
}
function miraBand(b, zm) {
  if (b === 0) return 'under';
  if (b <= 4) return 'paint';
  if (zm < -1.665) return 'paint';
  if (zm < -1.49) return b === 5 ? 'paint' : 'glass';
  if (zm < 0.12) { if (b >= 6) return 'paint'; if (zm < -1.2) return 'paint'; if (zm > -0.8 && zm < -0.66) return 'black'; return 'glass'; }
  if (zm < 0.72) return 'glass';
  return 'paint';
}
export function buildMira(gb, glassGB, opt = {}) {
  const paint = opt.paint ? { c: opt.paint, mat: 0 } : { c: [1, 1, 1], mat: 1 };
  const black = { c: [0.05, 0.05, 0.06] }, under = { c: [0.08, 0.08, 0.09] }, dglass = { c: [0.12, 0.15, 0.19] };
  const secs = MIRA_SEC.map(miraSection);
  for (let i = 0; i < MIRA_SEC.length - 1; i++) {
    const z0 = MIRA_SEC[i][0], z1 = MIRA_SEC[i + 1][0], zm = (z0 + z1) / 2, A = secs[i], B = secs[i + 1];
    const hint = [0, 0.75, zm];
    for (let b = 0; b < 8; b++) {
      const k = miraBand(b, zm);
      for (const s of [1, -1]) {
        const p0 = [s * A[b][0], A[b][1], z0], p1 = [s * A[b + 1][0], A[b + 1][1], z0], p2 = [s * B[b + 1][0], B[b + 1][1], z1], p3 = [s * B[b][0], B[b][1], z1];
        if (k === 'glass' && glassGB) { glassGB.tri(p0, p1, p2, { c: [0.3, 0.36, 0.42] }, [0, 0], [0, 0], [0, 0], hint); glassGB.tri(p0, p2, p3, { c: [0.3, 0.36, 0.42] }, [0, 0], [0, 0], [0, 0], hint); continue; }
        const o = k === 'paint' ? paint : k === 'black' ? black : k === 'under' ? under : dglass;
        gb.tri(p0, p1, p2, o, [0, 0], [0, 0], [0, 0], hint); gb.tri(p0, p2, p3, o, [0, 0], [0, 0], [0, 0], hint);
      }
    }
  }
  for (const [idx, z] of [[0, MIRA_SEC[0][0]], [MIRA_SEC.length - 1, MIRA_SEC[MIRA_SEC.length - 1][0]]]) {
    const P = secs[idx], c = [0, 0.6, z], hint = [0, 0.6, z - Math.sign(z)];
    for (let b = 0; b < P.length - 1; b++) for (const s of [1, -1]) gb.tri(c, [s * P[b][0], P[b][1], z], [s * P[b + 1][0], P[b + 1][1], z], paint, [0, 0], [0, 0], [0, 0], hint);
  }
  const ZF = 1.6975, ZR = -1.6975;
  // フロント：細いアッパーグリル、台形の下部開口、フォグ周り、ナンバー
  gb.quadN([-0.27, 0.6, ZF + 0.004], [0.27, 0.6, ZF + 0.004], [0.25, 0.64, ZF + 0.004], [-0.25, 0.64, ZF + 0.004], [0, 0, 1], black);
  gb.quadN([-0.45, 0.36, ZF + 0.004], [0.45, 0.36, ZF + 0.004], [0.36, 0.5, ZF + 0.004], [-0.36, 0.5, ZF + 0.004], [0, 0, 1], { c: [0.1, 0.1, 0.11] });
  for (const s of [1, -1]) gb.quadN([s * 0.47, 0.38, ZF + 0.005], [s * 0.56, 0.38, ZF + 0.005], [s * 0.55, 0.45, ZF + 0.005], [s * 0.47, 0.45, ZF + 0.005], [0, 0, 1], black);
  gb.quadN([-0.165, 0.42, ZF + 0.012], [0.165, 0.42, ZF + 0.012], [0.165, 0.585, ZF + 0.012], [-0.165, 0.585, ZF + 0.012], [0, 0, 1], { c: [1, 1, 1], lay: L.PLATE_K });
  // ヘッドライト（後方へ回り込む横長の形）とウインカー
  for (const s of [1, -1]) {
    const q = [[0.27, 0.64, ZF + 0.008], [0.6, 0.655, 1.655], [0.695, 0.745, 1.565], [0.36, 0.735, 1.64]].map(p => [p[0] * s, p[1] + 0.006, p[2] + 0.006]);
    gb.tri(q[0], q[1], q[2], { c: [1, 1, 0.94], mat: 2 }, [0, 0], [0, 0], [0, 0], [0, 0.4, 1.2]); gb.tri(q[0], q[2], q[3], { c: [1, 1, 0.94], mat: 2 }, [0, 0], [0, 0], [0, 0], [0, 0.4, 1.2]);
    const w = [[0.6, 0.655, 1.655], [0.665, 0.69, 1.61], [0.68, 0.705, 1.6], [0.62, 0.672, 1.645]].map(p => [p[0] * s, p[1] + 0.01, p[2] + 0.008]);
    gb.tri(w[0], w[1], w[2], { c: [1, 0.55, 0.05], mat: s > 0 ? 10 : 11 }, [0, 0], [0, 0], [0, 0], [0, 0.4, 1.2]); gb.tri(w[0], w[2], w[3], { c: [1, 0.55, 0.05], mat: s > 0 ? 10 : 11 }, [0, 0], [0, 0], [0, 0], [0, 0.4, 1.2]);
  }
  // リア：縦長のコンビランプ、ナンバー、スポイラー、ハイマウントストップ、ワイパー、マフラー
  for (const s of [1, -1]) {
    const x0 = s * 0.47, x1 = s * 0.66;
    gb.quadN([x0, 0.74, ZR - 0.004], [x1, 0.72, ZR - 0.004], [x1 * 1.02, 0.96, ZR - 0.004], [x0, 0.97, ZR - 0.004], [0, 0, -1], { c: [0.82, 0.05, 0.06], mat: 4 });
    gb.quadN([x0, 0.80, ZR - 0.006], [x1, 0.79, ZR - 0.006], [x1, 0.84, ZR - 0.006], [x0, 0.85, ZR - 0.006], [0, 0, -1], { c: [1, 0.55, 0.05], mat: s > 0 ? 10 : 11 });
    gb.quadN([x0, 0.87, ZR - 0.006], [x1, 0.86, ZR - 0.006], [x1, 0.89, ZR - 0.006], [x0, 0.9, ZR - 0.006], [0, 0, -1], { c: [0.9, 0.9, 0.9] });
  }
  gb.quadN([-0.165, 0.6, ZR - 0.006], [0.165, 0.6, ZR - 0.006], [0.165, 0.765, ZR - 0.006], [-0.165, 0.765, ZR - 0.006], [0, 0, -1], { c: [1, 1, 1], lay: L.PLATE_K }, [[1, 1], [0, 1], [0, 0], [1, 0]]);
  gb.quadN([-0.66, 0.5, ZR - 0.004], [0.66, 0.5, ZR - 0.004], [0.66, 0.515, ZR - 0.004], [-0.66, 0.515, ZR - 0.004], [0, 0, -1], black);
  gb.box(-0.55, 0.3, ZR - 0.02, 0.55, 0.38, ZR + 0.03, { c: [0.12, 0.12, 0.13] });
  gb.box(-0.5, 1.455, -1.56, 0.5, 1.5, -1.47, paint);
  gb.box(-0.12, 1.462, -1.565, 0.12, 1.478, -1.555, { c: [0.8, 0.05, 0.05], mat: 4 });
  gb.beam([0.02, 1.12, -1.604], [-0.38, 1.27, -1.56], 0.008, black);
  gb.cylX(-0.4, 0.22, ZR + 0.05, 0.03, 0.01, 6, { c: [0.25, 0.25, 0.25] });
  // ホイールアーチ
  for (const z of [MIRA._zf, MIRA._zr]) for (const s of [1, -1]) {
    const hw = 0.7375, r = MIRA.r + 0.05, cy = MIRA.r, pts = [];
    for (let k = 0; k <= 12; k++) { const a = Math.PI * (k / 12); pts.push([cy + Math.sin(a) * r, z + Math.cos(a) * r]); }
    for (let k = 0; k < pts.length - 1; k++) gb.tri([s * (hw + 0.003), cy, z], [s * (hw + 0.003), pts[k][0], pts[k][1]], [s * (hw + 0.003), pts[k + 1][0], pts[k + 1][1]], black, [0, 0], [0, 0], [0, 0], [0, cy, z]);
    gb.quadN([s * (hw + 0.003), 0.12, z - r], [s * (hw + 0.003), 0.12, z + r], [s * (hw + 0.003), cy, z + r], [s * (hw + 0.003), cy, z - r], [s, 0, 0], black);
  }
  // ドアの見切り線・ドアハンドル・サイドミラー
  for (const s of [1, -1]) {
    const x = s * 0.7395;
    for (const [z, y0, y1] of [[0.66, 0.42, 0.97], [-0.73, 0.3, 0.975], [-1.0, 0.64, 0.98]]) gb.quadN([x, y0, z - 0.006], [x, y0, z + 0.006], [x, y1, z + 0.006], [x, y1, z - 0.006], [s, 0, 0], black);
    gb.quadN([x, 0.3, 0.66], [x, 0.3, -0.92], [x, 0.312, -0.92], [x, 0.312, 0.66], [s, 0, 0], black);
    for (const z of [-0.45, -0.95]) gb.box(Math.min(x, x + s * 0.02), 0.83, z - 0.07, Math.max(x, x + s * 0.02), 0.86, z + 0.07, { c: [0.25, 0.25, 0.27] });
    gb.box(Math.min(x, x + s * 0.06), 0.97, 0.5, Math.max(x, x + s * 0.06), 1.0, 0.58, black);
    gb.box(Math.min(s * 0.77, s * 0.93), 0.99, 0.5, Math.max(s * 0.77, s * 0.93), 1.11, 0.6, paint);
    gb.box(Math.min(s * 0.77, s * 0.93), 1.0, 0.495, Math.max(s * 0.77, s * 0.93), 1.1, 0.5, { c: [0.55, 0.62, 0.7] });
  }
}
// 14インチ・アルミホイール（8本スポーク）
export function miraWheel(gb, side) {
  const r = MIRA.r, w = 0.155, x = side * (w / 2 + 0.003), sv = [0.78, 0.79, 0.81];
  gb.cylX(0, 0, 0, r, w, 16, { c: TIRE }, true, { c: TIRE });
  gb.cylX(x, 0, 0, r * 0.7, 0.006, 16, { c: [0.12, 0.12, 0.13] }, true);
  gb.cylX(x + side * 0.004, 0, 0, 0.055, 0.01, 8, { c: sv }, true);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    gb.beam([x + side * 0.006, Math.cos(a) * 0.05, Math.sin(a) * 0.05], [x + side * 0.004, Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.68], 0.016, { c: sv });
  }
  for (let i = 0; i < 16; i++) { const a0 = i / 16 * Math.PI * 2, a1 = (i + 1) / 16 * Math.PI * 2; gb.beam([x + side * 0.004, Math.cos(a0) * r * 0.7, Math.sin(a0) * r * 0.7], [x + side * 0.004, Math.cos(a1) * r * 0.7, Math.sin(a1) * r * 0.7], 0.012, { c: sv }); }
}
// NPC用のミライース（同じ車体・塗装はtint）
export function buildMiraNPC(gb) {
  buildMira(gb, null);
  for (const s of [1, -1]) { const g = new GB(); miraWheel(g, s); const a = g.a; for (const z of [MIRA._zf, MIRA._zr]) for (let i = 0; i < a.length; i += 13) gb.a.push(a[i] + s * 0.6665, a[i + 1] + MIRA.r, a[i + 2] + z, ...a.slice(i + 3, i + 13)); }
  gb.flat(-0.79, -1.75, 0.79, 1.75, 0.05, { c: [0.05, 0.05, 0.055], mat: 5 });
}

// プレイヤー車両：外装・ガラス・内装・ホイール・ステアリング・メーター針を個別メッシュで生成
export function buildPlayerCar() {
  const p = MIRA;
  const body = new GB(), glass = new GB(), interior = new GB(), wheelG = new GB(), wheelR = new GB(), steer = new GB(), needle = new GB();
  buildMira(body, glass);
  for (const s of [1, -1]) body.beam([s * 0.682, 0.975, 0.70], [s * 0.528, 1.48, 0.125], 0.028, { c: [1, 1, 1], mat: 1 }); // Aピラー
  body.flat(-0.79, -1.75, 0.79, 1.75, 0.05, { c: [0.05, 0.05, 0.055], mat: 5 });
  miraWheel(wheelG, 1); miraWheel(wheelR, -1);
  const Wh = p.W / 2, belt = p.belt, zW = p.L / 2 - p.ws;
  const trim = { c: [0.16, 0.16, 0.17] }, beige = { c: [0.55, 0.52, 0.47] };
  // 内装：ダッシュボード
  interior.box(-Wh + 0.06, belt - 0.32, zW - 0.62, Wh - 0.06, belt - 0.02, zW - 0.05, trim);
  interior.box(-Wh + 0.06, belt - 0.05, zW - 0.62, Wh - 0.06, belt + 0.06, zW - 0.3, { c: [0.2, 0.2, 0.21] });
  // メーターフード（右ハンドル：運転席は -x 側）
  const dx = -0.36;
  interior.box(dx - 0.2, belt + 0.02, zW - 0.66, dx + 0.2, belt + 0.14, zW - 0.5, { c: [0.1, 0.1, 0.11] });
  interior.quadN([dx - 0.1, belt - 0.12, zW - 0.651], [dx + 0.1, belt - 0.12, zW - 0.651], [dx + 0.1, belt + 0.08, zW - 0.651], [dx - 0.1, belt + 0.08, zW - 0.651], [0, 0, -1], { c: [0.9, 0.9, 0.9], lay: L.METER, mat: 0 }, [[1, 1], [0, 1], [0, 0], [1, 0]]);
  // センターパネル
  interior.quadN([-0.14, belt - 0.32, zW - 0.63], [0.14, belt - 0.32, zW - 0.63], [0.14, belt - 0.06, zW - 0.63], [-0.14, belt - 0.06, zW - 0.63], [0, 0, -1], { c: [1, 1, 1], lay: L.PANEL }, [[1, 1], [0, 1], [0, 0], [1, 0]]);
  interior.box(-0.14, 0.25, zW - 1.2, 0.14, belt - 0.32, zW - 0.6, trim); // センターコンソール
  // シート
  for (const sx of [-0.36, 0.36]) {
    interior.box(sx - 0.24, 0.3, -1.02, sx + 0.24, 0.5, -0.5, { c: [1, 1, 1], side: { lay: L.SEAT, tw: 0.5, th: 0.5 }, top: { lay: L.SEAT, tw: 0.5 } });
    interior.box(sx - 0.24, 0.45, -1.14, sx + 0.24, 1.15, -0.99, { c: [1, 1, 1], side: { lay: L.SEAT, tw: 0.5, th: 0.5 }, top: { lay: L.SEAT, tw: 0.5 } });
  }
  interior.box(-Wh + 0.08, 0.3, -1.52, Wh - 0.08, 0.5, -1.18, { c: [1, 1, 1], side: { lay: L.SEAT, tw: 0.5, th: 0.5 }, top: { lay: L.SEAT, tw: 0.5 } });
  interior.box(-Wh + 0.08, 0.45, -1.62, Wh - 0.08, 1.05, -1.5, { c: [1, 1, 1], side: { lay: L.SEAT, tw: 0.5, th: 0.5 } });
  // 床・内張り・天井
  interior.box(-Wh + 0.03, 0.22, -1.5, Wh - 0.03, 0.26, zW - 0.1, { c: [0.12, 0.12, 0.12] });
  for (const s of [1, -1]) interior.box(s * (Wh - 0.04) - 0.025, 0.3, -1.5, s * (Wh - 0.04) + 0.025, belt + 0.03, zW - 0.2, beige);
  interior.box(-Wh + 0.12, p.H - 0.09, -1.35, Wh - 0.12, p.H - 0.06, p.L / 2 - p.wsT - 0.05, { c: [0.75, 0.73, 0.68] });
  // ルームミラー
  const zFt = p.L / 2 - p.wsT;
  interior.box(-0.11, p.H - 0.22, zFt - 0.12, 0.11, p.H - 0.15, zFt - 0.08, { c: [0.1, 0.1, 0.1] });
  interior.box(-0.1, p.H - 0.215, zFt - 0.121, 0.1, p.H - 0.155, zFt - 0.119, { c: [0.6, 0.7, 0.8], mat: 5 });
  // ステアリング（原点中心、z+向きに面する）
  const sr = 0.18, n = 14;
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
    steer.beam([Math.cos(a0) * sr, Math.sin(a0) * sr, 0], [Math.cos(a1) * sr, Math.sin(a1) * sr, 0], 0.018, { c: [0.2, 0.2, 0.22] });
  }
  steer.cbox(0, 0, 0.01, 0.12, 0.09, 0.05, { c: [0.12, 0.12, 0.13] });
  steer.beam([0, 0, 0], [-sr, 0, 0], 0.014, { c: [0.1, 0.1, 0.1] }); steer.beam([0, 0, 0], [sr, 0, 0], 0.014, { c: [0.1, 0.1, 0.1] });
  steer.beam([0, 0, 0], [0, -sr, 0], 0.014, { c: [0.1, 0.1, 0.1] });
  steer.beam([0, 0, 0.02], [0, 0, 0.35], 0.03, { c: [0.1, 0.1, 0.1] });
  needle.box(-0.004, 0, -0.002, 0.004, 0.07, 0.002, { c: [1, 0.3, 0.1], mat: 5 });
  return { p, body, glass, interior, wheel: wheelG, wheelR, steer, needle, driverX: dx, eye: [dx, 1.16, -0.42], wheelPos: [[-0.6665, p._zf, 1], [0.6665, p._zf, 1], [-0.6665, p._zr, 0], [0.6665, p._zr, 0]], steerPos: [dx, belt - 0.03, zW - 0.76], meterPos: [dx, belt - 0.03, zW - 0.656] };
}
