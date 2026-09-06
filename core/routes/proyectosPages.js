// routes/proyectosPages.js — paginas de la herramienta "Proyectos"
// (estilo Notion). Cada pagina puede tener contenido propio (body, HTML
// saneado) Y paginas hijas a la vez -- no hay distincion carpeta/nota.
//
// Sistema SEPARADO de las Notas de Mi espacio a proposito (decidido con
// Koku): mismo espiritu que noteFolders.js para el arbol (parent_id +
// deteccion de ciclos) y que notes.js para el saneado del HTML, pero sin
// compartir tablas ni codigo con ellas, para que tocar Proyectos nunca
// pueda romper Notas.
const { createRouter } = require('../router');
const db = require('../db');
const { deleteImagesInBody } = require('./proyectosImages');

const router = createRouter();

// ---------------------------------------------------------------------
// Saneado del HTML del editor de bloques (menu "/")
// ---------------------------------------------------------------------
// Lista blanca de etiquetas que puede producir el editor de Proyectos.
// Cualquier otra se quita al guardar (dejando el texto de dentro, no se
// pierde contenido), y las permitidas se quedan SIN atributos salvo las
// excepciones concretas y validadas a mano de mas abajo. Mismo enfoque
// que sanitizeNoteBody en notes.js, con las etiquetas extra de los
// bloques nuevos: blockquote (cita), details/summary (toggle), hr
// (divisor) y los data-* de callout/to-do.
const ALLOWED_TAGS = new Set([
  // en linea
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'span', 'a',
  // bloques de texto
  'div', 'p', 'br', 'h1', 'h2', 'h3', 'blockquote', 'hr',
  // listas
  'ul', 'ol', 'li',
  // toggle (desplegable)
  'details', 'summary',
  // codigo
  'pre', 'code',
  // tabla
  'table', 'colgroup', 'col', 'tbody', 'tr', 'td', 'th',
  // imagen
  'img',
]);
// Solo imagenes subidas a ESTA app por la ruta de Proyectos -- nada de
// "data:" ni servidores externos (mismo criterio que las notas).
const IMAGE_SRC = /^\/api\/proyectos\/images\/[a-zA-Z0-9._-]+$/;
// Etiqueta de lenguaje de un bloque de codigo: solo visual, pero se
// valida igual (nada de comillas, "<", espacios ni simbolos raros).
const CODE_LANG = /^[a-zA-Z0-9+#.-]{0,20}$/;
// El icono de un callout es un emoji corto, como note_folders.icon.
const CALLOUT_ICON_MAX = 8;
// Tipos de callout "estilo GitHub" (> [!TIP] y compañia): lista cerrada,
// el CSS del cliente les pone color/icono/etiqueta segun el kind.
const CALLOUT_KINDS = new Set(['note', 'tip', 'important', 'warning', 'caution']);
// Id numerico de una base de datos embebida (bloque de la Fase 3): el
// HTML solo guarda un marcador <div data-proyectos-db="123"> y la
// interfaz lo "hidrata" al mostrar la pagina -- mismo truco que las
// imagenes de notas con data-asset-src en la version movil.
const DB_BLOCK_ID = /^\d{1,10}$/;
// Alineacion de texto por bloque (data-align, ronda de feedback):
// "left" no se guarda nunca (es el valor por defecto, el cliente quita
// el atributo), asi que la lista cerrada son los otros tres.
const ALIGN_VALUES = new Set(['center', 'right', 'justify']);
// Alineacion VERTICAL dentro de una celda de tabla (data-valign).
const VALIGN_VALUES = new Set(['top', 'middle', 'bottom']);
// Etiquetas que pueden llevar data-align. Los divs van aparte (su rama
// del saneador es especial por los data-* de callout/todo/db).
const ALIGNABLE_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'blockquote', 'li', 'summary']);
// Ancho de columna / alto de fila de una tabla, puestos a mano
// arrastrando un borde (mismo mecanismo y misma lista blanca estricta
// que las tablas de las notas: SOLO "width:Npx"/"height:Npx", nada de
// CSS libre -- ver NOTE_COL_WIDTH_STYLE en notes.js).
const COL_WIDTH_STYLE = /^width:\s*(\d{1,4}(?:\.\d+)?)px;?$/;
const ROW_HEIGHT_STYLE = /^height:\s*(\d{1,4}(?:\.\d+)?)px;?$/;

// Saca el trocito ' data-align="..."' ya validado de los atributos de
// una etiqueta, o '' si no trae alineacion (o trae una invalida).
function alignAttr(attrs) {
  const m = attrs.match(/\sdata-align\s*=\s*"([^"]*)"/i);
  return m && ALIGN_VALUES.has(m[1]) ? ` data-align="${m[1]}"` : '';
}

