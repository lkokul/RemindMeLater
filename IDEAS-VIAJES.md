# Viajes — ideario y plan de las ramas `viajes-escritorio` / `viajes-movil`

Documento de arranque de la ronda, hermano de `IDEAS-FINANZAS.md` y de
`IDEAS-MOVIL-UI.md`. Está escrito después de revisar el repo entero (las
ramas vivas, no solo `viajes`), así que la primera mitad es diagnóstico
comprobado y la segunda, propuesta.

---

## 1. El mapa de ramas (leer esto primero)

Lo primero que hay que entender, porque cambia el plan entero: **`viajes`
no es una rama paralela, es el antepasado común de las dos líneas
vivas**.

```
main (la app vieja cliente-servidor)
 └── …
      └── viajes  ← 8a646e1, 1 sep 2026. Aquí se terminó la herramienta Viajes.
           │       Todavía es la app web con servidor Express (server/, PWA, sw.js).
           │
           ├── escritorio          → core/ + electron/, sin servidor
           │    ├── proyectos
           │    └── finanzas-escritorio
           │
           └── movil-ui            → Capacitor + sql.js, sin core/ ni electron/
                ├── gimnasio-movil
                ├── finanzas-movil
                └── viajes-movil   ← esta rama
```

Comprobado con git, no supuesto:

- `viajes` está **contenida entera** en `escritorio` **y** en `movil-ui`
  (`git rev-list --count origin/viajes ^origin/movil-ui` = 0). O sea: la
  herramienta Viajes **ya viaja dentro de la app móvil**. No hay nada que
  portar.
- Después de `viajes`, **nadie ha vuelto a tocar Viajes** en ninguna de
  las dos líneas. Buscando "viaje" en los commits posteriores solo salen
  el merge y un retoque general. La sección está igual en las dos ramas.

### Ramas creadas en esta ronda

- **`viajes-escritorio`** — marcador en `8a646e1` (la punta de `viajes`),
  como foto fija de "lo que hay hoy de Viajes" en versión escritorio.
  Decisión de Koku. *(Ojo al fusionar: el equivalente de Finanzas,
  `finanzas-escritorio`, sí salió de `escritorio`, que trae 36 commits
  más de mejoras generales de la app de escritorio. Cambiarlo es mover
  un puntero, si algún día interesa.)*
- **`viajes-movil`** — desde `movil-ui` (`d3a65d4`), en un **worktree
  aparte**: `../RemindMeLater-viajes`. Aquí se trabaja.

### Por qué NO se partió de la rama `viajes`

Porque `viajes` por dentro todavía es la app de antes de los dos cambios
grandes: tiene `server/`, `manifest.json` y `sw.js`, y **no tiene**
Capacitor, ni sql.js, ni el rediseño móvil, ni la barra inferior de
navegación. Partir de ahí sería rehacer a mano un trabajo que ya está
hecho y verificado.

### Precedente que se sigue: `gimnasio-movil` (y ahora `finanzas-movil`)

Mismo patrón exacto: rama sacada de `movil-ui`, worktree propio
(`../RemindMeLater-gimnasio`), y un rediseño por fases de UNA sección
para móvil. Es el camino ya probado.

---

## 2. Punto de partida: qué hay hoy de Viajes

**El backend está completo en las dos líneas. No hay nada que hacer
ahí.** Cinco tablas (`viajes_trips`, `viajes_trip_countries`,
`viajes_entries`, `viajes_entry_attachments`, `viajes_entry_movements`),
borrado en cascada a mano, y en la línea móvil las fotos ya están
portadas al almacén `noteAssets` de IndexedDB con URLs `blob:`
(`public/routes-local/viajesEntries.js`, 387 líneas, verificado en su día
con el guion de comparación diferencial). Además, `movil-ui` acaba de
ganar la **copia de seguridad con fotos incluidas**, así que una bitácora
de viaje ya se puede exportar.

**Lo que sí es de escritorio de arriba abajo es la interfaz**: unas 1.200
líneas de `app.js` (de `let viajesTrips = []` hasta `closeViajesView()`),
~76 reglas de `styles.css` y ~180 líneas de `index.html`:

- Pantalla completa `#viajes-view` con dos pestañas: **Mapa** y **Mis viajes**.
- **Mapa**: SVG del mundo (`viajes-world-map.svg`, 1,2 MB) con pan/zoom
  propio, países visitados resaltados; clic en un país → modal con los
  viajes de ahí.
