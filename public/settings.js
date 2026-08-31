// settings.js — todo lo relacionado con el panel de Configuracion:
// temas de estilo, grupos y dispositivos (estos dos ultimos vivian antes
// en app.js, se han movido aqui al juntarlos en un solo panel). Se carga
// como un <script> normal despues de app.js, y comparte con el su mismo
// ambito global: usa cosas ya definidas alli como `api()`, `escapeHtml()`,
// `state`, `loadMonth()`, `loadReminders()`, `loadGroups()` y
// `populateEventGroupSelect()`.

// ---------------------------------------------------------------------
// Posicionamiento compartido de popovers "flotantes": los usan el
// selector de color, el de icono, el de fecha y el select a medida. Van
// colgados de <body> con position:fixed (no dentro de la tarjeta del
// modal) para que el "overflow-y: auto" del modal no los recorte cuando
// estan cerca del borde o hay que hacer scroll; su sitio se calcula
// aqui, en coordenadas de ventana, a partir de donde este el boton que
// los abre.
//
// La altura para decidir si cae por debajo o por encima del boton se
// MIDE de verdad (popover.offsetHeight) en vez de adivinarse a mano: los
// que llaman a esto quitan la clase "hidden" justo ANTES de llamarnos
// (ver los click handlers de abajo), asi que el popover ya esta visible
// y renderizado en el DOM en este punto — offsetHeight es su alto real,
// ya recortado por su propio max-height/overflow-y si hiciera falta.
// Antes se pasaba un "estimatedHeight" a mano por cada tipo de popover,
// y si el contenido crecia (como el selector de icono, con las
// secciones de simbolos Y emoji) se quedaba desincronizado: la altura
// real ya no coincidia con la estimada, y el popover se colocaba mal,
// pudiendo salirse por debajo de la pantalla sin forma de hacer scroll
// hasta el (justo el bug que reporto Koku al anadir un icono a una
// carpeta). Medir de verdad evita que esto se repita aunque el
// contenido de un popover cambie en el futuro.
function positionFixedPopover(anchorBtn, popover, { width = 248 } = {}) {
  const rect = anchorBtn.getBoundingClientRect();
  let left = rect.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  popover.style.left = `${Math.max(8, left)}px`;

  const actualHeight = popover.offsetHeight;
  const top = rect.bottom + 6 + actualHeight > window.innerHeight
    ? Math.max(8, rect.top - actualHeight - 6)
    : rect.bottom + 6;
  popover.style.top = `${top}px`;
}

function closeAllPopovers(except) {
  document.querySelectorAll('.color-popover, .icon-popover, .select-popover, .date-popover, .table-insert-popover').forEach((el) => {
    if (el !== except) el.classList.add('hidden');
  });
}

// Cierra cualquier popover abierto al hacer click fuera de el (uno solo
// para color, icono, selector, fecha e insertar-tabla, asi no hay que
// repetir esta logica en cada widget).
document.addEventListener('click', (e) => {
  if (e.target.closest('.color-popover, .icon-popover, .select-popover, .date-popover, .table-insert-popover, .color-swatch-btn, .icon-swatch-btn, .select-field-trigger, .date-field-trigger, #note-table-insert-btn')) return;
  closeAllPopovers();
});

// ---------------------------------------------------------------------
// Selector de color: boton + popover con un color a medida ("Otros") y
// paletas predefinidas en forma de tabla, agrupadas por estilo.
// ---------------------------------------------------------------------
const COLOR_PALETTES = {
  Pastel: ['#FFADAD', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF'],
  Vivos: ['#E63946', '#F3722C', '#F9C74F', '#90BE6D', '#43AA8B', '#4D96FF', '#5B8CFF', '#9B5DE5'],
  Claros: ['#FFFFFF', '#F8F9FA', '#F1F3F5', '#E9ECEF', '#FFF0F0', '#F0F7FF', '#F5F0FF', '#FFFDF0'],
  Oscuros: ['#0F1115', '#1A1D23', '#22262E', '#2B2F38', '#3A1F1F', '#1F2A3A', '#241F3A', '#101820'],
};

function createColorField({ initialValue, onChange }) {
  let value = initialValue || '#5b8cff';

  const root = document.createElement('div');
  root.className = 'color-field';

  const swatchBtn = document.createElement('button');
  swatchBtn.type = 'button';
  swatchBtn.className = 'color-swatch-btn';

  const popover = document.createElement('div');
  popover.className = 'color-popover hidden';
  document.body.appendChild(popover);

  const nativeInput = document.createElement('input');
  nativeInput.type = 'color';
  nativeInput.className = 'color-native-input';

  function applyValue(newValue, { close } = {}) {
    value = newValue;
    swatchBtn.style.backgroundColor = value;
    nativeInput.value = value;
    if (close) popover.classList.add('hidden');
    if (onChange) onChange(value);
  }

  nativeInput.addEventListener('input', () => applyValue(nativeInput.value));

  // "Otros": el color a medida, con el mismo formato de seccion que las
  // paletas predefinidas de abajo, para que se vea como una mas.
  const customSection = document.createElement('div');
  customSection.className = 'palette-section';
  const customHeading = document.createElement('div');
  customHeading.className = 'palette-section-heading';
  customHeading.textContent = 'Otros';
  customSection.appendChild(customHeading);
  customSection.appendChild(nativeInput);
  popover.appendChild(customSection);

  Object.entries(COLOR_PALETTES).forEach(([sectionName, colors]) => {
    const section = document.createElement('div');
    section.className = 'palette-section';
    const heading = document.createElement('div');
    heading.className = 'palette-section-heading';
    heading.textContent = sectionName;
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'palette-grid';
    colors.forEach((hex) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'palette-swatch';
      swatch.style.backgroundColor = hex;
      swatch.title = hex;
      swatch.addEventListener('click', () => applyValue(hex, { close: true }));
      grid.appendChild(swatch);
    });
    section.appendChild(grid);
    popover.appendChild(section);
  });

  swatchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = popover.classList.contains('hidden');
    closeAllPopovers(popover);
    popover.classList.toggle('hidden');
    if (willOpen) positionFixedPopover(swatchBtn, popover);
  });

  root.appendChild(swatchBtn);
  applyValue(value);

  return {
    element: root,
    getValue: () => value,
    setValue: (v) => applyValue(v),
  };
}

// ---------------------------------------------------------------------
// Selector de icono: simbolo o emoji para acompañar (NO sustituir) al
// nombre de un grupo o de un dispositivo. Ofrece una tabla de simbolos,
// otra de emoji, y un campo para escribir/pegar cualquier otro que no
// este en la lista.
// ---------------------------------------------------------------------
const ICON_SYMBOLS = ['★', '☆', '●', '○', '◆', '▲', '▼', '■', '✦', '✓', '✗', '♥', '♦', '♣', '♠', '⚑', '☀', '☾', '❄', '⚡', '♫', '∞', '⚙', '✈'];
const ICON_EMOJIS = ['😀', '😎', '🥳', '😴', '🏋️', '🏃', '🚗', '🏠', '💼', '📚', '🎮', '🎵', '🍕', '☕', '🌱', '🐶', '🐱', '✈️', '🎯', '💡', '🔔', '❤️', '🎉', '🛒'];

function createIconField({ initialValue, onChange }) {
  let value = initialValue || '';

  const root = document.createElement('div');
  root.className = 'icon-field';

  const swatchBtn = document.createElement('button');
  swatchBtn.type = 'button';
  swatchBtn.className = 'icon-swatch-btn';
  swatchBtn.title = 'Icono (opcional)';

  const popover = document.createElement('div');
  popover.className = 'icon-popover hidden';
  document.body.appendChild(popover);

  function applyValue(newValue, { close } = {}) {
    value = newValue || '';
    swatchBtn.textContent = value || '+';
    if (close) popover.classList.add('hidden');
    if (onChange) onChange(value);
  }

  function addIconSection(title, glyphs) {
    const section = document.createElement('div');
    section.className = 'palette-section';
    const heading = document.createElement('div');
    heading.className = 'palette-section-heading';
    heading.textContent = title;
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    glyphs.forEach((glyph) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-grid-btn';
      btn.textContent = glyph;
      btn.addEventListener('click', () => applyValue(glyph, { close: true }));
      grid.appendChild(btn);
    });
    section.appendChild(grid);
    popover.appendChild(section);
  }

  addIconSection('Símbolos', ICON_SYMBOLS);
  addIconSection('Emoji', ICON_EMOJIS);

  const customSection = document.createElement('div');
  customSection.className = 'palette-section';
  const customHeading = document.createElement('div');
  customHeading.className = 'palette-section-heading';
  customHeading.textContent = 'Otro';
  customSection.appendChild(customHeading);

  const customRow = document.createElement('div');
  customRow.className = 'icon-custom-row';
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.placeholder = 'Pega o escribe el tuyo';
  customInput.maxLength = 8;
  const customApplyBtn = document.createElement('button');
  customApplyBtn.type = 'button';
  customApplyBtn.className = 'secondary-btn';
  customApplyBtn.textContent = 'Usar';
  customApplyBtn.addEventListener('click', () => {
    if (customInput.value.trim()) applyValue(customInput.value.trim(), { close: true });
  });
  customRow.appendChild(customInput);
  customRow.appendChild(customApplyBtn);
  customSection.appendChild(customRow);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'secondary-btn';
  clearBtn.textContent = 'Quitar icono';
  clearBtn.style.marginTop = '0.5rem';
  clearBtn.style.width = '100%';
  clearBtn.addEventListener('click', () => applyValue('', { close: true }));
  customSection.appendChild(clearBtn);

  popover.appendChild(customSection);

  swatchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = popover.classList.contains('hidden');
    closeAllPopovers(popover);
    popover.classList.toggle('hidden');
    if (willOpen) positionFixedPopover(swatchBtn, popover);
  });

  root.appendChild(swatchBtn);
  applyValue(value);

  return {
    element: root,
    getValue: () => value,
    setValue: (v) => applyValue(v),
  };
}

