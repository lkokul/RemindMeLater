# Android: lo que falta por hacer y por probar

Estado del lado Android a **10/9/2026** (v0.40.0). Sale de mirar el
proyecto de verdad, no de suponer: cada punto dice dónde está el archivo
y qué se ha comprobado.

**El resumen en una frase**: la app *debería* funcionar entera en Android
(la base de datos, las 25 rutas, el calendario, las 4 herramientas — todo
eso es JavaScript y no distingue de sistema), pero **nunca se ha
compilado ni ejecutado ni una vez**, y hay cuatro cosas nativas que en
iOS existen y en Android no están hechas.

---

## 0. Lo primero: nadie ha compilado esto todavía

`.github/workflows/android-play.yml` existe y está completo, pero **jamás
se ha ejecutado**. Eso significa que ni siquiera sabemos si compila.

Antes de nada hacen falta los preparativos de **`ANDROID-PLAY.md`** (guía
aparte, ya escrita):

1. Crear el keystore con `keytool` (una vez, y **guardarlo bien**: si se
   pierde no se puede volver a publicar la misma app en Play).
2. Los 4 secretos en GitHub: `ANDROID_KEYSTORE_BASE64`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
3. Cuenta de Google Play Console (pago único de 25 $).

La primera ejecución **es la primera prueba real**. Es muy probable que
la primera falle por algo tonto; no es señal de nada.

**Para probar sin Play**: el workflow genera un `.aab`, que es el formato
de Play y **no se puede instalar directamente en un móvil**. Para probar
en tu Android sin pasar por Play habría que añadir un paso que genere
también un `.apk` (`./gradlew assembleRelease`) — cambio de dos líneas en
el workflow. **Recomiendo hacerlo antes de la primera subida**: probar
por Play significa esperar la revisión de Google cada vez.

---

## 1. Fallos concretos que ya se ven sin compilar

### 1.1. El icono y la pantalla de arranque son los de Capacitor

`android/app/src/main/res/mipmap-*/ic_launcher.png` es **la X azul de
Capacitor**, la plantilla de fábrica. El de iOS
(`ios/App/App/Assets.xcassets/AppIcon.appiconset/`, 110 KB) sí es el
tuyo. Lo mismo con `drawable/splash.png` (4 KB, el de la plantilla).

Hay que generar los iconos de Android desde el mismo original que el de
iOS, incluyendo el **icono adaptativo** (Android recorta el icono a la
forma que elija el lanzador: círculo, cuadrado redondeado...), que son
dos capas separadas: `ic_launcher_foreground.png` y
`ic_launcher_background.xml`.

### 1.2. El botón "atrás" de Android no está manejado — cierra la app

**Este es el más gordo de usabilidad.** En Android, el gesto de deslizar
desde el borde (o el botón atrás) es *la* forma de navegar. Ahora mismo
**no hay ningún `App.addListener('backButton')` en todo el JavaScript**
(comprobado), así que ese gesto cierra la app directamente — con un
modal abierto, con el editor de notas a medias, con lo que sea.

La buena noticia: la lógica ya existe. La app tiene una **cascada de Esc**
que cierra capa a capa (`closeAllMobileOverlays()` en `app.js`, alrededor
de la línea 7597), y `@capacitor/app` **ya está instalado** (está en
`package.json` y en `capacitor.build.gradle`). CLAUDE.md dice que esa
dependencia "ya no la usa nadie" — pues aquí vuelve a tener sentido.

Lo que hay que hacer es engancharlo: atrás → una pulsación de Esc; y solo
cuando no queda ninguna capa que cerrar, dejar que Android cierre la app
(o pedir confirmación, que es lo habitual).

### 1.3. La versión que se sube a Play no es la versión de la app

El workflow pone `versionName "1.0.${{ github.run_number }}"`. O sea que
Play diría "1.0.7" mientras la app enseña "v0.40.0" en Configuración.
Debería leer la versión de `package.json`, como hace todo lo demás.

El `versionCode` sí está bien (el número de ejecución, que siempre crece,
que es lo único que Google exige).

### 1.4. Hay ajustes en la app que en Android no hacen nada

En Configuración → Notificaciones se ven, y **nada los esconde en
Android** (comprobado en `settings.js`):

- **"Vibración larga al acabar el descanso"** — la hace
  `RestAudioWatcher.swift`, que solo existe en iOS.
- **"Bajar la música al acabar el descanso"** — igual (audio ducking de
  iOS).
- **"Probar el aviso (10 s)"** — el botón solo se deshabilita si no es
  app nativa; en Android *sí* lo es, así que sale activo y no hace nada
  útil.
- La ayuda de **"Cuenta atrás en la pantalla de bloqueo"** habla de la
  isla dinámica y de Ajustes de iOS.

Hay que decidir: **esconderlos en Android** (rápido, honesto) o
**implementar el equivalente** (ver el punto 2).

### 1.5. Tres plugins nativos que en Android no existen

