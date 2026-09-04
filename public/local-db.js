// local-db.js — la base de datos, ahora dentro del propio movil.
//
// Hasta esta ronda los datos vivian en el ordenador: un SQLite de
// verdad (node:sqlite) detras de un servidor Express, y el movil le
// preguntaba por wifi. Al quitar el servidor hace falta que SQLite viva
// aqui, en el navegador/WebView -- y eso es exactamente lo que hace
// sql.js: SQLite compilado a WebAssembly (public/vendor/sql-wasm.js +
// .wasm, licencia MIT, vendorizados para que la app funcione sin
// internet y sin ningun paso de compilacion).
//
// POR QUE sql.js Y NO REESCRIBIR TODO A IndexedDB:
// el backend tenia 45+ consultas con SQL de verdad (JOIN, GROUP BY,
// SUM, substr sobre fechas...) sobre todo en Finanzas y Gimnasio.
// Reescribir eso a mano seria enorme y facil de romper sin que se note.
// Trayendo SQLite entero, esas consultas siguen siendo las mismas.
//
// POR QUE sql.js Y NO UN PLUGIN NATIVO DE SQLite:
// porque sql.js es SINCRONO, igual que node:sqlite. Un plugin nativo
// seria asincrono y obligaria a convertir a await los ~396 sitios que
// consultan la base, es decir, a reescribir todas las rutas. Asi, el
// codigo portado se queda practicamente igual.
//
// Este archivo expone `localDb`, que imita la API de node:sqlite que ya
// usaban las rutas -- prepare(sql).all()/.get()/.run() y exec(sql) --
// para que el codigo portado no tenga que cambiar.

// Clave dentro del almacen "_meta" de db-local.js donde se guardan los
// bytes de la base. sql.js trabaja en memoria, asi que sin esto los
// datos se perderian al cerrar la app.
const LOCAL_SQLITE_META_KEY = 'sqliteBytes';

// Cuanto se espera antes de volcar a IndexedDB tras una escritura. Sin
// esta espera, algo que escriba varias filas seguidas (por ejemplo
// guardar un viaje con sus paises) volcaria la base entera una vez por
// fila. Con 250ms, esa rafaga se convierte en un solo volcado, y sigue
// siendo imperceptible para quien usa la app.
const LOCAL_SQLITE_SAVE_DELAY_MS = 250;

let sqlJsModule = null;
let sqlDatabase = null;
let localSaveTimer = null;
let localSavePromise = Promise.resolve();

// node:sqlite acepta los parametros sueltos -- stmt.get(a, b) -- y
// sql.js los quiere en un array. Ademas, un array unico tambien es
// valido en las dos, asi que hay que distinguir los dos casos.
function toBindArray(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

// Red de seguridad para valores que SQLite no sabe guardar tal cual.
// Las rutas ya escriben `? 1 : 0` para los booleanos y `null` para lo
// ausente, pero un `undefined` despistado (o un booleano que se cuele
// en el futuro) reventaria el bind con un error poco descriptivo; asi
// se comporta como esperaria quien escribio la ruta.
function normalizeBindValue(value) {
  if (value === undefined) return null;
  if (value === true) return 1;
  if (value === false) return 0;
  return value;
}

function bindParams(stmt, params) {
  const values = toBindArray(params).map(normalizeBindValue);
  if (values.length > 0) stmt.bind(values);
}

// Volcado a IndexedDB. Se llama tras cada escritura, pero agrupando
// (ver LOCAL_SQLITE_SAVE_DELAY_MS). Las imagenes de notas NO viven
// dentro de la base a proposito: la inflarian y harian lento cada
// volcado -- van a su propio almacen (ver la fase de imagenes).
function scheduleLocalDbSave() {
  if (localSaveTimer) clearTimeout(localSaveTimer);
  localSaveTimer = setTimeout(() => {
    localSaveTimer = null;
    localSavePromise = saveLocalDbNow();
  }, LOCAL_SQLITE_SAVE_DELAY_MS);
}

async function saveLocalDbNow() {
  if (!sqlDatabase) return;
  try {
    await metaSet(LOCAL_SQLITE_META_KEY, sqlDatabase.export());
  } catch (err) {
    // Que falle el volcado no debe tumbar la operacion que ya tuvo
    // exito en memoria; se avisa y se reintentara en la siguiente
    // escritura.
    console.error('No se pudo guardar la base local:', err);
  }
}

// Fuerza el volcado pendiente ahora mismo (sin esperar al temporizador)
// y espera a que termine. Util antes de exportar la base o al cerrar.
async function flushLocalDb() {
  if (localSaveTimer) {
    clearTimeout(localSaveTimer);
    localSaveTimer = null;
    localSavePromise = saveLocalDbNow();
  }
  await localSavePromise;
}

// La cara publica: misma forma que el `db` de node:sqlite que usaban
// las rutas del servidor, para que el codigo portado no cambie.
const localDb = {
  exec(sql) {
    sqlDatabase.exec(sql);
    scheduleLocalDbSave();
  },

  prepare(sql) {
    return {
      all(...params) {
        const stmt = sqlDatabase.prepare(sql);
        try {
          bindParams(stmt, params);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally {
          stmt.free();
        }
      },

      // node:sqlite devuelve `undefined` cuando no hay fila (no `null`),
      // y las rutas comprueban justo eso.
      get(...params) {
        const stmt = sqlDatabase.prepare(sql);
        try {
          bindParams(stmt, params);
          return stmt.step() ? stmt.getAsObject() : undefined;
        } finally {
          stmt.free();
        }
      },

      // Devuelve { changes, lastInsertRowid } como node:sqlite -- las
      // rutas usan lastInsertRowid en 39 sitios (para devolver el id
      // recien creado) y changes en 20 (para saber si un DELETE/UPDATE
      // llego a tocar algo).
      run(...params) {
        const stmt = sqlDatabase.prepare(sql);
        try {
          bindParams(stmt, params);
          stmt.step();
        } finally {
          stmt.free();
        }
        const changes = sqlDatabase.getRowsModified();
        const idRows = sqlDatabase.exec('SELECT last_insert_rowid() AS id');
        const lastInsertRowid = idRows.length > 0 ? idRows[0].values[0][0] : 0;
        scheduleLocalDbSave();
        return { changes, lastInsertRowid };
      },
    };
  },
};

// Arranque: carga sql.js, recupera la base guardada (o crea una nueva)
// y aplica el esquema. Idempotente -- llamarlo dos veces no rehace nada.
let localDbReadyPromise = null;

function initLocalDatabase() {
  if (localDbReadyPromise) return localDbReadyPromise;
  localDbReadyPromise = (async () => {
    sqlJsModule = await initSqlJs({
      // sql-wasm.js pide su .wasm por separado; sin esto lo buscaria en
      // la raiz del sitio en vez de en vendor/.
      locateFile: (file) => `vendor/${file}`,
    });

    const saved = await metaGet(LOCAL_SQLITE_META_KEY);
    sqlDatabase = saved ? new sqlJsModule.Database(new Uint8Array(saved)) : new sqlJsModule.Database();

    // Las claves foraneas no vienen activadas por defecto en SQLite.
    // El servidor tampoco las activaba (los borrados en cascada se
    // hacen a mano en las rutas, ver CLAUDE.md), asi que se deja igual
    // para no cambiar el comportamiento al portar.

    applyLocalSchema(localDb);
    await flushLocalDb();
    return localDb;
  })();
  return localDbReadyPromise;
}
