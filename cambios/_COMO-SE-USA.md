# La carpeta `cambios/`

Un archivo por ÁREA, no por rama. Cada uno lleva lo que se ha tocado en
esa área y —lo importante— **qué hay que probar en el iPhone**.

Existe para una cosa concreta: que al fusionar una rama hacia
`desarrollador`, y al probar la build que sale de ahí, no haya que
reconstruir de memoria (ni leyendo diffs) qué cambió y qué conviene
mirar. El diff dice QUÉ líneas cambiaron; esto dice qué se rompería si
algo está mal.

## Por qué el nombre lleva el área

Si todas las ramas usaran el mismo nombre de archivo, **cada merge daría
conflicto sin falta**: siete ramas escribiendo cosas distintas en la
misma ruta. Con un archivo por área, dos ramas nunca tocan el mismo, y
`desarrollador` los va acumulando sin pelearse.

Por eso `calendario-notas-movil-UI` tiene DOS (`calendario.md` y
`notas.md`) aunque sea una sola rama: son dos áreas, y si algún día se
parten en dos ramas no hay nada que mover.

## Las áreas

| Archivo | Rama donde se trabaja |
|---|---|
| `calendario.md` | `calendario-notas-movil-UI` |
| `notas.md` | `calendario-notas-movil-UI` |
| `gimnasio.md` | `gimnasio-movil` |
| `finanzas.md` | `finanzas-movil` |
| `entretenimiento.md` | `entretenimiento-movil` |
| `viajes.md` | `viajes-movil` |
| `retos.md` | `retos-movil-ui` |
| `recetas.md` | `recetas-movil-ui` |
| `app.md` | `desarrollador` (lo transversal: Tienda, copia, widgets, temas…) |

## La forma de una entrada

Lo nuevo va **arriba del todo**, y lleva las tres cosas:

```markdown
## Sin fusionar — <titulo corto>

**Qué cambió**
- ...

**Qué probar**
- [ ] ...

**Decisiones**
- ...
```

- **Qué cambió**: en una línea por cosa, en castellano y no en nombres de
  función. Lo que vería un usuario.
- **Qué probar**: casillas, y solo lo que **no se puede comprobar desde
  aquí** — el iPhone de verdad, los avisos, los widgets, las
  migraciones sobre datos tuyos. Lo que ya cubre una prueba de Playwright
  no hace falta ponerlo.
- **Decisiones**: lo que eligió Koku y **no se deshace sin volver a
  preguntarle**. Es lo que más se pierde al cambiar de conversación.

Al fusionar, ese `## Sin fusionar — X` pasa a `## v0.62.0 — X` y se queda
como historial. No se borra nada: así se ve qué entró en cada versión y
qué llegaste a probar.

## La regla, en una frase

**Si has tocado algo, tiene entrada antes de commitear.** Está también en
CLAUDE.md, en "Reglas de trabajo que Koku ha pedido explícitamente".
