/* ===================================================================
   kits.js — «Мои наборы»

   Почему наборы СВОИ, а не готовые советы от приложения.
   Идея быстрая и понятная: заболел — добавил сразу пять привычных
   позиций, а не искал каждую. Но набор вида «при гриппе принимайте
   то-то и то-то» — это уже назначение лечения, а приложение такого
   делать не должно: у пожилого человека это накладывается на
   постоянные препараты, и дозы начинают складываться.
   Поэтому состав набора определяет человек или врач, а приложение
   только запоминает его и добавляет одним нажатием — и предупреждает,
   если в назначениях оказалось одно и то же действующее вещество.
   =================================================================== */

import { state, save, uid } from "./store.js";
import { $, esc, go, back, toast, formHead, addFab, confirmDialog,
         promptDialog, render, todayISO, plural } from "./ui.js";
import { searchItems, getItem, itemSubtitle, hl, innParts, doseHint } from "./library.js";
import { profileCourses } from "./home.js";

/* Пустые заготовки: только названия, без состава.
   Помогают начать, но ничего не предлагают принимать. */
const TEMPLATES = [
  { name: "Простуда",        icon: "🤧" },
  { name: "Давление",        icon: "🫀" },
  { name: "Желудок",         icon: "🍽️" },
  { name: "Спина и суставы", icon: "🦴" },
  { name: "Аптечка в дорогу",icon: "🧳" },
  { name: "Ежедневное",      icon: "📅" }
];

export function kits(){ return state.data.kits || []; }
export function getKit(id){ return kits().find(k => k.id === id) || null; }

/* ===================================================================
   Проверка на повтор действующего вещества
   =================================================================== */
export function duplicateIngredients(courses){
  const map = new Map();          // ключ вещества → {name, courses:[]}
  for(const c of courses){
    const lib = c.libId ? getItem(c.libId) : null;
    const parts = innParts(lib ? lib.inn : "");
    for(const p of parts){
      if(!map.has(p.key)) map.set(p.key, { name: p.name, items: [] });
      const rec = map.get(p.key);
      if(!rec.items.includes(c.name)) rec.items.push(c.name);
    }
  }
  return Array.from(map.values()).filter(r => r.items.length > 1);
}

export function duplicateBanner(courses){
  const dups = duplicateIngredients(courses);
  if(!dups.length) return "";
  return `<div class="banner warnbanner">
    <span class="bi">⚠️</span>
    <span class="bt">
      ${dups.map(d => `Одно и то же действующее вещество <b>${esc(d.name.toLowerCase())}</b>
        сразу в нескольких позициях: ${esc(d.items.join(", "))}.`).join("<br>")}
      <br>Так можно незаметно превысить дозу — стоит уточнить у врача или в аптеке.
    </span>
  </div>`;
}

/* ===================================================================
   Экран: список наборов
   =================================================================== */
export function screenKits(root){
  const list = kits();

  root.innerHTML = formHead("Мои наборы") + `
    <p class="screen-sub">Свои подборки: что вы обычно покупаете и принимаете
      в типичной ситуации. Составляете сами или со слов врача — приложение
      ничего не назначает.</p>
    <div id="kitList"></div>
  `;

  const box = $("#kitList", root);
  if(!list.length){
    box.innerHTML = `<div class="empty"><span class="big">📦</span>
        <p><b>Наборов пока нет</b></p>
        <p class="hint">Создайте набор и положите в него позиции из библиотеки.
          Потом одно нажатие — и всё добавится в назначения.</p></div>
      <p class="field-label mt">Начать с заготовки</p>
      <div class="chips" id="tpls">
        ${TEMPLATES.map(t => `<button type="button" class="chip" data-t="${esc(t.name)}"
          data-i="${esc(t.icon)}">${t.icon} ${esc(t.name)}</button>`).join("")}
      </div>
      <p class="hint mt">Заготовка создаёт пустой набор с таким названием — состав за вами.</p>`;
    box.querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => {
      const k = createKit(b.dataset.t, b.dataset.i);
      go("/home/kits/" + encodeURIComponent(k.id));
    }));
  }else{
    box.innerHTML = `<div class="list">${list.map(k => `
      <button class="item" type="button" data-open="${esc(k.id)}">
        <div class="top"><span class="nm">${esc(k.icon || "📦")} ${esc(k.name)}</span></div>
        <div class="sub">${k.items.length
          ? esc(k.items.map(i => i.name).slice(0,4).join(", ")) + (k.items.length > 4 ? " и ещё…" : "")
          : "пока пусто"}</div>
        <div class="meta"><span class="tag">${k.items.length} ${plural(k.items.length,"позиция","позиции","позиций")}</span></div>
      </button>`).join("")}</div>`;
    box.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click",
      () => go("/home/kits/" + encodeURIComponent(b.dataset.open))));
  }

  addFab("Новый набор", async () => {
    const name = await promptDialog({title:"Новый набор", label:"Название",
      placeholder:"Например: Простуда"});
    if(!name) return;
    const k = createKit(name, "📦");
    go("/home/kits/" + encodeURIComponent(k.id));
  });
}

