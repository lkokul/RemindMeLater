# Recetas — cambios y qué probar

Rama: `recetas-movil-ui`. Lo nuevo va arriba.
Cómo se escribe esto: `cambios/_COMO-SE-USA.md`.

---

## v0.62.0 — Calorías y macros

**Qué cambió**
- Cada ingrediente puede llevar, si quieres, los ocho valores de una
  etiqueta: calorías, proteínas, grasas, saturadas, hidratos, azúcares,
  fibra y sal, por 100 g o por 100 ml. El bloque nace plegado.
- La receta suma sola: calorías por ración y el desglose, y escala con
  las raciones.
- Si a un ingrediente le faltan los valores, suma lo que sabe y dice cuál
  falta.
- Para lo que midas en unidades (2 huevos) puedes decir cuánto pesa una.

**Qué probar**
- [ ] Una receta con ingredientes en g, en ml y en unidades a la vez: que
      la cuenta salga y que el aviso nombre solo a los que de verdad
      faltan.
- [ ] Que un ingrediente **opcional** sin valores no salga en el aviso.
- [ ] Escalar la receta: las calorías **por ración** no deben cambiar, el
      plato entero sí. Es correcto, no un fallo.
- [ ] Que un plato de más de 1000 kcal salga con el punto de millar.

**Decisiones**
- **Van en el INGREDIENTE, no en la receta**: lo escribes una vez y sirve
  para todas. Misma lógica que el catálogo.
- **Todo opcional** ("no todo el mundo va a estar pensando en esto"): por
  eso nace plegado y la sección de Nutrición no se pinta si no hay ni un
  valor.
- **Vacío NO es cero**: un campo sin rellenar no aporta. Guardar un 0
  hundiría el total del plato sin que se notara.

---

## v0.61.0 — La App entra en el repositorio

**Qué cambió**
- App nueva: platos con foto, tiempos y raciones, en carpetas y con
  etiquetas. Ingredientes como ficha propia, lista de la compra que se
  deriva de las recetas, y compras anteriores archivadas.

**Qué probar**
- [ ] Que la copia de seguridad de Recetas guarda **y restaura** sus siete
      tablas (se dio de alta al fusionar, la rama no lo traía).
- [ ] Que las fotos sobreviven a duplicar una receta y a borrar la copia.

**Decisiones**
- **Un ingrediente es una FICHA, no texto.** Es lo que deja sumar
  "300 g + 200 g de pollo" en una línea, y a lo que se le colgará el
  precio el día que se enganche con Finanzas.
- **Una línea es (INGREDIENTE, UNIDAD)**: 200 g de pollo y 2 ud de pollo
  son dos líneas. Es feo y es correcto.
- **Precios, Finanzas y tareas quedaron para después** ("por ahora lo
  básico").
