// routes/events.js — CRUD de eventos del calendario.
const express = require('express');
const db = require('../db');

const router = express.Router();

// Traemos el nombre, color, icono y color-de-completada del grupo con un
// LEFT JOIN (LEFT para que tambien salgan los eventos sin grupo, con esos
// campos a NULL).
const SELECT_WITH_GROUP = `
  SELECT e.*, g.name AS group_name, g.color AS group_color, g.icon AS group_icon, g.completed_color AS group_completed_color
  FROM events e
  LEFT JOIN groups g ON g.id = e.group_id
`;

function serialize(row) {
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
    groupName: row.group_name || null,
    groupColor: row.group_color || null,
    groupIcon: row.group_icon || null,
    groupCompletedColor: row.group_completed_color || null,
    isTask: !!row.is_task,
    done: !!row.done,
    createdByName: row.created_by_name || null,
    createdByPublicId: row.created_by_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/events?from=2026-08-01&to=2026-08-31&isTask=1
// from/to e isTask son opcionales y combinables: from/to filtra por rango
// de fecha (los eventos/tareas sin start_at nunca caen en un rango, asi
// que quedan fuera si se pide un rango); isTask=1 solo tareas, isTask=0
// solo eventos normales. Sin ningun filtro, devuelve todo.
router.get('/', (req, res) => {
  const { from, to, isTask } = req.query;
  const conditions = [];
  const params = [];
  if (from && to) {
    conditions.push('e.start_at >= ? AND e.start_at <= ?');
    params.push(from, to);
  }
  if (isTask !== undefined) {
    conditions.push('e.is_task = ?');
    params.push(isTask === '1' || isTask === 'true' ? 1 : 0);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`${SELECT_WITH_GROUP} ${where} ORDER BY e.start_at ASC`)
    .all(...params);
  res.json(rows.map(serialize));
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serialize(row));
});

function resolveGroupId(groupId) {
  if (groupId === undefined || groupId === null || groupId === '') return null;
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
  return group ? group.id : null; // si mandan un id que no existe, lo ignoramos en vez de fallar
}

router.post('/', (req, res) => {
  const { title, description, location, startAt, endAt, allDay, reminderMinutesBefore, groupId, isTask } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'El evento necesita un titulo.' });
  }
  // Las tareas pueden no tener fecha (viven solo en la lista de Tareas);
  // los eventos normales si la necesitan, como siempre.
  if (!isTask && !startAt) {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta la fecha/hora de inicio.' });
  }

  // "Creado por" se rellena con tu perfil en el momento de crear el
  // evento (ver server/db.js): una foto fija de tu nombre de entonces, no
  // un enlace en vivo a tu nickname actual.
  const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();

  const info = db
    .prepare(`
      INSERT INTO events (title, description, location, start_at, end_at, all_day, reminder_minutes_before, group_id, created_by_name, created_by_id, is_task)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      title.trim(),
      description || null,
      location || null,
      startAt || null,
      endAt || null,
      allDay ? 1 : 0,
      reminderMinutesBefore === undefined || reminderMinutesBefore === null ? null : Number(reminderMinutesBefore),
      resolveGroupId(groupId),
      profile && profile.name ? profile.name : null,
      profile ? profile.public_id : null,
      isTask ? 1 : 0
    );

  const row = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(info.lastInsertRowid);
  const serialized = serialize(row);
  db.recordSyncChange('events', row.id, 'upsert', serialized, req.device ? req.device.id : null);
  res.status(201).json(serialized);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { title, description, location, startAt, endAt, allDay, reminderMinutesBefore, groupId, isTask, done } = req.body || {};

  // Si cambia el recordatorio o el inicio, lo volvemos a "armar"
  // (reminder_sent = 0) para que pueda dispararse otra vez.
  const reminderChanged =
    reminderMinutesBefore !== undefined && Number(reminderMinutesBefore) !== existing.reminder_minutes_before;
  const startChanged = startAt !== undefined && startAt !== existing.start_at;

  db.prepare(`
    UPDATE events SET
      title = ?,
      description = ?,
      location = ?,
      start_at = ?,
      end_at = ?,
      all_day = ?,
      reminder_minutes_before = ?,
      reminder_sent = ?,
      group_id = ?,
      is_task = ?,
      done = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title !== undefined ? title.trim() : existing.title,
    description !== undefined ? description : existing.description,
    location !== undefined ? location : existing.location,
    startAt !== undefined ? (startAt || null) : existing.start_at,
    endAt !== undefined ? endAt : existing.end_at,
    allDay !== undefined ? (allDay ? 1 : 0) : existing.all_day,
    reminderMinutesBefore !== undefined
      ? (reminderMinutesBefore === null ? null : Number(reminderMinutesBefore))
      : existing.reminder_minutes_before,
    reminderChanged || startChanged ? 0 : existing.reminder_sent,
    groupId !== undefined ? resolveGroupId(groupId) : existing.group_id,
    isTask !== undefined ? (isTask ? 1 : 0) : existing.is_task,
    done !== undefined ? (done ? 1 : 0) : existing.done,
    req.params.id
  );

  const row = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(req.params.id);
  const serialized = serialize(row);
  db.recordSyncChange('events', row.id, 'upsert', serialized, req.device ? req.device.id : null);
  res.json(serialized);
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  db.recordSyncChange('events', req.params.id, 'delete', null, req.device ? req.device.id : null);
  res.status(204).end();
});

module.exports = router;
