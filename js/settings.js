/* ===================================================================
   settings.js — настройки, резервные копии, профили

   Резервная копия — это обычный файл JSON, который сохраняется на
   устройство пользователя. Никуда не отправляется. Две разновидности:
     • «Данные» — маленький файл, для регулярного сохранения;
     • «Данные и фотографии» — тяжёлый, для переезда на новый телефон.
   =================================================================== */

import { state, save, prefs, rawExport, replaceAll, hasRollback, rollbackRestore,
         photoAll, photoPut, photoStats, storageEstimate, requestPersistence,
         addProfile, removeProfile, APP_VERSION, SCHEMA_VERSION, LS,
         brokenBackupExists, brokenBackupText } from "./store.js";
import { $, esc, go, toast, formHead, confirmDialog, promptDialog,
         todayISO, fmtDate, render } from "./ui.js";
import { categories, allItems } from "./library.js";

/* ---------- Экран настроек ---------- */
export function screenSettings(root){
  const d = state.data;
  const lastBackup = d.meta.lastBackupAt;
  const daysSince = lastBackup ? Math.floor((Date.now() - lastBackup) / 86400000) : null;

  root.innerHTML = `
    <h1 class="screen-title">Настройки</h1>

    ${backupBanner(daysSince)}

    <div class="panel">
      <h2>💾 Резервная копия</h2>
      <p class="hint mb">Файл сохраняется на ваше устройство. Всё остальное время
        данные хранятся только здесь и никуда не отправляются.</p>
      <div class="kv"><span class="k">Последняя копия</span>
        <span class="v">${lastBackup ? esc(new Date(lastBackup).toLocaleDateString("ru-RU")) : "ещё не делали"}</span></div>
      <div class="btn-col mt">
        <button class="btn primary wide" id="bkData">Сохранить копию данных</button>
        <button class="btn wide" id="bkFull">Сохранить копию вместе с фото</button>
        <button class="btn wide" id="bkRestore">Восстановить из файла</button>
        ${hasRollback() ? `<button class="btn quiet wide" id="bkRollback">Отменить последнее восстановление</button>` : ""}
      </div>
    </div>

    <div class="panel">
      <h2>👤 Профили</h2>
      <p class="hint mb">Если приложением пользуются двое — заведите второй профиль.
        Записи, назначения и отчёты у каждого свои.</p>
      <div id="profList"></div>
      <div class="mt"><button class="btn wide" id="addProf">＋ Добавить профиль</button></div>
    </div>

    <div class="panel">
      <h2>🎨 Внешний вид</h2>
      <div class="kv"><span class="k">Размер текста</span>
        <span class="v">${Math.round(prefs.scale*100)}% — меняется кнопками «А−» и «А+» вверху</span></div>
      <div class="kv"><span class="k">Тема</span>
        <span class="v">${prefs.theme === "dark" ? "тёмная" : "светлая"} — переключается кнопкой вверху</span></div>
    </div>

    <div class="panel">
      <h2>📚 Библиотека</h2>
      <div id="libStats"></div>
      <div class="mt" id="hiddenBox"></div>
    </div>

    <div class="panel">
      <h2>🗄️ Место на устройстве</h2>
      <div id="storBox"><p class="hint">Считаем…</p></div>
    </div>

    <div class="panel">
      <h2>ℹ️ О приложении</h2>
      <div class="kv"><span class="k">Версия</span><span class="v">${esc(APP_VERSION)}</span></div>
      <div class="kv"><span class="k">Формат данных</span><span class="v">${SCHEMA_VERSION}</span></div>
      <div class="kv"><span class="k">Хранение</span><span class="v">только на этом устройстве</span></div>
      <p class="hint mt">Обновление приложения не стирает записи: данные и программа лежат
        в разных местах браузера. Записи пропадут только если очистить данные браузера —
        поэтому и нужна резервная копия.</p>
      <div class="mt">
        <button class="btn quiet wide" id="showDisc">Показать предупреждение о медицинской информации</button>
      </div>
    </div>

    ${brokenBackupExists() ? `<div class="panel" style="border-color:var(--danger)">
      <h2 style="color:var(--danger)">⚠️ Найдены нечитаемые данные</h2>
      <p class="hint">Приложение обнаружило испорченный файл данных и сохранило его отдельно,
        ничего не удалив. Можно выгрузить его файлом и попробовать разобраться.</p>
      <div class="mt"><button class="btn danger wide" id="dumpBroken">Выгрузить файл</button></div>
    </div>` : ""}

    <p class="disclaimer-mini">Приложение не является медицинским изделием и не заменяет
      консультацию врача.</p>
  `;

  /* --- копии --- */
  $("#bkData", root).addEventListener("click", () => makeBackup(false));
  $("#bkFull", root).addEventListener("click", () => makeBackup(true));
  $("#bkRestore", root).addEventListener("click", () => restoreBackup());
  const rb = $("#bkRollback", root);
  if(rb) rb.addEventListener("click", async () => {
    const ok = await confirmDialog({title:"Вернуть данные, которые были до восстановления?",
      okText:"Вернуть", danger:true});
    if(!ok) return;
    if(rollbackRestore()){ toast("Данные возвращены"); render(); }
    else toast("Не удалось вернуть");
  });

  const bb = $("#dumpBroken", root);
  if(bb) bb.addEventListener("click", () => {
    downloadFile("knigazdorovya-нечитаемые-данные.json", brokenBackupText());
  });

  /* --- профили --- */
  drawProfiles($("#profList", root));
  $("#addProf", root).addEventListener("click", async () => {
    const name = await promptDialog({title:"Новый профиль", label:"Имя", placeholder:"Например: Мама"});
    if(!name) return;
    addProfile(name);
    toast("Профиль добавлен");
    render();
  });

  /* --- библиотека --- */
  const items = allItems();
  $("#libStats", root).innerHTML = `
    <div class="kv"><span class="k">Всего позиций</span><span class="v">${items.length}</span></div>
    <div class="kv"><span class="k">Из них своих</span><span class="v">${state.data.libraryCustom.length}</span></div>
    <div class="kv"><span class="k">Скрыто</span><span class="v">${state.data.libraryHidden.length}</span></div>`;
  drawHidden($("#hiddenBox", root));

  /* --- место --- */
  drawStorage($("#storBox", root));

  $("#showDisc", root).addEventListener("click", () => showDisclaimer(true));
}

