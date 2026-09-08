# Entretenimiento — notas de la ronda (antes "Lecturas")

Documento de trabajo de la rama de Entretenimiento: qué hay hoy, qué se
propone, y qué falta decidir. No es documentación de usuario.

---

## 1. Lo primero: el mapa de ramas (esto sorprende)

`lecturas` **no es una rama viva**. Apunta al commit `9ce0cda`
("Extension Lecturas: historial de entretenimiento agrupado en sagas"),
que es de la época de la v0.27 y **ya está fusionado en `main` y, por
herencia, en todas las demás ramas**. O sea: `git diff main...lecturas`
sale vacío. Si creáramos las dos subramas literalmente "a partir de
`lecturas`", empezaríamos en un repo de hace muchísimas rondas, sin
Proyectos, sin Finanzas nuevo, sin nada del rediseño móvil.

Hoy en el repo conviven **dos programas distintos**, y esto condiciona
todo lo demás:

| | Línea ESCRITORIO | Línea MÓVIL |
|---|---|---|
| Ramas | `escritorio` → `proyectos` (la punta) | `movil-ui` → `gimnasio-movil` (la punta) |
| Empaquetado | Electron (`electron/`) | Capacitor (`android/`, `ios/`) |
| Base de datos | `node:sqlite` en `core/db.js` | `sql.js` (SQLite a WebAssembly) en `public/local-*.js` |
| Rutas | `core/routes/*.js` (26) | `public/routes-local/*.js` (25) |
| Transporte | IPC de Electron | despacho en memoria, sin red |
| UI | escritorio siempre (se borró todo lo móvil) | barra inferior, FAB, gestos, fichas |

Comparten `public/app.js`, `public/index.html` y `public/styles.css`,
pero han divergido mucho (10.115 líneas de `app.js` en escritorio contra
14.138 en móvil).

**Lecturas está exactamente igual en las dos líneas.** Lo comprobé
diffeando función por función: la UI de Lecturas en la rama móvil es la
tabla de escritorio, sin tocar. Es la única extensión que se quedó sin
pasar por el rediseño móvil (Calendario, Notas y Gimnasio sí pasaron).
O sea que el encargo tiene sentido literal: **coger la base de
escritorio y adaptarla a la UI de móvil**, porque hoy en el móvil está
la de escritorio tal cual.

---

## 2. Qué es "Lecturas" hoy

### Modelo de datos (idéntico en las dos líneas)

Dos tablas, y la saga es un **contenedor obligatorio**: hasta una novela
suelta es "una saga de un item". Eso permite que una misma obra agrupe
el manga *y* el anime bajo el mismo nombre.

```
lecturas_sagas         id, name, description, created_at, updated_at
lecturas_items         id, saga_id (obligatorio), title,
                       type      ∈ manga|comic|libro|serie|anime|pelicula
                       status    ∈ wishlist|in_progress|completed|dropped
                       description, rating (0–10, medio punto),
                       genres (array JSON de texto libre, máx. 20),
                       progress_current / progress_total / progress_unit,
                       owned_count / owned_total,
                       position,
                       loaned / loaned_to / loaned_at
```

Detalles heredados que conviene no romper:
- **Géneros como JSON de texto libre**, no tabla N:M. Las sugerencias
  salen de unir una lista predefinida con todos los géneros ya usados en
  *cualquier* saga (`GET /api/lecturas-items` sin `sagaId`).
- **Borrar una saga borra sus items** (un item no tiene sentido sin
  saga, no hay dónde reasignarlo).
- `wishlist` cubre la lista de deseos: no hay sección aparte.
- "Prestado" no guarda historial, solo el estado actual; desmarcarlo
  limpia a quién y desde cuándo.

### API (4 + 4 endpoints)

```
GET/POST/PUT/DELETE  /api/lecturas-sagas[/:id]
GET/POST/PUT/DELETE  /api/lecturas-items[/:id]     GET admite ?sagaId=
```

### UI actual (escritorio, y hoy también en móvil)

Pantalla completa desde el hub de Herramientas, con dos paneles y
drill-down (más parecido a cómo Notas navega carpetas que a las pestañas
de Gimnasio):

1. **Panel de sagas** — tabla de 3 columnas (Nombre / Tipos / Nº items)
   + botón "+ Nueva saga". Clic en fila → detalle.
2. **Detalle de saga** — "← Sagas", nombre editable (✎), descripción,
   fila de filtros (tipo / estado / género / rating mínimo / quitar
   filtros), "+ Nuevo item" y tabla de 7 columnas
   (Título+insignia "Prestado" / Tipo / Estado / Rating / Géneros /
   Progreso / Tengo).
3. **Modal de item** — título, tipo, estado, descripción, rating
   (slider + número), chips de género con sugerencias clicables,
   progreso (actual/total/unidad), "tengo N de M", y el bloque de
   "Prestado" que se despliega al marcarlo.

CSS relevante: `.lecturas-panel`, `.lecturas-table`, `.lecturas-filters`,
`.lecturas-status-badge`, `.lecturas-loaned-badge`, `.lecturas-genre-chip`,
`.lecturas-rating-field` (≈60 líneas en `styles.css`).

