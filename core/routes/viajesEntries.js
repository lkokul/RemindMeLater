// routes/viajesEntries.js — entradas de "bitacora" dentro de un viaje
// (una por dia/momento, con texto + fotos) y sus dos tipos de cosas
// que se les pueden anadir: adjuntos (SOLO fotos, un recuerdo cualquiera,
// sin importe nunca) y movimientos (un gasto o un ingreso, con importe,
// opcionalmente con una foto de ticket enlazada via attachment_id). Se
// separaron en dos conceptos/tablas distintas a peticion de Koku: no
// toda foto es un ticket, no todo gasto lleva foto. Un movimiento se
// enlaza a un movimiento real de finanzas_transactions (reutilizando esa
// misma tabla, no duplicando logica de gastos) de forma AUTOMATICA al
// crearlo si el VIAJE al que pertenece tiene finanzas_linked activado
// (ver viajes_trips.finanzas_linked en db.js), o a mano en cualquier
// momento via /movements/:id/link-finanzas (disponible siempre, aunque
// el viaje no este enlazado -- sirve para enlazar un movimiento suelto
// sin activar el ajuste de todo el viaje).
const { createRouter } = require('../router');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const DATA_DIR = require('../dataDir');

const router = createRouter();

const PHOTOS_DIR = path.join(DATA_DIR, 'viajes-photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// Mismos tipos que note-images -- fotos/capturas normales, nada de SVG
// (podria llevar <script>).
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function getEntryTripFinanzasLinked(entryId) {
  const row = db
    .prepare('SELECT t.finanzas_linked as finanzasLinked FROM viajes_entries e JOIN viajes_trips t ON t.id = e.trip_id WHERE e.id = ?')
    .get(entryId);
  return !!(row && row.finanzasLinked);
}

function serializeAttachment(row) {
  return {
    id: row.id,
    entryId: row.entry_id,
    url: `/api/viajes-entries/attachments/${row.filename}`,
    createdAt: row.created_at,
  };
}

function serializeMovement(row) {
  const attachment = row.attachment_id ? db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ?').get(row.attachment_id) : null;
  return {
    id: row.id,
    entryId: row.entry_id,
    type: row.type,
    amount: row.amount,
    description: row.description || null,
    countsTowardBudget: !!row.counts_toward_budget,
    attachmentId: row.attachment_id || null,
    attachmentUrl: attachment ? `/api/viajes-entries/attachments/${attachment.filename}` : null,
    finanzasTransactionId: row.finanzas_transaction_id || null,
    createdAt: row.created_at,
  };
}

function serializeEntry(row) {
  // Las fotos ya "adoptadas" por un movimiento (attachment_id) no se
  // repiten aqui como adjunto suelto -- ya se ven embebidas dentro de
  // ese movimiento (attachmentUrl en serializeMovement).
  const attachments = db
    .prepare(
      `SELECT * FROM viajes_entry_attachments
       WHERE entry_id = ? AND id NOT IN (SELECT attachment_id FROM viajes_entry_movements WHERE attachment_id IS NOT NULL)
       ORDER BY id ASC`
    )
    .all(row.id)
    .map(serializeAttachment);
  const movements = db
    .prepare('SELECT * FROM viajes_entry_movements WHERE entry_id = ? ORDER BY id ASC')
    .all(row.id)
    .map(serializeMovement);
  return {
    id: row.id,
    tripId: row.trip_id,
    date: row.date,
    content: row.content || null,
    attachments,
    movements,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deleteAttachmentRow(att) {
  const filePath = path.join(PHOTOS_DIR, path.basename(att.filename));
  fs.unlink(filePath, () => {}); // best-effort
  db.prepare('DELETE FROM viajes_entry_attachments WHERE id = ?').run(att.id);
}

// Borra un movimiento + su movimiento real de Finanzas si estaba
// enlazado + su foto de ticket si tenia -- mismo orden FK ya
// establecido en el resto del proyecto: soltar/borrar la fila que
// referencia ANTES de borrar lo referenciado.
function deleteMovementRow(mv) {
  const finanzasTransactionId = mv.finanzas_transaction_id;
  const attachmentId = mv.attachment_id;
  db.prepare('DELETE FROM viajes_entry_movements WHERE id = ?').run(mv.id);
  if (finanzasTransactionId) db.prepare('DELETE FROM finanzas_transactions WHERE id = ?').run(finanzasTransactionId);
  if (attachmentId) {
    const att = db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ?').get(attachmentId);
    if (att) deleteAttachmentRow(att);
  }
}

// Borra una entrada y todo lo que cuelga de ella (adjuntos + movimientos,
// con sus fotos en disco y sus movimientos de Finanzas enlazados si los
// tenian). Reutilizada tanto por la ruta REST DELETE /:id como por el
// aplicador de sincronizacion (server/routes/sync.js) y por
// deleteTripCascade() de viajesTrips.js -- una sola fuente de verdad
// para el borrado en cascada, en vez de duplicarlo en los 3 sitios.
//
// A diferencia de grupos/carpetas de nota (que no destruyen contenido
// al borrar) y de Gimnasio/Finanzas (que rechazan o dejan en NULL),
// aqui SI se borra contenido de verdad: la entrada, sus adjuntos y sus
// movimientos.
function deleteEntryCascade(entryId) {
  // Los movimientos primero: deleteMovementRow() ya borra la foto de
  // ticket que tuvieran, asi que la consulta de adjuntos de abajo solo
  // encuentra los que quedan sueltos (no eran de ningun movimiento).
  const movements = db.prepare('SELECT * FROM viajes_entry_movements WHERE entry_id = ?').all(entryId);
  movements.forEach(deleteMovementRow);
  const attachments = db.prepare('SELECT * FROM viajes_entry_attachments WHERE entry_id = ?').all(entryId);
  attachments.forEach(deleteAttachmentRow);
  db.prepare('DELETE FROM viajes_entries WHERE id = ?').run(entryId);
}

// Cualquier cambio en los hijos de una entrada (subir/borrar una foto,
// crear/editar/borrar/vincular/desvincular un movimiento) cuenta como
// una edicion de la ENTRADA: se le actualiza el updated_at y se devuelve
// la entrada entera ya serializada (adjuntos y movimientos incluidos),
// que es lo que la ventana necesita para repintar.
function touchEntryForAttachmentChange(entryId) {
  db.prepare("UPDATE viajes_entries SET updated_at = datetime('now') WHERE id = ?").run(entryId);
  const row = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(entryId);
  const serialized = serializeEntry(row);
  return serialized;
}

router.get('/', (req, res) => {
  const { tripId } = req.query;
  if (!tripId) return res.status(400).json({ error: 'invalid_request', message: 'Falta tripId.' });
  const rows = db.prepare('SELECT * FROM viajes_entries WHERE trip_id = ? ORDER BY date DESC, id DESC').all(tripId);
  res.json(rows.map(serializeEntry));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serializeEntry(row));
});

router.post('/', (req, res) => {
  const { tripId, date, content } = req.body || {};
  if (!tripId || !db.prepare('SELECT 1 FROM viajes_trips WHERE id = ?').get(tripId)) {
    return res.status(400).json({ error: 'invalid_request', message: 'El viaje indicado no existe.' });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'invalid_request', message: 'La fecha tiene que tener el formato YYYY-MM-DD.' });
  }
  const info = db
    .prepare('INSERT INTO viajes_entries (trip_id, date, content) VALUES (?, ?, ?)')
    .run(tripId, date, content ? String(content) : null);
  const row = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(info.lastInsertRowid);
  const serialized = serializeEntry(row);
  res.status(201).json(serialized);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const date = req.body && req.body.date !== undefined ? req.body.date : existing.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'invalid_request', message: 'La fecha tiene que tener el formato YYYY-MM-DD.' });
  }
  const content = req.body && req.body.content !== undefined ? (req.body.content ? String(req.body.content) : null) : existing.content;
  db.prepare("UPDATE viajes_entries SET date = ?, content = ?, updated_at = datetime('now') WHERE id = ?").run(date, content, req.params.id);
  const row = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(req.params.id);
  const serialized = serializeEntry(row);
  res.json(serialized);
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  deleteEntryCascade(req.params.id);
  res.status(204).end();
});

