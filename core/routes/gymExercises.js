// routes/gymExercises.js — biblioteca de ejercicios de la extension
// Gimnasio (ver #extensions-view en index.html). Un ejercicio es solo
// un nombre + grupo muscular opcional; se reutiliza tanto en rutinas
// (gym_routine_exercises) como en series ya registradas de verdad
// (gym_sets, ver routes/gymSessions.js).
const { createRouter } = require('../router');
const db = require('../db');

const router = createRouter();

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    muscleGroup: row.muscle_group || null,
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM gym_exercises ORDER BY name COLLATE NOCASE ASC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { name, muscleGroup } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'El ejercicio necesita un nombre.' });
  }
  const info = db
    .prepare('INSERT INTO gym_exercises (name, muscle_group) VALUES (?, ?)')
    .run(name.trim(), muscleGroup && muscleGroup.trim() ? muscleGroup.trim() : null);

  const row = db.prepare('SELECT * FROM gym_exercises WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM gym_exercises WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, muscleGroup } = req.body || {};
  db.prepare('UPDATE gym_exercises SET name = ?, muscle_group = ? WHERE id = ?').run(
    name !== undefined && name.trim() ? name.trim() : existing.name,
    muscleGroup === undefined ? existing.muscle_group : (muscleGroup && muscleGroup.trim() ? muscleGroup.trim() : null),
    req.params.id
  );

  const row = db.prepare('SELECT * FROM gym_exercises WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  // Si el ejercicio ya tiene series registradas de verdad, NO se deja
  // borrar -- perder ese historial no tiene marcha atras (a diferencia
  // de una rutina, que es solo una plantilla, ver routes/gymRoutines.js).
  const { count } = db.prepare('SELECT COUNT(*) as count FROM gym_sets WHERE exercise_id = ?').get(req.params.id);
  if (count > 0) {
    return res.status(400).json({
      error: 'has_history',
      message: 'Este ejercicio ya tiene series registradas -- no se puede borrar sin perder ese historial.',
    });
  }

  // No hay historial que proteger, pero si puede estar en alguna
  // rutina como plantilla -- eso si se limpia (no es un dato irremplazable).
  db.prepare('DELETE FROM gym_routine_exercises WHERE exercise_id = ?').run(req.params.id);
  const info = db.prepare('DELETE FROM gym_exercises WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
