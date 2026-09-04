// reminderChecker.js — el "reloj" que dispara los avisos de recordatorio.
//
// Por que vive aqui y no en la ventana: el codigo de la pagina solo puede
// avisar mientras la ventana esta abierta y despierta. Esto corre en el
// proceso principal de Electron (lo arranca electron/main.js), que sigue
// vivo aunque la ventana este minimizada, asi que es el sitio fiable
// para el aviso de verdad.
//
// Antes este mismo archivo mandaba ademas un aviso push al movil con la
// app cerrada (Web Push). Eso desaparecio junto con el resto de la parte
// de red: la app de escritorio ya no habla con ningun otro dispositivo.
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
    // El propio flag en la fila es lo que evita avisar dos veces del
    // mismo evento en el siguiente repaso, 30 segundos despues.
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
