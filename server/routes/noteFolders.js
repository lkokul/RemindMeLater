// routes/noteFolders.js — carpetas para organizar notas de "Mi espacio"
// (Fase 3): nombre + icono + color, un sistema propio SEPARADO de los
// Grupos del calendario. Pueden contener otras carpetas (navegacion tipo
// explorador de archivos, ver renderNotesView en app.js) -- parent_id
// NULL significa "carpeta de nivel raiz".
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
    parentId: row.parent_id,
    favorite: !!row.favorite,
  };
}

// Evita ciclos: una carpeta no puede ser su propio antepasado. Sube por
// la cadena de parent_id desde candidateParentId; si en algun punto
// llega a folderId, poner ese parent crearia un bucle.
function wouldCreateCycle(folderId, candidateParentId) {
  let current = candidateParentId;
  const seen = new Set();
  while (current !== null && current !== undefined) {
    if (current === folderId) return true;
    if (seen.has(current)) return true; // por si ya hubiera un ciclo raro de antes
    seen.add(current);
    const row = db.prepare('SELECT parent_id FROM note_folders WHERE id = ?').get(current);
    if (!row) return false; // parent apunta a algo que no existe, no es un ciclo
    current = row.parent_id;
  }
  return false;
}

function resolveParentId(folderId, parentId) {
  if (parentId === undefined || parentId === null || parentId === '') return null;
  const numericId = Number(parentId);
  if (numericId === folderId) return undefined; // invalido: no puedes ser tu propio padre
  const folder = db.prepare('SELECT id FROM note_folders WHERE id = ?').get(numericId);
  if (!folder) return null; // apunta a algo que no existe, se ignora
  if (folderId !== null && wouldCreateCycle(folderId, numericId)) return undefined; // invalido: crearia un bucle
  return numericId;
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM note_folders ORDER BY position ASC, id ASC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { name, color, icon, parentId, favorite } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'La carpeta necesita un nombre.' });
  }
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';
  // Al crear no hay id todavia, asi que un ciclo es imposible -- solo
  // hace falta comprobar que el padre exista.
  const safeParentId = resolveParentId(null, parentId);

  const { count } = db.prepare('SELECT COUNT(*) as count FROM note_folders').get();
  const info = db
    .prepare('INSERT INTO note_folders (name, color, icon, position, parent_id, favorite) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), safeColor, sanitizeIcon(icon) ?? null, count, safeParentId ?? null, favorite ? 1 : 0);

  const row = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, color, icon, parentId, favorite } = req.body || {};
  const safeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;
  const sanitizedIcon = sanitizeIcon(icon);

  let nextParentId = existing.parent_id;
  if (parentId !== undefined) {
    const resolved = resolveParentId(existing.id, parentId);
    if (resolved === undefined) {
      return res.status(400).json({ error: 'invalid_request', message: 'Esa carpeta no puede ser su propio padre (o el de una de sus subcarpetas).' });
    }
    nextParentId = resolved;
  }

  db.prepare('UPDATE note_folders SET name = ?, color = ?, icon = ?, parent_id = ?, favorite = ? WHERE id = ?').run(
    name !== undefined && name.trim() ? name.trim() : existing.name,
    safeColor,
    sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
    nextParentId,
    favorite !== undefined ? (favorite ? 1 : 0) : existing.favorite,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // Las notas de esta carpeta no se borran: se quedan sin carpeta
  // (folder_id a NULL), igual que al borrar un Grupo los eventos no
  // desaparecen, solo pierden la etiqueta.
  db.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ?').run(req.params.id);
  // Las SUBcarpetas tampoco se borran: suben un nivel, al padre de la
  // carpeta borrada (o a la raiz si no tenia) -- como quitar una carpeta
  // de en medio del arbol y que sus hijas ocupen su sitio.
  db.prepare('UPDATE note_folders SET parent_id = ? WHERE parent_id = ?').run(existing.parent_id, req.params.id);

  const info = db.prepare('DELETE FROM note_folders WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
