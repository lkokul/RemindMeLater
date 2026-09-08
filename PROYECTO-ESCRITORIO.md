# RemindMeLater — proyecto de escritorio

Recopilación de todo lo hablado en la conversación del 4-5 de septiembre
de 2026, ordenado como plan de trabajo. La idea es que sirva de mapa para
ir desarrollando la app de escritorio sin tener que reconstruir el
contexto cada vez.

**Qué NO es esto**: no es documentación de usuario (`README.md`) ni las
notas de traspaso entre sesiones (`CLAUDE.md`, que explica cómo está
montado el código hoy). Esto es lo que **queda por hacer** y **por qué se
decidió cada cosa**.

Rama de trabajo: `escritorio`. La rama `main` conserva el estado
anterior (con servidor, app móvil y Capacitor) por si hace falta
recuperar algo.

---

## 1. Dónde estamos

Dos rondas grandes ya hechas y probadas:

- **v0.34.0 — fuera el servidor.** Ya no hay Express, ni puerto 3000, ni
  HTTP. La ventana habla con SQLite por IPC dentro del mismo programa.
- **v0.35.0 — fuera el móvil.** Capacitor, el pipeline de iOS y todo el
  rediseño para pantallas estrechas.

Resultado: unas 16.500 líneas menos y **una sola dependencia en
producción** (`node-notifier`). El código son tres piezas: `public/` (la
interfaz), `core/` (los datos) y `electron/` (el pegamento).

---

## 2. Decisiones ya tomadas

Se anotan para no volver a discutirlas, y sobre todo para saber **por
qué** se decidieron así.

| Decisión | Motivo |
|---|---|
| **Sin servidor** | Existía solo para que el móvil se conectara por wifi. La base de datos nunca lo necesitó: el proceso principal de Electron es Node y abre SQLite directamente. |
| **Sin app móvil** | Escritorio y móvil son proyectos independientes. Se quita todo para que un futuro merge sea limpio. |
| **Sin acceso a la app desde el navegador** | Consecuencia de lo anterior: `public/` llama a `window.electronAPI`. Se valoró mantener Express como puerta fina para poder depurar en Chrome y se descartó — las DevTools de Electron son las mismas de Chrome, así que no se pierde casi nada. |
| **El CSS sigue siendo mobile-first** | Aplanarlo a desktop-first es reescribir las 3.253 líneas del stylesheet justo antes del rediseño visual. Daría un diff enorme que haría el merge *más* difícil, no menos. Quedan 5 `@media (max-width: 859px)` con 9 reglas de adaptación legítimas. |
| **"Apps" pasa a llamarse "Herramientas"** | En toda la interfaz. Por dentro los identificadores siguen diciendo `extensions`. |
| **Las rutas se siguen llamando `/api/...`** | Aunque ya no haya red. Permitió no tocar los ~165 sitios que llaman a la API, y sigue siendo una forma cómoda de nombrar cada cosa. |

---

## 3. Retoques pendientes (pequeños, media hora en total)

Cosas concretas que ya están identificadas y solo hay que hacer.

- [ ] **`corsEnabled: true` en el protocolo `app://`**
      (`electron/protocol.js`). Hay un aviso de seguridad de Electron que
      describe exactamente la configuración actual (`supportFetchAPI` sin
      `corsEnabled`). El riesgo real en esta app es nulo porque no carga
      ninguna página ajena, pero es la configuración correcta y es una
      palabra.
- [ ] **Cabeceras anti-caché en `app://`**. Ahora mismo el protocolo no
      manda ninguna, así que Chromium puede cachear `styles.css` y un
      Ctrl+R no reflejar el cambio (hace falta Ctrl+Shift+R). Con el
      rediseño visual en puertas, esto molesta cada pocos minutos.
- [ ] **Meter la fuente Roboto Mono en `public/`**. Hoy se descarga de
      Google Fonts (`index.html`). Funciona, pero una app de escritorio
      no debería depender de internet para su tipografía.
- [ ] **Comentario obsoleto en `core/dataDir.js`**: todavía menciona
      `npm run dev` y `server/index.js`, que ya no existen.
- [ ] **`scripts/stop-server.js`**: mata procesos en los puertos
      3000/3001, que ya no usa nadie. O se borra, o se reescribe para
      matar procesos `electron.exe` colgados (que sí puede pasar).

---

## 4. El rediseño visual (lo siguiente)

Koku va a pasar "un documento detallado de todos los cambios visuales,
no serán pocos". Antes de empezar hay **una decisión que condiciona el
resto**:

