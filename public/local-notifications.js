// local-notifications.js — recordatorios que avisan con la app CERRADA.
//
// Antes esto lo hacia el ordenador: un proceso encendido las 24h
// (server/reminderChecker.js) miraba cada 30s si tocaba avisar, y para
// llegar al movil con la app cerrada hacia falta ademas Web Push, que
// obliga a pasar por los servidores de Google/Apple. Sin servidor, la
// forma correcta en una app empaquetada es PROGRAMAR el aviso en el
// propio dispositivo: se le dice al sistema "avisa el dia X a la hora
// Y", y el sistema lo hace aunque la app este cerrada del todo, sin
// que nada salga del telefono.
//
// En un navegador normal (probando desde el ordenador) el plugin no
// existe: entonces esto no hace nada y se sigue avisando como siempre
// mientras la app esta abierta (ver loadReminders() en app.js).

// El plugin solo existe dentro de la app empaquetada (Capacitor lo
// inyecta). Se comprueba en cada llamada, no una vez al cargar, porque
// este archivo puede evaluarse antes de que Capacitor termine de
// registrar sus plugins.
function getLocalNotificationsPlugin() {
  const cap = window.Capacitor;
  return (cap && cap.Plugins && cap.Plugins.LocalNotifications) || null;
}

function localNotificationsAvailable() {
  return getLocalNotificationsPlugin() !== null;
}

// Pide permiso al sistema. Se llama desde el interruptor de
// Configuracion > Este dispositivo (nunca sola al arrancar: iOS y
// Android exigen que el permiso se pida a raiz de algo que haya hecho
// el usuario, y ademas preguntar de golpe al abrir es de mala
// educacion). Devuelve true si quedo concedido.
async function ensureLocalNotificationPermission() {
  const plugin = getLocalNotificationsPlugin();
  if (!plugin) return false;
  const actual = await plugin.checkPermissions();
  if (actual.display === 'granted') return true;
  const pedido = await plugin.requestPermissions();
  return pedido.display === 'granted';
}

// Vuelve a programar TODOS los avisos futuros desde cero: primero
// cancela lo que hubiera programado, luego programa lo que toca ahora.
// Es a proposito "borrar y rehacer" en vez de ir tocando avisos uno a
// uno -- asi no hay forma de que quede un aviso huerfano de un evento
// que se borro o se movio de hora, que es justo el tipo de fallo que
// nadie ve hasta que suena un aviso de algo que ya no existe.
async function syncScheduledReminders() {
  const plugin = getLocalNotificationsPlugin();
  if (!plugin) return;
  // Respeta el mismo interruptor de siempre (Configuracion > Este
  // dispositivo): si estan apagados, se cancela todo y no se programa
  // nada nuevo.
  const activados = localStorage.getItem('notificationsEnabled') !== 'false';

  try {
    const pendientes = await plugin.getPending();
    if (pendientes.notifications.length > 0) {
      await plugin.cancel({ notifications: pendientes.notifications.map((n) => ({ id: n.id })) });
    }
    if (!activados) return;
    if (!(await ensureLocalNotificationPermissionSilently())) return;

    const proximos = await api('/api/reminders/upcoming');
    const ahora = Date.now();
    const aProgramar = proximos
      .filter((r) => new Date(r.remindAt).getTime() > ahora)
      .map((r) => ({
        // El id del evento vale como id del aviso: es un entero unico y
        // estable, asi que reprogramar el mismo evento nunca duplica.
        id: r.eventId,
        title: 'RemindMeLater',
        body: r.title,
        schedule: { at: new Date(r.remindAt) },
      }));
    if (aProgramar.length > 0) await plugin.schedule({ notifications: aProgramar });
  } catch (err) {
    // Que falle programar un aviso nunca debe romper lo que el usuario
    // estaba haciendo (guardar un evento, abrir la app...).
    console.error('No se pudieron programar los recordatorios:', err);
  }
}

// Como ensureLocalNotificationPermission, pero SIN preguntar: solo mira
// si ya esta concedido. Es lo que hace falta al reprogramar avisos por
// dentro, donde no hay ningun gesto del usuario detras.
async function ensureLocalNotificationPermissionSilently() {
  const plugin = getLocalNotificationsPlugin();
  if (!plugin) return false;
  const actual = await plugin.checkPermissions();
  return actual.display === 'granted';
}
