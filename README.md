# RemindMeLater

Calendario, recordatorios, tareas y notas que corren en tu ordenador. Los
datos viven solo ahi (SQLite, en `data/remindmelater.db`, ignorado por
git — o en la carpeta de datos de la app si usas la version de escritorio).
Desde el movil puedes usar la misma app conectandote por wifi, sin
instalar nada (o instalandola como si fuera una app, ver mas abajo).

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
  etc. esta planeado pero no implementado). Una nota se puede ocultar
  (icono de ojo) y, opcionalmente, proteger con una contraseña compartida
  para todas las notas ocultas de la app (no es cifrado real, es una
  proteccion sencilla para que no se vea el contenido de un vistazo).
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
del navegador. Sigue necesitando conexion al servidor para leer o guardar
datos (los datos no se guardan en el movil), pero la pantalla de carga
inicial funciona aunque el movil se quede sin wifi un instante.

## Recordatorios

Cada evento o tarea con fecha puede tener un recordatorio (en el momento,
10 min, 30 min, 1 hora o 1 dia antes). Cuando toca, dispara:

- una notificacion del navegador si tienes la pestana abierta (movil u
  ordenador, si las activaste en Configuración → Este dispositivo), y
- una notificacion del sistema operativo en el ordenador donde corre el
  servidor (funciona aunque no tengas el navegador abierto, mientras el
  servidor este encendido).

## Lo que queda fuera, de momento

- El movil no guarda copia local de los datos: necesita la misma wifi
  que el ordenador para funcionar (salvo la pantalla de carga inicial de
  la app instalada, ver PWA arriba).
- Recordatorios "push" en el movil con la app cerrada tampoco estan
  todavia: requieren un servicio de notificaciones push real (fuera del
  alcance de un servidor casero).
- Las notas todavia son texto simple: el editor con formato (negrita,
  listas, tablas, imagenes) esta planeado pero no empezado.
- No hay forma de mover una carpeta de notas ya creada a otra carpeta
  distinta (si se puede mover una nota entre carpetas desde su propio
  editor).
- La app de escritorio (Electron) solo genera instalador para Windows.
- Las extensiones de gimnasio y finanzas de las que hablamos no estan
  incluidas aqui; se pueden anadir despues como secciones nuevas sin tocar
  el calendario.
