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
        estimatedHeight: Math.min(280, opts.length * 40 + 16),
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
    if (willOpen) positionFixedPopover(iconBtn, popover, { width: 264, estimatedHeight: 320 });
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
    dayEvents.forEach((ev) => {
      if (ev.isTask) {
        cell.appendChild(buildCalendarTaskChip(ev));
        return;
      }
      const chip = document.createElement('div');
      chip.className = 'calendar-event-chip';
      chip.style.backgroundColor = ev.groupColor || DEFAULT_EVENT_COLOR;
      const iconPrefix = ev.groupIcon ? `${ev.groupIcon} ` : '';
      chip.textContent = ev.allDay ? `${iconPrefix}${ev.title}` : `${TIME_FORMATTER.format(new Date(ev.startAt))} ${iconPrefix}${ev.title}`;
      chip.addEventListener('click', (e) => {
        e.stopPropagation(); // que no abra tambien el panel del dia entero
        openEventModal(ev);
      });
      cell.appendChild(chip);
    });

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
  await renderRemindersPanel();
}

function showUpcomingReminders() {
  state.remindersMode = 'upcoming';
  state.remindersDayDate = null;
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
    await renderDayReminders(state.remindersDayDate);
  } else {
    title.textContent = 'Proximos recordatorios';
    backBtn.classList.add('hidden');
    dayActions.classList.add('hidden');
    renderUpcomingRemindersList(state.upcomingReminders || []);
  }
}

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
// Atajos de fabrica: el usuario puede cambiarlos o quitarlos por completo
// desde Configuracion; un valor '' guardado explicitamente significa "sin
// atajo", distinto de "todavia no tocado" (que usa este por defecto).
const DEFAULT_SHORTCUTS = { 'new-event': 'n', 'prev-day': 'arrowleft', 'next-day': 'arrowright' };

function getShortcutMap() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('keyboardShortcuts') || '{}');
  } catch (e) {
    stored = {};
  }
  const map = {};
  SHORTCUT_ACTIONS.forEach((a) => {
    map[a.id] = Object.prototype.hasOwnProperty.call(stored, a.id) ? stored[a.id] : (DEFAULT_SHORTCUTS[a.id] || '');
  });
  return map;
}

function setShortcut(actionId, combo) {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('keyboardShortcuts') || '{}');
  } catch (e) {
    stored = {};
  }
  stored[actionId] = combo;
  localStorage.setItem('keyboardShortcuts', JSON.stringify(stored));
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
  const action = SHORTCUT_ACTIONS.find((a) => map[a.id] && map[a.id] === combo);
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
    setInterval(loadReminders, 30 * 1000);
    // Igual que los recordatorios: si otro dispositivo vinculado anade o
    // completa una tarea, este se entera sin recargar la pagina.
    setInterval(() => loadTasks().then(renderTasksList), 30 * 1000);
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
