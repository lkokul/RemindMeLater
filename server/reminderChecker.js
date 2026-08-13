// reminderChecker.js — el "reloj" que dispara notificaciones del sistema
// operativo en el ordenador donde corre el servidor.
//
// Por que aqui y no solo en el navegador: el navegador solo puede avisar
// mientras tienes la pestana abierta. Este chequeo vive en el servidor,
// que en tu ordenador puede quedarse encendido, asi que es el sitio mas
// fiable para el aviso "de verdad" en el PC. El movil, mientras tanto,
// muestra su propio aviso en pantalla cuando tiene la app abierta
// (ver public/app.js) — avisos push al movil con la app cerrada quedaria
// para una fase futura, porque exige un servicio de push real.
const notifier = require('node-notifier');
const db = require('./db');

const CHECK_INTERVAL_MS = 30 * 1000;

function checkAndFireReminders() {
  const due = db
    .prepare(`
      SELECT id, title, start_at
      FROM events
      WHERE reminder_minutes_before IS NOT NULL
        AND reminder_sent = 0
        AND datetime(start_at, '-' || reminder_minutes_before || ' minutes') <= datetime('now')
    `)
    .all();

  for (const event of due) {
    notifier.notify({
      title: 'RemindMeLater',
      message: event.title,
      sound: true,
    });
    db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(event.id);
  }
}

function startReminderChecker() {
  checkAndFireReminders();
  const timer = setInterval(checkAndFireReminders, CHECK_INTERVAL_MS);
  timer.unref(); // no impide que el proceso termine si hace falta
  return timer;
}

module.exports = { startReminderChecker };
