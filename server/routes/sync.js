// routes/sync.js — sincronizacion movil-ordenador (fase "movil"): un
// movil con copia local (ver public/db-local.js) trae los cambios que se
// hicieron en el ordenador (GET /pull) y manda los suyos propios (POST
// /push), usando el mismo emparejamiento (X-Device-Token) de siempre —
// no hay ningun mecanismo de autenticacion nuevo. Todo pasa por wifi
// local, nunca por internet.
const express = require('express');
const db = require('../db');
const { sanitizeColors, sanitizeInverseColors, serializeTheme } = require('./themes');
// Viajes reutiliza las funciones YA existentes de sus propias rutas
// REST (validacion, insercion, serializacion, borrado en cascada) en
// vez de duplicarlas aqui como hacen las demas tablas -- ver el
// comentario de applyViajesTripChange/applyViajesEntryChange mas
// abajo para el porque.
const { validateBody: validateViajesTripBody, setTripCountries: setViajesTripCountries, serializeTrip: serializeViajesTrip, deleteTripCascade: deleteViajesTripCascade } = require('./viajesTrips');
const { serializeEntry: serializeViajesEntry, deleteEntryCascade: deleteViajesEntryCascade } = require('./viajesEntries');
const { deriveTitleFromBody, sanitizeNoteBody } = require('./notes');

const router = express.Router();

// Tablas que participan en la sincronizacion, y como localizar/guardar
// cada una. "idColumn" es 'id' para todas menos special_days, cuya
// clave es la propia fecha (no tiene una columna "id" separada).
//
// viajes_entry_attachments NO tiene entrada propia aqui: una foto no
// se puede "crear" via push (exige subir el archivo real, y el movil
// no guarda las fotos en su copia local) -- sus cambios viajan
// EMBEBIDOS dentro del "upsert" de la entrada a la que pertenece
// (igual que viajes_trip_countries viaja embebido dentro del viaje),
// ver touchEntryForAttachmentChange() en viajesEntries.js.
const TABLES = {
  events: { idColumn: 'id' },
  notes: { idColumn: 'id' },
  groups: { idColumn: 'id' },
  note_folders: { idColumn: 'id' },
  special_days: { idColumn: 'date' },
  themes: { idColumn: 'id' },
  viajes_trips: { idColumn: 'id' },
  viajes_entries: { idColumn: 'id' },
};

// Comprueba que un id apunta a una fila que existe de verdad en esa
// tabla -- igual que resolveGroupId/resolveFolderId en las rutas REST
// normales: si el id no existe, se ignora (se guarda como "sin
// referencia") en vez de fallar. "table" siempre es uno de los nombres
// fijos de arriba (nunca texto que venga del cliente sin pasar por ahi
// antes), asi que concatenarlo en el SQL es seguro.
function resolveRef(table, id) {
  if (id === undefined || id === null || id === '') return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  return row ? row.id : null;
}

