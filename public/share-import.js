// share-import.js — "Compartir → RemindMeLater": recibir un texto
// compartido desde otra app, detectar la fecha/hora que lleve dentro
// (en español), y abrir el modal de evento nuevo ya rellenado para
// revisar y guardar.
//
// La parte NATIVA (aparecer en la hoja de compartir del sistema) vive
// en ios/App/CompartirExtension/ — recoge el texto y abre esta app con
// remindmelater://share?text=... Aqui se recibe esa URL (plugin App de
// Capacitor, registrado con el mismo patron perezoso de siempre) y se
// hace todo lo demas. En un navegador normal no hay hoja de compartir,
// pero la deteccion se puede probar igual llamando a
// openEventModalFromSharedText() a mano.
//
// El menu nativo de "añadir a iCalendar" al tocar una fecha es privado
// de Apple — ahi no puede meterse ninguna app; esta es la alternativa
// real, hablada y aceptada con Koku.

// --- Deteccion de fecha/hora en un texto en español -------------------
// Deliberadamente cubre los formatos COMUNES primero (decidido con
// Koku: "empezando por los mas comunes y ampliando segun lo uses"):
//   fechas:  12/10  12/10/2026  12-10-26  "el 12 de octubre (de 2026)"
//            hoy / mañana / pasado mañana / "el viernes" / "viernes 12"
//   horas:   "a las 21:30"  "a las 9"  21:30  "9h"  + "de la tarde/noche"
// Devuelve { date: Date|null, hasTime: bool, title: string } — title es
// el texto SIN los trozos de fecha/hora, listo como titulo propuesto.

const SHARE_MONTHS = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
  noviembre: 10, diciembre: 11,
};
// getDay() da 0=domingo; aqui cada nombre lleva su numero de getDay().
const SHARE_WEEKDAYS = {
  domingo: 0, lunes: 1, martes: 2,
  'miércoles': 3, miercoles: 3, jueves: 4, viernes: 5,
  'sábado': 6, sabado: 6,
};

function detectSpanishDateTime(text) {
  const original = String(text || '').trim();
  // toLowerCase en español conserva la longitud caracter a caracter,
  // asi que los indices de las coincidencias valen para recortar sobre
  // el texto original (con sus mayusculas) sin desfases.
  const lower = original.toLowerCase();
  const cortes = []; // trozos [inicio, fin) a quitar del titulo
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  // ---- HORA (primero, para que "12" de "a las 12" no se lea como dia)
  let hours = null;
  let minutes = 0;
  // "a las 21:30", "a las 9", "a la 1", con "h"/"horas" y
  // "de la mañana/tarde/noche" opcionales
  let m = /\ba las? (\d{1,2})(?:[:.](\d{2}))?\s*(?:h(?:oras)?\b)?(?:\s*de la (mañana|tarde|noche))?/.exec(lower);
  if (!m) {
    // hora suelta con minutos: "21:30" (sin minutos seria ambiguo)
    m = /\b(\d{1,2}):(\d{2})\b(?:\s*de la (mañana|tarde|noche))?/.exec(lower);
  }
  if (!m) {
    // "21h" / "9h"
    m = /\b(\d{1,2})h\b()(?:\s*de la (mañana|tarde|noche))?/.exec(lower);
  }
  if (m) {
    const h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (h <= 23 && min <= 59) {
      hours = h;
      minutes = min;
      const franja = m[3] || '';
      // "9 de la tarde/noche" = 21; "12 de la noche" se deja tal cual
      // (medianoche es discutible, mejor no adivinar de mas)
      if ((franja === 'tarde' || franja === 'noche') && h >= 1 && h <= 11) hours = h + 12;
      cortes.push([m.index, m.index + m[0].length]);
    }
  }

  // ---- FECHA
  let fecha = null;

  // dd/mm(/aaaa) o dd-mm(-aa)
  m = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/.exec(lower);
  if (m) {
    const d = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10) - 1;
    if (d >= 1 && d <= 31 && mes >= 0 && mes <= 11) {
      let anyo = m[3] ? parseInt(m[3], 10) : hoy.getFullYear();
      if (m[3] && anyo < 100) anyo += 2000;
      fecha = new Date(anyo, mes, d);
      // sin año explicito y ya pasada -> se refiere al año que viene
      if (!m[3] && fecha < hoy) fecha = new Date(anyo + 1, mes, d);
      cortes.push([m.index, m.index + m[0].length]);
    }
  }

  // "el 12 de octubre (de 2026)"
  if (!fecha) {
    m = /\b(?:el |día )?(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?: de[l]? (\d{4}))?\b/.exec(lower);
    if (m) {
      const d = parseInt(m[1], 10);
      const mes = SHARE_MONTHS[m[2]];
      let anyo = m[3] ? parseInt(m[3], 10) : hoy.getFullYear();
      fecha = new Date(anyo, mes, d);
      if (!m[3] && fecha < hoy) fecha = new Date(anyo + 1, mes, d);
      cortes.push([m.index, m.index + m[0].length]);
    }
  }

  // hoy / mañana / pasado mañana
  if (!fecha) {
    m = /\b(pasado mañana|mañana|hoy)\b/.exec(lower);
    if (m) {
      const dias = m[1] === 'hoy' ? 0 : m[1] === 'mañana' ? 1 : 2;
      fecha = new Date(hoy);
      fecha.setDate(fecha.getDate() + dias);
      cortes.push([m.index, m.index + m[0].length]);
    }
  }

  // "el viernes", "viernes", "viernes 12" (dia del mes opcional)
  if (!fecha) {
    m = /\b(?:el |este |próximo |proximo )?(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)(?: (\d{1,2})\b(?! de))?/.exec(lower);
    if (m) {
      const objetivo = SHARE_WEEKDAYS[m[1]];
      const diaMes = m[2] ? parseInt(m[2], 10) : null;
      if (diaMes && diaMes >= 1 && diaMes <= 31) {
        // "viernes 12": manda el NUMERO (la proxima vez que sea dia 12);
        // el nombre del dia solo acompaña.
        fecha = new Date(hoy.getFullYear(), hoy.getMonth(), diaMes);
        if (fecha < hoy) fecha = new Date(hoy.getFullYear(), hoy.getMonth() + 1, diaMes);
      } else {
        // el proximo <dia de la semana> (hoy incluido si coincide)
        fecha = new Date(hoy);
        const delta = (objetivo - fecha.getDay() + 7) % 7;
        fecha.setDate(fecha.getDate() + delta);
      }
      cortes.push([m.index, m.index + m[0].length]);
    }
  }

  // Solo hora, sin fecha: hoy — o mañana si esa hora ya paso.
  if (!fecha && hours !== null) {
    fecha = new Date(hoy);
    const prueba = new Date(fecha);
    prueba.setHours(hours, minutes, 0, 0);
    if (prueba < new Date()) fecha.setDate(fecha.getDate() + 1);
  }

  if (fecha && hours !== null) fecha.setHours(hours, minutes, 0, 0);

  // ---- TITULO: el texto sin los trozos usados, limpio de restos
  let title = original;
  cortes.sort((a, b) => b[0] - a[0]).forEach(([ini, fin]) => {
    title = title.slice(0, ini) + ' ' + title.slice(fin);
  });
  title = title
    .replace(/\s+/g, ' ')
    // conectores que quedan colgando al quitar la fecha ("cena el  a las" -> "cena")
    .replace(/\s+(el|la|los|las|a|de|del|para|este|próximo|proximo)\s*$/i, '')
    .replace(/^\s*(el|la|a|de|del|para)\s+/i, '')
    .replace(/[\s,;:.\-–—]+$/g, '')
    .replace(/^[\s,;:.\-–—]+/g, '')
    .trim();
  if (title.length > 120) title = title.slice(0, 120).trim();

  return { date: fecha, hasTime: hours !== null, title };
}

