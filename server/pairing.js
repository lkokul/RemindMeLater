// pairing.js — codigos de emparejamiento temporales.
// Viven solo en memoria (no en la base de datos): son de usar-y-tirar,
// duran 5 minutos y desaparecen si reinicias el servidor. Eso esta bien,
// porque su unico trabajo es autorizar UNA vez a un movil nuevo; despues
// el movil usa su token permanente (guardado en la tabla devices).
const crypto = require('crypto');

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const codes = new Map(); // code -> expiresAt (timestamp)

function generateCode() {
  // Codigo de 6 digitos, facil de teclear en el movil.
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expiresAt = Date.now() + CODE_TTL_MS;
  codes.set(code, expiresAt);
  return { code, expiresAt };
}

function consumeCode(code) {
  const expiresAt = codes.get(code);
  if (!expiresAt) return false;
  codes.delete(code); // de un solo uso
  return Date.now() <= expiresAt;
}

// Limpieza periodica de codigos caducados para no acumular basura en memoria.
setInterval(() => {
  const now = Date.now();
  for (const [code, expiresAt] of codes) {
    if (now > expiresAt) codes.delete(code);
  }
}, 60 * 1000).unref();

module.exports = { generateCode, consumeCode };
