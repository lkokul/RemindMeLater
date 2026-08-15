# RemindMeLater — notas para retomar el proyecto en otra conversación

Esto no es documentación de usuario (eso es `README.md` — a diferencia de
como estaba antes, ahora SÍ está al día, se reescribió por completo en la
ronda de v0.19.0). Esto es un resumen para que una conversación nueva
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
- **Los tags de git no se pueden pushear desde esta sesión** (da 403,
  confirmado que NO es un problema de permisos de Koku en GitHub ni de la
  red — es la credencial concreta de esta integración, que es más
  limitada que la cuenta completa de Koku). El branch normal sí se puede
  pushear sin problema. Workaround ya establecido: Koku lo hace a mano
  desde su propio ordenador después de cada push:
  ```
  git fetch origin main-wmqm2f
  git tag vX.Y.Z <hash-del-commit>
  git push origin vX.Y.Z
  ```
  (añadir `--force` al tag si hubo que corregir uno mal puesto). No hace
  falta seguir intentándolo ni investigarlo más, ya está confirmado.

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
- **Carpeta de datos configurable**: `server/db.js` lee
  `REMINDMELATER_DATA_DIR` si existe (la pone Electron, apuntando a la
  carpeta de datos del usuario), si no usa `data/` del proyecto.
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
  - **Notas**: título + texto plano (sin formato todavía — eso es la
    Fase 4, sin empezar). Se pueden ocultar (icono de ojo, difuminadas en
    la lista) con una contraseña OPCIONAL y COMPARTIDA para toda la app
    (no por nota individual) — no es cifrado real, solo evita que se lea
    a primera vista (`server/routes/notesSecurity.js`).
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

## Estado actual

Último commit en `origin/main-wmqm2f`: `v0.19.1` (`27ab24b`). El tag
`v0.19.1` está pendiente de que Koku lo cree a mano (ver más arriba).

Pendiente de commitear en este momento (probado con curl + Playwright,
sin errores de consola, pero aún no lo ha visto Koku en su propio
navegador):
- Botón de Configuración siempre a la derecha en la cabecera de "Mi
  espacio" a pantalla completa.
- Sistema de "agrupar con flechas" del panel lateral clásico (descrito
  arriba en detalle), que sustituye al ajuste binario Apilado/Alternar
  de la ronda anterior.

Fases de "Mi espacio" completas: 1 (hub), 2 (notas + ocultar/contraseña),
3 (carpetas anidadas tipo explorador), y una ronda extra de pulido
(favoritos, búsqueda, iconos, atajos, Ctrl+Intro, agrupar secciones).

## Pendiente / próximos pasos declarados

- **Fase 4 de "Mi espacio"**: editor de notas con formato tipo Notion —
  básico primero (negrita, listas...), luego tablas, luego imágenes, cada
  cosa en su propia sub-ronda. No empezada.
- **Idiomas**: Koku quiere en algún momento un selector español/inglés
  ("por tener la opción y ver cómo se desarrolla"), pero pidió
  explícitamente dejarlo para más adelante — no es prioridad ahora mismo,
  no empezar sin que lo pida.
- **Móvil**: fase pendiente de arrancar, declarada como "la siguiente".
  Koku planteó trabajarla en una conversación aparte; quedamos en hacerlo
  en una rama de git separada (`git checkout -b movil`) en vez de tocar
  `main-wmqm2f` a la vez desde dos sitios, para que un posible solape sea
  un merge normal y no un pisotón silencioso de archivos.
- **README.md**: YA NO está pendiente, se puso al día en la ronda de
  v0.19.0 (temas, vista, atajos, PWA, Electron, mDNS, Mi espacio...).
