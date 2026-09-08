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
  notifiedReminderIds: new Set(), // evita notificar el mismo recordatorio 2 veces
  remindersMode: 'upcoming', // 'upcoming' | 'day' — que se muestra en el panel de recordatorios
  remindersDayDate: null, // dia seleccionado cuando remindersMode === 'day'
  upcomingReminders: [], // ultima lista de "proximos recordatorios" calculada
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
// Como quedo marcada la casilla del ultimo aviso, para los casos en que
// es una ELECCION de verdad (y no un "no volver a mostrar" que se guarda
// solo) -- p. ej. "eliminar tambien lo que hay dentro" al borrar una
// carpeta. Se lee justo despues de que showAppConfirm() resuelva.
let lastAppConfirmCheckbox = false;
// opts.checkbox = { label, storageKey? }: añade una fila con
// .styled-checkbox debajo del mensaje. Con "storageKey" es un "no volver
// a mostrar" (si esta marcada al Aceptar se guarda
// localStorage[storageKey] = '1', por dispositivo, mismo patron que el
// resto de ajustes de este tipo); sin el, es una eleccion normal y el
// que llama la lee en lastAppConfirmCheckbox nada mas resolverse.
// Aditivo: no cambia nada para los usos que no pasan "checkbox".
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
    lastAppConfirmCheckbox = false;
    if (checkbox) {
      document.getElementById('app-confirm-checkbox-label').textContent = checkbox.label;
      checkboxInput.checked = false;
    }
    document.getElementById('app-confirm-modal').classList.remove('hidden');
  });
}
function showAppAlert(message, { okText = 'Aceptar', checkbox = null } = {}) {
  return showAppConfirm(message, { okText, alertOnly: true, checkbox });
}
function closeAppConfirm(result) {
  document.getElementById('app-confirm-modal').classList.add('hidden');
  lastAppConfirmCheckbox = document.getElementById('app-confirm-checkbox').checked;
  if (result && appConfirmCheckboxStorageKey && lastAppConfirmCheckbox) {
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
  // Cuenta tanto un modal como una pantalla completa (.my-space-view):
  // esas pantallas son position:fixed y traen su propio scroll dentro,
  // pero la PAGINA de debajo (el calendario, mas alto que la ventana)
  // se sigue pudiendo arrastrar por detras -- son los "dos scrolls" que
  // se notaban al abrir una nota. Bloqueando el de la pagina mientras
  // hay algo encima, solo queda el de dentro.
  const anyOpen = document.querySelector('.modal:not(.hidden), .my-space-view:not(.hidden)') !== null;
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
  // Configuracion ya tiene su propio punto de entrada fijo en la barra
  // inferior (a diferencia del resto de modales, que son ventanas
  // puntuales) -- marca aparte para que la regla CSS
  // (body.settings-modal-open .mobile-nav) devuelva la barra mientras
  // Configuracion esta abierta, sin tocar el comportamiento de los
  // demas ~26 modales (que siguen ocultandola).
  const settingsModal = document.getElementById('settings-modal');
  const settingsOpen = settingsModal ? !settingsModal.classList.contains('hidden') : false;
  document.body.classList.toggle('settings-modal-open', settingsOpen);
  // OJO: "hay un modal de verdad abierto" es DISTINTO de "hay algo
  // encima". El bloqueo de scroll aplica a los dos, pero la barra
  // inferior solo se aparta ante un modal (una ventana puntual); una
  // pantalla completa la necesita para poder salir de ella.
  document.body.classList.toggle('real-modal-open', document.querySelector('.modal:not(.hidden)') !== null);
}
const modalScrollLockObserver = new MutationObserver(refreshModalScrollLock);
document.querySelectorAll('.modal, .my-space-view').forEach((el) => modalScrollLockObserver.observe(el, { attributes: true, attributeFilter: ['class'] }));

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
// Imagenes y fotos: de una ruta del servidor a una URL blob:
// ---------------------------------------------------------------------
// El HTML de una nota sigue guardando exactamente lo mismo que antes
// ("/api/notes/images/<uuid>.jpg"), y una foto de viaje sigue teniendo
// la misma url en su fila. Lo que cambia es que ya no hay servidor que
// responda a eso: los bytes estan en IndexedDB, asi que al MOSTRAR una
// imagen se cambia su src por una URL blob: creada al vuelo. Se guarda
// la ruta original en data-asset-src para poder devolverla tal cual al
// guardar la nota -- si se guardara la URL blob:, el saneador la
// rechazaria (solo acepta /api/notes/images/...) y ademas no valdria
// nada en la proxima sesion.
const ASSET_URL_PREFIXES = ['/api/notes/images/', '/api/viajes-entries/attachments/'];
const assetBlobUrls = new Map();

function isAssetPath(src) {
  return typeof src === 'string' && ASSET_URL_PREFIXES.some((p) => src.startsWith(p));
}

// Devuelve una URL blob: utilizable en un <img src>, o null si esos
// bytes ya no estan (imagen de una nota antigua cuyo archivo se
// perdio). Se cachean por ruta: crear una URL blob: nueva en cada
// render iria dejando memoria sin liberar.
async function resolveAssetUrl(path) {
  if (!isAssetPath(path)) return path;
  if (assetBlobUrls.has(path)) return assetBlobUrls.get(path);
  const name = path.slice(path.lastIndexOf('/') + 1);
  try {
    const row = await assetGet(name);
    if (!row || !row.bytes) return null;
    const url = URL.createObjectURL(new Blob([row.bytes], { type: row.type || 'application/octet-stream' }));
    assetBlobUrls.set(path, url);
    return url;
  } catch {
    return null;
  }
}

// Pone la URL blob: en un <img> concreto en cuanto este lista, sin
// bloquear el render (estas listas se pintan de forma sincrona).
function setAssetImageSrc(img, path) {
  if (!isAssetPath(path)) { img.src = path; return; }
  img.dataset.assetSrc = path;
  resolveAssetUrl(path).then((url) => { if (url) img.src = url; });
}

// Prepara el HTML de una nota ANTES de meterlo en el DOM: cambia
// src="/api/..." por data-asset-src="/api/...". Sin esto, el navegador
// pide esa ruta en cuanto aparece el <img> (y falla, porque no hay
// servidor) antes de que hydrateAssetImages llegue a poner la URL
// blob:. El saneador del backend garantiza que un <img> solo puede
// llevar src y que empieza por /api/notes/images/, asi que este
// reemplazo no puede tocar nada mas.
function prepareAssetHtmlForDom(html) {
  if (!html) return html;
  return html.replace(/<img\s+src="(\/api\/notes\/images\/[^"]+)"/gi, '<img data-asset-src="$1"');
}

// Cambia el src de todas las imagenes de un trozo de HTML ya insertado
// en el DOM (el cuerpo de una nota).
function hydrateAssetImages(root) {
  root.querySelectorAll('img').forEach((img) => {
    const path = img.dataset.assetSrc || img.getAttribute('src');
    if (isAssetPath(path)) setAssetImageSrc(img, path);
  });
}

// Lo contrario: devuelve el HTML con las rutas originales, para
// guardarlo. Se trabaja sobre el TEXTO, no clonando el DOM: poner el
// src original en un <img> clonado -- aunque este suelto, sin insertar
// -- hace que el navegador pida esa ruta igualmente (fallo real visto
// al probar: una peticion 404 por cada guardado). El saneador del
// backend solo deja "src" en un <img>, asi que quedarse solo con eso es
// exactamente lo que se guardaria de todas formas.
function serializeAssetImages(root) {
  return root.innerHTML.replace(
    /<img\b[^>]*\bdata-asset-src="([^"]+)"[^>]*>/gi,
    (match, path) => `<img src="${path}">`,
  );
}

// Convierte el `body` de una llamada a api() en lo que espera el
// manejador local. Casi siempre es JSON (una cadena ya serializada por
// quien llama), pero las subidas de imagen/foto mandan el File tal
// cual -- en el servidor eso llegaba como un Buffer via express.raw(),
// aqui llega como los bytes en un Uint8Array.
async function toLocalRequestBody(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  return body;
}

// El "servidor" ya no existe: api() despacha contra el router local
// (public/local-api.js), que ejecuta las MISMAS rutas del backend de
// siempre, portadas a public/routes-local/. Se mantiene async y con la
// misma firma a proposito, para no tocar ninguno de los ~50 sitios que
// la llaman ni las funciones load*() de la app.
async function api(path, options = {}) {
  await initLocalDatabase();

  // La base de una URL relativa da igual (nada sale del dispositivo);
  // se usa solo para separar la ruta de los parametros de consulta.
  const url = new URL(path, 'http://local');
  const method = (options.method || 'GET').toUpperCase();
  const body = await toLocalRequestBody(options.body);
  const { status, body: data } = await dispatchLocalRequest(
    method,
    url.pathname,
    url.searchParams,
    body,
    options.headers || {},
  );

  if (status >= 400) {
    // Misma forma de error que antes (un Error con el mensaje que
    // devuelve la ruta), para que los try/catch de siempre no cambien.
    throw new Error((data && data.message) || `Error ${status}`);
  }

  return status === 204 ? null : data;
}

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
  renderMobileCalendarMonthGrid();
  refreshMobileCalendarNavLabel();
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Las flechas del mes navegan por AÑO en vez de por mes mientras estas
// en la vista anual (ver calendarViewMode mas abajo) -- mismo boton,
// distinto salto, coherente con lo que se esta mirando.
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
    'extensions-view', 'gym-view', 'finanzas-view',
    'lecturas-view', 'note-editor-view',
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

// Interruptor de animaciones (Configuracion > Este dispositivo, por
// dispositivo): con el apagado, TODAS las transiciones del calendario
// (deslizar y zoom) se saltan -- pedido de Koku, para no gastar
// recursos cuando no se quieren.
function areAnimationsEnabled() {
  return localStorage.getItem('animationsEnabled') !== 'false';
}

// Animacion de zoom al cambiar de NIVEL del calendario (año <-> mes <->
// dia) -- distinta de la de deslizar (playMobileSwipeTransition), que es
// para moverse DENTRO del mismo nivel. "in" = bajar de nivel (meterse en
// un mes/dia: la vista nueva crece desde pequeña, como acercandose);
// "out" = subir de nivel (la vista nueva encoge desde grande, como
// alejandose). BANCO DE PRUEBAS: Koku quiere verlo en el movil antes de
// darlo por bueno -- es posible que se retire (ver CLAUDE.md).
function playMobileZoomTransition(el, direction) {
  if (!el || !areAnimationsEnabled()) return;
  const cls = `mobile-zoom-anim-${direction}`;
  el.classList.remove('mobile-zoom-anim-in', 'mobile-zoom-anim-out');
  void el.offsetWidth;
  el.classList.add(cls);
  const cleanup = () => el.classList.remove(cls);
  el.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, 350);
}

async function setCalendarViewMode(mode) {
  if (mode === calendarViewMode) return;
  calendarViewMode = mode;
  if (mode === 'year') await refreshMobileCalendarYearGrid();
  else await loadMonth();
  refreshMobileCalendarModeVisibility();
  refreshMobileCalendarNavLabel();
  // Zoom segun el sentido del cambio: al año se SUBE de nivel (out), al
  // mes se BAJA desde el año (in). La vista diaria tiene sus propias
  // llamadas en enterMobileDayView()/exitMobileDayView().
  if (mode === 'year') playMobileZoomTransition(document.getElementById('mobile-calendar-year-grid'), 'out');
  else playMobileZoomTransition(document.getElementById('mobile-calendar-month-grid'), 'in');
}

// ---------------------------------------------------------------------
// Calendario: vistas de mes y de año, cada una con su propio contenedor
// (se alternan con .hidden desde setCalendarViewMode). Los eventos del año
// entero se piden de golpe una vez (loadYearViewEvents) y se cachean.
// ---------------------------------------------------------------------

// Gesto generico de swipe (Pointer Events -- funciona con dedo, raton o
// lapiz con un unico mecanismo, sin depender de eventos "touch"
// especificos). Solo detecta la DIRECCION al soltar, sin arrastre en
// vivo -- suficiente para cambiar de mes/año/dia, no hace falta mas.
function attachSwipe(el, { onUp, onDown, onLeft, onRight, threshold = 40, preserveVerticalScroll = false } = {}) {
  let startX = null;
  let startY = null;
  el.addEventListener('pointerdown', (e) => {
    if (isGestureBlockedByModal()) return;
    // Un SEGUNDO dedo mientras habia un swipe empezado = es un pellizco
    // (ver attachPinch), no un deslizamiento -- se cancela el swipe para
    // que al levantar los dedos no se dispare un cambio de mes/dia por
    // accidente ademas del cambio de nivel.
    if (startX !== null) {
      startX = null;
      startY = null;
      return;
    }
    startX = e.clientX;
    startY = e.clientY;
    // Sin esto, si el dedo se sale del contenedor durante el arrastre (muy
    // facil cerca de un borde, en una cuadricula no muy alta), el
    // "pointerup" llega al elemento que haya debajo del dedo en ESE
    // momento, no a este -- y el gesto se queda "colgado" sin completarse.
    // setPointerCapture fuerza a que TODO el gesto (incluido el pointerup)
    // siga llegando aqui pase lo que pase. (En try/catch: un pointerId
    // que el navegador ya no reconoce como activo lanza excepcion, y eso
    // no debe tumbar el resto del gesto.)
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* sin capture, el gesto normal sigue valiendo */ }
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
  // Refuerzo para toque real, aparte de Pointer Events/touch-action (ver
  // styles.css): touch-action:none es la forma "de manual" segun el
  // estandar, pero tiene fama de fallar en algunos motores tactiles
  // concretos (algunas versiones de Safari iOS, o cuando un gesto del
  // propio navegador/SO -- tirar para refrescar, deslizar desde el borde
  // para volver atras -- le gana la carrera). Este listener 'touchmove'
  // NATIVO (no Pointer Events), registrado sin passive para poder
  // cancelarlo, es el mecanismo mas robusto: en cuanto el dedo supera una
  // zona muerta pequeña mientras hay un pointerdown activo, se bloquea el
  // gesto nativo de raiz. Un toque normal (tap, sin arrastre real) nunca
  // supera la zona muerta, asi que no interfiere con los clics de
  // dias/meses/años.
  el.addEventListener('touchmove', (e) => {
    if (startX === null) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    // preserveVerticalScroll: solo para contenedores que SI necesitan
    // scroll vertical nativo de verdad (la vista diaria, a diferencia de
    // mes/año/tira semanal, que no lo necesitan) -- ahi solo se bloquea
    // el gesto nativo cuando el arrastre pinta claramente horizontal
    // (mas ancho que alto), dejando pasar cualquier arrastre vertical
    // para que el scroll de la pagina siga funcionando con normalidad.
    if (preserveVerticalScroll) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) e.preventDefault();
    } else if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      e.preventDefault();
    }
  }, { passive: false });
}

// Gesto de PELLIZCO (dos dedos juntandose) para SUBIR de nivel en el
// calendario: dia -> mes, mes -> año. Solo hacia arriba a proposito
// (decision de Koku): el pellizco inverso para bajar exigiria saber
// DONDE se hace zoom (que mes, que dia), y bajar ya es solo tocar el
// mes/dia -- no compensa la complejidad. Mismo mecanismo de Pointer
// Events que attachSwipe (y que el zoom del mapa de Viajes): se apuntan
// los punteros activos y, con dos a la vez, se compara la distancia
// entre ellos con la del principio -- si encoge por debajo del umbral,
// se dispara UNA vez por gesto. attachSwipe ya se cancela solo en
// cuanto detecta el segundo dedo (ver su pointerdown), asi que un
// pellizco nunca dispara ademas un cambio de mes/dia por accidente.
function attachPinch(el, onPinchIn) {
  const punteros = new Map();
  let distanciaInicial = null;
  let disparado = false;
  const medir = () => {
    const pts = [...punteros.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };
  el.addEventListener('pointerdown', (e) => {
    if (isGestureBlockedByModal()) return;
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.size === 2) {
      distanciaInicial = medir();
      disparado = false;
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!punteros.has(e.pointerId)) return;
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.size === 2 && distanciaInicial && !disparado) {
      // 0.72: los dedos tienen que acercarse de verdad (a menos de 3/4
      // de la distancia inicial) -- un roce accidental de dos dedos no
      // llega a esto.
      if (medir() < distanciaInicial * 0.72) {
        disparado = true;
        onPinchIn();
      }
    }
  });
  const soltar = (e) => {
    punteros.delete(e.pointerId);
    if (punteros.size < 2) distanciaInicial = null;
  };
  el.addEventListener('pointerup', soltar);
  el.addEventListener('pointercancel', soltar);
  // Con dos dedos en pantalla, que el navegador no intente su propio
  // zoom/scroll nativo mientras dura el pellizco (mismo refuerzo de
  // touchmove sin passive que ya usa attachSwipe).
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) e.preventDefault();
  }, { passive: false });
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
// grupo, ver events.group_id en local-schema.js), es agregar varios
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

// Ajuste por dispositivo (localStorage, NO sincronizado): que tan
// "denso" se ve un dia con eventos en el mes. Se elige en la propia
// barra del calendario, no en Configuracion.
const MOBILE_CALENDAR_MONTH_MODE_IDS = ['compact', 'stacked', 'listed'];
function getMobileCalendarMonthMode() {
  const stored = localStorage.getItem('mobileCalendarMonthMode');
  return MOBILE_CALENDAR_MONTH_MODE_IDS.includes(stored) ? stored : 'compact';
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
  document.getElementById('mobile-calendar-density-field').classList.toggle('hidden', calendarViewMode === 'year');
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
  // Nombre del mes, centrado debajo de la barra -- solo visible en modo
  // mes (la vista anual ya no tiene "un mes concreto" que nombrar).
  // Se actualiza aqui mismo, en el mismo sitio que ya se llama cada vez
  // que cambia el mes/año/vista, en vez de buscar cada punto de cambio
  // por separado.
  const monthNameEl = document.getElementById('mobile-calendar-month-name');
  if (monthNameEl) {
    monthNameEl.classList.toggle('hidden', calendarViewMode === 'year');
    monthNameEl.textContent = capitalizeFirst(MONTH_ONLY_FORMATTER.format(state.viewDate));
  }
}

document.getElementById('btn-mobile-calendar-nav-label').addEventListener('click', () => {
  if (calendarViewMode === 'year') enterMonthFromYear(state.viewDate.getMonth());
  else setCalendarViewMode('year');
});
// Desplegable en vez de icono ciclico -- mismo motivo/patron que
// mobileDayViewModeField mas abajo: Koku pidio ver las 3 opciones y
// elegir directamente, en vez de tener que darle al icono hasta que
// saliera la que buscaba.
const mobileCalendarDensityField = createSelectField({
  options: [
    { value: 'compact', label: 'Compacto' },
    { value: 'stacked', label: 'Apilado' },
    { value: 'listed', label: 'Listado' },
  ],
  initialValue: getMobileCalendarMonthMode(),
  onChange: (v) => {
    localStorage.setItem('mobileCalendarMonthMode', v);
    renderMobileCalendarMonthGrid();
    refreshMobileCalendarModeVisibility();
  },
});
document.getElementById('mobile-calendar-density-field').appendChild(mobileCalendarDensityField.element);
// El listener real de btn-mobile-calendar-search (abre el buscador
// global de la Fase 5) se registra mas abajo, junto al resto del
// buscador (runMobileGlobalSearch/openMobileGlobalSearch).

// Swipe vertical del MES: arriba = mes siguiente, abajo = mes anterior
// (direccion normal). Swipe vertical del AÑO: arriba = año ANTERIOR,
// abajo = año siguiente -- direccion EXPLICITAMENTE invertida, pedido
// asi por Koku.

// Pequeña animacion de entrada (deslizar+fundido) al cambiar de mes/
// año/dia por swipe -- Koku la pidio para "hacerlo mas visual". Un
// helper generico: añade la clase, fuerza un reflow (para que se pueda
// repetir aunque sea la MISMA clase que la ultima vez -- si no, el
// navegador no vuelve a disparar los @keyframes) y la quita sola al
// terminar (con un respaldo por si "animationend" no llega, p.ej. si el
// contenido se vuelve a pintar a medio camino). No espera a que
// termine de cargar el contenido nuevo (loadMonth()/showMobileDay() son
// async y no se esperan aqui tampoco) -- es puramente cosmetico, sin
// bloquear nada.
function playMobileSwipeTransition(el, direction) {
  if (!el || !areAnimationsEnabled()) return;
  const cls = `mobile-swipe-anim-${direction}`;
  el.classList.remove('mobile-swipe-anim-up', 'mobile-swipe-anim-down', 'mobile-swipe-anim-left', 'mobile-swipe-anim-right');
  void el.offsetWidth;
  el.classList.add(cls);
  const cleanup = () => el.classList.remove(cls);
  el.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, 300);
}

attachSwipe(document.getElementById('mobile-calendar-month-grid'), {
  onUp: () => {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
    loadMonth();
    playMobileSwipeTransition(document.getElementById('mobile-calendar-month-grid'), 'up');
  },
  onDown: () => {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
    loadMonth();
    playMobileSwipeTransition(document.getElementById('mobile-calendar-month-grid'), 'down');
  },
});
attachSwipe(document.getElementById('mobile-calendar-year-grid'), {
  onUp: () => {
    state.viewDate = new Date(state.viewDate.getFullYear() - 1, state.viewDate.getMonth(), 1);
    refreshMobileCalendarYearGrid();
    refreshMobileCalendarNavLabel();
    playMobileSwipeTransition(document.getElementById('mobile-calendar-year-grid'), 'up');
  },
  onDown: () => {
    state.viewDate = new Date(state.viewDate.getFullYear() + 1, state.viewDate.getMonth(), 1);
    refreshMobileCalendarYearGrid();
    refreshMobileCalendarNavLabel();
    playMobileSwipeTransition(document.getElementById('mobile-calendar-year-grid'), 'down');
  },
});

