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
const { requireDeviceOrTrusted, requireTrusted, isTrustedRequest } = require('../auth');
const { createRequest, listPending, getRequest, resolveRequest, cancelRequest } = require('../archivosTransfers');

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

// Lista subcarpetas Y archivos de una ruta -- se usa para dos cosas:
// (1) el explorador de "elegir carpeta por defecto" (solo mira
// `folders`), y (2) la navegacion real del panel "Carpeta compartida en
// el ordenador" en la vista de Archivos (mira los dos), que reemplazo a
// GET / para el ordenador -- asi Koku puede moverse por todo el disco en
// vez de quedarse limitado a la carpeta configurada, que ahora es solo
// un atajo rapido (ver btn-archivos-browser-default en el cliente). Sin
// ruta -- se parte de la carpeta personal del usuario. "parent" es null
// cuando ya no se puede subir mas (raiz del disco). Solo el ordenador
// puede navegar el disco entero (requireTrusted): el movil sigue viendo
// solo la carpeta configurada via GET /, sin cambios.
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
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => {
      const stat = fs.statSync(path.join(target, e.name));
      return { name: e.name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const parent = path.dirname(target);
  res.json({ path: target, parent: parent === target ? null : parent, folders, files });
});

// Resuelve sobre que carpeta actua una peticion de subir/descargar/
// borrar: sin `path` en la query, sigue siendo la carpeta configurada de
// siempre (mismo comportamiento para el movil, que nunca manda `path`).
// Con `path` (solo lo manda el cliente cuando esta navegando el disco
// via GET /browse), exige que la peticion sea de confianza -- "navegar
// y tocar cualquier carpeta del ordenador" solo tiene sentido, y solo es
// seguro, desde el propio ordenador (mismo criterio que GET /browse).
function resolveTargetFolder(req) {
  const requestedPath = req.query.path;
  if (!requestedPath || typeof requestedPath !== 'string') {
    return { folder: getFolder() };
  }
  if (!isTrustedRequest(req)) {
    return { error: { status: 403, body: { error: 'trusted_only', message: 'Esta accion solo se puede hacer desde el ordenador.' } } };
  }
  let stat;
  try {
    stat = fs.statSync(requestedPath);
  } catch (err) {
    return { error: { status: 400, body: { error: 'invalid_path', message: 'Esa ruta no existe.' } } };
  }
  if (!stat.isDirectory()) {
    return { error: { status: 400, body: { error: 'invalid_path', message: 'Esa ruta no es una carpeta.' } } };
  }
  return { folder: requestedPath };
}

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
    const resolved = resolveTargetFolder(req);
    if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);
    const rawName = req.header('X-File-Name');
    if (!rawName || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'invalid_file', message: 'Falta el archivo o su nombre.' });
    }
    // path.basename() por seguridad (igual que al servir una imagen de
    // nota): evita que el nombre incluya "../" y se salga de la carpeta.
    let name = path.basename(decodeURIComponent(rawName)).replace(/[/\\:*?"<>|]/g, '_').slice(0, 200);
    if (!name) name = 'archivo';

    const folder = resolved.folder;
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

// --- Doble confirmacion de transferencias -----------------------------
// Ver archivosTransfers.js para el porque completo. En corto: un movil
// emparejado ya tiene acceso completo por diseno (no es una barrera de
// seguridad nueva, ver auth.js -- esta app no aisla datos por usuario)
// -- esto es una salvaguarda de UX/accidentes, para que nadie mande o
// traiga archivos sin que la otra persona (la que esta delante del
// ordenador) se entere y lo confirme a proposito. Van ANTES de
// GET/DELETE /:filename (igual que se explica en routes/devices.js con
// otras rutas de un solo segmento): si se registraran despues,
// "transfer-requests" se leeria como si fuera un nombre de archivo.
router.post('/transfer-requests', requireDeviceOrTrusted, (req, res) => {
  const { direction, files } = req.body || {};
  if (direction !== 'upload' && direction !== 'download') {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta la direccion de la transferencia.' });
  }
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta la lista de archivos.' });
  }
  const safeFiles = files.slice(0, 100).map((f) => ({
    name: String((f && f.name) || '').slice(0, 200),
    size: Number(f && f.size) || 0,
  }));
  res.status(201).json(createRequest({ direction, files: safeFiles }));
});

// Solo el ordenador necesita ver "todo lo pendiente" -- es quien
// confirma (el ordenador nunca crea solicitudes, ver comentario de
// arriba, asi que nunca veria las suyas propias en esta lista).
router.get('/transfer-requests', requireTrusted, (req, res) => {
  res.json(listPending());
});

// Consulta puntual de una solicitud -- la usa quien la creo (el movil),
// para su propio polling de "¿ya han contestado?".
router.get('/transfer-requests/:id', requireDeviceOrTrusted, (req, res) => {
  const record = getRequest(req.params.id);
  if (!record) return res.status(404).json({ error: 'not_found' });
  res.json(record);
});

router.post('/transfer-requests/:id/accept', requireTrusted, (req, res) => {
  const record = resolveRequest(req.params.id, 'accepted');
  if (!record) return res.status(404).json({ error: 'not_found' });
  res.json(record);
});

router.post('/transfer-requests/:id/reject', requireTrusted, (req, res) => {
  const record = resolveRequest(req.params.id, 'rejected');
  if (!record) return res.status(404).json({ error: 'not_found' });
  res.json(record);
});

// Cancelar la propia solicitud (p.ej. si se cierra la vista Archivos
// mientras se espera confirmacion, ver closeArchivosView() en app.js).
router.delete('/transfer-requests/:id', requireDeviceOrTrusted, (req, res) => {
  cancelRequest(req.params.id);
  res.status(204).end();
});

// Descargar: a diferencia de las imagenes de nota, el nombre de archivo
// aqui es real y adivinable (no un UUID al azar), asi que SI hace falta
// exigir el token del dispositivo -- sin eso, cualquiera en la wifi
// podria descargar archivos con nombres comunes a base de probar.
router.get('/:filename', requireDeviceOrTrusted, (req, res) => {
  const resolved = resolveTargetFolder(req);
  if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(resolved.folder, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.download(filePath, filename);
});

router.delete('/:filename', requireDeviceOrTrusted, (req, res) => {
  const resolved = resolveTargetFolder(req);
  if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(resolved.folder, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not_found' });
  fs.unlinkSync(filePath);
  res.status(204).end();
});

module.exports = router;
