// gymExercises — portado de server/routes/gymExercises.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/gymExercises.js — biblioteca de ejercicios de la extension
  // Gimnasio (ver #extensions-view en index.html). Un ejercicio es solo
  // un nombre + grupo muscular opcional; se reutiliza tanto en rutinas
  // (gym_routine_exercises) como en series ya registradas de verdad
  // (gym_sets, ver routes/gymSessions.js).

  const router = createLocalRouter();

  function serialize(row) {
    // secondary_muscles es un JSON array de ids de la taxonomia; si no
    // parsea (o no hay), lista vacia en vez de romper.
    let secondary = [];
    if (row.secondary_muscles) {
      try {
        const parsed = JSON.parse(row.secondary_muscles);
        if (Array.isArray(parsed)) secondary = parsed;
      } catch { /* lista vacia */ }
    }
    return {
      id: row.id,
      name: row.name,
      muscleGroup: row.muscle_group || null,
      libraryId: row.library_id || null,
      equipment: row.equipment || null,
      secondaryMuscles: secondary,
    };
  }

  // Normaliza el secondaryMuscles que llega del cliente a JSON o NULL.
  function stringifySecondary(value) {
    if (!Array.isArray(value)) return null;
    const clean = value.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim());
    return clean.length > 0 ? JSON.stringify(clean) : null;
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM gym_exercises ORDER BY name COLLATE NOCASE ASC').all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const { name, muscleGroup, libraryId, equipment, secondaryMuscles } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'El ejercicio necesita un nombre.' });
    }

    // Import idempotente desde la libreria empaquetada: si este
    // libraryId ya se importo antes, se devuelve el ejercicio existente
    // en vez de crear un duplicado (200, no 201 -- no se creo nada).
    if (libraryId) {
      const existing = db.prepare('SELECT * FROM gym_exercises WHERE library_id = ?').get(String(libraryId));
      if (existing) return res.json(serialize(existing));
    }

    const info = db
      .prepare('INSERT INTO gym_exercises (name, muscle_group, library_id, equipment, secondary_muscles) VALUES (?, ?, ?, ?, ?)')
      .run(
        name.trim(),
        muscleGroup && muscleGroup.trim() ? muscleGroup.trim() : null,
        libraryId ? String(libraryId) : null,
        equipment && equipment.trim() ? equipment.trim() : null,
        stringifySecondary(secondaryMuscles)
      );

    const row = db.prepare('SELECT * FROM gym_exercises WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_exercises WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // library_id no se toca desde el PUT a proposito: es la marca de "de
    // donde salio", editar el ejercicio no cambia su origen.
    const { name, muscleGroup, equipment } = req.body || {};
    db.prepare('UPDATE gym_exercises SET name = ?, muscle_group = ?, equipment = ? WHERE id = ?').run(
      name !== undefined && name.trim() ? name.trim() : existing.name,
      muscleGroup === undefined ? existing.muscle_group : (muscleGroup && muscleGroup.trim() ? muscleGroup.trim() : null),
      equipment === undefined ? existing.equipment : (equipment && equipment.trim() ? equipment.trim() : null),
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

  mountLocalRouter('/api/gym-exercises', router);

})();
