// recetasCarpetas — las carpetas de la App "Recetas".
//
// Ruta NUEVA, no un porte de server/routes/ (la App no existe en el
// programa de escritorio). Sigue el mismo patron que el resto: un IIFE
// para que los nombres no choquen al cargarse todas como <script> en el
// mismo ambito global.
//
// Es hermana de note_folders y se parece a proposito: se anidan, borrar
// una NUNCA borra lo que hay dentro (sube un nivel) y hay deteccion de
// ciclos. La diferencia es que aqui no hay icono por carpeta -- se
// quito esa opcion en Notas a proposito (el icono generico de carpeta ya
// distingue carpeta de receta) y no tiene sentido reintroducirla aqui.
(function () {
  const db = localDb;
  const router = createLocalRouter();

  function serialize(row) {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      position: row.position,
      parentId: row.parent_id,
      favorite: !!row.favorite,
      updatedAt: row.updated_at,
    };
  }

  // Una carpeta no puede ser su propia antepasada. Se sube por la cadena
  // de parent_id desde el candidato a padre; si en algun punto se llega
  // a folderId, ponerlo crearia un bucle. El Set es por si una base
  // importada de una copia viejisima ya trajera uno: mejor parar que
  // colgar la app dando vueltas.
  function haríaCiclo(folderId, candidatoPadreId) {
    let actual = candidatoPadreId;
    const vistos = new Set();
    while (actual !== null && actual !== undefined) {
      if (actual === folderId) return true;
      if (vistos.has(actual)) return true;
      vistos.add(actual);
      const row = db.prepare('SELECT parent_id FROM recetas_carpetas WHERE id = ?').get(actual);
      if (!row) return false;
      actual = row.parent_id;
    }
    return false;
  }

  // Devuelve el id del padre ya validado, o `undefined` para decir "esto
  // es invalido, rechaza la peticion". Apuntar a una carpeta que no
  // existe NO es un error: se trata como raiz.
  function resolverPadre(folderId, parentId) {
    if (parentId === undefined || parentId === null || parentId === '') return null;
    const num = Number(parentId);
    if (!Number.isFinite(num)) return null;
    if (num === folderId) return undefined;
    const existe = db.prepare('SELECT id FROM recetas_carpetas WHERE id = ?').get(num);
    if (!existe) return null;
    if (folderId !== null && haríaCiclo(folderId, num)) return undefined;
    return num;
  }

  function colorValido(color, porDefecto) {
    return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : porDefecto;
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM recetas_carpetas ORDER BY position ASC, id ASC').all();
    res.json(rows.map(serialize));
  });

  function insertarCarpeta({ name, color, parentId, favorite }) {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM recetas_carpetas').get();
    const info = db
      .prepare("INSERT INTO recetas_carpetas (name, color, position, parent_id, favorite, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .run(name, color, count, parentId ?? null, favorite ? 1 : 0);
    return db.prepare('SELECT * FROM recetas_carpetas WHERE id = ?').get(info.lastInsertRowid);
  }

  router.post('/', (req, res) => {
    const { name, color, parentId, favorite } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'La carpeta necesita un nombre.' });
    }
    // Al crear todavia no hay id, asi que un ciclo es imposible: solo
    // hace falta comprobar que el padre exista.
    const padre = resolverPadre(null, parentId);
    const row = insertarCarpeta({
      name: String(name).trim().slice(0, 120),
      color: colorValido(color, '#5b8cff'),
      parentId: padre ?? null,
      favorite,
    });
    res.status(201).json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existente = db.prepare('SELECT * FROM recetas_carpetas WHERE id = ?').get(req.params.id);
    if (!existente) return res.status(404).json({ error: 'not_found' });

    const { name, color, parentId, favorite } = req.body || {};
    let nuevoPadre = existente.parent_id;
    if (parentId !== undefined) {
      const resuelto = resolverPadre(existente.id, parentId);
      if (resuelto === undefined) {
        return res.status(400).json({ error: 'invalid_request', message: 'Esa carpeta no puede ir dentro de sí misma.' });
      }
      nuevoPadre = resuelto;
    }

    db.prepare("UPDATE recetas_carpetas SET name = ?, color = ?, parent_id = ?, favorite = ?, updated_at = datetime('now') WHERE id = ?").run(
      name !== undefined && String(name).trim() ? String(name).trim().slice(0, 120) : existente.name,
      colorValido(color, existente.color),
      nuevoPadre,
      favorite !== undefined ? (favorite ? 1 : 0) : existente.favorite,
      req.params.id,
    );
    res.json(serialize(db.prepare('SELECT * FROM recetas_carpetas WHERE id = ?').get(req.params.id)));
  });

  // -------------------------------------------------------------------
  // DUPLICAR
  // -------------------------------------------------------------------
  // Con ?withContents=1 se lleva lo de dentro (recetas y subcarpetas,
  // hasta el fondo). SOLO SE RENOMBRA LA CARPETA QUE DUPLICAS: lo de
  // dentro conserva su nombre, igual que en Notas -- si no, una carpeta
  // con 40 recetas saldria con 40 nombres acabados en "_copia".
  function copiarContenido(origenId, destinoId, profundidad) {
    if (profundidad > 40) return;
    db.prepare('SELECT id FROM recetas WHERE folder_id = ?').all(origenId).forEach((r) => {
      // duplicarRecetaLocal y no un INSERT a mano: es lo unico que
      // estrena el uuid de la foto, y sin eso borrar una de las dos
      // recetas se llevaria la foto de la otra.
      if (typeof window.duplicarRecetaLocal === 'function') {
        window.duplicarRecetaLocal({ id: r.id, folderId: destinoId, renombrar: false });
      }
    });
    db.prepare('SELECT * FROM recetas_carpetas WHERE parent_id = ?').all(origenId).forEach((sub) => {
      const copia = insertarCarpeta({
        name: sub.name,
        color: sub.color,
        parentId: destinoId,
        favorite: sub.favorite,
      });
      copiarContenido(sub.id, copia.id, profundidad + 1);
    });
  }

  router.post('/:id/duplicate', (req, res) => {
    const original = db.prepare('SELECT * FROM recetas_carpetas WHERE id = ?').get(req.params.id);
    if (!original) return res.status(404).json({ error: 'not_found' });

    // Los nombres con los que no puede chocar son los de sus HERMANAS,
    // las del mismo nivel, no las de toda la App.
    const hermanas = original.parent_id === null
      ? db.prepare('SELECT name FROM recetas_carpetas WHERE parent_id IS NULL').all()
      : db.prepare('SELECT name FROM recetas_carpetas WHERE parent_id = ?').all(original.parent_id);

    const copia = insertarCarpeta({
      name: nombreDeCopia(original.name, hermanas.map((h) => h.name)),
      color: original.color,
      parentId: original.parent_id,
      favorite: original.favorite,
    });
    if (req.query.withContents === '1') copiarContenido(original.id, copia.id, 0);
    res.status(201).json(serialize(copia));
  });

  router.delete('/:id', (req, res) => {
    const existente = db.prepare('SELECT * FROM recetas_carpetas WHERE id = ?').get(req.params.id);
    if (!existente) return res.status(404).json({ error: 'not_found' });

    if (String(req.query.deleteContents) === '1') {
      // De abajo a arriba, para que nada quede huerfano si algo fallara
      // a mitad.
      const borrar = (folderId) => {
        db.prepare('SELECT id FROM recetas_carpetas WHERE parent_id = ?').all(folderId).forEach((h) => borrar(h.id));
        db.prepare('SELECT id FROM recetas WHERE folder_id = ?').all(folderId).forEach((r) => {
          if (typeof window.borrarRecetaLocal === 'function') window.borrarRecetaLocal(r.id);
        });
        db.prepare('DELETE FROM recetas_carpetas WHERE id = ?').run(folderId);
      };
      borrar(existente.id);
      return res.status(204).end();
    }

    // Lo de dentro NO se borra: sube UN nivel, al padre de la carpeta
    // que se va (o a la raiz si no tenia). Es quitar una carpeta de en
    // medio del arbol y que sus hijas ocupen su sitio.
    db.prepare('UPDATE recetas SET folder_id = ? WHERE folder_id = ?').run(existente.parent_id, req.params.id);
    db.prepare('UPDATE recetas_carpetas SET parent_id = ? WHERE parent_id = ?').run(existente.parent_id, req.params.id);
    db.prepare('DELETE FROM recetas_carpetas WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  mountLocalRouter('/api/recetas-carpetas', router);
})();
