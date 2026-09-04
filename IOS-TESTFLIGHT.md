# Compilar y probar la app de iOS sin tener un Mac

Esto es una guía de trabajo (como `CAPACITOR-POC.md`), no documentación
de usuario final. Explica cómo compilar, firmar y subir a TestFlight la
app de iOS **usando solo GitHub Actions** -- el runner `macos-latest`
de GitHub ya trae Xcode instalado, así que no hace falta tener un Mac
propio en ningún momento de este proceso.

## Qué hace el workflow

`.github/workflows/ios-testflight.yml` (disparo manual, "Run workflow"
en la pestaña Actions del repo):

1. Descarga el código, instala dependencias, copia `public/` al
   proyecto iOS (`npx cap sync ios`).
2. Compila y **firma automáticamente** con `xcodebuild archive
   -allowProvisioningUpdates`, usando una clave de API de App Store
   Connect (no un certificado exportado a mano -- por eso no hace
   falta Xcode/Keychain Access en tu propio ordenador para nada de
   esto).
3. Exporta el `.ipa` y lo sube a TestFlight.

Solo hace falta configurar esto **una vez**; después, cada build es
solo pulsar un botón.

## 1. Preparar tu cuenta de Apple Developer (una vez, todo desde la web)

**Antes de nada -- inscríbete en el Apple Developer Program** (si aún
no lo has hecho): en <https://developer.apple.com/programs/enroll/>,
elige "Enroll as an Individual", acepta el acuerdo, verifica tu
identidad (Apple suele pedirlo desde la app "Apple Developer" en un
iPhone/iPad) y paga los 99 USD/año. Durante ese formulario te pedirá
una **"Address"** -- es tu dirección postal (calle, ciudad, código
postal), no tu correo electrónico (el email ya lo tiene aparte, es el
de tu Apple ID). Sin esta inscripción aprobada, ni "Certificates, IDs &
Profiles" ni App Store Connect están disponibles todavía -- espera a
que Apple la apruebe (de minutos a 48h) antes de seguir con los pasos
de abajo.

1. Entra en <https://developer.apple.com/account> → **Certificates,
   IDs & Profiles** → **Identifiers** → registra un nuevo identificador
   de tipo App, con el Bundle ID `com.koku.remindmelater` (el mismo que
   ya está puesto en `capacitor.config.json`).
2. Entra en <https://appstoreconnect.apple.com> → **My Apps** → botón
   "+" → **New App**. Rellena con el mismo Bundle ID de arriba, el
   nombre que quieras que vea la gente en TestFlight, y un SKU
   cualquiera (un identificador interno, puede ser lo que sea, p. ej.
   `remindmelater-001`).
3. En el mismo App Store Connect → **Users and Access** → pestaña
   **Integrations** → **App Store Connect API** → botón para generar
   una clave nueva. Ponle el rol **Admin** (hace falta para que el
   workflow pueda crear/gestionar certificados y perfiles de
   aprovisionamiento por su cuenta, sin que tengas que hacerlo tú a
   mano cada vez).
4. Apple te deja **descargar el archivo `.p8` de esa clave una sola
   vez** -- guárdalo bien en cuanto lo generes, porque si lo pierdes
   hay que crear una clave nueva.

## 2. Añadir los 4 secretos en GitHub

Ve a la página del repo en GitHub → **Settings** → **Secrets and
variables** → **Actions** → **New repository secret**, y añade estos 4
(uno por uno):

| Nombre del secreto | De dónde sale |
|---|---|
| `APPSTORE_KEY_ID` | Se ve junto a la clave que creaste en el paso 1.3 (una cadena corta de letras y números) |
| `APPSTORE_ISSUER_ID` | Mismo sitio (Integrations → App Store Connect API) -- es el mismo para todas tus claves, arriba de la lista |
| `APPSTORE_PRIVATE_KEY` | El contenido COMPLETO del archivo `.p8` que descargaste, tal cual (incluyendo las líneas `-----BEGIN PRIVATE KEY-----`/`-----END PRIVATE KEY-----`) |
| `APPLE_TEAM_ID` | <https://developer.apple.com/account> → **Membership** (o "Membership details") |

**Importante: estos 4 valores van directos al formulario de GitHub, no
se pegan nunca en el chat conmigo.**

## 3. Lanzar un build

1. En GitHub, pestaña **Actions** del repo → workflow **"iOS
   TestFlight"** en la lista de la izquierda → botón **"Run workflow"**.
2. Se abre un desplegable para elegir la **rama** desde la que
   compilar -- por defecto `main`, pero puedes elegir cualquier otra
   rama del repo (esto ya viene incluido sin configurar nada más, es
   justo lo que sirve para hacer compilaciones de prueba desde una
   rama concreta más adelante).
3. Pulsa "Run workflow" y espera -- un build de iOS en CI suele tardar
   unos 10-15 minutos. Puedes seguir el progreso en vivo en esa misma
   pestaña.

## 4. Instalar la app en tu iPhone

1. En App Store Connect → tu app → pestaña **TestFlight**.
2. Añádete a ti mismo como probador interno (como eres el Admin del
   equipo, no hace falta ningún papeleo de revisión para esto).
3. Instala la app **TestFlight** (la de Apple) desde el App Store en tu
   iPhone.
4. Acepta la invitación que te llegue por correo/notificación, e
   instala RemindMeLater desde dentro de TestFlight.

## Antes de abrir la app: pon la IP/mDNS de tu ordenador

Igual que en la prueba de validación de Capacitor
(`CAPACITOR-POC.md`), el WebView de la app navega directamente a tu
servidor real -- así que antes de compilar, edita
`capacitor.config.json` con la dirección real de tu ordenador (la
misma que ves impresa al arrancar `npm run dev`), y vuelve a lanzar el
workflow para que el cambio llegue al build.

## Estado: probado y funcionando

El workflow se probó de verdad y sube a TestFlight correctamente (run
#4, rama `movil-ui`). Hicieron falta cuatro intentos, y las dos
peculiaridades que costaron más vale la pena dejarlas escritas, porque
no son obvias:

1. **La firma automática de Xcode, al ARCHIVAR, siempre quiere un
   perfil de desarrollo**, y Apple no crea uno si tu equipo no tiene
   ningún dispositivo registrado -- justo el caso de un pipeline sin
   Mac ni iPhone conectado. Imponerle la identidad de distribución
   tampoco vale (la rechaza por "conflicting provisioning settings").
   La solución es archivar **sin firmar** (`CODE_SIGNING_ALLOWED=NO`) y
   dejar toda la firma para `-exportArchive`, que pide un perfil de App
   Store -- y ese sí se crea sin dispositivos.
2. **La subida se hace con `xcrun altool`**, no con la acción
   `apple-actions/upload-testflight-build`, cuyo parámetro de issuer se
   llama `issuer-id` (no `api-issuer-id`) y fallaba con un 401 al
   llegarle vacío. `altool` encuentra la clave solo en
   `~/private_keys/AuthKey_<KEYID>.p8`, el mismo fichero que ya usan
   los pasos anteriores.

Si algún día falla, el registro (log) de la ejecución en la pestaña
Actions dice exactamente en qué paso -- copia el error y lo miramos.
