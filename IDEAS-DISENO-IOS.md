# Cómo se ve hoy la app, y qué le falta para que alguien diga "esto es de Apple"

Estudio del 10/9/2026, rama `desarrollador`, v0.47.0. Hecho **abriendo
la app y mirándola** (capturas a 390×844, que es un iPhone normal), y
midiendo el CSS. Los números que salen aquí son reales, no impresiones.

Esto es un documento de trabajo, como `IDEAS-AYUDAS.md`: **nada de lo
que hay aquí está hecho**. Es para que marques qué quieres.

---

## La opinión honesta, primero

La app **no se ve mal**. Es coherente, tiene un sistema de temas serio,
respeta el área segura, tiene gestos, animaciones y modo claro/oscuro
emparejado. Eso ya es más de lo que tienen muchas apps publicadas.

Pero **no se ve como una app de Apple**, y creo que puedo decir con
bastante precisión por qué. No es por falta de pulido: es que la app
está construida con el vocabulario visual de **una página web**, no con
el de iOS. Se nota en cuatro cosas concretas, y de ellas **una explica
la mitad del efecto**.

### 1. Todo el texto es demasiado pequeño (esto es lo gordo)

Medido: el CSS tiene **24 tamaños de letra distintos**. El más usado,
con diferencia, es `0.85rem` — o sea **13,6 px**. Y el segundo y el
tercero son `0.82rem` y `0.78rem`.

En iOS, el cuerpo de texto estándar es **17 px**. 13,6 px es el tamaño
de un *pie de foto*.

Es decir: **la app entera está escrita en tamaño de nota al pie.** Ese
es, en mi opinión, el motivo número uno de que no "sepa" a Apple. Las
apps de Apple son grandes, aireadas y de mucho contraste; caben menos
cosas en pantalla a propósito, porque se leen de un vistazo y con el
móvil en movimiento. Esta app mete mucha información en poco sitio, que
es un reflejo de web de escritorio.

Y encima 24 tamaños significa que no hay escala: cada pantalla eligió el
suyo a ojo. iOS tiene once tamaños con nombre y **todo** sale de ahí.

**Lo que yo haría** (y es el cambio con más impacto visual de toda la
lista, sin tocar la estructura de nada):

```css
:root {
  --t-titulo-grande: 34px;  /* "Gimnasio", "Septiembre"   */
  --t-titulo:        22px;  /* cabeceras de pantalla       */
  --t-encabezado:    17px;  /* semibold: títulos de fila   */
  --t-cuerpo:        17px;  /* TEXTO NORMAL                */
  --t-secundario:    15px;  /* apoyo                       */
  --t-pie:           13px;  /* de verdad secundario        */
}
```

Y sustituir los 24 valores por estos seis. Es trabajo mecánico y
aburrido, pero es **el que más se nota**.

Aviso honesto: al subir el cuerpo de 13,6 a 17 px, **algunas pantallas
se van a quedar cortas de sitio** y habrá que decidir qué se cae. Eso no
es un efecto secundario: es exactamente la disciplina que hace que una
app parezca de Apple.

### 2. No hay ni una superficie translúcida

Medido: `backdrop-filter` aparece **cero veces** en 4.954 líneas de CSS.

El lenguaje visual de iOS desde hace diez años son **capas
translúcidas**: la barra de pestañas deja ver el contenido por debajo,
las cabeceras se difuminan al hacer scroll, las hojas modales dejan ver
la pantalla de atrás. Es lo que da la sensación de profundidad.

Aquí todo es opaco: cada capa tapa la de abajo del todo. Se ve limpio,
pero se ve **plano**, y sobre todo se ve *web*.

Tres sitios donde esto cambia mucho por muy poco código:

```css
.mobile-nav {                       /* la barra de abajo */
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
}
.my-space-view-header { /* igual, y que el contenido pase por debajo */ }
.modal { backdrop-filter: blur(20px); }
```

### 3. Dos formas distintas de decir "esto está elegido", en la misma pantalla

