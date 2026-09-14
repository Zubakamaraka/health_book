/* ===================================================================
   library.js — библиотека лекарств и процедур

   Что здесь важно понимать про данные:
   • Встроенный словарь (data/library.json) содержит только ФАКТЫ:
     название, действующее вещество, группу, формы выпуска, дозировки.
     Это не инструкция по применению и не рекомендация.
   • Поле «От чего назначено» заполняет сам пользователь.
   • Справка из Википедии подгружается ТОЛЬКО по нажатию кнопки и только
     при наличии интернета. Она сохраняется на устройстве и дальше
     доступна офлайн. Источник всегда подписан.
   • Поиск в аптеках открывает обычный поиск в браузере. Приложение
     никаких сайтов не разбирает: браузер запрещает странице читать
     содержимое чужих сайтов, а сами аптечные сайты закрыты защитой.
   =================================================================== */

import { state, save, uid } from "./store.js";
import { $, esc, go, back, toast, formHead, addFab, confirmDialog, render } from "./ui.js";

/* ---------- Загрузка встроенного словаря ---------- */
let CATEGORIES = [];

export async function loadBuiltinLibrary(){
  try{
    const r = await fetch("data/library.json", {cache:"no-cache"});
    if(!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    state.builtinLibrary = d.items || [];
    CATEGORIES = d.categories || [];
  }catch(e){
    console.warn("Словарь не загрузился:", e);
    state.builtinLibrary = [];
    CATEGORIES = [];
  }
}
export function categories(){ return CATEGORIES; }
export function categoryOf(id){ return CATEGORIES.find(c => c.id === id) || null; }

/* ---------- Сборка полного списка ---------- */
export function allItems(){
  const d = state.data;
  const hidden = new Set(d.libraryHidden || []);
  const builtin = state.builtinLibrary
    .filter(it => !hidden.has(it.id))
    .map(it => Object.assign({}, it, d.libraryEdits[it.id] || {}, {builtin:true}));
  const custom = (d.libraryCustom || []).map(it => Object.assign({}, it, {builtin:false}));
  return builtin.concat(custom);
}

export function getItem(id){
  if(!id) return null;
  return allItems().find(it => it.id === id) || null;
}

/* ---------- Поиск ---------- */
function norm(s){
  return String(s||"").toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/gi," ").trim();
}
export function searchItems(query, opts={}){
  let list = allItems();
  if(opts.kind) list = list.filter(i => i.kind === opts.kind);
  if(opts.cat)  list = list.filter(i => i.cat === opts.cat);

  const q = norm(query);
  if(!q) return list.sort(byName);

  const words = q.split(" ").filter(Boolean);
  const scored = [];
  for(const it of list){
    const name = norm(it.name);
    const inn  = norm(it.inn);
    const brands = norm((it.brands||[]).join(" "));
    const grp  = norm(it.group);
    const hay = [name, inn, brands, grp].join(" ");
    if(!words.every(w => hay.includes(w))) continue;

    let score = 40;
    if(name.startsWith(q)) score = 0;
    else if(name.includes(q)) score = 10;
    else if(brands.includes(q)) score = 15;
    else if(inn.includes(q)) score = 20;
    scored.push({it, score});
  }
  scored.sort((a,b) => a.score - b.score || byName(a.it, b.it));
  return scored.map(s => s.it);
}
function byName(a,b){ return String(a.name).localeCompare(String(b.name), "ru"); }

/* ---------- Как называется позиция коротко ---------- */
export function itemSubtitle(it){
  const parts = [];
  if(it.inn && norm(it.inn) !== norm(it.name)) parts.push(it.inn);
  if(it.group) parts.push(it.group);
  return parts.join(" · ");
}

/* ===================================================================
   Экран: список библиотеки
   =================================================================== */
let libQuery = "";
let libCat = "";
let libKind = "";

