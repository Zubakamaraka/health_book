/* ===================================================================
   home.js — главная: что принимаем сейчас и отметки приёма
   =================================================================== */

import { state, save, uid, photoPut, photoGet, photoDel, compressImage } from "./store.js";
import { $, $$, esc, go, back, toast, formHead, addFab, confirmDialog,
         profileSwitch, todayISO, shiftISO, fmtDayHeader, fmtDate, fmtDateShort,
         daysBetween, plural, pickImage, viewPhoto, queryParams, render,
         pickDate, dateFieldHTML, bindDateField } from "./ui.js";
import { searchItems, getItem, itemSubtitle, hl, doseHint } from "./library.js";
import { duplicateBanner } from "./kits.js";

/* Времена приёма */
export const TIMES = [
  { id:"morning",  name:"Утро",   icon:"🌅" },
  { id:"day",      name:"День",   icon:"☀️" },
  { id:"evening",  name:"Вечер",  icon:"🌆" },
  { id:"night",    name:"Ночь",   icon:"🌙" },
  { id:"asneeded", name:"По необходимости", icon:"❗" }
];
export const timeName = id => (TIMES.find(t => t.id === id) || {}).name || id;

/* Какой день показываем на главной */
let viewDay = todayISO();

/* Черновик незаконченного назначения.
   Нужен, потому что «Открыть карточку» уводит на другой экран, и при
   возврате форма собиралась заново — всё введённое пропадало.
   Живёт в памяти вкладки, хранится два часа. */
let courseDraft = null;
const DRAFT_TTL = 2 * 60 * 60 * 1000;
export function clearCourseDraft(){ courseDraft = null; }

/* ---------- Вспомогательное ---------- */
export function profileCourses(includeArchived){
  const pid = state.data.activeProfileId;
  return state.data.courses
    .filter(c => c.profileId === pid)
    .filter(c => includeArchived ? true : !c.archived);
}

export function courseActiveOn(c, iso){
  if(c.archived) return false;
  if(c.startDate && iso < c.startDate) return false;
  if(c.endDate && iso > c.endDate) return false;
  if(c.everyN && c.everyN > 1 && c.startDate){
    const d = daysBetween(c.startDate, iso);
    if(d % c.everyN !== 0) return false;
  }
  return true;
}

function intakeFor(iso, courseId){
  const day = state.data.intake[iso];
  return (day && day[courseId]) || {};
}
function setIntake(iso, courseId, timeId, value){
  if(!state.data.intake[iso]) state.data.intake[iso] = {};
  if(!state.data.intake[iso][courseId]) state.data.intake[iso][courseId] = {};
  if(value) state.data.intake[iso][courseId][timeId] = true;
  else delete state.data.intake[iso][courseId][timeId];
  if(!Object.keys(state.data.intake[iso][courseId]).length) delete state.data.intake[iso][courseId];
  if(!Object.keys(state.data.intake[iso]).length) delete state.data.intake[iso];
  save();
}

export function courseSchedule(c){
  const t = (c.times || []).map(timeName).join(", ");
  let freq = "";
  if(c.everyN && c.everyN > 1) freq = " · каждые " + c.everyN + " " + plural(c.everyN, "день","дня","дней");
  return (t || "без расписания") + freq;
}

/* ===================================================================
   Экран: главная
   =================================================================== */
