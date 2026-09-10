// widget-bridge.js — lo que la app le cuenta a los widgets de iOS.
//
// SON CINCO WIDGETS y UN SOLO resumen: Gimnasio ("Qué toca hoy"),
// Tareas, Finanzas, Lecturas y Viajes. Se manda todo junto en un único
// JSON a propósito -- son unos pocos cientos de bytes, y partirlo en
// cinco claves obligaría a cinco escrituras, cinco avisos a iOS y cinco
// sitios donde equivocarse con el nombre de la clave.
//
// (Hubo un sexto, el del Calendario. Koku lo quitó tras probarlo: "el
// widget de hoy no es necesario". Se fue entero, también su sección de
// aquí y su botón del centro de control.)
//
// EL PROBLEMA QUE RESUELVE: un widget no puede leer la base de datos.
// Nuestra base es SQLite compilado a WebAssembly y vive dentro de la
// webview, en IndexedDB; el widget es código nativo aparte que iOS
// ejecuta cuando la app ni siquiera está abierta, así que no tiene forma
// de llegar hasta ahí.
//
// La solución es un buzón compartido (App Group): la app deja un resumen
// pequeño en JSON y el widget lo lee. Este archivo es quien prepara ese
// resumen y lo manda al plugin nativo (WidgetBridgePlugin.swift).
//
// En un navegador normal el plugin no existe y todo esto es no-op, igual
// que local-notifications.js.
//
// NO HAY REFRESCO POR HORAS (decisión de Koku): el widget no se repinta
// solo, lo repinta la app cuando cambia algo. Por eso importa llamar a
// actualizarWidgetDelDia() en los sitios donde ese "algo" ocurre, que
// están marcados en app.js.

// Mismo patrón perezoso que el resto de plugins locales: se registra una
// sola vez, y no al cargar el archivo (el puente nativo puede no estar
// listo todavía).
let widgetBridgePlugin = null;
let widgetBridgeNoDisponible = false;

function getWidgetBridgePlugin() {
  if (widgetBridgePlugin) return widgetBridgePlugin;
  if (widgetBridgeNoDisponible) return null;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) {
    widgetBridgeNoDisponible = true;
    return null;
  }
  if (cap.Plugins && cap.Plugins.WidgetBridge) {
    widgetBridgePlugin = cap.Plugins.WidgetBridge;
  } else if (window.capacitorExports && typeof window.capacitorExports.registerPlugin === 'function') {
    widgetBridgePlugin = window.capacitorExports.registerPlugin('WidgetBridge');
  } else {
    widgetBridgeNoDisponible = true;
  }
  return widgetBridgePlugin;
}

// El resumen que se manda. Cada sección sale de la MISMA fuente que usa
// la pantalla correspondiente, para que el widget no pueda decir una cosa
// distinta de lo que ves al abrir la app.
//
// Es ASÍNCRONA porque las secciones nuevas preguntan a la base (`api()`),
// que es el mismo router local de siempre. La del Gimnasio no: esa sale
// de gymCicloDeHoy(), que trabaja sobre lo ya cargado en memoria.
//
// Los colores viajan en hexadecimal porque el widget no tiene acceso a
// las variables CSS del tema: es SwiftUI, no la webview.
async function construirResumenDelDia() {
  const resumen = {
    // Cuándo se escribió. El widget lo enseña cuando los datos son de
    // otro día, que es la forma honesta de decir "esto puede estar
    // viejo" en vez de fingir que está al día.
    actualizado: Date.now(),
    acento: gymAcentoParaElWidget(),
    // Los colores del TEMA para que el widget no vaya por libre.
    // Koku: "no sigue demasiado el tema de la app, antes estaba en claro,
    // pero el sistema está en modo oscuro". Sin esto el widget seguía el
    // modo claro/oscuro del SISTEMA y podía salir oscuro al lado de una
    // app en claro.
    //
    // Se manda --surface y su texto emparejado, no --bg: un widget es una
    // TARJETA, y en la app las tarjetas son surface. Cada fondo de la app
    // lleva su color de contraste emparejado, así que estos dos siempre se
    // leen bien juntos, sea cual sea el tema.
    //
    // De respaldo va la CADENA VACÍA, no un blanco o un negro: si el tema
    // todavía no está puesto, mandar un blanco fijo dejaría el widget
    // blanco al lado de una app oscura, que es PEOR que no hacer nada.
    // Con el hueco vacío el widget se pinta con el material del sistema,
    // como hacía antes.
    fondo: colorDelTemaParaElWidget('--surface', ''),
    texto: colorDelTemaParaElWidget('--surface-text', ''),
    // Cuál de las tres combinaciones quiere Koku (Configuración >
    // Widgets): 'app', 'sistema' o 'mixto'. Va DENTRO del resumen y no en
    // un ajuste nativo aparte, para que cambiarlo no obligue a tocar
    // Swift ni a que el widget lea dos sitios.
    estiloWidget: estiloDeWidgetElegido(),
    // Las dos paletas de la pareja clara/oscura, para el modo 'mixto': el
    // widget se repinta con la app CERRADA, así que no puede preguntar
    // cuál toca -- se lleva las dos y elige él según el móvil.
    ...paletasParaElWidget(),
    ...seccionGimnasio(),
  };

  // Cada sección va en su propio try: que Finanzas falle no puede dejar
  // sin datos al calendario. Si una revienta, se queda fuera del JSON y
  // su widget enseña su texto de "sin datos" -- que es justo lo que hay.
  const secciones = [
    ['tareas', seccionTareas],
    ['finanzas', seccionFinanzas],
    ['lecturas', seccionLecturas],
    ['viajes', seccionViajes],
  ];
  for (const [clave, construir] of secciones) {
    try {
      const valor = await construir();
      if (valor) resumen[clave] = valor;
    } catch {
      /* esa sección se queda sin datos, el resto sigue */
    }
  }
  return resumen;
}

