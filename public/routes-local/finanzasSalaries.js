// finanzasSalaries — el salario y su historia.
//
// Escrito aqui directamente (no portado del servidor): esta funcion no
// existe todavia en la version de escritorio. Mismas convenciones que sus
// vecinos: IIFE, createLocalRouter/mountLocalRouter y nada de ON DELETE
// CASCADE.
//
// LA IDEA: no es un ajuste de una cifra, es una LISTA. Cada registro dice
// "desde esta fecha cobro esto", asi que una subida no borra lo que
// ganabas antes y se puede ver la evolucion. El importe es NETO -- es el
// unico que se puede comparar con lo que de verdad entra en Movimientos.
(function () {
  const db = localDb;

  const router = createLocalRouter();

  function serialize(row) {
    return {
      id: row.id,
      amount: row.amount,
      startDate: row.start_date,
      notes: row.notes || null,
    };
  }

  function hoy() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function validarImporte(valor) {
    const bruto = Number(valor);
    if (!Number.isFinite(bruto) || bruto <= 0) return { error: 'El salario tiene que ser un numero mayor que 0.' };
    const amount = Math.round(bruto * 100) / 100;
    if (amount <= 0) return { error: 'El salario es demasiado pequeño: el minimo es 0,01 €.' };
    return { amount };
  }

  function validarFecha(valor) {
    if (!valor) return hoy();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
    return valor;
  }

  // El salario de HOY: el registro con la fecha mas reciente que no sea
  // futura. Si pones una subida con fecha del mes que viene, hasta que
  // llegue sigue mandando el de ahora -- que es como funciona de verdad.
  function salarioActual() {
    return db
      .prepare('SELECT * FROM finanzas_salaries WHERE start_date <= ? ORDER BY start_date DESC, id DESC LIMIT 1')
      .get(hoy());
  }

  router.get('/', (req, res) => {
    const filas = db.prepare('SELECT * FROM finanzas_salaries ORDER BY start_date DESC, id DESC').all();
    const actual = salarioActual();

    // La variacion de cada salario respecto al ANTERIOR en el tiempo, que
    // es la frase que uno quiere leer ("+120 €, un 8% mas"). Se calcula
    // aqui y no en la pantalla para que el historico y cualquier otra
    // vista digan exactamente lo mismo.
    const enOrden = [...filas].reverse(); // del mas viejo al mas nuevo
    const variacionPorId = {};
    for (let i = 1; i < enOrden.length; i += 1) {
      const previo = enOrden[i - 1];
      const actualFila = enOrden[i];
      if (previo.amount > 0) {
        variacionPorId[actualFila.id] = {
          diferencia: Math.round((actualFila.amount - previo.amount) * 100) / 100,
          porcentaje: Math.round(((actualFila.amount - previo.amount) / previo.amount) * 1000) / 10,
          desde: previo.amount,
        };
      }
    }

    res.json({
      current: actual ? serialize(actual) : null,
      history: filas.map((f) => Object.assign(serialize(f), { change: variacionPorId[f.id] || null })),
    });
  });

  router.post('/', (req, res) => {
    const body = req.body || {};
    const importe = validarImporte(body.amount);
    if (importe.error) return res.status(400).json({ error: 'invalid_request', message: importe.error });

    const fecha = validarFecha(body.startDate);
    if (!fecha) return res.status(400).json({ error: 'invalid_request', message: 'La fecha tiene que tener el formato YYYY-MM-DD.' });

    const info = db
      .prepare('INSERT INTO finanzas_salaries (amount, start_date, notes) VALUES (?, ?, ?)')
      .run(importe.amount, fecha, typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null);
    res.status(201).json(serialize(db.prepare('SELECT * FROM finanzas_salaries WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/:id', (req, res) => {
    const existente = db.prepare('SELECT * FROM finanzas_salaries WHERE id = ?').get(req.params.id);
    if (!existente) return res.status(404).json({ error: 'not_found' });

    const body = req.body || {};
    const importe = validarImporte(body.amount !== undefined ? body.amount : existente.amount);
    if (importe.error) return res.status(400).json({ error: 'invalid_request', message: importe.error });

    const fecha = body.startDate !== undefined ? validarFecha(body.startDate) : existente.start_date;
    if (!fecha) return res.status(400).json({ error: 'invalid_request', message: 'La fecha tiene que tener el formato YYYY-MM-DD.' });

    db.prepare('UPDATE finanzas_salaries SET amount = ?, start_date = ?, notes = ? WHERE id = ?').run(
      importe.amount,
      fecha,
      body.notes !== undefined ? (typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null) : existente.notes,
      req.params.id
    );
    res.json(serialize(db.prepare('SELECT * FROM finanzas_salaries WHERE id = ?').get(req.params.id)));
  });

  // Corregir TODOS los registros de golpe: para cuando la cifra estaba mal
  // desde el principio (te equivocaste al apuntarla y nunca fue otra).
  //
  // Es destructivo con la historia -- deja todos los salarios en el mismo
  // importe y por tanto sin evolucion -- asi que la pantalla lo pregunta
  // con todas las letras antes de llamar aqui.
  router.put('/all/amount', (req, res) => {
    const importe = validarImporte((req.body || {}).amount);
    if (importe.error) return res.status(400).json({ error: 'invalid_request', message: importe.error });

    const info = db.prepare('UPDATE finanzas_salaries SET amount = ?').run(importe.amount);
    res.json({ updated: info.changes });
  });

  router.delete('/:id', (req, res) => {
    const existente = db.prepare('SELECT 1 FROM finanzas_salaries WHERE id = ?').get(req.params.id);
    if (!existente) return res.status(404).json({ error: 'not_found' });
    db.prepare('DELETE FROM finanzas_salaries WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  mountLocalRouter('/api/finanzas-salaries', router);
})();
