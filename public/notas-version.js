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
const APP_RELEASE_NOTES = [
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
    ],
  },
  {
    version: '0.56.0',
    fecha: '2026-09-13',
    nuevo: [
      'El Gimnasio se navega como Finanzas: un inicio con Historial, Plan, Progreso y Logros como filas, y entras en la que quieras. Se va la barra de cuatro pestañas de arriba.',
      'Arriba del todo, cuántos entrenos llevas esta semana y tu racha. Y justo debajo, "Empezar entrenamiento" — sigue a un solo toque de abrir la app.',
      'La pestaña "Entrenar" pasa a llamarse "Historial", que es lo que de verdad tiene dentro ahora: las sesiones hechas, la actividad rápida y apuntar a mano.',
      'Cada fila dice de un vistazo lo que hay dentro: cuántas sesiones, cuántos bloques y días, y cuántos logros llevas empezados.',
    ],
    parches: [
      'Los iconos de las secciones ya no son emojis: son dibujos propios que se tiñen con el color del tema que tengas puesto. Antes los pintaba el sistema con su tipografía, así que cambiaban de forma entre un iPhone y un Android y no seguían el tema. Los iconos que eliges TÚ para una categoría o un objetivo no cambian: esos son tuyos.',
    ],
  },
  {
    version: '0.55.0',
    fecha: '2026-09-11',
    nuevo: [
      'En Finanzas, deslizar hacia la derecha desde el inicio de la sección ya sale a Herramientas. Antes el gesto solo servía para volver de una sección a su inicio y ahí se quedaba.',
    ],
    parches: [
      'La última fila de una lista de Finanzas quedaba debajo de la barra de abajo y no había forma de verla ni de tocarla, ni bajando del todo.',
      'Arrastrar sobre una tabla ancha de Finanzas te sacaba de la pantalla en vez de dejarte mirar las columnas.',
      'Los porcentajes de Finanzas salían con punto decimal ("+9.7%") al lado de importes con coma ("1.700,00 €").',
    ],
  },
  {
    version: '0.54.0',
    fecha: '2026-09-11',
    nuevo: [
      'Series parciales. Donde ya se apuntaban dropsets y rest-pause hay ahora un tercer tipo: seguir a recorrido corto cuando ya no salen repeticiones completas. Cuentan en el volumen y pueden ser récord, igual que los otros dos.',
      'El reloj del entreno pasa a horas en cuanto las hay: 1:30:15 en vez de 90:15. Los descansos y la cuenta atrás de la serie siguen en minutos y segundos, que es como se leen mejor.',
    ],
    parches: [
      'Los ejercicios por lados contaban mal las series si empezabas por el derecho: hacías tres series con cada brazo y la app apuntaba "derecho izquierdo derecho / izquierdo derecho / izquierdo". Ahora los dos lados son siempre la misma serie, empieces por donde empieces, y el descanso corto cae donde toca.',
      'El historial guardaba esas mismas series numeradas de una en una (seis en vez de tres). Las sesiones nuevas ya se guardan bien.',
    ],
  },
  {
    version: '0.53.0',
    fecha: '2026-09-11',
    nuevo: [
      'Ejercicios por tiempo. En la ficha de cada ejercicio eliges cómo se mide: repeticiones (lo de siempre), tiempo (isométricos: planchas, hollow holds) o repeticiones dentro de un tiempo.',
      'El cronómetro de la serie se adapta: si le pones segundos objetivo cuenta atrás y se marca al llegar a cero; si lo dejas vacío cuenta hacia arriba, para aguantar lo que puedas.',
      'Puedes ponerles peso igual (una plancha lastrada, un chaleco), aunque lo normal sea sin.',
      '"Tiempo bajo tensión" en Progreso, con sus propios segundos. Va aparte del volumen a propósito: un minuto de plancha no son kilos movidos.',
      'Cronómetro y temporizador sueltos en el menú del entreno. Solo cuentan: empezar, pausar y reiniciar. Si los cierras siguen corriendo, y no se guardan en el historial.',
    ],
    parches: [],
  },
  {
    version: '0.52.0',
    fecha: '2026-09-11',
    nuevo: [
      'Duplicar: notas, carpetas, bloques, días y ejercicios. Se hace deslizando la fila, y en Notas también desde el modo Seleccionar, para copiar varias de golpe.',
      'Al duplicar una carpeta puedes elegir si se lleva lo que hay dentro.',
      'Los bloques y los días del Gimnasio se deslizan, como el resto de la app. Se va el lápiz.',
      'Los ejercicios de un día también se deslizan: Editar, Mover y Quitar. Se van las flechas de subir y bajar.',
      'Un "− 30 s" para deshacer los "+30 s" que le hayas dado al descanso.',
      'Novedades: este mismo apartado.',
    ],
    parches: [
      'En el entreno, deslizar un ejercicio y darle a Editar no hacía nada. Llevaba así desde la build #59.',
      'Si cortas el descanso empezando antes la siguiente serie, ahora se guarda el tiempo que de verdad descansaste. Antes se guardaba el programado, y eso desviaba el tiempo estimado del entreno.',
      'El botón ± está ahora delante del peso, que es donde aparece el signo.',
      'La App que pongas en la barra de abajo ya no sale repetida en Herramientas.',
      'La versión se ha movido al final de Configuración.',
    ],
  },
  {
    version: '0.51.0',
    fecha: '2026-09-11',
    nuevo: [
      'El inicio de Finanzas pasa a filas y enseña siempre sus siete secciones, aunque estén vacías.',
    ],
    parches: [
      'Había secciones de Finanzas a las que no se podía entrar si no tenían datos.',
    ],
  },
  {
    version: '0.49.0',
    fecha: '2026-09-11',
    nuevo: [
      'Fórmulas en las notas: escribe "12+1 =" y el resultado aparece detrás. Intro lo fija.',
      'Tiempo estimado del entreno, calculado con tus propias medias.',
      'Cualquier ejercicio acepta peso negativo, para los asistidos.',
    ],
    parches: [
      'Los días no se veían en el widget grande del calendario.',
      'Intro no fijaba la fórmula en el iPhone.',
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
