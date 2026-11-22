// テクスチャ配列（256x256 レイヤー）をCanvasで手続き生成。アルファ = 夜間発光マスク
import { rng } from './math.js';
export const TS = 256;
export const L = {};
const layers = []; // {name, draw(ctx, img)}
const names = ['WHITE', 'OFFICE', 'OFFICE2', 'APT', 'HOUSE', 'SHOP', 'SHUTTER', 'ASPHALT', 'SIDEWALK', 'GRASS', 'PADDY', 'WATER',
  'ROOF', 'KAWARA', 'METAL', 'PLATE_K', 'PLATE_W', 'STOP', 'SP30', 'SP40', 'SP50', 'SP60', 'GUIDE', 'METER', 'PANEL', 'PARK_P', 'MANSION', 'HOTEL', 'FIELD', 'TRAINWIN', 'SEAT', 'GLOW', 'TREE', 'ONEWAY', 'NOENTRY', 'RAIL', 'ROCK', 'TUNNELWALL', 'FOREST', 'TRAMWIN', 'CURVE'];
names.forEach((n, i) => L[n] = i);

export const FONT = "'Hiragino Kaku Gothic ProN','Hiragino Sans','Noto Sans JP','Noto Sans CJK JP','Yu Gothic','Meiryo',sans-serif";

