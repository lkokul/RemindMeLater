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

  // Las series de una sesion. Los TRAMOS de una serie alargada (dropset
  // o rest-pause) viven en la base como filas propias colgadas de su
  // madre, pero hacia el cliente se devuelven ANIDADOS en ella
  // (`segments`): asi `sets.length` sigue siendo el numero de series de
  // verdad y nadie tiene que acordarse de filtrar.
  function serializeSets(sessionId) {
    const rows = db
      .prepare(`
        SELECT gs.id, gs.parent_set_id, gs.segment_index, gs.pause_seconds, gs.exercise_id, gs.set_number, gs.reps, gs.weight_kg, gs.rest_seconds, gs.rpe, gs.set_type, gs.extra_rest_seconds, gs.duration_seconds, gs.side, gs.notes, ge.name
        FROM gym_sets gs
        JOIN gym_exercises ge ON ge.id = gs.exercise_id
        WHERE gs.session_id = ?
        ORDER BY gs.id ASC
      `)
      .all(sessionId);

    const parents = [];
    const byId = new Map();
    for (const r of rows) {
      if (r.parent_set_id) continue;
      const set = {
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
        segments: [],
      };
      byId.set(r.id, set);
      parents.push(set);
    }
    // Segunda pasada: cada tramo a su madre. Si la madre no aparece
    // (base a medio migrar, borrado raro), el tramo se ignora en vez de
    // colarse como una serie suelta que inflaria el conteo.
    for (const r of rows) {
      if (!r.parent_set_id) continue;
      const parent = byId.get(r.parent_set_id);
      if (!parent) continue;
      parent.segments.push({
        kind: r.set_type === 'restpause' ? 'restpause' : 'dropset',
        segmentIndex: r.segment_index,
        reps: r.reps,
        weightKg: r.weight_kg,
        pauseSeconds: r.pause_seconds,
      });
    }
    for (const set of parents) set.segments.sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));
    return parents;
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
      'INSERT INTO gym_sets (session_id, exercise_id, set_number, reps, weight_kg, rest_seconds, rpe, set_type, extra_rest_seconds, duration_seconds, side, notes, parent_set_id, segment_index, pause_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const VALID_SET_TYPES = ['warmup', 'dropset', 'restpause', 'failure'];
    const VALID_SIDES = ['left', 'right'];
    const countByExercise = new Map();
    const numeroONulo = (v) => (v !== undefined && v !== null && v !== '' ? Number(v) : null);
    sets.forEach((s) => {
      const exerciseId = Number(s && s.exerciseId);
      if (!exerciseId) return; // entrada invalida, se ignora en vez de romper el resto
      const setNumber = (countByExercise.get(exerciseId) || 0) + 1;
      countByExercise.set(exerciseId, setNumber);
      const info = insert.run(
        sessionId,
        exerciseId,
        setNumber,
        numeroONulo(s.reps),
        numeroONulo(s.weightKg),
        numeroONulo(s.restSeconds),
        numeroONulo(s.rpe),
        VALID_SET_TYPES.includes(s.setType) ? s.setType : null,
        s.extraRestSeconds !== undefined && s.extraRestSeconds !== null && s.extraRestSeconds !== '' && Number(s.extraRestSeconds) > 0 ? Number(s.extraRestSeconds) : null,
        s.durationSeconds !== undefined && s.durationSeconds !== null && s.durationSeconds !== '' && Number(s.durationSeconds) > 0 ? Number(s.durationSeconds) : null,
        VALID_SIDES.includes(s.side) ? s.side : null,
        s.notes && String(s.notes).trim() ? String(s.notes).trim() : null,
        null, // parent_set_id: esta es la serie madre
        null,
        null
      );

      // Tramos de una serie alargada. Comparten exercise_id y set_number
      // con su madre (son la MISMA serie), pero llevan parent_set_id, asi
      // que ni suben el contador de series ni se numeran aparte.
      if (!Array.isArray(s.segments)) return;
      // El indice del tramo se lleva aparte del de la lista para que los
      // tramos descartados (nulos o sin repeticiones) no dejen huecos.
      let segmentIndex = 0;
      s.segments.forEach((seg) => {
        if (!seg) return;
        const kind = seg.kind === 'restpause' ? 'restpause' : 'dropset';
        const reps = numeroONulo(seg.reps);
        const weightKg = numeroONulo(seg.weightKg);
        // Un tramo sin repeticiones no aporta nada y solo ensuciaria el
        // historial: se descarta.
        if (!reps) return;
        segmentIndex += 1;
        insert.run(
          sessionId,
          exerciseId,
          setNumber,
          reps,
          weightKg,
          null, // el descanso es de la serie entera, no del tramo
          numeroONulo(s.rpe),
          kind,
          null,
          null,
          VALID_SIDES.includes(s.side) ? s.side : null,
          null,
          info.lastInsertRowid,
          segmentIndex,
          kind === 'restpause' ? numeroONulo(seg.pauseSeconds) : null
        );
      });
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
               COUNT(CASE WHEN st.parent_set_id IS NULL THEN st.id END) as set_count,
               COUNT(CASE WHEN st.parent_set_id IS NULL AND st.set_type = 'failure' THEN st.id END) as failure_set_count,
               -- Los ejercicios ASISTIDOS quedan FUERA del volumen: ahi el
               -- peso apuntado es la ayuda que te quitas y va en negativo,
               -- asi que sumarlo restaria kilos de la cuenta general. Lo
               -- que de verdad mueves en una dominada asistida es tu
               -- cuerpo menos la banda, y el peso corporal no lo sabemos
               -- (Koku: "el peso corporal te da igual"). Las SERIES si
               -- cuentan: para la racha, el heatmap y el mapa de musculos
               -- una dominada asistida es una serie como cualquier otra.
               -- Se mira el SIGNO DE ESTA SERIE, no una marca del
               -- ejercicio: con una marca, apagarla recalculaba hacia
               -- atras todo el historial. Ver el bloque "PESO NEGATIVO
               -- (ayuda)" en app.js.
               SUM(CASE WHEN COALESCE(st.weight_kg, 0) < 0 THEN 0
                        ELSE COALESCE(st.reps, 0) * COALESCE(st.weight_kg, 0) END) as volume_kg,
               -- Cuantos de esos kg salieron de una serie llevada al
               -- fallo. Se devuelve APARTE y en kg de verdad: el peso
               -- extra lo aplica el cliente al pintar (es un ajuste de
               -- presentacion y ademas configurable, ver
               -- gymVolumenAjustado en app.js). Un TRAMO de dropset no
               -- lleva 'failure' en su propio set_type -- lo hereda de su
               -- madre, de ahi el COALESCE con el padre.
               SUM(CASE WHEN COALESCE(p.set_type, st.set_type) = 'failure'
                             AND COALESCE(st.weight_kg, 0) >= 0
                        THEN COALESCE(st.reps, 0) * COALESCE(st.weight_kg, 0) ELSE 0 END) as failure_volume_kg,
               SUM(COALESCE(st.duration_seconds, 0)) as work_seconds
        FROM gym_sessions s
        LEFT JOIN gym_sets st ON st.session_id = s.id
        LEFT JOIN gym_sets p ON p.id = st.parent_set_id
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
      failureSetCount: r.failure_set_count || 0,
      volumeKg: r.volume_kg || 0,
      failureVolumeKg: r.failure_volume_kg || 0,
      // Tiempo real de trabajo: suma de lo que duraron las series (solo
      // las registradas con el boton de empezar/terminar serie).
      workSeconds: r.work_seconds || 0,
      muscleGroups: musclesBySession.get(r.id) || [],
    })));
  });

  // MEDIA DE TIEMPO POR EJERCICIO, para estimar cuanto va a durar un
  // entreno antes de empezarlo (peticion de Koku).
  //
  // La media se saca POR EJERCICIO y no por rutina, tal como lo pidio:
  // "asi si hago una nueva rutina no depende del computo de la rutina
  // sino que ya tengo la media por ejercicio". Un dia nuevo montado con
  // ejercicios que ya has hecho tiene estimacion desde el primer
  // momento, sin haberlo entrenado nunca.
  //
  // Dos medias por ejercicio, porque un entreno son las dos cosas:
  //  - lo que tardas en HACER la serie (duration_seconds, que solo
  //    existe desde que hay boton de empezar/terminar serie), y
  //  - lo que descansas despues (rest_seconds + el +30s que anadieras).
  //
  // Solo cuentan las series MADRE (parent_set_id IS NULL): un tramo de
  // dropset comparte el descanso de su madre y su duracion ya va dentro.
  // El calentamiento SI cuenta, a diferencia de los PRs: calentar
  // tambien ocupa tiempo real en el gimnasio.
  router.get('/set-times', (req, res) => {
    const rows = db
      .prepare(`
        SELECT st.exercise_id,
               COUNT(st.duration_seconds) as duration_samples,
               AVG(st.duration_seconds) as avg_duration,
               COUNT(st.rest_seconds) as rest_samples,
               AVG(COALESCE(st.rest_seconds, 0) + COALESCE(st.extra_rest_seconds, 0)) as avg_rest
        FROM gym_sets st
        WHERE st.parent_set_id IS NULL
        GROUP BY st.exercise_id
      `)
      .all();
    res.json(rows.map((r) => ({
      exerciseId: r.exercise_id,
      // null y no 0 cuando no hay ni una muestra: "no lo se" y "tarda
      // cero" son cosas distintas, y el cliente tiene que poder
      // distinguirlas para decir "2 ejercicios sin datos todavia".
      avgSetSeconds: r.duration_samples > 0 ? Math.round(r.avg_duration) : null,
      avgRestSeconds: r.rest_samples > 0 ? Math.round(r.avg_rest) : null,
      setSamples: r.duration_samples || 0,
      restSamples: r.rest_samples || 0,
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
        SELECT s.date, MAX(st.weight_kg) as max_weight_kg,
               -- Una serie con peso negativo no suma volumen (ver /summary).
               SUM(CASE WHEN COALESCE(st.weight_kg, 0) < 0 THEN 0
                        ELSE COALESCE(st.reps, 0) * COALESCE(st.weight_kg, 0) END) as volume_kg,
               -- Igual que en /summary: los kg que salieron de series al
               -- fallo, aparte y sin ajustar (ver alli el porque).
               SUM(CASE WHEN COALESCE(p.set_type, st.set_type) = 'failure'
                             AND COALESCE(st.weight_kg, 0) >= 0
                        THEN COALESCE(st.reps, 0) * COALESCE(st.weight_kg, 0) ELSE 0 END) as failure_volume_kg,
               COUNT(CASE WHEN st.parent_set_id IS NULL AND st.set_type = 'failure' THEN st.id END) as failure_set_count
        FROM gym_sets st
        JOIN gym_sessions s ON s.id = st.session_id
        LEFT JOIN gym_sets p ON p.id = st.parent_set_id
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
        failureVolumeKg: r.failure_volume_kg || 0,
        failureSetCount: r.failure_set_count || 0,
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

    const rows = db
      .prepare('SELECT id, parent_set_id, segment_index, pause_seconds, set_type, set_number, reps, weight_kg, rpe, rest_seconds, side FROM gym_sets WHERE session_id = ? AND exercise_id = ? ORDER BY id ASC')
      .all(last.id, req.params.exerciseId);
    // Mismo anidado que serializeSets: los tramos van dentro de su
    // madre, para que la columna "Anterior" del entreno en vivo siga
    // teniendo una fila por serie de verdad.
    const sets = [];
    const byId = new Map();
    for (const r of rows) {
      if (r.parent_set_id) continue;
      const set = { setNumber: r.set_number, reps: r.reps, weightKg: r.weight_kg, rpe: r.rpe, restSeconds: r.rest_seconds, side: r.side || null, segments: [] };
      byId.set(r.id, set);
      sets.push(set);
    }
    for (const r of rows) {
      if (!r.parent_set_id) continue;
      const parent = byId.get(r.parent_set_id);
      if (!parent) continue;
      parent.segments.push({
        kind: r.set_type === 'restpause' ? 'restpause' : 'dropset',
        segmentIndex: r.segment_index,
        reps: r.reps,
        weightKg: r.weight_kg,
        pauseSeconds: r.pause_seconds,
      });
    }
    for (const set of sets) set.segments.sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));
    // La nota que quedo de ese ejercicio la ultima vez (incluye las notas
    // de sus series ya combinadas): se ensena en el entreno siguiente.
    const note = parseExerciseNotes(last.exercise_notes)[String(req.params.exerciseId)] || null;
    res.json({ date: last.date, sets, note });
  });

  mountLocalRouter('/api/gym-sessions', router);

})();
