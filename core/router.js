// router.js — el enrutador propio de la app, el que sustituye a Express.
//
// POR QUE EXISTE ESTO
// -------------------
// Hasta ahora la ventana de la app era una pagina web que hablaba con un
// servidor Express por HTTP (http://localhost:3000). Eso tenia sentido
// cuando el movil se conectaba al ordenador por wifi: hacia falta un
// servidor de verdad, escuchando en un puerto, para que otro aparato
// pudiera llamar.
//
// Ya no. Ahora la app de escritorio es SOLO Electron, y ahi la ventana y
// la base de datos viven en el mismo programa: no hay ninguna red de por
// medio, asi que no hace falta ni servidor, ni puerto, ni HTTP. La
// ventana le pasa la peticion al proceso principal por IPC (el canal
// interno de Electron, ver electron/ipc.js) y este archivo es quien
// decide que funcion tiene que atenderla.
//
// QUE ES ENTONCES UN "ENRUTADOR"
// ------------------------------
// Nada mas que una tabla de correspondencias: "si llega un GET a
// /api/events/7, llama a esta funcion con id = 7". Eso es lo unico que
// hacia Express por nosotros, y son unas 100 lineas — el resto de
// Express (servidor HTTP, cabeceras, cookies, compresion...) era peso
// muerto en cuanto quitamos la red.
//
// A PROPOSITO, la forma de escribir una ruta es IDENTICA a la de Express
// (router.get('/:id', (req, res) => ...)). Eso no es nostalgia: es que
// asi los 26 archivos de core/routes/ siguen leyendose igual que siempre
// y el cambio no tuvo que reescribirlos endpoint por endpoint (son 143).
// `req` y `res` aqui son objetos normales y corrientes que se fabrican
// unas lineas mas abajo, no tienen nada que ver con HTTP.

// Cuanto esperamos como maximo a que una ruta conteste antes de darla
// por colgada. Ninguna deberia acercarse (SQLite es sincrono y responde
// en microsegundos); esto es solo una red de seguridad para que un fallo
// raro se vea como un error claro en pantalla en vez de dejar la app
// esperando para siempre con el "Cargando..." puesto.
const TIMEOUT_MS = 30 * 1000;

// Convierte '/movements/:id/link-finanzas' en
// ['movements', {param: 'id'}, 'link-finanzas'] — el formato con el que
// luego es facil comparar contra una ruta real trozo a trozo.
function compilePattern(pattern) {
  return pattern
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => (segment.startsWith(':') ? { param: segment.slice(1) } : segment));
}

// Compara una ruta real ya troceada (['movements', '7', 'link-finanzas'])
// contra un patron compilado. Devuelve los parametros encontrados
// ({ id: '7' }) si encaja, o null si no.
//
// Los parametros salen SIEMPRE como texto, igual que en Express — por eso
// las rutas que reciben un id numerico lo pasan por Number() o se lo dan
// tal cual a SQLite, que ya compara bien '7' con 7.
function matchPattern(compiled, segments) {
  if (compiled.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < compiled.length; i += 1) {
    const expected = compiled[i];
    if (typeof expected === 'string') {
      if (expected !== segments[i]) return null;
    } else {
      params[expected.param] = decodeURIComponent(segments[i]);
    }
  }
  return params;
}

// El objeto `res` que reciben las rutas. No escribe en ningun sitio: solo
// se queda con lo que la ruta quiso contestar y avisa (resolve) de que ya
// hay respuesta.
//
// Se admiten las tres unicas formas que usan las rutas de esta app:
//   res.json(objeto)              -> respuesta normal (200)
//   res.status(404).json(objeto)  -> respuesta con otro codigo
//   res.sendFile(ruta)            -> devolver un archivo del disco
//     (solo lo usan las imagenes de notas y los adjuntos de Viajes; quien
//      recibe esto no es la ventana sino el protocolo app:// de Electron,
//      ver electron/protocol.js)
function createResponse(resolve) {
  let statusCode = 200;
  let answered = false;

  const finish = (payload) => {
    // Si una ruta contestara dos veces (un `return` que falta despues de
    // un res.status(400)...), Express se queja con un error feisimo por
    // consola. Aqui simplemente nos quedamos con la PRIMERA respuesta,
    // que es la que la ruta queria dar.
    if (answered) return;
    answered = true;
    resolve(payload);
  };

  const res = {
    status(code) {
      statusCode = code;
      return res; // encadenable: res.status(404).json(...)
    },
    json(body) {
      finish({ status: statusCode, body });
    },
    sendFile(filePath) {
      finish({ status: statusCode, filePath });
    },
    // Alguna ruta usa res.status(204).end() para "hecho, no devuelvo nada".
    end() {
      finish({ status: statusCode, body: null });
    },
  };

  return res;
}

// Crea un enrutador vacio. Cada archivo de core/routes/ crea el suyo,
// registra sus rutas y lo exporta — igual que hacia con express.Router().
function createRouter() {
  const routes = [];

  const register = (method, pattern, handler) => {
    routes.push({ method, compiled: compilePattern(pattern), handler });
  };

  return {
    get: (pattern, handler) => register('GET', pattern, handler),
    post: (pattern, handler) => register('POST', pattern, handler),
    put: (pattern, handler) => register('PUT', pattern, handler),
    patch: (pattern, handler) => register('PATCH', pattern, handler),
    delete: (pattern, handler) => register('DELETE', pattern, handler),

    // Busca que ruta atiende esto y la ejecuta. Devuelve null si ninguna
    // encaja (para que quien llama pueda dar un 404 con sentido).
    //
    // IMPORTANTE: se recorren en el ORDEN EN QUE SE REGISTRARON, y gana
    // la primera que encaje — exactamente igual que Express. Eso importa
    // de verdad en algun archivo: por ejemplo en finanzasAssets.js,
    // '/summary/by-asset' esta declarado ANTES que '/:id/valuations', y
    // si se invirtiera el orden la palabra "summary" se colaria como si
    // fuera un id. Al mover las rutas de Express a aqui NO se cambio el
    // orden de ninguna, justo por esto.
    async dispatch(method, segments, { body, query, headers }) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const params = matchPattern(route.compiled, segments);
        if (!params) continue;

        const req = { params, body, query: query || {}, headers: headers || {} };

        let resolve;
        const answered = new Promise((r) => {
          resolve = r;
        });
        const res = createResponse(resolve);

        // Las rutas pueden ser normales o `async`. Si devuelve una
        // promesa la esperamos, para que un fallo dentro de un `await`
        // llegue aqui como excepcion en vez de perderse.
        const returned = route.handler(req, res);
        if (returned && typeof returned.then === 'function') await returned;

        // Casi siempre `answered` ya esta resuelta a estas alturas (la
        // ruta llamo a res.json() antes de terminar). El Promise.race es
        // por si alguna contesta desde dentro de un callback que no
        // esperamos: le damos su margen y, si no contesta, error claro.
        return Promise.race([
          answered,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('La peticion tardo demasiado en contestar.')), TIMEOUT_MS).unref()
          ),
        ]);
      }
      return null;
    },
  };
}

module.exports = { createRouter };