// ---------------------------------------------------------------------
// Panel de Configuracion: menu vertical (solo texto) que al pulsar una
// entrada abre esa seccion a pantalla completa, con un "Volver" para
// regresar al menu. Se recarga cada seccion al entrar en ella (no hace
// falta pedir todo de golpe al abrir el panel).
// ---------------------------------------------------------------------
const SETTINGS_TABS = ['profile', 'view', 'style', 'groups', 'viajes-settings', 'devices', 'mobile', 'shortcuts'];

function showSettingsScreen(tab) {
  document.getElementById('settings-menu').classList.toggle('hidden', tab !== null);
  SETTINGS_TABS.forEach((t) => {
    document.getElementById(`settings-tab-${t}`).classList.toggle('hidden', t !== tab);
  });
}

document.querySelectorAll('.settings-menu-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    showSettingsScreen(tab);
    if (tab === 'profile') refreshProfileTab();
    else if (tab === 'view') refreshViewTab();
    else if (tab === 'style') refreshStyleTab();
    else if (tab === 'groups') refreshGroupsTab();
    else if (tab === 'viajes-settings') refreshViajesSettingsTab();
    else if (tab === 'devices') refreshDevicesTab();
    else if (tab === 'mobile') refreshMobileTab();
    else if (tab === 'shortcuts') refreshShortcutsTab();
  });
});

// ---------------------------------------------------------------------
// Perfil: tu nickname (compartido entre todos tus dispositivos, como un
// tema o un grupo) y tu id unico. El id se genera una vez en el servidor
// y no cambia nunca aunque cambies el nombre; se ensena oculto por
// defecto porque no aporta nada verlo siempre, con un interruptor local
// (por dispositivo) para revelarlo si hace falta.
// ---------------------------------------------------------------------
let currentProfile = null;

async function refreshProfileTab() {
  currentProfile = await api('/api/profile');
  document.getElementById('profile-name').value = currentProfile.name || '';
  document.getElementById('profile-email').value = currentProfile.email || '';

  const showId = localStorage.getItem('showUserId') === 'true';
  document.getElementById('profile-show-id').checked = showId;
  updateProfileIdDisplay();
}

function updateProfileIdDisplay() {
  const showId = document.getElementById('profile-show-id').checked;
  const idEl = document.getElementById('profile-id-value');
  if (showId && currentProfile) {
    idEl.textContent = `Tu id: ${currentProfile.id}`;
    idEl.classList.remove('hidden');
  } else {
    idEl.classList.add('hidden');
  }
}

document.getElementById('profile-show-id').addEventListener('change', () => {
  localStorage.setItem('showUserId', document.getElementById('profile-show-id').checked ? 'true' : 'false');
  updateProfileIdDisplay();
});

let profileSavedFeedbackTimer = null;

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('profile-name').value;
  const email = document.getElementById('profile-email').value;
  const btn = document.getElementById('profile-form').querySelector('button[type="submit"]');
  const originalLabel = btn.dataset.originalLabel || btn.textContent;
  btn.dataset.originalLabel = originalLabel;

  currentProfile = await api('/api/profile', { method: 'PUT', body: JSON.stringify({ name, email }) });
  document.getElementById('profile-name').value = currentProfile.name || '';
  document.getElementById('profile-email').value = currentProfile.email || '';
  updateProfileIdDisplay();

  // Retroalimentacion breve: el boton cambia a "Guardado ✓" un momento y
  // vuelve a su texto normal, sin necesidad de otro elemento en la pagina.
  clearTimeout(profileSavedFeedbackTimer);
  btn.textContent = 'Guardado ✓';
  btn.classList.add('saved-feedback');
  profileSavedFeedbackTimer = setTimeout(() => {
    btn.textContent = originalLabel;
    btn.classList.remove('saved-feedback');
  }, 1600);
});

// ---------------------------------------------------------------------
// Vista: Normal / Pantalla completa. Un solo modo activo a la vez
// (aplicado de verdad por applyViewMode, en app.js); aqui solo se dibujan
// los botones y cual esta resaltado como actual, igual que "En uso" en la
// biblioteca de temas.
// ---------------------------------------------------------------------
const VIEW_MODES = [
  { id: 'normal', label: 'Normal' },
  { id: 'fullscreen', label: 'Pantalla completa' },
];

function refreshViewTab() {
  const container = document.getElementById('view-mode-options');
  container.innerHTML = '';
  const current = getViewMode();

  VIEW_MODES.forEach((vm) => {
    const isActive = vm.id === current;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'view-mode-btn' + (isActive ? ' active' : '');
    btn.textContent = isActive ? `${vm.label} (actual)` : vm.label;
    if (isActive) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => applyViewMode(vm.id));
    }
    container.appendChild(btn);
  });

  const hint = document.getElementById('view-mode-hint');
  hint.textContent = current === 'fullscreen' ? 'Pulsa Esc en cualquier momento para salir de pantalla completa.' : '';

  refreshCalendarDensityOptions();
  refreshMiEspacioModeOptions();
  refreshRemindersPanelGroupedOptions();
  refreshFavoritesDisplayOptions();
}

// Como se accede a "Mi espacio" (Proximos + Tareas + Notas) — preferencia
// de ESTE dispositivo (localStorage), leida por getMiEspacioMode() y
// aplicada de verdad por applyMiEspacioMode() en app.js.
const MY_SPACE_MODES = [
  { id: 'topbar', label: 'Botón en la barra superior' },
  { id: 'panel', label: 'Panel lateral' },
];

function refreshMiEspacioModeOptions() {
  const container = document.getElementById('my-space-mode-options');
  if (!container) return;
  container.innerHTML = '';
  const current = getMiEspacioMode();

  MY_SPACE_MODES.forEach((mode) => {
    const isActive = mode.id === current;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'view-mode-btn' + (isActive ? ' active' : '');
    btn.textContent = mode.label;
    if (isActive) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        localStorage.setItem('miEspacioMode', mode.id);
        applyMiEspacioMode();
        refreshMiEspacioModeOptions();
      });
    }
    container.appendChild(btn);
  });
}

// Panel lateral clasico (solo aplica en modo "topbar" de Mi espacio, ver
// arriba): una casilla por seccion (Recordatorios/Tareas/Notas, ver
// REMINDERS_PANEL_PAGES en app.js) para elegir cuales van agrupadas
// (juntas, alternando con flechas) -- las que no marques se quedan
// sueltas, apiladas cada una por su lado. Ver
// applyRemindersPanelLayout()/getRemindersGroupedSections() en app.js.
function refreshRemindersPanelGroupedOptions() {
  const container = document.getElementById('reminders-panel-grouped-options');
  if (!container) return;
  container.innerHTML = '';

  let stored;
  try {
    stored = JSON.parse(localStorage.getItem('remindersPanelGrouped') || '[]');
  } catch {
    stored = [];
  }
  if (!Array.isArray(stored)) stored = [];

  REMINDERS_PANEL_PAGES.forEach((p) => {
    const label = document.createElement('label');
    label.className = 'checkbox-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = stored.includes(p.id);
    checkbox.addEventListener('change', () => {
      const next = checkbox.checked
        ? [...stored.filter((id) => id !== p.id), p.id]
        : stored.filter((id) => id !== p.id);
      localStorage.setItem('remindersPanelGrouped', JSON.stringify(next));
      applyRemindersPanelLayout();
      refreshRemindersPanelGroupedOptions();
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(p.label));
    container.appendChild(label);
  });
}

// Favoritos en Mi espacio (carpetas y notas): "merged" (por defecto)
// ordena los favoritos primero sin cabeceras; "sections" separa con una
// cabecera "Favoritos"/"Todo lo demas" (solo si hay algun favorito). Ver
// getFavoritesDisplayMode()/appendFavoriteSortedGroup() en app.js.
const FAVORITES_DISPLAY_OPTIONS = [
  { id: 'merged', label: 'Una sola lista, favoritos primero' },
  { id: 'sections', label: 'Secciones separadas' },
];

function refreshFavoritesDisplayOptions() {
  const container = document.getElementById('favorites-display-options');
  if (!container) return;
  container.innerHTML = '';
  const current = getFavoritesDisplayMode();

  FAVORITES_DISPLAY_OPTIONS.forEach((opt) => {
    const isActive = opt.id === current;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'view-mode-btn' + (isActive ? ' active' : '');
    btn.textContent = opt.label;
    if (isActive) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        localStorage.setItem('favoritesDisplayMode', opt.id);
        renderNotesView();
        refreshFavoritesDisplayOptions();
      });
    }
    container.appendChild(btn);
  });
}

// Como se ven, en el calendario del mes, los dias que tienen varios
// eventos/tareas a la vez — preferencia de ESTE dispositivo (localStorage),
// leida por getCalendarDensityMode() en app.js al dibujar la cuadricula.
const CALENDAR_DENSITY_MODES = [
  { id: 'limit', label: 'Limite + "+N más"' },
  { id: 'dots', label: 'Puntos de color' },
  { id: 'tint', label: 'Solo marcar el día' },
];

function refreshCalendarDensityOptions() {
  const container = document.getElementById('calendar-density-options');
  if (!container) return;
  container.innerHTML = '';
  const current = getCalendarDensityMode();

  CALENDAR_DENSITY_MODES.forEach((mode) => {
    const isActive = mode.id === current;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'view-mode-btn' + (isActive ? ' active' : '');
    btn.textContent = mode.label;
    if (isActive) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        localStorage.setItem('calendarDayDensity', mode.id);
        refreshCalendarDensityOptions();
        if (typeof renderCalendarGrid === 'function') renderCalendarGrid();
      });
    }
    container.appendChild(btn);
  });
}

// Salir de la pestana Estilo (volver al menu, o cerrar Configuracion del
// todo) sin haber guardado descarta el borrador que hubiera a medias —
// closeThemeForm() no hace nada raro si no habia ningun tema en edicion.
document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => {
    closeThemeForm();
    showSettingsScreen(null);
  });
});

