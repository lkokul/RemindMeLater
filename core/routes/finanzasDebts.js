// routes/finanzasDebts.js — Deudas de la extension Finanzas: lo que Koku
// debe a alguien ("owed_by_me") y lo que alguien le debe a el
// ("owed_to_me"), en una unica tabla (ver comentario junto a
// finanzas_debts en db.js). Ligar una deuda a una cuenta es OPCIONAL: si
// se liga, marcarla como pagada genera un movimiento real en esa cuenta
// (gasto o ingreso, segun la direccion) via finanzas_transactions —
// decidido con Koku, no es solo una lista de seguimiento. Sin cuenta,
// marcar como pagada solo cambia el booleano.
const { createRouter } = require('../router');
const db = require('../db');

const router = createRouter();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function serialize(row) {
  return {
    id: row.id,
    direction: row.direction,
    person: row.person,
    amount: row.amount,
    description: row.description || null,
    date: row.date || null,
    accountId: row.account_id || null,
    paid: !!row.paid,
    paidAt: row.paid_at || null,
    transactionId: row.transaction_id || null,
    createdAt: row.created_at,
  };
}

function validateCreateBody(body) {
  const direction = body.direction;
  if (direction !== 'owed_by_me' && direction !== 'owed_to_me') {
    return { error: 'La direccion tiene que ser "owed_by_me" o "owed_to_me".' };
  }
  const person = typeof body.person === 'string' ? body.person.trim() : '';
  if (!person) {
    return { error: 'Falta a quien (o quien) corresponde la deuda.' };
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: 'El importe tiene que ser un numero mayor que 0.' };
  }
  // La fecha es OPCIONAL (pedido explicito de Koku) -- si viene, tiene
  // que tener el formato correcto; si no viene, se guarda NULL.
  let date = null;
  if (body.date !== undefined && body.date !== null && body.date !== '') {
    if (!DATE_RE.test(body.date)) {
      return { error: 'La fecha tiene que tener el formato YYYY-MM-DD.' };
    }
    date = body.date;
  }
  let accountId = null;
  if (body.accountId !== undefined && body.accountId !== null && body.accountId !== '') {
    if (!db.prepare('SELECT 1 FROM finanzas_accounts WHERE id = ?').get(body.accountId)) {
      return { error: 'La cuenta indicada no existe.' };
    }
    accountId = body.accountId;
  }
  const description =
    typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;

  return { direction, person, amount, description, date, accountId };
}

// Crea (o borra, si se desmarca) el movimiento de finanzas_transactions
// ligado a una deuda -- reutilizado tanto al crear/editar como al
// marcar/desmarcar "pagada". Nunca lanza si la deuda no tiene cuenta
// ligada, simplemente no hace nada.
function syncDebtTransaction(debt) {
  if (debt.paid && debt.account_id && !debt.transaction_id) {
    const type = debt.direction === 'owed_by_me' ? 'expense' : 'income';
    const description = debt.person + (debt.description ? ` — ${debt.description}` : '');
    const info = db
      .prepare(
        'INSERT INTO finanzas_transactions (account_id, type, amount, date, description, category_id, counts_toward_budget) VALUES (?, ?, ?, ?, ?, NULL, ?)'
      )
      .run(
        debt.account_id,
        type,
        debt.amount,
        debt.paid_at,
        `Deuda saldada: ${description}`,
        // Saldar una deuda no es un gasto discrecional del mes -- no
        // cuenta contra el limite de gasto mensual configurado.
        0
      );
    db.prepare('UPDATE finanzas_debts SET transaction_id = ? WHERE id = ?').run(info.lastInsertRowid, debt.id);
    debt.transaction_id = info.lastInsertRowid;
  } else if (!debt.paid && debt.transaction_id) {
    // OJO con el orden: finanzas_debts.transaction_id es una FOREIGN KEY
    // a finanzas_transactions(id) -- hay que quitar la referencia
    // (UPDATE a NULL) ANTES de borrar la fila referenciada, si no salta
    // "FOREIGN KEY constraint failed" (bug real, visto en produccion).
    const oldTransactionId = debt.transaction_id;
    db.prepare('UPDATE finanzas_debts SET transaction_id = NULL WHERE id = ?').run(debt.id);
    db.prepare('DELETE FROM finanzas_transactions WHERE id = ?').run(oldTransactionId);
    debt.transaction_id = null;
  }
}

