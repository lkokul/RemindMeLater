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
  pairingCodeExpiresAt: null,
  notifiedReminderIds: new Set(), // evita notificar el mismo recordatorio 2 veces
};

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
      chip.addEventListener('click', () => openEventModal(ev));
      cell.appendChild(chip);
    });

    grid.appendChild(cell);
  }
}

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
function openEventModal(event) {
  const modal = document.getElementById('event-modal');
  document.getElementById('event-modal-title').textContent = event ? 'Editar evento' : 'Nuevo evento';
  document.getElementById('event-id').value = event ? event.id : '';
  document.getElementById('event-title').value = event ? event.title : '';
  document.getElementById('event-all-day').checked = event ? event.allDay : false;
  document.getElementById('event-start').value = event ? toDatetimeLocalValue(new Date(event.startAt)) : toDatetimeLocalValue(new Date());
  document.getElementById('event-end').value = event && event.endAt ? toDatetimeLocalValue(new Date(event.endAt)) : '';
  document.getElementById('event-location').value = event && event.location ? event.location : '';
  document.getElementById('event-description').value = event && event.description ? event.description : '';
  document.getElementById('event-reminder').value = event && event.reminderMinutesBefore !== null && event.reminderMinutesBefore !== undefined
    ? String(event.reminderMinutesBefore)
    : '';
  populateEventGroupSelect();
  document.getElementById('event-group').value = event && event.groupId ? String(event.groupId) : '';
  document.getElementById('btn-delete-event').classList.toggle('hidden', !event);
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
// Arranque
// ---------------------------------------------------------------------
async function init() {
  try {
    await loadGroups();
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
