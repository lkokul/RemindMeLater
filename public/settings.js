// settings.js — todo lo relacionado con el panel de Configuracion:
// temas de estilo, grupos y dispositivos (estos dos ultimos vivian antes
// en app.js, se han movido aqui al juntarlos en un solo panel). Se carga
// como un <script> normal despues de app.js, y comparte con el su mismo
// ambito global: usa cosas ya definidas alli como `api()`, `escapeHtml()`,
// `state`, `loadMonth()`, `loadReminders()`, `loadGroups()` y
// `populateEventGroupSelect()`.

// ---------------------------------------------------------------------
// Posicionamiento compartido de popovers "flotantes": los usan tanto el
// selector de color como el de icono. Van colgados de <body> con
// position:fixed (no dentro de la tarjeta del modal) para que el
// "overflow-y: auto" del modal no los recorte cuando estan cerca del
// borde o hay que hacer scroll; su sitio se calcula aqui, en coordenadas
// de ventana, a partir de donde este el boton que los abre.
// ---------------------------------------------------------------------
function positionFixedPopover(anchorBtn, popover, { width = 248, estimatedHeight = 320 } = {}) {
  const rect = anchorBtn.getBoundingClientRect();
  let left = rect.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  popover.style.left = `${Math.max(8, left)}px`;

  const top = rect.bottom + 6 + estimatedHeight > window.innerHeight
    ? Math.max(8, rect.top - estimatedHeight - 6)
    : rect.bottom + 6;
  popover.style.top = `${top}px`;
}

function closeAllPopovers(except) {
  document.querySelectorAll('.color-popover, .icon-popover').forEach((el) => {
    if (el !== except) el.classList.add('hidden');
  });
}

// Cierra cualquier popover abierto al hacer click fuera de el (uno solo
// para color e icono, asi no hay que repetir esta logica en cada widget).
document.addEventListener('click', (e) => {
  if (e.target.closest('.color-popover, .icon-popover, .color-swatch-btn, .icon-swatch-btn')) return;
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
const SETTINGS_TABS = ['style', 'groups', 'devices', 'mobile'];

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
    if (tab === 'style') refreshStyleTab();
    else if (tab === 'groups') refreshGroupsTab();
    else if (tab === 'devices') refreshDevicesTab();
    else if (tab === 'mobile') refreshMobileTab();
  });
});

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => showSettingsScreen(null));
});

function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
  closeThemeForm();
  showSettingsScreen(null);
}

document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
document.getElementById('btn-close-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.add('hidden');
  clearInterval(pairingCountdownTimer);
});

// ---------------------------------------------------------------------
// Estilo: biblioteca de temas compartida + cual tengo activo YO
// ---------------------------------------------------------------------
const THEME_COLOR_FIELDS_META = [
  { key: 'bg', cssVar: '--bg', label: 'Fondo general' },
  { key: 'surface', cssVar: '--surface', label: 'Fondo de tarjetas' },
  { key: 'surface2', cssVar: '--surface-2', label: 'Fondo de campos y botones' },
  { key: 'border', cssVar: '--border', label: 'Bordes' },
  { key: 'text', cssVar: '--text', label: 'Texto principal' },
  { key: 'textDim', cssVar: '--text-dim', label: 'Texto secundario' },
  { key: 'accent', cssVar: '--accent', label: 'Acento (botones, hoy)' },
  { key: 'danger', cssVar: '--danger', label: 'Aviso (eliminar)' },
  { key: 'settingsMenuBg', cssVar: '--settings-menu-bg', label: 'Fondo del menú de Configuración' },
];

let themeLibrary = [];
const themeColorFields = {};

function buildThemeColorGrid() {
  const grid = document.getElementById('theme-color-grid');
  grid.innerHTML = '';
  THEME_COLOR_FIELDS_META.forEach(({ key, label }) => {
    const item = document.createElement('div');
    item.className = 'theme-color-item';
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const field = createColorField({ initialValue: '#5b8cff' });
    themeColorFields[key] = field;
    item.appendChild(labelEl);
    item.appendChild(field.element);
    grid.appendChild(item);
  });
}
buildThemeColorGrid();

// Aplica un juego de colores a la pagina cambiando las variables CSS del
// documento (ver :root en styles.css). No hace falta recargar nada: los
// estilos que usan var(--bg), var(--accent)... se actualizan al momento.
function applyThemeColors(colors) {
  const root = document.documentElement;
  THEME_COLOR_FIELDS_META.forEach(({ key, cssVar }) => {
    if (colors[key]) root.style.setProperty(cssVar, colors[key]);
  });
}

