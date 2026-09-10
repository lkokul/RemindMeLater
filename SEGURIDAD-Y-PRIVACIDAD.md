# Seguridad y privacidad de RemindMeLater (móvil)

> **ESTADO: los diez arreglos del plan ya están hechos** (tanda del
> 10/9/2026, v0.48.0). Este documento se deja como está —con los
> hallazgos redactados en presente— porque explica **por qué** cada cosa
> era un problema, y eso es lo que hay que leer antes de volver a
> tocarla. Lo que cambia es que ahora hay red: los puntos 2.3 a 2.7 los
> vigila `tools/comprobar-widgets.py`, así que si alguno vuelve a
> aparecer, el guion lo dice ANTES de compilar.
>
> Lo único que sigue pendiente es el papeleo de la sección 5 (la política
> de privacidad y las fichas de las dos tiendas), que es trabajo de Koku,
> y las dos decisiones abiertas de §2.8 y §4 (Face ID, copia cifrada).

Estudio hecho el 10/9/2026 sobre la rama `desarrollador`, v0.47.0.
Todo lo que dice este documento se ha **comprobado ejecutando la app**,
no leyendo el código y suponiendo. Donde pone "probado" es que hay un
guion que lo reproduce.

---

## Resumen en tres frases

La app es **bastante segura por diseño**, y no por suerte: no hay
servidor, no hay cuentas, no hay red, y el saneador de notas aguanta
todo lo que se le ha tirado. **Nadie puede atacarte desde fuera porque
no hay un "fuera"**.

Pero hay **una puerta de entrada real**: el archivo de copia de
seguridad. Es lo único que la app acepta de un tercero, y hoy se fía
demasiado de él — está probado que una copia manipulada ejecuta código
dentro de la app.

Y hay **una fuga de privacidad que no sabías que tenías**: la app se
conecta a Google en cada arranque para bajar una tipografía. Es lo único
que sale del teléfono, y hace falsa la frase "tus datos nunca salen de
tu dispositivo".

---

## 1. Lo que está BIEN (y conviene no tocar)

Esto no es relleno: son las cosas que en otras apps salen mal y aquí
están bien resueltas.

### El saneador de notas aguanta

Se le tiraron doce cargas hostiles distintas al guardar una nota. **Las
doce quedaron neutralizadas** y ninguna llegó a ejecutar nada:

| Lo que se metió | Lo que quedó guardado |
|---|---|
| `<script>window.__pwn=1</script>Hola` | `Hola` |
| `<img src=x onerror="...">` | *(vacío)* |
| `<svg onload="...">` | *(vacío)* |
| `<iframe src="https://evil...">` | *(vacío)* |
| `<a href="javascript:...">clic</a>` | `clic` |
| `<img src="data:image/svg+xml;...">` | *(vacío)* |
| `<img src="https://evil.../track.gif">` | *(vacío)* |
| `<img src="/api/notes/images/abc.png">` | se conserva (es la única fuente permitida) |
| `<b style="background:url(javascript:1)">x</b>` | `<b>x</b>` |
| `<b onclick="...">x</b>` | `<b>x</b>` |
| `<form action="https://evil...">` | *(vacío)* |
| `<meta http-equiv="refresh" ...>` | *(vacío)* |

La lista blanca de etiquetas + "ningún atributo salvo `src` de `img`, y
solo si apunta a `/api/notes/images/`" es la decisión correcta, y está
bien implementada. **No la aflojes** para añadir una funcionalidad; si
hace falta una etiqueta nueva, se añade a la lista blanca, nunca se pasa
a lista negra.

### No hay inyección de SQL

Probado creando un grupo llamado `x'); DROP TABLE events;--`. Se guardó
como texto literal y la tabla `events` siguió viva. Las 45+ consultas
usan `prepare(...).run(param)` con parámetros de verdad, que es lo que
hace que esto sea imposible. Los parámetros de ruta raros (`/api/events/1 OR 1=1`)
devuelven 404 limpio.

### La inyección por CSS está bloqueada

Un color de tema manipulado (`red; } body { display:none } :root{ x:1`)
**no** se aplica: `style.setProperty()` valida el valor y lo rechaza
entero. El body siguió visible. Esto importa porque los colores del tema
vienen del `localStorage`, que **sí** se restaura desde una copia.

