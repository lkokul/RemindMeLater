// routes/noteImages.js — subir/servir las imagenes que se insertan en una
// nota (Fase 4, sub-ronda de imagenes). Cada imagen se guarda como
// archivo aparte en DATA_DIR/note-images (junto al .db, ver
// server/dataDir.js), y la nota solo guarda un enlace corto
// ("/api/notes/images/xxx.jpg") dentro de su HTML -- se descarto guardar
// la imagen entera como texto (base64) dentro de la nota porque eso
// hincha la base de datos y hace mas lenta cualquier carga de la lista de
// notas, aunque no estes mirando esa imagen en concreto (hablado con
// Koku).
//
// Sin libreria de subida de ficheros (multer y similares): la ventana
// manda el archivo tal cual como cuerpo de la peticion, con el
// Content-Type puesto al tipo de la imagen. Antes hacia falta
// express.raw() para leer ese cuerpo binario del flujo HTTP; ahora no
// viaja por ninguna red, asi que el cuerpo llega ya como Buffer desde el
// propio IPC de Electron (ver electron/ipc.js) y no hay nada que parsear.
const { createRouter } = require('../router');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DATA_DIR = require('../dataDir');

const router = createRouter();

const IMAGES_DIR = path.join(DATA_DIR, 'note-images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

// Los unicos tipos que de verdad hacen falta para fotos/capturas
// normales. Cualquier otra cosa (ni siquiera SVG, que puede llevar
// <script> dentro) se rechaza directamente.
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

// Limite de 10 MB -- generoso para una foto normal, pero evita que una
// nota acabe pesando cientos de MB.
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
  res.status(201).json({ url: `/api/notes/images/${filename}` });
});

// Servir una imagen ya subida. Esto NO lo pide el codigo de la app: lo
// pide el propio navegador al encontrarse un <img src="..."> dentro del
// HTML de una nota, y por eso no pasa por api()/IPC como todo lo demas.
// Quien lo atiende es el protocolo app:// de Electron, que reconoce las
// rutas /api/notes/images/... y las trae por aqui (ver
// electron/protocol.js).
router.get('/:filename', (req, res) => {
  // path.basename() por seguridad: evita que alguien mande algo tipo
  // "../../../etc/passwd" como nombre de archivo y se salga de esta
  // carpeta.
  const filename = path.basename(req.params.filename);
  const filePath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// Borra del disco las imagenes referenciadas en el HTML de una nota que
// se acaba de eliminar -- lo llama routes/notes.js al hacer DELETE. No
// se persigue el mismo cuidado cuando solo se EDITA una nota y se quita
// una imagen de en medio (habria que comparar el HTML antes/despues en
// cada guardado, bastante mas lio para lo que aporta) -- eso se acepta
// como limitacion conocida de esta sub-ronda.
function deleteImagesInBody(body) {
  if (!body) return;
  const matches = body.matchAll(/\/api\/notes\/images\/([a-zA-Z0-9._-]+)/g);
  for (const match of matches) {
    const filePath = path.join(IMAGES_DIR, path.basename(match[1]));
    fs.unlink(filePath, () => {}); // best-effort, no pasa nada si ya no esta
  }
}

module.exports = router;
module.exports.deleteImagesInBody = deleteImagesInBody;
