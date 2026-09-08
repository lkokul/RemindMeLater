// routes/backup.js — copias de seguridad POR HERRAMIENTA (ronda de la
// Tienda), y mas adelante en esta misma ronda el borrado de datos y la
// restauracion selectiva.
//
// El formato es la VERSION 2 del sobre que ya inauguro la app movil
// autonoma (rama movil-ui, public/backup.js): un unico archivo .json con
// { app, kind, version, exportedAt } por fuera. La v1 de alli mete la
// base SQLite entera en base64 y al importar sustituye TODO; esta v2, en
// cambio, lleva una seccion por herramienta con sus filas tal cual
// (SELECT *) y sus archivos binarios, para poder restaurar solo una
// parte y FUSIONAR sin duplicar (gracias al "uid" por fila, ver la
// migracion en db.js). Una copia v1 NO se puede abrir aqui todavia --
// compatibilidad cruzada apuntada como trabajo futuro en CLAUDE.md.
//
// Que herramienta tiene que tablas y que carpetas NO se decide aqui: se
// lee del registro compartido (public/tools-registry.js), el mismo
// archivo que pinta la Tienda en el navegador. Añadir una herramienta al
// registro hace que su copia funcione sola.
//
// Permisos: todo lo de este archivo exige ser el ordenador de confianza
// (requireTrusted, mismo criterio que routes/update.js): exportar
// escribe un temporal en el disco y se lleva TODOS los datos, y
// borrar/restaurar son destructivos -- un movil emparejado no deberia
// poder dispararlos contra el ordenador. La app movil autonoma tiene su
// propio backup local (movil-ui), no pasa por aqui.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { requireTrusted } = require('../auth');

const router = express.Router();

const TOOLS_REGISTRY = require(path.join(__dirname, '..', '..', 'public', 'tools-registry.js'));
const APP_VERSION = require(path.join(__dirname, '..', '..', 'package.json')).version;

// Carpeta de temporales de exportacion, dentro de DATA_DIR como el resto
// de datos. Se limpia al terminar cada descarga; si el proceso muere a
// mitad, el siguiente arranque no la toca (archivos huerfanos ocupan
// poco y se pueden borrar a mano) -- no compensa un limpiador mas.
const TMP_DIR = path.join(db.DATA_DIR, 'backups-tmp');

// Herramientas con algo que copiar: las que tienen tablas o carpetas
// (deja fuera a Archivos, cuya carpeta son archivos sueltos del usuario
// que no pertenecen a la app -- ver su entrada en el registro).
function exportableTools() {
  return TOOLS_REGISTRY.filter((t) => t.tablas.length || t.singletons.length || t.carpetas.length);
}

function findTool(id) {
  return exportableTools().find((t) => t.id === id) || null;
}

// Vaciar el WAL a la base principal antes de leerla entera. Sin esto,
// los ultimos cambios pueden estar solo en el archivo -wal y la copia
// saldria VIEJA sin que nada avise -- es el bug silencioso numero uno de
// cualquier backup de SQLite. Mismo try/catch tolerante que la
// activacion del WAL en db.js (si el PRAGMA falla, se sigue: la lectura
// via SQLite ve los datos igual, esto solo consolida el archivo).
function checkpointWal() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.warn('No se pudo hacer checkpoint del WAL antes de exportar:', err.message);
  }
}

// GET /api/backup/export?tools=gym,viajes — genera el archivo de copia y
// lo manda como descarga. Sin ?tools, va todo lo exportable.
//
// El JSON se ESCRIBE POR TROZOS a un archivo temporal en vez de montarse
// entero en memoria: las fotos de Viajes en base64 pueden ser cientos de
// megas y reventarian el limite de tamano de un string de Node. Se
// escribe en sincrono (fs.writeSync), igual que el resto del servidor
// habla con SQLite en sincrono -- es una app de una sola persona, no
// pasa nada por bloquear el proceso el rato que dure.
router.get('/export', requireTrusted, (req, res) => {
  const pedidos = String(req.query.tools || '').split(',').map((s) => s.trim()).filter(Boolean);
  let tools;
  if (pedidos.length) {
    tools = [];
    for (const id of pedidos) {
      const tool = findTool(id);
      if (!tool) return res.status(400).json({ error: 'unknown_tool', message: `Herramienta desconocida: ${id}` });
      tools.push(tool);
    }
  } else {
    tools = exportableTools();
  }

  checkpointWal();

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tmpPath = path.join(TMP_DIR, `${crypto.randomUUID()}.json`);
  const fd = fs.openSync(tmpPath, 'w');
  const write = (texto) => fs.writeSync(fd, texto);

  try {
    write(
      `{"app":"RemindMeLater","kind":"backup","version":2,"appVersion":${JSON.stringify(APP_VERSION)},` +
        `"exportedAt":${JSON.stringify(new Date().toISOString())},"tools":{`
    );

    tools.forEach((tool, i) => {
      if (i > 0) write(',');
      write(`${JSON.stringify(tool.id)}:{"version":${JSON.stringify(tool.version)},"rows":{`);

      // Las filas van tal cual salen de SQLite (SELECT *), SIN pasar por
      // los serializadores camelCase de las rutas: esos estan pensados
      // para el navegador; para restaurar hace falta el formato REAL de
      // la tabla, columna a columna. El orden de tablas es el del
      // registro (padres antes que hijos) -- la restauracion depende de
      // el, ver el comentario de "tablas" en tools-registry.js.
      const tablas = [...tool.tablas, ...tool.singletons];
      tablas.forEach((tabla, j) => {
        if (j > 0) write(',');
        write(`${JSON.stringify(tabla)}:[`);
        // node:sqlite no tiene cursores por lotes, pero .all() de una
        // tabla de datos personales (miles de filas, no millones) cabe
        // de sobra -- lo que NO cabria son las fotos, que van aparte.
        const filas = db.prepare(`SELECT * FROM ${tabla}`).all();
        filas.forEach((fila, k) => {
          if (k > 0) write(',');
          write(JSON.stringify(fila));
        });
        write(']');
      });
      write('},"files":[');

      // Archivos binarios de la herramienta (fotos de viajes, imagenes
      // de notas): uno a uno, en base64. Se lee cada archivo entero (los
      // archivos individuales son de megas, no de cientos de megas) y se
      // suelta al temporal antes de leer el siguiente.
      let primero = true;
      for (const carpeta of tool.carpetas) {
        const dirAbs = path.join(db.DATA_DIR, carpeta);
        if (!fs.existsSync(dirAbs)) continue;
        for (const nombre of fs.readdirSync(dirAbs)) {
          const rutaAbs = path.join(dirAbs, nombre);
          if (!fs.statSync(rutaAbs).isFile()) continue;
          if (!primero) write(',');
          primero = false;
          write(
            `{"dir":${JSON.stringify(carpeta)},"name":${JSON.stringify(nombre)},` +
              `"bytesBase64":${JSON.stringify(fs.readFileSync(rutaAbs).toString('base64'))}}`
          );
        }
      }
      write(']}');
    });

    write('}}');
    fs.closeSync(fd);
  } catch (err) {
    try { fs.closeSync(fd); } catch (e) { /* ya cerrado */ }
    fs.unlink(tmpPath, () => {});
    return res.status(500).json({ error: 'export_failed', message: err.message });
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const ids = tools.length === exportableTools().length ? 'todo' : tools.map((t) => t.id).join('+');
  res.download(tmpPath, `remindmelater-copia-${ids}-${fecha}.json`, () => {
    // Descarga terminada (bien o mal): el temporal ya no hace falta.
    fs.unlink(tmpPath, () => {});
  });
});

module.exports = router;
