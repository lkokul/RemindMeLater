// recetasIngredientes — el CATALOGO de la App "Recetas".
//
// Ruta NUEVA (no un porte de server/routes/). Cada ingrediente existe
// UNA sola vez y lo comparten todas las recetas que lo usan; ver el
// comentario del esquema en local-schema.js para el porque.
//
// La regla que sostiene todo esto: DOS INGREDIENTES NO PUEDEN LLAMARSE
// IGUAL, sin distinguir mayusculas ni acentos sueltos de espacios. Si
// "Pollo" y "pollo " fueran dos fichas, la lista de la compra los
// pondria en dos lineas y manana habria dos precios distintos para la
// misma cosa -- que es exactamente lo que el catalogo viene a evitar.
(function () {
  const db = localDb;
  const router = createLocalRouter();

  // Para comparar nombres: sin mayusculas, sin espacios de sobra y sin
  // espacios repetidos por dentro ("pollo  troceado" y "Pollo troceado"
  // son el mismo). NO se quitan las tildes a proposito: "anís" y "anis"
  // son distintos de escribir pero tambien de leer, y fusionarlos
  // cambiaria lo que el usuario escribio.
  function clave(nombre) {
    return String(nombre == null ? '' : nombre).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Los nueve valores opcionales, todos numeros por 100 g / 100 ml (mas
  // lo que pesa una unidad). En una sola lista para que anadir uno
  // manana sea tocar SOLO esta linea, en vez de buscarlos repartidos por
  // el INSERT, el UPDATE y el serializador.
  const CAMPOS_NUTRI = ['kcal', 'proteinas', 'grasas', 'saturadas', 'hidratos', 'azucares', 'fibra', 'sal', 'gramosPorUnidad'];
  const COLUMNA_NUTRI = {
    kcal: 'kcal', proteinas: 'proteinas', grasas: 'grasas', saturadas: 'saturadas',
    hidratos: 'hidratos', azucares: 'azucares', fibra: 'fibra', sal: 'sal',
    gramosPorUnidad: 'gramos_por_unidad',
  };

  // Vacio significa "no lo se", que NO es lo mismo que cero: un cero
  // contaria como dato bueno y hundiria el total de la receta sin que se
  // notara. Un negativo tampoco existe en una etiqueta, asi que se trata
  // igual que no saberlo.
  function numeroNutri(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(100000, n);
  }

  function limpiarTexto(v, max) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t ? t.slice(0, max) : null;
  }

  function serialize(row) {
    const nutri = {};
    CAMPOS_NUTRI.forEach((c) => { nutri[c] = row[COLUMNA_NUTRI[c]] ?? null; });
    return {
      id: row.id,
      name: row.name,
      unidad: row.unidad,
      categoria: row.categoria,
      notas: row.notas,
      ...nutri,
      // Para que la pantalla sepa de un vistazo si a este ingrediente le
      // falta todo, sin tener que mirar los nueve campos.
      tieneNutricion: CAMPOS_NUTRI.some((c) => nutri[c] !== null && c !== 'gramosPorUnidad'),
      // Cuantas recetas lo usan. Va en el serializador y no en una ruta
      // aparte porque es justo lo que hace falta para decidir si se
      // puede borrar, y para ordenar el catalogo por lo que mas usas.
      usos: db.prepare('SELECT COUNT(*) as n FROM recetas_lineas WHERE ingrediente_id = ?').get(row.id).n,
      updatedAt: row.updated_at,
    };
  }

  // Busca por nombre exacto (con la clave de arriba). Se trae la lista
  // entera y se compara en JavaScript en vez de con lower() en SQL:
  // lower() de SQLite solo baja las letras ASCII, asi que "ÑOQUIS" no
  // casaria con "ñoquis" -- un fallo que solo aparece con acentos y en
  // el peor momento.
  function buscarPorNombre(nombre) {
    const k = clave(nombre);
    if (!k) return null;
    return db.prepare('SELECT * FROM recetas_ingredientes').all().find((r) => clave(r.name) === k) || null;
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM recetas_ingredientes ORDER BY name COLLATE NOCASE ASC').all();
    res.json(rows.map(serialize));
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM recetas_ingredientes WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(serialize(row));
  });

  function crear({ name, unidad, categoria, notas }, nutri) {
    const columnas = CAMPOS_NUTRI.map((c) => COLUMNA_NUTRI[c]);
    const info = db
      .prepare(`INSERT INTO recetas_ingredientes (name, unidad, categoria, notas, ${columnas.join(', ')}, updated_at)
                VALUES (?, ?, ?, ?, ${columnas.map(() => '?').join(', ')}, datetime('now'))`)
      .run(name, unidad, categoria, notas, ...CAMPOS_NUTRI.map((c) => numeroNutri(nutri ? nutri[c] : null)));
    return db.prepare('SELECT * FROM recetas_ingredientes WHERE id = ?').get(info.lastInsertRowid);
  }

  router.post('/', (req, res) => {
    const { name, unidad, categoria, notas } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'El ingrediente necesita un nombre.' });
    }
    const yaEsta = buscarPorNombre(name);
    if (yaEsta) {
      return res.status(409).json({ error: 'duplicado', message: `Ya tienes un ingrediente que se llama «${yaEsta.name}».` });
    }
    const row = crear({
      name: String(name).trim().slice(0, 80),
      unidad: limpiarTexto(unidad, 16),
      categoria: limpiarTexto(categoria, 40),
      notas: limpiarTexto(notas, 400),
    }, req.body);
    res.status(201).json(serialize(row));
  });

  // "Dame el ingrediente que se llama asi, y si no existe crealo."
  //
  // Es la puerta que usa el formulario de una receta cuando escribes un
  // nombre a mano, y es lo que hace que el catalogo no estorbe: no hay
  // que darse de alta el ingrediente antes de poder usarlo, pero
  // tampoco se duplica si ya estaba. Devuelve 200 si ya existia y 201 si
  // lo acaba de crear, por si quien llama quiere avisar de lo segundo.
  router.post('/resolve', (req, res) => {
    const { name, unidad, categoria } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'Falta el nombre del ingrediente.' });
    }
    const existente = buscarPorNombre(name);
    if (existente) return res.json(serialize(existente));
    const row = crear({
      name: String(name).trim().slice(0, 80),
      unidad: limpiarTexto(unidad, 16),
      categoria: limpiarTexto(categoria, 40),
      notas: null,
    });
    res.status(201).json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existente = db.prepare('SELECT * FROM recetas_ingredientes WHERE id = ?').get(req.params.id);
    if (!existente) return res.status(404).json({ error: 'not_found' });
    const { name, unidad, categoria, notas } = req.body || {};

    if (name !== undefined && String(name).trim()) {
      const choque = buscarPorNombre(name);
      if (choque && choque.id !== existente.id) {
        return res.status(409).json({ error: 'duplicado', message: `Ya tienes un ingrediente que se llama «${choque.name}».` });
      }
    }

    // Un campo que NO venga en el cuerpo se queda como estaba, igual que
    // el resto: un PUT parcial (cambiar solo el pasillo) no puede dejar a
    // un ingrediente sin sus valores nutricionales.
    const sets = CAMPOS_NUTRI.map((c) => `${COLUMNA_NUTRI[c]} = ?`).join(', ');
    db.prepare(`UPDATE recetas_ingredientes SET name = ?, unidad = ?, categoria = ?, notas = ?, ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
      name !== undefined && String(name).trim() ? String(name).trim().slice(0, 80) : existente.name,
      unidad === undefined ? existente.unidad : limpiarTexto(unidad, 16),
      categoria === undefined ? existente.categoria : limpiarTexto(categoria, 40),
      notas === undefined ? existente.notas : limpiarTexto(notas, 400),
      ...CAMPOS_NUTRI.map((c) => ((req.body || {})[c] === undefined ? existente[COLUMNA_NUTRI[c]] : numeroNutri((req.body || {})[c]))),
      req.params.id,
    );
    res.json(serialize(db.prepare('SELECT * FROM recetas_ingredientes WHERE id = ?').get(req.params.id)));
  });

  router.delete('/:id', (req, res) => {
    const existente = db.prepare('SELECT * FROM recetas_ingredientes WHERE id = ?').get(req.params.id);
    if (!existente) return res.status(404).json({ error: 'not_found' });

    // Un ingrediente que usa alguna receta NO se borra, se avisa: borrarlo
    // dejaria esa receta con una linea que apunta a nada. Mismo criterio
    // que una cuenta de Finanzas con historial. Quien de verdad quiera
    // quitarlo, primero lo saca de las recetas.
    const usos = db.prepare('SELECT COUNT(*) as n FROM recetas_lineas WHERE ingrediente_id = ?').get(req.params.id).n;
    if (usos > 0) {
      return res.status(409).json({
        error: 'en_uso',
        message: `«${existente.name}» lo usan ${usos} ${usos === 1 ? 'receta' : 'recetas'}. Quítalo de ellas antes de borrarlo.`,
      });
    }
    // De la compra si se puede ir sin mas: una linea de la lista sin
    // ingrediente detras sigue teniendo su texto y se puede tachar.
    db.prepare('UPDATE recetas_compra_lineas SET ingrediente_id = NULL, texto = COALESCE(texto, ?) WHERE ingrediente_id = ?')
      .run(existente.name, req.params.id);
    db.prepare('DELETE FROM recetas_ingredientes WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  mountLocalRouter('/api/recetas-ingredientes', router);
})();
