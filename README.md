# RemindMeLater

Calendario, recordatorios, tareas y notas local-first: **todos los datos
viven dentro de la propia app**, en tu dispositivo, y no salen de ahi
nunca. No hay servidor, ni cuenta, ni nube, ni nada que emparejar: se
abre y funciona. Por dentro es SQLite de verdad (compilado a
WebAssembly), con las mismas consultas de siempre, guardado en el
almacenamiento del propio dispositivo. Ademas del calendario, la app
tiene un hub de "Apps" (Gimnasio, Lecturas, Finanzas y Viajes — ver mas
abajo).

> **Nota sobre este repositorio.** Aqui conviven dos programas
> independientes que comparten historia: esta app (la interfaz de
> `public/`, que es de lo que habla este README) y la version de
> escritorio con servidor (`server/`, `electron/`), que se desarrolla
> por separado. Lo que se cuenta aqui describe la app tal y como es
> ahora: sin servidor.

## Arrancar

Para verla en el navegador del ordenador mientras se desarrolla, vale
cualquier servidor de archivos estaticos apuntando a `public/`:

```bash
npx http-server public -p 8080
```

O, si prefieres no instalar nada, `npm start` tambien sirve la carpeta
`public/` en `http://localhost:3000` (arranca ademas el servidor de la
version de escritorio, que esta app ya no usa para nada — es solo la
forma mas corta de tener un servidor de archivos a mano).

Los cambios en `public/` se ven con recargar la pagina, sin compilar
nada.

Para verla como app de verdad en el movil, ver "App nativa de movil"
mas abajo.

**Navegación en el móvil**: en pantallas estrechas, la barra superior de
escritorio (título + botones sueltos) se sustituye por una barra fija
abajo con 4 accesos (Calendario, Notas, Apps, Configuración) y un botón
flotante "+" para crear. El segundo hueco es configurable desde
Configuración → Este dispositivo: puedes poner ahí cualquiera de las
Apps en vez de Notas. En escritorio no cambia nada.

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
  - **Colores**: una biblioteca de temas. Cada tema define un color por cada superficie real de la
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
    que es la unica forma de pasar uno de un dispositivo a otro. Al
    editar un tema los cambios
    se ven en vivo en toda la app; no hay boton de guardar por tema, es un
    flujo continuo (cambiar a editar otro tema guarda el anterior solo,
    cerrar sin guardar descarta los cambios).
- **Perfil**: tu nickname, que aparece como "creado por" en los eventos
  y tareas que anadas. Tambien es donde se pide la primera vez que se
  abre la app.
- **Grupos**: listas de recordatorios y tareas con color, al estilo de
  Recordatorios de iPhone. Cada grupo puede tener tambien un icono y un
  color especial para cuando una tarea de ese grupo se marca como hecha
  (si no lo pones, se calcula automaticamente atenuando el color normal).
