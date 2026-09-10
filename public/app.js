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
  gymBlocks: [],
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
// `searchable`: anade un buscador dentro del desplegable. Se pide donde
// la lista puede crecer sin limite (los ejercicios del gimnasio, que son
// los que crea la persona mas los ~870 de la libreria) -- peticion de
// Koku: "si tengo muchos diferentes se hace un poco una odisea". No se
// enfoca solo a proposito: en el movil abrir el teclado nada mas
// desplegar tapa media lista, y muchas veces solo quieres mirar.
// Los popovers de los desplegables viven en el <body>, no dentro de su
// campo (si no, un modal con overflow los recortaria). El problema es que
// cuando el campo se repinta -- y las listas de ejercicios se repintan en
// cada cambio -- el campo viejo se va del DOM pero SU popover se queda en
// el body para siempre. Midiendolo salian 56 sueltos despues de un rato
// normal en el modal de una sesion, cada uno con su listener global.
//
// No rompia nada visible, pero es basura que crece sola. Se limpia al
// crear un campo nuevo (amortizado, sin tener que acordarse en ningun
// sitio): se tira el popover cuyo dueño YA ESTUVO en el documento y ya no
// esta. Lo de "ya estuvo" importa: un campo recien creado todavia no se
// ha insertado, y sin esa marca se barreria a si mismo.
function limpiarPopoversSueltos() {
  document.querySelectorAll('.select-popover').forEach((pop) => {
    const dueno = pop.duenoDelPopover;
    if (!dueno || !pop.estuvoEnElDom) return;
    if (!document.body.contains(dueno)) pop.remove();
  });
}

// La marca de "este campo llegó a estar en pantalla" se pone un ciclo
// DESPUÉS de crearlo, no dentro del barrido.
//
// Primer intento fallido, apuntado para no repetirlo: el barrido marcaba
// al pasar por encima, así que un campo creado y destruido ENTRE dos
// barridos no se marcaba nunca y se quedaba para siempre. Justo el caso
// normal (abrir el modal, cerrarlo, abrirlo otra vez). Medido: seguía
// creciendo de uno en uno.
//
// Un ciclo basta porque quien crea un campo lo mete en el DOM acto
// seguido. Si alguien no lo metiera, se queda sin marcar y no se barre
// nunca -- que es lo prudente: mejor dejar basura que tirar un campo vivo.
function marcarPopoverCuandoSeUse(popover, root) {
  setTimeout(() => { popover.estuvoEnElDom = document.body.contains(root); }, 0);
}

function createSelectField({ options = [], initialValue = '', placeholder = '', onChange, scrollToValue, searchable = false } = {}) {
  let value = initialValue;
  let opts = options;
  let busqueda = '';

  const root = document.createElement('div');
  root.className = 'select-field';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-field-trigger';

  const popover = document.createElement('div');
  popover.className = 'select-popover hidden';
  popover.duenoDelPopover = root;
  limpiarPopoversSueltos();
  document.body.appendChild(popover);
  marcarPopoverCuandoSeUse(popover, root);

  // El buscador y la lista son hermanos DENTRO del popover: renderOptions
  // repinta solo la lista, asi que escribir no destruye el campo (ni
  // pierde el foco ni el cursor a media palabra).
  let campoBusqueda = null;
  let listaOpciones = popover;
  if (searchable) {
    popover.classList.add('has-search');
    const cabecera = document.createElement('div');
    cabecera.className = 'select-popover-search';
    campoBusqueda = document.createElement('input');
    campoBusqueda.type = 'text';
    campoBusqueda.placeholder = 'Buscar...';
    campoBusqueda.autocomplete = 'off';
    cabecera.appendChild(campoBusqueda);
    popover.appendChild(cabecera);
    listaOpciones = document.createElement('div');
    listaOpciones.className = 'select-popover-list';
    popover.appendChild(listaOpciones);
    campoBusqueda.addEventListener('input', () => { busqueda = campoBusqueda.value; renderOptions(); });
    // Enter dentro del buscador no debe enviar el formulario que haya
    // alrededor (estos desplegables viven dentro de modales con <form>).
    campoBusqueda.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  }

  // Sin tildes y en minusculas, para que "biceps" encuentre "Bíceps".
  function normalizar(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function opcionesVisibles() {
    if (!searchable || !busqueda.trim()) return opts;
    // El .trim() importa: sin el, escribir solo espacios (el autocorrector
    // del movil los mete con facilidad) buscaria " " y dejaria la lista
    // vacia, como si no hubiera opciones.
    const q = normalizar(busqueda).trim();
    // `keywords` son palabras que NO se ven en la lista pero por las que
    // si se puede buscar (el musculo de un ejercicio, por ejemplo).
    return opts.filter((o) => normalizar(`${o.label} ${o.keywords || ''}`).includes(q));
  }

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
    listaOpciones.innerHTML = '';
    const visibles = opcionesVisibles();
    if (visibles.length === 0) {
      const vacio = document.createElement('p');
      vacio.className = 'select-popover-empty';
      vacio.textContent = 'Nada con ese nombre.';
      listaOpciones.appendChild(vacio);
      return;
    }
    visibles.forEach((opt) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-option' + (String(opt.value) === String(value) ? ' active' : '');
      item.dataset.value = opt.value;
      item.innerHTML = optionRowHtml(opt);
      item.addEventListener('click', () => {
        value = opt.value;
        renderTrigger();
        popover.classList.add('hidden');
        // El repintado va DESPUES de cerrar: si onChange rehace la lista
        // (pasa en las filas de ejercicio), repintar antes seria trabajo
        // tirado sobre un popover que ya no se ve.
        renderOptions();
        if (onChange) onChange(value);
      });
      listaOpciones.appendChild(item);
    });
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = popover.classList.contains('hidden');
    closeAllPopovers(popover);
    popover.classList.toggle('hidden');
    if (willOpen) {
      // Cada apertura empieza con la lista entera: un filtro heredado de
      // la vez anterior parece que faltan ejercicios.
      if (campoBusqueda) { busqueda = ''; campoBusqueda.value = ''; renderOptions(); }
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
  popover.duenoDelPopover = root;
  limpiarPopoversSueltos();
  document.body.appendChild(popover);
  marcarPopoverCuandoSeUse(popover, root);

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
// ---------------------------------------------------------------------
// Reloj de 12 o de 24 horas: se sigue al SISTEMA (peticion de Koku, que
// lo tiene en 24h: "hay gente que lo tiene en 12h, con am y pm, tenlo en
// cuenta"). No es un ajuste de la app a proposito -- si tu telefono
// esta en 12h es porque asi lo lees tu, y tener que repetirlo aqui
// sobra.
//
// Como se sabe: se le pregunta a Intl por el idioma del DISPOSITIVO
// (undefined = el suyo, no el nuestro) y se mira si su reloj es de 12.
// El idioma de los textos sigue siendo es-ES; lo unico que se toma
// prestado del sistema es esta decision.
function systemUses12hClock() {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 === true;
  } catch (err) {
    return false; // ante la duda, 24h
  }
}

const USES_12H_CLOCK = systemUses12hClock();

// hour12 se pasa EXPLICITO: sin el, 'es-ES' impone siempre 24h y daria
// igual como tenga el telefono quien mira la pantalla. Con reloj de 12,
// la hora va sin el cero delante ('numeric'), que es como se escribe:
// "9:00 a. m.", no "09:00 a. m.".
const TIME_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  hour: USES_12H_CLOCK ? 'numeric' : '2-digit',
  minute: '2-digit',
  hour12: USES_12H_CLOCK,
});

// Una hora en punto suelta (0-23) con el formato del sistema, para las
// etiquetas de la columna de horas de la vista diaria.
function formatHourLabel(hour) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return TIME_FORMATTER.format(d);
}

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

// ---------------------------------------------------------------------
// Eventos de VARIOS DIAS
//
// Un evento con fin en otro dia (un viaje del jueves 17 al domingo 20)
// tiene que verse en LOS CUATRO dias, no solo el que empieza. Antes cada
// vista filtraba por su cuenta con sameDay(inicio, dia), asi que el
// evento desaparecia a partir del segundo dia -- lo vio Koku con un
// "Viaje Mallorca". Estas dos funciones son ahora la unica fuente de
// verdad de "¿este evento sale este dia?" y "¿como lo ocupa?", y las usan
// todas las vistas (mes, año, tira de la semana y vista diaria).
//
// Ojo, hay dos mitades del arreglo y las dos hacen falta: esto es la de
// pintar; la de PEDIR los datos esta en public/routes-local/events.js
// (el filtro de rango pasa a ser de solape, si no el evento ni llega).
// ---------------------------------------------------------------------

// Principio y fin del dia local, para comparar sin liarse con las horas.
function dayBounds(date) {
  const inicio = new Date(date);
  inicio.setHours(0, 0, 0, 0);
  const fin = new Date(date);
  fin.setHours(23, 59, 59, 999);
  return { inicio, fin };
}

function eventOccursOnDay(ev, date) {
  if (!ev || !ev.startAt) return false;
  const start = new Date(ev.startAt);
  // Sin fin, un evento vive solo en su dia (lo de siempre).
  if (!ev.endAt) return sameDay(start, date);
  const end = new Date(ev.endAt);
  const { inicio, fin } = dayBounds(date);
  return start <= fin && end >= inicio;
}

// Como ocupa el evento ESE dia concreto. Devuelve null si no lo toca.
//  - 'unico'  : empieza y acaba el mismo dia (lo normal de siempre).
//  - 'inicio' : empieza aqui y sigue mañana.
//  - 'entero' : lo ocupa de punta a punta (ni empieza ni acaba aqui).
//  - 'fin'    : viene de ayer y acaba aqui.
// "entero" es el que Koku pidio tratar como TODO EL DIA: pintar un
// bloque de 00:00 a 24:00 tapa la pantalla entera y no dice nada que no
// diga una etiqueta arriba.
function eventDaySpan(ev, date) {
  if (!eventOccursOnDay(ev, date)) return null;
  if (!ev.endAt) return 'unico';
  const start = new Date(ev.startAt);
  const end = new Date(ev.endAt);
  const empiezaHoy = sameDay(start, date);
  const acabaHoy = sameDay(end, date);
  if (empiezaHoy && acabaHoy) return 'unico';
  if (empiezaHoy) return 'inicio';
  if (acabaHoy) return 'fin';
  return 'entero';
}

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
    'extensions-view', 'gym-view', 'gym-live-view', 'finanzas-view',
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
// dispositivo, encendido por defecto): con el apagado se salta TODO el
// movimiento de la app -- no solo el del calendario. Pedido de Koku
// para no gastar recursos cuando no se quieren.
//
// Funciona en DOS mitades, porque hay dos clases de animacion:
//  1. Las de CSS (@keyframes y transition:) -- las apaga una unica
//     regla global de styles.css que se activa con
//     data-animations="off" en el <html>. Al ser una sola regla, una
//     animacion NUEVA que se añada a la hoja de estilos el dia de
//     mañana ya nace obedeciendo al interruptor sin tocar nada.
//  2. Las que dispara el JavaScript a mano (poner una clase de
//     animacion, esperar un timeout, etc.) -- esas preguntan por
//     areAnimationsEnabled() antes de hacer nada.
function areAnimationsEnabled() {
  return localStorage.getItem('animationsEnabled') !== 'false';
}

// Pone/quita el atributo del <html> que dispara la regla global. El
// script de arranque de index.html ya lo hace antes de pintar (para que
// no se vea un trozo de animacion al abrir); esta funcion es la que usa
// el interruptor de Configuracion para cambiarlo en caliente.
function applyAnimationsPreference() {
  if (areAnimationsEnabled()) delete document.documentElement.dataset.animations;
  else document.documentElement.dataset.animations = 'off';
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
// centerOnly: los callbacks HORIZONTALES (onLeft/onRight) solo se
// disparan si el dedo empezo en el carril CENTRAL de la pantalla. Lo
// pidio Koku para la vista diaria: alli deslizar de lado cambia de dia,
// pero desde los BORDES tiene que cambiar de pestaña (ver el bloque
// "GESTOS DE NAVEGACION" al final de este archivo). Los verticales no
// se tocan: no compiten con nada.
function attachSwipe(el, { onUp, onDown, onLeft, onRight, threshold = 40, preserveVerticalScroll = false, centerOnly = false } = {}) {
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
    const inicioX = startX;
    startX = null;
    startY = null;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (Math.abs(dx) < threshold) return;
      // Carril lateral con centerOnly: el gesto no es para esta vista,
      // es para cambiar de pestaña -- se deja pasar sin hacer nada (de
      // eso ya se encarga el detector global de navegacion).
      if (centerOnly && isMobileEdgeZone(inicioX)) return;
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
// La hora que se ensena en un listado. Con "date" se sabe EN QUE DIA se
// esta pintando, que hace falta para los eventos de varios dias: de un
// viaje del jueves 20:00 al domingo 14:00, poner "20:00-14:00" los
// cuatro dias no dice nada. Asi se ve de un vistazo si el evento
// empieza, sigue o acaba ese dia:
//   jueves  -> "20:00 →"   (empieza y sigue)
//   viernes -> "Todo el día"
//   sabado  -> "Todo el día"
//   domingo -> "→ 14:00"   (viene de antes y acaba)
// Sin "date" se comporta como siempre (rango completo), que es lo que
// vale para una lista que no es de un dia concreto.
function formatMobileEventTimeRange(ev, date) {
  if (ev.allDay) return 'Todo el día';
  const start = TIME_FORMATTER.format(new Date(ev.startAt));
  if (!ev.endAt) return start;
  const end = TIME_FORMATTER.format(new Date(ev.endAt));
  const tramo = date ? eventDaySpan(ev, date) : 'unico';
  if (tramo === 'entero') return 'Todo el día';
  if (tramo === 'inicio') return `${start} →`;
  if (tramo === 'fin') return `→ ${end}`;
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

    const dayEvents = state.events.filter((ev) => eventOccursOnDay(ev, cellDate));
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
    time.textContent = formatMobileEventTimeRange(ev, state.mobileCalendarListDate);
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
      if (yearViewEvents.some((ev) => eventOccursOnDay(ev, cellDate))) {
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
  // Si esta misma capa estaba a mitad de IRSE y ahora vuelve a entrar
  // (has deslizado dos veces seguidas muy rapido), se cancela lo suyo:
  // si no, la limpieza de la salida la volveria a ocultar a media
  // entrada. Ver playMobileSwipeOut.
  el.classList.remove('mobile-swipe-out-left', 'mobile-swipe-out-right');
  delete el.dataset.reocultarTrasSalir;
  void el.offsetWidth;
  el.classList.add(cls);
  const cleanup = () => el.classList.remove(cls);
  el.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, 300);
}

// La otra mitad del carrusel: la pantalla que se VA, viajando al mismo
// tiempo que entra la nueva.
//
// El detalle que lo complica: para cuando se llama a esto, la capa que
// se va YA se ha ocultado (los botones de cerrar le ponen .hidden). Hay
// que volver a enseñarla los 280ms del viaje y ocultarla otra vez al
// acabar. Se hace quitando y reponiendo la clase .hidden en vez de
// forzar un display por CSS, porque cada capa tiene el suyo (las
// pantallas completas son flex, no block) y forzarlo las descuadraria.
function playMobileSwipeOut(el, direction) {
  if (!el || !areAnimationsEnabled()) return;
  const cls = `mobile-swipe-out-${direction}`;
  const estabaOculta = el.classList.contains('hidden');
  if (estabaOculta) {
    el.classList.remove('hidden');
    el.dataset.reocultarTrasSalir = '1';
  }
  el.classList.remove('mobile-swipe-out-left', 'mobile-swipe-out-right');
  void el.offsetWidth;
  el.classList.add(cls);
  const cleanup = () => {
    el.classList.remove(cls);
    // Solo se vuelve a ocultar si nadie ha cancelado la salida por el
    // camino (ver playMobileSwipeTransition).
    if (el.dataset.reocultarTrasSalir === '1') {
      delete el.dataset.reocultarTrasSalir;
      el.classList.add('hidden');
    }
  };
  el.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, 400);
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
    if (!weekEvents.some((ev) => eventOccursOnDay(ev, d))) dot.classList.add('is-empty');

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

  // Arriba, en la fila de "todo el dia", van dos cosas: los eventos
  // marcados como de todo el dia, y los de VARIOS DIAS en los dias que
  // ocupan de punta a punta (el viernes y el sabado de un viaje que va
  // del jueves al domingo). Peticion de Koku: "si ocupa el dia entero,
  // que se marque como todo el dia esos dias, para no tapar toda la
  // pantalla" -- y tiene razon, un bloque de 00:00 a 24:00 llena la
  // vista sin decir nada que no diga ya esta etiqueta.
  // Arriba van los que ocupan el dia entero Y TAMBIEN el ULTIMO dia de
  // un evento largo (decision de Koku sobre el domingo de un viaje que
  // empieza el jueves: "me parece bien, que aparezca en la seccion de
  // dia entero"). Un bloque de medianoche a las 14:00 se come casi toda
  // la pantalla para decir algo que la etiqueta dice mejor.
  //
  // OJO, esto es SOLO como se pinta: el evento sigue guardado con su
  // hora de fin de verdad, no se convierte en "todo el dia" (lo pidio
  // expresamente: "que se quede guardado que la hora es la que aparece
  // puesta"). Por eso la etiqueta enseña "→ 14:00" y no un simple
  // "Todo el dia": la hora sigue estando y se ve.
  //
  // El PRIMER dia se queda como bloque a proposito: empezar a las 20:00
  // son cuatro horas de alto, no molesta, y ver donde arranca dentro
  // del dia si aporta.
  const allDayEvents = dayEvents.filter((ev) => {
    if (ev.allDay) return true;
    const tramo = eventDaySpan(ev, date);
    return tramo === 'entero' || tramo === 'fin';
  });
  allDayRow.classList.toggle('hidden', allDayEvents.length === 0);
  allDayEvents.forEach((ev) => {
    const chip = document.createElement('div');
    chip.className = 'mobile-day-allday-chip';
    chip.style.backgroundColor = ev.isTask ? (ev.done ? taskCompletedColor(ev) : taskPendingColor(ev)) : (ev.groupColor || DEFAULT_EVENT_COLOR);
    // En el ultimo dia se añade la hora a la que acaba; en el resto, el
    // titulo a secas (que ya se entiende como "todo el dia").
    const tramo = eventDaySpan(ev, date);
    chip.textContent = tramo === 'fin'
      ? `${ev.title} · ${formatMobileEventTimeRange(ev, date)}`
      : ev.title;
    chip.addEventListener('click', () => (ev.isTask ? openTaskModal(ev) : openEventModal(ev)));
    allDayRow.appendChild(chip);
  });

  for (let h = 0; h < 24; h++) {
    const row = document.createElement('div');
    row.className = 'mobile-hour-row';
    row.style.top = `${h * 60}px`;
    const label = document.createElement('div');
    label.className = 'mobile-hour-label';
    label.textContent = formatHourLabel(h);
    row.appendChild(label);
    grid.appendChild(row);
  }

  const timed = dayEvents
    // Fuera los de todo el dia y los que ya se han puesto arriba por
    // ocupar este dia entero (ver allDayEvents).
    // Fuera los que ya se han puesto arriba (ver allDayEvents): los de
    // todo el dia, los que ocupan este dia entero y el ultimo dia de un
    // evento largo.
    .filter((ev) => !ev.allDay && ev.startAt && !['entero', 'fin'].includes(eventDaySpan(ev, date)))
    .map((ev) => {
      // El bloque se RECORTA a este dia: de un viaje que empieza el
      // jueves a las 20:00 y acaba el domingo a las 14:00, el jueves se
      // pinta de 20:00 a medianoche y el domingo de medianoche a las
      // 14:00. Antes solo se recortaba el final; el principio daba por
      // hecho que el evento empezaba hoy, asi que en el ultimo dia
      // habria salido a la hora de INICIO del primero.
      const start = new Date(ev.startAt);
      const startMin = sameDay(start, date) ? start.getHours() * 60 + start.getMinutes() : 0;
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

function buildMobileListadoRow(ev, date) {
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
  time.textContent = formatMobileEventTimeRange(ev, date);
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
    // Un evento de varios dias se apunta en TODOS los que ocupa, no solo
    // en el que empieza -- misma correccion que en el resto de vistas
    // (ver eventOccursOnDay). El tope de 366 dias es una red de
    // seguridad boba: si alguna vez se cuela un evento con un fin
    // absurdo (un año 3000 por un dedazo), que no se coma la memoria
    // generando un dia por cada jornada hasta entonces.
    const inicio = new Date(ev.startAt);
    const fin = ev.endAt ? new Date(ev.endAt) : inicio;
    const dia = new Date(inicio);
    dia.setHours(0, 0, 0, 0);
    for (let n = 0; n <= 366 && dia <= fin; n++) {
      const key = toDateKey(dia);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(ev);
      dia.setDate(dia.getDate() + 1);
    }
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
    day.events.forEach((ev) => block.appendChild(buildMobileListadoRow(ev, day.date)));
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
  // Solo cambia de dia si el dedo empieza por el CENTRO: desde los
  // bordes, el mismo gesto cambia de pestaña de la barra de abajo
  // (peticion de Koku -- ver "GESTOS DE NAVEGACION" al final).
  centerOnly: true,
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
// Con cuanta antelacion avisar. Los cuatro ultimos (de 2 dias a 2
// semanas) los pidio Koku para lo que se prepara con tiempo: un viaje,
// una renovacion, un cumpleaños. El tope son 2 semanas porque el mismo
// lo puso ahi ("hasta 2 semanas antes, eso es suficiente").
//
// El valor son MINUTOS y viaja tal cual hasta la base y hasta el aviso
// del sistema; no hay ningun tope escondido en medio, asi que anadir un
// valor nuevo a esta lista es todo lo que hace falta.
const REMINDER_OPTIONS = [
  { value: '', label: 'Sin recordatorio' },
  { value: '0', label: 'En el momento' },
  { value: '10', label: '10 minutos antes' },
  { value: '30', label: '30 minutos antes' },
  { value: '60', label: '1 hora antes' },
  { value: '1440', label: '1 día antes' },
  { value: '2880', label: '2 días antes' },
  { value: '4320', label: '3 días antes' },
  { value: '10080', label: '1 semana antes' },
  { value: '20160', label: '2 semanas antes' },
];
const eventReminderField = createSelectField({ options: REMINDER_OPTIONS, initialValue: '0' });
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
// Interpreta los digitos que se van tecleando en un campo de hora. Los
// dos ultimos son SIEMPRE los minutos y lo de delante la hora, asi que
// "930" es 9:30 y "0930" tambien.
//
// pm/am: en reloj de 12 horas el campo solo acepta 1-12, y quien decide
// si es de la mañana o de la tarde es el selector de al lado (peticion
// de Koku: "que haya un selector de am y pm, asi mantenemos el bloque
// con entrada de numeros unicamente"). El "value" que sale de aqui es
// SIEMPRE de 24 horas -- el resto de la app trabaja solo con eso, el
// formato de 12 vive unicamente en lo que se ve.
function parseTimeFieldDigits(digits, { doce = false, pm = false } = {}) {
  if (digits.length === 0) return { formatted: '', complete: false, valid: false, value: null };
  const formatted = digits.length > 2 ? `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}` : digits;
  if (digits.length < 3) return { formatted, complete: false, valid: false, value: null };
  const h = Number(digits.slice(0, digits.length - 2));
  const mi = Number(digits.slice(-2));
  const ok = doce ? (h >= 1 && h <= 12 && mi <= 59) : (h <= 23 && mi <= 59);
  if (!ok) return { formatted, complete: true, valid: false, value: null };
  const h24 = doce ? hour12To24(h, pm) : h;
  return {
    formatted,
    complete: true,
    valid: true,
    value: `${String(h24).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
  };
}

// Las dos conversiones entre el reloj de 24 y el de 12. Los unicos casos
// que se escapan de "sumar o restar 12" son las 12 de la noche (0h se
// escribe 12 AM) y las 12 del mediodia (12h se queda en 12 PM).
function hour12To24(h12, pm) {
  if (pm) return h12 === 12 ? 12 : h12 + 12;
  return h12 === 12 ? 0 : h12;
}

function hour24To12(h24) {
  const pm = h24 >= 12;
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h12, pm };
}

// Campo de hora: se escribe con NUMEROS y nada mas (sin desplegables de
// hora/minuto ni el selector nativo, que no sigue el tema -- ver la
// regla de CLAUDE.md). Los dos ultimos digitos son los minutos, asi que
// "930" ya es 9:30.
//
// Con el telefono en reloj de 12 horas aparece ademas un selector AM/PM
// al lado (peticion de Koku: "si es 12h, que haya un selector de am y
// pm, asi mantenemos el bloque con entrada de numeros unicamente"). El
// campo pasa a aceptar 1-12 y de la mañana/tarde se encarga el selector.
//
// IMPORTANTE: hacia fuera este componente habla SIEMPRE en 24 horas
// ("HH:MM"), tanto en getValue() como en setValue(). El reloj de 12 vive
// solo en lo que se ve, asi que nada del resto de la app (guardar,
// comparar, combineDateAndTime...) tuvo que cambiar.
function createTimeField({ initialValue = '09:00' } = {}) {
  let value = initialValue; // ultimo valor VALIDO conocido, en 24h
  let valid = true;
  const doce = USES_12H_CLOCK;
  let pm = false;

  const root = document.createElement('div');
  root.className = 'time-field';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'time-field-input';
  input.placeholder = doce ? 'H:MM' : 'HH:MM';
  input.inputMode = 'numeric';

  // El selector AM/PM: dos botones tipo interruptor. Solo existe en
  // reloj de 12 -- en 24 horas no pinta nada y ni se crea.
  const ampm = document.createElement('div');
  ampm.className = 'time-field-ampm';
  const btnAm = document.createElement('button');
  const btnPm = document.createElement('button');
  [btnAm, btnPm].forEach((b) => { b.type = 'button'; b.className = 'time-field-ampm-btn'; });
  btnAm.textContent = 'AM';
  btnPm.textContent = 'PM';

  function pintarAmPm() {
    btnAm.classList.toggle('is-active', !pm);
    btnPm.classList.toggle('is-active', pm);
    btnAm.setAttribute('aria-pressed', String(!pm));
    btnPm.setAttribute('aria-pressed', String(pm));
  }

  // Lo que se ENSEÑA en el input a partir del valor de 24h guardado.
  function pintarInput() {
    if (!doce) {
      input.value = value;
      return;
    }
    const [h24, mi] = value.split(':').map(Number);
    const { h12, pm: esPm } = hour24To12(h24);
    pm = esPm;
    input.value = `${h12}:${String(mi).padStart(2, '0')}`;
    pintarAmPm();
  }

  // Relee lo escrito y actualiza el valor guardado. Se llama al teclear
  // y tambien al tocar AM/PM, porque cambiar de mitad del dia cambia la
  // hora real sin que se haya tocado ni un numero.
  function releer() {
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    const result = parseTimeFieldDigits(digits, { doce, pm });
    if (result.complete && result.valid) {
      value = result.value;
      valid = true;
    } else {
      // Incompleto (1-2 digitos, todavia escribiendo la hora) o fuera
      // de rango -- en los dos casos getValue() no debe devolver nada
      // hasta que se complete/corrija, para no guardar algo a medias.
      valid = false;
    }
    return result;
  }

  // Autocompleta el ":" MIENTRAS SE ESCRIBE (no solo al perder el foco)
  // y valida en tiempo real -- antes solo se normalizaba en "change"
  // (al perder el foco), asi que si se guardaba con Ctrl+Intro con el
  // foco todavia en este campo, form.requestSubmit() no dispara "change"
  // por si solo y lo escrito se perdia en silencio, mandandose el valor
  // VIEJO sin ningun aviso.
  input.addEventListener('input', () => {
    const result = releer();
    input.value = result.formatted;
    input.setSelectionRange(input.value.length, input.value.length);
    // Solo se pinta en rojo cuando ya hay info de sobra para saber que
    // esta MAL (3-4 digitos fuera de rango) -- con 0-2 digitos se sigue
    // escribiendo, no es un error todavia.
    input.classList.toggle('is-invalid', result.complete && !result.valid);
  });

  input.addEventListener('blur', () => {
    const result = releer();
    if (!result.complete || !result.valid) {
      // Al perder el foco con algo a medias o invalido, se marca en
      // rojo de verdad (mientras se escribe 1-2 digitos no se marca,
      // pero si te vas de ahi sin terminar, ya cuenta como error).
      valid = false;
      input.classList.add('is-invalid');
    }
  });

  root.appendChild(input);
  if (doce) {
    btnAm.addEventListener('click', () => { pm = false; pintarAmPm(); releer(); });
    btnPm.addEventListener('click', () => { pm = true; pintarAmPm(); releer(); });
    ampm.append(btnAm, btnPm);
    root.appendChild(ampm);
  }
  pintarInput();

  return {
    element: root,
    // Devuelve el ultimo valor VALIDO conocido (en 24h), o null si el
    // campo esta ahora mismo en un estado invalido/incompleto -- nunca
    // un valor inventado o desactualizado.
    getValue: () => (valid ? value : null),
    isValid: () => valid,
    setValue: (v) => {
      value = v;
      valid = true;
      input.classList.remove('is-invalid');
      pintarInput();
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
// Hora en punto MAS CERCANA a la de ahora: a las 17:05 propone 17:00, y
// a las 9:37 propone las 10:00 (con la hora de fin, que ya suma una
// hora, quedan 17:00-18:00 y 10:00-11:00). Antes solo redondeaba hacia
// abajo, asi que a las 9:37 proponia 9:00 -- por eso parecia que "unas
// veces si y otras no": con los minutos por debajo de la media hora
// coincidia con lo esperado, y por encima no.
// Ojo: a partir de las 23:30 esto salta al dia siguiente a las 00:00, y
// es lo correcto -- el campo de fecha se rellena desde esta misma fecha,
// asi que la fecha propuesta pasa a ser manana sola.
function roundToNearestHour(date) {
  const rounded = new Date(date);
  if (rounded.getMinutes() >= 30) rounded.setHours(rounded.getHours() + 1);
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
  // Hora propuesta: SIEMPRE la hora en punto mas cercana a la de ahora,
  // venga de donde venga el evento nuevo. La hora de fin se calcula mas
  // abajo como inicio + 1h, asi que a las 7:59 sale 8:00-9:00.
  //
  // Antes, si el evento se creaba desde un DIA concreto (el "+" de la
  // vista diaria), esta rama plantaba las 9:00 fijas -- daba igual la
  // hora que fuera. Eso es lo que Koku vio a las 7:59: le proponia
  // 9:00-10:00 en vez de 8:00-9:00. Ahora la fecha sale del dia que
  // eligio y la HORA del reloj, que es lo que pidio ("que te marque la
  // hora mas cercana de inicio y la final recomendada sea +1h de esa").
  const ahora = roundToNearestHour(new Date());
  let defaultStart = ahora;
  if (presetDate) {
    defaultStart = new Date(presetDate);
    defaultStart.setHours(ahora.getHours(), 0, 0, 0);
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
  // Uno NUEVO nace con "En el momento" puesto (pedido de Koku: crear un
  // recordatorio y que no avise no tiene sentido como caso por defecto).
  // Uno YA GUARDADO respeta lo que tenga, incluido "Sin recordatorio" si
  // se quito a mano -- eso es una eleccion suya, no un valor por defecto.
  eventReminderField.setValue(event
    ? (event.reminderMinutesBefore !== null && event.reminderMinutesBefore !== undefined
      ? String(event.reminderMinutesBefore)
      : '')
    : '0');
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


// ---------------------------------------------------------------------
// FÓRMULAS EN LAS NOTAS
//
// Peticion de Koku: "me gustaria que en notas hubiera una especie de
// formulas, tanto dentro como fuera de las tablas". De las tres formas
// que se le ofrecieron eligio la de CALCULOS SUELTOS, SIN REFERENCIAS:
// escribes =12*3+5 en cualquier sitio (un parrafo o una celda de tabla)
// y te da el resultado. NO sabe de celdas (=B2*C2) ni se recalcula solo
// si cambias otra casilla -- eso era la opcion de hoja de calculo, y la
// descarto.
//
// Cuatro decisiones de como esta hecho:
//
// 1. El resultado se escribe DETRAS, no en lugar de la formula:
//    "=12*3+5" pasa a ser "=12*3+5 → 41". Asi se sigue viendo la cuenta
//    (que es media gracia de tenerla en una nota) y, sobre todo, se
//    puede corregir un numero y volver a calcular: al recalcular se tira
//    el "→ ..." viejo y se pone el nuevo.
// 2. Es TEXTO PLANO, sin ninguna etiqueta nueva. El saneador del cuerpo
//    de la nota (sanitizeNoteBody) trabaja con una lista blanca de
//    etiquetas, asi que una etiqueta propia habria que darla de alta ahi
//    y en el import/export; el texto pasa por todo eso sin tocar nada.
// 3. NUNCA se usa eval(). El analizador esta escrito a mano (descenso
//    recursivo, ~40 lineas) y solo entiende numeros y + - * / ^ ( ) %.
//    Meter eval() en algo que se guarda y se vuelve a abrir es abrir la
//    puerta a que un texto cualquiera ejecute codigo.
// 4. Hace falta un OPERADOR para que algo cuente como formula. Sin esa
//    regla, una frase normal como "el total = 100 euros" se leeria como
//    la formula "= 100" y se le pegaria un "→ 100" detras.
//
// Se dispara de tres formas, y las tres hacen lo mismo:
//  - el boton "=" de la barra del editor (la unica que existe en el
//    movil: el teclado del iPhone no tiene tecla Tab),
//  - Intro con el cursor justo al final de una formula,
//  - Tab con el cursor justo al final de una formula (escritorio).
// ---------------------------------------------------------------------

// Una formula dentro de un texto: "=" + cuenta + (opcional) el "→ 41"
// de un calculo anterior. El ultimo caracter de la cuenta tiene que ser
// un digito, un ")" o un "%", para no tragarse los espacios de despues.
// La flecha NO esta en la lista de caracteres permitidos, y por eso el
// resultado viejo no se confunde con parte de la cuenta.
const RE_NOTE_FORMULA = /=[\s0-9+\-*/^().,%€$£¥]*[0-9)%](?:\s*→\s*-?[\d.,]+)?/g;
const RE_NOTE_FORMULA_OPERADOR = /[+\-*/^%]/;

// "1.234,5" -> 1234.5 y "12,5" -> 12.5. Misma convencion que
// gymNormalizarPeso: si hay coma, la coma manda y los puntos son
// separadores de millar; si no hay coma, el punto es el decimal.
function numeroDeNotaANumero(bruto) {
  const limpio = bruto.includes(',')
    ? bruto.replace(/\./g, '').replace(',', '.')
    : bruto;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

// Analizador de descenso recursivo. Devuelve un numero, o null si la
// cuenta no se entiende (y entonces la formula se queda tal cual, sin
// resultado: mas vale no escribir nada que escribir una mentira).
//
//   expr   := term (('+'|'-') term)*
//   term   := factor (('*'|'/') factor)*
//   factor := unario ('^' factor)?        <- la potencia asocia a la derecha
//   unario := ('-'|'+')? primario
//   primario := numero '%'? | '(' expr ')' '%'?
function evaluarExpresionDeNota(texto) {
  try {
    return analizarExpresionDeNota(texto);
  } catch {
    // Una cuenta con MUCHOS parentesis anidados agota la pila (el
    // analizador es recursivo). Es un caso absurdo, pero un texto
    // cualquiera puede acabar en una nota: mejor "no se entiende" que
    // una excepcion que se lleve por delante el guardado de la nota.
    return null;
  }
}

function analizarExpresionDeNota(texto) {
  let i = 0;
  const s = texto;
  const saltarHueco = () => {
    while (i < s.length && /[\s€$£¥]/.test(s[i])) i++;
  };
  const primario = () => {
    saltarHueco();
    let valor;
    if (s[i] === '(') {
      i++;
      valor = expr();
      saltarHueco();
      if (s[i] !== ')') return null;
      i++;
    } else {
      const inicio = i;
      while (i < s.length && /[\d.,]/.test(s[i])) i++;
      if (i === inicio) return null;
      valor = numeroDeNotaANumero(s.slice(inicio, i));
    }
    if (valor === null) return null;
    saltarHueco();
    // "%" pegado detras = dividir entre 100 (20% -> 0.2). Se deja como
    // sufijo y no como "el 20% de lo de al lado" a proposito: eso ultimo
    // significa una cosa en "120+20%" y otra en "120*20%", y adivinar
    // cual quieres es justo lo que no debe hacer una calculadora.
    while (s[i] === '%') { valor /= 100; i++; saltarHueco(); }
    return valor;
  };
  const unario = () => {
    saltarHueco();
    if (s[i] === '-') { i++; const v = unario(); return v === null ? null : -v; }
    if (s[i] === '+') { i++; return unario(); }
    return primario();
  };
  const factor = () => {
    const base = unario();
    if (base === null) return null;
    saltarHueco();
    if (s[i] === '^') {
      i++;
      const exp = factor();
      if (exp === null) return null;
      return base ** exp;
    }
    return base;
  };
  const term = () => {
    let valor = factor();
    if (valor === null) return null;
    for (;;) {
      saltarHueco();
      const op = s[i];
      if (op !== '*' && op !== '/') return valor;
      i++;
      const otro = factor();
      if (otro === null) return null;
      if (op === '/' && otro === 0) return null; // dividir entre cero no es un resultado
      valor = op === '*' ? valor * otro : valor / otro;
    }
  };
  const expr = () => {
    let valor = term();
    if (valor === null) return null;
    for (;;) {
      saltarHueco();
      const op = s[i];
      if (op !== '+' && op !== '-') return valor;
      i++;
      const otro = term();
      if (otro === null) return null;
      valor = op === '+' ? valor + otro : valor - otro;
    }
  };
  const resultado = expr();
  saltarHueco();
  // Sobra texto sin analizar -> la cuenta no era valida entera.
  if (i !== s.length) return null;
  return resultado !== null && Number.isFinite(resultado) ? resultado : null;
}

// El resultado, en el formato de numeros de aqui (coma decimal, punto de
// millar). Seis decimales de tope: mas es ruido, y menos se queda corto
// en una division.
const NOTE_FORMULA_FORMATTER = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 6 });

// Reescribe UNA formula ya encontrada. Devuelve el texto nuevo, o null si
// no hay nada que calcular (sin operador, o cuenta invalida).
function recalcularFormulaDeNota(trozo) {
  // Fuera el "→ ..." de un calculo anterior, si lo hubiera.
  const cuenta = trozo.replace(/\s*→\s*-?[\d.,]+\s*$/, '').replace(/^=/, '');
  if (!RE_NOTE_FORMULA_OPERADOR.test(cuenta)) return null;
  const valor = evaluarExpresionDeNota(cuenta);
  if (valor === null) return null;
  return `=${cuenta.replace(/\s+$/, '')} → ${NOTE_FORMULA_FORMATTER.format(valor)}`;
}

// Un bloque de codigo es texto literal: ahi no se calcula nada.
function estaDentroDeCodigo(nodo) {
  for (let el = nodo.parentElement; el && el !== NOTE_EDITOR_BODY; el = el.parentElement) {
    if (el.tagName === 'PRE' || el.tagName === 'CODE') return true;
  }
  return false;
}

// La formula que contiene (o toca) el cursor, si la hay.
function formulaEnElCursorDeNota() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const nodo = sel.focusNode;
  if (!nodo || nodo.nodeType !== Node.TEXT_NODE) return null;
  if (!NOTE_EDITOR_BODY.contains(nodo) || estaDentroDeCodigo(nodo)) return null;
  const offset = sel.focusOffset;
  RE_NOTE_FORMULA.lastIndex = 0;
  let m;
  while ((m = RE_NOTE_FORMULA.exec(nodo.nodeValue)) !== null) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      return { nodo, indice: m.index, largo: m[0].length, trozo: m[0] };
    }
  }
  return null;
}

// Calcula la del cursor y deja el cursor detras del resultado. true si
// de verdad calculo algo.
function calcularFormulaEnElCursor() {
  const enc = formulaEnElCursorDeNota();
  if (!enc) return false;
  const nuevo = recalcularFormulaDeNota(enc.trozo);
  if (nuevo === null) return false;
  const txt = enc.nodo.nodeValue;
  enc.nodo.nodeValue = txt.slice(0, enc.indice) + nuevo + txt.slice(enc.indice + enc.largo);
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(enc.nodo, enc.indice + nuevo.length);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

// Todas las de la nota. Es lo que hace el boton cuando el cursor no esta
// dentro de ninguna: sirve de "recalcular la nota entera" despues de
// cambiar varios numeros.
function calcularTodasLasFormulasDeNota() {
  const walker = document.createTreeWalker(NOTE_EDITOR_BODY, NodeFilter.SHOW_TEXT);
  const nodos = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!estaDentroDeCodigo(n)) nodos.push(n);
  }
  let cuantas = 0;
  nodos.forEach((n) => {
    const nuevo = n.nodeValue.replace(RE_NOTE_FORMULA, (trozo) => {
      const calc = recalcularFormulaDeNota(trozo);
      if (calc === null) return trozo;
      cuantas += 1;
      return calc;
    });
    if (nuevo !== n.nodeValue) n.nodeValue = nuevo;
  });
  return cuantas;
}

// ¿El cursor esta JUSTO al final de una formula? Es la condicion para que
// Intro/Tab calculen en vez de hacer lo suyo de siempre: asi solo se
// meten cuando esta clarisimo que es lo que quieres, y en cualquier otro
// sitio del texto Intro sigue siendo Intro.
function cursorAlFinalDeUnaFormula() {
  const enc = formulaEnElCursorDeNota();
  if (!enc) return false;
  const sel = window.getSelection();
  if (sel.focusOffset !== enc.indice + enc.largo) return false;
  return recalcularFormulaDeNota(enc.trozo) !== null;
}

document.getElementById('note-formula-btn').addEventListener('mousedown', (e) => e.preventDefault());
document.getElementById('note-formula-btn').addEventListener('click', () => {
  // Mismo patron que Tabla/Codigo: si el editor perdio el foco al tocar
  // el boton, se recupera la seleccion guardada.
  saveNoteEditorSelection();
  restoreNoteEditorSelection();
  if (calcularFormulaEnElCursor()) {
    refreshNoteEditorState();
    return;
  }
  const cuantas = calcularTodasLasFormulasDeNota();
  if (cuantas === 0) {
    mostrarAvisoFlotante('Escribe una cuenta con "=" (por ejemplo =12*3+5) y vuelve a tocar este botón.');
  }
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
  // Intro / Tab con el cursor justo al final de una cuenta la CALCULAN
  // en vez de hacer lo suyo. Va lo primero porque la condicion es muy
  // estrecha (tiene que haber una formula valida acabando exactamente
  // ahi), asi que no le puede quitar el turno a nada por accidente.
  if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    if (cursorAlFinalDeUnaFormula() && calcularFormulaEnElCursor()) {
      e.preventDefault();
      refreshNoteEditorState();
      return;
    }
  }
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

// ---------------------------------------------------------------------
// El teclado del movil y las pantallas completas
// ---------------------------------------------------------------------
// Mismo problema que ya se arreglo en el editor de notas, pero en TODAS
// las demas pantallas completas (Gimnasio, Viajes, Finanzas, el listado
// de Notas...). Lo vio Koku escribiendo en el buscador de ejercicios:
// "me deja moverme todo hasta abajo y ver la barra de estado estando el
// teclado en la pantalla".
//
// La causa es la de siempre: con el teclado abierto el telefono NO
// encoge la ventana, la deja igual de alta y tapa la parte de abajo. Una
// capa `position: fixed; inset: 0` (que es lo que son todas las
// .my-space-view) sigue midiendo la ventana ENTERA, asi que su mitad
// inferior queda debajo del teclado y el sistema deja arrastrar la vista
// entera para llegar a ella -- arrastrando de paso la barra de estado a
// la vista.
//
// La cura es la misma: mientras haya un campo de texto enfocado dentro
// de una de esas capas, se le da el alto y el desplazamiento REALES que
// dice visualViewport, y se deja la pagina quieta. Asi no queda nada
// fuera y no hay nada que arrastrar.
//
// El editor de notas NO pasa por aqui: tiene su propio anclaje, que
// ademas mueve el cursor para que no lo tape el teclado (start/
// stopNoteEditorViewportAnchor). Dos anclajes sobre la misma capa se
// pisarian.
let capaAncladaAlTeclado = null;

function aplicarAnclajeDeCapa() {
  const vv = window.visualViewport;
  if (!capaAncladaAlTeclado || !vv) return;
  // Si el sistema ya ha desplazado la PAGINA para dejar sitio al
  // teclado, se devuelve a cero: eso es justo el scroll "general" que se
  // podia arrastrar hasta ver la barra de estado.
  if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  capaAncladaAlTeclado.style.height = `${vv.height}px`;
  capaAncladaAlTeclado.style.transform = `translateY(${vv.offsetTop}px)`;
}

function empezarAnclajeDeCapa(capa) {
  if (capaAncladaAlTeclado === capa) return;
  soltarAnclajeDeCapa();
  capaAncladaAlTeclado = capa;
  document.body.classList.add('capa-anclada-al-teclado');
  aplicarAnclajeDeCapa();
  if (!window.visualViewport) return;
  window.visualViewport.addEventListener('resize', aplicarAnclajeDeCapa);
  window.visualViewport.addEventListener('scroll', aplicarAnclajeDeCapa);
}

function soltarAnclajeDeCapa() {
  if (!capaAncladaAlTeclado) return;
  // Se limpian los estilos EN LINEA que puso el anclaje: si se quedaran,
  // la capa mantendria el alto del hueco con teclado y quedaria corta al
  // cerrarlo.
  capaAncladaAlTeclado.style.height = '';
  capaAncladaAlTeclado.style.transform = '';
  capaAncladaAlTeclado = null;
  document.body.classList.remove('capa-anclada-al-teclado');
  if (!window.visualViewport) return;
  window.visualViewport.removeEventListener('resize', aplicarAnclajeDeCapa);
  window.visualViewport.removeEventListener('scroll', aplicarAnclajeDeCapa);
}

// Solo los campos donde de verdad sale el teclado. Un boton o una
// casilla no lo abren y no deben anclar nada.
const CAMPOS_CON_TECLADO = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="color"]), textarea, [contenteditable="true"]';

document.addEventListener('focusin', (e) => {
  const campo = e.target.closest ? e.target.closest(CAMPOS_CON_TECLADO) : null;
  if (!campo) return;
  const capa = campo.closest('.my-space-view:not(.hidden):not(.note-editor-view)');
  if (capa) empezarAnclajeDeCapa(capa);
});

document.addEventListener('focusout', (e) => {
  const campo = e.target.closest ? e.target.closest(CAMPOS_CON_TECLADO) : null;
  if (!campo) return;
  // Al saltar de un campo a otro llega el focusout del primero ANTES que
  // el focusin del segundo: sin esperar un ciclo, el anclaje se soltaria
  // y volveria a ponerse en cada salto, dando un parpadeo.
  setTimeout(() => {
    const activo = document.activeElement;
    if (activo && activo.closest && activo.closest(CAMPOS_CON_TECLADO)) return;
    soltarAnclajeDeCapa();
  }, 0);
});

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

// Notas se puede abrir desde DOS sitios: el hueco de la barra de abajo y
// la tarjeta de Herramientas. Al cerrarla hay que volver por donde
// viniste, igual que hacen Gimnasio/Finanzas/Lecturas/Viajes. Variable
// en memoria y no localStorage: solo vale mientras la vista esta abierta.
//
// Ojo, en MOVIL el boton "← Home" de la cabecera esta oculto a proposito
// (styles.css: en estas pantallas quien hace de "volver" es la barra de
// abajo, y un boton mas seria una fila desperdiciada). O sea que en el
// telefono esto solo se nota en la cascada de Esc que dispara la propia
// barra -- igual que en Gimnasio, que hace exactamente lo mismo.
let notasAbiertasDesdeHerramientas = false;

function closeMobileNotesView() {
  document.getElementById('mobile-notes-view').classList.add('hidden');
  if (notasAbiertasDesdeHerramientas) {
    notasAbiertasDesdeHerramientas = false;
    openExtensionsView();
  } else {
    setCurrentScreen('home');
  }
  // No dejar el modo Seleccionar/Mover/Editar carpetas "colgado" para la
  // proxima vez que se abra esta vista.
  mobileNotesMode = 'browse';
  mobileNotesSelectedKeys.clear();
  refreshMobileNotesActionBar();
}
document.getElementById('btn-close-mobile-notes').addEventListener('click', closeMobileNotesView);

// La tarjeta de Notas del hub de Herramientas. Va aqui y no junto a las
// demas tarjetas porque openMobileNotesView vive en este bloque; el
// patron es el mismo que el de Gimnasio (cerrar el hub, abrir la App).
document.getElementById('btn-open-notes').addEventListener('click', () => {
  closeExtensionsView();
  notasAbiertasDesdeHerramientas = true;
  openMobileNotesView();
});

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
// Marca de "esto lo esta cerrando la app, no tu dedo".
//
// closeAllMobileOverlays simula pulsaciones de Esc, y esa cascada acaba
// CLICANDO los botones de volver de cada pantalla. Esos botones tienen
// su propia animacion (ver animarAlPulsar al final del archivo), asi que
// sin esta marca un cambio de pestaña lanzaba DOS animaciones que se
// pisaban: la del boton dejaba la pantalla vieja a la vista para que se
// fuera deslizando, y la del cambio de pestaña se la encontraba visible
// y la trataba como la que ENTRA -- resultado, una pantalla que se
// quedaba puesta encima para siempre. Paso de verdad.
let cerrandoEnCascada = false;

function closeAllMobileOverlays() {
  cerrandoEnCascada = true;
  try {
    for (let i = 0; i < 6; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }
  } finally {
    cerrandoEnCascada = false;
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
  // Aqui vivia un "modo editar" (un lapiz en la barra que convertia
  // cada tarjeta en un acceso a su ficha). Se quito el 9/9/2026 al
  // hacer las tarjetas deslizables: Koku pidio dejar UNA sola forma de
  // editar, "asi no da pie a dudas ni nada". Ahora tocar siempre entra
  // en el grupo, y editar/eliminar se saca deslizando.
  //
  // En la cabecera del detalle cabe poco: "Todos los eventos" se queda
  // en "Todos" ahi (en la tarjeta si va el texto entero).
  btn.addEventListener('click', () => openGroupDetail(id, id === null ? 'Todos' : name));

  // Deslizar para Editar / Eliminar, igual que las carpetas y notas de
  // Mi espacio y las sesiones del historial del Gimnasio (pedido de
  // Koku).
  if (id !== null) {
    return wrapRowWithSwipeActions(btn, {
      onEdit: () => openGroupModal(state.groups.find((g) => g.id === id)),
      onDelete: () => deleteGroupById(id),
    });
  }

  // "Todos los eventos" es el caso raro: no es un grupo de verdad, asi
  // que no hay nada que editar ni que borrar. Pero dejarlo como la unica
  // tarjeta que NO se mueve tampoco esta bien -- parece que la app se ha
  // quedado colgada. Solucion pedida por Koku: que se deslice igual, sin
  // botones, y que al hacerlo salga un aviso explicando por que, con la
  // opcion de dejarlo fijo para que no vuelva a moverse.
  if (todosLosEventosFijado()) {
    btn.classList.add('is-locked');
    btn.appendChild(iconoCandado());
    return btn; // fijado: ni se mueve ni vuelve a preguntar
  }
  const wrap = wrapRowWithSwipeActions(btn, { botones: [], anchoFijo: 120 });
  // El aviso sale al abrirse, no al empezar a arrastrar: si saltara a
  // mitad del gesto cortaria el movimiento en seco.
  btn.addEventListener('swipeabierto', async () => {
    const fijar = await showAppConfirm(
      '«Todos los eventos» no es un grupo de verdad: es el atajo para verlos todos juntos, así que no se puede editar ni eliminar.\n\n¿Quieres dejarlo fijo para que no se mueva? Aparecerá con un candado. Puedes volver a soltarlo desde aquí mismo.',
      { okText: 'Dejarlo fijo', cancelText: 'Dejarlo como está' },
    );
    closeSwipedNoteRow();
    if (!fijar) return; // sigue moviendose, y el aviso volvera a salir
    localStorage.setItem('gruposTodosFijado', 'true');
    renderGroupsViewList();
  });
  return wrap;
}

// "Todos los eventos" fijado: preferencia de ESTE dispositivo (como el
// tema o la unidad de peso), no algo compartido -- es una mania de como
// te gusta ver la lista, no un dato del calendario.
function todosLosEventosFijado() {
  return localStorage.getItem('gruposTodosFijado') === 'true';
}

function iconoCandado() {
  const span = document.createElement('span');
  span.className = 'group-card-lock';
  span.title = 'Fijo: no se puede editar ni eliminar. Tócalo para soltarlo.';
  span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
  // Tocar el candado lo suelta, para no dejarlo fijo para siempre sin
  // forma de volver atras.
  span.addEventListener('click', async (e) => {
    e.stopPropagation();
    const soltar = await showAppConfirm(
      '«Todos los eventos» está fijo ahora mismo. ¿Quieres soltarlo para que vuelva a moverse al deslizarlo?',
      { okText: 'Soltarlo', cancelText: 'Dejarlo fijo' },
    );
    if (!soltar) return;
    localStorage.removeItem('gruposTodosFijado');
    renderGroupsViewList();
  });
  return span;
}

// Borrar un grupo con su confirmacion. Sale del boton "Eliminar" de la
// ficha para poder usarse tambien desde el deslizamiento de la tarjeta,
// sin tener que abrir la ficha antes.
async function deleteGroupById(id) {
  const grupo = state.groups.find((g) => String(g.id) === String(id));
  const seguro = await showAppConfirm(
    `¿Eliminar el grupo "${grupo ? grupo.name : ''}"? Los eventos que lo usen se quedarán sin grupo.`,
  );
  if (!seguro) return;
  await api(`/api/groups/${id}`, { method: 'DELETE' });
  await refreshAfterGroupChange();
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
  // Cerrar ANTES de preguntar seria raro (desaparece la ficha y luego
  // sale el aviso), asi que se cierra despues, y solo si de verdad se
  // borro -- si dices que no, te quedas donde estabas.
  const habia = state.groups.length;
  await deleteGroupById(id);
  if (state.groups.length < habia) closeGroupModal();
});

document.getElementById('btn-close-groups').addEventListener('click', closeGroupsView);
document.getElementById('btn-groups-back').addEventListener('click', () => {
  showGroupsList();
  renderGroupsViewList();
});
// Los dos accesos rapidos de la pantalla del calendario.
//
// "Hoy" no es solo "abre el dia de hoy": tambien tiene que recolocar los
// NIVELES DE ENCIMA. Antes solo abria la vista diaria y dejaba
// state.viewDate donde estuviera, asi que si venias de mirar mayo de
// 2016 y pulsabas Hoy, al salir del dia (pellizco o "Volver") aparecia
// mayo de 2016 otra vez, y encima de ese, 2016. Koku: "yo quiero que...
// al hacer zoom out me lleve a septiembre y a 2026".
//
// Por eso se mueve el mes a hoy ANTES de entrar en el dia, y si estabas
// en la vista anual se vuelve al mes: los tres niveles (dia -> mes ->
// año) tienen que hablar de la misma fecha.
document.getElementById('btn-calendar-quick-today').addEventListener('click', async () => {
  const hoy = new Date();
  const otroMes = state.viewDate.getFullYear() !== hoy.getFullYear()
    || state.viewDate.getMonth() !== hoy.getMonth();
  state.viewDate = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  if (calendarViewMode !== 'month') {
    // A mano y no con setCalendarViewMode(): esa reproduce su propia
    // animacion de cambio de nivel, y aqui la que se tiene que ver es la
    // de ENTRAR en el dia, que llega un instante despues. Dos a la vez se
    // pisan (ya paso con los gestos, ver CLAUDE.md).
    calendarViewMode = 'month';
    await loadMonth();
    refreshMobileCalendarModeVisibility();
    refreshMobileCalendarNavLabel();
  } else if (otroMes) {
    await loadMonth();
    refreshMobileCalendarNavLabel();
  }
  enterMobileDayView(hoy);
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
  await Promise.all([loadGymExercises(), loadGymBlocks(), loadGymRoutines(), loadGymSessions()]);
  renderGymExercisesList();
  renderGymBlocksList();
  renderGymRoutinesList();
  renderGymSessionsList();
  populateGymProgressExerciseSelect();
  refreshGymLiveButtons();
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
  // Las secciones de Progreso/Logros se calculan al entrar en su
  // pestana, no en cada apertura del Gimnasio -- son funciones
  // declaradas mas abajo, sin problema de orden porque esto solo corre
  // dentro de un handler de click (ver la nota de TDZ en CLAUDE.md).
  if (tabName === 'plan') openGymBlockDays(null);
  if (tabName === 'progress') {
    renderGymProgressSections();
    // El aviso sobre los colores del mapa (que no significan "demasiado"
    // ni "poco", solo cantidad relativa) se ensena SOLO la primera vez;
    // el boton "?" de la seccion lo reabre cuando se quiera.
    if (localStorage.getItem('gymProgressHelpSeen') !== '1') openGymProgressHelpModal();
  }
  if (tabName === 'achievements') renderGymAchievements();
}

// --- Aviso del mapa de musculos (pestana Progreso) --------------------
function openGymProgressHelpModal() {
  document.getElementById('gym-progress-help-dont-show').checked =
    localStorage.getItem('gymProgressHelpSeen') === '1';
  document.getElementById('gym-progress-help-modal').classList.remove('hidden');
}
function closeGymProgressHelpModal() {
  localStorage.setItem(
    'gymProgressHelpSeen',
    document.getElementById('gym-progress-help-dont-show').checked ? '1' : '0'
  );
  document.getElementById('gym-progress-help-modal').classList.add('hidden');
}
document.getElementById('btn-gym-progress-help').addEventListener('click', openGymProgressHelpModal);
document.getElementById('btn-close-gym-progress-help').addEventListener('click', closeGymProgressHelpModal);
document.querySelectorAll('.gym-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchGymTab(btn.dataset.gymTab));
});

async function loadGymExercises() {
  state.gymExercises = await api('/api/gym-exercises');
}
async function loadGymBlocks() {
  state.gymBlocks = await api('/api/gym-blocks');
  // El widget de "que toca hoy" sale del ciclo del bloque activo, asi que
  // se rehace su resumen cada vez que los bloques cambian. Es el embudo
  // por el que pasa TODO lo que puede moverlo: terminar un entreno,
  // tocar el ciclo, activar otro bloque.
  actualizarResumenDelWidget();
}
async function loadGymRoutines() {
  state.gymRoutines = await api('/api/gym-routines');
  // Los dias tambien: el nombre, el color y cuantos ejercicios tiene el
  // dia de hoy salen de aqui, no del bloque.
  actualizarResumenDelWidget();
}
async function loadGymSessions() {
  state.gymSessions = await api('/api/gym-sessions');
  // Las medias de tiempo salen de las series de esas sesiones, asi que
  // se rehacen aqui: es el embudo por el que pasa todo lo que las puede
  // mover (terminar un entreno, editar una sesion a mano, borrarla).
  await loadGymSetTimes();
}

// ---------------------------------------------------------------------
// CUANTO VA A DURAR ESTE ENTRENO
//
// Peticion de Koku: "se puede aproximar un entrenamiento solo contando
// los tiempos de descanso. Ahora que estamos contabilizando el tiempo
// que se tarda en hacer una serie, se podria empezar a sacar una media
// de cuanto se tarda en hacer una serie, conforme hayan mas entrenes con
// ese ejercicio mas fiable sera la media".
//
// Tres decisiones suyas, no cambiarlas sin volver a preguntarle:
//
// 1. La media es POR EJERCICIO, no por rutina ("asi si hago una nueva
//    rutina no depende del computo de la rutina sino que ya tengo la
//    media por ejercicio"). Un dia recien montado con ejercicios que ya
//    has hecho tiene estimacion desde el primer momento.
// 2. Lo que se ensena es el tiempo del ENTRENO ENTERO, nunca el de cada
//    ejercicio por separado ("tiempo del entrene no del ejercicio").
// 3. Sin historial NO SE INVENTA NADA: los ejercicios que no has hecho
//    nunca se quedan fuera de la suma y se dice cuantos son. Por eso el
//    texto empieza por "Al menos": lo que sale es un suelo, no una
//    prediccion.
// ---------------------------------------------------------------------
let gymSetTimes = null; // Map exerciseId -> { avgSetSeconds, avgRestSeconds }

async function loadGymSetTimes() {
  const filas = await api('/api/gym-sessions/set-times');
  gymSetTimes = new Map(filas.map((f) => [f.exerciseId, f]));
}

// Devuelve { segundos, conDatos, sinDatos } para un dia del plan, o null
// si no hay ni un ejercicio con historial (entonces no se ensena nada:
// un "al menos 0 min" no dice nada).
//
// El descanso sale del propio dia si lo tiene fijado (es lo que vas a
// descansar HOY), y si no, de tu media historica en ese ejercicio. Se
// cuenta un descanso por serie menos el ultimo de todos: al acabar la
// ultima serie del entreno ya no descansas, te vas.
function gymEstimarDuracionDeDia(day) {
  if (!day || !gymSetTimes) return null;
  const visibles = (day.exercises || []).filter((ex) => !ex.hidden);
  let segundos = 0;
  let conDatos = 0;
  let sinDatos = 0;
  let ultimoDescanso = 0;
  visibles.forEach((ex) => {
    const media = gymSetTimes.get(ex.exerciseId);
    if (!media || !media.avgSetSeconds) { sinDatos += 1; return; }
    // Cuantas series de VERDAD: en un unilateral contado por lados, cada
    // lado es una serie propia, igual que al entrenar.
    const nSeries = gymBuildSetsForExercise(
      ex.exerciseId,
      ex.targetSets && ex.targetSets > 0 ? ex.targetSets : 1,
      null
    ).length;
    const descanso = ex.targetRestSeconds > 0
      ? ex.targetRestSeconds
      : (media.avgRestSeconds || 0);
    segundos += nSeries * media.avgSetSeconds + nSeries * descanso;
    ultimoDescanso = descanso;
    conDatos += 1;
  });
  if (conDatos === 0) return null;
  return { segundos: Math.max(0, segundos - ultimoDescanso), conDatos, sinDatos };
}

// Aviso flotante de usar y tirar: aparece arriba, se lee y se va solo.
// Se pone aqui (y no en el Gimnasio) porque no tiene nada de gimnasio:
// el primero que lo usa es el del tiempo estimado, pero sirve para
// cualquier "entérate de esto y sigue".
//
// Solo hay UNO a la vez: si llega otro mientras el anterior sigue
// puesto, el viejo se va sin ceremonia. Dos pastillas apiladas taparian
// la mitad de la pantalla.
let avisoFlotanteActual = null;
function mostrarAvisoFlotante(texto, { duracionMs = 4200 } = {}) {
  if (!texto) return;
  if (avisoFlotanteActual) avisoFlotanteActual.remove();
  const el = document.createElement('div');
  el.className = 'app-toast';
  el.setAttribute('role', 'status');
  el.textContent = texto;
  document.body.appendChild(el);
  avisoFlotanteActual = el;
  const irse = () => {
    if (avisoFlotanteActual !== el) return;
    el.classList.add('is-leaving');
    // Con las animaciones apagadas el 'animationend' llega igual (la
    // regla global las deja en 0.01ms en vez de quitarlas, ver
    // CLAUDE.md), asi que no hace falta un caso aparte. El setTimeout es
    // solo la red por si no llegara.
    const quitar = () => {
      el.remove();
      if (avisoFlotanteActual === el) avisoFlotanteActual = null;
    };
    el.addEventListener('animationend', quitar, { once: true });
    setTimeout(quitar, 600);
  };
  setTimeout(irse, duracionMs);
}

// "1 h 12 min" / "48 min" / "3 min". Nunca segundos: en una estimacion
// de media hora, decir "48 min 20 s" finge una precision que no hay.
function gymFormatDuracionAproximada(segundos) {
  const min = Math.max(1, Math.round(segundos / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${h} h` : `${h} h ${resto} min`;
}

// El texto completo, ya con el aviso de los que no cuentan. null si no
// hay nada que decir.
function gymTextoDeDuracion(day) {
  const est = gymEstimarDuracionDeDia(day);
  if (!est) return null;
  const base = `Al menos ~${gymFormatDuracionAproximada(est.segundos)}`;
  if (est.sinDatos === 0) return base;
  return `${base} (${est.sinDatos} ejercicio${est.sinDatos === 1 ? '' : 's'} sin datos todavía)`;
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
// El peso tal y como se ESCRIBE, normalizado a como lo entiende
// JavaScript. Koku: "No me deja poner 16,3kg".
//
// Eran dos cosas a la vez, y las dos hacian falta:
//
// 1. Los campos eran <input type="number"> con step="0.5". Un 16,3 no es
//    multiplo de 0,5, asi que el navegador lo daba por invalido -- y
//    ademas, con el telefono en español la tecla decimal del teclado
//    numerico es una COMA, que type="number" rechaza de plano: el campo
//    se queda vacio sin decir nada. Ahora son de texto con teclado
//    decimal, que acepta las dos formas.
// 2. Number('16,3') es NaN. Por eso se normaliza aqui, en UN solo sitio
//    por el que pasa todo lo que se lee de esos campos.
//
// Se cambia solo la ULTIMA coma, no todas: "1.234,5" (miles con punto)
// se lee bien, y un "16,3" suelto tambien.
function gymNormalizarPeso(texto) {
  if (texto === null || texto === undefined) return '';
  const limpio = String(texto).trim();
  if (!limpio.includes(',')) return limpio;
  const i = limpio.lastIndexOf(',');
  return `${limpio.slice(0, i).replace(/[.\s]/g, '')}.${limpio.slice(i + 1)}`;
}

function gymWeightDisplayToKg(displayValue) {
  if (displayValue === '' || displayValue === null || displayValue === undefined) return null;
  const num = Number(gymNormalizarPeso(displayValue));
  if (!Number.isFinite(num)) return null;
  // Un peso negativo no existe. Antes lo frenaba el min="0" del campo de
  // numero; al pasar a texto ese freno se fue, asi que se para aqui. Se
  // trata como "no apunte peso" (null), que es un estado que la app ya
  // maneja en todas partes, en vez de guardar un -5 que luego restaria
  // volumen en las graficas.
  if (num < 0) return null;
  return getGymWeightUnit() === 'lb' ? num / KG_TO_LB : num;
}

// --- Taxonomia de grupos musculares (Fase 2 del rediseno) -------------
// La UNICA fuente de verdad de los grupos musculares de toda la
// extension: la usan el select del modal de ejercicio, los filtros de
// la libreria, y (en fases posteriores) el volumen por musculo y el
// mapa del cuerpo -- los `id` de aqui tienen que coincidir con los ids
// de zona del SVG del cuerpo y con los `muscleGroup` que trae
// gym-exercise-library.json (ver el generador en el historial de la
// rama). Los ejercicios guardan el `id` en muscle_group; los de antes
// del rediseno pueden tener texto libre, que se muestra tal cual.
const GYM_MUSCLE_GROUPS = [
  { id: 'pecho', label: 'Pecho' },
  // La espalda va en DOS mas la lumbar: espalda media y dorsales
  // ("Lumbar" es la de abajo y se queda como estaba, con su nombre de
  // siempre). El reparto de los ~870 ejercicios de la libreria sale del
  // origen (free-exercise-db), que distingue "lats" de "middle back":
  // lats -> dorsales, middle back -> espalda media (que son casi todo
  // remos).
  //
  // Hubo un intento de tercera franja, "Espalda alta", que Koku deshizo
  // el 9/9/2026: sus cuatro ejercicios se fusionaron con espalda media,
  // y lo que de verdad hacia falta ahi era otra cosa -- el HOMBRO
  // POSTERIOR, que es un hombro, no una espalda, y por eso vive abajo
  // junto a "Hombros".
  { id: 'espalda_media', label: 'Espalda media' },
  { id: 'dorsales', label: 'Dorsales' },
  { id: 'lumbar', label: 'Lumbar' },
  { id: 'hombros', label: 'Hombros' },
  // El deltoides posterior, separado del resto del hombro (peticion de
  // Koku). En el diagrama se queda con el hombro de la figura de
  // ESPALDA, que anatomicamente es justo eso; "Hombros" pasa a marcar
  // solo la figura de frente. Nace SIN ejercicios asignados: la libreria
  // original no lo distinguia, asi que el trabajo de hombro posterior
  // (face pulls, aperturas invertidas...) sigue etiquetado como
  // "hombros" hasta que se recoloque a mano desde la ficha de cada uno.
  { id: 'hombro_posterior', label: 'Hombro posterior' },
  { id: 'trapecio', label: 'Trapecio' },
  { id: 'biceps', label: 'Bíceps' },
  { id: 'triceps', label: 'Tríceps' },
  { id: 'antebrazo', label: 'Antebrazo' },
  { id: 'core', label: 'Core / Abdomen' },
  { id: 'gluteo', label: 'Glúteo' },
  { id: 'cuadriceps', label: 'Cuádriceps' },
  // "Isquiotibiales" y no "isquiosurales": el segundo es el termino de
  // anatomia/fisioterapia y es mas preciso (el biceps femoral se inserta
  // en el perone, no en la tibia), pero Koku pidio el de toda la vida,
  // que es el que se busca al montar un dia. El id interno sigue siendo
  // 'isquios', asi que esto no toca ni los ejercicios ya clasificados ni
  // el diagrama.
  { id: 'isquios', label: 'Isquiotibiales' },
  { id: 'aductores', label: 'Aductores' },
  { id: 'abductores', label: 'Abductores' },
  { id: 'gemelos', label: 'Gemelos' },
];
// id de la taxonomia -> etiqueta bonita; cualquier otra cosa (texto
// libre de antes del rediseno) se devuelve tal cual.
function gymMuscleGroupLabel(value) {
  if (!value) return '';
  const group = GYM_MUSCLE_GROUPS.find((g) => g.id === value);
  return group ? group.label : value;
}

// --- Libreria de ejercicios empaquetada (Fase 2) ----------------------
// ~870 ejercicios de https://github.com/yuhonas/free-exercise-db
// (dominio publico, licencia Unlicense), que a su vez nacio de
// https://github.com/wrkout/exercises.json de Ollie Jennings (tambien
// Unlicense). ¡Gracias a ambos! Los nombres/musculos/material estan
// traducidos al español; las instrucciones se van traduciendo por
// tandas. El JSON pesa ~840 KB, asi que NO se carga al arrancar la app:
// fetch perezoso la primera vez que se abre el buscador, cacheado en
// esta variable para el resto de la sesion (mismo patron que
// loadViajesMap).
let gymExerciseLibrary = null;
async function loadGymExerciseLibrary() {
  if (gymExerciseLibrary) return gymExerciseLibrary;
  const resp = await fetch('gym-exercise-library.json');
  if (!resp.ok) throw new Error('No se pudo cargar la librería de ejercicios.');
  gymExerciseLibrary = await resp.json();
  return gymExerciseLibrary;
}

// Lo que hay escrito en el buscador de TUS ejercicios. Vive en memoria a
// proposito (no en localStorage): un filtro que sobrevive a cerrar la app
// hace pensar que has perdido ejercicios.
let gymExercisesFiltro = '';

// Sin tildes y en minusculas, para que "biceps" encuentre "Bíceps".
function gymNormalizarBusqueda(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function renderGymExercisesList() {
  const list = document.getElementById('gym-exercises-list');
  list.innerHTML = '';

  // El buscador solo asoma cuando hay bastantes como para que estorbe
  // buscarlos a ojo -- con cuatro ejercicios seria una fila desperdiciada.
  // Se queda visible si hay algo escrito, para poder borrarlo.
  const wrap = document.getElementById('gym-exercises-search-wrap');
  const campo = document.getElementById('gym-exercises-search');
  const merecePena = state.gymExercises.length >= 8 || gymExercisesFiltro.trim() !== '';
  wrap.classList.toggle('hidden', !merecePena);
  document.getElementById('btn-gym-exercises-search-clear').classList.toggle('hidden', gymExercisesFiltro === '');
  // No se pisa lo que la persona esta escribiendo (el repintado puede
  // venir de otra cosa, como guardar un ejercicio).
  if (campo.value !== gymExercisesFiltro) campo.value = gymExercisesFiltro;

  if (state.gymExercises.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavía no tienes ejercicios. Añádelos desde la librería o crea uno a mano.</p>';
    return;
  }

  // Busca por nombre Y por musculo: "pierna" saca todas las de pierna
  // aunque ninguna se llame asi.
  // El .trim() NO es cosmetico: sin el, escribir solo espacios (el
  // autocorrector del movil los mete con facilidad) buscaba " " y dejaba
  // la lista vacia, como si hubieras perdido los ejercicios. Encontrado
  // forzando fallos.
  const q = gymNormalizarBusqueda(gymExercisesFiltro).trim();
  const visibles = q === ''
    ? state.gymExercises
    : state.gymExercises.filter((ex) => gymNormalizarBusqueda(
        `${ex.name} ${gymMuscleGroupLabel(ex.muscleGroup) || ''} ${ex.equipment || ''}`
      ).includes(q));

  if (visibles.length === 0) {
    list.innerHTML = '<p class="empty-hint">Ningún ejercicio tuyo coincide con eso.</p>';
    return;
  }

  visibles.forEach((ex) => {
    // "unilateral" se ensena aqui para que se vea DONDE se configura (el
    // lapiz de esta misma fila) -- Koku lo estuvo buscando en el dia.
    const extras = [
      gymMuscleGroupLabel(ex.muscleGroup),
      ex.equipment,
      ex.unilateral ? (ex.countSidesSeparately ? 'unilateral, por lados' : 'unilateral') : '',
    ].filter(Boolean).join(' · ');
    const row = document.createElement('div');
    row.className = 'gym-list-item gym-exercise-row';
    row.innerHTML = `
      <span class="gym-list-item-name">${escapeHtml(ex.name)}${extras ? ` <span class="gym-list-item-muted">(${escapeHtml(extras)})</span>` : ''}</span>
    `;
    // Deslizar en vez del lapiz (peticion de Koku: "por seguir un poco
    // con la misma dinamica en todo, en vez de boton, hazlo deslizable").
    // Mismo componente que las notas, las carpetas, las sesiones del
    // historial y las tarjetas de grupo.
    list.appendChild(wrapRowWithSwipeActions(row, {
      onEdit: () => openGymExerciseModal(ex),
      onDelete: () => borrarEjercicioDeLaLista(ex),
    }));
  });
}

// Borrar desde el deslizamiento. El servidor RECHAZA borrar un ejercicio
// que ya tiene series apuntadas (has_history), asi que ese error se
// cuenta con palabras en vez de soltar el codigo tal cual.
async function borrarEjercicioDeLaLista(ex) {
  const ok = await showAppConfirm(`¿Eliminar “${ex.name}”?`, { okText: 'Eliminar', danger: true });
  if (!ok) return;
  try {
    await api(`/api/gym-exercises/${ex.id}`, { method: 'DELETE' });
  } catch (err) {
    showAppAlert(err && err.message ? err.message : 'No se ha podido eliminar el ejercicio.');
    return;
  }
  await loadGymExercises();
  renderGymExercisesList();
}

document.getElementById('gym-exercises-search').addEventListener('input', (e) => {
  gymExercisesFiltro = e.target.value;
  renderGymExercisesList();
});
document.getElementById('btn-gym-exercises-search-clear').addEventListener('click', () => {
  gymExercisesFiltro = '';
  renderGymExercisesList();
  document.getElementById('gym-exercises-search').focus();
});

// --- Pestana "Plan": bloques y sus dias (rediseno de Gimnasio) --------
// Dos niveles dentro de la misma pestana, tipo carpetas de Notas: la
// lista de bloques, y al entrar en uno, sus dias (las filas de
// gym_routines de siempre). gymCurrentBlockId dice donde estamos:
// null = nivel de bloques.
let gymCurrentBlockId = null;

function renderGymBlocksList() {
  const list = document.getElementById('gym-blocks-list');
  list.innerHTML = '';
  if (state.gymBlocks.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavía no tienes bloques. Un bloque es una etapa de entrenamiento (ej. "Volumen Invierno") con sus días dentro.</p>';
    return;
  }
  state.gymBlocks.forEach((b) => {
    const row = document.createElement('div');
    row.className = 'gym-list-item gym-block-item';
    row.dataset.openGymBlock = b.id;
    row.innerHTML = `
      <span class="gym-list-item-name">${escapeHtml(b.name)}${b.isActive ? ' <span class="gym-block-active-badge">Activo</span>' : ''}
        <span class="gym-list-item-muted">(${b.dayCount} día${b.dayCount === 1 ? '' : 's'})</span></span>
      <div class="gym-list-item-actions">
        ${b.isActive ? '' : `<button type="button" class="secondary-btn gym-block-activate-btn" data-activate-gym-block="${b.id}">Activar</button>`}
        <button type="button" class="icon-btn" data-edit-gym-block="${b.id}" aria-label="Editar bloque">✎</button>
      </div>
    `;
    // Toda la fila entra al bloque, salvo los botones de la derecha (que
    // paran la propagacion) -- mismo patron que las filas de sesion.
    row.addEventListener('click', () => openGymBlockDays(b.id));
    list.appendChild(row);
  });
  list.querySelectorAll('[data-activate-gym-block]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api(`/api/gym-blocks/${btn.dataset.activateGymBlock}/activate`, { method: 'POST' });
      await loadGymBlocks();
      renderGymBlocksList();
    });
  });
  list.querySelectorAll('[data-edit-gym-block]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openGymBlockModal(state.gymBlocks.find((b) => b.id === Number(btn.dataset.editGymBlock)));
    });
  });
}

// Entra al nivel de dias de UN bloque (o vuelve al de bloques con null).
function openGymBlockDays(blockId) {
  gymCurrentBlockId = blockId || null;
  document.getElementById('gym-blocks-level').classList.toggle('hidden', gymCurrentBlockId !== null);
  document.getElementById('gym-block-days-level').classList.toggle('hidden', gymCurrentBlockId === null);
  if (gymCurrentBlockId !== null) {
    const block = state.gymBlocks.find((b) => b.id === gymCurrentBlockId);
    document.getElementById('gym-block-days-title').textContent = block ? block.name : '';
    renderGymRoutinesList();
  }
}
document.getElementById('btn-gym-back-to-blocks').addEventListener('click', async () => {
  // Al volver se recargan los bloques para que el contador de dias de
  // cada tarjeta refleje lo que se acabe de crear/borrar dentro.
  await loadGymBlocks();
  renderGymBlocksList();
  openGymBlockDays(null);
});

function renderGymRoutinesList() {
  const list = document.getElementById('gym-routines-list');
  list.innerHTML = '';
  // Solo los dias del bloque abierto -- el filtrado se hace aqui en
  // cliente (state.gymRoutines ya esta entero en memoria) en vez de
  // repedir al backend con ?blockId, que existe para quien lo necesite.
  const days = state.gymRoutines.filter((r) => r.blockId === gymCurrentBlockId);
  if (days.length === 0) {
    list.innerHTML = '<p class="empty-hint">Este bloque todavía no tiene días. Crea uno arriba (ej. "Push 1").</p>';
    return;
  }
  days.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'gym-list-item';
    row.innerHTML = `
      <span class="color-dot" style="background-color: ${r.color}"></span>
      <span class="gym-list-item-name">${r.icon ? escapeHtml(r.icon) + ' ' : ''}${escapeHtml(r.name)} <span class="gym-list-item-muted">(${r.exercises.length} ejercicio${r.exercises.length === 1 ? '' : 's'})</span></span>
      <div class="gym-list-item-actions">
        <button type="button" class="icon-btn" data-edit-gym-routine="${r.id}" aria-label="Editar nombre, color y bloque">✎</button>
      </div>
    `;
    // Dos entradas distintas al mismo dia, como pidio Koku: el lapiz
    // para su FICHA (nombre, color, icono y bloque) y tocar la fila para
    // sus EJERCICIOS, que es a lo que se entra el 90% de las veces.
    row.addEventListener('click', () => {
      openGymRoutineModal(state.gymRoutines.find((x) => x.id === r.id), 'ejercicios');
    });
    list.appendChild(row);
  });
  list.querySelectorAll('[data-edit-gym-routine]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      // Sin esto, el clic del lapiz sube tambien a la fila y abriria las
      // dos mitades una encima de otra.
      e.stopPropagation();
      openGymRoutineModal(state.gymRoutines.find((r) => r.id === Number(btn.dataset.editGymRoutine)), 'ficha');
    });
  });
}

// Deslizar una fila hacia la izquierda para sacar Editar / Eliminar
// ("como esta hecho en las notas", pedido de Koku). Nacio para el
// historial del Gimnasio y ahora la usan tambien los grupos del
// calendario, por eso el nombre generico -- si hace falta en un sitio
// nuevo, basta con envolver la fila con esto.
//
// Reutiliza las mismas clases y el mismo estado de "solo una fila
// abierta" (openSwipedNoteRow) que wrapNoteRowWithSwipe, para que abrir
// una cierre la otra y el toque fuera las cierre todas.
// botones: si se pasa, sustituye a la pareja Editar/Eliminar de siempre.
// Cada entrada es [texto, clase, funcion]. Sirve para sitios que
// necesitan otra combinacion -- los temas, por ejemplo, llevan tambien
// "Exportar", y "Todos los eventos" no lleva ninguno.
// anchoFijo: cuanto se desplaza la fila, en px, cuando NO hay botones
// que medir (el caso de "Todos los eventos", que se desliza solo para
// que salte su aviso). Sin esto, un contenedor de acciones vacio mide
// cuatro pixeles y el gesto no se notaria.
function wrapRowWithSwipeActions(row, { onEdit, onDelete, botones, anchoFijo, bloqueadoSi } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'note-swipe-wrap';

  const acciones = document.createElement('div');
  acciones.className = 'note-swipe-actions';
  const lista = botones || [['Editar', 'secondary-btn', onEdit], ['Eliminar', 'danger-btn', onDelete]];
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

  // La fila SIGUE AL DEDO mientras deslizas y luego cae sola a su sitio
  // (peticion de Koku: "dale animación al deslizar, para que se vea más
  // fluido"). Mientras se arrastra se quita la transicion (clase
  // is-dragging) y se escribe el transform a mano; al soltar se borra el
  // transform en linea y manda otra vez el CSS, que anima el ultimo
  // tramo.
  const anchoAcciones = () => anchoFijo || acciones.offsetWidth || 152;
  let inicio = null;
  let horizontal = false;
  const soltarArrastre = () => {
    wrap.classList.remove('is-dragging');
    row.style.transform = '';
  };
  row.addEventListener('pointerdown', (e) => {
    // Hay filas que a veces tienen otro gesto encima (el modo mover del
    // entreno): mientras ese esta activo, deslizar no hace nada.
    if (bloqueadoSi && bloqueadoSi()) { inicio = null; return; }
    inicio = { x: e.clientX, y: e.clientY };
    horizontal = false;
  });
  row.addEventListener('pointermove', (e) => {
    if (!inicio) return;
    const dx = e.clientX - inicio.x;
    const dy = e.clientY - inicio.y;
    if (!horizontal && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
      horizontal = true;
      wrap.style.setProperty('--swipe-actions-width', `${anchoAcciones()}px`);
      wrap.classList.add('is-dragging');
    }
    if (!horizontal) return;
    const ancho = anchoAcciones();
    const desde = wrap.classList.contains('is-open') ? -ancho : 0;
    let x = desde + dx;
    // Fuera de los topes cuesta mas tirar (goma), para que se note el
    // limite sin bloquearse de golpe.
    if (x > 0) x *= 0.3;
    else if (x < -ancho) x = -ancho + (x + ancho) * 0.3;
    row.style.transform = `translateX(${x}px)`;
  });
  row.addEventListener('pointerup', (e) => {
    if (!inicio) return;
    const dx = e.clientX - inicio.x;
    inicio = null;
    if (!horizontal) return;
    const ancho = anchoAcciones();
    const desde = wrap.classList.contains('is-open') ? -ancho : 0;
    const x = desde + dx;
    soltarArrastre();
    // Se queda donde estuviera mas cerca: pasada la mitad, abierta.
    if (x < -ancho / 2) {
      if (openSwipedNoteRow !== wrap) closeSwipedNoteRow();
      wrap.style.setProperty('--swipe-actions-width', `${ancho}px`);
      const yaEstaba = wrap.classList.contains('is-open');
      wrap.classList.add('is-open');
      openSwipedNoteRow = wrap;
      // Aviso para quien quiera enterarse de que esta fila ACABA de
      // abrirse (lo usa "Todos los eventos" para sacar su dialogo). Va
      // aqui y no en el pointermove a proposito: si saltara a mitad del
      // arrastre, cortaria el gesto en seco.
      if (!yaEstaba) row.dispatchEvent(new CustomEvent('swipeabierto'));
    } else if (wrap.classList.contains('is-open')) {
      closeSwipedNoteRow();
    }
    // Un deslizamiento no debe abrir la sesion: se descarta ese click.
    row.dataset.swiped = '1';
  });
  row.addEventListener('pointercancel', () => {
    inicio = null;
    horizontal = false;
    soltarArrastre();
  });
  row.addEventListener('click', (e) => {
    if (row.dataset.swiped) {
      delete row.dataset.swiped;
      if (wrap.classList.contains('is-open')) { e.stopPropagation(); e.preventDefault(); }
    }
  }, true);
  return wrap;
}

// Borrar una sesion desde el deslizamiento (mismo aviso que el boton de
// dentro del modal: aqui SI se pierde historial).
async function deleteGymSessionById(id) {
  const ok = await showAppConfirm('¿Eliminar esta sesión y todas sus series? Esto sí borra historial.', { okText: 'Eliminar', danger: true });
  if (!ok) return;
  await api(`/api/gym-sessions/${id}`, { method: 'DELETE' });
  await loadGymSessions();
  renderGymSessionsList();
  populateGymProgressExerciseSelect();
}

// --- Series alargadas: dropset y rest-pause ---------------------------
// Un DROPSET es una serie que, al llegar al limite, sigue bajando el
// peso; un REST-PAUSE es una serie que para unos segundos y sigue con el
// MISMO peso. Los dos se apuntan DESPUES de la serie (peticion de Koku:
// "hay veces que lo hago y otras que no, depende de la serie"), asi que
// no son una configuracion del ejercicio sino algo que se anade en el
// dialogo de "¿has acabado la serie?".
//
// Cada tramo extra viaja dentro de su serie madre, en `set.segments`
// (ver serializeSets en routes-local/gymSessions.js). Las tres reglas
// que decidio Koku, y de donde salen estas funciones:
//   1. Una serie alargada cuenta como UNA serie, no como tres. Por eso
//      los tramos van anidados y nunca sueltos en la lista.
//   2. El VOLUMEN suma todos los tramos: es trabajo real, y si no
//      sumara, la grafica bajaria justo el dia que mas aprietas.
//   3. Cualquier tramo puede ser RECORD ("hay veces que la segunda sale
//      mejor que la primera"), asi que los PRs miran serie y tramos por
//      igual -- por eso existe gymSetConTramos().
const GYM_SEGMENT_LABELS = { dropset: 'Drop', restpause: 'R-P' };

// Serie llevada al fallo: se marca en el mismo dialogo de fin de serie y
// se guarda en set_type = 'failure' (valor que el esquema ya tenia
// reservado). Es una ETIQUETA, no cambia ningun calculo: al fallo o no,
// las repeticiones y los kilos son los que son, y una serie al fallo es
// justo la que MAS merece contar como record (a diferencia del
// calentamiento, que sigue fuera de los PRs).
const GYM_FAILURE_CHIP = '<span class="gym-set-failure-chip" title="Serie llevada al fallo">Fallo</span>';
function gymFailureChipHtml(esAlFallo) {
  return esAlFallo ? GYM_FAILURE_CHIP : '';
}

// CUANTO PESA DE MAS una serie al fallo en el volumen. Decision de Koku
// ("para que se tenga en cuenta para las graficas, aunque haga dropset y
// no haga las mismas repes que en la primera"): al final de una serie
// exprimida mueves menos kilos pero el esfuerzo es mayor, y con el
// volumen a pelo esa serie parecia PEOR que una floja.
//
// Aviso importante, porque es facil olvidarlo: no hay ninguna cifra
// estandar para esto, es un numero elegido. Por eso
//   1. los kg GUARDADOS son siempre los de verdad -- el factor se aplica
//      solo al PINTAR, nunca al escribir en la base;
//   2. es ajustable por dispositivo (Progreso > "Peso extra de una serie
//      al fallo"), asi que cambiarlo no reescribe ningun historial: los
//      mismos datos se vuelven a sumar con otro numero;
//   3. x1 lo desactiva del todo y deja el volumen como los kg reales.
// El factor se aplica a la serie ENTERA, tramos de dropset/rest-pause
// incluidos: lo que se llevo al fallo fue la serie completa.
// Por defecto x1,25: lo eligio Koku ya usando la app de verdad, y con un
// criterio concreto de que es "al fallo" -- "tratar de hacer la
// repeticion y no poder terminarla, no decir okey creo que no puedo una
// mas, sino forzar esa otra mas y no conseguir sacarla".
const GYM_FAILURE_FACTORS = [1, 1.1, 1.2, 1.25, 1.5];
function getGymFailureFactor() {
  const guardado = Number(localStorage.getItem('gymFailureFactor'));
  return GYM_FAILURE_FACTORS.includes(guardado) ? guardado : 1.25;
}
// Volumen ya ajustado a partir de los kg REALES y de cuantos de esos kg
// salieron de series al fallo. Lo usan por igual el cliente y lo que
// llega agregado de las rutas (que devuelven las dos cifras aparte, en
// kg de verdad, precisamente para poder hacer esta cuenta aqui).
function gymVolumenAjustado(volumenKg, volumenAlFalloKg) {
  return (Number(volumenKg) || 0) + (Number(volumenAlFalloKg) || 0) * (getGymFailureFactor() - 1);
}

function gymSetSegments(set) {
  return set && Array.isArray(set.segments) ? set.segments.filter(Boolean) : [];
}

// Kilos REALES movidos por la serie entera (madre + tramos), sin
// ajustar. Es lo que se guarda y lo que hay que usar para cualquier cosa
// que quiera saber cuanto peso se movio de verdad.
function gymSetVolumeRealKg(set) {
  let total = (Number(set.reps) || 0) * (Number(set.weightKg) || 0);
  for (const seg of gymSetSegments(set)) {
    total += (Number(seg.reps) || 0) * (Number(seg.weightKg) || 0);
  }
  return total;
}

// ¿Esta serie se llevo al fallo? Los tramos heredan la marca de su madre
// (llevan su propio set_type de 'dropset'/'restpause'), asi que la
// pregunta siempre es por la serie, nunca por un tramo suelto.
function gymSetEsAlFallo(set) {
  return set.setType === 'failure' || set.failure === true;
}

// El volumen tal y como se PINTA: los kg reales, con el peso extra si la
// serie fue al fallo. Lo usan el historial, el mapa de musculos, la
// grafica semanal y los PRs, para que todos cuenten igual.
function gymSetVolumeKg(set) {
  const real = gymSetVolumeRealKg(set);
  return gymSetEsAlFallo(set) ? gymVolumenAjustado(real, real) : real;
}

// La serie y sus tramos como una lista plana de "cosas con peso y
// repeticiones", para lo que mira serie a serie (los PRs). Los tramos
// heredan el ejercicio y el lado de su madre.
function gymSetConTramos(set) {
  const lista = [set];
  for (const seg of gymSetSegments(set)) {
    lista.push({
      exerciseId: set.exerciseId,
      exerciseName: set.exerciseName,
      reps: seg.reps,
      weightKg: seg.weightKg,
      setType: seg.kind,
      side: set.side || null,
    });
  }
  return lista;
}

// Etiqueta corta para la fila de una serie alargada: "Drop x2", "R-P".
function gymSegmentChipHtml(set) {
  const segs = gymSetSegments(set);
  if (segs.length === 0) return '';
  const kinds = [...new Set(segs.map((seg) => (seg.kind === 'restpause' ? 'restpause' : 'dropset')))];
  const texto = kinds.map((k) => GYM_SEGMENT_LABELS[k]).join('+');
  const sufijo = segs.length > 1 ? ` ×${segs.length}` : '';
  return `<span class="gym-set-segment-chip" title="Serie alargada: ${segs.length} tramo${segs.length === 1 ? '' : 's'} extra">${texto}${sufijo}</span>`;
}

function renderGymSessionsList() {
  const list = document.getElementById('gym-sessions-list');
  list.innerHTML = '';
  if (state.gymSessions.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavía no has registrado ninguna sesión.</p>';
    return;
  }
  const unit = getGymWeightUnitLabel();
  state.gymSessions.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'gym-list-item gym-session-item';
    row.dataset.editGymSession = s.id;

    // Linea de datos rapidos: duracion (si la hay), y para entrenos de
    // pesas tambien nº de series y volumen total.
    const statBits = [];
    if (s.durationSeconds) statBits.push(`${Math.max(1, Math.round(s.durationSeconds / 60))} min`);
    if (s.type !== 'activity' && s.sets.length > 0) {
      statBits.push(`${s.sets.length} serie${s.sets.length === 1 ? '' : 's'}`);
      // Los tramos de una serie alargada suman kilos pero NO series:
      // por eso el volumen usa gymSetVolumeKg y el conteo de arriba es
      // sets.length a secas (los tramos van anidados, no en la lista).
      const volumeKg = s.sets.reduce((acc, set) => acc + gymSetVolumeKg(set), 0);
      if (volumeKg > 0) statBits.push(`${gymWeightKgToDisplay(volumeKg)} ${unit}`);
      // Tiempo REAL de trabajo (suma de lo que duraron las series), solo
      // si la sesion se registro con el boton de empezar/terminar serie.
      const workSeconds = s.sets.reduce((acc, set) => acc + (set.durationSeconds || 0), 0);
      if (workSeconds > 0) statBits.push(`${gymFormatWorkTime(workSeconds)} de trabajo`);
    }

    if (s.type === 'activity') {
      row.innerHTML = `
        <span class="gym-session-item-date">${formatGymDate(s.date)}</span>
        <span class="gym-session-item-routine">${escapeHtml(s.activityName || 'Actividad')}</span>
        <span class="gym-list-item-muted">${escapeHtml([gymActivityKindLabel(s.activityKind), ...statBits].join(' · '))}</span>
      `;
      row.addEventListener('click', () => openGymActivityModal(s));
      list.appendChild(wrapRowWithSwipeActions(row, {
        onEdit: () => openGymActivityModal(s),
        onDelete: () => deleteGymSessionById(s.id),
      }));
      return;
    }

    const exerciseNames = [...new Set(s.sets.map((set) => set.exerciseName))];
    row.innerHTML = `
      <span class="gym-session-item-date">${formatGymDate(s.date)}</span>
      ${
        s.routineName
          ? `<span class="gym-session-item-routine"><span class="color-dot" style="background-color: ${s.routineColor}"></span>${s.routineIcon ? escapeHtml(s.routineIcon) + ' ' : ''}${escapeHtml(s.routineName)}</span>`
          : '<span class="gym-session-item-routine gym-list-item-muted">Sesión libre</span>'
      }
      ${statBits.length ? `<span class="gym-list-item-muted">${escapeHtml(statBits.join(' · '))}</span>` : ''}
      <span class="gym-list-item-muted">${exerciseNames.length ? exerciseNames.map(escapeHtml).join(', ') : 'Sin ejercicios'}</span>
    `;
    row.addEventListener('click', () => openGymSessionModal(s));
    list.appendChild(wrapRowWithSwipeActions(row, {
      onEdit: () => openGymSessionModal(s),
      onDelete: () => deleteGymSessionById(s.id),
    }));
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
// El grupo muscular ya no es texto libre: select con la taxonomia fija
// (GYM_MUSCLE_GROUPS). Si se edita un ejercicio de antes del rediseno
// cuyo valor no esta en la taxonomia, ese valor viejo se anade como
// opcion extra para no perderlo sin querer al guardar.
const gymExerciseMuscleField = createSelectField({
  options: [{ value: '', label: 'Sin grupo' }],
  initialValue: '',
  placeholder: 'Sin grupo',
});
document.getElementById('gym-exercise-muscle-field').appendChild(gymExerciseMuscleField.element);

// Musculos SECUNDARIOS del ejercicio (chips activables): cuentan en el
// mapa de musculos a mitad de peso, igual que los de la libreria.
let gymExerciseSecondarySel = new Set();
function renderGymExerciseSecondaryChips() {
  const container = document.getElementById('gym-exercise-secondary-field');
  container.innerHTML = '';
  GYM_MUSCLE_GROUPS.forEach((g) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'gym-secondary-chip' + (gymExerciseSecondarySel.has(g.id) ? ' active' : '');
    chip.textContent = g.label;
    chip.addEventListener('click', () => {
      if (gymExerciseSecondarySel.has(g.id)) gymExerciseSecondarySel.delete(g.id);
      else gymExerciseSecondarySel.add(g.id);
      renderGymExerciseSecondaryChips();
    });
    container.appendChild(chip);
  });
}

// Si el modal se abrio desde el buscador estando en "modo elegir" (el +
// del entreno en vivo), el ejercicio recien creado se añade directo a la
// sesion en curso al guardar.
let gymExerciseAddToLivePending = false;

// Lo de "contar cada lado por separado" y el descanso entre lados solo
// pinta algo si el ejercicio es unilateral: se esconde si no lo es.
function refreshGymUnilateralFields() {
  const on = document.getElementById('gym-exercise-unilateral').checked;
  document.getElementById('gym-exercise-unilateral-extra').classList.toggle('hidden', !on);
}
document.getElementById('gym-exercise-unilateral').addEventListener('change', refreshGymUnilateralFields);

// "90" -> "Descanso: 1:30 min". El campo va en segundos y sin esto no se
// nota (mismo apano que ya tenia la fila del dia).
function refreshGymExerciseDefaultRestPreview() {
  const n = Number(document.getElementById('gym-exercise-default-rest').value);
  document.getElementById('gym-exercise-default-rest-preview').textContent =
    n > 0 ? `Descanso: ${gymLiveFormatClock(n)} min` : '';
}
document.getElementById('gym-exercise-default-rest').addEventListener('input', refreshGymExerciseDefaultRestPreview);

function openGymExerciseModal(exercise) {
  document.getElementById('gym-exercise-modal-title').textContent = exercise ? 'Editar ejercicio' : 'Nuevo ejercicio';
  document.getElementById('gym-exercise-id').value = exercise ? exercise.id : '';
  document.getElementById('gym-exercise-name').value = exercise ? exercise.name : '';
  document.getElementById('gym-exercise-equipment').value = exercise ? exercise.equipment || '' : '';
  document.getElementById('gym-exercise-notes').value = exercise ? exercise.notes || '' : '';
  document.getElementById('gym-exercise-unilateral').checked = !!(exercise && exercise.unilateral);
  document.getElementById('gym-exercise-sides-separately').checked = !!(exercise && exercise.countSidesSeparately);
  document.getElementById('gym-exercise-side-rest').value = exercise && exercise.sideRestSeconds != null ? exercise.sideRestSeconds : '';
  document.getElementById('gym-exercise-default-sets').value = exercise && exercise.defaultSets != null ? exercise.defaultSets : '';
  document.getElementById('gym-exercise-default-reps').value = exercise && exercise.defaultReps != null ? exercise.defaultReps : '';
  document.getElementById('gym-exercise-default-rest').value = exercise && exercise.defaultRestSeconds != null ? exercise.defaultRestSeconds : '';
  refreshGymExerciseDefaultRestPreview();
  refreshGymUnilateralFields();
  gymExerciseSecondarySel = new Set(exercise && Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : []);
  renderGymExerciseSecondaryChips();
  const options = [
    { value: '', label: 'Sin grupo' },
    ...GYM_MUSCLE_GROUPS.map((g) => ({ value: g.id, label: g.label })),
  ];
  const current = exercise ? exercise.muscleGroup || '' : '';
  if (current && !GYM_MUSCLE_GROUPS.some((g) => g.id === current)) {
    options.push({ value: current, label: `${current} (texto antiguo)` });
  }
  gymExerciseMuscleField.setOptions(options);
  gymExerciseMuscleField.setValue(current);
  document.getElementById('btn-delete-gym-exercise').classList.toggle('hidden', !exercise);
  document.getElementById('gym-exercise-modal').classList.remove('hidden');
}
function closeGymExerciseModal() {
  gymExerciseAddToLivePending = false;
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
    muscleGroup: gymExerciseMuscleField.getValue(),
    equipment: document.getElementById('gym-exercise-equipment').value,
    secondaryMuscles: [...gymExerciseSecondarySel],
    notes: document.getElementById('gym-exercise-notes').value,
    unilateral: document.getElementById('gym-exercise-unilateral').checked,
    countSidesSeparately: document.getElementById('gym-exercise-sides-separately').checked,
    sideRestSeconds: document.getElementById('gym-exercise-side-rest').value,
    defaultSets: document.getElementById('gym-exercise-default-sets').value,
    defaultReps: document.getElementById('gym-exercise-default-reps').value,
    defaultRestSeconds: document.getElementById('gym-exercise-default-rest').value,
  };
  // El flag se captura ANTES de cerrar: closeGymExerciseModal lo resetea.
  const addToLive = !id && gymExerciseAddToLivePending;
  let saved;
  if (id) {
    saved = await api(`/api/gym-exercises/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    saved = await api('/api/gym-exercises', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeGymExerciseModal();
  await loadGymExercises();
  renderGymExercisesList();
  // Creado desde el buscador en modo elegir: directo al entreno en curso.
  if (addToLive && gymLiveSession && saved && !gymLiveSession.exercises.some((x) => x.exerciseId === saved.id)) {
    gymLiveSession.exercises.push({
      exerciseId: saved.id,
      note: '',
      rpe: '',
      collapsed: false,
      sets: gymBuildSetsForExercise(saved.id, 1, ''),
    });
    gymLiveStore();
    gymLivePrevSets.set(saved.id, await api(`/api/gym-sessions/last-sets/${saved.id}`));
    renderGymLiveExercises();
  }
});

document.getElementById('btn-delete-gym-exercise').addEventListener('click', async () => {
  const id = document.getElementById('gym-exercise-id').value;
  try {
    await api(`/api/gym-exercises/${id}`, { method: 'DELETE' });
  } catch (err) {
    showAppAlert(err.message);
    return;
  }
  closeGymExerciseModal();
  await loadGymExercises();
  renderGymExercisesList();
});

// --- Buscador de la libreria de ejercicios (Fase 2) --------------------
// Ver el comentario de loadGymExerciseLibrary() arriba (origen del
// dataset y creditos). El buscador filtra en cliente sobre el JSON
// entero; para no pintar 870 filas de golpe se corta en 80 con un aviso
// de "afina la busqueda".
const gymLibraryMuscleField = createSelectField({
  options: [{ value: '', label: 'Todos los músculos' }, ...GYM_MUSCLE_GROUPS.map((g) => ({ value: g.id, label: g.label }))],
  initialValue: '',
  onChange: () => renderGymLibraryList(),
});
document.getElementById('gym-library-muscle-field').appendChild(gymLibraryMuscleField.element);

const gymLibraryEquipmentField = createSelectField({
  options: [{ value: '', label: 'Todo el material' }],
  initialValue: '',
  onChange: () => renderGymLibraryList(),
});
document.getElementById('gym-library-equipment-field').appendChild(gymLibraryEquipmentField.element);

// Busqueda sin acentos ni mayusculas ("prensa" encuentra "Prensa",
// "bicep" encuentra "Bíceps"...).
function gymNormalizeSearch(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Cuando el buscador de ejercicios esta en "modo elegir" (abierto desde
// un entreno para anadir uno), aqui vive lo que hay que hacer con el
// elegido. Se declara AQUI y no junto a su listener, varios miles de
// lineas mas abajo: renderGymLibraryMine() la lee, y una variable `let`
// leida antes de su declaracion revienta el archivo entero -- la trampa
// de la zona muerta temporal que ya mordio una vez en settings.js.
let gymLibraryPickCallback = null;

// TUS ejercicios dentro del buscador, y solo en "modo elegir" (o sea,
// abriendolo desde un entreno para anadir uno).
//
// El agujero que tapa esto: el "+" del entreno abria SOLO la libreria, asi
// que un ejercicio creado por ti no habia manera de anadirlo sin volver a
// crearlo. Y como lo que si podias anadir venia de la libreria, y la
// libreria no marca unilaterales, nunca te preguntaba por el lado. Los dos
// sintomas, una sola causa.
function renderGymLibraryMine() {
  const bloque = document.getElementById('gym-library-mine-block');
  const list = document.getElementById('gym-library-mine');
  const cabeceraLib = document.getElementById('gym-library-section-lib');
  const eligiendo = !!gymLibraryPickCallback;
  bloque.classList.toggle('hidden', !eligiendo);
  cabeceraLib.classList.toggle('hidden', !eligiendo);
  if (!eligiendo) return;

  const search = gymNormalizeSearch(document.getElementById('gym-library-search').value.trim());
  // Se filtra por nombre, musculo y material, igual que el buscador de la
  // pestana Plan: escribir "pierna" saca las de pierna aunque no se llamen
  // asi. Los que YA estan en el entreno no se ofrecen.
  const yaEnElEntreno = new Set((gymLiveSession ? gymLiveSession.exercises : []).map((e) => e.exerciseId));
  const mios = state.gymExercises.filter((ex) => {
    if (yaEnElEntreno.has(ex.id)) return false;
    if (!search) return true;
    const texto = [ex.name, gymMuscleGroupLabel(ex.muscleGroup), ex.equipment].filter(Boolean).join(' ');
    return gymNormalizeSearch(texto).includes(search);
  });

  list.innerHTML = '';
  if (mios.length === 0) {
    list.innerHTML = `<p class="empty-hint">${search ? 'Ninguno de los tuyos coincide.' : 'Todavía no tienes ejercicios propios.'}</p>`;
    return;
  }
  mios.slice(0, 40).forEach((ex) => {
    const meta = [gymMuscleGroupLabel(ex.muscleGroup), ex.equipment].filter(Boolean).join(' · ');
    const row = document.createElement('div');
    row.className = 'gym-list-item';
    row.innerHTML = `
      <span class="gym-list-item-name">${escapeHtml(ex.name)}${meta ? ` <span class="gym-list-item-muted">(${escapeHtml(meta)})</span>` : ''}</span>
      <div class="gym-list-item-actions"><button type="button" class="secondary-btn">Añadir</button></div>
    `;
    const anadir = () => gymAnadirEjercicioAlEntreno(ex.id);
    row.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); anadir(); });
    row.addEventListener('click', anadir);
    list.appendChild(row);
  });
}

// Meter un ejercicio YA EXISTENTE en el entreno en curso. Es lo mismo que
// hacian por su cuenta el callback de la libreria y el de "crear
// ejercicio propio", puesto en un solo sitio: gymBuildSetsForExercise es
// quien decide si son una serie o dos (izquierda y derecha), asi que
// cualquier camino que pase por aqui respeta los unilaterales.
async function gymAnadirEjercicioAlEntreno(exerciseId) {
  if (!gymLiveSession) return;
  if (gymLiveSession.exercises.some((e) => e.exerciseId === exerciseId)) return;
  gymLiveSession.exercises.push({
    exerciseId,
    note: '',
    rpe: '',
    collapsed: false,
    sets: gymBuildSetsForExercise(exerciseId, 1, ''),
  });
  gymLiveStore();
  try {
    gymLivePrevSets.set(exerciseId, await api(`/api/gym-sessions/last-sets/${exerciseId}`));
  } catch { /* sin "la ultima vez" se sigue igual */ }
  renderGymLiveExercises();
  closeGymLibraryModal();
  gymLibraryPickCallback = null;
}

function renderGymLibraryList() {
  renderGymLibraryMine();
  const list = document.getElementById('gym-library-list');
  if (!gymExerciseLibrary) return;
  const search = gymNormalizeSearch(document.getElementById('gym-library-search').value.trim());
  const muscle = gymLibraryMuscleField.getValue();
  const equipment = gymLibraryEquipmentField.getValue();

  // Ejercicios ya importados, para marcarlos y no ofrecer importarlos otra vez.
  const importedIds = new Set(state.gymExercises.map((ex) => ex.libraryId).filter(Boolean));

  const matches = gymExerciseLibrary.filter((e) => {
    if (muscle && e.muscleGroup !== muscle && !e.primaryMuscles.includes(muscle)) return false;
    if (equipment && e.equipment !== equipment) return false;
    if (search && !gymNormalizeSearch(e.name).includes(search) && !gymNormalizeSearch(e.nameEn).includes(search)) return false;
    return true;
  });

  list.innerHTML = '';
  const CAP = 80;
  matches.slice(0, CAP).forEach((e) => {
    const meta = [gymMuscleGroupLabel(e.muscleGroup), e.equipment, e.level].filter(Boolean).join(' · ');
    const imported = importedIds.has(e.id);
    const row = document.createElement('div');
    row.className = 'gym-list-item gym-library-item';
    row.innerHTML = `
      <span class="gym-list-item-name">${escapeHtml(e.name)}${meta ? ` <span class="gym-list-item-muted">(${escapeHtml(meta)})</span>` : ''}</span>
      <div class="gym-list-item-actions">
        ${imported
          ? '<span class="gym-library-imported">✓ Importado</span>'
          : `<button type="button" class="secondary-btn gym-library-import-btn" data-import-gym-library="${escapeHtml(e.id)}">+ Importar</button>`}
      </div>
    `;
    // La fila entera abre la ficha (o, en modo elegir, elige directamente);
    // el boton de importar corta la propagacion.
    row.addEventListener('click', () => {
      if (gymLibraryPickCallback) {
        const cb = gymLibraryPickCallback;
        gymLibraryPickCallback = null;
        closeGymLibraryModal();
        cb(e);
        return;
      }
      openGymLibraryDetail(e);
    });
    list.appendChild(row);
  });
  if (matches.length === 0) {
    list.innerHTML = '<p class="empty-hint">Ningún ejercicio coincide con la búsqueda.</p>';
  } else if (matches.length > CAP) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = `Mostrando ${CAP} de ${matches.length} — afina la búsqueda para ver el resto.`;
    list.appendChild(hint);
  }
  list.querySelectorAll('[data-import-gym-library]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (gymLibraryPickCallback) {
        const entry = gymExerciseLibrary.find((e) => e.id === btn.dataset.importGymLibrary);
        const cb = gymLibraryPickCallback;
        gymLibraryPickCallback = null;
        closeGymLibraryModal();
        if (entry) cb(entry);
        return;
      }
      await importGymLibraryExercise(btn.dataset.importGymLibrary);
      renderGymLibraryList();
    });
  });
}

// Importa un ejercicio de la libreria a gym_exercises. El backend es
// idempotente por libraryId (reimportar devuelve el existente), asi que
// llamar esto dos veces no duplica nada.
async function importGymLibraryExercise(libraryId) {
  const entry = gymExerciseLibrary.find((e) => e.id === libraryId);
  if (!entry) return;
  await api('/api/gym-exercises', {
    method: 'POST',
    body: JSON.stringify({
      name: entry.name,
      muscleGroup: entry.muscleGroup,
      equipment: entry.equipment,
      libraryId: entry.id,
      secondaryMuscles: entry.secondaryMuscles,
    }),
  });
  await loadGymExercises();
  renderGymExercisesList();
}

async function openGymLibraryModal() {
  document.getElementById('gym-library-modal').classList.remove('hidden');
  const list = document.getElementById('gym-library-list');
  if (!gymExerciseLibrary) {
    list.innerHTML = '<p class="empty-hint">Cargando librería…</p>';
    try {
      await loadGymExerciseLibrary();
    } catch (err) {
      list.innerHTML = '';
      showAppAlert(err.message);
      return;
    }
    // El filtro de material se construye con lo que de verdad hay en el
    // dataset (y solo la primera vez, el JSON no cambia en caliente).
    const equipments = [...new Set(gymExerciseLibrary.map((e) => e.equipment).filter(Boolean))].sort();
    gymLibraryEquipmentField.setOptions([
      { value: '', label: 'Todo el material' },
      ...equipments.map((eq) => ({ value: eq, label: eq })),
    ]);
  }
  renderGymLibraryList();
}
function closeGymLibraryModal() {
  document.getElementById('gym-library-modal').classList.add('hidden');
  // Si se cierra sin elegir estando en modo elegir, el callback se tira
  // (cancelar la eleccion no debe dejar el modo pegado para despues).
  gymLibraryPickCallback = null;
}
document.getElementById('btn-open-gym-library').addEventListener('click', openGymLibraryModal);
document.getElementById('btn-close-gym-library').addEventListener('click', closeGymLibraryModal);
document.getElementById('gym-library-search').addEventListener('input', () => renderGymLibraryList());

// "+ Crear ejercicio propio" desde el buscador (peticion de Koku: la
// libreria es una propuesta, no un limite). Si el buscador estaba en
// modo elegir (el + del entreno en vivo), se recuerda con el flag para
// que el ejercicio recien creado entre directo a la sesion al guardar.
document.getElementById('btn-gym-library-new-custom').addEventListener('click', () => {
  gymExerciseAddToLivePending = !!gymLibraryPickCallback;
  closeGymLibraryModal();
  openGymExerciseModal(null);
});

// --- Ficha de un ejercicio de la libreria ------------------------------
let gymLibraryDetailEntry = null;
function openGymLibraryDetail(entry) {
  gymLibraryDetailEntry = entry;
  document.getElementById('gym-library-detail-title').textContent = entry.name;
  const meta = [
    gymMuscleGroupLabel(entry.muscleGroup),
    entry.secondaryMuscles.length ? `secundarios: ${entry.secondaryMuscles.map(gymMuscleGroupLabel).join(', ')}` : null,
    entry.equipment,
    entry.level,
    entry.category,
  ].filter(Boolean).join(' · ');
  document.getElementById('gym-library-detail-meta').textContent = `${meta} · (${entry.nameEn})`;
  const listEl = document.getElementById('gym-library-detail-instructions');
  listEl.innerHTML = '';
  if (entry.instructions.length === 0) {
    listEl.innerHTML = '<p class="empty-hint">Este ejercicio no trae instrucciones.</p>';
  } else {
    entry.instructions.forEach((step) => {
      const li = document.createElement('li');
      li.textContent = step;
      listEl.appendChild(li);
    });
  }
  document.getElementById('gym-library-detail-modal').classList.remove('hidden');
}
function closeGymLibraryDetail() {
  document.getElementById('gym-library-detail-modal').classList.add('hidden');
}
document.getElementById('btn-close-gym-library-detail').addEventListener('click', closeGymLibraryDetail);
document.getElementById('btn-close-gym-library-detail-2').addEventListener('click', closeGymLibraryDetail);
document.getElementById('btn-import-gym-library-detail').addEventListener('click', async () => {
  if (!gymLibraryDetailEntry) return;
  await importGymLibraryExercise(gymLibraryDetailEntry.id);
  closeGymLibraryDetail();
  renderGymLibraryList();
});

// --- Actividad rapida (Fase 4 del rediseno) ---------------------------
// Cardio/clases/deporte sin series: tipo + nombre + duracion + fecha.
// Se guarda como una gym_session con type='activity' (misma tabla que
// los entrenos, ver el comentario del esquema) para que heatmap/racha
// tengan una sola fuente de "dias con actividad".
const GYM_ACTIVITY_KINDS = [
  { id: 'cardio', label: 'Cardio' },
  { id: 'clase', label: 'Clase dirigida' },
  { id: 'deporte', label: 'Deporte' },
  { id: 'otro', label: 'Otro' },
];
function gymActivityKindLabel(kind) {
  const found = GYM_ACTIVITY_KINDS.find((k) => k.id === kind);
  return found ? found.label : 'Actividad';
}
const gymActivityKindField = createSelectField({
  options: GYM_ACTIVITY_KINDS.map((k) => ({ value: k.id, label: k.label })),
  initialValue: 'cardio',
});
document.getElementById('gym-activity-kind-field').appendChild(gymActivityKindField.element);
const gymActivityDateField = createDateField({ initialValue: new Date() });
document.getElementById('gym-activity-date-field').appendChild(gymActivityDateField.element);

function openGymActivityModal(session) {
  document.getElementById('gym-activity-modal-title').textContent = session ? 'Editar actividad' : 'Actividad rápida';
  document.getElementById('gym-activity-id').value = session ? session.id : '';
  document.getElementById('gym-activity-name').value = session ? session.activityName || '' : '';
  document.getElementById('gym-activity-duration').value = session && session.durationSeconds ? Math.round(session.durationSeconds / 60) : '';
  gymActivityKindField.setValue(session && session.activityKind ? session.activityKind : 'cardio');
  gymActivityDateField.setValue(session ? new Date(`${session.date}T00:00:00`) : new Date());
  document.getElementById('btn-delete-gym-activity').classList.toggle('hidden', !session);
  document.getElementById('gym-activity-modal').classList.remove('hidden');
}
function closeGymActivityModal() {
  document.getElementById('gym-activity-modal').classList.add('hidden');
}
document.getElementById('btn-new-gym-activity').addEventListener('click', () => openGymActivityModal(null));
document.getElementById('btn-cancel-gym-activity').addEventListener('click', closeGymActivityModal);
document.getElementById('btn-close-gym-activity').addEventListener('click', closeGymActivityModal);

document.getElementById('gym-activity-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('gym-activity-id').value;
  const minutes = Number(document.getElementById('gym-activity-duration').value);
  const payload = {
    date: toDateKey(gymActivityDateField.getValue()),
    type: 'activity',
    activityKind: gymActivityKindField.getValue(),
    activityName: document.getElementById('gym-activity-name').value,
    durationSeconds: minutes > 0 ? minutes * 60 : null,
  };
  if (id) {
    await api(`/api/gym-sessions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/gym-sessions', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeGymActivityModal();
  await loadGymSessions();
  renderGymSessionsList();
  checkGymAchievements();
});

document.getElementById('btn-delete-gym-activity').addEventListener('click', async () => {
  const id = document.getElementById('gym-activity-id').value;
  const ok = await showAppConfirm('¿Eliminar esta actividad?', { okText: 'Eliminar', danger: true });
  if (!ok) return;
  await api(`/api/gym-sessions/${id}`, { method: 'DELETE' });
  closeGymActivityModal();
  await loadGymSessions();
  renderGymSessionsList();
});

// --- Modo entrenar en vivo (Fase 3 del rediseno) ----------------------
// El estado del entrenamiento en curso vive en localStorage
// (gymLiveSession) y se reescribe entero en CADA cambio -- asi una
// recarga o un cierre de la app a mitad de entreno no pierde nada, y al
// volver aparece el boton de "continuar". Solo al Terminar se convierte
// en una sesion de verdad (POST /api/gym-sessions) y se limpia.
//
// Los tiempos (cronometro de sesion y descanso) se calculan SIEMPRE
// desde timestamps guardados (startedAt / restUntil), nunca sumando
// ticks: en iOS el JS se congela con la app en segundo plano y un
// contador de ticks se quedaria atras al volver.
let gymLiveSession = null;      // espejo en memoria de localStorage.gymLiveSession
let gymLiveTicker = null;       // setInterval de 1s SOLO para repintar reloj/descanso
let gymLivePrevSets = new Map();// exerciseId -> { date, sets } para la columna "Anterior"

function gymLiveStore() {
  localStorage.setItem('gymLiveSession', JSON.stringify(gymLiveSession));
}
function gymLiveReadStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem('gymLiveSession'));
    return parsed && typeof parsed === 'object' && parsed.startedAt ? parsed : null;
  } catch {
    return null;
  }
}
// Alterna el boton grande de "Empezar" y el banner de "continuar" segun
// haya o no un entrenamiento a medias guardado.
function refreshGymLiveButtons() {
  const stored = gymLiveReadStored();
  document.getElementById('btn-gym-live-resume').classList.toggle('hidden', !stored);
  document.getElementById('btn-gym-live-start').classList.toggle('hidden', !!stored);
  refreshGymLiveIndicators();
}
// Con un entrenamiento activo, el boton "Herramientas" de la nav y la
// tarjeta de Gimnasio se marcan en el color de acento con un puntito,
// para que se vea de un vistazo que hay un entreno en marcha.
function refreshGymLiveIndicators() {
  const active = !!gymLiveReadStored();
  const navBtn = document.querySelector('[data-mobile-nav="extensions"]');
  if (navBtn) navBtn.classList.toggle('gym-live-indicator', active);
  const gymCard = document.getElementById('btn-open-gym');
  if (gymCard) gymCard.classList.toggle('gym-live-indicator', active);
}

// -- Selector de "que toca hoy" (dias del bloque activo o sesion libre) --
function openGymStartModal() {
  const activeBlock = state.gymBlocks.find((b) => b.isActive);
  const days = activeBlock ? state.gymRoutines.filter((r) => r.blockId === activeBlock.id) : [];
  document.getElementById('gym-start-block-name').textContent = activeBlock
    ? `Bloque activo: ${activeBlock.name}`
    : 'No hay ningún bloque activo — puedes entrenar libre o crear un bloque en la pestaña Plan.';
  const list = document.getElementById('gym-start-days');
  list.innerHTML = '';

  // Si el bloque usa ciclo, lo que toca hoy va PRIMERO y marcado. Aunque
  // hoy toque descanso se sigue pudiendo elegir cualquier dia (decision
  // de Koku: te avisa, pero no te lo impide).
  const cicloHoy = gymCicloDeHoy();
  const aviso = document.getElementById('gym-start-cycle-note');
  if (cicloHoy) {
    aviso.classList.remove('hidden');
    aviso.textContent = cicloHoy.esDescanso
      ? `Hoy toca descanso (día ${cicloHoy.position} de ${cicloHoy.length}). Puedes entrenar igualmente: al terminar te pregunto cómo sigo el ciclo.`
      : `Tu ciclo dice que hoy toca “${cicloHoy.rutina.name}” (día ${cicloHoy.position} de ${cicloHoy.length}).`;
  } else {
    aviso.classList.add('hidden');
    aviso.textContent = '';
  }
  const idDeHoy = cicloHoy && cicloHoy.rutina ? cicloHoy.rutina.id : null;
  const ordenados = idDeHoy
    ? [...days].sort((a, b) => (a.id === idDeHoy ? -1 : 0) - (b.id === idDeHoy ? -1 : 0))
    : days;

  ordenados.forEach((day) => {
    const esDeHoy = day.id === idDeHoy;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gym-list-item gym-start-day-btn' + (esDeHoy ? ' es-de-hoy' : '');
    btn.innerHTML = `
      <span class="color-dot" style="background-color: ${day.color}"></span>
      <span class="gym-list-item-name">${day.icon ? escapeHtml(day.icon) + ' ' : ''}${escapeHtml(day.name)}${esDeHoy ? ' <span class="gym-block-active-badge">Hoy</span>' : ''}</span>
      <span class="gym-list-item-muted">${day.exercises.filter((ex) => !ex.hidden).length} ejercicio${day.exercises.filter((ex) => !ex.hidden).length === 1 ? '' : 's'}</span>
    `;
    btn.addEventListener('click', () => {
      closeGymStartModal();
      startGymLiveSession(day);
    });
    list.appendChild(btn);
  });
  if (days.length === 0 && activeBlock) {
    list.innerHTML = '<p class="empty-hint">El bloque activo no tiene días todavía.</p>';
  }
  document.getElementById('gym-start-modal').classList.remove('hidden');
}
function closeGymStartModal() {
  document.getElementById('gym-start-modal').classList.add('hidden');
}
document.getElementById('btn-gym-live-start').addEventListener('click', openGymStartModal);
document.getElementById('btn-close-gym-start').addEventListener('click', closeGymStartModal);
document.getElementById('btn-gym-start-free').addEventListener('click', () => {
  closeGymStartModal();
  startGymLiveSession(null);
});
document.getElementById('btn-gym-live-resume').addEventListener('click', () => {
  gymLiveSession = gymLiveReadStored();
  if (gymLiveSession) openGymLiveView();
});

// Arranca un entrenamiento nuevo: desde un dia del plan (pre-carga sus
// ejercicios con tantas series como target_sets, solo con el descanso
// sugerido -- reps y peso en blanco a proposito, como el modal manual) o
// completamente libre.
function startGymLiveSession(day) {
  // Solo se pre-cargan los ejercicios VISIBLES del dia; los ocultos
  // quedan en hiddenPool, recuperables desde "Ejercicios ocultos" en el
  // propio entreno (peticion de Koku: aparcar un ejercicio sin borrarlo).
  const visibles = day ? day.exercises.filter((ex) => !ex.hidden) : [];
  gymLiveSession = {
    startedAt: Date.now(),
    routineId: day ? day.id : null,
    routineName: day ? day.name : null,
    restPreset: 90,
    restUntil: null,
    // Para no deslizar durante 40 minutos (Koku): todas las tarjetas
    // nacen RECOGIDAS menos la primera; cada una se pliega/despliega
    // tocando su cabecera, y hay botones de plegar/desplegar todo.
    exercises: visibles.map((ex, i) => ({
        exerciseId: ex.exerciseId,
        note: '',
        rpe: '',
        collapsed: i > 0,
        sets: gymBuildSetsForExercise(ex.exerciseId, ex.targetSets, ex.targetRestSeconds ?? ''),
      })),
    hiddenPool: day
      ? day.exercises.filter((ex) => ex.hidden).map((ex) => ({
          exerciseId: ex.exerciseId,
          targetSets: ex.targetSets,
          targetRestSeconds: ex.targetRestSeconds,
        }))
      : [],
  };
  gymLiveStore();
  openGymLiveView();
  // La ayuda se abre sola SOLO al iniciar un entrenamiento nuevo (aqui),
  // no cada vez que se vuelve a el tras moverse por la app -- eso
  // molestaba (feedback de Koku). Hasta que marque "no volver a
  // mostrar"; el boton "?" la abre cuando quiera.
  if (localStorage.getItem('gymLiveHelpSeen') !== '1') openGymHelpModal();
  // Cuanto suele llevarte este dia, como aviso que se va solo. Va al
  // final y sin esperar a nada (peticion de Koku: "un texto arriba que
  // se va y diga algo de tiempo estimado"): si las medias todavia no
  // estan cargadas se piden aqui, y si tampoco hay nada que decir el
  // aviso sencillamente no sale.
  if (day) gymAvisarDeLaDuracion(day);
}

// Las medias se cargan al abrir el Gimnasio, pero al entreno se puede
// llegar sin pasar por ahi (el widget, la mini-barra de descanso). Esto
// las pide si faltan y luego enseña el aviso; si falla, no pasa nada:
// el aviso es un extra, no puede estropear el arranque de un entreno.
async function gymAvisarDeLaDuracion(day) {
  try {
    if (!gymSetTimes) await loadGymSetTimes();
    mostrarAvisoFlotante(gymTextoDeDuracion(day));
  } catch (err) {
    console.error('No se pudo estimar la duración del entreno:', err);
  }
}

// La pantalla en la que estabas antes de entrar al entreno, para
// devolver la barra de abajo a su sitio al salir. Se guarda aqui y no en
// localStorage porque solo vale mientras el entreno esta a la vista.
let pantallaAntesDelEntreno = null;

async function openGymLiveView() {
  // La barra de abajo tiene que marcar el Gimnasio mientras el entreno
  // esta delante. Pasaba sobre todo entrando desde la mini-barra de
  // descanso (Koku: "me lleva a la vista pero en la barra sigue
  // marcando que estoy en calendario"): esa barra abre el entreno
  // directamente, sin pasar por openGymView, que es quien avisaba.
  if (document.getElementById('gym-live-view').classList.contains('hidden')) {
    pantallaAntesDelEntreno = localStorage.getItem('currentScreen') || 'calendar';
    setCurrentScreen('gym');
  }
  document.getElementById('gym-live-title').textContent = gymLiveSession.routineName || 'Sesión libre';
  document.getElementById('gym-live-view').classList.remove('hidden');
  renderGymLiveExercises();
  // Columna "Anterior": se pide en paralelo para cada ejercicio y se
  // repinta cuando llega (si no hay historial, la columna queda en "—").
  gymLivePrevSets = new Map();
  await Promise.all(gymLiveSession.exercises.map(async (ex) => {
    const prev = await api(`/api/gym-sessions/last-sets/${ex.exerciseId}`);
    gymLivePrevSets.set(ex.exerciseId, prev);
  }));
  renderGymLiveExercises();
  if (gymLiveTicker) clearInterval(gymLiveTicker);
  gymLiveTicker = setInterval(gymLiveTick, 1000);
  refreshGymLivePauseUi();
  gymLiveTick();
}
function closeGymLiveView() {
  document.getElementById('gym-live-view').classList.add('hidden');
  // Debajo del entreno sigue estando la pantalla desde la que entraste
  // (el calendario, por ejemplo): la barra vuelve a marcarla.
  if (pantallaAntesDelEntreno) {
    setCurrentScreen(pantallaAntesDelEntreno);
    pantallaAntesDelEntreno = null;
  }
  // El ticker NO se para: sigue moviendo la mini-barra de descanso
  // global mientras te mueves por la app. Se para al terminar/descartar.
  refreshGymLiveButtons();
  gymLiveTick();
}
function gymLiveStopTicker() {
  if (gymLiveTicker) { clearInterval(gymLiveTicker); gymLiveTicker = null; }
  document.getElementById('gym-global-rest').classList.add('hidden');
  document.body.classList.remove('gym-rest-push');
  // Si quedaba un aviso de descanso programado (o su tarjeta en la
  // pantalla de bloqueo, o la vigilancia de audio), ya no tienen
  // sentido: el entreno se ha terminado o descartado.
  gymCancelRestNotification();
  gymEndRestLiveActivity();
  gymCancelRestAudioWatch();
}

// Un tick por segundo mientras el overlay esta abierto: reloj de sesion
// y cuenta atras del descanso, ambos derivados de timestamps.
// "(2)" = 2 minutos justos de descanso, "(1:30)" = minuto y medio --
// formato corto para la columna Anterior (peticion de Koku).
function gymFormatRestShort(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return s === 0 ? `${m}` : `${m}:${String(s).padStart(2, '0')}`;
}
// Un tiempo de descanso "para ensenar", respetando el formato elegido en
// Configuracion (m:ss o segundos a secas -- mismo ajuste gymRestFormat
// que alterna el contador tocandolo).
// Tiempo de trabajo acumulado: en segundos si es poco, en minutos si ya
// pasa del minuto ("45s", "6 min").
// Lo que duro UNA serie, con los segundos a la vista: "45 s",
// "1 min 3 s". Distinto de gymFormatWorkTime, que agrega meses enteros y
// ahi los segundos sobran (peticion de Koku: "Duración: 1min 3s").
function gymFormatSetDuration(totalSeconds) {
  const n = Math.round(Number(totalSeconds) || 0);
  if (n < 60) return `${n} s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

function gymFormatWorkTime(totalSeconds) {
  const n = Math.round(Number(totalSeconds) || 0);
  if (n < 60) return `${n}s`;
  return `${Math.round(n / 60)} min`;
}
function gymFormatRestDisplay(totalSeconds) {
  const n = Number(totalSeconds);
  if (!n) return '';
  return localStorage.getItem('gymRestFormat') === 'sec' ? `${n}s` : gymLiveFormatClock(n);
}
function gymLiveFormatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
// Tiempo de sesion transcurrido DESCONTANDO las pausas: pausedMs acumula
// las pausas ya cerradas, y pausedAt marca la pausa en curso (si la hay).
// Todo con timestamps, como siempre -- sobrevive a recargas y al
// congelado de iOS en segundo plano.
function gymLiveElapsedSeconds() {
  const pausedMs = (gymLiveSession.pausedMs || 0) +
    (gymLiveSession.pausedAt ? Date.now() - gymLiveSession.pausedAt : 0);
  return Math.max(0, Math.floor((Date.now() - gymLiveSession.startedAt - pausedMs) / 1000));
}

function gymLiveTick() {
  if (!gymLiveSession) return;
  // Red de seguridad: una serie en curso de un ejercicio que ya no esta
  // en el entreno no puede quedarse ahi (bloquearia empezar cualquier
  // otra). Normalmente lo limpia quien quita el ejercicio; esto cubre
  // sesiones guardadas por versiones anteriores.
  if (gymLiveSession.activeSet
      && !gymLiveSession.exercises.some((e) => e.exerciseId === gymLiveSession.activeSet.exerciseId)) {
    gymLiveSession.activeSet = null;
    gymLiveStore();
    renderGymLiveExercises();
  }
  const clock = document.getElementById('gym-live-clock');
  clock.textContent = gymLiveFormatClock(gymLiveElapsedSeconds());
  clock.classList.toggle('paused', !!gymLiveSession.pausedAt);

  // Mientras corre un descanso, sondear cada 2s los +30s pendientes del
  // boton de la pantalla de bloqueo. Hace falta ADEMAS de los eventos de
  // volver a primer plano: al bajar la barra de notificaciones la app no
  // llega a irse a segundo plano, asi que no hay ningun "resume" que
  // dispare la recogida -- y los segundos se quedaban sin aplicar hasta
  // que el tiempo normal acababa (bug que vio Koku). La llamada es
  // baratisima (leer un contador) y solo corre durante el descanso.
  if (gymLiveSession.restUntil && Date.now() - gymLastExtensionPoll > 2000) {
    gymLastExtensionPoll = Date.now();
    gymConsumeRestExtensionFromLockScreen();
  }

  // Cronometro de la serie en curso: se actualiza el texto en vez de
  // repintar la tarjeta entera cada segundo.
  const setTimers = document.querySelectorAll('[data-live-set-timer]');
  if (setTimers.length > 0) {
    const t = gymLiveFormatClock(gymActiveSetSeconds());
    setTimers.forEach((el) => { el.textContent = t; });
  }
  const endTimer = document.getElementById('gym-set-end-timer');
  if (endTimer && !document.getElementById('gym-set-end-modal').classList.contains('hidden')) {
    endTimer.textContent = gymLiveFormatClock(gymActiveSetSeconds());
  }

  // Mini-barra global: cuando el entreno esta OCULTO y hay algo en
  // marcha -- una serie corriendo o un descanso.
  const liveHidden = document.getElementById('gym-live-view').classList.contains('hidden');
  const globalBar = document.getElementById('gym-global-rest');
  const globalLabel = document.getElementById('gym-global-rest-label');
  if (liveHidden && gymLiveSession.activeSet) {
    // Serie en curso: la barra ensena su cronometro (llena, sin cuenta
    // atras) y tocarla vuelve al entreno para poder terminarla.
    globalLabel.textContent = gymLiveSession.activeSet.pausedAt ? 'Serie en pausa' : 'Serie';
    document.getElementById('gym-global-rest-remaining').textContent = gymLiveFormatClock(gymActiveSetSeconds());
    document.getElementById('gym-global-rest-fill-base').style.width = '100%';
    document.getElementById('gym-global-rest-fill-extra').style.width = '0%';
    globalBar.classList.remove('hidden');
    document.documentElement.style.setProperty('--gym-rest-offset', `${globalBar.offsetHeight}px`);
    document.body.classList.add('gym-rest-push');
  } else if (liveHidden && gymIndiceDelEjercicioEnEspera() >= 0) {
    // Descanso terminado y serie pendiente: la barra deja de ser una
    // cuenta atras y pasa a ser el aviso de "te toca". Tocarla arranca
    // la serie directamente, sin tener que volver antes al entreno.
    const iEspera = gymIndiceDelEjercicioEnEspera();
    const exEspera = gymLiveSession.exercises[iEspera];
    globalLabel.textContent = `Empezar serie ${gymSetSerieNumber(exEspera, gymNextPendingSetIndex(exEspera))}`;
    document.getElementById('gym-global-rest-remaining').textContent = '▶';
    document.getElementById('gym-global-rest-fill-base').style.width = '100%';
    document.getElementById('gym-global-rest-fill-extra').style.width = '0%';
    globalBar.classList.add('is-ready');
    globalBar.classList.remove('hidden');
    document.documentElement.style.setProperty('--gym-rest-offset', `${globalBar.offsetHeight}px`);
    document.body.classList.add('gym-rest-push');
  } else if (liveHidden && gymLiveSession.restUntil && gymLiveSession.restUntil > Date.now()) {
    globalBar.classList.remove('is-ready');
    globalLabel.textContent = 'Descanso';
    // floor y no ceil: la tarjeta de la pantalla de bloqueo redondea
    // HACIA ABAJO (estilo reloj del sistema: un temporizador de 1:00
    // ensena 0:59 nada mas empezar), y con ceil la app iba un segundo
    // "por detras" (feedback de Koku). Mismo criterio en los dos sitios.
    const gRemaining = Math.max(0, Math.floor((gymLiveSession.restUntil - Date.now()) / 1000));
    document.getElementById('gym-global-rest-remaining').textContent =
      localStorage.getItem('gymRestFormat') === 'sec' ? `${gRemaining}s` : gymLiveFormatClock(gRemaining);
    const gBase = gymLiveSession.restBaseSeconds || gRemaining;
    const gExtra = gymLiveSession.restExtraSeconds || 0;
    const gPlanned = Math.max(1, gBase + gExtra);
    const gBaseRemaining = Math.max(0, gRemaining - gExtra);
    document.getElementById('gym-global-rest-fill-base').style.width = `${(gBaseRemaining / gPlanned) * 100}%`;
    document.getElementById('gym-global-rest-fill-extra').style.width = `${((gRemaining - gBaseRemaining) / gPlanned) * 100}%`;
    globalBar.classList.remove('hidden');
    // Con la barra visible, la interfaz entera baja lo que mide la barra
    // para que no tape nada (ver body.gym-rest-push en styles.css). La
    // altura se mide DESPUES de mostrarla (oculta mediria 0), cada tick:
    // es barata y asi se adapta si cambia (giro de pantalla, etc.).
    document.documentElement.style.setProperty('--gym-rest-offset', `${globalBar.offsetHeight}px`);
    document.body.classList.add('gym-rest-push');
  } else {
    globalBar.classList.add('hidden');
    globalBar.classList.remove('is-ready');
    document.body.classList.remove('gym-rest-push');
  }

  const bar = document.getElementById('gym-live-rest-bar');
  if (gymLiveSession.restUntil && gymLiveSession.restUntil > Date.now()) {
    // floor, como la tarjeta de bloqueo (ver el comentario de gRemaining).
    const remaining = Math.max(0, Math.floor((gymLiveSession.restUntil - Date.now()) / 1000));
    document.getElementById('gym-live-rest-remaining').textContent =
      localStorage.getItem('gymRestFormat') === 'sec' ? `${remaining}s` : gymLiveFormatClock(remaining);
    // Si la sesion en curso venia de una version sin restBaseSeconds, se
    // rellena UNA vez con el restante actual y se guarda -- sin esto el
    // total se recalculaba en cada tick y la barra se quedaba llena.
    if (!gymLiveSession.restBaseSeconds) {
      gymLiveSession.restBaseSeconds = remaining;
      gymLiveStore();
    }
    // Barra: el descanso planificado son base + extra; el tramo base se
    // vacia primero y el extra (los +30s) al final, en otro color.
    const baseTotal = gymLiveSession.restBaseSeconds;
    const extraTotal = gymLiveSession.restExtraSeconds || 0;
    const planned = Math.max(1, baseTotal + extraTotal);
    const baseRemaining = Math.max(0, remaining - extraTotal);
    const extraRemaining = remaining - baseRemaining;
    document.getElementById('gym-live-rest-fill-base').style.width = `${(baseRemaining / planned) * 100}%`;
    document.getElementById('gym-live-rest-fill-extra').style.width = `${(extraRemaining / planned) * 100}%`;
    bar.classList.remove('hidden');
  } else {
    if (gymLiveSession.restUntil && !gymRestExpiryPending) {
      // OJO, orden importante (bug real): antes de dar el descanso por
      // vencido hay que RECOGER los +30s que se hayan pulsado en la
      // pantalla de bloqueo. Si no, al despertar la app (incluso cuando
      // iOS la lanza en segundo plano para ejecutar el boton), este tick
      // veia el restUntil viejo ya vencido, mataba la tarjeta y tiraba
      // los segundos sin aplicarlos -- "es como si no lo hubiera hecho".
      gymRestExpiryPending = true;
      gymConsumeRestExtensionFromLockScreen().finally(() => {
        gymRestExpiryPending = false;
        if (gymLiveSession && gymLiveSession.restUntil && gymLiveSession.restUntil <= Date.now()) {
          gymLiveSession.restUntil = null;
          // Momento en que se acabo: enciende el aviso de "te toca" y,
          // si esta puesto, arranca la siguiente serie sola.
          gymLiveSession.restEndedAt = Date.now();
          gymLiveStore();
          // Ahora si: el descanso termino de verdad, fuera la tarjeta.
          gymEndRestLiveActivity();
          gymAvisarFinDeDescanso();
          gymLiveTick();
        }
      });
    }
    bar.classList.add('hidden');
  }
}
// --- Al acabar el descanso: que no se te pase la siguiente serie ------
// Koku: "cada vez que acaba el tiempo de descanso se me olvida darle a
// empezar serie". Dos cosas, y las dos a la vez (eligio las dos):
//   1. SIEMPRE: el boton "Empezar serie N" del ejercicio cuyo descanso
//      acaba de terminar se pone grande y llamativo, y la mini-barra
//      global pasa a decir "Empezar serie N" (tocarla la arranca desde
//      donde estes, sin tener que volver a mano al entreno).
//   2. OPCIONAL (Configuracion > Notificaciones, apagado de fabrica):
//      que la serie arranque SOLA. Solo si queda alguna pendiente --
//      nunca inventa una serie extra, que es lo que hace gymStartSet
//      cuando ya estan todas hechas.
// El aviso se apaga solo en cuanto empieza una serie (gymStartSet limpia
// restEndedAt), asi que no se queda encendido para siempre.

// El ejercicio al que "le toca" ahora: el del descanso que acaba de
// terminar. gymLiveSession.restSetRef ya apunta a la serie cuyo descanso
// estaba corriendo, y NO se borra al vencer, asi que sigue sirviendo.
function gymIndiceDelEjercicioEnEspera() {
  if (!gymLiveSession || !gymLiveSession.restEndedAt || gymLiveSession.activeSet) return -1;
  const ref = gymLiveSession.restSetRef;
  if (!ref) return -1;
  const i = gymLiveSession.exercises.findIndex((e) => e.exerciseId === ref.exerciseId);
  if (i < 0) return -1;
  // Sin serie pendiente no hay nada que anunciar (el ejercicio se acabo).
  return gymNextPendingSetIndex(gymLiveSession.exercises[i]) >= 0 ? i : -1;
}

function gymAutoStartEnabled() {
  return localStorage.getItem('gymAutoStartNextSet') === 'true';
}

// Se llama justo despues de dar el descanso por vencido.
function gymAvisarFinDeDescanso() {
  const i = gymIndiceDelEjercicioEnEspera();
  if (i < 0) return;
  if (gymAutoStartEnabled()) {
    gymStartSet(i);
    renderGymLiveExercises();
    return;
  }
  renderGymLiveExercises();
}

// Evita encolar mil recogidas mientras la primera esta en camino.
let gymRestExpiryPending = false;
// Ultimo sondeo de +30s pendientes (ver gymLiveTick).
let gymLastExtensionPoll = 0;

document.getElementById('btn-gym-live-rest-plus').addEventListener('click', () => {
  if (gymLiveSession && gymLiveSession.restUntil) {
    gymLiveSession.restUntil += 30000;
    gymLiveSession.restExtraSeconds = (gymLiveSession.restExtraSeconds || 0) + 30;
    // El extra se le apunta a la serie cuyo descanso esta corriendo, para
    // que el historial pueda ensenar "Serie 1: +60s" (peticion de Koku).
    const ref = gymLiveSession.restSetRef;
    if (ref) {
      const refEx = gymLiveSession.exercises.find((x) => x.exerciseId === ref.exerciseId);
      const refSet = refEx && refEx.sets[ref.setIndex];
      if (refSet) refSet.extraRest = (refSet.extraRest || 0) + 30;
    }
    gymLiveStore();
    gymLiveTick();
    // El aviso programado apuntaba al final antiguo: se reprograma.
    gymScheduleRestNotification();
    // Y la tarjeta de la pantalla de bloqueo pasa a contar hasta el
    // nuevo final, igual que la vigilancia de audio.
    gymUpdateRestLiveActivity();
    gymUpdateRestAudioWatch();
  }
});
// El tiempo restante se puede ver como m:ss o como segundos a secas
// (peticion de Koku) -- se alterna tocandolo, y se recuerda por
// dispositivo.
document.getElementById('gym-live-rest-remaining').addEventListener('click', () => {
  const next = localStorage.getItem('gymRestFormat') === 'sec' ? 'min' : 'sec';
  localStorage.setItem('gymRestFormat', next);
  gymLiveTick();
});
document.getElementById('btn-gym-live-rest-close').addEventListener('click', () => {
  if (gymLiveSession) {
    gymLiveSession.restUntil = null;
    gymLiveStore();
    gymLiveTick();
    gymCancelRestNotification();
    gymEndRestLiveActivity();
    gymCancelRestAudioWatch();
  }
});

// --- Aviso al terminar el descanso -------------------------------------
// En la app instalada, al arrancar un descanso se PROGRAMA una
// notificacion del sistema para el momento en que acaba (mismo mecanismo
// que los recordatorios, ver local-notifications.js): suena/vibra segun
// los ajustes del telefono aunque la pantalla este bloqueada o estes en
// otra app, asi no hay que estar mirando el movil a ver cuanto queda.
// En un navegador normal no hay plugin y esto no hace nada.
//
// El id es uno RESERVADO fijo: como siempre es el mismo, programar el
// siguiente descanso sustituye al anterior sin acumular avisos, y
// syncScheduledReminders() sabe que no debe cancelarlo al reprogramar
// los recordatorios (ids >= 999999900 son internos, no eventos).
const GYM_REST_NOTIFICATION_ID = 999999901;
// Modo insistente (peticion de Koku: "una vibracion a veces no se nota,
// si esta un rato si"): iOS no permite alargar la vibracion de una
// notificacion ni sonar "como el temporizador del sistema" (eso son
// alertas criticas, que requieren un permiso especial de Apple), asi que
// el truco es repetir el aviso: 3 notificaciones seguidas separadas 2s
// (ids 999999901/902/903, todos en el rango reservado). Se apaga en
// Configuracion > Notificaciones.
const GYM_REST_NOTIFICATION_IDS = [999999901, 999999902, 999999903];

function gymRestNotifyEnabled() {
  return localStorage.getItem('gymRestNotify') !== 'false';
}
function gymRestBurstEnabled() {
  return localStorage.getItem('gymRestBurst') !== 'false';
}

// atMs: cuando debe saltar. Por defecto, el final del descanso en curso;
// se puede pasar a mano para el boton de PROBAR el aviso de
// Configuracion (que recorre exactamente este mismo camino).
async function gymScheduleRestNotification(atMs = null) {
  if (typeof getLocalNotificationsPlugin !== 'function') return;
  const plugin = getLocalNotificationsPlugin();
  if (!plugin || !gymRestNotifyEnabled()) return;
  const cuando = atMs || (gymLiveSession && gymLiveSession.restUntil);
  if (!cuando) return;
  try {
    if (!(await ensureLocalNotificationPermissionSilently())) return;
    // Cancelar antes de programar: si habia avisos del descanso anterior
    // aun pendientes, no deben sonar ademas de los nuevos.
    await plugin.cancel({ notifications: GYM_REST_NOTIFICATION_IDS.map((id) => ({ id })) });
    // Sonido/vibracion/silencio segun el ajuste del dispositivo -- ver
    // notificationSoundValue() en local-notifications.js.
    const sonido = notificationSoundValue();
    // UNA sola notificacion. La insistencia ya no se hace repitiendo
    // avisos (a Koku le molestaba ver 3 notificaciones): ahora la pone la
    // vibracion larga nativa de RestAudioWatcher, que puede repetir la
    // vibracion del sistema sin notificar nada porque la app sigue
    // despierta durante el descanso.
    const aviso = {
      id: GYM_REST_NOTIFICATION_ID,
      title: 'Descanso terminado',
      body: 'Siguiente serie.',
      schedule: { at: new Date(cuando) },
      threadIdentifier: 'gym-descanso',
    };
    if (sonido) aviso.sound = sonido;
    await plugin.schedule({ notifications: [aviso] });
  } catch (err) {
    console.error('No se pudo programar el aviso de descanso:', err);
  }
}

async function gymCancelRestNotification() {
  if (typeof getLocalNotificationsPlugin !== 'function') return;
  const plugin = getLocalNotificationsPlugin();
  if (!plugin) return;
  try {
    await plugin.cancel({ notifications: GYM_REST_NOTIFICATION_IDS.map((id) => ({ id })) });
  } catch (err) {
    console.error('No se pudo cancelar el aviso de descanso:', err);
  }
}

// Al volver a la app, el aviso de "Descanso terminado" ya ha cumplido su
// funcion: quitarlo del centro de notificaciones. Antes solo se quitaban
// las repeticiones (902/903) y el principal (901) se quedaba puesto, asi
// que habia que borrarlo A MANO cada vez -- lo pidio Koku: "si hay una
// notificacion y entro en la app, que se borre".
//
// Se hace en el foreground, que cubre los dos casos de una vez: tocar el
// aviso abre la app (y de paso iOS ya lo retira), y volver a la app por
// tu cuenta lo limpia igual. Se limita a los avisos del DESCANSO (los
// ids reservados): los recordatorios de eventos no se tocan, se quedan
// hasta que los quites tu (decision de Koku frente a limpiarlo todo).
//
// Ojo: esto NO pelea con la vigilancia de audio que para la vibracion
// (RestAudioWatcher sondea getDeliveredNotifications y se detiene cuando
// el aviso desaparece). Abrir la app ya callaba la vibracion, asi que
// quitar el aviso aqui va en la misma direccion.
async function gymCleanupRestNotificationStack() {
  if (typeof getLocalNotificationsPlugin !== 'function') return;
  const plugin = getLocalNotificationsPlugin();
  if (!plugin || typeof plugin.removeDeliveredNotifications !== 'function') return;
  try {
    await plugin.removeDeliveredNotifications({
      notifications: GYM_REST_NOTIFICATION_IDS.map((id) => ({ id })),
    });
  } catch (err) {
    // Limpiar es cosmetico: si falla, no pasa nada.
  }
}

// --- Live Activity del descanso (pantalla de bloqueo) ------------------
// La cuenta atras EN VIVO en la pantalla de bloqueo y la isla dinamica
// (peticion de Koku). Habla con el plugin nativo LiveActivityPlugin
// (ios/App/App/LiveActivityPlugin.swift); el dibujo lo hace la extension
// DescansoWidget. La gracia: la app solo manda las FECHAS de inicio y
// fin -- la cuenta atras y la barra las mueve iOS solo, aunque la app
// este congelada y el movil bloqueado. Requiere iOS 16.2; en moviles
// anteriores (o en navegador) estas funciones no hacen nada.
let gymLiveActivityPlugin = null;
function getGymLiveActivityPlugin() {
  if (gymLiveActivityPlugin) return gymLiveActivityPlugin;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  if (window.capacitorExports && typeof window.capacitorExports.registerPlugin === 'function') {
    gymLiveActivityPlugin = window.capacitorExports.registerPlugin('LiveActivity');
  }
  return gymLiveActivityPlugin;
}

// Colores del tema activo, para que la tarjeta de la pantalla de bloqueo
// siga el estilo de la app entera (peticion de Koku): acento + fondo de
// tarjeta (surface) + su texto emparejado.
function gymThemeColorHex(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}
function gymCurrentAccentHex() {
  return gymThemeColorHex('--accent', '#5b8cff');
}
// Mezcla dos colores hex (el equivalente JS del color-mix del CSS): es
// EXACTAMENTE la formula del tramo extra de la barra de la app
// (color-mix(in srgb, var(--accent) 45%, var(--surface-text))), para que
// la tarjeta de la pantalla de bloqueo use el mismo color (peticion de
// Koku: nada de naranja).
function gymMixHex(hexA, hexB, weightA) {
  const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [parse(hexA), parse(hexB)];
  return '#' + a.map((va, i) =>
    Math.round(va * weightA + b[i] * (1 - weightA)).toString(16).padStart(2, '0')
  ).join('');
}

// Fechas que necesita la tarjeta, derivadas del estado del descanso.
function gymRestActivityParams() {
  const totalSeconds = (gymLiveSession.restBaseSeconds || 0) + (gymLiveSession.restExtraSeconds || 0);
  const accent = gymCurrentAccentHex();
  const surfaceText = gymThemeColorHex('--surface-text', '#f2f2f7');
  return {
    startAt: totalSeconds > 0 ? gymLiveSession.restUntil - totalSeconds * 1000 : Date.now(),
    endAt: gymLiveSession.restUntil,
    dayName: gymLiveSession.routineName || 'Sesión libre',
    extraSeconds: gymLiveSession.restExtraSeconds || 0,
    accentHex: accent,
    surfaceHex: gymThemeColorHex('--surface', '#1c1c27'),
    surfaceTextHex: surfaceText,
    // El color del tramo extra, calcado del de la barra de la app.
    extraHex: gymMixHex(accent, surfaceText, 0.45),
  };
}

// El +30s pulsado EN LA PANTALLA DE BLOQUEO (boton de la Live Activity,
// iOS 17+): mientras el movil esta bloqueado el JS esta congelado, asi
// que el intent nativo lo hace todo el (alargar la tarjeta y reprogramar
// el aviso) y deja los segundos apuntados. Aqui se recogen al volver a
// primer plano y se pone al dia el estado del JS: el temporizador de la
// app, el total de extra y el "+Ns" de la serie en descanso.
async function gymConsumeRestExtensionFromLockScreen() {
  const plugin = getGymLiveActivityPlugin();
  if (!plugin) return;
  try {
    const res = await plugin.consumeRestExtension();
    const seconds = res && res.seconds ? Number(res.seconds) : 0;
    if (seconds > 0 && gymLiveSession && gymLiveSession.restUntil) {
      gymLiveSession.restUntil += seconds * 1000;
      gymLiveSession.restExtraSeconds = (gymLiveSession.restExtraSeconds || 0) + seconds;
      const ref = gymLiveSession.restSetRef;
      if (ref) {
        const refEx = gymLiveSession.exercises.find((x) => x.exerciseId === ref.exerciseId);
        const refSet = refEx && refEx.sets[ref.setIndex];
        if (refSet) refSet.extraRest = (refSet.extraRest || 0) + seconds;
      }
      gymLiveStore();
      gymLiveTick();
      // Con el entreno a la vista, repintar para que el "+Ns" de la serie
      // se vea al momento (oculto, ya se repintara al abrirlo).
      if (!document.getElementById('gym-live-view').classList.contains('hidden')) {
        renderGymLiveExercises();
      }
      // Reafirma la tarjeta con el estado ya cuadrado (y la resucita si
      // un despertar anterior la hubiera cerrado de mas).
      gymUpdateRestLiveActivity();
    }
    // Tocar la tarjeta de la pantalla de bloqueo abre la app pidiendo ir
    // al entreno (peticion de Koku): el SceneDelegate deja la marca y
    // aqui se ejecuta la navegacion.
    if (res && res.openGym && gymLiveSession) {
      if (typeof closeSettingsModal === 'function') closeSettingsModal();
      if (typeof openGymView === 'function') openGymView();
      openGymLiveView();
    }
  } catch (err) {
    console.error('No se pudo recoger el +30s de la pantalla de bloqueo:', err);
  }
}
// Al volver la app a primer plano (desbloquear/cambiar de app) es cuando
// puede haber +30s pendientes. Se escuchan LOS DOS eventos: el 'resume'
// que dispara Capacitor suele llegar antes que visibilitychange, y con
// ambos el tiempo tarda menos en reflejarse (Koku notaba ~3s de espera).
// Recoger dos veces no duplica nada: la segunda lectura ya devuelve 0.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    gymConsumeRestExtensionFromLockScreen();
    gymCleanupRestNotificationStack();
    comprobarAperturaDesdeElWidget();
  } else {
    // Al irse la app a segundo plano se deja el resumen al dia: es el
    // otro momento en que Koku pidio que se actualice el widget, ademas
    // de al cambiar algo.
    actualizarResumenDelWidget();
  }
});
document.addEventListener('resume', () => {
  gymConsumeRestExtensionFromLockScreen();
  gymCleanupRestNotificationStack();
  comprobarAperturaDesdeElWidget();
});
document.addEventListener('pause', () => { actualizarResumenDelWidget(); });

async function gymStartRestLiveActivity() {
  const plugin = getGymLiveActivityPlugin();
  if (!plugin || !gymLiveSession || !gymLiveSession.restUntil) return;
  try {
    const res = await plugin.startRest(gymRestActivityParams());
    // Diagnostico visible en Configuracion > Este dispositivo: como no
    // hay forma de ver la consola en el iPhone, el resultado del ultimo
    // intento se guarda y se ensena alli (Koku reporto que la tarjeta no
    // aparecia y no habia manera de saber por que).
    localStorage.setItem('gymLiveActivityStatus', res && res.started
      ? 'ok'
      : `no: ${res && res.error ? res.error : 'el sistema no lo permite (¿iOS < 16.2, o desactivado en Ajustes?)'}`);
  } catch (err) {
    localStorage.setItem('gymLiveActivityStatus', `error: ${err && err.message ? err.message : err}`);
    console.error('No se pudo iniciar la Live Activity del descanso:', err);
  }
}

async function gymUpdateRestLiveActivity() {
  const plugin = getGymLiveActivityPlugin();
  if (!plugin || !gymLiveSession || !gymLiveSession.restUntil) return;
  try {
    const res = await plugin.updateRest(gymRestActivityParams());
    // Si iOS ya habia soltado la tarjeta (p. ej. la app se relanzo),
    // updated viene en false: se crea una nueva en su lugar.
    if (!res || !res.updated) await plugin.startRest(gymRestActivityParams());
  } catch (err) {
    console.error('No se pudo actualizar la Live Activity del descanso:', err);
  }
}

async function gymEndRestLiveActivity() {
  const plugin = getGymLiveActivityPlugin();
  if (!plugin) return;
  try {
    await plugin.endRest();
  } catch (err) {
    console.error('No se pudo cerrar la Live Activity del descanso:', err);
  }
}

// --- Bajar la musica al acabar el descanso -----------------------------
// (Peticion de Koku: "que baje un poco el volumen de la musica, no
// quitarla".) El trabajo de verdad lo hace RestAudioWatcher en nativo
// (audio ducking de iOS + la app despierta durante el descanso); aqui
// solo se le avisa de cuando empieza/cambia/se cancela el descanso.
// En navegador no hay plugin y no pasa nada.
let gymRestAudioPlugin = null;
function getGymRestAudioPlugin() {
  if (gymRestAudioPlugin) return gymRestAudioPlugin;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  if (window.capacitorExports && typeof window.capacitorExports.registerPlugin === 'function') {
    gymRestAudioPlugin = window.capacitorExports.registerPlugin('RestAudio');
  }
  return gymRestAudioPlugin;
}
function gymRestDuckEnabled() {
  return localStorage.getItem('gymRestDuck') !== 'false';
}
// La vigilancia hace falta si hay que bajar la musica O si hay que
// vibrar largo al acabar: las dos cosas necesitan la app despierta.
function gymRestWatchParams() {
  return { duck: gymRestDuckEnabled(), vibrate: gymRestBurstEnabled() };
}
async function gymStartRestAudioWatch(endAtMs = null) {
  const plugin = getGymRestAudioPlugin();
  const flags = gymRestWatchParams();
  const fin = endAtMs || (gymLiveSession && gymLiveSession.restUntil);
  if (!plugin || (!flags.duck && !flags.vibrate) || !fin) return;
  try {
    await plugin.startWatch({ endAt: fin, ...flags });
  } catch (err) {
    console.error('No se pudo vigilar el audio del descanso:', err);
  }
}
async function gymUpdateRestAudioWatch() {
  const plugin = getGymRestAudioPlugin();
  const flags = gymRestWatchParams();
  if (!plugin || (!flags.duck && !flags.vibrate) || !gymLiveSession || !gymLiveSession.restUntil) return;
  try {
    await plugin.updateWatch({ endAt: gymLiveSession.restUntil, ...flags });
  } catch (err) {
    console.error('No se pudo mover la vigilancia de audio:', err);
  }
}
// --- Probar el aviso de fin de descanso -------------------------------
// En el movil no hay consola ni forma de ver que pasa por dentro, y
// montar un entreno entero para comprobar si la vibracion se calla es
// una locura. Este atajo recorre EXACTAMENTE el mismo camino que un
// descanso de verdad (misma notificacion, misma vigilancia de audio con
// los mismos ajustes), solo que a los 10 segundos: da tiempo a bloquear
// el movil y probar a callarlo como quieras.
async function gymTestRestAlert(delaySeconds = 10) {
  const fin = Date.now() + delaySeconds * 1000;
  await gymScheduleRestNotification(fin);
  await gymStartRestAudioWatch(fin);
  return fin;
}

// Como acabo el ultimo aviso, segun lo que apunto la parte nativa.
const GYM_REST_STOP_LABELS = {
  app: 'al abrir la app',
  desbloqueo: 'al desbloquear el móvil',
  volumen: 'con un botón de volumen',
  'audio-secundario': 'al pausar la música',
  'ruta-audio': 'al cambiar la salida de audio',
  interrupcion: 'por una interrupción de audio',
  mando: 'con el mando del auricular',
  banner: 'al quitar la notificación de la pantalla',
  fin: 'no lo paró nada, terminó solo',
  cancelado: 'se cortó al empezar otra serie o terminar el entreno',
};
async function gymRestAlertLastStatus() {
  const plugin = getGymRestAudioPlugin();
  if (!plugin || typeof plugin.getStatus !== 'function') return null;
  try {
    const info = await plugin.getStatus();
    return info && info.stoppedBy ? info : null;
  } catch (err) {
    return null;
  }
}
function gymFormatRestAlertStatus(info) {
  if (!info) return 'Vibración del descanso: sin datos todavía (prueba el aviso).';
  const como = GYM_REST_STOP_LABELS[info.stoppedBy] || info.stoppedBy;
  const seg = Number(info.afterSeconds || 0).toFixed(1).replace('.', ',');
  const pulsos = Number(info.pulses || 0);
  const banner = info.bannerSeen ? '' : ' · la notificación no llegó a verse en pantalla';
  return `Último aviso: se paró ${como}, a los ${seg} s (${pulsos} vibraciones)${banner}.`;
}

async function gymCancelRestAudioWatch() {
  const plugin = getGymRestAudioPlugin();
  if (!plugin) return;
  try {
    await plugin.cancelWatch();
  } catch (err) {
    console.error('No se pudo cancelar la vigilancia de audio:', err);
  }
}

// Tarjetas de ejercicio del entreno en vivo. Igual que el resto del
// proyecto: se reconstruye el DOM entero en cada cambio estructural
// (anadir/quitar series o ejercicios); los inputs escriben directo en
// gymLiveSession y guardan en localStorage.
// Las listas de ejercicios ocultos/quitados empiezan recogidas;
// recordarlo en variables (no en la sesion guardada) basta -- es estado
// de vista.
let gymLiveHiddenPoolOpen = false;
let gymLiveRemovedPoolOpen = false;

// --- Serie EN CURSO (empezar/terminar con botones grandes) -------------
// Sustituye a la casilla diminuta de cada fila (Koku: "si vas un poco
// mareado costara verlo"). El ciclo es: boton grande de la tarjeta ->
// dialogo "vas a empezar X, serie N" -> serie corriendo con cronometro ->
// dialogo "¿has acabado?" con Si / Pausar / Seguir. De paso queda
// registrado cuanto duro cada serie (set.durationSeconds), que se guarda
// y se ensena en el historial y en Progreso.
//
// El estado vive en gymLiveSession.activeSet, asi que sobrevive a
// recargas y al congelado de iOS igual que el resto (todo por
// timestamps): { exerciseId, setIndex, startedAt, pausedMs, pausedAt }.

// La serie que toca: la primera SIN HACER del ejercicio (con 4 series y
// 2 hechas, la 3). -1 si ya estan todas.
function gymNextPendingSetIndex(ex) {
  return ex.sets.findIndex((s) => !s.done);
}

// --- Ejercicios UNILATERALES contados por lado ------------------------
// Cuando un ejercicio es unilateral y se cuentan los lados por separado,
// cada lado es una SERIE PROPIA (set.side = 'left'/'right'). Asi el ciclo
// de empezar/terminar, el historial y el volumen funcionan sin casos
// especiales: solo cambian las etiquetas y el descanso entre lados.
function gymExerciseUsesSides(ex) {
  const exercise = state.gymExercises.find((e) => e.id === ex.exerciseId);
  return !!(exercise && exercise.unilateral && exercise.countSidesSeparately);
}
// Numero de serie que le toca a un set (los dos lados comparten numero).
function gymSetSerieNumber(ex, setIndex) {
  if (!gymExerciseUsesSides(ex)) return setIndex + 1;
  let n = 0;
  for (let i = 0; i <= setIndex; i++) if (ex.sets[i].side !== 'right') n += 1;
  return Math.max(1, n);
}
// Cuantas series (no lados) tiene el ejercicio.
function gymSerieCount(ex) {
  if (!gymExerciseUsesSides(ex)) return ex.sets.length;
  return ex.sets.filter((s) => s.side !== 'right').length;
}
function gymSideLabel(side) {
  if (side === 'left') return 'izquierdo';
  if (side === 'right') return 'derecho';
  return '';
}
// El otro lado de la MISMA serie (los dos comparten numero de serie).
// -1 si el ejercicio no va por lados o si no encuentra pareja.
function gymSidePartnerIndex(ex, setIndex) {
  if (!gymExerciseUsesSides(ex) || !ex.sets[setIndex]) return -1;
  const n = gymSetSerieNumber(ex, setIndex);
  for (let i = 0; i < ex.sets.length; i++) {
    if (i !== setIndex && gymSetSerieNumber(ex, i) === n) return i;
  }
  return -1;
}
// Cambia por cual de los dos lados se empieza esta serie: como los dos
// lados son dos filas seguidas, basta con intercambiarles la etiqueta
// (asi no se toca ni la numeracion ni nada de lo ya hecho). Solo tiene
// sentido si la pareja sigue pendiente.
function gymSetStartSide(ex, setIndex, side) {
  const partner = gymSidePartnerIndex(ex, setIndex);
  if (partner < 0 || ex.sets[partner].done) return false;
  if (ex.sets[setIndex].side === side) return false;
  ex.sets[setIndex].side = side;
  ex.sets[partner].side = side === 'left' ? 'right' : 'left';
  // Se recuerda para las siguientes series de este ejercicio en la
  // sesion: si empiezas por la derecha, sigues empezando por la derecha
  // hasta que lo cambies otra vez.
  ex.firstSide = side;
  return true;
}
// Pone TODAS las series pendientes de un ejercicio a salir por el mismo
// lado (el que acabas de elegir): si has dicho que empiezas por la
// derecha, se empieza por la derecha el resto del ejercicio, y desde ahi
// se van alternando los lados solos. Se puede volver a cambiar en el
// dialogo de cualquier serie.
function gymApplyFirstSideToPending(ex, side) {
  ex.sets.forEach((s, i) => {
    if (s.done) return;
    const pareja = gymSidePartnerIndex(ex, i);
    if (pareja > i && !ex.sets[pareja].done) gymSetStartSide(ex, i, side);
  });
  ex.firstSide = side;
}
// Crea las series de un ejercicio: una fila por serie, o DOS (izquierda
// y derecha) si el ejercicio cuenta los lados por separado.
function gymBuildSetsForExercise(exerciseId, count, restSeconds) {
  const exercise = state.gymExercises.find((e) => e.id === exerciseId);
  const sides = !!(exercise && exercise.unilateral && exercise.countSidesSeparately);
  const out = [];
  for (let i = 0; i < Math.max(1, Number(count) || 1); i++) {
    if (sides) {
      out.push({ reps: '', weightDisplay: '', done: false, restSeconds, side: 'left', note: '' });
      out.push({ reps: '', weightDisplay: '', done: false, restSeconds, side: 'right', note: '' });
    } else {
      out.push({ reps: '', weightDisplay: '', done: false, restSeconds, side: null, note: '' });
    }
  }
  return out;
}

// Junta las notas de las series en la nota del EJERCICIO de esta sesion
// (peticion de Koku: que sirvan de referencia para el siguiente entreno,
// donde se ensenan como "La última vez"). Es idempotente: la parte
// generada se reescribe entera y lo que hubiera escrito a mano se
// respeta delante.
const GYM_SET_NOTES_TAG = 'Series — ';
function gymCombineSetNotes(ex) {
  const usesSides = gymExerciseUsesSides(ex);
  const parts = [];
  ex.sets.forEach((s, i) => {
    if (!s.note || !String(s.note).trim()) return;
    const lado = usesSides ? (s.side === 'left' ? ' I' : ' D') : '';
    parts.push(`S${gymSetSerieNumber(ex, i)}${lado}: ${String(s.note).trim()}`);
  });
  const manual = String(ex.note || '').split(GYM_SET_NOTES_TAG)[0].trim();
  ex.note = parts.length
    ? `${manual ? `${manual} ` : ''}${GYM_SET_NOTES_TAG}${parts.join(' · ')}`
    : manual;
}

// Segundos de la serie en curso, descontando las pausas.
function gymActiveSetSeconds() {
  const a = gymLiveSession && gymLiveSession.activeSet;
  if (!a) return 0;
  const paused = (a.pausedMs || 0) + (a.pausedAt ? Date.now() - a.pausedAt : 0);
  return Math.max(0, Math.floor((Date.now() - a.startedAt - paused) / 1000));
}

// Cancela la serie en curso si es de este ejercicio (se usa al quitar un
// ejercicio del entreno). Sin esto la sesion se quedaba con una serie
// "corriendo" de algo que ya no estaba en la lista.
function gymDropActiveSetIfExercise(exerciseId) {
  const a = gymLiveSession && gymLiveSession.activeSet;
  if (!a || a.exerciseId !== exerciseId) return false;
  gymLiveSession.activeSet = null;
  return true;
}

// Ejercicio (del entreno) al que pertenece la serie en curso.
function gymActiveSetExercise() {
  const a = gymLiveSession && gymLiveSession.activeSet;
  if (!a) return null;
  return gymLiveSession.exercises.find((e) => e.exerciseId === a.exerciseId) || null;
}

// --- Dialogo "empezar serie" ---
// Indice (dentro de gymLiveSession.exercises) del ejercicio elegido.
let gymSetStartTargetIndex = null;

function openGymSetStartModal(exIndex) {
  if (!gymLiveSession || gymLiveSession.activeSet) return;
  gymSetStartTargetIndex = exIndex;
  gymSetStartListOpen = false;
  renderGymSetStartModal();
  document.getElementById('gym-set-start-modal').classList.remove('hidden');
}
function closeGymSetStartModal() {
  document.getElementById('gym-set-start-modal').classList.add('hidden');
}

// La lista de ejercicios del dia empieza recogida; se despliega tocando
// el nombre (peticion de Koku: poder cambiar de ejercicio desde aqui).
let gymSetStartListOpen = false;

function renderGymSetStartModal() {
  const ex = gymLiveSession.exercises[gymSetStartTargetIndex];
  if (!ex) return;
  const exercise = state.gymExercises.find((e) => e.id === ex.exerciseId);
  document.getElementById('gym-set-start-exercise-name').textContent = exercise ? exercise.name : 'Ejercicio';
  const idx = gymNextPendingSetIndex(ex);
  const pendiente = idx >= 0 ? ex.sets[idx] : null;
  const lado = pendiente && pendiente.side ? ` · lado ${gymSideLabel(pendiente.side)}` : '';
  document.getElementById('gym-set-start-info').textContent = idx >= 0
    ? `Serie ${gymSetSerieNumber(ex, idx)} de ${gymSerieCount(ex)}${lado}`
    : `Serie ${gymSerieCount(ex) + 1} (extra)`;

  // Elegir lado de salida: solo si el ejercicio va por lados y la serie
  // que toca aun tiene su pareja pendiente (si ya hiciste el primer
  // lado, el que queda es el otro y no hay nada que elegir).
  const sides = document.getElementById('gym-set-start-sides');
  const partner = idx >= 0 ? gymSidePartnerIndex(ex, idx) : -1;
  const puedeElegir = partner >= 0 && !ex.sets[partner].done;
  sides.classList.toggle('hidden', !puedeElegir);
  if (puedeElegir) {
    sides.querySelectorAll('[data-start-side]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.startSide === pendiente.side);
    });
  }

  const picker = document.getElementById('gym-set-start-exercise');
  picker.setAttribute('aria-expanded', gymSetStartListOpen ? 'true' : 'false');
  const list = document.getElementById('gym-set-start-exercise-list');
  list.classList.toggle('hidden', !gymSetStartListOpen);
  list.innerHTML = '';
  gymLiveSession.exercises.forEach((other, otherIndex) => {
    const otherExercise = state.gymExercises.find((e) => e.id === other.exerciseId);
    const hechas = other.sets.filter((s) => s.done).length;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'gym-set-exercise-option' + (otherIndex === gymSetStartTargetIndex ? ' active' : '');
    row.innerHTML = `
      <span class="gym-list-item-name">${escapeHtml(otherExercise ? otherExercise.name : 'Ejercicio')}</span>
      <span class="gym-list-item-muted">${hechas}/${other.sets.length}</span>
    `;
    row.addEventListener('click', () => {
      gymSetStartTargetIndex = otherIndex;
      gymSetStartListOpen = false;
      renderGymSetStartModal();
    });
    list.appendChild(row);
  });
}

document.getElementById('gym-set-start-exercise').addEventListener('click', () => {
  gymSetStartListOpen = !gymSetStartListOpen;
  renderGymSetStartModal();
});
document.getElementById('gym-set-start-sides').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-start-side]');
  if (!btn) return;
  const ex = gymLiveSession && gymLiveSession.exercises[gymSetStartTargetIndex];
  if (!ex) return;
  const idx = gymNextPendingSetIndex(ex);
  if (idx < 0) return;
  gymApplyFirstSideToPending(ex, btn.dataset.startSide);
  gymLiveStore();
  renderGymLiveExercises();
  renderGymSetStartModal();
});
document.getElementById('btn-gym-set-start-cancel').addEventListener('click', closeGymSetStartModal);
document.getElementById('btn-gym-set-start-go').addEventListener('click', () => {
  gymStartSet(gymSetStartTargetIndex);
  closeGymSetStartModal();
});

// Arranca la serie: apunta a la primera sin hacer y, si ya estaban todas,
// añade una serie extra heredando el descanso de la anterior.
function gymStartSet(exIndex, setIndexOverride = null) {
  const ex = gymLiveSession && gymLiveSession.exercises[exIndex];
  if (!ex || gymLiveSession.activeSet) return;
  let idx = setIndexOverride !== null ? setIndexOverride : gymNextPendingSetIndex(ex);
  if (idx < 0 || !ex.sets[idx]) {
    // Serie extra: en un ejercicio por lados se añade el BLOQUE entero
    // (izquierdo + derecho), no una fila suelta -- antes se colaba una
    // serie sin lado y descuadraba la numeracion (lo vio Koku).
    const last = ex.sets[ex.sets.length - 1];
    const nuevas = gymBuildSetsForExercise(ex.exerciseId, 1, last ? last.restSeconds : '');
    idx = ex.sets.length;
    ex.sets.push(...nuevas);
    // El bloque nuevo sale por el lado que hayas elegido antes en este
    // ejercicio (gymSetStartSide lo apunta en ex.firstSide).
    if (ex.firstSide === 'right') gymSetStartSide(ex, idx, 'right');
  }
  gymLiveSession.activeSet = {
    exerciseId: ex.exerciseId,
    setIndex: idx,
    startedAt: Date.now(),
    pausedMs: 0,
    pausedAt: null,
  };
  // Ya has empezado: el aviso de "te toca" del fin de descanso sobra.
  gymLiveSession.restEndedAt = null;
  // Si estabas descansando, empezar la siguiente serie corta el descanso:
  // ya estas entrenando otra vez.
  if (gymLiveSession.restUntil) {
    gymLiveSession.restUntil = null;
    gymCancelRestNotification();
    gymEndRestLiveActivity();
    gymCancelRestAudioWatch();
  }
  // La tarjeta del ejercicio en marcha siempre desplegada.
  ex.collapsed = false;
  // Serie nueva, cuenta nueva: el silencio que deja cerrar el dialogo de
  // la serie anterior no debe seguir vigente en esta.
  gymTapSnoozeUntil = 0;
  gymLiveStore();
  renderGymLiveExercises();
  gymLiveTick();
}

// --- Dialogo "¿has acabado la serie?" ---
// Dos pasos: primero la pregunta (Si / Pausar / Seguir) y, al decir que
// si, el formulario con peso, repeticiones y nota de ESA serie (peticion
// de Koku). Nada se guarda hasta "Guardar serie".
function gymSetEndShowForm(show) {
  document.getElementById('gym-set-end-choices').classList.toggle('hidden', show);
  document.getElementById('gym-set-end-form').classList.toggle('hidden', !show);
  document.querySelector('#gym-set-end-modal h2').textContent = show
    ? 'Datos de la serie'
    : '¿Has acabado la serie?';
}

// --- Mover un ejercicio arrastrandolo --------------------------------
// Peticion de Koku, en vez de las flechas de subir/bajar que habia:
// "deslizamos el ejercicio hasta la posicion que queramos... ponemos de
// intermediario el boton mover; una vez sueltas tendrias que volver a
// darle a mover para que vuelva a mover".
//
// O sea: el arrastre NO esta siempre activo (arrastrar sin mas es hacer
// scroll por la lista). Se ARMA desde el boton "Mover" del deslizamiento
// y se desarma solo al soltar. Mientras esta armado, el deslizamiento
// lateral de esa tarjeta se aparta (bloqueadoSi, arriba), asi los dos
// gestos nunca se pisan.
let gymEjercicioEnMovimiento = null;

function armarMovimientoDeEjercicio(exerciseId) {
  gymEjercicioEnMovimiento = exerciseId;
  renderGymLiveExercises();
  // El aviso solo la primera vez: luego ya se sabe.
  if (localStorage.getItem('gymMoverHintSeen') !== '1') {
    localStorage.setItem('gymMoverHintSeen', '1');
    showAppAlert('Arrastra el ejercicio arriba o abajo hasta donde lo quieras. Al soltarlo se queda ahí; para moverlo otra vez, vuelve a deslizar y darle a "Mover".');
  }
}

// Se engancha a cada tarjeta armada dentro de renderGymLiveExercises.
function habilitarArrastreDeEjercicio(envoltorio) {
  let arrastre = null;

  // La lista se mira EN CADA USO, no al enganchar: esto se llama
  // mientras se construye la tarjeta, cuando todavia no esta metida en
  // el DOM y su parentElement es null.
  const hermanos = () => {
    const lista = envoltorio.parentElement;
    return lista ? [...lista.querySelectorAll('.note-swipe-wrap[data-exercise-id]')] : [];
  };

  // Repinta la tarjeta que se arrastra y aparta las de en medio. Vive
  // fuera del listener porque la llaman DOS: el dedo al moverse, y el
  // auto-desplazamiento (que mueve la lista aunque el dedo este quieto).
  const recolocar = () => {
    if (!arrastre) return;
    // El desplazamiento de la LISTA se suma al del dedo. Sin esto, al
    // desplazarse la lista la tarjeta se iria con ella y se despegaria
    // del dedo, ademas de contar mal a que hueco cae.
    const rodado = arrastre.scroller ? arrastre.scroller.scrollTop - arrastre.scrollAlEmpezar : 0;
    const dy = arrastre.ultimaY - arrastre.y + rodado;
    envoltorio.style.transform = `translateY(${dy}px)`;
    // A que posicion caeria si soltase ahora: cuantas tarjetas enteras
    // ha recorrido, topado a los extremos de la lista.
    const filas = hermanos();
    const saltos = Math.round(dy / arrastre.alto);
    const destino = Math.max(0, Math.min(filas.length - 1, arrastre.desde + saltos));
    if (destino !== arrastre.hasta) {
      arrastre.hasta = destino;
      // Las tarjetas de en medio se apartan para que se vea el hueco.
      filas.forEach((fila, i) => {
        if (fila === envoltorio) return;
        let corrimiento = 0;
        if (arrastre.desde < destino && i > arrastre.desde && i <= destino) corrimiento = -arrastre.alto;
        else if (arrastre.desde > destino && i >= destino && i < arrastre.desde) corrimiento = arrastre.alto;
        fila.style.transform = corrimiento ? `translateY(${corrimiento}px)` : '';
      });
    }
  };

  // AUTO-DESPLAZAMIENTO al llegar a los bordes (peticion de Koku: "si
  // tengo muchos ejercicios me gustaria que si subo mucho el ejercicio
  // desplazara la vista hasta donde parara"). Con la lista llena, el
  // ejercicio de abajo no podia llegar arriba del todo: el dedo topaba
  // con el borde de la pantalla antes que la tarjeta con su destino.
  //
  // Va en un bucle de fotogramas y no en el pointermove: con el dedo
  // PARADO en el borde no llega ni un pointermove, y es justo cuando
  // tiene que seguir desplazandose.
  const ZONA_BORDE = 80;      // px desde el borde donde empieza a moverse
  const VELOCIDAD_MAX = 14;   // px por fotograma pegado al borde del todo
  const rodar = () => {
    if (!arrastre) return;
    const sc = arrastre.scroller;
    if (sc) {
      const caja = sc.getBoundingClientRect();
      let paso = 0;
      // Cuanto mas cerca del borde, mas rapido -- asi se puede afinar
      // cerca del sitio sin que se dispare.
      if (arrastre.ultimaY < caja.top + ZONA_BORDE) {
        paso = -VELOCIDAD_MAX * Math.min(1, (caja.top + ZONA_BORDE - arrastre.ultimaY) / ZONA_BORDE);
      } else if (arrastre.ultimaY > caja.bottom - ZONA_BORDE) {
        paso = VELOCIDAD_MAX * Math.min(1, (arrastre.ultimaY - (caja.bottom - ZONA_BORDE)) / ZONA_BORDE);
      }
      if (paso) {
        const antes = sc.scrollTop;
        sc.scrollTop = antes + paso;
        // Solo se recoloca si de verdad se ha movido: al llegar al tope
        // scrollTop deja de cambiar y no hay nada que repintar.
        if (sc.scrollTop !== antes) recolocar();
      }
    }
    arrastre.fotograma = requestAnimationFrame(rodar);
  };

  envoltorio.addEventListener('pointerdown', (e) => {
    // Los botones de dentro siguen funcionando (empezar serie, plegar...).
    if (e.target.closest('button, input, textarea, select, a, label')) return;
    const filas = hermanos();
    const desde = filas.indexOf(envoltorio);
    if (desde < 0) return;
    // Quien se desplaza es .gym-live-content, no la lista: la lista crece
    // con su contenido y el scroll lo lleva el contenedor de arriba.
    const scroller = envoltorio.closest('.gym-live-content');
    arrastre = {
      y: e.clientY,
      ultimaY: e.clientY,
      desde,
      alto: envoltorio.offsetHeight + 13, // + el hueco entre tarjetas
      hasta: desde,
      scroller,
      scrollAlEmpezar: scroller ? scroller.scrollTop : 0,
      fotograma: 0,
    };
    // Capturar el puntero mantiene el arrastre aunque el dedo se salga
    // de la tarjeta. Puede lanzar si ese puntero ya no esta activo (pasa
    // con gestos que el sistema corta a media), y una excepcion aqui
    // dejaria el arrastre a medias: no es imprescindible, asi que si
    // falla se sigue sin ella.
    try { envoltorio.setPointerCapture(e.pointerId); } catch { /* da igual */ }
    envoltorio.classList.add('arrastrando');
    arrastre.fotograma = requestAnimationFrame(rodar);
  });

  envoltorio.addEventListener('pointermove', (e) => {
    if (!arrastre) return;
    e.preventDefault();
    arrastre.ultimaY = e.clientY;
    recolocar();
  });

  const soltar = () => {
    if (!arrastre) return;
    const { desde, hasta } = arrastre;
    if (arrastre.fotograma) cancelAnimationFrame(arrastre.fotograma);
    arrastre = null;
    envoltorio.classList.remove('arrastrando');
    // El modo se desarma SIEMPRE al soltar, lo pidio asi Koku.
    gymEjercicioEnMovimiento = null;
    if (hasta !== desde && gymLiveSession) {
      const arr = gymLiveSession.exercises;
      const [movido] = arr.splice(desde, 1);
      arr.splice(hasta, 0, movido);
      gymLiveStore();
    }
    // Repintar borra de paso todos los transform en linea.
    renderGymLiveExercises();
  };
  envoltorio.addEventListener('pointerup', soltar);
  envoltorio.addEventListener('pointercancel', soltar);
}

// --- Editar un ejercicio del entreno, entero -------------------------
// Se llega DESLIZANDO su tarjeta. Koku lo pidio asi: "yo deslizo el
// ejercicio entero para editar cualquier cosa del ejercicio... se hace
// un cuadro de dialogo mas grande, asi es mas comodo de editar el
// ejercicio y todo lo que haya dentro". A cambio, la tarjeta del entreno
// se queda SOLO para usarla (plegar, empezar serie y mover), sin ningun
// campo suelto donde escribir.
//
// Se trabaja sobre una COPIA: cancelar descarta de verdad, y guardar es
// lo unico que toca la sesion.
let gymExerciseEditId = null;
let gymExerciseEditDraft = null;

function openGymExerciseEditModal(exerciseId) {
  if (!gymLiveSession) return;
  const ex = gymLiveSession.exercises.find((e) => e.exerciseId === exerciseId);
  if (!ex) return;
  gymExerciseEditId = exerciseId;
  gymExerciseEditDraft = {
    // El descanso es del EJERCICIO: se guarda replicado en cada serie,
    // asi que se lee de la primera y al guardar se aplica a todas.
    restSeconds: (ex.sets[0] && ex.sets[0].restSeconds) ?? '',
    sets: ex.sets.map((set) => ({
      ...set,
      segments: (set.segments || []).map((seg) => ({ ...seg })),
    })),
  };
  const exercise = state.gymExercises.find((e) => e.id === exerciseId);
  document.getElementById('gym-exercise-edit-title').textContent = exercise ? exercise.name : 'Editar ejercicio';
  document.getElementById('gym-exercise-edit-rest').value = gymExerciseEditDraft.restSeconds;
  document.getElementById('gym-exercise-edit-rpe').value = ex.rpe ?? '';
  document.getElementById('gym-exercise-edit-note').value = ex.note ?? '';
  renderGymExerciseEditSets();
  const modal = document.getElementById('gym-exercise-edit-modal');
  delete modal.dataset.sucio;
  modal.classList.remove('hidden');
}

function renderGymExerciseEditSets() {
  const cont = document.getElementById('gym-exercise-edit-sets');
  cont.innerHTML = '';
  const unit = getGymWeightUnitLabel();
  const draft = gymExerciseEditDraft;
  if (!draft) return;
  if (draft.sets.length === 0) {
    cont.innerHTML = '<p class="empty-hint">Este ejercicio se ha quedado sin series. Añade una, o cancela y quita el ejercicio.</p>';
    return;
  }
  draft.sets.forEach((set, i) => {
    const bloque = document.createElement('div');
    bloque.className = 'gym-exercise-edit-set';
    bloque.innerHTML = `
      <div class="gym-set-segment-head">
        <span class="gym-set-segment-tag">${i + 1}</span>
        <span class="gym-set-segment-name">${set.side ? `Lado ${gymSideLabel(set.side)}` : 'Serie'}${set.done ? '' : ' · sin hacer'}</span>
        <span class="gym-set-head-dur" title="Lo que duró la serie">${set.durationSeconds ? `Duración: ${gymFormatSetDuration(set.durationSeconds)}` : ''}</span>
        <button type="button" class="icon-btn" data-quitar-serie aria-label="Quitar esta serie">✕</button>
      </div>
      <div class="gym-set-segment-fields">
        <label class="gym-set-segment-field"><span>Peso (${escapeHtml(unit)})</span><input type="text" inputmode="decimal" data-set-field="weightDisplay" value="${escapeHtml(String(set.weightDisplay ?? ''))}" /></label>
        <label class="gym-set-segment-field"><span>Reps</span><input type="number" inputmode="numeric" min="0" data-set-field="reps" value="${escapeHtml(String(set.reps ?? ''))}" /></label>
      </div>
      <label class="gym-set-segment-field"><span>Nota de la serie</span><input type="text" data-set-field="note" value="${escapeHtml(String(set.note ?? ''))}" /></label>
      <div class="gym-set-segments" data-tramos-de="${i}"></div>
      <div class="gym-set-extend-list gym-session-set-actions">
        <button type="button" class="gym-set-extend-btn" data-add-seg="dropset">+ Dropset</button>
        <button type="button" class="gym-set-extend-btn" data-add-seg="restpause">+ Rest-pause</button>
        <button type="button" class="gym-set-extend-btn${set.failure ? ' is-on' : ''}" data-toggle-failure>${set.failure ? '✓ ' : ''}Al fallo</button>
        <button type="button" class="gym-set-extend-btn${set.done ? ' is-on' : ''}" data-toggle-done>${set.done ? '✓ Hecha' : 'Sin hacer'}</button>
      </div>
    `;
    bloque.querySelectorAll('[data-set-field]').forEach((input) => {
      input.addEventListener('input', () => {
        // El peso se guarda ya normalizado (la coma a punto): asi lo que
        // queda en gymLiveSession se puede leer con Number() en todos los
        // sitios que lo usan de sugerencia gris, sin acordarse de nada.
        const campo = input.dataset.setField;
        set[campo] = campo === 'weightDisplay' ? gymNormalizarPeso(input.value) : input.value;
      });
    });
    // Marcar/desmarcar la serie como hecha. Antes era el ✓ de la fila del
    // entreno, que se quito: la columna no aportaba (ya se ve el "—"
    // cuando no hay nada) y ahi no habia sitio.
    bloque.querySelector('[data-toggle-done]').addEventListener('click', () => {
      set.done = !set.done;
      if (!set.done) { set.durationSeconds = null; set.extraRest = 0; }
      renderGymExerciseEditSets();
    });
    bloque.querySelector('[data-quitar-serie]').addEventListener('click', async () => {
      const ok = await showAppConfirm('¿Quitar esta serie del ejercicio?', { okText: 'Quitar', danger: true });
      if (!ok) return;
      draft.sets.splice(i, 1);
      renderGymExerciseEditSets();
    });
    bloque.querySelector('[data-toggle-failure]').addEventListener('click', () => {
      set.failure = !set.failure;
      renderGymExerciseEditSets();
    });
    const editor = bloque.querySelector('[data-tramos-de]');
    if (!Array.isArray(set.segments)) set.segments = [];
    const pintar = () => montarEditorDeTramos(editor, set.segments, {
      pesoMadre: gymNormalizarPeso(bloque.querySelector('[data-set-field="weightDisplay"]').value) || '',
      alQuitar: () => pintar(),
    });
    pintar();
    bloque.querySelectorAll('[data-add-seg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        set.segments.push({ kind: btn.dataset.addSeg, weightDisplay: '', reps: '', pauseSeconds: '' });
        pintar();
      });
    });
    cont.appendChild(bloque);
  });
}

function closeGymExerciseEditModal() {
  document.getElementById('gym-exercise-edit-modal').classList.add('hidden');
  gymExerciseEditId = null;
  gymExerciseEditDraft = null;
}

document.getElementById('btn-close-gym-exercise-edit').addEventListener('click', closeGymExerciseEditModal);
document.getElementById('btn-cancel-gym-exercise-edit').addEventListener('click', closeGymExerciseEditModal);
cerrarModalAlTocarFuera(
  'gym-exercise-edit-modal',
  closeGymExerciseEditModal,
  () => document.getElementById('gym-exercise-edit-modal').dataset.sucio === '1',
);

document.getElementById('btn-gym-exercise-edit-add-set').addEventListener('click', () => {
  const draft = gymExerciseEditDraft;
  if (!draft) return;
  const ultima = draft.sets[draft.sets.length - 1];
  const desde = draft.sets.length;
  // Una serie mas: dos filas si el ejercicio cuenta los lados aparte.
  draft.sets.push(...gymBuildSetsForExercise(gymExerciseEditId, 1, ultima ? ultima.restSeconds : draft.restSeconds));
  const ex = gymLiveSession && gymLiveSession.exercises.find((e) => e.exerciseId === gymExerciseEditId);
  if (ex && ex.firstSide === 'right') gymSetStartSide(draft, desde, 'right');
  renderGymExerciseEditSets();
});

document.getElementById('gym-exercise-edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const ex = gymLiveSession && gymLiveSession.exercises.find((x) => x.exerciseId === gymExerciseEditId);
  const draft = gymExerciseEditDraft;
  if (!ex || !draft) { closeGymExerciseEditModal(); return; }
  const rest = document.getElementById('gym-exercise-edit-rest').value;
  ex.rpe = document.getElementById('gym-exercise-edit-rpe').value;
  ex.note = document.getElementById('gym-exercise-edit-note').value;
  // Los tramos se leen del DOM (la sugerencia gris solo existe ahi).
  draft.sets.forEach((set, i) => {
    const editor = document.querySelector(`#gym-exercise-edit-sets [data-tramos-de="${i}"]`);
    set.segments = gymLeerTramosDe(editor);
    set.restSeconds = rest;
  });
  // Si la serie EN CURSO era de este ejercicio y ha desaparecido al
  // quitar series, se cancela: si no, quedaria un cronometro corriendo
  // sobre una serie que ya no existe, y ningun otro ejercicio dejaria
  // empezar (solo puede haber una serie a la vez).
  const activa = gymLiveSession.activeSet;
  if (activa && activa.exerciseId === ex.exerciseId && !draft.sets[activa.setIndex]) {
    gymLiveSession.activeSet = null;
  }
  ex.sets = draft.sets;
  gymLiveStore();
  closeGymExerciseEditModal();
  renderGymLiveExercises();
  gymLiveTick();
});

// Rellena los campos del formulario a partir de una serie.
function gymVolcarSerieEnFormulario(set, sugerencia) {
  const wEl = document.getElementById('gym-set-end-weight');
  const rEl = document.getElementById('gym-set-end-reps');
  document.querySelector('#gym-set-end-form .gym-set-field span').textContent = `Peso (${getGymWeightUnitLabel()})`;
  wEl.value = set.weightDisplay || '';
  rEl.value = set.reps || '';
  wEl.placeholder = sugerencia && sugerencia.weightDisplay ? String(sugerencia.weightDisplay) : '';
  rEl.placeholder = sugerencia && sugerencia.reps ? String(sugerencia.reps) : '';
  document.getElementById('gym-set-end-note').value = set.note || '';
  gymSetEndSegments = (set.segments || []).map((seg) => ({ ...seg }));
  renderGymSetEndSegments();
  gymSetEndFailure = !!set.failure;
  renderGymSetEndFailure();
}

function openGymSetEndModal() {
  const a = gymLiveSession && gymLiveSession.activeSet;
  if (!a) return;
  const ex = gymActiveSetExercise();
  const exercise = state.gymExercises.find((e) => e.id === a.exerciseId);
  const set = ex && ex.sets[a.setIndex];
  const lado = set && set.side ? ` · lado ${gymSideLabel(set.side)}` : '';
  document.getElementById('gym-set-end-info').textContent =
    `${exercise ? exercise.name : 'Ejercicio'} · Serie ${ex ? gymSetSerieNumber(ex, a.setIndex) : a.setIndex + 1}${lado}`;
  document.getElementById('gym-set-end-timer').textContent = gymLiveFormatClock(gymActiveSetSeconds());
  gymSetEndShowForm(false);
  document.getElementById('gym-set-end-modal').classList.remove('hidden');
}
function closeGymSetEndModal() {
  document.getElementById('gym-set-end-modal').classList.add('hidden');
  // Si acabas de cerrarlo, el toque en la pantalla no lo vuelve a abrir
  // de inmediato (ver gymHandleLiveTap mas abajo).
  gymTapSnoozeUntil = Date.now() + GYM_TAP_SNOOZE_MS;
}

// --- Tocar la pantalla durante la serie abre el dialogo ----------------
// Peticion de Koku: con la serie en marcha el movil suele estar en el
// banco o en el bolsillo, asi que cuando lo vuelves a tocar lo normal es
// que la serie haya acabado. Condiciones para que no moleste:
//  - Solo con la app DELANTE. Mucha gente empieza la serie y se va a
//    Spotify: al volver, ese primer toque NO cuenta (se pide un margen
//    desde que la app vuelve a estar visible).
//  - No antes de unos segundos desde que empezo la serie (si no, el
//    propio toque de "Empezar" la daria por acabada).
//  - Solo tocando "hueco" de la pantalla: si tocas un boton o un campo
//    manda lo que hayas tocado, asi el boton de Terminar serie y el
//    resto de la vista siguen funcionando exactamente igual.
//  - Y solo un TOQUE, no un arrastre ni un scroll.
const GYM_TAP_MIN_SET_SECONDS = 5;      // desde que empieza la serie
const GYM_TAP_AFTER_FOREGROUND_MS = 1500; // desde que la app vuelve
// Tras cerrar el dialogo se vuelve a contar lo MISMO que al empezar la
// serie (peticion de Koku: "si le doy a seguir, que vuelva a contar 5s
// desde el tiempo en el que este"), no un silencio largo aparte.
const GYM_TAP_SNOOZE_MS = GYM_TAP_MIN_SET_SECONDS * 1000;
const GYM_TAP_MAX_MOVE_PX = 12;
const GYM_TAP_MAX_MS = 700;
let gymTapSnoozeUntil = 0;
let gymAppVisibleSince = Date.now();
let gymTapStart = null;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') gymAppVisibleSince = Date.now();
});

// ¿Toca abrir el dialogo con este toque?
function gymTapShouldOpenEnd(target) {
  const a = gymLiveSession && gymLiveSession.activeSet;
  if (!a || a.pausedAt) return false;
  if (document.visibilityState !== 'visible') return false;
  if (Date.now() - gymAppVisibleSince < GYM_TAP_AFTER_FOREGROUND_MS) return false;
  if (Date.now() < gymTapSnoozeUntil) return false;
  if (gymActiveSetSeconds() < GYM_TAP_MIN_SET_SECONDS) return false;
  // Con cualquier dialogo abierto (o el menu flotante desplegado) el
  // toque es para eso, no para terminar la serie.
  if (document.querySelector('.modal:not(.hidden)')) return false;
  if (!target || !target.closest) return false;
  // Controles de la vista: mandan ellos. Ademas de los de siempre hay
  // que contar la cabecera de la tarjeta, que no es un <button> pero se
  // pulsa para plegar/desplegar el ejercicio.
  if (target.closest('button, input, textarea, select, a, label, [contenteditable], [role="button"], [data-live-toggle-collapse]')) return false;
  return true;
}

(function registrarToqueDeSerie() {
  const vista = document.getElementById('gym-live-view');
  if (!vista) return;
  vista.addEventListener('pointerdown', (e) => {
    gymTapStart = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target };
  });
  vista.addEventListener('pointerup', (e) => {
    const inicio = gymTapStart;
    gymTapStart = null;
    if (!inicio) return;
    if (Date.now() - inicio.t > GYM_TAP_MAX_MS) return;
    if (Math.abs(e.clientX - inicio.x) > GYM_TAP_MAX_MOVE_PX) return;
    if (Math.abs(e.clientY - inicio.y) > GYM_TAP_MAX_MOVE_PX) return;
    if (!gymTapShouldOpenEnd(inicio.target)) return;
    openGymSetEndModal();
  });
  vista.addEventListener('pointercancel', () => { gymTapStart = null; });
})();

// --- "Llegué al fallo" dentro del dialogo de fin de serie -------------
let gymSetEndFailure = false;

function renderGymSetEndFailure() {
  const btn = document.getElementById('btn-gym-set-end-failure');
  btn.classList.toggle('is-on', gymSetEndFailure);
  btn.setAttribute('aria-pressed', gymSetEndFailure ? 'true' : 'false');
}

document.getElementById('btn-gym-set-end-failure').addEventListener('click', () => {
  gymSetEndFailure = !gymSetEndFailure;
  renderGymSetEndFailure();
});

// --- Tramos de una serie alargada dentro del dialogo de fin de serie ---
// Lo que se este escribiendo ahora mismo en la linea "¿Has alargado la
// serie?". Se vacia al abrir el formulario y se vuelca en la serie al
// guardar; mientras tanto vive solo aqui, porque hasta que no le das a
// "Guardar serie" no hay nada que apuntar.
let gymSetEndSegments = [];

// El peso de la SERIE MADRE tal y como esta el formulario ahora: lo que
// hayas escrito o, si lo dejaste en blanco, la sugerencia gris (misma
// regla que usa gymFinishActiveSet para guardar la serie).
function gymPesoMadreDeTramos() {
  const wEl = document.getElementById('gym-set-end-weight');
  return gymNormalizarPeso(wEl.value !== '' ? wEl.value : (wEl.placeholder || ''));
}

// El editor de tramos, montado sobre CUALQUIER contenedor. Se usa en
// dos sitios (peticion de Koku de poder arreglarlos despues: "a lo mejor
// le he dado a acabar y se me ha olvidado darle a que he hecho alguna o
// le he dado mal al peso"):
//   - el dialogo de fin de serie del entreno en vivo,
//   - y cada serie del modal de editar una sesion del historial.
// `segmentos` se modifica EN EL SITIO (es el array del sitio que lo
// llama); `pesoMadre` es la sugerencia gris de partida, que en el
// entreno sale del campo de peso y en el historial de la fila.
function montarEditorDeTramos(cont, segmentos, { pesoMadre, alQuitar } = {}) {
  cont.innerHTML = '';
  const unit = getGymWeightUnitLabel();
  // El peso que se propone en cada tramo: en un rest-pause es SIEMPRE el
  // de la madre (es la definicion: misma carga tras la pausa), y en un
  // dropset el del tramo de arriba, porque un dropset encadenado va
  // bajando desde el anterior. Koku pidio que el de la madre sea el
  // valor por defecto pero se pueda cambiar: va como sugerencia gris,
  // que es el patron que ya usa el resto del dialogo (campo vacio =
  // te vale la sugerencia).
  let pesoAnterior = pesoMadre;
  segmentos.forEach((seg, i) => {
    const sugerencia = seg.kind === 'restpause' ? pesoMadre : pesoAnterior;
    const row = document.createElement('div');
    row.className = 'gym-set-segment-row';
    row.dataset.segKind = seg.kind;
    // Cada campo lleva su etiqueta ENCIMA, no dentro como sugerencia:
    // metidos los tres en una fila, "pausa s" se cortaba y no se leia
    // la unidad (lo vio Koku en el iPhone). La sugerencia gris del peso
    // sigue estando, que es la que se usa si lo dejas en blanco.
    row.innerHTML = `
      <div class="gym-set-segment-head">
        <span class="gym-set-segment-tag ${seg.kind === 'restpause' ? 'es-restpause' : 'es-dropset'}">${GYM_SEGMENT_LABELS[seg.kind]}</span>
        <span class="gym-set-head-dur"></span>
        <button type="button" class="icon-btn" data-seg-remove aria-label="Quitar tramo">✕</button>
      </div>
      <div class="gym-set-segment-fields">
        ${seg.kind === 'restpause'
          ? `<label class="gym-set-segment-field"><span>Pausa (s)</span><input type="number" inputmode="numeric" min="0" data-seg-field="pauseSeconds" value="${escapeHtml(String(seg.pauseSeconds ?? ''))}" /></label>`
          : ''}
        <label class="gym-set-segment-field"><span>Peso (${escapeHtml(unit)})</span><input type="text" inputmode="decimal" placeholder="${escapeHtml(String(sugerencia || ''))}" data-seg-field="weightDisplay" value="${escapeHtml(String(seg.weightDisplay ?? ''))}" /></label>
        <label class="gym-set-segment-field"><span>Reps</span><input type="number" inputmode="numeric" min="0" data-seg-field="reps" value="${escapeHtml(String(seg.reps ?? ''))}" /></label>
      </div>
    `;
    row.querySelectorAll('[data-seg-field]').forEach((input) => {
      input.addEventListener('input', () => { seg[input.dataset.segField] = input.value; });
    });
    row.querySelector('[data-seg-remove]').addEventListener('click', () => {
      segmentos.splice(i, 1);
      if (alQuitar) alQuitar();
      else montarEditorDeTramos(cont, segmentos, { pesoMadre, alQuitar });
    });
    cont.appendChild(row);
    pesoAnterior = (seg.weightDisplay !== '' && seg.weightDisplay != null) ? seg.weightDisplay : sugerencia;
  });
}

function renderGymSetEndSegments() {
  montarEditorDeTramos(
    document.getElementById('gym-set-end-segments'),
    gymSetEndSegments,
    { pesoMadre: gymPesoMadreDeTramos(), alQuitar: renderGymSetEndSegments },
  );
}

// Lo escrito en los tramos, ya resuelto (campo vacio = la sugerencia
// gris que se veia). Se lee del DOM y no del array porque la sugerencia
// solo existe ahi, igual que pasa con el peso de la serie madre.
function gymLeerTramosDelFormulario() {
  return gymLeerTramosDe(document.getElementById('gym-set-end-segments'));
}

function gymLeerTramosDe(cont) {
  const filas = cont ? [...cont.querySelectorAll('.gym-set-segment-row')] : [];
  return filas.map((fila) => {
    const leer = (campo) => {
      const el = fila.querySelector(`[data-seg-field="${campo}"]`);
      if (!el) return '';
      // El peso puede venir escrito con coma; el resto son enteros.
      const norm = (v) => (campo === 'weightDisplay' ? gymNormalizarPeso(v) : v);
      if (el.value !== '') return norm(el.value);
      // Campo vacio: vale la sugerencia gris, pero SOLO si de verdad es
      // un numero. Hay placeholders que son texto ("reps", "pausa s") y
      // colarlos aqui guardaria un NaN en la base de datos.
      const sug = norm(el.placeholder);
      return Number.isFinite(Number(sug)) && sug !== '' ? sug : '';
    };
    const kind = fila.dataset.segKind === 'restpause' ? 'restpause' : 'dropset';
    return {
      kind,
      weightDisplay: leer('weightDisplay'),
      reps: leer('reps'),
      pauseSeconds: kind === 'restpause' ? leer('pauseSeconds') : null,
    };
  // Un tramo sin repeticiones esta a medio escribir: no se guarda.
  }).filter((seg) => Number(seg.reps) > 0);
}

document.querySelectorAll('[data-add-segment]').forEach((btn) => {
  btn.addEventListener('click', () => {
    gymSetEndSegments.push({ kind: btn.dataset.addSegment, weightDisplay: '', reps: '', pauseSeconds: '' });
    renderGymSetEndSegments();
    // El foco al ultimo campo que se acaba de crear, para poder escribir
    // sin tener que apuntar con el dedo.
    const ultimo = document.querySelector('#gym-set-end-segments .gym-set-segment-row:last-child input');
    if (ultimo) ultimo.focus();
  });
});

// "Si, terminada" -> pasa al formulario, con lo que ya hubiera escrito en
// la fila y, si estaba vacio, lo de la ultima serie hecha del mismo
// ejercicio y lado (asi normalmente solo hay que confirmar).
document.getElementById('btn-gym-set-end-done').addEventListener('click', () => {
  const a = gymLiveSession && gymLiveSession.activeSet;
  if (!a) return;
  const ex = gymActiveSetExercise();
  const set = ex && ex.sets[a.setIndex];
  if (!set) return;
  // La sugerencia va como PLACEHOLDER, en gris de ejemplo, no como valor
  // escrito (peticion de Koku): si no tocas el campo, al guardar se usa
  // igualmente ese valor. Se busca primero la ultima serie hecha del
  // MISMO lado y, si no hay, la ultima de cualquier lado -- en un
  // unilateral se suele mover el mismo peso con los dos, asi que al
  // cambiar de lado tambien conviene proponerlo (peticion de Koku).
  const hechasAntes = [...ex.sets.slice(0, a.setIndex)].reverse().filter((s) => s.done);
  const previa = hechasAntes.find((s) => s.side === set.side) || hechasAntes[0];
  // Si la serie se deshizo y se esta rehaciendo, el volcado recupera de
  // paso los tramos y el "al fallo" que tuviera apuntados.
  gymVolcarSerieEnFormulario(set, previa);
  gymSetEndShowForm(true);
});

// "Guardar serie": vuelca peso/reps/nota, marca la serie con su duracion
// y arranca el descanso -- el CORTO entre lados si acaba de hacerse el
// lado izquierdo de un ejercicio contado por lados, el normal si no.
function gymFinishActiveSet() {
  const a = gymLiveSession && gymLiveSession.activeSet;
  if (!a) return;
  const ex = gymActiveSetExercise();
  const set = ex && ex.sets[a.setIndex];
  if (set) {
    // Campo vacio = te vale la sugerencia gris, asi que se guarda esa.
    const wEl = document.getElementById('gym-set-end-weight');
    const rEl = document.getElementById('gym-set-end-reps');
    set.weightDisplay = gymNormalizarPeso(wEl.value !== '' ? wEl.value : (wEl.placeholder || ''));
    set.reps = rEl.value !== '' ? rEl.value : (rEl.placeholder || '');
    set.note = document.getElementById('gym-set-end-note').value;
    set.segments = gymLeerTramosDelFormulario();
    set.failure = gymSetEndFailure;
    set.done = true;
    set.durationSeconds = gymActiveSetSeconds();
    set.extraRest = 0;

    const exercise = state.gymExercises.find((e) => e.id === ex.exerciseId);
    // Descanso CORTO entre lados: cuando lo que acaba de hacerse es el
    // primer lado de la serie, o sea que el otro lado sigue pendiente.
    // Ojo: no vale mirar si es el izquierdo -- se puede empezar por el
    // derecho (lo eliges en el dialogo), y entonces el corto va despues
    // del derecho.
    const pareja = gymSidePartnerIndex(ex, a.setIndex);
    const entreLados = pareja >= 0 && !ex.sets[pareja].done
      && exercise && Number(exercise.sideRestSeconds) > 0;
    const seconds = entreLados
      ? Number(exercise.sideRestSeconds)
      : (Number(set.restSeconds) || gymLiveSession.restPreset);
    gymLiveSession.restUntil = Date.now() + seconds * 1000;
    gymLiveSession.restBaseSeconds = seconds;
    gymLiveSession.restExtraSeconds = 0;
    // A que serie pertenece el descanso en marcha: los +30s se le
    // apuntan a ELLA, para poder ensenar "Serie 1: +60s" luego.
    gymLiveSession.restSetRef = { exerciseId: ex.exerciseId, setIndex: a.setIndex };
    gymScheduleRestNotification();
    gymStartRestLiveActivity();
    gymStartRestAudioWatch();

    // Ejercicio terminado: las notas de sus series se combinan en la
    // nota del ejercicio, que es la que se vera el proximo entreno.
    if (ex.sets.every((s) => s.done)) gymCombineSetNotes(ex);
  }
  gymLiveSession.activeSet = null;
  gymLiveStore();
  closeGymSetEndModal();
  renderGymLiveExercises();
  gymLiveTick();
}

document.getElementById('btn-gym-set-end-save').addEventListener('click', gymFinishActiveSet);
document.getElementById('btn-gym-set-end-continue').addEventListener('click', closeGymSetEndModal);
document.getElementById('btn-gym-set-end-pause').addEventListener('click', () => {
  const a = gymLiveSession && gymLiveSession.activeSet;
  if (!a) return;
  if (!a.pausedAt) a.pausedAt = Date.now();
  gymLiveStore();
  closeGymSetEndModal();
  renderGymLiveExercises();
  gymLiveTick();
});

function renderGymLiveExercises() {
  const container = document.getElementById('gym-live-exercises');
  container.innerHTML = '';
  // El atajo de "lista vacia" solo aplica si TAMPOCO hay nada que
  // recuperar (ni ocultos del dia ni quitados en esta sesion) -- si no,
  // esas secciones de abajo no se pintarian nunca.
  if (gymLiveSession.exercises.length === 0
      && !(gymLiveSession.hiddenPool || []).length
      && !(gymLiveSession.removedPool || []).length) {
    container.innerHTML = '<p class="empty-hint">Añade ejercicios con el botón del menú de abajo a la derecha.</p>';
    return;
  }
  const unit = getGymWeightUnitLabel();

  // Plegar/desplegar todo (peticion de Koku: no deslizar 40 minutos).
  if (gymLiveSession.exercises.length > 1) {
    const toolsRow = document.createElement('div');
    toolsRow.className = 'gym-live-cards-tools';
    toolsRow.innerHTML = `
      <button type="button" class="secondary-btn" data-live-expand-all>Desplegar todo</button>
      <button type="button" class="secondary-btn" data-live-collapse-all>Recoger todo</button>
    `;
    toolsRow.querySelector('[data-live-expand-all]').addEventListener('click', () => {
      gymLiveSession.exercises.forEach((ex) => { ex.collapsed = false; });
      gymLiveStore();
      renderGymLiveExercises();
    });
    toolsRow.querySelector('[data-live-collapse-all]').addEventListener('click', () => {
      gymLiveSession.exercises.forEach((ex) => { ex.collapsed = true; });
      gymLiveStore();
      renderGymLiveExercises();
    });
    container.appendChild(toolsRow);
  }

  gymLiveSession.exercises.forEach((ex, exIndex) => {
    const exercise = state.gymExercises.find((e) => e.id === ex.exerciseId);
    const prev = gymLivePrevSets.get(ex.exerciseId);
    // Sesiones guardadas por versiones anteriores: el RPE vivia por
    // serie; se recupera el primero que hubiera como RPE del ejercicio.
    if (ex.rpe === undefined) ex.rpe = (ex.sets.find((s) => s.rpe) || {}).rpe || '';
    const card = document.createElement('div');
    card.className = 'gym-live-exercise-card' + (ex.collapsed ? ' collapsed' : '');

    const setsHtml = ex.sets.map((set, setIndex) => {
      const prevSet = prev && prev.sets[setIndex];
      // Si la ultima vez esa serie se alargo, se marca con un "+N" para
      // saber que ese numero no salio de una serie normal.
      const prevExtra = prevSet && gymSetSegments(prevSet).length;
      const prevLabel = prevSet
        ? `${prevSet.restSeconds ? `(${gymFormatRestShort(prevSet.restSeconds)})` : ''}${prevSet.weightKg !== null ? gymWeightKgToDisplay(prevSet.weightKg) : '—'}×${prevSet.reps ?? '—'}${prevExtra ? ` +${prevExtra}` : ''}`
        : '—';
      return `
        <div class="gym-live-set-row ${set.done ? 'done' : ''}">
          <span class="gym-live-set-number">${gymSetSerieNumber(ex, setIndex)}${set.side ? `<span class="gym-set-side-chip">${set.side === 'left' ? 'I' : 'D'}</span>` : ''}</span>
          <span class="gym-live-set-prev" title="Última vez">${escapeHtml(prevLabel)}</span>
          <span class="gym-live-set-value">${escapeHtml(String(set.weightDisplay || '—'))}</span>
          <span class="gym-live-set-value">${escapeHtml(String(set.reps || '—'))}</span>
        </div>
        ${set.extraRest || set.failure || gymSetSegments(set).length
          ? `<div class="gym-live-set-chips">${set.extraRest ? `<span class="gym-set-extra-chip">+${set.extraRest}s</span>` : ''}${gymFailureChipHtml(set.failure)}${gymSegmentChipHtml(set)}</div>`
          : ''}
      `;
    }).join('');

    // Boton GRANDE de empezar/terminar serie (sustituye a la casilla
    // diminuta, peticion de Koku). Apunta siempre a la primera serie sin
    // hacer del ejercicio; si ya estan todas, empieza una extra. Solo
    // puede haber UNA serie en curso en todo el entreno.
    const active = gymLiveSession.activeSet;
    const activeHere = !!active && active.exerciseId === ex.exerciseId;
    const pendingIdx = gymNextPendingSetIndex(ex);
    let bigBtnHtml;
    if (activeHere) {
      const paused = !!active.pausedAt;
      const activeSide = (ex.sets[active.setIndex] || {}).side;
      const que = activeSide ? `lado ${gymSideLabel(activeSide)}` : 'serie';
      bigBtnHtml = `
        <button type="button" class="gym-set-big-btn gym-set-run-btn${paused ? ' paused' : ''}" data-live-set-action>
          ${paused ? `▶ Reanudar ${que}` : `■ Terminar ${que}`} · <span data-live-set-timer>0:00</span>
        </button>`;
    } else {
      const pendingSet = pendingIdx >= 0 ? ex.sets[pendingIdx] : null;
      const label = pendingIdx >= 0
        ? `▶ Empezar serie ${gymSetSerieNumber(ex, pendingIdx)} de ${gymSerieCount(ex)}${pendingSet && pendingSet.side ? ` · lado ${gymSideLabel(pendingSet.side)}` : ''}`
        : '▶ Empezar serie extra';
      // Con el descanso recien acabado, el boton de ESTE ejercicio se
      // pone grande y llamativo: es el que se le olvidaba pulsar a Koku.
      const leToca = gymIndiceDelEjercicioEnEspera() === exIndex;
      bigBtnHtml = `
        <button type="button" class="gym-set-big-btn gym-set-start-btn${leToca ? ' is-ready' : ''}" data-live-set-start ${active ? 'disabled' : ''}>
          ${label}
        </button>`;
    }

    const doneCount = ex.sets.filter((s) => s.done).length;
    const restSeconds = Number(ex.sets[0] && ex.sets[0].restSeconds) || '';
    card.innerHTML = `
      <div class="gym-live-exercise-header" data-live-toggle-collapse>
        <span class="gym-live-caret" aria-hidden="true">▾</span>
        <span class="gym-list-item-name">${escapeHtml(exercise ? exercise.name : 'Ejercicio')}</span>
        <span class="gym-live-rest-chip is-static" title="Descanso entre series">${restSeconds ? gymFormatRestDisplay(restSeconds) : '—'}</span>
        <span class="gym-live-card-progress">${doneCount}/${ex.sets.length}</span>
      </div>
      <div class="gym-live-card-body">
        ${exercise && exercise.notes ? `<p class="gym-live-fixed-note">${escapeHtml(exercise.notes)}</p>` : ''}
        ${prev && prev.note ? `<p class="gym-live-prev-note">La última vez: ${escapeHtml(prev.note)}</p>` : ''}
        <div class="gym-live-set-row gym-live-set-head">
          <span class="gym-live-set-number">#</span>
          <span class="gym-live-set-prev">Anterior</span>
          <span class="gym-live-set-value">${unit}</span>
          <span class="gym-live-set-value">Reps</span>
        </div>
        ${setsHtml}
        ${bigBtnHtml}
        ${ex.rpe || (ex.note && ex.note.trim()) ? `<p class="gym-live-card-meta">${ex.rpe ? `RPE ${escapeHtml(String(ex.rpe))}` : ''}${ex.rpe && ex.note && ex.note.trim() ? ' · ' : ''}${ex.note ? escapeHtml(ex.note) : ''}</p>` : ''}
      </div>
    `;

    // Tocar la cabecera pliega/despliega la tarjeta -- salvo que el toque
    // caiga en un boton o input de la propia cabecera.
    card.querySelector('[data-live-toggle-collapse]').addEventListener('click', (e) => {
      if (e.target.closest('button, input')) return;
      ex.collapsed = !ex.collapsed;
      gymLiveStore();
      card.classList.toggle('collapsed', ex.collapsed);
    });

    // Empezar serie: pasa por el dialogo de confirmacion (que ejercicio y
    // que serie), con el nombre pulsable para cambiar de ejercicio.
    const startBtn = card.querySelector('[data-live-set-start]');
    if (startBtn) startBtn.addEventListener('click', () => openGymSetStartModal(exIndex));
    // Terminar (o reanudar si estaba pausada) la serie en curso.
    const actionBtn = card.querySelector('[data-live-set-action]');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        const a = gymLiveSession.activeSet;
        if (!a) return;
        if (a.pausedAt) {
          a.pausedMs = (a.pausedMs || 0) + (Date.now() - a.pausedAt);
          a.pausedAt = null;
          gymLiveStore();
          renderGymLiveExercises();
          gymLiveTick();
        } else {
          openGymSetEndModal();
        }
      });
    }
    // Quitar el ejercicio: ahora se llega DESLIZANDO la tarjeta (ver el
    // envoltorio de abajo), no con una ✕ en la cabecera.
    const quitarEjercicio = async () => {
      const ok = await showAppConfirm('¿Quitar este ejercicio del entrenamiento? Podrás recuperarlo con sus series desde "Ejercicios quitados", abajo del todo.', { okText: 'Quitar', danger: true });
      if (!ok) return;
      // No se pierde: va al pool de quitados de ESTA sesion, con sus
      // series tal cual estaban (peticion de Koku: poder recuperarlo).
      if (!gymLiveSession.removedPool) gymLiveSession.removedPool = [];
      // Si la serie en curso era de ESTE ejercicio, se cancela: si no, la
      // sesion se quedaba con una serie corriendo de un ejercicio que ya
      // no esta, el cronometro no paraba y ningun otro ejercicio dejaba
      // empezar (solo puede haber una serie a la vez).
      gymDropActiveSetIfExercise(gymLiveSession.exercises[exIndex].exerciseId);
      gymLiveSession.removedPool.push(gymLiveSession.exercises[exIndex]);
      gymLiveSession.exercises.splice(exIndex, 1);
      gymLiveStore();
      renderGymLiveExercises();
    };

    // La tarjeta se DESLIZA para editar o quitar el ejercicio (petición
    // de Koku). Funciona bien justo porque la tarjeta ya no tiene ningún
    // campo donde escribir: arrastrarla no pelea con meter el dedo en un
    // input. Lo que queda a golpe de toque es solo usarla: plegar,
    // empezar la serie y mover el ejercicio arriba/abajo.
    const envoltorio = wrapRowWithSwipeActions(card, {
      botones: [
        ['Editar', 'secondary-btn', () => openGymExerciseEditModal(ex.exerciseId)],
        ['Mover', 'secondary-btn', () => armarMovimientoDeEjercicio(ex.exerciseId)],
        ['Quitar', 'danger-btn', quitarEjercicio],
      ],
      anchoFijo: 210,
      // Con el modo mover armado, el deslizamiento lateral se aparta: el
      // gesto que manda entonces es arrastrar la tarjeta arriba y abajo.
      bloqueadoSi: () => gymEjercicioEnMovimiento !== null,
    });
    envoltorio.dataset.exerciseId = String(ex.exerciseId);
    if (gymEjercicioEnMovimiento === ex.exerciseId) {
      envoltorio.classList.add('esta-moviendose');
      habilitarArrastreDeEjercicio(envoltorio);
    }
    container.appendChild(envoltorio);
  });

  // Ejercicios QUITADOS durante esta sesion: recuperables con sus series
  // (peticion de Koku, "no es que me lo haya saltado, es un cambio").
  const removed = gymLiveSession.removedPool || [];
  if (removed.length > 0) {
    const removedBox = document.createElement('div');
    removedBox.className = 'gym-live-hidden-pool';
    removedBox.innerHTML = `<button type="button" class="secondary-btn" data-live-toggle-removed>${gymLiveRemovedPoolOpen ? 'Ocultar' : 'Ver'} ejercicios quitados (${removed.length})</button><div class="gym-live-hidden-list ${gymLiveRemovedPoolOpen ? '' : 'hidden'}"></div>`;
    removedBox.querySelector('[data-live-toggle-removed]').addEventListener('click', () => {
      gymLiveRemovedPoolOpen = !gymLiveRemovedPoolOpen;
      renderGymLiveExercises();
    });
    const removedList = removedBox.querySelector('.gym-live-hidden-list');
    removed.forEach((r, removedIndex) => {
      const exercise = state.gymExercises.find((e) => e.id === r.exerciseId);
      const row = document.createElement('div');
      row.className = 'gym-live-hidden-row';
      row.innerHTML = `
        <span class="gym-list-item-name">${escapeHtml(exercise ? exercise.name : 'Ejercicio')}</span>
        <button type="button" class="secondary-btn">Recuperar</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        r.collapsed = false;
        gymLiveSession.exercises.push(r);
        gymLiveSession.removedPool.splice(removedIndex, 1);
        gymLiveStore();
        renderGymLiveExercises();
      });
      removedList.appendChild(row);
    });
    container.appendChild(removedBox);
  }

  // Ejercicios OCULTOS del dia: no estan en el entreno, pero se pueden
  // recuperar para esta sesion concreta (peticion de Koku).
  const pool = gymLiveSession.hiddenPool || [];
  if (pool.length > 0) {
    const poolBox = document.createElement('div');
    poolBox.className = 'gym-live-hidden-pool';
    poolBox.innerHTML = `<button type="button" class="secondary-btn" data-live-toggle-hidden>${gymLiveHiddenPoolOpen ? 'Ocultar' : 'Ver'} ejercicios ocultos (${pool.length})</button><div class="gym-live-hidden-list ${gymLiveHiddenPoolOpen ? '' : 'hidden'}"></div>`;
    poolBox.querySelector('[data-live-toggle-hidden]').addEventListener('click', () => {
      gymLiveHiddenPoolOpen = !gymLiveHiddenPoolOpen;
      renderGymLiveExercises();
    });
    const listEl = poolBox.querySelector('.gym-live-hidden-list');
    pool.forEach((p, poolIndex) => {
      const exercise = state.gymExercises.find((e) => e.id === p.exerciseId);
      const row = document.createElement('div');
      row.className = 'gym-live-hidden-row';
      row.innerHTML = `
        <span class="gym-list-item-name">${escapeHtml(exercise ? exercise.name : 'Ejercicio')}</span>
        <button type="button" class="secondary-btn">+ Añadir a esta sesión</button>
      `;
      row.querySelector('button').addEventListener('click', async () => {
        gymLiveSession.exercises.push({
          exerciseId: p.exerciseId,
          note: '',
          rpe: '',
          collapsed: false,
          sets: gymBuildSetsForExercise(p.exerciseId, p.targetSets, p.targetRestSeconds ?? ''),
        });
        gymLiveSession.hiddenPool.splice(poolIndex, 1);
        gymLiveStore();
        if (!gymLivePrevSets.has(p.exerciseId)) {
          gymLivePrevSets.set(p.exerciseId, await api(`/api/gym-sessions/last-sets/${p.exerciseId}`));
        }
        renderGymLiveExercises();
      });
      listEl.appendChild(row);
    });
    container.appendChild(poolBox);
  }
}

// "+ Añadir ejercicio" en vivo: reutiliza el MISMO buscador de la
// libreria de la Fase 2, pero en "modo elegir" -- si
// gymLibraryPickCallback esta puesto, elegir un ejercicio (fila o boton)
// llama al callback en vez del flujo normal de importar, y cierra el
// buscador. Asi no hay que construir un segundo selector solo para el
// entreno en vivo.
document.getElementById('btn-gym-live-add-exercise').addEventListener('click', () => {
  gymLibraryPickCallback = async (libraryEntry) => {
    // Importa (idempotente) y anade la tarjeta al entreno en curso, por
    // el MISMO sitio que "Tus ejercicios": asi las series se construyen
    // igual (y los unilaterales nacen con sus dos lados).
    await importGymLibraryExercise(libraryEntry.id);
    const imported = state.gymExercises.find((e) => e.libraryId === libraryEntry.id);
    if (!imported) return;
    await gymAnadirEjercicioAlEntreno(imported.id);
  };
  openGymLibraryModal();
});

// --- Modal de ayuda del entrenamiento --------------------------------
// Se abre SOLO la primera vez que entras a entrenar (y cada vez, hasta
// que marques "no volver a mostrar"), y siempre a mano desde el boton
// "?" flotante o tocando la cabecera RPE. El flag vive en localStorage
// porque es una preferencia de ESTE dispositivo, como el resto.
function openGymHelpModal() {
  // El checkbox refleja lo guardado: si ya pediste no verlo mas y lo
  // abres a mano, aparece marcado (y puedes desmarcarlo para que vuelva
  // a salir solo).
  document.getElementById('gym-help-dont-show').checked =
    localStorage.getItem('gymLiveHelpSeen') === '1';
  document.getElementById('gym-help-modal').classList.remove('hidden');
}
function closeGymHelpModal() {
  localStorage.setItem(
    'gymLiveHelpSeen',
    document.getElementById('gym-help-dont-show').checked ? '1' : '0'
  );
  document.getElementById('gym-help-modal').classList.add('hidden');
}
document.getElementById('btn-gym-live-help').addEventListener('click', openGymHelpModal);
document.getElementById('btn-close-gym-help').addEventListener('click', closeGymHelpModal);

// Ocultar el entrenamiento sin descartarlo (el ▾ de la cabecera): vuelve
// al Gimnasio con sus pestanas utilizables. El ticker sigue vivo.
document.getElementById('btn-gym-live-header-hide').addEventListener('click', closeGymLiveView);

// Pausar/reanudar el CRONOMETRO de la sesion (aclarado con Koku: la
// pausa del menu congela el tiempo de sesion -- si te interrumpen, el
// entreno no "engorda"). El descanso entre series NO se pausa: es tiempo
// de reloj de pared. pausedMs/pausedAt, ver gymLiveElapsedSeconds().
function gymToggleSessionPause() {
  if (!gymLiveSession) return;
  if (gymLiveSession.pausedAt) {
    gymLiveSession.pausedMs = (gymLiveSession.pausedMs || 0) + (Date.now() - gymLiveSession.pausedAt);
    gymLiveSession.pausedAt = null;
  } else {
    gymLiveSession.pausedAt = Date.now();
  }
  gymLiveStore();
  refreshGymLivePauseUi();
  gymLiveTick();
}
function refreshGymLivePauseUi() {
  const paused = !!(gymLiveSession && gymLiveSession.pausedAt);
  document.getElementById('btn-gym-live-pause').classList.toggle('is-paused', paused);
  document.getElementById('btn-gym-live-pause').setAttribute('aria-label', paused ? 'Reanudar el cronómetro' : 'Pausar el cronómetro');
}
document.getElementById('btn-gym-live-pause').addEventListener('click', gymToggleSessionPause);

// El menu flotante de acciones del entreno: el boton central abre/cierra
// el abanico de 4 botones (dudas / pausar / terminar / descartar).
// Cualquier accion lo cierra, y un toque fuera tambien.
const GYM_LIVE_FAB = document.getElementById('gym-live-fab');
function closeGymLiveFab() {
  GYM_LIVE_FAB.classList.remove('open');
  document.getElementById('btn-gym-live-menu').setAttribute('aria-expanded', 'false');
}
document.getElementById('btn-gym-live-menu').addEventListener('click', () => {
  const abierto = GYM_LIVE_FAB.classList.toggle('open');
  document.getElementById('btn-gym-live-menu').setAttribute('aria-expanded', abierto ? 'true' : 'false');
});
GYM_LIVE_FAB.querySelectorAll('.gym-live-fab-action').forEach((btn) => {
  btn.addEventListener('click', closeGymLiveFab);
});
document.addEventListener('click', (e) => {
  if (!GYM_LIVE_FAB.classList.contains('open')) return;
  // Leccion aprendida (ver CLAUDE.md): si el nodo pulsado ya no esta en
  // el documento (repintado en su propio manejador), closest() daria
  // null y pareceria un "clic fuera" -- se ignora.
  if (!document.contains(e.target)) return;
  if (!e.target.closest('#gym-live-fab')) closeGymLiveFab();
});

// Con el entreno en vivo abierto, tocar la navegacion inferior del
// movil no "funcionaba" (la nav cambiaba la pantalla POR DEBAJO del
// overlay y no se veia nada). Ahora esconde el overlay primero: la
// sesion sigue viva en localStorage y en Entrenar queda el boton de
// "continuar". Listener en captura para adelantarse al de la nav.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.mobile-nav')) return;
  const live = document.getElementById('gym-live-view');
  if (live && !live.classList.contains('hidden')) closeGymLiveView();
}, true);

// Tocar la mini-barra global de descanso vuelve al entrenamiento.
// Configuracion es un modal que quedaria POR ENCIMA del entreno, asi que
// se cierra primero (feedback de Koku: "desde configuracion no me lleva
// al entrenamiento").
document.getElementById('gym-global-rest').addEventListener('click', () => {
  if (!gymLiveSession) return;
  if (typeof closeSettingsModal === 'function') closeSettingsModal();
  // En modo "te toca" (descanso acabado, serie pendiente) la barra
  // arranca la serie ademas de llevarte al entreno: es justo el paso que
  // se olvidaba.
  const iEspera = gymIndiceDelEjercicioEnEspera();
  openGymLiveView();
  if (iEspera >= 0) {
    gymStartSet(iEspera);
    renderGymLiveExercises();
    gymLiveTick();
  }
});

// Al arrancar la app, si quedo una sesion en curso guardada se carga en
// memoria (sin abrir el overlay): asi el indicador de la nav y la
// mini-barra de descanso funcionan desde el primer momento.
gymLiveSession = gymLiveReadStored();
if (gymLiveSession) {
  gymLiveTicker = setInterval(gymLiveTick, 1000);
  // Por si la app se relanzo con +30s de la pantalla de bloqueo sin
  // recoger (el visibilitychange no cubre el primer arranque).
  gymConsumeRestExtensionFromLockScreen();
  // Y si el relanzamiento pillo un descanso a medias, la vigilancia de
  // audio (bajar la musica al acabar) se rearma con el final vigente.
  if (gymLiveSession.restUntil && gymLiveSession.restUntil > Date.now()) {
    gymStartRestAudioWatch();
  }
}
refreshGymLiveIndicators();

// Descartar: tirar el entrenamiento en curso sin guardar nada.
document.getElementById('btn-gym-live-discard').addEventListener('click', async () => {
  const ok = await showAppConfirm('¿Descartar el entrenamiento? No se guardará nada de hoy.', { okText: 'Descartar', danger: true });
  if (!ok) return;
  localStorage.removeItem('gymLiveSession');
  gymLiveSession = null;
  gymLiveStopTicker();
  closeGymLiveView();
});

// Terminar: convertir lo hecho en una sesion de verdad + resumen.
document.getElementById('btn-gym-live-finish').addEventListener('click', async () => {
  // Sin entreno en marcha no hay nada que terminar. No deberia pasar (el
  // boton vive dentro de la pantalla del entreno, que solo se ve con una
  // sesion abierta), pero sin esto la funcion revienta con un null.
  if (!gymLiveSession) return;
  // Solo cuentan las series marcadas como hechas o con algun dato; las
  // filas vacias pre-creadas por el plan se ignoran sin molestar.
  const sets = [];
  const exerciseNotes = {};
  const musclesTouched = new Set();
  let volumeKg = 0;
  let failureSets = 0;
  for (const ex of gymLiveSession.exercises) {
    if (ex.note && ex.note.trim()) exerciseNotes[ex.exerciseId] = ex.note.trim();
    for (const set of ex.sets) {
      if (!set.done && set.reps === '' && set.weightDisplay === '') continue;
      const weightKg = gymWeightDisplayToKg(set.weightDisplay);
      // Tramos de una serie alargada: el peso viaja en kg como el de la
      // serie madre (la libra es solo de presentacion, ver el esquema).
      const segments = (set.segments || []).map((seg) => ({
        kind: seg.kind,
        reps: seg.reps,
        weightKg: gymWeightDisplayToKg(seg.weightDisplay),
        pauseSeconds: seg.pauseSeconds,
      })).filter((seg) => Number(seg.reps) > 0);
      sets.push({
        exerciseId: ex.exerciseId,
        reps: set.reps,
        weightKg,
        segments,
        setType: set.failure ? 'failure' : null,
        restSeconds: set.restSeconds,
        // El RPE es del EJERCICIO (peticion de Koku): se guarda replicado
        // en cada serie para no cambiar el esquema de gym_sets.
        rpe: ex.rpe,
        extraRestSeconds: set.extraRest || null,
        // Cuanto duro la serie (del boton "empezar" al "terminar").
        durationSeconds: set.durationSeconds || null,
        side: set.side || null,
        notes: set.note || null,
      });
      let volumenDeLaSerie = (Number(set.reps) || 0) * (weightKg || 0);
      for (const seg of segments) volumenDeLaSerie += (Number(seg.reps) || 0) * (Number(seg.weightKg) || 0);
      if (set.failure) {
        failureSets += 1;
        volumenDeLaSerie = gymVolumenAjustado(volumenDeLaSerie, volumenDeLaSerie);
      }
      volumeKg += volumenDeLaSerie;
      const exercise = state.gymExercises.find((e) => e.id === ex.exerciseId);
      if (exercise && exercise.muscleGroup) musclesTouched.add(gymMuscleGroupLabel(exercise.muscleGroup));
    }
  }
  if (sets.length === 0) {
    const ok = await showAppConfirm('No has marcado ninguna serie. ¿Descartar el entrenamiento?', { okText: 'Descartar', danger: true });
    if (!ok) return;
    localStorage.removeItem('gymLiveSession');
    gymLiveSession = null;
    gymLiveStopTicker();
    closeGymLiveView();
    return;
  }

  const durationSeconds = gymLiveElapsedSeconds();
  // Se guarda antes de vaciar gymLiveSession: mas abajo se pone a null y
  // para entonces ya no habria de donde sacar que dia del plan se hizo.
  const rutinaDelEntreno = gymLiveSession.routineId;
  await api('/api/gym-sessions', {
    method: 'POST',
    body: JSON.stringify({
      date: toDateKey(new Date()),
      routineId: gymLiveSession.routineId,
      sets,
      startedAt: new Date(gymLiveSession.startedAt).toISOString(),
      durationSeconds,
      exerciseNotes,
    }),
  });

  // Resumen: duracion, series, volumen (en la unidad del dispositivo) y
  // grupos musculares tocados.
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  document.getElementById('gym-summary-duration').textContent = `${minutes} min`;
  document.getElementById('gym-summary-sets').textContent = String(sets.length);
  document.getElementById('gym-summary-volume').textContent = `${gymWeightKgToDisplay(volumeKg)} ${getGymWeightUnitLabel()}`;
  document.getElementById('gym-summary-failure').textContent = String(failureSets);
  document.getElementById('gym-summary-muscles').textContent = String(musclesTouched.size);
  document.getElementById('gym-summary-muscle-list').textContent = [...musclesTouched].join(' · ');

  localStorage.removeItem('gymLiveSession');
  gymLiveSession = null;
  gymLiveStopTicker();
  closeGymLiveView();
  document.getElementById('gym-live-summary-modal').classList.remove('hidden');

  await loadGymSessions();
  renderGymSessionsList();
  populateGymProgressExerciseSelect();
  // El ciclo del bloque avanza AQUI, tras guardar: si lo entrenado era
  // lo que tocaba pasa solo, y si no, pregunta donde recolocarlo. Se
  // hace despues del resumen para no meter un dialogo por delante del
  // "ya has terminado".
  await gymAvanzarCicloTrasEntrenar(rutinaDelEntreno);
  // La celebracion de logros (si algo subio de nivel) queda ABIERTA
  // detras del resumen: al cerrar el resumen aparece ella.
  checkGymAchievements();
});
document.getElementById('btn-close-gym-summary').addEventListener('click', () => {
  document.getElementById('gym-live-summary-modal').classList.add('hidden');
});

// --- El widget de "que toca hoy" -------------------------------------
// El puente vive en widget-bridge.js, que se carga aparte: si no
// estuviera (o en un navegador normal), estas llamadas no deben romper
// nada de lo que las rodea, que es cargar el gimnasio.
function actualizarResumenDelWidget() {
  if (typeof actualizarWidgetDelDia === 'function') actualizarWidgetDelDia();
}

// Abrir la app desde un widget lleva a lo que ese widget enseña. Se
// comprueba al volver a primer plano, igual que el +30s de la pantalla de
// bloqueo: el nativo deja una marca con el destino y aqui se consume UNA
// vez.
//
// El destino llega como texto ('tareas', 'finanzas', ...) y NO se interpreta
// en Swift a proposito: asi anadir un widget nuevo se hace entero desde
// aqui, sin recompilar nada nativo.
async function comprobarAperturaDesdeElWidget() {
  if (typeof widgetPideAbrir !== 'function') return;
  let destino = '';
  try { destino = await widgetPideAbrir(); } catch { return; }
  if (!destino) return;

  if (destino === 'gym-hoy') { await abrirEntrenoDeHoyDesdeWidget(); return; }

  // Las Apps (Finanzas, Lecturas, Viajes) viven dentro del hub de Apps:
  // hay que abrir ese primero o la pantalla se queda debajo.
  const apps = {
    finanzas: () => openFinanzasView(),
    lecturas: () => openLecturasView(),
    viajes: () => openViajesView(),
  };
  if (apps[destino]) {
    goToMobileSection('extensions');
    await apps[destino]();
    return;
  }

  if (destino === 'tareas') { await abrirTareasDesdeWidget(); return; }

  // Los dos que se quedan en el calendario.
  goToMobileSection('calendar');
  if (destino === 'nuevo-evento') {
    openEventModal(null);
  } else if (destino === 'nueva-nota') {
    openMobileNotesView();
    openNoteInEditor(null);
  }
}

// El widget del Gimnasio: arrancar el entreno que toca hoy.
async function abrirEntrenoDeHoyDesdeWidget() {
  // Con un entreno YA en marcha no se empieza otro encima: se abre el que
  // hay. Perder un entreno a medias por tocar un widget seria muy caro.
  if (gymLiveReadStored()) {
    gymLiveSession = gymLiveReadStored();
    goToMobileSection('extensions');
    if (typeof openGymView === 'function') await openGymView();
    openGymLiveView();
    return;
  }
  // Los bloques y los dias pueden no estar cargados todavia (el widget
  // puede abrir la app desde cero): se piden antes de mirar el ciclo.
  await Promise.all([loadGymBlocks(), loadGymRoutines(), loadGymExercises()]);
  const hoy = gymCicloDeHoy();
  goToMobileSection('extensions');
  if (typeof openGymView === 'function') await openGymView();
  // Si hoy toca descanso (o no hay ciclo), se abre el selector en vez de
  // arrancar algo a lo loco: el widget es un atajo, no una decision.
  if (!hoy || hoy.esDescanso || !hoy.rutina) openGymStartModal();
  else startGymLiveSession(hoy.rutina);
}

// El widget de Tareas. En movil NO hay un "Mi espacio" donde vivan las
// tareas (ver CLAUDE.md: se quito a proposito, las tareas viven dentro
// del propio calendario), asi que el sitio donde se ven todas juntas y
// se pueden tachar es Grupos > "Todos los eventos" con los filtros
// puestos en tareas pendientes. Eso es justo lo que enseña el widget.
async function abrirTareasDesdeWidget() {
  goToMobileSection('calendar');
  if (typeof openGroupsView !== 'function') return;
  await openGroupsView();
  groupsViewFilters.type = 'task';
  groupsViewFilters.done = 'pending';
  // Los desplegables tienen que ENSEÑAR el filtro que se acaba de poner:
  // si no, dirian "Todo" mientras la lista esta filtrada, y parece que
  // faltan cosas.
  try {
    groupsFilterTypeField.setValue('task');
    groupsFilterDoneField.setValue('pending');
  } catch { /* si el componente cambia, el filtro sigue aplicado igual */ }
  await openGroupDetail(null, 'Todos los eventos');
}

// --- "Hoy te toca": el ciclo visto desde fuera del Gimnasio -----------
//
// El ciclo del bloque ACTIVO se consulta al vuelo (decision de Koku: es
// un aviso calculado, no una tarea guardada en la base). Asi siempre
// esta al dia y cambiar el plan lo cambia solo, sin filas viejas por
// ahi ni nada que regenerar.
//
// Devuelve null si no hay bloque activo o si ese bloque no usa ciclo.
function gymCicloDeHoy() {
  const bloque = state.gymBlocks.find((b) => b.isActive);
  if (!bloque || !bloque.cycleEnabled || !bloque.cycleToday) return null;
  const rutina = bloque.cycleToday.routineId
    ? state.gymRoutines.find((r) => r.id === bloque.cycleToday.routineId) || null
    : null;
  // Una posicion que apunta a un dia BORRADO se trata como descanso, en
  // vez de dejar el aviso a medias.
  return {
    bloque,
    position: bloque.cycleToday.position,
    length: bloque.cycleLength,
    rutina,
    esDescanso: bloque.cycleToday.isRest || !rutina,
  };
}

// Cual es la posicion SIGUIENTE del ciclo (dando la vuelta al final).
function gymCicloSiguientePosicion(bloque, desde) {
  if (!bloque || !bloque.cycleDays || bloque.cycleDays.length === 0) return null;
  const i = bloque.cycleDays.findIndex((d) => d.position === desde);
  if (i === -1) return bloque.cycleDays[0].position;
  return bloque.cycleDays[(i + 1) % bloque.cycleDays.length].position;
}

// NO hay aviso de "hoy toca X" en el CALENDARIO. Llego a existir (una
// tira bajo la cabecera del dia) y Koku lo quito el 9/9/2026: "que te
// muestre lo de que entrenamiento toca en el calendario realmente no me
// aporta nada, era mas bien el que pudiera saber el widget que dia es y
// asi saber a que dia esta enlazado cada entrenamiento". O sea que el
// ciclo NO es para pintar el calendario: es para que el Gimnasio sepa
// que ofrecerte y para alimentar el widget. Si vuelve a hacer falta,
// gymCicloDeHoy() da todo lo necesario en una sola llamada.

// Al terminar un entreno: mover el cursor del ciclo. Si lo entrenado era
// lo que tocaba, avanza solo y en silencio (el caso normal). Si NO lo
// era -- hoy tocaba descanso y has entrenado igual, o has hecho otro dia
// --, se PREGUNTA donde recolocar el ciclo, que es lo que pidio Koku
// para saber como sigue el aviso y el widget.
async function gymAvanzarCicloTrasEntrenar(routineId) {
  const hoy = gymCicloDeHoy();
  if (!hoy) return;
  const bloque = hoy.bloque;

  const acertaste = !hoy.esDescanso && hoy.rutina && Number(routineId) === hoy.rutina.id;
  if (acertaste) {
    const siguiente = gymCicloSiguientePosicion(bloque, hoy.position);
    if (siguiente !== null) {
      await api(`/api/gym-blocks/${bloque.id}/cycle/position`, {
        method: 'POST', body: JSON.stringify({ position: siguiente }),
      });
      await loadGymBlocks();
    }
    return;
  }

  // Fuera de plan. Si lo que has hecho ESTA en el ciclo, se puede
  // recolocar detras de eso; si no (entreno libre o un dia que no esta
  // en el ciclo), lo unico sensato es dejarlo como estaba.
  const enElCiclo = routineId
    ? (bloque.cycleDays || []).find((d) => d.routineId === Number(routineId))
    : null;
  const queTocaba = hoy.esDescanso ? 'descanso' : `“${hoy.rutina.name}”`;
  if (!enElCiclo) {
    // Dos redacciones: "no has hecho el dia que tocaba" y "hoy tocaba
    // descansar y has entrenado igual" no son la misma frase.
    await showAppAlert(hoy.esDescanso
      ? 'Hoy tocaba descanso en tu ciclo y lo que has entrenado no es ninguno de sus días, así que el ciclo se queda donde estaba: mañana seguirá tocando este descanso.'
      : `Hoy tocaba ${queTocaba} en tu ciclo y no lo has hecho, así que el ciclo se queda donde estaba: mañana te seguirá tocando ${queTocaba}.`);
    return;
  }

  const nombreHecho = state.gymRoutines.find((r) => r.id === Number(routineId));
  const siguienteAlHecho = gymCicloSiguientePosicion(bloque, enElCiclo.position);
  const rutinaSiguiente = (bloque.cycleDays || []).find((d) => d.position === siguienteAlHecho);
  const nombreSiguiente = rutinaSiguiente && rutinaSiguiente.routineId
    ? (state.gymRoutines.find((r) => r.id === rutinaSiguiente.routineId) || {}).name || 'descanso'
    : 'descanso';
  const recolocar = await showAppConfirm(
    `Hoy tocaba ${queTocaba}, pero has hecho “${nombreHecho ? nombreHecho.name : 'otro día'}”. ¿Recoloco el ciclo ahí? Mañana te tocaría ${nombreSiguiente === 'descanso' ? 'descanso' : `“${nombreSiguiente}”`}.`,
    { okText: 'Recolocar', cancelText: 'Dejarlo como estaba' }
  );
  if (!recolocar) return;
  await api(`/api/gym-blocks/${bloque.id}/cycle/position`, {
    method: 'POST', body: JSON.stringify({ position: siguienteAlHecho }),
  });
  await loadGymBlocks();
}

// --- Ciclo de dias de un bloque ---------------------------------------
//
// Un bloque puede repetirse en ciclo: "dia 1 Empuje, dia 2 Tiron, dia 3
// descanso, y vuelta a empezar". Se edita como una LISTA ordenada de
// posiciones, cada una con un desplegable propio de la app (nunca un
// <select> nativo, regla del proyecto) donde eliges un dia del bloque o
// "Descanso".
//
// El borrador vive aparte del bloque guardado para que Cancelar de
// verdad descarte, igual que el nombre.
let gymCicloBloqueId = null;
let gymCicloBorrador = [];
// Por que posicion del ciclo vas HOY. Es parte del borrador como todo lo
// demas: se elige aqui y se manda al guardar, no al vuelo.
let gymCicloHoyBorrador = null;
let gymCicloHoyField = null;
// Los desplegables se guardan para poder leerlos, y se recrean enteros
// en cada repintado (como el resto de listas de este formulario): asi
// las flechas de los extremos se apagan solas y los indices de los
// listeners vuelven a cuadrar.
let gymCicloCampos = [];

function gymCicloDiasDelBloque() {
  if (!gymCicloBloqueId) return [];
  return state.gymRoutines.filter((r) => r.blockId === gymCicloBloqueId);
}

function renderGymCicloEditor() {
  const encendido = document.getElementById('gym-block-cycle-enabled').checked;
  const wrap = document.getElementById('gym-block-cycle-wrap');
  wrap.classList.toggle('hidden', !encendido || !gymCicloBloqueId);
  const lista = document.getElementById('gym-block-cycle-list');
  lista.innerHTML = '';
  gymCicloCampos = [];
  if (!encendido || !gymCicloBloqueId) return;

  const dias = gymCicloDiasDelBloque();
  const opciones = [
    { value: '', label: 'Descanso' },
    ...dias.map((d) => ({ value: String(d.id), label: d.name, color: d.color, icon: d.icon || '' })),
  ];

  gymCicloBorrador.forEach((pos, i) => {
    const fila = document.createElement('div');
    fila.className = 'gym-cycle-row';
    fila.innerHTML = `
      <span class="gym-cycle-row-num">Día ${i + 1}</span>
      <div class="gym-cycle-row-field"></div>
      <div class="gym-cycle-row-actions">
        <button type="button" class="icon-btn" data-subir aria-label="Subir">↑</button>
        <button type="button" class="icon-btn" data-bajar aria-label="Bajar">↓</button>
        <button type="button" class="icon-btn" data-quitar aria-label="Quitar del ciclo">✕</button>
      </div>
    `;
    const campo = createSelectField({
      options: opciones,
      initialValue: pos.routineId === null || pos.routineId === undefined ? '' : String(pos.routineId),
      onChange: (v) => { pos.routineId = v === '' ? null : Number(v); actualizarResumenDelCiclo(); },
    });
    fila.querySelector('.gym-cycle-row-field').appendChild(campo.element);
    gymCicloCampos.push(campo);
    const subir = fila.querySelector('[data-subir]');
    const bajar = fila.querySelector('[data-bajar]');
    subir.disabled = i === 0;
    bajar.disabled = i === gymCicloBorrador.length - 1;
    subir.addEventListener('click', () => {
      [gymCicloBorrador[i - 1], gymCicloBorrador[i]] = [gymCicloBorrador[i], gymCicloBorrador[i - 1]];
      renderGymCicloEditor();
    });
    bajar.addEventListener('click', () => {
      [gymCicloBorrador[i + 1], gymCicloBorrador[i]] = [gymCicloBorrador[i], gymCicloBorrador[i + 1]];
      renderGymCicloEditor();
    });
    fila.querySelector('[data-quitar]').addEventListener('click', () => {
      gymCicloBorrador.splice(i, 1);
      renderGymCicloEditor();
    });
    lista.appendChild(fila);
  });

  if (gymCicloBorrador.length === 0) {
    lista.innerHTML = '<p class="empty-hint">Todavía no has colocado ningún día. Añade tantos como dure tu ciclo.</p>';
  }
  actualizarResumenDelCiclo();
  renderGymCicloHoyField(dias);
}

// El selector de "Hoy te toca". Se reconstruye entero en cada repintado,
// como el resto de este formulario: las posiciones cambian al añadir,
// quitar o mover filas, y las etiquetas tienen que seguirlas.
function renderGymCicloHoyField(dias) {
  const cont = document.getElementById('gym-block-cycle-hoy-field');
  const etiqueta = document.querySelector('.gym-cycle-hoy-label');
  if (!cont) return;
  // Sin ciclo no hay nada por donde ir.
  const hayCiclo = gymCicloBorrador.length > 0;
  cont.classList.toggle('hidden', !hayCiclo);
  if (etiqueta) etiqueta.classList.toggle('hidden', !hayCiclo);
  const pista = cont.nextElementSibling;
  if (pista && pista.classList.contains('hint')) pista.classList.toggle('hidden', !hayCiclo);
  cont.innerHTML = '';
  gymCicloHoyField = null;
  if (!hayCiclo) return;

  const opciones = gymCicloBorrador.map((pos, i) => {
    const dia = pos.routineId == null ? null : dias.find((d) => d.id === pos.routineId);
    return { value: String(i + 1), label: `Día ${i + 1} · ${dia ? dia.name : 'Descanso'}` };
  });
  // Si el ciclo se ha acortado por debajo de donde estabas, se vuelve al
  // dia 1 en vez de dejar un valor que ya no existe.
  if (!gymCicloHoyBorrador || gymCicloHoyBorrador > gymCicloBorrador.length) gymCicloHoyBorrador = 1;
  gymCicloHoyField = createSelectField({
    options: opciones,
    initialValue: String(gymCicloHoyBorrador),
    onChange: (v) => { gymCicloHoyBorrador = Number(v); },
  });
  cont.appendChild(gymCicloHoyField.element);
}

// Una linea en cristiano de lo que va a pasar, para no tener que
// interpretar la lista de desplegables: "Ciclo de 3 días: Empuje ·
// Tirón · Descanso".
function actualizarResumenDelCiclo() {
  const el = document.getElementById('gym-block-cycle-status');
  if (!el) return;
  if (gymCicloBorrador.length === 0) { el.textContent = ''; return; }
  const dias = gymCicloDiasDelBloque();
  const nombres = gymCicloBorrador.map((p) => {
    if (p.routineId === null || p.routineId === undefined) return 'Descanso';
    const d = dias.find((x) => x.id === p.routineId);
    return d ? d.name : 'Descanso';
  });
  el.textContent = `Ciclo de ${gymCicloBorrador.length} día${gymCicloBorrador.length === 1 ? '' : 's'}: ${nombres.join(' · ')}`;
}

document.getElementById('gym-block-cycle-enabled').addEventListener('change', () => {
  // Encenderlo con el ciclo vacio propone directamente una posicion por
  // cada dia del bloque, que es lo que casi siempre se quiere.
  if (document.getElementById('gym-block-cycle-enabled').checked && gymCicloBorrador.length === 0) {
    gymCicloBorrador = gymCicloDiasDelBloque().map((d) => ({ routineId: d.id }));
  }
  renderGymCicloEditor();
});
document.getElementById('btn-gym-cycle-add').addEventListener('click', () => {
  gymCicloBorrador.push({ routineId: null });
  renderGymCicloEditor();
});

// --- Modal de bloque (rediseno de Gimnasio) ---------------------------
// Un solo campo (el nombre), al estilo de la app de referencia. Activar
// se hace desde la lista, no desde aqui.
function openGymBlockModal(block) {
  document.getElementById('gym-block-modal-title').textContent = block ? 'Editar bloque' : 'Nuevo bloque';
  document.getElementById('gym-block-id').value = block ? block.id : '';
  document.getElementById('gym-block-name').value = block ? block.name : '';
  document.getElementById('btn-delete-gym-block').classList.toggle('hidden', !block);
  // El ciclo se edita en el borrador gymCicloBorrador y solo se guarda al
  // dar a Guardar, igual que el nombre: cancelar tiene que descartarlo.
  gymCicloBloqueId = block ? block.id : null;
  gymCicloBorrador = block && block.cycleDays ? block.cycleDays.map((d) => ({ routineId: d.routineId })) : [];
  gymCicloHoyBorrador = block && block.cyclePosition ? block.cyclePosition : 1;
  document.getElementById('gym-block-cycle-enabled').checked = !!(block && block.cycleEnabled);
  // Un bloque que aun no existe no tiene dias que colocar en un ciclo:
  // se esconde entero hasta que se guarde y se vuelva a abrir.
  document.getElementById('gym-block-cycle-enabled').closest('.checkbox-row').classList.toggle('hidden', !block);
  document.querySelector('#gym-block-modal .gym-cycle-heading').classList.toggle('hidden', !block);
  renderGymCicloEditor();
  document.getElementById('gym-block-modal').classList.remove('hidden');
}
function closeGymBlockModal() {
  document.getElementById('gym-block-modal').classList.add('hidden');
}
document.getElementById('btn-new-gym-block').addEventListener('click', () => openGymBlockModal(null));
document.getElementById('btn-cancel-gym-block').addEventListener('click', closeGymBlockModal);
document.getElementById('btn-close-gym-block').addEventListener('click', closeGymBlockModal);

document.getElementById('gym-block-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('gym-block-id').value;
  const payload = { name: document.getElementById('gym-block-name').value };
  if (id) {
    await api(`/api/gym-blocks/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    // El ciclo va en su propia llamada: es una lista entera que se
    // reescribe, no un campo mas del bloque.
    await api(`/api/gym-blocks/${id}/cycle`, {
      method: 'PUT',
      body: JSON.stringify({
        enabled: document.getElementById('gym-block-cycle-enabled').checked,
        days: gymCicloBorrador.map((p) => ({ routineId: p.routineId })),
      }),
    });
    // Y por donde vas hoy, DESPUES de guardar el ciclo: la ruta rechaza
    // una posicion que no exista, y las posiciones son las que acaban de
    // guardarse. La fecha se pone a hoy sola, asi que un descanso elegido
    // aqui se consume mañana, como cualquier otro.
    if (gymCicloBorrador.length > 0) {
      // Se recorta al rango de verdad ANTES de mandarla. Sin esto, una
      // posicion imposible hacia que la ruta lanzara y el error se
      // llevaba por delante TODO lo que viene despues -- el modal se
      // quedaba abierto y la lista sin refrescar, aunque el ciclo si se
      // hubiera guardado. Encontrado forzando fallos.
      const posicion = Math.min(Math.max(1, Number(gymCicloHoyBorrador) || 1), gymCicloBorrador.length);
      try {
        await api(`/api/gym-blocks/${id}/cycle/position`, {
          method: 'POST',
          body: JSON.stringify({ position: posicion }),
        });
      } catch (err) {
        // Que no se pueda mover el cursor no es motivo para no guardar el
        // ciclo, que es lo importante: se avisa y se sigue.
        showAppAlert('El ciclo se ha guardado, pero no se ha podido cambiar por dónde vas hoy.');
      }
    }
  } else {
    await api('/api/gym-blocks', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeGymBlockModal();
  await loadGymBlocks();
  renderGymBlocksList();
});

document.getElementById('btn-delete-gym-block').addEventListener('click', async () => {
  const id = Number(document.getElementById('gym-block-id').value);
  const block = state.gymBlocks.find((b) => b.id === id);
  const dayCount = block ? block.dayCount : 0;
  // Borrar un bloque se lleva sus dias (plantillas), aunque nunca el
  // historial de sesiones -- se avisa con el confirm propio de la app,
  // no con el del navegador (regla del proyecto).
  const ok = await showAppConfirm(
    dayCount > 0
      ? `¿Eliminar este bloque y ${dayCount === 1 ? 'su día' : `sus ${dayCount} días`}? Las sesiones ya registradas no se pierden.`
      : '¿Eliminar este bloque?',
    { okText: 'Eliminar', danger: true }
  );
  if (!ok) return;
  await api(`/api/gym-blocks/${id}`, { method: 'DELETE' });
  closeGymBlockModal();
  await Promise.all([loadGymBlocks(), loadGymRoutines(), loadGymSessions()]);
  renderGymBlocksList();
  renderGymSessionsList();
});

// --- Modal de dia (antes "rutina" -- ids gym-routine-* conservados) ---
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

// Las opciones para el selector PROPIO con buscador (createSelectField),
// que sustituyo a los <select> nativos de estas filas.
//
// Se ve SOLO el nombre (peticion de Koku: "deja solo el nombre, el
// musculo no hace falta que aparezca... ten en cuenta que muchos
// ejercicios a veces ya llevan el musculo en el nombre" -- "Curl de
// Biceps · Biceps" se leia repetido). Pero el musculo y el material
// siguen viajando en `keywords`, que el buscador SI mira: escribir
// "pierna" sigue sacando todas las de pierna aunque ninguna se llame
// asi, sin ensuciar la lista.
function gymExerciseSelectOptions() {
  return state.gymExercises.map((ex) => ({
    value: String(ex.id),
    label: ex.name,
    keywords: [gymMuscleGroupLabel(ex.muscleGroup) || '', ex.equipment || ''].filter(Boolean).join(' '),
  }));
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
    rowEl.className = 'gym-routine-exercise-row gym-routine-exercise-stacked' + (row.hidden ? ' gym-exercise-hidden' : '');
    // El ojo oculta el ejercicio SIN quitarlo del dia: los entrenos nuevos
    // no lo pre-cargan, pero se puede recuperar durante la sesion desde
    // "Ejercicios ocultos" (peticion de Koku: aparcar sin borrar).
    const eyeSvg = row.hidden
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.1 8.1 2.5 10.4 2 12c1 2.5 5 7 10 7 1.5 0 2.9-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    const restPreviewText = (seconds) => {
      const n = Number(seconds);
      return n > 0 ? `Descanso: ${gymLiveFormatClock(n)} min` : '';
    };
    // Subir / bajar el ejercicio dentro del dia (peticion de Koku: "por
    // si me equivoco y pongo un ejercicio antes, no tener que moverlo
    // cada vez"). Con flechas y no arrastrando: dentro de un modal que
    // ya se desplaza, arrastrar una fila pelea con el scroll, y aqui lo
    // que hace falta es colocar una cosa en su sitio, no reordenar una
    // lista larga. Las flechas de los extremos se quedan apagadas.
    const flechaArriba = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    const flechaAbajo = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
    const esPrimero = index === 0;
    const esUltimo = index === gymRoutineModalExercises.length - 1;
    rowEl.innerHTML = `
      <div class="gym-routine-exercise-name-row">
        <div class="gym-routine-exercise-order">
          <button type="button" class="icon-btn" data-field="subir" aria-label="Subir el ejercicio" title="Subir" ${esPrimero ? 'disabled' : ''}>${flechaArriba}</button>
          <button type="button" class="icon-btn" data-field="bajar" aria-label="Bajar el ejercicio" title="Bajar" ${esUltimo ? 'disabled' : ''}>${flechaAbajo}</button>
        </div>
        <div class="gym-routine-exercise-picker"></div>
        <button type="button" class="icon-btn" data-field="toggleHidden" aria-label="${row.hidden ? 'Mostrar en los entrenos' : 'Ocultar de los entrenos'}" title="${row.hidden ? 'Oculto: los entrenos nuevos no lo cargan. Tocar para mostrarlo.' : 'Ocultar de los entrenos nuevos (sin borrarlo del día)'}">${eyeSvg}</button>
        <button type="button" class="icon-btn" data-field="remove" aria-label="Quitar ejercicio">✕</button>
      </div>
      <div class="gym-routine-exercise-targets-row">
        <input type="number" data-field="targetSets" placeholder="Series" min="0" value="${row.targetSets ?? ''}" />
        <input type="number" data-field="targetReps" placeholder="Reps" min="0" value="${row.targetReps ?? ''}" />
        <input type="number" data-field="targetRestSeconds" placeholder="Descanso (s)" min="0" title="En segundos" value="${row.targetRestSeconds ?? ''}" />
      </div>
      <p class="hint gym-rest-preview">${restPreviewText(row.targetRestSeconds)}</p>
    `;
    // Selector propio CON BUSCADOR (peticion de Koku: con muchos
    // ejercicios, un desplegable pelado es una odisea). Sustituye al
    // <select> nativo que habia aqui, que ademas incumplia la regla del
    // proyecto de no usar controles del navegador.
    const picker = createSelectField({
      options: gymExerciseSelectOptions(),
      initialValue: row.exerciseId != null ? String(row.exerciseId) : '',
      placeholder: 'Elige un ejercicio',
      searchable: true,
      onChange: (valor) => cambiarEjercicioDeLaFila(valor),
    });
    rowEl.querySelector('.gym-routine-exercise-picker').appendChild(picker.element);
    function cambiarEjercicioDeLaFila(valor) {
      const anteriores = gymTargetsPorDefecto(gymRoutineModalExercises[index].exerciseId);
      const nuevoId = Number(valor);
      gymRoutineModalExercises[index].exerciseId = nuevoId;
      // La fila pasa a ser OTRO ejercicio, asi que se traen sus valores
      // por defecto -- pero solo en los campos que no hayas tocado tu.
      // "No tocado" = vacio, o igual a lo que traia el ejercicio
      // anterior. Asi cambiar de ejercicio no te borra un 4x8 que
      // habias escrito a mano, y a la vez no te deja el descanso del
      // ejercicio de antes puesto sin querer.
      const nuevos = gymTargetsPorDefecto(nuevoId);
      GYM_TARGET_FIELDS.forEach(({ enElDia }) => {
        const actual = gymRoutineModalExercises[index][enElDia];
        const sinTocar = actual === '' || actual == null || String(actual) === String(anteriores[enElDia]);
        if (sinTocar) gymRoutineModalExercises[index][enElDia] = nuevos[enElDia];
      });
      renderGymRoutineExercisesField();
    }
    rowEl.querySelector('[data-field="targetSets"]').addEventListener('input', (e) => {
      gymRoutineModalExercises[index].targetSets = e.target.value;
    });
    rowEl.querySelector('[data-field="targetReps"]').addEventListener('input', (e) => {
      gymRoutineModalExercises[index].targetReps = e.target.value;
    });
    rowEl.querySelector('[data-field="targetRestSeconds"]').addEventListener('input', (e) => {
      gymRoutineModalExercises[index].targetRestSeconds = e.target.value;
      // Vista previa en vivo del descanso ("90" -> "1:30 min"): el campo
      // esta en segundos y no se notaba (feedback de Koku).
      rowEl.querySelector('.gym-rest-preview').textContent = restPreviewText(e.target.value);
    });
    rowEl.querySelector('[data-field="toggleHidden"]').addEventListener('click', () => {
      gymRoutineModalExercises[index].hidden = !gymRoutineModalExercises[index].hidden;
      renderGymRoutineExercisesField();
    });
    rowEl.querySelector('[data-field="remove"]').addEventListener('click', () => {
      gymRoutineModalExercises.splice(index, 1);
      renderGymRoutineExercisesField();
    });
    // Intercambiar con el vecino. Se repinta la lista entera (como hace
    // todo este formulario) en vez de mover nodos a mano: asi las
    // flechas de los extremos se apagan/encienden solas y los indices de
    // los listeners vuelven a cuadrar.
    const mover = (destino) => {
      const [fila] = gymRoutineModalExercises.splice(index, 1);
      gymRoutineModalExercises.splice(destino, 0, fila);
      renderGymRoutineExercisesField();
    };
    if (!esPrimero) rowEl.querySelector('[data-field="subir"]').addEventListener('click', () => mover(index - 1));
    if (!esUltimo) rowEl.querySelector('[data-field="bajar"]').addEventListener('click', () => mover(index + 1));
    container.appendChild(rowEl);
  });
}

// Los tres campos del dia y de donde sale cada uno en la ficha del
// ejercicio. En una sola lista para no repetir el trio por todas
// partes.
const GYM_TARGET_FIELDS = [
  { enElDia: 'targetSets', porDefecto: 'defaultSets' },
  { enElDia: 'targetReps', porDefecto: 'defaultReps' },
  { enElDia: 'targetRestSeconds', porDefecto: 'defaultRestSeconds' },
];

// La configuracion por defecto de un ejercicio, lista para copiar en una
// fila del dia. Lo que no tenga valor se queda vacio, como antes.
function gymTargetsPorDefecto(exerciseId) {
  const ej = state.gymExercises.find((x) => x.id === Number(exerciseId));
  const fila = {};
  GYM_TARGET_FIELDS.forEach(({ enElDia, porDefecto }) => {
    fila[enElDia] = ej && ej[porDefecto] != null ? ej[porDefecto] : '';
  });
  return fila;
}

document.getElementById('btn-add-gym-routine-exercise').addEventListener('click', () => {
  if (state.gymExercises.length === 0) {
    showAppAlert('Primero crea al menos un ejercicio (pestaña Plan, lista de abajo).');
    return;
  }
  // Llega ya configurado con lo que suelas hacer con el (peticion de
  // Koku): series, reps y descanso salen de la ficha del ejercicio.
  const id = state.gymExercises[0].id;
  gymRoutineModalExercises.push({ exerciseId: id, ...gymTargetsPorDefecto(id), hidden: false });
  renderGymRoutineExercisesField();
});

// Selector de bloque del dia: createSelectField vive en este mismo
// archivo, asi que se puede construir ya al analizarlo (igual que el de
// rutina del modal de sesion, mas abajo). Las opciones se rellenan al
// abrir el modal, que es cuando state.gymBlocks ya esta cargado.
const gymRoutineBlockField = createSelectField({
  options: [],
  initialValue: '',
  placeholder: 'Elige un bloque',
});
document.getElementById('gym-routine-block-field').appendChild(gymRoutineBlockField.element);

// modo: 'ficha' (nombre, color, icono y bloque) o 'ejercicios' (solo lo
// que hay dentro del dia). Un dia NUEVO se abre siempre en 'ficha' --
// hasta que no tiene nombre no hay a que anadirle ejercicios.
// La linea de "al menos ~48 min" de la ficha de un dia. Se pinta con lo
// que hay guardado, no con el borrador que se este editando: hasta que
// no guardas, la duracion sigue siendo la del dia tal y como esta.
// En un dia NUEVO no hay nada que estimar.
function renderGymRoutineEstimate(routine) {
  const el = document.getElementById('gym-routine-estimate');
  const texto = routine ? gymTextoDeDuracion(routine) : null;
  el.textContent = texto || '';
  el.classList.toggle('hidden', !texto);
}

function openGymRoutineModal(routine, modo = 'ficha') {
  ensureGymRoutineFieldsReady();
  if (!routine) modo = 'ficha';
  const soloEjercicios = modo === 'ejercicios';
  document.getElementById('gym-routine-ficha').classList.toggle('hidden', soloEjercicios);
  document.getElementById('gym-routine-ejercicios').classList.toggle('hidden', !soloEjercicios);
  // OJO con el "required" del nombre: un campo obligatorio que esta
  // OCULTO no se puede enfocar, y el navegador se niega a enviar el
  // formulario entero con un "invalid form control is not focusable"
  // -- sin decir nada por pantalla. Como en el modo ejercicios el
  // nombre sigue relleno (se rellena igual mas abajo, solo que no se
  // ve) y se manda tal cual, aqui basta con quitarle el required
  // mientras esta escondido.
  document.getElementById('gym-routine-name').required = !soloEjercicios;
  document.getElementById('gym-routine-modal-title').textContent = routine
    ? (soloEjercicios ? `Ejercicios de ${routine.name}` : 'Editar día')
    : 'Nuevo día';
  document.getElementById('gym-routine-id').value = routine ? routine.id : '';
  document.getElementById('gym-routine-name').value = routine ? routine.name : '';
  gymRoutineColorField.setValue(routine ? routine.color : '#5b8cff');
  gymRoutineIconField.setValue(routine ? routine.icon || '' : '');
  // El selector de bloque se repuebla en cada apertura; por defecto, el
  // bloque cuyo listado esta abierto (o el del propio dia al editar).
  gymRoutineBlockField.setOptions(state.gymBlocks.map((b) => ({ value: String(b.id), label: b.name })));
  const defaultBlockId = routine ? routine.blockId : gymCurrentBlockId;
  gymRoutineBlockField.setValue(defaultBlockId ? String(defaultBlockId) : '');
  gymRoutineModalExercises = routine
    ? routine.exercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        targetSets: ex.targetSets ?? '',
        targetReps: ex.targetReps ?? '',
        targetRestSeconds: ex.targetRestSeconds ?? '',
        hidden: !!ex.hidden,
      }))
    : [];
  renderGymRoutineExercisesField();
  renderGymRoutineEstimate(routine);
  // "Eliminar el dia" solo desde su ficha: en la mitad de ejercicios
  // seria facil confundirlo con "quitar este ejercicio".
  document.getElementById('btn-delete-gym-routine').classList.toggle('hidden', !routine || soloEjercicios);
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
    blockId: gymRoutineBlockField.getValue() ? Number(gymRoutineBlockField.getValue()) : null,
    exercises: gymRoutineModalExercises,
  };
  if (id) {
    await api(`/api/gym-routines/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/gym-routines', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeGymRoutineModal();
  // Los bloques tambien se recargan: el contador de dias de la tarjeta
  // cambia si el dia es nuevo o se ha movido de bloque.
  await Promise.all([loadGymRoutines(), loadGymBlocks()]);
  renderGymRoutinesList();
  renderGymBlocksList();
});

document.getElementById('btn-delete-gym-routine').addEventListener('click', async () => {
  const id = document.getElementById('gym-routine-id').value;
  const ok = await showAppConfirm('¿Eliminar este día? Las sesiones ya registradas con él no se pierden.', { okText: 'Eliminar', danger: true });
  if (!ok) return;
  await api(`/api/gym-routines/${id}`, { method: 'DELETE' });
  closeGymRoutineModal();
  await Promise.all([loadGymRoutines(), loadGymBlocks(), loadGymSessions()]);
  renderGymRoutinesList();
  renderGymBlocksList();
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
  options: [{ value: '', label: 'Sesión libre (sin día)' }],
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
      // Los ejercicios OCULTOS del dia (el ojo tachado de la ficha) no
      // entran, igual que no entran al empezar un entreno en vivo
      // (startGymLiveSession). Este era el unico sitio que se los
      // colaba: Koku, apuntando una sesion a mano, "si tengo un
      // ejercicio en oculto en la rutina, me lo sigue poniendo, no
      // quiero que lo ponga". Si lo quieres esa vez, esta el
      // "+ Ejercicio" de aqui abajo.
      gymSessionModalExercises = routine.exercises.filter((ex) => !ex.hidden).map((ex) => {
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

// Que ejercicios del modal de historial estan RECOGIDOS, por indice.
// Peticion de Koku: "me gustaria que los ejercicios en historial tambien
// tuvieran lo de desplegar y recoger, seria mas comodo a la hora de
// modificar cosas". Se vacia al abrir el modal.
let gymSessionExercisesCollapsed = new Set();

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

    const recogido = gymSessionExercisesCollapsed.has(exIndex);
    block.classList.toggle('collapsed', recogido);

    const header = document.createElement('div');
    header.className = 'gym-routine-exercise-row';
    // El RPE es UNO por ejercicio (peticion de Koku), no por serie: vive
    // aqui en la cabecera. Ademas, sacandolo de las filas de serie estas
    // dejan de desbordarse en pantallas estrechas (el RPE se salia).
    header.innerHTML = `
      <button type="button" class="icon-btn gym-session-caret" data-plegar aria-label="${recogido ? 'Desplegar' : 'Recoger'} ejercicio" aria-expanded="${recogido ? 'false' : 'true'}">▾</button>
      <div class="gym-routine-exercise-picker"></div>
      <span class="gym-list-item-muted gym-session-set-count">${exRow.sets.length}</span>
      <input type="number" data-field="exRpe" placeholder="RPE" min="1" max="10" step="0.5" title="RPE del ejercicio" value="${exRow.rpe ?? ''}" />
      <button type="button" class="icon-btn" aria-label="Quitar ejercicio">✕</button>
    `;
    header.querySelector('[data-plegar]').addEventListener('click', () => {
      if (gymSessionExercisesCollapsed.has(exIndex)) gymSessionExercisesCollapsed.delete(exIndex);
      else gymSessionExercisesCollapsed.add(exIndex);
      renderGymSessionExercisesField();
    });
    // Mismo selector con buscador que en el dia del plan.
    const pickerSesion = createSelectField({
      options: gymExerciseSelectOptions(),
      initialValue: exRow.exerciseId != null ? String(exRow.exerciseId) : '',
      placeholder: 'Elige un ejercicio',
      searchable: true,
      onChange: (valor) => {
        const fila = gymSessionModalExercises[exIndex];
        const antesPorLados = gymExerciseUsesSides(fila);
        fila.exerciseId = Number(valor);
        const ahoraPorLados = gymExerciseUsesSides(fila);
        if (ahoraPorLados !== antesPorLados) {
          // Al pasar a un ejercicio POR LADOS, las series que estan en
          // blanco se parten en dos (izquierda y derecha), igual que las
          // crea el entreno en vivo. Sin esto te quedaba UNA serie sin
          // lado y dos botones sin marcar, y parecia que la app no
          // distinguia los lados -- que es justo como lo vio Koku: cuando
          // anades un ejercicio se elige el primero de la lista (normal) y
          // solo despues lo cambias al tuyo.
          //
          // SOLO las que estan en blanco. Si ya habias escrito peso o
          // repes, se quedan como estan y los botones de lado te dejan
          // arreglarlo a mano: cambiar de ejercicio no puede duplicarte ni
          // tocarte lo que ya habias apuntado.
          if (ahoraPorLados) {
            const partidas = [];
            fila.sets.forEach((s) => {
              const enBlanco = !String(s.reps ?? '').trim() && !String(s.weightDisplay ?? '').trim();
              if (enBlanco && !s.side) {
                partidas.push({ ...s, side: 'left', segments: [] });
                partidas.push({ ...s, side: 'right', segments: [] });
              } else {
                partidas.push(s);
              }
            });
            fila.sets = partidas;
          }
          renderGymSessionExercisesField();
        }
      },
    });
    header.querySelector('.gym-routine-exercise-picker').appendChild(pickerSesion.element);
    header.querySelector('[data-field="exRpe"]').addEventListener('input', (e) => {
      gymSessionModalExercises[exIndex].rpe = e.target.value;
    });
    header.querySelector('[aria-label="Quitar ejercicio"]').addEventListener('click', async () => {
      // Quitar un ejercicio aqui borra sus series apuntadas: confirmacion
      // (peticion de Koku, "seguro que quieres quitar...").
      const ok = await showAppConfirm('¿Quitar este ejercicio de la sesión, con sus series apuntadas?', { okText: 'Quitar', danger: true });
      if (!ok) return;
      gymSessionModalExercises.splice(exIndex, 1);
      // Los indices se corren al quitar uno: se olvida que estaba
      // recogido, si no el plegado se le quedaria al de al lado.
      gymSessionExercisesCollapsed = new Set();
      renderGymSessionExercisesField();
    });
    block.appendChild(header);

    const setsList = document.createElement('div');
    setsList.className = 'gym-session-sets-list';
    exRow.sets.forEach((set, setIndex) => {
      // Cada serie es un BLOQUE con el mismo formato que los tramos:
      // cabecera arriba y campos con su etiqueta encima. Antes era una
      // fila apretada con rotulos dentro de los campos y una ristra de
      // chips en el numero, y se rompia: Koku vio "Serie 1 2 min R-P"
      // partido en dos lineas y el "Drop" comiendose la casilla de las
      // repeticiones. Aqui cada cosa tiene su sitio y su nombre.
      const bloqueSerie = document.createElement('div');
      bloqueSerie.className = 'gym-exercise-edit-set';
      const unidad = getGymWeightUnitLabel();
      // En la cabecera solo lo que NO se ve ya en otro sitio: el lado, lo
      // que duro y el descanso extra. El "Drop"/"R-P" NO se repite -- se
      // ve entero en su editor, justo debajo (peticion de Koku: "si tengo
      // el menu para ver la dropset, no hace falta que me lo indiques en
      // la serie, ya lo veo").
      bloqueSerie.innerHTML = `
        <div class="gym-set-segment-head">
          <span class="gym-set-segment-tag">${gymSetSerieNumber(exRow, setIndex)}</span>
          <span class="gym-set-segment-name">Serie${set.side ? ` · lado ${gymSideLabel(set.side)}` : ''}</span>
          ${set.setType === 'failure' ? `<span class="gym-set-failure-chip" title="Serie llevada al fallo">Fallo</span>` : ''}
          <span class="gym-set-head-dur" title="Lo que duró la serie">${set.durationSeconds ? `Duración: ${gymFormatSetDuration(set.durationSeconds)}` : ''}</span>
          <button type="button" class="icon-btn" data-quitar-serie aria-label="Quitar serie">✕</button>
        </div>
        <div class="gym-set-segment-fields">
          <label class="gym-set-segment-field"><span>Peso (${escapeHtml(unidad)})</span><input type="text" inputmode="decimal" data-field="weight" value="${escapeHtml(String(set.weightDisplay ?? ''))}" /></label>
          <label class="gym-set-segment-field"><span>Reps</span><input type="number" data-field="reps" min="0" value="${escapeHtml(String(set.reps ?? ''))}" /></label>
          <!-- El "+60s" va PEGADO al descanso, no a la duracion: es
               descanso extra que se anadio con el boton +30s, y colgando
               de la duracion parecia que la serie habia durado mas
               (lo vio Koku). -->
          <label class="gym-set-segment-field"><span>Descanso (s)${set.extraRestSeconds ? ` <span class="gym-set-extra-chip" title="Añadido con +30s durante el entreno">+${set.extraRestSeconds}</span>` : ''}</span><input type="number" data-field="restSeconds" min="0" value="${escapeHtml(String(set.restSeconds ?? ''))}" /></label>
        </div>
        ${set.notes ? `<p class="gym-live-card-meta">${escapeHtml(set.notes)}</p>` : ''}
        <div class="gym-set-segments" data-seg-editor="${exIndex}-${setIndex}"></div>
        <div class="gym-set-extend-list gym-session-set-actions"></div>
      `;
      bloqueSerie.querySelector('[data-field="reps"]').addEventListener('input', (e) => { set.reps = e.target.value; });
      bloqueSerie.querySelector('[data-field="weight"]').addEventListener('input', (e) => { set.weightDisplay = gymNormalizarPeso(e.target.value); });
      bloqueSerie.querySelector('[data-field="restSeconds"]').addEventListener('input', (e) => { set.restSeconds = e.target.value; });
      bloqueSerie.querySelector('[data-quitar-serie]').addEventListener('click', () => {
        exRow.sets.splice(setIndex, 1);
        renderGymSessionExercisesField();
      });

      // Los tramos, EDITABLES tambien aqui (peticion de Koku: "a lo mejor
      // le he dado a acabar y se me ha olvidado darle a que he hecho
      // alguna o le he dado mal al peso"). Mismo editor que el del
      // entreno en vivo, montado sobre este contenedor.
      const editor = bloqueSerie.querySelector('[data-seg-editor]');
      const acciones = bloqueSerie.querySelector('.gym-session-set-actions');
      if (!Array.isArray(set.segments)) set.segments = [];
      const pintarTramos = () => montarEditorDeTramos(editor, set.segments, {
        pesoMadre: gymNormalizarPeso(bloqueSerie.querySelector('[data-field="weight"]').value) || '',
        alQuitar: () => pintarTramos(),
      });
      // El LADO, solo en los ejercicios que se cuentan por lados. Aqui
      // faltaba del todo: apuntando una sesion a mano no habia forma de
      // decir cual era el izquierdo y cual el derecho, asi que un
      // unilateral quedaba como cuatro series sueltas iguales. Toda la
      // logica ya existia para el entreno en vivo (gymExerciseUsesSides,
      // gymSetSerieNumber, gymBuildSetsForExercise): lo unico que faltaba
      // era usarla tambien aqui.
      //
      // Botones y no un <select>: la regla de la app es no usar controles
      // nativos, y ademas con dos opciones un desplegable es peor que dos
      // botones que ya se ven.
      const porLados = gymExerciseUsesSides(exRow);
      acciones.innerHTML = `
        ${porLados ? `
        <div class="gym-set-side-picker" role="group" aria-label="Lado de la serie">
          <button type="button" class="gym-set-extend-btn${set.side === 'left' ? ' is-on' : ''}" data-lado="left">Izquierdo</button>
          <button type="button" class="gym-set-extend-btn${set.side === 'right' ? ' is-on' : ''}" data-lado="right">Derecho</button>
        </div>` : ''}
        <button type="button" class="gym-set-extend-btn" data-add-seg="dropset">+ Dropset</button>
        <button type="button" class="gym-set-extend-btn" data-add-seg="restpause">+ Rest-pause</button>
        <button type="button" class="gym-set-extend-btn${set.setType === 'failure' ? ' is-on' : ''}" data-toggle-failure>${set.setType === 'failure' ? '✓ ' : ''}Al fallo</button>
      `;
      acciones.querySelectorAll('[data-lado]').forEach((btn) => {
        btn.addEventListener('click', () => {
          // Volver a pulsar el lado que ya esta puesto lo QUITA: asi se
          // puede deshacer sin tener que borrar la serie.
          set.side = set.side === btn.dataset.lado ? null : btn.dataset.lado;
          renderGymSessionExercisesField();
        });
      });
      acciones.querySelectorAll('[data-add-seg]').forEach((btn) => {
        btn.addEventListener('click', () => {
          set.segments.push({ kind: btn.dataset.addSeg, weightDisplay: '', reps: '', pauseSeconds: '' });
          pintarTramos();
        });
      });
      acciones.querySelector('[data-toggle-failure]').addEventListener('click', () => {
        set.setType = set.setType === 'failure' ? null : 'failure';
        renderGymSessionExercisesField();
      });
      pintarTramos();
      setsList.appendChild(bloqueSerie);
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
      const descanso = lastSet ? lastSet.restSeconds : '';
      const base = { reps: '', weightDisplay: '', restSeconds: descanso, extraRestSeconds: null, segments: [], setType: null };
      if (gymExerciseUsesSides(exRow)) {
        // Una serie de un ejercicio por lados son DOS filas, izquierda y
        // derecha, igual que las crea el entreno en vivo
        // (gymBuildSetsForExercise). Anadir una sola dejaria la serie
        // coja y el numero de series descuadrado.
        exRow.sets.push({ ...base, side: 'left', segments: [] });
        exRow.sets.push({ ...base, side: 'right', segments: [] });
      } else {
        exRow.sets.push({ ...base, side: null });
      }
      renderGymSessionExercisesField();
    });
    block.appendChild(addSetBtn);

    container.appendChild(block);
  });
}

document.getElementById('btn-add-gym-session-exercise').addEventListener('click', () => {
  if (state.gymExercises.length === 0) {
    showAppAlert('Primero crea al menos un ejercicio desde la pestaña Plan.');
    return;
  }
  const primero = state.gymExercises[0];
  const nuevo = { exerciseId: primero.id, rpe: '', sets: [] };
  // Mismo criterio que "+ Serie": si el ejercicio va por lados, la
  // primera serie ya nace con sus dos filas.
  const base = { reps: '', weightDisplay: '', restSeconds: '', segments: [], setType: null };
  if (gymExerciseUsesSides(nuevo)) {
    nuevo.sets.push({ ...base, side: 'left', segments: [] });
    nuevo.sets.push({ ...base, side: 'right', segments: [] });
  } else {
    nuevo.sets.push({ ...base, side: null });
  }
  gymSessionModalExercises.push(nuevo);
  renderGymSessionExercisesField();
});

function openGymSessionModal(session) {
  document.getElementById('gym-session-modal-title').textContent = session ? 'Editar sesion' : 'Nueva sesion';
  document.getElementById('gym-session-id').value = session ? session.id : '';
  gymSessionDateField.setValue(session ? new Date(`${session.date}T00:00:00`) : new Date());
  document.getElementById('gym-session-notes').value = session ? session.notes || '' : '';

  gymSessionRoutineField.setOptions([
    { value: '', label: 'Sesión libre (sin día)' },
    ...state.gymRoutines.map((r) => ({ value: String(r.id), label: r.name, color: r.color, icon: r.icon })),
  ]);
  gymSessionRoutineField.setValue(session && session.routineId ? String(session.routineId) : '');

  if (session) {
    // Reagrupa las series planas que devuelve el servidor (una fila por
    // serie) en un bloque por ejercicio, tal y como lo edita el modal.
    const byExercise = new Map();
    // El RPE por ejercicio: el primero no vacio de sus series (todas
    // llevan el mismo desde que el RPE es por ejercicio; las sesiones
    // antiguas con RPEs distintos ensenan el primero).
    const rpeByExercise = new Map();
    session.sets.forEach((set) => {
      if (!byExercise.has(set.exerciseId)) byExercise.set(set.exerciseId, []);
      if (set.rpe != null && !rpeByExercise.has(set.exerciseId)) rpeByExercise.set(set.exerciseId, set.rpe);
      byExercise.get(set.exerciseId).push({
        reps: set.reps ?? '',
        weightDisplay: gymWeightKgToDisplay(set.weightKg),
        restSeconds: set.restSeconds ?? '',
        extraRestSeconds: set.extraRestSeconds ?? null,
        // Se arrastran tal cual: editar una sesion a mano no debe borrar
        // lo que duraron sus series, su lado ni sus notas.
        durationSeconds: set.durationSeconds ?? null,
        side: set.side ?? null,
        notes: set.notes ?? null,
        // Los tramos de una serie alargada se arrastran tal cual (en kg,
        // como llegan): aqui solo se VEN, se editan en el entreno. Lo
        // importante es que editar una sesion a mano no los borre.
        // En unidades de PANTALLA, igual que weightDisplay de la serie:
        // el editor de tramos trabaja siempre asi y convierte al guardar.
        segments: (set.segments || []).map((seg) => ({
          kind: seg.kind,
          reps: seg.reps ?? '',
          weightDisplay: seg.weightKg != null ? gymWeightKgToDisplay(seg.weightKg) : '',
          pauseSeconds: seg.pauseSeconds ?? '',
        })),
        // Y lo mismo con el tipo de serie ('failure', 'warmup'...): antes
        // no viajaba y editar una sesion a mano lo borraba sin avisar.
        setType: set.setType ?? null,
      });
    });
    gymSessionModalExercises = [...byExercise.entries()].map(([exerciseId, sets]) => ({ exerciseId, sets, rpe: rpeByExercise.get(exerciseId) ?? '' }));
    gymSessionExercisesCollapsed = new Set();
  } else {
    gymSessionModalExercises = [];
  }
  renderGymSessionExercisesField();

  document.getElementById('btn-delete-gym-session').classList.toggle('hidden', !session);
  const modalSesion = document.getElementById('gym-session-modal');
  delete modalSesion.dataset.sucio;
  modalSesion.classList.remove('hidden');
}
function closeGymSessionModal() {
  document.getElementById('gym-session-modal').classList.add('hidden');
}
cerrarModalAlTocarFuera(
  'gym-session-modal',
  closeGymSessionModal,
  () => document.getElementById('gym-session-modal').dataset.sucio === '1',
);
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
  gymSessionModalExercises.forEach((exRow, exIndex) => {
    exRow.sets.forEach((set, setIndex) => {
      sets.push({
        exerciseId: exRow.exerciseId,
        reps: set.reps,
        weightKg: gymWeightDisplayToKg(set.weightDisplay),
        rpe: exRow.rpe,
        restSeconds: set.restSeconds,
        extraRestSeconds: set.extraRestSeconds ?? null,
        durationSeconds: set.durationSeconds ?? null,
        side: set.side ?? null,
        notes: set.notes ?? null,
        // Se leen del DOM y no del array: un tramo recien anadido puede
        // tener el peso en blanco confiando en la sugerencia gris, y esa
        // solo existe ahi (mismo criterio que en el entreno en vivo).
        segments: gymLeerTramosDe(
          document.querySelector(`#gym-session-exercises-field [data-seg-editor="${exIndex}-${setIndex}"]`),
        ).map((seg) => ({
          kind: seg.kind,
          reps: seg.reps,
          weightKg: gymWeightDisplayToKg(seg.weightDisplay),
          pauseSeconds: seg.pauseSeconds,
        })),
        setType: set.setType ?? null,
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
  checkGymAchievements();
});

document.getElementById('btn-delete-gym-session').addEventListener('click', async () => {
  const id = document.getElementById('gym-session-id').value;
  // Borrar una sesion SI pierde historial de verdad (sus series) -- de
  // ahi el confirm, a diferencia de plantillas como bloques/dias.
  const ok = await showAppConfirm('¿Eliminar esta sesión y todas sus series? Esto sí borra historial.', { okText: 'Eliminar', danger: true });
  if (!ok) return;
  await api(`/api/gym-sessions/${id}`, { method: 'DELETE' });
  closeGymSessionModal();
  await loadGymSessions();
  renderGymSessionsList();
  populateGymProgressExerciseSelect();
});

// --- Progreso avanzado (Fase 5 del rediseno) --------------------------
// Consistencia (heatmap estilo GitHub + racha semanal con objetivo),
// PRs por ejercicio (mejor peso + 1RM estimado con la formula de Epley)
// y volumen semanal apilado por grupo muscular. Todo calculado en
// cliente: el heatmap/racha desde GET /summary (ligero, sin series) y
// PRs/volumen desde state.gymSessions, que ya esta cargado entero.

// Lunes de la semana ISO de una fecha, como clave 'YYYY-MM-DD' -- las
// semanas del objetivo/racha/volumen empiezan en lunes (es-ES).
function gymWeekStartKey(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // lunes = 0 ... domingo = 6
  d.setDate(d.getDate() - day);
  return toDateKey(d);
}

// Objetivo de sesiones por semana: ajuste por dispositivo, como la
// unidad de peso (no viaja con los datos).
function getGymWeeklyGoal() {
  const stored = Number(localStorage.getItem('gymWeeklyGoal'));
  return stored >= 1 && stored <= 7 ? stored : 3;
}
const gymWeeklyGoalField = createSelectField({
  options: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? 'sesión' : 'sesiones'} / semana` })),
  initialValue: String(getGymWeeklyGoal()),
  onChange: (value) => {
    localStorage.setItem('gymWeeklyGoal', value);
    renderGymProgressSections();
  },
});
document.getElementById('gym-weekly-goal-field').appendChild(gymWeeklyGoalField.element);

// Cuanto pesa de mas una serie al fallo en el volumen. Ajuste por
// dispositivo, como la unidad de peso y el objetivo semanal: no viaja
// con los datos, y cambiarlo NO reescribe nada -- los kg guardados son
// los reales y esto solo cambia como se suman al pintar.
const gymFailureFactorField = createSelectField({
  options: GYM_FAILURE_FACTORS.map((n) => ({
    value: String(n),
    label: n === 1 ? 'No contar de más (×1)' : `×${String(n).replace('.', ',')}`,
  })),
  initialValue: String(getGymFailureFactor()),
  onChange: (value) => {
    localStorage.setItem('gymFailureFactor', value);
    renderGymProgressSections();
    renderGymSessionsList();
  },
});
document.getElementById('gym-failure-factor-field').appendChild(gymFailureFactorField.element);

// Punto de entrada de toda la seccion: se llama al entrar en la pestana
// Progreso (ver switchGymTab), no en cada apertura del Gimnasio.
async function renderGymProgressSections() {
  const summary = await api('/api/gym-sessions/summary');
  renderGymConsistency(summary);
  renderGymBodyMap();
  renderGymPRs();
  renderGymWeeklyVolume();
}

// La racha cuenta semanas SEGUIDAS cumpliendo el objetivo, empezando
// por la semana pasada hacia atras; la semana en curso suma solo si ya
// ha llegado al objetivo (que aun no lo haya hecho no rompe la racha).
// Compartida entre la tarjeta de Consistencia y los logros.
function gymComputeWeeklyStreak(sessionsByWeek, goal) {
  const now = new Date();
  let streak = (sessionsByWeek.get(gymWeekStartKey(now)) || 0) >= goal ? 1 : 0;
  const probe = new Date(now);
  probe.setDate(probe.getDate() - 7);
  while ((sessionsByWeek.get(gymWeekStartKey(probe)) || 0) >= goal) {
    streak += 1;
    probe.setDate(probe.getDate() - 7);
  }
  return streak;
}

// Heatmap de consistencia: 26 semanas x 7 dias, intensidad = sesiones de
// ese dia. UN solo tono (el morado del gym) de claro a oscuro -- un mapa
// de magnitud siempre es un unico matiz escalonado, nunca varios colores.
function renderGymConsistency(summary) {
  const sessionsByDate = new Map();
  for (const s of summary) {
    sessionsByDate.set(s.date, (sessionsByDate.get(s.date) || 0) + 1);
  }

  // Estadisticas de arriba: dias entrenados, racha de semanas cumpliendo
  // el objetivo, esta semana y este mes.
  const goal = getGymWeeklyGoal();
  const sessionsByWeek = new Map();
  for (const s of summary) {
    const week = gymWeekStartKey(new Date(`${s.date}T00:00:00`));
    sessionsByWeek.set(week, (sessionsByWeek.get(week) || 0) + 1);
  }
  const now = new Date();
  const thisWeekKey = gymWeekStartKey(now);
  const thisWeekCount = sessionsByWeek.get(thisWeekKey) || 0;
  const streak = gymComputeWeeklyStreak(sessionsByWeek, goal);
  const monthPrefix = toDateKey(now).slice(0, 7);
  const monthSessions = summary.filter((s) => s.date.startsWith(monthPrefix));
  const monthCount = monthSessions.length;
  // Tiempo REAL de trabajo del mes: suma de lo que duraron las series
  // (solo cuenta lo registrado con el boton de empezar/terminar serie,
  // asi que en sesiones apuntadas a mano sale 0 y no se ensena).
  const monthWork = monthSessions.reduce((acc, s) => acc + (s.workSeconds || 0), 0);
  // Series al fallo del mes: el "cuanto has apretado" al lado del
  // "cuanto has entrenado" (peticion de Koku). Solo sale si hay alguna,
  // para no ensenar un 0 permanente a quien no las marque.
  const monthFailureSets = monthSessions.reduce((acc, s) => acc + (s.failureSetCount || 0), 0);

  document.getElementById('gym-consistency-stats').innerHTML = `
    <div class="gym-live-summary-grid gym-consistency-grid">
      <div class="gym-live-summary-stat"><b>${sessionsByDate.size}</b><span>Días entrenados</span></div>
      <div class="gym-live-summary-stat"><b>${streak}</b><span>Racha (semanas)</span></div>
      <div class="gym-live-summary-stat"><b>${thisWeekCount}/${goal}</b><span>Esta semana</span></div>
      <div class="gym-live-summary-stat"><b>${monthCount}</b><span>Este mes</span></div>
      ${monthFailureSets > 0 ? `<div class="gym-live-summary-stat"><b>${monthFailureSets}</b><span>Series al fallo este mes</span></div>` : ''}
      ${monthWork > 0 ? `<div class="gym-live-summary-stat gym-stat-wide"><b>${gymFormatWorkTime(monthWork)}</b><span>Tiempo de trabajo este mes</span></div>` : ''}
    </div>
  `;

  // La rejilla: columnas = semanas (la actual a la derecha), filas =
  // lunes a domingo. Celdas div con tooltip, no SVG (mas simple y el
  // helper de tooltips funciona igual sobre cualquier elemento).
  const WEEKS = 26;
  const container = document.getElementById('gym-heatmap');
  const firstMonday = new Date(`${thisWeekKey}T00:00:00`);
  firstMonday.setDate(firstMonday.getDate() - (WEEKS - 1) * 7);
  let cells = '';
  for (let day = 0; day < 7; day++) {
    for (let week = 0; week < WEEKS; week++) {
      const cellDate = new Date(firstMonday);
      cellDate.setDate(cellDate.getDate() + week * 7 + day);
      if (cellDate > now) { cells += '<span class="gym-heatmap-cell future"></span>'; continue; }
      const key = toDateKey(cellDate);
      const count = sessionsByDate.get(key) || 0;
      const level = count >= 2 ? 2 : count; // 0 / 1 / 2+
      cells += `<span class="gym-heatmap-cell level-${level}" data-tooltip="${formatGymDate(key)}: ${count} sesión${count === 1 ? '' : 'es'}"></span>`;
    }
  }
  container.innerHTML = `
    <div class="gym-heatmap-grid" style="grid-template-columns: repeat(${WEEKS}, 1fr);">${cells}</div>
    <div class="gym-heatmap-legend"><span class="gym-list-item-muted">Menos</span>
      <span class="gym-heatmap-cell level-0"></span><span class="gym-heatmap-cell level-1"></span><span class="gym-heatmap-cell level-2"></span>
      <span class="gym-list-item-muted">Más</span></div>
  `;
  attachFinanzasChartTooltips(container);
}

// --- Mapa de musculos (Fase 6 del rediseno, idea propia de Koku) ------
// Dos siluetas dibujadas a medida (vista frontal y trasera) donde cada
// zona es un grupo de GYM_MUSCLE_GROUPS y se colorea segun cuanto se ha
// entrenado en la ventana elegida (7/30/90 dias), en series o volumen.
// Los musculos SECUNDARIOS del ejercicio (si vino de la libreria)
// puntuan a la mitad (x0.5) que el principal. El SVG se genera aqui
// mismo (no es un archivo aparte) para poder usar las variables CSS del
// tema en los rellenos; el dibujo es propio, sin assets de terceros.
let gymMapWindowDays = 30;
let gymMapMetric = 'series'; // 'series' | 'volume'
document.querySelectorAll('[data-gym-map-window]').forEach((btn) => {
  btn.addEventListener('click', () => {
    gymMapWindowDays = Number(btn.dataset.gymMapWindow);
    document.querySelectorAll('[data-gym-map-window]').forEach((b) => b.classList.toggle('active', b === btn));
    renderGymBodyMap();
  });
});
document.querySelectorAll('[data-gym-map-metric]').forEach((btn) => {
  btn.addEventListener('click', () => {
    gymMapMetric = btn.dataset.gymMapMetric;
    document.querySelectorAll('[data-gym-map-metric]').forEach((b) => b.classList.toggle('active', b === btn));
    renderGymBodyMap();
  });
});

// Las zonas del cuerpo (v2): poligonos anatomicos por musculo portados
// de react-body-highlighter (https://github.com/giavinh79/react-body-highlighter,
// licencia MIT -- ¡gracias!), mucho mejor dibujados que las elipses de la
// primera version. Cada entrada es un grupo de la taxonomia con sus
// poligonos y a que figura pertenece (tx = desplazamiento horizontal:
// 0 la frontal, 1120 la trasera). Los abductores no traen poligono en la
// fuente, asi que sus dos parches de cadera externa son dibujo propio.
const GYM_BODYMAP_ZONES = [
  // -- figura FRONTAL --
  { g: 'pecho', tx: 0, polys: ['518 416 510 551 580 580 678 555 706 473 620 416', '298 465 314 555 408 580 482 551 478 420 376 420'] },
  { g: 'core', tx: 0, polys: [
    '686 633 673 571 588 596 600 641 604 833 657 788 665 698',
    '339 784 331 718 310 633 322 571 408 592 392 633 392 837',
    '563 592 580 641 584 780 584 927 563 984 551 1041 514 1078 510 845 506 673 510 571',
    '437 588 486 571 490 673 486 845 482 1073 445 1037 408 914 408 784 412 645',
  ] },
  { g: 'biceps', tx: 0, polys: ['167 682 180 714 229 661 290 539 278 494 204 559', '714 494 702 547 763 661 816 718 829 690 788 555'] },
  { g: 'triceps', tx: 0, polys: ['694 555 694 616 759 727 776 702 755 673', '224 694 298 555 298 608 229 731'] },
  { g: 'trapecio', tx: 0, polys: [
    '555 237 506 335 506 392 616 400 706 449 694 367 633 351 584 306',
    '290 449 302 371 363 351 412 302 445 245 490 339 486 392 380 396',
  ] },
  { g: 'hombros', tx: 0, polys: [
    '784 531 796 478 792 412 759 380 710 363 722 429 714 473',
    '282 473 212 531 200 478 204 408 245 371 286 371 269 433',
  ] },
  // (la fuente etiqueta esta zona interna del muslo como "abductors",
  // pero anatomicamente es la de los ADUCTORES -- corregido aqui)
  { g: 'aductores', tx: 0, polys: [
    '527 1102 543 1249 600 1102 620 1000 649 943 600 927 567 1045',
    '478 1106 449 1253 420 1159 404 1131 396 1073 380 1024 347 939 396 922 416 992 437 1053',
  ] },
  { g: 'cuadriceps', tx: 0, polys: [
    '347 988 371 1082 371 1278 343 1371 310 1327 294 1200 282 1114 294 1008 322 947',
    '633 1057 645 1000 669 947 702 1012 710 1118 682 1331 653 1376 624 1286 620 1114',
    '388 1294 384 1122 412 1184 445 1294 429 1351 400 1461 363 1465 355 1400',
    '596 1457 555 1290 608 1139 612 1302 641 1396 629 1465',
    '327 1384 265 1457 257 1367 257 1273 269 1143 294 1335',
    '718 1131 739 1241 739 1404 727 1457 665 1384 702 1335',
  ] },
  { g: 'antebrazo', tx: 0, polys: [
    '61 886 102 751 147 702 163 743 192 735 45 976 0 1000',
    '845 698 833 735 800 731 951 984 1000 1004 935 894 898 763',
    '776 722 776 776 804 841 853 898 922 1012 947 996',
    '69 1012 135 906 188 841 216 771 212 718 49 988',
  ] },
  // -- figura TRASERA --
  { g: 'trapecio', tx: 1120, polys: [
    '447 217 477 217 472 383 477 647 383 532 353 409 311 366 391 332 438 272',
    '523 217 557 217 566 272 609 328 689 366 647 404 617 532 523 647 532 383',
  ] },
  // El hombro de la figura de ESPALDA es el deltoides posterior, asi que
  // es suyo y no de "hombros" (que se queda con la figura de frente).
  { g: 'hombro_posterior', tx: 1120, polys: ['294 370 230 391 174 443 183 536 243 494 272 464', '711 370 783 396 826 447 817 536 749 489 723 451'] },
  // La mancha de la espalda, partida en DOS franjas (media arriba,
  // dorsales abajo) con un corte horizontal a y=560. Los puntos del
  // corte salen de interpolar sobre los bordes del poligono original,
  // asi que las dos piezas encajan sin dejar hueco ni solaparse -- si se
  // tocan estos numeros a ojo, se nota. (Hubo un segundo corte a y=470
  // para una franja "espalda alta"; Koku la deshizo y su trozo volvio a
  // la media, que es esta.)
  { g: 'espalda_media', tx: 1120, polys: [
    '311 387 281 489 285 553 287 560 383 560 366 540 336 413',
    '689 387 719 494 715 560 621 560 634 545 664 417',
  ] },
  { g: 'dorsales', tx: 1120, polys: [
    '287 560 340 753 472 711 472 664 383 560',
    '715 560 660 753 528 711 528 664 621 560',
  ] },
  { g: 'triceps', tx: 1120, polys: [
    '268 498 179 557 145 723 166 817 217 638 268 557',
    '736 502 821 557 860 732 834 821 779 630 732 557',
    '268 583 268 685 230 753 191 774 226 655',
    '728 583 770 647 804 774 766 753 728 689',
  ] },
  { g: 'lumbar', tx: 1120, polys: ['477 728 345 770 353 834 494 1021 468 830', '523 728 655 770 647 834 506 1021 532 838'] },
  { g: 'antebrazo', tx: 1120, polys: [
    '864 757 911 834 932 940 1000 1064 962 1043 881 894 843 838',
    '136 757 89 838 68 936 0 1064 38 1043 123 885 157 830',
    '813 796 774 779 791 847 911 1038 932 1089 945 1047',
    '187 796 221 779 209 843 94 1030 68 1085 51 1047',
  ] },
  { g: 'abductores', tx: 1120, polys: ['330 1070 288 1130 282 1230 316 1290 356 1180', '670 1070 712 1130 718 1230 684 1290 644 1180'] },
  { g: 'gluteo', tx: 1120, polys: [
    '447 996 302 1085 298 1187 315 1260 472 1213 494 1149',
    '553 991 511 1145 523 1209 681 1260 698 1191 694 1085',
  ] },
  { g: 'aductores', tx: 1120, polys: [
    '481 1230 447 1230 413 1255 451 1443 485 1357 489 1294',
    '519 1226 557 1234 591 1260 549 1443 519 1362 511 1294',
  ] },
  { g: 'isquios', tx: 1120, polys: [
    '289 1221 311 1294 366 1260 353 1353 345 1502 294 1583 289 1468 277 1413 272 1315',
    '715 1217 694 1289 638 1260 655 1366 664 1502 711 1583 715 1477 728 1421 736 1319',
    '387 1255 443 1460 404 1668 362 1528 370 1353',
    '617 1255 634 1362 643 1532 600 1668 562 1464',
  ] },
  { g: 'gemelos', tx: 1120, polys: [
    '294 1604 285 1672 247 1796 238 1928 255 1970 285 1932 298 1800 319 1711 319 1668',
    '374 1651 353 1677 332 1719 311 1804 302 1919 340 2000 387 1906 391 1689',
    '630 1651 613 1685 617 1906 664 1996 706 1919 689 1796 668 1702',
    '706 1604 723 1685 757 1791 766 1928 745 1966 723 1936 706 1796 681 1681',
    '285 1957 302 1957 336 2017 306 2200 285 2136 268 1983',
    '698 1957 719 1957 736 1983 719 2132 702 2196 672 2021',
  ] },
];
// Partes no interactivas que completan la silueta (cabeza y rodillas de
// cada figura, del mismo dataset).
const GYM_BODYMAP_SILHOUETTE = [
  { tx: 0, polys: [
    '424 29 400 118 420 196 461 233 498 253 547 224 576 192 592 102 571 24 498 0',
    '339 1400 347 1433 355 1473 363 1510 351 1567 298 1567 273 1527 273 1473 302 1441',
    '657 1400 722 1478 722 1522 698 1571 649 1567 629 1510',
    '714 1604 735 1535 767 1612 796 1678 784 1878 796 1955 747 1955',
    '249 1947 278 1649 282 1604 261 1543 249 1576 224 1616 208 1678 220 1882 208 1955',
    '727 1951 698 1592 653 1584 641 1624 641 1653 657 1771',
    '355 1584 359 1624 359 1669 351 1722 351 1767 322 1820 306 1873 269 1947 273 1878 282 1804 286 1755 290 1698 298 1641 302 1588',
  ] },
  { tx: 1120, polys: [
    '506 0 460 9 409 55 404 128 451 200 557 200 591 136 596 47 557 13',
    '345 1532 311 1591 336 1664 374 1626',
    '664 1536 630 1630 668 1664 694 1591',
  ] },
];

function renderGymBodyMap() {
  const container = document.getElementById('gym-bodymap');
  const since = new Date();
  since.setDate(since.getDate() - gymMapWindowDays);
  const sinceKey = toDateKey(since);

  // Puntuacion por grupo: por cada serie de la ventana, 1 punto (o el
  // volumen de la serie) al grupo principal del ejercicio, y la mitad a
  // cada secundario. Tambien apuntamos los ejercicios con mas series de
  // cada grupo para el detalle.
  const score = new Map();
  const exercisesByGroup = new Map();
  const exerciseById = new Map(state.gymExercises.map((e) => [e.id, e]));
  for (const session of state.gymSessions) {
    if (session.date < sinceKey) continue;
    for (const set of session.sets) {
      const exercise = exerciseById.get(set.exerciseId);
      if (!exercise) continue;
      // En "volumen" cuentan todos los tramos; en "series" una serie
      // alargada sigue siendo UNA serie (decision de Koku).
      const amount = gymMapMetric === 'volume' ? gymSetVolumeKg(set) : 1;
      if (amount <= 0) continue;
      const primary = GYM_MUSCLE_GROUPS.some((g) => g.id === exercise.muscleGroup) ? exercise.muscleGroup : null;
      if (primary) {
        score.set(primary, (score.get(primary) || 0) + amount);
        if (!exercisesByGroup.has(primary)) exercisesByGroup.set(primary, new Map());
        const perEx = exercisesByGroup.get(primary);
        perEx.set(exercise.name, (perEx.get(exercise.name) || 0) + 1);
      }
      for (const secondary of exercise.secondaryMuscles || []) {
        if (secondary === primary) continue;
        score.set(secondary, (score.get(secondary) || 0) + amount * 0.5);
      }
    }
  }

  const max = Math.max(...score.values(), 0);
  const unit = getGymWeightUnitLabel();
  const detailByGroup = new Map();
  const zonesHtml = GYM_BODYMAP_ZONES.map((zone) => {
    const value = score.get(zone.g) || 0;
    // Intensidad continua sobre el acento del tema: de un 12% (entrenado
    // poco) al acento pleno; 0 = gris base de la silueta.
    const pct = max > 0 && value > 0 ? Math.round(12 + 78 * (value / max)) : 0;
    const fill = pct === 0
      ? 'color-mix(in srgb, var(--surface-2-text) 10%, var(--surface-2))'
      : `color-mix(in srgb, var(--gym-accent) ${pct}%, var(--surface-2))`;
    const label = gymMuscleGroupLabel(zone.g);
    const topExercises = exercisesByGroup.has(zone.g)
      ? [...exercisesByGroup.get(zone.g).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name).join(', ')
      : '';
    const valueLabel = gymMapMetric === 'volume'
      ? `${gymWeightKgToDisplay(value)} ${unit}`
      : `${Math.round(value * 10) / 10} serie${value === 1 ? '' : 's'}`;
    detailByGroup.set(zone.g, `${label}: ${valueLabel}${topExercises ? ` · ${topExercises}` : ''}`);
    const polys = zone.polys.map((points) => `<polygon points="${points}" />`).join('');
    return `<g style="fill: ${fill}" transform="translate(${zone.tx}, 0)" data-bodymap-group="${zone.g}">${polys}</g>`;
  }).join('');
  const silhouetteHtml = GYM_BODYMAP_SILHOUETTE.map((part) =>
    `<g class="gym-bodymap-silhouette" transform="translate(${part.tx}, 0)">${part.polys.map((points) => `<polygon points="${points}" />`).join('')}</g>`
  ).join('');

  container.innerHTML = `
    <svg class="gym-chart-svg gym-bodymap-svg" viewBox="0 0 2120 2210" role="img" aria-label="Mapa de músculos entrenados">
      ${silhouetteHtml}
      ${zonesHtml}
      <text class="gym-chart-label gym-bodymap-caption" x="500" y="2140" text-anchor="middle">Frente</text>
      <text class="gym-chart-label gym-bodymap-caption" x="1620" y="2140" text-anchor="middle">Espalda</text>
    </svg>
    <p id="gym-bodymap-info" class="gym-bodymap-info">Toca un músculo para ver su detalle.</p>
    <p class="hint">Cuanto más intenso el color, más entrenado en los últimos ${gymMapWindowDays} días (los músculos secundarios de cada ejercicio puntúan la mitad).</p>
  `;
  // El detalle se muestra en una linea FIJA bajo el mapa (nada de
  // tooltips flotantes: en el movil se quedaban pegados a la pantalla al
  // hacer scroll -- feedback de Koku).
  const info = document.getElementById('gym-bodymap-info');
  container.querySelectorAll('[data-bodymap-group]').forEach((zoneEl) => {
    const show = () => {
      const group = zoneEl.dataset.bodymapGroup;
      info.textContent = detailByGroup.get(group) || '';
      // El resaltado se aplica a TODAS las zonas del mismo grupo (un
      // musculo que sale en las dos vistas, como el triceps, se marca
      // en ambas a la vez -- feedback de Koku).
      container.querySelectorAll('[data-bodymap-group]').forEach((other) => {
        other.classList.toggle('bodymap-active', other.dataset.bodymapGroup === group);
      });
    };
    zoneEl.addEventListener('click', show);
    zoneEl.addEventListener('mouseenter', show);
  });
}


// 1RM estimado con la formula de Epley: peso x (1 + reps/30). Solo
// series con 1-12 repeticiones (por encima de 12 la estimacion deja de
// ser fiable) y sin las de calentamiento.
function gymEpley1RM(weightKg, reps) {
  return weightKg * (1 + reps / 30);
}
function renderGymPRs() {
  const list = document.getElementById('gym-prs-list');
  const byExercise = new Map(); // exerciseId -> { name, muscleGroup, bestWeightKg, best1RM, bestVolumeKg }
  for (const session of state.gymSessions) {
    const volumeByExercise = new Map();
    for (const set of session.sets) {
      if (set.setType === 'warmup') continue;
      // Serie madre Y tramos: Koku pidio expresamente que cualquiera
      // pueda ser record ("hay veces que la segunda sale mejor que la
      // primera, sobre todo cuando empiezas y mejoras la tecnica").
      for (const tramo of gymSetConTramos(set)) {
        if (!byExercise.has(tramo.exerciseId)) {
          byExercise.set(tramo.exerciseId, { name: tramo.exerciseName, bestWeightKg: 0, best1RM: 0, bestVolumeKg: 0 });
        }
        const pr = byExercise.get(tramo.exerciseId);
        if (tramo.weightKg > pr.bestWeightKg) pr.bestWeightKg = tramo.weightKg;
        if (tramo.weightKg > 0 && tramo.reps >= 1 && tramo.reps <= 12) {
          const est = gymEpley1RM(tramo.weightKg, tramo.reps);
          if (est > pr.best1RM) pr.best1RM = est;
        }
      }
      volumeByExercise.set(set.exerciseId, (volumeByExercise.get(set.exerciseId) || 0) + gymSetVolumeKg(set));
    }
    for (const [exerciseId, volume] of volumeByExercise) {
      const pr = byExercise.get(exerciseId);
      if (pr && volume > pr.bestVolumeKg) pr.bestVolumeKg = volume;
    }
  }

  const unit = getGymWeightUnitLabel();
  const rows = [...byExercise.entries()]
    .filter(([, pr]) => pr.bestWeightKg > 0)
    .sort((a, b) => b[1].best1RM - a[1].best1RM);
  list.innerHTML = '';
  if (rows.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavía no hay récords: registra series con peso y aparecerán aquí.</p>';
    return;
  }
  rows.forEach(([exerciseId, pr]) => {
    const exercise = state.gymExercises.find((e) => e.id === exerciseId);
    const muscle = exercise ? gymMuscleGroupLabel(exercise.muscleGroup) : '';
    const row = document.createElement('div');
    row.className = 'gym-list-item gym-pr-item';
    row.innerHTML = `
      <span class="gym-list-item-name">${escapeHtml(pr.name)}${muscle ? ` <span class="gym-list-item-muted">(${escapeHtml(muscle)})</span>` : ''}</span>
      <span class="gym-pr-stats">
        <b>${gymWeightKgToDisplay(pr.bestWeightKg)} ${unit}</b>
        <span class="gym-list-item-muted">1RM est. ${gymWeightKgToDisplay(pr.best1RM)} ${unit} · Vol. ${gymWeightKgToDisplay(pr.bestVolumeKg)} ${unit}</span>
      </span>
    `;
    list.appendChild(row);
  });
}

// Volumen semanal apilado por grupo muscular (ultimas 8 semanas). Los 5
// grupos con mas volumen total llevan color propio de la paleta de abajo
// y el resto se agrupa en "Otros" (gris) -- nunca 14 colores a la vez.
// Paleta validada con el comprobador de daltonismo/contraste del skill
// de dataviz (5 tonos, superficie oscura, todas las comprobaciones OK);
// el color acompaña SIEMPRE al mismo grupo dentro de un render.
const GYM_VIZ_PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
const GYM_VIZ_OTHER = '#8a8a93';
function renderGymWeeklyVolume() {
  const container = document.getElementById('gym-weekly-volume');
  const WEEKS = 8;
  const now = new Date();
  const weekKeys = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weekKeys.push(gymWeekStartKey(d));
  }
  const weekSet = new Set(weekKeys);

  // volumen[semana][grupo] desde las series (grupo del ejercicio; los
  // ejercicios viejos con texto libre o sin grupo caen en "Otros").
  const muscleOf = new Map(state.gymExercises.map((e) => [e.id, GYM_MUSCLE_GROUPS.some((g) => g.id === e.muscleGroup) ? e.muscleGroup : null]));
  const volume = new Map(weekKeys.map((w) => [w, new Map()]));
  const totalByGroup = new Map();
  for (const session of state.gymSessions) {
    const week = gymWeekStartKey(new Date(`${session.date}T00:00:00`));
    if (!weekSet.has(week)) continue;
    for (const set of session.sets) {
      const kg = gymSetVolumeKg(set);
      if (kg <= 0) continue;
      const group = muscleOf.get(set.exerciseId) || 'otros';
      volume.get(week).set(group, (volume.get(week).get(group) || 0) + kg);
      totalByGroup.set(group, (totalByGroup.get(group) || 0) + kg);
    }
  }

  if (totalByGroup.size === 0) {
    container.innerHTML = '<p class="empty-hint">Sin volumen registrado en las últimas 8 semanas.</p>';
    return;
  }

  // Top 5 grupos por volumen total; el resto (y lo sin grupo) = "Otros".
  const topGroups = [...totalByGroup.entries()]
    .filter(([g]) => g !== 'otros')
    .sort((a, b) => b[1] - a[1])
    .slice(0, GYM_VIZ_PALETTE.length)
    .map(([g]) => g);
  const colorOf = new Map(topGroups.map((g, i) => [g, GYM_VIZ_PALETTE[i]]));

  const width = 600, height = 190, padding = 26, gap = 8;
  const barWidth = (width - padding * 2 - gap * (WEEKS - 1)) / WEEKS;
  const maxWeek = Math.max(1, ...weekKeys.map((w) => [...volume.get(w).values()].reduce((a, b) => a + b, 0)));
  const unit = getGymWeightUnitLabel();

  let bars = '';
  weekKeys.forEach((week, i) => {
    const x = padding + i * (barWidth + gap);
    let y = height - padding;
    const groups = [...volume.get(week).entries()];
    // Otros al fondo de la pila, el resto en el orden fijo del top.
    const ordered = [
      ...topGroups.map((g) => [g, volume.get(week).get(g) || 0]),
      ['otros', groups.filter(([g]) => !colorOf.has(g)).reduce((acc, [, v]) => acc + v, 0)],
    ];
    for (const [group, kg] of ordered) {
      if (kg <= 0) continue;
      const h = (kg / maxWeek) * (height - padding * 2);
      y -= h;
      const label = group === 'otros' ? 'Otros' : gymMuscleGroupLabel(group);
      // Hueco de 2px entre segmentos: se pinta cada uno 2px mas corto.
      bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(0, h - 2)}" rx="2"
        fill="${colorOf.get(group) || GYM_VIZ_OTHER}"
        data-tooltip="Semana del ${formatGymDate(week)} · ${escapeHtml(label)}: ${gymWeightKgToDisplay(kg)} ${unit}"></rect>`;
    }
    const weekLabel = new Date(`${week}T00:00:00`).getDate();
    bars += `<text class="gym-chart-label" x="${x + barWidth / 2}" y="${height - padding + 12}" text-anchor="middle">${weekLabel}</text>`;
  });

  const legend = [...topGroups.map((g) => ({ label: gymMuscleGroupLabel(g), color: colorOf.get(g) })), { label: 'Otros', color: GYM_VIZ_OTHER }]
    .map((item) => `<span class="gym-viz-legend-item"><span class="color-dot" style="background-color: ${item.color}"></span>${escapeHtml(item.label)}</span>`)
    .join('');

  container.innerHTML = `
    <svg class="gym-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Volumen semanal por grupo muscular">${bars}</svg>
    <div class="gym-viz-legend">${legend}</div>
    <p class="hint">Volumen = repeticiones × peso, apilado por grupo muscular. La etiqueta de cada barra es el día del lunes de esa semana.</p>
  `;
  attachFinanzasChartTooltips(container);
}

// --- Logros (Fase 7 del rediseno) -------------------------------------
// Gamificacion sin estado en la base de datos: cada logro tiene NIVELES
// (umbral creciente) y se evalua al vuelo contra el historial real, asi
// que editar/borrar sesiones recalcula todo de forma coherente. Lo unico
// que se guarda (por dispositivo) es hasta que nivel se ha CELEBRADO ya
// cada logro, para no repetir la fiesta (localStorage.gymAchievementsSeen).
const GYM_ACHIEVEMENTS = [
  { id: 'sessions', name: 'Constancia', desc: 'Entrenamientos de pesas totales', levels: [1, 10, 25, 50, 100, 250], value: (s) => s.gymCount },
  { id: 'streak', name: 'Racha', desc: 'Semanas seguidas cumpliendo tu objetivo', levels: [1, 4, 8, 16, 26, 52], value: (s) => s.streak },
  { id: 'volume', name: 'Toneladas', desc: 'Volumen total acumulado (kg)', levels: [10000, 50000, 100000, 250000, 500000, 1000000], value: (s) => s.totalVolumeKg },
  { id: 'activities', name: 'Todoterreno', desc: 'Actividades fuera de las pesas', levels: [1, 10, 25, 50, 100], value: (s) => s.activityCount },
  { id: 'exercises', name: 'Repertorio', desc: 'Ejercicios distintos con series registradas', levels: [3, 10, 20, 40, 80], value: (s) => s.distinctExercises },
  { id: 'months', name: 'Meses activos', desc: 'Meses con al menos una sesión', levels: [1, 3, 6, 12, 24], value: (s) => s.activeMonths },
];

// Junta en un objeto todas las cifras que consumen los logros.
function gymComputeAchievementStats(summary) {
  const goal = getGymWeeklyGoal();
  const sessionsByWeek = new Map();
  const months = new Set();
  let gymCount = 0, activityCount = 0, totalVolumeKg = 0;
  for (const s of summary) {
    const week = gymWeekStartKey(new Date(`${s.date}T00:00:00`));
    sessionsByWeek.set(week, (sessionsByWeek.get(week) || 0) + 1);
    months.add(s.date.slice(0, 7));
    if (s.type === 'activity') activityCount += 1; else gymCount += 1;
    totalVolumeKg += gymVolumenAjustado(s.volumeKg, s.failureVolumeKg);
  }
  const distinct = new Set();
  for (const session of state.gymSessions) {
    for (const set of session.sets) distinct.add(set.exerciseId);
  }
  return {
    gymCount,
    activityCount,
    totalVolumeKg,
    streak: gymComputeWeeklyStreak(sessionsByWeek, goal),
    distinctExercises: distinct.size,
    activeMonths: months.size,
  };
}

// Nivel alcanzado (0 = ninguno) y HTML de la tarjeta de un logro.
function gymAchievementLevel(achievement, value) {
  let level = 0;
  for (const threshold of achievement.levels) {
    if (value >= threshold) level += 1; else break;
  }
  return level;
}
function gymAchievementCardHtml(achievement, value) {
  const level = gymAchievementLevel(achievement, value);
  const maxed = level >= achievement.levels.length;
  const nextThreshold = maxed ? achievement.levels[achievement.levels.length - 1] : achievement.levels[level];
  // La barra mide LO MISMO que el texto de debajo ("1 / 10" = 10%). Antes
  // media solo el tramo entre el nivel anterior y el siguiente, y al subir
  // de nivel la barra se quedaba a cero aunque el texto dijera 1/10 --
  // parecia rota (feedback de Koku).
  const progress = maxed ? 1 : Math.min(1, value / nextThreshold);
  const shownValue = Math.round(value * 10) / 10;
  return `
    <div class="gym-achievement-card ${level > 0 ? 'unlocked' : ''}">
      <div class="gym-achievement-head">
        <span class="gym-list-item-name">${escapeHtml(achievement.name)}
          ${level > 0 ? `<span class="gym-block-active-badge">Nivel ${level}${maxed ? ' · MAX' : ''}</span>` : ''}
        </span>
      </div>
      <span class="gym-list-item-muted">${escapeHtml(achievement.desc)}</span>
      <div class="gym-achievement-bar"><div class="gym-achievement-bar-fill" style="width: ${Math.round(progress * 100)}%"></div></div>
      <span class="gym-list-item-muted">${shownValue} / ${nextThreshold}${maxed ? ' (máximo alcanzado)' : ''}</span>
    </div>
  `;
}

async function renderGymAchievements() {
  const summary = await api('/api/gym-sessions/summary');
  const stats = gymComputeAchievementStats(summary);
  document.getElementById('gym-achievements-list').innerHTML =
    GYM_ACHIEVEMENTS.map((a) => gymAchievementCardHtml(a, a.value(stats))).join('');
}

// Tras guardar una sesion/actividad: si algun logro ha SUBIDO de nivel
// respecto a lo ya celebrado, se ensena la celebracion una unica vez.
function gymReadAchievementsSeen() {
  try {
    const parsed = JSON.parse(localStorage.getItem('gymAchievementsSeen'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
async function checkGymAchievements() {
  const summary = await api('/api/gym-sessions/summary');
  const stats = gymComputeAchievementStats(summary);
  const seen = gymReadAchievementsSeen();
  const leveledUp = [];
  for (const achievement of GYM_ACHIEVEMENTS) {
    const level = gymAchievementLevel(achievement, achievement.value(stats));
    if (level > (seen[achievement.id] || 0)) {
      leveledUp.push({ achievement, value: achievement.value(stats) });
      seen[achievement.id] = level;
    }
  }
  if (leveledUp.length === 0) return;
  localStorage.setItem('gymAchievementsSeen', JSON.stringify(seen));
  document.getElementById('gym-achievement-modal-list').innerHTML =
    leveledUp.map(({ achievement, value }) => gymAchievementCardHtml(achievement, value)).join('');
  document.getElementById('gym-achievement-modal').classList.remove('hidden');
}
document.getElementById('btn-close-gym-achievement').addEventListener('click', () => {
  document.getElementById('gym-achievement-modal').classList.add('hidden');
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
    // El volumen de la grafica cuenta el peso extra de las series al
    // fallo; el peso maximo no, que ese es el peso que de verdad movio.
    const raw = isVolume ? gymVolumenAjustado(p.volumeKg, p.failureVolumeKg) : p.maxWeightKg;
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
  // Dos circulos por punto: el que se VE (r=4) y uno transparente mucho
  // mas grande que es el que se toca -- con el dedo, 4px de radio es
  // imposible de acertar (por eso "no te deja pinchar el punto").
  const dots = coords
    .map((c, i) => {
      const texto = escapeHtml(`${formatGymDate(points[i].date)}: ${values[i]} ${unit}`);
      return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" fill="var(--accent)" data-tooltip="${texto}"></circle>`
        + `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="18" fill="transparent" data-tooltip="${texto}"></circle>`;
    })
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
    <p class="hint">${isVolume ? 'Volumen (repeticiones × peso)' : 'Peso máximo'} por sesión, en ${unit}${isVolume ? ' (suma de todas las series)' : ''}. Toca un punto para ver la fecha exacta.</p>
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
// Ojo: esto nacio para el raton (mouseenter/mousemove/mouseleave) y en
// el movil no habia forma de ver el dato -- Koku: "la grafica de volumen
// total no te deja pinchar el punto". Ahora escucha TAMBIEN pointerdown,
// que cubre dedo y raton por igual, y el aviso se va solo a los 2,5s o
// al tocar en otro sitio.
let gymChartTooltipTimer = null;
function attachFinanzasChartTooltips(svgEl) {
  if (!svgEl) return;
  const tooltip = getFinanzasChartTooltip();
  const mostrar = (el, x, y) => {
    tooltip.textContent = el.dataset.tooltip;
    tooltip.classList.remove('hidden');
    // Pegado al borde derecho se saldria de la pantalla: se cambia de
    // lado cuando no cabe.
    const ancho = tooltip.offsetWidth || 160;
    tooltip.style.left = `${x + 14 + ancho > window.innerWidth ? Math.max(8, x - 14 - ancho) : x + 14}px`;
    tooltip.style.top = `${y + 14}px`;
  };
  const esconder = () => tooltip.classList.add('hidden');
  svgEl.querySelectorAll('[data-tooltip]').forEach((el) => {
    el.addEventListener('mouseenter', (e) => mostrar(el, e.clientX, e.clientY));
    el.addEventListener('mousemove', (e) => mostrar(el, e.clientX, e.clientY));
    el.addEventListener('mouseleave', esconder);
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      mostrar(el, e.clientX, e.clientY);
      if (gymChartTooltipTimer) clearTimeout(gymChartTooltipTimer);
      gymChartTooltipTimer = setTimeout(esconder, 2500);
    });
  });
  // Tocar fuera lo quita al momento.
  svgEl.addEventListener('pointerdown', esconder);
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
  popover.duenoDelPopover = root;
  limpiarPopoversSueltos();
  document.body.appendChild(popover);
  marcarPopoverCuandoSeUse(popover, root);

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

// =====================================================================
// GESTOS DE NAVEGACION (solo movil)
//
// Idea general, pedida por Koku: moverse por la app deslizando el dedo,
// no solo tocando botones. Hay DOS gestos horizontales que compiten por
// el mismo dedo, asi que se reparten la pantalla en CARRILES:
//
//   |  lateral  |        centro         |  lateral  |
//   |  cambiar  |   gesto propio de     |  cambiar  |
//   | de PESTAÑA|   ESTA pantalla       | de PESTAÑA|
//
// - Carril LATERAL (los bordes izquierdo y derecho): cambia de pestaña
//   de la barra de abajo, de una en una y en el orden en que se ven:
//   Calendario -> Notas -> Herramientas -> Configuracion. Deslizar a la
//   izquierda avanza, a la derecha retrocede.
// - Carril CENTRAL: lo que tenga sentido DENTRO de la pantalla actual
//   (cambiar de dia en el calendario, subir de carpeta en Notas, volver
//   al menu de Configuracion, cambiar de pestaña dentro de Gimnasio...).
//   Si en esa pantalla el centro no tiene nada que hacer, NO pasa nada:
//   cambiar de pestaña es siempre cosa de los bordes, en cualquier
//   pantalla. Asi un mismo deslizamiento por el centro nunca significa
//   dos cosas distintas segun donde estes.
//
// Todo esto convive con los gestos que ya existian (deslizar vertical
// para cambiar de mes/año, pellizcar para subir de nivel, deslizar una
// fila de nota para sacar sus acciones): esos siguen igual, y este
// modulo se aparta solo cuando toca (ver NAV_SWIPE_OPT_OUT y el trato
// especial del mapa de Viajes).
// =====================================================================

// Orden de las pestañas, el MISMO que el de los botones de la barra de
// abajo (ver .mobile-nav en index.html). Si algun dia se reordena la
// barra, hay que reordenar esto a juego -- se deja como lista aparte y
// no se lee del DOM porque el hueco central es configurable (puede
// enseñar Notas u otra App) y el ORDEN de navegacion no debe depender
// de que icono tenga puesto ahora mismo.
const MOBILE_TAB_ORDER = ['calendar', 'notes', 'extensions', 'settings'];

// Ancho del carril lateral: 22% del ancho de la pantalla a cada lado,
// pero nunca menos de 56px (en un movil estrecho haria falta demasiada
// punteria) ni mas de 120px (en una tablet se comeria media pantalla).
function mobileEdgeRailWidth() {
  return Math.min(Math.max(window.innerWidth * 0.22, 56), 120);
}

function isMobileEdgeZone(x) {
  const carril = mobileEdgeRailWidth();
  return x <= carril || x >= window.innerWidth - carril;
}

// Los gestos de navegacion son cosa del movil: en escritorio el
// calendario y el panel conviven en pantalla y no hay barra de pestañas
// que recorrer. 860px es el mismo corte que usa styles.css.
function isMobileLayout() {
  return window.innerWidth < 860;
}

// Un modal abierto se lleva TODA la atencion: mientras haya uno, ningun
// gesto de navegacion. (Ojo: esto NO es isGestureBlockedByModal(), que
// ademas bloquea con cualquier pantalla completa abierta -- eso vale
// para los gestos del calendario, pero aqui hace falta justo lo
// contrario: que el gesto siga funcionando DENTRO de Gimnasio, Notas o
// Configuracion.)
// "¿Se ve de verdad este elemento?". No vale mirar solo la clase
// .hidden: hay trozos de la app (por ejemplo el dialogo de ayuda de
// Progreso del Gimnasio) que se quedan SIN esa clase aunque no se vean,
// porque quien los tapa es un padre suyo. Tampoco vale offsetParent a
// secas: un elemento con position:fixed -- como son casi todos los
// modales -- tiene offsetParent nulo aunque este perfectamente visible.
// getClientRects() sale bien de los dos casos: devuelve 0 rectangulos si
// el elemento (o cualquier padre) no se esta pintando, y al menos uno si
// se ve, fixed o no.
function estaVisibleDeVerdad(el) {
  return !!el && el.getClientRects().length > 0;
}

function isNavGestureBlocked() {
  // Ojo con el :not(#settings-modal): el panel de Configuracion usa la
  // clase .modal como todos los dialogos, pero NO es un dialogo suelto
  // -- es una de las cuatro pestañas de la barra de abajo, y tiene que
  // dejarse navegar con gestos como las otras tres (deslizar para
  // volver de una seccion a su menu, o para salirse a Herramientas).
  return [...document.querySelectorAll('.modal:not(.hidden):not(#settings-modal)')]
    .some(estaVisibleDeVerdad);
}

// Sitios donde arrastrar el dedo YA significa otra cosa, y donde este
// modulo se aparta del todo para no pisarlo.
const NAV_SWIPE_OPT_OUT = [
  '.note-swipe-wrap',   // fila de nota: desliza para Editar/Mover/Eliminar
  '#note-body table',   // tabla del editor: arrastrar es seleccionar celdas
  '#gym-live-view',     // entreno en vivo: salirse sin querer seria feo
  '[data-no-nav-swipe]', // escotilla generica para lo que venga despues
].join(', ');

// ---------------------------------------------------------------------
// Que App estaba abierta dentro de Herramientas.
//
// Peticion de Koku: si estaba en Gimnasio y me voy a Notas, al volver
// deslizando quiero entrar DIRECTO a Gimnasio, no al menu de
// Herramientas. Para cambiar de App, el boton de Herramientas de la
// barra de abajo (que siempre lleva al menu y borra este recuerdo).
//
// Es una variable normal en memoria a proposito, NO localStorage: al
// cerrar la app se olvida sola, que es justo lo que pidio ("que al
// cerrar la app se resetee eso para que no se quede abierta ninguna").
// ---------------------------------------------------------------------
let ultimaHerramientaAbierta = null;

const HERRAMIENTAS_APPS = {
  gym: { viewId: 'gym-view', open: () => openGymView() },
  finanzas: { viewId: 'finanzas-view', open: () => openFinanzasView() },
  lecturas: { viewId: 'lecturas-view', open: () => openLecturasView() },
  viajes: { viewId: 'viajes-view', open: () => openViajesView() },
};

// Cual de las Apps de Herramientas esta abierta AHORA mismo (mirando el
// DOM, que es la unica verdad: se puede haber abierto desde el menu,
// desde el hueco de la barra o desde un gesto).
function appDeHerramientasAbierta() {
  for (const [id, app] of Object.entries(HERRAMIENTAS_APPS)) {
    const el = document.getElementById(app.viewId);
    if (el && !el.classList.contains('hidden')) return id;
  }
  return null;
}

// La pestaña en la que estamos = la que la barra de abajo pinta como
// activa. Se usa el DOM en vez de una variable propia para que no haya
// dos "verdades" que se puedan desincronizar: los botones de la barra,
// los de cerrar de cada pantalla y estos gestos pasan todos por
// refreshMobileNavActive().
function currentMobileTab() {
  const activo = document.querySelector('.mobile-nav-btn.active');
  const tab = activo && activo.dataset.mobileNav;
  return MOBILE_TAB_ORDER.includes(tab) ? tab : 'calendar';
}

// Animacion del cambio de pestaña: se reutiliza la MISMA que ya hacia
// el calendario al cambiar de mes (playMobileSwipeTransition), aplicada
// a la pantalla que queda a la vista. Asi el movimiento de la app es
// uno solo y obedece al interruptor de Animaciones sin nada aparte.
// Las pantallas completas que pueden estar por encima del calendario,
// de la de mas arriba a la de mas abajo.
const CAPAS_DE_PANTALLA = [
  'settings-modal', 'gym-view', 'finanzas-view', 'lecturas-view',
  'viajes-view', 'extensions-view', 'mobile-notes-view', 'note-editor-view',
  'groups-view',
];

// Que pantalla se esta viendo AHORA MISMO. Se usa dos veces: para
// animar la que entra, y para saber -- antes de navegar -- cual es la
// que se va a ir.
function capaDePantallaVisible() {
  for (const id of CAPAS_DE_PANTALLA) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden')) return el;
  }
  // Ninguna pantalla completa abierta: se ve el calendario, que es
  // <main class="layout"> (NO #app: ahi dentro esta tambien la barra de
  // abajo, que no debe moverse).
  return document.querySelector('main.layout');
}

// capaSaliente: la pantalla que se estaba viendo ANTES de navegar. Con
// ella, las dos viajan a la vez como la tira de un carrusel; sin ella,
// solo entra la nueva (que es lo que toca cuando el cambio ocurre
// DENTRO de una misma pantalla, como volver de una seccion de
// Configuracion a su menu).
function animarCambioDePantalla(direccion, capaSaliente) {
  const entrante = capaDePantallaVisible();
  if (capaSaliente && capaSaliente !== entrante) {
    playMobileSwipeOut(capaSaliente, direccion);
  }
  if (entrante) {
    playMobileSwipeTransition(entrante, direccion);
    return;
  }
}

// Cambiar de pestaña un paso. paso = +1 (deslizar a la izquierda,
// avanzar) o -1 (deslizar a la derecha, retroceder).
function moverPestanaMovil(paso) {
  const actual = currentMobileTab();
  // Justo ANTES de irse de Herramientas se apunta que App quedaba
  // abierta, para poder volver directo a ella (ver la nota de
  // ultimaHerramientaAbierta). Se hace aqui, en el unico sitio por el
  // que pasan todos los cambios de pestaña por gesto, en vez de meter
  // una linea dentro de cada open*/close* de las cuatro Apps.
  if (actual === 'extensions') ultimaHerramientaAbierta = appDeHerramientasAbierta();
  // La pantalla que se va, apuntada ANTES de navegar: despues ya estara
  // oculta y no habria forma de saber cual era.
  const saliente = capaDePantallaVisible();
  const i = MOBILE_TAB_ORDER.indexOf(actual);
  const destino = MOBILE_TAB_ORDER[i + paso];
  // En los extremos (antes de Calendario, despues de Configuracion) no
  // se da la vuelta a proposito: dar la vuelta desorienta, y ademas
  // haria imposible saber por el gesto si estas al principio o al final.
  if (!destino) return false;

  // Herramientas con memoria: si habia una App abierta, se vuelve a
  // ella directamente (ver ultimaHerramientaAbierta arriba).
  if (destino === 'extensions' && ultimaHerramientaAbierta) {
    closeAllMobileOverlays();
    HERRAMIENTAS_APPS[ultimaHerramientaAbierta].open();
    refreshMobileNavActive('extensions');
  } else {
    goToMobileSection(destino);
  }
  animarCambioDePantalla(paso > 0 ? 'left' : 'right', saliente);
  return true;
}

// ---------------------------------------------------------------------
// Carril CENTRAL: el gesto propio de cada pantalla.
//
// Devuelve true si ha hecho algo; false si en esta pantalla el centro no
// tenia nada que hacer (y entonces quien llama deja que el gesto haga lo
// mismo que el lateral, cambiar de pestaña).
// ---------------------------------------------------------------------

// Barras de sub-pestañas de las Apps. Generico a proposito: se busca la
// primera barra VISIBLE y se mueve su boton activo un puesto. Una App
// nueva con su propia barra solo tiene que añadir aqui su pareja de
// selectores: la BARRA de botones y los PANELES que esos botones
// enseñan.
//
// Hacen falta los dos porque la animacion de carrusel se le pone al
// PANEL, no a la App entera: en un carrusel de verdad la barra de
// pestañas se queda quieta y lo que viaja es el contenido. Animar la
// vista completa haria que la propia barra se fuera de la pantalla, que
// es justo lo que no se quiere.
const MOBILE_SUBTAB_BARS = [
  { barra: '.gym-tabs', paneles: '.gym-tab-panel' },
  { barra: '.finanzas-tabs', paneles: '[data-finanzas-panel]' },
  { barra: '.viajes-tabs', paneles: '[data-viajes-panel]' },
];

function moverSubPestana(paso) {
  for (const { barra: selBarra, paneles: selPaneles } of MOBILE_SUBTAB_BARS) {
    const barra = document.querySelector(selBarra);
    if (!estaVisibleDeVerdad(barra)) continue;
    const botones = [...barra.querySelectorAll('button')];
    const i = botones.findIndex((b) => b.classList.contains('active'));
    if (i === -1) return false;
    const destino = botones[i + paso];
    if (!destino) return true; // hay barra, pero ya estas en el extremo
    // El panel que se va, apuntado ANTES del clic (que es quien lo
    // oculta): asi los dos viajan a la vez, igual que las pantallas.
    const saliente = [...document.querySelectorAll(selPaneles)].find(estaVisibleDeVerdad);
    destino.click();
    const panel = [...document.querySelectorAll(selPaneles)].find(estaVisibleDeVerdad);
    const direccion = paso > 0 ? 'left' : 'right';
    if (saliente && saliente !== panel) playMobileSwipeOut(saliente, direccion);
    if (panel) playMobileSwipeTransition(panel, direccion);
    return true;
  }
  return false;
}

// "Volver un paso" dentro de la pantalla actual. Cada entrada es un
// boton de volver que YA existe en la app: el gesto no duplica logica,
// solo pulsa el mismo boton (asi lo que hagan esos botones -- descartar
// el borrador de un tema, limpiar la busqueda de Notas... -- pasa igual
// deslizando que tocando). El orden importa: de la capa mas de dentro a
// la mas de fuera.
const VOLVER_UN_PASO = [
  // Configuracion: de una seccion (Perfil, Vista, Este dispositivo...)
  // al menu de Configuracion.
  'btn-settings-back',
  // Gimnasio: de los dias de un bloque a la lista de bloques.
  'btn-gym-back-to-blocks',
  // Lecturas: del detalle de una saga a la lista de sagas.
  'btn-back-lecturas-sagas',
  // Viajes: del detalle de un viaje a la lista de viajes.
  'btn-back-viajes-trips',
  // Grupos: del detalle de un grupo a la lista de grupos.
  'btn-groups-back',
  // Notas: subir un nivel de carpeta. Va el ULTIMO de la lista porque
  // es el mas "de fuera" de todos. Peticion expresa de Koku: deslizar
  // en Notas solo sirve para SALIR (subir), nunca para entrar -- entrar
  // exige elegir en que carpeta, y ademas deslizar sobre una carpeta ya
  // significa otra cosa (sacar Editar/Mover/Eliminar).
  'btn-mobile-notes-back',
];

function volverUnPasoDentroDeLaPantalla() {
  for (const id of VOLVER_UN_PASO) {
    const btn = document.getElementById(id);
    // Un boton de volver que no se ve = esa capa no esta abierta.
    if (btn && !btn.classList.contains('hidden') && estaVisibleDeVerdad(btn)) {
      // La animacion NO se lanza aqui: la lanza el propio boton (ver
      // justo debajo), asi sale igual lo pulses o lo deslices -- que es
      // lo que pidio Koku ("que el boton volver tambien haga esa
      // animacion").
      btn.click();
      return true;
    }
  }
  return false;
}

// Los botones de volver/cerrar animan igual que el gesto. Se registran
// aqui, todos juntos, en vez de uno a uno donde vive cada boton:
// - los de VOLVER_UN_PASO (subir una capa dentro de la pantalla),
// - los "← Home"/"← Herramientas" de las pantallas completas
//   (.my-space-close-btn) y el "← Calendario" de Grupos.
// El listener solo AÑADE la animacion; lo que hace el boton de verdad
// sigue en su propio sitio, sin tocar.
function animarAlPulsar(btn) {
  if (!btn) return;
  // Dos listeners para el mismo clic, y el orden importa:
  //  - en fase de CAPTURA (antes que nadie) se apunta que pantalla se
  //    esta viendo, porque el propio boton la va a ocultar;
  //  - en la fase normal, ya con la pantalla nueva puesta, se lanzan las
  //    dos animaciones (la que entra y la que se va).
  let saliente = null;
  btn.addEventListener('click', () => { saliente = capaDePantallaVisible(); }, true);
  btn.addEventListener('click', () => {
    // Si a este boton lo esta pulsando la app para hacer sitio (ver
    // closeAllMobileOverlays), la animacion la pone quien haya empezado
    // el cambio, no este boton.
    if (cerrandoEnCascada) return;
    animarCambioDePantalla('right', saliente);
  });
}

[...VOLVER_UN_PASO, 'btn-close-groups'].forEach((id) => animarAlPulsar(document.getElementById(id)));
document.querySelectorAll('.my-space-close-btn').forEach(animarAlPulsar);

// Pantallas donde el carril CENTRAL ya tiene dueño: alli el
// deslizamiento horizontal por el centro ya significa algo (la vista
// diaria del calendario cambia de dia con attachSwipe, ver mas arriba),
// asi que este modulo no se mete ni deja que el gesto caiga hacia el
// cambio de pestaña -- si no, un mismo deslizamiento haria las dos
// cosas a la vez. Los BORDES siguen cambiando de pestaña con
// normalidad, que es justo el reparto que pidio Koku ("si deslizo en el
// centro cambio de dia, si deslizo en el lateral a la pestaña de al
// lado").
const CENTRO_CON_DUENO = ['mobile-calendar-day-view'];

function centroYaTieneDueno() {
  return CENTRO_CON_DUENO.some((id) => estaVisibleDeVerdad(document.getElementById(id)));
}

// El gesto central, segun el sentido.
function gestoCentral(paso) {
  // Pantallas que ya usan el centro para lo suyo (la vista diaria): ahi
  // este modulo no se mete.
  if (centroYaTieneDueno()) return;
  // Hacia la derecha (paso -1): primero intentar salir de una capa.
  if (paso < 0 && volverUnPasoDentroDeLaPantalla()) return;
  // Dentro de una App con sub-pestañas, el centro las recorre.
  moverSubPestana(paso);
}

// ---------------------------------------------------------------------
// El detector en si. Va en el <body> en fase de captura para enterarse
// del gesto ANTES que nadie, pero sin cancelar nada: solo mira. Los
// gestos que ya existian (deslizar la vista diaria, mover el mapa)
// siguen recibiendo sus eventos igual.
// ---------------------------------------------------------------------

const NAV_SWIPE_UMBRAL = 60;      // px minimos de recorrido horizontal
const NAV_SWIPE_MAX_VERTICAL = 0.8; // el gesto tiene que ser mas ancho que alto

// El mapa de Viajes es el unico sitio con un trato aparte, y lo pidio
// Koku tal cual: alli arrastrar YA sirve para mover el mapa, asi que la
// diferencia la marca la VELOCIDAD -- un arrastre lento y pausado es
// mover el mapa (y este modulo no se mete), uno rapido y decidido es
// navegar. 0.55 px/ms es aproximadamente "media pantalla en un tercio de
// segundo": un arrastre normal de mapa no llega ahi ni queriendo.
const NAV_SWIPE_VELOCIDAD_MAPA = 0.55;

let navSwipe = null;

// El boton de Herramientas de la barra de abajo SIEMPRE lleva al menu
// y borra el recuerdo: es justo el gesto de "quiero cambiar de App" que
// describio Koku. (El listener que de verdad abre la vista ya esta
// registrado mas arriba, sobre .mobile-nav-btn; este solo se suma.)
document.querySelectorAll('.mobile-nav-btn[data-mobile-nav="extensions"]').forEach((btn) => {
  btn.addEventListener('click', () => { ultimaHerramientaAbierta = null; });
});

document.addEventListener('pointerdown', (e) => {
  navSwipe = null;
  if (!isMobileLayout() || isNavGestureBlocked()) return;
  if (e.target.closest && e.target.closest(NAV_SWIPE_OPT_OUT)) return;
  navSwipe = {
    x: e.clientX,
    y: e.clientY,
    t: e.timeStamp,
    // Si el gesto empieza dentro del mapa, se le exige velocidad.
    enMapa: !!(e.target.closest && e.target.closest('#viajes-map-container')),
  };
}, true);

document.addEventListener('pointerup', (e) => {
  const inicio = navSwipe;
  navSwipe = null;
  if (!inicio || !isMobileLayout() || isNavGestureBlocked()) return;

  const dx = e.clientX - inicio.x;
  const dy = e.clientY - inicio.y;
  if (Math.abs(dx) < NAV_SWIPE_UMBRAL) return;
  if (Math.abs(dy) > Math.abs(dx) * NAV_SWIPE_MAX_VERTICAL) return;

  if (inicio.enMapa) {
    const ms = Math.max(e.timeStamp - inicio.t, 1);
    if (Math.abs(dx) / ms < NAV_SWIPE_VELOCIDAD_MAPA) return; // arrastre de mapa
  }

  // paso: -1 = deslizar a la DERECHA (atras), +1 = a la IZQUIERDA
  // (adelante). El dedo va hacia la derecha => dx positivo => atras.
  const paso = dx > 0 ? -1 : 1;

  // El carril se decide por DONDE EMPEZO el dedo, no por donde acaba:
  // si se mirara el final, un gesto que arranca en el centro y termina
  // cerca del borde cambiaria de significado a mitad de camino.
  if (isMobileEdgeZone(inicio.x)) {
    moverPestanaMovil(paso);
    return;
  }
  // Centro: SOLO lo propio de la pantalla. Si ahi no hay nada que hacer,
  // no pasa nada -- cambiar de pestaña es siempre cosa de los bordes.
  //
  // Antes el centro "caia" al cambio de pestaña cuando no tenia nada que
  // hacer, para que ningun gesto se sintiera ignorado. Koku pidio
  // quitarlo: "que el movimiento entre vistas, da igual que tenga o no
  // movimiento intra-app, que sea por los laterales, como en calendario
  // diario o gimnasio". Y es mejor asi: con la regla vieja, el mismo
  // deslizamiento por el centro hacia una cosa u otra segun la pantalla
  // en la que estuvieras, que es justo lo que confunde.
  gestoCentral(paso);
}, true);

applyUiStyle();
applyAnimationsPreference();

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
// --- Cerrar un modal tocando FUERA de su tarjeta -----------------------
// Peticion de Koku: "si pincho fuera de las areas de historial o de
// editar ejercicio, que se cierre; a veces buscar la x o el cancelar
// cuesta". Solo en ESOS DOS: son los unicos donde cerrar equivale a
// cancelar, porque los dos trabajan sobre un borrador y no tocan nada
// hasta que le das a Guardar. En el dialogo de fin de serie, por
// ejemplo, seria un desastre -- ahi un toque fuera perderia los datos de
// la serie recien hecha.
//
// Con cambios a medio escribir se pregunta antes: un roce en el fondo no
// puede tirar cinco minutos de edicion.
function cerrarModalAlTocarFuera(modalId, cerrar, hayCambios) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  // Marcar "sucio": escribir en cualquier campo, o pulsar cualquier
  // boton del modal que no sea el de cerrar/cancelar (anadir una serie,
  // marcar al fallo, anadir un tramo...). El scroll no genera clicks
  // sobre botones, asi que no cuenta.
  modal.addEventListener('input', () => { modal.dataset.sucio = '1'; });
  modal.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && !btn.matches('[id^="btn-cancel"], [id^="btn-close"], [aria-label="Cerrar"]')) {
      modal.dataset.sucio = '1';
    }
  });
  modal.addEventListener('click', async (e) => {
    // Solo el FONDO: un click dentro de la tarjeta llega aqui por
    // burbujeo, pero con e.target apuntando a lo de dentro.
    if (e.target !== modal) return;
    // Si ya estamos preguntando, un segundo toque en el fondo NO abre otra
    // pregunta encima (se quedarian dos apiladas y la de abajo colgada).
    if (modal.dataset.preguntando === '1') return;
    if (hayCambios && hayCambios()) {
      modal.dataset.preguntando = '1';
      let ok = false;
      try {
        ok = await showAppConfirm('Vas a cerrar sin guardar los cambios. ¿Seguro?', { okText: 'Cerrar sin guardar', danger: true });
      } finally {
        delete modal.dataset.preguntando;
      }
      if (!ok) return;
      // Mientras se preguntaba, el modal puede haberse cerrado por otra via
      // (guardar, Esc...). Si ya no esta, no hay nada que cerrar.
      if (modal.classList.contains('hidden')) return;
    }
    delete modal.dataset.sucio;
    cerrar();
  });
}

// --- Version de la app ------------------------------------------------
// Se escribe A MANO en cada ronda, junto al numero de package.json: la
// app no tiene paso de compilacion que pueda inyectarlo, asi que este es
// el unico sitio donde vive de cara al usuario. La fecha es la de la
// subida (cuando se lanza la build), en formato ISO para poder darle el
// formato del SISTEMA al pintarla -- Koku: "respetando el formato del
// sistema por si tienen mm/dd/aa y no dd/mm/aa".
const APP_VERSION = '0.46.0';
const APP_VERSION_DATE = '2026-09-10';

function renderAppVersionLine() {
  const el = document.getElementById('app-version-line');
  if (!el) return;
  let fecha = APP_VERSION_DATE;
  try {
    // `undefined` a proposito: el idioma del DISPOSITIVO, no el de la
    // app (mismo criterio que systemUses12hClock).
    fecha = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
      .format(new Date(`${APP_VERSION_DATE}T12:00:00`));
  } catch { /* si Intl falla, se queda la ISO */ }
  el.textContent = `v${APP_VERSION} · ${fecha}`;
}
renderAppVersionLine();

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

  // EL WIDGET SE ALIMENTA AL ARRANCAR, aunque no entres al Gimnasio.
  //
  // Esto faltaba y era un agujero de verdad: el resumen se rehacia desde
  // loadGymBlocks()/loadGymRoutines(), y esas SOLO se llaman al abrir el
  // Gimnasio (carga perezosa). O sea que alguien que abriera la app y se
  // quedara en el calendario no le mandaba nada al widget nunca, y el
  // widget se quedaba en "Abre la app" -- que es justo lo que le pasaba a
  // Koku. Son dos consultas a una base que ya esta en memoria: barato.
  await initStep(async () => {
    await Promise.all([loadGymBlocks(), loadGymRoutines()]);
  });

  // Abrir la app TOCANDO EL WIDGET, con la app cerrada del todo: ni
  // 'resume' ni 'visibilitychange' llegan a dispararse en ese caso (la
  // app nace ya en primer plano), asi que la marca hay que mirarla
  // tambien aqui. Va al final del arranque a proposito: si arranca un
  // entreno, que sea con el calendario ya montado detras.
  await initStep(comprobarAperturaDesdeElWidget);

  // Y una segunda pasada un momento despues, por los BOTONES DEL CENTRO
  // DE CONTROL. Esos no abren la app con una URL sin mas: ejecutan un
  // AppIntent nuestro (ver ios/App/App/AbrirDesdeControl.swift), y ese
  // intent corre en el proceso de la app SIN un orden garantizado
  // respecto a este arranque -- puede dejar la marca justo despues de que
  // la miremos aqui. Si eso pasa y la app ya esta en primer plano, no
  // llega ningun 'resume' ni 'visibilitychange' que la recoja, y el boton
  // pareceria no hacer nada.
  //
  // Dos relecturas separadas y no un bucle: la marca se consume EN
  // NATIVO, asi que una lectura sin marca no hace absolutamente nada y
  // dos toques al mismo destino son imposibles.
  setTimeout(comprobarAperturaDesdeElWidget, 600);
  setTimeout(comprobarAperturaDesdeElWidget, 2000);
  // Y el aviso del nativo para el caso que NO cubre nada de lo de
  // arriba: tocar un boton del centro de control con la app ya delante.
  // Ahi no hay ni 'resume' ni 'visibilitychange' que valgan -- ver
  // escucharAvisosDelWidget() en widget-bridge.js.
  if (typeof escucharAvisosDelWidget === 'function') {
    escucharAvisosDelWidget(comprobarAperturaDesdeElWidget);
  }

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