function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
  closeThemeForm();
  showSettingsScreen(null);
  refreshQuitMenuItem();
  refreshVersionInfo();
}

document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
// Mismo panel, boton aparte: #my-space-view tapa la topbar (z-index por
// encima), asi que el boton de Configuracion de siempre no se puede
// clicar mientras Mi espacio esta abierto a pantalla completa. Este
// boton vive dentro de la cabecera de Mi espacio para que Configuracion
// se pueda abrir desde cualquier ventana.
document.getElementById('btn-my-space-settings').addEventListener('click', openSettingsModal);
// Mismo motivo que btn-my-space-settings: Extensiones y cada extension
// (Gimnasio/Lecturas/Finanzas/Archivos) son tambien .my-space-view a
// pantalla completa que tapan la topbar -- cada una necesita su propio
// boton de Configuracion.
document.getElementById('btn-extensions-settings').addEventListener('click', openSettingsModal);
document.getElementById('btn-gym-settings').addEventListener('click', openSettingsModal);
document.getElementById('btn-lecturas-settings').addEventListener('click', openSettingsModal);
document.getElementById('btn-finanzas-settings').addEventListener('click', openSettingsModal);
document.getElementById('btn-archivos-settings').addEventListener('click', openSettingsModal);
document.getElementById('btn-viajes-settings').addEventListener('click', openSettingsModal);
document.getElementById('btn-close-settings').addEventListener('click', () => {
  closeThemeForm();
  document.getElementById('settings-modal').classList.add('hidden');
  clearInterval(pairingCountdownTimer);
});

// ---------------------------------------------------------------------
// Estilo: biblioteca de temas compartida + cual tengo activo YO
// ---------------------------------------------------------------------
// Cada fondo real de la app lleva su propio color de contraste al lado
// (marcado con contrastFor), en vez de un "texto principal/secundario"
// unico para toda la interfaz — asi cada superficie garantiza su propia
// legibilidad sin importar lo distinta que sea del resto del tema. El
// editor de temas (buildThemeColorGrid) agrupa cada fondo con su contraste
// justo debajo.
const THEME_COLOR_FIELDS_META = [
  { key: 'bg', cssVar: '--bg', label: 'Fondo general' },
  { key: 'bgText', cssVar: '--bg-text', label: 'Contraste sobre fondo general', contrastFor: 'bg' },
  { key: 'surface', cssVar: '--surface', label: 'Fondo de tarjetas' },
  { key: 'surfaceText', cssVar: '--surface-text', label: 'Contraste sobre tarjetas', contrastFor: 'surface' },
  { key: 'surface2', cssVar: '--surface-2', label: 'Fondo de campos y botones' },
  { key: 'surface2Text', cssVar: '--surface-2-text', label: 'Contraste sobre campos y botones', contrastFor: 'surface2' },
  { key: 'border', cssVar: '--border', label: 'Bordes' },
  { key: 'accent', cssVar: '--accent', label: 'Acento (botones)' },
  { key: 'accentText', cssVar: '--accent-text', label: 'Contraste sobre el acento', contrastFor: 'accent' },
  { key: 'danger', cssVar: '--danger', label: 'Aviso (eliminar)' },
  { key: 'settingsMenuBg', cssVar: '--settings-menu-bg', label: 'Fondo del menú de Configuración' },
  { key: 'settingsMenuText', cssVar: '--settings-menu-text', label: 'Contraste sobre el menú de Configuración', contrastFor: 'settingsMenuBg' },
  { key: 'dayToday', cssVar: '--day-today', label: 'Calendario: número del día de hoy' },
  { key: 'dayTodayText', cssVar: '--day-today-text', label: 'Contraste sobre el día de hoy', contrastFor: 'dayToday' },
  { key: 'dayWeekend', cssVar: '--day-weekend', label: 'Calendario: fin de semana' },
  { key: 'dayHoliday', cssVar: '--day-holiday', label: 'Calendario: festivo (marcado a mano)' },
  { key: 'daySpecial', cssVar: '--day-special', label: 'Calendario: día especial (marcado a mano)' },
];

let themeLibrary = [];
const themeColorFields = {};

// Estas dos tienen que existir YA (antes de buildThemeColorGrid(), que se
// llama mas abajo nada mas cargar la pagina): crear cada campo de color
// dispara su onChange una vez para pintar el cuadradito inicial, y ese
// onChange llama a markThemeDraftDirty(), que las lee. Si se declararan
// mas abajo (donde tocaria por tema), esa primera llamada explotaria por
// "acceder antes de inicializar" y dejaria sin registrar TODO lo que
// venga despues en este archivo (atajos, dispositivos, grupos...) — asi
// se rompio "volver"/"cerrar" en Configuracion la vez anterior.
let themeDraftDirty = false;
let suppressDirtyTracking = false;

function buildThemeColorGrid() {
  const grid = document.getElementById('theme-color-grid');
  grid.innerHTML = '';
  THEME_COLOR_FIELDS_META.forEach(({ key, label, contrastFor }) => {
    const item = document.createElement('div');
    item.className = 'theme-color-item' + (contrastFor ? ' theme-color-item-contrast' : '');
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const field = createColorField({ initialValue: '#5b8cff', onChange: () => markThemeDraftDirty() });
    themeColorFields[key] = field;
    item.appendChild(labelEl);
    item.appendChild(field.element);
    grid.appendChild(item);
  });
}
// Crear cada campo pinta su cuadradito inicial, lo que dispara su
// onChange una vez por campo — como eso pasa MIENTRAS SE VAN CREANDO
// (los campos que todavia no existen no se pueden leer), tiene que
// contar como inicializacion, no como que la persona ha tocado algo.
suppressDirtyTracking = true;
buildThemeColorGrid();
suppressDirtyTracking = false;

// ---------------------------------------------------------------------
// Un poco de matematicas de color, para la variante inversa (claro/oscuro
// emparejados) de un tema: convertimos a HSL, invertimos solo el "brillo"
// (L) manteniendo el tono y la saturacion, y volvemos a hex. Asi el
// resultado se sigue pareciendo a la familia de color original (un azul
// sigue siendo azul, solo mas oscuro o mas claro) en vez de dar un color
// sin relacion. Es un punto de partida para retocar a mano, no un intento
// de ser perfecto.
// ---------------------------------------------------------------------
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function invertLightness(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, 1 - l);
}

// Color por defecto para una tarea COMPLETADA cuando su grupo no tiene uno
// explicito puesto (o la tarea no tiene grupo): el mismo tono, pero mas
// apagado — bajamos la saturacion y subimos la luminosidad hacia un gris
// claro, para que se note de un vistazo que esta "tachada" sin perder de
// que color era. Un grupo puede pisar esto poniendo su propio
// completedColor (ver Configuracion > Grupos).
function mutedTaskColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s * 0.3, Math.min(0.82, l + (1 - l) * 0.5));
}

function invertColorsObject(colors) {
  const result = {};
  THEME_COLOR_FIELDS_META.forEach(({ key }) => {
    result[key] = invertLightness(colors[key]);
  });
  return result;
}

// Segun el fondo general, decide si una paleta es "clara" u "oscura" —
// sirve para saber cual de las dos variantes de un tema emparejado
// ensenar cuando el modo de color pedido es "sistema", "claro" u "oscuro".
function isLightColors(colors) {
  return hexToHsl(colors.bg).l > 0.5;
}

function resolveThemeVariant(theme) {
  if (!theme.inverseColors) return theme.colors;
  const pref = localStorage.getItem('colorModePreference') || 'system';
  const wantDark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const mainIsLight = isLightColors(theme.colors);
  if (wantDark) return mainIsLight ? theme.inverseColors : theme.colors;
  return mainIsLight ? theme.colors : theme.inverseColors;
}

// Lee/escribe los 9 campos del formulario de tema de golpe — hace falta
// para "aparcar" los valores de un lado (Principal/Inversa) al saltar al
// otro, ya que los mismos campos del DOM se reutilizan para los dos.
function readColorFieldsValues() {
  const values = {};
  THEME_COLOR_FIELDS_META.forEach(({ key }) => {
    values[key] = themeColorFields[key].getValue();
  });
  return values;
}

// OJO: esto dispara el onChange de cada campo (para repintar el
// cuadradito), pero es una restauracion programatica, no un cambio hecho
// por la persona — por eso silencia el marcado de "borrador sucio"
// mientras escribe los 17 valores de golpe (ver suppressDirtyTracking).
function writeColorFieldsValues(values) {
  suppressDirtyTracking = true;
  THEME_COLOR_FIELDS_META.forEach(({ key }) => {
    themeColorFields[key].setValue((values && values[key]) || '#5b8cff');
  });
  suppressDirtyTracking = false;
}

// Aplica un juego de colores a la pagina cambiando las variables CSS del
// documento (ver :root en styles.css). No hace falta recargar nada: los
// estilos que usan var(--bg), var(--accent)... se actualizan al momento.
function applyThemeColors(colors) {
  const root = document.documentElement;
  THEME_COLOR_FIELDS_META.forEach(({ key, cssVar }) => {
    if (colors[key]) root.style.setProperty(cssVar, colors[key]);
  });
  // Le dice al navegador si este tema es claro u oscuro para que los
  // controles nativos que quedan (el iconito del reloj de
  // <input type="time">, por ejemplo) usen la version clara/oscura que
  // corresponda en vez de quedarse siempre con una — sin esto, el reloj
  // se ve casi invisible en la combinacion equivocada (p.ej. negro sobre
  // un tema oscuro).
  if (colors.bg) root.style.colorScheme = isLightColors(colors) ? 'light' : 'dark';
}

