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

/* ===================================================================
   Календарь — свой, а не браузерный.
   Почему не <input type="date">: он показывает дату в формате системы
   (может быть «09/14/2026»), по-разному открывается в разных браузерах
   и мелкий. Здесь крупная сетка, выбор месяца и года отдельными
   кнопками и кнопка «Сегодня».
   =================================================================== */
const MONTHS_SHORT = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];

export function pickDate(opts={}){
  return new Promise(resolve => {
    const today = todayISO();
    let cur = parseISO(opts.value) || parseISO(today);
    let selected = opts.value || null;
    let view = new Date(cur.getFullYear(), cur.getMonth(), 1);
    let mode = "days";           // days | months | years

    const min = opts.min ? parseISO(opts.min) : null;
    const max = opts.max ? parseISO(opts.max) : null;

    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal cal" role="dialog" aria-modal="true"></div>`;
    const box = back.querySelector(".modal");

    const close = v => { back.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = e => { if(e.key === "Escape") close(null); };

    function disabled(d){
      if(min && d < min) return true;
      if(max && d > max) return true;
      return false;
    }

    function draw(){
      const y = view.getFullYear(), m = view.getMonth();
      let body = "";

      if(mode === "days"){
        const first = new Date(y, m, 1);
        const shift = (first.getDay() + 6) % 7;          // неделя с понедельника
        const daysIn = new Date(y, m+1, 0).getDate();
        let cells = "";
        for(let i=0;i<shift;i++) cells += `<span class="cal-cell empty"></span>`;
        for(let dd=1; dd<=daysIn; dd++){
          const dt = new Date(y, m, dd);
          const iso = isoOf(dt);
          const cls = [
            "cal-cell",
            iso === selected ? "sel" : "",
            iso === today ? "today" : "",
            (dt.getDay() === 0 || dt.getDay() === 6) ? "we" : "",
            disabled(dt) ? "off" : ""
          ].filter(Boolean).join(" ");
          cells += `<button type="button" class="${cls}" ${disabled(dt)?"disabled":""} data-day="${iso}">${dd}</button>`;
        }
        body = `<div class="cal-wd">${["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map(w=>`<span>${w}</span>`).join("")}</div>
                <div class="cal-grid">${cells}</div>`;
      }

      if(mode === "months"){
        body = `<div class="cal-grid months">${MONTHS_SHORT.map((n,i) =>
          `<button type="button" class="cal-cell wide ${i===m?"sel":""}" data-month="${i}">${n}</button>`).join("")}</div>`;
      }

      if(mode === "years"){
        const start = y - 7;
        let cells = "";
        for(let i=0;i<16;i++){
          const yy = start + i;
          cells += `<button type="button" class="cal-cell wide ${yy===y?"sel":""}" data-year="${yy}">${yy}</button>`;
        }
        body = `<div class="cal-grid years">${cells}</div>`;
      }

      box.innerHTML = `
        <div class="cal-head">
          <button type="button" class="cal-nav" data-prev aria-label="Назад">‹</button>
          <button type="button" class="cal-title" data-mode="months">${MONTHS_SHORT[m]}</button>
          <button type="button" class="cal-title" data-mode="years">${y}</button>
          <button type="button" class="cal-nav" data-next aria-label="Вперёд">›</button>
        </div>
        ${body}
        <div class="btn-row mt">
          <button type="button" class="btn" data-cancel>Отмена</button>
          <button type="button" class="btn primary" data-today>Сегодня</button>
        </div>`;
    }

    box.addEventListener("click", e => {
      const t = e.target;
      if(t.closest("[data-cancel]")) return close(null);
      if(t.closest("[data-today]")){
        const d = parseISO(today);
        if(!disabled(d)) return close(today);
        return;
      }
      const day = t.closest("[data-day]");
      if(day) return close(day.dataset.day);

      const md = t.closest("[data-mode]");
      if(md){ mode = (mode === md.dataset.mode) ? "days" : md.dataset.mode; return draw(); }

      const mo = t.closest("[data-month]");
      if(mo){ view = new Date(view.getFullYear(), Number(mo.dataset.month), 1); mode = "days"; return draw(); }

      const yr = t.closest("[data-year]");
      if(yr){ view = new Date(Number(yr.dataset.year), view.getMonth(), 1); mode = "months"; return draw(); }

      if(t.closest("[data-prev]") || t.closest("[data-next]")){
        const k = t.closest("[data-prev]") ? -1 : 1;
        if(mode === "days")   view = new Date(view.getFullYear(), view.getMonth() + k, 1);
        if(mode === "months") view = new Date(view.getFullYear() + k, view.getMonth(), 1);
        if(mode === "years")  view = new Date(view.getFullYear() + k*16, view.getMonth(), 1);
        return draw();
      }
    });
    back.addEventListener("click", e => { if(e.target === back) close(null); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    draw();
  });
}

/* Поле-кнопка с датой вместо <input type="date"> */
export function dateFieldHTML(id, iso, {label, sub, required, empty="не указано"} = {}){
  return `<div class="field">
    ${label ? `<span class="field-label">${esc(label)}${required ? ` <span class="req">*</span>` : ""}</span>` : ""}
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ""}
    <button type="button" class="datefield" id="${id}" data-iso="${esc(iso || "")}">
      <span class="ic" aria-hidden="true">📅</span>
      <span class="tx">${iso ? esc(fmtDate(iso)) : esc(empty)}</span>
    </button>
  </div>`;
}

/* Навешивает календарь на поле-кнопку, созданное dateFieldHTML */
export function bindDateField(root, id, opts={}){
  const el = typeof id === "string" ? $("#" + id, root) : id;
  if(!el) return null;
  el.addEventListener("click", async () => {
    const v = await pickDate({ value: el.dataset.iso || todayISO(), min: opts.min, max: opts.max });
    if(v === null) return;
    el.dataset.iso = v;
    el.querySelector(".tx").textContent = fmtDate(v);
    if(opts.onChange) opts.onChange(v);
  });
  return {
    get: () => el.dataset.iso || "",
    set: v => {
      el.dataset.iso = v || "";
      el.querySelector(".tx").textContent = v ? fmtDate(v) : (opts.empty || "не указано");
    },
    clear: () => {
      el.dataset.iso = "";
      el.querySelector(".tx").textContent = opts.empty || "не указано";
    }
  };
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