// --- Adjuntos (SOLO fotos, nunca llevan importe) -----------------------
// Rutas de un solo segmento ("attachments", "movements") registradas
// ANTES de que pudieran chocar con nada -- aqui no hay ambiguedad real
// con /:id porque ni "attachments" ni "movements" son un id numerico,
// pero se mantiene el mismo orden defensivo que el resto del proyecto.

// El cuerpo llega ya como Buffer desde el IPC de Electron (antes hacia
// falta express.raw() para leerlo del flujo HTTP; ya no hay flujo HTTP).
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

router.post('/:id/attachments', (req, res) => {
  const entry = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  const ext = ALLOWED_TYPES[req.headers['content-type']];
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'invalid_image', message: 'Formato de imagen no soportado.' });
  }
  if (req.body.length > MAX_PHOTO_BYTES) {
    return res.status(400).json({ error: 'image_too_big', message: 'La foto no puede pasar de 10 MB.' });
  }

  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, filename), req.body);
  const info = db.prepare('INSERT INTO viajes_entry_attachments (entry_id, filename) VALUES (?, ?)').run(req.params.id, filename);
  const row = db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ?').get(info.lastInsertRowid);
  touchEntryForAttachmentChange(req.params.id);
  res.status(201).json(serializeAttachment(row));
});

