// db-local.js — el almacen de IndexedDB de ESTE dispositivo. Guarda dos
// cosas, y solo dos:
//
//   _meta       -> los bytes de la base de datos SQLite entera (ver
//                  local-db.js), volcados tras cada escritura.
//   noteAssets  -> los bytes de las imagenes de nota y las fotos de
//                  viaje. Van FUERA de la base a proposito: meterlos
//                  dentro la hincharia y haria lento cada volcado,
//                  aunque no estes mirando ninguna imagen.
//
// Antes esto era otra cosa: una COPIA de los datos del ordenador (un
// almacen por tabla, mas una cola de cambios pendientes de mandar),
// porque los datos de verdad vivian en un servidor y esto solo servia
// para aguantar sin conexion. Ya no hay servidor -- los datos de verdad
// son estos -- asi que todo aquello desaparecio.
//
// Se carga ANTES que local-db.js y app.js (ver index.html): son
// funciones sueltas que usan mas tarde, nada de esto se ejecuta solo
// con cargar la pagina.
const LOCAL_DB_NAME = 'remindmelater-local';
// Subir este numero cada vez que cambie la lista de almacenes --
// onupgradeneeded SOLO se dispara si la version sube, si no un
// dispositivo que ya tuviera la base creada con la version anterior se
// quedaria sin los cambios para siempre. (v2: se anadio "themes". v3:
// "viajesTrips"/"viajesEntries". v4: se anadio "noteAssets" y se
// borraron todos los almacenes de la copia por tabla, que dejaron de
// tener sentido al desaparecer el servidor.)
const LOCAL_DB_VERSION = 4;
const LOCAL_STORES = {
  noteAssets: 'name',
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
      // Borra los almacenes de la epoca del servidor (la copia por tabla
      // y la cola de cambios pendientes) en un dispositivo que venga de
      // una version anterior -- si no, se quedarian ahi ocupando sitio
      // con datos que ya no lee nadie.
      const vigentes = new Set([...Object.keys(LOCAL_STORES), '_meta']);
      Array.from(db.objectStoreNames).forEach((name) => {
        if (!vigentes.has(name)) db.deleteObjectStore(name);
      });
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

async function localGet(storeName, key) {
  const db = await openLocalDb();
  return reqToPromise(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
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

// --- Bytes de imagenes de nota y fotos de viaje ------------------------
// El "nombre" es el mismo <uuid>.<ext> de siempre, asi que el HTML
// guardado en una nota no cambia en absoluto: sigue diciendo
// /api/notes/images/<uuid>.<ext>. Lo unico distinto es de donde salen
// los bytes al mostrarla (ver resolveAssetUrl() en app.js).
async function assetPut(name, bytes, type) {
  return localPut('noteAssets', { name, bytes, type });
}

async function assetGet(name) {
  return localGet('noteAssets', name);
}

async function assetDelete(name) {
  return localDelete('noteAssets', name);
}

// --- La base de datos entera ------------------------------------------
async function metaGet(key) {
  const row = await localGet('_meta', key);
  return row ? row.value : undefined;
}

async function metaSet(key, value) {
  return localPut('_meta', { key, value });
}