// --- Gimnasio: qué toca hoy según el ciclo del bloque activo ----------
function seccionGimnasio() {
  const vacio = {
    hayCiclo: false, esDescanso: false, nombre: '', bloque: '',
    color: '#5b8cff', icono: '', posicion: 0, total: 0, ejercicios: 0,
    listaEjercicios: [], siguiente: '',
  };
  if (typeof gymCicloDeHoy !== 'function') return vacio;
  let hoy = null;
  try { hoy = gymCicloDeHoy(); } catch { return vacio; }
  if (!hoy) return vacio;

  // Cuántos ejercicios tiene el día (solo los visibles: los ocultos no se
  // pre-cargan al entrenar, así que contarlos engañaría).
  let ejercicios = 0;
  let listaEjercicios = [];
  if (hoy.rutina && Array.isArray(hoy.rutina.exercises)) {
    const visibles = hoy.rutina.exercises.filter((ex) => !ex.hidden);
    ejercicios = visibles.length;
    // Los NOMBRES de los primeros, para que el widget mediano no se quede
    // con media tarjeta vacía. Se manda el mismo tope que el resto de
    // secciones: más filas no caben, y el buzón no es sitio para peso
    // muerto.
    listaEjercicios = visibles
      .slice(0, WIDGET_MAX_FILAS)
      .map((ex) => String(ex.name || ''))
      .filter((n) => n !== '');
  }

  // Qué viene DESPUÉS en el ciclo. Ojo con el nombre: no es "mañana".
  // El ciclo avanza por ENTRENOS HECHOS, no por calendario (salvo los
  // descansos, que se consumen al pasar el día), así que lo honesto es
  // decir "siguiente" y no prometer una fecha que no se cumple si te
  // saltas un día.
  let siguiente = '';
  try {
    if (typeof gymCicloSiguientePosicion === 'function' && hoy.bloque) {
      const pos = gymCicloSiguientePosicion(hoy.bloque, hoy.position);
      const dias = Array.isArray(hoy.bloque.cycleDays) ? hoy.bloque.cycleDays : [];
      const dia = dias.find((d) => d.position === pos);
      if (dia) {
        const rut = dia.routineId
          ? state.gymRoutines.find((r) => r.id === dia.routineId)
          : null;
        siguiente = rut ? String(rut.name || '') : 'Descanso';
      }
    }
  } catch { /* sin "siguiente" el widget simplemente no lo enseña */ }

  return {
    hayCiclo: true,
    esDescanso: !!hoy.esDescanso,
    nombre: hoy.rutina ? String(hoy.rutina.name || '') : '',
    bloque: hoy.bloque ? String(hoy.bloque.name || '') : '',
    color: hoy.rutina && hoy.rutina.color ? String(hoy.rutina.color) : gymAcentoParaElWidget(),
    icono: hoy.rutina && hoy.rutina.icon ? String(hoy.rutina.icon) : '',
    posicion: Number(hoy.position) || 0,
    total: Number(hoy.length) || 0,
    ejercicios,
    listaEjercicios,
    siguiente,
  };
}

