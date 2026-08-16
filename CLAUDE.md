# RemindMeLater — notas para retomar el proyecto en otra conversación

Esto no es documentación de usuario (eso es `README.md`, que se
reescribió por completo en la ronda de v0.19.0 y se ha ido manteniendo al
día en rondas posteriores — última vez en la ronda de v0.23.0). Esto es
un resumen para que una conversación nueva
(Cowork, Claude Code local o una sesión de control remoto) pueda seguir
donde lo dejamos sin que Koku tenga que repetir todo el contexto.

**Quién es Koku**: no sabe JavaScript a fondo, así que las explicaciones y
los comentarios en el código van con más detalle de lo normal a propósito.
Mantén ese estilo.

**Nota sobre este archivo**: normalmente CLAUDE.md NO se commitea (ver
regla de abajo) — vive solo local, como notas de trabajo. La excepción:
si Koku va a cambiar a una sesión distinta (p. ej. control remoto) que
puede arrancar con un clon nuevo del repo, sí se commitea este archivo
puntualmente para que el resumen viaje con el repo. Eso fue lo que pasó
justo antes de este commit — no lo tomes como que la regla cambió para
siempre, cada vez que quieras commitearlo hay que confirmarlo con Koku
igual que cualquier otro commit.

## Qué es esto

Calendario, recordatorios, tareas y notas local-first: Node.js + Express +
`node:sqlite` (SQLite integrado en Node, sin compilar nada nativo) por
detrás, HTML/CSS/JS sin build ni framework por delante (`app.js` y
`settings.js` se cargan como `<script>` normales y comparten variables
globales — `settings.js` va después de `app.js`, cuidado con el orden si
tocas ambos). Corre en el ordenador de Koku; el móvil se conecta a la
misma app por wifi local, emparejado con un código de 6 dígitos. También
se puede empaquetar como app de escritorio (Electron) y se anuncia por
mDNS (`remindmelater.local`). Detalle completo de features en
`README.md`, que ahora sí está actualizado.

## Reglas de trabajo que Koku ha pedido explícitamente

- **No hacer commit ni push sin que él lo pida.** Antes probaba todo local
  con `npm run dev` y daba luz verde a cada ronda; últimamente directamente
  dice "haz commit" o "haz push" cuando quiere — y a veces solo pide UNA de
  las dos cosas (commit sin push, por ejemplo), hay que hacer justo lo que
  pide, no más. No asumas autorización de una ronda para la siguiente.
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
  git fetch origin main-wmqm2f
  git tag vX.Y.Z <hash-del-commit>
  git push origin vX.Y.Z
  ```
  (añadir `--force` al tag si hubo que corregir uno mal puesto). Si estás
  en una sesión de Claude Code local (terminal en el propio ordenador de
  Koku), prueba a pushear el tag tú mismo primero — solo hace falta el
  workaround manual si de verdad da 403 en ESTA sesión en concreto.

## Arquitectura y convenciones establecidas

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
- **Dispositivo de confianza**: el propio ordenador se identifica por IP de
  loopback (`isTrustedRequest()`); los móviles emparejados usan un header
  `X-Device-Token`. Ver `server/auth.js`.
- **Carpeta de datos configurable**: `server/dataDir.js` lee
  `REMINDMELATER_DATA_DIR` si existe (la pone Electron, apuntando a la
  carpeta de datos del usuario), si no usa `data/` del proyecto. Se sacó
  de `db.js` a su propio archivo en la ronda de imágenes de notas (Fase
  4) para que `routes/noteImages.js` pudiera usar el mismo cálculo sin
  duplicarlo.
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

Último commit en `origin/main-wmqm2f` (pusheado): `v0.23.1` — docs
(`README.md` y este archivo) puestos al día tras cerrar la Fase 4. El
commit de código de la Fase 4 en sí es `v0.23.0` (`27ce26a`) — "imágenes
en el editor de notas". Los tags `v0.21.0`/`v0.22.0`/`v0.23.0`/`v0.23.1`
YA están creados y pusheados a `origin` (esta era una sesión local, ver
nota corregida más arriba sobre tags).

Fases de "Mi espacio" completas: 1 (hub), 2 (notas + ocultar/contraseña),
3 (carpetas anidadas tipo explorador), una ronda extra de pulido
(favoritos, búsqueda, iconos, atajos, Ctrl+Intro, agrupar secciones), y
la **Fase 4 (formato de notas) — completa** en tres sub-rondas:
negrita/cursiva/listas (v0.21.0), tablas (v0.22.0), imágenes (v0.23.0).
Detalle técnico completo en el bloque "Editor de notas con formato" más
arriba. `README.md` se puso al día en esta misma ronda para reflejar
todo esto (formato de notas, favoritos, búsqueda, Ctrl+Intro, agrupar
secciones — antes solo cubría hasta v0.19.0 de verdad, aunque la nota
anterior decía que estaba al día del todo).

## Pendiente / próximos pasos declarados

- **Idiomas**: Koku quiere en algún momento un selector español/inglés
  ("por tener la opción y ver cómo se desarrolla"), pero pidió
  explícitamente dejarlo para más adelante — no es prioridad ahora mismo,
  no empezar sin que lo pida.
- **Móvil**: Koku lo está llevando en otra conversación aparte (confirmó
  explícitamente dejarlo fuera de esta sesión). Se había quedado en
  hacerlo en una rama de git separada (`git checkout -b movil`) en vez de
  tocar `main-wmqm2f` a la vez desde dos sitios, para que un posible
  solape sea un merge normal y no un pisotón silencioso de archivos — no
  se sabe desde esta sesión en qué punto va esa rama.
- **README.md**: al día (ver "Estado actual" arriba).
- Sin nada más declarado en el momento de escribir esto — Koku mencionó
  "tengo algunas cosas en mente" sin concretar, para retomar en una
  conversación futura.
