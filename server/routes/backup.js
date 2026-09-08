// routes/backup.js — copias de seguridad POR HERRAMIENTA (ronda de la
// Tienda), y mas adelante en esta misma ronda el borrado de datos y la
// restauracion selectiva.
//
// El formato es la VERSION 2 del sobre que ya inauguro la app movil
// autonoma (rama movil-ui, public/backup.js): un unico archivo .json con
// { app, kind, version, exportedAt } por fuera. La v1 de alli mete la
// base SQLite entera en base64 y al importar sustituye TODO; esta v2, en
// cambio, lleva una seccion por herramienta con sus filas tal cual
// (SELECT *) y sus archivos binarios, para poder restaurar solo una
// parte y FUSIONAR sin duplicar (gracias al "uid" por fila, ver la
// migracion en db.js). Una copia v1 NO se puede abrir aqui todavia --
// compatibilidad cruzada apuntada como trabajo futuro en CLAUDE.md.
//
// Que herramienta tiene que tablas y que carpetas NO se decide aqui: se
// lee del registro compartido (public/tools-registry.js), el mismo
// archivo que pinta la Tienda en el navegador. Añadir una herramienta al
// registro hace que su copia funcione sola.
//
// Permisos: todo lo de este archivo exige ser el ordenador de confianza
// (requireTrusted, mismo criterio que routes/update.js): exportar
// escribe un temporal en el disco y se lleva TODOS los datos, y
// borrar/restaurar son destructivos -- un movil emparejado no deberia
// poder dispararlos contra el ordenador. La app movil autonoma tiene su
// propio backup local (movil-ui), no pasa por aqui.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { requireTrusted } = require('../auth');

const router = express.Router();

const TOOLS_REGISTRY = require(path.join(__dirname, '..', '..', 'public', 'tools-registry.js'));
const APP_VERSION = require(path.join(__dirname, '..', '..', 'package.json')).version;

// Carpeta de temporales de exportacion, dentro de DATA_DIR como el resto
// de datos. Se limpia al terminar cada descarga; si el proceso muere a
// mitad, el siguiente arranque no la toca (archivos huerfanos ocupan
// poco y se pueden borrar a mano) -- no compensa un limpiador mas.
const TMP_DIR = path.join(db.DATA_DIR, 'backups-tmp');

// Herramientas con algo que copiar: las que tienen tablas o carpetas
// (deja fuera a Archivos, cuya carpeta son archivos sueltos del usuario
// que no pertenecen a la app -- ver su entrada en el registro).
function exportableTools() {
  return TOOLS_REGISTRY.filter((t) => t.tablas.length || t.singletons.length || t.carpetas.length);
}

function findTool(id) {
  return exportableTools().find((t) => t.id === id) || null;
}

// Vaciar el WAL a la base principal antes de leerla entera. Sin esto,
// los ultimos cambios pueden estar solo en el archivo -wal y la copia
// saldria VIEJA sin que nada avise -- es el bug silencioso numero uno de
// cualquier backup de SQLite. Mismo try/catch tolerante que la
// activacion del WAL en db.js (si el PRAGMA falla, se sigue: la lectura
// via SQLite ve los datos igual, esto solo consolida el archivo).
function checkpointWal() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.warn('No se pudo hacer checkpoint del WAL antes de exportar:', err.message);
  }
}

