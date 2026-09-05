# RemindMeLater — notas para retomar el proyecto en otra conversación

Esto no es documentación de usuario (eso es `README.md`, reescrito por
completo en esta misma ronda). Esto es el resumen para que una
conversación nueva pueda seguir donde lo dejamos sin que Koku tenga que
repetir todo el contexto.

**Quién es Koku**: no sabe JavaScript a fondo, así que las explicaciones y
los comentarios en el código van con más detalle de lo normal a propósito.
Mantén ese estilo.

**Nota sobre este archivo**: normalmente NO se commitea (vive solo local,
como notas de trabajo). La excepción: si Koku va a cambiar a una sesión
distinta que puede arrancar con un clon nuevo del repo, sí se commitea
puntualmente para que el resumen viaje con el repo. Cada vez que quieras
commitearlo hay que confirmarlo con Koku igual que cualquier otro commit.

## Qué es esto

**App de escritorio para Windows**: calendario, recordatorios, tareas y
notas, más un hub de "Herramientas" con 4 secciones (Gimnasio, Lecturas,
Finanzas y Viajes). Electron + SQLite (`node:sqlite`, el integrado en
Node, sin compilar nada nativo). La interfaz es HTML/CSS/JS sin build ni
framework.

**No hay servidor, ni puerto, ni HTTP** — esto es lo más importante que
cambió respecto a versiones anteriores, ver el bloque siguiente.

## El cambio grande de la v0.34.0: fuera el servidor

Hasta la v0.33.1 esto era una app WEB (Express escuchando en el puerto
3000) que además se envolvía en Electron. El servidor existía porque el
móvil se conectaba al ordenador por wifi. Koku decidió que la app de
escritorio y la móvil son cosas independientes y que no necesita el
servidor, así que se quitó entero.

**Lo que desapareció** (sigue intacto en la rama `main` si algún día hace
falta recuperarlo, no se ha perdido nada):

- Express y el puerto 3000. También `web-push`, `bonjour-service` y
  `qrcode` como dependencias — la única que queda es `node-notifier`.
- Emparejamiento por código de 6 dígitos, tokens de dispositivo, el QR de
  reconexión, la tabla `devices` y el archivo `auth.js` entero. Sin red
  no hay de quién desconfiar: si estás ejecutando la app, eres tú. Las
  143 rutas ya no llevan ningún control de acceso.
- Sincronización (`routes/sync.js`, la tabla `sync_log`,
  `db.recordSyncChange`), la copia local en IndexedDB (`public/db-local.js`)
  y el punto de color de la topbar.
- Avisos push al móvil (Web Push/VAPID), el service worker y el
  manifiesto PWA.
- mDNS (`remindmelater.local`).
- **La extensión Archivos entera**: existía solo para pasar archivos entre
  el móvil y el ordenador.

**Cómo funciona ahora**, tres piezas:

```
public/    la interfaz (igual que siempre: index.html + app.js + settings.js + styles.css)
core/      los datos (antes se llamaba server/) — SQLite y las 26 rutas
electron/  el pegamento — ventana, protocolo app:// e IPC
```

Cuando la interfaz pide `/api/events`, la petición **no sale a ninguna
red**: `api()` en `public/app.js` la manda por IPC
(`window.electronAPI.api` → `electron/ipc.js`) hasta `core/api.js`, que
consulta SQLite y devuelve la respuesta. Las rutas se siguen llamando
igual que cuando esto era un servidor web, pero solo como forma de
nombrar cada cosa.

Piezas concretas que conviene conocer antes de tocar nada:

- **`core/router.js`** — enrutador propio de ~100 líneas, el sustituto de
  Express. A propósito tiene la MISMA forma de escribir una ruta
  (`router.get('/:id', (req, res) => ...)`), para que los 26 archivos de
  `core/routes/` no hubiera que reescribirlos endpoint por endpoint (son
  143). `req`/`res` son objetos normales fabricados ahí mismo, no tienen
  nada que ver con HTTP. `res` solo admite `.status()`, `.json()`,
  `.sendFile()` y `.end()`, que es todo lo que usan las rutas.
  **Gana la primera ruta que encaje, en orden de registro** — igual que
  Express. Importa de verdad: en `finanzasInvestments.js`,
  `/summary/by-asset` está declarado ANTES que las rutas con `/:id`, y si
  se invirtiera el orden "summary" se colaría como si fuera un id.