### El resto del terreno nativo

- `ITSAppUsesNonExemptEncryption = false` está declarado. Correcto: sin
  eso, cada subida a TestFlight te pregunta.
- No hay `server.url` ni `allowNavigation` en `capacitor.config.json`:
  la webview solo carga archivos que van dentro de la app. Es lo que
  hay que hacer.
- Android solo pide un permiso (`INTERNET`). Ni cámara, ni contactos,
  ni ubicación, ni almacenamiento.

---

## 2. Lo que está MAL, por orden de importancia

### 2.1 🔴 Una copia de seguridad manipulada ejecuta código — PROBADO

**Es el hallazgo importante de este estudio.**

El modelo de la app es "sanear al ESCRIBIR": `sanitizeNoteBody()` limpia
el HTML cuando se guarda la nota, y al pintarla se hace
`div.innerHTML = nota.body` confiando en que ya viene limpio
(`app.js:3587`).

Eso funciona **mientras la única forma de meter datos sea la ruta que
sanea**. Y hay una que no lo es: **importar una copia de seguridad
sustituye el archivo `.sqlite` entero** (`backup.js`), sin pasar por
ninguna ruta. Las filas que trae entran crudas.

Probado: se metió a mano en la tabla `notes` un body con
`<img src=x onerror="...">` (exactamente lo que dejaría una copia ajena)
y al pintar la nota **el código se ejecutó**.

**El escenario real**: alguien te pasa un `.json` diciendo "mira, te he
preparado esta copia con tus datos del móvil viejo", o lo bajas de algún
sitio. Lo importas. A partir de ahí ese archivo manda dentro de tu app.

**El arreglo**, y hay dos mitades que conviene hacer las dos:

1. **Sanear también al PINTAR**, no solo al guardar. Es una línea:
   pasar `nota.body` por el mismo saneador antes del `innerHTML`. Como
   el saneador ya existe y ya está probado, esto no inventa nada nuevo.
   Es la regla general: *el dato se sanea donde se usa, no donde se
   recibe*.
2. **Sanear la copia al importarla**: recorrer las notas de la base
   importada y pasarlas por `sanitizeNoteBody()` antes de dar la
   importación por buena. Más caro, pero deja la base limpia para
   siempre en vez de depender de que todos los sitios que pintan se
   acuerden.

Con (1) sola ya se cierra la puerta. (2) es el cinturón.

### 2.2 🟠 `escapeHtml()` no escapa las comillas — PROBADO

```js
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;   // escapa < > &   pero NO " ni '
  return div.innerHTML;
}
```

Eso está bien **entre etiquetas** (`<span>${escapeHtml(x)}</span>`), que
es como se usa en la mayoría de los 80 sitios. Pero se usa también
**dentro de atributos entrecomillados**, y ahí no basta. Hay unos 19
sitios así. Probado con el patrón exacto de `app.js:12237` (la nota de
una serie del gimnasio, texto que escribes tú):

```
nota:  " autofocus onfocus="window.__pwn='ejecutado'" x="
sale:  <input value="" autofocus onfocus="window.__pwn='ejecutado'" x="">
       -> window.__pwn === 'ejecutado'
```

Lo mismo con los chips de género de Entretenimiento (`app.js:17884`).

**Por qué es naranja y no rojo**: hoy el único que escribe ahí eres tú,
así que sería atacarte a ti mismo. Pero es **la escalera del punto
2.1**: una copia manipulada llena esos campos, y entonces sí es un
ataque de verdad. Los dos juntos son peores que por separado.

**El arreglo es una línea**, y no puede romper nada (solo escapa más de
lo que escapaba):

