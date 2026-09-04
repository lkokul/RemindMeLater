// finanzasPortfolios — portado de server/routes/finanzasPortfolios.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/finanzasPortfolios.js — carteras anidadas de la pestaña
  // Inversiones (extension Finanzas), para poder agrupar activos y
  // filtrar la grafica de evolucion mensual por cartera/subcartera/activo
  // individual (ver el arbol de seleccion en app.js). Calco de
  // routes/noteFolders.js (mismo parent_id auto-referenciado, mismas
  // comprobaciones de ciclo), pero sin icono -- mismo criterio ya
  // aplicado a note_folders.

  const router = createLocalRouter();

  function serialize(row) {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      position: row.position,
      parentId: row.parent_id,
    };
  }

  // Evita ciclos: una cartera no puede ser su propio antepasado. Sube por
  // la cadena de parent_id desde candidateParentId; si en algun punto
  // llega a portfolioId, poner ese parent crearia un bucle.
  function wouldCreateCycle(portfolioId, candidateParentId) {
    let current = candidateParentId;
    const seen = new Set();
    while (current !== null && current !== undefined) {
      if (current === portfolioId) return true;
      if (seen.has(current)) return true; // por si ya hubiera un ciclo raro de antes
      seen.add(current);
      const row = db.prepare('SELECT parent_id FROM finanzas_portfolios WHERE id = ?').get(current);
      if (!row) return false; // parent apunta a algo que no existe, no es un ciclo
      current = row.parent_id;
    }
    return false;
  }

  function resolveParentId(portfolioId, parentId) {
    if (parentId === undefined || parentId === null || parentId === '') return null;
    const numericId = Number(parentId);
    if (numericId === portfolioId) return undefined; // invalido: no puedes ser tu propio padre
    const portfolio = db.prepare('SELECT id FROM finanzas_portfolios WHERE id = ?').get(numericId);
    if (!portfolio) return null; // apunta a algo que no existe, se ignora
    if (portfolioId !== null && wouldCreateCycle(portfolioId, numericId)) return undefined; // invalido: crearia un bucle
    return numericId;
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM finanzas_portfolios ORDER BY position ASC, id ASC').all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const { name, color, parentId } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'La cartera necesita un nombre.' });
    }
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';
    // Al crear no hay id todavia, asi que un ciclo es imposible -- solo
    // hace falta comprobar que el padre exista.
    const safeParentId = resolveParentId(null, parentId);

    const { count } = db.prepare('SELECT COUNT(*) as count FROM finanzas_portfolios').get();
    const info = db
      .prepare('INSERT INTO finanzas_portfolios (name, color, position, parent_id) VALUES (?, ?, ?, ?)')
      .run(name.trim(), safeColor, count, safeParentId ?? null);

    const row = db.prepare('SELECT * FROM finanzas_portfolios WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM finanzas_portfolios WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { name, color, parentId } = req.body || {};
    const safeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;

    let nextParentId = existing.parent_id;
    if (parentId !== undefined) {
      const resolved = resolveParentId(existing.id, parentId);
      if (resolved === undefined) {
        return res.status(400).json({ error: 'invalid_request', message: 'Esa cartera no puede ser su propio padre (o el de una de sus subcarteras).' });
      }
      nextParentId = resolved;
    }

    db.prepare('UPDATE finanzas_portfolios SET name = ?, color = ?, parent_id = ? WHERE id = ?').run(
      name !== undefined && name.trim() ? name.trim() : existing.name,
      safeColor,
      nextParentId,
      req.params.id
    );

    const row = db.prepare('SELECT * FROM finanzas_portfolios WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  router.delete('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM finanzas_portfolios WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // Los activos de esta cartera no se borran: se quedan sin cartera
    // (portfolio_id a NULL), igual que al borrar un Grupo los eventos no
    // desaparecen, solo pierden la etiqueta.
    db.prepare('UPDATE finanzas_assets SET portfolio_id = NULL WHERE portfolio_id = ?').run(req.params.id);
    // Las SUBcarteras tampoco se borran: suben un nivel, al padre de la
    // cartera borrada (o a la raiz si no tenia) -- como quitar una carpeta
    // de en medio del arbol y que sus hijas ocupen su sitio.
    db.prepare('UPDATE finanzas_portfolios SET parent_id = ? WHERE parent_id = ?').run(existing.parent_id, req.params.id);

    const info = db.prepare('DELETE FROM finanzas_portfolios WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  mountLocalRouter('/api/finanzas-portfolios', router);

})();
