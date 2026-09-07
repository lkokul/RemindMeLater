// backup.js — copia de seguridad de TODO lo que vive en este dispositivo.
//
// Sin servidor, los unicos datos que existen son los de la propia app:
// si se borra la app (o falla el telefono), se pierde todo. Esta es la
// red de seguridad: un unico archivo .json que contiene la base de
// datos SQLite entera, todas las imagenes/fotos, y los ajustes locales
// (localStorage). Exportar lo manda por la hoja de compartir del
// sistema (guardar en Archivos, iCloud/Drive, mandartelo por
// mensaje...); importar lo restaura TODO, sustituyendo lo que hubiera.
//
// Decisiones tomadas con Koku en esta ronda:
// - Manual + recordatorio: la copia se hace a mano, y si pasan ~30 dias
//   sin hacer ninguna, un aviso discreto al abrir la app lo recuerda.
// - Todo, con fotos: las imagenes van dentro del archivo (en base64),
//   aunque lo engorde -- una copia sin las fotos no es una copia.
// - Nota a futuro: cuando la app de escritorio y esta lleguen a la
//   version 1, la idea es que se puedan comunicar para pasar la copia
//   al ordenador directamente (apuntado en CLAUDE.md, sin disenar aun).

// El formato del archivo. "version" permite cambiar el formato en el
// futuro sin romper copias viejas; la base SQLite en si ya migra sola
// al importarla (applyLocalSchema corre en cada arranque), asi que una
// copia hecha con una version anterior de la app se abre igual.
const BACKUP_FORMAT_VERSION = 1;
const BACKUP_REMINDER_DAYS = 30;
// Si se cierra el aviso con la X sin hacer copia, no reaparece hasta
// pasados unos dias -- recordar sin ser un pesado.
const BACKUP_SNOOZE_DAYS = 7;

// --- Plugins nativos (hoja de compartir) -------------------------------
// Mismo patron que local-notifications.js: sin bundler, los plugins hay
// que registrarlos a mano, de forma perezosa y solo en la app nativa.
// En un navegador normal no existen, y exportar cae a una descarga.
let filesystemPlugin = null;
let sharePlugin = null;

function getBackupNativePlugins() {
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  if (!window.capacitorExports || typeof window.capacitorExports.registerPlugin !== 'function') return null;
  if (!filesystemPlugin) filesystemPlugin = window.capacitorExports.registerPlugin('Filesystem');
  if (!sharePlugin) sharePlugin = window.capacitorExports.registerPlugin('Share');
  return { filesystem: filesystemPlugin, share: sharePlugin };
}

// --- Bytes <-> base64 --------------------------------------------------
// JSON no puede llevar bytes tal cual, asi que la base de datos y cada
// imagen viajan en base64. Se convierte por trozos: pasarle a
// String.fromCharCode un array de varios megas de golpe revienta la
// pila de llamadas del navegador.
function backupBytesToBase64(bytes) {
  let binario = '';
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
}

