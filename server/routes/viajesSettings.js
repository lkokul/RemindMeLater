// routes/viajesSettings.js — un ajuste global: la cuenta de Finanzas por
// defecto para gastos/ingresos de viaje ("de normal un gasto de viaje
// siempre se añade en la misma cuenta") -- precarga esa cuenta al crear
// un movimiento nuevo, siempre editable por movimiento. Guardado en
// app_settings (clave/valor generica), mismo patron que
// routes/archivos.js con "archivosFolder". El interruptor de "enlazar
// con Finanzas" que vivia aqui antes ahora es POR VIAJE
// (viajes_trips.finanzas_linked, ver db.js y routes/viajesTrips.js) --
// se quito de aqui a peticion de Koku (prefiere decidirlo viaje a
// viaje, no con un unico interruptor para todos).
const express = require('express');
const db = require('../db');

const router = express.Router();

function getDefaultAccountId() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'viajesDefaultAccountId'").get();
  if (!row || !row.value) return null;
  const id = Number(row.value);
  return Number.isFinite(id) ? id : null;
}

router.get('/', (req, res) => {
  res.json({ defaultAccountId: getDefaultAccountId() });
});

router.put('/', (req, res) => {
  const { defaultAccountId } = req.body || {};
  if (defaultAccountId) {
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('viajesDefaultAccountId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(String(defaultAccountId));
  } else {
    db.prepare("DELETE FROM app_settings WHERE key = 'viajesDefaultAccountId'").run();
  }
  res.json({ defaultAccountId: getDefaultAccountId() });
});

module.exports = router;
module.exports.getDefaultAccountId = getDefaultAccountId;
