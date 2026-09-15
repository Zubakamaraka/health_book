/* ===================================================================
   library.js — библиотека лекарств и процедур

   Что здесь важно понимать про данные:
   • Встроенный словарь (data/library.json) содержит только ФАКТЫ:
     название, действующее вещество, группу, формы выпуска, дозировки
     и торговые названия. Это не инструкция и не рекомендация.
   • Поле «От чего помогает» заполняет сам пользователь.
   • Справка из Википедии подгружается ТОЛЬКО по нажатию кнопки и только
     при наличии интернета. Сохраняется на устройстве, источник подписан.
   • Поиск в аптеках открывает обычный поиск в браузере. Приложение
     никаких сайтов не разбирает.

   Поиск устроен так, чтобы человек искал так, как говорит вслух:
   ищется и по действующему веществу, и по торговому названию, и
   показывается ровно то название, которое нашлось. Опечатки прощаются.
   =================================================================== */

import { state, save, uid } from "./store.js";
import { $, esc, go, back, toast, formHead, addFab, confirmDialog, render,
         queryParams } from "./ui.js";

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
    .map(it => Object.assign({}, it, d.libraryEdits[it.id] || {},
                             {builtin:true, edited: !!d.libraryEdits[it.id]}));
  const custom = (d.libraryCustom || []).map(it => Object.assign({}, it, {builtin:false, edited:false}));
  return builtin.concat(custom);
}

export function getItem(id){
  if(!id) return null;
  return allItems().find(it => it.id === id) || null;
}

/* ===================================================================
   Поиск
   =================================================================== */

/* Мягкая нормализация с сохранением длины — годится и для подсветки */
function soft(s){ return String(s||"").toLowerCase().replace(/ё/g,"е"); }

/* Согласный «скелет» слова: лекарства чаще всего путают в гласных.
   «Кетанал» и «Кетонал» дают «ктнл»; «розвостотин» и «розувастатин» — «рзвсттн». */
function skel(s){
  return soft(s).replace(/[^a-zа-я]/g, "").replace(/[аеиоуыэюяйьъ]/g, "");
}

/* Расстояние Левенштейна с ограничением сверху */
function lev(a, b, limit){
  if(a === b) return 0;
  const n = a.length, m = b.length;
  if(Math.abs(n - m) > limit) return limit + 1;
  let prev = new Array(m + 1);
  let cur  = new Array(m + 1);
  for(let j = 0; j <= m; j++) prev[j] = j;
  for(let i = 1; i <= n; i++){
    cur[0] = i;
    let rowMin = cur[0];
    for(let j = 1; j <= m; j++){
      const cost = a.charCodeAt(i-1) === b.charCodeAt(j-1) ? 0 : 1;
      cur[j] = Math.min(cur[j-1] + 1, prev[j] + 1, prev[j-1] + cost);
      if(cur[j] < rowMin) rowMin = cur[j];
    }
    if(rowMin > limit) return limit + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[m];
}

function wordStarts(s, q){
  return s.split(/[^a-zа-я0-9]+/).some(w => w && w.startsWith(q));
}

/* Поиск по бытовой памятке: человек набирает «от давления», а в памятке
   написано «назначают при повышенном давлении». Поэтому предлоги
   выбрасываются, а слова сравниваются без учёта окончаний. */
const STOPWORDS = new Set(["от","при","для","из","за","на","в","и","с","по","к","до","у"]);

function wordsOf(s){ return soft(s).split(/[^a-zа-я0-9]+/).filter(Boolean); }

function stemEq(a, b){
  if(a === b) return true;
  if(a.length >= 4 && b.startsWith(a)) return true;
  if(b.length >= 4 && a.startsWith(b)) return true;
  const sa = skel(a), sb = skel(b);
  return sa.length >= 3 && sa === sb;
}

function memoMatch(hay, q){
  const qw = wordsOf(q).filter(w => !STOPWORDS.has(w) && w.length >= 3);
  if(!qw.length) return false;
  const hw = wordsOf(hay);
  return qw.every(w => hw.some(h => stemEq(w, h)));
}

function byName(a, b){ return String(a.name).localeCompare(String(b.name), "ru"); }

/* Результат поиска:
   { item, title, alias, q, fuzzy, score }
   title — название, по которому нашлось (может быть торговым);
   alias — true, если title отличается от основного названия позиции.  */
export function searchItems(query, opts = {}){
  let list = allItems();
  if(opts.kind) list = list.filter(i => i.kind === opts.kind);
  if(opts.cat)  list = list.filter(i => i.cat === opts.cat);
  if(opts.own)  list = list.filter(i => !i.builtin || i.edited);
  if(opts.rx)   list = list.filter(i => !!i.rx);

  const q = soft(query).trim();
  if(!q){
    return list.sort(byName).map(it => ({item:it, title:it.name, alias:false, q:"", fuzzy:false, score:0}));
  }

  const out = [];
  for(const it of list){
    const titles = [it.name].concat(it.brands || []);
    let best = null;
    for(const t of titles){
      const s = soft(t);
      let score = null;
      if(s === q) score = 0;
      else if(s.startsWith(q)) score = 10;
      else if(wordStarts(s, q)) score = 20;
      else if(s.includes(q)) score = 30;
      if(score === null) continue;
      if(t !== it.name) score += 1;         // при равенстве основное название чуть выше
      if(best === null || score < best.score) best = {score, title:t};
    }
    let viaMemo = false;
    if(!best && it.tldr && memoMatch(it.tldr, q)){
      best = {score:50, title:it.name}; viaMemo = true;
    }
    if(!best){
      // Технические поля ищем буквально: сравнение «без окончаний» здесь
      // сработало бы и на опечатке, а её лучше показать отдельной подсказкой.
      const tech = soft([it.inn, it.group].filter(Boolean).join(" • "));
      if(tech.includes(q)) best = {score:60, title:it.name};
      else if(it.purpose && memoMatch(it.purpose, q)) best = {score:65, title:it.name};
    }
    if(best) out.push({item:it, title:best.title, alias:best.title !== it.name,
                       q, fuzzy:false, score:best.score, viaMemo});
  }

  if(out.length){
    out.sort((a,b) => a.score - b.score || byName(a.item, b.item));
    return out;
  }
  return fuzzySearch(list, q);
}

/* Поиск с опечатками — включается, только когда точных совпадений нет */
function fuzzySearch(list, q){
  if(q.length < 3) return [];
  const qs = skel(q);
  const limit = q.length >= 8 ? 3 : q.length >= 5 ? 2 : 1;
  const res = [];

  for(const it of list){
    const titles = [it.name].concat(it.brands || []);
    let best = null;
    for(const t of titles){
      const s = soft(t), ss = skel(t);
      let sc = null;
      if(qs.length >= 3 && ss === qs) sc = 5;
      else if(qs.length >= 4 && ss.startsWith(qs)) sc = 12;
      else {
        const d = Math.min(lev(q, s, limit), lev(q, s.slice(0, q.length), limit));
        if(d <= limit) sc = 20 + d;
      }
      if(sc !== null && (best === null || sc < best.score)) best = {score:sc, title:t};
    }
    if(best) res.push({item:it, title:best.title, alias:best.title !== it.name, q, fuzzy:true, score:best.score});
  }
  res.sort((a,b) => a.score - b.score || byName(a.item, b.item));
  return res.slice(0, 25);
}

/* Подсветка найденного куска в исходной строке */
export function hl(text, q){
  const t = String(text || "");
  if(!q) return esc(t);
  const i = soft(t).indexOf(q);
  if(i < 0) return esc(t);
  return esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length));
}

