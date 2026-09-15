/* ===================================================================
   diary.js — дневник здоровья: показатели, ввод, графики

   Важно: приложение показывает цифры и справочные границы нормы,
   но не ставит диагнозов и не даёт заключений. Это делает врач.
   =================================================================== */

import { state, save, uid } from "./store.js";
import { $, esc, go, back, toast, formHead, confirmDialog, profileSwitch,
         todayISO, nowHM, fmtDate, fmtDateShort, fmtDayHeader, stepper,
         render, plural, dateFieldHTML, bindDateField } from "./ui.js";

/* Русское оформление числа: разделитель — запятая */
export function nf(v, dec){
  const n = Number(v);
  if(!isFinite(n)) return "—";
  return (dec ? n.toFixed(dec) : String(Math.round(n))).replace(".", ",");
}

/* ---------- Описание показателей ---------- */
export const METRICS = {
  bp: {
    id:"bp", name:"Давление", icon:"🫀", unit:"мм рт. ст.",
    fields:[
      { key:"sys",   label:"Верхнее (систолическое)", min:70, max:240, step:1, dec:0, def:120, unit:"мм рт. ст.", norm:[100,140] },
      { key:"dia",   label:"Нижнее (диастолическое)", min:40, max:150, step:1, dec:0, def:80,  unit:"мм рт. ст.", norm:[60,90] },
      { key:"pulse", label:"Пульс",                   min:30, max:200, step:1, dec:0, def:70,  unit:"уд/мин",     norm:[60,90] }
    ],
    format: v => `${v.sys}/${v.dia}` + (v.pulse ? ` · пульс ${v.pulse}` : ""),
    chart: "bp"
  },
  temp: {
    id:"temp", name:"Температура", icon:"🌡️", unit:"°C",
    fields:[{ key:"t", label:"Температура", min:34, max:42.5, step:0.1, dec:1, def:36.6, unit:"°C", norm:[36.0,37.0] }],
    format: v => `${nf(v.t,1)} °C`,
    chart: "line"
  },
  weight: {
    id:"weight", name:"Вес", icon:"⚖️", unit:"кг",
    fields:[{ key:"w", label:"Вес", min:25, max:250, step:0.1, dec:1, def:70, unit:"кг" }],
    format: v => `${nf(v.w,1)} кг`,
    chart: "line"
  },
  height: {
    id:"height", name:"Рост", icon:"📏", unit:"см",
    fields:[{ key:"h", label:"Рост", min:100, max:230, step:1, dec:0, def:170, unit:"см" }],
    format: v => `${v.h} см`,
    chart: "line"
  },
  sugar: {
    id:"sugar", name:"Сахар крови", icon:"🍬", unit:"ммоль/л",
    fields:[{ key:"s", label:"Глюкоза", min:1, max:35, step:0.1, dec:1, def:5.5, unit:"ммоль/л", norm:[4.0,6.1] }],
    format: v => `${nf(v.s,1)} ммоль/л`,
    chart: "line"
  },
  spo2: {
    id:"spo2", name:"Сатурация", icon:"🫁", unit:"%",
    fields:[{ key:"o", label:"Насыщение кислородом", min:60, max:100, step:1, dec:0, def:97, unit:"%", norm:[95,100] }],
    format: v => `${v.o} %`,
    chart: "line"
  },
  body: {
    id:"body", name:"Обхваты", icon:"📐", unit:"см",
    fields:[
      { key:"chest", label:"Грудь",  min:40, max:200, step:0.5, dec:1, def:95, unit:"см" },
      { key:"waist", label:"Талия",  min:40, max:200, step:0.5, dec:1, def:85, unit:"см" },
      { key:"belly", label:"Живот",  min:40, max:200, step:0.5, dec:1, def:90, unit:"см" },
      { key:"hips",  label:"Бёдра",  min:40, max:200, step:0.5, dec:1, def:98, unit:"см" }
    ],
    optionalFields: true,
    format: v => ["chest","waist","belly","hips"]
      .filter(k => v[k] != null)
      .map(k => ({chest:"грудь",waist:"талия",belly:"живот",hips:"бёдра"})[k] + " " + nf(v[k],1))
      .join(", ") || "—",
    chart: "body"
  }
};
export const METRIC_ORDER = ["bp","temp","weight","sugar","spo2","body","height"];

export const MOODS = [
  { id:"good",  icon:"🙂", name:"Хорошо" },
  { id:"soso",  icon:"😐", name:"Так себе" },
  { id:"bad",   icon:"🙁", name:"Плохо" }
];

