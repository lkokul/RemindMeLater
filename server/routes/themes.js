// routes/themes.js — biblioteca de temas de estilo, compartida entre
// dispositivos, y "quien tiene activo que tema" para poder copiarlo de
// uno a otro.
//
// Idea clave para entender este archivo: un tema se GUARDA una sola vez
// en la tabla `themes` (biblioteca comun a todos), pero CADA dispositivo
// decide por su cuenta cual de esos temas esta usando ahora mismo. Esa
// eleccion se guarda en `devices.active_theme_id` para los dispositivos
// emparejados, y en `app_settings` para el propio ordenador (que al ser
// "de confianza" no tiene fila en `devices`).
const express = require('express');
const db = require('../db');

const router = express.Router();

// Las variables de color que se pueden personalizar. Cualquier otra clave
// que llegue en el JSON se ignora, y si falta alguna se rellena con el
// valor por defecto (asi un tema "viejo" o importado a medias no rompe
// el render).
//
// Cada fondo real de la interfaz (bg, surface, surface2, settingsMenuBg,
// accent, dayToday) lleva SU PROPIO color de contraste ("...Text") en vez
// de un "texto principal/secundario" global compartido por toda la app.
// Esto es a proposito: el bug de contraste que se vio en el menu de
// Configuracion (texto oscuro sobre fondo oscuro en un tema claro) pasaba
// precisamente porque un solo texto global se aplicaba sobre fondos que no
// tenian por que compartir su tono. Con un color de contraste por fondo,
// cada superficie garantiza su propia legibilidad.
//
// Las 4 ultimas (dayX) son los colores del calendario: hoy, fin de semana,
// festivo y dia especial — festivo/especial se marcan a mano desde el
// panel de dia, ver server/routes/specialDays.js.
const DEFAULT_COLORS = {
  bg: '#0f1115',
  bgText: '#e8eaed',
  surface: '#171a21',
  surfaceText: '#e8eaed',
  surface2: '#1f232c',
  surface2Text: '#e8eaed',
  border: '#2a2f3a',
  accent: '#5b8cff',
  accentText: '#ffffff',
  danger: '#ff6b6b',
  settingsMenuBg: '#1f232c',
  settingsMenuText: '#e8eaed',
  dayToday: '#5b8cff',
  dayTodayText: '#ffffff',
  dayWeekend: '#1a1d27',
  dayHoliday: '#3a2020',
  daySpecial: '#2a1f3a',
};
const COLOR_KEYS = Object.keys(DEFAULT_COLORS);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Cadena de "a quien le copio el contraste si me falta": cada color de
// contraste, si no viene puesto, hereda primero el de la superficie mas
// parecida DENTRO DEL MISMO tema (para que una variante clara incompleta
// siga pareciendo clara), y solo si tampoco hay nada ahi cae en el valor
// por defecto global. settingsMenuBg (el fondo, no el texto) sigue el
// mismo patron con surface2 por la misma razon de siempre.
const CONTRAST_FALLBACK_CHAIN = [
  ['surfaceText', 'bgText'],
  ['surface2Text', 'surfaceText'],
  ['settingsMenuText', 'surface2Text'],
  ['dayTodayText', 'accentText'],
];

// Pares fondo/contraste que existen de verdad en la interfaz — se
// comprueban al final de sanitizeColors() con el contraste real (formula
// WCAG), no solo confiando en el color que se guardo. Esto es la ultima
// red de seguridad: da igual si el dato viene de un tema viejo sin migrar,
// de una inversion automatica con un tono raro, o de una cache del
// navegador desactualizada — lo que devuelve la API siempre se puede leer.
const CONTRAST_PAIRS = [
  ['bg', 'bgText'],
  ['surface', 'surfaceText'],
  ['surface2', 'surface2Text'],
  ['settingsMenuBg', 'settingsMenuText'],
  ['accent', 'accentText'],
  ['dayToday', 'dayTodayText'],
];
// 3:1 en vez del 4.5:1 "AA texto normal" de WCAG a proposito: el acento
// (botones, chips) suele llevar texto blanco sobre un azul/color medio a
// posta, que ronda 3:1 y se lee bien de sobra en texto corto y en negrita
// aunque no pase el umbral mas estricto pensado para parrafos largos. Con
// 4.5 se forzaria texto negro en botones que ya se ven bien. Lo que de
// verdad hay que atrapar aqui son los pares casi identicos (bug real).
const MIN_CONTRAST_RATIO = 3;