```js
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

### 2.3 🔴 Falta `PrivacyInfo.xcprivacy` — esto te va a bloquear una subida

**No es una recomendación, es un requisito de Apple desde el 1 de mayo
de 2024.** Una app que usa "APIs de motivo requerido" tiene que
declararlas en un archivo de manifiesto de privacidad. Si falta, App
Store Connect primero manda un correo de aviso y luego rechaza la
subida.

Esta app usa `UserDefaults` en **nueve archivos Swift** (el puente del
widget, SceneDelegate, la Live Activity, el intent del centro de
control...). `UserDefaults` está en esa lista de Apple.

Hoy no ha molestado porque **TestFlight interno es más permisivo que la
revisión de la App Store**. En cuanto vayas a publicar de verdad, salta.

**El arreglo**: crear `ios/App/App/PrivacyInfo.xcprivacy` (y otro igual
para el target del widget), añadirlo al `Copy Bundle Resources` de cada
target:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
 "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key><false/>
  <key>NSPrivacyTrackingDomains</key><array/>
  <key>NSPrivacyCollectedDataTypes</key><array/>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>CA92.1</string></array>
    </dict>
  </array>
</dict>
</plist>
```

`CA92.1` es literalmente "acceder a información de la propia app o del
mismo grupo de apps" — que es exactamente lo que hace el App Group del
widget. Es el motivo correcto, no un comodín.

`NSPrivacyCollectedDataTypes` vacío es la declaración de "no recojo
nada", y **es verdad** en cuanto arregles el punto 2.4.

### 2.4 🟠 La app se conecta a Google en cada arranque

`index.html` líneas 20-22:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:..." rel="stylesheet" />
```

Es para la tipografía monoespaciada de **un solo estilo de interacción**
("Registro"). Consecuencias:

- **Es lo ÚNICO que sale del teléfono.** Todo lo demás es local de
  verdad. Esta línea hace literalmente falsa la frase "tus datos nunca
  salen de tus dispositivos".
- En cada arranque, Google recibe **tu IP y tu User-Agent**. Bajo el
  RGPD eso es un dato personal transferido a un tercero fuera de la UE.
  Hay jurisprudencia europea condenando exactamente esto (el caso de
  Google Fonts incrustadas, Múnich 2022).
- Te obliga a declarar un tercero en la ficha de privacidad de las dos
  tiendas, cuando si no fuera por esto podrías poner "no se recoge
  ningún dato" limpio.
- Y encima **no hace falta**: iOS ya trae `ui-monospace` (SF Mono), que
  en un iPhone se ve mejor que Roboto Mono.

**El arreglo**: quitar las tres líneas y dejar que `--font-mono` caiga
en la pila del sistema, o vendorizar el `.woff2` dentro de la app
(mismo criterio que ya se usó con sql.js: nada de CDN). Yo quitaría las
tres líneas.

Este es el arreglo con mejor relación coste/beneficio de todo el
documento: **una línea de HTML y la app pasa a ser 100% offline de
verdad**, lo que simplifica todo el papeleo de privacidad de golpe.

### 2.5 🟠 Configuración nativa que sobró del programa cliente-servidor

Tres restos de cuando había servidor, que hoy solo suman superficie de
ataque y preguntas en la revisión de Apple:

**a) ATS desactivado del todo** (`ios/App/App/Info.plist`):

```xml
<key>NSAppTransportSecurity</key>
<dict><key>NSAllowsArbitraryLoads</key><true/></dict>
```

Esto le dice a iOS "déjame conectarme a cualquier sitio, incluso por
HTTP sin cifrar". Se puso para hablar con el servidor de tu ordenador
por la wifi. **Ya no hay servidor.** Hoy solo sirve para que, si alguien
consigue ejecutar código (punto 2.1), pueda mandarse tu base de datos
entera a cualquier servidor, incluso en claro. Y App Review pregunta por
las excepciones de ATS.

→ Borrar las cuatro líneas.

**b) Un texto de permiso que describe algo que la app ya no hace**:

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>RemindMeLater se conecta a tu ordenador por la red local (wifi)
para sincronizar tu calendario, notas y tareas...</string>
```

**No hay sincronización.** Este texto es el que iOS enseña en el diálogo
de permiso, así que hoy la app le mentiría al usuario. Y un texto de
permiso que no se corresponde con lo que la app hace es motivo de
rechazo por sí solo.

→ Borrar la clave. (Sin ella, iOS ni siquiera pide ese permiso.)

**c) Lo mismo en Android** (`AndroidManifest.xml`):
`android:usesCleartextTraffic="true"` → quitarlo.

### 2.6 🟠 Android manda tu base de datos a Google Drive

