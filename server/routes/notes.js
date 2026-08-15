// routes/notes.js — CRUD de notas de "Mi espacio" (titulo + texto plano,
// sin formato todavia; carpeta opcional desde la Fase 3, ver
// routes/noteFolders.js).
const express = require('express');
const db = require('../db');

const router = express.Router();

const SELECT_WITH_FOLDER = `
  SELECT n.*, f.name AS folder_name, f.color AS folder_color, f.icon AS folder_icon
  FROM notes n
  LEFT JOIN note_folders f ON f.id = n.folder_id
`;

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    hidden: !!row.hidden,
    folderId: row.folder_id,
    folderName: row.folder_name || null,
    folderColor: row.folder_color || null,
    folderIcon: row.folder_icon || null,
    createdByName: row.created_by_name || null,
    createdByPublicId: row.created_by_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveFolderId(folderId) {
  if (folderId === undefined || folderId === null || folderId === '') return null;
  const folder = db.prepare('SELECT id FROM note_folders WHERE id = ?').get(folderId);
  return folder ? folder.id : null; // si mandan un id que no existe, lo ignoramos en vez de fallar
}

router.get('/', (req, res) => {
  const rows = db.prepare(`${SELECT_WITH_FOLDER} ORDER BY n.updated_at DESC`).all();
  res.json(rows.map(serialize));
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`${SELECT_WITH_FOLDER} WHERE n.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serialize(row));
});

router.post('/', (req, res) => {
  const { title, body, folderId } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'La nota necesita un titulo.' });
  }

  // "Creado por" se rellena con tu perfil en el momento de crear la nota,
  // igual que en los eventos (ver server/db.js): una foto fija del nombre
  // de entonces, no un enlace en vivo a tu nickname actual.
  const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();

  const info = db
    .prepare('INSERT INTO notes (title, body, folder_id, created_by_name, created_by_id) VALUES (?, ?, ?, ?, ?)')
    .run(
      title.trim(),
      body || null,
      resolveFolderId(folderId),
      profile && profile.name ? profile.name : null,
      profile ? profile.public_id : null
    );

  const row = db.prepare(`${SELECT_WITH_FOLDER} WHERE n.id = ?`).get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { title, body, hidden, folderId } = req.body || {};
  if (title !== undefined && !title.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'La nota necesita un titulo.' });
  }

  db.prepare(`
    UPDATE notes SET
      title = ?,
      body = ?,
      hidden = ?,
      folder_id = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title !== undefined ? title.trim() : existing.title,
    body !== undefined ? body : existing.body,
    hidden !== undefined ? (hidden ? 1 : 0) : existing.hidden,
    folderId !== undefined ? resolveFolderId(folderId) : existing.folder_id,
    req.params.id
  );

  const row = db.prepare(`${SELECT_WITH_FOLDER} WHERE n.id = ?`).get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
