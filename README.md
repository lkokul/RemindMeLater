# RemindMeLater

Calendario, recordatorios, tareas y notas local-first: **app de
escritorio** (Electron + SQLite) para Windows. Los datos viven en tu
propio ordenador, nunca en una nube de terceros, y la app no tiene
servidor ni abre ningun puerto: la ventana y la base de datos son el
mismo programa y hablan entre ellas por dentro. Ademas del calendario,
hay un hub de "Herramientas" (Gimnasio, Lecturas, Finanzas y Viajes — ver mas
abajo).

## Arrancar

```bash
npm install
npm start
```

Eso abre la app. Para generar un instalador `.exe` de Windows:

```bash
npm run dist
```

Los datos se guardan en `%APPDATA%\RemindMeLater\data` (la carpeta de
datos del usuario, fuera de la carpeta de instalacion — asi no se pierden
al instalar una version nueva encima). Si arrancas desde el codigo con
`npm start` sin haber instalado la app, van a `data/` dentro del propio
proyecto, ignorado por git.

**Si estas tocando el codigo**: los cambios en `public/` (la interfaz) se
ven recargando la ventana con Ctrl+R, sin cerrar la app. Los cambios en
`core/` (los datos) si necesitan cerrarla y volver a abrirla, porque ese
codigo se carga una sola vez al arrancar.

## Configuración

El icono ⚙, disponible en cualquier pantalla de la app (incluidas las
extensiones a pantalla completa, no solo en el calendario), abre un panel
con varias pestanas:

- **Estilo**: dividido en dos partes independientes entre sí:
  - **Estilo de interacción** (por dispositivo): cómo reaccionan los
    botones al pasar el ratón y cómo se marca un interruptor encendido.
    Cuatro opciones — "Directo" (por defecto: tinte suave del color de
    acento + hundimiento al hacer clic), "Neon" (brillo alrededor en vez
    de tinte), "Cristal" (degradado de dos tonos derivados del acento) y
    "Registro" (estética de panel técnico: tipografía monoespaciada en
    tablas y etiquetas, sin gradientes ni sombras). No cambia ningún
    color del tema, solo el comportamiento.
  - **Colores**: una biblioteca de temas compartida entre todos tus
    dispositivos. Cada dispositivo elige por su cuenta cual tema
    mostrar. Cada tema define un color por cada superficie real de la
    interfaz (fondo, tarjetas, menu de Configuración, dia de hoy, color de
    acento...) **con su propio color de texto emparejado**, para que cada
    superficie garantice su propia legibilidad — hay una red de seguridad
    que fuerza texto blanco o negro si el contraste guardado es demasiado
    bajo. Un tema puede tener ademas una variante clara/oscura emparejada
    (`inverseColors`): si la tiene, aparece un boton de sol/luna rapido en
    la barra superior para alternar sin entrar en Configuración; y si
    eliges "Sistema" como modo de color (por dispositivo), la app cambia
    sola entre ambas en cuanto el sistema operativo cambia de claro a
    oscuro (o al reves), sin recargar la pagina. Los colores se eligen con
    un selector nativo o con paletas predefinidas (Pastel, Vivos, Claros,
    Oscuros). Los temas se pueden exportar/importar como archivo `.json`,
    para guardarlos fuera de la app o pasarlos a otra instalacion. Al editar un tema los cambios
    se ven en vivo en toda la app; no hay boton de guardar por tema, es un
    flujo continuo (cambiar a editar otro tema guarda el anterior solo,
    cerrar sin guardar descarta los cambios).
- **Perfil**: tu nickname (aparece como "creado por" en lo que añadas) y
  tu correo, opcional y sin uso real (ver "Datos personales" mas abajo).
  Tambien es donde se pide la primera vez que se abre la app.
- **Grupos**: listas de recordatorios y tareas con color, al estilo de
  Recordatorios de iPhone. Cada grupo puede tener tambien un icono y un
  color especial para cuando una tarea de ese grupo se marca como hecha
  (si no lo pones, se calcula automaticamente atenuando el color normal).
- **Atajos**: cada accion (nuevo evento, abrir Configuración, mes/dia
  anterior o siguiente...) se puede asignar a la combinacion de teclas
  que quieras. Por defecto: `N` nuevo evento, `←`/`→`
  dia anterior/siguiente.
- **Este dispositivo**: ajustes que no se comparten con nadie mas, como
  las notificaciones del navegador, el modo de vista (ver abajo), como se
  ven las tareas completadas (tachadas u ocultas), y como se ven los
  eventos en dias muy llenos del calendario.

