# Finanzas — ideario y plan de las ramas `finanzas-escritorio` / `finanzas-movil`

Documento de trabajo de la ronda que arranca el **8/9/2026**. Recoge lo
que hay hoy construido de Finanzas, por qué se han creado dos ramas
nuevas, qué significa exactamente "adaptarlo a la UI de móvil", y las
ideas de producto que quedan apuntadas. Pensado para que una
conversación nueva pueda seguir sin que Koku repita el contexto.

---

## 1. El mapa de ramas (leer esto primero)

En el repositorio conviven **dos programas independientes**, y Finanzas
existe en los dos. Antes de tocar nada hay que saber en cuál estás:

| | App de escritorio | App móvil |
|---|---|---|
| Rama base | `escritorio` | `movil-ui` |
| Motor | Electron + `node:sqlite` | Capacitor + `sql.js` (SQLite a WebAssembly) |
| Backend | `core/` (router propio, sin HTTP) | `public/routes-local/` (router propio, dentro de la web) |
| Empaquetado | ejecutable de Windows | app nativa iOS/Android |
| Notas de trabajo | `CLAUDE.md` de `escritorio` | `CLAUDE.md` de `movil-ui` |

Las dos comparten `public/` (interfaz HTML/CSS/JS sin build ni
framework) y **ahí es donde chocarán el día que se fusionen**. Koku ya
dijo que ese merge se hace preguntando qué falta en cada lado, no
adelantándose.

### Ramas creadas en esta ronda

- **`finanzas-escritorio`** — nace de `escritorio` (commit `dd79c97`).
  Es "lo que hay de Finanzas actualmente" en el programa de escritorio,
  aislado en su propia rama para poder trabajarlo sin mezclarlo con
  otras herramientas.
- **`finanzas-movil`** — nace de `movil-ui` (commit `d3a65d4`, la punta
  más nueva de la app móvil). Aquí es donde se hace la adaptación de la
  interfaz a móvil.

### Por qué NO se partió de la rama `finanzas` que ya existía

`origin/finanzas` sale del commit `d6af318`, que es **anterior** a la
limpieza "fuera todo lo de móvil" del escritorio. O sea: esa rama
todavía lleva dentro el servidor Express viejo (`server/`), sin nada de
la arquitectura actual sin servidor. Y sobre todo — **su contenido ya
está fusionado en `escritorio`**: los diez archivos de rutas de
Finanzas viven hoy en `core/routes/finanzas*.js`. Partir de ella
habría significado arrastrar una arquitectura muerta y volver a portar
lo mismo dos veces.

`origin/finanzas` se queda como rama histórica. No se toca ni se borra;
simplemente ya no es el punto de partida de nada.

### Precedente que se sigue: `gimnasio-movil`

Esto no es un camino nuevo. Gimnasio ya recorrió exactamente el mismo:
rama propia salida de `movil-ui`, con el backend ya portado y una tanda
larga de commits dedicados solo a rehacer su interfaz para el teléfono
(tarjetas, botón flotante, barra de descanso global, y más tarde cosas
nativas de iOS como la Live Activity). `finanzas-movil` es el mismo
patrón aplicado a Finanzas. Se mira `gimnasio-movil` como referencia de
estilo, pero **no se toca ni se fusiona** — esa rama es de Koku.

---

## 2. Punto de partida: qué hay hoy de Finanzas

La buena noticia es que **el motor ya está entero en las dos ramas**. En
móvil, los diez archivos de rutas ya están portados a
`public/routes-local/` y verificados (la comparación diferencial contra
el servidor Express real dio 79 peticiones idénticas y 0 diferencias,
agregaciones de Finanzas incluidas).

Lo que Finanzas sabe hacer hoy:

- **Cuentas**: nombre, icono, color, saldo inicial y tipo informativo
  (Corriente / Ahorro / Inversión / Efectivo / Otro). El saldo se
  **calcula siempre**, nunca se guarda. Borrar una cuenta con
  movimientos se rechaza.
- **Categorías de gasto** propias. Borrarlas deja los gastos sin
  categoría, no los destruye.
- **Movimientos**: gastos e ingresos, con tres marcas por movimiento —
  "cuenta para el límite mensual", "es tu salario" (ingresos) y "gasto
  fijo". Filtros por cuenta, categoría, tipo y rango de fechas.
- **Límite mensual de gasto**, con barra de progreso (roja al pasarse) y
  desglose por categoría.
