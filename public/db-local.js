// db-local.js — copia local de los datos en ESTE dispositivo (IndexedDB),
// para la fase "movil": que la app funcione sin conexion al ordenador.
// Se carga ANTES que app.js (ver index.html) — todo lo de aqui son
// funciones sueltas que app.js usa mas tarde, dentro de api() y del
// motor de sincronizacion (ver "Sincronizacion" en app.js); nada de
// esto se ejecuta solo con cargar la pagina.
//
// Cada almacen guarda el MISMO JSON (camelCase) que ya devuelve la API
// hoy — asi el resto de la app no nota diferencia entre "vino del
// servidor" y "vino de la copia local". special_days usa la propia
// fecha como clave (igual que en el servidor); el resto usa "id".
const LOCAL_DB_NAME = 'remindmelater-local';
// Subir este numero cada vez que se anade un almacen nuevo a
// LOCAL_STORES -- onupgradeneeded (mas abajo) SOLO se dispara si la
// version sube, si no un movil que ya tuviera la base de datos creada
// con la version anterior se quedaria sin el almacen nuevo para
// siempre. (v2: se anadio "themes", para sincronizar la biblioteca de
// temas -- ver la ronda que quito la contraseña de notas ocultas.)
const LOCAL_DB_VERSION = 2;
const LOCAL_STORES = {
  events: 'id',
  notes: 'id',
  groups: 'id',
  noteFolders: 'id',
  specialDays: 'date',
  themes: 'id',
};

let localDbPromise = null;

function openLocalDb() {
  if (localDbPromise) return localDbPromise;
  localDbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB no disponible en este navegador'));
      return;
    }
    const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      Object.entries(LOCAL_STORES).forEach(([name, keyPath]) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      });
      if (!db.objectStoreNames.contains('_meta')) db.createObjectStore('_meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('_outbox')) db.createObjectStore('_outbox', { keyPath: 'localOpId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return localDbPromise;
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function localGetAll(storeName) {
  const db = await openLocalDb();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).getAll());
}

async function localGet(storeName, key) {
  const db = await openLocalDb();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).get(key));
}

async function localPut(storeName, value) {
  const db = await openLocalDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

async function localDelete(storeName, key) {
  const db = await openLocalDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Sustituye TODO el contenido de un almacen -- se usa cuando llega una
// lista completa y fresca del servidor (GET exitoso con conexion), para
// que la copia local nunca se quede con filas que ya no existen de
// verdad (por ejemplo, algo que se borro desde otro dispositivo).
async function localReplaceAll(storeName, values) {
  const db = await openLocalDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  store.clear();
  values.forEach((v) => store.put(v));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(values);
    tx.onerror = () => reject(tx.error);
  });
}

async function metaGet(key) {
  const row = await localGet('_meta', key);
  return row ? row.value : undefined;
}

async function metaSet(key, value) {
  return localPut('_meta', { key, value });
}

// Cola de cambios hechos sin conexion, pendientes de mandar al servidor
// en cuanto vuelva a haber wifi con el ordenador (ver pushOutbox en
// app.js). "localOpId" es un uuid generado en el momento, unico por
// intento de escritura.
//
// "seq" es IMPORTANTE: getAll() de IndexedDB devuelve las filas
// ordenadas por su CLAVE (localOpId, un uuid), no por el orden en que
// se crearon -- si una nota offline referencia una carpeta TAMBIEN
// creada offline en la misma sesion, hace falta procesar la carpeta
// PRIMERO para poder sustituir su id temporal antes de mandar la nota
// (ver pushOutbox). Date.now()*1000 + un contador de la sesion evita
// empates dentro del mismo milisegundo y sigue creciendo aunque se
// recargue la pagina a medias (el reloj del sistema no retrocede).
let outboxSeqCounter = 0;
function nextOutboxSeq() {
  outboxSeqCounter += 1;
  return Date.now() * 1000 + (outboxSeqCounter % 1000);
}

async function outboxAdd(entry) {
  return localPut('_outbox', Object.assign({ seq: nextOutboxSeq() }, entry));
}

async function outboxAll() {
  const rows = await localGetAll('_outbox');
  return rows.sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

async function outboxRemove(localOpId) {
  return localDelete('_outbox', localOpId);
}
