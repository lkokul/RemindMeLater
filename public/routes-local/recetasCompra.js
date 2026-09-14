// recetasCompra — la lista de la compra de la App "Recetas".
//
// Ruta NUEVA (no un porte de server/routes/).
//
// COMO FUNCIONA, en una frase: hay UNA lista viva; le metes recetas y
// ella suma sola lo que hace falta; al darle a "Compra hecha" se archiva
// con su fecha y nace otra vacia.
//
// Las cantidades de una linea van en DOS mitades y eso es lo que hace
// que todo encaje (ver el comentario de recetas_compra_lineas en
// local-schema.js): "cantidad_recetas" la calcula esta ruta a partir de
// las recetas metidas, "cantidad_manual" es lo que has puesto tu. Se
// ensena la suma. Con una sola columna, quitar una receta te borraria lo
// que hubieras anadido a mano, o recalcular pisaria tu numero.
//
// UNA LINEA ES (INGREDIENTE, UNIDAD). 200 g de pollo y 2 ud de pollo no
// se pueden sumar sin inventarse una equivalencia, asi que son dos
// lineas. Es feo y es correcto: preferible a decir "202" de algo.
(function () {
  const db = localDb;
  const router = createLocalRouter();

  function numeroOpcional(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

  function textoOpcional(v, max) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t ? t.slice(0, max) : null;
  }

  // La lista viva. Si no hay ninguna se crea al vuelo: una App de
  // recetas sin lista de la compra no tiene sentido, y hacer que el
  // cliente tenga que crearla antes solo seria una forma de que se le
  // olvide a alguien.
  function compraViva() {
    const ya = db.prepare("SELECT * FROM recetas_compras WHERE estado = 'viva' ORDER BY id DESC").get();
    if (ya) return ya;
    const info = db.prepare("INSERT INTO recetas_compras (estado) VALUES ('viva')").run();
    return db.prepare('SELECT * FROM recetas_compras WHERE id = ?').get(info.lastInsertRowid);
  }

  // -------------------------------------------------------------------
  // RECALCULAR
  // -------------------------------------------------------------------
  //
  // Rehace la mitad "de recetas" de cada linea a partir de las recetas
  // que hay metidas en la compra. Se llama en los tres momentos en que
  // eso puede cambiar: meter una receta, quitarla y cambiarle las
  // raciones.
  //
  // Lo que NO toca nunca: `comprado` (lo tachado sigue tachado) y
  // `cantidad_manual` (lo tuyo es tuyo).
  //
  // Efecto que conviene conocer: una linea que borres a mano VUELVE si
  // despues tocas las recetas, porque entonces se rehace la lista a
  // partir de ellas. Es la consecuencia de que la lista se derive de las
  // recetas en vez de ser una copia suelta -- y es lo que hace que meter
  // una receta sume de verdad en vez de duplicar lineas.
  function recalcular(compraId) {
    const metidas = db.prepare('SELECT * FROM recetas_compra_recetas WHERE compra_id = ?').all(compraId);

    // Lo que piden todas las recetas juntas, agrupado por
    // (ingrediente, unidad).
    const pedido = new Map();
    for (const m of metidas) {
      if (!m.receta_id) continue; // la receta se borro: su nombre queda, pero ya no puede pedir nada
      const receta = db.prepare('SELECT * FROM recetas WHERE id = ?').get(m.receta_id);
      if (!receta) continue;
      // La regla de tres: lo que pide la receta por sus raciones BASE,
      // llevado a las que quieres. Con raciones base 0 o nula no se
      // escala (se toma tal cual), que es lo unico que no rompe.
      const base = Number(receta.raciones) > 0 ? Number(receta.raciones) : 1;
      const quiere = Number(m.raciones) > 0 ? Number(m.raciones) : base;
      const factor = quiere / base;

      const lineas = db.prepare('SELECT * FROM recetas_lineas WHERE receta_id = ?').all(m.receta_id);
      for (const l of lineas) {
        const unidad = l.unidad || '';
        const clave = `${l.ingrediente_id}|${unidad}`;
        const anterior = pedido.get(clave) || { ingredienteId: l.ingrediente_id, unidad: l.unidad || null, cantidad: null };
        if (l.cantidad !== null && l.cantidad !== undefined) {
          // Un ingrediente sin cantidad ("sal al gusto") no suma, pero SI
          // tiene que aparecer en la lista -- de ahi que la cantidad
          // pueda quedarse en null y la linea exista igual.
          anterior.cantidad = (anterior.cantidad || 0) + l.cantidad * factor;
        }
        pedido.set(clave, anterior);
      }
    }

    const existentes = db.prepare('SELECT * FROM recetas_compra_lineas WHERE compra_id = ?').all(compraId);
    const porClave = new Map();
    existentes.forEach((l) => {
      if (l.ingrediente_id === null) return; // linea suelta escrita a mano: no se toca jamas
      porClave.set(`${l.ingrediente_id}|${l.unidad || ''}`, l);
    });

    // 1) Poner al dia (o crear) lo que piden las recetas.
    let pos = db.prepare('SELECT COALESCE(MAX(position), -1) as p FROM recetas_compra_lineas WHERE compra_id = ?').get(compraId).p;
    for (const [clave, p] of pedido) {
      const ya = porClave.get(clave);
      // Los decimales se redondean a 2 al GUARDAR: multiplicar por
      // 4/3 saca colas infinitas (66.66666666666667 g) que no dicen
      // nada y encima se ven feas en la lista.
      const cantidad = p.cantidad === null ? null : Math.round(p.cantidad * 100) / 100;
      if (ya) {
        db.prepare('UPDATE recetas_compra_lineas SET cantidad_recetas = ? WHERE id = ?').run(cantidad, ya.id);
      } else {
        pos += 1;
        db.prepare('INSERT INTO recetas_compra_lineas (compra_id, ingrediente_id, unidad, cantidad_recetas, cantidad_manual, comprado, position) VALUES (?, ?, ?, ?, NULL, 0, ?)')
          .run(compraId, p.ingredienteId, p.unidad, cantidad, pos);
      }
    }

    // 2) Lo que ya no pide ninguna receta pierde SU mitad. Si ademas no
    // tenias nada puesto a mano, la linea se va del todo -- quitar una
    // receta tiene que dejar la lista como estaba.
    for (const [clave, l] of porClave) {
      if (pedido.has(clave)) continue;
      if (l.cantidad_manual !== null && l.cantidad_manual !== undefined) {
        db.prepare('UPDATE recetas_compra_lineas SET cantidad_recetas = NULL WHERE id = ?').run(l.id);
      } else {
        db.prepare('DELETE FROM recetas_compra_lineas WHERE id = ?').run(l.id);
      }
    }

    db.prepare("UPDATE recetas_compras SET updated_at = datetime('now') WHERE id = ?").run(compraId);
  }

  function serializeLinea(l) {
    const ing = l.ingrediente_id
      ? db.prepare('SELECT name, categoria FROM recetas_ingredientes WHERE id = ?').get(l.ingrediente_id)
      : null;
    const total = (l.cantidad_recetas || 0) + (l.cantidad_manual || 0);
    return {
      id: l.id,
      ingredienteId: l.ingrediente_id,
      // Una linea sin ingrediente lleva su propio texto (papel de horno,
      // bolsas); una con ingrediente saca el nombre de la ficha, para
      // que renombrarlo se note aqui tambien.
      nombre: ing ? ing.name : (l.texto || 'Sin nombre'),
      categoria: ing ? ing.categoria : null,
      unidad: l.unidad,
      cantidadRecetas: l.cantidad_recetas,
      cantidadManual: l.cantidad_manual,
      // Lo que se ensena. null (y no 0) cuando no hay ninguna de las dos:
      // "sal" sin cantidad no es "0 de sal".
      cantidad: l.cantidad_recetas === null && l.cantidad_manual === null ? null : Math.round(total * 100) / 100,
      comprado: !!l.comprado,
      position: l.position,
    };
  }

  function serializeCompra(compra) {
    const lineas = db.prepare('SELECT * FROM recetas_compra_lineas WHERE compra_id = ? ORDER BY position ASC, id ASC').all(compra.id);
    const recetas = db.prepare('SELECT * FROM recetas_compra_recetas WHERE compra_id = ? ORDER BY id ASC').all(compra.id);
    const serializadas = lineas.map(serializeLinea);
    return {
      id: compra.id,
      estado: compra.estado,
      nombre: compra.nombre,
      cerradaAt: compra.cerrada_at,
      createdAt: compra.created_at,
      updatedAt: compra.updated_at,
      lineas: serializadas,
      pendientes: serializadas.filter((l) => !l.comprado).length,
      recetas: recetas.map((r) => ({
        id: r.id,
        recetaId: r.receta_id,
        nombre: r.nombre,
        raciones: r.raciones,
      })),
    };
  }

  // Va ANTES de '/:id': el despachador recorre en orden de registro,
  // igual que Express, y al reves "viva" o "historial" se tragarian como
  // si fueran un id.
  router.get('/viva', (req, res) => {
    res.json(serializeCompra(compraViva()));
  });

  router.get('/historial', (req, res) => {
    const rows = db.prepare("SELECT * FROM recetas_compras WHERE estado = 'archivada' ORDER BY COALESCE(cerrada_at, created_at) DESC, id DESC").all();
    res.json(rows.map((c) => {
      const lineas = db.prepare('SELECT COUNT(*) as n FROM recetas_compra_lineas WHERE compra_id = ?').get(c.id).n;
      const recetas = db.prepare('SELECT COUNT(*) as n FROM recetas_compra_recetas WHERE compra_id = ?').get(c.id).n;
      return {
        id: c.id,
        nombre: c.nombre,
        cerradaAt: c.cerrada_at,
        createdAt: c.created_at,
        numLineas: lineas,
        numRecetas: recetas,
      };
    }));
  });

  router.get('/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM recetas_compras WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not_found' });
    res.json(serializeCompra(c));
  });

  // Meter una receta en la lista. `raciones` es opcional: sin ella se
  // usan las de la receta tal y como esta apuntada.
  router.post('/recetas', (req, res) => {
    const { recetaId, raciones } = req.body || {};
    const receta = db.prepare('SELECT * FROM recetas WHERE id = ?').get(recetaId);
    if (!receta) return res.status(404).json({ error: 'not_found', message: 'Esa receta ya no existe.' });

    const compra = compraViva();
    const quiere = Number(raciones) > 0 ? Number(raciones) : receta.raciones;

    // Meterla dos veces SUMA en vez de duplicar la fila: "quiero hacerla
    // dos veces" es una peticion razonable y la respuesta correcta es el
    // doble de ingredientes, no dos entradas iguales que luego hay que
    // quitar por separado.
    const ya = db.prepare('SELECT * FROM recetas_compra_recetas WHERE compra_id = ? AND receta_id = ?').get(compra.id, receta.id);
    if (ya) {
      db.prepare('UPDATE recetas_compra_recetas SET raciones = ? WHERE id = ?').run((ya.raciones || 0) + quiere, ya.id);
    } else {
      db.prepare('INSERT INTO recetas_compra_recetas (compra_id, receta_id, nombre, raciones) VALUES (?, ?, ?, ?)')
        .run(compra.id, receta.id, receta.name, quiere);
    }
    recalcular(compra.id);
    res.status(201).json(serializeCompra(db.prepare('SELECT * FROM recetas_compras WHERE id = ?').get(compra.id)));
  });

  router.put('/recetas/:id', (req, res) => {
    const fila = db.prepare('SELECT * FROM recetas_compra_recetas WHERE id = ?').get(req.params.id);
    if (!fila) return res.status(404).json({ error: 'not_found' });
    const raciones = Number(req.body && req.body.raciones);
    if (!Number.isFinite(raciones) || raciones <= 0) {
      return res.status(400).json({ error: 'invalid_request', message: 'Las raciones tienen que ser un número mayor que cero.' });
    }
    db.prepare('UPDATE recetas_compra_recetas SET raciones = ? WHERE id = ?').run(Math.min(999, raciones), fila.id);
    recalcular(fila.compra_id);
    res.json(serializeCompra(db.prepare('SELECT * FROM recetas_compras WHERE id = ?').get(fila.compra_id)));
  });

  router.delete('/recetas/:id', (req, res) => {
    const fila = db.prepare('SELECT * FROM recetas_compra_recetas WHERE id = ?').get(req.params.id);
    if (!fila) return res.status(404).json({ error: 'not_found' });
    db.prepare('DELETE FROM recetas_compra_recetas WHERE id = ?').run(fila.id);
    recalcular(fila.compra_id);
    res.json(serializeCompra(db.prepare('SELECT * FROM recetas_compras WHERE id = ?').get(fila.compra_id)));
  });

  // Anadir algo a mano. Con `ingredienteId` se junta con lo que ya pidan
  // las recetas de ese ingrediente y esa unidad (no se crea una linea
  // repetida); con `texto` es una linea suelta que no viene de ninguna
  // receta y vive por su cuenta.
  router.post('/lineas', (req, res) => {
    const { ingredienteId, texto, cantidad, unidad } = req.body || {};
    const compra = compraViva();
    const cant = numeroOpcional(cantidad);

    if (ingredienteId !== undefined && ingredienteId !== null && ingredienteId !== '') {
      const ing = db.prepare('SELECT * FROM recetas_ingredientes WHERE id = ?').get(ingredienteId);
      if (!ing) return res.status(404).json({ error: 'not_found', message: 'Ese ingrediente ya no existe.' });
      const uni = textoOpcional(unidad, 16) || ing.unidad || null;
      // La pareja (ingrediente, unidad) se busca en JavaScript y no con
      // un COALESCE en SQL: la unidad puede ser NULL, y en SQL NULL no
      // es igual ni a si mismo, asi que la comparacion directa nunca
      // casaria la linea "sin unidad" y se crearia una repetida.
      const ya = db.prepare('SELECT * FROM recetas_compra_lineas WHERE compra_id = ? AND ingrediente_id = ?')
        .all(compra.id, ing.id)
        .find((l) => (l.unidad || '') === (uni || ''));
      if (ya) {
        const suma = (ya.cantidad_manual || 0) + (cant || 0);
        db.prepare('UPDATE recetas_compra_lineas SET cantidad_manual = ? WHERE id = ?').run(suma > 0 ? suma : null, ya.id);
      } else {
        const pos = db.prepare('SELECT COALESCE(MAX(position), -1) as p FROM recetas_compra_lineas WHERE compra_id = ?').get(compra.id).p + 1;
        db.prepare('INSERT INTO recetas_compra_lineas (compra_id, ingrediente_id, unidad, cantidad_manual, position) VALUES (?, ?, ?, ?, ?)')
          .run(compra.id, ing.id, uni, cant, pos);
      }
    } else {
      const t = textoOpcional(texto, 120);
      if (!t) return res.status(400).json({ error: 'invalid_request', message: 'Escribe qué quieres añadir.' });
      const pos = db.prepare('SELECT COALESCE(MAX(position), -1) as p FROM recetas_compra_lineas WHERE compra_id = ?').get(compra.id).p + 1;
      db.prepare('INSERT INTO recetas_compra_lineas (compra_id, ingrediente_id, texto, unidad, cantidad_manual, position) VALUES (?, NULL, ?, ?, ?, ?)')
        .run(compra.id, t, textoOpcional(unidad, 16), cant, pos);
    }

    db.prepare("UPDATE recetas_compras SET updated_at = datetime('now') WHERE id = ?").run(compra.id);
    res.status(201).json(serializeCompra(db.prepare('SELECT * FROM recetas_compras WHERE id = ?').get(compra.id)));
  });

  router.put('/lineas/:id', (req, res) => {
    const l = db.prepare('SELECT * FROM recetas_compra_lineas WHERE id = ?').get(req.params.id);
    if (!l) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    db.prepare('UPDATE recetas_compra_lineas SET comprado = ?, cantidad_manual = ?, unidad = ?, texto = ? WHERE id = ?').run(
      b.comprado === undefined ? l.comprado : (b.comprado ? 1 : 0),
      b.cantidadManual === undefined ? l.cantidad_manual : numeroOpcional(b.cantidadManual),
      b.unidad === undefined ? l.unidad : textoOpcional(b.unidad, 16),
      b.texto === undefined ? l.texto : textoOpcional(b.texto, 120),
      l.id,
    );
    db.prepare("UPDATE recetas_compras SET updated_at = datetime('now') WHERE id = ?").run(l.compra_id);
    res.json(serializeLinea(db.prepare('SELECT * FROM recetas_compra_lineas WHERE id = ?').get(l.id)));
  });

  router.delete('/lineas/:id', (req, res) => {
    const l = db.prepare('SELECT * FROM recetas_compra_lineas WHERE id = ?').get(req.params.id);
    if (!l) return res.status(404).json({ error: 'not_found' });
    db.prepare('DELETE FROM recetas_compra_lineas WHERE id = ?').run(l.id);
    res.status(204).end();
  });

  // Vaciar del todo sin archivar: es el "empezar de cero" de cuando te
  // has liado, no el "ya he comprado".
  router.post('/vaciar', (req, res) => {
    const compra = compraViva();
    db.prepare('DELETE FROM recetas_compra_lineas WHERE compra_id = ?').run(compra.id);
    db.prepare('DELETE FROM recetas_compra_recetas WHERE compra_id = ?').run(compra.id);
    res.json(serializeCompra(db.prepare('SELECT * FROM recetas_compras WHERE id = ?').get(compra.id)));
  });

  // "Compra hecha": la lista viva se archiva con su fecha y la siguiente
  // llamada a /viva creara una nueva vacia. La archivada se queda entera
  // (lineas y recetas), que es de donde saldra el "cuanto me costo" el
  // dia que se enganche con Finanzas.
  router.post('/cerrar', (req, res) => {
    const compra = compraViva();
    const cuantas = db.prepare('SELECT COUNT(*) as n FROM recetas_compra_lineas WHERE compra_id = ?').get(compra.id).n;
    if (cuantas === 0) {
      return res.status(400).json({ error: 'vacia', message: 'La lista está vacía, no hay nada que cerrar.' });
    }
    db.prepare("UPDATE recetas_compras SET estado = 'archivada', nombre = ?, cerrada_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(textoOpcional(req.body && req.body.nombre, 80), compra.id);
    res.json(serializeCompra(compraViva()));
  });

  router.delete('/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM recetas_compras WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not_found' });
    db.prepare('DELETE FROM recetas_compra_lineas WHERE compra_id = ?').run(c.id);
    db.prepare('DELETE FROM recetas_compra_recetas WHERE compra_id = ?').run(c.id);
    db.prepare('DELETE FROM recetas_compras WHERE id = ?').run(c.id);
    res.status(204).end();
  });

  mountLocalRouter('/api/recetas-compra', router);
})();
