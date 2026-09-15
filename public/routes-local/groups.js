// groups — portado de server/routes/groups.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/groups.js — listas/grupos de recordatorios, al estilo "Listas" de
  // Recordatorios de iPhone: un nombre, un color y (opcional) un icono
  // (simbolo o emoji) que luego se refleja en cada evento de ese grupo.

  const router = createLocalRouter();

  function sanitizeIcon(icon) {
    if (icon === undefined) return undefined; // "no lo toques"
    if (icon === null || icon === '') return null; // "quitalo"
    // Los emoji compuestos (con modificador de tono de piel, banderas,
    // familias con ZWJ...) pueden ocupar varios "caracteres" de JS. Un
    // limite generoso de 8 evita que alguien pegue un parrafo entero aqui
    // sin bloquear emoji legitimos algo mas largos.
    return String(icon).slice(0, 8);
  }

  function serialize(row) {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      icon: row.icon || null,
      position: row.position,
      completedColor: row.completed_color || null,
      updatedAt: row.updated_at,
    };
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM groups ORDER BY position ASC, id ASC').all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const { name, color, icon, completedColor } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'El grupo necesita un nombre.' });
    }
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';
    const safeCompletedColor = /^#[0-9a-fA-F]{6}$/.test(completedColor || '') ? completedColor : null;

    const { count } = db.prepare('SELECT COUNT(*) as count FROM groups').get();
    const info = db
      .prepare("INSERT INTO groups (name, color, icon, position, completed_color, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .run(name.trim(), safeColor, sanitizeIcon(icon) ?? null, count, safeCompletedColor);

    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid);
    const serialized = serialize(row);
    db.recordSyncChange('groups', row.id, 'upsert', serialized, req.device ? req.device.id : null);
    res.status(201).json(serialized);
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { name, color, icon, completedColor } = req.body || {};
    const safeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;
    const sanitizedIcon = sanitizeIcon(icon);
    // completedColor: undefined = "no lo toques", null/'' = "quitalo", si no
    // es un hex valido se ignora y se conserva el que hubiera.
    const safeCompletedColor =
      completedColor === undefined
        ? existing.completed_color
        : (completedColor === null || completedColor === '')
          ? null
          : (/^#[0-9a-fA-F]{6}$/.test(completedColor) ? completedColor : existing.completed_color);

    db.prepare("UPDATE groups SET name = ?, color = ?, icon = ?, completed_color = ?, updated_at = datetime('now') WHERE id = ?").run(
      name !== undefined && name.trim() ? name.trim() : existing.name,
      safeColor,
      sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
      safeCompletedColor,
      req.params.id
    );

    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
    const serialized = serialize(row);
    db.recordSyncChange('groups', row.id, 'upsert', serialized, req.device ? req.device.id : null);
    res.json(serialized);
  });

  router.delete('/:id', (req, res) => {
    // Los eventos de este grupo no se borran: simplemente se quedan sin
    // grupo (group_id a NULL), igual que al borrar una lista en Recordatorios
    // no se borran los recordatorios que contenia sin mas. Para sincronizar,
    // esos eventos TAMBIEN cambiaron (perdieron el group_id) -- si no se
    // avisa de eso, un movil que sincronice mas tarde se quedaria con el
    // group_id viejo, apuntando a un grupo que ya no existe.
    const originId = req.device ? req.device.id : null;
    const affectedEventIds = db.prepare('SELECT id FROM events WHERE group_id = ?').all(req.params.id).map((r) => r.id);
    db.prepare('UPDATE events SET group_id = NULL WHERE group_id = ?').run(req.params.id);
    const info = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    db.recordSyncChange('groups', req.params.id, 'delete', null, originId);
    affectedEventIds.forEach((id) => {
      const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
      if (!row) return; // por si tambien se borro en el mismo instante
      db.recordSyncChange('events', row.id, 'upsert', {
        id: row.id,
        title: row.title,
        description: row.description,
        location: row.location,
        startAt: row.start_at,
        endAt: row.end_at,
        allDay: !!row.all_day,
        reminderMinutesBefore: row.reminder_minutes_before,
        groupId: row.group_id,
        groupName: null,
        groupColor: null,
        groupIcon: null,
        groupCompletedColor: null,
        isTask: !!row.is_task,
        done: !!row.done,
        createdByName: row.created_by_name || null,
        createdByPublicId: row.created_by_id || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }, originId);
    });
    res.status(204).end();
  });

  mountLocalRouter('/api/groups', router);

})();
