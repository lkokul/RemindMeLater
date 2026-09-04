// electron/main.js — el arranque de la app de escritorio.
//
// Hasta la version 0.33 esto envolvia la app WEB: levantaba el servidor
// Express de siempre y abria una ventana apuntando a
// http://localhost:3000. Ya no. Ahora no hay servidor, ni puerto, ni
// HTTP: la ventana y la base de datos viven en el mismo programa y
// hablan entre ellas por IPC (ver electron/ipc.js). Lo que se ve en
// pantalla es exactamente el mismo public/ de siempre, servido por un
// esquema propio app:// (ver electron/protocol.js).
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const { registerScheme, registerHandler, ORIGIN } = require('./protocol');

// IMPORTANTE: esto tiene que ponerse ANTES de requerir nada de core/,
// porque core/db.js lee esta variable de entorno la primera vez que se
// carga (una sola vez, no se puede cambiar despues). Los datos van a la
// carpeta de datos del usuario (en Windows, algo tipo
// C:\Users\tú\AppData\Roaming\RemindMeLater\data) en vez de dentro de la
// propia carpeta de instalacion — esa carpeta se borra y se sustituye
// entera cada vez que se instala una version nueva, asi que guardar ahi
// los datos de verdad los perderia en cada actualizacion.
process.env.REMINDMELATER_DATA_DIR = path.join(app.getPath('userData'), 'data');

// El registro del esquema app:// tiene que ocurrir antes de que Electron
// termine de arrancar (whenReady), no despues — por eso se llama aqui
// arriba del todo y no dentro del whenReady() de mas abajo.
registerScheme();

let mainWindow = null;

// Donde se guarda que vista tenias activa (normal/fullscreen) la
// ULTIMA vez, para poder leerla de forma SINCRONA al crear la ventana la
// proxima vez que arranques la app — asi la ventana puede nacer YA en
// pantalla completa si esa era tu vista, en vez de crearse normal y
// pedirle luego (con la pagina ya cargada) que se ponga en pantalla
// completa, que es un momento mas delicado (la ventana puede seguir
// "asentandose" justo despues de crearse). No es lo mismo que
// localStorage: eso vive dentro de la pagina web (el proceso "renderer"),
// que este proceso principal no puede leer de forma sincrona antes de
// crear la ventana — por eso se guarda tambien aqui, en un archivo
// aparte, cada vez que cambia (ver saveViewMode en preload.js).
const VIEW_MODE_FILE = path.join(app.getPath('userData'), 'view-mode.json');

function readSavedViewMode() {
  try {
    const raw = fs.readFileSync(VIEW_MODE_FILE, 'utf8');
    return JSON.parse(raw).mode || 'normal';
  } catch (err) {
    return 'normal'; // primera vez que se arranca, o archivo corrupto/ausente
  }
}

function writeSavedViewMode(mode) {
  try {
    fs.writeFileSync(VIEW_MODE_FILE, JSON.stringify({ mode }));
  } catch (err) {
    console.warn('No se pudo guardar la vista para la proxima vez que arranques:', err.message);
  }
}

function createWindow() {
  const savedMode = readSavedViewMode();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    // La ventana nace YA en pantalla completa si esa era la vista
    // guardada — ver el comentario junto a VIEW_MODE_FILE mas arriba.
    fullscreen: savedMode === 'fullscreen',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Ya no hace falta esperar a que ningun servidor conteste: los
  // archivos se sirven desde el disco (protocol.js) y los datos salen de
  // SQLite en este mismo proceso, asi que la ventana puede cargar de
  // inmediato.
  mainWindow.loadURL(`${ORIGIN}/index.html`);

  // Avisa a la pagina si sales de pantalla completa nativa por tu cuenta
  // (Esc, el propio control de la ventana...) para que Configuracion > Vista
  // no se quede diciendo "Pantalla completa" cuando ya no lo es.
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('native-fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('native-fullscreen-changed', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Boton "Salir de la aplicacion" en Configuracion > Este dispositivo (solo
// visible cuando corre dentro de Electron, ver preload.js y
// public/settings.js). Cierra la ventana de golpe, sin preguntar — igual
// que cerrar la ventana con la X del sistema operativo.
ipcMain.on('quit-app', () => app.quit());

// Tras un "git pull" bueno pedido desde Configuracion (ver
// core/routes/update.js), el codigo nuevo ya esta en el disco pero este
// proceso sigue con el viejo cargado en memoria — app.relaunch() dice
// "cuando cierres, vuelve a abrirte" y app.exit() lo dispara ya mismo.
ipcMain.on('relaunch-app', () => {
  app.relaunch();
  app.exit();
});
ipcMain.on('set-fullscreen', (event, value) => {
  if (mainWindow) mainWindow.setFullScreen(!!value);
});
ipcMain.on('save-view-mode', (event, mode) => {
  writeSavedViewMode(typeof mode === 'string' ? mode : 'normal');
});

app.whenReady().then(() => {
  // Estos tres require() van AQUI DENTRO y no arriba del archivo a
  // proposito: los tres acaban abriendo la base de datos, y para eso
  // hace falta que REMINDMELATER_DATA_DIR ya este puesta y que Electron
  // haya arrancado (app.getPath('userData') no es fiable antes).
  const { registerIpc } = require('./ipc');
  const { startReminderChecker } = require('../core/reminderChecker');
  const { startFinanzasRecurringChecker } = require('../core/finanzasRecurringChecker');

  registerHandler(); // el app:// que sirve public/ y las imagenes
  registerIpc(); // el canal por el que la ventana pide datos

  createWindow();

  // Trabajo de fondo, el mismo de siempre. Antes lo arrancaba
  // server/index.js al ponerse a escuchar; ahora que no hay servidor,
  // lo arranca esto.
  //   - reminderChecker: cada 30s mira si toca avisar de algun
  //     recordatorio y saca el aviso del sistema.
  //   - finanzasRecurringChecker: una vez al dia, genera la transaccion
  //     real de cada plantilla de gasto fijo que toque.
  startReminderChecker();
  startFinanzasRecurringChecker();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// En Windows/Linux, cerrar la ultima ventana cierra la app entera. En Mac
// la convencion es dejar la app corriendo hasta Cmd+Q, pero de momento
// esto se usa en Windows.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