`app.js` y `widget-bridge.js` registran `LiveActivity`, `RestAudio` y
`WidgetBridge`. Los tres se registran mirando solo
`Capacitor.isNativePlatform()`, que en Android es **true** — así que se
crea el proxy y cada llamada responde *"not implemented on android"*.

**No rompe nada**: comprobado que las llamadas están todas en `try/catch`.
Pero deja ruido en la consola en cada vuelta a primer plano. Lo limpio
sería comprobar `getPlatform() === 'ios'` en esos tres, como ya se hace
en `ensureRemindersChannel()` para lo de Android.

### 1.6. Restos del manifiesto que conviene revisar

`android/app/src/main/AndroidManifest.xml`:

- **`android:usesCleartextTraffic="true"`** — resto de cuando había un
  servidor. La app ya no habla con nada por red. Quitarlo es más
  correcto y evita preguntas en la revisión de Play.
- **`android:allowBackup="true"`** — la copia automática de Android podría
  restaurar una base de datos vieja al reinstalar, pisando la actual.
  Con una app cuya única red de seguridad es la copia manual, conviene
  pensarlo: o se apaga, o se excluye la base de datos con
  `android:dataExtractionRules`.

### 1.7. Permisos de notificación: comprobar que llegan por la fusión

El manifiesto de la app **solo declara `INTERNET`**. Los avisos de
Android modernos necesitan:

- **`POST_NOTIFICATIONS`** (Android 13+, API 33) — sin él no sale ni un
  aviso, y hay que **pedirlo al usuario**.
- **`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`** (Android 12+) — para que
  un recordatorio suene a su hora exacta y no "cuando el sistema
  quiera".

Normalmente los declara el propio `@capacitor/local-notifications` y se
fusionan solos. **No lo he podido comprobar aquí** (no hay
`node_modules` en este contenedor), así que queda como lo PRIMERO a
verificar en cuanto haya una build: mirar el `AndroidManifest.xml`
fusionado dentro del `.aab`/`.apk`, o simplemente probar si llega un
recordatorio.

---

## 2. Lo que en iOS existe y en Android está por construir

Cuatro piezas nativas. Ninguna es un puerto: Android resuelve estas cosas
de otra forma.

### 2.1. Widget "Qué toca hoy"

Lo más reciente de iOS (v0.40.0) y **lo único de esa ronda que no vale
para Android**.

- **La parte de JavaScript SÍ sirve tal cual**: `public/widget-bridge.js`
  arma el resumen y no sabe de sistemas.
- Lo que hay que rehacer: el plugin nativo (en vez de escribir en un
  App Group, en Android se escribe en `SharedPreferences` normales — no
  hace falta ningún grupo, la app y su widget comparten proceso) y el
  widget en sí (`AppWidgetProvider` + `RemoteViews`, o **Glance**, que
  es lo moderno y se parece bastante a SwiftUI).
- **No hay equivalente a la pantalla de bloqueo ni al centro de
  control**: en Android solo existe el widget de escritorio. Se pierden
  dos de las tres ubicaciones.

### 2.2. Cuenta atrás del descanso en la pantalla de bloqueo

En iOS es una **Live Activity** (ActivityKit). En Android el equivalente
es una **notificación persistente con cronómetro**
(`setUsesChronometer(true)` + `setOngoing(true)`), normalmente con un
**servicio en primer plano** para que sobreviva. El botón "+30s" sería
una acción de la notificación.

Curiosamente **es más fácil que en iOS**: no hace falta ActivityKit ni
widget, es una notificación con estilo.

### 2.3. Bajar la música y la vibración larga

- **Bajar la música**: en Android es `AudioManager.requestAudioFocus` con
  `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`. Concepto idéntico, API distinta.
- **Vibración larga**: `VibrationEffect.createWaveform(...)`. En Android
  **no hace falta mantener la app despierta** con un audio en bucle como
  en iOS: se puede programar desde el servicio o la notificación.
- **Callarla**: el mecanismo de iOS (sondear
  `getDeliveredNotifications`, mandos del auricular) no aplica. En
  Android se cancela al descartar la notificación o desde su acción.

### 2.4. Bloqueo de orientación — **esto SÍ está hecho**

`android:screenOrientation="portrait"` en la MainActivity, con
`orientation` conservado dentro de `configChanges` para que Android no
reinicie la Activity. Está bien y solo hay que **comprobarlo en el
móvil**.

---

## 3. Qué probar en cuanto haya un `.apk` en el móvil

Ordenado de "si esto falla, no sigas" hacia abajo.

### Arranque
- [ ] La app abre y llega al calendario, sin pantalla en blanco.
- [ ] La base de datos se crea sola (SQLite en WebAssembly dentro de la
      webview — es lo más distinto de una app Android normal y lo que más
      merece confirmarse).
- [ ] Cerrar del todo y reabrir: **los datos siguen ahí** (IndexedDB
      dentro de la WebView de Android; que persista no es automático).
- [ ] El icono del lanzador y la pantalla de arranque (ver 1.1: hoy son
      los de Capacitor).

