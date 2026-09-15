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

// ---------------------------------------------------------------------
// EVENTOS QUE SE REPITEN
//
// Compartido entre rutas (events.js lo usa para pintar el calendario y
// reminders.js para programar los avisos), asi que vive aqui por el
// mismo motivo que nombreDeCopia: cada archivo de routes-local/ va en su
// IIFE y no puede importar nada de otro.
//
// La idea en una frase: en la base hay UNA fila con la regla, y las
// repeticiones se calculan cada vez que hacen falta. Nunca se guardan
// filas por adelantado -- ver el comentario del esquema en
// local-schema.js.
// ---------------------------------------------------------------------

// 'YYYY-MM-DDTHH:MM:SS' -> Date en hora LOCAL.
//
// Sin la Z final, JavaScript ya lo interpreta como local, que es lo que
// queremos: un evento a las 9:00 son las 9:00 donde estes, no una hora
// desplazada por el huso. Devuelve null si no se puede leer.
function fechaLocalDeTexto(texto) {
  if (!texto) return null;
  const d = new Date(String(texto).length <= 10 ? `${texto}T00:00:00` : texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Date -> 'YYYY-MM-DDTHH:MM:SS', tambien en local.
//
// A mano y NO con toISOString(), que pasa a UTC: a las 00:30 en España
// eso devolveria el dia anterior. Es la misma trampa que ya estaba
// apuntada para hoyISO() y widgetHoyISO().
function textoDeFechaLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function claveDeDiaLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const FRECUENCIAS_DE_REPETICION = new Set(['daily', 'weekly', 'monthly', 'yearly']);

// Lee la regla de una fila de events. Devuelve null si no se repite.
function reglaDeRepeticion(row) {
  if (!row || !row.repeat_freq || !FRECUENCIAS_DE_REPETICION.has(row.repeat_freq)) return null;
  let dias = [];
  try {
    const crudo = row.repeat_weekdays ? JSON.parse(row.repeat_weekdays) : [];
    if (Array.isArray(crudo)) {
      dias = [...new Set(crudo.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
    }
  } catch (err) { dias = []; }
  return {
    freq: row.repeat_freq,
    // Un intervalo de 0 o negativo dejaria el bucle sin avanzar nunca:
    // se fuerza a 1 como minimo.
    interval: Math.max(1, Math.min(365, Number(row.repeat_interval) || 1)),
    weekdays: dias,
    until: row.repeat_until || null,
  };
}

function diasSaltados(row) {
  try {
    const crudo = row && row.repeat_skip ? JSON.parse(row.repeat_skip) : [];
    return new Set(Array.isArray(crudo) ? crudo.map((s) => String(s)) : []);
  } catch (err) {
    return new Set();
  }
}

// Devuelve las repeticiones de "row" que caen dentro de [desde, hasta],
// cada una como { startAt, endAt, occurrenceDate }.
//
// Tope de seguridad: como mucho MAX_OCURRENCIAS por evento y rango. Un
// evento diario en una vista de año son 365, asi que 500 deja margen sin
// permitir que una regla rara (o una base manipulada a mano) cuelgue la
// app pintando un mes.
const MAX_OCURRENCIAS = 500;

function repeticionesDeEvento(row, desdeTexto, hastaTexto) {
  const regla = reglaDeRepeticion(row);
  const inicio = fechaLocalDeTexto(row && row.start_at);
  if (!regla || !inicio) return [];

  const desde = fechaLocalDeTexto(desdeTexto);
  const hasta = fechaLocalDeTexto(hastaTexto);
  if (!desde || !hasta || hasta < desde) return [];

  // El final de la regla manda sobre el final del rango pedido.
  const finRegla = regla.until ? fechaLocalDeTexto(`${regla.until}T23:59:59`) : null;
  const tope = finRegla && finRegla < hasta ? finRegla : hasta;
  if (tope < inicio) return [];

  const fin = fechaLocalDeTexto(row.end_at);
  // Lo que dura el evento se conserva en cada repeticion. Si no tiene
  // hora de fin, tampoco la tendran las copias.
  const duracionMs = fin && fin > inicio ? fin - inicio : null;
  const saltados = diasSaltados(row);

  // Coloca la hora del evento original en una fecha cualquiera. Hace
  // falta despues de cada salto porque sumar dias en local puede mover
  // la hora una hora arriba o abajo al cruzar un cambio de horario.
  const conLaHoraDeSiempre = (d) => {
    d.setHours(inicio.getHours(), inicio.getMinutes(), inicio.getSeconds(), 0);
    return d;
  };

  const salida = [];
  const anotar = (arranque) => {
    if (arranque < inicio) return true;
    if (arranque > tope) return false;
    const clave = claveDeDiaLocal(arranque);
    // El rango puede empezar a media tarde: se compara contra el FIN del
    // evento para no perder uno que arranco antes de "desde".
    const acaba = duracionMs ? new Date(arranque.getTime() + duracionMs) : arranque;
    if (acaba >= desde && !saltados.has(clave)) {
      salida.push({
        startAt: textoDeFechaLocal(arranque),
        endAt: duracionMs ? textoDeFechaLocal(acaba) : null,
        occurrenceDate: clave,
      });
    }
    return true;
  };

  if (regla.freq === 'weekly' && regla.weekdays.length) {
    // Varios dias marcados (L, X y V en una sola repeticion). Se avanza
    // SEMANA a semana desde la del evento original y dentro de cada una
    // se sacan los dias marcados; asi "cada 2 semanas los lunes y
    // viernes" sale solo, sin casos especiales.
    const semanaBase = new Date(inicio);
    semanaBase.setDate(semanaBase.getDate() - semanaBase.getDay());
    semanaBase.setHours(0, 0, 0, 0);
    const semanaDesde = new Date(desde);
    semanaDesde.setDate(semanaDesde.getDate() - semanaDesde.getDay());
    semanaDesde.setHours(0, 0, 0, 0);
    const semanasDeDiferencia = Math.floor((semanaDesde - semanaBase) / (7 * 86400000));
    let k = Math.max(0, Math.floor(semanasDeDiferencia / regla.interval));
    for (let vueltas = 0; vueltas < MAX_OCURRENCIAS; vueltas++, k++) {
      const semana = new Date(semanaBase);
      semana.setDate(semana.getDate() + k * 7 * regla.interval);
      semana.setHours(0, 0, 0, 0);
      if (semana > tope) break;
      let algunoCabe = false;
      for (const wd of regla.weekdays) {
        const d = conLaHoraDeSiempre(new Date(semana.getFullYear(), semana.getMonth(), semana.getDate() + wd));
        if (anotar(d)) algunoCabe = true;
      }
      if (!algunoCabe && semana > desde) break;
      if (salida.length >= MAX_OCURRENCIAS) break;
    }
    salida.sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
    return salida.slice(0, MAX_OCURRENCIAS);
  }

  // El resto (y "cada semana" sin dias marcados) es un salto fijo desde
  // la fecha original. Se calcula de una vez cuantos saltos hay hasta el
  // principio del rango en vez de ir uno a uno: un evento diario creado
  // hace diez años son 3.650 vueltas que no hacen falta.
  const saltoInicial = () => {
    const ms = desde - inicio;
    if (ms <= 0) return 0;
    if (regla.freq === 'daily') return Math.floor(ms / 86400000 / regla.interval);
    if (regla.freq === 'weekly') return Math.floor(ms / (7 * 86400000) / regla.interval);
    const meses = (desde.getFullYear() - inicio.getFullYear()) * 12 + (desde.getMonth() - inicio.getMonth());
    if (regla.freq === 'monthly') return Math.max(0, Math.floor(meses / regla.interval));
    return Math.max(0, Math.floor(meses / 12 / regla.interval));
  };

  let n = saltoInicial();
  for (let vueltas = 0; vueltas < MAX_OCURRENCIAS + 60; vueltas++, n++) {
    let d;
    if (regla.freq === 'daily') {
      d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + n * regla.interval);
    } else if (regla.freq === 'weekly') {
      d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + n * 7 * regla.interval);
    } else if (regla.freq === 'monthly') {
      d = new Date(inicio.getFullYear(), inicio.getMonth() + n * regla.interval, inicio.getDate());
      // Un evento del 31 en un mes de 30 se SALTA ese mes, no se corre al
      // 1 del siguiente: "todos los 31" no incluye febrero.
      if (d.getDate() !== inicio.getDate()) continue;
    } else {
      d = new Date(inicio.getFullYear() + n * regla.interval, inicio.getMonth(), inicio.getDate());
      // Mismo criterio para un 29 de febrero: solo los años bisiestos.
      if (d.getDate() !== inicio.getDate() || d.getMonth() !== inicio.getMonth()) continue;
    }
    conLaHoraDeSiempre(d);
    if (d > tope) break;
    anotar(d);
    if (salida.length >= MAX_OCURRENCIAS) break;
  }
  return salida;
}
