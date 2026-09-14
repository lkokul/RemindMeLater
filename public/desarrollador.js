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
  '0.62.1': [
    'El arreglo de las letras del widget es SWIFT, así que no se ve hasta que lances una build nueva de TestFlight. Recargar la app o quitar y volver a poner el widget no cambia nada.',
    'Míralo con tu tema claro y el móvil en modo oscuro, que es la combinación que rompía. Los rotos eran el del calendario (los números de los días) y el de Tareas; los demás no ponían ningún color a mano, pero conviene confirmarlo de un vistazo.',
    'Con el móvil en oscuro y el widget en estilo "app" con un tema claro, el widget queda claro al lado de todo lo demás. Es lo que elegiste, pero si te chirría, el estilo "mixto" de Configuración → Widgets hace justo eso: tu paleta siguiendo el modo del móvil.',
    'La mayúscula del salto título→párrafo NO se puede probar desde aquí: la pone el teclado del sistema y en el navegador de pruebas no existe. Lo que sí está comprobado es que el salto lo da ahora el navegador (que es lo que tiene que avisar al teclado) y que la línea sigue bajando a párrafo. Dime si en el iPhone ya sale con mayúscula.',
    'Si el salto título→párrafo ya va bien, el mismo tratamiento le haría falta a los otros cambios de formato que hace el JavaScript (salir de una cita, salir de una lista). No los he tocado porque no los nombraste y cada uno es un camino distinto que probar.',
  ],
  '0.62.0': [
    'Otra ronda de merges: Entretenimiento (vitrina de portadas + sesiones, racha y vueltas) y Recetas (calorías y macros). gimnasio, finanzas, retos y viajes no traían nada.',
    'Entretenimiento estrena tabla (entretenimiento_sesiones) y columna (vuelta). La migración desde una base tuya de la ronda anterior solo se puede ver de verdad en el teléfono: mira que no se haya perdido ninguna portada ni ninguna nota.',
    'La rama de Recetas venía numerada como v0.60.0, que ya estaba cogida y etiquetada. Esta ronda es la v0.62.0 y sus notas se han fundido aquí. Es la tercera vez que dos ramas eligen el mismo número.',
    'ARREGLO DE PÉRDIDA DE DATOS en la copia de seguridad, y conviene probarlo: las portadas de Entretenimiento, las fotos de Recetas y los adjuntos de Viajes viven en el mismo almacén que las imágenes de las notas, y la copia solo las guardaba si marcabas Notas. Además, restaurar una copia parcial VACIABA ese almacén, o sea que restaurar solo Notas se llevaba por delante las fotos de las otras tres Apps. Ahora se guardan si entra cualquiera de esas Apps, y una restauración parcial sólo SUMA imágenes, nunca borra.',
    'El widget de Entretenimiento apuntaba a remindmelater://lecturas y ahora apunta a entretenimiento, con el nombre viejo conservado como alias. Un widget que ya tuvieras puesto sigue funcionando, pero es justo lo que hay que tocar para comprobarlo.',
    'Sigue sin haber manual de Retos, Recetas ni de las otras cuatro Apps: solo el del Gimnasio.',
  ],
  '0.61.0': [
    'Ronda de MERGES, no de features: entran Finanzas (la navegación de Gastos fijos), Entretenimiento (el renombrado entero) y las dos Apps nuevas, Retos y Recetas. Lo que hay que probar es que ninguna se ha roto por el camino, sobre todo Entretenimiento: sus tablas cambiaron de nombre y la migración desde lecturas_* solo se puede ver de verdad con datos tuyos de antes.',
    'Retos y Recetas vienen ENCENDIDAS con la etiqueta de "en desarrollo". Si prefieres que nazcan apagadas como Entretenimiento y Viajes, es quitarles `activaDeFabrica: true` en APPS_DE_LA_TIENDA.',
    'Ninguna de las dos nuevas tiene manual todavía (ni widget). Siguen faltando los cinco manuales de antes.',
    'gimnasio-movil y viajes-movil NO traían nada nuevo: ya estaban al día. Si esperabas algo de ellas, no llegó.',
    'Las ramas de Retos y Recetas salen de movil-ui, o sea SIN los avisos de desarrollo, y el merge se los llevaba en silencio (el <script> de desarrollador.js incluido). Se han repuesto y hay una prueba que lo vigila, pero conviene mirar en la build que la línea de versión sigue diciendo el número de build.',
    'Las notas de versión de la 0.59.0 y la 0.60.0 no existían: esas dos rondas subieron sin escribirlas. Las he redactado a partir de sus commits — léelas por si algo no cuadra con lo que te enseñó esa sesión.',
  ],
  '0.58.0': [
    'Si apagas TODAS las Apps que pueden ir en el hueco de la barra de abajo, ese hueco se queda con Notas igualmente (un boton de la barra no puede quedarse vacio). Es el UNICO sitio donde se puede llegar a una App apagada. Si te molesta, la alternativa seria que la barra pasara a tener 3 botones.',
    'Los manuales de Calendario, Notas, Finanzas, Lecturas y Viajes están VACÍOS: solo está escrito el del Gimnasio, que es el que pediste ver primero. Si el tono y el nivel de detalle te valen, se escriben los otros cinco con el mismo patrón.',
    'Apagar una App NO borra nada, solo la esconde. Decidir si algún día debería existir un "borrar los datos de esta App" aparte — hoy no hay forma de vaciar Viajes sin vaciar la copia entera.',
    'Una copia de seguridad parcial ahora se importa SIN pisar lo que no trae. Merece la pena probarlo con datos de verdad antes de fiarse: exporta solo Gimnasio, cambia cosas en Finanzas, importa y comprueba que Finanzas sigue como la dejaste.',
    'Los ajustes de este dispositivo (tema, unidades, qué hay en la barra) se restauran ENTEROS aunque la copia sea parcial. Son preferencias, no datos de una App, pero si prefieres que una copia parcial no toque los ajustes, es una línea.',
    'El widget del calendario y el de tareas son del Calendario, que no se puede apagar: o sea que esos dos siempre tienen datos. Los cuatro que sí se pueden dejar sin datos son Gimnasio, Finanzas, Lecturas y Viajes.',
    'La clave "ejercicios" del mensaje al widget se llamaba igual en dos sitios y uno pisaba al otro (arreglado). Conviene mirar el widget "Qué toca hoy" en el iPhone: tiene que volver a decir cuántos ejercicios tiene el día.',
  ],
  '0.57.0': [
    'El horario es una rejilla de SIETE columnas en un móvil, así que cada columna son unos 45 px y los nombres largos se parten ("Gimna/sio"). Se apretaron todos los márgenes para ganar sitio y es lo que hace también Google Calendar, pero si te molesta la alternativa es enseñar 3 días a la vez y deslizar de lado.',
    'Un bloque del horario NO avisa: no programa ninguna notificación. Los avisos son del calendario, y un horario fijo sonando cada semana llenaría el cupo del teléfono. Si lo quieres, hay que decidir el reparto del cupo aparte.',
    'Dos bloques del horario que se solapen se pintan uno ENCIMA del otro, no partiendo la columna. No pasa en un horario real (no estás en dos clases a la vez), pero conviene saberlo.',
    'Repetir un evento calcula hasta 500 veces como mucho (MAX_OCURRENCIAS en local-api.js), y los avisos se cortan en 10 por serie. Los dos números están puestos a ojo: si alguna serie diaria larga se queda corta, se suben.',
    'Editar una repetición suelta y luego cambiar la serie entera: la suelta NO se entera del cambio (es ya un evento propio). Es lo que hace el iPhone, pero confírmalo cuando lo uses.',
    'El horario no sale en ningún widget ni en la copia de seguridad tiene nada especial (viaja dentro del .sqlite, como todo). Si quieres un widget de "qué me toca hoy" del horario, es una ronda aparte.',
  ],
  '0.56.0': [
    'Deslizar hacia la derecha desde el inicio del Gimnasio NO sale a Herramientas todavía — eso solo está en Finanzas. Ahora que las dos pantallas tienen la misma forma, decide si se generaliza (también a Viajes y Entretenimiento).',
    'El componente de fila y sus clases CSS siguen llamándose `finanzas-*` aunque ahora los use también el Gimnasio. Es a propósito, para no chocar con tu rama finanzas-movil en cada línea; cuando la cierres, se renombran de una vez.',
    'Progreso sigue teniendo ocho bloques y dos ajustes dentro (objetivo semanal y peso extra al fallo). Con el inicio nuevo es más fácil partirlo, si quieres.',
    'El ☰ de ajustes del Gimnasio está oculto por CSS en móvil desde hace tiempo, así que esos dos ajustes de Progreso son la única forma de llegar a ellos. Conviene mirarlo si algún día se mueven al ☰.',
  ],
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
