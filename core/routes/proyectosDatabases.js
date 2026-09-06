// routes/proyectosDatabases.js — bases de datos embebidas en paginas de
// Proyectos: coleccion de filas con propiedades tipadas (texto, numero,
// select, fecha, checkbox) que la pagina enseña como tabla/tablero/
// lista. Ver proyectos_databases y compañia en core/db.js.
//
// Borrado en cascada A MANO, como en todo el proyecto: borrar una base
// borra sus valores, filas y propiedades; borrar una propiedad borra sus
// valores; borrar una fila borra los suyos. Nada de ON DELETE CASCADE.
const { createRouter } = require('../router');
const db = require('../db');

const router = createRouter();

// Tipos de propiedad. "labels" (etiquetas de color, varias por fila,
// estilo Trello) y "color" (un color por fila, la "portada" de su
// tarjeta) llegaron en la ronda de tarjetas.
const PROP_TYPES = new Set(['text', 'number', 'select', 'date', 'checkbox', 'labels', 'color']);
const VIEW_TYPES = new Set(['table', 'board', 'list', 'timeline']);

// "options" (solo selects): siempre un JSON de array de textos cortos.
// Cualquier otra cosa se descarta y se guarda null.
function sanitizeOptions(options) {
  if (!Array.isArray(options)) return null;
  const clean = options
    .map((o) => String(o).trim().slice(0, 60))
    .filter((o) => o !== '');
  return clean.length ? JSON.stringify(clean) : null;
}

// "options" de una propiedad de etiquetas: array de { name, color }.
// El color va validado como hex de 6 SIEMPRE -- la interfaz lo pinta
// tal cual como fondo de la pastilla, asi que aqui no puede colarse
// nada que no sea un color.
function sanitizeLabelOptions(options) {
  if (!Array.isArray(options)) return null;
  const clean = options
    .map((o) => ({
      name: String(o && o.name !== undefined ? o.name : '').trim().slice(0, 60),
      color: o && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : '#4493f8',
    }))
    .filter((o) => o.name !== '');
  return clean.length ? JSON.stringify(clean) : null;
}

// Que saneador de opciones le toca a cada tipo (los demas no llevan).
function optionsForType(type, options) {
  if (type === 'select') return sanitizeOptions(options);
  if (type === 'labels') return sanitizeLabelOptions(options);
  return null;
}

function serializeProp(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    options: row.options ? JSON.parse(row.options) : [],
    position: row.position,
  };
}

function serializeRow(row, valuesByRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body || null,
    position: row.position,
    // { propId: valor } -- solo las celdas con algo escrito.
    values: valuesByRow.get(row.id) || {},
  };
}

function serializeDatabase(dbRow) {
  const props = db
    .prepare('SELECT * FROM proyectos_db_props WHERE database_id = ? ORDER BY position ASC, id ASC')
    .all(dbRow.id);
  const rows = db
    .prepare('SELECT * FROM proyectos_db_rows WHERE database_id = ? ORDER BY position ASC, id ASC')
    .all(dbRow.id);
  // Todos los valores de la base de una tacada (un solo JOIN), en vez de
  // una consulta por fila.
  const values = db
    .prepare(`
      SELECT v.row_id, v.prop_id, v.value
      FROM proyectos_db_values v
      JOIN proyectos_db_rows r ON r.id = v.row_id
      WHERE r.database_id = ?
    `)
    .all(dbRow.id);
  const valuesByRow = new Map();
  for (const v of values) {
    if (!valuesByRow.has(v.row_id)) valuesByRow.set(v.row_id, {});
    valuesByRow.get(v.row_id)[v.prop_id] = v.value;
  }
  return {
    id: dbRow.id,
    pageId: dbRow.page_id,
    name: dbRow.name,
    viewType: dbRow.view_type,
    boardPropId: dbRow.board_prop_id,
    sortPropId: dbRow.sort_prop_id,
    sortDir: dbRow.sort_dir,
    filterPropId: dbRow.filter_prop_id,
    filterValue: dbRow.filter_value,
    timelineStartPropId: dbRow.timeline_start_prop_id,
    timelineEndPropId: dbRow.timeline_end_prop_id,
    props: props.map(serializeProp),
    rows: rows.map((r) => serializeRow(r, valuesByRow)),
  };
}

