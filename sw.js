/* ===================================================================
   Офлайн-режим «Книги здоровья».

   Стратегия та же, что в «Домашней бухгалтерии» и «Книге рецептов»:
     • сама программа (HTML, CSS, JS, словарь) — «сеть вперёд»:
       есть интернет — берём свежую версию, нет — из кэша.
       Приложение обновляется само, чистить кэш вручную не нужно;
     • иконки и манифест — «кэш вперёд»: не меняются, грузятся мгновенно.

   ВАЖНО: Service Worker управляет ТОЛЬКО файлами приложения.
   Записи пользователя лежат в localStorage и IndexedDB — их он
   не трогает вообще, поэтому обновление не может стереть данные.

   Запросы на чужие адреса (Википедия, поиск) не кэшируются и вообще
   не перехватываются.
   =================================================================== */

const CACHE = "healthbook-v3";

const CORE = [
  "./",
  "./index.html",
  "./app.css",
  "./manifest.webmanifest",
  "./data/library.json",
  "./js/app.js",
  "./js/store.js",
  "./js/ui.js",
  "./js/library.js",
  "./js/home.js",
  "./js/kits.js",
  "./js/diary.js",
  "./js/report.js",
  "./js/settings.js",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // Отдельные файлы могут отсутствовать на этапе разработки — не роняем установку.
      .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppShell(url, req){
  return req.mode === "navigate" ||
         url.pathname.endsWith("/") ||
         url.pathname.endsWith("index.html");
}

function isCode(url){
  return /\.(js|css|json|webmanifest)$/.test(url.pathname);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);
  // Чужие адреса не трогаем совсем: Википедия, поиск и всё остальное
  // должны работать напрямую и не попадать в кэш приложения.
  if(url.origin !== self.location.origin) return;

  if(isAppShell(url, req)){
    e.respondWith(
      fetch(req)
        .then(resp => {
          if(resp && resp.ok){
            const copy = resp.clone();
            caches.open(CACHE).then(c => c.put("./index.html", copy));
          }
          return resp;
        })
        .catch(() => caches.match("./index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  if(isCode(url)){
    // Сеть вперёд: приложение всегда подтягивает свежую версию кода и словаря.
    e.respondWith(
      fetch(req)
        .then(resp => {
          if(resp && resp.ok){
            const copy = resp.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Всё прочее (иконки, картинки) — кэш вперёд.
  e.respondWith(
    caches.match(req).then(hit => {
      if(hit) return hit;
      return fetch(req).then(resp => {
        if(resp && resp.ok){
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return resp;
      }).catch(() => new Response("", {status:504, statusText:"Нет сети"}));
    })
  );
});
