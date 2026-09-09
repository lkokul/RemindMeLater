// gymSessions — portado de server/routes/gymSessions.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/gymSessions.js — sesiones de gimnasio de verdad (una fecha +
  // las series que se hicieron), y el endpoint de progreso que agrega
  // esas series para las graficas. Una sesion puede partir de una rutina
  // guardada (routine_id) o ser completamente libre (routine_id = NULL,
  // ejercicios sueltos elegidos sobre la marcha) -- las dos formas son
  // validas, confirmado con Koku.

  const router = createLocalRouter();
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function serializeSets(sessionId) {
    return db
      .prepare(`
        SELECT gs.id, gs.exercise_id, gs.set_number, gs.reps, gs.weight_kg, gs.rest_seconds, gs.rpe, gs.set_type, gs.extra_rest_seconds, gs.duration_seconds, gs.side, gs.notes, ge.name
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
        rpe: r.rpe,
        setType: r.set_type,
        extraRestSeconds: r.extra_rest_seconds,
        durationSeconds: r.duration_seconds,
        side: r.side || null,
        notes: r.notes || null,
      }));
  }

  // exercise_notes se guarda como JSON {exerciseId: "nota"} (ver el
  // comentario del esquema); si por lo que sea no parsea, se devuelve
  // objeto vacio en vez de romper la lista entera de sesiones.
  function parseExerciseNotes(raw) {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function serialize(row) {
    const routine = row.routine_id ? db.prepare('SELECT name, color, icon FROM gym_routines WHERE id = ?').get(row.routine_id) : null;
    return {
      id: row.id,
      date: row.date,
      type: row.type || 'gym',
      activityKind: row.activity_kind || null,
      activityName: row.activity_name || null,
      routineId: row.routine_id,
      routineName: routine ? routine.name : null,
      routineColor: routine ? routine.color : null,
      routineIcon: routine ? routine.icon : null,
      notes: row.notes,
      startedAt: row.started_at || null,
      durationSeconds: row.duration_seconds ?? null,
      exerciseNotes: parseExerciseNotes(row.exercise_notes),
      sets: serializeSets(row.id),
    };
  }

  // Convierte el exerciseNotes que llega del cliente a lo que se guarda:
  // JSON con solo las notas no vacias, o NULL si no queda ninguna.
  function stringifyExerciseNotes(notes) {
    if (!notes || typeof notes !== 'object') return null;
    const clean = {};
    for (const [key, value] of Object.entries(notes)) {
      if (value && String(value).trim()) clean[key] = String(value).trim();
    }
    return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
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
      'INSERT INTO gym_sets (session_id, exercise_id, set_number, reps, weight_kg, rest_seconds, rpe, set_type, extra_rest_seconds, duration_seconds, side, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const VALID_SET_TYPES = ['warmup', 'dropset', 'failure'];
    const VALID_SIDES = ['left', 'right'];
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
        s.restSeconds !== undefined && s.restSeconds !== null && s.restSeconds !== '' ? Number(s.restSeconds) : null,
        s.rpe !== undefined && s.rpe !== null && s.rpe !== '' ? Number(s.rpe) : null,
        VALID_SET_TYPES.includes(s.setType) ? s.setType : null,
        s.extraRestSeconds !== undefined && s.extraRestSeconds !== null && s.extraRestSeconds !== '' && Number(s.extraRestSeconds) > 0 ? Number(s.extraRestSeconds) : null,
        s.durationSeconds !== undefined && s.durationSeconds !== null && s.durationSeconds !== '' && Number(s.durationSeconds) > 0 ? Number(s.durationSeconds) : null,
        VALID_SIDES.includes(s.side) ? s.side : null,
        s.notes && String(s.notes).trim() ? String(s.notes).trim() : null
      );
    });
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM gym_sessions ORDER BY date DESC, id DESC').all();
    res.json(rows.map(serialize));
  });

  // Resumen LIGERO de todas las sesiones, para las vistas que pintan
  // muchas de golpe (heatmap de consistencia, racha, logros, mapa de
  // musculos): una fila por sesion con agregados, SIN la lista de series
  // (el GET / de arriba serializa todos los sets de cada sesion y se
  // hace pesado para pintar un año entero).
  // Un solo segmento como '/' -- no colisiona con nada porque no existe
  // ningun GET /:id en este router, pero si algun dia se añade, esta
  // ruta tiene que declararse ANTES (gana el primer match, ver
  // local-api.js).
  router.get('/summary', (req, res) => {
    const rows = db
      .prepare(`
        SELECT s.id, s.date, s.type, s.activity_kind, s.activity_name, s.duration_seconds, s.routine_id,
               COUNT(st.id) as set_count,
               SUM(COALESCE(st.reps, 0) * COALESCE(st.weight_kg, 0)) as volume_kg,
               SUM(COALESCE(st.duration_seconds, 0)) as work_seconds
        FROM gym_sessions s
        LEFT JOIN gym_sets st ON st.session_id = s.id
        GROUP BY s.id
        ORDER BY s.date DESC, s.id DESC
      `)
      .all();
    // Grupos musculares por sesion, en una sola consulta aparte (mas
    // simple que un GROUP_CONCAT anidado y sigue siendo barato).
    const muscleRows = db
      .prepare(`
        SELECT st.session_id, ge.muscle_group
        FROM gym_sets st
        JOIN gym_exercises ge ON ge.id = st.exercise_id
        WHERE ge.muscle_group IS NOT NULL
        GROUP BY st.session_id, ge.muscle_group
      `)
      .all();
    const musclesBySession = new Map();
    for (const r of muscleRows) {
      if (!musclesBySession.has(r.session_id)) musclesBySession.set(r.session_id, []);
      musclesBySession.get(r.session_id).push(r.muscle_group);
    }
    res.json(rows.map((r) => ({
      id: r.id,
      date: r.date,
      type: r.type || 'gym',
      activityKind: r.activity_kind || null,
      activityName: r.activity_name || null,
      durationSeconds: r.duration_seconds ?? null,
      routineId: r.routine_id,
      setCount: r.set_count,
      volumeKg: r.volume_kg || 0,
      // Tiempo real de trabajo: suma de lo que duraron las series (solo
      // las registradas con el boton de empezar/terminar serie).
      workSeconds: r.work_seconds || 0,
      muscleGroups: musclesBySession.get(r.id) || [],
    })));
  });

  router.post('/', (req, res) => {
    const { date, routineId, notes, sets, startedAt, durationSeconds, exerciseNotes, type, activityKind, activityName } = req.body || {};
    if (!DATE_RE.test(date || '')) {
      return res.status(400).json({ error: 'invalid_request', message: 'Falta la fecha de la sesion (YYYY-MM-DD).' });
    }
    // Una actividad rapida no lleva series ni dia del plan: se fuerza
    // aqui (en vez de rechazar con 400) para que un cliente despistado
    // no pueda crear un hibrido raro.
    const safeType = type === 'activity' ? 'activity' : 'gym';
    const safeRoutineId = safeType === 'activity'
      ? null
      : (routineId ? db.prepare('SELECT id FROM gym_routines WHERE id = ?').get(routineId)?.id ?? null : null);

    const info = db
      .prepare('INSERT INTO gym_sessions (date, routine_id, notes, started_at, duration_seconds, exercise_notes, type, activity_kind, activity_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        date,
        safeRoutineId,
        notes && notes.trim() ? notes.trim() : null,
        startedAt ? String(startedAt) : null,
        durationSeconds !== undefined && durationSeconds !== null && durationSeconds !== '' ? Number(durationSeconds) : null,
        stringifyExerciseNotes(exerciseNotes),
        safeType,
        safeType === 'activity' && activityKind ? String(activityKind) : null,
        safeType === 'activity' && activityName && activityName.trim() ? activityName.trim() : null
      );

    replaceSessionSets(info.lastInsertRowid, safeType === 'activity' ? [] : sets);

    const row = db.prepare('SELECT * FROM gym_sessions WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_sessions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { date, routineId, notes, sets, startedAt, durationSeconds, exerciseNotes, activityKind, activityName } = req.body || {};
    const safeDate = date !== undefined && DATE_RE.test(date) ? date : existing.date;
    // El type de una sesion NUNCA cambia en un PUT (una actividad no se
    // convierte en entreno de pesas ni al reves -- se borra y se crea).
    const isActivity = (existing.type || 'gym') === 'activity';
    const safeRoutineId = isActivity
      ? null
      : routineId === undefined
        ? existing.routine_id
        : routineId
          ? db.prepare('SELECT id FROM gym_routines WHERE id = ?').get(routineId)?.id ?? null
          : null;

    // Igual que notes: undefined = "no tocar" (el modal de editar a mano
    // no manda estos campos y no debe borrar la duracion/notas del
    // entreno en vivo original).
    db.prepare('UPDATE gym_sessions SET date = ?, routine_id = ?, notes = ?, started_at = ?, duration_seconds = ?, exercise_notes = ?, activity_kind = ?, activity_name = ? WHERE id = ?').run(
      safeDate,
      safeRoutineId,
      notes === undefined ? existing.notes : (notes && notes.trim() ? notes.trim() : null),
      startedAt === undefined ? existing.started_at : (startedAt ? String(startedAt) : null),
      durationSeconds === undefined ? existing.duration_seconds : (durationSeconds !== null && durationSeconds !== '' ? Number(durationSeconds) : null),
      exerciseNotes === undefined ? existing.exercise_notes : stringifyExerciseNotes(exerciseNotes),
      activityKind === undefined ? existing.activity_kind : (isActivity && activityKind ? String(activityKind) : null),
      activityName === undefined ? existing.activity_name : (isActivity && activityName && activityName.trim() ? activityName.trim() : null),
      req.params.id
    );

    if (sets !== undefined && !isActivity) replaceSessionSets(req.params.id, sets);

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

  // "Anterior" del modo entrenar en vivo: las series de la ULTIMA sesion
  // que incluyo este ejercicio, para mostrarlas al lado de las de hoy
  // ("la ultima vez hiciste 3x10 con 60"). Dos segmentos, asi que no
  // colisiona con el /:id de arriba (el router local exige misma
  // longitud de ruta -- mismo caso que /progress/:exerciseId).
  router.get('/last-sets/:exerciseId', (req, res) => {
    const last = db
      .prepare(`
        SELECT s.id, s.date, s.exercise_notes
        FROM gym_sessions s
        WHERE EXISTS (SELECT 1 FROM gym_sets st WHERE st.session_id = s.id AND st.exercise_id = ?)
        ORDER BY s.date DESC, s.id DESC
        LIMIT 1
      `)
      .get(req.params.exerciseId);
    if (!last) return res.json({ date: null, sets: [], note: null });

    const sets = db
      .prepare('SELECT set_number, reps, weight_kg, rpe, rest_seconds, side FROM gym_sets WHERE session_id = ? AND exercise_id = ? ORDER BY id ASC')
      .all(last.id, req.params.exerciseId)
      .map((r) => ({ setNumber: r.set_number, reps: r.reps, weightKg: r.weight_kg, rpe: r.rpe, restSeconds: r.rest_seconds, side: r.side || null }));
    // La nota que quedo de ese ejercicio la ultima vez (incluye las notas
    // de sus series ya combinadas): se ensena en el entreno siguiente.
    const note = parseExerciseNotes(last.exercise_notes)[String(req.params.exerciseId)] || null;
    res.json({ date: last.date, sets, note });
  });

  mountLocalRouter('/api/gym-sessions', router);

})();
