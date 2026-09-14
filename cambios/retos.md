# Retos — cambios y qué probar

Rama: `retos-movil-ui`. Lo nuevo va arriba.
Cómo se escribe esto: `cambios/_COMO-SE-USA.md`.

---

## v0.61.0 — La App entra en el repositorio

**Qué cambió**
- App nueva: un árbol donde cada fila es una tarea que solo se marca.
  Dos tipos: **hábito** (se marca cada periodo y se desmarca solo al
  empezar el siguiente, con racha) y **meta** (se llega una vez).
- Frecuencia por hábito: cada día / semana / mes / cada X días.
- Los subretos rellenan la barra del padre ("3 de 5") pero no lo marcan.
- Buscador sobre el árbol entero, con la ruta de cada resultado.

**Qué probar**
- [ ] Que un hábito diario marcado ayer siga diciendo "racha de N" a
      media mañana de hoy, con su casilla vacía. (La racha no se rompe
      hasta que el periodo pasa.)
- [ ] Un "cada X días": se ancla al día en que lo creaste, no a una
      rejilla del calendario.
- [ ] Marcar a las 00:30: tiene que marcar HOY, no ayer.
- [ ] Que la copia de seguridad de Retos guarda y restaura sus dos tablas
      (se dio de alta al fusionar, la rama no lo traía).

**Decisiones**
- **NO MIDE NADA** — ni repeticiones, ni kilos, ni tiempo. Es decisión
  tuya, no una limitación. Si hiciera falta medir, eso es el Gimnasio.
- **Marcar el padre marca a sus descendientes; desmarcar no toca a
  nadie**, para que deshacer un toque mal dado no borre lo hecho.
- **"Mover" reordena entre hermanos, no cambia de padre.** Hoy no hay
  forma de reparentar un reto ya creado: es la consecuencia de esa
  elección, no un olvido. La ruta ya lo acepta, falta la pantalla.
- **Deslizar a la derecha NO sale a Herramientas** desde Retos (eso solo
  lo hacen Finanzas y Gimnasio).
