# Traspaso: qué hay hecho, App por App

Escrito el 15/9/2026 sobre la **v0.62.2**, cuando Koku toma el
relevo para programar él.

**Qué es esto y qué no.** Esto es un MAPA: qué existe, dónde vive, qué
decidiste tú y qué queda por hacer, ordenado por App. No sustituye a
nada:

| Documento | Para qué |
|---|---|
| `README.md` | Qué hace la app, de cara al usuario. |
| **`CLAUDE.md`** | El PORQUÉ: arquitectura, decisiones y las trampas que ya mordieron. Es el más largo y el más valioso cuando algo falla. |
| `cambios/<area>.md` | Qué entró en cada ronda y **qué hay que probar en el iPhone**. |
| **Este archivo** | El índice de todo lo anterior, por App, para sentarte a programar. |

Cuando este documento y `CLAUDE.md` digan cosas distintas, **gana
`CLAUDE.md`**: aquí va el resumen, allí el detalle.

---

## 0. Lo primero: son DOS programas, y se separaron hace mucho

No comparten código desde el commit `798d2c9`. Desde ahí:

- **`escritorio`** (tuyo): 10 commits.
- **`desarrollador`** (lo de estas conversaciones): 180 commits.

O sea que **nada de lo que sigue está en la app de escritorio** salvo lo
que ya existía antes de la separación. Lo digo con la lista exacta más
abajo, en el apartado 11.

