# RemindMeLater

Calendario y recordatorios que corre en tu ordenador. Los datos viven solo
ahi (SQLite, en `data/remindmelater.db`, ignorado por git). Desde el movil
puedes usar la misma app conectandote por wifi, sin instalar nada — o
instalarla como si fuera una app nativa (ver "Instalar como app" mas abajo)
para que tenga icono propio y abra en su propia ventana, sin la barra del
navegador.

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

La terminal muestra varias direcciones:

- `http://localhost:3000` — para abrir en el navegador del propio ordenador.
- `http://remindmelater.local:3000` — para abrir desde el movil, **estando
  en la misma red wifi que el ordenador**. Este nombre lo anuncia el propio
  servidor en la red (mDNS/Bonjour) para no tener que acordarte de una IP.
- `http://<tu-ip-local>:3000` — la misma idea pero por IP, como respaldo si
  el movil no llega a resolver el nombre `remindmelater.local` (pasa en
  alguna combinacion de router/movil).

Deja el servidor corriendo mientras quieras que el calendario este
disponible (tambien para que los recordatorios de escritorio funcionen).

## Instalar como app (PWA)

Tanto en el movil como en el ordenador, la app se puede "instalar" para que
tenga su propio icono y abra en su propia ventana en vez de una pestana mas
del navegador:

- **Movil (iPhone/Android)**: abre la direccion de arriba en Safari o
  Chrome y usa **Compartir → Anadir a pantalla de inicio** (iPhone) o el
  menu del navegador → **Instalar app** (Android).
- **Ordenador**: la mayoria de navegadores basados en Chromium muestran un
  icono de instalar en la barra de direcciones.

Instalada asi, sigue siendo la misma app web de siempre (los datos y el
emparejamiento no cambian) — solo cambia como se abre.

## App de escritorio (Electron)

Alternativa a `npm start` para el ordenador: una version empaquetada como
programa de Windows, con su propia ventana nativa (sin depender del
navegador ni de una terminal abierta).

```bash
npm run electron   # probar la app de escritorio
npm run dist        # genera el instalador de Windows en dist/
```

Por dentro arranca exactamente el mismo servidor de siempre, asi que
emparejar el movil funciona igual sea cual sea la forma en que tengas el
ordenador corriendo. Los datos, en este caso, se guardan en la carpeta de
datos de usuario de Windows en vez de dentro de la carpeta del proyecto,
para que sobrevivan a futuras actualizaciones del instalador.

## Vincular el movil

Por seguridad, ningun dispositivo puede leer ni escribir tus eventos hasta
que lo autorizas explicitamente desde el ordenador:

1. En el ordenador, abre la app y pulsa ⚙ **Configuración** → pestana
   **Dispositivos** → **Vincular nuevo dispositivo**. Aparece un codigo de
   6 digitos, valido 5 minutos.
2. En el movil, abre `http://remindmelater.local:3000` (o la IP, si el
   nombre no resuelve). Como todavia no esta vinculado, vera una pantalla
   pidiendo ese codigo.
3. Escribe el codigo y un nombre para el dispositivo (ej. "iPhone de
   Koku"). A partir de ahi, ese movil queda autorizado permanentemente
   (hasta que lo revoques).

Puedes ver, renombrar (emoji incluido) y revocar dispositivos vinculados
en cualquier momento desde esa misma pestana, en el ordenador (no
funciona desde el movil, a proposito).

## Configuración

El icono ⚙ abre un panel con varias pestanas:

- **Perfil**: tu nickname, el mismo en todos tus dispositivos (para que no
  haya lios de nombres si tienes varios enlazados) — aparece como "creado
  por" en las tareas que anadas.
- **Vista**: normal, pantalla completa o ventana flotante — ver mas abajo.
- **Estilo**: una biblioteca de temas de colores (fondo, tarjetas, texto,
  acento...) compartida entre todos tus dispositivos. Cada dispositivo
  elige por su cuenta cual tema mostrar — puedes tener uno oscuro en el
  ordenador y otro claro en el movil, o copiar el de otro dispositivo
  conectado con un click. Un tema puede llevar ademas una variante
  clara/oscura emparejada (se marca con ◐); en ese caso puedes elegir si
  seguir el modo claro/oscuro del propio sistema operativo o fijar uno tu
  mismo, por dispositivo. Los colores se eligen con un selector nativo o
  con paletas predefinidas (Pastel, Vivos, Claros, Oscuros). Los temas
  tambien se pueden exportar/importar como archivo `.json`, para pasarlos
  entre dispositivos que no pueden emparejarse directamente entre si (ej.
  dos moviles).
- **Grupos**: listas de recordatorios con color, al estilo de Recordatorios
  de iPhone.
- **Dispositivos**: emparejar, renombrar y revocar.
- **Este dispositivo**: ajustes que no se comparten con nadie mas, como
  activar las notificaciones del navegador.
- **Atajos**: personalizar los atajos de teclado — ver mas abajo.

## Vista: pantalla completa y ventana flotante

Desde Configuración → **Vista** puedes elegir como se muestra la app en
este dispositivo (el ajuste es local, no se comparte con otros
dispositivos):

- **Normal**: como cualquier pagina web.
- **Pantalla completa**: sin las barras del navegador.
- **Ventana flotante**: una ventana mas pequena y siempre encima, util para
  tenerla de reojo mientras trabajas en otra cosa.

Solo puede haber un modo activo a la vez — cambiar a uno deshace el
anterior. Si sales de pantalla completa con Esc o cierras la ventana
flotante a mano, el ajuste vuelve solo a "Normal".

## Atajos de teclado

Configuración → **Atajos** deja ver y cambiar las combinaciones de teclas
para las acciones mas usadas (nuevo evento, abrir Configuración, mes
anterior/siguiente...). Por defecto solo **N** (nuevo evento) tiene un
atajo asignado; el resto los defines tu si los quieres. No funcionan
mientras estas escribiendo en un campo de texto, para no robarte letras
normales.

## Que hace esta primera version

- Calendario con vista de mes (ordenador) y agenda en lista (movil) — es
  la misma app, se adapta segun el ancho de pantalla.
- Crear, editar y borrar eventos: titulo, fecha/hora, todo el dia,
  ubicacion, descripcion.
- Recordatorios por evento (en el momento, 10 min, 30 min, 1 hora o 1 dia
  antes). Se muestran en un panel de "Proximos recordatorios" y disparan:
  - una notificacion del navegador si tienes la pestana abierta (movil u
    ordenador), y
  - una notificacion del sistema operativo en el ordenador donde corre el
    servidor (funciona aunque no tengas el navegador abierto, mientras el
    servidor este encendido).
- Se puede instalar como PWA (movil y ordenador) o como app de escritorio
  empaquetada con Electron (Windows) — ver secciones de arriba.

## Lo que queda fuera, de momento

- El movil no guarda copia local de los eventos: necesita la misma wifi
  que el ordenador para funcionar. Hacer que el movil guarde sus propios
  datos y funcione sin conexion al ordenador es algo que se esta pensando,
  todavia sin arrancar.
- Recordatorios "push" en el movil con la app cerrada tampoco estan
  todavia: requieren un servicio de notificaciones push real (fuera del
  alcance de un servidor casero).
- Las extensiones de gimnasio y finanzas de las que hablamos no estan
  incluidas aqui; se pueden anadir despues como secciones nuevas sin tocar
  el calendario.
