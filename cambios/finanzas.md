# Finanzas — cambios y qué probar

Rama: `finanzas-movil`. Lo nuevo va arriba.
Cómo se escribe esto: `cambios/_COMO-SE-USA.md`.

> **Esta App está EN DESARROLLO** (Koku, 14/9/2026). O sea que lo de
> abajo es lo último que llegó a `desarrollador`, no el estado de la
> rama: ahí puede haber trabajo a medias que todavía no ha venido.
> Antes de dar nada por bueno, mirar qué commits tiene `finanzas-movil`
> que no estén aquí.

---

## v0.55.0 — Revisión del merge

**Qué cambió**
- Los porcentajes se escriben como el dinero: con coma decimal y
  agrupando los miles. Un +1900% salía "1900%" al lado de un
  "1.900,00 €".
- Un porcentaje imposible (texto, nulo, infinito) se lee como 0 en vez de
  dejar un "NaN%".

**Qué probar**
- [ ] Un gasto que se multiplique por mucho, para ver el porcentaje con
      su punto de millar.

---

## v0.50.0 — El inicio, de tarjetas a filas

**Qué cambió**
- Las siete secciones se ven de un vistazo (de ~1000 px a 566).
- **Se pintan SIEMPRE las siete**, aunque estén vacías: antes, sin
  objetivos no había tarjeta de Objetivos y no había forma de crear el
  primero.
- Los iconos de sección pasaron a SVG (los de una categoría o un objetivo
  siguen siendo tu emoji, que eso es contenido tuyo).

**Qué probar**
- [ ] Con la base casi vacía: que se pueda entrar en las siete y empezar.
- [ ] Que la última fila de Movimientos no se quede debajo de la barra de
      apps (hay un colchón de 7rem reservado; si la barra cambia de alto,
      ese número va con ella).

**Decisiones**
- **Regla que salió de aquí y conviene generalizar**: un apartado vacío
  tiene que poder abrirse, es la única forma de empezar a usarlo.