// La fecha de HOY en local, no en UTC. Con toISOString(), a las 00:30 en
// España el día todavía sería el anterior y el widget enseñaría lo de
// ayer durante media hora -- el mismo cuidado que hoyISO() del ciclo.
function widgetHoyISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Cuántos elementos caben de verdad en un widget. Mandar más es peso
// muerto en el buzón: en el mediano entran 3 líneas y en el pequeño 2.
const WIDGET_MAX_FILAS = 4;

// --- Calendario: lo de hoy -------------------------------------------
// --- Tareas pendientes -----------------------------------------------
async function seccionTareas() {
  const filas = await api('/api/events?isTask=1');
  if (!Array.isArray(filas)) return null;

  const hoy = widgetHoyISO();
  const pendientes = filas.filter((t) => !t.done);
  // Con fecha primero y por fecha; las que no tienen, al final. Es el
  // mismo orden que en Mi espacio: una tarea sin fecha no urge.
  const ordenadas = pendientes.slice().sort((a, b) => {
    if (!a.startAt && !b.startAt) return 0;
    if (!a.startAt) return 1;
    if (!b.startAt) return -1;
    return a.startAt < b.startAt ? -1 : (a.startAt > b.startAt ? 1 : 0);
  });

  const vencidas = pendientes.filter((t) => t.startAt && t.startAt.slice(0, 10) < hoy).length;

  return {
    lista: ordenadas.slice(0, WIDGET_MAX_FILAS).map((t) => ({
      titulo: String(t.title || ''),
      cuando: t.startAt ? t.startAt.slice(0, 10) : '',
      color: t.groupColor || gymAcentoParaElWidget(),
      vencida: !!(t.startAt && t.startAt.slice(0, 10) < hoy),
      hoy: !!(t.startAt && t.startAt.slice(0, 10) === hoy),
    })),
    total: pendientes.length,
    vencidas,
  };
}

// --- Finanzas: lo gastado este mes contra el límite -------------------
async function seccionFinanzas() {
  const mes = widgetHoyISO().slice(0, 7);
  const r = await api(`/api/finanzas-transactions/summary/month?month=${mes}`);
  if (!r) return null;
  return {
    gastado: Number(r.totalExpense) || 0,
    limite: r.monthlyBudgetLimit == null ? 0 : Number(r.monthlyBudgetLimit) || 0,
    ahorro: Number(r.savings) || 0,
    objetivo: r.savingsGoalMin == null ? 0 : Number(r.savingsGoalMin) || 0,
    // Días que quedan de mes, para que el widget pueda decir "te quedan
    // X € para Y días" en vez de un número suelto sin contexto.
    diasRestantes: diasQueQuedanDelMes(),
  };
}

function diasQueQuedanDelMes() {
  const d = new Date();
  // El día 0 del mes SIGUIENTE es el último de este.
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.max(0, ultimo - d.getDate());
}

// --- Lecturas: lo que tienes empezado --------------------------------
async function seccionLecturas() {
  const filas = await api('/api/entretenimiento-items');
  if (!Array.isArray(filas)) return null;
  const enCurso = filas.filter((it) => it.status === 'in_progress');
  return {
    lista: enCurso.slice(0, WIDGET_MAX_FILAS).map((it) => ({
      titulo: String(it.title || ''),
      tipo: String(it.type || ''),
      // "cap. 34 / 120" si hay progreso, y nada si no lo hay: un "0/0"
      // ocupa sitio para no decir nada.
      progreso: progresoDeLectura(it),
    })),
    total: enCurso.length,
  };
}

function progresoDeLectura(item) {
  const actual = Number(item.progressCurrent);
  if (!Number.isFinite(actual) || actual <= 0) return '';
  const total = Number(item.progressTotal);
  const unidad = item.progressUnit ? String(item.progressUnit) : '';
  const cifras = Number.isFinite(total) && total > 0 ? `${actual}/${total}` : String(actual);
  return unidad ? `${cifras} ${unidad}` : cifras;
}