/* ---------- Выборки ---------- */
export function measurements(type, opts={}){
  const pid = state.data.activeProfileId;
  let list = state.data.measurements.filter(m => m.profileId === pid);
  if(type) list = list.filter(m => m.type === type);
  if(opts.from) list = list.filter(m => m.date >= opts.from);
  if(opts.to)   list = list.filter(m => m.date <= opts.to);
  return list.sort((a,b) => (a.date + (a.time||"")).localeCompare(b.date + (b.time||"")));
}
export function lastMeasurement(type){
  const l = measurements(type);
  return l.length ? l[l.length-1] : null;
}
export function dayNotes(opts={}){
  const pid = state.data.activeProfileId;
  let list = state.data.dayNotes.filter(n => n.profileId === pid);
  if(opts.from) list = list.filter(n => n.date >= opts.from);
  if(opts.to)   list = list.filter(n => n.date <= opts.to);
  return list.sort((a,b) => b.date.localeCompare(a.date));
}

/* Оценка попадания в справочную норму: "ok" | "warn" | null */
export function normStatus(type, values){
  const m = METRICS[type];
  if(!m) return null;
  let anyOut = false, anyNorm = false;
  for(const f of m.fields){
    if(!f.norm || values[f.key] == null) continue;
    anyNorm = true;
    const v = Number(values[f.key]);
    if(v < f.norm[0] || v > f.norm[1]) anyOut = true;
  }
  if(!anyNorm) return null;
  return anyOut ? "warn" : "ok";
}

/* ===================================================================
   Экран: дневник (плитки показателей)
   =================================================================== */
export function screenDiary(root){
  root.innerHTML = `
    <h1 class="screen-title">Дневник здоровья</h1>
    ${profileSwitch()}
    <p class="screen-sub">Нажмите на показатель, чтобы записать или посмотреть график.</p>
    <div class="metric-grid" id="mgrid"></div>

    <div class="panel mt">
      <h2>📝 Самочувствие за день</h2>
      <div id="notesBox"></div>
      <div class="mt"><button class="btn primary wide" id="addNote">Записать, как себя чувствую</button></div>
    </div>

    <div class="mt">
      <button class="btn big wide" id="reportBtn">📄 Отчёт для врача</button>
    </div>
  `;

  const grid = $("#mgrid", root);
  grid.innerHTML = METRIC_ORDER.map(k => {
    const m = METRICS[k];
    const last = lastMeasurement(k);
    const st = last ? normStatus(k, last.values) : null;
    return `<button class="metric" type="button" data-m="${k}">
      <span class="mi" aria-hidden="true">${m.icon}</span>
      <span class="mn">${esc(m.name)}</span>
      <span class="mv">${last ? esc(m.format(last.values)) : "—"}</span>
      <span class="md">${last ? esc(fmtDateShort(last.date)) + (last.time ? " " + esc(last.time) : "") : "нет записей"}</span>
      ${st ? `<span class="meta"><span class="tag ${st === "ok" ? "ok" : "warn"}">${st === "ok" ? "в пределах нормы" : "вне справочных границ"}</span></span>` : ""}
    </button>`;
  }).join("");
  grid.querySelectorAll("[data-m]").forEach(b => {
    b.addEventListener("click", () => go("/diary/type/" + b.dataset.m));
  });

  const notes = dayNotes().slice(0, 5);
  $("#notesBox", root).innerHTML = notes.length
    ? `<div class="list">${notes.map(n => {
        const mood = MOODS.find(x => x.id === n.mood);
        return `<div class="item" style="box-shadow:none">
          <div class="top"><span class="nm">${mood ? mood.icon + " " : ""}${esc(fmtDate(n.date))}</span></div>
          ${n.text ? `<div class="sub">${esc(n.text)}</div>` : ""}
        </div>`;
      }).join("")}</div>`
    : `<p class="hint">Записей пока нет.</p>`;

  $("#addNote", root).addEventListener("click", () => go("/diary/note"));
  $("#reportBtn", root).addEventListener("click", () => go("/diary/report"));
}

/* ===================================================================
   Экран: один показатель — график и список
   =================================================================== */
let rangeDays = 30;