// Servir una foto. Igual que con las imagenes de notas, esto no lo pide
// el codigo de la app sino el navegador al encontrarse un <img src>, asi
// que no llega por api()/IPC: lo atiende el protocolo app:// de Electron
// (ver electron/protocol.js). Sirve tanto fotos sueltas como fotos de
// ticket de un movimiento -- ambas viven en DATA_DIR/viajes-photos.
router.get('/attachments/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(PHOTOS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

router.delete('/attachments/:attachmentId', (req, res) => {
  const att = db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ?').get(req.params.attachmentId);
  if (!att) return res.status(404).json({ error: 'not_found' });
  const ownedByMovement = db.prepare('SELECT 1 FROM viajes_entry_movements WHERE attachment_id = ?').get(att.id);
  if (ownedByMovement) {
    return res.status(400).json({ error: 'owned_by_movement', message: 'Esta foto pertenece a un gasto/ingreso -- bórralo desde ahí.' });
  }
  const entryId = att.entry_id;
  deleteAttachmentRow(att);
  touchEntryForAttachmentChange(entryId);
  res.status(204).end();
});

// --- Movimientos (gasto o ingreso, con importe) -------------------------

router.post('/:id/movements', (req, res) => {
  const entry = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not_found' });

  const { type, amount, description, countsTowardBudget, accountId, categoryId, date, attachmentId } = req.body || {};
  if (!['expense', 'income'].includes(type)) {
    return res.status(400).json({ error: 'invalid_request', message: 'El tipo tiene que ser gasto o ingreso.' });
  }
  const safeAmount = Number(amount);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    return res.status(400).json({ error: 'invalid_request', message: 'El importe tiene que ser un número mayor que 0.' });
  }
  let safeAttachmentId = null;
  if (attachmentId) {
    const att = db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ? AND entry_id = ?').get(attachmentId, req.params.id);
    if (!att) return res.status(400).json({ error: 'invalid_request', message: 'La foto indicada no existe.' });
    safeAttachmentId = att.id;
  }
  const safeCountsTowardBudget = type === 'expense' ? (countsTowardBudget === false ? 0 : 1) : 0;
  const safeDescription = description ? String(description).trim() || null : null;

  const info = db
    .prepare(
      'INSERT INTO viajes_entry_movements (entry_id, type, amount, description, counts_toward_budget, attachment_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(req.params.id, type, safeAmount, safeDescription, safeCountsTowardBudget, safeAttachmentId);

  // Si el VIAJE de esta entrada tiene el enlace con Finanzas activado, el
  // movimiento se enlaza de inmediato (mismo INSERT que el enlace manual
  // de mas abajo) -- si no, se queda como un simple apunte local, y se
  // puede enlazar despues a mano o en bloque (ver viajesTrips.js).
  if (getEntryTripFinanzasLinked(req.params.id) && accountId && db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(accountId)) {
    const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : entry.date;
    let safeCategoryId = categoryId || null;
    if (safeCategoryId && !db.prepare('SELECT 1 FROM finanzas_categories WHERE id = ?').get(safeCategoryId)) safeCategoryId = null;
    const txInfo = db
      .prepare(
        'INSERT INTO finanzas_transactions (account_id, type, amount, date, description, category_id, counts_toward_budget, is_salary, is_fixed) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)'
      )
      .run(accountId, type, safeAmount, safeDate, safeDescription, safeCategoryId, safeCountsTowardBudget);
    db.prepare('UPDATE viajes_entry_movements SET finanzas_transaction_id = ? WHERE id = ?').run(txInfo.lastInsertRowid, info.lastInsertRowid);
  }

  const row = db.prepare('SELECT * FROM viajes_entry_movements WHERE id = ?').get(info.lastInsertRowid);
  touchEntryForAttachmentChange(req.params.id);
  res.status(201).json(serializeMovement(row));
});

router.put('/movements/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM viajes_entry_movements WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  const type = body.type !== undefined ? body.type : existing.type;
  if (!['expense', 'income'].includes(type)) {
    return res.status(400).json({ error: 'invalid_request', message: 'El tipo tiene que ser gasto o ingreso.' });
  }
  const amount = body.amount !== undefined ? Number(body.amount) : existing.amount;
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_request', message: 'El importe tiene que ser un número mayor que 0.' });
  }
  const description = body.description !== undefined ? (body.description ? String(body.description).trim() || null : null) : existing.description;
  const countsTowardBudget =
    type === 'expense' ? (body.countsTowardBudget !== undefined ? (body.countsTowardBudget ? 1 : 0) : existing.counts_toward_budget) : 0;

  db.prepare('UPDATE viajes_entry_movements SET type = ?, amount = ?, description = ?, counts_toward_budget = ? WHERE id = ?').run(
    type,
    amount,
    description,
    countsTowardBudget,
    req.params.id
  );

  // Si ya estaba enlazado a Finanzas, se actualiza tambien esa fila real
  // para que no se desincronicen -- accountId/categoryId/date son
  // opcionales en el body; si no vienen, se dejan igual que ya estaban
  // en la transaccion real.
  if (existing.finanzas_transaction_id) {
    const tx = db.prepare('SELECT * FROM finanzas_transactions WHERE id = ?').get(existing.finanzas_transaction_id);
    if (tx) {
      const accountId = body.accountId ? body.accountId : tx.account_id;
      let categoryId = body.categoryId !== undefined ? body.categoryId : tx.category_id;
      if (categoryId && !db.prepare('SELECT 1 FROM finanzas_categories WHERE id = ?').get(categoryId)) categoryId = null;
      const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : tx.date;
      db.prepare(
        'UPDATE finanzas_transactions SET account_id = ?, type = ?, amount = ?, date = ?, description = ?, category_id = ?, counts_toward_budget = ? WHERE id = ?'
      ).run(accountId, type, amount, date, description, categoryId, countsTowardBudget, existing.finanzas_transaction_id);
    }
  }

  const row = db.prepare('SELECT * FROM viajes_entry_movements WHERE id = ?').get(req.params.id);
  touchEntryForAttachmentChange(existing.entry_id);
  res.json(serializeMovement(row));
});

