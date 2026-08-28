// archivosTransfers.js — solicitudes de transferencia de la extension
// Archivos pendientes de confirmar por el otro lado. Mismo patron que
// pairing.js (Map en memoria, TTL corto, limpieza periodica): son datos
// de usar-y-tirar, no tiene sentido que sobrevivan a un reinicio del
// servidor.
//
// SOLO un movil emparejado crea solicitudes -- el ordenador, cuando usa
// el mismo panel de Archivos para copiar un archivo local a su propia
// carpeta compartida (o para traer uno de ahi a si mismo), sigue
// actuando al instante como siempre (ver el porque exacto junto a los
// listeners de los botones "Enviar"/"Recibir" en public/app.js): origen
// y destino son la misma maquina fisica, no hay "otro lado" al que
// pedirle permiso. La confirmacion cruzada solo tiene sentido, y solo se
// pide, cuando de verdad hay dos dispositivos fisicos distintos
// implicados -- que es justo el caso que le preocupaba a Koku (uno de
// los dos actuando sin que el otro se entere).
const crypto = require('crypto');

// 2 minutos: tiempo de reaccion humana razonable para que quien esta
// delante del ordenador vea el aviso y pulse Aceptar/Rechazar. A
// diferencia del TTL del codigo de emparejamiento (30s, ver pairing.js),
// esto no protege contra fuerza bruta -- no es un secreto que adivinar,
// es una confirmacion humana -- asi que no hace falta que sea tan corto.
const REQUEST_TTL_MS = 2 * 60 * 1000;
// Margen tras resolverse/caducar antes de barrerla del todo de la
// memoria: para que un ultimo poll que llegue justo tarde todavia pueda
// leer el estado final (aceptada/rechazada/caducada) en vez de un 404
// confuso sin explicacion.
const SWEEP_GRACE_MS = 60 * 1000;

const requests = new Map(); // id -> record

function createRequest({ direction, files }) {
  const id = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const record = {
    id,
    direction, // 'upload' (movil -> ordenador) | 'download' (ordenador -> movil)
    files, // [{name, size}], solo para mostrar en el aviso de confirmacion
    status: 'pending', // pending | accepted | rejected
    createdAt: now,
    expiresAt: now + REQUEST_TTL_MS,
  };
  requests.set(id, record);
  return record;
}

// Lista para el ordenador: todo lo pendiente de verdad (no caducado).
function listPending() {
  const now = Date.now();
  return Array.from(requests.values()).filter((r) => r.status === 'pending' && r.expiresAt > now);
}

// Consulta puntual (la usa el movil que la creo, para su propio
// polling). Si ya caduco pero la limpieza periodica todavia no la ha
// barrido, se informa como 'expired' sin mutar el registro real.
function getRequest(id) {
  const record = requests.get(id);
  if (!record) return null;
  if (record.status === 'pending' && record.expiresAt <= Date.now()) {
    return { ...record, status: 'expired' };
  }
  return record;
}

function resolveRequest(id, status) {
  const record = requests.get(id);
  if (!record || record.status !== 'pending' || record.expiresAt <= Date.now()) return null;
  record.status = status;
  return record;
}

function cancelRequest(id) {
  return requests.delete(id);
}

// Limpieza periodica: fuera lo caducado/resuelto con el margen de arriba.
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of requests) {
    if (now > r.expiresAt + SWEEP_GRACE_MS) requests.delete(id);
  }
}, 60 * 1000).unref();

module.exports = { createRequest, listPending, getRequest, resolveRequest, cancelRequest };