/* Подсветка отдельных слов — для памятки, где совпадают не подстроки,
   а слова с другими окончаниями. */
export function hlWords(text, q){
  const qw = wordsOf(q).filter(w => !STOPWORDS.has(w) && w.length >= 3);
  if(!qw.length) return esc(text);
  return String(text || "").split(/([^a-zA-Zа-яА-ЯёЁ0-9]+)/).map(part => {
    if(!/[a-zA-Zа-яА-ЯёЁ0-9]/.test(part)) return esc(part);
    const lw = soft(part);
    return qw.some(w => stemEq(w, lw)) ? "<mark>" + esc(part) + "</mark>" : esc(part);
  }).join("");
}

/* Действующие вещества позиции по отдельности.
   У комбинированных препаратов в поле записано несколько через запятую —
   именно так ловится случай «Терафлю и Цитрамон, а парацетамол один и тот же».
   Ключ строится по согласным, чтобы падежи не мешали сравнению. */
export function innParts(inn){
  return String(inn || "")
    .split(/[,;+/]| и /)
    .map(x => x.replace(/\(.*?\)/g, "").trim())
    .filter(x => x.length >= 4)
    .map(x => ({ name: x, key: skel(x) }))
    .filter(x => x.key.length >= 3);
}

/* Подсказка дозы: «1 таблетка 10 мг», но не «1 таблетка 1 таблетка».
   Слово «таблетка» дописывается только к настоящей граммовке. */
export function doseWord(it){
  const form = (it && it.forms && it.forms[0]) || "";
  if(/табл/i.test(form)) return "1 таблетка";
  if(/капсул/i.test(form)) return "1 капсула";
  if(/пакет|порош/i.test(form)) return "1 пакетик";
  return "";
}
export function isStrength(d){
  return /\d/.test(String(d||"")) && /(мг|мкг|\bг\b|мл|ме\b|%|ед)/i.test(String(d||""));
}
export function doseHint(it, dose){
  const d = dose != null ? dose : ((it && it.doses && it.doses[0]) || "");
  if(!d) return (it && it.forms && it.forms[0]) || "";
  const w = doseWord(it);
  return (w && isStrength(d)) ? (w + " " + d) : d;
}

/* ---------- Короткое описание позиции ---------- */
export function itemSubtitle(it){
  const parts = [];
  if(it.inn && soft(it.inn) !== soft(it.name)) parts.push(it.inn);
  if(it.group) parts.push(it.group);
  return parts.join(" · ");
}

/* Подпись для строки результата: если нашлось по торговому названию,
   первой идёт связь «= основное название». */
function resultSubtitle(r){
  const it = r.item;
  const parts = [];
  if(r.alias) parts.push("= " + it.name);
  if(it.inn && soft(it.inn) !== soft(it.name) && soft(it.inn) !== soft(r.title)) parts.push(it.inn);
  if(it.group) parts.push(it.group);
  return parts.join(" · ");
}

/* ===================================================================
   Экран: список библиотеки
   =================================================================== */
let libQuery = "";
let libCat = "";
let libKind = "";
let libOwn = false;
let libRx = false;

