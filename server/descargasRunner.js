// descargasRunner.js — cola de trabajos de la extension "Descargas".
// Primera vez en todo el proyecto que se usa child_process (yt-dlp para
// video/audio, ffmpeg/ffprobe para convertir formato) -- por eso NO
// encaja en el patron de "checker" periodico ya establecido
// (reminderChecker.js/finanzasRecurringChecker.js, un setInterval que
// revisa algo cada X tiempo): aqui cada trabajo lo dispara una
// peticion (POST /api/descargas/jobs), no un reloj. Cola secuencial
// simple en memoria (un solo trabajo activo a la vez, suficiente para
// una app personal) que va actualizando su fila en `descargas_jobs`
// segun avanza.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const db = require('./db');
const DATA_DIR = require('./dataDir');

const DOWNLOADS_DIR = path.join(DATA_DIR, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// Si el servidor se reinicio (o se cayo) con algun trabajo a medias, esa
// fila se habria quedado "running"/"queued" para siempre sin que nadie
// la retomara (la cola en memoria es nueva en cada arranque). Se marca
// como error con un mensaje claro en vez de dejarla "colgada".
db.prepare(
  "UPDATE descargas_jobs SET status = 'error', error_message = 'Interrumpido por un reinicio del servidor.', finished_at = datetime('now') WHERE status IN ('queued', 'running')"
).run();

const pendingQueue = [];
let currentJob = null; // { id, kind, cancel: fn|null }

function enqueueJob(id) {
  pendingQueue.push(id);
  processQueueIfIdle();
}

// Quita un trabajo de la cola (si todavia no habia arrancado) o mata su
// proceso en curso (si ya estaba corriendo). Sin cambios si ya termino.
function cancelJob(id) {
  const idx = pendingQueue.indexOf(id);
  if (idx !== -1) {
    pendingQueue.splice(idx, 1);
    db.prepare("UPDATE descargas_jobs SET status = 'cancelled', finished_at = datetime('now') WHERE id = ? AND status = 'queued'").run(id);
    return true;
  }
  if (currentJob && currentJob.id === id) {
    if (currentJob.cancel) currentJob.cancel();
    return true;
  }
  return false;
}

function processQueueIfIdle() {
  if (currentJob) return; // ya hay uno en marcha, este espera su turno
  const id = pendingQueue.shift();
  if (id === undefined) return;
  const row = db.prepare('SELECT * FROM descargas_jobs WHERE id = ?').get(id);
  if (!row || row.status !== 'queued') {
    processQueueIfIdle(); // se cancelo/desaparecio entre medias, sigue con el siguiente
    return;
  }
  db.prepare("UPDATE descargas_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?").run(id);
  currentJob = { id, kind: row.kind, cancel: null };
  runJob(row);
}

function finishJob(id, status, { outputFilename, errorMessage } = {}) {
  if (status === 'done') {
    db.prepare(
      "UPDATE descargas_jobs SET status = ?, output_filename = ?, progress_percent = 100, finished_at = datetime('now') WHERE id = ?"
    ).run(status, outputFilename || null, id);
  } else {
    db.prepare(
      "UPDATE descargas_jobs SET status = ?, error_message = ?, finished_at = datetime('now') WHERE id = ?"
    ).run(status, errorMessage || null, id);
  }
}

// Escribir el progreso en cada linea de stdout/stderr machacaria SQLite
// sin necesidad -- como mucho una vez cada medio segundo.
function makeProgressUpdater(id) {
  let last = 0;
  return (percent) => {
    const now = Date.now();
    if (now - last < 500) return;
    last = now;
    const clamped = Math.min(99, Math.max(0, percent));
    db.prepare('UPDATE descargas_jobs SET progress_percent = ? WHERE id = ?').run(clamped, id);
  };
}

async function runJob(row) {
  const id = row.id;
  const updateProgress = makeProgressUpdater(id);
  try {
    let result;
    if (row.kind === 'download_generic') result = await runDownloadGeneric(row.source_url, updateProgress);
    else if (row.kind === 'download_media') result = await runDownloadMedia(row.source_url, row.media_format, updateProgress);
    else if (row.kind === 'convert') result = await runConvert(row.source_filename, row.target_format, updateProgress);
    else throw new Error('Tipo de trabajo desconocido.');
    finishJob(id, 'done', { outputFilename: result.outputFilename });
  } catch (err) {
    if (err && err.cancelled) {
      finishJob(id, 'cancelled', {});
    } else {
      const message = String((err && err.message) || err || 'Error desconocido.').slice(0, 4000);
      finishJob(id, 'error', { errorMessage: message });
    }
  } finally {
    currentJob = null;
    processQueueIfIdle();
  }
}

// --- Ayudantes compartidos ----------------------------------------------

// Mismo criterio que ya usa routes/archivos.js al subir un archivo: si
// el nombre ya existe, se anade un sufijo numerico en vez de sobrescribir.
function pickCollisionSafeName(folder, name) {
  const ext = path.extname(name);
  const base = (name.slice(0, name.length - ext.length) || 'descarga').replace(/[/\\:*?"<>|]/g, '_').slice(0, 150);
  let finalName = `${base}${ext}`;
  let counter = 1;
  while (fs.existsSync(path.join(folder, finalName))) {
    finalName = `${base} (${counter})${ext}`;
    counter += 1;
  }
  return finalName;
}

function guessFilenameFromUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const base = path.basename(decodeURIComponent(parsed.pathname));
    const cleaned = base.replace(/[/\\:*?"<>|]/g, '_').slice(0, 200);
    return cleaned || 'descarga';
  } catch (err) {
    return 'descarga';
  }
}

// --- download_generic: cualquier URL, sin binarios externos -------------
// Sigue redirecciones (301/302/303/307/308) a mano -- sin esto, la
// mayoria de enlaces de descarga reales (CDNs, releases de GitHub,
// Google Drive...) no funcionarian, casi todos redirigen al menos una vez.
function httpGetFollowingRedirects(urlStr, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      return reject(new Error('La URL no es valida.'));
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error('Solo se admiten URLs http/https.'));
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); // descarta el cuerpo de la redireccion, no hace falta
        if (redirectsLeft <= 0) return reject(new Error('Demasiadas redirecciones.'));
        const nextUrl = new URL(res.headers.location, parsed).toString();
        resolve(httpGetFollowingRedirects(nextUrl, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`El servidor respondio ${res.statusCode}.`));
      }
      resolve({ res, req, finalUrl: parsed.toString() });
    });
    req.on('error', reject);
  });
}

