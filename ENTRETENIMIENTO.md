# Entretenimiento (antes "Lecturas") — notas de la rama

Documento de trabajo: qué había, qué se ha hecho ya, y qué queda. No es
documentación de usuario.

---

## 1. Lo primero: el mapa de ramas

`lecturas` **no era una rama viva**. Apuntaba a `9ce0cda` (época de la
v0.27) y ya estaba fusionada en `main` y, por herencia, en todas las
demás: `git diff main...lecturas` salía vacío. Partir de ahí habría
devuelto el proyecto muchas rondas atrás.

Tampoco valían `proyectos` ni `gimnasio-movil`: son ramas **hermanas**
sin fusionar, no las puntas del tronco. Basarse en ellas habría metido
el editor de bloques de Proyectos / el rediseño de Gimnasio dentro de
Entretenimiento.

Así que se siguió el patrón que ya establecieron `finanzas-escritorio` y
`finanzas-movil`, que salen de los troncos:

```
origin/escritorio (dd79c97)          origin/movil-ui (d3a65d4)
  ├─ proyectos        (hermana)        ├─ gimnasio-movil  (hermana)
  ├─ finanzas-escritorio               ├─ finanzas-movil
  └─ entretenimiento-escritorio        └─ entretenimiento-movil  ◄ ESTA
```

**Cuidado**: al crearlas con `git branch <nueva> origin/<tronco>`, git
las dejó rastreando el tronco, o sea que un `git push` a secas habría
pushado a `movil-ui`. Se les quitó el upstream a mano. Si creas otra
rama así, comprueba `git for-each-ref --format='%(refname:short) ->
%(upstream:short)' refs/heads/` antes de pushear.

En el repo conviven **dos programas distintos** y esto condiciona todo:

| | Línea ESCRITORIO | Línea MÓVIL (esta rama) |
|---|---|---|
| Tronco | `escritorio` | `movil-ui` |
| Empaquetado | Electron | Capacitor |
| Base de datos | `node:sqlite` (`core/db.js`) | `sql.js` a WebAssembly (`public/local-schema.js`) |
| Rutas | `core/routes/*.js` | `public/routes-local/*.js` |
| UI | escritorio siempre | barra inferior, FAB, gestos |

**Entretenimiento estaba idéntico en las dos líneas.** Comprobado
diffeando función por función: la UI en la rama móvil era la tabla de
escritorio sin tocar. Es la única extensión que se saltó el rediseño
móvil (Calendario, Notas y Gimnasio sí pasaron).

---

## 2. El modelo de datos

Dos tablas, y la saga es un **contenedor obligatorio**: hasta una novela
suelta es "una saga de un item". Eso permite que una misma obra agrupe
el manga *y* el anime bajo el mismo nombre.

```
entretenimiento_sagas    id, name, description, created_at, updated_at
entretenimiento_items    id, saga_id (obligatorio), title,
                         type    (lista ABIERTA, ver abajo)
                         status  ∈ wishlist|in_progress|completed|dropped
                         description, rating (0–10, medio punto),
                         genres (array JSON de texto libre, máx. 20),
                         progress_current / progress_total / progress_unit,
                         owned_count / owned_total,
                         position,
                         loaned / loaned_to / loaned_at,
                         cover   (ruta de la portada, NUEVO)
```

Detalles heredados que conviene no romper:
- **Géneros como JSON de texto libre**, no tabla N:M. Las sugerencias
  salen de unir una lista predefinida con los géneros ya usados en
  *cualquier* saga (`GET /api/entretenimiento-items` sin `sagaId`).
- **Borrar una saga borra sus items** (un item no tiene sentido sin
  saga, no hay dónde reasignarlo). Cascada a mano, no `ON DELETE`.
- `wishlist` cubre la lista de deseos: no hay sección aparte.
- "Prestado" no guarda historial, solo el estado actual; desmarcarlo
  limpia a quién y desde cuándo.

### API

```
GET/POST/PUT/DELETE  /api/entretenimiento-sagas[/:id]
GET/POST/PUT/DELETE  /api/entretenimiento-items[/:id]   GET admite ?sagaId=
```

---

## 3. Lo que YA está hecho en esta rama

### 3.1 Renombrado completo, incluida la base de datos

Las tres capas: textos visibles, código del cliente (ids del HTML,
clases CSS, funciones y constantes) y rutas + tablas.