function sanitizePageBody(html) {
  if (!html) return html;
  // Fuera scripts/estilos JUNTO con su contenido -- nunca deberian
  // aparecer viniendo del editor, pero por si acaso.
  let clean = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  clean = clean.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (match, closing, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return '';
    if (closing) return `</${lower}>`;
    if (lower === 'img') {
      const srcMatch = attrs.match(/\ssrc\s*=\s*"([^"]*)"/i);
      const src = srcMatch ? srcMatch[1] : '';
      if (!IMAGE_SRC.test(src)) return '';
      return `<img src="${src}">`;
    }
    if (lower === 'a') {
      // Dos tipos de enlace y nada mas:
      //   - interno: <a data-page-link="id"> lleva a otra pagina de
      //     Proyectos (la interfaz intercepta el click, no hay href)
      //   - externo: <a href="http(s)://..."> -- nada de javascript:
      //     ni rutas raras. Se quita el enlace (dejando su texto) si no
      //     encaja en ninguno de los dos.
      const pageMatch = attrs.match(/\sdata-page-link\s*=\s*"([^"]*)"/i);
      if (pageMatch && /^\d{1,10}$/.test(pageMatch[1])) {
        return `<a data-page-link="${pageMatch[1]}">`;
      }
      const hrefMatch = attrs.match(/\shref\s*=\s*"([^"]*)"/i);
      const href = hrefMatch ? hrefMatch[1] : '';
      if (!/^https?:\/\//i.test(href)) return '';
      return `<a href="${href}">`;
    }
    if (lower === 'table') {
      // data-width="full" = tabla a ancho completo (boton de editar
      // tabla en la interfaz). Unico valor admitido, como data-border
      // en las notas.
      const widthMatch = attrs.match(/\sdata-width\s*=\s*"([^"]*)"/i);
      return widthMatch && widthMatch[1] === 'full' ? '<table data-width="full">' : '<table>';
    }
    if (lower === 'col') {
      // Ancho de columna puesto arrastrando su borde: se reconstruye el
      // style desde cero con el numero capturado (nunca se copia el
      // atributo tal cual).
      const styleMatch = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i);
      const widthMatch = (styleMatch ? styleMatch[1].trim() : '').match(COL_WIDTH_STYLE);
      return widthMatch ? `<col style="width:${widthMatch[1]}px">` : '<col>';
    }
    if (lower === 'tr') {
      // Alto de fila, mismo mecanismo que el ancho de columna.
      const styleMatch = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i);
      const heightMatch = (styleMatch ? styleMatch[1].trim() : '').match(ROW_HEIGHT_STYLE);
      return heightMatch ? `<tr style="height:${heightMatch[1]}px">` : '<tr>';
    }
    if (lower === 'td' || lower === 'th') {
      // Las celdas pueden alinear su texto en horizontal (data-align,
      // como cualquier bloque) y ademas en VERTICAL (data-valign:
      // arriba/centro/abajo -- solo tiene sentido en celdas).
      const valignMatch = attrs.match(/\sdata-valign\s*=\s*"([^"]*)"/i);
      const valign = valignMatch && VALIGN_VALUES.has(valignMatch[1]) ? ` data-valign="${valignMatch[1]}"` : '';
      return `<${lower}${alignAttr(attrs)}${valign}>`;
    }
    if (lower === 'details') {
      // "open" (sin valor) = el toggle se guarda desplegado. Es el unico
      // atributo booleano que se conserva.
      return /\sopen(\s|=|$)/i.test(attrs) ? '<details open>' : '<details>';
    }
    if (lower === 'pre') {
      const langMatch = attrs.match(/\sdata-lang\s*=\s*"([^"]*)"/i);
      const lang = langMatch ? langMatch[1] : '';
      return lang && CODE_LANG.test(lang) ? `<pre data-lang="${lang}">` : '<pre>';
    }
    if (lower === 'div') {
      // Los "bloques especiales" del editor son divs con data-*:
      //   - data-callout="1" + data-icon="emoji" -> recuadro con icono
      //   - data-todo="1" + data-done="0|1"      -> linea con checkbox
      //   - data-proyectos-db="id"               -> base de datos embebida
      // Cualquier otro data-*/atributo se descarta.
      const calloutMatch = attrs.match(/\sdata-callout\s*=\s*"([^"]*)"/i);
      if (calloutMatch && calloutMatch[1] === '1') {
        // Variante "tipada" (los alerts de GitHub: nota/consejo/
        // importante/aviso/peligro): data-kind de una lista cerrada. El
        // color, icono y etiqueta los pone el CSS a partir del kind, asi
        // que un callout tipado no lleva data-icon.
        const kindMatch = attrs.match(/\sdata-kind\s*=\s*"([^"]*)"/i);
        if (kindMatch && CALLOUT_KINDS.has(kindMatch[1])) {
          return `<div data-callout="1" data-kind="${kindMatch[1]}"${alignAttr(attrs)}>`;
        }
        const iconMatch = attrs.match(/\sdata-icon\s*=\s*"([^"]*)"/i);
        // El emoji se re-escapa a mano: solo se admite algo corto y sin
        // caracteres con significado en HTML.
        const rawIcon = iconMatch ? iconMatch[1] : '';
        const icon = /["'<>&]/.test(rawIcon) ? '' : rawIcon.slice(0, CALLOUT_ICON_MAX);
        return (icon ? `<div data-callout="1" data-icon="${icon}"` : '<div data-callout="1"') + `${alignAttr(attrs)}>`;
      }
      const todoMatch = attrs.match(/\sdata-todo\s*=\s*"([^"]*)"/i);
      if (todoMatch && todoMatch[1] === '1') {
        const doneMatch = attrs.match(/\sdata-done\s*=\s*"([^"]*)"/i);
        const done = doneMatch && doneMatch[1] === '1' ? '1' : '0';
        return `<div data-todo="1" data-done="${done}"${alignAttr(attrs)}>`;
      }
      const dbMatch = attrs.match(/\sdata-proyectos-db\s*=\s*"([^"]*)"/i);
      if (dbMatch && DB_BLOCK_ID.test(dbMatch[1])) {
        return `<div data-proyectos-db="${dbMatch[1]}">`;
      }
      return `<div${alignAttr(attrs)}>`;
    }
    // El resto de bloques de texto tambien puede llevar alineacion
    // (data-align) -- los de codigo NO a proposito (pedido por Koku).
    if (ALIGNABLE_TAGS.has(lower)) return `<${lower}${alignAttr(attrs)}>`;
    return `<${lower}>`;
  });
  return clean;
}

