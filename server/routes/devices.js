// routes/devices.js — emparejar moviles y gestionarlos desde el ordenador.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireTrusted } = require('../auth');
const { generateCode, consumeCode } = require('../pairing');

const router = express.Router();

// Solo el ordenador puede pedir un codigo nuevo (evita que un desconocido
// en tu wifi genere codigos para si mismo).
router.post('/pairing-code', requireTrusted, (req, res) => {
  const { code, expiresAt } = generateCode();
  res.json({ code, expiresAt });
});

// Cualquiera en la red puede LLAMAR a este endpoint, pero solo funciona si
// trae un codigo valido y no caducado generado en el paso anterior. Es el
// unico momento en que un dispositivo "de fuera" puede entrar.
router.post('/pair', (req, res) => {
  const { code, name } = req.body || {};
  if (!code || !name || !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta el codigo o el nombre del dispositivo.' });
  }
  if (!consumeCode(String(code).trim())) {
    return res.status(400).json({ error: 'invalid_code', message: 'Codigo incorrecto o caducado. Genera uno nuevo en el ordenador.' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const info = db
    .prepare('INSERT INTO devices (name, token) VALUES (?, ?)')
    .run(name.trim(), token);

  res.status(201).json({ deviceId: info.lastInsertRowid, token, name: name.trim() });
});

// Ver y revocar dispositivos: solo desde el ordenador.
router.get('/', requireTrusted, (req, res) => {
  const devices = db
    .prepare('SELECT id, name, icon, paired_at, last_seen_at FROM devices ORDER BY paired_at DESC')
    .all();
  res.json(devices.map((d) => ({ ...d, icon: d.icon || null })));
});

function sanitizeIcon(icon) {
  if (icon === undefined) return undefined; // "no lo toques"
  if (icon === null || icon === '') return null; // "quitalo"
  return String(icon).slice(0, 8); // ver groups.js para el porque de este limite
}

// Renombrar y/o cambiar el icono de un dispositivo. El nombre sigue
// siendo texto libre (por si alguien prefiere seguir metiendo el emoji
// ahi), pero ahora tambien hay un icono APARTE, pensado para eso.
router.patch('/:id', requireTrusted, (req, res) => {
  const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, icon } = req.body || {};
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'El nombre no puede estar vacio.' });
  }
  const sanitizedIcon = sanitizeIcon(icon);

  db.prepare('UPDATE devices SET name = ?, icon = ? WHERE id = ?').run(
    name !== undefined ? name.trim() : existing.name,
    sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
    req.params.id
  );

  const row = db.prepare('SELECT id, name, icon, paired_at, last_seen_at FROM devices WHERE id = ?').get(req.params.id);
  res.json({ ...row, icon: row.icon || null });
});

router.delete('/:id', requireTrusted, (req, res) => {
  const info = db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
