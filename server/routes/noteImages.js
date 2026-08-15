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
// Sin libreria de subida de ficheros (multer y similares): el cliente
// manda el archivo tal cual como cuerpo de la peticion (fetch admite un
// File/Blob directamente como body), con el Content-Type siendo el tipo
// de la imagen -- eso lo puede leer express.raw() sin depender de nada
// mas.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DATA_DIR = require('../dataDir');
const { requireDeviceOrTrusted } = require('../auth');

const router = express.Router();

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

// Subir una imagen: solo dispositivos vinculados o el propio ordenador
// (igual que el resto de la API). Limite de 10 MB -- generoso para una
// foto normal, pero evita que una nota acabe pesando cientos de MB.
router.post('/', requireDeviceOrTrusted, express.raw({ type: Object.keys(ALLOWED_TYPES), limit: '10mb' }), (req, res) => {
  const ext = ALLOWED_TYPES[req.headers['content-type']];
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'invalid_image', message: 'Formato de imagen no soportado.' });
  }
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, filename), req.body);
  res.status(201).json({ url: `/api/notes/images/${filename}` });
});

// Servir una imagen ya subida: a proposito SIN requireDeviceOrTrusted.
// Un <img src="..."> lo pide el propio navegador, sin pasar por nuestro
// fetch() (que es donde se anade el token del movil emparejado, ver
// api() en app.js) -- un <img> no puede llevar cabeceras a medida, asi
// que exigir el token aqui dejaria las imagenes rotas en el movil. La
// proteccion aqui es que el nombre de archivo es un UUID aleatorio
// (crypto.randomUUID(), sin relacion con nada publico) generado al
// subirla: nadie fuera de tu wifi puede siquiera llegar a este servidor,
// y dentro de tu wifi no hay forma de adivinar el nombre de un archivo
// que no te hayan compartido.
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
