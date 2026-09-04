# RemindMeLater

Calendario, recordatorios, tareas y notas local-first: los datos viven en
tus propios dispositivos, nunca en una nube de terceros. El ordenador
guarda todo en SQLite (`data/remindmelater.db`, ignorado por git — o en
la carpeta de datos de la app si usas la version de escritorio); el
movil, una vez vinculado, guarda tambien su propia copia y sincroniza los
cambios en los dos sentidos con el ordenador cuando pulsas "Sincronizar
ahora" (manual, sin ningun disparador automatico de fondo), sin depender
de ningun servidor intermedio en internet (ver "Instalar como app" mas
abajo). Ademas del calendario, la app tiene un hub de "Extensiones"
(Gimnasio, Lecturas, Finanzas y Archivos — ver mas abajo).

## Arrancar

```bash
npm install
npm start
```

**Si estoy haciendo cambios en el codigo del servidor (`server/`)** usa
`npm run dev` en su lugar: reinicia solo cada vez que se guarda un cambio,
sin que tengas que pararlo y arrancarlo a mano. Los cambios en `public/`
(la interfaz) no necesitan ni eso — con recargar la pagina en el
navegador ya se ven.

La terminal muestra dos (o tres) direcciones:

- `http://localhost:3000` — para abrir en el navegador del propio ordenador.
- `http://<tu-ip-local>:3000` — para abrir desde el movil, **estando en la
  misma red wifi que el ordenador**.
- `http://remindmelater.local:3000` — mismo destino que la anterior, pero
  con un nombre en vez de una IP (mDNS/Bonjour). En Safari (iPhone) hace
  falta escribir el `http://` delante a mano, si no lo trata como una
  busqueda en vez de una direccion.

Deja el servidor corriendo mientras quieras que el calendario este
disponible (tambien para que los recordatorios de escritorio funcionen).

## Vincular el movil

Por seguridad, ningun dispositivo puede leer ni escribir tus datos hasta
que lo autorizas explicitamente desde el ordenador:

1. En el ordenador, abre la app y pulsa ⚙ **Configuración** → pestaña
   **Dispositivos** → **Vincular nuevo dispositivo**. Aparece un codigo de
   6 digitos, valido 30 segundos, de un solo uso (y bloqueado unos minutos
   tras varios intentos fallidos seguidos, para que sea impracticable
   intentar adivinarlo).
2. En el movil, abre la direccion de arriba. Como todavia no esta
   vinculado, vera una pantalla pidiendo ese codigo.
