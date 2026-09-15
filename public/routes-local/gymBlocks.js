// gymBlocks — NUEVO en el rediseno de Gimnasio (rama gimnasio-movil).
//
// A diferencia del resto de archivos de routes-local/, este NO es un
// porte de server/routes/ (alli no existe): los bloques de entrenamiento
// nacieron ya en la version movil. Sigue el mismo estilo que los demas
// (IIFE + createLocalRouter + borrado en cascada a mano).
//
// Un "bloque" es una etapa de entrenamiento con nombre propio (ej.
// "Volumen Invierno") que agrupa dias de entrenamiento (las filas de
// gym_routines, ver gymRoutines.js). Solo un bloque puede estar activo a
// la vez: el activo es el que se ofrece al empezar a entrenar.
(function () {
  const db = localDb;

  const router = createLocalRouter();

  // ---- Ciclo de dias (opcional) --------------------------------------
  //
  // Un bloque puede repetirse en ciclo: "dia 1 Empuje, dia 2 Tiron, dia 3
  // descanso, y vuelta a empezar". Las posiciones viven en
  // gym_block_cycle_days; routine_id a NULL es un descanso.
  //
  // Decision de Koku: el ciclo avanza POR ENTRENOS HECHOS, no por
  // calendario. Si te saltas un dia, al siguiente te sigue tocando lo
  // mismo -- el plan no te deja atras. Lo unico que avanza solo es un
  // DESCANSO, que se consume al pasar el dia (si no, un descanso te
  // bloquearia el ciclo para siempre).
  //
  // Quien avanza el cursor tras entrenar es el CLIENTE (POST
  // /:id/cycle/position), porque cuando lo que has entrenado no es lo que
  // tocaba hay que preguntarte donde recolocar el ciclo, y esa pregunta
  // vive en la pantalla, no aqui.

  function hoyISO() {
    // Fecha LOCAL, no UTC: a las 00:30 de Espana toISOString() todavia
    // devuelve el dia anterior y el ciclo se quedaria un dia atras.
    const d = new Date();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  function sumarUnDia(iso) {
    const [a, m, d] = iso.split('-').map(Number);
    const fecha = new Date(a, m - 1, d);
    fecha.setDate(fecha.getDate() + 1);
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${fecha.getFullYear()}-${mes}-${dia}`;
  }

  function leerCiclo(blockId) {
    return db
      .prepare('SELECT position, routine_id FROM gym_block_cycle_days WHERE block_id = ? ORDER BY position ASC')
      .all(blockId)
      .map((r) => ({ position: r.position, routineId: r.routine_id }));
  }

  // Pone el cursor al dia (fila) donde de verdad estamos hoy: solo
  // adelanta los DESCANSOS ya pasados. Devuelve la posicion resultante.
  // Escribe en la base si algo cambio, para que el widget y el aviso del
  // calendario lean siempre lo mismo sin recalcularlo cada uno por su
  // cuenta.
  function resolverCiclo(row) {
    if (row.cycle_enabled !== 1) return null;
    const dias = leerCiclo(row.id);
    if (dias.length === 0) return null;
    const hoy = hoyISO();

    let indice = dias.findIndex((d) => d.position === row.cycle_position);
    let fecha = row.cycle_position_date;
    if (indice === -1 || !fecha) {
      // Ciclo recien encendido (o con el cursor apuntando a una posicion
      // que ya no existe): empieza por el principio, hoy.
      indice = 0;
      fecha = hoy;
    }

    // Cada descanso ya pasado consume UN dia. El tope de vueltas evita
    // colgarse si el ciclo fuera todo descansos.
    let vueltas = 0;
    while (dias[indice].routineId === null && fecha < hoy && vueltas < dias.length) {
      indice = (indice + 1) % dias.length;
      fecha = sumarUnDia(fecha);
      if (fecha > hoy) fecha = hoy;
      vueltas += 1;
    }
    // Si eran todos descansos, el cursor se queda donde este pero con la
    // fecha al dia, para no repetir el barrido en cada lectura.
    if (vueltas >= dias.length) fecha = hoy;

    if (dias[indice].position !== row.cycle_position || fecha !== row.cycle_position_date) {
      db.prepare('UPDATE gym_blocks SET cycle_position = ?, cycle_position_date = ? WHERE id = ?')
        .run(dias[indice].position, fecha, row.id);
      row.cycle_position = dias[indice].position;
      row.cycle_position_date = fecha;
    }
    return dias[indice];
  }

  function serialize(row) {
    // dayCount se calcula al vuelo (no se guarda) para que la lista de
    // bloques pueda pintar "3 dias" sin pedir las rutinas de cada uno.
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM gym_routines WHERE block_id = ?').get(row.id);
    const cycleDays = leerCiclo(row.id);
    const hoy = resolverCiclo(row);
    return {
      id: row.id,
      name: row.name,
      position: row.position,
      isActive: row.is_active === 1,
      dayCount: n,
      cycleEnabled: row.cycle_enabled === 1,
      cycleDays,
      cyclePosition: row.cycle_position,
      cyclePositionDate: row.cycle_position_date,
      // Lo que toca HOY segun el ciclo (null si el bloque no lo usa).
      cycleToday: hoy ? { position: hoy.position, routineId: hoy.routineId, isRest: hoy.routineId === null } : null,
      cycleLength: cycleDays.length,
    };
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM gym_blocks ORDER BY position ASC, id ASC').all();
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'El bloque necesita un nombre.' });
    }
    const { count } = db.prepare('SELECT COUNT(*) as count FROM gym_blocks').get();
    // El primer bloque que se crea nace activo directamente (si no, el
    // boton "Empezar a entrenar" no tendria de donde tirar y habria que
    // dar un paso extra a mano justo despues de crearlo).
    const { n: activeCount } = db.prepare('SELECT COUNT(*) AS n FROM gym_blocks WHERE is_active = 1').get();
    const info = db
      .prepare('INSERT INTO gym_blocks (name, position, is_active) VALUES (?, ?, ?)')
      .run(name.trim(), count, activeCount > 0 ? 0 : 1);
    const row = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  });

  // -------------------------------------------------------------------
  // DUPLICAR UN BLOQUE
  // -------------------------------------------------------------------
  //
  // Se lleva SIEMPRE todo lo de dentro, sin preguntar: un bloque sin sus
  // dias (y sin los ejercicios de cada dia) no sirve de plantilla, que es
  // justo para lo que Koku lo pidio.
  //
  // Tres cosas que conviene entender del resultado:
  //
  // 1. LA COPIA NACE INACTIVA, siempre. Solo puede haber un bloque activo
  //    a la vez (ver /activate), y duplicar una plantilla no es decir
  //    "quiero entrenar esto ahora": eso se dice con "Activar".
  // 2. Solo se renombra EL BLOQUE. Sus dias conservan su nombre -- lo que
  //    duplicaste fue el bloque, no cada dia. Y los ejercicios ni se
  //    copian: gym_routine_exercises guarda una REFERENCIA a tu lista de
  //    ejercicios, asi que duplicar un bloque no te deja con tres "Press
  //    banca" en la lista.
  // 3. EL CICLO SE REMAPEA. gym_block_cycle_days apunta a dias por su id,
  //    asi que copiarlo tal cual dejaria el ciclo del bloque NUEVO
  //    apuntando a los dias del VIEJO -- y entonces editar un dia del
  //    original cambiaria lo que te toca en la copia. Por eso se traduce
  //    cada routine_id al id de su dia copiado. Un NULL (que es un
  //    DESCANSO, no un hueco) se queda como esta.
  router.post('/:id/duplicate', (req, res) => {
    const original = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    if (!original) return res.status(404).json({ error: 'not_found' });

    const nombres = db.prepare('SELECT name FROM gym_blocks').all().map((b) => b.name);
    const { count } = db.prepare('SELECT COUNT(*) as count FROM gym_blocks').get();
    const info = db
      .prepare('INSERT INTO gym_blocks (name, position, is_active, cycle_enabled, cycle_position, cycle_position_date) VALUES (?, ?, 0, ?, ?, ?)')
      .run(
        nombreDeCopia(original.name, nombres),
        count,
        original.cycle_enabled ? 1 : 0,
        original.cycle_position,
        original.cycle_position_date
      );
    const nuevoId = info.lastInsertRowid;

    // Los dias, con sus ejercicios. Se usa el duplicador de
    // routes-local/gymRoutines.js (expuesto como global) para no tener DOS
    // sitios que copien un dia: si algun dia gana una columna nueva, se
    // anade en uno solo.
    const mapaDeDias = new Map();
    db.prepare('SELECT id FROM gym_routines WHERE block_id = ? ORDER BY position ASC, id ASC')
      .all(original.id)
      .forEach((dia) => {
        if (typeof window.duplicarDiaDeGimnasio !== 'function') return;
        // El tercer argumento es "renombrar": a false, porque el dia
        // conserva su nombre -- lo que se duplico es el BLOQUE.
        const copia = window.duplicarDiaDeGimnasio(dia.id, nuevoId, false);
        if (!copia) return;
        mapaDeDias.set(dia.id, copia.id);
      });

    // Y el ciclo, traduciendo cada dia al suyo nuevo. Un dia que no se
    // pudiera traducir (no deberia pasar) se guarda como DESCANSO en vez
    // de apuntar al bloque viejo, que es el fallo que esto evita.
    const insertarPosicion = db.prepare('INSERT INTO gym_block_cycle_days (block_id, position, routine_id) VALUES (?, ?, ?)');
    leerCiclo(original.id).forEach((d) => {
      insertarPosicion.run(nuevoId, d.position, d.routineId === null ? null : (mapaDeDias.get(d.routineId) ?? null));
    });

    const row = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(nuevoId);
    res.status(201).json(serialize(row));
  });

  // Marca ESTE bloque como el activo (y desactiva el resto). Es una ruta
  // aparte en vez de un campo mas del PUT para que "activar" sea una
  // operacion de un solo paso imposible de dejar a medias: nunca puede
  // haber dos activos a la vez.
  // OJO: declarada ANTES de las rutas /:id de abajo por claridad, aunque
  // no colisiona con ellas (el router local exige mismo numero de
  // segmentos y esta tiene dos).
  router.post('/:id/activate', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    db.prepare('UPDATE gym_blocks SET is_active = 0 WHERE is_active = 1').run();
    db.prepare('UPDATE gym_blocks SET is_active = 1 WHERE id = ?').run(req.params.id);
    const row = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const { name } = req.body || {};
    db.prepare('UPDATE gym_blocks SET name = ? WHERE id = ?').run(
      name !== undefined && name.trim() ? name.trim() : existing.name,
      req.params.id
    );
    const row = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  router.delete('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // Borrar un bloque borra tambien sus dias (son plantillas, no
    // historial), con la MISMA cascada a mano que el DELETE de un dia
    // suelto en gymRoutines.js: las sesiones ya registradas se conservan
    // (routine_id a NULL) y solo se van las plantillas.
    const dayIds = db.prepare('SELECT id FROM gym_routines WHERE block_id = ?').all(req.params.id).map((r) => r.id);
    for (const dayId of dayIds) {
      db.prepare('UPDATE gym_sessions SET routine_id = NULL WHERE routine_id = ?').run(dayId);
      db.prepare('DELETE FROM gym_routine_exercises WHERE routine_id = ?').run(dayId);
      db.prepare('DELETE FROM gym_routines WHERE id = ?').run(dayId);
    }
    db.prepare('DELETE FROM gym_block_cycle_days WHERE block_id = ?').run(req.params.id);
    db.prepare('DELETE FROM gym_blocks WHERE id = ?').run(req.params.id);

    // Si el bloque borrado era el activo, activar otro (el primero por
    // posicion) para no dejar la app sin bloque activo si aun quedan.
    if (existing.is_active === 1) {
      const next = db.prepare('SELECT id FROM gym_blocks ORDER BY position ASC, id ASC').get();
      if (next) db.prepare('UPDATE gym_blocks SET is_active = 1 WHERE id = ?').run(next.id);
    }
    res.status(204).end();
  });

  // Guarda (o apaga) el ciclo del bloque de una vez: llega la lista
  // entera de posiciones y se reescribe. Es la forma mas simple de que
  // anadir, quitar y reordenar dias del ciclo compartan un solo camino.
  router.put('/:id/cycle', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const { enabled, days } = req.body || {};
    const lista = Array.isArray(days) ? days : [];
    if (lista.length > 60) {
      return res.status(400).json({ error: 'invalid_request', message: 'El ciclo no puede tener mas de 60 dias.' });
    }
    // Los dias del ciclo tienen que ser dias de ESTE bloque; cualquier
    // otro id (o basura) se guarda como descanso en vez de romper.
    const validos = new Set(
      db.prepare('SELECT id FROM gym_routines WHERE block_id = ?').all(req.params.id).map((r) => r.id)
    );
    db.prepare('DELETE FROM gym_block_cycle_days WHERE block_id = ?').run(req.params.id);
    lista.forEach((dia, i) => {
      const rid = dia && dia.routineId !== undefined && dia.routineId !== null ? Number(dia.routineId) : null;
      db.prepare('INSERT INTO gym_block_cycle_days (block_id, position, routine_id) VALUES (?, ?, ?)')
        .run(req.params.id, i + 1, rid !== null && validos.has(rid) ? rid : null);
    });

    const encendido = enabled ? 1 : 0;
    // El cursor se conserva si sigue siendo una posicion valida (editar
    // el nombre de un dia del ciclo no tiene por que devolverte al dia 1);
    // si no, vuelve al principio.
    const sigueValida = existing.cycle_position !== null && existing.cycle_position >= 1
      && existing.cycle_position <= lista.length;
    db.prepare('UPDATE gym_blocks SET cycle_enabled = ?, cycle_position = ?, cycle_position_date = ? WHERE id = ?')
      .run(
        encendido,
        lista.length === 0 ? null : (sigueValida ? existing.cycle_position : 1),
        lista.length === 0 ? null : (sigueValida ? existing.cycle_position_date || hoyISO() : hoyISO()),
        req.params.id
      );
    const row = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  // Mueve el cursor a mano. La usa el cliente al terminar un entreno
  // (para pasar al dia siguiente del ciclo) y cuando hay que recolocarlo
  // porque lo entrenado no era lo que tocaba.
  router.post('/:id/cycle/position', (req, res) => {
    const existing = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const dias = leerCiclo(req.params.id);
    if (dias.length === 0) {
      return res.status(400).json({ error: 'invalid_request', message: 'Este bloque no tiene ciclo.' });
    }
    const pedida = Number((req.body || {}).position);
    if (!dias.some((d) => d.position === pedida)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Esa posicion no esta en el ciclo.' });
    }
    // La fecha se pone a HOY: la posicion nueva empieza a contar ahora.
    // Si es un descanso, se consumira manana solo.
    db.prepare('UPDATE gym_blocks SET cycle_position = ?, cycle_position_date = ? WHERE id = ?')
      .run(pedida, hoyISO(), req.params.id);
    const row = db.prepare('SELECT * FROM gym_blocks WHERE id = ?').get(req.params.id);
    res.json(serialize(row));
  });

  mountLocalRouter('/api/gym-blocks', router);

})();