### Barra de título propia

La ventana usa la barra de título gris de Windows, que rompe cualquier
tema oscuro, Neón o Cristal. Poder pintarla nosotros es probablemente el
cambio visual de mayor impacto que existe aquí.

**Por qué decidirlo primero**: afecta al layout de la parte de arriba
(hay que reubicar los botones de minimizar/maximizar/cerrar y decidir si
la topbar actual se fusiona con ella). Rediseñar la topbar y luego meter
una barra de título propia sería hacer el trabajo dos veces.

Se hace con `frame: false` o `titleBarStyle: 'hidden'` +
`titleBarOverlay` en la `BrowserWindow`, más una zona con
`-webkit-app-region: drag` para poder arrastrar la ventana.

**Todavía sin decidir.**

### Terreno preparado

El rediseño arranca con 637 líneas menos de CSS que hace dos días, sin
ramas móviles de por medio, y con el bucle de trabajo resuelto: se edita
`public/`, se pulsa Ctrl+R en la ventana y se ve. Sin builds.

---

## 5. Capacidades nativas de escritorio

Esto es el grueso del proyecto a medio plazo: lo que Electron permite y
el navegador no. **Ninguna requiere tocar la arquitectura**, ya está
todo en su sitio para hacerlas.

Ordenadas por impacto real para esta app concreta:

### Alta prioridad

- [ ] **Arrancar con Windows** (`app.setLoginItemSettings`). Hoy los
      recordatorios solo saltan si la app está abierta. Para una app de
      recordatorios esto es, con diferencia, la mejora más grande.
- [ ] **Icono en la bandeja del sistema** (`Tray`), y que la X minimice a
      la bandeja en vez de cerrar. Complementa lo anterior: la app sigue
      viva y avisando sin ocupar la barra de tareas.
- [ ] **Notificaciones nativas clicables y con botones**. Ahora
      `node-notifier` saca un aviso que aparece y ya está. Con la
      `Notification` de Electron se puede clicar para abrir el evento, y
      añadir acciones tipo "Posponer 10 min" o "Marcar como hecha".

### Media prioridad

- [ ] **Atajos globales** (`globalShortcut`): por ejemplo Ctrl+Alt+N para
      crear una nota rápida desde cualquier sitio, sin traer la app al
      frente.
- [ ] **Actualizaciones automáticas** con `electron-updater`. Hoy
      `core/routes/update.js` hace un `git pull` de verdad, lo que obliga
      a tener git y el repositorio clonado. Un instalador que se
      actualiza solo es otra liga.
- [ ] **Recordar posición y tamaño de la ventana** entre arranques (ahora
      solo se recuerda si estaba en pantalla completa).
- [ ] **Diálogos nativos de archivo** (`dialog.showOpenDialog`) donde
      haga falta elegir un archivo o una carpeta.

### Baja prioridad / ideas sueltas

- [ ] **Exportar a PDF** (`webContents.printToPDF`) — útil sobre todo
      para informes de Finanzas y para imprimir notas.
- [ ] **Arrastrar y soltar archivos con su ruta real.** En el navegador
      solo se recibe el contenido, nunca la ruta; en Electron sí.
- [ ] **Multi-ventana**: abrir una nota en su propia ventana, para tenerla
      al lado mientras trabajas en otra cosa.
- [ ] **Badge con número en la barra de tareas** (recordatorios
      pendientes) y menú contextual del icono con acciones rápidas.
- [ ] **Menú de aplicación propio** en vez del menú por defecto de
      Electron (hoy está oculto con `autoHideMenuBar`, se ve con Alt).

---

## 6. Temas aparcados a propósito

No están descartados: están esperando a que Koku los pida.

- **Comunicación entre dispositivos.** El móvil y el escritorio son
  independientes por ahora, pero se habló de retomar alguna forma de
  pasar datos entre ellos más adelante. Todo lo que existía
  (emparejamiento por código, sincronización por wifi, avisos push, la
  extensión "Archivos") sigue íntegro en `main` si sirve de punto de
  partida.
- **Selector de idioma español/inglés.** Koku lo quiere en algún
  momento; pidió expresamente dejarlo para más adelante. No empezar sin
  que lo pida.
- **Aplanar el CSS a desktop-first.** Ver la tabla de decisiones. Si
  algún día se hace, el momento natural es *durante* el rediseño visual,
  no antes.
