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

    const { title, type, description, rating, status, genres, progressCurrent, progressTotal, progressUnit, ownedCount, ownedTotal, loaned, loanedTo, loanedAt, cover } = req.body || {};
    if (type !== undefined && !TYPES.includes(type)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Tipo invalido.' });
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
        title = ?, type = ?, description = ?, rating = ?, status = ?, genres = ?,
        progress_current = ?, progress_total = ?, progress_unit = ?,
        owned_count = ?, owned_total = ?, loaned = ?, loaned_to = ?, loaned_at = ?,
        cover = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
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
    res.json(serialize(row));
  });

  router.delete('/:id', (req, res) => {
    const info = db.prepare('DELETE FROM entretenimiento_items WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  mountLocalRouter('/api/entretenimiento-items', router);

})();
