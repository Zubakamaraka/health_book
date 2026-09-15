/* ===================================================================
   store.js — данные приложения.

   Главное правило проекта: данные пользователя не теряются НИКОГДА.
   Как это обеспечивается:
     1. Данные лежат в localStorage браузера, приложение — в кэше
        Service Worker'а. Это разные хранилища: обновление кода
        физически не может затронуть записи.
     2. У данных есть schemaVersion и цепочка миграций. Новая версия
        приложения не перезаписывает старые данные, а дочитывает их
        до нового формата. Изменения только добавляющие.
     3. Перед любой миграцией откладывается копия исходных данных
        в отдельный ключ — на случай отката.
     4. Если данные не читаются (повреждены), приложение НЕ затирает
        их пустышкой, а поднимает флаг и предлагает восстановление.
     5. Адрес приложения менять нельзя: для браузера другой адрес —
        это другое хранилище.
   =================================================================== */

export const APP_VERSION = "1.2.0";
export const SCHEMA_VERSION = 1;

const KEY       = "healthbook.data";
const KEY_PREV  = "healthbook.data.prev";      // копия перед миграцией
const KEY_BROKEN= "healthbook.data.broken";    // сюда уходит нечитаемое
const KEY_PREFS = "healthbook.prefs";          // тема и масштаб — отдельно и независимо

/* ---------- Надёжная обёртка над localStorage ---------- */
const mem = {};
export const LS = {
  ok:true,
  get(k){ try{ return localStorage.getItem(k); }catch(e){ this.ok=false; return mem[k] ?? null; } },
  set(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ this.ok=false; mem[k]=v; return false; } },
  del(k){ try{ localStorage.removeItem(k); }catch(e){ delete mem[k]; } }
};

/* ---------- Идентификаторы ---------- */
let idCounter = 0;
export function uid(prefix="id"){
  idCounter++;
  return prefix + "_" + Date.now().toString(36) + "_" + idCounter.toString(36) +
         Math.random().toString(36).slice(2,6);
}

/* ---------- Пустые данные ---------- */
function emptyData(){
  const pid = uid("pr");
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    profiles: [{ id:pid, name:"Мой профиль", birthYear:null, sex:"", note:"" }],
    activeProfileId: pid,

    /* Библиотека */
    libraryCustom: [],        // позиции, созданные пользователем
    libraryEdits: {},         // правки встроенных позиций: { builtinId: {поля} }
    libraryHidden: [],        // скрытые встроенные позиции
    wikiCache: {},            // {ключ: {title, extract, url, fetchedAt}} — скачано пользователем

    /* Назначения (курсы приёма) */
    courses: [],

    /* Свои наборы: «то, что мы обычно покупаем при простуде» и т. п.
       Составляет их сам пользователь — приложение ничего не советует. */
    kits: [],

    /* Отметки приёма: intake["YYYY-MM-DD"][courseId] = {morning:true,...} */
    intake: {},

    /* Дневник */
    measurements: [],
    dayNotes: [],

    /* Служебное */
    meta: { lastBackupAt:null, disclaimerSeen:false, appVersion:APP_VERSION }
  };
}

/* ---------- Миграции ---------- *
   Каждая функция получает данные версии N и возвращает версию N+1.
   Ничего не удаляет, только добавляет недостающее.
   Когда появится версия 2, сюда добавится migrations[1] = d => {...}
*/
const migrations = [
  // индекс 0: из версии 0/неизвестной в версию 1
  (d) => {
    const base = emptyData();
    const out = Object.assign({}, base, d || {});
    if(!Array.isArray(out.profiles) || !out.profiles.length) out.profiles = base.profiles;
    if(!out.activeProfileId || !out.profiles.some(p=>p.id===out.activeProfileId))
      out.activeProfileId = out.profiles[0].id;
    out.meta = Object.assign({}, base.meta, out.meta||{});
    out.schemaVersion = 1;
    return out;
  }
];

/* ---------- Состояние ---------- */
export const state = {
  data: null,
  loadError: null,      // текст проблемы, если данные не прочитались
  builtinLibrary: [],   // data/library.json
  online: navigator.onLine
};