// Aplica un tema a ESTE dispositivo: lo pinta, lo recuerda en localStorage
// (para la proxima vez que se abra, y para el script del <head> que evita
// el parpadeo) y, si procede, avisa al servidor de que este dispositivo
// tiene ese tema activo (para que "copiar de otro dispositivo" funcione).
async function applyTheme(theme, { persist = true } = {}) {
  const colors = resolveThemeVariant(theme);
  applyThemeColors(colors);
  localStorage.setItem('activeThemeId', String(theme.id));
  localStorage.setItem('activeThemeColors', JSON.stringify(colors));
  renderThemeLibrary();
  refreshQuickColorModeButton();

  if (persist) {
    try {
      await api('/api/themes/selection/mine', { method: 'PUT', body: JSON.stringify({ themeId: theme.id }) });
    } catch (err) {
      // El tema ya se aplico en pantalla igualmente; si falla el guardado
      // remoto (por ejemplo, sin conexion un instante) no es grave, se
      // reintentara la proxima vez que se elija un tema.
    }
  }
}

// Modo de color: si un tema tiene variante inversa, decide cual de las
// dos ensena resolveThemeVariant. "Sistema" sigue el modo claro/oscuro
// del sistema operativo (y se reacciona en vivo si cambia mientras la
// app esta abierta, ver el listener de matchMedia mas abajo); es un
// ajuste de ESTE dispositivo, como el tema activo.
// Solo hay boton para "Sistema" -- cambiar a claro/oscuro A MANO ya se
// hace con el atajo ☀/☾ de la topbar (ver btn-quick-color-mode mas
// abajo), que dispara setColorModePreference('light'/'dark') igual que
// hacian los botones "Claro"/"Oscuro" que habia aqui antes. Este boton
// sirve para volver a "seguir el sistema" despues de haber cambiado a
// mano con el atajo.
const COLOR_MODES = [
  { id: 'system', label: 'Sistema' },
];

// ---------------------------------------------------------------------
// Estilo de interaccion (Neon/Directo/Cristal): mismo patron de tarjetas
// "elige una" que COLOR_MODES/refreshColorModeOptions de arriba, pero
// independiente del tema de color -- getUiStylePreference/applyUiStyle
// viven en app.js porque tambien hace falta aplicarlas nada mas arrancar,
// antes de que este archivo se cargue.
// ---------------------------------------------------------------------
const UI_STYLES = [
  { id: 'directo', label: 'Directo' },
  { id: 'neon', label: 'Neón' },
  { id: 'cristal', label: 'Cristal' },
  { id: 'registro', label: 'Registro' },
];

function setUiStylePreference(style) {
  localStorage.setItem('uiStylePreference', style);
  applyUiStyle();
  refreshUiStyleOptions();
}

function refreshUiStyleOptions() {
  const container = document.getElementById('ui-style-options');
  if (!container) return;
  container.innerHTML = '';
  const current = getUiStylePreference();

  UI_STYLES.forEach((s) => {
    const isActive = s.id === current;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'view-mode-btn' + (isActive ? ' active' : '');
    btn.textContent = s.label;
    if (isActive) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => setUiStylePreference(s.id));
    }
    container.appendChild(btn);
  });
}

// Cambia el modo de color y refresca todo lo que depende de el: los
// botones Sistema/Claro/Oscuro, el tema activo (si tiene variante
// inversa, cambia de golpe) y la biblioteca (las tarjetas emparejadas
// actualizan su etiqueta Oscuro/Claro). La usan tanto los botones de
// arriba como la etiqueta clicable de cada tarjeta con pareja.
function setColorModePreference(mode) {
  localStorage.setItem('colorModePreference', mode);
  refreshColorModeOptions();
  const activeTheme = themeLibrary.find((t) => t.id === Number(localStorage.getItem('activeThemeId')));
  if (activeTheme) applyTheme(activeTheme, { persist: false });
  else renderThemeLibrary();
}

// Atajo para alternar claro/oscuro sin pasar por "Sistema" (ademas de la
// forma "oficial" en Configuracion > Estilo). Solo tiene sentido si el
// tema activo lleva variante emparejada — si no, no hay a que alternar y
// el boton se esconde. Hay 2 copias del mismo boton (ver
// .quick-color-mode-btn): una en la topbar de escritorio
// (#btn-quick-color-mode) y otra dentro de Configuracion > Estilo
// (#settings-quick-color-mode, para movil, que ya no tiene topbar) --
// ambas se refrescan y comportan igual.
function refreshQuickColorModeButton() {
  const buttons = document.querySelectorAll('.quick-color-mode-btn');
  if (!buttons.length) return;
  const activeTheme = themeLibrary.find((t) => t.id === Number(localStorage.getItem('activeThemeId')));
  const hasInverse = !!(activeTheme && activeTheme.inverseColors);
  const resolvedIsLight = hasInverse && isLightColors(resolveThemeVariant(activeTheme));
  buttons.forEach((btn) => {
    btn.classList.toggle('hidden', !hasInverse);
    if (!hasInverse) return;
    btn.textContent = resolvedIsLight ? '☀' : '☾';
    btn.title = `Cambiar a ${resolvedIsLight ? 'oscuro' : 'claro'}`;
  });
}

document.querySelectorAll('.quick-color-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const activeTheme = themeLibrary.find((t) => t.id === Number(localStorage.getItem('activeThemeId')));
    if (!activeTheme || !activeTheme.inverseColors) return;
    const resolvedIsLight = isLightColors(resolveThemeVariant(activeTheme));
    setColorModePreference(resolvedIsLight ? 'dark' : 'light');
  });
});

function refreshColorModeOptions() {
  const container = document.getElementById('color-mode-options');
  if (!container) return;
  container.innerHTML = '';
  const current = localStorage.getItem('colorModePreference') || 'system';

  COLOR_MODES.forEach((cm) => {
    const isActive = cm.id === current;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-mode-btn' + (isActive ? ' active' : '');
    btn.textContent = cm.label;
    if (isActive) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => setColorModePreference(cm.id));
    }
    container.appendChild(btn);
  });
}

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('colorModePreference') || 'system') !== 'system') return;
    const activeTheme = themeLibrary.find((t) => t.id === Number(localStorage.getItem('activeThemeId')));
    if (activeTheme) applyTheme(activeTheme, { persist: false });
  });
}

async function refreshStyleTab() {
  themeLibrary = await api('/api/themes');
  refreshUiStyleOptions();
  refreshColorModeOptions();
  renderThemeLibrary();
  refreshQuickColorModeButton();
  await refreshThemeCopyList();
}

// Guarda que tema se esta editando ahora mismo (null = ninguno, o se esta
// creando uno nuevo). Sirve para saber donde reubicar el formulario:
// justo debajo de esa tarjeta, en vez de siempre al final de la lista.
let editingThemeId = null;

function positionThemeForm() {
  const form = document.getElementById('theme-form');
  const anchor = document.getElementById('theme-form-anchor');
  if (!form || !anchor) return;
  if (editingThemeId) {
    const card = document.querySelector(`.theme-card[data-theme-id="${editingThemeId}"]`);
    if (card) {
      card.insertAdjacentElement('afterend', form);
      return;
    }
  }
  anchor.insertAdjacentElement('afterend', form);
}

function renderThemeLibrary() {
  const container = document.getElementById('theme-library');
  // El formulario puede haberse movido dentro de este contenedor (para
  // aparecer justo debajo de la tarjeta que se esta editando). Si lo
  // dejaramos ahi, el innerHTML = '' de abajo lo destruiria junto con las
  // tarjetas, asi que lo sacamos primero a su sitio "de repuesto".
  const themeFormEl = document.getElementById('theme-form');
  const themeFormAnchor = document.getElementById('theme-form-anchor');
  if (themeFormEl && themeFormAnchor && container.contains(themeFormEl)) {
    themeFormAnchor.insertAdjacentElement('afterend', themeFormEl);
  }

  container.innerHTML = '';
  const activeId = Number(localStorage.getItem('activeThemeId')) || null;

  if (themeLibrary.length === 0) {
    container.innerHTML = '<p class="empty-hint">Todavia no hay temas guardados.</p>';
    positionThemeForm();
    return;
  }

  themeLibrary.forEach((theme) => {
    const isActive = theme.id === activeId;
    const card = document.createElement('div');
    card.className = 'theme-card' + (isActive ? ' active' : '');
    card.dataset.themeId = String(theme.id);
    const activeBadge = isActive ? '<span class="theme-active-badge">En uso</span>' : '';
    const resolved = resolveThemeVariant(theme);
    // Si el tema tiene pareja, una etiqueta con la variante que se ve
    // ahora mismo (Oscuro/Claro). Solo se puede alternar si el tema ya
    // esta en uso — si no, un clic en cualquier parte de la tarjeta
    // (incluida esta etiqueta) lo activa primero, igual que el resto.
    const resolvedIsLight = isLightColors(resolved);
    const pairBadge = theme.inverseColors
      ? `<button type="button" data-action="toggle-variant" class="theme-pair-badge" title="${isActive ? `Cambiar a ${resolvedIsLight ? 'oscuro' : 'claro'}` : 'Fija este tema para poder cambiar de variante'}">${resolvedIsLight ? '☀ Claro' : '☾ Oscuro'}</button>`
      : '';
    card.innerHTML = `
      <div class="theme-card-top">
        <div class="theme-card-preview">
          <span class="color-dot" style="background-color:${resolved.bg}"></span>
          <span class="color-dot" style="background-color:${resolved.surface}"></span>
          <span class="color-dot" style="background-color:${resolved.accent}"></span>
          <span class="color-dot" style="background-color:${resolved.danger}"></span>
        </div>
        ${activeBadge}
      </div>
      <div class="theme-card-name">${escapeHtml(theme.name)} ${pairBadge}</div>
      <div class="theme-card-actions">
        <button type="button" data-action="edit" class="secondary-btn">Editar</button>
        <button type="button" data-action="export" class="secondary-btn">Exportar</button>
      </div>
    `;
    // Clicar la tarjeta (fuera de sus botones, que paran la propagacion)
    // fija ese tema como el de este dispositivo — ya no hace falta un
    // boton "Usar" aparte. Si ya esta en uso, no hay nada que hacer.
    if (!isActive) {
      card.addEventListener('click', () => applyTheme(theme));
    }
    card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      switchThemeEdit(theme);
    });
    card.querySelector('[data-action="export"]').addEventListener('click', (e) => {
      e.stopPropagation();
      exportTheme(theme);
    });
    const toggleBtn = card.querySelector('[data-action="toggle-variant"]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!isActive) {
          // Aun no esta en uso: un clic aqui lo fija primero (con la
          // variante que le tocaria ahora mismo), igual que clicar el
          // resto de la tarjeta. Cambiar de variante sera el SIGUIENTE
          // clic, una vez ya este activo.
          applyTheme(theme);
          return;
        }
        setColorModePreference(resolvedIsLight ? 'dark' : 'light');
      });
    }
    container.appendChild(card);
  });

  positionThemeForm();
}

