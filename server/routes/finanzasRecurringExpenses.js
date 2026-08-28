// routes/finanzasRecurringExpenses.js — plantillas de gasto fijo
// recurrente (extension Finanzas, pestaña "Gastos fijos", separada de
// Movimientos a peticion explicita de Koku). La generacion real de
// transacciones a partir de estas plantillas vive en
// server/finanzasRecurringChecker.js, no aqui -- este fichero es solo
// el CRUD de las plantillas en si.
const express = require('express');
const db = require('../db');

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    categoryId: row.category_id || null,
    amount: row.amount,
    description: row.description || null,
    frequency: row.frequency,
    dayOfMonth: row.day_of_month,
    monthOfYear: row.month_of_year || null,
    startDate: row.start_date,
    endDate: row.end_date || null,
    countsTowardBudget: !!row.counts_toward_budget,
    active: !!row.active,
    lastGeneratedPeriod: row.last_generated_period || null,
  };
}

function validateBody(body, existing) {
  const accountId = body.accountId !== undefined ? body.accountId : existing && existing.account_id;
  const frequency = body.frequency !== undefined ? body.frequency : existing && existing.frequency;
  const amount = body.amount !== undefined ? body.amount : existing && existing.amount;
  const dayOfMonth = body.dayOfMonth !== undefined ? body.dayOfMonth : existing && existing.day_of_month;
  const startDate = body.startDate !== undefined ? body.startDate : existing && existing.start_date;

  if (!accountId || !db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(accountId)) {
    return { error: 'La cuenta indicada no existe.' };
  }
  if (frequency !== 'monthly' && frequency !== 'annual') {
    return { error: 'La frecuencia tiene que ser "monthly" o "annual".' };
  }
  const safeAmount = Number(amount);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    return { error: 'El importe tiene que ser un numero mayor que 0.' };
  }
  const safeDayOfMonth = Number(dayOfMonth);
  if (!Number.isInteger(safeDayOfMonth) || safeDayOfMonth < 1 || safeDayOfMonth > 31) {
    return { error: 'El dia del mes tiene que ser un numero entre 1 y 31.' };
  }
  let monthOfYear = body.monthOfYear !== undefined ? body.monthOfYear : existing && existing.month_of_year;
  if (frequency === 'annual') {
    monthOfYear = Number(monthOfYear);
    if (!Number.isInteger(monthOfYear) || monthOfYear < 1 || monthOfYear > 12) {
      return { error: 'El mes del año tiene que ser un numero entre 1 y 12 en un gasto anual.' };
    }
  } else {
    monthOfYear = null;
  }
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { error: 'La fecha de inicio tiene que tener el formato YYYY-MM-DD.' };
  }
  let endDate = body.endDate !== undefined ? body.endDate : existing && existing.end_date;
  if (endDate !== null && endDate !== undefined && endDate !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return { error: 'La fecha de fin tiene que tener el formato YYYY-MM-DD.' };
    }
    if (endDate < startDate) {
      return { error: 'La fecha de fin no puede ser anterior a la fecha de inicio.' };
    }
  } else {
    endDate = null;
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
    body.countsTowardBudget !== undefined ? (body.countsTowardBudget ? 1 : 0) : existing ? existing.counts_toward_budget : 1;

  return {
    accountId,
    categoryId,
    amount: safeAmount,
    description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : (body.description === undefined && existing ? existing.description : null),
    frequency,
    dayOfMonth: safeDayOfMonth,
    monthOfYear,
    startDate,
    endDate,
    countsTowardBudget,
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM finanzas_recurring_expenses ORDER BY active DESC, id ASC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const result = validateBody(body, null);
  if (result.error) {
    return res.status(400).json({ error: 'invalid_request', message: result.error });
  }

  const info = db
    .prepare(
      'INSERT INTO finanzas_recurring_expenses (account_id, category_id, amount, description, frequency, day_of_month, month_of_year, start_date, end_date, counts_toward_budget) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      result.accountId,
      result.categoryId,
      result.amount,
      result.description,
      result.frequency,
      result.dayOfMonth,
      result.monthOfYear,
      result.startDate,
      result.endDate,
      result.countsTowardBudget
    );

  const row = db.prepare('SELECT * FROM finanzas_recurring_expenses WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM finanzas_recurring_expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  const result = validateBody(body, existing);
  if (result.error) {
    return res.status(400).json({ error: 'invalid_request', message: result.error });
  }
  // Reactivar a mano (ej. tras quitar/alargar la fecha de fin) tiene que
  // poder deshacer el active=0 que puso el generador solo -- si el
  // cliente manda "active" explicito, se respeta.
  const active = body.active !== undefined ? (body.active ? 1 : 0) : existing.active;

  db.prepare(
    'UPDATE finanzas_recurring_expenses SET account_id = ?, category_id = ?, amount = ?, description = ?, frequency = ?, day_of_month = ?, month_of_year = ?, start_date = ?, end_date = ?, counts_toward_budget = ?, active = ? WHERE id = ?'
  ).run(
    result.accountId,
    result.categoryId,
    result.amount,
    result.description,
    result.frequency,
    result.dayOfMonth,
    result.monthOfYear,
    result.startDate,
    result.endDate,
    result.countsTowardBudget,
    active,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM finanzas_recurring_expenses WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM finanzas_recurring_expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // Las transacciones ya generadas se quedan -- son reales e
  // independientes (pedido explicito de Koku), solo pierden el enlace a
  // la plantilla que las creo.
  db.prepare('UPDATE finanzas_transactions SET recurring_expense_id = NULL WHERE recurring_expense_id = ?').run(req.params.id);

  const info = db.prepare('DELETE FROM finanzas_recurring_expenses WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
