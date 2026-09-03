// routes/descargas.js — extension "Descargas": bajar un archivo de
// cualquier URL, bajar video/audio de sitios tipo YouTube (via yt-dlp),
// y convertir formato de un archivo ya bajado (via ffmpeg). Toda la
// ejecucion real (streaming, spawn de los binarios, progreso) vive en
// descargasRunner.js -- este archivo solo valida peticiones y lee/
// escribe la tabla descargas_jobs + la carpeta DOWNLOADS_DIR.
//
// A diferencia de Archivos, aqui NO hace falta requireTrusted en
// ninguna ruta: la carpeta de Descargas es fija (uso interno, no algo
// que Koku gestione a mano desde el Finder/Explorador como la de
// Archivos), asi que ninguna ruta explora el disco entero -- todo el
// router se monta con requireDeviceOrTrusted global (ver index.js),
// un movil emparejado puede pedir una descarga/conversion igual que
// puede subir un archivo a Archivos hoy. Sin doble confirmacion tipo
// archivosTransfers.js: ahi hace falta porque hay OTRO dispositivo al
// que pedirle permiso (mover un archivo entre dos maquinas); aqui no
// hay ningun otro dispositivo, el ordenador simplemente ejecuta el
// trabajo por cuenta del que lo pidio.
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const runner = require('../descargasRunner');

const router = express.Router();
const { DOWNLOADS_DIR, CONVERT_TARGET_FORMATS } = runner;

function serializeJob(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    sourceUrl: row.source_url,
    mediaFormat: row.media_format,
    sourceFilename: row.source_filename,
    targetFormat: row.target_format,
    outputFilename: row.output_filename,
    progressPercent: row.progress_percent,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

// Disponibilidad real de yt-dlp/ffmpeg -- informativo, para el aviso en
// la interfaz si falta alguno (no bloquea la lista/borrado de archivos,
// que no necesitan ningun binario).
router.get('/tools', async (req, res) => {
  const [ytDlp, ffmpeg] = await Promise.all([runner.checkYtDlp(), runner.checkFfmpeg()]);
  res.json({ ytDlp, ffmpeg });
});

// Lista los archivos que hay AHORA MISMO en la carpeta de Descargas --
// leyendo el directorio real cada vez, sin tabla ni cache (mismo
// criterio que routes/archivos.js).
router.get('/files', (req, res) => {
  let entries;
  try {
    entries = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true });
  } catch (err) {
    return res.json([]);
  }
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith('.') && !e.name.endsWith('.part'))
    .map((e) => {
      const stat = fs.statSync(path.join(DOWNLOADS_DIR, e.name));
      return { name: e.name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  res.json(files);
});

router.get('/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(DOWNLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.download(filePath, filename);
});

router.delete('/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(DOWNLOADS_DIR, filename);
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.status(204).end();
});

// Un unico listado de trabajos, usado tanto para la tabla como para el
// polling de progreso mientras la vista esta abierta -- el numero de
// trabajos siempre es pequeño en una app personal, no hace falta un
// endpoint aparte por job.
router.get('/jobs', (req, res) => {
  const rows = db.prepare('SELECT * FROM descargas_jobs ORDER BY id DESC LIMIT 50').all();
  res.json(rows.map(serializeJob));
});

router.post('/jobs', async (req, res) => {
  const { kind, url, mediaFormat, sourceFilename, targetFormat } = req.body || {};

  if (kind === 'download_generic') {
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'invalid_request', message: 'Falta la URL a descargar.' });
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocolo no valido');
    } catch (err) {
      return res.status(400).json({ error: 'invalid_url', message: 'Esa URL no es valida.' });
    }
    const info = db
      .prepare("INSERT INTO descargas_jobs (kind, source_url) VALUES ('download_generic', ?)")
      .run(url);
    runner.enqueueJob(Number(info.lastInsertRowid));
    return res.status(201).json(serializeJob(db.prepare('SELECT * FROM descargas_jobs WHERE id = ?').get(info.lastInsertRowid)));
  }

  if (kind === 'download_media') {
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'invalid_request', message: 'Falta la URL a descargar.' });
    }
    const format = mediaFormat === 'audio' ? 'audio' : 'video';
    const availability = await runner.checkYtDlp();
    if (!availability.available) {
      return res.status(400).json({
        error: 'binary_missing',
        message: 'yt-dlp no esta instalado en este ordenador -- ver README.md para instalarlo.',
      });
    }
    const info = db
      .prepare("INSERT INTO descargas_jobs (kind, source_url, media_format) VALUES ('download_media', ?, ?)")
      .run(url, format);
    runner.enqueueJob(Number(info.lastInsertRowid));
    return res.status(201).json(serializeJob(db.prepare('SELECT * FROM descargas_jobs WHERE id = ?').get(info.lastInsertRowid)));
  }

  if (kind === 'convert') {
    const safeSource = path.basename(String(sourceFilename || ''));
    if (!safeSource || !fs.existsSync(path.join(DOWNLOADS_DIR, safeSource))) {
      return res.status(400).json({ error: 'invalid_request', message: 'Elige un archivo ya descargado.' });
    }
    if (!CONVERT_TARGET_FORMATS.includes(targetFormat)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Formato de destino no admitido.' });
    }
    const availability = await runner.checkFfmpeg();
    if (!availability.available) {
      return res.status(400).json({
        error: 'binary_missing',
        message: 'ffmpeg no esta instalado en este ordenador -- ver README.md para instalarlo.',
      });
    }
    const info = db
      .prepare("INSERT INTO descargas_jobs (kind, source_filename, target_format) VALUES ('convert', ?, ?)")
      .run(safeSource, targetFormat);
    runner.enqueueJob(Number(info.lastInsertRowid));
    return res.status(201).json(serializeJob(db.prepare('SELECT * FROM descargas_jobs WHERE id = ?').get(info.lastInsertRowid)));
  }

  return res.status(400).json({ error: 'invalid_request', message: 'Tipo de trabajo no reconocido.' });
});

router.post('/jobs/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM descargas_jobs WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  runner.cancelJob(id);
  res.json(serializeJob(db.prepare('SELECT * FROM descargas_jobs WHERE id = ?').get(id)));
});

// Borra solo la fila del historial -- nunca el archivo de salida (eso es
// DELETE /files/:filename, una accion aparte). Un trabajo activo hay que
// cancelarlo antes, para no perder de vista un proceso que sigue vivo.
router.delete('/jobs/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM descargas_jobs WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status === 'queued' || row.status === 'running') {
    return res.status(400).json({ error: 'job_active', message: 'Cancela el trabajo antes de borrarlo.' });
  }
  db.prepare('DELETE FROM descargas_jobs WHERE id = ?').run(id);
  res.status(204).end();
});

module.exports = router;