// Mientras se edita un tema, los campos del formulario se reutilizan
// para las dos variantes (Principal/Inversa) — estas dos variables
// guardan los valores del lado que NO se esta viendo ahora, para no
// perderlos al saltar de uno a otro.
let editingMainColors = null;
let editingInverseColors = null;
let editingColorSide = 'main';

// themeDraftDirty/suppressDirtyTracking se declaran mas arriba, justo
// antes de buildThemeColorGrid() — mientras sea dirty=true, aparece el
// boton "Guardar cambios del tema" y los colores en pantalla son la
// VISTA PREVIA en vivo del borrador, no el tema activo de verdad. Se
// guarda solo (no hace falta pulsar nada) al saltar a editar otro tema;
// se descarta si se cierra sin guardar (Cancelar o salir de Configuracion).

function updateThemeColorSideUI() {
  const switcher = document.getElementById('theme-color-side-switch');
  switcher.classList.toggle('hidden', !editingInverseColors);
  switcher.querySelectorAll('.theme-side-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.side === editingColorSide);
  });
}

// Pinta AHORA MISMO, en toda la app (no solo en los cuadraditos del
// formulario), el lado que se este editando — asi se juzga el contraste
// de verdad, viendo el menu de Configuracion y el resto de la interfaz
// con esos colores, en vez de fiarse solo de la vista previa pequena.
function previewCurrentThemeEdit() {
  applyThemeColors(readColorFieldsValues());
}

function markThemeDraftDirty() {
  if (suppressDirtyTracking) return;
  themeDraftDirty = true;
  document.getElementById('btn-save-theme-changes').classList.remove('hidden');
  previewCurrentThemeEdit();
}

// Deshace la vista previa en vivo: vuelve a pintar el tema que este
// dispositivo tenga activo de verdad. Se llama al cancelar o cerrar sin
// guardar, para no dejar la app con colores de un borrador descartado.
function revertLiveThemePreview() {
  const activeTheme = themeLibrary.find((t) => t.id === Number(localStorage.getItem('activeThemeId')));
  if (activeTheme) applyThemeColors(resolveThemeVariant(activeTheme));
}

function switchColorSide(side) {
  if (side === editingColorSide) return;
  const snapshot = readColorFieldsValues();
  if (editingColorSide === 'main') editingMainColors = snapshot;
  else editingInverseColors = snapshot;

  editingColorSide = side;
  writeColorFieldsValues(side === 'main' ? editingMainColors : editingInverseColors);
  updateThemeColorSideUI();
  previewCurrentThemeEdit();
}

document.querySelectorAll('#theme-color-side-switch .theme-side-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchColorSide(btn.dataset.side));
});

document.getElementById('theme-inverse-toggle').addEventListener('change', (e) => {
  if (e.target.checked) {
    if (!editingInverseColors) {
      const snapshot = readColorFieldsValues();
      if (editingColorSide === 'main') editingMainColors = snapshot;
      else editingInverseColors = snapshot;
      // Generamos una inversa de partida a partir de la principal, la
      // persona la puede retocar despues cambiando a la pestana "Inversa".
      editingInverseColors = invertColorsObject(editingMainColors);
    }
  } else {
    editingInverseColors = null;
    if (editingColorSide === 'inverse') {
      editingColorSide = 'main';
      writeColorFieldsValues(editingMainColors);
    }
  }
  updateThemeColorSideUI();
  markThemeDraftDirty();
});

document.getElementById('theme-name').addEventListener('input', markThemeDraftDirty);

function openThemeForm(theme) {
  editingThemeId = theme ? theme.id : null;
  positionThemeForm();

  document.getElementById('theme-id').value = theme ? theme.id : '';
  document.getElementById('theme-name').value = theme ? theme.name : '';

  // Un tema nuevo arranca con los colores que se ven AHORA MISMO en
  // pantalla (el tema activo), asi es mas facil partir de algo y tocar
  // solo lo que se quiera cambiar, en vez de empezar en blanco.
  const computed = getComputedStyle(document.documentElement);
  const startingColors = {};
  THEME_COLOR_FIELDS_META.forEach(({ key, cssVar }) => {
    const value = theme ? theme.colors[key] : computed.getPropertyValue(cssVar).trim();
    startingColors[key] = value || '#5b8cff';
  });

  editingMainColors = startingColors;
  editingInverseColors = theme && theme.inverseColors ? { ...theme.inverseColors } : null;
  editingColorSide = 'main';
  writeColorFieldsValues(editingMainColors);
  document.getElementById('theme-inverse-toggle').checked = !!editingInverseColors;
  updateThemeColorSideUI();

  // Un tema nuevo ya arranca "sucio": hace falta guardarlo al menos una
  // vez para que exista de verdad. Uno existente arranca limpio.
  themeDraftDirty = !theme;
  document.getElementById('btn-save-theme-changes').classList.toggle('hidden', !themeDraftDirty);

  document.getElementById('btn-delete-theme').classList.toggle('hidden', !theme);
  document.getElementById('theme-form').classList.remove('hidden');
  document.getElementById('theme-name').focus();

  previewCurrentThemeEdit();
}

// Cierra el formulario SIN guardar: descarta el borrador y devuelve la
// app al tema activo de verdad.
function closeThemeForm() {
  document.getElementById('theme-form').classList.add('hidden');
  document.getElementById('btn-save-theme-changes').classList.add('hidden');
  editingThemeId = null;
  themeDraftDirty = false;
  revertLiveThemePreview();
  positionThemeForm();
}

// Guarda de verdad (POST/PUT al servidor) lo que haya ahora mismo en el
// formulario. La usa tanto el boton "Guardar cambios del tema" como el
// salto automatico a editar otro tema, para no perder nada al cambiar de
// tarjeta sin haber guardado antes.
async function saveCurrentThemeEdit() {
  const id = document.getElementById('theme-id').value;

  // Lo que se ve AHORA MISMO en los campos pertenece al lado que se
  // estaba editando; lo guardamos ahi antes de construir el payload.
  const currentFieldValues = readColorFieldsValues();
  if (editingColorSide === 'main') editingMainColors = currentFieldValues;
  else editingInverseColors = currentFieldValues;

  const inverseEnabled = document.getElementById('theme-inverse-toggle').checked;
  const payload = {
    name: document.getElementById('theme-name').value,
    colors: editingMainColors,
    inverseColors: inverseEnabled ? editingInverseColors : null,
  };

  const saved = id
    ? await api(`/api/themes/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
    : await api('/api/themes', { method: 'POST', body: JSON.stringify(payload) });

  document.getElementById('theme-form').classList.add('hidden');
  document.getElementById('btn-save-theme-changes').classList.add('hidden');
  editingThemeId = null;
  themeDraftDirty = false;
  positionThemeForm();
  await refreshStyleTab();

  // Si el tema que acabamos de guardar es el que tenemos activo, refresca
  // los colores en pantalla al momento (por si edito el que esta usando).
  if (Number(localStorage.getItem('activeThemeId')) === saved.id) applyTheme(saved, { persist: false });
  return saved;
}

// Punto de entrada para "Editar" en cualquier tarjeta y para "+ Crear
// tema": si ya habia un borrador sin guardar DE OTRO tema, lo guarda
// primero solo (sin preguntar) y despues abre el nuevo — asi cambiar de
// tarjeta mientras editas no te bloquea ni te hace perder lo que llevabas.
async function switchThemeEdit(theme) {
  const targetId = theme ? theme.id : null;
  // Ya esta abierto este mismo tema: no lo reabrimos (eso reiniciaria el
  // borrador y perderias lo que llevabas sin guardar).
  if (editingThemeId === targetId && !document.getElementById('theme-form').classList.contains('hidden')) return;
  if (themeDraftDirty && editingThemeId !== targetId) {
    await saveCurrentThemeEdit();
  }
  openThemeForm(theme);
}

document.getElementById('btn-new-theme').addEventListener('click', () => switchThemeEdit(null));
document.getElementById('btn-cancel-theme').addEventListener('click', closeThemeForm);
document.getElementById('btn-save-theme-changes').addEventListener('click', saveCurrentThemeEdit);

document.getElementById('theme-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveCurrentThemeEdit();
});

document.getElementById('btn-delete-theme').addEventListener('click', async () => {
  const id = document.getElementById('theme-id').value;
  if (!id) return;
  if (!confirm('¿Eliminar este tema? Los dispositivos que lo tuvieran activo se quedaran sin tema.')) return;
  await api(`/api/themes/${id}`, { method: 'DELETE' });
  document.getElementById('theme-form').classList.add('hidden');
  document.getElementById('btn-save-theme-changes').classList.add('hidden');
  editingThemeId = null;
  themeDraftDirty = false;
  positionThemeForm();
  await refreshStyleTab();
});

// --- Copiar estilo de otro dispositivo conectado ---
async function refreshThemeCopyList() {
  const container = document.getElementById('theme-copy-list');
  container.innerHTML = '';

  let selection;
  try {
    selection = await api('/api/themes/selection');
  } catch (err) {
    container.innerHTML = '<p class="empty-hint">No se pudo consultar los demas dispositivos.</p>';
    return;
  }

  const others = selection.filter((s) => !s.isSelf);
  if (others.length === 0) {
    container.innerHTML = '<p class="empty-hint">Todavia no hay otros dispositivos vinculados.</p>';
    return;
  }

  others.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'theme-copy-item';
    row.innerHTML = `
      <span class="theme-copy-label">${escapeHtml(entry.label)}</span>
      <span class="hint">${entry.themeName ? escapeHtml(entry.themeName) : 'sin tema elegido'}</span>
      <button type="button" class="secondary-btn" ${entry.themeId ? '' : 'disabled'}>Usar este</button>
    `;
    row.querySelector('button').addEventListener('click', async () => {
      const theme = themeLibrary.find((t) => t.id === entry.themeId);
      if (theme) await applyTheme(theme);
    });
    container.appendChild(row);
  });
}

// --- Importar / exportar temas (para compartir entre dispositivos que
// no pueden conectarse directamente entre si, ej. dos moviles) ---
function exportTheme(theme) {
  const blob = new Blob(
    [JSON.stringify({ name: theme.name, colors: theme.colors, inverseColors: theme.inverseColors || null }, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = theme.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'tema';
  a.download = `${safeName}.remindmelater-theme.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById('btn-import-theme').addEventListener('click', () => {
  document.getElementById('theme-import-input').click();
});

document.getElementById('theme-import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // permite volver a elegir el mismo archivo otra vez si hace falta
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.colors) {
      throw new Error('El archivo no tiene el formato esperado.');
    }
    await api('/api/themes', {
      method: 'POST',
      body: JSON.stringify({
        name: parsed.name || 'Tema importado',
        colors: parsed.colors,
        inverseColors: parsed.inverseColors || null,
      }),
    });
    await refreshStyleTab();
  } catch (err) {
    alert('No se pudo importar el tema: ' + err.message);
  }
});

