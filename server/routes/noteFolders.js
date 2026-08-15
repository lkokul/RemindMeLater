// routes/noteFolders.js — carpetas para organizar notas de "Mi espacio"
// (Fase 3): nombre + icono + color, un sistema propio SEPARADO de los
// Grupos del calendario. Mismo patron que routes/groups.js.
const express = require('express');
const db = require('../db');

const router = express.Router();

function sanitizeIcon(icon) {
  if (icon === undefined) return undefined; // "no lo toques"
  if (icon === null || icon === '') return null; // "quitalo"
  return String(icon).slice(0, 8);
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon || null,
    position: row.position,
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM note_folders ORDER BY position ASC, id ASC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { name, color, icon } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'La carpeta necesita un nombre.' });
  }
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';

  const { count } = db.prepare('SELECT COUNT(*) as count FROM note_folders').get();
  const info = db
    .prepare('INSERT INTO note_folders (name, color, icon, position) VALUES (?, ?, ?, ?)')
    .run(name.trim(), safeColor, sanitizeIcon(icon) ?? null, count);

  const row = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, color, icon } = req.body || {};
  const safeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;
  const sanitizedIcon = sanitizeIcon(icon);

  db.prepare('UPDATE note_folders SET name = ?, color = ?, icon = ? WHERE id = ?').run(
    name !== undefined && name.trim() ? name.trim() : existing.name,
    safeColor,
    sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  // Las notas de esta carpeta no se borran: se quedan sin carpeta
  // (folder_id a NULL), igual que al borrar un Grupo los eventos no
  // desaparecen, solo pierden la etiqueta.
  db.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ?').run(req.params.id);
  const info = db.prepare('DELETE FROM note_folders WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
