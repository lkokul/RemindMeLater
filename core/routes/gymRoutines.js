// routes/gymRoutines.js — rutinas reutilizables de la extension Gimnasio
// (ej. "Dia de pierna"): un nombre+icono+color, como los grupos del
// calendario, mas una lista ORDENADA de ejercicios con series/repeticiones
// orientativas (solo una sugerencia -- lo que de verdad se hizo se
// registra aparte al completar una sesion, ver routes/gymSessions.js).
//
// La lista de ejercicios se guarda/reemplaza ENTERA en cada POST/PUT (no
// hay endpoints sueltos para anadir/quitar un ejercicio uno a uno) --
// mas simple en los dos lados: el formulario de "editar rutina" siempre
// manda la lista completa tal cual queda.
const { createRouter } = require('../router');
const db = require('../db');

const router = createRouter();

function sanitizeIcon(icon) {
  if (icon === undefined) return undefined;
  if (icon === null || icon === '') return null;
  return String(icon).slice(0, 8); // ver groups.js para el porque de este limite
}

function serializeExerciseList(routineId) {
  return db
    .prepare(`
      SELECT gre.id, gre.exercise_id, gre.position, gre.target_sets, gre.target_reps, gre.target_rest_seconds, ge.name, ge.muscle_group
      FROM gym_routine_exercises gre
      JOIN gym_exercises ge ON ge.id = gre.exercise_id
      WHERE gre.routine_id = ?
      ORDER BY gre.position ASC, gre.id ASC
    `)
    .all(routineId)
    .map((r) => ({
      exerciseId: r.exercise_id,
      name: r.name,
      muscleGroup: r.muscle_group || null,
      position: r.position,
      targetSets: r.target_sets,
      targetReps: r.target_reps,
      targetRestSeconds: r.target_rest_seconds,
    }));
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || null,
    color: row.color,
    position: row.position,
    exercises: serializeExerciseList(row.id),
  };
}

// Reemplaza TODA la lista de ejercicios de una rutina por la que llega
// en el body -- se borra lo anterior y se inserta de cero, mas simple
// que calcular un diff. "exercises" es opcional (rutina sin ejercicios
// todavia es valida).
function replaceRoutineExercises(routineId, exercises) {
  db.prepare('DELETE FROM gym_routine_exercises WHERE routine_id = ?').run(routineId);
  if (!Array.isArray(exercises)) return;

  const insert = db.prepare(
    'INSERT INTO gym_routine_exercises (routine_id, exercise_id, position, target_sets, target_reps, target_rest_seconds) VALUES (?, ?, ?, ?, ?, ?)'
  );
  exercises.forEach((ex, index) => {
    const exerciseId = Number(ex && ex.exerciseId);
    if (!exerciseId) return; // entrada invalida, se ignora en vez de romper el resto
    insert.run(
      routineId,
      exerciseId,
      index,
      ex.targetSets !== undefined && ex.targetSets !== null && ex.targetSets !== '' ? Number(ex.targetSets) : null,
      ex.targetReps !== undefined && ex.targetReps !== null && ex.targetReps !== '' ? Number(ex.targetReps) : null,
      ex.targetRestSeconds !== undefined && ex.targetRestSeconds !== null && ex.targetRestSeconds !== '' ? Number(ex.targetRestSeconds) : null
    );
  });
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM gym_routines ORDER BY position ASC, id ASC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { name, icon, color, exercises } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'La rutina necesita un nombre.' });
  }
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';

  const { count } = db.prepare('SELECT COUNT(*) as count FROM gym_routines').get();
  const info = db
    .prepare('INSERT INTO gym_routines (name, icon, color, position) VALUES (?, ?, ?, ?)')
    .run(name.trim(), sanitizeIcon(icon) ?? null, safeColor, count);

  replaceRoutineExercises(info.lastInsertRowid, exercises);

  const row = db.prepare('SELECT * FROM gym_routines WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM gym_routines WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, icon, color, exercises } = req.body || {};
  const safeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;
  const sanitizedIcon = sanitizeIcon(icon);

  db.prepare('UPDATE gym_routines SET name = ?, icon = ?, color = ? WHERE id = ?').run(
    name !== undefined && name.trim() ? name.trim() : existing.name,
    sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
    safeColor,
    req.params.id
  );

  if (exercises !== undefined) replaceRoutineExercises(req.params.id, exercises);

  const row = db.prepare('SELECT * FROM gym_routines WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  // Una rutina es solo una PLANTILLA -- borrarla no pierde ningun
  // historial. Las sesiones ya registradas que la usaban se quedan
  // (con routine_id a NULL), igual que un evento se queda sin grupo si
  // se borra el grupo (ver routes/groups.js).
  db.prepare('UPDATE gym_sessions SET routine_id = NULL WHERE routine_id = ?').run(req.params.id);
  db.prepare('DELETE FROM gym_routine_exercises WHERE routine_id = ?').run(req.params.id);
  const info = db.prepare('DELETE FROM gym_routines WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
