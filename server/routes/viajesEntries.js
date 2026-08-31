// routes/viajesEntries.js — entradas de "bitacora" dentro de un viaje
// (una por dia/momento, con texto + fotos) y sus adjuntos. Una foto
// adjunta es "solo un recuerdo" salvo que lleve un importe (amount) --
// entonces es un ticket/recibo, y si el ajuste global
// viajesFinanzasLinked esta activado, se puede enlazar a un movimiento
// real de finanzas_transactions (reutilizando esa misma tabla, no
// duplicando logica de gastos).
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const DATA_DIR = require('../dataDir');
const { requireDeviceOrTrusted } = require('../auth');
const { getFinanzasLinked } = require('./viajesSettings');

const router = express.Router();

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

function serializeAttachment(row) {
  return {
    id: row.id,
    entryId: row.entry_id,
    url: `/api/viajes-entries/attachments/${row.filename}`,
    amount: row.amount === null || row.amount === undefined ? null : row.amount,
    finanzasTransactionId: row.finanzas_transaction_id || null,
    createdAt: row.created_at,
  };
}

function serializeEntry(row) {
  const attachments = db
    .prepare('SELECT * FROM viajes_entry_attachments WHERE entry_id = ? ORDER BY id ASC')
    .all(row.id)
    .map(serializeAttachment);
  return {
    id: row.id,
    tripId: row.trip_id,
    date: row.date,
    content: row.content || null,
    attachments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deleteAttachmentRow(att) {
  // Primero se suelta la fila que REFERENCIA el movimiento de Finanzas
  // (esta misma) y solo despues se borra el movimiento en si -- al reves
  // (borrar primero finanzas_transactions) rompe la referencia
  // (finanzas_transaction_id) y SQLite lo rechaza con "FOREIGN KEY
  // constraint failed".
  const finanzasTransactionId = att.finanzas_transaction_id;
  const filePath = path.join(PHOTOS_DIR, path.basename(att.filename));
  fs.unlink(filePath, () => {}); // best-effort
  db.prepare('DELETE FROM viajes_entry_attachments WHERE id = ?').run(att.id);
  if (finanzasTransactionId) {
    db.prepare('DELETE FROM finanzas_transactions WHERE id = ?').run(finanzasTransactionId);
  }
}

// Borra una entrada y sus adjuntos (con sus fotos en disco y el
// movimiento de Finanzas enlazado si lo tenian). Reutilizada tanto por
// la ruta REST DELETE /:id como por el aplicador de sincronizacion
// (server/routes/sync.js) y por deleteTripCascade() de viajesTrips.js
// (una sola fuente de verdad para el borrado en cascada, en vez de
// duplicarlo en los 3 sitios).
//
// A diferencia de grupos/carpetas de nota (que no destruyen contenido
// al borrar) y de Gimnasio/Finanzas (que rechazan o dejan en NULL),
// aqui SI se borra contenido de verdad -- por eso se graba en sync_log
// el borrado de la entrada, no solo el de sus adjuntos (los adjuntos no
// tienen tabla de sincronizacion propia, ver serializeEntry: viajan
// embebidos dentro del "upsert" de la entrada).
function deleteEntryCascade(entryId, originId) {
  const attachments = db.prepare('SELECT * FROM viajes_entry_attachments WHERE entry_id = ?').all(entryId);
  attachments.forEach(deleteAttachmentRow);
  db.prepare('DELETE FROM viajes_entries WHERE id = ?').run(entryId);
  db.recordSyncChange('viajes_entries', entryId, 'delete', null, originId);
}

// Los adjuntos no tienen tabla de sincronizacion propia (una foto no
// se puede "crear" via push -- exige subir el archivo real, y el movil
// no guarda las fotos en su copia local, ver el plan de sincronizacion
// de Viajes en CLAUDE.md). En su lugar, cualquier cambio a los
// adjuntos de una entrada (subir/borrar una foto, vincular/desvincular
// Finanzas) se trata como una edicion de la ENTRADA -- se actualiza su
// updated_at y se graba un "upsert" con la entrada entera (adjuntos
// incluidos, via serializeEntry), igual que ya hace viajes_trips con
// sus paises embebidos.
function touchEntryForAttachmentChange(entryId, originId) {
  db.prepare("UPDATE viajes_entries SET updated_at = datetime('now') WHERE id = ?").run(entryId);
  const row = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(entryId);
  const serialized = serializeEntry(row);
  db.recordSyncChange('viajes_entries', entryId, 'upsert', serialized, originId);
  return serialized;
}

router.get('/', requireDeviceOrTrusted, (req, res) => {
  const { tripId } = req.query;
  if (!tripId) return res.status(400).json({ error: 'invalid_request', message: 'Falta tripId.' });
  const rows = db.prepare('SELECT * FROM viajes_entries WHERE trip_id = ? ORDER BY date DESC, id DESC').all(tripId);
  res.json(rows.map(serializeEntry));
});

router.get('/:id', requireDeviceOrTrusted, (req, res) => {
  const row = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serializeEntry(row));
});

router.post('/', requireDeviceOrTrusted, (req, res) => {
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
  db.recordSyncChange('viajes_entries', row.id, 'upsert', serialized, req.device ? req.device.id : null);
  res.status(201).json(serialized);
});

router.put('/:id', requireDeviceOrTrusted, (req, res) => {
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
  db.recordSyncChange('viajes_entries', row.id, 'upsert', serialized, req.device ? req.device.id : null);
  res.json(serialized);
});

router.delete('/:id', requireDeviceOrTrusted, (req, res) => {
  const existing = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  deleteEntryCascade(req.params.id, req.device ? req.device.id : null);
  res.status(204).end();
});

// --- Adjuntos (fotos, opcionalmente tickets) ---------------------------
// Rutas de un solo segmento ("attachments", "attachments/:id/...")
// registradas ANTES de que pudieran chocar con nada -- aqui no hay
// ambiguedad real con /:id porque "attachments" no es un id numerico,
// pero se mantiene el mismo orden defensivo que el resto del proyecto.

router.post('/:id/attachments', requireDeviceOrTrusted, express.raw({ type: Object.keys(ALLOWED_TYPES), limit: '10mb' }), (req, res) => {
  const entry = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  const ext = ALLOWED_TYPES[req.headers['content-type']];
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'invalid_image', message: 'Formato de imagen no soportado.' });
  }
  const amountRaw = req.query.amount;
  let amount = null;
  if (amountRaw !== undefined && amountRaw !== '') {
    amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'invalid_request', message: 'El importe tiene que ser un número mayor que 0.' });
    }
  }

  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, filename), req.body);
  const info = db
    .prepare('INSERT INTO viajes_entry_attachments (entry_id, filename, amount) VALUES (?, ?, ?)')
    .run(req.params.id, filename, amount);
  const row = db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ?').get(info.lastInsertRowid);
  touchEntryForAttachmentChange(req.params.id, req.device ? req.device.id : null);
  res.status(201).json(serializeAttachment(row));
});

