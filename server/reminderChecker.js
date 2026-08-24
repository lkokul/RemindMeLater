// reminderChecker.js — el "reloj" que dispara los avisos de recordatorio
// de verdad, tanto en el ordenador como en los moviles emparejados.
//
// Por que aqui y no solo en el navegador: el navegador solo puede avisar
// mientras tienes la pestana abierta (ver loadReminders en
// public/app.js). Este chequeo vive en el servidor, que en tu ordenador
// puede quedarse encendido, asi que es el sitio mas fiable para el aviso
// "de verdad" en el PC (via node-notifier) Y para el aviso push real al
// movil con la app CERRADA del todo (via server/push.js, Web Push) — los
// dos comparten el mismo flag events.reminder_sent, asi que no hace
// falta ninguna deduplicacion aparte entre canales.
const notifier = require('node-notifier');
const db = require('./db');
const { sendPushToDevice } = require('./push');

const CHECK_INTERVAL_MS = 30 * 1000;

async function checkAndFireReminders() {
  const due = db
    .prepare(`
      SELECT id, title, start_at
      FROM events
      WHERE reminder_minutes_before IS NOT NULL
        AND reminder_sent = 0
        AND datetime(start_at, '-' || reminder_minutes_before || ' minutes') <= datetime('now')
    `)
    .all();

  if (due.length === 0) return;

  // Se consulta una sola vez para todos los recordatorios que toquen en
  // este chequeo, no dentro del bucle de abajo.
  const devicesWithPush = db.prepare('SELECT * FROM devices WHERE push_subscription IS NOT NULL').all();

  for (const event of due) {
    notifier.notify({
      title: 'RemindMeLater',
      message: event.title,
      sound: true,
    });
    db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(event.id);

    for (const device of devicesWithPush) {
      try {
        const result = await sendPushToDevice(device, { title: 'RemindMeLater', body: event.title, eventId: event.id });
        // "expired": el navegador invalido la suscripcion (desinstalo la
        // PWA, cambio de movil...) -- se borra para no reintentar en
        // vano en cada chequeo siguiente. "no_email" no se borra nada,
        // solo falta rellenar el correo en Configuracion > Perfil.
        if (!result.ok && result.reason === 'expired') {
          db.prepare('UPDATE devices SET push_subscription = NULL WHERE id = ?').run(device.id);
        }
      } catch (err) {
        console.warn(`No se pudo mandar el aviso push al dispositivo ${device.id}:`, err.message);
      }
    }
  }
}

function startReminderChecker() {
  checkAndFireReminders();
  const timer = setInterval(checkAndFireReminders, CHECK_INTERVAL_MS);
  timer.unref(); // no impide que el proceso termine si hace falta
  return timer;
}

module.exports = { startReminderChecker };