- **Ahorro**: objetivo mínimo mensual. El ahorro real es ingresos menos
  TODOS los gastos. Si el objetivo es poco realista frente a la media de
  salario menos gastos fijos de los últimos 6 meses, avisa — pero deja
  guardar. Vista mensual (mes a mes con flechas) e histórica (rango de
  meses, tabla de cumplido / no cumplido).
- **Gastos fijos recurrentes**: plantillas mensuales (con día) o anuales
  (día + mes), con fecha de fin opcional. Un generador crea la
  transacción de verdad cuando toca. Editar la plantilla **no** toca lo
  ya generado (el ejemplo de siempre: subir el precio de Netflix solo
  afecta a los cobros futuros) y nunca rellena periodos perdidos hacia
  atrás.
- **Inversiones**: registro manual de compras, ventas y dividendos —
  explícitamente **sin APIs de cotización en vivo**. Ganancia/pérdida
  *realizada* por activo.
- **Carteras anidadas** (como carpetas) con activos dentro, y un árbol
  de casillas junto a la gráfica para filtrar por cartera o por activo.
- **Valoraciones manuales de precio** por activo (fecha + precio por
  unidad) con su gráfica de evolución.
- **Gráficas**: ingresos contra gastos de los últimos 6 meses, y
  evolución de inversiones (comprado / vendido / dividendos por mes),
  todas SVG a mano, sin librerías, con tooltip propio.
- **Deudas**: "debo yo" y "me deben", con persona, importe, fecha,
  cuenta y estado.

**La mala noticia**: la interfaz de Finanzas es la misma en las dos
ramas y **nunca recibió el rediseño móvil**. Se comprobó archivo por
archivo: cero clases `mobile-*` en todo el código de Finanzas y las
mismas 91 reglas de CSS en ambas ramas. Mientras el calendario y las
notas se rehicieron enteros para el teléfono, Finanzas se quedó siendo
una pantalla de ordenador metida con calzador en una pantalla de 390
píxeles de ancho.

---

## 3. Diagnóstico: qué es exactamente lo que no encaja en el móvil

La vista vive en `#finanzas-view` y se organiza en **cinco pestañas** en
una sola fila horizontal: Resumen · Movimientos · Gastos fijos ·
Inversiones · Deudas. Repaso de lo que rompe en cada una:

### Las cinco pestañas de arriba
Cinco botones de texto en una fila no caben en el ancho de un teléfono
sin encogerse hasta ser ilegibles o desbordarse.

### Resumen
La pestaña más cargada de todas: tarjetas de saldo por cuenta, campo del
límite mensual con su botón "Guardar" al lado, barra de progreso,
objetivo de ahorro con otro campo y otro botón, aviso de objetivo poco
realista, alternador Mensual/Histórico, selector de mes con flechas +
campo de año, tabla de histórico de ahorro, desglose por categoría y
gráfica de tendencia. Todo apilado en la misma pantalla. En un teléfono
es un scroll interminable donde no se encuentra nada.

### Movimientos
- Gestión de cuentas y de categorías **metida dentro de la misma
  pestaña** que la lista de movimientos, con un formulario en línea
  (nombre + icono + color + Guardar) que en móvil ocupa media pantalla.
- Una fila de **cinco filtros** seguidos (cuenta, categoría, tipo,
  desde, hasta) que en vertical se convierte en una columna
  larguísima antes de llegar a los datos.
- La lista de movimientos es una **tabla de 6 columnas** con scroll
  horizontal. Las tablas anchas son el enemigo número uno del móvil.

### Gastos fijos
Tabla de **7 columnas** (descripción, cuenta, categoría, importe,
frecuencia, estado, acciones).

### Inversiones
La peor de las cinco: tabla de **8 columnas** de movimientos, otra tabla
de **6 columnas** de resumen por activo, más la lista de carteras, la
lista de activos, la gráfica de evolución y el árbol de casillas para
filtrar. Cuatro bloques distintos compitiendo por el mismo espacio.

### Deudas
Dos tablas de 6 columnas ("Debo yo" y "Me deben") una detrás de otra.

### Y en general
- Botones "+ Cuenta", "+ Movimiento", "+ Gasto fijo"… sueltos por
  encima de cada bloque, en vez de una acción principal clara.
- Los modales de crear/editar son de escritorio: pensados para una
  ventana, no para una hoja que sube desde abajo con el teclado del
  móvil ocupando media pantalla.

---

## 4. Plan propuesto para `finanzas-movil`

La idea rectora: **no reordenar lo de escritorio, sino repensar cada
pantalla como si Finanzas hubiera nacido en el teléfono** — que es lo
que se hizo con el calendario y con las notas. Los datos y las rutas no
se tocan; todo el trabajo es de interfaz.