## Vista de pantalla completa

Desde Configuración → Este dispositivo puedes activar **Pantalla
completa** para que la app ocupe toda la pantalla, sin barra del
navegador ni barra de tareas — pensado para dejarla siempre visible en un
monitor o tablet dedicado. En la app de escritorio (ver mas abajo) la
ventana se abre directamente en ese modo la siguiente vez que la
arrancas. En el navegador normal, por una restriccion de los propios
navegadores (no dejan activar pantalla completa sin un clic tuyo), al
cargar la pagina se muestra un aviso con un boton "Activar" en vez de
activarse sola.

## Mi espacio (notas y tareas)

Ademas del calendario, la app tiene una seccion aparte para notas de
texto y tareas:

- **Tareas**: como los eventos, pero pueden no tener fecha (una tarea sin
  fecha aparece en un bloque fijo "Tareas" en el panel de recordatorios,
  con su propio scroll, separado de "Proximos"). Si tienen fecha, se ven
  tambien en el calendario, con el borde en vez de relleno y un icono
  ☐/☑ que puedes pulsar directamente para marcarlas como hechas sin abrir
  el evento.
- **Notas**: editor de texto con formato, a pantalla completa (ver
  "Editor de notas" mas abajo) — negrita, cursiva, listas (con vinetas o
  numeradas, con auto-inicio al escribir y anidado con Tab), tablas de
  tamano fijo redimensionables, bloques de codigo e imagenes (desde
  archivo o pegando con Ctrl+V una captura/imagen copiada). Cada imagen
  se guarda como archivo aparte en la carpeta de datos (no como texto
  dentro de la nota), asi que cargar la lista de notas sigue siendo
  rapido aunque tengan fotos. Una nota se puede ocultar con el icono de
  ojo — no es cifrado real, solo evita que se lea a primera vista, sin
  contraseña de por medio. Tambien se puede marcar como favorita
  (estrella).
- **Carpetas**: para organizar las notas, con nombre y color propios. Las
  carpetas pueden contener otras carpetas — la navegacion es como un
  explorador de archivos (Windows/Finder): ves el contenido de la carpeta
  donde estas (subcarpetas y notas mezcladas, subcarpetas primero) y un
  boton "Volver" que sube un nivel cada vez. Crear una nota o carpeta
  nueva estando dentro de otra carpeta la coloca ahi por defecto. Borrar
  una carpeta no borra lo que hay dentro: sus notas y subcarpetas suben un
  nivel en vez de desaparecer. Tambien se pueden marcar como favoritas.
  Tanto en el listado clasico como en el arbol del editor, el orden es
  siempre carpetas primero, favoritos primero dentro de cada grupo, y
  alfabetico dentro de cada uno.
- **Favoritos**: tanto notas como carpetas se pueden marcar con una
  estrella para que aparezcan destacadas en su listado. Por dispositivo
  puedes elegir si se mezclan con el resto (favoritos primero, sin
  cabecera) o se separan en dos secciones ("Favoritos" / "Todo lo demas").
- **Buscar**: una barra de texto encima del listado de notas busca por
  nombre en TODA la app por defecto (mostrando la ruta de carpeta de cada
  resultado); un boton "Solo esta carpeta" la limita a la carpeta donde
  estes, como antes.
- **Ctrl+Intro** guarda directamente desde los modales de nota, evento y
  tarea, sin tener que ir a buscar el boton "Guardar" con el raton.

Se puede abrir como un panel fijo al lado del calendario, o como una
pantalla propia a pantalla completa con un boton "← Home" para volver
(Configuración → Este dispositivo). En el modo panel fijo, ademas puedes
elegir que secciones (Recordatorios/Tareas/Notas) se agrupan juntas en un
solo hueco con flechas para alternar entre ellas, y cuales se quedan
sueltas y siempre visibles.

### Editor de notas

Al abrir una nota, ocupa toda la pantalla (no un cuadro pequeño como
antes):

- **Varias notas abiertas a la vez**: el panel "Notas" (rail lateral)
  lista las notas que tienes abiertas, con un punto si tienen cambios sin
  guardar, y las puedes cerrar una a una. Cambiar entre ellas no pierde lo
  que estabas escribiendo en las demas.
- **Árbol**: el otro panel del rail muestra todas tus carpetas y notas
  para saltar directamente a cualquiera sin volver a "Mi espacio".