**La trampa que había**: el editor de notas usa "modo lectura" y "solo
lectura" en singular. Un buscar-y-reemplazar de "lectura" las habría
destrozado. Se renombró solo el **plural** (`lecturas` / `Lecturas` /
`LECTURAS`), tras comprobar que todos los plurales del repo eran de la
extensión. Las 21 apariciones de "modo/solo lectura" siguen intactas.

**La migración de base de datos** vive en `local-schema.js` y tiene una
parte delicada: el renombrado de tablas corre **antes** del bloque de
esquema. Si corriera después, el `CREATE TABLE IF NOT EXISTS
entretenimiento_items` vería que no existe, crearía una tabla **vacía**,
y los datos de verdad se quedarían para siempre en la vieja
`lecturas_items` sin que nadie los mire otra vez. Es idempotente: solo
renombra si la vieja existe y la nueva todavía no.

### 3.2 Lista de tipos abierta

Antes: `CHECK (type IN ('manga','comic','libro','serie','anime',
'pelicula'))`. En SQLite un CHECK no se puede quitar con `ALTER TABLE`,
hay que reconstruir la tabla entera — y esa lista va a seguir creciendo.

Ahora la columna **no lleva CHECK**, y la validación vive en el array
`TYPES` de la ruta. Añadir un tipo nuevo el día de mañana es cambiar dos
líneas (`TYPES` en la ruta + `ENTRETENIMIENTO_TYPE_LABELS` en `app.js`),
sin migración. Mismo criterio que ya usaba `viajes_trip_countries` con
los códigos de país, y por la misma razón.

Tipos ahora: los 6 de siempre + **videojuego, podcast, música, otro**.

La reconstrucción de la tabla para bases ya existentes se hace con
`PRAGMA foreign_keys = OFF` alrededor: `entretenimiento_items` apunta a
`entretenimiento_sagas`, y sin apagarlas el `DROP TABLE` falla de verdad
(ya pasó en Proyectos, no es teórico).

### 3.3 Portadas

Columna `cover`: la **ruta** de la imagen, nunca los bytes. Los bytes
van al almacén `noteAssets` de IndexedDB igual que las imágenes de las
notas — meter base64 en la tabla inflaría la base y haría lento cada
volcado. La ruta se valida contra `/^\/api\/notes\/images\/[\w.-]+$/`:
una URL de fuera se descarta (queda NULL) en vez de rechazar el guardado
entero, porque perder la portada no debe impedir guardar el item.

**La columna está y la API la acepta, pero la interfaz todavía no la
pinta ni deja elegirla** — eso va con el visor móvil.

### 3.4 Verificación

Nada de "¿le han quitado la clase `hidden`?". Lo que se comprobó:

