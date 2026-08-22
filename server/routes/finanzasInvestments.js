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
    assetName: row.asset_name,
    type: row.type,
    quantity: row.quantity,
    pricePerUnit: row.price_per_unit,
    amount: row.amount,
    date: row.date,
    notes: row.notes || null,
  };
}

function validateBody(body, existing) {
  const accountId = body.accountId !== undefined ? body.accountId : existing && existing.account_id;
  const assetName =
    body.assetName !== undefined ? String(body.assetName).trim() : existing && existing.asset_name;
  const type = body.type !== undefined ? body.type : existing && existing.type;
  const date = body.date !== undefined ? body.date : existing && existing.date;

  if (!accountId || !db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(accountId)) {
    return { error: 'La cuenta indicada no existe.' };
  }
  if (!assetName) {
    return { error: 'El activo necesita un nombre.' };
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

  return { accountId, assetName, type, quantity, pricePerUnit, amount, date, notes: body.notes };
}

router.get('/', (req, res) => {
  const { accountId, assetName, type } = req.query;
  let sql = 'SELECT * FROM finanzas_investment_transactions WHERE 1=1';
  const params = [];
  if (accountId) { sql += ' AND account_id = ?'; params.push(accountId); }
  if (assetName) { sql += ' AND asset_name = ?'; params.push(assetName); }
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
      'INSERT INTO finanzas_investment_transactions (account_id, asset_name, type, quantity, price_per_unit, amount, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(result.accountId, result.assetName, result.type, result.quantity, result.pricePerUnit, result.amount, result.date, notes);

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
    'UPDATE finanzas_investment_transactions SET account_id = ?, asset_name = ?, type = ?, quantity = ?, price_per_unit = ?, amount = ?, date = ?, notes = ? WHERE id = ?'
  ).run(
    result.accountId,
    result.assetName,
    result.type,
    result.quantity,
    result.pricePerUnit,
    result.amount,
    result.date,
    notes,
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
// ninguna cotizacion en vivo).
router.get('/summary/by-asset', (req, res) => {
  const rows = db.prepare('SELECT * FROM finanzas_investment_transactions').all();
  const byAsset = new Map();

  for (const row of rows) {
    if (!byAsset.has(row.asset_name)) {
      byAsset.set(row.asset_name, {
        assetName: row.asset_name,
        totalBought: 0,
        totalSold: 0,
        totalDividends: 0,
        quantityBought: 0,
        quantitySold: 0,
      });
    }
    const agg = byAsset.get(row.asset_name);
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

module.exports = router;