- **`core/api.js`** — la tabla de qué prefijo atiende cada archivo, el
  sustituto de `server/index.js`. Los prefijos se ordenan de más LARGO a
  más corto, porque `/api/notes/images/x.jpg` empieza tanto por
  `/api/notes` como por `/api/notes/images` y tiene que ganar el segundo.
- **`electron/protocol.js`** — registra un esquema propio `app://` que
  sirve `public/` desde el disco. No se usa `file://` a propósito: con
  `file://` cada archivo es un "origen" distinto e inseguro y
  localStorage/fetch se comportan mal, y además las imágenes que las notas
  llevan guardadas dentro (`/api/notes/images/xxx.jpg`, texto que está
  DENTRO de la base de datos) apuntarían a la raíz del disco. Este
  archivo reconoce esas rutas y trae el archivo de la carpeta de datos —
  por eso no hubo que tocar ni una sola nota ya escrita.
- **`electron/ipc.js`** — el puente. Convierte el cuerpo (texto JSON, o
  ArrayBuffer al subir una imagen) y **pasa los nombres de cabecera a
  minúsculas** (ver "Cosas que ya rompieron una vez").

**Consecuencia a tener presente**: `public/` ya solo funciona dentro de
Electron (llama a `window.electronAPI`). Abrirlo en un navegador normal ya
no vale para nada.

## El cambio de la v0.35.0: fuera el móvil entero

Koku pidió que a partir de ahora **solo haya cosas de escritorio, nada de
móvil**, para que un futuro merge sea limpio. Lo que se quitó:

- **Capacitor completo**: `android/`, `ios/`, `capacitor.config.json`, los
  scripts `cap:*`, las 4 dependencias `@capacitor/*`, `CAPACITOR-POC.md`,
  `IOS-TESTFLIGHT.md` y el workflow de GitHub Actions que firmaba iOS sin
  Mac (con él se fue `.github/` entero).
- **Todo el rediseño móvil**: la barra inferior de navegación, el
  calendario mensual/anual de círculos, la vista diaria (tira semanal,
  vista por horas, modo Listado), la vista de Notas móvil con su menú de
  3 puntos y su modo galería, el buscador global, los menús "+"
  flotantes y los swipes.
- El mecanismo `.mobile-only`/`.desktop-only`: ya no existe, la interfaz
  de escritorio se ve siempre.
- Los metas de PWA que quedaban (`apple-mobile-web-app-*`).

**Lo que NO se tocó**: la estructura responsive del CSS. El CSS base
sigue siendo mobile-first y quedan 5 `@media (max-width: 859px)` con
adaptaciones legítimas (formularios apilados, Configuración a pantalla
completa en ventana estrecha, padding). Aplanar eso a desktop-first se
descartó a propósito: es reescribir las 3.253 líneas del stylesheet justo
antes del rediseño visual, y genera un diff enorme que haría el merge más
difícil, no menos.

**Cuidado con los nombres**: había bastante código llamado "mobile" que en
realidad lo usa el ESCRITORIO — todo el modo "Seleccionar" de Notas
(barra de acción, modal de borrado, mover). Se renombró para que
"mobile" ya no aparezca en nada vivo: `setMobileNotesMode` →
`setNotesMode`, `mobileNotesMode` → `notesMode`,
`refreshMobileNotesActionBar` → `refreshNotesActionBar`,
`#mobile-notes-delete-modal` → `#notes-delete-modal`, etc. La pestaña de
Configuración que se llamaba `mobile` por dentro (es "Este dispositivo")
ahora se llama `device`.

**Renombrado aparte**: el apartado que se veía como "Apps" ahora se llama
**"Herramientas"** en toda la interfaz.

## Reglas de trabajo que Koku ha pedido explícitamente

- **No hacer commit ni push sin que él lo pida.** A veces pide solo UNA de
  las dos cosas (commit sin push, por ejemplo) — haz justo lo que pide, no
  más. No asumas autorización de una ronda para la siguiente.
- **No hace falta avisar de que una tarea es larga antes de empezar** — lo
  pidió al principio, pero luego dijo explícitamente que como no puedo
  comprimir contexto por mi cuenta, no sirve de nada que avise.
- Versionado semántico en `package.json` con tag de git a juego (`v0.x.0`),
  commits agrupados por ronda de trabajo (no uno por cada cambio pequeño).