Esto lo vi en la captura de **Gimnasio → Progreso** y es el detalle que
más "hecho a trozos" hace ver la app:

- Las pestañas (`Entrenar / Plan / Progreso / Logros`) marcan la activa
  **rellenándola de azul**.
- Justo debajo, `7 días / 30 días / 90 días` y `Series / Volumen` marcan
  la activa con **borde de 2 px y un fondo azul al 18 %**.

Las dos son lo mismo: "elige una de estas". En iOS eso es **un solo
componente**, el segmented control: una pastilla gris con la opción
elegida en blanco encima. Uno, siempre igual, en toda la app.

Además, el borde de 2 px del segundo caso **cambia el ancho del botón al
seleccionarlo**, así que la fila da un saltito. Se ve en la captura: los
botones no están alineados entre sí.

**Lo que haría**: un único `.segmentado` y que lo usen los dos sitios (y
los `.view-mode-btn` de Configuración, y las pestañas de Finanzas y
Viajes). Un componente en vez de tres.

### 4. Botones de web por todas partes

En la pantalla del calendario, abajo, hay dos botones con borde
redondeado enormes: **"Hoy"** y **"Grupos"**, uno al lado del otro,
ocupando todo el ancho. En iOS eso **no existe**. Las acciones
secundarias son texto azul sin caja; el relleno sólido se reserva para
**la** acción principal de la pantalla, y suele haber una sola.

Lo mismo con `+ Nuevo bloque`, `+ Apuntar sesión a mano`, `Actividad
rápida`, `Librería de ejercicios`, `+ Nuevo ejercicio`... En la pestaña
Plan hay **cinco botones con caja** antes de llegar a ningún contenido.

Regla que yo aplicaría: **una pantalla, un botón relleno**. El resto:
texto de acento, o un `+` en la cabecera (que es donde iOS lo pone), o
dentro del gesto de deslizar que ya tienes montado por todas partes.

---

## Cosas concretas que arreglaría, medidas

### Contraste: el botón principal no llega al mínimo

Medido sobre el tema Predeterminado: texto blanco sobre `#5b8cff` da
**3,16:1**, con letra de 16 px. El mínimo de accesibilidad (WCAG AA)
para texto normal es **4,5:1**. **No pasa.**

Es el botón más importante de la app y el color de acento de fábrica.
Con sol en la calle se lee regular de verdad.

Dos salidas: oscurecer el azul de fábrica hasta ~`#3f6fd8` (llega a
4,6:1 con blanco), o poner el texto del botón en un tono muy oscuro en
vez de blanco. `sanitizeColors` ya tiene la fórmula WCAG dentro, así que
esto se puede comprobar sin salir del proyecto.

### No hay escala de espaciado

Medido: **92 valores distintos de `padding`** y **14 de `gap`**. Cada
componente eligió el suyo. iOS usa múltiplos de 4 y casi siempre los
mismos: 8 / 12 / 16 / 20.

Con seis variables (`--e1: 4px` … `--e6: 32px`) y sustituir, las
pantallas empiezan a "rimar" entre ellas sin que sepas explicar por qué.

### La pestaña activa de la barra de abajo se pinta como un botón

En la captura de Herramientas, la pestaña activa tiene **un rectángulo
azul de fondo**. Las barras de pestañas de iOS **nunca** rellenan: solo
tiñen el icono y la etiqueta del color de acento. Ese rectángulo es lo
primero que delata que no es una app nativa.

### Los fines de semana parecen días seleccionados

En el calendario, sábados y domingos llevan un **círculo relleno oscuro**
de fondo. Justo al lado, el día de hoy es un **círculo relleno azul**.
Los dos son círculos rellenos, así que el ojo los lee como "estos días
están marcados". En la captura, el día 5, 6, 12, 13, 19, 20... parecen
seleccionados.

En iOS el fin de semana no se distingue en la rejilla del mes. Si lo
quieres marcar, con poner el **número** en gris ya se entiende, sin
competir con el indicador de hoy.