// Al cargar la app: averigua que tema tenemos activo segun el servidor
// (que es la fuente de verdad) y lo aplica. Mientras tanto, el script del
// <head> ya habra pintado lo que hubiera en cache para evitar parpadeos.
async function syncActiveTheme() {
  try {
    const [themes, selection] = await Promise.all([api('/api/themes'), api('/api/themes/selection')]);
    themeLibrary = themes;
    const mine = selection.find((s) => s.isSelf);
    if (mine && mine.themeId) {
      const theme = themeLibrary.find((t) => t.id === mine.themeId);
      if (theme) await applyTheme(theme, { persist: false });
    }
    refreshQuickColorModeButton();
  } catch (err) {
    // Pantalla de emparejamiento, sin red, etc.: nos quedamos con lo que
    // hubiera en cache local. No hace falta avisar de nada aqui.
  }
}
syncActiveTheme();

// ---------------------------------------------------------------------
// Grupos (gestion completa; el <select> del formulario de evento sigue
// viviendo en app.js porque forma parte de ese modal)
// ---------------------------------------------------------------------
const groupIconField = createIconField({ initialValue: '' });
document.getElementById('group-icon-field').appendChild(groupIconField.element);

// OJO orden: groupCompletedColorField se crea ANTES que groupColorField
// porque el onChange de groupColorField la referencia — crearla antes evita
// el bug de "variable declarada mas abajo leida por un callback que se
// dispara al construir" documentado en CLAUDE.md (createColorField llama a
// su onChange una vez de inmediato, al pintar el cuadradito inicial).
// suppressGroupCompletedTouch evita que esas llamadas de INICIALIZACION (la
// propia y la que dispara groupColorField al crearse, que la actualiza en
// cascada) cuenten como "la persona ha tocado el selector a mano".
let suppressGroupCompletedTouch = true;
let groupCompletedColorTouched = false;
const groupCompletedColorField = createColorField({
  initialValue: mutedTaskColor(DEFAULT_EVENT_COLOR),
  onChange: () => { if (!suppressGroupCompletedTouch) groupCompletedColorTouched = true; },
});
document.getElementById('group-completed-color-field').appendChild(groupCompletedColorField.element);

const groupColorField = createColorField({
  initialValue: DEFAULT_EVENT_COLOR,
  // Si el color normal del grupo cambia y todavia no se ha tocado a mano
  // el de "completada", seguimos su tono atenuado como sugerencia — en
  // cuanto se toque el propio selector de completada, deja de seguirle.
  onChange: (newColor) => {
    if (!groupCompletedColorTouched) groupCompletedColorField.setValue(mutedTaskColor(newColor));
  },
});
document.getElementById('group-color-field').appendChild(groupColorField.element);
suppressGroupCompletedTouch = false;

async function refreshGroupsTab() {
  await loadGroups();
  renderGroupsList();
}

// Ajuste GLOBAL (no por dispositivo, ver routes/viajesSettings.js) --
// a diferencia del resto de esta pestaña "Este dispositivo", este
// checkbox no lee/escribe localStorage, hace una llamada real al
// servidor cada vez.
async function refreshViajesSettingsTab() {
  const { finanzasLinked } = await api('/api/viajes-settings');
  document.getElementById('setting-viajes-finanzas-linked').checked = finanzasLinked;
}
document.getElementById('setting-viajes-finanzas-linked').addEventListener('change', async (e) => {
  await api('/api/viajes-settings', { method: 'PUT', body: JSON.stringify({ finanzasLinked: e.target.checked }) });
});

// Cambia el color de "completada" SIN que cuente como que la persona lo ha
// tocado a mano (carga inicial, reset del formulario, o cargar el valor
// guardado de un grupo existente al editarlo) — solo un click real en su
// selector marca groupCompletedColorTouched.
function setGroupCompletedColorProgrammatically(hex) {
  suppressGroupCompletedTouch = true;
  groupCompletedColorField.setValue(hex);
  suppressGroupCompletedTouch = false;
}

function resetGroupForm() {
  document.getElementById('group-id').value = '';
  document.getElementById('group-name').value = '';
  groupIconField.setValue('');
  groupColorField.setValue(DEFAULT_EVENT_COLOR);
  groupCompletedColorTouched = false;
  setGroupCompletedColorProgrammatically(mutedTaskColor(DEFAULT_EVENT_COLOR));
  document.getElementById('btn-cancel-group').classList.add('hidden');
}

function renderGroupsList() {
  const list = document.getElementById('groups-list');
  list.innerHTML = '';
  if (state.groups.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavia no tienes grupos. Crea uno arriba.</p>';
    return;
  }
  state.groups.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'group-item';
    row.innerHTML = `
      <span class="color-dot" style="background-color: ${g.color}"></span>
      <span class="group-item-name">${g.icon ? escapeHtml(g.icon) + ' ' : ''}${escapeHtml(g.name)}</span>
      <div class="group-item-actions">
        <button type="button" class="secondary-btn" data-action="edit">Editar</button>
        <button type="button" class="danger-btn" data-action="delete">Eliminar</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener('click', () => {
      document.getElementById('group-id').value = g.id;
      document.getElementById('group-name').value = g.name;
      groupIconField.setValue(g.icon || '');
      groupColorField.setValue(g.color);
      // Si el grupo ya tiene un color de completada EXPLICITO, lo tratamos
      // como "tocado" para que cambiar el color normal no se lo pise; si
      // no, sigue el color normal como hasta ahora.
      groupCompletedColorTouched = !!g.completedColor;
      setGroupCompletedColorProgrammatically(g.completedColor || mutedTaskColor(g.color));
      document.getElementById('btn-cancel-group').classList.remove('hidden');
      document.getElementById('group-name').focus();
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el grupo "${g.name}"? Los eventos que lo usen se quedaran sin grupo.`)) return;
      await api(`/api/groups/${g.id}`, { method: 'DELETE' });
      await refreshGroupsTab();
      loadMonth();
      loadReminders();
      if (typeof loadTasks === 'function') loadTasks().then(renderTasksList);
    });
    list.appendChild(row);
  });
}

document.getElementById('btn-cancel-group').addEventListener('click', resetGroupForm);

document.getElementById('group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('group-id').value;
  const payload = {
    name: document.getElementById('group-name').value,
    color: groupColorField.getValue(),
    icon: groupIconField.getValue() || null,
    completedColor: groupCompletedColorField.getValue(),
  };

  if (id) {
    await api(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/groups', { method: 'POST', body: JSON.stringify(payload) });
  }

  resetGroupForm();
  await refreshGroupsTab();
  loadMonth();
  loadReminders();
  if (typeof loadTasks === 'function') loadTasks().then(renderTasksList);
});

// ---------------------------------------------------------------------
// Dispositivos vinculados (gestion completa, movida aqui desde app.js)
// ---------------------------------------------------------------------
let pairingCountdownTimer = null;

async function refreshDevicesTab() {
  document.getElementById('pairing-code-display').classList.add('hidden');
  try {
    const devices = await api('/api/devices');
    document.getElementById('devices-only-computer').classList.add('hidden');
    document.getElementById('devices-management').classList.remove('hidden');
    renderDevicesList(devices);
    refreshNetworkQr();
  } catch (err) {
    // 403: este dispositivo no es el ordenador de confianza.
    document.getElementById('devices-only-computer').classList.remove('hidden');
    document.getElementById('devices-management').classList.add('hidden');
  }
}

// QR con la IP de este ordenador en la red actual (ver getLanUrl() en
// server/routes/devices.js) -- lo escanea un movil ya vinculado para saber
// donde mandar los datos sin volver a emparejarse (ver
// openScanServerModal() mas abajo).
async function refreshNetworkQr() {
  const img = document.getElementById('network-qr-image');
  const urlText = document.getElementById('network-qr-url');
  try {
    const info = await api('/api/devices/network-info');
    img.src = `/api/devices/network-qr.svg?_=${Date.now()}`;
    img.classList.remove('hidden');
    urlText.textContent = info.url;
  } catch (err) {
    img.classList.add('hidden');
    urlText.textContent = 'No se ha detectado ninguna red activa.';
  }
}

