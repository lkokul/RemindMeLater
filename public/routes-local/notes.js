// notes — portado de server/routes/notes.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/notes.js — CRUD de notas de "Mi espacio" (titulo + contenido con
  // formato basico desde la Fase 4; carpeta opcional desde la Fase 3, ver
  // routes/noteFolders.js).
  // Borra los bytes de las imagenes que tuviera una nota que se acaba
  // de eliminar. En el servidor eran archivos de una carpeta del disco;
  // ahora viven en el almacen "noteAssets" de IndexedDB. Sigue siendo
  // best-effort y sin esperar (no hace falta su resultado para
  // responder), igual que el fs.unlink de antes. Se mantiene la misma
  // limitacion conocida: quitar una imagen de en medio EDITANDO la nota
  // no libera esos bytes, solo borrar la nota entera.
  function deleteImagesInBody(body) {
    if (!body) return;
    for (const match of body.matchAll(/\/api\/notes\/images\/([a-zA-Z0-9._-]+)/g)) {
      assetDelete(match[1]).catch(() => {});
    }
  }

  const router = createLocalRouter();

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
  const ALLOWED_NOTE_TAGS = new Set([
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'span',
    'ul', 'ol', 'li', 'br', 'div', 'p', 'h1', 'h2', 'h3',
    'table', 'colgroup', 'col', 'tbody', 'tr', 'td', 'th',
    'img', 'pre', 'code',
  ]);
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
  // Sangria por parrafo (data-indent, ver applyNoteIndentDelta en app.js):
  // un solo digito 0-4 -- el propio cliente nunca deja el atributo puesto
  // a "0" (lo quita del todo), pero se admite igualmente por si acaso.
  const NOTE_INDENT_LEVEL = /^[0-4]$/;
  // Color de resaltado (fondo, NO subrayado -- confirmado con Koku, ver
  // applyNoteHighlight en app.js): un Set cerrado de 5 claves fijas
  // (data-highlight), no un color libre -- el cliente ya no manda ningun
  // "style" en linea para esto, los colores concretos (fondo+texto) los
  // define solo el CSS del servidor de la app. Mas simple Y mas estricto
  // que la regex abierta que aceptaba cualquier rgb()/hex de antes.
  const NOTE_HIGHLIGHT_KEYS = new Set(['yellow', 'green', 'blue', 'pink', 'orange']);

  // En un <div contenteditable> real, la PRIMERA linea normalmente NO
  // queda envuelta en su propia etiqueta -- se queda como texto suelto al
  // principio, y solo la SEGUNDA linea en adelante se envuelve en un <div>
  // nuevo al pulsar Intro (comprobado de verdad: escribir "A" + Intro +
  // "B" deja el HTML como "A<div>B</div>", NO "<div>A</div><div>B</div>").
  // Por eso la señal real de "aqui acaba la primera linea" es la APERTURA
  // de ese div siguiente, no su cierre -- buscar solo el cierre (como
  // hacia la primera version de esta funcion) se comia la segunda linea
  // entera en ese caso, un bug real encontrado verificando con Playwright.
  // Si en cambio el cuerpo YA viene envuelto desde el principio (una nota
  // cargada del servidor, contenido pegado con formato), se usa el cierre
  // de ESE bloque concreto -- de ahi que se descarte una apertura que
  // coincide justo en la posicion 0 y se seguisga buscando.
  function findFirstLineBreakIndex(html) {
    const pattern = /<br\s*\/?>|<\/(?:div|p|li|h1|h2|h3)>|<(?:div|p|li|h1|h2|h3)(?:\s[^>]*)?>/gi;
    let match;
    while ((match = pattern.exec(html))) {
      const isOpeningBlockAtStart = match.index === 0 && match[0][1] !== '/' && !/^<br/i.test(match[0]);
      if (isOpeningBlockAtStart) continue;
      return match.index;
    }
    return html.length;
  }

  // Fase 4 del rediseño movil: ya no hay un campo de titulo aparte en el
  // editor (ni movil ni escritorio, es el mismo formulario) -- el titulo se
  // deriva SIEMPRE de la primera linea del cuerpo. En texto plano es el
  // trozo antes del primer "\n"; en HTML es el trozo antes del primer salto
  // de bloque real (ver findFirstLineBreakIndex arriba), con las etiquetas
  // quitadas y las entidades mas comunes decodificadas. Recortado a 200
  // caracteres, igual que cualquier otro texto corto de la app.
  function deriveTitleFromBody(body, bodyFormat) {
    if (!body) return '';
    const format = bodyFormat === 'html' ? 'html' : 'text';
    let firstLine;
    if (format === 'html') {
      firstLine = body.slice(0, findFirstLineBreakIndex(body));
      firstLine = firstLine
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
    } else {
      firstLine = body.split('\n')[0];
    }
    return firstLine.trim().slice(0, 200);
  }

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
      // El resaltado de color (applyNoteHighlight en app.js) envuelve la
      // seleccion en un <span data-highlight="..."> nuevo -- pero si esa
      // seleccion ya estaba ENTERA dentro de otra etiqueta en linea
      // (negrita/cursiva/subrayado/tachado), Chrome reaprovecha esa misma
      // etiqueta poniendole el atributo directamente en vez de anidar un
      // span dentro (combinacion real y esperada, p. ej. resaltar un trozo
      // ya en negrita) -- asi que las 7 etiquetas en linea admiten el mismo
      // data-highlight restringido, no solo "span".
      if (lower === 'span' || lower === 'b' || lower === 'strong' || lower === 'i' || lower === 'em' || lower === 'u' || lower === 's' || lower === 'strike') {
        const hlMatch = attrs.match(/\sdata-highlight\s*=\s*"([^"]*)"/i);
        return hlMatch && NOTE_HIGHLIGHT_KEYS.has(hlMatch[1]) ? `<${lower} data-highlight="${hlMatch[1]}">` : `<${lower}>`;
      }
      if (lower === 'p' || lower === 'div' || lower === 'h1' || lower === 'h2' || lower === 'h3') {
        // Estilo de parrafo/sangria/cita (data-style/data-indent/data-quote,
        // ver applyNoteParagraphStyle/applyNoteIndentDelta/toggleNoteQuoteBlock
        // en app.js) -- los 3 son independientes y combinables. "li" se
        // EXCLUYE a proposito de esta rama (cae en el "return" generico de
        // abajo, sin atributos): cualquier data-indent/data-quote/data-style
        // en un <li> se descarta solo, reforzando en el servidor la misma
        // regla del cliente de que estas 3 funciones no aplican en listas.
        const styleAttrMatch = attrs.match(/\sdata-style\s*=\s*"([^"]*)"/i);
        const indentMatch = attrs.match(/\sdata-indent\s*=\s*"([^"]*)"/i);
        const quoteMatch = attrs.match(/\sdata-quote\s*=\s*"([^"]*)"/i);
        let out = `<${lower}`;
        // Enum de un solo valor literal por ahora -- mismo criterio que
        // table/data-border mas arriba, no una expresion suelta.
        if (styleAttrMatch && styleAttrMatch[1] === 'mono') out += ' data-style="mono"';
        if (indentMatch && NOTE_INDENT_LEVEL.test(indentMatch[1])) out += ` data-indent="${indentMatch[1]}"`;
        if (quoteMatch && quoteMatch[1] === '1') out += ' data-quote="1"';
        return `${out}>`;
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
    const { body, folderId, favorite, bodyFormat } = req.body || {};

    // "Creado por" se rellena con tu perfil en el momento de crear la nota,
    // igual que en los eventos (ver server/db.js): una foto fija del nombre
    // de entonces, no un enlace en vivo a tu nickname actual.
    const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();

    // El editor con formato (Fase 4) siempre manda bodyFormat: 'html'; solo
    // se saneamos en ese caso -- si no viene (o viene otra cosa) se trata
    // como texto plano tal cual, sin tocarlo (ver sanitizeNoteBody arriba).
    const format = bodyFormat === 'html' ? 'html' : 'text';
    const cleanBody = format === 'html' ? sanitizeNoteBody(body) : (body || null);
    // Fase 4: ya no se pide titulo aparte, se deriva de la primera linea
    // del cuerpo (ver deriveTitleFromBody arriba).
    const title = deriveTitleFromBody(cleanBody, format);

    const info = db
      .prepare('INSERT INTO notes (title, body, body_format, folder_id, favorite, created_by_name, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        title,
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

    const { body, hidden, folderId, favorite, bodyFormat } = req.body || {};

    // Igual que en el POST: solo saneamos como HTML si el body que llega
    // viene marcado explicitamente como 'html' (el editor con formato lo
    // manda siempre asi). Si no se toca el body en este PUT, se deja el
    // formato que ya tuviera la nota tal cual.
    const format = bodyFormat !== undefined ? (bodyFormat === 'html' ? 'html' : 'text') : existing.body_format;
    const cleanBody = body !== undefined
      ? (format === 'html' ? sanitizeNoteBody(body) : body)
      : existing.body;
    // Fase 4: el titulo se re-deriva solo si el PUT trae un body nuevo; si
    // no se toca el body (p. ej. un PUT que solo cambia folderId/favorite),
    // se conserva el titulo ya guardado tal cual.
    const title = body !== undefined ? deriveTitleFromBody(cleanBody, format) : existing.title;

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
      title,
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

  mountLocalRouter('/api/notes', router);
})();
