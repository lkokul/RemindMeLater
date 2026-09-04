// dataDir.js — carpeta de datos de la app, en un sitio propio para que
// tanto db.js (el .db) como routes/noteImages.js (las imagenes de las
// notas de "Mi espacio") partan del mismo calculo en vez de repetirlo
// cada uno por su lado.
//
// En desarrollo (npm run dev / node server/index.js) los datos viven en
// data/ dentro del propio proyecto. Empaquetado como app de escritorio
// (ver electron/main.js), electron/main.js pone esta variable de entorno
// ANTES de arrancar el servidor, apuntando a la carpeta de datos del
// usuario (app.getPath('userData')) — asi los datos sobreviven a
// reinstalar o actualizar la app, en vez de vivir dentro de la carpeta
// de instalacion (que se borra/sustituye).
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.REMINDMELATER_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

module.exports = DATA_DIR;