function relativeLuminance(hex) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

function sanitizeColors(input) {
  const colors = {};
  for (const key of COLOR_KEYS) {
    const value = input && input[key];
    colors[key] = typeof value === 'string' && HEX_RE.test(value) ? value : null;
  }

  if (colors.settingsMenuBg === null) {
    colors.settingsMenuBg = colors.surface2;
  }
  for (const [key, fallbackFrom] of CONTRAST_FALLBACK_CHAIN) {
    if (colors[key] === null) colors[key] = colors[fallbackFrom];
  }

  for (const key of COLOR_KEYS) {
    if (colors[key] === null) colors[key] = DEFAULT_COLORS[key];
  }

  // Ultima red de seguridad: si el color de contraste guardado (el que
  // sea, venga de donde venga) no se lee bien de verdad sobre su fondo,
  // se sustituye por negro o blanco puro — el que mas contraste de los
  // dos. No toca el fondo, solo el texto, para no desmontar el tema.
  for (const [bgKey, textKey] of CONTRAST_PAIRS) {
    if (contrastRatio(colors[bgKey], colors[textKey]) < MIN_CONTRAST_RATIO) {
      const blackRatio = contrastRatio(colors[bgKey], '#000000');
      const whiteRatio = contrastRatio(colors[bgKey], '#ffffff');
      colors[textKey] = blackRatio >= whiteRatio ? '#000000' : '#ffffff';
    }
  }

  return colors;
}

// La variante inversa (claro/oscuro "pareja" del tema) es opcional: si no
// se manda nada, el tema se queda como un tema normal de una sola
// variante, igual que hasta ahora.
function sanitizeInverseColors(input) {
  if (input === null || input === undefined) return null;
  return sanitizeColors(input);
}

function serialize(row) {
  let colors;
  try {
    colors = JSON.parse(row.colors);
  } catch {
    colors = {};
  }
  let inverseColors = null;
  if (row.inverse_colors) {
    try {
      inverseColors = sanitizeColors(JSON.parse(row.inverse_colors));
    } catch {
      inverseColors = null;
    }
  }
  return { id: row.id, name: row.name, colors: sanitizeColors(colors), inverseColors, updatedAt: row.updated_at };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM themes ORDER BY id ASC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { name, colors, inverseColors } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'El tema necesita un nombre.' });
  }
  const info = db
    .prepare("INSERT INTO themes (name, colors, inverse_colors, updated_at) VALUES (?, ?, ?, datetime('now'))")
    .run(
      name.trim(),
      JSON.stringify(sanitizeColors(colors)),
      inverseColors ? JSON.stringify(sanitizeInverseColors(inverseColors)) : null
    );

  const row = db.prepare('SELECT * FROM themes WHERE id = ?').get(info.lastInsertRowid);
  const serialized = serialize(row);
  db.recordSyncChange('themes', row.id, 'upsert', serialized, req.device ? req.device.id : null);
  res.status(201).json(serialized);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, colors, inverseColors } = req.body || {};
  const existingColors = JSON.parse(existing.colors);

  db.prepare("UPDATE themes SET name = ?, colors = ?, inverse_colors = ?, updated_at = datetime('now') WHERE id = ?").run(
    name !== undefined && name.trim() ? name.trim() : existing.name,
    JSON.stringify(sanitizeColors(colors !== undefined ? colors : existingColors)),
    inverseColors !== undefined ? (inverseColors ? JSON.stringify(sanitizeInverseColors(inverseColors)) : null) : existing.inverse_colors,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id);
  const serialized = serialize(row);
  db.recordSyncChange('themes', row.id, 'upsert', serialized, req.device ? req.device.id : null);
  res.json(serialized);
});

