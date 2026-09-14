# Calendario — cambios y qué probar

Rama: `calendario-notas-movil-UI` (compartida con Notas, que tiene su
propio archivo). Lo nuevo va arriba.
Cómo se escribe esto: `cambios/_COMO-SE-USA.md`.

---

## v0.57.0 — Eventos que se repiten

**Qué cambió**
- Un evento puede repetirse: diaria, semanal, mensual o anual, con "cada
  N" y con varios días de la semana en una sola regla.
- Al editar o borrar una de las veces, pregunta si es **solo esa vez o
  todas**.

**Qué probar**
- [ ] **Los avisos de una serie**: antes las veinte veces compartían id y
      **solo sonaba la última**. Ahora cada vez lleva el suyo. Comprobar
      que suenan varios días seguidos.
- [ ] Que el cupo del teléfono no se agota: iOS solo guarda ~64 avisos y
      a partir de ahí **deja de avisar en silencio**. Una serie gasta como
      mucho 10. Mirar el contador de Configuración → Notificaciones.
- [ ] Un mensual el día 31: tiene que SALTARSE febrero y abril, no
      recolocarse al 28 ni al 1.
- [ ] Una serie que cruce el cambio de hora: el reloj no debe correrse.

**Decisiones**
- **NO se generan filas**: el evento sigue siendo uno y lo que se guarda
  es la REGLA. Cambiar la hora las cambia todas de golpe y no hay nada
  que limpiar.
- **"Preguntar cada vez"** al editar o borrar, elegido frente a decidirlo
  por ti.
- **Una regla inválida se guarda como "no se repite"**, nunca se rechaza
  el evento entero.

---

## v0.57.0 — Horario semanal fijo

**Qué cambió**
- Pantalla propia (tercer acceso rápido del calendario, junto a Hoy y
  Grupos): la rejilla de horas × días para lo que se repite toda la
  semana.
- La franja se estira sola si tienes un bloque fuera de 8:00–22:00.

**Qué probar**
- [ ] **Con el teléfono en reloj de 12 h**: que la etiqueta de la hora
      quepa en su canalón y se lea la hora, no ":00 a. m.".
- [ ] Nombres largos en las siete columnas de un móvil: se parten
      ("Gimna/sio"). Es el límite real del ancho; la alternativa (enseñar
      3 días y deslizar) está **sin decidir** y es tuya.

**Decisiones**
- **Tabla propia, no eventos con regla de repetición.** Un horario no
  tiene fecha: metido en el calendario, cada semana taparía lo que de
  verdad pasa ese día.
- **No programa ningún aviso**: el cupo del teléfono es de los
  recordatorios, y un horario sonando cada semana se lo comería.
- Dos bloques que se solapen se dibujan uno encima del otro: no estás en
  dos clases a la vez.

---

## v0.57.0 — El botón "Hoy"

**Qué cambió**
- Ahora recoloca también el mes y el año, no solo la vista diaria. Antes,
  viniendo de mayo de 2016, al salir del día volvías a mayo de 2016.