function createKit(name, icon){
  const k = { id: uid("kt"), name: name.trim(), icon: icon || "📦",
              note: "", items: [], createdAt: new Date().toISOString() };
  state.data.kits.push(k);
  save(true);
  return k;
}

/* ===================================================================
   Экран: один набор
   =================================================================== */
export function screenKit(root, params){
  const k = getKit(params.id);
  if(!k){ go("/home/kits", true); return; }

  const dups = duplicateIngredients(k.items.map(i => ({name:i.name, libId:i.libId})));

  root.innerHTML = formHead((k.icon || "📦") + " " + k.name) + `
    ${k.note ? `<p class="screen-sub">${esc(k.note)}</p>` : ""}

    ${dups.length ? `<div class="banner warnbanner">
      <span class="bi">⚠️</span>
      <span class="bt">${dups.map(d => `В наборе дважды встречается
        <b>${esc(d.name.toLowerCase())}</b>: ${esc(d.items.join(", "))}.`).join("<br>")}
        <br>Вместе такие препараты складываются по дозе — проверьте состав.</span>
    </div>` : ""}

    <div class="panel">
      <h2>Состав</h2>
      <div id="kitItems"></div>
      <div class="mt"><button class="btn wide" id="addItem">＋ Добавить позицию</button></div>
    </div>

    <div class="btn-col mt">
      <button class="btn primary big wide" id="applyKit" ${k.items.length ? "" : "disabled"}>
        ＋ Добавить весь набор в назначения</button>
      <button class="btn wide" id="renKit">✏️ Переименовать</button>
      <button class="btn wide" id="noteKit">📝 Заметка к набору</button>
      <button class="btn danger wide" id="delKit">Удалить набор</button>
    </div>

    <p class="disclaimer-mini">Набор составлен вами. Приложение не предлагает схем
      лечения и не проверяет их совместимость — это делает врач.</p>
  `;

  drawItems();

  $("#addItem", root).addEventListener("click", () => pickItem(k, drawItems));
  $("#renKit", root).addEventListener("click", async () => {
    const name = await promptDialog({title:"Название набора", label:"Название", value:k.name});
    if(!name) return;
    k.name = name; save(true); render();
  });
  $("#noteKit", root).addEventListener("click", async () => {
    const note = await promptDialog({title:"Заметка", label:"Для чего этот набор",
      value:k.note, placeholder:"Например: что выписал терапевт в прошлый раз"});
    if(note === null) return;
    k.note = note; save(true); render();
  });
  $("#delKit", root).addEventListener("click", async () => {
    const ok = await confirmDialog({title:`Удалить набор «${k.name}»?`,
      text:"Уже созданные назначения останутся на месте.", okText:"Удалить", danger:true});
    if(!ok) return;
    state.data.kits = state.data.kits.filter(x => x.id !== k.id);
    save(true); toast("Набор удалён"); back("/home/kits");
  });

  const apply = $("#applyKit", root);
  if(!apply.disabled) apply.addEventListener("click", () => applyKit(k));

  function drawItems(){
    const box = $("#kitItems", root);
    if(!k.items.length){
      box.innerHTML = `<p class="hint">Пусто. Нажмите «Добавить позицию» — можно выбрать
        из библиотеки или вписать своё название.</p>`;
      return;
    }
    box.innerHTML = `<div class="list">${k.items.map((i, idx) => {
      const lib = i.libId ? getItem(i.libId) : null;
      return `<div class="item" style="box-shadow:none">
        <div class="top">
          <span class="nm">${esc(i.name)}</span>
          <button class="btn quiet" data-del="${idx}" style="min-height:2.2rem;padding:.2rem .6rem;font-size:.8rem">Убрать</button>
        </div>
        ${lib && lib.tldr ? `<div class="tldr">${esc(lib.tldr)}</div>` : ""}
        ${i.dose ? `<div class="sub">${esc(i.dose)}</div>` : ""}
        ${lib && lib.rx ? `<div class="meta"><span class="tag warn">по рецепту</span></div>` : ""}
      </div>`;
    }).join("")}</div>`;
    box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
      k.items.splice(Number(b.dataset.del), 1);
      save(true); render();
    }));
  }
}

