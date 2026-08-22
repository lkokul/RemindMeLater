// index.js — punto de entrada. Levanta el servidor Express, sirve la app
// web estatica y monta las rutas de la API.
const express = require('express');
const os = require('os');
const path = require('path');

const { requireDeviceOrTrusted } = require('./auth');
const eventsRouter = require('./routes/events');
const devicesRouter = require('./routes/devices');
const remindersRouter = require('./routes/reminders');
const groupsRouter = require('./routes/groups');
const themesRouter = require('./routes/themes');
const profileRouter = require('./routes/profile');
const specialDaysRouter = require('./routes/specialDays');
const notesRouter = require('./routes/notes');
const notesSecurityRouter = require('./routes/notesSecurity');
const noteFoldersRouter = require('./routes/noteFolders');
const noteImagesRouter = require('./routes/noteImages');
const finanzasAccountsRouter = require('./routes/finanzasAccounts');
const finanzasCategoriesRouter = require('./routes/finanzasCategories');
const finanzasTransactionsRouter = require('./routes/finanzasTransactions');
const finanzasInvestmentsRouter = require('./routes/finanzasInvestments');
const finanzasSettingsRouter = require('./routes/finanzasSettings');
const updateRouter = require('./routes/update');
const { startReminderChecker } = require('./reminderChecker');
const { startMdns } = require('./mdns');

const PORT = process.env.PORT || 3000;
const app = express();

// Momento en el que arranco este proceso. npm run dev reinicia el proceso
// entero cada vez que cambia un archivo de server/, asi que este valor
// cambia en cada reinicio: la pagina lo usa para darse cuenta de que hay
// una version nueva del servidor y avisar para recargar (ver /api/version
// y checkForUpdate() en app.js).
const SERVER_STARTED_AT = Date.now();

app.use(express.json());

app.get('/api/version', (req, res) => {
  res.json({ startedAt: SERVER_STARTED_AT });
});

// Rutas de datos: exigen ser el propio ordenador O un movil ya emparejado.
app.use('/api/events', requireDeviceOrTrusted, eventsRouter);
app.use('/api/reminders', requireDeviceOrTrusted, remindersRouter);
app.use('/api/groups', requireDeviceOrTrusted, groupsRouter);
app.use('/api/themes', requireDeviceOrTrusted, themesRouter);
app.use('/api/profile', requireDeviceOrTrusted, profileRouter);
app.use('/api/special-days', requireDeviceOrTrusted, specialDaysRouter);
app.use('/api/notes', requireDeviceOrTrusted, notesRouter);
app.use('/api/notes-security', requireDeviceOrTrusted, notesSecurityRouter);
app.use('/api/note-folders', requireDeviceOrTrusted, noteFoldersRouter);
// Sin requireDeviceOrTrusted aqui: subir una imagen si lo exige (lo hace
// el propio router, ver routes/noteImages.js), pero SERVIRLA no puede --
// un <img src="..."> lo pide el navegador directamente, sin poder llevar
// el token del movil emparejado.
app.use('/api/notes/images', noteImagesRouter);
// Extension "Finanzas" (ver #extensions-view en index.html): gastos,
// ingresos e inversiones (solo registro manual, sin API de cotizaciones).
app.use('/api/finanzas-accounts', requireDeviceOrTrusted, finanzasAccountsRouter);
app.use('/api/finanzas-categories', requireDeviceOrTrusted, finanzasCategoriesRouter);
app.use('/api/finanzas-transactions', requireDeviceOrTrusted, finanzasTransactionsRouter);
app.use('/api/finanzas-investments', requireDeviceOrTrusted, finanzasInvestmentsRouter);
app.use('/api/finanzas-settings', requireDeviceOrTrusted, finanzasSettingsRouter);
// Rutas de dispositivos: cada endpoint decide su propio nivel de acceso
// internamente (pair es publico-con-codigo, el resto es solo-ordenador).
app.use('/api/devices', devicesRouter);
// Comprobar/instalar version nueva: solo el ordenador (cada ruta lo exige
// por dentro, ver routes/update.js).
app.use('/api/update', updateRouter);

// La app web (HTML/CSS/JS) vive en /public y se sirve tal cual.
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`RemindMeLater escuchando en el puerto ${PORT}`);
  console.log(`  En este ordenador: http://localhost:${PORT}`);

  // El nombre por mDNS (remindmelater.local, ver mdns.js) es la forma
  // recomendada de conectar desde el movil: un solo nombre fijo, sin
  // importar cuantos adaptadores de red tenga este ordenador. Se deja
  // tambien el listado de IPs por adaptador como respaldo, por si la red
  // del movil no resuelve nombres .local (pasa en algunas redes wifi
  // publicas o routers antiguos).
  startMdns(PORT);

  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  Desde el movil, por IP (respaldo si el mDNS no llega): http://${net.address}:${PORT}`);
      }
    }
  }

  startReminderChecker();
});

// Sin este manejador, que el puerto ya este ocupado (por ejemplo, si ya
// tenias "npm run dev" abierto en otra terminal y ademas arrancas
// "npm run electron") tira abajo el proceso entero con una excepcion sin
// capturar — en Electron eso se ve como un dialogo de error nada mas
// abrir. La app igualmente termina abriendose porque electron/main.js
// espera a que ALGUN servidor responda en ese puerto (waitForServer), asi
// que aqui basta con avisar por consola en vez de reventar el proceso.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(
      `El puerto ${PORT} ya esta en uso (seguramente otra instancia de RemindMeLater ya esta corriendo) — sigo sin levantar un segundo servidor.`
    );
  } else {
    throw err;
  }
});
