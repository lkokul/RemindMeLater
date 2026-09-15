// finanzasCategories — portado de server/routes/finanzasCategories.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/finanzasCategories.js — categorias de GASTO de la extension
  // Finanzas (ej. "Comida", "Transporte"). Solo organizacion, mismo
  // patron icono+color+posicion que server/routes/groups.js.

  const router = createLocalRouter();

  function sanitizeIcon(icon) {
    if (icon === undefined) return undefined;
    if (icon === null || icon === '') return null;
    return String(icon).slice(0, 8);
  }

  function serialize(row) {
    return {
      id: row.id,
      name: row.name,
      icon: row.icon || null,
      color: row.color,
      position: row.position,
    };
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM finanzas_categories ORDER BY position ASC, id ASC').all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const { name, icon, color } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'La categoria necesita un nombre.' });
    }
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';

    const { count } = db.prepare('SELECT COUNT(*) as count FROM finanzas_categories').get();
    const info = db
      .prepare('INSERT INTO finanzas_categories (name, icon, color, position) VALUES (?, ?, ?, ?)')
      .run(name.trim(), sanitizeIcon(icon) ?? null, safeColor, count);

    const row = db.prepare('SELECT * FROM finanzas_categories WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM finanzas_categories WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { name, icon, color } = req.body || {};
    const safeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;
    const sanitizedIcon = sanitizeIcon(icon);

    db.prepare('UPDATE finanzas_categories SET name = ?, icon = ?, color = ? WHERE id = ?').run(
      name !== undefined && name.trim() ? name.trim() : existing.name,
      sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
      safeColor,
      req.params.id
    );

    const row = db.prepare('SELECT * FROM finanzas_categories WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  router.delete('/:id', (req, res) => {
    // Solo organizativa: los gastos que la usaban se quedan sin
    // categoria (NULL), igual que un evento se queda sin grupo.
    db.prepare('UPDATE finanzas_transactions SET category_id = NULL WHERE category_id = ?').run(req.params.id);
    const info = db.prepare('DELETE FROM finanzas_categories WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  mountLocalRouter('/api/finanzas-categories', router);

})();
