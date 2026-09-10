// finanzasRecurringExpenses — portado de server/routes/finanzasRecurringExpenses.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/finanzasRecurringExpenses.js — plantillas de gasto fijo
  // recurrente (extension Finanzas, pestaña "Gastos fijos", separada de
  // Movimientos a peticion explicita de Koku). La generacion real de
  // transacciones a partir de estas plantillas vive en
  // server/finanzasRecurringChecker.js, no aqui -- este fichero es solo
  // el CRUD de las plantillas en si.

  const router = createLocalRouter();

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
    // El dinero se guarda a dos decimales. Sin redondear aqui se colaba un
    // gasto de 0,001 € que la pantalla enseñaba como "0,00 €" (una fila
    // fantasma de un importe que no existe) y que ademas ensuciaba los
    // totales con decimales invisibles.
    const rawAmount = Number(amount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return { error: 'El importe tiene que ser un numero mayor que 0.' };
    }
    const safeAmount = Math.round(rawAmount * 100) / 100;
    if (safeAmount <= 0) {
      return { error: 'El importe es demasiado pequeño: el minimo es 0,01 €.' };
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

  // ---------------------------------------------------------------------
  // PREVISION de gastos fijos
  //
  // Hasta ahora una plantilla solo existia "hacia atras": el generador
  // (finanzas-recurring.js) crea la transaccion real cuando llega la
  // fecha, y nadie sabia mirar hacia DELANTE. Por eso no habia forma de
  // contestar a "cuanto me queda por pagar este mes".
  //
  // Estas rutas calculan esas ocurrencias futuras AL VUELO y NO GUARDAN
  // NADA. Es a proposito, por dos motivos:
  //  1. Es la regla de la casa (los saldos, los titulos de nota y los
  //     arboles de carpetas tambien se calculan, nunca se guardan): lo
  //     calculado no se puede desincronizar de la realidad.
  //  2. Si se guardaran movimientos "previstos", cada vez que editaras
  //     una plantilla habria que salir a buscarlos y limpiarlos, y
  //     cualquier fallo dejaria basura en tus cuentas de verdad.
  // ---------------------------------------------------------------------

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // Ultimo dia real del mes (28/29 en febrero, 30 en abril...). Misma
  // funcion que usa el generador: hace falta para "clampar" el dia 31 en
  // un mes que no lo tiene.
  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  // La clave que identifica un PERIODO de una plantilla: 'YYYY-MM' para
  // las mensuales y 'YYYY' para las anuales. Es exactamente la misma que
  // el generador guarda en last_generated_period, y por eso sirve para
  // emparejar "lo previsto" con "lo que ya se pago".
  function periodKeyForDate(frequency, date) {
    return frequency === 'monthly' ? date.slice(0, 7) : date.slice(0, 4);
  }

  // Todas las veces que una plantilla toca entre dos fechas (incluidas).
  //
  // Ojo con los limites: se recorre MES a MES (o año a año) desde el mes
  // de "from" hasta el de "to", y la comprobacion fina se hace despues
  // sobre la fecha exacta -- porque el dia de cobro puede caer antes de
  // "from" dentro del primer mes, o despues de "to" dentro del ultimo.
  function occurrenceDates(template, from, to) {
    const dates = [];
    const startDate = template.start_date;
    const endDate = template.end_date || null;

    // Tope de seguridad: sin esto, un rango absurdo (año 1900 al 2999)
    // daria un bucle larguisimo dentro de la propia app.
    const MAX_ITERACIONES = 1200;

    if (template.frequency === 'monthly') {
      let year = Number(from.slice(0, 4));
      let month = Number(from.slice(5, 7));
      const lastYear = Number(to.slice(0, 4));
      const lastMonth = Number(to.slice(5, 7));
      let vueltas = 0;
      while ((year < lastYear || (year === lastYear && month <= lastMonth)) && vueltas < MAX_ITERACIONES) {
        vueltas += 1;
        const day = Math.min(template.day_of_month, daysInMonth(year, month));
        const date = `${year}-${pad2(month)}-${pad2(day)}`;
        if (date >= from && date <= to && date >= startDate && (!endDate || date <= endDate)) {
          dates.push(date);
        }
        month += 1;
        if (month > 12) { month = 1; year += 1; }
      }
      return dates;
    }

    if (template.frequency === 'annual' && template.month_of_year) {
      const lastYear = Number(to.slice(0, 4));
      let vueltas = 0;
      for (let year = Number(from.slice(0, 4)); year <= lastYear && vueltas < MAX_ITERACIONES; year += 1) {
        vueltas += 1;
        const month = template.month_of_year;
        const day = Math.min(template.day_of_month, daysInMonth(year, month));
        const date = `${year}-${pad2(month)}-${pad2(day)}`;
        if (date >= from && date <= to && date >= startDate && (!endDate || date <= endDate)) {
          dates.push(date);
        }
      }
      return dates;
    }

    // Plantilla anual sin mes: dato invalido, no deberia existir. Mismo
    // criterio que el generador -- se ignora en vez de inventarse un mes.
    return [];
  }

  // No basta con que TENGA la forma YYYY-MM-DD: "2026-99-99" la cumple.
  // Se construye la fecha y se comprueba que vuelve igual, que es la forma
  // barata de descartar meses 13, dias 31 en abril y 29 de febrero de un
  // año que no es bisiesto.
  function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1) return false;
    return d <= daysInMonth(y, m);
  }

  // GET /forecast?from=YYYY-MM-DD&to=YYYY-MM-DD
  //
  // Declarada ANTES que las rutas con /:id a proposito (misma precaucion
  // que /summary/by-asset en finanzasInvestments.js): si algun dia se
  // añade un GET /:id, "forecast" no debe colarse como si fuera un id.
  router.get('/forecast', (req, res) => {
    const from = req.query.from;
    const to = req.query.to;
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Hacen falta "from" y "to" con formato YYYY-MM-DD.' });
    }
    if (to < from) {
      return res.status(400).json({ error: 'invalid_request', message: 'La fecha final no puede ser anterior a la inicial.' });
    }
    // Un rango disparatado (del año 1900 al 2999) chocaba contra el tope
    // de vueltas de occurrenceDates() y devolvia una lista CORTADA sin
    // decirlo -- o sea, un total que parecia bueno y no lo era. Mejor
    // negarse: cualquier pantalla real pide como mucho un año.
    if (Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 50) {
      return res.status(400).json({ error: 'invalid_request', message: 'El rango no puede pasar de 50 años.' });
    }

    const templates = db.prepare('SELECT * FROM finanzas_recurring_expenses').all();
    const occurrences = [];

    // "Hoy" para separar lo que todavia no ha llegado de lo que ya paso.
    const ahora = new Date();
    const hoy = `${ahora.getFullYear()}-${pad2(ahora.getMonth() + 1)}-${pad2(ahora.getDate())}`;

    for (const template of templates) {
      // Lo que YA se pago de esta plantilla, indexado por periodo. Se
      // pide una vez por plantilla (no una por ocurrencia) para no
      // lanzar decenas de consultas por pantalla.
      const pagadas = db
        .prepare('SELECT id, amount, date FROM finanzas_transactions WHERE recurring_expense_id = ?')
        .all(template.id);
      const porPeriodo = new Map();
      for (const t of pagadas) {
        const clave = periodKeyForDate(template.frequency, t.date);
        const previo = porPeriodo.get(clave);
        if (previo) {
          // Dos movimientos en el mismo periodo no deberia pasar (el
          // generador se protege con last_generated_period), pero si
          // pasara, se suman en vez de enseñar solo uno y mentir en el
          // total.
          previo.amount += t.amount;
          if (t.date < previo.date) previo.date = t.date;
        } else {
          porPeriodo.set(clave, { id: t.id, amount: t.amount, date: t.date });
        }
      }

      for (const date of occurrenceDates(template, from, to)) {
        const clave = periodKeyForDate(template.frequency, date);
        const pagada = porPeriodo.get(clave) || null;

        // Una plantilla pausada (o desactivada sola al pasar su ultimo
        // pago) NO proyecta cobros FUTUROS: si la cancelaste, ese dinero
        // ya no va a salir de tu cuenta.
        //
        // Pero lo PASADO si cuenta. Esto salio de probarlo: un gimnasio de
        // enero a junio desaparecia entero del año al desactivarse la
        // plantilla, y el total anual pasaba de 10.851,88 a 10.671,88 sin
        // que nada lo explicara. Un total que se come 180 € en silencio es
        // peor que no tener total.
        if (!template.active && !pagada && date >= hoy) continue;

        occurrences.push({
          templateId: template.id,
          description: template.description || null,
          accountId: template.account_id,
          categoryId: template.category_id || null,
          frequency: template.frequency,
          countsTowardBudget: !!template.counts_toward_budget,
          periodKey: clave,
          // Si esta pagada mandamos la fecha y el importe REALES (pueden
          // no coincidir con la plantilla: subir el precio de Netflix no
          // toca lo ya cobrado). Si no, lo previsto.
          date: pagada ? pagada.date : date,
          plannedDate: date,
          amount: pagada ? pagada.amount : template.amount,
          plannedAmount: template.amount,
          // Tres estados, no dos. La diferencia importa y salio de probarlo
          // con datos de verdad: un cobro de enero que hoy (septiembre) no
          // tiene movimiento NO esta "pendiente" -- es que nunca se
          // registro, porque la plantilla se creo despues o porque la app
          // no se abrio ese mes (el generador solo hace el periodo en
          // curso, nunca rellena hacia atras). Llamarlo "pendiente" seria
          // decirle a Koku que debe un alquiler que ya pago.
          status: pagada ? 'paid' : date < hoy ? 'overdue' : 'pending',
          transactionId: pagada ? pagada.id : null,
        });
      }
    }

    occurrences.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.templateId - b.templateId));

    let paid = 0;
    let pending = 0;
    let overdue = 0;
    for (const o of occurrences) {
      if (o.status === 'paid') paid += o.amount;
      else if (o.status === 'overdue') overdue += o.amount;
      else pending += o.amount;
    }

    res.json({
      from,
      to,
      occurrences,
      // "unpaid" es la suma de lo que sigue debiendose por cualquiera de
      // los dos motivos -- es la cifra que contesta a "¿cuanto me queda?",
      // y se manda ya sumada para que la pantalla no tenga que decidirlo.
      totals: { paid, pending, overdue, unpaid: pending + overdue, all: paid + pending + overdue },
    });
  });

  // GET /summary — lo que cuestan TODOS los gastos fijos activos,
  // normalizado a mes y a año.
  //
  // Normalizar es justo lo que hoy no se puede hacer a ojo: Netflix a
  // 10 €/mes son 120 €/año, y un seguro de 400 €/año son 33 €/mes. Sin
  // llevarlos a la misma unidad no hay forma de saber cual te cuesta mas.
  router.get('/summary', (req, res) => {
    const rows = db.prepare('SELECT * FROM finanzas_recurring_expenses WHERE active = 1').all();
    const items = rows.map((row) => {
      const monthlyCost = row.frequency === 'monthly' ? row.amount : row.amount / 12;
      const annualCost = row.frequency === 'monthly' ? row.amount * 12 : row.amount;
      return Object.assign(serialize(row), { monthlyCost, annualCost });
    });
    items.sort((a, b) => b.annualCost - a.annualCost);
    const monthlyTotal = items.reduce((acc, i) => acc + i.monthlyCost, 0);
    const annualTotal = items.reduce((acc, i) => acc + i.annualCost, 0);
    res.json({ monthlyTotal, annualTotal, items });
  });

  // GET /:id/history — cuanto ha costado ESTE gasto cada año.
  //
  // Sale gratis de los movimientos ya generados, que guardan
  // recurring_expense_id. "count" importa para no comparar peras con
  // manzanas: un año a medias (11 meses) no se compara con uno entero
  // sin decirlo.
  router.get('/:id/history', (req, res) => {
    const existing = db.prepare('SELECT * FROM finanzas_recurring_expenses WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const years = db
      .prepare(
        `SELECT substr(date, 1, 4) AS year, SUM(amount) AS total, COUNT(*) AS count
         FROM finanzas_transactions
         WHERE recurring_expense_id = ?
         GROUP BY substr(date, 1, 4)
         ORDER BY year DESC`
      )
      .all(req.params.id);

    res.json({
      templateId: existing.id,
      description: existing.description || null,
      frequency: existing.frequency,
      currentAmount: existing.amount,
      years: years.map((y) => ({ year: y.year, total: y.total, count: y.count })),
    });
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

  mountLocalRouter('/api/finanzas-recurring-expenses', router);

})();
