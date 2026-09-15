# Viajes — cambios y qué probar

Rama: `viajes-movil`. Lo nuevo va arriba.
Cómo se escribe esto: `cambios/_COMO-SE-USA.md`.

---

Sin rondas propias desde que se empezó a llevar este registro
(14/9/2026): la rama estaba al día y no traía nada nuevo en las dos
últimas tandas de merges.

**Lo que conviene no perder de vista al retomarla**

- Los **adjuntos de una entrada viven en el mismo almacén que las
  imágenes de las notas** (`noteAssets`). Desde la v0.62.0 la copia de
  seguridad se los lleva si entra cualquiera de las cuatro Apps que
  guardan archivos — si aparece otra que suba imágenes, hay que añadirla
  a `BACKUP_APPS_CON_ARCHIVOS`.
- El mapa se distingue **por velocidad**: arrastrar despacio mueve el
  mapa, un gesto rápido navega. Es como lo pediste.
- **Deslizar para salir de la App no está puesto aquí a propósito**: el
  inicio de Viajes ya es una lista de contenido, no un menú de secciones.
- `.viajes-tabs` es la única barra de sub-pestañas que queda en
  `MOBILE_SUBTAB_BARS`.