export function screenLibrary(root){
  root.innerHTML = `
    <h1 class="screen-title">Библиотека</h1>
    <p class="screen-sub">Лекарства и процедуры. Можно добавить своё.</p>

    <div class="searchbar">
      <span class="si" aria-hidden="true">🔎</span>
      <input type="search" id="libSearch" placeholder="Название или действующее вещество"
             value="${esc(libQuery)}" autocomplete="off" enterkeyhint="search">
    </div>

    <div class="pill-nav" id="kindNav">
      <button class="chip ${libKind===""?"on":""}" data-kind="">Всё</button>
      <button class="chip ${libKind==="drug"?"on":""}" data-kind="drug">💊 Лекарства</button>
      <button class="chip ${libKind==="procedure"?"on":""}" data-kind="procedure">🩺 Процедуры</button>
    </div>

    <div class="pill-nav" id="catNav">
      <button class="chip ${libCat===""?"on":""}" data-cat="">Все разделы</button>
      ${CATEGORIES.map(c => `<button class="chip ${libCat===c.id?"on":""}" data-cat="${esc(c.id)}">${c.icon} ${esc(c.name)}</button>`).join("")}
    </div>

    <div id="libResults"></div>
    <p class="disclaimer-mini">Сведения носят справочный характер.
       Назначение, дозу и схему приёма определяет врач.</p>
  `;

  const input = $("#libSearch", root);
  let t = null;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { libQuery = input.value; drawResults(); }, 180);
  });

  root.querySelector("#kindNav").addEventListener("click", e => {
    const b = e.target.closest("[data-kind]"); if(!b) return;
    libKind = b.dataset.kind;
    root.querySelectorAll("#kindNav .chip").forEach(c => c.classList.toggle("on", c.dataset.kind === libKind));
    drawResults();
  });
  root.querySelector("#catNav").addEventListener("click", e => {
    const b = e.target.closest("[data-cat]"); if(!b) return;
    libCat = b.dataset.cat;
    root.querySelectorAll("#catNav .chip").forEach(c => c.classList.toggle("on", c.dataset.cat === libCat));
    drawResults();
  });

  function drawResults(){
    const box = $("#libResults", root);
    const found = searchItems(libQuery, {kind:libKind || null, cat:libCat || null});
    if(!found.length){
      box.innerHTML = `<div class="empty"><span class="big">🔍</span>
        <p><b>Ничего не нашлось</b></p>
        <p class="hint">Попробуйте другое слово или добавьте свою позицию кнопкой «Добавить».</p></div>`;
      return;
    }
    const cap = 120;
    box.innerHTML = `<div class="list">${
      found.slice(0, cap).map(it => itemRow(it)).join("")
    }</div>${found.length > cap ? `<p class="hint center mt">Показано ${cap} из ${found.length}. Уточните поиск.</p>` : ""}`;
    box.querySelectorAll("[data-id]").forEach(b => {
      b.addEventListener("click", () => go("/library/item/" + encodeURIComponent(b.dataset.id)));
    });
  }

  function itemRow(it){
    const cat = categoryOf(it.cat);
    return `<button class="item" type="button" data-id="${esc(it.id)}">
      <div class="top"><span class="nm">${it.kind === "procedure" ? "🩺 " : ""}${esc(it.name)}</span></div>
      ${itemSubtitle(it) ? `<div class="sub">${esc(itemSubtitle(it))}</div>` : ""}
      <div class="meta">
        ${cat ? `<span class="tag">${cat.icon} ${esc(cat.name)}</span>` : ""}
        ${it.rx ? `<span class="tag warn">по рецепту</span>` : ""}
        ${!it.builtin ? `<span class="tag acc">своё</span>` : ""}
      </div>
    </button>`;
  }

  drawResults();
  addFab("Добавить", () => go("/library/new"));
}

/* ===================================================================
   Экран: карточка позиции
   =================================================================== */