// GET /api/backup/export?tools=gym,viajes — genera el archivo de copia y
// lo manda como descarga. Sin ?tools, va todo lo exportable.
//
// El JSON se ESCRIBE POR TROZOS a un archivo temporal en vez de montarse
// entero en memoria: las fotos de Viajes en base64 pueden ser cientos de
// megas y reventarian el limite de tamano de un string de Node. Se
// escribe en sincrono (fs.writeSync), igual que el resto del servidor
// habla con SQLite en sincrono -- es una app de una sola persona, no
// pasa nada por bloquear el proceso el rato que dure.
router.get('/export', requireTrusted, (req, res) => {
  // Set: un id repetido (?tools=gym,gym) escribiria su seccion dos veces
  // en el JSON (claves duplicadas, archivo invalido a efectos practicos).
  const pedidos = [...new Set(String(req.query.tools || '').split(',').map((s) => s.trim()).filter(Boolean))];
  let tools;
  if (pedidos.length) {
    tools = [];
    for (const id of pedidos) {
      const tool = findTool(id);
      if (!tool) return res.status(400).json({ error: 'unknown_tool', message: `Herramienta desconocida: ${id}` });
      tools.push(tool);
    }
  } else {
    tools = exportableTools();
  }

  checkpointWal();

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tmpPath = path.join(TMP_DIR, `${crypto.randomUUID()}.json`);
  const fd = fs.openSync(tmpPath, 'w');
  const write = (texto) => fs.writeSync(fd, texto);

  try {
    write(
      `{"app":"RemindMeLater","kind":"backup","version":2,"appVersion":${JSON.stringify(APP_VERSION)},` +
        `"exportedAt":${JSON.stringify(new Date().toISOString())},"tools":{`
    );

    tools.forEach((tool, i) => {
      if (i > 0) write(',');
      write(`${JSON.stringify(tool.id)}:{"version":${JSON.stringify(tool.version)},"rows":{`);

      // Las filas van tal cual salen de SQLite (SELECT *), SIN pasar por
      // los serializadores camelCase de las rutas: esos estan pensados
      // para el navegador; para restaurar hace falta el formato REAL de
      // la tabla, columna a columna. El orden de tablas es el del
      // registro (padres antes que hijos) -- la restauracion depende de
      // el, ver el comentario de "tablas" en tools-registry.js.
      const tablas = [...tool.tablas, ...tool.singletons];
      tablas.forEach((tabla, j) => {
        if (j > 0) write(',');
        write(`${JSON.stringify(tabla)}:[`);
        // node:sqlite no tiene cursores por lotes, pero .all() de una
        // tabla de datos personales (miles de filas, no millones) cabe
        // de sobra -- lo que NO cabria son las fotos, que van aparte.
        const filas = db.prepare(`SELECT * FROM ${tabla}`).all();
        filas.forEach((fila, k) => {
          if (k > 0) write(',');
          write(JSON.stringify(fila));
        });
        write(']');
      });
      write('},"files":[');

      // Archivos binarios de la herramienta (fotos de viajes, imagenes
      // de notas): uno a uno, en base64. Se lee cada archivo entero (los
      // archivos individuales son de megas, no de cientos de megas) y se
      // suelta al temporal antes de leer el siguiente.
      let primero = true;
      for (const carpeta of tool.carpetas) {
        const dirAbs = path.join(db.DATA_DIR, carpeta);
        if (!fs.existsSync(dirAbs)) continue;
        for (const nombre of fs.readdirSync(dirAbs)) {
          const rutaAbs = path.join(dirAbs, nombre);
          if (!fs.statSync(rutaAbs).isFile()) continue;
          if (!primero) write(',');
          primero = false;
          write(
            `{"dir":${JSON.stringify(carpeta)},"name":${JSON.stringify(nombre)},` +
              `"bytesBase64":${JSON.stringify(fs.readFileSync(rutaAbs).toString('base64'))}}`
          );
        }
      }
      write(']}');
    });

    write('}}');
    fs.closeSync(fd);
  } catch (err) {
    try { fs.closeSync(fd); } catch (e) { /* ya cerrado */ }
    fs.unlink(tmpPath, () => {});
    return res.status(500).json({ error: 'export_failed', message: err.message });
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const ids = tools.length === exportableTools().length ? 'todo' : tools.map((t) => t.id).join('+');
  res.download(tmpPath, `remindmelater-copia-${ids}-${fecha}.json`, () => {
    // Descarga terminada (bien o mal): el temporal ya no hace falta.
    fs.unlink(tmpPath, () => {});
  });
});

// ---------------------------------------------------------------------
// Borrado de datos por herramienta (fase 4 de la ronda de la Tienda).
//
// A diferencia de OCULTAR una herramienta (ajuste por dispositivo, en
// localStorage), esto borra sus datos DE VERDAD y para TODOS los
// dispositivos. Regla de oro decidida con Koku para los enlaces entre
// herramientas: DESENLAZAR, NUNCA DESTRUIR la otra herramienta -- el
// mismo precedente de finanzasTransactions.js (al borrar una transaccion
// suelta, el ticket de Viajes conserva su foto e importe y solo pierde
// el enlace). En concreto:
//   - Borrar Finanzas: los tickets/movimientos de Viajes se quedan con
//     su foto e importe, solo pierden su finanzas_transaction_id; los
//     viajes pierden su cuenta por defecto y su "enlazar con Finanzas".
//   - Borrar Viajes: las transacciones que Viajes creo en Finanzas SE
//     QUEDAN (son movimientos de dinero reales, borrarlas descuadraria
//     el saldo) -- por eso ANTES de borrar se desenlazan, para que
//     deleteMovementRow() (viajesEntries.js) no las borre en cascada
//     como hace al borrar un movimiento suelto a mano.
// ---------------------------------------------------------------------

// Solo se pueden borrar herramientas NO core y con datos propios (deja
// fuera a Calendario/Mi espacio y a Archivos).
function deletableTool(id) {
  const tool = findTool(id);
  return tool && !tool.core ? tool : null;
}

// Cuantos enlaces cruzados Viajes<->Finanzas hay ahora mismo -- para que
// el aviso previo diga la verdad con numeros, no un "puede que".
function countCrossLinks() {
  const movimientos = db
    .prepare('SELECT COUNT(*) AS n FROM viajes_entry_movements WHERE finanzas_transaction_id IS NOT NULL')
    .get().n;
  const adjuntos = db
    .prepare('SELECT COUNT(*) AS n FROM viajes_entry_attachments WHERE finanzas_transaction_id IS NOT NULL')
    .get().n;
  return movimientos + adjuntos;
}

// GET /api/backup/tool-summary/:id — conteos para el aviso de borrado:
// filas por tabla, archivos en disco y enlaces cruzados afectados.
router.get('/tool-summary/:id', requireTrusted, (req, res) => {
  const tool = deletableTool(req.params.id);
  if (!tool) return res.status(400).json({ error: 'unknown_tool', message: 'Esa herramienta no se puede borrar.' });

  let totalRows = 0;
  for (const tabla of tool.tablas) {
    totalRows += db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n;
  }
  let totalFiles = 0;
  for (const carpeta of tool.carpetas) {
    const dirAbs = path.join(db.DATA_DIR, carpeta);
    if (fs.existsSync(dirAbs)) totalFiles += fs.readdirSync(dirAbs).filter((n) => fs.statSync(path.join(dirAbs, n)).isFile()).length;
  }
  const crossLinks = tool.id === 'finanzas' || tool.id === 'viajes' ? countCrossLinks() : 0;
  res.json({ totalRows, totalFiles, crossLinks });
});

// DELETE /api/backup/tool-data/:id — borra TODOS los datos de la
// herramienta. Todo el SQL va en una transaccion (o entra entero o no
// entra nada); los archivos del disco se borran despues, best-effort --
// si el proceso muriera justo entre medias quedarian fotos huerfanas,
// que ocupan sitio pero no rompen nada.
router.delete('/tool-data/:id', requireTrusted, (req, res) => {
  const tool = deletableTool(req.params.id);
  if (!tool) return res.status(400).json({ error: 'unknown_tool', message: 'Esa herramienta no se puede borrar.' });

  db.exec('BEGIN');
  try {
    if (tool.id === 'finanzas') {
      // Desenlazar Viajes antes de tocar nada de Finanzas. Los viajes
      // afectados cambian filas de una tabla SINCRONIZADA
      // (viajes_trips), asi que se registra el upsert para que el movil
      // se entere -- serializeTrip ya viene exportado de viajesTrips.js.
      db.prepare('UPDATE viajes_entry_movements SET finanzas_transaction_id = NULL WHERE finanzas_transaction_id IS NOT NULL').run();
      db.prepare('UPDATE viajes_entry_attachments SET finanzas_transaction_id = NULL WHERE finanzas_transaction_id IS NOT NULL').run();
      const viajesAfectados = db
        .prepare('SELECT id FROM viajes_trips WHERE default_account_id IS NOT NULL OR finanzas_linked = 1')
        .all();
      db.prepare('UPDATE viajes_trips SET default_account_id = NULL, finanzas_linked = 0 WHERE default_account_id IS NOT NULL OR finanzas_linked = 1').run();
      const { serializeTrip } = require('./viajesTrips');
      for (const viaje of viajesAfectados) {
        const row = db.prepare('SELECT * FROM viajes_trips WHERE id = ?').get(viaje.id);
        db.recordSyncChange('viajes_trips', viaje.id, 'upsert', serializeTrip(row), null);
      }
    }

    if (tool.id === 'viajes') {
      // Desenlazar PRIMERO: deleteTripCascade -> deleteEntryCascade ->
      // deleteMovementRow borra la transaccion de Finanzas enlazada de
      // cada movimiento (comportamiento correcto al borrar un movimiento
      // suelto a mano, pero NO aqui -- decision de Koku: al borrar la
      // herramienta entera, el dinero se queda en Finanzas). Con el
      // enlace ya a NULL, esa cascada no encuentra nada que borrar.
      db.prepare('UPDATE viajes_entry_movements SET finanzas_transaction_id = NULL WHERE finanzas_transaction_id IS NOT NULL').run();
      db.prepare('UPDATE viajes_entry_attachments SET finanzas_transaction_id = NULL WHERE finanzas_transaction_id IS NOT NULL').run();
      // deleteTripCascade ya borra las fotos del disco y registra los
      // deletes en sync_log (viajes_trips/viajes_entries son tablas
      // sincronizadas) -- no reinventar ese orden aqui.
      const { deleteTripCascade } = require('./viajesTrips');
      const viajes = db.prepare('SELECT id FROM viajes_trips').all();
      for (const viaje of viajes) deleteTripCascade(viaje.id, null);
    } else {
      // Resto de herramientas (y las tablas de Finanzas tras el
      // desenlace de arriba): borrar en orden INVERSO al del registro --
      // el registro lista padres antes que hijos, borrar va al reves
      // para no dejar nunca una fila hija apuntando a un padre borrado.
      for (const tabla of [...tool.tablas].reverse()) {
        db.prepare(`DELETE FROM ${tabla}`).run();
      }
      // Tablas de fila unica/config: se resetean a vacio, no se borra la
      // fila (el resto del codigo asume que existe).
      if (tool.singletons.includes('finanzas_settings')) {
        db.prepare('UPDATE finanzas_settings SET monthly_budget_limit = NULL, savings_goal_min = NULL WHERE id = 1').run();
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'delete_failed', message: err.message });
  }

  // Carpetas de archivos propias (Viajes ya limpio las suyas dentro de
  // deleteTripCascade; esto cubre herramientas futuras con carpeta).
  for (const carpeta of tool.carpetas) {
    const dirAbs = path.join(db.DATA_DIR, carpeta);
    if (!fs.existsSync(dirAbs)) continue;
    for (const nombre of fs.readdirSync(dirAbs)) {
      try { fs.unlinkSync(path.join(dirAbs, nombre)); } catch (e) { /* best-effort */ }
    }
  }

  res.json({ success: true });
});

// ---------------------------------------------------------------------
// Restauracion selectiva con fusion (fase 5 de la ronda de la Tienda).
//
// Flujo en dos pasos, con validacion ANTES de tocar nada (misma idea que
// el import de movil-ui: si el archivo esta mal, enterarse con los datos
// actuales intactos):
//   1. POST /inspect  — sube el archivo, se valida el sobre y se guarda
//      en un temporal; devuelve que herramientas trae y cuantas filas/
//      archivos cada una, mas un inspectId.
//   2. POST /restore  — {inspectId, tools: [ids]} aplica SOLO las
//      herramientas elegidas, leyendo el temporal (el archivo no se
//      vuelve a subir).
//
// La restauracion es "AÑADIR SIN DUPLICAR" (decision de Koku, no
// "reemplazar"): cada fila viaja con su uid (identidad fija, ver la
// migracion en db.js) y al aplicar:
//   - uid ya existente en esta base -> se SALTA (restaurar dos veces la
//     misma copia no duplica nada), pero su id actual se apunta para que
//     las filas hijas del archivo puedan seguir apuntandole.
//   - uid nuevo -> INSERT con id autoincremental NUEVO; las referencias
//     (routine_id, trip_id, account_id...) se recolocan buscando el uid
//     del padre, nunca reutilizando el numero viejo del archivo.
//   - referencia a algo que no esta ni en el archivo ni en esta base
//     (p. ej. finanzas_transaction_id restaurando solo Viajes) -> NULL,
//     misma filosofia que resolveRef() en routes/sync.js. Si la columna
//     es NOT NULL (un set sin su sesion), la fila entera se salta.
//
// Que columna apunta a que tabla NO esta escrito a mano: se le pregunta
// a SQLite (PRAGMA foreign_key_list), asi una tabla nueva en el registro
// funciona sola mientras declare sus REFERENCES en el esquema.
// ---------------------------------------------------------------------

// Inspecciones pendientes de confirmar: inspectId -> timestamp. El
// archivo en si vive en TMP_DIR como <inspectId>.inspect.json. Mismo
// patron de Map en memoria + caducidad que pairing.js; 30 minutos da de
// sobra para leer el aviso y marcar casillas.
const PENDING_INSPECTS = new Map();
const INSPECT_TTL_MS = 30 * 60 * 1000;

function pruneInspects() {
  const ahora = Date.now();
  for (const [id, ts] of PENDING_INSPECTS) {
    if (ahora - ts > INSPECT_TTL_MS) {
      PENDING_INSPECTS.delete(id);
      fs.unlink(path.join(TMP_DIR, `${id}.inspect.json`), () => {});
    }
  }
}

// express.raw y no express.json: el archivo puede pesar cientos de megas
// (fotos en base64) y el middleware global de JSON no debe intentar
// parsearlo dos veces -- el cliente lo manda como octet-stream a
// proposito. El limite alto es deliberado: es una app local de una
// persona, no una API publica.
router.post('/inspect', requireTrusted, express.raw({ type: '*/*', limit: '1gb' }), (req, res) => {
  pruneInspects();
  let datos;
  try {
    datos = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'not_backup', message: 'Ese archivo no es una copia de seguridad de RemindMeLater.' });
  }
  if (!datos || datos.app !== 'RemindMeLater' || datos.kind !== 'backup') {
    return res.status(400).json({ error: 'not_backup', message: 'Ese archivo no es una copia de seguridad de RemindMeLater.' });
  }
  if (datos.version === 1) {
    // Las copias v1 son de la app movil autonoma (rama movil-ui): llevan
    // la base SQLite entera, no secciones por herramienta. Abrirlas aqui
    // es trabajo futuro apuntado en CLAUDE.md.
    return res.status(400).json({ error: 'v1_backup', message: 'Esa copia es de la app móvil autónoma (formato antiguo); todavía no se puede restaurar aquí.' });
  }
  if (datos.version !== 2 || typeof datos.tools !== 'object' || !datos.tools) {
    return res.status(400).json({ error: 'unknown_version', message: 'Esa copia es de una versión más nueva de la app; actualiza primero.' });
  }

  const resumen = [];
  for (const [id, seccion] of Object.entries(datos.tools)) {
    const tool = findTool(id);
    if (!tool) continue; // herramienta que esta app no conoce: se ignora
    let filas = 0;
    for (const tabla of Object.keys(seccion.rows || {})) {
      // Los singletons (user_profile, finanzas_settings) no llevan uid a
      // proposito (son de fila unica, se fusionan por su cuenta) -- solo
      // las tablas de datos normales lo exigen.
      const esSingleton = tool.singletons.includes(tabla);
      for (const fila of seccion.rows[tabla]) {
        // Sin uid no hay forma de fusionar sin duplicar -- una copia v2
        // siempre lo lleva, esto solo puede pasar con un archivo editado
        // a mano o corrupto. Mejor rechazar entero que duplicar a ciegas.
        if (!esSingleton && (!fila || typeof fila.uid !== 'string' || !fila.uid)) {
          return res.status(400).json({ error: 'missing_uids', message: `La copia trae filas sin identidad (uid) en ${tabla} — parece dañada.` });
        }
        filas++;
      }
    }
    resumen.push({ id, nombre: tool.nombre, rows: filas, files: (seccion.files || []).length });
  }
  if (!resumen.length) {
    return res.status(400).json({ error: 'empty_backup', message: 'La copia no trae ninguna herramienta que esta app conozca.' });
  }

  const inspectId = crypto.randomUUID();
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(TMP_DIR, `${inspectId}.inspect.json`), req.body);
  PENDING_INSPECTS.set(inspectId, Date.now());
  res.json({ inspectId, exportedAt: datos.exportedAt || null, tools: resumen });
});