function backupBase64ToBytes(b64) {
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// --- Exportar ----------------------------------------------------------
async function buildBackupJson() {
  // Primero asegurarse de que lo ultimo escrito ya esta volcado -- si
  // no, la copia podria salir sin el cambio de hace un segundo.
  await flushLocalDb();
  const sqliteBytes = sqlDatabase.export();

  const assets = await assetGetAll();
  const ajustes = {};
  for (let i = 0; i < localStorage.length; i++) {
    const clave = localStorage.key(i);
    ajustes[clave] = localStorage.getItem(clave);
  }

  return JSON.stringify({
    app: 'RemindMeLater',
    kind: 'backup',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sqliteBase64: backupBytesToBase64(sqliteBytes),
    assets: assets.map((a) => ({
      name: a.name,
      type: a.type || '',
      bytesBase64: backupBytesToBase64(new Uint8Array(a.bytes)),
    })),
    localStorage: ajustes,
  });
}

async function exportBackup() {
  const json = await buildBackupJson();
  const fecha = new Date().toISOString().slice(0, 10);
  const nombre = `remindmelater-copia-${fecha}.json`;

  const plugins = getBackupNativePlugins();
  if (plugins) {
    // App nativa: se escribe el archivo a la cache de la app (una zona
    // temporal, no hace falta permiso) y se abre la hoja de compartir
    // del sistema con el. Filesystem.writeFile sin "encoding" espera
    // los bytes en base64 -- el JSON se pasa por UTF-8 primero para no
    // perder tildes.
    const escrito = await plugins.filesystem.writeFile({
      path: nombre,
      data: backupBytesToBase64(new TextEncoder().encode(json)),
      directory: 'CACHE',
    });
    // Si se cancela la hoja de compartir, share() rechaza -- el que
    // llama lo trata como "no se hizo copia" (no se apunta la fecha).
    await plugins.share.share({ title: nombre, files: [escrito.uri] });
  } else {
    // Navegador normal: descarga clasica.
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  localStorage.setItem('lastBackupAt', String(Date.now()));
  hideBackupReminderBanner();
}

// --- Importar ----------------------------------------------------------
// Devuelve true si llego a restaurar (y entonces la pagina se recarga
// sola); false si el usuario cancelo. Lanza si el archivo no vale.
async function importBackupFromFile(file) {
  let datos;
  try {
    datos = JSON.parse(await file.text());
  } catch (err) {
    throw new Error('Ese archivo no es una copia de seguridad de RemindMeLater.');
  }
  if (!datos || datos.app !== 'RemindMeLater' || datos.kind !== 'backup'
    || typeof datos.sqliteBase64 !== 'string') {
    throw new Error('Ese archivo no es una copia de seguridad de RemindMeLater.');
  }

  const bytes = backupBase64ToBytes(datos.sqliteBase64);
  // Antes de borrar nada: comprobar que los bytes son de verdad una
  // base SQLite legible. Si el archivo llego corrupto, mejor enterarse
  // ahora, con los datos actuales todavia intactos.
  try {
    const prueba = new sqlJsModule.Database(bytes);
    prueba.close();
  } catch (err) {
    throw new Error('La copia parece dañada: no se pudo leer su base de datos. No se ha tocado nada.');
  }

  const cuando = datos.exportedAt ? ` (del ${String(datos.exportedAt).slice(0, 10)})` : '';
  const ok = await showAppConfirm(
    `Importar esta copia${cuando} SUSTITUYE todo lo que hay ahora en la app: calendario, notas, herramientas, fotos y ajustes. No se puede deshacer.`,
    { okText: 'Importar y sustituir', danger: true },
  );
  if (!ok) return false;

  // A partir de aqui es destructivo. Orden pensado para que ningun
  // volcado automatico pise lo importado: se corta primero la base en
  // memoria (saveLocalDbNow no hace nada sin sqlDatabase, asi que ni el
  // temporizador pendiente ni el volcado de "al ocultarse la pagina"
  // pueden sobreescribir los bytes nuevos), y solo entonces se escriben.
  await flushLocalDb();
  if (sqlDatabase) sqlDatabase.close();
  sqlDatabase = null;
  await metaSet(LOCAL_SQLITE_META_KEY, bytes);

  await assetClear();
  for (const asset of datos.assets || []) {
    if (!asset || typeof asset.name !== 'string' || typeof asset.bytesBase64 !== 'string') continue;
    await assetPut(asset.name, backupBase64ToBytes(asset.bytesBase64), asset.type || '');
  }

  // Los ajustes locales de la copia se restauran encima de los actuales
  // (solo las claves que trae el archivo -- no se vacia localStorage,
  // por si esta version de la app usa claves que la copia no conocia).
  Object.entries(datos.localStorage || {}).forEach(([clave, valor]) => {
    if (typeof valor === 'string') localStorage.setItem(clave, valor);
  });

  // Recargar es la forma mas honesta de arrancar sobre los datos
  // nuevos: initLocalDatabase() los leera de IndexedDB y les aplicara
  // las migraciones que falten (una copia de una version anterior de la
  // app se pone al dia sola, igual que en cualquier arranque).
  location.reload();
  return true;
}

// --- Aviso de "hace mucho que no haces copia" --------------------------
function hideBackupReminderBanner() {
  const banner = document.getElementById('backup-reminder-banner');
  if (banner) banner.classList.add('hidden');
}

function maybeShowBackupReminder() {
  const banner = document.getElementById('backup-reminder-banner');
  if (!banner) return;
  const ahora = Date.now();
  const DIA = 24 * 60 * 60 * 1000;

  // Si nunca se ha hecho copia, se cuenta desde la primera vez que se
  // abrio la app con esta funcion ya presente -- asi el aviso no sale
  // el primer dia, sale cuando de verdad hay un mes de datos en juego.
  const ultima = Number(localStorage.getItem('lastBackupAt') || 0);
  let base = ultima;
  if (!base) {
    base = Number(localStorage.getItem('backupFirstOpenAt') || 0);
    if (!base) {
      base = ahora;
      localStorage.setItem('backupFirstOpenAt', String(base));
    }
  }
  if (ahora - base < BACKUP_REMINDER_DAYS * DIA) return;

  const pospuesto = Number(localStorage.getItem('backupReminderSnoozedAt') || 0);
  if (ahora - pospuesto < BACKUP_SNOOZE_DAYS * DIA) return;

  document.getElementById('backup-reminder-text').textContent = ultima
    ? 'Hace más de un mes de tu última copia de seguridad.'
    : 'Todavía no has hecho ninguna copia de seguridad.';
  banner.classList.remove('hidden');
}

// --- La linea de estado en Configuracion > Este dispositivo ------------
function refreshBackupStatusLine() {
  const linea = document.getElementById('backup-status');
  if (!linea) return;
  const ultima = Number(localStorage.getItem('lastBackupAt') || 0);
  if (!ultima) {
    linea.textContent = 'Todavía no has hecho ninguna copia.';
    return;
  }
  const fecha = new Date(ultima);
  linea.textContent = `Última copia: ${fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
}

// --- Cableado ----------------------------------------------------------
// Los elementos ya existen (los scripts van al final del body). Las
// funciones de otros archivos (showAppConfirm/showAppAlert en app.js,
// openSettingsModal/showSettingsScreen en settings.js) solo se llaman
// DENTRO de manejadores, nunca al cargar -- ver la regla de orden de
// declaracion en CLAUDE.md.
document.getElementById('btn-backup-export').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Preparando…';
  try {
    await exportBackup();
    refreshBackupStatusLine();
  } catch (err) {
    // Cancelar la hoja de compartir tambien cae aqui: no es un error de
    // verdad, simplemente no se hizo la copia. Solo se avisa si parece
    // un fallo real (mensaje que no suene a cancelacion).
    const msg = String((err && err.message) || err || '');
    if (!/cancel/i.test(msg)) {
      console.error('No se pudo exportar la copia:', err);
      showAppAlert('No se pudo crear la copia de seguridad. Inténtalo de nuevo.');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Exportar copia';
  }
});

document.getElementById('btn-backup-import').addEventListener('click', () => {
  document.getElementById('backup-import-input').click();
});

document.getElementById('backup-import-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  // Permite volver a elegir el mismo archivo si se cancela el aviso.
  e.target.value = '';
  if (!file) return;
  try {
    await importBackupFromFile(file);
  } catch (err) {
    showAppAlert(String((err && err.message) || 'No se pudo importar esa copia.'));
  }
});

document.getElementById('backup-reminder-text').addEventListener('click', () => {
  hideBackupReminderBanner();
  openSettingsModal();
  showSettingsScreen('mobile');
  refreshMobileTab();
});

document.getElementById('btn-backup-reminder-close').addEventListener('click', () => {
  localStorage.setItem('backupReminderSnoozedAt', String(Date.now()));
  hideBackupReminderBanner();
});
