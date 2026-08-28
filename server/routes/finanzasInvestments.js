// routes/finanzasInvestments.js — compra/venta/dividendos de la extension
// Finanzas. Solo registro manual (sin conectar a ninguna API de
// cotizaciones en vivo -- decision tomada con Koku para mantener la app
// local-first). La ganancia/perdida que se calcula es la REALIZADA (lo
// que ya se vendio o cobro), nunca un valor de mercado del dia a dia.
const express = require('express');
const db = require('../db');

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    assetId: row.asset_id,
    // asset_name es una cache desnormalizada (ver migracion en db.js) --
    // se usa como fallback por si asset_id quedara huerfano algun dia,
    // pero en el flujo normal el activo referenciado siempre existe.
    assetName: row.asset_name,
    type: row.type,
    quantity: row.quantity,
    pricePerUnit: row.price_per_unit,
    amount: row.amount,
    date: row.date,
    notes: row.notes || null,
    countsTowardBudget: !!row.counts_toward_budget,
  };
}

function validateBody(body, existing) {
  const accountId = body.accountId !== undefined ? body.accountId : existing && existing.account_id;
  const assetId = body.assetId !== undefined ? body.assetId : existing && existing.asset_id;
  const type = body.type !== undefined ? body.type : existing && existing.type;
  const date = body.date !== undefined ? body.date : existing && existing.date;

  if (!accountId || !db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(accountId)) {
    return { error: 'La cuenta indicada no existe.' };
  }
  const asset = assetId ? db.prepare('SELECT * FROM finanzas_assets WHERE id = ?').get(assetId) : null;
  if (!asset) {
    return { error: 'El activo indicado no existe.' };
  }
  if (type !== 'buy' && type !== 'sell' && type !== 'dividend') {
    return { error: 'El tipo tiene que ser "buy", "sell" o "dividend".' };
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'La fecha tiene que tener el formato YYYY-MM-DD.' };
  }

  let quantity = body.quantity !== undefined ? body.quantity : existing && existing.quantity;
  let pricePerUnit = body.pricePerUnit !== undefined ? body.pricePerUnit : existing && existing.price_per_unit;
  let amount = body.amount !== undefined ? body.amount : existing && existing.amount;

  if (type === 'dividend') {
    quantity = null;
    pricePerUnit = null;
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: 'El importe del dividendo tiene que ser un numero mayor que 0.' };
    }
  } else {
    quantity = Number(quantity);
    pricePerUnit = Number(pricePerUnit);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: 'La cantidad tiene que ser un numero mayor que 0.' };
    }
    if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
      return { error: 'El precio por unidad tiene que ser un numero mayor que 0.' };
    }
    amount = quantity * pricePerUnit;
  }

  // Solo tiene sentido en una Compra -- una venta o un dividendo traen
  // dinero DENTRO, no lo gastan (ver el checkbox equivalente en
  // finanzasTransactions.js, mismo criterio: el "type" que no aplica
  // siempre se fuerza a false).
  const countsTowardBudget =
    type === 'buy' && (body.countsTowardBudget !== undefined ? !!body.countsTowardBudget : !!(existing && existing.counts_toward_budget));

  return { accountId, assetId: asset.id, assetName: asset.name, type, quantity, pricePerUnit, amount, date, notes: body.notes, countsTowardBudget };
}

