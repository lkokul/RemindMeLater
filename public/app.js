// app.js — toda la logica de la interfaz, en JavaScript "de toda la vida"
// (sin frameworks). Esta comentado con mas detalle de lo normal porque
// el objetivo es que puedas seguir el hilo aunque JS no sea tu lenguaje
// habitual. Ideas clave que se repiten mucho aqui:
//   - `fetch` = hacer una peticion HTTP (como requests en Python).
//   - `async/await` = "espera a que esto termine antes de seguir",
//     evita anidar callbacks.
//   - `localStorage` = un pequeno almacen persistente en el navegador
//     (sobrevive a cerrar la pestana); lo usamos SOLO para guardar el
//     token de este dispositivo, no datos del calendario.

const state = {
  viewDate: new Date(), // mes que se esta mostrando
  events: [],
  groups: [],
  tasks: [], // TODAS las tareas (con fecha o sin ella), ver loadTasks()
  notes: [], // Notas de "Mi espacio" (Fase 2), ver loadNotes()
  noteFolders: [], // Carpetas de notas (Fase 3), ver loadNoteFolders()
  currentNoteFolderId: null, // null = raiz -- "donde estas" navegando en Notas, no se guarda entre sesiones
  noteSearchCurrentFolderOnly: false, // false = la busqueda mira TODA la app, ver renderNotesView()
  // Notas abiertas a la vez en el editor a pantalla completa (como
  // pestañas, pero sin barra de pestañas visible -- ver el panel
  // "Secciones" y openNoteInEditor/switchActiveOpenNote en app.js). Cada
  // entrada tiene una "key" estable (generada al abrirla) que no cambia
  // aunque la nota pase de "nueva sin guardar" a tener un id real tras
  // el primer Guardar.
  openNotes: [],
  activeOpenNoteKey: null,
  specialDays: {}, // 'YYYY-MM-DD' -> 'holiday' | 'special', marcados a mano
  pairingCodeExpiresAt: null,
  notifiedReminderIds: new Set(), // evita notificar el mismo recordatorio 2 veces
  remindersMode: 'upcoming', // 'upcoming' | 'day' — que se muestra en el panel de recordatorios
  remindersDayDate: null, // dia seleccionado cuando remindersMode === 'day'
  upcomingReminders: [], // ultima lista de "proximos recordatorios" recibida del servidor
};

// Registra el service worker (ver sw.js): junto con manifest.json, es lo
// que hace que el navegador ofrezca "Instalar" (ordenador) o "Anadir a
// pantalla de inicio" (movil) para RemindMeLater, como una app aparte con
// su propio icono y sin la barra de direcciones — sin compilar nada.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const DEFAULT_EVENT_COLOR = '#5b8cff'; // el --accent de styles.css, para eventos sin grupo

// ---------------------------------------------------------------------
// Selector con estilo propio: sustituye un <select> nativo (que el
// navegador pinta a su manera, sin seguir los colores del tema) por un
// boton + lista desplegable a medida. Mismo patron que
// createColorField/createIconField en settings.js (boton que abre un
// popover colgado de <body>, posicionado en JS) — esta version vive aqui
// porque la usan los modales de evento/tarea, que son cosa de este
// archivo. closeAllPopovers/positionFixedPopover estan definidas en
// settings.js (se carga despues de este archivo), pero solo se llaman
// DENTRO de manejadores de click, que no se disparan hasta que la persona
// interactua — para entonces los dos archivos ya estan cargados, igual
// que el resto de referencias cruzadas entre app.js y settings.js.
function createSelectField({ options = [], initialValue = '', placeholder = '', onChange } = {}) {
  let value = initialValue;
  let opts = options;

  const root = document.createElement('div');
  root.className = 'select-field';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-field-trigger';

  const popover = document.createElement('div');
  popover.className = 'select-popover hidden';
  document.body.appendChild(popover);

  function findCurrent() {
    return opts.find((o) => String(o.value) === String(value));
  }

  function optionRowHtml(opt) {
    const dot = opt.color ? `<span class="color-dot" style="background-color:${opt.color}"></span>` : '';
    const icon = opt.icon ? `${escapeHtml(opt.icon)} ` : '';
    return `${dot}${icon}${escapeHtml(opt.label)}`;
  }

  function renderTrigger() {
    const current = findCurrent();
    trigger.innerHTML = current ? optionRowHtml(current) : escapeHtml(placeholder);
    trigger.classList.toggle('select-field-placeholder', !current);
  }

  function renderOptions() {
    popover.innerHTML = '';
    opts.forEach((opt) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-option' + (String(opt.value) === String(value) ? ' active' : '');
      item.innerHTML = optionRowHtml(opt);
      item.addEventListener('click', () => {
        value = opt.value;
        renderTrigger();
        renderOptions();
        popover.classList.add('hidden');
        if (onChange) onChange(value);
      });
      popover.appendChild(item);
    });
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = popover.classList.contains('hidden');
    closeAllPopovers(popover);
    popover.classList.toggle('hidden');
    if (willOpen) {
      positionFixedPopover(trigger, popover, {
        width: Math.max(200, trigger.getBoundingClientRect().width),
      });
      // Si hay muchas opciones (la hora, por ejemplo, con 96), abre ya
      // desplazado a la que esta elegida en vez de siempre arriba del
      // todo — asi no hay que buscarla a mano cada vez.
      const activeItem = popover.querySelector('.select-option.active');
      if (activeItem) activeItem.scrollIntoView({ block: 'center' });
    }
  });

  root.appendChild(trigger);
  renderOptions();
  renderTrigger();

  return {
    element: root,
    getValue: () => value,
    setValue: (v) => { value = v; renderTrigger(); renderOptions(); },
    setOptions: (newOptions) => { opts = newOptions; renderOptions(); renderTrigger(); },
  };
}

const DATE_FIELD_FORMATTER = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Icono de calendario (trazo, no emoji) para el selector de fecha —
// stroke="currentColor" para que siga el color de texto del boton (y por
// tanto el tema) automaticamente, sin tener que definir un color aparte
// por tema.
const CALENDAR_ICON_SVG = `<svg class="date-field-trigger-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="18" rx="2"></rect>
  <line x1="16" y1="2" x2="16" y2="6"></line>
  <line x1="8" y1="2" x2="8" y2="6"></line>
  <line x1="3" y1="10" x2="21" y2="10"></line>
</svg>`;

// Flechas de mes anterior/siguiente en SVG en vez de los caracteres
// "←"/"→": esos glifos no quedan centrados de verdad dentro de su caja en
// muchas fuentes (se ven "desplazados" aunque la caja este bien centrada
// por CSS) — un SVG a medida sí se centra pixel a pixel.
const CHEVRON_LEFT_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const CHEVRON_RIGHT_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
// Ojo abierto/cerrado para ocultar/destapar notas (ver mas abajo,
// seccion "Notas de Mi espacio").
const EYE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const EYE_OFF_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
// Carpeta con un "+": para el boton de crear carpeta nueva, mas claro
// que un "+" suelto (facil de confundir con "nueva nota").
const FOLDER_PLUS_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>';
// Carpeta simple (sin el "+"), para las filas de subcarpeta en la lista
// de Notas cuando no se les ha puesto un icono/emoji propio.
const FOLDER_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
// Nota (hoja con lineas de texto) -- para el arbol de notas del editor a
// pantalla completa (ver renderNoteTreeLevel), en vez del emoji 📝 de
// antes. Mismo trazo/estilo que el resto de iconos de la app.
const NOTE_FILE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';

// Estrella de favorito (notas/carpetas): rellena si es favorito, solo
// borde si no -- el mismo boton en el listado y en el editor/modal de
// creacion/edicion (ver buildNoteRow/buildFolderRow/openNoteInEditor...).
const STAR_FILLED_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><polygon points="12 2.5 15.09 8.76 22 9.77 17 14.64 18.18 21.52 12 18.27 5.82 21.52 7 14.64 2 9.77 8.91 8.76"></polygon></svg>';
const STAR_OUTLINE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><polygon points="12 2.5 15.09 8.76 22 9.77 17 14.64 18.18 21.52 12 18.27 5.82 21.52 7 14.64 2 9.77 8.91 8.76"></polygon></svg>';

// Ctrl+Intro (o Cmd+Intro en Mac) guarda directamente, sin tener que ir
// a buscar el boton "Guardar" con el raton -- util sobre todo en el
// textarea de las notas, donde Intro normal solo hace un salto de linea.
// requestSubmit() (no submit()) para que se dispare el evento "submit" y
// pase por el listener normal del formulario, con su validacion de
// required incluida.
function enableCtrlEnterSubmit(formId) {
  const form = document.getElementById(formId);
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
}
enableCtrlEnterSubmit('event-form');
enableCtrlEnterSubmit('task-form');
enableCtrlEnterSubmit('note-form');

// ---------------------------------------------------------------------
// Selector de fecha con estilo propio: sustituye <input type="date"> (o
// la parte de fecha de un datetime-local) por un boton que abre un
// mini-calendario a medida — mismo lenguaje visual que el calendario
// grande (mes con flechas + cuadricula de dias), en vez del selector
// nativo del navegador/SO, que no sigue el tema para nada. Reutiliza los
// mismos ayudantes de fecha que el calendario grande (startOfMonth,
// sameDay, WEEKDAY_LABELS, formatMonthYear), definidos mas abajo en este
// archivo — funciona porque esto solo se EJECUTA cuando alguien interactua
// (clic en el boton), momento en el que el archivo entero ya esta cargado.
// allowClear: si la fecha es opcional (tareas), anade un boton "Quitar
// fecha"; si no (inicio de un evento), no se ofrece esa opcion.
function createDateField({ initialValue = null, onChange, allowClear = false, placeholder = 'Elegir fecha' } = {}) {
  let value = initialValue; // Date o null
  let viewMonth = value ? new Date(value.getFullYear(), value.getMonth(), 1) : startOfMonth(new Date());

  const root = document.createElement('div');
  root.className = 'date-field';

  // Aparte del calendario emergente, tambien se puede escribir la fecha a
  // mano en este campo de texto — el icono de al lado es lo que abre el
  // calendario, ya no hace falta clicar sobre el texto para eso.
  const wrap = document.createElement('div');
  wrap.className = 'date-field-input-wrap';

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'date-field-text';
  textInput.placeholder = placeholder;
  textInput.inputMode = 'numeric';

  const iconBtn = document.createElement('button');
  iconBtn.type = 'button';
  iconBtn.className = 'date-field-icon-btn';
  iconBtn.innerHTML = CALENDAR_ICON_SVG;
  iconBtn.setAttribute('aria-label', 'Abrir calendario');

  wrap.appendChild(textInput);
  wrap.appendChild(iconBtn);

  const popover = document.createElement('div');
  popover.className = 'date-popover hidden';
  document.body.appendChild(popover);

  function syncTextInput() {
    textInput.value = value ? DATE_FIELD_FORMATTER.format(value) : '';
  }

  // Admite "14/8/2026" o "14/08/2026" escrito a mano. Devuelve null si no
  // es una fecha real (incluye cosas como 31/02, que numericamente
  // "parsean" pero no existen).
  function parseTypedDate(text) {
    const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    if (value) d.setHours(value.getHours(), value.getMinutes(), value.getSeconds(), 0);
    return d;
  }

  // Al salir del campo (Tab, clic fuera...): si lo que hay escrito es una
  // fecha valida, se aplica; si no (o esta vacio y se puede quitar la
  // fecha), se actua en consecuencia; si no es valido y no se puede
  // dejar vacio, vuelve a mostrar la ultima fecha buena en vez de dejar
  // algo raro escrito.
  textInput.addEventListener('change', () => {
    const text = textInput.value.trim();
    if (!text) {
      if (allowClear) {
        value = null;
        if (onChange) onChange(value);
      }
      syncTextInput();
      return;
    }
    const parsed = parseTypedDate(text);
    if (parsed) {
      value = parsed;
      viewMonth = new Date(value.getFullYear(), value.getMonth(), 1);
      if (onChange) onChange(value);
    }
    syncTextInput();
  });
  textInput.addEventListener('click', (e) => e.stopPropagation());

  function selectDay(cellDate) {
    // Si ya habia una fecha (con hora, en el caso de un evento), se
    // conserva esa hora — aqui solo se cambia el dia/mes/año.
    const next = value ? new Date(value) : new Date();
    next.setFullYear(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
    value = next;
    syncTextInput();
    popover.classList.add('hidden');
    if (onChange) onChange(value);
  }

  function renderCalendar() {
    popover.innerHTML = '';

    const nav = document.createElement('div');
    nav.className = 'date-popover-nav';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'icon-btn';
    prevBtn.innerHTML = CHEVRON_LEFT_SVG;
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    const label = document.createElement('span');
    label.className = 'date-popover-month-label';
    label.textContent = formatMonthYear(viewMonth);
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'icon-btn';
    nextBtn.innerHTML = CHEVRON_RIGHT_SVG;
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    nav.appendChild(prevBtn);
    nav.appendChild(label);
    nav.appendChild(nextBtn);
    popover.appendChild(nav);

    const grid = document.createElement('div');
    grid.className = 'date-popover-grid';
    WEEKDAY_LABELS.forEach((l) => {
      const h = document.createElement('div');
      h.className = 'date-popover-weekday';
      h.textContent = l;
      grid.appendChild(h);
    });

    const first = startOfMonth(viewMonth);
    const firstWeekday = (first.getDay() + 6) % 7;
    const gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - firstWeekday);
    const today = new Date();

    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + i);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'date-popover-day';
      if (cellDate.getMonth() !== viewMonth.getMonth()) cell.classList.add('other-month');
      if (sameDay(cellDate, today)) cell.classList.add('today');
      if (value && sameDay(cellDate, value)) cell.classList.add('selected');
      cell.textContent = cellDate.getDate();
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        selectDay(cellDate);
      });
      grid.appendChild(cell);
    }
    popover.appendChild(grid);

    if (allowClear) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'secondary-btn date-popover-clear';
      clearBtn.textContent = 'Quitar fecha';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        value = null;
        syncTextInput();
        popover.classList.add('hidden');
        if (onChange) onChange(value);
      });
      popover.appendChild(clearBtn);
    }
  }

  iconBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = popover.classList.contains('hidden');
    closeAllPopovers(popover);
    viewMonth = value ? new Date(value.getFullYear(), value.getMonth(), 1) : startOfMonth(new Date());
    if (willOpen) renderCalendar();
    popover.classList.toggle('hidden');
    if (willOpen) positionFixedPopover(iconBtn, popover, { width: 264 });
  });

  root.appendChild(wrap);
  syncTextInput();

  return {
    element: root,
    getValue: () => value,
    setValue: (v) => { value = v; syncTextInput(); },
  };
}

