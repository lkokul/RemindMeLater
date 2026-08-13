# RemindMeLater — notas para retomar el proyecto en otra conversación

Esto no es documentación de usuario (eso es `README.md`, y está desactualizado
— no lo uses como referencia de qué hace la app hoy). Esto es un resumen para
que una conversación nueva (Cowork o Claude Code) pueda seguir donde lo
dejamos sin que Koku tenga que repetir todo el contexto.

**Quién es Koku**: no sabe JavaScript a fondo, así que las explicaciones y
los comentarios en el código van con más detalle de lo normal a propósito.
Mantén ese estilo.

## Qué es esto

Calendario y recordatorios local-first: Node.js + Express + `node:sqlite`
(SQLite integrado en Node, sin compilar nada nativo) por detrás, HTML/CSS/JS
sin build ni framework por delante (`app.js` y `settings.js` se cargan como
`<script>` normales y comparten variables globales — `settings.js` va
después de `app.js`, cuidado con el orden si tocas ambos). Corre en el
ordenador de Koku; el móvil se conecta a la misma app por wifi local,
emparejado con un código de 6 dígitos.

## Reglas de trabajo que Koku ha pedido explícitamente

- **No hacer commit ni push sin que él lo pida.** Antes probaba todo local
  con `npm run dev` y daba luz verde a cada ronda; últimamente directamente
  dice "hacemos commit" cuando quiere. No asumas autorización de una ronda
  para la siguiente.
- **No hace falta avisar de que una tarea es larga antes de empezar** — lo
  pidió al principio, pero luego dijo explícitamente que como no puedo
  comprimir contexto por mi cuenta, no sirve de nada que avise. No lo hagas.
- Versionado semántico en `package.json` con tag de git a juego (`v0.x.0`),
  commits agrupados por ronda de trabajo (no uno por cada cambio pequeño).
- Cuando algo es ambiguo o hay varias formas razonables de hacerlo, pregunta
  antes de construir — a Koku le gusta decidir el diseño, no que se lo
  entreguen hecho.

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
  `colorModePreference` (sistema/claro/oscuro, por dispositivo).
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

## Estado actual (en progreso, sin commitear todavía)

Último commit: `v0.6.0` (`edac4a5`). Desde ahí, sin commitear aún:

- **mDNS**: el servidor se anuncia como `remindmelater.local`
  (`server/mdns.js`, paquete `bonjour-service`), además de seguir listando
  IPs por adaptador como respaldo. Código verificado (no rompe el arranque),
  pero la resolución real desde el móvil **todavía no la ha probado Koku**.
- **Empaquetado como app de escritorio (Electron)**: `electron/main.js`
  arranca el `server/index.js` de siempre (sin tocarlo) y lo envuelve en una
  ventana nativa. `npm run electron` para probar, `npm run dist` genera el
  instalador de Windows. **Koku todavía no ha hecho `npm install` ni
  probado esto en su máquina** — el sandbox donde yo trabajo no puede
  descargar el binario de Electron a tiempo ni abrir una ventana (sin
  entorno gráfico), así que esto está verificado solo a nivel de código
  (sintaxis, que el servidor sigue funcionando igual), no probado de
  verdad. Antes de dar esto por bueno, que lo pruebe él.

## Pendiente / decisiones abiertas

- **Lista de "tareas" en el panel de recordatorios**: Koku propuso hace
  tiempo una segunda lista (aparte de "Próximos" y la vista por día) para
  algo tipo tareas. Pidió explícitamente que se le presentaran opciones de
  diseño antes de tocar nada — **todavía no se ha hecho**, es una
  conversación pendiente, no una implementación pendiente.
- **Datos locales por dispositivo + compartir manual**: rediseño grande
  (cada dispositivo guarda su propia copia local, botón "Compartir datos"
  para sincronizar a mano, sin tiempo real) que Koku pidió dejar para más
  adelante explícitamente. No empezar sin retomarlo con él primero.
- **Móvil**: la siguiente fase declarada ("empezamos a mirar móvil"),
  pendiente de arrancar. Koku planteó trabajarlo en una conversación aparte
  en paralelo a esta; quedamos en que lo más seguro es hacerlo en una rama
  de git separada (`git checkout -b movil`) en vez de tocar `main` a la vez
  desde dos sitios, para que un posible solape sea un merge normal y no un
  pisotón silencioso de archivos.
- **README.md desactualizado**: no refleja el sistema de temas actual,
  vista (pantalla completa/flotante), atajos de teclado, PWA, ni nada de lo
  de Electron/mDNS. Convendría repasarlo en algún momento, pero no es
  urgente (es documentación de usuario, no bloquea nada).

## Cosas que ya rompieron una vez (para no repetir el error)

- **Orden de declaración de variables en `settings.js`**: hubo un bug real
  donde una función que se ejecuta al cargar la página (`buildThemeColorGrid`,
  llamada de inmediato) disparaba un callback que leía una variable `let`
  declarada MÁS ABAJO en el archivo — al estar en su "zona muerta temporal"
  (TDZ), lanzaba una excepción que abortaba TODO el resto del script,
  dejando sin registrar botones enteros (volver atrás, cerrar Configuración,
  cambiar de tema...). Si algo dentro de código que se ejecuta al cargar la
  página (no dentro de un handler que se dispara luego) necesita una
  variable, esa variable tiene que estar declarada ANTES en el archivo, no
  después aunque "lógicamente" parezca que va ahí.
- **Contraste de colores**: no asumas que un color se ve bien solo porque
  "type check" pasa — comprueba el contraste real (hay una función de ratio
  WCAG en `server/routes/themes.js`) antes de dar un fix de contraste por
  bueno.