export function screenMetric(root, params){
  const m = METRICS[params.type];
  if(!m){ go("/diary", true); return; }

  const all = measurements(m.id);
  const from = shift(todayISO(), -rangeDays);
  const list = all.filter(x => x.date >= from);

  root.innerHTML = formHead(m.icon + " " + m.name) + `
    <div class="pill-nav" id="rangeNav">
      ${[7,30,90,365].map(d => `<button class="chip ${rangeDays===d?"on":""}" data-d="${d}">${
        d===7?"Неделя":d===30?"Месяц":d===90?"3 месяца":"Год"}</button>`).join("")}
      <button class="chip ${rangeDays===9999?"on":""}" data-d="9999">Всё</button>
    </div>

    <div class="panel" id="chartPanel"></div>

    <div class="mt"><button class="btn primary big wide" id="addBtn">＋ Записать ${esc(m.name.toLowerCase())}</button></div>

    <h2 class="screen-title" style="font-size:1.15rem;margin-top:1.2rem">Записи</h2>
    <div id="mList"></div>
  `;

  root.querySelector("#rangeNav").addEventListener("click", e => {
    const b = e.target.closest("[data-d]"); if(!b) return;
    rangeDays = Number(b.dataset.d);
    render();
  });
  $("#addBtn", root).addEventListener("click", () => go("/diary/add/" + m.id));

  const shown = rangeDays === 9999 ? all : list;
  const cp = $("#chartPanel", root);
  if(shown.length < 2){
    cp.innerHTML = `<p class="hint center">Для графика нужно хотя бы две записи за выбранный период.</p>`;
  }else{
    cp.innerHTML = buildChart(m, shown);
  }

  const box = $("#mList", root);
  const rev = shown.slice().reverse();
  box.innerHTML = rev.length ? `<div class="list">${rev.map(x => {
    const st = normStatus(m.id, x.values);
    return `<div class="item" style="box-shadow:none">
      <div class="top">
        <span class="nm">${esc(m.format(x.values))}</span>
        <button class="btn quiet" data-del="${esc(x.id)}" style="min-height:2.2rem;padding:.2rem .6rem;font-size:.8rem">Удалить</button>
      </div>
      <div class="sub">${esc(fmtDateShort(x.date))}${x.time ? ", " + esc(x.time) : ""}</div>
      ${x.note ? `<div class="sub">${esc(x.note)}</div>` : ""}
      ${st ? `<div class="meta"><span class="tag ${st==="ok"?"ok":"warn"}">${st==="ok"?"в пределах нормы":"вне справочных границ"}</span></div>` : ""}
    </div>`;
  }).join("")}</div>` : `<div class="empty"><p>За этот период записей нет.</p></div>`;

  box.querySelectorAll("[data-del]").forEach(b => {
    b.addEventListener("click", async () => {
      const ok = await confirmDialog({title:"Удалить запись?", okText:"Удалить", danger:true});
      if(!ok) return;
      state.data.measurements = state.data.measurements.filter(x => x.id !== b.dataset.del);
      save(true); toast("Удалено"); render();
    });
  });

  if(m.fields.some(f => f.norm)){
    root.insertAdjacentHTML("beforeend",
      `<p class="disclaimer-mini">Границы нормы приведены справочно и у разных людей отличаются.
       Оценивает результат врач.</p>`);
  }
}

function shift(iso, days){
  const d = new Date(iso); d.setDate(d.getDate() + days);
  const p = n => String(n).padStart(2,"0");
  return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate());
}

/* ===================================================================
   Графики — свой SVG, без внешних библиотек:
   работают офлайн, масштабируются вместе с интерфейсом и печатаются.
   =================================================================== */
