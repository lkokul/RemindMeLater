# RemindMeLater — Ideario completo (conversación de movil-ui)

Recopilación de TODAS las ideas, funciones y decisiones que se han ido
hablando y construyendo a lo largo de la conversación de la app móvil
(esta rama, `movil-ui`): la mayoría ya existen aquí, otras se quitaron
por el camino, y otras están solo apuntadas. Pensado como base de
trabajo para ir desarrollando el proyecto completo: qué existe, cómo se
decidió que funcione, y qué queda por inventar.

Leyenda de estado:
- ✅ construido y funcionando (en la app móvil, rama `movil-ui`)
- 🗄️ existió en la versión cliente-servidor antigua (se quitó del
  móvil al desaparecer el servidor, pero la idea/código sirven para
  escritorio)
- 💡 solo apuntado, sin empezar

---

## 1. Núcleo: calendario, eventos, tareas y recordatorios

- ✅ **Tres vistas de calendario**: anual (círculos por día, punto si
  hay contenido, anillo si además es hoy), mensual y diaria.
- ✅ **Tres densidades del mes**: Compacto (píldora fusionada con un
  color por cada grupo distinto del día), Apilado (hasta 2 barras +
  "+N"), Listado (mes arriba + lista del día elegido abajo, 50/50).
- ✅ **Vista diaria con dos sub-vistas**: "Horas" (rejilla de 24h,
  eventos posicionados al minuto exacto, 1px = 1 minuto, línea de hora
  actual, fila aparte para "todo el día", carriles para solapes) y
  "Listado" (bloques por día con scroll infinito bidireccional, solo
  días con contenido).
- ✅ **Navegación por gestos**: swipe vertical para cambiar de mes/año,
  horizontal para cambiar de día; con animación de deslizamiento.
- ✅ **Eventos**: título, grupo, inicio/fin, "todo el día" (oculta las
  horas al marcarse), recordatorio (al momento / 10min / 30min / 1h /
  1día antes). Por defecto: hora redondeada a la media hora y duración
  de 1 hora.
- ✅ **Campo de hora inteligente**: autocompleta los ":" mientras se
  escribe ("2056" → "20:56"), marca en rojo una hora inválida y
  bloquea el guardado con aviso propio (nunca guarda algo inventado).
- ✅ **Tareas**: filas de `events` con `is_task = 1` (no tabla aparte);
  fecha opcional, campo `done` propio, ☐/☑ clicable en el calendario,
  borde en vez de relleno. Color de "completada" opcional por grupo (o
  calculado atenuando el color normal). "Tachar vs ocultar" completadas
  es ajuste por dispositivo.
- ✅ **Recordatorios completables**: también se pueden marcar como
  hechos, no solo las tareas.
- ✅ **Grupos**: nombre + icono + color + posición; vista propia de
  Grupos con gestión, filtros, búsqueda y distinción tarea/recordatorio.
- ✅ **Días especiales** (festivos/señalados) con su color en el
  calendario.
- ✅ **Buscador global**: eventos + tareas + notas por texto, con
  indicador de tipo; tocar un resultado lleva al día/hora exacta del
  evento (o abre la tarea sin fecha, o la nota).
- ✅ **Avisos con la app cerrada**: notificaciones programadas en el
  propio sistema operativo (Capacitor local-notifications en móvil;
  en escritorio el equivalente sería node-notifier/notificaciones del
  SO, como hacía la versión antigua con `reminderChecker`). Permiso
  pedido la primera vez que se abre la app, interruptor en
  Configuración. Reprogramación "borrar todo y rehacer" para que nunca
  suene un aviso huérfano.

## 2. Mi espacio: notas

- ✅ **Carpetas anidadas** estilo explorador de archivos (subcarpetas
  arriba, notas debajo, "Volver" de un nivel). Nombre + color (sin
  icono propio, a propósito). Borrar una carpeta sube su contenido UN
  nivel (nunca destruye), con checkbox opcional de "eliminar también
  lo de dentro" (cascada real).
- ✅ **Favoritos** en notas y carpetas, con dos modos de mostrar
  (mezclados primero / con cabecera "Favoritos").
- ✅ **Búsqueda** por nombre dentro de la carpeta actual.
- ✅ **Vista galería o listado** (ajuste global por dispositivo) +
  **ordenar** por fecha de edición/creación/nombre, asc/desc. La
  galería muestra miniatura (primera imagen) o color + avance de texto.
