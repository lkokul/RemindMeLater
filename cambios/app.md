# La app en sí — cambios y qué probar

Lo transversal, que no es de ninguna App: Tienda, copia de seguridad,
widgets, temas, tipografía, gestos, seguridad. Se trabaja en
`desarrollador`. Lo nuevo va arriba.
Cómo se escribe esto: `cambios/_COMO-SE-USA.md`.

---

## v0.62.0 — Las imágenes no son solo de Notas (pérdida de datos)

**Qué cambió**
- El almacén de imágenes lo comparten **cuatro** Apps: Notas,
  Entretenimiento (portadas), Recetas (fotos) y Viajes (adjuntos). La
  copia por Apps daba por hecho que era de Notas, y de ahí salían dos
  agujeros:
  1. Exportando sin marcar Notas, las portadas, fotos y adjuntos se
     quedaban fuera.
  2. Restaurar una copia parcial **vaciaba** ese almacén, o sea que
     restaurar solo Notas se llevaba por delante las fotos de las otras
     tres Apps.
- Ahora entran si entra cualquiera de las cuatro, y una restauración
  parcial **solo suma imágenes, nunca borra**.

**Qué probar (esto merece la pena probarlo de verdad)**
- [ ] Exportar marcando **solo Recetas** y mirar que el archivo pesa lo
      que tiene que pesar (con las fotos dentro).
- [ ] Restaurar esa copia parcial y comprobar que las portadas de
      Entretenimiento **siguen ahí**.
- [ ] Que una copia COMPLETA sigue haciendo borrón y cuenta nueva.

**Decisiones**
- **Si entra cualquiera de las cuatro, van todas las imágenes.** No se
  pueden repartir por App sin mirar fila por fila quién usa cada uuid:
  sobra peso en el archivo, nunca faltan fotos.
- Si aparece una App nueva que suba imágenes, **va a
  `BACKUP_APPS_CON_ARCHIVOS`**.

---

## v0.58.0 — La Tienda

**Qué cambió**
- Configuración → Tienda: las ocho Apps con su ficha, encender/apagar,
  manual y sus notas de versión.
- Apagada significa cuatro cosas: fuera de Herramientas, fuera del
  selector del acceso rápido, sin widget, y desmarcada en la copia.

**Qué probar**
- [ ] Apagar Viajes y comprobar que **no se pierde nada**: al encenderla
      otra vez tienen que estar todos tus viajes.
- [ ] Apagarlas TODAS: la barra de abajo no puede quedarse con un botón
      vacío (cae a Notas).

**Decisiones**
- **Todas se pueden apagar menos el Calendario.**
- **Retos y Recetas vienen ENCENDIDAS** con etiqueta de "en desarrollo":
  son nuevas pero están terminadas, y naciendo apagadas parecería que el
  merge se las ha comido.
- **Solo el manual del Gimnasio**, para validar el tono antes de escribir
  los otros siete.

---

## Pendiente de decidir (tuyo)

- `PARA-KOKU-MAÑANA.md`: ocho dudas de diseño, tres cosas que se salen de
  la filosofía de la app, y el papeleo de las dos tiendas. **No se empieza
  nada de ahí sin tu respuesta.** Entre ellas: B1 (el acento por defecto
  no llega a 4,5:1) y C1 (la copia de seguridad va sin cifrar).
- `IDEAS-AYUDAS.md`: la lista de botones "?" candidatos, esperando a que
  marques cuáles quieres.
- Los manuales de las otras siete Apps.
- **Android**: `ANDROID-PENDIENTE.md`. Lo más gordo — el icono y el
  splash son los de Capacitor por defecto, y el botón ATRÁS cierra la app
  en vez de retroceder.