- Cuando algo es ambiguo o hay varias formas razonables de hacerlo,
  pregunta antes de construir — a Koku le gusta decidir el diseño, no que
  se lo entreguen hecho. Con peticiones grandes, agrupa las preguntas
  ambiguas en una sola ronda al principio en vez de ir parando a cada rato.
- **Los tags de git SÍ se pueden crear y pushear desde una sesión LOCAL**
  (`git tag vX.Y.Z <hash>` + `git push origin vX.Y.Z`, con solo un aviso
  inofensivo de "unable to get credential storage lock"). La limitación de
  403 al pushear tags es específica de las sesiones de **control remoto**,
  cuya credencial es más limitada. En ese caso, el workaround es que Koku
  lo haga a mano desde su ordenador después de cada push:
  ```
  git fetch origin <rama>
  git tag vX.Y.Z <hash-del-commit>
  git push origin vX.Y.Z
  ```
- **Nunca usar controles nativos del navegador para checkbox, `<select>`,
  fecha, ni nada similar** — siempre el componente propio de la app que
  siga el tema activo: `createSelectField()`/`createDateField()`
  (`app.js`) para desplegables/fechas, y para checkboxes de selección la
  clase `.styled-checkbox` (`styles.css`) — NO `.checkbox-row` (esa es el
  interruptor tipo pastilla para ajustes on/off, otro componente). Si
  aparece un control nativo sin estilo, es un descuido a corregir, no una
  excepción aceptable.

## Arquitectura y convenciones establecidas

- **Temas de color**: cada fondo real de la interfaz (`bg`, `surface`,
  `surface2`, `settingsMenuBg`, `accent`, `dayToday`) lleva su propio
  color de contraste emparejado (`bgText`, `surfaceText`, etc.) en vez de
  un "texto principal/secundario" global — así cada superficie garantiza
  su propia legibilidad. Ver `core/routes/themes.js` (`sanitizeColors`,
  con cadena de fallback contextual + red de seguridad de contraste real
  vía fórmula WCAG) y `public/settings.js` (`THEME_COLOR_FIELDS_META`).
  Un tema puede tener una `inverseColors` opcional (variante clara/oscura
  emparejada); `resolveThemeVariant()` decide cuál mostrar según
  `colorModePreference`. Si el tema activo no tiene variante inversa, el
  botón rápido ☀/☾ de la topbar se queda oculto.
- **Edición de temas con borrador**: al editar un tema los cambios se
  aplican en vivo a toda la app; cambiar a editar otro tema guarda el
  anterior solo (sin preguntar); cerrar sin guardar descarta. No hay botón
  de guardado por tema (`saveCurrentThemeEdit`, `switchThemeEdit`).