// ---------------------------------------------------------------------
// Capa de red: envuelve fetch para añadir el token del dispositivo (si
// existe) y para reaccionar automaticamente si el servidor dice 401
// (dispositivo no vinculado) mostrando la pantalla de emparejamiento.
// ---------------------------------------------------------------------
async function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  const token = localStorage.getItem('deviceToken');
  if (token) headers['X-Device-Token'] = token;

  const res = await fetch(path, Object.assign({}, options, { headers }));

  if (res.status === 401) {
    localStorage.removeItem('deviceToken');
    showPairingScreen();
    throw new Error('device_not_paired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Error ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------
// Emparejamiento
// ---------------------------------------------------------------------
function showPairingScreen() {
  document.getElementById('pairing-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('pairing-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

document.getElementById('pairing-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('pairing-code').value.trim();
  const name = document.getElementById('pairing-name').value.trim();
  const errorEl = document.getElementById('pairing-error');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch('/api/devices/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.message || 'No se pudo vincular.');

    localStorage.setItem('deviceToken', body.token);
    showApp();
    init();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------------
// Utilidades de fecha
// ---------------------------------------------------------------------
const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTH_ONLY_FORMATTER = new Intl.DateTimeFormat('es-ES', { month: 'long' });
const DAY_HEADING_FORMATTER = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const TIME_FORMATTER = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

// "Agosto 2026" en vez del "agosto de 2026" que da Intl por defecto en
// español (con "de" en medio, y en minuscula) — quitamos el "de" y
// ponemos la mes en mayuscula inicial a mano.
function formatMonthYear(date) {
  const month = MONTH_ONLY_FORMATTER.format(date);
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${date.getFullYear()}`;
}

function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59); }
function toIsoDate(date) { return date.toISOString().slice(0, 10); }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

// Como toIsoDate() pasa por toISOString() (que es UTC), un dia a horas
// cercanas a medianoche podria "saltar" al dia de al lado segun la zona
// horaria. Para marcar festivos/especiales necesitamos la fecha LOCAL tal
// cual se ve en el calendario, sin pasar por UTC.
function toDateKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---------------------------------------------------------------------
// Carga y render del mes
// ---------------------------------------------------------------------
async function loadMonth() {
  const from = toIsoDate(startOfMonth(state.viewDate));
  const to = toIsoDate(endOfMonth(state.viewDate));
  state.events = await api(`/api/events?from=${from}T00:00:00&to=${to}T23:59:59`);
  document.getElementById('current-month-label').textContent = formatMonthYear(state.viewDate);
  renderCalendarGrid();
  renderAgendaList();
}

// Los dias marcados como festivo/especial no son muchos (los pones tu a
// mano), asi que se traen todos de golpe en vez de por mes — mas simple,
// y asi tambien sirven si navegas a otro mes sin tener que pedirlos otra
// vez.
async function loadSpecialDays() {
  const rows = await api('/api/special-days');
  state.specialDays = {};
  rows.forEach((r) => { state.specialDays[r.date] = r.type; });
}

// Como se ven, en el calendario del mes, los dias con varios
// eventos/tareas a la vez — preferencia de ESTE dispositivo, se cambia
// desde Configuracion > Vista (ver refreshCalendarDensityOptions en
// settings.js).
const CALENDAR_DENSITY_MODE_IDS = ['limit', 'dots', 'tint'];
const CALENDAR_DENSITY_LIMIT = 3; // cuantos chips completos se ven en modo "limite" antes del "+N mas"

function getCalendarDensityMode() {
  const stored = localStorage.getItem('calendarDayDensity');
  return CALENDAR_DENSITY_MODE_IDS.includes(stored) ? stored : 'limit';
}

// Construye el chip de un evento normal (no tarea) para una celda del
// calendario — se saco aparte de renderCalendarGrid porque el modo
// "limite" solo pinta ALGUNOS de los eventos del dia, no todos.
function buildCalendarEventChip(ev) {
  const chip = document.createElement('div');
  chip.className = 'calendar-event-chip';
  chip.style.backgroundColor = ev.groupColor || DEFAULT_EVENT_COLOR;
  const iconPrefix = ev.groupIcon ? `${ev.groupIcon} ` : '';
  chip.textContent = ev.allDay ? `${iconPrefix}${ev.title}` : `${TIME_FORMATTER.format(new Date(ev.startAt))} ${iconPrefix}${ev.title}`;
  chip.addEventListener('click', (e) => {
    e.stopPropagation(); // que no abra tambien el panel del dia entero
    openEventModal(ev);
  });
  return chip;
}

function renderCalendarGrid() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  WEEKDAY_LABELS.forEach((label) => {
    const el = document.createElement('div');
    el.className = 'calendar-weekday-heading';
    el.textContent = label;
    grid.appendChild(el);
  });

  const first = startOfMonth(state.viewDate);
  // getDay() da 0=domingo..6=sabado; queremos que la semana empiece en lunes.
  const firstWeekday = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - firstWeekday);

  const today = new Date();

  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + i);

    const cell = document.createElement('div');
    cell.className = 'calendar-cell';
    if (cellDate.getMonth() !== state.viewDate.getMonth()) cell.classList.add('other-month');
    if (sameDay(cellDate, today)) cell.classList.add('today');
    // Dia que se esta viendo ahora mismo en el panel de recordatorios
    // (clicado en el calendario, o navegado con las flechas del teclado
    // o de "Mi espacio") — mismo aspecto que el hover, pero fijo en vez
    // de necesitar el raton encima.
    if (state.remindersMode === 'day' && state.remindersDayDate && sameDay(cellDate, state.remindersDayDate)) {
      cell.classList.add('selected-day');
    }

    // Color de fondo de la celda: festivo/especial (marcados a mano) por
    // encima de fin de semana (automatico, sabado/domingo); "hoy" no
    // compite con esto porque se ve en el numero del dia, no en el fondo
    // (ver .calendar-cell.today .calendar-cell-day en styles.css).
    const dayType = state.specialDays[toDateKey(cellDate)];
    if (dayType === 'holiday') cell.classList.add('holiday-day');
    else if (dayType === 'special') cell.classList.add('special-day');
    else if (cellDate.getDay() === 0 || cellDate.getDay() === 6) cell.classList.add('weekend-day');

    const dayLabel = document.createElement('div');
    dayLabel.className = 'calendar-cell-day';
    dayLabel.textContent = cellDate.getDate();
    cell.appendChild(dayLabel);

    const dayEvents = state.events.filter((ev) => ev.startAt && sameDay(new Date(ev.startAt), cellDate));
    const densityMode = getCalendarDensityMode();

    if (densityMode === 'tint') {
      // Sin chips ni puntos: solo se marca el dia como "tiene algo", el
      // detalle de verdad se ve al abrirlo (clicando la celda).
      if (dayEvents.length > 0) cell.classList.add('has-content');
    } else if (densityMode === 'dots') {
      // Un punto de color por evento/tarea, sin texto — las tareas con el
      // mismo criterio de borde-en-vez-de-relleno que ya usan sus chips.
      if (dayEvents.length > 0) {
        const dotsRow = document.createElement('div');
        dotsRow.className = 'calendar-day-dots';
        dayEvents.forEach((ev) => {
          const dot = document.createElement('span');
          dot.className = 'calendar-day-dot';
          const color = ev.isTask
            ? (ev.done ? taskCompletedColor(ev) : taskPendingColor(ev))
            : (ev.groupColor || DEFAULT_EVENT_COLOR);
          if (ev.isTask) {
            dot.classList.add('is-task');
            dot.style.borderColor = color;
          } else {
            dot.style.backgroundColor = color;
          }
          dotsRow.appendChild(dot);
        });
        cell.appendChild(dotsRow);
      }
    } else {
      // 'limit': como antes, pero con un tope de chips completos y un
      // "+N mas" para el resto (en vez de que la celda se desborde con
      // muchos eventos el mismo dia).
      const visible = dayEvents.slice(0, CALENDAR_DENSITY_LIMIT);
      const hiddenCount = dayEvents.length - visible.length;
      visible.forEach((ev) => {
        cell.appendChild(ev.isTask ? buildCalendarTaskChip(ev) : buildCalendarEventChip(ev));
      });
      if (hiddenCount > 0) {
        const more = document.createElement('div');
        more.className = 'calendar-more-chip';
        more.textContent = `+${hiddenCount} más`;
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          showDayInReminders(cellDate);
        });
        cell.appendChild(more);
      }
    }

    // Clicar en cualquier otro sitio de la celda (no un chip concreto)
    // cambia el panel de recordatorios para mostrar TODOS los eventos de
    // ese dia — los chips se quedan pequenos y no siempre caben todos.
    cell.addEventListener('click', () => showDayInReminders(cellDate));

    grid.appendChild(cell);
  }
}

// ---------------------------------------------------------------------
// Panel de recordatorios en modo "dia": clicar un dia del calendario NO
// abre ninguna ventana — en su lugar, el panel de recordatorios (el de
// al lado del calendario) cambia a mostrar los eventos de ese dia, con
// opcion de anadir uno nuevo ya con esa fecha puesta y de marcarlo como
// festivo o dia especial. "← Proximos" vuelve a la vista normal.
// ---------------------------------------------------------------------
async function showDayInReminders(date) {
  state.remindersMode = 'day';
  state.remindersDayDate = date;
  renderCalendarGrid();
  await renderRemindersPanel();
}

function showUpcomingReminders() {
  state.remindersMode = 'upcoming';
  state.remindersDayDate = null;
  renderCalendarGrid();
  renderRemindersPanel();
}

function updateDayMarkButtons(dateKey) {
  const current = state.specialDays[dateKey];
  document.getElementById('btn-day-mark-holiday').classList.toggle('active', current === 'holiday');
  document.getElementById('btn-day-mark-special').classList.toggle('active', current === 'special');
}

async function setDayType(dateKey, type) {
  const current = state.specialDays[dateKey];
  const next = current === type ? null : type; // pulsar el mismo tipo otra vez lo quita
  await api(`/api/special-days/${dateKey}`, { method: 'PUT', body: JSON.stringify({ type: next }) });
  if (next) state.specialDays[dateKey] = next;
  else delete state.specialDays[dateKey];
  updateDayMarkButtons(dateKey);
  renderCalendarGrid();
}

// Se piden los eventos de ESE dia directamente al servidor (en vez de
// filtrar state.events, que solo tiene el mes que se esta viendo) para
// que tambien funcione bien si clicas un dia "de otro mes" que asoma en
// las esquinas de la cuadricula.
async function renderDayReminders(date) {
  const dateStr = toDateKey(date);
  const list = document.getElementById('reminders-list');
  list.innerHTML = '<p class="empty-hint">Cargando…</p>';

  const dayEvents = await api(`/api/events?from=${dateStr}T00:00:00&to=${dateStr}T23:59:59`);

  list.innerHTML = '';
  if (dayEvents.length === 0) {
    list.innerHTML = '<p class="empty-hint">No hay eventos este dia.</p>';
    return;
  }

  dayEvents.forEach((ev) => {
    if (ev.isTask) {
      const row = buildTaskRow(ev);
      if (row) list.appendChild(row);
      return;
    }
    const groupLabel = ev.groupName ? `${ev.groupIcon ? ev.groupIcon + ' ' : ''}${ev.groupName}` : null;
    const item = document.createElement('div');
    item.className = 'agenda-item';
    item.innerHTML = `
      <span class="color-dot" style="background-color: ${ev.groupColor || DEFAULT_EVENT_COLOR}"></span>
      <div class="agenda-time">${ev.allDay ? 'Todo el dia' : TIME_FORMATTER.format(new Date(ev.startAt))}</div>
      <div>
        <div class="agenda-title">${escapeHtml(ev.title)}</div>
        ${groupLabel || ev.location ? `<div class="agenda-meta">${[groupLabel, ev.location].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
      </div>
    `;
    item.addEventListener('click', () => openEventModal(ev));
    list.appendChild(item);
  });
}

async function renderRemindersPanel() {
  const title = document.getElementById('reminders-panel-title');
  const backBtn = document.getElementById('btn-reminders-back');
  const dayActions = document.getElementById('reminders-day-actions');

  if (state.remindersMode === 'day' && state.remindersDayDate) {
    title.textContent = DAY_HEADING_FORMATTER.format(state.remindersDayDate);
    backBtn.classList.remove('hidden');
    dayActions.classList.remove('hidden');
    updateDayMarkButtons(toDateKey(state.remindersDayDate));
    remindersDayNavDateField.setValue(state.remindersDayDate);
    await renderDayReminders(state.remindersDayDate);
  } else {
    title.textContent = 'Proximos recordatorios';
    backBtn.classList.add('hidden');
    dayActions.classList.add('hidden');
    renderUpcomingRemindersList(state.upcomingReminders || []);
  }
}

// Navegacion de dia dentro de "Mi espacio" (ver #reminders-day-nav en
// index.html, oculta fuera de ahi). El campo de fecha se crea UNA vez
// aqui mismo (igual que los campos de fecha de los modales) y vive
// siempre dentro de .reminders-top-block, se mueva este donde se mueva.
const remindersDayNavDateField = createDateField({
  initialValue: new Date(),
  onChange: (d) => { if (d) showDayInReminders(d); },
});
document.getElementById('reminders-day-nav-date-field').appendChild(remindersDayNavDateField.element);
document.getElementById('btn-reminders-day-prev').addEventListener('click', () => shiftRemindersDay(-1));
document.getElementById('btn-reminders-day-next').addEventListener('click', () => shiftRemindersDay(1));

document.getElementById('btn-reminders-back').addEventListener('click', showUpcomingReminders);
document.getElementById('btn-day-mark-holiday').addEventListener('click', () => {
  if (state.remindersDayDate) setDayType(toDateKey(state.remindersDayDate), 'holiday');
});
document.getElementById('btn-day-mark-special').addEventListener('click', () => {
  if (state.remindersDayDate) setDayType(toDateKey(state.remindersDayDate), 'special');
});
document.getElementById('btn-day-add-event').addEventListener('click', () => {
  openEventModal(null, state.remindersDayDate);
});

function renderAgendaList() {
  const container = document.getElementById('agenda-list');
  container.innerHTML = '';

  if (state.events.length === 0) {
    container.innerHTML = '<p class="empty-hint">No hay eventos este mes.</p>';
    return;
  }

  let lastDayKey = null;
  state.events.forEach((ev) => {
    const start = new Date(ev.startAt);
    const dayKey = toIsoDate(start);
    if (dayKey !== lastDayKey) {
      const heading = document.createElement('div');
      heading.className = 'agenda-day-heading';
      heading.textContent = DAY_HEADING_FORMATTER.format(start);
      container.appendChild(heading);
      lastDayKey = dayKey;
    }

    if (ev.isTask) {
      const row = buildTaskRow(ev);
      if (row) container.appendChild(row);
      return;
    }
    const groupLabel = ev.groupName ? `${ev.groupIcon ? ev.groupIcon + ' ' : ''}${ev.groupName}` : null;
    const item = document.createElement('div');
    item.className = 'agenda-item';
    item.innerHTML = `
      <span class="color-dot" style="background-color: ${ev.groupColor || DEFAULT_EVENT_COLOR}"></span>
      <div class="agenda-time">${ev.allDay ? 'Todo el dia' : TIME_FORMATTER.format(start)}</div>
      <div>
        <div class="agenda-title">${escapeHtml(ev.title)}</div>
        ${groupLabel || ev.location ? `<div class="agenda-meta">${[groupLabel, ev.location].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
      </div>
    `;
    item.addEventListener('click', () => openEventModal(ev));
    container.appendChild(item);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('nav-prev').addEventListener('click', () => {
  state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
  loadMonth();
});
document.getElementById('nav-next').addEventListener('click', () => {
  state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
  loadMonth();
});

// ---------------------------------------------------------------------
// Modal de evento (crear / editar / borrar)
// ---------------------------------------------------------------------
const REMINDER_OPTIONS = [
  { value: '', label: 'Sin recordatorio' },
  { value: '0', label: 'En el momento' },
  { value: '10', label: '10 minutos antes' },
  { value: '30', label: '30 minutos antes' },
  { value: '60', label: '1 hora antes' },
  { value: '1440', label: '1 dia antes' },
];
const eventReminderField = createSelectField({ options: REMINDER_OPTIONS, initialValue: '' });
document.getElementById('event-reminder-field').appendChild(eventReminderField.element);

const eventGroupField = createSelectField({ options: [{ value: '', label: 'Sin grupo' }], initialValue: '' });
document.getElementById('event-group-field').appendChild(eventGroupField.element);

const eventStartDateField = createDateField({ initialValue: new Date() });
document.getElementById('event-start-date-field').appendChild(eventStartDateField.element);

const eventEndDateField = createDateField({ initialValue: null, allowClear: true, placeholder: 'Sin fecha' });
document.getElementById('event-end-date-field').appendChild(eventEndDateField.element);

// Campo de hora propio: un input de texto normal (se escribe directo,
// sin desplegable) pero con el estilo del tema — <input type="time">
// nativo siempre abre el selector propio del navegador al clicarlo (el
// de la captura, con columnas de horas/minutos), que no hay forma de
// quitar ni de estilizar con CSS.
function toTimeInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createTimeField({ initialValue = '09:00' } = {}) {
  let value = initialValue;

  const root = document.createElement('div');
  root.className = 'time-field';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'time-field-input';
  input.placeholder = 'HH:MM';
  input.inputMode = 'numeric';
  input.value = value;

  // Admite "9:5", "09:05", "930"... siempre que las horas/minutos sean
  // validos; si no, devuelve null y el campo vuelve al ultimo valor
  // bueno en vez de dejar algo sin sentido escrito.
  function normalize(text) {
    const cleaned = text.trim().replace(/\s+/g, '');
    const m = cleaned.match(/^(\d{1,2}):?(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }

  input.addEventListener('change', () => {
    const normalized = normalize(input.value);
    if (normalized) value = normalized;
    input.value = value;
  });

  root.appendChild(input);

  return {
    element: root,
    getValue: () => value,
    setValue: (v) => { value = v; input.value = v; },
  };
}

// Junta un Date (solo se usa su dia/mes/año) con un "HH:mm" en un unico
// string "YYYY-MM-DDTHH:mm:ss" para mandar al servidor — el selector de
// fecha y el de hora viven separados en el formulario, pero la API sigue
// esperando un solo valor combinado, como antes con el datetime-local.
function combineDateAndTime(date, timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  return `${toDateKey(date)}T${pad(h)}:${pad(m)}:00`;
}

const eventStartTimeField = createTimeField({ initialValue: toTimeInputValue(new Date()) });
document.getElementById('event-start-time-field').appendChild(eventStartTimeField.element);

const eventEndTimeField = createTimeField({ initialValue: toTimeInputValue(new Date()) });
document.getElementById('event-end-time-field').appendChild(eventEndTimeField.element);

// presetDate (opcional): al crear un evento nuevo desde el panel de un
// dia concreto, arranca ya con esa fecha puesta (a las 09:00 por
// defecto) en vez de con la fecha/hora actual.
function openEventModal(event, presetDate) {
  const modal = document.getElementById('event-modal');
  document.getElementById('event-modal-title').textContent = event ? 'Editar evento' : 'Nuevo evento';
  document.getElementById('event-id').value = event ? event.id : '';
  document.getElementById('event-title').value = event ? event.title : '';
  document.getElementById('event-all-day').checked = event ? event.allDay : false;
  let defaultStart = new Date();
  if (presetDate) {
    defaultStart = new Date(presetDate);
    defaultStart.setHours(9, 0, 0, 0);
  }
  const startDate = event ? new Date(event.startAt) : defaultStart;
  eventStartDateField.setValue(startDate);
  eventStartTimeField.setValue(toTimeInputValue(startDate));

  if (event && event.endAt) {
    const endDate = new Date(event.endAt);
    eventEndDateField.setValue(endDate);
    eventEndTimeField.setValue(toTimeInputValue(endDate));
  } else {
    eventEndDateField.setValue(null);
    eventEndTimeField.setValue(toTimeInputValue(startDate));
  }
  document.getElementById('event-location').value = event && event.location ? event.location : '';
  const descriptionEl = document.getElementById('event-description');
  descriptionEl.value = event && event.description ? event.description : '';
  // Arrastrar el asa de la esquina deja un alto fijo puesto a mano (estilo
  // inline) en el propio <textarea>, que se queda ahi para siempre porque
  // es el MISMO elemento reutilizado en cada apertura del modal — sin
  // esto, un evento nuevo heredaria el tamaño que dejaste en el anterior.
  descriptionEl.style.height = '';
  eventReminderField.setValue(event && event.reminderMinutesBefore !== null && event.reminderMinutesBefore !== undefined
    ? String(event.reminderMinutesBefore)
    : '');
  populateEventGroupSelect();
  eventGroupField.setValue(event && event.groupId ? String(event.groupId) : '');
  document.getElementById('btn-delete-event').classList.toggle('hidden', !event);

  const createdByEl = document.getElementById('event-created-by');
  if (event && event.createdByName) {
    createdByEl.textContent = `Creado por ${event.createdByName}`;
    createdByEl.classList.remove('hidden');
  } else {
    createdByEl.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

function closeEventModal() {
  document.getElementById('event-modal').classList.add('hidden');
}

document.getElementById('btn-new-event').addEventListener('click', () => openEventModal(null));
document.getElementById('btn-cancel-event').addEventListener('click', closeEventModal);
document.getElementById('btn-close-event').addEventListener('click', closeEventModal);

document.getElementById('event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('event-id').value;
  const reminderRaw = eventReminderField.getValue();

  const groupRaw = eventGroupField.getValue();

  const startDate = eventStartDateField.getValue();
  const endDate = eventEndDateField.getValue();

  const payload = {
    title: document.getElementById('event-title').value,
    allDay: document.getElementById('event-all-day').checked,
    startAt: combineDateAndTime(startDate, eventStartTimeField.getValue()),
    endAt: endDate ? combineDateAndTime(endDate, eventEndTimeField.getValue()) : null,
    location: document.getElementById('event-location').value || null,
    description: document.getElementById('event-description').value || null,
    reminderMinutesBefore: reminderRaw === '' ? null : Number(reminderRaw),
    groupId: groupRaw === '' ? null : Number(groupRaw),
  };

  if (id) {
    await api(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/events', { method: 'POST', body: JSON.stringify(payload) });
  }

  closeEventModal();
  loadMonth();
  loadReminders();
});

document.getElementById('btn-delete-event').addEventListener('click', async () => {
  const id = document.getElementById('event-id').value;
  if (!id) return;
  if (!confirm('¿Eliminar este evento?')) return;
  await api(`/api/events/${id}`, { method: 'DELETE' });
  closeEventModal();
  loadMonth();
  loadReminders();
});

// ---------------------------------------------------------------------
// Grupos: solo lo que necesita el formulario de evento. La gestion
// (crear/editar/borrar grupos) vive en settings.js, dentro del panel de
// Configuracion; esto se queda aqui porque el <select> de grupo esta en
// el modal de evento, que es cosa de app.js.
// ---------------------------------------------------------------------
async function loadGroups() {
  state.groups = await api('/api/groups');
}

function groupSelectOptions() {
  return [
    { value: '', label: 'Sin grupo' },
    ...state.groups.map((g) => ({ value: String(g.id), label: g.name, color: g.color, icon: g.icon })),
  ];
}

function populateEventGroupSelect() {
  const current = eventGroupField.getValue();
  eventGroupField.setOptions(groupSelectOptions());
  eventGroupField.setValue(current);
}

// ---------------------------------------------------------------------
// Recordatorios: panel + notificaciones del navegador
// ---------------------------------------------------------------------
function renderUpcomingRemindersList(upcoming) {
  const now = new Date();
  const list = document.getElementById('reminders-list');
  list.innerHTML = '';

  const future = upcoming.filter((r) => new Date(r.startAt) >= now).slice(0, 10);

  if (future.length === 0) {
    list.innerHTML = '<p class="empty-hint">No hay recordatorios proximos.</p>';
  } else {
    future.forEach((r) => {
      const remindAt = new Date(r.remindAt);
      const isDue = remindAt <= now;
      const row = document.createElement('div');
      row.className = 'reminder-item';
      const iconPrefix = r.groupIcon ? `${escapeHtml(r.groupIcon)} ` : '';
      row.innerHTML = `
        <span><span class="color-dot" style="background-color: ${r.groupColor || DEFAULT_EVENT_COLOR}"></span> ${iconPrefix}${escapeHtml(r.title)}</span>
        <span class="${isDue ? 'reminder-due' : ''}">${TIME_FORMATTER.format(new Date(r.startAt))}</span>
      `;
      list.appendChild(row);
    });
  }
}

async function loadReminders() {
  const upcoming = await api('/api/reminders/upcoming');
  const now = new Date();
  state.upcomingReminders = upcoming;

  // El DOM de #reminders-list solo se toca si el panel esta mostrando
  // "proximos" — si el usuario esta viendo un dia concreto, no lo pisamos.
  if (state.remindersMode !== 'day') {
    renderUpcomingRemindersList(upcoming);
  }

  // Notificaciones del navegador: solo funcionan mientras esta pestana
  // esta abierta. Es el aviso "en el movil"; el aviso de escritorio de
  // verdad (aunque no tengas el navegador abierto) lo dispara el propio
  // servidor (ver server/reminderChecker.js). Se activan desde la
  // pestana "Este dispositivo" del panel de Configuracion (settings.js),
  // no automaticamente: la mayoria de navegadores exigen que el permiso
  // se pida como respuesta a un click, no solo al cargar la pagina.
  const notificationsEnabled = localStorage.getItem('notificationsEnabled') !== 'false';
  if (window.Notification && Notification.permission === 'granted' && notificationsEnabled) {
    upcoming.forEach((r) => {
      const due = new Date(r.remindAt) <= now;
      if (due && !r.reminderSent && !state.notifiedReminderIds.has(r.eventId)) {
        new Notification('RemindMeLater', { body: r.title });
        state.notifiedReminderIds.add(r.eventId);
      }
    });
  }
}

// ---------------------------------------------------------------------
// Tareas: un tipo especial de "evento" (is_task = 1 en la base de datos)
// que puede no tener fecha, se marca hecha/pendiente, y vive en su propio
// bloque fijo del panel de recordatorios (#tasks-list en index.html)
// ademas de en el calendario si tiene fecha (ver buildCalendarTaskChip,
// llamada desde renderCalendarGrid mas arriba).
// mutedTaskColor/getCompletedTasksDisplayMode viven en settings.js (se
// carga despues de este archivo) — solo se usan aqui dentro de funciones
// que se EJECUTAN despues de que la pagina ha cargado del todo (nunca al
// evaluar app.js en si), asi que para cuando se llaman de verdad ya
// existen. Mismo patron que el resto de referencias cruzadas entre los
// dos archivos.
// ---------------------------------------------------------------------
function taskPendingColor(task) {
  return task.groupColor || DEFAULT_EVENT_COLOR;
}

function taskCompletedColor(task) {
  return task.groupCompletedColor || mutedTaskColor(taskPendingColor(task));
}

function buildCalendarTaskChip(task) {
  const chip = document.createElement('div');
  chip.className = 'calendar-task-chip' + (task.done ? ' done' : '');
  const color = task.done ? taskCompletedColor(task) : taskPendingColor(task);
  chip.style.borderColor = color;
  chip.style.color = color;

  const check = document.createElement('span');
  check.className = 'calendar-task-chip-check';
  check.textContent = task.done ? '☑' : '☐';
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTaskDone(task);
  });

  const label = document.createElement('span');
  const iconPrefix = task.groupIcon ? `${task.groupIcon} ` : '';
  label.textContent = `${iconPrefix}${task.title}`;

  chip.appendChild(check);
  chip.appendChild(label);
  chip.addEventListener('click', (e) => {
    e.stopPropagation(); // que no abra tambien el panel del dia entero
    openTaskModal(task);
  });
  return chip;
}

async function loadTasks() {
  state.tasks = await api('/api/events?isTask=1');
}

function buildTaskRow(task) {
  const displayMode = typeof getCompletedTasksDisplayMode === 'function' ? getCompletedTasksDisplayMode() : 'strike';
  if (task.done && displayMode === 'hide') return null;

  const row = document.createElement('div');
  row.className = 'task-item' + (task.done ? ' done' : '');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-item-checkbox';
  checkbox.checked = task.done;
  checkbox.addEventListener('click', (e) => e.stopPropagation());
  checkbox.addEventListener('change', () => toggleTaskDone(task));

  // Color del grupo: se veia en el chip del calendario pero faltaba aqui,
  // en la fila de la lista (mismo bug que reporto Koku: en modo oscuro se
  // nota mas porque sin el punto de color todo se confunde con el texto).
  const colorDot = document.createElement('span');
  colorDot.className = 'color-dot';
  colorDot.style.backgroundColor = task.done ? taskCompletedColor(task) : taskPendingColor(task);

  const title = document.createElement('span');
  title.className = 'task-item-title';
  const iconPrefix = task.groupIcon ? `${escapeHtml(task.groupIcon)} ` : '';
  title.innerHTML = `${iconPrefix}${escapeHtml(task.title)}`;

  row.appendChild(checkbox);
  row.appendChild(colorDot);
  row.appendChild(title);

  if (task.startAt) {
    const dateLabel = document.createElement('span');
    dateLabel.className = 'task-item-date';
    dateLabel.textContent = DAY_HEADING_FORMATTER.format(new Date(task.startAt));
    row.appendChild(dateLabel);
  }

  row.addEventListener('click', () => openTaskModal(task));
  return row;
}

function renderTasksList() {
  const container = document.getElementById('tasks-list');
  if (!container) return;
  container.innerHTML = '';

  if (state.tasks.length === 0) {
    container.innerHTML = '<p class="empty-hint">No tienes tareas.</p>';
    return;
  }

  // Pendientes primero (por fecha, las sin fecha al final), hechas
  // despues (si se muestran, ver getCompletedTasksDisplayMode en
  // settings.js — ajuste de Configuracion > Este dispositivo).
  const byDate = (a, b) => {
    if (!a.startAt && !b.startAt) return 0;
    if (!a.startAt) return 1;
    if (!b.startAt) return -1;
    return new Date(a.startAt) - new Date(b.startAt);
  };
  const pending = state.tasks.filter((t) => !t.done).sort(byDate);
  const done = state.tasks.filter((t) => t.done).sort(byDate);

  let rendered = 0;
  [...pending, ...done].forEach((task) => {
    const row = buildTaskRow(task);
    if (row) {
      container.appendChild(row);
      rendered++;
    }
  });

  if (rendered === 0) {
    container.innerHTML = '<p class="empty-hint">No tienes tareas.</p>';
  }
}

async function toggleTaskDone(task) {
  const updated = await api(`/api/events/${task.id}`, { method: 'PUT', body: JSON.stringify({ done: !task.done }) });
  const idx = state.tasks.findIndex((t) => t.id === task.id);
  if (idx !== -1) state.tasks[idx] = updated;
  renderTasksList();
  loadMonth(); // refleja el cambio en el calendario/agenda si la tarea tiene fecha
  if (state.remindersMode === 'day') renderRemindersPanel();
}

function populateTaskGroupSelect() {
  const current = taskGroupField.getValue();
  taskGroupField.setOptions(groupSelectOptions());
  taskGroupField.setValue(current);
}

const taskGroupField = createSelectField({ options: [{ value: '', label: 'Sin grupo' }], initialValue: '' });
document.getElementById('task-group-field').appendChild(taskGroupField.element);

const taskDateField = createDateField({ initialValue: null, allowClear: true, placeholder: 'Sin fecha' });
document.getElementById('task-date-field').appendChild(taskDateField.element);

function openTaskModal(task) {
  const modal = document.getElementById('task-modal');
  document.getElementById('task-modal-title').textContent = task ? 'Editar tarea' : 'Nueva tarea';
  document.getElementById('task-id').value = task ? task.id : '';
  document.getElementById('task-title').value = task ? task.title : '';
  taskDateField.setValue(task && task.startAt ? new Date(task.startAt) : null);
  populateTaskGroupSelect();
  taskGroupField.setValue(task && task.groupId ? String(task.groupId) : '');
  document.getElementById('btn-delete-task').classList.toggle('hidden', !task);
  modal.classList.remove('hidden');
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
}

document.getElementById('btn-new-task').addEventListener('click', () => openTaskModal(null));
document.getElementById('btn-cancel-task').addEventListener('click', closeTaskModal);
document.getElementById('btn-close-task').addEventListener('click', closeTaskModal);

document.getElementById('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('task-id').value;
  const dateValue = taskDateField.getValue();
  const groupRaw = taskGroupField.getValue();

  const payload = {
    title: document.getElementById('task-title').value,
    isTask: true,
    // Todo el dia siempre: una tarea no lleva hora concreta, solo fecha
    // limite (o ninguna).
    startAt: dateValue ? `${toDateKey(dateValue)}T00:00:00` : null,
    allDay: true,
    groupId: groupRaw === '' ? null : Number(groupRaw),
  };

  if (id) {
    await api(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/events', { method: 'POST', body: JSON.stringify(payload) });
  }

  closeTaskModal();
  await loadTasks();
  renderTasksList();
  loadMonth();
});

document.getElementById('btn-delete-task').addEventListener('click', async () => {
  const id = document.getElementById('task-id').value;
  if (!id) return;
  if (!confirm('¿Eliminar esta tarea?')) return;
  await api(`/api/events/${id}`, { method: 'DELETE' });
  closeTaskModal();
  await loadTasks();
  renderTasksList();
  loadMonth();
});

// ---------------------------------------------------------------------
// Notas de "Mi espacio" (Fase 2): titulo + texto plano, compartidas entre
// dispositivos igual que eventos/tareas — nada de carpetas ni formato
// todavia (eso es Fase 3 y Fase 4). Mismo patron que el modal de tareas
// de arriba.
// ---------------------------------------------------------------------
async function loadNotes() {
  state.notes = await api('/api/notes');
}

// ---------------------------------------------------------------------
// Ocultar notas: NO es un bloqueo de verdad (no cifra nada, cualquiera
// con acceso a la base de datos veria el contenido igual) — solo evita
// que se lea a primera vista en la pantalla. Una nota oculta se ve
// borrosa en la lista con un boton "Destapar" encima; el icono de ojo de
// cada fila hace lo mismo (ocultar/destapar), son dos formas de llegar a
// la misma accion. La contraseña es opcional y se activa en
// Configuracion > Notas (ver refreshNotesTab en settings.js) — sin ella,
// destapar es instantaneo; con ella activada, hace falta acertarla.
// ---------------------------------------------------------------------
let notesSecurityState = { passwordEnabled: false, hasPassword: false };

async function refreshNotesSecurityState() {
  notesSecurityState = await api('/api/notes-security');
  return notesSecurityState;
}

async function setNoteHidden(note, hidden) {
  await api(`/api/notes/${note.id}`, { method: 'PUT', body: JSON.stringify({ hidden }) });
  await loadNotes();
  renderNotesView();
}

// Punto de entrada comun del icono de ojo y del boton "Destapar": decide
// que pedir (nada, la contraseña, o crear una nueva) segun el estado
// actual de la nota y del ajuste de Configuracion > Notas.
async function toggleNoteHidden(note) {
  await refreshNotesSecurityState();

  if (!note.hidden) {
    // Vas a OCULTARLA. Si tienes activado "pedir contraseña" pero
    // todavia no has puesto ninguna, hace falta crearla primero — no
    // tendria sentido ocultar algo detras de una contraseña que no existe.
    if (notesSecurityState.passwordEnabled && !notesSecurityState.hasPassword) {
      openNotesSetupPasswordModal(note);
    } else {
      await setNoteHidden(note, true);
    }
    return;
  }

  // Vas a DESTAPARLA. Solo hace falta la contraseña si esta activada.
  if (notesSecurityState.passwordEnabled) {
    openNotesVerifyModal(note);
  } else {
    await setNoteHidden(note, false);
  }
}

let pendingVerifyNote = null;

function openNotesVerifyModal(note) {
  pendingVerifyNote = note;
  document.getElementById('notes-verify-password').value = '';
  document.getElementById('notes-verify-error').classList.add('hidden');
  document.getElementById('notes-verify-modal').classList.remove('hidden');
}

function closeNotesVerifyModal() {
  document.getElementById('notes-verify-modal').classList.add('hidden');
  pendingVerifyNote = null;
}

document.getElementById('btn-cancel-notes-verify').addEventListener('click', closeNotesVerifyModal);
document.getElementById('btn-close-notes-verify').addEventListener('click', closeNotesVerifyModal);

document.getElementById('notes-verify-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('notes-verify-password').value;
  const result = await api('/api/notes-security/verify', { method: 'POST', body: JSON.stringify({ password }) });
  if (!result.ok) {
    document.getElementById('notes-verify-error').classList.remove('hidden');
    return;
  }
  const note = pendingVerifyNote;
  closeNotesVerifyModal();
  await setNoteHidden(note, false);
});

let pendingSetupNote = null;

function openNotesSetupPasswordModal(note) {
  pendingSetupNote = note;
  document.getElementById('notes-setup-new-password').value = '';
  document.getElementById('notes-setup-confirm-password').value = '';
  document.getElementById('notes-setup-error').classList.add('hidden');
  document.getElementById('notes-setup-password-modal').classList.remove('hidden');
}

function closeNotesSetupPasswordModal() {
  document.getElementById('notes-setup-password-modal').classList.add('hidden');
  pendingSetupNote = null;
}

document.getElementById('btn-cancel-notes-setup-password').addEventListener('click', closeNotesSetupPasswordModal);
document.getElementById('btn-close-notes-setup-password').addEventListener('click', closeNotesSetupPasswordModal);

document.getElementById('notes-setup-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('notes-setup-error');
  const newPassword = document.getElementById('notes-setup-new-password').value;
  const confirmPassword = document.getElementById('notes-setup-confirm-password').value;
  if (newPassword !== confirmPassword) {
    errorEl.textContent = 'Las dos contraseñas no coinciden.';
    errorEl.classList.remove('hidden');
    return;
  }
  await api('/api/notes-security/password', { method: 'POST', body: JSON.stringify({ newPassword }) });
  await refreshNotesSecurityState();
  const note = pendingSetupNote;
  closeNotesSetupPasswordModal();
  await setNoteHidden(note, true);
});

// Ruta de carpetas de una nota/carpeta, de raiz a padre directo (sin
// incluir su propio nombre) -- solo hace falta cuando la busqueda es de
// TODA la app (ver renderNotesView), para saber donde vive cada
// resultado ya que no estan agrupados por la carpeta donde navegas.
function buildNoteFolderPathLabel(folderId) {
  const parts = [];
  let current = folderId;
  while (current != null) {
    const folder = state.noteFolders.find((f) => f.id === current);
    if (!folder) break;
    parts.unshift(folder.name);
    current = folder.parentId;
  }
  return parts.length ? parts.join(' / ') : 'Raiz';
}

function buildNoteRow(note, { showPath = false } = {}) {
  const row = document.createElement('div');
  row.className = 'note-item' + (note.hidden ? ' is-hidden' : '');

  const eyeBtn = document.createElement('button');
  eyeBtn.type = 'button';
  eyeBtn.className = 'note-item-eye-btn';
  eyeBtn.innerHTML = note.hidden ? EYE_OFF_SVG : EYE_SVG;
  eyeBtn.setAttribute('aria-label', note.hidden ? 'Destapar nota' : 'Ocultar nota');
  eyeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleNoteHidden(note);
  });
  row.appendChild(eyeBtn);

  const contentWrap = document.createElement('div');
  contentWrap.className = 'note-item-content-wrap';

  const content = document.createElement('div');
  content.className = 'note-item-content';

  // Solo el titulo -- el avance del contenido se quito para que el
  // listado ocupe menos alto por nota (ver CLAUDE.md / ronda de pulido).
  const title = document.createElement('span');
  title.className = 'note-item-title';
  title.textContent = note.title;
  content.appendChild(title);
  if (showPath) {
    const path = document.createElement('span');
    path.className = 'note-item-path';
    path.textContent = buildNoteFolderPathLabel(note.folderId);
    content.appendChild(path);
  }
  contentWrap.appendChild(content);
  row.appendChild(contentWrap);

  row.appendChild(buildFavoriteStarBtn(note.favorite, (e) => {
    e.stopPropagation();
    toggleNoteFavorite(note);
  }));

  // Una nota oculta no se abre con un simple clic en la fila — solo el
  // icono de ojo la destapa (sin ningun texto/boton de aviso encima del
  // blur, para no recargar la fila).
  row.addEventListener('click', () => {
    if (note.hidden) return;
    openNoteInEditor(note);
  });
  return row;
}

// Carpeta con icono de ojo (Fase 3, navegacion tipo explorador de
// archivos): la fila entera abre esa carpeta al clicarla; el lapiz
// (aparte, con su propio stopPropagation) la edita sin entrar.
function buildFolderRow(folder, { showPath = false } = {}) {
  const row = document.createElement('div');
  row.className = 'note-item note-folder-row';

  // Siempre el icono generico de carpeta, sin icono/emoji personalizado
  // -- Koku prefirio quitar esa eleccion porque el icono de carpeta ya
  // ayuda bastante a diferenciarla de una nota de un vistazo, y elegir
  // uno propio por carpeta no aportaba tanto.
  const iconWrap = document.createElement('span');
  iconWrap.className = 'note-folder-row-icon';
  iconWrap.style.color = folder.color;
  iconWrap.innerHTML = FOLDER_SVG;
  row.appendChild(iconWrap);

  const contentWrap = document.createElement('div');
  contentWrap.className = 'note-item-content-wrap';
  const title = document.createElement('span');
  title.className = 'note-item-title';
  title.textContent = folder.name;
  contentWrap.appendChild(title);
  if (showPath) {
    const path = document.createElement('span');
    path.className = 'note-item-path';
    path.textContent = buildNoteFolderPathLabel(folder.parentId);
    contentWrap.appendChild(path);
  }
  row.appendChild(contentWrap);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'note-folder-chip-edit';
  editBtn.textContent = '✎';
  editBtn.setAttribute('aria-label', `Editar carpeta ${folder.name}`);
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openNoteFolderModal(folder);
  });
  row.appendChild(editBtn);

  row.appendChild(buildFavoriteStarBtn(folder.favorite, (e) => {
    e.stopPropagation();
    toggleFolderFavorite(folder);
  }));

  row.addEventListener('click', () => {
    state.currentNoteFolderId = folder.id;
    clearNoteSearch();
    renderNotesView();
  });
  return row;
}

// Boton de estrella compartido por filas de nota y de carpeta, y por el
// editor de notas a pantalla completa y el modal de carpeta (ahi se usa
// suelto, sin toggle inmediato -- ver openNoteInEditor/openNoteFolderModal).
function buildFavoriteStarBtn(isFavorite, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'favorite-star-btn' + (isFavorite ? ' is-favorite' : '');
  btn.innerHTML = isFavorite ? STAR_FILLED_SVG : STAR_OUTLINE_SVG;
  btn.setAttribute('aria-label', isFavorite ? 'Quitar de favoritos' : 'Marcar como favorito');
  btn.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
  btn.addEventListener('click', onClick);
  return btn;
}

async function toggleNoteFavorite(note) {
  await api(`/api/notes/${note.id}`, { method: 'PUT', body: JSON.stringify({ favorite: !note.favorite }) });
  await loadNotes();
  renderNotesView();
}

async function toggleFolderFavorite(folder) {
  await api(`/api/note-folders/${folder.id}`, { method: 'PUT', body: JSON.stringify({ favorite: !folder.favorite }) });
  await loadNoteFolders();
  renderNotesView();
}

// Favoritos: preferencia de ESTE dispositivo (localStorage), leida por
// appendFavoriteSortedGroup. "sections" separa con una cabecera
// "Favoritos" / "Todo lo demas" (solo si hay al menos un favorito, para
// no ensenar una cabecera vacia); "merged" (por defecto) simplemente
// ordena los favoritos primero, sin cabeceras, en la misma lista.
function getFavoritesDisplayMode() {
  return localStorage.getItem('favoritesDisplayMode') === 'sections' ? 'sections' : 'merged';
}

// Anade una tanda de filas (subcarpetas O notas, nunca mezcladas entre
// si -- cada tipo mantiene su propio orden de favoritos por separado)
// al contenedor, ya sea con cabeceras o mezcladas segun el ajuste.
// Nombre para ordenar alfabeticamente -- carpetas usan "name", notas
// "title", ambos comparten esta funcion en vez de repetir el ?? en cada
// sitio que ordena una lista mixta de las dos cosas.
function getNoteListItemName(item) {
  return item.name || item.title || '';
}

// Favoritos primero, alfabetico dentro de cada grupo -- usado tanto para
// ordenar carpetas entre si como notas entre si (nunca mezcladas, ver
// renderNotesView/renderNoteTreeLevel: las carpetas SIEMPRE van antes
// que las notas como grupo aparte, esto solo ordena dentro de cada uno).
function compareNoteListItems(a, b) {
  if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
  return getNoteListItemName(a).localeCompare(getNoteListItemName(b));
}

function appendFavoriteSortedGroup(container, items, buildRowFn) {
  if (items.length === 0) return;
  const byName = (a, b) => getNoteListItemName(a).localeCompare(getNoteListItemName(b));
  const favorites = items.filter((i) => i.favorite).sort(byName);
  const rest = items.filter((i) => !i.favorite).sort(byName);

  if (getFavoritesDisplayMode() === 'sections' && favorites.length > 0) {
    const favHeading = document.createElement('div');
    favHeading.className = 'note-list-section-heading';
    favHeading.textContent = 'Favoritos';
    container.appendChild(favHeading);
    favorites.forEach((i) => container.appendChild(buildRowFn(i)));

    if (rest.length > 0) {
      const restHeading = document.createElement('div');
      restHeading.className = 'note-list-section-heading';
      restHeading.textContent = 'Todo lo demas';
      container.appendChild(restHeading);
      rest.forEach((i) => container.appendChild(buildRowFn(i)));
    }
  } else {
    favorites.concat(rest).forEach((i) => container.appendChild(buildRowFn(i)));
  }
}

// Dibuja "donde estas" en Notas: las subcarpetas de aqui arriba, las
// notas de aqui debajo, todo en una sola lista — como el explorador de
// archivos en vista de lista. "Volver" solo se ve si no estas en la
// raiz (currentNoteFolderId === null).
//
// Busqueda (state.noteSearchQuery): por defecto busca en TODA la app
// (todas las notas/carpetas, no solo las de donde estas navegando), y
// cada resultado ensena su ruta de carpeta debajo del nombre (ver
// buildNoteFolderPathLabel) para saber donde vive. El boton "Solo esta
// carpeta" (state.noteSearchCurrentFolderOnly, persistente mientras
// dure la sesion) la restringe a la carpeta actual, como funcionaba
// antes -- sin ruta debajo, porque ya sabes donde estas.
function renderNotesView() {
  const container = document.getElementById('notes-list');
  if (!container) return;
  container.innerHTML = '';

  const query = (state.noteSearchQuery || '').trim().toLowerCase();
  const searchWholeApp = !!query && !state.noteSearchCurrentFolderOnly;

  document.getElementById('btn-note-folder-back').classList.toggle('hidden', state.currentNoteFolderId === null || searchWholeApp);

  if (searchWholeApp) {
    const matchFolders = state.noteFolders.filter((f) => f.name.toLowerCase().includes(query));
    const matchNotes = (state.notes || []).filter((n) => n.title.toLowerCase().includes(query));
    if (matchFolders.length === 0 && matchNotes.length === 0) {
      container.innerHTML = '<p class="empty-hint">Nada coincide con esa busqueda.</p>';
      return;
    }
    appendFavoriteSortedGroup(container, matchFolders, (f) => buildFolderRow(f, { showPath: true }));
    appendFavoriteSortedGroup(container, matchNotes, (n) => buildNoteRow(n, { showPath: true }));
    return;
  }

  let subfolders = state.noteFolders.filter((f) => f.parentId === state.currentNoteFolderId);
  let notesHere = (state.notes || []).filter((n) => n.folderId === state.currentNoteFolderId);

  if (query) {
    subfolders = subfolders.filter((f) => f.name.toLowerCase().includes(query));
    notesHere = notesHere.filter((n) => n.title.toLowerCase().includes(query));
  }

  if (subfolders.length === 0 && notesHere.length === 0) {
    container.innerHTML = `<p class="empty-hint">${query ? 'Nada coincide con esa busqueda.' : 'No hay nada aqui todavia.'}</p>`;
    return;
  }

  appendFavoriteSortedGroup(container, subfolders, buildFolderRow);
  appendFavoriteSortedGroup(container, notesHere, buildNoteRow);
}

function clearNoteSearch() {
  state.noteSearchQuery = '';
  const input = document.getElementById('note-search-input');
  if (input) input.value = '';
}

document.getElementById('note-search-input').addEventListener('input', (e) => {
  state.noteSearchQuery = e.target.value;
  renderNotesView();
});

document.getElementById('note-search-scope-btn').addEventListener('click', () => {
  state.noteSearchCurrentFolderOnly = !state.noteSearchCurrentFolderOnly;
  document.getElementById('note-search-scope-btn').classList.toggle('is-active', state.noteSearchCurrentFolderOnly);
  document.getElementById('note-search-scope-btn').setAttribute('aria-pressed', state.noteSearchCurrentFolderOnly ? 'true' : 'false');
  renderNotesView();
});

document.getElementById('btn-note-folder-back').addEventListener('click', () => {
  const current = state.noteFolders.find((f) => f.id === state.currentNoteFolderId);
  state.currentNoteFolderId = current ? current.parentId : null;
  clearNoteSearch();
  renderNotesView();
});

// Selector de carpeta (opcional) dentro del modal de nota — mismo patron
// que el selector de grupo de las tareas (populateTaskGroupSelect), pero
// con sangria segun la profundidad para que se note el anidado (un
// espacio ancho de verdad, U+3000, que no se colapsa como los espacios
// normales en HTML).
const noteFolderField = createSelectField({
  options: [{ value: '', label: 'Sin carpeta' }],
  initialValue: '',
  onChange: () => {
    captureActiveOpenNoteFromDom();
    renderNoteSectionsPanel();
  },
});
document.getElementById('note-folder-field').appendChild(noteFolderField.element);

function buildFolderSelectOptions(parentId, depth) {
  const children = state.noteFolders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.position - b.position);
  let options = [];
  children.forEach((f) => {
    const indent = '　'.repeat(depth);
    const prefix = depth > 0 ? '↳ ' : '';
    options.push({ value: String(f.id), label: indent + prefix + f.name });
    options = options.concat(buildFolderSelectOptions(f.id, depth + 1));
  });
  return options;
}

function populateNoteFolderSelect() {
  const current = noteFolderField.getValue();
  noteFolderField.setOptions([
    { value: '', label: 'Sin carpeta' },
    ...buildFolderSelectOptions(null, 0),
  ]);
  noteFolderField.setValue(current);
}

// El estado del favorito dentro del modal (nota nueva o existente) vive
// en esta variable simple mientras el modal esta abierto -- se lee al
// guardar (note-form submit) y se actualiza al pulsar la estrella,
// igual que cualquier otro campo del formulario.
let noteModalFavorite = false;

function refreshNoteFavoriteBtn() {
  const btn = document.getElementById('note-favorite-btn');
  btn.innerHTML = noteModalFavorite ? STAR_FILLED_SVG : STAR_OUTLINE_SVG;
  btn.classList.toggle('is-favorite', noteModalFavorite);
  btn.setAttribute('aria-pressed', noteModalFavorite ? 'true' : 'false');
}

document.getElementById('note-favorite-btn').addEventListener('click', () => {
  noteModalFavorite = !noteModalFavorite;
  refreshNoteFavoriteBtn();
  captureActiveOpenNoteFromDom();
  renderNoteSectionsPanel();
});

// ---------------------------------------------------------------------
// Editor de notas con formato (Fase 4): negrita, cursiva, lista con
// viñetas y lista numerada. "note-body" ya no es un <textarea>, es un
// <div contenteditable> — los botones de la barra usan
// document.execCommand(), que aunque esta marcado como "obsoleto" en la
// documentacion sigue funcionando bien en Chrome/Edge/Firefox (los
// navegadores que de verdad se usan aqui) y evita tener que escribir a
// mano toda la logica de negrita/listas sobre el DOM, algo bastante mas
// delicado de lo que parece.
const NOTE_EDITOR_BODY = document.getElementById('note-body');

function execNoteCommand(cmd) {
  document.execCommand(cmd, false, null);
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// Solo los botones con data-cmd son de negrita/cursiva/lista (los de
// tabla -- ver mas abajo -- comparten la clase .note-editor-btn por el
// aspecto visual, pero no tienen data-cmd ni pasan por execCommand).
function refreshNoteEditorToolbar() {
  document.querySelectorAll('#note-body-toolbar .note-editor-btn[data-cmd]').forEach((btn) => {
    const active = document.queryCommandState(btn.dataset.cmd);
    btn.classList.toggle('is-active', !!active);
  });
}

// Al abrir el modal (nota nueva o para editar) el cursor todavia no esta
// dentro del editor, asi que no hay "donde" calcular negrita/lista
// activa todavia -- sin esto, los botones se quedaban pintados con el
// estado de la ULTIMA nota que se habia editado, en vez de apagados.
// Tambien oculta el grupo +Fila/-Fila/+Col/-Col por la misma razon.
function resetNoteEditorToolbar() {
  document.querySelectorAll('#note-body-toolbar .note-editor-btn[data-cmd]').forEach((btn) => btn.classList.remove('is-active'));
  document.getElementById('note-table-context-toolbar').classList.add('hidden');
}

document.querySelectorAll('#note-body-toolbar .note-editor-btn[data-cmd]').forEach((btn) => {
  // mousedown (no click) + preventDefault: si no, el navegador quita la
  // seleccion de texto del editor al pasar el foco al boton ANTES de que
  // se dispare el click, y execCommand ya no tendria sobre que aplicar
  // el formato.
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => execNoteCommand(btn.dataset.cmd));
});

// ---------------------------------------------------------------------
// Tablas dentro de una nota (Fase 4, sub-ronda de tablas): boton
// "Tabla" que abre un popover para pedir filas/columnas antes de
// insertarla (mismo patron que color/icono/fecha en settings.js:
// positionFixedPopover/closeAllPopovers), y 4 botones contextuales
// (+Fila/-Fila/+Col/-Col) que solo aparecen con el cursor dentro de una
// celda, y actuan sobre la fila/columna donde este ese cursor.
// ---------------------------------------------------------------------

// Averigua la celda (td/th) de la tabla del editor donde esta el cursor
// ahora mismo, o null si el cursor no esta dentro de ninguna. Solo se fía
// de window.getSelection() -- no hay ningun otro sitio donde guardar
// "en que celda estoy" salvo la seleccion real del navegador.
function getCurrentTableCell() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  let cell = node ? node.closest('td, th') : null;
  // Al hacer click en una celda VACIA (solo tiene un <br> dentro), el
  // navegador a veces deja el cursor "colgado" de un antepasado
  // (tr/tbody/table) con un offset, en vez de dentro de la celda en si
  // -- pasa sobre todo justo despues de borrar una fila o columna. Se
  // mira el hijo exacto que senala ese offset para intentar resolverlo
  // igual, en vez de dar la celda por no encontrada.
  if (!cell && node && node.nodeType === Node.ELEMENT_NODE) {
    const child = node.childNodes[range.startOffset] || node.childNodes[range.startOffset - 1];
    if (child) {
      cell = child.closest ? child.closest('td, th') : null;
      if (!cell && child.querySelector) cell = child.querySelector('td, th');
    }
  }
  return cell && NOTE_EDITOR_BODY.contains(cell) ? cell : null;
}

function refreshTableContextToolbar() {
  const cell = getCurrentTableCell();
  document.getElementById('note-table-context-toolbar').classList.toggle('hidden', !cell);
  // El boton de grosor de borde refleja el estado de la tabla donde esta
  // el cursor AHORA MISMO -- cada tabla lleva su propio grosor (atributo
  // data-border en el <table>, ver toggleTableBorderThickness), no es un
  // ajuste global del editor.
  const borderBtn = document.getElementById('note-table-border-toggle');
  if (borderBtn) {
    const isThick = cell && cell.closest('table').getAttribute('data-border') === 'thick';
    borderBtn.classList.toggle('is-active', !!isThick);
  }
}

// Junta el refresco de negrita/cursiva/lista y el de la barra contextual
// de tabla en una sola llamada -- se disparan siempre juntos, con el
// mismo cambio de seleccion o tecla dentro del editor.
function refreshNoteEditorState() {
  refreshNoteEditorToolbar();
  refreshTableContextToolbar();
}

// El editor guarda aqui la seleccion de justo antes de abrir el popover
// de "Insertar tabla": al hacer click DENTRO del popover (los campos de
// numero necesitan quedarse con el foco para poder escribir en ellos, asi
// que a diferencia de los botones de formato no se puede evitar que el
// editor pierda el foco) se perderia de vista donde estaba el cursor.
// Guardando el Range a mano se puede "devolver" el cursor a su sitio justo
// antes de insertar la tabla, aunque hayan pasado varios clics por medio.
let savedNoteEditorRange = null;

function saveNoteEditorSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && NOTE_EDITOR_BODY.contains(sel.anchorNode)) {
    savedNoteEditorRange = sel.getRangeAt(0).cloneRange();
    return;
  }
  // Si el editor nunca ha tenido el foco (nota recien abierta, por
  // ejemplo), no hay seleccion de la que partir -- se inserta al final
  // del contenido, como sitio por defecto razonable.
  const range = document.createRange();
  range.selectNodeContents(NOTE_EDITOR_BODY);
  range.collapse(false);
  savedNoteEditorRange = range;
}

function restoreNoteEditorSelection() {
  NOTE_EDITOR_BODY.focus();
  if (!savedNoteEditorRange) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedNoteEditorRange);
}

function clampTableSize(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.min(10, Math.max(1, n));
}

// Ancho/alto por defecto de una tabla nueva, en px -- antes la tabla se
// autoajustaba sola (width:100% + table-layout automatico) al escribir,
// ahora es "constante" desde que se inserta (table-layout:fixed, ver
// styles.css) y se queda en estos valores hasta que se arrastre un borde
// a mano (ver el bloque de redimensionado mas abajo).
const DEFAULT_TABLE_COL_WIDTH = 120;
const DEFAULT_TABLE_ROW_HEIGHT = 36;

function buildTableHtml(rows, cols) {
  // <colgroup> con un <col> por columna: es lo que de verdad manda el
  // ancho de cada columna con table-layout:fixed (los <td> por si solos
  // no bastarian). El saneado del servidor (sanitizeNoteBody en
  // routes/notes.js) valida el "style" de cada <col>/<tr> con una lista
  // blanca MUY estricta (solo "width:Npx"/"height:Npx"), no cualquier CSS.
  const colHtml = `<col style="width:${DEFAULT_TABLE_COL_WIDTH}px">`;
  const colgroupHtml = `<colgroup>${colHtml.repeat(cols)}</colgroup>`;
  let rowsHtml = '';
  for (let r = 0; r < rows; r++) {
    rowsHtml += `<tr style="height:${DEFAULT_TABLE_ROW_HEIGHT}px">${'<td><br></td>'.repeat(cols)}</tr>`;
  }
  // El <div><br></div> de despues da un sitio donde dejar el cursor tras
  // insertar la tabla -- sin el, si la tabla queda como ultimo elemento
  // del editor no habria forma de escribir nada debajo de ella.
  return `<table>${colgroupHtml}<tbody>${rowsHtml}</tbody></table><div><br></div>`;
}

const tableInsertBtn = document.getElementById('note-table-insert-btn');
const tableInsertPopover = document.createElement('div');
tableInsertPopover.className = 'table-insert-popover hidden';
tableInsertPopover.innerHTML = `
  <label>Filas
    <input type="number" id="table-insert-rows" min="1" max="10" value="3" />
  </label>
  <label>Columnas
    <input type="number" id="table-insert-cols" min="1" max="10" value="3" />
  </label>
  <div class="table-insert-actions">
    <button type="button" class="secondary-btn" id="table-insert-cancel">Cancelar</button>
    <button type="button" class="primary-btn" id="table-insert-confirm">Insertar</button>
  </div>
`;
document.body.appendChild(tableInsertPopover);

tableInsertBtn.addEventListener('mousedown', (e) => e.preventDefault());
tableInsertBtn.addEventListener('click', () => {
  const willOpen = tableInsertPopover.classList.contains('hidden');
  if (willOpen) saveNoteEditorSelection();
  closeAllPopovers(tableInsertPopover);
  tableInsertPopover.classList.toggle('hidden');
  if (willOpen) positionFixedPopover(tableInsertBtn, tableInsertPopover, { width: 200 });
});

document.getElementById('table-insert-cancel').addEventListener('click', () => {
  tableInsertPopover.classList.add('hidden');
});

document.getElementById('table-insert-confirm').addEventListener('click', () => {
  const rows = clampTableSize(document.getElementById('table-insert-rows').value);
  const cols = clampTableSize(document.getElementById('table-insert-cols').value);
  tableInsertPopover.classList.add('hidden');
  restoreNoteEditorSelection();
  document.execCommand('insertHTML', false, buildTableHtml(rows, cols));
  refreshNoteEditorState();
});

function addTableRow() {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const row = cell.parentElement;
  const newRow = document.createElement('tr');
  // Misma altura por defecto que una fila nueva desde "Insertar tabla" --
  // luego se puede arrastrar igual que cualquier otra (ver el
  // redimensionado mas abajo).
  newRow.style.height = `${DEFAULT_TABLE_ROW_HEIGHT}px`;
  Array.from(row.children).forEach((existingCell) => {
    const newCell = document.createElement(existingCell.tagName);
    newCell.innerHTML = '<br>';
    newRow.appendChild(newCell);
  });
  row.after(newRow);
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

function removeTableRow() {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const row = cell.parentElement;
  const tbody = row.parentElement;
  const table = row.closest('table');
  // Si es la unica fila que queda, se quita la tabla entera en vez de
  // dejar una tabla sin filas (que no tendria mucho sentido).
  if (tbody.children.length <= 1) table.remove();
  else row.remove();
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// El <colgroup> tiene que tener SIEMPRE un <col> por columna, en el
// mismo orden -- si no, con table-layout:fixed el ancho de cada columna
// dejaria de corresponder a la columna que toca en cuanto se anada o
// quite una. Si por lo que sea la tabla no tiene colgroup (notas de
// antes de esta ronda, guardadas sin el), se crea uno de cero con el
// ancho por defecto para todas las columnas ya existentes.
function ensureTableColgroup(table, colCount) {
  let colgroup = table.querySelector('colgroup');
  if (!colgroup) {
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
    for (let i = 0; i < colCount; i++) {
      const col = document.createElement('col');
      col.style.width = `${DEFAULT_TABLE_COL_WIDTH}px`;
      colgroup.appendChild(col);
    }
  }
  return colgroup;
}

function addTableColumn() {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const row = cell.parentElement;
  const colIndex = Array.from(row.children).indexOf(cell);
  const table = row.closest('table');
  table.querySelectorAll('tr').forEach((tr) => {
    const referenceCell = tr.children[colIndex];
    if (!referenceCell) return;
    const newCell = document.createElement(referenceCell.tagName);
    newCell.innerHTML = '<br>';
    referenceCell.after(newCell);
  });
  const colgroup = ensureTableColgroup(table, row.children.length);
  const newCol = document.createElement('col');
  newCol.style.width = `${DEFAULT_TABLE_COL_WIDTH}px`;
  const referenceCol = colgroup.children[colIndex];
  if (referenceCol) referenceCol.after(newCol);
  else colgroup.appendChild(newCol);
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

function removeTableColumn() {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const row = cell.parentElement;
  const colIndex = Array.from(row.children).indexOf(cell);
  const table = row.closest('table');
  // Igual que con la fila: si es la unica columna, se quita la tabla
  // entera en vez de dejarla sin columnas.
  if (row.children.length <= 1) {
    table.remove();
  } else {
    table.querySelectorAll('tr').forEach((tr) => {
      if (tr.children[colIndex]) tr.children[colIndex].remove();
    });
    const colgroup = table.querySelector('colgroup');
    if (colgroup && colgroup.children[colIndex]) colgroup.children[colIndex].remove();
  }
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// Grosor de borde fino/grueso, por tabla -- atributo data-border="thick"
// en el <table> (ausente = fino, el de siempre). El saneado del servidor
// (sanitizeNoteBody en routes/notes.js) solo deja pasar ese atributo con
// el valor EXACTO "thick", cualquier otra cosa se descarta.
function toggleTableBorderThickness() {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const table = cell.closest('table');
  if (table.getAttribute('data-border') === 'thick') table.removeAttribute('data-border');
  else table.setAttribute('data-border', 'thick');
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

[
  ['note-table-add-row', addTableRow],
  ['note-table-remove-row', removeTableRow],
  ['note-table-add-col', addTableColumn],
  ['note-table-remove-col', removeTableColumn],
  ['note-table-border-toggle', toggleTableBorderThickness],
].forEach(([id, handler]) => {
  const btn = document.getElementById(id);
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', handler);
});

// ---------------------------------------------------------------------
// Redimensionar tablas a mano (estilo Excel): arrastrar el borde derecho
// de una celda cambia el ancho de esa COLUMNA entera (el <col> del
// colgroup); arrastrar el borde inferior cambia el alto de esa FILA
// entera (el <tr>). Doble clic en un borde ajusta esa columna/fila al
// contenido que tenga en ese momento. Nada de esto anade elementos
// nuevos al HTML de la nota -- son listeners en NOTE_EDITOR_BODY que
// detectan la cercania al borde de una celda por posicion del raton, sin
// "tiradores" propios que el saneado del servidor tendria que aprender a
// permitir.
// ---------------------------------------------------------------------
const TABLE_RESIZE_EDGE_PX = 5;
const TABLE_MIN_COL_WIDTH = 40;
const TABLE_MIN_ROW_HEIGHT = 24;

// { type: 'col'|'row', table, col|row, startX/startY, startWidth/startHeight }
// mientras se esta arrastrando un borde; null el resto del tiempo.
let tableResizeDrag = null;

// Averigua si (clientX, clientY) esta cerca del borde derecho o inferior
// de una celda de tabla dentro del editor, y de que tipo. null si no.
function findTableResizeTarget(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const cell = el ? el.closest('td, th') : null;
  if (!cell || !NOTE_EDITOR_BODY.contains(cell)) return null;
  const rect = cell.getBoundingClientRect();

  // El borde de 1px entre dos celdas es "de las dos a la vez" -- segun
  // redondeo, elementFromPoint a veces devuelve la celda de la izquierda/
  // arriba y a veces la de la derecha/abajo para el MISMO pixel. Se
  // comprueban los dos lados de la celda que haya devuelto, no solo el
  // derecho/inferior, para no depender de cual haya tocado.
  if (Math.abs(clientX - rect.left) <= TABLE_RESIZE_EDGE_PX && cell.previousElementSibling) {
    return { type: 'col', cell: cell.previousElementSibling };
  }
  if (Math.abs(clientX - rect.right) <= TABLE_RESIZE_EDGE_PX) {
    return { type: 'col', cell };
  }
  if (Math.abs(clientY - rect.top) <= TABLE_RESIZE_EDGE_PX) {
    const row = cell.parentElement;
    const prevRow = row.previousElementSibling;
    if (prevRow) {
      const colIndex = Array.from(row.children).indexOf(cell);
      const prevCell = prevRow.children[colIndex] || prevRow.children[0];
      if (prevCell) return { type: 'row', cell: prevCell };
    }
  }
  if (Math.abs(clientY - rect.bottom) <= TABLE_RESIZE_EDGE_PX) {
    return { type: 'row', cell };
  }
  return null;
}

function tableColIndex(cell) {
  return Array.from(cell.parentElement.children).indexOf(cell);
}

function tableColElement(table, colIndex) {
  const colgroup = ensureTableColgroup(table, table.rows[0] ? table.rows[0].children.length : 0);
  return colgroup.children[colIndex] || null;
}

// Cursor col-resize/row-resize solo cerca de un borde redimensionable --
// se recalcula en cada movimiento del raton (sin arrastrar todavia).
NOTE_EDITOR_BODY.addEventListener('mousemove', (e) => {
  if (tableResizeDrag) return;
  const target = findTableResizeTarget(e.clientX, e.clientY);
  NOTE_EDITOR_BODY.style.cursor = target ? (target.type === 'col' ? 'col-resize' : 'row-resize') : '';
});
NOTE_EDITOR_BODY.addEventListener('mouseleave', () => {
  if (!tableResizeDrag) NOTE_EDITOR_BODY.style.cursor = '';
});

NOTE_EDITOR_BODY.addEventListener('mousedown', (e) => {
  const target = findTableResizeTarget(e.clientX, e.clientY);
  if (!target) return;
  // Evita que el navegador coloque el cursor de texto o empiece una
  // seleccion al arrastrar un borde -- es un gesto de redimensionar, no
  // de editar contenido.
  e.preventDefault();
  const table = target.cell.closest('table');
  if (target.type === 'col') {
    const col = tableColElement(table, tableColIndex(target.cell));
    if (!col) return;
    tableResizeDrag = { type: 'col', col, startX: e.clientX, startWidth: col.getBoundingClientRect().width };
  } else {
    const row = target.cell.parentElement;
    tableResizeDrag = { type: 'row', row, startY: e.clientY, startHeight: row.getBoundingClientRect().height };
  }
});

document.addEventListener('mousemove', (e) => {
  if (!tableResizeDrag) return;
  if (tableResizeDrag.type === 'col') {
    const delta = e.clientX - tableResizeDrag.startX;
    const newWidth = Math.max(TABLE_MIN_COL_WIDTH, Math.round(tableResizeDrag.startWidth + delta));
    tableResizeDrag.col.style.width = `${newWidth}px`;
  } else {
    const delta = e.clientY - tableResizeDrag.startY;
    const newHeight = Math.max(TABLE_MIN_ROW_HEIGHT, Math.round(tableResizeDrag.startHeight + delta));
    tableResizeDrag.row.style.height = `${newHeight}px`;
  }
});

document.addEventListener('mouseup', () => {
  if (!tableResizeDrag) return;
  tableResizeDrag = null;
  NOTE_EDITOR_BODY.style.cursor = '';
});

// Doble clic en un borde = ajustar esa columna/fila al contenido que
// tenga en ese momento -- scrollWidth/scrollHeight reflejan el tamano
// natural del contenido aunque table-layout:fixed este recortando la
// celda visualmente en pantalla.
// scrollWidth/scrollHeight de la celda tal cual NO sirven para medir su
// tamano "natural": con la celda ya fija a un tamano grande (o igual a
// las demas de su fila/columna), el contenido no desborda nada que
// scrollWidth/scrollHeight puedan detectar -- simplemente devuelven el
// tamano actual, no el minimo que necesitaria el contenido. Se mide con
// un CLON fuera de pantalla, con "width"/"height" en auto (o el ancho
// actual, para la altura) para que el navegador calcule el tamano de
// verdad, y se descarta el clon despues.
function measureTableCellNaturalWidth(cell) {
  const clone = cell.cloneNode(true);
  clone.style.position = 'absolute';
  clone.style.visibility = 'hidden';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.width = 'auto';
  clone.style.whiteSpace = 'nowrap';
  NOTE_EDITOR_BODY.appendChild(clone);
  const width = clone.offsetWidth;
  clone.remove();
  return width;
}

function measureTableCellNaturalHeight(cell, width) {
  const clone = cell.cloneNode(true);
  clone.style.position = 'absolute';
  clone.style.visibility = 'hidden';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.width = `${width}px`;
  clone.style.height = 'auto';
  NOTE_EDITOR_BODY.appendChild(clone);
  const height = clone.offsetHeight;
  clone.remove();
  return height;
}

NOTE_EDITOR_BODY.addEventListener('dblclick', (e) => {
  const target = findTableResizeTarget(e.clientX, e.clientY);
  if (!target) return;
  e.preventDefault();
  const table = target.cell.closest('table');
  if (target.type === 'col') {
    const colIndex = tableColIndex(target.cell);
    const col = tableColElement(table, colIndex);
    if (!col) return;
    const cellsInCol = Array.from(table.querySelectorAll('tr')).map((tr) => tr.children[colIndex]).filter(Boolean);
    const natural = Math.max(TABLE_MIN_COL_WIDTH, ...cellsInCol.map((c) => measureTableCellNaturalWidth(c)));
    col.style.width = `${natural}px`;
  } else {
    const row = target.cell.parentElement;
    const cells = Array.from(row.children);
    // La altura natural depende del ancho ACTUAL de cada celda (el texto
    // hace mas o menos saltos de linea segun cuanto sitio tenga) -- se
    // mide con el ancho que ya tiene ahora mismo, no en auto.
    const natural = Math.max(TABLE_MIN_ROW_HEIGHT, ...cells.map((c) => measureTableCellNaturalHeight(c, c.getBoundingClientRect().width)));
    row.style.height = `${natural}px`;
  }
});

// ---------------------------------------------------------------------
// Imagenes dentro de una nota (Fase 4, ultima sub-ronda): boton "Imagen"
// que abre el selector de archivo nativo, y Ctrl+V para pegar una imagen
// copiada (de una captura de pantalla, de otra web...) directamente
// dentro del editor. Las dos vias acaban subiendo el archivo al servidor
// (routes/noteImages.js) y solo metiendo en el HTML de la nota el enlace
// corto que devuelve -- la imagen entera NO se guarda como texto (base64)
// dentro de la nota, eso se descarto a proposito hablandolo con Koku
// porque hincha la base de datos y hace mas lenta cualquier carga de la
// lista de notas, aunque no estes mirando esa imagen en concreto.
// ---------------------------------------------------------------------
const noteImageBtn = document.getElementById('note-image-insert-btn');
const noteImageFileInput = document.getElementById('note-image-file-input');

async function uploadNoteImage(file) {
  const result = await api('/api/notes/images', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  return result.url;
}

async function insertNoteImageFile(file) {
  const originalLabel = noteImageBtn.textContent;
  noteImageBtn.disabled = true;
  noteImageBtn.textContent = 'Subiendo…';
  try {
    const url = await uploadNoteImage(file);
    restoreNoteEditorSelection();
    document.execCommand('insertHTML', false, `<img src="${url}">`);
    refreshNoteEditorState();
  } catch (err) {
    alert('No se pudo subir la imagen: ' + err.message);
  } finally {
    noteImageBtn.disabled = false;
    noteImageBtn.textContent = originalLabel;
  }
}

noteImageBtn.addEventListener('mousedown', (e) => e.preventDefault());
noteImageBtn.addEventListener('click', () => {
  saveNoteEditorSelection();
  // Vacio antes de abrir el selector: si no, elegir el MISMO archivo dos
  // veces seguidas no dispararia el evento "change" la segunda vez (el
  // navegador solo avisa cuando el valor cambia de verdad).
  noteImageFileInput.value = '';
  noteImageFileInput.click();
});

noteImageFileInput.addEventListener('change', () => {
  const file = noteImageFileInput.files[0];
  if (file) insertNoteImageFile(file);
});

// Solo intercepta el pegado cuando hay de verdad una imagen en el
// portapapeles -- pegar texto normal sigue su camino de siempre (el
// propio navegador ya le quita estilos raros al venir de fuera, el mismo
// comportamiento por defecto de cualquier contenteditable).
NOTE_EDITOR_BODY.addEventListener('paste', (e) => {
  const items = Array.from(e.clipboardData ? e.clipboardData.items : []);
  const imageItem = items.find((item) => item.type.startsWith('image/'));
  if (!imageItem) return;
  e.preventDefault();
  const file = imageItem.getAsFile();
  if (!file) return;
  saveNoteEditorSelection();
  insertNoteImageFile(file);
});

// ---------------------------------------------------------------------
// Bloques de codigo: fuente monoespaciada, SIN colorear por lenguaje --
// eso necesitaria una libreria externa (highlight.js o similar) y de
// momento el frontend entero no tiene ninguna, se dejo fuera a
// proposito. El nombre del lenguaje (si se pone) se guarda igualmente en
// data-lang, solo como etiqueta visual (ver CSS) -- por si se anade
// coloreado de verdad en una ronda futura, ya estaria ahi.
// ---------------------------------------------------------------------

function isCursorInCodeBlock() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  return !!(node && node.closest('pre, code'));
}

// Inserta el bloque de codigo con DOM real (createElement + Range),
// NO con execCommand('insertHTML', ...) como el resto del editor -- con
// un HTML de varios elementos de golpe (pre+code+br, y el div de
// despues), insertHTML deja el cursor al final de TODO lo insertado,
// no dentro de <code> como haria falta para poder escribir el codigo
// ahi mismo (visto en pruebas: el texto escrito se iba al div de
// despues, el bloque se quedaba vacio). Insertando los nodos a mano se
// controla exactamente donde queda el cursor al terminar.
function insertCodeBlockAtSelection(lang) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();

  const pre = document.createElement('pre');
  if (lang) pre.setAttribute('data-lang', lang);
  const code = document.createElement('code');
  code.appendChild(document.createElement('br'));
  pre.appendChild(code);

  // Sitio donde seguir escribiendo FUERA del bloque -- dentro de
  // <code>, Intro nunca sale solo (ver maybeHandleCodeBlockEnter), asi
  // que sin esto no habria forma de escribir nada despues de un bloque
  // que quede al final de la nota.
  const afterDiv = document.createElement('div');
  afterDiv.appendChild(document.createElement('br'));

  const fragment = document.createDocumentFragment();
  fragment.appendChild(pre);
  fragment.appendChild(afterDiv);
  range.insertNode(fragment);

  // Cursor DENTRO de <code>, justo antes del <br> -- ahi es donde tiene
  // que empezar a escribir el codigo.
  const newRange = document.createRange();
  newRange.setStart(code, 0);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

// "```" o "```lenguaje" al principio de una linea vacia + Intro
// convierte esa linea en un bloque de codigo -- estilo Markdown/GitHub.
// Igual que maybeAutoStartNoteList: solo dispara si es TODO lo que hay
// en la linea (node.previousSibling === null), no en medio de una frase.
function maybeAutoStartCodeBlock(e) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !NOTE_EDITOR_BODY.contains(node)) return false;
  if (node.previousSibling) return false;
  const textBefore = node.textContent.slice(0, range.startOffset);
  const match = /^```([a-zA-Z0-9+#.-]{0,20})$/.exec(textBefore);
  if (!match) return false;

  e.preventDefault();
  const eraseRange = document.createRange();
  eraseRange.setStart(node, 0);
  eraseRange.setEnd(node, textBefore.length);
  eraseRange.deleteContents();
  // Tras deleteContents() el propio eraseRange queda colapsado justo en
  // el punto del borrado -- se aplica como la seleccion real del
  // documento para que insertCodeBlockAtSelection() inserte el bloque
  // exactamente ahi (borrar con un Range aparte no mueve solo la
  // seleccion activa).
  sel.removeAllRanges();
  sel.addRange(eraseRange);
  insertCodeBlockAtSelection(match[1]);
  refreshNoteEditorState();
  return true;
}

// Intro DENTRO de un bloque de codigo inserta un salto de linea LITERAL
// (<br>) sin salir del bloque -- el comportamiento normal de Intro
// (nuevo <div>/parrafo) rompería la estructura del <pre><code>. Para
// salir del bloque: clicar debajo (el <div><br></div> que deja
// buildCodeBlockHtml) o la flecha ↓ al final de la ultima linea, como en
// cualquier caja de codigo empotrada en una pagina -- no hace falta un
// atajo especial de "salir".
function maybeHandleCodeBlockEnter(e) {
  if (!isCursorInCodeBlock()) return false;
  e.preventDefault();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return true;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) range.deleteContents();
  // NADA de <br> ni de execCommand('insertHTML', ...) aqui -- probados
  // los dos en pruebas y ambos dejaban el cursor "entre elementos"
  // (justo despues del <br>, sin nada de por medio), y ese limite
  // resulto ser ambiguo: al escribir el texto siguiente, el navegador a
  // veces lo colaba ANTES del <br> en vez de despues (la segunda linea
  // se fusionaba con la primera). En vez de eso, se inserta el "\n"
  // como CARACTER DENTRO de un nodo de texto de verdad (insertData),
  // nunca como nodo/elemento aparte -- sin limite entre elementos que
  // pueda confundir al navegador. .note-editor-body pre code ya tiene
  // white-space:pre-wrap, que respeta los "\n" igual que un <br>.
  let node = range.startContainer;
  let offset = range.startOffset;
  if (node.nodeType !== Node.TEXT_NODE) {
    // El cursor esta "entre elementos" (recien creado el bloque, o justo
    // despues de un salto de linea anterior) -- se crea un nodo de texto
    // ahi mismo para tener donde hacer insertData.
    const textNode = document.createTextNode('');
    range.insertNode(textNode);
    node = textNode;
    offset = 0;
  }
  node.insertData(offset, '\n');
  const newRange = document.createRange();
  newRange.setStart(node, offset + 1);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  return true;
}

document.getElementById('note-code-insert-btn').addEventListener('mousedown', (e) => e.preventDefault());
document.getElementById('note-code-insert-btn').addEventListener('click', () => {
  // Mismo patron que el boton de Tabla: si el editor nunca tuvo el foco
  // (nota recien abierta), cae al final del contenido en vez de fallar.
  saveNoteEditorSelection();
  restoreNoteEditorSelection();
  insertCodeBlockAtSelection('');
  refreshNoteEditorState();
});

// El estado encendido/apagado de cada boton (y si toca ensenar la barra
// contextual de tabla) depende de donde este el cursor ahora mismo, asi
// que se recalcula en cualquier cambio de seleccion o de tecla dentro del
// editor, no solo al pulsar un boton.
NOTE_EDITOR_BODY.addEventListener('keyup', refreshNoteEditorState);
NOTE_EDITOR_BODY.addEventListener('mouseup', refreshNoteEditorState);
NOTE_EDITOR_BODY.addEventListener('focus', refreshNoteEditorState);

// ---------------------------------------------------------------------
// Listas automaticas al estilo Notion: escribir "- "/"* " o "1. " al
// principio de una linea la convierte en lista; Tab/Mayus+Tab anidan y
// desanidan un item dentro de una lista (siguiendo el tipo del nivel de
// arriba). Reutiliza execCommand tal cual, igual que los botones de la
// barra de estado -- no hay logica de listas escrita a mano.
// ---------------------------------------------------------------------

// Si lo que hay justo antes del cursor (y NADA mas en esa linea, ver el
// chequeo de previousSibling) es "-"/"*" o "1.", lo borra y convierte la
// linea en un item de lista de verdad en vez de dejar el texto literal.
function maybeAutoStartNoteList(e) {
  if (isCursorInCodeBlock()) return; // "- "/"1. " dentro de codigo es texto normal, no una lista
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !NOTE_EDITOR_BODY.contains(node)) return;
  // previousSibling === null: no hay nada mas antes en esta linea, para
  // no disparar en medio de una palabra ya escrita (ej. "1.5. " a mitad
  // de una frase).
  if (node.previousSibling) return;
  const textBefore = node.textContent.slice(0, range.startOffset);
  const isBullet = /^[-*]$/.test(textBefore);
  const isNumbered = /^\d+\.$/.test(textBefore);
  if (!isBullet && !isNumbered) return;

  e.preventDefault();
  // Se convierte a lista ANTES de borrar el "-"/"1." (no al reves): si
  // la linea se queda vacia justo debajo de una lista ya existente, el
  // propio navegador a veces "fusiona" ese hueco vacio con la lista
  // vecina en vez de crear una lista nueva separada (se ha visto en
  // pruebas: "- primero" + Intro + Intro + "1. " fusionaba "primero" con
  // el texto nuevo en un unico item). Convirtiendo con el texto todavia
  // dentro de la linea se evita ese caso -- el nodo de texto sigue
  // siendo el mismo despues de convertir (execCommand solo lo reubica
  // dentro del nuevo <li> -- PERO a veces (visto en pruebas) execCommand
  // reconstruye el nodo de texto en vez de reubicar el mismo, dejando
  // `node` apuntando a un nodo ya desconectado del documento. En vez de
  // fiarse de esa referencia vieja, se vuelve a leer la seleccion actual
  // (el cursor sigue en la misma posicion logica tras convertir) y se
  // borra desde ahi, comprobando que el texto siga empezando por lo que
  // se espera antes de tocar nada.
  document.execCommand(isBullet ? 'insertUnorderedList' : 'insertOrderedList', false, null);
  const selAfter = window.getSelection();
  if (selAfter && selAfter.rangeCount > 0) {
    const newNode = selAfter.getRangeAt(0).startContainer;
    if (newNode.nodeType === Node.TEXT_NODE && newNode.textContent.slice(0, textBefore.length) === textBefore) {
      const eraseRange = document.createRange();
      eraseRange.setStart(newNode, 0);
      eraseRange.setEnd(newNode, textBefore.length);
      eraseRange.deleteContents();
    }
  }
  refreshNoteEditorState();
}

// Tab/Mayus+Tab SOLO dentro de una lista -- fuera de una lista se deja
// el Tab normal del navegador (mover el foco), no se intercepta.
function maybeIndentNoteListItem(e) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const li = node ? node.closest('li') : null;
  if (!li || !NOTE_EDITOR_BODY.contains(li)) return;
  e.preventDefault();
  document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);
  refreshNoteEditorState();
}

// Atajos de teclado de formato tipo Notion -- funcionan SIEMPRE, activado
// o no el modo vim de aqui abajo (Koku los pidio como algo aparte, no
// depende de ese ajuste). "code" (posicion fisica de la tecla) en vez de
// "key" para Ctrl+Shift+7/8: con Shift puesto, "key" da el caracter ya
// desplazado (distinto segun el idioma del teclado, en un teclado
// espanol Mayus+7/8 no da "7"/"8"), pero "code" (Digit7/Digit8) es
// siempre la misma tecla fisica pulsada, sea cual sea el teclado.
function maybeHandleNoteFormatShortcut(e) {
  if (!e.ctrlKey && !e.metaKey) return false;
  // Negrita/cursiva/listas no tienen sentido dentro de un bloque de
  // codigo (que se guarda como texto plano) -- se deja pasar el atajo
  // tal cual (el navegador no hace nada especial con Ctrl+B ahi).
  if (isCursorInCodeBlock()) return false;
  const key = e.key.toLowerCase();
  if (key === 'b') { e.preventDefault(); execNoteCommand('bold'); return true; }
  if (key === 'i') { e.preventDefault(); execNoteCommand('italic'); return true; }
  if (e.shiftKey && e.code === 'Digit8') { e.preventDefault(); execNoteCommand('insertUnorderedList'); return true; }
  if (e.shiftKey && e.code === 'Digit7') { e.preventDefault(); execNoteCommand('insertOrderedList'); return true; }
  return false;
}

// ---------------------------------------------------------------------
// Modo "vim" (opt-in, ajuste por dispositivo): subconjunto pequeno a
// proposito -- NO es una replica de vim de verdad (sin registros con
// nombre, macros, comandos ":", repetir con numeros...), es un punto de
// partida para moverse y editar rapido sin soltar el teclado, ampliable
// mas adelante segun lo que haga falta de verdad. A diferencia del vim
// real, los botones de formato/tabla/imagen de la barra de estado siguen
// funcionando en cualquiera de los dos modos (Koku lo pidio asi
// explicitamente).
// ---------------------------------------------------------------------
function isVimModeEnabled() {
  return localStorage.getItem('vimModeEnabled') === 'true';
}

// 'insert' | 'normal' | 'visual' -- SOLO importa si isVimModeEnabled().
// Empieza siempre en 'insert' al abrir o cambiar de nota activa (ver
// loadOpenNoteIntoDom), nunca se hereda de la nota anterior.
let noteEditorVimSubMode = 'insert';

const VIM_MODE_LABELS = { insert: 'INSERTAR', normal: 'NORMAL', visual: 'VISUAL' };
// Orden en el que va rotando el indicativo al clicarlo (ver mas abajo).
const VIM_MODE_CYCLE = ['insert', 'normal', 'visual'];

function refreshVimIndicator() {
  const indicator = document.getElementById('note-editor-vim-indicator');
  const show = isVimModeEnabled() && NOTE_EDITOR_BODY.contentEditable !== 'false';
  indicator.classList.toggle('hidden', !show);
  if (!show) return;
  indicator.textContent = VIM_MODE_LABELS[noteEditorVimSubMode] || VIM_MODE_LABELS.insert;
}

function setVimSubMode(mode) {
  // Al SALIR de visual (a cualquier otro modo) se colapsa la seleccion
  // en vez de dejarla como estaba -- entrar en Normal o Insertar con
  // media pantalla todavia seleccionada seria confuso.
  if (noteEditorVimSubMode === 'visual' && mode !== 'visual') {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) sel.collapseToEnd();
  }
  noteEditorVimSubMode = mode;
  refreshVimIndicator();
}

// Refleja el ajuste guardado (localStorage) en el aspecto del boton
// desde que carga la pagina, no solo despues de tocarlo por primera vez.
document.getElementById('note-editor-vim-toggle-btn').classList.toggle('is-active', isVimModeEnabled());

document.getElementById('note-editor-vim-toggle-btn').addEventListener('click', () => {
  const enabled = !isVimModeEnabled();
  localStorage.setItem('vimModeEnabled', enabled ? 'true' : 'false');
  document.getElementById('note-editor-vim-toggle-btn').classList.toggle('is-active', enabled);
  setVimSubMode('insert');
});

// El indicativo (INSERTAR/NORMAL/VISUAL) es tambien un boton: clicarlo va
// rotando entre los 3 modos, como alternativa al teclado (Esc/i/v) para
// quien prefiera el raton. mousedown con preventDefault, igual que el
// resto de botones de la barra de estado, para que clicarlo no le quite
// el foco/seleccion al editor antes de que el click llegue a disparar.
document.getElementById('note-editor-vim-indicator').addEventListener('mousedown', (e) => e.preventDefault());
document.getElementById('note-editor-vim-indicator').addEventListener('click', () => {
  if (!isVimModeEnabled()) return;
  const next = VIM_MODE_CYCLE[(VIM_MODE_CYCLE.indexOf(noteEditorVimSubMode) + 1) % VIM_MODE_CYCLE.length];
  if (next === 'visual') vimEnterVisualMode();
  else setVimSubMode(next);
  NOTE_EDITOR_BODY.focus();
});

// action: 'move' (mueve el cursor sin seleccionar, modo Normal) o
// 'extend' (agranda la seleccion desde donde empezo, modo Visual).
function vimMoveCaret(direction, granularity, action) {
  const sel = window.getSelection();
  if (sel) sel.modify(action || 'move', direction, granularity);
}

// Entrar en Visual: si el cursor esta colapsado (sin nada seleccionado
// todavia), el primer 'extend' de Selection.modify() fija el ancla justo
// ahi y empieza a agrandar desde ese punto -- no hace falta preparar nada
// mas a mano.
function vimEnterVisualMode() {
  setVimSubMode('visual');
}

// Borra el bloque de texto (div/p/li) donde este el cursor -- SOLO fuera
// de una tabla, para no borrar una celda entera (y liarla) sin querer.
function vimDeleteCurrentLine() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const node = sel.getRangeAt(0).startContainer;
  const containerEl = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (containerEl && containerEl.closest('td, th')) return;
  // Selecciona la linea VISUAL entera (de "lineboundary" a
  // "lineboundary") y la borra -- mas fiable que buscar un <div>/<p>/
  // <li> en el DOM: la PRIMERA linea de una nota nueva es texto suelto
  // colgando directamente de NOTE_EDITOR_BODY, sin ningun bloque que lo
  // envuelva (eso solo aparece a partir del primer Intro que se pulsa
  // en esa nota), asi que buscar closest('div, p, li') fallaba ahi.
  sel.modify('move', 'left', 'lineboundary');
  sel.modify('extend', 'right', 'lineboundary');
  // Se lleva tambien el salto de linea de despues (si lo hay), para que
  // las lineas de abajo suban un puesto en vez de dejar una linea vacia.
  sel.modify('extend', 'right', 'character');
  document.execCommand('delete', false, null);
  refreshNoteEditorState();
}

const VIM_DD_TIMEOUT_MS = 600;
let vimPendingD = false;
let vimPendingDTimer = null;

// Se llama SOLO cuando isVimModeEnabled() y estamos en modo Normal.
// Por defecto CUALQUIER tecla se bloquea (preventDefault, no escribe
// nada) salvo que este en la lista de comandos de abajo -- asi nunca se
// escribe sin querer estando en Normal. Las combinaciones con Ctrl/Cmd/
// Alt (copiar, pegar, deshacer del sistema...) se dejan pasar tal cual,
// no forman parte de estos comandos.
function handleVimNormalKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Escape') {
    // Ya estamos en Normal -- no hace falta cambiar nada, pero SI hay
    // que cortar la propagacion (ver el otro Escape mas arriba): si no,
    // llega igual al atajo global de Escape de settings.js y cierra el
    // editor entero.
    e.preventDefault();
    e.stopPropagation();
    vimPendingD = false;
    return;
  }
  const passthroughKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'];
  if (passthroughKeys.includes(e.key)) {
    vimPendingD = false;
    return;
  }

  e.preventDefault();
  const key = e.key;
  if (key !== 'd') vimPendingD = false;

  switch (key) {
    case 'h': vimMoveCaret('backward', 'character'); break;
    case 'l': vimMoveCaret('forward', 'character'); break;
    case 'j': vimMoveCaret('forward', 'line'); break;
    case 'k': vimMoveCaret('backward', 'line'); break;
    case 'w': vimMoveCaret('forward', 'word'); break;
    case 'b': vimMoveCaret('backward', 'word'); break;
    case '0': vimMoveCaret('left', 'lineboundary'); break;
    case '$': vimMoveCaret('right', 'lineboundary'); break;
    case 'i': setVimSubMode('insert'); break;
    case 'a': vimMoveCaret('forward', 'character'); setVimSubMode('insert'); break;
    case 'o':
      vimMoveCaret('right', 'lineboundary');
      document.execCommand('insertParagraph', false, null);
      setVimSubMode('insert');
      break;
    case 'x': document.execCommand('forwardDelete', false, null); break;
    case 'u': document.execCommand('undo', false, null); break;
    case 'v': vimEnterVisualMode(); break;
    case 'd':
      if (vimPendingD) {
        vimDeleteCurrentLine();
        vimPendingD = false;
      } else {
        vimPendingD = true;
        clearTimeout(vimPendingDTimer);
        vimPendingDTimer = setTimeout(() => { vimPendingD = false; }, VIM_DD_TIMEOUT_MS);
      }
      break;
    default:
      break;
  }
  refreshNoteEditorState();
}

// Se llama SOLO en modo Visual. Las mismas teclas de movimiento que en
// Normal, pero AGRANDANDO la seleccion en vez de solo mover el cursor
// (action 'extend' en vez de 'move', ver vimMoveCaret). y/d actuan sobre
// lo seleccionado y vuelven a Normal solas -- no hace falta pulsar nada
// mas para salir. Subconjunto minimo a proposito: sin V (seleccion por
// lineas) ni Ctrl+V (bloque rectangular), que aportan poco en una nota
// normal frente a lo mucho mas grandes que son de construir bien.
function handleVimVisualKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    setVimSubMode('normal'); // esto ya colapsa la seleccion (ver setVimSubMode)
    return;
  }
  if (e.key === 'Tab') return;

  e.preventDefault();
  switch (e.key) {
    case 'h': vimMoveCaret('backward', 'character', 'extend'); break;
    case 'l': vimMoveCaret('forward', 'character', 'extend'); break;
    case 'j': vimMoveCaret('forward', 'line', 'extend'); break;
    case 'k': vimMoveCaret('backward', 'line', 'extend'); break;
    case 'w': vimMoveCaret('forward', 'word', 'extend'); break;
    case 'b': vimMoveCaret('backward', 'word', 'extend'); break;
    case '0': vimMoveCaret('left', 'lineboundary', 'extend'); break;
    case '$': vimMoveCaret('right', 'lineboundary', 'extend'); break;
    case 'y':
      document.execCommand('copy');
      setVimSubMode('normal');
      break;
    case 'd':
      document.execCommand('delete', false, null);
      setVimSubMode('normal');
      break;
    default:
      break;
  }
  refreshNoteEditorState();
}