export function screenLibrary(root){
  root.innerHTML = `
    <h1 class="screen-title">Библиотека</h1>
    <p class="screen-sub">Ищите как привыкли — по названию с упаковки или по действующему веществу.</p>

    <div class="searchbar">
      <span class="si" aria-hidden="true">🔎</span>
      <input type="search" id="libSearch" placeholder="Кетонал, Найз, эналаприл…"
             value="${esc(libQuery)}" autocomplete="off" enterkeyhint="search">
    </div>

    <div class="pill-nav" id="kindNav">
      <button class="chip ${libKind===""?"on":""}" data-kind="">Всё</button>
      <button class="chip ${libKind==="drug"?"on":""}" data-kind="drug">💊 Лекарства</button>
      <button class="chip ${libKind==="procedure"?"on":""}" data-kind="procedure">🩺 Процедуры</button>
    </div>

    <div class="pill-nav" id="ownNav">
      <button class="chip ${libOwn?"on":""}" data-own aria-pressed="${libOwn}">⭐ Только моё</button>
      <button class="chip ${libRx?"on":""}" data-rx aria-pressed="${libRx}">📋 Только по рецепту</button>
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
  root.querySelector("#ownNav").addEventListener("click", e => {
    const own = e.target.closest("[data-own]");
    const rx  = e.target.closest("[data-rx]");
    if(own){ libOwn = !libOwn; own.classList.toggle("on", libOwn); own.setAttribute("aria-pressed", String(libOwn)); }
    else if(rx){ libRx = !libRx; rx.classList.toggle("on", libRx); rx.setAttribute("aria-pressed", String(libRx)); }
    else return;
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
    const found = searchItems(libQuery, {kind:libKind || null, cat:libCat || null, own:libOwn, rx:libRx});

    if(!found.length){
      box.innerHTML = `<div class="empty"><span class="big">🔍</span>
        <p><b>Ничего не нашлось</b></p>
        <p class="hint">${libOwn
          ? "Среди своих записей совпадений нет. Снимите отметку «Только моё» или добавьте позицию кнопкой «Добавить»."
          : "Попробуйте часть названия — например «кетон» вместо «Кетонал ДУО», — или добавьте свою позицию кнопкой «Добавить»."}</p></div>`;
      return;
    }

    const fuzzy = found[0].fuzzy;
    const cap = 120;
    box.innerHTML =
      (fuzzy ? `<div class="banner"><span class="bi">💡</span><span class="bt">
          Точного совпадения нет. Возможно, вы искали это — проверьте написание на упаковке.
        </span></div>` : "") +
      `<div class="list">${found.slice(0, cap).map(itemRow).join("")}</div>` +
      (found.length > cap ? `<p class="hint center mt">Показано ${cap} из ${found.length}. Уточните поиск.</p>` : "");

    box.querySelectorAll("[data-id]").forEach(b => {
      b.addEventListener("click", () => go("/library/item/" + encodeURIComponent(b.dataset.id)));
    });
  }

  function itemRow(r){
    const it = r.item;
    const cat = categoryOf(it.cat);
    const sub = resultSubtitle(r);
    return `<button class="item" type="button" data-id="${esc(it.id)}">
      <div class="top"><span class="nm">${it.kind === "procedure" ? "🩺 " : ""}${hl(r.title, r.q)}</span></div>
      ${it.tldr ? `<div class="tldr">${r.viaMemo ? hlWords(it.tldr, r.q) : esc(it.tldr)}</div>` : ""}
      ${sub ? `<div class="sub">${hl(sub, r.q)}</div>` : ""}
      <div class="meta">
        ${cat ? `<span class="tag">${cat.icon} ${esc(cat.name)}</span>` : ""}
        ${it.rx ? `<span class="tag warn">по рецепту</span>` : ""}
        ${!it.builtin ? `<span class="tag acc">⭐ своё</span>` : it.edited ? `<span class="tag acc">⭐ изменено</span>` : ""}
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
  const cached = state.data.wikiCache[wikiKeyFor(it)];

  root.innerHTML = formHead(it.name) + `
    ${it.tldr ? `<div class="tldr-big"><span class="ic" aria-hidden="true">💡</span>
       <span>${esc(it.tldr)}</span></div>` : ""}
    <div class="panel">
      <div class="meta mb">
        ${cat ? `<span class="tag">${cat.icon} ${esc(cat.name)}</span>` : ""}
        <span class="tag">${it.kind === "procedure" ? "🩺 процедура" : "💊 лекарство"}</span>
        ${it.rx ? `<span class="tag warn">по рецепту</span>` : ""}
        ${!it.builtin ? `<span class="tag acc">⭐ своя запись</span>` : it.edited ? `<span class="tag acc">⭐ изменено вами</span>` : ""}
      </div>
      ${it.inn ? kv("Действующее вещество", it.inn) : ""}
      ${it.group ? kv("Группа", it.group) : ""}
      ${it.brands && it.brands.length ? kv("Встречается в аптеке как", it.brands.join(", ")) : ""}
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
  bindWikiOther(it, root);   // если справка уже была загружена раньше

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

   Главное правило: обязательное поле ровно одно — название.
   Всё остальное спрятано под «Подробности» и заполняется когда угодно
   (или никогда). Плюс два помощника: заполнить из Википедии и взять
   за образец похожее лекарство из библиотеки.
   =================================================================== */
export function screenLibraryForm(root, params){
  const editing = !!params.id;
  const src = editing ? getItem(params.id) : null;
  if(editing && !src){ go("/library", true); return; }

  const v = {
    kind: src ? src.kind : "drug",
    rx:   src ? !!src.rx : false
  };

  const val = {
    name: src ? src.name || "" : (queryName() || ""),
    tldr: src ? src.tldr || "" : "",
    inn:  src ? src.inn  || "" : "",
    brands: src ? (src.brands || []).join(", ") : "",
    cat:  src ? src.cat  || "" : "",
    forms:src ? (src.forms||[]).join(", ") : "",
    doses:src ? (src.doses||[]).join(", ") : "",
    purpose: src ? src.purpose || "" : "",
    age:  src ? src.age  || "" : "",
    contra: src ? src.contra || "" : "",
    notes: src ? src.notes || "" : "",
    group: src ? src.group || "" : ""
  };

  const hasDetails = !!(val.inn || val.brands || val.forms || val.doses ||
                        val.purpose || val.age || val.contra || val.notes || val.group);

  root.innerHTML = formHead(editing ? "Изменить позицию" : "Новая позиция") + `
    <form id="libForm" novalidate>

      <div class="step">
        <div class="sh"><span class="n">1</span><span class="t">Самое необходимое</span></div>

        <div class="field">
          <span class="field-label">Что добавляем</span>
          <div class="chips" id="kindPick">
            <button type="button" class="chip ${v.kind==="drug"?"on":""}" data-k="drug">💊 Лекарство</button>
            <button type="button" class="chip ${v.kind==="procedure"?"on":""}" data-k="procedure">🩺 Процедура</button>
          </div>
        </div>

        <div class="field">
          <label for="fName">Название <span class="req">*</span></label>
          <div class="sub">Так, как написано на упаковке или сказал врач.</div>
          <input type="text" id="fName" value="${esc(val.name)}" required placeholder="Например: Амосин">
        </div>

        <div class="field">
          <label for="fTldr">Коротко: от чего</label>
          <div class="sub">Как говорят в быту: «от головы», «при вздутии». Видно прямо в списке и ищется поиском.</div>
          <input type="text" id="fTldr" value="${esc(val.tldr)}" placeholder="например: от головы">
        </div>

        <div class="field">
          <label for="fCat">Раздел</label>
          <select id="fCat">
            <option value="">— не указан —</option>
            ${CATEGORIES.map(c => `<option value="${esc(c.id)}" ${val.cat===c.id?"selected":""}>${c.icon} ${esc(c.name)}</option>`).join("")}
          </select>
        </div>

        <p class="hint">Этого уже достаточно — можно сохранять.
           Остальное заполнится само или руками, когда будет время.</p>
      </div>

      <div class="step only-drug">
        <div class="sh"><span class="n">⚡</span><span class="t">Заполнить быстро</span></div>
        <div class="btn-col">
          <button type="button" class="btn wide" id="fromWiki">🌐 Заполнить из интернета</button>
          <button type="button" class="btn wide" id="fromTemplate">📋 Взять за образец похожее</button>
        </div>
        <div id="fillNote"></div>
      </div>

      <div class="step">
        <div class="sh"><span class="n">2</span><span class="t">Подробности</span></div>
        <button type="button" class="btn quiet wide" id="toggleDetails"
                aria-expanded="${hasDetails}">${hasDetails ? "Свернуть подробности" : "Заполнить подробности — необязательно"}</button>

        <div id="detailsBox" ${hasDetails ? "" : "hidden"} class="mt">
          <div class="field only-drug">
            <label for="fInn">Действующее вещество</label>
            <div class="sub">Написано на упаковке мелким шрифтом. Помогает находить аналоги подешевле.</div>
            <input type="text" id="fInn" value="${esc(val.inn)}">
          </div>

          <div class="field only-drug">
            <label for="fBrands">Другие названия в аптеке</label>
            <div class="sub">Через запятую. По ним тоже будет искаться.</div>
            <input type="text" id="fBrands" value="${esc(val.brands)}">
          </div>

          <div class="field only-drug">
            <label for="fGroup">Группа</label>
            <input type="text" id="fGroup" value="${esc(val.group)}" placeholder="Например: НПВП, антибиотик">
          </div>

          <div class="field only-drug">
            <label for="fForms">В каком виде выпускается</label>
            <div class="sub">Через запятую: таблетки, капсулы, мазь…</div>
            <input type="text" id="fForms" value="${esc(val.forms)}">
          </div>

          <div class="field only-drug">
            <label for="fDoses">Дозировки (граммовки)</label>
            <div class="sub">Через запятую: 250 мг, 500 мг</div>
            <input type="text" id="fDoses" value="${esc(val.doses)}">
          </div>

          <div class="field">
            <label for="fPurpose">От чего помогает</label>
            <div class="sub">Своими словами — так, как объяснил врач.</div>
            <textarea id="fPurpose">${esc(val.purpose)}</textarea>
          </div>

          <div class="field">
            <label for="fAge">Возраст и особенности применения</label>
            <textarea id="fAge" placeholder="Например: взрослым, после еды">${esc(val.age)}</textarea>
          </div>

          <div class="field">
            <label for="fContra">Противопоказания</label>
            <div class="sub">Полный список всегда есть в инструкции к упаковке.</div>
            <textarea id="fContra">${esc(val.contra)}</textarea>
          </div>

          <div class="field only-drug">
            <span class="field-label">Отпуск</span>
            <div class="chips">
              <button type="button" class="chip ${v.rx?"on":""}" id="fRx" aria-pressed="${v.rx}">По рецепту</button>
            </div>
          </div>

          <div class="field">
            <label for="fNotes">Примечания</label>
            <textarea id="fNotes" placeholder="Что угодно на память">${esc(val.notes)}</textarea>
          </div>
        </div>
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
    if(v.kind !== "drug") return;
    const db = $("#detailsBox", root);
    if(db && db.hidden) root.querySelectorAll("#detailsBox .only-drug").forEach(el => { el.hidden = false; });
  };
  root.querySelector("#kindPick").addEventListener("click", e => {
    const b = e.target.closest("[data-k]"); if(!b) return;
    v.kind = b.dataset.k;
    root.querySelectorAll("#kindPick .chip").forEach(c => c.classList.toggle("on", c.dataset.k === v.kind));
    applyKind();
  });
  applyKind();

  const toggle = $("#toggleDetails", root);
  toggle.addEventListener("click", () => {
    const box = $("#detailsBox", root);
    box.hidden = !box.hidden;
    toggle.setAttribute("aria-expanded", String(!box.hidden));
    toggle.textContent = box.hidden ? "Заполнить подробности — необязательно" : "Свернуть подробности";
  });
  function openDetails(){
    const box = $("#detailsBox", root);
    if(box.hidden){ box.hidden = false; toggle.setAttribute("aria-expanded","true"); toggle.textContent = "Свернуть подробности"; }
  }

  const rxBtn = $("#fRx", root);
  rxBtn.addEventListener("click", () => {
    v.rx = !v.rx;
    rxBtn.classList.toggle("on", v.rx);
    rxBtn.setAttribute("aria-pressed", String(v.rx));
  });

  /* ---------- помощник: заполнить из интернета ---------- */
  $("#fromWiki", root).addEventListener("click", async () => {
    const name = $("#fName", root).value.trim();
    if(!name){ toast("Сначала впишите название"); $("#fName", root).focus(); return; }
    if(!navigator.onLine){ toast("Для этого нужен интернет"); return; }

    const note = $("#fillNote", root);
    note.innerHTML = `<p class="hint mt">Ищем «${esc(name)}» в Википедии…</p>`;
    try{
      const data = await wikiFill(name);
      if(!data){ note.innerHTML = `<p class="hint mt">Ничего подходящего не нашлось. Заполните вручную — это не страшно.</p>`; return; }
      applyFill(data);
      note.innerHTML = `<div class="wiki" style="margin-top:.6rem">
        <div class="wh">ЗАПОЛНЕНО ПО СТАТЬЕ «${esc(data.title)}»</div>
        <p>Проверьте поля ниже: сведения из Википедии, а не из инструкции.
           Что-то может не подойти — правьте смело.</p>
        <div class="mt"><button type="button" class="btn quiet wide" id="fillOther" style="min-height:2.6rem">Взять другую статью</button></div>
      </div>`;
      const other = $("#fillOther", root);
      if(other) other.addEventListener("click", () => pickFillArticle(name, note));
    }catch(e){
      note.innerHTML = `<p class="hint mt">Не получилось: ${esc(e.message || "ошибка сети")}. Заполните вручную.</p>`;
    }
  });

  async function pickFillArticle(name, note){
    let cands = [];
    try{ cands = await wikiCandidatesFor({name}); }catch(e){}
    if(!cands.length){ toast("Вариантов нет"); return; }
    const backEl = document.createElement("div");
    backEl.className = "modal-back";
    backEl.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2>Какая статья подходит?</h2>
      <div class="btn-col">${cands.slice(0,6).map(c =>
        `<button class="btn wide" data-t="${esc(c.title)}" style="justify-content:flex-start;text-align:left">${esc(c.title)}</button>`).join("")}</div>
      <div class="mt"><button class="btn quiet wide" data-close>Отмена</button></div>
    </div>`;
    backEl.addEventListener("click", async e => {
      if(e.target === backEl || e.target.closest("[data-close]")){ backEl.remove(); return; }
      const b = e.target.closest("[data-t]"); if(!b) return;
      backEl.remove();
      note.innerHTML = `<p class="hint mt">Загружаем…</p>`;
      try{
        const data = await wikiFill(name, b.dataset.t);
        if(data){
          applyFill(data);
          note.innerHTML = `<div class="wiki" style="margin-top:.6rem">
            <div class="wh">ЗАПОЛНЕНО ПО СТАТЬЕ «${esc(data.title)}»</div>
            <p>Проверьте поля ниже и поправьте, если нужно.</p></div>`;
        }
      }catch(err){ note.innerHTML = `<p class="hint mt">Не получилось.</p>`; }
    });
    document.body.appendChild(backEl);
  }

  function applyFill(data){
    openDetails();
    const set = (id, value) => {
      const el = $("#" + id, root);
      if(el && value && !el.value.trim()) el.value = value;
    };
    set("fInn", data.inn);
    set("fGroup", data.group);
    set("fForms", (data.forms || []).join(", "));
    set("fPurpose", data.purpose);
    set("fTldr", data.tldr);
    if(data.cat && !$("#fCat", root).value) $("#fCat", root).value = data.cat;
    toast("Поля заполнены — проверьте их");
  }

  /* ---------- помощник: взять за образец ---------- */
  $("#fromTemplate", root).addEventListener("click", () => {
    const backEl = document.createElement("div");
    backEl.className = "modal-back";
    backEl.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2>Взять за образец</h2>
      <p class="hint mb">Найдите похожее лекарство — из него скопируются раздел,
        группа, формы выпуска и дозировки. Название останется вашим.</p>
      <div class="searchbar"><span class="si" aria-hidden="true">🔎</span>
        <input type="search" id="tplSearch" placeholder="Например: ибупрофен" autocomplete="off"></div>
      <div id="tplResults"></div>
      <div class="mt"><button class="btn quiet wide" data-close>Отмена</button></div>
    </div>`;
    const inp = backEl.querySelector("#tplSearch");
    const box = backEl.querySelector("#tplResults");
    let t = null;
    inp.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const qq = inp.value.trim();
        if(qq.length < 2){ box.innerHTML = ""; return; }
        const found = searchItems(qq, {kind:"drug"}).slice(0, 6);
        box.innerHTML = `<div class="btn-col mt">${found.map(r => `
          <button class="pickrow" type="button" data-tpl="${esc(r.item.id)}">
            <span class="plus" aria-hidden="true">📋</span>
            <span class="pb"><span class="n">${hl(r.title, r.q)}</span>
              <span class="s">${esc(itemSubtitle(r.item))}</span></span>
          </button>`).join("")}</div>`;
      }, 180);
    });
    backEl.addEventListener("click", e => {
      if(e.target === backEl || e.target.closest("[data-close]")){ backEl.remove(); return; }
      const b = e.target.closest("[data-tpl]"); if(!b) return;
      const it = getItem(b.dataset.tpl);
      backEl.remove();
      if(!it) return;
      openDetails();
      if(!$("#fCat", root).value) $("#fCat", root).value = it.cat || "";
      const set = (id, value) => { const el = $("#" + id, root); if(el && value && !el.value.trim()) el.value = value; };
      set("fInn", it.inn);
      set("fGroup", it.group);
      set("fTldr", it.tldr);
      set("fForms", (it.forms || []).join(", "));
      set("fDoses", (it.doses || []).join(", "));
      if(it.rx && !v.rx){ v.rx = true; rxBtn.classList.add("on"); rxBtn.setAttribute("aria-pressed","true"); }
      $("#fillNote", root).innerHTML = `<p class="hint mt">Взято за образец: <b>${esc(it.name)}</b>. Проверьте поля.</p>`;
      toast("Скопировано из «" + it.name + "»");
    });
    document.body.appendChild(backEl);
    inp.focus();
  });

  /* ---------- сохранение ---------- */
  form.addEventListener("submit", e => {
    e.preventDefault();
    const name = $("#fName", root).value.trim();
    if(!name){ toast("Впишите название"); $("#fName", root).focus(); return; }

    const gv = id => { const el = $("#" + id, root); return el ? el.value.trim() : ""; };
    const splitList = s => s.split(",").map(x => x.trim()).filter(Boolean);
    const isDrug = v.kind === "drug";

    const payload = {
      kind: v.kind,
      name,
      tldr: gv("fTldr"),
      inn: isDrug ? gv("fInn") : "",
      brands: isDrug ? splitList(gv("fBrands")) : [],
      group: isDrug ? gv("fGroup") : "",
      cat: gv("fCat"),
      forms: isDrug ? splitList(gv("fForms")) : [],
      doses: isDrug ? splitList(gv("fDoses")) : [],
      purpose: gv("fPurpose"),
      age: gv("fAge"),
      contra: gv("fContra"),
      notes: gv("fNotes"),
      rx: isDrug ? v.rx : false
    };

    if(editing && src.builtin){
      state.data.libraryEdits[src.id] = payload;
      save(true); toast("Сохранено");
      // Назад, а не подмена адреса — иначе в истории два одинаковых экрана
      back("/library/item/" + encodeURIComponent(src.id));
    }else if(editing){
      const i = state.data.libraryCustom.findIndex(x => x.id === src.id);
      state.data.libraryCustom[i] = Object.assign({}, state.data.libraryCustom[i], payload);
      save(true); toast("Сохранено");
      back("/library/item/" + encodeURIComponent(src.id));
    }else{
      const item = Object.assign({id: uid("li"), createdAt: new Date().toISOString()}, payload);
      state.data.libraryCustom.push(item);
      save(true); toast("Добавлено в библиотеку");
      const q = queryParams();
      if(q.link){
        // Пришли из карточки назначения — связываем её с новой позицией
        const c = state.data.courses.find(x => x.id === q.link);
        if(c){ c.libId = item.id; save(true); }
        go("/home/course/" + encodeURIComponent(q.link), true);
      }else if(q.then === "course"){
        go("/home/course/new?lib=" + encodeURIComponent(item.id), true);
      }else{
        go("/library/item/" + encodeURIComponent(item.id), true);
      }
    }
  });
}

