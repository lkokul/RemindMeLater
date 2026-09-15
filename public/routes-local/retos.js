// retos — la herramienta "Retos", escrita ya directamente para la app sin
// servidor (no viene portada de server/routes/ como las demas: nacio
// aqui).
//
// Un reto es, para la pantalla, una TAREA y nada mas: no mide
// repeticiones, ni kilos, ni tiempo. Solo se marca. Lo unico que esta
// ruta calcula de verdad son dos cosas que no se pueden guardar sin que
// se queden viejas:
//   - si un HABITO esta hecho en el periodo que corre ahora mismo,
//   - y cuantos periodos seguidos llevas (la racha).
//
// Envuelto en un IIFE como el resto de rutas, para que los nombres
// repetidos entre archivos no choquen al cargarse todos como <script> en
// el mismo ambito global.
(function () {
  const db = localDb;

  const router = createLocalRouter();

  // Tope de profundidad del arbol. Koku pidio anidacion INFINITA y asi
  // se comporta en la practica; esto es solo una red contra una base
  // corrupta con un ciclo dentro (un padre que es su propio nieto), que
  // si no dejaria el bucle dando vueltas para siempre.
  const MAX_PROFUNDIDAD = 50;

  // Fecha LOCAL, no UTC: a las 00:30 de España toISOString() todavia
  // devuelve el dia anterior, y un habito diario se marcaria en el dia
  // de ayer. Mismo cuidado que hoyISO() del ciclo de Gimnasio.
  function fechaLocalISO(d) {
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  function hoy() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // Una fecha suelta ('2026-09-14' o un timestamp de SQLite) a Date local
  // a medianoche. Se parte el texto a mano en vez de dejarselo a
  // new Date(texto): una cadena 'YYYY-MM-DD' la interpreta el navegador
  // como UTC, y eso volveria a correr el dia hacia atras.
  function aFecha(texto) {
    if (!texto) return null;
    const m = String(texto).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function sumarDias(fecha, dias) {
    return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + dias);
  }

  // Semana ISO (lunes a domingo), la misma convencion que ya usa la racha
  // semanal del Gimnasio.
  function claveSemana(fecha) {
    const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    // El jueves de esa semana decide a que año pertenece (regla ISO).
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const jueves = new Date(d.getTime());
    const primero = new Date(jueves.getFullYear(), 0, 4);
    primero.setDate(primero.getDate() + 3 - ((primero.getDay() + 6) % 7));
    const semana = 1 + Math.round((jueves - primero) / (7 * 24 * 3600 * 1000));
    return `${jueves.getFullYear()}-W${String(semana).padStart(2, '0')}`;
  }

  // En que "periodo" cae una fecha para ESTE habito. Es la clave que se
  // guarda en retos_hechos: dos marcas del mismo periodo son la misma
  // marca (lo garantiza el UNIQUE de la tabla).
  function claveDePeriodo(reto, fecha) {
    const frecuencia = reto.frequency || 'diario';
    if (frecuencia === 'semanal') return claveSemana(fecha);
    if (frecuencia === 'mensual') return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
    if (frecuencia === 'cada_x_dias') {
      const cada = Math.max(1, Number(reto.freq_every) || 1);
      // Anclado al dia en que se creo el habito, NO a una rejilla fija del
      // calendario: "cada 3 dias" cuenta desde que TU lo empezaste.
      const origen = aFecha(reto.created_at) || fecha;
      const dias = Math.floor((fecha - origen) / (24 * 3600 * 1000));
      return `c${Math.floor(dias / cada)}`;
    }
    return fechaLocalISO(fecha);
  }

  // Una fecha cualquiera DENTRO del periodo anterior al de `fecha`. No
  // hace falta que sea el primer dia del periodo: solo se usa para pedir
  // su clave.
  function fechaDelPeriodoAnterior(reto, fecha) {
    const frecuencia = reto.frequency || 'diario';
    if (frecuencia === 'semanal') return sumarDias(fecha, -7);
    if (frecuencia === 'mensual') return new Date(fecha.getFullYear(), fecha.getMonth() - 1, 1);
    if (frecuencia === 'cada_x_dias') return sumarDias(fecha, -Math.max(1, Number(reto.freq_every) || 1));
    return sumarDias(fecha, -1);
  }

  function marcasDe(retoId) {
    return db.prepare('SELECT period_key, done_at FROM retos_hechos WHERE reto_id = ? ORDER BY done_at ASC').all(retoId);
  }

  // Racha = periodos CONSECUTIVOS hacia atras. Si el periodo de ahora
  // todavia no esta marcado NO se rompe la racha: se empieza a contar
  // desde el anterior. Un habito diario marcado ayer y todavia no hoy
  // sigue diciendo "racha de N", que es lo que se espera a media mañana.
  function rachaActual(reto, claves) {
    let fecha = hoy();
    if (!claves.has(claveDePeriodo(reto, fecha))) fecha = fechaDelPeriodoAnterior(reto, fecha);
    let racha = 0;
    // Cada vuelta exige un acierto, asi que el bucle no puede pasar del
    // numero de marcas guardadas.
    while (claves.has(claveDePeriodo(reto, fecha))) {
      racha += 1;
      fecha = fechaDelPeriodoAnterior(reto, fecha);
    }
    return racha;
  }

  // La mejor racha de toda la historia. Se recorre lo apuntado en orden y
  // se mira, marca a marca, si la anterior cae justo en el periodo de
  // antes. La fecha representativa de cada marca es su done_at (siempre
  // se marca "ahora", asi que cae dentro de su propio periodo).
  function mejorRacha(reto, filas) {
    let mejor = 0;
    let actual = 0;
    let claveAnterior = null;
    for (const fila of filas) {
      const fecha = aFecha(fila.done_at);
      if (!fecha) continue;
      const clave = claveDePeriodo(reto, fecha);
      if (clave === claveAnterior) continue;
      if (claveAnterior !== null && claveDePeriodo(reto, fechaDelPeriodoAnterior(reto, fecha)) === claveAnterior) actual += 1;
      else actual = 1;
      claveAnterior = clave;
      if (actual > mejor) mejor = actual;
    }
    return mejor;
  }

  // "Hecho" no significa lo mismo en los dos tipos, y esa es justo la
  // diferencia entre ellos:
  //   meta   -> la columna done, que se queda puesta para siempre.
  //   habito -> hay marca del periodo que corre ahora, y se vacia sola
  //             cuando empieza el siguiente.
  function estaHecho(reto, claves) {
    if (reto.kind === 'habito') return claves.has(claveDePeriodo(reto, hoy()));
    return reto.done === 1;
  }

  function serialize(row, hijos) {
    const filas = row.kind === 'habito' ? marcasDe(row.id) : [];
    const claves = new Set(filas.map((f) => f.period_key));
    const propios = hijos.filter((h) => h.parentId === row.id);
    return {
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      description: row.description,
      kind: row.kind,
      frequency: row.frequency,
      freqEvery: row.freq_every,
      done: estaHecho(row, claves),
      doneAt: row.done_at,
      position: row.position,
      // Contadores de los hijos DIRECTOS: es lo que se pinta como "3 de 5"
      // y lo que rellena la barra. Cumplir todos los subretos NO marca al
      // padre (decision de Koku: "puedo cumplir el subreto de hacer 10
      // flexiones y seguir sin poder hacer 50") -- la barra se llena, pero
      // el reto lo marcas tu.
      childCount: propios.length,
      doneChildCount: propios.filter((h) => h.done).length,
      streak: row.kind === 'habito' ? rachaActual(row, claves) : 0,
      bestStreak: row.kind === 'habito' ? mejorRacha(row, filas) : 0,
      createdAt: row.created_at,
    };
  }

  function todos() {
    const filas = db.prepare('SELECT * FROM retos ORDER BY position ASC, id ASC').all();
    // Dos pasadas: la primera resuelve "hecho" de cada uno (que para un
    // habito hay que calcularlo), la segunda ya puede contar cuantos hijos
    // hechos tiene cada padre sin recalcular nada.
    const estado = filas.map((f) => ({
      id: f.id,
      parentId: f.parent_id,
      done: estaHecho(f, new Set(f.kind === 'habito' ? marcasDe(f.id).map((m) => m.period_key) : [])),
    }));
    return filas.map((f) => serialize(f, estado));
  }

  function existe(id) {
    return db.prepare('SELECT * FROM retos WHERE id = ?').get(id);
  }

  // Todos los descendientes de un reto, de arriba abajo. Se usa para
  // borrar (un reto se lleva a sus subretos) y para marcar en cascada.
  function descendientes(id) {
    const salida = [];
    let nivel = [id];
    for (let i = 0; i < MAX_PROFUNDIDAD && nivel.length; i++) {
      const hijos = [];
      for (const padre of nivel) {
        for (const fila of db.prepare('SELECT * FROM retos WHERE parent_id = ?').all(padre)) {
          hijos.push(fila.id);
          salida.push(fila);
        }
      }
      nivel = hijos;
    }
    return salida;
  }

  // Colgar A de B solo vale si B no esta ya dentro de A -- si no, los dos
  // desaparecerian de la lista (un trozo de arbol suelto apuntandose a si
  // mismo). Misma comprobacion que hace noteFolders.js.
  function esUnCiclo(id, nuevoPadre) {
    if (!nuevoPadre) return false;
    if (Number(nuevoPadre) === Number(id)) return true;
    let actual = existe(nuevoPadre);
    for (let i = 0; i < MAX_PROFUNDIDAD && actual; i++) {
      if (Number(actual.id) === Number(id)) return true;
      actual = actual.parent_id ? existe(actual.parent_id) : null;
    }
    return false;
  }

  function siguientePosicion(parentId) {
    const fila = parentId
      ? db.prepare('SELECT MAX(position) as m FROM retos WHERE parent_id = ?').get(parentId)
      : db.prepare('SELECT MAX(position) as m FROM retos WHERE parent_id IS NULL').get();
    return (fila && fila.m != null ? fila.m : -1) + 1;
  }

  function limpiarFrecuencia(kind, frequency, freqEvery) {
    // Un reto de meta no tiene frecuencia, y guardarsela seria dejar un
    // dato que nadie lee esperando a confundir a alguien.
    if (kind !== 'habito') return { frequency: null, freqEvery: null };
    const valida = ['diario', 'semanal', 'mensual', 'cada_x_dias'];
    const f = valida.includes(frequency) ? frequency : 'diario';
    const cada = f === 'cada_x_dias' ? Math.min(365, Math.max(2, Number(freqEvery) || 2)) : null;
    return { frequency: f, freqEvery: cada };
  }

  router.get('/', (req, res) => {
    res.json(todos());
  });

  router.post('/', (req, res) => {
    const { name, description, kind, frequency, freqEvery, parentId } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'El reto necesita un nombre.' });
    }
    const tipo = kind === 'habito' ? 'habito' : 'meta';
    const padre = parentId ? Number(parentId) : null;
    if (padre && !existe(padre)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Ese reto padre ya no existe.' });
    }
    const { frequency: f, freqEvery: cada } = limpiarFrecuencia(tipo, frequency, freqEvery);
    const info = db
      .prepare('INSERT INTO retos (parent_id, name, description, kind, frequency, freq_every, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(padre, name.trim(), description && description.trim() ? description.trim() : null, tipo, f, cada, siguientePosicion(padre));
    res.status(201).json(serialize(existe(info.lastInsertRowid), []));
  });

  router.put('/:id', (req, res) => {
    const actual = existe(req.params.id);
    if (!actual) return res.status(404).json({ error: 'not_found' });

    const { name, description, kind, frequency, freqEvery, parentId } = req.body || {};
    const tipo = kind === 'habito' || kind === 'meta' ? kind : actual.kind;
    const { frequency: f, freqEvery: cada } = limpiarFrecuencia(
      tipo,
      frequency !== undefined ? frequency : actual.frequency,
      freqEvery !== undefined ? freqEvery : actual.freq_every,
    );

    let padre = actual.parent_id;
    if (parentId !== undefined) {
      padre = parentId ? Number(parentId) : null;
      if (padre && !existe(padre)) {
        return res.status(400).json({ error: 'invalid_request', message: 'Ese reto padre ya no existe.' });
      }
      if (esUnCiclo(actual.id, padre)) {
        return res.status(400).json({ error: 'invalid_request', message: 'Un reto no puede meterse dentro de uno de sus propios subretos.' });
      }
      if (padre !== actual.parent_id) {
        db.prepare('UPDATE retos SET position = ? WHERE id = ?').run(siguientePosicion(padre), actual.id);
      }
    }

    db.prepare("UPDATE retos SET parent_id = ?, name = ?, description = ?, kind = ?, frequency = ?, freq_every = ?, updated_at = datetime('now') WHERE id = ?")
      .run(
        padre,
        name !== undefined && name.trim() ? name.trim() : actual.name,
        description === undefined ? actual.description : (description && description.trim() ? description.trim() : null),
        tipo,
        f,
        cada,
        actual.id,
      );
    res.json(serialize(existe(actual.id), []));
  });

  // Marcar / desmarcar. MARCAR arrastra a todos los subretos (si has hecho
  // 100 flexiones, has hecho las de 10 y las de 50); DESMARCAR no toca a
  // nadie mas, a proposito: deshacer un toque mal dado no puede borrarte
  // lo que si habias hecho.
  router.post('/:id/done', (req, res) => {
    const reto = existe(req.params.id);
    if (!reto) return res.status(404).json({ error: 'not_found' });
    const marcar = !(req.body && req.body.done === false);

    const afectados = marcar ? [reto, ...descendientes(reto.id)] : [reto];
    for (const fila of afectados) {
      if (fila.kind === 'habito') {
        const clave = claveDePeriodo(fila, hoy());
        if (marcar) {
          db.prepare('INSERT OR IGNORE INTO retos_hechos (reto_id, period_key) VALUES (?, ?)').run(fila.id, clave);
        } else {
          db.prepare('DELETE FROM retos_hechos WHERE reto_id = ? AND period_key = ?').run(fila.id, clave);
        }
      } else {
        db.prepare("UPDATE retos SET done = ?, done_at = ?, updated_at = datetime('now') WHERE id = ?")
          .run(marcar ? 1 : 0, marcar ? new Date().toISOString() : null, fila.id);
      }
    }
    res.json(todos());
  });

  // Reordenar entre HERMANOS (lo que Koku eligio que hiciera "Mover"): se
  // intercambia la posicion con el vecino de arriba o de abajo. Las
  // posiciones se reescriben enteras antes de mover porque una base vieja
  // puede tener varias filas con la misma (todas a 0), y entonces
  // intercambiar no moveria nada.
  router.post('/:id/move', (req, res) => {
    const reto = existe(req.params.id);
    if (!reto) return res.status(404).json({ error: 'not_found' });
    const paso = (req.body && req.body.direction) === 'up' ? -1 : 1;

    const hermanos = reto.parent_id
      ? db.prepare('SELECT * FROM retos WHERE parent_id = ? ORDER BY position ASC, id ASC').all(reto.parent_id)
      : db.prepare('SELECT * FROM retos WHERE parent_id IS NULL ORDER BY position ASC, id ASC').all();
    hermanos.forEach((h, i) => {
      if (h.position !== i) db.prepare('UPDATE retos SET position = ? WHERE id = ?').run(i, h.id);
      h.position = i;
    });

    const i = hermanos.findIndex((h) => h.id === reto.id);
    const j = i + paso;
    if (j < 0 || j >= hermanos.length) return res.json(todos()); // ya esta en el extremo
    db.prepare('UPDATE retos SET position = ? WHERE id = ?').run(j, hermanos[i].id);
    db.prepare('UPDATE retos SET position = ? WHERE id = ?').run(i, hermanos[j].id);
    res.json(todos());
  });

  // Borrar se lleva TODOS los subretos, tal como lo pidio Koku ("se
  // desliza y se puede editar mover eliminar (con todos sus subretos)").
  // Es lo contrario de lo que hacen las carpetas de Notas, donde el
  // contenido sube un nivel -- aqui un subreto sin su reto no significa
  // nada ("hacer 50 flexiones" sin "llegar a 100").
  //
  // En cascada A MANO, sin ON DELETE CASCADE de SQL, como todo el resto
  // del proyecto.
  router.delete('/:id', (req, res) => {
    const reto = existe(req.params.id);
    if (!reto) return res.status(404).json({ error: 'not_found' });
    const todas = [...descendientes(reto.id).map((f) => f.id), reto.id];
    for (const id of todas) {
      db.prepare('DELETE FROM retos_hechos WHERE reto_id = ?').run(id);
      db.prepare('DELETE FROM retos WHERE id = ?').run(id);
    }
    res.status(204).end();
  });

  mountLocalRouter('/api/retos', router);

})();
