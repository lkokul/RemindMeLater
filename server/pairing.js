// pairing.js — codigos de emparejamiento temporales.
// Viven solo en memoria (no en la base de datos): son de usar-y-tirar,
// duran 30 segundos y desaparecen si reinicias el servidor. Eso esta
// bien, porque su unico trabajo es autorizar UNA vez a un movil nuevo;
// despues el movil usa su token permanente (guardado en la tabla
// devices). 30 segundos (antes 5 minutos) para reducir la ventana en la
// que alguien en la misma wifi podria intentar adivinar un codigo de 6
// digitos -- ver tambien el limite de intentos fallidos mas abajo, que
// cubre la otra mitad del mismo problema (cuantas veces se puede
// intentar, no solo cuanto dura cada intento).
const crypto = require('crypto');

const CODE_TTL_MS = 30 * 1000; // 30 segundos
const codes = new Map(); // code -> expiresAt (timestamp)

function generateCode() {
  // Codigo de 6 digitos, facil de teclear en el movil.
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expiresAt = Date.now() + CODE_TTL_MS;
  codes.set(code, expiresAt);
  return { code, expiresAt };
}

function consumeCode(code) {
  const expiresAt = codes.get(code);
  if (!expiresAt) return false;
  codes.delete(code); // de un solo uso
  return Date.now() <= expiresAt;
}

// --- Limite de intentos fallidos de POST /pair, por IP -----------------
// Vive aqui (junto a los codigos) porque protege el mismo punto de
// entrada: /pair es la unica ruta de la API sin ningun token exigido
// (tiene que serlo, es como se consigue el primer token), asi que es el
// unico sitio por el que alguien podria intentar adivinar el codigo de
// 6 digitos a base de probar muchas veces seguidas. Por IP
// (req.socket.remoteAddress, mismo dato que usa isTrustedRequest en
// auth.js), no de forma global, para que un vecino de la wifi
// intentando codigos al azar no pueda bloquear sin querer al propio
// Koku emparejando su movil desde otra IP de la misma red.
const MAX_FAILED_ATTEMPTS = 5;
// 10 minutos de bloqueo tras agotar los intentos: bastante para
// desanimar a alguien probando codigos a mano o con un script sencillo
// (que ademas ya solo tiene 30s de ventana por codigo antes de que
// caduque), pero corto para que si es el propio Koku equivocandose
// varias veces tecleando no se quede bloqueado toda la tarde -- generar
// un codigo nuevo en el ordenador no cuenta para este bloqueo (eso ya
// esta protegido por requireTrusted), solo cuenta fallar al emparejarse.
const LOCKOUT_MS = 10 * 60 * 1000;
const failedAttempts = new Map(); // ip -> { count, lockedUntil, lastAttemptAt }

function isPairingLocked(ip) {
  const entry = failedAttempts.get(ip);
  return !!(entry && entry.lockedUntil && Date.now() < entry.lockedUntil);
}

function recordFailedPairing(ip) {
  const entry = failedAttempts.get(ip) || { count: 0, lockedUntil: null };
  entry.count += 1;
  entry.lastAttemptAt = Date.now();
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  failedAttempts.set(ip, entry);
}

function recordSuccessfulPairing(ip) {
  failedAttempts.delete(ip); // exito: se olvida el historial de fallos de esa IP
}

// Limpieza periodica de codigos caducados y de intentos fallidos ya
// resueltos, para no acumular basura en memoria.
setInterval(() => {
  const now = Date.now();
  for (const [code, expiresAt] of codes) {
    if (now > expiresAt) codes.delete(code);
  }
  for (const [ip, entry] of failedAttempts) {
    const stillLocked = entry.lockedUntil && now < entry.lockedUntil;
    if (stillLocked) continue;
    // Bloqueo ya cumplido, o nunca llego a bloquear y lleva mas de 30
    // minutos sin ningun intento nuevo: se olvida del todo.
    if (entry.lockedUntil || now - entry.lastAttemptAt > 30 * 60 * 1000) {
      failedAttempts.delete(ip);
    }
  }
}, 60 * 1000).unref();

module.exports = {
  generateCode,
  consumeCode,
  isPairingLocked,
  recordFailedPairing,
  recordSuccessfulPairing,
};