- **Qué tema está activo** se guarda en `app_settings.host_active_theme_id`
  y se lee/escribe con `GET`/`PUT /api/themes/selection/mine`. Antes esto
  devolvía una lista (el ordenador más cada móvil, para "copiar el estilo
  de otro dispositivo"); ahora solo hay una respuesta posible.
- **Carpeta de datos**: `core/dataDir.js` lee `REMINDMELATER_DATA_DIR` si
  existe (la pone `electron/main.js`, apuntando a la carpeta de datos del
  usuario), si no usa `data/` del proyecto. **`electron/main.js` la pone
  ANTES de requerir nada de `core/`**, porque `core/db.js` la lee una sola
  vez al cargarse.
- **Ajustes por dispositivo** (tema activo en caché, modo de vista,
  densidad del calendario, atajos...) viven en `localStorage`, que en
  Electron cuelga del origen `app://remindmelater`. Cambiar ese host
  equivaldría a empezar de cero con todos esos ajustes.
- **CSS**: la base sigue escrita mobile-first (el layout de escritorio
  vive dentro de `@media (min-width: 860px)`), aunque ya no haya móvil.
  Se dejó así a propósito, ver "El cambio de la v0.35.0". La ventana
  tiene `minWidth: 720`, así que entre 720 y 860 px se aplican las
  adaptaciones responsive que quedan.
- **Tareas**: son filas de `events` con `is_task = 1` (no una tabla
  aparte) — comparten título/grupo con los eventos normales, pero
  `start_at` es opcional y tienen su propio campo `done`. En el
  calendario, si tienen fecha, se ven con el borde en vez de relleno
  (`.calendar-task-chip`) y un icono ☐/☑ clicable. El color de
  "completada" es opcional por grupo (`completed_color`); si no se pone a
  mano, se calcula atenuando el color normal (`mutedTaskColor()`).
- **"Mi espacio"** (Próximos + Tareas + Notas juntos), completo:
  - **Notas**: título + contenido con formato. Se pueden ocultar (icono de
    ojo, difuminadas en la lista) — no es cifrado real, solo evita que se
    lean a primera vista. La contraseña compartida que hubo en su día ya
    no existe (`routes/notesSecurity.js` se borró hace tiempo).
  - **Carpetas de notas**: sistema propio, separado de los Grupos del
    calendario — nombre + color, sin icono a propósito. Pueden contener
    otras carpetas (`parent_id`, con detección de ciclos). Navegación tipo
    explorador de archivos (`renderNotesView()`). Borrar una carpeta NUNCA
    borra su contenido: notas y subcarpetas suben un nivel.
  - **Favoritos**: columna `favorite` en `notes` y `note_folders`.
    Carpetas y notas mantienen su propio orden de favoritos por separado.
    Ajuste por dispositivo `favoritesDisplayMode`: "merged" o "sections".
  - **Búsqueda**: filtra por nombre SOLO dentro de la carpeta donde estás.
  - **Diseño**: hub de 3 columnas. Cada columna se expande clicando su
    TÍTULO (h2). `miEspacioMode` decide si el hub vive al lado del
    calendario (`"panel"`) o se abre a pantalla completa desde la topbar
    (`"topbar"`, por defecto).
  - **Panel lateral clásico — "agrupar con flechas"**: en Configuración >
    Vista hay una casilla por sección. Las marcadas se agrupan en un único
    hueco con flechas para alternar SOLO entre ellas; las no marcadas se
    quedan sueltas y apiladas. Ver `REMINDERS_PANEL_PAGES` /
    `getRemindersGroupedSections()` / `applyRemindersPanelLayout()` — está
    hecho SIN ningún "3" fijo en el código, para que añadir una 4ª sección
    sea solo añadirla a esa lista.
  - **Ctrl+Intro** guarda en los modales de nota, evento y tarea.
  - **Editor de notas**: `#note-body` es un `<div contenteditable>` con
    barra de botones. Negrita/cursiva/listas con `document.execCommand()`
    (obsoleto según MDN pero funciona bien y evita reimplementar la lógica
    a mano). Tablas con popover de filas/columnas y 4 botones contextuales
    cuando el cursor está dentro de una celda. Imágenes: se suben a
    `POST /api/notes/images`, viven en `DATA_DIR/note-images/` y la nota
    solo guarda el enlace corto — NO base64 (decisión hablada con Koku:
    hincharía la base de datos). Resaltado de color con panel "Formato"
    colapsable (varias rondas de bugfix encima, ver más abajo). Borrar una
    nota limpia sus imágenes del disco; quitar una imagen editando la nota
    SIN borrarla no libera el archivo (limitación conocida y aceptada).
  - **Saneado** (`sanitizeNoteBody()` en `core/routes/notes.js`): lista
    blanca de etiquetas, todas sin atributos EXCEPTO `img`, que conserva
    `src` solo si apunta a `/api/notes/images/...`. Las notas anteriores a
    la Fase 4 tienen `body_format = 'text'` y se convierten a HTML
    escapado solo al abrirlas (`legacyNoteBodyToHtml()`).
- **Vista**: solo dos modos, Normal y Pantalla completa, por dispositivo.
  `applyViewMode()` llama a `window.electronAPI.setNativeFullscreen()` y el
  estado se guarda también en `view-mode.json` (no solo localStorage) para
  que la ventana pueda nacer ya en pantalla completa.
- **Trabajo de fondo (patrón repetido)**:
  `function start...() { doWorkOnce(); const timer = setInterval(doWorkOnce, MS); timer.unref(); return timer; }`,
  llamado UNA vez desde `app.whenReady()` en `electron/main.js` (antes se
  llamaba desde `app.listen()`). Los dos que quedan:
  `reminderChecker.js` (30s, saca el aviso del sistema y marca
  `reminder_sent`) y `finanzasRecurringChecker.js` (24h, genera la
  transacción real de cada plantilla de gasto fijo).
- **Extensiones** (hub a pantalla completa, botón "Apps" en la topbar):
  cuatro secciones independientes del calendario, todas con el mismo
  patrón de esquema (`CREATE TABLE IF NOT EXISTS` + migraciones
  condicionales en `db.js`, `PRAGMA table_info` + `ALTER TABLE`) y borrado
  en cascada A MANO en las rutas (nunca `ON DELETE CASCADE` de SQL).
  - **Gimnasio**: `gym_exercises`/`gym_routines`/`gym_routine_exercises`/
    `gym_sessions`/`gym_sets`. Gráfica SVG a mano, sin librería.
  - **Lecturas**: `lecturas_sagas`/`lecturas_items` (sagas obligatorias,
    un item puede ser de cualquier tipo dentro de la misma saga). Géneros
    como columna JSON de texto libre, no tabla N:M.
  - **Finanzas**: `finanzas_accounts`/`finanzas_categories`/
    `finanzas_transactions`/`finanzas_investment_transactions`/
    `finanzas_settings` + `finanzas_portfolios`/`finanzas_assets`/
    `finanzas_asset_valuations` (carteras anidadas tipo `note_folders`) +
    `finanzas_recurring_expenses` + `finanzas_debts`. Saldo de cuenta
    SIEMPRE calculado, nunca guardado. Borrar una cuenta con historial se
    rechaza; borrar una categoría/cartera no destruye lo que la usaba.
  - **Viajes**: `viajes_trips`/`viajes_trip_countries`/`viajes_entries`/
    `viajes_entry_attachments`/`viajes_entry_movements`. Mapa mundial
    interactivo con `public/viajes-world-map.svg` (1,2 MB, cargado con
    `fetch`), cada país un `<g id="XX">`. Un viaje puede tocar VARIOS
    países (por eso `countries` es siempre un array). Las fotos viven en
    `DATA_DIR/viajes-photos/` y los tickets pueden enlazarse a Finanzas.

## Cosas que ya rompieron una vez (para no repetir el error)

- **Nombres de cabecera y el paso a IPC**: con HTTP, Node pasaba los
  nombres de cabecera a minúsculas por su cuenta, y las rutas se
  escribieron contando con ello (`req.headers['content-type']`). Por IPC
  llegan tal cual las escribió quien llamó (`'Content-Type'`), así que
  subir una imagen a una nota respondía "Formato de imagen no soportado"
  porque la cabecera nunca se leía. Arreglado en `lowercaseHeaders()`
  (`electron/ipc.js`). Si algún día se añade otra ruta que mire una
  cabecera, ya está cubierto — pero es el tipo de diferencia sutil entre
  "esto iba por HTTP" y "esto va por IPC" que conviene tener presente.
- **Orden de declaración de variables en `settings.js`**: hubo un bug real
  donde una función que se ejecuta al cargar la página
  (`buildThemeColorGrid`) disparaba un callback que leía una variable
  `let` declarada MÁS ABAJO — al estar en su "zona muerta temporal" (TDZ)
  lanzaba una excepción que abortaba TODO el resto del script. Si algo
  dentro de código que se ejecuta AL CARGAR necesita una variable, esa
  variable tiene que estar declarada ANTES en el archivo. Dentro de un
  handler (que se llama más tarde) no pasa nada.
- **Contraste de colores**: no asumas que un color se ve bien porque "type
  check" pasa — comprueba el contraste real (hay una función de ratio WCAG
  en `core/routes/themes.js`).
