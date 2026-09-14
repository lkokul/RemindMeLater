// entretenimientoItems — portado de server/routes/entretenimientoItems.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/entretenimientoItems.js — cada cosa concreta dentro de una saga de
  // Entretenimiento (una temporada, un tomo, una pelicula suelta...). Siempre
  // pertenece a una saga (sagaId obligatorio, ver routes/entretenimientoSagas.js
  // -- las sagas son el contenedor obligatorio de todo, confirmado con
  // Koku).

  const router = createLocalRouter();
  // Los tipos que se admiten. ESTA lista es ahora la unica autoridad: la
  // columna "type" de la base ya NO lleva CHECK (ver el comentario en
  // local-schema.js), asi que añadir un tipo nuevo el dia de mañana es
  // añadirlo aqui y en ENTRETENIMIENTO_TYPE_LABELS de app.js, sin migracion
  // ni reconstruir ninguna tabla.
  //
  // Los 6 primeros son los de siempre (cuando esto se llamaba "Lecturas");
  // los 4 de abajo se añadieron al pasar a llamarse "Entretenimiento",
  // porque el nombre ya no promete solo libros.
  const TYPES = [
    'manga', 'comic', 'libro', 'serie', 'anime', 'pelicula',
    'videojuego', 'podcast', 'musica', 'otro',
  ];
  const STATUSES = ['wishlist', 'in_progress', 'completed', 'dropped'];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Generos como array JSON de texto libre (no una tabla aparte, ver el
  // comentario de entretenimiento_items en server/db.js) -- aqui se sanea:
  // recorta espacios, quita vacios y duplicados, limite generoso de 20
  // por item para que no se cuele un pegado accidental de un parrafo.
  function sanitizeGenres(genres) {
    if (!Array.isArray(genres)) return [];
    const seen = new Set();
    const clean = [];
    for (const g of genres) {
      const trimmed = String(g || '').trim();
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
      seen.add(trimmed.toLowerCase());
      clean.push(trimmed.slice(0, 40));
      if (clean.length >= 20) break;
    }
    return clean;
  }

  // Portada: solo se admite una RUTA del almacen de imagenes que ya existe
  // (el mismo de las notas), nunca una URL de fuera ni datos incrustados.
  // Asi la portada se comporta igual que una imagen de nota: los bytes
  // viven en IndexedDB y resolveAssetUrl() la convierte en blob: al
  // pintarla. Cualquier otra cosa se guarda como NULL en vez de rechazar la
  // peticion entera -- perder la portada no debe impedir guardar el item.
  const COVER_RE = /^\/api\/notes\/images\/[A-Za-z0-9._-]+$/;
  function sanitizeCover(cover) {
    if (typeof cover !== 'string') return null;
    const trimmed = cover.trim();
    return COVER_RE.test(trimmed) ? trimmed : null;
  }

  // Fecha LOCAL del dispositivo, no UTC: a las 00:30 en Espana
  // toISOString() todavia devuelve el dia de ayer, y la racha se quedaria
  // un dia atras. Mismo cuidado que hoyISO() del ciclo del Gimnasio.
  function hoyLocal() {
    const d = new Date();
    const dos = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  }

  // Apunta que hoy has avanzado en este item. La llama el PUT cuando ve
  // que el progreso SUBE -- no hay forma de crear una sesion a mano desde
  // la interfaz, a proposito: Koku eligio que no hubiera ningun gesto
  // nuevo que aprender.
  //
  // Solo cuenta SUBIR. Corregir un despiste hacia atras (ibas por el 15 y
  // pones 12) no es haber visto nada, asi que no apunta nada.
  function apuntarSesion(item, desde, hasta) {
    db.prepare(`
      INSERT INTO entretenimiento_sesiones
        (item_id, vuelta, fecha, progreso_desde, progreso_hasta, unidad)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(item.id, item.vuelta || 1, hoyLocal(), desde, hasta, item.progress_unit || null);
  }

  function serialize(row) {
    return {
      id: row.id,
      sagaId: row.saga_id,
      title: row.title,
      type: row.type,
      description: row.description,
      rating: row.rating,
      status: row.status,
      genres: row.genres ? JSON.parse(row.genres) : [],
      progressCurrent: row.progress_current,
      progressTotal: row.progress_total,
      progressUnit: row.progress_unit,
      ownedCount: row.owned_count,
      ownedTotal: row.owned_total,
      loaned: !!row.loaned,
      loanedTo: row.loaned_to,
      loanedAt: row.loaned_at,
      cover: row.cover,
      vuelta: row.vuelta || 1,
    };
  }

  // Sin sagaId: devuelve TODOS los items (con el nombre de su saga, para
  // una futura vista cruzada tipo "todo lo que tengo en Deseado" sin
  // entrar saga a saga -- todavia no pedida en detalle, pero el endpoint
  // ya la deja lista sin coste extra). Con sagaId: solo los de esa saga,
  // que es el uso normal desde el detalle de una saga.
  router.get('/', (req, res) => {
    const { sagaId } = req.query;
    const rows = sagaId
      ? db.prepare('SELECT * FROM entretenimiento_items WHERE saga_id = ? ORDER BY position ASC, id ASC').all(sagaId)
      : db.prepare('SELECT * FROM entretenimiento_items ORDER BY saga_id ASC, position ASC, id ASC').all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const { sagaId, title, type, description, rating, status, genres, progressCurrent, progressTotal, progressUnit, ownedCount, ownedTotal, loaned, loanedTo, loanedAt, cover } = req.body || {};
    if (!sagaId || !db.prepare('SELECT id FROM entretenimiento_sagas WHERE id = ?').get(sagaId)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Falta la saga a la que pertenece.' });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'El item necesita un titulo.' });
    }
    if (!TYPES.includes(type)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Tipo invalido.' });
    }
    const safeStatus = STATUSES.includes(status) ? status : 'wishlist';
    const safeRating = rating === undefined || rating === null || rating === '' ? null : Math.max(0, Math.min(10, Number(rating)));
    // "Prestado": interruptor + a quien + desde cuando (opcional) -- ver
    // comentario junto a entretenimiento_items en db.js. Sin fecha valida, se
    // guarda NULL en vez de rechazar la peticion (la fecha es opcional).
    const safeLoaned = loaned ? 1 : 0;
    const safeLoanedTo = safeLoaned && typeof loanedTo === 'string' && loanedTo.trim() ? loanedTo.trim() : null;
    const safeLoanedAt = safeLoaned && loanedAt && DATE_RE.test(loanedAt) ? loanedAt : null;

    const { count } = db.prepare('SELECT COUNT(*) as count FROM entretenimiento_items WHERE saga_id = ?').get(sagaId);
    const info = db
      .prepare(`
        INSERT INTO entretenimiento_items
          (saga_id, title, type, description, rating, status, genres, progress_current, progress_total, progress_unit, owned_count, owned_total, position, loaned, loaned_to, loaned_at, cover)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        sagaId,
        title.trim(),
        type,
        description && description.trim() ? description.trim() : null,
        safeRating,
        safeStatus,
        JSON.stringify(sanitizeGenres(genres)),
        progressCurrent === undefined || progressCurrent === null || progressCurrent === '' ? null : Number(progressCurrent),
        progressTotal === undefined || progressTotal === null || progressTotal === '' ? null : Number(progressTotal),
        progressUnit && progressUnit.trim() ? progressUnit.trim() : null,
        ownedCount === undefined || ownedCount === null || ownedCount === '' ? null : Number(ownedCount),
        ownedTotal === undefined || ownedTotal === null || ownedTotal === '' ? null : Number(ownedTotal),
        count,
        safeLoaned,
        safeLoanedTo,
        safeLoanedAt,
        sanitizeCover(cover)
      );

    const row = db.prepare('SELECT * FROM entretenimiento_items WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM entretenimiento_items WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { sagaId, title, type, description, rating, status, genres, progressCurrent, progressTotal, progressUnit, ownedCount, ownedTotal, loaned, loanedTo, loanedAt, cover } = req.body || {};
    if (type !== undefined && !TYPES.includes(type)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Tipo invalido.' });
    }
    // Mover el item a OTRA saga. Antes no se podia: el sagaId solo se
    // miraba al crear, asi que un item se quedaba para siempre donde
    // nacio. Hace falta desde que se puede anadir un item sin estar
    // dentro de una saga (pestanas Siguiendo/Deseos/Historial).
    // Se comprueba que la saga destino EXISTA -- si no, la fila quedaria
    // apuntando a una saga fantasma y no la veria nadie nunca mas.
    if (sagaId !== undefined && !db.prepare('SELECT id FROM entretenimiento_sagas WHERE id = ?').get(sagaId)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Esa saga no existe.' });
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Estado invalido.' });
    }

    const nn = (value, existingValue, isNumber) => {
      if (value === undefined) return existingValue;
      if (value === null || value === '') return null;
      return isNumber ? Number(value) : value;
    };

    const safeLoaned = loaned === undefined ? existing.loaned : (loaned ? 1 : 0);
    // Desmarcar "prestado" limpia a quien/desde cuando -- no tiene sentido
    // conservar el nombre de quien ya no lo tiene prestado (Koku no pidio
    // un historial, solo el estado actual).
    const safeLoanedTo = !safeLoaned
      ? null
      : loanedTo !== undefined
        ? (typeof loanedTo === 'string' && loanedTo.trim() ? loanedTo.trim() : null)
        : existing.loaned_to;
    const safeLoanedAt = !safeLoaned
      ? null
      : loanedAt !== undefined
        ? (loanedAt && DATE_RE.test(loanedAt) ? loanedAt : null)
        : existing.loaned_at;

    // Portada: no mandarla = dejarla como estaba; mandarla vacia o null =
    // quitarla. Mismo criterio que el resto de campos opcionales de aqui.
    const safeCover = cover === undefined
      ? existing.cover
      : (cover === null || cover === '' ? null : sanitizeCover(cover));

    db.prepare(`
      UPDATE entretenimiento_items SET
        saga_id = ?,
        title = ?, type = ?, description = ?, rating = ?, status = ?, genres = ?,
        progress_current = ?, progress_total = ?, progress_unit = ?,
        owned_count = ?, owned_total = ?, loaned = ?, loaned_to = ?, loaned_at = ?,
        cover = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      sagaId !== undefined ? sagaId : existing.saga_id,
      title !== undefined && title.trim() ? title.trim() : existing.title,
      type !== undefined ? type : existing.type,
      nn(description, existing.description, false),
      rating === undefined ? existing.rating : (rating === null || rating === '' ? null : Math.max(0, Math.min(10, Number(rating)))),
      status !== undefined ? status : existing.status,
      genres !== undefined ? JSON.stringify(sanitizeGenres(genres)) : existing.genres,
      nn(progressCurrent, existing.progress_current, true),
      nn(progressTotal, existing.progress_total, true),
      nn(progressUnit, existing.progress_unit, false),
      nn(ownedCount, existing.owned_count, true),
      nn(ownedTotal, existing.owned_total, true),
      safeLoaned,
      safeLoanedTo,
      safeLoanedAt,
      safeCover,
      req.params.id
    );

    const row = db.prepare('SELECT * FROM entretenimiento_items WHERE id = ?').get(req.params.id);

    // Y AQUI nace la sesion, despues de guardar: si el progreso ha subido,
    // queda apuntado que hoy avanzaste. Va al final a proposito, cuando ya
    // se sabe que el guardado salio bien -- apuntarla antes dejaria una
    // sesion de algo que no llego a cambiarse.
    const antes = existing.progress_current;
    const ahora = row.progress_current;
    if (ahora !== null && ahora !== undefined && (antes === null || antes === undefined || ahora > antes)) {
      // Sin valor anterior se cuenta desde 0: acabas de estrenar el
      // contador, asi que todo lo que marcas es avance de hoy.
      const desde = antes === null || antes === undefined ? 0 : antes;
      if (ahora > desde) apuntarSesion(row, desde, ahora);
    }

    res.json(serialize(row));
  });

  // Volver a empezar: una relectura o un revisionado NO pisa lo anterior.
  // Sube la vuelta, pone el progreso a cero y lo deja en marcha; las
  // sesiones de la vuelta anterior se quedan con su numero y siguen
  // contando para el mapa y la racha (pasaron de verdad).
  //
  // La nota se conserva a proposito: sigue siendo tu opinion de la obra.
  router.post('/:id/nueva-vuelta', (req, res) => {
    const existing = db.prepare('SELECT * FROM entretenimiento_items WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    db.prepare(`
      UPDATE entretenimiento_items
      SET vuelta = vuelta + 1, progress_current = 0, status = 'in_progress',
          updated_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id);

    const row = db.prepare('SELECT * FROM entretenimiento_items WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  router.delete('/:id', (req, res) => {
    // Cascada A MANO, como en toda la app (nunca ON DELETE CASCADE de
    // SQL): sin esto quedarian sesiones apuntando a un item que ya no
    // existe, y el resumen las contaria igual.
    db.prepare('DELETE FROM entretenimiento_sesiones WHERE item_id = ?').run(req.params.id);
    const info = db.prepare('DELETE FROM entretenimiento_items WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  mountLocalRouter('/api/entretenimiento-items', router);

})();