NOTE_EDITOR_BODY.addEventListener('keydown', (e) => {
  if (isVimModeEnabled()) {
    if (noteEditorVimSubMode === 'normal') {
      handleVimNormalKeydown(e);
      return;
    }
    if (noteEditorVimSubMode === 'visual') {
      handleVimVisualKeydown(e);
      return;
    }
    if (e.key === 'Escape') {
      // stopPropagation es imprescindible: settings.js tiene un atajo
      // GLOBAL de Escape (document, no solo aqui) que cierra el editor
      // de notas entero -- sin cortar la propagacion, el Esc para entrar
      // en modo Normal tambien burbujeaba hasta ese atajo y cerraba la
      // nota (con el aviso de cambios sin guardar si tocaba), visto en
      // pruebas.
      e.preventDefault();
      e.stopPropagation();
      setVimSubMode('normal');
      return;
    }
  }
  if (maybeHandleNoteFormatShortcut(e)) return;
  if (e.key === ' ') maybeAutoStartNoteList(e);
  else if (e.key === 'Tab') maybeIndentNoteListItem(e);
  else if (e.key === 'Enter') {
    if (maybeHandleCodeBlockEnter(e)) return;
    maybeAutoStartCodeBlock(e);
  }
});

// Una nota de antes de la Fase 4 tiene bodyFormat "text": su contenido es
// texto plano tal cual, nunca se penso para interpretarse como HTML. Para
// ensenarla en el editor nuevo sin que "<", ">" o "&" se rompan (o, peor,
// se interpreten como etiquetas), se escapa primero y los saltos de
// linea se convierten a <br> a mano, ya que un <div> normal no respeta
// saltos de linea de un texto plano como si fuera un <textarea>.
function legacyNoteBodyToHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------------
// Notas abiertas a la vez (multi-nota): solo hay UN <div contenteditable>
// en el DOM (NOTE_EDITOR_BODY, el de siempre) -- al cambiar de nota
// activa se vuelca su contenido al objeto de la nota que se abandona y
// se carga el de la nueva nota activa. Esto reutiliza TAL CUAL toda la
// logica de arriba (execCommand, tablas, imagenes) sin cambiar nada de
// su comportamiento, solo pasa a operar sobre "la nota activa" en vez de
// "la unica nota del modal". Cada entrada usa una "key" estable (ver
// makeOpenNoteKey, no el id) para poder identificarla incluso antes de
// que exista un id real en el servidor (nota nueva sin guardar aun).
// ---------------------------------------------------------------------