router.post('/restore', requireTrusted, (req, res) => {
  const { inspectId, tools: pedidos } = req.body || {};
  if (!inspectId || !PENDING_INSPECTS.has(inspectId)) {
    return res.status(400).json({ error: 'inspect_expired', message: 'La inspección caducó — vuelve a elegir el archivo.' });
  }
  const rutaTmp = path.join(TMP_DIR, `${path.basename(String(inspectId))}.inspect.json`);
  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(rutaTmp, 'utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'inspect_expired', message: 'La inspección caducó — vuelve a elegir el archivo.' });
  }

  // Herramientas a aplicar, EN EL ORDEN DEL REGISTRO (no el del cliente):
  // asi las secciones con dependencias entre si (Finanzas antes que
  // Viajes) siempre entran en un orden que deja resolver los enlaces.
  const elegidas = exportableTools().filter((t) => Array.isArray(pedidos) && pedidos.includes(t.id) && datos.tools[t.id]);
  if (!elegidas.length) return res.status(400).json({ error: 'nothing_selected', message: 'No hay nada que restaurar.' });

  // uid de cada fila del ARCHIVO por (tabla, id viejo) -- de TODAS las
  // secciones del archivo, elegidas o no: restaurando solo Viajes de una
  // copia viajes+finanzas, el finanzas_transaction_id viejo se puede
  // traducir a uid con la seccion de Finanzas del archivo y buscar ese
  // uid en la base actual (estara si Finanzas ya se restauro otro dia).
  const oldIdToUid = {};
  for (const seccion of Object.values(datos.tools)) {
    for (const [tabla, filas] of Object.entries(seccion.rows || {})) {
      oldIdToUid[tabla] = oldIdToUid[tabla] || {};
      for (const fila of filas) {
        if (fila && fila.id !== undefined && fila.uid) oldIdToUid[tabla][fila.id] = fila.uid;
      }
    }
  }
  // uid -> id en ESTA base, de lo restaurado/saltado en esta pasada (la
  // busqueda cae a un SELECT por uid si no esta aqui).
  const uidToNewId = {};
  const idPorUid = (tabla, uid) => {
    if (uidToNewId[tabla] && uidToNewId[tabla][uid] !== undefined) return uidToNewId[tabla][uid];
    const row = db.prepare(`SELECT rowid AS rid FROM ${tabla} WHERE uid = ?`).get(uid);
    return row ? row.rid : null;
  };
  const resolverRef = (tablaDestino, idViejo) => {
    if (idViejo === null || idViejo === undefined) return null;
    const uid = oldIdToUid[tablaDestino] ? oldIdToUid[tablaDestino][idViejo] : undefined;
    if (!uid) return null;
    return idPorUid(tablaDestino, uid);
  };

  const { SYNC_SERIALIZERS } = require('./sync');
  const resultado = {};

  for (const tool of elegidas) {
    const seccion = datos.tools[tool.id];
    const conteo = { inserted: 0, skipped: 0, files: 0 };
    const insertadasPorTabla = {};

    db.exec('BEGIN');
    try {
      for (const tabla of [...tool.tablas, ...tool.singletons]) {
        const filas = (seccion.rows && seccion.rows[tabla]) || [];
        if (!filas.length) continue;

        // Singletons (fila unica de config): solo se aplican si lo de
        // ahora esta en valores por defecto -- en una fusion no se pisan
        // ajustes vivos.
        if (tool.singletons.includes(tabla)) {
          if (tabla === 'finanzas_settings') {
            const actual = db.prepare('SELECT * FROM finanzas_settings WHERE id = 1').get();
            const porDefecto = !actual || (actual.monthly_budget_limit === null && actual.savings_goal_min === null);
            if (porDefecto && filas[0]) {
              db.prepare('UPDATE finanzas_settings SET monthly_budget_limit = ?, savings_goal_min = ? WHERE id = 1')
                .run(filas[0].monthly_budget_limit ?? null, filas[0].savings_goal_min ?? null);
            } else conteo.skipped += 1;
          } else if (tabla === 'user_profile') {
            const actual = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
            if ((!actual || !actual.name) && filas[0] && filas[0].name) {
              db.prepare('UPDATE user_profile SET name = ? WHERE id = 1').run(filas[0].name);
            } else conteo.skipped += 1;
          }
          continue;
        }

        const infoCols = db.prepare(`PRAGMA table_info(${tabla})`).all();
        const nombresCols = new Set(infoCols.map((c) => c.name));
        const notNull = new Set(infoCols.filter((c) => c.notnull).map((c) => c.name));
        const fkPorCol = new Map();
        for (const fk of db.prepare(`PRAGMA foreign_key_list(${tabla})`).all()) {
          fkPorCol.set(fk.from, fk.table);
        }
        // Auto-referencias (carpeta dentro de carpeta, cartera dentro de
        // cartera): el padre puede venir DESPUES en el propio archivo,
        // asi que se inserta con NULL y se recoloca en una segunda
        // pasada al terminar la tabla.
        const autoRefsPendientes = [];

        filaLoop: for (const fila of filas) {
          const existente = db.prepare(`SELECT rowid AS rid FROM ${tabla} WHERE uid = ?`).get(fila.uid);
          if (existente) {
            uidToNewId[tabla] = uidToNewId[tabla] || {};
            uidToNewId[tabla][fila.uid] = existente.rid;
            conteo.skipped++;
            continue;
          }
          // special_days usa la fecha como clave primaria: el mismo dia
          // marcado en las dos bases (con uids distintos) no debe chocar
          // -- el de aqui gana, el del archivo se salta.
          if (tabla === 'special_days' && db.prepare('SELECT 1 FROM special_days WHERE date = ?').get(fila.date)) {
            conteo.skipped++;
            continue;
          }

          const cols = [];
          const valores = [];
          const autoRefs = [];
          for (const [col, valor] of Object.entries(fila)) {
            if (col === 'id' || !nombresCols.has(col)) continue; // id nuevo; columnas que esta version ya no tenga se ignoran
            let v = valor;
            if (fkPorCol.has(col) && col !== 'id') {
              const destino = fkPorCol.get(col);
              if (destino === tabla) {
                autoRefs.push({ col, idViejo: v });
                v = null;
              } else {
                v = resolverRef(destino, v);
                if (v === null && valor !== null && valor !== undefined && notNull.has(col)) {
                  // Fila hija sin su padre (p. ej. copia parcial editada):
                  // mejor saltarla que reventar la herramienta entera.
                  conteo.skipped++;
                  continue filaLoop;
                }
              }
            }
            cols.push(col);
            valores.push(v === undefined ? null : v);
          }
          const info = db
            .prepare(`INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
            .run(...valores);
          uidToNewId[tabla] = uidToNewId[tabla] || {};
          uidToNewId[tabla][fila.uid] = Number(info.lastInsertRowid);
          conteo.inserted++;
          (insertadasPorTabla[tabla] = insertadasPorTabla[tabla] || []).push(Number(info.lastInsertRowid));
          for (const ar of autoRefs) autoRefsPendientes.push({ uid: fila.uid, ...ar });
        }

        for (const pendiente of autoRefsPendientes) {
          const nuevoPadre = resolverRef(tabla, pendiente.idViejo);
          if (nuevoPadre !== null) {
            db.prepare(`UPDATE ${tabla} SET ${pendiente.col} = ? WHERE uid = ?`).run(nuevoPadre, pendiente.uid);
          }
        }
      }

      // Tablas sincronizadas: registrar el upsert de cada fila nueva para
      // que el movil se entere en la proxima sincronizacion manual. Se
      // hace al FINAL de la herramienta (no fila a fila) porque los
      // serializadores de Viajes embeben a sus hijos (paises, adjuntos,
      // movimientos), que para entonces ya estan restaurados.
      for (const [tabla, ids] of Object.entries(insertadasPorTabla)) {
        const serializar = SYNC_SERIALIZERS[tabla];
        if (!serializar) continue;
        const idCol = tabla === 'special_days' ? 'date' : 'id';
        for (const id of ids) {
          const row = db.prepare(`SELECT * FROM ${tabla} WHERE rowid = ?`).get(id);
          if (row) db.recordSyncChange(tabla, row[idCol], 'upsert', serializar(row), null);
        }
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      resultado[tool.id] = { error: err.message };
      // La herramienta que fallo no entro NADA (transaccion); se sigue
      // con las demas para que un fallo puntual no tire toda la tanda.
      continue;
    }

    // Archivos binarios, fuera de la transaccion (best-effort): solo se
    // escriben los que no existan ya con ese nombre.
    for (const archivo of seccion.files || []) {
      if (!archivo || typeof archivo.name !== 'string' || typeof archivo.dir !== 'string') continue;
      if (!tool.carpetas.includes(archivo.dir)) continue; // carpeta que no es de esta herramienta: ni caso
      const dirAbs = path.join(db.DATA_DIR, archivo.dir);
      fs.mkdirSync(dirAbs, { recursive: true });
      const destino = path.join(dirAbs, path.basename(archivo.name));
      if (fs.existsSync(destino)) continue;
      try {
        fs.writeFileSync(destino, Buffer.from(archivo.bytesBase64 || '', 'base64'));
        conteo.files++;
      } catch (e) { /* best-effort */ }
    }

    resultado[tool.id] = conteo;
  }

  // Inspeccion consumida: fuera el temporal.
  PENDING_INSPECTS.delete(inspectId);
  fs.unlink(rutaTmp, () => {});

  res.json({ tools: resultado });
});

module.exports = router;
