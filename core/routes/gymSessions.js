// routes/gymSessions.js — sesiones de gimnasio de verdad (una fecha +
// las series que se hicieron), y el endpoint de progreso que agrega
// esas series para las graficas. Una sesion puede partir de una rutina
// guardada (routine_id) o ser completamente libre (routine_id = NULL,
// ejercicios sueltos elegidos sobre la marcha) -- las dos formas son
// validas, confirmado con Koku.
const { createRouter } = require('../router');
const db = require('../db');

const router = createRouter();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function serializeSets(sessionId) {
  return db
    .prepare(`
      SELECT gs.id, gs.exercise_id, gs.set_number, gs.reps, gs.weight_kg, gs.rest_seconds, ge.name
      FROM gym_sets gs
      JOIN gym_exercises ge ON ge.id = gs.exercise_id
      WHERE gs.session_id = ?
      ORDER BY gs.id ASC
    `)
    .all(sessionId)
    .map((r) => ({
      exerciseId: r.exercise_id,
      exerciseName: r.name,
      setNumber: r.set_number,
      reps: r.reps,
      weightKg: r.weight_kg,
      restSeconds: r.rest_seconds,
    }));
}

function serialize(row) {
  const routine = row.routine_id ? db.prepare('SELECT name, color, icon FROM gym_routines WHERE id = ?').get(row.routine_id) : null;
  return {
    id: row.id,
    date: row.date,
    routineId: row.routine_id,
    routineName: routine ? routine.name : null,
    routineColor: routine ? routine.color : null,
    routineIcon: routine ? routine.icon : null,
    notes: row.notes,
    sets: serializeSets(row.id),
  };
}

// Reemplaza TODAS las series de una sesion por las que llegan en el
// body -- mismo patron que replaceRoutineExercises en gymRoutines.js.
// "set_number" no lo manda el cliente: se numera solo, contando cuantas
// veces aparece ese exerciseId ANTES en la lista (1a serie, 2a serie...
// de ESE ejercicio dentro de la sesion) -- asi el cliente solo manda
// las series en el orden en que se hicieron, sin tener que numerarlas.
function replaceSessionSets(sessionId, sets) {
  db.prepare('DELETE FROM gym_sets WHERE session_id = ?').run(sessionId);
  if (!Array.isArray(sets)) return;

  const insert = db.prepare(
    'INSERT INTO gym_sets (session_id, exercise_id, set_number, reps, weight_kg, rest_seconds) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const countByExercise = new Map();
  sets.forEach((s) => {
    const exerciseId = Number(s && s.exerciseId);
    if (!exerciseId) return; // entrada invalida, se ignora en vez de romper el resto
    const setNumber = (countByExercise.get(exerciseId) || 0) + 1;
    countByExercise.set(exerciseId, setNumber);
    insert.run(
      sessionId,
      exerciseId,
      setNumber,
      s.reps !== undefined && s.reps !== null && s.reps !== '' ? Number(s.reps) : null,
      s.weightKg !== undefined && s.weightKg !== null && s.weightKg !== '' ? Number(s.weightKg) : null,
      s.restSeconds !== undefined && s.restSeconds !== null && s.restSeconds !== '' ? Number(s.restSeconds) : null
    );
  });
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM gym_sessions ORDER BY date DESC, id DESC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { date, routineId, notes, sets } = req.body || {};
  if (!DATE_RE.test(date || '')) {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta la fecha de la sesion (YYYY-MM-DD).' });
  }
  const safeRoutineId = routineId ? db.prepare('SELECT id FROM gym_routines WHERE id = ?').get(routineId)?.id ?? null : null;

  const info = db
    .prepare('INSERT INTO gym_sessions (date, routine_id, notes) VALUES (?, ?, ?)')
    .run(date, safeRoutineId, notes && notes.trim() ? notes.trim() : null);

  replaceSessionSets(info.lastInsertRowid, sets);

  const row = db.prepare('SELECT * FROM gym_sessions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM gym_sessions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { date, routineId, notes, sets } = req.body || {};
  const safeDate = date !== undefined && DATE_RE.test(date) ? date : existing.date;
  const safeRoutineId =
    routineId === undefined
      ? existing.routine_id
      : routineId
        ? db.prepare('SELECT id FROM gym_routines WHERE id = ?').get(routineId)?.id ?? null
        : null;

  db.prepare('UPDATE gym_sessions SET date = ?, routine_id = ?, notes = ? WHERE id = ?').run(
    safeDate,
    safeRoutineId,
    notes === undefined ? existing.notes : (notes && notes.trim() ? notes.trim() : null),
    req.params.id
  );

  if (sets !== undefined) replaceSessionSets(req.params.id, sets);

  const row = db.prepare('SELECT * FROM gym_sessions WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  // Borrar una sesion SI borra su historial -- es la propia entrada de
  // historial que se esta borrando (a diferencia de borrar un ejercicio
  // o una rutina, aqui no hay nada que proteger de rebote).
  db.prepare('DELETE FROM gym_sets WHERE session_id = ?').run(req.params.id);
  const info = db.prepare('DELETE FROM gym_sessions WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

// Progreso de UN ejercicio a lo largo del tiempo: por cada sesion en la
// que se hizo, la fecha, el peso maximo de esa sesion, y el volumen
// (suma de repeticiones x peso de todas sus series). Pensado para
// pintar una grafica sencilla en el cliente (ver "Progreso" en la vista
// de Gimnasio) -- SIEMPRE en kg, la libra es solo de presentacion.
router.get('/progress/:exerciseId', (req, res) => {
  const rows = db
    .prepare(`
      SELECT s.date, MAX(st.weight_kg) as max_weight_kg, SUM(COALESCE(st.reps, 0) * COALESCE(st.weight_kg, 0)) as volume_kg
      FROM gym_sets st
      JOIN gym_sessions s ON s.id = st.session_id
      WHERE st.exercise_id = ?
      GROUP BY s.id
      ORDER BY s.date ASC, s.id ASC
    `)
    .all(req.params.exerciseId);

  res.json(
    rows.map((r) => ({
      date: r.date,
      maxWeightKg: r.max_weight_kg,
      volumeKg: r.volume_kg,
    }))
  );
});

module.exports = router;
