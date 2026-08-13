// routes/specialDays.js — dias marcados a mano como "festivo" o
// "especial". No hay forma automatica de saber que dia es festivo (varia
// por pais/region), asi que en vez de intentar adivinarlo se deja que la
// persona los marque ella misma desde el panel de dia (ver app.js,
// openDayModal). Es una lista compartida entre todos los dispositivos,
// igual que los grupos o los temas.
const express = require('express');
const db = require('../db');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TYPES = ['holiday', 'special'];

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT date, type FROM special_days').all();
  res.json(rows);
});

router.put('/:date', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'invalid_request', message: 'Fecha invalida, se espera YYYY-MM-DD.' });
  }

  const { type } = req.body || {};

  if (type === null || type === undefined) {
    db.prepare('DELETE FROM special_days WHERE date = ?').run(date);
    return res.json({ date, type: null });
  }

  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: 'invalid_request', message: "type tiene que ser 'holiday', 'special' o null." });
  }

  db.prepare(
    'INSERT INTO special_days (date, type) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET type = excluded.type'
  ).run(date, type);
  res.json({ date, type });
});

module.exports = router;