// crypto.randomUUID() solo funciona en "contextos seguros" (https o
// localhost) -- el movil se conecta por wifi local con http normal (ver
// CLAUDE.md), asi que ahi seria undefined y romperia crear notas nuevas.
// No hace falta que sea un UUID de verdad, solo unico dentro de esta
// pestana: timestamp + numero aleatorio de sobra.
function makeOpenNoteKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function findOpenNote(key) {
  return state.openNotes.find((n) => n.key === key);
}

// "Sucia" (cambios sin guardar): una nota nueva sin id todavia SIEMPRE
// cuenta como sucia (no hay ninguna version en el servidor con la que
// comparar). Una nota ya guardada se compara contra su ultima version
// persistida (saved*), actualizada cada vez que se guarda con exito.
function isOpenNoteDirty(entry) {
  return !entry.id
    || entry.title !== entry.savedTitle
    || entry.bodyHtml !== entry.savedBodyHtml
    || entry.folderId !== entry.savedFolderId
    || entry.favorite !== entry.savedFavorite;
}

function noteEntrySnapshot(note) {
  const body = note && note.body ? note.body : '';
  const bodyHtml = note && note.bodyFormat === 'html' ? body : legacyNoteBodyToHtml(body);
  const folderId = note ? note.folderId : state.currentNoteFolderId;
  const entry = {
    key: makeOpenNoteKey(),
    id: note ? note.id : null,
    title: note ? note.title : '',
    bodyHtml,
    folderId,
    favorite: note ? !!note.favorite : false,
    expanded: false,
    // Modo lectura/edicion: por nota abierta, no global del editor (ver
    // applyNoteEditorReadMode) -- por defecto edicion, como pidio Koku.
    readMode: false,
  };
  // Para una nota ya existente, lo que acabamos de cargar ES lo que hay
  // en el servidor -- de ahi parte la comparacion de "sucia" de arriba.
  entry.savedTitle = entry.title;
  entry.savedBodyHtml = entry.bodyHtml;
  entry.savedFolderId = entry.folderId;
  entry.savedFavorite = entry.favorite;
  return entry;
}