// --- Viajes: el que está en marcha, o el siguiente --------------------
async function seccionViajes() {
  const filas = await api('/api/viajes-trips');
  if (!Array.isArray(filas)) return null;
  const hoy = widgetHoyISO();

  // En marcha gana sobre futuro: si estás DE viaje, eso es lo que quieres
  // ver, no el siguiente.
  const enCurso = filas.find((t) => t.startDate && t.startDate <= hoy && (t.endDate || t.startDate) >= hoy);
  const futuros = filas
    .filter((t) => t.startDate && t.startDate > hoy)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const viaje = enCurso || futuros[0];
  if (!viaje) return { nombre: '', dias: 0, enCurso: false, color: '' };

  // Cuánto dura, en días naturales contando los dos extremos: un viaje
  // que empieza y acaba el mismo día dura 1, no 0.
  //
  // Se mide entre las DOS fechas del viaje, no restando dos diasHasta():
  // diasHasta() recorta a 0 los días negativos (para no decir "faltan -3
  // días"), así que en un viaje YA EMPEZADO el inicio contaba como 0 y la
  // duración salía corta. Con un viaje empezado hace 2 días y 3 por
  // delante decía 4 en vez de 6. Lo pilló el forzado, no el uso normal.
  const fin = viaje.endDate || viaje.startDate;
  const duracion = Math.max(1, diasEntre(viaje.startDate, fin) + 1);
  // Y cuántos le quedan si ya estás dentro, que es lo que quieres saber
  // estando de viaje (los días que faltan para empezar ya no dicen nada).
  const restantes = enCurso ? Math.max(0, diasHasta(fin)) : 0;

  return {
    nombre: String(viaje.name || ''),
    // Días que faltan para empezar (0 si ya está en marcha).
    dias: enCurso ? 0 : diasHasta(viaje.startDate),
    enCurso: !!enCurso,
    color: viaje.color || gymAcentoParaElWidget(),
    duracion,
    restantes,
  };
}

// Días naturales entre hoy y una fecha ISO. Se cuenta a MEDIANOCHE de los
// dos días, no de ahora mismo: si no, un viaje que empieza mañana a las
// 09:00 diría "0 días" a partir de las 09:01 de hoy.
//
// RECORTA A 0 lo que ya pasó, a propósito: "faltan -3 días" no significa
// nada de cara al usuario. Por eso NO sirve para medir duraciones -- para
// eso está diasEntre(), justo debajo.
function diasHasta(iso) {
  if (!iso) return 0;
  return Math.max(0, diasEntre(fechaLocalISO(new Date()), iso));
}

// Días entre dos fechas ISO, con signo. Sin recortar: esto sí puede ser
// negativo, y es lo que hace falta para medir cuánto dura algo que ya
// empezó.
function diasEntre(desdeISO, hastaISO) {
  const a = fechaDeISO(desdeISO);
  const b = fechaDeISO(hastaISO);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}

// "2026-09-20" -> Date local a medianoche. A mano y no new Date(iso),
// porque el constructor interpreta una fecha suelta como UTC y en España
// eso la deja en el día anterior a las 02:00.
function fechaDeISO(iso) {
  if (!iso) return null;
  const partes = String(iso).slice(0, 10).split('-').map(Number);
  if (partes.length < 3 || partes.some((n) => !Number.isFinite(n))) return null;
  return new Date(partes[0], partes[1] - 1, partes[2]);
}

