# Retos — cambios y qué probar

Rama: `retos-movil-ui`. Lo nuevo va arriba.
Cómo se escribe esto: `cambios/_COMO-SE-USA.md`.

---

## v0.62.4 — Fuera el ☰ de la cabecera

**Qué cambió**
- Se quita el botón ☰ de Configuración de la cabecera de Retos. Se llega
  a Configuración por la barra de abajo, igual que desde el resto de la
  app.

**Qué probar**
- [ ] En el iPhone, que salir de Retos a Configuración por la barra de
      abajo se siga sintiendo natural sin ese botón.

**Decisiones**
- **Es la misma decisión que ya se tomó en Recetas** (v0.62.3) y la misma
  que llevan las otras seis pantallas completas desde hace tiempo. Retos
  era la última donde el botón se veía de verdad.

**Por qué no se había visto antes**
- Las otras seis (Notas, Herramientas, Gimnasio, Finanzas, Viajes y
  Entretenimiento) **sí llevan el botón en el HTML**, pero oculto por una
  regla de `styles.css` ("sobran en movil"). Retos y Recetas nacieron en
  ramas que no conocían esa regla, así que eran las dos únicas donde
  aparecía. Leyendo el HTML parecía justo lo contrario: que solo a esas
  dos les faltaba algo.
- La comprobación nueva abre **las ocho pantallas** y mide si el botón
  **ocupa sitio**, no si existe en el HTML. Mirando el HTML esto no se
  pillaba.

**Trampa (la misma que en Recetas, y ya mordió)**
- Quitar el `<button>` sin quitar su `addEventListener` de `settings.js`
  deja un `getElementById` a `null`, que **lanza al cargar la página** y
  se lleva media app por delante en silencio. Y el assert de "settings.js
  corrió entero" **no lo pillaba**: miraba funciones que están *hoisted*,
  o sea que existen aunque el archivo aborte. Ahora mira la ÚLTIMA línea
  del archivo (el "volver" de la Tienda). Probado dejando el listener
  huérfano: la comprobación se pone roja.

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