// Crear una base nueva (la llama el bloque "Base de datos" del menu
// "/"). Nace con una propiedad "Estado" de tipo select ya montada, para
// que el tablero tenga algo por lo que agrupar desde el primer momento.
router.post('/', (req, res) => {
  const { pageId, name } = req.body || {};
  const page = db.prepare('SELECT id FROM proyectos_pages WHERE id = ?').get(pageId);
  if (!page) return res.status(400).json({ error: 'invalid_request', message: 'La base de datos tiene que vivir en una página que exista.' });

  const info = db
    .prepare('INSERT INTO proyectos_databases (page_id, name) VALUES (?, ?)')
    .run(page.id, name ? String(name).slice(0, 200) : '');
  const dbId = info.lastInsertRowid;

  const propInfo = db
    .prepare('INSERT INTO proyectos_db_props (database_id, name, type, options, position) VALUES (?, ?, ?, ?, 0)')
    .run(dbId, 'Estado', 'select', JSON.stringify(['Pendiente', 'En curso', 'Hecho']));
  // El tablero agrupa por "Estado" desde el principio.
  db.prepare('UPDATE proyectos_databases SET board_prop_id = ? WHERE id = ?').run(propInfo.lastInsertRowid, dbId);

  const row = db.prepare('SELECT * FROM proyectos_databases WHERE id = ?').get(dbId);
  res.status(201).json(serializeDatabase(row));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM proyectos_databases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serializeDatabase(row));
});

// Configuracion de la base: nombre y estado de la vista (tipo, orden,
// filtro, agrupacion del tablero).
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM proyectos_databases WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, viewType, boardPropId, sortPropId, sortDir, filterPropId, filterValue, timelineStartPropId, timelineEndPropId } = req.body || {};

  // Un id de propiedad que se manda aqui tiene que ser de ESTA base (o
  // null para "sin"). Si no, se ignora y se deja el que estaba.
  function resolvePropId(candidate, current) {
    if (candidate === undefined) return current;
    if (candidate === null || candidate === '') return null;
    const prop = db.prepare('SELECT id FROM proyectos_db_props WHERE id = ? AND database_id = ?').get(candidate, existing.id);
    return prop ? prop.id : current;
  }

  db.prepare(`
    UPDATE proyectos_databases
    SET name = ?, view_type = ?, board_prop_id = ?, sort_prop_id = ?, sort_dir = ?, filter_prop_id = ?, filter_value = ?,
        timeline_start_prop_id = ?, timeline_end_prop_id = ?
    WHERE id = ?
  `).run(
    name !== undefined ? String(name).slice(0, 200) : existing.name,
    viewType !== undefined && VIEW_TYPES.has(viewType) ? viewType : existing.view_type,
    resolvePropId(boardPropId, existing.board_prop_id),
    resolvePropId(sortPropId, existing.sort_prop_id),
    sortDir === 'asc' || sortDir === 'desc' ? sortDir : existing.sort_dir,
    resolvePropId(filterPropId, existing.filter_prop_id),
    filterValue !== undefined ? (filterValue === null ? null : String(filterValue).slice(0, 200)) : existing.filter_value,
    resolvePropId(timelineStartPropId, existing.timeline_start_prop_id),
    resolvePropId(timelineEndPropId, existing.timeline_end_prop_id),
    existing.id
  );

  const row = db.prepare('SELECT * FROM proyectos_databases WHERE id = ?').get(existing.id);
  res.json(serializeDatabase(row));
});

