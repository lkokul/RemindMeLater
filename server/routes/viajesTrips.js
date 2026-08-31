// routes/viajesTrips.js — extension "Viajes": el "grupo" de nivel
// superior es un viaje, que puede tocar VARIOS paises (ej. un
// interrail) -- ver viajes_trip_countries en db.js. Borrado en cascada
// A MANO (nunca ON DELETE CASCADE de SQL, mismo criterio que el resto
// del proyecto): borrar un viaje borra sus entradas de bitacora, los
// adjuntos de esas entradas (incluidos los archivos de foto en disco y
// los movimientos de Finanzas que tuvieran enlazados), y las filas de
// paises.
const express = require('express');
const db = require('../db');
const { deleteEntryCascade } = require('./viajesEntries');

const router = express.Router();

function serializeTrip(row) {
  const countries = db
    .prepare('SELECT country_code FROM viajes_trip_countries WHERE trip_id = ? ORDER BY id ASC')
    .all(row.id)
    .map((r) => r.country_code);
  const entryCount = db.prepare('SELECT COUNT(*) as c FROM viajes_entries WHERE trip_id = ?').get(row.id).c;
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    countries,
    startDate: row.start_date || null,
    endDate: row.end_date || null,
    description: row.description || null,
    entryCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateBody(body, existing) {
  const name = body.name !== undefined ? body.name : existing && existing.name;
  if (!name || !String(name).trim()) {
    return { error: 'Falta el nombre del viaje.' };
  }
  const countries = body.countries !== undefined ? body.countries : undefined;
  if (countries !== undefined) {
    if (!Array.isArray(countries) || countries.length === 0) {
      return { error: 'Elige al menos un país.' };
    }
    if (countries.some((c) => typeof c !== 'string' || !c.trim())) {
      return { error: 'Hay un país con un formato raro.' };
    }
  } else if (!existing) {
    return { error: 'Elige al menos un país.' };
  }
  const startDate = body.startDate !== undefined ? body.startDate : existing && existing.start_date;
  const endDate = body.endDate !== undefined ? body.endDate : existing && existing.end_date;
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { error: 'La fecha de inicio tiene que tener el formato YYYY-MM-DD.' };
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { error: 'La fecha de fin tiene que tener el formato YYYY-MM-DD.' };
  }
  if (startDate && endDate && endDate < startDate) {
    return { error: 'La fecha de fin no puede ser anterior a la de inicio.' };
  }
  const color = body.color !== undefined ? body.color : existing ? existing.color : '#5b8cff';

  return {
    name: String(name).trim(),
    countries: countries !== undefined ? countries.map((c) => c.trim().toLowerCase()) : null,
    startDate: startDate || null,
    endDate: endDate || null,
    description: body.description !== undefined ? (String(body.description || '').trim() || null) : existing ? existing.description : null,
    color: color || '#5b8cff',
  };
}

function setTripCountries(tripId, countries) {
  db.prepare('DELETE FROM viajes_trip_countries WHERE trip_id = ?').run(tripId);
  const insert = db.prepare('INSERT OR IGNORE INTO viajes_trip_countries (trip_id, country_code) VALUES (?, ?)');
  for (const code of countries) insert.run(tripId, code);
}

// Borra en cascada, a mano, todo lo que cuelga de un viaje -- cada
// entrada (con sus adjuntos: archivo de foto en disco + movimiento de
// Finanzas enlazado si lo tenia, ver deleteEntryCascade() en
// viajesEntries.js, reutilizada aqui como unica fuente de verdad en
// vez de duplicar esa logica) y las filas de paises. Grabar en
// sync_log el borrado de CADA entrada (no solo el del viaje) es lo que
// permite que un movil se entere de todo lo que desaparecio de verdad
// -- ningun otro borrado en cascada del proyecto necesita esto
// (grupos/carpetas de nota no destruyen contenido, Gimnasio/Finanzas
// rechazan o dejan en NULL).
function deleteTripCascade(tripId, originId) {
  const entries = db.prepare('SELECT id FROM viajes_entries WHERE trip_id = ?').all(tripId);
  entries.forEach((entry) => deleteEntryCascade(entry.id, originId));
  db.prepare('DELETE FROM viajes_trip_countries WHERE trip_id = ?').run(tripId);
  db.prepare('DELETE FROM viajes_trips WHERE id = ?').run(tripId);
  db.recordSyncChange('viajes_trips', tripId, 'delete', null, originId);
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM viajes_trips ORDER BY COALESCE(start_date, created_at) DESC, id DESC').all();
  res.json(rows.map(serializeTrip));
});

// Todos los viajes que tocan un pais concreto -- lo usa el mapa al
// clicar un pais.
router.get('/by-country/:code', (req, res) => {
  const code = String(req.params.code).toLowerCase();
  const rows = db
    .prepare(
      `SELECT t.* FROM viajes_trips t
       JOIN viajes_trip_countries tc ON tc.trip_id = t.id
       WHERE tc.country_code = ?
       ORDER BY COALESCE(t.start_date, t.created_at) DESC, t.id DESC`
    )
    .all(code);
  res.json(rows.map(serializeTrip));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serializeTrip(row));
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const result = validateBody(body, null);
  if (result.error) return res.status(400).json({ error: 'invalid_request', message: result.error });

  const info = db
    .prepare('INSERT INTO viajes_trips (name, color, start_date, end_date, description) VALUES (?, ?, ?, ?, ?)')
    .run(result.name, result.color, result.startDate, result.endDate, result.description);
  setTripCountries(info.lastInsertRowid, result.countries);

  const row = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(info.lastInsertRowid);
  const serialized = serializeTrip(row);
  db.recordSyncChange('viajes_trips', row.id, 'upsert', serialized, req.device ? req.device.id : null);
  res.status(201).json(serialized);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  const result = validateBody(body, existing);
  if (result.error) return res.status(400).json({ error: 'invalid_request', message: result.error });

  db.prepare(
    "UPDATE viajes_trips SET name = ?, color = ?, start_date = ?, end_date = ?, description = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(result.name, result.color, result.startDate, result.endDate, result.description, req.params.id);
  if (result.countries) setTripCountries(req.params.id, result.countries);

  const row = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(req.params.id);
  const serialized = serializeTrip(row);
  db.recordSyncChange('viajes_trips', row.id, 'upsert', serialized, req.device ? req.device.id : null);
  res.json(serialized);
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  deleteTripCascade(req.params.id, req.device ? req.device.id : null);
  res.status(204).end();
});

module.exports = router;
// Reutilizados por server/routes/sync.js (aplicador de sincronizacion
// movil), para no duplicar la validacion/insercion/serializacion de un
// viaje en dos sitios distintos.
module.exports.validateBody = validateBody;
module.exports.setTripCountries = setTripCountries;
module.exports.serializeTrip = serializeTrip;
module.exports.deleteTripCascade = deleteTripCascade;