// ---------------------------------------------------------------------
// Arbol: deteccion de ciclos al mover paginas (calco de noteFolders.js)
// ---------------------------------------------------------------------
// Una pagina no puede ser su propia antepasada. Sube por la cadena de
// parent_id desde candidateParentId; si en algun punto llega a pageId,
// poner ese parent crearia un bucle.
function wouldCreateCycle(pageId, candidateParentId) {
  let current = candidateParentId;
  const seen = new Set();
  while (current !== null && current !== undefined) {
    if (current === pageId) return true;
    if (seen.has(current)) return true; // por si ya hubiera un ciclo raro de antes
    seen.add(current);
    const row = db.prepare('SELECT parent_id FROM proyectos_pages WHERE id = ?').get(current);
    if (!row) return false; // parent apunta a algo que no existe, no es un ciclo
    current = row.parent_id;
  }
  return false;
}

// Devuelve el parent_id ya validado, o undefined si el movimiento es
// invalido (ser tu propio padre o crear un bucle).
function resolveParentId(pageId, parentId) {
  if (parentId === undefined || parentId === null || parentId === '') return null;
  const numericId = Number(parentId);
  if (numericId === pageId) return undefined;
  const page = db.prepare('SELECT id FROM proyectos_pages WHERE id = ?').get(numericId);
  if (!page) return null; // apunta a algo que no existe, se ignora
  if (pageId !== null && wouldCreateCycle(pageId, numericId)) return undefined;
  return numericId;
}

function sanitizeIcon(icon) {
  if (icon === undefined) return undefined; // "no lo toques"
  if (icon === null || icon === '') return null; // "quitalo"
  return String(icon).slice(0, 8);
}

// El listado del arbol NO lleva el body (seria cargar el contenido de
// todas las paginas solo para pintar el sidebar); el body solo viaja en
// GET /:id. "hasBody" permite a la interfaz distinguir pagina vacia sin
// pedir el contenido.
function serializeListRow(row) {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon || null,
    coverColor: row.cover_color || null,
    favorite: !!row.favorite,
    position: row.position,
    hasBody: !!row.has_body,
    updatedAt: row.updated_at,
  };
}

function serializeFullRow(row) {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon || null,
    coverColor: row.cover_color || null,
    body: row.body || null,
    favorite: !!row.favorite,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LIST_SELECT = `
  SELECT id, parent_id, title, icon, cover_color, favorite, position, updated_at,
         (body IS NOT NULL AND body != '') AS has_body
  FROM proyectos_pages
`;

// Todas las paginas de una vez (la interfaz monta el arbol en memoria a
// partir de parent_id -- son datos pequeños sin el body, no hace falta
// paginar ni pedir nivel a nivel).
router.get('/', (req, res) => {
  const rows = db.prepare(`${LIST_SELECT} ORDER BY position ASC, id ASC`).all();
  res.json(rows.map(serializeListRow));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM proyectos_pages WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serializeFullRow(row));
});

