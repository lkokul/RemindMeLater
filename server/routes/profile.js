// routes/profile.js — tu perfil: un nickname que se ve igual en todos tus
// dispositivos (no es un "login" con contrasena, es solo un nombre
// consistente) y un id unico que no cambia nunca aunque cambies el
// nombre. El id esta pensado para el dia que haya mas de un origen
// creando eventos (otra persona, o una integracion automatica) y haga
// falta diferenciar "quien creo esto" aunque compartan nombre.
const express = require('express');
const db = require('../db');

const router = express.Router();

function serialize(row) {
  return { name: row.name, id: row.public_id };
}

router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
  res.json(serialize(row));
});

router.put('/', (req, res) => {
  const { name } = req.body || {};
  db.prepare('UPDATE user_profile SET name = ? WHERE id = 1').run(
    typeof name === 'string' ? name.trim().slice(0, 60) : ''
  );
  const row = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
  res.json(serialize(row));
});

module.exports = router;