// 架空ブランド看板（実在ブランドは使用しない）
export const SIGNS = [
  ['CONBINI', 'ことりマート', '#ffffff', '#1f8a4c', '24H', '#f2a31b'],
  ['CONBINI2', 'ミドリヤ', '#2457a6', '#ffffff', 'STORE', '#ffd200'],
  ['DRUG', 'ドラッグ ハルカ', '#ffe100', '#1b3c8c', '薬', '#e83b2e'],
  ['SUPER', 'スーパー いろは', '#e8412c', '#ffffff', '食品', '#ffffff'],
  ['HOMEC', 'ホームセンター カナメ', '#f28c00', '#ffffff', 'DIY', '#ffffff'],
  ['DENKI', 'でんきのヒカリ', '#d81e26', '#ffef00', '家電', '#ffffff'],
  ['MALL', 'ミナセモール', '#ffffff', '#c2185b', 'SHOPPING', '#555555'],
  ['FAMIRES', 'ファミリー亭 ふくろう', '#7a1f1f', '#ffe9b0', 'RESTAURANT', '#ffffff'],
  ['BURGER', 'バーガーミナト', '#c8102e', '#ffffff', 'BURGER', '#ffd100'],
  ['RAMEN', 'ラーメン 龍門', '#111111', '#ffcc00', '中華そば', '#ff4444'],
  ['GAS', 'オオゾラ石油', '#0a5bb5', '#ffffff', 'SELF', '#ffda1a'],
  ['DEALER', 'ミナセ自動車', '#14335c', '#ffffff', '新車・中古車', '#9fd4ff'],
  ['PACHI', 'パーラー ギャラクシー', '#5b1fa8', '#ffee00', 'P', '#ff3fbf'],
  ['BANK', 'あけぼの銀行', '#0e6e5c', '#ffffff', 'ATM', '#ffffff'],
  ['POST', '水瀬郵便局', '#d7141a', '#ffffff', '〒', '#ffffff'],
  ['CITY', '水瀬市役所', '#f4f1e8', '#222222', 'CITY HALL', '#666666'],
  ['POLICE', '水瀬警察署', '#f4f4f4', '#1d3d8f', 'POLICE', '#1d3d8f'],
  ['FIRE', '水瀬消防署', '#c4161c', '#ffffff', 'FIRE', '#ffffff'],
  ['HOSP', '水瀬総合病院', '#ffffff', '#11804a', 'HOSPITAL', '#11804a'],
  ['SCHOOL', '水瀬市立 第一小学校', '#f2efe6', '#2c2c2c', '', '#2c2c2c'],
  ['STATION', 'みなせ駅  MINASE STA.', '#173f8a', '#ffffff', 'JR', '#ffffff'],
  ['HOTEL', 'ビジネスホテル 水瀬イン', '#2a2a40', '#ffd58a', 'HOTEL', '#ffffff'],
  ['BUS', '水瀬バスターミナル', '#0b7d4e', '#ffffff', 'BUS', '#ffffff'],
  ['COINP', 'コインパーキング 100円/30分', '#ffd200', '#222222', 'P', '#0a4fb5'],
  ['TSUKI', '月極駐車場 空きあり', '#ffffff', '#1a4ea8', 'P', '#e02020'],
  ['FACTORY', '水瀬精機 第二工場', '#e9e9e2', '#2a4a7a', 'FACTORY', '#2a4a7a'],
  ['SOKO', '北日本ロジ 倉庫', '#e6e6e0', '#b5361c', 'LOGISTICS', '#b5361c'],
  ['SHOP1', '洋品店 さくら', '#f7e3e8', '#a8204a', '', '#a8204a'],
  ['SHOP2', '八百屋 まるき', '#1d6b2d', '#ffffff', '', '#ffffff'],
  ['SHOP3', 'カフェ こもれび', '#4a3424', '#f3e2c0', 'CAFE', '#f3e2c0'],
  ['SHOP4', '本の森書店', '#2b3a67', '#ffffff', 'BOOKS', '#ffffff'],
  ['SHOP5', '居酒屋 まんぷく', '#2a0f0f', '#ff5a3c', '', '#ffffff'],
  ['SHOP6', 'クリーニング みなせ', '#e8f3ff', '#0d5fb4', '', '#0d5fb4'],
  ['SHOP7', '和菓子 柳屋', '#6b4a2e', '#fff3dc', '', '#fff3dc'],
  ['SHOTEN', '水瀬銀座商店街', '#b81d24', '#ffffff', '', '#ffffff'],
  ['OFFICE_A', '東北ミナセ生命', '#ffffff', '#103d7a', '', '#103d7a'],
  ['OFFICE_B', 'みちのく電力', '#0f5aa6', '#ffffff', '', '#ffffff'],
  ['DEPT', 'ミナセ百貨店', '#efe4cf', '#6b1f2f', '', '#6b1f2f'],
  ['MALL2', 'ミナセモール東', '#ffffff', '#2a6fb0', 'SHOPPING', '#f29a1f'],
  ['GYUDON', '牛丼 まるや', '#f39800', '#ffffff', '早い', '#7a2b00'],
  ['SUSHI', '回転寿司 うず潮', '#0d4c8c', '#ffffff', '寿司', '#ffffff'],
  ['BOOKS2', '本とゲームの森', '#ffd400', '#1a1a1a', 'USED', '#1a1a1a'],
  ['DEALER2', 'みちのくモータース', '#c4161c', '#ffffff', 'CARS', '#ffffff'],
  ['TIRE', 'タイヤ館 くるま堂', '#222222', '#ffcc00', 'TIRE', '#ffffff'],
  ['TUNNEL', '水瀬トンネル  延長 300m', '#2c2c2c', '#ffffff', '', '#ffffff'],
  ['MICHI', '道の駅 みなせ峠', '#1f5d2e', '#ffffff', '休憩', '#ffffff'],
  ['TRAMSTOP', '電停  市役所前', '#1b4fa0', '#ffffff', 'TRAM', '#ffffff'],
  ['RIVERPARK', '水瀬川河川公園', '#ffffff', '#1d6b3a', 'PARK', '#1d6b3a'],
  ['SHRINE', '水瀬神社', '#3a2a1a', '#f3e2c0', '', '#f3e2c0'],
  ['FARMCOOP', 'JA みなせ 農産物直売所', '#11804a', '#ffffff', '直売', '#ffffff'],
  ['INDUS2', '東北ミナセ化学', '#ffffff', '#0f5aa6', 'CHEMICAL', '#0f5aa6'],
  ['TAXI', 'タクシー乗り場', '#ffcc00', '#111111', 'TAXI', '#111111'],
];
SIGNS.forEach((s, i) => L['SG_' + s[0]] = names.length + i);
export const LAYER_COUNT = names.length + SIGNS.length;

