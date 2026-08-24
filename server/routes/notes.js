// routes/notes.js — CRUD de notas de "Mi espacio" (titulo + contenido con
// formato basico desde la Fase 4; carpeta opcional desde la Fase 3, ver
// routes/noteFolders.js).
const express = require('express');
const db = require('../db');
const { deleteImagesInBody } = require('./noteImages');

const router = express.Router();

// Lista blanca de etiquetas que puede producir el editor de notas (Fase 4:
// negrita, cursiva, listas, tablas, imagenes). Cualquier otra etiqueta se
// quita al guardar (dejando el texto de dentro, no se pierde contenido) y
// las permitidas se dejan SIN atributos -- asi no hay forma de que se
// cuele un "onclick=" o un "style=" con algo raro, aunque el HTML venga
// de un movil emparejado que no sea de fiar del todo. No hace falta una
// libreria de terceros para esto, el editor nunca deberia producir nada
// fuera de esta lista.
//
// "img" es la unica excepcion que SI necesita quedarse con un atributo
// (src) para servir de algo -- se trata aparte mas abajo, comprobando que
// apunte a una imagen ya subida a esta misma app (routes/noteImages.js) y
// no, por ejemplo, a un "data:" (la opcion base64 que se descarto a
// proposito) o a un servidor externo.
const ALLOWED_NOTE_TAGS = new Set(['b', 'strong', 'i', 'em', 'ul', 'ol', 'li', 'br', 'div', 'p', 'table', 'colgroup', 'col', 'tbody', 'tr', 'td', 'th', 'img', 'pre', 'code']);
const NOTE_IMAGE_SRC = /^\/api\/notes\/images\/[a-zA-Z0-9._-]+$/;
// Bloques de codigo (```lenguaje + Intro, o el boton "Codigo"): el
// "lenguaje" es solo una etiqueta visual (no hay coloreado de verdad
// todavia, ver app.js), pero igualmente se valida con una lista blanca
// de caracteres -- nada de comillas, "<", espacios ni simbolos raros.
const NOTE_CODE_LANG = /^[a-zA-Z0-9+#.-]{0,20}$/;
// Redimensionar tablas a mano (columnas/filas, ver el bloque de
// resize en app.js) guarda el ancho/alto como "style" en <col>/<tr> --
// la unica forma de que sobreviva al saneado es una lista blanca MUY
// estricta: un solo valor en px, nada mas (ninguna otra propiedad CSS,
// ni url()/expression()/unidades raras). Hasta 4 digitos (9999px) de
// sobra para cualquier tamano razonable. El "\s*" y el ";" opcional son
// necesarios porque el navegador no siempre serializa el atributo style
// igual: el HTML insertado tal cual (buildTableHtml) queda compacto
// ("width:120px"), pero en cuanto se toca la propiedad por JS
// (element.style.width = ..., al arrastrar o hacer doble clic) el
// navegador lo reescribe con espacio y punto y coma ("width: 270px;") --
// ambos formatos son validos, se captura el numero y se reconstruye
// siempre en el mismo formato compacto (ver mas abajo) para que el HTML
// guardado no varie segun de donde venga.
const NOTE_COL_WIDTH_STYLE = /^width:\s*(\d{1,4}(?:\.\d+)?)px;?$/;
const NOTE_ROW_HEIGHT_STYLE = /^height:\s*(\d{1,4}(?:\.\d+)?)px;?$/;

function sanitizeNoteBody(html) {
  if (!html) return html;
  // Fuera scripts/estilos JUNTO con su contenido -- nunca deberian
  // aparecer viniendo del editor, pero por si acaso.
  let clean = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Etiqueta a etiqueta: si no esta en la lista blanca se quita la
  // etiqueta pero se deja lo de dentro; las permitidas se dejan sin
  // atributos, salvo unas pocas excepciones muy concretas y validadas a
  // mano (img/src, col+tr/style, table/data-border, pre/data-lang --
  // ver mas abajo).
  clean = clean.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (match, closing, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_NOTE_TAGS.has(lower)) return '';
    if (closing) return `</${lower}>`;
    if (lower === 'img') {
      const srcMatch = attrs.match(/\ssrc\s*=\s*"([^"]*)"/i);
      const src = srcMatch ? srcMatch[1] : '';
      if (!NOTE_IMAGE_SRC.test(src)) return '';
      return `<img src="${src}">`;
    }
    if (lower === 'col') {
      const styleMatch = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i);
      const style = styleMatch ? styleMatch[1].trim() : '';
      const widthMatch = style.match(NOTE_COL_WIDTH_STYLE);
      return widthMatch ? `<col style="width:${widthMatch[1]}px">` : '<col>';
    }
    if (lower === 'tr') {
      const styleMatch = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i);
      const style = styleMatch ? styleMatch[1].trim() : '';
      const heightMatch = style.match(NOTE_ROW_HEIGHT_STYLE);
      return heightMatch ? `<tr style="height:${heightMatch[1]}px">` : '<tr>';
    }
    if (lower === 'table') {
      // Solo el valor EXACTO "thick" -- cualquier otra cosa se descarta
      // (whitelist de un unico literal, no una expresion regular suelta).
      const borderMatch = attrs.match(/\sdata-border\s*=\s*"([^"]*)"/i);
      return borderMatch && borderMatch[1] === 'thick' ? '<table data-border="thick">' : '<table>';
    }
    if (lower === 'pre') {
      const langMatch = attrs.match(/\sdata-lang\s*=\s*"([^"]*)"/i);
      const lang = langMatch ? langMatch[1] : '';
      return lang && NOTE_CODE_LANG.test(lang) ? `<pre data-lang="${lang}">` : '<pre>';
    }
    return `<${lower}>`;
  });
  return clean;
}