/* ---------- Добавление позиции в набор ---------- */
function pickItem(k, redraw){
  const backEl = document.createElement("div");
  backEl.className = "modal-back";
  backEl.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <h2>Что добавить в набор</h2>
    <div class="searchbar"><span class="si" aria-hidden="true">🔎</span>
      <input type="search" id="kitSearch" placeholder="Название или «от горла»" autocomplete="off"></div>
    <div id="kitResults"></div>
    <div class="mt"><button class="btn quiet wide" data-close>Закрыть</button></div>
  </div>`;

  const inp = backEl.querySelector("#kitSearch");
  const box = backEl.querySelector("#kitResults");
  let t = null;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = inp.value.trim();
      if(q.length < 2){ box.innerHTML = ""; return; }
      const found = searchItems(q).slice(0, 8);
      if(!found.length){
        box.innerHTML = `<div class="btn-col mt">
          <button class="btn wide" data-own="${esc(q)}">Добавить «${esc(q)}» как есть</button></div>`;
        return;
      }
      box.innerHTML = `<div class="btn-col mt">${found.map(r => `
        <button class="pickrow" type="button" data-pick="${esc(r.item.id)}" data-title="${esc(r.title)}">
          <span class="plus" aria-hidden="true">＋</span>
          <span class="pb"><span class="n">${hl(r.title, r.q)}</span>
            <span class="s">${esc(r.item.tldr || itemSubtitle(r.item))}</span></span>
        </button>`).join("")}</div>`;
    }, 180);
  });

  backEl.addEventListener("click", e => {
    if(e.target === backEl || e.target.closest("[data-close]")){ backEl.remove(); return; }

    const own = e.target.closest("[data-own]");
    if(own){
      k.items.push({ libId:null, name:own.dataset.own, dose:"", times:[] });
      save(true); backEl.remove(); toast("Добавлено"); render(); return;
    }

    const b = e.target.closest("[data-pick]");
    if(!b) return;
    const it = getItem(b.dataset.pick);
    if(!it) return;
    const shown = b.dataset.title || it.name;
    const dose = doseHint(it);
    k.items.push({ libId: it.id, name: shown, dose, times: [] });
    save(true); backEl.remove(); toast("Добавлено: " + shown); render();
  });

  document.body.appendChild(backEl);
  inp.focus();
}

/* ---------- Добавление всего набора в назначения ---------- */
async function applyKit(k){
  const existing = profileCourses().map(c => c.name.toLowerCase());
  const fresh = k.items.filter(i => !existing.includes(i.name.toLowerCase()));
  const already = k.items.length - fresh.length;

  if(!fresh.length){
    toast("Всё из этого набора уже есть в назначениях");
    return;
  }

  // Предупреждение о совпадении вещества с тем, что уже принимается
  const combined = profileCourses().map(c => ({name:c.name, libId:c.libId}))
    .concat(fresh.map(i => ({name:i.name, libId:i.libId})));
  const dups = duplicateIngredients(combined);

  const ok = await confirmDialog({
    title: "Добавить в назначения?",
    text: `Будет добавлено ${fresh.length} ${plural(fresh.length,"позиция","позиции","позиций")}: ` +
          fresh.map(i => i.name).join(", ") + "." +
          (already ? ` Ещё ${already} уже есть в назначениях — пропустим.` : "") +
          (dups.length ? "\n\nВнимание: совпадает действующее вещество — " +
            dups.map(d => d.name.toLowerCase() + " (" + d.items.join(", ") + ")").join("; ") + "." : "") +
          " Дату и «для чего» потом можно поправить в каждой карточке.",
    okText: "Добавить"
  });
  if(!ok) return;

  const today = todayISO();
  for(const i of fresh){
    state.data.courses.push({
      id: uid("cs"),
      profileId: state.data.activeProfileId,
      libId: i.libId || null,
      kind: "drug",
      name: i.name,
      dose: i.dose || "",
      times: (i.times && i.times.length) ? i.times.slice() : ["morning"],
      everyN: 1,
      startDate: today,
      endDate: null,
      reason: "из набора «" + k.name + "»",
      doctor: "",
      notes: "",
      archived: false,
      photos: [],
      createdAt: new Date().toISOString()
    });
  }
  save(true);
  toast("Добавлено назначений: " + fresh.length, 3500);
  go("/home");
}
