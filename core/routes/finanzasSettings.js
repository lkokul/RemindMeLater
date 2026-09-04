// routes/finanzasSettings.js — ajustes de la extension Finanzas: limite
// de gasto mensual y objetivo minimo de ahorro mensual, fila unica
// igual que user_profile.
const { createRouter } = require('../router');
const db = require('../db');

const router = createRouter();

const TREND_MONTHS = 6; // mismo criterio de "media reciente" que summary/monthly-trend

function serialize(row) {
  return { monthlyBudgetLimit: row.monthly_budget_limit, savingsGoalMin: row.savings_goal_min };
}

// Media mensual de salario (ingresos marcados is_salary=1) y de gastos
// fijos (gastos marcados is_fixed=1) de los ultimos TREND_MONTHS meses.
// Se usa solo para avisar si un objetivo de ahorro parece poco realista
// -- un ingreso puntual grande NO cuenta aqui, solo lo marcado
// explicitamente como salario/fijo (ver CLAUDE.md de esta ronda).
function computeAverageSalaryAndFixedExpenses() {
  const cursor = new Date();
  cursor.setDate(1);
  const startDate = new Date(cursor.getFullYear(), cursor.getMonth() - (TREND_MONTHS - 1), 1);
  const startMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;

  const { total: salaryTotal } = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM finanzas_transactions WHERE type = 'income' AND is_salary = 1 AND date >= ?")
    .get(startMonth);
  const { total: fixedTotal } = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM finanzas_transactions WHERE type = 'expense' AND is_fixed = 1 AND date >= ?")
    .get(startMonth);

  return { avgSalary: salaryTotal / TREND_MONTHS, avgFixedExpense: fixedTotal / TREND_MONTHS, hasSalaryData: salaryTotal > 0 };
}

router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM finanzas_settings WHERE id = 1').get();
  res.json(serialize(row));
});

router.put('/', (req, res) => {
  const existing = db.prepare('SELECT * FROM finanzas_settings WHERE id = 1').get();
  const { monthlyBudgetLimit, savingsGoalMin } = req.body || {};
  // Cada campo se guarda solo si vino explicitamente en el body -- un PUT
  // que solo manda uno de los dos (p.ej. el boton "Guardar" del limite
  // mensual, que no manda savingsGoalMin) no debe borrar el otro.
  const safeLimit =
    monthlyBudgetLimit === undefined
      ? existing.monthly_budget_limit
      : (monthlyBudgetLimit === null || monthlyBudgetLimit === '' ? null : Number(monthlyBudgetLimit));
  const safeGoalMin =
    savingsGoalMin === undefined
      ? existing.savings_goal_min
      : (savingsGoalMin === null || savingsGoalMin === '' ? null : Number(savingsGoalMin));

  db.prepare('UPDATE finanzas_settings SET monthly_budget_limit = ?, savings_goal_min = ? WHERE id = 1').run(safeLimit, safeGoalMin);
  const row = db.prepare('SELECT * FROM finanzas_settings WHERE id = 1').get();

  let warning = null;
  if (savingsGoalMin !== undefined && safeGoalMin !== null) {
    const { avgSalary, avgFixedExpense, hasSalaryData } = computeAverageSalaryAndFixedExpenses();
    if (hasSalaryData) {
      const ceiling = avgSalary - avgFixedExpense;
      if (safeGoalMin > ceiling) {
        warning = `Con tu salario medio (${avgSalary.toFixed(2)} €/mes) y tus gastos fijos medios (${avgFixedExpense.toFixed(2)} €/mes) de los últimos ${TREND_MONTHS} meses, ahorrar ${safeGoalMin.toFixed(2)} €/mes no parece alcanzable -- como mucho ${ceiling.toFixed(2)} €. Se ha guardado igualmente, por si tu situación cambia.`;
      }
    }
  }

  res.json({ ...serialize(row), warning });
});

module.exports = router;
