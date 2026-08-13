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
  specialDays: {}, // 'YYYY-MM-DD' -> 'holiday' | 'special', marcados a mano
  pairingCodeExpiresAt: null,
  notifiedReminderIds: new Set(), // evita notificar el mismo recordatorio 2 veces
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
const MONTH_FORMATTER = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const DAY_HEADING_FORMATTER = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const TIME_FORMATTER = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

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

// El input datetime-local espera "YYYY-MM-DDTHH:mm" en hora LOCAL (no UTC),
// asi que no podemos usar toISOString() directamente (esa da UTC).
function toDatetimeLocalValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------------------------------------------------------------------
// Carga y render del mes
// ---------------------------------------------------------------------
async function loadMonth() {
  const from = toIsoDate(startOfMonth(state.viewDate));
  const to = toIsoDate(endOfMonth(state.viewDate));
  state.events = await api(`/api/events?from=${from}T00:00:00&to=${to}T23:59:59`);
  document.getElementById('current-month-label').textContent = MONTH_FORMATTER.format(state.viewDate);
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

    const dayEvents = state.events.filter((ev) => sameDay(new Date(ev.startAt), cellDate));
    dayEvents.forEach((ev) => {
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
    // abre el panel con TODOS los eventos de ese dia — los chips se
    // quedan pequenos y no siempre caben todos.
    cell.addEventListener('click', () => openDayModal(cellDate));

    grid.appendChild(cell);
  }
}

// ---------------------------------------------------------------------
// Panel de dia: todos los eventos de un dia concreto, con opcion de
// anadir uno nuevo ya con esa fecha puesta, y de marcarlo como festivo o
// dia especial (se guarda en el servidor, compartido entre dispositivos).
// ---------------------------------------------------------------------
function renderDayModalEvents(date) {
  const list = document.getElementById('day-modal-list');
  list.innerHTML = '';

  const dayEvents = state.events.filter((ev) => sameDay(new Date(ev.startAt), date));
  if (dayEvents.length === 0) {
    list.innerHTML = '<p class="empty-hint">No hay eventos este dia.</p>';
    return;
  }

  dayEvents.forEach((ev) => {
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
    item.addEventListener('click', () => {
      closeDayModal();
      openEventModal(ev);
    });
    list.appendChild(item);
  });
}

function updateDayMarkButtons(dateKey) {
  const current = state.specialDays[dateKey];
  document.getElementById('btn-mark-holiday').classList.toggle('active', current === 'holiday');
  document.getElementById('btn-mark-special').classList.toggle('active', current === 'special');
}

function openDayModal(date) {
  const dateKey = toDateKey(date);
  document.getElementById('day-modal').dataset.dateKey = dateKey;
  document.getElementById('day-modal-title').textContent = DAY_HEADING_FORMATTER.format(date);
  renderDayModalEvents(date);
  updateDayMarkButtons(dateKey);

  document.getElementById('btn-day-new-event').onclick = () => {
    closeDayModal();
    openEventModal(null, date);
  };

  document.getElementById('day-modal').classList.remove('hidden');
}

function closeDayModal() {
  document.getElementById('day-modal').classList.add('hidden');
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

document.getElementById('btn-close-day').addEventListener('click', closeDayModal);
document.getElementById('btn-mark-holiday').addEventListener('click', (e) => {
  setDayType(document.getElementById('day-modal').dataset.dateKey, 'holiday');
});
document.getElementById('btn-mark-special').addEventListener('click', (e) => {
  setDayType(document.getElementById('day-modal').dataset.dateKey, 'special');
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
  document.getElementById('event-start').value = event ? toDatetimeLocalValue(new Date(event.startAt)) : toDatetimeLocalValue(defaultStart);
  document.getElementById('event-end').value = event && event.endAt ? toDatetimeLocalValue(new Date(event.endAt)) : '';
  document.getElementById('event-location').value = event && event.location ? event.location : '';
  document.getElementById('event-description').value = event && event.description ? event.description : '';
  document.getElementById('event-reminder').value = event && event.reminderMinutesBefore !== null && event.reminderMinutesBefore !== undefined
    ? String(event.reminderMinutesBefore)
    : '';
  populateEventGroupSelect();
  document.getElementById('event-group').value = event && event.groupId ? String(event.groupId) : '';
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

document.getElementById('event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('event-id').value;
  const reminderRaw = document.getElementById('event-reminder').value;

  const groupRaw = document.getElementById('event-group').value;

  const payload = {
    title: document.getElementById('event-title').value,
    allDay: document.getElementById('event-all-day').checked,
    startAt: document.getElementById('event-start').value,
    endAt: document.getElementById('event-end').value || null,
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

function populateEventGroupSelect() {
  const select = document.getElementById('event-group');
  const current = select.value;
  select.innerHTML = '<option value="">Sin grupo</option>';
  state.groups.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    select.appendChild(opt);
  });
  select.value = current;
}

// ---------------------------------------------------------------------
// Recordatorios: panel + notificaciones del navegador
// ---------------------------------------------------------------------
async function loadReminders() {
  const upcoming = await api('/api/reminders/upcoming');
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
// Atajos de teclado: lista fija de acciones que ofrece la app (no se
// pueden inventar acciones nuevas), y para cada una el USUARIO decide que
// tecla la dispara, desde Configuracion > Atajos de teclado (settings.js
// dibuja esa lista; aqui solo esta el almacenamiento y quien los ejecuta
// de verdad). Es una preferencia de ESTE dispositivo/navegador, por eso
// vive en localStorage y no en el servidor.
// ---------------------------------------------------------------------
const SHORTCUT_ACTIONS = [
  { id: 'new-event', label: 'Nuevo evento', run: () => document.getElementById('btn-new-event').click() },
  { id: 'open-settings', label: 'Abrir configuración', run: () => document.getElementById('btn-settings').click() },
  { id: 'prev-month', label: 'Mes anterior', run: () => document.getElementById('nav-prev').click() },
  { id: 'next-month', label: 'Mes siguiente', run: () => document.getElementById('nav-next').click() },
];
// Atajos de fabrica: el usuario puede cambiarlos o quitarlos por completo
// desde Configuracion; un valor '' guardado explicitamente significa "sin
// atajo", distinto de "todavia no tocado" (que usa este por defecto).
const DEFAULT_SHORTCUTS = { 'new-event': 'n' };

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
// Vista: un UNICO modo activo a la vez — Normal, Pantalla completa o
// Ventana flotante — que se cambia desde Configuracion > Vista (ver
// refreshViewTab en settings.js). Cambiar de una a otra deshace la
// anterior (sale de pantalla completa, o cierra la ventana flotante) en
// vez de dejarlas acumularse; por eso openFloatingWindow reutiliza la
// MISMA ventana flotante si ya esta abierta en vez de crear otra.
// ---------------------------------------------------------------------
let floatingWindowRef = null;
let floatingWindowWatcher = null;

function getViewMode() {
  return localStorage.getItem('viewMode') || 'normal';
}

function setViewMode(mode) {
  localStorage.setItem('viewMode', mode);
  document.getElementById('default-view-banner').classList.add('hidden');
  if (typeof refreshViewTab === 'function') refreshViewTab();
}

function closeFloatingWindow() {
  clearInterval(floatingWindowWatcher);
  if (floatingWindowRef && !floatingWindowRef.closed) floatingWindowRef.close();
  floatingWindowRef = null;
}

function openFloatingWindow() {
  if (floatingWindowRef && !floatingWindowRef.closed) {
    floatingWindowRef.focus();
    return;
  }
  floatingWindowRef = window.open(
    location.origin + location.pathname,
    'remindmelater-floating',
    'width=420,height=680,menubar=no,toolbar=no,location=no,status=no,resizable=yes'
  );
  // Si cierran la ventana flotante a mano (la x de la ventana, no un
  // boton nuestro), nos enteramos mirando cada segundo si sigue abierta,
  // y volvemos el modo a "normal" para que Configuracion no diga que
  // sigue activa cuando ya no lo esta.
  clearInterval(floatingWindowWatcher);
  floatingWindowWatcher = setInterval(() => {
    if (!floatingWindowRef || floatingWindowRef.closed) {
      clearInterval(floatingWindowWatcher);
      floatingWindowRef = null;
      if (getViewMode() === 'floating') setViewMode('normal');
    }
  }, 1000);
}

// Aplica de verdad el cambio de modo: deshace lo que hubiera activo y
// activa lo nuevo. Se llama tanto desde el boton en Configuracion como
// desde el aviso que sale al cargar la pagina si la vista guardada no es
// la normal (ver applyViewModePrompt).
function applyViewMode(mode) {
  if (mode !== 'fullscreen' && document.fullscreenElement) document.exitFullscreen();
  if (mode !== 'floating') closeFloatingWindow();

  if (mode === 'fullscreen' && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (mode === 'floating') {
    openFloatingWindow();
  }
  setViewMode(mode);
}

// Si sales de pantalla completa con Esc o con el propio navegador (no con
// nuestro control), el modo guardado tiene que volver a "normal" para que
// no se quede desincronizado.
document.addEventListener('fullscreenchange', () => {
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
// Arranque
// ---------------------------------------------------------------------
async function init() {
  try {
    await loadGroups();
    await loadSpecialDays();
    await loadMonth();
    await loadReminders();
    setInterval(loadReminders, 30 * 1000);
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
applyViewModePrompt();
