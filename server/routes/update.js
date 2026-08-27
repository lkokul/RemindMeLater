// routes/update.js — comprobar si hay una version mas nueva en GitHub (en
// la rama que ya tengas seguida con git) y, si quieres, traerla con
// "git pull" de verdad. Reutiliza el git YA CONFIGURADO en este ordenador
// (el mismo que usas a mano) en vez de llamar a la API de GitHub —
// no hace falta ningun token guardado en la app, ni saber si el
// repositorio es publico o privado: si "git pull" a mano te funciona,
// esto tambien.
//
// Instalar de verdad (POST /pull, que hace git pull) sigue exigiendo ser
// el ordenador de confianza (requireTrusted) — es una accion que toca el
// disco, un movil emparejado no deberia poder disparar un git pull en tu
// ordenador. GET /check es de solo lectura (numeros de version, nada que
// se ejecute), asi que un movil emparejado tambien puede pedirlo — se
// usa desde el apartado "Archivos" para avisar de una version nueva sin
// poder instalarla desde ahi.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { requireTrusted, requireDeviceOrTrusted } = require('../auth');

const router = express.Router();
const REPO_DIR = path.join(__dirname, '..', '..');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: REPO_DIR, timeout: 20000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').trim() || 'Fallo al ejecutar git.'));
      else resolve(stdout.trim());
    });
  });
}

function readLocalVersion() {
  const raw = fs.readFileSync(path.join(REPO_DIR, 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

// La rama no esta fija a mano: se lee cual tienes puesta AHORA MISMO en
// este checkout, asi que sigue funcionando aunque cambies de rama de
// trabajo (por ejemplo, cuando "main-wmqm2f" se fusione a main).
async function currentBranch() {
  return run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
}

// Info local para no ir perdido en Configuracion (version, rama, ultimo
// commit): a diferencia de /check, esto NO hace ningun git fetch (no
// habla con GitHub), solo lee lo que ya hay en el checkout de este
// ordenador — rapido y funciona sin internet. "commitDate" es la fecha
// del COMMIT (git no guarda cuando se hizo el push, eso no se puede
// saber sin preguntarle a GitHub).
router.get('/info', requireTrusted, async (req, res) => {
  try {
    const branch = await currentBranch();
    const commitHash = await run('git', ['rev-parse', '--short', 'HEAD']);
    const commitLog = await run('git', ['log', '-1', '--format=%s%n%ci']);
    const [commitMessage, commitDate] = commitLog.split('\n');
    res.json({
      version: readLocalVersion(),
      branch,
      commitHash,
      commitMessage,
      commitDate,
    });
  } catch (err) {
    res.status(500).json({ error: 'info_failed', message: err.message });
  }
});

router.get('/check', requireDeviceOrTrusted, async (req, res) => {
  try {
    const branch = await currentBranch();
    await run('git', ['fetch', 'origin', branch]);
    const remotePackageJson = await run('git', ['show', `origin/${branch}:package.json`]);
    const remoteVersion = JSON.parse(remotePackageJson).version;
    res.json({ currentVersion: readLocalVersion(), remoteVersion, branch });
  } catch (err) {
    res.status(500).json({ error: 'check_failed', message: err.message });
  }
});

router.post('/pull', requireTrusted, async (req, res) => {
  try {
    const branch = await currentBranch();
    const output = await run('git', ['pull', 'origin', branch]);
    res.json({ success: true, message: output, newVersion: readLocalVersion() });
  } catch (err) {
    // Nunca se fuerza ni se descarta nada — si hay un conflicto o cambios
    // locales sin guardar, git pull falla solo y aqui se devuelve el
    // motivo tal cual, para que se pueda resolver a mano.
    res.status(500).json({ error: 'pull_failed', message: err.message });
  }
});

module.exports = router;