function backupBanner(daysSince){
  if(daysSince === null){
    return `<div class="banner"><span class="bi">💾</span><span class="bt">
      Вы ещё не делали резервную копию. Сохраните файл — это единственный способ
      не потерять записи, если с телефоном что-то случится.</span></div>`;
  }
  if(daysSince >= 30){
    return `<div class="banner"><span class="bi">⏰</span><span class="bt">
      Последняя резервная копия была ${daysSince} ${daysSince % 10 === 1 && daysSince % 100 !== 11 ? "день" : "дней"} назад.
      Самое время сохранить новую.</span></div>`;
  }
  return "";
}

/* ---------- Профили ---------- */
function drawProfiles(box){
  const d = state.data;
  box.innerHTML = d.profiles.map(p => `
    <div class="item" style="box-shadow:none">
      <div class="top">
        <span class="nm">${esc(p.name)}${p.id === d.activeProfileId ? " ✓" : ""}</span>
      </div>
      <div class="sub">${[
          p.birthYear ? esc(String(p.birthYear)) + " г. р." : "год рождения не указан",
          sexName(p.sex)
        ].filter(Boolean).join(" · ")}</div>
      <div class="btn-row mt">
        ${p.id !== d.activeProfileId ? `<button class="btn quiet" data-use="${esc(p.id)}" style="min-height:2.5rem">Выбрать</button>` : ""}
        <button class="btn quiet" data-ren="${esc(p.id)}" style="min-height:2.5rem">Имя</button>
        <button class="btn quiet" data-year="${esc(p.id)}" style="min-height:2.5rem">Год</button>
        <button class="btn quiet" data-sex="${esc(p.id)}" style="min-height:2.5rem">Пол</button>
        ${d.profiles.length > 1 ? `<button class="btn danger" data-del="${esc(p.id)}" style="min-height:2.5rem">Удалить</button>` : ""}
      </div>
    </div>`).join("");

  box.querySelectorAll("[data-use]").forEach(b => b.addEventListener("click", () => {
    state.data.activeProfileId = b.dataset.use; save(true); toast("Профиль выбран"); render();
  }));
  box.querySelectorAll("[data-ren]").forEach(b => b.addEventListener("click", async () => {
    const p = state.data.profiles.find(x => x.id === b.dataset.ren);
    const name = await promptDialog({title:"Имя профиля", label:"Имя", value:p.name});
    if(!name) return;
    p.name = name; save(true); render();
  }));
  box.querySelectorAll("[data-year]").forEach(b => b.addEventListener("click", async () => {
    const p = state.data.profiles.find(x => x.id === b.dataset.year);
    const y = await promptDialog({title:"Год рождения", label:"Четыре цифры",
      value: p.birthYear ? String(p.birthYear) : "", placeholder:"1950"});
    if(y === null) return;
    const n = parseInt(y, 10);
    p.birthYear = (n >= 1900 && n <= new Date().getFullYear()) ? n : null;
    save(true); render();
  }));
  box.querySelectorAll("[data-sex]").forEach(b => b.addEventListener("click", async () => {
    const p = state.data.profiles.find(x => x.id === b.dataset.sex);
    const v = await pickSex(p.sex);
    if(v === null) return;
    p.sex = v; save(true); render();
  }));
  box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    const p = state.data.profiles.find(x => x.id === b.dataset.del);
    const ok = await confirmDialog({title:`Удалить профиль «${p.name}»?`,
      text:"Вместе с ним удалятся все его назначения, измерения и заметки. Отменить нельзя.",
      okText:"Удалить", danger:true});
    if(!ok) return;
    removeProfile(p.id); toast("Профиль удалён"); render();
  }));
}

