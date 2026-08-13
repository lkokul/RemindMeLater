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
});