router.get('/', (req, res) => {
  const { accountId, assetId, type } = req.query;
  let sql = 'SELECT * FROM finanzas_investment_transactions WHERE 1=1';
  const params = [];
  if (accountId) { sql += ' AND account_id = ?'; params.push(accountId); }
  if (assetId) { sql += ' AND asset_id = ?'; params.push(assetId); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY date DESC, id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const result = validateBody(body, null);
  if (result.error) {
    return res.status(400).json({ error: 'invalid_request', message: result.error });
  }
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  const info = db
    .prepare(
      'INSERT INTO finanzas_investment_transactions (account_id, asset_id, asset_name, type, quantity, price_per_unit, amount, date, notes, counts_toward_budget) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      result.accountId,
      result.assetId,
      result.assetName,
      result.type,
      result.quantity,
      result.pricePerUnit,
      result.amount,
      result.date,
      notes,
      result.countsTowardBudget ? 1 : 0
    );

  const row = db.prepare('SELECT * FROM finanzas_investment_transactions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM finanzas_investment_transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  const result = validateBody(body, existing);
  if (result.error) {
    return res.status(400).json({ error: 'invalid_request', message: result.error });
  }
  const notes =
    body.notes !== undefined
      ? (typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null)
      : existing.notes;

  db.prepare(
    'UPDATE finanzas_investment_transactions SET account_id = ?, asset_id = ?, asset_name = ?, type = ?, quantity = ?, price_per_unit = ?, amount = ?, date = ?, notes = ?, counts_toward_budget = ? WHERE id = ?'
  ).run(
    result.accountId,
    result.assetId,
    result.assetName,
    result.type,
    result.quantity,
    result.pricePerUnit,
    result.amount,
    result.date,
    notes,
    result.countsTowardBudget ? 1 : 0,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM finanzas_investment_transactions WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM finanzas_investment_transactions WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

// Resumen por activo: ganancia/perdida REALIZADA (ventas + dividendos -
// compras) y cuanto queda "invertido a coste" (compras - ventas, a precio
// de compra -- nunca un valor de mercado actual, porque no hay conexion a
// ninguna cotizacion en vivo). Agrupado por asset_id (antes era por
// asset_name de texto libre) para que un renombrado de activo no rompa
// el agrupado.
router.get('/summary/by-asset', (req, res) => {
  const rows = db.prepare('SELECT * FROM finanzas_investment_transactions').all();
  const byAsset = new Map();

  for (const row of rows) {
    if (!byAsset.has(row.asset_id)) {
      byAsset.set(row.asset_id, {
        assetId: row.asset_id,
        assetName: row.asset_name,
        totalBought: 0,
        totalSold: 0,
        totalDividends: 0,
        quantityBought: 0,
        quantitySold: 0,
      });
    }
    const agg = byAsset.get(row.asset_id);
    if (row.type === 'buy') {
      agg.totalBought += row.amount;
      agg.quantityBought += row.quantity || 0;
    } else if (row.type === 'sell') {
      agg.totalSold += row.amount;
      agg.quantitySold += row.quantity || 0;
    } else if (row.type === 'dividend') {
      agg.totalDividends += row.amount;
    }
  }

  const summary = Array.from(byAsset.values()).map((agg) => ({
    ...agg,
    realizedGain: agg.totalSold + agg.totalDividends - agg.totalBought,
    quantityRemaining: agg.quantityBought - agg.quantitySold,
  }));

  res.json(summary);
});

// Evolucion mensual de compras/ventas/dividendos, ultimos N meses
// (mismo criterio que GET /summary/monthly-trend de finanzasTransactions.js).
// assetIds opcional (CSV de ids, ej. "1,2,3"): sin el, agrega TODOS los
// activos; con el, solo esos -- alimentado por el arbol de seleccion de
// carteras/activos en app.js (sustituye al selector unico de antes, que
// filtraba por un unico assetName de texto libre).
router.get('/summary/monthly-trend', (req, res) => {
  const months = Math.min(24, Math.max(1, Number(req.query.months) || 6));
  const assetIds = req.query.assetIds
    ? String(req.query.assetIds).split(',').map(Number).filter(Number.isFinite)
    : null;

  const cursor = new Date();
  cursor.setDate(1);
  const monthKeys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  let sql = 'SELECT * FROM finanzas_investment_transactions WHERE date >= ?';
  const params = [`${monthKeys[0]}-01`];
  if (assetIds && assetIds.length) {
    sql += ` AND asset_id IN (${assetIds.map(() => '?').join(',')})`;
    params.push(...assetIds);
  }
  const rows = db.prepare(sql).all(...params);

  const byMonth = new Map(monthKeys.map((m) => [m, { month: m, totalBought: 0, totalSold: 0, totalDividends: 0 }]));
  for (const row of rows) {
    const monthKey = row.date.slice(0, 7);
    const agg = byMonth.get(monthKey);
    if (!agg) continue; // fuera del rango pedido (no deberia pasar, pero por si acaso)
    if (row.type === 'buy') agg.totalBought += row.amount;
    else if (row.type === 'sell') agg.totalSold += row.amount;
    else if (row.type === 'dividend') agg.totalDividends += row.amount;
  }

  res.json(monthKeys.map((m) => byMonth.get(m)));
});

module.exports = router;
