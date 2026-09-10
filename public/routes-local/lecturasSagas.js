// lecturasSagas — portado de server/routes/lecturasSagas.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/lecturasSagas.js — sagas de la extension Lecturas (ver
  // #extensions-view en index.html): el contenedor OBLIGATORIO de todo
  // item (manga/comic/libro/serie/anime/pelicula), incluso algo suelto
  // (una saga de un solo item) -- asi una misma obra puede agrupar tipos
  // distintos (el manga Y el anime) bajo un mismo nombre.

  const router = createLocalRouter();

  // Resumen para pintar la tabla de sagas sin una peticion aparte por
  // fila: cuantos items tiene y que tipos hay dentro (para poder mostrar
  // un vistazo rapido, ej. "manga, anime").
  function serialize(row) {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM lecturas_items WHERE saga_id = ?').get(row.id);
    const types = db.prepare('SELECT DISTINCT type FROM lecturas_items WHERE saga_id = ? ORDER BY type').all(row.id).map((t) => t.type);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      itemCount: count,
      types,
    };
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM lecturas_sagas ORDER BY name COLLATE NOCASE ASC').all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const { name, description } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'La saga necesita un nombre.' });
    }
    const info = db
      .prepare('INSERT INTO lecturas_sagas (name, description) VALUES (?, ?)')
      .run(name.trim(), description && description.trim() ? description.trim() : null);

    const row = db.prepare('SELECT * FROM lecturas_sagas WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM lecturas_sagas WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { name, description } = req.body || {};
    db.prepare("UPDATE lecturas_sagas SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(
      name !== undefined && name.trim() ? name.trim() : existing.name,
      description === undefined ? existing.description : (description && description.trim() ? description.trim() : null),
      req.params.id
    );

    const row = db.prepare('SELECT * FROM lecturas_sagas WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  router.delete('/:id', (req, res) => {
    // A diferencia de Gimnasio con las rutinas, aqui un item NO tiene
    // sentido sin su saga (es obligatoria, no hay "sagaId NULL" donde
    // reasignarlo) -- borrar la saga borra sus items directamente.
    db.prepare('DELETE FROM lecturas_items WHERE saga_id = ?').run(req.params.id);
    const info = db.prepare('DELETE FROM lecturas_sagas WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  mountLocalRouter('/api/lecturas-sagas', router);

})();
