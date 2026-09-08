# RemindMeLater

Calendario, recordatorios, tareas y notas local-first: **todos los datos
viven dentro de la propia app**, en tu dispositivo, y no salen de ahi
nunca. No hay servidor, ni cuenta, ni nube, ni nada que emparejar: se
abre y funciona. Por dentro es SQLite de verdad (compilado a
WebAssembly), con las mismas consultas de siempre, guardado en el
almacenamiento del propio dispositivo. Ademas del calendario, la app
tiene un hub de "Herramientas" (Gimnasio, Entretenimiento, Finanzas y Viajes — ver mas
abajo).

> **Nota sobre este repositorio.** Esta rama es **solo la app de
> movil**. La version de escritorio (servidor Express + Electron) es
> otro programa, y vive en su propia rama (`escritorio`) con su propio
> ciclo de desarrollo. Aqui no queda nada de ella.

## Arrancar

Para probar cambios rapido durante el desarrollo vale cualquier servidor
de archivos estaticos apuntando a `public/` (la app de verdad es la
nativa, ver "Compilarla para el movil" mas abajo):

```bash
npx http-server public -p 8080
```

Los cambios en `public/` se ven con recargar la pagina, sin compilar
nada.

Para verla como app de verdad en el movil, ver "App nativa de movil"
mas abajo.

**Navegación**: una barra fija abajo con 4 accesos (Calendario, Notas,
Herramientas, Configuración) y un botón
flotante "+" para crear. El segundo hueco es configurable desde
Configuración → Este dispositivo: puedes poner ahí cualquiera de las
herramientas en vez de Notas.

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
    la barra del calendario para alternar sin entrar en Configuración; y si
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
- **Este dispositivo**: ajustes que no se comparten con nadie mas, como
  los avisos de recordatorios, como se ven las tareas completadas
  (tachadas u ocultas), y que apartado vive en el hueco personalizable
  de la barra de abajo.

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

## Herramientas

Desde el botón "Herramientas" de la barra inferior se accede a secciones aparte del calendario, cada una
a pantalla completa y sin afectar a nada de lo de arriba:

- **Gimnasio**: registro de entrenamientos. Una biblioteca de
  ejercicios y de rutinas reutilizables (con icono y color propios); una
  sesión puede partir de una rutina guardada (auto-rellena los
  ejercicios esperados) o ser completamente libre. Cada serie de un
  ejercicio se apunta con repeticiones y peso — elegible en kg o libras,
  por dispositivo (el dato se guarda siempre en kg, la conversión es
  solo de presentación). Una pestaña de progreso muestra una gráfica
  (peso máximo o volumen levantado) por ejercicio a lo largo del tiempo.
- **Entretenimiento**: historial de entretenimiento — mangas, cómics, libros,
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
- Para Android hay otro workflow equivalente
  (`.github/workflows/android-play.yml`, tambien manual) que compila un
  `.aab` **firmado para Google Play** y lo deja como artefacto
  descargable, listo para subir a la Play Console (pruebas internas).
  Los preparativos (keystore, secretos, cuenta de Play Console) estan
  en [`ANDROID-PLAY.md`](ANDROID-PLAY.md).

## Tus datos y la copia de seguridad

**Cada dispositivo tiene sus propios datos, y no se hablan entre ellos.**
Lo que crees en el movil no aparece en el ordenador ni al reves — no hay
sincronizacion de ningun tipo. Y como todo vive dentro de la app,
**desinstalarla borra todo**... salvo que tengas una copia de seguridad.

En Configuración → Este dispositivo → **Copia de seguridad**:

- **Exportar copia** crea un unico archivo `.json` con TODO (calendario,
  tareas, notas con sus imagenes, todas las herramientas, fotos de
  viajes y ajustes) y abre la hoja de compartir del sistema para
  guardarlo donde quieras: en Archivos, iCloud/Drive, mandartelo por
  mensaje... Desde un navegador normal, se descarga sin mas.
- **Importar copia** restaura ese archivo, **sustituyendo** todo lo que
  haya en la app en ese momento (avisa antes, no se puede deshacer).
  Una copia hecha con una version anterior de la app se importa igual:
  la base de datos se pone al dia sola al arrancar.
- La copia es **manual**: si pasa mas de un mes sin hacer ninguna, un
  aviso discreto al abrir la app lo recuerda (se puede posponer con la
  ✕; tocarlo lleva directo al boton de exportar).

Importar la copia de un dispositivo en otro tambien vale como forma de
**pasar todos los datos de un aparato a otro** (por ejemplo, al cambiar
de movil).

## Recordatorios

Cada evento o tarea con fecha puede tener un recordatorio (en el momento,
10 min, 30 min, 1 hora o 1 dia antes). Al activar las notificaciones en
Configuración → Este dispositivo, la app **programa el aviso en el propio
sistema operativo**: suena a su hora aunque la app este cerrada del todo,
sin servidor y sin que nada salga del dispositivo.

Los avisos se reprograman solos cada vez que creas, editas o borras algo,
asi que nunca suena un aviso de algo que ya no existe.

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
- Cada dispositivo tiene sus propios datos: no hay sincronizacion en
  vivo entre aparatos (la copia de seguridad permite pasarlos a mano,
  pero no mantenerlos al dia solos).
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
