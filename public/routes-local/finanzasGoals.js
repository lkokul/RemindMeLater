// finanzasGoals — objetivos de ahorro con nombre ("Coche, 5.000 €").
//
// Escrito directamente aqui (no portado del servidor, como el resto de
// routes-local/): esta funcion no existe en la version de escritorio
// todavia. Sigue las mismas convenciones que sus vecinos -- IIFE para no
// chocar nombres, createLocalRouter/mountLocalRouter, y borrado en
// cascada A MANO (nada de ON DELETE CASCADE).
//
// LA IDEA: son SOBRES VIRTUALES. El dinero no se mueve de sitio; el
// objetivo solo RESERVA una parte del saldo de una cuenta. Por eso no hay
// ninguna transaccion detras de "apartar 200 € para el coche": tu dinero
// sigue donde estaba, simplemente esta hablado.
(function () {
  const db = localDb;

  const router = createLocalRouter();

  // Lo apartado es la SUMA de las aportaciones, nunca un numero guardado
  // (misma regla que el saldo de una cuenta): asi no hay forma de que se
  // desincronice de su propio historial.
  function reservedFor(goalId) {
    const row = db
      .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM finanzas_goal_contributions WHERE goal_id = ?')
      .get(goalId);
    return Math.round(row.total * 100) / 100;
  }

  // Cuantos meses enteros quedan hasta la fecha objetivo (0 si ya pasó o
  // si no hay fecha). Se cuenta por meses y no por dias porque el consejo
  // que sale de aqui se da en euros AL MES.
  function monthsUntil(targetDate) {
    if (!targetDate) return null;
    const hoy = new Date();
    const [y, m] = targetDate.split('-').map(Number);
    const meses = (y - hoy.getFullYear()) * 12 + (m - 1 - hoy.getMonth());
    return Math.max(0, meses);
  }

  // El ahorro real medio de los ultimos 6 meses: ingresos menos TODOS los
  // gastos, sin contar el dinero de terceros (que no es suyo). Es la
  // misma idea que ya usa el aviso de "objetivo poco realista" del ahorro
  // mensual, y lo que permite decir "a tu ritmo llegas en marzo de 2028".
  function ahorroMedioMensual() {
    const desde = new Date();
    desde.setMonth(desde.getMonth() - 6);
    const desdeKey = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, '0')}-01`;
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS ingresos,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS gastos
         FROM finanzas_transactions
         WHERE date >= ?
           AND account_id NOT IN (SELECT id FROM finanzas_accounts WHERE LOWER(type) = 'de terceros')`
      )
      .get(desdeKey);
    return Math.round(((row.ingresos - row.gastos) / 6) * 100) / 100;
  }

  function serialize(row) {
    const reserved = reservedFor(row.id);
    const target = row.target_amount;
    const falta = Math.max(0, Math.round((target - reserved) * 100) / 100);
    const meses = monthsUntil(row.target_date);

    // "Te faltan 3.200 € en 10 meses -> 320 €/mes". Con la fecha ya
    // pasada (o sin fecha) no se inventa ningun ritmo.
    const perMonth = meses && meses > 0 && falta > 0 ? Math.round((falta / meses) * 100) / 100 : null;

    return {
      id: row.id,
      name: row.name,
      icon: row.icon || null,
      color: row.color || null,
      targetAmount: target,
      targetDate: row.target_date || null,
      accountId: row.account_id || null,
      completedAt: row.completed_at || null,
      reserved,
      remaining: falta,
      // Se corta al 100%: una barra de progreso al 130% no dice nada util,
      // y el importe de mas ya se ve en las cifras.
      progress: target > 0 ? Math.min(1, reserved / target) : 0,
      monthsLeft: meses,
      perMonthNeeded: perMonth,
    };
  }

  function validate(body, existing) {
    const name = body.name !== undefined ? String(body.name || '').trim() : existing && existing.name;
    if (!name) return { error: 'El objetivo necesita un nombre.' };

    const rawTarget = body.targetAmount !== undefined ? Number(body.targetAmount) : existing && existing.target_amount;
    if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
      return { error: 'La cantidad a la que quieres llegar tiene que ser mayor que 0.' };
    }
    const targetAmount = Math.round(rawTarget * 100) / 100;
    if (targetAmount <= 0) return { error: 'La cantidad es demasiado pequeña: el minimo es 0,01 €.' };

    let targetDate = body.targetDate !== undefined ? body.targetDate : existing && existing.target_date;
    if (targetDate === '' || targetDate === null || targetDate === undefined) {
      targetDate = null;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return { error: 'La fecha objetivo tiene que tener el formato YYYY-MM-DD.' };
    }

    let accountId = body.accountId !== undefined ? body.accountId : existing && existing.account_id;
    if (accountId === '' || accountId === null || accountId === undefined) {
      accountId = null;
    } else if (!db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(accountId)) {
      // Una cuenta que no existe se ignora en vez de rechazar el objetivo
      // entero: el objetivo en si sigue teniendo sentido sin cuenta.
      accountId = null;
    }

    return {
      name,
      icon: body.icon !== undefined ? body.icon || null : existing ? existing.icon : null,
      color: body.color !== undefined ? body.color || null : existing ? existing.color : null,
      targetAmount,
      targetDate,
      accountId,
    };
  }

  router.get('/', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM finanzas_goals ORDER BY completed_at IS NOT NULL, id ASC')
      .all();
    res.json(rows.map(serialize));
  });

  // Cuanto hay RESERVADO por cuenta, para que la pantalla de cuentas pueda
  // enseñar "saldo / reservado / disponible". Solo cuentan los objetivos
  // sin terminar: cuando uno se cumple y se gasta, ese dinero ya salio de
  // la cuenta de verdad y seguir reservandolo lo contaria dos veces.
  router.get('/reserved-by-account', (req, res) => {
    const rows = db
      .prepare(
        `SELECT g.account_id AS accountId, COALESCE(SUM(c.amount), 0) AS reserved
         FROM finanzas_goals g
         JOIN finanzas_goal_contributions c ON c.goal_id = g.id
         WHERE g.account_id IS NOT NULL AND g.completed_at IS NULL
         GROUP BY g.account_id`
      )
      .all();
    const porCuenta = {};
    for (const r of rows) porCuenta[r.accountId] = Math.round(r.reserved * 100) / 100;
    res.json(porCuenta);
  });

  // El ritmo real: con lo que ahorras de media, ¿llegas a tiempo?
  router.get('/pace', (req, res) => {
    res.json({ averageMonthlySavings: ahorroMedioMensual() });
  });

  router.post('/', (req, res) => {
    const result = validate(req.body || {}, null);
    if (result.error) return res.status(400).json({ error: 'invalid_request', message: result.error });

    const info = db
      .prepare('INSERT INTO finanzas_goals (name, icon, color, target_amount, target_date, account_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(result.name, result.icon, result.color, result.targetAmount, result.targetDate, result.accountId);
    res.status(201).json(serialize(db.prepare('SELECT * FROM finanzas_goals WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM finanzas_goals WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const body = req.body || {};
    const result = validate(body, existing);
    if (result.error) return res.status(400).json({ error: 'invalid_request', message: result.error });

    // Marcar como cumplido (o volver a abrirlo) es explicito.
    let completedAt = existing.completed_at;
    if (body.completed !== undefined) {
      completedAt = body.completed ? existing.completed_at || new Date().toISOString().slice(0, 10) : null;
    }

    db.prepare(
      'UPDATE finanzas_goals SET name = ?, icon = ?, color = ?, target_amount = ?, target_date = ?, account_id = ?, completed_at = ? WHERE id = ?'
    ).run(result.name, result.icon, result.color, result.targetAmount, result.targetDate, result.accountId, completedAt, req.params.id);

    res.json(serialize(db.prepare('SELECT * FROM finanzas_goals WHERE id = ?').get(req.params.id)));
  });

  router.delete('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM finanzas_goals WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // Cascada a mano (regla de la casa). Las aportaciones NO son
    // movimientos de dinero -- son apuntes de "esto esta hablado" -- asi
    // que borrarlas no toca ninguna cuenta ni ningun gasto real. Lo que se
    // gasto DEL objetivo si dejo su transaccion, y esa se queda.
    db.prepare('DELETE FROM finanzas_goal_contributions WHERE goal_id = ?').run(req.params.id);
    db.prepare('DELETE FROM finanzas_goals WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  router.get('/:id/contributions', (req, res) => {
    const existing = db.prepare('SELECT 1 FROM finanzas_goals WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const rows = db
      .prepare('SELECT * FROM finanzas_goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC')
      .all(req.params.id);
    res.json(
      rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        date: r.date,
        notes: r.notes || null,
        transactionId: r.transaction_id || null,
      }))
    );
  });

  // Apartar dinero (o sacarlo, con importe negativo).
  router.post('/:id/contributions', (req, res) => {
    const goal = db.prepare('SELECT * FROM finanzas_goals WHERE id = ?').get(req.params.id);
    if (!goal) return res.status(404).json({ error: 'not_found' });

    const body = req.body || {};
    const raw = Number(body.amount);
    if (!Number.isFinite(raw) || raw === 0) {
      return res.status(400).json({ error: 'invalid_request', message: 'El importe tiene que ser un numero distinto de 0.' });
    }
    const amount = Math.round(raw * 100) / 100;
    if (amount === 0) {
      return res.status(400).json({ error: 'invalid_request', message: 'El importe es demasiado pequeño: el minimo es 0,01 €.' });
    }

    // No se deja sacar mas de lo que hay apartado: el sobre no puede
    // quedar en negativo (seria decir que debes dinero a un objetivo).
    if (amount < 0 && reservedFor(goal.id) + amount < 0) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'No puedes sacar mas de lo que tienes apartado en este objetivo.',
      });
    }

    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : new Date().toISOString().slice(0, 10);
    const info = db
      .prepare('INSERT INTO finanzas_goal_contributions (goal_id, amount, date, notes) VALUES (?, ?, ?, ?)')
      .run(goal.id, amount, date, typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null);

    res.status(201).json({ id: info.lastInsertRowid, goal: serialize(db.prepare('SELECT * FROM finanzas_goals WHERE id = ?').get(goal.id)) });
  });

  router.delete('/:id/contributions/:contributionId', (req, res) => {
    const row = db
      .prepare('SELECT * FROM finanzas_goal_contributions WHERE id = ? AND goal_id = ?')
      .get(req.params.contributionId, req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    // Una aportacion que salio de gastar el objetivo lleva pegada una
    // transaccion REAL. Borrarla aqui dejaria el gasto por un lado y el
    // sobre por otro, asi que se rechaza: eso se deshace borrando el
    // movimiento en Movimientos, donde se ve lo que se esta tocando.
    if (row.transaction_id) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Esta linea salio de un gasto real. Bórralo desde Movimientos si te has equivocado.',
      });
    }
    db.prepare('DELETE FROM finanzas_goal_contributions WHERE id = ?').run(row.id);
    res.status(204).end();
  });

  // Gastar el objetivo: crea el GASTO REAL y vacia el sobre de una vez.
  //
  // Las dos cosas juntas a proposito -- si se hicieran por separado
  // quedaria el gasto hecho y el dinero seguiria apareciendo como
  // apartado, que es justo el descuadre que hace que uno deje de fiarse
  // de la app.
  router.post('/:id/spend', (req, res) => {
    const goal = db.prepare('SELECT * FROM finanzas_goals WHERE id = ?').get(req.params.id);
    if (!goal) return res.status(404).json({ error: 'not_found' });

    const body = req.body || {};
    const reserved = reservedFor(goal.id);
    const raw = body.amount !== undefined ? Number(body.amount) : reserved;
    if (!Number.isFinite(raw) || raw <= 0) {
      return res.status(400).json({ error: 'invalid_request', message: 'El importe tiene que ser mayor que 0.' });
    }
    const amount = Math.round(raw * 100) / 100;
    if (amount > reserved) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'No puedes gastar mas de lo que tienes apartado en este objetivo.',
      });
    }

    const accountId = body.accountId || goal.account_id;
    if (!accountId || !db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(accountId)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Hace falta decir de que cuenta sale el dinero.' });
    }

    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : new Date().toISOString().slice(0, 10);
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : goal.name;
    const categoryId = body.categoryId && db.prepare('SELECT 1 FROM finanzas_categories WHERE id = ?').get(body.categoryId) ? body.categoryId : null;

    const tx = db
      .prepare(
        "INSERT INTO finanzas_transactions (account_id, type, amount, date, description, category_id, counts_toward_budget, is_salary, is_fixed) VALUES (?, 'expense', ?, ?, ?, ?, ?, 0, 0)"
      )
      .run(accountId, amount, date, description, categoryId, body.countsTowardBudget === false ? 0 : 1);

    db.prepare('INSERT INTO finanzas_goal_contributions (goal_id, amount, date, notes, transaction_id) VALUES (?, ?, ?, ?, ?)').run(
      goal.id,
      -amount,
      date,
      `Gastado: ${description}`,
      tx.lastInsertRowid
    );

    // Si el sobre queda a cero, el objetivo se da por cumplido solo.
    if (reservedFor(goal.id) <= 0) {
      db.prepare('UPDATE finanzas_goals SET completed_at = ? WHERE id = ?').run(date, goal.id);
    }

    res.status(201).json({
      transactionId: tx.lastInsertRowid,
      goal: serialize(db.prepare('SELECT * FROM finanzas_goals WHERE id = ?').get(goal.id)),
    });
  });

  mountLocalRouter('/api/finanzas-goals', router);
})();
