// routes/viajesSettings.js — un unico ajuste global (no por dispositivo,
// afecta a los datos que ve todo el mundo): si Viajes puede crear
// movimientos reales en Finanzas al enlazar un ticket. Guardado en
// app_settings (clave/valor generica), mismo patron que
// routes/archivos.js con "archivosFolder" -- no hace falta una tabla
// propia de una sola fila para un solo booleano.
const express = require('express');
const db = require('../db');

const router = express.Router();

function getFinanzasLinked() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'viajesFinanzasLinked'").get();
  return !!(row && row.value === '1');
}

router.get('/', (req, res) => {
  res.json({ finanzasLinked: getFinanzasLinked() });
});

router.put('/', (req, res) => {
  const { finanzasLinked } = req.body || {};
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('viajesFinanzasLinked', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(finanzasLinked ? '1' : '0');
  res.json({ finanzasLinked: !!finanzasLinked });
});

module.exports = router;
module.exports.getFinanzasLinked = getFinanzasLinked;