`AndroidManifest.xml`: `android:allowBackup="true"`.

Con eso, Android incluye los datos de la app en la copia automática de
Google (Auto Backup for Apps). Es decir: **tu calendario, tus notas, tus
finanzas y tu gimnasio se suben a Google Drive**, sin que nadie lo haya
pedido. Está cifrado con el PIN del dispositivo en Android moderno, así
que no es una catástrofe — pero **contradice de frente la promesa de la
app**, y te obliga a declararlo en el formulario de Data Safety de Play.

Además tiene un efecto raro: si restauras el móvil, vuelve una base
antigua por detrás sin que la app se entere.

→ `android:allowBackup="false"` y `android:fullBackupContent="false"`.
La copia de seguridad de la app es **tu** función de exportar, que es
explícita y la controlas tú. Eso es coherente; esto otro no.

### 2.7 🟡 No hay CSP

No hay ninguna `Content-Security-Policy` en `index.html`. Una CSP es la
red que te salva **cuando el saneador falla**, y por eso vale la pena
aunque el saneador sea bueno.

Con una CSP estricta, el código del punto 2.1 se habría ejecutado igual
(los `onerror` en línea los para `script-src`, sí — de hecho no se
habría ejecutado), y sobre todo **no habría podido mandar nada a
ninguna parte**.

Propuesta, que encaja con esta app porque no carga nada de fuera:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'wasm-unsafe-eval';
               style-src 'self' 'unsafe-inline';
               img-src 'self' data: blob:;
               connect-src 'self';
               object-src 'none'; base-uri 'none'; form-action 'none'">
