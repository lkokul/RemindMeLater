// scripts/stop-server.js — mata cualquier cosa escuchando en los puertos de
// RemindMeLater (3000 HTTP, 3001 HTTPS por defecto), para cuando cerrar la
// terminal (o la ventana de Electron) no libera el puerto solo y "npm run
// dev" se niega a arrancar diciendo que ya esta en uso.
//
// Por que pasa esto: "npm run dev" es en realidad una cadena de TRES
// procesos anidados en Windows (npm-cli.js -> node --watch -> el
// server/index.js de verdad) -- cerrar la ventana de la terminal no
// siempre le llega a los tres, sobre todo con node --watch (relativamente
// nuevo). Esto no es un fallo del propio RemindMeLater, es una forma
// fiable de "desatascarlo" sin tener que ir al Administrador de tareas a
// mano cada vez.
const { execSync } = require('child_process');

const PORTS = [Number(process.env.PORT) || 3000, Number(process.env.HTTPS_PORT) || (Number(process.env.PORT) || 3000) + 1];

for (const port of PORTS) {
  let output;
  try {
    output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
  } catch (err) {
    console.log(`Puerto ${port}: nada escuchando.`);
    continue;
  }

  const pids = new Set(
    output
      .split('\n')
      .map((line) => line.trim().split(/\s+/).pop())
      .filter(Boolean)
  );

  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F /T`);
      console.log(`Puerto ${port}: proceso ${pid} cerrado.`);
    } catch (err) {
      console.warn(`Puerto ${port}: no se pudo cerrar el proceso ${pid}.`);
    }
  }
}
