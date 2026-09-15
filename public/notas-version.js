// NOTAS DE VERSION — lo que se ve en Configuración → Novedades.
//
// Petición de Koku (11/9/2026): un apartado de notas de versión para LAS
// DOS versiones (la de usuario y la de desarrollador), con lo nuevo y los
// parches de cada ronda.
//
// Se escribe A MANO en cada ronda, igual que APP_VERSION: la app no tiene
// paso de compilación que pueda generarlo. Lo NUEVO va arriba del todo,
// que es el orden en el que se lee.
//
// Cada entrada:
//   version  — el número, tal cual está en package.json y en APP_VERSION.
//   fecha    — ISO (YYYY-MM-DD). Se formatea con el formato del SISTEMA.
//   nuevo    — cosas que antes no existían.
//   parches  — cosas que no iban bien y ahora sí.
//
// Lo que hay "a revisar" NO vive aquí: va en public/desarrollador.js, que
// es un archivo que NO viaja a la rama de usuario (ver CLAUDE.md). Así no
// es que se esconda por CSS: es que no está.
//
// CADA LÍNEA DICE DE QUÉ APP ES (13/9/2026, decisión de Koku al pedir
// notas por App): una línea puede ser
//
//   'texto'                              → general, de la app entera
//   { app: 'gym', texto: '...' }         → de esa App
//
// Se escribe UNA sola vez y se lee de DOS formas: Configuración →
// Novedades lo enseña todo junto con su etiqueta, y la ficha de cada App
// en la Tienda enseña solo lo suyo. Una sola fuente de verdad: así las
// dos pantallas no pueden contradecirse, que es lo que pasaría con dos
// listas escritas a mano por separado.
//
// El `app` tiene que ser un id de APPS_DE_LA_TIENDA (app.js). Uno que no
// exista se lee como general, no rompe nada.
const APP_RELEASE_NOTES = [
  {
    version: '0.62.4',
    fecha: '2026-09-15',
    nuevo: [],
    parches: [
      { app: 'retos', texto: 'Fuera el botón ☰ de Configuración de la cabecera, como en el resto de la app: la barra de abajo ya tiene su propia sección de Configuración. Retos era la última pantalla donde seguía saliendo.' },
    ],
  },
  {
    version: '0.62.3',
    fecha: '2026-09-15',
    nuevo: [],
    parches: [
      { app: 'recetas', texto: 'La pantalla de Recetas ya no llega al borde del cristal: tiene los mismos márgenes laterales que Gimnasio, Finanzas y Entretenimiento. Era la única sección sin ellos.' },
      { app: 'recetas', texto: 'El "‹ Recetas" de volver es ahora un botón de verdad, con la misma forma que el "+ Carpeta" de al lado, en vez de un texto suelto con una flechita.' },
      { app: 'recetas', texto: 'Fuera el botón ☰ de la cabecera: la barra de abajo ya tiene su propia sección de Configuración, así que era un segundo camino a lo mismo ocupando sitio.' },
    ],
  },
  {
    version: '0.62.2',
    fecha: '2026-09-14',
    nuevo: [
      { app: 'calendario', texto: 'El horario enseña el día ENTERO, de 00:00 a 24:00, en vez de solo de 8:00 a 22:00. Y como casi todo lo de arriba está vacío, la pantalla se abre desplazada hasta tu primer bloque, con media hora de aire por encima.' },
      { app: 'calendario', texto: 'Las frecuencias de repetición se llaman por su adjetivo: Diaria, Semanal, Mensual y Anual.' },
    ],
    parches: [
      { app: 'notas', texto: 'La mayúscula del principio también se pone al salir de una cita, no solo al bajar del título al párrafo. Es el mismo arreglo: el salto de línea lo da ahora el navegador, que es quien tiene que avisar al teclado de que empieza frase nueva.' },
    ],
  },
  {
    version: '0.62.1',
    fecha: '2026-09-14',
    nuevo: [],
    parches: [
      'Los números de los días del widget del calendario vuelven a verse. Con un tema claro y el móvil en modo oscuro salían en blanco sobre el fondo blanco del widget, y solo se veía el círculo del día de hoy.',
      'Lo mismo en el widget de Tareas: el título de una tarea que no está vencida se veía en blanco en esa misma combinación.',
      'En las notas, la mayúscula del principio ya se pone también en el salto del título al primer párrafo. Al cambiar de formato el teclado no se enteraba de que empezaba frase nueva y esa línea salía en minúscula; dentro del mismo formato sí funcionaba.',
    ],
  },
  {
    version: '0.62.0',
    fecha: '2026-09-14',
    nuevo: [
      { app: 'lecturas', texto: 'Entretenimiento estrena vitrina: la tabla con scroll lateral se fue y ahora es una rejilla de portadas. Si no le pones imagen, se genera una con el color del tipo, y la de verdad la pones tú desde la galería o la cámara.' },
      { app: 'lecturas', texto: 'Cuatro pestañas: Siguiendo (donde abre), Colecciones, Deseos e Historial. Las tres transversales cruzan todas tus colecciones, así que ya no hace falta entrar en una para ver por dónde ibas.' },
      { app: 'lecturas', texto: 'Se apuntan sesiones solas: cada vez que subes el progreso queda guardado "el martes leí del capítulo 12 al 15". No hay que hacer nada nuevo — cambias el progreso como siempre.' },
      { app: 'lecturas', texto: 'Y de ahí sale la pestaña Actividad: racha diaria, mapa de 26 semanas y el resumen del año con su unidad ("42 capítulos de manga", no "42 manga").' },
      { app: 'lecturas', texto: '"Volver a empezar" para relecturas y revisionados: pone el progreso a cero y empieza la vuelta 2. No borra nada — lo que leíste la vuelta anterior sigue contando para la racha y el mapa.' },
      { app: 'lecturas', texto: 'Ya se puede mover un item de colección, y crear la colección nueva ahí mismo si es algo suelto.' },
      { app: 'recetas', texto: 'En Recetas puedes apuntar, si quieres, las calorías y los macros de cada ingrediente: lo que pone en su paquete por 100 g o por 100 ml. Es todo opcional y el bloque viene plegado — si no te interesa, ni lo ves.' },
      { app: 'recetas', texto: 'Lo escribes una vez en el ingrediente y la receta suma sola: en su ficha aparecen las calorías por ración y el desglose de grasas, hidratos, proteínas, fibra y sal, igual que en una etiqueta.' },
      { app: 'recetas', texto: 'Y escala con las raciones: las calorías por ración no cambian al pedir la receta para más gente, pero el plato entero sí.' },
      { app: 'recetas', texto: 'Si a algún ingrediente le faltan los valores, la ficha suma lo que sabe y te dice cuál falta, en vez de dar una cifra que parezca exacta sin serlo.' },
      { app: 'recetas', texto: 'Para lo que midas en unidades (2 huevos, 3 dientes de ajo) puedes decir cuánto pesa una, y así también entra en la cuenta.' },
    ],
    parches: [
      { app: 'lecturas', texto: 'Borrar un item o una colección preguntaba con el cuadro del navegador, que en el móvil deja la app congelada un instante. Ahora usa el diálogo de siempre.' },
      'Una copia de seguridad que dejara Notas fuera se llevaba también las portadas de Entretenimiento, las fotos de Recetas y los adjuntos de Viajes, porque todas las imágenes viven en el mismo sitio. Ahora se guardan si incluyes cualquiera de esas Apps.' ,
      'Las sesiones de Entretenimiento faltaban en el reparto de la copia de seguridad: una copia de esa App no las habría guardado.',
    ],
  },
  {
    version: '0.61.0',
    fecha: '2026-09-14',
    nuevo: [
      { app: 'recetas', texto: 'App nueva: Recetas. Apunta un plato con su foto, sus tiempos, para cuánta gente es y cómo se hace, y organízalo en carpetas (Vegana, Postres…) y con etiquetas.' },
      { app: 'recetas', texto: 'Los ingredientes son fichas: "Pollo" existe una sola vez y lo comparten todas tus recetas. Así la lista de la compra suma "300 g + 200 g de pollo" en una línea en vez de repetirla.' },
      { app: 'recetas', texto: 'Escala una receta al vuelo: está apuntada para 2 y la quieres para 4, y las cantidades se ajustan solas. La receta se queda como estaba: lo que cambia es lo que ves.' },
      { app: 'recetas', texto: 'La lista de la compra se llena sola: abre una receta, dale a "Añadir a la compra" y ahí están sus ingredientes, agrupados por el pasillo del súper. Quitar la receta los quita; lo que añadiste tú a mano se queda.' },
      { app: 'recetas', texto: 'Al darle a "Compra hecha" la lista se guarda con su fecha en "Compras anteriores" y empiezas otra vacía.' },
      { app: 'retos', texto: 'App nueva: Retos. Hábitos que se mantienen (con su racha) y metas a las que llegar, en un mismo árbol donde cada línea se marca y ya.' },
      { app: 'lecturas', texto: 'Lecturas pasa a llamarse Entretenimiento, que es lo que de verdad guarda: también series, películas, anime, videojuegos y podcasts. Lo que tuvieras apuntado sigue donde estaba.' },
      'Las dos Apps nuevas vienen encendidas, con su etiqueta de "en desarrollo". Desde la Tienda puedes apagar la que no uses.',
    ],
    parches: [
      { app: 'finanzas', texto: 'En Gastos fijos había dos barras de pastillas idénticas, una encima de otra y con la palabra "Año" repetida, así que no se veía cuál cambiaba de sección y "Plantillas" se perdía. Ahora la de secciones es una sola y lo que filtra dentro son chips.' },
      { app: 'viajes', texto: 'Dos importes de Viajes salían como "1450.00 €" en vez de "1.450,00 €". Ya no queda ninguno sin formatear en toda la app.' },
      { app: 'finanzas', texto: 'Un gasto fijo creado sin pedir ningún aviso acababa con uno puesto para el mismo día.' },
    ],
  },
  {
    version: '0.60.0',
    fecha: '2026-09-14',
    nuevo: [
      { app: 'gym', texto: 'Salir a correr en series: un ejercicio de intervalos que se encadena solo — tramo fuerte, tramo suave y vuelta a empezar, sin tocar el móvil mientras corres. Cada cambio avisa con su vibración.' },
    ],
    parches: [],
  },
  {
    version: '0.59.0',
    fecha: '2026-09-14',
    nuevo: [
      { app: 'gym', texto: 'Deslizar hacia la derecha desde el inicio del Gimnasio ya sale a Herramientas, como en Finanzas. Dentro de un bloque, lo primero que se suelta sigue siendo la lista de días.' },
    ],
    parches: [
      { app: 'gym', texto: 'La gráfica de un ejercicio por tiempo era una línea plana a cero: pintaba el peso, que en una plancha a peso corporal no existe. Ahora pinta segundos, y los dos botones pasan a decir "Mejor tiempo" y "Tiempo total".' },
      { app: 'gym', texto: 'Una plancha no aparecía en Récords, y con peso salía aún peor ("1RM est. 0 · Vol. 0"). Ahora entra por su aguante y la cifra grande es el tiempo.' },
    ],
  },
  {
    version: '0.58.0',
    fecha: '2026-09-13',
    nuevo: [
      'La Tienda ya está: las seis Apps, cada una con su ficha. Dentro de la ficha están su manual de uso y sus novedades, solo las suyas.',
      'Puedes encender y apagar Apps. Una App apagada desaparece de Herramientas, no se puede poner en el hueco de la barra de abajo y sus widgets se quedan sin datos. No se borra NADA: al volver a encenderla está todo como lo dejaste.',
      'Lecturas y Viajes vienen apagadas de fábrica y marcadas como "en desarrollo": les faltan cosas y pueden cambiar de sitio. Se encienden desde su ficha cuando quieras.',
      'Una App apagada tampoco sale en el selector del acceso rápido de la barra de abajo, ni deja su tarjeta en Herramientas.',
      'La copia de seguridad pregunta qué Apps guardar. Las que tengas apagadas vienen desmarcadas, pero puedes marcarlas igual.',
      'Al restaurar una copia que no lo trae todo, solo se sustituye lo que la copia traiga: las Apps que no vengan en ella se quedan como están ahora. El aviso antes de importar dice exactamente qué se cambia y qué no.',
      { app: 'gym', texto: 'El manual del Gimnasio está escrito entero. Los otros cinco están por hacer.' },
    ],
    parches: [
      { app: 'gym', texto: 'El widget "Qué toca hoy" dejaba de decir cuántos ejercicios tiene el día (y el "+3 más") en cuanto tenías historial de entrenos. Dos datos distintos se llamaban igual dentro del mensaje que la app le manda al widget, y uno pisaba al otro.' },
    ],
  },
  {
    version: '0.57.0',
    fecha: '2026-09-13',
    nuevo: [
      'Los eventos se pueden repetir: cada día, cada semana, cada mes o cada año, y "cada 2", "cada 3"... de lo que sea. En los semanales se marcan varios días a la vez (L, X y V en una sola regla).',
      'Al tocar una vez de un evento que se repite, la app pregunta si el cambio es solo esa vez o todas — igual que el iPhone y Google Calendar. "Solo esta vez" la suelta como evento propio y la serie deja de pintar ese día.',
      'Se puede poner una fecha de fin a la repetición, o dejarla corriendo para siempre.',
      'Horario semanal fijo: una pantalla nueva con la rejilla de horas × días (de lunes a domingo) para lo que se repite toda la semana — clases, turnos, gimnasio. Se abre desde el botón "Horario" del calendario.',
      'Un bloque del horario lleva título, día, horas, ubicación y grupo (de ahí saca el color). Tocar un hueco vacío crea uno ahí mismo, con el día y la hora ya puestos.',
      'En las notas, la primera línea nace ya con formato de título: escribes y al dar a Intro bajas al texto normal, sin tener que cambiarlo a mano cada vez.',
      'El teclado del móvil pone mayúscula al empezar una frase en las notas — también dentro de una lista o de una celda de tabla.',
    ],
    parches: [
      'La hora que se propone al crear un evento redondea a la hora MÁS CERCANA, no siempre hacia abajo: a las 9:37 propone 10:00–11:00, y a las 17:05, 17:00–18:00. Y creando el evento desde un día concreto ya no se plantaban las 9:00 fijas.',
      'El recordatorio de un evento nuevo viene puesto en "En el momento" en vez de "Sin recordatorio".',
      'Un evento que se repite programa un aviso propio por cada vez, no uno que se pisaba a sí mismo. Se limitan a 10 por serie para no quedarse con todo el cupo de avisos del teléfono.',
    ],  },
  {
    version: '0.56.0',
    fecha: '2026-09-13',
    nuevo: [
      { app: 'gym', texto: 'El Gimnasio se navega como Finanzas: un inicio con Historial, Plan, Progreso y Logros como filas, y entras en la que quieras. Se va la barra de cuatro pestañas de arriba.' },
      { app: 'gym', texto: 'Arriba del todo, cuántos entrenos llevas esta semana y tu racha. Y justo debajo, "Empezar entrenamiento" — sigue a un solo toque de abrir la app.' },
      { app: 'gym', texto: 'La pestaña "Entrenar" pasa a llamarse "Historial", que es lo que de verdad tiene dentro ahora: las sesiones hechas, la actividad rápida y apuntar a mano.' },
      { app: 'gym', texto: 'Cada fila dice de un vistazo lo que hay dentro: cuántas sesiones, cuántos bloques y días, y cuántos logros llevas empezados.' },
    ],
    parches: [
      'Los iconos de las secciones ya no son emojis: son dibujos propios que se tiñen con el color del tema que tengas puesto. Antes los pintaba el sistema con su tipografía, así que cambiaban de forma entre un iPhone y un Android y no seguían el tema. Los iconos que eliges TÚ para una categoría o un objetivo no cambian: esos son tuyos.',
    ],
  },
  {
    version: '0.55.0',
    fecha: '2026-09-11',
    nuevo: [
      { app: 'finanzas', texto: 'En Finanzas, deslizar hacia la derecha desde el inicio de la sección ya sale a Herramientas. Antes el gesto solo servía para volver de una sección a su inicio y ahí se quedaba.' },
    ],
    parches: [
      { app: 'finanzas', texto: 'La última fila de una lista de Finanzas quedaba debajo de la barra de abajo y no había forma de verla ni de tocarla, ni bajando del todo.' },
      { app: 'finanzas', texto: 'Arrastrar sobre una tabla ancha de Finanzas te sacaba de la pantalla en vez de dejarte mirar las columnas.' },
      { app: 'finanzas', texto: 'Los porcentajes de Finanzas salían con punto decimal ("+9.7%") al lado de importes con coma ("1.700,00 €").' },
    ],
  },
  {
    version: '0.54.0',
    fecha: '2026-09-11',
    nuevo: [
      { app: 'gym', texto: 'Series parciales. Donde ya se apuntaban dropsets y rest-pause hay ahora un tercer tipo: seguir a recorrido corto cuando ya no salen repeticiones completas. Cuentan en el volumen y pueden ser récord, igual que los otros dos.' },
      { app: 'gym', texto: 'El reloj del entreno pasa a horas en cuanto las hay: 1:30:15 en vez de 90:15. Los descansos y la cuenta atrás de la serie siguen en minutos y segundos, que es como se leen mejor.' },
    ],
    parches: [
      { app: 'gym', texto: 'Los ejercicios por lados contaban mal las series si empezabas por el derecho: hacías tres series con cada brazo y la app apuntaba "derecho izquierdo derecho / izquierdo derecho / izquierdo". Ahora los dos lados son siempre la misma serie, empieces por donde empieces, y el descanso corto cae donde toca.' },
      { app: 'gym', texto: 'El historial guardaba esas mismas series numeradas de una en una (seis en vez de tres). Las sesiones nuevas ya se guardan bien.' },
    ],
  },
  {
    version: '0.53.0',
    fecha: '2026-09-11',
    nuevo: [
      { app: 'gym', texto: 'Ejercicios por tiempo. En la ficha de cada ejercicio eliges cómo se mide: repeticiones (lo de siempre), tiempo (isométricos: planchas, hollow holds) o repeticiones dentro de un tiempo.' },
      { app: 'gym', texto: 'El cronómetro de la serie se adapta: si le pones segundos objetivo cuenta atrás y se marca al llegar a cero; si lo dejas vacío cuenta hacia arriba, para aguantar lo que puedas.' },
      { app: 'gym', texto: 'Puedes ponerles peso igual (una plancha lastrada, un chaleco), aunque lo normal sea sin.' },
      { app: 'gym', texto: '"Tiempo bajo tensión" en Progreso, con sus propios segundos. Va aparte del volumen a propósito: un minuto de plancha no son kilos movidos.' },
      { app: 'gym', texto: 'Cronómetro y temporizador sueltos en el menú del entreno. Solo cuentan: empezar, pausar y reiniciar. Si los cierras siguen corriendo, y no se guardan en el historial.' },
    ],
    parches: [],
  },
  {
    version: '0.52.0',
    fecha: '2026-09-11',
    nuevo: [
      'Duplicar: notas, carpetas, bloques, días y ejercicios. Se hace deslizando la fila, y en Notas también desde el modo Seleccionar, para copiar varias de golpe.',
      { app: 'notes', texto: 'Al duplicar una carpeta puedes elegir si se lleva lo que hay dentro.' },
      { app: 'gym', texto: 'Los bloques y los días del Gimnasio se deslizan, como el resto de la app. Se va el lápiz.' },
      { app: 'gym', texto: 'Los ejercicios de un día también se deslizan: Editar, Mover y Quitar. Se van las flechas de subir y bajar.' },
      { app: 'gym', texto: 'Un "− 30 s" para deshacer los "+30 s" que le hayas dado al descanso.' },
      'Novedades: este mismo apartado.',
    ],
    parches: [
      { app: 'gym', texto: 'En el entreno, deslizar un ejercicio y darle a Editar no hacía nada. Llevaba así desde la build #59.' },
      { app: 'gym', texto: 'Si cortas el descanso empezando antes la siguiente serie, ahora se guarda el tiempo que de verdad descansaste. Antes se guardaba el programado, y eso desviaba el tiempo estimado del entreno.' },
      { app: 'gym', texto: 'El botón ± está ahora delante del peso, que es donde aparece el signo.' },
      'La App que pongas en la barra de abajo ya no sale repetida en Herramientas.',
      'La versión se ha movido al final de Configuración.',
    ],
  },
  {
    version: '0.51.0',
    fecha: '2026-09-11',
    nuevo: [
      { app: 'finanzas', texto: 'El inicio de Finanzas pasa a filas y enseña siempre sus siete secciones, aunque estén vacías.' },
    ],
    parches: [
      { app: 'finanzas', texto: 'Había secciones de Finanzas a las que no se podía entrar si no tenían datos.' },
    ],
  },
  {
    version: '0.49.0',
    fecha: '2026-09-11',
    nuevo: [
      { app: 'notes', texto: 'Fórmulas en las notas: escribe "12+1 =" y el resultado aparece detrás. Intro lo fija.' },
      { app: 'gym', texto: 'Tiempo estimado del entreno, calculado con tus propias medias.' },
      { app: 'gym', texto: 'Cualquier ejercicio acepta peso negativo, para los asistidos.' },
    ],
    parches: [
      { app: 'calendario', texto: 'Los días no se veían en el widget grande del calendario.' },
      { app: 'notes', texto: 'Intro no fijaba la fórmula en el iPhone.' },
    ],
  },
  {
    version: '0.48.0',
    fecha: '2026-09-10',
    nuevo: [
      'La app no hace ni una petición de red: todo lo que necesita viaja dentro.',
      'Tipografía nueva, con la escala de tamaños de iOS.',
    ],
    parches: [
      'El visor de escritorio se colaba al ver la app en una pantalla grande.',
      'Los botones se quedaban "pulsados" después de tocarlos.',
    ],
  },
];
