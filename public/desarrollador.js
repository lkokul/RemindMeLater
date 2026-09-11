// SOLO EN LA RAMA DE DESARROLLADOR. Este archivo NO viaja a `movil-ui`.
//
// Decisión de Koku (10/9/2026): la rama `desarrollador` lleva los avisos
// de diagnóstico dentro y la de usuario no. Hasta ahora eso eran trozos
// sueltos repartidos por index.html, app.js y settings.js, y había que
// ir quitándolos uno a uno en cada fusión.
//
// Lo que se añada de aquí en adelante mejor que viva AQUÍ: quitar el
// archivo y su <script> de index.html basta para que desaparezca todo.
// Y no es que se esconda por CSS ni por un "if": es que no está.
window.APP_MODO_DESARROLLADOR = true;

// "Cosas a revisar" de cada versión, que se ven bajo sus notas en
// Configuración → Novedades. Petición de Koku (11/9/2026): "lo que sólo
// estará en la versión de desarrollador, lo de la build y en notas de
// versión cosas a revisar en la versión".
//
// La clave es el número de versión, igual que en APP_RELEASE_NOTES.
window.APP_NOTAS_REVISAR = {
  '0.55.0': [
    'Merge de finanzas-movil. Los dos commits del "apartado de salario" los deshizo el tercero, así que de esa idea no queda nada en la app: si la quieres, hay que rehacerla.',
    'El colchón de abajo de Finanzas son 7rem fijos. Si algún día la barra de apps cambia de alto, este número y el de .gym-tab-content hay que tocarlos a la vez.',
    'Deslizar para salir de la App entera SOLO está en Finanzas. En Gimnasio, Entretenimiento y Viajes el segundo gesto todavía no hace nada — decidir si se generaliza.',
  ],
  '0.54.0': [
    'El emparejado de lados se hace por "dos filas seguidas de lados distintos". Si alguna vez se pudiera apuntar un ejercicio a lados haciendo TODO un lado y luego todo el otro (D D D I I I), la cuenta saldría rara (1 2 3 3 4 5). No pasa en el flujo normal, pero es el único hueco conocido.',
    'Las sesiones YA GUARDADAS con la numeración vieja (1..6 en vez de 1,1,2,2,3,3) no se tocan: no hay migración. Habría que decidir si merece la pena una, sabiendo que sólo cambia cómo se LEE el historial, no ningún total.',
    'El contador de series de Progreso (racha, heatmap, objetivo semanal) sigue contando cada lado como una serie. Es lo que se decidió en su día, pero ahora que los números de serie sí emparejan, conviene confirmar que es lo que quieres.',
    'Las parciales llevan el peso de la madre por defecto. Si en la práctica las haces con menos peso, se cambia la sugerencia en una línea.',
  ],
  '0.53.0': [
    'El cronómetro de una serie por tiempo NO avisa al llegar al objetivo (solo se marca en pantalla). Si al usarlo de verdad hace falta que vibre, hay que decidirlo aparte: toca el mismo canal que el aviso de fin de descanso.',
    'El temporizador suelto tampoco suena al vencer, por lo mismo.',
    'Los récords de un ejercicio por tiempo (mejor aguante) todavía no salen en la pestaña de PRs: la ruta ya devuelve maxSeconds, falta pintarlo.',
    'El tiempo estimado del entreno no usa todavía el objetivo de las series por tiempo, que se sabe de antemano y lo afinaría.',
  ],
  '0.52.0': [
    'Duplicar una carpeta con muchas notas dentro: comprobar que no tarda un mundo con una biblioteca de verdad.',
    'Las filas del día ya no tienen campos: ver si se echa de menos poder escribir las series sin abrir el diálogo.',
    'El "− 30 s" baja de 30 en 30. Si te pasas mucho con el +30, mirar si hace falta un "quitarlo todo".',
    'Los iconos de las tarjetas de Finanzas siguen siendo emojis (duda B9 de PARA-KOKU-MAÑANA.md).',
  ],
  '0.51.0': [
    'El merge de finanzas-movil fue fast-forward. Ojo en las próximas: si Koku no trae desarrollador antes, habrá conflictos en styles.css.',
  ],
};
