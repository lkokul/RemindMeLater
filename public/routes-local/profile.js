// profile — portado de server/routes/profile.js.
//
// Copia mecanica del archivo del servidor: la logica y el SQL son los
// mismos, solo cambia la fontaneria (sin require/module.exports de
// Node, y envuelto en un IIFE para que los nombres repetidos entre
// rutas no choquen al cargarse todas como <script> en el mismo ambito).
(function () {
  const db = localDb;
  // routes/profile.js — tu perfil: un nickname que se ve igual en todos tus
  // dispositivos (no es un "login" con contrasena, es solo un nombre
  // consistente) y un id unico que no cambia nunca aunque cambies el
  // nombre. El id esta pensado para el dia que haya mas de un origen
  // creando eventos (otra persona, o una integracion automatica) y haga
  // falta diferenciar "quien creo esto" aunque compartan nombre.
  //
  // "email" es mas nuevo: solo se usa como contacto tecnico obligatorio
  // del protocolo Web Push (VAPID, ver server/push.js) al mandar
  // notificaciones push al movil -- nunca se muestra en la interfaz ni se
  // manda a nadie salvo a Google/Apple para ese uso puntual. Opcional: sin
  // el, simplemente no se pueden activar las notificaciones push.

  const router = createLocalRouter();

  function serialize(row) {
    const onboardingRow = db.prepare("SELECT value FROM app_settings WHERE key = 'onboarding_completed'").get();
    return {
      name: row.name,
      id: row.public_id,
      email: row.email || '',
      onboardingCompleted: onboardingRow ? onboardingRow.value === '1' : false,
    };
  }

  router.get('/', (req, res) => {
    const row = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
    res.json(serialize(row));
  });

  // Se usa tanto para guardar de verdad (desde Configuracion > Perfil, o
  // desde el modal de bienvenida al pulsar "Guardar") como para solo
  // marcar que la pantalla de bienvenida ya se vio (el boton "Ahora no"
  // del modal llama aqui con el body vacio, sin tocar nombre ni correo) --
  // en los dos casos, CUALQUIER llamada a este endpoint marca el primer
  // arranque como completado, asi que ni una edicion normal posterior
  // vuelve a disparar el modal.
  router.put('/', (req, res) => {
    const { name, email } = req.body || {};
    const existing = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
    db.prepare('UPDATE user_profile SET name = ?, email = ? WHERE id = 1').run(
      typeof name === 'string' ? name.trim().slice(0, 60) : existing.name,
      typeof email === 'string' ? email.trim().slice(0, 200) : existing.email
    );
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('onboarding_completed', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();

    const row = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
    res.json(serialize(row));
  });

  mountLocalRouter('/api/profile', router);

})();
