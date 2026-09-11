// local-api.js — el "servidor" ahora vive dentro de la app.
//
// Las rutas del backend estaban escritas contra Express
// (router.get('/:id', (req, res) => ...), res.status(404).json(...)).
// Al traerlas al movil no hay servidor ni HTTP, pero SI se puede imitar
// esa forma exacta, y asi los ~24 archivos de rutas se portan
// practicamente tal cual en vez de reescribirse.
//
// Este archivo es esa imitacion: un Router minimo y un despachador que
// convierte "GET /api/events?from=..." en la llamada al manejador que
// corresponda. Solo implementa lo que las rutas usan de verdad
// (comprobado contando usos en el backend): de `res`, status(),
// json(), end() y send(); de `req`, params, body, query y headers; y
// los cinco verbos get/post/put/patch/delete.

// Routers montados, por su ruta base ('/api/events' -> router). Se
// ordenan por longitud al despachar para que la base mas concreta gane
// (p. ej. '/api/note-folders' antes que '/api/notes').
const localRouters = new Map();

function createLocalRouter() {
  const routes = [];

  // Express admite middlewares entre la ruta y el manejador
  // (router.get('/', requireDeviceOrTrusted, handler)). Aqui no hay
  // autenticacion que aplicar -- sin servidor, todo es acceso local del
  // propio dueño del dispositivo -- asi que se ignoran y solo se
  // ejecuta el ultimo argumento, que es el manejador de verdad.
  function add(method, path, ...handlers) {
    routes.push({
      method,
      segments: path.split('/').filter(Boolean),
      path,
      handler: handlers[handlers.length - 1],
    });
  }

  return {
    get: (path, ...h) => add('GET', path, ...h),
    post: (path, ...h) => add('POST', path, ...h),
    put: (path, ...h) => add('PUT', path, ...h),
    patch: (path, ...h) => add('PATCH', path, ...h),
    delete: (path, ...h) => add('DELETE', path, ...h),
    routes,
  };
}

function mountLocalRouter(basePath, router) {
  localRouters.set(basePath, router);
}

// Casa una ruta declarada ('/movements/:id') contra la pedida
// ('/movements/7'), devolviendo los parametros o null si no encaja.
// Solo hay segmentos fijos y :parametro -- no hace falta nada mas
// (comprobado: ninguna ruta del backend usa comodines ni expresiones).
function matchRouteSegments(routeSegments, requestSegments) {
  if (routeSegments.length !== requestSegments.length) return null;
  const params = {};
  for (let i = 0; i < routeSegments.length; i += 1) {
    const declared = routeSegments[i];
    const actual = requestSegments[i];
    if (declared.startsWith(':')) {
      params[declared.slice(1)] = decodeURIComponent(actual);
    } else if (declared !== actual) {
      return null;
    }
  }
  return params;
}

// Imita el `res` de Express en lo justo: encadenable
// (res.status(400).json(...)) y guardando lo que se responde.
function createLocalResponse() {
  const result = { status: 200, body: undefined, answered: false };
  const res = {
    status(code) {
      result.status = code;
      return res;
    },
    json(payload) {
      result.body = payload;
      result.answered = true;
      return res;
    },
    // res.status(204).end() es como responden los 31 borrados del
    // backend: sin cuerpo. Sin esto reventaban con ".end is not a
    // function" (fallo real encontrado al comparar el porte contra el
    // servidor de verdad).
    end() {
      result.body = null;
      result.answered = true;
      return res;
    },
    send(payload) {
      result.body = payload === undefined ? null : payload;
      result.answered = true;
      return res;
    },
    sendStatus(code) {
      result.status = code;
      result.body = null;
      result.answered = true;
      return res;
    },
  };
  return { res, result };
}

