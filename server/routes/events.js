// routes/events.js — CRUD de eventos del calendario.
const express = require('express');
const db = require('../db');

const router = express.Router();

// Traemos el nombre y color del grupo con un LEFT JOIN (LEFT para que
// tambien salgan los eventos sin grupo, con group_name/group_color a NULL).
const SELECT_WITH_GROUP = `
  SELECT e.*, g.name AS group_name, g.color AS group_color
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/events?from=2026-08-01&to=2026-08-31
// from/to son opcionales; si no se pasan, devuelve todos los eventos.
router.get('/', (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    rows = db
      .prepare(`${SELECT_WITH_GROUP} WHERE e.start_at >= ? AND e.start_at <= ? ORDER BY e.start_at ASC`)
      .all(from, to);
  } else {
    rows = db.prepare(`${SELECT_WITH_GROUP} ORDER BY e.start_at ASC`).all();
  }
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
  const { title, description, location, startAt, endAt, allDay, reminderMinutesBefore, groupId } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'El evento necesita un titulo.' });
  }
  if (!startAt) {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta la fecha/hora de inicio.' });
  }

  const info = db
    .prepare(`
      INSERT INTO events (title, description, location, start_at, end_at, all_day, reminder_minutes_before, group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      title.trim(),
      description || null,
      location || null,
      startAt,
      endAt || null,
      allDay ? 1 : 0,
      reminderMinutesBefore === undefined || reminderMinutesBefore === null ? null : Number(reminderMinutesBefore),
      resolveGroupId(groupId)
    );

  const row = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { title, description, location, startAt, endAt, allDay, reminderMinutesBefore, groupId } = req.body || {};

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
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title !== undefined ? title.trim() : existing.title,
    description !== undefined ? description : existing.description,
    location !== undefined ? location : existing.location,
    startAt !== undefined ? startAt : existing.start_at,
    endAt !== undefined ? endAt : existing.end_at,
    allDay !== undefined ? (allDay ? 1 : 0) : existing.all_day,
    reminderMinutesBefore !== undefined
      ? (reminderMinutesBefore === null ? null : Number(reminderMinutesBefore))
      : existing.reminder_minutes_before,
    reminderChanged || startChanged ? 0 : existing.reminder_sent,
    groupId !== undefined ? resolveGroupId(groupId) : existing.group_id,
    req.params.id
  );

  const row = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