**Corrección importante, porque `CLAUDE.md` está desactualizado en este
punto**: ese archivo dice que la app de escritorio es "el servidor
Express + `node:sqlite`" en `server/`. **Ya no.** En la rama
`escritorio` hiciste dos limpiezas grandes (`a56ef34` "Fuera el
servidor: la app de escritorio pasa a Electron puro" y `10c8403` "Fuera
todo lo de movil"), y hoy esa rama **no tiene carpeta `server/`**: son
`public/` (interfaz) + `core/` (datos) + `electron/` (pegamento), con
una sola dependencia de producción. Si algún día actualizas `CLAUDE.md`,
ese párrafo es el primero que hay que tocar.

---

## 1. El motor: cómo funciona la app móvil por dentro

Hay que entender esto antes de tocar cualquier App, porque explica por
qué el código tiene la forma que tiene.

**No hay servidor. El "backend" corre dentro de la propia app.**

| Pieza | Qué es |
|---|---|
| `public/vendor/sql-wasm.*` | SQLite de verdad compilado a WebAssembly (sql.js, vendorizado). |
| `public/local-schema.js` | El esquema: tablas y migraciones. |
| `public/local-db.js` | `localDb`, con la MISMA forma que `node:sqlite`. Vuelca la base entera a IndexedDB tras cada escritura. |
| `public/local-api.js` | Un router mínimo que imita a Express. |
| `public/routes-local/*.js` | Las rutas. Copiadas del backend original y luego ampliadas. |
| `api()` en `app.js` | Despacha contra ese router en vez de hacer `fetch`. |

**Por qué sql.js y no IndexedDB a pelo**: conserva las 45+ consultas con
SQL de verdad (JOIN, GROUP BY, SUM). Y por qué sql.js y **no** un plugin
nativo de SQLite: sql.js es **síncrono**, igual que `node:sqlite`. Con
uno asíncrono habría que meter `await` en los ~396 sitios que consultan
la base, o sea reescribir todas las rutas.

**Tres cosas que te van a morder si no las sabes:**

1. **No hay build ni framework.** `app.js` y `settings.js` son
   `<script>` normales que comparten variables globales, y **`settings.js`
   va después**. Si una función que se ejecuta AL CARGAR necesita una
   variable declarada más abajo, salta por la zona muerta temporal (TDZ)
   y **se lleva por delante el resto del archivo entero**, sin decir
   nada. Ha pasado tres veces. Dentro de un handler (un clic) no pasa
   nada, para entonces ya está todo parseado.
2. **Cada archivo de `routes-local/` va en su propio IIFE**, así que no
   puede importar nada. Lo que se comparte entre rutas se expone como
   `window.loQueSea` (por ejemplo `window.duplicarNotaLocal`).
3. **Las imágenes NO van dentro del `.sqlite`.** Los bytes viven en el
   almacén `noteAssets` de IndexedDB y la base solo guarda una ruta
   `/api/notes/images/<uuid>`. Lo comparten CUATRO Apps: Notas,
   Entretenimiento, Recetas y Viajes.

**Se verificó el porte** con una comparación diferencial: las mismas 79
peticiones contra el servidor Express real y contra el motor local, 0
diferencias. Si algún día tocas el porte a lo grande, merece la pena
rehacerla.

---

## 2. Calendario

Lo más viejo de la app, pero con cuatro rondas fuertes encima.

**Dónde**: `public/routes-local/events.js`, `groups.js`, `horario.js`;
en `app.js` las cuatro vistas (rejilla del mes, del año, tira de semana,
vista diaria) y el bloque "HORARIO SEMANAL FIJO".
**Tablas**: `events`, `groups`, `special_days`, `horario_bloques`.

### Lo que se construyó

- **Las tareas son filas de `events` con `is_task = 1`**, no una tabla
  aparte. Comparten título y grupo con los eventos; lo que cambia es que
  `start_at` es opcional y tienen `done`.
- **Eventos de varios días**, que necesitó DOS mitades: el filtro de la
  ruta pasó a ser de SOLAPE (`start_at <= to AND COALESCE(end_at,
  start_at) >= from`; antes era "empieza dentro del rango", así que un
  viaje que arrancó el jueves no salía el viernes) y `eventOccursOnDay()`
  / `eventDaySpan()` pasaron a ser la única fuente de verdad de "¿sale
  este día?" para las cuatro vistas.
- **Eventos que se repiten**. Elegiste "Completo" (diaria/semanal/
  mensual/anual + "cada N" + varios días de la semana) y "Preguntar cada
  vez" al editar o borrar una.
- **Horario semanal fijo**: pantalla propia, tercer acceso rápido junto
  a Hoy y Grupos.
- **Reloj de 12 o 24 horas** siguiendo al SISTEMA, no un ajuste de la
  app.

### Decisiones tuyas, no las deshagas sin pensarlo

- **Las repeticiones NO generan filas.** El evento sigue siendo uno y lo
  que se guarda es la REGLA; las veces se calculan al pedirlas
  (`repeticionesDeEvento()` en `local-api.js`). Generar filas eran ~150
  por una clase semanal de tres años, que hay que crear, migrar si
  cambias la hora y borrar si acortas la serie.
- **El horario es tabla propia, NO eventos con regla.** Un horario no
  tiene fecha: metido en el calendario, cada semana taparía lo que de
  verdad pasa ese día.
- **El último día de un evento largo va en la fila de "todo el día"**,
  con su hora de fin en la etiqueta. Pero **se sigue guardando con su
  hora real**, no se convierte en `allDay`: lo pediste expresamente.
- El horario **no programa ningún aviso**: el cupo del teléfono es de
  los recordatorios, y algo sonando cada semana se lo comería.

### Lo que hay que vigilar

- **iOS solo guarda ~64 avisos pendientes y a partir de ahí deja de
  avisar EN SILENCIO.** El reparto del cupo está a mano en
  `local-notifications.js`: manda el calendario, los pagos de Finanzas
  ocupan lo que sobre, y una serie que se repite gasta como mucho 10. Si
  tocas esa función, no te cargues el reparto.
- Caso raro sin resolver: un evento que empieza a las 02:00 y sigue al
  día siguiente pinta 22 horas de bloque el primer día.
- Los nombres largos se parten en el horario ("Gimna/sio"). Es el límite
  real del ancho de un móvil con siete columnas; la alternativa (enseñar
  3 días y deslizar) **está sin decidir y es tuya**.

---

## 3. Notas

**Dónde**: `public/routes-local/notes.js`, `noteFolders.js`,
`noteImages.js`; en `app.js` el bloque del editor y `renderNotesView()`.
**Tablas**: `notes`, `note_folders`.

### Lo que se construyó

- **Editor con formato**, por fases: negrita/cursiva/listas → tablas →
  imágenes. `#note-body` es un `<div contenteditable>`, no un textarea.
- **Carpetas anidadas** con detección de ciclos. Borrar una carpeta
  NUNCA borra su contenido: sube un nivel.
- **Favoritos**, **búsqueda** dentro de la carpeta actual, y
  **duplicar**.
- **Fórmulas**: escribes `12+1 =`, aparece el resultado en gris, y
  **Intro lo fija**. Tocar la pantalla lo descarta.
- **El título nace con formato de título** y con mayúscula automática.

### Decisiones tuyas

- **El título NO es un campo**: se deriva de la primera línea. Eso tiene
  consecuencias en todo lo que lo toca (duplicar tiene que editar esa
  primera línea).
- **En el móvil NO hay contraseña para las notas ocultas**: ocultar solo
  difumina. La contraseña compartida se fue con el servidor. **Queda
  pendiente que decidas** si la pantalla lo dice con todas las letras o
  se hace de verdad con Face ID (`PARA-KOKU-MAÑANA.md`, punto C2).
- Las fórmulas son **cálculos sueltos, sin referencias a celdas**;
  descartaste la opción de hoja de cálculo.

### Trampas que ya mordieron, las dos importantes

1. **"¿Está vacío el editor?" no es "¿tiene texto?"**. Una nota con SOLO
   una imagen o SOLO una tabla no tiene texto, y se guardaba como vacía
   —perdiendo la imagen—. Va con
   `querySelector('img, table')`. **Si añades otro contenido sin texto,
   acuérdate de meterlo ahí.**
2. **Mientras el usuario escribe, el salto de línea lo tiene que dar el
   NAVEGADOR.** `autocapitalize` no lo decide el HTML, lo decide el
   teclado del sistema, y solo rehace su cuenta cuando el navegador mueve
   el cursor por una edición suya. Un `preventDefault()` + DOM a mano le
   deja el estado "a media frase" y la mayúscula no sale. Si hay que
   cambiar el formato, se cambia DESPUÉS y con `execCommand`.

   **Esto está GENERALIZADO desde la v0.62.2**, que es de la ronda en la
   que dijiste que pasaba "en general, en cualquier salto de formato a
   otro". El mecanismo es uno solo y en tres pasos: `keydown`/
   `beforeinput` MIRA si toca salir de un formato y deja apuntada una
   función de arreglo **sin hacer `preventDefault`**; el navegador da SU
   salto (y de paso avisa al teclado); y el `input` de después arregla el
   formato del bloque nuevo. **Añadir una salida nueva es una rama más en
   `marcarSalidaDeFormato()`.** Hoy son dos: el título y la cita.

### Seguridad, que aquí es lo más delicado de la app

- **El HTML se sanea DOS veces: al guardar y al PINTAR.** El modelo de
  "sanear al escribir y confiar al pintar" tiene un agujero real:
  importar una copia de seguridad sustituye el `.sqlite` entero, así que
  sus filas nunca pasan por la ruta que sanea. **Está probado que así se
  ejecutaba código.**
- La lista blanca es de etiquetas, todas SIN atributos excepto `img`
  (solo `src` apuntando a `/api/notes/images/...`) y `<span>` con `class`
  **solo si vale exactamente `note-formula`** — una comparación con una
  cadena, no un patrón. Ningún dato tuyo entra en ningún atributo.

---

## 4. Gimnasio

Es la App más grande con diferencia.

**Dónde**: `routes-local/gymBlocks.js`, `gymRoutines.js`,
`gymExercises.js`, `gymSessions.js`; en `app.js`, media docena de
bloques.
**Tablas**: `gym_blocks`, `gym_block_cycle_days`, `gym_routines`,
`gym_routine_exercises`, `gym_exercises`, `gym_sessions`, `gym_sets`.

### Lo que se construyó, por tandas

1. **Bloques → Días** y una **librería de ~870 ejercicios**
   (free-exercise-db, dominio público; nombres y músculos traducidos,
   **las instrucciones siguen en inglés**).
2. **Modo entrenar en vivo**: estado en `localStorage`, tiempos SIEMPRE
   desde marcas de reloj (iOS congela el JavaScript de fondo), columna
   "Anterior", descanso automático.
3. **Actividad rápida**, historial, `GET /summary`.
4. **Progreso**: heatmap de 26 semanas, racha, PRs con 1RM de Epley,
   volumen semanal, **mapa de músculos** con dos siluetas SVG propias.
5. **Logros**, calculados al vuelo, sin guardar nada.
6. **Series alargadas**: dropsets, rest-pause y parciales.
7. **Series al fallo**, con su peso extra ajustable en el volumen.
8. **Ciclo de días de un bloque**.
9. **Ejercicios por tiempo** (isométricos y "reps en X tiempo"),
   **cronómetro suelto**, y **salir a correr en series**.
10. **El inicio se navega como Finanzas**: filas, no pestañas.

### Las decisiones que más te costaría reconstruir

- **Un tramo de dropset es una FILA PROPIA de `gym_sets`** colgada de su
  madre por `parent_set_id`. Así el volumen sale con el `SUM` de siempre,
  y **contar series es `parent_set_id IS NULL`**. Hacia el cliente viajan
  anidados en `set.segments`, para que `sets.length` siga siendo el
  número de series de verdad.
- **Una serie alargada cuenta como UNA serie**, no como tres: si contara
  los tramos, la racha y el objetivo semanal dirían que entrenaste el
  triple. Pero **cualquier tramo puede ser récord**, porque a veces la
  segunda sale mejor que la primera.
- **El volumen de una serie al fallo se pondera, y eso va contra mi
  recomendación** — te avisé de que "se inventa peso que no levantaste" y
  lo elegiste igual. Tres salvaguardas: **lo guardado son siempre los kg
  reales** (el factor se aplica solo al pintar), **es ajustable** (×1 lo
  desactiva del todo) y se aplica a la serie entera con sus tramos.
- **El ciclo avanza por ENTRENOS HECHOS, no por calendario.** Si te
  saltas el martes, el miércoles te sigue tocando lo mismo. La excepción
  es un descanso, que se consume al pasar el día.
- **Cada serie guarda su propia `measure`**, así que cambiar un ejercicio
  de reps a tiempo NO reescribe hacia atrás lo que ya habías apuntado.
  Es la lección de la marca `assisted`, que hacía justo eso y por eso se
  fue.
- **Los intervalos NO tienen motor nuevo**: un intervalo es una serie por
  tiempo con su descanso detrás, que es lo que ya sabía hacer el entreno
  en vivo. Ni una columna nueva.
- **En un bloque de intervalos la vibración NO es opcional**: el ajuste
  manda en todo lo demás, pero aquí sin ella el modo no sirve.

### Lo que falta

- Los récords por tiempo no se pintan (la ruta ya devuelve `maxSeconds`).
- El cronómetro de una serie por tiempo **no avisa** al llegar al
  objetivo: sonar se pisaría con el aviso de fin de descanso, y eso es
  una decisión aparte porque toca notificaciones.
- `set_count` de `/summary` **sigue contando cada lado de un unilateral
  como una serie**. Cambiarlo reescribiría hacia atrás la racha, el
  heatmap y el objetivo semanal.
- Las tandas de DeepL para traducir las instrucciones.
- `hombro_posterior` nace **sin ejercicios asignados**: la librería
  original no distinguía el deltoides posterior.

---

## 5. Finanzas

> **Esta App la estás desarrollando tú ahora mismo.** Lo de abajo es lo
> último que llegó a `desarrollador`; en `finanzas-movil` puede haber más.

**Dónde**: diez archivos en `routes-local/finanzas*.js`;
`public/finanzas-recurring.js`. Ideario completo en `IDEAS-FINANZAS.md`.

### Lo que se construyó

- **Inicio de filas** con las siete secciones, y **se pintan siempre las
  siete aunque estén vacías**.
- **Previsión de gastos fijos** que **no guarda nada**: calcula las
  ocurrencias al pedirlas. Tres estados, no dos: pagado / pendiente /
  **sin registrar**.
- **Suscripciones** normalizadas a coste mensual y anual, con su
  evolución por años.
- **Avisos de pago** con hasta 5 días de antelación por gasto.
- **Dinero de terceros**: fuera de ahorro, límite y gráficas.
- **Objetivos de ahorro**: sobres virtuales, el dinero no se mueve.
- El dinero se escribe en español ("10.851,88 €"), y los porcentajes
  igual.

### Reglas de la casa que conviene respetar

- **El saldo de una cuenta SIEMPRE se calcula, nunca se guarda.**
- **Borrar una categoría o una cartera no destruye lo que la usaba**:
  queda sin categoría, o reparentado. Borrar una cuenta CON historial se
  rechaza.
- **Nada de `confirm()` / `alert()` del navegador**: bloquean la webview
  en el móvil.
- **Regla que salió de aquí y conviene generalizar**: un apartado vacío
  tiene que poder abrirse. Es la única forma de empezar a usarlo.
- Comparando años, si el número de pagos no coincide se compara el coste
  **por pago** — si no, un año a medias parece más barato cuando en
  realidad ha subido.

---

## 6. Entretenimiento (antes Lecturas)

**Dónde**: `routes-local/entretenimientoSagas.js`, `entretenimientoItems.js`,
`entretenimientoSesiones.js`. Ideario en `ENTRETENIMIENTO.md`.
**Tablas**: `entretenimiento_sagas`, `entretenimiento_items`,
`entretenimiento_sesiones`.

### Lo que se construyó

- **Renombrado completo** desde `lecturas_*`, con migración idempotente.
- **Vitrina de portadas**: la tabla de 7 columnas se fue. La portada se
  genera si no pones imagen, y la de verdad la pones tú.
- **Cinco pestañas**: Siguiendo · Colecciones · Deseos · Historial ·
  Actividad.
- **Sesiones que se apuntan solas** al subir el progreso, y de ahí salen
  la racha, el mapa de 26 semanas y el resumen del año.
- **Vueltas** para relecturas.

### **EL ID INTERNO SIGUE SIENDO `lecturas`**

Esto es lo primero que hay que saber al tocar esta App. El nombre visible
cambió; el id NO. Sigue siendo `lecturas` en `APPS_DE_LA_TIENDA`, en
`MOBILE_NAV_SLOT_APPS`, en `MOBILE_NAV_SLOT_CARD_IDS`, en el reparto de
la copia de seguridad y en la sección del resumen que lee Swift.
Renombrarlo obligaría a tocar también el Swift.

**Ya mordió una vez**: la rama traía esas dos claves como
`entretenimiento`, y con eso la App no salía en el selector del acceso
rápido y su tarjeta no se escondía de Herramientas. **No lo pilló leer el
diff, lo pilló la prueba.**

### Decisiones tuyas

- **Las sesiones se apuntan solas, sin gesto nuevo.** Solo cuenta SUBIR;
  crear un item no apunta nada.
- **Nada de buscar la carátula por internet**: la app no hace ni una
  petición de red, y buscarla le contaría a un tercero qué estás viendo.
- **La pestaña elegida no se recuerda** entre aperturas.
- **No hay cronómetro** y **no hay logros** (se ofrecieron y no los
  marcaste).

---

## 7. Viajes

**Dónde**: `routes-local/viajesTrips.js`, `viajesEntries.js`.
**Tablas**: `viajes_trips`, `viajes_trip_countries`, `viajes_entries`,
`viajes_entry_attachments`, `viajes_entry_movements`.
Ideario en `IDEAS-VIAJES.md`.

Es la App que menos se ha tocado en estas rondas: llegó ya hecha y las
últimas tandas no traían nada suyo.

**Lo que conviene saber al retomarla:**

- **Mapa SVG por países** (`SVG-World-Map`, MIT) con zoom y paneo
  propios. Los ids del SVG vienen en MAYÚSCULAS y se normalizan a
  minúsculas en `dataset.countryCode`; **el atributo `id` no se toca**.
- **El mapa se distingue por VELOCIDAD**, como pediste: arrastrar despacio
  mueve el mapa, un gesto rápido navega.
- Un movimiento de una entrada puede enlazarse a una transacción real de
  Finanzas.
- **Los adjuntos van al mismo almacén que las imágenes de las notas.**
- **Deslizar para salir de la App no está puesto aquí a propósito**: el
  inicio de Viajes ya es una lista de contenido, no un menú de secciones.

---

## 8. Retos

App nueva (14/9/2026). **Dónde**: `routes-local/retos.js`, el bloque
"RETOS" de `app.js`. **Tablas**: `retos`, `retos_hechos`.

Un árbol donde cada fila es una tarea que solo se marca. Dos tipos:
**hábito** (se marca cada periodo y se desmarca solo al empezar el
siguiente, con racha) y **meta** (se llega una vez).

### La parte con truco

Una META guarda el hecho en su columna `done`. Un HÁBITO **no**: sus
marcas viven en `retos_hechos`, una fila por PERIODO cumplido
(`period_key`: `2026-09-14` diario, `2026-W38` semanal, `2026-09`
mensual, `c12` para "cada X días"). De ahí salen las dos cosas que no se
pueden guardar sin que se queden viejas: si está hecho AHORA, y la racha.
Guardarlo también en `done` habría dejado dos verdades que separarse.

### Decisiones tuyas

- **NO MIDE NADA** — ni repeticiones, ni kilos, ni tiempo. Si hiciera
  falta medir, eso es el Gimnasio.
- **Los subretos rellenan la barra del padre pero no lo marcan**: puedes
  cumplir "10 flexiones" y seguir sin poder hacer 50.
- **Marcar el padre marca a los hijos; desmarcar no toca a nadie**, para
  que deshacer un toque mal dado no borre lo que sí habías hecho.
- **"Mover" reordena entre hermanos, no cambia de padre.** Hoy **no hay
  forma de reparentar** un reto ya creado: es la consecuencia de esa
  elección, no un olvido. La ruta `PUT /:id` ya acepta `parentId` con
  detección de ciclos — solo falta la pantalla.

---

## 9. Recetas

App nueva (14/9/2026). **Dónde**: `routes-local/recetas.js`,
`recetasIngredientes.js`, `recetasCarpetas.js`, `recetasCompra.js`.
**Siete tablas** `recetas_*`.

### Lo que se construyó

Platos con foto, tiempos y raciones, en carpetas anidadas y con
etiquetas. Ingredientes como **ficha propia**. Lista de la compra que se
deriva de las recetas. Compras anteriores archivadas. Escalado de
raciones al vuelo. Y calorías y macros opcionales por ingrediente.

### Decisiones tuyas

- **Un ingrediente es una FICHA, no texto.** Es LA decisión que no se
  puede cambiar barata después: sin ficha propia no hay a qué colgarle un
  precio, ni de qué sacar una evolución, ni forma de sumar "300 g + 200 g
  de pollo" en una línea.
- **Una línea es (INGREDIENTE, UNIDAD).** 200 g de pollo y 2 ud de pollo
  son dos líneas. Es feo y es correcto: sumarlas pide inventarse una
  equivalencia.
- **La receta guarda sus raciones BASE y nunca se guarda escalada.**
- **Vacío NO es cero** en los macros: un campo sin rellenar se guarda
  como NULL y ese ingrediente no aporta ese valor. Un 0 contaría como
  dato bueno y hundiría el total del plato sin que se notara.
- **Todo lo de nutrición es opcional** y nace plegado.

### Un efecto que conviene conocer

La compra **se DERIVA** de las recetas que le metes, así que **una línea
que borres a mano VUELVE** si después tocas las recetas. Es la
consecuencia de que se derive en vez de ser una copia suelta — y es lo
que hace que meter una receta SUME en vez de duplicar líneas. Por eso
cada línea lleva la cantidad partida en dos columnas
(`cantidad_recetas` la calcula la ruta, `cantidad_manual` es lo tuyo) y
se enseña la suma.

### Lo que dejaste para después

- **Precios y Finanzas**: el precio de cada ingrediente, su evolución,
  cuánto va a costar la compra y el precio medio de un plato. El catálogo
  está hecho justo para esto; falta la tabla de precios y las pantallas.
  Las calorías ya siguen ese mismo camino, así que **el precio es otra
  columna más en la misma ficha**.
- **Tareas**: "quiero hacer esta receta" → la compra como lista de tareas
  que se tachan desde el calendario.

---

## 10. La app en sí (lo que no es de ninguna App)

### La Tienda

Configuración → Tienda: las ocho Apps con su ficha, encender/apagar,
manual y notas de versión por App.

- **Apagar NO borra nada.** Apagar Viajes esconde Viajes; tus viajes
  siguen en la base y vuelven enteros al encenderla.
- Apagada significa cuatro cosas: fuera de Herramientas, fuera del
  selector del acceso rápido, sin widget, y desmarcada en la copia.
- **Todas se pueden apagar menos el Calendario.**
- El registro es `APPS_DE_LA_TIENDA` en `app.js`, y los ids son los
  MISMOS que `MOBILE_NAV_SLOT_APPS` a propósito.
- Solo está escrito **el manual del Gimnasio**, para validar el tono
  antes de escribir los otros siete.

### La copia de seguridad

`public/backup.js`. Exporta un `.json` con la base en base64, todas las
imágenes y el localStorage entero, y lo manda por la hoja de compartir
del sistema.

Dos cosas que son lo más delicado de todo el archivo:

1. **Una copia PARCIAL no sustituye la base.** Si lo hiciera, dejar
   Gimnasio fuera de una copia no sería "no guardarlo", sería
   **perderlo la próxima vez que restaures**. Por eso
   `importarSoloEstasApps()` vacía y rellena tabla por tabla SOLO lo que
   la copia trae, y copia solo las columnas COMUNES a las dos bases (la
   de la copia puede ser de hace tres versiones).
2. **Las imágenes NO son solo de Notas** (arreglado el 14/9/2026, y era
   pérdida de datos de verdad): el almacén lo comparten cuatro Apps, así
   que exportar sin marcar Notas dejaba las portadas y las fotos fuera, y
   **restaurar una copia parcial VACIABA las fotos de las otras tres
   Apps**. Ahora entran si entra cualquiera de las cuatro
   (`BACKUP_APPS_CON_ARCHIVOS`) y **una restauración parcial solo SUMA
   imágenes, nunca borra**. La completa sigue haciendo borrón y cuenta
   nueva.

**Si aparece una App nueva que suba imágenes, va a esa lista.** Y sus
tablas van a `BACKUP_TABLAS_POR_APP` — sin eso, una copia de esa App no
guarda NI restaura nada. Lo que NO sale en esa tabla (temas, ajustes,
perfil) viaja SIEMPRE, y es a propósito que se decida por omisión: si
mañana aparece una tabla nueva y nadie toca el archivo, acaba DENTRO de
la copia. Lo contrario sería perder datos en silencio.

### Los widgets de iOS (seis)

Gimnasio, Tareas, Finanzas, Entretenimiento, Viajes y Calendario del
mes, más cuatro del Gimnasio de la segunda tanda.

**Lo que hay que entender**: un widget **no puede leer la base de datos**
(es SQLite dentro de la webview; el widget es código nativo que corre con
la app cerrada). La única vía es un **App Group**: la app deja un resumen
en JSON y el widget lo lee.

- **Un solo resumen para todos** (clave `resumenApp`), no uno por widget.
- **El destino viaja como TEXTO y Swift no lo interpreta**, así que
  **añadir un widget nuevo se hace entero desde JavaScript**.
- **El App Group costó quince builds.** Está resuelto desde la #55 y no
  hay que repetirlo, pero si algún día aparece un target nuevo, empieza
  otra vez sin capacidad. El detalle está en `CLAUDE.md`, en el bloque
  "RESUELTO EN LA BUILD #55" — merece la pena leerlo entero antes de
  tocar nada de firma.
- **`tools/comprobar-widgets.py` es lo más barato que hay**: aquí no hay
  Xcode, y ese guion compara las constantes entre JavaScript y Swift,
  valida el `pbxproj`, y vigila la CSP, los tokens de tipografía, los
  `:hover` y los manifiestos de privacidad. **Lánzalo antes de pedir una
  build.**

### Temas, gestos y tipografía

- **Cada fondo lleva su color de contraste emparejado** (`bg`/`bgText`,
  `surface`/`surfaceText`…) en vez de un "texto principal" global, así
  cada superficie garantiza su propia legibilidad. Hay red de seguridad
  con la fórmula WCAG real. **No des un color por bueno porque lo
  parezca: mídelo.**
- **Nueve temas sembrados**, todos con pareja clara/oscura.
- **Los gestos reparten la pantalla en carriles**: los laterales cambian
  de pestaña, el centro hace lo propio de esa pantalla. Si el centro no
  tiene nada que hacer, **cae al lateral**, para que nunca haya un
  deslizamiento muerto.
- **Ocho tokens de tipografía**, la escala de iOS. **No metas un
  `font-size` en rem**: el guion falla.
- **Toda regla `:hover` va dentro de `@media (hover: hover)`**: iOS
  aplica el `:hover` al TOCAR y lo deja puesto.
- **Nunca controles nativos** para checkbox, `<select>` o fecha. Ya no
  queda ni un `<select>` nativo en toda la app, y mantenerlo así es una
  regla, no una preferencia.

### Seguridad y privacidad

- **La app no hace NI UNA petición de red.** Nada de CDN: lo que hace
  falta se vendoriza dentro de `public/`.
- **Hay una CSP** en `index.html`. Dos cosas rompen si te despistas:
  `script-src` lleva `'wasm-unsafe-eval'` porque **sql.js es WebAssembly
  y sin eso la app no arranca**, y **no puede haber ningún `<script>` en
  línea ni ningún `on*=`** (por eso el arranque vive en `arranque.js`).
- El detalle está en `SEGURIDAD-Y-PRIVACIDAD.md`.

---

## 11. El programa de escritorio

**Aquí no he tocado nada, y es a propósito**: la regla de `CLAUDE.md` es
que `escritorio` es tuya y no se commitea ahí sin que lo pidas. La única
vez que se cruzó fue un error mío que corregiste tú (un ideario que se
subió ahí por equivocación, commits `aaf99bf` → `dd79c97`).

### Cómo está hoy, que no es como lo cuenta `CLAUDE.md`

Tres piezas, y **ninguna es un servidor**:

| Carpeta | Qué es |
|---|---|
| `public/` | La interfaz (`app.js`, `settings.js`, `styles.css`). |
| `core/` | Los datos: `db.js`, `router.js`, `api.js`, `dataDir.js`, `routes/`, y los dos vigilantes (`reminderChecker.js`, `finanzasRecurringChecker.js`). |
| `electron/` | El pegamento: `main.js`, `ipc.js`, `preload.js`, `protocol.js`. |

La ventana habla con SQLite **por IPC dentro del mismo programa**: sin
Express, sin puerto 3000, sin HTTP. Una sola dependencia de producción
(`node-notifier`). Tu propio `PROYECTO-ESCRITORIO.md` lo cuenta con el
plan de trabajo, y esa rama tiene además su propio `CLAUDE.md`.

### Lo que COMPARTÍS de antes de la separación

En el ancestro común (`798d2c9`) ya existían estas tablas, así que todo
lo que cuelga de ellas está en los dos programas:

`events` · `groups` · `special_days` · `notes` · `note_folders` ·
`themes` · `user_profile` · `app_settings` · `devices` · `sync_log` ·
los cinco `gym_*` de entonces · `lecturas_sagas` / `lecturas_items` ·
los `viajes_*` · y los `finanzas_*` de entonces.

### Lo que es SOLO del móvil, y no existe en escritorio

Esto es lo que tendrías que portar si algún día lo quieres allí:

- **Gimnasio**: `gym_blocks` y `gym_block_cycle_days` (bloques y ciclo
  de días), y con ellos el modo entrenar en vivo, la librería de ~870
  ejercicios, el mapa de músculos, los logros, las series alargadas, las
  series al fallo, los ejercicios por tiempo y los intervalos.
- **Finanzas**: `finanzas_goals` y `finanzas_goal_contributions`
  (objetivos de ahorro), la previsión de gastos fijos, las suscripciones
  y el dinero de terceros.
- **Calendario**: `horario_bloques` (el horario semanal) y los eventos
  que se repiten.
- **Entretenimiento**: el renombrado entero y `entretenimiento_sesiones`.
- **Recetas** (siete tablas) y **Retos** (dos): las dos Apps enteras.
- Y todo lo transversal: la Tienda, la copia de seguridad por Apps, los
  widgets, las notas de versión, los gestos y el pase de estilo de iOS.

### Lo que solo vive en escritorio

Lo que se quitó del móvil al desaparecer el servidor, y que allí sigue:
sincronización entre dispositivos, emparejamiento con código de 6
dígitos, Web Push, la contraseña de las notas ocultas y la extensión
**Archivos** (que en el móvil no tenía sentido: leía carpetas de un
ordenador que ya no está).

### Cuando toque fusionar

`CLAUDE.md` ya lo dice y sigue valiendo: son dos programas que hoy
comparten el nombre de `public/` pero no su contenido. **Habrá
conflictos en todo ese directorio.** Dijiste que preguntarías qué falta
en cada lado y se resolvería entonces; no se ha adelantado nada.

---

## 12. Cómo trabajar con esto

### Las ramas

| Rama | Para qué |
|---|---|
| **`desarrollador`** | Donde se trabaja y **desde donde se lanzan las builds**. Lleva los avisos de diagnóstico dentro. |
| **`movil-ui`** | La rama "de verdad", **sin** los avisos de diagnóstico. |
| `calendario-notas-movil-UI`, `gimnasio-movil`, `finanzas-movil`, `viajes-movil`, `entretenimiento-movil`, `retos-movil-ui`, `recetas-movil-ui` | Una por área. |
| `escritorio` | Tuya. |

**El precio de tener dos ramas**: cada ronda son DOS pasos. Al pasar de
`desarrollador` a `movil-ui` hay que **volver a quitar** ocho piezas de
diagnóstico; un merge a secas se las lleva de vuelta. La lista está en
`CLAUDE.md` ("Qué se queda fuera de `movil-ui`") y hay una prueba que lo
vigila.

**Y la trampa gorda, que va a volver a pasar**: una rama que sale de
`movil-ui` lleva en su historia los commits que QUITARON los avisos. Al
fusionarla hacia `desarrollador`, para git eso son cambios suyos, así que
**ganan solos y se llevan los avisos por delante sin dar ni un
conflicto**. Lo único que da la cara es `desarrollador.js`. Lo peor es
que **el `<script src="desarrollador.js">` de `index.html` desaparece**:
el archivo sobrevive al conflicto, la línea que lo carga no, y mirando el
diff no se nota.

### Las builds

- **NUNCA se lanza una build sin que lo pidas en ESA ronda.** Tu cuota es
  limitada.
- Salen de `desarrollador`, manualmente desde Actions.
- **Cada vuelta al runner son ~15 minutos y una compilación gastada**, y
  aquí no hay Xcode: `python3 tools/comprobar-widgets.py` antes de pedir
  una build es lo más barato que existe.
- **Android está SIN PROBAR**: el workflow existe pero nunca se ha
  ejecutado. `ANDROID-PENDIENTE.md` tiene la auditoría; lo más gordo es
  que el icono y el splash son los de Capacitor por defecto y que el
  botón ATRÁS cierra la app en vez de retroceder.

### Los tags

Los tienes que crear tú desde tu ordenador: desde una sesión de control
remoto el push de un tag da 403 (probado, no es una suposición). Están
pendientes **`v0.61.0`** (`2f7ea6d`) y **`v0.62.0`** (`ae95a39`), y ahora
también la v0.62.1.

```
git fetch origin desarrollador
git tag v0.61.0 2f7ea6d
git tag v0.62.0 ae95a39
git push origin v0.61.0 v0.62.0
```

### Al subir la versión, tres sitios

`package.json`, `APP_VERSION` en `app.js` y una entrada en
`notas-version.js`. **No hay paso de compilación que los genere**, se
escriben a mano. El número de build sí lo inyecta el workflow
(`build-info.js`).

### Las pruebas

Todo se prueba con Playwright contra la app servida como estático puro
(`npx http-server public -p 8899`), sin ningún backend. Tres lecciones
que costaron caras:

1. **Los asserts no leen ortografía.** Cuatro subtítulos salieron sin
   tildes y 40 comprobaciones pasaron en verde. Se vio mirando la
   captura. **Mira la pantalla, no solo los asserts.**
2. **Una prueba tiene que ponerse ROJA, no explotar.** Si el guion se cae
   antes de imprimir el fallo, contar con `grep -c FALLO` da cero.
3. **Comprueba que un diálogo se VE** (`elementFromPoint`), no solo que
   perdió la clase `hidden`.

---

## 13. Lo que está esperando una decisión TUYA

No se ha empezado nada de esto a propósito:

- **`PARA-KOKU-MAÑANA.md`**: ocho dudas de diseño y el papeleo de las dos
  tiendas. Entre ellas, dos que importan: **B1**, el acento por defecto
  no llega a 4,5:1 de contraste; y **C1**, la copia de seguridad va **sin
  cifrar**.
- **`IDEAS-AYUDAS.md`**: la lista de botones "?" candidatos, esperando a
  que marques cuáles quieres.
- **Los manuales** de las otras siete Apps.
- **Notas ocultas**: decir con todas las letras que no protegen, o
  hacerlo de verdad con Face ID.
- **HealthKit** en el Gimnasio: pide un permiso nuevo del sistema, una
  capacidad nueva en el App ID y declararlo en la ficha de la App Store.
  Dijiste "tiempos y distancia a mano y au", así que se hizo a mano.
- **Las sub-pestañas de Entretenimiento no están en `MOBILE_SUBTAB_BARS`**,
  así que el gesto central no las recorre. No se añadió sin preguntarte
  porque es cambiarte un gesto que diseñaste tú.
- **Idiomas** (español/inglés) y **Compartir → RemindMeLater**, los dos
  aplazados por ti. El segundo tiene el código intacto en
  `calendario-notas-movil-UI`, commit `73cbdbc`: recuperarlo es un
  cherry-pick, no reescribirlo.

---

## 14. Si solo te llevas cinco cosas

1. **Cuidado con el orden en `app.js` / `settings.js`.** Una excepción al
   cargar se lleva el archivo entero por delante y la app se queda a
   medias **sin decir nada**. Ha pasado tres veces.
2. **`TABLA[nombre]` con `constructor` o `toString` NO da `undefined`**,
   da la función heredada de `Object`, que es truthy. Usa
   `hasOwnProperty` o `Object.create(null)`. Ha mordido dos veces.
3. **Las fechas son LOCALES, nunca `toISOString()`.** A las 00:30 en
   España el UTC todavía es el día anterior, y eso rompe rachas, ciclos y
   widgets.
4. **Los tiempos se calculan siempre desde marcas de reloj**, nunca con
   un contador que se va sumando: iOS congela el JavaScript de fondo.
5. **Mira la pantalla.** Las cosas que más han costado —textos cortados,
   letras blancas sobre blanco, una fila que se sale del móvil— las vio
   una captura, no un assert.

Suerte. Está todo escrito para que no tengas que preguntar.