- **Mis viajes**: botón "+ Viaje", barra de filtros (año / mes / país /
  "solo multipaís") y tarjetas de viaje con franja de color.
- **Detalle del viaje**: cabecera (nombre, ✎, "Eliminar viaje"), países,
  fechas, descripción, y la **bitácora**: entradas por día, cada una con
  sus fotos y sus movimientos (gastos/ingresos, enlazables a una
  transacción real de Finanzas).
- **Seis modales**: viaje, país, entrada, foto, gasto y "vincular a
  Finanzas".

---

## 3. Diagnóstico: qué es exactamente lo que no encaja en el móvil

No son impresiones, son cosas concretas del código actual.

### El mapa

- `.viajes-map-container` lleva `touch-action: none` y
  `max-height: 70vh`. `touch-action: none` significa que dentro del mapa
  el navegador no hace **nada** por su cuenta — tampoco scroll. En
  escritorio da igual (te desplazas con la rueda fuera del mapa); en el
  móvil el mapa ocupa media pantalla y **ahí el dedo no puede desplazar
  la página**.
- El mundo entero metido en 70vh de un móvil es una tira de países de
  3 mm. El mapa es lo más vistoso de Viajes y es justo lo que peor se ve.
- Los controles de zoom `+ − ⤢` son `.icon-btn` normales (~28 px). La
  guía de Apple pide 44 px para tocar con el dedo. Y con el pellizco ya
  funcionando, en móvil casi sobran.
- Tocar un país abre un **modal centrado**; el patrón móvil es una hoja
  inferior arrastrable.

### La lista de viajes

- `.viajes-filter-field` es `flex: 0 1 190px`: cuatro campos de 190 px en
  una pantalla de 390 px se apilan en dos o tres filas y se comen media
  pantalla **antes** de que se vea el primer viaje.
- Las tarjetas están bien de base (franja de color, texto a la
  izquierda), pero no dicen lo que en el móvil se quiere ver de un
  vistazo: cuántos días, cuántas fotos, cuánto se gastó.

### El detalle del viaje y la bitácora

- **"Eliminar viaje" está siempre a la vista, en rojo, en la cabecera.**
  En escritorio con ratón se tolera; en móvil es un botón destructivo
  permanentemente bajo el pulgar.
- La bitácora es una lista de tarjetas donde fotos y movimientos van
  mezclados como adjuntos. Es lo más parecido a un diario que tiene la
  app y no se lee como un diario.
- **Las fotos se cargan a tamaño completo**: no hay miniaturas. Una foto
  de iPhone son 3-5 MB; una bitácora de dos semanas se arrastra y se come
  la memoria. En escritorio no se notaba (disco local, pantalla grande).

### Los formularios

- `#viajes-gasto-modal` usa `<input type="number">` y
  `<input type="file">` nativos — contra la regla de la casa, que es
  innegociable.
- En móvil, "elegir archivo" debería ser explícitamente **Cámara /
  Galería**, no el menú del sistema.
- Son formularios largos de escritorio dentro de `.modal`, cuando la
  línea móvil ya tiene hojas inferiores, deslizar para actuar y pulsación
  larga.

---

## 4. Plan propuesto para `viajes-movil`

La idea de fondo, y lo que decidió Koku para esta ronda (**replantear la
navegación**, no solo re-adaptar): **en el móvil, Viajes no es "una tabla
con un mapa arriba", es un diario de viaje con una foto por delante**. Es
la herramienta que se usa *durante* el viaje, con una mano, a veces sin
cobertura — cosa que ya funciona, porque la app es 100 % local.

### Patrones móviles que ya existen en la rama y hay que reutilizar

Los mismos que lista `IDEAS-FINANZAS.md`, y en Viajes pesan estos:

- **`.mobile-nav`** — barra inferior. Su hueco central es configurable
  (`mobileNavNotesSlot`): **Viajes puede vivir ahí** como acceso directo
  mientras dura un viaje.
- **`.mobile-fab` / `.mobile-fab-wrap`** — botón flotante para la acción
  principal, con `.mobile-add-menu` si hay varias.
- **Deslizar sobre una fila para editar/borrar** — ya hecho en Notas; es
  la respuesta al "Eliminar viaje" siempre visible.
- **Sin controles nativos, nunca** — `createSelectField`,
  `createDateField`, `createMultiSelectField`, `.styled-checkbox`,
  `showAppConfirm`/`showAppAlert`.

### Fase 1 — Navegación y esqueleto