function renderDevicesList(devices) {
  const list = document.getElementById('devices-list');
  list.innerHTML = '';
  if (devices.length === 0) {
    list.innerHTML = '<p class="empty-hint">Ningun dispositivo vinculado todavia.</p>';
    return;
  }
  devices.forEach((d) => {
    const row = document.createElement('div');
    row.className = 'device-item';

    const iconField = createIconField({
      initialValue: d.icon || '',
      // Se guarda solo al elegir uno nuevo (sin boton "Guardar" aparte),
      // igual que "Usar" en los temas.
      onChange: async (newIcon) => {
        await api(`/api/devices/${d.id}`, { method: 'PATCH', body: JSON.stringify({ icon: newIcon || null }) });
      },
    });

    const nameSpan = document.createElement('span');
    nameSpan.className = 'device-item-name';
    nameSpan.textContent = d.name;

    const actions = document.createElement('div');
    actions.className = 'device-item-actions';
    actions.innerHTML = `
      <button type="button" data-action="rename" class="secondary-btn">Editar</button>
      <button type="button" data-action="revoke" class="danger-btn">Revocar</button>
    `;

    row.appendChild(iconField.element);
    row.appendChild(nameSpan);
    row.appendChild(actions);

    actions.querySelector('[data-action="revoke"]').addEventListener('click', async () => {
      await api(`/api/devices/${d.id}`, { method: 'DELETE' });
      refreshDevicesTab();
    });

    actions.querySelector('[data-action="rename"]').addEventListener('click', () => {
      nameSpan.replaceWith((() => {
        const wrap = document.createElement('span');
        wrap.style.display = 'flex';
        wrap.style.flex = '1';
        wrap.style.gap = '0.4rem';
        wrap.innerHTML = `
          <input type="text" class="device-rename-input" value="${escapeHtml(d.name)}" />
          <button type="button" data-action="save" class="primary-btn">Guardar</button>
          <button type="button" data-action="cancel" class="secondary-btn">Cancelar</button>
        `;
        const input = wrap.querySelector('input');
        setTimeout(() => { input.focus(); input.select(); }, 0);

        wrap.querySelector('[data-action="cancel"]').addEventListener('click', () => renderDevicesList(devices));

        const save = async () => {
          const newName = input.value.trim();
          if (!newName) return;
          await api(`/api/devices/${d.id}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
          refreshDevicesTab();
        };
        wrap.querySelector('[data-action="save"]').addEventListener('click', save);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
        return wrap;
      })());
      // Ocultamos los botones de accion mientras se edita el nombre.
      actions.classList.add('hidden');
    });

    list.appendChild(row);
  });
}

document.getElementById('btn-generate-code').addEventListener('click', async () => {
  const { code, expiresAt } = await api('/api/devices/pairing-code', { method: 'POST' });
  document.getElementById('pairing-code-value').textContent = code;
  document.getElementById('pairing-code-display').classList.remove('hidden');

  clearInterval(pairingCountdownTimer);
  const update = () => {
    const secondsLeft = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    document.getElementById('pairing-code-countdown').textContent =
      secondsLeft > 0 ? `Caduca en ${secondsLeft}s` : 'Codigo caducado, genera otro.';
    if (secondsLeft <= 0) clearInterval(pairingCountdownTimer);
  };
  update();
  pairingCountdownTimer = setInterval(update, 1000);
});

// ---------------------------------------------------------------------
// "Este dispositivo": ajustes locales, no compartidos con nadie mas
// ---------------------------------------------------------------------
function refreshMobileTab() {
  const checkbox = document.getElementById('setting-notifications');
  const status = document.getElementById('notifications-status');
  const supported = 'Notification' in window;
  const enabledPref = localStorage.getItem('notificationsEnabled') !== 'false';

  checkbox.disabled = !supported;
  checkbox.checked = supported && enabledPref && Notification.permission === 'granted';

  if (!supported) status.textContent = 'Este navegador no admite notificaciones.';
  else if (Notification.permission === 'denied') status.textContent = 'Estan bloqueadas en el navegador; cambialo en los ajustes del sitio para activarlas.';
  else status.textContent = '';

  document.getElementById('setting-update-check').checked =
    localStorage.getItem('updateCheckEnabled') !== 'false';

  refreshCompletedTasksDisplayOptions();
  refreshSyncStatusUI();
  refreshGymWeightUnitOptions();
  refreshScanServerStatus();
}

// ---------------------------------------------------------------------
// "Escanear ordenador" (fase "multi-red"): un movil ya vinculado escanea
// el QR que el ordenador muestra en Configuración → Dispositivos para
// guardar su IP actual (localStorage.serverBaseUrl, ver getServerBaseUrl()
// en app.js) sin tocar el origen de la propia app -- eso es lo que deja
// los datos guardados intactos aunque cambie de wifi o de ordenador.
// ---------------------------------------------------------------------
let scanServerStream = null;
let scanServerRafId = null;

function refreshScanServerStatus() {
  const el = document.getElementById('scan-server-status');
  if (!el) return;
  const override = localStorage.getItem('serverBaseUrl');
  el.textContent = override
    ? `Sincronizando con: ${override}`
    : 'Usando la dirección con la que se abrió esta app.';
}

async function openScanServerModal() {
  const modal = document.getElementById('scan-server-modal');
  const video = document.getElementById('scan-server-video');
  const modalStatus = document.getElementById('scan-server-modal-status');
  modalStatus.textContent = '';
  modal.classList.remove('hidden');

  if (!window.jsQR) {
    modalStatus.textContent = 'No se pudo cargar el lector de QR.';
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    modalStatus.textContent = 'Este navegador no permite usar la cámara aquí.';
    return;
  }

  try {
    scanServerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (err) {
    modalStatus.textContent = 'No se pudo acceder a la cámara: ' + err.message;
    return;
  }
  video.srcObject = scanServerStream;
  await video.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const tick = () => {
    if (!scanServerStream) return; // el modal se cerro entre un frame y el siguiente
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        handleScannedServerUrl(code.data);
        return;
      }
    }
    scanServerRafId = requestAnimationFrame(tick);
  };
  scanServerRafId = requestAnimationFrame(tick);
}

function closeScanServerModal() {
  document.getElementById('scan-server-modal').classList.add('hidden');
  if (scanServerRafId) cancelAnimationFrame(scanServerRafId);
  scanServerRafId = null;
  if (scanServerStream) {
    scanServerStream.getTracks().forEach((t) => t.stop());
    scanServerStream = null;
  }
}

function handleScannedServerUrl(text) {
  let parsed;
  try {
    parsed = new URL(text);
  } catch (err) {
    document.getElementById('scan-server-modal-status').textContent = 'Ese código no tiene una dirección válida.';
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    document.getElementById('scan-server-modal-status').textContent = 'Ese código no tiene una dirección válida.';
    return;
  }

  localStorage.setItem('serverBaseUrl', parsed.origin);
  closeScanServerModal();
  refreshScanServerStatus();
  document.getElementById('scan-server-status').textContent = `Conectando con ${parsed.origin}...`;
  runSync().finally(refreshScanServerStatus);
}

document.getElementById('btn-scan-server').addEventListener('click', openScanServerModal);
document.getElementById('btn-close-scan-server').addEventListener('click', closeScanServerModal);

// "Salir de la aplicacion": vive como accion directa en la lista principal
// de Configuracion (no dentro de una sub-seccion), asi que se refresca al
// abrir el panel entero (ver openSettingsModal), no al entrar en una
// pestana concreta. window.electronAPI solo existe si esto corre dentro
// de la app de escritorio (lo expone electron/preload.js) — en el
// navegador normal (o desde el movil) el boton se queda oculto, porque
// "salir" no significa nada ahi.
function refreshQuitMenuItem() {
  document.getElementById('btn-quit-app').classList.toggle('hidden', !window.electronAPI);
}

document.getElementById('btn-quit-app').addEventListener('click', () => {
  if (window.electronAPI) window.electronAPI.quitApp();
});

// Tachar vs ocultar tareas completadas: preferencia de ESTE dispositivo
// (como el modo de vista o el tema), no compartida — cada movil/ordenador
// puede verlo a su manera. La lee renderTasksList() en app.js.
const COMPLETED_TASKS_DISPLAY_MODES = [
  { id: 'strike', label: 'Tachadas (siguen en la lista)' },
  { id: 'hide', label: 'Ocultas' },
];

function getCompletedTasksDisplayMode() {
  return localStorage.getItem('completedTasksDisplay') || 'strike';
}

function refreshCompletedTasksDisplayOptions() {
  const container = document.getElementById('completed-tasks-display-options');
  if (!container) return;
  container.innerHTML = '';
  const current = getCompletedTasksDisplayMode();

  COMPLETED_TASKS_DISPLAY_MODES.forEach((mode) => {
    const isActive = mode.id === current;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'view-mode-btn' + (isActive ? ' active' : '');
    // Aqui NO se anade "(actual)" al texto — el resaltado de color ya deja
    // claro cual esta activa, y repetirlo con texto era redundante.
    btn.textContent = mode.label;
    if (isActive) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        localStorage.setItem('completedTasksDisplay', mode.id);
        refreshCompletedTasksDisplayOptions();
        if (typeof renderTasksList === 'function') renderTasksList();
      });
    }
    container.appendChild(btn);
  });
}

// Unidad de peso de Gimnasio: preferencia de ESTE dispositivo, mismo
// patron que arriba. getGymWeightUnit() (definida en app.js, que se
// carga antes que este archivo) es quien de verdad lee/usa el valor al
// mostrar/guardar pesos -- aqui solo esta el interruptor visual.
const GYM_WEIGHT_UNIT_MODES = [
  { id: 'kg', label: 'Kilogramos (kg)' },
  { id: 'lb', label: 'Libras (lb)' },
];

function refreshGymWeightUnitOptions() {
  const container = document.getElementById('gym-weight-unit-options');
  if (!container) return;
  container.innerHTML = '';
  const current = getGymWeightUnit();

  GYM_WEIGHT_UNIT_MODES.forEach((mode) => {
    const isActive = mode.id === current;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'view-mode-btn' + (isActive ? ' active' : '');
    btn.textContent = mode.label;
    if (isActive) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        localStorage.setItem('gymWeightUnit', mode.id);
        refreshGymWeightUnitOptions();
      });
    }
    container.appendChild(btn);
  });
}

document.getElementById('setting-update-check').addEventListener('change', (e) => {
  localStorage.setItem('updateCheckEnabled', e.target.checked ? 'true' : 'false');
});

// Convierte la clave publica VAPID (texto base64url que da el servidor)
// al formato Uint8Array que pide pushManager.subscribe() -- conversion
// estandar del protocolo Web Push, no hay atajo mas corto.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Suscribe ESTE dispositivo a notificaciones push de verdad (avisan con
// la app cerrada del todo, ver public/sw.js y server/reminderChecker.js)
// y manda la suscripcion resultante al servidor. Lanza si algo falla
// (falta el correo de contacto en el perfil, el navegador no admite
// push...) con un mensaje ya pensado para ensenarse tal cual.
async function subscribeToPush() {
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/api/devices/push-public-key');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api('/api/devices/push-subscription', { method: 'POST', body: JSON.stringify({ subscription }) });
}

async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  await api('/api/devices/push-subscription', { method: 'DELETE' }).catch(() => {});
}

document.getElementById('setting-notifications').addEventListener('change', async (e) => {
  let pushErrorMessage = '';

  if (e.target.checked) {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      e.target.checked = false;
      refreshMobileTab();
      return;
    }
    localStorage.setItem('notificationsEnabled', 'true');

    // El aviso push de verdad (con la app cerrada) solo tiene sentido en
    // un movil emparejado -- el ordenador ya recibe su aviso directamente
    // del propio servidor (node-notifier), sin pasar por Google/Apple.
    const isPairedDevice = !!localStorage.getItem('deviceToken');
    if (isPairedDevice && 'serviceWorker' in navigator && 'PushManager' in window) {
      try {
        await subscribeToPush();
      } catch (err) {
        pushErrorMessage = err.message || 'No se pudo activar el aviso push en este dispositivo.';
      }
    }
  } else {
    localStorage.setItem('notificationsEnabled', 'false');
    if (localStorage.getItem('deviceToken')) await unsubscribeFromPush();
  }

  // refreshMobileTab() pisa el texto de estado con el mensaje generico de
  // siempre -- si hubo un fallo especifico del push, se ensena DESPUES,
  // para que no se pierda.
  refreshMobileTab();
  if (pushErrorMessage) document.getElementById('notifications-status').textContent = pushErrorMessage;
});

// ---------------------------------------------------------------------
// Atajos de teclado: la lista de acciones (SHORTCUT_ACTIONS) y el
// guardado (getShortcutMap/addShortcut/removeShortcut) viven en app.js,
// que se carga antes que este archivo; aqui solo esta el dibujado de la
// lista y el "modo grabacion" para capturar la siguiente tecla que
// pulses. Cada accion puede tener VARIAS combinaciones a la vez (se
// muestran como chips con una x cada una), no solo una.
// ---------------------------------------------------------------------
function startRecordingShortcut(actionId, addBtn) {
  const originalText = addBtn.textContent;
  addBtn.textContent = 'Pulsa una tecla…';
  addBtn.classList.add('recording');
  addBtn.disabled = true;

  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      // Esc siempre cancela la grabacion (no se puede asignar Esc solo:
      // ya tiene su propio significado fijo de "salir").
      document.removeEventListener('keydown', handler, true);
      renderShortcutsList();
      return;
    }

    const combo = comboFromEvent(e);
    if (!combo) return; // solo se ha soltado una tecla modificadora, seguimos esperando

    addShortcut(actionId, combo);
    document.removeEventListener('keydown', handler, true);
    renderShortcutsList();
  };

  document.addEventListener('keydown', handler, true);
}

function renderShortcutsList() {
  const container = document.getElementById('shortcuts-list');
  container.innerHTML = '';
  const map = getShortcutMap();

  SHORTCUT_ACTIONS.forEach((action) => {
    const row = document.createElement('div');
    row.className = 'shortcut-row';

    const label = document.createElement('span');
    label.className = 'shortcut-label';
    label.textContent = action.label;

    const combos = document.createElement('div');
    combos.className = 'shortcut-combos';

    const activeCombos = map[action.id] || [];
    if (activeCombos.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'shortcut-empty-hint';
      hint.textContent = 'Sin atajo';
      combos.appendChild(hint);
    } else {
      activeCombos.forEach((combo) => {
        const chip = document.createElement('span');
        chip.className = 'shortcut-combo-chip';

        const chipLabel = document.createElement('span');
        chipLabel.textContent = displayCombo(combo);
        chip.appendChild(chipLabel);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'shortcut-combo-remove';
        removeBtn.textContent = '✕';
        removeBtn.setAttribute('aria-label', `Quitar atajo ${displayCombo(combo)}`);
        removeBtn.addEventListener('click', () => {
          removeShortcut(action.id, combo);
          renderShortcutsList();
        });
        chip.appendChild(removeBtn);

        combos.appendChild(chip);
      });
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'shortcut-add-btn';
    addBtn.textContent = '+ Añadir';
    addBtn.addEventListener('click', () => startRecordingShortcut(action.id, addBtn));
    combos.appendChild(addBtn);

    row.appendChild(label);
    row.appendChild(combos);
    container.appendChild(row);
  });
}

function refreshShortcutsTab() {
  renderShortcutsList();
}


// ---------------------------------------------------------------------
// Esc: hace lo mismo que cerrar / clicar fuera, capa a capa — primero lo
// que este mas "encima" (un popover), y solo al final el modal entero de
// Configuracion. Si estas dentro de una seccion (Estilo, Grupos...), Esc
// te lleva al menu, igual que el boton "Volver"; una segunda pulsada ya
// cierra el panel.
// ---------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;

  const mobileFabMenu = document.getElementById('mobile-fab-menu');
  if (mobileFabMenu && !mobileFabMenu.classList.contains('hidden')) {
    toggleMobileFabMenu(false);
    return;
  }

  const scanServerModal = document.getElementById('scan-server-modal');
  if (scanServerModal && !scanServerModal.classList.contains('hidden')) {
    closeScanServerModal();
    return;
  }

  const openPopover = document.querySelector('.color-popover:not(.hidden), .icon-popover:not(.hidden), .select-popover:not(.hidden), .date-popover:not(.hidden)');
  if (openPopover) {
    closeAllPopovers();
    return;
  }

  const themeForm = document.getElementById('theme-form');
  if (themeForm && !themeForm.classList.contains('hidden')) {
    closeThemeForm();
    return;
  }

  const eventModal = document.getElementById('event-modal');
  if (eventModal && !eventModal.classList.contains('hidden')) {
    closeEventModal();
    return;
  }

  const taskModal = document.getElementById('task-modal');
  if (taskModal && !taskModal.classList.contains('hidden')) {
    closeTaskModal();
    return;
  }

  const noteEditorView = document.getElementById('note-editor-view');
  if (noteEditorView && !noteEditorView.classList.contains('hidden')) {
    closeNoteEditorView();
    return;
  }

  const noteFolderModal = document.getElementById('note-folder-modal');
  if (noteFolderModal && !noteFolderModal.classList.contains('hidden')) {
    closeNoteFolderModal();
    return;
  }

  const mySpaceView = document.getElementById('my-space-view');
  if (mySpaceView && !mySpaceView.classList.contains('hidden')) {
    const hub = document.getElementById('my-space-hub');
    if (hub && hub.dataset.expanded) {
      document.getElementById('my-space-back-btn').click();
    } else {
      document.getElementById('btn-close-my-space').click();
    }
    return;
  }

  // Extensiones: cada una es pantalla completa igual que "Mi espacio", asi
  // que Esc capa a capa igual -- primero la sub-navegacion de dentro (solo
  // Lecturas la tiene: saga -> detalle de esa saga), luego la extension
  // entera vuelve a la rejilla de Extensiones, y la rejilla vuelve a Home.
  const gymView = document.getElementById('gym-view');
  if (gymView && !gymView.classList.contains('hidden')) {
    document.getElementById('btn-close-gym').click();
    return;
  }

  const finanzasView = document.getElementById('finanzas-view');
  if (finanzasView && !finanzasView.classList.contains('hidden')) {
    document.getElementById('btn-close-finanzas').click();
    return;
  }

  const lecturasView = document.getElementById('lecturas-view');
  if (lecturasView && !lecturasView.classList.contains('hidden')) {
    const sagaDetailPanel = document.getElementById('lecturas-saga-detail-panel');
    if (sagaDetailPanel && !sagaDetailPanel.classList.contains('hidden')) {
      document.getElementById('btn-back-lecturas-sagas').click();
    } else {
      document.getElementById('btn-close-lecturas').click();
    }
    return;
  }

  const extensionsView = document.getElementById('extensions-view');
  if (extensionsView && !extensionsView.classList.contains('hidden')) {
    document.getElementById('btn-close-extensions').click();
    return;
  }

  if (typeof state !== 'undefined' && state.remindersMode === 'day') {
    showUpcomingReminders();
    return;
  }

  const settingsModal = document.getElementById('settings-modal');
  if (settingsModal && !settingsModal.classList.contains('hidden')) {
    const settingsMenu = document.getElementById('settings-menu');
    if (settingsMenu && settingsMenu.classList.contains('hidden')) {
      showSettingsScreen(null);
    } else {
      document.getElementById('btn-close-settings').click();
    }
  }
});
