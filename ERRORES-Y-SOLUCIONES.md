# Errores encontrados y cómo se arreglaron

Lo que sale del **forzado de errores** al cerrar cada fase: se le tiran
a la herramienta casos rotos, hostiles o absurdos a propósito, y aquí se
apunta lo que de verdad falló y qué se hizo.

No están los fallos "de laboratorio" que salen mientras escribes el
código y arreglas al momento: están los que **sobrevivieron** a la
primera pasada y solo aparecieron al forzar.

---

## Fase 1 — Los dos modos de escribir (Word y Markdown)

**Qué se probó**: 51 comprobaciones del viaje HTML → Markdown → HTML
(bloque a bloque y con un documento entero), 57 casos de forzado
(Markdown roto, HTML raro, texto que *parece* sintaxis), la barra
funcionando en los dos modos, y la guía entera —contenido real, no
inventado— pasando por el mismo viaje.

### 1. Un enlace con `javascript:` se colaba en el documento · SEGURIDAD

- **Qué pasaba**: escribiendo `[pincha](javascript:alert(1))` en modo
  Markdown, el conversor generaba `<a href="javascript:alert(1)">` y lo
  metía en el documento **vivo**. El saneador del servidor lo tiraba al
  guardar, pero hasta entonces el enlace estaba ahí y se podía pulsar.
  Lo mismo con `![x](javascript:...)` para las imágenes.
- **Por qué se me pasó**: di por bueno que el saneador del backend era
  la única puerta. Pero el backend solo mira lo que se **guarda**; el
  conversor escribe directamente en la página.
- **Solución**: el conversor lleva ahora la **misma lista blanca** que
  el backend — un enlace solo sobrevive si empieza por `http://` o
  `https://` (o es un `pagina:12` interno), y una imagen solo si apunta
  a `/api/proyectos/images/…`. Lo que no encaja se queda en texto
  suelto, sin enlace.
- **Aviso**: esto toca las reglas de seguridad, así que queda dicho
  aquí y no enterrado en un commit. La regla general que deja: **todo
  sitio que escriba HTML en la página necesita su propia lista blanca**,
  aunque el backend ya tenga la suya.

### 2. Un recuadro de color se tragaba la cita que venía detrás

- **Qué pasaba**: un callout seguido de una cita
  (`> [!CONSEJO]` / `> texto` y luego `> otra cosa`) volvía como **un
  solo** recuadro con los dos textos dentro. La cita desaparecía.
- **Por qué**: el lector se comía *todas* las líneas que empezaran por
  `>` después de la cabecera del alert, y no hay forma de distinguir
  dónde acaba uno y empieza la otra.
- **Solución**: un callout es **un bloque** en esta herramienta, así que
  el lector consume **exactamente una** línea de cuerpo. Lo que venga
  después es lo que diga: otra cita, otro alert o texto.

### 3. Una lista de viñetas se comía la lista numerada de al lado

- **Qué pasaba**: `<ul>…</ul><ol>…</ol>` seguidos volvían como **una
  sola** lista de viñetas con todos los puntos dentro.
- **Por qué**: al agrupar las líneas de lista se aceptaba cualquier
  marca (`-` o `1.`) y luego se decidía el tipo mirando solo la
  primera.
- **Solución**: se agrupan solo líneas del **mismo tipo**. Dos listas
  pegadas siguen siendo dos listas.

### 4. Un `código` con comillas invertidas dentro salía partido

- **Qué pasaba**: la propia guía explica la marca `` `código` ``, o sea
  que su texto **lleva** comillas invertidas. Al convertir salía
  `` ``código`` `` y al volver se leía como dos trozos de código vacíos
  con el texto suelto en medio: `<code></code>código<code></code>`.
- **Por qué**: se usaba siempre una comilla de valla, sin mirar lo que
  había dentro.
- **Solución**: la regla de CommonMark — la valla es **una comilla más
  larga** que la racha más larga de dentro, con un espacio de respiro. Y
  el lector entiende vallas de cualquier longitud.
- **Detalle de propina**: las barras de escape **dentro** de un trozo de
  código son literales, no escapes. Se deshacen los escapes *antes* de
  devolver el código a su sitio.

