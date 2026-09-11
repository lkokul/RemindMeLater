# Lo que necesito que decidas

> **Al día del 11/9/2026.** Koku ya contestó a una parte: **B1 sigue
> pendiente**, **C1 sigue pendiente**, y **D1 está resuelto** (nombre y
> correo dados, política escrita en `docs/privacidad.md`). Las fórmulas
> (que no estaban en esta lista) se rediseñaron enteras a petición suya
> — ver el bloque de fórmulas en `CLAUDE.md`.
>
> Lo que queda por decidir está marcado con **PENDIENTE** abajo.

Documento de trabajo (como `IDEAS-AYUDAS.md`): **nada de lo que hay aquí
está hecho**. Son las decisiones que no he tomado por mi cuenta porque
cambian cómo se ve o cómo se comporta la app, y eso lo decides tú.

Escrito tras las tres tandas del 10/9/2026 (v0.48.0).

---

## A. Lo que YA está hecho, para que sepas de dónde partimos

Tres tandas, 282 comprobaciones automáticas en verde.

**Seguridad** — los dos agujeros reales cerrados (una copia de seguridad
manipulada ya no ejecuta código; `escapeHtml` ya no deja romper un
atributo), CSP puesta, y el manifiesto de privacidad de Apple que te
habría bloqueado una subida a la App Store.

**Privacidad** — la app ya no se conecta a Google. **Ahora es 100 %
offline de verdad**: cero peticiones de red, medido. Y Android ya no sube
tu base de datos a Google Drive.

**Escritorio fuera** — lo de la tele ya no puede pasar: la app es
exactamente la misma a cualquier ancho, de 320 px a 4K.

**Estética** — escala tipográfica de iOS (el cuerpo pasa de 13,6 px a 17),
translucidez en barras y modales, el `:hover` que se quedaba pegado al
tocar, y cuatro erratas.

---

## B. Dudas de diseño

### B1. PENDIENTE — El azul de fábrica no llega al mínimo de contraste

Medido: texto blanco sobre `#5b8cff` da **3,16:1**, y para texto el
mínimo (WCAG AA) es **4,5:1**. Es el botón más importante de la app.

Matiz que importa: **tu regla de 3:1 para acentos está bien** — es la
correcta para un elemento gráfico. Lo que pasa es que un botón lleva
TEXTO encima, y para texto el listón es más alto.

Candidatos medidos, todos siguen siendo el mismo azul:

| Color | Con texto blanco | Contra el fondo oscuro |
|---|---|---|
| `#5b8cff` (el de ahora) | 3,16:1 ✗ | 5,50:1 |
| **`#3f6fd8`** | **4,69:1 ✓** | 4,03:1 |
| `#3a68cf` | 5,17:1 ✓ | 3,65:1 |

**No lo he cambiado** porque es el color de identidad de la app y eso lo
eliges tú. Si dices que sí, es un valor en `SEED_THEMES`. **Ojo**: el
sembrado solo inserta un tema si no existe uno con ese nombre, así que a
tu instalación de ahora **no le cambiaría nada** — solo a una instalación
nueva. Si lo quieres en la tuya, hay que tocarlo a mano en el editor de
temas.

**Mi recomendación**: `#3f6fd8`. Pasa el mínimo y sigue separándose bien
del fondo.

### B2. Los fines de semana parecen días seleccionados

Sábados y domingos llevan un **círculo relleno** oscuro; el día de hoy
lleva un **círculo relleno** azul. Los dos son círculos rellenos, así que
el ojo lee "estos días están marcados". En iOS el fin de semana no se
distingue en la rejilla del mes.

No lo he tocado porque `dayWeekend` es **un color de tu sistema de
temas** — quitarlo dejaría esa variable sin uso, y los festivos y días
especiales usan el mismo patrón. Opciones:

1. Quitar solo el relleno del fin de semana (el número en gris ya se
   entiende), y dejar festivos y especiales como están.
2. Dejarlo como está.
3. Que hoy deje de ser un círculo relleno y pase a ser un **punto debajo
   del número**, como hace iOS. Así ningún relleno compite con otro.

### B3. El mes no enseña dónde hay eventos

Con tres eventos creados hoy, la rejilla del mes en modo "Compacto" **no
muestra ni un punto**. Seis filas de ~200 px que solo llevan un número.

La lógica ya existe: `seccionCalendario()` en `widget-bridge.js` ya
calcula hasta tres colores por día para el widget del calendario. Sería
reusarla en la rejilla.

**Pregunta**: ¿puntos de color debajo del número (hasta 3), o prefieres
que "Compacto" siga siendo compacto de verdad y esto solo salga en el
modo "Listado"?

### B4. Gimnasio: el menú en lista

Tu idea, y estoy de acuerdo. Lo que **no** he construido es mi añadido:
sacar "Entrenar" de la lista y dejarlo como botón grande arriba, porque
si no metemos un toque de más en lo que haces el 90 % de las veces.

