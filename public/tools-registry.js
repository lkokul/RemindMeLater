// tools-registry.js — el registro central de herramientas de la app.
//
// UN solo archivo que describe cada herramienta (nombre, icono, versión,
// novedades, guía, y qué tablas/carpetas de datos le pertenecen), usado
// por LOS DOS mundos a la vez sin duplicarlo:
//   - En el navegador se carga como <script> normal ANTES de app.js (ver
//     index.html) y deja la constante global TOOLS_REGISTRY, que app.js
//     usa para pintar la Tienda y para ocultar/mostrar herramientas.
//   - En el servidor se puede hacer require('../public/tools-registry.js')
//     gracias al bloque de module.exports del final — las rutas de copia
//     de seguridad y borrado de datos (fases siguientes) leerán de aquí
//     qué tablas tocar, en vez de repetir la lista en otro sitio.
//
// Para añadir una herramienta nueva en el futuro: se añade UNA entrada a
// este array (con su tarjeta en #extensions-view, id "btn-open-<id>") y
// la Tienda, el ocultar/mostrar y las fases de backup/borrado la recogen
// solos — está hecho a propósito sin ningún número fijo en el código,
// igual que REMINDERS_PANEL_PAGES (ver CLAUDE.md).
//
// Campos de cada entrada:
//   id          — identificador interno. Coincide EXACTAMENTE con el
//                 nombre de pantalla que guarda setCurrentScreen() en
//                 app.js ('gym', 'finanzas'...) y con el sufijo del botón
//                 del hub ('btn-open-gym'); si se cambia uno hay que
//                 cambiar los tres a la vez.
//   nombre      — el nombre visible. Renombrar una herramienta de cara al
//                 usuario (p. ej. Lecturas → Entretenimiento) es cambiar
//                 SOLO esta línea; el id interno no se toca (está metido
//                 en ids de HTML y en localStorage de los dispositivos).
//   core        — true = parte base de la app (calendario + Mi espacio):
//                 no se puede ocultar ni borrar, la Tienda la enseña como
//                 "App base".
//   icono       — el SVG de su tarjeta del hub, para reutilizarlo en la
//                 ficha de la Tienda (mismo trazo, sin emojis).
//   version     — versión PROPIA de la herramienta (independiente de la
//                 versión de la app en package.json). Se sube a mano
//                 cuando una ronda de trabajo toca esa herramienta.
//   changelog   — novedades de la herramienta, de más nueva a más vieja:
//                 [{ version, fecha ('AAAA-MM'), notas: [frases] }].
//   guia        — párrafos de texto plano (la Tienda los pinta como <p>,
//                 sin markdown ni HTML — así no hace falta sanear nada).
//   tablas      — tablas SQL de la herramienta EN ORDEN padres → hijos
//                 (una tabla siempre después de las que referencia). Las
//                 fases de backup/restauración/borrado dependen de este
//                 orden: restaurar recorre el array tal cual (los padres
//                 tienen que existir antes que sus hijas) y borrar lo
//                 recorre AL REVÉS. Si algún día se añade una tabla aquí,
//                 colocarla después de todas las que referencia.
//   singletons  — tablas de fila única/config (se tratan distinto al
//                 restaurar: no se pisan si ya tienen valores).
//   carpetas    — subcarpetas de DATA_DIR con archivos binarios de la
//                 herramienta (fotos, imágenes), para backup/borrado.
//   dependencias— ids de otras herramientas con las que tiene enlaces de
//                 datos reales (hoy solo Viajes → Finanzas).
const TOOLS_REGISTRY = [
  {
    id: 'calendario',
    nombre: 'Calendario y Mi espacio',
    core: true,
    icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
    version: '1.0.0',
    changelog: [
      {
        version: '1.0.0',
        fecha: '2026-09',
        notas: [
          'Primera versión con ficha propia en la Tienda.',
          'Incluye todo lo construido hasta ahora: calendario con grupos y días especiales, recordatorios, tareas, y notas con formato, tablas e imágenes organizadas en carpetas.',
        ],
      },
    ],
    guia: [
      'Es la base de la app: el calendario con sus eventos, grupos y recordatorios, más "Mi espacio" (Recordatorios, Tareas y Notas juntos).',
      'Las tareas son eventos sin fecha obligatoria con su propia casilla de completado; en el calendario se ven con el borde del color del grupo en vez del relleno.',
      'Las notas admiten negrita, cursiva, listas, tablas e imágenes (botón o Ctrl+V), y se organizan en carpetas anidadas con favoritos. Se pueden ocultar tras una contraseña compartida opcional.',
      'Al ser la parte base, no se puede ocultar ni borrar desde la Tienda.',
    ],
    tablas: ['groups', 'events', 'note_folders', 'notes', 'special_days', 'themes'],
    singletons: ['user_profile'],
    carpetas: ['note-images'],
    dependencias: [],
  },
  {
    id: 'gym',
    nombre: 'Gimnasio',
    core: false,
    icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="3" height="6" rx="1"></rect><rect x="19" y="9" width="3" height="6" rx="1"></rect><line x1="5" y1="12" x2="19" y2="12"></line><rect x="6.5" y="7" width="2" height="10" rx="1"></rect><rect x="15.5" y="7" width="2" height="10" rx="1"></rect></svg>',
    version: '1.0.0',
    changelog: [
      {
        version: '1.0.0',
        fecha: '2026-09',
        notas: [
          'Primera versión con ficha propia en la Tienda.',
          'Incluye: ejercicios con grupo muscular, rutinas reutilizables, sesiones con series/repeticiones/peso, y progreso con gráficas de peso máximo y volumen.',
        ],
      },
    ],
    guia: [
      'Registro de entrenamientos: creas tus ejercicios una vez, los agrupas en rutinas reutilizables, y cada día apuntas la sesión con sus series, repeticiones y peso.',
      'La pestaña Progreso dibuja la evolución de cada ejercicio (peso máximo o volumen total) a lo largo del tiempo.',
      'La unidad de peso (kg/lb) se elige por dispositivo en Configuración > Este dispositivo; por dentro siempre se guarda en kilogramos.',
    ],
    tablas: ['gym_exercises', 'gym_routines', 'gym_routine_exercises', 'gym_sessions', 'gym_sets'],
    singletons: [],
    carpetas: [],
    dependencias: [],
  },
  {
    id: 'finanzas',
    nombre: 'Finanzas',
    core: false,
    icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v10M9.5 9.5c0-1.5 1.2-2 2.5-2s2.5.6 2.5 2c0 1.2-1 1.6-2.5 2.2S9.5 13 9.5 14.3c0 1.4 1.1 2.2 2.5 2.2s2.5-.6 2.5-2"></path></svg>',
    version: '1.0.0',
    changelog: [
      {
        version: '1.0.0',
        fecha: '2026-09',
        notas: [
          'Primera versión con ficha propia en la Tienda.',
          'Incluye: cuentas con saldo siempre calculado, categorías, límite mensual y objetivo de ahorro, inversiones, carteras y activos con valoración manual, gastos fijos auto-generados y deudas.',
        ],
      },
    ],
    guia: [
      'Control de dinero: cuentas, movimientos con categoría, y un resumen mensual con límite de gasto y objetivo de ahorro (con vista histórica).',
      'El saldo de una cuenta nunca se guarda: se calcula siempre a partir de sus movimientos, así no puede descuadrarse.',
      'Las carteras agrupan activos (acciones, cripto, lo que sea) con valoración manual de precio y gráfica de evolución. Los gastos fijos son plantillas que generan su movimiento real automáticamente cuando toca.',
      'Un viaje de la herramienta Viajes puede enlazar sus tickets como movimientos reales de aquí — ver la guía de Viajes.',
    ],
    tablas: [
      'finanzas_accounts',
      'finanzas_categories',
      'finanzas_transactions',
      'finanzas_recurring_expenses',
      'finanzas_investment_transactions',
      'finanzas_portfolios',
      'finanzas_assets',
      'finanzas_asset_valuations',
      'finanzas_debts',
    ],
    singletons: ['finanzas_settings'],
    carpetas: [],
    dependencias: [],
  },
  {
    id: 'lecturas',
    nombre: 'Lecturas',
    core: false,
    icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5c2-1 5-1 8 1 3-2 6-2 8-1v13c-2-1-5-1-8 1-3-2-6-2-8-1z"></path><path d="M12 6v13"></path></svg>',
    version: '1.0.0',
    changelog: [
      {
        version: '1.0.0',
        fecha: '2026-09',
        notas: [
          'Primera versión con ficha propia en la Tienda.',
          'Incluye: sagas con items de cualquier tipo (manga, cómic, libro, serie, anime, película) y géneros de texto libre con sugerencias.',
        ],
      },
    ],
    guia: [
      'Historial de entretenimiento organizado en sagas: dentro de una misma saga caben un manga, su anime y su película, cada uno con su propio seguimiento.',
      'Los géneros son texto libre con sugerencias sacadas de lo que ya has escrito antes — sin listas cerradas.',
    ],
    tablas: ['lecturas_sagas', 'lecturas_items'],
    singletons: [],
    carpetas: [],
    dependencias: [],
  },
  {
    id: 'viajes',
    nombre: 'Viajes',
    core: false,
    icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
    version: '1.0.0',
    changelog: [
      {
        version: '1.0.0',
        fecha: '2026-09',
        notas: [
          'Primera versión con ficha propia en la Tienda.',
          'Incluye: viajes por países con mapa interactivo, bitácora con fotos, y tickets enlazables a Finanzas cuando el viaje lo tiene activado.',
        ],
      },
    ],
    guia: [
      'Cada viaje tiene sus países (pintados en el mapa), su bitácora de entradas con fotos, y sus movimientos de dinero.',
      'Si activas "enlazar con Finanzas" en un viaje, cada gasto que apuntes ahí se convierte además en un movimiento real de Finanzas contra la cuenta que elijas. Los tickets ya apuntados se pueden enlazar después a mano, uno a uno.',
      'Al borrar cosas de una de las dos herramientas, la otra conserva siempre lo suyo: solo se rompe el enlace, nunca se pierde la foto, el importe o la transacción del otro lado.',
    ],
    tablas: ['viajes_trips', 'viajes_trip_countries', 'viajes_entries', 'viajes_entry_attachments', 'viajes_entry_movements'],
    singletons: [],
    carpetas: ['viajes-photos'],
    dependencias: ['finanzas'],
  },
  {
    id: 'archivos',
    nombre: 'Archivos',
    core: false,
    icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M12 18v-6M9 15l3-3 3 3"></path></svg>',
    version: '1.0.0',
    changelog: [
      {
        version: '1.0.0',
        fecha: '2026-09',
        notas: [
          'Primera versión con ficha propia en la Tienda.',
          'Incluye: transferencia de archivos móvil-ordenador con doble panel, navegación del disco desde el ordenador, doble confirmación cuando la inicia un móvil, y el botón de sincronización manual.',
        ],
      },
    ],
    guia: [
      'Mueve archivos sueltos entre el móvil y el ordenador por la wifi de casa, con dos paneles estilo explorador (el dispositivo a un lado, la carpeta del ordenador al otro).',
      'Cuando un móvil inicia un envío o una descarga, el ordenador pide confirmación antes de moverse nada — una salvaguarda contra accidentes, no una barrera de seguridad.',
      'Aquí vive también el botón "Sincronizar ahora" del calendario/notas. Si ocultas esta herramienta en un dispositivo, ese botón vuelve a Configuración > Este dispositivo para no dejarte sin sincronización.',
    ],
    // Sin tablas: su "base de datos" es la carpeta del disco que elijas
    // (app_settings.archivosFolder). Esa carpeta NO entra en las copias
    // de seguridad de la app: ya son archivos sueltos del usuario.
    tablas: [],
    singletons: [],
    carpetas: [],
    dependencias: [],
  },
];

// En Node (require desde server/) esto exporta el array; en el navegador
// no existe "module" y el if lo salta sin más, dejando solo la global.
if (typeof module !== 'undefined') module.exports = TOOLS_REGISTRY;