function queryName(){
  const q = queryParams();
  return q.name ? decodeURIComponent(q.name) : "";
}

/* ===================================================================
   Автозаполнение по статье Википедии

   Из краткого описания вытаскиваются группа, формы выпуска и фраза
   «для чего применяется». Всё попадает в поля формы как черновик —
   ничего не сохраняется само, пользователь видит и правит.
   =================================================================== */
const FORM_WORDS = [
  ["таблетки", /таблет/i], ["капсулы", /капсул/i], ["мазь", /\bмаз[ьию]/i],
  ["гель", /\bгел[ьяие]/i], ["крем", /\bкрем/i], ["раствор", /раствор/i],
  ["спрей", /спре[йя]/i], ["капли", /\bкапл[ияе]/i], ["сироп", /сироп/i],
  ["суппозитории", /суппозитор|свеч[кие]/i], ["порошок", /порош[ко]/i],
  ["суспензия", /суспенз/i], ["пластырь", /пластыр/i], ["ингаляции", /ингаля/i]
];

const CAT_HINTS = [
  ["pain",       /нестероидн|анальгет|обезболив|жаропониж|противовоспалительн|подагр/i],
  ["antibiotic", /антибиотик|противомикробн|противогрибков|противовирусн|сульфаниламид/i],
  ["heart",      /гипертенз|артериальн[оы]* давлени|бета-адреноблокатор|ингибитор апф|сартан|аритм|стенокард|сердечн/i],
  ["vessels",    /статин|холестерин|антиагрегант|антикоагулянт|тромб|венотон/i],
  ["stomach",    /желудочн|изжог|протонн|гастр|кишечн|слабительн|диаре|печен|желчегон|фермент/i],
  ["allergy",    /антигистаминн|аллерг/i],
  ["breath",     /кашл|бронх|отхаркива|муколит|простуд|грипп/i],
  ["ent",        /горл|носов|ринит|отит|ушн/i],
  ["nerves",     /успокоительн|седативн|антидепрессант|ноотроп|тревог|бессонниц|снотворн/i],
  ["diabetes",   /сахарн|гликем|инсулин|диабет/i],
  ["vitamins",   /витамин|минерал|микроэлемент/i],
  ["eyes",       /глазн|офтальм/i],
  ["uro",        /мочев|простат|почечн|уросептик/i],
  ["skin",       /антисептик|кожн|дерматолог|ранозажив/i],
  ["hormones",   /гормон|глюкокортикоид|щитовидн/i]
];