### 5. Un desplegable cerrado volvía abierto

- **Qué pasaba**: `<details>` (plegado) volvía siempre como
  `<details open>`.
- **Por qué**: el estado no se guardaba en ningún sitio del texto.
- **Solución**: se apunta con un `{cerrado}` al final de la directiva
  (`::: desplegable Título {cerrado}`), que es la misma convención de
  sufijos que ya se usaba para alinear.

### 6. El bloque vacío del final de la página se perdía

- **Qué pasaba**: una página que acababa en un bloque vacío (el hueco
  donde sigues escribiendo) volvía sin él.
- **Por qué**: al convertir se recortaban las líneas en blanco del
  final, por "limpieza".
- **Solución**: no se recortan. Un bloque vacío al final es un bloque
  de verdad.

### 7. Las comillas del texto volvían como `&quot;`

- **Qué pasaba**: un texto con comillas dobles volvía escrito con
  `&quot;`. Se **ve** igual, pero el documento ya no era el mismo.
- **Por qué**: se usaba el mismo escapado para el texto y para los
  atributos.
- **Solución**: dos funciones distintas. En el **texto** solo se escapa
  lo que rompe el HTML (`&`, `<`, `>`); en un **atributo** (`src`,
  `href`) sí se escapan las comillas, o una dirección con comillas se
  saldría del atributo.

### 8. `app.js` se había vuelto "binario" para git

- **Qué pasaba**: el conversor apartaba los trozos de código con una
  marca interna que incluía el carácter **NUL**. Git y `grep` ven un NUL
  y tratan el archivo como binario: se pierden los diffs de texto.
- **Solución**: la marca pasa a ser `@@CODIGO0@@`. No se ve nunca (se
  pone y se quita dentro de la misma función) y el archivo vuelve a ser
  texto.

---

## Fase 2 — Exportar a Markdown (para GitHub)

**Qué se probó**: exportar la guía entera (7 páginas con tablas,
callouts, diagramas, una base de datos real, subpáginas y enlaces entre
ellas) y comprobar el Markdown que sale **regla por regla de GitHub**;
más 11 casos de forzado con títulos imposibles y rutas hostiles.

### 1. Las tareas salían como lista "suelta"

- **Qué pasaba**: cada tarea es un bloque propio, así que al separar los
  bloques con una línea en blanco (que es lo que hace falta para que
  GitHub no junte los párrafos) las tareas quedaban separadas entre sí.
  GitHub lo lee como una *loose list* y le mete aire de más: se ve
  desahogado y feo.
- **Solución**: entre tareas seguidas no se pone línea en blanco. El
  resto de bloques sí la llevan.

### 2. Lo que se pensó ANTES de que fuera un fallo

Estas no llegaron a romper porque se diseñaron así desde el principio,
pero son justo los sitios donde un exportador se rompe, y conviene
tenerlas escritas:

- **Un enlace a una página que no viaja** en la exportación (porque está
  fuera del proyecto, o la borraste) **se queda como texto**, no como
  enlace roto.
- **Una base de datos borrada** no deja ni rastro ni un `undefined`.
- **Las rutas se limpian dos veces**: al montar el nombre del archivo y
  otra vez en Electron, trozo a trozo. Un título como `../../fuera`
  acaba dentro de la carpeta elegida, nunca fuera. Probado a propósito
  con `../../fuera.md` y `/etc/passwd`.
- **Los nombres se numeran** (`01-`, `02-`…), así que tres páginas
  llamadas igual no se pisan.

### 3. Dos falsos fallos de la prueba (que volverán)

- **Una guía que DOCUMENTA la sintaxis rompe cualquier comprobación de
  "esto no debe aparecer".** La prueba miraba que no quedaran `{centro}`,
  `__subrayado__` ni `[!CONSEJO]` en el resultado… y la guía los explica,
  dentro de trozos de código. Hay que **quitar el código antes de
  comprobar la prosa**.
- Y al revés: la comprobación de "los diagramas siguen ahí" tiene que
  mirar el texto **con** el código, no el limpiado.

---

## Fase 3 — Índice, subpáginas y ver el proyecto entero