- **Migración** (`test-migracion.js`): base con la forma vieja, poblada
  con 2 sagas y 3 items → 21 comprobaciones en verde. Los datos
  sobreviven (títulos, progreso, rating, géneros, préstamo, "tengo 5 de
  23", los ids no cambian), el CHECK de tipos desaparece, el de `status`
  se queda, las claves foráneas quedan encendidas y sin huérfanos, pasar
  el esquema 3 veces no duplica nada, y una instalación desde cero nace
  ya con la forma nueva.
- **Rutas** (`test-rutas.js`): 27 comprobaciones contra el router local
  de verdad. Crear/leer/editar/borrar, los 4 tipos nuevos aceptados, un
  tipo inventado sigue dando 400, la portada de fuera se descarta, y
  borrar una saga se lleva sus items.
- **La app real** servida como estático en Chrome: arranca sin un solo
  error de consola, la tarjeta del hub dice "Entretenimiento", se
  siembran datos con las APIs normales (incluido un `videojuego`), la
  vista se abre y **se ve** (medido su tamaño real), la tabla pinta las
  2 sagas y sus items, y el desplegable del modal trae los 10 tipos.

---

## 4. Lo que queda: el visor móvil

Decidido con Koku: **invertir la jerarquía**. Hoy la app te obliga a
navegar por sagas para ver nada; en el móvil lo que uno quiere abrir es
*"¿por dónde iba?"*, no *"el índice de mis colecciones"*.

### 4.1 Pantalla de inicio

Pestañas-chip arriba (`.gym-tabs`), FAB abajo a la derecha:

| Pestaña | Qué muestra |
|---|---|
| **Siguiendo** | Los `in_progress`, lo tocado hace menos primero. Es la que abre por defecto. |
| **Colecciones** | Las sagas, como fichas. Es la vista de hoy pero en fichas. |
| **Deseos** | Los `wishlist` de todas las sagas juntos. |
| **Historial** | `completed` + `dropped`. |

Las tres que no son "Colecciones" son **transversales**: cruzan todas
las sagas. Ya son posibles sin backend nuevo — `GET
/api/entretenimiento-items` sin `sagaId` devuelve todo, y el propio
código tiene un comentario diciendo que se dejó preparado para "una
futura vista cruzada tipo todo lo que tengo en Deseado".

### 4.2 La ficha de un item

Sustituye a la fila de tabla. Caben las 7 columnas sin scroll lateral:

```
┌──────────────────────────────────────────┐
│ ▌ Kimetsu no Yaiba — Tomo 12   [Prestado]│   ▌ = franja del color del tipo
│   Manga · Acción, Fantasía               │       (ENTRETENIMIENTO_TYPE_COLORS)
│   ▓▓▓▓▓▓▓▓▓▒▒▒▒▒  12/24 capítulos        │
│   ★ 8,5                    En progreso   │
└──────────────────────────────────────────┘
```

- Toda la ficha abre el detalle.
- **Deslizar a la izquierda** → acciones rápidas (progreso +1 / cambiar
  estado). Es lo que más se repite: "me he leído otro capítulo".
- **Pulsación larga** → menú (editar / mover de saga / borrar), igual
  que en Notas.
- Con portada, la franja de color deja sitio a la miniatura.

### 4.3 Filtros

La fila de 5 filtros no cabe. Botón "Filtros" que abre una **hoja
inferior** con tipo, estado, género y rating mínimo, con contador de
filtros activos y chips quitables encima de la lista. Buscador por
título fijo arriba (hoy no existe ni en escritorio: se filtra pero no se
busca).

### 4.4 El modal de item

Doce campos de golpe es demasiado en un móvil. Hoja a pantalla completa
con lo esencial arriba (título, tipo, estado, progreso) y dos secciones
plegables: "Detalles" (descripción, géneros, rating) y "Colección"
(tengo N de M, prestado, portada).

---

## 5. El vocabulario de UI móvil que ya existe

No hay que inventarlo, está hecho y probado en esta línea:

- **Concha**: `.mobile-nav` (barra inferior de 4 botones) y vistas a
  pantalla completa encima.
- **Acción principal**: `.mobile-fab` / `.mobile-fab-wrap` (respeta
  `env(safe-area-inset-bottom)`), con `.mobile-add-menu` si hay varias.
- **Pestañas chip**: `.gym-tabs` / `.gym-tab-btn.active`.
- **Fichas**: `.gym-list-item` — padding, radio, nombre en negrita +
  línea gris de metadatos. Toda la ficha clicable.
- **Gestos**: `attachSwipe(el, {onUp,onDown,onLeft,onRight})` en
  `app.js`.
- **Acento propio**: Gimnasio define `--gym-accent` *scoped* a
  `#gym-view`, sin tocar los temas. Entretenimiento debería tener el
  suyo.
- **Estilos de UI**: `data-ui-style` en `:root` (directo / neón /
  cristal / registro). Lo nuevo debe verse bien en los cuatro.

---

## 6. Reglas que hay que respetar

- **Nunca controles nativos** (`<select>`, `<input type="date">`,
  checkbox): siempre `createSelectField()`, `createDateField()`,
  `.styled-checkbox`.
- **Nada de `confirm()`/`alert()` nativos**. Ojo: el Entretenimiento
  actual **sí usa `confirm()`** al borrar una saga — deuda a arreglar de
  paso.
- **Comentarios explicados de más**, en español, sin acentos en el
  código fuente.
- **GitHub Actions no se lanza sin permiso** (límite de builds de Apple).

---

## 7. Decisiones abiertas

1. **Portadas desde internet** (TMDB y similares): se descartó por ahora
   porque rompe el "todo local, sin red". La columna `cover` es agnóstica
   — si algún día se quiere, solo cambia de dónde salen los bytes.
2. **Qué hace "Siguiendo" con lo que no tiene progreso**: un item
   `in_progress` sin `progress_total` no puede pintar barra. ¿Se muestra
   igual sin barra, o se ordena al final?
3. **Mover un item de saga**: hoy no se puede (el `sagaId` no se puede
   cambiar desde el `PUT`). El menú de pulsación larga lo daría por
   hecho, así que habría que añadirlo.
4. **La rama de escritorio** (`entretenimiento-escritorio`) está creada
   pero **sin tocar**: sigue siendo el "antes". Cuando toque, el
   renombrado hay que rehacerlo ahí (con su propia migración en
   `core/db.js`), porque son dos programas distintos.