- **Modo lectura**: alterna entre editar y solo consultar la nota (el
  texto deja de parecer un campo editable).
- **Formato**: negrita, cursiva y listas por botones o por atajo
  (Ctrl+B, Ctrl+I, Ctrl+Mayus+7/8). Escribir `"- "` o `"1. "` al
  principio de una linea vacia la convierte en lista automaticamente;
  Tab/Mayus+Tab anida o desanida un nivel.
- **Tablas**: tamaño fijo desde que se insertan (no se autoajustan al
  escribir). Se redimensionan arrastrando el borde de una fila o columna;
  doble clic en un borde ajusta esa fila/columna al contenido. Un boton
  "Borde" alterna entre borde fino y grueso para toda la tabla. Con el
  cursor dentro aparecen botones para anadir/quitar filas y columnas.
- **Bloques de codigo**: boton "Código", o escribir ` ```lenguaje ` +
  Intro en una linea vacia (estilo GitHub/Markdown). Fuente monoespaciada
  sin coloreado por sintaxis (el frontend no usa ninguna libreria
  externa); el nombre del lenguaje se muestra como etiqueta.
- **Modo "vim"** (opt-in, boton "Vim" en la barra del editor): activa
  atajos de movimiento estilo vim ademas de los de formato de siempre.
  `Esc` entra en modo Normal (`h/j/k/l` mover, `w`/`b` palabra, `0`/`$`
  inicio/fin de linea, `x` borrar caracter, `dd` borrar linea, `u`
  deshacer, `i`/`a`/`o` vuelven a Insertar). `v` entra en modo Visual
  (mover para seleccionar, `y` copia, `d` borra). Un indicativo en la
  barra ("INSERTAR"/"NORMAL"/"VISUAL") muestra siempre en que modo estas
  — tambien es un boton, clicarlo rota entre los tres modos si prefieres
  el raton al teclado. Los botones de formato/tabla/imagen funcionan
  igual en cualquier modo (a diferencia del vim real).

## Herramientas

Desde el botón "Herramientas" de la barra superior se accede a secciones aparte
del calendario, cada una a pantalla completa y sin afectar a nada de lo de
arriba:

- **Gimnasio**: registro de entrenamientos. Una biblioteca de
  ejercicios y de rutinas reutilizables (con icono y color propios); una
  sesión puede partir de una rutina guardada (auto-rellena los
  ejercicios esperados) o ser completamente libre. Cada serie de un
  ejercicio se apunta con repeticiones y peso — elegible en kg o libras,
  por dispositivo (el dato se guarda siempre en kg, la conversión es
  solo de presentación). Una pestaña de progreso muestra una gráfica
  (peso máximo o volumen levantado) por ejercicio a lo largo del tiempo.
- **Lecturas**: historial de entretenimiento — mangas, cómics, libros,
  series, animes y películas juntos — agrupado en sagas (obligatorias:
  incluso algo suelto es una saga de un único elemento, y una misma saga
  puede mezclar tipos distintos, ej. las temporadas de una serie y los
  tomos del manga en el que se basa). Cada elemento lleva título,
  descripción opcional, valoración de 0 a 10, géneros, tipo, progreso
  (capítulo/episodio/tomo actual de un total) y cuántos tomos tienes
  comprados. Un estado (Deseado/En progreso/Completado/Abandonado) hace
  también de lista de deseos, sin sección aparte. Tabla de sagas
  primero; dentro de cada una, tabla de sus elementos filtrable por
  tipo, género, estado y valoración.
- **Finanzas**: gastos, ingresos e inversiones. Varias cuentas propias
  (con icono, color y un tipo opcional puramente informativo como
  "Corriente" o "Inversión"), cada una con su saldo calculado en
  automático a partir de un saldo inicial y todo lo registrado en ella —
  nunca guardado a mano, así que no puede desincronizarse. Los gastos
  pueden llevar categoría propia y marcarse como fijos; un límite de
  gasto mensual configurable avisa si te pasas, con desglose por
  categoría. Los **gastos fijos recurrentes** (alquiler, suscripciones...)
  tienen su propio apartado aparte de Movimientos: una plantilla mensual
  (con día elegible) o anual genera sola su movimiento real cuando toca,
  sin tener que crearlo a mano cada vez — si el precio cambia (ej. sube
  Netflix), editas la plantilla y solo afecta a lo que se genere de ahí
  en adelante, nunca a lo ya generado; se puede pausar/reanudar o ponerle
  una fecha de fin ("último mes de pago"). Las inversiones (compra,
  venta, dividendos) son de registro **manual** — sin conectar a ninguna
  cotización en vivo, coherente con que el resto de la app es
  local-first — organizadas por activos que puedes agrupar en carteras
  anidadas (ej. distintos brokers), con un árbol de checkboxes para
  elegir qué activos o carteras enteras ver en la gráfica de evolución
  mensual, y un resumen de la ganancia o pérdida ya realizada por activo.
  Cada activo admite además actualizaciones manuales de precio por
  unidad, con su propia gráfica de líneas para ver la evolución en el
  tiempo. Puedes fijarte un objetivo mínimo de ahorro mensual marcando un
  ingreso como tu salario y un gasto como fijo: la app avisa (sin
  bloquear el objetivo) si no parece alcanzable según tu salario y gastos
  fijos medios de los últimos meses, con una vista para mirar un mes
  concreto (no solo el actual) y otra con el histórico de ahorro en un
  rango de fechas. Una gráfica compara ingresos y gastos mes a mes de los
  últimos 6 meses.
## Como esta montada por dentro

No hay servidor, ni puerto, ni HTTP. La app son tres piezas:

- `public/` — la interfaz: HTML, CSS y JavaScript sin compilar ni
  frameworks. Es lo que se ve en la ventana.
- `core/` — los datos: SQLite (via `node:sqlite`, integrado en Node, sin
  compilar nada nativo) y las rutas que leen y escriben en el. `core/api.js`
  dice que archivo atiende cada ruta y `core/router.js` es un enrutador
  propio de unas 100 lineas, el que sustituyo a Express.
- `electron/` — el pegamento: crea la ventana, sirve `public/` con un
  esquema propio `app://`, y pasa las peticiones de la interfaz a `core/`
  por IPC (el canal interno de Electron).