```
┌─────────────────────────────┐
│  Gimnasio               ☰   │
├─────────────────────────────┤
│   ┌───────────────────────┐ │
│   │  Empezar entrenamiento│ │  ← un toque, como ahora
│   └───────────────────────┘ │
│   Hoy toca: Empuje · día 1  │  ← ya lo calcula gymCicloDeHoy()
│  ─────────────────────────  │
│   Plan                   ›  │
│   Progreso               ›  │
│   Logros                 ›  │
│   Historial              ›  │  ← hoy vive dentro de "Entrenar"
└─────────────────────────────┘
```

**Preguntas**:
1. ¿Te vale así, con Entrenar fuera de la lista?
2. ¿Saco el **Historial** a su propia entrada? Hoy está debajo del botón
   de entrenar y se ve poco.
3. Si te gusta, ¿lo aplico también a **Finanzas** y **Viajes**, que
   tienen la misma barra de sub-pestañas?

### B5. La pestaña Progreso está sobrecargada

Ocho bloques y cinco grupos de controles en un scroll. Y **dos de esos
bloques son ajustes** metidos en una pantalla de datos: "Objetivo
semanal" y "Peso extra de una serie al fallo". Cosas que tocas una vez en
la vida ocupando sitio fijo entre dos gráficas.

**Propuesta**: moverlos al ☰ de Gimnasio, que ya existe. No se pierde
nada, y Progreso baja de 8 bloques a 6.

**Y de paso**: el aviso "Sobre el mapa de músculos" se abre **solo, como
modal a pantalla completa, cada vez que entras**, hasta que marcas la
casilla. Interrumpir una pantalla de consulta con un modal es muy poco
iOS. Propongo dejar el "?" que ya está al lado del título y quitar la
apertura automática. ¿Ok?

### B6. Un solo componente para "elige una de estas"

Hoy hay dos idiomas distintos en la misma pantalla: las pestañas se
rellenan de azul; `7/30/90 días` y `Series/Volumen` usan borde de 2 px +
fondo al 18 %. Además ese borde de 2 px **cambia el ancho del botón al
seleccionarlo**, así que la fila da un saltito.

Propongo un único `.segmentado` estilo iOS (pastilla gris, la opción
elegida en blanco encima) y que lo usen los dos sitios, más los
`.view-mode-btn` de Configuración y las sub-pestañas de Finanzas y
Viajes. Es un cambio que se ve en muchas pantallas a la vez: **prefiero
que lo apruebes antes**.

### B7. Escala de espaciado

92 valores distintos de `padding` y 14 de `gap`. iOS usa múltiplos de 4 y
casi siempre 8/12/16/20. Con seis variables las pantallas empiezan a
"rimar" sin que sepas explicar por qué.

Es trabajo mecánico y aburrido como el de la tipografía, y como aquel,
puede obligar a recolocar alguna pantalla. **¿Lo hago?**

### B8. "Una pantalla, un botón relleno"

En el calendario, "Hoy" y "Grupos" son dos cajas grandes. En la pestaña
Plan hay cinco botones con caja antes de llegar a contenido. En iOS las
acciones secundarias son texto azul sin caja, y el relleno se reserva
para LA acción principal.

Esto cambia bastante el aspecto de varias pantallas. **¿Te lanzo una
propuesta con capturas antes de tocar nada?**

---

## C. Cosas que se salen de la filosofía de la app

Me pediste que mirara si algo se sale de "todo local, nada sale del
dispositivo" y que lo arreglara o lo listara. **Lo que se podía arreglar
ya está arreglado** (Google Fonts, la copia automática de Android, ATS, y
el texto de permiso que prometía una sincronización que no existe).

Queda esto, que no puedo decidir yo:

### C1. PENDIENTE — La copia de seguridad va sin cifrar

El `.json` que exportas lleva **la base de datos entera en base64**.
Quien tenga ese archivo lo tiene todo: finanzas, notas, gimnasio. Si lo
guardas en iCloud Drive o lo mandas por WhatsApp, ahí van tus datos en
claro.

Choca de frente con la filosofía. Se puede cifrar entero con
`crypto.subtle` (AES-GCM + PBKDF2), que **ya viene en la webview**, sin
ninguna dependencia nueva.

El precio: **si pierdes la contraseña, pierdes la copia.** Sin
excepciones, sin recuperación. Eso hay que decirlo muy claro en la
pantalla.

**Opciones**: (a) cifrado obligatorio, (b) casilla "cifrar esta copia"
con la contraseña, (c) dejarlo como está y avisar en la pantalla.
**Mi recomendación: (b)** — tú eliges según dónde vayas a guardarla.

### C2. "Notas ocultas" no protege nada

En la app móvil, ocultar una nota **solo la difumina**. La contraseña
compartida se fue con el servidor (hay hasta una migración que borra
`notes_hide_password_hash`). Y **`CLAUDE.md` sigue describiéndola como si
existiera** — eso es del otro programa, el de escritorio.

