// routes/finanzasAccounts.js — cuentas de la extension Finanzas (ver
// #extensions-view en index.html), ej. "Cuenta corriente" o "Broker".
// El saldo NUNCA se guarda: se calcula sumando/restando todo lo
// registrado en finanzas_transactions y
// finanzas_investment_transactions de esa cuenta, a partir del saldo de
// partida (initial_balance) -- asi nunca puede desincronizarse.
const { createRouter } = require('../router');
const db = require('../db');

const router = createRouter();

function sanitizeIcon(icon) {
  if (icon === undefined) return undefined;
  if (icon === null || icon === '') return null;
  return String(icon).slice(0, 8); // ver groups.js para el porque de este limite
}

// Puramente informativo -- sin lista cerrada de valores validos en el
// servidor (el select de app.js ofrece unas opciones curadas, pero
// cualquier texto corto vale aqui, ver nota en db.js).
function sanitizeAccountType(type) {
  if (type === undefined) return undefined;
  if (type === null || type === '') return null;
  return String(type).trim().slice(0, 30) || null;
}

function sumWhere(table, accountId, type) {
  return db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM ${table} WHERE account_id = ? AND type = ?`).get(accountId, type).total;
}

function computeBalance(accountId, initialBalance) {
  const income = sumWhere('finanzas_transactions', accountId, 'income');
  const expense = sumWhere('finanzas_transactions', accountId, 'expense');
  const sell = sumWhere('finanzas_investment_transactions', accountId, 'sell');
  const dividend = sumWhere('finanzas_investment_transactions', accountId, 'dividend');
  const buy = sumWhere('finanzas_investment_transactions', accountId, 'buy');
  return initialBalance + income - expense + sell + dividend - buy;
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || null,
    color: row.color,
    type: row.type || null,
    initialBalance: row.initial_balance,
    position: row.position,
    balance: computeBalance(row.id, row.initial_balance),
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM finanzas_accounts ORDER BY position ASC, id ASC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { name, icon, color, initialBalance, type } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'La cuenta necesita un nombre.' });
  }
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';
  const safeInitial = initialBalance === undefined || initialBalance === null || initialBalance === '' ? 0 : Number(initialBalance);

  const { count } = db.prepare('SELECT COUNT(*) as count FROM finanzas_accounts').get();
  const info = db
    .prepare('INSERT INTO finanzas_accounts (name, icon, color, initial_balance, type, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), sanitizeIcon(icon) ?? null, safeColor, safeInitial, sanitizeAccountType(type) ?? null, count);

  const row = db.prepare('SELECT * FROM finanzas_accounts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM finanzas_accounts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, icon, color, initialBalance, type } = req.body || {};
  const safeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;
  const sanitizedIcon = sanitizeIcon(icon);
  const sanitizedType = sanitizeAccountType(type);
  const safeInitial = initialBalance === undefined ? existing.initial_balance : (initialBalance === null || initialBalance === '' ? 0 : Number(initialBalance));

  db.prepare('UPDATE finanzas_accounts SET name = ?, icon = ?, color = ?, initial_balance = ?, type = ? WHERE id = ?').run(
    name !== undefined && name.trim() ? name.trim() : existing.name,
    sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
    safeColor,
    safeInitial,
    sanitizedType === undefined ? existing.type : sanitizedType,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM finanzas_accounts WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  // Una cuenta con movimientos reales NO se deja borrar -- perder ese
  // historial financiero no tiene marcha atras (mismo espiritu que
  // Gimnasio con los ejercicios).
  const { count: txCount } = db.prepare('SELECT COUNT(*) as count FROM finanzas_transactions WHERE account_id = ?').get(req.params.id);
  const { count: invCount } = db.prepare('SELECT COUNT(*) as count FROM finanzas_investment_transactions WHERE account_id = ?').get(req.params.id);
  if (txCount > 0 || invCount > 0) {
    return res.status(400).json({
      error: 'has_history',
      message: 'Esta cuenta ya tiene movimientos registrados -- no se puede borrar sin perder ese historial.',
    });
  }

  const info = db.prepare('DELETE FROM finanzas_accounts WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