router.delete('/movements/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM viajes_entry_movements WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const entryId = existing.entry_id;
  deleteMovementRow(existing);
  touchEntryForAttachmentChange(entryId);
  res.status(204).end();
});

// Enlazar/desenlazar un movimiento a mano -- disponible SIEMPRE, aunque
// el viaje no tenga finanzas_linked activado (sirve para enlazar un
// movimiento suelto sin activar el ajuste de todo el viaje).
router.post('/movements/:id/link-finanzas', (req, res) => {
  const mv = db.prepare('SELECT * FROM viajes_entry_movements WHERE id = ?').get(req.params.id);
  if (!mv) return res.status(404).json({ error: 'not_found' });
  if (mv.finanzas_transaction_id) return res.status(400).json({ error: 'already_linked', message: 'Este movimiento ya está enlazado.' });
  const { accountId, categoryId, date, description } = req.body || {};
  if (!accountId || !db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(accountId)) {
    return res.status(400).json({ error: 'invalid_request', message: 'La cuenta indicada no existe.' });
  }
  const entry = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(mv.entry_id);
  const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : entry.date;
  let safeCategoryId = categoryId || null;
  if (safeCategoryId && !db.prepare('SELECT 1 FROM finanzas_categories WHERE id = ?').get(safeCategoryId)) safeCategoryId = null;
  const safeDescription = description !== undefined ? (description ? String(description).trim() || null : null) : mv.description;

  const info = db
    .prepare(
      'INSERT INTO finanzas_transactions (account_id, type, amount, date, description, category_id, counts_toward_budget, is_salary, is_fixed) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)'
    )
    .run(accountId, mv.type, mv.amount, safeDate, safeDescription, safeCategoryId, mv.counts_toward_budget);

  db.prepare('UPDATE viajes_entry_movements SET finanzas_transaction_id = ? WHERE id = ?').run(info.lastInsertRowid, mv.id);
  const row = db.prepare('SELECT * FROM viajes_entry_movements WHERE id = ?').get(mv.id);
  touchEntryForAttachmentChange(mv.entry_id);
  res.status(201).json(serializeMovement(row));
});