- ✅ **Seleccionar → Mover/Eliminar**: modo de selección múltiple con
  checkboxes propios; mover navegando a la carpeta destino ("Mover
  aquí"); eliminar con modal que lista lo elegido y permite excluir
  tocando. Único mecanismo para mover (se quitó el desplegable de
  carpeta de dentro de la nota, decisión de simplicidad).
- ✅ **Título derivado**: la primera línea de la nota ES el título (se
  quitó el campo aparte); etiqueta de solo lectura en vivo.
- ✅ **Autoguardado** (móvil) con debounce ~1.5s; una nota nueva vacía
  no se guarda al salir. En escritorio se decidió mantener guardado
  manual + Ctrl+Intro.
- ✅ **Editor con formato estilo Notas de iPhone**:
  - Negrita/cursiva/subrayado/tachado (desde la selección o "a partir
    de ahora").
  - Estilos de párrafo: Título/Encabezado/Subencabezado/Cuerpo/
    Monoespaciado (aplican al párrafo entero).
  - Listas con viñetas y numeradas (Tab/Shift+Tab para sangrar items).
  - Cita (franja vertical de acento) y sangría por niveles (0–4),
    ambas por atributos `data-*` propios, combinables.
  - Resaltado de 5 colores pastel con texto oscuro de la misma familia
    (contraste WCAG comprobado), esquinas redondeadas, recuadro
    continuo en varias líneas, "Ninguno" como pastilla transparente, y
    aro de acento marcando el color en uso. Funciona seleccionando o
    activándolo antes de escribir; sobrevive a Intro/split de párrafo
    (Intro manual con Range API en líneas con resaltado).
  - **Tablas**: insertar con filas/columnas a elegir, icono en la
    esquina superior derecha que abre la barra de estructura
    (+/-fila, +/-columna, mover, bordes por casilla 1–4, marcar
    casillas, combinar celdas), historial propio de deshacer/rehacer
    de estructura, auto-ajuste al texto con scroll horizontal propio.
  - **Imágenes**: botón + Ctrl+V; el HTML guarda un enlace corto, los
    bytes viven aparte (nunca base64 dentro de la nota).
  - Bloques de código, modo lectura, y (solo escritorio) modo vim +
    panel de árbol de carpetas + panel de notas abiertas en pestañas.
  - Barra colapsada en un botón "Formato" (popover con todo dentro),
    que se cierra al tocar fuera, al hacer scroll o con Esc — pero NO
    al seleccionar texto (para poder aplicar formato).
  - Saneado estricto al guardar: lista blanca de etiquetas y atributos
    (`data-highlight`/`data-indent`/`data-quote`/`data-style` con
    valores cerrados), nada de estilos en línea arbitrarios.
- ✅ **Notas ocultas**: marcar con el ojo, difuminadas en la lista.
  (La contraseña compartida opcional existió y se quitó — quedó como
  simple `hidden: true/false`.)
- 🗄️ **Mi espacio como hub** de 3 columnas (Recordatorios/Tareas/
  Notas) con expandir por título, modo "panel" (junto al calendario) o
  "topbar" (pantalla completa), y el panel lateral clásico con
  "agrupar secciones con flechas" — todo esto es concepto de
  ESCRITORIO (en móvil se sustituyó por la vista de Notas propia).

## 3. Herramientas (extensiones)

Hub a pantalla completa (antes "Extensiones", luego "Apps", ahora
"Herramientas"). Patrón común: cada una con su esquema propio, borrado
en cascada A MANO en las rutas (nunca `ON DELETE CASCADE`), y sin tocar
el calendario.

### Gimnasio 🏋️
- ✅ Biblioteca de ejercicios (grupo muscular opcional), rutinas
  reutilizables (nombre+icono+color, ejercicios con series/reps
  objetivo), sesiones (desde rutina que auto-rellena, o libres),
  series con reps + peso.
- ✅ Progreso: gráfica SVG a mano por ejercicio (peso máximo o
  volumen), sin librerías.
- ✅ Unidad kg/libras por dispositivo (el dato siempre en kg).
- ✅ Reglas: borrar ejercicio con historial se rechaza; borrar rutina
  deja las sesiones con `routine_id = NULL`.
- 💡 **Rediseño pendiente** inspirado en la app de un amigo (Koku
  tiene una rama propia `gimnasio-movil` bastante avanzada con ello).

### Lecturas 📚
- ✅ Historial de entretenimiento en general: sagas OBLIGATORIAS
  (todo vive en una saga, aunque sea de un solo item) que pueden
  mezclar tipos (manga/cómic/libro/serie/anime/película).
- ✅ Por item: título, descripción, rating 0–10 (slider + número
  sincronizados), estado (Deseado/En progreso/Completado/Abandonado —
  la "lista de deseos" es un estado, no una sección aparte), géneros
  (texto libre + 16 predefinidos + sugerencias globales de lo ya
  usado), progreso (actual/total + unidad libre: capítulos, tomos...),
  y tomos comprados (cantidad simple "5 de 10").
- ✅ Tabla de sagas → detalle con filtros (tipo, estado, género,
  rating mínimo). Borrar una saga SÍ arrastra sus items (sin saga
  obligatoria no tienen sentido).

### Finanzas 💶
- ✅ **Cuentas** (nombre/icono/color/saldo inicial + tipo informativo:
  Corriente/Ahorro/Inversión/Efectivo/Otro). Saldo SIEMPRE calculado,
  nunca guardado. Borrar cuenta con movimientos se rechaza.
- ✅ **Categorías de gasto** propias (borrar deja los gastos sin
  categoría, no los destruye).
- ✅ **Movimientos**: gastos e ingresos, con "cuenta para el límite
  mensual" (flag por gasto), "es tu salario" (ingresos) y "gasto fijo"
  (gastos), filtros por cuenta/categoría/tipo/rango de fechas.
- ✅ **Límite mensual de gasto** con barra de progreso (roja si se
  supera) y desglose por categoría.
- ✅ **Ahorro**: objetivo mínimo mensual; el ahorro real es ingresos −
  TODOS los gastos; aviso de "objetivo poco realista" comparando
  contra la media de salario − gastos fijos de 6 meses (avisa pero
  deja guardar). Vista mensual (mes a elegir con flechas) + vista
  histórica (rango de meses, tabla con cumplido/no).
- ✅ **Gastos fijos recurrentes**: plantillas (mensual con día, o
  anual con día+mes, fecha de fin opcional "último pago"); un
  generador crea la transacción real cuando toca (al abrir la app en
  móvil; en escritorio puede ser un chequeo periódico). Editar la
  plantilla no toca lo ya generado (ejemplo Netflix: cambiar el precio
  solo afecta a las próximas). Nunca rellena periodos perdidos hacia
  atrás.
- ✅ **Inversiones**: registro manual de compra/venta/dividendos
  (explícitamente SIN APIs de cotización en vivo); ganancia/pérdida
  REALIZADA por activo; compras marcables como "cuenta para el límite".
- ✅ **Carteras anidadas** (tipo carpetas) con activos dentro; árbol
  de checkboxes junto a la gráfica para filtrar por cartera o activo.
- ✅ **Valoraciones manuales de precio** por activo (fecha + precio/
  unidad) con gráfica de líneas de su evolución.
- ✅ **Gráficas**: evolución mensual ingresos vs gastos (barras, 6
  meses), evolución de inversiones (comprado/vendido/dividendos por
  mes, filtrable), con tooltip propio que sigue al ratón.
- ✅ **Deudas** (construida en una ronda fuera de esta conversación,
  existe en el código).
- 💡 **Repensar Finanzas entera**: Koku quiere que sea "realmente
  útil", no "una tontería con 4 cosas" — investigar qué tiene una app
  de finanzas personales seria antes de diseñar más.

### Viajes 🗺️
- ✅ Mapamundi SVG interactivo (dataset MIT con contornos reales
  incluidos los micro-estados; Israel unificado dentro de Palestina a
  petición; Taiwán como marcador), con zoom/paneo propios (rueda,
  arrastre, pellizco, botones +/−), hover con nombre del país, países
  visitados resaltados, clic en país → sus viajes / crear viaje ahí.
- ✅ Viajes multi-país (grupo + países + fechas + color +
  descripción), con filtros multi-selección por año/mes/país (chips
  con ✕) y el matiz "incluir viajes con más países" (unión vs
  subconjunto).
- ✅ Bitácora por viaje: entradas de texto con fotos, y MOVIMIENTOS
  (gasto/ingreso) separados de las fotos, con foto de ticket opcional,
  editables, y enlazables a Finanzas.
- ✅ Enlace con Finanzas POR VIAJE (con aviso retroactivo para enlazar
  gastos anteriores) y cuenta por defecto por viaje.

### Archivos 📂 (quitada del móvil — idea natural de ESCRITORIO)
- 🗄️ Transferencia de archivos entre móvil y ordenador con dos
  paneles estilo TightVNC (este dispositivo ⇄ carpeta compartida),
  flechas → / ←, selección por checkboxes.
- 🗄️ Carpeta compartida configurable + explorador de carpetas del
  disco completo (solo desde el ordenador), navegable desde el panel.
- 🗄️ **Doble confirmación**: cuando la transferencia la inicia un
  móvil, el ordenador tiene que aceptar (solicitudes con TTL de 2 min,
  polling) — salvaguarda contra accidentes, no barrera de seguridad.
- 🗄️ Aviso de seguridad: en redes que no son de confianza, mejor
  datos móviles.
- 🗄️ Sincronización manual desde este apartado + aviso de versión
  nueva visible también en el móvil.

### Descargas ⬇️ (vive en la rama `descargas`, natural de ESCRITORIO)
- 🗄️ Descargador genérico de cualquier URL (sin binarios externos,
  con redirecciones y progreso), descarga de vídeo/audio vía `yt-dlp`,
  y convertidor de formatos vía `ffmpeg` (binarios del sistema, nunca
  paquetes npm). Cola secuencial de trabajos con progreso, cancelación
  y recuperación tras un cierre a medias; carpeta fija
  `DATA_DIR/downloads`.

## 4. Temas, estilo e interfaz

- ✅ **Temas de color** con un color de contraste emparejado POR CADA
  superficie (`bg`/`bgText`, `surface`/`surfaceText`...), no un "texto
  global" — cada superficie garantiza su legibilidad. Red de seguridad
  de contraste real (fórmula WCAG). Variante clara/oscura opcional por
  tema (`inverseColors`) + botón rápido ☀/☾; preferencia de modo por
  dispositivo. Temas sembrados: Predeterminado, Pastel y Neón (los dos
  que salían de guías de diseño privadas de Koku, "EINES" y "Registro",
  se quitaron del sembrado: no viajan dentro de la app, solo siguen en
  la base de datos de quien ya los tuviera). Biblioteca editable con
  borrador en vivo (editar aplica al instante, cambiar de tema guarda
  solo).
- ✅ **Estilos de interacción** independientes del color: Directo /
  Neón / Cristal / Registro (cómo reaccionan botones e interruptores;
  Registro añade tipografía mono en tablas/etiquetas).
- ✅ **Nunca controles nativos del navegador**: selects, fechas, horas
  y checkboxes siempre con componentes propios (`createSelectField`,
  `createDateField`, `createTimeField`, `createMultiSelectField` con
  chips, `.styled-checkbox`, popovers de color/icono). Modal de
  confirmación/aviso propio en vez de `confirm()`/`alert()` (con
  checkbox opcional de "no volver a mostrar").
- ✅ **Patrones establecidos**: popovers medidos con altura real (no
  estimada), "build once" para no fugar popovers, bloqueo de scroll de
  fondo con cualquier modal abierto, Esc capa a capa en toda la app,
  mantener la vista al recargar (sin restaurar formularios a medias),
  Ctrl+Intro guarda en los modales.
- 💡 **Rediseño visual del visor de ESCRITORIO**: reestructurar cómo
  se ve la app en pantalla grande (más accesible, más rápida de usar)
  — estructura visual, no funcionamiento. ESTE es el proyecto que
  motiva este documento.

## 5. Datos, sincronización y copia de seguridad

- ✅ **Local-first**: los datos viven en el dispositivo. En móvil,
  SQLite compilado a WebAssembly (sql.js) con las mismas rutas del
  backend portadas dentro de la app; en escritorio, Express +
  `node:sqlite` (o Electron puro, según la rama `escritorio`).
- ✅ **Copia de seguridad**: exportar un único `.json` con TODO (base
  de datos, imágenes/fotos, ajustes) por la hoja de compartir del
  sistema (o descarga); importar valida antes de borrar, avisa
  (destructivo) y restaura todo; una copia vieja migra sola al
  arrancar. Manual + recordatorio discreto a los ~30 días (posponible
  7). También sirve para pasar todo de un aparato a otro.
- 🗄️ **Sincronización por LAN sin nube** (existió completa en la
  versión cliente-servidor): registro de cambios (`sync_log`),
  pull/push con "el más reciente gana" (borrado gana el empate),
  copia local en IndexedDB con cola de pendientes e ids temporales
  remapeados, indicador de estado en la topbar, limpieza automática
  del log. Se pasó de automática (30s + al reconectar) a SOLO manual
  a petición de Koku.
- 🗄️ **Emparejamiento**: código de 6 dígitos (TTL 30s, máx. 5
  intentos fallidos por IP con bloqueo de 10 min), token por
  dispositivo, QR de reconexión multi-red (cambiar de wifi sin volver
  a emparejar), descubrimiento por mDNS.
- 🗄️ **Web Push/VAPID** (existió): avisos con la pestaña cerrada vía
  Google/Apple, contenido cifrado extremo a extremo, email de contacto
  técnico opcional en el perfil. En apps empaquetadas se sustituyó por
  notificaciones locales, mejores para este caso.
- 💡 **Comunicación escritorio↔móvil en la v1** (apuntado
  expresamente): cuando las dos apps lleguen a la versión 1, que
  puedan hablarse para pasar la copia de seguridad al ordenador (y
  similares). Sin diseñar.

## 6. Empaquetado y distribución

- ✅ **Capacitor** para móvil: la misma web sin build ni framework,
  envuelta en app nativa; plugins registrados a mano (sin bundler).
- ✅ **GitHub Actions como fábrica**: workflow de iOS (compila, firma
  con clave de API de App Store Connect y sube a TestFlight, sin
  necesitar un Mac) y workflow de Android (`.aab` firmado para Google
  Play, artefacto descargable; secretos solo en GitHub). Lanzamiento
  siempre manual — el número de ejecuciones es limitado.
- 🗄️ **Electron** para escritorio (la rama `escritorio` es de Koku).
- 🗄️ **PWA** (manifest + service worker que solo cachea el shell,
  nunca los datos).
- 💡 **React + apps nativas multiplataforma** (macOS/Windows/Linux/
  Android) compiladas con Actions, manteniendo poder trabajar en
  navegador sin compilar durante el desarrollo. Idea grande, sin
  desarrollar — exigirá una ronda de preguntas y plan propio (hoy la
  filosofía es "sin build ni framework").
- 💡 **Widgets / Centro de Control (iPhone)**: no viables sin
  frameworks nativos (WidgetKit/ControlKit) — anotado como posible
  proyecto nativo aparte.

## 7. Ideas sueltas sin empezar (backlog puro)

- 💡 **Idiomas**: selector español/inglés (aplazado hace mucho).
- 💡 **Guías de uso en la Tienda**: que cada herramienta tenga su guía
  dentro del apartado de Tienda de Configuración (cómo va el editor de
  tablas, Grupos...). Precedente: el aviso de "mover a mano" de las
  tablas con "no volver a mostrar".
- 💡 **Extensión nueva estilo Notion**: "hacer algo guay" con esa
  idea — solo constancia, sin ningún detalle todavía.
- 💡 **Rama `github`**: creada vacía para una idea futura relacionada
  con GitHub/gestor de versiones, sin concretar.

## 8. Reglas de diseño que valen para cualquier rama

- **Simplicidad de cara al usuario**: que no falte nada, pero que
  tampoco sobre. (Es sobre la interfaz — el código simplemente no debe
  ser un espagueti.)
- **Nada destructivo en silencio**: borrar contenedores nunca destruye
  el contenido sin avisar (sube de nivel, queda sin categoría, o se
  rechaza si hay historial); lo irreversible siempre avisa antes.
- **Valores calculados, no guardados** (saldos, títulos derivados,
  estados de carpeta en árboles) — no hay forma de que se desincronicen.
- **Ajustes por dispositivo vs compartidos**: lo que es preferencia
  visual/local (densidad, orden, unidad de peso, modo claro/oscuro) va
  en localStorage; los datos de verdad, en la base.
- **Sin librerías salvo necesidad real**: gráficas en SVG a mano,
  gestos con Pointer Events propios, tooltips propios. Lo vendorizado
  (sql.js, mapa SVG, jsQR) siempre con licencia libre y sin CDN.
- **Verificar con números y navegador real** (Playwright + comprobar
  cálculos a mano), y limpiar los datos de prueba después.