### El mes está vacío y no se ven los eventos

En la captura del calendario en modo "Compacto" con tres eventos creados
hoy, **la rejilla no muestra ni un punto**. Las filas del mes son
enormes y están completamente vacías, y aun así hay que ir día a día
para saber dónde hay algo.

Es el uso menos rentable de la pantalla en toda la app: seis filas de
~200 px que solo llevan un número. Con esas alturas caben perfectamente
uno o dos puntitos de color (que es justo lo que ya calcula el widget
nuevo del calendario, `seccionCalendario()` — la lógica ya está escrita).

### Cuatro erratas visibles

Estas son de arreglar y ya, no hay nada que decidir:

| Sitio | Dice | Debería decir |
|---|---|---|
| `index.html:620` | Peso **maximo** | Peso **máximo** |
| `index.html:1272` | + **Anadir** ejercicio | + **Añadir** ejercicio |
| `index.html:1291` | Nueva **sesion** | Nueva **sesión** |
| `index.html:1303` | + **Anadir** ejercicio | + **Añadir** ejercicio |

(El resto de textos visibles se revisaron con un guion; solo hay estos
cuatro.)

---

## Gimnasio: sí, está sobrecargado — pero no donde parece

Preguntabas si Gimnasio está sobrecargado "tratando de que cumpla todo".
**Sí, pero el problema no es la app de Gimnasio: es la pestaña
Progreso.**

Entrenar, Plan y Logros están bien de carga. Progreso tiene esto, todo
seguido en un mismo scroll:

1. Consistencia (4 tarjetas de cifras)
2. Mapa de calor de 26 semanas
3. **Objetivo semanal** ← esto es un ajuste
4. **Peso extra de una serie al fallo** ← esto también
5. Mapa de músculos (+ 2 filas de botones: 7/30/90 días, Series/Volumen)
6. Récords (PRs)
7. Volumen semanal por músculo
8. Evolución por ejercicio (+ selector + 2 botones más)

Ocho bloques y **cinco grupos de controles** en una pantalla. Y lo que
más me chirría: **los puntos 3 y 4 son ajustes viviendo dentro de una
pantalla de datos**. "Peso extra de una serie al fallo" es una
preferencia que tocas una vez en la vida, y está ocupando sitio fijo
entre dos gráficas, cada vez que entras a ver cómo vas.

Lo que haría, sin quitar ninguna funcionalidad:

- **Mover 3 y 4 a los ajustes del Gimnasio** (el ☰ que ya existe en la
  cabecera). Ahí es donde los buscarías.
- **Juntar las dos filas de botones del mapa** en un solo segmentado
  (ver el punto 3 de arriba).
- Y ya que estamos: **el aviso "Sobre el mapa de músculos" se abre solo
  como modal a pantalla completa cada vez que entras**, hasta que marcas
  la casilla. Interrumpir con un modal una pantalla de consulta es muy
  poco iOS. Lo natural es dejar el "?" que ya está al lado del título y
  quitar la apertura automática.

Con esos tres cambios Progreso baja de 8 bloques a 6 y de 5 grupos de
controles a 3, **sin perder nada**.

---

## Tu idea de la navegación de Gimnasio: estoy de acuerdo

Lo que propones —entras en Gimnasio y ves las cuatro opciones en una
lista, y mañana si hay una quinta solo se añade a la lista— **es la
decisión correcta**, y además tienes tres razones a favor más allá del
gusto:

**1. La barra de pestañas de arriba tiene un presupuesto fijo y ya casi
está lleno.** Cuatro pestañas entran; a la quinta empiezan a apretarse y
a la sexta hay que hacer scroll horizontal o partir palabras. Una lista
no tiene ese techo. Es literalmente el problema que describes: "no ver
cómo lo integramos a la vista actual sin que se rompa".

**2. Ya tienes ese patrón funcionando y es la pantalla que mejor se ve
de la app.** El hub de Herramientas es exactamente esto, y es la captura
más limpia que he sacado. Y la pestaña Plan ya hace drill-down
(Bloques → Días) sin que chirríe.

