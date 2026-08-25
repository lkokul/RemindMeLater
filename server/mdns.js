// mdns.js — anuncia el servidor en la red local como "remindmelater.local",
// para no depender de escribir una IP concreta desde el movil (que ademas
// cambia segun el adaptador de red del ordenador — wifi, ethernet...).
// Esto es "mDNS"/Bonjour/Zeroconf: cualquier telefono o ordenador en la
// MISMA red local puede resolver ese nombre sin configurar nada aparte.
//
// Si algo falla (red que no soporta multicast, libreria no instalada...)
// no debe tirar abajo el servidor: el emparejamiento por IP de toda la
// vida sigue funcionando igual, esto es solo una comodidad extra.
const os = require('os');

const HOSTNAME = 'remindmelater.local';

// bonjour-service no deja restringir por que interfaz anuncia -- por
// dentro recorre TODOS los adaptadores de red activos (os.networkInterfaces())
// y publica una IP por cada uno, Y ADEMAS lo vuelve a recalcular en
// caliente cada vez que llega una consulta de verdad (no solo una vez al
// publicar) -- asi que no vale con filtrar solo durante publish(), hay
// que dejarlo filtrado para SIEMPRE mientras el proceso este vivo. En un
// ordenador con adaptadores virtuales (VMware, WSL, el adaptador de una
// VPN aunque la app este cerrada...) esto hacia que el movil recibiera
// varias IPs candidatas para remindmelater.local, casi todas
// inalcanzables desde fuera de este ordenador, y podia quedarse con la
// que no toca en vez de la de verdad (confirmado con Resolve-DnsName:
// devolvia la IP real de Ethernet MAS las de VMnet1/VMnet8/WSL, sin
// cambiar ni con la cache de DNS vaciada). Se parchea aqui de forma
// PERMANENTE -- de paso, tambien limpia el listado de IPs por consola
// que hace el propio server/index.js como respaldo (usa esta misma
// funcion), que tenia el mismo ruido.
const VIRTUAL_ADAPTER_NAME = /virtual|vmware|vmnet|vethernet|hyper-v|wsl|tap|tun\d|wireguard|nordlynx|openvpn|\bvpn\b|npcap|docker|loopback|bluetooth|área local|area local/i;

let realInterfacesPatchApplied = false;

function useRealNetworkInterfacesOnly() {
  if (realInterfacesPatchApplied) return;
  realInterfacesPatchApplied = true;
  const original = os.networkInterfaces;
  os.networkInterfaces = function () {
    const all = original.call(os);
    const filtered = {};
    for (const [name, addrs] of Object.entries(all)) {
      if (VIRTUAL_ADAPTER_NAME.test(name)) continue;
      const realAddrs = addrs.filter((a) => !a.address.startsWith('169.254.'));
      if (realAddrs.length) filtered[name] = realAddrs;
    }
    return filtered;
  };
}

function startMdns(port) {
  let Bonjour;
  try {
    ({ Bonjour } = require('bonjour-service'));
  } catch (err) {
    console.warn('mDNS no disponible (falta instalar bonjour-service):', err.message);
    return null;
  }

  try {
    useRealNetworkInterfacesOnly();
    const bonjour = new Bonjour(undefined, (err) => {
      console.warn('mDNS: error de fondo, sigo sin el (la IP normal sigue funcionando):', err.message);
    });
    bonjour.publish({
      name: 'RemindMeLater',
      host: HOSTNAME,
      type: 'http',
      port,
      disableIPv6: true,
    });
    console.log(`  Desde el movil (misma wifi, si el mDNS llega): http://${HOSTNAME}:${port}`);
    return bonjour;
  } catch (err) {
    console.warn('No se pudo anunciar por mDNS, sigo sin el:', err.message);
    return null;
  }
}

module.exports = { startMdns, HOSTNAME, useRealNetworkInterfacesOnly };