// --- Abrir el modal de evento con lo detectado ------------------------
function openEventModalFromSharedText(text) {
  const detectado = detectSpanishDateTime(text);
  openEventModal(null, detectado.date || undefined);
  document.getElementById('event-title').value = detectado.title || 'Evento';
  if (detectado.date && detectado.hasTime) {
    // openEventModal con presetDate propone las 9:00 — aqui se sabe la
    // hora real, asi que se pisa (y el fin, 1h despues, como siempre).
    eventStartTimeField.setValue(toTimeInputValue(detectado.date));
    const fin = new Date(detectado.date);
    fin.setHours(fin.getHours() + 1);
    eventEndTimeField.setValue(toTimeInputValue(fin));
  }
}

// --- Recibir la URL de la extension de compartir (solo app nativa) ----
let shareAppPlugin = null;

function getShareAppPlugin() {
  if (shareAppPlugin) return shareAppPlugin;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  if (window.capacitorExports && typeof window.capacitorExports.registerPlugin === 'function') {
    shareAppPlugin = window.capacitorExports.registerPlugin('App');
  }
  return shareAppPlugin;
}

// La misma URL puede llegar DOS veces en un arranque en frio (una por
// getLaunchUrl y otra por el aviso de appUrlOpen) — se descarta la
// repeticion inmediata, sin bloquear compartir lo mismo mas tarde.
let lastShareUrlHandled = '';
let lastShareUrlAt = 0;

function handleShareUrl(urlText) {
  if (!urlText || !urlText.startsWith('remindmelater://')) return;
  const ahora = Date.now();
  if (urlText === lastShareUrlHandled && ahora - lastShareUrlAt < 3000) return;
  lastShareUrlHandled = urlText;
  lastShareUrlAt = ahora;

  let text = '';
  try {
    const url = new URL(urlText);
    if (url.host !== 'share') return;
    text = url.searchParams.get('text') || '';
  } catch (err) {
    return;
  }
  if (!text.trim()) return;

  // En un arranque en frio la app puede estar todavia pintandose:
  // esperar a que #app este visible antes de abrir el modal encima.
  const abrir = () => openEventModalFromSharedText(text);
  const appEl = document.getElementById('app');
  if (appEl && !appEl.classList.contains('hidden')) {
    abrir();
  } else {
    let intentos = 0;
    const timer = setInterval(() => {
      intentos += 1;
      const el = document.getElementById('app');
      if ((el && !el.classList.contains('hidden')) || intentos > 40) {
        clearInterval(timer);
        abrir();
      }
    }, 150);
  }
}

(function initShareImport() {
  const plugin = getShareAppPlugin();
  if (!plugin) return; // navegador normal: no hay hoja de compartir
  // App ya abierta cuando se comparte algo:
  plugin.addListener('appUrlOpen', (dato) => handleShareUrl(dato && dato.url));
  // App cerrada del todo: la URL con la que arranco.
  plugin.getLaunchUrl().then((dato) => {
    if (dato && dato.url) handleShareUrl(dato.url);
  }).catch(() => { /* sin URL de arranque, nada que hacer */ });
})();