**3. Es lo que hace iOS.** Ajustes, Salud y Fitness son todos
menú → detalle → botón de volver. Y tú ya tienes el gesto: `VOLVER_UN_PASO`
del módulo de gestos hace que salir de un nivel sea deslizar, no buscar
un botón. La navegación por capas te sale casi gratis porque ya está
construida.

**La única pega, y cómo la quitaría.** Una lista mete **un toque de más**
para llegar a "Entrenar", que es el 90 % de las veces que abres
Gimnasio. Sería un paso atrás de usabilidad a cambio de un paso adelante
de estética, y eso no compensa.

La solución es no meter "Entrenar" en la lista. La pantalla de Gimnasio
quedaría así:

```
┌─────────────────────────────┐
│  Gimnasio               ☰   │
├─────────────────────────────┤
│                             │
│   ┌───────────────────────┐ │
│   │  Empezar entrenamiento│ │  ← acción principal, un toque
│   └───────────────────────┘ │     (o "Continuar" si hay uno a medias)
│                             │
│   Hoy toca: Empuje · día 1  │  ← lo que ya calcula gymCicloDeHoy()
│                             │
│  ─────────────────────────  │
│   Plan                   ›  │
│   Progreso               ›  │
│   Logros                 ›  │
│   Historial              ›  │  ← esto hoy vive dentro de "Entrenar"
│  ─────────────────────────  │
└─────────────────────────────┘
```

Así:
- **Entrenar deja de ser una pestaña y pasa a ser el botón**, que es lo
  que de verdad es. Sigue a un toque, o a cero si vienes del widget.
- El **historial** sale de debajo del botón de entrenar, donde hoy está
  medio escondido, y pasa a tener su sitio.
- La lista queda con tres o cuatro entradas y **crece sin romperse**:
  añadir "Medidas corporales" o "Nutrición" el día de mañana es una
  línea más, exactamente lo que quieres.
- Y esa lista con `›` es **el componente de iOS por excelencia** (la
  lista agrupada de Ajustes). Es la pieza que más "apple" da por unidad
  de esfuerzo.

Si esto te convence, el mismo patrón sirve luego para Finanzas y Viajes,
que también tienen barra de sub-pestañas.

---

## Por dónde empezaría, si me lo preguntas

Ordenado por **cuánto se nota dividido por cuánto cuesta**:

| # | Qué | Se nota | Cuesta |
|---|---|---|---|
| 1 | Escala de 6 tamaños de letra, cuerpo a 17 px | ★★★★★ | alto (mecánico) |
| 2 | Menú de Gimnasio en lista + botón grande de entrenar | ★★★★☆ | medio |
| 3 | Un solo componente segmentado para todo | ★★★★☆ | medio |
| 4 | Translucidez en barra de abajo, cabeceras y modales | ★★★★☆ | bajo |
| 5 | Quitar el relleno de la pestaña activa de la barra | ★★★☆☆ | mínimo |
| 6 | Sacar los 2 ajustes de Progreso al ☰, y no abrir el modal solo | ★★★☆☆ | bajo |
| 7 | Escala de espaciado de 6 valores | ★★★☆☆ | alto (mecánico) |
| 8 | Arreglar el contraste del acento de fábrica | ★★☆☆☆ | mínimo |
| 9 | Puntos de color en la rejilla del mes | ★★★☆☆ | bajo |
| 10 | Fines de semana sin círculo relleno | ★★☆☆☆ | mínimo |
| 11 | Las cuatro erratas | ★☆☆☆☆ | mínimo |

**Mi recomendación**: 4, 5, 6, 8, 10 y 11 son una sola ronda corta y ya
se nota bastante. El 1 y el 2 son los que de verdad cambian la
percepción, y cada uno merece su ronda propia — sobre todo el 1, porque
va a obligar a decidir qué se cae de cada pantalla.

Ninguno de estos toca la lógica: son CSS, y en el caso del 2, mover
paneles que ya existen.
