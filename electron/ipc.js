// ipc.js — el canal por el que la ventana le pide datos a la app.
//
// Este archivo es el que sustituye, el solito, al servidor entero. Antes:
//
//   ventana  --HTTP-->  Express (puerto 3000)  -->  SQLite
//
// Ahora:
//
//   ventana  --IPC-->  esto  -->  core/api.js  -->  SQLite
//
// "IPC" es el canal interno de Electron entre la ventana (que es una
// pagina web y no puede tocar el disco) y el proceso principal (que es
// Node y si puede). Es el mismo mecanismo que ya se usaba para cosas
// como "salir de la aplicacion", solo que ahora tambien lleva los datos.
//
// La ventana sigue pidiendo las cosas por su ruta de siempre
// ('/api/events?from=...'), asi que los 165 sitios de public/app.js que
// llaman a la API no tuvieron que cambiar: lo unico distinto es el
// camino que recorre la peticion, no como se nombra.
const { ipcMain } = require('electron');
const { handleApiRequest } = require('../core/api');
const { ORIGIN } = require('./protocol');

// Convierte el cuerpo que manda la ventana a lo que espera cada ruta.
//
// Hay dos formas, las mismas dos que habia con HTTP:
//   - Texto JSON: es lo que manda casi todo (JSON.stringify de un
//     objeto). Antes lo desarmaba express.json(); ahora, aqui.
//   - Binario: solo al subir una imagen a una nota o una foto a Viajes.
//     La ventana no puede mandar un File por IPC, asi que lo convierte
//     antes a ArrayBuffer (ver api() en public/app.js) y aqui se
//     reconstruye como Buffer, que es lo que esperan esas dos rutas.

// Los nombres de cabecera se pasan a minusculas. Con HTTP esto lo hacia
// Node por su cuenta (las cabeceras HTTP no distinguen mayusculas), y las
// rutas se escribieron contando con ello: buscan req.headers['content-type'].
// Por IPC llegan tal cual las escribio quien llamo ('Content-Type'), asi
// que hay que normalizarlas aqui o esas rutas no encontrarian nada.
// Fue un fallo real al migrar: subir una imagen a una nota respondia
// "Formato de imagen no soportado" porque la cabecera nunca se leia.
function lowercaseHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) out[key.toLowerCase()] = value;
  return out;
}

function parseBody(body) {
  if (body === null || body === undefined) return undefined;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (err) {
      // Un cuerpo de texto que no es JSON valido. No deberia pasar
      // nunca, pero mejor que llegue tal cual a la ruta que perderlo.
      return body;
    }
  }
  return body;
}

function registerIpc() {
  // invoke/handle (y no send/on) porque esto tiene que DEVOLVER algo:
  // la ventana hace `await window.electronAPI.api(...)` y espera la
  // respuesta, igual que antes esperaba la de fetch().
  ipcMain.handle('api-request', async (event, { path, method, body, headers }) => {
    // La ventana manda la ruta y los parametros juntos en una sola
    // cadena ('/api/events?from=2026-01-01'), que es como se escribian
    // con HTTP. Se separan aqui. El ORIGIN solo hace de base para poder
    // usar URL(), no se usa para nada mas.
    const url = new URL(path, ORIGIN);
    const query = Object.fromEntries(url.searchParams.entries());

    return handleApiRequest({
      method,
      path: url.pathname,
      body: parseBody(body),
      query,
      headers: lowercaseHeaders(headers),
    });
  });
}

module.exports = { registerIpc };
