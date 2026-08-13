// auth.js — quien puede hablar con la API.
//
// Dos niveles de confianza:
//  1) "Confiable" = la peticion llega desde el propio ordenador (localhost).
//     Es el navegador que abres tu mismo en el PC: siempre tiene via libre.
//  2) Dispositivo emparejado = un movil (u otro equipo) que ya paso una vez
//     por el flujo de codigo de emparejamiento y guarda un token propio.
//     Sin ese token, cualquier otro aparato de la wifi recibe un 401.
const db = require('./db');

function isTrustedRequest(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Aplica a todo lo que toca datos (eventos, recordatorios): deja pasar al
// ordenador siempre, y a moviles solo si mandan un token valido.
function requireDeviceOrTrusted(req, res, next) {
  if (isTrustedRequest(req)) {
    req.isTrusted = true;
    return next();
  }

  const token = req.header('X-Device-Token');
  if (!token) {
    return res.status(401).json({
      error: 'device_not_paired',
      message: 'Este dispositivo no esta vinculado. Introduce el codigo que aparece en el ordenador.',
    });
  }

  const device = db.prepare('SELECT * FROM devices WHERE token = ?').get(token);
  if (!device) {
    return res.status(401).json({
      error: 'device_not_paired',
      message: 'El vinculo de este dispositivo ya no es valido.',
    });
  }

  db.prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?").run(device.id);
  req.device = device;
  req.isTrusted = false;
  next();
}

// Para acciones sensibles (generar codigos, ver/revocar dispositivos):
// solo el propio ordenador puede hacerlas. Un movil emparejado no debe
// poder emparejar ni echar a otros dispositivos.
function requireTrusted(req, res, next) {
  if (!isTrustedRequest(req)) {
    return res.status(403).json({
      error: 'trusted_only',
      message: 'Esta accion solo se puede hacer desde el ordenador.',
    });
  }
  next();
}

module.exports = { isTrustedRequest, requireDeviceOrTrusted, requireTrusted };