### Patrones móviles que ya existen en la rama y hay que reutilizar

- **`.mobile-nav`** — la barra inferior de navegación (Calendario /
  Notas / Herramientas). Su hueco central es configurable desde
  Configuración → Este dispositivo (`mobileNavNotesSlot`): **Finanzas
  puede vivir ahí como acceso directo**, sin pasar por el hub de
  Herramientas.
- **`.mobile-fab` / `.mobile-fab-wrap`** — botón flotante para la acción
  principal, con `.mobile-add-menu` cuando hay varias acciones. Gimnasio
  llegó a tener cinco posiciones distintas de FAB según el contexto.
- **Tarjetas en vez de tablas** — el patrón `.gym-list-item` /
  `.gym-library-card`: cada fila es una tarjeta legible de un vistazo.
- **Gestos** — deslizar horizontal/vertical con animación
  (`.mobile-swipe-anim-*`), y deslizar sobre un elemento de lista para
  editar/borrar (ya se hizo en Notas).
- **Sin controles nativos, nunca** — `createSelectField`,
  `createDateField`, `createTimeField`, `createMultiSelectField`,
  `.styled-checkbox`, y `showAppConfirm`/`showAppAlert` en vez de
  `confirm()`/`alert()`. Esta regla es innegociable en todo el proyecto.
- **Gráficas SVG a mano**, sin librerías, con tooltip propio adaptado a
  toque (no a hover del ratón — esto hay que rehacerlo sí o sí).

### Fase 1 — Navegación y esqueleto

- Sustituir la fila de cinco pestañas por una navegación que quepa:
  pestañas deslizables con indicador, o un menú de secciones. Sospecho
  que lo mejor es **reducir de cinco secciones a tres o cuatro**
  moviendo la gestión (cuentas, categorías, carteras, activos) fuera de
  las pestañas de datos, a un apartado de "Ajustes de Finanzas" detrás
  del botón ☰ que ya existe en la cabecera.
- FAB único con menú contextual: la acción principal cambia según la
  sección en la que estés (+ Movimiento, + Gasto fijo, + Inversión,
  + Deuda).
- Deslizar horizontal para cambiar de sección, como en el calendario.

### Fase 2 — Resumen convertido en un panel de verdad

Que la primera pantalla responda de un vistazo a "¿cómo voy este mes?":

- Cabecera grande con el saldo total y el mes actual, con flechas o
  deslizamiento para moverse de mes.
- Anillo o barra de límite mensual como elemento principal, no como una
  fila más.
- El objetivo de ahorro como una segunda tarjeta con su estado
  (cumplido / no cumplido), sin el campo de edición a la vista — se
  edita tocándolo.
- Desglose por categoría como lista de barras táctiles, no como tabla.
- Las cuentas, en tarjetas deslizables horizontalmente.
- La gráfica de 6 meses, al final, con tooltip por toque.

### Fase 3 — Movimientos como lista de tarjetas

- Cada movimiento, una tarjeta: icono y color de la categoría, concepto,
  cuenta e importe con signo y color. Agrupadas por día, con el total
  del día en la cabecera de cada grupo.
- Deslizar una tarjeta para editar o borrar.
- Los cinco filtros, recogidos en una hoja de filtros que se abre desde
  un botón, con chips ✕ visibles de lo que hay filtrado (el patrón que
  ya usa Viajes).
- Cuentas y categorías salen de aquí: se van a "Ajustes de Finanzas".

### Fase 4 — Gastos fijos, Inversiones y Deudas

- **Gastos fijos**: tarjetas con la próxima fecha de cobro destacada y
  un aviso de los que caen esta semana.
- **Inversiones**: separar en dos niveles. Un resumen por activo
  (tarjetas con ganancia/pérdida en verde/rojo) y, tocando un activo,
  su detalle con movimientos y gráfica de precio. La lista plana de
  movimientos deja de ser la pantalla principal. El árbol de carteras se
  convierte en navegación por niveles (como las carpetas de notas), no
  en un árbol de casillas al lado de una gráfica.
- **Deudas**: dos listas con cabecera, tarjetas con la persona y el
  importe grandes.

### Fase 5 — Formularios y hojas

- Convertir los modales en hojas que suben desde abajo, con el foco
  puesto en no pelearse con el teclado (el problema del "cursor esquiva
  el teclado" ya se resolvió una vez en el editor de notas — se
  reaprovecha).
- Teclado numérico para importes y validación con aviso propio, nunca
  guardar algo inventado (el precedente es el campo de hora inteligente
  del calendario).

---

## 5. Ideas de producto: "que Finanzas sea realmente útil"

