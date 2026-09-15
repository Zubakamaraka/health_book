/* ===================================================================
   report.js — отчёт для врача

   PDF делается штатной печатью браузера (window.print → «Сохранить
   в PDF»). Так документ получается с нормальной кириллицей, выбираемым
   текстом и без сторонних библиотек — а значит, работает офлайн.
   =================================================================== */

import { state } from "./store.js";
import { $, esc, go, formHead, todayISO, shiftISO, fmtDate, fmtDateShort,
         daysBetween, plural, toast } from "./ui.js";
import { METRICS, METRIC_ORDER, measurements, dayNotes, buildChart, MOODS, normStatus } from "./diary.js";
import { profileCourses, courseActiveOn, courseSchedule, TIMES, timeName } from "./home.js";

const PERIODS = [
  { id:"7",   name:"Неделя",    days:7 },
  { id:"30",  name:"Месяц",     days:30 },
  { id:"90",  name:"3 месяца",  days:90 },
  { id:"180", name:"Полгода",   days:180 },
  { id:"365", name:"Год",       days:365 },
  { id:"all", name:"Всё время", days:36500 }
];

let period = "30";
const include = { courses:true, intake:true, metrics:true, notes:true, charts:true };

export function screenReport(root){
  root.innerHTML = formHead("Отчёт для врача") + `
    <div class="panel">
      <h2>За какой период</h2>
      <div class="chips" id="perPick">
        ${PERIODS.map(p => `<button type="button" class="chip ${period===p.id?"on":""}" data-p="${p.id}">${esc(p.name)}</button>`).join("")}
      </div>
    </div>

    <div class="panel">
      <h2>Что включить</h2>
      <div class="chips" id="incPick">
        <button type="button" class="chip ${include.courses?"on":""}" data-i="courses">Назначения</button>
        <button type="button" class="chip ${include.intake?"on":""}" data-i="intake">Соблюдение приёма</button>
        <button type="button" class="chip ${include.metrics?"on":""}" data-i="metrics">Показатели</button>
        <button type="button" class="chip ${include.charts?"on":""}" data-i="charts">Графики</button>
        <button type="button" class="chip ${include.notes?"on":""}" data-i="notes">Заметки о самочувствии</button>
      </div>
    </div>

    <div class="panel flat">
      <h2>Предпросмотр</h2>
      <div id="previewStats"></div>
    </div>

    <div class="btn-col mt">
      <button class="btn primary big wide" id="printBtn">🖨️ Открыть печать / сохранить в PDF</button>
    </div>
    <p class="hint mt">В окне печати выберите «Сохранить как PDF» — получится файл,
      который можно показать врачу или распечатать.</p>
  `;

  root.querySelector("#perPick").addEventListener("click", e => {
    const b = e.target.closest("[data-p]"); if(!b) return;
    period = b.dataset.p;
    root.querySelectorAll("#perPick .chip").forEach(c => c.classList.toggle("on", c.dataset.p === period));
    stats();
  });
  root.querySelector("#incPick").addEventListener("click", e => {
    const b = e.target.closest("[data-i]"); if(!b) return;
    const k = b.dataset.i;
    include[k] = !include[k];
    b.classList.toggle("on", include[k]);
    stats();
  });

  $("#printBtn", root).addEventListener("click", () => {
    buildAndPrint();
  });

  function stats(){
    const { from, to } = range();
    const ms = state.data.measurements.filter(m =>
      m.profileId === state.data.activeProfileId && m.date >= from && m.date <= to);
    const ns = dayNotes({from, to});
    const cs = profileCourses(true).filter(c => !c.endDate || c.endDate >= from);
    $("#previewStats", root).innerHTML = `
      <div class="kv"><span class="k">Период</span><span class="v">${esc(fmtDate(from))} — ${esc(fmtDate(to))}</span></div>
      <div class="kv"><span class="k">Назначений</span><span class="v">${cs.length}</span></div>
      <div class="kv"><span class="k">Измерений</span><span class="v">${ms.length}</span></div>
      <div class="kv"><span class="k">Заметок</span><span class="v">${ns.length}</span></div>`;
  }
  stats();
}