// Aplica un tema a ESTE dispositivo: lo pinta, lo recuerda en localStorage
// (para la proxima vez que se abra, y para el script del <head> que evita
// el parpadeo) y, si procede, avisa al servidor de que este dispositivo
// tiene ese tema activo (para que "copiar de otro dispositivo" funcione).
async function applyTheme(theme, { persist = true } = {}) {
  applyThemeColors(theme.colors);
  localStorage.setItem('activeThemeId', String(theme.id));
  localStorage.setItem('activeThemeColors', JSON.stringify(theme.colors));
  renderThemeLibrary();

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

async function refreshStyleTab() {
  themeLibrary = await api('/api/themes');
  renderThemeLibrary();
  await refreshThemeCopyList();
}

function renderThemeLibrary() {
  const container = document.getElementById('theme-library');
  container.innerHTML = '';
  const activeId = Number(localStorage.getItem('activeThemeId')) || null;

  if (themeLibrary.length === 0) {
    container.innerHTML = '<p class="empty-hint">Todavia no hay temas guardados.</p>';
    return;
  }

  themeLibrary.forEach((theme) => {
    const isActive = theme.id === activeId;
    const card = document.createElement('div');
    card.className = 'theme-card' + (isActive ? ' active' : '');
    const useButtonHtml = isActive
      ? '<button type="button" class="use-btn-disabled" disabled>En uso</button>'
      : '<button type="button" data-action="use" class="primary-btn">Usar</button>';
    card.innerHTML = `
      <div class="theme-card-preview">
        <span class="color-dot" style="background-color:${theme.colors.bg}"></span>
        <span class="color-dot" style="background-color:${theme.colors.surface}"></span>
        <span class="color-dot" style="background-color:${theme.colors.accent}"></span>
        <span class="color-dot" style="background-color:${theme.colors.danger}"></span>
      </div>
      <div class="theme-card-name">${escapeHtml(theme.name)}</div>
      <div class="theme-card-actions">
        ${useButtonHtml}
        <button type="button" data-action="edit" class="secondary-btn">Editar</button>
        <button type="button" data-action="export" class="secondary-btn">Exportar</button>
      </div>
    `;
    const useBtn = card.querySelector('[data-action="use"]');
    if (useBtn) useBtn.addEventListener('click', () => applyTheme(theme));
    card.querySelector('[data-action="edit"]').addEventListener('click', () => openThemeForm(theme));
    card.querySelector('[data-action="export"]').addEventListener('click', () => exportTheme(theme));
    container.appendChild(card);
  });
}

function openThemeForm(theme) {
  document.getElementById('theme-id').value = theme ? theme.id : '';
  document.getElementById('theme-name').value = theme ? theme.name : '';

  // Un tema nuevo arranca con los colores que se ven AHORA MISMO en
  // pantalla (el tema activo), asi es mas facil partir de algo y tocar
  // solo lo que se quiera cambiar, en vez de empezar en blanco.
  const computed = getComputedStyle(document.documentElement);
  THEME_COLOR_FIELDS_META.forEach(({ key, cssVar }) => {
    const value = theme ? theme.colors[key] : computed.getPropertyValue(cssVar).trim();
    themeColorFields[key].setValue(value || '#5b8cff');
  });

  document.getElementById('btn-delete-theme').classList.toggle('hidden', !theme);
  document.getElementById('theme-form').classList.remove('hidden');
  document.getElementById('theme-name').focus();
}

function closeThemeForm() {
  document.getElementById('theme-form').classList.add('hidden');
}

document.getElementById('btn-new-theme').addEventListener('click', () => openThemeForm(null));
document.getElementById('btn-cancel-theme').addEventListener('click', closeThemeForm);

document.getElementById('theme-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('theme-id').value;
  const colors = {};
  THEME_COLOR_FIELDS_META.forEach(({ key }) => {
    colors[key] = themeColorFields[key].getValue();
  });
  const payload = { name: document.getElementById('theme-name').value, colors };

  const saved = id
    ? await api(`/api/themes/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
    : await api('/api/themes', { method: 'POST', body: JSON.stringify(payload) });

  closeThemeForm();
  await refreshStyleTab();

  // Si el tema que acabamos de guardar es el que tenemos activo, refresca
  // los colores en pantalla al momento (por si edito el que esta usando).
  if (Number(localStorage.getItem('activeThemeId')) === saved.id) applyTheme(saved, { persist: false });
});

document.getElementById('btn-delete-theme').addEventListener('click', async () => {
  const id = document.getElementById('theme-id').value;
  if (!id) return;
  if (!confirm('¿Eliminar este tema? Los dispositivos que lo tuvieran activo se quedaran sin tema.')) return;
  await api(`/api/themes/${id}`, { method: 'DELETE' });
  closeThemeForm();
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
  const blob = new Blob([JSON.stringify({ name: theme.name, colors: theme.colors }, null, 2)], {
    type: 'application/json',
  });
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
      body: JSON.stringify({ name: parsed.name || 'Tema importado', colors: parsed.colors }),
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

const groupColorField = createColorField({ initialValue: DEFAULT_EVENT_COLOR });
document.getElementById('group-color-field').appendChild(groupColorField.element);

async function refreshGroupsTab() {
  await loadGroups();
  renderGroupsList();
}

function resetGroupForm() {
  document.getElementById('group-id').value = '';
  document.getElementById('group-name').value = '';
  groupIconField.setValue('');
  groupColorField.setValue(DEFAULT_EVENT_COLOR);
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
      document.getElementById('btn-cancel-group').classList.remove('hidden');
      document.getElementById('group-name').focus();
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el grupo "${g.name}"? Los eventos que lo usen se quedaran sin grupo.`)) return;
      await api(`/api/groups/${g.id}`, { method: 'DELETE' });
      await refreshGroupsTab();
      loadMonth();
      loadReminders();
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
  } catch (err) {
    // 403: este dispositivo no es el ordenador de confianza.
    document.getElementById('devices-only-computer').classList.remove('hidden');
    document.getElementById('devices-management').classList.add('hidden');
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
}

document.getElementById('setting-notifications').addEventListener('change', async (e) => {
  if (e.target.checked) {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      localStorage.setItem('notificationsEnabled', 'true');
    } else {
      e.target.checked = false;
    }
  } else {
    localStorage.setItem('notificationsEnabled', 'false');
  }
  refreshMobileTab();
});
