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

module.exports = router;
module.exports.deleteImagesInBody = deleteImagesInBody;
