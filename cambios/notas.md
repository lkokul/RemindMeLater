# Notas — cambios y qué probar

Rama: `calendario-notas-movil-UI` (compartida con Calendario, que tiene
su propio archivo). Lo nuevo va arriba.
Cómo se escribe esto: `cambios/_COMO-SE-USA.md`.

---

## v0.62.1 — La mayúscula del teclado al bajar del título al párrafo

**Qué cambió**
- Bajando del título al primer párrafo, la línea nueva salía en
  minúscula; de párrafo a párrafo sí ponía la mayúscula. Ya no.

**Qué probar (esto SOLO se puede ver en el iPhone)**
- [ ] Escribir un título, dar a Intro y empezar a escribir: la primera
      letra tiene que salir en mayúscula sola.
- [ ] Que la línea sigue bajando a **párrafo normal**, no a otro título
      — que era el riesgo real de la reescritura.
- [ ] Salir de una **cita** y salir de una **lista** siguen sin tocar, y
      tienen el mismo problema. Si el del título te funciona, dilo y les
      damos el mismo tratamiento (cada uno es un camino distinto).

**Decisiones**
- **La regla general que sale de aquí**: mientras el usuario escribe, el
  salto de línea lo tiene que dar el NAVEGADOR. `autocapitalize` no lo
  decide el HTML, lo decide el teclado del sistema, y solo rehace su
  cuenta cuando el propio navegador mueve el cursor. Un
  `preventDefault()` + DOM a mano le deja el estado "a media frase", y
  eso es minúscula.
- Chromium **ya hacía lo que queríamos** (Intro al final de un `<h1>`
  arranca un `<div>`): el código de antes se peleaba con el navegador
  para acabar donde el navegador ya iba. El `formatBlock` que queda es
  una red por si Safari sí continúa el título.
- **Aquí no se puede probar la mayúscula**: en el navegador de pruebas
  `autocapitalize` es un no-op y no hay WebKit en el contenedor.

---

## v0.57.0 — El título nace con formato de título

**Qué cambió**
- Una nota nueva arranca con la primera línea dentro de un `<h1>`, así
  que no hay que ponerle el formato cada vez.
- Intro al final del título baja a un párrafo normal.
- Mayúscula automática al empezar frase, también en listas, celdas de
  tabla y el propio título.

**Qué probar**
- [ ] En el iPhone: que Intro al final del título baje de verdad a texto
      normal. El teclado de iOS **no siempre manda un `keydown` con
      Enter** (con el texto predictivo llega como `'Unidentified'`), por
      eso está enganchado también a `beforeinput`. Es la misma trampa que
      mordió con las fórmulas.
- [ ] Que una nota YA escrita conserve su formato: esto solo siembra las
      nuevas.
- [ ] Que una nota nueva en blanco se siga sin guardar.

---

## v0.49.1 — Las fórmulas, en Safari

**Qué cambió**
- Intro no fijaba la fórmula en el iPhone (en Chrome iba perfecto). Era
  un fallo solo de Safari: al partir el nodo de texto, deja la selección
  en el trozo nuevo, así que el cursor acababa al PRINCIPIO de la cuenta.

**Qué probar**
- [ ] Escribir `12+1 =`, ver el 13 en gris, y que **Intro lo fije** con
      el color de acento.
- [ ] Tocar la pantalla en vez de dar a Intro: el gris se va y sigues
      escribiendo, sin haber calculado nada.
- [ ] Tocar una fórmula ya fijada: tiene que volver a abrirse como cuenta
      editable.
- [ ] Escribir justo detrás de una fijada: el texto NO debe meterse
      dentro de ella.

**Decisiones**
- **Cálculos sueltos, sin referencias a celdas.** La opción de hoja de
  cálculo la descartaste.
- **Calcular es siempre una decisión tuya**: escribir `=` no dispara
  nada.
- **AVISO DE SEGURIDAD, por si alguna vez se revisa**: esto obligó a
  ampliar el saneador de notas. Un `<span>` conserva `class` **solo si
  vale exactamente `note-formula`** — no es un patrón ni una lista, es
  una comparación con una cadena, y no entra ningún dato tuyo en ningún
  atributo. Probado con siete variantes hostiles; seis se caen.

---

## Pendiente de decidir (tuyo)

- **Ocultar una nota en el móvil NO protege de nada**: solo difumina, y
  con el teléfono desbloqueado eso no es una contraseña. Falta decidir si
  la pantalla lo dice con todas las letras o se hace de verdad con Face
  ID. Está en `PARA-KOKU-MAÑANA.md`, punto C2.
