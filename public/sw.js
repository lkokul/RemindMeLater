// sw.js — service worker minimo, solo para que el navegador considere la
// app "instalable" (Chrome/Edge/Android lo piden para el boton de
// Instalar/Anadir a inicio) y para que el shell cargue algo mas rapido.
// A PROPOSITO no se mete con /api/*: los datos siempre tienen que ir en
// vivo al servidor, nunca servidos desde cache, o veriamos eventos
// desactualizados.
const CACHE_NAME = 'remindmelater-shell-v1';
const SHELL_FILES = ['/', '/styles.css', '/app.js', '/settings.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // La API y todo lo que no sea GET va siempre a la red, nunca a cache.
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;

  // Para el shell: red primero (para tener el HTML/CSS/JS mas nuevo
  // cuando hay conexion, ideal con npm run dev), y si falla, cache — asi
  // la app sigue abriendo aunque el ordenador este apagado o sin wifi.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Notificaciones push de verdad (con la app CERRADA del todo, no solo
// mientras esta abierta -- ver public/settings.js para donde se pide la
// suscripcion, y server/reminderChecker.js para quien manda el aviso).
// El payload viene del servidor tal cual se definio alli:
// { title, body, eventId }.
self.addEventListener('push', (event) => {
  let data = { title: 'RemindMeLater', body: '' };
  try {
    if (event.data) data = event.data.json();
  } catch (err) {
    // Payload raro/vacio: se muestra un aviso generico en vez de que no
    // salga nada.
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'RemindMeLater', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      data: { eventId: data.eventId },
    })
  );
});

// Al tocar el aviso: si ya hay una pestana/ventana de la app abierta, la
// enfoca en vez de abrir una nueva; si no, abre una.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
