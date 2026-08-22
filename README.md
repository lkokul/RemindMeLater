# RemindMeLater

Calendario, recordatorios, tareas y notas local-first: los datos viven en
tus propios dispositivos, nunca en una nube de terceros. El ordenador
guarda todo en SQLite (`data/remindmelater.db`, ignorado por git — o en
la carpeta de datos de la app si usas la version de escritorio); el
movil, una vez vinculado, guarda tambien su propia copia y sincroniza los
cambios en los dos sentidos cuando coincide con el ordenador en la misma
wifi, sin depender de ningun servidor intermedio en internet (ver
"Instalar como app" mas abajo).

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
   6 digitos, valido 5 minutos, de un solo uso.
2. En el movil, abre la direccion de arriba. Como todavia no esta
   vinculado, vera una pantalla pidiendo ese codigo.
3. Escribe el codigo y un nombre para el dispositivo (ej. "iPhone de
   Koku"). A partir de ahi, ese movil queda autorizado permanentemente
   (hasta que lo revoques).

Puedes ver, renombrar (con icono/emoji) y revocar dispositivos vinculados
en cualquier momento desde esa misma pestana, en el ordenador (no
funciona desde el movil, a proposito). El propio ordenador donde corre el
servidor esta autorizado siempre, sin codigo (se reconoce por ser
`localhost`).

## Configuración

El icono ⚙ abre un panel con varias pestanas:

- **Estilo**: una biblioteca de temas de colores compartida entre todos
  tus dispositivos. Cada dispositivo elige por su cuenta cual tema
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
- **Grupos**: listas de recordatorios y tareas con color, al estilo de
  Recordatorios de iPhone. Cada grupo puede tener tambien un icono y un
  color especial para cuando una tarea de ese grupo se marca como hecha
  (si no lo pones, se calcula automaticamente atenuando el color normal).
- **Dispositivos**: emparejar, renombrar y revocar.
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
- **Notas**: texto simple (todavia sin formato — negrita, listas, tablas
  etc. esta planeado pero no implementado). Una nota se puede ocultar con
  el icono de ojo, que la deja borrosa en la lista hasta que la vuelves a
  destapar con el mismo icono.
- **Carpetas**: para organizar las notas, con nombre, icono y color
  propios. Las carpetas pueden contener otras carpetas — la navegacion es
  como un explorador de archivos (Windows/Finder): ves el contenido de la
  carpeta donde estas (subcarpetas y notas mezcladas, subcarpetas
  primero) y un boton "Volver" que sube un nivel cada vez. Crear una nota
  o carpeta nueva estando dentro de otra carpeta la coloca ahi por
  defecto. Borrar una carpeta no borra lo que hay dentro: sus notas y
  subcarpetas suben un nivel en vez de desaparecer.

Se puede abrir como un panel fijo al lado del calendario o como una
pantalla propia a pantalla completa, segun prefieras (Configuración →
Este dispositivo).

## App de escritorio (Electron)

Ademas de correr como servidor web, la app se puede empaquetar como
programa de escritorio para Windows (`npm run electron` para probarla sin
empaquetar, `npm run dist` para generar un instalador `.exe`). Es la
misma app por dentro (mismo servidor, mismo emparejamiento de moviles,
mismo mDNS) metida en una ventana nativa, con extras propios de
escritorio: comprobar actualizaciones y actualizar desde dentro de la
app (con `git pull` y reinicio automatico), y recordar si la ventana
debe abrirse en pantalla completa.

## Instalar como app (PWA)

Tanto en el navegador del ordenador como en el del movil, la app se puede
"instalar" (Añadir a pantalla de inicio / Instalar app) para que se abra
como una app independiente, con su propio icono, en vez de una pestaña
del navegador.

Un movil ya vinculado guarda ademas su propia copia de los datos
(eventos, tareas, notas con sus carpetas...) en el propio navegador:
puedes seguir viendo, creando y editando cosas sin conexion al ordenador,
y en cuanto volveis a coincidir en la misma wifi, los cambios se
sincronizan solos en los dos sentidos (si hay un conflicto de verdad,
gana el cambio mas reciente). Un punto de color en la barra superior del
movil indica el estado: verde = todo sincronizado, amarillo = hay
cambios pendientes de mandar, gris = sin conexion con el ordenador ahora
mismo, rojo = hubo un error de verdad. No hay ningun servidor intermedio
en internet — la sincronizacion solo pasa por tu propia wifi local.

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

- Las notas todavia son texto simple: el editor con formato (negrita,
  listas, tablas, imagenes) esta planeado pero no empezado.
- No hay forma de mover una carpeta de notas ya creada a otra carpeta
  distinta (si se puede mover una nota entre carpetas desde su propio
  editor).
- Widgets de pantalla de inicio o accesos en el Centro de Control
  (iPhone) no son viables como app web: harian falta frameworks nativos
  (WidgetKit/ControlKit) o un envoltorio tipo Capacitor — queda anotado
  como posible proyecto aparte, no en desarrollo.
- La app de escritorio (Electron) solo genera instalador para Windows.
- Las extensiones de gimnasio y finanzas de las que hablamos no estan
  incluidas aqui; se pueden anadir despues como secciones nuevas sin tocar
  el calendario.
