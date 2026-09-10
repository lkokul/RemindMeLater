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

## 4. Decisiones tomadas (ronda del 10/9/2026)

Koku revisó las propuestas y cerró las tres decisiones que bloqueaban
todo lo demás:

1. **La navegación deja de ser pestañas**: Finanzas pasa a tener un
   inicio de tarjetas tipo la app Salud de iPhone (detalle en la
   sección 6).
2. **El dinero de terceros es un TIPO DE CUENTA nuevo**, no una marca
   por movimiento ni una cartera (detalle en 5.5).
3. **Se empieza por la previsión de gastos fijos**, porque de esa única
   pieza salen cuatro de las cinco cosas que pidió.

Además, una pieza nueva que salió en esa conversación y que no estaba
en el plan original: **el seguimiento histórico de cada gasto fijo**
(cuánto costaba este gasto el año pasado, y el anterior). Ver 5.2.

El estilo visual que quiere Koku, en sus palabras: *"todo va bastante
Apple-ish, me gusta su estilo, limpio, sencillo, pulcro, que sea fácil
y no maree demasiado"*.

---

## 5. Las piezas nuevas, una por una

### 5.1 Previsión de gastos fijos (la pieza base)

**El problema de hoy**: una plantilla de gasto fijo solo genera el
movimiento real cuando llega la fecha, y **nunca mira hacia delante**.
Por eso no hay forma de contestar a "¿qué me queda por pagar este mes?".

**La solución**: poder preguntar *"dame las ocurrencias de esta
plantilla entre estas dos fechas"*, calculadas al vuelo y **nunca
guardadas** — coherente con la regla de la casa (valores calculados, no
almacenados) y, sobre todo, evita llenar la base de movimientos
fantasma que habría que ir limpiando cada vez que se edita una
plantilla.

Cada ocurrencia prevista sale con su estado:

- **Pagado** — ya existe la transacción generada de ese periodo (se
  reconoce por `recurring_expense_id` + la clave de periodo `YYYY-MM`
  para los mensuales o `YYYY` para los anuales, que es exactamente lo
  que ya usa `last_generated_period`).
- **Pendiente** — todavía no ha llegado su fecha, o ha llegado y aún no
  se ha abierto la app.

De esa pieza salen tres pantallas:

- **"Qué me queda por pagar"**, con selector Semana / Mes / Año y un
  interruptor Pendiente / Pagado / Todo (lo pidió explícitamente: no
  solo filtrar lo que queda, también ver lo que hay).
- **La lista anual**, tal cual la describió:
  ```
  2026                              2.847 €
    Enero      200 €
    Febrero    300 €
    ...
  ```
  Tocas un mes y se abre el desglose (alquiler 100 €, luz 50 €…). Los
  meses **pasados enseñan lo que se pagó de verdad** y los **futuros lo
  previsto**, marcados distinto — porque no tienen por qué coincidir.
  Efecto secundario útil: los meses caros (el del seguro anual) saltan
  a la vista solos.
- **Marcar pagado antes de tiempo**, que genera ya el movimiento real.

### 5.2 Suscripciones y evolución del coste

Nada de entidad nueva: son los gastos fijos que ya existen, con un
**tipo** (Suscripción / Recibo / Préstamo / Otro).

Lo que hace útil la pantalla es **normalizar todo a mensual y anual**,
que es justo lo que hoy no se puede comparar: Netflix 10 €/mes = 120
€/año, seguro del coche 400 €/año = 33 €/mes. Cabecera con las dos
cifras grandes y la lista ordenada por coste anual descendente ("lo que
más me cuesta al año" suele ser una sorpresa).

**Evolución histórica por gasto** (pieza que Koku considera importante,
añadida el 10/9/2026): para cada gasto fijo, cuánto ha costado cada
año.

```
Netflix
  2026    143 €    (11 meses)
  2025    120 €
  2024    108 €
```

Es de las pocas cosas que **no hay que construir desde cero**: las
transacciones generadas guardan `recurring_expense_id`, así que basta
con agrupar por año lo ya pagado. Con eso se puede decir además *"te ha
subido un 19% desde 2024"*, que es la frase que uno quiere leer.

Matices a tener en cuenta:

- Un año a medias no se compara con uno entero sin avisar (por eso el
  "(11 meses)"): o se marca, o se compara el coste medio mensual.
- Borrar una plantilla deja sus transacciones huérfanas (pone
  `recurring_expense_id = NULL`, comportamiento pedido por Koku en su
  día) — así que el histórico de un gasto borrado se pierde. Es
  aceptable, pero conviene avisarlo al borrar.
- Pausar una suscripción sin borrarla, para no perder el historial.

### 5.3 Avisos de pagos programados

Varios avisos por plantilla, con desfases a elegir: mismo día, 1/2/3
días, 1 semana, 15 días, 1/2/3 meses antes, más la hora. Con un valor
por defecto configurable, para no repetirlo en cada gasto.

**El límite que hay que respetar sí o sí**: iOS solo permite unas **64
notificaciones locales pendientes por app**, y esas 64 se comparten con
los recordatorios del calendario. Con 20 gastos fijos × 3 avisos ya son
60 y el calendario se queda mudo sin que nadie sepa por qué. Reglas que
salen de ahí:

- Programar solo un **horizonte** (los próximos 2-3 meses) y
  reprogramar al abrir la app — que es exactamente lo que ya hace
  `loadReminders()` con su "cancelar todo y rehacer".
- Un **contador visible en Configuración**: "41 de 64 avisos en uso".
- Los avisos del calendario tienen prioridad sobre los de Finanzas si
  hay que recortar.

Extra que encaja solo: notificación con acción **"Ya lo he pagado"**,
sin abrir la app.

### 5.4 Objetivos con nombre (Coche, 5.000 €)

**Sobres virtuales, no cuentas.** Un objetivo tiene nombre, icono,
color, importe meta y fecha opcional, y reserva dinero de una cuenta
que tú eliges — pero **el dinero no se mueve**:

```
Cuenta corriente
  saldo 3.200 €  ·  reservado 1.500 €  ·  disponible 1.700 €
```

Se hace así porque en la vida real todo está en la misma cuenta:
obligar a crear una cuenta por objetivo sería contabilidad falsa y
chocaría con la regla de que el saldo SIEMPRE se calcula.

Lo que lo hace útil no es la barra de progreso, es el cruce con lo que
la app ya sabe: con meta y fecha puede decir *"te faltan 3.200 € en 10
meses → 320 €/mes"* y contrastarlo con el ahorro real medio (ese
cálculo ya existe: es el del aviso de "objetivo poco realista") →
*"a tu ritmo actual llegas en marzo de 2028, no en junio"*.

