// routes/lecturasItems.js — cada cosa concreta dentro de una saga de
// Lecturas (una temporada, un tomo, una pelicula suelta...). Siempre
// pertenece a una saga (sagaId obligatorio, ver routes/lecturasSagas.js
// -- las sagas son el contenedor obligatorio de todo, confirmado con
// Koku).
const express = require('express');
const db = require('../db');

const router = express.Router();
const TYPES = ['manga', 'comic', 'libro', 'serie', 'anime', 'pelicula'];
const STATUSES = ['wishlist', 'in_progress', 'completed', 'dropped'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Generos como array JSON de texto libre (no una tabla aparte, ver el
// comentario de lecturas_items en server/db.js) -- aqui se sanea:
// recorta espacios, quita vacios y duplicados, limite generoso de 20
// por item para que no se cuele un pegado accidental de un parrafo.
function sanitizeGenres(genres) {
  if (!Array.isArray(genres)) return [];
  const seen = new Set();
  const clean = [];
  for (const g of genres) {
    const trimmed = String(g || '').trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    clean.push(trimmed.slice(0, 40));
    if (clean.length >= 20) break;
  }
  return clean;
}

function serialize(row) {
  return {
    id: row.id,
    sagaId: row.saga_id,
    title: row.title,
    type: row.type,
    description: row.description,
    rating: row.rating,
    status: row.status,
    genres: row.genres ? JSON.parse(row.genres) : [],
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    progressUnit: row.progress_unit,
    ownedCount: row.owned_count,
    ownedTotal: row.owned_total,
    loaned: !!row.loaned,
    loanedTo: row.loaned_to,
    loanedAt: row.loaned_at,
  };
}

// Sin sagaId: devuelve TODOS los items (con el nombre de su saga, para
// una futura vista cruzada tipo "todo lo que tengo en Deseado" sin
// entrar saga a saga -- todavia no pedida en detalle, pero el endpoint
// ya la deja lista sin coste extra). Con sagaId: solo los de esa saga,
// que es el uso normal desde el detalle de una saga.
router.get('/', (req, res) => {
  const { sagaId } = req.query;
  const rows = sagaId
    ? db.prepare('SELECT * FROM lecturas_items WHERE saga_id = ? ORDER BY position ASC, id ASC').all(sagaId)
    : db.prepare('SELECT * FROM lecturas_items ORDER BY saga_id ASC, position ASC, id ASC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { sagaId, title, type, description, rating, status, genres, progressCurrent, progressTotal, progressUnit, ownedCount, ownedTotal, loaned, loanedTo, loanedAt } = req.body || {};
  if (!sagaId || !db.prepare('SELECT id FROM lecturas_sagas WHERE id = ?').get(sagaId)) {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta la saga a la que pertenece.' });
  }
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'El item necesita un titulo.' });
  }
  if (!TYPES.includes(type)) {
    return res.status(400).json({ error: 'invalid_request', message: 'Tipo invalido.' });
  }
  const safeStatus = STATUSES.includes(status) ? status : 'wishlist';
  const safeRating = rating === undefined || rating === null || rating === '' ? null : Math.max(0, Math.min(10, Number(rating)));
  // "Prestado": interruptor + a quien + desde cuando (opcional) -- ver
  // comentario junto a lecturas_items en db.js. Sin fecha valida, se
  // guarda NULL en vez de rechazar la peticion (la fecha es opcional).
  const safeLoaned = loaned ? 1 : 0;
  const safeLoanedTo = safeLoaned && typeof loanedTo === 'string' && loanedTo.trim() ? loanedTo.trim() : null;
  const safeLoanedAt = safeLoaned && loanedAt && DATE_RE.test(loanedAt) ? loanedAt : null;

  const { count } = db.prepare('SELECT COUNT(*) as count FROM lecturas_items WHERE saga_id = ?').get(sagaId);
  const info = db
    .prepare(`
      INSERT INTO lecturas_items
        (saga_id, title, type, description, rating, status, genres, progress_current, progress_total, progress_unit, owned_count, owned_total, position, loaned, loaned_to, loaned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      sagaId,
      title.trim(),
      type,
      description && description.trim() ? description.trim() : null,
      safeRating,
      safeStatus,
      JSON.stringify(sanitizeGenres(genres)),
      progressCurrent === undefined || progressCurrent === null || progressCurrent === '' ? null : Number(progressCurrent),
      progressTotal === undefined || progressTotal === null || progressTotal === '' ? null : Number(progressTotal),
      progressUnit && progressUnit.trim() ? progressUnit.trim() : null,
      ownedCount === undefined || ownedCount === null || ownedCount === '' ? null : Number(ownedCount),
      ownedTotal === undefined || ownedTotal === null || ownedTotal === '' ? null : Number(ownedTotal),
      count,
      safeLoaned,
      safeLoanedTo,
      safeLoanedAt
    );

  const row = db.prepare('SELECT * FROM lecturas_items WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM lecturas_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { title, type, description, rating, status, genres, progressCurrent, progressTotal, progressUnit, ownedCount, ownedTotal, loaned, loanedTo, loanedAt } = req.body || {};
  if (type !== undefined && !TYPES.includes(type)) {
    return res.status(400).json({ error: 'invalid_request', message: 'Tipo invalido.' });
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_request', message: 'Estado invalido.' });
  }

  const nn = (value, existingValue, isNumber) => {
    if (value === undefined) return existingValue;
    if (value === null || value === '') return null;
    return isNumber ? Number(value) : value;
  };

  const safeLoaned = loaned === undefined ? existing.loaned : (loaned ? 1 : 0);
  // Desmarcar "prestado" limpia a quien/desde cuando -- no tiene sentido
  // conservar el nombre de quien ya no lo tiene prestado (Koku no pidio
  // un historial, solo el estado actual).
  const safeLoanedTo = !safeLoaned
    ? null
    : loanedTo !== undefined
      ? (typeof loanedTo === 'string' && loanedTo.trim() ? loanedTo.trim() : null)
      : existing.loaned_to;
  const safeLoanedAt = !safeLoaned
    ? null
    : loanedAt !== undefined
      ? (loanedAt && DATE_RE.test(loanedAt) ? loanedAt : null)
      : existing.loaned_at;

  db.prepare(`
    UPDATE lecturas_items SET
      title = ?, type = ?, description = ?, rating = ?, status = ?, genres = ?,
      progress_current = ?, progress_total = ?, progress_unit = ?,
      owned_count = ?, owned_total = ?, loaned = ?, loaned_to = ?, loaned_at = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title !== undefined && title.trim() ? title.trim() : existing.title,
    type !== undefined ? type : existing.type,
    nn(description, existing.description, false),
    rating === undefined ? existing.rating : (rating === null || rating === '' ? null : Math.max(0, Math.min(10, Number(rating)))),
    status !== undefined ? status : existing.status,
    genres !== undefined ? JSON.stringify(sanitizeGenres(genres)) : existing.genres,
    nn(progressCurrent, existing.progress_current, true),
    nn(progressTotal, existing.progress_total, true),
    nn(progressUnit, existing.progress_unit, false),
    nn(ownedCount, existing.owned_count, true),
    nn(ownedTotal, existing.owned_total, true),
    safeLoaned,
    safeLoanedTo,
    safeLoanedAt,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM lecturas_items WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM lecturas_items WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