3. Escribe el codigo y un nombre para el dispositivo (ej. "iPhone de
   Koku"). A partir de ahi, ese movil queda autorizado permanentemente
   (hasta que lo revoques).

Esa pantalla pide tambien la **direccion del ordenador**. Si abriste la
app desde el navegador, viene ya rellenada con la direccion por la que
entraste y no hay que tocarla; en la app nativa (ver mas abajo) hay que
escribirla la primera vez, porque ahi la app carga su propio codigo desde
el movil y no "sabe" de donde vienen los datos. Se puede cambiar despues
en cualquier momento desde Configuración → Este dispositivo → "Escanear
ordenador".

Puedes ver, renombrar (con icono/emoji) y revocar dispositivos vinculados
en cualquier momento desde esa misma pestana, en el ordenador (no
funciona desde el movil, a proposito). El propio ordenador donde corre el
servidor esta autorizado siempre, sin codigo (se reconoce por ser
`localhost`).

**Navegación en el móvil**: en pantallas estrechas, la barra superior de
escritorio (título + botones sueltos) se sustituye por una barra fija
abajo con 4 accesos directos (Calendario, Mi espacio, Extensiones,
Configuración) y un botón flotante "+" que despliega los accesos de
crear evento, tarea o nota. En escritorio no cambia nada.

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
    para pasarlos entre dispositivos que no pueden emparejarse
    directamente entre si (ej. dos moviles). Al editar un tema los cambios
    se ven en vivo en toda la app; no hay boton de guardar por tema, es un
    flujo continuo (cambiar a editar otro tema guarda el anterior solo,
    cerrar sin guardar descarta los cambios).
- **Perfil**: tu nickname (se ve igual en todos tus dispositivos
  vinculados) y tu correo (opcional, solo se usa como contacto tecnico
  para las notificaciones push del movil — ver "Datos personales" mas
  abajo). Tambien es donde se pide la primera vez que se abre la app.
- **Grupos**: listas de recordatorios y tareas con color, al estilo de
  Recordatorios de iPhone. Cada grupo puede tener tambien un icono y un
  color especial para cuando una tarea de ese grupo se marca como hecha
  (si no lo pones, se calcula automaticamente atenuando el color normal).
- **Dispositivos**: emparejar, renombrar y revocar. Tambien muestra el QR
  para reconectar un movil ya vinculado en otra red (ver "Instalar como
  app" mas abajo).
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

## Extensiones

Desde el botón "Extensiones" de la barra superior (o la sección
"Extensiones" de la navegación móvil) se accede a secciones aparte del
calendario, cada una a pantalla completa y sin afectar a nada de lo de
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
- **Archivos**: mandar archivos sueltos (fotos, PDFs, documentos — sin
  ligarlos a ninguna nota) entre el móvil y el ordenador, con dos paneles
  uno junto al otro (como un cliente de escritorio remoto): el tuyo
  (elige uno o varios con el selector de siempre — un navegador no puede
  listar el almacenamiento propio del dispositivo, así que no hay
  explorador real de ese lado) y la carpeta compartida del ordenador, con
  flechas para mandar/traer. Desde el ordenador puedes además navegar
  cualquier carpeta del disco (no solo la configurada por defecto, que
  queda como un atajo rápido). Cuando quien inicia un envío o una
  descarga es el móvil, la persona delante del ordenador tiene que
  confirmarlo antes de que se mueva nada de verdad — el ordenador
  copiando algo suyo a su propia carpeta compartida sigue siendo
  instantáneo, sin este paso. Este apartado es también donde vive ahora
  el botón para sincronizar el resto de datos manualmente (ver "Instalar
  como app" más abajo) y el de comprobar si hay una versión nueva de la
  app (instalarla de verdad sigue siendo solo desde el ordenador).

## App de escritorio (Electron)

Ademas de correr como servidor web, la app se puede empaquetar como
programa de escritorio para Windows (`npm run electron` para probarla sin
empaquetar, `npm run dist` para generar un instalador `.exe`). Es la
misma app por dentro (mismo servidor, mismo emparejamiento de moviles,
mismo mDNS) metida en una ventana nativa, con extras propios de
escritorio: comprobar actualizaciones y actualizar desde dentro de la
app (con `git pull` y reinicio automatico), y recordar si la ventana
debe abrirse en pantalla completa.

## App nativa de movil (iOS y Android)

Ademas de abrirse en el navegador del movil, la app se puede empaquetar
como app nativa de verdad con [Capacitor](https://capacitorjs.com/) — la
misma interfaz web de siempre, sin reescribir nada, metida en una
carcasa nativa con su propio icono en la pantalla de inicio.

A diferencia del navegador, la app nativa **lleva su propio codigo
dentro del movil**: abre siempre, aunque el ordenador este apagado o
haya cambiado de direccion, y funciona con la copia local de los datos
(ver el apartado siguiente). Solo necesita saber la direccion del
ordenador **para sincronizar**, y eso se le dice la primera vez en la
pantalla de vinculacion (o se cambia despues escaneando el QR).

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
- Los avisos push con la app **cerrada del todo** siguen siendo la pieza
  pendiente en la app nativa: hoy funcionan por Web Push (navegador), que
  dentro de una app empaquetada no es fiable — haria falta cambiar al
  plugin nativo con APNs/FCM.

## Instalar como app (PWA)

Tanto en el navegador del ordenador como en el del movil, la app se puede
"instalar" (Añadir a pantalla de inicio / Instalar app) para que se abra
como una app independiente, con su propio icono, en vez de una pestaña
del navegador.

Un movil ya vinculado guarda ademas su propia copia de los datos
(eventos, tareas, notas con sus carpetas...) en el propio navegador:
puedes seguir viendo, creando y editando cosas sin conexion al ordenador.
La sincronizacion entre movil y ordenador es **manual**: entra en
Extensiones → Archivos y pulsa "Sincronizar ahora" cuando quieras poner
al dia los dos lados (si hay un conflicto de verdad, gana el cambio mas
reciente) — a proposito no hay ningun disparador automatico de fondo. Un
punto de color en la barra superior indica el estado del ULTIMO intento:
verde = todo sincronizado, amarillo = hay cambios pendientes de mandar,
gris = sin conexion con el ordenador la ultima vez que se intento, rojo
= hubo un error de verdad — y clicarlo te lleva directo a Archivos. No
hay ningun servidor intermedio en internet — la sincronizacion solo pasa
por tu propia wifi local.

Si el movil cambia de wifi, o el ordenador cambia de direccion en la
misma red, un movil YA vinculado no pierde sus datos ni tiene que volver
a emparejarse: en el ordenador, Configuración → Dispositivos muestra un
codigo QR con la direccion actual; en el movil, Configuración → Este
dispositivo → "Escanear ordenador" lo lee con la camara y actualiza a
donde mandar los datos. Solo cambia adonde se conecta, nunca de donde
lee su copia local guardada — por eso no hace falta volver a vincularlo.

## Recordatorios

Cada evento o tarea con fecha puede tener un recordatorio (en el momento,
10 min, 30 min, 1 hora o 1 dia antes). Cuando toca, dispara:

- una notificacion del navegador si tienes la pestana abierta (movil u
  ordenador, si las activaste en Configuración → Este dispositivo),
- una notificacion del sistema operativo en el ordenador donde corre el
  servidor (funciona aunque no tengas el navegador abierto, mientras el
  servidor este encendido), y
- en el movil, ademas, un **aviso push de verdad** si activaste las
  notificaciones (Configuración → Este dispositivo): llega aunque tengas
  la app completamente cerrada. Hace falta rellenar un correo de
  contacto en Configuración → Perfil la primera vez (ver "Datos
  personales" mas abajo) — es un requisito tecnico del protocolo usado
  (Web Push/VAPID), nunca se muestra ni se usa para nada mas. En iPhone,
  ademas, la app tiene que estar "Añadida a pantalla de inicio" (no vale
  con Safari normal, sin instalar), por una restriccion de Apple.

## Datos personales

La primera vez que se abre la app (desde cualquier dispositivo) aparece
una pantalla de bienvenida pidiendo dos datos, los dos **opcionales**:

- **Nickname**: se ve igual en todos tus dispositivos vinculados, y
  aparece como "creado por" en los eventos y notas que añadas — solo
  sirve para diferenciar quien creo que si usas varios dispositivos.
- **Correo**: no se usa para nada dentro de la app ni se muestra en
  ningun sitio. Su unico proposito es servir de contacto tecnico
  obligatorio del protocolo Web Push (VAPID) al mandar notificaciones
  push al movil — lo exige el propio estandar, pensado para que
  Google/Apple puedan avisar al operador del servidor si hay demasiados
  fallos de entrega. Sin correo, sencillamente no se pueden activar las
  notificaciones push (el resto de la app funciona igual). Se puede
  rellenar, cambiar o dejar vacio en cualquier momento desde
  Configuración → Perfil.

Ningun dato sale de tus propios dispositivos, salvo — si activas las
notificaciones push — el aviso en si (cifrado de extremo a extremo por
el propio protocolo) y el correo de contacto de arriba, que tienen que
pasar obligatoriamente por los servidores de Google (Android/Chrome) o
Apple (iPhone/Safari): es la unica forma en que el sistema operativo del
movil puede despertar la app estando cerrada del todo, no hay manera de
evitarlo. Ni Google ni Apple pueden leer el contenido del aviso (titulo
del recordatorio incluido), solo mueven bytes cifrados. La
sincronizacion normal entre tus dispositivos (eventos, notas, tareas...)
nunca pasa por ahi: es directa, por tu propia wifi local.

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
- Widgets de pantalla de inicio o accesos en el Centro de Control
  (iPhone) no son viables como app web: harian falta frameworks nativos
  (WidgetKit/ControlKit) o un envoltorio tipo Capacitor — queda anotado
  como posible proyecto aparte, no en desarrollo.
- La app de escritorio (Electron) solo genera instalador para Windows.
- Redimensionar tablas de notas es solo con raton (arrastrar bordes) —
  no hay equivalente tactil todavia en movil.
- El modo "vim" del editor de notas es un subconjunto pequeño a
  proposito (sin registros con nombre, macros, `:` comandos, `yy`/`p`,
  repetir con numeros) — se puede ampliar mas adelante segun haga falta.
