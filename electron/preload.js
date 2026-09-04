// preload.js — el UNICO puente entre la pagina web (que corre con
// contextIsolation activado, sin acceso a Node ni a Electron) y el
// proceso principal. Solo expone lo estrictamente necesario, como
// funciones normales de JS en window.electronAPI — la pagina nunca ve
// `require` ni el resto de la API de Electron, que es justo lo que
// contextIsolation esta pensado para evitar (si una pagina web tuviera
// acceso libre a Node, cualquier fallo de seguridad ahi seria mucho mas
// grave).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // LA funcion importante desde que se quito el servidor: por aqui pasan
  // TODAS las peticiones de datos de la app. Es el reemplazo directo del
  // fetch() que antes iba a http://localhost:3000 — ver api() en
  // public/app.js (quien la llama) y electron/ipc.js (quien la atiende).
  //
  // Devuelve siempre { status, body }, igual de "crudo" que una respuesta
  // HTTP: quien decide si eso es un error o no sigue siendo api() en la
  // pagina, con las mismas reglas de antes.
  api: (path, options = {}) =>
    ipcRenderer.invoke('api-request', {
      path,
      method: options.method || 'GET',
      body: options.body ?? null,
      headers: options.headers || {},
    }),

  quitApp: () => ipcRenderer.send('quit-app'),
  // A diferencia de la API de pantalla completa del navegador (que exige
  // un clic del usuario), la ventana nativa de Electron puede ponerse en
  // pantalla completa por su cuenta al arrancar — por eso app.js la usa
  // en vez de document.requestFullscreen() (ver applyViewMode).
  setNativeFullscreen: (value) => ipcRenderer.send('set-fullscreen', !!value),
  onNativeFullscreenChange: (callback) => {
    ipcRenderer.on('native-fullscreen-changed', (event, isFullscreen) => callback(isFullscreen));
  },
  // Guarda cual es la vista guardada (normal/fullscreen) en un archivo
  // que main.js puede leer de forma SINCRONA al crear la ventana la
  // proxima vez — asi la ventana puede nacer YA en pantalla completa
  // desde el primer instante.
  saveViewMode: (mode) => ipcRenderer.send('save-view-mode', mode),
  // Tras un "git pull" bueno (ver core/routes/update.js), la app tiene el
  // codigo nuevo EN EL DISCO pero el proceso que esta corriendo ahora
  // mismo sigue con el viejo cargado en memoria — hace falta cerrar y
  // volver a abrir de verdad para que se note.
  relaunchApp: () => ipcRenderer.send('relaunch-app'),
  // window.electronAPI.isElectron existe siempre que estamos aqui dentro
  // (a diferencia de las demas funciones, no manda nada) — sirve para que
  // el codigo de la pagina pueda preguntar "¿estoy en Electron?" sin
  // tener que fijarse en una funcion concreta.
  isElectron: true,
});