- **Popovers flotantes que se salen de la pantalla**:
  `positionFixedPopover()` usaba una ALTURA ESTIMADA fija para decidir si
  el popover cabía hacia abajo; se quedaba corta para el de iconos.
  Arreglado midiendo la altura REAL (`popover.offsetHeight`).
- **"¿Está vacío el editor de notas?" no es lo mismo que "¿tiene
  texto?"**: una nota con SOLO una imagen o SOLO una tabla vacía no tiene
  texto, y se guardaba como vacía (perdiendo el contenido). Arreglado
  comprobando también `NOTE_EDITOR_BODY.querySelector('img, table')`. Si
  se añade otro tipo de contenido "sin texto", hay que meterlo ahí.
- **Selección del cursor dentro de una tabla contenteditable**: al hacer
  click en una celda VACÍA el navegador a veces deja el cursor "colgado"
  de un antepasado (tr/tbody/table). `getCurrentTableCell()` tiene un
  fallback para eso; cuidado con quitarlo pensando que es código muerto.
- **Al borrar reglas CSS por selector, revisar los selectores agrupados
  por comas UNO A UNO.** Esto rompió la app de verdad: al quitar la
  pantalla de emparejamiento, un script borró las reglas
  `.modal, .pairing-screen` y `.modal-card, .pairing-card` enteras porque
  el selector mencionaba `pairing`. Con eso desaparecieron `.modal` y
  `.modal-card`, o sea la posición y el fondo de TODOS los modales de la
  app: el JavaScript seguía funcionando (los modales perdían su clase
  `hidden` correctamente) pero no se veía nada, y parecía que la app
  entera estaba muerta. En la limpieza del móvil se hizo con una
  salvaguarda que RECORTA el selector muerto en vez de borrar la regla —
  y volvió a saltar en la misma regla de `.modal-card`.