/* ---------- Чтение и запись ---------- */
export function load(){
  const raw = LS.get(KEY);

  if(raw === null || raw === ""){
    state.data = emptyData();
    save();
    return state.data;
  }

  let parsed = null;
  try{
    parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== "object") throw new Error("не объект");
  }catch(e){
    // Данные не читаются. НИЧЕГО НЕ ЗАТИРАЕМ: откладываем как есть.
    LS.set(KEY_BROKEN, raw);
    state.loadError = "Файл данных не читается. Он сохранён отдельно и не удалён.";
    state.data = emptyData();
    return state.data;
  }

  const from = Number(parsed.schemaVersion) || 0;

  if(from > SCHEMA_VERSION){
    // Данные от более новой версии приложения. Не трогаем их.
    state.loadError = "Данные сохранены более новой версией приложения. " +
                      "Обновите приложение, чтобы не потерять записи.";
    state.data = migrateForward(parsed, 0); // читаем как умеем, но не сохраняем поверх
    state.data.__readOnlyGuard = true;
    return state.data;
  }

  if(from < SCHEMA_VERSION){
    LS.set(KEY_PREV + ".v" + from, raw);   // страховочная копия перед миграцией
    parsed = migrateForward(parsed, from);
    state.data = parsed;
    save();
    return state.data;
  }

  state.data = normalize(parsed);
  return state.data;
}

function migrateForward(d, from){
  let cur = d;
  for(let v = from; v < SCHEMA_VERSION; v++){
    const fn = migrations[v];
    if(typeof fn === "function") cur = fn(cur);
  }
  return normalize(cur);
}

/* Мягкая нормализация: добавляет поля, появившиеся в новых версиях,
   но никогда не удаляет то, что уже есть. */
function normalize(d){
  const base = emptyData();
  for(const k of Object.keys(base)){
    if(d[k] === undefined) d[k] = base[k];
  }
  if(!Array.isArray(d.profiles) || !d.profiles.length) d.profiles = base.profiles;
  // Поля, появившиеся в новых версиях, добавляются молча и ничего не затирают
  d.profiles.forEach(p => {
    if(p.sex === undefined) p.sex = "";
    if(p.birthYear === undefined) p.birthYear = null;
    if(p.note === undefined) p.note = "";
  });
  if(!d.activeProfileId || !d.profiles.some(p=>p.id===d.activeProfileId))
    d.activeProfileId = d.profiles[0].id;
  d.meta = Object.assign({}, base.meta, d.meta||{});
  d.meta.appVersion = APP_VERSION;
  for(const k of ["libraryCustom","courses","measurements","dayNotes","libraryHidden","kits"]){
    if(!Array.isArray(d[k])) d[k] = [];
  }
  for(const k of ["libraryEdits","intake","wikiCache"]){
    if(!d[k] || typeof d[k] !== "object") d[k] = {};
  }
  return d;
}

let saveTimer = null;
export function save(immediate){
  if(!state.data) return;
  if(state.data.__readOnlyGuard) return;   // не топчем данные новой версии
  const write = () => {
    const copy = Object.assign({}, state.data);
    delete copy.__readOnlyGuard;
    const okWrite = LS.set(KEY, JSON.stringify(copy));
    if(!okWrite) window.dispatchEvent(new CustomEvent("hb:storage-full"));
  };
  if(immediate){ clearTimeout(saveTimer); write(); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 250);
}

export function rawExport(){
  const copy = Object.assign({}, state.data);
  delete copy.__readOnlyGuard;
  return copy;
}

export function replaceAll(newData){
  // Перед заменой всегда откладываем то, что было.
  LS.set(KEY_PREV + ".restore", LS.get(KEY) || "");
  state.data = migrateForward(newData, Number(newData.schemaVersion) || 0);
  state.data.__readOnlyGuard = false;
  delete state.data.__readOnlyGuard;
  save(true);
}

export function hasRollback(){
  return !!LS.get(KEY_PREV + ".restore");
}
export function rollbackRestore(){
  const prev = LS.get(KEY_PREV + ".restore");
  if(!prev) return false;
  try{
    const d = JSON.parse(prev);
    state.data = migrateForward(d, Number(d.schemaVersion)||0);
    save(true);
    LS.del(KEY_PREV + ".restore");
    return true;
  }catch(e){ return false; }
}
export function brokenBackupExists(){ return !!LS.get(KEY_BROKEN); }
export function brokenBackupText(){ return LS.get(KEY_BROKEN) || ""; }

