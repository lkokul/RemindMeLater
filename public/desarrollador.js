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
