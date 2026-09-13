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

// --- Que tablas son de cada App ----------------------------------------
//
// Peticion de Koku (13/9/2026): "si hago una copia de seguridad, que
// muestre las apps para guardar en la copia, las inactivas por defecto
// iran desmarcadas". Para poder dejar una App fuera hay que saber que
// tablas son suyas.
//
// EL CALENDARIO NO SE PUEDE DEJAR FUERA, igual que no se puede apagar en
// la Tienda: es la pantalla con la que arranca la app. Va aqui de todas
// formas para tener el mapa completo en un solo sitio.
//
// LAS TABLAS QUE NO SALEN EN ESTA LISTA SON DE LA APP EN SI (temas,
// ajustes, perfil...) y viajan SIEMPRE. Es a proposito que se decida por
// omision: si algun dia aparece una tabla nueva y a nadie se le ocurre
// tocar este archivo, acaba DENTRO de la copia. Lo contrario -- que una
// tabla nueva se quedara fuera en silencio -- seria perder datos.
const BACKUP_TABLAS_POR_APP = {
  calendario: ['events', 'groups', 'special_days'],
  notes: ['notes', 'note_folders'],
  gym: ['gym_blocks', 'gym_block_cycle_days', 'gym_routines', 'gym_routine_exercises',
    'gym_exercises', 'gym_sessions', 'gym_sets'],
  finanzas: ['finanzas_accounts', 'finanzas_categories', 'finanzas_transactions',
    'finanzas_investment_transactions', 'finanzas_settings', 'finanzas_portfolios',
    'finanzas_assets', 'finanzas_asset_valuations', 'finanzas_recurring_expenses',
    'finanzas_goals', 'finanzas_goal_contributions', 'finanzas_debts'],
  lecturas: ['lecturas_sagas', 'lecturas_items'],
  viajes: ['viajes_trips', 'viajes_trip_countries', 'viajes_entries',
    'viajes_entry_attachments', 'viajes_entry_movements'],
};

// Las Apps que se pueden marcar/desmarcar, en el orden de la Tienda.
function backupAppsElegibles() {
  if (typeof APPS_DE_LA_TIENDA === 'undefined') {
    return [{ id: 'calendario', nombre: 'Calendario', fija: true }];
  }
  return APPS_DE_LA_TIENDA.map((a) => ({ id: a.id, nombre: a.nombre, fija: !!a.fija }));
}

function backupTablasDe(id) {
  return Object.prototype.hasOwnProperty.call(BACKUP_TABLAS_POR_APP, id)
    ? BACKUP_TABLAS_POR_APP[id]
    : [];
}

// Las columnas que tienen EN COMUN dos bases. Hace falta porque una
// copia puede venir de una version anterior de la app, con una columna
// menos (o con una que ya no existe). Copiando solo las comunes, la
// columna que falte se queda con su valor por defecto, que es justo lo
// que hace una migracion al añadirla.
function backupColumnasComunes(origen, destinoCols, tabla) {
  const cols = [];
  const res = origen.exec(`PRAGMA table_info(${tabla})`);
  if (!res || !res[0]) return cols;
  const iNombre = res[0].columns.indexOf('name');
  res[0].values.forEach((fila) => {
    const nombre = String(fila[iNombre]);
    if (destinoCols.includes(nombre)) cols.push(nombre);
  });
  return cols;
}

function backupColumnasDe(tabla) {
  const res = localDb.prepare(`PRAGMA table_info(${tabla})`).all();
  return res.map((c) => String(c.name));
}

