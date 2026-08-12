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

// Semilla: si todavia no hay ningun tema guardado (primera vez que se
// arranca la app), dejamos dos de partida para no empezar de una pantalla
// vacia — uno oscuro (los colores que ya tenia la app) y uno claro.
const { count: themeCount } = db.prepare('SELECT COUNT(*) as count FROM themes').get();
if (themeCount === 0) {
  const seedTheme = db.prepare('INSERT INTO themes (name, colors) VALUES (?, ?)');
  seedTheme.run(
    'Oscuro (por defecto)',
    JSON.stringify({
      bg: '#0f1115',
      surface: '#171a21',
      surface2: '#1f232c',
      border: '#2a2f3a',
      text: '#e8eaed',
      textDim: '#9aa0ab',
      accent: '#5b8cff',
      danger: '#ff6b6b',
    })
  );
  seedTheme.run(
    'Claro',
    JSON.stringify({
      bg: '#f5f6f8',
      surface: '#ffffff',
      surface2: '#eef0f3',
      border: '#dfe3e8',
      text: '#1a1d23',
      textDim: '#6b7280',
      accent: '#5b8cff',
      danger: '#e0455b',
    })
  );
}

module.exports = db;
