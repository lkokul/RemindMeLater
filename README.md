# RemindMeLater

Calendario y recordatorios que corre en tu ordenador. Los datos viven solo
ahi (SQLite, en `data/remindmelater.db`, ignorado por git). Desde el movil
puedes usar la misma app conectandote por wifi, sin instalar nada.

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

La terminal muestra dos direcciones:

- `http://localhost:3000` — para abrir en el navegador del propio ordenador.
- `http://<tu-ip-local>:3000` — para abrir desde el movil, **estando en la
  misma red wifi que el ordenador**.

Deja el servidor corriendo mientras quieras que el calendario este
disponible (tambien para que los recordatorios de escritorio funcionen).

## Vincular el movil

Por seguridad, ningun dispositivo puede leer ni escribir tus eventos hasta
que lo autorizas explicitamente desde el ordenador:

1. En el ordenador, abre la app y pulsa ⚙ **Configuración** → pestaña
   **Dispositivos** → **Vincular nuevo dispositivo**. Aparece un codigo de
   6 digitos, valido 5 minutos.
2. En el movil, abre `http://<tu-ip-local>:3000`. Como todavia no esta
   vinculado, vera una pantalla pidiendo ese codigo.
3. Escribe el codigo y un nombre para el dispositivo (ej. "iPhone de
   Koku"). A partir de ahi, ese movil queda autorizado permanentemente
   (hasta que lo revoques).

Puedes ver, renombrar (emoji incluido) y revocar dispositivos vinculados
en cualquier momento desde esa misma pestana, en el ordenador (no
funciona desde el movil, a proposito).

## Configuración

El icono ⚙ abre un panel con varias pestanas:

- **Estilo**: una biblioteca de temas de colores (fondo, tarjetas, texto,
  acento...) compartida entre todos tus dispositivos. Cada dispositivo
  elige por su cuenta cual tema mostrar — puedes tener uno oscuro en el
  ordenador y otro claro en el movil, o copiar el de otro dispositivo
  conectado con un click. Los colores se eligen con un selector nativo o
  con paletas predefinidas (Pastel, Vivos, Claros, Oscuros). Los temas
  tambien se pueden exportar/importar como archivo `.json`, para pasarlos
  entre dispositivos que no pueden emparejarse directamente entre si (ej.
  dos moviles).
- **Grupos**: listas de recordatorios con color, al estilo de Recordatorios
  de iPhone.
- **Dispositivos**: emparejar, renombrar y revocar.
- **Este dispositivo**: ajustes que no se comparten con nadie mas, como
  activar las notificaciones del navegador.

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

## Lo que queda fuera, de momento

- El movil no guarda copia local de los eventos: necesita la misma wifi
  que el ordenador para funcionar. Si mas adelante quieres que el movil
  cachee los eventos cercanos y funcione sin conexion, es una extension
  aparte (implica sincronizar cambios en ambos sentidos y resolver
  conflictos).
- Recordatorios "push" en el movil con la app cerrada tampoco estan
  todavia: requieren un servicio de notificaciones push real (fuera del
  alcance de un servidor casero).
- Las extensiones de gimnasio y finanzas de las que hablamos no estan
  incluidas aqui; se pueden anadir despues como secciones nuevas sin tocar
  el calendario.
