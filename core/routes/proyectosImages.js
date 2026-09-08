// routes/proyectosImages.js — subir/servir las imagenes que se insertan
// en una pagina de Proyectos. Calco de noteImages.js pero con su PROPIA
// carpeta (DATA_DIR/proyectos-images) y su propia ruta, a proposito:
// Proyectos es un sistema separado de las Notas, y asi borrar cosas de
// un lado no puede tocar jamas archivos del otro.
//
// El HTML de una pagina solo guarda el enlace corto
// ("/api/proyectos/images/xxx.jpg") -- nada de base64 dentro del body,
// por lo mismo que en notas: hincharia la base de datos y ralentizaria
// cargar el arbol.
const { createRouter } = require('../router');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DATA_DIR = require('../dataDir');

const router = createRouter();

const IMAGES_DIR = path.join(DATA_DIR, 'proyectos-images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

// Mismos tipos que las imagenes de notas; SVG excluido a proposito
// (puede llevar <script> dentro).
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

router.post('/', (req, res) => {
  const ext = ALLOWED_TYPES[req.headers['content-type']];
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'invalid_image', message: 'Formato de imagen no soportado.' });
  }
  if (req.body.length > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: 'image_too_big', message: 'La imagen no puede pasar de 10 MB.' });
  }
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, filename), req.body);
  res.status(201).json({ url: `/api/proyectos/images/${filename}` });
});

// Servir una imagen ya subida -- lo pide el navegador al encontrarse el
// <img> dentro del HTML de la pagina, via el protocolo app:// de
// Electron (ver electron/protocol.js, que reconoce estas rutas).
router.get('/:filename', (req, res) => {
  // path.basename() por seguridad: evita "../../../" en el nombre.
  const filename = path.basename(req.params.filename);
  const filePath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// Borra del disco las imagenes referenciadas en el HTML de una pagina
// que se acaba de eliminar -- lo llama proyectosPages.js al hacer
// DELETE. Igual que en notas, editar una pagina y quitar una imagen de
// en medio NO libera el archivo (limitacion conocida y aceptada).
function deleteImagesInBody(body) {
  if (!body) return;
  const matches = body.matchAll(/\/api\/proyectos\/images\/([a-zA-Z0-9._-]+)/g);
  for (const match of matches) {
    const filePath = path.join(IMAGES_DIR, path.basename(match[1]));
    fs.unlink(filePath, () => {}); // best-effort, no pasa nada si ya no esta
  }
}

// --- Ayudas para clonar y exportar/importar proyectos ---------------
// (las usan las rutas de proyectosPages.js: clonar una pagina copia sus
// archivos de imagen, exportar los mete en el paquete como base64 e
// importar los vuelve a escribir con nombre nuevo)

const EXT_BY_NAME = new Set(['jpg', 'png', 'gif', 'webp']);

// Copia fisica de una imagen ya subida; devuelve el nombre nuevo (URL
// corta aparte) o null si el original no existe.
function copyImageFile(filename) {
  const safe = path.basename(filename);
  const source = path.join(IMAGES_DIR, safe);
  if (!fs.existsSync(source)) return null;
  const ext = safe.split('.').pop().toLowerCase();
  if (!EXT_BY_NAME.has(ext)) return null;
  const next = `${crypto.randomUUID()}.${ext}`;
  fs.copyFileSync(source, path.join(IMAGES_DIR, next));
  return next;
}

// Lee una imagen como base64 para el paquete de exportacion.
function readImageAsBase64(filename) {
  const safe = path.basename(filename);
  const source = path.join(IMAGES_DIR, safe);
  if (!fs.existsSync(source)) return null;
  const ext = safe.split('.').pop().toLowerCase();
  if (!EXT_BY_NAME.has(ext)) return null;
  return { ext, data: fs.readFileSync(source).toString('base64') };
}

// Escribe una imagen venida de un paquete importado. Mismo limite de
// tamaño que subirla a mano; extension de la lista cerrada.
function writeImageFromBase64(data, ext) {
  if (!EXT_BY_NAME.has(ext)) return null;
  let buffer;
  try {
    buffer = Buffer.from(String(data), 'base64');
  } catch (err) {
    return null;
  }
  if (!buffer || buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer);
  return filename;
}

module.exports = router;
module.exports.deleteImagesInBody = deleteImagesInBody;
module.exports.copyImageFile = copyImageFile;
module.exports.readImageAsBase64 = readImageAsBase64;
module.exports.writeImageFromBase64 = writeImageFromBase64;