router.post('/', (req, res) => {
  const { title, icon, coverColor, parentId, body } = req.body || {};
  // El titulo puede venir vacio: en Notion una pagina recien creada es
  // "Sin titulo" y se rellena escribiendo -- aqui igual, la interfaz
  // enseña el placeholder, la base guarda ''.
  const safeTitle = title === undefined || title === null ? '' : String(title).slice(0, 300);
  const safeParentId = resolveParentId(null, parentId);
  const safeCover = coverColor && /^#[0-9a-fA-F]{6}$/.test(coverColor) ? coverColor : null;

  // position: al final entre las hermanas de su mismo padre.
  const { count } = db
    .prepare('SELECT COUNT(*) as count FROM proyectos_pages WHERE parent_id IS ?')
    .get(safeParentId ?? null);

  const info = db
    .prepare("INSERT INTO proyectos_pages (parent_id, title, icon, cover_color, body, position, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
    .run(safeParentId ?? null, safeTitle, sanitizeIcon(icon) ?? null, safeCover, sanitizePageBody(body) || null, count);

  const row = db.prepare('SELECT * FROM proyectos_pages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serializeFullRow(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM proyectos_pages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { title, icon, coverColor, parentId, body, favorite } = req.body || {};

  let nextParentId = existing.parent_id;
  if (parentId !== undefined) {
    const resolved = resolveParentId(existing.id, parentId);
    if (resolved === undefined) {
      return res.status(400).json({ error: 'invalid_request', message: 'Una pagina no puede meterse dentro de si misma (ni de una de sus subpaginas).' });
    }
    nextParentId = resolved;
  }

  const sanitizedIcon = sanitizeIcon(icon);
  let nextCover = existing.cover_color;
  if (coverColor !== undefined) {
    nextCover = coverColor && /^#[0-9a-fA-F]{6}$/.test(coverColor) ? coverColor : null;
  }

  db.prepare("UPDATE proyectos_pages SET title = ?, icon = ?, cover_color = ?, parent_id = ?, body = ?, favorite = ?, updated_at = datetime('now') WHERE id = ?").run(
    title !== undefined ? String(title).slice(0, 300) : existing.title,
    sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
    nextCover,
    nextParentId,
    body !== undefined ? (sanitizePageBody(body) || null) : existing.body,
    favorite !== undefined ? (favorite ? 1 : 0) : existing.favorite,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM proyectos_pages WHERE id = ?').get(req.params.id);
  res.json(serializeFullRow(row));
});

// Limpieza que acompaña SIEMPRE al borrado de una pagina: sus imagenes
// del disco y sus bases de datos embebidas (filas, propiedades y
// valores). El require de proyectosDatabases es diferido (dentro de la
// funcion, no arriba del todo) a proposito: ese archivo ya importa
// cosas de ESTE (sanitizePageBody), y un require circular en tiempo de
// carga dejaria a uno de los dos a medias.
function deletePageOwnedContent(page) {
  deleteImagesInBody(page.body);
  const { deleteDatabaseCascade } = require('./proyectosDatabases');
  const databases = db.prepare('SELECT id FROM proyectos_databases WHERE page_id = ?').all(page.id);
  for (const database of databases) deleteDatabaseCascade(database.id);
}

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM proyectos_pages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // Dos modos de borrar:
  //   - normal: las subpaginas NO se borran, suben un nivel (la regla
  //     de la casa de siempre: borrar un contenedor nunca destruye lo
  //     de dentro).
  //   - ?withChildren=1: se borra la pagina Y todo su subarbol (lo
  //     pidio Koku para no tener que borrar una a una) -- cada pagina
  //     borrada limpia lo suyo (imagenes + bases embebidas).
  if (req.query && String(req.query.withChildren) === '1') {
    // Recorrido en anchura para juntar el subarbol entero.
    const toDelete = [existing];
    let frontier = [existing.id];
    while (frontier.length > 0) {
      const placeholders = frontier.map(() => '?').join(',');
      const children = db.prepare(`SELECT * FROM proyectos_pages WHERE parent_id IN (${placeholders})`).all(...frontier);
      toDelete.push(...children);
      frontier = children.map((c) => c.id);
    }
    for (const page of toDelete) deletePageOwnedContent(page);
    const ids = toDelete.map((p) => p.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM proyectos_pages WHERE id IN (${placeholders})`).run(...ids);
    return res.status(204).end();
  }

  db.prepare('UPDATE proyectos_pages SET parent_id = ? WHERE parent_id = ?').run(existing.parent_id, req.params.id);
  deletePageOwnedContent(existing);

  const info = db.prepare('DELETE FROM proyectos_pages WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

module.exports = router;
module.exports.sanitizePageBody = sanitizePageBody;