export function sexName(sex){
  return sex === "m" ? "мужской" : sex === "f" ? "женский" : "";
}

/* Выбор пола крупными кнопками */
function pickSex(current){
  return new Promise(resolve => {
    const b = document.createElement("div");
    b.className = "modal-back";
    b.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2>Пол</h2>
      <p class="hint mb">Нужен только для шапки отчёта врачу.</p>
      <div class="btn-col">
        <button class="btn wide ${current === "m" ? "primary" : ""}" data-v="m">Мужской</button>
        <button class="btn wide ${current === "f" ? "primary" : ""}" data-v="f">Женский</button>
        <button class="btn quiet wide" data-v="">Не указывать</button>
      </div>
      <div class="mt"><button class="btn quiet wide" data-cancel>Отмена</button></div>
    </div>`;
    b.addEventListener("click", e => {
      if(e.target === b || e.target.closest("[data-cancel]")){ b.remove(); resolve(null); return; }
      const t = e.target.closest("[data-v]");
      if(!t) return;
      b.remove(); resolve(t.dataset.v);
    });
    document.body.appendChild(b);
  });
}

/* ---------- Скрытые позиции библиотеки ---------- */
function drawHidden(box){
  const hidden = state.data.libraryHidden || [];
  if(!hidden.length){ box.innerHTML = `<p class="hint">Скрытых позиций нет.</p>`; return; }
  const names = hidden.map(id => {
    const it = state.builtinLibrary.find(x => x.id === id);
    return { id, name: it ? it.name : id };
  });
  box.innerHTML = `<p class="field-label">Скрытые позиции</p><div class="list">${
    names.map(n => `<div class="item" style="box-shadow:none">
      <div class="top"><span class="nm">${esc(n.name)}</span>
      <button class="btn quiet" data-unhide="${esc(n.id)}" style="min-height:2.4rem">Вернуть</button></div>
    </div>`).join("")}</div>`;
  box.querySelectorAll("[data-unhide]").forEach(b => b.addEventListener("click", () => {
    state.data.libraryHidden = state.data.libraryHidden.filter(x => x !== b.dataset.unhide);
    save(true); toast("Позиция возвращена"); render();
  }));
}

/* ---------- Место на устройстве ---------- */
async function drawStorage(box){
  const ph = await photoStats();
  const est = await storageEstimate();
  let persisted = false;
  try{ persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; }catch(e){}

  const dataBytes = (LS.get("healthbook.data") || "").length;
  const mb = b => (b / 1048576).toFixed(1) + " МБ";
  const kb = b => (b / 1024).toFixed(0) + " КБ";

  box.innerHTML = `
    <div class="kv"><span class="k">Записи</span><span class="v">${kb(dataBytes)}</span></div>
    <div class="kv"><span class="k">Фотографии</span><span class="v">${ph.count} шт., ${mb(ph.bytes)}</span></div>
    ${est && est.quota ? `<div class="kv"><span class="k">Доступно браузеру</span>
      <span class="v">${mb(est.quota)}</span></div>` : ""}
    <div class="kv"><span class="k">Защита от вытеснения</span>
      <span class="v">${persisted ? "включена" : "не включена"}</span></div>
    ${!persisted ? `<div class="mt"><button class="btn wide" id="persistBtn">Попросить браузер беречь данные</button></div>` : ""}
  `;
  const pb = box.querySelector("#persistBtn");
  if(pb) pb.addEventListener("click", async () => {
    const ok = await requestPersistence();
    toast(ok ? "Браузер согласился беречь данные" : "Браузер отказал — резервные копии тем более важны");
    drawStorage(box);
  });
}

/* ===================================================================
   Резервные копии
   =================================================================== */
async function makeBackup(withPhotos){
  toast(withPhotos ? "Собираю данные и фотографии…" : "Собираю данные…");
  const payload = {
    app: "Книга здоровья",
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    withPhotos: !!withPhotos,
    data: rawExport()
  };
  if(withPhotos){
    try{
      const all = await photoAll();
      payload.photos = all.map(p => ({ id:p.id, dataUrl:p.dataUrl, meta:p.meta || {} }));
    }catch(e){ payload.photos = []; }
  }
  const text = JSON.stringify(payload);
  const name = "kniga-zdorovya-" + todayISO() + (withPhotos ? "-с-фото" : "") + ".json";
  downloadFile(name, text);

  state.data.meta.lastBackupAt = Date.now();
  save(true);
  toast("Файл сохранён: " + name, 4000);
  setTimeout(render, 400);
}

function downloadFile(name, text){
  const blob = new Blob([text], {type:"application/json;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

function restoreBackup(){
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json,.json";
  inp.style.display = "none";
  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    inp.remove();
    if(!f) return;
    let parsed;
    try{
      const text = await f.text();
      parsed = JSON.parse(text);
    }catch(e){
      toast("Файл не читается — это точно копия «Книги здоровья»?");
      return;
    }

    const data = parsed && parsed.data ? parsed.data : parsed;
    if(!data || typeof data !== "object" || !Array.isArray(data.profiles)){
      toast("В файле нет данных «Книги здоровья»");
      return;
    }

    const cnt = {
      courses: (data.courses||[]).length,
      ms: (data.measurements||[]).length,
      notes: (data.dayNotes||[]).length,
      photos: (parsed.photos||[]).length,
      profiles: (data.profiles||[]).length
    };

    const ok = await confirmDialog({
      title:"Восстановить данные из файла?",
      text:`В файле: профилей ${cnt.profiles}, назначений ${cnt.courses}, измерений ${cnt.ms}, ` +
           `заметок ${cnt.notes}${cnt.photos ? `, фотографий ${cnt.photos}` : ""}. ` +
           `Текущие данные будут заменены, но перед этим сохранятся — отменить восстановление можно будет здесь же.`,
      okText:"Восстановить", danger:true
    });
    if(!ok) return;

    try{
      replaceAll(data);
      if(parsed.photos && parsed.photos.length){
        toast("Восстанавливаю фотографии…");
        for(const p of parsed.photos){
          if(p && p.id && p.dataUrl) await photoPut(p.id, p.dataUrl, p.meta || {});
        }
      }
      toast("Данные восстановлены", 3500);
      go("/home");
    }catch(e){
      toast("Не удалось восстановить: " + (e.message || "ошибка"));
    }
  });
  document.body.appendChild(inp);
  inp.click();
}

/* ===================================================================
   Предупреждение о медицинской информации
   =================================================================== */
export function showDisclaimer(force){
  if(!force && state.data.meta.disclaimerSeen) return;
  if(document.querySelector(".modal-back[data-disclaimer]")) return;  // не показываем дважды
  const back = document.createElement("div");
  back.className = "modal-back";
  back.setAttribute("data-disclaimer", "1");
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <h2>Коротко о главном</h2>
    <p class="mb">«Книга здоровья» — это дневник и картотека того, что назначил врач.</p>
    <ul style="padding-left:1.1rem;margin-bottom:.8rem">
      <li style="margin-bottom:.4rem">Сведения в библиотеке — справочные. Это не инструкция по применению.</li>
      <li style="margin-bottom:.4rem">Приложение не ставит диагнозов и ничего не советует принимать.</li>
      <li style="margin-bottom:.4rem">Назначение, дозу и схему приёма определяет только врач.</li>
      <li>Данные хранятся на вашем устройстве и никуда не отправляются.</li>
    </ul>
    <button class="btn primary wide" data-ok>Понятно</button>
  </div>`;
  back.addEventListener("click", e => {
    if(e.target.closest("[data-ok]") || e.target === back){
      state.data.meta.disclaimerSeen = true; save(true);
      back.remove();
    }
  });
  document.body.appendChild(back);
}
