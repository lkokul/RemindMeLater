// mdns.js — anuncia el servidor en la red local como "remindmelater.local",
// para no depender de escribir una IP concreta desde el movil (que ademas
// cambia segun el adaptador de red del ordenador — wifi, ethernet...).
// Esto es "mDNS"/Bonjour/Zeroconf: cualquier telefono o ordenador en la
// MISMA red local puede resolver ese nombre sin configurar nada aparte.
//
// Si algo falla (red que no soporta multicast, libreria no instalada...)
// no debe tirar abajo el servidor: el emparejamiento por IP de toda la
// vida sigue funcionando igual, esto es solo una comodidad extra.
const HOSTNAME = 'remindmelater.local';

function startMdns(port) {
  let Bonjour;
  try {
    ({ Bonjour } = require('bonjour-service'));
  } catch (err) {
    console.warn('mDNS no disponible (falta instalar bonjour-service):', err.message);
    return null;
  }

  try {
    const bonjour = new Bonjour(undefined, (err) => {
      console.warn('mDNS: error de fondo, sigo sin el (la IP normal sigue funcionando):', err.message);
    });
    bonjour.publish({
      name: 'RemindMeLater',
      host: HOSTNAME,
      type: 'http',
      port,
    });
    console.log(`  Desde el movil (misma wifi, si el mDNS llega): http://${HOSTNAME}:${port}`);
    return bonjour;
  } catch (err) {
    console.warn('No se pudo anunciar por mDNS, sigo sin el:', err.message);
    return null;
  }
}

module.exports = { startMdns, HOSTNAME };
