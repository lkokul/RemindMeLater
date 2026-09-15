# Traducción por tandas de las instrucciones de la librería de Gimnasio

Las instrucciones de `public/gym-exercise-library.json` (876 ejercicios,
de yuhonas/free-exercise-db) vienen en inglés y se van traduciendo al
español POR TANDAS. Los nombres/músculos/material ya están en español
desde el primer día — esto es solo para los pasos de cada ficha.

## Estado

- **Traducidos: 200 / 876** (tandas 1-5; las tandas 4-5 traducidas
  directamente por Claude en vez de DeepL, mismo formato y fusión). El
  orden de prioridad está en `priority-ids.json`: primero fuerza con
  material común (barra/mancuernas/peso corporal/polea/máquina) de nivel
  principiante→avanzado, después el resto. Las tandas hechas cubren las
  posiciones 0-199 de esa lista. Siguiente: DESDE = 200.

## Cómo hacer una tanda nueva

1. Extraer el siguiente bloque de 40 en formato texto plano:
   ```
   node -e "
   const lib = JSON.parse(require('fs').readFileSync('public/gym-exercise-library.json','utf8'));
   const order = JSON.parse(require('fs').readFileSync('tools/gym-library-i18n/priority-ids.json','utf8'));
   const byId = new Map(lib.map(e=>[e.id,e]));
   const DESDE = 120; // <-- actualizar al siguiente indice pendiente
   const batch = order.slice(DESDE, DESDE+40).map(id=>byId.get(id));
   let out = ''; for (const e of batch) out += '@@' + e.id + '\n' + e.instructions.join('\n') + '\n';
   require('fs').writeFileSync('batch-en.txt', out);
   "
   ```
2. Traducir `batch-en.txt` → `batch-es.txt` manteniendo EXACTAMENTE el
   formato: línea `@@id` + una línea por paso (mismo número de pasos).
3. Fusionar (aborta sin tocar nada si algo no cuadra):
   ```
   node tools/gym-library-i18n/merge-instructions.js batch-es.txt public/gym-exercise-library.json
   ```
4. Actualizar el contador de "Estado" de este archivo y commitear el
   JSON + este archivo.

Nota: los ejercicios aún sin traducir muestran sus instrucciones en
inglés en la ficha — funcional, solo menos cómodo. No bloquea nada.