// Vuelca lo que hay AHORA MISMO en el DOM (titulo/contenido/carpeta/
// favorito) al objeto de la nota activa -- se llama justo antes de
// cambiar de nota, cerrar una nota, o guardar, para que el objeto en
// state.openNotes nunca se quede desactualizado respecto a lo que se ve
// en pantalla.
function captureActiveOpenNoteFromDom() {
  const entry = findOpenNote(state.activeOpenNoteKey);
  if (!entry) return;
  entry.title = document.getElementById('note-title').value;
  entry.bodyHtml = NOTE_EDITOR_BODY.innerHTML;
  const folderRaw = noteFolderField.getValue();
  entry.folderId = folderRaw === '' ? null : Number(folderRaw);
  entry.favorite = noteModalFavorite;
}

// Alterna entre editar (por defecto) y solo lectura para la nota activa
// -- es un ajuste POR NOTA ABIERTA (entry.readMode), asi que cada una
// mantiene su propio modo mientras siga abierta, no se comparte entre
// ellas ni se guarda en el servidor (es puramente de esta sesion del
// editor). En modo lectura no solo se desactiva el cuerpo: tambien el
// titulo y los botones de guardar/eliminar/formato, para que "no tocar
// nada" cubra la nota entera, no solo el texto.
function applyNoteEditorReadMode(readOnly) {
  NOTE_EDITOR_BODY.contentEditable = readOnly ? 'false' : 'true';
  document.getElementById('note-title').readOnly = readOnly;
  const modeBtn = document.getElementById('note-editor-read-mode-btn');
  modeBtn.textContent = readOnly ? 'Editar' : 'Modo lectura';
  modeBtn.setAttribute('aria-pressed', readOnly ? 'true' : 'false');
  document.querySelectorAll('#note-body-toolbar .note-editor-btn[data-cmd], #note-table-insert-btn, #note-image-insert-btn').forEach((b) => { b.disabled = readOnly; });
  if (readOnly) {
    document.getElementById('note-table-context-toolbar').classList.add('hidden');
    document.getElementById('btn-delete-note').classList.add('hidden');
  }
  document.querySelector('#note-form button[type="submit"]').classList.toggle('hidden', readOnly);
  // El indicativo de modo vim (si esta activado) no tiene sentido en
  // solo lectura -- refreshVimIndicator ya lo oculta solo mirando
  // contentEditable, pero hay que llamarlo aqui para que se actualice en
  // cuanto cambia el modo lectura, no solo al tocar algo del vim.
  refreshVimIndicator();
}

