// routes/finanzasSettings.js — ajustes de la extension Finanzas: por ahora
// solo el limite de gasto mensual, fila unica igual que user_profile.
const express = require('express');
const db = require('../db');

const router = express.Router();

function serialize(row) {
  return { monthlyBudgetLimit: row.monthly_budget_limit };
}

router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM finanzas_settings WHERE id = 1').get();
  res.json(serialize(row));
});

router.put('/', (req, res) => {
  const { monthlyBudgetLimit } = req.body || {};
  const safeLimit =
    monthlyBudgetLimit === undefined || monthlyBudgetLimit === null || monthlyBudgetLimit === ''
      ? null
      : Number(monthlyBudgetLimit);
  db.prepare('UPDATE finanzas_settings SET monthly_budget_limit = ? WHERE id = 1').run(safeLimit);
  const row = db.prepare('SELECT * FROM finanzas_settings WHERE id = 1').get();
  res.json(serialize(row));
});

module.exports = router;
