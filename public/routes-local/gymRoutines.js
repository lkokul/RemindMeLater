// gymRoutines — portado de server/routes/gymRoutines.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
//
// OJO (rediseno de Gimnasio): desde la ronda de bloques este archivo ya
// NO es copia literal del servidor -- las rutinas ahora son los "dias"
// de un bloque de entrenamiento (block_id, ver gymBlocks.js) y este
// archivo entiende ese campo. La palabra "rutina" se mantiene por dentro
// (tabla, rutas, variables) para no renombrar medio proyecto; en la
// interfaz se muestran como "dias".
(function () {
  const db = localDb;
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

  const router = createLocalRouter();

  function sanitizeIcon(icon) {
    if (icon === undefined) return undefined;
    if (icon === null || icon === '') return null;
    return String(icon).slice(0, 8); // ver groups.js para el porque de este limite
  }

  function serializeExerciseList(routineId) {
    return db
      .prepare(`
        SELECT gre.id, gre.exercise_id, gre.position, gre.target_sets, gre.target_reps, gre.target_rest_seconds, gre.hidden, ge.name, ge.muscle_group
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
        hidden: !!r.hidden,
      }));
  }

  function serialize(row) {
    return {
      id: row.id,
      name: row.name,
      icon: row.icon || null,
      color: row.color,
      position: row.position,
      blockId: row.block_id || null,
      exercises: serializeExerciseList(row.id),
    };
  }

  // Valida que un blockId recibido apunte a un bloque real; devuelve el
  // id numerico o null (igual que gymSessions.js hace con routine_id).
  function resolveBlockId(blockId) {
    const id = Number(blockId);
    if (!id) return null;
    const row = db.prepare('SELECT id FROM gym_blocks WHERE id = ?').get(id);
    return row ? id : null;
  }

  // Reemplaza TODA la lista de ejercicios de una rutina por la que llega
  // en el body -- se borra lo anterior y se inserta de cero, mas simple
  // que calcular un diff. "exercises" es opcional (rutina sin ejercicios
  // todavia es valida).
  function replaceRoutineExercises(routineId, exercises) {
    db.prepare('DELETE FROM gym_routine_exercises WHERE routine_id = ?').run(routineId);
    if (!Array.isArray(exercises)) return;

    const insert = db.prepare(
      'INSERT INTO gym_routine_exercises (routine_id, exercise_id, position, target_sets, target_reps, target_rest_seconds, hidden) VALUES (?, ?, ?, ?, ?, ?, ?)'
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
        ex.targetRestSeconds !== undefined && ex.targetRestSeconds !== null && ex.targetRestSeconds !== '' ? Number(ex.targetRestSeconds) : null,
        ex.hidden ? 1 : 0
      );
    });
  }

  router.get('/', (req, res) => {
    // ?blockId=N filtra los dias de UN bloque (lo usa el drill-down de la
    // pestana Plan); sin el parametro se devuelven todos, como siempre.
    const blockId = Number(req.query && req.query.blockId);
    const rows = blockId
      ? db.prepare('SELECT * FROM gym_routines WHERE block_id = ? ORDER BY position ASC, id ASC').all(blockId)
      : db.prepare('SELECT * FROM gym_routines ORDER BY position ASC, id ASC').all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const { name, icon, color, exercises, blockId } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'El día necesita un nombre.' });
    }
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';

    const { count } = db.prepare('SELECT COUNT(*) as count FROM gym_routines').get();
    const info = db
      .prepare('INSERT INTO gym_routines (name, icon, color, position, block_id) VALUES (?, ?, ?, ?, ?)')
      .run(name.trim(), sanitizeIcon(icon) ?? null, safeColor, count, resolveBlockId(blockId));

    replaceRoutineExercises(info.lastInsertRowid, exercises);

    const row = db.prepare('SELECT * FROM gym_routines WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  // -------------------------------------------------------------------
  // DUPLICAR UN DIA
  // -------------------------------------------------------------------
  //
  // Se lleva SIEMPRE sus ejercicios, sin preguntar: un dia sin ejercicios
  // no sirve de plantilla, que es justo para lo que Koku lo pidio.
  //
  // Solo se renombra EL DIA. Los ejercicios de dentro no se tocan -- son
  // referencias a tu lista de ejercicios (gym_routine_exercises guarda un
  // exercise_id), no copias: duplicar "Empuje" no te deja con dos "Press
  // banca" en la lista.
  //
  // La copia cae en el MISMO bloque que el original. Si la quieres en
  // otro, se cambia luego desde su ficha, que ya tiene el selector.
  // `renombrar` a false lo usa la copia de un BLOQUE entero: ahi lo que
  // se duplico es el bloque, asi que sus dias conservan su nombre.
  function duplicarDia(id, blockIdDestino, renombrar = true) {
    const original = db.prepare('SELECT * FROM gym_routines WHERE id = ?').get(id);
    if (!original) return null;
    const destino = blockIdDestino === undefined ? original.block_id : resolveBlockId(blockIdDestino);

    // Los nombres con los que no puede chocar son los del MISMO bloque,
    // que es lo unico que ves junto en una lista.
    const hermanos = destino === null
      ? db.prepare('SELECT name FROM gym_routines WHERE block_id IS NULL').all()
      : db.prepare('SELECT name FROM gym_routines WHERE block_id = ?').all(destino);

    const nombre = renombrar ? nombreDeCopia(original.name, hermanos.map((h) => h.name)) : original.name;
    const { count } = db.prepare('SELECT COUNT(*) as count FROM gym_routines').get();
    const info = db
      .prepare('INSERT INTO gym_routines (name, icon, color, position, block_id) VALUES (?, ?, ?, ?, ?)')
      .run(nombre, original.icon, original.color, count, destino);

    // Los ejercicios se copian con TODO: orden, series/repeticiones/
    // descanso orientativos y la marca de oculto. Un ejercicio aparcado
    // sigue aparcado en la copia.
    db.prepare(`
      INSERT INTO gym_routine_exercises (routine_id, exercise_id, position, target_sets, target_reps, target_rest_seconds, hidden)
      SELECT ?, exercise_id, position, target_sets, target_reps, target_rest_seconds, hidden
      FROM gym_routine_exercises WHERE routine_id = ?
      ORDER BY position ASC, id ASC
    `).run(info.lastInsertRowid, id);

    return db.prepare('SELECT * FROM gym_routines WHERE id = ?').get(info.lastInsertRowid);
  }

  router.post('/:id/duplicate', (req, res) => {
    const copia = duplicarDia(req.params.id, undefined);
    if (!copia) return res.status(404).json({ error: 'not_found' });
    res.status(201).json(serialize(copia));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_routines WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { name, icon, color, exercises, blockId } = req.body || {};
    const safeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;
    const sanitizedIcon = sanitizeIcon(icon);
    // blockId solo se toca si viene en el body (undefined = "no cambiar",
    // el mismo convenio que exercises justo debajo).
    const nextBlockId = blockId === undefined ? existing.block_id : resolveBlockId(blockId);

    db.prepare('UPDATE gym_routines SET name = ?, icon = ?, color = ?, block_id = ? WHERE id = ?').run(
      name !== undefined && name.trim() ? name.trim() : existing.name,
      sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
      safeColor,
      nextBlockId,
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

  mountLocalRouter('/api/gym-routines', router);

  // Lo necesita la copia de un BLOQUE entero (routes-local/gymBlocks.js),
  // que duplica todos sus dias. Mismo patron que duplicarNotaLocal: cada
  // archivo va en su IIFE y no puede importar nada.
  window.duplicarDiaDeGimnasio = duplicarDia;

})();
