// push.js — notificaciones push de verdad en el movil (avisan con la app
// CERRADA del todo, no solo mientras esta abierta -- eso ya lo hace
// server/reminderChecker.js, que sigue disparando su aviso normal en el
// PROPIO ordenador via node-notifier sin tocar nada de aqui).
//
// Usa el estandar Web Push: cada movil emparejado, al activar el ajuste
// "Notificaciones" en su Configuracion > Este dispositivo, se suscribe
// desde el navegador (pushManager.subscribe) y manda esa suscripcion al
// servidor (ver routes/devices.js, POST /push-subscription). Para poder
// mandar un aviso hace falta un par de claves VAPID que identifican a
// ESTE servidor -- no son secretas por dispositivo, son de la
// instalacion entera, asi que se generan UNA sola vez y se guardan en
// disco junto a la base de datos: si se regeneraran en cada arranque,
// se invalidarian todas las suscripciones que los moviles ya tuvieran
// guardadas.
//
// Importante para el porque de esto (ver tambien CLAUDE.md): el AVISO en
// si, aunque el resto de la app sea local-first sin ningun servidor
// intermedio, tiene que pasar obligatoriamente por los servidores de
// Google (Android/Chrome) o Apple (iPhone/Safari) -- es la UNICA forma
// en que el sistema operativo del movil puede despertar la app estando
// cerrada, no hay manera de evitarlo con el estandar Web Push. El
// contenido va cifrado de extremo a extremo (parte del propio
// protocolo), asi que Google/Apple no pueden leer el titulo del
// recordatorio, solo mueven bytes cifrados.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const db = require('./db');

const VAPID_KEYS_FILE = path.join(db.DATA_DIR, 'vapid-keys.json');

function loadOrCreateVapidKeys() {
  if (fs.existsSync(VAPID_KEYS_FILE)) {
    return JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf8'));
  }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(keys, null, 2));
  return keys;
}

const vapidKeys = loadOrCreateVapidKeys();

function getVapidPublicKey() {
  return vapidKeys.publicKey;
}

// El correo de contacto VAPID lo elige Koku a mano en Configuracion >
// Perfil (nunca hardcodeado, ver user_profile.email) -- si todavia no lo
// ha rellenado, sencillamente no se puede mandar ningun aviso push, el
// protocolo lo exige como campo obligatorio.
function getVapidSubject() {
  const profile = db.prepare('SELECT email FROM user_profile WHERE id = 1').get();
  return profile && profile.email ? `mailto:${profile.email}` : null;
}

// Manda un aviso push a UN dispositivo que ya tenga guardada su
// suscripcion. Devuelve { ok:true } si se mando de verdad, o
// { ok:false, reason } si no se pudo -- "expired" significa que la
// suscripcion ya no es valida (desinstalo la PWA, cambio de movil...),
// para que quien llame la borre de la base de datos y no siga
// reintentando en vano; cualquier otro fallo (de red, etc.) se deja
// pasar como excepcion normal.
async function sendPushToDevice(device, payload) {
  const subject = getVapidSubject();
  if (!subject) return { ok: false, reason: 'no_email' };
  if (!device.push_subscription) return { ok: false, reason: 'not_subscribed' };

  const subscription = JSON.parse(device.push_subscription);
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: { subject, publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey },
    });
    return { ok: true };
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      return { ok: false, reason: 'expired' };
    }
    throw err;
  }
}

module.exports = { getVapidPublicKey, getVapidSubject, sendPushToDevice };
