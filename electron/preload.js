// preload.js — el UNICO puente entre la pagina web (que corre con
// contextIsolation activado, sin acceso a Node ni a Electron) y el
// proceso principal. Solo expone lo estrictamente necesario (aqui, poder
// pedir que se cierre la app) como una funcion normal de JS en
// window.electronAPI — la pagina nunca ve `require` ni el resto de la API
// de Electron, que es justo lo que contextIsolation esta pensado para
// evitar (si una pagina web tuviera acceso libre a Node, cualquier fallo
// de seguridad ahi seria mucho mas grave).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  quitApp: () => ipcRenderer.send('quit-app'),
  // A diferencia de la API de pantalla completa del navegador (que exige
  // un clic del usuario), la ventana nativa de Electron puede ponerse en
  // pantalla completa por su cuenta al arrancar — por eso app.js la usa
  // en vez de document.requestFullscreen() cuando detecta que corre aqui
  // dentro (ver applyViewMode/applyViewModePrompt).
  setNativeFullscreen: (value) => ipcRenderer.send('set-fullscreen', !!value),
  onNativeFullscreenChange: (callback) => {
    ipcRenderer.on('native-fullscreen-changed', (event, isFullscreen) => callback(isFullscreen));
  },
  // Guarda cual es la vista guardada (normal/fullscreen) en un
  // archivo que main.js puede leer de forma SINCRONA al crear la ventana
  // la proxima vez — asi la ventana puede nacer YA en pantalla completa
  // desde el primer instante, en vez de crearse normal y pedirle luego (ya
  // cargada la pagina) que se ponga en pantalla completa, que es donde
  // podia haber una carrera con que la ventana todavia se estuviera
  // asentando.
  saveViewMode: (mode) => ipcRenderer.send('save-view-mode', mode),
  // Tras un "git pull" bueno (ver /api/update/pull en el servidor), la
  // app tiene el codigo nuevo EN EL DISCO pero el proceso que esta
  // corriendo ahora mismo sigue con el viejo cargado en memoria — hace
  // falta cerrar y volver a abrir de verdad para que se note. app.relaunch()
  // deja pedido un reinicio y app.exit() lo dispara.
  relaunchApp: () => ipcRenderer.send('relaunch-app'),
  // window.electronAPI.isElectron existe siempre que estamos aqui dentro
  // (a diferencia de las demas funciones, no manda nada) — sirve para que
  // el codigo de la pagina pueda preguntar "¿estoy en Electron?" sin tener
  // que fijarse en una funcion concreta.
  isElectron: true,
});