Reordenar antes que pintar. Propuesta: **tres pestañas** en vez de dos,
con el patrón `.gym-tabs`:

- **Mapa** — a pantalla completa, protagonista.
- **Viajes** — la lista.
- **Ahora** — *solo aparece si hay un viaje en curso*: el día de hoy, con
  entrada rápida, foto y gasto sin navegar por ningún sitio.

FAB único con menú contextual (la acción principal cambia según dónde
estés) en lugar de los "+ Viaje" / "+ Entrada" de escritorio. La gestión
y los ajustes del viaje, detrás del ☰ que ya existe en la cabecera.

### Fase 2 — El mapa, bien hecho

- A pantalla completa (menos la barra inferior), no 70vh: el mapa **es**
  la pantalla, así que deja de competir con el scroll de la página.
- Pellizco y arrastre de verdad; los botones de zoom desaparecen o se
  reducen a un único "ver todo".
- Tocar un país → **hoja inferior** arrastrable con sus viajes y el atajo
  de crear uno.
- Detalle bonito y barato: al abrir, encuadrar el mapa en los países
  visitados en vez de enseñar el mundo entero.

### Fase 3 — Lista de viajes y filtros

- Fuera los cuatro desplegables. En su sitio: **fila de chips horizontal
  desplazable** (2026 · 2025 · España · …) y un botón "Filtros" que abre
  una hoja con el resto. Los filtros activos se ven de un vistazo.
- Tarjetas **deslizables** para editar/borrar.
- Cada tarjeta con franja de color, rango de fechas, países, y **días /
  fotos / gasto total**.

### Fase 4 — La bitácora como diario

- Línea de tiempo vertical por días, con el día grande a la izquierda.
- **La foto manda**: si la entrada tiene fotos, se ven grandes, no como
  un adjunto en una lista.
- Los gastos del día como chips discretos con el importe, no como filas
  de tabla.
- **Resumen del viaje** arriba: total gastado, días, países, nº de fotos.
  Los datos ya están en la base; solo falta pintarlos.

### Fase 5 — Fotos

- **Miniaturas** generadas al subir (canvas, sin librería) y guardadas
  como un asset más; la original solo se carga al abrir la foto. Esto es
  lo que hace que la bitácora deje de arrastrarse.
- **Visor a pantalla completa** con pellizco y deslizar entre fotos.
- **Cámara nativa** (`@capacitor/camera`): "hacer foto" que va directa a
  la entrada de hoy. Este es *el* motivo de que Viajes tenga más sentido
  en el móvil que en el ordenador.

### Fase 6 — Cosas que solo puede hacer un móvil

- **Viaje activo**: si hoy cae entre las fechas de un viaje, la app ya lo
  sabe. "Estás en Japón · día 4 de 12", y la entrada de hoy a un toque.
- **Geolocalización** (`@capacitor/geolocation`): "estoy aquí" → detecta
  el país y lo añade al viaje o lo apunta en la entrada del día.
- **Recordatorio suave** al acabar el día ("¿qué tal hoy en Kioto?") que
  abre la entrada. La fontanería de avisos locales ya existe
  (`public/local-notifications.js`).

> Las fases 5 y 6 traen **plugins de Capacitor nuevos** → dependencias
> nuevas y, para probarlas de verdad, una compilación de TestFlight. Eso
> es GitHub Actions: **no se lanza sin que Koku lo pida en esa ronda.**

---

## 5. Decisiones ya tomadas

| Duda | Decisión de Koku |
|---|---|
| Base de `viajes-movil` | Desde **`movil-ui`** |
| Qué es `viajes-escritorio` | **Marcador** en la punta de `viajes` (8a646e1) |
| Dónde se trabaja | **Worktree aparte**, `../RemindMeLater-viajes` |
| Alcance de la ronda | **Replantear la navegación** (fases 1-6), asumiendo que por el camino cambiarán bastantes cosas |

---

## 6. Reglas de trabajo que aplican en esta rama

Las mismas de `CLAUDE.md` en la línea móvil:

- **Commit y push: sí**, agrupados por fase, sin pedir permiso cada vez.
- **GitHub Actions: nunca por cuenta propia.**
- **Nada de controles nativos** de navegador.
- Si se toca una ruta, se toca en `public/routes-local/`, no en
  `core/routes/` ni en `server/routes/` (eso es el otro programa).
- Se prueba con la app servida como estático en Chrome, con el móvil
  emulado (390×844), igual que se probó `gimnasio-movil`.
