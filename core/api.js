// api.js — la tabla de "que prefijo de ruta atiende cada archivo".
//
// Es el sustituto directo del antiguo server/index.js: aquel montaba
// cada router en Express con app.use('/api/events', ...), este hace lo
// mismo pero sin Express y sin servidor (ver core/router.js para el
// porque). La lista de abajo es, casi linea por linea, la misma que
// habia alli — quitando lo que solo existia por el movil (dispositivos,
// emparejamiento, sincronizacion y la extension Archivos).
//
// Ya NO hay ningun control de acceso aqui, y eso es intencionado: antes
// cada ruta pasaba por requireDeviceOrTrusted porque el servidor
// escuchaba en la red local y cualquier aparato de la wifi podia llamar.
// Ahora la unica forma de llegar hasta aqui es a traves del IPC de
// Electron, o sea desde la propia ventana de la app, en el mismo
// programa. No hay nada de lo que autenticarse: si estas ejecutando la
// app, eres tu.
const { createRouter } = require('./router');

const MOUNTS = [
  ['/api/events', require('./routes/events')],
  ['/api/reminders', require('./routes/reminders')],
  ['/api/groups', require('./routes/groups')],
  ['/api/themes', require('./routes/themes')],
  ['/api/profile', require('./routes/profile')],
  ['/api/special-days', require('./routes/specialDays')],
  ['/api/notes', require('./routes/notes')],
  ['/api/note-folders', require('./routes/noteFolders')],
  ['/api/notes/images', require('./routes/noteImages')],

  // Extension "Gimnasio": registro de entrenamientos, rutinas
  // reutilizables y progreso.
  ['/api/gym-exercises', require('./routes/gymExercises')],
  ['/api/gym-routines', require('./routes/gymRoutines')],
  ['/api/gym-sessions', require('./routes/gymSessions')],

  // Extension "Finanzas": gastos, ingresos e inversiones (solo registro
  // manual, sin API de cotizaciones).
  ['/api/finanzas-accounts', require('./routes/finanzasAccounts')],
  ['/api/finanzas-categories', require('./routes/finanzasCategories')],
  ['/api/finanzas-transactions', require('./routes/finanzasTransactions')],
  ['/api/finanzas-investments', require('./routes/finanzasInvestments')],
  ['/api/finanzas-settings', require('./routes/finanzasSettings')],
  ['/api/finanzas-portfolios', require('./routes/finanzasPortfolios')],
  ['/api/finanzas-assets', require('./routes/finanzasAssets')],
  ['/api/finanzas-recurring-expenses', require('./routes/finanzasRecurringExpenses')],
  ['/api/finanzas-debts', require('./routes/finanzasDebts')],

  // Extension "Lecturas": historial de entretenimiento
  // (manga/comic/libro/serie/anime/pelicula) agrupado en sagas.
  ['/api/lecturas-sagas', require('./routes/lecturasSagas')],
  ['/api/lecturas-items', require('./routes/lecturasItems')],

  // Extension "Viajes": viajes por pais(es) con bitacora + fotos, mapa
  // interactivo, y tickets enlazables a Finanzas.
  ['/api/viajes-trips', require('./routes/viajesTrips')],
  ['/api/viajes-entries', require('./routes/viajesEntries')],

  // Traer una version nueva del codigo desde GitHub con "git pull".
  ['/api/update', require('./routes/update')],
];

// Se ordena de prefijo mas LARGO a mas corto, una sola vez al arrancar.
// Hace falta por un caso concreto: '/api/notes/images/abc.jpg' empieza
// tanto por '/api/notes' como por '/api/notes/images', y quien tiene que
// atenderla es la segunda. Ordenando asi, la primera que encaja es
// siempre la mas especifica.
const SORTED_MOUNTS = [...MOUNTS].sort((a, b) => b[0].length - a[0].length);

function trocear(path) {
  return path.split('/').filter((segment) => segment !== '');
}

// Atiende una peticion. `path` es la misma cadena de siempre
// ('/api/events/7'), porque la ventana sigue pidiendo las cosas por su
// ruta — lo unico que cambio es por donde viaja (IPC en vez de HTTP), no
// como se nombra cada cosa. Eso permitio no tocar los 165 sitios de
// public/app.js que llaman a la API.
//
// Devuelve siempre { status, body } o { status, filePath }, nunca lanza:
// un fallo dentro de una ruta sale como un 500 con su mensaje, para que
// la ventana pueda enseñarlo igual que enseñaba los errores del servidor.
async function handleApiRequest({ method, path, body, query, headers }) {
  const upperMethod = String(method || 'GET').toUpperCase();

  for (const [prefix, router] of SORTED_MOUNTS) {
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;

    const segments = trocear(path.slice(prefix.length));
    try {
      const result = await router.dispatch(upperMethod, segments, { body, query, headers });
      // null = este router no tiene ninguna ruta para eso. Se sigue
      // probando con los demas prefijos por si otro (mas corto) encaja.
      if (result) return result;
    } catch (err) {
      console.error(`Fallo atendiendo ${upperMethod} ${path}:`, err);
      return { status: 500, body: { error: 'server_error', message: err.message } };
    }
  }

  return { status: 404, body: { error: 'not_found', message: `No existe la ruta ${upperMethod} ${path}.` } };
}

module.exports = { handleApiRequest, createRouter };