document.getElementById('note-editor-read-mode-btn').addEventListener('click', () => {
  const entry = findOpenNote(state.activeOpenNoteKey);
  if (!entry) return;
  entry.readMode = !entry.readMode;
  // Antes de aplicar el modo lectura hay que dejar "Eliminar" en el
  // estado que le toca segun si la nota tiene id (igual que hace
  // loadOpenNoteIntoDom) -- applyNoteEditorReadMode solo AÑADE el
  // ocultado cuando toca, nunca lo deshace por su cuenta.
  document.getElementById('btn-delete-note').classList.toggle('hidden', !entry.id);
  applyNoteEditorReadMode(entry.readMode);
});

function loadOpenNoteIntoDom(entry) {
  document.getElementById('note-id').value = entry.id || '';
  document.getElementById('note-title').value = entry.title;
  NOTE_EDITOR_BODY.innerHTML = entry.bodyHtml;
  resetNoteEditorToolbar();
  populateNoteFolderSelect();
  noteFolderField.setValue(entry.folderId ? String(entry.folderId) : '');
  document.getElementById('btn-delete-note').classList.toggle('hidden', !entry.id);
  noteModalFavorite = entry.favorite;
  refreshNoteFavoriteBtn();
  applyNoteEditorReadMode(entry.readMode);
  setVimSubMode('insert');
}

function switchActiveOpenNote(key) {
  if (key === state.activeOpenNoteKey) return;
  captureActiveOpenNoteFromDom();
  const entry = findOpenNote(key);
  if (!entry) return;
  state.activeOpenNoteKey = key;
  loadOpenNoteIntoDom(entry);
  renderNoteSectionsPanel();
}

// Quita una nota de la lista de abiertas SIN preguntar nada (el aviso de
// cambios sin guardar, si hace falta, ya se resolvio antes de llamar
// aqui) y, si era la activa, pasa a otra abierta o cierra la vista
// entera si no queda ninguna.
function removeOpenNoteAndAdvance(key) {
  state.openNotes = state.openNotes.filter((n) => n.key !== key);
  if (state.activeOpenNoteKey !== key) return;
  const next = state.openNotes[0];
  if (next) {
    state.activeOpenNoteKey = next.key;
    loadOpenNoteIntoDom(next);
  } else {
    state.activeOpenNoteKey = null;
    document.getElementById('note-editor-view').classList.add('hidden');
    NOTE_EDITOR_BODY.innerHTML = '';
  }
}

// Cierra una nota abierta -- si tiene cambios sin guardar, pregunta
// confirmacion antes (Koku lo pidio explicitamente: nada de autoguardado
// silencioso al cerrar). Si es la nota activa, primero se vuelca el DOM
// al objeto para que la comprobacion de "sucia" sea sobre lo que se ve
// de verdad en pantalla, no sobre una foto vieja.
function closeOpenNote(key) {
  const entry = findOpenNote(key);
  if (!entry) return;
  if (key === state.activeOpenNoteKey) captureActiveOpenNoteFromDom();
  if (isOpenNoteDirty(entry)) {
    const label = entry.title || 'Nota sin titulo';
    if (!confirm(`"${label}" tiene cambios sin guardar. ¿Cerrar sin guardar?`)) return;
  }
  removeOpenNoteAndAdvance(key);
  renderNoteSectionsPanel();
}

// "openNoteInEditor": si la nota (con id real) ya esta abierta, solo se
// activa -- no se duplica en la lista de notas abiertas. Si no, se anade
// como una entrada nueva y se activa.
function openNoteInEditor(note) {
  const existing = note ? state.openNotes.find((n) => n.id === note.id) : null;
  if (existing) {
    switchActiveOpenNote(existing.key);
  } else {
    if (state.activeOpenNoteKey) captureActiveOpenNoteFromDom();
    const entry = noteEntrySnapshot(note);
    state.openNotes.push(entry);
    state.activeOpenNoteKey = entry.key;
    loadOpenNoteIntoDom(entry);
  }
  renderNoteSectionsPanel();
  document.getElementById('note-editor-view').classList.remove('hidden');
  document.getElementById('note-title').focus();
}

// "Volver": cierra cada nota abierta una a una (mismo aviso de cambios
// sin guardar que cerrar una sola desde el panel de Secciones). Si el
// usuario cancela el cierre de alguna, la vista se queda abierta con las
// que falten -- Volver no se salta el aviso de ninguna.
function closeNoteEditorView() {
  const keys = state.openNotes.map((n) => n.key);
  for (const key of keys) {
    closeOpenNote(key);
    if (findOpenNote(key)) return;
  }
}

// ---------------------------------------------------------------------
// Panel "Secciones": lista de notas abiertas a la vez. Cada fila tiene
// un desplegable ("ver secciones de dentro" -- placeholder por ahora,
// el editor no tiene todavia ningun concepto de titulos/encabezados
// dentro del cuerpo de la nota, eso queda para una ronda futura), el
// nombre (clic = activarla), un punto si tiene cambios sin guardar, y un
// boton para cerrarla.
// ---------------------------------------------------------------------

function renderNoteSectionsPanel() {
  const list = document.getElementById('note-sections-list');
  if (!list) return;
  list.innerHTML = '';
  state.openNotes.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'note-open-item' + (entry.key === state.activeOpenNoteKey ? ' is-active' : '');

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'note-open-item-expand-btn';
    expandBtn.setAttribute('aria-label', entry.expanded ? 'Ocultar secciones' : 'Ver secciones');
    expandBtn.textContent = entry.expanded ? '▾' : '▸';
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      entry.expanded = !entry.expanded;
      renderNoteSectionsPanel();
    });
    row.appendChild(expandBtn);

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'note-open-item-name';
    nameBtn.textContent = entry.title || 'Nota sin titulo';
    nameBtn.addEventListener('click', () => switchActiveOpenNote(entry.key));
    row.appendChild(nameBtn);

    if (isOpenNoteDirty(entry)) {
      const dot = document.createElement('span');
      dot.className = 'note-open-item-dirty-dot';
      dot.setAttribute('aria-label', 'Cambios sin guardar');
      row.appendChild(dot);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'note-open-item-close-btn';
    closeBtn.setAttribute('aria-label', 'Cerrar nota');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeOpenNote(entry.key);
    });
    row.appendChild(closeBtn);

    list.appendChild(row);

    if (entry.expanded) {
      const placeholder = document.createElement('div');
      placeholder.className = 'note-open-item-sections-placeholder';
      placeholder.textContent = 'Sin secciones todavia.';
      list.appendChild(placeholder);
    }
  });
}

// ---------------------------------------------------------------------
// Panel "Arbol": navegacion tipo arbol (plegable por carpeta) de TODAS
// las carpetas/notas -- reutiliza state.noteFolders/state.notes, ya
// cargados enteros de antes (loadNoteFolders/loadNotes), sin ninguna
// llamada nueva a la API. El plegado de cada carpeta se guarda aparte
// (noteTreeExpandedFolderIds, por id) para que sobreviva a que
// state.noteFolders se recargue con objetos nuevos.
// ---------------------------------------------------------------------
const noteTreeExpandedFolderIds = new Set();