**Lo que chirría en un móvil**: una tabla de 7 columnas con scroll
horizontal, filas de 40px de alto como única zona clicable, filtros
apilados que se comen media pantalla, y un modal con ~12 campos de golpe.

---

## 3. El vocabulario de UI móvil que ya existe

No hay que inventarlo: la rama móvil ya tiene un sistema hecho y probado.
Adaptar Entretenimiento es **aplicar estas piezas**, no diseñar de cero.

- **Concha general**: `.mobile-nav` (barra inferior fija de 4 botones:
  Calendario / Notas / Herramientas / Configuración) y vistas a pantalla
  completa que se abren encima.
- **Acción principal flotante**: `.mobile-fab` / `.mobile-fab-wrap`
  (esquina inferior derecha, por encima de la barra, respetando
  `env(safe-area-inset-bottom)`), con `.mobile-add-menu` cuando hay
  varias acciones.
- **Pestañas tipo chip**: `.gym-tabs` / `.gym-tab-btn.active` (relleno
  de acento). Es lo que Gimnasio usa en vez de una tabla.
- **Listas como fichas**: `.gym-list-item` — bloque con padding,
  `border-radius`, nombre en negrita + línea gris de metadatos, y sus
  acciones a la derecha. Toda la ficha es clicable.
- **Gestos**: `attachSwipe(el, {onUp,onDown,onLeft,onRight})` en
  `app.js` (ya lo usan Calendario y Notas: deslizar para editar/borrar,
  pulsación larga para seleccionar).
- **Acento propio por herramienta**: Gimnasio define `--gym-accent`
  (morado) *scoped* a `#gym-view`/`.gym-modal`, sin tocar los temas
  globales. Entretenimiento debería tener el suyo.
- **Controles**: `createSelectField()` / `createDateField()` y
  `.styled-checkbox`. **Nunca controles nativos** (regla explícita de
  Koku).
- **Estilos de UI**: `data-ui-style` en `:root` (directo / neón /
  cristal / registro). Lo nuevo debe seguir funcionando en los cuatro.

---

## 4. Propuesta de diseño para el visor móvil

Idea de fondo: hoy la app te obliga a **navegar por sagas** para ver
nada. En el móvil, lo que uno quiere abrir es *"¿por dónde iba?"*, no
*"enséñame el índice de mis colecciones"*. Así que la propuesta invierte
la jerarquía: la saga sigue existiendo como agrupador (y como pantalla),
pero deja de ser la puerta de entrada.

### 4.1 Pantalla de inicio de Entretenimiento

Barra de pestañas-chip arriba (`.gym-tabs`), y FAB abajo a la derecha
para añadir:

| Pestaña | Qué muestra |
|---|---|
| **Siguiendo** | Los items `in_progress`, ordenados por lo tocado hace menos. Es la pantalla que se abre por defecto. |
| **Colecciones** | Las sagas, como fichas (nombre + tipos + nº items), que es la vista de hoy pero en fichas en vez de tabla. |
| **Deseos** | Los `wishlist` de todas las sagas juntos. |
| **Historial** | `completed` + `dropped`. |

Las tres pestañas que no son "Colecciones" son **vistas transversales**:
cruzan todas las sagas. Ya son posibles sin backend nuevo —
`GET /api/lecturas-items` sin `sagaId` devuelve todo, y el propio código
del servidor tiene un comentario diciendo que se dejó preparado para
"una futura vista cruzada tipo todo lo que tengo en Deseado". Esto es
justo eso.

### 4.2 La ficha de un item

Sustituye a la fila de tabla. En una tarjeta caben las 7 columnas sin
scroll horizontal:

```
┌──────────────────────────────────────────┐
│ ▌ Kimetsu no Yaiba — Tomo 12   [Prestado]│   ▌ = franja del color del tipo
│   Manga · Acción, Fantasía               │
│   ▓▓▓▓▓▓▓▓▓▒▒▒▒▒  12/24 capítulos        │   barra de progreso
│   ★ 8,5                    En progreso   │   insignia de estado
└──────────────────────────────────────────┘
```

- Toda la ficha abre el detalle.
- **Deslizar a la izquierda** → acciones rápidas (avanzar progreso +1 /
  cambiar estado). Es la acción que más se repite en una app así: "me he
  leído otro capítulo".
- **Pulsación larga** → menú (editar / mover de saga / borrar), igual
  que en Notas.

### 4.3 Filtros

La fila de 5 filtros de escritorio no cabe. Propuesta: un botón
"Filtros" que abre una **hoja inferior** (bottom sheet) con tipo,
estado, género y rating mínimo; con un contador de filtros activos en
el botón, y los filtros activos también como chips quitables encima de
la lista. El buscador por título va fijo arriba (hoy no existe ni en
escritorio: se filtra pero no se busca).

### 4.4 El modal de item