function range(){
  const to = todayISO();
  const p = PERIODS.find(x => x.id === period) || PERIODS[1];
  let from = shiftISO(to, -(p.days - 1));
  if(period === "all"){
    const all = state.data.measurements
      .filter(m => m.profileId === state.data.activeProfileId).map(m => m.date)
      .concat(state.data.courses.filter(c => c.profileId === state.data.activeProfileId).map(c => c.startDate))
      .filter(Boolean).sort();
    from = all.length ? all[0] : to;
  }
  return { from, to };
}

/* ---------- Сборка документа и печать ---------- */
function buildAndPrint(){
  const area = ensureArea();
  area.innerHTML = buildReportHtml();
  // Дадим браузеру отрисовать содержимое, затем открываем печать
  setTimeout(() => {
    try{ window.print(); }
    catch(e){ toast("Печать недоступна в этом браузере"); }
  }, 60);
}

function ensureArea(){
  let a = document.getElementById("printArea");
  if(!a){
    a = document.createElement("div");
    a.id = "printArea";
    document.body.appendChild(a);
  }
  return a;
}

function buildReportHtml(){
  const { from, to } = range();
  const prof = state.data.profiles.find(p => p.id === state.data.activeProfileId) || {name:"—"};
  const days = daysBetween(from, to) + 1;

  let html = `
    <div class="pr-h1">Книга здоровья — выписка</div>
    <div class="pr-sub">
      ${esc(prof.name)}${prof.birthYear ? `, ${esc(String(prof.birthYear))} г. р.` : ""}${
        prof.sex ? `, пол: ${prof.sex === "m" ? "мужской" : "женский"}` : ""}<br>
      Период: ${esc(fmtDate(from))} — ${esc(fmtDate(to))} (${days} ${plural(days,"день","дня","дней")})<br>
      Документ сформирован ${esc(fmtDate(todayISO()))}
    </div>`;

  if(include.courses) html += sectionCourses(from, to);
  if(include.intake)  html += sectionIntake(from, to);
  if(include.metrics) html += sectionMetrics(from, to);
  if(include.notes)   html += sectionNotes(from, to);

  html += `<div class="pr-foot">
    Выписка составлена самим пациентом в приложении «Книга здоровья».
    Данные внесены вручную и не являются медицинским документом.
    Справочные границы нормы приведены для ориентира и не являются заключением.
  </div>`;
  return html;
}

function sectionCourses(from, to){
  const list = profileCourses(true)
    .filter(c => (!c.endDate || c.endDate >= from) && (!c.startDate || c.startDate <= to))
    .sort((a,b) => Number(!!a.archived) - Number(!!b.archived) ||
                   String(a.name).localeCompare(String(b.name), "ru"));
  if(!list.length) return "";
  return `<div class="pr-sec">Лекарства и процедуры</div>
    <table class="pr-table"><thead><tr>
      <th style="width:22%">Название</th><th style="width:20%">Доза и приём</th>
      <th style="width:16%">Когда</th><th style="width:16%">Период</th>
      <th>Для чего назначено</th></tr></thead><tbody>
      ${list.map(c => `<tr>
        <td><b>${esc(c.name)}</b>${c.archived ? "<br><i>завершено</i>" : ""}${c.doctor ? `<br>${esc(c.doctor)}` : ""}</td>
        <td>${esc(c.dose || "—")}</td>
        <td>${esc(courseSchedule(c))}</td>
        <td>${esc(c.startDate ? fmtDateShort(c.startDate) : "—")}${c.endDate ? "<br>— " + esc(fmtDateShort(c.endDate)) : ""}</td>
        <td>${esc(c.reason || "—")}${c.notes ? `<br><span class="pr-note">${esc(c.notes)}</span>` : ""}</td>
      </tr>`).join("")}
    </tbody></table>`;
}

