// routes/groups.js — listas/grupos de recordatorios, al estilo "Listas" de
// Recordatorios de iPhone: un nombre, un color y (opcional) un icono
// (simbolo o emoji) que luego se refleja en cada evento de ese grupo.
const { createRouter } = require('../router');
const db = require('../db');

const router = createRouter();

function sanitizeIcon(icon) {
  if (icon === undefined) return undefined; // "no lo toques"
  if (icon === null || icon === '') return null; // "quitalo"
  // Los emoji compuestos (con modificador de tono de piel, banderas,
  // familias con ZWJ...) pueden ocupar varios "caracteres" de JS. Un
  // limite generoso de 8 evita que alguien pegue un parrafo entero aqui
  // sin bloquear emoji legitimos algo mas largos.
  return String(icon).slice(0, 8);
}

function serialize(row) {
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

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM groups ORDER BY position ASC, id ASC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { name, color, icon, completedColor } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'El grupo necesita un nombre.' });
  }
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';
  const safeCompletedColor = /^#[0-9a-fA-F]{6}$/.test(completedColor || '') ? completedColor : null;

  const { count } = db.prepare('SELECT COUNT(*) as count FROM groups').get();
  const info = db
    .prepare("INSERT INTO groups (name, color, icon, position, completed_color, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
    .run(name.trim(), safeColor, sanitizeIcon(icon) ?? null, count, safeCompletedColor);

  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid);
  const serialized = serialize(row);
  res.status(201).json(serialized);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, color, icon, completedColor } = req.body || {};
  const safeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;
  const sanitizedIcon = sanitizeIcon(icon);
  // completedColor: undefined = "no lo toques", null/'' = "quitalo", si no
  // es un hex valido se ignora y se conserva el que hubiera.
  const safeCompletedColor =
    completedColor === undefined
      ? existing.completed_color
      : (completedColor === null || completedColor === '')
        ? null
        : (/^#[0-9a-fA-F]{6}$/.test(completedColor) ? completedColor : existing.completed_color);

  db.prepare("UPDATE groups SET name = ?, color = ?, icon = ?, completed_color = ?, updated_at = datetime('now') WHERE id = ?").run(
    name !== undefined && name.trim() ? name.trim() : existing.name,
    safeColor,
    sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
    safeCompletedColor,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  const serialized = serialize(row);
  res.json(serialized);
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
