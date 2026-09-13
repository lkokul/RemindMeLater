// reminders — portado de server/routes/reminders.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/reminders.js — que recordatorios estan pendientes o a punto de saltar.

  const router = createLocalRouter();

  // Calcula, en SQL, el instante en que debe saltar cada recordatorio:
  // start_at menos reminder_minutes_before. Solo devolvemos los que
  // tienen recordatorio configurado, ordenados por cuando toca avisar.
  // Cuanto se mira hacia delante al desplegar un evento que se repite, y
  // cuantos avisos como mucho se sacan de cada serie.
  //
  // El tope por serie NO es una limitacion tecnica, es un reparto: el
  // sistema solo guarda unas 60 notificaciones pendientes (ver el
  // comentario del cupo en local-notifications.js) y se programan las mas
  // proximas. Sin tope, UN evento diario se comeria el cupo entero con
  // sus proximos dos meses y no sonaria ni un aviso del resto de cosas.
  const DIAS_HACIA_DELANTE = 180;
  const MAX_AVISOS_POR_SERIE = 10;

  function idDeAviso(eventId, indice) {
    // Los avisos de una repeticion necesitan un id PROPIO: si todas las
    // veces compartieran el del evento, cada una pisaria a la anterior al
    // programarlas y solo sonaria la ultima.
    //
    // Bandas de ids en uso: los eventos normales usan su id tal cual
    // (numeros pequeños), los pagos fijos van en 800000000+ y los avisos
    // internos de la app en 999999900+. Esta banda se queda en medio,
    // con sitio de sobra sin llegar a la de los pagos.
    if (indice === 0) return eventId;
    return 600000000 + (eventId % 1000000) * 100 + Math.min(99, indice);
  }

  router.get('/upcoming', (req, res) => {
    const rows = db
      .prepare(`
        SELECT e.id, e.title, e.start_at, e.end_at, e.reminder_minutes_before, e.reminder_sent,
               e.repeat_freq, e.repeat_interval, e.repeat_weekdays, e.repeat_until, e.repeat_skip,
               g.name AS group_name, g.color AS group_color, g.icon AS group_icon,
               datetime(e.start_at, '-' || e.reminder_minutes_before || ' minutes') AS remind_at
        FROM events e
        LEFT JOIN groups g ON g.id = e.group_id
        WHERE e.reminder_minutes_before IS NOT NULL
        ORDER BY remind_at ASC
      `)
      .all();

    const ahora = new Date();
    const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + DIAS_HACIA_DELANTE, 23, 59, 59);
    const salida = [];

    for (const r of rows) {
      const comun = {
        eventId: r.id,
        title: r.title,
        reminderSent: !!r.reminder_sent,
        groupName: r.group_name || null,
        groupColor: r.group_color || null,
        groupIcon: r.group_icon || null,
      };

      if (!reglaDeRepeticion(r)) {
        salida.push({ ...comun, notificationId: r.id, startAt: r.start_at, remindAt: r.remind_at });
        continue;
      }

      // Un evento que se repite necesita UN aviso por cada vez. Se miran
      // las proximas, no las pasadas: un aviso de la semana pasada no
      // hay que programarlo.
      const desde = textoDeFechaLocal(ahora);
      const ocurrencias = repeticionesDeEvento(r, desde, textoDeFechaLocal(hasta)).slice(0, MAX_AVISOS_POR_SERIE);
      ocurrencias.forEach((oc, i) => {
        const arranque = fechaLocalDeTexto(oc.startAt);
        if (!arranque) return;
        const avisa = new Date(arranque.getTime() - Number(r.reminder_minutes_before) * 60000);
        salida.push({
          ...comun,
          notificationId: idDeAviso(r.id, i),
          startAt: oc.startAt,
          remindAt: textoDeFechaLocal(avisa),
          // El dia concreto de la repeticion, por si algun dia hace falta
          // distinguirlas desde el cliente.
          occurrenceDate: oc.occurrenceDate,
          // Una repeticion nunca se da por "ya avisada": ese flag es de
          // la fila, y la fila es la serie entera.
          reminderSent: false,
        });
      });
    }

    salida.sort((a, b) => (String(a.remindAt) < String(b.remindAt) ? -1 : 1));
    res.json(salida);
  });

  mountLocalRouter('/api/reminders', router);

})();