function fechaLocalISO(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// El acento del tema activo, para cuando el día no tiene color propio.
// gymThemeColorHex ya existe en app.js (lo usa la Live Activity).
function gymAcentoParaElWidget() {
  return colorDelTemaParaElWidget('--accent', '#5b8cff');
}

// Cualquier color del tema, en hexadecimal. Si el tema todavía no está
// puesto (o la función no existe), se cae al valor de respaldo -- y el
// widget, al ver un color vacío o raro, se pinta con el material del
// sistema como hacía antes.
// El estilo elegido en Configuración > Widgets. Vive en settings.js, que
// se carga DESPUÉS que este archivo -- por eso se mira la función en cada
// llamada en vez de guardarla: para cuando esto se ejecuta (al mandar un
// resumen, siempre desde un handler) ya está definida.
function estiloDeWidgetElegido() {
  try {
    if (typeof getWidgetStyle === 'function') return getWidgetStyle();
  } catch { /* si settings.js no está listo, el de fábrica */ }
  return 'app';
}

function paletasParaElWidget() {
  const vacio = { fondoClaro: '', textoClaro: '', fondoOscuro: '', textoOscuro: '' };
  try {
    if (typeof paletasDelTemaParaElWidget !== 'function') return vacio;
    const p = paletasDelTemaParaElWidget();
    return {
      fondoClaro: p.claro.fondo || '',
      textoClaro: p.claro.texto || '',
      fondoOscuro: p.oscuro.fondo || '',
      textoOscuro: p.oscuro.texto || '',
    };
  } catch {
    return vacio;
  }
}

function colorDelTemaParaElWidget(variable, porDefecto) {
  try {
    if (typeof gymThemeColorHex === 'function') return gymThemeColorHex(variable, porDefecto);
  } catch { /* si el tema no está listo, el de respaldo */ }
  return porDefecto;
}

// Cómo fue el último intento de avisar al widget. Existe porque en el
// iPhone NO HAY FORMA DE VER LA CONSOLA: cuando el widget se quedó en
// "Abre la app" no había manera de saber si la app no escribía, si el
// buzón compartido no existía, o si el aviso no llegaba. Se enseña en
// Configuración → Este dispositivo, igual que ya se hace con el aviso de
// fin de descanso (`gym-rest-alert-status`).
let ultimoAvisoAlWidget = null;

function estadoDelWidget() {
  return ultimoAvisoAlWidget;
}

// Manda el resumen. Silenciosa a propósito: que el widget no se entere no
// es motivo para molestar a nadie ni para romper el flujo que la llamó.
// Lo único que hace es dejar apuntado cómo fue.
async function actualizarWidgetDelDia() {
  const plugin = getWidgetBridgePlugin();
  if (!plugin) {
    ultimoAvisoAlWidget = { ok: false, motivo: 'sin_plugin', cuando: Date.now() };
    return ultimoAvisoAlWidget;
  }
  const resumen = await construirResumenDelDia();
  try {
    const res = await plugin.guardarResumen({ json: JSON.stringify(resumen) });
    // El plugin responde {guardado:false, motivo:'sin_grupo'} cuando
    // UserDefaults(suiteName:) devuelve nil, que es lo que pasa si el App
    // Group no viajó en la firma. Esa distinción es justo la que hacía
    // falta y no se veía.
    ultimoAvisoAlWidget = {
      ok: !!(res && res.guardado),
      motivo: res && res.motivo ? res.motivo : (res && res.guardado ? 'ok' : 'sin_respuesta'),
      cuando: Date.now(),
      resumen,
    };
  } catch (err) {
    ultimoAvisoAlWidget = {
      ok: false,
      motivo: 'error: ' + (err && err.message ? err.message : 'desconocido'),
      cuando: Date.now(),
      resumen,
    };
  }
  return ultimoAvisoAlWidget;
}

// ¿Se ha abierto la app desde un widget (o desde un botón del centro de
// control)? Devuelve el DESTINO una sola vez por apertura: el nativo
// consume la marca al leerla, así no vuelve a saltar en cada vuelta a
// primer plano.
//
// Antes esto era un booleano ("¿empezar el entreno de hoy?") porque solo
// había un widget. Con cinco hace falta saber CUÁL, así que ahora viaja
// el nombre del destino y el booleano de antes es el caso `gym-hoy`.
async function widgetPideAbrir() {
  const plugin = getWidgetBridgePlugin();
  if (!plugin) return '';
  try {
    const res = await plugin.consumirApertura();
    if (!res) return '';
    // Compatibilidad con la respuesta vieja del plugin, por si la parte
    // nativa fuera anterior a esta ronda: {empezarHoy:true} sin destino.
    if (!res.destino && res.empezarHoy) return 'gym-hoy';
    return res.destino ? String(res.destino) : '';
  } catch {
    return '';
  }
}

// EL AVISO QUE FALTABA: "vuelve a mirar el buzón".
//
// Koku, tras la build #58: "me gustaría saber si los botones del panel de
// control sólo funcionan cuando la app está cerrada o en segundo plano.
// Porque si no, cuando está en primer plano no funcionan correctamente".
//
// Y así era. Con la app YA DELANTE, abrir el centro de control no la
// manda a segundo plano: la deja "inactiva" con la cortinilla encima. Al
// cerrarse esa cortinilla la webview NO recibe ni `resume` ni
// `visibilitychange`, que eran los dos únicos momentos en que el
// JavaScript iba a mirar si había una marca pendiente. El botón sí
// escribía el destino; simplemente no lo leía nadie hasta la próxima vez
// que salieras y volvieras a entrar.
//
// Ahora el plugin nativo avisa con `didBecomeActiveNotification`, que sí
// llega en esa transición (ver WidgetBridgePlugin.swift).
//
// Se comprueba DOS veces: al momento y otra vez a los 600 ms. El intent
// del botón corre en el proceso de la EXTENSIÓN, sin ningún orden
// garantizado respecto a este aviso, así que puede escribir la marca un
// pelín después. Una comprobación de más no hace nada: el nativo consume
// la marca al leerla, y sin marca esto es un no-op.
function escucharAvisosDelWidget(alRevisar) {
  const plugin = getWidgetBridgePlugin();
  if (!plugin || typeof plugin.addListener !== 'function') return;
  try {
    plugin.addListener('revisarApertura', () => {
      alRevisar();
      setTimeout(alRevisar, 600);
    });
  } catch (err) {
    console.error('No se pudo escuchar los avisos del widget:', err);
  }
}