```

Dos avisos para que no te lleves un susto al probarla:

- `'wasm-unsafe-eval'` es **obligatorio**: sql.js es WebAssembly y sin
  eso la app no arranca.
- `style-src 'unsafe-inline'` hace falta porque los temas escriben
  estilos en línea. No es lo ideal, pero **el vector peligroso es
  `script-src`**, y ese sí queda cerrado.
- Hay que quitar antes las líneas de Google Fonts (punto 2.4), porque
  `default-src 'self'` las bloquearía.

Esto merece una ronda propia y probarlo bien: una CSP mal puesta deja la
app en blanco.

### 2.8 🟡 "Notas ocultas" no protege nada, y CLAUDE.md dice lo contrario

En la app móvil, ocultar una nota **solo la difumina**. La contraseña
compartida se quitó al desaparecer el servidor — hay hasta una migración
que borra `notes_hide_password_hash` (`local-schema.js:857`).

Pero `CLAUDE.md` sigue describiendo la contraseña como si existiera
("con una contraseña OPCIONAL y COMPARTIDA para toda la app"). Esa
descripción es del **otro** programa, el de escritorio.

No es un fallo de seguridad (nunca fue cifrado real, y así estaba
documentado), pero sí es **documentación que engaña**, y sobre esto es
fácil creerse protegido. Hay que decidir una de dos:

- Aceptarlo: "ocultar" es solo para que no se lea de reojo, y el texto
  de la app debería decirlo.
- O hacerlo de verdad: `expo-local-authentication` equivalente en
  Capacitor (Face ID) para destapar. Es una ronda de trabajo.

---

## 3. "¿Pueden hackearme el móvil por esto?"

Respuesta corta: **no**.

Respuesta honesta y precisa, porque la pregunta importa:

Si alguien consigue ejecutar JavaScript dentro de la app (punto 2.1),
ese código corre **dentro de la webview de tu app**, dentro del recinto
(*sandbox*) que iOS le da. Desde ahí **puede**:

- leer y borrar **todos los datos de RemindMeLater**: calendario, notas,
  fotos de notas, finanzas, gimnasio, viajes;
- usar los plugins de Capacitor que la app tiene instalados:
  `@capacitor/filesystem` (leer y escribir archivos **de la app**),
  `@capacitor/share` (abrir la hoja de compartir),
  `@capacitor/local-notifications` (crear avisos falsos);
- **mandárselo todo a un servidor**, que es lo peor de la lista — y hoy
  sin ningún freno, porque no hay CSP (2.7) y ATS está abierto (2.5a).

Y **no puede**:

- leer tus fotos, contactos, mensajes, correo, llavero ni nada de otras
  apps: iOS no se lo permite sin un permiso que esta app no tiene y no
  pide;
- instalar nada, ni persistir fuera de la app, ni sobrevivir a
  desinstalarla;
- tocar el sistema. Escapar del sandbox de iOS desde una webview es una
  cadena de exploits de las que valen cientos de miles de euros y se
  gastan en objetivos concretos, no en una app de calendario.

O sea: **el riesgo real es "me roban o me borran los datos de la app",
no "me toman el teléfono"**. Que no es poco — ahí están tus finanzas —
pero es importante no confundir las dos cosas.

Y el punto de partida sigue siendo bueno: **la única forma de meter algo
malo es que tú importes un archivo que te ha dado otra persona.** No hay
red, no hay cuentas, no hay enlaces, no hay anuncios, no hay SDK de
terceros. La superficie de ataque de esta app es minúscula comparada con
la de cualquier app normal.

---

## 4. Los datos: qué hay, dónde está y cómo de protegido

### Qué guarda la app

Todo esto vive **solo en tu teléfono**:

| Dónde | Qué |
|---|---|
| SQLite (dentro de IndexedDB) | eventos, tareas, grupos, notas, carpetas, temas, gimnasio (ejercicios, sesiones, series, bloques), finanzas (cuentas, movimientos, carteras, activos, deudas), entretenimiento, viajes |
| IndexedDB (`noteAssets`) | los bytes de las imágenes de las notas y las fotos de viajes |
| `localStorage` | ajustes por dispositivo: tema, modo de vista, objetivo semanal, estilo de widget, entreno a medias |
| App Group (`UserDefaults`) | el resumen que leen los widgets: qué toca hoy, próximas tareas, saldo, viaje, mapa de consistencia |

Hay datos sensibles ahí: **finanzas** (saldos, movimientos, deudas) y
**salud** (entrenos, pesos, progresión). Merecen el trato de datos
sensibles aunque nunca salgan.

### Cómo de protegidos están en reposo

- **La base no está cifrada por la app.** No hay SQLCipher ni nada
  parecido.
- **Sí está protegida por iOS**: los archivos de la app usan por defecto
  `NSFileProtectionCompleteUntilFirstUserAuthentication`. En cristiano:
  con el teléfono **apagado**, sin el código de desbloqueo esos datos no
  se leen ni sacando el chip. Con el teléfono encendido y ya desbloqueado
  una vez, sí son legibles por procesos de la propia app.
- **Con el teléfono desbloqueado en la mano de otro, no hay ninguna
  barrera**: ni PIN de app, ni Face ID, ni las notas ocultas (2.8).
- **El archivo de copia de seguridad NO está cifrado.** Es un `.json`
  con la base entera en base64. Quien lo tenga, lo tiene todo. Si lo
  guardas en iCloud Drive o lo mandas por WhatsApp, ahí van tus
  finanzas en claro.

Dos cosas que valdría la pena plantearse (ninguna urgente):

1. **Face ID para abrir la app** (o solo para Finanzas). Es lo que
   cubre el caso real: el móvil desbloqueado encima de la mesa.
2. **Cifrar la copia con una contraseña**. Se puede hacer entero con
   `crypto.subtle` (AES-GCM + PBKDF2), que ya viene en la webview, sin
   ninguna dependencia. El coste es que si pierdes la contraseña
   pierdes la copia, y eso hay que decirlo muy claro.

---

## 5. Qué tienes que poner, y dónde exactamente

Esta es la parte de "qué papeleo me hace falta". Va por sitios.

### 5.1 Una política de privacidad publicada en una URL — OBLIGATORIA

**Las dos tiendas la exigen**, sin excepción, aunque la app no recoja
nada. Tiene que ser una URL pública y accesible sin registro.

Lo más barato: **GitHub Pages sobre este mismo repositorio**. Creas
`docs/privacidad.md`, activas Pages, y ya tienes
`https://lkokul.github.io/RemindMeLater/privacidad`. Gratis, versionado
con el código y sin montar nada.

Qué tiene que decir, como mínimo:

- Quién es el responsable (tu nombre o alias + un correo de contacto).
  El correo **es obligatorio** en las dos tiendas.
