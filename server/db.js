// db.js — capa de acceso a datos con SQLite.
// Usamos node:sqlite, el modulo de SQLite integrado en Node (desde la
// 22.5). Es "sincrono" como better-sqlite3 (sin promesas: cada consulta
// se resuelve en la misma linea) pero no requiere compilar nada nativo
// al instalar — evita el problema mas tipico al montar esto en un
// ordenador nuevo (necesitar Python/build tools para better-sqlite3).
// Nota: Node lo marca como "experimental" y avisa por consola; es solo
// un aviso, funciona con normalidad.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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

// inverse_colors: variante clara/oscura "pareja" de un tema, opcional. Ver
// routes/themes.js para el saneado y routes/... para como se elige cual
// de las dos ensenar (modo sistema/claro/oscuro, ajuste de cada dispositivo).
const themeColumns = db.prepare('PRAGMA table_info(themes)').all().map((c) => c.name);
if (!themeColumns.includes('inverse_colors')) {
  db.exec('ALTER TABLE themes ADD COLUMN inverse_colors TEXT');
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
      surface: '#171a21',
      surface2: '#1f232c',
      border: '#2a2f3a',
      text: '#e8eaed',
      textDim: '#9aa0ab',
      accent: '#5b8cff',
      danger: '#ff6b6b',
      settingsMenuBg: '#1f232c',
      dayToday: '#5b8cff',
      dayWeekend: '#1a1d27',
      dayHoliday: '#3a2020',
      daySpecial: '#2a1f3a',
    },
    inverseColors: {
      bg: '#f5f6f8',
      surface: '#ffffff',
      surface2: '#eef0f3',
      border: '#dfe3e8',
      text: '#1a1d23',
      textDim: '#6b7280',
      accent: '#5b8cff',
      danger: '#e0455b',
      settingsMenuBg: '#eef0f3',
      dayToday: '#5b8cff',
      dayWeekend: '#e8edfb',
      dayHoliday: '#fbeaea',
      daySpecial: '#f1eafc',
    },
  },
  {
    name: 'Pastel',
    colors: {
      bg: '#faf3f7',
      surface: '#ffffff',
      surface2: '#f3e6ef',
      border: '#e6d3e0',
      text: '#4a3b46',
      textDim: '#8a7686',
      accent: '#f2a6c6',
      danger: '#e8909a',
      settingsMenuBg: '#f3e6ef',
      dayToday: '#f2a6c6',
      dayWeekend: '#f0e6f5',
      dayHoliday: '#fbdfe0',
      daySpecial: '#e4e0fb',
    },
  },
  {
    name: 'Neón',
    colors: {
      bg: '#0a0a12',
      surface: '#12121e',
      surface2: '#1a1a2e',
      border: '#2d2d44',
      text: '#e6e6ff',
      textDim: '#8888aa',
      accent: '#00f0ff',
      danger: '#ff2079',
      settingsMenuBg: '#1a1a2e',
      dayToday: '#00f0ff',
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
