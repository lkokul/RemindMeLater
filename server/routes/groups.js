// routes/groups.js — listas/grupos de recordatorios, al estilo "Listas" de
// Recordatorios de iPhone: un nombre y un color que luego se refleja en
// cada evento que pertenezca a ese grupo.
const express = require('express');
const db = require('../db');

const router = express.Router();

function serialize(row) {
  return { id: row.id, name: row.name, color: row.color, position: row.position };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM groups ORDER BY position ASC, id ASC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { name, color } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'El grupo necesita un nombre.' });
  }
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';

  const { count } = db.prepare('SELECT COUNT(*) as count FROM groups').get();
  const info = db
    .prepare('INSERT INTO groups (name, color, position) VALUES (?, ?, ?)')
    .run(name.trim(), safeColor, count);

  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, color } = req.body || {};
  const safeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;

  db.prepare('UPDATE groups SET name = ?, color = ? WHERE id = ?').run(
    name !== undefined && name.trim() ? name.trim() : existing.name,
    safeColor,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  // Los eventos de este grupo no se borran: simplemente se quedan sin
  // grupo (group_id a NULL), igual que al borrar una lista en Recordatorios
  // no se borran los recordatorios que contenia sin mas.
  db.prepare('UPDATE events SET group_id = NULL WHERE group_id = ?').run(req.params.id);
  const info = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