Dos detalles para que no se descuadre:

- **"Gastar del objetivo"** crea el gasto real y vacía el sobre de una
  vez.
- El **objetivo mensual de ahorro que ya existe se queda**: son cosas
  distintas (uno es una regla de conducta, el otro un destino), y la
  suma de aportes mensuales a los objetivos es justo lo que dice si esa
  regla es realista.

### 5.5 Dinero de terceros

El caso real: los padres de Koku le dan una paga y le pagan la
gasolina. Quiere **seguir cuánto se deja en gasolina** sin que ese
dinero cuente como suyo en ahorros ni en gráficas.

**Decidido: un tipo de cuenta nuevo, "De terceros"**, junto a los que
ya hay (Corriente / Ahorro / Inversión / Efectivo / Otro). La paga
entra como ingreso en esa cuenta, la gasolina sale de ella, y **todo lo
de ese tipo queda fuera por defecto** de ahorro, patrimonio, límite
mensual y gráficas — con su propia pantalla y sus estadísticas
("gasolina: 80 €/mes de media").

Por qué así y no de las otras dos formas que se barajaron:

- **No como cartera**: en esta app "cartera" es un concepto de
  inversiones, y además no excluiría nada de las gráficas, que es
  precisamente lo que se busca.
- **No como marca por movimiento**: obligaría a acordarse de marcarlo
  cada vez. Con la cuenta, eliges cuenta y ya está — y de paso contesta
  gratis a *"¿cuánto me queda de la paga este mes?"*, que hoy no se
  puede saber.

Con un interruptor **"incluir dinero de terceros"** en las gráficas
para cuando se quiera ver todo junto.

El caso mixto (un gasto tuyo que te devuelven a medias) sí pediría
marca por movimiento, pero eso es otro problema — gastos compartidos —
y queda para más adelante.

---

## 6. La interfaz: inicio tipo "Salud"

El problema de fondo no son las tablas: son **cinco pestañas en una
fila** a las que hay que sumar Objetivos, Suscripciones y Previsión.
Con pestañas no escala.

**Finanzas pasa a funcionar como la app Salud**: una pantalla de inicio
que es una columna de tarjetas; cada tarjeta resume una cifra y se toca
para entrar a su pantalla completa. Añadir una sección nueva mañana =
añadir una tarjeta, no rediseñar la navegación otra vez.

- **Inicio**: cifra grande arriba (saldo total, o "te queda este mes"),
  y debajo las tarjetas — Este mes (límite + barra), Próximos pagos
  (los 3 siguientes con fecha), Objetivos, Suscripciones (X €/mes · Y
  €/año), Cuentas (fila deslizable), Inversiones, Deudas, De terceros.
  El orden de las tarjetas, configurable más adelante.
- **Dos destinos abajo en vez de cinco pestañas**: Resumen ·
  Movimientos, más el **botón flotante** para apuntar un gasto — que es
  lo que de verdad se hace veinte veces al mes desde el teléfono.
- **La gestión sale del camino diario**: cuentas, categorías, carteras
  y activos, detrás del ☰ que ya existe en la cabecera. Hoy comparten
  pestaña con los movimientos y son la mitad del ruido.

### Qué significa "Apple-ish" en concreto

No es redondear esquinas. Es esto:

- **Jerarquía por tamaño y peso, no por color**: la cifra protagonista
  enorme y el resto en gris. Color solo con intención — verde/rojo
  únicamente en el importe, el acento del tema solo en lo que se toca.
