// routes/reminders.js — que recordatorios estan pendientes o a punto de saltar.
const express = require('express');
const db = require('../db');

const router = express.Router();

// Calcula, en SQL, el instante en que debe saltar cada recordatorio:
// start_at menos reminder_minutes_before. Solo devolvemos los que
// tienen recordatorio configurado, ordenados por cuando toca avisar.
router.get('/upcoming', (req, res) => {
  const rows = db
    .prepare(`
      SELECT e.id, e.title, e.start_at, e.reminder_minutes_before, e.reminder_sent,
             g.name AS group_name, g.color AS group_color,
             datetime(e.start_at, '-' || e.reminder_minutes_before || ' minutes') AS remind_at
      FROM events e
      LEFT JOIN groups g ON g.id = e.group_id
      WHERE e.reminder_minutes_before IS NOT NULL
      ORDER BY remind_at ASC
    `)
    .all();

  res.json(
    rows.map((r) => ({
      eventId: r.id,
      title: r.title,
      startAt: r.start_at,
      remindAt: r.remind_at,
      reminderSent: !!r.reminder_sent,
      groupName: r.group_name || null,
      groupColor: r.group_color || null,
    }))
  );
});

module.exports = router;