// Pellizco = subir de nivel: en el mes lleva al año. (En el año no hay
// nada por encima, ahi no se engancha nada.)
attachPinch(document.getElementById('mobile-calendar-month-grid'), () => {
  if (calendarViewMode === 'month') setCalendarViewMode('year');
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

function scrollMobileHoursToTime(date, targetMinutes) {
  // Desde que la vista diaria acota su propio alto (body.mobile-day-
  // scroll-lock, ver styles.css), quien se desplaza de verdad es
  // .mobile-hours-scroll, no la pagina -- antes era al reves y esto
  // usaba window.scrollTo(). El grid es hijo directo de ese contenedor,
  // que ademas es position:relative, asi que su offsetTop ya esta medido
  // respecto a el.
  const grid = document.getElementById('mobile-hours-grid');
  const scroller = document.querySelector('.mobile-hours-scroll');
  if (!grid || !scroller) return;
  // targetMinutes explicito (p. ej. la hora real de un evento clicado
  // desde el buscador global) tiene prioridad; si no se pasa, se sigue
  // el comportamiento de siempre ("ahora" si es hoy, 8:00 si no).
  if (targetMinutes === undefined) {
    const now = new Date();
    targetMinutes = sameDay(date, now) ? (now.getHours() * 60 + now.getMinutes()) : 8 * 60;
  }
  // Deja un par de horas de margen ANTES del objetivo, para que no quede
  // pegado justo al borde superior de la pantalla.
  scroller.scrollTop = Math.max(0, grid.offsetTop + targetMinutes - 120);
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

// --- "Listado": UNA sola lista continua con TODOS los eventos, de
// cualquier año (pedido de Koku: "que muestre todo, de todos los años,
// un scroll infinito con todos los eventos"). Antes era una ventana de
// ±3 dias alrededor del dia que estuvieras viendo, asi que al cambiar de
// mes desaparecian los demas.
//
// Se piden TODOS los eventos de golpe (GET /api/events sin from/to, ya
// ordenado por fecha) y se agrupan por dia una sola vez; lo que se
// amplia al deslizar no es un rango de fechas sino cuantos de esos dias
// se PINTAN -- asi da igual que entre dos eventos haya tres años de
// hueco, no hay que recorrer dia a dia el calendario entero.
let mobileListadoDays = null;    // [{ key, date, events[] }], solo dias CON algo
let mobileListadoWindow = null;  // { start, end } indices dentro de mobileListadoDays
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
// Cuantos dias-con-contenido se añaden cada vez que se llega a un
// extremo. No hay tope: la lista puede acabar mostrandolo todo.
const MOBILE_LISTADO_CHUNK = 20;

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

// Trae TODOS los eventos con fecha y los agrupa por dia (solo los dias
// que tienen algo). Se hace una vez por entrada en la vista; ampliar la
// lista al deslizar ya no vuelve a pedir nada.
async function loadMobileListadoDays() {
  const events = await api('/api/events');
  const byDay = new Map();
  events.forEach((ev) => {
    if (!ev.startAt) return; // sin fecha no aparece aqui, igual que en el resto del calendario
    const key = toDateKey(new Date(ev.startAt));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(ev);
  });
  mobileListadoDays = [...byDay.entries()]
    .map(([key, evs]) => ({
      key,
      date: new Date(`${key}T00:00:00`),
      events: evs.sort((a, b) => new Date(a.startAt) - new Date(b.startAt)),
    }))
    .sort((a, b) => a.date - b.date);
}

function renderMobileListadoWindow() {
  const content = document.getElementById('mobile-day-listado-content');
  content.innerHTML = '';
  if (!mobileListadoDays || mobileListadoDays.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'Todavía no hay ningún evento ni tarea con fecha.';
    content.appendChild(empty);
    return;
  }
  const { start, end } = mobileListadoWindow;
  mobileListadoDays.slice(start, end).forEach((day) => {
    const block = document.createElement('div');
    block.className = 'mobile-day-listado-block';
    const heading = document.createElement('div');
    heading.className = 'mobile-day-listado-block-heading';
    heading.textContent = formatMobileListadoBlockHeading(day.date);
    block.appendChild(heading);
    day.events.forEach((ev) => block.appendChild(buildMobileListadoRow(ev)));
    content.appendChild(block);
  });
}

async function expandMobileDayListado(direction) {
  if (!mobileListadoDays || !mobileListadoWindow) return;
  if (mobileDayListadoBusy) { mobileDayListadoPending.add(direction); return; }
  mobileDayListadoBusy = true;
  try {
    // Bucle en vez de una sola pasada: al terminar, si mientras tanto se
    // pidio expandir en otro sentido (ver mobileDayListadoPending
    // arriba), se procesa tambien antes de soltar el candado -- así
    // nunca se pierde un aviso del observer por haber llegado a la vez
    // que otro ya en curso.
    while (true) {
      const { start, end } = mobileListadoWindow;
      const yaTodo = direction === 'back' ? start === 0 : end >= mobileListadoDays.length;
      if (!yaTodo) {
        // El scroll ocurre DENTRO de #mobile-day-listado-view (la vista
        // acota su propio alto, ver body.mobile-day-scroll-lock en
        // styles.css) -- se mide sobre el propio contenedor, no sobre la
        // pagina.
        const listado = document.getElementById('mobile-day-listado-view');
        const prevDocHeight = listado.scrollHeight;
        const prevScrollY = listado.scrollTop;
        if (direction === 'back') mobileListadoWindow.start = Math.max(0, start - MOBILE_LISTADO_CHUNK);
        else mobileListadoWindow.end = Math.min(mobileListadoDays.length, end + MOBILE_LISTADO_CHUNK);
        renderMobileListadoWindow();
        if (direction === 'back') {
          // Compensa el scroll para que anteponer dias arriba no de un
          // salto visual (el contenido nuevo empuja hacia abajo lo que ya
          // se veia).
          listado.scrollTop = prevScrollY + (listado.scrollHeight - prevDocHeight);
        }
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
  // root = el propio contenedor que se desplaza (ver
  // body.mobile-day-scroll-lock en styles.css): desde que la vista
  // diaria acota su alto, es el quien desborda, no la pagina.
  mobileDayListadoObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      if (entry.target === topSentinel) expandMobileDayListado('back');
      else if (entry.target === bottomSentinel) expandMobileDayListado('forward');
    });
  }, { root: document.getElementById('mobile-day-listado-view'), threshold: 0 });
  mobileDayListadoObserver.observe(topSentinel);
  mobileDayListadoObserver.observe(bottomSentinel);
}

// centerDate solo decide por DONDE empieza la lista (lo mas cerca de hoy
// o del dia que estuvieras mirando); la lista en si lo contiene todo.
async function renderMobileDayListado(centerDate) {
  await loadMobileListadoDays();
  // Obsoleto si mientras se cargaba se cambio de sub-vista o se salio.
  if (getMobileDayViewMode() !== 'listado') return;
  if (document.getElementById('mobile-calendar-day-view').classList.contains('hidden')) return;

  const refKey = toDateKey(centerDate || new Date());
  let idx = mobileListadoDays.findIndex((d) => d.key >= refKey);
  if (idx === -1) idx = Math.max(0, mobileListadoDays.length - 1); // todo es pasado: al final
  mobileListadoWindow = {
    start: Math.max(0, idx - 5),
    end: Math.min(mobileListadoDays.length, idx + MOBILE_LISTADO_CHUNK),
  };
  renderMobileListadoWindow();
  // Deja el dia de referencia arriba del todo, en vez del primero de los
  // 5 anteriores que se cargan de contexto.
  const listado = document.getElementById('mobile-day-listado-view');
  const bloques = document.querySelectorAll('#mobile-day-listado-content .mobile-day-listado-block');
  const objetivo = bloques[idx - mobileListadoWindow.start];
  listado.scrollTop = objetivo ? Math.max(0, objetivo.offsetTop - 8) : 0;
  // El primer observe() de IntersectionObserver avisa de inmediato con
  // el estado actual -- si la ventana inicial (±3 dias) no llega a
  // desbordar la pantalla real, esa primera notificacion ya se encarga
  // de ampliarla sola (ver expandMobileDayListado), sin necesitar aqui
  // ningun bucle de relleno a mano.
  setupMobileDayListadoObserver();
}

async function renderMobileDayActiveSubView({ scrollToNow = false, targetMinutes } = {}) {
  const mode = getMobileDayViewMode();
  document.getElementById('mobile-day-hours-view').classList.toggle('hidden', mode !== 'hours');
  document.getElementById('mobile-day-listado-view').classList.toggle('hidden', mode !== 'listado');
  // En "Listado" no hay un dia concreto que mirar: es una tira continua
  // de dias con scroll infinito hacia los dos lados, y cada bloque ya
  // lleva su propia fecha. Asi que la tira de dias de la semana y el
  // titulo del dia sobran ahi (pedido de Koku: "que sea solo una
  // pantalla de scroll infinito"). En "Vista por horas" se quedan, que
  // ahi si estas viendo UN dia.
  document.getElementById('mobile-calendar-day-view').classList.toggle('is-listado', mode === 'listado');
  stopMobileCurrentTimeLineTimer();
  if (mode === 'hours') {
    disconnectMobileDayListadoObserver();
    await renderMobileHoursView(state.mobileCalendarDayDate);
    if (targetMinutes !== undefined) scrollMobileHoursToTime(state.mobileCalendarDayDate, targetMinutes);
    else if (scrollToNow) scrollMobileHoursToTime(state.mobileCalendarDayDate);
    mobileCurrentTimeLineTimer = setInterval(() => refreshMobileCurrentTimeLine(state.mobileCalendarDayDate), 60 * 1000);
  } else {
    await renderMobileDayListado(state.mobileCalendarDayDate);
  }
}

// Si la vista diaria movil esta abierta Y mostrando este mismo dia,
// la vuelve a pintar -- para que guardar/borrar un evento o tarea (p.
// ej. cambiar "Todo el dia" <-> hora fija) se refleje al instante sin
// tener que salir y volver a entrar. Sin scrollToNow (no se quiere
// saltar la posicion de lectura actual solo por haber guardado).
function refreshOpenMobileDayViewIfShowing(date) {
  if (!date) return;
  const dayView = document.getElementById('mobile-calendar-day-view');
  if (!dayView || dayView.classList.contains('hidden')) return;
  if (!state.mobileCalendarDayDate || toDateKey(state.mobileCalendarDayDate) !== toDateKey(date)) return;
  renderMobileDayActiveSubView({ scrollToNow: false });
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

// ---------------------------------------------------------------------
// Buscador global (Fase 5): eventos+tareas via GET /api/events?q= (ya
// construido en la Fase 1, ignora from/to a proposito) + notas filtradas
// en cliente sobre state.notes (ya cargadas de antemano al iniciar la
// app, sin peticion aparte). Un solo overlay reutilizado desde los dos
// botones de busqueda (mes y dia).
// ---------------------------------------------------------------------
let mobileGlobalSearchDebounceTimer = null;

function openMobileGlobalSearch() {
  document.getElementById('mobile-global-search-input').value = '';
  document.getElementById('mobile-global-search-results').innerHTML = '';
  document.getElementById('mobile-global-search').classList.remove('hidden');
  document.getElementById('mobile-global-search-input').focus();
}

function closeMobileGlobalSearch() {
  document.getElementById('mobile-global-search').classList.add('hidden');
}

function formatMobileSearchResultDate(date, allDay) {
  const datePart = `${date.getDate()} ${MOBILE_DAY_MONTH_ABBR[date.getMonth()]}`;
  return allDay ? datePart : `${datePart}, ${toTimeInputValue(date)}`;
}

function buildMobileSearchResultRow({ typeClass, typeLabel, title, meta, onClick }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'reminder-item mobile-search-result-item';
  row.innerHTML = `
    <span class="mobile-search-result-main">
      <span class="mobile-search-type-dot ${typeClass}" aria-hidden="true" title="${typeLabel}"></span>
      <span class="mobile-search-result-title"></span>
    </span>
    <span class="mobile-search-result-meta"></span>
  `;
  row.querySelector('.mobile-search-result-title').textContent = title;
  row.querySelector('.mobile-search-result-meta').textContent = meta || '';
  row.addEventListener('click', onClick);
  return row;
}

async function runMobileGlobalSearch(query) {
  const results = document.getElementById('mobile-global-search-results');
  const trimmed = query.trim();
  if (!trimmed) {
    results.innerHTML = '';
    return;
  }
  let items;
  try {
    items = await api(`/api/events?q=${encodeURIComponent(trimmed)}`);
  } catch (err) {
    items = [];
  }
  const lowerQuery = trimmed.toLowerCase();
  const matchingNotes = (state.notes || []).filter(
    (n) => n.title && n.title.toLowerCase().includes(lowerQuery)
  );

  results.innerHTML = '';
  if (!items.length && !matchingNotes.length) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'Sin resultados.';
    results.appendChild(hint);
    return;
  }

  for (const item of items) {
    const hasDate = !!item.startAt;
    const date = hasDate ? new Date(item.startAt) : null;
    const row = buildMobileSearchResultRow({
      typeClass: item.isTask ? 'is-task' : 'is-event',
      typeLabel: item.isTask ? 'Tarea' : 'Evento',
      title: item.title,
      meta: hasDate ? formatMobileSearchResultDate(date, item.allDay) : 'Sin fecha',
      onClick: () => {
        closeMobileGlobalSearch();
        if (item.isTask && !hasDate) { openTaskModal(item); return; }
        // "Todo el dia": sin objetivo de scroll (que se vea la fila de
        // arriba, no desplazarse dentro de la rejilla); si no, la hora
        // real del evento clicado -- antes esto siempre desplazaba a
        // "ahora", llevando al dia correcto pero a la hora equivocada.
        const targetDate = date || new Date();
        const targetMinutes = item.allDay ? null : (targetDate.getHours() * 60 + targetDate.getMinutes());
        enterMobileDayView(targetDate, { targetMinutes });
      },
    });
    results.appendChild(row);
  }
  for (const note of matchingNotes) {
    const row = buildMobileSearchResultRow({
      typeClass: 'is-note',
      typeLabel: 'Nota',
      title: note.title || '(sin título)',
      meta: '',
      onClick: () => {
        closeMobileGlobalSearch();
        openMobileNotesView();
        openNoteInEditor(note);
      },
    });
    results.appendChild(row);
  }
}

document.getElementById('mobile-global-search-input').addEventListener('input', (e) => {
  clearTimeout(mobileGlobalSearchDebounceTimer);
  const value = e.target.value;
  mobileGlobalSearchDebounceTimer = setTimeout(() => runMobileGlobalSearch(value), 250);
});
document.getElementById('btn-close-mobile-global-search').addEventListener('click', closeMobileGlobalSearch);
document.getElementById('btn-mobile-calendar-search').addEventListener('click', openMobileGlobalSearch);
document.getElementById('btn-mobile-calendar-day-search').addEventListener('click', openMobileGlobalSearch);

async function showMobileDay(date, { scrollToNow = false, targetMinutes } = {}) {
  state.mobileCalendarDayDate = date;
  document.getElementById('mobile-calendar-day-heading').textContent = formatMobileDayHeading(date);
  const monthLabel = capitalizeFirst(MONTH_ONLY_FORMATTER.format(date));
  document.getElementById('btn-mobile-day-back-label').innerHTML =
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg><span>${monthLabel}</span>`;
  await Promise.all([renderMobileWeekStrip(date), renderMobileDayActiveSubView({ scrollToNow, targetMinutes })]);
}

// targetMinutes opcional: si se pasa (p. ej. un resultado del buscador
// global con hora real), se desplaza ahi en vez de a "ahora". Pasar
// null explicitamente (evento "todo el dia") evita desplazarse dentro
// de la rejilla en absoluto, para que se vea la fila de arriba.
function enterMobileDayView(date, { targetMinutes } = {}) {
  document.getElementById('mobile-calendar-month-toolbar').classList.add('hidden');
  document.querySelector('.mobile-calendar-view').classList.add('hidden');
  document.getElementById('mobile-calendar-day-view').classList.remove('hidden');
  // Marca para el CSS: mientras se ve el dia, la pagina deja de crecer
  // con el contenido y el desplazamiento pasa a ser SOLO el de la
  // rejilla de horas / la lista de eventos, no el de la pantalla
  // entera (pedido de Koku: "lo unico que se deberia deslizar es la
  // pantalla de horas o de eventos"). Ver .mobile-day-scroll-lock.
  document.body.classList.add('mobile-day-scroll-lock');
  if (targetMinutes === null) {
    showMobileDay(date, { scrollToNow: false });
  } else {
    showMobileDay(date, { scrollToNow: true, targetMinutes });
  }
  // Bajar de nivel (meterse en el dia): zoom de entrada.
  playMobileZoomTransition(document.getElementById('mobile-calendar-day-view'), 'in');
}

function exitMobileDayView() {
  stopMobileCurrentTimeLineTimer();
  disconnectMobileDayListadoObserver();
  document.getElementById('mobile-calendar-day-view').classList.add('hidden');
  document.getElementById('mobile-calendar-month-toolbar').classList.remove('hidden');
  document.querySelector('.mobile-calendar-view').classList.remove('hidden');
  document.body.classList.remove('mobile-day-scroll-lock');
  // Subir de nivel (dia -> mes): zoom de salida sobre la vista que vuelve.
  playMobileZoomTransition(document.querySelector('.mobile-calendar-view'), 'out');
}

document.getElementById('btn-mobile-day-back-label').addEventListener('click', exitMobileDayView);

// Swipe horizontal en la tira semanal (unico area sin scroll vertical
// propio dentro de la vista diaria -- ya lleva touch-action:pan-x en
// styles.css, pensado justo para esto): izquierda = dia siguiente,
// derecha = dia anterior. Si el nuevo dia cae en otra semana, la tira
// se recalcula sola (showMobileDay -> renderMobileWeekStrip).
// Enganchado a TODA la vista diaria (cabecera + contenido), no solo a
// la tira semanal -- antes solo funcionaba deslizando sobre esa fila
// estrecha, que es justo lo que reporto Koku ("en la vista diaria no
// funciona el SWIPE"). preserveVerticalScroll:true porque, a diferencia
// de mes/año/tira semanal (que no necesitan scroll vertical propio), el
// contenido de la vista diaria (rejilla de horas/listado) SI necesita
// que el scroll vertical normal de la pagina siga funcionando -- solo
// se bloquea el gesto nativo cuando el arrastre es claramente
// horizontal. Un solo listener (no uno aparte para la tira semanal) para
// no disparar el cambio de dia DOS veces por el mismo gesto (los
// eventos de puntero suben por burbujeo desde la tira, que vive dentro
// de esta misma seccion).
function playMobileDaySwipeAnimation(direction) {
  playMobileSwipeTransition(document.getElementById('mobile-day-hours-view'), direction);
  playMobileSwipeTransition(document.getElementById('mobile-day-listado-view'), direction);
}
// Pellizco en la vista diaria = subir al mes.
attachPinch(document.getElementById('mobile-calendar-day-view'), exitMobileDayView);
attachSwipe(document.getElementById('mobile-calendar-day-view'), {
  preserveVerticalScroll: true,
  onLeft: () => {
    const d = state.mobileCalendarDayDate;
    showMobileDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), { scrollToNow: true });
    playMobileDaySwipeAnimation('left');
  },
  onRight: () => {
    const d = state.mobileCalendarDayDate;
    showMobileDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1), { scrollToNow: true });
    playMobileDaySwipeAnimation('right');
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
// Hora en punto de AHORA, hacia abajo: a las 17:17 propone 17:00 (y con
// la hora de fin, que ya suma una hora, queda 17:00-18:00). Antes
// redondeaba a la media hora mas cercana, asi que a las 17:17 proponia
// 17:30-18:30 -- Koku pidio explicitamente lo primero.
function roundDownToHour(date) {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  return rounded;
}

const eventStartTimeField = createTimeField({ initialValue: toTimeInputValue(new Date()) });
document.getElementById('event-start-time-field').appendChild(eventStartTimeField.element);

const eventEndTimeField = createTimeField({ initialValue: toTimeInputValue(new Date()) });
document.getElementById('event-end-time-field').appendChild(eventEndTimeField.element);

// presetDate (opcional): al crear un evento nuevo desde el panel de un
// dia concreto, arranca ya con esa fecha puesta (a las 09:00 por
// defecto) en vez de con la fecha/hora actual.
function refreshEventAllDayFields() {
  const isAllDay = document.getElementById('event-all-day').checked;
  document.getElementById('event-start-time-field').classList.toggle('hidden', isAllDay);
  document.getElementById('event-end-time-field').classList.toggle('hidden', isAllDay);
}
document.getElementById('event-all-day').addEventListener('change', refreshEventAllDayFields);

function openEventModal(event, presetDate) {
  const modal = document.getElementById('event-modal');
  document.getElementById('event-modal-title').textContent = event ? 'Editar evento' : 'Nuevo evento';
  document.getElementById('event-id').value = event ? event.id : '';
  document.getElementById('event-title').value = event ? event.title : '';
  document.getElementById('event-all-day').checked = event ? event.allDay : false;
  refreshEventAllDayFields();
  let defaultStart = new Date();
  if (presetDate) {
    defaultStart = new Date(presetDate);
    defaultStart.setHours(9, 0, 0, 0);
  } else {
    defaultStart = roundDownToHour(defaultStart);
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
  refreshOpenMobileDayViewIfShowing(startDate);
});

document.getElementById('btn-delete-event').addEventListener('click', async () => {
  const id = document.getElementById('event-id').value;
  if (!id) return;
  if (!confirm('¿Eliminar este evento?')) return;
  const deletedDate = eventStartDateField.getValue();
  await api(`/api/events/${id}`, { method: 'DELETE' });
  closeEventModal();
  loadMonth();
  loadReminders();
  refreshOpenMobileDayViewIfShowing(deletedDate);
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
async function loadReminders() {
  const upcoming = await api('/api/reminders/upcoming');
  const now = new Date();
  state.upcomingReminders = upcoming;

  // Cualquier cambio en eventos pasa por aqui, asi que es el sitio
  // natural para reprogramar los avisos del sistema (los que suenan con
  // la app cerrada) sin tener que acordarse en cada crear/editar/borrar.
  syncScheduledReminders();

  // Aviso "en caliente", mientras la app esta ABIERTA. El aviso de
  // verdad con la app cerrada lo programa el sistema operativo (ver
  // syncScheduledReminders arriba) -- esto solo cubre el rato en que
  // estas mirando la pantalla, donde un aviso programado no llegaria a
  // verse. Se activan desde la pestana "Este dispositivo" del panel de
  // Configuracion (settings.js), no automaticamente: los navegadores y
  // el sistema exigen que el permiso se pida a raiz de un click.
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
// mutedTaskColor vive en settings.js (se carga despues de este
// archivo) — solo se usa aqui dentro de funciones
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

  // Pendientes primero (por fecha, las sin fecha al final) y las hechas
  // despues, tachadas.
  const byDate = (a, b) => {
    if (!a.startAt && !b.startAt) return 0;
    if (!a.startAt) return 1;
    if (!b.startAt) return -1;
    return new Date(a.startAt) - new Date(b.startAt);
  };
  const pending = state.tasks.filter((t) => !t.done).sort(byDate);
  const done = state.tasks.filter((t) => t.done).sort(byDate);

  [...pending, ...done].forEach((task) => container.appendChild(buildTaskRow(task)));
}

async function toggleTaskDone(task) {
  const updated = await api(`/api/events/${task.id}`, { method: 'PUT', body: JSON.stringify({ done: !task.done }) });
  const idx = state.tasks.findIndex((t) => t.id === task.id);
  if (idx !== -1) state.tasks[idx] = updated;
  renderTasksList();
  loadMonth(); // refleja el cambio en el calendario si la tarea tiene fecha
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
  refreshOpenMobileDayViewIfShowing(dateValue);
});

document.getElementById('btn-delete-task').addEventListener('click', async () => {
  const id = document.getElementById('task-id').value;
  if (!id) return;
  if (!confirm('¿Eliminar esta tarea?')) return;
  const deletedDate = taskDateField.getValue();
  await api(`/api/events/${id}`, { method: 'DELETE' });
  closeTaskModal();
  await loadTasks();
  renderTasksList();
  loadMonth();
  refreshOpenMobileDayViewIfShowing(deletedDate);
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
// renderNotesViewInto): 'browse' (normal) o 'select' (checkbox delante,
// la fila entera marca/desmarca en vez de abrir/navegar). Editar una
// carpeta ya no es un modo aparte: vive en las acciones de deslizar/
// mantener pulsado, junto a Mover y Eliminar.
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

  // Abrir en SOLO LECTURA: el modo se elige aqui, al entrar, no dentro
  // de la nota (pedido de Koku -- clic normal en la fila = editar, este
  // boton = leer sin poder tocar nada; para cambiar de modo se sale al
  // listado y se vuelve a entrar por el otro camino).
  if (mode === 'browse' && !note.hidden) {
    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'note-item-read-btn';
    readBtn.setAttribute('aria-label', `Abrir "${note.title}" en solo lectura`);
    readBtn.title = 'Abrir en solo lectura';
    readBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5c2-1 5-1 8 1 3-2 6-2 8-1v13c-2-1-5-1-8 1-3-2-6-2-8-1z"></path><path d="M12 6v13"></path></svg>';
    readBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openNoteInEditor(note, { readMode: true });
    });
    row.appendChild(readBtn);
  }

  row.appendChild(buildFavoriteStarBtn(note.favorite, (e) => {
    e.stopPropagation();
    toggleNoteFavorite(note);
  }));

  attachNoteItemGestures(row, itemKey);
  row.addEventListener('click', () => {
    if (mode === 'select') { toggleMobileNotesSelection(itemKey); return; }
    // Una nota oculta no se abre con un simple clic en la fila — solo el
    // icono de ojo la destapa (sin ningun texto/boton de aviso encima del
    // blur, para no recargar la fila).
    if (note.hidden) return;
    openNoteInEditor(note);
  });
  return mode === 'browse' ? wrapNoteRowWithSwipe(row, itemKey) : row;
}

// Carpeta con icono de ojo (Fase 3, navegacion tipo explorador de
// archivos): la fila entera abre esa carpeta al clicarla; el lapiz
// (aparte, con su propio stopPropagation) la edita sin entrar. Ver
// comentario de "mode" en buildNoteRow arriba -- se comparte el mismo
// concepto para las dos.
function buildFolderRow(folder, { showPath = false, mode = 'browse' } = {}) {
  const row = document.createElement('div');
  row.className = 'note-item note-folder-row';
  // Marca de "aqui se puede soltar" para arrastrar y soltar.
  row.dataset.folderId = String(folder.id);

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

  row.appendChild(buildFavoriteStarBtn(folder.favorite, (e) => {
    e.stopPropagation();
    toggleFolderFavorite(folder);
  }));

  attachNoteItemGestures(row, itemKey);
  row.addEventListener('click', () => {
    if (mode === 'select') { toggleMobileNotesSelection(itemKey); return; }
    state.currentNoteFolderId = folder.id;
    clearNoteSearch();
    renderNotesView();
  });
  return mode === 'browse' ? wrapNoteRowWithSwipe(row, itemKey) : row;
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
  // Al repintar, la fila que estuviera deslizada desaparece del DOM: sin
  // esto la referencia se quedaria apuntando a un nodo ya suelto.
  openSwipedNoteRow = null;
  container.innerHTML = '';

  const query = (state.noteSearchQuery || '').trim().toLowerCase();
  const searchWholeApp = !!query && !state.noteSearchCurrentFolderOnly;

  const backBtn = document.getElementById(cfg.backBtnId);
  if (backBtn) backBtn.classList.toggle('hidden', state.currentNoteFolderId === null || searchWholeApp);

  // "mode" (Seleccionar/Mover) lo pone el menu de 3 puntos de la
  // vista de Notas (setMobileNotesMode). Orden y vista galeria/listado son
  // ajustes por dispositivo, guardados en localStorage.
  const mode = mobileNotesMode;
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

  // En galeria las CARPETAS tambien son tarjetas: mezclarlas con la fila
  // de listado dejaba dos formatos distintos en la misma pantalla.
  function appendFolderGroup(items, showPath) {
    if (!useGallery) {
      appendFavoriteSortedGroup(container, items, (f) => buildFolderRow(f, { showPath, mode }));
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'mobile-notes-gallery-grid';
    appendFavoriteSortedGroup(grid, items, (f) => buildFolderGalleryCard(f, { mode }));
    if (grid.children.length > 0) container.appendChild(grid);
  }

  // En modo Mover solo tiene sentido navegar entre CARPETAS (elegir el
  // destino) -- las notas no pueden contener nada, se ocultan del todo
  // para no confundir con "¿tambien puedo moverlo aqui dentro?".
  if (searchWholeApp) {
    const matchFolders = state.noteFolders.filter((f) => f.name.toLowerCase().includes(query));
    const matchNotes = mode === 'move' ? [] : (state.notes || []).filter((n) => n.title.toLowerCase().includes(query));
    if (matchFolders.length === 0 && matchNotes.length === 0) {
      container.innerHTML = '<p class="empty-hint">Nada coincide con esa búsqueda.</p>';
      return;
    }
    appendFolderGroup(matchFolders, true);
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
    container.innerHTML = `<p class="empty-hint">${query ? 'Nada coincide con esa búsqueda.' : (mode === 'move' ? 'No hay subcarpetas aquí.' : 'No hay nada aquí todavía.')}</p>`;
    return;
  }

  appendFolderGroup(subfolders, false);
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
  div.innerHTML = prepareAssetHtmlForDom(note.bodyFormat === 'html' ? note.body : legacyNoteBodyToHtml(note.body));
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
    setAssetImageSrc(img, thumbSrc);
    img.alt = '';
    media.appendChild(img);
  } else {
    // Fondo neutro SIEMPRE (el de la tarjeta): pintarlo del color de la
    // carpeta hacia que la galeria cambiara de color entera segun donde
    // estuvieras, y el avance de texto encima se leia fatal.
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

  // Abrir en solo lectura: mismo boton que la fila del listado, que aqui
  // faltaba (la galeria solo dejaba abrir para editar).
  if (mode === 'browse' && !note.hidden) {
    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'mobile-note-gallery-read-btn';
    readBtn.setAttribute('aria-label', `Abrir "${note.title}" en solo lectura`);
    readBtn.title = 'Abrir en solo lectura';
    readBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5c2-1 5-1 8 1 3-2 6-2 8-1v13c-2-1-5-1-8 1-3-2-6-2-8-1z"></path><path d="M12 6v13"></path></svg>';
    readBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openNoteInEditor(note, { readMode: true });
    });
    card.appendChild(readBtn);
  }

  card.appendChild(buildFavoriteStarBtn(note.favorite, (e) => {
    e.stopPropagation();
    toggleNoteFavorite(note);
  }));

  card.addEventListener('click', () => {
    if (mode === 'select') { toggleMobileNotesSelection(itemKey); return; }
    if (note.hidden) return;
    openNoteInEditor(note);
  });
  if (mode === 'browse') attachNoteItemGestures(card, itemKey);
  return card;
}

// Carpeta como TARJETA de galeria: en vista galeria las carpetas se
// veian con la fila de listado de siempre, y quedaba una mezcla rara de
// dos formatos. Misma tarjeta que una nota, con el icono de carpeta
// grande sobre su color en vez de miniatura.
function buildFolderGalleryCard(folder, { mode = 'browse' } = {}) {
  const card = document.createElement('div');
  card.className = 'mobile-note-gallery-card is-folder';
  card.dataset.folderId = String(folder.id);
  const itemKey = mobileNotesItemKey('folder', folder.id);

  if (mode === 'select') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'styled-checkbox mobile-note-gallery-checkbox';
    checkbox.checked = mobileNotesSelectedKeys.has(itemKey);
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => toggleMobileNotesSelection(itemKey));
    card.appendChild(checkbox);
  }

  // Carpeta de CONTORNO, no pintada del todo: rellena de su color se
  // veia como un bloque plano ("me gustaba la carpeta sólo el icono, el
  // borde, sin estar pintada del todo, le daba más clase"). El color de
  // la carpeta sigue siendo el del trazo, asi que se distingue igual.
  const media = document.createElement('div');
  media.className = 'mobile-note-gallery-media';
  media.innerHTML = '<svg class="mobile-note-gallery-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  media.querySelector('svg').style.color = folder.color || 'var(--accent)';
  card.appendChild(media);

  const title = document.createElement('span');
  title.className = 'mobile-note-gallery-title';
  title.textContent = folder.name;
  card.appendChild(title);

  card.appendChild(buildFavoriteStarBtn(folder.favorite, (e) => {
    e.stopPropagation();
    toggleFolderFavorite(folder);
  }));

  card.addEventListener('click', () => {
    if (mode === 'select') { toggleMobileNotesSelection(itemKey); return; }
    state.currentNoteFolderId = folder.id;
    clearNoteSearch();
    renderNotesView();
  });
  if (mode === 'browse') attachNoteItemGestures(card, itemKey);
  return card;
}

// ---------------------------------------------------------------------
// Acciones rapidas de una nota/carpeta sin pasar por "Seleccionar":
// deslizar la fila hacia la izquierda en el listado, o mantener pulsada
// la tarjeta en galeria. Las dos abren lo mismo: Mover y Eliminar, que
// reutilizan el modo Seleccionar de siempre con ese unico elemento
// marcado (una sola forma de mover/borrar por dentro, ver la regla de
// simplicidad en CLAUDE.md).
// ---------------------------------------------------------------------
function startNoteItemMove(itemKey) {
  mobileNotesSelectedKeys.clear();
  mobileNotesSelectedKeys.add(itemKey);
  setMobileNotesMode('move');
}

// Borrar UNO desde sus acciones va directo, con su aviso y ya esta: antes
// metia la vista entera en modo Seleccionar (checkboxes y barra incluidos)
// para borrar un solo elemento, que es justo lo que Koku no queria.
async function startNoteItemDelete(itemKey) {
  const { item } = resolveMobileNotesItem(itemKey) || {};
  const nombre = item ? getNoteListItemName(item) : 'esto';
  const conContenido = mobileNotesDeletionIncludesFolderWithContent([itemKey]);
  const ok = await showAppConfirm(
    conContenido
      ? `¿Eliminar "${nombre}"? Lo que hay dentro subirá un nivel, salvo que marques la casilla.`
      : `¿Eliminar "${nombre}"?`,
    {
      okText: 'Eliminar',
      danger: true,
      checkbox: conContenido ? { label: 'Eliminar también lo que hay dentro' } : null,
    }
  );
  if (!ok) return;
  await deleteNoteItems([itemKey], conContenido && lastAppConfirmCheckbox);
  renderNotesView();
}

// Editar SOLO tiene sentido en una carpeta (nombre y color) -- una nota
// se edita abriendola sin mas. Sustituye al modo "Editar carpetas" del
// menu de 3 puntos, que hacia justo esto pero obligando a entrar y salir
// de un modo entero para tocar una sola carpeta.
function startNoteItemEdit(itemKey) {
  const { kind, item } = resolveMobileNotesItem(itemKey) || {};
  if (kind === 'folder' && item) openNoteFolderModal(item);
}

function isNoteItemFolder(itemKey) {
  return itemKey.startsWith('folder:');
}

const NOTE_ACTION_EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

const NOTE_ACTION_MOVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m12 11 3 3-3 3"/><path d="M9 14h6"/></svg>';
const NOTE_ACTION_DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

const noteItemActionMenu = document.createElement('div');
noteItemActionMenu.className = 'note-item-action-menu hidden';
document.body.appendChild(noteItemActionMenu);

function openNoteItemActionMenu(anchorEl, itemKey) {
  noteItemActionMenu.innerHTML = '';
  const { item } = resolveMobileNotesItem(itemKey) || {};
  if (item) {
    const titulo = document.createElement('p');
    titulo.className = 'note-item-action-title';
    titulo.textContent = getNoteListItemName(item);
    noteItemActionMenu.appendChild(titulo);
  }
  const acciones = [['Mover', NOTE_ACTION_MOVE_ICON, '', () => startNoteItemMove(itemKey)]];
  if (isNoteItemFolder(itemKey)) {
    acciones.push(['Editar', NOTE_ACTION_EDIT_ICON, '', () => startNoteItemEdit(itemKey)]);
  }
  acciones.push(['Eliminar', NOTE_ACTION_DELETE_ICON, 'is-danger', () => startNoteItemDelete(itemKey)]);
  acciones.forEach(([texto, icono, extra, fn]) => {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = `note-item-action-btn ${extra}`.trim();
    opt.innerHTML = `${icono}<span>${texto}</span>`;
    opt.addEventListener('click', () => {
      noteItemActionMenu.classList.add('hidden');
      fn();
    });
    noteItemActionMenu.appendChild(opt);
  });
  noteItemActionMenu.classList.remove('hidden');
  positionFixedPopover(anchorEl, noteItemActionMenu, { width: 210 });
}

document.addEventListener('pointerdown', (e) => {
  if (noteItemActionMenu.classList.contains('hidden')) return;
  if (e.target.closest && e.target.closest('.note-item-action-menu')) return;
  noteItemActionMenu.classList.add('hidden');
});

const NOTE_LONG_PRESS_MS = 450;
const NOTE_DRAG_THRESHOLD_PX = 12;

// ---------------------------------------------------------------------
// Arrastrar y soltar para mover notas/carpetas: mantener pulsado LEVANTA
// el elemento (o todos los marcados, si estas en modo Seleccionar y este
// es uno de ellos). Si lo sueltas encima de una carpeta, se mueve ahi
// dentro; encima del boton "Volver", sube un nivel. Si lo sueltas sin
// haberte movido, lo que sale es el menu de Mover/Eliminar.
// ---------------------------------------------------------------------
let noteDrag = null; // { keys, ghost, target, targetEl }

function noteDragKeysFor(itemKey) {
  // Con varios marcados, arrastrar uno de ellos los mueve todos.
  if ((mobileNotesMode === 'select' || mobileNotesMode === 'move')
    && mobileNotesSelectedKeys.has(itemKey)) return [...mobileNotesSelectedKeys];
  return [itemKey];
}

// No se puede meter una carpeta dentro de si misma ni de una hija suya
// (el servidor lo rechazaria; aqui se evita antes para no dar un error).
function isNoteFolderInside(folderId, possibleAncestorId) {
  let actual = state.noteFolders.find((f) => f.id === folderId);
  while (actual) {
    if (actual.id === possibleAncestorId) return true;
    actual = state.noteFolders.find((f) => f.id === actual.parentId);
  }
  return false;
}

function noteDropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el || !el.closest) return null;
  const volver = el.closest('#btn-mobile-notes-back');
  if (volver && !volver.classList.contains('hidden')) {
    const actual = state.noteFolders.find((f) => f.id === state.currentNoteFolderId);
    return { el: volver, folderId: actual ? actual.parentId : null };
  }
  const fila = el.closest('.note-folder-row, .mobile-note-gallery-card.is-folder');
  if (!fila || !fila.dataset.folderId) return null;
  const folderId = Number(fila.dataset.folderId);
  // Ni sobre si misma ni sobre una carpeta que este dentro de la que
  // arrastras.
  const invalido = noteDrag && noteDrag.keys.some((k) => {
    const { kind, id } = resolveMobileNotesItem(k);
    return kind === 'folder' && (id === folderId || isNoteFolderInside(folderId, id));
  });
  if (invalido) return null;
  return { el: fila, folderId };
}

function setNoteDropTarget(destino) {
  if (noteDrag.targetEl && noteDrag.targetEl !== (destino && destino.el)) {
    noteDrag.targetEl.classList.remove('is-drop-target');
  }
  noteDrag.target = destino;
  noteDrag.targetEl = destino ? destino.el : null;
  if (noteDrag.targetEl) noteDrag.targetEl.classList.add('is-drop-target');
}

function startNoteDrag(el, itemKey, e) {
  const keys = noteDragKeysFor(itemKey);
  const ghost = document.createElement('div');
  ghost.className = 'note-drag-ghost';
  const { item } = resolveMobileNotesItem(keys[0]) || {};
  ghost.textContent = keys.length > 1
    ? `${keys.length} elementos`
    : (item ? getNoteListItemName(item) : 'Moviendo…');
  document.body.appendChild(ghost);
  noteDrag = { keys, ghost, target: null, targetEl: null };
  document.body.classList.add('note-dragging');
  moveNoteDragGhost(e);
}

function moveNoteDragGhost(e) {
  noteDrag.ghost.style.left = `${e.clientX}px`;
  noteDrag.ghost.style.top = `${e.clientY}px`;
}

async function finishNoteDrag() {
  if (!noteDrag) return;
  const { keys, target } = noteDrag;
  if (noteDrag.targetEl) noteDrag.targetEl.classList.remove('is-drop-target');
  noteDrag.ghost.remove();
  document.body.classList.remove('note-dragging');
  noteDrag = null;
  if (!target) return;
  const ok = await moveNoteItemsTo(keys, target.folderId);
  if (ok && mobileNotesMode !== 'browse') setMobileNotesMode('browse');
  else if (ok) renderNotesView();
}

function attachNoteItemGestures(el, itemKey) {
  let temporizador = null;
  let inicio = null;
  let levantado = false;
  const cancelar = () => { clearTimeout(temporizador); temporizador = null; inicio = null; levantado = false; };

  el.addEventListener('pointerdown', (e) => {
    inicio = { x: e.clientX, y: e.clientY, id: e.pointerId, evento: e };
    temporizador = setTimeout(() => {
      temporizador = null;
      levantado = true;
      el.dataset.longPressed = '1';
      if (el.setPointerCapture) el.setPointerCapture(inicio.id);
    }, NOTE_LONG_PRESS_MS);
  });

  el.addEventListener('pointermove', (e) => {
    if (!inicio) return;
    const lejos = Math.abs(e.clientX - inicio.x) > NOTE_DRAG_THRESHOLD_PX
      || Math.abs(e.clientY - inicio.y) > NOTE_DRAG_THRESHOLD_PX;
    // Antes de que se cumpla la pulsacion larga, moverse es scroll o
    // deslizar la fila: se descarta el gesto.
    if (!levantado) { if (lejos) cancelar(); return; }
    e.preventDefault();
    if (!noteDrag) { if (!lejos) return; startNoteDrag(el, itemKey, e); }
    moveNoteDragGhost(e);
    setNoteDropTarget(noteDropTargetAt(e.clientX, e.clientY));
  });

  el.addEventListener('pointerup', (e) => {
    const eraLevantado = levantado;
    clearTimeout(temporizador); temporizador = null; inicio = null; levantado = false;
    if (noteDrag) { finishNoteDrag(); return; }
    // Pulsacion larga sin moverse: el menu de acciones.
    if (eraLevantado) openNoteItemActionMenu(el, itemKey);
  });
  el.addEventListener('pointercancel', () => { cancelar(); if (noteDrag) finishNoteDrag(); });

  // Tras una pulsacion larga NO se abre la nota: el click llega despues
  // del pointerup, asi que se marca y se descarta ese unico click.
  el.addEventListener('click', (e) => {
    if (el.dataset.longPressed) {
      delete el.dataset.longPressed;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

// Solo una fila abierta a la vez -- abrir otra cierra la anterior.
let openSwipedNoteRow = null;

function closeSwipedNoteRow() {
  if (!openSwipedNoteRow) return;
  openSwipedNoteRow.classList.remove('is-open');
  openSwipedNoteRow = null;
}

// Pinchar en cualquier otro sitio cierra la fila deslizada -- antes solo
// se cerraba deslizandola de vuelta o pulsando una de sus acciones, asi
// que se quedaba abierta "a medias" mientras tocabas otra cosa.
document.addEventListener('pointerdown', (e) => {
  if (!openSwipedNoteRow) return;
  if (e.target.closest && e.target.closest('.note-swipe-wrap') === openSwipedNoteRow) return;
  closeSwipedNoteRow();
}, true);

// Envuelve la fila para poder deslizarla: los dos botones viven DEBAJO,
// y la fila se desplaza hacia la izquierda para descubrirlos.
function wrapNoteRowWithSwipe(row, itemKey) {
  const wrap = document.createElement('div');
  wrap.className = 'note-swipe-wrap';

  const acciones = document.createElement('div');
  acciones.className = 'note-swipe-actions';
  const lista = [['Mover', 'secondary-btn', () => startNoteItemMove(itemKey)]];
  // "Editar" solo en carpetas (nombre y color) -- una nota se edita
  // abriendola sin mas.
  if (isNoteItemFolder(itemKey)) lista.push(['Editar', 'secondary-btn', () => startNoteItemEdit(itemKey)]);
  lista.push(['Eliminar', 'danger-btn', () => startNoteItemDelete(itemKey)]);
  lista.forEach(([texto, clase, fn]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = clase;
    btn.textContent = texto;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSwipedNoteRow();
      fn();
    });
    acciones.appendChild(btn);
  });
  wrap.appendChild(acciones);
  wrap.appendChild(row);

  let inicio = null;
  let horizontal = false;
  row.addEventListener('pointerdown', (e) => {
    inicio = { x: e.clientX, y: e.clientY };
    horizontal = false;
  });
  row.addEventListener('pointermove', (e) => {
    if (!inicio) return;
    const dx = e.clientX - inicio.x;
    const dy = e.clientY - inicio.y;
    // En cuanto se ve que el gesto es horizontal, deja de ser scroll de
    // la lista y pasa a ser "deslizar la fila".
    if (!horizontal && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) horizontal = true;
  });
  row.addEventListener('pointerup', (e) => {
    if (!inicio) return;
    const dx = e.clientX - inicio.x;
    inicio = null;
    // Si el gesto acabo siendo una pulsacion larga (menu o arrastre), no
    // es un deslizamiento.
    if (row.dataset.longPressed || noteDrag) return;
    if (!horizontal) return;
    if (dx < -40) {
      if (openSwipedNoteRow !== wrap) closeSwipedNoteRow();
      // Cuanto se desplaza la fila depende de cuantos botones haya (una
      // carpeta tiene uno mas, "Editar"): se mide el ancho real en vez
      // de dejar un valor fijo que se quedaria corto o largo.
      wrap.style.setProperty('--swipe-actions-width', `${acciones.offsetWidth}px`);
      wrap.classList.add('is-open');
      openSwipedNoteRow = wrap;
    } else if (dx > 20) {
      closeSwipedNoteRow();
    }
    // Un deslizamiento no debe abrir la nota: se descarta ese click.
    row.dataset.swiped = '1';
  });
  row.addEventListener('click', (e) => {
    if (row.dataset.swiped) {
      delete row.dataset.swiped;
      if (wrap.classList.contains('is-open')) { e.stopPropagation(); e.preventDefault(); }
    }
  }, true);
  return wrap;
}

// Estado compartido (state.noteSearchQuery/...) entre las dos vistas
// posibles -- limpiar el texto tiene que hacerlo en CUALQUIER input de
// busqueda que exista en el DOM, no solo el de escritorio.
function clearNoteSearch() {
  state.noteSearchQuery = '';
  ['mobile-notes-search-input'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
}


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
let mobileNotesMode = 'browse'; // 'browse' | 'select' | 'move'
const mobileNotesSelectedKeys = new Set(); // 'folder:<id>' / 'note:<id>'

function mobileNotesItemKey(kind, id) {
  return `${kind}:${id}`;
}

function toggleMobileNotesSelection(itemKey) {
  if (mobileNotesSelectedKeys.has(itemKey)) mobileNotesSelectedKeys.delete(itemKey);
  else mobileNotesSelectedKeys.add(itemKey);
  refreshMobileNotesActionBar();
  renderNotesView();
}

function setMobileNotesMode(mode) {
  mobileNotesMode = mode;
  if (mode !== 'select' && mode !== 'move') mobileNotesSelectedKeys.clear();
  refreshMobileNotesActionBar();
  refreshMobileNotesFab();
  renderNotesView();
}

// Barra de accion: compartida por escritorio y movil (una sola forma de
// mover notas, ver regla de simplicidad en CLAUDE.md) -- cada plataforma
// tiene su propio par de botones en el DOM (mismo patron que
// NOTES_VIEW_TARGETS), rellenados con el mismo texto/handler segun el
// modo activo.
const NOTES_ACTION_BAR_TARGETS = {
  mobile: { barId: 'mobile-notes-action-bar', leftId: 'btn-mobile-notes-action-left', rightId: 'btn-mobile-notes-action-right' },
};

// Sin seleccion propia (Eliminar/Mover deshabilitados con nada marcado),
// o con el par Cancelar/"Mover aquí" durante el modo Mover -- un unico
// par de botones reutilizado para los dos casos en vez de 2 barras
// distintas, replicado en las dos plataformas.
function refreshMobileNotesActionBar() {
  Object.values(NOTES_ACTION_BAR_TARGETS).forEach(({ barId, leftId, rightId }) => {
    const bar = document.getElementById(barId);
    if (!bar) return;
    const leftBtn = document.getElementById(leftId);
    const rightBtn = document.getElementById(rightId);

    if (mobileNotesMode === 'select') {
      // Seleccionar sirve para BORRAR varios de una vez, y ya esta:
      // mover se hace arrastrando (pedido explicito de Koku), asi que
      // aqui el par es Eliminar / Cancelar.
      bar.classList.remove('hidden');
      leftBtn.textContent = 'Eliminar';
      leftBtn.className = 'danger-btn';
      leftBtn.disabled = mobileNotesSelectedKeys.size === 0;
      leftBtn.onclick = openMobileNotesDeleteModal;
      rightBtn.textContent = 'Cancelar';
      rightBtn.className = 'secondary-btn';
      rightBtn.disabled = false;
      rightBtn.onclick = () => setMobileNotesMode('browse');
    } else if (mobileNotesMode === 'move') {
      // Modo Mover: solo se llega aqui desde la accion "Mover" de una
      // fila (deslizar / mantener pulsado). Cancelar vuelve a la
      // navegacion normal, NO al modo Seleccionar -- volver ahi dejaba
      // la vista con checkboxes puestos sin haberlos pedido.
      bar.classList.remove('hidden');
      leftBtn.textContent = 'Cancelar';
      leftBtn.className = 'secondary-btn';
      leftBtn.disabled = false;
      leftBtn.onclick = () => setMobileNotesMode('browse');
      rightBtn.textContent = 'Mover aquí';
      rightBtn.className = 'primary-btn';
      rightBtn.disabled = false;
      rightBtn.onclick = confirmMobileNotesMove;
    } else {
      bar.classList.add('hidden');
    }
  });

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

// El borrado en si. Con "conContenido" a true, una carpeta arrastra todo
// lo que tenga dentro (ver ?deleteContents=1 en routes-local/noteFolders.js);
// sin el, lo de dentro sube UN nivel y no se pierde nada.
async function deleteNoteItems(keys, conContenido) {
  for (const key of keys) {
    const { kind, id } = resolveMobileNotesItem(key);
    if (kind === 'note') await api(`/api/notes/${id}`, { method: 'DELETE' });
    else await api(`/api/note-folders/${id}${conContenido ? '?deleteContents=1' : ''}`, { method: 'DELETE' });
  }
  await Promise.all([loadNotes(), loadNoteFolders()]);
}

// Pregunta lo que haya que preguntar y borra. Devuelve false si se
// cancela. Lo usa el modal de borrar varios.
async function runNoteItemsDeletion(keys) {
  const conContenido = mobileNotesDeletionIncludesFolderWithContent(keys);
  if (conContenido) {
    const proceed = await showAppConfirm(
      'Lo que haya dentro de las carpetas que borres subirá un nivel, salvo que marques la casilla.',
      { okText: 'Eliminar', danger: true, checkbox: { label: 'Eliminar también lo que hay dentro' } }
    );
    if (!proceed) return false;
    await deleteNoteItems(keys, lastAppConfirmCheckbox);
    return true;
  }
  await deleteNoteItems(keys, false);
  return true;
}

document.getElementById('btn-mobile-notes-delete-confirm').addEventListener('click', async () => {
  const finalKeys = [...mobileNotesSelectedKeys].filter((k) => !mobileNotesDeleteExcluded.has(k));
  if (finalKeys.length === 0) { closeMobileNotesDeleteModal(); return; }
  if (!(await runNoteItemsDeletion(finalKeys))) return;
  closeMobileNotesDeleteModal();
  setMobileNotesMode('browse');
});

// Modo Mover: usa la navegacion de carpetas de siempre (el usuario entra
// en la carpeta destino como si estuviera navegando normal, ver el
// filtrado de "mode === 'move'" en renderNotesViewInto) -- "Mover aqui"
// aplica state.currentNoteFolderId como destino de todo lo seleccionado.
// Mueve una lista de elementos a una carpeta (o a la raiz, con null).
// Lo comparten "Mover aquí" del modo Mover y el arrastrar y soltar.
async function moveNoteItemsTo(keys, destinationFolderId) {
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
    return false;
  }
  await Promise.all([loadNotes(), loadNoteFolders()]);
  return true;
}

async function confirmMobileNotesMove() {
  const ok = await moveNoteItemsTo([...mobileNotesSelectedKeys], state.currentNoteFolderId);
  if (ok) setMobileNotesMode('browse');
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
  const corner = document.getElementById('note-table-corner');
  if (corner) corner.classList.add('hidden');
  const tableToolbar = document.getElementById('note-table-toolbar');
  if (tableToolbar) tableToolbar.classList.add('hidden');
  document.getElementById('note-body-toolbar').classList.remove('hidden');
  document.getElementById('note-paragraph-style-btn').disabled = false;
  document.getElementById('note-quote-toggle-btn').disabled = false;
  document.getElementById('note-quote-toggle-btn').classList.remove('is-active');
  document.getElementById('note-indent-btn').disabled = false;
  document.getElementById('note-outdent-btn').disabled = false;
  document.getElementById('note-highlight-btn').disabled = false;
  document.getElementById('note-highlight-btn').classList.remove('is-active');
  cancelPendingNoteHighlight();
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

// Junta el refresco de negrita/cursiva/lista y el del icono de tabla en
// una sola llamada -- se disparan siempre juntos, con el mismo cambio de
// seleccion o tecla dentro del editor.
function refreshNoteEditorState() {
  refreshNoteEditorToolbar();
  closeTableToolbarIfCaretLeft();
  refreshTableCornerButton();
  refreshNoteBlockButtons();
  refreshPendingNoteHighlightState();
  refreshNoteHighlightSwatchActiveState();
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

// ---------------------------------------------------------------------
// Formato estilo Notas de iPhone: estilos de parrafo (Titulo/
// Encabezado/Subencabezado/Cuerpo/Monoespaciado), sangria/quitar
// sangria, bloque de cita, y resaltado de color. Los 3 primeros son
// "de bloque" (se aplican al parrafo ENTERO donde este el cursor, no a
// una seleccion) -- el resaltado es "en linea" (se aplica a la
// seleccion, como negrita/cursiva/subrayado/tachado, que ya iban por
// execCommand generico mas arriba).
// ---------------------------------------------------------------------

// Sube desde el nodo dado hasta encontrar un hijo DIRECTO de
// NOTE_EDITOR_BODY -- el "bloque" en el que esta el cursor (p/div/
// h1/h2/h3, o <li> si esta dentro de una lista). null si no hay
// seleccion, si el nodo no esta dentro del editor, o si el cursor esta
// en la "primera linea sin envolver" (texto suelto pegado directamente
// a NOTE_EDITOR_BODY, ver el comentario de findFirstLineBreakIndexClient
// mas abajo) -- en ese caso no hay ningun ELEMENTO del que colgar un
// atributo todavia, para eso esta ensureNoteBlockWrapped().
function getNoteBlockAncestor(node) {
  if (!node || !NOTE_EDITOR_BODY.contains(node)) return null;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  while (node && node !== NOTE_EDITOR_BODY) {
    if (node.parentElement === NOTE_EDITOR_BODY) return node;
    node = node.parentElement;
  }
  return null;
}

// Fuerza que la linea actual quede envuelta en un elemento real antes
// de tocarle atributos a mano (data-quote/data-indent) -- necesario
// para la "primera linea sin envolver". formatBlock('<div>') es un
// no-op visual si la linea ya estaba envuelta (el navegador no la
// vuelve a envolver dos veces), asi que es seguro llamarlo siempre.
function ensureNoteBlockWrapped() {
  if (getNoteBlockAncestor(window.getSelection().anchorNode)) return;
  document.execCommand('formatBlock', false, '<div>');
}

function isSelectionInsideNoteListItem() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  return !!(node && NOTE_EDITOR_BODY.contains(node) && node.closest('li'));
}

// Estilo de parrafo/cita/sangria se desactivan (no solo "no hacen
// nada") con el cursor dentro de una lista: Notas de iPhone tampoco
// ofrece Titulo/cita sobre una linea con vineta, y las listas ya
// tienen su propio mecanismo de sangria (Tab/Shift+Tab dentro de un
// <li>, ver maybeIndentNoteListItem mas abajo, con execCommand nativo)
// -- reutilizar los mismos botones para dos mecanismos distintos segun
// el contexto seria confuso. El resaltado de color SI tiene sentido
// dentro de una lista (es un formato en linea) -- solo se desactiva
// dentro de un bloque de codigo, igual que negrita/cursiva/listas.
function refreshNoteBlockButtons() {
  const disabled = isSelectionInsideNoteListItem() || isCursorInCodeBlock();
  // Los tres botones de bloque miran la seleccion ENTERA, no solo la
  // linea del cursor (ver getNoteSelectionBlocks()). La cita se marca
  // como activa solo si TODAS las lineas seleccionadas lo estan, que es
  // justo cuando volver a pulsarla las apaga.
  const indentBlocks = disabled ? [] : getNoteSelectionBlocks();
  document.getElementById('note-paragraph-style-btn').disabled = disabled;
  document.getElementById('note-quote-toggle-btn').disabled = disabled;
  document.getElementById('note-quote-toggle-btn').classList.toggle(
    'is-active',
    indentBlocks.length > 0 && indentBlocks.every((b) => b.getAttribute('data-quote') === '1'),
  );

  const indents = indentBlocks.length
    ? indentBlocks.map((b) => Math.max(0, Math.min(NOTE_MAX_INDENT, parseInt(b.dataset.indent || '0', 10) || 0)))
    : [0];
  const canOutdent = indents.some((i) => i > 0);
  const canIndent = indents.some((i) => i < NOTE_MAX_INDENT);
  document.getElementById('note-indent-btn').disabled = disabled || !canIndent;
  document.getElementById('note-outdent-btn').disabled = disabled || !canOutdent;

  document.getElementById('note-highlight-btn').disabled = isCursorInCodeBlock();
}

function applyNoteParagraphStyle(styleName) {
  if (isSelectionInsideNoteListItem() || isCursorInCodeBlock()) return;
  restoreNoteEditorSelection();
  // "Cuerpo" usa <div> (no <p>) a proposito: es exactamente lo que ya
  // produce una linea normal sin tocar hoy, asi que elegir "Cuerpo" no
  // introduce ninguna etiqueta nueva. El nombre de etiqueta se pasa
  // siempre explicito (con "<>") en vez de fiarse del bloque por
  // defecto del navegador, que varia entre motores.
  const tagMap = { title: '<h1>', heading: '<h2>', subheading: '<h3>', body: '<div>', mono: '<div>' };
  document.execCommand('formatBlock', false, tagMap[styleName]);
  // Los bloques se recalculan DESPUES del formatBlock a proposito: ese
  // comando sustituye cada elemento por uno nuevo con la etiqueta
  // pedida, asi que cualquier referencia capturada antes apuntaria a
  // nodos ya desenganchados. Y se recorren TODOS los de la seleccion,
  // no solo el del cursor -- si no, seleccionar varias lineas y elegir
  // "Monoespaciado" solo cambiaba la primera (reportado por Koku).
  getNoteSelectionBlocks().forEach((block) => {
    if (styleName === 'mono') block.setAttribute('data-style', 'mono');
    else block.removeAttribute('data-style');
  });
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// A proposito NO usa execCommand('indent') ni <blockquote> nativo --
// execCommand('indent') sobre un parrafo normal envuelve en
// <blockquote> por defecto en la mayoria de motores, lo que chocaria
// con esta misma pieza si se usara la etiqueta nativa para las dos
// cosas. Atributo manual data-quote="1", independiente del todo.
function toggleNoteQuoteBlock() {
  if (isSelectionInsideNoteListItem() || isCursorInCodeBlock()) return;
  const blocks = getNoteSelectionBlocks({ ensureWrapped: true });
  if (blocks.length === 0) return;
  // Con varias lineas seleccionadas el boton funciona como un unico
  // interruptor para todas: si YA estan todas en cita, se quita; si
  // hay alguna que no, se pone en todas (es lo que se espera de un
  // boton que se ve "encendido" o "apagado", no una mezcla).
  const todasSonCita = blocks.every((b) => b.getAttribute('data-quote') === '1');
  blocks.forEach((block) => {
    if (todasSonCita) block.removeAttribute('data-quote');
    else block.setAttribute('data-quote', '1');
  });
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// Misma razon que la cita para no usar execCommand('indent'/'outdent')
// aqui -- ese mecanismo nativo se deja intacto SOLO para el Tab/
// Shift+Tab ya existente dentro de un <li> (maybeIndentNoteListItem,
// mas abajo). Para parrafos normales, atributo numerico manual
// data-indent="0".."4" (0 = sin atributo, para no ensuciar los
// bloques nunca tocados).
const NOTE_MAX_INDENT = 4;

function applyNoteIndentDeltaToBlock(block, delta) {
  const current = Math.max(0, Math.min(NOTE_MAX_INDENT, parseInt(block.dataset.indent || '0', 10) || 0));
  const next = Math.max(0, Math.min(NOTE_MAX_INDENT, current + delta));
  if (next === 0) block.removeAttribute('data-indent');
  else block.setAttribute('data-indent', String(next));
}

// Bloques (hijos directos de NOTE_EDITOR_BODY) que toca la seleccion
// actual -- un solo elemento con el cursor sin seleccionar nada, o
// todos los que la seleccion cruza si hay varias lineas marcadas. Lo
// comparten las TRES acciones de bloque (sangria, cita y estilo de
// parrafo): antes solo la sangria miraba la seleccion entera y las
// otras dos actuaban unicamente sobre la linea del cursor, que es
// justo lo que Koku reporto ("si selecciono varias lineas y le doy a
// poner comentario, solo actua en la primera").
//
// ensureWrapped: envuelve la linea suelta antes de devolver los
// bloques, para las acciones que necesitan un elemento real donde
// colgar un atributo. Se hace con el mismo cuidado de siempre --
// capturar los limites del Range ANTES de mover nada, porque un Range
// no sigue al nodo que se mueve cuando su CONTENEDOR es justo ese nodo
// (ver ensureNoteFirstLineWrapped).
function getNoteSelectionBlocks({ ensureWrapped = false } = {}) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return [];
  if (sel.isCollapsed) {
    if (ensureWrapped) ensureNoteBlockWrapped();
    const block = getNoteBlockAncestor(window.getSelection().anchorNode);
    return block ? [block] : [];
  }
  const live = sel.getRangeAt(0);
  const startContainer = live.startContainer;
  const startOffset = live.startOffset;
  const endContainer = live.endContainer;
  const endOffset = live.endOffset;
  if (ensureWrapped) ensureNoteFirstLineWrapped();
  const range = document.createRange();
  range.setStart(startContainer, startOffset);
  range.setEnd(endContainer, endOffset);
  return Array.from(NOTE_EDITOR_BODY.children).filter((el) => range.intersectsNode(el));
}

function applyNoteIndentDelta(delta) {
  if (isSelectionInsideNoteListItem() || isCursorInCodeBlock()) return;
  getNoteSelectionBlocks({ ensureWrapped: true })
    .forEach((block) => applyNoteIndentDeltaToBlock(block, delta));
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// Resaltado de color (fondo, tipo rotulador -- confirmado con Koku, no
// subrayado de color): manipulacion manual del DOM en vez de
// execCommand('hiliteColor', ...), que solo sabe tocar background-color
// y es poco fiable para LIMPIAR (era la causa real de que el boton
// "Ninguno" no funcionara). Atributo cerrado data-highlight (5 valores
// fijos, ver NOTE_HIGHLIGHT_SWATCHES) -- los colores concretos (fondo Y
// texto, para contraste real) se definen una sola vez en CSS, nunca con
// un style en linea puesto por el usuario.

// Elementos de "linea" (un renglon logico del editor, separado por
// Intro) -- SI incluye <li> a diferencia de getNoteBlockAncestor (el
// resaltado tiene sentido dentro de listas, a diferencia de estilo de
// parrafo/cita/sangria).
const NOTE_LINE_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'LI']);

function getNoteLineElement(node) {
  if (!node || !NOTE_EDITOR_BODY.contains(node)) return null;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  while (node && node !== NOTE_EDITOR_BODY) {
    if (NOTE_LINE_TAGS.has(node.tagName)) return node;
    node = node.parentElement;
  }
  return null;
}

// Resuelve la "linea" de un extremo de Range a partir de (container,
// offset) -- no basta con mirar solo "container" (lo que hacia la
// primera version de esto): un "Ctrl+A" real en Chrome dice el rango
// como (NOTE_EDITOR_BODY, 0) a (NOTE_EDITOR_BODY, numHijos), es decir,
// el propio contenedor del editor con un offset, nunca desciende hasta
// el nodo de texto de la primera/ultima linea -- getNoteLineElement(container)
// devolveria null en ese caso (NOTE_EDITOR_BODY no es el mismo objeto
// que si mismo tras la comprobacion "!== NOTE_EDITOR_BODY"). Si el
// container ya es un nodo de texto, el offset no aporta nada nuevo
// (delega en getNoteLineElement de siempre); si es un elemento, el
// offset senala un indice dentro de sus childNodes -- se resuelve el
// hijo real al que apunta ese limite (el siguiente hijo para un limite
// de inicio, el anterior para uno de fin) y se sigue desde ahi.
function resolveNoteLineAtBoundary(container, offset, isEndBoundary) {
  if (container.nodeType === Node.TEXT_NODE) return getNoteLineElement(container);
  if (container.nodeType !== Node.ELEMENT_NODE) return null;
  const idx = isEndBoundary ? Math.max(0, offset - 1) : offset;
  const child = container.childNodes[idx] || container.childNodes[container.childNodes.length - 1];
  if (!child) return null;
  if (child.nodeType === Node.ELEMENT_NODE && NOTE_LINE_TAGS.has(child.tagName)) return child;
  return getNoteLineElement(child);
}

// Lista plana, en orden de documento, de todas las "lineas" del editor
// -- para saber que lineas quedan ENTRE la de inicio y la de fin de una
// seleccion que cruza varios parrafos/items.
function collectNoteLineElements() {
  const lines = [];
  const walker = document.createTreeWalker(NOTE_EDITOR_BODY, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (el) => (NOTE_LINE_TAGS.has(el.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  let n;
  while ((n = walker.nextNode())) lines.push(n);
  return lines;
}

// La primera linea de una nota puede seguir siendo texto suelto (sin
// <div> propio) hasta que algo la envuelva -- ver el comentario de
// findFirstLineBreakIndexClient sobre esto. Si se selecciona desde ahi
// hacia la linea siguiente (caso muy comun: seleccionar toda la nota
// desde el principio), hace falta que esa primera linea tambien sea un
// elemento real para poder trocear por linea -- mueve los nodos sueltos
// del principio a un <div> nuevo. OJO: a diferencia de lo que parece a
// primera vista, un Range en curso NO sigue automaticamente a un nodo
// que se mueve cuando el CONTENEDOR del limite es justo ese nodo (aqui,
// el nodo de texto suelto) -- el limite "escapa" al padre ANTIGUO en la
// posicion donde estaba el nodo (comportamiento real de la mutacion de
// Range al eliminar, confirmado depurando el bug real que esto producia:
// la seleccion se quedaba apuntando de mas, resolviendo una linea
// equivocada). Por eso quien llama a esto SIEMPRE tiene que volver a fijar
// el rango a mano despues, con los mismos nodos de origen (que siguen
// siendo los mismos objetos, solo reparentados) -- nunca fiarse de que
// el Range ya activo se haya reajustado solo.
function ensureNoteFirstLineWrapped() {
  const first = NOTE_EDITOR_BODY.firstChild;
  if (!first || (first.nodeType === Node.ELEMENT_NODE && NOTE_LINE_TAGS.has(first.tagName))) return;
  const div = document.createElement('div');
  NOTE_EDITOR_BODY.insertBefore(div, first);
  let node = div.nextSibling;
  while (node && !(node.nodeType === Node.ELEMENT_NODE && NOTE_LINE_TAGS.has(node.tagName))) {
    const next = node.nextSibling;
    div.appendChild(node);
    node = next;
  }
}

// Quita cualquier resaltado YA EXISTENTE dentro de un contenido recien
// extraido (Range.extractContents()), antes de meterlo en el span del
// color nuevo -- sin esto, re-resaltar una seleccion que ENGLOBA por
// completo un resaltado anterior (de otro color, o del mismo tras una
// edicion) anidaria un <span data-highlight> dentro de otro en vez de
// quedar en uno solo. "Desenvuelve" cada resaltado encontrado (se queda
// con su contenido, incluido cualquier OTRO formato como negrita, solo
// se quita el resaltado en si).
function stripNoteHighlightWrappers(fragment) {
  fragment.querySelectorAll('[data-highlight]').forEach((el) => {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
}

// Inserta "node" en la posicion actual de "range" (ya colapsado, tras
// un extractContents() si venia de una seleccion) -- pero si esa
// posicion cae DENTRO de un resaltado ya existente ([data-highlight],
// caso de una seleccion que solo tocaba PARTE de un resaltado anterior,
// dejando un remanente antes/despues), en vez de anidar "node" dentro
// de ese remanente (lo que haria un range.insertNode "a pelo", ya que
// el limite cae dentro de su nodo de texto) lo saca como hermano justo
// despues, partiendo el remanente en dos mitades si hacia falta para no
// perder su contenido de "despues". Complementa a
// stripNoteHighlightWrappers (esa cubre el contenido YA EXTRAIDO, esta
// cubre el PUNTO DE INSERCION) -- entre las dos, ningun resaltado nuevo
// puede quedar anidado dentro de otro. Usado tanto por el resaltado
// "antes de escribir" (span semilla) como por wrapNoteHighlightRange.
function insertNodeOutsideNoteHighlight(range, node) {
  range.insertNode(node);
  const parent = node.parentElement;
  const enclosing = parent ? parent.closest('[data-highlight]') : null;
  if (!enclosing || !NOTE_EDITOR_BODY.contains(enclosing)) return;
  const afterFragment = document.createDocumentFragment();
  let sibling = node.nextSibling;
  while (sibling) {
    const next = sibling.nextSibling;
    afterFragment.appendChild(sibling);
    sibling = next;
  }
  enclosing.parentNode.insertBefore(node, enclosing.nextSibling);
  // Insertar justo en el limite final de un nodo de texto (caso normal
  // al escribir y cambiar de color) deja como "resto" un nodo de texto
  // VACIO (artefacto del split de Range.insertNode, no contenido real)
  // -- sin filtrarlo, se creaba un span vacio de mas por cada cambio de
  // color. Solo se reconstruye el "despues" si de verdad queda algo.
  const hasRealAfterContent = Array.from(afterFragment.childNodes).some(
    (n) => n.nodeType !== Node.TEXT_NODE || n.textContent !== ''
  );
  if (hasRealAfterContent) {
    const afterSpan = enclosing.cloneNode(false);
    afterSpan.appendChild(afterFragment);
    node.parentNode.insertBefore(afterSpan, node.nextSibling);
  }
  if (!enclosing.textContent) enclosing.remove();
}

// Un [data-highlight] sin texto dentro no se ve como "nada": el CSS de
// resaltado le da padding y border-radius, asi que se pinta como una
// cajita de color surgida de la nada -- los "resaltados fantasma" que
// reporto Koku. Salen como residuo natural de partir spans (al quitar
// el resaltado justo en un borde, o al pulsar Intro dentro de uno), asi
// que en vez de perseguir cada caso se barren SIEMPRE despues de tocar
// resaltados. El span semilla del modo pendiente se respeta a proposito
// (lleva el caracter de ancho cero, y ademas es el que esta esperando
// que se escriba dentro).
function removeEmptyNoteHighlights() {
  const sel = window.getSelection();
  const caret = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  let caretParent = null;
  let caretIndex = -1;
  NOTE_EDITOR_BODY.querySelectorAll('[data-highlight]').forEach((span) => {
    if (span === pendingNoteHighlightSpan) return;
    // El caracter de ancho cero (el que usa el modo "resaltar antes de
    // escribir") no cuenta como texto: un span que solo tenga eso, y que
    // ya no sea el pendiente, es un residuo igual que uno vacio del todo.
    if (span.textContent.replace(/​/g, '') !== '') return;
    // Si el cursor estaba justo dentro del span que se va a quitar, se
    // apunta donde vivia para devolverlo ahi despues -- si no, el
    // navegador lo manda a cualquier sitio y se pierde el punto de
    // escritura mientras se borra.
    if (caret && span.contains(caret.startContainer)) {
      caretParent = span.parentNode;
      caretIndex = Array.prototype.indexOf.call(span.parentNode.childNodes, span);
    }
    span.remove();
  });
  if (caretParent && caretIndex >= 0 && sel) {
    const restored = document.createRange();
    restored.setStart(caretParent, Math.min(caretIndex, caretParent.childNodes.length));
    restored.collapse(true);
    sel.removeAllRanges();
    sel.addRange(restored);
  }
}

// Crea el <span> con el que se envuelve un tramo. key=null significa
// "sin resaltado": un span pelado, que luego clearNoteHighlight()
// desenvuelve. Sirve para reutilizar TODO el troceo por lineas de
// wrapNoteHighlightRange() tambien al QUITAR el resaltado, en vez de
// tener dos recorridos distintos que puedan divergir.
function createNoteHighlightSpan(key) {
  const span = document.createElement('span');
  if (key) span.setAttribute('data-highlight', key);
  return span;
}

// Envuelve el contenido de "range" en uno o varios <span data-highlight>
// -- si la seleccion cae ENTERA dentro de una sola linea, un solo span
// (igual que antes de este arreglo). Si CRUZA varias lineas, un span
// por tramo (el trozo de la primera linea, cada linea intermedia
// entera, el trozo de la ultima) -- asi ningun span queda nunca a
// caballo entre bloques, que era la causa real del bug reportado
// (background/border-radius no se pintan bien con hijos de bloque
// dentro de un elemento en linea, aunque "color" si se ve por herencia
// -- de ahi que solo cambiara la letra). Devuelve el array de spans
// creados. Limitacion aceptada: una seleccion que cruce el borde de una
// celda de tabla puede volver a producir el mismo problema (las celdas
// no son "lineas" en este esquema) -- caso muy inhabitual, no cubierto.
// Si el limite de un Range cae al nivel del PADRE de la linea (indice
// entre hijos que engloba la linea entera, en vez de apuntar DENTRO de
// su contenido -- pasa con un Ctrl+A real o un selectNodeContents()
// sobre el editor cuando ese es el UNICO hijo), extractContents()
// extraeria el propio elemento de linea (<div>/<p>/etc.) entero, no
// solo su texto -- <span data-highlight> acabaria envolviendo ese
// bloque en vez de sentarse junto a su contenido (mismo problema de
// fondo que ya resolvia el troceo por linea multi-parrafo: un bloque
// dentro de un elemento en linea no pinta bien su fondo/radio, y un
// Intro posterior dentro de ese resaltado partia el bloque mal anidado
// -- el resaltado "desaparecia" visualmente, bug real reportado).
// Normaliza el limite a DENTRO de la propia linea si hace falta.
function normalizeNoteBoundaryIntoLine(container, offset, line, isEndBoundary) {
  if (container === line || container.nodeType === Node.TEXT_NODE) return { container, offset };
  return isEndBoundary
    ? { container: line, offset: line.childNodes.length }
    : { container: line, offset: 0 };
}

function wrapNoteHighlightRange(range, key) {
  const startLine = resolveNoteLineAtBoundary(range.startContainer, range.startOffset, false);
  const endLine = resolveNoteLineAtBoundary(range.endContainer, range.endOffset, true);

  if (!startLine || !endLine || startLine === endLine) {
    let innerRange = range;
    if (startLine) {
      const normStart = normalizeNoteBoundaryIntoLine(range.startContainer, range.startOffset, startLine, false);
      const normEnd = normalizeNoteBoundaryIntoLine(range.endContainer, range.endOffset, startLine, true);
      innerRange = document.createRange();
      innerRange.setStart(normStart.container, normStart.offset);
      innerRange.setEnd(normEnd.container, normEnd.offset);
    }
    const span = createNoteHighlightSpan(key);
    const fragment = innerRange.extractContents();
    stripNoteHighlightWrappers(fragment);
    span.appendChild(fragment);
    insertNodeOutsideNoteHighlight(innerRange, span);
    return [span];
  }

  const allLines = collectNoteLineElements();
  const startIdx = allLines.indexOf(startLine);
  const endIdx = allLines.indexOf(endLine);
  const spans = [];

  // Mismo caso que la rama de una sola linea de arriba (Ctrl+A real
  // sobre una nota de 2+ parrafos da limites a nivel del PADRE, no
  // dentro del contenido de la primera/ultima linea) -- sin normalizar
  // aqui tambien, extractContents() podia extraer el <div> de la
  // primera o ultima linea ENTERO en vez de solo su texto, con el mismo
  // bug real de fondo (resaltado que "desaparece" con un Intro
  // posterior dentro de el).
  const normStart = normalizeNoteBoundaryIntoLine(range.startContainer, range.startOffset, startLine, false);
  const startRange = document.createRange();
  startRange.setStart(normStart.container, normStart.offset);
  startRange.setEndAfter(startLine.lastChild || startLine);
  const startSpan = createNoteHighlightSpan(key);
  const startFragment = startRange.extractContents();
  stripNoteHighlightWrappers(startFragment);
  startSpan.appendChild(startFragment);
  insertNodeOutsideNoteHighlight(startRange, startSpan);
  spans.push(startSpan);

  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = allLines[i];
    const lineRange = document.createRange();
    lineRange.selectNodeContents(line);
    const span = createNoteHighlightSpan(key);
    const lineFragment = lineRange.extractContents();
    stripNoteHighlightWrappers(lineFragment);
    span.appendChild(lineFragment);
    insertNodeOutsideNoteHighlight(lineRange, span);
    spans.push(span);
  }

  const normEnd = normalizeNoteBoundaryIntoLine(range.endContainer, range.endOffset, endLine, true);
  const endRange = document.createRange();
  endRange.setStartBefore(endLine.firstChild || endLine);
  endRange.setEnd(normEnd.container, normEnd.offset);
  const endSpan = createNoteHighlightSpan(key);
  const endFragment = endRange.extractContents();
  stripNoteHighlightWrappers(endFragment);
  endSpan.appendChild(endFragment);
  insertNodeOutsideNoteHighlight(endRange, endSpan);
  spans.push(endSpan);

  return spans;
}

// Resaltar "antes de escribir" (como negrita/cursiva): el resaltado NO
// pasa por execCommand (a proposito, ver arriba), asi que "seguir
// escribiendo con este color" hay que construirlo a mano -- tecnica
// estandar de "span semilla" con un caracter de ancho cero: se inserta
// el span ya con data-highlight y un unico caracter invisible dentro, y
// se deja el cursor justo despues de ese caracter -- lo que se escriba
// a partir de ahi cae dentro del mismo nodo de texto (mismo padre, el
// span), igual que hace el navegador de forma nativa con <b> al activar
// negrita sin seleccion.
let pendingNoteHighlightKey = null;
let pendingNoteHighlightSpan = null;

function cancelPendingNoteHighlight() {
  // Si nunca se llego a escribir nada real (el span solo tiene el
  // caracter semilla), se quita del todo -- no dejar un span vacio.
  if (pendingNoteHighlightSpan && pendingNoteHighlightSpan.textContent === '​') {
    pendingNoteHighlightSpan.remove();
  }
  pendingNoteHighlightKey = null;
  pendingNoteHighlightSpan = null;
}

function beginPendingNoteHighlight(key) {
  // Clicar el MISMO color que ya esta pendiente lo cancela (toggle).
  if (pendingNoteHighlightKey === key) {
    cancelPendingNoteHighlight();
    refreshNoteEditorState();
    return;
  }
  cancelPendingNoteHighlight(); // si habia OTRO color pendiente sin usar, se descarta
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.setAttribute('data-highlight', key);
  span.appendChild(document.createTextNode('​'));
  // Nunca anidado dentro de un resaltado en curso -- si el cursor esta
  // ya dentro de un [data-highlight] (de otro color, o del mismo texto
  // ya escrito con un resaltado pendiente anterior), un
  // range.insertNode "a pelo" meteria el span nuevo COMO HIJO de ese
  // resaltado (el limite cae dentro de su nodo de texto), produciendo
  // resaltados anidados uno dentro de otro cada vez que se cambia de
  // color sin dejar de escribir -- justo el bug real reportado.
  insertNodeOutsideNoteHighlight(range, span);
  const newRange = document.createRange();
  newRange.setStart(span.firstChild, 1);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  pendingNoteHighlightKey = key;
  pendingNoteHighlightSpan = span;
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// Refleja el estado de "resaltado pendiente" (punto anterior) en el
// boton, y lo cancela solo si el cursor se ha ido de dentro del span
// semilla -- llamada desde refreshNoteEditorState, que ya se dispara en
// cada keyup/mouseup/focus del editor y tras cada accion de formato.
function refreshPendingNoteHighlightState() {
  if (pendingNoteHighlightSpan) {
    const sel = window.getSelection();
    const inside = sel && sel.rangeCount > 0 && pendingNoteHighlightSpan.contains(sel.getRangeAt(0).startContainer);
    if (!inside) cancelPendingNoteHighlight();
  }
  document.getElementById('note-highlight-btn').classList.toggle('is-active', !!pendingNoteHighlightKey);
}

function applyNoteHighlight(key) {
  restoreNoteEditorSelection();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  // Sin seleccion real: activa el modo "resaltar lo que se escriba a
  // partir de ahora", igual que negrita/cursiva sin seleccionar nada.
  if (sel.isCollapsed) {
    beginPendingNoteHighlight(key);
    return;
  }
  // Capturar el limite ANTES de envolver la primera linea suelta -- ver
  // el comentario de ensureNoteFirstLineWrapped() sobre por que no basta
  // con fiarse de que el Range ya activo en la seleccion se reajuste
  // solo (no lo hace cuando el contenedor del limite es justo el nodo
  // que se mueve). Los nodos en si son los mismos objetos aunque se
  // reparenten, asi que reconstruir el rango a mano con ellos despues
  // de envolver es siempre valido.
  const liveRange = sel.getRangeAt(0);
  const startContainer = liveRange.startContainer;
  const startOffset = liveRange.startOffset;
  const endContainer = liveRange.endContainer;
  const endOffset = liveRange.endOffset;
  ensureNoteFirstLineWrapped();
  const range = document.createRange();
  range.setStart(startContainer, startOffset);
  range.setEnd(endContainer, endOffset);
  const spans = wrapNoteHighlightRange(range, key);
  sel.removeAllRanges();
  if (spans.length) {
    const newRange = document.createRange();
    newRange.setStartBefore(spans[0]);
    newRange.setEndAfter(spans[spans.length - 1]);
    sel.addRange(newRange);
  }
  removeEmptyNoteHighlights();
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// "Ninguno" con el cursor SIN seleccion, dentro de un resaltado ya
// escrito: parte el span justo en el cursor -- lo de ANTES se queda
// resaltado (Koku solo quiere apagarlo "a partir de aqui", quitarlo
// entero tambien borraba lo ya escrito con el color puesto, que no es
// lo que pedia), lo de DESPUES sale fuera del span como texto plano
// (sin resaltar, sin necesitar ningun wrapper nuevo). Mismo espiritu
// que beginPendingNoteHighlight, pero al reves: alli se activa el
// resaltado "de aqui en adelante", aqui se desactiva "de aqui en
// adelante". Si el span solo tiene el caracter semilla (nunca se llego
// a escribir nada real), se sigue quitando entero como hasta ahora --
// no hay "antes" que conservar.
function clearNoteHighlight() {
  restoreNoteEditorSelection();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  if (sel.isCollapsed) {
    const liveRange = sel.getRangeAt(0);
    const boundaryContainer = liveRange.startContainer;
    const boundaryOffset = liveRange.startOffset;
    let el = boundaryContainer.nodeType === Node.TEXT_NODE ? boundaryContainer.parentElement : boundaryContainer;
    const span = el && NOTE_EDITOR_BODY.contains(el) ? el.closest('[data-highlight]') : null;
    if (span) {
      if (span.textContent === '​') {
        span.remove();
      } else {
        const splitRange = document.createRange();
        splitRange.setStart(boundaryContainer, boundaryOffset);
        splitRange.setEnd(span, span.childNodes.length);
        const afterFragment = splitRange.extractContents();
        // Caracter de ancho cero delante del texto sin resaltar, con el
        // cursor colocado JUSTO DESPUES de el (mismo truco que ya usa
        // beginPendingNoteHighlight, pero para "apagar" en vez de
        // "encender"). Hace falta de verdad: poner el cursor con
        // Range.setStart directamente al principio del texto plano de
        // despues (offset 0 de un nodo de texto real, sin ningun
        // caracter de por medio) sigue sin bastar -- confirmado con
        // Playwright que Chrome, al escribir justo ahi, seguia metiendo
        // el texto nuevo DENTRO del span vecino (herencia de estilo del
        // propio motor, "afinidad" del cursor con el elemento anterior,
        // no depende de que el Range apunte bien). Con un caracter YA
        // plano justo antes del cursor, esa ambiguedad desaparece.
        const buffer = document.createTextNode('​');
        afterFragment.insertBefore(buffer, afterFragment.firstChild);
        span.parentNode.insertBefore(afterFragment, span.nextSibling);
        if (!span.textContent) span.remove();
        const newRange = document.createRange();
        newRange.setStart(buffer, 1);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
    }
    pendingNoteHighlightKey = null;
    pendingNoteHighlightSpan = null;
    NOTE_EDITOR_BODY.focus();
    refreshNoteEditorState();
    return;
  }
  // Antes esto quitaba el atributo del span ENTERO en cuanto la
  // seleccion lo tocaba (range.intersectsNode). Bug real reportado por
  // Koku: resaltar varias lineas y quitar el resaltado de UNA se lo
  // quitaba a todas -- pasa siempre que un mismo span cubre mas de lo
  // seleccionado (varias lineas separadas por <br>, o simplemente una
  // frase de la que solo se selecciona una palabra). Ahora se reutiliza
  // el mismo troceo que al PONER el resaltado, con key=null: se extrae
  // exactamente el tramo seleccionado, se le quitan los resaltados que
  // llevara dentro, y se reinserta FUERA del span original -- que asi
  // queda partido en las mitades de antes y despues, cada una con su
  // color intacto.
  ensureNoteFirstLineWrapped();
  const range = sel.getRangeAt(0);
  const spans = wrapNoteHighlightRange(range, null);
  // Los spans pelados que deja el troceo no aportan nada (el texto ya
  // no lleva resaltado): se desenvuelven y se unen los nodos de texto
  // sueltos, para no ir dejando capas vacias en el HTML de la nota cada
  // vez que se quita un resaltado.
  spans.forEach((span) => {
    if (span.parentNode) span.replaceWith(...span.childNodes);
  });
  removeEmptyNoteHighlights();
  NOTE_EDITOR_BODY.normalize();
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// Que color de resaltado esta "en uso" ahora mismo, para marcarlo en el
// popover con el aro de acento -- null significa "Ninguno" (sin
// resaltar), undefined significa "no marcar nada" (seleccion mixta,
// igual que hace document.queryCommandState('bold') con una seleccion
// que mezcla negrita y no-negrita).
function getActiveNoteHighlightKey() {
  if (pendingNoteHighlightKey) return pendingNoteHighlightKey;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !NOTE_EDITOR_BODY.contains(sel.anchorNode)) return undefined;
  const range = sel.getRangeAt(0);

  function highlightKeyAt(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const span = el && NOTE_EDITOR_BODY.contains(el) ? el.closest('[data-highlight]') : null;
    return span ? span.getAttribute('data-highlight') : null;
  }

  if (sel.isCollapsed) return highlightKeyAt(range.startContainer);

  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  let commonKey;
  let found = false;
  let node;
  while ((node = walker.nextNode())) {
    if (!range.intersectsNode(node) || !node.textContent) continue;
    const key = highlightKeyAt(node);
    if (!found) {
      commonKey = key;
      found = true;
    } else if (commonKey !== key) {
      return undefined;
    }
  }
  return found ? commonKey : undefined;
}

// Enciende el aro de acento (.is-active) sobre el swatch que corresponda
// -- llamada desde refreshNoteEditorState, que ya se dispara en cada
// cambio de seleccion dentro del editor.
function refreshNoteHighlightSwatchActiveState() {
  const activeKey = getActiveNoteHighlightKey();
  highlightColorPopover.querySelectorAll('.highlight-swatch:not(.highlight-swatch-clear)').forEach((btn) => {
    btn.classList.toggle('is-active', activeKey !== undefined && btn.dataset.highlight === activeKey);
  });
  highlightColorPopover.querySelector('.highlight-swatch-clear').classList.toggle('is-active', activeKey === null);
}

const paragraphStylePopover = document.createElement('div');
paragraphStylePopover.className = 'paragraph-style-popover hidden';
paragraphStylePopover.innerHTML = `
  <button type="button" class="paragraph-style-option" data-style="title">Título</button>
  <button type="button" class="paragraph-style-option" data-style="heading">Encabezado</button>
  <button type="button" class="paragraph-style-option" data-style="subheading">Subencabezado</button>
  <button type="button" class="paragraph-style-option" data-style="body">Cuerpo</button>
  <button type="button" class="paragraph-style-option" data-style="mono">Monoespaciado</button>
`;
document.body.appendChild(paragraphStylePopover);

const paragraphStyleBtn = document.getElementById('note-paragraph-style-btn');
paragraphStyleBtn.addEventListener('mousedown', (e) => e.preventDefault());
paragraphStyleBtn.addEventListener('click', () => {
  if (paragraphStyleBtn.disabled) return;
  const willOpen = paragraphStylePopover.classList.contains('hidden');
  if (willOpen) saveNoteEditorSelection();
  closeAllPopovers(paragraphStylePopover);
  paragraphStylePopover.classList.toggle('hidden');
  if (willOpen) positionFixedPopover(paragraphStyleBtn, paragraphStylePopover, { width: 200 });
});
paragraphStylePopover.querySelectorAll('.paragraph-style-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    paragraphStylePopover.classList.add('hidden');
    applyNoteParagraphStyle(btn.dataset.style);
  });
});

const NOTE_HIGHLIGHT_SWATCHES = [
  { key: 'yellow', label: 'Amarillo' },
  { key: 'green', label: 'Verde' },
  { key: 'blue', label: 'Azul' },
  { key: 'pink', label: 'Rosa' },
  { key: 'orange', label: 'Naranja' },
];
const highlightColorPopover = document.createElement('div');
highlightColorPopover.className = 'highlight-color-popover hidden';
highlightColorPopover.innerHTML = `
  ${NOTE_HIGHLIGHT_SWATCHES.map((s) => `<button type="button" class="highlight-swatch" data-highlight="${s.key}" aria-label="${s.label}" title="${s.label}"></button>`).join('')}
  <button type="button" class="highlight-swatch highlight-swatch-clear" aria-label="Ninguno" title="Ninguno"></button>
`;
document.body.appendChild(highlightColorPopover);

const highlightBtn = document.getElementById('note-highlight-btn');
highlightBtn.addEventListener('mousedown', (e) => e.preventDefault());
highlightBtn.addEventListener('click', () => {
  if (highlightBtn.disabled) return;
  const willOpen = highlightColorPopover.classList.contains('hidden');
  if (willOpen) saveNoteEditorSelection();
  closeAllPopovers(highlightColorPopover);
  highlightColorPopover.classList.toggle('hidden');
  if (willOpen) positionFixedPopover(highlightBtn, highlightColorPopover, { width: 232 });
});
highlightColorPopover.querySelectorAll('.highlight-swatch:not(.highlight-swatch-clear)').forEach((btn) => {
  btn.addEventListener('click', () => {
    highlightColorPopover.classList.add('hidden');
    applyNoteHighlight(btn.dataset.highlight);
  });
});
highlightColorPopover.querySelector('.highlight-swatch-clear').addEventListener('click', () => {
  highlightColorPopover.classList.add('hidden');
  clearNoteHighlight();
});

const quoteToggleBtn = document.getElementById('note-quote-toggle-btn');
quoteToggleBtn.addEventListener('mousedown', (e) => e.preventDefault());
quoteToggleBtn.addEventListener('click', toggleNoteQuoteBlock);

document.getElementById('note-indent-btn').addEventListener('mousedown', (e) => e.preventDefault());
document.getElementById('note-indent-btn').addEventListener('click', () => applyNoteIndentDelta(1));
document.getElementById('note-outdent-btn').addEventListener('mousedown', (e) => e.preventDefault());
document.getElementById('note-outdent-btn').addEventListener('click', () => applyNoteIndentDelta(-1));

// Deshacer/rehacer del TEXTO. Es el deshacer propio del navegador sobre
// el editor (lo mismo que Ctrl+Z), asi que cubre lo que se escribe y los
// formatos que pasan por execCommand (negrita, cursiva, listas...). Los
// cambios que la app hace a mano sobre el HTML -- resaltado, cita,
// sangria y la estructura de una tabla -- no entran ahi: la estructura de
// tabla tiene su propio par de botones en la barra de tabla.
[['note-text-undo-btn', 'undo'], ['note-text-redo-btn', 'redo']].forEach(([id, cmd]) => {
  const btn = document.getElementById(id);
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    NOTE_EDITOR_BODY.focus();
    document.execCommand(cmd);
    refreshNoteEditorState();
  });
});

function clampTableSize(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.min(10, Math.max(1, n));
}

// La tabla NO lleva anchos ni altos fijos: se ajusta sola al texto que
// tenga dentro (table-layout:auto en styles.css). Antes se insertaba con
// un <colgroup> de anchos en px y un alto por fila, y habia un menu
// "Tamaño" para tocarlos -- Koku lo quito a proposito ("que siempre se
// ajuste al texto de dentro y ya está").
function buildTableHtml(rows, cols) {
  let rowsHtml = '';
  for (let r = 0; r < rows; r++) {
    rowsHtml += `<tr>${'<td><br></td>'.repeat(cols)}</tr>`;
  }
  // El <div><br></div> de despues da un sitio donde dejar el cursor tras
  // insertar la tabla -- sin el, si la tabla queda como ultimo elemento
  // del editor no habria forma de escribir nada debajo de ella.
  // data-just-inserted: marca temporal para poder localizar ESTA tabla
  // justo despues de insertarla y meter el cursor dentro. Se quita en el
  // acto, asi que nunca llega a guardarse en la nota (el saneador
  // tampoco lo dejaria pasar).
  return `<table data-just-inserted="1"><tbody>${rowsHtml}</tbody></table><div><br></div>`;
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
  if (willOpen) positionFixedPopover(tableInsertBtn, tableInsertPopover, { width: 220 });
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
  // El cursor se queda donde estaba antes de insertar, asi que la vista
  // "se movia" a otro sitio en vez de llevarte a la tabla recien puesta
  // (lo que reporto Koku). Se marca la tabla al construirla para poder
  // encontrarla justo despues y dejar el cursor dentro de su primera
  // celda -- se puede empezar a escribir en ella directamente.
  const nueva = NOTE_EDITOR_BODY.querySelector('table[data-just-inserted]');
  if (nueva) {
    nueva.removeAttribute('data-just-inserted');
    const primera = nueva.querySelector('td, th');
    if (primera) {
      const range = document.createRange();
      range.setStart(primera, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      NOTE_EDITOR_BODY.focus();
      primera.scrollIntoView({ block: 'nearest' });
    }
  }
  refreshNoteEditorState();
});

function addTableRow() {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const row = cell.parentElement;
  const newRow = document.createElement('tr');
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
  }
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// Grosor de borde fino/grueso, por tabla -- atributo data-border="thick"
// en el <table> (ausente = fino, el de siempre). El saneado del servidor
// (sanitizeNoteBody en routes/notes.js) solo deja pasar ese atributo con
// el valor EXACTO "thick", cualquier otra cosa se descarta.
// Nivel de grosor del borde, por tabla (1 fino ... 4 muy grueso). Antes
// era un simple "fino o grueso"; Koku lo queria estilo Excel, subiendo y
// bajando de nivel.
const TABLE_BORDER_LEVELS = ['1', '2', '3', '4'];

// 4 grosores fijos, elegibles directamente (el 1 es el fino de siempre,
// y es el que traen las tablas nuevas). Antes habia que ir dando a
// "mas grueso"/"mas fino" hasta dar con el que se buscaba.
//
// Alcance: si hay celdas marcadas (modo "Marcar"), solo cambian ESAS; si
// no hay ninguna, cambia la tabla entera. Las celdas guardan su propio
// data-border, que manda sobre el de la tabla.
function setTableBorder(nivel) {
  const marcadas = getMarkedTableCells();
  if (marcadas.length) {
    // El nivel 1 se pone SIEMPRE de forma explicita, tambien en la
    // celda: quitarle el atributo la dejaba heredando el grosor de la
    // tabla, asi que sobre una tabla ya gruesa elegir "Fino" no hacia
    // nada ("el borde fino no quiere ponerlo"). El saneado ya acepta
    // data-border="1" en td/th igual que el resto de niveles.
    marcadas.forEach((celda) => celda.setAttribute('data-border', nivel));
    refreshNoteEditorState();
    return;
  }
  const cell = getCurrentTableCell();
  if (!cell) return;
  const table = cell.closest('table');
  // Al cambiar el grosor de la tabla entera se limpian los de cada celda:
  // si no, las que se hubieran tocado antes se quedarian con el suyo y
  // pareceria que el cambio "no ha hecho nada" en esa parte.
  table.querySelectorAll('td[data-border], th[data-border]').forEach((c) => c.removeAttribute('data-border'));
  if (nivel === TABLE_BORDER_LEVELS[0]) table.removeAttribute('data-border');
  else table.setAttribute('data-border', nivel);
  refreshNoteEditorState();
}

// ---------------------------------------------------------------------
// Modo "Marcar": en vez de pelearse con la seleccion de texto de iOS
// para elegir celdas, se toca cada casilla y se marca/desmarca. Lo usan
// Agrupar, el grosor de borde y "Mover > Bloque".
//
// Mientras esta activo el editor queda en solo lectura: si no, cada
// toque colocaria el cursor dentro de la celda en vez de marcarla.
// ---------------------------------------------------------------------
let tableMarkMode = null; // { table }

function getMarkedTableCells() {
  if (!tableMarkMode) return [];
  return Array.from(tableMarkMode.table.querySelectorAll('td.is-marked, th.is-marked'));
}

function refreshTableMarkButton() {
  const btn = document.getElementById('btn-note-table-mark');
  if (!btn) return;
  const n = getMarkedTableCells().length;
  btn.textContent = tableMarkMode ? (n ? `Marcar (${n})` : 'Marcar…') : 'Marcar';
  btn.classList.toggle('is-active', !!tableMarkMode);
}

function startTableMarkMode() {
  const cell = getCurrentTableCell();
  const table = cell ? cell.closest('table') : null;
  if (!table) return;
  stopTableManualMove();
  tableMarkMode = { table };
  table.classList.add('is-marking');
  NOTE_EDITOR_BODY.setAttribute('contenteditable', 'false');
  table.addEventListener('click', onTableMarkClick);
  refreshTableMarkButton();
}

function stopTableMarkMode({ conservarMarcas = false } = {}) {
  if (!tableMarkMode) return;
  const { table } = tableMarkMode;
  if (!conservarMarcas) table.querySelectorAll('.is-marked').forEach((c) => c.classList.remove('is-marked'));
  table.classList.remove('is-marking');
  table.removeEventListener('click', onTableMarkClick);
  tableMarkMode = null;
  if (!tableManualMove) NOTE_EDITOR_BODY.setAttribute('contenteditable', 'true');
  refreshTableMarkButton();
}

function onTableMarkClick(e) {
  const celda = e.target.closest && e.target.closest('td, th');
  if (!celda || !tableMarkMode || !tableMarkMode.table.contains(celda)) return;
  e.preventDefault();
  e.stopPropagation();
  celda.classList.toggle('is-marked');
  refreshTableMarkButton();
}

// ---------------------------------------------------------------------
// Deshacer/rehacer de la ESTRUCTURA de la tabla (no del texto: eso lo
// sigue llevando el propio sistema). Antes de cada accion se guarda una
// foto de la tabla; si la accion la borra entera (quitar la ultima fila),
// se guarda tambien una del contenido completo para poder recuperarla.
// ---------------------------------------------------------------------
const TABLE_HISTORY_MAX = 30;
const tableHistory = { atras: [], adelante: [] };

function captureTableState() {
  const cell = getCurrentTableCell() || (tableMarkMode && tableMarkMode.table.querySelector('td, th'));
  const table = (tableManualMove && tableManualMove.table)
    || (tableMarkMode && tableMarkMode.table)
    || (cell && cell.closest('table'));
  if (!table) return null;
  const tablas = Array.from(NOTE_EDITOR_BODY.querySelectorAll('table'));
  return { indice: tablas.indexOf(table), tabla: table.outerHTML, cuerpo: NOTE_EDITOR_BODY.innerHTML };
}

function restoreTableState(estado) {
  if (!estado) return;
  const tablas = Array.from(NOTE_EDITOR_BODY.querySelectorAll('table'));
  const table = tablas[estado.indice];
  // Si la tabla ya no existe (la accion la borro entera) se recupera el
  // contenido completo; si existe, solo se repone ella para no pisar el
  // texto que se haya escrito despues en el resto de la nota.
  if (table) table.outerHTML = estado.tabla;
  else NOTE_EDITOR_BODY.innerHTML = estado.cuerpo;
  const nueva = NOTE_EDITOR_BODY.querySelectorAll('table')[estado.indice];
  if (nueva) {
    const primera = nueva.querySelector('td, th');
    if (primera) putCaretInCell(primera);
  }
  refreshNoteEditorState();
  refreshTableHistoryButtons();
}

function refreshTableHistoryButtons() {
  const undo = document.getElementById('btn-note-table-undo');
  const redo = document.getElementById('btn-note-table-redo');
  if (undo) undo.disabled = tableHistory.atras.length === 0;
  if (redo) redo.disabled = tableHistory.adelante.length === 0;
}

function undoTableChange() {
  if (!tableHistory.atras.length) return;
  stopTableMarkMode();
  stopTableManualMove();
  const actual = captureTableState();
  const estado = tableHistory.atras.pop();
  if (actual) tableHistory.adelante.push(actual);
  restoreTableState(estado);
}

function redoTableChange() {
  if (!tableHistory.adelante.length) return;
  stopTableMarkMode();
  stopTableManualMove();
  const actual = captureTableState();
  const estado = tableHistory.adelante.pop();
  if (actual) tableHistory.atras.push(actual);
  restoreTableState(estado);
}

// Sube o baja la fila del cursor intercambiandola con su vecina.
// `celdaDada` la usa el modo "mover a mano" (ver mas abajo): ahi el
// editor esta bloqueado a proposito, asi que no hay cursor del que sacar
// la celda ni tiene sentido devolverselo al terminar.
function moveTableRow(delta, celdaDada) {
  const cell = celdaDada || getCurrentTableCell();
  if (!cell) return false;
  const row = cell.parentElement;
  const vecina = delta < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!vecina) return false;
  if (delta < 0) vecina.before(row);
  else vecina.after(row);
  if (!celdaDada) putCaretInCell(cell);
  refreshNoteEditorState();
  return true;
}

// Mueve la columna del cursor a izquierda o derecha: intercambia esa
// celda con su vecina EN CADA FILA.
function moveTableColumn(delta, celdaDada) {
  const cell = celdaDada || getCurrentTableCell();
  if (!cell) return false;
  const row = cell.parentElement;
  const colIndex = Array.from(row.children).indexOf(cell);
  const destino = colIndex + delta;
  const table = row.closest('table');
  if (destino < 0 || destino >= row.children.length) return false;
  table.querySelectorAll('tr').forEach((tr) => {
    const a = tr.children[colIndex];
    const b = tr.children[destino];
    if (!a || !b) return;
    if (delta < 0) b.before(a);
    else b.after(a);
  });
  if (!celdaDada) putCaretInCell(cell);
  refreshNoteEditorState();
  return true;
}

// ---------------------------------------------------------------------
// "Mover a mano": sustituye a los 4 botones de direccion que habia antes
// (fila arriba/abajo, columna izquierda/derecha). Se activa desde el
// menu Mover, y a partir de ahi ARRASTRAS con el dedo sobre la tabla:
// arrastrar en vertical mueve la FILA que has cogido, en horizontal
// mueve la COLUMNA. Se sale tocando fuera de la tabla.
//
// Mientras dura, el editor se pone en solo lectura: si no, el navegador
// intenta seleccionar texto con el mismo arrastre y pelea con el gesto.
// ---------------------------------------------------------------------
let tableManualMove = null;

// Aviso la primera vez: "mover a mano" no se adivina solo (Koku).
const TABLE_MOVE_HINTS = {
  line: 'Arrastra una casilla: hacia arriba o abajo mueve su FILA, hacia los lados mueve su COLUMNA. Se sale tocando fuera de la tabla.',
  cell: 'Arrastra una casilla hacia la de al lado y las dos intercambian su contenido. Se sale tocando fuera de la tabla.',
  block: 'Arrastra cualquiera de las casillas marcadas y el bloque entero se cambia por las de al lado. Se sale tocando fuera de la tabla.',
};

async function startTableManualMove(alcance = 'line') {
  const cell = getCurrentTableCell() || (tableMarkMode && getMarkedTableCells()[0]);
  if (!cell) return;
  const table = cell.closest('table');
  if (!table) return;
  const marcadas = getMarkedTableCells();
  if (alcance === 'block' && marcadas.length === 0) {
    await showAppAlert('Marca antes las casillas que quieres mover (botón "Marcar" de la barra).');
    return;
  }
  const clave = `tableMoveHintSeen_${alcance}`;
  if (localStorage.getItem(clave) !== '1') {
    await showAppAlert(TABLE_MOVE_HINTS[alcance], {
      checkbox: { label: 'No volver a mostrar este aviso', storageKey: clave },
    });
  }
  if (tableManualMove) stopTableManualMove();
  // El bloque se mueve con las marcas puestas: hay que conservarlas.
  if (alcance === 'block') stopTableMarkMode({ conservarMarcas: true });
  else stopTableMarkMode();
  tableManualMove = { table, arrastre: null, alcance, bloque: alcance === 'block' ? marcadas : [] };
  table.classList.add('is-manual-move');
  NOTE_EDITOR_BODY.setAttribute('contenteditable', 'false');
  table.addEventListener('pointerdown', onTableManualMoveDown);
  table.addEventListener('pointermove', onTableManualMoveMove);
  table.addEventListener('pointerup', onTableManualMoveUp);
  table.addEventListener('pointercancel', onTableManualMoveUp);
}

function stopTableManualMove() {
  if (!tableManualMove) return;
  const { table } = tableManualMove;
  table.querySelectorAll('.is-marked').forEach((c) => c.classList.remove('is-marked'));
  table.classList.remove('is-manual-move');
  table.removeEventListener('pointerdown', onTableManualMoveDown);
  table.removeEventListener('pointermove', onTableManualMoveMove);
  table.removeEventListener('pointerup', onTableManualMoveUp);
  table.removeEventListener('pointercancel', onTableManualMoveUp);
  NOTE_EDITOR_BODY.setAttribute('contenteditable', 'true');
  tableManualMove = null;
}

function onTableManualMoveDown(e) {
  if (!tableManualMove) return;
  const cell = e.target.closest && e.target.closest('td, th');
  if (!cell) return;
  e.preventDefault();
  tableManualMove.arrastre = { cell, x: e.clientX, y: e.clientY };
  // Sin capturar el puntero, sacar el dedo de la tabla a mitad de
  // arrastre corta el gesto (mismo motivo que en attachSwipe).
  if (e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId);
}

function onTableManualMoveMove(e) {
  if (!tableManualMove || !tableManualMove.arrastre) return;
  const arrastre = tableManualMove.arrastre;
  const dx = e.clientX - arrastre.x;
  const dy = e.clientY - arrastre.y;
  const caja = arrastre.cell.getBoundingClientRect();
  // Se mueve de una en una: cada vez que el dedo recorre una celda
  // entera, se da un paso y se vuelve a tomar la referencia desde ahi.
  const horizontal = Math.abs(dx) > Math.abs(dy);
  if (horizontal ? Math.abs(dx) < caja.width : Math.abs(dy) < caja.height) return;
  const paso = horizontal ? (dx > 0 ? 1 : -1) : (dy > 0 ? 1 : -1);
  const dc = horizontal ? paso : 0;
  const dr = horizontal ? 0 : paso;

  let movido = false;
  if (tableManualMove.alcance === 'cell') movido = swapTableCellWithNeighbour(arrastre.cell, dr, dc);
  else if (tableManualMove.alcance === 'block') movido = moveTableBlock(tableManualMove.bloque, dr, dc);
  else movido = horizontal ? moveTableColumn(paso, arrastre.cell) : moveTableRow(paso, arrastre.cell);

  if (movido) { arrastre.x = e.clientX; arrastre.y = e.clientY; }
}

// Mover UNA casilla = intercambiar su contenido con el de la de al lado
// (decision de Koku): sacarla de la fila y meterla en otro sitio dejaria
// la tabla descuadrada, con una fila mas corta que las demas.
function swapTableCellWithNeighbour(cell, dr, dc) {
  const table = cell.closest('table');
  const rejilla = buildTableGrid(table);
  let r0 = -1; let c0 = -1;
  rejilla.forEach((fila, r) => fila.forEach((celda, c) => {
    if (celda === cell && r0 < 0) { r0 = r; c0 = c; }
  }));
  if (r0 < 0) return false;
  const destino = rejilla[r0 + dr] && rejilla[r0 + dr][c0 + dc];
  if (!destino || destino === cell) return false;
  const suyo = destino.innerHTML;
  destino.innerHTML = cell.innerHTML;
  cell.innerHTML = suyo;
  refreshNoteEditorState();
  return true;
}

// Mover un BLOQUE de casillas marcadas: el bloque se intercambia con la
// franja de casillas sobre la que pasa. Solo se mueve el CONTENIDO -- la
// rejilla de la tabla se queda como esta, igual que al mover una casilla.
function moveTableBlock(bloque, dr, dc) {
  if (!bloque || bloque.length === 0) return false;
  const table = bloque[0].closest('table');
  const rejilla = buildTableGrid(table);
  const pos = new Map();
  rejilla.forEach((fila, r) => fila.forEach((celda, c) => {
    if (!pos.has(celda)) pos.set(celda, { r, c });
  }));

  const seleccion = new Set(bloque);
  const destinos = [];
  for (const celda of bloque) {
    const p = pos.get(celda);
    if (!p) return false;
    const destino = rejilla[p.r + dr] && rejilla[p.r + dr][p.c + dc];
    if (!destino) return false; // el bloque se saldria de la tabla
    destinos.push([celda, destino]);
  }
  // Alto/ancho del bloque en la direccion del movimiento, para saber a
  // que casilla vuelve el contenido de las que se quedan por el camino.
  const filas = new Set(bloque.map((c) => pos.get(c).r));
  const cols = new Set(bloque.map((c) => pos.get(c).c));
  const salto = dr !== 0 ? filas.size : cols.size;

  const original = new Map();
  table.querySelectorAll('td, th').forEach((c) => original.set(c, c.innerHTML));

  destinos.forEach(([celda, destino]) => { destino.innerHTML = original.get(celda); });
  // Las que el bloque ha pisado (y no estaban marcadas) pasan al hueco
  // que deja el bloque por el otro lado.
  destinos.forEach(([, destino]) => {
    if (seleccion.has(destino)) return;
    const p = pos.get(destino);
    const vuelta = rejilla[p.r - dr * salto] && rejilla[p.r - dr * salto][p.c - dc * salto];
    if (vuelta) vuelta.innerHTML = original.get(destino);
  });
  // La marca viaja con el bloque para poder seguir moviendolo.
  bloque.forEach((c) => c.classList.remove('is-marked'));
  const nuevos = destinos.map(([, destino]) => destino);
  nuevos.forEach((c) => c.classList.add('is-marked'));
  tableManualMove.bloque = nuevos;
  refreshNoteEditorState();
  return true;
}

function onTableManualMoveUp() {
  if (tableManualMove) tableManualMove.arrastre = null;
}

// ---------------------------------------------------------------------
// Combinar celdas (agrupar) -- ahora a partir de la SELECCION de verdad:
// arrastras por encima de varias celdas como si seleccionaras texto y le
// das a "Agrupar". Antes solo sabia juntar la celda del cursor con la de
// su derecha, que es lo que Koku vio como "no funciona".
//
// Para saber que celda ocupa cada hueco hace falta una rejilla: con
// colspan/rowspan de por medio, la posicion de una celda dentro de su
// <tr> ya no coincide con su columna real.
// ---------------------------------------------------------------------
function buildTableGrid(table) {
  const filas = Array.from(table.rows);
  const rejilla = filas.map(() => []);
  filas.forEach((fila, r) => {
    let c = 0;
    Array.from(fila.cells).forEach((celda) => {
      while (rejilla[r][c]) c += 1;
      const cs = parseInt(celda.getAttribute('colspan'), 10) || 1;
      const rs = parseInt(celda.getAttribute('rowspan'), 10) || 1;
      for (let i = 0; i < rs; i += 1) {
        for (let j = 0; j < cs; j += 1) {
          if (rejilla[r + i]) rejilla[r + i][c + j] = celda;
        }
      }
      c += cs;
    });
  });
  return rejilla;
}

// Las dos ESQUINAS de la seleccion: donde empieza y donde acaba. A
// proposito no se cogen "todas las celdas que toca el rango": una
// seleccion de texto de A a D incluye tambien lo que hay en medio en
// orden de lectura (toda la primera fila), asi que arrastrar en diagonal
// agruparia de mas. Con las dos esquinas sale el rectangulo que uno
// espera al arrastrar.
function getSelectionCornerCells() {
  const cell = getCurrentTableCell();
  const table = cell ? cell.closest('table') : null;
  if (!table) return [];
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return [cell, cell];
  const range = sel.getRangeAt(0);
  const deNodo = (nodo) => {
    const el = nodo.nodeType === Node.TEXT_NODE ? nodo.parentElement : nodo;
    const celda = el && el.closest ? el.closest('td, th') : null;
    return celda && table.contains(celda) ? celda : null;
  };
  return [deNodo(range.startContainer) || cell, deNodo(range.endContainer) || cell];
}

function mergeTableCell() {
  // Con celdas marcadas manda esa marca; si no, se usan las dos esquinas
  // de la seleccion de texto (util con raton, incomodo con el dedo).
  const marcadas = getMarkedTableCells();
  const esquinas = marcadas.length ? marcadas : getSelectionCornerCells();
  if (!esquinas.length || !esquinas[0]) return;
  const table = esquinas[0].closest('table');
  const rejilla = buildTableGrid(table);

  // Rectangulo entre las dos esquinas. Si las dos son la misma celda, se
  // estira una columna a la derecha -- asi un toque simple sigue
  // agrupando algo, sin obligar a seleccionar en un movil.
  let r0 = Infinity; let r1 = -1; let c0 = Infinity; let c1 = -1;
  rejilla.forEach((fila, r) => fila.forEach((celda, c) => {
    if (!esquinas.includes(celda)) return;
    r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    c0 = Math.min(c0, c); c1 = Math.max(c1, c);
  }));
  if (r1 < 0) return;
  if (r0 === r1 && c0 === c1) {
    if (c1 + 1 >= (rejilla[r0] || []).length) return;
    c1 += 1;
  }
  // Una celda que asome fuera del rectangulo lo agranda hasta que cierra
  // (si no, quedarian huecos imposibles de dibujar).
  let creciendo = true;
  while (creciendo) {
    creciendo = false;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const celda = rejilla[r] && rejilla[r][c];
        if (!celda) continue;
        rejilla.forEach((fila, rr) => fila.forEach((otra, cc) => {
          if (otra !== celda) return;
          if (rr < r0) { r0 = rr; creciendo = true; }
          if (rr > r1) { r1 = rr; creciendo = true; }
          if (cc < c0) { c0 = cc; creciendo = true; }
          if (cc > c1) { c1 = cc; creciendo = true; }
        }));
      }
    }
  }

  const principal = rejilla[r0][c0];
  const absorbidas = [];
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const celda = rejilla[r] && rejilla[r][c];
      if (celda && celda !== principal && !absorbidas.includes(celda)) absorbidas.push(celda);
    }
  }
  // El contenido de las que se absorben no se pierde: se pega detras.
  absorbidas.forEach((celda) => {
    if (celda.textContent.trim()) principal.innerHTML = `${principal.innerHTML} ${celda.innerHTML}`;
    celda.remove();
  });
  const ancho = c1 - c0 + 1;
  const alto = r1 - r0 + 1;
  if (ancho > 1) principal.setAttribute('colspan', String(ancho));
  else principal.removeAttribute('colspan');
  if (alto > 1) principal.setAttribute('rowspan', String(alto));
  else principal.removeAttribute('rowspan');
  putCaretInCell(principal);
  refreshNoteEditorState();
}

function isMergedTableCell(cell) {
  if (!cell) return false;
  return (parseInt(cell.getAttribute('colspan'), 10) || 1) > 1
    || (parseInt(cell.getAttribute('rowspan'), 10) || 1) > 1;
}

// Deshace una combinacion: devuelve la celda a un solo hueco y rellena
// con celdas vacias los que habia ocupando.
function splitTableCell() {
  const cell = getMarkedTableCells().find((c) => isMergedTableCell(c)) || getCurrentTableCell();
  if (!isMergedTableCell(cell)) return;
  const table = cell.closest('table');
  const filas = Array.from(table.rows);
  const rejilla = buildTableGrid(table);
  const ancho = parseInt(cell.getAttribute('colspan'), 10) || 1;
  const alto = parseInt(cell.getAttribute('rowspan'), 10) || 1;

  let r0 = -1; let c0 = -1;
  rejilla.forEach((fila, r) => fila.forEach((celda, c) => {
    if (celda === cell && r0 < 0) { r0 = r; c0 = c; }
  }));
  if (r0 < 0) return;

  cell.removeAttribute('colspan');
  cell.removeAttribute('rowspan');
  for (let r = r0; r < r0 + alto; r += 1) {
    const fila = filas[r];
    if (!fila) continue;
    for (let c = c0; c < c0 + ancho; c += 1) {
      if (r === r0 && c === c0) continue;
      const nueva = document.createElement(cell.tagName);
      nueva.innerHTML = '<br>';
      // Se inserta delante de la primera celda de ESA fila que empiece
      // mas a la derecha; si no hay ninguna, al final.
      let referencia = null;
      for (let x = c + 1; x < rejilla[r].length; x += 1) {
        const candidata = rejilla[r][x];
        if (candidata && candidata !== cell && candidata.parentElement === fila) { referencia = candidata; break; }
      }
      if (referencia) fila.insertBefore(nueva, referencia);
      else if (r === r0 && c === c0 + 1) cell.after(nueva);
      else fila.appendChild(nueva);
      rejilla[r][c] = nueva;
    }
  }
  putCaretInCell(cell);
  refreshNoteEditorState();
}

// Deja el cursor dentro de una celda concreta -- las funciones de mover
// y combinar reordenan el DOM, y sin esto el cursor se quedaria colgado
// donde estaba la celda antes.
function putCaretInCell(cell) {
  const range = document.createRange();
  range.setStart(cell, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  NOTE_EDITOR_BODY.focus();
}

// Insertar una fila encima o debajo de la del cursor.
function insertTableRow(donde) {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const row = cell.parentElement;
  const nueva = document.createElement('tr');
  Array.from(row.children).forEach((existente) => {
    const celda = document.createElement(existente.tagName);
    celda.innerHTML = '<br>';
    const span = existente.getAttribute('colspan');
    if (span) celda.setAttribute('colspan', span);
    nueva.appendChild(celda);
  });
  if (donde === 'above') row.before(nueva);
  else row.after(nueva);
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// Insertar una columna a un lado u otro de la del cursor.
function insertTableColumn(donde) {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const row = cell.parentElement;
  const colIndex = Array.from(row.children).indexOf(cell);
  const table = row.closest('table');
  table.querySelectorAll('tr').forEach((tr) => {
    const referencia = tr.children[colIndex];
    if (!referencia) return;
    const nueva = document.createElement(referencia.tagName);
    nueva.innerHTML = '<br>';
    if (donde === 'left') referencia.before(nueva);
    else referencia.after(nueva);
  });
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// Insertar fila en un extremo de la tabla (no junto al cursor).
function insertTableRowAtEdge(donde) {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const tbody = cell.closest('tbody') || cell.closest('table');
  const referencia = donde === 'first' ? tbody.firstElementChild : tbody.lastElementChild;
  if (!referencia) return;
  const nueva = document.createElement('tr');
  Array.from(referencia.children).forEach((existente) => {
    const celda = document.createElement(existente.tagName);
    celda.innerHTML = '<br>';
    nueva.appendChild(celda);
  });
  if (donde === 'first') referencia.before(nueva);
  else referencia.after(nueva);
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

function insertTableColumnAtEdge(donde) {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const table = cell.closest('table');
  table.querySelectorAll('tr').forEach((tr) => {
    const nueva = document.createElement(tr.children[0] ? tr.children[0].tagName : 'td');
    nueva.innerHTML = '<br>';
    if (donde === 'first') tr.prepend(nueva);
    else tr.appendChild(nueva);
  });
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

// Quitar la fila/columna de un extremo, no la del cursor.
function removeTableRowAtEdge(donde) {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const table = cell.closest('table');
  const tbody = cell.closest('tbody') || table;
  if (tbody.children.length <= 1) { table.remove(); }
  else (donde === 'first' ? tbody.firstElementChild : tbody.lastElementChild).remove();
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}

function removeTableColumnAtEdge(donde) {
  const cell = getCurrentTableCell();
  if (!cell) return;
  const table = cell.closest('table');
  const columnas = cell.parentElement.children.length;
  if (columnas <= 1) { table.remove(); }
  else {
    table.querySelectorAll('tr').forEach((tr) => {
      const objetivo = donde === 'first' ? tr.firstElementChild : tr.lastElementChild;
      if (objetivo) objetivo.remove();
    });
  }
  NOTE_EDITOR_BODY.focus();
  refreshNoteEditorState();
}


const NOTE_TABLE_COMMANDS = {
  'row-above': () => insertTableRow('above'),
  'row-below': () => insertTableRow('below'),
  'row-first': () => insertTableRowAtEdge('first'),
  'row-last': () => insertTableRowAtEdge('last'),
  'row-remove': removeTableRow,
  'row-remove-first': () => removeTableRowAtEdge('first'),
  'row-remove-last': () => removeTableRowAtEdge('last'),
  'col-left': () => insertTableColumn('left'),
  'col-right': () => insertTableColumn('right'),
  'col-first': () => insertTableColumnAtEdge('first'),
  'col-last': () => insertTableColumnAtEdge('last'),
  'col-remove': removeTableColumn,
  'col-remove-first': () => removeTableColumnAtEdge('first'),
  'col-remove-last': () => removeTableColumnAtEdge('last'),
  'move-cell': () => startTableManualMove('cell'),
  'move-line': () => startTableManualMove('line'),
  'move-block': () => startTableManualMove('block'),
  'border-1': () => setTableBorder('1'),
  'border-2': () => setTableBorder('2'),
  'border-3': () => setTableBorder('3'),
  'border-4': () => setTableBorder('4'),
  merge: mergeTableCell,
  split: splitTableCell,
};

// Cada boton de la barra abre su lista de opciones, en vez de tener 20
// botones sueltos en una fila que no se acaba nunca. Mismo popover que
// el resto de la app (positionFixedPopover/closeAllPopovers).
const NOTE_TABLE_MENUS = {
  row: {
    label: 'Fila',
    opciones: [
      ['row-above', 'Añadir arriba'],
      ['row-below', 'Añadir debajo'],
      ['row-first', 'Añadir al principio'],
      ['row-last', 'Añadir al final'],
      ['row-remove', 'Quitar esta'],
      ['row-remove-first', 'Quitar la primera'],
      ['row-remove-last', 'Quitar la última'],
    ],
  },
  col: {
    label: 'Columna',
    opciones: [
      ['col-left', 'Añadir a la izquierda'],
      ['col-right', 'Añadir a la derecha'],
      ['col-first', 'Añadir al principio'],
      ['col-last', 'Añadir al final'],
      ['col-remove', 'Quitar esta'],
      ['col-remove-first', 'Quitar la primera'],
      ['col-remove-last', 'Quitar la última'],
    ],
  },
  move: {
    label: 'Mover',
    opciones: [
      ['move-cell', 'Una casilla'],
      ['move-line', 'Fila o columna'],
      ['move-block', 'Casillas marcadas'],
    ],
  },
  border: {
    label: 'Borde',
    // Con celdas marcadas el grosor solo cambia ahi; sin marcar nada,
    // cambia la tabla entera (ver setTableBorder). Cada opcion lleva a la
    // derecha una muestra de como se ve ese grosor.
    opciones: () => TABLE_BORDER_LEVELS.map((nivel, i) => [
      `border-${nivel}`,
      ['Fino', 'Medio', 'Grueso', 'Muy grueso'][i],
      `<span class="table-border-preview" style="border-bottom-width:${nivel}px"></span>`,
    ]),
  },
  cells: {
    label: 'Celdas',
    // Lista calculada al abrir: "Separar" solo aparece si la celda de
    // verdad esta agrupada -- ofrecerlo siempre llevaba a confusion.
    opciones: () => {
      const lista = [['merge', 'Agrupar las marcadas']];
      const encendida = getMarkedTableCells().find((c) => isMergedTableCell(c)) || getCurrentTableCell();
      if (isMergedTableCell(encendida)) lista.push(['split', 'Separar esta']);
      return lista;
    },
  },
};

const tableMenuPopover = document.createElement('div');
tableMenuPopover.className = 'select-popover table-menu-popover hidden';
document.body.appendChild(tableMenuPopover);

// Las acciones que solo ENTRAN en un modo (mover a mano) no cambian nada
// todavia: no tiene sentido guardarlas en el historial.
const TABLE_COMMANDS_WITHOUT_HISTORY = new Set(['move-cell', 'move-line', 'move-block']);

function runTableCommand(nombre) {
  const fn = NOTE_TABLE_COMMANDS[nombre];
  if (!fn) return;
  if (!TABLE_COMMANDS_WITHOUT_HISTORY.has(nombre)) {
    const antes = captureTableState();
    if (antes) {
      tableHistory.atras.push(antes);
      if (tableHistory.atras.length > TABLE_HISTORY_MAX) tableHistory.atras.shift();
      tableHistory.adelante.length = 0;
      refreshTableHistoryButtons();
    }
  }
  const resultado = fn();
  const despues = () => {
    // Quitar la ultima fila o columna borra la tabla entera: si ya no
    // queda ninguna, no tiene sentido seguir en la barra de tabla. En
    // modo "mover a mano" no aplica: ahi no hay cursor a proposito.
    if (!tableManualMove && !getCurrentTableCell()) setNoteTableToolbarOpen(false);
  };
  if (resultado && typeof resultado.then === 'function') resultado.then(despues);
  else despues();
}

document.querySelectorAll('#note-table-toolbar [data-table-menu]').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = NOTE_TABLE_MENUS[btn.dataset.tableMenu];
    const yaAbierto = !tableMenuPopover.classList.contains('hidden') && tableMenuPopover.dataset.menu === btn.dataset.tableMenu;
    closeAllPopovers(tableMenuPopover);
    if (yaAbierto) { tableMenuPopover.classList.add('hidden'); return; }
    tableMenuPopover.dataset.menu = btn.dataset.tableMenu;
    tableMenuPopover.innerHTML = '';
    const opciones = typeof menu.opciones === 'function' ? menu.opciones() : menu.opciones;
    opciones.forEach(([cmd, texto, muestra]) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'select-option';
      opt.textContent = texto;
      // Tercer elemento opcional: una muestra a la derecha (lo usa el
      // menu de Borde para enseñar como se ve cada grosor).
      if (muestra) {
        opt.classList.add('has-preview');
        opt.insertAdjacentHTML('beforeend', muestra);
      }
      opt.addEventListener('mousedown', (ev) => ev.preventDefault());
      opt.addEventListener('click', () => {
        tableMenuPopover.classList.add('hidden');
        runTableCommand(cmd);
      });
      tableMenuPopover.appendChild(opt);
    });
    tableMenuPopover.classList.remove('hidden');
    positionFixedPopover(btn, tableMenuPopover, { width: 220 });
  });
});

// ---------------------------------------------------------------------
// Tablas: un solo icono en la ESQUINA de la tabla (la mas cercana a la
// celda donde esta el cursor, de las 4 exteriores) que abre la barra de
// tabla -- la de formato de texto se aparta mientras tanto. Es lo que
// pidio Koku: "pincho la tabla, en la esquina mas cercana me muestra un
// icono... la barra de formato cambia".
//
// El icono va en <body> con position:fixed y se recoloca a partir del
// rectangulo real de la tabla, porque el editor tiene su propio scroll:
// colgarlo del <table> obligaria a envolverla en un contenedor y a tocar
// el HTML que se guarda en la nota.
// ---------------------------------------------------------------------
const tableCornerBtn = document.createElement('button');
tableCornerBtn.type = 'button';
tableCornerBtn.id = 'note-table-corner';
tableCornerBtn.className = 'note-table-corner hidden';
tableCornerBtn.setAttribute('aria-label', 'Modificar la tabla');
tableCornerBtn.title = 'Modificar la tabla';
tableCornerBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';
// mousedown preventDefault: sin esto el navegador quita el cursor de la
// celda al pulsar, y para cuando llega el click ya no hay "celda actual".
tableCornerBtn.addEventListener('mousedown', (e) => e.preventDefault());
tableCornerBtn.addEventListener('click', () => setNoteTableToolbarOpen(true));
document.body.appendChild(tableCornerBtn);

// Alterna entre la barra de formato de texto y la de tabla.
// Entrar/salir de la barra de tabla o de sus modos cambia el alto de la
// barra y bloquea/desbloquea el editor -- y con eso el navegador reajusta
// el scroll por su cuenta, dejando la tabla en otro sitio de la pantalla
// ("me baja la vista y marea"). Se mide donde esta la tabla ANTES, se
// hace el cambio, y se compensa la diferencia sobre el scroll del
// editor. El segundo pase en requestAnimationFrame es por si el
// navegador lo reajusta otra vez al pintar.
function keepTableInPlace(fn) {
  // Se ancla la CELDA donde esta el cursor, no el principio de la tabla:
  // en una tabla mas alta que la pantalla, mantener quieta su primera
  // fila mandaba la vista al principio de la tabla aunque estuvieras
  // escribiendo en la ultima ("va al inicio de esta").
  const cell = getCurrentTableCell()
    || (tableMarkMode && tableMarkMode.table.querySelector('td, th'))
    || (tableManualMove && tableManualMove.table.querySelector('td, th'));
  const antes = cell ? cell.getBoundingClientRect().top : null;
  fn();
  if (antes === null || !NOTE_EDITOR_BODY.contains(cell)) return;
  const ajustar = () => {
    const despues = cell.getBoundingClientRect().top;
    if (Math.abs(despues - antes) > 1) NOTE_EDITOR_BODY.scrollTop += despues - antes;
  };
  ajustar();
  requestAnimationFrame(ajustar);
}

function setNoteTableToolbarOpen(open) {
  keepTableInPlace(() => {
    // Cerrar la barra de tabla sale tambien de los modos que bloquean el
    // editor ("mover a mano" y "Marcar"): si no, se quedaria bloqueado sin
    // nada que lo delate.
    if (!open) { stopTableManualMove(); stopTableMarkMode(); }
    if (open) { tableHistory.atras.length = 0; tableHistory.adelante.length = 0; refreshTableHistoryButtons(); }
    document.getElementById('note-body-toolbar').classList.toggle('hidden', open);
    document.getElementById('note-table-toolbar').classList.toggle('hidden', !open);
    if (!open) NOTE_EDITOR_BODY.focus();
    refreshTableCornerButton();
  });
}

// Tocar fuera de la tabla sale de "mover a mano" y de "Marcar" -- mismo
// criterio que la propia barra de tabla, que se cierra al sacar el
// cursor de ella.
document.addEventListener('pointerdown', (e) => {
  const modo = tableManualMove || tableMarkMode;
  if (!modo) return;
  if (e.target.closest && e.target.closest('table') === modo.table) return;
  if (e.target.closest && e.target.closest('#note-table-toolbar, .table-menu-popover, #app-confirm-modal')) return;
  stopTableManualMove();
  stopTableMarkMode();
});

document.getElementById('btn-note-table-mark').addEventListener('mousedown', (e) => e.preventDefault());
document.getElementById('btn-note-table-mark').addEventListener('click', () => {
  keepTableInPlace(() => {
    if (tableMarkMode) stopTableMarkMode();
    else startTableMarkMode();
  });
});
document.getElementById('btn-note-table-undo').addEventListener('mousedown', (e) => e.preventDefault());
document.getElementById('btn-note-table-undo').addEventListener('click', undoTableChange);
document.getElementById('btn-note-table-redo').addEventListener('mousedown', (e) => e.preventDefault());
document.getElementById('btn-note-table-redo').addEventListener('click', redoTableChange);
refreshTableHistoryButtons();

function isNoteTableToolbarOpen() {
  return !document.getElementById('note-table-toolbar').classList.contains('hidden');
}

// Coloca (o esconde) el icono de esquina. Se llama en cada cambio de
// seleccion dentro del editor y al hacer scroll del texto, que es cuando
// la tabla se mueve por la pantalla.
function refreshTableCornerButton() {
  const box = document.getElementById('note-table-corner');
  if (!box) return;
  const cell = getCurrentTableCell();
  const table = cell ? cell.closest('table') : null;
  // Con la barra de tabla abierta el icono sobra (ya estas dentro), y en
  // modo lectura no hay nada que modificar.
  if (!table || isNoteTableToolbarOpen() || NOTE_EDITOR_BODY.getAttribute('contenteditable') === 'false') {
    box.classList.add('hidden');
    return;
  }
  // SIEMPRE en la esquina superior derecha de la tabla, a caballo sobre
  // ella. Antes saltaba a la esquina mas cercana al cursor, y con la
  // tabla a medio salir de la pantalla acababa en un sitio distinto cada
  // vez. Si esa esquina no se ve, el icono tampoco.
  const rect = table.getBoundingClientRect();
  const visible = NOTE_EDITOR_BODY.getBoundingClientRect();
  const esquinaX = rect.right;
  const esquinaY = rect.top;
  const aLaVista = esquinaY >= visible.top && esquinaY <= visible.bottom
    && esquinaX >= visible.left && esquinaX <= visible.right;
  if (!aLaVista) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const tamano = box.offsetWidth || 28;
  box.style.left = `${esquinaX - tamano / 2}px`;
  box.style.top = `${esquinaY - tamano / 2}px`;
}

NOTE_EDITOR_BODY.addEventListener('scroll', refreshTableCornerButton);

// No hay boton de "Listo": se sale de la barra de tabla en cuanto el
// cursor deja de estar dentro de una tabla (tocando el texto de fuera,
// por ejemplo). Pedido de Koku, que ese boton no lo veia claro.
function closeTableToolbarIfCaretLeft() {
  // En "mover a mano" y en "Marcar" no hay cursor (el editor esta
  // bloqueado a proposito): ahi se sale tocando fuera, no por esto.
  if (tableManualMove || tableMarkMode) return;
  if (isNoteTableToolbarOpen() && !getCurrentTableCell()) setNoteTableToolbarOpen(false);
}

// ---------------------------------------------------------------------
// Imagenes dentro de una nota (Fase 4, ultima sub-ronda): boton "Imagen"
// que abre el selector de archivo nativo, y Ctrl+V para pegar una imagen
// copiada (de una captura de pantalla, de otra web...) directamente
// dentro del editor. Las dos vias acaban guardando el archivo en el almacen
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

// Partir el parrafo actual "a mano" (Range API, sin execCommand) cuando
// la linea donde esta el cursor contiene algun resaltado -- sustituye
// por completo al Intro NATIVO solo en ese caso. Motivo: el
// insertParagraph nativo del navegador no garantiza conservar de forma
// fiable un <span data-highlight> arbitrario al partir un bloque en dos
// (mismo tipo de comportamiento poco fiable en limites de elementos en
// linea ya documentado y evitado en el resaltado -- ver
// insertNodeOutsideNoteHighlight/wrapNoteHighlightRange, que tampoco
// usan execCommand por el mismo motivo) -- tras varias rondas
// intentando parchear el caso mas comun (seleccionar una palabra suelta
// y resaltarla, sin Ctrl+A) seguia perdiendo el color al pulsar Intro.
// Devuelve true si ha actuado (y ya ha modificado el DOM+seleccion), en
// cuyo caso quien llama debe hacer preventDefault() y no dejar pasar
// nada mas; false si no aplica aqui (linea sin ningun resaltado, dentro
// de una lista/bloque de codigo/tabla, o selección no colapsada) y el
// Intro debe seguir su camino normal, sin ningun cambio de
// comportamiento en esos casos.
function handleNoteHighlightAwareEnter() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  if (isSelectionInsideNoteListItem() || isCursorInCodeBlock()) return false;

  const liveRange = sel.getRangeAt(0);
  if (!NOTE_EDITOR_BODY.contains(liveRange.startContainer)) return false;

  // Color activo en el punto del cursor ANTES de tocar nada: puede venir
  // del modo "resaltar antes de escribir" (pendiente) o de estar
  // escribiendo dentro de un resaltado ya aplicado. Sea cual sea el
  // origen, la linea nueva CONTINUA con ese mismo color -- decision de
  // Koku, para que el rotulador se comporte igual que la cita, que ya
  // seguia activa saltara las lineas que saltara. Para dejar de
  // resaltar esta el boton "Ninguno", como en la cita esta su propio
  // boton.
  const colorQueContinua = getActiveNoteHighlightKey() || null;

  // El span semilla del modo pendiente se retira ahora (si no se llego a
  // escribir nada real dentro), para que no estorbe al partir la linea
  // -- el color en si ya esta guardado en colorQueContinua.
  if (pendingNoteHighlightKey) cancelPendingNoteHighlight();

  // Releer la seleccion YA DESPUES de cancelar el resaltado pendiente
  // (que puede haber quitado un nodo del DOM) -- nunca fiarse de un
  // Range capturado antes de una mutacion.
  const sel2 = window.getSelection();
  if (!sel2 || sel2.rangeCount === 0) return false;
  const range2 = sel2.getRangeAt(0);
  const caretContainer = range2.startContainer;
  const caretOffset = range2.startOffset;
  if (!NOTE_EDITOR_BODY.contains(caretContainer)) return false;

  ensureNoteFirstLineWrapped();
  const line = getNoteLineElement(caretContainer);
  if (!line || !NOTE_LINE_TAGS.has(line.tagName) || line.tagName === 'LI') return false;
  // Una linea sin nada resaltado sigue usando el Intro nativo de
  // siempre. La excepcion es tener el rotulador recien activado sin
  // haber escrito todavia: ahi no hay ningun span en la linea, pero el
  // color igual tiene que continuar abajo.
  if (!line.querySelector('[data-highlight]') && !colorQueContinua) return false;

  const tailRange = document.createRange();
  tailRange.setStart(caretContainer, caretOffset);
  tailRange.setEndAfter(line.lastChild || line);
  const tailFragment = tailRange.extractContents();

  const newLine = line.cloneNode(false); // mismo tag + mismos data-indent/data-quote/data-style que la linea original
  newLine.appendChild(tailFragment);

  // extractContents() clona (vacio) cualquier [data-highlight] cuyo
  // limite del Range cae justo en su borde (cursor exactamente al
  // principio o al final de lo resaltado) -- ese clon vacio se queda
  // sin texto pero SI con el padding/radius del CSS de resaltado,
  // pintandose como una cajita de color de la nada. Se quita en los dos
  // lados, mismo criterio ya usado en insertNodeOutsideNoteHighlight
  // para el mismo tipo de residuo.
  [line, newLine].forEach((el) => {
    el.querySelectorAll('[data-highlight]').forEach((span) => {
      if (!span.textContent) span.remove();
    });
  });

  if (!newLine.hasChildNodes() || !newLine.textContent) newLine.appendChild(document.createElement('br'));
  if (!line.hasChildNodes() || !line.textContent) line.appendChild(document.createElement('br'));

  line.parentNode.insertBefore(newLine, line.nextSibling);

  const newRange = document.createRange();
  newRange.setStart(newLine, 0);
  newRange.collapse(true);
  sel2.removeAllRanges();
  sel2.addRange(newRange);

  // Continuar el resaltado en la linea nueva. Si el corte cayo a mitad
  // de un resaltado, la linea nueva YA empieza con ese span y basta con
  // meter el cursor dentro; si el corte fue al final (lo normal al
  // escribir y pulsar Intro), no hay nada resaltado todavia y se
  // arranca el modo pendiente con el mismo color, que es exactamente lo
  // que hace pulsar ese color a mano.
  if (colorQueContinua) {
    const primero = newLine.firstChild;
    const yaResaltada = primero
      && primero.nodeType === Node.ELEMENT_NODE
      && primero.getAttribute('data-highlight') === colorQueContinua;
    if (yaResaltada) {
      const dentro = document.createRange();
      dentro.setStart(primero, 0);
      dentro.collapse(true);
      sel2.removeAllRanges();
      sel2.addRange(dentro);
    } else {
      beginPendingNoteHighlight(colorQueContinua);
    }
  }

  NOTE_EDITOR_BODY.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

// Intro en una linea de cita VACIA: sale de la cita, en vez de añadir
// otra linea citada debajo. Sin esto no habia forma de TERMINAR una cita
// escribiendo: cada Intro heredaba el data-quote del parrafo anterior,
// asi que se acumulaban lineas en blanco y la barra de la izquierda se
// repetia una y otra vez (lo reporto Koku). Es lo mismo que hacen Notion
// o Apple Notes: la linea vacia sale del bloque en vez de continuarlo.
// Devuelve true si ha actuado (quien llama debe hacer preventDefault).
function handleNoteQuoteEnterExit() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  if (isSelectionInsideNoteListItem() || isCursorInCodeBlock()) return false;
  const line = getNoteBlockAncestor(sel.getRangeAt(0).startContainer);
  if (!line || line.getAttribute('data-quote') !== '1') return false;
  if (line.textContent.trim() !== '') return false;
  line.removeAttribute('data-quote');
  line.removeAttribute('data-indent');
  NOTE_EDITOR_BODY.dispatchEvent(new Event('input', { bubbles: true }));
  refreshNoteEditorState();
  return true;
}

NOTE_EDITOR_BODY.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    if (handleNoteQuoteEnterExit()) {
      e.preventDefault();
      return;
    }
    if (handleNoteHighlightAwareEnter()) {
      e.preventDefault();
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
// que deriveTitleFromBody en routes-local/notes.js, duplicada aqui a
// proposito porque este proyecto no tiene ningun mecanismo para
// compartir codigo entre las rutas y la interfaz sin meter un build nuevo.
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
  const pattern = /<br\s*\/?>|<\/(?:div|p|li|h1|h2|h3)>|<(?:div|p|li|h1|h2|h3)(?:\s[^>]*)?>/gi;
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
  entry.bodyHtml = serializeAssetImages(NOTE_EDITOR_BODY);
  entry.title = deriveTitleFromBodyClient(entry.bodyHtml, 'html');
  // entry.folderId ya no se toca aqui -- el editor no tiene desplegable
  // de carpeta (quitado en esta ronda, ver CLAUDE.md/regla de
  // simplicidad); mover una nota se hace desde "Seleccionar -> Mover"
  // en el listado, nunca editando la nota.
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
  // En solo lectura la barra de formato entera sobra (no hay nada que
  // formatear), asi que se oculta en vez de dejarla ahi desactivada --
  // de paso el texto gana la pantalla que ocupaba.
  document.getElementById('note-body-toolbar').classList.toggle('hidden', readOnly);
  document.querySelectorAll('#note-body-toolbar .note-editor-btn[data-cmd], #note-table-insert-btn, #note-image-insert-btn').forEach((b) => { b.disabled = readOnly; });
  if (readOnly) {
    }
}

function loadOpenNoteIntoDom(entry) {
  document.getElementById('note-id').value = entry.id || '';
  refreshNoteTitlePreview(entry.title);
  NOTE_EDITOR_BODY.innerHTML = prepareAssetHtmlForDom(entry.bodyHtml);
  hydrateAssetImages(NOTE_EDITOR_BODY);
  resetNoteEditorToolbar();
  noteModalFavorite = entry.favorite;
  refreshNoteFavoriteBtn();
  applyNoteEditorReadMode(entry.readMode);
}

function switchActiveOpenNote(key) {
  if (key === state.activeOpenNoteKey) return;
  captureActiveOpenNoteFromDom();
  const entry = findOpenNote(key);
  if (!entry) return;
  state.activeOpenNoteKey = key;
  loadOpenNoteIntoDom(entry);
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
    stopNoteEditorViewportAnchor();
    // El icono de esquina de tabla vive en <body> con position:fixed, no
    // dentro del editor: al salir hay que esconderlo a mano o se queda
    // flotando encima del listado de notas.
    stopTableManualMove();
    tableCornerBtn.classList.add('hidden');
    tableMenuPopover.classList.add('hidden');
    document.getElementById('note-table-toolbar').classList.add('hidden');
    document.getElementById('note-body-toolbar').classList.remove('hidden');
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
  if (isMobileLayout()) {
    // En movil hay autoguardado, asi que preguntar "¿cerrar sin
    // guardar?" no tenia ningun sentido -- y encima el temporizador del
    // autoguardado seguia vivo tras cerrar, asi que guardaba igual
    // despues de haber dicho que no (justo lo que reporto Koku: "me
    // dice de salir sin guardar, pero al entrar me lo ha guardado").
    // Ahora se guarda lo que quede pendiente y se cierra sin preguntar
    // nada.
    flushMobileNoteAutosave(entry);
  } else if (isOpenNoteDirty(entry)) {
    const label = entry.title || 'Nota sin título';
    if (!confirm(`"${label}" tiene cambios sin guardar. ¿Cerrar sin guardar?`)) return;
  }
  removeOpenNoteAndAdvance(key);
}

// "openNoteInEditor": si la nota (con id real) ya esta abierta, solo se
// activa -- no se duplica en la lista de notas abiertas. Si no, se anade
// como una entrada nueva y se activa.
// readMode: se decide AQUI, al abrir desde el listado (clic normal en la
// fila = editar; el boton de "solo lectura" de la fila = leer). Dentro de
// la nota ya no hay forma de alternar -- para cambiar de modo se sale y
// se vuelve a entrar por el otro camino, tal y como lo pidio Koku.
function openNoteInEditor(note, { readMode = false } = {}) {
  const existing = note ? state.openNotes.find((n) => n.id === note.id) : null;
  if (existing) {
    switchActiveOpenNote(existing.key);
    existing.readMode = readMode;
    applyNoteEditorReadMode(readMode);
  } else {
    if (state.activeOpenNoteKey) captureActiveOpenNoteFromDom();
    const entry = noteEntrySnapshot(note);
    entry.readMode = readMode;
    state.openNotes.push(entry);
    state.activeOpenNoteKey = entry.key;
    loadOpenNoteIntoDom(entry);
  }
  document.getElementById('note-editor-view').classList.remove('hidden');
  startNoteEditorViewportAnchor();
  // Ya no hay campo de titulo al que llevar el foco (Fase 4) -- el
  // cuerpo es el unico sitio donde se escribe de verdad.
  NOTE_EDITOR_BODY.focus();
}

// ---------------------------------------------------------------------
// El editor, clavado al trozo de pantalla que de verdad se ve.
//
// Con el teclado abierto, el telefono NO encoge la ventana: la deja
// igual de alta y tapa la parte de abajo. Una pantalla fija a inset:0
// sigue midiendo la ventana ENTERA, asi que su mitad inferior queda
// debajo del teclado -- y el sistema deja arrastrar toda la vista para
// llegar a ella. Eso es el segundo scroll que se notaba: no era del
// texto, era la vista entera moviendose.
//
// visualViewport es justo lo que dice cuanto se ve de verdad y donde
// empieza: fijando ahi el alto y el desplazamiento del editor, no queda
// nada fuera y no hay nada que arrastrar. La cabecera y la barra de
// formato se quedan quietas todo el rato, que es lo que hacia falta para
// poder tocar una tabla con calma.
// ---------------------------------------------------------------------
let noteEditorViewportAnchored = false;

// Trae el CURSOR a la zona visible del editor -- se llama cuando el
// teclado del movil cambia el alto disponible (abrirse/cerrarse): el
// editor se encoge para no quedar debajo del teclado, pero nada movia el
// contenido, asi que la linea/casilla donde estabas escribiendo se
// quedaba tapada detras ("no tiene en cuenta el teclado del movil").
function scrollNoteCaretIntoView() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  let node = sel.anchorNode;
  if (!node || !NOTE_EDITOR_BODY.contains(node)) return;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  let rect = range.getClientRects()[0] || range.getBoundingClientRect();
  if (!rect || (rect.top === 0 && rect.bottom === 0 && rect.height === 0)) {
    // Un rango colapsado en una linea/casilla vacia no tiene caja: se usa
    // la del elemento donde esta el cursor.
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !node.getBoundingClientRect) return;
    rect = node.getBoundingClientRect();
  }
  const visible = NOTE_EDITOR_BODY.getBoundingClientRect();
  const margen = 28; // un poco de aire, que el cursor no quede pegado al borde
  if (rect.bottom > visible.bottom - margen) {
    NOTE_EDITOR_BODY.scrollTop += rect.bottom - (visible.bottom - margen);
  } else if (rect.top < visible.top + margen) {
    NOTE_EDITOR_BODY.scrollTop -= (visible.top + margen) - rect.top;
  }
}

// Alto del hueco visible la ultima vez -- solo cuando CAMBIA (el teclado
// se abre o se cierra) se recoloca el cursor; los demas avisos de
// visualViewport (scroll) no deben pelearse con el scroll del usuario.
let lastNoteViewportHeight = null;

function applyNoteEditorViewportAnchor() {
  const view = document.getElementById('note-editor-view');
  const vv = window.visualViewport;
  if (!vv || view.classList.contains('hidden')) return;
  // Si el sistema ha desplazado la PAGINA para dejar sitio al teclado,
  // se devuelve a cero: con la pagina quieta ya no queda ese segundo
  // scroll "general" que se podia arrastrar, y el editor se ajusta solo
  // al hueco que de verdad se ve.
  if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  const cambioDeAlto = lastNoteViewportHeight !== null && Math.abs(lastNoteViewportHeight - vv.height) > 1;
  lastNoteViewportHeight = vv.height;
  view.style.height = `${vv.height}px`;
  view.style.transform = `translateY(${vv.offsetTop}px)`;
  // En el siguiente pintado el editor ya tiene su alto nuevo: es cuando
  // se puede saber si el cursor quedo fuera y cuanto hay que moverse.
  if (cambioDeAlto) requestAnimationFrame(scrollNoteCaretIntoView);
}

function startNoteEditorViewportAnchor() {
  // Con el editor abierto, la PAGINA de debajo no se desplaza (misma
  // idea que body.mobile-day-scroll-lock en la vista diaria): si puede
  // desplazarse, el sistema la mueve al abrir el teclado y acabas con
  // dos pantallas apiladas -- la cabecera del listado de notas asomando
  // por encima de la del editor.
  document.body.classList.add('note-editor-open');
  applyNoteEditorViewportAnchor();
  if (noteEditorViewportAnchored || !window.visualViewport) return;
  noteEditorViewportAnchored = true;
  window.visualViewport.addEventListener('resize', applyNoteEditorViewportAnchor);
  window.visualViewport.addEventListener('scroll', applyNoteEditorViewportAnchor);
}

function stopNoteEditorViewportAnchor() {
  document.body.classList.remove('note-editor-open');
  lastNoteViewportHeight = null;
  const view = document.getElementById('note-editor-view');
  view.style.height = '';
  view.style.transform = '';
  if (!noteEditorViewportAnchored) return;
  noteEditorViewportAnchored = false;
  window.visualViewport.removeEventListener('resize', applyNoteEditorViewportAnchor);
  window.visualViewport.removeEventListener('scroll', applyNoteEditorViewportAnchor);
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

document.getElementById('btn-close-note-editor').addEventListener('click', closeNoteEditorView);

// El dot de "sin guardar" del panel de Secciones debe reflejar lo que se
// escribe AHORA, no solo lo que habia la ultima vez que se cambio de
// nota -- de ahi capturar del DOM tambien en cada input del contenido
// (el titulo, desde la Fase 4, ya no es un campo aparte: se deriva del
// propio cuerpo dentro de captureActiveOpenNoteFromDom), no solo al
// cambiar de nota o guardar.
NOTE_EDITOR_BODY.addEventListener('input', () => {
  // Borrar el texto de un resaltado a mano (seleccionar y Suprimir, o
  // ir borrando letra a letra) deja el <span> vacio: sin texto dentro
  // no hay nada que se pueda seleccionar ni borrar, pero el CSS le sigue
  // pintando su padding/borde redondeado -- la "marca que se queda ahi"
  // que reporto Koku. Se barren aqui, en cada cambio del contenido, y no
  // solo despues de una accion de resaltado.
  removeEmptyNoteHighlights();
  captureActiveOpenNoteFromDom();
  scheduleMobileNoteAutosave();
  // Escribiendo cerca del borde de abajo (con el teclado ya abierto), el
  // navegador no siempre acerca el cursor solo cuando el scroll es de un
  // contenedor interno como este -- se comprueba en cada cambio. Si el
  // cursor ya se ve, no hace nada.
  scrollNoteCaretIntoView();
});

// Mientras el cursor esta dentro del texto de la nota, el teclado del
// sistema esta abierto: se marca en <body> para que la barra inferior
// (fija abajo del todo) se aparte -- si no, queda flotando justo encima
// del teclado. Vuelve sola en cuanto el cursor sale del texto.
NOTE_EDITOR_BODY.addEventListener('focus', () => {
  document.body.classList.add('note-typing');
});
NOTE_EDITOR_BODY.addEventListener('blur', () => {
  document.body.classList.remove('note-typing');
});

// Autoguardado -- SOLO en movil, pedido explicito de Koku (en
// escritorio se queda el flujo manual/Ctrl+Intro de siempre, que ya le
// gustaba). Debounce corto tras cada input; reutiliza el mismo submit
// de siempre via requestSubmit() en vez de duplicar la logica de
// guardado -- el dialogo de "cambios sin guardar" de closeOpenNote()
// se queda como red de seguridad para el hueco de tiempo entre el
// ultimo tecleo y que el debounce dispare.
// "Estamos en el visor movil": mismo umbral que el CSS (860px), en un
// unico sitio para que no se repita el matchMedia suelto por el
// archivo.
function isMobileLayout() {
  return window.matchMedia('(max-width: 859px)').matches;
}

let mobileNoteAutosaveTimer = null;
function scheduleMobileNoteAutosave() {
  if (!isMobileLayout()) return;
  clearTimeout(mobileNoteAutosaveTimer);
  mobileNoteAutosaveTimer = setTimeout(() => {
    const entry = findOpenNote(state.activeOpenNoteKey);
    if (!entry || entry.readMode) return;
    document.getElementById('note-form').requestSubmit();
  }, 1500);
}

// Guardar YA lo que estuviera esperando al debounce, y cancelar el
// temporizador. Se llama al cerrar una nota en movil: sin cancelarlo,
// el guardado pendiente se disparaba DESPUES de cerrar, sobre una nota
// que ya no era la activa.
function flushMobileNoteAutosave(entry) {
  clearTimeout(mobileNoteAutosaveTimer);
  mobileNoteAutosaveTimer = null;
  if (!entry || entry.readMode) return;
  if (!isOpenNoteDirty(entry)) return;
  document.getElementById('note-form').requestSubmit();
}

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
  // Una nota NUEVA sin nada escrito no se guarda: abrir el editor y
  // salirse sin escribir no debe dejar una "Nota sin título" vacia en el
  // listado (el cierre en movil dispara este mismo submit via
  // flushMobileNoteAutosave, que considera "con cambios" cualquier nota
  // sin id). Una nota YA guardada que se vacia si se guarda vacia, eso
  // es una edicion normal.
  if (!entry.id && !hasNoteContent) return;
  const payload = {
    // Fase 4: ya no se manda titulo, la ruta lo deriva del body
    // (ver deriveTitleFromBody en routes-local/notes.js).
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
});

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

// Fase 5: el 2o hueco de la barra inferior (id/clase estables,
// data-mobile-nav="notes" siempre) puede sustituirse por otra App --
// Notas sigue siendo el valor por defecto. Cada entrada usa el mismo
// SVG que su tarjeta en Extensiones (btn-open-*), para que el icono
// sea reconocible en los dos sitios.
const MOBILE_NAV_SLOT_APPS = {
  notes: {
    label: 'Notas',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"></path><path d="M15 3v5h5"></path><line x1="8" y1="12" x2="16" y2="12"></line><line x1="8" y1="16" x2="13" y2="16"></line></svg>',
    open: () => openMobileNotesView(),
  },
  gym: {
    label: 'Gimnasio',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="3" height="6" rx="1"></rect><rect x="19" y="9" width="3" height="6" rx="1"></rect><line x1="5" y1="12" x2="19" y2="12"></line><rect x="6.5" y="7" width="2" height="10" rx="1"></rect><rect x="15.5" y="7" width="2" height="10" rx="1"></rect></svg>',
    open: () => openGymView(),
  },
  finanzas: {
    label: 'Finanzas',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v10M9.5 9.5c0-1.5 1.2-2 2.5-2s2.5.6 2.5 2c0 1.2-1 1.6-2.5 2.2S9.5 13 9.5 14.3c0 1.4 1.1 2.2 2.5 2.2s2.5-.6 2.5-2"></path></svg>',
    open: () => openFinanzasView(),
  },
  lecturas: {
    label: 'Lecturas',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5c2-1 5-1 8 1 3-2 6-2 8-1v13c-2-1-5-1-8 1-3-2-6-2-8-1z"></path><path d="M12 6v13"></path></svg>',
    open: () => openLecturasView(),
  },
  viajes: {
    label: 'Viajes',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
    open: () => openViajesView(),
  },
};

function getMobileNavNotesSlot() {
  const stored = localStorage.getItem('mobileNavNotesSlot');
  return MOBILE_NAV_SLOT_APPS[stored] ? stored : 'notes';
}

function applyMobileNavCustomization() {
  const slot = getMobileNavNotesSlot();
  const app = MOBILE_NAV_SLOT_APPS[slot];
  const btn = document.getElementById('mobile-nav-notes-btn');
  if (!btn) return;
  btn.setAttribute('aria-label', app.label);
  btn.innerHTML = `${app.icon}<span>${app.label}</span>`;
}
applyMobileNavCustomization();

// Selector en Configuracion > Este dispositivo (ajuste por dispositivo,
// localStorage, mismo criterio que la unidad de peso de Gimnasio).
const mobileNavSlotField = createSelectField({
  options: Object.entries(MOBILE_NAV_SLOT_APPS).map(([value, app]) => ({ value, label: app.label })),
  initialValue: getMobileNavNotesSlot(),
  onChange: (v) => {
    localStorage.setItem('mobileNavNotesSlot', v);
    applyMobileNavCustomization();
  },
});
document.getElementById('mobile-nav-slot-field').appendChild(mobileNavSlotField.element);

function goToMobileSection(section) {
  closeAllMobileOverlays();
  // "notes" es el hueco de la barra inferior -- por defecto abre la
  // vista de Notas propia del movil (Fase 4), pero puede abrir otra
  // App si Koku eligio otra en Configuracion -> Este dispositivo (ver
  // applyMobileNavCustomization() arriba).
  if (section === 'notes') MOBILE_NAV_SLOT_APPS[getMobileNavNotesSlot()].open();
  else if (section === 'extensions') openExtensionsView();
  else if (section === 'settings') openSettingsModal();
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

// Mismo menu "+", ahora como boton flotante en Notas (id
// mobile-notes-add-wrap/-menu, btn-mobile-notes-add) -- sustituye a los
// antiguos botones de +carpeta/+nota de la barra superior, para dejarle
// mas hueco al buscador. Mismas 2 acciones que ya llamaban esos botones
// (openNoteFolderModal(null)/openNoteInEditor(null)), solo movidas aqui.
const MOBILE_NOTES_FAB_ADD_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';

// Seleccionando o moviendo, el "+" estorba: no tiene sentido crear nada
// a medias de eso, y ademas chocaria con la barra de acciones que
// aparece justo encima de la barra inferior.
function refreshMobileNotesFab() {
  const seleccionando = mobileNotesMode === 'select' || mobileNotesMode === 'move';
  document.getElementById('mobile-notes-add-wrap').classList.toggle('hidden', seleccionando);
  document.getElementById('btn-mobile-notes-add').innerHTML = MOBILE_NOTES_FAB_ADD_ICON;
  if (seleccionando) toggleMobileCalendarAddMenu(false, 'mobile-notes-add-menu', 'btn-mobile-notes-add');
}

document.getElementById('btn-mobile-notes-add').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMobileCalendarAddMenu(undefined, 'mobile-notes-add-menu', 'btn-mobile-notes-add');
});
document.getElementById('btn-mobile-notes-add-folder').addEventListener('click', () => {
  toggleMobileCalendarAddMenu(false, 'mobile-notes-add-menu', 'btn-mobile-notes-add');
  openNoteFolderModal(null);
});
document.getElementById('btn-mobile-notes-add-note').addEventListener('click', () => {
  toggleMobileCalendarAddMenu(false, 'mobile-notes-add-menu', 'btn-mobile-notes-add');
  openNoteInEditor(null);
});

// Tocar fuera del boton/menu tambien lo cierra -- patron normal de menu
// flotante (ver closeAllPopovers en settings.js para el mismo patron con
// los popovers de color/icono/fecha). Comprueba los 3 wraps (mes, dia,
// Notas).
document.addEventListener('click', (e) => {
  const monthWrap = document.getElementById('mobile-calendar-add-wrap');
  if (monthWrap && !monthWrap.contains(e.target)) toggleMobileCalendarAddMenu(false);
  const dayWrap = document.getElementById('mobile-day-add-wrap');
  if (dayWrap && !dayWrap.contains(e.target)) toggleMobileCalendarAddMenu(false, 'mobile-day-add-menu', 'btn-mobile-day-add');
  const notesWrap = document.getElementById('mobile-notes-add-wrap');
  if (notesWrap && !notesWrap.contains(e.target)) toggleMobileCalendarAddMenu(false, 'mobile-notes-add-menu', 'btn-mobile-notes-add');
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
document.getElementById('btn-close-extensions').addEventListener('click', closeExtensionsView);

// ---------------------------------------------------------------------
// Pantalla de Grupos: dos niveles (lista de grupos -> lo que hay dentro
// de uno). No duplica el alta/edicion/borrado de grupos, que ya vive en
// Configuracion -> Grupos: el boton "Gestionar grupos" lleva ahi mismo,
// para que solo haya UN sitio donde se editan.
// ---------------------------------------------------------------------
// null = "Todos los eventos"; si no, el id del grupo abierto.
let groupsViewSelectedId = undefined; // undefined = todavia en la lista
let groupsViewItems = [];
let groupsEditMode = false;
const groupsViewFilters = { type: 'all', done: 'all', q: '' };

const groupsFilterTypeField = createSelectField({
  options: [
    { value: 'all', label: 'Todo' },
    { value: 'event', label: 'Recordatorios' },
    { value: 'task', label: 'Tareas' },
  ],
  initialValue: 'all',
  onChange: (v) => { groupsViewFilters.type = v; renderGroupsDetailList(); },
});
document.getElementById('groups-filter-type-field').appendChild(groupsFilterTypeField.element);

const groupsFilterDoneField = createSelectField({
  options: [
    { value: 'all', label: 'Terminadas o no' },
    { value: 'pending', label: 'Sin terminar' },
    { value: 'done', label: 'Terminadas' },
  ],
  initialValue: 'all',
  onChange: (v) => { groupsViewFilters.done = v; renderGroupsDetailList(); },
});
document.getElementById('groups-filter-done-field').appendChild(groupsFilterDoneField.element);

document.getElementById('groups-search').addEventListener('input', (e) => {
  groupsViewFilters.q = e.target.value;
  renderGroupsDetailList();
});

async function openGroupsView() {
  document.getElementById('groups-view').classList.remove('hidden');
  setCurrentScreen('groups');
  showGroupsList();
  groupsEditMode = false;
  refreshGroupsEditModeButton();
  await refreshGroupsView();
}

// Recarga los grupos y repinta sus tarjetas. Lo llaman tanto la apertura
// de la pantalla como cualquier alta/edicion/borrado desde su ficha.
async function refreshGroupsView() {
  await loadGroups();
  renderGroupsViewList();
}

function closeGroupsView() {
  document.getElementById('groups-view').classList.add('hidden');
  setCurrentScreen('home');
}

// Nivel 1: las tarjetas de grupo.
function showGroupsList() {
  groupsViewSelectedId = undefined;
  document.getElementById('groups-list-panel').classList.remove('hidden');
  document.getElementById('groups-detail-panel').classList.add('hidden');
  document.getElementById('btn-groups-back').classList.add('hidden');
  document.getElementById('groups-view-title').textContent = 'Grupos';
}

function renderGroupsViewList() {
  const box = document.getElementById('groups-view-list');
  box.innerHTML = '';
  // "Todos" primero: es el atajo para ver el conjunto sin tener que
  // entrar grupo por grupo.
  box.appendChild(buildGroupViewCard(null, 'Todos los eventos', 'var(--accent)'));
  state.groups.forEach((g) => {
    box.appendChild(buildGroupViewCard(g.id, g.name, g.color));
  });
}

function buildGroupViewCard(id, name, color) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'group-card';
  const dot = document.createElement('span');
  dot.className = 'group-card-dot';
  dot.style.background = color || 'var(--accent)';
  const label = document.createElement('span');
  label.textContent = name;
  btn.append(dot, label);
  // En modo editar, tocar un grupo abre su ficha en vez de entrar
  // dentro. "Todos los eventos" no es un grupo de verdad, asi que ahi no
  // hay nada que editar y se queda apagado.
  if (groupsEditMode) {
    if (id === null) {
      btn.disabled = true;
    } else {
      btn.classList.add('is-editing');
      const lapiz = document.createElement('span');
      lapiz.className = 'group-card-edit-mark';
      lapiz.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
      btn.appendChild(lapiz);
      btn.addEventListener('click', () => openGroupModal(state.groups.find((g) => g.id === id)));
    }
    return btn;
  }
  // En la cabecera del detalle cabe poco: "Todos los eventos" se queda
  // en "Todos" ahi (en la tarjeta si va el texto entero).
  btn.addEventListener('click', () => openGroupDetail(id, id === null ? 'Todos' : name));
  return btn;
}

// Nivel 2: todo lo que hay dentro de un grupo (o de todos).
async function openGroupDetail(groupId, name) {
  groupsViewSelectedId = groupId;
  document.getElementById('groups-list-panel').classList.add('hidden');
  document.getElementById('groups-detail-panel').classList.remove('hidden');
  document.getElementById('btn-groups-back').classList.remove('hidden');
  document.getElementById('groups-view-title').textContent = name;
  // Se piden TODOS los eventos y tareas (sin rango de fechas): aqui la
  // pregunta es "que hay en este grupo", no "que hay este mes".
  groupsViewItems = await api('/api/events');
  renderGroupsDetailList();
}

// Un mismo sitio para decidir que entra y que no, para que el buscador y
// los dos filtros no se pisen entre ellos.
function groupsDetailVisibleItems() {
  const q = groupsViewFilters.q.trim().toLowerCase();
  return groupsViewItems.filter((item) => {
    if (groupsViewSelectedId !== null && item.groupId !== groupsViewSelectedId) return false;
    if (groupsViewFilters.type === 'task' && !item.isTask) return false;
    if (groupsViewFilters.type === 'event' && item.isTask) return false;
    if (groupsViewFilters.done === 'done' && !item.done) return false;
    if (groupsViewFilters.done === 'pending' && item.done) return false;
    if (q && !(item.title || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderGroupsDetailList() {
  const box = document.getElementById('groups-detail-list');
  box.innerHTML = '';
  const items = groupsDetailVisibleItems();
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No hay nada que coincida.';
    box.appendChild(empty);
    return;
  }
  items.forEach((item) => box.appendChild(buildGroupDetailRow(item)));
}

const GROUP_ITEM_EVENT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10.5 20a2 2 0 0 0 3 0"/></svg>';
// El icono de tarea es una tablilla con lineas (tipo lista de tareas) a
// proposito: el cuadrado con el check de antes se confundia con la propia
// casilla de "hecha" que lleva cada fila justo al lado.
const GROUP_ITEM_TASK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2.5" width="8" height="4" rx="1.2"/><path d="M8.5 4.5H6.5A1.5 1.5 0 0 0 5 6v13a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V6a1.5 1.5 0 0 0-1.5-1.5h-2"/><path d="M8.5 11.5h7"/><path d="M8.5 15.5h4.5"/></svg>';

function buildGroupDetailRow(item) {
  const row = document.createElement('div');
  row.className = 'group-item-row';
  if (item.done) row.classList.add('is-done');

  const bar = document.createElement('span');
  bar.className = 'group-item-bar';
  bar.style.background = item.groupColor || 'var(--border)';
  row.appendChild(bar);

  // Tareas Y recordatorios se pueden marcar como hechos desde aqui: la
  // columna "done" es de la fila del evento, la tenga o no marcada como
  // tarea, asi que vale para los dos.
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'styled-checkbox';
  check.checked = !!item.done;
  check.addEventListener('click', (e) => e.stopPropagation());
  check.addEventListener('change', async () => {
    await toggleTaskDone(item);
    item.done = !item.done;
    renderGroupsDetailList();
  });
  row.appendChild(check);

  // Icono propio por tipo: una campana para el recordatorio y un
  // cuadro con un tick para la tarea. El texto de debajo lo sigue
  // diciendo, pero de un vistazo se distinguen sin leer.
  const tipo = document.createElement('span');
  tipo.className = 'group-item-type';
  tipo.innerHTML = item.isTask ? GROUP_ITEM_TASK_ICON : GROUP_ITEM_EVENT_ICON;
  tipo.title = item.isTask ? 'Tarea' : 'Recordatorio';
  row.appendChild(tipo);

  const texts = document.createElement('div');
  texts.className = 'group-item-texts';
  const title = document.createElement('span');
  title.className = 'group-item-title';
  title.textContent = item.title;
  const meta = document.createElement('span');
  meta.className = 'group-item-meta';
  meta.textContent = groupItemMetaText(item);
  texts.append(title, meta);
  row.appendChild(texts);

  row.addEventListener('click', () => {
    if (item.isTask) openTaskModal(item);
    else openEventModal(item);
  });
  return row;
}

function groupItemMetaText(item) {
  const partes = [item.isTask ? 'Tarea' : 'Recordatorio'];
  if (item.groupName) partes.push(item.groupName);
  if (item.startAt) {
    const d = new Date(item.startAt);
    partes.push(item.allDay ? formatMobileDayHeading(d) : `${formatMobileDayHeading(d)} · ${toTimeInputValue(d)}`);
  } else if (item.isTask) {
    partes.push('Sin fecha');
  }
  return partes.join(' · ');
}

// ---------------------------------------------------------------------
// Ficha de un grupo (nombre, color, y el color con el que se ven sus
// tareas al completarse). Antes esto vivia en Configuracion -> Grupos;
// ahora la gestion es de este apartado, igual que cada herramienta
// gestiona lo suyo por dentro.
//
// Los dos selectores de color se crean PEREZOSAMENTE, la primera vez que
// se abre la ficha: createColorField vive en settings.js, que carga
// DESPUES de app.js -- crearlos aqui a nivel de modulo daria
// ReferenceError (mismo motivo por el que Finanzas hace lo mismo con los
// suyos, ver setupFinanzasIconColorFields).
// ---------------------------------------------------------------------
let groupColorField = null;
let groupCompletedColorField = null;
// El color de "completada" sigue al del grupo (atenuado) mientras no se
// toque a mano; en cuanto se elige uno explicito, deja de seguirle.
let groupCompletedColorTouched = false;
let suppressGroupCompletedTouch = false;

function setupGroupColorFields() {
  if (groupColorField) return;
  groupCompletedColorField = createColorField({
    initialValue: mutedTaskColor(DEFAULT_EVENT_COLOR),
    onChange: () => { if (!suppressGroupCompletedTouch) groupCompletedColorTouched = true; },
  });
  document.getElementById('group-completed-color-field').appendChild(groupCompletedColorField.element);
  groupColorField = createColorField({
    initialValue: DEFAULT_EVENT_COLOR,
    onChange: (nuevo) => {
      if (!groupCompletedColorTouched) setGroupCompletedColorProgrammatically(mutedTaskColor(nuevo));
    },
  });
  document.getElementById('group-color-field').appendChild(groupColorField.element);
}

// Cambia el color de completada SIN que cuente como que se ha tocado a
// mano (carga inicial, o cargar el valor guardado de un grupo).
function setGroupCompletedColorProgrammatically(hex) {
  suppressGroupCompletedTouch = true;
  groupCompletedColorField.setValue(hex);
  suppressGroupCompletedTouch = false;
}

function openGroupModal(group) {
  setupGroupColorFields();
  document.getElementById('group-modal-title').textContent = group ? 'Editar grupo' : 'Nuevo grupo';
  document.getElementById('group-id').value = group ? group.id : '';
  document.getElementById('group-name').value = group ? group.name : '';
  groupColorField.setValue(group ? group.color : DEFAULT_EVENT_COLOR);
  // Si el grupo ya tiene un color de completada EXPLICITO se trata como
  // "tocado", para que cambiar el color normal no se lo pise.
  groupCompletedColorTouched = !!(group && group.completedColor);
  setGroupCompletedColorProgrammatically(
    (group && group.completedColor) || mutedTaskColor(group ? group.color : DEFAULT_EVENT_COLOR),
  );
  document.getElementById('btn-delete-group').classList.toggle('hidden', !group);
  document.getElementById('group-modal').classList.remove('hidden');
  document.getElementById('group-name').focus();
}

function closeGroupModal() {
  document.getElementById('group-modal').classList.add('hidden');
}

// Todo lo que se ve del grupo (chips del calendario, recordatorios,
// tareas) cambia con el: se recarga lo que lo pinta, no solo la lista.
async function refreshAfterGroupChange() {
  await refreshGroupsView();
  loadMonth();
  loadReminders();
  loadTasks().then(renderTasksList);
}

document.getElementById('btn-groups-add').addEventListener('click', () => openGroupModal(null));
document.getElementById('btn-close-group').addEventListener('click', closeGroupModal);
document.getElementById('btn-cancel-group').addEventListener('click', closeGroupModal);

// Lapiz cuando no estas editando, tick cuando si -- sin esto no habia
// forma clara de salir del modo editar (el mismo boton lo cierra, pero
// no lo parecia).
const GROUPS_EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const GROUPS_DONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg>';

function refreshGroupsEditModeButton() {
  const btn = document.getElementById('btn-groups-edit-mode');
  btn.innerHTML = groupsEditMode ? GROUPS_DONE_ICON : GROUPS_EDIT_ICON;
  btn.classList.toggle('is-active', groupsEditMode);
  btn.setAttribute('aria-label', groupsEditMode ? 'Listo' : 'Editar grupos');
  btn.title = groupsEditMode ? 'Listo' : 'Editar grupos';
  // Crear un grupo nuevo mientras editas no tiene mucho sentido, y
  // ademas el "+" tapa al tick si estan los dos.
  document.getElementById('btn-groups-add').classList.toggle('hidden', groupsEditMode);
}

document.getElementById('btn-groups-edit-mode').addEventListener('click', () => {
  groupsEditMode = !groupsEditMode;
  refreshGroupsEditModeButton();
  renderGroupsViewList();
});

document.getElementById('group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('group-id').value;
  const payload = {
    name: document.getElementById('group-name').value,
    color: groupColorField.getValue(),
    completedColor: groupCompletedColorField.getValue(),
  };
  if (id) await api(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  else await api('/api/groups', { method: 'POST', body: JSON.stringify(payload) });
  closeGroupModal();
  await refreshAfterGroupChange();
});

document.getElementById('btn-delete-group').addEventListener('click', async () => {
  const id = document.getElementById('group-id').value;
  if (!id) return;
  const grupo = state.groups.find((g) => String(g.id) === String(id));
  const seguro = await showAppConfirm(
    `¿Eliminar el grupo "${grupo ? grupo.name : ''}"? Los eventos que lo usen se quedarán sin grupo.`,
  );
  if (!seguro) return;
  await api(`/api/groups/${id}`, { method: 'DELETE' });
  closeGroupModal();
  await refreshAfterGroupChange();
});

document.getElementById('btn-close-groups').addEventListener('click', closeGroupsView);
document.getElementById('btn-groups-back').addEventListener('click', () => {
  showGroupsList();
  renderGroupsViewList();
});
// Los dos accesos rapidos de la pantalla del calendario.
document.getElementById('btn-calendar-quick-today').addEventListener('click', () => {
  enterMobileDayView(new Date());
});
document.getElementById('btn-calendar-quick-groups').addEventListener('click', openGroupsView);

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
// local-schema.js), esto solo decide como se escribe/lee en pantalla. El
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
    list.innerHTML = '<p class="empty-hint">Todavía no tienes ejercicios. Se crean desde aquí o al añadirlos a una rutina/sesión.</p>';
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
    list.innerHTML = '<p class="empty-hint">Todavía no tienes rutinas. Crea una arriba.</p>';
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
    list.innerHTML = '<p class="empty-hint">Todavía no has registrado ninguna sesión.</p>';
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
// indentacion segun profundidad (espacio ideografico U+3000 repetido por
// nivel + prefijo "↳"). excludePortfolioId
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
    list.innerHTML = '<p class="empty-hint">Todavía no tienes cuentas. Crea una arriba.</p>';
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
    list.innerHTML = '<p class="empty-hint">Todavía no tienes carteras. Crea una arriba.</p>';
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
    list.innerHTML = '<p class="empty-hint">Todavía no tienes activos. Crea uno arriba.</p>';
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
    tbody.innerHTML = '<tr><td colspan="4" class="empty-hint">Sin actualizaciones de precio todavía.</td></tr>';
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
    wrap.innerHTML = '<p class="empty-hint">Sin actualizaciones de precio todavía.</p>';
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
      <p class="hint">Todavía solo hay una actualización registrada -- la gráfica de línea aparecera con la segunda.</p>`;
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
    container.innerHTML = '<p class="empty-hint">Todavía no has añadido ningun ejercicio.</p>';
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
    container.innerHTML = '<p class="empty-hint">Todavía no has añadido ningun ejercicio a esta sesión.</p>';
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
    container.innerHTML = '<p class="empty-hint">Todavía no hay sesiones registradas para este ejercicio.</p>';
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
    <svg viewBox="0 0 ${width} ${height}" class="gym-chart-svg" role="img" aria-label="Progreso de ${isVolume ? 'volumen' : 'peso máximo'}">
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" />
      ${dots}
      ${labels}
    </svg>
    <p class="hint">${isVolume ? 'Volumen (repeticiones × peso)' : 'Peso máximo'} por sesión, en ${unit}${isVolume ? ' (suma de todas las series)' : ''}. Pasa el ratón por un punto para ver la fecha exacta.</p>
  `;
  attachFinanzasChartTooltips(container.querySelector('svg'));
}

function renderFinanzasCategoriesList() {
  const list = document.getElementById('finanzas-categories-list');
  list.innerHTML = '';
  if (finanzasCategories.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavía no tienes categorías. Crea una arriba.</p>';
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
    wrap.innerHTML = '<p class="empty-hint">Todavía no tienes cuentas. Crealas en la pestaña Movimientos.</p>';
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
    wrap.innerHTML = '<p class="empty-hint">Sin datos todavía.</p>';
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
    breakdownList.innerHTML = '<p class="empty-hint">Sin gastos este mes todavía.</p>';
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
    tbody.innerHTML = '<tr><td colspan="7" class="empty-hint">Todavía no tienes gastos fijos. Crea uno arriba.</td></tr>';
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
//    debe a el (ver comentario junto a finanzas_debts en local-schema.js).
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
    tbody.innerHTML = '<tr><td colspan="2" class="empty-hint">Todavía no se ha generado ninguno.</td></tr>';
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
    tbody.innerHTML = '<tr><td colspan="8" class="empty-hint">Sin inversiones registradas todavía.</td></tr>';
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
    summaryTbody.innerHTML = '<tr><td colspan="6" class="empty-hint">Sin datos todavía.</td></tr>';
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
    wrap.innerHTML = '<p class="empty-hint">Todavía no tienes activos. Créalos en "Gestionar carteras y activos".</p>';
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
    wrap.innerHTML = '<p class="empty-hint">Sin datos todavía.</p>';
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
  setAssetImageSrc(img, att.url);
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
    setAssetImageSrc(img, mv.attachmentUrl);
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
// todos los items de todas las sagas (ver routes-local/lecturasItems.js).
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

applyUiStyle();

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
// Que boton de la barra de abajo le corresponde a cada pantalla. Las 4
// extensiones se cuentan como "Herramientas" (es de donde se entra),
// salvo la que este puesta en el hueco personalizable de la barra, que
// entonces se enciende ella misma.
function mobileNavSectionForScreen(screen) {
  if (screen === 'mobile-notes') return 'notes';
  if (screen === 'extensions') return 'extensions';
  if (['gym', 'lecturas', 'finanzas', 'viajes'].includes(screen)) {
    return getMobileNavNotesSlot() === screen ? 'notes' : 'extensions';
  }
  return 'calendar';
}

// Ademas de recordar la pantalla, deja encendido el boton que toca de la
// barra de abajo. Va aqui (y no solo en goToMobileSection) porque al
// ABRIR una pantalla por cualquier otro camino -- sobre todo al arrancar
// la app restaurando donde lo dejaste -- la barra se quedaba marcando
// "Calendario" aunque estuvieras en otro sitio.
function setCurrentScreen(screen) {
  localStorage.setItem('currentScreen', screen);
  refreshMobileNavActive(mobileNavSectionForScreen(screen));
}

async function initStep(fn) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
  }
}

async function init() {
  // La app abre SIEMPRE en el calendario, sin importar donde se cerro
  // (pedido explicito de Koku tras probarlo: reabrirla en Herramientas
  // no era lo que esperaba). currentScreen se sigue guardando, pero solo
  // para saber que boton de la barra de abajo encender mientras navegas.
  await initStep(loadGroups);
  await initStep(loadSpecialDays);
  await initStep(loadMonth);
  await initStep(loadReminders);
  await initStep(loadTasks);
  renderTasksList();
  await initStep(loadNoteFolders);
  await initStep(loadNotes);
  renderNotesView();

  // Los gastos fijos ya no los genera un proceso encendido las 24h en el
  // ordenador: se comprueba al abrir la app si toca generar el de este
  // periodo (ver public/finanzas-recurring.js).
  await initStep(generateDueRecurringExpenses);

  // Permiso de avisos: se pide AQUI, al abrir la app, no escondido en
  // Configuracion (pedido de Koku: "que no me tenga que ir hasta ahi la
  // primera vez, no seria intuitivo"). Solo la primera vez -- si ya se
  // pregunto una vez, no se vuelve a insistir nunca, se apaga o enciende
  // desde Configuracion > Este dispositivo como cualquier otro ajuste.
  await initStep(maybeAskNotificationPermissionOnStartup);

  // Y los avisos de los recordatorios se (re)programan en el propio
  // dispositivo, para que suenen aunque la app este cerrada (ver
  // public/local-notifications.js).
  await initStep(syncScheduledReminders);

  // Recordatorio discreto de copia de seguridad si hace mucho de la
  // ultima (ver public/backup.js) -- sin servidor, la copia es la unica
  // red de seguridad de los datos.
  await initStep(maybeShowBackupReminder);

  setInterval(loadReminders, 30 * 1000);
  // Igual que los recordatorios: si otro dispositivo vinculado anade o
  // completa una tarea, este se entera sin recargar la pagina.
  setInterval(() => loadTasks().then(renderTasksList), 30 * 1000);
  // Carpetas Y notas juntas (no cada una por su lado) para no repintar
  // la vista dos veces seguidas si las dos han cambiado a la vez.
  setInterval(() => Promise.all([loadNoteFolders(), loadNotes()]).then(() => {
    renderNotesView();
  }), 30 * 1000);
}

// Sin servidor no hay nada que vincular ni a quien preguntarle si esta
// version es la ultima: la app arranca directamente en el calendario,
// con su propia base de datos dentro del dispositivo.
init();
