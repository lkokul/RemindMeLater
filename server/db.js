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
  -- organizacion, sin PIN ni bloqueo -- eso ya se resolvio por nota
  -- individual con "ocultar" (ver notes.hidden y notesSecurity.js).
  CREATE TABLE IF NOT EXISTS note_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT NOT NULL DEFAULT '#5b8cff',
    position INTEGER NOT NULL DEFAULT 0,
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

// hidden: nota marcada como "ocultar" (se ve borrosa en la lista hasta
// que se "destapa" — ver routes/notes.js y routes/notesSecurity.js). No
// es un bloqueo de verdad, solo evita que se lea a primera vista; la
// contraseña opcional para destaparla vive en app_settings (clave/valor
// generico que ya existe), no aqui.
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
];

const existingThemeNames = new Set(db.prepare('SELECT name FROM themes').all().map((t) => t.name));
const seedTheme = db.prepare('INSERT INTO themes (name, colors, inverse_colors) VALUES (?, ?, ?)');
for (const theme of SEED_THEMES) {
  if (!existingThemeNames.has(theme.name)) {
    seedTheme.run(theme.name, JSON.stringify(theme.colors), theme.inverseColors ? JSON.stringify(theme.inverseColors) : null);
  }
}

module.exports = db;
