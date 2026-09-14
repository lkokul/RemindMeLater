# Entretenimiento — cambios y qué probar

Rama: `entretenimiento-movil`. Lo nuevo va arriba.
Cómo se escribe esto: `cambios/_COMO-SE-USA.md`.

---

## v0.62.0 — Vitrina de portadas, sesiones, racha y vueltas

**Qué cambió**
- La tabla de 7 columnas con scroll lateral se fue: ahora es una rejilla
  de portadas. Si no pones imagen se genera una con el color del tipo.
- La portada de verdad la pones tú, de la galería o la cámara. Nada de
  buscarla por internet.
- Cinco pestañas: Siguiendo (abre aquí) · Colecciones · Deseos ·
  Historial · Actividad. Las tres transversales cruzan todas tus
  colecciones.
- Cada vez que subes el progreso queda apuntada una sesión sola ("el
  martes leí del 12 al 15"). De ahí salen la racha diaria, el mapa de 26
  semanas y el resumen del año.
- "Volver a empezar" para relecturas: sube la vuelta y pone el progreso a
  cero sin borrar lo anterior.
- Ya se puede mover un item de colección, y crear la colección nueva ahí
  mismo.
- Borrar un item o una colección ya no usa el cuadro del navegador.

**Qué probar**
- [ ] **La migración sobre TUS datos**: la tabla `entretenimiento_sesiones`
      y la columna `vuelta` son nuevas. Mira que no se haya perdido
      ninguna portada, nota, género ni préstamo de lo que ya tenías.
- [ ] Que las portadas se vean bien en la rejilla a tu ancho de pantalla,
      y que la generada se lea (texto sobre color).
- [ ] Subir una portada desde la cámara, no solo desde la galería.
- [ ] Que la racha diga lo que esperas a primera hora de la mañana (no
      debería romperse a las 00:01 por no haber abierto la app).
- [ ] **El widget**: su destino pasó de `remindmelater://lecturas` a
      `entretenimiento`, con el viejo conservado como alias. Un widget que
      ya tuvieras puesto tiene que seguir abriendo la App **antes** de
      volver a repintarse.

**Decisiones**
- **Las sesiones se apuntan SOLAS**, sin gesto nuevo: de tres formas
  posibles elegiste esta. Solo cuenta SUBIR; crear un item no apunta
  nada, y corregir hacia atrás tampoco.
- **No hay cronómetro**, descartado a propósito (para series y pelis no
  aporta). La columna existe vacía para no migrar el día que se añada.
- **La pestaña elegida no se recuerda** entre aperturas: volver siempre a
  "Siguiendo" es la gracia.
- **Logros: se ofrecieron y no los marcaste.** Siguen sin hacer.

---

## v0.61.0 — Lecturas pasa a llamarse Entretenimiento

**Qué cambió**
- Renombrado completo: las tablas son `entretenimiento_*` (con migración
  desde `lecturas_*`), y la pantalla y el hub lo dicen.

**Qué probar**
- [ ] Que tus sagas e items de antes del renombrado siguen ahí enteros.

**Decisiones**
- **El id interno sigue siendo `lecturas`** en la Tienda, en el hueco de
  la barra, en la copia de seguridad y en el resumen que lee Swift. Solo
  cambia el nombre visible. Renombrar el id obligaría a tocar el Swift.