- Qué datos se tratan y dónde: *todos los datos se guardan
  exclusivamente en el dispositivo; el desarrollador no tiene acceso a
  ellos ni recibe copia*.
- Que no hay analítica, ni publicidad, ni identificadores de
  seguimiento, ni terceros. **Esto solo será cierto cuando quites
  Google Fonts (2.4).**
- Qué pasa con las copias de seguridad: las genera el usuario, no van a
  ningún servidor, y **no están cifradas** — con el aviso de guardarlas
  en sitio seguro.
- Los permisos que pide la app y para qué (notificaciones locales, para
  los recordatorios).
- Derechos RGPD: como no hay tratamiento por tu parte, borrar la app
  borra los datos. Dilo así de claro.
- Fecha de última actualización.

### 5.2 Ficha de privacidad de la App Store (App Store Connect)

En **App Store Connect → tu app → App Privacy**:

- **"Data Not Collected"** en todo. Es la respuesta correcta: recoger
  significa que los datos salen del dispositivo hacia ti o hacia un
  tercero, y aquí no salen. Que la app guarde tus finanzas en el móvil
  **no** es "recoger".
- Otra vez: esto solo es verdad sin Google Fonts.
- Y hay que rellenar el campo **Privacy Policy URL** con la URL de 5.1.

### 5.3 El manifiesto de privacidad dentro de la app

El archivo `PrivacyInfo.xcprivacy` del punto 2.3. Es distinto de la
ficha de 5.2: la ficha se rellena en la web, el manifiesto viaja
**dentro del `.ipa`**. Hacen falta los dos.

### 5.4 Data Safety de Google Play

En **Play Console → Policy → App content → Data safety**:

- "¿Recoge o comparte tu app datos de usuario?" → **No** (con las mismas
  condiciones que arriba).
- Aun así, **hay que declarar** que los datos se guardan en el
  dispositivo, y responder a lo de la copia automática de Android — que
  hoy **sí** sube datos a Google (punto 2.6). Si dejas
  `allowBackup="true"`, tienes que declararlo. Si lo pones a `false`,
  no. Es otra razón para ponerlo a `false`.
- Privacy Policy URL, la misma.
- Play también pide un **método para solicitar el borrado de datos**.
  Con datos solo locales, la respuesta es "desinstalar la app los borra",
  y eso vale — pero hay que escribirlo.

### 5.5 Un aviso dentro de la propia app

Ninguna tienda lo exige, pero es lo que hace que la promesa sea creíble,
y encaja con lo que ya tienes.

Propuesta: en **Configuración → Este dispositivo**, junto al bloque de
copia de seguridad, una sección corta:

> **Privacidad**
> Todos tus datos se guardan solo en este dispositivo. RemindMeLater no
> tiene servidor, no tiene cuentas y no se conecta a internet: nadie más
> puede verlos, ni siquiera quien hizo la app.
> Las copias de seguridad que exportes **no van cifradas**: guárdalas
> donde solo tú llegues.
> [Política de privacidad completa →]

Ese "no se conecta a internet" es el que hoy no puedes escribir. Con el
punto 2.4 arreglado, sí.

### 5.6 Cosas de España / RGPD

- Como los datos **no salen del dispositivo** y tú nunca los recibes,
  en la práctica **no eres responsable del tratamiento** de datos
  personales de tus usuarios: no hay tratamiento por tu parte. No
  necesitas registro de actividades, ni DPO, ni base jurídica.
- Lo que sí necesitas es **decirlo**, que es la política de privacidad
  de 5.1. La AEPD y las tiendas quieren transparencia, no un
  formulario.
- **En cuanto entre cualquier cosa que salga del dispositivo** (una
  sincronización con el escritorio, una analítica, un backend), esto
  cambia por completo y hay que rehacerlo. Ténlo presente para lo de
  "comunicación escritorio↔móvil en la v1" que está apuntado como
  pendiente.
- Si algún día publicas la app para menores de 14 años en España hay
  reglas extra de consentimiento. Hoy no aplica.

---

## 6. Plan de arreglos, en orden