function runDownloadGeneric(url, updateProgress) {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    let activeReq = null;
    currentJob.cancel = () => {
      cancelled = true;
      if (activeReq) activeReq.destroy();
    };

    httpGetFollowingRedirects(url)
      .then(({ res, req, finalUrl }) => {
        activeReq = req;
        if (cancelled) {
          req.destroy();
          return;
        }
        const contentLength = Number(res.headers['content-length']) || 0;
        const finalName = pickCollisionSafeName(DOWNLOADS_DIR, guessFilenameFromUrl(finalUrl));
        const partPath = path.join(DOWNLOADS_DIR, `${finalName}.part`);
        const finalPath = path.join(DOWNLOADS_DIR, finalName);
        const out = fs.createWriteStream(partPath);
        let received = 0;
        let settled = false;

        function cleanupPart() {
          fs.unlink(partPath, () => {});
        }
        function settle(fn) {
          if (settled) return;
          settled = true;
          fn();
        }

        res.on('data', (chunk) => {
          received += chunk.length;
          if (contentLength) updateProgress((received / contentLength) * 100);
        });
        // Al cancelar (req.destroy()), quien emite 'error' primero puede
        // ser "res" o "req" segun la version de Node -- los dos manejadores
        // comprueban "cancelled" en vez de asumir que solo uno de los dos
        // se dispara.
        function handleStreamError() {
          out.destroy();
          cleanupPart();
          if (cancelled) {
            const err = new Error('Cancelado.');
            err.cancelled = true;
            settle(() => reject(err));
          } else {
            settle(() => reject(new Error('Se perdio la conexion durante la descarga.')));
          }
        }
        res.on('error', handleStreamError);
        req.on('error', handleStreamError);
        out.on('error', (err) => {
          settle(() => reject(err));
        });
        out.on('finish', () => {
          if (cancelled) {
            cleanupPart();
            const err = new Error('Cancelado.');
            err.cancelled = true;
            return settle(() => reject(err));
          }
          fs.renameSync(partPath, finalPath);
          settle(() => resolve({ outputFilename: finalName }));
        });
        res.pipe(out);
      })
      .catch(reject);
  });
}

// --- download_media: video/audio via yt-dlp ------------------------------
function runDownloadMedia(url, mediaFormat, updateProgress) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s');
    // "--print after_move:filepath" hace que yt-dlp imprima la ruta final
    // real ya escrita en disco -- mas fiable que intentar adivinarla desde
    // la plantilla -o, ya que el titulo se sanea de formas que no siempre
    // coinciden con lo esperado.
    const formatArgs =
      mediaFormat === 'audio'
        ? ['-f', 'bestaudio', '-x', '--audio-format', 'mp3']
        : ['-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4'];
    const args = ['--newline', ...formatArgs, '-o', outputTemplate, '--print', 'after_move:filepath', url];
    const child = spawn('yt-dlp', args);

    let cancelled = false;
    currentJob.cancel = () => {
      cancelled = true;
      child.kill('SIGTERM');
    };

    let outputPath = '';
    let stdoutBuffer = '';
    let stderrTail = [];

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // linea incompleta, se queda para el siguiente trozo
      for (const line of lines) {
        const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (match) {
          updateProgress(parseFloat(match[1]));
          continue;
        }
        const trimmed = line.trim();
        // Cualquier linea que no sea de progreso ni este vacia es
        // candidata a ser la ruta final que imprime --print.
        if (trimmed && !trimmed.startsWith('[')) outputPath = trimmed;
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrTail.push(chunk.toString());
      if (stderrTail.length > 40) stderrTail.shift();
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error('yt-dlp no esta instalado en este ordenador.'));
      else reject(err);
    });
    child.on('close', (code) => {
      if (cancelled) {
        const err = new Error('Cancelado.');
        err.cancelled = true;
        return reject(err);
      }
      if (code !== 0) {
        return reject(new Error(stderrTail.join('').slice(-4000) || `yt-dlp termino con codigo ${code}.`));
      }
      if (!outputPath) {
        return reject(new Error('yt-dlp termino pero no se pudo determinar el archivo final.'));
      }
      resolve({ outputFilename: path.basename(outputPath) });
    });
  });
}