function renderNoteTreeLevel(container, parentId, depth) {
  const activeEntry = findOpenNote(state.activeOpenNoteKey);
  const folders = state.noteFolders
    .filter((f) => f.parentId === parentId)
    .slice()
    .sort(compareNoteListItems);
  const notes = (state.notes || [])
    .filter((n) => n.folderId === parentId)
    .slice()
    .sort(compareNoteListItems);

  folders.forEach((folder) => {
    const expanded = noteTreeExpandedFolderIds.has(folder.id);
    const row = document.createElement('div');
    row.className = 'note-tree-row note-tree-folder-row';
    row.style.paddingLeft = `${0.4 + depth}rem`;

    const toggle = document.createElement('span');
    toggle.className = 'note-tree-toggle';
    toggle.textContent = expanded ? '▾' : '▸';
    row.appendChild(toggle);

    const icon = document.createElement('span');
    icon.className = 'note-tree-folder-icon';
    icon.innerHTML = FOLDER_SVG;
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'note-tree-item-name';
    name.textContent = folder.name;
    row.appendChild(name);

    row.addEventListener('click', () => {
      if (expanded) noteTreeExpandedFolderIds.delete(folder.id);
      else noteTreeExpandedFolderIds.add(folder.id);
      renderNoteTreePanel();
    });
    container.appendChild(row);
    if (expanded) renderNoteTreeLevel(container, folder.id, depth + 1);
  });

  notes.forEach((note) => {
    const row = document.createElement('div');
    row.className = 'note-tree-row note-tree-note-row' + (activeEntry && activeEntry.id === note.id ? ' is-active' : '');
    row.style.paddingLeft = `${0.4 + depth + 1}rem`;

    const icon = document.createElement('span');
    icon.className = 'note-tree-note-icon';
    icon.innerHTML = NOTE_FILE_SVG;
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'note-tree-item-name';
    name.textContent = note.title;
    row.appendChild(name);

    row.addEventListener('click', () => openNoteInEditor(note));
    container.appendChild(row);
  });
}

function renderNoteTreePanel() {
  const container = document.getElementById('note-tree-list');
  if (!container) return;
  container.innerHTML = '';
  if (state.noteFolders.length === 0 && (state.notes || []).length === 0) {
    container.innerHTML = '<p class="empty-hint">No hay notas todavia.</p>';
    return;
  }
  renderNoteTreeLevel(container, null, 0);
}

document.getElementById('note-tree-new-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  openNoteInEditor(null);
});

// Solo uno de los dos paneles laterales (Arbol/Secciones) se ve a la vez
// -- volver a clicar el que ya esta activo lo cierra sin abrir el otro.
function setActiveNoteEditorPanel(panel) {
  const treePanel = document.getElementById('note-tree-panel');
  const sectionsPanel = document.getElementById('note-sections-panel');
  const treeBtn = document.getElementById('note-editor-toggle-tree');
  const sectionsBtn = document.getElementById('note-editor-toggle-sections');
  treePanel.classList.toggle('hidden', panel !== 'tree');
  sectionsPanel.classList.toggle('hidden', panel !== 'sections');
  treeBtn.classList.toggle('is-active', panel === 'tree');
  sectionsBtn.classList.toggle('is-active', panel === 'sections');
  if (panel === 'tree') renderNoteTreePanel();
}

document.getElementById('note-editor-toggle-tree').addEventListener('click', () => {
  const isOpen = !document.getElementById('note-tree-panel').classList.contains('hidden');
  setActiveNoteEditorPanel(isOpen ? null : 'tree');
});

document.getElementById('note-editor-toggle-sections').addEventListener('click', () => {
  const isOpen = !document.getElementById('note-sections-panel').classList.contains('hidden');
  setActiveNoteEditorPanel(isOpen ? null : 'sections');
});

document.getElementById('btn-new-note').addEventListener('click', () => openNoteInEditor(null));
// Atajo rapido en la topbar, junto a "+ Nuevo evento"/"+ Nueva tarea" --
// abre directamente el editor, sin tener que entrar antes en Mi espacio.
document.getElementById('btn-new-note-topbar').addEventListener('click', () => openNoteInEditor(null));
document.getElementById('btn-close-note-editor').addEventListener('click', closeNoteEditorView);

// El dot de "sin guardar" del panel de Secciones debe reflejar lo que se
// escribe AHORA, no solo lo que habia la ultima vez que se cambio de
// nota -- de ahi capturar del DOM tambien en cada input del titulo/
// contenido, no solo al cambiar de nota o guardar.
document.getElementById('note-title').addEventListener('input', () => {
  captureActiveOpenNoteFromDom();
  renderNoteSectionsPanel();
});
NOTE_EDITOR_BODY.addEventListener('input', () => {
  captureActiveOpenNoteFromDom();
  renderNoteSectionsPanel();
});

document.getElementById('note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  captureActiveOpenNoteFromDom();
  const entry = findOpenNote(state.activeOpenNoteKey);
  // El boton "Guardar" ya se oculta en modo lectura, pero Ctrl+Intro
  // (enableCtrlEnterSubmit) llama a requestSubmit() directamente sin
  // pasar por ningun boton -- sin esta comprobacion, se podria guardar
  // igual estando en modo lectura.
  if (!entry || entry.readMode) return;
  // Si el editor quedo vacio de verdad, se manda null en vez de basura
  // tipo "<br>" que algunos navegadores dejan suelta tras borrar todo el
  // contenido. "Vacio de verdad" no es lo mismo que "sin texto": una nota
  // con solo una imagen o una tabla vacia no tiene texto pero SI tiene
  // contenido que guardar, asi que ademas del texto se comprueba si queda
  // algun <img> o <table> sueltos. El formulario solo se puede enviar con
  // la nota activa (es el unico <div contenteditable> que existe), asi
  // que NOTE_EDITOR_BODY en este momento es justo el contenido de "entry".
  const hasNoteContent = NOTE_EDITOR_BODY.textContent.trim() !== '' || NOTE_EDITOR_BODY.querySelector('img, table');
  const payload = {
    title: entry.title,
    body: hasNoteContent ? entry.bodyHtml : null,
    bodyFormat: 'html',
    folderId: entry.folderId,
    favorite: entry.favorite,
  };

  let saved;
  if (entry.id) {
    saved = await api(`/api/notes/${entry.id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    saved = await api('/api/notes', { method: 'POST', body: JSON.stringify(payload) });
  }

  // Tras guardar, "saved*" pasa a ser lo que ahora hay en el servidor --
  // la nota deja de estar "sucia" hasta el siguiente cambio. A
  // diferencia del modal de antes, Guardar YA NO cierra el editor: puede
  // haber otras notas abiertas a la vez que se seguirian editando.
  entry.id = saved.id;
  entry.savedTitle = entry.title;
  entry.savedBodyHtml = entry.bodyHtml;
  entry.savedFolderId = entry.folderId;
  entry.savedFavorite = entry.favorite;
  document.getElementById('note-id').value = entry.id;
  document.getElementById('btn-delete-note').classList.remove('hidden');
  renderNoteSectionsPanel();
  await loadNotes();
  renderNotesView();
});

document.getElementById('btn-delete-note').addEventListener('click', async () => {
  const entry = findOpenNote(state.activeOpenNoteKey);
  if (!entry || !entry.id) return;
  if (!confirm('¿Eliminar esta nota?')) return;
  await api(`/api/notes/${entry.id}`, { method: 'DELETE' });
  removeOpenNoteAndAdvance(entry.key);
  renderNoteSectionsPanel();
  await loadNotes();
  renderNotesView();
});

// ---------------------------------------------------------------------
// Carpetas de notas (Fase 3): solo organizacion (nombre/icono/color),
// sistema propio SEPARADO de los Grupos del calendario. Pueden contener
// otras carpetas -- navegacion tipo explorador de archivos (ver
// renderNotesView arriba). Sin PIN ni bloqueo — eso ya se resolvio por
// nota individual con "ocultar".
// ---------------------------------------------------------------------
async function loadNoteFolders() {
  state.noteFolders = await api('/api/note-folders');
}

// createColorField vive en settings.js (widget generico, tambien lo usa
// el formulario de Grupos) — se crea aqui LA PRIMERA VEZ que hace falta
// (al abrir el modal), nunca al cargar la pagina, porque settings.js se
// carga DESPUES de app.js y todavia no existiria esa funcion si se
// llamara nada mas cargar. Ya no hay selector de icono para carpetas
// (se quito: el icono generico de FOLDER_SVG ya diferencia bien una
// carpeta de una nota, no hacia falta elegir uno propio por carpeta).
let noteFolderColorField = null;
let noteFolderModalFavorite = false;

function ensureNoteFolderFields() {
  if (noteFolderColorField) return;
  noteFolderColorField = createColorField({ initialValue: '#5b8cff' });
  document.getElementById('note-folder-color-field').appendChild(noteFolderColorField.element);
}

function refreshNoteFolderFavoriteBtn() {
  const btn = document.getElementById('note-folder-favorite-btn');
  btn.innerHTML = noteFolderModalFavorite ? STAR_FILLED_SVG : STAR_OUTLINE_SVG;
  btn.classList.toggle('is-favorite', noteFolderModalFavorite);
  btn.setAttribute('aria-pressed', noteFolderModalFavorite ? 'true' : 'false');
}

document.getElementById('note-folder-favorite-btn').addEventListener('click', () => {
  noteFolderModalFavorite = !noteFolderModalFavorite;
  refreshNoteFolderFavoriteBtn();
});

// Carpeta nueva: el padre por defecto es "donde estas" navegando ahora
// mismo (currentNoteFolderId) -- si estas dentro de "Trabajo" y creas
// una carpeta, se crea DENTRO de "Trabajo", sin tener que elegirlo a
// mano. Al editar una carpeta ya existente, su padre no se toca aqui
// (no hay forma de "mover" una carpeta desde este modal todavia).
function openNoteFolderModal(folder) {
  ensureNoteFolderFields();
  document.getElementById('note-folder-modal-title').textContent = folder ? 'Editar carpeta' : 'Nueva carpeta';
  document.getElementById('note-folder-id').value = folder ? folder.id : '';
  document.getElementById('note-folder-name').value = folder ? folder.name : '';
  noteFolderColorField.setValue(folder ? folder.color : '#5b8cff');
  document.getElementById('btn-delete-note-folder').classList.toggle('hidden', !folder);
  noteFolderModalFavorite = folder ? !!folder.favorite : false;
  refreshNoteFolderFavoriteBtn();
  document.getElementById('note-folder-modal').classList.remove('hidden');
}

function closeNoteFolderModal() {
  document.getElementById('note-folder-modal').classList.add('hidden');
}

document.getElementById('btn-new-note-folder').addEventListener('click', () => openNoteFolderModal(null));
document.getElementById('btn-cancel-note-folder').addEventListener('click', closeNoteFolderModal);
document.getElementById('btn-close-note-folder').addEventListener('click', closeNoteFolderModal);

document.getElementById('note-folder-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('note-folder-id').value;
  const payload = {
    name: document.getElementById('note-folder-name').value,
    color: noteFolderColorField.getValue(),
    favorite: noteFolderModalFavorite,
  };
  // Solo se manda parentId al CREAR (hereda donde estas navegando); al
  // editar, el padre se deja tal cual estaba (undefined = "no lo toques"
  // en la API).
  if (!id) payload.parentId = state.currentNoteFolderId;

  if (id) {
    await api(`/api/note-folders/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/note-folders', { method: 'POST', body: JSON.stringify(payload) });
  }

  closeNoteFolderModal();
  await loadNoteFolders();
  renderNotesView();
  populateNoteFolderSelect();
});

document.getElementById('btn-delete-note-folder').addEventListener('click', async () => {
  const id = document.getElementById('note-folder-id').value;
  if (!id) return;
  if (!confirm('¿Eliminar esta carpeta? Las notas y subcarpetas que tenga no se borran: suben un nivel.')) return;
  await api(`/api/note-folders/${id}`, { method: 'DELETE' });
  closeNoteFolderModal();
  await loadNoteFolders();
  await loadNotes();
  renderNotesView();
  populateNoteFolderSelect();
});

// ---------------------------------------------------------------------
// Atajos de teclado: lista fija de acciones que ofrece la app (no se
// pueden inventar acciones nuevas), y para cada una el USUARIO decide que
// tecla la dispara, desde Configuracion > Atajos de teclado (settings.js
// dibuja esa lista; aqui solo esta el almacenamiento y quien los ejecuta
// de verdad). Es una preferencia de ESTE dispositivo/navegador, por eso
// vive en localStorage y no en el servidor.
// ---------------------------------------------------------------------
// Mueve el panel de recordatorios un dia adelante/atras: si ya estabas
// viendo un dia concreto, se mueve desde ESE dia; si estabas en "Proximos",
// arranca desde hoy. Reutiliza showDayInReminders, que ya cambia el panel
// a modo "dia" y pide los eventos/tareas de esa fecha al servidor.
function shiftRemindersDay(delta) {
  const base = state.remindersMode === 'day' && state.remindersDayDate ? state.remindersDayDate : new Date();
  const next = new Date(base);
  next.setDate(next.getDate() + delta);
  showDayInReminders(next);
}

const SHORTCUT_ACTIONS = [
  { id: 'new-event', label: 'Nuevo evento', run: () => document.getElementById('btn-new-event').click() },
  { id: 'open-settings', label: 'Abrir configuración', run: () => document.getElementById('btn-settings').click() },
  { id: 'prev-month', label: 'Mes anterior', run: () => document.getElementById('nav-prev').click() },
  { id: 'next-month', label: 'Mes siguiente', run: () => document.getElementById('nav-next').click() },
  { id: 'prev-day', label: 'Día anterior', run: () => shiftRemindersDay(-1) },
  { id: 'next-day', label: 'Día siguiente', run: () => shiftRemindersDay(1) },
];
// Atajos de fabrica: el usuario puede cambiarlos, quitarlos, o anadir mas
// de una combinacion para la MISMA accion (ej. "n" Y "ctrl+shift+a" abren
// las dos "Nuevo evento"). Un array vacio [] guardado explicitamente
// significa "sin ningun atajo", distinto de "todavia no tocado" (que usa
// estos por defecto).
const DEFAULT_SHORTCUTS = { 'new-event': ['n'], 'prev-day': ['arrowleft'], 'next-day': ['arrowright'] };

// Lee lo guardado y SIEMPRE devuelve arrays — si venia del formato viejo
// (un string suelto por accion, de antes de que se pudiera tener mas de
// una combinacion), lo envuelve en un array de un elemento sin perder lo
// que ya tenias configurado.
function getShortcutMap() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('keyboardShortcuts') || '{}');
  } catch (e) {
    stored = {};
  }
  const map = {};
  SHORTCUT_ACTIONS.forEach((a) => {
    if (Object.prototype.hasOwnProperty.call(stored, a.id)) {
      const value = stored[a.id];
      map[a.id] = Array.isArray(value) ? value : (value ? [value] : []);
    } else {
      map[a.id] = DEFAULT_SHORTCUTS[a.id] ? [...DEFAULT_SHORTCUTS[a.id]] : [];
    }
  });
  return map;
}

function saveShortcutMap(map) {
  localStorage.setItem('keyboardShortcuts', JSON.stringify(map));
}

// Anade una combinacion nueva a una accion (no reemplaza las que ya
// tuviera) — si esa combinacion ya la usaba OTRA accion, se la quita de
// ahi primero para que no queden dos acciones peleandose por la misma
// tecla.
function addShortcut(actionId, combo) {
  const map = getShortcutMap();
  SHORTCUT_ACTIONS.forEach((a) => {
    map[a.id] = map[a.id].filter((c) => c !== combo);
  });
  map[actionId].push(combo);
  saveShortcutMap(map);
}

function removeShortcut(actionId, combo) {
  const map = getShortcutMap();
  map[actionId] = map[actionId].filter((c) => c !== combo);
  saveShortcutMap(map);
}

// Convierte un evento de teclado en un identificador estable, ej.
// "ctrl+shift+n". Devuelve null si lo unico que se ha pulsado es una
// tecla modificadora sola (Ctrl, Alt...), porque eso no es un atajo
// valido todavia — se sigue esperando la tecla "de verdad".
function comboFromEvent(e) {
  const raw = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(raw)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey) parts.push('meta');
  let key = raw === ' ' ? 'space' : raw.toLowerCase();
  parts.push(key);
  return parts.join('+');
}

const SHORTCUT_KEY_LABELS = {
  ctrl: 'Ctrl', alt: 'Alt', shift: 'Mayús', meta: 'Cmd',
  arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
  escape: 'Esc', enter: 'Intro', space: 'Espacio', tab: 'Tab',
};

function displayCombo(combo) {
  if (!combo) return '';
  return combo
    .split('+')
    .map((part) => SHORTCUT_KEY_LABELS[part] || (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' + ');
}

// Ejecuta la accion que corresponda al atajo pulsado. Se ignora mientras
// se esta escribiendo en un campo (input/textarea/select), para no robar
// letras normales como la "n" mientras rellenas un titulo de evento.
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  if (isEditable) return;

  const combo = comboFromEvent(e);
  if (!combo) return;

  const map = getShortcutMap();
  const action = SHORTCUT_ACTIONS.find((a) => map[a.id].includes(combo));
  if (action) {
    e.preventDefault();
    action.run();
  }
});

// ---------------------------------------------------------------------
// Vista: un UNICO modo activo a la vez — Normal o Pantalla completa —
// que se cambia desde Configuracion > Vista (ver refreshViewTab en
// settings.js). Cambiar de una a otra deshace la anterior (sale de
// pantalla completa) en vez de dejarlas acumularse.
// (Hubo tambien un modo "Ventana flotante", quitado: en el navegador
// window.open() no es fiable — muchos navegadores abren otra PESTANA en
// vez de una ventana pequeña — y en Electron habria hecho falta
// configurar setWindowOpenHandler a mano para controlar el tamaño de la
// ventana nueva. No compensaba el esfuerzo para lo poco que se usaba.)
// ---------------------------------------------------------------------
function getViewMode() {
  return localStorage.getItem('viewMode') || 'normal';
}

function setViewMode(mode) {
  localStorage.setItem('viewMode', mode);
  // En Electron, ademas de localStorage (que solo puede leer la propia
  // pagina), se lo decimos tambien al proceso principal — asi puede saber
  // que vista tocaba ANTES de crear la ventana la proxima vez, en vez de
  // enterarse ya con la pagina cargada (ver electron/main.js).
  if (window.electronAPI && window.electronAPI.saveViewMode) window.electronAPI.saveViewMode(mode);
  document.getElementById('default-view-banner').classList.add('hidden');
  if (typeof refreshViewTab === 'function') refreshViewTab();
}

