/* ===================================================================
   ui.js — общие помощники интерфейса, маршрутизация и мелкие виджеты
   =================================================================== */

import { state, prefs, save } from "./store.js";

/* ---------- Мелочи ---------- */
export const $  = (sel, root=document) => root.querySelector(sel);
export const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

export function esc(s){
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

let toastTimer = null;
export function toast(msg, ms=2600){
  const t = $("#toast");
  if(!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- Даты ---------- */
const MONTHS = ["января","февраля","марта","апреля","мая","июня",
                "июля","августа","сентября","октября","ноября","декабря"];
const MONTHS_N = ["Январь","Февраль","Март","Апрель","Май","Июнь",
                  "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const WDAYS = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];

export function todayISO(){
  const d = new Date();
  return isoOf(d);
}
export function isoOf(d){
  const p = n => String(n).padStart(2,"0");
  return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate());
}
export function nowHM(){
  const d = new Date();
  const p = n => String(n).padStart(2,"0");
  return p(d.getHours()) + ":" + p(d.getMinutes());
}
export function parseISO(iso){
  if(!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if(!m) return null;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
}
export function fmtDate(iso, opts={}){
  const d = parseISO(iso);
  if(!d) return "—";
  const y = opts.noYear ? "" : " " + d.getFullYear();
  return d.getDate() + " " + MONTHS[d.getMonth()] + y;
}
export function fmtDateShort(iso){
  const d = parseISO(iso);
  if(!d) return "—";
  const p = n => String(n).padStart(2,"0");
  return p(d.getDate()) + "." + p(d.getMonth()+1) + "." + d.getFullYear();
}
export function fmtDayHeader(iso){
  const d = parseISO(iso);
  if(!d) return iso;
  const t = todayISO();
  if(iso === t) return "Сегодня, " + d.getDate() + " " + MONTHS[d.getMonth()];
  const y = new Date(); y.setDate(y.getDate()-1);
  if(iso === isoOf(y)) return "Вчера, " + d.getDate() + " " + MONTHS[d.getMonth()];
  return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() +
         ", " + WDAYS[d.getDay()];
}
export function monthName(i){ return MONTHS_N[i]; }
export function daysBetween(isoA, isoB){
  const a = parseISO(isoA), b = parseISO(isoB);
  if(!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}
export function shiftISO(iso, days){
  const d = parseISO(iso) || new Date();
  d.setDate(d.getDate() + days);
  return isoOf(d);
}
export function plural(n, one, few, many){
  const a = Math.abs(n) % 100, b = a % 10;
  if(a > 10 && a < 20) return many;
  if(b > 1 && b < 5) return few;
  if(b === 1) return one;
  return many;
}

/* ---------- Маршрутизация ----------
   Всё — включая формы и карточки — это адреса вида #/раздел/действие.
   Благодаря этому системная кнопка «Назад» возвращает на предыдущий шаг,
   а не закрывает приложение.                                            */

const routes = [];
export function route(pattern, handler){ routes.push({pattern, handler}); }

export function currentPath(){
  const h = location.hash || "#/home";
  return h.replace(/^#/, "").split("?")[0];
}

/* Параметры после «?» в адресе: #/home/course/new?lib=d_enalapril */
export function queryParams(){
  const h = location.hash || "";
  const i = h.indexOf("?");
  if(i < 0) return {};
  const out = {};
  new URLSearchParams(h.slice(i+1)).forEach((v,k) => { out[k] = v; });
  return out;
}

export function go(path, replace){
  const hash = "#" + path;
  if(location.hash === hash){ render(); return; }
  if(replace) location.replace(hash);
  else location.hash = hash;
}

export function back(fallback="/home"){
  if(history.length > 1){ history.back(); }
  else go(fallback, true);
}

function matchRoute(path){
  const parts = path.split("/").filter(Boolean);
  for(const r of routes){
    const rp = r.pattern.split("/").filter(Boolean);
    if(rp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for(let i=0;i<rp.length;i++){
      if(rp[i].startsWith(":")) params[rp[i].slice(1)] = decodeURIComponent(parts[i]);
      else if(rp[i] !== parts[i]){ ok = false; break; }
    }
    if(ok) return { handler:r.handler, params };
  }
  return null;
}

let scrollMemory = {};
let lastPath = null;

export function render(){
  const path = currentPath();
  const screen = $("#screen");
  if(lastPath !== null) scrollMemory[lastPath] = window.scrollY;

  const m = matchRoute(path);
  screen.innerHTML = "";
  removeFab();

  if(!m){ go("/home", true); return; }

  try{
    m.handler(screen, m.params);
  }catch(err){
    console.error(err);
    screen.innerHTML = `<div class="panel"><h2>Что-то пошло не так</h2>
      <p class="hint">${esc(err && err.message || "Неизвестная ошибка")}</p>
      <div class="mt"><button class="btn primary" onclick="location.hash='#/home'">На главную</button></div></div>`;
  }

  updateTabs(path);
  lastPath = path;
  const y = scrollMemory[path];
  window.scrollTo(0, (typeof y === "number" && y) || 0);
  // Экран сменился — сообщаем об этом программам чтения с экрана
  const t = screen.querySelector("h1");
  if(t){ screen.setAttribute("aria-label", t.textContent); }
}

function updateTabs(path){
  const root = "/" + (path.split("/").filter(Boolean)[0] || "home");
  $$("#tabbar .tab").forEach(b => {
    const r = b.dataset.route.replace("#","");
    if(r === root) b.setAttribute("aria-current","page");
    else b.removeAttribute("aria-current");
  });
}

/* ---------- Плавающая кнопка ---------- */
export function addFab(label, onClick){
  removeFab();
  const b = document.createElement("button");
  b.className = "fab"; b.id = "fab"; b.type = "button";
  b.innerHTML = `<span aria-hidden="true">＋</span><span>${esc(label)}</span>`;
  b.addEventListener("click", onClick);
  document.body.appendChild(b);
}
export function removeFab(){
  const f = document.getElementById("fab");
  if(f) f.remove();
}

/* ---------- Заголовок экрана с кнопкой назад ---------- */
export function formHead(title){
  return `<div class="formhead">
    <button class="back" type="button" data-back aria-label="Назад">←</button>
    <h1>${esc(title)}</h1>
  </div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-back]");
  if(b){ e.preventDefault(); back(); }
});

/* ---------- Подтверждение ---------- */
export function confirmDialog({title, text, okText="Да", cancelText="Отмена", danger=false}){
  return new Promise(resolve => {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2>
      ${text ? `<p class="hint mb">${esc(text)}</p>` : ""}
      <div class="btn-row mt">
        <button class="btn" data-no>${esc(cancelText)}</button>
        <button class="btn ${danger ? "danger solid" : "primary"}" data-yes>${esc(okText)}</button>
      </div>
    </div>`;
    const close = v => { back.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = e => { if(e.key === "Escape") close(false); };
    back.addEventListener("click", e => {
      if(e.target === back) close(false);
      if(e.target.closest("[data-no]")) close(false);
      if(e.target.closest("[data-yes]")) close(true);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    back.querySelector("[data-yes]").focus();
  });
}

/* ---------- Ввод текста в модальном окне ---------- */
export function promptDialog({title, label, value="", placeholder="", okText="Сохранить"}){
  return new Promise(resolve => {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2>
      <div class="field"><label for="pdInput">${esc(label||"")}</label>
        <input type="text" id="pdInput" value="${esc(value)}" placeholder="${esc(placeholder)}"></div>
      <div class="btn-row">
        <button class="btn" data-no>Отмена</button>
        <button class="btn primary" data-yes>${esc(okText)}</button>
      </div>
    </div>`;
    const inp = back.querySelector("#pdInput");
    const close = v => { back.remove(); resolve(v); };
    back.addEventListener("click", e => {
      if(e.target === back || e.target.closest("[data-no]")) close(null);
      if(e.target.closest("[data-yes]")) close(inp.value.trim());
    });
    back.addEventListener("keydown", e => {
      if(e.key === "Enter"){ e.preventDefault(); close(inp.value.trim()); }
      if(e.key === "Escape") close(null);
    });
    document.body.appendChild(back);
    inp.focus(); inp.select();
  });
}

/* ---------- Степпер: крупный ввод чисел без клавиатуры ---------- */
export function stepper(opts){
  /* opts: {value, min, max, step, unit, decimals, presets:[], onChange} */
  const st = {
    value: opts.value,
    min: opts.min, max: opts.max, step: opts.step,
    decimals: opts.decimals ?? 0,
    el: null
  };
  const fmt = v => st.decimals ? v.toFixed(st.decimals) : String(Math.round(v));

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="stepper">
      <button type="button" data-d="-1" aria-label="Уменьшить">−</button>
      <div class="val"><span class="v">${fmt(st.value)}</span><span class="u">${esc(opts.unit||"")}</span></div>
      <button type="button" data-d="1" aria-label="Увеличить">+</button>
    </div>
    ${opts.presets && opts.presets.length ? `<div class="presets">${
      opts.presets.map(p => `<button type="button" class="p" data-p="${p.v}">${esc(p.t)}</button>`).join("")
    }</div>` : ""}`;

  const vEl = wrap.querySelector(".v");
  const set = v => {
    v = Math.min(st.max, Math.max(st.min, v));
    v = Math.round(v / st.step) * st.step;
    st.value = Number(v.toFixed(st.decimals));
    vEl.textContent = fmt(st.value);
    if(opts.onChange) opts.onChange(st.value);
  };

  let holdTimer = null, holdInt = null;
  const startHold = d => {
    holdTimer = setTimeout(() => {
      holdInt = setInterval(() => set(st.value + d * st.step), 80);
    }, 480);
  };
  const stopHold = () => { clearTimeout(holdTimer); clearInterval(holdInt); };

  wrap.querySelectorAll("[data-d]").forEach(b => {
    const d = Number(b.dataset.d);
    b.addEventListener("click", () => set(st.value + d * st.step));
    b.addEventListener("pointerdown", () => startHold(d));
    ["pointerup","pointerleave","pointercancel"].forEach(ev => b.addEventListener(ev, stopHold));
  });
  wrap.querySelectorAll("[data-p]").forEach(b => {
    b.addEventListener("click", () => set(Number(b.dataset.p)));
  });

  st.el = wrap;
  st.get = () => st.value;
  st.set = set;
  return st;
}

/* ---------- Выбор фотографии (камера или галерея) ---------- */
export function pickImage(){
  return new Promise(resolve => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";           // Android сам предложит «Камера / Галерея / Файлы»
    inp.style.display = "none";
    inp.addEventListener("change", () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      resolve(f || null);
    });
    document.body.appendChild(inp);
    inp.click();
  });
}

/* ---------- Просмотр фотографии ---------- */
export function viewPhoto(dataUrl, onDelete){
  const v = document.createElement("div");
  v.className = "photo-viewer";
  v.innerHTML = `<img src="${dataUrl}" alt="Фотография">
    <div class="btn-row" style="max-width:22rem;width:100%">
      ${onDelete ? `<button class="btn danger solid" data-del>Удалить</button>` : ""}
      <button class="btn" data-close>Закрыть</button>
    </div>`;
  v.addEventListener("click", async e => {
    if(e.target.closest("[data-close]") || e.target === v) v.remove();
    if(e.target.closest("[data-del]")){
      v.remove();
      if(onDelete) onDelete();
    }
  });
  document.body.appendChild(v);
}

/* ---------- Переключатель профилей ---------- */
export function profileSwitch(){
  const d = state.data;
  if(d.profiles.length < 2) return "";
  return `<div class="profile-switch" id="profileSwitch">${
    d.profiles.map(p => `<button type="button" data-pid="${esc(p.id)}"
      aria-pressed="${p.id === d.activeProfileId}">${esc(p.name)}</button>`).join("")
  }</div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("#profileSwitch [data-pid]");
  if(!b) return;
  state.data.activeProfileId = b.dataset.pid;
  save();
  render();
});

/* ---------- Индикатор сети ---------- */
export function updateNet(){
  state.online = navigator.onLine;
  const el = $("#netDot");
  if(!el) return;
  el.classList.toggle("on", state.online);
  el.classList.toggle("off", !state.online);
  el.querySelector(".netTxt").textContent = state.online ? "в сети" : "офлайн";
}

/* ---------- Масштаб и тема ---------- */
export function bindHeader(){
  $("#scaleUp").addEventListener("click", () => {
    prefs.scale = Math.min(2, Math.round((prefs.scale + .1) * 10) / 10);
    prefs.apply(); prefs.save(); toast("Размер текста: " + Math.round(prefs.scale*100) + "%");
  });
  $("#scaleDown").addEventListener("click", () => {
    prefs.scale = Math.max(.9, Math.round((prefs.scale - .1) * 10) / 10);
    prefs.apply(); prefs.save(); toast("Размер текста: " + Math.round(prefs.scale*100) + "%");
  });
  $("#themeBtn").addEventListener("click", () => {
    prefs.theme = prefs.theme === "dark" ? "light" : "dark";
    prefs.apply(); prefs.save();
    $("#themeBtn").textContent = prefs.theme === "dark" ? "☀️" : "🌙";
  });
  $("#themeBtn").textContent = prefs.theme === "dark" ? "☀️" : "🌙";
  $("#brandBtn").addEventListener("click", () => go("/home"));
  $$("#tabbar .tab").forEach(b => {
    b.addEventListener("click", () => go(b.dataset.route.replace("#","")));
  });
  window.addEventListener("online", updateNet);
  window.addEventListener("offline", updateNet);
  updateNet();
}