// Misma comprobacion de ciclos que routes/noteFolders.js (una carpeta no
// puede ser su propio antepasado).
function wouldCreateCycle(folderId, candidateParentId) {
  let current = candidateParentId;
  const seen = new Set();
  while (current !== null && current !== undefined) {
    if (current === folderId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    const row = db.prepare('SELECT parent_id FROM note_folders WHERE id = ?').get(current);
    if (!row) return false;
    current = row.parent_id;
  }
  return false;
}

function serializeEvent(row) {
  const group = row.group_id ? db.prepare('SELECT name, color, icon, completed_color FROM groups WHERE id = ?').get(row.group_id) : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: !!row.all_day,
    reminderMinutesBefore: row.reminder_minutes_before,
    groupId: row.group_id,
    groupName: group ? group.name : null,
    groupColor: group ? group.color : null,
    groupIcon: group ? group.icon : null,
    groupCompletedColor: group ? group.completed_color : null,
    isTask: !!row.is_task,
    done: !!row.done,
    createdByName: row.created_by_name || null,
    createdByPublicId: row.created_by_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeNote(row) {
  const folder = row.folder_id ? db.prepare('SELECT name, color, icon FROM note_folders WHERE id = ?').get(row.folder_id) : null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    bodyFormat: row.body_format,
    hidden: !!row.hidden,
    favorite: !!row.favorite,
    folderId: row.folder_id,
    folderName: folder ? folder.name : null,
    folderColor: folder ? folder.color : null,
    folderIcon: folder ? folder.icon : null,
    createdByName: row.created_by_name || null,
    createdByPublicId: row.created_by_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeGroup(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon || null,
    position: row.position,
    completedColor: row.completed_color || null,
    updatedAt: row.updated_at,
  };
}

function serializeNoteFolder(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon || null,
    position: row.position,
    parentId: row.parent_id,
    favorite: !!row.favorite,
    updatedAt: row.updated_at,
  };
}

// Cada aplicador devuelve { status: 'applied'|'rejected', serverRowId,
// serverPayload, message }. "superseded" (el cambio del movil llegaba
// tarde) lo decide applyChange() ANTES de llamar al aplicador, comparando
// fechas -- el aplicador en si solo sabe crear/actualizar/borrar.
function applyEventChange(rowId, op, payload, originId) {
  if (op === 'delete') {
    db.prepare('DELETE FROM events WHERE id = ?').run(rowId);
    db.recordSyncChange('events', rowId, 'delete', null, originId);
    return { status: 'applied' };
  }

  const { title, description, location, startAt, endAt, allDay, reminderMinutesBefore, groupId, isTask, done } = payload || {};
  if (!title || !String(title).trim()) {
    return { status: 'rejected', message: 'El evento necesita un titulo.' };
  }
  if (!isTask && !startAt) {
    return { status: 'rejected', message: 'Falta la fecha/hora de inicio.' };
  }

  const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();

  if (!rowId) {
    const info = db
      .prepare(`
        INSERT INTO events (title, description, location, start_at, end_at, all_day, reminder_minutes_before, group_id, created_by_name, created_by_id, is_task, done)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        String(title).trim(),
        description || null,
        location || null,
        startAt || null,
        endAt || null,
        allDay ? 1 : 0,
        reminderMinutesBefore === undefined || reminderMinutesBefore === null ? null : Number(reminderMinutesBefore),
        resolveRef('groups', groupId),
        profile && profile.name ? profile.name : null,
        profile ? profile.public_id : null,
        isTask ? 1 : 0,
        done ? 1 : 0
      );
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
    const serialized = serializeEvent(row);
    db.recordSyncChange('events', row.id, 'upsert', serialized, originId);
    return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
  }

  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(rowId);
  if (!existing) {
    // El servidor ya no tiene esta fila (la borraron mientras tanto) --
    // se trata como que el borrado gana, sin crear nada nuevo con ese id.
    return { status: 'applied' };
  }
  db.prepare(`
    UPDATE events SET
      title = ?, description = ?, location = ?, start_at = ?, end_at = ?,
      all_day = ?, reminder_minutes_before = ?, group_id = ?, is_task = ?, done = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    String(title).trim(),
    description || null,
    location || null,
    startAt || null,
    endAt || null,
    allDay ? 1 : 0,
    reminderMinutesBefore === undefined || reminderMinutesBefore === null ? null : Number(reminderMinutesBefore),
    resolveRef('groups', groupId),
    isTask ? 1 : 0,
    done ? 1 : 0,
    rowId
  );
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(rowId);
  const serialized = serializeEvent(row);
  db.recordSyncChange('events', row.id, 'upsert', serialized, originId);
  return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
}

function applyNoteChange(rowId, op, payload, originId) {
  if (op === 'delete') {
    db.prepare('DELETE FROM notes WHERE id = ?').run(rowId);
    db.recordSyncChange('notes', rowId, 'delete', null, originId);
    return { status: 'applied' };
  }

  // Fase 4 del rediseño movil: ya no se manda titulo (se deriva del
  // cuerpo, misma logica que la ruta REST -- ver deriveTitleFromBody en
  // routes/notes.js, importada arriba). El body tambien se sanea si viene
  // marcado como 'html' (mismo criterio que el POST/PUT REST -- antes
  // esta funcion guardaba el body de un movil sin pasar por el saneado
  // de etiquetas, un hueco real que se corrige de paso al tocar este
  // mismo bloque). Payload aqui es el body CRUDO de la peticion original
  // del movil (parcial en un PUT, ver pushOutbox en app.js) -- igual que
  // el PUT REST, solo se re-deriva title/body/format si el payload trae
  // "body" de verdad, si no se conserva lo que ya hubiera en la fila.
  const { body, folderId, favorite, hidden } = payload || {};
  const bodyProvided = payload && Object.prototype.hasOwnProperty.call(payload, 'body');

  const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();

  if (!rowId) {
    const format = payload && payload.bodyFormat === 'html' ? 'html' : 'text';
    const cleanBody = format === 'html' ? sanitizeNoteBody(body) : (body || null);
    const title = deriveTitleFromBody(cleanBody, format);
    const info = db
      .prepare('INSERT INTO notes (title, body, body_format, folder_id, favorite, hidden, created_by_name, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        title,
        cleanBody,
        format,
        resolveRef('note_folders', folderId),
        favorite ? 1 : 0,
        hidden ? 1 : 0,
        profile && profile.name ? profile.name : null,
        profile ? profile.public_id : null
      );
    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid);
    const serialized = serializeNote(row);
    db.recordSyncChange('notes', row.id, 'upsert', serialized, originId);
    return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
  }

  const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(rowId);
  if (!existing) return { status: 'applied' };

  const format = payload && payload.bodyFormat !== undefined
    ? (payload.bodyFormat === 'html' ? 'html' : 'text')
    : existing.body_format;
  const cleanBody = bodyProvided
    ? (format === 'html' ? sanitizeNoteBody(body) : body)
    : existing.body;
  const title = bodyProvided ? deriveTitleFromBody(cleanBody, format) : existing.title;

  db.prepare(`
    UPDATE notes SET title = ?, body = ?, body_format = ?, folder_id = ?, favorite = ?, hidden = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title,
    cleanBody,
    format,
    folderId !== undefined ? resolveRef('note_folders', folderId) : existing.folder_id,
    favorite !== undefined ? (favorite ? 1 : 0) : existing.favorite,
    hidden !== undefined ? (hidden ? 1 : 0) : existing.hidden,
    rowId
  );
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(rowId);
  const serialized = serializeNote(row);
  db.recordSyncChange('notes', row.id, 'upsert', serialized, originId);
  return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
}

function applyGroupChange(rowId, op, payload, originId) {
  if (op === 'delete') {
    db.prepare('UPDATE events SET group_id = NULL WHERE group_id = ?').run(rowId);
    db.prepare('DELETE FROM groups WHERE id = ?').run(rowId);
    db.recordSyncChange('groups', rowId, 'delete', null, originId);
    return { status: 'applied' };
  }

  const { name, color, icon, completedColor } = payload || {};
  if (!name || !String(name).trim()) {
    return { status: 'rejected', message: 'El grupo necesita un nombre.' };
  }
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';
  const safeCompletedColor = /^#[0-9a-fA-F]{6}$/.test(completedColor || '') ? completedColor : null;

  if (!rowId) {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM groups').get();
    const info = db
      .prepare("INSERT INTO groups (name, color, icon, position, completed_color, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .run(String(name).trim(), safeColor, icon ? String(icon).slice(0, 8) : null, count, safeCompletedColor);
    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid);
    const serialized = serializeGroup(row);
    db.recordSyncChange('groups', row.id, 'upsert', serialized, originId);
    return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
  }

  const existing = db.prepare('SELECT * FROM groups WHERE id = ?').get(rowId);
  if (!existing) return { status: 'applied' };
  db.prepare("UPDATE groups SET name = ?, color = ?, icon = ?, completed_color = ?, updated_at = datetime('now') WHERE id = ?").run(
    String(name).trim(),
    safeColor,
    icon ? String(icon).slice(0, 8) : null,
    safeCompletedColor,
    rowId
  );
  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(rowId);
  const serialized = serializeGroup(row);
  db.recordSyncChange('groups', row.id, 'upsert', serialized, originId);
  return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
}

function applyNoteFolderChange(rowId, op, payload, originId) {
  if (op === 'delete') {
    db.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ?').run(rowId);
    const existing = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(rowId);
    db.prepare('UPDATE note_folders SET parent_id = ? WHERE parent_id = ?').run(existing ? existing.parent_id : null, rowId);
    db.prepare('DELETE FROM note_folders WHERE id = ?').run(rowId);
    db.recordSyncChange('note_folders', rowId, 'delete', null, originId);
    return { status: 'applied' };
  }

  const { name, color, icon, parentId, favorite } = payload || {};
  if (!name || !String(name).trim()) {
    return { status: 'rejected', message: 'La carpeta necesita un nombre.' };
  }
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';

  let safeParentId = null;
  if (parentId !== undefined && parentId !== null && parentId !== '') {
    const numericParentId = Number(parentId);
    const parentExists = db.prepare('SELECT id FROM note_folders WHERE id = ?').get(numericParentId);
    if (parentExists && numericParentId !== rowId && !(rowId && wouldCreateCycle(rowId, numericParentId))) {
      safeParentId = numericParentId;
    }
  }

  if (!rowId) {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM note_folders').get();
    const info = db
      .prepare("INSERT INTO note_folders (name, color, icon, position, parent_id, favorite, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
      .run(String(name).trim(), safeColor, icon ? String(icon).slice(0, 8) : null, count, safeParentId, favorite ? 1 : 0);
    const row = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(info.lastInsertRowid);
    const serialized = serializeNoteFolder(row);
    db.recordSyncChange('note_folders', row.id, 'upsert', serialized, originId);
    return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
  }

  const existing = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(rowId);
  if (!existing) return { status: 'applied' };
  db.prepare("UPDATE note_folders SET name = ?, color = ?, icon = ?, parent_id = ?, favorite = ?, updated_at = datetime('now') WHERE id = ?").run(
    String(name).trim(),
    safeColor,
    icon ? String(icon).slice(0, 8) : null,
    safeParentId,
    favorite ? 1 : 0,
    rowId
  );
  const row = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(rowId);
  const serialized = serializeNoteFolder(row);
  db.recordSyncChange('note_folders', row.id, 'upsert', serialized, originId);
  return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
}

function applySpecialDayChange(rowId, op, payload, originId) {
  const date = rowId;
  if (op === 'delete') {
    db.prepare('DELETE FROM special_days WHERE date = ?').run(date);
    db.recordSyncChange('special_days', date, 'delete', null, originId);
    return { status: 'applied' };
  }
  const { type } = payload || {};
  if (!['holiday', 'special'].includes(type)) {
    return { status: 'rejected', message: "type tiene que ser 'holiday' o 'special'." };
  }
  db.prepare(
    "INSERT INTO special_days (date, type, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now')) ON CONFLICT(date) DO UPDATE SET type = excluded.type, updated_at = datetime('now')"
  ).run(date, type);
  db.recordSyncChange('special_days', date, 'upsert', { date, type }, originId);
  return { status: 'applied', serverRowId: date, serverPayload: { date, type } };
}

// La biblioteca de temas (no "que tema uso YO", eso sigue siendo por
// dispositivo y no se sincroniza -- ver routes/themes.js). Reutiliza
// sanitizeColors/sanitizeInverseColors/serializeTheme de ese mismo
// archivo (ver el require de arriba) para no duplicar la red de
// seguridad de contraste WCAG.
function applyThemeChange(rowId, op, payload, originId) {
  if (op === 'delete') {
    db.prepare('UPDATE devices SET active_theme_id = NULL WHERE active_theme_id = ?').run(rowId);
    db.prepare("DELETE FROM app_settings WHERE key = 'host_active_theme_id' AND value = ?").run(String(rowId));
    db.prepare('DELETE FROM themes WHERE id = ?').run(rowId);
    db.recordSyncChange('themes', rowId, 'delete', null, originId);
    return { status: 'applied' };
  }

  const { name, colors, inverseColors } = payload || {};
  if (!name || !String(name).trim()) {
    return { status: 'rejected', message: 'El tema necesita un nombre.' };
  }

  if (!rowId) {
    const info = db
      .prepare("INSERT INTO themes (name, colors, inverse_colors, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run(
        String(name).trim(),
        JSON.stringify(sanitizeColors(colors)),
        inverseColors ? JSON.stringify(sanitizeInverseColors(inverseColors)) : null
      );
    const row = db.prepare('SELECT * FROM themes WHERE id = ?').get(info.lastInsertRowid);
    const serialized = serializeTheme(row);
    db.recordSyncChange('themes', row.id, 'upsert', serialized, originId);
    return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
  }

  const existing = db.prepare('SELECT * FROM themes WHERE id = ?').get(rowId);
  if (!existing) return { status: 'applied' };
  const existingColors = JSON.parse(existing.colors);
  db.prepare("UPDATE themes SET name = ?, colors = ?, inverse_colors = ?, updated_at = datetime('now') WHERE id = ?").run(
    String(name).trim(),
    JSON.stringify(sanitizeColors(colors !== undefined ? colors : existingColors)),
    inverseColors !== undefined ? (inverseColors ? JSON.stringify(sanitizeInverseColors(inverseColors)) : null) : existing.inverse_colors,
    rowId
  );
  const row = db.prepare('SELECT * FROM themes WHERE id = ?').get(rowId);
  const serialized = serializeTheme(row);
  db.recordSyncChange('themes', row.id, 'upsert', serialized, originId);
  return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
}

// A diferencia de los aplicadores de arriba (que duplican su propia
// validacion/insercion, historico de este archivo), Viajes reutiliza
// las funciones YA existentes de viajesTrips.js/viajesEntries.js --
// son mas complejas (paises embebidos, adjuntos embebidos, borrado en
// cascada real) y ya estaban bien factorizadas alli, asi que duplicar
// esa logica aqui solo arriesgaria que un dia se lleve un fix a un
// sitio y no al otro.
function applyViajesTripChange(rowId, op, payload, originId) {
  if (op === 'delete') {
    const existing = rowId ? db.prepare('SELECT id FROM viajes_trips WHERE id = ?').get(rowId) : null;
    if (!existing) return { status: 'applied' };
    deleteViajesTripCascade(rowId, originId);
    return { status: 'applied' };
  }

  const existing = rowId ? db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(rowId) : null;
  if (rowId && !existing) return { status: 'applied' };

  const result = validateViajesTripBody(payload || {}, existing);
  if (result.error) return { status: 'rejected', message: result.error };

  if (!rowId) {
    const info = db
      .prepare('INSERT INTO viajes_trips (name, color, start_date, end_date, description) VALUES (?, ?, ?, ?, ?)')
      .run(result.name, result.color, result.startDate, result.endDate, result.description);
    setViajesTripCountries(info.lastInsertRowid, result.countries);
    const row = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(info.lastInsertRowid);
    const serialized = serializeViajesTrip(row);
    db.recordSyncChange('viajes_trips', row.id, 'upsert', serialized, originId);
    return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
  }

  db.prepare(
    "UPDATE viajes_trips SET name = ?, color = ?, start_date = ?, end_date = ?, description = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(result.name, result.color, result.startDate, result.endDate, result.description, rowId);
  if (result.countries) setViajesTripCountries(rowId, result.countries);
  const row = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(rowId);
  const serialized = serializeViajesTrip(row);
  db.recordSyncChange('viajes_trips', row.id, 'upsert', serialized, originId);
  return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
}

function applyViajesEntryChange(rowId, op, payload, originId) {
  if (op === 'delete') {
    const existing = rowId ? db.prepare('SELECT id FROM viajes_entries WHERE id = ?').get(rowId) : null;
    if (!existing) return { status: 'applied' };
    deleteViajesEntryCascade(rowId, originId);
    return { status: 'applied' };
  }

  const { tripId, date, content } = payload || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { status: 'rejected', message: 'La fecha tiene que tener el formato YYYY-MM-DD.' };
  }

  if (!rowId) {
    if (!tripId || !db.prepare('SELECT 1 FROM viajes_trips WHERE id = ?').get(tripId)) {
      return { status: 'rejected', message: 'El viaje indicado no existe.' };
    }
    const info = db
      .prepare('INSERT INTO viajes_entries (trip_id, date, content) VALUES (?, ?, ?)')
      .run(tripId, date, content ? String(content) : null);
    const row = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(info.lastInsertRowid);
    const serialized = serializeViajesEntry(row);
    db.recordSyncChange('viajes_entries', row.id, 'upsert', serialized, originId);
    return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
  }

  const existing = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(rowId);
  if (!existing) return { status: 'applied' };
  db.prepare("UPDATE viajes_entries SET date = ?, content = ?, updated_at = datetime('now') WHERE id = ?").run(
    date,
    content ? String(content) : null,
    rowId
  );
  const row = db.prepare('SELECT * FROM viajes_entries WHERE id = ?').get(rowId);
  const serialized = serializeViajesEntry(row);
  db.recordSyncChange('viajes_entries', row.id, 'upsert', serialized, originId);
  return { status: 'applied', serverRowId: row.id, serverPayload: serialized };
}

const APPLIERS = {
  events: applyEventChange,
  notes: applyNoteChange,
  groups: applyGroupChange,
  note_folders: applyNoteFolderChange,
  special_days: applySpecialDayChange,
  themes: applyThemeChange,
  viajes_trips: applyViajesTripChange,
  viajes_entries: applyViajesEntryChange,
};

// Los timestamps de SQLite (datetime('now')) vienen como
// "YYYY-MM-DD HH:MM:SS" en UTC, SIN "T" ni "Z" -- comparar eso como
// texto sin mas contra una fecha ISO 8601 normal (la que manda el
// movil, tipo "2026-08-18T17:45:44.000Z") da resultados incorrectos:
// el caracter "T" (mayor que un espacio) hace que CUALQUIER fecha ISO
// parezca "mas reciente" que una de SQLite aunque sea mas antigua de
// verdad. Aqui se normalizan las dos al mismo formato antes de
// comparar, convirtiendolas a milisegundos.
function toEpochMs(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const ms = new Date(normalized).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Fecha "actual" de una fila ya existente, para decidir quien gana en un
// UPDATE (el mas reciente). special_days usa "date" como clave.
function getExistingUpdatedAt(tableName, rowId) {
  if (!rowId) return null;
  const idCol = TABLES[tableName].idColumn;
  const row = db.prepare(`SELECT updated_at FROM ${tableName} WHERE ${idCol} = ?`).get(rowId);
  return row ? row.updated_at : null;
}

router.get('/pull', (req, res) => {
  const since = Number(req.query.since) || 0;
  const limit = Math.min(Number(req.query.limit) || 500, 500);

  const rows = db.prepare('SELECT * FROM sync_log WHERE id > ? ORDER BY id ASC LIMIT ?').all(since, limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const changes = page.map((r) => ({
    id: r.id,
    tableName: r.table_name,
    rowId: r.table_name === 'special_days' ? r.row_id : Number(r.row_id),
    op: r.op,
    payload: r.payload ? JSON.parse(r.payload) : null,
    deviceOrigin: r.device_origin,
    createdAt: r.created_at,
  }));

  const nextCursor = page.length ? page[page.length - 1].id : since;

  // Solo se actualiza para moviles emparejados (req.device), no para el
  // propio ordenador (que no tiene fila en "devices" -- es "trusted" por
  // IP, ver auth.js). Esto es lo que luego usa la limpieza de sync_log
  // (pruneSyncLog mas abajo) para saber hasta donde ha llegado cada
  // movil y no borrar nunca nada que alguno no haya visto todavia.
  if (req.device) {
    db.prepare('UPDATE devices SET last_sync_seq = ? WHERE id = ?').run(nextCursor, req.device.id);
  }

  res.json({
    changes,
    nextCursor,
    hasMore,
    serverTime: new Date().toISOString(),
  });
});

// Cuanto tiempo se guarda un cambio en sync_log como red de seguridad
// EXTRA, incluso cuando ya no hace falta segun "last_sync_seq" (ver
// pruneSyncLog). De sobra para el uso de una sola persona.
const SYNC_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// Borra de sync_log solo lo que YA no hace falta para nadie: cambios
// anteriores al punto hasta el que TODOS los dispositivos emparejados
// han sincronizado (nunca se borra algo que un movil emparejado no haya
// visto todavia), Y con al menos 30 dias de antiguedad (por si
// last_sync_seq estuviera desactualizado por algun motivo raro -- doble
// candado). Si no hay ningun dispositivo emparejado, o si alguno nunca
// ha sincronizado nada (last_sync_seq = 0, no sabemos por donde va), no
// se borra nada: mejor un sync_log un poco mas grande que perder un
// cambio que un movil todavia necesita.
function pruneSyncLog() {
  const devices = db.prepare('SELECT last_sync_seq FROM devices').all();
  if (devices.length === 0) return { pruned: 0, reason: 'no_paired_devices' };
  if (devices.some((d) => !d.last_sync_seq || d.last_sync_seq <= 0)) {
    return { pruned: 0, reason: 'device_never_synced' };
  }

  const floor = Math.min(...devices.map((d) => d.last_sync_seq));
  // Mismo formato "YYYY-MM-DD HH:MM:SS" que usa SQLite en created_at
  // (ver toEpochMs mas arriba, mismo motivo: comparar como texto solo
  // funciona si los dos lados tienen el mismo formato).
  const cutoff = new Date(Date.now() - SYNC_LOG_RETENTION_MS).toISOString().slice(0, 19).replace('T', ' ');

  const info = db.prepare('DELETE FROM sync_log WHERE id <= ? AND created_at < ?').run(floor, cutoff);
  return { pruned: info.changes, reason: 'ok', floor };
}

router.post('/push', (req, res) => {
  const { changes } = req.body || {};
  if (!Array.isArray(changes)) {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta la lista de cambios.' });
  }

  const originId = req.device ? req.device.id : null;

  const results = changes.map((change) => {
    const { clientOpId, table, rowId, op, payload, clientUpdatedAt } = change || {};
    if (!APPLIERS[table] || !['upsert', 'delete'].includes(op)) {
      return { clientOpId, status: 'rejected', message: 'Cambio invalido.' };
    }

    // "El mas reciente gana": si es una actualizacion (upsert con rowId
    // ya existente) y el servidor tiene una version mas nueva (o de la
    // misma fecha exacta -- en un empate gana el ordenador, por ser la
    // fuente de referencia), no se aplica: se avisa al movil de cual es
    // la version que ha ganado, para que se quede con esa. Un borrado
    // gana siempre frente a una edicion simultanea, sin comparar fechas
    // (regla mas simple).
    if (op === 'upsert' && rowId) {
      const serverUpdatedAt = getExistingUpdatedAt(table, table === 'special_days' ? rowId : Number(rowId));
      const serverMs = toEpochMs(serverUpdatedAt);
      const clientMs = toEpochMs(clientUpdatedAt);
      if (serverMs !== null && clientMs !== null && clientMs <= serverMs) {
        const idCol = TABLES[table].idColumn;
        const currentRow = db.prepare(`SELECT * FROM ${table} WHERE ${idCol} = ?`).get(table === 'special_days' ? rowId : Number(rowId));
        if (currentRow) {
          const serializeFn = { events: serializeEvent, notes: serializeNote, groups: serializeGroup, note_folders: serializeNoteFolder, special_days: (r) => ({ date: r.date, type: r.type }), themes: serializeTheme, viajes_trips: serializeViajesTrip, viajes_entries: serializeViajesEntry }[table];
          return { clientOpId, status: 'superseded', serverPayload: serializeFn(currentRow) };
        }
      }
    }

    try {
      const applied = APPLIERS[table](table === 'special_days' ? rowId : (rowId ? Number(rowId) : null), op, payload, originId);
      return Object.assign({ clientOpId }, applied);
    } catch (err) {
      return { clientOpId, status: 'rejected', message: err.message || 'Error al aplicar el cambio.' };
    }
  });

  res.json({ results });
});

// Una vez al dia es de sobra -- sync_log de una sola persona no crece
// tan rapido como para necesitar limpiarlo mas a menudo. Mismo patron
// que startReminderChecker() en reminderChecker.js: se llama una vez al
// arrancar el servidor y luego con setInterval (ver server/index.js).
const SYNC_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function startSyncLogCleanup() {
  pruneSyncLog();
  const timer = setInterval(pruneSyncLog, SYNC_LOG_CLEANUP_INTERVAL_MS);
  timer.unref(); // no impide que el proceso termine si hace falta
  return timer;
}

module.exports = router;
module.exports.pruneSyncLog = pruneSyncLog;
module.exports.startSyncLogCleanup = startSyncLogCleanup;