/* ---------- Настройки интерфейса (отдельно от данных) ---------- */
export const prefs = {
  theme: "light",
  scale: 1,
  load(){
    try{
      const p = JSON.parse(LS.get(KEY_PREFS) || "{}");
      if(p.theme === "dark" || p.theme === "light") this.theme = p.theme;
      else if(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) this.theme = "dark";
      if(typeof p.scale === "number" && p.scale >= .8 && p.scale <= 2) this.scale = p.scale;
    }catch(e){}
    this.apply();
  },
  save(){ LS.set(KEY_PREFS, JSON.stringify({theme:this.theme, scale:this.scale})); },
  apply(){
    document.documentElement.setAttribute("data-theme", this.theme);
    document.documentElement.style.setProperty("--scale", String(this.scale));
    const m = document.querySelector('meta[name="theme-color"]');
    if(m) m.setAttribute("content", this.theme === "dark" ? "#0E1519" : "#17627E");
  }
};

/* ---------- Профили ---------- */
export function activeProfile(){
  const d = state.data;
  return d.profiles.find(p => p.id === d.activeProfileId) || d.profiles[0];
}
export function setActiveProfile(id){
  if(state.data.profiles.some(p=>p.id===id)){ state.data.activeProfileId = id; save(); }
}
export function addProfile(name){
  const p = { id:uid("pr"), name:(name||"Профиль").trim(), birthYear:null, sex:"", note:"" };
  state.data.profiles.push(p); save(); return p;
}
export function removeProfile(id){
  const d = state.data;
  if(d.profiles.length <= 1) return false;
  d.profiles = d.profiles.filter(p=>p.id!==id);
  d.courses = d.courses.filter(c=>c.profileId!==id);
  d.measurements = d.measurements.filter(m=>m.profileId!==id);
  d.dayNotes = d.dayNotes.filter(n=>n.profileId!==id);
  if(d.activeProfileId === id) d.activeProfileId = d.profiles[0].id;
  save(true); return true;
}

/* ===================================================================
   Фотографии — IndexedDB (localStorage для картинок не годится)
   =================================================================== */
const DB_NAME = "healthbook-photos";
const DB_STORE = "photos";
let dbPromise = null;

function db(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if(!("indexedDB" in window)){ reject(new Error("IndexedDB недоступен")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if(!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE, {keyPath:"id"});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function photoPut(id, dataUrl, meta){
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put({ id, dataUrl, meta: meta||{}, at: Date.now() });
    tx.oncomplete = () => res(id);
    tx.onerror = () => rej(tx.error);
  });
}
export async function photoGet(id){
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(DB_STORE, "readonly");
    const r = tx.objectStore(DB_STORE).get(id);
    r.onsuccess = () => res(r.result ? r.result.dataUrl : null);
    r.onerror = () => rej(r.error);
  });
}
export async function photoDel(id){
  const d = await db();
  return new Promise((res) => {
    const tx = d.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => res(true);
    tx.onerror = () => res(false);
  });
}
export async function photoAll(){
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(DB_STORE, "readonly");
    const r = tx.objectStore(DB_STORE).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}
export async function photoStats(){
  try{
    const all = await photoAll();
    let bytes = 0;
    all.forEach(p => { bytes += (p.dataUrl ? p.dataUrl.length * 0.75 : 0); });
    return { count: all.length, bytes };
  }catch(e){ return { count:0, bytes:0 }; }
}

/* Сжатие снимка до разумного размера перед сохранением */
export function compressImage(file, maxSide=1600, quality=0.82){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Не удалось открыть изображение"));
      img.onload = () => {
        let {width:w, height:h} = img;
        const k = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * k); h = Math.round(h * k);
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0,0,w,h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------- Просьба к браузеру не вытеснять данные ---------- */
export async function requestPersistence(){
  try{
    if(navigator.storage && navigator.storage.persist){
      const already = await navigator.storage.persisted();
      if(already) return true;
      return await navigator.storage.persist();
    }
  }catch(e){}
  return false;
}
export async function storageEstimate(){
  try{
    if(navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  }catch(e){}
  return null;
}