// El equivalente local de "hacer una peticion al servidor".
// Devuelve { status, body } igual que haria una respuesta HTTP, para
// que api() (en app.js) siga tratando errores como siempre.
async function dispatchLocalRequest(method, pathname, searchParams, body, headers) {
  const bases = Array.from(localRouters.keys()).sort((a, b) => b.length - a.length);
  const base = bases.find((b) => pathname === b || pathname.startsWith(`${b}/`));
  if (!base) {
    return { status: 404, body: { error: 'not_found', message: `Ruta desconocida: ${pathname}` } };
  }

  const router = localRouters.get(base);
  const rest = pathname.slice(base.length) || '/';
  const requestSegments = rest.split('/').filter(Boolean);

  // Se recorre en orden de registro, igual que Express -- importa,
  // porque varias rutas declaran '/summary/month' ANTES que '/:id' y al
  // reves se tragaria "summary" como si fuera un id.
  for (const route of router.routes) {
    if (route.method !== method) continue;
    const params = matchRouteSegments(route.segments, requestSegments);
    if (!params) continue;

    const query = {};
    if (searchParams) searchParams.forEach((value, key) => { query[key] = value; });

    // `headers` casi nunca hace falta: solo las subidas de imagen/foto
    // miran el content-type para saber la extension del archivo. Las
    // claves se bajan a minusculas igual que hace Express, porque las
    // rutas las leen asi (req.headers['content-type']) -- sin esto, un
    // 'Content-Type' de quien llama no lo encontraba nadie.
    const lowerHeaders = {};
    Object.entries(headers || {}).forEach(([k, v]) => { lowerHeaders[k.toLowerCase()] = v; });
    const req = { params, query, body: body || {}, headers: lowerHeaders };
    const { res, result } = createLocalResponse();
    try {
      await route.handler(req, res);
    } catch (err) {
      console.error(`Error en ${method} ${pathname}:`, err);
      return { status: 500, body: { error: 'internal_error', message: err.message } };
    }
    if (!result.answered) {
      return { status: 500, body: { error: 'internal_error', message: `${method} ${pathname} no respondio nada` } };
    }
    return { status: result.status, body: result.body };
  }

  return { status: 404, body: { error: 'not_found', message: `Ruta desconocida: ${method} ${pathname}` } };
}

// ---------------------------------------------------------------------
// EL NOMBRE DE UNA COPIA
// ---------------------------------------------------------------------
//
// Lo comparten las cinco rutas que duplican (notas, carpetas, bloques,
// dias y ejercicios), asi que vive aqui, con el resto de la fonataneria
// comun, en vez de repetido cinco veces. Es global a proposito: cada
// archivo de routes-local/ va en su propio IIFE y no puede importar nada.
//
// La regla la eligio Koku: la primera copia es "Empuje_copia" y a partir
// de ahi se NUMERA -- "Empuje_copia 2", "Empuje_copia 3"... En vez de
// encadenar sufijos ("Empuje_copia_copia_copia"), que a la cuarta vez no
// cabe en la fila.
//
// Por eso, duplicar una copia no vuelve a pegar "_copia": se le quita el
// sufijo que ya trae para averiguar el nombre RAIZ y se busca el primer
// hueco libre a partir de ahi. O sea que duplicar "Empuje_copia" da
// "Empuje_copia 2", no "Empuje_copia_copia".
//
// `existentes` son los nombres con los que NO puede chocar (los de su
// misma carpeta, su mismo bloque...). La comparacion NO distingue
// mayusculas: tener "Empuje_copia" y "empuje_copia" a la vez seria
// confuso aunque para SQLite sean distintos.
const RE_SUFIJO_DE_COPIA = /_copia(?: (\d+))?$/;

function nombreDeCopia(base, existentes) {
  const raiz = String(base == null ? '' : base).replace(RE_SUFIJO_DE_COPIA, '');
  const tomados = new Set((existentes || []).map((n) => String(n == null ? '' : n).trim().toLowerCase()));
  const candidato = (n) => (n === 1 ? `${raiz}_copia` : `${raiz}_copia ${n}`);
  // El tope no es por miedo a un bucle infinito (cada vuelta descarta un
  // nombre), es para no quedarse colgado si alguien tiene miles: a partir
  // de ahi se devuelve el ultimo probado aunque choque, que es mejor que
  // no responder.
  for (let n = 1; n <= 9999; n++) {
    if (!tomados.has(candidato(n).trim().toLowerCase())) return candidato(n);
  }
  return candidato(9999);
}
