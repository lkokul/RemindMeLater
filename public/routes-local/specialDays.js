// specialDays — portado de server/routes/specialDays.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/specialDays.js — dias marcados a mano como "festivo" o
  // "especial". No hay forma automatica de saber que dia es festivo (varia
  // por pais/region), asi que en vez de intentar adivinarlo se deja que la
  // persona los marque ella misma desde el panel de dia (ver app.js,
  // openDayModal). Es una lista compartida entre todos los dispositivos,
  // igual que los grupos o los temas.

  const router = createLocalRouter();
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const VALID_TYPES = ['holiday', 'special'];

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT date, type FROM special_days').all();
    res.json(rows);
  });

  router.put('/:date', (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Fecha invalida, se espera YYYY-MM-DD.' });
    }

    const { type } = req.body || {};

    const originId = req.device ? req.device.id : null;

    if (type === null || type === undefined) {
      db.prepare('DELETE FROM special_days WHERE date = ?').run(date);
      db.recordSyncChange('special_days', date, 'delete', null, originId);
      return res.json({ date, type: null });
    }

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: 'invalid_request', message: "type tiene que ser 'holiday', 'special' o null." });
    }

    db.prepare(
      "INSERT INTO special_days (date, type, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now')) ON CONFLICT(date) DO UPDATE SET type = excluded.type, updated_at = datetime('now')"
    ).run(date, type);
    db.recordSyncChange('special_days', date, 'upsert', { date, type }, originId);
    res.json({ date, type });
  });

  mountLocalRouter('/api/special-days', router);

})();