// Aplica de verdad el cambio de modo: deshace lo que hubiera activo y
// activa lo nuevo. Se llama tanto desde el boton en Configuracion como
// desde el aviso que sale al cargar la pagina si la vista guardada no es
// la normal (ver applyViewModePrompt).
function applyViewMode(mode) {
  if (window.electronAPI) {
    // Dentro de la app de escritorio, la pantalla completa la controla la
    // ventana nativa (proceso principal) en vez de la API de pantalla
    // completa del navegador — por eso puede activarse sola al arrancar,
    // sin el aviso de "hace falta un clic" (ver applyViewModePrompt).
    window.electronAPI.setNativeFullscreen(mode === 'fullscreen');
  } else if (mode !== 'fullscreen' && document.fullscreenElement) {
    document.exitFullscreen();
  }

  if (!window.electronAPI && mode === 'fullscreen' && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  setViewMode(mode);
}

// Simetrico al 'fullscreenchange' del navegador (ver mas abajo), pero para
// cuando Electron sale de pantalla completa nativa por su cuenta (Esc, el
// propio control de la ventana...) — sin esto, Configuracion > Vista se
// quedaria diciendo "Pantalla completa" aunque ya no lo estuviera.
if (window.electronAPI && window.electronAPI.onNativeFullscreenChange) {
  window.electronAPI.onNativeFullscreenChange((isFullscreen) => {
    if (isClosingPage) return;
    if (!isFullscreen && getViewMode() === 'fullscreen') {
      setViewMode('normal');
    }
  });
}

// Si sales de pantalla completa con Esc o con el propio navegador (no con
// nuestro control), el modo guardado tiene que volver a "normal" para que
// no se quede desincronizado. OJO: cerrar la pestana/ventana estando en
// pantalla completa TAMBIEN dispara este mismo evento (el navegador sale
// de pantalla completa como parte de cerrarse), y sin este aviso eso
// borraria "pantalla completa" de la preferencia guardada justo al
// cerrar la app — pareceria que nunca se guarda. isClosingPage se marca
// en cuanto empieza a cerrarse/recargarse la pagina, para distinguir ese
// caso del Esc de verdad y no tocar la preferencia guardada entonces.
let isClosingPage = false;
window.addEventListener('pagehide', () => { isClosingPage = true; });
window.addEventListener('beforeunload', () => { isClosingPage = true; });

document.addEventListener('fullscreenchange', () => {
  if (isClosingPage) return;
  if (!document.fullscreenElement && getViewMode() === 'fullscreen') {
    setViewMode('normal');
  }
});

// Al cargar la pagina no podemos activar pantalla completa ni abrir la
// ventana flotante solos (los navegadores exigen un clic del usuario para
// eso), asi que si la vista guardada no es la normal mostramos un aviso
// con un boton para activarla con un clic.
function applyViewModePrompt() {
  const mode = getViewMode();
  const banner = document.getElementById('default-view-banner');

  if (window.electronAPI && mode === 'fullscreen') {
    // En Electron SI podemos activarla solos (ver applyViewMode), asi que
    // ni falta el aviso.
    window.electronAPI.setNativeFullscreen(true);
    banner.classList.add('hidden');
    return;
  }

  if (mode === 'normal' || (mode === 'fullscreen' && document.fullscreenElement)) {
    banner.classList.add('hidden');
    return;
  }
  const label = mode === 'fullscreen' ? 'pantalla completa' : 'ventana flotante';
  document.getElementById('default-view-banner-text').textContent = `Tu vista guardada es ${label}.`;
  document.getElementById('btn-apply-default-view').textContent = mode === 'fullscreen' ? 'Activar' : 'Abrir';
  banner.dataset.pref = mode;
  banner.classList.remove('hidden');
}

document.getElementById('btn-apply-default-view').addEventListener('click', () => {
  const mode = document.getElementById('default-view-banner').dataset.pref;
  applyViewMode(mode);
});
document.getElementById('btn-dismiss-default-view').addEventListener('click', () => {
  document.getElementById('default-view-banner').classList.add('hidden');
});

// ---------------------------------------------------------------------
// "Mi espacio" (Fase 1): hub con 3 columnas (Proximos / Tareas / Notas,
// esta ultima vacia por ahora) en vez de los bloques apilados de
// siempre. Como se accede a el es una preferencia de ESTE dispositivo
// (localStorage), elegida en Configuracion > Vista > Mi espacio (ver
// refreshMiEspacioModeOptions en settings.js):
//   - "panel": el hub vive SIEMPRE dentro de #reminders-panel, al lado
//     del calendario (sustituye a los 2 bloques apilados de siempre).
//   - "topbar": el panel lateral se queda exactamente como esta hoy
//     (Proximos arriba, Tareas fijo abajo); un boton nuevo en la topbar
//     abre el hub a pantalla completa cuando lo necesites.
// En los dos casos, los bloques #reminders-top-block/#reminders-tasks-block
// de SIEMPRE se MUEVEN de sitio (Node.appendChild) en vez de duplicarse,
// asi que su renderizado (loadReminders, renderTasksList...) no cambia
// nada, solo cambia DONDE viven en el DOM.
// ---------------------------------------------------------------------
const MY_SPACE_MODE_IDS = ['topbar', 'panel'];

function getMiEspacioMode() {
  const stored = localStorage.getItem('miEspacioMode');
  return MY_SPACE_MODE_IDS.includes(stored) ? stored : 'topbar';
}

// Deja los 2 bloques de siempre en su sitio clasico, uno debajo del otro
// dentro de #reminders-panel — como si "Mi espacio" no existiera. Fuera
// de Mi espacio no hace falta la navegacion de dia (ya estan el
// calendario de al lado y los atajos de teclado) ni tiene sentido
// arrancar siempre en el dia de hoy, asi que se vuelve al "Proximos" de
// toda la vida.
function restoreClassicRemindersPanel() {
  // La colocacion de verdad de los 3 bloques (sueltos o dentro del slot
  // agrupado) la hace applyRemindersPanelLayout() -- aqui solo se deja
  // todo lo demas del panel clasico como siempre.
  document.getElementById('reminders-day-nav').classList.add('hidden');
  showUpcomingReminders();
  applyRemindersPanelLayout();
}

// Coloca los 3 bloques dentro de las columnas del hub, alli donde el hub
// este montado ahora mismo (dentro del panel lateral o dentro de la
// pantalla completa de #my-space-view). Dentro de Mi espacio, Proximos
// arranca siempre en el dia de hoy (en vez del listado general) con la
// navegacion de dia visible arriba, porque en modo "boton" el calendario
// de al lado no se ve mientras Mi espacio esta abierto.
function moveRemindersIntoHub() {
  document.getElementById('my-space-col-reminders').appendChild(document.getElementById('reminders-top-block'));
  document.getElementById('my-space-col-tasks').appendChild(document.getElementById('reminders-tasks-block'));
  document.getElementById('my-space-col-notes').appendChild(document.getElementById('reminders-notes-block'));
  document.getElementById('reminders-day-nav').classList.remove('hidden');
  showDayInReminders(new Date());
  // Dentro del hub (3 columnas propias, cada una con su sitio) el ajuste
  // de "agrupar con flechas" no pinta nada -- cada seccion vive siempre
  // en su propia columna, visible entera.
  document.getElementById('reminders-panel-switcher').classList.add('hidden');
  document.getElementById('reminders-panel-grouped-slot').classList.add('hidden');
  REMINDERS_PANEL_PAGES.forEach((p) => document.getElementById(p.blockId).classList.remove('hidden'));
}

// Panel lateral clasico (modo "topbar" de Mi espacio, ver mas abajo):
// que secciones de Recordatorios/Tareas/Notas van AGRUPADAS (juntas,
// alternando con flechas, una visible cada vez dentro de
// #reminders-panel-grouped-slot) y cuales se quedan SUELTAS (apiladas,
// cada una siempre visible con su propio scroll, en su posicion natural
// -- ver REMINDERS_PANEL_PAGES mas abajo para el orden). Preferencia de
// ESTE dispositivo (localStorage, un array de ids), elegida con
// casillas en Configuracion > Vista > "Panel lateral clasico" (ver
// refreshRemindersPanelGroupedOptions en settings.js). Agrupar 0 o 1
// seccion no hace nada especial -- con una sola marcada no hay nada que
// alternar, asi que se trata igual que "ninguna marcada" (todas
// sueltas). En modo "panel" de Mi espacio (hub de 3 columnas) este
// ajuste no pinta nada: cada columna ya vive en su propio sitio fijo
// (ver moveRemindersIntoHub).
//
// REMINDERS_PANEL_PAGES esta pensado para poder crecer el dia que haya
// una 4a seccion: toda la logica de abajo itera sobre el array entero,
// sin ningun "3" fijo en el codigo.
const REMINDERS_PANEL_PAGES = [
  { id: 'reminders', label: 'Recordatorios', blockId: 'reminders-top-block' },
  { id: 'tasks', label: 'Tareas', blockId: 'reminders-tasks-block' },
  { id: 'notes', label: 'Notas', blockId: 'reminders-notes-block' },
];
let remindersPanelActivePage = 'reminders';

function getRemindersGroupedSections() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem('remindersPanelGrouped') || '[]');
  } catch {
    stored = [];
  }
  if (!Array.isArray(stored)) return [];
  const valid = stored.filter((id) => REMINDERS_PANEL_PAGES.some((p) => p.id === id));
  return valid.length >= 2 ? valid : [];
}

// Recoloca cada bloque en su sitio (agrupado o suelto) y decide que se
// ve. Se llama al arrancar, al cambiar el ajuste, y cada vez que se
// alterna dentro del grupo (stepRemindersPanelPage).
function applyRemindersPanelLayout() {
  if (getMiEspacioMode() === 'panel') return; // este ajuste no aplica ahi, ver moveRemindersIntoHub

  const panel = document.getElementById('reminders-panel');
  const groupedSlot = document.getElementById('reminders-panel-grouped-slot');
  const switcher = document.getElementById('reminders-panel-switcher');
  const grouped = getRemindersGroupedSections();

  // Coloca cada bloque: las agrupadas dentro del slot compartido (que se
  // inserta en el panel en la posicion de la PRIMERA seccion agrupada,
  // segun el orden natural), las sueltas directamente en el panel.
  let groupedSlotPlaced = false;
  REMINDERS_PANEL_PAGES.forEach((p) => {
    const block = document.getElementById(p.blockId);
    if (grouped.includes(p.id)) {
      groupedSlot.appendChild(block);
      if (!groupedSlotPlaced) {
        panel.appendChild(groupedSlot);
        groupedSlotPlaced = true;
      }
    } else {
      panel.appendChild(block);
      block.classList.remove('hidden');
    }
  });

  if (grouped.length === 0) {
    groupedSlot.classList.add('hidden');
    switcher.classList.add('hidden');
    return;
  }

  groupedSlot.classList.remove('hidden');
  switcher.classList.remove('hidden');
  if (!grouped.includes(remindersPanelActivePage)) remindersPanelActivePage = grouped[0];
  grouped.forEach((id) => {
    const p = REMINDERS_PANEL_PAGES.find((page) => page.id === id);
    document.getElementById(p.blockId).classList.toggle('hidden', id !== remindersPanelActivePage);
  });
  document.getElementById('reminders-panel-switch-label').textContent =
    REMINDERS_PANEL_PAGES.find((p) => p.id === remindersPanelActivePage).label;
}

function stepRemindersPanelPage(delta) {
  const grouped = getRemindersGroupedSections();
  if (grouped.length === 0) return;
  const idx = grouped.indexOf(remindersPanelActivePage);
  const nextIdx = (idx + delta + grouped.length) % grouped.length;
  remindersPanelActivePage = grouped[nextIdx];
  applyRemindersPanelLayout();
}

document.getElementById('btn-panel-switch-prev').addEventListener('click', () => stepRemindersPanelPage(-1));
document.getElementById('btn-panel-switch-next').addEventListener('click', () => stepRemindersPanelPage(1));

function collapseMySpaceExpandedColumn() {
  delete document.getElementById('my-space-hub').dataset.expanded;
  document.getElementById('my-space-back-btn').classList.add('hidden');
}

function closeMySpaceView() {
  document.getElementById('my-space-view').classList.add('hidden');
  collapseMySpaceExpandedColumn();
  restoreClassicRemindersPanel();
}

function openMySpaceView() {
  moveRemindersIntoHub();
  document.getElementById('my-space-view').classList.remove('hidden');
}

// Aplica el modo elegido: donde vive el hub, y si hace falta o no el
// boton de la topbar. Se llama al arrancar y cada vez que cambias el
// ajuste en Configuracion > Vista.
function applyMiEspacioMode() {
  const mode = getMiEspacioMode();
  const panel = document.getElementById('reminders-panel');
  const hub = document.getElementById('my-space-hub');

  // Al cambiar de modo (o al arrancar) siempre se parte de cero: el hub
  // cerrado y los bloques en su sitio clasico dentro del panel.
  document.getElementById('my-space-view').classList.add('hidden');
  collapseMySpaceExpandedColumn();
  restoreClassicRemindersPanel();
  panel.classList.remove('my-space-panel-mode');

  if (mode === 'panel') {
    panel.appendChild(hub);
    panel.classList.add('my-space-panel-mode');
    moveRemindersIntoHub();
    document.getElementById('btn-my-space').classList.add('hidden');
  } else {
    document.getElementById('my-space-view').appendChild(hub);
    document.getElementById('btn-my-space').classList.remove('hidden');
  }
}

document.getElementById('btn-my-space').addEventListener('click', openMySpaceView);
document.getElementById('btn-close-my-space').addEventListener('click', closeMySpaceView);

// ---------------------------------------------------------------------
// Extensiones (placeholder): mismo patron de pantalla completa que "Mi
// espacio" (.my-space-view), pero sin modo panel/boton -- este boton no
// se oculta nunca. Sin logica real todavia, solo abre/cierra la pantalla
// "Proximamente" (ver #extensions-view en index.html).
// ---------------------------------------------------------------------
function openExtensionsView() {
  document.getElementById('extensions-view').classList.remove('hidden');
}
function closeExtensionsView() {
  document.getElementById('extensions-view').classList.add('hidden');
}
document.getElementById('btn-extensions').addEventListener('click', openExtensionsView);
document.getElementById('btn-close-extensions').addEventListener('click', closeExtensionsView);

// Mientras una columna cambia de ancho (expandir o volver a las 3), el
// contenido de dentro se oculta (ver .is-animating en styles.css) para
// que no se vea el texto reajustandose a media animacion — 340ms es la
// duracion de la transicion CSS (320ms) con un pelin de margen para que
// de tiempo a que termine de verdad antes de destaparlo.
const MY_SPACE_COLUMN_ANIMATION_MS = 340;
let mySpaceAnimationTimer = null;

function playMySpaceColumnAnimation() {
  const hub = document.getElementById('my-space-hub');
  hub.classList.add('is-animating');
  clearTimeout(mySpaceAnimationTimer);
  mySpaceAnimationTimer = setTimeout(() => hub.classList.remove('is-animating'), MY_SPACE_COLUMN_ANIMATION_MS);
}

// Un solo listener en el hub entero (delegacion) en vez de uno por
// columna: mas simple, y sigue funcionando igual aunque los bloques que
// hay dentro se muevan de sitio. Ya no hay un boton dedicado para
// expandir (ocupaba espacio vertical solo para eso) -- clicar el TITULO
// de la columna (h2, con la clase my-space-col-expand-trigger) la
// expande directamente.
document.getElementById('my-space-hub').addEventListener('click', (e) => {
  const trigger = e.target.closest('.my-space-col-expand-trigger');
  if (!trigger) return;
  const col = trigger.closest('.my-space-col');
  if (!col) return;
  playMySpaceColumnAnimation();
  document.getElementById('my-space-hub').dataset.expanded = col.dataset.col;
  document.getElementById('my-space-back-btn').classList.remove('hidden');
});
document.getElementById('my-space-back-btn').addEventListener('click', () => {
  playMySpaceColumnAnimation();
  collapseMySpaceExpandedColumn();
});

applyMiEspacioMode();

// ---------------------------------------------------------------------
// Aviso de nueva version disponible: /api/version devuelve el momento en
// que arranco el proceso del servidor. npm run dev reinicia ese proceso
// cada vez que tocamos un archivo de server/, asi que si ese valor
// cambia respecto al que teniamos guardado, el servidor se ha
// actualizado y avisamos para recargar en vez de dejar la pagina con
// JS/HTML desincronizados con lo nuevo. Se puede desactivar desde
// Configuracion > Este dispositivo (localStorage.updateCheckEnabled).
// ---------------------------------------------------------------------
let knownServerStartedAt = null;

async function checkForUpdate() {
  if (localStorage.getItem('updateCheckEnabled') === 'false') return;
  try {
    const res = await fetch('/api/version');
    if (!res.ok) return;
    const { startedAt } = await res.json();
    if (knownServerStartedAt === null) {
      knownServerStartedAt = startedAt;
      return;
    }
    if (startedAt !== knownServerStartedAt) {
      document.getElementById('update-banner').classList.remove('hidden');
    }
  } catch (err) {
    // Sin conexion justo ahora (por ejemplo, el servidor esta a mitad de
    // reiniciarse): no pasa nada, lo volvemos a intentar en el siguiente
    // ciclo en vez de mostrar un error.
  }
}

document.getElementById('btn-reload-update').addEventListener('click', () => location.reload());

// ---------------------------------------------------------------------
// Aviso de version nueva EN GITHUB (distinto del de arriba, que solo
// detecta que el servidor que ya tenias abierto se reinicio por su
// cuenta). Aqui se pregunta de verdad si hay algo mas nuevo que lo que
// tienes instalado, aunque acabes de abrir la app. Solo el ordenador de
// confianza puede usar esto (ver requireTrusted en
// server/routes/update.js) — en un movil emparejado, /api/update/check
// responde 403 y aqui simplemente no sale el aviso, sin error visible.
// "No para esta version" se recuerda en localStorage (por dispositivo,
// como el resto de preferencias de "Este dispositivo"): la siguiente
// version SI que volvera a avisar.
// ---------------------------------------------------------------------
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Info de version/commit en el menu principal de Configuracion (para "no
// ir perdido" con que version corre este ordenador) -- ver
// GET /api/update/info en server/routes/update.js. Es solo lectura,
// no habla con GitHub (a diferencia de checkForNewRelease), asi que
// funciona sin internet. En un movil emparejado (que no puede leer el
// git de este ordenador) el 403 se ignora en silencio, igual que el
// aviso de nueva version.
const VERSION_INFO_DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

async function refreshVersionInfo() {
  const box = document.getElementById('settings-version-info');
  try {
    const info = await api('/api/update/info');
    const commitDate = info.commitDate ? VERSION_INFO_DATE_FORMATTER.format(new Date(info.commitDate)) : '';
    box.innerHTML = `
      <div>Versión ${escapeHtml(info.version)} · rama <code>${escapeHtml(info.branch)}</code></div>
      <div>Último commit: <code>${escapeHtml(info.commitHash)}</code> — ${escapeHtml(info.commitMessage)}</div>
      ${commitDate ? `<div>${escapeHtml(commitDate)}</div>` : ''}
    `;
    box.classList.remove('hidden');
  } catch (err) {
    // Sin internet no importa (esto no hace fetch a GitHub), pero si
    // fallase por cualquier otro motivo (git no disponible, movil
    // emparejado sin permiso...) mejor no mostrar nada raro a medias.
    box.classList.add('hidden');
  }
}

let pendingReleaseVersion = null;

async function checkForNewRelease() {
  try {
    const info = await api('/api/update/check');
    if (!info || !info.remoteVersion) return;
    if (compareVersions(info.remoteVersion, info.currentVersion) <= 0) return;
    if (localStorage.getItem('skippedUpdateVersion') === info.remoteVersion) return;

    pendingReleaseVersion = info.remoteVersion;
    document.getElementById('new-release-banner-text').textContent = `Hay una versión nueva disponible (v${info.remoteVersion}).`;
    document.getElementById('new-release-banner').classList.remove('hidden');
  } catch (err) {
    // Sin internet, git no configurado, o somos un movil emparejado (403):
    // no pasa nada, se vuelve a intentar mas tarde sin molestar con un error.
  }
}

document.getElementById('btn-skip-release').addEventListener('click', () => {
  if (pendingReleaseVersion) localStorage.setItem('skippedUpdateVersion', pendingReleaseVersion);
  document.getElementById('new-release-banner').classList.add('hidden');
});
document.getElementById('btn-dismiss-release').addEventListener('click', () => {
  document.getElementById('new-release-banner').classList.add('hidden');
});

// Tras un "git pull" bueno, el codigo nuevo ya esta en el disco pero el
// proceso que sigue corriendo (y la pagina que tienes abierta) todavia
// tienen el viejo cargado en memoria — hay que reiniciar de verdad para
// que se note. En Electron, la propia app se reinicia sola. En el
// navegador (npm run dev), en cuanto "git pull" cambia archivos de
// server/ el --watch reinicia el servidor solo — aqui solo hace falta
// esperar a que vuelva a responder y recargar la pagina.
function waitForServerRestartThenReload() {
  const attempt = async () => {
    try {
      const res = await fetch('/api/version');
      if (res.ok) {
        location.reload();
        return;
      }
    } catch (err) {
      // sigue reiniciandose, se reintenta
    }
    setTimeout(attempt, 1000);
  };
  setTimeout(attempt, 2000);
}

document.getElementById('btn-install-release').addEventListener('click', async () => {
  const btn = document.getElementById('btn-install-release');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  document.getElementById('btn-skip-release').disabled = true;
  btn.textContent = 'Actualizando…';

  try {
    await api('/api/update/pull', { method: 'POST' });
    if (window.electronAPI && window.electronAPI.relaunchApp) {
      btn.textContent = 'Reiniciando la app…';
      window.electronAPI.relaunchApp();
    } else {
      btn.textContent = 'Reiniciando el servidor…';
      waitForServerRestartThenReload();
    }
  } catch (err) {
    alert('No se pudo actualizar: ' + err.message);
    btn.disabled = false;
    document.getElementById('btn-skip-release').disabled = false;
    btn.textContent = originalLabel;
  }
});

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
async function init() {
  try {
    await loadGroups();
    await loadSpecialDays();
    await loadMonth();
    await loadReminders();
    await loadTasks();
    renderTasksList();
    await loadNoteFolders();
    populateNoteFolderSelect();
    await loadNotes();
    renderNotesView();
    setInterval(loadReminders, 30 * 1000);
    // Igual que los recordatorios: si otro dispositivo vinculado anade o
    // completa una tarea, este se entera sin recargar la pagina.
    setInterval(() => loadTasks().then(renderTasksList), 30 * 1000);
    // Carpetas Y notas juntas (no cada una por su lado) para no repintar
    // la vista dos veces seguidas si las dos han cambiado a la vez.
    setInterval(() => Promise.all([loadNoteFolders(), loadNotes()]).then(() => {
      populateNoteFolderSelect();
      renderNotesView();
    }), 30 * 1000);
  } catch (err) {
    if (err.message !== 'device_not_paired') console.error(err);
  }
}

// Si ya tenemos un token guardado (o somos el ordenador, que ni lo
// necesita) intentamos cargar la app directamente; api() se encargara
// de mostrar la pantalla de emparejamiento si el servidor nos rechaza.
showApp();
init();
checkForUpdate();
setInterval(checkForUpdate, 15 * 1000);
checkForNewRelease();
// Es una llamada a git fetch de verdad (no un simple ping), asi que se
// repite mucho menos seguido que checkForUpdate — cada 6 horas basta para
// enterarse el mismo dia sin martirizar la conexion.
setInterval(checkForNewRelease, 6 * 60 * 60 * 1000);
applyViewModePrompt();
