// recetas — el plato en si: nombre, foto, tiempos, raciones, etiquetas,
// ingredientes y pasos.
//
// Ruta NUEVA (no un porte de server/routes/). Tres cosas que conviene
// tener claras antes de tocar nada:
//
//  1. LAS RACIONES QUE SE GUARDAN SON LAS DE LA RECETA, nunca las
//     escaladas. Escalar ("esta receta es para 2, la quiero para 4") es
//     algo que se pide al MIRARLA o al meterla en la compra, y se
//     calcula al vuelo. Si se guardara escalada, la receta cambiaria
//     cada vez que cocinas para otro numero de gente.
//  2. LOS INGREDIENTES SON FICHAS, no texto. Una linea apunta a
//     recetas_ingredientes por su id; el nombre sale de ahi. Ver
//     routes-local/recetasIngredientes.js.
//  3. LOS PASOS SON HTML Y SE SANEAN CON EL SANEADOR DE LAS NOTAS, la
//     misma funcion (window.sanearHtmlDeNota), no una copia: dos
//     saneadores se separan con el tiempo y el que se quede corto es el
//     agujero. Y se vuelven a sanear al PINTARLOS en el cliente, por lo
//     mismo que las notas -- importar una copia de seguridad sustituye
//     el .sqlite entero y sus filas nunca pasan por aqui.
(function () {
  const db = localDb;
  const router = createLocalRouter();

  const DIFICULTADES = ['facil', 'media', 'dificil'];
  const TIPOS = ['desayuno', 'entrante', 'principal', 'guarnicion', 'postre', 'snack', 'bebida'];

  // Igual que los generos de Lecturas: array JSON de texto libre, no una
  // tabla N:M. Para una coleccion personal, normalizarlo no aporta nada
  // y complica cada consulta.
  function limpiarEtiquetas(etiquetas) {
    if (!Array.isArray(etiquetas)) return [];
    const vistas = new Set();
    const limpias = [];
    for (const e of etiquetas) {
      const t = String(e || '').trim();
      if (!t || vistas.has(t.toLowerCase())) continue;
      vistas.add(t.toLowerCase());
      limpias.push(t.slice(0, 30));
      if (limpias.length >= 20) break;
    }
    return limpias;
  }

  function numeroOpcional(v, { min = 0, max = 100000 } = {}) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(min, Math.min(max, n));
  }

  // Las raciones son la BASE con la que escala todo, asi que no pueden
  // ser 0 ni negativas: dividir por ellas daria infinito o cantidades en
  // negativo. Sin valor valido se vuelve a 1, que es lo unico que nunca
  // rompe una regla de tres.
  function racionesValidas(v, porDefecto) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return porDefecto;
    return Math.min(999, n);
  }

  function textoOpcional(v, max) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t ? t.slice(0, max) : null;
  }

  // La foto es una ruta corta a una imagen ya subida a esta misma app
  // (/api/notes/images/<uuid>.<ext>). Se comprueba el prefijo por lo
  // mismo que lo comprueba el saneador de notas con un <img src>: asi no
  // puede acabar ahi un "data:" ni un servidor de fuera, que en esta app
  // seria la unica peticion de red que existe.
  function fotoValida(v) {
    if (v === undefined || v === null || v === '') return null;
    const s = String(v);
    return /^\/api\/notes\/images\/[a-zA-Z0-9._-]+$/.test(s) ? s : null;
  }

  function borrarFoto(foto) {
    if (!foto) return;
    const nombre = foto.slice(foto.lastIndexOf('/') + 1);
    // Best-effort y sin esperar, igual que las imagenes de una nota: que
    // no se puedan borrar los bytes no puede impedir borrar la receta.
    assetDelete(nombre).catch(() => {});
  }

  // La copia estrena uuid de foto. Es lo unico que impide una perdida de
  // datos de verdad: compartiendo la ruta, borrar CUALQUIERA de las dos
  // recetas se llevaria los bytes y dejaria a la otra con la foto rota.
  // El nombre se calcula aqui (sincrono, que es lo que hace falta para
  // devolver la fila ya) y los bytes se copian en segundo plano.
  function duplicarFoto(foto) {
    if (!foto) return null;
    const nombre = foto.slice(foto.lastIndexOf('/') + 1);
    const punto = nombre.lastIndexOf('.');
    const ext = punto > 0 ? nombre.slice(punto) : '';
    const nuevo = `${crypto.randomUUID()}${ext}`;
    assetGet(nombre)
      .then((fila) => (fila ? assetPut(nuevo, fila.bytes, fila.type) : null))
      .catch(() => {});
    return `/api/notes/images/${nuevo}`;
  }

  // -------------------------------------------------------------------
  // NUTRICION DE UNA RECETA
  // -------------------------------------------------------------------
  //
  // Se calcula AQUI y no en la pantalla para que solo haya una cuenta:
  // la ficha, y manana un widget o la compra, tienen que decir lo mismo
  // del mismo plato.
  //
  // Regla que eligio Koku: se suma lo que se sabe y se AVISA de lo que
  // no. La cifra es un suelo, no una promesa -- mismo criterio que el
  // tiempo estimado del Gimnasio, que solo cuenta los ejercicios de los
  // que tiene historial. Nunca se rellena un hueco con un cero: un cero
  // parece un dato bueno y hundiria el total sin que se notara.
  const CAMPOS_NUTRI = ['kcal', 'proteinas', 'grasas', 'saturadas', 'hidratos', 'azucares', 'fibra', 'sal'];

  // Lo que pesa una linea, llevado a la base de 100 en la que estan los
  // valores del ingrediente. Devuelve null cuando no se puede saber, que
  // es lo que hace que ese ingrediente quede fuera EN VEZ de contar mal.
  function gramosDeLinea(linea, ing) {
    if (linea.cantidad === null || linea.cantidad === undefined) return null; // "sal al gusto"
    const u = String(linea.unidad || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Masa y volumen se tratan igual a proposito: la etiqueta de un
    // aceite viene "por 100 ml" y la receta lo mide en ml, asi que las
    // dos hablan de la misma base sin necesidad de saber la densidad.
    if (['g', 'gr', 'gramo', 'gramos', 'ml', 'cc'].includes(u)) return linea.cantidad;
    if (['kg', 'kilo', 'kilos', 'l', 'litro', 'litros'].includes(u)) return linea.cantidad * 1000;
    // Cualquier otra cosa (ud, diente, cucharada, o sin unidad) solo
    // cuenta si se sabe lo que pesa una.
    const porUnidad = Number(ing.gramos_por_unidad);
    if (Number.isFinite(porUnidad) && porUnidad > 0) return linea.cantidad * porUnidad;
    return null;
  }

  function nutricionDe(recetaId) {
    const filas = db
      .prepare(`SELECT l.*, i.name AS ing_nombre, i.gramos_por_unidad, i.kcal, i.proteinas, i.grasas,
                       i.saturadas, i.hidratos, i.azucares, i.fibra, i.sal
                FROM recetas_lineas l
                LEFT JOIN recetas_ingredientes i ON i.id = l.ingrediente_id
                WHERE l.receta_id = ?`)
      .all(recetaId);

    const total = {};
    CAMPOS_NUTRI.forEach((c) => { total[c] = null; });
    let contados = 0;
    const sinContar = [];

    for (const f of filas) {
      if (!f.ing_nombre) continue; // el ingrediente ya no existe
      const tieneAlgo = CAMPOS_NUTRI.some((c) => f[c] !== null && f[c] !== undefined);
      const gramos = gramosDeLinea(f, f);
      if (!tieneAlgo || gramos === null) {
        // Un ingrediente OPCIONAL que no cuenta no se avisa: no estropea
        // el total de un plato que puede no llevarlo.
        if (!f.opcional) sinContar.push(f.ing_nombre);
        continue;
      }
      contados += 1;
      const factor = gramos / 100;
      CAMPOS_NUTRI.forEach((c) => {
        if (f[c] === null || f[c] === undefined) return;
        total[c] = (total[c] || 0) + f[c] * factor;
      });
    }

    CAMPOS_NUTRI.forEach((c) => {
      if (total[c] !== null) total[c] = Math.round(total[c] * 10) / 10;
    });

    return {
      // El total del plato ENTERO, con las raciones con las que esta
      // apuntado. Escalarlo es cosa de quien lo pinta, que es quien sabe
      // para cuanta gente lo estas mirando.
      total,
      contados,
      sinContar,
      hayDatos: contados > 0,
    };
  }

  function lineasDe(recetaId) {
    return db
      .prepare(`
        SELECT l.*, i.name AS ingrediente_nombre, i.categoria AS ingrediente_categoria, i.unidad AS ingrediente_unidad
        FROM recetas_lineas l
        LEFT JOIN recetas_ingredientes i ON i.id = l.ingrediente_id
        WHERE l.receta_id = ?
        ORDER BY l.position ASC, l.id ASC
      `)
      .all(recetaId)
      .map((l) => ({
        id: l.id,
        ingredienteId: l.ingrediente_id,
        nombre: l.ingrediente_nombre,
        categoria: l.ingrediente_categoria,
        cantidad: l.cantidad,
        unidad: l.unidad || l.ingrediente_unidad || null,
        nota: l.nota,
        opcional: !!l.opcional,
        position: l.position,
      }));
  }

  function serialize(row, { conLineas = true } = {}) {
    return {
      id: row.id,
      name: row.name,
      folderId: row.folder_id,
      foto: row.foto,
      raciones: row.raciones,
      tiempoPrep: row.tiempo_prep,
      tiempoCoccion: row.tiempo_coccion,
      // El total se calcula aqui y no en cada pantalla: con dos tiempos
      // opcionales, "suma lo que haya" es una regla que se olvida en
      // algun sitio si se repite.
      tiempoTotal: (row.tiempo_prep || 0) + (row.tiempo_coccion || 0) || null,
      dificultad: row.dificultad,
      tipo: row.tipo,
      etiquetas: row.etiquetas ? JSON.parse(row.etiquetas) : [],
      pasos: row.pasos,
      notas: row.notas,
      favorite: !!row.favorite,
      position: row.position,
      ingredientes: conLineas ? lineasDe(row.id) : undefined,
      nutricion: conLineas ? nutricionDe(row.id) : undefined,
      // Para la lista, donde no hace falta la lista entera pero si saber
      // cuantos lleva.
      numIngredientes: db.prepare('SELECT COUNT(*) as n FROM recetas_lineas WHERE receta_id = ?').get(row.id).n,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Sustituye TODAS las lineas de una receta por las que vengan. Se hace
  // asi (borrar y volver a poner) y no casando id a id porque las lineas
  // no tienen vida propia: son parte de la receta, y el formulario manda
  // siempre la lista entera en el orden en que se ve.
  //
  // Una linea sin ingrediente valido se DESCARTA en silencio en vez de
  // rechazar la receta entera: perder una linea mal formada es mucho
  // menos malo que perder el resto de lo que acabas de escribir.
  function guardarLineas(recetaId, lineas) {
    db.prepare('DELETE FROM recetas_lineas WHERE receta_id = ?').run(recetaId);
    if (!Array.isArray(lineas)) return;
    let pos = 0;
    for (const l of lineas) {
      const ingredienteId = Number(l && l.ingredienteId);
      if (!Number.isFinite(ingredienteId)) continue;
      if (!db.prepare('SELECT id FROM recetas_ingredientes WHERE id = ?').get(ingredienteId)) continue;
      db.prepare('INSERT INTO recetas_lineas (receta_id, ingrediente_id, cantidad, unidad, nota, opcional, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          recetaId,
          ingredienteId,
          numeroOpcional(l.cantidad, { min: 0, max: 1000000 }),
          textoOpcional(l.unidad, 16),
          textoOpcional(l.nota, 120),
          l.opcional ? 1 : 0,
          pos,
        );
      pos += 1;
    }
  }

  // Todas las etiquetas que ya has usado, para sugerirlas al escribir.
  // Va ANTES de '/:id' a proposito: el despachador recorre las rutas en
  // orden de registro, igual que Express, y al reves "etiquetas" se
  // tragaria como si fuera un id.
  router.get('/etiquetas', (req, res) => {
    const vistas = new Map();
    db.prepare('SELECT etiquetas FROM recetas').all().forEach((r) => {
      if (!r.etiquetas) return;
      let lista = [];
      try { lista = JSON.parse(r.etiquetas); } catch { return; }
      if (!Array.isArray(lista)) return;
      lista.forEach((e) => {
        const k = String(e).toLowerCase();
        if (!vistas.has(k)) vistas.set(k, String(e));
      });
    });
    res.json(Array.from(vistas.values()).sort((a, b) => a.localeCompare(b, 'es')));
  });

  router.get('/', (req, res) => {
    const { folderId, q, etiqueta } = req.query;
    let rows;
    if (folderId === 'root') {
      rows = db.prepare('SELECT * FROM recetas WHERE folder_id IS NULL ORDER BY position ASC, id ASC').all();
    } else if (folderId !== undefined && folderId !== '') {
      rows = db.prepare('SELECT * FROM recetas WHERE folder_id = ? ORDER BY position ASC, id ASC').all(folderId);
    } else {
      rows = db.prepare('SELECT * FROM recetas ORDER BY position ASC, id ASC').all();
    }
    let lista = rows.map((r) => serialize(r, { conLineas: false }));
    if (q && String(q).trim()) {
      const t = String(q).trim().toLowerCase();
      lista = lista.filter((r) => r.name.toLowerCase().includes(t) || r.etiquetas.some((e) => e.toLowerCase().includes(t)));
    }
    if (etiqueta && String(etiqueta).trim()) {
      const t = String(etiqueta).trim().toLowerCase();
      lista = lista.filter((r) => r.etiquetas.some((e) => e.toLowerCase() === t));
    }
    res.json(lista);
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM recetas WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(serialize(row));
  });

  function sanearPasos(pasos) {
    if (pasos === undefined || pasos === null || pasos === '') return null;
    const html = typeof window.sanearHtmlDeNota === 'function' ? window.sanearHtmlDeNota(String(pasos)) : String(pasos);
    return html.trim() ? html : null;
  }

  router.post('/', (req, res) => {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'La receta necesita un nombre.' });
    }
    const { count } = db.prepare('SELECT COUNT(*) as count FROM recetas').get();
    const info = db
      .prepare(`
        INSERT INTO recetas (name, folder_id, foto, raciones, tiempo_prep, tiempo_coccion, dificultad, tipo, etiquetas, pasos, notas, favorite, position, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      .run(
        String(b.name).trim().slice(0, 140),
        b.folderId === undefined || b.folderId === null || b.folderId === '' ? null : Number(b.folderId),
        fotoValida(b.foto),
        racionesValidas(b.raciones, 2),
        numeroOpcional(b.tiempoPrep, { max: 10000 }),
        numeroOpcional(b.tiempoCoccion, { max: 10000 }),
        DIFICULTADES.includes(b.dificultad) ? b.dificultad : null,
        TIPOS.includes(b.tipo) ? b.tipo : null,
        JSON.stringify(limpiarEtiquetas(b.etiquetas)),
        sanearPasos(b.pasos),
        textoOpcional(b.notas, 2000),
        b.favorite ? 1 : 0,
        count,
      );
    guardarLineas(info.lastInsertRowid, b.ingredientes);
    res.status(201).json(serialize(db.prepare('SELECT * FROM recetas WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/:id', (req, res) => {
    const ex = db.prepare('SELECT * FROM recetas WHERE id = ?').get(req.params.id);
    if (!ex) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};

    // Cambiar la foto libera los bytes de la anterior. Es la unica
    // limpieza que se puede hacer con seguridad: una foto es un campo,
    // asi que al sustituirla se sabe con certeza que la vieja ya no la
    // usa nadie -- al reves de lo que pasa con las imagenes dentro del
    // HTML de una nota, donde hay que comparar antes/despues.
    let foto = ex.foto;
    if (b.foto !== undefined) {
      const nueva = fotoValida(b.foto);
      if (nueva !== ex.foto) borrarFoto(ex.foto);
      foto = nueva;
    }

    db.prepare(`
      UPDATE recetas SET name = ?, folder_id = ?, foto = ?, raciones = ?, tiempo_prep = ?, tiempo_coccion = ?,
        dificultad = ?, tipo = ?, etiquetas = ?, pasos = ?, notas = ?, favorite = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.name !== undefined && String(b.name).trim() ? String(b.name).trim().slice(0, 140) : ex.name,
      b.folderId === undefined ? ex.folder_id : (b.folderId === null || b.folderId === '' ? null : Number(b.folderId)),
      foto,
      b.raciones === undefined ? ex.raciones : racionesValidas(b.raciones, ex.raciones),
      b.tiempoPrep === undefined ? ex.tiempo_prep : numeroOpcional(b.tiempoPrep, { max: 10000 }),
      b.tiempoCoccion === undefined ? ex.tiempo_coccion : numeroOpcional(b.tiempoCoccion, { max: 10000 }),
      b.dificultad === undefined ? ex.dificultad : (DIFICULTADES.includes(b.dificultad) ? b.dificultad : null),
      b.tipo === undefined ? ex.tipo : (TIPOS.includes(b.tipo) ? b.tipo : null),
      b.etiquetas === undefined ? ex.etiquetas : JSON.stringify(limpiarEtiquetas(b.etiquetas)),
      b.pasos === undefined ? ex.pasos : sanearPasos(b.pasos),
      b.notas === undefined ? ex.notas : textoOpcional(b.notas, 2000),
      b.favorite === undefined ? ex.favorite : (b.favorite ? 1 : 0),
      req.params.id,
    );

    // Solo se tocan las lineas si vienen. Un PUT parcial (marcar
    // favorita, moverla de carpeta) no puede dejar la receta sin
    // ingredientes -- el mismo cuidado que tiene events.js con la regla
    // de repeticion.
    if (b.ingredientes !== undefined) guardarLineas(Number(req.params.id), b.ingredientes);

    res.json(serialize(db.prepare('SELECT * FROM recetas WHERE id = ?').get(req.params.id)));
  });

  // Duplicar una receta. La comparte la copia de una CARPETA
  // (recetasCarpetas.js), que necesita copiar lo de dentro sin
  // renombrarlo -- de ahi el `renombrar`. Tener dos copiadores acabaria
  // con uno de los dos olvidandose de la foto.
  function duplicarReceta({ id, folderId, renombrar = true }) {
    const ex = db.prepare('SELECT * FROM recetas WHERE id = ?').get(id);
    if (!ex) return null;
    const destino = folderId === undefined ? ex.folder_id : folderId;

    let nombre = ex.name;
    if (renombrar) {
      const hermanas = destino === null || destino === undefined
        ? db.prepare('SELECT name FROM recetas WHERE folder_id IS NULL').all()
        : db.prepare('SELECT name FROM recetas WHERE folder_id = ?').all(destino);
      nombre = nombreDeCopia(ex.name, hermanas.map((h) => h.name));
    }

    const { count } = db.prepare('SELECT COUNT(*) as count FROM recetas').get();
    const info = db
      .prepare(`
        INSERT INTO recetas (name, folder_id, foto, raciones, tiempo_prep, tiempo_coccion, dificultad, tipo, etiquetas, pasos, notas, favorite, position, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      .run(
        nombre.slice(0, 140),
        destino ?? null,
        duplicarFoto(ex.foto),
        ex.raciones,
        ex.tiempo_prep,
        ex.tiempo_coccion,
        ex.dificultad,
        ex.tipo,
        ex.etiquetas,
        // Los pasos pueden llevar imagenes de paso dentro, y valen lo
        // mismo que la foto: cada una estrena uuid.
        typeof window.duplicarImagenesDeHtml === 'function' ? window.duplicarImagenesDeHtml(ex.pasos) : ex.pasos,
        ex.notas,
        0,
        count,
      );

    db.prepare('SELECT * FROM recetas_lineas WHERE receta_id = ? ORDER BY position ASC, id ASC').all(ex.id).forEach((l, i) => {
      db.prepare('INSERT INTO recetas_lineas (receta_id, ingrediente_id, cantidad, unidad, nota, opcional, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(info.lastInsertRowid, l.ingrediente_id, l.cantidad, l.unidad, l.nota, l.opcional, i);
    });
    return db.prepare('SELECT * FROM recetas WHERE id = ?').get(info.lastInsertRowid);
  }

  router.post('/:id/duplicate', (req, res) => {
    const copia = duplicarReceta({ id: req.params.id });
    if (!copia) return res.status(404).json({ error: 'not_found' });
    res.status(201).json(serialize(copia));
  });

  function borrarReceta(id) {
    const ex = db.prepare('SELECT * FROM recetas WHERE id = ?').get(id);
    if (!ex) return false;
    borrarFoto(ex.foto);
    // Las imagenes de los pasos, igual que al borrar una nota.
    if (ex.pasos) {
      for (const m of String(ex.pasos).matchAll(/\/api\/notes\/images\/([a-zA-Z0-9._-]+)/g)) {
        assetDelete(m[1]).catch(() => {});
      }
    }
    db.prepare('DELETE FROM recetas_lineas WHERE receta_id = ?').run(id);
    // La compra NO pierde lo que ya tenia: solo se le suelta el enlace,
    // y el nombre copiado que guarda recetas_compra_recetas sigue
    // explicando de donde salio cada cantidad.
    db.prepare('UPDATE recetas_compra_recetas SET receta_id = NULL WHERE receta_id = ?').run(id);
    db.prepare('DELETE FROM recetas WHERE id = ?').run(id);
    return true;
  }

  router.delete('/:id', (req, res) => {
    if (!borrarReceta(req.params.id)) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  // Globales para las otras rutas: cada archivo va en su IIFE y no puede
  // importar nada. Mismo patron que window.duplicarNotaLocal.
  window.duplicarRecetaLocal = duplicarReceta;
  window.borrarRecetaLocal = borrarReceta;

  mountLocalRouter('/api/recetas', router);
})();
