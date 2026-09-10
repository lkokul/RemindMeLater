// finanzasTransactions — portado de server/routes/finanzasTransactions.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/finanzasTransactions.js — gastos e ingresos de la extension
  // Finanzas. Cada fila pertenece a una cuenta; los gastos pueden llevar
  // categoria opcional y un flag de si cuentan contra el limite mensual.

  const router = createLocalRouter();

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
      isSalary: !!row.is_salary,
      isFixed: !!row.is_fixed,
      recurringExpenseId: row.recurring_expense_id || null,
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

    // isSalary/isFixed: solo tienen sentido para su propio "type" (ver
    // objetivo de ahorro en finanzasSettings.js) -- el otro se fuerza a 0
    // para que nunca queden datos contradictorios (un gasto marcado como
    // salario, por ejemplo).
    const isSalary = type === 'income' && (body.isSalary !== undefined ? !!body.isSalary : !!(existing && existing.is_salary));
    const isFixed = type === 'expense' && (body.isFixed !== undefined ? !!body.isFixed : !!(existing && existing.is_fixed));

    return {
      accountId,
      type,
      amount: safeAmount,
      date,
      description: body.description,
      categoryId,
      countsTowardBudget,
      isSalary: isSalary ? 1 : 0,
      isFixed: isFixed ? 1 : 0,
    };
  }

  router.get('/', (req, res) => {
    const { accountId, categoryId, type, from, to, recurringExpenseId } = req.query;
    let sql = 'SELECT * FROM finanzas_transactions WHERE 1=1';
    const params = [];
    if (accountId) { sql += ' AND account_id = ?'; params.push(accountId); }
    if (categoryId) { sql += ' AND category_id = ?'; params.push(categoryId); }
    if (type) { sql += ' AND type = ?'; params.push(type); }
    if (from) { sql += ' AND date >= ?'; params.push(from); }
    if (to) { sql += ' AND date <= ?'; params.push(to); }
    // Movimientos generados por una plantilla concreta de gasto fijo --
    // ver "Ver movimientos generados" en la pestaña Gastos fijos.
    if (recurringExpenseId) { sql += ' AND recurring_expense_id = ?'; params.push(recurringExpenseId); }
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
        'INSERT INTO finanzas_transactions (account_id, type, amount, date, description, category_id, counts_toward_budget, is_salary, is_fixed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(result.accountId, result.type, result.amount, result.date, description, result.categoryId, result.countsTowardBudget, result.isSalary, result.isFixed);

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
      'UPDATE finanzas_transactions SET account_id = ?, type = ?, amount = ?, date = ?, description = ?, category_id = ?, counts_toward_budget = ?, is_salary = ?, is_fixed = ? WHERE id = ?'
    ).run(
      result.accountId,
      result.type,
      result.amount,
      result.date,
      description,
      result.categoryId,
      result.countsTowardBudget,
      result.isSalary,
      result.isFixed,
      req.params.id
    );

    const row = db.prepare('SELECT * FROM finanzas_transactions WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  router.delete('/:id', (req, res) => {
    // Si este movimiento vino de un ticket de Viajes (ver
    // routes/viajesEntries.js), borrarlo aqui directamente no debe dejar el
    // adjunto apuntando a un id que ya no existe -- se desenlaza, la foto y
    // el importe se quedan intactos, solo deja de estar "convertido" en un
    // movimiento real.
    db.prepare('UPDATE viajes_entry_attachments SET finanzas_transaction_id = NULL WHERE finanzas_transaction_id = ?').run(req.params.id);
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

    const { total: expenseTotal } = db
      .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM finanzas_transactions WHERE type = 'expense' AND counts_toward_budget = 1 AND date LIKE ?")
      .get(`${prefix}%`);
    // Compras de inversion marcadas "cuenta para el limite mensual" (ver
    // finanzas_investment_transactions.counts_toward_budget) tambien suman
    // aqui -- a proposito SOLO al total que se compara contra el limite,
    // no a totalExpenseAll/savings mas abajo (Koku no pidio cambiar el
    // calculo del ahorro real, solo el del limite mensual).
    const { total: investmentBudgetTotal } = db
      .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM finanzas_investment_transactions WHERE type = 'buy' AND counts_toward_budget = 1 AND date LIKE ?")
      .get(`${prefix}%`);
    const totalExpense = expenseTotal + investmentBudgetTotal;
    const { total: totalIncome } = db
      .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM finanzas_transactions WHERE type = 'income' AND date LIKE ?")
      .get(`${prefix}%`);
    // A diferencia de totalExpense (solo lo que cuenta para el limite),
    // esto es TODO lo gastado el mes -- el ahorro real (savings, mas abajo)
    // tiene que salir de dinero de verdad, no del subconjunto del limite.
    const { total: totalExpenseAll } = db
      .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM finanzas_transactions WHERE type = 'expense' AND date LIKE ?")
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
      totalExpenseAll,
      totalIncome,
      savings: totalIncome - totalExpenseAll,
      monthlyBudgetLimit: settings.monthly_budget_limit,
      savingsGoalMin: settings.savings_goal_min,
      byCategory,
      uncategorizedExpense: uncategorized,
    });
  });

  // Ahorro historico: ahorro real (mismo calculo que "savings" de arriba)
  // mes a mes en un rango arbitrario (?from=YYYY-MM&to=YYYY-MM), para la
  // vista "Historico" del bloque Ahorro -- a diferencia de
  // /summary/monthly-trend (siempre los ultimos N meses desde hoy), aqui
  // el rango lo elige quien lo pide, puede ser de hace años. Tope de 60
  // meses para no dejar pedir un rango descontrolado.
  router.get('/summary/range', (req, res) => {
    const { from, to } = req.query;
    if (!from || !/^\d{4}-\d{2}$/.test(from) || !to || !/^\d{4}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Faltan los meses "from"/"to" (formato YYYY-MM).' });
    }
    const [fromYear, fromMonth] = from.split('-').map(Number);
    const [toYear, toMonth] = to.split('-').map(Number);
    const fromIndex = fromYear * 12 + (fromMonth - 1);
    const toIndex = toYear * 12 + (toMonth - 1);
    if (toIndex < fromIndex) {
      return res.status(400).json({ error: 'invalid_request', message: 'El mes "hasta" no puede ser anterior al mes "desde".' });
    }
    const totalMonths = toIndex - fromIndex + 1;
    if (totalMonths > 60) {
      return res.status(400).json({ error: 'invalid_request', message: 'El rango no puede superar los 60 meses.' });
    }

    const monthKeys = [];
    for (let i = 0; i < totalMonths; i++) {
      const idx = fromIndex + i;
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      monthKeys.push(`${y}-${String(m).padStart(2, '0')}`);
    }

    // Comparacion de texto sobre YYYY-MM-DD: "-32" nunca es un dia real,
    // pero como string cualquier dia 01-31 del ultimo mes es menor que
    // eso, asi que basta para incluir el mes entero sin calcular su
    // ultimo dia real (mismo truco que ya usa el resto de este archivo
    // con LIKE sobre el prefijo del mes).
    const rows = db
      .prepare(
        `SELECT substr(date, 1, 7) as month, type, SUM(amount) as total
         FROM finanzas_transactions
         WHERE date >= ? AND date < ?
         GROUP BY substr(date, 1, 7), type`
      )
      .all(`${monthKeys[0]}-01`, `${monthKeys[monthKeys.length - 1]}-32`);

    const byMonth = new Map(monthKeys.map((m) => [m, { totalIncome: 0, totalExpenseAll: 0 }]));
    for (const row of rows) {
      const agg = byMonth.get(row.month);
      if (!agg) continue;
      if (row.type === 'income') agg.totalIncome = row.total;
      else if (row.type === 'expense') agg.totalExpenseAll = row.total;
    }

    const settings = db.prepare('SELECT * FROM finanzas_settings WHERE id = 1').get();

    res.json(
      monthKeys.map((month) => {
        const agg = byMonth.get(month);
        return {
          month,
          totalIncome: agg.totalIncome,
          totalExpenseAll: agg.totalExpenseAll,
          savings: agg.totalIncome - agg.totalExpenseAll,
          savingsGoalMin: settings.savings_goal_min,
        };
      })
    );
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

  mountLocalRouter('/api/finanzas-transactions', router);

})();
