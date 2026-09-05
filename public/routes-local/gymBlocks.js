// gymBlocks — NUEVO en el rediseno de Gimnasio (rama gimnasio-movil).
//
// A diferencia del resto de archivos de routes-local/, este NO es un
// porte de server/routes/ (alli no existe): los bloques de entrenamiento
// nacieron ya en la version movil. Sigue el mismo estilo que los demas
// (IIFE + createLocalRouter + borrado en cascada a mano).
//
// Un "bloque" es una etapa de entrenamiento con nombre propio (ej.
// "Volumen Invierno") que agrupa dias de entrenamiento (las filas de
// gym_routines, ver gymRoutines.js). Solo un bloque puede estar activo a
// la vez: el activo es el que se ofrece al empezar a entrenar.
(function () {
  const db = localDb;

  const router = createLocalRouter();

  function serialize(row) {
    // dayCount se calcula al vuelo (no se guarda) para que la lista de
    // bloques pueda pintar "3 dias" sin pedir las rutinas de cada uno.
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM gym_routines WHERE block_id = ?').get(row.id);
    return {
      id: row.id,
      name: row.name,
      position: row.position,
      isActive: row.is_active === 1,
      dayCount: n,
    };
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM gym_blocks ORDER BY position ASC, id ASC').all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'El bloque necesita un nombre.' });
    }
    const { count } = db.prepare('SELECT COUNT(*) as count FROM gym_blocks').get();
    // El primer bloque que se crea nace activo directamente (si no, el
    // boton "Empezar a entrenar" no tendria de donde tirar y habria que
    // dar un paso extra a mano justo despues de crearlo).
    const { n: activeCount } = db.prepare('SELECT COUNT(*) AS n FROM gym_blocks WHERE is_active = 1').get();
    const info = db
      .prepare('INSERT INTO gym_blocks (name, position, is_active) VALUES (?, ?, ?)')
      .run(name.trim(), count, activeCount > 0 ? 0 : 1);
    const row = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  // Marca ESTE bloque como el activo (y desactiva el resto). Es una ruta
  // aparte en vez de un campo mas del PUT para que "activar" sea una
  // operacion de un solo paso imposible de dejar a medias: nunca puede
  // haber dos activos a la vez.
  // OJO: declarada ANTES de las rutas /:id de abajo por claridad, aunque
  // no colisiona con ellas (el router local exige mismo numero de
  // segmentos y esta tiene dos).
  router.post('/:id/activate', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    db.prepare('UPDATE gym_blocks SET is_active = 0 WHERE is_active = 1').run();
    db.prepare('UPDATE gym_blocks SET is_active = 1 WHERE id = ?').run(req.params.id);
    const row = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const { name } = req.body || {};
    db.prepare('UPDATE gym_blocks SET name = ? WHERE id = ?').run(
      name !== undefined && name.trim() ? name.trim() : existing.name,
      req.params.id
    );
    const row = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  router.delete('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // Borrar un bloque borra tambien sus dias (son plantillas, no
    // historial), con la MISMA cascada a mano que el DELETE de un dia
    // suelto en gymRoutines.js: las sesiones ya registradas se conservan
    // (routine_id a NULL) y solo se van las plantillas.
    const dayIds = db.prepare('SELECT id FROM gym_routines WHERE block_id = ?').all(req.params.id).map((r) => r.id);
    for (const dayId of dayIds) {
      db.prepare('UPDATE gym_sessions SET routine_id = NULL WHERE routine_id = ?').run(dayId);
      db.prepare('DELETE FROM gym_routine_exercises WHERE routine_id = ?').run(dayId);
      db.prepare('DELETE FROM gym_routines WHERE id = ?').run(dayId);
    }
    db.prepare('DELETE FROM gym_blocks WHERE id = ?').run(req.params.id);

    // Si el bloque borrado era el activo, activar otro (el primero por
    // posicion) para no dejar la app sin bloque activo si aun quedan.
    if (existing.is_active === 1) {
      const next = db.prepare('SELECT id FROM gym_blocks ORDER BY position ASC, id ASC').get();
      if (next) db.prepare('UPDATE gym_blocks SET is_active = 1 WHERE id = ?').run(next.id);
    }
    res.status(204).end();
  });

  mountLocalRouter('/api/gym-blocks', router);

})();