// Borra la base entera (valores -> filas -> propiedades -> base). La
// llama la interfaz al quitar el bloque de la pagina, y tambien
// proyectosPages.js al borrar una pagina con bases dentro.
function deleteDatabaseCascade(databaseId) {
  db.prepare(`
    DELETE FROM proyectos_db_values WHERE row_id IN (
      SELECT id FROM proyectos_db_rows WHERE database_id = ?
    )
  `).run(databaseId);
  db.prepare('DELETE FROM proyectos_db_rows WHERE database_id = ?').run(databaseId);
  db.prepare('DELETE FROM proyectos_db_props WHERE database_id = ?').run(databaseId);
  db.prepare('DELETE FROM proyectos_databases WHERE id = ?').run(databaseId);
}

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM proyectos_databases WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  deleteDatabaseCascade(existing.id);
  res.status(204).end();
});

// ------------------------- Propiedades -------------------------------
router.post('/:id/props', (req, res) => {
  const database = db.prepare('SELECT id FROM proyectos_databases WHERE id = ?').get(req.params.id);
  if (!database) return res.status(404).json({ error: 'not_found' });

  const { name, type, options } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'La propiedad necesita un nombre.' });
  }
  const safeType = PROP_TYPES.has(type) ? type : 'text';
  const { count } = db.prepare('SELECT COUNT(*) as count FROM proyectos_db_props WHERE database_id = ?').get(database.id);
  const info = db
    .prepare('INSERT INTO proyectos_db_props (database_id, name, type, options, position) VALUES (?, ?, ?, ?, ?)')
    .run(database.id, String(name).trim().slice(0, 100), safeType, optionsForType(safeType, options), count);
  const row = db.prepare('SELECT * FROM proyectos_db_props WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serializeProp(row));
});

router.put('/props/:propId', (req, res) => {
  const existing = db.prepare('SELECT * FROM proyectos_db_props WHERE id = ?').get(req.params.propId);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, type, options } = req.body || {};
  const nextType = type !== undefined && PROP_TYPES.has(type) ? type : existing.type;
  db.prepare('UPDATE proyectos_db_props SET name = ?, type = ?, options = ? WHERE id = ?').run(
    name !== undefined && String(name).trim() ? String(name).trim().slice(0, 100) : existing.name,
    nextType,
    (nextType === 'select' || nextType === 'labels')
      ? (options !== undefined ? optionsForType(nextType, options) : existing.options)
      : null,
    existing.id
  );
  const row = db.prepare('SELECT * FROM proyectos_db_props WHERE id = ?').get(existing.id);
  res.json(serializeProp(row));
});

router.delete('/props/:propId', (req, res) => {
  const existing = db.prepare('SELECT * FROM proyectos_db_props WHERE id = ?').get(req.params.propId);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM proyectos_db_values WHERE prop_id = ?').run(existing.id);
  // Si el tablero/orden/filtro usaban esta propiedad, se quedan "sin"
  // en vez de romperse.
  db.prepare('UPDATE proyectos_databases SET board_prop_id = NULL WHERE board_prop_id = ?').run(existing.id);
  db.prepare('UPDATE proyectos_databases SET sort_prop_id = NULL WHERE sort_prop_id = ?').run(existing.id);
  db.prepare('UPDATE proyectos_databases SET filter_prop_id = NULL, filter_value = NULL WHERE filter_prop_id = ?').run(existing.id);
  db.prepare('UPDATE proyectos_databases SET timeline_start_prop_id = NULL WHERE timeline_start_prop_id = ?').run(existing.id);
  db.prepare('UPDATE proyectos_databases SET timeline_end_prop_id = NULL WHERE timeline_end_prop_id = ?').run(existing.id);
  db.prepare('DELETE FROM proyectos_db_props WHERE id = ?').run(existing.id);
  res.status(204).end();
});

