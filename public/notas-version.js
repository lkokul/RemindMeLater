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