export function buildChart(m, rows, forPrint){
  const W = 340, H = 190, L = 34, R = 8, T = 12, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const cls = forPrint ? "chart pr-chart" : "chart";

  const series = seriesFor(m, rows);
  if(!series.length) return "";

  let min = Infinity, max = -Infinity;
  series.forEach(s => s.points.forEach(p => { if(p.v < min) min = p.v; if(p.v > max) max = p.v; }));
  // Зону нормы рисуем только когда линия одна: иначе зелёная полоса
  // одного показателя читалась бы как оценка всех остальных.
  const normField = series.length === 1 ? m.fields.find(f => f.norm) : null;
  if(normField){ min = Math.min(min, normField.norm[0]); max = Math.max(max, normField.norm[1]); }
  if(min === max){ min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;

  const xs = rows.map((r,i) => i);
  const n = rows.length;
  const X = i => L + (n === 1 ? iw/2 : (i / (n-1)) * iw);
  const Y = v => T + ih - ((v - min) / (max - min)) * ih;

  // Горизонтальная сетка
  const ticks = 4;
  let grid = "";
  for(let i=0;i<=ticks;i++){
    const v = min + (max - min) * (i/ticks);
    const y = Y(v);
    grid += `<line class="grid" x1="${L}" y1="${y.toFixed(1)}" x2="${W-R}" y2="${y.toFixed(1)}"/>`;
    grid += `<text x="${L-5}" y="${(y+3.5).toFixed(1)}" text-anchor="end">${fmtTick(v, m)}</text>`;
  }

  // Зона нормы
  let band = "";
  if(normField){
    const y1 = Y(normField.norm[1]), y2 = Y(normField.norm[0]);
    band = `<rect class="band" x="${L}" y="${Math.min(y1,y2).toFixed(1)}" width="${iw}" height="${Math.abs(y2-y1).toFixed(1)}"/>`;
  }

  // Подписи по оси X — первая, середина, последняя
  const labIdx = n <= 2 ? [0, n-1] : [0, Math.floor((n-1)/2), n-1];
  const xlabs = labIdx.map(i =>
    `<text x="${X(i).toFixed(1)}" y="${H-8}" text-anchor="${i===0?"start":i===n-1?"end":"middle"}">${esc(shortDate(rows[i].date))}</text>`
  ).join("");

  const paths = series.map(s => {
    const d = s.points.map((p,k) => (k?"L":"M") + X(p.i).toFixed(1) + " " + Y(p.v).toFixed(1)).join(" ");
    const dots = s.points.map(p =>
      `<circle cx="${X(p.i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${n > 40 ? 1.6 : 2.6}" fill="${s.color}"/>`).join("");
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2"
             stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  }).join("");

  const legend = series.length > 1
    ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`
    : "";

  return `<div class="chart-wrap">
    <svg class="${cls}" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="График: ${esc(m.name)}, записей ${n}">
      ${band}${grid}
      <line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H-B}"/>
      <line class="axis" x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}"/>
      ${paths}${xlabs}
    </svg></div>${legend}`;
}

function seriesFor(m, rows){
  const COLORS = ["#17627E", "#2A8BA8", "#9A6410", "#7A5AA8"];
  const out = [];
  m.fields.forEach((f, idx) => {
    const points = [];
    rows.forEach((r,i) => {
      const v = r.values[f.key];
      if(v == null || v === "") return;
      points.push({ i, v: Number(v) });
    });
    if(points.length) out.push({ name:f.label, color:COLORS[idx % COLORS.length], points });
  });
  return out;
}
function fmtTick(v, m){
  return nf(v, m.fields[0].dec || 0);
}
function shortDate(iso){
  const p = iso.split("-");
  return p[2] + "." + p[1];
}

/* ===================================================================
   Экран: запись показателя
   =================================================================== */
export function screenMetricAdd(root, params){
  const m = METRICS[params.type];
  if(!m){ go("/diary", true); return; }

  const last = lastMeasurement(m.id);
  const steppers = {};
  const enabled = {};

  root.innerHTML = formHead("Записать: " + m.name) + `
    <form id="mForm" novalidate>
      <div id="fieldsBox"></div>

      <div class="row2">
        ${dateFieldHTML("mDate", todayISO(), {label:"Дата"})}
        <div class="field">
          <label for="mTime">Время</label>
          <input type="time" id="mTime" value="${nowHM()}">
        </div>
      </div>

      <div class="field">
        <label for="mNote">Заметка</label>
        <input type="text" id="mNote" placeholder="Например: до приёма таблетки">
      </div>

      <div class="sticky-actions">
        <div class="btn-row">
          <button type="button" class="btn" data-back>Отмена</button>
          <button type="submit" class="btn primary big">Сохранить</button>
        </div>
      </div>
    </form>
  `;

  const dateF = bindDateField(root, "mDate", {max: todayISO()});

  const box = $("#fieldsBox", root);
  m.fields.forEach(f => {
    const prev = last && last.values[f.key] != null ? Number(last.values[f.key]) : null;
    const start = prev != null ? prev : f.def;

    const wrap = document.createElement("div");
    wrap.className = "field";

    const presets = [];
    if(prev != null) presets.push({ v: prev, t: "как в прошлый раз (" + fmtVal(prev, f) + ")" });
    if(f.norm) presets.push({ v: (f.norm[0]+f.norm[1])/2, t: "середина нормы" });
    if(f.key === "t") presets.push({v:36.6, t:"36,6"}, {v:37.5, t:"37,5"}, {v:38.5, t:"38,5"});

    const st = stepper({
      value: start, min: f.min, max: f.max, step: f.step,
      decimals: f.dec, unit: f.unit, presets
    });
    steppers[f.key] = st;

    if(m.optionalFields){
      enabled[f.key] = prev != null;
      wrap.innerHTML = `<div class="chips" style="margin-bottom:.4rem">
        <button type="button" class="chip ${enabled[f.key]?"on":""}" data-en="${f.key}"
          aria-pressed="${enabled[f.key]}">${esc(f.label)}</button></div>`;
      const body = document.createElement("div");
      body.hidden = !enabled[f.key];
      body.appendChild(st.el);
      wrap.appendChild(body);
      wrap.querySelector("[data-en]").addEventListener("click", ev => {
        enabled[f.key] = !enabled[f.key];
        ev.currentTarget.classList.toggle("on", enabled[f.key]);
        ev.currentTarget.setAttribute("aria-pressed", String(enabled[f.key]));
        body.hidden = !enabled[f.key];
      });
    }else{
      enabled[f.key] = true;
      wrap.innerHTML = `<span class="field-label">${esc(f.label)}</span>`;
      wrap.appendChild(st.el);
    }
    box.appendChild(wrap);
  });

  if(m.optionalFields){
    box.insertAdjacentHTML("afterbegin",
      `<p class="hint mb">Отметьте, что измеряете — можно записать только часть.</p>`);
  }

  $("#mForm", root).addEventListener("submit", e => {
    e.preventDefault();
    const values = {};
    let any = false;
    m.fields.forEach(f => {
      if(!enabled[f.key]) return;
      values[f.key] = steppers[f.key].get();
      any = true;
    });
    if(!any){ toast("Отметьте хотя бы один показатель"); return; }

    const rec = {
      id: uid("ms"),
      profileId: state.data.activeProfileId,
      type: m.id,
      date: dateF.get() || todayISO(),
      time: $("#mTime", root).value || "",
      values,
      note: $("#mNote", root).value.trim()
    };
    state.data.measurements.push(rec);
    save(true);
    toast("Записано");
    // Возвращаемся назад, а не подменяем адрес: раньше в истории оставались
    // два одинаковых экрана подряд и «Назад» приходилось жать дважды.
    back("/diary/type/" + m.id);
  });
}

function fmtVal(v, f){ return nf(v, f.dec || 0); }

/* ===================================================================
   Экран: заметка о самочувствии
   =================================================================== */
export function screenDayNote(root){
  const today = todayISO();
  const existing = state.data.dayNotes.find(
    n => n.profileId === state.data.activeProfileId && n.date === today);
  let mood = existing ? existing.mood : "";

  root.innerHTML = formHead("Самочувствие") + `
    <form id="nForm" novalidate>
      ${dateFieldHTML("nDate", today, {label:"Дата"})}
      <div class="field">
        <span class="field-label">Как самочувствие</span>
        <div class="chips" id="moodPick">
          ${MOODS.map(x => `<button type="button" class="chip ${mood===x.id?"on":""}" data-mood="${x.id}"
            style="font-size:1.05rem">${x.icon} ${esc(x.name)}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <label for="nText">Что записать</label>
        <div class="sub">Самочувствие, жалобы, что помогло, что беспокоит.</div>
        <textarea id="nText" style="min-height:8rem">${esc(existing ? existing.text : "")}</textarea>
      </div>
      <div class="sticky-actions">
        <div class="btn-row">
          <button type="button" class="btn" data-back>Отмена</button>
          <button type="submit" class="btn primary big">Сохранить</button>
        </div>
      </div>
    </form>
  `;

  const noteDateF = bindDateField(root, "nDate", {max: today, onChange: iso => {
    // при смене даты подставляем уже существующую запись этого дня
    const ex = state.data.dayNotes.find(n => n.profileId === state.data.activeProfileId && n.date === iso);
    $("#nText", root).value = ex ? ex.text : "";
    mood = ex ? ex.mood : "";
    root.querySelectorAll("#moodPick .chip").forEach(c => c.classList.toggle("on", c.dataset.mood === mood));
  }});

  root.querySelector("#moodPick").addEventListener("click", e => {
    const b = e.target.closest("[data-mood]"); if(!b) return;
    mood = (mood === b.dataset.mood) ? "" : b.dataset.mood;
    root.querySelectorAll("#moodPick .chip").forEach(c => c.classList.toggle("on", c.dataset.mood === mood));
  });

  $("#nForm", root).addEventListener("submit", e => {
    e.preventDefault();
    const date = noteDateF.get() || today;
    const text = $("#nText", root).value.trim();
    if(!text && !mood){ toast("Отметьте самочувствие или напишите заметку"); return; }

    const found = state.data.dayNotes.find(
      n => n.profileId === state.data.activeProfileId && n.date === date);
    if(found){ found.mood = mood; found.text = text; }
    else state.data.dayNotes.push({
      id: uid("dn"), profileId: state.data.activeProfileId, date, mood, text
    });
    save(true); toast("Сохранено"); back("/diary");
  });
}
