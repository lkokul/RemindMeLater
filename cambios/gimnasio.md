# Gimnasio — cambios y qué probar

Rama: `gimnasio-movil`. Lo nuevo va arriba.
Cómo se escribe esto: `cambios/_COMO-SE-USA.md`.

---

## v0.60.0 — Salir a correr en series (intervalos)

**Qué cambió**
- Medición `intervalos`: tramo fuerte, tramo suave y vuelta a empezar,
  **encadenándose solos**. No hay que tocar el móvil mientras corres.
- Cuenta atrás de preparación antes de empezar, ajustable en el momento.
- Dos avisos distintos al correr: "aprieta" (3 pulsos muy seguidos) y
  "afloja" (2 cortas espaciadas), más el de siempre para un descanso
  normal.
- Al acabar el bloque se pregunta la distancia, una sola vez.

**Qué probar (esto es TODO de calle, aquí no se puede)**
- [ ] Con el móvil en el brazo y música puesta: que cada cambio de tramo
      se note en la mano sin mirar.
- [ ] **Pausar a mitad de tramo** (atarte un cordón): el tramo NO debe
      cerrarse solo y darte la serie por buena.
- [ ] Dejar la app dormida un rato largo y volver: tiene que cerrar UNA
      serie, no dar por hechas de golpe las que no has corrido.
- [ ] Que la distancia quede bien escrita ("6,2 km", "800 m", "5 km").

**Decisiones**
- **NO hay motor nuevo**: un intervalo es una serie por tiempo con su
  descanso detrás, que es lo que ya sabía hacer el entreno en vivo.
- **Ni una columna nueva**: el tramo fuerte es `default_seconds`, el
  suave `default_rest_seconds` y las veces `default_sets`.
- **La vibración aquí NO es opcional**: el ajuste manda en todo lo demás,
  pero sin ella este modo no sirve.
- **Distancia a mano, no HealthKit**: leerla de Salud pide un permiso
  nuevo del sistema, una capacidad nueva en el App ID y declararlo en la
  ficha de la App Store. Dijiste "tiempos y distancia a mano y au".
- Sonido del montón (`1007`), una sola vez, siguiendo el interruptor de
  Configuración.

---

## v0.60.0 — La gráfica y los récords, con ejercicios por tiempo

**Qué cambió**
- La gráfica de un ejercicio por tiempo ya no es una línea plana a cero:
  los dos botones cambian de nombre (`Mejor tiempo / Tiempo total`).
- Una plancha vuelve a salir en Récords, con el aguante como cifra grande
  en vez de un "1RM est. 0 · Vol. 0" que ahí no significa nada.

**Qué probar**
- [ ] Abrir la gráfica de una plancha tuya y ver que pinta algo.

---

## v0.59.0 — Salir del Gimnasio deslizando

**Qué cambió**
- El gesto central hacia la derecha tiene dos pasos, como en Finanzas: de
  una sección al inicio, y del inicio a Herramientas.

**Qué probar**
- [ ] Que no se pisa con el arrastre de mover un ejercicio.

**Decisiones**
- Solo Finanzas y Gimnasio. **Entretenimiento y Viajes siguen fuera a
  propósito**: allí el inicio es una lista de contenido, no un menú.

---

## Pendiente de antes, sin hacer

- El cronómetro de una serie por tiempo **no avisa** al llegar al
  objetivo. Sonar o vibrar se pisaría con el aviso de fin de descanso —
  es una decisión aparte porque toca notificaciones.
- El tiempo estimado no usa todavía el objetivo de las series por tiempo.
- `set_count` de `/summary` (racha, heatmap, mapa de músculos, objetivo
  semanal) **sigue contando cada lado de un unilateral como una serie**.
  Cambiarlo reescribiría hacia atrás todos esos números.
- Las instrucciones de los ~870 ejercicios de la librería siguen en
  inglés (pendientes las tandas de DeepL).