// ---------------------------- Filas ----------------------------------
router.post('/:id/rows', (req, res) => {
  const database = db.prepare('SELECT id FROM proyectos_databases WHERE id = ?').get(req.params.id);
  if (!database) return res.status(404).json({ error: 'not_found' });

  const { title, values } = req.body || {};
  const { count } = db.prepare('SELECT COUNT(*) as count FROM proyectos_db_rows WHERE database_id = ?').get(database.id);
  const info = db
    .prepare("INSERT INTO proyectos_db_rows (database_id, title, position, updated_at) VALUES (?, ?, ?, datetime('now'))")
    .run(database.id, title ? String(title).slice(0, 300) : '', count);
  const rowId = info.lastInsertRowid;

  // Valores iniciales opcionales (p. ej. crear una tarjeta directamente
  // en una columna del tablero ya trae el Estado puesto).
  if (values && typeof values === 'object') {
    for (const [propId, value] of Object.entries(values)) {
      const prop = db.prepare('SELECT id FROM proyectos_db_props WHERE id = ? AND database_id = ?').get(propId, database.id);
      if (!prop || value === null || value === '') continue;
      db.prepare('INSERT INTO proyectos_db_values (row_id, prop_id, value) VALUES (?, ?, ?)').run(rowId, prop.id, String(value).slice(0, 500));
    }
  }

  const dbRow = db.prepare('SELECT * FROM proyectos_databases WHERE id = ?').get(database.id);
  res.status(201).json(serializeDatabase(dbRow));
});

// El cuerpo de una fila pasa por el MISMO saneador de HTML que el de
// una pagina (se edita con el mismo tipo de editor en el side peek).
const { sanitizePageBody } = require('./proyectosPages');

router.put('/rows/:rowId', (req, res) => {
  const existing = db.prepare('SELECT * FROM proyectos_db_rows WHERE id = ?').get(req.params.rowId);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { title, body } = req.body || {};
  db.prepare("UPDATE proyectos_db_rows SET title = ?, body = ?, updated_at = datetime('now') WHERE id = ?").run(
    title !== undefined ? String(title).slice(0, 300) : existing.title,
    body !== undefined ? (sanitizePageBody(body) || null) : existing.body,
    existing.id
  );
  const row = db.prepare('SELECT * FROM proyectos_db_rows WHERE id = ?').get(existing.id);
  // Se devuelve la fila sola (con sus valores), no la base entera --
  // es lo que el side peek necesita refrescar.
  const values = db.prepare('SELECT prop_id, value FROM proyectos_db_values WHERE row_id = ?').all(existing.id);
  const map = new Map([[row.id, Object.fromEntries(values.map((v) => [v.prop_id, v.value]))]]);
  res.json(serializeRow(row, map));
});

router.delete('/rows/:rowId', (req, res) => {
  const existing = db.prepare('SELECT id FROM proyectos_db_rows WHERE id = ?').get(req.params.rowId);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM proyectos_db_values WHERE row_id = ?').run(existing.id);
  db.prepare('DELETE FROM proyectos_db_rows WHERE id = ?').run(existing.id);
  res.status(204).end();
});

// --------------------------- Valores ---------------------------------
// Escribir una celda: upsert de (fila, propiedad) -> valor. Vaciar el
// valor borra la fila de valores (una celda vacia no ocupa sitio).
router.put('/rows/:rowId/values/:propId', (req, res) => {
  const row = db.prepare('SELECT * FROM proyectos_db_rows WHERE id = ?').get(req.params.rowId);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const prop = db.prepare('SELECT * FROM proyectos_db_props WHERE id = ? AND database_id = ?').get(req.params.propId, row.database_id);
  if (!prop) return res.status(404).json({ error: 'not_found' });

  const { value } = req.body || {};
  if (value === null || value === undefined || value === '') {
    db.prepare('DELETE FROM proyectos_db_values WHERE row_id = ? AND prop_id = ?').run(row.id, prop.id);
  } else {
    db.prepare(`
      INSERT INTO proyectos_db_values (row_id, prop_id, value) VALUES (?, ?, ?)
      ON CONFLICT (row_id, prop_id) DO UPDATE SET value = excluded.value
    `).run(row.id, prop.id, String(value).slice(0, 500));
  }
  res.status(204).end();
});

module.exports = router;
module.exports.deleteDatabaseCascade = deleteDatabaseCascade;
