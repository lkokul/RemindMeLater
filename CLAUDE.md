# RemindMeLater — notas para retomar el proyecto en otra conversación

Esto no es documentación de usuario (eso es `README.md`). Esto es un
resumen para que una conversación nueva (Cowork, Claude Code local o una
sesión de control remoto) pueda seguir donde lo dejamos sin que Koku
tenga que repetir todo el contexto.

**Quién es Koku**: no sabe JavaScript a fondo, así que las explicaciones y
los comentarios en el código van con más detalle de lo normal a propósito.
Mantén ese estilo.

**Este archivo se commitea como uno más.** Antes había una regla de "no
commitear CLAUDE.md"; Koku la quitó explícitamente — a partir de ahora se
actualiza y se commitea igual que cualquier otro archivo del repo,
siguiendo las mismas reglas de commit de abajo (o sea: cuando él lo pida,
no por tu cuenta).

## Qué es esto

Calendario, recordatorios, tareas y notas local-first. **Ahora mismo hay
DOS programas independientes conviviendo en el mismo repositorio**, y es
lo primero que hay que tener claro antes de tocar nada:

- **La app sin servidor** (rama `movil-ui`, la que se está desarrollando
  activamente): todo vive dentro de la propia app, en el dispositivo. No
  hay servidor, ni emparejamiento, ni sincronización, ni cuenta. Por
  dentro es SQLite de verdad compilado a WebAssembly (`sql.js`,
  vendorizado en `public/vendor/`), con las MISMAS rutas del backend de
  siempre portadas a `public/routes-local/`. Se empaqueta como app nativa
  de iOS/Android con Capacitor.
- **La versión de escritorio** (`server/`, `electron/`): el servidor
  Express + `node:sqlite` original. Koku la trabaja **por su cuenta en
  una rama `escritorio`** — **NO toques su código** salvo que te lo
  pida explícitamente. Al fusionar, él preguntará qué falta en cada
  lado. Aviso de un malentendido real del 8/9/2026, para no repetirlo:
  el ideario de esta conversación (`IDEAS-MOVIL-UI.md`) se subió por
  error a `escritorio` interpretando mal un "es para la rama de
  escritorio" — Koku lo corrigió: **los documentos de esta conversación
  van en `movil-ui`**, y la autorización de commit/push libre que dio
  aquí es para ESTA rama. En `escritorio` no se commitea nada sin
  petición explícita (y si algún día toca, `git fetch` + rebase antes
  de pushear: él trabaja esa rama en paralelo y sus pushes se cruzan de
  verdad).

La interfaz sigue siendo HTML/CSS/JS sin build ni framework (`app.js` y
`settings.js` se cargan como `<script>` normales y comparten variables
globales — `settings.js` va después de `app.js`, cuidado con el orden si
tocas ambos). Además del calendario hay un hub de "Apps" a pantalla
completa con 4 secciones independientes: Gimnasio, Lecturas, Finanzas y
Viajes. Detalle completo de features en `README.md`, que está al día.

## Reglas de trabajo que Koku ha pedido explícitamente

- **Commit y push: SÍ, sin pedir permiso cada vez** (regla nueva,
  sustituye a la anterior de "no commitear sin que lo pida" — Koku dio
  la autorización de forma permanente en la ronda de retoques de notas
  de la rama `movil-ui`): al terminar y verificar una ronda de trabajo,
  se commitea y se pushea directamente, agrupando por ronda como
  siempre.
- **GitHub Actions: NUNCA lanzarlo por cuenta propia** (misma ronda que
  la regla anterior): el número de compilaciones/subidas que Koku puede
  lanzar es limitado (no lo sabía y se enteró al agotarse). Solo se
  lanza un workflow si él lo pide explícitamente en ESA ronda.
- **`CLAUDE.md` se trata como un archivo más** (regla nueva, sustituye a
  la anterior de "nunca se commitea"): se actualiza cuando el proyecto
  cambia, y se commitea con el resto.
- **No hace falta avisar de que una tarea es larga antes de empezar** — lo
  pidió al principio, pero luego dijo explícitamente que como no puedo
  comprimir contexto por mi cuenta, no sirve de nada que avise. No lo hagas.
- Versionado semántico en `package.json` con tag de git a juego (`v0.x.0`),
  commits agrupados por ronda de trabajo (no uno por cada cambio pequeño).
- Cuando algo es ambiguo o hay varias formas razonables de hacerlo, pregunta
  antes de construir — a Koku le gusta decidir el diseño, no que se lo
  entreguen hecho. Con peticiones grandes/con varios puntos a la vez, mejor
  agrupar las preguntas ambiguas en una sola ronda de preguntas al principio
  en vez de ir parando a cada rato.
- **Los tags de git SÍ se pueden crear y pushear desde una sesión LOCAL**
  (confirmado en la ronda de v0.23.1: `git tag vX.Y.Z <hash>` +
  `git push origin vX.Y.Z` funciona igual que el branch normal, con solo
  un aviso inofensivo de "unable to get credential storage lock" que no
  impide el push). La limitación de 403 al pushear tags es especifica de
  la integración de **control remoto** (Cowork y similares), cuya
  credencial es más limitada que la cuenta completa de Koku — en ese tipo
  de sesión, el workaround sigue siendo que Koku lo haga a mano desde su
  propio ordenador después de cada push:
  ```
  git fetch origin main
  git tag vX.Y.Z <hash-del-commit>
  git push origin vX.Y.Z
  ```
  (añadir `--force` al tag si hubo que corregir uno mal puesto). Si estás
  en una sesión de Claude Code local (terminal en el propio ordenador de
  Koku), prueba a pushear el tag tú mismo primero — solo hace falta el
  workaround manual si de verdad da 403 en ESTA sesión en concreto.
