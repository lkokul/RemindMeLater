// db.js — capa de acceso a datos con SQLite.
// Usamos node:sqlite, el modulo de SQLite integrado en Node (desde la
// 22.5). Es "sincrono" como better-sqlite3 (sin promesas: cada consulta
// se resuelve en la misma linea) pero no requiere compilar nada nativo
// al instalar — evita el problema mas tipico al montar esto en un
// ordenador nuevo (necesitar Python/build tools para better-sqlite3).
// Nota: Node lo marca como "experimental" y avisa por consola; es solo
// un aviso, funciona con normalidad.
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DATA_DIR = require('./dataDir');

const db = new DatabaseSync(path.join(DATA_DIR, 'remindmelater.db'));

// WAL es mas rapido con lecturas/escrituras simultaneas, pero necesita
// que la carpeta soporte memoria compartida entre procesos — algunas
// unidades de red o carpetas sincronizadas (OneDrive, mounts remotos...)
// no lo soportan y darian "disk I/O error". Como esta app la usa una
// persona a la vez, no es imprescindible: si falla, seguimos con el
// modo por defecto (mas compatible) en vez de romper el arranque.
try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch (err) {
  console.warn('No se pudo activar el modo WAL de SQLite, sigo con el modo por defecto:', err.message);
}

