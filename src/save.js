// セーブ：IndexedDB（使えない環境では localStorage、どちらも不可ならメモリのみ）
const DB = 'minase-drive', STORE = 'save', KEY = 'slot1';
let mem = null;
function open() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
export async function saveGame(data) {
  mem = data;
  try {
    const db = await open();
    await new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(data, KEY); t.oncomplete = res; t.onerror = () => rej(t.error); });
    return 'IndexedDB';
  } catch (e) {
    try { localStorage.setItem(DB, JSON.stringify(data)); return 'localStorage'; } catch (e2) { return 'memory'; }
  }
}
export async function loadGame() {
  try {
    const db = await open();
    const v = await new Promise((res, rej) => { const t = db.transaction(STORE, 'readonly'); const r = t.objectStore(STORE).get(KEY); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (v) return v;
  } catch (e) { /* fallthrough */ }
  try { const s = localStorage.getItem(DB); if (s) return JSON.parse(s); } catch (e) { /* none */ }
  return mem;
}