Cuando la interfaz pide `/api/events`, esa peticion no sale a ninguna
red: viaja por IPC hasta `core/api.js`, que consulta SQLite y devuelve la
respuesta. Las rutas se siguen llamando igual que cuando esto era un
servidor web, pero solo como forma de nombrar cada cosa.

## Recordatorios

Cada evento o tarea con fecha puede tener un recordatorio (en el momento,
10 min, 30 min, 1 hora o 1 dia antes). Cuando toca, dispara:

- un aviso en pantalla si tienes la ventana abierta (activable en
  Configuración → Este dispositivo), y
- una notificacion del sistema operativo, que sale aunque tengas la
  ventana minimizada, mientras la app este abierta.

## Datos personales

La primera vez que se abre la app aparece una pantalla de bienvenida
pidiendo dos datos, los dos **opcionales**:

- **Nickname**: aparece como "creado por" en los eventos y notas que
  añadas.
- **Correo**: no se usa para nada. Es un resto de cuando existia la
  version movil con avisos push, donde el protocolo exigia un correo de
  contacto. Se puede dejar vacio.

Ningun dato sale de tu ordenador. La unica conexion a internet que hace
la app es comprobar si hay una version nueva del codigo en GitHub, y solo
si se lo pides.

## Lo que queda fuera, de momento

- El formato de las notas es basico (negrita, cursiva, listas, tablas,
  imagenes) — sin tablas con celdas combinadas, sin cambiar el tamano de
  una imagen ya insertada, sin encabezados/titulos.
- Si quitas una imagen de una nota editandola (sin borrar la nota
  entera), el archivo se queda huerfano en el disco — solo se limpia al
  borrar la nota completa.
- No hay forma de mover una carpeta de notas ya creada a otra carpeta
  distinta (si se puede mover una nota entre carpetas desde su propio
  editor).
- Solo se genera instalador para Windows.
- **No hay nada de movil, a proposito.** Hasta la v0.33.1 esto era
  ademas una app web que el movil abria por wifi, con su propio diseño
  para pantallas estrechas (barra inferior, vista diaria, calendario en
  circulos, vista de notas propia), emparejamiento por codigo,
  sincronizacion, avisos push, una extension "Archivos" para pasarse
  archivos entre los dos, y un envoltorio nativo con Capacitor para
  Android/iOS. Todo eso se quito: la app de escritorio y la movil son
  cosas independientes. Sigue disponible en la rama `main` del
  repositorio si algun dia hace falta recuperarlo.
- El modo "vim" del editor de notas es un subconjunto pequeño a
  proposito (sin registros con nombre, macros, `:` comandos, `yy`/`p`,
  repetir con numeros) — se puede ampliar mas adelante segun haga falta.
