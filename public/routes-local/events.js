// events — portado de server/routes/events.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/events.js — CRUD de eventos del calendario.

  const router = createLocalRouter();

  // Traemos el nombre, color, icono y color-de-completada del grupo con un
  // LEFT JOIN (LEFT para que tambien salgan los eventos sin grupo, con esos
  // campos a NULL).
  const SELECT_WITH_GROUP = `
    SELECT e.*, g.name AS group_name, g.color AS group_color, g.icon AS group_icon, g.completed_color AS group_completed_color
    FROM events e
    LEFT JOIN groups g ON g.id = e.group_id
  `;

  function serialize(row) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      location: row.location,
      startAt: row.start_at,
      endAt: row.end_at,
      allDay: !!row.all_day,
      reminderMinutesBefore: row.reminder_minutes_before,
      groupId: row.group_id,
      groupName: row.group_name || null,
      groupColor: row.group_color || null,
      groupIcon: row.group_icon || null,
      groupCompletedColor: row.group_completed_color || null,
      isTask: !!row.is_task,
      done: !!row.done,
      createdByName: row.created_by_name || null,
      createdByPublicId: row.created_by_id || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // La regla de repeticion, si la tiene. Va montada como objeto en
      // vez de cuatro campos sueltos para que el modal la lea de una
      // pieza y "no se repite" sea simplemente null.
      repeat: reglaDeRepeticion(row),
      // Esta fila es una repeticion que se solto de su serie para poder
      // cambiarla ella sola (ver POST /:id/detach).
      repeatParentId: row.repeat_parent_id || null,
    };
  }

  // Saca del cuerpo de la peticion una regla de repeticion limpia, o
  // null si no se repite. Se valida aqui y no en el cliente porque la
  // base es lo ultimo que queda entre un dato raro y una pantalla rota.
  function limpiarRepeticion(repeat) {
    if (!repeat || !repeat.freq || !FRECUENCIAS_DE_REPETICION.has(repeat.freq)) return null;
    const interval = Math.max(1, Math.min(365, Number(repeat.interval) || 1));
    let weekdays = [];
    if (repeat.freq === 'weekly' && Array.isArray(repeat.weekdays)) {
      weekdays = [...new Set(repeat.weekdays.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
    }
    // 'YYYY-MM-DD' y nada mas: una fecha con hora aqui solo confundiria,
    // el final de una repeticion es un dia entero.
    const until = typeof repeat.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(repeat.until) ? repeat.until : null;
    return { freq: repeat.freq, interval, weekdays, until };
  }

  // GET /api/events?from=2026-08-01&to=2026-08-31&isTask=1
  // GET /api/events?q=reunion
  // from/to e isTask son opcionales y combinables: from/to filtra por rango
  // de fecha (los eventos/tareas sin start_at nunca caen en un rango, asi
  // que quedan fuera si se pide un rango); isTask=1 solo tareas, isTask=0
  // solo eventos normales. Sin ningun filtro, devuelve todo.
  // "q" es para el buscador global del movil (Fase 5 del rediseño movil):
  // busca por titulo en TODOS los eventos/tareas, IGNORANDO from/to a
  // proposito -- Koku pidio "todos los eventos con ese texto", no solo los
  // del mes/rango que se este viendo en ese momento.
  router.get('/', (req, res) => {
    const { from, to, isTask, q } = req.query;
    const conditions = [];
    const params = [];
    if (q && q.trim()) {
      conditions.push('e.title LIKE ?');
      params.push(`%${q.trim()}%`);
    } else if (from && to) {
      // SOLAPE con el rango, no "empieza dentro del rango".
      //
      // Antes esto era 'start_at >= ? AND start_at <= ?', y por eso un
      // evento de varios dias solo salia el dia que empezaba: pidiendo
      // el viernes, un viaje que arranco el jueves no cumplia
      // start_at >= viernes 00:00 y desaparecia (lo vio Koku con un
      // "Viaje Mallorca" del 17 al 20: solo se veia el 17). Lo mismo
      // pasaba con un evento que viene del mes anterior.
      //
      // La condicion correcta es la de toda la vida para solapes: el
      // evento empieza antes de que acabe el rango Y acaba despues de
      // que empiece. COALESCE cubre a los que no tienen fin: ahi el
      // final es el propio inicio, o sea que se comportan igual que
      // antes. Los que no tienen start_at siguen fuera, porque NULL no
      // cumple ninguna comparacion.
      //
      // Los que SE REPITEN entran siempre, aunque su fila no solape con
      // el rango: la fila guardada es la PRIMERA vez, y lo que hay que
      // pintar son sus repeticiones, que pueden caer meses despues. Se
      // filtran luego, al calcularlas.
      conditions.push('((e.start_at <= ? AND COALESCE(e.end_at, e.start_at) >= ?) OR e.repeat_freq IS NOT NULL)');
      params.push(to, from);
    }
    if (isTask !== undefined) {
      conditions.push('e.is_task = ?');
      params.push(isTask === '1' || isTask === 'true' ? 1 : 0);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(`${SELECT_WITH_GROUP} ${where} ORDER BY e.start_at ASC`)
      .all(...params);

    // Sin rango (el buscador global, o pedir todo) NO se despliegan las
    // repeticiones: buscar "Gimnasio" tiene que devolver UN resultado,
    // no las doscientas veces que se repite.
    if (!(from && to) || (q && q.trim())) return res.json(rows.map(serialize));

    const salida = [];
    for (const row of rows) {
      const base = serialize(row);
      if (!base.repeat) {
        salida.push(base);
        continue;
      }
      for (const oc of repeticionesDeEvento(row, from, to)) {
        // Cada repeticion es el MISMO evento con otra fecha: conserva el
        // id de su fila (para poder abrirlo y editarlo) y añade de que
        // dia es, que es lo que hace falta para "solo esta vez".
        salida.push({ ...base, startAt: oc.startAt, endAt: oc.endAt, occurrenceDate: oc.occurrenceDate });
      }
    }
    salida.sort((a, b) => (String(a.startAt) < String(b.startAt) ? -1 : 1));
    res.json(salida);
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(serialize(row));
  });

  function resolveGroupId(groupId) {
    if (groupId === undefined || groupId === null || groupId === '') return null;
    const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
    return group ? group.id : null; // si mandan un id que no existe, lo ignoramos en vez de fallar
  }

  router.post('/', (req, res) => {
    const { title, description, location, startAt, endAt, allDay, reminderMinutesBefore, groupId, isTask, repeat } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'El evento necesita un titulo.' });
    }
    // Las tareas pueden no tener fecha (viven solo en la lista de Tareas);
    // los eventos normales si la necesitan, como siempre.
    if (!isTask && !startAt) {
      return res.status(400).json({ error: 'invalid_request', message: 'Falta la fecha/hora de inicio.' });
    }

    // "Creado por" se rellena con tu perfil en el momento de crear el
    // evento (ver server/db.js): una foto fija de tu nombre de entonces, no
    // un enlace en vivo a tu nickname actual.
    const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();

    // Una TAREA nunca se repite: no tiene hora y puede no tener ni
    // fecha, asi que una regla de repeticion ahi no significaria nada.
    const regla = isTask ? null : limpiarRepeticion(repeat);

    const info = db
      .prepare(`
        INSERT INTO events (title, description, location, start_at, end_at, all_day, reminder_minutes_before, group_id, created_by_name, created_by_id, is_task, repeat_freq, repeat_interval, repeat_weekdays, repeat_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        title.trim(),
        description || null,
        location || null,
        startAt || null,
        endAt || null,
        allDay ? 1 : 0,
        reminderMinutesBefore === undefined || reminderMinutesBefore === null ? null : Number(reminderMinutesBefore),
        resolveGroupId(groupId),
        profile && profile.name ? profile.name : null,
        profile ? profile.public_id : null,
        isTask ? 1 : 0,
        regla ? regla.freq : null,
        regla ? regla.interval : 1,
        regla && regla.weekdays.length ? JSON.stringify(regla.weekdays) : null,
        regla ? regla.until : null
      );

    const row = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(info.lastInsertRowid);
    const serialized = serialize(row);
    db.recordSyncChange('events', row.id, 'upsert', serialized, req.device ? req.device.id : null);
    res.status(201).json(serialized);
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { title, description, location, startAt, endAt, allDay, reminderMinutesBefore, groupId, isTask, done, repeat } = req.body || {};

    // "repeat" solo se toca si viene en el cuerpo: un PUT parcial (marcar
    // una tarea como hecha, por ejemplo) no puede cargarse la regla.
    const reglaNueva = repeat !== undefined ? limpiarRepeticion(repeat) : reglaDeRepeticion(existing);

    // Si cambia el recordatorio o el inicio, lo volvemos a "armar"
    // (reminder_sent = 0) para que pueda dispararse otra vez.
    const reminderChanged =
      reminderMinutesBefore !== undefined && Number(reminderMinutesBefore) !== existing.reminder_minutes_before;
    const startChanged = startAt !== undefined && startAt !== existing.start_at;

    db.prepare(`
      UPDATE events SET
        title = ?,
        description = ?,
        location = ?,
        start_at = ?,
        end_at = ?,
        all_day = ?,
        reminder_minutes_before = ?,
        reminder_sent = ?,
        group_id = ?,
        is_task = ?,
        done = ?,
        repeat_freq = ?,
        repeat_interval = ?,
        repeat_weekdays = ?,
        repeat_until = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title !== undefined ? title.trim() : existing.title,
      description !== undefined ? description : existing.description,
      location !== undefined ? location : existing.location,
      startAt !== undefined ? (startAt || null) : existing.start_at,
      endAt !== undefined ? endAt : existing.end_at,
      allDay !== undefined ? (allDay ? 1 : 0) : existing.all_day,
      reminderMinutesBefore !== undefined
        ? (reminderMinutesBefore === null ? null : Number(reminderMinutesBefore))
        : existing.reminder_minutes_before,
      reminderChanged || startChanged ? 0 : existing.reminder_sent,
      groupId !== undefined ? resolveGroupId(groupId) : existing.group_id,
      isTask !== undefined ? (isTask ? 1 : 0) : existing.is_task,
      done !== undefined ? (done ? 1 : 0) : existing.done,
      reglaNueva ? reglaNueva.freq : null,
      reglaNueva ? reglaNueva.interval : 1,
      reglaNueva && reglaNueva.weekdays.length ? JSON.stringify(reglaNueva.weekdays) : null,
      reglaNueva ? reglaNueva.until : null,
      req.params.id
    );

    const row = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(req.params.id);
    const serialized = serialize(row);
    db.recordSyncChange('events', row.id, 'upsert', serialized, req.device ? req.device.id : null);
    res.json(serialized);
  });

  router.delete('/:id', (req, res) => {
    // Borrar la serie entera se lleva tambien las repeticiones que se
    // hubieran soltado para cambiarlas por su cuenta: son parte de la
    // misma serie aunque vivan en su propia fila. A mano, porque en este
    // proyecto nunca se usa ON DELETE CASCADE de SQL.
    const sueltas = db.prepare('SELECT id FROM events WHERE repeat_parent_id = ?').all(req.params.id);
    const info = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    for (const s of sueltas) {
      db.prepare('DELETE FROM events WHERE id = ?').run(s.id);
      db.recordSyncChange('events', s.id, 'delete', null, req.device ? req.device.id : null);
    }
    db.recordSyncChange('events', req.params.id, 'delete', null, req.device ? req.device.id : null);
    res.status(204).end();
  });

  // Añade un dia a la lista de "no pintes esta repeticion".
  //
  // Lo usan las dos formas de tocar UNA sola vez de una serie: borrarla
  // (y ahi se queda) y editarla (que ademas crea una fila propia con los
  // cambios, ver /detach).
  function saltarDia(row, dia) {
    const saltados = diasSaltados(row);
    saltados.add(dia);
    db.prepare("UPDATE events SET repeat_skip = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify([...saltados]), row.id);
  }

  // POST /api/events/:id/skip  { date: 'YYYY-MM-DD' }
  // "Borrar solo esta vez".
  router.post('/:id/skip', (req, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const dia = (req.body || {}).date;
    if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Falta el dia de la repeticion.' });
    }
    if (!reglaDeRepeticion(row)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Ese evento no se repite.' });
    }
    saltarDia(row, dia);
    const actualizado = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(row.id);
    const serialized = serialize(actualizado);
    db.recordSyncChange('events', row.id, 'upsert', serialized, req.device ? req.device.id : null);
    res.json(serialized);
  });

  // POST /api/events/:id/detach  { date: 'YYYY-MM-DD', ...campos del evento }
  // "Editar solo esta vez": la repeticion de ese dia se saca de la serie
  // y pasa a ser un evento normal con los cambios; la serie deja de
  // pintar ese dia. A partir de ahi las dos son independientes, que es
  // lo que se espera al mover una cita suelta de sitio.
  router.post('/:id/detach', (req, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const { date, title, description, location, startAt, endAt, allDay, reminderMinutesBefore, groupId } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Falta el dia de la repeticion.' });
    }
    if (!reglaDeRepeticion(row)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Ese evento no se repite.' });
    }

    const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
    const info = db
      .prepare(`
        INSERT INTO events (title, description, location, start_at, end_at, all_day, reminder_minutes_before, group_id, created_by_name, created_by_id, is_task, repeat_parent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `)
      .run(
        (title !== undefined ? String(title) : row.title).trim() || row.title,
        description !== undefined ? description : row.description,
        location !== undefined ? location : row.location,
        startAt || null,
        endAt !== undefined ? endAt : null,
        allDay !== undefined ? (allDay ? 1 : 0) : row.all_day,
        reminderMinutesBefore === undefined
          ? row.reminder_minutes_before
          : (reminderMinutesBefore === null ? null : Number(reminderMinutesBefore)),
        groupId !== undefined ? resolveGroupId(groupId) : row.group_id,
        profile && profile.name ? profile.name : null,
        profile ? profile.public_id : null,
        row.id
      );

    saltarDia(row, date);

    const nueva = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(info.lastInsertRowid);
    const madre = db.prepare(`${SELECT_WITH_GROUP} WHERE e.id = ?`).get(row.id);
    const serializedNueva = serialize(nueva);
    db.recordSyncChange('events', nueva.id, 'upsert', serializedNueva, req.device ? req.device.id : null);
    db.recordSyncChange('events', row.id, 'upsert', serialize(madre), req.device ? req.device.id : null);
    res.status(201).json(serializedNueva);
  });

  mountLocalRouter('/api/events', router);

})();