// Servir una foto: a proposito SIN requireDeviceOrTrusted (el motivo
// exacto es el mismo que note-images -- un <img src> no puede llevar el
// token del dispositivo; la proteccion real es el nombre UUID
// impredecible). Montado como ruta publica en index.js, igual que
// /api/notes/images.
router.get('/attachments/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(PHOTOS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

router.delete('/attachments/:attachmentId', requireDeviceOrTrusted, (req, res) => {
  const att = db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ?').get(req.params.attachmentId);
  if (!att) return res.status(404).json({ error: 'not_found' });
  const entryId = att.entry_id;
  deleteAttachmentRow(att);
  touchEntryForAttachmentChange(entryId, req.device ? req.device.id : null);
  res.status(204).end();
});

// Convierte un adjunto-ticket (con amount) en un movimiento real de
// Finanzas -- reutiliza finanzas_transactions tal cual (type='expense'),
// no duplica ninguna logica de validacion de cuentas/categorias propia.
router.post('/attachments/:attachmentId/link-finanzas', requireDeviceOrTrusted, (req, res) => {
  if (!getFinanzasLinked()) {
    return res.status(403).json({ error: 'finanzas_not_linked', message: 'El enlace con Finanzas está desactivado (Configuración → Viajes).' });
  }
  const att = db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ?').get(req.params.attachmentId);
  if (!att) return res.status(404).json({ error: 'not_found' });
  if (att.amount === null || att.amount === undefined) {
    return res.status(400).json({ error: 'invalid_request', message: 'Este adjunto no tiene importe -- no se puede enlazar.' });
  }
  if (att.finanzas_transaction_id) {
    return res.status(400).json({ error: 'already_linked', message: 'Este adjunto ya está enlazado a un movimiento.' });
  }
  const { accountId, categoryId, date, description } = req.body || {};
  if (!accountId || !db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(accountId)) {
    return res.status(400).json({ error: 'invalid_request', message: 'La cuenta indicada no existe.' });
  }
  const entry = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(att.entry_id);
  const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : entry.date;
  let safeCategoryId = categoryId || null;
  if (safeCategoryId && !db.prepare('SELECT 1 FROM finanzas_categories WHERE id = ?').get(safeCategoryId)) {
    safeCategoryId = null;
  }

  const info = db
    .prepare(
      'INSERT INTO finanzas_transactions (account_id, type, amount, date, description, category_id, counts_toward_budget, is_salary, is_fixed) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)'
    )
    .run(accountId, 'expense', att.amount, safeDate, description ? String(description).trim() || null : null, safeCategoryId);

  db.prepare('UPDATE viajes_entry_attachments SET finanzas_transaction_id = ? WHERE id = ?').run(info.lastInsertRowid, att.id);
  const row = db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ?').get(att.id);
  touchEntryForAttachmentChange(att.entry_id, req.device ? req.device.id : null);
  res.status(201).json(serializeAttachment(row));
});

// Desenlazar sin borrar el adjunto (se queda la foto/importe, solo se
// borra el movimiento real de Finanzas) -- por si alguien lo enlazo por
// error.
router.delete('/attachments/:attachmentId/link-finanzas', requireDeviceOrTrusted, (req, res) => {
  const att = db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ?').get(req.params.attachmentId);
  if (!att) return res.status(404).json({ error: 'not_found' });
  if (!att.finanzas_transaction_id) return res.status(400).json({ error: 'not_linked' });
  // Mismo orden que deleteAttachmentRow: soltar la referencia ANTES de
  // borrar la fila referenciada.
  const finanzasTransactionId = att.finanzas_transaction_id;
  db.prepare('UPDATE viajes_entry_attachments SET finanzas_transaction_id = NULL WHERE id = ?').run(att.id);
  db.prepare('DELETE FROM finanzas_transactions WHERE id = ?').run(finanzasTransactionId);
  const row = db.prepare('SELECT * FROM viajes_entry_attachments WHERE id = ?').get(att.id);
  touchEntryForAttachmentChange(att.entry_id, req.device ? req.device.id : null);
  res.json(serializeAttachment(row));
});

module.exports = router;
// Reutilizados por viajesTrips.js (borrado en cascada de un viaje
// entero) y por server/routes/sync.js (aplicador de sincronizacion
// movil) -- una sola fuente de verdad, ver deleteEntryCascade() arriba.
module.exports.deleteEntryCascade = deleteEntryCascade;
module.exports.serializeEntry = serializeEntry;