- **Atajos**: cada accion (nuevo evento, abrir Configuración, mes/dia
  anterior o siguiente...) se puede asignar a la combinacion de teclas
  que quieras, por dispositivo. Por defecto: `N` nuevo evento, `←`/`→`
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
  se sube al servidor y se guarda como archivo aparte (no como texto
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

## Apps

Desde el botón "Apps" de la barra superior (o la sección "Apps" de la
navegación móvil) se accede a secciones aparte del calendario, cada una
a pantalla completa y sin afectar a nada de lo de arriba:

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

## App de escritorio (Electron)

En este mismo repositorio vive tambien la version de escritorio
(`server/`, `electron/`): un servidor Express con su propia base de datos
SQLite, empaquetable como programa de Windows (`npm run electron` para
probarla, `npm run dist` para generar el instalador). Es **otro
programa**, con su propio ciclo de desarrollo — lo que se describe en
este README es la app sin servidor.

## App nativa de movil (iOS y Android)

La app se empaqueta como app nativa de verdad con
[Capacitor](https://capacitorjs.com/): la misma interfaz web de siempre,
sin reescribir nada, metida en una carcasa nativa con su propio icono en
la pantalla de inicio.

Al no haber servidor, la app **lleva todo dentro**: su codigo y sus
datos. Abre siempre, sin wifi, sin ordenador encendido y sin
configuracion inicial de ningun tipo.

- Los proyectos nativos viven en `android/` e `ios/`, generados por
  Capacitor y comiteados al repo. `npm run cap:sync` copia la version
  actual de `public/` a los dos; `npm run cap:android` y
  `npm run cap:ios` los abren en Android Studio / Xcode.
- Para compilar y firmar la app de iOS **sin tener un Mac**, hay un
  workflow de GitHub Actions listo (`.github/workflows/ios-testflight.yml`,
  disparo manual desde la pestaña Actions) que compila en un runner de
  macOS, firma con una clave de API de App Store Connect y sube el
  resultado a TestFlight. Los pasos de configuracion (cuenta de
  desarrollador, secretos, como instalarla en el iPhone) estan en
  [`IOS-TESTFLIGHT.md`](IOS-TESTFLIGHT.md).

## Instalar como app (PWA)

En el navegador (ordenador o movil) la app tambien se puede "instalar"
(Añadir a pantalla de inicio / Instalar app) para que se abra como una
app independiente, con su propio icono, en vez de una pestaña. Funciona
igual que la app nativa: los datos son los de ese navegador, en ese
dispositivo.

**Cada dispositivo tiene sus propios datos, y no se hablan entre ellos.**
Lo que crees en el movil no aparece en el ordenador ni al reves — no hay
sincronizacion de ningun tipo. Y como todo vive dentro de la app,
**desinstalarla (o borrar los datos del navegador) borra todo**. Poder
exportar e importar una copia de seguridad es lo siguiente que hace
falta; hoy no existe.

## Recordatorios

Cada evento o tarea con fecha puede tener un recordatorio (en el momento,
10 min, 30 min, 1 hora o 1 dia antes). Al activar las notificaciones en
Configuración → Este dispositivo, la app **programa el aviso en el propio
sistema operativo**: suena a su hora aunque la app este cerrada del todo,
sin servidor y sin que nada salga del dispositivo.

Los avisos se reprograman solos cada vez que creas, editas o borras algo,
asi que nunca suena un aviso de algo que ya no existe. En el navegador
normal (sin empaquetar) no hay avisos programados: ahi solo llega la
notificacion mientras la pestaña esta abierta.

## Datos personales

La primera vez que se abre la app aparece una pantalla de bienvenida
pidiendo **un solo dato, opcional**: un nickname, que aparece como
"creado por" en los eventos y tareas que anadas. Se puede cambiar o
dejar vacio en cualquier momento desde Configuración → Perfil.

No se pide nada mas, y **ningun dato sale del dispositivo**: no hay
cuenta, ni servidor, ni servicio de terceros de por medio. Ni siquiera
los avisos, que los programa el propio sistema operativo (a diferencia
de las notificaciones push, que obligarian a pasar por Google o Apple).

## Lo que queda fuera, de momento

- El formato de las notas es basico (negrita, cursiva, listas, tablas,
  imagenes) — sin tablas con celdas combinadas, sin cambiar el tamano de
  una imagen ya insertada, sin encabezados/titulos.
- **No hay copia de seguridad**: no se puede exportar ni importar los
  datos, asi que desinstalar la app (o borrar los datos del navegador)
  los borra para siempre. Es lo mas importante que falta.
- Cada dispositivo tiene sus propios datos, sin ninguna forma de
  pasarlos de uno a otro.
- Si quitas una imagen de una nota editandola (sin borrar la nota
  entera), sus bytes se quedan huerfanos — solo se limpian al borrar la
  nota completa.
- No hay forma de mover una carpeta de notas ya creada a otra carpeta
  distinta (si se puede mover una nota entre carpetas desde su propio
  editor).
- Widgets de pantalla de inicio o accesos en el Centro de Control
  (iPhone) harian falta frameworks nativos propios (WidgetKit/ControlKit)
  — queda anotado como posible proyecto aparte, no en desarrollo.
- Redimensionar tablas de notas es solo con raton (arrastrar bordes) —
  no hay equivalente tactil todavia en movil.
- El modo "vim" del editor de notas es un subconjunto pequeño a
  proposito (sin registros con nombre, macros, `:` comandos, `yy`/`p`,
  repetir con numeros) — se puede ampliar mas adelante segun haga falta.