- **Listas agrupadas**: bloques redondeados, separadores finos que
  empiezan DESPUÉS del icono, no de borde a borde.
- **Fila, nunca tabla**: icono con el color de la categoría + concepto
  arriba + cuenta/fecha en gris debajo + importe a la derecha.
  Movimientos agrupados por día con el total del día en su cabecera.
- **Números tabulares** (`font-variant-numeric: tabular-nums`) para que
  los importes queden en columna perfecta. Detalle diminuto, y es justo
  lo que separa "pulcro" de "casero".
- **Título grande que encoge al hacer scroll**.
- **Hojas que suben desde abajo** con Cancelar / Guardar arriba, en vez
  de formularios con los botones al final.
- **Deslizar la fila para editar/borrar** — ya existe (`.note-swipe-wrap`
  de Notas), se reaprovecha tal cual.
- **Menos densidad**: si algo cabe justo, sobra.

### Limpieza acordada

- Las dos tablas del histórico de ahorro → listas.
- El árbol de casillas de Inversiones pegado a la gráfica → navegación
  por carteras, como las carpetas de Notas.
- Los formularios en línea de categorías → hoja.
- Los botones "+ Cuenta / + Movimiento / + Gasto fijo" sueltos encima
  de cada bloque → el botón flotante.

---

## 7. Plan de fases — TODAS HECHAS (10-11/9/2026)

Las seis tandas del plan están construidas, probadas en un navegador
real y subidas a `finanzas-movil`:

1. ✅ **Motor de previsión** (`dccbd7c`) — `/forecast` calcula las
   ocurrencias de cada plantilla sin guardar nada, con estado
   pagado / pendiente / **sin registrar** (este tercer estado salió de
   probarlo: un cobro viejo sin movimiento no está "pendiente", es que
   no consta).
2. ✅ **Pantalla de previsión** (`dccbd7c`) — "Qué queda"
   (semana/mes/año) y el año mes a mes con desglose al tocar.
3. ✅ **Suscripciones + evolución histórica** (`804fa2f`) — coste
   normalizado a mes y año, filtro por tipo, y en la ficha de cada
   gasto lo que ha costado cada año con su variación.
4. ✅ **Avisos múltiples** (`c67fb26`) — hasta cinco antelaciones por
   pago (del mismo día a tres meses) y el cupo de 64 notificaciones de
   iOS repartido, con contador visible en Configuración.
5. ✅ **Rediseño del inicio** (`daa4a7e`) — fuera las cinco pestañas,
   inicio de tarjetas tipo Salud, y Esc capa a capa.
6. ✅ **Objetivos con nombre** (`7b6dfda`) — sobres virtuales, con el
   ritmo real cruzado contra lo que de verdad ahorra.
7. ✅ **Dinero de terceros** (`dfe1d20`) — tipo de cuenta nuevo, fuera
   de ahorro, límite y gráficas, con interruptor para verlo todo junto.

### Lo que queda pendiente de la conversación

- **Probarlo en el iPhone**: nada de esto se ha visto en el móvil de
  verdad todavía. Los avisos de pago, en particular, solo se pueden
  confirmar ahí (en el navegador no hay plugin de notificaciones; se
  verificó con uno simulado).
- **El atajo de gasto rápido** (widget / pantalla de bloqueo / centro
  de control), que Koku dejó explícitamente "para otra tanda".
- **El resto del backlog** de la sección 8.

---

## 8. Backlog (hablado, no empezado)

- **Apuntar un gasto rápido desde fuera de la app** (Koku, 10/9/2026):
  atajo, widget y/o botón en la pantalla de bloqueo o el centro de
  control. Lo ideal sería poder elegir cuenta e importe ahí mismo; si
  eso resulta demasiado para un widget, que al menos **abra la app
  directamente en "añadir gasto"**. Hay terreno ganado: los widgets y
  el centro de control ya funcionan (v0.40–v0.45), incluido un widget
  de Finanzas.
- **Presupuesto por categoría** ("150 € de comida al mes") con su
  propio aviso.
- **Traspasos entre cuentas** — hoy no existen: mover dinero de
  Corriente a Ahorro obliga a inventarse un gasto y un ingreso.
- **Previsión de fin de mes**: con los gastos fijos conocidos y lo
  gastado hasta hoy, cuánto va a quedar.
- **Movimientos divididos** entre varias categorías (la compra que
  lleva comida y droguería).
- **Etiquetas libres** además de la categoría ("regalos de Navidad",
  "obras de casa").
- **Repetir un movimiento anterior** de un toque.
- **Patrimonio neto**: cuentas + inversiones − deudas y su evolución.
  Las tres piezas existen pero no se suman en ningún sitio.
- **Comparación con el mes anterior**: "vas un 12% por encima de lo
  normal en Ocio".
- **Gastos compartidos** (lo que te devuelven a medias), que es el
  caso mixto del dinero de terceros.

Descartado a propósito, no reabrir sin motivo: **APIs de cotización en
vivo** (todo manual, decisión tomada) y cualquier cosa con servicio en
la nube o cuenta de usuario (la app es local-first por diseño).

---

## 9. Reglas de trabajo que aplican en esta rama

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