### Lo básico de la app
- [ ] Crear, editar y borrar un evento, una tarea y una nota.
- [ ] El editor de notas: negrita, listas, **una tabla** y **una imagen**
      (las imágenes van a IndexedDB, no a la base).
- [ ] Las cuatro herramientas abren: Gimnasio, Lecturas, Finanzas, Viajes.
- [ ] El **mapa de Viajes** (SVG grande con zoom y paneo propios) — es lo
      más pesado de la app.

### Navegación, que es donde Android se porta distinto
- [ ] **El botón/gesto atrás** (ver 1.2: hoy cierra la app — confirma el
      síntoma y en qué situaciones duele más).
- [ ] Los **gestos de deslizar** (carriles lateral/centro) conviven con
      el gesto de atrás del sistema, que ocupa los mismos bordes. **Es el
      choque más probable de todos.**
- [ ] La barra de abajo y las pantallas completas, con la **barra de
      navegación por gestos** de Android debajo.

### Teclado y áreas seguras — lo que más cambia entre sistemas
- [ ] Escribir en un campo dentro de una pantalla completa (buscador de
      ejercicios, notas): **que no se pueda arrastrar la pantalla hasta
      ver la barra de estado**. En iOS se arregló anclando a
      `visualViewport`; **Android redimensiona la ventana por su cuenta**
      (`adjustResize`), así que el comportamiento puede ser distinto o
      incluso duplicarse. Probar con calma.
- [ ] Los **popovers** (color, icono, desplegables, fecha) cerca del
      borde superior: se colocan con `env(safe-area-inset-*)`, pensado
      para la Dynamic Island. En Android hay agujero de cámara y barra de
      estado, y no siempre se reportan igual.
- [ ] Los **modales altos** (editar sesión del historial, editar
      ejercicio) — mismo motivo.

### Notificaciones
- [ ] Que Android **pida permiso** de notificaciones al abrir la app la
      primera vez (Android 13+).
- [ ] Crear un recordatorio a 2 minutos, **cerrar la app del todo** y
      comprobar que suena.
- [ ] Que **vibre** (para eso está el canal `recordatorios` con
      `vibration: true`, `local-notifications.js`).
- [ ] Con la **optimización de batería** activada (que Android pone por
      defecto): comprobar si el aviso llega igual o se retrasa. Es el
      problema clásico de Android y puede que haya que pedir la exclusión.
- [ ] Aviso de fin de descanso del Gimnasio.

### Gimnasio
- [ ] Un entrenamiento entero: empezar, series, descanso, terminar.
- [ ] **Salir de la app en medio del entreno y volver**: los tiempos van
      por marcas de tiempo justo para esto, pero Android mata procesos
      con más alegría que iOS.
- [ ] La **mini-barra de descanso** con el entreno oculto.
- [ ] El ciclo de días y el "Hoy te toca".

### Copia de seguridad
- [ ] **Exportar** → debe salir la hoja de compartir de Android
      (`@capacitor/share` + el `FileProvider` que ya está en el
      manifiesto).
- [ ] **Importar** ese mismo archivo y comprobar que vuelve todo,
      **incluidas las fotos de las notas**.
- [ ] Y lo importante de verdad: **exportar en el iPhone e importar en
      Android**. Es la única forma de pasar datos entre aparatos, y nunca
      se ha probado entre sistemas distintos.

### Aspecto
- [ ] Los 9 temas, en claro y en oscuro.
- [ ] Que el **modo oscuro del sistema** cambie la app sola.
- [ ] Que **no rote** a apaisado (ver 2.4).
- [ ] Los emojis y los iconos SVG (sol/luna): los SVG deberían verse
      igual, los emojis los pinta Android con su tipografía y **se verán
      distintos que en el iPhone**. Es esperado, no un fallo.

---

## 4. Por dónde empezaría yo

1. **Añadir el `.apk` al workflow** y lanzarlo. Sin eso todo lo demás es
   teoría.
2. Con la app instalada: **el recorrido de arranque** y **el botón
   atrás**. Son los dos que pueden hacer que la app sea inusable, no
   solo incómoda.
3. **Los iconos**, que es trabajo mecánico y se nota mucho.
4. **Esconder en Android los ajustes que no hacen nada** (1.4) — media
   hora, y evita que parezcan rotos.
5. Y ya entonces decidir cuánto de lo nativo (2.1–2.3) merece la pena.

**Lo que NO haría todavía**: el widget de Android. Es lo más caro de las
cuatro piezas y lo que menos duele no tener mientras la app base no esté
probada.

---

## Notas para quien retome esto

- Todo lo de este documento sale de leer el repositorio el 10/9/2026.
  **No se ha compilado ni ejecutado nada de Android** desde este
  contenedor (es Linux, sin SDK de Android).
- La guía de publicar en Play es **`ANDROID-PLAY.md`**, aparte. Este
  documento es lo que falta *antes* y *además* de aquello.
- El detalle de por qué cada cosa está hecha como está (la base en
  WebAssembly, los gestos, el teclado, el widget) vive en **`CLAUDE.md`**.
