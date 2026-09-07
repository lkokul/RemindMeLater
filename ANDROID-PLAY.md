# RemindMeLater en tu Android (Google Play)

Guía para compilar la app de Android **firmada para Google Play** sin
tener Android Studio ni nada instalado: GitHub Actions hace todo el
trabajo (workflow `android-play.yml`), igual que ya pasa con iOS y
TestFlight. Tú solo tienes que hacer una vez los preparativos de abajo.

> Ojo: el número de compilaciones que puedes lanzar es limitado — cada
> ejecución del workflow cuenta. Lánzalo solo cuando de verdad quieras
> una versión nueva.

## 1. Crear tu keystore (una sola vez)

Google Play exige que cada app venga **firmada** con una clave tuya. Esa
clave vive en un archivo llamado *keystore* que creas tú una vez y no
cambia nunca más — **si lo pierdes, no podrás actualizar la app**, así
que guárdalo (y sus contraseñas) en un sitio seguro.

En tu ordenador (con Java instalado — si tienes Android Studio ya lo
tienes; si no, cualquier JDK vale):

```
keytool -genkeypair -v -keystore remindmelater.jks -alias remindmelater -keyalg RSA -keysize 2048 -validity 10000
```

Te preguntará dos contraseñas (la del keystore y la de la clave —
puedes usar la misma en las dos) y unos datos de identidad (nombre,
ciudad… puedes poner lo que quieras). El resultado es el archivo
`remindmelater.jks`.

Después conviértelo a base64 (texto plano, para poder guardarlo como
secreto de GitHub):

- **Windows (PowerShell)**:
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes("remindmelater.jks")) | Set-Content remindmelater.jks.b64.txt`
- **Mac/Linux**:
  `base64 -i remindmelater.jks > remindmelater.jks.b64.txt`

## 2. Los 4 secretos en GitHub (una sola vez)

En el repo: **Settings → Secrets and variables → Actions → New
repository secret**. Añade estos 4 (los valores solo se escriben ahí,
nunca en ningún otro sitio — tampoco en el chat):

| Nombre | Valor |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | El contenido completo de `remindmelater.jks.b64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | La contraseña del keystore |
| `ANDROID_KEY_ALIAS` | `remindmelater` (el alias del comando de arriba) |
| `ANDROID_KEY_PASSWORD` | La contraseña de la clave (si usaste la misma, repítela) |

## 3. Cuenta de Google Play Console (una sola vez)

1. Entra en <https://play.google.com/console> y regístrate como
   desarrollador (pago único de 25 USD; Google verifica tu identidad,
   puede tardar uno o dos días).
2. **Crear aplicación** → nombre "RemindMeLater", idioma español, tipo
   Aplicación, gratis.
3. No hace falta rellenar toda la ficha de la tienda para probarla tú:
   con la sección **Pruebas → Pruebas internas** basta (hasta 100
   probadores por email, sin revisión completa de Google).

## 4. Lanzar una compilación

1. En GitHub: pestaña **Actions** → workflow **Android Google Play** →
   **Run workflow** → elige la rama (por ejemplo `movil-ui`) → Run.
2. Espera a que termine (unos 5-10 minutos).
3. Entra en esa ejecución y baja el artefacto
   **remindmelater-release-aab** (dentro va `app-release.aab`).

## 5. Subir a Google Play e instalar

1. Play Console → tu app → **Pruebas → Pruebas internas → Crear nueva
   versión** → sube el `app-release.aab`.
   - La primera vez te ofrecerá que **Google gestione la clave de firma
     de la app** ("Play App Signing"): acepta — tu keystore pasa a ser
     la "clave de subida" y Google guarda la definitiva, así hay red de
     seguridad si algún día pierdes la tuya.
2. En la misma sección, pestaña **Probadores**: crea una lista con tu
   propio email de Google.
3. Copia el **enlace de la prueba** que da la consola, ábrelo en tu
   móvil Android, acepta ser probador e instala la app desde Play.

Las versiones siguientes son solo repetir los pasos 4 y 5.1: cada
ejecución del workflow sube sola el número de versión (usa el número de
ejecución), así Google Play nunca la rechaza por versión repetida.

## Si algo falla

El registro de la ejecución en la pestaña Actions dice exactamente qué
paso falló — se puede pegar en el chat para depurarlo. El workflow está
escrito con el patrón estándar de Capacitor + Gradle, pero la primera
ejecución real (con tus secretos de verdad) es la primera prueba real.
