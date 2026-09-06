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

// Como no hay bundler, el plugin hay que REGISTRARLO a mano. Esto costo
// una ronda entera de "el interruptor no hace nada": la app nativa
// inyecta su puente con el sistema, pero ese puente NO rellena
// Capacitor.Plugins por su cuenta -- eso solo pasa cuando alguien llama a
// registerPlugin(), que normalmente hace el `import` del paquete del
// plugin. Sin import (ni bundler que lo resuelva),
// Capacitor.Plugins.LocalNotifications era undefined SIEMPRE, asi que el
// interruptor se quedaba deshabilitado, nunca se pedia permiso, y por eso
// iOS ni siquiera mostraba el apartado de notificaciones de la app en sus
// Ajustes. Registrandolo aqui, el proxy habla con el plugin nativo igual
// que lo haria el paquete oficial.
//
// Se registra una sola vez y se cachea; se hace de forma perezosa (no al
// cargar el archivo) porque el puente puede no estar listo todavia.
let localNotificationsPlugin = null;

function getLocalNotificationsPlugin() {
  if (localNotificationsPlugin) return localNotificationsPlugin;
  const cap = window.Capacitor;
  // Fuera de la app empaquetada (un navegador normal) no hay plugin: el
  // proxy existiria igual, pero cada llamada fallaria con
  // "not implemented", que es peor que no tenerlo.
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  if (cap.Plugins && cap.Plugins.LocalNotifications) {
    localNotificationsPlugin = cap.Plugins.LocalNotifications;
  } else if (window.capacitorExports && typeof window.capacitorExports.registerPlugin === 'function') {
    localNotificationsPlugin = window.capacitorExports.registerPlugin('LocalNotifications');
  }
  return localNotificationsPlugin;
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

// Pide el permiso del sistema LA PRIMERA VEZ que se abre la app, sin
// tener que ir a Configuracion a buscarlo -- que es lo que pidio Koku
// ("que no me tenga que ir hasta ahi la primera vez, no seria
// intuitivo"). Se marca en localStorage que ya se pregunto, asi que:
// - Si dice que si, los avisos quedan activados.
// - Si dice que no, no se vuelve a preguntar NUNCA desde aqui (iOS
//   tampoco deja volver a preguntar: hay que ir a los Ajustes del
//   telefono), y el interruptor de Configuracion sigue ahi para
//   apagarlos/encenderlos como cualquier otro ajuste.
async function maybeAskNotificationPermissionOnStartup() {
  if (!localNotificationsAvailable()) return;
  if (localStorage.getItem('notificationsPermissionAsked') === '1') return;
  localStorage.setItem('notificationsPermissionAsked', '1');
  const concedido = await ensureLocalNotificationPermission();
  // El ajuste propio de la app sigue el resultado: si no hay permiso del
  // sistema, no tiene sentido dejarlo "encendido" prometiendo avisos que
  // nunca van a sonar.
  localStorage.setItem('notificationsEnabled', concedido ? 'true' : 'false');
  if (typeof refreshMobileTab === 'function') refreshMobileTab();
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
    // Los ids a partir de 999999900 estan RESERVADOS para avisos internos
    // de la app que no son eventos del calendario (por ejemplo, el fin del
    // descanso entre series del Gimnasio, id 999999901). Esos no se tocan
    // desde aqui: los programa y cancela quien los creo. Sin este filtro,
    // guardar cualquier evento reprogramaria los recordatorios y de paso
    // se cargaria el aviso de descanso en mitad de un entrenamiento.
    const cancelables = pendientes.notifications.filter((n) => n.id < 999999900);
    if (cancelables.length > 0) {
      await plugin.cancel({ notifications: cancelables.map((n) => ({ id: n.id })) });
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
        // Sin `sound`, iOS entrega la notificacion en silencio (ni suena
        // ni vibra). "default" no existe como archivo, y por eso iOS cae
        // al sonido del sistema de siempre.
        sound: 'default',
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
