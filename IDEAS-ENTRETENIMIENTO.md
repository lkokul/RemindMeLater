# Ideario de Entretenimiento — lo que se puede robar de Mistbook

Documento de trabajo, no documentación de usuario. Sale de una petición
de Koku: *"mirar aplicación de Mistbook, mirar qué tiene y tratar de
extrapolarlo a nuestra app y a otras cosas, no sólo libros. Lo de poner
portadas me mola"*.

Nada de aquí está empezado. Es material para decidir.

---

## 1. Qué es Mistbook

App de seguimiento de **libros** (iPhone/iPad/Mac/Watch/Vision, gratis
con suscripción "EPIC", de Marc Canet, en español e inglés). Su lema lo
resume: *"tus libros, en una vitrina"*. Lo que tiene:

- **Biblioteca**: añadir por búsqueda, por escaneo de ISBN o a mano.
  Estados leyendo / quiero leer / terminado / abandonado. Listas
  propias y filtros por género, *trope*, saga, formato, duración y nota.
  Importa de Goodreads, StoryGraph, Bookmory y Babelio.
- **Progreso**: por página o por porcentaje, con **cronómetro de
  sesión**. Rachas diarias, objetivo anual, relecturas como experiencias
  aparte. Widget y pantalla de bloqueo con lo que estás leyendo.
