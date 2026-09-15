// MANUALES DE USO — lo que se ve en Configuración → Tienda → una App.
//
// Petición de Koku (13/9/2026): "manuales de usuario para cada app".
//
// Se escriben A MANO, igual que las notas de versión: la app no tiene
// paso de compilación que pueda generarlos.
//
// FORMATO, y es a propósito que sea tan pobre: cada manual es una lista
// de SECCIONES, y cada sección es un título más una lista de párrafos o
// de puntos. Nada de HTML. Lo pinta `renderManualDeApp()` en
// `settings.js` con `textContent`, así que un manual NO PUEDE meter
// etiquetas en la pantalla ni aunque se cuele una por error. Los
// manuales los escribo yo, pero el saneador de la app se aplica a lo que
// escribe el usuario y no hay motivo para que esto sea la excepción.
//
// Cada sección:
//   titulo   — el encabezado.
//   parrafos — texto corrido (opcional).
//   puntos   — lista con viñetas (opcional).
//
// ESTADO: el del Gimnasio está COMPLETO; los otros tres tienen el
// esqueleto. Fue la vía que eligió Koku de las tres ofrecidas: primero
// uno entero para que valide el tono y la profundidad, y con eso ya se
// escriben los demás sin riesgo de reescribir cuatro.
const APP_MANUALES = {

  // -------------------------------------------------------------------
  // GIMNASIO — completo. Es el más largo de los cuatro a propósito: es
  // el que más mecánica propia tiene (el ciclo, los tramos, los
  // unilaterales, el tiempo estimado), y por eso se eligió como el
  // primero, para ver si este nivel de detalle es el que quieres.
  // -------------------------------------------------------------------
  gym: [
    {
      titulo: 'La idea en una frase',
      parrafos: [
        'El Gimnasio guarda lo que levantas y te lo devuelve cuando vuelves a hacerlo. Lo demás (el plan, las gráficas, los logros) sale solo de ahí.',
        'Al abrirlo ves arriba cuántos entrenos llevas esta semana y tu racha, y justo debajo el botón de empezar. Las cuatro secciones (Historial, Plan, Progreso y Logros) están en las filas de abajo.',
      ],
    },
    {
      titulo: 'Empezar a entrenar',
      parrafos: [
        'El botón grande del inicio arranca un entrenamiento en vivo. Si dejaste uno a medias, ahí sale "continuar" en su lugar: nunca vas a perder un entreno por cerrar la app, porque lo que llevas hecho se guarda sobre la marcha.',
      ],
      puntos: [
        'Cada ejercicio tiene un botón grande "Empezar serie". Al pulsarlo arranca un cronómetro.',
        'Cuando acabas, un toque en cualquier hueco de la pantalla abre el diálogo de "¿has acabado?". También está el botón, si prefieres.',
        'Ahí apuntas el peso y las repeticiones. Si lo dejas en blanco, vale lo que pone en gris: es lo que hiciste la vez anterior.',
        'Al guardar la serie arranca solo el descanso. Cuando termina, el botón de la siguiente serie se pone grande para que no se te pase.',
      ],
    },
    {
      titulo: 'Si te pasas o te quedas corto con el descanso',
      parrafos: [
        'Durante el descanso puedes sumarle "+30 s" las veces que quieras, y quitárselos con "− 30 s" si te pasaste.',
        'Y si empiezas la siguiente serie antes de que acabe la cuenta atrás, se guarda lo que de verdad descansaste, no lo que estaba programado. Importa porque de esa media sale el tiempo estimado del entreno.',
      ],
    },
    {
      titulo: 'Series que no son "peso por repeticiones"',
      puntos: [
        'Al fallo: un botón en el diálogo de fin de serie. Marca que esa serie te exprimió, y cuenta algo más en el volumen (cuánto, lo eliges en Progreso).',
        'Dropset: bajaste el peso y seguiste. Cada tramo se apunta aparte, con su peso.',
        'Rest-pause: paraste unos segundos y seguiste con el mismo peso.',
        'Parciales: seguiste con el mismo peso pero a recorrido corto.',
        'Los tres tramos son de la MISMA serie: tres series con dropset siguen siendo tres series, no nueve. Eso es lo que evita que la racha y el mapa de músculos digan que entrenaste el triple.',
      ],
    },
    {
      titulo: 'Ejercicios a un lado cada vez',
      parrafos: [
        'Si marcas un ejercicio como unilateral en su ficha, cada serie se parte en dos: izquierdo y derecho. El diálogo te pregunta por cuál empiezas y eso vale para el resto del ejercicio.',
        'Los dos lados son la misma serie, empieces por el que empieces. Entre un lado y el otro puedes poner un descanso corto propio, distinto del descanso entre series.',
      ],
    },
    {
      titulo: 'Ejercicios por tiempo',
      parrafos: [
        'En la ficha de cada ejercicio eliges cómo se mide: repeticiones (lo normal), tiempo (una plancha) o repeticiones dentro de un tiempo.',
      ],
      puntos: [
        'Si le pones segundos objetivo, el cronómetro cuenta ATRÁS y se marca al llegar a cero.',
        'Si lo dejas vacío, cuenta hacia arriba: aguanta lo que puedas y se apunta lo que salga.',
        'Puedes ponerles peso igual (una plancha lastrada). Los segundos no se suman al volumen: van en su propio contador, "tiempo bajo tensión", porque un minuto de plancha no son kilos movidos.',
      ],
    },
    {
      titulo: 'Retocar algo que apuntaste mal',
      parrafos: [
        'Dentro del entreno, desliza la tarjeta de un ejercicio hacia la izquierda: salen Editar, Mover y Quitar. En "Editar" está el ejercicio entero, serie a serie, con sus tramos.',
        'Y en el Historial, deslizar una sesión da Editar y Eliminar. Ahí puedes arreglar una sesión de hace días.',
      ],
    },
    {
      titulo: 'El Plan: bloques, días y ejercicios',
      parrafos: [
        'Un BLOQUE es una etapa de entrenamiento (una definición, un volumen). Dentro tiene DÍAS, que son los entrenos que rotas. Solo hay un bloque activo a la vez.',
      ],
      puntos: [
        'Un día es una lista de ejercicios, cada uno con sus series, repeticiones y descanso esperados.',
        'Esos números salen de la ficha del ejercicio como punto de partida, pero puedes cambiarlos en cada día: 5×5 el lunes y 3×12 el jueves con el mismo ejercicio.',
        'Editar un ejercicio NO cambia los días que ya lo tenían. Lo ya montado se queda como está.',
        'Deslizando una fila salen Editar, Mover y Quitar. El ojo aparca un ejercicio sin borrarlo: no sale en el entreno, pero sigue en el día.',
      ],
    },
    {
      titulo: 'El ciclo de días',
      parrafos: [
        'Un bloque puede llevar un ciclo: día 1 empuje, día 2 tirón, día 3 descanso, y vuelta a empezar. Es opcional.',
        'El ciclo avanza por ENTRENOS HECHOS, no por calendario. Si te saltas el martes, el miércoles te sigue tocando lo mismo: el plan no te deja atrás. Los descansos sí se consumen al pasar el día, porque si no te bloquearían el ciclo.',
        'Si hoy toca descanso y te apetece entrenar, entrenas: te avisa, pero no te lo impide. Y si lo que hiciste no era lo que tocaba, te pregunta dónde recolocar el ciclo.',
      ],
    },
    {
      titulo: 'Tu lista de ejercicios',
      parrafos: [
        'Puedes crear ejercicios tuyos, o importarlos de la librería que viene dentro de la app (unos 870, sin conexión). Los importados se pueden editar como los tuyos.',
        'El buscador mira el nombre, el músculo principal, los secundarios y el material. Escribir "pierna" saca todas las de pierna aunque ninguna se llame así.',
      ],
    },
    {
      titulo: 'Ejercicios asistidos',
      parrafos: [
        'Dominadas con banda, máquina asistida. Se marca en la ficha del ejercicio y el peso pasa a ir con signo: −20, −18, y así hasta 0 y más allá.',
        'Un asistido no suma kilos al volumen, porque su peso es la ayuda que te quitan, no lo que mueves. Las series sí cuentan en la racha y en el mapa de músculos.',
        'Con el teclado del móvil no hay tecla "menos", así que al lado del peso aparece un botón ± para ponerlo.',
      ],
    },
    {
      titulo: 'Progreso: qué significa cada cosa',
      puntos: [
        'Consistencia: días entrenados, racha de semanas cumpliendo tu objetivo, esta semana y este mes.',
        'Mapa de entrenos: las últimas 26 semanas. Cuanto más oscuro, más sesiones ese día.',
        'Mapa de músculos: qué has trabajado y cuánto. Los colores no dicen "demasiado" ni "poco", solo cuánto ha tocado cada músculo comparado con el resto.',
        'Récords: tu mejor peso y una estimación de tu máximo a una repetición. El calentamiento no cuenta.',
        'Volumen: kilos movidos (peso × repeticiones). Una serie al fallo pesa algo más, y cuánto lo decides tú en esa misma pantalla.',
      ],
    },
    {
      titulo: 'El tiempo estimado',
      parrafos: [
        'En la ficha de un día sale "Tiempo estimado". Sale de TUS medias: cuánto tardas de verdad en cada serie de ese ejercicio y cuánto descansas después.',
        'Es un suelo, no una predicción: los ejercicios que no hayas hecho nunca se quedan fuera de la suma, porque la app prefiere no inventarse un número.',
      ],
    },
    {
      titulo: 'El cronómetro suelto',
      parrafos: [
        'En el menú de tres puntos del entreno hay un cronómetro que también hace de temporizador. No apunta nada en el historial: es una herramienta, para no tener que salir a buscar otra app.',
        'Si lo dejas corriendo y cierras el diálogo, sigue contando. El botón del menú se queda marcado mientras tanto.',
      ],
    },
  ],

  // -------------------------------------------------------------------
  // Los otros tres: esqueleto a la espera de que Koku valide el del
  // Gimnasio. NO se rellenan a medias — un manual con tres frases se lee
  // como un descuido; vacío con su aviso se lee como lo que es.
  // -------------------------------------------------------------------
  calendario: [],
  notes: [],
  finanzas: [],
  lecturas: [],
  viajes: [],
  retos: [],
  recetas: [],
};
