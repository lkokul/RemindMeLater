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
const { startReminderChecker } = require('./reminderChecker');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());

// Rutas de datos: exigen ser el propio ordenador O un movil ya emparejado.
app.use('/api/events', requireDeviceOrTrusted, eventsRouter);
app.use('/api/reminders', requireDeviceOrTrusted, remindersRouter);
app.use('/api/groups', requireDeviceOrTrusted, groupsRouter);
app.use('/api/themes', requireDeviceOrTrusted, themesRouter);
// Rutas de dispositivos: cada endpoint decide su propio nivel de acceso
// internamente (pair es publico-con-codigo, el resto es solo-ordenador).
app.use('/api/devices', devicesRouter);

// La app web (HTML/CSS/JS) vive en /public y se sirve tal cual.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`RemindMeLater escuchando en el puerto ${PORT}`);
  console.log(`  En este ordenador: http://localhost:${PORT}`);

  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  Desde el movil (misma wifi): http://${net.address}:${PORT}`);
      }
    }
  }

  startReminderChecker();
});
