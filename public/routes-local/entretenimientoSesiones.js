// entretenimientoSesiones — cada vez que avanzas en algo.
//
// Una sesion es "el martes lei del capitulo 12 al 15". Hasta esta ronda la
// app solo sabia DONDE estas (12/24); esto guarda COMO has llegado, que es
// de donde salen la racha, el mapa de actividad y el resumen del ano.
//
// NADIE crea sesiones a mano desde la interfaz: las crea sola la ruta de
// items al ver que el progreso SUBE (ver entretenimientoItems.js, funcion
// apuntarSesion). Aqui solo se leen, y se pueden borrar para corregir un
// despiste.
(function () {
  const db = localDb;

  const router = createLocalRouter();

  function serialize(row) {
    return {
      id: row.id,
      itemId: row.item_id,
      vuelta: row.vuelta,
      fecha: row.fecha,
      progresoDesde: row.progreso_desde,
      progresoHasta: row.progreso_hasta,
      unidad: row.unidad,
      durationSeconds: row.duration_seconds,
      // Cuanto avanzaste en esa sentada. Se calcula aqui en vez de
      // guardarlo: es una resta, y guardarlo permitiria que dejara de
      // cuadrar con sus propios extremos.
      avance: row.progreso_hasta !== null && row.progreso_desde !== null
        ? row.progreso_hasta - row.progreso_desde
        : null,
    };
  }

  // --- OJO CON EL ORDEN DE LAS RUTAS -------------------------------------
  // '/resumen' tiene que declararse ANTES que cualquier '/:id', porque el
  // router recorre en orden de registro igual que Express y si no se
  // tragaria "resumen" como si fuera un id. Ver local-api.js.
  // -----------------------------------------------------------------------

  // Todo lo que hace falta para la pestana de Actividad, calculado con SQL
  // en vez de mandando las sesiones crudas: son pocas filas, pero asi el
  // cliente no tiene que repetir las mismas cuentas en tres sitios.
  router.get('/resumen', (req, res) => {
    // Cuantas sesiones por dia -- de aqui salen el mapa y la racha.
    const porDia = db
      .prepare('SELECT fecha, COUNT(*) as cuantas FROM entretenimiento_sesiones GROUP BY fecha ORDER BY fecha ASC')
      .all();

    // Del ano en curso: cuanto has avanzado de cada tipo. El avance se
    // suma solo cuando los dos extremos existen y la resta es positiva
    // (una correccion hacia atras no deberia restar de tu ano).
    //
    // Se agrupa por tipo Y UNIDAD, no solo por tipo: un manga puede ir por
    // capitulos y otro por tomos, y sumar los dos en un mismo numero daria
    // una cifra que no quiere decir nada. Asi salen "42 capitulos" y "3
    // tomos" por separado, que es lo unico honesto.
    const ano = new Date().getFullYear();
    const porTipo = db
      .prepare(`
        SELECT i.type as tipo,
               s.unidad as unidad,
               COUNT(*) as sesiones,
               SUM(CASE WHEN s.progreso_hasta > s.progreso_desde
                        THEN s.progreso_hasta - s.progreso_desde ELSE 0 END) as avance
        FROM entretenimiento_sesiones s
        JOIN entretenimiento_items i ON i.id = s.item_id
        WHERE s.fecha LIKE ?
        GROUP BY i.type, s.unidad
        ORDER BY sesiones DESC
      `)
      .all(`${ano}-%`);

    // Sesiones por mes del ano en curso, para la tira de doce barras.
    const porMes = db
      .prepare(`
        SELECT substr(fecha, 6, 2) as mes, COUNT(*) as cuantas
        FROM entretenimiento_sesiones
        WHERE fecha LIKE ?
        GROUP BY mes ORDER BY mes ASC
      `)
      .all(`${ano}-%`);

    // Lo que has terminado este ano, que es la cifra que de verdad
    // apetece ver en un resumen anual. Se mira updated_at porque es
    // cuando se marco como completado.
    const { terminados } = db
      .prepare(`
        SELECT COUNT(*) as terminados FROM entretenimiento_items
        WHERE status = 'completed' AND updated_at LIKE ?
      `)
      .get(`${ano}-%`);

    res.json({ ano, porDia, porTipo, porMes, terminados });
  });

  // Las sesiones de un item (su historial), o las ultimas de todo.
  router.get('/', (req, res) => {
    const { itemId, limite } = req.query;
    const tope = Math.max(1, Math.min(500, Number(limite) || 100));
    const rows = itemId
      ? db.prepare('SELECT * FROM entretenimiento_sesiones WHERE item_id = ? ORDER BY fecha DESC, id DESC LIMIT ?').all(itemId, tope)
      : db.prepare('SELECT * FROM entretenimiento_sesiones ORDER BY fecha DESC, id DESC LIMIT ?').all(tope);
    res.json(rows.map(serialize));
  });

  // Borrar una sesion apuntada por error. NO toca el progreso del item: si
  // se deshiciera solo, corregir un despiste de hace tres semanas te
  // movería el punto donde vas ahora, que casi nunca es lo que quieres.
  router.delete('/:id', (req, res) => {
    const info = db.prepare('DELETE FROM entretenimiento_sesiones WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  mountLocalRouter('/api/entretenimiento-sesiones', router);
})();