// --- convert: ffmpeg (con ffprobe primero, para saber la duracion) ------
// Mapa formato pedido -> nombre de "-f" de ffmpeg (la mayoria coincide con
// la extension, salvo mkv/m4a). Se exporta como CONVERT_TARGET_FORMATS
// para que routes/descargas.js valide contra esta MISMA lista, en vez de
// mantener dos listas que se puedan desincronizar.
const FFMPEG_FORMAT_BY_EXT = {
  mp4: 'mp4',
  mkv: 'matroska',
  webm: 'webm',
  mp3: 'mp3',
  wav: 'wav',
  ogg: 'ogg',
  m4a: 'ipod',
  gif: 'gif',
  avi: 'avi',
};

function probeDurationSeconds(inputPath) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', inputPath]);
    } catch (err) {
      return resolve(0);
    }
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    // Sin ffprobe (o si falla) simplemente no hay porcentaje fiable --
    // el trabajo sigue igual, solo sin barra de progreso hasta terminar.
    child.on('error', () => resolve(0));
    child.on('close', () => {
      try {
        const parsed = JSON.parse(out);
        resolve(Number(parsed.format && parsed.format.duration) || 0);
      } catch (err) {
        resolve(0);
      }
    });
  });
}

async function runConvert(sourceFilename, targetFormat, updateProgress) {
  const safeSource = path.basename(sourceFilename || '');
  const inputPath = path.join(DOWNLOADS_DIR, safeSource);
  if (!safeSource || !fs.existsSync(inputPath)) {
    throw new Error('El archivo de origen ya no existe.');
  }
  const ffmpegFormat = FFMPEG_FORMAT_BY_EXT[targetFormat];
  if (!ffmpegFormat) throw new Error('Formato de destino no admitido.');

  const ext = path.extname(safeSource);
  const base = safeSource.slice(0, safeSource.length - ext.length) || safeSource;
  const outputName = pickCollisionSafeName(DOWNLOADS_DIR, `${base}.${targetFormat}`);
  const outputPath = path.join(DOWNLOADS_DIR, outputName);

  const durationSeconds = await probeDurationSeconds(inputPath);

  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', '-i', inputPath, '-f', ffmpegFormat, outputPath]);
    let cancelled = false;
    currentJob.cancel = () => {
      cancelled = true;
      child.kill('SIGTERM');
    };
    let stderrTail = [];

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail.push(text);
      if (stderrTail.length > 40) stderrTail.shift();
      if (durationSeconds > 0) {
        const match = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (match) {
          const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
          updateProgress((seconds / durationSeconds) * 100);
        }
      }
    });
    child.on('error', (err) => {
      fs.unlink(outputPath, () => {});
      if (err.code === 'ENOENT') reject(new Error('ffmpeg no esta instalado en este ordenador.'));
      else reject(err);
    });
    child.on('close', (code) => {
      if (cancelled) {
        fs.unlink(outputPath, () => {});
        const err = new Error('Cancelado.');
        err.cancelled = true;
        return reject(err);
      }
      if (code !== 0) {
        fs.unlink(outputPath, () => {});
        return reject(new Error(stderrTail.join('').slice(-4000) || `ffmpeg termino con codigo ${code}.`));
      }
      resolve({ outputFilename: outputName });
    });
  });
}

// --- Disponibilidad de los binarios (para GET /tools) --------------------
function checkTool(bin, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args);
    } catch (err) {
      return resolve({ available: false });
    }
    let settled = false;
    child.on('error', () => {
      if (!settled) {
        settled = true;
        resolve({ available: false });
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        resolve({ available: code === 0 });
      }
    });
  });
}
function checkYtDlp() {
  return checkTool('yt-dlp', ['--version']);
}
function checkFfmpeg() {
  return checkTool('ffmpeg', ['-version']);
}

module.exports = {
  DOWNLOADS_DIR,
  enqueueJob,
  cancelJob,
  checkYtDlp,
  checkFfmpeg,
  CONVERT_TARGET_FORMATS: Object.keys(FFMPEG_FORMAT_BY_EXT),
};
