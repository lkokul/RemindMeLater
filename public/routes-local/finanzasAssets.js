// finanzasAssets — portado de server/routes/finanzasAssets.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/finanzasAssets.js — activos de la pestaña Inversiones (extension
  // Finanzas), como entidad real (antes de esta ronda, cada transaccion de
  // inversion solo llevaba un asset_name de texto libre, sin identidad
  // propia -- ver migracion asset_id en db.js). Un activo puede pertenecer
  // a una cartera (finanzas_portfolios) para el arbol de seleccion de la
  // grafica. Aqui tambien viven las valoraciones manuales de precio de
  // cada activo (GET/POST /:id/valuations, DELETE /valuations/:valuationId)
  // -- son un sub-recurso pequeño de un solo padre, no justifican un
  // fichero de rutas aparte.

  const router = createLocalRouter();

  function serialize(row) {
    return {
      id: row.id,
      name: row.name,
      portfolioId: row.portfolio_id,
      position: row.position,
    };
  }

  function serializeValuation(row) {
    return {
      id: row.id,
      assetId: row.asset_id,
      date: row.date,
      pricePerUnit: row.price_per_unit,
      notes: row.notes || null,
    };
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM finanzas_assets ORDER BY position ASC, id ASC').all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const { name, portfolioId } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'El activo necesita un nombre.' });
    }
    let safePortfolioId = null;
    if (portfolioId !== undefined && portfolioId !== null && portfolioId !== '') {
      const portfolio = db.prepare('SELECT id FROM finanzas_portfolios WHERE id = ?').get(portfolioId);
      if (portfolio) safePortfolioId = portfolio.id;
    }

    const { count } = db.prepare('SELECT COUNT(*) as count FROM finanzas_assets').get();
    const info = db
      .prepare('INSERT INTO finanzas_assets (name, portfolio_id, position) VALUES (?, ?, ?)')
      .run(name.trim(), safePortfolioId, count);

    const row = db.prepare('SELECT * FROM finanzas_assets WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM finanzas_assets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { name, portfolioId } = req.body || {};
    let nextPortfolioId = existing.portfolio_id;
    if (portfolioId !== undefined) {
      if (portfolioId === null || portfolioId === '') {
        nextPortfolioId = null;
      } else {
        const portfolio = db.prepare('SELECT id FROM finanzas_portfolios WHERE id = ?').get(portfolioId);
        nextPortfolioId = portfolio ? portfolio.id : null;
      }
    }

    db.prepare('UPDATE finanzas_assets SET name = ?, portfolio_id = ? WHERE id = ?').run(
      name !== undefined && name.trim() ? name.trim() : existing.name,
      nextPortfolioId,
      req.params.id
    );

    // asset_name en finanzas_investment_transactions es una cache
    // desnormalizada (ver comentario de la migracion en db.js) -- se
    // mantiene al dia aqui si el nombre del activo cambia, para que el
    // historial ya escrito no se quede con un nombre viejo.
    const row = db.prepare('SELECT * FROM finanzas_assets WHERE id = ?').get(req.params.id);
    db.prepare('UPDATE finanzas_investment_transactions SET asset_name = ? WHERE asset_id = ?').run(row.name, row.id);

    res.json(serialize(row));
  });

  router.delete('/:id', (req, res) => {
    // Un activo con operaciones registradas NO se deja borrar -- mismo
    // criterio que finanzas_accounts.js con las cuentas.
    const { count } = db.prepare('SELECT COUNT(*) as count FROM finanzas_investment_transactions WHERE asset_id = ?').get(req.params.id);
    if (count > 0) {
      return res.status(400).json({
        error: 'has_history',
        message: 'Este activo ya tiene operaciones registradas -- no se puede borrar sin perder ese historial.',
      });
    }

    db.prepare('DELETE FROM finanzas_asset_valuations WHERE asset_id = ?').run(req.params.id);
    const info = db.prepare('DELETE FROM finanzas_assets WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  // -- Valoraciones manuales de precio (ver renderFinanzasAssetValuationChart
  //    en app.js) --

  router.get('/:id/valuations', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM finanzas_asset_valuations WHERE asset_id = ? ORDER BY date DESC, id DESC')
      .all(req.params.id);
    res.json(rows.map(serializeValuation));
  });

  router.post('/:id/valuations', (req, res) => {
    const asset = db.prepare('SELECT id FROM finanzas_assets WHERE id = ?').get(req.params.id);
    if (!asset) return res.status(404).json({ error: 'not_found' });

    const { date, pricePerUnit, notes } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'invalid_request', message: 'La fecha tiene que tener el formato YYYY-MM-DD.' });
    }
    const price = Number(pricePerUnit);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: 'invalid_request', message: 'El precio por unidad tiene que ser un numero mayor que 0.' });
    }
    const safeNotes = typeof notes === 'string' && notes.trim() ? notes.trim() : null;

    const info = db
      .prepare('INSERT INTO finanzas_asset_valuations (asset_id, date, price_per_unit, notes) VALUES (?, ?, ?, ?)')
      .run(req.params.id, date, price, safeNotes);

    const row = db.prepare('SELECT * FROM finanzas_asset_valuations WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serializeValuation(row));
  });

  router.delete('/valuations/:valuationId', (req, res) => {
    const info = db.prepare('DELETE FROM finanzas_asset_valuations WHERE id = ?').run(req.params.valuationId);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  mountLocalRouter('/api/finanzas-assets', router);

})();
