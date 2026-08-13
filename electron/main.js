// electron/main.js — envuelve la app web de siempre en una ventana nativa
// de escritorio. NO reimplementa nada: arranca el mismo server/index.js
// de toda la vida (Express + SQLite), que sigue escuchando en la red local
// igual que con "npm run dev" — asi que emparejar el movil sigue
// funcionando exactamente igual, tanto si usas la app instalada como si
// usas el navegador.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

// IMPORTANTE: esto tiene que ponerse ANTES de requerir el servidor, porque
// server/db.js lee esta variable de entorno la primera vez que se carga
// (una sola vez, no se puede cambiar despues). Los datos van a la carpeta
// de datos del usuario (en Windows, algo tipo
// C:\Users\tú\AppData\Roaming\RemindMeLater\data) en vez de dentro de la
// propia carpeta de instalacion — esa carpeta se borra y se sustituye
// entera cada vez que se instala una version nueva, así que guardar ahí
// los datos de verdad los perdería en cada actualización.
process.env.REMINDMELATER_DATA_DIR = path.join(app.getPath('userData'), 'data');
process.env.PORT = String(PORT);

let mainWindow = null;

// Donde se guarda que vista tenias activa (normal/fullscreen/floating) la
// ULTIMA vez, para poder leerla de forma SINCRONA al crear la ventana la
// proxima vez que arranques la app — asi la ventana puede nacer YA en
// pantalla completa si esa era tu vista, en vez de crearse normal y
// pedirle luego (con la pagina ya cargada) que se ponga en pantalla
// completa, que es un momento mas delicado (la ventana puede seguir
// "asentandose" justo despues de crearse). No es lo mismo que
// localStorage: eso vive dentro de la pagina web (el proceso "renderer"),
// que este proceso principal no puede leer de forma sincrona antes de
// crear la ventana — por eso se guarda tambien aqui, en un archivo aparte,
// cada vez que cambia (ver saveViewMode en preload.js).
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

// El servidor tarda un poco (crear tablas, migraciones...) en estar listo
// para responder. En vez de un setTimeout a ciegas, se reintenta una
// peticion real hasta que conteste — así la ventana se abre en cuanto el
// servidor puede atenderla de verdad, ni antes ni con una espera de mas.
function waitForServer(url, callback) {
  const attempt = () => {
    http
      .get(url, (res) => {
        res.resume();
        callback();
      })
      .on('error', () => setTimeout(attempt, 150));
  };
  attempt();
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

  mainWindow.loadURL(`http://localhost:${PORT}/`);

  // Avisa a la pagina si sales de pantalla completa nativa por tu cuenta
  // (Esc, el propio control de la ventana...) para que Configuracion > Vista
  // no se quede diciendo "Pantalla completa" cuando ya no lo es. Simetrico
  // al 'fullscreenchange' que ya escucha app.js para el navegador normal.
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
ipcMain.on('set-fullscreen', (event, value) => {
  if (mainWindow) mainWindow.setFullScreen(!!value);
});
ipcMain.on('save-view-mode', (event, mode) => {
  writeSavedViewMode(typeof mode === 'string' ? mode : 'normal');
});

app.whenReady().then(() => {
  // Arranca el servidor Express de siempre, sin tocarle nada — es el
  // mismo archivo que usa "npm run dev".
  require('../server/index.js');

  waitForServer(`http://localhost:${PORT}/`, createWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// En Windows/Linux, cerrar la ultima ventana cierra la app entera (y con
// ella el servidor, que vive en el mismo proceso). En Mac la convencion es
// dejar la app corriendo hasta Cmd+Q, pero de momento esto se usa en
// Windows.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
