// routes/finanzasTransactions.js — gastos e ingresos de la extension
// Finanzas. Cada fila pertenece a una cuenta; los gastos pueden llevar
// categoria opcional y un flag de si cuentan contra el limite mensual.
const express = require('express');
const db = require('../db');

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.type,
    amount: row.amount,
    date: row.date,
    description: row.description || null,
    categoryId: row.category_id || null,
    countsTowardBudget: !!row.counts_toward_budget,
  };
}

function validateBody(body, existing) {
  const accountId = body.accountId !== undefined ? body.accountId : existing && existing.account_id;
  const type = body.type !== undefined ? body.type : existing && existing.type;
  const amount = body.amount !== undefined ? body.amount : existing && existing.amount;
  const date = body.date !== undefined ? body.date : existing && existing.date;

  if (!accountId || !db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(accountId)) {
    return { error: 'La cuenta indicada no existe.' };
  }
  if (type !== 'expense' && type !== 'income') {
    return { error: 'El tipo tiene que ser "expense" o "income".' };
  }
  const safeAmount = Number(amount);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    return { error: 'El importe tiene que ser un numero mayor que 0.' };
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'La fecha tiene que tener el formato YYYY-MM-DD.' };
  }
  let categoryId = body.categoryId !== undefined ? body.categoryId : existing && existing.category_id;
  if (categoryId !== null && categoryId !== undefined) {
    if (!db.prepare('SELECT 1 FROM finanzas_categories WHERE id = ?').get(categoryId)) {
      categoryId = null;
    }
  } else {
    categoryId = null;
  }
  const countsTowardBudget =
    body.countsTowardBudget !== undefined
      ? (body.countsTowardBudget ? 1 : 0)
      : existing
      ? existing.counts_toward_budget
      : 1;

  return { accountId, type, amount: safeAmount, date, description: body.description, categoryId, countsTowardBudget };
}

router.get('/', (req, res) => {
  const { accountId, categoryId, type, from, to } = req.query;
  let sql = 'SELECT * FROM finanzas_transactions WHERE 1=1';
  const params = [];
  if (accountId) { sql += ' AND account_id = ?'; params.push(accountId); }
  if (categoryId) { sql += ' AND category_id = ?'; params.push(categoryId); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (from) { sql += ' AND date >= ?'; params.push(from); }
  if (to) { sql += ' AND date <= ?'; params.push(to); }
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
  const description =
    typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;

  const info = db
    .prepare(
      'INSERT INTO finanzas_transactions (account_id, type, amount, date, description, category_id, counts_toward_budget) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(result.accountId, result.type, result.amount, result.date, description, result.categoryId, result.countsTowardBudget);

  const row = db.prepare('SELECT * FROM finanzas_transactions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM finanzas_transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  const result = validateBody(body, existing);
  if (result.error) {
    return res.status(400).json({ error: 'invalid_request', message: result.error });
  }
  const description =
    body.description !== undefined
      ? (typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null)
      : existing.description;

  db.prepare(
    'UPDATE finanzas_transactions SET account_id = ?, type = ?, amount = ?, date = ?, description = ?, category_id = ?, counts_toward_budget = ? WHERE id = ?'
  ).run(
    result.accountId,
    result.type,
    result.amount,
    result.date,
    description,
    result.categoryId,
    result.countsTowardBudget,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM finanzas_transactions WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM finanzas_transactions WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

// Resumen del mes indicado (?month=YYYY-MM, por defecto el mes actual):
// total gastado que cuenta contra el limite, el limite configurado, y un
// desglose de ese gasto por categoria -- todo en un solo viaje para pintar
// la pestaña Resumen sin tener que calcularlo en el cliente.
router.get('/summary/month', (req, res) => {
  const month = req.query.month && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const prefix = `${month}-`;

  const { total: totalExpense } = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM finanzas_transactions WHERE type = 'expense' AND counts_toward_budget = 1 AND date LIKE ?")
    .get(`${prefix}%`);
  const { total: totalIncome } = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM finanzas_transactions WHERE type = 'income' AND date LIKE ?")
    .get(`${prefix}%`);

  const byCategory = db
    .prepare(
      `SELECT c.id as categoryId, c.name as categoryName, c.icon as categoryIcon, c.color as categoryColor,
              COALESCE(SUM(t.amount), 0) as total
       FROM finanzas_transactions t
       JOIN finanzas_categories c ON c.id = t.category_id
       WHERE t.type = 'expense' AND t.counts_toward_budget = 1 AND t.date LIKE ?
       GROUP BY c.id
       ORDER BY total DESC`
    )
    .all(`${prefix}%`);

  const uncategorized = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM finanzas_transactions WHERE type = 'expense' AND counts_toward_budget = 1 AND category_id IS NULL AND date LIKE ?"
    )
    .get(`${prefix}%`).total;

  const settings = db.prepare('SELECT * FROM finanzas_settings WHERE id = 1').get();

  res.json({
    month,
    totalExpense,
    totalIncome,
    monthlyBudgetLimit: settings.monthly_budget_limit,
    byCategory,
    uncategorizedExpense: uncategorized,
  });
});

// Tendencia de los ultimos N meses (por defecto 6, incluido el actual):
// ingresos vs gastos totales de cada mes, para la grafica de "Evolucion
// mensual" en la pestaña Resumen. A diferencia de /summary/month, aqui
// se cuentan TODOS los gastos (no solo los que tienen
// counts_toward_budget=1) -- esto es una vista de flujo de caja real
// mes a mes, no el progreso contra el limite mensual (que ya se ve
// arriba, en su propio bloque). Devuelve tambien los meses SIN ningun
// movimiento (con 0/0), para que la grafica no salte huecos.
router.get('/summary/monthly-trend', (req, res) => {
  const monthsCount = Math.max(1, Math.min(24, Number(req.query.months) || 6));

  const months = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = monthsCount - 1; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const rows = db
    .prepare(
      `SELECT substr(date, 1, 7) as month, type, SUM(amount) as total
       FROM finanzas_transactions
       WHERE date >= ?
       GROUP BY month, type`
    )
    .all(`${months[0]}-01`);

  const totalsByMonth = new Map();
  rows.forEach((row) => {
    if (!totalsByMonth.has(row.month)) totalsByMonth.set(row.month, { income: 0, expense: 0 });
    totalsByMonth.get(row.month)[row.type === 'income' ? 'income' : 'expense'] = row.total;
  });

  const trend = months.map((month) => ({
    month,
    totalIncome: (totalsByMonth.get(month) || {}).income || 0,
    totalExpense: (totalsByMonth.get(month) || {}).expense || 0,
  }));

  res.json(trend);
});

module.exports = router;
