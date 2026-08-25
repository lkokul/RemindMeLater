// routes/devices.js — emparejar moviles y gestionarlos desde el ordenador.
const express = require('express');
const crypto = require('crypto');
const os = require('os');
const QRCode = require('qrcode');
const db = require('../db');
const { requireTrusted, requireDeviceOrTrusted } = require('../auth');
const { generateCode, consumeCode } = require('../pairing');
const { getVapidPublicKey } = require('../push');
const { useRealNetworkInterfacesOnly } = require('../mdns');

const router = express.Router();

// IP LAN "de verdad" de este ordenador ahora mismo, para el QR de "conectar
// en esta red" (ver /network-info y /network-qr.svg mas abajo). Reutiliza
// el mismo filtro de adaptadores virtuales/VPN que ya usa el mDNS (ver
// mdns.js) para no ofrecer una IP de VMware/WSL/etc que el movil no podria
// alcanzar nunca. Se llama a useRealNetworkInterfacesOnly() aqui tambien
// (aunque startMdns() ya lo hace al arrancar) porque es idempotente y asi
// esta ruta no depende de que el mDNS haya arrancado bien.
function getLanUrl() {
  useRealNetworkInterfacesOnly();
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const port = process.env.PORT || 3000;
        return `http://${net.address}:${port}`;
      }
    }
  }
  return null;
}

// Solo el ordenador puede pedir un codigo nuevo (evita que un desconocido
// en tu wifi genere codigos para si mismo).
router.post('/pairing-code', requireTrusted, (req, res) => {
  const { code, expiresAt } = generateCode();
  res.json({ code, expiresAt });
});

// Cualquiera en la red puede LLAMAR a este endpoint, pero solo funciona si
// trae un codigo valido y no caducado generado en el paso anterior. Es el
// unico momento en que un dispositivo "de fuera" puede entrar.
router.post('/pair', (req, res) => {
  const { code, name } = req.body || {};
  if (!code || !name || !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta el codigo o el nombre del dispositivo.' });
  }
  if (!consumeCode(String(code).trim())) {
    return res.status(400).json({ error: 'invalid_code', message: 'Codigo incorrecto o caducado. Genera uno nuevo en el ordenador.' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const info = db
    .prepare('INSERT INTO devices (name, token) VALUES (?, ?)')
    .run(name.trim(), token);

  res.status(201).json({ deviceId: info.lastInsertRowid, token, name: name.trim() });
});

// Direccion de este ordenador en la red actual, en texto -- para mostrarla
// debajo del QR (por si alguien prefiere teclearla a mano) y para que el
// navegador sepa si hay alguna red activa antes de intentar pintar el QR.
router.get('/network-info', requireTrusted, (req, res) => {
  const url = getLanUrl();
  if (!url) {
    return res.status(404).json({ error: 'no_network', message: 'No se ha detectado ninguna red activa.' });
  }
  res.json({ url });
});

// Lo mismo, pero como imagen QR (SVG) lista para meter en un <img src="...">
// -- el movil ya emparejado la escanea desde "Este dispositivo" > "Conectar
// en esta red" para saber a que IP mandar los datos en la wifi de ahora,
// sin tener que volver a vincularse (ver getServerBaseUrl() en app.js).
router.get('/network-qr.svg', requireTrusted, async (req, res) => {
  const url = getLanUrl();
  if (!url) return res.status(404).send('');
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
  res.type('image/svg+xml').send(svg);
});

// Ver y revocar dispositivos: solo desde el ordenador.
router.get('/', requireTrusted, (req, res) => {
  const devices = db
    .prepare('SELECT id, name, icon, paired_at, last_seen_at FROM devices ORDER BY paired_at DESC')
    .all();
  res.json(devices.map((d) => ({ ...d, icon: d.icon || null })));
});

// --- Notificaciones push (avisan con la app cerrada, ver server/push.js) ---
// IMPORTANTE: estas rutas van ANTES de "/:id" mas abajo -- Express
// compara las rutas en el orden en que se registran, y "/:id" haria
// match con "/push-subscription" (tratando ese texto como si fuera un
// id) si estuviera declarada primero, robandole la peticion a esta.
//
// Dato publico por diseño del protocolo Web Push (no identifica a
// nadie, solo a este servidor) -- igual se deja detras de
// requireDeviceOrTrusted por coherencia con el resto de la API, ya que
// solo hace falta cuando el movil ya esta emparejado y va a suscribirse.
router.get('/push-public-key', requireDeviceOrTrusted, (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

// Guarda la suscripcion de ESTE movil (req.device, del token). El
// ordenador (req.isTrusted, sin req.device) no tiene sentido que llame
// aqui -- ya usa node-notifier directamente, sin pasar por Google/Apple.
router.post('/push-subscription', requireDeviceOrTrusted, (req, res) => {
  if (!req.device) {
    return res.status(400).json({ error: 'not_a_device', message: 'Las notificaciones push son solo para moviles emparejados.' });
  }
  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'invalid_request', message: 'Falta la suscripcion.' });
  }
  const profile = db.prepare('SELECT email FROM user_profile WHERE id = 1').get();
  if (!profile || !profile.email) {
    return res.status(400).json({
      error: 'missing_email',
      message: 'Antes de activar los avisos push hace falta un correo de contacto en Configuracion > Perfil (lo exige el protocolo Web Push).',
    });
  }
  db.prepare('UPDATE devices SET push_subscription = ? WHERE id = ?').run(JSON.stringify(subscription), req.device.id);
  res.status(204).end();
});

router.delete('/push-subscription', requireDeviceOrTrusted, (req, res) => {
  if (!req.device) return res.status(400).json({ error: 'not_a_device' });
  db.prepare('UPDATE devices SET push_subscription = NULL WHERE id = ?').run(req.device.id);
  res.status(204).end();
});

function sanitizeIcon(icon) {
  if (icon === undefined) return undefined; // "no lo toques"
  if (icon === null || icon === '') return null; // "quitalo"
  return String(icon).slice(0, 8); // ver groups.js para el porque de este limite
}

// Renombrar y/o cambiar el icono de un dispositivo. El nombre sigue
// siendo texto libre (por si alguien prefiere seguir metiendo el emoji
// ahi), pero ahora tambien hay un icono APARTE, pensado para eso.
router.patch('/:id', requireTrusted, (req, res) => {
  const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, icon } = req.body || {};
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'El nombre no puede estar vacio.' });
  }
  const sanitizedIcon = sanitizeIcon(icon);

  db.prepare('UPDATE devices SET name = ?, icon = ? WHERE id = ?').run(
    name !== undefined ? name.trim() : existing.name,
    sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
    req.params.id
  );

  const row = db.prepare('SELECT id, name, icon, paired_at, last_seen_at FROM devices WHERE id = ?').get(req.params.id);
  res.json({ ...row, icon: row.icon || null });
});

router.delete('/:id', requireTrusted, (req, res) => {
  const info = db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