router.delete('/:id', (req, res) => {
  // Igual que al borrar un grupo: nadie se queda "roto" por perder el
  // tema que tenia activo, simplemente se quedan sin tema (aplican el
  // que tengan en cache local hasta que elijan otro).
  db.prepare('UPDATE devices SET active_theme_id = NULL WHERE active_theme_id = ?').run(req.params.id);
  db.prepare("DELETE FROM app_settings WHERE key = 'host_active_theme_id' AND value = ?").run(String(req.params.id));

  const info = db.prepare('DELETE FROM themes WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  db.recordSyncChange('themes', req.params.id, 'delete', null, req.device ? req.device.id : null);
  res.status(204).end();
});

// Quien tiene activo que tema ahora mismo: el ordenador (via app_settings)
// mas cada dispositivo emparejado (via devices.active_theme_id). Sirve
// para la pantalla de "copiar estilo de otro dispositivo conectado".
router.get('/selection', (req, res) => {
  const themes = new Map(db.prepare('SELECT * FROM themes').all().map((t) => [t.id, t.name]));

  const hostSetting = db.prepare("SELECT value FROM app_settings WHERE key = 'host_active_theme_id'").get();
  const hostThemeId = hostSetting ? Number(hostSetting.value) : null;

  const entries = [
    {
      label: 'Este ordenador',
      deviceId: null,
      themeId: hostThemeId,
      themeName: hostThemeId ? themes.get(hostThemeId) || null : null,
      isSelf: req.isTrusted === true,
    },
  ];

  const devices = db.prepare('SELECT id, name, active_theme_id FROM devices ORDER BY paired_at ASC').all();
  for (const d of devices) {
    entries.push({
      label: d.name,
      deviceId: d.id,
      themeId: d.active_theme_id,
      themeName: d.active_theme_id ? themes.get(d.active_theme_id) || null : null,
      isSelf: !req.isTrusted && req.device && req.device.id === d.id,
    });
  }

  res.json(entries);
});

// Aplica un tema de la biblioteca a QUIEN ESTA HACIENDO LA PETICION (el
// ordenador si es de confianza, o el dispositivo emparejado que mando el
// token). No hace falta indicar de quien se trata: se deduce igual que
// en el resto de la API, del propio middleware de autenticacion.
router.put('/selection/mine', (req, res) => {
  const { themeId } = req.body || {};
  let resolvedThemeId = null;
  if (themeId !== null && themeId !== undefined && themeId !== '') {
    const theme = db.prepare('SELECT id FROM themes WHERE id = ?').get(themeId);
    if (!theme) return res.status(400).json({ error: 'invalid_request', message: 'Ese tema ya no existe.' });
    resolvedThemeId = theme.id;
  }

  if (req.isTrusted) {
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('host_active_theme_id', ?) " +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(resolvedThemeId === null ? null : String(resolvedThemeId));
  } else {
    db.prepare('UPDATE devices SET active_theme_id = ? WHERE id = ?').run(resolvedThemeId, req.device.id);
  }

  res.json({ themeId: resolvedThemeId });
});

module.exports = router;
// Se exportan tambien estas funciones (ademas del router) para que
// routes/sync.js pueda reutilizar EXACTAMENTE el mismo saneado de
// colores (incluida la red de seguridad de contraste WCAG) al aplicar un
// tema que llega sincronizado desde el movil -- duplicar esta logica a
// mano en otro archivo seria arriesgado, es justo el tipo de bug de
// contraste que ya se dio una vez (ver CLAUDE.md).
module.exports.sanitizeColors = sanitizeColors;
module.exports.sanitizeInverseColors = sanitizeInverseColors;
module.exports.serializeTheme = serialize;
