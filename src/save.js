// セーブ：IndexedDB（DB名 minase-drive / キー slot1）。localStorage にも同じ内容を控えとして保存し、
// どちらも使えない環境ではメモリのみ（その場合は「保存できない」と表示する）
const DB = 'minase-drive', STORE = 'save', KEY = 'slot1';
let mem = null;
function open() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
    } catch (e) { rej(e); }
  });
}
async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((res, rej) => { const t = db.transaction(STORE, mode), st = t.objectStore(STORE), r = fn(st); let out; if (r) r.onsuccess = () => { out = r.result; }; t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  } finally { db.close(); } // 接続を閉じる（別タブでの更新を妨げない）
}
export async function saveGame(data) {
  mem = data;
  let ls = false;
  try { localStorage.setItem(DB, JSON.stringify(data)); ls = true; } catch (e) { /* 容量不足・プライベートモード */ }
  try { await tx('readwrite', st => st.put(data, KEY)); return 'IndexedDB'; } catch (e) { return ls ? 'localStorage' : 'memory'; }
}
export async function loadGame() {
  let a = null, b = null;
  try { a = await tx('readonly', st => st.get(KEY)); } catch (e) { /* fallthrough */ }
  try { const s = localStorage.getItem(DB); if (s) b = JSON.parse(s); } catch (e) { /* none */ }
  // 新しい方を使う（IndexedDB の書き込みが途中で失敗した場合の保険）
  const v = a && b ? ((b.at || 0) > (a.at || 0) ? b : a) : a || b || mem;
  return v && typeof v === 'object' ? v : null;
}
export async function clearSave() {
  mem = null;
  try { localStorage.removeItem(DB); } catch (e) { /* none */ }
  try { await tx('readwrite', st => st.delete(KEY)); } catch (e) { /* none */ }
}
