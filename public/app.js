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
  // Extension "Gimnasio" (ver #gym-view en index.html): ejercicios,
  // rutinas y sesiones registradas. Se cargan al abrir la vista, no al
  // arrancar la app (a diferencia de groups/events), ya que es una
  // seccion aparte que la mayoria de aperturas de la app ni siquiera
  // visita.
  gymExercises: [],
  gymRoutines: [],
  gymSessions: [],
  // Extension "Lecturas" (ver #lecturas-view en index.html): sagas y,
  // cuando entras en una, los items de ESA saga. Se cargan al abrir la
  // vista/entrar en una saga, no al arrancar la app.
  lecturasSagas: [],
  lecturasItems: [],
  lecturasCurrentSagaId: null,
  // Calendario movil (Fase 2 del rediseño movil, ver CLAUDE.md): que dia
  // esta seleccionado en el modo Listado del mes, y que dia se esta
  // viendo en la vista diaria (ver enterMobileDayView() en app.js).
  mobileCalendarListDate: null,
  mobileCalendarDayDate: null,
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
function createSelectField({ options = [], initialValue = '', placeholder = '', onChange, scrollToValue } = {}) {
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
      item.dataset.value = opt.value;
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
      // value === '' cuenta como "nada elegido de verdad" aunque exista
      // una opcion placeholder con value '' (p.ej. "Cualquier año") que
      // por tanto tambien lleva la clase .active — en ese caso, si hay
      // un scrollToValue, tiene prioridad sobre ese placeholder.
      if (value !== '' || scrollToValue == null) {
        const activeItem = popover.querySelector('.select-option.active');
        if (activeItem) activeItem.scrollIntoView({ block: 'center' });
      } else {
        // Sin nada elegido todavia (p.ej. un filtro de año vacio): centrar
        // en un valor de respaldo (el año actual) solo para orientar,
        // SIN seleccionarlo — a diferencia de "active", esto no marca
        // ningun filtro como aplicado.
        const fallbackItem = popover.querySelector(`[data-value="${scrollToValue}"]`);
        if (fallbackItem) fallbackItem.scrollIntoView({ block: 'center' });
      }
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

// Version "elegir varios" de createSelectField() -- mismo boton+popover,
// pero clicar una opcion la marca/desmarca SIN cerrar el popover (para
// poder marcar varias seguidas), y lo elegido se ve ademas como una fila
// de chips debajo del boton, cada uno con su "x" para quitarlo suelto
// (mismo patron visual que los chips de createCountryPickerField, mas
// abajo en este archivo). Usado por los filtros de "Mis viajes"
// (año/mes/país, varios a la vez).
function createMultiSelectField({ options = [], initialValues = [], placeholder = '', onChange, scrollToValue } = {}) {
  let selected = [...initialValues];
  let opts = options;

  const root = document.createElement('div');
  root.className = 'multi-select-field';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-field-trigger';

  const chipsRow = document.createElement('div');
  chipsRow.className = 'multi-select-chips hidden';

  const popover = document.createElement('div');
  popover.className = 'select-popover hidden';
  document.body.appendChild(popover);

  function findLabel(value) {
    const opt = opts.find((o) => String(o.value) === String(value));
    return opt ? opt.label : value;
  }

  function renderTrigger() {
    trigger.textContent = selected.length
      ? `${selected.length} seleccionado${selected.length === 1 ? '' : 's'}`
      : (placeholder || 'Elegir...');
    trigger.classList.toggle('select-field-placeholder', selected.length === 0);
  }

  function emitChange() {
    if (onChange) onChange([...selected]);
  }

  function renderChips() {
    chipsRow.innerHTML = '';
    selected.forEach((value) => {
      const chip = document.createElement('span');
      chip.className = 'multi-select-chip';
      chip.textContent = findLabel(value);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', 'Quitar');
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => toggleValue(value));
      chip.appendChild(removeBtn);
      chipsRow.appendChild(chip);
    });
    chipsRow.classList.toggle('hidden', selected.length === 0);
  }

  // Refleja "selected" en los botones YA existentes del popover (clase
  // .active + el check ✓) SIN volver a crearlos -- a diferencia de un
  // select normal, aqui el popover se queda abierto entre un click y
  // otro, y reconstruir el HTML (popover.innerHTML = '') en mitad del
  // manejador de click DESENGANCHA el boton recien pulsado del DOM antes
  // de que el evento termine de burbujear hasta el listener global de
  // "cerrar popovers al hacer click fuera" (settings.js) -- ese listener
  // comprueba con closest('.select-popover') si el click vino de dentro,
  // y en un nodo ya desenganchado eso da null, así que cerraba el
  // popover el mismo despues de CADA opcion marcada. Actualizar en el
  // sitio evita el problema de raiz.
  function syncOptionStates() {
    popover.querySelectorAll('.select-option').forEach((item) => {
      const isSelected = selected.some((v) => String(v) === String(item.dataset.value));
      item.classList.toggle('active', isSelected);
      const check = item.querySelector('.multi-select-check');
      if (check) check.textContent = isSelected ? '✓' : '';
    });
  }

  function toggleValue(value) {
    const isSelected = selected.some((v) => String(v) === String(value));
    selected = isSelected ? selected.filter((v) => String(v) !== String(value)) : [...selected, value];
    renderTrigger();
    renderChips();
    syncOptionStates();
    emitChange();
  }

  // Reconstruye los BOTONES del popover -- solo hace falta cuando cambia
  // la lista de opciones en si (setOptions) o al crear el campo, nunca
  // en un click normal (ver syncOptionStates arriba).
  function renderOptions() {
    popover.innerHTML = '';
    opts.forEach((opt) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-option multi-select-option';
      item.dataset.value = opt.value;
      item.innerHTML = `<span class="multi-select-check"></span>${escapeHtml(opt.label)}`;
      item.addEventListener('click', () => toggleValue(opt.value));
      popover.appendChild(item);
    });
    syncOptionStates();
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
      const activeItem = popover.querySelector('.select-option.active');
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'center' });
      } else if (scrollToValue != null) {
        const fallbackItem = popover.querySelector(`[data-value="${scrollToValue}"]`);
        if (fallbackItem) fallbackItem.scrollIntoView({ block: 'center' });
      }
    }
  });

  root.append(trigger, chipsRow);
  renderOptions();
  renderTrigger();
  renderChips();

  return {
    element: root,
    getValue: () => [...selected],
    setValue: (values) => { selected = [...(values || [])]; renderTrigger(); renderChips(); syncOptionStates(); },
    // Igual que en el toggle de una opcion (ver syncOptionStates arriba):
    // esto puede llamarse en mitad del propio click de una opcion --
    // renderViajesFilters() recalcula "paises usados" y llama a
    // setOptions() en CADA cambio de filtro, incluidos los que vienen de
    // este mismo campo. Si la lista de valores no ha cambiado de
    // verdad, no hace falta reconstruir los botones (que desengancharia
    // el que se acaba de pulsar del DOM justo antes de que el click
    // termine de burbujear, cerrando el popover de golpe) -- solo si de
    // verdad cambian las opciones disponibles.
    setOptions: (newOptions) => {
      const changed = newOptions.length !== opts.length || newOptions.some((o, i) => String(o.value) !== String(opts[i] && opts[i].value));
      opts = newOptions;
      renderTrigger();
      renderChips();
      if (changed) renderOptions();
      else syncOptionStates();
    },
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

// ---------------------------------------------------------------------
// Confirmacion/aviso con el estilo de la app, para sustituir a
// confirm()/alert() nativos del navegador en flujos donde Koku ha pedido
// explicitamente que se note mas (p. ej. el enlace retroactivo de
// Viajes con Finanzas) -- un unico modal generico y reutilizable
// (#app-confirm-modal en index.html), no uno nuevo por caso de uso. El
// resto de confirm()/alert() nativos del proyecto (borrar una nota, un
// evento...) se quedan como estan, no es un reemplazo global.
// showAppConfirm() devuelve una Promise<boolean> (true = Aceptar, false =
// Cancelar/Esc); showAppAlert() es un atajo sin boton Cancelar, siempre
// resuelve true al pulsar Aceptar.
// ---------------------------------------------------------------------
let appConfirmResolve = null;
let appConfirmCheckboxStorageKey = null;
// opts.checkbox = { label, storageKey } (Fase 4 del rediseño movil,
// usado por el aviso de borrar una carpeta con contenido en modo
// Seleccionar de Notas): añade una fila con .styled-checkbox debajo del
// mensaje -- si esta marcada al pulsar Aceptar, se guarda
// localStorage[storageKey] = '1' (por dispositivo, mismo patron que el
// resto de ajustes de este tipo en la app) ANTES de resolver la
// promesa. Aditivo: no cambia nada para los usos existentes que no
// pasan "checkbox".
function showAppConfirm(message, { okText = 'Aceptar', cancelText = 'Cancelar', danger = false, alertOnly = false, checkbox = null } = {}) {
  return new Promise((resolve) => {
    appConfirmResolve = resolve;
    appConfirmCheckboxStorageKey = checkbox ? checkbox.storageKey : null;
    document.getElementById('app-confirm-modal-message').textContent = message;
    const okBtn = document.getElementById('btn-app-confirm-ok');
    okBtn.textContent = okText;
    okBtn.className = danger ? 'danger-btn' : 'primary-btn';
    document.getElementById('btn-app-confirm-cancel').classList.toggle('hidden', alertOnly);
    const checkboxRow = document.getElementById('app-confirm-checkbox-row');
    const checkboxInput = document.getElementById('app-confirm-checkbox');
    checkboxRow.classList.toggle('hidden', !checkbox);
    if (checkbox) {
      document.getElementById('app-confirm-checkbox-label').textContent = checkbox.label;
      checkboxInput.checked = false;
    }
    document.getElementById('app-confirm-modal').classList.remove('hidden');
  });
}
function showAppAlert(message, { okText = 'Aceptar' } = {}) {
  return showAppConfirm(message, { okText, alertOnly: true });
}
function closeAppConfirm(result) {
  document.getElementById('app-confirm-modal').classList.add('hidden');
  if (result && appConfirmCheckboxStorageKey && document.getElementById('app-confirm-checkbox').checked) {
    localStorage.setItem(appConfirmCheckboxStorageKey, '1');
  }
  appConfirmCheckboxStorageKey = null;
  if (appConfirmResolve) {
    const resolve = appConfirmResolve;
    appConfirmResolve = null;
    resolve(result);
  }
}
document.getElementById('btn-app-confirm-ok').addEventListener('click', () => closeAppConfirm(true));
document.getElementById('btn-app-confirm-cancel').addEventListener('click', () => closeAppConfirm(false));

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
enableCtrlEnterSubmit('onboarding-form');

// Bloqueo de scroll de fondo mientras haya un modal abierto -- todos los
// ~27 modales de la app comparten la clase .modal (confirmado con
// grep), asi que un UNICO MutationObserver vigilando esa clase basta
// para los 27, sin tener que tocar cada open*Modal()/close*Modal() por
// separado. Antes casi no se notaba (la pagina movil apenas se movia),
// pero desde que el calendario movil scrollea de verdad (Fase 3) se ve
// claramente el fondo desplazandose mientras rellenas un formulario.
// Se usa el truco clasico de position:fixed con el scroll guardado (no
// un simple overflow:hidden, que en algun navegador movil no evita el
// "rebote" del fondo).
let modalScrollLockY = 0;
function refreshModalScrollLock() {
  const anyOpen = document.querySelector('.modal:not(.hidden)') !== null;
  const isLocked = document.body.classList.contains('modal-open-lock');
  if (anyOpen && !isLocked) {
    modalScrollLockY = window.scrollY;
    document.body.style.top = `-${modalScrollLockY}px`;
    document.body.classList.add('modal-open-lock');
  } else if (!anyOpen && isLocked) {
    document.body.classList.remove('modal-open-lock');
    document.body.style.top = '';
    window.scrollTo(0, modalScrollLockY);
  }
}
const modalScrollLockObserver = new MutationObserver(refreshModalScrollLock);
document.querySelectorAll('.modal').forEach((el) => modalScrollLockObserver.observe(el, { attributes: true, attributeFilter: ['class'] }));

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
// Fase "multi-red": el ORIGEN de la app (de donde salen localStorage e
// IndexedDB) queda fijo desde la primera vez que se instala/abre en cada
// dispositivo -- no se puede ni se debe cambiar, o se "pierden" los datos
// guardados (son de otro origen para el navegador). Pero el ORDENADOR al
// que hay que mandar las peticiones sí puede cambiar (otra wifi, otro
// ordenador) -- eso se guarda aparte, en 'serverBaseUrl', y se actualiza
// escaneando el QR de Configuración → Dispositivos (ver
// openScanServerModal() en settings.js). Sin ese ajuste, se usa el propio
// origen de la pagina, que es lo que pasaba siempre antes de esto.
// ---------------------------------------------------------------------
function getServerBaseUrl() {
  return localStorage.getItem('serverBaseUrl') || window.location.origin;
}

// Fase "Archivos": el propio ordenador nunca guarda un token de
// dispositivo (ver requireDeviceOrTrusted en server/auth.js -- llega por
// loopback, no necesita emparejarse), asi que su ausencia es una forma
// fiable de saber, en el propio cliente, si "somos el ordenador" o "somos
// un movil emparejado". Se usa para mostrar/ocultar controles que el
// servidor solo permite al ordenador (carpeta de Archivos, boton de
// instalar una version nueva).
function isTrustedDevice() {
  return !localStorage.getItem('deviceToken');
}

// ---------------------------------------------------------------------
// Capa de red: envuelve fetch para añadir el token del dispositivo (si
// existe) y para reaccionar automaticamente si el servidor dice 401
// (dispositivo no vinculado) mostrando la pantalla de emparejamiento.
//
// Fase "movil": si el fetch falla por RED de verdad (no hay quien
// responda -- no confundir con un error normal del servidor, ESO sigue
// lanzando el mismo error que siempre), y la ruta es una de las tablas
// que se sincronizan (ver SYNC_TABLE_ROUTES/matchSyncRoute mas abajo), se sigue
// funcionando con la copia local en IndexedDB (public/db-local.js) en
// vez de romper la pantalla. Las demas rutas (temas, perfil,
// dispositivos...) no tienen copia local todavia -- si fallan sin
// conexion, se comportan igual que siempre (lanzan error).
// ---------------------------------------------------------------------
async function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  const token = localStorage.getItem('deviceToken');
  if (token) headers['X-Device-Token'] = token;

  const url = new URL(path, getServerBaseUrl());
  const method = (options.method || 'GET').toUpperCase();
  const route = matchSyncRoute(url.pathname);

  let res;
  try {
    res = await fetch(url.toString(), Object.assign({}, options, { headers }));
  } catch (networkErr) {
    if (!route) throw networkErr;
    return handleOfflineRequest(route, method, url, options);
  }

  if (res.status === 401) {
    localStorage.removeItem('deviceToken');
    showPairingScreen();
    throw new Error('device_not_paired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Error ${res.status}`);
  }

  const data = res.status === 204 ? null : await res.json();

  // Con exito de verdad, se guarda una copia en la copia local -- "cache
  // de escritura": la proxima vez que falle la red, esto es lo que se
  // vera. No se espera a que termine (no hace falta su resultado para
  // nada mas), pero si falla por lo que sea no debe romper la llamada
  // real, que ya tuvo exito.
  if (route) cacheServerResponse(route, method, data).catch(() => {});

  return data;
}

// ---------------------------------------------------------------------
// Copia local + sincronizacion (fase "movil"). Ver
// /root/.claude/plans/warm-sparking-beaver.md (o CLAUDE.md) para el
// diseño completo -- resumen: cada dispositivo guarda su propia copia
// de events/notes/groups/note_folders/special_days en IndexedDB
// (public/db-local.js); cuando hay conexion con el ordenador, se traen
// los cambios del servidor (pullChanges) y se mandan los pendientes de
// aqui (pushOutbox). "El mas reciente gana" sin avisos ni fusiones —a
// proposito, es una app de una sola persona.
// ---------------------------------------------------------------------

// A que almacen local corresponde cada ruta de la API, y como extraer
// el id de la URL. matchSyncRoute() se llama en CADA peticion de api(),
// asi que tiene que poder ejecutarse antes de que el resto de la app
// (state, load*...) exista todavia -- por eso no depende de nada mas.
const SYNC_TABLE_ROUTES = [
  { table: 'events', store: 'events', collectionRe: /^\/api\/events$/, itemRe: /^\/api\/events\/(\d+)$/ },
  { table: 'notes', store: 'notes', collectionRe: /^\/api\/notes$/, itemRe: /^\/api\/notes\/(\d+)$/ },
  { table: 'groups', store: 'groups', collectionRe: /^\/api\/groups$/, itemRe: /^\/api\/groups\/(\d+)$/ },
  { table: 'note_folders', store: 'noteFolders', collectionRe: /^\/api\/note-folders$/, itemRe: /^\/api\/note-folders\/(\d+)$/ },
  { table: 'special_days', store: 'specialDays', collectionRe: /^\/api\/special-days$/, itemRe: /^\/api\/special-days\/([^/]+)$/ },
  // Solo la BIBLIOTECA (/api/themes, /api/themes/:id) -- /api/themes/selection
  // y /api/themes/selection/mine (que tema usa CADA dispositivo) no
  // encajan en ninguno de los dos patrones de abajo a proposito, asi que
  // se quedan fuera de la copia local (eso sigue siendo por dispositivo).
  { table: 'themes', store: 'themes', collectionRe: /^\/api\/themes$/, itemRe: /^\/api\/themes\/(\d+)$/ },
  // /api/viajes-trips/by-country/:code (usada por el mapa) no encaja en
  // ninguno de los dos patrones a proposito, se queda fuera (siempre en
  // vivo, no tiene sentido cachearla aparte de la lista general).
  { table: 'viajes_trips', store: 'viajesTrips', collectionRe: /^\/api\/viajes-trips$/, itemRe: /^\/api\/viajes-trips\/(\d+)$/ },
  // Los adjuntos (fotos/tickets) NO tienen ruta propia aqui -- viajan
  // embebidos dentro de cada entrada (ver serializeEntry en el
  // servidor), asi que /api/viajes-entries/:id/attachments (subir una
  // foto) y /api/viajes-entries/attachments/... (servir/borrar/vincular
  // una foto) quedan fuera a proposito: exigen conexion siempre, igual
  // que subir una imagen a una nota.
  { table: 'viajes_entries', store: 'viajesEntries', collectionRe: /^\/api\/viajes-entries$/, itemRe: /^\/api\/viajes-entries\/(\d+)$/ },
];

function matchSyncRoute(pathname) {
  for (const r of SYNC_TABLE_ROUTES) {
    if (r.collectionRe.test(pathname)) return { table: r.table, store: r.store, kind: 'collection' };
    const m = pathname.match(r.itemRe);
    if (m) return { table: r.table, store: r.store, kind: 'item', itemId: r.store === 'specialDays' ? m[1] : Number(m[1]) };
  }
  return null;
}

async function cacheServerResponse(route, method, data) {
  if (route.kind === 'collection' && method === 'GET') {
    await localReplaceAll(route.store, Array.isArray(data) ? data : []);
    return;
  }
  if (method === 'DELETE') {
    await localDelete(route.store, route.itemId);
    return;
  }
  // special_days "borra por PUT" (type: null) en vez de un DELETE real.
  if (route.store === 'specialDays' && data && data.type === null) {
    await localDelete(route.store, data.date);
    return;
  }
  if (data && typeof data === 'object') {
    await localPut(route.store, data);
  }
}

async function handleOfflineRequest(route, method, url, options) {
  if (method === 'GET') return offlineRead(route, url);
  return offlineWrite(route, method, url, options);
}

async function offlineRead(route, url) {
  if (route.kind === 'item') {
    const row = await localGet(route.store, route.itemId);
    if (!row) throw new Error('No se pudo leer sin conexión (todavía no hay copia local de esto).');
    return row;
  }
  let rows = await localGetAll(route.store);
  if (route.store === 'events') {
    const isTask = url.searchParams.get('isTask');
    if (isTask !== null) {
      const want = isTask === '1' || isTask === 'true';
      rows = rows.filter((r) => !!r.isTask === want);
    }
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (from && to) rows = rows.filter((r) => r.startAt && r.startAt >= from && r.startAt <= to);
    rows.sort((a, b) => (a.startAt || '').localeCompare(b.startAt || ''));
  } else if (route.store === 'notes') {
    rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  } else if (route.store === 'groups' || route.store === 'noteFolders') {
    rows.sort((a, b) => (a.position || 0) - (b.position || 0));
  } else if (route.store === 'themes') {
    rows.sort((a, b) => (a.id || 0) - (b.id || 0));
  } else if (route.store === 'viajesTrips') {
    rows.sort((a, b) => (b.startDate || b.createdAt || '').localeCompare(a.startDate || a.createdAt || '') || (b.id || 0) - (a.id || 0));
  } else if (route.store === 'viajesEntries') {
    // GET /api/viajes-entries siempre exige ?tripId= (ver la ruta REST) --
    // aqui se aplica el mismo filtro sobre la copia local.
    const tripId = url.searchParams.get('tripId');
    if (tripId) rows = rows.filter((r) => String(r.tripId) === String(tripId));
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || 0) - (a.id || 0));
  }
  return rows;
}

// Construye la fila "optimista" que se guarda en la copia local nada
// mas escribir sin conexion, con la misma forma (camelCase) que
// devolveria el servidor -- para que la pantalla se pinte igual que si
// hubiera respondido de verdad. Cuando el campo referencia otra tabla
// (groupId, folderId) y esa fila YA esta en la copia local, se rellenan
// tambien nombre/color/icono para que se vea bien de inmediato; si no
// se puede (por ejemplo, apunta a algo tambien creado sin conexion en
// este mismo momento), se deja en blanco y se corrige solo al
// sincronizar.
async function buildOptimisticRecord(route, id, fields) {
  const now = new Date().toISOString();
  if (route.store === 'events') {
    const group = fields.groupId != null ? await localGet('groups', fields.groupId) : null;
    return {
      id,
      title: fields.title || '',
      description: fields.description ?? null,
      location: fields.location ?? null,
      startAt: fields.startAt ?? null,
      endAt: fields.endAt ?? null,
      allDay: !!fields.allDay,
      reminderMinutesBefore: fields.reminderMinutesBefore ?? null,
      groupId: fields.groupId ?? null,
      groupName: group ? group.name : null,
      groupColor: group ? group.color : null,
      groupIcon: group ? group.icon : null,
      groupCompletedColor: group ? group.completedColor : null,
      isTask: !!fields.isTask,
      done: !!fields.done,
      createdByName: null,
      createdByPublicId: null,
      createdAt: now,
      updatedAt: now,
    };
  }
  if (route.store === 'notes') {
    const folder = fields.folderId != null ? await localGet('noteFolders', fields.folderId) : null;
    // Fase 4: ya no se manda "title" desde el cliente (se deriva del
    // cuerpo, ver deriveTitleFromBodyClient) -- la copia optimista local
    // tiene que derivarlo de la misma forma, para que la nota se vea con
    // un titulo correcto en el listado ANTES de que llegue la respuesta
    // real del servidor. bodyFormat no se guardaba antes en el registro
    // optimista (solo llegaba via cacheServerResponse tras un exito
    // online) -- se añade aqui porque hace falta para derivar bien.
    return {
      id,
      title: deriveTitleFromBodyClient(fields.body, fields.bodyFormat),
      body: fields.body ?? null,
      bodyFormat: fields.bodyFormat || 'text',
      hidden: !!fields.hidden,
      favorite: !!fields.favorite,
      folderId: fields.folderId ?? null,
      folderName: folder ? folder.name : null,
      folderColor: folder ? folder.color : null,
      folderIcon: folder ? folder.icon : null,
      createdByName: null,
      createdByPublicId: null,
      createdAt: now,
      updatedAt: now,
    };
  }
  if (route.store === 'groups') {
    return {
      id,
      name: fields.name || '',
      color: fields.color || '#5b8cff',
      icon: fields.icon ?? null,
      position: fields.position ?? 0,
      completedColor: fields.completedColor ?? null,
      updatedAt: now,
    };
  }
  if (route.store === 'noteFolders') {
    return {
      id,
      name: fields.name || '',
      color: fields.color || '#5b8cff',
      icon: fields.icon ?? null,
      position: fields.position ?? 0,
      parentId: fields.parentId ?? null,
      favorite: !!fields.favorite,
      updatedAt: now,
    };
  }
  if (route.store === 'themes') {
    return {
      id,
      name: fields.name || '',
      colors: fields.colors || {},
      inverseColors: fields.inverseColors ?? null,
      updatedAt: now,
    };
  }
  if (route.store === 'viajesTrips') {
    // Al EDITAR (PUT) sin conexion, "fields" es la fila ya existente en
    // la copia local fusionada con lo nuevo (ver offlineWrite) -- asi
    // que entryCount ya viene relleno con el valor real; al CREAR
    // (POST) no hay fila previa, empieza en 0.
    return {
      id,
      name: fields.name || '',
      color: fields.color || '#5b8cff',
      countries: Array.isArray(fields.countries) ? fields.countries : [],
      startDate: fields.startDate ?? null,
      endDate: fields.endDate ?? null,
      description: fields.description ?? null,
      entryCount: fields.entryCount ?? 0,
      createdAt: now,
      updatedAt: now,
    };
  }
  if (route.store === 'viajesEntries') {
    // Subir una foto exige conexion siempre (ver el comentario de
    // SYNC_TABLE_ROUTES mas arriba), asi que "attachments" nunca se
    // rellena aqui de cero -- pero al EDITAR (PUT) el texto de una
    // entrada sin conexion, "fields" ya trae las fotos que tuviera de
    // antes (fusionadas desde la copia local, ver offlineWrite), y hay
    // que conservarlas en vez de vaciarlas.
    return {
      id,
      tripId: fields.tripId ?? null,
      date: fields.date || now.slice(0, 10),
      content: fields.content ?? null,
      attachments: Array.isArray(fields.attachments) ? fields.attachments : [],
      createdAt: now,
      updatedAt: now,
    };
  }
  // specialDays
  return { date: id, type: fields.type };
}

async function offlineWrite(route, method, url, options) {
  const body = options.body ? JSON.parse(options.body) : {};
  const localOpId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  if (route.store === 'specialDays') {
    // No hay DELETE real para dias especiales: un PUT con type=null
    // borra. rowId sale de la URL (la fecha), nunca es "nuevo".
    const date = route.itemId;
    if (body.type === null || body.type === undefined) {
      await localDelete('specialDays', date);
      await outboxAdd({ localOpId, table: 'special_days', rowId: date, tempId: null, op: 'delete', payload: null, clientUpdatedAt: nowIso });
      return { date, type: null };
    }
    const record = { date, type: body.type };
    await localPut('specialDays', record);
    await outboxAdd({ localOpId, table: 'special_days', rowId: date, tempId: null, op: 'upsert', payload: { type: body.type }, clientUpdatedAt: nowIso });
    return record;
  }

  if (method === 'POST') {
    // Crear sin conexion: id temporal NEGATIVO (los ids reales que
    // asigna el servidor siempre son positivos, asi que nunca puede
    // haber choque), sustituido por el real en cuanto se sincronice de
    // verdad (ver pushOutbox).
    const tempId = -Date.now();
    const record = await buildOptimisticRecord(route, tempId, body);
    await localPut(route.store, record);
    await outboxAdd({ localOpId, table: route.table, rowId: null, tempId, op: 'upsert', payload: body, clientUpdatedAt: nowIso });
    return record;
  }

  if (method === 'PUT') {
    const rowId = route.itemId;
    const existing = (await localGet(route.store, rowId)) || {};
    const merged = Object.assign({}, existing, body);
    const record = await buildOptimisticRecord(route, rowId, merged);
    await localPut(route.store, record);
    await outboxAdd({ localOpId, table: route.table, rowId, tempId: null, op: 'upsert', payload: body, clientUpdatedAt: nowIso });
    return record;
  }

  if (method === 'DELETE') {
    const rowId = route.itemId;
    await localDelete(route.store, rowId);
    await outboxAdd({ localOpId, table: route.table, rowId, tempId: null, op: 'delete', payload: null, clientUpdatedAt: nowIso });
    return null;
  }

  throw new Error('No se pudo hacer eso sin conexión.');
}

// --- Motor de sincronizacion --------------------------------------

let syncInProgress = false;

function buildAuthHeaders() {
  const headers = {};
  const token = localStorage.getItem('deviceToken');
  if (token) headers['X-Device-Token'] = token;
  return headers;
}

const SYNC_STORE_BY_TABLE = {
  events: 'events',
  notes: 'notes',
  groups: 'groups',
  note_folders: 'noteFolders',
  special_days: 'specialDays',
  themes: 'themes',
  viajes_trips: 'viajesTrips',
  viajes_entries: 'viajesEntries',
};

async function applyRemoteChange(change) {
  const store = SYNC_STORE_BY_TABLE[change.tableName];
  if (!store) return;
  if (change.op === 'delete') {
    await localDelete(store, change.rowId);
  } else if (change.payload) {
    await localPut(store, change.payload);
  }
}

// Trae del servidor todo lo que haya cambiado desde el ultimo cursor
// que recordamos (metaGet('syncCursor')), pagina a pagina, y lo aplica a
// la copia local. Devuelve como fue: { ok:true } si todo bien, o
// { ok:false, offline:true } si no se pudo ni conectar (lo normal y
// esperado si el ordenador no esta cerca), o { ok:false, message } si
// el ordenador SI respondio pero con un error de verdad -- eso ultimo
// es lo que refreshSyncIndicator() ensena en rojo, para no dejarlo
// pasar en silencio.
async function pullChanges() {
  let cursor = (await metaGet('syncCursor')) || 0;
  let hasMore = true;
  while (hasMore) {
    let res;
    try {
      res = await fetch(new URL(`/api/sync/pull?since=${cursor}&limit=500`, getServerBaseUrl()), { headers: buildAuthHeaders() });
    } catch {
      return { ok: false, offline: true };
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, message: body.message || `Error del servidor al traer cambios (código ${res.status}).` };
    }
    const data = await res.json();
    for (const change of data.changes) {
      await applyRemoteChange(change);
    }
    cursor = data.nextCursor;
    hasMore = data.hasMore;
  }
  await metaSet('syncCursor', cursor);
  await metaSet('lastSyncedAt', new Date().toISOString());
  return { ok: true };
}

// Manda los cambios pendientes de este dispositivo (cola _outbox), UNO A
// UNO y en orden (ver outboxAll/seq en db-local.js) -- no en un solo
// lote. Hace falta que sea uno a uno: el id REAL de algo creado sin
// conexion (una carpeta, por ejemplo) solo se sabe cuando el servidor
// responde a ESE cambio, asi que para poder corregir la referencia de
// un cambio siguiente que apunte a ese id temporal (una nota creada
// dentro de esa misma carpeta, sin conexion, en la misma sesion) hace
// falta esperar esa respuesta antes de mandar el siguiente. Con pocos
// cambios pendientes (lo normal para una persona) el coste de varias
// idas y vueltas en vez de una sola no se nota.
async function pushOutbox() {
  const pending = await outboxAll();
  if (!pending.length) return { ok: true };

  const tmpIdMap = new Map();
  const remapId = (id) => (typeof id === 'number' && id < 0 && tmpIdMap.has(id) ? tmpIdMap.get(id) : id);
  let rejectedCount = 0;

  for (const entry of pending) {
    const payload = entry.payload ? Object.assign({}, entry.payload) : entry.payload;
    if (payload) {
      if ('groupId' in payload) payload.groupId = remapId(payload.groupId);
      if ('folderId' in payload) payload.folderId = remapId(payload.folderId);
      if ('parentId' in payload) payload.parentId = remapId(payload.parentId);
      if ('tripId' in payload) payload.tripId = remapId(payload.tripId);
    }
    const change = {
      clientOpId: entry.localOpId,
      table: entry.table,
      rowId: entry.rowId != null ? remapId(entry.rowId) : null,
      op: entry.op,
      payload,
      clientUpdatedAt: entry.clientUpdatedAt,
    };

    let res;
    try {
      res = await fetch(new URL('/api/sync/push', getServerBaseUrl()), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, buildAuthHeaders()),
        body: JSON.stringify({ changes: [change] }),
      });
    } catch {
      return { ok: false, offline: true }; // se corto la conexion a media cola -- lo que queda se reintenta entero la proxima vez
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, message: body.message || `Error del servidor al mandar cambios (código ${res.status}).` };
    }
    const { results } = await res.json();
    const result = results[0];
    const store = SYNC_STORE_BY_TABLE[entry.table];

    if (result.status === 'applied' || result.status === 'superseded') {
      if (entry.tempId != null && result.serverRowId != null) {
        tmpIdMap.set(entry.tempId, result.serverRowId);
        await localDelete(store, entry.tempId);
      }
      if (result.serverPayload) {
        await localPut(store, result.serverPayload);
      } else if (entry.op === 'delete') {
        await localDelete(store, remapId(entry.rowId));
      }
    } else if (result.status === 'rejected') {
      // No hay forma automatica de arreglar un dato invalido desde aqui,
      // y no se quiere atascar la cola entera por un cambio malo -- se
      // descarta, pero se cuenta para poder avisar de que algo se perdio
      // (en vez de quedarse callado, ver computeSyncOutcome).
      rejectedCount += 1;
    }
    await outboxRemove(entry.localOpId);
  }

  return rejectedCount > 0
    ? { ok: true, message: `${rejectedCount} cambio${rejectedCount === 1 ? '' : 's'} sin conseguir mandar (datos no válidos) y se descartó.` }
    : { ok: true };
}

// Resultado de la ULTIMA vez que se intento sincronizar -- lo lee el
// punto de la topbar (refreshSyncIndicator) y el texto de Configuracion
// (refreshSyncStatusUI). No se guarda entre sesiones a proposito (si
// recargas la pagina, se vuelve a calcular en el primer runSync() de
// init() en vez de ensenar un estado quiza ya viejo).
let lastSyncOutcome = { status: 'unknown', message: '' };

// Decide el estado final combinando lo que paso en pushOutbox()/
// pullChanges() (ver sus comentarios: cada uno devuelve si fue bien,
// si fue por falta de conexion, o si hubo un error de verdad) con si
// queda algo pendiente en la cola.
async function computeSyncOutcome(pushResult, pullResult) {
  if (pushResult.offline || pullResult.offline) {
    lastSyncOutcome = { status: 'offline', message: 'Sin conexión con el ordenador ahora mismo.' };
    return;
  }
  if (!pushResult.ok || !pullResult.ok) {
    lastSyncOutcome = { status: 'error', message: (!pushResult.ok && pushResult.message) || (!pullResult.ok && pullResult.message) || 'Error al sincronizar.' };
    return;
  }
  if (pushResult.message) {
    // Se pudo conectar y sincronizar, pero algun cambio se rechazo por
    // datos invalidos -- no es un fallo de conexion, pero tampoco es
    // "todo perfecto", asi que se ensena igual que un error de verdad.
    lastSyncOutcome = { status: 'error', message: pushResult.message };
    return;
  }
  const pending = await outboxAll();
  lastSyncOutcome = pending.length
    ? { status: 'pending', message: `${pending.length} cambio${pending.length === 1 ? '' : 's'} pendiente${pending.length === 1 ? '' : 's'} de mandar.` }
    : { status: 'synced', message: '' };
}

async function runSync() {
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    const pushResult = await pushOutbox();
    const pullResult = await pullChanges();
    await computeSyncOutcome(pushResult, pullResult);
  } catch (err) {
    // Esto SI es inesperado de verdad (un error de programacion, no de
    // conexion) -- pushOutbox/pullChanges ya capturan los fallos de red
    // y de servidor por su cuenta, asi que si algo llega hasta aqui
    // merece ensenarse, no quedarse callado.
    lastSyncOutcome = { status: 'error', message: err.message || 'Error inesperado al sincronizar.' };
  } finally {
    syncInProgress = false;
    refreshSyncStatusUI();
    refreshSyncIndicator();
  }
}

async function refreshSyncStatusUI() {
  const statusEl = document.getElementById('sync-status');
  if (!statusEl) return;
  const lastSyncedAt = await metaGet('lastSyncedAt');
  const baseText = lastSyncedAt
    ? `Última sincronización: ${new Date(lastSyncedAt).toLocaleString()}`
    : 'Todavía no se ha sincronizado en este dispositivo';
  statusEl.textContent = lastSyncOutcome.message ? `${baseText} · ${lastSyncOutcome.message}` : baseText;
}

const SYNC_INDICATOR_LABELS = {
  unknown: 'Sincronización: todavía sin comprobar',
  synced: 'Sincronización: todo al día',
  pending: 'Sincronización: hay cambios pendientes de mandar',
  offline: 'Sincronización: sin conexión con el ordenador ahora mismo',
  error: 'Sincronización: hubo un error',
};

function refreshSyncIndicator() {
  const btn = document.getElementById('sync-indicator');
  if (!btn) return;
  btn.dataset.status = lastSyncOutcome.status;
  const label = lastSyncOutcome.message
    ? `${SYNC_INDICATOR_LABELS[lastSyncOutcome.status]} (${lastSyncOutcome.message})`
    : SYNC_INDICATOR_LABELS[lastSyncOutcome.status];
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

document.getElementById('btn-sync-now').addEventListener('click', async () => {
  const btn = document.getElementById('btn-sync-now');
  btn.disabled = true;
  await runSync();
  btn.disabled = false;
});

// El punto de la topbar lleva directo a Apps > Archivos (donde
// esta el detalle y el boton de "Sincronizar ahora" -- ver mas abajo),
// no hace nada por si solo mas alla de eso.
document.getElementById('sync-indicator').addEventListener('click', () => {
  openArchivosView();
});

// Fase "Archivos": ya NO se sincroniza sola al volver la conexion --
// solo cuando se pide a mano desde Apps > Archivos (ver
// openArchivosView() y btn-sync-now mas abajo). Decision explicita de
// Koku, confirmada dos veces: si no se abre ese apartado, los cambios de
// este dispositivo no llegan al otro hasta que se dispare a mano.

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
  renderMobileCalendarMonthGrid();
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

// renderAgendaList() (la lista plana antigua de movil) se quito por
// completo en la Fase 2 del rediseño movil -- sustituida por las vistas
// de mes/año propias mas abajo (renderMobileCalendarMonthGrid() y
// alrededores).

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Las flechas del mes navegan por AÑO en vez de por mes mientras estas
// en la vista anual (ver calendarViewMode mas abajo) -- mismo boton,
// distinto salto, coherente con lo que se esta mirando.
document.getElementById('nav-prev').addEventListener('click', () => {
  if (calendarViewMode === 'year') {
    state.viewDate = new Date(state.viewDate.getFullYear() - 1, state.viewDate.getMonth(), 1);
    refreshCalendarYearGrid();
    return;
  }
  state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
  loadMonth();
});
document.getElementById('nav-next').addEventListener('click', () => {
  if (calendarViewMode === 'year') {
    state.viewDate = new Date(state.viewDate.getFullYear() + 1, state.viewDate.getMonth(), 1);
    refreshCalendarYearGrid();
    return;
  }
  state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
  loadMonth();
});

// ---------------------------------------------------------------------
// Vista anual (solo escritorio): las 12 miniaturas del año a la vez, en
// vez del mes a mes de siempre -- pedido explicito de Koku, "ya que hay
// mas espacio [en el ordenador] creo que seria visible". Se alterna con
// gestos de la rueda del raton (hacia abajo sobre el mes = vista anual;
// hacia arriba sobre un mes de la vista anual = entrar en ese mes) o con
// el boton de apoyo #btn-calendar-year-toggle -- nunca con un gesto si
// hay un modal u otra pantalla completa delante (isGestureBlockedByModal),
// para no cambiar de vista sin querer mientras, por ejemplo, escribes la
// descripcion de un evento y esa caja de texto hace scroll.
// ---------------------------------------------------------------------
let calendarViewMode = 'month'; // 'month' | 'year'
let yearViewEventsYear = null;
let yearViewEvents = [];

async function loadYearViewEvents(year) {
  if (yearViewEventsYear === year) return;
  yearViewEvents = await api(`/api/events?from=${year}-01-01T00:00:00&to=${year}-12-31T23:59:59`);
  yearViewEventsYear = year;
}

function isGestureBlockedByModal() {
  if (document.querySelector('.modal:not(.hidden)')) return true;
  const fullscreenIds = [
    'my-space-view', 'extensions-view', 'gym-view', 'finanzas-view',
    'lecturas-view', 'archivos-view', 'note-editor-view',
  ];
  return fullscreenIds.some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  });
}

function enterMonthFromYear(month) {
  state.viewDate = new Date(state.viewDate.getFullYear(), month, 1);
  setCalendarViewMode('month');
}

function renderCalendarYearGrid() {
  const container = document.getElementById('calendar-year-grid');
  container.innerHTML = '';
  const year = state.viewDate.getFullYear();
  const today = new Date();

  for (let month = 0; month < 12; month++) {
    const monthDate = new Date(year, month, 1);
    const tile = document.createElement('div');
    tile.className = 'calendar-year-tile';

    const heading = document.createElement('div');
    heading.className = 'calendar-year-tile-heading';
    const label = MONTH_ONLY_FORMATTER.format(monthDate);
    heading.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    tile.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'calendar-year-tile-grid';

    // Igual que el mes grande: la semana empieza en lunes, y solo se
    // pintan las semanas que hacen falta para ese mes (4 a 6 segun como
    // caiga), sin filas de sobra vacias.
    const first = startOfMonth(monthDate);
    const last = endOfMonth(monthDate);
    const firstWeekday = (first.getDay() + 6) % 7;
    const lastWeekday = (last.getDay() + 6) % 7;
    const gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - firstWeekday);
    const totalDays = firstWeekday + last.getDate() + (6 - lastWeekday);

    for (let i = 0; i < totalDays; i++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + i);

      const cell = document.createElement('span');
      cell.className = 'calendar-year-day';
      cell.textContent = cellDate.getDate();
      if (cellDate.getMonth() !== month) cell.classList.add('other-month');
      if (sameDay(cellDate, today)) cell.classList.add('today');

      const dayType = state.specialDays[toDateKey(cellDate)];
      if (dayType === 'holiday') cell.classList.add('holiday-day');
      else if (dayType === 'special') cell.classList.add('special-day');
      else if (cellDate.getDay() === 0 || cellDate.getDay() === 6) cell.classList.add('weekend-day');

      if (yearViewEvents.some((ev) => ev.startAt && sameDay(new Date(ev.startAt), cellDate))) {
        cell.classList.add('has-content');
      }

      grid.appendChild(cell);
    }
    tile.appendChild(grid);

    tile.addEventListener('click', () => enterMonthFromYear(month));
    tile.addEventListener('wheel', (e) => {
      if (isGestureBlockedByModal()) return;
      if (e.deltaY >= 0) return; // solo hacia arriba = "entrar" en el mes
      e.preventDefault();
      enterMonthFromYear(month);
    }, { passive: false });

    container.appendChild(tile);
  }
}

async function refreshCalendarYearGrid() {
  const year = state.viewDate.getFullYear();
  document.getElementById('current-month-label').textContent = String(year);
  await loadYearViewEvents(year);
  renderCalendarYearGrid();
}

const CALENDAR_VIEW_ANIMATION_MS = 320;

function playCalendarViewAnimation(el) {
  el.classList.remove('calendar-view-entering');
  // Forzar reflow para que la animacion se pueda relanzar si el modo se
  // cambia varias veces seguidas muy rapido (si no, quitar y volver a
  // poner la misma clase en el mismo "tick" no reinicia la animacion).
  void el.offsetWidth;
  el.classList.add('calendar-view-entering');
  setTimeout(() => el.classList.remove('calendar-view-entering'), CALENDAR_VIEW_ANIMATION_MS);
}

async function setCalendarViewMode(mode) {
  if (mode === calendarViewMode) return;
  calendarViewMode = mode;
  const monthEl = document.getElementById('calendar-grid');
  const yearEl = document.getElementById('calendar-year-grid');
  document.getElementById('btn-calendar-year-toggle').classList.toggle('active', mode === 'year');

  if (mode === 'year') {
    await refreshCalendarYearGrid();
    monthEl.classList.add('hidden');
    yearEl.classList.remove('hidden');
    playCalendarViewAnimation(yearEl);
  } else {
    await loadMonth();
    yearEl.classList.add('hidden');
    monthEl.classList.remove('hidden');
    playCalendarViewAnimation(monthEl);
  }
  // Movil (Fase 2 del rediseño movil): mismo `calendarViewMode` como
  // fuente unica de verdad, para que si alguien redimensiona la ventana
  // a media sesion la vista se mantenga coherente entre escritorio y
  // movil. loadMonth() (llamado arriba en la rama "month") ya repinta
  // #mobile-calendar-month-grid via renderMobileCalendarMonthGrid().
  if (mode === 'year') {
    await refreshMobileCalendarYearGrid();
  }
  refreshMobileCalendarModeVisibility();
  refreshMobileCalendarNavLabel();
}

document.getElementById('btn-calendar-year-toggle').addEventListener('click', () => {
  setCalendarViewMode(calendarViewMode === 'year' ? 'month' : 'year');
});

// Rueda del raton hacia abajo sobre el mes = vista anual. Si el punto
// donde estaba el raton es una celda que YA scrollea por su cuenta (un
// dia con muchos eventos, ver .calendar-cell en styles.css), se deja
// pasar el scroll normal de esa celda en vez de interceptarlo -- si no,
// seria imposible leer un dia lleno sin cambiar de vista sin querer.
document.getElementById('calendar-grid-wrap').addEventListener('wheel', (e) => {
  if (calendarViewMode !== 'month') return;
  if (e.deltaY <= 0) return;
  if (isGestureBlockedByModal()) return;
  const cell = e.target.closest('.calendar-cell');
  if (cell && cell.scrollHeight > cell.clientHeight) return;
  e.preventDefault();
  setCalendarViewMode('year');
}, { passive: false });

// ---------------------------------------------------------------------
// Calendario MOVIL (Fase 2 del rediseño movil, ver CLAUDE.md): vistas de
// mes/año propias, en contenedores separados de escritorio (nunca
// comparten nodo con calendar-grid-wrap.desktop-only -- se investigo a
// fondo antes de construir esto: la vista anual de escritorio vivia
// ANIDADA dentro de ese contenedor, asi que reutilizar el mismo DOM no
// era viable sin romper el corte movil/escritorio). Comparten con
// escritorio la LOGICA de datos (loadYearViewEvents, state.events) pero
// el pintado es propio -- el calculo de fechas del mes SI se duplica a
// proposito (buildMonthCellDates de aqui abajo, y el de
// renderCalendarGrid mas arriba): son solo 6 lineas de aritmetica ya
// verificadas, y evita tocar la funcion de escritorio que Koku ya usa a
// diario.
// ---------------------------------------------------------------------

// Gesto generico de swipe (Pointer Events -- funciona con dedo, raton o
// lapiz con un unico mecanismo, sin depender de eventos "touch"
// especificos). Solo detecta la DIRECCION al soltar, sin arrastre en
// vivo -- suficiente para cambiar de mes/año/dia, no hace falta mas.
function attachSwipe(el, { onUp, onDown, onLeft, onRight, threshold = 40 } = {}) {
  let startX = null;
  let startY = null;
  el.addEventListener('pointerdown', (e) => {
    if (isGestureBlockedByModal()) return;
    startX = e.clientX;
    startY = e.clientY;
    // Sin esto, si el dedo se sale del contenedor durante el arrastre (muy
    // facil cerca de un borde, en una cuadricula no muy alta), el
    // "pointerup" llega al elemento que haya debajo del dedo en ESE
    // momento, no a este -- y el gesto se queda "colgado" sin completarse.
    // setPointerCapture fuerza a que TODO el gesto (incluido el pointerup)
    // siga llegando aqui pase lo que pase.
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    startX = null;
    startY = null;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (Math.abs(dx) < threshold) return;
      if (dx < 0 && onLeft) onLeft();
      else if (dx > 0 && onRight) onRight();
    } else {
      if (Math.abs(dy) < threshold) return;
      if (dy < 0 && onUp) onUp();
      else if (dy > 0 && onDown) onDown();
    }
  });
  el.addEventListener('pointercancel', () => { startX = null; startY = null; });
}

// Mismo calculo de fechas que renderCalendarGrid() (42 celdas, semana
// empieza en lunes) pero como funcion aparte reutilizable -- ver nota de
// arriba sobre por que NO se toca renderCalendarGrid() para compartirla.
function buildMonthCellDates(viewDate) {
  const first = startOfMonth(viewDate);
  const firstWeekday = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - firstWeekday);
  const dates = [];
  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + i);
    dates.push(cellDate);
  }
  return dates;
}

// Igual que arriba pero con solo las semanas que hace falta para ESE mes
// (4 a 6, sin fila de sobra) -- mismo criterio que ya usa
// renderCalendarYearGrid() de escritorio para sus miniaturas, reutilizado
// aqui para los 12 meses en miniatura de la vista anual movil.
function buildYearTileCellDates(monthDate) {
  const first = startOfMonth(monthDate);
  const last = endOfMonth(monthDate);
  const firstWeekday = (first.getDay() + 6) % 7;
  const lastWeekday = (last.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - firstWeekday);
  const totalDays = firstWeekday + last.getDate() + (6 - lastWeekday);
  const dates = [];
  for (let i = 0; i < totalDays; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + i);
    dates.push(cellDate);
  }
  return dates;
}

// Que grupos DISTINTOS estan representados un dia concreto -- no es que
// un evento pertenezca a varios grupos (un evento/tarea siempre es de UN
// grupo, ver events.group_id en server/db.js), es agregar varios
// eventos/tareas de ESE dia que pueden ser de grupos distintos entre si.
// Orden pedido por Koku: los de "todo el dia" primero, luego por hora de
// inicio; un grupo que ya aparecio no se repite aunque tenga mas de un
// evento ese dia.
function getDistinctGroupsForDay(dayEvents) {
  const sorted = [...dayEvents].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return new Date(a.startAt) - new Date(b.startAt);
  });
  const seen = new Set();
  const groups = [];
  sorted.forEach((ev) => {
    const key = ev.groupId != null ? `g${ev.groupId}` : `c${ev.groupColor || DEFAULT_EVENT_COLOR}`;
    if (seen.has(key)) return;
    seen.add(key);
    groups.push({ color: ev.groupColor || DEFAULT_EVENT_COLOR });
  });
  return groups;
}

function buildMobileDayGroupPill(groups) {
  const pill = document.createElement('div');
  pill.className = 'mobile-day-group-pill';
  groups.forEach((g) => {
    const span = document.createElement('span');
    span.style.backgroundColor = g.color;
    pill.appendChild(span);
  });
  return pill;
}

// Ajuste por dispositivo (localStorage, NO sincronizado -- mismo patron
// que calendarDayDensity de escritorio, ver getCalendarDensityMode() mas
// arriba): que tan "denso" se ve un dia con eventos en el mes movil.
const MOBILE_CALENDAR_MONTH_MODE_IDS = ['compact', 'stacked', 'listed'];
function getMobileCalendarMonthMode() {
  const stored = localStorage.getItem('mobileCalendarMonthMode');
  return MOBILE_CALENDAR_MONTH_MODE_IDS.includes(stored) ? stored : 'compact';
}
function cycleMobileCalendarMonthMode() {
  const idx = MOBILE_CALENDAR_MONTH_MODE_IDS.indexOf(getMobileCalendarMonthMode());
  const next = MOBILE_CALENDAR_MONTH_MODE_IDS[(idx + 1) % MOBILE_CALENDAR_MONTH_MODE_IDS.length];
  localStorage.setItem('mobileCalendarMonthMode', next);
  renderMobileCalendarMonthGrid();
  refreshMobileCalendarModeVisibility();
}

// "De que hora a que hora" para el modo Listado (mes) -- no existia un
// formateador de RANGO en el proyecto, el resto de sitios solo muestran
// la hora de inicio.
function formatMobileEventTimeRange(ev) {
  if (ev.allDay) return 'Todo el día';
  const start = TIME_FORMATTER.format(new Date(ev.startAt));
  if (!ev.endAt) return start;
  const end = TIME_FORMATTER.format(new Date(ev.endAt));
  return end === start ? start : `${start}–${end}`;
}

function renderMobileCalendarMonthGrid() {
  const grid = document.getElementById('mobile-calendar-month-grid');
  grid.innerHTML = '';
  const mode = getMobileCalendarMonthMode();
  const today = new Date();

  WEEKDAY_LABELS.forEach((label) => {
    const el = document.createElement('div');
    el.className = 'mobile-calendar-weekday-heading';
    el.textContent = label;
    grid.appendChild(el);
  });

  buildMonthCellDates(state.viewDate).forEach((cellDate) => {
    const cell = document.createElement('div');
    cell.className = 'mobile-calendar-day-cell';
    if (cellDate.getMonth() !== state.viewDate.getMonth()) cell.classList.add('other-month');
    if (sameDay(cellDate, today)) cell.classList.add('today');
    const dayType = state.specialDays[toDateKey(cellDate)];
    if (dayType === 'holiday') cell.classList.add('holiday-day');
    else if (dayType === 'special') cell.classList.add('special-day');
    else if (cellDate.getDay() === 0 || cellDate.getDay() === 6) cell.classList.add('weekend-day');

    const circle = document.createElement('div');
    circle.className = 'mobile-calendar-day-circle';
    circle.textContent = cellDate.getDate();
    cell.appendChild(circle);

    const dayEvents = state.events.filter((ev) => ev.startAt && sameDay(new Date(ev.startAt), cellDate));
    const groups = getDistinctGroupsForDay(dayEvents);

    if (groups.length > 0) {
      if (mode === 'stacked') {
        const bars = document.createElement('div');
        bars.className = 'mobile-calendar-day-cell-bars';
        groups.slice(0, 2).forEach((g) => {
          const bar = document.createElement('div');
          bar.className = 'mobile-day-group-bar';
          bar.style.backgroundColor = g.color;
          bars.appendChild(bar);
        });
        if (groups.length > 2) {
          const more = document.createElement('div');
          more.className = 'mobile-day-group-more';
          more.textContent = `+${groups.length - 2}`;
          bars.appendChild(more);
        }
        cell.appendChild(bars);
      } else {
        // 'compact' y el mini-mes de 'listed' usan el mismo formato.
        cell.appendChild(buildMobileDayGroupPill(groups));
      }
    }

    cell.addEventListener('click', () => {
      if (getMobileCalendarMonthMode() === 'listed') {
        state.mobileCalendarListDate = cellDate;
        renderMobileCalendarMonthList(cellDate);
      } else {
        enterMobileDayView(cellDate);
      }
    });

    grid.appendChild(cell);
  });

  if (mode === 'listed') {
    renderMobileCalendarMonthList(ensureMobileCalendarListDate());
  }
}

// Que dia muestra la lista del modo Listado por defecto: hoy, si el mes
// que se esta viendo es el mes real; si no, el dia 1 del mes que se esta
// viendo. Se recalcula solo cuando el dia guardado ya no pertenece al mes
// actual (cambiar de mes) -- cambiar solo de modo de densidad conserva el
// dia que ya tenias elegido.
function ensureMobileCalendarListDate() {
  const stored = state.mobileCalendarListDate;
  if (stored && stored.getFullYear() === state.viewDate.getFullYear() && stored.getMonth() === state.viewDate.getMonth()) {
    return stored;
  }
  const today = new Date();
  const fallback = (today.getFullYear() === state.viewDate.getFullYear() && today.getMonth() === state.viewDate.getMonth())
    ? today
    : startOfMonth(state.viewDate);
  state.mobileCalendarListDate = fallback;
  return fallback;
}

async function renderMobileCalendarMonthList(date) {
  const container = document.getElementById('mobile-calendar-month-list');
  const dateStr = toDateKey(date);
  const dayEvents = await api(`/api/events?from=${dateStr}T00:00:00&to=${dateStr}T23:59:59`);
  // Si mientras se esperaba la respuesta el usuario ya toco otro dia, o
  // cambio de modo de densidad, esta respuesta esta obsoleta -- no pisar
  // lo que se ve ahora.
  if (!state.mobileCalendarListDate || toDateKey(state.mobileCalendarListDate) !== dateStr) return;
  if (getMobileCalendarMonthMode() !== 'listed') return;

  container.innerHTML = '';
  if (dayEvents.length === 0) {
    container.innerHTML = '<p class="empty-hint">No hay nada este día.</p>';
    return;
  }
  dayEvents.forEach((ev) => {
    const row = document.createElement('div');
    row.className = 'mobile-calendar-month-list-row';
    const bar = document.createElement('div');
    bar.className = 'mobile-calendar-month-list-bar';
    bar.style.backgroundColor = ev.isTask ? (ev.done ? taskCompletedColor(ev) : taskPendingColor(ev)) : (ev.groupColor || DEFAULT_EVENT_COLOR);
    const title = document.createElement('div');
    title.className = 'mobile-calendar-month-list-title';
    title.textContent = ev.title;
    const time = document.createElement('div');
    time.className = 'mobile-calendar-month-list-time';
    time.textContent = formatMobileEventTimeRange(ev);
    row.append(bar, title, time);
    row.addEventListener('click', () => (ev.isTask ? openTaskModal(ev) : openEventModal(ev)));
    container.appendChild(row);
  });
}

function renderMobileCalendarYearGrid() {
  const container = document.getElementById('mobile-calendar-year-grid');
  container.innerHTML = '';
  const year = state.viewDate.getFullYear();
  const today = new Date();

  for (let month = 0; month < 12; month++) {
    const monthDate = new Date(year, month, 1);
    const tile = document.createElement('div');
    tile.className = 'mobile-calendar-year-tile';

    const heading = document.createElement('div');
    heading.className = 'mobile-calendar-year-tile-heading';
    const label = MONTH_ONLY_FORMATTER.format(monthDate);
    heading.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    tile.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'mobile-calendar-year-tile-grid';
    buildYearTileCellDates(monthDate).forEach((cellDate) => {
      const cell = document.createElement('span');
      cell.className = 'mobile-calendar-year-day';
      if (cellDate.getMonth() !== month) {
        // Celda de relleno de otro mes -- Koku pidio que se queden en
        // blanco (sin numero) en vez de mostrar el dia atenuado; se
        // deja el hueco vacio para no descuadrar la cuadricula de 7
        // columnas, pero sin comprobar "hoy"/"tiene contenido" (no
        // tiene sentido para un dia que no es de este mes).
        cell.classList.add('other-month');
        grid.appendChild(cell);
        return;
      }
      cell.textContent = cellDate.getDate();
      if (sameDay(cellDate, today)) cell.classList.add('today');
      if (yearViewEvents.some((ev) => ev.startAt && sameDay(new Date(ev.startAt), cellDate))) {
        cell.classList.add('has-content');
      }
      grid.appendChild(cell);
    });
    tile.appendChild(grid);

    tile.addEventListener('click', () => enterMonthFromYear(month));
    container.appendChild(tile);
  }
}

async function refreshMobileCalendarYearGrid() {
  await loadYearViewEvents(state.viewDate.getFullYear());
  renderMobileCalendarYearGrid();
}

function refreshMobileCalendarModeVisibility() {
  const view = document.querySelector('.mobile-calendar-view');
  const monthGrid = document.getElementById('mobile-calendar-month-grid');
  const monthList = document.getElementById('mobile-calendar-month-list');
  const yearGrid = document.getElementById('mobile-calendar-year-grid');
  const isListed = calendarViewMode === 'month' && getMobileCalendarMonthMode() === 'listed';
  view.classList.toggle('is-listed', isListed);
  if (calendarViewMode === 'year') {
    monthGrid.classList.add('hidden');
    monthList.classList.add('hidden');
    yearGrid.classList.remove('hidden');
  } else {
    yearGrid.classList.add('hidden');
    monthGrid.classList.remove('hidden');
    monthList.classList.toggle('hidden', !isListed);
  }
  // La densidad (compacto/stakeado/listado) solo tiene sentido dentro del
  // MES (y, cuando exista, de la vista diaria -- que ya trae su propio
  // interruptor "Vista por horas"/"Listado" aparte) -- en año no hace
  // nada visible, Koku confirmo que lo probo y no pasaba nada al pulsarlo.
  document.getElementById('btn-mobile-calendar-density').classList.toggle('hidden', calendarViewMode === 'year');
}

function refreshMobileCalendarNavLabel() {
  const label = document.getElementById('btn-mobile-calendar-nav-label');
  const year = state.viewDate.getFullYear();
  if (calendarViewMode === 'year') {
    label.innerHTML = `<span>${year}</span>`;
  } else {
    // Icono de flecha real (svg), no solo el caracter "▲" -- Koku
    // pregunto si ese triangulo hacia algo, señal de que como texto
    // plano no se leia como el boton que es.
    label.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg><span>${year}</span>`;
  }
}

document.getElementById('btn-mobile-calendar-nav-label').addEventListener('click', () => {
  if (calendarViewMode === 'year') enterMonthFromYear(state.viewDate.getMonth());
  else setCalendarViewMode('year');
});
document.getElementById('btn-mobile-calendar-density').addEventListener('click', () => {
  cycleMobileCalendarMonthMode();
});
// El buscador global de verdad (eventos+tareas+notas por texto) llega en
// la Fase 5 del rediseño movil -- de momento solo avisa, para que el
// boton ya este en su sitio definitivo sin sentirse roto.
document.getElementById('btn-mobile-calendar-search').addEventListener('click', () => {
  showAppAlert('El buscador llega en la próxima ronda.');
});

// Swipe vertical del MES: arriba = mes siguiente, abajo = mes anterior
// (direccion normal). Swipe vertical del AÑO: arriba = año ANTERIOR,
// abajo = año siguiente -- direccion EXPLICITAMENTE invertida, pedido
// asi por Koku.
attachSwipe(document.getElementById('mobile-calendar-month-grid'), {
  onUp: () => {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
    loadMonth();
  },
  onDown: () => {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
    loadMonth();
  },
});
attachSwipe(document.getElementById('mobile-calendar-year-grid'), {
  onUp: () => {
    state.viewDate = new Date(state.viewDate.getFullYear() - 1, state.viewDate.getMonth(), 1);
    refreshMobileCalendarYearGrid();
    refreshMobileCalendarNavLabel();
  },
  onDown: () => {
    state.viewDate = new Date(state.viewDate.getFullYear() + 1, state.viewDate.getMonth(), 1);
    refreshMobileCalendarYearGrid();
    refreshMobileCalendarNavLabel();
  },
});

// ---------------------------------------------------------------------
// Vista diaria movil completa (Fase 3 del rediseño movil, ver
// CLAUDE.md): tira semanal + 2 sub-vistas ("Vista por horas"/"Listado").
// ---------------------------------------------------------------------

// Formateador propio para la cabecera del dia ("Miercoles - 3 Sep 2026")
// y los bloques de Listado ("Lunes - 2 Sep") -- se escribe a mano en vez
// de con Intl.DateTimeFormat porque el mes abreviado en es-ES a veces
// viene con un punto ("sept.") segun el motor, y aqui se queria un
// formato corto fijo sin sorpresas.
const MOBILE_DAY_MONTH_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MOBILE_DAY_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('es-ES', { weekday: 'long' });
function capitalizeFirst(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
function formatMobileDayHeading(date) {
  const weekday = capitalizeFirst(MOBILE_DAY_WEEKDAY_FORMATTER.format(date));
  return `${weekday} - ${date.getDate()} ${MOBILE_DAY_MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`;
}
function formatMobileListadoBlockHeading(date) {
  const weekday = capitalizeFirst(MOBILE_DAY_WEEKDAY_FORMATTER.format(date));
  return `${weekday} - ${date.getDate()} ${MOBILE_DAY_MONTH_ABBR[date.getMonth()]}`;
}

// Ajuste por dispositivo (localStorage, NO sincronizado -- mismo patron
// que mobileCalendarMonthMode de arriba): que sub-vista del dia se ve.
function getMobileDayViewMode() {
  return localStorage.getItem('mobileDayViewMode') === 'listado' ? 'listado' : 'hours';
}

// Los 7 dias (lunes a domingo) de la semana que contiene `date`.
function getWeekDatesFor(date) {
  const dow = (date.getDay() + 6) % 7; // 0 = lunes
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - dow);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  return days;
}

async function renderMobileWeekStrip(viewingDate) {
  const days = getWeekDatesFor(viewingDate);
  const from = toDateKey(days[0]);
  const to = toDateKey(days[6]);
  const weekEvents = await api(`/api/events?from=${from}T00:00:00&to=${to}T23:59:59`);
  // Si mientras se esperaba la respuesta el usuario ya cambio de dia (p.
  // ej. deslizando varias veces seguidas), esta respuesta esta obsoleta.
  if (!state.mobileCalendarDayDate || toDateKey(state.mobileCalendarDayDate) !== toDateKey(viewingDate)) return;

  const today = new Date();
  const container = document.getElementById('mobile-week-strip-days');
  container.innerHTML = '';
  days.forEach((d) => {
    const cell = document.createElement('div');
    cell.className = 'week-strip-day';
    if (sameDay(d, today)) cell.classList.add('is-today');
    if (sameDay(d, viewingDate)) cell.classList.add('is-viewing');

    const label = document.createElement('div');
    label.className = 'week-strip-day-label';
    label.textContent = WEEKDAY_LABELS[(d.getDay() + 6) % 7];

    const num = document.createElement('div');
    num.className = 'week-strip-day-num';
    num.textContent = d.getDate();

    const dot = document.createElement('div');
    dot.className = 'week-strip-day-dot';
    if (!weekEvents.some((ev) => ev.startAt && sameDay(new Date(ev.startAt), d))) dot.classList.add('is-empty');

    cell.append(label, num, dot);
    cell.addEventListener('click', () => showMobileDay(d, { scrollToNow: true }));
    container.appendChild(cell);
  });
}

// --- "Vista por horas": eventos posicionados por minuto exacto -------
// (--hour-row-height:60px en styles.css hace que 1px = 1 minuto, asi
// que "top" es directamente minutosDesdeMedianoche y "height" la
// duracion en minutos -- sin conversion aparte).
let mobileCurrentTimeLineTimer = null;
function stopMobileCurrentTimeLineTimer() {
  if (mobileCurrentTimeLineTimer) { clearInterval(mobileCurrentTimeLineTimer); mobileCurrentTimeLineTimer = null; }
}

function refreshMobileCurrentTimeLine(date) {
  const grid = document.getElementById('mobile-hours-grid');
  if (!grid) return;
  const existing = grid.querySelector('.mobile-current-time-line');
  if (existing) existing.remove();
  if (!date || !sameDay(date, new Date())) return;
  const now = new Date();
  const line = document.createElement('div');
  line.className = 'mobile-current-time-line';
  line.style.top = `${now.getHours() * 60 + now.getMinutes()}px`;
  const label = document.createElement('div');
  label.className = 'mobile-current-time-label';
  label.textContent = TIME_FORMATTER.format(now);
  line.appendChild(label);
  grid.appendChild(line);
}

function scrollMobileHoursToTime(date) {
  // .mobile-hours-scroll tiene overflow-y:auto, pero en movil ".app"
  // usa min-height (no height) a proposito, para que la pagina crezca
  // con el contenido y se pueda hacer scroll normal con el dedo (ver el
  // comentario junto a ".app" en styles.css) -- eso significa que este
  // contenedor NUNCA llega a desbordar de verdad (su scrollHeight ==
  // clientHeight siempre), asi que fijar su propio scrollTop no mueve
  // nada. El que de verdad se desplaza es la PAGINA entera, asi que hay
  // que calcular la posicion absoluta en la pagina y usar
  // window.scrollTo() en su lugar.
  const grid = document.getElementById('mobile-hours-grid');
  if (!grid) return;
  const now = new Date();
  const targetMinutes = sameDay(date, now) ? (now.getHours() * 60 + now.getMinutes()) : 8 * 60;
  const gridTop = grid.getBoundingClientRect().top + window.scrollY;
  // Deja un par de horas de margen ANTES del objetivo, para que no quede
  // pegado justo al borde superior de la pantalla.
  window.scrollTo(0, Math.max(0, gridTop + targetMinutes - 120));
}

// Reparto de "carriles" simple y voraz para eventos con hora que se
// solapan ese dia -- un solo contador de carriles para TODO el dia (no
// por cada grupo de solapes por separado), mas sencillo de razonar y
// suficiente para el volumen de una agenda personal.
function assignMobileHourLanes(items) {
  const laneEnds = [];
  items.forEach((item) => {
    let lane = laneEnds.findIndex((endMin) => endMin <= item.startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = item.endMin;
    item.lane = lane;
  });
  return Math.max(1, laneEnds.length);
}

async function renderMobileHoursView(date) {
  const dateStr = toDateKey(date);
  const dayEvents = await api(`/api/events?from=${dateStr}T00:00:00&to=${dateStr}T23:59:59`);
  if (!state.mobileCalendarDayDate || toDateKey(state.mobileCalendarDayDate) !== dateStr) return;
  if (getMobileDayViewMode() !== 'hours') return;

  const allDayRow = document.getElementById('mobile-day-allday-row');
  const grid = document.getElementById('mobile-hours-grid');
  allDayRow.innerHTML = '';
  grid.innerHTML = '';

  const allDayEvents = dayEvents.filter((ev) => ev.allDay);
  allDayRow.classList.toggle('hidden', allDayEvents.length === 0);
  allDayEvents.forEach((ev) => {
    const chip = document.createElement('div');
    chip.className = 'mobile-day-allday-chip';
    chip.style.backgroundColor = ev.isTask ? (ev.done ? taskCompletedColor(ev) : taskPendingColor(ev)) : (ev.groupColor || DEFAULT_EVENT_COLOR);
    chip.textContent = ev.title;
    chip.addEventListener('click', () => (ev.isTask ? openTaskModal(ev) : openEventModal(ev)));
    allDayRow.appendChild(chip);
  });

  for (let h = 0; h < 24; h++) {
    const row = document.createElement('div');
    row.className = 'mobile-hour-row';
    row.style.top = `${h * 60}px`;
    const label = document.createElement('div');
    label.className = 'mobile-hour-label';
    label.textContent = `${String(h).padStart(2, '0')}:00`;
    row.appendChild(label);
    grid.appendChild(row);
  }

  const timed = dayEvents
    .filter((ev) => !ev.allDay && ev.startAt)
    .map((ev) => {
      const start = new Date(ev.startAt);
      const startMin = start.getHours() * 60 + start.getMinutes();
      let endMin;
      if (ev.endAt) {
        const end = new Date(ev.endAt);
        endMin = sameDay(end, date) ? (end.getHours() * 60 + end.getMinutes()) : 24 * 60;
      } else {
        endMin = startMin + 30;
      }
      if (endMin <= startMin) endMin = startMin + 15;
      return { ev, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneCount = assignMobileHourLanes(timed);

  timed.forEach(({ ev, startMin, endMin, lane }) => {
    const block = document.createElement('div');
    block.className = `mobile-hour-event ${ev.isTask ? 'is-task' : 'is-event'}`;
    block.style.top = `${startMin}px`;
    block.style.height = `${Math.max(endMin - startMin, 15)}px`;
    if (laneCount > 1) {
      // Cuando hay solapes, cada carril ocupa una fraccion del ancho
      // disponible (a la derecha de la columna de horas) -- se calcula
      // en JS en vez de tocar el left/right fijos de la clase base,
      // que asumen un solo evento por franja.
      block.style.right = 'auto';
      block.style.left = `calc(3rem + (100% - 3rem - 0.3rem) * ${lane} / ${laneCount})`;
      block.style.width = `calc((100% - 3rem - 0.3rem) / ${laneCount} - 3px)`;
    }
    block.textContent = ev.title;
    if (ev.isTask) {
      const color = ev.done ? taskCompletedColor(ev) : taskPendingColor(ev);
      block.style.borderColor = color;
      block.style.color = color;
    } else {
      block.style.backgroundColor = ev.groupColor || DEFAULT_EVENT_COLOR;
    }
    block.addEventListener('click', () => (ev.isTask ? openTaskModal(ev) : openEventModal(ev)));
    grid.appendChild(block);
  });

  refreshMobileCurrentTimeLine(date);
}

// --- "Listado" (dia): scroll bidireccional -- ventana inicial de ±3
// dias, un IntersectionObserver en los centinelas de arriba/abajo la
// amplia sola al acercarse a un extremo (sin libreria, mismo patron
// "centinela" que se explico en el plan). -----------------------------
let mobileDayListadoRange = null; // { from: Date, to: Date }
let mobileDayListadoObserver = null;
let mobileDayListadoBusy = false;
// Si llega una peticion de expandir mientras ya hay otra en curso (pasa
// de verdad: en una pantalla corta con pocos dias con contenido, los DOS
// centinelas pueden estar visibles a la vez nada mas entrar, y el
// IntersectionObserver los notifica juntos en la misma tanda -- sin
// esto, la segunda se perdia en silencio para siempre, ya que el
// observer solo vuelve a avisar en un cambio de visible/no-visible, no
// mientras se queda "visible" sin mas), se apunta aqui para procesarla
// en cuanto la actual termine, en vez de descartarla.
let mobileDayListadoPending = new Set();
const MOBILE_DAY_LISTADO_STEP_DAYS = 4;
const MOBILE_DAY_LISTADO_MAX_SPAN_DAYS = 180; // red de seguridad, evita crecimiento sin limite

function disconnectMobileDayListadoObserver() {
  if (mobileDayListadoObserver) { mobileDayListadoObserver.disconnect(); mobileDayListadoObserver = null; }
  mobileDayListadoPending.clear();
}

function buildMobileListadoRow(ev) {
  const row = document.createElement('div');
  row.className = 'mobile-calendar-month-list-row';
  const bar = document.createElement('div');
  bar.className = 'mobile-calendar-month-list-bar';
  bar.style.backgroundColor = ev.isTask ? (ev.done ? taskCompletedColor(ev) : taskPendingColor(ev)) : (ev.groupColor || DEFAULT_EVENT_COLOR);
  const title = document.createElement('div');
  title.className = 'mobile-calendar-month-list-title';
  title.textContent = ev.title;
  const time = document.createElement('div');
  time.className = 'mobile-calendar-month-list-time';
  time.textContent = formatMobileEventTimeRange(ev);
  row.append(bar, title, time);
  row.addEventListener('click', () => (ev.isTask ? openTaskModal(ev) : openEventModal(ev)));
  return row;
}

async function loadAndRenderMobileDayListado() {
  const range = mobileDayListadoRange;
  if (!range) return;
  const fromStr = toDateKey(range.from);
  const toStr = toDateKey(range.to);
  const events = await api(`/api/events?from=${fromStr}T00:00:00&to=${toStr}T23:59:59`);
  // Obsoleto si mientras se esperaba la respuesta se cambio de sub-vista,
  // se salio de la vista diaria, o el rango volvio a cambiar (peticiones
  // solapadas de dos expansiones seguidas).
  if (getMobileDayViewMode() !== 'listado') return;
  if (document.getElementById('mobile-calendar-day-view').classList.contains('hidden')) return;
  if (mobileDayListadoRange !== range) return;

  const byDay = new Map();
  events.forEach((ev) => {
    if (!ev.startAt) return; // sin fecha no aparece aqui, igual que en el resto del calendario
    const key = toDateKey(new Date(ev.startAt));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(ev);
  });

  const content = document.getElementById('mobile-day-listado-content');
  content.innerHTML = '';
  let cursor = new Date(range.from);
  let anyRendered = false;
  while (cursor <= range.to) {
    const key = toDateKey(cursor);
    const dayEvents = (byDay.get(key) || []).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    // Un dia sin nada no pinta ningun bloque -- Koku no quiere ver
    // "Nada este dia." repetido en cada fecha del rango. Los centinelas
    // de scroll infinito no dependen de esto, siguen ahi igual.
    if (dayEvents.length > 0) {
      const block = document.createElement('div');
      block.className = 'mobile-day-listado-block';
      const heading = document.createElement('div');
      heading.className = 'mobile-day-listado-block-heading';
      heading.textContent = formatMobileListadoBlockHeading(cursor);
      block.appendChild(heading);
      dayEvents.forEach((ev) => block.appendChild(buildMobileListadoRow(ev)));
      content.appendChild(block);
      anyRendered = true;
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  if (!anyRendered) {
    // Si TODO el rango cargado esta vacio, un unico aviso (no uno por
    // dia) para que la vista no se quede en blanco sin explicacion.
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'No hay nada en estos días.';
    content.appendChild(empty);
  }
}

async function expandMobileDayListado(direction) {
  if (!mobileDayListadoRange) return;
  if (mobileDayListadoBusy) { mobileDayListadoPending.add(direction); return; }
  mobileDayListadoBusy = true;
  try {
    // Bucle en vez de una sola pasada: al terminar, si mientras tanto se
    // pidio expandir en otro sentido (ver mobileDayListadoPending
    // arriba), se procesa tambien antes de soltar el candado -- así
    // nunca se pierde un aviso del observer por haber llegado a la vez
    // que otro ya en curso.
    while (true) {
      const totalSpanDays = Math.round((mobileDayListadoRange.to - mobileDayListadoRange.from) / 86400000);
      if (totalSpanDays >= MOBILE_DAY_LISTADO_MAX_SPAN_DAYS) { mobileDayListadoPending.clear(); break; }
      // El scroll real ocurre en la PAGINA, no dentro de
      // #mobile-day-listado-view (ver comentario de
      // scrollMobileHoursToTime() sobre por que ".app" nunca llega a
      // acotar la altura de sus hijos en movil) -- se mide con
      // document.documentElement/window en vez del propio contenedor.
      const prevDocHeight = document.documentElement.scrollHeight;
      const prevScrollY = window.scrollY;
      if (direction === 'back') {
        mobileDayListadoRange.from = new Date(mobileDayListadoRange.from.getFullYear(), mobileDayListadoRange.from.getMonth(), mobileDayListadoRange.from.getDate() - MOBILE_DAY_LISTADO_STEP_DAYS);
      } else {
        mobileDayListadoRange.to = new Date(mobileDayListadoRange.to.getFullYear(), mobileDayListadoRange.to.getMonth(), mobileDayListadoRange.to.getDate() + MOBILE_DAY_LISTADO_STEP_DAYS);
      }
      await loadAndRenderMobileDayListado();
      if (direction === 'back') {
        // Compensa el scroll para que anteponer dias arriba no de un
        // salto visual (el contenido nuevo empuja hacia abajo lo que ya
        // se veia).
        window.scrollTo(0, prevScrollY + (document.documentElement.scrollHeight - prevDocHeight));
      }
      if (mobileDayListadoPending.size === 0) break;
      direction = mobileDayListadoPending.values().next().value;
      mobileDayListadoPending.delete(direction);
    }
  } finally {
    mobileDayListadoBusy = false;
  }
}

function setupMobileDayListadoObserver() {
  disconnectMobileDayListadoObserver();
  const topSentinel = document.getElementById('mobile-day-listado-top-sentinel');
  const bottomSentinel = document.getElementById('mobile-day-listado-bottom-sentinel');
  // root:null (en vez del div) -- observa contra el VIEWPORT real del
  // navegador, que es lo que de verdad se desplaza en movil (ver el
  // mismo comentario de scrollMobileHoursToTime()).
  mobileDayListadoObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      if (entry.target === topSentinel) expandMobileDayListado('back');
      else if (entry.target === bottomSentinel) expandMobileDayListado('forward');
    });
  }, { root: null, threshold: 0 });
  mobileDayListadoObserver.observe(topSentinel);
  mobileDayListadoObserver.observe(bottomSentinel);
}

async function renderMobileDayListado(centerDate) {
  mobileDayListadoRange = {
    from: new Date(centerDate.getFullYear(), centerDate.getMonth(), centerDate.getDate() - 3),
    to: new Date(centerDate.getFullYear(), centerDate.getMonth(), centerDate.getDate() + 3),
  };
  // El scroll real es el de la PAGINA (ver scrollMobileHoursToTime()),
  // asi que "empezar arriba del todo" es scrollear la ventana, no el div.
  window.scrollTo(0, 0);
  await loadAndRenderMobileDayListado();
  // El primer observe() de IntersectionObserver avisa de inmediato con
  // el estado actual -- si la ventana inicial (±3 dias) no llega a
  // desbordar la pantalla real, esa primera notificacion ya se encarga
  // de ampliarla sola (ver expandMobileDayListado), sin necesitar aqui
  // ningun bucle de relleno a mano.
  setupMobileDayListadoObserver();
}

async function renderMobileDayActiveSubView({ scrollToNow = false } = {}) {
  const mode = getMobileDayViewMode();
  document.getElementById('mobile-day-hours-view').classList.toggle('hidden', mode !== 'hours');
  document.getElementById('mobile-day-listado-view').classList.toggle('hidden', mode !== 'listado');
  stopMobileCurrentTimeLineTimer();
  if (mode === 'hours') {
    disconnectMobileDayListadoObserver();
    await renderMobileHoursView(state.mobileCalendarDayDate);
    if (scrollToNow) scrollMobileHoursToTime(state.mobileCalendarDayDate);
    mobileCurrentTimeLineTimer = setInterval(() => refreshMobileCurrentTimeLine(state.mobileCalendarDayDate), 60 * 1000);
  } else {
    await renderMobileDayListado(state.mobileCalendarDayDate);
  }
}

// Desplegable en vez de icono ciclico -- Koku pidio poder clicar
// directamente la sub-vista que quiere, en vez de darle al icono hasta
// que salga la que buscaba (confuso sin eventos de por medio para saber
// en cual estabas).
const mobileDayViewModeField = createSelectField({
  options: [{ value: 'hours', label: 'Horas' }, { value: 'listado', label: 'Listado' }],
  initialValue: getMobileDayViewMode(),
  onChange: (v) => {
    localStorage.setItem('mobileDayViewMode', v);
    renderMobileDayActiveSubView({ scrollToNow: true });
  },
});
document.getElementById('mobile-day-view-mode-field').appendChild(mobileDayViewModeField.element);
// El buscador global de verdad llega en la Fase 5, ver el mismo aviso
// junto al buscador del mes.
document.getElementById('btn-mobile-calendar-day-search').addEventListener('click', () => {
  showAppAlert('El buscador llega en la próxima ronda.');
});

async function showMobileDay(date, { scrollToNow = false } = {}) {
  state.mobileCalendarDayDate = date;
  document.getElementById('mobile-calendar-day-heading').textContent = formatMobileDayHeading(date);
  const monthLabel = capitalizeFirst(MONTH_ONLY_FORMATTER.format(date));
  document.getElementById('btn-mobile-day-back-label').innerHTML =
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg><span>${monthLabel}</span>`;
  await Promise.all([renderMobileWeekStrip(date), renderMobileDayActiveSubView({ scrollToNow })]);
}

function enterMobileDayView(date) {
  document.getElementById('mobile-calendar-month-toolbar').classList.add('hidden');
  document.querySelector('.mobile-calendar-view').classList.add('hidden');
  document.getElementById('btn-mobile-calendar-today').classList.add('hidden');
  document.getElementById('mobile-calendar-day-view').classList.remove('hidden');
  showMobileDay(date, { scrollToNow: true });
}

function exitMobileDayView() {
  stopMobileCurrentTimeLineTimer();
  disconnectMobileDayListadoObserver();
  document.getElementById('mobile-calendar-day-view').classList.add('hidden');
  document.getElementById('mobile-calendar-month-toolbar').classList.remove('hidden');
  document.querySelector('.mobile-calendar-view').classList.remove('hidden');
  document.getElementById('btn-mobile-calendar-today').classList.remove('hidden');
}

document.getElementById('btn-mobile-day-back-label').addEventListener('click', exitMobileDayView);
document.getElementById('btn-mobile-calendar-today').addEventListener('click', () => enterMobileDayView(new Date()));

// Swipe horizontal en la tira semanal (unico area sin scroll vertical
// propio dentro de la vista diaria -- ya lleva touch-action:pan-x en
// styles.css, pensado justo para esto): izquierda = dia siguiente,
// derecha = dia anterior. Si el nuevo dia cae en otra semana, la tira
// se recalcula sola (showMobileDay -> renderMobileWeekStrip).
attachSwipe(document.getElementById('mobile-week-strip-days'), {
  onLeft: () => {
    const d = state.mobileCalendarDayDate;
    showMobileDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), { scrollToNow: true });
  },
  onRight: () => {
    const d = state.mobileCalendarDayDate;
    showMobileDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1), { scrollToNow: true });
  },
});

// Primer pintado: los contenedores existen desde que carga la pagina,
// pero hasta que loadMonth()/setCalendarViewMode() corren por primera
// vez (dentro de init()) conviene que la barra ya tenga el texto/estado
// correcto -- refreshMobileCalendarNavLabel()/refreshMobileCalendarModeVisibility()
// no dependen de datos de red, se pueden llamar ya.
refreshMobileCalendarNavLabel();
refreshMobileCalendarModeVisibility();

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

// Analiza los digitos escritos hasta ahora: con 3-4 digitos, los 2
// ultimos son los minutos y el resto la hora (igual que un campo de
// vencimiento de tarjeta) -- "2056" -> "20:56", "630" -> "6:30". Con
// menos de 3 digitos todavia no hay suficiente informacion para saber
// si es valido (se sigue escribiendo la hora), asi que no se marca
// error todavia.
function parseTimeFieldDigits(digits) {
  if (digits.length === 0) return { formatted: '', complete: false, valid: false, value: null };
  const formatted = digits.length > 2 ? `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}` : digits;
  if (digits.length < 3) return { formatted, complete: false, valid: false, value: null };
  const h = Number(digits.slice(0, digits.length - 2));
  const mi = Number(digits.slice(-2));
  const ok = h <= 23 && mi <= 59;
  return {
    formatted,
    complete: true,
    valid: ok,
    value: ok ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null,
  };
}

function createTimeField({ initialValue = '09:00' } = {}) {
  let value = initialValue; // ultimo valor VALIDO conocido
  let valid = true;

  const root = document.createElement('div');
  root.className = 'time-field';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'time-field-input';
  input.placeholder = 'HH:MM';
  input.inputMode = 'numeric';
  input.value = value;

  // Autocompleta el ":" MIENTRAS SE ESCRIBE (no solo al perder el foco)
  // y valida en tiempo real -- antes solo se normalizaba en "change"
  // (al perder el foco), asi que si se guardaba con Ctrl+Intro con el
  // foco todavia en este campo, form.requestSubmit() no dispara "change"
  // por si solo y lo escrito se perdia en silencio, mandandose el valor
  // VIEJO sin ningun aviso.
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    const result = parseTimeFieldDigits(digits);
    input.value = result.formatted;
    input.setSelectionRange(input.value.length, input.value.length);
    if (result.complete && result.valid) {
      value = result.value;
      valid = true;
    } else {
      // Incompleto (1-2 digitos, todavia escribiendo la hora) o fuera
      // de rango -- en los dos casos getValue() no debe devolver nada
      // hasta que se complete/corrija, para no guardar algo a medias.
      valid = false;
    }
    // Solo se pinta en rojo cuando ya hay info de sobra para saber que
    // esta MAL (3-4 digitos fuera de rango) -- con 0-2 digitos se sigue
    // escribiendo, no es un error todavia.
    input.classList.toggle('is-invalid', result.complete && !result.valid);
  });

  input.addEventListener('blur', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    const result = parseTimeFieldDigits(digits);
    if (!result.complete || !result.valid) {
      // Al perder el foco con algo a medias o invalido, se marca en
      // rojo de verdad (mientras se escribe 1-2 digitos no se marca,
      // pero si te vas de ahi sin terminar, ya cuenta como error).
      valid = false;
      input.classList.add('is-invalid');
    }
  });

  root.appendChild(input);

  return {
    element: root,
    // Devuelve el ultimo valor VALIDO conocido, o null si el campo esta
    // ahora mismo en un estado invalido/incompleto -- nunca un valor
    // inventado o desactualizado.
    getValue: () => (valid ? value : null),
    isValid: () => valid,
    setValue: (v) => {
      value = v;
      valid = true;
      input.value = v;
      input.classList.remove('is-invalid');
    },
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

// Redondea a la media hora mas cercana -- 6:40 -> 6:30 (mas cerca de
// :30 que de :00 de la hora siguiente), 6:50 -> 7:00, 6:00 se queda en
// 6:00. Se usa para sugerir la hora de inicio de un evento nuevo en vez
// de dejar "las 6:37" tal cual.
function roundToNearestHalfHour(date) {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  const remainder = minutes % 30;
  if (remainder !== 0) {
    rounded.setMinutes(remainder < 15 ? minutes - remainder : minutes + (30 - remainder));
  }
  return rounded;
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
  } else {
    defaultStart = roundToNearestHalfHour(defaultStart);
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
    // 1 hora despues del inicio por defecto -- antes se ponia la MISMA
    // hora que el inicio ("empieza y acaba en el mismo momento"), pedido
    // explicito de Koku de cambiarlo.
    const defaultEnd = new Date(startDate);
    defaultEnd.setHours(defaultEnd.getHours() + 1);
    eventEndTimeField.setValue(toTimeInputValue(defaultEnd));
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
  const isAllDay = document.getElementById('event-all-day').checked;
  // Si la hora no es valida (o esta a medio escribir), no se guarda una
  // hora inventada en silencio -- se avisa y el formulario se queda
  // abierto. No aplica a "Todo el dia", donde la hora ni se usa.
  if (!isAllDay && (!eventStartTimeField.isValid() || !eventEndTimeField.isValid())) {
    await showAppAlert('La hora no es válida. Usa el formato HH:MM.');
    return;
  }
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

// presetDate (opcional): al crear una tarea nueva desde un dia concreto
// (p. ej. el boton "+" de la vista diaria movil), arranca ya con esa
// fecha puesta -- mismo parametro que ya admite openEventModal().
function openTaskModal(task, presetDate) {
  const modal = document.getElementById('task-modal');
  document.getElementById('task-modal-title').textContent = task ? 'Editar tarea' : 'Nueva tarea';
  document.getElementById('task-id').value = task ? task.id : '';
  document.getElementById('task-title').value = task ? task.title : '';
  taskDateField.setValue(task && task.startAt ? new Date(task.startAt) : (presetDate ? new Date(presetDate) : null));
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
// borrosa en la lista; el icono de ojo de cada fila la oculta/destapa al
// momento. Hubo una version con contraseña compartida opcional para
// destapar, pero se quito a proposito (era la unica pieza de "seguridad"
// de la app y Koku prefirio quedarse solo con el toggle simple, en
// ordenador y movil por igual).
// ---------------------------------------------------------------------
async function setNoteHidden(note, hidden) {
  await api(`/api/notes/${note.id}`, { method: 'PUT', body: JSON.stringify({ hidden }) });
  await loadNotes();
  renderNotesView();
}

async function toggleNoteHidden(note) {
  await setNoteHidden(note, !note.hidden);
}

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

// "mode" (Fase 4, solo tiene efecto viniendo de la vista movil -- ver
// renderNotesViewInto): 'browse' (normal, como siempre funcionaba
// desktop), 'select' (checkbox delante, la fila entera marca/desmarca
// en vez de abrir/navegar) o 'editFolders' (solo afecta a
// buildFolderRow: tap en la fila edita la carpeta en vez de entrar).
function buildNoteRow(note, { showPath = false, mode = 'browse' } = {}) {
  const row = document.createElement('div');
  row.className = 'note-item' + (note.hidden ? ' is-hidden' : '');

  const itemKey = mobileNotesItemKey('note', note.id);
  if (mode === 'select') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'styled-checkbox';
    checkbox.checked = mobileNotesSelectedKeys.has(itemKey);
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => toggleMobileNotesSelection(itemKey));
    row.appendChild(checkbox);
  }

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

  row.addEventListener('click', () => {
    if (mode === 'select') { toggleMobileNotesSelection(itemKey); return; }
    // Una nota oculta no se abre con un simple clic en la fila — solo el
    // icono de ojo la destapa (sin ningun texto/boton de aviso encima del
    // blur, para no recargar la fila).
    if (note.hidden) return;
    openNoteInEditor(note);
  });
  return row;
}

// Carpeta con icono de ojo (Fase 3, navegacion tipo explorador de
// archivos): la fila entera abre esa carpeta al clicarla; el lapiz
// (aparte, con su propio stopPropagation) la edita sin entrar. Ver
// comentario de "mode" en buildNoteRow arriba -- se comparte el mismo
// concepto para las dos.
function buildFolderRow(folder, { showPath = false, mode = 'browse' } = {}) {
  const row = document.createElement('div');
  row.className = 'note-item note-folder-row';

  const itemKey = mobileNotesItemKey('folder', folder.id);
  if (mode === 'select') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'styled-checkbox';
    checkbox.checked = mobileNotesSelectedKeys.has(itemKey);
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => toggleMobileNotesSelection(itemKey));
    row.appendChild(checkbox);
  }

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
    if (mode === 'select') { toggleMobileNotesSelection(itemKey); return; }
    if (mode === 'editFolders') { openNoteFolderModal(folder); return; }
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

// "compareFn" opcional (Fase 4, ordenar notas en la vista movil, ver
// #btn-mobile-notes-menu): favoritos SIEMPRE van primero y se ordenan
// por nombre entre si (sin cambios) -- el criterio elegido solo
// reordena "el resto" (decision confirmada con Koku), por eso solo se
// aplica a "rest", nunca a "favorites".
function appendFavoriteSortedGroup(container, items, buildRowFn, { compareFn } = {}) {
  if (items.length === 0) return;
  const byName = (a, b) => getNoteListItemName(a).localeCompare(getNoteListItemName(b));
  const favorites = items.filter((i) => i.favorite).sort(byName);
  const rest = items.filter((i) => !i.favorite).sort(compareFn || byName);

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
// Fase 4 del rediseño movil: la vista de Notas ya no es solo de
// escritorio -- el mismo "donde estas" (carpeta actual/busqueda/
// favoritos) se pinta ahora en DOS contenedores posibles
// (#notes-list en escritorio, #mobile-notes-list en la vista movil
// nueva), cada uno con su propio boton "Volver". Como solo uno de los
// dos es visible a la vez (corte 100% CSS por ancho de pantalla, nunca
// los dos en el mismo dispositivo), lo mas simple es matener SIEMPRE
// los dos en sincronia con el mismo estado global
// (state.currentNoteFolderId/noteSearchQuery/...) en vez de duplicar
// ese estado por plataforma -- por eso renderNotesView() SIN argumento
// pinta los dos contenedores que existan (uno de los dos no existira
// del todo o no estara en el DOM segun la version de index.html que se
// esté usando, de ahi el "if (!container) return" dentro de cada uno).
const NOTES_VIEW_TARGETS = {
  desktop: { containerId: 'notes-list', backBtnId: 'btn-note-folder-back' },
  mobile: { containerId: 'mobile-notes-list', backBtnId: 'btn-mobile-notes-back' },
};

function renderNotesView(target) {
  const targets = target ? [target] : Object.keys(NOTES_VIEW_TARGETS);
  targets.forEach(renderNotesViewInto);
}

function renderNotesViewInto(target) {
  const cfg = NOTES_VIEW_TARGETS[target];
  const container = cfg && document.getElementById(cfg.containerId);
  if (!container) return;
  container.innerHTML = '';

  const query = (state.noteSearchQuery || '').trim().toLowerCase();
  const searchWholeApp = !!query && !state.noteSearchCurrentFolderOnly;

  const backBtn = document.getElementById(cfg.backBtnId);
  if (backBtn) backBtn.classList.toggle('hidden', state.currentNoteFolderId === null || searchWholeApp);

  // "mode"/orden/galeria son ajustes GLOBALES por dispositivo -- solo se
  // activan pintando la vista movil, nunca la de escritorio (que sigue
  // funcionando exactamente igual que siempre, sin estos 3 conceptos).
  const mode = target === 'mobile' ? mobileNotesMode : 'browse';
  const sortOpts = target === 'mobile' ? { compareFn: compareMobileNotesItems } : {};
  const useGallery = target === 'mobile' && getMobileNotesViewMode() === 'gallery';
  const buildNote = useGallery
    ? (n, opts) => buildNoteGalleryCard(n, opts)
    : (n, opts) => buildNoteRow(n, opts);

  function appendNoteGroup(items, showPath) {
    if (!useGallery) {
      appendFavoriteSortedGroup(container, items, (n) => buildNote(n, { showPath, mode }), sortOpts);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'mobile-notes-gallery-grid';
    appendFavoriteSortedGroup(grid, items, (n) => buildNote(n, { showPath, mode }), sortOpts);
    if (grid.children.length > 0) container.appendChild(grid);
  }

  // En modo Mover solo tiene sentido navegar entre CARPETAS (elegir el
  // destino) -- las notas no pueden contener nada, se ocultan del todo
  // para no confundir con "¿tambien puedo moverlo aqui dentro?".
  if (searchWholeApp) {
    const matchFolders = state.noteFolders.filter((f) => f.name.toLowerCase().includes(query));
    const matchNotes = mode === 'move' ? [] : (state.notes || []).filter((n) => n.title.toLowerCase().includes(query));
    if (matchFolders.length === 0 && matchNotes.length === 0) {
      container.innerHTML = '<p class="empty-hint">Nada coincide con esa busqueda.</p>';
      return;
    }
    appendFavoriteSortedGroup(container, matchFolders, (f) => buildFolderRow(f, { showPath: true, mode }));
    appendNoteGroup(matchNotes, true);
    return;
  }

  let subfolders = state.noteFolders.filter((f) => f.parentId === state.currentNoteFolderId);
  let notesHere = mode === 'move' ? [] : (state.notes || []).filter((n) => n.folderId === state.currentNoteFolderId);

  if (query) {
    subfolders = subfolders.filter((f) => f.name.toLowerCase().includes(query));
    notesHere = notesHere.filter((n) => n.title.toLowerCase().includes(query));
  }

  if (subfolders.length === 0 && notesHere.length === 0) {
    container.innerHTML = `<p class="empty-hint">${query ? 'Nada coincide con esa busqueda.' : (mode === 'move' ? 'No hay subcarpetas aqui.' : 'No hay nada aqui todavia.')}</p>`;
    return;
  }

  appendFavoriteSortedGroup(container, subfolders, (f) => buildFolderRow(f, { mode }));
  appendNoteGroup(notesHere, false);
}

// Criterio de orden de las notas normales en la vista movil (favoritos
// siguen yendo primero siempre, ver appendFavoriteSortedGroup) --
// ajustes GLOBALES por dispositivo (localStorage, nunca por carpeta,
// confirmado con Koku). Fecha de creacion/edicion comparan el string
// ISO tal cual (orden lexicografico = orden cronologico para este
// formato de fecha, mismo truco que ya usa el resto de la app).
function getMobileNotesSortBy() {
  const v = localStorage.getItem('notesMobileSortBy');
  return v === 'createdAt' || v === 'title' ? v : 'updatedAt';
}
function getMobileNotesSortDir() {
  return localStorage.getItem('notesMobileSortDir') === 'asc' ? 'asc' : 'desc';
}
function compareMobileNotesItems(a, b) {
  const sortBy = getMobileNotesSortBy();
  const dir = getMobileNotesSortDir() === 'asc' ? 1 : -1;
  if (sortBy === 'title') return getNoteListItemName(a).localeCompare(getNoteListItemName(b)) * dir;
  const av = a[sortBy] || '';
  const bv = b[sortBy] || '';
  if (av === bv) return 0;
  return (av < bv ? -1 : 1) * dir;
}

// Vista galeria/listado de la vista movil -- ajuste GLOBAL por
// dispositivo (nunca por carpeta, ver decision 4 confirmada con Koku).
function getMobileNotesViewMode() {
  return localStorage.getItem('notesMobileViewMode') === 'gallery' ? 'gallery' : 'list';
}

// Extrae la primera <img src="..."> del cuerpo HTML de una nota, si
// tiene alguna -- solo tiene sentido si bodyFormat es 'html' (las notas
// de antes de la Fase 4/editor con formato son texto plano, nunca
// pueden tener una imagen incrustada).
function extractNoteThumbnailSrc(note) {
  if (note.bodyFormat !== 'html' || !note.body) return null;
  const m = note.body.match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : null;
}

// Vista previa de texto (sin imagen) para la tarjeta de galeria -- quita
// las etiquetas de verdad usando el propio DOM (mas fiable que un
// regex para decodificar entidades correctamente), recortado a un
// tamano razonable para una tarjeta pequeña.
function extractNoteTextPreview(note) {
  if (!note.body) return '';
  const div = document.createElement('div');
  div.innerHTML = note.bodyFormat === 'html' ? note.body : legacyNoteBodyToHtml(note.body);
  return (div.textContent || '').trim().slice(0, 140);
}

function buildNoteGalleryCard(note, { mode = 'browse' } = {}) {
  const card = document.createElement('div');
  card.className = 'mobile-note-gallery-card' + (note.hidden ? ' is-hidden' : '');
  const itemKey = mobileNotesItemKey('note', note.id);

  if (mode === 'select') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'styled-checkbox mobile-note-gallery-checkbox';
    checkbox.checked = mobileNotesSelectedKeys.has(itemKey);
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => toggleMobileNotesSelection(itemKey));
    card.appendChild(checkbox);
  }

  const eyeBtn = document.createElement('button');
  eyeBtn.type = 'button';
  eyeBtn.className = 'mobile-note-gallery-eye-btn';
  eyeBtn.innerHTML = note.hidden ? EYE_OFF_SVG : EYE_SVG;
  eyeBtn.setAttribute('aria-label', note.hidden ? 'Destapar nota' : 'Ocultar nota');
  eyeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleNoteHidden(note);
  });
  card.appendChild(eyeBtn);

  const thumbSrc = extractNoteThumbnailSrc(note);
  const media = document.createElement('div');
  media.className = 'mobile-note-gallery-media';
  if (thumbSrc) {
    const img = document.createElement('img');
    img.src = thumbSrc;
    img.alt = '';
    media.appendChild(img);
  } else {
    media.style.background = note.folderColor || 'var(--surface-2)';
    const preview = document.createElement('span');
    preview.className = 'mobile-note-gallery-preview-text';
    preview.textContent = extractNoteTextPreview(note);
    media.appendChild(preview);
  }
  card.appendChild(media);

  const title = document.createElement('span');
  title.className = 'mobile-note-gallery-title';
  title.textContent = note.title || 'Nota sin título';
  card.appendChild(title);

  card.appendChild(buildFavoriteStarBtn(note.favorite, (e) => {
    e.stopPropagation();
    toggleNoteFavorite(note);
  }));

  card.addEventListener('click', () => {
    if (mode === 'select') { toggleMobileNotesSelection(itemKey); return; }
    if (note.hidden) return;
    openNoteInEditor(note);
  });
  return card;
}

// Estado compartido (state.noteSearchQuery/...) entre las dos vistas
// posibles -- limpiar el texto tiene que hacerlo en CUALQUIER input de
// busqueda que exista en el DOM, no solo el de escritorio.
function clearNoteSearch() {
  state.noteSearchQuery = '';
  ['note-search-input', 'mobile-notes-search-input'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
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

// Equivalentes de la vista movil (#mobile-notes-view, Fase 4) -- misma
// logica exacta que los de escritorio de arriba, apuntando a los ids
// propios de esa vista. La busqueda movil siempre mira toda la app (sin
// el boton de "solo esta carpeta" -- no hay sitio en la barra estrecha
// para ese matiz, y buscar en toda la app es el comportamiento por
// defecto de todas formas).
const mobileNoteSearchInput = document.getElementById('mobile-notes-search-input');
if (mobileNoteSearchInput) {
  mobileNoteSearchInput.addEventListener('input', (e) => {
    state.noteSearchQuery = e.target.value;
    renderNotesView();
  });
}
const btnMobileNotesBack = document.getElementById('btn-mobile-notes-back');
if (btnMobileNotesBack) {
  btnMobileNotesBack.addEventListener('click', () => {
    const current = state.noteFolders.find((f) => f.id === state.currentNoteFolderId);
    state.currentNoteFolderId = current ? current.parentId : null;
    clearNoteSearch();
    renderNotesView();
  });
}

// ---------------------------------------------------------------------
// Notas movil -- menu de 3 puntos y sus 4 modos (Fase 4 del rediseño
// movil): Editar carpetas / Seleccionar (con Eliminar/Mover) / Vista
// (galeria-listado) / Ordenar. "mode" es el mismo concepto ya usado en
// buildNoteRow/buildFolderRow/buildNoteGalleryCard mas arriba.
// ---------------------------------------------------------------------
let mobileNotesMode = 'browse'; // 'browse' | 'editFolders' | 'select' | 'move'
const mobileNotesSelectedKeys = new Set(); // 'folder:<id>' / 'note:<id>'

function mobileNotesItemKey(kind, id) {
  return `${kind}:${id}`;
}

function toggleMobileNotesSelection(itemKey) {
  if (mobileNotesSelectedKeys.has(itemKey)) mobileNotesSelectedKeys.delete(itemKey);
  else mobileNotesSelectedKeys.add(itemKey);
  refreshMobileNotesActionBar();
  renderNotesView('mobile');
}

function setMobileNotesMode(mode) {
  mobileNotesMode = mode;
  if (mode !== 'select' && mode !== 'move') mobileNotesSelectedKeys.clear();
  refreshMobileNotesActionBar();
  renderNotesView('mobile');
}

// Barra inferior fija: sin selección propia (Eliminar/Mover deshabilitados
// con nada marcado), o con el par Cancelar/"Mover aquí" durante el modo
// Mover -- un unico par de botones reutilizado para los dos casos en vez
// de 2 barras distintas.
function refreshMobileNotesActionBar() {
  const bar = document.getElementById('mobile-notes-action-bar');
  if (!bar) return;
  const leftBtn = document.getElementById('btn-mobile-notes-action-left');
  const rightBtn = document.getElementById('btn-mobile-notes-action-right');

  if (mobileNotesMode === 'select') {
    bar.classList.remove('hidden');
    leftBtn.textContent = 'Eliminar';
    leftBtn.className = 'danger-btn';
    leftBtn.disabled = mobileNotesSelectedKeys.size === 0;
    leftBtn.onclick = openMobileNotesDeleteModal;
    rightBtn.textContent = 'Mover';
    rightBtn.className = 'secondary-btn';
    rightBtn.disabled = mobileNotesSelectedKeys.size === 0;
    rightBtn.onclick = () => setMobileNotesMode('move');
  } else if (mobileNotesMode === 'move') {
    bar.classList.remove('hidden');
    leftBtn.textContent = 'Cancelar';
    leftBtn.className = 'secondary-btn';
    leftBtn.disabled = false;
    leftBtn.onclick = () => setMobileNotesMode('select');
    rightBtn.textContent = 'Mover aquí';
    rightBtn.className = 'primary-btn';
    rightBtn.disabled = false;
    rightBtn.onclick = confirmMobileNotesMove;
  } else {
    bar.classList.add('hidden');
  }
}

function resolveMobileNotesItem(key) {
  const [kind, idStr] = key.split(':');
  const id = Number(idStr);
  if (kind === 'note') return { kind, id, item: (state.notes || []).find((n) => n.id === id) };
  return { kind, id, item: state.noteFolders.find((f) => f.id === id) };
}

// El aviso de "esto tiene contenido dentro" solo hace falta si la
// seleccion final (ya descontando lo excluido en el modal) incluye una
// CARPETA con notas o subcarpetas -- se calcula con lo que ya hay en
// memoria (state.noteFolders/state.notes), sin pedir nada al servidor.
function mobileNotesDeletionIncludesFolderWithContent(keys) {
  return keys.some((key) => {
    const { kind, id } = resolveMobileNotesItem(key);
    if (kind !== 'folder') return false;
    return state.noteFolders.some((f) => f.parentId === id) || (state.notes || []).some((n) => n.folderId === id);
  });
}

let mobileNotesDeleteExcluded = new Set();

function renderMobileNotesDeleteList() {
  const list = document.getElementById('mobile-notes-delete-list');
  list.innerHTML = '';
  mobileNotesSelectedKeys.forEach((key) => {
    const { kind, item } = resolveMobileNotesItem(key);
    if (!item) return;
    const row = document.createElement('div');
    row.className = 'mobile-notes-delete-item' + (mobileNotesDeleteExcluded.has(key) ? ' is-excluded' : '');
    if (kind === 'folder') {
      const icon = document.createElement('span');
      icon.className = 'mobile-notes-delete-item-icon';
      icon.innerHTML = FOLDER_SVG;
      row.appendChild(icon);
    }
    const label = document.createElement('span');
    label.textContent = kind === 'folder' ? item.name : (item.title || 'Nota sin título');
    row.appendChild(label);
    row.addEventListener('click', () => {
      if (mobileNotesDeleteExcluded.has(key)) mobileNotesDeleteExcluded.delete(key);
      else mobileNotesDeleteExcluded.add(key);
      renderMobileNotesDeleteList();
    });
    list.appendChild(row);
  });
}

function openMobileNotesDeleteModal() {
  mobileNotesDeleteExcluded = new Set();
  renderMobileNotesDeleteList();
  document.getElementById('mobile-notes-delete-modal').classList.remove('hidden');
}
function closeMobileNotesDeleteModal() {
  document.getElementById('mobile-notes-delete-modal').classList.add('hidden');
}
document.getElementById('btn-close-mobile-notes-delete').addEventListener('click', closeMobileNotesDeleteModal);
document.getElementById('btn-mobile-notes-delete-cancel').addEventListener('click', closeMobileNotesDeleteModal);

document.getElementById('btn-mobile-notes-delete-confirm').addEventListener('click', async () => {
  const finalKeys = [...mobileNotesSelectedKeys].filter((k) => !mobileNotesDeleteExcluded.has(k));
  if (finalKeys.length === 0) { closeMobileNotesDeleteModal(); return; }

  if (
    mobileNotesDeletionIncludesFolderWithContent(finalKeys)
    && localStorage.getItem('notesMobileHideFolderDeleteWarning') !== '1'
  ) {
    const proceed = await showAppConfirm(
      'Las notas y subcarpetas que contenga cualquier carpeta seleccionada subirán de nivel, no se borrarán.',
      { checkbox: { label: 'No volver a mostrar este aviso', storageKey: 'notesMobileHideFolderDeleteWarning' } }
    );
    if (!proceed) return;
  }

  closeMobileNotesDeleteModal();
  for (const key of finalKeys) {
    const { kind, id } = resolveMobileNotesItem(key);
    if (kind === 'note') await api(`/api/notes/${id}`, { method: 'DELETE' });
    else await api(`/api/note-folders/${id}`, { method: 'DELETE' });
  }
  await Promise.all([loadNotes(), loadNoteFolders()]);
  setMobileNotesMode('browse');
});

// Modo Mover: usa la navegacion de carpetas de siempre (el usuario entra
// en la carpeta destino como si estuviera navegando normal, ver el
// filtrado de "mode === 'move'" en renderNotesViewInto) -- "Mover aqui"
// aplica state.currentNoteFolderId como destino de todo lo seleccionado.
async function confirmMobileNotesMove() {
  const destinationFolderId = state.currentNoteFolderId;
  const keys = [...mobileNotesSelectedKeys];
  try {
    for (const key of keys) {
      const { kind, id } = resolveMobileNotesItem(key);
      if (kind === 'note') {
        await api(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify({ folderId: destinationFolderId }) });
      } else {
        await api(`/api/note-folders/${id}`, { method: 'PUT', body: JSON.stringify({ parentId: destinationFolderId }) });
      }
    }
  } catch (err) {
    await showAppAlert(err.message || 'No se pudo mover.');
    return;
  }
  await Promise.all([loadNotes(), loadNoteFolders()]);
  setMobileNotesMode('browse');
}

// ---------------------------------------------------------------------
// Menu de 3 puntos (Fase 4): popover con Editar carpetas/Seleccionar/
// Vista/Ordenar, mismo patron positionFixedPopover/closeAllPopovers de
// settings.js que ya usan el resto de popovers de la app -- el div ya
// lleva la clase .select-popover en index.html, asi que ya esta
// incluido en esas dos funciones sin tocarlas.
// ---------------------------------------------------------------------
function buildMobileNotesMenuPopover() {
  const popover = document.getElementById('mobile-notes-menu-popover');
  popover.innerHTML = '';

  function addOption(label, onClick, active) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'select-option' + (active ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    popover.appendChild(btn);
  }

  const editingFolders = mobileNotesMode === 'editFolders';
  addOption(editingFolders ? 'Listo' : 'Editar carpetas', () => {
    closeAllPopovers();
    setMobileNotesMode(editingFolders ? 'browse' : 'editFolders');
  }, editingFolders);

  const selecting = mobileNotesMode === 'select' || mobileNotesMode === 'move';
  addOption(selecting ? 'Listo' : 'Seleccionar', () => {
    closeAllPopovers();
    setMobileNotesMode(selecting ? 'browse' : 'select');
  }, selecting);

  const galleryActive = getMobileNotesViewMode() === 'gallery';
  addOption(galleryActive ? 'Ver como listado' : 'Ver como galería', () => {
    localStorage.setItem('notesMobileViewMode', galleryActive ? 'list' : 'gallery');
    closeAllPopovers();
    renderNotesView('mobile');
  });

  const sortBy = getMobileNotesSortBy();
  const sortDir = getMobileNotesSortDir();
  const sortOptions = [
    ['updatedAt', 'Fecha de edición'],
    ['createdAt', 'Fecha de creación'],
    ['title', 'Nombre'],
  ];
  sortOptions.forEach(([key, label]) => {
    const active = sortBy === key;
    const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    addOption(label + arrow, () => {
      if (sortBy === key) {
        localStorage.setItem('notesMobileSortDir', sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        localStorage.setItem('notesMobileSortBy', key);
        localStorage.setItem('notesMobileSortDir', 'desc');
      }
      closeAllPopovers();
      renderNotesView('mobile');
    }, active);
  });
}

const btnMobileNotesMenu = document.getElementById('btn-mobile-notes-menu');
if (btnMobileNotesMenu) {
  btnMobileNotesMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const popover = document.getElementById('mobile-notes-menu-popover');
    const willOpen = popover.classList.contains('hidden');
    closeAllPopovers();
    if (willOpen) {
      buildMobileNotesMenuPopover();
      popover.classList.remove('hidden');
      positionFixedPopover(btnMobileNotesMenu, popover, { width: 220 });
    }
  });
}

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

// Fase 4 del rediseño movil: el titulo de una nota ya no se escribe a
// mano (se quito el campo #note-title, ver el editor mas abajo), se
// deriva SIEMPRE de la primera linea del cuerpo -- misma logica EXACTA
// que deriveTitleFromBody en server/routes/notes.js, duplicada aqui a
// proposito porque este proyecto no tiene ningun mecanismo para
// compartir codigo entre servidor y navegador sin meter un build nuevo.
// Se usa tanto para la etiqueta de solo lectura del editor (en vivo,
// sin esperar a guardar) como para la vista previa en las listas/
// galeria de notas.
//
// findFirstLineBreakIndexClient(): en un <div contenteditable> real, la
// PRIMERA linea normalmente NO queda envuelta en su propia etiqueta --
// se queda como texto suelto al principio, y solo la SEGUNDA linea en
// adelante se envuelve en un <div> nuevo al pulsar Intro (comprobado de
// verdad con Playwright: escribir "A" + Intro + "B" deja el HTML como
// "A<div>B</div>", NO "<div>A</div><div>B</div>"). Por eso la señal real
// de "aqui acaba la primera linea" es la APERTURA de ese div siguiente,
// no su cierre -- buscar solo el cierre se comia la segunda linea
// entera en ese caso, un bug real encontrado verificando este editor. Si
// el cuerpo YA viene envuelto desde el principio (nota cargada del
// servidor, contenido pegado con formato), se usa el cierre de ESE
// bloque -- de ahi que se descarte una apertura que coincide justo en
// la posicion 0 y se siga buscando.
function findFirstLineBreakIndexClient(html) {
  const pattern = /<br\s*\/?>|<\/(?:div|p|li)>|<(?:div|p|li)(?:\s[^>]*)?>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const isOpeningBlockAtStart = match.index === 0 && match[0][1] !== '/' && !/^<br/i.test(match[0]);
    if (isOpeningBlockAtStart) continue;
    return match.index;
  }
  return html.length;
}
function deriveTitleFromBodyClient(body, bodyFormat) {
  if (!body) return '';
  const format = bodyFormat === 'html' ? 'html' : 'text';
  let firstLine;
  if (format === 'html') {
    firstLine = body.slice(0, findFirstLineBreakIndexClient(body));
    firstLine = firstLine
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  } else {
    firstLine = body.split('\n')[0];
  }
  return firstLine.trim().slice(0, 200);
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
// Fase 4: "title" ya NO se compara aqui -- es un valor derivado de
// "bodyHtml" (ver deriveTitleFromBodyClient), asi que cualquier cambio
// que cambiaria el titulo ya cambia bodyHtml tambien; comparar los dos
// era redundante y ademas daba un falso "sucio" al abrir una nota
// antigua cuyo titulo guardado no coincide con la primera linea de su
// cuerpo (notas de antes de esta fase, que no se migran retroactivamente).
function isOpenNoteDirty(entry) {
  return !entry.id
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
    // Fase 4: titulo derivado de "bodyHtml", nunca leido de note.title
    // directamente -- ver el comentario de isOpenNoteDirty arriba.
    title: deriveTitleFromBodyClient(bodyHtml, 'html'),
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
  entry.bodyHtml = NOTE_EDITOR_BODY.innerHTML;
  entry.title = deriveTitleFromBodyClient(entry.bodyHtml, 'html');
  const folderRaw = noteFolderField.getValue();
  entry.folderId = folderRaw === '' ? null : Number(folderRaw);
  entry.favorite = noteModalFavorite;
  refreshNoteTitlePreview(entry.title);
}

// Actualiza la etiqueta de solo lectura del titulo (ver
// #note-title-preview en index.html) -- separado de
// captureActiveOpenNoteFromDom para poder llamarlo tambien desde
// loadOpenNoteIntoDom sin duplicar la logica del texto por defecto.
function refreshNoteTitlePreview(title) {
  document.getElementById('note-title-preview').textContent = title || '';
}

// Alterna entre editar (por defecto) y solo lectura para la nota activa
// -- es un ajuste POR NOTA ABIERTA (entry.readMode), asi que cada una
// mantiene su propio modo mientras siga abierta, no se comparte entre
// ellas ni se guarda en el servidor (es puramente de esta sesion del
// editor). En modo lectura no solo se desactiva el cuerpo: tambien los
// botones de guardar/eliminar/formato, para que "no tocar nada" cubra
// la nota entera, no solo el texto (el titulo, desde la Fase 4, ya es
// una etiqueta de solo lectura siempre, no hace falta desactivarla).
function applyNoteEditorReadMode(readOnly) {
  NOTE_EDITOR_BODY.contentEditable = readOnly ? 'false' : 'true';
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
  refreshNoteTitlePreview(entry.title);
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
  // Ya no hay campo de titulo al que llevar el foco (Fase 4) -- el
  // cuerpo es el unico sitio donde se escribe de verdad.
  NOTE_EDITOR_BODY.focus();
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
// nota -- de ahi capturar del DOM tambien en cada input del contenido
// (el titulo, desde la Fase 4, ya no es un campo aparte: se deriva del
// propio cuerpo dentro de captureActiveOpenNoteFromDom), no solo al
// cambiar de nota o guardar.
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
    // Fase 4: ya no se manda titulo, el servidor lo deriva del body
    // (ver deriveTitleFromBody en server/routes/notes.js).
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
// ---------------------------------------------------------------------
// Estilo de interaccion (Neon/Directo/Cristal, ver Configuracion > Estilo):
// ajuste por dispositivo, independiente del tema de color -- solo cambia
// como reaccionan los botones al pasar el raton y los interruptores al
// encenderse (ver el bloque [data-ui-style=...] en styles.css). Se
// aplica ANTES de pintar nada desde el script inline de index.html; esta
// funcion es la que usa el selector de Configuracion para cambiarlo en
// caliente sin recargar la pagina.
// ---------------------------------------------------------------------
const UI_STYLE_IDS = ['directo', 'neon', 'cristal', 'registro'];

function getUiStylePreference() {
  const stored = localStorage.getItem('uiStylePreference');
  return UI_STYLE_IDS.includes(stored) ? stored : 'directo';
}

function applyUiStyle() {
  document.documentElement.dataset.uiStyle = getUiStylePreference();
}

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
// que secciones de Recordatorios/Tareas/Notas van MARCADAS. Si hay
// alguna marcada Y alguna sin marcar, las dos "mitades" comparten un
// unico hueco (#reminders-panel-grouped-slot): las MARCADAS se ven
// juntas, apiladas, cada una con su scroll; la flecha cambia TODO el
// hueco a las NO marcadas (tambien juntas) en vez de mostrar una sola
// cada vez -- pedido explicito de Koku ("las seleccionadas aparecen
// juntas... si le doy a la flecha toda la columna que se me cambie a la
// que no esta seleccionada"). Preferencia de ESTE dispositivo
// (localStorage, un array de ids de las marcadas), elegida con casillas
// en Configuracion > Vista > "Panel lateral clasico" (ver
// refreshRemindersPanelGroupedOptions en settings.js). Marcar TODAS o
// NINGUNA no activa nada especial -- no habria "las otras" a las que
// cambiar, asi que se trata como si no hubiera agrupacion (las 3
// sueltas, siempre visibles, como si esto no existiera). En modo
// "panel" de Mi espacio (hub de 3 columnas) este ajuste no pinta nada:
// cada columna ya vive en su propio sitio fijo (ver moveRemindersIntoHub).
//
// REMINDERS_PANEL_PAGES esta pensado para poder crecer el dia que haya
// una 4a seccion: toda la logica de abajo itera sobre el array entero,
// sin ningun "3" fijo en el codigo.
const REMINDERS_PANEL_PAGES = [
  { id: 'reminders', label: 'Recordatorios', blockId: 'reminders-top-block' },
  { id: 'tasks', label: 'Tareas', blockId: 'reminders-tasks-block' },
  { id: 'notes', label: 'Notas', blockId: 'reminders-notes-block' },
];
// true = el hueco compartido muestra las MARCADAS ahora mismo; false =
// muestra las NO marcadas. Se reinicia a true cada vez que cambia que
// secciones estan marcadas (ver refreshRemindersPanelGroupedOptions en
// settings.js), para no dejarte "atascado" viendo las otras tras tocar
// el ajuste.
let remindersPanelShowingChecked = true;

function getRemindersGroupedSections() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem('remindersPanelGrouped') || '[]');
  } catch {
    stored = [];
  }
  if (!Array.isArray(stored)) return [];
  const valid = stored.filter((id) => REMINDERS_PANEL_PAGES.some((p) => p.id === id));
  return valid.length >= 1 && valid.length < REMINDERS_PANEL_PAGES.length ? valid : [];
}

// Recoloca cada bloque en su sitio (dentro del hueco compartido, o suelto
// en el panel si no hay agrupacion activa) y decide que se ve. Se llama
// al arrancar, al cambiar el ajuste, y cada vez que se le da a la
// flecha (stepRemindersPanelPage).
function applyRemindersPanelLayout() {
  if (getMiEspacioMode() === 'panel') return; // este ajuste no aplica ahi, ver moveRemindersIntoHub

  const panel = document.getElementById('reminders-panel');
  const groupedSlot = document.getElementById('reminders-panel-grouped-slot');
  const switcher = document.getElementById('reminders-panel-switcher');
  const checked = getRemindersGroupedSections();

  if (checked.length === 0) {
    // Sin agrupacion activa: las 3 sueltas, apiladas, siempre visibles.
    REMINDERS_PANEL_PAGES.forEach((p) => {
      const block = document.getElementById(p.blockId);
      panel.appendChild(block);
      block.classList.remove('hidden');
    });
    groupedSlot.classList.add('hidden');
    switcher.classList.add('hidden');
    return;
  }

  // Con agrupacion activa, las 3 secciones (marcadas Y no marcadas) viven
  // dentro del hueco compartido -- cual de las dos "mitades" se ve la
  // decide remindersPanelShowingChecked.
  panel.appendChild(groupedSlot);
  REMINDERS_PANEL_PAGES.forEach((p) => groupedSlot.appendChild(document.getElementById(p.blockId)));

  groupedSlot.classList.remove('hidden');
  switcher.classList.remove('hidden');
  const unchecked = REMINDERS_PANEL_PAGES.map((p) => p.id).filter((id) => !checked.includes(id));
  const showing = remindersPanelShowingChecked ? checked : unchecked;
  REMINDERS_PANEL_PAGES.forEach((p) => {
    document.getElementById(p.blockId).classList.toggle('hidden', !showing.includes(p.id));
  });
  document.getElementById('reminders-panel-switch-label').textContent = showing
    .map((id) => REMINDERS_PANEL_PAGES.find((p) => p.id === id).label)
    .join(' + ');
}

function stepRemindersPanelPage() {
  if (getRemindersGroupedSections().length === 0) return;
  // Solo hay dos "mitades" -- prev/next hacen lo mismo, dan la vuelta a
  // cual se ve, se mantienen los dos botones por simetria visual con el
  // resto de la app.
  remindersPanelShowingChecked = !remindersPanelShowingChecked;
  applyRemindersPanelLayout();
}

document.getElementById('btn-panel-switch-prev').addEventListener('click', () => stepRemindersPanelPage());
document.getElementById('btn-panel-switch-next').addEventListener('click', () => stepRemindersPanelPage());

function collapseMySpaceExpandedColumn() {
  delete document.getElementById('my-space-hub').dataset.expanded;
  document.getElementById('my-space-back-btn').classList.add('hidden');
}

function closeMySpaceView() {
  document.getElementById('my-space-view').classList.add('hidden');
  collapseMySpaceExpandedColumn();
  restoreClassicRemindersPanel();
  setCurrentScreen('home');
}

function openMySpaceView() {
  moveRemindersIntoHub();
  document.getElementById('my-space-view').classList.remove('hidden');
  setCurrentScreen('my-space');
}

// Vista de Notas movil (Fase 4 del rediseño movil) -- sustituye al
// puente temporal que abria "Mi espacio" desde la barra inferior (ver
// goToMobileSection). Se abre siempre en la raiz, sin busqueda activa,
// para no arrastrar el "donde estabas" de la ultima vez que se uso el
// panel clasico de escritorio (que comparte el mismo state.currentNoteFolderId).
function openMobileNotesView() {
  state.currentNoteFolderId = null;
  clearNoteSearch();
  document.getElementById('mobile-notes-view').classList.remove('hidden');
  setCurrentScreen('mobile-notes');
  renderNotesView('mobile');
}

function closeMobileNotesView() {
  document.getElementById('mobile-notes-view').classList.add('hidden');
  setCurrentScreen('home');
  // No dejar el modo Seleccionar/Mover/Editar carpetas "colgado" para la
  // proxima vez que se abra esta vista.
  mobileNotesMode = 'browse';
  mobileNotesSelectedKeys.clear();
  refreshMobileNotesActionBar();
}
document.getElementById('btn-close-mobile-notes').addEventListener('click', closeMobileNotesView);
document.getElementById('btn-mobile-notes-new-folder').addEventListener('click', () => openNoteFolderModal(null));
document.getElementById('btn-mobile-notes-new').addEventListener('click', () => openNoteInEditor(null));

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

  // En modo "panel" el ancho del aside es fijo (640px, ver .my-space-panel-mode
  // en styles.css) -- el arrastre no tendria ningun efecto ahi, asi que
  // se oculta para no dejar un control muerto en pantalla.
  const resizeHandle = document.getElementById('panel-resize-handle');
  if (mode === 'panel') {
    panel.appendChild(hub);
    panel.classList.add('my-space-panel-mode');
    moveRemindersIntoHub();
    document.getElementById('btn-my-space').classList.add('hidden');
    if (resizeHandle) resizeHandle.classList.add('hidden');
  } else {
    document.getElementById('my-space-view').appendChild(hub);
    document.getElementById('btn-my-space').classList.remove('hidden');
    if (resizeHandle) resizeHandle.classList.remove('hidden');
  }
}

// Arrastre del divisor entre el calendario y el panel de recordatorios
// (pedido explicito de Koku: "en este ordenador me gustaria hacer algo
// mas ancho el espacio que ocupa la columna de recordatorios"). El ancho
// se guarda en localStorage POR DISPOSITIVO (cada ordenador puede querer
// uno distinto) y se aplica como variable CSS que .reminders-panel ya
// lee (ver styles.css) -- clamp() en JS y en el propio CSS por partida
// doble, para que nunca se pueda arrastrar a algo inservible.
const PANEL_WIDTH_MIN = 240;
const PANEL_WIDTH_MAX = 640;

function applyStoredRemindersPanelWidth() {
  const stored = Number(localStorage.getItem('remindersPanelWidth'));
  if (stored && stored >= PANEL_WIDTH_MIN && stored <= PANEL_WIDTH_MAX) {
    document.documentElement.style.setProperty('--reminders-panel-width', `${stored}px`);
  }
}
applyStoredRemindersPanelWidth();

(function setupPanelResizeHandle() {
  const handle = document.getElementById('panel-resize-handle');
  const panel = document.getElementById('reminders-panel');
  if (!handle || !panel) return;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    handle.classList.add('is-dragging');
    document.body.classList.add('is-resizing-panel');

    function onMouseMove(ev) {
      // El panel esta a la DERECHA del divisor: arrastrar hacia la
      // izquierda (deltaX negativo) lo agranda, hacia la derecha lo
      // encoge -- de ahi el signo invertido.
      const deltaX = ev.clientX - startX;
      const newWidth = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, startWidth - deltaX));
      document.documentElement.style.setProperty('--reminders-panel-width', `${newWidth}px`);
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      handle.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing-panel');
      const finalWidth = panel.getBoundingClientRect().width;
      localStorage.setItem('remindersPanelWidth', String(Math.round(finalWidth)));
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
})();

document.getElementById('btn-my-space').addEventListener('click', openMySpaceView);
document.getElementById('btn-close-my-space').addEventListener('click', closeMySpaceView);

// ---------------------------------------------------------------------
// Navegacion movil (.mobile-nav + boton flotante "+", ver styles.css):
// sustituye a la topbar en pantallas estrechas. No duplica logica de
// abrir/cerrar -- cada seccion dispara el CLICK del boton real que ya
// existia (btn-my-space/btn-extensions/btn-settings), y antes de eso
// cierra todo lo que estuviera abierto reutilizando la misma cascada de
// Esc capa a capa de settings.js (dispararla varias veces seguidas la
// deja en el fondo del todo, sea cual sea la profundidad en la que
// estuvieras -- Esc ya sabe deshacer una capa por pulsacion).
// ---------------------------------------------------------------------
function closeAllMobileOverlays() {
  for (let i = 0; i < 6; i++) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }
}

function refreshMobileNavActive(section) {
  document.querySelectorAll('.mobile-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mobileNav === section);
  });
}

function goToMobileSection(section) {
  closeAllMobileOverlays();
  // "notes" es el hueco de la barra inferior -- abre la vista de Notas
  // propia del movil (Fase 4), no "Mi espacio" (que ya no tiene sentido
  // en movil, ver CLAUDE.md/decision 3: tareas y recordatorios viven
  // dentro del propio calendario). Puede tambien abrir otra App si Koku
  // eligio otra en Configuracion -> Este dispositivo (ver
  // applyMobileNavCustomization(), Fase 5) -- mientras eso no exista,
  // "notes" es el unico valor real que puede llegar aqui.
  if (section === 'notes') openMobileNotesView();
  else if (section === 'extensions') document.getElementById('btn-extensions').click();
  else if (section === 'settings') document.getElementById('btn-settings').click();
  refreshMobileNavActive(section);
}

document.querySelectorAll('.mobile-nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => goToMobileSection(btn.dataset.mobileNav));
});

// Boton flotante de crear: un solo boton que despliega los 3 accesos
// directos de siempre (+ Nuevo evento/+ Nueva tarea/+ Nota). Desde la
// Fase 2 del rediseño movil vive dentro de la barra del calendario
// movil (antes era un boton flotante aparte, .mobile-fab-wrap, ver
// CLAUDE.md) -- misma logica, solo cambio donde vive en el DOM.
// menuId/btnId con los valores del mes como default -- la vista diaria
// (Fase 3) tenia el mismo boton pero se le olvido meter, y ahora
// reutiliza esta misma funcion con sus propios ids en vez de duplicarla.
function toggleMobileCalendarAddMenu(forceOpen, menuId = 'mobile-calendar-add-menu', btnId = 'btn-mobile-calendar-add') {
  const menu = document.getElementById(menuId);
  const btn = document.getElementById(btnId);
  const willBeOpen = forceOpen !== undefined ? forceOpen : menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !willBeOpen);
  btn.setAttribute('aria-expanded', willBeOpen ? 'true' : 'false');
}

document.getElementById('btn-mobile-calendar-add').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMobileCalendarAddMenu();
});
document.getElementById('btn-new-event-mobile').addEventListener('click', () => {
  toggleMobileCalendarAddMenu(false);
  openEventModal(null);
});
document.getElementById('btn-new-task-mobile').addEventListener('click', () => {
  toggleMobileCalendarAddMenu(false);
  openTaskModal(null);
});

// Mismo menu "+", pero en la barra de la vista diaria (id
// mobile-day-add-wrap/-menu, btn-mobile-day-add) -- crear desde aqui
// usa como fecha por defecto el DIA que se esta viendo, no "ahora".
document.getElementById('btn-mobile-day-add').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMobileCalendarAddMenu(undefined, 'mobile-day-add-menu', 'btn-mobile-day-add');
});
document.getElementById('btn-new-event-mobile-day').addEventListener('click', () => {
  toggleMobileCalendarAddMenu(false, 'mobile-day-add-menu', 'btn-mobile-day-add');
  openEventModal(null, state.mobileCalendarDayDate);
});
document.getElementById('btn-new-task-mobile-day').addEventListener('click', () => {
  toggleMobileCalendarAddMenu(false, 'mobile-day-add-menu', 'btn-mobile-day-add');
  openTaskModal(null, state.mobileCalendarDayDate);
});

// Tocar fuera del boton/menu tambien lo cierra -- patron normal de menu
// flotante (ver closeAllPopovers en settings.js para el mismo patron con
// los popovers de color/icono/fecha). Comprueba los 2 wraps (mes y dia).
document.addEventListener('click', (e) => {
  const monthWrap = document.getElementById('mobile-calendar-add-wrap');
  if (monthWrap && !monthWrap.contains(e.target)) toggleMobileCalendarAddMenu(false);
  const dayWrap = document.getElementById('mobile-day-add-wrap');
  if (dayWrap && !dayWrap.contains(e.target)) toggleMobileCalendarAddMenu(false, 'mobile-day-add-menu', 'btn-mobile-day-add');
});

// ---------------------------------------------------------------------
// Apps (placeholder): mismo patron de pantalla completa que "Mi
// espacio" (.my-space-view), pero sin modo panel/boton -- este boton no
// se oculta nunca. Sin logica real todavia, solo abre/cierra la pantalla
// "Proximamente" (ver #extensions-view en index.html).
// ---------------------------------------------------------------------
function openExtensionsView() {
  document.getElementById('extensions-view').classList.remove('hidden');
  setCurrentScreen('extensions');
}
function closeExtensionsView() {
  document.getElementById('extensions-view').classList.add('hidden');
  setCurrentScreen('home');
}
document.getElementById('btn-extensions').addEventListener('click', openExtensionsView);
document.getElementById('btn-close-extensions').addEventListener('click', closeExtensionsView);

// ---------------------------------------------------------------------
// Extension "Gimnasio": registro de entrenamientos de verdad (ejercicios,
// rutinas reutilizables, sesiones con series/repeticiones/peso, y
// progreso con graficas). Se abre desde la tarjeta de Apps y
// vuelve ahi (no a Home) al cerrarse. Las 3 secciones (Sesiones/Rutinas/
// Progreso) son pestañas simples (switchGymTab), no el patron de
// columnas de "Mi espacio" -- aqui solo tiene sentido ver una a la vez.
// ---------------------------------------------------------------------
async function openGymView() {
  closeExtensionsView();
  document.getElementById('gym-view').classList.remove('hidden');
  setCurrentScreen('gym');
  await Promise.all([loadGymExercises(), loadGymRoutines(), loadGymSessions()]);
  renderGymExercisesList();
  renderGymRoutinesList();
  renderGymSessionsList();
  populateGymProgressExerciseSelect();
}
function closeGymView() {
  document.getElementById('gym-view').classList.add('hidden');
  openExtensionsView();
}
document.getElementById('btn-open-gym').addEventListener('click', openGymView);
document.getElementById('btn-close-gym').addEventListener('click', closeGymView);

function switchGymTab(tabName) {
  document.querySelectorAll('.gym-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.gymTab === tabName);
  });
  document.querySelectorAll('.gym-tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== `gym-tab-${tabName}`);
  });
}
document.querySelectorAll('.gym-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchGymTab(btn.dataset.gymTab));
});

async function loadGymExercises() {
  state.gymExercises = await api('/api/gym-exercises');
}
async function loadGymRoutines() {
  state.gymRoutines = await api('/api/gym-routines');
}
async function loadGymSessions() {
  state.gymSessions = await api('/api/gym-sessions');
}

// 'YYYY-MM-DD' -> "15 ago 2026", para el historial de sesiones. No hay
// ningun helper de formateo de fechas ya hecho en el proyecto que
// encaje aqui (toDateKey hace lo contrario: Date -> 'YYYY-MM-DD').
const GYM_DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
function formatGymDate(dateStr) {
  return GYM_DATE_FORMATTER.format(new Date(`${dateStr}T00:00:00`));
}

// Unidad de peso para Gimnasio (kg o libras): ajuste por dispositivo, no
// compartido -- el dato en la base de datos SIEMPRE es weight_kg (ver
// server/db.js), esto solo decide como se escribe/lee en pantalla. El
// toggle de verdad vive en Configuracion > Este dispositivo (ver
// refreshGymWeightUnitOptions en settings.js); aqui solo la lectura y
// las conversiones, que hacen falta ya en el modal de sesion mas abajo.
const KG_TO_LB = 2.20462;
function getGymWeightUnit() {
  return localStorage.getItem('gymWeightUnit') === 'lb' ? 'lb' : 'kg';
}
function getGymWeightUnitLabel() {
  return getGymWeightUnit();
}
function gymWeightKgToDisplay(weightKg) {
  if (weightKg === null || weightKg === undefined) return '';
  const value = getGymWeightUnit() === 'lb' ? weightKg * KG_TO_LB : weightKg;
  return Math.round(value * 100) / 100;
}
function gymWeightDisplayToKg(displayValue) {
  if (displayValue === '' || displayValue === null || displayValue === undefined) return null;
  const num = Number(displayValue);
  if (Number.isNaN(num)) return null;
  return getGymWeightUnit() === 'lb' ? num / KG_TO_LB : num;
}

function renderGymExercisesList() {
  const list = document.getElementById('gym-exercises-list');
  list.innerHTML = '';
  if (state.gymExercises.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavia no tienes ejercicios. Se crean desde aqui o al añadirlos a una rutina/sesion.</p>';
    return;
  }
  state.gymExercises.forEach((ex) => {
    const row = document.createElement('div');
    row.className = 'gym-list-item';
    row.innerHTML = `
      <span class="gym-list-item-name">${escapeHtml(ex.name)}${ex.muscleGroup ? ` <span class="gym-list-item-muted">(${escapeHtml(ex.muscleGroup)})</span>` : ''}</span>
      <div class="gym-list-item-actions">
        <button type="button" class="icon-btn" data-edit-gym-exercise="${ex.id}" aria-label="Editar ejercicio">✎</button>
      </div>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-edit-gym-exercise]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openGymExerciseModal(state.gymExercises.find((e) => e.id === Number(btn.dataset.editGymExercise)));
    });
  });
}

function renderGymRoutinesList() {
  const list = document.getElementById('gym-routines-list');
  list.innerHTML = '';
  if (state.gymRoutines.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavia no tienes rutinas. Crea una arriba.</p>';
    return;
  }
  state.gymRoutines.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'gym-list-item';
    row.innerHTML = `
      <span class="color-dot" style="background-color: ${r.color}"></span>
      <span class="gym-list-item-name">${r.icon ? escapeHtml(r.icon) + ' ' : ''}${escapeHtml(r.name)} <span class="gym-list-item-muted">(${r.exercises.length} ejercicio${r.exercises.length === 1 ? '' : 's'})</span></span>
      <div class="gym-list-item-actions">
        <button type="button" class="icon-btn" data-edit-gym-routine="${r.id}" aria-label="Editar rutina">✎</button>
      </div>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-edit-gym-routine]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openGymRoutineModal(state.gymRoutines.find((r) => r.id === Number(btn.dataset.editGymRoutine)));
    });
  });
}

function renderGymSessionsList() {
  const list = document.getElementById('gym-sessions-list');
  list.innerHTML = '';
  if (state.gymSessions.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavia no has registrado ninguna sesion.</p>';
    return;
  }
  state.gymSessions.forEach((s) => {
    const exerciseNames = [...new Set(s.sets.map((set) => set.exerciseName))];
    const row = document.createElement('div');
    row.className = 'gym-list-item gym-session-item';
    row.dataset.editGymSession = s.id;
    row.innerHTML = `
      <span class="gym-session-item-date">${formatGymDate(s.date)}</span>
      ${
        s.routineName
          ? `<span class="gym-session-item-routine"><span class="color-dot" style="background-color: ${s.routineColor}"></span>${s.routineIcon ? escapeHtml(s.routineIcon) + ' ' : ''}${escapeHtml(s.routineName)}</span>`
          : '<span class="gym-session-item-routine gym-list-item-muted">Sesion libre</span>'
      }
      <span class="gym-list-item-muted">${exerciseNames.length ? exerciseNames.map(escapeHtml).join(', ') : 'Sin ejercicios'}</span>
    `;
    row.addEventListener('click', () => openGymSessionModal(s));
    list.appendChild(row);
  });
}

// ---------------------------------------------------------------------
// Extension "Finanzas": gastos, ingresos e inversiones. Las inversiones
// son SOLO registro manual -- sin conectar a ninguna API externa de
// cotizaciones en vivo, para mantener la app local-first (ver
// CLAUDE.md). Vive en su propia pantalla completa (#finanzas-view,
// mismo patron .my-space-view que Apps) con 3 pestañas.
//
// createIconField()/createColorField() viven en settings.js, que se
// carga DESPUES de app.js -- por eso los campos de icono/color no se
// crean aqui arriba (a nivel de modulo, se ejecutaria antes de que
// settings.js exista), sino de forma perezosa en
// setupFinanzasIconColorFields(), llamada la primera vez que se abre
// la vista (un click, que solo puede pasar despues de que los dos
// scripts ya hayan terminado de cargar).
// ---------------------------------------------------------------------
let finanzasAccounts = [];
let finanzasCategories = [];
let finanzasPortfolios = [];
let finanzasAssets = [];
// Set de assetId marcados en el arbol de seleccion de Inversiones (ver
// renderFinanzasAssetTree) -- fuente de verdad unica; el estado de
// checkbox de cada CARTERA se deriva de sus activos descendientes en
// cada render, nunca se guarda un estado propio de cartera.
let finanzasAssetTreeSelectedIds = new Set();
let finanzasIconColorFieldsReady = false;
let finanzasAccountIconField = null;
let finanzasAccountColorField = null;
let finanzasCategoryIconField = null;
let finanzasCategoryColorField = null;
let finanzasPortfolioColorField = null;

const finanzasFilters = { accountId: '', categoryId: '', type: '', from: '', to: '' };

const FINANZAS_MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const FINANZAS_MONTH_OPTIONS = FINANZAS_MONTH_NAMES.map((label, i) => ({ value: String(i + 1).padStart(2, '0'), label }));

// Selectores/fechas con estilo propio para Finanzas (createSelectField/
// createDateField, definidos mas arriba en este archivo) -- antes eran
// <select>/<input type="date"> nativos, desentonaban con el resto del
// tema (mismo motivo que la ronda de Lecturas). Los que dependen de
// datos (cuenta/categoria/activo) se crean con opciones vacias y se
// rellenan via .setOptions() (ver populateFinanzasSelects() e
// refreshFinanzasInvestmentTrendChart() mas abajo). createSelectField()
// no depende de settings.js hasta que se hace clic en el desplegable,
// asi que es seguro crearlos ya a nivel de modulo -- a diferencia de
// finanzasAccountIconField/-ColorField (mas arriba), que SI hace falta
// crear de forma perezosa (ver setupFinanzasIconColorFields).
const finanzasAccountTypeField = createSelectField({
  options: [
    { value: '', label: 'Sin tipo' },
    { value: 'Corriente', label: 'Corriente' },
    { value: 'Ahorro', label: 'Ahorro' },
    { value: 'Inversión', label: 'Inversión' },
    { value: 'Efectivo', label: 'Efectivo' },
    { value: 'Otro', label: 'Otro' },
  ],
  initialValue: '',
});
document.getElementById('finanzas-account-type-field').appendChild(finanzasAccountTypeField.element);

const finanzasFilterAccountField = createSelectField({
  options: [{ value: '', label: 'Todas las cuentas' }],
  initialValue: '',
  onChange: (value) => { finanzasFilters.accountId = value; refreshFinanzasTransactionsTab(); },
});
document.getElementById('finanzas-filter-account-field').appendChild(finanzasFilterAccountField.element);

const finanzasFilterCategoryField = createSelectField({
  options: [{ value: '', label: 'Todas las categorías' }],
  initialValue: '',
  onChange: (value) => { finanzasFilters.categoryId = value; refreshFinanzasTransactionsTab(); },
});
document.getElementById('finanzas-filter-category-field').appendChild(finanzasFilterCategoryField.element);

const finanzasFilterTypeField = createSelectField({
  options: [
    { value: '', label: 'Gastos e ingresos' },
    { value: 'expense', label: 'Solo gastos' },
    { value: 'income', label: 'Solo ingresos' },
  ],
  initialValue: '',
  onChange: (value) => { finanzasFilters.type = value; refreshFinanzasTransactionsTab(); },
});
document.getElementById('finanzas-filter-type-field').appendChild(finanzasFilterTypeField.element);

const finanzasFilterFromField = createDateField({
  initialValue: null,
  allowClear: true,
  placeholder: 'Desde',
  onChange: (date) => { finanzasFilters.from = date ? toDateKey(date) : ''; refreshFinanzasTransactionsTab(); },
});
document.getElementById('finanzas-filter-from-field').appendChild(finanzasFilterFromField.element);

const finanzasFilterToField = createDateField({
  initialValue: null,
  allowClear: true,
  placeholder: 'Hasta',
  onChange: (date) => { finanzasFilters.to = date ? toDateKey(date) : ''; refreshFinanzasTransactionsTab(); },
});
document.getElementById('finanzas-filter-to-field').appendChild(finanzasFilterToField.element);

const finanzasTransactionTypeField = createSelectField({
  options: [{ value: 'expense', label: 'Gasto' }, { value: 'income', label: 'Ingreso' }],
  initialValue: 'expense',
  onChange: () => refreshFinanzasTransactionTypeFields(),
});
document.getElementById('finanzas-transaction-type-field').appendChild(finanzasTransactionTypeField.element);

const finanzasTransactionAccountField = createSelectField({ options: [], initialValue: '' });
document.getElementById('finanzas-transaction-account-field').appendChild(finanzasTransactionAccountField.element);

const finanzasTransactionCategoryField = createSelectField({
  options: [{ value: '', label: 'Sin categoría' }],
  initialValue: '',
});
document.getElementById('finanzas-transaction-category-field').appendChild(finanzasTransactionCategoryField.element);

const finanzasTransactionDateField = createDateField({ initialValue: new Date() });
document.getElementById('finanzas-transaction-date-field').appendChild(finanzasTransactionDateField.element);

const finanzasInvestmentAccountField = createSelectField({ options: [], initialValue: '' });
document.getElementById('finanzas-investment-account-field').appendChild(finanzasInvestmentAccountField.element);

const finanzasInvestmentTypeField = createSelectField({
  options: [{ value: 'buy', label: 'Compra' }, { value: 'sell', label: 'Venta' }, { value: 'dividend', label: 'Dividendo' }],
  initialValue: 'buy',
  onChange: () => refreshFinanzasInvestmentTypeFields(),
});
document.getElementById('finanzas-investment-type-field').appendChild(finanzasInvestmentTypeField.element);

const finanzasInvestmentDateField = createDateField({ initialValue: new Date() });
document.getElementById('finanzas-investment-date-field').appendChild(finanzasInvestmentDateField.element);

// Activo de la transaccion -- antes era texto libre, ahora los activos
// son una entidad real (ver routes/finanzasAssets.js): se eligen de los
// ya creados en "Gestionar carteras y activos", sin creacion inline
// (mismo criterio que cuenta/categoria).
const finanzasInvestmentAssetField = createSelectField({ options: [], initialValue: '' });
document.getElementById('finanzas-investment-asset-field').appendChild(finanzasInvestmentAssetField.element);

// Cartera padre al crear/editar una cartera (arbol con indentacion, ver
// buildPortfolioSelectOptions mas abajo) y cartera de un activo -- las
// opciones se rellenan via .setOptions() en cuanto se cargan
// finanzasPortfolios (populateFinanzasPortfolioSelects).
const finanzasPortfolioParentField = createSelectField({ options: [{ value: '', label: 'Ninguna (nivel raiz)' }], initialValue: '' });
document.getElementById('finanzas-portfolio-parent-field').appendChild(finanzasPortfolioParentField.element);

const finanzasAssetPortfolioField = createSelectField({ options: [{ value: '', label: 'Sin cartera' }], initialValue: '' });
document.getElementById('finanzas-asset-portfolio-field').appendChild(finanzasAssetPortfolioField.element);

// Fecha de una actualizacion manual de precio (ver "Ver evolución" en
// Gestionar activos, renderFinanzasAssetValuationChart mas abajo).
const finanzasAssetValuationDateField = createDateField({ initialValue: new Date() });
document.getElementById('finanzas-asset-valuation-date-field').appendChild(finanzasAssetValuationDateField.element);

// Plantilla de gasto fijo (pestaña "Gastos fijos") -- cuenta/categoria
// reutilizan las mismas opciones que Movimientos (pobladas en
// populateFinanzasSelects). El mes del año solo se ve si la frecuencia
// es anual, ver refreshFinanzasRecurringFrequencyFields().
const finanzasRecurringAccountField = createSelectField({ options: [], initialValue: '' });
document.getElementById('finanzas-recurring-account-field').appendChild(finanzasRecurringAccountField.element);

const finanzasRecurringCategoryField = createSelectField({ options: [{ value: '', label: 'Sin categoría' }], initialValue: '' });
document.getElementById('finanzas-recurring-category-field').appendChild(finanzasRecurringCategoryField.element);

const finanzasRecurringFrequencyField = createSelectField({
  options: [{ value: 'monthly', label: 'Mensual' }, { value: 'annual', label: 'Anual' }],
  initialValue: 'monthly',
  onChange: () => refreshFinanzasRecurringFrequencyFields(),
});
document.getElementById('finanzas-recurring-frequency-field').appendChild(finanzasRecurringFrequencyField.element);

const finanzasRecurringMonthField = createSelectField({ options: FINANZAS_MONTH_OPTIONS, initialValue: '01' });
document.getElementById('finanzas-recurring-month-field').appendChild(finanzasRecurringMonthField.element);

const finanzasRecurringStartField = createDateField({ initialValue: new Date() });
document.getElementById('finanzas-recurring-start-field').appendChild(finanzasRecurringStartField.element);

const finanzasRecurringEndField = createDateField({ initialValue: null, allowClear: true, placeholder: 'Sin fecha de fin' });
document.getElementById('finanzas-recurring-end-field').appendChild(finanzasRecurringEndField.element);

// Deudas (pestaña "Deudas") -- la fecha es opcional (allowClear) porque
// Koku pidio explicitamente poder dejarla en blanco; la cuenta tambien
// (ver "Sin cuenta ligada" mas abajo en populateFinanzasSelects).
const finanzasDebtDirectionField = createSelectField({
  options: [{ value: 'owed_by_me', label: 'Debo yo' }, { value: 'owed_to_me', label: 'Me deben' }],
  initialValue: 'owed_by_me',
});
document.getElementById('finanzas-debt-direction-field').appendChild(finanzasDebtDirectionField.element);

const finanzasDebtDateField = createDateField({ initialValue: null, allowClear: true, placeholder: 'Sin fecha' });
document.getElementById('finanzas-debt-date-field').appendChild(finanzasDebtDateField.element);

const finanzasDebtAccountField = createSelectField({ options: [{ value: '', label: 'Sin cuenta ligada' }], initialValue: '' });
document.getElementById('finanzas-debt-account-field').appendChild(finanzasDebtAccountField.element);

// Selector de mes (vista mensual del Ahorro) + rango (vista historica) --
// ver renderFinanzasSavingsMonthly()/renderFinanzasSavingsHistoric() mas
// abajo.
const finanzasSavingsMonthField = createSelectField({
  options: FINANZAS_MONTH_OPTIONS,
  initialValue: String(new Date().getMonth() + 1).padStart(2, '0'),
  onChange: () => renderFinanzasSavingsMonthly(),
});
document.getElementById('finanzas-savings-month-field').appendChild(finanzasSavingsMonthField.element);

const finanzasSavingsRangeFromMonthField = createSelectField({ options: FINANZAS_MONTH_OPTIONS, initialValue: '01' });
document.getElementById('finanzas-savings-range-from-month-field').appendChild(finanzasSavingsRangeFromMonthField.element);

const finanzasSavingsRangeToMonthField = createSelectField({
  options: FINANZAS_MONTH_OPTIONS,
  initialValue: String(new Date().getMonth() + 1).padStart(2, '0'),
});
document.getElementById('finanzas-savings-range-to-month-field').appendChild(finanzasSavingsRangeToMonthField.element);

const finanzasCurrentYear = new Date().getFullYear();
document.getElementById('finanzas-savings-year-input').value = finanzasCurrentYear;
document.getElementById('finanzas-savings-range-from-year').value = finanzasCurrentYear;
document.getElementById('finanzas-savings-range-to-year').value = finanzasCurrentYear;

function formatFinanzasAmount(n) {
  const num = Number(n) || 0;
  return `${num.toFixed(2)} €`;
}

function setupFinanzasIconColorFields() {
  if (finanzasIconColorFieldsReady) return;
  finanzasIconColorFieldsReady = true;

  finanzasAccountIconField = createIconField({ initialValue: '' });
  document.getElementById('finanzas-account-icon-field').appendChild(finanzasAccountIconField.element);
  finanzasAccountColorField = createColorField({ initialValue: DEFAULT_EVENT_COLOR });
  document.getElementById('finanzas-account-color-field').appendChild(finanzasAccountColorField.element);

  finanzasCategoryIconField = createIconField({ initialValue: '' });
  document.getElementById('finanzas-category-icon-field').appendChild(finanzasCategoryIconField.element);
  finanzasCategoryColorField = createColorField({ initialValue: DEFAULT_EVENT_COLOR });
  document.getElementById('finanzas-category-color-field').appendChild(finanzasCategoryColorField.element);

  finanzasPortfolioColorField = createColorField({ initialValue: DEFAULT_EVENT_COLOR });
  document.getElementById('finanzas-portfolio-color-field').appendChild(finanzasPortfolioColorField.element);
}

async function loadFinanzasAccounts() {
  finanzasAccounts = await api('/api/finanzas-accounts');
}
async function loadFinanzasCategories() {
  finanzasCategories = await api('/api/finanzas-categories');
}
async function loadFinanzasPortfolios() {
  finanzasPortfolios = await api('/api/finanzas-portfolios');
}
async function loadFinanzasAssets() {
  finanzasAssets = await api('/api/finanzas-assets');
}

function populateFinanzasSelects() {
  const accountOptions = finanzasAccounts.map((a) => ({ value: a.id, label: `${a.icon ? a.icon + ' ' : ''}${a.name}` }));
  finanzasFilterAccountField.setOptions([{ value: '', label: 'Todas las cuentas' }, ...accountOptions]);
  finanzasTransactionAccountField.setOptions(accountOptions);
  finanzasInvestmentAccountField.setOptions(accountOptions);
  finanzasRecurringAccountField.setOptions(accountOptions);
  finanzasDebtAccountField.setOptions([{ value: '', label: 'Sin cuenta ligada' }, ...accountOptions]);

  const categoryOptions = finanzasCategories.map((c) => ({ value: c.id, label: `${c.icon ? c.icon + ' ' : ''}${c.name}` }));
  finanzasFilterCategoryField.setOptions([{ value: '', label: 'Todas las categorías' }, ...categoryOptions]);
  finanzasTransactionCategoryField.setOptions([{ value: '', label: 'Sin categoría' }, ...categoryOptions]);
  finanzasRecurringCategoryField.setOptions([{ value: '', label: 'Sin categoría' }, ...categoryOptions]);
}

// Recorre finanzasPortfolios (parentId auto-referenciado) con
// indentacion segun profundidad -- mismo patron que
// buildFolderSelectOptions() para las carpetas de notas (espacio
// ideografico U+3000 repetido por nivel + prefijo "↳"). excludePortfolioId
// evita ofrecer una cartera (o cualquiera de sus descendientes) como su
// propio padre al editarla -- el backend igualmente rechazaria el ciclo,
// esto solo mejora la UX no mostrando la opcion invalida.
function buildPortfolioSelectOptions(parentId, depth, excludePortfolioId) {
  const children = finanzasPortfolios
    .filter((p) => p.parentId === parentId && p.id !== excludePortfolioId)
    .sort((a, b) => a.position - b.position);
  let options = [];
  children.forEach((p) => {
    const indent = '　'.repeat(depth);
    const prefix = depth > 0 ? '↳ ' : '';
    options.push({ value: String(p.id), label: indent + prefix + p.name, color: p.color });
    options = options.concat(buildPortfolioSelectOptions(p.id, depth + 1, excludePortfolioId));
  });
  return options;
}

function populateFinanzasPortfolioSelects(excludePortfolioId) {
  finanzasPortfolioParentField.setOptions([
    { value: '', label: 'Ninguna (nivel raiz)' },
    ...buildPortfolioSelectOptions(null, 0, excludePortfolioId),
  ]);
  finanzasAssetPortfolioField.setOptions([
    { value: '', label: 'Sin cartera' },
    ...buildPortfolioSelectOptions(null, 0),
  ]);
  const assetOptions = [...finanzasAssets].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((a) => ({ value: a.id, label: a.name }));
  finanzasInvestmentAssetField.setOptions(assetOptions);
}

// Cuentas: modal propio (Nueva/Editar), igual que Movimientos/Inversiones
// -- antes reutilizaba el mismo formulario de "añadir" con un boton
// Cancelar, Koku pidio que "Editar" abriera algo como el modal de
// "+ Movimiento" en vez de eso.
function openFinanzasAccountModal(a) {
  document.getElementById('finanzas-account-modal-title').textContent = a ? 'Editar cuenta' : 'Nueva cuenta';
  document.getElementById('finanzas-account-id').value = a ? a.id : '';
  document.getElementById('finanzas-account-name').value = a ? a.name : '';
  document.getElementById('finanzas-account-initial-balance').value = a ? a.initialBalance : '';
  finanzasAccountTypeField.setValue(a ? (a.type || '') : '');
  finanzasAccountIconField.setValue(a ? (a.icon || '') : '');
  finanzasAccountColorField.setValue(a ? a.color : DEFAULT_EVENT_COLOR);
  document.getElementById('finanzas-account-modal').classList.remove('hidden');
}
function closeFinanzasAccountModal() {
  document.getElementById('finanzas-account-modal').classList.add('hidden');
}
document.getElementById('btn-new-finanzas-account').addEventListener('click', () => openFinanzasAccountModal(null));
document.getElementById('btn-cancel-finanzas-account').addEventListener('click', closeFinanzasAccountModal);
document.getElementById('btn-close-finanzas-account').addEventListener('click', closeFinanzasAccountModal);

function resetFinanzasCategoryForm() {
  document.getElementById('finanzas-category-id').value = '';
  document.getElementById('finanzas-category-name').value = '';
  finanzasCategoryIconField.setValue('');
  finanzasCategoryColorField.setValue(DEFAULT_EVENT_COLOR);
  document.getElementById('btn-cancel-finanzas-category').classList.add('hidden');
}

function renderFinanzasAccountsList() {
  const list = document.getElementById('finanzas-accounts-list');
  list.innerHTML = '';
  if (finanzasAccounts.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavia no tienes cuentas. Crea una arriba.</p>';
    return;
  }
  finanzasAccounts.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'group-item';
    row.innerHTML = `
      <span class="color-dot" style="background-color: ${a.color}"></span>
      <span class="group-item-name">${a.icon ? escapeHtml(a.icon) + ' ' : ''}${escapeHtml(a.name)}${a.type ? ` <span class="finanzas-account-type-badge">${escapeHtml(a.type)}</span>` : ''} — ${formatFinanzasAmount(a.balance)}</span>
      <div class="group-item-actions">
        <button type="button" class="secondary-btn" data-action="edit">Editar</button>
        <button type="button" class="danger-btn" data-action="delete">Eliminar</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openFinanzasAccountModal(a));
    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la cuenta "${a.name}"?`)) return;
      try {
        await api(`/api/finanzas-accounts/${a.id}`, { method: 'DELETE' });
        await refreshFinanzasAccountsAndCategories();
        renderFinanzasResumenTab();
      } catch (err) {
        alert(err.message);
      }
    });
    list.appendChild(row);
  });
}

// Carteras: modal propio (Nueva/Editar) igual que Cuentas -- nombre +
// color + cartera padre (arbol con indentacion, ver
// buildPortfolioSelectOptions). excludePortfolioId al editar evita
// ofrecerse a si misma (o a sus descendientes) como su propio padre.
function openFinanzasPortfolioModal(p) {
  document.getElementById('finanzas-portfolio-modal-title').textContent = p ? 'Editar cartera' : 'Nueva cartera';
  document.getElementById('finanzas-portfolio-id').value = p ? p.id : '';
  document.getElementById('finanzas-portfolio-name').value = p ? p.name : '';
  finanzasPortfolioColorField.setValue(p ? p.color : DEFAULT_EVENT_COLOR);
  populateFinanzasPortfolioSelects(p ? p.id : null);
  finanzasPortfolioParentField.setValue(p ? (p.parentId ? String(p.parentId) : '') : '');
  document.getElementById('finanzas-portfolio-modal').classList.remove('hidden');
}
function closeFinanzasPortfolioModal() {
  document.getElementById('finanzas-portfolio-modal').classList.add('hidden');
}
document.getElementById('btn-new-finanzas-portfolio').addEventListener('click', () => openFinanzasPortfolioModal(null));
document.getElementById('btn-cancel-finanzas-portfolio').addEventListener('click', closeFinanzasPortfolioModal);
document.getElementById('btn-close-finanzas-portfolio').addEventListener('click', closeFinanzasPortfolioModal);

function buildFinanzasPortfolioPathLabel(portfolioId) {
  const parts = [];
  let current = portfolioId;
  while (current != null) {
    const p = finanzasPortfolios.find((x) => x.id === current);
    if (!p) break;
    parts.unshift(p.name);
    current = p.parentId;
  }
  return parts.join(' / ');
}

function renderFinanzasPortfoliosList() {
  const list = document.getElementById('finanzas-portfolios-list');
  list.innerHTML = '';
  if (finanzasPortfolios.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavia no tienes carteras. Crea una arriba.</p>';
    return;
  }
  finanzasPortfolios.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'group-item';
    row.innerHTML = `
      <span class="color-dot" style="background-color: ${p.color}"></span>
      <span class="group-item-name">${escapeHtml(buildFinanzasPortfolioPathLabel(p.id))}</span>
      <div class="group-item-actions">
        <button type="button" class="secondary-btn" data-action="edit">Editar</button>
        <button type="button" class="danger-btn" data-action="delete">Eliminar</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openFinanzasPortfolioModal(p));
    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la cartera "${p.name}"? Sus activos y subcarteras se quedan sin ella, no se borran.`)) return;
      await api(`/api/finanzas-portfolios/${p.id}`, { method: 'DELETE' });
      await refreshFinanzasPortfoliosAndAssets();
    });
    list.appendChild(row);
  });
}

// Activos: modal propio (Nueva/Editar) -- nombre + cartera. Sin creacion
// inline desde el modal de transaccion (mismo criterio que cuentas/
// categorias): un activo nuevo se crea aqui y luego ya aparece en el
// selector "Activo" de "+ Inversión".
function openFinanzasAssetModal(a) {
  document.getElementById('finanzas-asset-modal-title').textContent = a ? 'Editar activo' : 'Nuevo activo';
  document.getElementById('finanzas-asset-id').value = a ? a.id : '';
  document.getElementById('finanzas-asset-name').value = a ? a.name : '';
  populateFinanzasPortfolioSelects(null);
  finanzasAssetPortfolioField.setValue(a && a.portfolioId ? String(a.portfolioId) : '');
  document.getElementById('finanzas-asset-modal').classList.remove('hidden');
}
function closeFinanzasAssetModal() {
  document.getElementById('finanzas-asset-modal').classList.add('hidden');
}
document.getElementById('btn-new-finanzas-asset').addEventListener('click', () => openFinanzasAssetModal(null));
document.getElementById('btn-cancel-finanzas-asset').addEventListener('click', closeFinanzasAssetModal);
document.getElementById('btn-close-finanzas-asset').addEventListener('click', closeFinanzasAssetModal);

function renderFinanzasAssetsList() {
  const list = document.getElementById('finanzas-assets-list');
  list.innerHTML = '';
  if (finanzasAssets.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavia no tienes activos. Crea uno arriba.</p>';
    return;
  }
  finanzasAssets.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'group-item';
    const portfolioLabel = a.portfolioId ? buildFinanzasPortfolioPathLabel(a.portfolioId) : 'Sin cartera';
    row.innerHTML = `
      <span class="group-item-name">${escapeHtml(a.name)} <span class="finanzas-account-type-badge">${escapeHtml(portfolioLabel)}</span></span>
      <div class="group-item-actions">
        <button type="button" class="secondary-btn" data-action="history">Ver evolución</button>
        <button type="button" class="secondary-btn" data-action="edit">Editar</button>
        <button type="button" class="danger-btn" data-action="delete">Eliminar</button>
      </div>
    `;
    row.querySelector('[data-action="history"]').addEventListener('click', () => openFinanzasAssetHistoryModal(a));
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openFinanzasAssetModal(a));
    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el activo "${a.name}"?`)) return;
      try {
        await api(`/api/finanzas-assets/${a.id}`, { method: 'DELETE' });
        await refreshFinanzasPortfoliosAndAssets();
      } catch (err) {
        alert(err.message);
      }
    });
    list.appendChild(row);
  });
}

async function refreshFinanzasPortfoliosAndAssets() {
  const previousIds = new Set(finanzasAssets.map((a) => a.id));
  await Promise.all([loadFinanzasPortfolios(), loadFinanzasAssets()]);
  // Un activo recien creado se marca en el arbol por defecto (mismo
  // criterio que "todos marcados" al abrir la pestaña por primera vez)
  // -- si no, aparecerian nuevos activos invisibles en la grafica hasta
  // que alguien se acordara de marcarlos a mano.
  finanzasAssets.forEach((a) => {
    if (!previousIds.has(a.id)) finanzasAssetTreeSelectedIds.add(a.id);
  });
  populateFinanzasPortfolioSelects(null);
  renderFinanzasPortfoliosList();
  renderFinanzasAssetsList();
  renderFinanzasAssetTree();
  await refreshFinanzasInvestmentTrendChart();
}

document.getElementById('finanzas-portfolio-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('finanzas-portfolio-id').value;
  const payload = {
    name: document.getElementById('finanzas-portfolio-name').value,
    color: finanzasPortfolioColorField.getValue(),
    parentId: finanzasPortfolioParentField.getValue() || null,
  };
  if (id) {
    await api(`/api/finanzas-portfolios/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/finanzas-portfolios', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeFinanzasPortfolioModal();
  await refreshFinanzasPortfoliosAndAssets();
});

document.getElementById('finanzas-asset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('finanzas-asset-id').value;
  const payload = {
    name: document.getElementById('finanzas-asset-name').value,
    portfolioId: finanzasAssetPortfolioField.getValue() || null,
  };
  if (id) {
    await api(`/api/finanzas-assets/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/finanzas-assets', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeFinanzasAssetModal();
  await refreshFinanzasPortfoliosAndAssets();
});

// Historial de un activo: actualizaciones MANUALES de precio/unidad
// ("para ir registrando su evolucion", con su margen de error asumido a
// proposito -- sin conectar a ninguna cotizacion en vivo, mismo
// criterio que el resto de Inversiones) + grafica de lineas nueva.
let currentFinanzasAssetHistoryId = null;

function openFinanzasAssetHistoryModal(asset) {
  currentFinanzasAssetHistoryId = asset.id;
  document.getElementById('finanzas-asset-history-title').textContent = `Evolución de precio — ${asset.name}`;
  document.getElementById('finanzas-asset-valuation-form').reset();
  finanzasAssetValuationDateField.setValue(new Date());
  document.getElementById('finanzas-asset-history-modal').classList.remove('hidden');
  refreshFinanzasAssetValuations();
}
function closeFinanzasAssetHistoryModal() {
  document.getElementById('finanzas-asset-history-modal').classList.add('hidden');
  currentFinanzasAssetHistoryId = null;
}
document.getElementById('btn-close-finanzas-asset-history').addEventListener('click', closeFinanzasAssetHistoryModal);

async function refreshFinanzasAssetValuations() {
  const valuations = await api(`/api/finanzas-assets/${currentFinanzasAssetHistoryId}/valuations`);
  const tbody = document.getElementById('finanzas-asset-valuations-tbody');
  tbody.innerHTML = '';
  if (valuations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-hint">Sin actualizaciones de precio todavia.</td></tr>';
  } else {
    valuations.forEach((v) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${v.date}</td>
        <td>${formatFinanzasAmount(v.pricePerUnit)}</td>
        <td>${v.notes ? escapeHtml(v.notes) : '—'}</td>
        <td></td>
      `;
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'danger-btn';
      deleteBtn.textContent = 'Borrar';
      deleteBtn.addEventListener('click', async () => {
        await api(`/api/finanzas-assets/valuations/${v.id}`, { method: 'DELETE' });
        await refreshFinanzasAssetValuations();
      });
      tr.lastElementChild.appendChild(deleteBtn);
      tbody.appendChild(tr);
    });
  }
  renderFinanzasAssetValuationChart(valuations);
}

document.getElementById('finanzas-asset-valuation-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    date: toDateKey(finanzasAssetValuationDateField.getValue()),
    pricePerUnit: document.getElementById('finanzas-asset-valuation-price').value,
    notes: document.getElementById('finanzas-asset-valuation-notes').value || null,
  };
  await api(`/api/finanzas-assets/${currentFinanzasAssetHistoryId}/valuations`, { method: 'POST', body: JSON.stringify(payload) });
  document.getElementById('finanzas-asset-valuation-form').reset();
  finanzasAssetValuationDateField.setValue(new Date());
  await refreshFinanzasAssetValuations();
});

// Grafica de lineas -- primera de este tipo en el proyecto (las demas
// graficas de Finanzas/Gimnasio son de barras). SVG a mano, sin
// libreria, reutilizando el tooltip compartido de las demas graficas de
// Finanzas (attachFinanzasChartTooltips). Se degrada con gracia: 0
// actualizaciones = mensaje vacio sin SVG, 1 sola = un punto suelto sin
// linea (no hay nada que conectar todavia), precios todos iguales = se
// fuerza un rango minimo para no dividir por cero.
function renderFinanzasAssetValuationChart(valuations) {
  const wrap = document.getElementById('finanzas-asset-history-chart');
  if (!valuations || valuations.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">Sin actualizaciones de precio todavia.</p>';
    return;
  }

  // La tabla se muestra mas reciente primero, pero la grafica necesita
  // ir de mas antiguo a mas reciente de izquierda a derecha.
  const sorted = [...valuations].sort((a, b) => a.date.localeCompare(b.date));
  const width = 480;
  const height = 160;
  const padding = 24;

  if (sorted.length === 1) {
    wrap.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="finanzas-trend-chart-svg" role="img" aria-label="Evolucion de precio">
        <circle cx="${width / 2}" cy="${height / 2}" r="4" fill="var(--accent)" data-tooltip="${escapeHtml(`${sorted[0].date}: ${formatFinanzasAmount(sorted[0].pricePerUnit)}`)}"></circle>
      </svg>
      <p class="hint">Todavia solo hay una actualizacion registrada -- la grafica de linea aparecera con la segunda.</p>`;
    attachFinanzasChartTooltips(wrap.querySelector('svg'));
    return;
  }

  const prices = sorted.map((v) => v.pricePerUnit);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1; // todos iguales -- evita dividir por cero
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  const coords = sorted.map((v, i) => ({
    x: padding + (i / (sorted.length - 1)) * usableWidth,
    y: padding + usableHeight - ((v.pricePerUnit - minPrice) / range) * usableHeight,
    v,
  }));

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const dots = coords
    .map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="var(--accent)" data-tooltip="${escapeHtml(`${c.v.date}: ${formatFinanzasAmount(c.v.pricePerUnit)}`)}"></circle>`)
    .join('');

  wrap.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="finanzas-trend-chart-svg" role="img" aria-label="Evolucion de precio">
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2"></path>
      ${dots}
    </svg>`;
  attachFinanzasChartTooltips(wrap.querySelector('svg'));
}

// --- Modal de ejercicio -------------------------------------------------
function openGymExerciseModal(exercise) {
  document.getElementById('gym-exercise-modal-title').textContent = exercise ? 'Editar ejercicio' : 'Nuevo ejercicio';
  document.getElementById('gym-exercise-id').value = exercise ? exercise.id : '';
  document.getElementById('gym-exercise-name').value = exercise ? exercise.name : '';
  document.getElementById('gym-exercise-muscle-group').value = exercise ? exercise.muscleGroup || '' : '';
  document.getElementById('btn-delete-gym-exercise').classList.toggle('hidden', !exercise);
  document.getElementById('gym-exercise-modal').classList.remove('hidden');
}
function closeGymExerciseModal() {
  document.getElementById('gym-exercise-modal').classList.add('hidden');
}
document.getElementById('btn-new-gym-exercise').addEventListener('click', () => openGymExerciseModal(null));
document.getElementById('btn-cancel-gym-exercise').addEventListener('click', closeGymExerciseModal);
document.getElementById('btn-close-gym-exercise').addEventListener('click', closeGymExerciseModal);

document.getElementById('gym-exercise-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('gym-exercise-id').value;
  const payload = {
    name: document.getElementById('gym-exercise-name').value,
    muscleGroup: document.getElementById('gym-exercise-muscle-group').value,
  };
  if (id) {
    await api(`/api/gym-exercises/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/gym-exercises', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeGymExerciseModal();
  await loadGymExercises();
  renderGymExercisesList();
});

document.getElementById('btn-delete-gym-exercise').addEventListener('click', async () => {
  const id = document.getElementById('gym-exercise-id').value;
  try {
    await api(`/api/gym-exercises/${id}`, { method: 'DELETE' });
  } catch (err) {
    alert(err.message);
    return;
  }
  closeGymExerciseModal();
  await loadGymExercises();
  renderGymExercisesList();
});

// --- Modal de rutina ------------------------------------------------------
// El color/icono usan createColorField/createIconField (definidas en
// settings.js, que se carga DESPUES de app.js) -- construirlas aqui
// arriba, al analizar el archivo, fallaria (esas funciones todavia no
// existirian). Por eso se crean la PRIMERA VEZ que se abre el modal
// (dentro de un handler, para entonces settings.js ya esta cargado del
// todo), no al arrancar la app -- mismo aviso que ya deja CLAUDE.md
// sobre el orden de declaracion entre los dos archivos.
let gymRoutineColorField = null;
let gymRoutineIconField = null;
// Ejercicios de la rutina que se esta editando ahora mismo en el modal
// -- se reconstruye el DOM entero cada vez que cambia (anadir/quitar
// una fila), mas simple que ir tocando filas sueltas.
let gymRoutineModalExercises = [];

function ensureGymRoutineFieldsReady() {
  if (gymRoutineColorField) return;
  gymRoutineColorField = createColorField({ initialValue: '#5b8cff' });
  document.getElementById('gym-routine-color-field').appendChild(gymRoutineColorField.element);
  gymRoutineIconField = createIconField({ initialValue: '' });
  document.getElementById('gym-routine-icon-field').appendChild(gymRoutineIconField.element);
}

// Construye las opciones <option> de un <select> nativo con la
// biblioteca de ejercicios -- se usa tanto en filas de rutina como de
// sesion. Nativo a proposito (no el select-field a medida): estas filas
// se repiten un numero variable de veces, y un <select> normal no
// necesita gestionar su propio popover por cada copia.
function gymExerciseOptionsHtml(selectedId) {
  return state.gymExercises
    .map((ex) => `<option value="${ex.id}" ${Number(selectedId) === ex.id ? 'selected' : ''}>${escapeHtml(ex.name)}</option>`)
    .join('');
}

function renderGymRoutineExercisesField() {
  const container = document.getElementById('gym-routine-exercises-field');
  container.innerHTML = '';
  if (gymRoutineModalExercises.length === 0) {
    container.innerHTML = '<p class="empty-hint">Todavia no has añadido ningun ejercicio.</p>';
    return;
  }
  gymRoutineModalExercises.forEach((row, index) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'gym-routine-exercise-row';
    rowEl.innerHTML = `
      <select data-field="exerciseId">${gymExerciseOptionsHtml(row.exerciseId)}</select>
      <input type="number" data-field="targetSets" placeholder="Series" min="0" value="${row.targetSets ?? ''}" />
      <input type="number" data-field="targetReps" placeholder="Reps" min="0" value="${row.targetReps ?? ''}" />
      <input type="number" data-field="targetRestSeconds" placeholder="Descanso (s)" min="0" value="${row.targetRestSeconds ?? ''}" />
      <button type="button" class="icon-btn" aria-label="Quitar ejercicio">✕</button>
    `;
    rowEl.querySelector('[data-field="exerciseId"]').addEventListener('change', (e) => {
      gymRoutineModalExercises[index].exerciseId = Number(e.target.value);
    });
    rowEl.querySelector('[data-field="targetSets"]').addEventListener('input', (e) => {
      gymRoutineModalExercises[index].targetSets = e.target.value;
    });
    rowEl.querySelector('[data-field="targetReps"]').addEventListener('input', (e) => {
      gymRoutineModalExercises[index].targetReps = e.target.value;
    });
    rowEl.querySelector('[data-field="targetRestSeconds"]').addEventListener('input', (e) => {
      gymRoutineModalExercises[index].targetRestSeconds = e.target.value;
    });
    rowEl.querySelector('button').addEventListener('click', () => {
      gymRoutineModalExercises.splice(index, 1);
      renderGymRoutineExercisesField();
    });
    container.appendChild(rowEl);
  });
}

document.getElementById('btn-add-gym-routine-exercise').addEventListener('click', () => {
  if (state.gymExercises.length === 0) {
    alert('Primero crea al menos un ejercicio en la lista de abajo.');
    return;
  }
  gymRoutineModalExercises.push({ exerciseId: state.gymExercises[0].id, targetSets: '', targetReps: '', targetRestSeconds: '' });
  renderGymRoutineExercisesField();
});

function openGymRoutineModal(routine) {
  ensureGymRoutineFieldsReady();
  document.getElementById('gym-routine-modal-title').textContent = routine ? 'Editar rutina' : 'Nueva rutina';
  document.getElementById('gym-routine-id').value = routine ? routine.id : '';
  document.getElementById('gym-routine-name').value = routine ? routine.name : '';
  gymRoutineColorField.setValue(routine ? routine.color : '#5b8cff');
  gymRoutineIconField.setValue(routine ? routine.icon || '' : '');
  gymRoutineModalExercises = routine
    ? routine.exercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        targetSets: ex.targetSets ?? '',
        targetReps: ex.targetReps ?? '',
        targetRestSeconds: ex.targetRestSeconds ?? '',
      }))
    : [];
  renderGymRoutineExercisesField();
  document.getElementById('btn-delete-gym-routine').classList.toggle('hidden', !routine);
  document.getElementById('gym-routine-modal').classList.remove('hidden');
}
function closeGymRoutineModal() {
  document.getElementById('gym-routine-modal').classList.add('hidden');
}
document.getElementById('btn-new-gym-routine').addEventListener('click', () => openGymRoutineModal(null));
document.getElementById('btn-cancel-gym-routine').addEventListener('click', closeGymRoutineModal);
document.getElementById('btn-close-gym-routine').addEventListener('click', closeGymRoutineModal);

document.getElementById('gym-routine-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('gym-routine-id').value;
  const payload = {
    name: document.getElementById('gym-routine-name').value,
    color: gymRoutineColorField.getValue(),
    icon: gymRoutineIconField.getValue(),
    exercises: gymRoutineModalExercises,
  };
  if (id) {
    await api(`/api/gym-routines/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/gym-routines', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeGymRoutineModal();
  await loadGymRoutines();
  renderGymRoutinesList();
});

document.getElementById('btn-delete-gym-routine').addEventListener('click', async () => {
  const id = document.getElementById('gym-routine-id').value;
  await api(`/api/gym-routines/${id}`, { method: 'DELETE' });
  closeGymRoutineModal();
  await Promise.all([loadGymRoutines(), loadGymSessions()]);
  renderGymRoutinesList();
  renderGymSessionsList();
});

// --- Modal de sesion --------------------------------------------------
// Fecha con el mismo campo que eventos/tareas (createDateField, definida
// en este mismo archivo mas arriba, sin problema de orden). La rutina
// usa createSelectField (tambien de este archivo) -- a diferencia del
// color/icono de arriba, esta si se puede construir ya, al analizar el
// archivo.
const gymSessionDateField = createDateField({ initialValue: new Date() });
document.getElementById('gym-session-date-field').appendChild(gymSessionDateField.element);

const gymSessionRoutineField = createSelectField({
  options: [{ value: '', label: 'Sesion libre (sin rutina)' }],
  initialValue: '',
  onChange: (routineId) => {
    if (!routineId) return;
    const routine = state.gymRoutines.find((r) => r.id === Number(routineId));
    // Auto-rellena los ejercicios esperados de la rutina elegida -- SOLO
    // si la lista de ejercicios de la sesion todavia esta vacia, para no
    // pisar series que ya se hubieran anadido a mano.
    if (routine && gymSessionModalExercises.length === 0) {
      // Auto-rellena tambien las series de cada ejercicio, no solo el
      // ejercicio en si (pedido explicito de Koku) -- una fila en blanco
      // por cada target_sets de la rutina (o 1 si la rutina no fijo
      // series). Solo el DESCANSO se precarga desde la rutina -- Koku
      // pidio explicitamente que las repeticiones se dejen en blanco
      // ("con eso iremos mas tarde"), y el peso tampoco tiene de donde
      // salir (la rutina no guarda ningun peso orientativo).
      gymSessionModalExercises = routine.exercises.map((ex) => {
        const setsCount = ex.targetSets && ex.targetSets > 0 ? ex.targetSets : 1;
        return {
          exerciseId: ex.exerciseId,
          sets: Array.from({ length: setsCount }, () => ({
            reps: '',
            weightDisplay: '',
            restSeconds: ex.targetRestSeconds ?? '',
          })),
        };
      });
      renderGymSessionExercisesField();
    }
  },
});
document.getElementById('gym-session-routine-field').appendChild(gymSessionRoutineField.element);

// Ejercicios de la sesion que se esta editando, cada uno con SU PROPIA
// lista de series ya hechas (reps+peso). A diferencia de una rutina
// (solo sugiere series/reps), aqui se registran las series de verdad,
// una a una.
let gymSessionModalExercises = [];

function renderGymSessionExercisesField() {
  const container = document.getElementById('gym-session-exercises-field');
  container.innerHTML = '';
  if (gymSessionModalExercises.length === 0) {
    container.innerHTML = '<p class="empty-hint">Todavia no has añadido ningun ejercicio a esta sesion.</p>';
    return;
  }
  gymSessionModalExercises.forEach((exRow, exIndex) => {
    const block = document.createElement('div');
    block.className = 'gym-session-exercise-block';

    const header = document.createElement('div');
    header.className = 'gym-routine-exercise-row';
    header.innerHTML = `
      <select data-field="exerciseId">${gymExerciseOptionsHtml(exRow.exerciseId)}</select>
      <button type="button" class="icon-btn" aria-label="Quitar ejercicio">✕</button>
    `;
    header.querySelector('[data-field="exerciseId"]').addEventListener('change', (e) => {
      gymSessionModalExercises[exIndex].exerciseId = Number(e.target.value);
    });
    header.querySelector('button').addEventListener('click', () => {
      gymSessionModalExercises.splice(exIndex, 1);
      renderGymSessionExercisesField();
    });
    block.appendChild(header);

    const setsList = document.createElement('div');
    setsList.className = 'gym-session-sets-list';
    exRow.sets.forEach((set, setIndex) => {
      const setRow = document.createElement('div');
      setRow.className = 'gym-session-set-row';
      setRow.innerHTML = `
        <span class="gym-session-set-number">Serie ${setIndex + 1}</span>
        <input type="number" data-field="reps" placeholder="Reps" min="0" value="${set.reps ?? ''}" />
        <input type="number" data-field="weight" placeholder="Peso (${getGymWeightUnitLabel()})" min="0" step="0.5" value="${set.weightDisplay ?? ''}" />
        <input type="number" data-field="restSeconds" placeholder="Descanso (s)" min="0" value="${set.restSeconds ?? ''}" />
        <button type="button" class="icon-btn" aria-label="Quitar serie">✕</button>
      `;
      setRow.querySelector('[data-field="reps"]').addEventListener('input', (e) => {
        set.reps = e.target.value;
      });
      setRow.querySelector('[data-field="weight"]').addEventListener('input', (e) => {
        set.weightDisplay = e.target.value;
      });
      setRow.querySelector('[data-field="restSeconds"]').addEventListener('input', (e) => {
        set.restSeconds = e.target.value;
      });
      setRow.querySelector('button').addEventListener('click', () => {
        exRow.sets.splice(setIndex, 1);
        renderGymSessionExercisesField();
      });
      setsList.appendChild(setRow);
    });
    block.appendChild(setsList);

    const addSetBtn = document.createElement('button');
    addSetBtn.type = 'button';
    addSetBtn.className = 'secondary-btn gym-add-set-btn';
    addSetBtn.textContent = '+ Serie';
    addSetBtn.addEventListener('click', () => {
      // El descanso se hereda de la ultima serie de este mismo ejercicio
      // (suele ser el mismo entre series seguidas) -- reps/peso se dejan
      // en blanco, varian serie a serie.
      const lastSet = exRow.sets[exRow.sets.length - 1];
      exRow.sets.push({ reps: '', weightDisplay: '', restSeconds: lastSet ? lastSet.restSeconds : '' });
      renderGymSessionExercisesField();
    });
    block.appendChild(addSetBtn);

    container.appendChild(block);
  });
}

document.getElementById('btn-add-gym-session-exercise').addEventListener('click', () => {
  if (state.gymExercises.length === 0) {
    alert('Primero crea al menos un ejercicio desde la pestaña Rutinas.');
    return;
  }
  gymSessionModalExercises.push({ exerciseId: state.gymExercises[0].id, sets: [{ reps: '', weightDisplay: '', restSeconds: '' }] });
  renderGymSessionExercisesField();
});

function openGymSessionModal(session) {
  document.getElementById('gym-session-modal-title').textContent = session ? 'Editar sesion' : 'Nueva sesion';
  document.getElementById('gym-session-id').value = session ? session.id : '';
  gymSessionDateField.setValue(session ? new Date(`${session.date}T00:00:00`) : new Date());
  document.getElementById('gym-session-notes').value = session ? session.notes || '' : '';

  gymSessionRoutineField.setOptions([
    { value: '', label: 'Sesion libre (sin rutina)' },
    ...state.gymRoutines.map((r) => ({ value: String(r.id), label: r.name, color: r.color, icon: r.icon })),
  ]);
  gymSessionRoutineField.setValue(session && session.routineId ? String(session.routineId) : '');

  if (session) {
    // Reagrupa las series planas que devuelve el servidor (una fila por
    // serie) en un bloque por ejercicio, tal y como lo edita el modal.
    const byExercise = new Map();
    session.sets.forEach((set) => {
      if (!byExercise.has(set.exerciseId)) byExercise.set(set.exerciseId, []);
      byExercise.get(set.exerciseId).push({
        reps: set.reps ?? '',
        weightDisplay: gymWeightKgToDisplay(set.weightKg),
        restSeconds: set.restSeconds ?? '',
      });
    });
    gymSessionModalExercises = [...byExercise.entries()].map(([exerciseId, sets]) => ({ exerciseId, sets }));
  } else {
    gymSessionModalExercises = [];
  }
  renderGymSessionExercisesField();

  document.getElementById('btn-delete-gym-session').classList.toggle('hidden', !session);
  document.getElementById('gym-session-modal').classList.remove('hidden');
}
function closeGymSessionModal() {
  document.getElementById('gym-session-modal').classList.add('hidden');
}
document.getElementById('btn-new-gym-session').addEventListener('click', () => openGymSessionModal(null));
document.getElementById('btn-cancel-gym-session').addEventListener('click', closeGymSessionModal);
document.getElementById('btn-close-gym-session').addEventListener('click', closeGymSessionModal);

document.getElementById('gym-session-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('gym-session-id').value;
  const dateValue = gymSessionDateField.getValue();
  // Aplana los bloques por ejercicio en la lista de series sueltas que
  // espera el servidor -- el orden dentro de cada exerciseId es lo que
  // decide el numero de serie (ver replaceSessionSets en
  // routes/gymSessions.js), asi que se manda tal cual esta en pantalla.
  const sets = [];
  gymSessionModalExercises.forEach((exRow) => {
    exRow.sets.forEach((set) => {
      sets.push({
        exerciseId: exRow.exerciseId,
        reps: set.reps,
        weightKg: gymWeightDisplayToKg(set.weightDisplay),
        restSeconds: set.restSeconds,
      });
    });
  });
  const payload = {
    date: toDateKey(dateValue),
    routineId: gymSessionRoutineField.getValue() || null,
    notes: document.getElementById('gym-session-notes').value,
    sets,
  };
  if (id) {
    await api(`/api/gym-sessions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/gym-sessions', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeGymSessionModal();
  await loadGymSessions();
  renderGymSessionsList();
  populateGymProgressExerciseSelect();
});

document.getElementById('btn-delete-gym-session').addEventListener('click', async () => {
  const id = document.getElementById('gym-session-id').value;
  await api(`/api/gym-sessions/${id}`, { method: 'DELETE' });
  closeGymSessionModal();
  await loadGymSessions();
  renderGymSessionsList();
  populateGymProgressExerciseSelect();
});

// --- Progreso: grafica SVG a mano ---------------------------------------
// No hay ninguna libreria de graficas en el proyecto (a proposito, ver
// CLAUDE.md/plan de Gimnasio: "sin build ni framework") -- un SVG
// generado a mano es de sobra para una linea sencilla con pocos puntos.
const gymProgressExerciseField = createSelectField({
  options: [],
  initialValue: '',
  placeholder: 'Elige un ejercicio',
  onChange: (id) => renderGymProgressChart(id ? Number(id) : null),
});
document.getElementById('gym-progress-exercise-field').appendChild(gymProgressExerciseField.element);

let gymProgressMetric = 'max'; // 'max' = peso maximo por sesion, 'volume' = suma reps*peso
document.querySelectorAll('[data-gym-metric]').forEach((btn) => {
  btn.addEventListener('click', () => {
    gymProgressMetric = btn.dataset.gymMetric;
    document.querySelectorAll('[data-gym-metric]').forEach((b) => b.classList.toggle('active', b === btn));
    const exerciseId = gymProgressExerciseField.getValue();
    renderGymProgressChart(exerciseId ? Number(exerciseId) : null);
  });
});

function populateGymProgressExerciseSelect() {
  gymProgressExerciseField.setOptions(state.gymExercises.map((ex) => ({ value: String(ex.id), label: ex.name })));
  const current = gymProgressExerciseField.getValue();
  const stillExists = state.gymExercises.some((ex) => String(ex.id) === current);
  const nextValue = stillExists ? current : (state.gymExercises[0] ? String(state.gymExercises[0].id) : '');
  gymProgressExerciseField.setValue(nextValue);
  renderGymProgressChart(nextValue ? Number(nextValue) : null);
}

async function renderGymProgressChart(exerciseId) {
  const container = document.getElementById('gym-progress-chart');
  if (!exerciseId) {
    container.innerHTML = '<p class="empty-hint">Crea un ejercicio y registra alguna sesion para ver su progreso.</p>';
    return;
  }
  const points = await api(`/api/gym-sessions/progress/${exerciseId}`);
  if (points.length === 0) {
    container.innerHTML = '<p class="empty-hint">Todavia no hay sesiones registradas para este ejercicio.</p>';
    return;
  }

  const unit = getGymWeightUnitLabel();
  const isVolume = gymProgressMetric === 'volume';
  const values = points.map((p) => {
    const raw = isVolume ? p.volumeKg : p.maxWeightKg;
    return gymWeightKgToDisplay(raw) || 0;
  });
  const maxValue = Math.max(...values, 1);

  const width = 600;
  const height = 220;
  const padding = 32;
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const coords = values.map((v, i) => ({
    x: points.length > 1 ? padding + i * stepX : width / 2,
    y: height - padding - (v / maxValue) * (height - padding * 2),
  }));

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  // data-tooltip + attachFinanzasChartTooltips() en vez de un <title> SVG
  // nativo -- el <title> nativo tarda lo tipico del navegador en salir y
  // Koku no queria "la fecha por defecto" (mismo motivo por el que ya se
  // quito de la grafica de Evolucion mensual de Finanzas, ver el
  // comentario junto a attachFinanzasChartTooltips mas abajo).
  const dots = coords
    .map((c, i) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" fill="var(--accent)" data-tooltip="${escapeHtml(`${formatGymDate(points[i].date)}: ${values[i]} ${unit}`)}"></circle>`)
    .join('');
  // Solo se etiquetan la primera, la ultima, y todas si hay pocos puntos
  // -- con muchas sesiones, poner una fecha bajo cada punto se solapa.
  const labels = points
    .map((p, i) => {
      if (points.length > 6 && i !== 0 && i !== points.length - 1) return '';
      return `<text x="${coords[i].x.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="gym-chart-label">${formatGymDate(p.date)}</text>`;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="gym-chart-svg" role="img" aria-label="Progreso de ${isVolume ? 'volumen' : 'peso maximo'}">
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" />
      ${dots}
      ${labels}
    </svg>
    <p class="hint">${isVolume ? 'Volumen (repeticiones × peso)' : 'Peso maximo'} por sesion, en ${unit}${isVolume ? ' (suma de todas las series)' : ''}. Pasa el raton por un punto para ver la fecha exacta.</p>
  `;
  attachFinanzasChartTooltips(container.querySelector('svg'));
}

function renderFinanzasCategoriesList() {
  const list = document.getElementById('finanzas-categories-list');
  list.innerHTML = '';
  if (finanzasCategories.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavia no tienes categorías. Crea una arriba.</p>';
    return;
  }
  finanzasCategories.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'group-item';
    row.innerHTML = `
      <span class="color-dot" style="background-color: ${c.color}"></span>
      <span class="group-item-name">${c.icon ? escapeHtml(c.icon) + ' ' : ''}${escapeHtml(c.name)}</span>
      <div class="group-item-actions">
        <button type="button" class="secondary-btn" data-action="edit">Editar</button>
        <button type="button" class="danger-btn" data-action="delete">Eliminar</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener('click', () => {
      document.getElementById('finanzas-category-id').value = c.id;
      document.getElementById('finanzas-category-name').value = c.name;
      finanzasCategoryIconField.setValue(c.icon || '');
      finanzasCategoryColorField.setValue(c.color);
      document.getElementById('btn-cancel-finanzas-category').classList.remove('hidden');
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la categoría "${c.name}"? Los movimientos que la usen se quedaran sin categoría.`)) return;
      await api(`/api/finanzas-categories/${c.id}`, { method: 'DELETE' });
      await refreshFinanzasAccountsAndCategories();
      await refreshFinanzasTransactionsTab();
    });
    list.appendChild(row);
  });
}

async function refreshFinanzasAccountsAndCategories() {
  await Promise.all([loadFinanzasAccounts(), loadFinanzasCategories()]);
  populateFinanzasSelects();
  renderFinanzasAccountsList();
  renderFinanzasCategoriesList();
}

document.getElementById('btn-cancel-finanzas-category').addEventListener('click', resetFinanzasCategoryForm);

document.getElementById('finanzas-account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('finanzas-account-id').value;
  const payload = {
    name: document.getElementById('finanzas-account-name').value,
    icon: finanzasAccountIconField.getValue() || null,
    color: finanzasAccountColorField.getValue(),
    initialBalance: document.getElementById('finanzas-account-initial-balance').value || 0,
    type: finanzasAccountTypeField.getValue() || null,
  };
  if (id) {
    await api(`/api/finanzas-accounts/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/finanzas-accounts', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeFinanzasAccountModal();
  await refreshFinanzasAccountsAndCategories();
  renderFinanzasResumenTab();
});

document.getElementById('finanzas-category-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('finanzas-category-id').value;
  const payload = {
    name: document.getElementById('finanzas-category-name').value,
    icon: finanzasCategoryIconField.getValue() || null,
    color: finanzasCategoryColorField.getValue(),
  };
  if (id) {
    await api(`/api/finanzas-categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/finanzas-categories', { method: 'POST', body: JSON.stringify(payload) });
  }
  resetFinanzasCategoryForm();
  await refreshFinanzasAccountsAndCategories();
});

// -- Pestaña Resumen: saldo por cuenta, progreso del limite mensual, y
//    desglose del gasto de este mes por categoria. --
function renderFinanzasAccountsSummary() {
  const wrap = document.getElementById('finanzas-accounts-summary');
  wrap.innerHTML = '';
  if (finanzasAccounts.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">Todavia no tienes cuentas. Crealas en la pestaña Movimientos.</p>';
    return;
  }
  finanzasAccounts.forEach((a) => {
    const card = document.createElement('div');
    card.className = 'finanzas-account-card';
    card.innerHTML = `
      <span class="finanzas-account-card-name">${a.icon ? escapeHtml(a.icon) + ' ' : ''}${escapeHtml(a.name)}${a.type ? ` <span class="finanzas-account-type-badge">${escapeHtml(a.type)}</span>` : ''}</span>
      <span class="finanzas-account-card-balance${a.balance < 0 ? ' negative' : ''}">${formatFinanzasAmount(a.balance)}</span>
    `;
    wrap.appendChild(card);
  });
}

// Grafica de "Evolucion mensual" (ingresos vs gastos, ultimos N meses):
// SVG construido a mano, sin ninguna libreria (mismo criterio que ya usa
// el proyecto para graficas, ver renderGymProgressChart en la rama
// gimnasio). Cuenta TODOS los gastos del mes, no solo los que tienen
// countsTowardBudget=1 -- es una vista de flujo de caja real, distinta
// del progreso contra el limite mensual de arriba.
const FINANZAS_MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Tooltip generico para las graficas SVG de Finanzas (barras) -- un UNICO
// div compartido (no uno por grafica ni por barra), reposicionado
// siguiendo al raton via clientX/clientY (asi no hace falta convertir
// coordenadas del viewBox del SVG a pixeles reales). Sustituye a los
// <title> nativos que tenia la grafica de evolucion mensual (con el
// retraso tipico del navegador, y sin nada en movil/tactil) -- Koku dijo
// que "no era nada orientativo". Reutilizado tambien por la grafica
// nueva de Inversiones.
let finanzasChartTooltipEl = null;
function getFinanzasChartTooltip() {
  if (!finanzasChartTooltipEl) {
    finanzasChartTooltipEl = document.createElement('div');
    finanzasChartTooltipEl.className = 'finanzas-chart-tooltip hidden';
    document.body.appendChild(finanzasChartTooltipEl);
  }
  return finanzasChartTooltipEl;
}
// Se llama tras pintar cada grafica -- busca cualquier elemento con
// data-tooltip dentro del SVG y le engancha los listeners. Los rects de
// barras ya renderizados no se reutilizan entre repintados (wrap.innerHTML
// se reescribe entero cada vez), asi que no hace falta quitar listeners
// viejos.
function attachFinanzasChartTooltips(svgEl) {
  if (!svgEl) return;
  const tooltip = getFinanzasChartTooltip();
  svgEl.querySelectorAll('[data-tooltip]').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      tooltip.textContent = el.dataset.tooltip;
      tooltip.classList.remove('hidden');
    });
    el.addEventListener('mousemove', (e) => {
      tooltip.style.left = `${e.clientX + 14}px`;
      tooltip.style.top = `${e.clientY + 14}px`;
    });
    el.addEventListener('mouseleave', () => {
      tooltip.classList.add('hidden');
    });
  });
}

function renderFinanzasMonthlyTrendChart(data) {
  const wrap = document.getElementById('finanzas-monthly-trend-chart');
  if (!data || data.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">Sin datos todavia.</p>';
    return;
  }

  const maxValue = Math.max(1, ...data.flatMap((d) => [d.totalIncome, d.totalExpense]));
  const chartHeight = 160;
  const barWidth = 14;
  const barGap = 4;
  const groupWidth = barWidth * 2 + barGap;
  const groupGap = 14;
  const svgWidth = data.length * (groupWidth + groupGap) + groupGap;
  const svgHeight = chartHeight + 30;

  let bars = '';
  data.forEach((d, i) => {
    const groupX = groupGap + i * (groupWidth + groupGap);
    const incomeH = (d.totalIncome / maxValue) * chartHeight;
    const expenseH = (d.totalExpense / maxValue) * chartHeight;
    const [year, monthNum] = d.month.split('-');
    const label = FINANZAS_MONTH_ABBR[Number(monthNum) - 1];
    bars += `
      <rect x="${groupX}" y="${chartHeight - incomeH}" width="${barWidth}" height="${incomeH}" fill="#43aa8b" data-tooltip="${escapeHtml(`${label} ${year}: ingresos ${formatFinanzasAmount(d.totalIncome)}`)}"></rect>
      <rect x="${groupX + barWidth + barGap}" y="${chartHeight - expenseH}" width="${barWidth}" height="${expenseH}" fill="#e63946" data-tooltip="${escapeHtml(`${label} ${year}: gastos ${formatFinanzasAmount(d.totalExpense)}`)}"></rect>
      <text x="${groupX + barWidth + barGap / 2}" y="${chartHeight + 18}" text-anchor="middle" class="finanzas-trend-chart-label">${label}</text>
    `;
  });

  wrap.innerHTML = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="finanzas-trend-chart-svg" role="img" aria-label="Evolucion mensual de ingresos y gastos">
      <line x1="0" y1="${chartHeight}" x2="${svgWidth}" y2="${chartHeight}" class="finanzas-trend-chart-axis" />
      ${bars}
    </svg>
    <div class="finanzas-trend-chart-legend">
      <span><span class="finanzas-trend-legend-dot" style="background:#43aa8b"></span> Ingresos</span>
      <span><span class="finanzas-trend-legend-dot" style="background:#e63946"></span> Gastos</span>
    </div>
  `;
  attachFinanzasChartTooltips(wrap.querySelector('svg'));
}

// Vista mensual del bloque "Ahorro": a diferencia del resto de la
// pestaña Resumen (siempre "este mes"), aqui se puede elegir cualquier
// mes/año con el selector + flechas de arriba. El objetivo minimo
// sigue siendo un unico ajuste global (no cambia segun el mes que se
// mire aqui) -- por eso se compara con summary.savingsGoalMin, que ya
// viene igual sea cual sea el mes pedido.
async function renderFinanzasSavingsMonthly() {
  const month = finanzasSavingsMonthField.getValue();
  const year = document.getElementById('finanzas-savings-year-input').value || finanzasCurrentYear;
  const summary = await api(`/api/finanzas-transactions/summary/month?month=${year}-${month}`);
  const statusWrap = document.getElementById('finanzas-savings-status');
  const goal = summary.savingsGoalMin;
  let statusHtml = `<span class="finanzas-savings-status-text">Ese mes ahorraste ${formatFinanzasAmount(summary.savings)}.</span>`;
  if (goal) {
    const met = summary.savings >= goal;
    statusHtml += ` <span class="finanzas-savings-status-text ${met ? 'met' : 'not-met'}">${met ? `✓ Cumples el objetivo (${formatFinanzasAmount(goal)})` : `✕ Por debajo del objetivo (${formatFinanzasAmount(goal)}), faltan ${formatFinanzasAmount(goal - summary.savings)}`}</span>`;
  }
  statusWrap.innerHTML = statusHtml;
}

function shiftFinanzasSavingsMonth(delta) {
  const month = Number(finanzasSavingsMonthField.getValue());
  const yearInput = document.getElementById('finanzas-savings-year-input');
  let year = Number(yearInput.value) || finanzasCurrentYear;
  let newMonth = month + delta;
  if (newMonth < 1) { newMonth = 12; year -= 1; }
  else if (newMonth > 12) { newMonth = 1; year += 1; }
  finanzasSavingsMonthField.setValue(String(newMonth).padStart(2, '0'));
  yearInput.value = year;
  renderFinanzasSavingsMonthly();
}
document.getElementById('btn-finanzas-savings-month-prev').addEventListener('click', () => shiftFinanzasSavingsMonth(-1));
document.getElementById('btn-finanzas-savings-month-next').addEventListener('click', () => shiftFinanzasSavingsMonth(1));
document.getElementById('finanzas-savings-year-input').addEventListener('change', () => renderFinanzasSavingsMonthly());

function setFinanzasSavingsView(view) {
  document.getElementById('btn-finanzas-savings-view-monthly').classList.toggle('active', view === 'monthly');
  document.getElementById('btn-finanzas-savings-view-historic').classList.toggle('active', view === 'historic');
  document.getElementById('finanzas-savings-monthly-view').classList.toggle('hidden', view !== 'monthly');
  document.getElementById('finanzas-savings-historic-view').classList.toggle('hidden', view !== 'historic');
}
document.getElementById('btn-finanzas-savings-view-monthly').addEventListener('click', () => setFinanzasSavingsView('monthly'));
document.getElementById('btn-finanzas-savings-view-historic').addEventListener('click', () => setFinanzasSavingsView('historic'));

document.getElementById('btn-finanzas-savings-range-view').addEventListener('click', async () => {
  const fromMonth = finanzasSavingsRangeFromMonthField.getValue();
  const fromYear = document.getElementById('finanzas-savings-range-from-year').value || finanzasCurrentYear;
  const toMonth = finanzasSavingsRangeToMonthField.getValue();
  const toYear = document.getElementById('finanzas-savings-range-to-year').value || finanzasCurrentYear;
  const tbody = document.getElementById('finanzas-savings-history-tbody');
  let rows;
  try {
    rows = await api(`/api/finanzas-transactions/summary/range?from=${fromYear}-${fromMonth}&to=${toYear}-${toMonth}`);
  } catch (err) {
    alert(err.message);
    return;
  }
  tbody.innerHTML = '';
  rows.forEach((r) => {
    const [y, m] = r.month.split('-');
    const met = r.savingsGoalMin ? r.savings >= r.savingsGoalMin : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${FINANZAS_MONTH_NAMES[Number(m) - 1]} ${y}</td>
      <td>${formatFinanzasAmount(r.savings)}</td>
      <td>${r.savingsGoalMin ? formatFinanzasAmount(r.savingsGoalMin) : '—'}</td>
      <td>${met === null ? '—' : met ? '✓' : '✕'}</td>
    `;
    tbody.appendChild(tr);
  });
});

async function renderFinanzasResumenTab() {
  renderFinanzasAccountsSummary();
  const [summary, trend] = await Promise.all([
    api('/api/finanzas-transactions/summary/month'),
    api('/api/finanzas-transactions/summary/monthly-trend'),
  ]);
  renderFinanzasMonthlyTrendChart(trend);

  document.getElementById('finanzas-budget-input').value = summary.monthlyBudgetLimit ?? '';

  const progressWrap = document.getElementById('finanzas-budget-progress');
  if (summary.monthlyBudgetLimit) {
    const pct = Math.min(100, (summary.totalExpense / summary.monthlyBudgetLimit) * 100);
    const over = summary.totalExpense > summary.monthlyBudgetLimit;
    progressWrap.innerHTML = `
      <div class="finanzas-budget-progress-bar">
        <div class="finanzas-budget-progress-fill${over ? ' over-budget' : ''}" style="width: ${pct}%"></div>
      </div>
      <div class="finanzas-budget-progress-text">${formatFinanzasAmount(summary.totalExpense)} de ${formatFinanzasAmount(summary.monthlyBudgetLimit)}${over ? ' — ¡límite superado!' : ''}</div>
    `;
  } else {
    progressWrap.innerHTML = `<div class="finanzas-budget-progress-text">Sin límite configurado. Gastado este mes: ${formatFinanzasAmount(summary.totalExpense)}. Ingresado: ${formatFinanzasAmount(summary.totalIncome)}.</div>`;
  }

  document.getElementById('finanzas-savings-goal-input').value = summary.savingsGoalMin ?? '';
  // El aviso de "objetivo poco realista" solo tiene sentido justo tras
  // guardar (ver el listener de btn-save-finanzas-savings-goal, que lo
  // rellena de nuevo si la respuesta lo trae) -- en cualquier otro
  // refresco de la pestaña se oculta, para no dejar un aviso viejo. El
  // texto de "cuanto se ha ahorrado" vive ahora en
  // renderFinanzasSavingsMonthly() (vista mensual, con su propio
  // selector de mes -- ver mas abajo), no aqui.
  document.getElementById('finanzas-savings-warning').classList.add('hidden');
  await renderFinanzasSavingsMonthly();

  const breakdownList = document.getElementById('finanzas-category-breakdown-list');
  breakdownList.innerHTML = '';
  if (summary.byCategory.length === 0 && summary.uncategorizedExpense === 0) {
    breakdownList.innerHTML = '<p class="empty-hint">Sin gastos este mes todavia.</p>';
  } else {
    summary.byCategory.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'finanzas-category-breakdown-row';
      row.innerHTML = `
        <span class="color-dot" style="background-color: ${c.categoryColor}"></span>
        <span>${c.categoryIcon ? escapeHtml(c.categoryIcon) + ' ' : ''}${escapeHtml(c.categoryName)}</span>
        <span class="finanzas-category-breakdown-row-amount">${formatFinanzasAmount(c.total)}</span>
      `;
      breakdownList.appendChild(row);
    });
    if (summary.uncategorizedExpense > 0) {
      const row = document.createElement('div');
      row.className = 'finanzas-category-breakdown-row';
      row.innerHTML = `
        <span class="color-dot" style="background-color: #999"></span>
        <span>Sin categoría</span>
        <span class="finanzas-category-breakdown-row-amount">${formatFinanzasAmount(summary.uncategorizedExpense)}</span>
      `;
      breakdownList.appendChild(row);
    }
  }
}

document.getElementById('btn-save-finanzas-budget').addEventListener('click', async () => {
  const value = document.getElementById('finanzas-budget-input').value;
  await api('/api/finanzas-settings', { method: 'PUT', body: JSON.stringify({ monthlyBudgetLimit: value || null }) });
  renderFinanzasResumenTab();
});

document.getElementById('btn-save-finanzas-savings-goal').addEventListener('click', async () => {
  const value = document.getElementById('finanzas-savings-goal-input').value;
  const result = await api('/api/finanzas-settings', { method: 'PUT', body: JSON.stringify({ savingsGoalMin: value || null }) });
  // renderFinanzasResumenTab() oculta este aviso al principio (para no
  // dejar uno viejo en refrescos normales) -- por eso se rellena DESPUES
  // de que termine, no antes.
  await renderFinanzasResumenTab();
  if (result.warning) {
    const warningWrap = document.getElementById('finanzas-savings-warning');
    warningWrap.textContent = result.warning;
    warningWrap.classList.remove('hidden');
  }
});

// -- Pestaña Movimientos: filtros + tabla de gastos/ingresos. --
function finanzasAccountName(id) {
  const a = finanzasAccounts.find((x) => x.id === Number(id));
  return a ? `${a.icon ? a.icon + ' ' : ''}${a.name}` : '—';
}
function finanzasCategoryName(id) {
  if (!id) return '—';
  const c = finanzasCategories.find((x) => x.id === Number(id));
  return c ? `${c.icon ? c.icon + ' ' : ''}${c.name}` : '—';
}

async function refreshFinanzasTransactionsTab() {
  const params = new URLSearchParams();
  if (finanzasFilters.accountId) params.set('accountId', finanzasFilters.accountId);
  if (finanzasFilters.categoryId) params.set('categoryId', finanzasFilters.categoryId);
  if (finanzasFilters.type) params.set('type', finanzasFilters.type);
  if (finanzasFilters.from) params.set('from', finanzasFilters.from);
  if (finanzasFilters.to) params.set('to', finanzasFilters.to);
  const qs = params.toString();
  const transactions = await api(`/api/finanzas-transactions${qs ? '?' + qs : ''}`);

  const tbody = document.getElementById('finanzas-transactions-tbody');
  tbody.innerHTML = '';
  if (transactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-hint">Sin movimientos con estos filtros.</td></tr>';
    return;
  }
  transactions.forEach((t) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.date}</td>
      <td>${escapeHtml(finanzasAccountName(t.accountId))}</td>
      <td>${t.type === 'expense' ? 'Gasto' : 'Ingreso'}</td>
      <td>${escapeHtml(finanzasCategoryName(t.categoryId))}</td>
      <td>${escapeHtml(t.description || '')}</td>
      <td class="finanzas-amount-${t.type}">${t.type === 'expense' ? '-' : '+'}${formatFinanzasAmount(t.amount)}</td>
      <td>${t.type === 'expense' ? (t.countsTowardBudget ? 'Sí' : 'No') : '—'}</td>
      <td></td>
    `;
    const actionsTd = tr.lastElementChild;
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary-btn';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', () => openFinanzasTransactionModal(t));
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger-btn';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este movimiento?')) return;
      await api(`/api/finanzas-transactions/${t.id}`, { method: 'DELETE' });
      await refreshFinanzasTransactionsTab();
      await refreshFinanzasAccountsAndCategories();
      renderFinanzasResumenTab();
    });
    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(deleteBtn);
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------
// Extension "Lecturas": historial de entretenimiento en general (manga,
// comic, libro, serie, anime, pelicula), agrupado en SAGAS obligatorias
// (hasta algo suelto es una saga de un solo item). Jerarquia de 2
// tablas: sagas primero, items de la saga elegida despues -- mas
// parecido a como Notas navega carpetas que a las pestañas de Gimnasio.
// ---------------------------------------------------------------------
const LECTURAS_TYPE_LABELS = { manga: 'Manga', comic: 'Cómic', libro: 'Libro', serie: 'Serie', anime: 'Anime', pelicula: 'Película' };
const LECTURAS_STATUS_LABELS = { wishlist: 'Deseado', in_progress: 'En progreso', completed: 'Completado', dropped: 'Abandonado' };
const LECTURAS_STATUS_COLORS = { wishlist: '#9aa0a6', in_progress: '#f5b400', completed: '#2ecc71', dropped: '#e5484d' };
// Punto de partida de generos sugeridos -- se une con los que ya se
// hayan usado en CUALQUIER item de Lecturas (no solo la saga abierta,
// ver renderLecturasItemGenreChips) para formar la lista de sugerencias.
// Ajustable con el tiempo, no es una lista cerrada: escribir uno nuevo a
// mano en el input sigue funcionando igual que siempre.
const LECTURAS_PREDEFINED_GENRES = [
  'Acción', 'Aventura', 'Comedia', 'Drama', 'Fantasía', 'Terror', 'Misterio',
  'Romance', 'Ciencia ficción', 'Slice of life', 'Thriller', 'Deportes',
  'Histórico', 'Musical', 'Documental', 'Infantil',
];

// Selectores con estilo propio para Tipo/Estado del modal de item (antes
// eran <select> nativos, ver CLAUDE.md/plan -- desentonaban con el resto
// del modal, que ya usa los colores del tema). Mismo patron que
// eventGroupField/taskGroupField: se crean UNA vez al cargar el script,
// openLecturasItemModal() solo llama a .setValue().
const lecturasItemTypeField = createSelectField({
  options: Object.entries(LECTURAS_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  initialValue: 'manga',
});
document.getElementById('lecturas-item-type-field').appendChild(lecturasItemTypeField.element);

const lecturasItemStatusField = createSelectField({
  options: Object.entries(LECTURAS_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  initialValue: 'wishlist',
});
document.getElementById('lecturas-item-status-field').appendChild(lecturasItemStatusField.element);

// "Prestado a alguien" (ver comentario junto a lecturas_items en
// db.js): el bloque de detalles (a quien + desde cuando) solo se ve con
// la casilla marcada.
const lecturasItemLoanedAtField = createDateField({ initialValue: null, allowClear: true, placeholder: 'Sin fecha' });
document.getElementById('lecturas-item-loaned-at-field').appendChild(lecturasItemLoanedAtField.element);
document.getElementById('lecturas-item-loaned').addEventListener('change', (e) => {
  document.getElementById('lecturas-item-loaned-details').classList.toggle('hidden', !e.target.checked);
});

// Rating: slider + numero sincronizados -- cualquiera de los dos vale
// para poner la nota; solo el numero puede dejarse vacio del todo (el
// slider no tiene un estado "sin valor"), asi que sigue siendo la unica
// forma de marcar "sin valorar todavia". Los listeners se ponen una sola
// vez (los elementos del modal no se recrean nunca, siempre son los
// mismos de index.html).
function clampLecturasRatingInput(el) {
  if (el.value === '') return;
  const clamped = Math.max(0, Math.min(10, Number(el.value)));
  if (String(clamped) !== el.value) el.value = clamped;
}
const lecturasItemRatingRange = document.getElementById('lecturas-item-rating-range');
const lecturasItemRatingNumber = document.getElementById('lecturas-item-rating');
lecturasItemRatingRange.addEventListener('input', () => {
  lecturasItemRatingNumber.value = lecturasItemRatingRange.value;
});
lecturasItemRatingNumber.addEventListener('input', () => {
  clampLecturasRatingInput(lecturasItemRatingNumber);
  lecturasItemRatingRange.value = lecturasItemRatingNumber.value === '' ? 0 : lecturasItemRatingNumber.value;
});

async function refreshLecturasSagasView() {
  document.getElementById('lecturas-sagas-panel').classList.remove('hidden');
  document.getElementById('lecturas-saga-detail-panel').classList.add('hidden');
  state.lecturasCurrentSagaId = null;
  await loadLecturasSagas();
  renderLecturasSagasTable();
}

function openLecturasView() {
  closeExtensionsView();
  document.getElementById('lecturas-view').classList.remove('hidden');
  setCurrentScreen('lecturas');
  refreshLecturasSagasView();
}
function closeLecturasView() {
  document.getElementById('lecturas-view').classList.add('hidden');
  openExtensionsView();
}
document.getElementById('btn-open-lecturas').addEventListener('click', openLecturasView);
document.getElementById('btn-close-lecturas').addEventListener('click', closeLecturasView);
document.getElementById('btn-back-lecturas-sagas').addEventListener('click', refreshLecturasSagasView);

async function loadLecturasSagas() {
  state.lecturasSagas = await api('/api/lecturas-sagas');
}
async function loadLecturasItems(sagaId) {
  state.lecturasItems = await api(`/api/lecturas-items?sagaId=${sagaId}`);
}

function renderLecturasSagasTable() {
  const tbody = document.getElementById('lecturas-sagas-tbody');
  const empty = document.getElementById('lecturas-sagas-empty');
  tbody.innerHTML = '';
  empty.classList.toggle('hidden', state.lecturasSagas.length > 0);
  state.lecturasSagas.forEach((saga) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(saga.name)}</td>
      <td>${saga.types.map((t) => LECTURAS_TYPE_LABELS[t] || t).join(', ') || '—'}</td>
      <td>${saga.itemCount}</td>
    `;
    tr.addEventListener('click', () => openLecturasSagaDetail(saga));
    tbody.appendChild(tr);
  });
}

function openFinanzasTransactionModal(t) {
  document.getElementById('finanzas-transaction-modal-title').textContent = t ? 'Editar movimiento' : 'Nuevo movimiento';
  document.getElementById('finanzas-transaction-id').value = t ? t.id : '';
  finanzasTransactionTypeField.setValue(t ? t.type : 'expense');
  finanzasTransactionAccountField.setValue(t ? t.accountId : (finanzasAccounts[0] ? finanzasAccounts[0].id : ''));
  finanzasTransactionCategoryField.setValue(t && t.categoryId ? t.categoryId : '');
  document.getElementById('finanzas-transaction-amount').value = t ? t.amount : '';
  finanzasTransactionDateField.setValue(t ? new Date(`${t.date}T00:00:00`) : new Date());
  document.getElementById('finanzas-transaction-description').value = t ? (t.description || '') : '';
  document.getElementById('finanzas-transaction-counts').checked = t ? t.countsTowardBudget : true;
  document.getElementById('finanzas-transaction-fixed').checked = t ? t.isFixed : false;
  document.getElementById('finanzas-transaction-salary').checked = t ? t.isSalary : false;
  refreshFinanzasTransactionTypeFields();
  document.getElementById('finanzas-transaction-modal').classList.remove('hidden');
}
function closeFinanzasTransactionModal() {
  document.getElementById('finanzas-transaction-modal').classList.add('hidden');
}
function refreshFinanzasTransactionTypeFields() {
  const isExpense = finanzasTransactionTypeField.getValue() === 'expense';
  document.getElementById('finanzas-transaction-category-label').classList.toggle('hidden', !isExpense);
  document.getElementById('finanzas-transaction-counts-row').classList.toggle('hidden', !isExpense);
  document.getElementById('finanzas-transaction-fixed-row').classList.toggle('hidden', !isExpense);
  document.getElementById('finanzas-transaction-salary-row').classList.toggle('hidden', isExpense);
}
document.getElementById('btn-new-finanzas-transaction').addEventListener('click', () => openFinanzasTransactionModal(null));
document.getElementById('btn-close-finanzas-transaction').addEventListener('click', closeFinanzasTransactionModal);

document.getElementById('finanzas-transaction-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('finanzas-transaction-id').value;
  const type = finanzasTransactionTypeField.getValue();
  const payload = {
    accountId: Number(finanzasTransactionAccountField.getValue()),
    type,
    amount: document.getElementById('finanzas-transaction-amount').value,
    date: toDateKey(finanzasTransactionDateField.getValue()),
    description: document.getElementById('finanzas-transaction-description').value || null,
    categoryId: type === 'expense' && finanzasTransactionCategoryField.getValue()
      ? Number(finanzasTransactionCategoryField.getValue())
      : null,
    countsTowardBudget: type === 'expense' ? document.getElementById('finanzas-transaction-counts').checked : false,
    isFixed: type === 'expense' ? document.getElementById('finanzas-transaction-fixed').checked : false,
    isSalary: type === 'income' ? document.getElementById('finanzas-transaction-salary').checked : false,
  };
  if (id) {
    await api(`/api/finanzas-transactions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/finanzas-transactions', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeFinanzasTransactionModal();
  await refreshFinanzasTransactionsTab();
  await refreshFinanzasAccountsAndCategories();
  renderFinanzasResumenTab();
});

document.getElementById('btn-clear-finanzas-filters').addEventListener('click', () => {
  finanzasFilters.accountId = finanzasFilters.categoryId = finanzasFilters.type = finanzasFilters.from = finanzasFilters.to = '';
  finanzasFilterAccountField.setValue('');
  finanzasFilterCategoryField.setValue('');
  finanzasFilterTypeField.setValue('');
  finanzasFilterFromField.setValue(null);
  finanzasFilterToField.setValue(null);
  refreshFinanzasTransactionsTab();
});

// -- Pestaña "Gastos fijos": plantillas de gasto recurrente, generan
//    solas su propia transaccion real cuando toca (ver
//    server/finanzasRecurringChecker.js) -- separada de Movimientos a
//    peticion explicita de Koku.
let finanzasRecurringExpenses = [];

async function loadFinanzasRecurring() {
  finanzasRecurringExpenses = await api('/api/finanzas-recurring-expenses');
}

const FINANZAS_RECURRING_FREQUENCY_LABELS = { monthly: 'Mensual', annual: 'Anual' };

function finanzasRecurringFrequencyLabel(r) {
  if (r.frequency === 'monthly') return `Mensual (día ${r.dayOfMonth})`;
  return `Anual (${FINANZAS_MONTH_NAMES[r.monthOfYear - 1]} ${r.dayOfMonth})`;
}

function renderFinanzasRecurringList() {
  const tbody = document.getElementById('finanzas-recurring-tbody');
  tbody.innerHTML = '';
  if (finanzasRecurringExpenses.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-hint">Todavia no tienes gastos fijos. Crea uno arriba.</td></tr>';
    return;
  }
  finanzasRecurringExpenses.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.description || '—')}</td>
      <td>${escapeHtml(finanzasAccountName(r.accountId))}</td>
      <td>${escapeHtml(finanzasCategoryName(r.categoryId))}</td>
      <td>${formatFinanzasAmount(r.amount)}</td>
      <td>${finanzasRecurringFrequencyLabel(r)}</td>
      <td>${r.active ? 'Activo' : 'Pausado'}${r.endDate ? ` (hasta ${r.endDate})` : ''}</td>
      <td></td>
    `;
    const actionsTd = tr.lastElementChild;
    const historyBtn = document.createElement('button');
    historyBtn.type = 'button';
    historyBtn.className = 'secondary-btn';
    historyBtn.textContent = 'Ver generados';
    historyBtn.addEventListener('click', () => openFinanzasRecurringTransactionsModal(r));
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'secondary-btn';
    toggleBtn.textContent = r.active ? 'Pausar' : 'Reanudar';
    toggleBtn.addEventListener('click', async () => {
      await api(`/api/finanzas-recurring-expenses/${r.id}`, { method: 'PUT', body: JSON.stringify({ active: !r.active }) });
      await refreshFinanzasRecurringTab();
    });
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary-btn';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', () => openFinanzasRecurringModal(r));
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger-btn';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el gasto fijo "${r.description || 'sin nombre'}"? Los movimientos ya generados se quedan, solo se deja de generar más.`)) return;
      await api(`/api/finanzas-recurring-expenses/${r.id}`, { method: 'DELETE' });
      await refreshFinanzasRecurringTab();
    });
    actionsTd.append(historyBtn, toggleBtn, editBtn, deleteBtn);
    tbody.appendChild(tr);
  });
}

async function refreshFinanzasRecurringTab() {
  await loadFinanzasRecurring();
  renderFinanzasRecurringList();
}

function refreshFinanzasRecurringFrequencyFields() {
  const isAnnual = finanzasRecurringFrequencyField.getValue() === 'annual';
  document.getElementById('finanzas-recurring-month-label').classList.toggle('hidden', !isAnnual);
}

function openFinanzasRecurringModal(r) {
  document.getElementById('finanzas-recurring-modal-title').textContent = r ? 'Editar gasto fijo' : 'Nuevo gasto fijo';
  document.getElementById('finanzas-recurring-id').value = r ? r.id : '';
  document.getElementById('finanzas-recurring-description').value = r ? (r.description || '') : '';
  finanzasRecurringAccountField.setValue(r ? r.accountId : (finanzasAccounts[0] ? finanzasAccounts[0].id : ''));
  finanzasRecurringCategoryField.setValue(r && r.categoryId ? r.categoryId : '');
  document.getElementById('finanzas-recurring-amount').value = r ? r.amount : '';
  finanzasRecurringFrequencyField.setValue(r ? r.frequency : 'monthly');
  document.getElementById('finanzas-recurring-day').value = r ? r.dayOfMonth : '';
  finanzasRecurringMonthField.setValue(r && r.monthOfYear ? String(r.monthOfYear).padStart(2, '0') : '01');
  finanzasRecurringStartField.setValue(r ? new Date(`${r.startDate}T00:00:00`) : new Date());
  finanzasRecurringEndField.setValue(r && r.endDate ? new Date(`${r.endDate}T00:00:00`) : null);
  document.getElementById('finanzas-recurring-counts').checked = r ? r.countsTowardBudget : true;
  refreshFinanzasRecurringFrequencyFields();
  document.getElementById('finanzas-recurring-modal').classList.remove('hidden');
}
function closeFinanzasRecurringModal() {
  document.getElementById('finanzas-recurring-modal').classList.add('hidden');
}
document.getElementById('btn-new-finanzas-recurring').addEventListener('click', () => openFinanzasRecurringModal(null));
document.getElementById('btn-cancel-finanzas-recurring').addEventListener('click', closeFinanzasRecurringModal);
document.getElementById('btn-close-finanzas-recurring').addEventListener('click', closeFinanzasRecurringModal);

document.getElementById('finanzas-recurring-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('finanzas-recurring-id').value;
  const frequency = finanzasRecurringFrequencyField.getValue();
  const endDate = finanzasRecurringEndField.getValue();
  const payload = {
    accountId: Number(finanzasRecurringAccountField.getValue()),
    categoryId: finanzasRecurringCategoryField.getValue() || null,
    description: document.getElementById('finanzas-recurring-description').value || null,
    amount: document.getElementById('finanzas-recurring-amount').value,
    frequency,
    dayOfMonth: Number(document.getElementById('finanzas-recurring-day').value),
    monthOfYear: frequency === 'annual' ? Number(finanzasRecurringMonthField.getValue()) : null,
    startDate: toDateKey(finanzasRecurringStartField.getValue()),
    endDate: endDate ? toDateKey(endDate) : null,
    countsTowardBudget: document.getElementById('finanzas-recurring-counts').checked,
  };
  try {
    if (id) {
      await api(`/api/finanzas-recurring-expenses/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/finanzas-recurring-expenses', { method: 'POST', body: JSON.stringify(payload) });
    }
  } catch (err) {
    alert(err.message);
    return;
  }
  closeFinanzasRecurringModal();
  await refreshFinanzasRecurringTab();
});

// -- Pestaña "Deudas": lo que Koku debe a alguien y lo que alguien le
//    debe a el (ver comentario junto a finanzas_debts en server/db.js).
//    Ligar una deuda a una cuenta es opcional -- si se liga, marcarla
//    como pagada genera un movimiento real (ver routes/finanzasDebts.js).
let finanzasDebts = [];

async function loadFinanzasDebts() {
  finanzasDebts = await api('/api/finanzas-debts');
}

function finanzasDebtStatusLabel(d) {
  if (!d.paid) return 'Pendiente';
  return `Pagada${d.paidAt ? ` (${d.paidAt})` : ''}`;
}

function renderFinanzasDebtsList() {
  const owedByMeTbody = document.getElementById('finanzas-debts-owed-by-me-tbody');
  const owedToMeTbody = document.getElementById('finanzas-debts-owed-to-me-tbody');
  owedByMeTbody.innerHTML = '';
  owedToMeTbody.innerHTML = '';

  const owedByMe = finanzasDebts.filter((d) => d.direction === 'owed_by_me');
  const owedToMe = finanzasDebts.filter((d) => d.direction === 'owed_to_me');

  if (owedByMe.length === 0) owedByMeTbody.innerHTML = '<tr><td colspan="6" class="empty-hint">No debes nada apuntado aquí.</td></tr>';
  if (owedToMe.length === 0) owedToMeTbody.innerHTML = '<tr><td colspan="6" class="empty-hint">Nadie te debe nada apuntado aquí.</td></tr>';

  [{ list: owedByMe, tbody: owedByMeTbody }, { list: owedToMe, tbody: owedToMeTbody }].forEach(({ list, tbody }) => {
    list.forEach((d) => {
      const tr = document.createElement('tr');
      if (d.paid) tr.classList.add('finanzas-debt-row-paid');
      tr.innerHTML = `
        <td>${escapeHtml(d.person)}${d.description ? `<br><span class="hint">${escapeHtml(d.description)}</span>` : ''}</td>
        <td>${formatFinanzasAmount(d.amount)}</td>
        <td>${d.date || '—'}</td>
        <td>${escapeHtml(finanzasAccountName(d.accountId))}</td>
        <td>${finanzasDebtStatusLabel(d)}</td>
        <td></td>
      `;
      const actionsTd = tr.lastElementChild;
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'secondary-btn';
      toggleBtn.textContent = d.paid ? 'Marcar pendiente' : 'Marcar pagada';
      toggleBtn.addEventListener('click', async () => {
        await api(`/api/finanzas-debts/${d.id}/paid`, { method: 'PUT', body: JSON.stringify({ paid: !d.paid }) });
        await refreshFinanzasDebtsTab();
        await refreshFinanzasAccountsAndCategories();
        renderFinanzasResumenTab();
      });
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'secondary-btn';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', () => openFinanzasDebtModal(d));
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'danger-btn';
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar la deuda con "${d.person}"?${d.transactionId ? ' Esto también borra el movimiento que generó al saldarse.' : ''}`)) return;
        await api(`/api/finanzas-debts/${d.id}`, { method: 'DELETE' });
        await refreshFinanzasDebtsTab();
        await refreshFinanzasAccountsAndCategories();
        renderFinanzasResumenTab();
      });
      actionsTd.append(toggleBtn, editBtn, deleteBtn);
      tbody.appendChild(tr);
    });
  });
}

async function refreshFinanzasDebtsTab() {
  await loadFinanzasDebts();
  renderFinanzasDebtsList();
}

function openFinanzasDebtModal(d) {
  document.getElementById('finanzas-debt-modal-title').textContent = d ? 'Editar deuda' : 'Nueva deuda';
  document.getElementById('finanzas-debt-id').value = d ? d.id : '';
  finanzasDebtDirectionField.setValue(d ? d.direction : 'owed_by_me');
  document.getElementById('finanzas-debt-person').value = d ? d.person : '';
  document.getElementById('finanzas-debt-amount').value = d ? d.amount : '';
  finanzasDebtDateField.setValue(d && d.date ? new Date(`${d.date}T00:00:00`) : null);
  finanzasDebtAccountField.setValue(d && d.accountId ? d.accountId : '');
  document.getElementById('finanzas-debt-description').value = d ? d.description || '' : '';
  document.getElementById('btn-delete-finanzas-debt').classList.toggle('hidden', !d);
  document.getElementById('finanzas-debt-modal').classList.remove('hidden');
}
function closeFinanzasDebtModal() {
  document.getElementById('finanzas-debt-modal').classList.add('hidden');
}
document.getElementById('btn-new-finanzas-debt').addEventListener('click', () => openFinanzasDebtModal(null));
document.getElementById('btn-close-finanzas-debt').addEventListener('click', closeFinanzasDebtModal);

document.getElementById('finanzas-debt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('finanzas-debt-id').value;
  const dateValue = finanzasDebtDateField.getValue();
  const payload = {
    direction: finanzasDebtDirectionField.getValue(),
    person: document.getElementById('finanzas-debt-person').value,
    amount: document.getElementById('finanzas-debt-amount').value,
    date: dateValue ? toDateKey(dateValue) : null,
    accountId: finanzasDebtAccountField.getValue() || null,
    description: document.getElementById('finanzas-debt-description').value || null,
  };
  try {
    if (id) {
      await api(`/api/finanzas-debts/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/finanzas-debts', { method: 'POST', body: JSON.stringify(payload) });
    }
  } catch (err) {
    alert(err.message);
    return;
  }
  closeFinanzasDebtModal();
  await refreshFinanzasDebtsTab();
});
document.getElementById('btn-delete-finanzas-debt').addEventListener('click', async () => {
  const id = document.getElementById('finanzas-debt-id').value;
  const debt = finanzasDebts.find((x) => String(x.id) === String(id));
  if (!confirm(`¿Eliminar la deuda con "${debt ? debt.person : ''}"?${debt && debt.transactionId ? ' Esto también borra el movimiento que generó al saldarse.' : ''}`)) return;
  await api(`/api/finanzas-debts/${id}`, { method: 'DELETE' });
  closeFinanzasDebtModal();
  await refreshFinanzasDebtsTab();
  await refreshFinanzasAccountsAndCategories();
  renderFinanzasResumenTab();
});

// Movimientos ya generados por una plantilla concreta -- reutiliza el
// filtro recurringExpenseId ya soportado por GET /api/finanzas-transactions.
async function openFinanzasRecurringTransactionsModal(r) {
  document.getElementById('finanzas-recurring-transactions-title').textContent = `Movimientos generados — ${r.description || 'gasto fijo'}`;
  const tbody = document.getElementById('finanzas-recurring-transactions-tbody');
  tbody.innerHTML = '<tr><td colspan="2" class="empty-hint">Cargando…</td></tr>';
  document.getElementById('finanzas-recurring-transactions-modal').classList.remove('hidden');
  const transactions = await api(`/api/finanzas-transactions?recurringExpenseId=${r.id}`);
  tbody.innerHTML = '';
  if (transactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-hint">Todavia no se ha generado ninguno.</td></tr>';
    return;
  }
  transactions.forEach((t) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t.date}</td><td>${formatFinanzasAmount(t.amount)}</td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById('btn-close-finanzas-recurring-transactions').addEventListener('click', () => {
  document.getElementById('finanzas-recurring-transactions-modal').classList.add('hidden');
});

// -- Pestaña Inversiones: tabla de compra/venta/dividendos + resumen por
//    activo (ganancia/perdida REALIZADA, nunca valor de mercado). --
async function refreshFinanzasInvestmentsTab() {
  const investments = await api('/api/finanzas-investments');
  const tbody = document.getElementById('finanzas-investments-tbody');
  tbody.innerHTML = '';
  if (investments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-hint">Sin inversiones registradas todavia.</td></tr>';
  } else {
    const typeLabels = { buy: 'Compra', sell: 'Venta', dividend: 'Dividendo' };
    investments.forEach((inv) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${inv.date}</td>
        <td>${escapeHtml(finanzasAccountName(inv.accountId))}</td>
        <td>${escapeHtml(inv.assetName)}</td>
        <td>${typeLabels[inv.type]}</td>
        <td>${inv.quantity ?? '—'}</td>
        <td>${inv.pricePerUnit ? formatFinanzasAmount(inv.pricePerUnit) : '—'}</td>
        <td>${formatFinanzasAmount(inv.amount)}</td>
        <td></td>
      `;
      const actionsTd = tr.lastElementChild;
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'secondary-btn';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', () => openFinanzasInvestmentModal(inv));
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'danger-btn';
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta operación?')) return;
        await api(`/api/finanzas-investments/${inv.id}`, { method: 'DELETE' });
        await refreshFinanzasInvestmentsTab();
        await refreshFinanzasAccountsAndCategories();
        renderFinanzasResumenTab();
      });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tbody.appendChild(tr);
    });
  }

  const summary = await api('/api/finanzas-investments/summary/by-asset');
  const summaryTbody = document.getElementById('finanzas-asset-summary-tbody');
  summaryTbody.innerHTML = '';
  if (summary.length === 0) {
    summaryTbody.innerHTML = '<tr><td colspan="6" class="empty-hint">Sin datos todavia.</td></tr>';
  } else {
    summary.forEach((s) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(s.assetName)}</td>
        <td>${formatFinanzasAmount(s.totalBought)}</td>
        <td>${formatFinanzasAmount(s.totalSold)}</td>
        <td>${formatFinanzasAmount(s.totalDividends)}</td>
        <td>${s.quantityRemaining}</td>
        <td class="${s.realizedGain >= 0 ? 'finanzas-amount-income' : 'finanzas-amount-expense'}">${formatFinanzasAmount(s.realizedGain)}</td>
      `;
      summaryTbody.appendChild(tr);
    });
  }

  await refreshFinanzasInvestmentTrendChart();
}

// Arbol de checkboxes (carteras/subcarteras/activos) junto a la grafica
// de evolucion mensual -- sustituye al selector unico de antes. Siempre
// expandido del todo (sin precedente de expand/colapsar en el proyecto,
// y el volumen de carteras personales no lo justifica). Recorre
// finanzasPortfolios/finanzasAssets con la misma logica de
// buildPortfolioSelectOptions, pero pintando checkboxes en vez de
// opciones de un select.
function collectDescendantAssetIds(portfolioId) {
  const ownAssetIds = finanzasAssets.filter((a) => a.portfolioId === portfolioId).map((a) => a.id);
  const childPortfolioIds = finanzasPortfolios.filter((p) => p.parentId === portfolioId).map((p) => p.id);
  return ownAssetIds.concat(...childPortfolioIds.map((id) => collectDescendantAssetIds(id)));
}

function renderFinanzasAssetTreeLevel(parentPortfolioId, depth) {
  const container = document.createElement('div');
  const childPortfolios = finanzasPortfolios.filter((p) => p.parentId === parentPortfolioId).sort((a, b) => a.position - b.position);
  const childAssets = finanzasAssets.filter((a) => a.portfolioId === parentPortfolioId).sort((a, b) => a.position - b.position);

  childPortfolios.forEach((p) => {
    const descendantAssetIds = collectDescendantAssetIds(p.id);
    const checkedCount = descendantAssetIds.filter((id) => finanzasAssetTreeSelectedIds.has(id)).length;
    const row = document.createElement('label');
    row.className = 'finanzas-asset-tree-row finanzas-asset-tree-portfolio';
    row.style.paddingLeft = `${depth * 18}px`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'styled-checkbox';
    checkbox.checked = descendantAssetIds.length > 0 && checkedCount === descendantAssetIds.length;
    checkbox.indeterminate = checkedCount > 0 && checkedCount < descendantAssetIds.length;
    checkbox.addEventListener('change', () => {
      descendantAssetIds.forEach((id) => {
        if (checkbox.checked) finanzasAssetTreeSelectedIds.add(id);
        else finanzasAssetTreeSelectedIds.delete(id);
      });
      renderFinanzasAssetTree();
      refreshFinanzasInvestmentTrendChart();
    });
    const nameSpan = document.createElement('span');
    nameSpan.style.color = p.color;
    nameSpan.textContent = p.name;
    row.append(checkbox, nameSpan);
    container.appendChild(row);
    container.appendChild(renderFinanzasAssetTreeLevel(p.id, depth + 1));
  });

  childAssets.forEach((asset) => {
    const row = document.createElement('label');
    row.className = 'finanzas-asset-tree-row finanzas-asset-tree-leaf';
    row.style.paddingLeft = `${depth * 18}px`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'styled-checkbox';
    checkbox.checked = finanzasAssetTreeSelectedIds.has(asset.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) finanzasAssetTreeSelectedIds.add(asset.id);
      else finanzasAssetTreeSelectedIds.delete(asset.id);
      renderFinanzasAssetTree(); // repinta para recalcular el indeterminate de los ancestros
      refreshFinanzasInvestmentTrendChart();
    });
    const nameSpan = document.createElement('span');
    nameSpan.textContent = asset.name;
    row.append(checkbox, nameSpan);
    container.appendChild(row);
  });

  return container;
}

function renderFinanzasAssetTree() {
  const wrap = document.getElementById('finanzas-investment-asset-tree');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (finanzasPortfolios.length === 0 && finanzasAssets.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">Todavia no tienes activos. Créalos en "Gestionar carteras y activos".</p>';
    return;
  }
  wrap.appendChild(renderFinanzasAssetTreeLevel(null, 0));
}

// Evolucion mensual de compras/ventas/dividendos -- mismo estilo de
// barras que renderFinanzasMonthlyTrendChart(), pero con 3 series y
// filtrado por el CONJUNTO de activos marcado en el arbol de carteras
// (finanzasAssetTreeSelectedIds, ver renderFinanzasAssetTree) en vez de
// un unico selector -- asi se puede ver la evolucion general, la de una
// cartera entera, o la de un activo individual, como pidio Koku.
async function refreshFinanzasInvestmentTrendChart() {
  const selected = [...finanzasAssetTreeSelectedIds];
  if (selected.length === 0) {
    // Todo desmarcado a mano -- "ningun activo", no "todos" (evitar
    // pedir de mas al servidor con un filtro vacio que se interpretaria
    // como "sin filtro").
    renderFinanzasInvestmentTrendChart([]);
    return;
  }
  const qs = selected.length < finanzasAssets.length ? `?assetIds=${selected.join(',')}` : '';
  const data = await api(`/api/finanzas-investments/summary/monthly-trend${qs}`);
  renderFinanzasInvestmentTrendChart(data);
}

function renderFinanzasInvestmentTrendChart(data) {
  const wrap = document.getElementById('finanzas-investment-trend-chart');
  if (!data || data.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">Sin datos todavia.</p>';
    return;
  }

  const maxValue = Math.max(1, ...data.flatMap((d) => [d.totalBought, d.totalSold, d.totalDividends]));
  const chartHeight = 160;
  const barWidth = 10;
  const barGap = 3;
  const groupWidth = barWidth * 3 + barGap * 2;
  const groupGap = 14;
  const svgWidth = data.length * (groupWidth + groupGap) + groupGap;
  const svgHeight = chartHeight + 30;

  let bars = '';
  data.forEach((d, i) => {
    const groupX = groupGap + i * (groupWidth + groupGap);
    const boughtH = (d.totalBought / maxValue) * chartHeight;
    const soldH = (d.totalSold / maxValue) * chartHeight;
    const divH = (d.totalDividends / maxValue) * chartHeight;
    const [year, monthNum] = d.month.split('-');
    const label = FINANZAS_MONTH_ABBR[Number(monthNum) - 1];
    bars += `
      <rect x="${groupX}" y="${chartHeight - boughtH}" width="${barWidth}" height="${boughtH}" fill="#e63946" data-tooltip="${escapeHtml(`${label} ${year}: comprado ${formatFinanzasAmount(d.totalBought)}`)}"></rect>
      <rect x="${groupX + barWidth + barGap}" y="${chartHeight - soldH}" width="${barWidth}" height="${soldH}" fill="#43aa8b" data-tooltip="${escapeHtml(`${label} ${year}: vendido ${formatFinanzasAmount(d.totalSold)}`)}"></rect>
      <rect x="${groupX + (barWidth + barGap) * 2}" y="${chartHeight - divH}" width="${barWidth}" height="${divH}" fill="#f5b400" data-tooltip="${escapeHtml(`${label} ${year}: dividendos ${formatFinanzasAmount(d.totalDividends)}`)}"></rect>
      <text x="${groupX + groupWidth / 2}" y="${chartHeight + 18}" text-anchor="middle" class="finanzas-trend-chart-label">${label}</text>
    `;
  });

  wrap.innerHTML = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="finanzas-trend-chart-svg" role="img" aria-label="Evolucion mensual de compras, ventas y dividendos">
      <line x1="0" y1="${chartHeight}" x2="${svgWidth}" y2="${chartHeight}" class="finanzas-trend-chart-axis" />
      ${bars}
    </svg>
    <div class="finanzas-trend-chart-legend">
      <span><span class="finanzas-trend-legend-dot" style="background:#e63946"></span> Comprado</span>
      <span><span class="finanzas-trend-legend-dot" style="background:#43aa8b"></span> Vendido</span>
      <span><span class="finanzas-trend-legend-dot" style="background:#f5b400"></span> Dividendos</span>
    </div>
  `;
  attachFinanzasChartTooltips(wrap.querySelector('svg'));
}

function refreshFinanzasInvestmentTypeFields() {
  const type = finanzasInvestmentTypeField.getValue();
  const isDividend = type === 'dividend';
  document.getElementById('finanzas-investment-qty-price-row').classList.toggle('hidden', isDividend);
  document.getElementById('finanzas-investment-amount-label').classList.toggle('hidden', !isDividend);
  document.getElementById('finanzas-investment-quantity').required = !isDividend;
  document.getElementById('finanzas-investment-price').required = !isDividend;
  document.getElementById('finanzas-investment-amount').required = isDividend;
  // "Cuenta para el limite mensual" solo tiene sentido en una Compra --
  // una venta o un dividendo traen dinero DENTRO, no lo gastan.
  document.getElementById('finanzas-investment-counts-row').classList.toggle('hidden', type !== 'buy');
}

function openFinanzasInvestmentModal(inv) {
  document.getElementById('finanzas-investment-modal-title').textContent = inv ? 'Editar operación' : 'Nueva inversión';
  document.getElementById('finanzas-investment-id').value = inv ? inv.id : '';
  finanzasInvestmentAccountField.setValue(inv ? inv.accountId : (finanzasAccounts[0] ? finanzasAccounts[0].id : ''));
  finanzasInvestmentAssetField.setValue(inv ? inv.assetId : (finanzasAssets[0] ? finanzasAssets[0].id : ''));
  finanzasInvestmentTypeField.setValue(inv ? inv.type : 'buy');
  document.getElementById('finanzas-investment-quantity').value = inv && inv.quantity !== null ? inv.quantity : '';
  document.getElementById('finanzas-investment-price').value = inv && inv.pricePerUnit !== null ? inv.pricePerUnit : '';
  document.getElementById('finanzas-investment-amount').value = inv && inv.type === 'dividend' ? inv.amount : '';
  finanzasInvestmentDateField.setValue(inv ? new Date(`${inv.date}T00:00:00`) : new Date());
  document.getElementById('finanzas-investment-notes').value = inv ? (inv.notes || '') : '';
  document.getElementById('finanzas-investment-counts').checked = inv ? !!inv.countsTowardBudget : false;
  refreshFinanzasInvestmentTypeFields();
  document.getElementById('finanzas-investment-modal').classList.remove('hidden');
}
function closeFinanzasInvestmentModal() {
  document.getElementById('finanzas-investment-modal').classList.add('hidden');
}
document.getElementById('btn-new-finanzas-investment').addEventListener('click', () => openFinanzasInvestmentModal(null));
document.getElementById('btn-close-finanzas-investment').addEventListener('click', closeFinanzasInvestmentModal);

document.getElementById('finanzas-investment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('finanzas-investment-id').value;
  const type = finanzasInvestmentTypeField.getValue();
  const payload = {
    accountId: Number(finanzasInvestmentAccountField.getValue()),
    assetId: Number(finanzasInvestmentAssetField.getValue()),
    type,
    date: toDateKey(finanzasInvestmentDateField.getValue()),
    notes: document.getElementById('finanzas-investment-notes').value || null,
    countsTowardBudget: type === 'buy' ? document.getElementById('finanzas-investment-counts').checked : false,
  };
  if (type === 'dividend') {
    payload.amount = document.getElementById('finanzas-investment-amount').value;
    payload.quantity = null;
    payload.pricePerUnit = null;
  } else {
    payload.quantity = document.getElementById('finanzas-investment-quantity').value;
    payload.pricePerUnit = document.getElementById('finanzas-investment-price').value;
  }
  if (id) {
    await api(`/api/finanzas-investments/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/finanzas-investments', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeFinanzasInvestmentModal();
  await refreshFinanzasInvestmentsTab();
  await refreshFinanzasAccountsAndCategories();
  renderFinanzasResumenTab();
});

// -- Pestañas + apertura/cierre de toda la vista --
function switchFinanzasTab(tabName) {
  document.querySelectorAll('.finanzas-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.finanzasTab === tabName);
  });
  document.querySelectorAll('.finanzas-tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.finanzasPanel !== tabName);
  });
}
document.querySelectorAll('.finanzas-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchFinanzasTab(btn.dataset.finanzasTab));
});

async function openFinanzasView() {
  setupFinanzasIconColorFields();
  closeExtensionsView();
  document.getElementById('finanzas-view').classList.remove('hidden');
  setCurrentScreen('finanzas');
  switchFinanzasTab('resumen');
  await refreshFinanzasAccountsAndCategories();
  await loadFinanzasPortfolios();
  await loadFinanzasAssets();
  populateFinanzasPortfolioSelects(null);
  renderFinanzasPortfoliosList();
  renderFinanzasAssetsList();
  // Por defecto, todos los activos marcados en el arbol (ver
  // renderFinanzasAssetTree) -- se reinicia cada vez que se abre la
  // vista para no arrastrar una seleccion vieja de la sesion anterior.
  finanzasAssetTreeSelectedIds = new Set(finanzasAssets.map((a) => a.id));
  renderFinanzasAssetTree();
  await Promise.all([renderFinanzasResumenTab(), refreshFinanzasTransactionsTab(), refreshFinanzasRecurringTab(), refreshFinanzasInvestmentsTab(), refreshFinanzasDebtsTab()]);
}
function closeFinanzasView() {
  document.getElementById('finanzas-view').classList.add('hidden');
  openExtensionsView();
}
document.getElementById('btn-open-finanzas').addEventListener('click', openFinanzasView);
document.getElementById('btn-close-finanzas').addEventListener('click', closeFinanzasView);

// ---------------------------------------------------------------------
// Extension "Archivos": mandar archivos sueltos (fotos, PDFs, documentos
// -- no ligados a una nota) entre movil y ordenador. La "base de datos"
// es la propia carpeta del sistema de ficheros (ver server/routes/archivos.js),
// asi que no hay tabla ni copia local -- se lee la lista real cada vez
// que se abre esta vista. Esta vista tambien reune ahora el control
// MANUAL de la sincronizacion de datos (boton "Sincronizar ahora", que
// antes vivia en Configuracion > Este dispositivo) y la comprobacion de
// version nueva.
// ---------------------------------------------------------------------
function formatArchivoSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// archivosCurrentPath: ruta que esta viendo AHORA el panel derecho
// cuando es el ordenador (ver isTrustedDevice() mas abajo) -- null =
// todavia no se ha navegado (o el dispositivo no puede navegar, ver
// abajo), en cuyo caso las peticiones usan la carpeta configurada de
// siempre. Distinta de archivosBrowsePath (esa es solo del widget de
// "elegir carpeta por defecto" del <details> de arriba).
let archivosCurrentPath = null;

function archivosPathQueryParam() {
  return archivosCurrentPath ? `?path=${encodeURIComponent(archivosCurrentPath)}` : '';
}

async function downloadArchivo(name) {
  const token = localStorage.getItem('deviceToken');
  const headers = {};
  if (token) headers['X-Device-Token'] = token;
  const url = new URL(`/api/archivos/${encodeURIComponent(name)}${archivosPathQueryParam()}`, getServerBaseUrl());
  try {
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    // "Descarga normal" del navegador (no Web Share API) -- confirmado
    // con Koku: un <a download> con un blob es lo mas sencillo y
    // funciona igual en ordenador y movil.
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    alert('No se pudo descargar el archivo: ' + err.message);
  }
}

async function deleteArchivo(name) {
  if (!confirm(`¿Borrar "${name}"?`)) return;
  await api(`/api/archivos/${encodeURIComponent(name)}${archivosPathQueryParam()}`, { method: 'DELETE' });
  archivosSelectedRemote.delete(name);
  await refreshArchivosCurrentView();
}

// Diseño de dos paneles (ver comentario en index.html): el panel
// derecho es la carpeta compartida de siempre, ahora con checkbox por
// fila para elegir que archivo(s) traer con la flecha "<-" del medio
// -- el boton "Borrar" se queda aparte (no es un movimiento entre
// paneles, no tiene sentido colgarlo de la flecha).
const archivosSelectedRemote = new Set();

function updateArchivosReceiveButtonState() {
  document.getElementById('btn-archivos-receive').disabled = archivosSelectedRemote.size === 0;
}

// Doble confirmacion de transferencias (ver server/archivosTransfers.js
// para el porque completo): cada cuanto se pregunta por el estado de una
// solicitud propia, o por solicitudes entrantes -- mas seguido que
// checkForUpdate (15s) porque aqui hay alguien mirando la pantalla
// esperando una respuesta en vivo, pero solo mientras la vista Archivos
// esta abierta (no es un timer global de fondo).
const ARCHIVOS_TRANSFER_POLL_MS = 3000;
let archivosOutgoingRequestId = null; // solicitud propia pendiente de que la confirmen (solo movil)
let archivosIncomingPollTimer = null; // vigilancia de solicitudes entrantes (solo ordenador)
const archivosHandledIncomingIds = new Set(); // evita repetir el aviso de la misma solicitud entrante

// Pinta la tabla de archivos -- compartida por el movil (siempre la
// carpeta configurada, ver refreshArchivosList) y el ordenador (la
// carpeta que se este navegando ahora mismo, ver loadArchivosNavPath).
function renderArchivosFileTable(files) {
  const tbody = document.getElementById('archivos-table-body');
  const emptyHint = document.getElementById('archivos-empty-hint');
  const validNames = new Set(files.map((f) => f.name));
  for (const name of archivosSelectedRemote) {
    if (!validNames.has(name)) archivosSelectedRemote.delete(name);
  }
  tbody.innerHTML = '';
  emptyHint.classList.toggle('hidden', files.length > 0);
  for (const file of files) {
    const tr = document.createElement('tr');
    const checkTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'styled-checkbox';
    checkbox.checked = archivosSelectedRemote.has(file.name);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) archivosSelectedRemote.add(file.name);
      else archivosSelectedRemote.delete(file.name);
      updateArchivosReceiveButtonState();
    });
    checkTd.appendChild(checkbox);
    const nameTd = document.createElement('td');
    nameTd.textContent = file.name;
    const sizeTd = document.createElement('td');
    sizeTd.textContent = formatArchivoSize(file.size);
    const dateTd = document.createElement('td');
    dateTd.textContent = new Date(file.modifiedAt).toLocaleString();
    const actionsTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger-btn';
    deleteBtn.textContent = 'Borrar';
    deleteBtn.addEventListener('click', () => deleteArchivo(file.name));
    actionsTd.appendChild(deleteBtn);
    tr.append(checkTd, nameTd, sizeTd, dateTd, actionsTd);
    tbody.appendChild(tr);
  }
  updateArchivosReceiveButtonState();
}

// Movil (o cualquier dispositivo no de confianza): solo ve la carpeta
// configurada, sin navegacion real -- comportamiento identico al de
// siempre, los navegadores no dejan listar el almacenamiento propio del
// dispositivo (ver comentario en index.html).
async function refreshArchivosList() {
  const files = await api('/api/archivos');
  renderArchivosFileTable(files);
}

// Ordenador: navega de verdad por el disco entero (GET /browse, que ya
// devuelve carpetas Y archivos) -- la carpeta configurada en "Carpeta de
// destino" pasa a ser solo el punto de partida / atajo rapido
// (btn-archivos-nav-default), no un limite.
async function loadArchivosNavPath(targetPath) {
  const qs = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
  const data = await api(`/api/archivos/browse${qs}`);
  archivosCurrentPath = data.path;
  document.getElementById('archivos-nav-path').textContent = data.path;
  const upBtn = document.getElementById('btn-archivos-nav-up');
  upBtn.disabled = !data.parent;
  upBtn.dataset.parent = data.parent || '';
  const foldersList = document.getElementById('archivos-nav-folders');
  const foldersToggle = document.getElementById('btn-archivos-nav-folders-toggle');
  foldersList.innerHTML = '';
  data.folders.forEach((folder) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'archivos-browser-item';
    btn.textContent = folder.name;
    btn.addEventListener('click', () => {
      closeArchivosFoldersDropdown(); // al navegar, se cierra el desplegable
      loadArchivosNavPath(folder.path);
    });
    foldersList.appendChild(btn);
  });
  // Sin subcarpetas aqui, no tiene sentido mostrar un boton de
  // desplegable vacio.
  foldersToggle.classList.toggle('hidden', data.folders.length === 0);
  closeArchivosFoldersDropdown();
  renderArchivosFileTable(data.files);
}

// Desplegable de subcarpetas: mismo "molde" que los demas popovers de la
// app (position:fixed + positionFixedPopover(), definida en settings.js
// -- se llama desde aqui dentro de un handler, no al cargar la pagina,
// asi que el orden de carga app.js/settings.js no da problemas, ver
// CLAUDE.md). Se abre con hover O con el boton; un temporizador corto
// evita que se cierre solo al pasar el raton del boton al desplegable
// (hay un hueco de unos pixeles entre los dos).
let archivosFoldersCloseTimer = null;
function openArchivosFoldersDropdown() {
  clearTimeout(archivosFoldersCloseTimer);
  const dropdown = document.getElementById('archivos-nav-folders');
  if (dropdown.children.length === 0) return; // sin subcarpetas, nada que mostrar
  if (!dropdown.classList.contains('hidden')) return; // ya abierto
  dropdown.classList.remove('hidden');
  positionFixedPopover(document.getElementById('btn-archivos-nav-folders-toggle'), dropdown, { width: 240 });
}
function closeArchivosFoldersDropdown() {
  clearTimeout(archivosFoldersCloseTimer);
  document.getElementById('archivos-nav-folders').classList.add('hidden');
}
function scheduleCloseArchivosFoldersDropdown() {
  clearTimeout(archivosFoldersCloseTimer);
  archivosFoldersCloseTimer = setTimeout(closeArchivosFoldersDropdown, 150);
}
document.getElementById('archivos-nav-folders-wrap').addEventListener('mouseenter', openArchivosFoldersDropdown);
document.getElementById('archivos-nav-folders-wrap').addEventListener('mouseleave', scheduleCloseArchivosFoldersDropdown);
document.getElementById('archivos-nav-folders').addEventListener('mouseenter', () => clearTimeout(archivosFoldersCloseTimer));
document.getElementById('archivos-nav-folders').addEventListener('mouseleave', scheduleCloseArchivosFoldersDropdown);
document.getElementById('btn-archivos-nav-folders-toggle').addEventListener('click', () => {
  if (document.getElementById('archivos-nav-folders').classList.contains('hidden')) openArchivosFoldersDropdown();
  else closeArchivosFoldersDropdown();
});
// Clicar fuera cierra el desplegable si se habia abierto con el boton
// (el hover ya se cierra solo al quitar el raton de encima).
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('archivos-nav-folders-wrap');
  if (wrap && !wrap.contains(e.target)) closeArchivosFoldersDropdown();
});

// Punto de entrada unico tras abrir la vista o tras cualquier mutacion
// (subir/borrar/etc.) -- decide si tocan la navegacion real (ordenador)
// o la lista simple de siempre (movil).
async function refreshArchivosBrowsePanel() {
  const navRow = document.getElementById('archivos-nav-row');
  const navFoldersWrap = document.getElementById('archivos-nav-folders-wrap');
  if (isTrustedDevice()) {
    navRow.classList.remove('hidden');
    navFoldersWrap.classList.remove('hidden');
    const startPath = archivosCurrentPath || document.getElementById('archivos-folder-path').value || null;
    await loadArchivosNavPath(startPath);
  } else {
    navRow.classList.add('hidden');
    navFoldersWrap.classList.add('hidden');
    await refreshArchivosList();
  }
}

async function refreshArchivosCurrentView() {
  if (isTrustedDevice() && archivosCurrentPath) {
    await loadArchivosNavPath(archivosCurrentPath);
  } else {
    await refreshArchivosList();
  }
}

document.getElementById('btn-archivos-nav-up').addEventListener('click', () => {
  const parent = document.getElementById('btn-archivos-nav-up').dataset.parent;
  if (parent) loadArchivosNavPath(parent);
});
document.getElementById('btn-archivos-nav-default').addEventListener('click', async () => {
  const { folder } = await api('/api/archivos/folder');
  await loadArchivosNavPath(folder);
});

// Panel izquierdo ("Este dispositivo"): NO es un explorador real (los
// navegadores no dejan listar el almacenamiento del propio dispositivo,
// ver comentario en index.html) -- es solo una lista de archivos ya
// elegidos con el selector nativo, pendientes de mandar con "->".
let archivosStagedFiles = [];

function renderArchivosStagedList() {
  const list = document.getElementById('archivos-staged-list');
  const emptyHint = document.getElementById('archivos-staged-empty-hint');
  list.innerHTML = '';
  emptyHint.classList.toggle('hidden', archivosStagedFiles.length > 0);
  archivosStagedFiles.forEach((file, index) => {
    const row = document.createElement('div');
    row.className = 'archivos-staged-item';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${file.name} (${formatArchivoSize(file.size)})`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'archivos-staged-remove';
    removeBtn.setAttribute('aria-label', 'Quitar de la lista');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      archivosStagedFiles.splice(index, 1);
      renderArchivosStagedList();
    });
    row.append(nameSpan, removeBtn);
    list.appendChild(row);
  });
  document.getElementById('btn-archivos-send').disabled = archivosStagedFiles.length === 0;
}

document.getElementById('btn-archivos-choose').addEventListener('click', () => {
  document.getElementById('archivos-file-input').click();
});
document.getElementById('archivos-file-input').addEventListener('change', (e) => {
  archivosStagedFiles.push(...Array.from(e.target.files || []));
  e.target.value = '';
  renderArchivosStagedList();
});

// Bucle de subida real (POST por archivo) -- separado del listener para
// poder llamarlo tanto al instante (ordenador) como tras la confirmacion
// del otro lado (movil, ver requestArchivosTransfer() mas abajo).
async function sendArchivosFilesNow(files) {
  for (const file of files) {
    try {
      await api(`/api/archivos${archivosPathQueryParam()}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      });
    } catch (err) {
      alert(`No se pudo subir "${file.name}": ${err.message}`);
    }
  }
  await refreshArchivosCurrentView();
}

document.getElementById('btn-archivos-send').addEventListener('click', async () => {
  if (archivosStagedFiles.length === 0) return;
  const files = archivosStagedFiles;
  // El ordenador copiando un archivo local a su propia carpeta
  // compartida no tiene "otro dispositivo" al que pedirle permiso (ver
  // server/archivosTransfers.js) -- sigue actuando al instante, sin
  // fricción nueva. Solo un movil pasa por la confirmacion del otro lado.
  if (isTrustedDevice()) {
    archivosStagedFiles = [];
    renderArchivosStagedList();
    await sendArchivosFilesNow(files);
    return;
  }
  const accepted = await requestArchivosTransfer('upload', files.map((f) => ({ name: f.name, size: f.size })));
  if (accepted) {
    archivosStagedFiles = [];
    renderArchivosStagedList();
    await sendArchivosFilesNow(files);
  }
});

document.getElementById('btn-archivos-receive').addEventListener('click', async () => {
  const names = Array.from(archivosSelectedRemote);
  if (names.length === 0) return;
  if (isTrustedDevice()) {
    for (const name of names) await downloadArchivo(name);
    return;
  }
  const accepted = await requestArchivosTransfer('download', names.map((name) => ({ name, size: 0 })));
  if (accepted) {
    for (const name of names) await downloadArchivo(name);
  }
});

// Crea la solicitud, espera a que el ordenador conteste (polling cada
// ARCHIVOS_TRANSFER_POLL_MS) y devuelve true/false segun si se acepto.
// Solo la llaman los dos listeners de arriba cuando NO somos el
// ordenador -- este nunca pasa por aqui.
async function requestArchivosTransfer(direction, files) {
  const btn = document.getElementById(direction === 'upload' ? 'btn-archivos-send' : 'btn-archivos-receive');
  const statusEl = document.getElementById('archivos-transfer-status');
  btn.disabled = true;
  statusEl.textContent = 'Solicitud enviada al ordenador. Esperando que la confirmen allí...';
  statusEl.classList.remove('hidden');
  try {
    const record = await api('/api/archivos/transfer-requests', {
      method: 'POST',
      body: JSON.stringify({ direction, files }),
    });
    archivosOutgoingRequestId = record.id;
    const finalStatus = await waitForArchivosTransferResolution(record.id);
    if (finalStatus === 'accepted') {
      statusEl.textContent = 'Confirmado. Transfiriendo...';
      return true;
    }
    if (finalStatus === 'rejected') {
      alert('El ordenador rechazó la transferencia.');
    } else {
      alert('Nadie confirmó la transferencia a tiempo. Inténtalo de nuevo.');
    }
    return false;
  } catch (err) {
    alert('No se pudo solicitar la transferencia: ' + err.message);
    return false;
  } finally {
    archivosOutgoingRequestId = null;
    statusEl.classList.add('hidden');
    updateArchivosReceiveButtonState();
    document.getElementById('btn-archivos-send').disabled = archivosStagedFiles.length === 0;
  }
}

function waitForArchivosTransferResolution(id) {
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      try {
        const record = await api(`/api/archivos/transfer-requests/${id}`);
        if (record.status !== 'pending') {
          clearInterval(timer);
          resolve(record.status); // 'accepted' | 'rejected' | 'expired'
        }
      } catch (err) {
        // 404 = ya se limpio (caducada hace rato): se trata como expirada.
        clearInterval(timer);
        resolve('expired');
      }
    }, ARCHIVOS_TRANSFER_POLL_MS);
  });
}

// Vigilancia de solicitudes entrantes -- solo tiene sentido en el
// ordenador (es el unico que puede aceptar/rechazar, ver requireTrusted
// en routes/archivos.js), y solo mientras la vista Archivos esta abierta
// (arranca/para en openArchivosView()/closeArchivosView()).
function startArchivosIncomingWatcher() {
  if (!isTrustedDevice() || archivosIncomingPollTimer) return;
  archivosIncomingPollTimer = setInterval(checkArchivosIncomingRequests, ARCHIVOS_TRANSFER_POLL_MS);
}
function stopArchivosIncomingWatcher() {
  if (archivosIncomingPollTimer) clearInterval(archivosIncomingPollTimer);
  archivosIncomingPollTimer = null;
}

async function checkArchivosIncomingRequests() {
  let pending;
  try {
    pending = await api('/api/archivos/transfer-requests');
  } catch (err) {
    return; // red caida un instante: se reintenta en el siguiente ciclo
  }
  for (const record of pending) {
    if (archivosHandledIncomingIds.has(record.id)) continue;
    archivosHandledIncomingIds.add(record.id);
    await promptArchivosIncomingRequest(record);
  }
}

async function promptArchivosIncomingRequest(record) {
  const verb = record.direction === 'upload' ? 'mandarte' : 'descargar de tu carpeta compartida';
  const list = record.files.map((f) => f.name).join(', ');
  const accept = confirm(`El móvil quiere ${verb} ${record.files.length} archivo(s): ${list}\n\n¿Aceptar?`);
  try {
    await api(`/api/archivos/transfer-requests/${record.id}/${accept ? 'accept' : 'reject'}`, { method: 'POST' });
  } catch (err) {
    // Ya caduco o se resolvio de otra forma mientras se decidia: no pasa nada.
  }
  if (accept) {
    // Si era una subida, el propio movil hace el POST real al ver
    // 'accepted' en su propio polling (hasta ARCHIVOS_TRANSFER_POLL_MS
    // de retraso) y LUEGO sube el archivo -- asi que un solo refresco
    // rapido aqui podria llegar antes de que el archivo exista de
    // verdad. Dos intentos escalonados (uno pronto, otro con margen de
    // sobra sobre el peor caso del polling del movil) sin necesidad de
    // inventar un tercer estado "completado" solo para esto.
    setTimeout(() => refreshArchivosCurrentView().catch(() => {}), 2000);
    setTimeout(() => refreshArchivosCurrentView().catch(() => {}), ARCHIVOS_TRANSFER_POLL_MS + 2000);
  }
}

// Bloque "Carpeta de destino": solo editable/explorable desde el
// ordenador (ver isTrustedDevice()) -- el servidor tambien lo protege por
// su cuenta (PUT /folder y GET /browse son requireTrusted), esto solo
// evita ensenar controles que en el movil fallarian igualmente.
async function refreshArchivosFolderUI() {
  const readonlyHint = document.getElementById('archivos-folder-readonly-hint');
  const editableRow = document.getElementById('archivos-folder-row');
  try {
    const { folder } = await api('/api/archivos/folder');
    if (isTrustedDevice()) {
      editableRow.classList.remove('hidden');
      readonlyHint.classList.add('hidden');
      document.getElementById('archivos-folder-path').value = folder;
    } else {
      editableRow.classList.add('hidden');
      readonlyHint.classList.remove('hidden');
      readonlyHint.textContent = `Carpeta configurada en el ordenador: ${folder}`;
    }
  } catch (err) {
    editableRow.classList.add('hidden');
    readonlyHint.classList.add('hidden');
  }
}

let archivosBrowsePath = null;

async function loadArchivosBrowserPath(path) {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  const data = await api(`/api/archivos/browse${qs}`);
  archivosBrowsePath = data.path;
  document.getElementById('archivos-browser-current-path').textContent = data.path;
  const list = document.getElementById('archivos-browser-list');
  list.innerHTML = '';
  const upBtn = document.getElementById('btn-archivos-browser-up');
  upBtn.disabled = !data.parent;
  upBtn.dataset.parent = data.parent || '';
  for (const folder of data.folders) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'archivos-browser-item';
    btn.textContent = folder.name;
    btn.addEventListener('click', () => loadArchivosBrowserPath(folder.path));
    list.appendChild(btn);
  }
}

document.getElementById('btn-archivos-browse').addEventListener('click', async () => {
  await loadArchivosBrowserPath(document.getElementById('archivos-folder-path').value || null);
  document.getElementById('archivos-folder-browser').classList.remove('hidden');
});
document.getElementById('btn-archivos-browser-up').addEventListener('click', () => {
  const parent = document.getElementById('btn-archivos-browser-up').dataset.parent;
  if (parent) loadArchivosBrowserPath(parent);
});
document.getElementById('btn-archivos-browser-cancel').addEventListener('click', () => {
  document.getElementById('archivos-folder-browser').classList.add('hidden');
});
document.getElementById('btn-archivos-browser-use').addEventListener('click', async () => {
  try {
    await api('/api/archivos/folder', { method: 'PUT', body: JSON.stringify({ folder: archivosBrowsePath }) });
    document.getElementById('archivos-folder-path').value = archivosBrowsePath;
    document.getElementById('archivos-folder-browser').classList.add('hidden');
    // Saltar el panel principal a la carpeta que se acaba de fijar como
    // nueva por defecto -- coherente con que "Carpeta por defecto" haga
    // lo mismo.
    await loadArchivosNavPath(archivosBrowsePath);
  } catch (err) {
    alert('No se pudo cambiar la carpeta: ' + err.message);
  }
});

document.getElementById('btn-archivos-check-update').addEventListener('click', () => {
  checkForNewRelease();
});

async function openArchivosView() {
  closeExtensionsView();
  document.getElementById('archivos-view').classList.remove('hidden');
  setCurrentScreen('archivos');
  document.getElementById('archivos-folder-browser').classList.add('hidden');
  archivosStagedFiles = [];
  renderArchivosStagedList();
  archivosSelectedRemote.clear();
  archivosCurrentPath = null;
  archivosHandledIncomingIds.clear();
  await Promise.all([refreshSyncStatusUI(), refreshArchivosFolderUI(), refreshVersionInfo()]);
  await refreshArchivosBrowsePanel();
  startArchivosIncomingWatcher();
}
function closeArchivosView() {
  stopArchivosIncomingWatcher();
  if (archivosOutgoingRequestId) {
    const id = archivosOutgoingRequestId;
    archivosOutgoingRequestId = null;
    // Best-effort: si una aceptacion llegara tarde sobre una solicitud
    // ya cancelada, el movil ya no la esta esperando (ver
    // requestArchivosTransfer) -- evita un estado confuso si se vuelve
    // a abrir Archivos mas tarde.
    api(`/api/archivos/transfer-requests/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  document.getElementById('archivos-view').classList.add('hidden');
  openExtensionsView();
}
document.getElementById('btn-open-archivos').addEventListener('click', openArchivosView);
document.getElementById('btn-close-archivos').addEventListener('click', closeArchivosView);

// ---------------------------------------------------------------------
// Extension "Viajes": mapa interactivo por paises (public/viajes-world-map.svg
// -- fuente: raphaellepuschitz/SVG-World-Map en GitHub, licencia MIT; los
// contornos de cada pais en si no son obra del autor de esa libreria,
// ver el README de ese repo. Cambiado desde el mapa anterior
// (flekschas/simple-world-map, CC BY-SA 3.0) porque este SÍ trae
// contorno real para Andorra/Vaticano/San Marino/Monaco/Liechtenstein
// -- ya no hace falta el marcador/pin para esos 5, ver
// VIAJES_MICRO_STATE_MARKERS mas abajo, reducido ahora a un unico caso
// (Taiwan) que sigue sin contorno propio en ESTE mapa. Cada pais es un
// <g id="XX"> (XX = ISO 3166-1 alfa-2 EN MAYUSCULAS en este archivo
// concreto) con uno o mas <path>/<circle> hijos que YA traen su propio
// fill/stroke fijo -- normalizado a minusculas via dataset.countryCode
// al cargar (ver loadViajesMap), sin tocar el atributo id real del SVG.
// Nombres en español en viajesCountries.js, cargado ANTES que este
// archivo) + bitacora de cada viaje, que puede tocar VARIOS paises (ej.
// un interrail) -- por eso "countries" es siempre un array, nunca un
// pais suelto.
// ---------------------------------------------------------------------
let viajesTrips = [];
let viajesCurrentTrip = null; // viaje abierto en el detalle/bitacora ahora mismo
let viajesCurrentEntries = [];
let viajesMapLoaded = false;
let viajesLazyFieldsReady = false;
let viajesTripColorField = null;
let viajesPendingAttachmentEntryId = null;
let viajesPendingAttachmentFile = null;

// createColorField vive en settings.js, que carga DESPUES de app.js --
// igual que ya pasa con Finanzas/Gimnasio (ver setupFinanzasIconColorFields),
// este campo se crea de forma perezosa la primera vez que se abre la
// vista, no aqui arriba a nivel de modulo.
function setupViajesLazyFields() {
  if (viajesLazyFieldsReady) return;
  viajesLazyFieldsReady = true;
  viajesTripColorField = createColorField({ initialValue: '#5b8cff' });
  document.getElementById('viajes-trip-color-field').appendChild(viajesTripColorField.element);
}

// Selector de VARIOS paises a la vez: buscador + chips removibles,
// reutilizando el mismo popover (positionFixedPopover/closeAllPopovers,
// las dos en settings.js) que ya usa createSelectField -- se llaman solo
// dentro de manejadores de eventos (clic, foco), nunca al cargar la
// pagina, asi que el orden de carga app.js->settings.js no es problema
// (mismo criterio ya documentado para createColorField/createIconField
// mas arriba). A diferencia de createSelectField, esta funcion SI se
// puede llamar a nivel de modulo porque no toca settings.js hasta que
// alguien de verdad hace clic.
function createCountryPickerField({ initialValues = [] } = {}) {
  let selected = [...initialValues];
  const root = document.createElement('div');
  root.className = 'country-picker-field';

  const chipsRow = document.createElement('div');
  chipsRow.className = 'country-picker-chips';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'country-picker-input';
  input.placeholder = 'Buscar país...';

  const popover = document.createElement('div');
  popover.className = 'select-popover hidden';
  document.body.appendChild(popover);

  function renderChips() {
    chipsRow.innerHTML = '';
    selected.forEach((code) => {
      const chip = document.createElement('span');
      chip.className = 'country-picker-chip';
      chip.textContent = VIAJES_COUNTRY_NAMES[code] || code;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', 'Quitar');
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        selected = selected.filter((c) => c !== code);
        renderChips();
      });
      chip.appendChild(removeBtn);
      chipsRow.appendChild(chip);
    });
  }

  function renderOptions(filterText) {
    popover.innerHTML = '';
    const filter = (filterText || '').trim().toLowerCase();
    const entries = Object.entries(VIAJES_COUNTRY_NAMES)
      .filter(([code, name]) => !selected.includes(code) && (!filter || name.toLowerCase().includes(filter)))
      .sort((a, b) => a[1].localeCompare(b[1], 'es'));
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'select-option-empty';
      empty.textContent = 'Sin resultados';
      popover.appendChild(empty);
      return;
    }
    entries.slice(0, 40).forEach(([code, name]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-option';
      item.textContent = name;
      item.addEventListener('click', () => {
        selected.push(code);
        input.value = '';
        renderChips();
        renderOptions('');
        popover.classList.add('hidden');
        input.focus();
      });
      popover.appendChild(item);
    });
  }

  input.addEventListener('focus', () => {
    closeAllPopovers(popover);
    renderOptions(input.value);
    popover.classList.remove('hidden');
    positionFixedPopover(input, popover, { width: Math.max(220, input.getBoundingClientRect().width) });
  });
  input.addEventListener('input', () => {
    renderOptions(input.value);
    popover.classList.remove('hidden');
  });

  root.append(chipsRow, input);
  renderChips();

  return {
    element: root,
    getValue: () => selected,
    setValue: (codes) => {
      selected = [...(codes || [])];
      renderChips();
    },
  };
}

const viajesTripCountriesField = createCountryPickerField({ initialValues: [] });
document.getElementById('viajes-trip-countries-field').appendChild(viajesTripCountriesField.element);

// Cuenta por defecto DE ESTE VIAJE (ya no es un ajuste global de
// Configuración -- Koku prefiere elegirla viaje a viaje). Solo tiene
// sentido con el enlace con Finanzas activado, asi que el <label> que la
// envuelve se oculta/muestra con el checkbox (ver el listener de
// viajes-trip-finanzas-linked mas abajo), mismo criterio que
// refreshViajesGastoModalFields.
const viajesTripDefaultAccountField = createSelectField({ options: [{ value: '', label: 'Sin cuenta por defecto' }], initialValue: '' });
document.getElementById('viajes-trip-default-account-field').appendChild(viajesTripDefaultAccountField.element);

const viajesTripStartField = createDateField({ initialValue: null, allowClear: true, placeholder: 'Sin fecha' });
document.getElementById('viajes-trip-start-field').appendChild(viajesTripStartField.element);
const viajesTripEndField = createDateField({ initialValue: null, allowClear: true, placeholder: 'Sin fecha' });
document.getElementById('viajes-trip-end-field').appendChild(viajesTripEndField.element);
const viajesEntryDateField = createDateField({ initialValue: new Date() });
document.getElementById('viajes-entry-date-field').appendChild(viajesEntryDateField.element);

const viajesLinkFinanzasAccountField = createSelectField({ options: [], initialValue: '' });
document.getElementById('viajes-link-finanzas-account-field').appendChild(viajesLinkFinanzasAccountField.element);
const viajesLinkFinanzasCategoryField = createSelectField({ options: [{ value: '', label: 'Sin categoría' }], initialValue: '' });
document.getElementById('viajes-link-finanzas-category-field').appendChild(viajesLinkFinanzasCategoryField.element);

// Input de archivo compartido por todas las entradas (no hay uno fijo en
// el HTML porque las entradas se pintan dinamicamente) -- se crea una
// sola vez, y viajesPendingAttachmentEntryId dice a que entrada
// pertenece la proxima foto que se elija.
const viajesSharedFileInput = document.createElement('input');
viajesSharedFileInput.type = 'file';
viajesSharedFileInput.accept = 'image/*';
viajesSharedFileInput.hidden = true;
document.body.appendChild(viajesSharedFileInput);
viajesSharedFileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  openViajesAttachmentModal(file);
});

function viajesCountryLabel(code) {
  return VIAJES_COUNTRY_NAMES[code] || code;
}
function viajesTripCountriesLabel(trip) {
  return trip.countries.map(viajesCountryLabel).join(', ');
}
function viajesTripDatesLabel(trip) {
  if (!trip.startDate) return '';
  return trip.endDate && trip.endDate !== trip.startDate ? `${trip.startDate} – ${trip.endDate}` : trip.startDate;
}

async function loadViajesTrips() {
  viajesTrips = await api('/api/viajes-trips');
}

function renderViajesTripCards(container, trips, onClick) {
  container.innerHTML = '';
  trips.forEach((trip) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'viajes-trip-card';
    card.style.setProperty('--viajes-trip-color', trip.color);
    const dates = viajesTripDatesLabel(trip);
    card.innerHTML = `
      <span class="viajes-trip-card-name">${escapeHtml(trip.name)}</span>
      <span class="viajes-trip-card-countries">${escapeHtml(viajesTripCountriesLabel(trip))}</span>
      ${dates ? `<span class="hint">${escapeHtml(dates)}</span>` : ''}
      <span class="hint">${trip.entryCount} entrada${trip.entryCount === 1 ? '' : 's'}</span>
    `;
    card.addEventListener('click', () => onClick(trip));
    container.appendChild(card);
  });
}

// --- Filtros de "Mis viajes" (año/mes/país, varios a la vez) ------------
// Mismo patron "build once" que Lecturas (renderLecturasItemFilters) --
// los campos con componente propio se crean UNA vez a nivel de modulo,
// las llamadas siguientes solo actualizan .setOptions()/.setValue() para
// no acumular popovers huerfanos. Los 3 son ahora multi-seleccion
// (createMultiSelectField): se puede filtrar por varios años, varios
// meses y varios países a la vez, cada uno listado como chip removible
// debajo de su desplegable.
let viajesFilters = { years: [], months: [], countries: [], multiCountryOk: true };

// 1900-2100 de sobra para cualquier viaje real -- mismo criterio de rango
// fijo ya usado en otros selectores de año de la app (Ahorro de Finanzas).
// Orden DESCENDENTE (2100 arriba, 1900 abajo) -- mas intuitivo para elegir
// un año reciente, que es lo mas habitual, sin tener que bajar del todo.
const VIAJES_YEAR_OPTIONS = [];
for (let y = 2100; y >= 1900; y--) VIAJES_YEAR_OPTIONS.push({ value: String(y), label: String(y) });

const viajesFilterYearField = createMultiSelectField({
  options: VIAJES_YEAR_OPTIONS,
  initialValues: [],
  placeholder: 'Año',
  // Sin ningun año elegido, abrir el desplegable centrado en el actual en
  // vez de arriba del todo -- solo orienta, no aplica ningun filtro.
  scrollToValue: String(new Date().getFullYear()),
  onChange: (values) => {
    viajesFilters.years = values;
    renderViajesTripsList();
  },
});

const viajesFilterMonthField = createMultiSelectField({
  options: FINANZAS_MONTH_OPTIONS,
  initialValues: [],
  placeholder: 'Mes',
  onChange: (values) => {
    viajesFilters.months = values;
    renderViajesTripsList();
  },
});

const viajesFilterCountryField = createMultiSelectField({
  options: [],
  initialValues: [],
  placeholder: 'País',
  onChange: (values) => {
    viajesFilters.countries = values;
    renderViajesTripsList();
  },
});

function renderViajesFilters() {
  const container = document.getElementById('viajes-trips-filters');
  if (!container.dataset.built) {
    container.dataset.built = '1';

    const yearWrap = document.createElement('div');
    yearWrap.className = 'viajes-filter-field';
    yearWrap.appendChild(viajesFilterYearField.element);

    const monthWrap = document.createElement('div');
    monthWrap.className = 'viajes-filter-field';
    monthWrap.appendChild(viajesFilterMonthField.element);

    const countryWrap = document.createElement('div');
    countryWrap.className = 'viajes-filter-field';
    countryWrap.appendChild(viajesFilterCountryField.element);

    // Mismo criterio que "Cuenta para el límite mensual"/"Gasto fijo" en
    // Finanzas: un interruptor de un solo ajuste on/off, no una
    // seleccion de varios de una lista -- por eso es .checkbox-row, no
    // .styled-checkbox (esa es para listas/arboles de seleccion).
    const multiLabel = document.createElement('label');
    multiLabel.className = 'checkbox-row viajes-filter-multi-country';
    const multiCheckbox = document.createElement('input');
    multiCheckbox.type = 'checkbox';
    multiCheckbox.id = 'viajes-filter-multi-country';
    multiCheckbox.checked = true;
    multiCheckbox.addEventListener('change', () => {
      viajesFilters.multiCountryOk = multiCheckbox.checked;
      renderViajesTripsList();
    });
    multiLabel.append(multiCheckbox, document.createTextNode(' Incluir viajes con más países'));

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.id = 'btn-clear-viajes-filters';
    clearBtn.className = 'secondary-btn';
    clearBtn.textContent = 'Quitar filtros';
    clearBtn.addEventListener('click', () => {
      viajesFilters = { years: [], months: [], countries: [], multiCountryOk: true };
      viajesFilterYearField.setValue([]);
      viajesFilterMonthField.setValue([]);
      viajesFilterCountryField.setValue([]);
      multiCheckbox.checked = true;
      renderViajesTripsList();
    });

    container.append(yearWrap, monthWrap, countryWrap, multiLabel, clearBtn);
  }

  // Los paises del desplegable son los que ya se usan en algun viaje --
  // se recalcula cada vez porque cambia al crear/editar/borrar viajes.
  const usedCountries = [...new Set(viajesTrips.flatMap((t) => t.countries))].sort((a, b) =>
    viajesCountryLabel(a).localeCompare(viajesCountryLabel(b))
  );
  viajesFilterCountryField.setOptions(usedCountries.map((c) => ({ value: c, label: viajesCountryLabel(c) })));
  viajesFilterYearField.setValue(viajesFilters.years);
  viajesFilterMonthField.setValue(viajesFilters.months);
  viajesFilterCountryField.setValue(viajesFilters.countries);
  document.getElementById('viajes-filter-multi-country').checked = viajesFilters.multiCountryOk;
}

// Año/mes comparan contra el startDate del viaje -- un viaje sin fecha no
// aparece si se filtra por fecha (igual que ya no aparece "ordenado" por
// fecha en ningun sitio de Viajes); con varios años/meses elegidos, basta
// con que coincida con UNO de ellos. Con uno o varios países elegidos: si
// multiCountryOk esta marcado, cualquier viaje que TOQUE alguno de esos
// países cuenta (aunque tenga otros paises mas); desmarcado, solo cuentan
// los viajes cuyos países esten TODOS dentro de los elegidos (para un
// solo país elegido esto equivale a "su UNICO país sea ese", que es la
// distincion que pidio Koku originalmente -- con varios países elegidos
// generaliza a "España y Francia" cuando ambos estan en el filtro, pero
// no un viaje que ademas toque Italia).
function viajesTripMatchesFilters(trip) {
  if (viajesFilters.years.length) {
    const y = trip.startDate ? trip.startDate.slice(0, 4) : null;
    if (!y || !viajesFilters.years.includes(y)) return false;
  }
  if (viajesFilters.months.length) {
    const m = trip.startDate ? trip.startDate.slice(5, 7) : null;
    if (!m || !viajesFilters.months.includes(m)) return false;
  }
  if (viajesFilters.countries.length) {
    const touchesAny = trip.countries.some((c) => viajesFilters.countries.includes(c));
    if (!touchesAny) return false;
    if (!viajesFilters.multiCountryOk) {
      const onlySelected = trip.countries.every((c) => viajesFilters.countries.includes(c));
      if (!onlySelected) return false;
    }
  }
  return true;
}

function renderViajesTripsList() {
  renderViajesFilters();
  const filtered = viajesTrips.filter(viajesTripMatchesFilters);
  const list = document.getElementById('viajes-trips-list');
  const empty = document.getElementById('viajes-trips-empty');
  const filtersActive = !!(viajesFilters.years.length || viajesFilters.months.length || viajesFilters.countries.length);
  empty.textContent =
    filtersActive && viajesTrips.length > 0
      ? 'Ningún viaje coincide con estos filtros.'
      : 'Todavía no tienes ningún viaje. Crea uno arriba.';
  empty.classList.toggle('hidden', filtered.length > 0);
  renderViajesTripCards(list, filtered, openViajesTripDetail);
}

// --- Modal crear/editar viaje -------------------------------------------
function refreshViajesTripDefaultAccountVisibility() {
  const linked = document.getElementById('viajes-trip-finanzas-linked').checked;
  document.getElementById('viajes-trip-default-account-label').classList.toggle('hidden', !linked);
}
document.getElementById('viajes-trip-finanzas-linked').addEventListener('change', refreshViajesTripDefaultAccountVisibility);

async function openViajesTripModal(trip, prefillCountry) {
  setupViajesLazyFields();
  document.getElementById('viajes-trip-modal-title').textContent = trip ? 'Editar viaje' : 'Nuevo viaje';
  document.getElementById('viajes-trip-id').value = trip ? trip.id : '';
  document.getElementById('viajes-trip-name').value = trip ? trip.name : '';
  document.getElementById('viajes-trip-description').value = (trip && trip.description) || '';
  viajesTripCountriesField.setValue(trip ? trip.countries : prefillCountry ? [prefillCountry] : []);
  viajesTripStartField.setValue(trip && trip.startDate ? new Date(`${trip.startDate}T00:00:00`) : null);
  viajesTripEndField.setValue(trip && trip.endDate ? new Date(`${trip.endDate}T00:00:00`) : null);
  viajesTripColorField.setValue(trip ? trip.color : '#5b8cff');
  document.getElementById('viajes-trip-finanzas-linked').checked = trip ? !!trip.finanzasLinked : false;
  const accounts = await api('/api/finanzas-accounts');
  viajesTripDefaultAccountField.setOptions([{ value: '', label: 'Sin cuenta por defecto' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]);
  viajesTripDefaultAccountField.setValue(trip && trip.defaultAccountId ? trip.defaultAccountId : '');
  refreshViajesTripDefaultAccountVisibility();
  document.getElementById('btn-delete-viajes-trip-modal').classList.toggle('hidden', !trip);
  document.getElementById('viajes-trip-modal').classList.remove('hidden');
}
function closeViajesTripModal() {
  document.getElementById('viajes-trip-modal').classList.add('hidden');
}
document.getElementById('btn-new-viaje').addEventListener('click', () => openViajesTripModal(null));
document.getElementById('btn-close-viajes-trip').addEventListener('click', closeViajesTripModal);
document.getElementById('btn-cancel-viajes-trip').addEventListener('click', closeViajesTripModal);

document.getElementById('viajes-trip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('viajes-trip-id').value;
  const payload = {
    name: document.getElementById('viajes-trip-name').value.trim(),
    countries: viajesTripCountriesField.getValue(),
    startDate: viajesTripStartField.getValue() ? toDateKey(viajesTripStartField.getValue()) : null,
    endDate: viajesTripEndField.getValue() ? toDateKey(viajesTripEndField.getValue()) : null,
    color: viajesTripColorField.getValue(),
    description: document.getElementById('viajes-trip-description').value.trim() || null,
    finanzasLinked: document.getElementById('viajes-trip-finanzas-linked').checked,
    defaultAccountId: viajesTripDefaultAccountField.getValue() || null,
  };
  try {
    const saved = id
      ? await api(`/api/viajes-trips/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/viajes-trips', { method: 'POST', body: JSON.stringify(payload) });
    closeViajesTripModal();
    await loadViajesTrips();
    renderViajesTripsList();
    refreshViajesMapHighlights();
    if (viajesCurrentTrip && String(viajesCurrentTrip.id) === String(saved.id)) {
      viajesCurrentTrip = saved;
      renderViajesTripDetailHeader();
    }
    // Se acaba de ACTIVAR el enlace y el viaje ya tenia gastos/ingresos
    // sin enlazar -- se pregunta si tambien esos, en vez de enlazarlos a
    // ciegas (ver POST /:id/link-existing-movements en viajesTrips.js).
    // El propio modal se acaba de cerrar (closeViajesTripModal(), arriba)
    // antes de mostrar este aviso, asi que no hay solape de modales.
    if (saved.hasUnlinkedMovements) {
      const wantsBulkLink = await showAppConfirm(
        `Este viaje ya tenía ${saved.unlinkedCount} gasto${saved.unlinkedCount === 1 ? '' : 's'}/ingreso${saved.unlinkedCount === 1 ? '' : 's'} antes de activar el enlace. ¿También quieres enlazarlos con la cuenta por defecto de este viaje?`
      );
      if (wantsBulkLink) {
        try {
          await api(`/api/viajes-trips/${saved.id}/link-existing-movements`, { method: 'POST' });
          if (viajesCurrentTrip && String(viajesCurrentTrip.id) === String(saved.id)) await refreshViajesEntries();
        } catch (err) {
          await showAppAlert('No se pudieron enlazar los movimientos anteriores: ' + err.message);
        }
      }
    }
  } catch (err) {
    await showAppAlert('No se pudo guardar el viaje: ' + err.message);
  }
});

document.getElementById('btn-delete-viajes-trip-modal').addEventListener('click', async () => {
  const id = document.getElementById('viajes-trip-id').value;
  if (!id || !confirm('¿Eliminar este viaje entero, con toda su bitácora y fotos?')) return;
  await api(`/api/viajes-trips/${id}`, { method: 'DELETE' });
  closeViajesTripModal();
  await loadViajesTrips();
  renderViajesTripsList();
  refreshViajesMapHighlights();
  backToViajesTrips();
});

document.getElementById('btn-edit-viajes-trip').addEventListener('click', () => {
  if (viajesCurrentTrip) openViajesTripModal(viajesCurrentTrip);
});
document.getElementById('btn-delete-viajes-trip').addEventListener('click', async () => {
  if (!viajesCurrentTrip || !confirm('¿Eliminar este viaje entero, con toda su bitácora y fotos?')) return;
  await api(`/api/viajes-trips/${viajesCurrentTrip.id}`, { method: 'DELETE' });
  await loadViajesTrips();
  renderViajesTripsList();
  refreshViajesMapHighlights();
  backToViajesTrips();
});

// --- Detalle de viaje (bitacora) -----------------------------------------
function renderViajesTripDetailHeader() {
  const trip = viajesCurrentTrip;
  document.getElementById('viajes-trip-detail-name').textContent = trip.name;
  document.getElementById('viajes-trip-detail-countries').textContent = viajesTripCountriesLabel(trip);
  document.getElementById('viajes-trip-detail-dates').textContent = viajesTripDatesLabel(trip);
  document.getElementById('viajes-trip-detail-dates').classList.toggle('hidden', !viajesTripDatesLabel(trip));
  document.getElementById('viajes-trip-detail-description').textContent = trip.description || '';
  document.getElementById('viajes-trip-detail-description').classList.toggle('hidden', !trip.description);
}

async function openViajesTripDetail(trip) {
  viajesCurrentTrip = trip;
  document.getElementById('viajes-trips-list-panel').classList.add('hidden');
  document.getElementById('viajes-trip-detail-panel').classList.remove('hidden');
  renderViajesTripDetailHeader();
  await refreshViajesEntries();
}
function backToViajesTrips() {
  viajesCurrentTrip = null;
  document.getElementById('viajes-trip-detail-panel').classList.add('hidden');
  document.getElementById('viajes-trips-list-panel').classList.remove('hidden');
}
document.getElementById('btn-back-viajes-trips').addEventListener('click', backToViajesTrips);

// El boton "Vincular a Finanzas" ya no depende de un ajuste global
// aparte (ver viajesCurrentTrip.finanzasLinked, cargado con el propio
// viaje) -- no hace falta ninguna peticion extra aqui.
async function refreshViajesEntries() {
  viajesCurrentEntries = await api(`/api/viajes-entries?tripId=${viajesCurrentTrip.id}`);
  renderViajesEntriesList();
}

// Una foto suelta -- SIN importe nunca (eso es un movimiento, ver
// renderViajesMovement mas abajo). Solo se puede borrar.
function renderViajesAttachment(att) {
  const wrap = document.createElement('div');
  wrap.className = 'viajes-attachment';
  const img = document.createElement('img');
  img.src = att.url;
  img.alt = '';
  img.className = 'viajes-attachment-photo';
  wrap.appendChild(img);

  const actions = document.createElement('div');
  actions.className = 'viajes-attachment-actions';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'danger-btn';
  deleteBtn.textContent = 'Borrar';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('¿Borrar esta foto?')) return;
    await api(`/api/viajes-entries/attachments/${att.id}`, { method: 'DELETE' });
    await refreshViajesEntries();
  });
  actions.appendChild(deleteBtn);
  wrap.appendChild(actions);
  return wrap;
}

// Un movimiento (gasto o ingreso), con foto de ticket opcional --
// "Vincular a Finanzas" esta SIEMPRE disponible si todavia no esta
// enlazado (no exige que el viaje tenga finanzas_linked activado, sirve
// para enlazar uno suelto sin activar el ajuste de todo el viaje).
function renderViajesMovement(mv) {
  const wrap = document.createElement('div');
  wrap.className = 'viajes-attachment';
  if (mv.attachmentUrl) {
    const img = document.createElement('img');
    img.src = mv.attachmentUrl;
    img.alt = '';
    img.className = 'viajes-attachment-photo';
    wrap.appendChild(img);
  }

  const actions = document.createElement('div');
  actions.className = 'viajes-attachment-actions';

  const amountBadge = document.createElement('span');
  amountBadge.className = `viajes-movement-amount viajes-movement-amount-${mv.type}`;
  amountBadge.textContent = `${mv.type === 'income' ? '+' : '−'}${mv.amount.toFixed(2)} €`;
  actions.appendChild(amountBadge);

  if (mv.description) {
    const desc = document.createElement('span');
    desc.className = 'hint';
    desc.textContent = mv.description;
    actions.appendChild(desc);
  }

  if (mv.finanzasTransactionId) {
    const linkedBadge = document.createElement('span');
    linkedBadge.className = 'viajes-attachment-linked';
    linkedBadge.textContent = '✓ En Finanzas';
    actions.appendChild(linkedBadge);
    const unlinkBtn = document.createElement('button');
    unlinkBtn.type = 'button';
    unlinkBtn.className = 'secondary-btn';
    unlinkBtn.textContent = 'Desvincular';
    unlinkBtn.addEventListener('click', async () => {
      await api(`/api/viajes-entries/movements/${mv.id}/link-finanzas`, { method: 'DELETE' });
      await refreshViajesEntries();
    });
    actions.appendChild(unlinkBtn);
  } else {
    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'secondary-btn';
    linkBtn.textContent = 'Vincular a Finanzas';
    linkBtn.addEventListener('click', () => openViajesLinkFinanzasModal(mv));
    actions.appendChild(linkBtn);
  }

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'icon-btn';
  editBtn.setAttribute('aria-label', 'Editar movimiento');
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => openViajesGastoModal(mv));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'danger-btn';
  deleteBtn.textContent = 'Borrar';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('¿Borrar este movimiento?' + (mv.finanzasTransactionId ? ' También se borrará el movimiento de Finanzas enlazado.' : ''))) return;
    await api(`/api/viajes-entries/movements/${mv.id}`, { method: 'DELETE' });
    await refreshViajesEntries();
  });
  actions.appendChild(deleteBtn);

  wrap.appendChild(actions);
  return wrap;
}

function renderViajesEntriesList() {
  const list = document.getElementById('viajes-entries-list');
  list.innerHTML = '';
  document.getElementById('viajes-entries-empty').classList.toggle('hidden', viajesCurrentEntries.length > 0);
  viajesCurrentEntries.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'viajes-entry-card';

    const header = document.createElement('div');
    header.className = 'viajes-entry-card-header';
    const dateEl = document.createElement('strong');
    dateEl.textContent = entry.date;
    header.appendChild(dateEl);
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.setAttribute('aria-label', 'Editar entrada');
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => openViajesEntryModal(entry));
    header.appendChild(editBtn);
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    header.appendChild(spacer);
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger-btn';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta entrada, con sus fotos?')) return;
      await api(`/api/viajes-entries/${entry.id}`, { method: 'DELETE' });
      await refreshViajesEntries();
      await loadViajesTrips(); // el contador de entradas del viaje cambia
    });
    header.appendChild(deleteBtn);
    card.appendChild(header);

    if (entry.content) {
      const content = document.createElement('p');
      content.className = 'viajes-entry-card-content';
      content.textContent = entry.content;
      card.appendChild(content);
    }

    const attachmentsRow = document.createElement('div');
    attachmentsRow.className = 'viajes-entry-attachments';
    entry.attachments.forEach((att) => attachmentsRow.appendChild(renderViajesAttachment(att)));
    entry.movements.forEach((mv) => attachmentsRow.appendChild(renderViajesMovement(mv)));
    card.appendChild(attachmentsRow);

    const addActionsRow = document.createElement('div');
    addActionsRow.className = 'viajes-entry-add-actions';
    const addPhotoBtn = document.createElement('button');
    addPhotoBtn.type = 'button';
    addPhotoBtn.className = 'secondary-btn';
    addPhotoBtn.textContent = '+ Foto';
    addPhotoBtn.addEventListener('click', () => {
      viajesPendingAttachmentEntryId = entry.id;
      viajesSharedFileInput.click();
    });
    addActionsRow.appendChild(addPhotoBtn);

    const addGastoBtn = document.createElement('button');
    addGastoBtn.type = 'button';
    addGastoBtn.className = 'secondary-btn';
    addGastoBtn.textContent = '+ Gasto';
    addGastoBtn.addEventListener('click', () => openViajesGastoModal(null, entry));
    addActionsRow.appendChild(addGastoBtn);
    card.appendChild(addActionsRow);

    list.appendChild(card);
  });
}

// --- Modal crear/editar entrada -------------------------------------------
function openViajesEntryModal(entry) {
  document.getElementById('viajes-entry-modal-title').textContent = entry ? 'Editar entrada' : 'Nueva entrada';
  document.getElementById('viajes-entry-id').value = entry ? entry.id : '';
  document.getElementById('viajes-entry-content').value = (entry && entry.content) || '';
  viajesEntryDateField.setValue(entry ? new Date(`${entry.date}T00:00:00`) : new Date());
  document.getElementById('viajes-entry-modal').classList.remove('hidden');
}
function closeViajesEntryModal() {
  document.getElementById('viajes-entry-modal').classList.add('hidden');
}
document.getElementById('btn-new-viajes-entry').addEventListener('click', () => openViajesEntryModal(null));
document.getElementById('btn-close-viajes-entry').addEventListener('click', closeViajesEntryModal);
document.getElementById('btn-cancel-viajes-entry').addEventListener('click', closeViajesEntryModal);

document.getElementById('viajes-entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('viajes-entry-id').value;
  const payload = {
    tripId: viajesCurrentTrip.id,
    date: toDateKey(viajesEntryDateField.getValue()),
    content: document.getElementById('viajes-entry-content').value.trim() || null,
  };
  try {
    if (id) await api(`/api/viajes-entries/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/viajes-entries', { method: 'POST', body: JSON.stringify(payload) });
    closeViajesEntryModal();
    await refreshViajesEntries();
    await loadViajesTrips();
  } catch (err) {
    alert('No se pudo guardar la entrada: ' + err.message);
  }
});

// --- Subir foto (SIEMPRE sin importe -- eso es "+ Gasto") --------------
function openViajesAttachmentModal(file) {
  viajesPendingAttachmentFile = file;
  document.getElementById('viajes-attachment-filename').textContent = file.name;
  document.getElementById('viajes-attachment-modal').classList.remove('hidden');
}
function closeViajesAttachmentModal() {
  viajesPendingAttachmentFile = null;
  viajesPendingAttachmentEntryId = null;
  document.getElementById('viajes-attachment-modal').classList.add('hidden');
}
document.getElementById('btn-close-viajes-attachment').addEventListener('click', closeViajesAttachmentModal);
document.getElementById('btn-cancel-viajes-attachment').addEventListener('click', closeViajesAttachmentModal);
document.getElementById('btn-confirm-viajes-attachment').addEventListener('click', async () => {
  const file = viajesPendingAttachmentFile;
  const entryId = viajesPendingAttachmentEntryId;
  const btn = document.getElementById('btn-confirm-viajes-attachment');
  btn.disabled = true;
  try {
    await api(`/api/viajes-entries/${entryId}/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    closeViajesAttachmentModal();
    await refreshViajesEntries();
  } catch (err) {
    alert('No se pudo subir la foto: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

// --- Crear/editar un movimiento (gasto o ingreso) -----------------------
// Cuenta/Categoria (createSelectField, sin dependencia de settings.js al
// crearse -- solo dentro de sus popovers, ver el mismo criterio ya usado
// para viajesLinkFinanzasAccountField/CategoryField) creadas a nivel de
// modulo; sus opciones se rellenan solo si el viaje tiene el enlace con
// Finanzas activado (ver refreshViajesGastoModalFields).
const viajesGastoTypeField = createSelectField({
  options: [
    { value: 'expense', label: 'Gasto' },
    { value: 'income', label: 'Ingreso' },
  ],
  initialValue: 'expense',
  onChange: () => refreshViajesGastoModalFields(),
});
document.getElementById('viajes-gasto-type-field').appendChild(viajesGastoTypeField.element);

const viajesGastoAccountField = createSelectField({ options: [], initialValue: '' });
document.getElementById('viajes-gasto-account-field').appendChild(viajesGastoAccountField.element);

const viajesGastoCategoryField = createSelectField({ options: [{ value: '', label: 'Sin categoría' }], initialValue: '' });
document.getElementById('viajes-gasto-category-field').appendChild(viajesGastoCategoryField.element);

// Cuenta/Categoria/"Cuenta para el limite mensual" SOLO se ven si el
// VIAJE tiene el enlace con Finanzas activado -- si no, es un simple
// apunte local sin nada de Finanzas de por medio (mismo patron de
// mostrar/ocultar por tipo que refreshFinanzasTransactionTypeFields).
function refreshViajesGastoModalFields() {
  const isExpense = viajesGastoTypeField.getValue() === 'expense';
  const linked = !!(viajesCurrentTrip && viajesCurrentTrip.finanzasLinked);
  document.getElementById('viajes-gasto-account-label').classList.toggle('hidden', !linked);
  document.getElementById('viajes-gasto-category-label').classList.toggle('hidden', !linked || !isExpense);
  document.getElementById('viajes-gasto-counts-row').classList.toggle('hidden', !linked || !isExpense);
}

let viajesGastoEditingId = null;
let viajesGastoEntryId = null;
let viajesGastoPendingPhotoFile = null;

// La foto de ticket solo se puede elegir al CREAR (movement === null) --
// editar un movimiento ya creado no permite cambiar/quitar su foto
// (limitacion aceptada a proposito, evita complicar el modal por algo no
// pedido). "entry" solo hace falta al crear, para saber a que entrada
// pertenece -- al editar ya se saca de movement.entryId.
async function openViajesGastoModal(movement, entry) {
  viajesGastoEditingId = movement ? movement.id : null;
  viajesGastoEntryId = movement ? movement.entryId : entry.id;
  viajesGastoPendingPhotoFile = null;
  document.getElementById('viajes-gasto-modal-title').textContent = movement ? 'Editar movimiento' : 'Nuevo gasto/ingreso';
  document.getElementById('viajes-gasto-id').value = movement ? movement.id : '';
  viajesGastoTypeField.setValue(movement ? movement.type : 'expense');
  document.getElementById('viajes-gasto-amount').value = movement ? movement.amount : '';
  document.getElementById('viajes-gasto-description').value = (movement && movement.description) || '';
  document.getElementById('viajes-gasto-counts').checked = movement ? movement.countsTowardBudget : true;

  const linked = !!(viajesCurrentTrip && viajesCurrentTrip.finanzasLinked);
  if (linked) {
    const [accounts, categories] = await Promise.all([api('/api/finanzas-accounts'), api('/api/finanzas-categories')]);
    viajesGastoAccountField.setOptions(accounts.map((a) => ({ value: a.id, label: a.name })));
    viajesGastoCategoryField.setOptions([{ value: '', label: 'Sin categoría' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]);
    let defaultAccountId = accounts[0] ? accounts[0].id : '';
    if (!movement) {
      // Cuenta por defecto DE ESTE VIAJE (viajesCurrentTrip.defaultAccountId,
      // ya cargada con el viaje -- ya no es un ajuste global de
      // Configuración), solo al CREAR -- editar respeta la cuenta que ya
      // tenia.
      if (viajesCurrentTrip.defaultAccountId && accounts.some((a) => a.id === viajesCurrentTrip.defaultAccountId)) {
        defaultAccountId = viajesCurrentTrip.defaultAccountId;
      }
    }
    viajesGastoAccountField.setValue(defaultAccountId);
    viajesGastoCategoryField.setValue('');
  }

  document.getElementById('viajes-gasto-photo-label').classList.toggle('hidden', !!movement);
  document.getElementById('viajes-gasto-photo-input').value = '';
  document.getElementById('viajes-gasto-photo-filename').classList.add('hidden');
  document.getElementById('btn-delete-viajes-gasto').classList.toggle('hidden', !movement);
  refreshViajesGastoModalFields();
  document.getElementById('viajes-gasto-modal').classList.remove('hidden');
}
function closeViajesGastoModal() {
  viajesGastoEditingId = null;
  viajesGastoEntryId = null;
  viajesGastoPendingPhotoFile = null;
  document.getElementById('viajes-gasto-modal').classList.add('hidden');
}
document.getElementById('btn-close-viajes-gasto').addEventListener('click', closeViajesGastoModal);
document.getElementById('btn-cancel-viajes-gasto').addEventListener('click', closeViajesGastoModal);
document.getElementById('viajes-gasto-photo-input').addEventListener('change', (e) => {
  const file = e.target.files[0] || null;
  viajesGastoPendingPhotoFile = file;
  document.getElementById('viajes-gasto-photo-filename').textContent = file ? file.name : '';
  document.getElementById('viajes-gasto-photo-filename').classList.toggle('hidden', !file);
});
document.getElementById('btn-delete-viajes-gasto').addEventListener('click', async () => {
  if (!viajesGastoEditingId) return;
  if (!confirm('¿Borrar este movimiento?')) return;
  await api(`/api/viajes-entries/movements/${viajesGastoEditingId}`, { method: 'DELETE' });
  closeViajesGastoModal();
  await refreshViajesEntries();
});

document.getElementById('viajes-gasto-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = viajesGastoTypeField.getValue();
  const amount = document.getElementById('viajes-gasto-amount').value;
  const description = document.getElementById('viajes-gasto-description').value.trim() || null;
  const countsTowardBudget = document.getElementById('viajes-gasto-counts').checked;
  const linked = !!(viajesCurrentTrip && viajesCurrentTrip.finanzasLinked);
  const accountId = linked ? viajesGastoAccountField.getValue() || null : null;
  const categoryId = linked ? viajesGastoCategoryField.getValue() || null : null;

  try {
    if (viajesGastoEditingId) {
      await api(`/api/viajes-entries/movements/${viajesGastoEditingId}`, {
        method: 'PUT',
        body: JSON.stringify({ type, amount, description, countsTowardBudget, accountId, categoryId }),
      });
    } else {
      let attachmentId = null;
      if (viajesGastoPendingPhotoFile) {
        const uploaded = await api(`/api/viajes-entries/${viajesGastoEntryId}/attachments`, {
          method: 'POST',
          headers: { 'Content-Type': viajesGastoPendingPhotoFile.type },
          body: viajesGastoPendingPhotoFile,
        });
        attachmentId = uploaded.id;
      }
      await api(`/api/viajes-entries/${viajesGastoEntryId}/movements`, {
        method: 'POST',
        body: JSON.stringify({ type, amount, description, countsTowardBudget, accountId, categoryId, attachmentId }),
      });
    }
    closeViajesGastoModal();
    await refreshViajesEntries();
  } catch (err) {
    alert('No se pudo guardar el movimiento: ' + err.message);
  }
});

// --- Vincular un movimiento a un movimiento real de Finanzas ------------
// Disponible SIEMPRE (no exige que el viaje tenga finanzas_linked
// activado), para poder enlazar un movimiento suelto sin activar el
// ajuste de todo el viaje. "viajesLinkFinanzasAttachmentId" guarda ahora
// el id de un MOVIMIENTO (renombrado abajo para que quede claro).
let viajesLinkFinanzasMovementId = null;
async function openViajesLinkFinanzasModal(movement) {
  viajesLinkFinanzasMovementId = movement.id;
  document.getElementById('viajes-link-finanzas-amount').textContent = `Importe: ${movement.amount.toFixed(2)} €`;
  const [accounts, categories] = await Promise.all([api('/api/finanzas-accounts'), api('/api/finanzas-categories')]);
  viajesLinkFinanzasAccountField.setOptions(accounts.map((a) => ({ value: a.id, label: a.name })));
  viajesLinkFinanzasCategoryField.setOptions([{ value: '', label: 'Sin categoría' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]);
  document.getElementById('viajes-link-finanzas-description').value = movement.description || '';
  document.getElementById('viajes-link-finanzas-modal').classList.remove('hidden');
}
function closeViajesLinkFinanzasModal() {
  viajesLinkFinanzasMovementId = null;
  document.getElementById('viajes-link-finanzas-modal').classList.add('hidden');
}
document.getElementById('btn-close-viajes-link-finanzas').addEventListener('click', closeViajesLinkFinanzasModal);
document.getElementById('btn-cancel-viajes-link-finanzas').addEventListener('click', closeViajesLinkFinanzasModal);
document.getElementById('btn-confirm-viajes-link-finanzas').addEventListener('click', async () => {
  const accountId = viajesLinkFinanzasAccountField.getValue();
  if (!accountId) { alert('Elige una cuenta.'); return; }
  try {
    await api(`/api/viajes-entries/movements/${viajesLinkFinanzasMovementId}/link-finanzas`, {
      method: 'POST',
      body: JSON.stringify({
        accountId,
        categoryId: viajesLinkFinanzasCategoryField.getValue() || null,
        description: document.getElementById('viajes-link-finanzas-description').value.trim() || null,
      }),
    });
    closeViajesLinkFinanzasModal();
    await refreshViajesEntries();
  } catch (err) {
    alert('No se pudo vincular: ' + err.message);
  }
});

// Taiwán es el UNICO pais que no existe como contorno propio en este
// mapa (aparece dibujado como parte del grupo "cn" de China, ver
// comentario mas arriba) -- se dibuja un marcador/pin en su ubicacion
// aproximada en vez de un contorno real. Coordenadas tomadas
// directamente de la etiqueta de texto "TW-label" que trae el propio
// SVG (mismo sistema de coordenadas que el resto del mapa, ya
// calibrada por quien hizo el dataset) -- ajustables a mano aqui si
// algun dia se ven descuadradas.
const VIAJES_MICRO_STATE_MARKERS = [
  { id: 'tw', x: 791, y: 178 }, // Taiwan
];

function addViajesMapMicroStateMarkers(svg) {
  const svgNS = 'http://www.w3.org/2000/svg';
  VIAJES_MICRO_STATE_MARKERS.forEach(({ id, x, y }) => {
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('id', id);
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', '1.8');
    circle.classList.add('viajes-map-country', 'viajes-map-micro-state');
    circle.dataset.countryCode = id;
    circle.addEventListener('click', () => openViajesCountryModal(id));
    svg.appendChild(circle);
  });
}

// --- Mapa interactivo ---------------------------------------------------
async function loadViajesMap() {
  if (viajesMapLoaded) return;
  viajesMapLoaded = true;
  const container = document.getElementById('viajes-map-container');
  const svgWrap = document.getElementById('viajes-map-svg-wrap');
  const res = await fetch('/viajes-world-map.svg');
  svgWrap.innerHTML = await res.text();
  const svg = svgWrap.querySelector('svg');
  // Solo los <g id="XX"> de nivel superior (paises de verdad) -- el SVG
  // tambien trae, al mismo nivel, un rect#World y un path#Ocean (fondo,
  // no clicables) y un <g id="labels" display="none"> con el nombre en
  // ingles de cada pais (no lo usamos, ya tenemos viajesCountryLabel());
  // ":scope > g[id]" no baja a los <path>/<circle> internos de cada
  // pais, que tienen sus propios ids sin sentido (ej. "path5998").
  // dataset.countryCode (minuscula) en vez de tocar el atributo "id" real
  // del SVG (que aqui viene en MAYUSCULAS) -- evita mutar el documento
  // de origen y deja un unico sitio (este dataset) del que leer el
  // codigo en minuscula en el resto de la funcion.
  svg.querySelectorAll(':scope > g[id]').forEach((el) => {
    if (el.id === 'labels') return;
    el.classList.add('viajes-map-country');
    el.dataset.countryCode = el.id.toLowerCase();
    el.addEventListener('click', () => openViajesCountryModal(el.dataset.countryCode));
  });
  addViajesMapMicroStateMarkers(svg);
  // Hover -> nombre del pais al instante, reutilizando el mismo tooltip
  // ya construido para las graficas de Finanzas (un unico div flotante
  // que sigue al raton, ver attachFinanzasChartTooltips) -- generico de
  // verdad, no hace falta tocar su implementacion para reutilizarlo aqui.
  svg.querySelectorAll('.viajes-map-country').forEach((el) => {
    el.dataset.tooltip = viajesCountryLabel(el.dataset.countryCode);
  });
  attachFinanzasChartTooltips(svg);
  initViajesMapZoomPan(svg, container);
}

function refreshViajesMapHighlights() {
  const container = document.getElementById('viajes-map-container');
  const svg = container.querySelector('svg');
  if (!svg) return;
  const visited = new Set(viajesTrips.flatMap((t) => t.countries));
  svg.querySelectorAll('.viajes-map-country').forEach((el) => {
    el.classList.toggle('viajes-map-country-visited', visited.has(el.dataset.countryCode));
  });
}

// Zoom + paneo del mapa mutando el "viewBox" del SVG (no hay ninguna
// libreria de zoom en el proyecto, y el SVG ya usa viewBox + se escala
// solo por CSS -- mutar el viewBox es lo mas natural, sin necesidad de
// un wrapper con transform ni tocar el tamano del propio SVG).
let viajesMapBaseViewBox = null; // {x,y,w,h} original, al 100% de zoom
let viajesMapView = null; // {x,y,w,h} de la sub-region visible ahora mismo
const VIAJES_MAP_MIN_ZOOM = 1;
const VIAJES_MAP_MAX_ZOOM = 8;

function parseViajesMapViewBox(svg) {
  const raw = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  if (raw.length !== 4 || raw.some((n) => Number.isNaN(n))) {
    return { x: 0, y: 0, w: svg.clientWidth || 100, h: svg.clientHeight || 100 };
  }
  return { x: raw[0], y: raw[1], w: raw[2], h: raw[3] };
}

function viajesMapCurrentZoom() {
  return viajesMapBaseViewBox.w / viajesMapView.w;
}

function clampViajesMapView() {
  const base = viajesMapBaseViewBox;
  viajesMapView.w = Math.min(viajesMapView.w, base.w);
  viajesMapView.h = Math.min(viajesMapView.h, base.h);
  viajesMapView.x = Math.min(Math.max(viajesMapView.x, base.x), base.x + base.w - viajesMapView.w);
  viajesMapView.y = Math.min(Math.max(viajesMapView.y, base.y), base.y + base.h - viajesMapView.h);
}

function applyViajesMapView(svg) {
  clampViajesMapView();
  svg.setAttribute('viewBox', `${viajesMapView.x} ${viajesMapView.y} ${viajesMapView.w} ${viajesMapView.h}`);
}

// Zoomea manteniendo fijo el punto (fracX, fracY) -- fraccion 0..1
// dentro de la caja visible ACTUAL, no del mapa entero -- que es donde
// esta el cursor o el punto medio del pellizco.
function setViajesMapZoomAt(newZoom, fracX, fracY, svg) {
  const base = viajesMapBaseViewBox;
  const clampedZoom = Math.min(Math.max(newZoom, VIAJES_MAP_MIN_ZOOM), VIAJES_MAP_MAX_ZOOM);
  const cur = viajesMapView;
  const px = cur.x + fracX * cur.w;
  const py = cur.y + fracY * cur.h;
  const w = base.w / clampedZoom;
  const h = base.h / clampedZoom;
  viajesMapView = { x: px - fracX * w, y: py - fracY * h, w, h };
  applyViajesMapView(svg);
}

function initViajesMapZoomPan(svg, container) {
  viajesMapBaseViewBox = parseViajesMapViewBox(svg);
  viajesMapView = Object.assign({}, viajesMapBaseViewBox);

  // pointerId -> {x,y} en coordenadas de pantalla (clientX/clientY).
  const activePointers = new Map();
  let dragStart = null; // {x,y,viewX,viewY} para paneo con 1 puntero
  let dragMoved = 0; // distancia recorrida -- por debajo del umbral, un toque sigue siendo un clic normal sobre el pais
  let pinchStart = null; // {dist, zoom} para pellizco con 2 punteros
  // Si el arrastre empieza y termina sobre el MISMO pais (p.ej. panear
  // dentro de un pais grande sin cruzar su borde), el navegador sigue
  // disparando un "click" normal en ese pais -- se traga ese click de
  // mas con esta bandera + un listener en fase de captura (mas abajo),
  // sin tocar el listener de cada pais.
  let justDragged = false;
  container.addEventListener(
    'click',
    (e) => {
      if (justDragged) {
        justDragged = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );

  function containerFrac(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return {
      x: Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1),
    };
  }

  function pointerDistance() {
    const pts = Array.from(activePointers.values());
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  container.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const frac = containerFrac(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      setViajesMapZoomAt(viajesMapCurrentZoom() * factor, frac.x, frac.y, svg);
    },
    { passive: false }
  );

  container.addEventListener('pointerdown', (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1) {
      dragStart = { x: e.clientX, y: e.clientY, viewX: viajesMapView.x, viewY: viajesMapView.y };
      dragMoved = 0;
    } else if (activePointers.size === 2) {
      pinchStart = { dist: pointerDistance(), zoom: viajesMapCurrentZoom() };
    }
  });

  // pointermove/up/cancel se escuchan en window (no en el contenedor) para
  // seguir el arrastre aunque el puntero salga de los limites del mapa --
  // sin usar setPointerCapture, que redirigiria los eventos y podria
  // interferir con el "click" nativo ya puesto en cada pais.
  window.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2 && pinchStart) {
      const dist = pointerDistance();
      const pts = Array.from(activePointers.values());
      const frac = containerFrac((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      setViajesMapZoomAt(pinchStart.zoom * (dist / pinchStart.dist), frac.x, frac.y, svg);
      return;
    }

    if (activePointers.size === 1 && dragStart) {
      const dxClient = e.clientX - dragStart.x;
      const dyClient = e.clientY - dragStart.y;
      dragMoved = Math.hypot(dxClient, dyClient);
      if (dragMoved < 4) return;
      const rect = container.getBoundingClientRect();
      viajesMapView.x = dragStart.viewX - (dxClient / rect.width) * viajesMapView.w;
      viajesMapView.y = dragStart.viewY - (dyClient / rect.height) * viajesMapView.h;
      container.classList.add('viajes-map-dragging');
      applyViajesMapView(svg);
    }
  });

  function endPointer(e) {
    activePointers.delete(e.pointerId);
    pinchStart = null;
    if (activePointers.size === 1) {
      // Queda un dedo (se soltó uno de los dos del pellizco) -- seguir
      // paneando desde donde esta AHORA, sin saltar de golpe.
      const [remaining] = activePointers.values();
      dragStart = { x: remaining.x, y: remaining.y, viewX: viajesMapView.x, viewY: viajesMapView.y };
      dragMoved = 0;
    } else if (activePointers.size === 0) {
      if (dragMoved >= 4) justDragged = true;
      dragStart = null;
      container.classList.remove('viajes-map-dragging');
    }
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  document.getElementById('btn-viajes-map-zoom-in').addEventListener('click', () => {
    setViajesMapZoomAt(viajesMapCurrentZoom() * 1.4, 0.5, 0.5, svg);
  });
  document.getElementById('btn-viajes-map-zoom-out').addEventListener('click', () => {
    setViajesMapZoomAt(viajesMapCurrentZoom() / 1.4, 0.5, 0.5, svg);
  });
  document.getElementById('btn-viajes-map-zoom-reset').addEventListener('click', () => {
    viajesMapView = Object.assign({}, viajesMapBaseViewBox);
    applyViajesMapView(svg);
  });
}

async function openViajesCountryModal(code) {
  document.getElementById('viajes-country-modal-title').textContent = viajesCountryLabel(code);
  const trips = await api(`/api/viajes-trips/by-country/${code}`);
  const list = document.getElementById('viajes-country-trips-list');
  document.getElementById('viajes-country-trips-empty').classList.toggle('hidden', trips.length > 0);
  renderViajesTripCards(list, trips, (trip) => {
    closeViajesCountryModal();
    setViajesTab('viajes');
    openViajesTripDetail(trip);
  });
  document.getElementById('btn-new-viaje-en-pais').onclick = () => {
    closeViajesCountryModal();
    openViajesTripModal(null, code);
  };
  document.getElementById('viajes-country-modal').classList.remove('hidden');
}
function closeViajesCountryModal() {
  document.getElementById('viajes-country-modal').classList.add('hidden');
}
document.getElementById('btn-close-viajes-country').addEventListener('click', closeViajesCountryModal);

// --- Pestañas Mapa / Mis viajes ------------------------------------------
function setViajesTab(tab) {
  document.querySelectorAll('.viajes-tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.viajesTab === tab));
  document.querySelectorAll('.viajes-tab-panel').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.viajesPanel !== tab));
}
document.querySelectorAll('.viajes-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => setViajesTab(btn.dataset.viajesTab));
});

async function openViajesView() {
  closeExtensionsView();
  document.getElementById('viajes-view').classList.remove('hidden');
  setCurrentScreen('viajes');
  setViajesTab('mapa');
  document.getElementById('viajes-trips-list-panel').classList.remove('hidden');
  document.getElementById('viajes-trip-detail-panel').classList.add('hidden');
  await loadViajesMap();
  await loadViajesTrips();
  renderViajesTripsList();
  refreshViajesMapHighlights();
}
function closeViajesView() {
  document.getElementById('viajes-view').classList.add('hidden');
  openExtensionsView();
}
document.getElementById('btn-open-viajes').addEventListener('click', openViajesView);
document.getElementById('btn-close-viajes').addEventListener('click', closeViajesView);

async function openLecturasSagaDetail(saga) {
  state.lecturasCurrentSagaId = saga.id;
  document.getElementById('lecturas-sagas-panel').classList.add('hidden');
  document.getElementById('lecturas-saga-detail-panel').classList.remove('hidden');
  document.getElementById('lecturas-saga-detail-name').textContent = saga.name;
  document.getElementById('lecturas-saga-detail-description').textContent = saga.description || '';
  document.getElementById('lecturas-saga-detail-description').classList.toggle('hidden', !saga.description);
  // Los filtros arrancan limpios en cada saga -- si no, entrar en una
  // saga distinta con un filtro puesto podia parecer "esta vacia" sin
  // motivo aparente.
  lecturasItemFilters = { type: '', status: '', genre: '', minRating: '' };
  await loadLecturasItems(saga.id);
  renderLecturasItemFilters();
  renderLecturasItemsTable();
}

// --- Modal de saga ------------------------------------------------------
function openLecturasSagaModal(saga) {
  document.getElementById('lecturas-saga-modal-title').textContent = saga ? 'Editar saga' : 'Nueva saga';
  document.getElementById('lecturas-saga-id').value = saga ? saga.id : '';
  document.getElementById('lecturas-saga-name').value = saga ? saga.name : '';
  document.getElementById('lecturas-saga-description').value = saga ? saga.description || '' : '';
  document.getElementById('lecturas-saga-modal').classList.remove('hidden');
}
function closeLecturasSagaModal() {
  document.getElementById('lecturas-saga-modal').classList.add('hidden');
}
document.getElementById('btn-new-lecturas-saga').addEventListener('click', () => openLecturasSagaModal(null));
document.getElementById('btn-cancel-lecturas-saga').addEventListener('click', closeLecturasSagaModal);
document.getElementById('btn-close-lecturas-saga').addEventListener('click', closeLecturasSagaModal);
document.getElementById('btn-edit-lecturas-saga').addEventListener('click', () => {
  openLecturasSagaModal(state.lecturasSagas.find((s) => s.id === state.lecturasCurrentSagaId));
});

document.getElementById('lecturas-saga-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('lecturas-saga-id').value;
  const payload = {
    name: document.getElementById('lecturas-saga-name').value,
    description: document.getElementById('lecturas-saga-description').value,
  };
  const wasEditingCurrent = id && Number(id) === state.lecturasCurrentSagaId;
  if (id) {
    await api(`/api/lecturas-sagas/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/lecturas-sagas', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeLecturasSagaModal();
  await loadLecturasSagas();
  if (wasEditingCurrent) {
    const updated = state.lecturasSagas.find((s) => s.id === state.lecturasCurrentSagaId);
    document.getElementById('lecturas-saga-detail-name').textContent = updated.name;
    document.getElementById('lecturas-saga-detail-description').textContent = updated.description || '';
    document.getElementById('lecturas-saga-detail-description').classList.toggle('hidden', !updated.description);
  } else {
    renderLecturasSagasTable();
  }
});

document.getElementById('btn-delete-lecturas-saga').addEventListener('click', async () => {
  if (!state.lecturasCurrentSagaId) return;
  if (!confirm('¿Eliminar esta saga y TODO su contenido? No se puede deshacer.')) return;
  await api(`/api/lecturas-sagas/${state.lecturasCurrentSagaId}`, { method: 'DELETE' });
  await refreshLecturasSagasView();
});

// --- Filtros de la tabla de items ---------------------------------------
let lecturasItemFilters = { type: '', status: '', genre: '', minRating: '' };

// Selectores con estilo propio para los filtros de tipo/estado/genero
// (antes <select> nativos, mismo motivo que en el modal de item). A
// diferencia de los del modal, estos SI necesitan poder cambiar sus
// opciones despues de creados (el genero depende de lo que haya en cada
// saga) -- por eso se crean UNA sola vez aqui (createSelectField cuelga
// su popover de <body> y no lo quita solo: crear una instancia nueva en
// CADA repintado de renderLecturasItemFilters() iria acumulando popovers
// huerfanos) y renderLecturasItemFilters() solo llama a
// .setOptions()/.setValue() en las siguientes veces que se ejecuta.
const lecturasFilterTypeField = createSelectField({
  options: [{ value: '', label: 'Todos los tipos' }, ...Object.entries(LECTURAS_TYPE_LABELS).map(([value, label]) => ({ value, label }))],
  initialValue: '',
  onChange: (value) => { lecturasItemFilters.type = value; renderLecturasItemsTable(); },
});
const lecturasFilterStatusField = createSelectField({
  options: [{ value: '', label: 'Todos los estados' }, ...Object.entries(LECTURAS_STATUS_LABELS).map(([value, label]) => ({ value, label }))],
  initialValue: '',
  onChange: (value) => { lecturasItemFilters.status = value; renderLecturasItemsTable(); },
});
const lecturasFilterGenreField = createSelectField({
  options: [{ value: '', label: 'Todos los géneros' }],
  initialValue: '',
  onChange: (value) => { lecturasItemFilters.genre = value; renderLecturasItemsTable(); },
});

function renderLecturasItemFilters() {
  const container = document.getElementById('lecturas-item-filters');
  if (!container.dataset.built) {
    container.dataset.built = '1';
    const typeWrap = document.createElement('div');
    typeWrap.className = 'lecturas-filter-field';
    typeWrap.appendChild(lecturasFilterTypeField.element);
    const statusWrap = document.createElement('div');
    statusWrap.className = 'lecturas-filter-field';
    statusWrap.appendChild(lecturasFilterStatusField.element);
    const genreWrap = document.createElement('div');
    genreWrap.className = 'lecturas-filter-field';
    genreWrap.appendChild(lecturasFilterGenreField.element);

    const ratingInput = document.createElement('input');
    ratingInput.type = 'number';
    ratingInput.id = 'lecturas-filter-min-rating';
    ratingInput.placeholder = 'Rating mín.';
    ratingInput.min = '0';
    ratingInput.max = '10';
    ratingInput.step = '0.5';
    ratingInput.addEventListener('input', () => {
      clampLecturasRatingInput(ratingInput);
      lecturasItemFilters.minRating = ratingInput.value;
      renderLecturasItemsTable();
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.id = 'btn-clear-lecturas-filters';
    clearBtn.className = 'secondary-btn';
    clearBtn.textContent = 'Quitar filtros';
    clearBtn.addEventListener('click', () => {
      lecturasItemFilters = { type: '', status: '', genre: '', minRating: '' };
      lecturasFilterTypeField.setValue('');
      lecturasFilterStatusField.setValue('');
      lecturasFilterGenreField.setValue('');
      ratingInput.value = '';
      renderLecturasItemsTable();
    });

    container.append(typeWrap, statusWrap, genreWrap, ratingInput, clearBtn);
  }

  // Lo unico que cambia entre repintados es el listado de generos
  // disponibles (depende de la saga) y los valores actuales -- los
  // filtros se resetean al cambiar de saga (ver openLecturasSagaDetail),
  // asi que reflejar lecturasItemFilters aqui basta.
  const allGenres = [...new Set(state.lecturasItems.flatMap((it) => it.genres))].sort();
  lecturasFilterGenreField.setOptions([{ value: '', label: 'Todos los géneros' }, ...allGenres.map((g) => ({ value: g, label: g }))]);
  lecturasFilterTypeField.setValue(lecturasItemFilters.type);
  lecturasFilterStatusField.setValue(lecturasItemFilters.status);
  lecturasFilterGenreField.setValue(lecturasItemFilters.genre);
  document.getElementById('lecturas-filter-min-rating').value = lecturasItemFilters.minRating;
}

function lecturasItemMatchesFilters(item) {
  if (lecturasItemFilters.type && item.type !== lecturasItemFilters.type) return false;
  if (lecturasItemFilters.status && item.status !== lecturasItemFilters.status) return false;
  if (lecturasItemFilters.genre && !item.genres.includes(lecturasItemFilters.genre)) return false;
  if (lecturasItemFilters.minRating !== '' && (item.rating === null || item.rating < Number(lecturasItemFilters.minRating))) return false;
  return true;
}

function renderLecturasItemsTable() {
  const tbody = document.getElementById('lecturas-items-tbody');
  const empty = document.getElementById('lecturas-items-empty');
  tbody.innerHTML = '';
  const filtered = state.lecturasItems.filter(lecturasItemMatchesFilters);
  empty.classList.toggle('hidden', filtered.length > 0);

  filtered.forEach((item) => {
    const progress = item.progressTotal ? `${item.progressCurrent ?? 0}/${item.progressTotal}${item.progressUnit ? ' ' + escapeHtml(item.progressUnit) : ''}` : '—';
    const owned = item.ownedTotal ? `${item.ownedCount ?? 0} de ${item.ownedTotal}` : '—';
    const statusColor = LECTURAS_STATUS_COLORS[item.status];
    const tr = document.createElement('tr');
    // "Prestado" se muestra como una insignia junto al titulo (en vez de
    // una columna aparte) para no reestructurar toda la tabla solo por
    // esto -- con quien y desde cuando como tooltip, si se sabe.
    const loanedBadge = item.loaned ? `<span class="lecturas-loaned-badge" title="Prestado${item.loanedTo ? ` a ${escapeHtml(item.loanedTo)}` : ''}${item.loanedAt ? ` desde ${item.loanedAt}` : ''}">Prestado</span>` : '';
    tr.innerHTML = `
      <td>${escapeHtml(item.title)} ${loanedBadge}</td>
      <td>${LECTURAS_TYPE_LABELS[item.type] || item.type}</td>
      <td><span class="lecturas-status-badge" style="background-color:${statusColor}33; color:${statusColor};">${LECTURAS_STATUS_LABELS[item.status]}</span></td>
      <td>${item.rating !== null ? item.rating + '/10' : '—'}</td>
      <td>${item.genres.map(escapeHtml).join(', ') || '—'}</td>
      <td>${progress}</td>
      <td>${owned}</td>
    `;
    tr.addEventListener('click', () => openLecturasItemModal(item));
    tbody.appendChild(tr);
  });
}

// --- Modal de item (con chips de generos) -------------------------------
let lecturasItemGenres = [];

// Generos ya usados en CUALQUIER saga (no solo la abierta ahora mismo)
// -- se traen con GET /api/lecturas-items sin sagaId, que ya devuelve
// todos los items de todas las sagas (ver server/routes/lecturasItems.js).
// Sin tabla ni endpoint nuevo: "la opcion de seleccion general" que
// pidio Koku sale sola de los items ya guardados, combinada con
// LECTURAS_PREDEFINED_GENRES para tener algo que elegir incluso antes de
// haber usado ningun genero todavia.
let lecturasGlobalGenres = [];
async function refreshLecturasGlobalGenres() {
  try {
    const allItems = await api('/api/lecturas-items');
    lecturasGlobalGenres = [...new Set(allItems.flatMap((it) => it.genres))];
  } catch (err) {
    lecturasGlobalGenres = [];
  }
}
function lecturasGenreSuggestions() {
  const combined = [...new Set([...LECTURAS_PREDEFINED_GENRES, ...lecturasGlobalGenres])];
  return combined.sort((a, b) => a.localeCompare(b, 'es'));
}

function renderLecturasGenreChipsList() {
  const list = document.getElementById('lecturas-genre-chips-list');
  list.innerHTML = lecturasItemGenres
    .map((g, i) => `<span class="lecturas-genre-chip">${escapeHtml(g)}<button type="button" data-remove-genre="${i}" aria-label="Quitar género">✕</button></span>`)
    .join('');
  list.querySelectorAll('[data-remove-genre]').forEach((btn) => {
    btn.addEventListener('click', () => {
      lecturasItemGenres.splice(Number(btn.dataset.removeGenre), 1);
      renderLecturasGenreChipsList();
      renderLecturasGenreSuggestionsRow();
    });
  });
}

// Fila de sugerencias clicables (predefinidas + ya usadas en cualquier
// saga), sin repetir las que el item ya tiene añadidas -- clicar una
// las añade igual que escribirla + Intro. El <datalist> del input de
// texto libre se refresca con el mismo conjunto, para quien prefiera
// escribir y autocompletar en vez de clicar.
function renderLecturasGenreSuggestionsRow() {
  const row = document.getElementById('lecturas-genre-suggestions-row');
  const datalist = document.getElementById('lecturas-genre-suggestions');
  if (!row || !datalist) return;
  const already = new Set(lecturasItemGenres.map((g) => g.toLowerCase()));
  const suggestions = lecturasGenreSuggestions();
  datalist.innerHTML = suggestions.map((g) => `<option value="${escapeHtml(g)}"></option>`).join('');
  row.innerHTML = suggestions
    .filter((g) => !already.has(g.toLowerCase()))
    .map((g) => `<button type="button" class="lecturas-genre-suggestion-chip" data-add-genre="${escapeHtml(g)}">+ ${escapeHtml(g)}</button>`)
    .join('');
  row.querySelectorAll('[data-add-genre]').forEach((btn) => {
    btn.addEventListener('click', () => {
      lecturasItemGenres.push(btn.dataset.addGenre);
      renderLecturasGenreChipsList();
      renderLecturasGenreSuggestionsRow();
    });
  });
}

function renderLecturasItemGenreChips() {
  const container = document.getElementById('lecturas-item-genres-field');
  container.innerHTML = `
    <div class="lecturas-genre-chips" id="lecturas-genre-chips-list"></div>
    <div class="lecturas-genre-input-row">
      <input type="text" id="lecturas-genre-input" placeholder="Escribe un género y pulsa Intro" list="lecturas-genre-suggestions" />
      <datalist id="lecturas-genre-suggestions"></datalist>
      <button type="button" id="btn-add-lecturas-genre" class="secondary-btn">+</button>
    </div>
    <div class="lecturas-genre-suggestions-row" id="lecturas-genre-suggestions-row"></div>
  `;
  renderLecturasGenreChipsList();
  // Se pinta ya con los predefinidos + lo que se supiera de una
  // apertura anterior del modal, sin esperar a la red -- en cuanto
  // responde GET /api/lecturas-items se repinta con el conjunto
  // completo y actualizado.
  renderLecturasGenreSuggestionsRow();
  refreshLecturasGlobalGenres().then(renderLecturasGenreSuggestionsRow);

  const input = document.getElementById('lecturas-genre-input');
  function addFromInput() {
    const value = input.value.trim();
    if (!value) return;
    if (!lecturasItemGenres.some((g) => g.toLowerCase() === value.toLowerCase())) {
      lecturasItemGenres.push(value);
      renderLecturasGenreChipsList();
      renderLecturasGenreSuggestionsRow();
    }
    input.value = '';
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addFromInput();
    }
  });
  document.getElementById('btn-add-lecturas-genre').addEventListener('click', addFromInput);
}

function openLecturasItemModal(item) {
  document.getElementById('lecturas-item-modal-title').textContent = item ? 'Editar item' : 'Nuevo item';
  document.getElementById('lecturas-item-id').value = item ? item.id : '';
  document.getElementById('lecturas-item-title').value = item ? item.title : '';
  lecturasItemTypeField.setValue(item ? item.type : 'manga');
  lecturasItemStatusField.setValue(item ? item.status : 'wishlist');
  document.getElementById('lecturas-item-description').value = item ? item.description || '' : '';
  const ratingValue = item && item.rating !== null ? item.rating : '';
  document.getElementById('lecturas-item-rating').value = ratingValue;
  document.getElementById('lecturas-item-rating-range').value = ratingValue === '' ? 0 : ratingValue;
  document.getElementById('lecturas-item-progress-current').value = item && item.progressCurrent !== null ? item.progressCurrent : '';
  document.getElementById('lecturas-item-progress-total').value = item && item.progressTotal !== null ? item.progressTotal : '';
  document.getElementById('lecturas-item-progress-unit').value = item ? item.progressUnit || '' : '';
  document.getElementById('lecturas-item-owned-count').value = item && item.ownedCount !== null ? item.ownedCount : '';
  document.getElementById('lecturas-item-owned-total').value = item && item.ownedTotal !== null ? item.ownedTotal : '';
  lecturasItemGenres = item ? [...item.genres] : [];
  renderLecturasItemGenreChips();
  const loanedChecked = !!(item && item.loaned);
  document.getElementById('lecturas-item-loaned').checked = loanedChecked;
  document.getElementById('lecturas-item-loaned-to').value = item ? item.loanedTo || '' : '';
  lecturasItemLoanedAtField.setValue(item && item.loanedAt ? new Date(`${item.loanedAt}T00:00:00`) : null);
  document.getElementById('lecturas-item-loaned-details').classList.toggle('hidden', !loanedChecked);
  document.getElementById('btn-delete-lecturas-item').classList.toggle('hidden', !item);
  document.getElementById('lecturas-item-modal').classList.remove('hidden');
}
function closeLecturasItemModal() {
  document.getElementById('lecturas-item-modal').classList.add('hidden');
}
document.getElementById('btn-new-lecturas-item').addEventListener('click', () => openLecturasItemModal(null));
document.getElementById('btn-cancel-lecturas-item').addEventListener('click', closeLecturasItemModal);
document.getElementById('btn-close-lecturas-item').addEventListener('click', closeLecturasItemModal);

async function refreshLecturasAfterItemChange() {
  await loadLecturasItems(state.lecturasCurrentSagaId);
  renderLecturasItemFilters();
  renderLecturasItemsTable();
  // El resumen de tipos/cantidad de la saga (tabla de sagas) puede haber
  // cambiado -- se refresca en segundo plano, no bloquea la pantalla.
  loadLecturasSagas();
}

document.getElementById('lecturas-item-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('lecturas-item-id').value;
  const payload = {
    sagaId: state.lecturasCurrentSagaId,
    title: document.getElementById('lecturas-item-title').value,
    type: lecturasItemTypeField.getValue(),
    status: lecturasItemStatusField.getValue(),
    description: document.getElementById('lecturas-item-description').value,
    rating: document.getElementById('lecturas-item-rating').value,
    genres: lecturasItemGenres,
    progressCurrent: document.getElementById('lecturas-item-progress-current').value,
    progressTotal: document.getElementById('lecturas-item-progress-total').value,
    progressUnit: document.getElementById('lecturas-item-progress-unit').value,
    ownedCount: document.getElementById('lecturas-item-owned-count').value,
    ownedTotal: document.getElementById('lecturas-item-owned-total').value,
    loaned: document.getElementById('lecturas-item-loaned').checked,
    loanedTo: document.getElementById('lecturas-item-loaned-to').value,
    loanedAt: lecturasItemLoanedAtField.getValue() ? toDateKey(lecturasItemLoanedAtField.getValue()) : null,
  };
  if (id) {
    await api(`/api/lecturas-items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/lecturas-items', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeLecturasItemModal();
  await refreshLecturasAfterItemChange();
});

document.getElementById('btn-delete-lecturas-item').addEventListener('click', async () => {
  const id = document.getElementById('lecturas-item-id').value;
  if (!confirm('¿Eliminar este item?')) return;
  await api(`/api/lecturas-items/${id}`, { method: 'DELETE' });
  closeLecturasItemModal();
  await refreshLecturasAfterItemChange();
});

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
// expandir (ocupaba espacio vertical solo para eso) -- clicar la FILA
// entera de cabecera (.reminders-panel-header, con la clase
// my-space-col-expand-trigger -- antes solo el h2) la expande
// directamente, pedido explicito de Koku.
document.getElementById('my-space-hub').addEventListener('click', (e) => {
  const trigger = e.target.closest('.my-space-col-expand-trigger');
  if (!trigger) return;
  // Si el clic fue sobre un boton propio dentro de la fila (ej.
  // "Proximos →" en Recordatorios), ese boton ya tiene su propia accion
  // -- no expandir tambien la columna a la vez.
  if (e.target.closest('button')) return;
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
applyUiStyle();

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

// Ademas del menu principal de Configuracion, este mismo bloque se
// repite en Apps > Archivos (#archivos-version-info) -- Koku pidio
// ver ahi tambien la version/commit, no solo en Configuracion.
async function refreshVersionInfo() {
  const boxes = [document.getElementById('settings-version-info'), document.getElementById('archivos-version-info')].filter(Boolean);
  if (!boxes.length) return;
  try {
    const info = await api('/api/update/info');
    const commitDate = info.commitDate ? VERSION_INFO_DATE_FORMATTER.format(new Date(info.commitDate)) : '';
    const html = `
      <div>Versión ${escapeHtml(info.version)} · rama <code>${escapeHtml(info.branch)}</code></div>
      <div>Último commit: <code>${escapeHtml(info.commitHash)}</code> — ${escapeHtml(info.commitMessage)}</div>
      ${commitDate ? `<div>${escapeHtml(commitDate)}</div>` : ''}
    `;
    boxes.forEach((box) => {
      box.innerHTML = html;
      box.classList.remove('hidden');
    });
  } catch (err) {
    // Sin internet no importa (esto no hace fetch a GitHub), pero si
    // fallase por cualquier otro motivo (git no disponible, movil
    // emparejado sin permiso...) mejor no mostrar nada raro a medias.
    boxes.forEach((box) => box.classList.add('hidden'));
  }
}

let pendingReleaseVersion = null;

// El estado de la comprobacion (comprobando/al dia/nueva version/error)
// se ve integrado en el propio texto del boton "Comprobar ahora" de
// Apps > Archivos, en vez de un mensaje aparte encima -- Koku lo
// pidio explicitamente ("que no sea solo un mensaje"). data-check-status
// controla el color (ver .archivos-check-btn en styles.css: rojo en error).
function setArchivosCheckButtonState(status, text) {
  const btn = document.getElementById('btn-archivos-check-update');
  if (!btn) return;
  btn.textContent = text;
  btn.dataset.checkStatus = status;
  btn.disabled = status === 'checking';
}

// Ademas del banner de siempre, esto tambien conduce el estado del boton
// de Apps > Archivos (#btn-archivos-check-update) -- asi la
// comprobacion automatica de aqui abajo y el boton manual de ahi dan el
// mismo feedback. GET /api/update/check ya es requireDeviceOrTrusted (ver
// server/routes/update.js), asi que esto tambien funciona en un movil
// emparejado -- lo unico que sigue siendo solo del ordenador es
// instalarla de verdad (POST /pull).
async function checkForNewRelease() {
  setArchivosCheckButtonState('checking', 'Comprobando…');
  try {
    const info = await api('/api/update/check');
    if (!info || !info.remoteVersion) {
      setArchivosCheckButtonState('error', 'No se pudo comprobar la versión.');
      return;
    }
    if (compareVersions(info.remoteVersion, info.currentVersion) <= 0) {
      setArchivosCheckButtonState('ok', `Tienes la última versión (v${info.currentVersion}).`);
      return;
    }
    setArchivosCheckButtonState('ok', `Hay una versión nueva disponible (v${info.remoteVersion}).`);
    if (localStorage.getItem('skippedUpdateVersion') === info.remoteVersion) return;

    pendingReleaseVersion = info.remoteVersion;
    document.getElementById('new-release-banner-text').textContent = `Hay una versión nueva disponible (v${info.remoteVersion}).`;
    // Instalar de verdad (git pull) solo puede hacerlo el ordenador -- en
    // el movil se sustituye el boton de instalar por un texto informativo.
    const trusted = isTrustedDevice();
    document.getElementById('btn-install-release').classList.toggle('hidden', !trusted);
    document.getElementById('new-release-mobile-hint').classList.toggle('hidden', trusted);
    document.getElementById('new-release-banner').classList.remove('hidden');
  } catch (err) {
    // Sin internet o git no configurado: no pasa nada, se vuelve a
    // intentar mas tarde sin molestar con un error.
    setArchivosCheckButtonState('error', 'No se pudo comprobar (sin conexión con el ordenador o con GitHub).');
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
// Pantalla de bienvenida (primer arranque): ver el modal en index.html.
// Se muestra una sola vez, en el dispositivo que abra la app primero
// (el perfil es compartido por TODA la instalacion, no por dispositivo
// -- ver user_profile en server/db.js), tanto al guardar como al pulsar
// "Ahora no" se marca como vista para siempre (los dos llaman a PUT
// /api/profile, que marca onboardingCompleted=true como efecto
// secundario -- ver server/routes/profile.js).
// ---------------------------------------------------------------------
async function maybeShowOnboarding() {
  const profile = await api('/api/profile');
  if (profile.onboardingCompleted) return;
  document.getElementById('onboarding-name').value = profile.name || '';
  document.getElementById('onboarding-email').value = profile.email || '';
  document.getElementById('onboarding-modal').classList.remove('hidden');
}

function closeOnboardingModal() {
  document.getElementById('onboarding-modal').classList.add('hidden');
}

document.getElementById('onboarding-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/profile', {
    method: 'PUT',
    body: JSON.stringify({
      name: document.getElementById('onboarding-name').value,
      email: document.getElementById('onboarding-email').value,
    }),
  });
  closeOnboardingModal();
});

document.getElementById('btn-onboarding-skip').addEventListener('click', async () => {
  // Body vacio a proposito: no cambia nombre ni correo, solo marca la
  // pantalla como vista (ver el comentario de PUT /api/profile).
  await api('/api/profile', { method: 'PUT', body: JSON.stringify({}) });
  closeOnboardingModal();
});

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
// Ejecuta un paso de arranque sin dejar que un fallo suyo aborte los
// pasos siguientes -- antes de la fase "movil", init() encadenaba todos
// estos await seguidos dentro de un unico try/catch, asi que el PRIMERO
// que fallara (por ejemplo, sin conexion al ordenador) impedia que se
// cargara nada mas, dejando la pantalla a medias. Con la copia local
// (ver api()/db-local.js) la mayoria de estos ya no fallan sin conexion,
// pero esto es una red de seguridad ademas, no en vez de eso.
// ---------------------------------------------------------------------
// Recordar la "ventana" (vista a pantalla completa) en la que estabas al
// recargar la pagina -- Koku pidio explicitamente que un F5 no te mande
// siempre al calendario. Ambito deliberadamente limitado a las vistas de
// NIVEL SUPERIOR (Mi espacio, Apps, y cada extension) -- NO
// restaura pestañas/detalles concretos dentro de cada una (que pestaña
// de Finanzas, que viaje abierto en Viajes, que saga de Lecturas...), ni
// el editor de notas (junta varias notas abiertas a la vez, con mas
// estado del que compensa persistir aqui) -- se quedan en su pantalla
// de entrada normal, no es una regresion respecto a hoy. Los
// formularios/modales NUNCA se restauran (ya no lo hacian antes de este
// cambio): se quedan cerrados tras recargar, tal y como pidio Koku
// ("que se cancele, pero mantenme en la ventana"). Por dispositivo
// (localStorage), no sincronizado entre movil/ordenador.
// ---------------------------------------------------------------------
function setCurrentScreen(screen) {
  localStorage.setItem('currentScreen', screen);
}

async function restoreCurrentScreen() {
  const screen = localStorage.getItem('currentScreen');
  if (!screen || screen === 'home') return;
  if (screen === 'my-space') {
    // En modo "panel" no existe una pantalla de Mi espacio aparte que
    // restaurar -- el hub ya vive siempre junto al calendario.
    if (getMiEspacioMode() === 'topbar') openMySpaceView();
    return;
  }
  if (screen === 'mobile-notes') { openMobileNotesView(); return; }
  if (screen === 'extensions') { openExtensionsView(); return; }
  if (screen === 'gym') { await openGymView(); return; }
  if (screen === 'lecturas') { openLecturasView(); return; }
  if (screen === 'finanzas') { await openFinanzasView(); return; }
  if (screen === 'archivos') { await openArchivosView(); return; }
  if (screen === 'viajes') { await openViajesView(); return; }
}

async function initStep(fn) {
  try {
    await fn();
  } catch (err) {
    if (err.message !== 'device_not_paired') console.error(err);
  }
}

async function init() {
  // Lo PRIMERO de todo (antes incluso de cargar datos del calendario):
  // si veniamos de una recarga dentro de una vista a pantalla completa,
  // cubrir el calendario con esa vista cuanto antes -- showApp() ya dejo
  // el calendario visible, así que cuanto mas tarde se llame a esto, mas
  // se nota el "flashazo" del calendario antes de taparlo. Moverlo aqui
  // (en vez de al final de init(), donde estaba antes) no depende de
  // nada de lo que carga init() despues -- cada open*View() ya carga sus
  // propios datos por su cuenta.
  //
  // OJO -- bug real encontrado al mover esto tan pronto: algunas vistas
  // (Finanzas, via setupFinanzasIconColorFields) llaman en su apertura a
  // funciones que viven en settings.js (createIconField/createColorField),
  // que carga DESPUES de app.js (ver la nota de "Orden de declaracion"
  // en CLAUDE.md) -- normalmente esto no es problema porque esas
  // llamadas solo ocurren dentro de manejadores de eventos, que se
  // disparan mucho despues de que TODOS los <script> ya han terminado
  // de cargar. Pero al llamar a restoreCurrentScreen() de forma
  // SINCRONA nada mas arrancar init() (que a su vez se invoca de forma
  // sincrona al final de app.js), app.js seguia "en mitad de su propio
  // <script>" cuando esto se ejecutaba -- settings.js ni siquiera habia
  // empezado a cargar todavia, y createIconField no existia aun
  // (ReferenceError). Un simple `await Promise.resolve()` NO basta para
  // arreglarlo (los microtasks se vacian ENTRE cada <script> del
  // documento, antes de pasar al siguiente) -- hace falta un macrotask
  // de verdad (setTimeout) para que el navegador termine de
  // parsear/ejecutar el resto de los <script> del documento (incluido
  // settings.js entero) antes de continuar aqui. Sigue siendo
  // practicamente instantaneo para quien lo ve, muy lejos de las 7
  // llamadas de red secuenciales que había antes.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await initStep(restoreCurrentScreen);
  await initStep(maybeShowOnboarding);
  await initStep(loadGroups);
  await initStep(loadSpecialDays);
  await initStep(loadMonth);
  await initStep(loadReminders);
  await initStep(loadTasks);
  renderTasksList();
  await initStep(loadNoteFolders);
  populateNoteFolderSelect();
  await initStep(loadNotes);
  renderNotesView();
  refreshSyncStatusUI();
  // Ya no hay ningun runSync() automatico que la ponga al dia sola (ver
  // btn-sync-now en Apps > Archivos) -- sin esto, el punto de la
  // topbar se quedaria sin titulo/aria-label hasta la primera vez que se
  // sincronice a mano.
  refreshSyncIndicator();

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