export function screenLibraryItem(root, params){
  const it = getItem(params.id);
  if(!it){
    root.innerHTML = formHead("Не найдено") +
      `<div class="empty"><p>Эта позиция удалена или не существует.</p></div>`;
    return;
  }
  const cat = categoryOf(it.cat);
  const wikiKey = wikiKeyFor(it);
  const cached = state.data.wikiCache[wikiKey];

  root.innerHTML = formHead(it.name) + `
    <div class="panel">
      <div class="meta mb">
        ${cat ? `<span class="tag">${cat.icon} ${esc(cat.name)}</span>` : ""}
        <span class="tag">${it.kind === "procedure" ? "🩺 процедура" : "💊 лекарство"}</span>
        ${it.rx ? `<span class="tag warn">по рецепту</span>` : ""}
        ${!it.builtin ? `<span class="tag acc">своя запись</span>` : ""}
      </div>
      ${it.inn ? kv("Действующее вещество", it.inn) : ""}
      ${it.group ? kv("Группа", it.group) : ""}
      ${it.brands && it.brands.length ? kv("Встречается под названиями", it.brands.join(", ")) : ""}
      ${it.forms && it.forms.length ? kv("Форма выпуска", it.forms.join(", ")) : ""}
      ${it.doses && it.doses.length ? kv("Дозировки", it.doses.join(", ")) : ""}
      ${it.purpose ? kv("От чего помогает", it.purpose) : ""}
      ${it.age ? kv("Возраст и особенности", it.age) : ""}
      ${it.contra ? kv("Противопоказания", it.contra) : ""}
      ${it.notes ? kv("Примечания", it.notes) : ""}
      ${!it.purpose ? `<p class="hint mt">Поле «От чего помогает» пока пустое.
        Заполните его своими словами — так, как объяснил врач.</p>` : ""}
    </div>

    <div id="wikiBox">${cached ? wikiHtml(cached) : ""}</div>

    <div class="btn-col mt">
      <button class="btn primary big wide" id="toCourse">＋ Добавить в мои назначения</button>
      <button class="btn wide" id="wikiBtn">${cached ? "🔄 Обновить справку из интернета" : "🌐 Загрузить справку из интернета"}</button>
      <button class="btn wide" id="pharmBtn">🏥 Найти в аптеках</button>
      <button class="btn wide" id="editBtn">✏️ Изменить</button>
      ${it.builtin
        ? `<button class="btn quiet wide" id="hideBtn">Скрыть из библиотеки</button>`
        : `<button class="btn danger wide" id="delBtn">Удалить из библиотеки</button>`}
    </div>

    <p class="disclaimer-mini">Полный перечень показаний и противопоказаний —
      в инструкции к упаковке. Приложение не заменяет консультацию врача.</p>
  `;

  $("#toCourse", root).addEventListener("click", () => {
    go("/home/course/new?lib=" + encodeURIComponent(it.id));
  });
  $("#editBtn", root).addEventListener("click", () => go("/library/edit/" + encodeURIComponent(it.id)));
  $("#pharmBtn", root).addEventListener("click", () => pharmacySheet(it));
  $("#wikiBtn", root).addEventListener("click", () => fetchWiki(it, root));

  const hideBtn = $("#hideBtn", root);
  if(hideBtn) hideBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title:"Скрыть позицию?",
      text:"Она исчезнет из списка библиотеки. Уже созданные назначения останутся на месте. Вернуть можно в настройках.",
      okText:"Скрыть"
    });
    if(!ok) return;
    state.data.libraryHidden.push(it.id); save(true);
    toast("Скрыто"); back("/library");
  });

  const delBtn = $("#delBtn", root);
  if(delBtn) delBtn.addEventListener("click", async () => {
    const used = state.data.courses.some(c => c.libId === it.id);
    const ok = await confirmDialog({
      title:"Удалить позицию?",
      text: used ? "Эта позиция используется в назначениях. Сами назначения останутся, но потеряют связь с библиотекой."
                 : "Действие нельзя отменить.",
      okText:"Удалить", danger:true
    });
    if(!ok) return;
    state.data.libraryCustom = state.data.libraryCustom.filter(x => x.id !== it.id);
    save(true); toast("Удалено"); back("/library");
  });
}