// Desenlazar sin borrar el movimiento (se queda el importe/tipo/foto,
// solo se borra el movimiento real de Finanzas) -- por si alguien lo
// enlazo por error.
router.delete('/movements/:id/link-finanzas', (req, res) => {
  const mv = db.prepare('SELECT * FROM viajes_entry_movements WHERE id = ?').get(req.params.id);
  if (!mv) return res.status(404).json({ error: 'not_found' });
  if (!mv.finanzas_transaction_id) return res.status(400).json({ error: 'not_linked' });
  const finanzasTransactionId = mv.finanzas_transaction_id;
  db.prepare('UPDATE viajes_entry_movements SET finanzas_transaction_id = NULL WHERE id = ?').run(mv.id);
  db.prepare('DELETE FROM finanzas_transactions WHERE id = ?').run(finanzasTransactionId);
  const row = db.prepare('SELECT * FROM viajes_entry_movements WHERE id = ?').get(mv.id);
  touchEntryForAttachmentChange(mv.entry_id);
  res.json(serializeMovement(row));
});

module.exports = router;
// Reutilizados por viajesTrips.js (borrado en cascada de un viaje
// entero, enlace retroactivo en bloque) y por server/routes/sync.js
// (aplicador de sincronizacion movil) -- una sola fuente de verdad, ver
// deleteEntryCascade()/getEntryTripFinanzasLinked() arriba.
module.exports.deleteEntryCascade = deleteEntryCascade;
module.exports.serializeEntry = serializeEntry;
module.exports.serializeMovement = serializeMovement;
module.exports.touchEntryForAttachmentChange = touchEntryForAttachmentChange;