| # | Qué | Riesgo de romper algo | Se tarda |
|---|---|---|---|
| 1 | `escapeHtml()` escapa también `"` y `'` (2.2) | ninguno | minutos |
| 2 | Sanear el HTML de la nota al PINTAR (2.1) | ninguno | minutos |
| 3 | Quitar las 3 líneas de Google Fonts (2.4) | ninguno (la pila del sistema ya cae bien) | minutos |
| 4 | Quitar ATS abierto + el texto de red local + cleartext de Android (2.5) | ninguno: nada usa la red | minutos |
| 5 | `allowBackup="false"` en Android (2.6) | ninguno | minutos |
| 6 | `PrivacyInfo.xcprivacy` en los dos targets (2.3) | bajo: hay que tocar el `pbxproj`, y para eso está `comprobar-widgets.py` | una ronda corta |
| 7 | Política de privacidad en GitHub Pages + fichas de las dos tiendas (5.1-5.4) | ninguno | una tarde tuya |
| 8 | Sección de Privacidad dentro de la app (5.5) | ninguno | una ronda corta |
| 9 | CSP (2.7) | **medio**: hay que probarla bien o la app se queda en blanco | ronda propia |
| 10 | Sanear al importar una copia (2.1, cinturón) | bajo | ronda corta |
| 11 | Decidir qué hacer con "notas ocultas" (2.8) | — | decisión tuya |
| 12 | Face ID y/o copia cifrada (§4) | — | decisión tuya |

Del 1 al 5 son **cinco arreglos de minutos** que quitan de en medio los
dos problemas reales y hacen verdad la frase "tus datos no salen de tu
dispositivo". Con eso hecho, la app pasa de "segura por accidente" a
"segura a propósito".

---

## 7. Lo que se hizo (tanda del 10/9/2026, v0.48.0)

Los diez puntos de código, hechos y probados. Lo que falta es solo el
papeleo de la sección 5.

| # | Qué se hizo | Dónde |
|---|---|---|
| 1 | `escapeHtml()` escapa también `"` y `'` | `app.js` |
| 2 | El HTML de la nota se sanea también **al pintar**, con la misma función de la ruta (`window.sanearHtmlDeNota`) | `routes-local/notes.js`, `app.js` |
| 3 | Fuera Google Fonts; la mono es la del sistema (SF Mono en iPhone) | `index.html`, `styles.css` |
| 4 | Fuera la excepción de ATS y el texto de permiso de red local | `ios/App/App/Info.plist` |
| 5 | `allowBackup="false"` + `data_extraction_rules.xml` que excluye todo; fuera `usesCleartextTraffic` | `AndroidManifest.xml` |
| 6 | `PrivacyInfo.xcprivacy` en los dos targets, con `CA92.1`, y metidos en sus fases de Resources | `ios/`, `project.pbxproj` |
| 7 | **CSP estricta**, y el `<script>` en línea del arranque movido a `arranque.js` para que no haga falta `unsafe-inline` | `index.html`, `arranque.js` |
| 8 | 15 comprobaciones nuevas en el guion, todas probadas rompiéndolas a propósito | `tools/comprobar-widgets.py` |

**Lo que la CSP consigue, medido**: un `<script>` inyectado a mano no se
ejecuta; un `fetch()` a un servidor externo se bloquea; una imagen-baliza
externa se bloquea. Y con la app en uso normal (las ocho pantallas), cero
violaciones.

**Auditoría que se hizo de paso**: se revisaron TODAS las asignaciones a
`innerHTML` de `app.js` y `settings.js` buscando texto de usuario que no
pasara por `escapeHtml`. Solo saltó una (`app.label` en la barra de
abajo), y es un falso positivo: sale de una tabla fija y la clave de
`localStorage` se valida contra ella antes de usarla.

**Y se forzaron errores**: un `localStorage` envenenado con doce claves
manipuladas (HTML, JSON roto, 50.000 caracteres, SQL, travesía de
directorios) — la app arranca igual, cae a los valores por defecto y no
ejecuta nada; y catorce variantes raras de HTML hostil (mayúsculas,
tabuladores, barras, etiquetas anidadas, byte nulo, `../../`) — todas
neutralizadas, ninguna excepción.

**Total: 220 comprobaciones automáticas en verde** (13 guiones).