async function wikiCandidatesFor(itemLike){
  return await wikiCandidates({
    name: itemLike.name || "",
    inn: itemLike.inn || "",
    brands: itemLike.brands || []
  });
}

async function wikiFill(name, forcedTitle){
  let title = forcedTitle;
  if(!title){
    const cands = await wikiCandidatesFor({name});
    if(!cands.length) return null;
    title = cands[0].title;
  }
  const sum = await wikiSummary(title);
  const text = String(sum.extract || "");
  if(!text) return null;

  // Группа: «из группы …», «относится к группе …», «— это <что-то> средство»
  let group = "";
  let m = text.match(/(?:из\s+групп[ыи]|относится\s+к\s+групп[еы]|групп[аы])\s+([^.,;()]{4,70})/i);
  if(m) group = m[1].trim();
  if(!group){
    m = text.match(/—\s*([^.,;()]{4,70}?(?:средство|препарат|антибиотик|витамин|гормон))/i);
    if(m) group = m[1].trim();
  }
  group = group.replace(/^\s*(?:лекарственн\w+\s+)?/i, "").trim();
  if(group.length > 70) group = "";

  // Формы выпуска
  const forms = FORM_WORDS.filter(([, re]) => re.test(text)).map(([w]) => w);

  // Для чего применяется — предложение с характерным словом
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let purpose = sentences.find(s => /применя|использу|назнача|показан|лечени|терапи/i.test(s)) || "";
  if(!purpose) purpose = sentences.slice(0, 2).join(" ");
  if(purpose.length > 400) purpose = purpose.slice(0, 400).replace(/\s+\S*$/, "") + "…";
  if(purpose) purpose += "\n\n(из Википедии — проверьте и поправьте)";

  // Действующее вещество: «действующее вещество — X» либо заголовок статьи
  let inn = "";
  m = text.match(/действующе[ем]\s+веществ[оа][^.]{0,30}?[—:-]\s*([^.,;()]{3,45})/i);
  if(m) inn = m[1].trim();
  if(!inn && soft(sum.title || "") !== soft(name) && /^[А-ЯЁA-Z][а-яёa-z-]+$/.test(String(sum.title || "").trim()))
    inn = String(sum.title).trim();

  // Раздел библиотеки — по ключевым словам
  let cat = "";
  const hay = (group + " " + text).toLowerCase();
  for(const [id, re] of CAT_HINTS){ if(re.test(hay)){ cat = id; break; } }

  // Короткая памятка: берём из найденного раздела библиотеки
  const catName = (CATEGORIES.find(c => c.id === cat) || {}).name || "";
  const tldr = catName ? catName.toLowerCase() : "";

  return { title: sum.title || title, group, forms, purpose, inn, cat, tldr };
}