export function screenHome(root){
  const isToday = viewDay === todayISO();
  const courses = profileCourses().filter(c => courseActiveOn(c, viewDay));
  const scheduled = courses.filter(c => (c.times||[]).some(t => t !== "asneeded"));
  const onDemand  = courses.filter(c => (c.times||[]).length === 1 && c.times[0] === "asneeded");

  const total = scheduled.reduce((s,c) => s + (c.times||[]).filter(t=>t!=="asneeded").length, 0);
  let done = 0;
  scheduled.forEach(c => {
    const st = intakeFor(viewDay, c.id);
    (c.times||[]).forEach(t => { if(t !== "asneeded" && st[t]) done++; });
  });

  root.innerHTML = `
    <h1 class="screen-title">Мои назначения</h1>
    ${profileSwitch()}

    <div class="mnav" style="display:flex;align-items:center;gap:.6rem;margin:.2rem 0 .9rem">
      <button class="hbtn" id="dayPrev" aria-label="Предыдущий день" style="min-width:3rem;min-height:3rem;font-size:1.3rem">‹</button>
      <button class="hbtn" id="dayPick" style="flex:1;min-height:3rem;font-family:Georgia,serif;font-size:1.05rem;border-color:var(--line)"
              aria-label="Выбрать дату в календаре">📅 ${esc(fmtDayHeader(viewDay))}</button>
      <button class="hbtn" id="dayNext" aria-label="Следующий день" ${isToday ? "disabled" : ""} style="min-width:3rem;min-height:3rem;font-size:1.3rem">›</button>
    </div>
    ${!isToday ? `<div class="center mb"><button class="btn quiet" id="dayToday">Вернуться к сегодня</button></div>` : ""}

    ${duplicateBanner(profileCourses())}

    ${total ? `<div class="panel accent flat" style="padding:.75rem .9rem">
      <b>Принято ${done} из ${total}</b>
      <div class="hint" style="margin-top:.2rem">${done >= total ? "Всё на сегодня выполнено 👍" : "Отмечайте приём кнопками ниже"}</div>
    </div>` : ""}

    <div id="courseList"></div>
    ${onDemand.length ? `<h2 class="screen-title" style="font-size:1.15rem;margin-top:1.2rem">По необходимости</h2>
      <div id="onDemandList"></div>` : ""}

    <div class="btn-row mt">
      <button class="btn" id="kitsBtn">📦 Мои наборы</button>
      <button class="btn quiet" id="archBtn">Завершённые</button>
    </div>
  `;

  $("#dayPrev", root).addEventListener("click", () => { viewDay = shiftISO(viewDay, -1); render(); });
  $("#dayPick", root).addEventListener("click", async () => {
    const v = await pickDate({ value: viewDay, max: todayISO() });
    if(v){ viewDay = v; render(); }
  });
  const nx = $("#dayNext", root);
  if(!nx.disabled) nx.addEventListener("click", () => { viewDay = shiftISO(viewDay, 1); render(); });
  const td = $("#dayToday", root);
  if(td) td.addEventListener("click", () => { viewDay = todayISO(); render(); });
  $("#archBtn", root).addEventListener("click", () => go("/home/archive"));
  $("#kitsBtn", root).addEventListener("click", () => go("/home/kits"));

  drawList($("#courseList", root), scheduled, false);
  if(onDemand.length) drawList($("#onDemandList", root), onDemand, true);

  addFab("Добавить", () => go("/home/course/new"));

  function drawList(box, list, onDemandMode){
    if(!list.length){
      box.innerHTML = `<div class="empty"><span class="big">💊</span>
        <p><b>На этот день назначений нет</b></p>
        <p class="hint">Нажмите «Добавить», чтобы записать лекарство или процедуру —
        из библиотеки или своё.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="list">${list.map(c => courseCard(c, onDemandMode)).join("")}</div>`;

    box.querySelectorAll("[data-open]").forEach(b => {
      b.addEventListener("click", () => go("/home/course/" + encodeURIComponent(b.dataset.open)));
    });
    box.querySelectorAll("[data-dose]").forEach(b => {
      b.addEventListener("click", () => {
        const [cid, tid] = b.dataset.dose.split("|");
        const on = b.getAttribute("aria-pressed") === "true";
        setIntake(viewDay, cid, tid, !on);
        render();
      });
    });
  }

  function courseCard(c, onDemandMode){
    const st = intakeFor(viewDay, c.id);
    const times = (c.times||[]);
    const shown = onDemandMode ? times : times.filter(t => t !== "asneeded");
    const lib = c.libId ? getItem(c.libId) : null;
    const days = c.startDate ? daysBetween(c.startDate, viewDay) + 1 : null;

    return `<div class="item">
      <button type="button" data-open="${esc(c.id)}" style="all:unset;display:block;width:100%;cursor:pointer">
        <div class="top"><span class="nm">${c.kind === "procedure" ? "🩺 " : "💊 "}${esc(c.name)}</span></div>
        ${lib && lib.tldr ? `<div class="tldr">${esc(lib.tldr)}</div>` : ""}
        ${c.dose ? `<div class="sub">${esc(c.dose)}</div>` : ""}
        ${c.reason ? `<div class="sub">Для чего: ${esc(c.reason)}</div>` : ""}
        <div class="meta">
          ${c.startDate ? `<span class="tag">с ${esc(fmtDateShort(c.startDate))}${days && days>0 ? ` · ${days}-й день` : ""}</span>` : ""}
          ${c.endDate ? `<span class="tag warn">до ${esc(fmtDateShort(c.endDate))}</span>` : ""}
          ${c.everyN > 1 ? `<span class="tag">через ${c.everyN-1} ${plural(c.everyN-1,"день","дня","дней")}</span>` : ""}
          ${lib && lib.rx ? `<span class="tag warn">по рецепту</span>` : ""}
        </div>
      </button>
      <div class="doserow">
        ${shown.map(t => {
          const info = TIMES.find(x => x.id === t) || {name:t, icon:"•"};
          return `<button type="button" class="dose" data-dose="${esc(c.id)}|${esc(t)}"
            aria-pressed="${!!st[t]}" aria-label="${esc(info.name)}: ${st[t]?"принято":"не принято"}">
            <span class="ic">${info.icon}</span><span>${esc(info.name)}</span></button>`;
        }).join("")}
      </div>
    </div>`;
  }
}

/* ===================================================================
   Экран: карточка назначения
   =================================================================== */
export function screenCourse(root, params){
  const c = state.data.courses.find(x => x.id === params.id);
  if(!c){ go("/home", true); return; }
  const lib = c.libId ? getItem(c.libId) : null;

  root.innerHTML = formHead(c.name) + `
    <div class="panel">
      <div class="meta mb">
        <span class="tag">${c.kind === "procedure" ? "🩺 процедура" : "💊 лекарство"}</span>
        ${c.archived ? `<span class="tag">завершено</span>` : `<span class="tag ok">принимается</span>`}
        ${lib && lib.rx ? `<span class="tag warn">по рецепту</span>` : ""}
      </div>
      ${row("Доза и как принимать", c.dose)}
      ${row("Когда", courseSchedule(c))}
      ${row("Дата назначения", c.startDate ? fmtDate(c.startDate) : "")}
      ${row("До какой даты", c.endDate ? fmtDate(c.endDate) : "не ограничено")}
      ${row("Для чего назначено", c.reason)}
      ${row("Кто назначил", c.doctor)}
      ${row("Примечания", c.notes)}
    </div>

    ${lib ? `<div class="panel">
      <h2>Из библиотеки</h2>
      <p><b>${esc(lib.name)}</b>${lib.tldr ? `<br><span class="tldr">${esc(lib.tldr)}</span>` : ""}
        ${itemSubtitle(lib) ? `<br><span class="hint">${esc(itemSubtitle(lib))}</span>` : ""}</p>
      <div class="mt"><button class="btn wide" id="openLib">Открыть карточку в библиотеке</button></div>
    </div>` : `<div class="panel">
      <h2>Нет в библиотеке</h2>
      <p class="hint">Это назначение записано просто по названию — и так тоже можно.
         Если завести карточку, в следующий раз название подставится само,
         а сведения о препарате будут под рукой.</p>
      <div class="mt"><button class="btn wide" id="makeLib">＋ Завести карточку в библиотеке</button></div>
    </div>`}

    <div class="panel">
      <h2>Фотографии</h2>
      <p class="hint">Упаковка, рецепт, назначение врача — чтобы не искать бумажку.</p>
      <div class="photos" id="photoBox"></div>
    </div>

    <div class="panel">
      <h2>История приёма</h2>
      <div id="intakeHist"></div>
    </div>

    <div class="btn-col mt">
      <button class="btn wide" id="editBtn">✏️ Изменить</button>
      <button class="btn wide" id="archBtn">${c.archived ? "↩️ Вернуть в текущие" : "✅ Завершить приём"}</button>
      <button class="btn danger wide" id="delBtn">Удалить назначение</button>
    </div>
  `;

  function row(k, v){
    if(!v) return "";
    return `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
  }

  const ol = $("#openLib", root);
  if(ol) ol.addEventListener("click", () => go("/library/item/" + encodeURIComponent(c.libId)));

  const ml = $("#makeLib", root);
  if(ml) ml.addEventListener("click", () => {
    go("/library/new?name=" + encodeURIComponent(c.name) + "&link=" + encodeURIComponent(c.id));
  });

  $("#editBtn", root).addEventListener("click", () => go("/home/course/edit/" + encodeURIComponent(c.id)));

  $("#archBtn", root).addEventListener("click", async () => {
    if(!c.archived){
      const ok = await confirmDialog({title:"Завершить приём?",
        text:"Назначение уйдёт в «Завершённые». Все записи и отметки сохранятся.", okText:"Завершить"});
      if(!ok) return;
      c.archived = true;
      if(!c.endDate) c.endDate = todayISO();
    }else{
      c.archived = false;
      c.endDate = null;
    }
    save(true); render();
  });

  $("#delBtn", root).addEventListener("click", async () => {
    const ok = await confirmDialog({title:"Удалить назначение?",
      text:"Вместе с ним удалятся отметки приёма и прикреплённые фотографии. Отменить нельзя.",
      okText:"Удалить", danger:true});
    if(!ok) return;
    for(const pid of (c.photos||[])) await photoDel(pid);
    Object.keys(state.data.intake).forEach(day => {
      if(state.data.intake[day][c.id]) delete state.data.intake[day][c.id];
      if(!Object.keys(state.data.intake[day]).length) delete state.data.intake[day];
    });
    state.data.courses = state.data.courses.filter(x => x.id !== c.id);
    save(true); toast("Удалено"); back("/home");
  });

  drawPhotos(c, $("#photoBox", root));
  drawIntakeHistory(c, $("#intakeHist", root));
}

async function drawPhotos(owner, box){
  box.innerHTML = "";
  for(const pid of (owner.photos || [])){
    const url = await photoGet(pid);
    if(!url) continue;
    const b = document.createElement("button");
    b.type = "button"; b.className = "ph";
    b.innerHTML = `<img src="${url}" alt="Фотография">`;
    b.addEventListener("click", () => viewPhoto(url, async () => {
      await photoDel(pid);
      owner.photos = owner.photos.filter(x => x !== pid);
      save(true);
      drawPhotos(owner, box);
      toast("Фотография удалена");
    }));
    box.appendChild(b);
  }
  const add = document.createElement("button");
  add.type = "button"; add.className = "add";
  add.innerHTML = `<span class="big" aria-hidden="true">📷</span><span>Добавить</span>`;
  add.addEventListener("click", async () => {
    const f = await pickImage();
    if(!f) return;
    toast("Сохраняю снимок…");
    try{
      const dataUrl = await compressImage(f);
      const id = uid("ph");
      await photoPut(id, dataUrl, {owner: owner.id});
      if(!owner.photos) owner.photos = [];
      owner.photos.push(id);
      save(true);
      drawPhotos(owner, box);
      toast("Фотография добавлена");
    }catch(e){
      toast("Не удалось сохранить снимок");
    }
  });
  box.appendChild(add);
}

function drawIntakeHistory(c, box){
  const days = Object.keys(state.data.intake).filter(d => state.data.intake[d][c.id]).sort().reverse();
  if(!days.length){ box.innerHTML = `<p class="hint">Отметок пока нет.</p>`; return; }
  const last = days.slice(0, 14);
  box.innerHTML = last.map(d => {
    const st = state.data.intake[d][c.id] || {};
    const marks = Object.keys(st).map(t => (TIMES.find(x=>x.id===t)||{}).icon || "•").join(" ");
    return `<div class="kv"><span class="k">${esc(fmtDateShort(d))}</span><span class="v">${marks}</span></div>`;
  }).join("") + (days.length > 14 ? `<p class="hint mt">Показаны последние 14 дней из ${days.length}.</p>` : "");
}

/* ===================================================================
   Экран: завершённые назначения
   =================================================================== */
export function screenArchive(root){
  const list = profileCourses(true).filter(c => c.archived)
    .sort((a,b) => String(b.endDate||"").localeCompare(String(a.endDate||"")));
  root.innerHTML = formHead("Завершённые назначения") + (
    list.length ? `<div class="list">${list.map(c => `
      <button class="item" type="button" data-open="${esc(c.id)}">
        <div class="top"><span class="nm">${esc(c.name)}</span></div>
        ${c.dose ? `<div class="sub">${esc(c.dose)}</div>` : ""}
        <div class="meta">
          ${c.startDate ? `<span class="tag">${esc(fmtDateShort(c.startDate))}${c.endDate ? " — " + esc(fmtDateShort(c.endDate)) : ""}</span>` : ""}
        </div>
      </button>`).join("")}</div>`
    : `<div class="empty"><span class="big">📦</span><p>Здесь пока пусто.</p>
       <p class="hint">Сюда попадают назначения, приём которых вы завершили.</p></div>`
  );
  root.querySelectorAll("[data-open]").forEach(b => {
    b.addEventListener("click", () => go("/home/course/" + encodeURIComponent(b.dataset.open)));
  });
}

/* ===================================================================
   Экран: форма назначения

   Форма разбита на шаги, потому что главная сложность для пожилого
   человека — не поля, а непонимание, что список под поиском нужно
   нажать. Поэтому: явный «Шаг 1», строки результатов с плюсом,
   а после выбора — зелёная карточка «выбрано» и автозаполнение дозы.
   =================================================================== */
export function screenCourseForm(root, params){
  const editing = !!params.id;
  const src = editing ? state.data.courses.find(x => x.id === params.id) : null;
  if(editing && !src){ go("/home", true); return; }

  const q = queryParams();
  const preLib = !editing && q.lib ? getItem(q.lib) : null;

  // Черновик восстанавливаем только для нового назначения и только если
  // не пришли из карточки конкретного лекарства (там намерение свежее).
  const draft = (!editing && !preLib && courseDraft &&
                 (Date.now() - courseDraft.at) < DRAFT_TTL) ? courseDraft : null;
  const restored = !!draft;

  const v = {
    libId:  src ? src.libId : (preLib ? preLib.id : (draft ? draft.libId : null)),
    kind:   src ? src.kind  : (preLib ? preLib.kind : (draft ? draft.kind : "drug")),
    name:   src ? src.name  : (preLib ? preLib.name : (draft ? draft.name : "")),
    dose:   src ? src.dose  : (draft ? draft.dose : ""),
    times:  src ? (src.times || []).slice() : (draft ? draft.times.slice() : ["morning"]),
    everyN: src ? (src.everyN || 1) : (draft ? draft.everyN : 1),
    startDate: src ? src.startDate : (draft ? draft.startDate : todayISO()),
    endDate:   src ? (src.endDate || "") : (draft ? draft.endDate : ""),
    reason: src ? src.reason : (draft ? draft.reason : ""),
    doctor: src ? src.doctor : (draft ? draft.doctor : ""),
    notes:  src ? src.notes  : (draft ? draft.notes : ""),
    pickedName: draft ? draft.pickedName : (preLib ? preLib.name : "")
  };

  root.innerHTML = formHead(editing ? "Изменить назначение" : "Новое назначение") + `
    <form id="cForm" novalidate>

      ${restored ? `<div class="banner" id="draftBanner">
        <span class="bi">📝</span>
        <span class="bt">Здесь остался незаконченный черновик — продолжайте с того же места.</span>
        <button type="button" class="btn quiet" id="draftClear" style="min-height:2.4rem;flex:0 0 auto">Начать заново</button>
      </div>` : ""}

      ${editing ? "" : `
      <div class="step" id="step1">
        <div class="sh"><span class="n">1</span><span class="t">Что назначено</span></div>

        <div id="pickedBox"></div>

        <div id="pickArea">
          <div class="searchbar" style="margin-bottom:.5rem">
            <span class="si" aria-hidden="true">🔎</span>
            <input type="search" id="pickSearch" placeholder="Начните вводить: амос, кетон, давление…"
                   autocomplete="off" enterkeyhint="search">
          </div>
          <p class="hint">Нажмите на найденную строку — название и дозировки подставятся сами.
             <b>Если такого нет в библиотеке — ничего страшного:</b> впишите название
             в поле «Название» ниже и сохраняйте. Заводить карточку в библиотеке не обязательно.</p>
          <div id="pickResults"></div>
        </div>
      </div>`}

      <div class="step">
        <div class="sh"><span class="n">${editing ? "•" : "2"}</span><span class="t">Название и доза</span></div>

        <div class="field">
          <label for="cName">Название <span class="req">*</span></label>
          <input type="text" id="cName" value="${esc(v.name)}" required placeholder="Например: Амосин">
          <div id="libLink" class="hint" style="margin-top:.3rem">${
            v.libId ? "Связано с библиотекой" : ""
          }</div>
        </div>

        <div class="field">
          <span class="field-label">Тип</span>
          <div class="chips" id="cKind">
            <button type="button" class="chip ${v.kind==="drug"?"on":""}" data-k="drug">💊 Лекарство</button>
            <button type="button" class="chip ${v.kind==="procedure"?"on":""}" data-k="procedure">🩺 Процедура</button>
          </div>
        </div>

        <div class="field">
          <label for="cDose">Доза и как принимать</label>
          <div class="sub">Например: 1 таблетка 500 мг, после еды</div>
          <input type="text" id="cDose" value="${esc(v.dose)}">
          <div class="presets mt" id="dosePresets"></div>
        </div>
      </div>

      <div class="step">
        <div class="sh"><span class="n">${editing ? "•" : "3"}</span><span class="t">Когда и как долго</span></div>

        <div class="field">
          <span class="field-label">Когда принимать <span class="req">*</span></span>
          <div class="chips" id="cTimes">
            ${TIMES.map(t => `<button type="button" class="chip ${v.times.includes(t.id)?"on":""}"
              data-t="${t.id}" aria-pressed="${v.times.includes(t.id)}">${t.icon} ${esc(t.name)}</button>`).join("")}
          </div>
        </div>

        <div class="field">
          <span class="field-label">Как часто</span>
          <div class="chips" id="cFreq">
            <button type="button" class="chip ${v.everyN===1?"on":""}" data-n="1">Каждый день</button>
            <button type="button" class="chip ${v.everyN===2?"on":""}" data-n="2">Через день</button>
            <button type="button" class="chip ${v.everyN===3?"on":""}" data-n="3">Раз в 3 дня</button>
            <button type="button" class="chip ${v.everyN===7?"on":""}" data-n="7">Раз в неделю</button>
          </div>
        </div>

        ${dateFieldHTML("cStart", v.startDate, {label:"Дата назначения", required:true})}
        ${dateFieldHTML("cEnd", v.endDate, {label:"До какой даты", sub:"Можно не указывать", empty:"не ограничено"})}
        <div class="btn-row" style="margin-top:-.4rem">
          <button type="button" class="btn quiet" id="cEndClear" style="min-height:2.5rem">Убрать дату окончания</button>
        </div>
      </div>

      <div class="step">
        <div class="sh"><span class="n">${editing ? "•" : "4"}</span><span class="t">Для чего и кто назначил</span></div>

        <div class="field">
          <label for="cReason">Для чего назначено <span class="req">*</span></label>
          <div class="sub">Своими словами — так, как объяснил врач.</div>
          <textarea id="cReason" required placeholder="Например: от воспаления, по назначению терапевта">${esc(v.reason)}</textarea>
        </div>

        <div class="field">
          <label for="cDoctor">Кто назначил</label>
          <input type="text" id="cDoctor" value="${esc(v.doctor)}" placeholder="Терапевт, кардиолог, фамилия…">
        </div>

        <div class="field">
          <label for="cNotes">Примечания</label>
          <textarea id="cNotes">${esc(v.notes)}</textarea>
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

  /* --- даты через календарь --- */
  const startF = bindDateField(root, "cStart", {onChange: () => snapDraft()});
  const endF   = bindDateField(root, "cEnd", {empty:"не ограничено", onChange: () => snapDraft()});
  $("#cEndClear", root).addEventListener("click", () => { endF.clear(); snapDraft(); toast("Дата окончания убрана"); });

  /* --- черновик --- */
  function snapDraft(){
    if(editing) return;
    const g = id => { const el = $("#" + id, root); return el ? el.value : ""; };
    courseDraft = {
      at: Date.now(),
      libId: v.libId, kind: v.kind,
      times: v.times.slice(), everyN: v.everyN,
      name: g("cName"), dose: g("cDose"), reason: g("cReason"),
      doctor: g("cDoctor"), notes: g("cNotes"),
      startDate: startF.get(), endDate: endF.get(),
      pickedName: v.pickedName || ""
    };
  }
  if(!editing){
    const form0 = $("#cForm", root);
    form0.addEventListener("input", snapDraft);
    form0.addEventListener("change", snapDraft);
    const clr = $("#draftClear", root);
    if(clr) clr.addEventListener("click", () => {
      courseDraft = null;
      go("/home/course/new", true);
      render();
      toast("Форма очищена");
    });
  }

  /* --- выбор из библиотеки --- */
  function showPicked(it, shownName){
    const pb = $("#pickedBox", root);
    const pa = $("#pickArea", root);
    if(!pb) return;
    if(!it){ pb.innerHTML = ""; if(pa) pa.hidden = false; return; }
    const title = shownName || it.name;
    const sub = [title !== it.name ? "= " + it.name : "", itemSubtitle(it)].filter(Boolean).join(" · ");
    pb.innerHTML = `<div class="picked">
        <span class="pi" aria-hidden="true">✅</span>
        <span class="pt"><b>${esc(title)}</b>
          ${sub ? `<span class="s">${esc(sub)}</span>` : ""}</span>
      </div>
      <div class="btn-row mt">
        <button type="button" class="btn quiet" id="pickAgain" style="min-height:2.6rem">Выбрать другое</button>
        <button type="button" class="btn quiet" id="pickOpen" style="min-height:2.6rem">Открыть карточку</button>
      </div>`;
    if(pa) pa.hidden = true;
    $("#pickAgain", root).addEventListener("click", () => {
      v.libId = null; v.pickedName = "";
      snapDraft();
      $("#libLink", root).textContent = "";
      showPicked(null);
      const inp = $("#pickSearch", root);
      if(inp){ inp.value = ""; inp.focus(); }
      const box = $("#pickResults", root); if(box) box.innerHTML = "";
    });
    $("#pickOpen", root).addEventListener("click", () => go("/library/item/" + encodeURIComponent(it.id)));
  }

  function applyPick(it, typedTitle){
    // В название подставляем ровно то, что человек нашёл: если он искал
    // «Амосин», в назначении и в списке покупок должен быть «Амосин»,
    // а связь с библиотекой всё равно ведёт на амоксициллин.
    v.libId = it.id; v.kind = it.kind;
    const shown = typedTitle && typedTitle !== it.name ? typedTitle : it.name;
    $("#cName", root).value = shown;
    $("#libLink", root).textContent = shown === it.name
      ? "Связано с библиотекой"
      : "Связано с библиотекой: " + it.name;
    root.querySelectorAll("#cKind .chip").forEach(c => c.classList.toggle("on", c.dataset.k === v.kind));
    fillDosePresets(it);
    // Автоподстановка дозы: если поле пустое, подставляем первую дозировку
    const dose = $("#cDose", root);
    if(!dose.value.trim()) dose.value = doseHint(it);
    if(it.kind === "procedure"){
      const s = $("#step1", root);
      if(s) s.classList.add("done");
    }
    v.pickedName = shown;
    showPicked(it, shown);
    snapDraft();
    toast("Выбрано: " + shown);
  }

  const pick = $("#pickSearch", root);
  if(pick){
    let t = null;
    const box = $("#pickResults", root);
    pick.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const qq = pick.value.trim();
        if(qq.length < 2){ box.innerHTML = ""; return; }
        const found = searchItems(qq).slice(0, 8);
        if(!found.length){
          box.innerHTML = `<p class="hint mt">В библиотеке такого нет — и это нормально.</p>
            <div class="btn-col mt">
              <button type="button" class="btn primary wide" id="useTyped">Записать «${esc(qq)}» как есть</button>
              <button type="button" class="btn wide" id="toLib">＋ Завести «${esc(qq)}» в библиотеке</button>
            </div>
            <p class="hint mt">«Как есть» — самый быстрый путь: название попадёт в назначение,
               библиотеку заполнять не обязательно.</p>`;
          $("#useTyped", root).addEventListener("click", () => {
            $("#cName", root).value = qq;
            v.libId = null;
            v.pickedName = "";
            $("#libLink", root).textContent = "Записано как своё название";
            box.innerHTML = ""; pick.value = "";
            snapDraft();
            toast("Название записано");
            $("#cDose", root).focus();
          });
          $("#toLib", root).addEventListener("click", () => {
            go("/library/new?name=" + encodeURIComponent(qq) + "&then=course");
          });
          return;
        }
        box.innerHTML =
          (found[0].fuzzy ? `<p class="hint mt">Точного совпадения нет, возможно вы искали:</p>` : "") +
          `<div class="btn-col mt">${found.map(r => `
            <button class="pickrow" type="button" data-pick="${esc(r.item.id)}">
              <span class="plus" aria-hidden="true">＋</span>
              <span class="pb">
                <span class="n">${hl(r.title, r.q)}</span>
                ${r.alias || itemSubtitle(r.item)
                  ? `<span class="s">${esc([r.alias ? "= " + r.item.name : "", itemSubtitle(r.item)].filter(Boolean).join(" · "))}</span>`
                  : ""}
              </span>
            </button>`).join("")}</div>`;
        box.querySelectorAll("[data-pick]").forEach((b, idx) => {
          const r = found[idx];
          b.addEventListener("click", () => {
            applyPick(getItem(b.dataset.pick), r.title);
            box.innerHTML = ""; pick.value = "";
          });
        });
      }, 180);
    });
  }

  function fillDosePresets(it){
    const box = $("#dosePresets", root);
    if(!box) return;
    const doses = (it && it.doses) || [];
    if(!doses.length){ box.innerHTML = ""; return; }
    box.innerHTML = `<span class="hint" style="width:100%">Подставить дозировку:</span>` +
      doses.slice(0,8).map(d => `<button type="button" class="p" data-dp="${esc(d)}">${esc(d)}</button>`).join("");
    box.querySelectorAll("[data-dp]").forEach(b => {
      b.addEventListener("click", () => {
        const inp = $("#cDose", root);
        inp.value = doseHint(it, b.dataset.dp);
        inp.focus();
      });
    });
  }

  if(v.libId){
    const it = getItem(v.libId);
    if(it){ fillDosePresets(it); if(!editing) showPicked(it, v.pickedName || it.name); }
  }

  /* --- переключатели --- */
  root.querySelector("#cKind").addEventListener("click", e => {
    const b = e.target.closest("[data-k]"); if(!b) return;
    v.kind = b.dataset.k;
    root.querySelectorAll("#cKind .chip").forEach(c => c.classList.toggle("on", c.dataset.k === v.kind));
    snapDraft();
  });

  root.querySelector("#cTimes").addEventListener("click", e => {
    const b = e.target.closest("[data-t]"); if(!b) return;
    const id = b.dataset.t;
    if(v.times.includes(id)) v.times = v.times.filter(x => x !== id);
    else v.times.push(id);
    b.classList.toggle("on", v.times.includes(id));
    b.setAttribute("aria-pressed", String(v.times.includes(id)));
    snapDraft();
  });

  root.querySelector("#cFreq").addEventListener("click", e => {
    const b = e.target.closest("[data-n]"); if(!b) return;
    v.everyN = Number(b.dataset.n);
    root.querySelectorAll("#cFreq .chip").forEach(c => c.classList.toggle("on", Number(c.dataset.n) === v.everyN));
    snapDraft();
  });

  /* --- сохранение --- */
  $("#cForm", root).addEventListener("submit", e => {
    e.preventDefault();
    const name = $("#cName", root).value.trim();
    const reason = $("#cReason", root).value.trim();
    const startDate = startF.get();

    if(!name){ toast("Впишите название"); $("#cName", root).focus(); return; }
    if(!v.times.length){ toast("Отметьте, когда принимать"); return; }
    if(!startDate){ toast("Укажите дату назначения"); return; }
    if(!reason){ toast("Напишите, для чего назначено"); $("#cReason", root).focus(); return; }

    const endDate = endF.get() || null;
    if(endDate && endDate < startDate){ toast("Дата окончания раньше даты назначения"); return; }

    const payload = {
      libId: v.libId || null,
      kind: v.kind,
      name,
      dose: $("#cDose", root).value.trim(),
      times: v.times.slice(),
      everyN: v.everyN,
      startDate,
      endDate,
      reason,
      doctor: $("#cDoctor", root).value.trim(),
      notes: $("#cNotes", root).value.trim()
    };

    if(editing){
      Object.assign(src, payload);
      save(true); toast("Сохранено");
      go("/home/course/" + encodeURIComponent(src.id), true);
    }else{
      const c = Object.assign({
        id: uid("cs"),
        profileId: state.data.activeProfileId,
        archived: false,
        photos: [],
        createdAt: new Date().toISOString()
      }, payload);
      state.data.courses.push(c);
      courseDraft = null;
      save(true); toast("Назначение добавлено");
      go("/home/course/" + encodeURIComponent(c.id), true);
    }
  });
}
