// protocol.js — el "app://" que sirve los archivos de la app.
//
// POR QUE HACE FALTA ESTO
// -----------------------
// Antes la ventana cargaba http://localhost:3000 y era Express quien le
// daba index.html, styles.css, app.js, las imagenes de las notas... Al
// quitar el servidor hay que decirle a Electron de donde sacar todo eso.
//
// La opcion obvia seria cargar el archivo directamente con file:// (la
// ruta del disco, tal cual). No se hace, por dos motivos concretos:
//
//   1. Con file:// el navegador considera cada archivo un "origen"
//      distinto y aparte inseguro: cosas como localStorage o fetch() se
//      comportan de forma rara o directamente no funcionan. La app usa
//      las dos a manos llenas.
//   2. Dentro del HTML de las notas hay imagenes guardadas como
//      "/api/notes/images/xxx.jpg" (rutas que escribio la version con
//      servidor, y que estan dentro de la base de datos). Con file://
//      esas rutas apuntarian a la raiz del disco duro y saldrian rotas.
//
// Registrando un esquema propio (app://) se arreglan las dos cosas: la
// pagina tiene un origen normal y estable, y aqui podemos reconocer esas
// rutas /api/... y traer el archivo de la carpeta de datos, sin tener
// que tocar ni una sola nota ya escrita.
const path = require('path');
const fs = require('fs');
const { protocol } = require('electron');

// El "host" del esquema. app://remindmelater/index.html. Da igual cual
// sea mientras no cambie: es lo que el navegador usa como origen, y de
// el dependen localStorage y demas, asi que cambiarlo mas adelante
// equivaldria a empezar de cero con los ajustes de este ordenador.
const HOST = 'remindmelater';
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://${HOST}`;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Las rutas /api/... que NO son datos sino archivos: las pide el propio
// navegador al encontrarse un <img src="..."> dentro de una nota o de
// una entrada de Viajes, asi que no pasan por api()/IPC como el resto.
// Cada una se resuelve contra su carpeta dentro de la carpeta de datos.
const FILE_ROUTES = [
  { prefix: '/api/notes/images/', dir: () => path.join(require('../core/dataDir'), 'note-images') },
  { prefix: '/api/viajes-entries/attachments/', dir: () => path.join(require('../core/dataDir'), 'viajes-photos') },
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Esto tiene que llamarse ANTES de que Electron termine de arrancar
// (antes de app.whenReady()), es un requisito de Electron: los permisos
// de un esquema se declaran de una vez, al principio, no sobre la
// marcha.
//   standard        -> se comporta como http a efectos de origen/rutas
//                      (sin esto, localStorage y las rutas absolutas
//                      tipo "/app.js" no funcionan bien)
//   secure          -> cuenta como origen seguro, igual que https
//   supportFetchAPI -> se puede pedir con fetch(), que es como el mapa
//                      de Viajes carga su SVG
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

// Comprueba que la ruta pedida no se sale de la carpeta que le toca.
// Sin esto, una peticion con ".." dentro podria leer cualquier archivo
// del disco. El contenido de una nota puede llevar rutas escritas hace
// tiempo, asi que se comprueba siempre en vez de confiar.
function isInside(parentDir, candidate) {
  const relative = path.relative(parentDir, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function fileResponse(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return new Response('No encontrado', { status: 404 });
  }
  const mime = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  return new Response(fs.readFileSync(filePath), { status: 200, headers: { 'Content-Type': mime } });
}

// Se llama una vez, ya con Electron arrancado.
function registerHandler() {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);

    // 1) Imagenes de notas y fotos de Viajes, que viven en la carpeta de
    //    datos del usuario y no en public/.
    for (const route of FILE_ROUTES) {
      if (!pathname.startsWith(route.prefix)) continue;
      const dir = route.dir();
      // basename() se queda solo con el nombre del archivo, tirando
      // cualquier "../" que viniera en medio.
      const filePath = path.join(dir, path.basename(pathname.slice(route.prefix.length)));
      if (!isInside(dir, filePath)) return new Response('Ruta no permitida', { status: 403 });
      return fileResponse(filePath);
    }

    // 2) Todo lo demas: un archivo de public/ (index.html, app.js,
    //    styles.css, iconos, el SVG del mapa...).
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.join(PUBLIC_DIR, relative);
    if (!isInside(PUBLIC_DIR, filePath)) return new Response('Ruta no permitida', { status: 403 });
    return fileResponse(filePath);
  });
}

module.exports = { registerScheme, registerHandler, ORIGIN };