- **Una prueba que comprueba "¿le han quitado la clase hidden?" no sirve.**
  Hay que medir que el elemento se VEA (tamaño real en pantalla y
  `position`), y capturar los recursos que no cargan (`webRequest.onCompleted`
  con `statusCode >= 400`) — los dos fallos de arriba pasaron desapercibidos
  justo por eso.
- **Al borrar UI, cuidado con lo que hay pegado alrededor**: quitando la
  pantalla de emparejamiento de `index.html` se coló por delante el modal
  `#app-confirm-modal`, que estaba justo entre medias y no tenía nada que
  ver. Merece la pena comprobar, después de una limpieza grande, que
  ningún `getElementById()` del JS apunta a un id que ya no existe (y al
  revés). Lo mismo pasó con `SETTINGS_TABS`, que seguía listando la
  pestaña `devices` ya borrada y reventaba `showSettingsScreen()`.

## Cómo probar sin Koku delante

Electron se puede arrancar sin pantalla real con
`xvfb-run -a node_modules/.bin/electron --no-sandbox <script>`, escribiendo
un script que cree la ventana igual que `main.js` y luego use
`win.webContents.executeJavaScript(...)` para comprobar cosas desde dentro
de la página. Dos avisos aprendidos a base de colgarse:

- Un `alert()`/`confirm()` nativo bloquea el renderer para siempre si no
  hay nadie delante. Engancha `win.webContents.on('-run-dialog', ...)` y
  contesta automáticamente.
- Pon un `setTimeout(...).unref()` de watchdog que imprima lo que lleve y
  salga, y un límite por paso — si no, un fallo deja el proceso colgado
  sin decir dónde.

## Estado actual

Rama de trabajo: **`escritorio`**. La rama
`claude/desktop-app-electron-web-hdntch` ya no existe en el remoto: se
fusionó en `main`, así que **`main` es ahora el "antes"** — el último
estado con servidor, app móvil y Capacitor intactos. Recuperarlo es un
`git checkout main`, no hay que buscar hashes.

`package.json` en **v0.35.0**. Todo lo descrito arriba está hecho y
probado arrancando la app de verdad con `xvfb-run`: los modales se VEN
(medido su tamaño real en pantalla, no solo la clase `hidden`), las 6
pestañas de Configuración abren, las 5 vistas a pantalla completa abren,
el modo "Seleccionar" de Notas funciona, no falla ningún recurso y no hay
ningún error en la consola.

## Pendiente / próximos pasos declarados

- **Documento de cambios visuales**: Koku dijo que iba a pasar "un
  documento detallado de todos los cambios visuales que quiero hacer, no
  serán pocos". Eso es lo siguiente.
- **Barra de título propia**: la ventana usa la barra de título gris de
  Windows, que rompe cualquier tema oscuro/Neón/Cristal. Se le propuso a
  Koku como el cambio visual de más impacto y afecta al layout de arriba,
  así que conviene decidirlo antes de rediseñar. Todavía sin decidir.
- **Capacidades nativas de escritorio que se hablaron y no están hechas**:
  arrancar con Windows, icono en la bandeja del sistema, notificaciones
  clicables con botones ("Posponer 10 min"), atajos globales, diálogos
  nativos de archivo, arrastrar archivos con su ruta real,
  actualizaciones con `electron-updater` en vez del `git pull` casero, y
  exportar a PDF.
- **La fuente Roboto Mono se carga de Google Fonts por internet**
  (`index.html`). Funciona, pero una app de escritorio no debería
  depender de la red para su tipografía — conviene meterla en `public/`.
- **Idiomas**: Koku quiere en algún momento un selector español/inglés,
  pero pidió dejarlo para más adelante. No empezar sin que lo pida.