const SELECT_WITH_FOLDER = `
  SELECT n.*, f.name AS folder_name, f.color AS folder_color, f.icon AS folder_icon
  FROM notes n
  LEFT JOIN note_folders f ON f.id = n.folder_id
`;

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    bodyFormat: row.body_format,
    hidden: !!row.hidden,
    favorite: !!row.favorite,
    folderId: row.folder_id,
    folderName: row.folder_name || null,
    folderColor: row.folder_color || null,
    folderIcon: row.folder_icon || null,
    createdByName: row.created_by_name || null,
    createdByPublicId: row.created_by_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveFolderId(folderId) {
  if (folderId === undefined || folderId === null || folderId === '') return null;
  const folder = db.prepare('SELECT id FROM note_folders WHERE id = ?').get(folderId);
  return folder ? folder.id : null; // si mandan un id que no existe, lo ignoramos en vez de fallar
}

router.get('/', (req, res) => {
  const rows = db.prepare(`${SELECT_WITH_FOLDER} ORDER BY n.updated_at DESC`).all();
  res.json(rows.map(serialize));
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`${SELECT_WITH_FOLDER} WHERE n.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serialize(row));
});

router.post('/', (req, res) => {
  const { title, body, folderId, favorite, bodyFormat } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'La nota necesita un titulo.' });
  }

  // "Creado por" se rellena con tu perfil en el momento de crear la nota,
  // igual que en los eventos (ver server/db.js): una foto fija del nombre
  // de entonces, no un enlace en vivo a tu nickname actual.
  const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();

  // El editor con formato (Fase 4) siempre manda bodyFormat: 'html'; solo
  // se saneamos en ese caso -- si no viene (o viene otra cosa) se trata
  // como texto plano tal cual, sin tocarlo (ver sanitizeNoteBody arriba).
  const format = bodyFormat === 'html' ? 'html' : 'text';
  const cleanBody = format === 'html' ? sanitizeNoteBody(body) : (body || null);

  const info = db
    .prepare('INSERT INTO notes (title, body, body_format, folder_id, favorite, created_by_name, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      title.trim(),
      cleanBody,
      format,
      resolveFolderId(folderId),
      favorite ? 1 : 0,
      profile && profile.name ? profile.name : null,
      profile ? profile.public_id : null
    );

  const row = db.prepare(`${SELECT_WITH_FOLDER} WHERE n.id = ?`).get(info.lastInsertRowid);
  const serialized = serialize(row);
  db.recordSyncChange('notes', row.id, 'upsert', serialized, req.device ? req.device.id : null);
  res.status(201).json(serialized);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { title, body, hidden, folderId, favorite, bodyFormat } = req.body || {};
  if (title !== undefined && !title.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'La nota necesita un titulo.' });
  }

  // Igual que en el POST: solo saneamos como HTML si el body que llega
  // viene marcado explicitamente como 'html' (el editor con formato lo
  // manda siempre asi). Si no se toca el body en este PUT, se deja el
  // formato que ya tuviera la nota tal cual.
  const format = bodyFormat !== undefined ? (bodyFormat === 'html' ? 'html' : 'text') : existing.body_format;
  const cleanBody = body !== undefined
    ? (format === 'html' ? sanitizeNoteBody(body) : body)
    : existing.body;

  db.prepare(`
    UPDATE notes SET
      title = ?,
      body = ?,
      body_format = ?,
      hidden = ?,
      folder_id = ?,
      favorite = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title !== undefined ? title.trim() : existing.title,
    cleanBody,
    format,
    hidden !== undefined ? (hidden ? 1 : 0) : existing.hidden,
    folderId !== undefined ? resolveFolderId(folderId) : existing.folder_id,
    favorite !== undefined ? (favorite ? 1 : 0) : existing.favorite,
    req.params.id
  );

  const row = db.prepare(`${SELECT_WITH_FOLDER} WHERE n.id = ?`).get(req.params.id);
  const serialized = serialize(row);
  db.recordSyncChange('notes', row.id, 'upsert', serialized, req.device ? req.device.id : null);
  res.json(serialized);
});

router.delete('/:id', (req, res) => {
  // Se lee el body ANTES de borrar la fila para poder limpiar del disco
  // las imagenes que tuviera -- si no, se quedarian huerfanas para
  // siempre (ver deleteImagesInBody en routes/noteImages.js).
  const existing = db.prepare('SELECT body FROM notes WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  if (existing) deleteImagesInBody(existing.body);
  db.recordSyncChange('notes', req.params.id, 'delete', null, req.device ? req.device.id : null);
  res.status(204).end();
});

module.exports = router;