// --- Exportar ----------------------------------------------------------
async function buildBackupJson(incluidas) {
  // Primero asegurarse de que lo ultimo escrito ya esta volcado -- si
  // no, la copia podria salir sin el cambio de hace un segundo.
  await flushLocalDb();

  const apps = backupAppsElegibles().map((a) => a.id);
  const dentro = Array.isArray(incluidas) ? incluidas.filter((id) => apps.includes(id)) : apps.slice();
  if (!dentro.includes('calendario')) dentro.push('calendario');
  const fuera = apps.filter((id) => !dentro.includes(id));

  let sqliteBytes = sqlDatabase.export();
  if (fuera.length > 0) {
    // Se trabaja sobre una COPIA abierta de los bytes, nunca sobre la
    // base viva: aqui se borran filas, y hacerlo en la de verdad seria
    // exactamente la perdida de datos que esto viene a evitar.
    const recorte = new sqlJsModule.Database(sqliteBytes);
    try {
      fuera.forEach((id) => backupTablasDe(id).forEach((tabla) => {
        // La tabla puede no existir si la copia se hace con una version
        // que todavia no la ha creado: se ignora y sigue.
        try { recorte.run(`DELETE FROM ${tabla}`); } catch { /* no existe */ }
      }));
      // VACUUM para que el archivo ADELGACE de verdad: sin el, SQLite se
      // queda con las paginas vacias y la copia pesaria lo mismo que si
      // no hubieras quitado nada.
      try { recorte.run('VACUUM'); } catch { /* no es critico */ }
      sqliteBytes = recorte.export();
    } finally {
      recorte.close();
    }
  }

  // Las fotos y las imagenes de las notas son de Notas: si Notas se
  // queda fuera, no tiene sentido cargar el archivo con sus megas.
  const assets = dentro.includes('notes') ? await assetGetAll() : [];
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
    // Que Apps trae. Una copia SIN este campo es de antes de la Tienda y
    // se trata como completa -- es lo que era.
    apps: dentro,
    sqliteBase64: backupBytesToBase64(sqliteBytes),
    assets: assets.map((a) => ({
      name: a.name,
      type: a.type || '',
      bytesBase64: backupBytesToBase64(new Uint8Array(a.bytes)),
    })),
    localStorage: ajustes,
  });
}