/* ===================================================================
   Справка из Википедии

   Тонкость: у многих препаратов статья в Википедии написана про
   действующее вещество или даже про исходный организм (у «Энтерола» —
   про дрожжи Saccharomyces boulardii). Поэтому кандидаты сначала
   оцениваются, а рядом со справкой всегда есть кнопка «Это не та статья».
   =================================================================== */
function wikiKeyFor(it){ return (it.name || it.inn || "").trim().toLowerCase(); }

const MED_WORDS = ["препарат","лекарств","применяют","применяется","фармак","таблет",
                   "показан","терапи","лечени","доза","мазь","раствор","капсул","антибиотик",
                   "средство","медицин"];

function medScore(text){
  const t = soft(text || "");
  let n = 0;
  for(const w of MED_WORDS) if(t.includes(w)) n++;
  return n;
}

function wikiHtml(c){
  const weak = c.medScore !== undefined && c.medScore < 2;
  return `<div class="wiki">
    <div class="wh">СПРАВКА ИЗ ВИКИПЕДИИ — не назначение врача</div>
    <div><b>${esc(c.title)}</b></div>
    <p class="mt">${esc(c.extract)}</p>
    ${weak ? `<p class="hint mt">Похоже, статья не про лекарство. Проверьте по кнопке ниже.</p>` : ""}
    <div class="wsrc">Источник: Википедия${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">открыть статью</a>` : ""}
      · загружено ${c.fetchedAt ? new Date(c.fetchedAt).toLocaleDateString("ru-RU") : "—"}
      · лицензия CC BY-SA</div>
    <div class="mt"><button class="btn quiet wide" id="wikiOther" style="min-height:2.6rem">Это не та статья — выбрать другую</button></div>
  </div>`;
}

async function fetchWiki(it, root, forcedTitle){
  const box = $("#wikiBox", root);
  if(!navigator.onLine){
    toast("Нет интернета. Справку можно загрузить, когда появится сеть.");
    return;
  }
  box.innerHTML = `<div class="wiki"><div class="wh">ЗАГРУЗКА…</div><p>Ищем статью в Википедии…</p></div>`;

  try{
    let title = forcedTitle;
    if(!title){
      const cands = await wikiCandidates(it);
      if(!cands.length) throw new Error("Статья не найдена");
      title = cands[0].title;
    }
    const sum = await wikiSummary(title);
    const rec = {
      title: sum.title || title,
      extract: sum.extract || "",
      url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) ||
           ("https://ru.wikipedia.org/wiki/" + encodeURIComponent(title)),
      fetchedAt: Date.now(),
      medScore: medScore(sum.extract)
    };
    if(!rec.extract) throw new Error("В статье нет краткого описания");
    state.data.wikiCache[wikiKeyFor(it)] = rec;
    save(true);
    box.innerHTML = wikiHtml(rec);
    bindWikiOther(it, root);
    toast("Справка сохранена на устройстве");
  }catch(e){
    box.innerHTML = `<div class="wiki">
      <div class="wh">СПРАВКА НЕ ЗАГРУЗИЛАСЬ</div>
      <p>${esc(e.message || "Не удалось получить данные")}. Можно попробовать позже
      или заполнить поле «От чего помогает» самостоятельно.</p></div>`;
  }
}

function bindWikiOther(it, root){
  const b = $("#wikiOther", root);
  if(b) b.addEventListener("click", () => chooseWikiArticle(it, root));
}

/* Собираем кандидатов по торговому названию и по действующему веществу,
   затем оцениваем: насколько заголовок похож на искомое и насколько
   текст похож на описание лекарства. */
async function wikiCandidates(it){
  const queries = [];
  if(it.name) queries.push(it.name.replace(/\(.*?\)/g, "").trim());
  if(it.inn && soft(it.inn) !== soft(it.name)) queries.push(it.inn.replace(/\(.*?\)/g, "").trim());
  (it.brands || []).slice(0, 1).forEach(b => queries.push(b));

  const seen = new Set();
  const out = [];
  for(const q of queries){
    let hits = [];
    try{ hits = await wikiSearch(q, 5); }catch(e){ continue; }
    for(const h of hits){
      if(seen.has(h.title)) continue;
      seen.add(h.title);
      const t = soft(h.title), qq = soft(q);
      let score = 0;
      if(t === qq) score += 100;
      else if(t.startsWith(qq)) score += 60;
      else if(t.includes(qq)) score += 30;
      score += medScore(h.snippet) * 12;
      out.push({title:h.title, snippet:h.snippet, score});
    }
  }
  out.sort((a,b) => b.score - a.score);
  return out;
}

async function chooseWikiArticle(it, root){
  if(!navigator.onLine){ toast("Нет интернета"); return; }
  toast("Ищем варианты…");
  let cands = [];
  try{ cands = await wikiCandidates(it); }catch(e){}
  if(!cands.length){ toast("Вариантов не нашлось"); return; }

  const backEl = document.createElement("div");
  backEl.className = "modal-back";
  backEl.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <h2>Какая статья подходит?</h2>
    <p class="hint mb">У лекарств статья часто написана про действующее вещество.</p>
    <div class="btn-col">
      ${cands.slice(0, 6).map(c => `<button class="btn wide" data-t="${esc(c.title)}"
        style="justify-content:flex-start; text-align:left">${esc(c.title)}</button>`).join("")}
    </div>
    <div class="mt"><button class="btn quiet wide" data-close>Отмена</button></div>
  </div>`;
  backEl.addEventListener("click", e => {
    if(e.target === backEl || e.target.closest("[data-close]")){ backEl.remove(); return; }
    const b = e.target.closest("[data-t]");
    if(!b) return;
    backEl.remove();
    fetchWiki(it, root, b.dataset.t);
  });
  document.body.appendChild(backEl);
}

async function wikiSearch(q, limit){
  const url = "https://ru.wikipedia.org/w/api.php?action=query&list=search" +
              "&srsearch=" + encodeURIComponent(q) +
              "&srlimit=" + (limit || 5) + "&format=json&origin=*";
  const r = await fetch(url);
  if(!r.ok) throw new Error("Википедия не отвечает");
  const d = await r.json();
  const hits = (d && d.query && d.query.search) || [];
  return hits.map(h => ({ title: h.title, snippet: String(h.snippet || "").replace(/<[^>]*>/g, "") }));
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
