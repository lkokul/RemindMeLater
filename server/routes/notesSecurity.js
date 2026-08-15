// routes/notesSecurity.js — ajuste opcional de "ocultar notas con
// contraseña" (ver routes/notes.js). Ojo: esto NO es un bloqueo de
// verdad (no cifra nada, no protege frente a quien tenga acceso a la
// base de datos) — solo evita que una nota se lea a primera vista en la
// pantalla. Un unico ajuste compartido por toda la app (no por
// dispositivo, como el nickname del perfil), guardado en app_settings
// (clave/valor generico que ya existia). La contraseña en si nunca se
// guarda en claro: se guarda "salt:hash" con scrypt (integrado en Node,
// sin dependencias nuevas).
const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

const KEY_ENABLED = 'notes_hide_password_enabled';
const KEY_HASH = 'notes_hide_password_hash';

function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  // Comparacion a tiempo constante: evita que alguien adivine la
  // contraseña midiendo cuanto tarda en responder cada intento.
  const hashBuf = Buffer.from(hash, 'hex');
  const checkBuf = Buffer.from(check, 'hex');
  if (hashBuf.length !== checkBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, checkBuf);
}

router.get('/', (req, res) => {
  res.json({
    passwordEnabled: getSetting(KEY_ENABLED) === '1',
    hasPassword: !!getSetting(KEY_HASH),
  });
});

router.put('/', (req, res) => {
  const { enabled } = req.body || {};
  setSetting(KEY_ENABLED, enabled ? '1' : '0');
  res.json({
    passwordEnabled: getSetting(KEY_ENABLED) === '1',
    hasPassword: !!getSetting(KEY_HASH),
  });
});

// Pone o cambia la contraseña. Si ya habia una, hay que mandar la actual
// (currentPassword) y coincidir para poder cambiarla; si todavia no hay
// ninguna, se ignora currentPassword y se pone la nueva directamente.
router.post('/password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || !newPassword.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta la contraseña nueva.' });
  }

  const existingHash = getSetting(KEY_HASH);
  if (existingHash) {
    if (!currentPassword || !verifyPassword(currentPassword, existingHash)) {
      return res.status(403).json({ error: 'wrong_password', message: 'La contraseña actual no es correcta.' });
    }
  }

  setSetting(KEY_HASH, hashPassword(newPassword.trim()));
  res.json({ ok: true });
});

router.post('/verify', (req, res) => {
  const { password } = req.body || {};
  const stored = getSetting(KEY_HASH);
  const ok = !!password && verifyPassword(password, stored);
  res.json({ ok });
});

module.exports = router;