async function exportBackup(incluidas) {
  const json = await buildBackupJson(incluidas);
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

  // Que Apps trae la copia. Sin el campo `apps` es una copia de antes de
  // la Tienda, y esas eran SIEMPRE completas.
  const todas = backupAppsElegibles();
  const traidas = Array.isArray(datos.apps)
    ? todas.filter((a) => datos.apps.includes(a.id)).map((a) => a.id)
    : todas.map((a) => a.id);
  const ausentes = todas.filter((a) => !traidas.includes(a.id));
  const parcial = ausentes.length > 0;

  // AQUI ESTABA LA TRAMPA, y es lo que decide todo lo de abajo: si una
  // copia parcial se importara como siempre (sustituir el archivo
  // entero), importarla BORRARIA las Apps que no trae. O sea que dejar
  // Gimnasio fuera de una copia no seria "no guardarlo", seria "perderlo
  // la proxima vez que restaure". Por eso una copia parcial NO sustituye
  // la base: restaura tabla por tabla solo lo que trae, y lo que no
  // trae se queda exactamente como esta.
  const texto = parcial
    ? `Esta copia${cuando} trae ${traidas.map((id) => nombreDeAppDeCopia(id)).join(', ')}. Eso es lo que se sustituye. ${ausentes.map((a) => a.nombre).join(', ')} se queda${ausentes.length === 1 ? '' : 'n'} como está${ausentes.length === 1 ? '' : 'n'} ahora, sin tocar. No se puede deshacer.`
    : `Importar esta copia${cuando} SUSTITUYE todo lo que hay ahora en la app: calendario, notas, herramientas, fotos y ajustes. No se puede deshacer.`;
  const ok = await showAppConfirm(texto, { okText: 'Importar y sustituir', danger: true });
  if (!ok) return false;

  if (parcial) {
    await importarSoloEstasApps(bytes, traidas, datos);
    location.reload();
    return true;
  }

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

function nombreDeAppDeCopia(id) {
  const app = backupAppsElegibles().find((a) => a.id === id);
  return app ? app.nombre : id;
}

// Restaurar SOLO las Apps que trae una copia parcial, dejando el resto
// de la base como esta.
//
// Se hace al reves de lo que parece natural: en vez de meter lo que
// falta DENTRO de la base de la copia, se vacian y se rellenan las
// tablas de la base VIVA con lo que trae la copia. El motivo es el
// esquema: la base viva siempre esta al dia (applyLocalSchema corre en
// cada arranque), mientras que la de la copia puede ser de hace tres
// versiones y no tener ni la tabla que habria que rellenar.
async function importarSoloEstasApps(bytes, traidas, datos) {
  const origen = new sqlJsModule.Database(bytes);
  try {
    localDb.exec('BEGIN');
    try {
      traidas.forEach((id) => backupTablasDe(id).forEach((tabla) => {
        let columnasDestino;
        try { columnasDestino = backupColumnasDe(tabla); } catch { return; }
        if (columnasDestino.length === 0) return;   // no existe aqui
        const comunes = backupColumnasComunes(origen, columnasDestino, tabla);
        if (comunes.length === 0) return;           // no existe alla

        localDb.prepare(`DELETE FROM ${tabla}`).run();

        const lista = comunes.join(', ');
        const huecos = comunes.map(() => '?').join(', ');
        const insertar = localDb.prepare(`INSERT INTO ${tabla} (${lista}) VALUES (${huecos})`);
        const res = origen.exec(`SELECT ${lista} FROM ${tabla}`);
        if (!res || !res[0]) return;
        res[0].values.forEach((fila) => insertar.run(...fila));
      }));
      localDb.exec('COMMIT');
    } catch (err) {
      // Si algo falla a media restauracion, se deshace entera: media App
      // restaurada es peor que ninguna.
      try { localDb.exec('ROLLBACK'); } catch { /* ya estaba deshecha */ }
      throw err;
    }
  } finally {
    origen.close();
  }

  // Las imagenes de las notas solo se tocan si la copia trae Notas.
  if (traidas.includes('notes')) {
    await assetClear();
    for (const asset of datos.assets || []) {
      if (!asset || typeof asset.name !== 'string' || typeof asset.bytesBase64 !== 'string') continue;
      await assetPut(asset.name, backupBase64ToBytes(asset.bytesBase64), asset.type || '');
    }
  }

  // Los ajustes de este dispositivo SI se restauran enteros, como en una
  // copia completa: son preferencias (tema, unidades, que hay en la
  // barra), no datos de una App, y separarlas por App seria inventarse
  // un reparto que no existe.
  Object.entries(datos.localStorage || {}).forEach(([clave, valor]) => {
    if (typeof valor === 'string') localStorage.setItem(clave, valor);
  });

  await flushLocalDb();
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
// --- El dialogo de "que guardamos" -------------------------------------
// Se abre ANTES de exportar. Las casillas son .styled-checkbox (el
// cuadrado de "elige uno o varios de una lista"); .checkbox-row es otra
// cosa, el interruptor de un ajuste on/off.
function abrirDialogoDeAppsDeLaCopia() {
  const modal = document.getElementById('backup-apps-modal');
  const lista = document.getElementById('backup-apps-list');
  if (!modal || !lista) return;
  lista.innerHTML = '';

  backupAppsElegibles().forEach((app) => {
    const fila = document.createElement('label');
    fila.className = 'backup-app-row';
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.className = 'styled-checkbox';
    casilla.dataset.appId = app.id;
    // De fabrica viene marcada si la App esta ENCENDIDA en la Tienda,
    // tal como lo pidio: "las inactivas por defecto iran desmarcadas".
    // Desmarcada no es lo mismo que apagada: puedes guardar una App que
    // tienes apagada, o dejar fuera una que usas.
    const activa = typeof appEstaActiva === 'function' ? appEstaActiva(app.id) : true;
    casilla.checked = app.fija || activa;
    // El Calendario no se puede dejar fuera, igual que no se puede
    // apagar en la Tienda.
    if (app.fija) casilla.disabled = true;
    const nombre = document.createElement('span');
    nombre.textContent = app.fija ? `${app.nombre} (siempre)` : app.nombre;
    fila.appendChild(casilla);
    fila.appendChild(nombre);
    lista.appendChild(fila);
  });

  const aviso = document.getElementById('backup-apps-aviso');
  if (aviso) {
    aviso.textContent = 'Al restaurar esta copia solo se sustituye lo que traiga: lo que dejes fuera se quedará como esté en ese momento.';
  }
  modal.classList.remove('hidden');
}

function cerrarDialogoDeAppsDeLaCopia() {
  document.getElementById('backup-apps-modal').classList.add('hidden');
}

function appsMarcadasParaLaCopia() {
  return [...document.querySelectorAll('#backup-apps-list input[data-app-id]')]
    .filter((c) => c.checked)
    .map((c) => c.dataset.appId);
}

document.getElementById('btn-backup-export').addEventListener('click', () => {
  abrirDialogoDeAppsDeLaCopia();
});
document.getElementById('btn-close-backup-apps').addEventListener('click', cerrarDialogoDeAppsDeLaCopia);
document.getElementById('btn-backup-apps-cancel').addEventListener('click', cerrarDialogoDeAppsDeLaCopia);

document.getElementById('btn-backup-apps-ok').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const incluidas = appsMarcadasParaLaCopia();
  btn.disabled = true;
  btn.textContent = 'Preparando…';
  try {
    await exportBackup(incluidas);
    cerrarDialogoDeAppsDeLaCopia();
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
    btn.textContent = 'Crear la copia';
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