- **Actualizar Electron 37 → 44.** Es un salto de versión mayor. Las 18
  vulnerabilidades que reporta `npm audit` están todas en dependencias de
  desarrollo (la cadena de `electron-builder`); `npm audit --omit=dev`
  da **0**. La única que se empaqueta de verdad es Electron. **No
  ejecutar `npm audit fix --force`**: intentaría ese salto y reescribir
  electron-builder de paso.

---

## 7. Limitaciones conocidas y aceptadas

Heredadas, no son fallos nuevos:

- El formato de las notas es básico (negrita, cursiva, listas, tablas,
  imágenes): sin celdas combinadas, sin redimensionar una imagen ya
  insertada, sin encabezados.
- Quitar una imagen de una nota editándola (sin borrar la nota entera)
  deja el archivo huérfano en el disco. Solo se limpia al borrar la nota.
- No se puede mover una carpeta de notas a otra carpeta (sí una nota).
- Solo se genera instalador para Windows.
- El modo "vim" del editor es un subconjunto pequeño, a propósito.

---

## 8. Cómo trabajamos

### Reglas de Koku

- **Commit y push por tu cuenta.** Hasta el 5/9/2026 la regla era no
  commitear ni pushear sin pedirlo; Koku la retiró para igualar esta
  conversación con el resto. Ahora se commitea y se pushea sin
  preguntar. **La única excepción: lanzar GitHub Actions, que sí se
  consulta antes.** (En esta rama, de hecho, `.github/` ya no existe —
  se fue con el workflow de iOS.)
- Versionado semántico con tag de git a juego. Los tags hay que crearlos
  desde el ordenador de Koku: las sesiones de control remoto dan 403.
- Cuando algo es ambiguo, **preguntar antes de construir**. Con
  peticiones grandes, agrupar las dudas en una sola ronda al principio.
- **Nunca controles nativos del navegador** para checkbox, `<select>` o
  fechas: siempre el componente propio que sigue el tema activo.
- Los comentarios del código van con más detalle de lo normal a
  propósito.

### Lecciones que costaron caras

Las dos primeras rompieron la app de verdad en esta misma conversación:

1. **Al borrar reglas CSS por selector, revisar los selectores agrupados
   por comas UNO A UNO.** Borrar `.modal, .pairing-screen` entera porque
   el selector mencionaba `pairing` se llevó por delante `.modal` — o
   sea, la posición y el fondo de **todos** los modales de la app. El
   JavaScript seguía funcionando perfectamente, pero no se veía nada y
   parecía que la app entera estaba muerta.
2. **Una prueba que comprueba "¿le han quitado la clase `hidden`?" no
   sirve.** Hay que medir que el elemento se **vea**: tamaño real en
   pantalla y `position`. Y capturar los recursos que no cargan
   (`webRequest.onCompleted` con `statusCode >= 400`), que es donde
   estaban dos 404 a la vista de todos.
3. **HTTP e IPC no son lo mismo en los detalles.** Node pasaba los
   nombres de cabecera a minúsculas por su cuenta; por IPC llegan tal
   cual. Subir una imagen respondía "Formato de imagen no soportado"
   porque `req.headers['content-type']` nunca se leía.
4. **Cuidado con lo que hay pegado alrededor de lo que borras.** Quitando
   bloques de HTML y JS se colaron por delante un modal y una función que
   no tenían nada que ver (`#app-confirm-modal`,
   `refreshNoteFavoriteBtn`).

### Cómo probar sin nadie delante

```
xvfb-run -a node_modules/.bin/electron --no-sandbox <script>
```

Un script que cree la ventana igual que `main.js` y use
`win.webContents.executeJavaScript(...)` para comprobar cosas desde
dentro de la página. Dos avisos:

- Un `alert()`/`confirm()` nativo bloquea el renderer para siempre si no
  hay nadie que conteste. Engancha `win.webContents.on('-run-dialog')`.
- Pon un watchdog con `setTimeout(...).unref()` que imprima lo que lleve
  y salga, y un límite por paso. Si no, un fallo deja el proceso colgado
  sin decir dónde.

### Bucle de trabajo

| Qué tocas | Qué hacer |
|---|---|
| `public/` (interfaz) | **Ctrl+R** en la ventana |
| `core/` (datos) | Cerrar y volver a abrir |
| `electron/` (ventana, protocolo, IPC) | Cerrar y volver a abrir |

`npm run electron` para trabajar (no compila nada). `npm run dist` solo
cuando quieras el instalador de verdad.
