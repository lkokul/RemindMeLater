// Fusiona una tanda de instrucciones traducidas (batch-N-es.txt, formato
// @@id + una linea por paso) dentro de gym-exercise-library.json.
// Comprueba que cada ejercicio de la tanda exista y que el numero de
// pasos coincida con el original -- si algo no cuadra, aborta sin tocar
// el JSON. Uso: node merge-instructions.js <batch-es.txt> <library.json>
const fs = require('fs');

const [, , batchFile, libFile] = process.argv;
const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
const byId = new Map(lib.map((e) => [e.id, e]));

const raw = fs.readFileSync(batchFile, 'utf8').replace(/\r\n/g, '\n');
const chunks = raw.split('@@').map((c) => c.trim()).filter(Boolean);

let updated = 0;
const problems = [];
for (const chunk of chunks) {
  const lines = chunk.split('\n');
  const id = lines[0].trim();
  const steps = lines.slice(1).map((l) => l.trim()).filter(Boolean);
  const entry = byId.get(id);
  if (!entry) { problems.push(`id desconocido: ${id}`); continue; }
  if (entry.instructions.length !== steps.length) {
    problems.push(`${id}: ${steps.length} pasos traducidos vs ${entry.instructions.length} originales`);
    continue;
  }
  entry.instructions = steps;
  updated += 1;
}

if (problems.length > 0) {
  console.error('NO SE FUSIONO NADA. Problemas:');
  problems.forEach((p) => console.error(' -', p));
  process.exit(1);
}

fs.writeFileSync(libFile, JSON.stringify(lib));
console.log(`OK: ${updated} ejercicios con instrucciones en español fusionados en ${libFile}`);