No es un fallo de seguridad (nunca fue cifrado real), pero sí es fácil
creerse protegido. Dos caminos:

1. **Aceptarlo y decirlo**: cambiar el texto de la app a algo como "para
   que no se lea de reojo", y corregir CLAUDE.md.
2. **Hacerlo de verdad**: Face ID para destapar. Es una ronda de trabajo.

### C3. No hay bloqueo de la app

Con el teléfono desbloqueado en la mano de otro, no hay ninguna barrera:
ni PIN, ni Face ID. Es el caso realista (el móvil encima de la mesa), y
tienes tus finanzas ahí.

**Propuesta**: Face ID opcional, o solo para Finanzas. ¿Te interesa?

---

## D. El papeleo: qué hay que poner y dónde

Esto es lo que hace falta **antes de publicar**, y es trabajo tuyo (yo
puedo escribir los textos). Ninguno es opcional.

### D1. ~~Política de privacidad~~ — HECHA, te falta publicarla

Las dos tiendas la exigen, aunque la app no recoja nada. Tiene que ser
accesible sin registro.

**Lo más barato**: GitHub Pages sobre este mismo repositorio. Creas
`docs/privacidad.md`, activas Pages y ya tienes
`https://lkokul.github.io/RemindMeLater/privacidad`. Gratis y versionado
con el código.

**Ya está escrita**, en `docs/privacidad.md`, con tus datos:
Marco Robert Valverde y mrobe2503+remindmelaterincidents@gmail.com.

**Lo que te toca a ti** (dos minutos, en la web de GitHub):
Settings → Pages → Source: *Deploy from a branch* → Branch: la que
publiques → carpeta `/docs` → Save. Te queda en
`https://lkokul.github.io/RemindMeLater/privacidad`. Esa es la URL que
va en las dos tiendas.

Contenido: responsable + contacto; que todos los datos se guardan solo en
el dispositivo y tú no tienes acceso ni recibes copia; que no hay
analítica, ni publicidad, ni terceros (**ya es literalmente cierto**);
qué pasa con las copias de seguridad (las genera el usuario, no van a
ningún servidor y **no están cifradas** — depende de C1); los permisos
que pide la app y para qué; derechos RGPD (borrar la app borra los
datos); y la fecha de última actualización.

### D2. App Store Connect → App Privacy

**"Data Not Collected"** en todo. Es la respuesta correcta: "recoger"
significa que el dato sale del dispositivo hacia ti o hacia un tercero, y
aquí no sale. Que la app guarde tus finanzas EN el móvil no es recoger.

Y rellenar el campo **Privacy Policy URL** con la de D1.

### D3. El manifiesto dentro del `.ipa` — YA HECHO

`PrivacyInfo.xcprivacy` en los dos targets. Es distinto de D2: la ficha
se rellena en la web, el manifiesto viaja dentro del paquete. Hacen falta
los dos, y este ya no tienes que tocarlo.

### D4. Play Console → Data safety

- "¿Recoge o comparte tu app datos de usuario?" → **No**.
- Privacy Policy URL, la misma.
- Play pide un **método para solicitar el borrado de datos**: con datos
  solo locales la respuesta es "desinstalar la app los borra", pero hay
  que escribirlo.
- Ya **no** hay que declarar la copia automática de Google: se desactivó.

### D5. Un aviso dentro de la app

No lo exige nadie, pero es lo que hace creíble la promesa. Propuesta para
**Configuración → Este dispositivo**, junto al bloque de copia:

> **Privacidad**
> Todos tus datos se guardan solo en este dispositivo. RemindMeLater no
> tiene servidor, no tiene cuentas y no se conecta a internet: nadie más
> puede verlos, ni siquiera quien hizo la app.
> Las copias de seguridad que exportes **no van cifradas**: guárdalas
> donde solo tú llegues.
> [Política de privacidad completa →]

Ese "no se conecta a internet" **ya se puede escribir**: antes no.
La última línea depende de qué decidas en C1.

**¿Lo monto?** Es una ronda corta.

### D6. RGPD / España

Como los datos no salen del dispositivo y tú nunca los recibes, en la
práctica **no eres responsable del tratamiento**: no hay tratamiento por
tu parte. No necesitas registro de actividades, ni DPO, ni base jurídica.
Lo que sí necesitas es **decirlo**, que es D1.

**Aviso para el futuro**: en cuanto entre cualquier cosa que salga del
dispositivo —y eso incluye **la comunicación escritorio↔móvil de la v1
que dejaste apuntada**— esto cambia por completo y hay que rehacerlo.

---

## E. Orden que propongo

1. Contestar B1, B4, B5 y C1 (son las que desbloquean más trabajo).
2. Yo hago la ronda de Gimnasio (B4 + B5) y el aviso de privacidad (D5).
3. Tú montas la política de privacidad (D1) — dime nombre y correo y te
   la escribo.
4. Lo demás (B6, B7, B8) cuando quieras, de una en una.
