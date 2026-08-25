# Sistema de estilos — panel oscuro / técnico

Guía de diseño extraída de una herramienta de seguimiento ya construida. Sirve como referencia para aplicar el mismo estilo visual (colores, tipografía, botones, tablas, etc.) a otro proyecto.

Archivos de referencia: `estilos-panel-oscuro.css` (hoja de estilos lista para importar) y `seguimiento_puertas.html` (ejemplo real de uso).

---

## 1. Concepto general

Estética de **panel técnico oscuro**, tipo herramienta de inspección/registro industrial. Fondo oscuro con una cuadrícula sutil de fondo (efecto "plano técnico"), acentos en naranja, y tipografía monoespaciada para datos/IDs combinada con una sans-serif para texto general.

---

## 2. Paleta de colores

| Variable | Valor | Uso |
|---|---|---|
| `--bg` | `#12181f` | Fondo general de la página |
| `--panel` | `#1a222b` | Fondo de tarjetas/paneles |
| `--panel-2` | `#20303a` | Fondo de inputs y elementos "hundidos" (inputs, celdas hover) |
| `--line` | `#2c3947` | Bordes por defecto |
| `--grid` | `#233240` | Líneas de la cuadrícula de fondo y bordes de tabla |
| `--accent` | `#ff8a3d` | Color principal de acción (naranja) — botones primarios, selección activa |
| `--accent-dim` | `#7a4623` | Versión atenuada del acento, para hovers suaves |
| `--ok` | `#4fd1a5` | Verde — éxito / confirmación |
| `--warn` | `#f2c14e` | Amarillo — aviso |
| `--danger` | `#e24b4a` | Rojo — error / eliminar |
| `--info` | `#7fb2ff` | Azul — informativo |
| `--text` | `#e7edf2` | Texto principal |
| `--text-mute` | `#8fa1ac` | Texto secundario, etiquetas, placeholders |

**Regla de uso:** el naranja (`--accent`) se reserva para la acción principal y para indicar selección activa (ej. una puerta seleccionada, un filtro activo). No se usa como color decorativo suelto.

---

## 3. Tipografía

- **Monoespaciada** (`'Roboto Mono', 'Courier New', monospace`): para cualquier dato, ID, cifra, tabla, etiquetas en mayúsculas, nombres de campo. Refuerza la sensación de "panel técnico / log".
- **Sans-serif del sistema** (`-apple-system, 'Segoe UI', Roboto, Arial, sans-serif`): para texto general, comentarios, descripciones largas, títulos.
- Las etiquetas de campo (`.label`) van en mono, mayúsculas, tamaño 11px, con letter-spacing `.06em` y color `--text-mute` — para que se lean como "metadatos" y no compitan con el contenido.

---

## 4. Fondo con cuadrícula

El `<body>` tiene un fondo con líneas cada 24px simulando papel milimetrado/plano técnico:

```css
background-image:
  linear-gradient(var(--grid) 1px, transparent 1px),
  linear-gradient(90deg, var(--grid) 1px, transparent 1px);
background-size:24px 24px;
```

Es opcional y fácil de quitar si un componente concreto (como el calendario) necesita fondo limpio.

---

## 5. Tarjetas / paneles

Bloques de contenido (`.card`): fondo `--panel`, borde `1px solid var(--line)`, `border-radius: 6px`, padding `16px`. Sin sombras — el contraste viene del color de fondo, no de elevación con sombra.

---

## 6. Campos de formulario

Inputs, textarea, select comparten estilo:
- Fondo `--panel-2` (un tono más "hundido" que la tarjeta que los contiene)
- Borde `1px solid var(--line)`
- `border-radius: 4px`
- Texto en fuente mono, 13px
- **Foco:** el borde cambia a `--accent` (sin sombra de foco, solo cambio de color de borde)
- Placeholder en `--text-mute`

---

## 7. Botones y retroalimentación

Botón base: fondo `--panel-2`, borde `1px solid var(--line)`, texto sans-serif 13px seminegrita.

