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
const { deleteEntryCascade, touchEntryForAttachmentChange } = require('./viajesEntries');
const { getDefaultAccountId } = require('./viajesSettings');

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
    finanzasLinked: !!row.finanzas_linked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Cuantos movimientos de este viaje (de cualquiera de sus entradas)
// siguen sin enlazar a un movimiento real de Finanzas -- lo usa el PUT
// para avisar al cliente cuando se activa finanzas_linked con gastos ya
// existentes, y POST /:id/link-existing-movements para saber cuales
// enlazar en bloque.
function countUnlinkedMovements(tripId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM viajes_entry_movements m
       JOIN viajes_entries e ON e.id = m.entry_id
       WHERE e.trip_id = ? AND m.finanzas_transaction_id IS NULL`
    )
    .get(tripId);
  return row.c;
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
  const finanzasLinked =
    body.finanzasLinked !== undefined ? !!body.finanzasLinked : existing ? !!existing.finanzas_linked : false;

  return {
    name: String(name).trim(),
    countries: countries !== undefined ? countries.map((c) => c.trim().toLowerCase()) : null,
    startDate: startDate || null,
    endDate: endDate || null,
    description: body.description !== undefined ? (String(body.description || '').trim() || null) : existing ? existing.description : null,
    color: color || '#5b8cff',
    finanzasLinked,
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
    .prepare('INSERT INTO viajes_trips (name, color, start_date, end_date, description, finanzas_linked) VALUES (?, ?, ?, ?, ?, ?)')
    .run(result.name, result.color, result.startDate, result.endDate, result.description, result.finanzasLinked ? 1 : 0);
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
    "UPDATE viajes_trips SET name = ?, color = ?, start_date = ?, end_date = ?, description = ?, finanzas_linked = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(result.name, result.color, result.startDate, result.endDate, result.description, result.finanzasLinked ? 1 : 0, req.params.id);
  if (result.countries) setTripCountries(req.params.id, result.countries);

  const row = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(req.params.id);
  const serialized = serializeTrip(row);
  db.recordSyncChange('viajes_trips', row.id, 'upsert', serialized, req.device ? req.device.id : null);

  // Si se acaba de ACTIVAR el enlace (antes desactivado) y el viaje ya
  // tenia gastos/ingresos sin enlazar, se avisa en la respuesta -- el
  // cliente pregunta si tambien quiere enlazar esos anteriores
  // (POST /:id/link-existing-movements) en vez de hacerlo aqui a ciegas.
  const turningOn = !existing.finanzas_linked && result.finanzasLinked;
  const unlinkedCount = turningOn ? countUnlinkedMovements(req.params.id) : 0;
  res.json(Object.assign({}, serialized, turningOn && unlinkedCount > 0 ? { hasUnlinkedMovements: true, unlinkedCount } : {}));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  deleteTripCascade(req.params.id, req.device ? req.device.id : null);
  res.status(204).end();
});

// Enlaza en bloque TODOS los movimientos sin enlazar de este viaje --
// usa la cuenta indicada en el body, o si no viene, la cuenta por
// defecto global (Configuracion -> Viajes, ver viajesSettings.js).
router.post('/:id/link-existing-movements', (req, res) => {
  const trip = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: 'not_found' });

  const accountId = (req.body && req.body.accountId) || getDefaultAccountId();
  if (!accountId || !db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(accountId)) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'No hay ninguna cuenta por defecto configurada (Configuración → Viajes) ni se indicó una cuenta válida.',
    });
  }

  const unlinked = db
    .prepare(
      `SELECT m.* FROM viajes_entry_movements m
       JOIN viajes_entries e ON e.id = m.entry_id
       WHERE e.trip_id = ? AND m.finanzas_transaction_id IS NULL`
    )
    .all(req.params.id);

  const originId = req.device ? req.device.id : null;
  let linkedCount = 0;
  for (const mv of unlinked) {
    const entry = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(mv.entry_id);
    const txInfo = db
      .prepare(
        'INSERT INTO finanzas_transactions (account_id, type, amount, date, description, category_id, counts_toward_budget, is_salary, is_fixed) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 0)'
      )
      .run(accountId, mv.type, mv.amount, entry.date, mv.description, mv.counts_toward_budget);
    db.prepare('UPDATE viajes_entry_movements SET finanzas_transaction_id = ? WHERE id = ?').run(txInfo.lastInsertRowid, mv.id);
    touchEntryForAttachmentChange(mv.entry_id, originId);
    linkedCount += 1;
  }

  res.json({ linkedCount });
});

module.exports = router;
// Reutilizados por server/routes/sync.js (aplicador de sincronizacion
// movil), para no duplicar la validacion/insercion/serializacion de un
// viaje en dos sitios distintos.
module.exports.validateBody = validateBody;
module.exports.setTripCountries = setTripCountries;
module.exports.serializeTrip = serializeTrip;
module.exports.deleteTripCascade = deleteTripCascade;
