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
// el render). Las 4 ultimas (dayX) son los colores del calendario: hoy,
// fin de semana, festivo y dia especial — festivo/especial se marcan a
// mano desde el panel de dia, ver server/routes/specialDays.js.
const DEFAULT_COLORS = {
  bg: '#0f1115',
  surface: '#171a21',
  surface2: '#1f232c',
  border: '#2a2f3a',
  text: '#e8eaed',
  textDim: '#9aa0ab',
  accent: '#5b8cff',
  danger: '#ff6b6b',
  settingsMenuBg: '#1f232c',
  dayToday: '#5b8cff',
  dayWeekend: '#1a1d27',
  dayHoliday: '#3a2020',
  daySpecial: '#2a1f3a',
};
const COLOR_KEYS = Object.keys(DEFAULT_COLORS);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function sanitizeColors(input) {
  const colors = {};
  for (const key of COLOR_KEYS) {
    const value = input && input[key];
    colors[key] = typeof value === 'string' && HEX_RE.test(value) ? value : null;
  }

  // Si falta settingsMenuBg concretamente (temas guardados antes de que
  // existiera esa variable, o una variante inversa a la que no se le puso
  // valor), el mejor "no se nota" es copiar el fondo de tarjetas (surface2)
  // DE ESE MISMO tema — asi una variante clara incompleta hereda un fondo
  // claro, y una oscura uno oscuro, en vez de caer siempre en el valor por
  // defecto oscuro aunque el resto del tema sea claro (eso es justo lo que
  // pasaba: texto oscuro de un tema claro sobre un fondo oscuro "de serie",
  // casi sin contraste).
  if (colors.settingsMenuBg === null) {
    colors.settingsMenuBg = colors.surface2 || DEFAULT_COLORS.settingsMenuBg;
  }

  for (const key of COLOR_KEYS) {
    if (colors[key] === null) colors[key] = DEFAULT_COLORS[key];
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
  return { id: row.id, name: row.name, colors: sanitizeColors(colors), inverseColors };
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
    .prepare('INSERT INTO themes (name, colors, inverse_colors) VALUES (?, ?, ?)')
    .run(
      name.trim(),
      JSON.stringify(sanitizeColors(colors)),
      inverseColors ? JSON.stringify(sanitizeInverseColors(inverseColors)) : null
    );

  const row = db.prepare('SELECT * FROM themes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, colors, inverseColors } = req.body || {};
  const existingColors = JSON.parse(existing.colors);

  db.prepare('UPDATE themes SET name = ?, colors = ?, inverse_colors = ? WHERE id = ?').run(
    name !== undefined && name.trim() ? name.trim() : existing.name,
    JSON.stringify(sanitizeColors(colors !== undefined ? colors : existingColors)),
    inverseColors !== undefined ? (inverseColors ? JSON.stringify(sanitizeInverseColors(inverseColors)) : null) : existing.inverse_colors,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  // Igual que al borrar un grupo: nadie se queda "roto" por perder el
  // tema que tenia activo, simplemente se quedan sin tema (aplican el
  // que tengan en cache local hasta que elijan otro).
  db.prepare('UPDATE devices SET active_theme_id = NULL WHERE active_theme_id = ?').run(req.params.id);
  db.prepare("DELETE FROM app_settings WHERE key = 'host_active_theme_id' AND value = ?").run(String(req.params.id));

  const info = db.prepare('DELETE FROM themes WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
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