function kv(k, v){
  return `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
}

/* ===================================================================
   Форма добавления и изменения
   =================================================================== */
export function screenLibraryForm(root, params){
  const editing = !!params.id;
  const src = editing ? getItem(params.id) : null;
  if(editing && !src){ go("/library", true); return; }

  const v = {
    kind: src ? src.kind : "drug",
    name: src ? src.name || "" : "",
    inn:  src ? src.inn  || "" : "",
    group:src ? src.group || "" : "",
    cat:  src ? src.cat  || "" : "",
    forms:src ? (src.forms||[]).join(", ") : "",
    doses:src ? (src.doses||[]).join(", ") : "",
    purpose: src ? src.purpose || "" : "",
    age:  src ? src.age  || "" : "",
    contra: src ? src.contra || "" : "",
    notes: src ? src.notes || "" : "",
    rx:   src ? !!src.rx : false
  };

  root.innerHTML = formHead(editing ? "Изменить позицию" : "Новая позиция") + `
    <form id="libForm" novalidate>
      <div class="field">
        <span class="field-label">Что добавляем</span>
        <div class="chips" id="kindPick">
          <button type="button" class="chip ${v.kind==="drug"?"on":""}" data-k="drug">💊 Лекарство</button>
          <button type="button" class="chip ${v.kind==="procedure"?"on":""}" data-k="procedure">🩺 Процедура</button>
        </div>
      </div>

      <div class="field">
        <label for="fName">Название <span class="req">*</span></label>
        <input type="text" id="fName" value="${esc(v.name)}" required placeholder="Например: Эналаприл">
      </div>

      <div class="field only-drug">
        <label for="fInn">Действующее вещество</label>
        <div class="sub">Помогает находить аналоги. Написано на упаковке мелким шрифтом.</div>
        <input type="text" id="fInn" value="${esc(v.inn)}">
      </div>

      <div class="field">
        <label for="fCat">Раздел</label>
        <select id="fCat">
          <option value="">— не указан —</option>
          ${CATEGORIES.map(c => `<option value="${esc(c.id)}" ${v.cat===c.id?"selected":""}>${c.icon} ${esc(c.name)}</option>`).join("")}
        </select>
      </div>

      <div class="field only-drug">
        <label for="fForms">В каком виде выпускается</label>
        <div class="sub">Через запятую: таблетки, капсулы, раствор для инъекций, мазь…</div>
        <input type="text" id="fForms" value="${esc(v.forms)}">
      </div>

      <div class="field only-drug">
        <label for="fDoses">Дозировки (граммовки)</label>
        <div class="sub">Через запятую: 5 мг, 10 мг, 20 мг</div>
        <input type="text" id="fDoses" value="${esc(v.doses)}">
      </div>

      <div class="field">
        <label for="fPurpose">От чего помогает / для чего применяется</label>
        <div class="sub">Своими словами — так, как объяснил врач.</div>
        <textarea id="fPurpose">${esc(v.purpose)}</textarea>
      </div>

      <div class="field">
        <label for="fAge">Возраст и особенности применения</label>
        <div class="sub">Например: взрослым, с осторожностью после 65 лет, принимать после еды.</div>
        <textarea id="fAge">${esc(v.age)}</textarea>
      </div>

      <div class="field">
        <label for="fContra">Противопоказания</label>
        <div class="sub">Полный список всегда есть в инструкции к упаковке.</div>
        <textarea id="fContra">${esc(v.contra)}</textarea>
      </div>

      <div class="field only-drug">
        <span class="field-label">Отпуск</span>
        <div class="chips">
          <button type="button" class="chip ${v.rx?"on":""}" id="fRx" aria-pressed="${v.rx}">По рецепту</button>
        </div>
      </div>

      <div class="field">
        <label for="fNotes">Примечания</label>
        <textarea id="fNotes" placeholder="Что угодно на память">${esc(v.notes)}</textarea>
      </div>

      <div class="sticky-actions">
        <div class="btn-row">
          <button type="button" class="btn" data-back>Отмена</button>
          <button type="submit" class="btn primary big">Сохранить</button>
        </div>
      </div>
    </form>
  `;

  const form = $("#libForm", root);
  const applyKind = () => {
    root.querySelectorAll(".only-drug").forEach(el => { el.hidden = (v.kind !== "drug"); });
  };
  root.querySelector("#kindPick").addEventListener("click", e => {
    const b = e.target.closest("[data-k]"); if(!b) return;
    v.kind = b.dataset.k;
    root.querySelectorAll("#kindPick .chip").forEach(c => c.classList.toggle("on", c.dataset.k === v.kind));
    applyKind();
  });
  applyKind();

  const rxBtn = $("#fRx", root);
  rxBtn.addEventListener("click", () => {
    v.rx = !v.rx;
    rxBtn.classList.toggle("on", v.rx);
    rxBtn.setAttribute("aria-pressed", String(v.rx));
  });

  form.addEventListener("submit", e => {
    e.preventDefault();
    const name = $("#fName", root).value.trim();
    if(!name){ toast("Впишите название"); $("#fName", root).focus(); return; }

    const splitList = s => s.split(",").map(x => x.trim()).filter(Boolean);
    const payload = {
      kind: v.kind,
      name,
      inn: v.kind === "drug" ? $("#fInn", root).value.trim() : "",
      group: src && src.group ? src.group : "",
      cat: $("#fCat", root).value,
      forms: v.kind === "drug" ? splitList($("#fForms", root).value) : [],
      doses: v.kind === "drug" ? splitList($("#fDoses", root).value) : [],
      purpose: $("#fPurpose", root).value.trim(),
      age: $("#fAge", root).value.trim(),
      contra: $("#fContra", root).value.trim(),
      notes: $("#fNotes", root).value.trim(),
      rx: v.kind === "drug" ? v.rx : false
    };

    if(editing && src.builtin){
      // Встроенную позицию не переписываем — храним только правки поверх неё.
      state.data.libraryEdits[src.id] = payload;
      save(true); toast("Сохранено");
      go("/library/item/" + encodeURIComponent(src.id), true);
    }else if(editing){
      const i = state.data.libraryCustom.findIndex(x => x.id === src.id);
      state.data.libraryCustom[i] = Object.assign({}, state.data.libraryCustom[i], payload);
      save(true); toast("Сохранено");
      go("/library/item/" + encodeURIComponent(src.id), true);
    }else{
      const item = Object.assign({id: uid("li"), createdAt: new Date().toISOString()}, payload);
      state.data.libraryCustom.push(item);
      save(true); toast("Добавлено в библиотеку");
      go("/library/item/" + encodeURIComponent(item.id), true);
    }
  });
}

/* ===================================================================
   Справка из Википедии
   Подгружается только по кнопке и только при интернете.
   Сохраняется на устройстве и дальше работает офлайн.
   =================================================================== */
function wikiKeyFor(it){
  return (it.inn || it.name).trim().toLowerCase();
}

function wikiHtml(c){
  return `<div class="wiki">
    <div class="wh">СПРАВКА ИЗ ВИКИПЕДИИ — не назначение врача</div>
    <div><b>${esc(c.title)}</b></div>
    <p class="mt">${esc(c.extract)}</p>
    <div class="wsrc">Источник: Википедия${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">открыть статью</a>` : ""}
      · загружено ${c.fetchedAt ? new Date(c.fetchedAt).toLocaleDateString("ru-RU") : "—"}
      · лицензия CC BY-SA</div>
  </div>`;
}

async function fetchWiki(it, root){
  const box = $("#wikiBox", root);
  if(!navigator.onLine){
    toast("Нет интернета. Справку можно загрузить, когда появится сеть.");
    return;
  }
  box.innerHTML = `<div class="wiki"><div class="wh">ЗАГРУЗКА…</div><p>Ищем статью в Википедии…</p></div>`;

  const query = (it.inn || it.name).replace(/\(.*?\)/g, "").trim();
  try{
    const title = await wikiFindTitle(query);
    if(!title) throw new Error("Статья не найдена");
    const sum = await wikiSummary(title);
    const rec = {
      title: sum.title || title,
      extract: sum.extract || "",
      url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) ||
           ("https://ru.wikipedia.org/wiki/" + encodeURIComponent(title)),
      fetchedAt: Date.now()
    };
    if(!rec.extract) throw new Error("В статье нет краткого описания");
    state.data.wikiCache[wikiKeyFor(it)] = rec;
    save(true);
    box.innerHTML = wikiHtml(rec);
    toast("Справка сохранена на устройстве");
  }catch(e){
    box.innerHTML = `<div class="wiki">
      <div class="wh">СПРАВКА НЕ ЗАГРУЗИЛАСЬ</div>
      <p>${esc(e.message || "Не удалось получить данные")}. Можно попробовать позже
      или заполнить поле «От чего помогает» самостоятельно.</p></div>`;
  }
}

async function wikiFindTitle(q){
  const url = "https://ru.wikipedia.org/w/api.php?action=query&list=search" +
              "&srsearch=" + encodeURIComponent(q) +
              "&srlimit=1&format=json&origin=*";
  const r = await fetch(url);
  if(!r.ok) throw new Error("Википедия не отвечает");
  const d = await r.json();
  const hit = d && d.query && d.query.search && d.query.search[0];
  return hit ? hit.title : null;
}

async function wikiSummary(title){
  const url = "https://ru.wikipedia.org/api/rest_v1/page/summary/" +
              encodeURIComponent(title.replace(/ /g, "_"));
  const r = await fetch(url);
  if(!r.ok) throw new Error("Статья не открылась");
  return await r.json();
}

/* ===================================================================
   Поиск в аптеках
   Открывается обычный поиск в браузере. Ничего не парсится: браузер
   не даёт странице читать чужие сайты, а аптечные сайты закрыты
   защитой от автоматических обращений.
   =================================================================== */
const PHARMACIES = [
  { name:"Волгофарм",        site:"volgofarm.ru" },
  { name:"Планета здоровья", site:"planetazdorovo.ru" },
  { name:"Вита Экспресс",    site:"vitaexpress.ru" },
  { name:"Аптека плюс",      site:"apteka-plus.ru" },
  { name:"Шах",              site:"apteka-shah.ru" },
  { name:"Апрель",           site:"apteka-april.ru" },
  { name:"Ригла",            site:"rigla.ru" },
  { name:"Здравсити",        site:"zdravcity.ru" },
  { name:"Аптека.ру",        site:"apteka.ru" }
];

function openSearch(text){
  const u = "https://yandex.ru/search/?text=" + encodeURIComponent(text);
  window.open(u, "_blank", "noopener");
}

function pharmacySheet(it){
  const q = it.name;
  const backEl = document.createElement("div");
  backEl.className = "modal-back";
  backEl.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <h2>Найти «${esc(q)}»</h2>
    ${navigator.onLine ? "" : `<div class="disclaimer mb">Сейчас нет интернета. Поиск откроется, но страница не загрузится.</div>`}
    <p class="hint mb">Откроется поиск в браузере — приложение само по сайтам не ходит.</p>
    <div class="btn-col">
      <button class="btn primary wide" data-q="web">🔎 Искать в интернете</button>
      <button class="btn wide" data-q="grls">📋 Госреестр лекарств (ГРЛС)</button>
    </div>
    <p class="field-label mt">По сайтам аптек</p>
    <div class="btn-col">
      ${PHARMACIES.map(p => `<button class="btn wide" data-site="${esc(p.site)}">🏥 ${esc(p.name)}</button>`).join("")}
    </div>
    <div class="mt"><button class="btn quiet wide" data-close>Закрыть</button></div>
  </div>`;

  backEl.addEventListener("click", e => {
    if(e.target === backEl || e.target.closest("[data-close]")){ backEl.remove(); return; }
    const site = e.target.closest("[data-site]");
    if(site){ openSearch(q + " site:" + site.dataset.site); backEl.remove(); return; }
    const b = e.target.closest("[data-q]");
    if(!b) return;
    if(b.dataset.q === "web")  openSearch(q + " купить в аптеке цена");
    if(b.dataset.q === "grls") openSearch(q + " site:grls.rosminzdrav.ru");
    backEl.remove();
  });
  document.body.appendChild(backEl);
}

export { pharmacySheet };