- **Estadísticas**: mes, año e histórico. Autor/género/*trope* favorito,
  ritmo de lectura, calendario y mapa de actividad, **cuánto te has
  gastado en libros**, y un *Wrap Up* mensual/anual para compartir.
- **Valoración por categorías**: además de las estrellas, puntúas
  romance, *spice*, lágrimas, acción, giros de guion, construcción de
  mundo.
- **Contenido propio**: reseñas, citas, notas, personajes, lugares,
  fotos, spoilers, y sacar el texto de una página con la cámara.
- **Personalización**: portada, lomo y canto a medida; estanterías con
  plantas, velas, luces y temas por estaciones y "mundos".
- **Juego**: bingos de lectura, retos, logros, pegatinas, *tier lists*,
  ranking de personajes y parejas, y un botón de libro al azar.
- **Social**: perfil, seguir gente, listas colaborativas, *buddy reads*
  con progreso sincronizado y chat, y mensajes con retardo tipo carta.

---

## 2. El filtro: tres muros

Antes de copiar nada, lo que **no** se puede traer. No son pegas de
diseño, son las tres decisiones de fondo de nuestra app.

### Muro 1 — Nada social, y no es negociable

Perfiles, seguir, listas colaborativas, *buddy reads* con chat: todo eso
necesita un servidor y una cuenta. Nuestra app **no tiene ninguna de las
dos cosas** a propósito, ni siquiera sincronización entre tus propios
aparatos (para eso está la copia de seguridad). Esto es ~30% de
Mistbook y se queda fuera entero.

### Muro 2 — La app no hace ni una petición de red

Ronda de seguridad del 10/9/2026: cero peticiones, cero CDN, hay una CSP
en `index.html` y `tools/comprobar-widgets.py` falla si aparece una.
Se quitaron hasta los Google Fonts.

Eso tumba **buscar un libro y que baje su portada y su ficha**, que es
justo por donde se empieza en Mistbook. Es el punto que más roza con lo
que a Koku le gusta, así que tiene sección propia (§4.1) con las tres
salidas posibles.

### Muro 3 — La vitrina decorada choca con el estilo de la app

Las estanterías con velas, plantas y pegatinas son el alma de Mistbook,
pero son lo contrario de donde llevamos la app: `IDEAS-DISENO-IOS.md`,
ocho tokens de tipografía, la escala de iOS, sin sombras decorativas.

**No digo que no se haga** — es la app de Koku y una vitrina bonita es
una razón legítima para abrir una app. Pero es un cambio de rumbo
declarado, no un detalle, y por la regla de "avisar cuando algo se sale
del guion" toca decirlo antes y no después.

Hay un término medio que creo que da el 80% del gusto sin romper nada:
**una rejilla de portadas de verdad, limpia, sin decorado**. Las
carátulas ya ponen el color y la personalidad; los muebles no hacen
falta.

---

## 3. La generalización: de libros a todo

Esto es lo que pidió Koku ("no sólo libros"), y es donde nuestra app
puede ser **mejor** que Mistbook, no solo distinta.

Mistbook da por hecho que todo es un libro: páginas, ISBN, autor,
formato tapa dura / ebook / audio. Nosotros ya tenemos `type` con diez
valores y **la lista está abierta** (se le quitó el `CHECK` a la columna
justo para esto). La clave es que **cada tipo habla su idioma**:

| Tipo | Progreso | Formato | Se puntúa por... |
|---|---|---|---|
| Libro | páginas, capítulos | papel, digital, audio | historia, personajes, ritmo |
| Manga / Cómic | tomos, capítulos | papel, digital | dibujo, historia, acción |
| Serie / Anime | episodios, temporadas | plataforma, emisión | guion, actuación, banda sonora |
| Película | minutos (o nada) | cine, casa | guion, dirección, efectos |
| Videojuego | horas, % completado | consola, PC | jugabilidad, historia, dificultad |
| Podcast / Música | episodios, escuchas | — | — |

Tres cosas que salen de ahí:

1. **`progress_unit` ya existe** y es texto libre — el motor está hecho,
   lo que falta es proponer la unidad buena según el tipo en vez de
   dejar el campo vacío.
2. **Las categorías de valoración van POR TIPO.** Mistbook las tiene
   fijas (romance, *spice*...) porque todo son novelas; nosotros no
   podemos, y eso nos obliga a hacerlo bien: un juego no se juzga como
   un libro.
3. **Nuestras sagas ya ganan.** En Mistbook una saga es una serie de
   libros; aquí una saga agrupa **el manga Y el anime Y las películas**
   de la misma obra. Eso Mistbook no puede hacerlo, y es la pieza más
   fuerte que ya tenemos construida.

---

## 4. Lo que sí se puede traer

Ordenado por "mucho efecto, poco coste" primero.

### 4.1 Portadas y vitrina ← lo que le gusta a Koku

La columna `cover` **ya está en la base y la API ya la acepta y valida**
(ronda anterior); lo que no hay es interfaz. O sea que la mitad fea está
hecha.

Los bytes irían al almacén `noteAssets` de IndexedDB, como las imágenes
de las notas y las fotos de los viajes — **nunca dentro de la base
SQLite**, que la inflaría y haría lento cada volcado.

**De dónde sale la imagen: tres caminos, y hay que elegir.**

1. **De tu galería o tu cámara** (foto de la portada real). Es el único
   que funciona hoy tal cual, sin tocar nada de seguridad, y tiene un
   encanto propio: sale TU ejemplar, con su desgaste. Precio: pereza —
   cincuenta items son cincuenta fotos.
2. **De internet** (Open Library para libros, TMDB para cine y series,
   IGDB para juegos). Es lo que hace Mistbook y se ve genial. **Rompe el
   muro 2**: habría que abrir la CSP, y cada búsqueda le cuenta a un
   tercero qué estás leyendo o viendo. Además obliga a declarar
   recogida de datos en las fichas de privacidad de las dos tiendas.
   **Esto es exactamente lo que la regla de CLAUDE.md manda avisar, así
   que no se hace sin un sí explícito.**
3. **Portada generada**, sin imagen: una tarjeta con el color del tipo,
   el título compuesto con la tipografía de la app y el icono del tipo.
   Cero coste, cero red, y hace que la vitrina **se vea llena desde el
   primer día** aunque no hayas puesto ni una foto.

Mi recomendación: **3 como base y 1 como mejora**. La 3 es la que
resuelve el problema de verdad — que una app de fichas vacías parece
rota — y la 1 se puede ir haciendo poco a poco con lo que te importe. La
2 solo si Koku decide que el estilo vale el precio, y sabiendo cuál es.

### 4.2 Sesiones: el cronómetro de leer/ver/jugar

El cronómetro de sesión de Mistbook es lo que alimenta TODAS sus
estadísticas: sin sesiones no hay racha, ni ritmo, ni calendario.

**Ya tenemos ese motor entero en el Gimnasio**: `gym_sessions` con
`started_at` y `duration_seconds`, tiempos siempre calculados desde
marcas de tiempo (porque iOS congela el JavaScript de fondo), y el
estado guardado en `localStorage` para que sobreviva a recargas. Una
tabla `entretenimiento_sesiones` sería el mismo patrón: qué item,
cuándo, cuánto, y de qué unidad a qué unidad (de la página 30 a la 55,
del episodio 3 al 5).

Es la pieza **más cara** de esta lista y la que más desbloquea. Todo lo
de §4.3 depende de ella.

### 4.3 Estadísticas

En cuanto haya sesiones, esto es casi copiar y pegar del Gimnasio:

- **Mapa de actividad** de 26 semanas: `gymRenderHeatmap` ya lo pinta, y
  el widget ya sabe mandarlo como texto de 7×26 caracteres.
- **Racha** y objetivo semanal: hecho, con semanas ISO.
- **Logros**: `GYM_ACHIEVEMENTS` se calcula AL VUELO desde el resumen,
  sin guardar nada en la base (solo una marca en `localStorage` para
  celebrarlos una vez). El patrón se copia tal cual.
- **Resumen del año** (el *Wrap Up*): se comparte por la hoja del
  sistema, que `backup.js` ya sabe usar.

### 4.4 Reseñas y citas → enlazar con Notas, no rehacerlas

Mistbook guarda reseñas, citas, personajes y lugares. Nosotros ya
tenemos un **editor de notas con formato, tablas, imágenes y fórmulas**,
con carpetas, favoritos y búsqueda.

Rehacer un editorcito dentro de Entretenimiento sería absurdo. Lo
sensato es **una columna `note_id`** en el item: "abrir la reseña" lleva
a la nota, y la nota es tan rica como cualquier otra. Ahí caben las
citas, los personajes y lo que sea, sin inventar tablas nuevas.

### 4.5 Cuánto te gastas → enlazar con Finanzas

Mistbook cuenta el dinero gastado en libros. Nosotros tenemos **Finanzas
entero**, y el patrón de enlazar ya existe: `viajes_entry_movements`
liga un gasto de un viaje a una transacción REAL de Finanzas.

Copiando eso, un tomo o un juego puede llevar su gasto de verdad
colgado, y sale gratis: "me he gastado 240 € en manga este año" sin
apuntar nada dos veces. Es una síntesis que Mistbook no puede hacer
porque solo es una app de libros.

### 4.6 El calendario — lo que Mistbook NO puede hacer

Aquí está, para mí, la mejor idea de todas, y no es de Mistbook: **es
que Mistbook no es una app de calendario y nosotros sí**.

Un estreno de temporada, la salida de un tomo, el lanzamiento de un
juego: eso son FECHAS, y nuestra app ya sabe pintarlas, avisarlas con
antelación (hasta dos semanas) y enseñarlas en un widget. Un item de
Entretenimiento con fecha de estreno debería aparecer en el calendario
como cualquier otra cosa.

Ninguna app de seguimiento de libros puede hacer esto. Nosotros casi lo
tenemos hecho.

### 4.7 Valoración por categorías

Hoy hay una nota de 0 a 10. Mistbook puntúa por aspectos, y eso es
mucho más interesante para recordar por qué algo te gustó.

La forma barata, sin tablas nuevas: **la misma solución que los
géneros** — una columna JSON de texto libre (`{"guion": 8, "dibujo":
9}`), con las categorías sugeridas según el tipo. Mismo criterio que ya
usa el proyecto para `themes.colors` y para `genres`, no hace falta
normalizar nada para una colección personal.

### 4.8 Lo pequeño y divertido

Todo esto es local, barato y da vida:

- **"¿Qué veo hoy?"**: un botón que elige al azar entre tus pendientes.
  Es literalmente cuatro líneas y resuelve un problema real.
- **Tier list** y rankings: colocar tus items en filas S/A/B/C.
- **Retos y bingo**: "lee 3 clásicos", "termina 2 juegos empezados".
- **Relecturas como experiencias aparte**: volver a ver algo no es
  editar la ficha vieja, es una vuelta nueva con su propia nota. Encaja
  solo si hay sesiones (§4.2).
- **Filtros que ya casi están**: por género y nota existen; faltarían
  formato y duración.

### 4.9 Importar

Lo de Goodreads es un **CSV**, así que se puede leer del archivo, sin
red. El importador de la copia de seguridad ya sabe abrir un archivo del
sistema y validarlo antes de tocar nada. Es trabajo mecánico, no de
diseño, y solo merece la pena si Koku viene de alguna de esas apps.

---

## 5. Lo que ya existe y se reutiliza

Resumen de por qué casi nada de esto es empezar de cero:

| Para... | Ya existe | Dónde |
|---|---|---|
| Portadas | almacén de imágenes + `cover` en la base | `noteAssets`, `resolveAssetUrl()` |
| Sesiones con cronómetro | el entreno en vivo entero | `gym_sessions`, `localStorage` |
| Mapa de actividad y racha | heatmap de 26 semanas | `gymRenderHeatmap` |
| Logros | calculados al vuelo, sin tablas | `GYM_ACHIEVEMENTS` |
| Reseñas y citas | editor de notas con formato | `note-editor-view` |
| Gasto real | enlace a una transacción | `viajes_entry_movements` |
| Fechas y avisos | calendario y recordatorios | `events`, hasta 2 semanas antes |
| Compartir el resumen | hoja del sistema | `backup.js` |
| Widget | ya hay uno de Entretenimiento | `WidgetsDeLaApp.swift` |
| Fichas deslizables | editar/borrar deslizando | `wrapRowWithSwipeActions` |

---

## 6. Decisiones abiertas

1. **Portadas: ¿1, 3, o las dos?** (§4.1). Y si alguien dice "2, de
   internet", que sea sabiendo que rompe el "todo local" y toca el
   papeleo de las tiendas.
2. **¿La vitrina decorada o la rejilla limpia?** (muro 3). Es el rumbo
   visual de la app, no un detalle.
3. **¿Sesiones sí o no?** Es la pieza cara, y sin ella no hay
   estadísticas, ni racha, ni logros, ni relecturas. Con ella,
   Entretenimiento pasa de ser una lista a ser un hábito.
4. **Orden.** Mi propuesta: primero el **visor móvil** que ya estaba
   planeado (fichas en vez de la tabla de escritorio), con las portadas
   generadas dentro — eso ya cambia la cara de la sección. Las sesiones
   y las estadísticas, en una segunda tanda.
5. **La rama de escritorio** (`entretenimiento-escritorio`) sigue sin
   tocar. Todo esto es de móvil.

---

## Fuentes

- [Mistbook en la App Store](https://apps.apple.com/ng/app/mistbook/id6787462448)
- [Mistbook en Google Play](https://play.google.com/store/apps/details?id=mist.warm.bundle)
- [Ficha de MWM](https://mwm.ai/apps/mistbook/6787462448)