**Qué se probó**: los dos bloques nuevos (que se mantienen solos), la
vista del proyecto entero con sus cuatro combinaciones de interruptores,
y 7 casos de forzado.

### 1. Una página borrada tumbaba la exportación entera · de la Fase 2

- **Qué pasaba**: el exportador pedía cada página por su id sin red de
  seguridad. Si una había desaparecido entre que se listó y que se pidió
  (la borraste en otra ventana, o la lista estaba vieja), saltaba un 404
  y **se caía la exportación completa** — no un aviso, nada: ni un
  archivo escrito.
- **Por qué se me pasó**: el exportador se probó con proyectos que
  existían enteros de principio a fin. Es el clásico "esto no puede
  pasar" que sí pasa.
- **Solución**: las páginas se piden ANTES de decidir nada, y la que no
  conteste se queda fuera del todo (tampoco en el índice, para que no
  quede un enlace a un archivo que no se escribió). El resto se exporta
  igual.

### 2. El interruptor nuevo mató el resto del programa · TDZ

- **Qué pasaba**: al conectar el interruptor Página/Proyecto, la app
  dejó de funcionar del todo — cualquier cosa daba
  `Cannot access 'proyectosPeekOpen' before initialization`, que no
  tiene nada que ver.
- **Por qué**: el interruptor se engancha **al cargar** y leía una
  variable declarada **más abajo** en el archivo. Eso lanza (zona muerta
  temporal) y se lleva por delante TODO lo que venía después, así que
  medio programa se quedó sin existir. El error que se ve señala a la
  primera víctima, no al culpable.
- **Solución**: la variable se declara arriba del todo, junto a las
  otras del mismo grupo, con un comentario que dice por qué está ahí.
- **Esto ya estaba avisado en CLAUDE.md** desde hace meses y volvió a
  morder. La regla, otra vez: **lo que se ejecuta al cargar solo puede
  leer lo que ya está declarado más arriba.**

### 3. Decisiones de diseño que evitaron problemas

- **Los bloques vivos guardan solo el marcador vacío.** Si se guardara
  lo pintado, el índice se quedaría congelado y mentiría en cuanto
  cambiaras un título. Se rehace al abrir la página, y al escribir (con
  0,7 s de retraso, para no rehacerlo en cada tecla).
- **La vista del proyecto entero es de LECTURA.** Editar ahí obligaría a
  adivinar a qué página pertenece cada cambio. Se comprobó a propósito
  que escribir en esa vista no toca nada de lo guardado.
- **Los bloques vivos se quitan dentro de la vista de proyecto**: el
  índice de cada página sobra cuando ya hay uno arriba, y las subpáginas
  vienen justo debajo.

---

## Fase 4 — Varios paneles a la vez (y los modos con nombre nuevo)

**Qué se probó**: abrir, cambiar, intercambiar y cerrar paneles, que
convivan con las otras vistas, y 28 casos de forzado (localStorage
envenenado, páginas borradas debajo, títulos absurdos, repintados
pisándose).

### 1. El botón de la barra se quedó SIN listener · fallo mío al sustituir

- **Qué pasaba**: pulsar el botón de abrir un panel no hacía nada. Ni un
  error, ni un aviso: nada.
- **Por qué**: el panel único de antes se quitó como un bloque seguido, y
  dentro de ese bloque vivía también el `addEventListener` del botón de
  la cinta. Al pegar el módulo nuevo en su sitio, el botón se quedó
  huérfano. El resto (el selector, los paneles) funcionaba perfectamente
  si se llamaba a mano — que es justo lo que despista.
- **Solución**: el listener va ahora **pegado a la función que llama**,
  dentro del mismo bloque de los paneles. Así el día que esto se
  sustituya otra vez, se va entero y no queda medio.
- **Lección**: cuando se quita un bloque de código "de arriba abajo", hay
  que mirar qué LISTENERS se van con él. Una prueba que llame a la
  función directamente no lo detecta nunca: hay que **pulsar el botón de
  verdad**, que es lo que acabó pillándolo.

### 2. Tres paneles dejaban el editor en 160 px · lo pilló la regla, no el ojo

- **Qué pasaba**: con los tres paneles abiertos, el editor se quedaba en
  160 píxeles de ancho. No estaba roto — estaba inservible.