Esto viene del ideario de `movil-ui`, donde quedó apuntado como
💡 pendiente: *"Repensar Finanzas entera: Koku quiere que sea realmente
útil, no una tontería con 4 cosas — investigar qué tiene una app de
finanzas personales seria antes de diseñar más"*.

Ninguna de estas está encargada. Se apuntan para decidirlas antes de
diseñar más pantallas, porque algunas cambian la estructura de la app:

- **Presupuesto por categoría**, no solo un límite global: "150 € de
  comida al mes" con su propio aviso al acercarse.
- **Traspasos entre cuentas** — hoy no existen; mover dinero de
  Corriente a Ahorro obliga a inventarse un gasto y un ingreso.
- **Previsión de fin de mes**: con los gastos fijos ya conocidos y lo
  gastado hasta hoy, decir cuánto va a quedar. Es de las cosas que más
  diferencian una app útil de un registro contable.
- **Objetivos de ahorro con nombre** ("viaje a Japón", "cambiar el
  portátil") con progreso propio, en vez de un único objetivo mensual
  abstracto. Enlaza natural con la herramienta de Viajes.
- **Movimientos divididos** entre varias categorías (la compra del
  súper que lleva comida y droguería).
- **Etiquetas libres** además de la categoría, para cortes transversales
  ("regalos de Navidad", "obras de casa").
- **Repetir un movimiento anterior** de un toque — lo más frecuente en
  móvil es apuntar el café de todos los días.
- **Patrimonio neto**: cuentas + inversiones − deudas, con su evolución.
  Hoy las tres piezas existen pero no se suman en ningún sitio.
- **Widget / acceso rápido para apuntar un gasto** sin abrir la app
  entera. (Ojo: los widgets de iPhone de verdad exigen frameworks
  nativos y quedaron anotados como proyecto aparte; pero un acceso
  directo dentro de la app sí es viable ya.)
- **Comparación con el mes anterior** en el resumen: "vas un 12% por
  encima de lo normal en Ocio".

Ideas que se han descartado explícitamente y conviene no reabrir sin
motivo: **APIs de cotización en vivo** para inversiones (decisión
tomada: todo manual) y cualquier cosa que implique servicio en la nube o
cuenta de usuario (la app es local-first por diseño).

---

## 6. Decisiones abiertas (para Koku)

1. **¿Cuántas secciones?** ¿Se acepta bajar de cinco pestañas a tres o
   cuatro, moviendo cuentas/categorías/carteras a un apartado de
   ajustes? Es el cambio con más impacto en toda la navegación.
2. **¿Finanzas en la barra inferior?** El hueco central es
   configurable. ¿Se deja como está (entrando por Herramientas) o
   Finanzas pasa a ser candidata a ocupar ese hueco?
3. **¿El rediseño se queda en móvil o vuelve a escritorio?** Varias de
   las ideas de la sección 5 son de datos, no de interfaz: si se
   construyen, tiene sentido que estén en las dos ramas. Conviene
   decidir antes de empezar, para no portar dos veces.
4. **¿Primero la interfaz o primero las funciones?** El plan de arriba
   es todo interfaz. Meter presupuestos por categoría o traspasos antes
   cambiaría lo que hay que dibujar.
5. **Orden de las fases**: el plan va Resumen → Movimientos → el resto.
   Si lo que más usa Koku es apuntar gastos sobre la marcha, quizá
   convenga empezar por Movimientos y el FAB.

---

## 7. Reglas de trabajo que aplican en esta rama

Heredadas de `movil-ui`, donde ya estaban acordadas:

- **Commit y push, sin pedir permiso cada vez** (autorización dada por
  Koku para esta rama y confirmada al abrir esta ronda). Se agrupa por
  ronda de trabajo, no un commit por cada cambio suelto.
- **GitHub Actions: NUNCA lanzarlo por cuenta propia.** El número de
  compilaciones es limitado. Solo si Koku lo pide explícitamente en esa
  misma ronda.
- **No tocar `escritorio`, `movil-ui` ni `gimnasio-movil`.** Se pueden
  leer para tener contexto; se trabaja en `finanzas-movil` y
  `finanzas-escritorio`.
- **Los documentos de esta conversación viven en la rama de móvil.** Ya
  hubo un malentendido real (el ideario acabó por error en
  `escritorio`); este archivo nace en `finanzas-movil` a propósito.
- Preguntar cuando algo sea ambiguo, agrupando las dudas al principio
  en vez de ir parando a cada rato.
- Verificar con números y con navegador real, y limpiar los datos de
  prueba después.
