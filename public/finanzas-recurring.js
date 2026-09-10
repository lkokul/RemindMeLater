// finanzasRecurringChecker — portado de server/finanzasRecurringChecker.js.
//
// Genera la transaccion REAL de cada plantilla de gasto fijo cuando
// toca. La logica es la misma del servidor, palabra por palabra; lo
// unico que cambia es CUANDO se ejecuta: alli era un setInterval de 24h
// dentro de un proceso siempre encendido, y aqui se ejecuta una vez AL
// ABRIR LA APP (ver init() en app.js). Para un gasto fijo da igual:
// nadie necesita mas precision que "hoy toca o no toca", y la app se
// abre bastante mas de una vez al mes.
(function () {
  const db = localDb;

  // finanzasRecurringChecker.js — genera la transaccion REAL de cada
  // plantilla de gasto fijo (finanzas_recurring_expenses) cuando toca.

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // Ultimo dia real de un mes (ej. 28/29 en febrero, 30 en abril...) --
  // para clampar day_of_month cuando no existe ese dia en el mes en curso
  // (ej. "dia 31" en un mes de 30 dias).
  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  // Calcula, para la plantilla y el "hoy" dados, la fecha en la que toca
  // generar la transaccion de ESTE periodo (mensual = este mes, anual =
  // este año) y la clave de periodo que evita duplicar ('YYYY-MM' o
  // 'YYYY'). Devuelve null si la plantilla es anual y no tiene
  // month_of_year (dato invalido, no deberia pasar pero por si acaso).
  function computeCurrentPeriod(template, today) {
    const year = today.getFullYear();
    if (template.frequency === 'monthly') {
      const month = today.getMonth() + 1;
      const day = Math.min(template.day_of_month, daysInMonth(year, month));
      return { targetDate: `${year}-${pad2(month)}-${pad2(day)}`, periodKey: `${year}-${pad2(month)}` };
    }
    if (template.frequency === 'annual' && template.month_of_year) {
      const month = template.month_of_year;
      const day = Math.min(template.day_of_month, daysInMonth(year, month));
      return { targetDate: `${year}-${pad2(month)}-${pad2(day)}`, periodKey: `${year}` };
    }
    return null;
  }

  function generateDueRecurringExpenses() {
    const templates = db.prepare('SELECT * FROM finanzas_recurring_expenses WHERE active = 1').all();
    if (templates.length === 0) return;

    const todayDate = new Date();
    const todayKey = `${todayDate.getFullYear()}-${pad2(todayDate.getMonth() + 1)}-${pad2(todayDate.getDate())}`;

    const insertTransaction = db.prepare(
      'INSERT INTO finanzas_transactions (account_id, type, amount, date, description, category_id, counts_toward_budget, is_salary, is_fixed, recurring_expense_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)'
    );
    const markGenerated = db.prepare('UPDATE finanzas_recurring_expenses SET last_generated_period = ? WHERE id = ?');
    const deactivate = db.prepare('UPDATE finanzas_recurring_expenses SET active = 0 WHERE id = ?');

    for (const template of templates) {
      // "Ultimo mes de pago" ya cumplido -- se desactiva sola para no
      // seguir comprobandola cada dia sin motivo (Koku puede reactivarla
      // a mano cambiando/quitando la fecha de fin si hiciera falta).
      if (template.end_date && todayKey > template.end_date) {
        deactivate.run(template.id);
        continue;
      }
      if (todayKey < template.start_date) continue; // todavia no ha empezado

      const period = computeCurrentPeriod(template, todayDate);
      if (!period) continue;
      if (period.targetDate > todayKey) continue; // este periodo todavia no toca
      if (template.last_generated_period === period.periodKey) continue; // ya generado

      insertTransaction.run(
        template.account_id,
        'expense',
        template.amount,
        period.targetDate,
        template.description,
        template.category_id,
        template.counts_toward_budget,
        template.id
      );
      markGenerated.run(period.periodKey, template.id);
    }
  }

  // Se llama desde init() al abrir la app. Se protege sola: un fallo
  // aqui no puede impedir que la app arranque.
  window.generateDueRecurringExpenses = function generateDueRecurringExpensesSafe() {
    try {
      generateDueRecurringExpenses();
    } catch (err) {
      console.error('No se pudieron generar los gastos fijos de este periodo:', err);
    }
  };
})();
