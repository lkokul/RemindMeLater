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
const { deleteImagesInBody, copyImageFile, readImageAsBase64, writeImageFromBase64 } = require('./proyectosImages');

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
  // imagen (figure/figcaption = imagen con pie de foto, ronda del PDF)
  'img', 'figure', 'figcaption',
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
      // Bloques "de PDF" (ronda de plantillas de PDF): marcadores que
      // solo cobran vida al exportar -- el indice de contenido, el de
      // figuras y el salto de pagina. Lista cerrada.
      const pdfMatch = attrs.match(/\sdata-pdf-block\s*=\s*"([^"]*)"/i);
      if (pdfMatch && ['toc', 'figures', 'pagebreak'].includes(pdfMatch[1])) {
        return `<div data-pdf-block="${pdfMatch[1]}">`;
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
    pdfRole: row.pdf_role || null,
    isTemplate: !!row.is_template,
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
    pdfRole: row.pdf_role || null,
    isTemplate: !!row.is_template,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LIST_SELECT = `
  SELECT id, parent_id, title, icon, cover_color, favorite, position, pdf_role, is_template, updated_at,
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

  const { title, icon, coverColor, parentId, body, favorite, pdfRole, isTemplate } = req.body || {};

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

  // El papel de la pagina en el PDF: 'cover' (portada), 'skip' (no se
  // incluye) o null (normal). Lista cerrada; cualquier otra cosa = null.
  let nextPdfRole = existing.pdf_role;
  if (pdfRole !== undefined) {
    nextPdfRole = pdfRole === 'cover' || pdfRole === 'skip' ? pdfRole : null;
  }

  db.prepare("UPDATE proyectos_pages SET title = ?, icon = ?, cover_color = ?, parent_id = ?, body = ?, favorite = ?, pdf_role = ?, is_template = ?, updated_at = datetime('now') WHERE id = ?").run(
    title !== undefined ? String(title).slice(0, 300) : existing.title,
    sanitizedIcon === undefined ? existing.icon : sanitizedIcon,
    nextCover,
    nextParentId,
    body !== undefined ? (sanitizePageBody(body) || null) : existing.body,
    favorite !== undefined ? (favorite ? 1 : 0) : existing.favorite,
    nextPdfRole,
    isTemplate !== undefined ? (isTemplate ? 1 : 0) : existing.is_template,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM proyectos_pages WHERE id = ?').get(req.params.id);
  res.json(serializeFullRow(row));
});

// Mover una pagina: cambiar de madre y/o de posicion entre sus hermanas
// EN UNA sola operacion (lo usan el arrastre del arbol y el "Mover a…"
// del modo seleccion). El cuerpo trae parentId (null = primer nivel;
// mandarlo SIEMPRE, aunque no cambie) y position, el indice deseado
// entre las hermanas del destino (0 = la primera; sin position, al
// final). Ojo al orden de registro: '/:id/move' tiene DOS trozos y
// '/:id' uno solo, asi que el enrutador nunca los confunde y da igual
// cual se declare antes.
router.put('/:id/move', (req, res) => {
  const existing = db.prepare('SELECT * FROM proyectos_pages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { parentId, position } = req.body || {};
  const resolved = resolveParentId(existing.id, parentId);
  if (resolved === undefined) {
    return res.status(400).json({ error: 'invalid_request', message: 'Una pagina no puede meterse dentro de si misma (ni de una de sus subpaginas).' });
  }

  // Las hermanas del destino SIN la pagina que se mueve, en su orden
  // actual; se inserta donde toque y se renumera el nivel entero de una
  // vez -- mas robusto que ir haciendo hueco con sumas y restas.
  const siblings = db
    .prepare('SELECT id FROM proyectos_pages WHERE parent_id IS ? AND id != ? ORDER BY position ASC, id ASC')
    .all(resolved ?? null, existing.id)
    .map((row) => row.id);
  let index = position === undefined || position === null ? siblings.length : Number(position);
  if (!Number.isFinite(index)) index = siblings.length;
  index = Math.max(0, Math.min(siblings.length, Math.round(index)));
  siblings.splice(index, 0, existing.id);

  db.prepare("UPDATE proyectos_pages SET parent_id = ?, updated_at = datetime('now') WHERE id = ?").run(resolved ?? null, existing.id);
  const setPosition = db.prepare('UPDATE proyectos_pages SET position = ? WHERE id = ?');
  siblings.forEach((id, i) => setPosition.run(i, id));

  const row = db.prepare('SELECT * FROM proyectos_pages WHERE id = ?').get(existing.id);
  res.json(serializeFullRow(row));
});

// ---------------------------------------------------------------------
// Clonar, exportar e importar proyectos (ronda de la home + plantillas)
//
// Las tres operaciones comparten el mismo "motor" (materializeProject):
// se describe el proyecto como datos planos (paginas madre-primero +
// bases de datos + imagenes) y el motor lo CREA entero remapeando los
// cuerpos al final -- marcadores de base de datos, enlaces internos e
// imagenes apuntan a los ids/archivos NUEVOS. Un enlace a una pagina
// que no viaja se deshace dejando su texto.
// ---------------------------------------------------------------------

// El subarbol de una pagina, con cada madre ANTES que sus hijas (el
// orden que necesita la creacion: al insertar una hija, su madre nueva
// ya existe).
function collectSubtree(rootId) {
  const root = db.prepare('SELECT * FROM proyectos_pages WHERE id = ?').get(rootId);
  if (!root) return null;
  const pages = [root];
  let frontier = [root.id];
  while (frontier.length > 0) {
    const placeholders = frontier.map(() => '?').join(',');
    const children = db.prepare(`SELECT * FROM proyectos_pages WHERE parent_id IN (${placeholders}) ORDER BY position ASC, id ASC`).all(...frontier);
    pages.push(...children);
    frontier = children.map((c) => c.id);
  }
  return pages;
}

const IMAGE_URL_RE = /\/api\/proyectos\/images\/([a-zA-Z0-9._-]+)/g;
const DB_MARKER_RE = /data-proyectos-db="(\d+)"/g;
const PAGE_LINK_RE = /<a data-page-link="(\d+)">([\s\S]*?)<\/a>/g;

function remapBody(body, { dbMap, pageMap, imageMap }) {
  if (!body) return body;
  let out = body;
  out = out.replace(DB_MARKER_RE, (match, id) => `data-proyectos-db="${dbMap.get(Number(id)) ?? id}"`);
  out = out.replace(PAGE_LINK_RE, (match, id, inner) => {
    const mapped = pageMap.get(Number(id));
    return mapped ? `<a data-page-link="${mapped}">${inner}</a>` : inner;
  });
  out = out.replace(IMAGE_URL_RE, (match, name) => `/api/proyectos/images/${imageMap.get(name) ?? name}`);
  return out;
}

// Todas las bases de datos de un conjunto de paginas, con propiedades,
// filas y valores colgando de cada una.
function collectDatabases(pageIds) {
  if (pageIds.length === 0) return [];
  const placeholders = pageIds.map(() => '?').join(',');
  const databases = db.prepare(`SELECT * FROM proyectos_databases WHERE page_id IN (${placeholders})`).all(...pageIds);
  return databases.map((database) => ({
    ...database,
    props: db.prepare('SELECT * FROM proyectos_db_props WHERE database_id = ? ORDER BY position ASC, id ASC').all(database.id),
    rows: db.prepare('SELECT * FROM proyectos_db_rows WHERE database_id = ? ORDER BY position ASC, id ASC').all(database.id).map((row) => ({
      ...row,
      values: db.prepare('SELECT prop_id, value FROM proyectos_db_values WHERE row_id = ?').all(row.id),
    })),
  }));
}

function collectImageNames(bodies) {
  const names = new Set();
  for (const body of bodies) {
    if (!body) continue;
    for (const match of body.matchAll(IMAGE_URL_RE)) names.add(match[1]);
  }
  return [...names];
}

// Saneador local de "options" para el motor (acepta el JSON-texto que
// viene de la base al clonar Y el array ya parseado de un paquete
// importado; misma politica que proyectosDatabases.js).
function safeOptionsFor(type, options) {
  let parsed = options;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (err) { parsed = null; }
  }
  if (!Array.isArray(parsed)) return null;
  if (type === 'select') {
    const clean = parsed.map((o) => String(o).trim().slice(0, 60)).filter(Boolean);
    return clean.length ? JSON.stringify(clean) : null;
  }
  if (type === 'labels') {
    const clean = parsed
      .map((o) => ({
        name: String(o && o.name !== undefined ? o.name : '').trim().slice(0, 60),
        color: o && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : '#4493f8',
      }))
      .filter((o) => o.name);
    return clean.length ? JSON.stringify(clean) : null;
  }
  return null;
}

const MATERIALIZE_VIEW_TYPES = ['table', 'board', 'list', 'timeline', 'heatmap'];
const MATERIALIZE_PROP_TYPES = ['text', 'number', 'select', 'date', 'checkbox', 'labels', 'color'];

// El motor: crea el proyecto entero y devuelve el id de la raiz nueva.
function materializeProject(pagesData, databasesData, imageMap, { parentId = null, title = null, asTemplate = false } = {}) {
  const pageMap = new Map();
  const rootKey = pagesData[0].key;
  const { count } = db.prepare('SELECT COUNT(*) as count FROM proyectos_pages WHERE parent_id IS ?').get(parentId ?? null);

  // 1) Paginas con el cuerpo VACIO (los cuerpos referencian bases e
  //    imagenes que aun no existen; se rellenan al final).
  for (const page of pagesData) {
    const isRoot = page.key === rootKey;
    const info = db.prepare(`
      INSERT INTO proyectos_pages (parent_id, title, icon, cover_color, body, favorite, position, pdf_role, is_template, updated_at)
      VALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?, datetime('now'))
    `).run(
      isRoot ? (parentId ?? null) : (pageMap.get(page.parentKey) ?? null),
      String(isRoot && title ? title : (page.title || '')).slice(0, 300),
      sanitizeIcon(page.icon) ?? null,
      page.coverColor && /^#[0-9a-fA-F]{6}$/.test(page.coverColor) ? page.coverColor : null,
      isRoot ? count : (Number(page.position) || 0),
      page.pdfRole === 'cover' || page.pdfRole === 'skip' ? page.pdfRole : null,
      isRoot && asTemplate ? 1 : 0
    );
    pageMap.set(page.key, info.lastInsertRowid);
  }

  // 2) Bases de datos: base -> propiedades -> referencias de la vista
  //    -> filas y valores.
  const dbMap = new Map();
  const rowBodiesToPatch = [];
  for (const database of databasesData) {
    const pageId = pageMap.get(database.pageKey);
    if (!pageId) continue;
    const dbInfo = db.prepare('INSERT INTO proyectos_databases (page_id, name, view_type, sort_dir, filter_value) VALUES (?, ?, ?, ?, ?)').run(
      pageId,
      String(database.name || '').slice(0, 200),
      MATERIALIZE_VIEW_TYPES.includes(database.viewType) ? database.viewType : 'table',
      database.sortDir === 'desc' ? 'desc' : 'asc',
      database.filterValue == null ? null : String(database.filterValue).slice(0, 200)
    );
    const newDbId = dbInfo.lastInsertRowid;
    dbMap.set(database.key, newDbId);

    const propMap = new Map();
    for (const prop of database.props || []) {
      const type = MATERIALIZE_PROP_TYPES.includes(prop.type) ? prop.type : 'text';
      const propInfo = db.prepare('INSERT INTO proyectos_db_props (database_id, name, type, options, position) VALUES (?, ?, ?, ?, ?)').run(
        newDbId,
        String(prop.name || '').slice(0, 100) || 'Propiedad',
        type,
        safeOptionsFor(type, prop.options),
        Number(prop.position) || 0
      );
      propMap.set(prop.key, propInfo.lastInsertRowid);
    }
    db.prepare('UPDATE proyectos_databases SET board_prop_id = ?, sort_prop_id = ?, filter_prop_id = ?, timeline_start_prop_id = ?, timeline_end_prop_id = ? WHERE id = ?').run(
      propMap.get(database.boardPropKey) ?? null,
      propMap.get(database.sortPropKey) ?? null,
      propMap.get(database.filterPropKey) ?? null,
      propMap.get(database.timelineStartPropKey) ?? null,
      propMap.get(database.timelineEndPropKey) ?? null,
      newDbId
    );
    for (const row of database.rows || []) {
      const rowInfo = db.prepare("INSERT INTO proyectos_db_rows (database_id, title, position, updated_at) VALUES (?, ?, ?, datetime('now'))").run(
        newDbId,
        String(row.title || '').slice(0, 300),
        Number(row.position) || 0
      );
      for (const value of row.values || []) {
        const propId = propMap.get(value.propKey);
        if (!propId || value.value == null || value.value === '') continue;
        db.prepare('INSERT INTO proyectos_db_values (row_id, prop_id, value) VALUES (?, ?, ?)').run(rowInfo.lastInsertRowid, propId, String(value.value).slice(0, 500));
      }
      if (row.body) rowBodiesToPatch.push({ rowId: rowInfo.lastInsertRowid, body: row.body });
    }
  }

  // 3) Los cuerpos, ya con todos los mapas montados. Se re-sanean al
  //    escribirlos (los de un paquete importado vienen de fuera).
  const maps = { dbMap, pageMap, imageMap };
  for (const page of pagesData) {
    if (!page.body) continue;
    db.prepare('UPDATE proyectos_pages SET body = ? WHERE id = ?').run(
      sanitizePageBody(remapBody(String(page.body), maps)) || null,
      pageMap.get(page.key)
    );
  }
  for (const patch of rowBodiesToPatch) {
    db.prepare('UPDATE proyectos_db_rows SET body = ? WHERE id = ?').run(
      sanitizePageBody(remapBody(String(patch.body), maps)) || null,
      patch.rowId
    );
  }
  return pageMap.get(rootKey);
}

// Filas de la base -> el formato plano del motor.
function subtreeAsData(pages, databases) {
  return {
    pagesData: pages.map((p) => ({
      key: p.id,
      parentKey: p.parent_id,
      title: p.title,
      icon: p.icon,
      coverColor: p.cover_color,
      position: p.position,
      pdfRole: p.pdf_role,
      isTemplate: !!p.is_template,
      body: p.body,
    })),
    databasesData: databases.map((d) => ({
      key: d.id,
      pageKey: d.page_id,
      name: d.name,
      viewType: d.view_type,
      sortDir: d.sort_dir,
      filterValue: d.filter_value,
      boardPropKey: d.board_prop_id,
      sortPropKey: d.sort_prop_id,
      filterPropKey: d.filter_prop_id,
      timelineStartPropKey: d.timeline_start_prop_id,
      timelineEndPropKey: d.timeline_end_prop_id,
      props: d.props.map((prop) => ({ key: prop.id, name: prop.name, type: prop.type, options: prop.options, position: prop.position })),
      rows: d.rows.map((row) => ({
        title: row.title,
        body: row.body,
        position: row.position,
        values: row.values.map((v) => ({ propKey: v.prop_id, value: v.value })),
      })),
    })),
  };
}

// Clonar un subarbol dentro de la app ("Usar plantilla", "Desde
// plantilla…"): copia fisica de las imagenes incluida.
router.post('/:id/clone', (req, res) => {
  const pages = collectSubtree(Number(req.params.id));
  if (!pages) return res.status(404).json({ error: 'not_found' });
  const { parentId, title, asTemplate } = req.body || {};
  const safeParent = resolveParentId(null, parentId);

  const databases = collectDatabases(pages.map((p) => p.id));
  const bodies = [...pages.map((p) => p.body), ...databases.flatMap((d) => d.rows.map((r) => r.body))];
  const imageMap = new Map();
  for (const name of collectImageNames(bodies)) {
    const copy = copyImageFile(name);
    if (copy) imageMap.set(name, copy);
  }
  const { pagesData, databasesData } = subtreeAsData(pages, databases);
  const newRootId = materializeProject(pagesData, databasesData, imageMap, {
    parentId: safeParent,
    title: title ? String(title) : null,
    asTemplate: !!asTemplate,
  });
  const row = db.prepare(`${LIST_SELECT} WHERE id = ?`).get(newRootId);
  res.status(201).json(serializeListRow(row));
});

// Exportar un proyecto como paquete (el archivo .rmproj que se guarda
// en disco lo escribe Electron; aqui solo se monta el JSON, con las
// imagenes dentro en base64 para que viaje completo a otro ordenador).
router.get('/:id/export', (req, res) => {
  const pages = collectSubtree(Number(req.params.id));
  if (!pages) return res.status(404).json({ error: 'not_found' });
  const databases = collectDatabases(pages.map((p) => p.id));
  const bodies = [...pages.map((p) => p.body), ...databases.flatMap((d) => d.rows.map((r) => r.body))];
  const images = {};
  for (const name of collectImageNames(bodies)) {
    const image = readImageAsBase64(name);
    if (image) images[name] = image;
  }
  const { pagesData, databasesData } = subtreeAsData(pages, databases);
  res.json({
    format: 'remindmelater-proyecto',
    version: 1,
    exportedAt: new Date().toISOString(),
    pages: pagesData,
    databases: databasesData,
    images,
  });
});

// Importar un paquete exportado (en este u otro ordenador): crea un
// proyecto RAIZ nuevo con todo dentro.
router.post('/import', (req, res) => {
  const bundle = req.body || {};
  if (bundle.format !== 'remindmelater-proyecto' || !Array.isArray(bundle.pages) || bundle.pages.length === 0) {
    return res.status(400).json({ error: 'invalid_request', message: 'El archivo no es un proyecto exportado de esta app.' });
  }
  const imageMap = new Map();
  const images = bundle.images && typeof bundle.images === 'object' ? bundle.images : {};
  for (const [name, image] of Object.entries(images)) {
    if (!image) continue;
    const filename = writeImageFromBase64(image.data, String(image.ext || '').toLowerCase());
    if (filename) imageMap.set(String(name), filename);
  }
  const databases = Array.isArray(bundle.databases) ? bundle.databases : [];
  const newRootId = materializeProject(bundle.pages, databases, imageMap, {
    parentId: null,
    asTemplate: !!bundle.pages[0].isTemplate,
  });
  const row = db.prepare(`${LIST_SELECT} WHERE id = ?`).get(newRootId);
  res.status(201).json(serializeListRow(row));
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
