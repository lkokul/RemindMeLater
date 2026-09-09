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

// Como debe avisar una notificacion, segun los dos on-off de Sonido y
// Vibracion (Configuracion > Este dispositivo). Devuelve el valor para
// el campo `sound`, o null si no hay que ponerlo:
// - Sonido ON            -> "default": el sonido del sistema. OJO: con
//   sonido, vibrar o no lo decide el TELEFONO (Ajustes > Sonidos y
//   vibraciones) -- iOS no deja quitar la vibracion por app, asi que el
//   toggle de Vibracion no pinta nada en este caso.
// - Sonido OFF + Vibr ON -> "silencio.wav": medio segundo de silencio
//   empaquetado DENTRO de la app. iOS lo "reproduce" como sonido (no se
//   oye nada) y justo por eso dispara la vibracion. Es el unico truco
//   que iOS permite para vibrar sin sonar.
// - Los dos OFF          -> null: sin campo sound, el aviso es solo visual.
function notificationSoundValue() {
  const sonido = localStorage.getItem('notifSound') !== 'false';
  const vibrar = localStorage.getItem('notifVibrate') !== 'false';
  if (sonido) return 'default';
  if (vibrar) return 'silencio.wav';
  return null;
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

// LA PRIMERA VEZ que se abre la app instalada, en vez de pedir el
// permiso del sistema "a pelo", se ensena el dialogo #permissions-modal
// explicando que puede activar y que no (peticion de Koku: "que al
// instalar la app te muestre para activar o dejar desactivadas todas
// estas cosas"). Solo una vez (notificationsPermissionAsked):
// - "Permitir avisos" lanza el dialogo REAL de permiso de iOS (que
//   tampoco se puede repetir: si se niega ahi, luego hay que ir a los
//   Ajustes del telefono).
// - "Ahora no" deja los avisos apagados; el interruptor de Configuracion
//   sigue disponible para activarlos cuando se quiera.
async function maybeAskNotificationPermissionOnStartup() {
  if (!localNotificationsAvailable()) return;
  if (localStorage.getItem('notificationsPermissionAsked') === '1') return;
  document.getElementById('permissions-modal').classList.remove('hidden');
}

document.getElementById('btn-permissions-allow').addEventListener('click', async () => {
  localStorage.setItem('notificationsPermissionAsked', '1');
  document.getElementById('permissions-modal').classList.add('hidden');
  const concedido = await ensureLocalNotificationPermission();
  // El ajuste propio de la app sigue el resultado: si no hay permiso del
  // sistema, no tiene sentido dejarlo "encendido" prometiendo avisos que
  // nunca van a sonar.
  localStorage.setItem('notificationsEnabled', concedido ? 'true' : 'false');
  if (concedido) await syncScheduledReminders();
  if (typeof refreshMobileTab === 'function') refreshMobileTab();
});
document.getElementById('btn-permissions-later').addEventListener('click', () => {
  localStorage.setItem('notificationsPermissionAsked', '1');
  localStorage.setItem('notificationsEnabled', 'false');
  document.getElementById('permissions-modal').classList.add('hidden');
  if (typeof refreshMobileTab === 'function') refreshMobileTab();
});

// Canal de Android para los recordatorios, con la VIBRACION activada.
// Hace falta porque el canal por defecto del plugin no la activa
// (comprobado en su codigo fuente: crea el canal sin enableVibration),
// asi que los avisos llegaban sin vibrar. En Android 8+ el sonido y la
// vibracion pertenecen al CANAL, no al aviso individual -- por eso se
// crea uno propio una vez y cada aviso se manda por el. En iOS este
// metodo no existe (los canales son cosa de Android): se salta.
const REMINDERS_CHANNEL_ID = 'recordatorios';
let remindersChannelReady = false;

async function ensureRemindersChannel(plugin) {
  if (remindersChannelReady) return true;
  const cap = window.Capacitor;
  if (!cap || typeof cap.getPlatform !== 'function' || cap.getPlatform() !== 'android') return false;
  try {
    await plugin.createChannel({
      id: REMINDERS_CHANNEL_ID,
      name: 'Recordatorios',
      description: 'Avisos de eventos y tareas',
      importance: 4, // alta: suena, vibra y asoma arriba de la pantalla
      vibration: true,
    });
    remindersChannelReady = true;
  } catch (err) {
    // Si el canal no se pudo crear, mejor NO mandar los avisos por el
    // (un aviso con un canal inexistente no se muestra): se cae al
    // canal por defecto del plugin, que al menos llega aunque no vibre.
    console.error('No se pudo crear el canal de recordatorios:', err);
  }
  return remindersChannelReady;
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

    const canalListo = await ensureRemindersChannel(plugin);

    const proximos = await api('/api/reminders/upcoming');
    const ahora = Date.now();
    const sonido = notificationSoundValue();
    const aProgramar = proximos
      .filter((r) => new Date(r.remindAt).getTime() > ahora)
      .map((r) => {
        const aviso = {
          // El id del evento vale como id del aviso: es un entero unico y
          // estable, asi que reprogramar el mismo evento nunca duplica.
          id: r.eventId,
          title: 'RemindMeLater',
          body: r.title,
          schedule: { at: new Date(r.remindAt) },
        };
        // Sin `sound`, en iOS el aviso llega EN SILENCIO TOTAL: ni suena
        // ni vibra (alli la vibracion va pegada al sonido, y el plugin
        // solo pone sonido si se le pasa uno). Cual de los tres valores
        // toca lo decide notificationSoundValue() a partir de los dos
        // interruptores de Configuracion (Sonido / Vibracion).
        if (sonido) aviso.sound = sonido;
        // Android: alli el sonido y la vibracion los manda el CANAL, no
        // este campo -- por eso se le engancha el canal propio si se
        // pudo crear (ver ensureRemindersChannel arriba).
        if (canalListo) aviso.channelId = REMINDERS_CHANNEL_ID;
        return aviso;
      });
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