router.get('/', (req, res) => {
  const { direction, paid } = req.query;
  let sql = 'SELECT * FROM finanzas_debts WHERE 1=1';
  const params = [];
  if (direction === 'owed_by_me' || direction === 'owed_to_me') {
    sql += ' AND direction = ?';
    params.push(direction);
  }
  if (paid === '1' || paid === '0') {
    sql += ' AND paid = ?';
    params.push(Number(paid));
  }
  sql += ' ORDER BY paid ASC, date IS NULL, date DESC, id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const result = validateCreateBody(req.body || {});
  if (result.error) {
    return res.status(400).json({ error: 'invalid_request', message: result.error });
  }
  const info = db
    .prepare(
      'INSERT INTO finanzas_debts (direction, person, amount, description, date, account_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(result.direction, result.person, result.amount, result.description, result.date, result.accountId);

  const row = db.prepare('SELECT * FROM finanzas_debts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM finanzas_debts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const body = req.body || {};

  // Mismos campos que al crear, pero cada uno es opcional (solo se toca
  // si viene en el body) -- mismo patron que finanzasTransactions.js.
  const merged = {
    direction: body.direction !== undefined ? body.direction : existing.direction,
    person: body.person !== undefined ? body.person : existing.person,
    amount: body.amount !== undefined ? body.amount : existing.amount,
    description: body.description !== undefined ? body.description : existing.description,
    date: body.date !== undefined ? body.date : existing.date,
    accountId: body.accountId !== undefined ? body.accountId : existing.account_id,
  };
  const result = validateCreateBody(merged);
  if (result.error) {
    return res.status(400).json({ error: 'invalid_request', message: result.error });
  }

  db.prepare(
    'UPDATE finanzas_debts SET direction = ?, person = ?, amount = ?, description = ?, date = ?, account_id = ? WHERE id = ?'
  ).run(result.direction, result.person, result.amount, result.description, result.date, result.accountId, req.params.id);

  // Editar una deuda YA pagada y ligada a una cuenta (importe, cuenta,
  // descripcion...) deja el movimiento viejo desactualizado -- en vez de
  // intentar parchearlo campo a campo, se borra y se regenera de cero
  // con los datos actuales (mismo patron simple que ya usa
  // syncDebtTransaction). Si ya no tiene cuenta ligada, se queda sin
  // movimiento, sin mas.
  let row = db.prepare('SELECT * FROM finanzas_debts WHERE id = ?').get(req.params.id);
  if (row.paid && row.transaction_id) {
    // Mismo orden que en syncDebtTransaction: quitar la referencia antes
    // de borrar la fila referenciada (FOREIGN KEY).
    const oldTransactionId = row.transaction_id;
    db.prepare('UPDATE finanzas_debts SET transaction_id = NULL WHERE id = ?').run(row.id);
    db.prepare('DELETE FROM finanzas_transactions WHERE id = ?').run(oldTransactionId);
    row = db.prepare('SELECT * FROM finanzas_debts WHERE id = ?').get(req.params.id);
    syncDebtTransaction(row);
  }

  res.json(serialize(row));
});

// Marca/desmarca una deuda como pagada/cobrada -- endpoint aparte del PUT
// general porque dispara la creacion/borrado del movimiento ligado (ver
// syncDebtTransaction), y porque el cliente no tiene por que mandar el
// resto de campos solo para cambiar este.
router.put('/:id/paid', (req, res) => {
  const existing = db.prepare('SELECT * FROM finanzas_debts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const paid = !!(req.body && req.body.paid);
  const paidAt = paid ? (req.body.paidAt && DATE_RE.test(req.body.paidAt) ? req.body.paidAt : new Date().toISOString().slice(0, 10)) : null;

  db.prepare('UPDATE finanzas_debts SET paid = ?, paid_at = ? WHERE id = ?').run(paid ? 1 : 0, paidAt, req.params.id);

  const row = db.prepare('SELECT * FROM finanzas_debts WHERE id = ?').get(req.params.id);
  syncDebtTransaction(row);

  const finalRow = db.prepare('SELECT * FROM finanzas_debts WHERE id = ?').get(req.params.id);
  res.json(serialize(finalRow));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM finanzas_debts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  // Borrar la deuda borra tambien el movimiento que hubiera generado al
  // saldarse -- si no, quedaria un gasto/ingreso fantasma sin ninguna
  // deuda que lo explique. Orden importante: primero la deuda (quita la
  // FOREIGN KEY hacia el movimiento), luego el movimiento.
  db.prepare('DELETE FROM finanzas_debts WHERE id = ?').run(req.params.id);
  if (existing.transaction_id) {
    db.prepare('DELETE FROM finanzas_transactions WHERE id = ?').run(existing.transaction_id);
  }
  res.status(204).end();
});

module.exports = router;
