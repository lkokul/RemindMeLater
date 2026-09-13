// horario — el horario semanal fijo (clases, turnos, gimnasio).
//
// Ruta NUEVA de la app sin servidor, no un porte de server/routes/: el
// horario nacio aqui.
//
// Lo que lo distingue de un evento que se repite: un horario NO tiene
// fecha. No empieza un dia concreto ni acaba nunca, y no se pinta en el
// calendario -- se mira entero, de un vistazo, en su propia pantalla.
// Por eso es una tabla aparte y no filas de events con una regla de
// repeticion: metido en el calendario, cada semana se llenaria de las
// mismas seis clases y taparia lo que de verdad pasa ese dia.
(function () {
  const db = localDb;

  const router = createLocalRouter();

  // Igual que los eventos: el grupo se trae con LEFT JOIN para heredar su
  // color, y LEFT para que los bloques sin grupo salgan igual.
  const SELECT_WITH_GROUP = `
    SELECT h.*, g.name AS group_name, g.color AS group_color, g.icon AS group_icon
    FROM horario_bloques h
    LEFT JOIN groups g ON g.id = h.group_id
  `;

  function serialize(row) {
    return {
      id: row.id,
      title: row.title,
      weekday: row.weekday,
      startMin: row.start_min,
      endMin: row.end_min,
      location: row.location || null,
      groupId: row.group_id,
      groupName: row.group_name || null,
      groupColor: row.group_color || null,
      groupIcon: row.group_icon || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function resolveGroupId(groupId) {
    if (groupId === undefined || groupId === null || groupId === '') return null;
    const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
    return group ? group.id : null;
  }

  // Devuelve { title, weekday, startMin, endMin, location, groupId } ya
  // limpio, o una cadena con el motivo si algo no cuadra. Se valida aqui
  // y no solo en la pantalla porque la base es lo ultimo que queda entre
  // un dato raro y una rejilla rota.
  function limpiarBloque(body) {
    const b = body || {};
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title) return 'El bloque necesita un titulo.';
    const weekday = Number(b.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return 'Ese dia de la semana no existe.';
    const startMin = Number(b.startMin);
    const endMin = Number(b.endMin);
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return 'Faltan las horas.';
    if (startMin < 0 || startMin > 1439 || endMin < 1 || endMin > 1440) return 'Esas horas no son validas.';
    // Un bloque que acaba antes de empezar no se puede pintar. Se rechaza
    // en vez de darle la vuelta en silencio: si te has equivocado al
    // escribir, prefieres enterarte.
    if (endMin <= startMin) return 'La hora de fin tiene que ser posterior a la de inicio.';
    return {
      title,
      weekday,
      startMin: Math.round(startMin),
      endMin: Math.round(endMin),
      location: typeof b.location === 'string' && b.location.trim() ? b.location.trim() : null,
      groupId: resolveGroupId(b.groupId),
    };
  }

  // GET /api/horario — todos los bloques, ya ordenados como se leen: por
  // dia y, dentro del dia, por hora.
  router.get('/', (req, res) => {
    const rows = db.prepare(`${SELECT_WITH_GROUP} ORDER BY h.weekday ASC, h.start_min ASC`).all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const limpio = limpiarBloque(req.body);
    if (typeof limpio === 'string') return res.status(400).json({ error: 'invalid_request', message: limpio });
    const info = db
      .prepare(`
        INSERT INTO horario_bloques (title, weekday, start_min, end_min, location, group_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(limpio.title, limpio.weekday, limpio.startMin, limpio.endMin, limpio.location, limpio.groupId);
    const row = db.prepare(`${SELECT_WITH_GROUP} WHERE h.id = ?`).get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM horario_bloques WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const limpio = limpiarBloque(req.body);
    if (typeof limpio === 'string') return res.status(400).json({ error: 'invalid_request', message: limpio });
    db.prepare(`
      UPDATE horario_bloques SET
        title = ?, weekday = ?, start_min = ?, end_min = ?, location = ?, group_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(limpio.title, limpio.weekday, limpio.startMin, limpio.endMin, limpio.location, limpio.groupId, req.params.id);
    const row = db.prepare(`${SELECT_WITH_GROUP} WHERE h.id = ?`).get(req.params.id);
    res.json(serialize(row));
  });

  router.delete('/:id', (req, res) => {
    const info = db.prepare('DELETE FROM horario_bloques WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  mountLocalRouter('/api/horario', router);

})();
