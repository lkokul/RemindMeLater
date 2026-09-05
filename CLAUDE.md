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
  una rama `escritorio`** — **NO la toques** salvo que te lo pida
  explícitamente. Al fusionar, él preguntará qué falta en cada lado.

La interfaz sigue siendo HTML/CSS/JS sin build ni framework (`app.js` y
`settings.js` se cargan como `<script>` normales y comparten variables
globales — `settings.js` va después de `app.js`, cuidado con el orden si
tocas ambos). Además del calendario hay un hub de "Apps" a pantalla
completa con 4 secciones independientes: Gimnasio, Lecturas, Finanzas y
Viajes. Detalle completo de features en `README.md`, que está al día.

## Reglas de trabajo que Koku ha pedido explícitamente

- **No hacer commit ni push sin que él lo pida.** A veces pide solo UNA
  de las dos cosas (commit sin push, por ejemplo): hay que hacer justo lo
  que pide, no más. No asumas autorización de una ronda para la
  siguiente. En rondas largas por fases, ha pedido **un commit al
  terminar cada fase y un solo push al final de todas**.
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

## Estado actual

**Rama de trabajo: `movil-ui`** (no `main`). Ahí vive la app móvil sin
servidor. `main` sigue teniendo la versión vieja cliente-servidor, y la
rama `escritorio` es donde Koku trabaja el programa de escritorio por su
cuenta — no las toques desde aquí.

Últimos commits en `origin/movil-ui`:

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

**Lo que NO existe todavía y es el hueco más importante**: no hay
ninguna copia de seguridad. Sin servidor y sin export/import, si Koku
borra la app pierde todo. Es el siguiente trabajo declarado.

## Pendiente / próximos pasos declarados

- **Copia de seguridad (export/import)**: lo más urgente, ver arriba.
  Sin diseñar todavía — falta decidir dónde vive el archivo (el propio
  móvil, iCloud/Drive, mandarlo a otro sitio…) y cuándo se hace.
- **Probar la Fase 5 en su iPhone**: Koku instala desde TestFlight
  (`IOS-TESTFLIGHT.md` tiene la guía completa). Las notificaciones
  locales reales y el arranque directo solo se pueden confirmar ahí,
  no desde este contenedor.
- **Android**: el proyecto de Capacitor ya está generado (`android/`),
  pero no hay workflow de GitHub Actions para compilarlo todavía. Solo
  está hecho el de iOS.
- **Fusionar `movil-ui` con `escritorio`**: móvil y escritorio son dos
  programas independientes que hoy comparten `public/`. Cuando toque
  fusionar habrá conflictos ahí; Koku dijo que preguntará qué falta en
  cada lado y se resuelve entonces. No adelantarse.
- **Idiomas**: selector español/inglés, apuntado hace mucho y
  explícitamente aplazado. No empezar sin que lo pida.
- **Backlog sin fecha** (ideas suyas, ninguna empezada): rediseño
  visual del visor de escritorio, repensar Finanzas para que sea
  "realmente útil", rediseñar Gimnasio inspirándose en la app de un
  amigo, y una extensión nueva estilo Notion.