Doce campos de golpe en una pantalla de móvil es demasiado. Propuesta:
hoja a pantalla completa con lo esencial arriba (título, tipo, estado,
progreso) y **dos secciones plegables** para lo demás ("Detalles":
descripción, géneros, rating, y "Colección": tengo N de M, prestado).

### 4.5 Lo que NO cambia

- El modelo de datos y los 8 endpoints: **intactos**. Todo lo de arriba
  se pinta con lo que ya devuelve la API.
- La saga sigue siendo obligatoria. Añadir desde "Siguiendo" pedirá la
  saga (con un "crear saga nueva con este nombre" para el caso de item
  suelto, que es el que hoy obliga a dos pasos).

---

## 5. El renombrado: Lecturas → Entretenimiento

Koku tiene razón en que el nombre se quedó corto: ya hay series, pelis y
anime dentro. El renombrado tiene **tres capas independientes**, y se
puede hacer solo la primera:

1. **Lo que se ve** — el botón del hub de Herramientas, el título de la
   pantalla, los textos ("Todavía no tienes ninguna saga…"). Cambio de
   cadenas, riesgo cero.
2. **El código del cliente** — ids del HTML (`lecturas-item-modal`…),
   clases CSS (`.lecturas-table`…), funciones y constantes
   (`openLecturasItemModal`, `LECTURAS_TYPE_LABELS`…). Es un renombrado
   mecánico grande (~200 apariciones entre `app.js`, `index.html` y
   `styles.css`) que hace ilegible el diff de la ronda y complica
   cualquier fusión futura entre las dos líneas.
3. **Rutas y base de datos** — `/api/lecturas-*` → `/api/entretenimiento-*`,
   y las tablas `lecturas_sagas` / `lecturas_items`. Esto **sí necesita
   migración** (`ALTER TABLE ... RENAME TO`, idempotente y comprobando
   antes si ya está renombrada), y hay que hacerla dos veces, una por
   línea (`core/db.js` y `public/local-schema.js`), con el riesgo de que
   un móvil con datos reales quede a medias.

Mi recomendación: **hacer la capa 1 ahora** (que es lo que Koku
realmente ve), y decidir la 2 y la 3 aparte — la 3 sobre todo, porque
toca datos reales suyos y el beneficio es puramente estético.

---

## 6. Plan de ramas propuesto

```
proyectos  ──────────────────────────►  entretenimiento-escritorio
(punta de la línea de escritorio)        "lo que hay de lectura
                                          actualmente" + renombrado

gimnasio-movil  ─────────────────────►  entretenimiento-movil
(punta de la línea móvil)                misma base funcional,
                                         UI rehecha para móvil
```

No salen del mismo commit **a propósito**: son dos programas distintos,
y una rama móvil que salga de `proyectos` no tendría Capacitor ni el
motor `sql.js`, o sea que no sería una app móvil. Lo que sí comparten es
el punto de partida funcional (Lecturas es idéntico en ambas líneas hoy),
así que "coger la base de escritorio" se cumple igual.

---

## 7. Cosas heredadas que hay que respetar (o romper a propósito)

- **Nunca controles nativos** (`<select>`, `<input type="date">`,
  checkbox): siempre `createSelectField()`, `createDateField()`,
  `.styled-checkbox`. Es regla explícita.
- **Nada de `confirm()`/`alert()` nativos** en pantallas nuevas: la app
  tiene `showAppConfirm`/`showAppAlert`. Ojo, el Lecturas actual **sí
  usa `confirm()` nativo** al borrar una saga — es una deuda a arreglar
  de paso.
- **Comentarios explicados de más**, en español, sin acentos en el
  código fuente. Es el estilo del repo a propósito.
- **Las pruebas con Electron escriben en los datos REALES** si no se
  apunta `REMINDMELATER_DATA_DIR` a una carpeta desechable. Ya pasó una
  vez.
- **GitHub Actions no se lanza sin permiso** (límite de builds de Apple).

---

## 8. Decisiones abiertas

1. **Punto de partida de las ramas** — ¿el plan del punto 6, o las dos
   desde el mismo sitio?
2. **Profundidad del renombrado** — ¿capa 1, 1+2, o las tres con
   migración de base de datos?
3. **Estructura del visor móvil** — ¿la inversión de jerarquía del
   punto 4.1 (pestañas transversales, sagas como una más), o mantener
   "sagas primero" tal cual pero con fichas en vez de tablas?
4. **Portadas** — hoy no hay ninguna imagen. Un rastreador de series y
   pelis en móvil sin carátulas se ve muy pobre, pero añadirlas implica
   almacén de imágenes (existe el patrón: `noteAssets` en IndexedDB) y
   decidir de dónde salen (¿pegar una foto? ¿una API externa como TMDB,
   que rompería el "todo local"?).
5. **Tipos nuevos** — el `CHECK` de `type` está cerrado a 6 valores. Si
   "Entretenimiento" va a crecer (videojuegos, podcasts, música…),
   ampliarlo ahora sale más barato: cambiar un `CHECK` exige recrear la
   tabla (ya pasó en Proyectos).
