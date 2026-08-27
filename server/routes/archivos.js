// routes/archivos.js — extension "Archivos": mandar archivos sueltos
// (fotos, PDFs, documentos -- no ligados a una nota) entre el movil y el
// ordenador. A diferencia de note-images, aqui NO hay tabla en SQLite --
// la "base de datos" de Archivos ES la propia carpeta del sistema de
// ficheros, para que Koku tambien pueda meter/sacar cosas desde fuera de
// la app (Finder/Explorador) y se vean igual. Solo se guarda la RUTA de
// esa carpeta, en app_settings (clave 'archivosFolder'), igual que ya
// hace routes/themes.js con el tema activo del ordenador.
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const DATA_DIR = require('../dataDir');
const db = require('../db');
const { requireDeviceOrTrusted, requireTrusted } = require('../auth');

const router = express.Router();

const DEFAULT_FOLDER = path.join(DATA_DIR, 'transfers');
if (!fs.existsSync(DEFAULT_FOLDER)) fs.mkdirSync(DEFAULT_FOLDER, { recursive: true });

function getFolder() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'archivosFolder'").get();
  return row && row.value ? row.value : DEFAULT_FOLDER;
}

function setFolder(folder) {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('archivosFolder', ?) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(folder);
}

// Leer la carpeta configurada es informacion de solo lectura (una ruta de
// texto, nada que se ejecute) -- un movil emparejado tambien puede verla,
// para mostrarla en modo solo lectura en su propio apartado Archivos.
// CAMBIARLA o EXPLORAR el disco si que son solo del ordenador (ver
// PUT/GET /browse mas abajo): "explorar el disco de otro dispositivo" no
// existe ni tiene sentido, asi que requireTrusted es la proteccion
// correcta ahi (mismo criterio que routes/update.js con git pull).
router.get('/folder', requireDeviceOrTrusted, (req, res) => {
  res.json({ folder: getFolder() });
});

router.put('/folder', requireTrusted, (req, res) => {
  const { folder } = req.body || {};
  if (!folder || typeof folder !== 'string') {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta la ruta de la carpeta.' });
  }
  let stat;
  try {
    stat = fs.statSync(folder);
  } catch (err) {
    return res.status(400).json({ error: 'invalid_folder', message: 'Esa ruta no existe.' });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'invalid_folder', message: 'Esa ruta no es una carpeta.' });
  }
  setFolder(folder);
  res.json({ folder: getFolder() });
});

// Lista las subcarpetas de una ruta, para el explorador visual del
// ordenador (botón "Explorar..." en Archivos). Sin ruta -- se parte de
// la carpeta personal del usuario, un punto de partida razonable en
// cualquier sistema operativo. "parent" es null cuando ya no se puede
// subir mas (raiz del disco).
router.get('/browse', requireTrusted, (req, res) => {
  const target = req.query.path && typeof req.query.path === 'string' ? req.query.path : os.homedir();
  let entries;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    return res.status(400).json({ error: 'invalid_path', message: 'No se pudo abrir esa carpeta.' });
  }
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(target);
  res.json({ path: target, parent: parent === target ? null : parent, folders });
});

// Lista los archivos que hay AHORA MISMO en la carpeta configurada --
// leyendo el directorio real cada vez, sin tabla ni cache, para que
// archivos metidos a mano desde fuera de la app tambien aparezcan.
router.get('/', requireDeviceOrTrusted, (req, res) => {
  const folder = getFolder();
  let entries;
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch (err) {
    return res.json([]);
  }
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => {
      const stat = fs.statSync(path.join(folder, e.name));
      return { name: e.name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  res.json(files);
});

// Sube un archivo: el cliente lo manda tal cual como cuerpo de la
// peticion (fetch admite un File/Blob directamente), con el nombre
// original en la cabecera X-File-Name -- a diferencia de note-images
// (que solo sube imagenes con Content-Type conocido), aqui puede ser
// cualquier tipo de archivo, asi que el nombre no se puede sacar del
// Content-Type. Limite generoso (100 MB) para no llenar el disco con un
// archivo enorme por error.
router.post(
  '/',
  requireDeviceOrTrusted,
  express.raw({ type: '*/*', limit: '100mb' }),
  (req, res) => {
    const rawName = req.header('X-File-Name');
    if (!rawName || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'invalid_file', message: 'Falta el archivo o su nombre.' });
    }
    // path.basename() por seguridad (igual que al servir una imagen de
    // nota): evita que el nombre incluya "../" y se salga de la carpeta.
    let name = path.basename(decodeURIComponent(rawName)).replace(/[/\\:*?"<>|]/g, '_').slice(0, 200);
    if (!name) name = 'archivo';

    const folder = getFolder();
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    let finalName = name;
    let counter = 1;
    // A diferencia de note-images (nombre UUID, nunca choca), aqui el
    // nombre es el real que eligio quien lo subio -- si ya existe uno
    // igual, se anade un sufijo numerico en vez de sobrescribirlo.
    while (fs.existsSync(path.join(folder, finalName))) {
      finalName = `${base} (${counter})${ext}`;
      counter += 1;
    }

    fs.writeFileSync(path.join(folder, finalName), req.body);
    const stat = fs.statSync(path.join(folder, finalName));
    res.status(201).json({ name: finalName, size: stat.size, modifiedAt: stat.mtime.toISOString() });
  }
);

// Descargar: a diferencia de las imagenes de nota, el nombre de archivo
// aqui es real y adivinable (no un UUID al azar), asi que SI hace falta
// exigir el token del dispositivo -- sin eso, cualquiera en la wifi
// podria descargar archivos con nombres comunes a base de probar.
router.get('/:filename', requireDeviceOrTrusted, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(getFolder(), filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.download(filePath, filename);
});

router.delete('/:filename', requireDeviceOrTrusted, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(getFolder(), filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not_found' });
  fs.unlinkSync(filePath);
  res.status(204).end();
});

module.exports = router;