**Estados de interacción:**
- `hover` → el borde cambia a `--accent` (sin cambiar el fondo, es un cambio sutil)
- `active` (al hacer clic) → `transform: scale(0.97)` para dar sensación física de "pulsado"
- `disabled` → opacidad `.45` y cursor `not-allowed`
- Transición suave en `background`, `border-color` y `transform` (~0.12s, 0.05s para el scale)

**Variantes:**
| Clase | Uso | Estilo |
|---|---|---|
| `.btn-primary` | Acción principal (ej. "añadir registro") | Fondo `--accent` sólido, texto oscuro (`#1a0f05`), ancho completo |
| `.btn-danger` | Acción destructiva (eliminar) | Borde rojo, texto rojo; en hover se rellena de rojo sólido con texto blanco |
| `.btn-ghost` | Acción secundaria discreta (icono de cerrar, eliminar fila) | Sin fondo ni borde; el texto pasa a `--text-mute`, y a `--danger` en hover |

**Regla:** solo un `.btn-primary` por vista/panel — el resto de acciones van en botón base o `.btn-ghost` para no competir visualmente.

---

## 8. Etiquetas (tags) por categoría

Pastillas pequeñas para clasificar datos por tipo/categoría (ej. tipo de puerta, estado de un evento):

- Base: fondo `--panel-2`, borde `1px solid var(--line)`, `border-radius: 3px`, texto mono 10.5px
- Cada categoría tiene su propio color de texto + borde a juego (usando los colores semánticos: accent, ok, info, warn, danger)
- El fondo se mantiene neutro (`--panel-2`) en todas — lo que cambia es el color de texto/borde, para que no compitan visualmente entre sí en una tabla larga

---

## 9. Chips seleccionables (filtros)

Para alternar entre vistas/filtros (ej. "Todos" / "Hoy"):
- Forma de píldora (`border-radius: 20px`)
- Estado inactivo: fondo `--panel-2`, texto `--text-mute`
- Estado **activo**: fondo `--accent` sólido, texto oscuro, seminegrita — mismo tratamiento que `.btn-primary` para reforzar que es "lo seleccionado ahora mismo"

---

## 10. Tablas

- Sin bordes verticales, solo líneas horizontales finas (`border-bottom: 1px solid var(--grid)`)
- Cabeceras (`th`) en mono, mayúsculas, 10.5px, color `--text-mute`, letter-spacing `.04em`
- Celdas de datos en mono; celdas de texto libre/comentarios en sans-serif con color `--text-mute` (para diferenciar "dato estructurado" de "texto libre")
- `hover` de fila: fondo `--panel-2` en toda la fila, para facilitar seguir una línea visualmente

---

## 11. Estados vacíos

Texto centrado, color `--text-mute`, tamaño 13px, con padding vertical generoso (`20px 0`). Sin iconos ni ilustraciones — solo un mensaje breve indicando que no hay datos (ajustado al filtro activo si lo hay).

---

## 12. Principios generales a mantener

1. **Sin gradientes ni sombras decorativas.** Todo el contraste viene de los tonos de `--bg` → `--panel` → `--panel-2` (cada nivel un poco más claro/hundido).
2. **El naranja es el único acento saturado.** Los demás colores (verde, rojo, azul, amarillo) son estrictamente semánticos (éxito, peligro, info, aviso) y no se usan decorativamente.
3. **Mono para datos, sans para prosa.** Esta distinción es la que da la sensación de "panel técnico" y ayuda a escanear tablas rápido.
4. **Feedback físico en botones:** todo elemento clicable tiene como mínimo un cambio de borde en hover y un `scale` en active — nunca un clic "silencioso".
5. **Bordes finos (1px) en vez de sombras** para separar bloques.

---

## 13. Aplicación sugerida a un calendario

Si se aplica esta paleta a una vista de calendario:
- Celdas de día → tratarlas como `.card` en miniatura, o simplemente con `border: 1px solid var(--line)` sobre `--panel`
- Día actual → borde en `--accent` (igual que el foco de un input)
- Día seleccionado → fondo `--accent`, texto oscuro (mismo patrón que chip activo / btn-primary)
- Eventos dentro de una celda → usar el sistema de **tags** (sección 8) coloreados por tipo de evento/categoría
- Días fuera del mes actual → texto en `--text-mute` sobre el mismo fondo, sin cambiar la estructura