// --- Esquema -----------------------------------------------------------
// Se ejecuta cada vez que arranca el servidor; CREATE TABLE IF NOT EXISTS
// hace que sea seguro repetirlo (no borra nada si la tabla ya existe).
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_at TEXT NOT NULL,           -- fecha/hora ISO, ej. 2026-08-14T10:00:00
    end_at TEXT,                      -- puede ser NULL si no hay hora de fin
    all_day INTEGER NOT NULL DEFAULT 0,
    reminder_minutes_before INTEGER,  -- NULL = sin recordatorio
    reminder_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    paired_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#5b8cff',   -- hex, ej. #ff6b6b
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Biblioteca de temas de estilo, compartida entre todos los dispositivos.
  -- "colors" guarda un JSON con las 8 variables personalizables, ej.
  -- {"bg":"#0f1115","surface":"#171a21", ...}. Cada dispositivo elige por
  -- su cuenta cual de estos temas mostrar (ver devices.active_theme_id y
  -- app_settings mas abajo), asi que guardar uno no fuerza a nada mas.
  CREATE TABLE IF NOT EXISTS themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    colors TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Almacen generico clave/valor para ajustes del "ordenador anfitrion"
  -- (el que corre el servidor y no pasa por el flujo de emparejamiento,
  -- asi que no tiene una fila en devices). De momento solo guardamos que
  -- tema tiene activo, pero sirve para cualquier ajuste futuro de ese tipo.
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Tu perfil: una sola fila (id fijo a 1). "name" es el nickname que
  -- eliges y puedes cambiar cuando quieras; "public_id" es un identificador
  -- estable que se genera UNA vez y no cambia, para poder diferenciarte si
  -- algun dia hay mas de una persona usando el calendario (o un origen
  -- automatico, tipo una integracion de WhatsApp) aunque compartan nombre.
  -- Se muestra oculto por defecto en la interfaz (ver Configuracion > Perfil).
  CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL DEFAULT '',
    public_id TEXT NOT NULL
  );

  -- Dias marcados a mano como festivo o especial (no hay forma de saber
  -- festivos automaticamente, asi que se marcan uno a uno desde el
  -- panel de dia). "date" en formato YYYY-MM-DD; compartido entre todos
  -- los dispositivos, como los grupos o los temas.
  CREATE TABLE IF NOT EXISTS special_days (
    date TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('holiday', 'special'))
  );

  -- Notas de "Mi espacio" (Fase 2): titulo + contenido, compartidas
  -- entre todos los dispositivos igual que eventos/tareas/grupos. Desde
  -- la Fase 4 el contenido puede llevar formato basico (negrita, cursiva,
  -- listas) como HTML saneado -- ver la migracion de body_format mas
  -- abajo y routes/notes.js.
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT,
    created_by_name TEXT,
    created_by_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Carpetas de notas (Fase 3): nombre + icono + color, sistema propio
  -- SEPARADO de los Grupos del calendario (esos son para eventos/tareas,
  -- estas son solo para organizar notas dentro de Mi espacio). Solo
  -- organizacion, sin PIN ni bloqueo -- eso es "ocultar" por nota
  -- individual (ver notes.hidden), un toggle simple sin contraseña.
  CREATE TABLE IF NOT EXISTS note_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT NOT NULL DEFAULT '#5b8cff',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Registro de cambios para la sincronizacion movil-ordenador (fase
  -- "movil"): cada vez que se crea/edita/borra algo en events, notes,
  -- groups, note_folders o special_days, se anade UNA fila aqui (ver
  -- recordSyncChange() mas abajo). El propio "id" de esta tabla hace de
  -- cursor -- un dispositivo recuerda "el ultimo id que ya vi" y pide
  -- "todo lo que tenga id mayor que ese" (routes/sync.js). "payload" es
  -- el mismo JSON que ya devuelve la ruta REST normal para esa fila (o
  -- NULL si op='delete': un borrado no tiene contenido, solo hace falta
  -- saber que paso). Es una tabla que solo CRECE (nunca se edita una
  -- fila ya escrita), asi que sirve tanto de historial como de cursor.
  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
    payload TEXT,
    device_origin TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Extension "Gimnasio" (primera de las 3 anunciadas en la pantalla de
  -- Extensiones -- ver #extensions-view en index.html): registro de
  -- entrenamientos, con prefijo "gym_" para no chocar con nada de lo de
  -- arriba. Borrado en cascada A MANO en routes/, no con ON DELETE
  -- CASCADE de SQL -- mismo patron que groups/note_folders.
  CREATE TABLE IF NOT EXISTS gym_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    muscle_group TEXT,          -- opcional, texto libre (ej. "Pierna")
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Rutinas reutilizables (ej. "Dia de pierna"), mismo patron
  -- icono+color+posicion que groups/note_folders.
  CREATE TABLE IF NOT EXISTS gym_routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT NOT NULL DEFAULT '#5b8cff',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Que ejercicios lleva cada rutina, en que orden, con series/repeticiones
  -- ORIENTATIVAS (target_sets/target_reps, opcionales -- solo una sugerencia,
  -- lo que de verdad se hizo se registra en gym_sets al completar la sesion).
  CREATE TABLE IF NOT EXISTS gym_routine_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL REFERENCES gym_routines(id),
    exercise_id INTEGER NOT NULL REFERENCES gym_exercises(id),
    position INTEGER NOT NULL DEFAULT 0,
    target_sets INTEGER,
    target_reps INTEGER
  );

  -- Una sesion real en una fecha. routine_id es opcional: NULL = sesion
  -- libre (ejercicios sueltos elegidos sobre la marcha, sin plantilla).
  CREATE TABLE IF NOT EXISTS gym_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,                             -- YYYY-MM-DD
    routine_id INTEGER REFERENCES gym_routines(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Cada serie registrada de verdad dentro de una sesion. weight_kg
  -- SIEMPRE se guarda en kilogramos -- la libra (ajuste por dispositivo,
  -- ver settings.js) es solo de entrada/presentacion en el cliente, para
  -- que las graficas de progreso comparen siempre la misma unidad.
  CREATE TABLE IF NOT EXISTS gym_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES gym_sessions(id),
    exercise_id INTEGER NOT NULL REFERENCES gym_exercises(id),
    set_number INTEGER NOT NULL,
    reps INTEGER,
    weight_kg REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Extension "Finanzas" (tercera tarjeta de #extensions-view): gastos,
  -- ingresos e inversiones. "initial_balance" es el saldo de partida al
  -- empezar a trackear esta cuenta -- el saldo de verdad NUNCA se guarda,
  -- se calcula sumando/restando finanzas_transactions y
  -- finanzas_investment_transactions de esa cuenta (ver
  -- routes/finanzasAccounts.js).
  CREATE TABLE IF NOT EXISTS finanzas_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT NOT NULL DEFAULT '#5b8cff',
    initial_balance REAL NOT NULL DEFAULT 0,
    -- Puramente informativa (ej. "Corriente", "Inversion") -- sin CHECK
    -- que la limite a una lista cerrada, para poder anadir un tipo nuevo
    -- el dia de mañana solo tocando el select en app.js, sin migracion.
    -- NO restringe en que movimiento se puede usar la cuenta.
    type TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Categorias de GASTO (no de ingreso), mismo patron icono+color que
  -- groups/note_folders -- las crea Koku, no hay lista fija.
  CREATE TABLE IF NOT EXISTS finanzas_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT NOT NULL DEFAULT '#5b8cff',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Gastos e ingresos normales de una cuenta. "amount" siempre positivo,
  -- el signo lo da "type". "counts_toward_budget" es el flag que pidio
  -- Koku ("si aplica o no sobre este gasto maximo") -- solo tiene
  -- sentido cuando type='expense', se ignora en ingresos.
  CREATE TABLE IF NOT EXISTS finanzas_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES finanzas_accounts(id),
    type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES finanzas_categories(id),
    counts_toward_budget INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Plantillas de gasto fijo recurrente: a diferencia del checkbox
  -- "Gasto fijo" (finanzas_transactions.is_fixed, marcado a mano en un
  -- movimiento suelto), esto SI genera la transaccion real sola, cada
  -- vez que toca (ver server/finanzasRecurringChecker.js). "day_of_month"
  -- se usa siempre (1-31, clampado al ultimo dia real de cada mes si
  -- hace falta -- ej. dia 31 en febrero); "month_of_year" (1-12) solo
  -- aplica si frequency='annual'. "end_date" es el "ultimo mes de pago"
  -- que pidio Koku -- NULL significa que sigue indefinidamente.
  -- "last_generated_period" guarda el periodo YA generado ('YYYY-MM' en
  -- mensual, 'YYYY' en anual) para no duplicar y para no rellenar hacia
  -- atras si el servidor estuvo apagado varios periodos.
  CREATE TABLE IF NOT EXISTS finanzas_recurring_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES finanzas_accounts(id),
    category_id INTEGER REFERENCES finanzas_categories(id),
    amount REAL NOT NULL,
    description TEXT,
    frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'annual')),
    day_of_month INTEGER NOT NULL,
    month_of_year INTEGER,
    start_date TEXT NOT NULL,
    end_date TEXT,
    counts_toward_budget INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    last_generated_period TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Compra/venta de un activo y dividendos recibidos. Solo registro
  -- MANUAL a proposito -- sin conectar a ninguna API externa de
  -- cotizaciones en vivo (confirmado con Koku, coherente con que el
  -- resto de la app es local-first). "asset_name" es texto libre (no
  -- una tabla de activos aparte, ej. "Apple (AAPL)"). quantity/
  -- price_per_unit son NULL en dividendos -- "amount" siempre lleva el
  -- total (quantity*price_per_unit en compra/venta, lo recibido en
  -- dividendo), para no tener que recalcularlo cada vez que se lee.
  CREATE TABLE IF NOT EXISTS finanzas_investment_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES finanzas_accounts(id),
    asset_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'dividend')),
    quantity REAL,
    price_per_unit REAL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Limite de gasto mensual: una sola fila (igual que user_profile), sin
  -- historizar limites anteriores -- si lo cambias, aplica desde ese
  -- momento para cualquier calculo de "mes actual".
  CREATE TABLE IF NOT EXISTS finanzas_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    monthly_budget_limit REAL
  );

  -- Carteras de inversion, anidadas -- calco de note_folders (mismo
  -- parent_id auto-referenciado, mismas comprobaciones de ciclo en
  -- routes/finanzasPortfolios.js) pero SIN icono, mismo criterio que ya
  -- se aplico a note_folders (el icono generico de carpeta ya diferencia
  -- bien, no hacia falta elegir uno por carpeta). parent_id NULL =
  -- cartera de nivel raiz.
  CREATE TABLE IF NOT EXISTS finanzas_portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#5b8cff',
    position INTEGER NOT NULL DEFAULT 0,
    parent_id INTEGER REFERENCES finanzas_portfolios(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Activos como entidad real (antes de esta ronda, finanzas_investment_transactions.asset_name
  -- era solo texto libre sin identidad propia -- ver migracion mas abajo
  -- que crea una fila aqui por cada asset_name distinto ya usado).
  -- portfolio_id NULL = activo sin cartera asignada (nivel raiz del
  -- arbol de seleccion de la grafica de Inversiones).
  CREATE TABLE IF NOT EXISTS finanzas_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    portfolio_id INTEGER REFERENCES finanzas_portfolios(id),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Actualizaciones MANUALES de precio de un activo, para llevar su
  -- evolucion en el tiempo -- sin conectar a ninguna cotizacion en vivo
  -- (mismo criterio que finanzas_investment_transactions: registro
  -- manual a proposito, "tendra su error pero es para mi"). Solo
  -- precio/unidad + fecha -- la cantidad NO se guarda aqui, ya se puede
  -- calcular de las transacciones de compra/venta si hiciera falta.
  CREATE TABLE IF NOT EXISTS finanzas_asset_valuations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES finanzas_assets(id),
    date TEXT NOT NULL,
    price_per_unit REAL NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Extension "Lecturas" (tercera tarjeta de #extensions-view): historial
  -- de entretenimiento en general, no solo libros -- manga, comic, libro,
  -- serie, anime, pelicula. Una "saga" es el contenedor OBLIGATORIO de
  -- todo (hasta algo suelto es una saga de un solo item), para poder
  -- agrupar bajo un mismo nombre cosas de tipos distintos (ej. el manga Y
  -- el anime de la misma obra) en vez de repetir el nombre en cada fila.
  CREATE TABLE IF NOT EXISTS lecturas_sagas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Cada cosa concreta dentro de una saga (una temporada, un tomo, una
  -- pelicula suelta...). "genres" es un array JSON de texto libre (ej.
  -- ["Accion","Fantasia"]) en vez de una tabla de generos aparte -- mismo
  -- criterio que ya usa el proyecto para themes.colors, no hace falta
  -- normalizarlo para el volumen de una coleccion personal. "status"
  -- cubre tambien la lista de deseos (wishlist = todavia no lo tienes/no
  -- has empezado), sin una seccion aparte. "owned_count/owned_total" es
  -- una cantidad simple ("tengo 5 de 10"), sin marcar cuales exactamente.
  CREATE TABLE IF NOT EXISTS lecturas_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    saga_id INTEGER NOT NULL REFERENCES lecturas_sagas(id),
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('manga','comic','libro','serie','anime','pelicula')),
    description TEXT,
    rating REAL,
    status TEXT NOT NULL DEFAULT 'wishlist' CHECK (status IN ('wishlist','in_progress','completed','dropped')),
    genres TEXT,
    progress_current INTEGER,
    progress_total INTEGER,
    progress_unit TEXT,
    owned_count INTEGER,
    owned_total INTEGER,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Extension "Viajes" (avion en #extensions-view): un viaje puede tocar
  -- VARIOS paises (ej. un interrail), de ahi la tabla de union
  -- viajes_trip_countries en vez de una columna "country" directa en
  -- viajes_trips. country_code es el codigo ISO 3166-1 alfa-2 en
  -- minusculas (mismo formato que los "id" del mapa SVG en
  -- public/viajes-world-map.svg, con la excepcion "_somaliland", el unico
  -- territorio sin codigo ISO propio que trae ese mapa). Sin CHECK contra
  -- una lista cerrada de paises a proposito: el selector del cliente ya
  -- limita a los paises reales del mapa, y ser permisivo aqui evita tener
  -- que tocar el servidor si el mapa cambia de fuente el dia de mañana.
  CREATE TABLE IF NOT EXISTS viajes_trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#5b8cff',
    start_date TEXT,
    end_date TEXT,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS viajes_trip_countries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES viajes_trips(id),
    country_code TEXT NOT NULL,
    UNIQUE(trip_id, country_code)
  );

  -- Una entrada de "bitacora" = un dia (o momento) concreto dentro de un
  -- viaje. Contenido en texto plano simple (sin el editor de bloques/
  -- formato de Notas -- eso es otra pieza aparte del proyecto), de sobra
  -- para "que se ha hecho ese dia".
  CREATE TABLE IF NOT EXISTS viajes_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES viajes_trips(id),
    date TEXT NOT NULL,
    content TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Fotos dentro de una entrada -- mismo patron que note_images (nombre
  -- de archivo UUID en disco, ver routes/viajesEntries.js), guardadas en
  -- DATA_DIR/viajes-photos/. "amount" es opcional: si se rellena, este
  -- adjunto es un ticket/recibo (no una foto de recuerdo cualquiera), y
  -- puede enlazarse a un movimiento real de Finanzas
  -- (finanzas_transaction_id) SOLO si el ajuste global
  -- app_settings.viajesFinanzasLinked esta activado. Borrar el adjunto
  -- borra tambien el movimiento de Finanzas enlazado si lo tenia -- es
  -- "ese ticket concreto", no una plantilla que genera cosas por su
  -- cuenta (a diferencia de finanzas_recurring_expenses, que SI deja
  -- huerfanas sus transacciones generadas al borrarse la plantilla).
  CREATE TABLE IF NOT EXISTS viajes_entry_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES viajes_entries(id),
    filename TEXT NOT NULL,
    amount REAL,
    finanzas_transaction_id INTEGER REFERENCES finanzas_transactions(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migracion sencilla: group_id y active_theme_id se anadieron despues de
// crear las tablas events/devices en versiones anteriores. SQLite no
// tiene "ADD COLUMN IF NOT EXISTS", asi que miramos el esquema actual
// (pragma table_info) y solo la anadimos si todavia no existe. Esto hace
// seguro re-arrancar el servidor tanto en una base de datos nueva como
// en una ya existente de antes.
const eventColumns = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
if (!eventColumns.includes('group_id')) {
  db.exec('ALTER TABLE events ADD COLUMN group_id INTEGER REFERENCES groups(id)');
}

const deviceColumns = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
if (!deviceColumns.includes('active_theme_id')) {
  db.exec('ALTER TABLE devices ADD COLUMN active_theme_id INTEGER REFERENCES themes(id)');
}
if (!deviceColumns.includes('icon')) {
  // Simbolo o emoji que se muestra JUNTO al nombre del dispositivo, no
  // como parte del nombre (por eso es su propia columna).
  db.exec('ALTER TABLE devices ADD COLUMN icon TEXT');
}

const groupColumns = db.prepare('PRAGMA table_info(groups)').all().map((c) => c.name);
if (!groupColumns.includes('icon')) {
  db.exec('ALTER TABLE groups ADD COLUMN icon TEXT');
}
// completed_color: color opcional que usan las TAREAS de este grupo (ver
// mas abajo) cuando se marcan como hechas, en vez del color normal del
// grupo. Si se deja sin poner (NULL), la interfaz calcula un tono
// atenuado del color normal del grupo como valor por defecto — esta
// columna solo guarda un color EXPLICITO cuando lo has elegido tu.
if (!groupColumns.includes('completed_color')) {
  db.exec('ALTER TABLE groups ADD COLUMN completed_color TEXT');
}

// created_by_*: quien (que nickname/perfil) creo cada evento. Se rellena
// solo al crear el evento (ver routes/events.js), con el perfil de
// user_profile en ese momento — asi que si luego cambias tu nickname, los
// eventos antiguos se quedan con el nombre que tenian cuando se crearon,
// como una "foto" de ese momento, no un enlace en vivo.
if (!eventColumns.includes('created_by_name')) {
  db.exec('ALTER TABLE events ADD COLUMN created_by_name TEXT');
}
if (!eventColumns.includes('created_by_id')) {
  db.exec('ALTER TABLE events ADD COLUMN created_by_id TEXT');
}

// is_task / done: una tarea es, por dentro, una fila de events con
// is_task = 1. Comparte titulo, grupo, etc. con los eventos normales, pero
// ademas puede marcarse como hecha (done) y, a diferencia de un evento,
// puede no tener fecha (ver la migracion de start_at mas abajo).
const eventColumnsForTasks = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
if (!eventColumnsForTasks.includes('is_task')) {
  db.exec('ALTER TABLE events ADD COLUMN is_task INTEGER NOT NULL DEFAULT 0');
}
if (!eventColumnsForTasks.includes('done')) {
  db.exec('ALTER TABLE events ADD COLUMN done INTEGER NOT NULL DEFAULT 0');
}

// Migracion puntual: start_at pasa de obligatorio a opcional, porque las
// tareas sueltas (sin fecha limite) no tienen que llevar ninguna — solo
// viven en la lista de Tareas, no en el calendario. SQLite no permite
// quitar un NOT NULL con un simple ALTER TABLE, asi que reconstruimos la
// tabla entera: la copia nueva con el esquema correcto, se copian las
// filas, se borra la vieja y se renombra la nueva. Se detecta si hace
// falta mirando el "notnull" que da PRAGMA table_info para start_at; una
// vez hecha, table_info ya no lo marca como NOT NULL y esto no se repite.
const startAtInfo = db.prepare('PRAGMA table_info(events)').all().find((c) => c.name === 'start_at');
if (startAtInfo && startAtInfo.notnull) {
  db.exec(`
    CREATE TABLE events_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      start_at TEXT,
      end_at TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      reminder_minutes_before INTEGER,
      reminder_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      group_id INTEGER REFERENCES groups(id),
      created_by_name TEXT,
      created_by_id TEXT,
      is_task INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO events_new (id, title, description, location, start_at, end_at, all_day, reminder_minutes_before, reminder_sent, created_at, updated_at, group_id, created_by_name, created_by_id, is_task, done)
      SELECT id, title, description, location, start_at, end_at, all_day, reminder_minutes_before, reminder_sent, created_at, updated_at, group_id, created_by_name, created_by_id, is_task, done FROM events;
    DROP TABLE events;
    ALTER TABLE events_new RENAME TO events;
  `);
}

// inverse_colors: variante clara/oscura "pareja" de un tema, opcional. Ver
// routes/themes.js para el saneado y routes/... para como se elige cual
// de las dos ensenar (modo sistema/claro/oscuro, ajuste de cada dispositivo).
const themeColumns = db.prepare('PRAGMA table_info(themes)').all().map((c) => c.name);
if (!themeColumns.includes('inverse_colors')) {
  db.exec('ALTER TABLE themes ADD COLUMN inverse_colors TEXT');
}
// updated_at: para sincronizar la biblioteca de temas al movil (fase
// "movil") -- no existia hasta ahora. Mismo patron que groups/note_folders
// mas arriba: se anade sin default (ALTER TABLE no admite datetime('now')
// como default) y se rellena con un UPDATE aparte.
if (!themeColumns.includes('updated_at')) {
  db.exec('ALTER TABLE themes ADD COLUMN updated_at TEXT');
  db.exec("UPDATE themes SET updated_at = created_at WHERE updated_at IS NULL");
}

// hidden: nota marcada como "ocultar" (se ve borrosa en la lista hasta
// que se "destapa" con un clic — ver routes/notes.js). No es un bloqueo
// de verdad, solo evita que se lea a primera vista. Hubo una version con
// contraseña compartida opcional para destapar (app_settings
// notes_hide_password_*), pero se quito -- ver la limpieza de esas
// claves mas abajo.
const noteColumns = db.prepare('PRAGMA table_info(notes)').all().map((c) => c.name);
if (!noteColumns.includes('hidden')) {
  db.exec('ALTER TABLE notes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
}
// folder_id: carpeta de la nota (Fase 3), opcional -- NULL = sin
// carpeta (nivel raiz). Ver note_folders arriba.
if (!noteColumns.includes('folder_id')) {
  db.exec('ALTER TABLE notes ADD COLUMN folder_id INTEGER REFERENCES note_folders(id)');
}

// parent_id: las carpetas pueden contener otras carpetas (navegacion
// tipo explorador de archivos, ver routes/noteFolders.js) -- NULL =
// carpeta de nivel raiz. La comprobacion de que no se formen ciclos (una
// carpeta como su propio antepasado) se hace en routes/noteFolders.js,
// no aqui: SQLite no tiene forma sencilla de expresarlo en el esquema.
const noteFolderColumns = db.prepare('PRAGMA table_info(note_folders)').all().map((c) => c.name);
if (!noteFolderColumns.includes('parent_id')) {
  db.exec('ALTER TABLE note_folders ADD COLUMN parent_id INTEGER REFERENCES note_folders(id)');
}

// favorite: nota o carpeta marcada como favorita, para que aparezca
// primero en su listado (ver renderNotesView en app.js). Igual que
// "hidden", es un simple 0/1 por fila, sin tabla aparte.
if (!noteColumns.includes('favorite')) {
  db.exec('ALTER TABLE notes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
}
if (!noteFolderColumns.includes('favorite')) {
  db.exec('ALTER TABLE note_folders ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
}

// body_format (Fase 4 -- editor de notas con formato): 'text' = nota de
// antes de la Fase 4, "body" es texto plano tal cual. 'html' = nota
// creada o editada con el editor nuevo, "body" es HTML ya saneado (ver
// sanitizeNoteBody en routes/notes.js). Se guarda explicitamente en vez
// de adivinarlo mirando el contenido para no confundir una nota vieja
// que por casualidad tenga un "<" o un "&" con HTML de verdad -- ver
// openNoteModal en app.js, que usa este campo para decidir si hace falta
// convertir saltos de linea/caracteres especiales antes de mostrarla en
// el editor con formato.
if (!noteColumns.includes('body_format')) {
  db.exec("ALTER TABLE notes ADD COLUMN body_format TEXT NOT NULL DEFAULT 'text'");
}

// updated_at para sincronizacion (fase "movil"): groups y note_folders
// solo tenian created_at hasta ahora. SQLite no deja poner
// datetime('now') como DEFAULT al anadir una columna con ALTER TABLE
// (solo admite constantes), asi que se anade SIN default y se rellena
// aparte con un UPDATE -- a partir de aqui, cada PUT de estas rutas
// tiene que poner updated_at = datetime('now') a mano, igual que ya
// hacen events/notes (ver routes/groups.js y routes/noteFolders.js).
if (!groupColumns.includes('updated_at')) {
  db.exec('ALTER TABLE groups ADD COLUMN updated_at TEXT');
  db.exec("UPDATE groups SET updated_at = created_at WHERE updated_at IS NULL");
}
if (!noteFolderColumns.includes('updated_at')) {
  db.exec('ALTER TABLE note_folders ADD COLUMN updated_at TEXT');
  db.exec("UPDATE note_folders SET updated_at = created_at WHERE updated_at IS NULL");
}

// special_days no tenia ningun timestamp (su clave es la propia fecha
// marcada, no un id). Para poder sincronizar hacen falta los dos, igual
// que en el resto de tablas.
const specialDayColumns = db.prepare('PRAGMA table_info(special_days)').all().map((c) => c.name);
if (!specialDayColumns.includes('created_at')) {
  db.exec('ALTER TABLE special_days ADD COLUMN created_at TEXT');
  db.exec("UPDATE special_days SET created_at = datetime('now') WHERE created_at IS NULL");
}
if (!specialDayColumns.includes('updated_at')) {
  db.exec('ALTER TABLE special_days ADD COLUMN updated_at TEXT');
  db.exec("UPDATE special_days SET updated_at = datetime('now') WHERE updated_at IS NULL");
}

// last_sync_seq: hasta que fila de sync_log ha traido ya este
// dispositivo emparejado (ver routes/sync.js) -- 0 significa "todavia
// no ha sincronizado nada, mandale el historial completo".
if (!deviceColumns.includes('last_sync_seq')) {
  db.exec('ALTER TABLE devices ADD COLUMN last_sync_seq INTEGER NOT NULL DEFAULT 0');
}

// Limpieza: se quito la opcion de contraseña compartida para destapar
// notas ocultas (routes/notesSecurity.js ya no existe) -- si quedaban
// estas claves de una instalacion anterior, se borran para no dejar
// datos huerfanos sin usar.
db.prepare("DELETE FROM app_settings WHERE key IN ('notes_hide_password_enabled', 'notes_hide_password_hash')").run();

// push_subscription: el objeto que da el navegador al suscribirse a
// notificaciones push (endpoint + claves p256dh/auth), como JSON. NULL
// si ese dispositivo nunca se ha suscrito o desactivo el ajuste. Ver
// routes/devices.js (guardarlo) y server/push.js + reminderChecker.js
// (usarlo para mandar el aviso).
if (!deviceColumns.includes('push_subscription')) {
  db.exec('ALTER TABLE devices ADD COLUMN push_subscription TEXT');
}

// email: para el "primer arranque" (pantalla de bienvenida) y, sobre
// todo, como contacto tecnico obligatorio del protocolo Web Push
// (VAPID) al mandar notificaciones push -- ver server/push.js. Nunca se
// muestra en la interfaz ni se manda a nadie salvo a Google/Apple para
// ese uso puntual. Opcional a proposito: sin el, simplemente no se
// pueden activar las notificaciones push (ver routes/devices.js).
const profileColumns = db.prepare('PRAGMA table_info(user_profile)').all().map((c) => c.name);
if (!profileColumns.includes('email')) {
  db.exec('ALTER TABLE user_profile ADD COLUMN email TEXT');
}

// El perfil siempre tiene que existir (para poder firmar "creado por" en
// los eventos desde el primer arranque). El public_id se genera una sola
// vez aqui y ya no se vuelve a tocar.
const hasProfile = db.prepare('SELECT 1 FROM user_profile WHERE id = 1').get();
if (!hasProfile) {
  db.prepare('INSERT INTO user_profile (id, name, public_id) VALUES (1, ?, ?)').run(
    '',
    crypto.randomUUID()
  );
}

// is_salary/is_fixed (objetivo de ahorro): marcar un ingreso como
// "salario" o un gasto como "fijo" es lo que usa el aviso de si el
// objetivo de ahorro es realista (ver routes/finanzasSettings.js) --
// solo tiene sentido el que aplica segun "type", el otro se queda
// siempre en 0.
const finanzasTransactionColumns = db.prepare('PRAGMA table_info(finanzas_transactions)').all().map((c) => c.name);
if (!finanzasTransactionColumns.includes('is_salary')) {
  db.exec('ALTER TABLE finanzas_transactions ADD COLUMN is_salary INTEGER NOT NULL DEFAULT 0');
}
if (!finanzasTransactionColumns.includes('is_fixed')) {
  db.exec('ALTER TABLE finanzas_transactions ADD COLUMN is_fixed INTEGER NOT NULL DEFAULT 0');
}

// recurring_expense_id: enlaza una transaccion generada AUTOMATICAMENTE
// con la plantilla que la creo (ver finanzas_recurring_expenses mas
// arriba y server/finanzasRecurringChecker.js) -- nullable, ya que la
// inmensa mayoria de transacciones se siguen creando a mano. La
// transaccion generada es independiente de verdad: editarla o borrarla
// no toca la plantilla ni afecta a las proximas generaciones (pedido
// explicito de Koku con el ejemplo de "sube el precio de Netflix").
if (!finanzasTransactionColumns.includes('recurring_expense_id')) {
  db.exec('ALTER TABLE finanzas_transactions ADD COLUMN recurring_expense_id INTEGER REFERENCES finanzas_recurring_expenses(id)');
}

// savings_goal_min: objetivo MINIMO de ahorro mensual (sin maximo --
// Koku dijo explicitamente que ahorrar de mas nunca es un problema).
const finanzasSettingsColumns = db.prepare('PRAGMA table_info(finanzas_settings)').all().map((c) => c.name);
if (!finanzasSettingsColumns.includes('savings_goal_min')) {
  db.exec('ALTER TABLE finanzas_settings ADD COLUMN savings_goal_min REAL');
}

// counts_toward_budget en inversiones: igual que en gastos normales,
// pero aqui empieza DESACTIVADA por defecto (0) -- invertir no se
// trataba como "gasto" en el resto de la app hasta esta ronda, y solo
// tiene sentido marcarlo en una Compra (ver routes/finanzasInvestments.js).
const finanzasInvestmentColumns = db.prepare('PRAGMA table_info(finanzas_investment_transactions)').all().map((c) => c.name);
if (!finanzasInvestmentColumns.includes('counts_toward_budget')) {
  db.exec('ALTER TABLE finanzas_investment_transactions ADD COLUMN counts_toward_budget INTEGER NOT NULL DEFAULT 0');
}

// asset_id: referencia a la entidad real finanzas_assets (Ronda
// "Carteras de inversion"). asset_name se CONSERVA -- este proyecto
// nunca hace DROP COLUMN -- pero pasa de ser la fuente de verdad a ser
// una cache desnormalizada que se sigue escribiendo en cada
// INSERT/UPDATE con el nombre ACTUAL del activo (ver
// routes/finanzasInvestments.js), por si asset_id quedara huerfano
// algun dia. Backfill: cada asset_name distinto ya usado se convierte en
// una fila de finanzas_assets (sin cartera, portfolio_id NULL), y las
// transacciones que coincidan por nombre se enlazan por asset_id.
if (!finanzasInvestmentColumns.includes('asset_id')) {
  db.exec('ALTER TABLE finanzas_investment_transactions ADD COLUMN asset_id INTEGER REFERENCES finanzas_assets(id)');

  const distinctNames = db
    .prepare('SELECT DISTINCT asset_name FROM finanzas_investment_transactions WHERE asset_name IS NOT NULL')
    .all();
  const insertAsset = db.prepare('INSERT INTO finanzas_assets (name, portfolio_id, position) VALUES (?, NULL, 0)');
  const linkTransactions = db.prepare('UPDATE finanzas_investment_transactions SET asset_id = ? WHERE asset_name = ?');
  distinctNames.forEach(({ asset_name }) => {
    const info = insertAsset.run(asset_name);
    linkTransactions.run(info.lastInsertRowid, asset_name);
  });
}

// Igual que el perfil: el limite mensual de Finanzas es una sola fila
// que siempre tiene que existir, para no tener que comprobar "y si no
// existe todavia" en cada ruta que lo lee.
const hasFinanzasSettings = db.prepare('SELECT 1 FROM finanzas_settings WHERE id = 1').get();
if (!hasFinanzasSettings) {
  db.prepare('INSERT INTO finanzas_settings (id, monthly_budget_limit) VALUES (1, NULL)').run();
}

// Migracion puntual: en versiones anteriores el tema oscuro y el claro de
// partida eran DOS temas sueltos ("Oscuro (por defecto)" y "Claro"), asi
// que el interruptor Sistema/Claro/Oscuro no tenia nada que alternar en
// ninguno de los dos. Aqui se fusionan en uno solo ("Predeterminado") con
// variante inversa, reutilizando el id del oscuro (para que quien ya lo
// tuviera activo no se quede sin tema) y redirigiendo a quien tuviera
// "Claro" activo hacia el fusionado. Solo hace falta una vez: si ya existe
// "Predeterminado" (instalacion nueva, o esta migracion ya corrio antes),
// no hace nada.
const yaFusionado = db.prepare('SELECT 1 FROM themes WHERE name = ?').get('Predeterminado');
if (!yaFusionado) {
  const oscuroLegado = db.prepare('SELECT * FROM themes WHERE name = ?').get('Oscuro (por defecto)');
  const claroLegado = db.prepare('SELECT * FROM themes WHERE name = ?').get('Claro');
  if (oscuroLegado && claroLegado) {
    db.prepare('UPDATE themes SET name = ?, inverse_colors = ? WHERE id = ?').run(
      'Predeterminado',
      claroLegado.colors,
      oscuroLegado.id
    );
    db.prepare('UPDATE devices SET active_theme_id = ? WHERE active_theme_id = ?').run(
      oscuroLegado.id,
      claroLegado.id
    );
    db.prepare("UPDATE app_settings SET value = ? WHERE key = 'host_active_theme_id' AND value = ?").run(
      String(oscuroLegado.id),
      String(claroLegado.id)
    );
    db.prepare('DELETE FROM themes WHERE id = ?').run(claroLegado.id);
  }
}

// Migracion puntual: los temas se guardaban con un "texto principal" y un
// "texto secundario" GLOBALES (claves text/textDim), compartidos por toda
// la app sin importar sobre que fondo cayeran — eso es precisamente lo que
// causaba el bug de contraste (un texto pensado para un fondo se aplicaba
// tambien sobre otro fondo distinto del mismo tema). Ahora cada fondo real
// (bg, surface, surface2, settingsMenuBg, accent, dayToday) lleva su propio
// color de contraste. Aqui se migra cualquier tema guardado en el formato
// viejo (tiene "text" pero no "bgText") copiando ese texto global a los
// nuevos campos — es un punto de partida razonable, editable a mano
// despues desde Configuracion. Idempotente: una vez migrado ya tiene
// "bgText" y esta funcion lo deja tal cual.
function migrateLegacyTextColors(colorsJson) {
  if (!colorsJson) return colorsJson;
  let colors;
  try {
    colors = JSON.parse(colorsJson);
  } catch {
    return colorsJson;
  }
  if (!colors || typeof colors !== 'object' || colors.bgText || !colors.text) return colorsJson;

  colors.bgText = colors.text;
  colors.surfaceText = colors.text;
  colors.surface2Text = colors.text;
  colors.settingsMenuText = colors.text;
  colors.accentText = colors.accentText || '#ffffff';
  colors.dayTodayText = colors.dayTodayText || '#ffffff';
  return JSON.stringify(colors);
}

const themeRowsToMigrate = db.prepare('SELECT id, colors, inverse_colors FROM themes').all();
const updateThemeColors = db.prepare('UPDATE themes SET colors = ?, inverse_colors = ? WHERE id = ?');
for (const row of themeRowsToMigrate) {
  const migratedColors = migrateLegacyTextColors(row.colors);
  const migratedInverse = migrateLegacyTextColors(row.inverse_colors);
  if (migratedColors !== row.colors || migratedInverse !== row.inverse_colors) {
    updateThemeColors.run(migratedColors, migratedInverse, row.id);
  }
}

// Semilla de temas de partida. Se comprueba UNO A UNO por nombre (no solo
// "si la tabla esta vacia") para poder anadir temas nuevos en versiones
// futuras — como Pastel y Neon aqui — sin duplicar los que ya tenga
// alguien que actualiza una base de datos existente, y sin tocar temas
// propios que se hayan creado a mano.
const SEED_THEMES = [
  {
    name: 'Predeterminado',
    colors: {
      bg: '#0f1115',
      bgText: '#e8eaed',
      surface: '#171a21',
      surfaceText: '#e8eaed',
      surface2: '#1f232c',
      surface2Text: '#e8eaed',
      border: '#2a2f3a',
      accent: '#5b8cff',
      accentText: '#ffffff',
      danger: '#ff6b6b',
      settingsMenuBg: '#1f232c',
      settingsMenuText: '#e8eaed',
      dayToday: '#5b8cff',
      dayTodayText: '#ffffff',
      dayWeekend: '#1a1d27',
      dayHoliday: '#3a2020',
      daySpecial: '#2a1f3a',
    },
    inverseColors: {
      bg: '#f5f6f8',
      bgText: '#1a1d23',
      surface: '#ffffff',
      surfaceText: '#1a1d23',
      surface2: '#eef0f3',
      surface2Text: '#1a1d23',
      border: '#dfe3e8',
      accent: '#5b8cff',
      accentText: '#ffffff',
      danger: '#e0455b',
      settingsMenuBg: '#eef0f3',
      settingsMenuText: '#1a1d23',
      dayToday: '#5b8cff',
      dayTodayText: '#ffffff',
      dayWeekend: '#e8edfb',
      dayHoliday: '#fbeaea',
      daySpecial: '#f1eafc',
    },
  },
  {
    name: 'Pastel',
    colors: {
      bg: '#faf3f7',
      bgText: '#4a3b46',
      surface: '#ffffff',
      surfaceText: '#4a3b46',
      surface2: '#f3e6ef',
      surface2Text: '#4a3b46',
      border: '#e6d3e0',
      accent: '#f2a6c6',
      accentText: '#4a3b46',
      danger: '#e8909a',
      settingsMenuBg: '#f3e6ef',
      settingsMenuText: '#4a3b46',
      dayToday: '#f2a6c6',
      dayTodayText: '#4a3b46',
      dayWeekend: '#f0e6f5',
      dayHoliday: '#fbdfe0',
      daySpecial: '#e4e0fb',
    },
  },
  {
    name: 'Neón',
    colors: {
      bg: '#0a0a12',
      bgText: '#e6e6ff',
      surface: '#12121e',
      surfaceText: '#e6e6ff',
      surface2: '#1a1a2e',
      surface2Text: '#e6e6ff',
      border: '#2d2d44',
      accent: '#00f0ff',
      accentText: '#0a0a12',
      danger: '#ff2079',
      settingsMenuBg: '#1a1a2e',
      settingsMenuText: '#e6e6ff',
      dayToday: '#00f0ff',
      dayTodayText: '#0a0a12',
      dayWeekend: '#14142a',
      dayHoliday: '#2a1020',
      daySpecial: '#10202a',
    },
  },
  // "EINES": panel tecnico oscuro con acento naranja, sacado de una guia de
  // diseño (sistema-de-estilos.md/estilos-panel-oscuro.css) que Koku trajo
  // de otra herramienta ya construida. Mapeo: --bg->bg, --panel->surface,
  // --panel-2->surface2/settingsMenuBg (fondo "hundido" de inputs), --line
  // ->border, --accent->accent (con accentText oscuro, tal cual pide el
  // .btn-primary del original: fondo solido + texto oscuro, no blanco).
  // dayWeekend usa el tono --grid de la cuadricula de fondo; dayHoliday y
  // daySpecial son --danger/--info del original mezclados oscuros con bg,
  // ya que ese sistema no define esos dos casos (son propios de este
  // calendario, no de la guia original).
  {
    name: 'EINES',
    colors: {
      bg: '#12181f',
      bgText: '#e7edf2',
      surface: '#1a222b',
      surfaceText: '#e7edf2',
      surface2: '#20303a',
      surface2Text: '#e7edf2',
      border: '#2c3947',
      accent: '#ff8a3d',
      accentText: '#1a0f05',
      danger: '#e24b4a',
      settingsMenuBg: '#20303a',
      settingsMenuText: '#e7edf2',
      dayToday: '#ff8a3d',
      dayTodayText: '#1a0f05',
      dayWeekend: '#233240',
      dayHoliday: '#2e1a1a',
      daySpecial: '#16232e',
    },
  },

  // "Registro": panel tecnico con acento verde, sacado de otra guia de
  // diseño (misma pareja de archivos sistema-de-estilos.md/
  // estilos-panel-oscuro.css, pero de un proyecto distinto -- el "Report
  // Generator" de Koku) que esta vez SI trae variante clara Y oscura de
  // verdad, a diferencia de EINES (solo oscuro) -- por eso aqui si hay
  // inverseColors. Mismo mapeo que EINES: --bg->bg, --panel->surface,
  // --panel-2->surface2/settingsMenuBg, --line->border, --accent->accent
  // (accentText oscuro en el oscuro, blanco en el claro, tal cual definia
  // --accent-text en cada variante del original). dayWeekend usa --grid;
  // dayHoliday/daySpecial son --danger/--info del original mezclados con
  // el bg de cada variante (ese sistema tampoco define esos dos casos).
  {
    name: 'Registro',
    colors: {
      bg: '#101813',
      bgText: '#e7f2ec',
      surface: '#17211b',
      surfaceText: '#e7f2ec',
      surface2: '#1e2b23',
      surface2Text: '#e7f2ec',
      border: '#2b3d33',
      accent: '#3ddc84',
      accentText: '#08150f',
      danger: '#e24b4a',
      settingsMenuBg: '#1e2b23',
      settingsMenuText: '#e7f2ec',
      dayToday: '#3ddc84',
      dayTodayText: '#08150f',
      dayWeekend: '#22322a',
      dayHoliday: '#2c1a1a',
      daySpecial: '#16212f',
    },
    inverseColors: {
      bg: '#f4f8f5',
      bgText: '#16211c',
      surface: '#ffffff',
      surfaceText: '#16211c',
      surface2: '#eef4f0',
      surface2Text: '#16211c',
      border: '#d5e2da',
      accent: '#1f9d5c',
      accentText: '#ffffff',
      danger: '#c0392b',
      settingsMenuBg: '#eef4f0',
      settingsMenuText: '#16211c',
      dayToday: '#1f9d5c',
      dayTodayText: '#ffffff',
      dayWeekend: '#e3ede7',
      dayHoliday: '#fbeaea',
      daySpecial: '#e8eff8',
    },
  },
];

const existingThemeNames = new Set(db.prepare('SELECT name FROM themes').all().map((t) => t.name));
const seedTheme = db.prepare('INSERT INTO themes (name, colors, inverse_colors) VALUES (?, ?, ?)');
for (const theme of SEED_THEMES) {
  if (!existingThemeNames.has(theme.name)) {
    seedTheme.run(theme.name, JSON.stringify(theme.colors), theme.inverseColors ? JSON.stringify(theme.inverseColors) : null);
  }
}

// ---------------------------------------------------------------------
// Sincronizacion movil (fase "movil"): cada ruta que crea/edita/borra
// una fila de una tabla sincronizable llama a esto UNA vez al final,
// justo despues de la operacion en la base de datos -- ver
// routes/sync.js para como se leen estas filas, y routes/events.js,
// notes.js, groups.js, noteFolders.js, specialDays.js para donde se
// llama. "payload" es el mismo objeto ya serializado (camelCase) que
// esa ruta le devuelve al que hizo la peticion, para no tener que
// convertir el formato dos veces. "originDeviceId" es null/undefined si
// el cambio lo hizo el propio ordenador (dispositivo de confianza), o
// el id numerico del dispositivo movil si lo hizo el movil -- asi un
// dispositivo puede reconocer y no re-aplicarse sus propios cambios al
// leer el historial.
const recordSyncChangeStmt = db.prepare(
  'INSERT INTO sync_log (table_name, row_id, op, payload, device_origin) VALUES (?, ?, ?, ?, ?)'
);
db.recordSyncChange = function recordSyncChange(tableName, rowId, op, payload, originDeviceId) {
  recordSyncChangeStmt.run(
    tableName,
    String(rowId),
    op,
    payload ? JSON.stringify(payload) : null,
    originDeviceId ? String(originDeviceId) : null
  );
};

module.exports = db;
// DATA_DIR: mismo sitio donde vive la base de datos -- server/push.js lo
// reutiliza para guardar las claves VAPID (vapid-keys.json) junto al
// resto de datos de usuario, en vez de duplicar la logica de "donde
// vive la carpeta de datos" (ver el comentario de DATA_DIR mas arriba).
module.exports.DATA_DIR = DATA_DIR;