function px(img, x0, y0, w, h, r, g, b, a = 255) {
  const d = img.data;
  for (let y = Math.max(0, y0); y < Math.min(TS, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(TS, x0 + w); x++) {
    const i = (y * TS + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
}
function noise(img, amt, R) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
}
// 窓グリッド：cols x rows 区画、各区画に窓
function windows(img, cols, rows, R, f) {
  const cw = TS / cols, ch = TS / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) f(Math.round(c * cw), Math.round(r * ch), Math.round(cw), Math.round(ch), R() < 0.45, R);
}

function drawLayer(i, ctx) {
  const R = rng(1000 + i * 77);
  const img = ctx.createImageData(TS, TS);
  const n = names[i];
  const fill = (r, g, b, a = 0) => px(img, 0, 0, TS, TS, r, g, b, a);
  switch (n) {
    case 'WHITE': fill(255, 255, 255, 0); break;
    case 'OFFICE': // 4x4区画。白い壁に横長窓
      fill(236, 236, 232, 0);
      windows(img, 4, 4, R, (x, y, w, h, lit) => {
        px(img, x + 4, y + 10, w - 8, h - 22, 70, 92, 112, lit ? 255 : 0);
        px(img, x + 4, y + 10 + (h - 22) / 2 | 0, w - 8, 2, 190, 196, 200, lit ? 255 : 0);
        px(img, x, y + h - 6, w, 3, 200, 200, 196, 0);
      }); noise(img, 8, R); break;
    case 'OFFICE2': // 連続窓
      fill(205, 208, 212, 0);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
        const lit = R() < 0.5; px(img, c * 32 + 1, r * 64 + 12, 30, 40, 55, 78, 98, lit ? 255 : 0);
      }
      for (let r = 0; r < 4; r++) px(img, 0, r * 64 + 52, TS, 12, 225, 226, 228, 0); noise(img, 6, R); break;
    case 'APT': // アパート：ベランダ＋掃き出し窓
      fill(235, 230, 220, 0);
      windows(img, 4, 4, R, (x, y, w, h, lit) => {
        px(img, x + 6, y + 6, w - 12, h - 18, 120, 140, 150, lit ? 255 : 0);
        px(img, x + 6, y + 6, 4, h - 18, 210, 210, 205, 0);
        px(img, x + 2, y + h - 26, w - 4, 18, 200, 200, 196, 0);
        for (let k = 0; k < w - 4; k += 6) px(img, x + 2 + k, y + h - 26, 2, 18, 150, 150, 150, 0);
        px(img, x, y + h - 8, w, 8, 180, 178, 172, 0);
      }); noise(img, 8, R); break;
    case 'MANSION':
      fill(222, 214, 200, 0);
      windows(img, 4, 4, R, (x, y, w, h, lit) => {
        px(img, x + 4, y + 4, w - 8, h - 14, 96, 112, 126, lit ? 255 : 0);
        px(img, x + 2, y + h - 30, w - 4, 22, 238, 236, 230, 0);
        px(img, x + 2, y + h - 30, w - 4, 3, 160, 150, 140, 0);
        px(img, x, y + h - 8, w, 8, 196, 188, 175, 0);
      }); noise(img, 6, R); break;
    case 'HOTEL':
      fill(210, 200, 190, 0);
      windows(img, 8, 4, R, (x, y, w, h, lit) => {
        px(img, x + 6, y + 14, w - 12, h - 30, 60, 72, 88, lit ? 255 : 0);
      }); noise(img, 6, R); break;
    case 'HOUSE': // 2窓 x 2階
      fill(240, 240, 240, 0);
      windows(img, 2, 2, R, (x, y, w, h, lit) => {
        px(img, x + 30, y + 30, w - 60, h - 64, 90, 110, 120, lit ? 255 : 0);
        px(img, x + 30, y + 30 + (h - 64) / 2 | 0, w - 60, 3, 220, 220, 220, lit ? 255 : 0);
        px(img, x + 26, y + h - 36, w - 52, 5, 160, 160, 160, 0);
        px(img, x + 64, y + 30, 3, h - 64, 220, 220, 220, lit ? 255 : 0);
      }); noise(img, 10, R); break;
    case 'SHOP': // 店舗ガラス面
      fill(60, 60, 60, 0);
      px(img, 0, 30, TS, 200, 200, 210, 215, 255);
      for (let k = 0; k < 4; k++) px(img, k * 64, 30, 5, 200, 90, 90, 90, 0);
      px(img, 0, 120, TS, 4, 100, 100, 100, 200);
      px(img, 0, 0, TS, 30, 230, 230, 230, 0);
      for (let k = 0; k < 30; k++) px(img, R() * 240 | 0, 140 + R() * 80 | 0, 10 + R() * 20 | 0, 6 + R() * 20 | 0, 150 + R() * 100 | 0, 120 + R() * 120 | 0, 100 + R() * 120 | 0, 255);
      break;
    case 'SHUTTER':
      fill(190, 190, 186, 0);
      for (let y = 40; y < TS; y += 8) px(img, 10, y, TS - 20, 3, 150, 150, 146, 0);
      px(img, 0, 0, TS, 40, 120, 60, 40, 0);
      px(img, 120, 60, 120, 190, 210, 200, 170, 230); break;
    case 'ASPHALT':
      fill(72, 72, 74, 0); noise(img, 22, R);
      for (let k = 0; k < 40; k++) px(img, R() * 250 | 0, R() * 250 | 0, 2 + R() * 6 | 0, 1, 50, 50, 52, 0); break;
    case 'SIDEWALK':
      fill(170, 162, 150, 0);
      for (let y = 0; y < TS; y += 32) for (let x = 0; x < TS; x += 64) {
        const o = (y / 32 % 2) * 32; const c = 150 + R() * 30;
        px(img, x + o + 2, y + 2, 60, 28, c, c - 8, c - 18, 0);
      } noise(img, 10, R); break;
    case 'GRASS': fill(86, 118, 58, 0); noise(img, 30, R); break;
    case 'PADDY':
      fill(98, 140, 62, 0);
      for (let y = 0; y < TS; y += 8) px(img, 0, y, TS, 3, 70, 110, 50, 0);
      noise(img, 16, R); px(img, 0, 0, TS, 6, 140, 125, 90, 0); px(img, 0, 0, 6, TS, 140, 125, 90, 0); break;
    case 'WATER':
      fill(60, 92, 110, 0);
      for (let k = 0; k < 120; k++) px(img, R() * 250 | 0, R() * 250 | 0, 8 + R() * 30 | 0, 2, 110, 140, 155, 0); break;
    case 'ROOF': fill(150, 150, 146, 0); noise(img, 18, R);
      for (let y = 0; y < TS; y += 64) px(img, 0, y, TS, 2, 120, 120, 118, 0); break;
    case 'KAWARA':
      fill(200, 200, 200, 0);
      for (let y = 0; y < TS; y += 16) { px(img, 0, y, TS, 4, 120, 120, 120, 0); for (let x = (y / 16 % 2) * 16; x < TS; x += 32) px(img, x, y, 3, 16, 150, 150, 150, 0); }
      noise(img, 10, R); break;
    case 'METAL':
      fill(205, 208, 210, 0);
      for (let x = 0; x < TS; x += 12) px(img, x, 0, 4, TS, 170, 174, 178, 0); noise(img, 6, R); break;
    case 'FIELD': fill(176, 150, 112, 0); noise(img, 26, R); break;
    case 'TRAINWIN':
      fill(225, 228, 230, 0); px(img, 0, 150, TS, 22, 40, 140, 70, 0);
      for (let x = 10; x < TS; x += 64) px(img, x, 50, 48, 70, 70, 90, 105, 255); break;
    case 'SEAT': fill(48, 48, 52, 0); for (let y = 0; y < TS; y += 20) px(img, 0, y, TS, 3, 30, 30, 32, 0); noise(img, 10, R); break;
    case 'GLOW': {
      const d = img.data;
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const r = Math.hypot(x - 128, y - 128) / 128, v = Math.max(0, 1 - r) ** 2 * 255, k = (y * TS + x) * 4;
        d[k] = v; d[k + 1] = v; d[k + 2] = v; d[k + 3] = 255;
      } break;
    }
    case 'RAIL': fill(110, 100, 90, 0); for (let y = 0; y < TS; y += 32) px(img, 0, y, TS, 10, 80, 70, 60, 0); px(img, 60, 0, 14, TS, 160, 160, 165, 0); px(img, 182, 0, 14, TS, 160, 160, 165, 0); noise(img, 12, R); break;
    case 'ROCK': fill(120, 116, 108, 0); for (let k = 0; k < 300; k++) { const c = 90 + R() * 70; px(img, R() * 250 | 0, R() * 250 | 0, 6 + R() * 20 | 0, 3 + R() * 10 | 0, c, c - 3, c - 8, 0); } break;
    case 'TUNNELWALL': fill(170, 168, 160, 0); for (let y = 0; y < TS; y += 32) px(img, 0, y, TS, 2, 120, 118, 112, 0); for (let x = 0; x < TS; x += 64) px(img, x, 0, 2, TS, 120, 118, 112, 0); noise(img, 14, R); break;
    case 'FOREST': fill(52, 82, 44, 0); for (let k = 0; k < 900; k++) { const c = 30 + R() * 50; px(img, R() * 252 | 0, R() * 252 | 0, 3 + R() * 6 | 0, 3 + R() * 6 | 0, c * 0.7, c + 25, c * 0.5, 0); } break;
    case 'TRAMWIN':
      fill(235, 238, 240, 0); px(img, 0, 175, TS, 40, 22, 110, 70, 0); px(img, 0, 215, TS, 8, 230, 200, 40, 0);
      for (let x = 8; x < TS; x += 50) px(img, x, 40, 40, 110, 60, 80, 95, 255); break;
    case 'TREE': fill(70, 110, 50, 0); for (let k = 0; k < 400; k++) { const c = 40 + R() * 60; px(img, R() * 250 | 0, R() * 250 | 0, 4 + R() * 10 | 0, 4 + R() * 8 | 0, c * 0.6, c + 30, c * 0.4, 0); } break;
    default: fill(255, 255, 255, 0);
  }
  const TEXT = ['PLATE_K', 'PLATE_W', 'STOP', 'SP30', 'SP40', 'SP50', 'SP60', 'GUIDE', 'METER', 'PANEL', 'PARK_P', 'ONEWAY', 'NOENTRY', 'CURVE'];
  if (i < names.length && !TEXT.includes(n)) return img.data; // ピクセル系はCanvasを経由しない（α=0でRGBが失われるため）
  ctx.putImageData(img, 0, 0);
  // 文字・図形系
  const T = (txt, x, y, size, col, w = 700) => { ctx.fillStyle = col; ctx.font = `${w} ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y); };
  if (n === 'PLATE_K' || n === 'PLATE_W') { // ナンバープレート（架空地名）横長 2:1
    ctx.fillStyle = n === 'PLATE_K' ? '#f3d23a' : '#f2f2ee'; ctx.fillRect(0, 0, TS, TS);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, TS - 12, TS - 12);
    const c = n === 'PLATE_K' ? '#1a1a1a' : '#0f5a2c';
    ctx.save(); ctx.scale(1, 2); T('水瀬 580', 128, 22, 40, c); T('12-34', 140, 80, 80, c); T(n === 'PLATE_K' ? 'あ' : 'さ', 30, 82, 40, c); ctx.restore();
  } else if (n === 'STOP') {
    ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.clearRect(0, 0, TS, TS);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(8, 20); ctx.lineTo(248, 20); ctx.lineTo(128, 236); ctx.fill();
    ctx.fillStyle = '#d71f26'; ctx.beginPath(); ctx.moveTo(26, 30); ctx.lineTo(230, 30); ctx.lineTo(128, 214); ctx.fill();
    T('止まれ', 128, 82, 54, '#fff');
  } else if (n && n.startsWith('SP')) {
    ctx.clearRect(0, 0, TS, TS);
    ctx.fillStyle = '#d71f26'; ctx.beginPath(); ctx.arc(128, 128, 124, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(128, 128, 96, 0, 7); ctx.fill();
    T(n.slice(2), 128, 136, 120, '#1d3a8a');
  } else if (n === 'GUIDE') {
    ctx.fillStyle = '#1b4fa0'; ctx.fillRect(0, 0, TS, TS); ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, TS - 16, TS - 16);
    ctx.save(); ctx.scale(1, 2);
    T('↑ 水瀬駅', 128, 22, 34, '#fff'); T('← 市役所   郊外 →', 128, 62, 28, '#fff'); T('Minase Sta.', 128, 42, 18, '#fff', 400); ctx.restore();
  } else if (n === 'METER') {
    ctx.fillStyle = '#0c0d10'; ctx.fillRect(0, 0, TS, TS);
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(128, 140, 100, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
    for (let k = 0; k <= 14; k++) {
      const a = Math.PI * 0.75 + k / 14 * Math.PI * 1.5;
      ctx.beginPath(); ctx.moveTo(128 + Math.cos(a) * 100, 140 + Math.sin(a) * 100); ctx.lineTo(128 + Math.cos(a) * (k % 2 ? 90 : 82), 140 + Math.sin(a) * (k % 2 ? 90 : 82)); ctx.stroke();
      if (k % 2 === 0) T(String(k * 10), 128 + Math.cos(a) * 64, 140 + Math.sin(a) * 64, 18, '#eee');
    }
    T('km/h', 128, 190, 16, '#9cf', 400);
  } else if (n === 'PANEL') {
    ctx.fillStyle = '#26272b'; ctx.fillRect(0, 0, TS, TS);
    ctx.fillStyle = '#111'; ctx.fillRect(30, 20, 196, 60); T('FM 80.7', 128, 50, 30, '#5cf');
    for (let k = 0; k < 3; k++) { ctx.fillStyle = '#3a3b40'; ctx.beginPath(); ctx.arc(64 + k * 64, 150, 26, 0, 7); ctx.fill(); }
    T('A/C', 128, 210, 22, '#aaa');
  } else if (n === 'ONEWAY') {
    ctx.fillStyle = '#1b4fa0'; ctx.fillRect(0, 40, TS, 176); ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.strokeRect(10, 50, TS - 20, 156);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(30, 110); ctx.lineTo(170, 110); ctx.lineTo(170, 80); ctx.lineTo(230, 128); ctx.lineTo(170, 176); ctx.lineTo(170, 146); ctx.lineTo(30, 146); ctx.fill();
    T('一方通行', 110, 194, 30, '#fff');
  } else if (n === 'NOENTRY') {
    ctx.clearRect(0, 0, TS, TS); ctx.fillStyle = '#d71f26'; ctx.beginPath(); ctx.arc(128, 128, 124, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(40, 108, 176, 40);
  } else if (n === 'CURVE') {
    ctx.clearRect(0, 0, TS, TS); ctx.fillStyle = '#f2c500'; ctx.beginPath(); ctx.moveTo(128, 8); ctx.lineTo(248, 128); ctx.lineTo(128, 248); ctx.lineTo(8, 128); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.stroke();
    ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(100, 190); ctx.lineTo(100, 120); ctx.quadraticCurveTo(100, 80, 150, 80); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(150, 55); ctx.lineTo(190, 80); ctx.lineTo(150, 105); ctx.fill();
  } else if (n === 'PARK_P') {
    ctx.fillStyle = '#1b4fa0'; ctx.fillRect(0, 0, TS, TS); T('P', 128, 132, 210, '#fff');
  } else if (i >= names.length) {
    const s = SIGNS[i - names.length];
    const a = 4; // 表示アスペクト 4:1
    ctx.fillStyle = s[2]; ctx.fillRect(0, 0, TS, TS);
    ctx.fillStyle = s[5]; ctx.fillRect(0, TS - 18, TS, 18);
    ctx.save(); ctx.scale(1, a);
    ctx.font = `700 40px ${FONT}`; const w = ctx.measureText(s[1]).width;
    const sz = Math.min(40, 40 * 200 / Math.max(1, w));
    T(s[1], s[4] ? 142 : 128, 28, sz, s[3]);
    if (s[4]) T(s[4], 26, 30, s[4].length > 3 ? 9 : 22, s[5]);
    ctx.restore();
    const im = ctx.getImageData(0, 0, TS, TS); for (let k = 3; k < im.data.length; k += 4) im.data[k] = 255;
    return im.data;
  }
  return ctx.getImageData(0, 0, TS, TS).data;
}

// 全レイヤーを1つのUint8Arrayにまとめる
export function buildLayers() {
  const cv = document.createElement('canvas'); cv.width = cv.height = TS;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const out = new Uint8Array(TS * TS * 4 * LAYER_COUNT);
  for (let i = 0; i < LAYER_COUNT; i++) {
    ctx.clearRect(0, 0, TS, TS);
    out.set(drawLayer(i, ctx), i * TS * TS * 4);
  }
  return out;
}