- **Nunca usar controles nativos del navegador para checkbox, `<select>`,
  fecha, ni nada similar (ronda de retoques de Carteras/Archivos, tras
  ver capturas de checkboxes cuadrados grises sin estilo)** — siempre el
  componente propio de la app que siga el tema activo:
  `createSelectField()`/`createDateField()` (`app.js`) para
  desplegables/fechas (ya son el patrón establecido, usados en
  Lecturas/Gimnasio/Finanzas), y para checkboxes de selección (listas,
  árboles) la clase `.styled-checkbox` (`styles.css`, cuadrado con
  esquinas redondeadas + check de acento, soporta `:indeterminate`) — NO
  la clase `.checkbox-row` (esa es el interruptor tipo pastilla para
  ajustes on/off, un componente visual distinto, no vale para "elige uno
  o varios de una lista"). Si algún día aparece un `<select>`/
  `<input type="date">`/checkbox nativo sin estilo en algo nuevo, es un
  descuido a corregir, no una excepción aceptable.

## Arquitectura y convenciones establecidas

- **El "servidor" vive dentro de la app** (lo más importante de entender):
  - `public/vendor/sql-wasm.js` + `.wasm` — SQLite compilado a
    WebAssembly (sql.js, MIT, vendorizado; sin build, sin CDN). Se eligió
    frente a reescribir a IndexedDB porque conserva las 45+ consultas con
    SQL de verdad (JOIN/GROUP BY/SUM), y frente a un plugin nativo de
    SQLite porque sql.js es **síncrono** igual que `node:sqlite`: si
    fuera asíncrono habría que convertir a `await` los ~396 sitios que
    consultan la base, o sea reescribir todas las rutas.
  - `public/local-schema.js` — el esquema (tablas + migraciones) portado
    de `server/db.js`.
  - `public/local-db.js` — expone `localDb`, con la MISMA forma que el
    `db` de `node:sqlite` (`prepare(sql).all/get/run`, `exec`), y vuelca
    la base entera a IndexedDB tras cada escritura (agrupando 250ms, y
    también al ocultarse la página, para no perder la última escritura
    si se cierra la app justo después).
  - `public/local-api.js` — router mínimo que imita a Express
    (`createLocalRouter`/`mountLocalRouter`/`dispatchLocalRequest`).
  - `public/routes-local/*.js` — las 25 rutas del backend, copiadas
    **mecánicamente** de `server/routes/`: misma lógica y mismo SQL, solo
    cambia la fontanería (sin require/module.exports, cada archivo en un
    IIFE para que los nombres repetidos no choquen en el ámbito global).
  - `api()` en `app.js` despacha contra ese router en vez de hacer
    `fetch`. Misma firma y misma forma de error, así que ninguno de los
    ~50 sitios que la llaman cambió.
  - **Si tocas una ruta, tócala en `public/routes-local/`**, no en
    `server/routes/` (eso es el otro programa).
- **Verificación del porte**: hay un guion de comparación diferencial que
  lanza las MISMAS peticiones contra el servidor Express real y contra el
  motor local y compara las respuestas (79 comprobaciones, 0
  diferencias). Si algún día se toca el porte a lo grande, merece la pena
  rehacerlo antes de dar nada por bueno.
- **Imágenes y fotos**: los bytes van al almacén `noteAssets` de
  IndexedDB, NO dentro de la base SQLite (la inflaría y haría lento cada
  volcado). El HTML de una nota sigue guardando la ruta de siempre
  (`/api/notes/images/<uuid>.<ext>`), así que el saneador no cambia; al
  MOSTRARLA, `resolveAssetUrl()`/`hydrateAssetImages()` cambian el `src`
  por una URL `blob:` y guardan la ruta original en `data-asset-src`,
  que `serializeAssetImages()` devuelve al guardar. Cuidado: poner el
  `src` original en un `<img>` (aunque sea un clon suelto) hace que el
  navegador pida esa ruta igualmente — por eso serializar se hace sobre
  el texto, no clonando el DOM.
- **Recordatorios**: `public/local-notifications.js` los programa en el
  propio sistema operativo con `@capacitor/local-notifications`, así que
  suenan con la app cerrada sin servidor ni push. Se reprograman en
  bloque (cancelar todo y rehacer) desde `loadReminders()`, que es por
  donde ya pasa cualquier cambio de eventos. En un navegador normal el
  plugin no existe y todo esto es no-op.
- **Gastos fijos**: `public/finanzas-recurring.js`, portado de
  `server/finanzasRecurringChecker.js`, se ejecuta al ABRIR la app en vez
  de en un `setInterval` de 24h.

- **Temas de color**: cada fondo real de la interfaz (`bg`, `surface`,
  `surface2`, `settingsMenuBg`, `accent`, `dayToday`) lleva su propio color
  de contraste emparejado (`bgText`, `surfaceText`, etc.) en vez de un
  "texto principal/secundario" global — así cada superficie garantiza su
  propia legibilidad. Ver `server/routes/themes.js` (`sanitizeColors`,
  con cadena de fallback contextual + red de seguridad de contraste real
  vía fórmula WCAG) y `public/settings.js` (`THEME_COLOR_FIELDS_META`).
  Un tema puede tener una `inverseColors` opcional (variante clara/oscura
  emparejada); `resolveThemeVariant()` decide cuál mostrar según
  `colorModePreference` (por dispositivo, solo "Sistema" en el selector de
  Configuración — se simplificó quitando "Claro"/"Oscuro" porque ya existe
  un botón rápido ☀/☾ en la topbar para eso). Si el tema activo no tiene
  variante inversa, ese botón rápido se queda oculto.
- **Edición de temas con borrador**: al editar un tema los cambios se
  aplican en vivo a toda la app; cambiar a editar otro tema guarda el
  anterior solo (sin preguntar); cerrar sin guardar descarta. No hay botón
  de guardado por tema, es un único flujo global (`saveCurrentThemeEdit`,
  `switchThemeEdit` en `settings.js`).
- **No hay autenticación de ningún tipo** en la app sin servidor: sin
  servidor no hay a quién autenticar, todo es acceso local del dueño del
  dispositivo. El router local ignora a propósito los middlewares que
  traían las rutas portadas (`requireDeviceOrTrusted` y similares).
- **Mobile-first**: CSS base es para móvil, `min-width: 860px` cambia a
  layout de escritorio (calendario en grid + panel de recordatorios al
  lado, todo dentro de `100vh` sin scroll de página).
- **Tareas**: son filas de `events` con `is_task = 1` (no una tabla
  aparte) — comparten título/grupo con los eventos normales, pero
  `start_at` es opcional (una tarea puede no tener fecha) y tienen su
  propio campo `done`. En el calendario, si tienen fecha, se ven con el
  borde en vez de relleno (`.calendar-task-chip`) y un icono ☐/☑ clicable.
  El color de "completada" es opcional por grupo (`completed_color` en
  `groups`); si no se pone a mano, se calcula atenuando el color normal
  del grupo (`mutedTaskColor()` en `settings.js`). "Tachar vs ocultar"
  completadas es un ajuste por dispositivo, no compartido.
- **"Mi espacio"** (Próximos + Tareas + Notas juntos) — construido por
  fases a lo largo de varias rondas, ya completo:
  - **Notas**: título + contenido con formato básico (Fase 4, completa:
    negrita/cursiva/listas en v0.21.0, tablas en v0.22.0, imágenes en
    v0.23.0 — ver bloque aparte más abajo). Se pueden ocultar (icono de
    ojo, difuminadas en la lista) con una contraseña OPCIONAL y
    COMPARTIDA para toda la app (no por nota individual) — no es cifrado
    real, solo evita que se lea a primera vista
    (`server/routes/notesSecurity.js`).
  - **Carpetas de notas**: sistema propio, separado de los Grupos del
    calendario — nombre + color (YA NO tienen icono propio, se quitó esa
    opción a propósito: el icono genérico de carpeta ya diferencia bien
    carpeta de nota, no hacía falta elegir uno por carpeta). Pueden
    contener otras carpetas (`parent_id`, con detección de ciclos en
    `server/routes/noteFolders.js`). Navegación tipo explorador de
    archivos (Windows/Finder): `renderNotesView()` en `app.js` pinta lo
    que hay en la carpeta actual (subcarpetas arriba, notas debajo, todo
    en una lista), con un botón "Volver" de un solo nivel. Borrar una
    carpeta NUNCA borra su contenido: notas y subcarpetas suben un nivel.
  - **Favoritos**: columna `favorite` en `notes` y `note_folders`. Estrella
    para marcar (desde la creación o con un clic en el listado). Carpetas
    y notas mantienen su propio orden de favoritos por separado (las
    carpetas siempre van primero como grupo, sea cual sea el ajuste).
    Ajuste por dispositivo (`favoritesDisplayMode` en localStorage):
    "merged" (favoritos primero, sin cabecera) o "sections" (cabecera
    "Favoritos"/"Todo lo demás", esta última solo si hay algún favorito).
  - **Búsqueda**: barra de texto encima del listado, filtra por nombre
    SOLO dentro de la carpeta donde estás (no busca en toda la app).
  - **Diseño de "Mi espacio"**: hub de 3 columnas (Recordatorios / Tareas
    / Notas). Cada columna se expande clicando su TÍTULO (h2), no hay
    botón dedicado aparte (se quitó para no gastar una fila de alto solo
    para eso). Por dispositivo, `miEspacioMode` decide cómo se accede:
    - `"panel"`: el hub vive siempre al lado del calendario (sustituye al
      panel clásico).
    - `"topbar"` (por defecto): el panel clásico de siempre
      (Recordatorios/Tareas/Notas) queda al lado del calendario, y un
      botón en la topbar abre el hub a pantalla completa. Dentro de esa
      pantalla completa, el botón de Configuración va SIEMPRE el último
      (más a la derecha) junto al botón de volver ("← Home") — se corrigió
      porque antes el botón de Configuración de la topbar quedaba tapado
      (esta pantalla tiene z-index por encima), hacía falta uno propio ahí.
  - **Panel lateral clásico — "agrupar con flechas"**: en Configuración >
    Vista hay una casilla por sección (Recordatorios/Tareas/Notas). Las
    que marques se agrupan JUNTAS en un único hueco con flechas arriba
    para alternar SOLO entre ellas; las que no marques se quedan sueltas,
    apiladas, siempre visibles cada una con su scroll. Marcar 0 o 1 no
    agrupa nada (con una sola no hay nada que alternar). Ver
    `REMINDERS_PANEL_PAGES` / `getRemindersGroupedSections()` /
    `applyRemindersPanelLayout()` en `app.js` — está hecho a propósito
    SIN ningún "3" fijo en el código (se itera sobre el array entero),
    para que si algún día hay una 4ª sección solo haga falta añadirla a
    esa lista, la lógica de agrupar/soltar ya generaliza sola. Este
    ajuste solo aplica en modo `"topbar"` — en modo `"panel"` cada
    columna ya vive fija en su sitio, no pinta nada ahí.
  - **Ctrl+Intro** guarda directamente en los modales de nota, evento y
    tarea (`enableCtrlEnterSubmit()` en `app.js`).
  - **Editor de notas con formato (Fase 4, completa)**: `#note-body` ya
    no es un `<textarea>`, es un `<div contenteditable>` con una barra de
    botones encima (`app.js`, sección "Editor de notas con formato").
    - **Negrita/cursiva/listas** (v0.21.0): botones con `data-cmd` que
      llaman a `document.execCommand()` — obsoleto según MDN pero sigue
      funcionando bien en Chrome/Edge/Firefox, y evita escribir a mano la
      lógica de negrita/listas sobre el DOM. `refreshNoteEditorToolbar()`
      enciende/apaga cada botón según `document.queryCommandState()` en
      cada cambio de selección dentro del editor.
    - **Tablas** (v0.22.0): botón "Tabla" abre un popover (mismo patrón
      que color/icono/fecha: `positionFixedPopover`/`closeAllPopovers`
      de `settings.js`) pidiendo filas/columnas antes de insertar. Con el
      cursor dentro de una celda aparecen 4 botones contextuales
      (+Fila/-Fila/+Col/-Col) — `getCurrentTableCell()` resuelve en qué
      celda está el cursor a partir de `window.getSelection()`, con un
      fallback para cuando el navegador deja el cursor "colgado" de un
      antepasado (tr/tbody/table) en vez de dentro de la celda (pasa
      sobre todo justo después de borrar una fila/columna con una celda
      vacía). Borrar la última fila o columna quita la tabla entera.
    - **Imágenes** (v0.23.0): botón "Imagen" (selector de archivo
      nativo) y Ctrl+V (evento `paste` en el editor, solo si hay una
      imagen de verdad en el portapapeles) suben el archivo a
      `POST /api/notes/images` y solo meten en el HTML el enlace corto
      que devuelve (`/api/notes/images/<uuid>.<ext>`) — NO se guarda la
      imagen como base64 dentro de la nota (decisión hablada con Koku:
      hincharía la base de datos y ralentizaría cargar la lista de
      notas). Los archivos viven en `DATA_DIR/note-images/`
      (`server/routes/noteImages.js`), un nivel por debajo de
      `server/dataDir.js`. **Servir una imagen NO pasa por
      `requireDeviceOrTrusted`** a propósito: un `<img src="...">` lo
      pide el navegador sin poder llevar el header `X-Device-Token`, así
      que la única protección es que el nombre de archivo es un
      `crypto.randomUUID()` imposible de adivinar — SUBIR una imagen sí
      exige estar vinculado. Al borrar una nota (`DELETE /api/notes/:id`)
      se limpian del disco las imágenes que tuviera
      (`deleteImagesInBody()`); editar una nota y quitar una imagen de en
      medio SIN borrar la nota entera NO libera ese archivo (limitación
      conocida y aceptada, evita tener que diferenciar el HTML
      antes/después en cada guardado).
    - **Saneado server-side** (`sanitizeNoteBody()` en
      `server/routes/notes.js`): lista blanca de etiquetas
      (`b/strong/i/em/ul/ol/li/br/div/p/table/tbody/tr/td/th/img`), todas
      sin atributos EXCEPTO `img`, que conserva `src` solo si apunta a
      `/api/notes/images/...` (nada de `data:` ni servidores externos).
      Se aplica en POST/PUT siempre que `bodyFormat` venga como `'html'`
      (lo manda siempre el editor nuevo); las notas de antes de la Fase 4
      tienen `body_format = 'text'` en la columna nueva de `notes`
      (migración en `db.js`) y se convierten a HTML escapado solo al
      abrirlas en el editor (`legacyNoteBodyToHtml()` en `app.js`), sin
      tocar lo que hay guardado hasta que se editen y guarden de nuevo.
- **Vista (pantalla completa)**: solo dos modos, Normal y Pantalla
  completa (se quitó la idea de "ventana flotante" que había al
  principio, `window.open()` no era fiable entre navegadores). Por
  dispositivo. En Electron, `applyViewMode()` llama a
  `window.electronAPI.setNativeFullscreen()` y el estado se guarda
  también en un archivo aparte (`view-mode.json`, no solo localStorage)
  para que la ventana pueda nacer ya en pantalla completa la siguiente
  vez, en vez de abrirse normal y luego cambiar.
- **PWA**: `public/manifest.json` + `public/sw.js` (service worker
  mínimo, solo cachea el shell — HTML/CSS/JS —, nunca `/api/*`, para que
  los datos siempre sean en vivo). Instalable como app en móvil/escritorio.
- **No hay sincronización ni emparejamiento.** Cada dispositivo tiene
  sus propios datos y no se hablan entre ellos. Todo lo que había
  (`sync_log`, pull/push, cola de pendientes, código de 6 dígitos, QR de
  reconexión, Web Push/VAPID, la extensión Archivos y los avisos de
  versión nueva) se quitó de la app; sigue vivo solo en `server/`, que es
  el otro programa.
- **Apps** (hub a pantalla completa, botón "Apps" en la topbar —
  antes se llamaba "Extensiones", solo cambió el texto visible, los
  ids/clases internas siguen diciendo `extensions`): cuatro secciones
  independientes del calendario, todas con el mismo patrón de esquema
  (`CREATE TABLE IF NOT EXISTS` + migraciones condicionales,
  `PRAGMA table_info` + `ALTER TABLE`) y borrado en cascada A MANO en
  las rutas (nunca `ON DELETE CASCADE` de SQL). Detalle de usuario en
  `README.md`; resumen técnico:
  - **Gimnasio**: `gym_exercises`/`gym_routines`/`gym_routine_exercises`/
    `gym_sessions`/`gym_sets`. Progreso con gráfica SVG a mano (peso
    máximo/volumen), sin ninguna librería.
  - **Lecturas**: `lecturas_sagas`/`lecturas_items` (sagas obligatorias,
    un item puede ser de cualquier tipo — manga/cómic/libro/serie/anime/
    película — dentro de la misma saga). Géneros como columna JSON de
    texto libre (no tabla N:M), con sugerencias globales calculadas de
    `GET /api/lecturas-items` sin `sagaId`.
  - **Finanzas**: `finanzas_accounts`/`finanzas_categories`/
    `finanzas_transactions`/`finanzas_investment_transactions`/
    `finanzas_settings` (fila única, límite mensual + objetivo de
    ahorro) + `finanzas_portfolios`/`finanzas_assets`/
    `finanzas_asset_valuations` (carteras anidadas tipo `note_folders`,
    activos con valoración manual de precio) +
    `finanzas_recurring_expenses` (plantillas de gasto fijo, generador
    en `public/finanzas-recurring.js`). Saldo de cuenta SIEMPRE
    calculado, nunca guardado. Borrar una cuenta con historial se
    rechaza (`has_history`); borrar una categoría/cartera no destruye lo
    que la usaba (queda sin categoría/cartera, o reparentado).
  - **Viajes**: `viajes_trips`/`viajes_trip_countries`/`viajes_entries`/
    `viajes_entry_attachments`/`viajes_entry_movements`. Mapa SVG por
    países (`raphaellepuschitz/SVG-World-Map`, MIT) con zoom/paneo
    propios; los ids del SVG vienen en MAYÚSCULAS y se normalizan a
    minúsculas en `dataset.countryCode` (el atributo `id` no se toca).
    Un movimiento de una entrada puede enlazarse a una transacción real
    de Finanzas. La extensión **Archivos** existió y se quitó al
    desaparecer el servidor (no tenía sentido leer las carpetas de un
    ordenador que ya no está).

## Cosas que ya rompieron una vez (para no repetir el error)

- **Orden de declaración de variables en `settings.js`**: hubo un bug real
  donde una función que se ejecuta al cargar la página (`buildThemeColorGrid`,
  llamada de inmediato) disparaba un callback que leía una variable `let`
  declarada MÁS ABAJO en el archivo — al estar en su "zona muerta temporal"
  (TDZ), lanzaba una excepción que abortaba TODO el resto del script,
  dejando sin registrar botones enteros. Si algo dentro de código que se
  ejecuta AL CARGAR la página (no dentro de un handler que se dispara
  luego) necesita una variable/función, esa variable tiene que estar
  declarada ANTES en el archivo. Dentro de un handler (función que se
  llama más tarde, tras un clic por ejemplo) no pasa nada, para entonces
  ya se ha terminado de parsear/ejecutar todo el archivo — así que
  funciones que se llaman entre `app.js`/`settings.js` cruzados (p. ej.
  `applyRemindersPanelLayout()` llamada desde un listener en `settings.js`)
  funcionan bien mientras la LLAMADA ocurra dentro de un handler, no al
  cargar.
- **Contraste de colores**: no asumas que un color se ve bien solo porque
  "type check" pasa — comprueba el contraste real (hay una función de ratio
  WCAG en `server/routes/themes.js`) antes de dar un fix de contraste por
  bueno.
- **Popovers flotantes (color/icono/select/fecha) que se salen de la
  pantalla**: `positionFixedPopover()` en `settings.js` en su día usaba
  una ALTURA ESTIMADA fija para decidir si el popover cabía hacia abajo o
  había que ponerlo hacia arriba — se quedaba corta para el popover de
  iconos (más alto que los demás) y lo dejaba fuera de la pantalla sin
  poder hacer scroll hasta él. Arreglado midiendo la altura REAL
  (`popover.offsetHeight`) en vez de estimarla, ya que para cuando se
  llama a esta función el popover ya está visible (solo con
  `visibility:hidden` o similar) y por tanto es medible de verdad. Si se
  añade un popover nuevo, no hace falta tocar nada de esto, ya funciona
  solo con la altura real.
- **"¿Está vacío el editor de notas?" no es lo mismo que "¿tiene
  texto?"**: el submit de `note-form` decidía si mandar `body: null`
  mirando solo `NOTE_EDITOR_BODY.textContent.trim() === ''` — una nota
  con SOLO una imagen o SOLO una tabla vacía no tiene texto, así que se
  guardaba como si estuviera completamente vacía (perdiendo la imagen o
  la tabla). Arreglado comprobando también
  `NOTE_EDITOR_BODY.querySelector('img, table')`. Si se añade otro tipo
  de contenido "sin texto" al editor en el futuro (Fase 5+), hay que
  acordarse de meterlo también en ese `querySelector`.
- **Selección del cursor dentro de una tabla contenteditable**: al hacer
  click en una celda VACÍA (`<td><br></td>`), el navegador a veces deja
  el cursor "colgado" de un antepasado (tr/tbody/table) con un offset, en
  vez de dentro de la celda en sí — pasa sobre todo justo después de
  borrar una fila/columna. `getCurrentTableCell()` en `app.js` tiene un
  fallback que mira el hijo exacto que señala ese offset; si se toca esa
  función, cuidado con quitar ese fallback pensando que es código muerto,
  se reproduce con facilidad en el flujo normal de usar +Fila/-Fila.

## Gestos de navegación (móvil) — ronda del visor móvil

Diseñado con Koku en la conversación de "configuración del visor móvil".
El código vive todo junto al final de `public/app.js`, bajo el título
"GESTOS DE NAVEGACIÓN". La idea, en una frase: **la pantalla se reparte
en carriles**.

```
|  lateral  |         centro          |  lateral  |
|  cambiar  |  gesto propio de ESTA   |  cambiar  |
| de PESTAÑA|       pantalla          | de PESTAÑA|
```

- **Carril lateral** (22% del ancho a cada lado, mínimo 56px y máximo
  120px — `mobileEdgeRailWidth()`): recorre las pestañas de la barra de
  abajo de una en una y en el orden en que se ven,
  `Calendario → Notas → Herramientas → Configuración`
  (`MOBILE_TAB_ORDER`). Izquierda avanza, derecha retrocede. En los
  extremos NO da la vuelta, a propósito.
- **Carril central**: lo propio de la pantalla. Hacia la derecha
  intenta primero *subir una capa* (`VOLVER_UN_PASO`: volver al menú de
  Configuración, subir de carpeta en Notas, salir del detalle de una
  saga/viaje/bloque...); si no hay capa que soltar, recorre las
  sub-pestañas de la App en la que estés (`MOBILE_SUBTAB_BARS`:
  Gimnasio, Finanzas, Viajes). Si en esa pantalla el centro no tiene
  nada que hacer, el gesto **cae hacia atrás** y hace lo mismo que el
  lateral, para que nunca haya un deslizamiento muerto.

Detalles que costaron y conviene no deshacer:

- **`VOLVER_UN_PASO` pulsa los botones de volver que YA existen**, no
  duplica su lógica. Así lo que hagan esos botones (guardar el borrador
  de un tema, limpiar la búsqueda de Notas...) pasa igual deslizando que
  tocando. Los mismos botones lanzan la animación (`animarCambioDePantalla`),
  que es lo que pidió Koku: el botón "Volver" se mueve igual que el gesto.
- **`estaVisibleDeVerdad(el)`**: ni `.hidden` ni `offsetParent` valen por
  separado. Hay diálogos que se quedan sin la clase `.hidden` aunque no
  se vean (los tapa un padre), y casi todos los modales son
  `position:fixed`, que tienen `offsetParent` nulo aunque se vean
  perfectamente. `getClientRects().length > 0` sale bien de los dos.
- **`CENTRO_CON_DUENO`**: la vista diaria ya usa el deslizamiento
  horizontal central para cambiar de día (`attachSwipe` con
  `centerOnly: true`), así que ahí el módulo no se mete NI deja que el
  gesto caiga al cambio de pestaña — si no, un solo deslizamiento haría
  las dos cosas a la vez.
- **El mapa de Viajes se distingue por VELOCIDAD**, tal cual lo pidió
  Koku: arrastrar despacio mueve el mapa, un gesto rápido
  (`NAV_SWIPE_VELOCIDAD_MAPA`, 0.55 px/ms ≈ media pantalla en un tercio
  de segundo) navega.
- **`ultimaHerramientaAbierta`**: si estabas en Gimnasio y te vas, al
  volver deslizando entras directo a Gimnasio. Es una variable en
  memoria a propósito (NO localStorage): al cerrar la app se olvida
  sola, que es lo que pidió Koku. El botón de Herramientas de la barra
  siempre lleva al menú y borra el recuerdo — ese es el gesto de "quiero
  cambiar de App".
- **`NAV_SWIPE_OPT_OUT`**: sitios donde arrastrar ya significa otra cosa
  y el módulo se aparta del todo (filas de notas con sus acciones,
  tablas del editor, entreno en vivo). Para algo nuevo, basta con
  ponerle `data-no-nav-swipe`.

**Las DOS pantallas viajan a la vez** (arreglo del 9/9/2026). Antes solo
se animaba la que entra: la que se iba desaparecía de golpe y durante
esos 280ms se veía lo que hubiera DEBAJO mientras la nueva barría la
pantalla. Koku: *"en el lateral donde dejo atrás la vista se mueve
rápido por detrás y marea un poco"*. Ahora `playMobileSwipeOut()` mueve
también la saliente, como la tira de un carrusel, y nunca asoma una
tercera cosa.

Dos detalles que costaron:

- La capa que se va **ya está oculta** cuando toca animarla (su botón de
  cerrar le puso `.hidden`). Se le quita y se le repone la clase, en vez
  de forzar un `display` por CSS: cada capa tiene el suyo (las pantallas
  completas son `flex`, no `block`) y forzarlo las descuadraría.
- **`cerrandoEnCascada`**: `closeAllMobileOverlays()` simula pulsaciones
  de Esc, y esa cascada acaba CLICANDO los botones de volver, que tienen
  su propia animación. Sin la marca se lanzaban DOS animaciones que se
  pisaban: la del botón dejaba la pantalla vieja a la vista para que se
  fuera, y la del cambio de pestaña se la encontraba visible y la
  trataba como la que ENTRA — resultado, una pantalla que se quedaba
  puesta encima para siempre. Pasó de verdad.

**Interruptor de animaciones** (Configuración > Este dispositivo): ya no
es solo del calendario, apaga TODO el movimiento de la app. Funciona en
dos mitades: una única regla global de `styles.css`
(`:root[data-animations="off"] *`, con 0.01ms en vez de `none` para que
`animationend` siga llegando y no se quede ninguna clase a medio limpiar)
y `areAnimationsEnabled()` para lo que dispara el JavaScript a mano. El
atributo se pone en el script de arranque de `index.html`, antes de
pintar. Ventaja de que la regla sea global: una animación nueva nace ya
obedeciendo al interruptor sin tener que acordarse de apuntarla.

**Temas sembrados (9, todos con pareja clara/oscura)**: Predeterminado,
Pastel, Neón, Océano, Bosque, Atardecer, Lavanda, Carbón y Arena. Los
seis últimos se añadieron el 9/9/2026 a petición de Koku ("nombres
genéricos pero descriptivos, para tener una buena variedad"), y de paso
Pastel y Neón estrenaron la variante que les faltaba — antes solo
Predeterminado tenía pareja.

Cada paleta se validó con la fórmula WCAG real ANTES de escribirla, en
los seis pares fondo/contraste que comprueba `sanitizeColors`, buscando
4.5:1 en las superficies de leer y ≥3:1 en los acentos (que es lo que
exige la app). CLAUDE.md ya avisaba de no dar un color por bueno solo
porque lo parezca; el guion de validación está en el historial de esta
ronda si hace falta añadir más temas.

**Sol y luna son SVG, no emojis** (petición de Koku el 9/9/2026): un
emoji lo pinta el sistema con SU tipografía, así que cambia de forma
entre iPhone, Android y navegador, no hereda el color del tema y suele
salir descolocado de tamaño. `ICON_CLARO`/`ICON_OSCURO`/`ICON_PAREJA` en
`settings.js`, con `currentColor` para que se tiñan con el tema activo.

**Temas de color privados fuera del sembrado**: "EINES" y "Registro"
salían de guías de diseño privadas de Koku y ya NO viajan dentro de la
app (ver la nota en `public/local-schema.js`). Quitarlos de `SEED_THEMES`
no los borra de una base que ya los tenga: el sembrado solo inserta un
tema si no existe uno con ese nombre. Ojo con el nombre "Registro": el
**estilo de interacción** que se llama igual (`[data-ui-style]` en
`styles.css`) es otra cosa y SÍ se queda.

## Orientación bloqueada en vertical

Petición de Koku (9/9/2026): la app no rota a apaisado. Toda la interfaz
está pensada mobile-first en vertical y en horizontal la barra de abajo,
el calendario y las pantallas completas se quedan sin alto útil.

- **iOS**: dos piezas, y hacen falta las dos.
  - `ios/App/App/Info.plist` — `UISupportedInterfaceOrientations` (el
    del iPhone) se queda solo con `UIInterfaceOrientationPortrait`. Pero
    `UISupportedInterfaceOrientations~ipad` **tiene que seguir trayendo
    las cuatro**: App Store Connect rechaza la subida con el error
    **90474** si el bundle dice que vale para iPad y no las declara
    todas (las exige para el multitarea de iPad). Pasó de verdad en la
    build #39: compiló y exportó bien, y rebotó justo al subir. Ojo
    también con los guiones dobles dentro de un comentario XML: son
    ilegales y rompen el plist entero.
  - `ios/App/App/BridgeViewController.swift` — `supportedInterfaceOrientations`
    devuelve `.portrait` y `shouldAutorotate` es `false`. Esto es lo que
    de verdad impide rotar, porque manda por encima de la lista del
    Info.plist y vale para cualquier aparato, iPad incluido.
  - La otra salida sería dejar la app solo para iPhone
    (`TARGETED_DEVICE_FAMILY = "1"`), que quitaría el requisito de
    Apple de un plumazo — pero eso es una decisión de producto, no un
    arreglo de este error, y no se ha tomado.
- **Android**: `android/app/src/main/AndroidManifest.xml` —
  `android:screenOrientation="portrait"` en la MainActivity. Ojo: NO se
  quita `orientation` de `configChanges`, que es lo que evita que
  Android reinicie la Activity (y la webview con ella) ante un cambio de
  configuración de ese tipo.

No hay `manifest.json` en el repo (se quitó en su día), así que por el
lado web no hay nada que bloquear.

## Vibración del fin de descanso: qué la calla de verdad

Probado por Koku en el iPhone (ronda del 9/9/2026), con el botón
"Probar el aviso (10 s)" de Configuración → Notificaciones:

- **Sí la callan**: un botón de volumen, desbloquear la pantalla, abrir
  la app, y quitar el aviso desde el centro de notificaciones.
- **No la callan, y no es un fallo nuestro**:
  - *La pausa de los AirPods.* Los mandos remotos
    (`MPRemoteCommandCenter`, ver `RestAlertStopper.swift`) solo llegan
    a la app que está reproduciendo. Con Spotify sonando, esa pulsación
    es suya y iOS no se la pasa a nadie más. Quitarle el mando a Spotify
    sí lo detectaría, pero entonces esa misma pulsación le pausaría la
    música — justo lo que Koku no quería.
  - *Deslizar el aviso hacia arriba.* Eso solo lo esconde: sigue
    entregado, y iOS no avisa a la app. La detección va por sondeo de
    `getDeliveredNotifications` (`bannerTimer` en `RestAudioWatcher`),
    así que solo se entera cuando el aviso desaparece DE VERDAD, o sea
    al quitarlo del centro de notificaciones.

Los textos de los "?" de esa sección dicen exactamente esto, para no
prometer lo que no se cumple.

**Bug arreglado en la misma ronda**: la línea de diagnóstico
(`gym-rest-alert-status`, "se paró X a los N segundos") se rellenaba
SOLO dentro de `refreshMobileTab()`, o sea al *entrar* en la sección —
que es justo cuando todavía no hay nada que contar. El recorrido real es
entrar, pulsar Probar, bloquear, callarlo, desbloquear... y la pantalla
seguía siendo la misma de antes de la prueba. Ahora es
`refreshGymRestAlertStatus()` en `settings.js`, a la que llaman también
un listener de `visibilitychange` (al volver a primer plano, solo si esa
sección está a la vista) y un temporizador tras lanzar la prueba.

## La barra de abajo con el entrenamiento delante

Koku (9/9/2026): *"si le doy a la barra dentro de la app de cuando está
en descanso, me lleva a la vista pero en la barra de estado sigue
marcando que estoy en calendario"*.

La causa: quien avisaba a la barra era `openGymView()` (con su
`setCurrentScreen('gym')`), pero la mini-barra global de descanso llama
directamente a `openGymLiveView()`, saltándoselo.

Ahora es `openGymLiveView()` quien marca la barra, que es donde
corresponde: el entreno es una capa por encima de lo que hubiera. Guarda
la pantalla anterior en `pantallaAntesDelEntreno` (variable en memoria,
no `localStorage`: solo vale mientras el entreno está a la vista) y
`closeGymLiveView()` la devuelve — porque al cerrarlo sigues donde
estabas, normalmente el calendario. Solo se guarda si la vista estaba
oculta, para que reabrirla estando ya abierta no pise el recuerdo.

No pelea con la barra: `goToMobileSection()` cierra las capas PRIMERO y
llama a `refreshMobileNavActive()` al final, así que tocar una pestaña
con el entreno delante gana siempre.

## Eventos de varios días

Koku lo vio con un "Viaje Mallorca" del jueves 17 al domingo 20: solo
aparecía el día 17. El arreglo tiene **dos mitades y hacen falta las
dos** — si solo se hace una, parece que no cambia nada:

1. **Pedir los datos** (`public/routes-local/events.js`): el filtro de
   rango era `start_at >= from AND start_at <= to`, o sea "empieza
   dentro del rango". Pidiendo el viernes, un viaje que arrancó el
   jueves ni se devolvía. Ahora es la condición de SOLAPE de toda la
   vida: `start_at <= to AND COALESCE(end_at, start_at) >= from`. El
   `COALESCE` cubre a los que no tienen fin (se comportan igual que
   antes) y los que no tienen `start_at` siguen fuera, porque NULL no
   cumple ninguna comparación. Esto arregla de paso un segundo caso que
   nadie había mirado: un evento que viene del mes anterior.
2. **Pintarlos** (`public/app.js`): `eventOccursOnDay(ev, date)` y
   `eventDaySpan(ev, date)` son ahora la única fuente de verdad de
   "¿sale este día?" y "¿cómo lo ocupa?". Las usan las cuatro vistas
   (rejilla del mes, del año, tira de la semana y vista diaria), que
   antes filtraban cada una por su cuenta con `sameDay(inicio, día)`.

`eventDaySpan` devuelve `unico` / `inicio` / `entero` / `fin`, y de ahí
sale todo lo demás:

- **`entero`** (ni empieza ni acaba ese día) va a la fila de **todo el
  día**, no como bloque. Petición de Koku: un bloque de 00:00 a 24:00
  tapa la pantalla entera y no dice nada que no diga ya la etiqueta.
- **`inicio`** y **`fin`** se pintan como bloque **recortado a ese día**:
  del jueves 20:00 a medianoche, y de medianoche al domingo 14:00. Antes
  solo se recortaba el final; el principio daba por hecho que el evento
  empezaba hoy.
- En los listados, `formatMobileEventTimeRange(ev, date)` enseña
  `20:00 →`, `Todo el día` o `→ 14:00` según el tramo. Sin el segundo
  parámetro se comporta como siempre (rango completo).

**El ÚLTIMO día también va arriba** (decidido por Koku el 9/9/2026:
"me parece bien, que aparezca en la sección de día entero"). Un bloque
de medianoche a las 14:00 se come casi toda la pantalla para decir algo
que la etiqueta dice mejor. Su etiqueta lleva la hora de fin
(`Viaje Mallorca · → 14:00`), no un "Todo el día" pelado.

**Esto es SOLO cómo se pinta**: el evento sigue guardado con su hora de
fin de verdad, NO se convierte en `allDay` en la base de datos. Lo pidió
expresamente: "que se quede guardado que la hora es la que aparece
puesta, que no se guarde sólo como día entero".

El PRIMER día se queda como bloque a propósito: empezar a las 20:00 son
cuatro horas de alto, no molesta, y ver dónde arranca dentro del día sí
aporta. Caso raro conocido y no resuelto: un evento que empieza a las
02:00 y sigue al día siguiente pinta 22 horas de bloque el primer día.
No ha aparecido en la práctica; si molesta, la regla tendría que pasar a
ser por porcentaje del día ocupado.

## Reloj de 12 o de 24 horas

Se sigue al SISTEMA, no hay ajuste en la app (Koku: "yo lo tengo en 24h
el sistema, pero hay gente que lo tiene en 12h, con am y pm, tenlo en
cuenta"). Si tu teléfono está en 12h es porque así lo lees tú; repetirlo
aquí sobra.

`systemUses12hClock()` en `app.js` le pregunta a Intl por el idioma del
DISPOSITIVO (`undefined`, no el nuestro) y mira su `hour12`. El idioma de
los textos sigue siendo `es-ES` a pelo en toda la app; lo único que se
toma prestado del sistema es esta decisión. `TIME_FORMATTER` pasa
`hour12` explícito — sin eso, `es-ES` impone siempre 24h.

**El campo donde se escribe la hora** (`createTimeField`) sigue siendo
de números y nada más, también en 12h — Koku eligió esa vía: "que haya
un selector de am y pm, así mantenemos el bloque con entrada de números
únicamente". Con el teléfono en 12h aparecen dos botoncitos AM/PM
apilados al lado del campo, y el campo pasa a aceptar 1-12.

Lo importante de este componente: **hacia fuera habla SIEMPRE en 24
horas** (`getValue()`/`setValue()` con "HH:MM"). El reloj de 12 vive
solo en lo que se ve, así que nada del resto de la app (guardar,
comparar, `combineDateAndTime`...) tuvo que cambiar. Las conversiones
son `hour12To24()`/`hour24To12()`, y los dos únicos casos que se escapan
de "sumar o restar 12" son las 12 de la noche (0h se escribe 12 AM) y
las 12 del mediodía (12h se queda en 12 PM). Tocar AM/PM cambia la hora
real sin tocar los números, por eso relee el valor.

## Deslizar filas para Editar / Eliminar

`wrapRowWithSwipeActions(row, { onEdit, onDelete })` en `app.js` (antes
se llamaba `wrapGymRowWithSwipe`, se renombró al usarse en más sitios).
La fila sigue al dedo mientras arrastras y cae sola a su sitio. Comparte
con `wrapNoteRowWithSwipe` las clases y el estado de "solo una fila
abierta" (`openSwipedNoteRow`), así abrir una cierra la otra.

Dónde está puesto: carpetas y notas de Mi espacio, sesiones del
historial del Gimnasio, y **tarjetas de grupo del calendario** (añadido
el 9/9/2026). "Todos los eventos" queda fuera a propósito: no es un
grupo de verdad.

Al añadirlo en los grupos **se quitó el "modo editar"** que había ahí
(un lápiz en la barra que convertía cada tarjeta en un acceso a su
ficha): Koku pidió dejar UNA sola forma de editar, "así no da pie a
dudas ni nada". Se fueron `groupsEditMode`, el botón
`btn-groups-edit-mode` de index.html y las clases `.group-card.is-editing`
/ `.group-card-edit-mark` de styles.css. Ahora tocar una tarjeta siempre
entra en el grupo, y editar/eliminar se saca deslizando.

**Trampa que ya mordió una vez**: el formulario de editar un tema se
mueve en el DOM para aparecer justo debajo de la tarjeta que estás
editando (`positionThemeForm`). Al hacer las tarjetas deslizables se
colaba DENTRO del `.note-swipe-wrap`, y como ese envoltorio recorta lo
que se sale y sus botones van pegados de arriba abajo (`top:0`,
`bottom:0`), los botones se estiraban a lo largo de toda la pantalla
por encima de los campos. Koku lo enseñó en una captura. La cura:
insertar **después del envoltorio**, no después de la tarjeta
(`card.closest('.note-swipe-wrap') || card`). Cuidado con esto si algún
día se envuelve alguna otra fila que tenga algo insertándose al lado.

Para ponerlo en un sitio nuevo: envolver la fila con esa función y
añadir su selector a las reglas `.note-swipe-wrap > ...` de
`styles.css` (hacen falta las dos: la del `transform` y la de
`is-dragging`), con su fondo propio — la fila tiene que TAPAR los
botones que quedan debajo.

## El área segura no era solo de los popovers

(9/9/2026, usando la app de verdad.) Los **modales** llegaban demasiado
arriba y se metían bajo la Dynamic Island — se veía sobre todo en los
altos, el de editar una sesión del historial y el de editar un ejercicio
del entreno. `.modal` tenía `padding: 1rem` a secas y `.modal-card` un
`max-height: 95vh` medido sobre la pantalla ENTERA.

Ahora el padding de `.modal` suma `env(safe-area-inset-*)` arriba y
abajo, y la tarjeta usa `max-height: 100%` — que como el modal es un flex
de altura definida, se resuelve contra la franja que deja ese padding, no
contra la pantalla. Un solo arreglo cubre todos los modales de la app.

## Los interruptores llevaban el círculo descentrado

Koku: *"los selectores no están centrados, mira todos los que haya en la
app"*. El comentario del CSS presumía de números redondos (pista 2.4rem,
círculo 1rem, hueco 0.2rem) pero **se olvidaba del borde**: al ser
`position: absolute`, el círculo se coloca respecto a la caja de RELLENO,
que mide 2px menos de ancho y de alto. Encendido, el hueco derecho
quedaba en `0.2rem - 2px` (casi tocando) y abajo igual.

Arreglado con `top: 50%` + `translateY(-50%)` (centrado que no depende
del grosor del borde) y `translateX(calc(1rem - 2px))` al encender. De
paso, la rayita del estado indeterminado de `.styled-checkbox` también
iba con un `45%` a ojo.

**Trampa al comprobarlo**: el círculo tiene `transition`, así que medir
`getComputedStyle` justo después de cambiar el estado devuelve el valor
de PARTIDA y parece que la regla no aplica. Hay que esperar a que termine
la transición antes de medir.

## Popovers flotantes y el área segura

`positionFixedPopover()` en `settings.js` ha roto dos veces, por motivos
distintos:

1. Estimaba la altura con un número fijo, se quedaba corta con el
   popover de iconos y lo dejaba fuera de la pantalla. Arreglado
   midiendo la altura REAL.
2. (9/9/2026) Koku enseñó una captura del selector de color de un grupo
   con la mitad de arriba tapada por la Dynamic Island: cuando no cabía
   debajo del botón, lo subía y lo topaba a 8px del borde de la
   PANTALLA — pero esos primeros ~60px no se ven. Y si el popover es más
   alto que el hueco útil (la paleta son 32 colores), ninguna posición lo
   arregla: hace falta que se desplace por dentro.

Ahora se miden las franjas inútiles con `safeAreaInsets()` (un elemento
de usar y tirar que pide `env(safe-area-inset-*)` como padding, porque
desde JavaScript no hay forma de leerlas), se le pone al popover un
`max-height` de la franja visible con `overflow-y: auto`, y solo entonces
se decide si va debajo, encima o pegado arriba. El margen es de 14px
ADEMÁS del hueco del sistema: pegado justo debajo de la Dynamic Island
queda agobiado y parece cortado aunque no lo esté.

Afecta a TODOS los popovers por igual (color, icono, desplegable,
fecha), así que el de crear un tema y el de un grupo se arreglan de una
sola vez.

**Y aun así el de COLOR se salió del molde** (9/9/2026, tras verlo en el
iPhone): son 32 colores más el color a medida, y flotando tapaba media
pantalla dejando la vista recargada — Koku: *"es un poco enfarragoso y
la vista se ve sucia, con demasiada cosa"*. En móvil ahora se abre a
**pantalla completa**, con cabecera propia ("Elige un color" + ✕) y los
colores más grandes; en escritorio sigue flotando junto a su botón, que
ahí sobra sitio. Lo decide `abrirPopoverDeColor()` en `settings.js`
mirando el ancho (< 860px), NO una media query — porque además de
cambiar el aspecto tiene que **saltarse `positionFixedPopover()` y
limpiar el `left`/`top`/`max-height` en línea** que esa función deja
puestos, o ganarían a las reglas de pantalla completa. La cabecera
existe siempre en el DOM y solo se ve con `.is-fullscreen`.

## Hora propuesta al crear un evento

Siempre la hora en punto **más cercana** a la de ahora, y el fin a +1h.
A las 7:59 sale 8:00–9:00. `roundToNearestHour()` en `app.js`.

El fallo que vio Koku (a las 7:59 le proponía 9:00–10:00) estaba en la
otra rama: si el evento se creaba desde un DÍA concreto (el "+" de la
vista diaria), se plantaban las 9:00 fijas, daba igual la hora que
fuera. Ahora la FECHA sale del día que elegiste y la HORA del reloj.
Verificado con Playwright congelando el reloj en las 24 horas × 6
minutos × los dos caminos (288 casos), incluido el salto de las 23:30 a
las 00:00 del día siguiente.

## La espalda: media, dorsales y lumbar (+ hombro posterior)

Petición de Koku (9/9/2026). Ojo, esto tuvo **dos actos el mismo día** y
lo que vale es el segundo:

1. Primero se partió la espalda en tres (alta, media, dorsales).
2. Al verlo en el móvil, Koku deshizo la de arriba: *"lo que has llamado
   espalda alta cámbialo a hombro posterior y fusiónalo con media"*.

**Como está ahora**: `espalda_media`, `dorsales` y `lumbar` (esta última
nunca se tocó, conserva su nombre de siempre), más un
`hombro_posterior` que vive junto a `hombros`, no con las espaldas —
porque es un hombro.

El reparto de los ~870 ejercicios sale **del origen**
(free-exercise-db, descargado y cotejado por `id`, casan los 876), que
sí distinguía `lats` de `middle back`: `lats` → **dorsales** (38) y
`middle back` → **espalda media** (34, casi todo remos).

**`hombro_posterior` nace SIN ejercicios asignados**: la librería
original no distinguía el deltoides posterior, así que ese trabajo
(face pulls, aperturas invertidas...) sigue etiquetado como `hombros`
hasta que se recoloque a mano desde la ficha de cada ejercicio. En el
diagrama sí tiene sitio: se queda con el hombro de la figura de
ESPALDA, que anatómicamente es justo eso, y `hombros` pasa a marcar solo
la figura de frente.

**El diagrama** (`GYM_BODYMAP_ZONES`): la mancha de la espalda se parte
en dos franjas con un corte a `y=560`. Los puntos del corte salen de
**interpolar sobre los bordes del polígono original**, así que las
piezas encajan sin hueco ni solape — comprobado renderizando el SVG. Si
se tocan esos números a ojo, se nota.

**Dos migraciones en `local-schema.js`**, las dos idempotentes y las dos
necesarias porque **reimportar la librería NO arregla nada** (el import
es idempotente por `library_id` y devuelve la fila existente sin
tocarla, a propósito, para no pisar cambios hechos a mano):

- `'espalda'` → `dorsales` por defecto, con una tabla de los 68
  `library_id` que van a otro sitio.
- `'espalda_alta'` → `espalda_media`, para los pocos que la build #42
  llegó a repartir antes de que Koku deshiciera esa franja.

**Isquiotibiales, no isquiosurales** (decisión de Koku): el segundo es
el término de anatomía y es más preciso (el bíceps femoral se inserta en
el peroné, no en la tibia), pero el primero es el que se busca al montar
un día. El id interno sigue siendo `isquios`.

## El día del Plan: dos entradas, no una

Petición de Koku (9/9/2026). El modal del día tiene DOS mitades y nunca
se ven las dos a la vez (`openGymRoutineModal(routine, modo)`):

- **El lápiz de la lista** abre la FICHA: nombre, color, icono y a qué
  bloque pertenece. Ahí vive también "Eliminar el día".
- **Tocar el día** abre solo sus EJERCICIOS, que es a lo que se entra el
  90% de las veces. Sin "Eliminar", que ahí se confundiría con "quitar
  este ejercicio".
- Un día NUEVO se abre siempre en ficha: hasta que no tiene nombre no
  hay a qué añadirle ejercicios.

**Trampa con la que ya se tropezó**: el campo del nombre es `required`,
y un campo obligatorio OCULTO no se puede enfocar — el navegador se
niega a enviar el formulario entero con un "invalid form control is not
focusable" y **sin decir nada por pantalla**. Por eso se le quita el
`required` mientras está escondido. El valor sigue relleno y se manda
igual, así que guardar desde la mitad de ejercicios no pierde el nombre
ni el color (comprobado).

**Orden de los ejercicios**: cada fila lleva dos flechas (subir/bajar) a
la izquierda, apagadas en los extremos. Con flechas y no arrastrando a
propósito: dentro de un modal que ya se desplaza, arrastrar una fila
pelea con el scroll, y aquí hace falta colocar UNA cosa en su sitio, no
reordenar una lista larga. Al mover se repinta la lista entera (como
hace todo ese formulario) para que las flechas de los extremos se
apaguen solas y los índices de los listeners vuelvan a cuadrar.

**Aquel descuido YA ESTÁ ARREGLADO**: la fila de ejercicio usaba un
`<select>` NATIVO, contra la regla de no usar controles del navegador.
Se cambió por `createSelectField({ searchable: true })` en la ronda del
buscador de ejercicios — ver "Buscar ejercicios" más abajo.

## Configuración por defecto del ejercicio

Petición de Koku (9/9/2026): "yo añado el ejercicio y ahí ya le digo
cuántas series se esperan, tiempo de descanso etc; en el día de entrene
solo añado el ejercicio con esa configuración".

Columnas nuevas en `gym_exercises`: `default_sets`, `default_reps`,
`default_rest_seconds` (con su migración condicional; quedan a NULL en
lo que ya existe, así que hasta que no las rellenes nada cambia). Se
editan en la ficha del ejercicio, bajo "Cómo lo sueles hacer".

**Las dos decisiones que tomó Koku cuando se le preguntó**, y que
conviene no cambiar sin volver a preguntarle:

1. **Heredar, pero poder cambiarlo por día.** El valor del ejercicio es
   un PUNTO DE PARTIDA: al añadirlo a un día, los tres campos de
   `gym_routine_exercises` llegan rellenos, pero siguen ahí y se pueden
   cambiar. Así se puede hacer 5×5 el lunes y 3×12 el jueves con el
   mismo ejercicio. Lo que manda en un día concreto sigue siendo
   `gym_routine_exercises`, no el ejercicio.
2. **Editar un ejercicio NO toca los días que ya lo tenían.** Lo ya
   montado se queda como está y el valor nuevo solo se aplica de ahí en
   adelante — para que editar un ejercicio nunca te cambie un plan por
   sorpresa.

Detalle fino, al **cambiar el ejercicio de una fila** del día: se traen
los valores del ejercicio nuevo, pero **solo en los campos que no hayas
tocado tú** ("no tocado" = vacío, o igual a lo que traía el ejercicio
anterior). Así cambiar de ejercicio no te borra un 4×8 escrito a mano y
a la vez no te deja puesto el descanso del ejercicio de antes.

Las piezas comunes están en `GYM_TARGET_FIELDS` y `gymTargetsPorDefecto()`
(`app.js`), para no repetir el trío series/reps/descanso por todas partes.

## Elegir un tema reventaba por dentro (sin que se notara)

Encontrado el 9/9/2026 mirando la consola en una prueba de otra cosa.
`PUT /api/themes/selection/mine` acababa en
`db.prepare('UPDATE devices ...').run(resolvedThemeId, req.device.id)`,
y en la app sin servidor **`req.device` no existe** (el router local
ignora a propósito los middlewares de autenticación, ver más arriba).
O sea que cambiar de tema lanzaba una excepción SIEMPRE.

No se veía porque `applyTheme()` en `settings.js` envuelve esa llamada
en un `try/catch` que se la traga: el tema se aplicaba igual en pantalla
y quedaba guardado en `localStorage`, que es lo que de verdad manda por
dispositivo. Solo se notaba en la consola.

Arreglado tratando "no hay dispositivo" como el anfitrión
(`app_settings.host_active_theme_id`). **El resto del archivo ya lo
hacía bien** con `req.device ? req.device.id : null`; a esta línea se le
coló el acceso directo tal cual venía del servidor. Si aparece otro
`req.device` sin guardar en `public/routes-local/`, es el mismo
descuido.

## Series alargadas: dropsets y rest-pause

Petición de Koku (9/9/2026). Un **dropset** es una serie que, al llegar
al límite, baja el peso y sigue; un **rest-pause** para unos segundos y
sigue con el MISMO peso. Se apuntan **después** de la serie, en el
diálogo de "¿has acabado?", porque dependen de la serie y del día: *"hay
veces que lo hago y otras que no, por lo que no puedo ponerlo fijo desde
ejercicio"*.

**El modelo**: cada TRAMO extra es una fila propia de `gym_sets` colgada
de su serie madre (`parent_set_id`, `segment_index`, `pause_seconds`) —
el mismo truco que ya se usaba con los unilaterales, donde cada lado es
una serie propia. Así el volumen sale con el `SUM` de siempre sin ningún
caso especial, y **contar series es `parent_set_id IS NULL`**. Los
tramos comparten `exercise_id`, `set_number` y `side` con su madre: son
la MISMA serie.

Hacia el cliente los tramos viajan **anidados** en su madre
(`set.segments`), no sueltos en la lista — así `sets.length` sigue
siendo el número de series de verdad y nadie tiene que acordarse de
filtrar. La conversión va en `serializeSets()` (y otra igual en
`/last-sets/:exerciseId`).

**Las cuatro decisiones que tomó Koku**, tras enseñarle qué hacen otras
apps (Hevy/Strong etiquetan cada tramo como una serie más) y qué dice la
literatura (un rest-pause equivale en reps efectivas a ~2 series, pero
eso es interpretación, no medida). No cambiarlas sin volver a
preguntarle:

1. **Cuenta como UNA serie**, no como tres. Si contara los tramos, la
   racha, el heatmap y el objetivo semanal dirían que entrenaste el
   triple.
2. **Cualquier tramo puede ser récord**: *"a nivel de lógica la primera
   debería ser la que más esfuerzo se haga, pero... hay veces que la
   segunda sale más, más cuando comienzas a entrenar, que en la primera
   no haces buena técnica"*. Por eso `gymSetConTramos()` aplana serie +
   tramos y los PRs los miran por igual. Sigue excluyéndose el
   calentamiento entero (madre y tramos) y el 1RM de Epley sigue pidiendo
   1-12 reps.
3. **La entrada es una línea discreta** dentro del formulario de
   peso/reps que ya existía, no una pantalla propia: la mayoría de las
   series no se alargan y tienen que seguir guardándose de un toque.
4. **El peso del tramo se puede cambiar, con el de la madre por
   defecto.** Va como sugerencia gris (el patrón "campo vacío = te vale
   la sugerencia" que ya usa el resto del diálogo). Matiz: en rest-pause
   se propone SIEMPRE el de la madre (es la definición); en un dropset
   encadenado, el del tramo de arriba, porque va bajando desde él.

**Las piezas** (`app.js`, bloque "Series alargadas"): `gymSetSegments()`,
`gymSetVolumeKg()` (madre + tramos, la usan el volumen del historial, el
mapa de músculos y la gráfica semanal), `gymSetConTramos()` (para los
PRs), `gymSegmentChipHtml()` ("Drop ×2" en la fila) y
`gymSegmentLinesHtml()` (las sub-líneas `↳ 15 s → 80 kg × 3` del
historial). En el diálogo: `gymSetEndSegments`,
`renderGymSetEndSegments()` y `gymLeerTramosDelFormulario()`.

**Trampa que ya mordió al escribirlo**: leer "campo vacío → su
placeholder" sin comprobar que el placeholder sea un NÚMERO. Los de las
reps y la pausa son texto ("reps", "pausa s"), así que se colaba un
`NaN` hasta la base de datos. `gymLeerTramosDelFormulario()` solo acepta
el placeholder si `Number.isFinite()`.

**Retoques tras probarlo en el iPhone** (misma fecha):

- Las dos opciones van **en lista**, una debajo de otra y a todo lo
  ancho, con la pregunta en su propia línea. Antes "+ Dropset" quedaba
  al lado de la pregunta y "+ Rest-pause" solo en la línea siguiente, y
  se leía fatal.
- Los campos de un tramo llevan **etiqueta encima** (Pausa (s) / Peso
  (kg) / Reps) en vez de rótulo dentro del campo: metidos los tres en
  una fila, "pausa s" se cortaba y no se llegaba a leer la unidad. Cada
  tramo es ahora un bloquecito con cabecera (tipo + ✕) y sus campos
  debajo. La sugerencia gris del peso sigue igual.

**Retocar una serie después** (petición de Koku: *"a lo mejor le he dado
a acabar y se me ha olvidado darle a que he hecho alguna o le he dado mal
al peso"*). Todo lo que se edita usa el MISMO editor de tramos
(`montarEditorDeTramos()` / `gymLeerTramosDe()`, montables sobre
cualquier contenedor):

- **En el entreno**: deslizando la tarjeta del ejercicio → "Editar" (ver
  el bloque siguiente).
- **En el historial**: en el modal de editar una sesión, cada serie tiene
  su editor de tramos (añadir, cambiar y quitar) y un botón "Al fallo".
  Ahí los tramos viven en unidades de PANTALLA (como `weightDisplay` de
  la serie) y se convierten a kg al guardar. Se leen del DOM y no del
  array, porque un tramo recién añadido puede estar confiando en la
  sugerencia gris y esa solo existe ahí.

## La tarjeta del entreno: para USARLA, no para editarla

Rediseño pedido por Koku el 9/9/2026, y el disparador fue un fallo real:
el botón flotante de acciones (⋮) tapaba la ✕ del ÚLTIMO ejercicio y no
se podía quitar. Eso se arregló aparte con un hueco al final de la lista
(`padding-bottom` en `.gym-live-exercises`), pero de ahí salió el
rediseño: *"yo deslizo el ejercicio entero para editar cualquier cosa
del ejercicio... se hace un cuadro de diálogo más grande, así es más
cómodo. Sin deslizar se puede comenzar serie, subir o bajar ejercicio y
ya, todo el resto deslizando, editar o eliminar"*.

**La tarjeta ya no tiene ni un campo donde escribir.** Peso, repes, RPE
y nota se VEN, no se tocan; el descanso es un dato, no un chip pulsable.
Lo que queda a golpe de toque: plegar/desplegar y empezar o terminar la
serie. La columna del ✓ también se fue (Koku: *"sabiendo que ahora te
aparece lo de — si no hay nada, esa columna te la puedes cargar"*);
`done` sigue existiendo por dentro, y marcar/desmarcar una serie vive
ahora en el diálogo del ejercicio. Los chips de la serie (fallo, tramos,
+30s) van en **su propia línea** debajo: metidos en la celda del número
se comían la columna de "Anterior". Eso tiene una consecuencia que hace que todo
encaje: **sin inputs, la tarjeta se puede deslizar sin pelearse con
nadie** — antes, arrastrarla habría chocado con meter el dedo en un
campo.

**Deslizarla da tres acciones**: Editar / Mover / Quitar.

- **Editar** abre `#gym-exercise-edit-modal`, un diálogo grande con el
  ejercicio ENTERO: descanso, RPE, nota, y cada serie con su peso,
  repes, nota, "al fallo", sus tramos y un ✕ para quitarla, más
  "+ Serie". Trabaja sobre una **copia** (`gymExerciseEditDraft`), así
  que Cancelar descarta de verdad. Al guardar, si la serie EN CURSO era
  de ese ejercicio y ha desaparecido al quitar series, se cancela — si
  no, quedaría un cronómetro corriendo sobre una serie inexistente y
  ningún otro ejercicio dejaría empezar.
- **Mover** sustituye a las flechas ↑↓ que había en la cabecera. No es un
  arrastre siempre activo (arrastrar sin más es hacer scroll): se ARMA
  desde ese botón y se desarma **solo al soltar**, tal como lo pidió
  (*"una vez sueltas tendrías que volver a darle a mover"*). Mientras
  está armado, el deslizamiento lateral de esa tarjeta se aparta
  (`bloqueadoSi` en `wrapRowWithSwipeActions`), así los dos gestos nunca
  se pisan. Ver `armarMovimientoDeEjercicio()` y
  `habilitarArrastreDeEjercicio()`.
- **Quitar** es lo de siempre: va al pool de quitados, recuperable.

**Trampa que costó la ronda entera**: `.note-swipe-wrap.is-open >
.gym-live-exercise-card` — la regla del transform en estado ABIERTO. Sin
ella la tarjeta se desliza mientras arrastras y **vuelve sola a su sitio
al soltar**, tapando otra vez los botones: *"se despliega, pero no se
mantiene, no puedo pulsar ninguna de las 3 opciones"*. CLAUDE.md ya
avisaba de que hacen falta las DOS reglas (transform abierto +
`is-dragging`) y se coló solo una. Y la prueba **no lo pilló** porque
miraba la clase `is-open`, que sí se ponía: al envolver una fila nueva
hay que comprobar el `transform` de verdad, o que el botón de acción esté
DESTAPADO con `elementFromPoint`.

Trampas que ya mordieron al construirlo:

- `habilitarArrastreDeEjercicio()` se llama MIENTRAS se construye la
  tarjeta, cuando todavía no está en el DOM: leer `parentElement` ahí da
  `null`. La lista de hermanos se mira en cada uso, no al enganchar.
- `setPointerCapture()` **lanza** si ese puntero ya no está activo (pasa
  con gestos que el sistema corta a medias). Va en un `try/catch`: no es
  imprescindible, y una excepción ahí dejaba el arrastre a medias.

Con esto desapareció `gymSegmentLinesHtml()` (las sub-líneas de solo
lectura del historial): ya no hacía falta, los tramos se ven en su
editor.

Verificado con 25 comprobaciones de Playwright, incluidas las raras:
`segments` que no es un array, tramos nulos o con `kind` inventado,
tramos sin repeticiones (se descartan) o sin peso, pausa no numérica,
un calentamiento con un tramo de 999 kg (no sale como PR), unilaterales,
quitar la serie madre a mano, recargar la app en medio del entreno,
series viejas sin el campo, 12 tramos seguidos, la unidad en libras, la
idempotencia de la migración, y que borrar la sesión no deja tramos
huérfanos.

## Series al fallo, y por qué el volumen deja de ser "kilos movidos"

Petición de Koku (9/9/2026): *"quiero poder marcar si llego al fallo en
una serie específica... para indicar que esa serie me ha exprimido al
máximo aunque haga dropset y no haga las mismas repes que en la primera,
para que se tenga en cuenta para las gráficas"*.

**Marcarlo**: un botón propio ("Llegué al fallo") en el mismo diálogo de
fin de serie, guardado en `set_type = 'failure'`, valor que el esquema ya
tenía reservado. Es por SERIE, no por ejercicio. Botón con su marca
cuadrada, no un checkbox nativo (regla de CLAUDE.md).

**Contarlo — decisión suya, y va contra mi recomendación**: se le
ofrecieron tres formas (solo etiquetar / un contador propio de series al
fallo / que además pese más en el volumen) y eligió la tercera. Le avisé
de que ponderar el volumen "se inventa peso que no levantaste"; lo eligió
igualmente, así que se hizo. **No deshacerlo sin volver a preguntarle.**
Las tres salvaguardas con las que se construyó:

1. **Lo GUARDADO son siempre los kg reales.** El factor se aplica solo al
   pintar. Las rutas (`/summary`, `/progress/:exerciseId`) devuelven el
   volumen real Y, aparte, cuántos de esos kg salieron de series al fallo
   (`failureVolumeKg`) — el ajuste lo hace el cliente con
   `gymVolumenAjustado()`. Por eso cambiar el factor no reescribe ningún
   historial: los mismos datos se vuelven a sumar con otro número.
2. **Es ajustable** (Gimnasio > Progreso > "Peso extra de una serie al
   fallo"): ×1 / ×1,1 / ×1,2 (por defecto) / ×1,25 / ×1,5. **×1 lo
   desactiva del todo.** Se dejó a mano precisamente porque el número es
   inventado: no hay cifra estándar para esto.
3. **Se aplica a la serie ENTERA**, tramos de dropset/rest-pause
   incluidos: lo que se llevó al fallo fue la serie completa. En SQL eso
   es un `COALESCE(p.set_type, st.set_type) = 'failure'` con un LEFT JOIN
   al padre, porque un tramo lleva su propio `set_type` ('dropset') y
   hereda el "fallo" de su madre.

Dónde cuenta: historial, mapa de músculos en modo volumen, gráfica
semanal, PRs (`bestVolumeKg`), gráfica de progreso del ejercicio, logros
y el resumen del entreno. El **peso máximo NO se ajusta nunca** — ese es
el peso que de verdad moviste. Piezas en `app.js`:
`gymSetVolumeRealKg()` (kg de verdad), `gymSetEsAlFallo()`,
`gymSetVolumeKg()` (lo que se pinta) y `gymVolumenAjustado()`.

Además hay un **contador de series al fallo**: en el resumen del entreno
y, si hay alguna, en Consistencia ("Series al fallo este mes").

**Bug arreglado de rebote**: el modal de "editar sesión" a mano no
mandaba `setType`, así que editar una sesión **borraba en silencio** la
marca de fallo (y la de calentamiento). Ahora viaja igual que los tramos.

## Al acabar el descanso: que no se te pase la siguiente serie

Koku: *"cada vez que acaba el tiempo de descanso se me olvida darle a
empezar serie"*. Ofreció dos vías (botón grande o que empiece sola) y al
preguntarle eligió **las dos, con interruptor**:

- **Siempre**: el botón "Empezar serie N" del ejercicio cuyo descanso
  acaba de terminar se pone grande y con latido, y la mini-barra global
  (con el entreno oculto) deja de ser una cuenta atrás y pasa a decir
  "Empezar serie N" — **tocarla arranca la serie**, además de llevarte al
  entreno.
- **Opcional** (Configuración > Notificaciones > "Empezar la siguiente
  serie sola", **apagado de fábrica**): la serie arranca sola. El "?" de
  esa fila avisa del precio: el cronómetro cuenta desde ese momento, así
  que lo que tardes en volver a la máquina se suma a la serie.

Detalles que importan:

- **Solo si queda serie pendiente**, tal cual lo pidió. Nunca inventa una
  serie extra — eso lo hace `gymStartSet` cuando ya están todas hechas, y
  aquí se comprueba antes con `gymNextPendingSetIndex`.
- Quién es "el que le toca" sale de `gymLiveSession.restSetRef`, que
  apunta a la serie cuyo descanso estaba corriendo y **no se borra al
  vencer**, así que sigue sirviendo después.
- `gymLiveSession.restEndedAt` enciende el aviso y `gymStartSet()` lo
  apaga, así que no se queda puesto para siempre.
- El latido obedece solo al interruptor de Animaciones, gratis, gracias a
  la regla global `:root[data-animations="off"] *`.

## El aviso de descanso se borra solo al volver a la app

Koku: *"si hay una notificación y entro en la app, que se borre, y así no
hace falta que la borre manualmente cada vez"*. `gymCleanupRestNotificationStack()`
ya se llamaba en el foreground (`visibilitychange` + `resume`), pero solo
quitaba las repeticiones 902/903 y dejaba puesta la principal (901).
Ahora las quita todas.

Cubre los dos casos de una vez: tocar el aviso abre la app, y volver a
ella por tu cuenta lo limpia igual. **Solo los avisos del descanso** (los
ids reservados) — se le preguntó y prefirió que los recordatorios de
eventos se queden hasta que él los quite. Y no pelea con la vigilancia de
audio que calla la vibración: abrir la app ya la callaba, esto va en la
misma dirección.

## Cerrar tocando fuera, y la versión a la vista

Dos peticiones pequeñas de Koku de la misma ronda.

**Tocar fuera cierra** (`cerrarModalAlTocarFuera(modalId, cerrar, hayCambios)`
en `app.js`): puesto de momento en los DOS diálogos grandes del Gimnasio,
el del historial (`gym-session-modal`) y el de editar un ejercicio del
entreno (`gym-exercise-edit-modal`), que son los que él nombró. Detalles
que no son obvios:

- **Solo el fondo**: `if (e.target !== modal) return`. Un toque dentro de
  la tarjeta llega igualmente por burbujeo, pero con `e.target` apuntando
  a lo de dentro.
- **Si hay cambios sin guardar, pregunta** antes de tirarlos
  (`showAppConfirm`, destructivo). "Hay cambios" se marca con
  `dataset.sucio`: cualquier `input` dentro del modal, o pulsar cualquier
  botón que NO sea el de cerrar/cancelar (añadir una serie, marcar al
  fallo, quitar un tramo...). Hacer scroll no genera clicks sobre
  botones, así que no cuenta — se comprobó.
- **La marca se limpia AL ABRIR**, no al cerrar: cerrar con la ✕ o
  guardando no pasa por este código, y si se limpiara solo ahí el modal
  se reabriría creyéndose sucio y preguntaría sin motivo.
- **`dataset.preguntando`**: dos toques seguidos en el fondo abrían dos
  preguntas apiladas y la de abajo se quedaba colgada esperando una
  respuesta que ya nadie iba a dar. Con la marca, el segundo toque no
  hace nada. Y tras responder que sí se vuelve a mirar si el modal sigue
  abierto, por si se cerró por otra vía mientras se preguntaba.

**La versión** (`APP_VERSION` / `APP_VERSION_DATE` / `renderAppVersionLine()`
en `app.js`, se ve en Configuración → Este dispositivo): se escribe **a
mano** en cada ronda, junto al número de `package.json` — la app no tiene
paso de compilación que pueda inyectarlo, así que este es el único sitio
donde vive de cara al usuario. **Si subes la versión, tócala aquí
también.** La fecha se formatea con `Intl.DateTimeFormat(undefined, ...)`
para seguir el formato del SISTEMA (Koku: *"por si tienen mm/dd/aa y no
dd/mm/aa"*), con la ISO como red de seguridad si Intl falla.

**Los bloques de valores del historial** (Peso / Reps / Descanso) se
descuadraban cuando la etiqueta del descanso llevaba el chip `+60` y
pasaba a dos líneas: los tres campos son hermanos flex, y sin
`align-items: stretch` en `.gym-set-segment-fields` + `justify-content:
flex-end` en `.gym-set-segment-field`, el input del descanso bajaba solo.
Ahora los tres arrancan y acaban a la misma altura (comprobado midiendo
los rectángulos, no a ojo).

## El ciclo de días de un bloque

Petición de Koku (9/9/2026): *"que en el bloque de entrenamiento te
permita poner como opcional cuánto dura la rutina (en día): lunes
entreno x, martes entreno y, miércoles descanso, jueves entreno x otra
vez"*, para engancharlo con el calendario y con el widget.

**El modelo**: el bloque guarda si usa ciclo (`cycle_enabled`) y por
dónde va (`cycle_position` + `cycle_position_date`), y las posiciones
viven en una tabla aparte, `gym_block_cycle_days` (`block_id`,
`position`, `routine_id`). **`routine_id` a NULL es un DESCANSO**, que es
una posición de verdad y no un hueco que haya que adivinar.

Tabla aparte y no un campo en `gym_routines` a propósito: así **un mismo
día de entreno puede repetirse** en varias posiciones (día 1 y día 4 de
un ciclo de 6), que con un campo por rutina sería imposible.

**Las tres decisiones que tomó Koku**, no cambiarlas sin volver a
preguntarle:

1. **El ciclo avanza por ENTRENOS HECHOS, no por calendario.** Si te
   saltas el martes, el miércoles te sigue tocando lo mismo: el plan no
   te deja atrás. La excepción es un **descanso**, que se consume solo al
   pasar el día — si no, te bloquearía el ciclo para siempre. Por eso
   hace falta `cycle_position_date`: para saber desde cuándo lleva puesta
   la posición actual. `resolverCiclo()` en `routes-local/gymBlocks.js`
   solo adelanta descansos ya pasados, uno por día transcurrido, con un
   tope de vueltas por si el ciclo fuera todo descansos.
2. **El "hoy te toca" del calendario es CALCULADO, no una tarea
   guardada.** No se crean filas de `events`: `gymCicloDeHoy()` mira el
   ciclo cada vez. Siempre está al día, cambiar el plan lo cambia solo, y
   no quedan tareas viejas que regenerar ni limpiar.
3. **Si hoy toca descanso y te apetece entrenar, entrenas** — te avisa,
   pero no te lo impide. Y al terminar, si lo que has hecho **no era lo
   que tocaba**, se pregunta dónde recolocar el ciclo, que es lo que él
   pidió para que el aviso y el widget sepan cómo seguir. Tres caminos en
   `gymAvanzarCicloTrasEntrenar()`:
   - Era lo que tocaba → avanza solo y en silencio (el caso normal).
   - Has hecho otro día **que sí está en el ciclo** → pregunta
     "¿recoloco el ciclo ahí?", diciendo qué te tocaría mañana.
   - Entreno libre o un día que no está en el ciclo → solo avisa de que
     el ciclo se queda donde estaba (no hay nada sensato a lo que
     saltar).

**Quién mueve el cursor es el CLIENTE** (`POST /:id/cycle/position`), no
la ruta de guardar la sesión: cuando lo entrenado no es lo que tocaba
hace falta preguntar, y esa pregunta vive en la pantalla.

**Dónde se ve**:
- **Ficha del bloque**: sección "Ciclo de días" con su interruptor y la
  lista ordenada de posiciones, cada una con un `createSelectField` (día
  del bloque o "Descanso") y flechas ↑↓ + ✕. Encenderlo con el ciclo
  vacío propone una posición por cada día del bloque. El ciclo se edita
  en un **borrador** (`gymCicloBorrador`) y solo se guarda al dar a
  Guardar, igual que el nombre — Cancelar descarta de verdad. En un
  bloque NUEVO la sección entera está oculta: hasta que no existe no
  tiene días que colocar.
- **"¿Qué toca hoy?"**: el día que toca va primero y marcado "Hoy"; si
  toca descanso, lo dice y deja elegir igualmente.

**En el CALENDARIO no se ve nada, y es a propósito.** Llegó a haber una
tira bajo la cabecera del día ("Hoy toca Empuje · día 1 de 3"), y Koku la
quitó el mismo día: *"que te muestre lo de qué entrenamiento toca en el
calendario realmente no me aporta nada, era más bien el que pudiera saber
el widget qué día es y así saber a qué día está enlazado cada
entrenamiento"*. O sea: **el ciclo no existe para pintar el calendario**,
existe para que el Gimnasio sepa qué ofrecerte y para alimentar el
widget. Si algún día vuelve a hacer falta, `gymCicloDeHoy()` da todo lo
necesario en una sola llamada (bloque, posición, día y si es descanso).

Y el motivo de que aquí no haya "qué toca mañana" tampoco le preocupa —
lo dijo él: *"supuestamente te sabes lo que toca, esto es sólo para
facilitar el acceso desde un botón"*. El ciclo es un atajo, no una
agenda.

**`hoyISO()` usa la fecha LOCAL, no `toISOString()`**: a las 00:30 en
España el UTC todavía es el día anterior y el ciclo se quedaría un día
atrás.

**Lo que aguanta** (26 comprobaciones de Playwright, `ciclo.mjs` y
`ciclo-raros.mjs`): un ciclo de solo
descansos con nueve días pasados (no se cuelga), una posición que apunta
a un día borrado (se lee como descanso), posiciones inventadas en la
ruta (99, -1, 0, texto, null, 1.5 — todas rechazadas), un día de otro
bloque en el ciclo (se guarda como descanso), un ciclo de 61 días
(rechazado), un ciclo encendido pero vacío, el cursor apuntando a una
posición recortada por debajo (vuelve al día 1), una fecha futura en el
cursor por si alguien mueve el reloj, y que borrar el bloque no deja
posiciones huérfanas.

**Sin empezar todavía**: el widget que lea esto. El modelo ya está
pensado para él (una sola lectura da "qué toca hoy" y el id del día para
arrancarlo), pero la parte nativa está por hacer.

## Buscar ejercicios (y adiós al último `<select>` nativo)

Petición de Koku (9/9/2026): *"que en los ejercicios que yo creo de 0 me
pusiera una opción para filtrar o buscar, porque si tengo muchos
diferentes se hace un poco una odisea"*. Se hizo en los DOS sitios donde
duele, no solo en el que nombró:

**1. Tu lista de ejercicios** (pestaña Plan): un campo encima del listado
que filtra por **nombre, músculo y material** — así "pierna" saca todas
las de pierna aunque ninguna se llame así. Sin tildes y en minúsculas
(`gymNormalizarBusqueda`), para que "biceps" encuentre "Bíceps". **Solo
aparece a partir de 8 ejercicios** (o si ya hay algo escrito): con cuatro
sería una fila desperdiciada. El filtro vive en memoria
(`gymExercisesFiltro`), **NO en localStorage**: un filtro que sobrevive a
cerrar la app hace pensar que has perdido ejercicios.

**2. Los desplegables para elegir ejercicio**, que eran los **dos últimos
`<select>` nativos de la app** — el de la fila de un día del plan y el de
editar una sesión del historial. CLAUDE.md los tenía apuntados como
descuido conocido desde que se puso la regla de no usar controles del
navegador; se han ido con esta ronda. **Ya no queda ni un `<select>`
nativo en toda la app** (comprobado contando `document.querySelectorAll('select')`).

Para eso, `createSelectField()` acepta ahora **`searchable: true`**, que
le mete un buscador dentro del popover. Detalles:

- El buscador y la lista son **hermanos dentro del popover**, y
  `renderOptions()` repinta solo la lista — si repintara el popover
  entero, escribir destruiría el campo y perderías el foco a media
  palabra.
- La cabecera va **`position: sticky`**: con ~870 ejercicios, tener que
  volver arriba del todo para reescribir sería justo el problema que esto
  viene a arreglar. Y con `.has-search` el relleno pasa del popover a la
  lista, o por ese hueco se verían pasar las opciones por detrás.
- **No se enfoca solo** a propósito: en el móvil, abrir el teclado nada
  más desplegar tapa media lista, y muchas veces solo quieres mirar.
- **Enter no envía el formulario** de alrededor (estos desplegables viven
  dentro de modales con `<form>`).
- **Cada apertura empieza con la lista entera**: un filtro heredado de la
  vez anterior parece que faltan ejercicios.
- Clicar dentro del buscador no cierra el popover porque el listener
  global de `settings.js` ya ignora los clics dentro de `.select-popover`.

Las opciones llevan el músculo pegado al nombre (`Curl martillo ·
Bíceps`, `gymExerciseSelectOptions()`): con la librería importada hay
ejercicios que se llaman casi igual, y además deja buscar por músculo.

**Bug encontrado forzando fallos, no en el uso normal**: escribir **solo
espacios** en el buscador de la lista vaciaba el listado, porque
`normalizar('   ')` no es cadena vacía y se buscaba literalmente `"   "`.
En el móvil eso pasa con facilidad (el autocorrector mete espacios) y
parecería que has perdido los ejercicios. Va con `.trim()`. La versión
del popover ya lo hacía bien; a la de la lista se le escapó.

## El teclado del móvil y las pantallas completas

Koku, escribiendo en el buscador de ejercicios: *"me deja moverme todo
hasta abajo y ver la barra de estado estando el teclado en la pantalla"*.

Es **el mismo problema que ya se arregló en el editor de notas**, y por
la misma causa: con el teclado abierto el teléfono NO encoge la ventana,
la deja igual de alta y tapa la parte de abajo. Una capa
`position: fixed; inset: 0` — que es lo que son TODAS las
`.my-space-view` (Gimnasio, Notas, Viajes, Finanzas, Lecturas, Grupos,
el buscador global) — sigue midiendo la ventana ENTERA, así que su mitad
inferior queda debajo del teclado y el sistema deja arrastrar la vista
entera para llegar a ella, arrastrando de paso la barra de estado a la
vista.

En vez de repetir el arreglo de las notas capa por capa, ahora hay **un
solo anclaje genérico** (`empezarAnclajeDeCapa` / `soltarAnclajeDeCapa`
en `app.js`), enganchado a `focusin`/`focusout` del documento: en cuanto
enfocas un campo de texto dentro de una `.my-space-view` visible, esa
capa recibe el alto y el desplazamiento REALES que dice `visualViewport`
y la página se deja quieta. Ventaja: **una pantalla nueva con un campo
de texto nace ya arreglada**, sin acordarse de nada.

Detalles que importan:

- **El editor de notas queda FUERA a propósito**
  (`:not(.note-editor-view)` en el selector): tiene su propio anclaje,
  que además mueve el cursor para que no lo tape el teclado. Dos
  anclajes sobre la misma capa se pisarían.
- **Solo los campos que abren teclado**: un checkbox, un radio o un
  botón no lo abren y no deben anclar nada (`CAMPOS_CON_TECLADO`).
- **Un campo dentro de un MODAL no ancla la capa de detrás**: el modal
  es su propia capa fija, con su propio bloqueo de scroll.
- **El `focusout` espera un ciclo** (`setTimeout(…, 0)`): al saltar de un
  campo a otro llega el focusout del primero ANTES que el focusin del
  segundo, y sin esa espera el anclaje se soltaba y volvía a ponerse en
  cada salto, dando un parpadeo.
- **Se limpian los estilos en línea al soltar**: si se quedaran, la capa
  mantendría el alto del hueco con teclado y quedaría corta al cerrarlo.
  Comprobado cerrando la pantalla con el campo aún enfocado.

## Deslizar también los ejercicios (y el buscador dentro del desplegable)

Koku: *"por seguir un poco con la misma dinámica en todo, en vez de
botón, hazlo deslizable"*. Las filas de tu lista de ejercicios perdieron
el lápiz y se envuelven con `wrapRowWithSwipeActions` como todo lo demás
(notas, carpetas, sesiones del historial, tarjetas de grupo). Editar y
Eliminar salen deslizando.

`.gym-list-item` ya estaba en las DOS reglas necesarias de `styles.css`
(el `transform` en `is-open` y el `transition: none` en `is-dragging`),
porque las sesiones del historial ya lo usaban — no hizo falta CSS nuevo.
La prueba comprueba el `transform` de verdad y que el botón quede
DESTAPADO con `elementFromPoint`, no la clase `is-open` (la trampa que ya
mordió una vez).

**Borrar desde ahí respeta la regla del servidor**: un ejercicio con
series ya apuntadas no se puede borrar (`has_history`), y ese error se
cuenta con palabras en vez de soltar el código.

**El desplegable enseña SOLO el nombre.** Llevaba el músculo pegado
(`Curl martillo · Bíceps`) y Koku lo quitó: *"deja sólo el nombre, el
músculo no hace falta que aparezca... ten en cuenta que muchos
ejercicios a veces ya llevan el músculo en el nombre"* — "Curl de Bíceps
· Bíceps" se leía repetido. Pero el músculo y el material **siguen
viajando en `keywords`**, un campo de opción que el buscador SÍ mira y
la lista NO enseña: escribir "pierna" sigue sacando todas las de pierna.

**La barra del buscador parecía descuadrada** hacia la derecha. Medido en
el navegador salía simétrico (7px y 7px), así que no era el margen: era
**la barra de desplazamiento corriendo pegada al campo**. Ahora quien se
desplaza es la LISTA y no el popover entero
(`.select-popover.has-search { overflow: hidden !important }` — el
`!important` es porque `positionFixedPopover()` pone `overflow-y: auto`
en LÍNEA), así que la barra va solo al lado de las opciones. De paso la
cabecera queda de verdad fuera del scroll y ya no necesita
`position: sticky`.

## "Hoy te toca": por dónde vas en el ciclo

El agujero que encontró Koku usándolo: *"yo ahora para el bloque creado
tengo 3 días, descanso, 2 días, descanso. Hoy me tocaría hacer el primer
descanso, no el día 1... ¿cómo se puede corregir eso?"*. Un ciclo recién
creado empieza SIEMPRE por el día 1, aunque tú ya lleves media vuelta
hecha, y no había forma de decírselo.

Ahora la ficha del bloque tiene un **"Hoy te toca"**
(`renderGymCicloHoyField`) con las posiciones del ciclo por su nombre
("Día 4 · Descanso"). La ruta ya existía (`POST /:id/cycle/position`);
lo que faltaba era la pantalla.

- Es parte del **borrador**, como el resto del ciclo: se elige aquí y se
  manda al guardar, no al vuelo. Cancelar lo descarta.
- Se manda **después** del `PUT /cycle`: la ruta rechaza una posición
  que no exista, y las posiciones válidas son las que acaban de
  guardarse.
- La fecha se pone a hoy sola, así que un descanso elegido aquí **se
  consume mañana**, como cualquier otro.
- Si acortas el ciclo por debajo de donde estabas, vuelve al día 1 en vez
  de dejar un valor que ya no existe.

**Bug encontrado forzando fallos**: con una posición imposible metida a
mano, la ruta lanzaba y el error se llevaba por delante TODO lo que
venía después del `await` — el modal se quedaba abierto y la lista sin
refrescar, aunque el ciclo sí se hubiera guardado. Ahora la posición se
recorta al rango ANTES de mandarla y la llamada va en `try/catch`: que no
se pueda mover el cursor nunca impide guardar el ciclo, que es lo
importante.

## Widgets de iOS: el primero, "Qué toca hoy"

Primera tanda de widgets, elegida por Koku: **solo el del Gimnasio**, en
**pantalla de inicio + pantalla de bloqueo + centro de control**, y
**sin refresco por horas** (lo repinta la app cuando cambia algo).

### Lo que hay que entender antes de tocar nada

**Un widget NO puede leer la base de datos.** La base es SQLite
compilado a WebAssembly y vive dentro de la webview, en IndexedDB; el
widget es código nativo aparte que iOS ejecuta con la app cerrada. No
hay forma de que llegue hasta ahí.

La única vía es un **App Group**: un buzón compartido entre la app y la
extensión. La app deja un resumen pequeño en JSON y el widget lo lee.
Grupo: `group.com.koku.remindmelater`.

**El App Group es una capacidad de FIRMA, no solo código.** Los dos
targets llevan su `.entitlements` declarándolo
(`CODE_SIGN_ENTITLEMENTS` en las cuatro configuraciones), y el App ID de
Apple tiene que tenerla dada de alta. El pipeline firma con
`-allowProvisioningUpdates` y una clave de App Store Connect, así que
Xcode PUEDE crearla solo — pero es justo el paso que más falla. **Si una
build casca firmando, es esto**: se arregla dando de alta el grupo una
vez en el portal de desarrollador (o abriendo el proyecto en Xcode con la
cuenta y dejando que lo cree).

### Las piezas

- **`public/widget-bridge.js`** — arma el resumen y se lo pasa al plugin.
  Mismo patrón perezoso que `local-notifications.js`: en un navegador
  normal no hay plugin y todo es no-op.
- **`ios/App/App/WidgetBridgePlugin.swift`** — plugin local (registrado a
  mano en `BridgeViewController`, como `LiveActivityPlugin`). Dos
  métodos: `guardarResumen` (escribe y llama a
  `WidgetCenter.reloadTimelines`) y `consumirApertura`.
- **`ios/App/DescansoWidget/QueTocaHoyWidget.swift`** — el widget. Va en
  la extensión que YA existía (la de la Live Activity del descanso), no
  en un target nuevo: eso ahorra la parte más frágil del proyecto de
  Xcode.
- Los `.entitlements` de los dos targets.

### Decisiones y trampas

- **El JSON no se interpreta en el plugin**: llega montado desde
  JavaScript y solo se guarda. Así añadir un campo al resumen no obliga a
  tocar nada nativo.
- **El decodificador del widget se escribe A MANO** con `try? decode` y
  valores por defecto. El sintetizado de Swift **no usa los valores por
  defecto cuando falta una clave: falla**. Y el resumen guardado
  sobrevive a las actualizaciones, así que uno viejo sin campos nuevos
  dejaría el widget en blanco.
- **El `kind` tiene que coincidir carácter a carácter** entre
  `QueTocaHoyWidget.kind` y el `reloadTimelines(ofKind:)` del plugin. Si
  no, la app cree que lo refresca y el widget se queda con lo de antes.
- **Dos caminos de apertura, dos marcas**: tocar el widget abre
  `remindmelater://gym-hoy` y `SceneDelegate` deja la marca en
  `UserDefaults.standard`; el botón del centro de control ejecuta un
  `AppIntent` que **no manda ninguna URL**, así que deja la marca en el
  App Group. `consumirApertura` mira los dos sitios.
  Ojo: `gym-live` (la tarjeta del descanso) y `gym-hoy` (el widget) son
  cosas distintas — una reanuda algo en curso y la otra arranca algo.
- **Con un entreno ya en marcha, el widget lo ABRE, no empieza otro.**
  Perder un entreno a medias por tocar un widget sería carísimo.
- **Si hoy toca descanso, abre el selector** en vez de arrancar nada: el
  widget es un atajo, no una decisión.
- **Arranque en frío**: al abrir la app desde cero tocando el widget no
  se disparan ni `resume` ni `visibilitychange`, así que la marca se mira
  TAMBIÉN al final de `init()`.
- **`#if compiler(>=6.0)` alrededor del botón del centro de control**:
  `ControlWidget` no EXISTE en el SDK de iOS 17 y anteriores, así que con
  un Xcode viejo no es que no se ejecute — es que no compila.
  `@available` no basta para eso.

### Cómo se ha verificado (y qué NO)

**El Swift no se puede compilar aquí** (contenedor Linux, sin Xcode). Lo
que sí se hizo:

- Un analizador propio de Swift (`scratchpad/swiftcheck.py`) que recorre
  los archivos carácter a carácter llevando la cuenta de comentarios (los
  de bloque **anidan** en Swift), cadenas y su interpolación `\(...)`.
  Un regex normal se traga medio archivo en cuanto hay un
  `\(n == 1 ? "" : "s")`.
- Un comprobador del `pbxproj` (llaves, secciones, ids usados pero no
  definidos, ids duplicados) porque ahí no hay `plutil` en Linux.
- Comprobación cruzada de que las constantes compartidas, el `kind`, el
  App Group de los entitlements y las claves del JSON coinciden entre el
  JavaScript y el Swift.
- 10 comprobaciones de Playwright del lado JS **fingiendo el plugin
  nativo**, más 9 de forzado (el plugin lanzando, sin App Group, la
  apertura consumida dos veces, un día del ciclo borrado, sin bloques,
  nombres con comillas y emojis, 50 llamadas seguidas, y que el resumen
  no lleve nada personal de más).

Trampa del banco de pruebas, apuntada por si se repite: **fingir
`window.Capacitor` con `addInitScript` NO funciona** — el runtime de
Capacitor que trae la propia página lo redefine al arrancar. Hay que
parchearlo DESPUÉS de cargar y limpiar la caché perezosa de
`widget-bridge.js` (`widgetBridgePlugin = null; widgetBridgeNoDisponible
= false`).

**Lo que solo se puede confirmar en el iPhone**: que compile, que Apple
cree el App Group, que el widget aparezca en la galería, y que tocarlo
arranque el entreno.

**ESTO ES SOLO DE iOS.** Android tiene su propio sistema de widgets
(`AppWidgetProvider` + `RemoteViews`, nada que ver con WidgetKit) y no se
ha tocado: sería un trabajo aparte, con su propio puente. La parte de
JavaScript (`widget-bridge.js`) sí serviría igual — lo que cambia es todo
lo nativo.

## Estado actual

**Rama de trabajo: `calendario-notas-movil-UI`** (esta conversación de
configuración del visor móvil trabaja en `claude/mobile-viewer-config-b59uf1`,
creada desde `movil-ui` y con `calendario-notas-movil-UI` ya fusionada).
Reorganización de ramas del 8/9/2026, pedida por Koku:

- **`movil-ui` ya NO se toca** salvo que Koku lo pida explícitamente:
  queda solo como rama de integración para compilar y probar ipa/apk.
  Cuando el trabajo de una rama de área está funcional, se combina ahí
  (la primera combinación ya está hecha: gimnasio-movil + finanzas-movil
  + viajes-movil + la copia de seguridad, merges limpios, humo en verde,
  build de iOS #32 lanzado).
- El trabajo se hace por separado en ramas por área:
  `calendario-notas-movil-UI` (calendario y notas), `gimnasio-movil`,
  `finanzas-movil`, `viajes-movil`.
- Las ramas viejas ya terminadas se renombraron con prefijo
  `archivo/` (git no tiene "cerrar" una rama: o existe o no; el prefijo
  las agrupa al final de la lista sin perder nada).

En `movil-ui` (y por herencia aquí) vive la app móvil sin servidor. `main` sigue teniendo la versión vieja cliente-servidor, y la
rama `escritorio` es donde Koku trabaja el programa de escritorio por su
cuenta — no las toques desde aquí.

Últimos commits en `origin/movil-ui`:

- (esta ronda) — **Copia de seguridad + workflow de Android**:
  - `public/backup.js` (nuevo): exportar crea un `.json` con TODO (la
    base SQLite en base64, todas las imágenes/fotos de `noteAssets`, y
    el localStorage entero) y lo manda por la hoja de compartir del
    sistema (`Filesystem`+`Share` de Capacitor, registrados con el
    mismo patrón perezoso de `local-notifications.js`; en navegador,
    descarga normal). Importar valida el archivo (incluye abrir la base
    de prueba ANTES de borrar nada), avisa con `showAppConfirm`
    (destructivo), y restaura base+fotos+ajustes con `location.reload()`
    al final — una copia de una versión vieja migra sola al arrancar
    (`applyLocalSchema`). Detalle importante del import: se pone
    `sqlDatabase = null` antes de escribir los bytes nuevos, para que
    ni el volcado agrupado pendiente ni el de `pagehide` pisen lo
    importado con la base vieja en memoria.
  - Recordatorio: si pasan ~30 días sin copia (`lastBackupAt`, o
    `backupFirstOpenAt` si nunca hubo), un aviso discreto flotante al
    abrir; la ✕ lo pospone 7 días (`backupReminderSnoozedAt`), tocarlo
    abre Configuración → Este dispositivo. UI (Exportar/Importar +
    "Última copia: ...") en ese mismo panel.
  - `db-local.js`: `assetGetAll()`/`assetClear()` nuevos.
  - Android: `.github/workflows/android-play.yml` (manual, compila un
    `.aab` FIRMADO para Google Play y lo deja como artefacto — la
    subida a Play Console es a mano), firma cableada en
    `android/app/build.gradle` vía propiedades `-P` (sin nada del
    keystore en el repo; secretos `ANDROID_KEYSTORE_BASE64`/
    `ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_ALIAS`/
    `ANDROID_KEY_PASSWORD`, solo por la web de GitHub), y guía completa
    en `ANDROID-PLAY.md` (keytool, Play Console, probadores internos).
    **El workflow NO se ha lanzado** (regla de Actions). La primera
    ejecución real con sus secretos será la primera prueba real.
- `8a89a72` — Ronda G: nota nueva vacía no se guarda + cursor esquiva
  el teclado + reglas nuevas en CLAUDE.md.
- `29b2233` — **Fase 1**: SQLite dentro del propio móvil (sql.js
  vendorizado + `local-schema.js` + `local-db.js`).
- `f721bf1` — **Fase 2**: el backend entero corre dentro de la app
  (shim de Express + 25 archivos en `public/routes-local/`, `api()`
  despachando contra el motor local).
- `9360c09` — **Fase 3**: entrada directa (fuera la pantalla de
  vinculación), avisos nativos con `@capacitor/local-notifications`, y
  fuera todo lo que dependía del servidor (sincronización, Archivos,
  emparejamiento, push, aviso de versión).
- `9f65425` — **Fase 4**: limpieza final del cliente (`db-local.js`
  reescrito, CSS muerto fuera, `settings.js` sin Dispositivos/QR/push)
  y `README.md` reescrito para la app sin servidor.

Antes de eso, en la misma rama: la prueba de Capacitor (`0500249`), el
pipeline de iOS con GitHub Actions (`798d2c9` + 3 commits de arreglos
de firma), y las 5 fases del rediseño móvil.

**Verificación hecha en las 4 fases**: comparación diferencial entre el
servidor Express real y el motor portado (79 peticiones idénticas, 0
diferencias, incluidas las agregaciones de Finanzas, el progreso de
Gimnasio y los borrados en cascada de Viajes), más pruebas de extremo a
extremo con la app servida como estático puro, sin ningún backend.

**Copia de seguridad: YA EXISTE** (ronda de esta ventana, ver arriba).
Diseño acordado con Koku: export por la hoja de compartir del sistema,
manual + recordatorio de ~30 días, y TODO dentro del archivo incluidas
las fotos. Sigue sin haber sincronización en vivo entre dispositivos —
la copia es la forma de pasar datos de un aparato a otro.

## Pendiente / próximos pasos declarados

- **BANCO DE PRUEBAS — animaciones de zoom del calendario (ronda del
  8/9/2026, en esta rama)**: pellizcar sube de nivel (día→mes,
  mes→año; NUNCA al revés, decidido así por Koku) y hay animación de
  zoom al cambiar de nivel (in al bajar, out al subir) + interruptor
  "Animaciones" en Configuración → Este dispositivo
  (`localStorage.animationsEnabled`, apagado también salta las de
  deslizar). Koku avisó EXPLÍCITAMENTE que quiere verlo en su móvil y
  que **es posible que se retire** — si pide volver atrás, las piezas
  son: `attachPinch()`/`playMobileZoomTransition()`/
  `areAnimationsEnabled()` y sus llamadas en `setCalendarViewMode`/
  `enterMobileDayView`/`exitMobileDayView` (app.js), las keyframes
  `mobile-zoom-*` (styles.css), y el bloque "Animaciones" de
  index.html/settings.js.
- **Compartir → RemindMeLater (fecha detectada → evento) — QUITADO DE
  ESTA RAMA, aplazado**: se construyó el 8/9/2026 en
  `calendario-notas-movil-UI`, llegó aquí con el merge, y Koku pidió
  sacarlo el 9/9/2026 ("debería estar quitado ahora, en las pruebas en
  la rama no funcionaba correctamente, por lo que se había aplazado").
  **No volver a meterlo hasta que él lo retome.**
  - Qué se quitó: `public/share-import.js` y su `<script>` de
    index.html, `ios/App/CompartirExtension/` entera, el target
    `CompartirExtension` del `project.pbxproj` (todos los ids con
    prefijo `CE5CA250`, más sus líneas en las listas de children,
    buildPhases, dependencies, targets y TargetAttributes) y la sección
    del README.
  - Qué NO se quitó, a propósito: el esquema de URL `remindmelater://`
    del `App/Info.plist` — lo usa TAMBIÉN el widget de descanso del
    Gimnasio (`remindmelater://gym-live`, ver SceneDelegate) y quitarlo
    lo rompería. Y la dependencia `@capacitor/app` sigue en
    package.json: ya no la usa nadie, pero sacarla obliga a regenerar
    los archivos nativos con `cap sync`, y como esto está aplazado (no
    cancelado) sale más a cuenta dejarla puesta.
  - **Dónde está el código para recuperarlo**: intacto en la rama
    `calendario-notas-movil-UI` y en su commit `73cbdbc`. Recuperarlo es
    un cherry-pick de ese commit, no reescribirlo.
  - Estado real cuando se aplazó: **compilaba bien** (build #34 de iOS:
    el target se compiló, el `.appex` se incrustó en `App.app/PlugIns/`
    y `ValidateEmbeddedBinary` pasó), pero **en el iPhone real no
    terminaba de funcionar**. Koku no dijo QUÉ falla exactamente, y es
    lo PRIMERO que hay que preguntarle al retomarlo, porque cada
    síntoma apunta a una causa distinta:
    - No aparece en la hoja de compartir → `NSExtensionActivationRule`
      del Info.plist de la extensión.
    - Aparece pero no abre la app → el truco de la cadena de
      responders (`openURL:`) está cada vez más restringido por Apple;
      la alternativa moderna sería un App Group compartido (la
      extensión escribe el texto ahí y la app lo lee al abrirse) en vez
      de pasar el dato por la URL.
    - Abre sin datos → el esquema de URL o el `appUrlOpen`.
  - La parte de ANDROID (intent-filter + forwarding nativo) nunca llegó
    a construirse.
- **Vibración de los avisos — ARREGLADA (misma ronda)**: el plugin de
  notificaciones solo pone sonido si se le pasa `sound` (comprobado en
  su fuente), y sin sonido iOS entrega el aviso en silencio total (ni
  vibra). Ahora cada aviso lleva `sound: 'default'` (iOS cae al sonido
  del sistema al no existir ese archivo → suena y vibra) y en Android
  un canal propio `recordatorios` con `vibration: true`
  (`ensureRemindersChannel()` en local-notifications.js). Solo
  comprobable de verdad en el iPhone de Koku.

- **Comunicación escritorio↔móvil en la v1** (nota que Koku pidió dejar
  apuntada expresamente): cuando la app de escritorio (rama
  `escritorio`, suya) y esta app móvil lleguen las dos a la versión 1,
  la idea es que puedan comunicarse para pasar la copia de seguridad al
  ordenador (y similares). Sin diseñar — solo constancia.
- **Probar en su iPhone**: Koku instala desde TestFlight
  (`IOS-TESTFLIGHT.md` tiene la guía completa). Las notificaciones
  locales reales, el arranque directo y ahora la hoja de compartir de
  la copia de seguridad solo se pueden confirmar ahí, no desde este
  contenedor.
- **Android**: workflow hecho (`android-play.yml`, ver arriba) pero
  NUNCA ejecutado — a Koku le quedan los preparativos de
  `ANDROID-PLAY.md` (keystore + 4 secretos + cuenta de Play Console) y
  lanzarlo él cuando quiera.
- **Fusionar `movil-ui` con `escritorio`**: móvil y escritorio son dos
  programas independientes que hoy comparten `public/`. Cuando toque
  fusionar habrá conflictos ahí; Koku dijo que preguntará qué falta en
  cada lado y se resuelve entonces. No adelantarse.
- **Rama `gimnasio-movil` (de Koku, NO tocar)**: tiene su propia rama
  bastante desarrollada con un rediseño de Gimnasio ("ya verás cuando
  haga merge"). Se puede mirar en solo-lectura si hace falta contexto,
  pero NUNCA tocarla ni fusionarla — lo hará él.
- **Idiomas**: selector español/inglés, apuntado hace mucho y
  explícitamente aplazado. No empezar sin que lo pida.
- **Botones "?" por la app**: hay una lista de sitios candidatos en
  `IDEAS-AYUDAS.md`, en la raíz del repo, pendiente de que Koku marque
  cuáles quiere. **No hacer ninguno hasta que responda.** Ese documento
  es de trabajo, no documentación del proyecto: cuando se decidan, se
  hacen y se vacía.
- **Guías de uso dentro de la Tienda**: en el apartado de Tienda de
  Configuración, que cada herramienta tenga su guía de uso (cómo va el
  editor de tablas, Grupos, etc.). Koku lo dejó apuntado a propósito
  para más adelante — **no empezar hasta que lo pida**. Precedente ya
  existente al que se puede enganchar: el aviso de "mover a mano" de
  las tablas, que sale la primera vez con casilla de "no volver a
  mostrar" (`tableMoveHintSeen_*` en localStorage).
- **Rediseño de Gimnasio (HECHO, pendiente de validar en iPhone)**:
  rama `gimnasio-movil` (creada desde `movil-ui`), trabajada en un
  WORKTREE aparte (`../RemindMeLater-gimnasio`) porque el checkout
  principal estaba en `escritorio`. Las 7 fases están commiteadas y
  probadas en Chrome con la app servida como estático:
  1. **Bloques → Días** (tabla `gym_blocks` + `block_id` en
     `gym_routines`; migración idempotente que recoloca días huérfanos
     en un bloque "General"; solo un bloque activo). Pestaña "Plan" con
     drill-down bloque↔días. Acento morado scoped en
     `#gym-view`/`.gym-modal`/`#gym-live-view`, sin tocar los temas.
  2. **Librería de ~870 ejercicios** (`public/gym-exercise-library.json`,
     ~840 KB, fetch perezoso): de
     [`yuhonas/free-exercise-db`](https://github.com/yuhonas/free-exercise-db)
     (Unlicense, dominio público; nacido de `wrkout/exercises.json` de
     Ollie Jennings, también Unlicense — créditos en README y código).
     Nombres/músculos/material traducidos al español por Claude;
     **las INSTRUCCIONES siguen en inglés** — se irán traduciendo por
     tandas con la cuenta DeepL de Koku vía Chrome (pendiente).
     Taxonomía fija `GYM_MUSCLE_GROUPS` (14 grupos) en app.js: única
     fuente de verdad para selects, volumen por músculo y mapa.
     Import idempotente por `library_id`.
  3. **Modo entrenar en vivo**: estado en `localStorage.gymLiveSession`
     (sobrevive recargas), tiempos SIEMPRE desde timestamps (iOS congela
     el JS de fondo), cronómetro, columna "Anterior"
     (`GET /last-sets/:exerciseId`), RPE, descanso automático al marcar
     serie (presets + +30s), resumen final. Columnas nuevas: `rpe`/
     `set_type` en `gym_sets`; `started_at`/`duration_seconds`/
     `exercise_notes` (JSON) en `gym_sessions`. Esc NO saca del entreno.
  4. **Actividad rápida** (`type='activity'` en `gym_sessions`, sin
     series — misma tabla a propósito para heatmap/racha) + historial
     con iconos/duración/volumen + `GET /summary` ligero.
  5. **Progreso avanzado**: heatmap 26 semanas (un solo tono morado),
     racha semanal con objetivo configurable (`gymWeeklyGoal`, por
     dispositivo, semanas ISO lunes), PRs con 1RM de Epley (excluye
     warmup y >12 reps), volumen semanal apilado top-5 grupos + "Otros"
     (paleta de 5 tonos validada contra daltonismo con el skill dataviz).
  6. **Mapa de músculos** (idea de Koku): dos siluetas SVG propias
     (frente/espalda) generadas en app.js (para usar variables CSS),
     zonas = ids de la taxonomía, intensidad continua, ventana 7/30/90
     días, series o volumen, secundarios ×0.5 (columna
     `secondary_muscles` en `gym_exercises`, la rellena el import).
  7. **Logros**: 6 logros con niveles calculados AL VUELO desde
     /summary (nada en BD; solo `gymAchievementsSeen` en localStorage
     para celebrar una vez). Pestaña "Logros" + modal de celebración.
  - **Rondas de feedback de TestFlight** (varias tandas de Koku
    probando en su iPhone, ya integradas — lo más importante de
    entender de la versión actual):
    - **Ciclo de series con botones grandes**, no casillas ("si vas un
      poco mareado cuesta ver la casilla"): botón grande por ejercicio
      → diálogo "vas a empezar X, serie N" (el nombre es pulsable y
      despliega los ejercicios del día) → serie corriendo con
      cronómetro → diálogo "¿has acabado?" (Sí / Pausar / Seguir) →
      formulario con peso, repeticiones y **nota de esa serie**. Las
      notas de las series se combinan al acabar el ejercicio en la nota
      del ejercicio, que es la que se ve el siguiente entreno. El ✓ de
      cada fila ya solo sirve para DESHACER. Estado en
      `gymLiveSession.activeSet`, todo por timestamps.
    - **Terminar la serie tocando la pantalla**: con la serie en
      marcha, un toque en hueco de la pantalla del entreno abre el
      diálogo. Solo con la app delante (quien se va a Spotify no
      dispara nada al volver), no antes de 5s, y 12s de silencio tras
      decir "Seguir". Ver `gymTapShouldOpenEnd()` en `app.js`.
    - **Unilaterales**: `unilateral` + `count_sides_separately` +
      `side_rest_seconds` en `gym_exercises` (se configuran en el modal
      del propio ejercicio). Cada lado es una SERIE PROPIA
      (`gym_sets.side`), así el historial y el volumen no necesitan
      casos especiales. El diálogo pregunta por qué lado empiezas y eso
      se aplica a todas las series pendientes del ejercicio; el
      descanso corto entre lados se decide por "¿queda el otro lado
      pendiente?", NO por "¿es el izquierdo?".
    - **Avisos del fin de descanso** (todo en `RestAudioWatcher.swift`
      + `LiveActivityPlugin.swift`): tarjeta con cuenta atrás en la
      pantalla de bloqueo (ActivityKit + widget `DescansoWidget`, con
      botón +30s vía `LiveActivityIntent`, en los colores del tema);
      la música BAJA de volumen al acabar (audio ducking con
      `.duckOthers`, la app se mantiene despierta con un silencio en
      bucle y el modo de fondo `audio`); vibración larga = 6 pulsos del
      sistema seguidos (NO 3 notificaciones), que se callan al volver a
      la app, desbloquear, tocar el volumen, pausar la música desde el
      auricular o descartar la notificación.
    - Sonido y vibración de la notificación son dos interruptores
      aparte en Configuración > Notificaciones.
    - **Historial**: deslizar una sesión a la izquierda descubre
      Editar/Eliminar (mismas clases que las notas,
      `wrapGymRowWithSwipe`), siguiendo el dedo con animación.
    - **Bug ya cometido, no repetir**: subir `#gym-live-view` por
      encima de `.modal` (z-index 20) deja los diálogos ABIERTOS PERO
      DETRÁS del entreno. Se queda en 16. Y en los guiones de prueba,
      comprobar que un diálogo se VE (`document.elementFromPoint`), no
      solo que no tiene la clase `hidden` — por eso se coló.
  - **Pendiente**: tandas de DeepL para las instrucciones; merge de
    `gimnasio-movil` a `movil-ui` (ojo: ya hubo un run "Combinado"
    desde `movil-ui`, revisar qué se llevó). Los ejercicios importados
    ANTES de la Fase 6 no tienen `secondary_muscles` (limitación
    conocida).
  - Referencia estética explorada en vivo: https://oscargymapp.vercel.app/
    (app de un amigo). Descartado lo social/red a propósito.
  - Descartada la otra librería candidata
    (`hasaneyldrm/exercises-dataset`): datos MIT pero imágenes de Gym
    Visual con licencia restrictiva y ~125 MB de peso.
- **Backlog sin fecha** (ideas suyas, ninguna empezada): rediseño
  visual del visor de escritorio, repensar Finanzas para que sea
  "realmente útil", y una extensión nueva estilo Notion.
