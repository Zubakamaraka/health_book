/* ===================================================================
   app.js — сборка приложения: маршруты и запуск
   =================================================================== */

import { state, prefs, load, save, requestPersistence } from "./store.js";
import { route, render, go, bindHeader, updateNet, toast, $ } from "./ui.js";
import { loadBuiltinLibrary, screenLibrary, screenLibraryItem, screenLibraryForm } from "./library.js";
import { screenHome, screenCourse, screenCourseForm, screenArchive } from "./home.js";
import { screenDiary, screenMetric, screenMetricAdd, screenDayNote } from "./diary.js";
import { screenReport } from "./report.js";
import { screenSettings, showDisclaimer } from "./settings.js";

/* ---------- Маршруты ----------
   Порядок важен: более конкретные адреса объявляются раньше. */
route("/home",                 screenHome);
route("/home/archive",         screenArchive);
route("/home/course/new",      screenCourseForm);
route("/home/course/edit/:id", screenCourseForm);
route("/home/course/:id",      screenCourse);

route("/library",              screenLibrary);
route("/library/new",          screenLibraryForm);
route("/library/item/:id",     screenLibraryItem);
route("/library/edit/:id",     screenLibraryForm);

route("/diary",                screenDiary);
route("/diary/note",           screenDayNote);
route("/diary/report",         screenReport);
route("/diary/type/:type",     screenMetric);
route("/diary/add/:type",      screenMetricAdd);

route("/settings",             screenSettings);

/* ---------- Запуск ---------- */
async function start(){
  prefs.load();
  load();

  bindHeader();
  await loadBuiltinLibrary();

  if(!location.hash) location.replace("#/home");
  window.addEventListener("hashchange", render);
  render();

  // Сообщения о проблемах с данными — сразу и заметно
  if(state.loadError){
    setTimeout(() => toast(state.loadError, 8000), 700);
  }
  window.addEventListener("hb:storage-full", () => {
    toast("Не хватает места в браузере. Сделайте резервную копию и удалите лишние фотографии.", 8000);
  });

  // Просим браузер беречь данные (молча, без окон)
  requestPersistence();

  // Предупреждение при первом запуске
  setTimeout(() => showDisclaimer(false), 900);

  registerServiceWorker();
}

/* ---------- Офлайн-режим ---------- */
function registerServiceWorker(){
  if(!("serviceWorker" in navigator)) return;
  if(location.protocol === "file:") return;   // при открытии файлом SW не работает
  const reg = () => navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW:", e));
  // Модульный скрипт выполняется с задержкой, и событие load к этому моменту
  // может быть уже позади — тогда подписка на него никогда не сработает.
  if(document.readyState === "complete") reg();
  else window.addEventListener("load", reg, {once:true});

  // Когда установилась новая версия приложения — обновляем страницу один раз,
  // чтобы пользователю не приходилось ничего чистить вручную.
  // Данные при этом не затрагиваются: они лежат в другом хранилище.
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if(reloaded) return;
    reloaded = true;
    location.reload();
  });
}

start();