function sectionIntake(from, to){
  const list = profileCourses(true).filter(c => !c.archived || (c.endDate && c.endDate >= from));
  if(!list.length) return "";
  const rows = [];
  for(const c of list){
    let planned = 0, done = 0;
    for(let d = from; d <= to; d = shiftISO(d, 1)){
      if(!courseActiveOnRange(c, d, from, to)) continue;
      const times = (c.times||[]).filter(t => t !== "asneeded");
      planned += times.length;
      const st = (state.data.intake[d] && state.data.intake[d][c.id]) || {};
      times.forEach(t => { if(st[t]) done++; });
    }
    if(!planned) continue;
    rows.push({ name:c.name, planned, done, pct: Math.round(done/planned*100) });
  }
  if(!rows.length) return "";
  return `<div class="pr-sec">Соблюдение приёма</div>
    <table class="pr-table"><thead><tr>
      <th>Название</th><th style="width:18%">Запланировано</th>
      <th style="width:18%">Отмечено</th><th style="width:14%">Доля</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.planned}</td><td>${r.done}</td><td>${r.pct}%</td></tr>`).join("")}
    </tbody></table>
    <p class="pr-note">Учтены только отметки, сделанные в приложении.</p>`;
}

function courseActiveOnRange(c, iso){
  if(c.startDate && iso < c.startDate) return false;
  if(c.endDate && iso > c.endDate) return false;
  if(c.everyN && c.everyN > 1 && c.startDate){
    if(daysBetween(c.startDate, iso) % c.everyN !== 0) return false;
  }
  return true;
}

function sectionMetrics(from, to){
  let html = "";
  for(const key of METRIC_ORDER){
    const m = METRICS[key];
    const rows = measurements(key, {from, to});
    if(!rows.length) continue;

    html += `<div class="pr-sec">${esc(m.name)}${m.unit ? `, ${esc(m.unit)}` : ""}</div>`;

    // Сводка по каждому полю
    const summary = m.fields.map(f => {
      const vals = rows.map(r => r.values[f.key]).filter(v => v != null).map(Number);
      if(!vals.length) return null;
      const min = Math.min(...vals), max = Math.max(...vals);
      const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
      const d = f.dec || 0;
      return { label:f.label, min:min.toFixed(d), max:max.toFixed(d), avg:avg.toFixed(d), n:vals.length,
               norm: f.norm ? `${f.norm[0]}–${f.norm[1]}` : "—" };
    }).filter(Boolean);

    if(summary.length){
      html += `<table class="pr-table"><thead><tr>
        <th>Показатель</th><th>Записей</th><th>Минимум</th><th>Среднее</th><th>Максимум</th><th>Справочная норма</th>
      </tr></thead><tbody>${summary.map(s => `<tr>
        <td>${esc(s.label)}</td><td>${s.n}</td><td>${esc(s.min)}</td>
        <td>${esc(s.avg)}</td><td>${esc(s.max)}</td><td>${esc(s.norm)}</td></tr>`).join("")}
      </tbody></table>`;
    }

    if(include.charts && rows.length >= 2){
      html += buildChart(m, rows, true);
    }

    const MAXROWS = 80;
    const show = rows.slice(-MAXROWS).reverse();
    html += `<table class="pr-table"><thead><tr>
      <th style="width:22%">Дата</th><th style="width:14%">Время</th>
      <th style="width:28%">Значение</th><th>Заметка</th></tr></thead><tbody>
      ${show.map(r => `<tr>
        <td>${esc(fmtDateShort(r.date))}</td><td>${esc(r.time || "—")}</td>
        <td>${esc(m.format(r.values))}</td><td>${esc(r.note || "")}</td></tr>`).join("")}
      </tbody></table>`;
    if(rows.length > MAXROWS)
      html += `<p class="pr-note">Показаны последние ${MAXROWS} записей из ${rows.length}.</p>`;
  }
  return html;
}

function sectionNotes(from, to){
  const list = dayNotes({from, to});
  if(!list.length) return "";
  return `<div class="pr-sec">Самочувствие</div>
    <table class="pr-table"><thead><tr>
      <th style="width:18%">Дата</th><th style="width:16%">Оценка</th><th>Запись</th>
    </tr></thead><tbody>${list.map(n => {
      const mood = MOODS.find(x => x.id === n.mood);
      return `<tr><td>${esc(fmtDateShort(n.date))}</td>
        <td>${esc(mood ? mood.name : "—")}</td><td>${esc(n.text || "")}</td></tr>`;
    }).join("")}</tbody></table>`;
}