- **Por qué**: cada panel tenía un ancho mínimo y ninguno cedía, así que
  el editor (que sí podía encogerse hasta cero) pagaba la factura entera.
- **Solución**: quien tiene el ancho garantizado es **el editor**, que es
  donde se escribe. La franja de paneles se encoge y, si sus tres mínimos
  no caben, **se desplaza de lado por dentro**. Mejor una franja con
  scroll que un editor de un dedo de ancho.
- **Cómo salió**: la prueba MIDE el ancho de verdad
  (`getBoundingClientRect`), no comprueba si el panel "está". Es la misma
  lección de las filas deslizables: mirar la clase no vale, hay que medir.

### 3. Un id con decimales dejaba un panel muerto para siempre · forzado

- **Qué pasaba**: metiendo `{"ref": 1.7}` en lo guardado, el panel se
  quedaba diciendo "esto ya no existe" aunque la página 1 estuviera ahí,
  y no había forma de recuperarlo salvo cerrarlo.
- **Por qué**: se validaba con `Number.isFinite()`, y **1,7 es finito**.
  Luego `pagina.id === 1.7` no encaja con nada.
- **Solución**: un id es un **entero positivo** o no es un id
  (`Number.isInteger` y `> 0`). De paso caen el 0 y los negativos.
- Esto no lo produce el uso normal; sale de que el estado vive en el
  navegador y ahí puede llegar cualquier cosa (una versión vieja, una
  copia de seguridad, un dedo). Validar en la PUERTA lo arregla para
  todos los que leen ese estado — mismo criterio que el cronómetro suelto
  del Gimnasio.

### 4. Decisiones de diseño que evitaron problemas

- **Solo hay UN editor; los paneles son de lectura.** Tres editores vivos
  querrían tres cursores, tres guardados y una regla para decidir a cuál
  obedece el teclado. El botón **⇄** cubre lo que de verdad se quiere:
  traer al editor lo que estás mirando.
- **Un panel con la página borrada NO se cierra solo.** Se queda diciendo
  qué pasó. Que un panel desaparezca de la pantalla por su cuenta se lee
  como un fallo de la app, no como "esa página ya no está".
- **Un enlace dentro de un panel se abre EN ESE PANEL**, no en el editor:
  el panel es donde estás mirando algo, y saltar en el editor te sacaría
  de lo que estabas escribiendo.
- **Los diagramas de dos paneles con la misma página no chocan**: cada
  render lleva su número. Se comprobó a propósito que no queda basura
  suelta en el documento, que es el fallo típico de Mermaid.

---

## Cosas que NO eran errores, y conviene tener apuntadas

Dos "fallos" que salieron rojos y resultaron ser de la prueba, no del
programa. Vale la pena dejarlos escritos porque volverán:

- **Comparar HTML a pelo da falsos fallos.** El HTML de la guía está
  escrito a mano y lleva un `>` crudo dentro de un diagrama; el
  navegador, al escribir HTML, lo pone como `&gt;`. Son el mismo
  documento. La comparación buena es **normalizando los dos lados por el
  navegador** antes de compararlos.
- **El modo elegido se recuerda en `localStorage`, que NO vive en la
  carpeta de datos de la prueba.** Una prueba que acabe en modo Markdown
  deja la siguiente arrancando en Markdown. Las pruebas ahora fijan el
  modo a mano antes de empezar, en vez de dar por hecho el de fábrica.

---

## Lo que el forzado dejó claro que aguanta

Por si sirve de tranquilidad, esto se probó y **no** rompió nada: texto
que parece sintaxis (`# `, `- `, `> `, `|`, `:::`, `*`, `_`, `{`, `[`)
escrito a propósito para engañar al lector; vallas de código sin cerrar;
desplegables sin cerrar; directivas inventadas; tablas con filas
desiguales; identificadores de base de datos absurdos; títulos de nueve
almohadillas; líneas de 5.000 caracteres; documentos de 2.000 líneas;
caracteres de control; HTML con `<script>` y `onerror`; pulsar los ~30
botones de la barra seguidos sin cursor puesto; y ocho cambios de modo
seguidos.
