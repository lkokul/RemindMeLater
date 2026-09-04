# Prueba de validación de Capacitor

Esto NO es documentación de usuario (eso es `README.md`) ni una app
lista para publicar -- es una guía de trabajo para probar, en un
dispositivo real, si envolver RemindMeLater con
[Capacitor](https://capacitorjs.com/) es un camino viable hacia App
Store / Google Play, antes de comprometernos a construir el pipeline
completo con GitHub Actions.

## Qué hace esta prueba (y qué no)

El WebView nativo (Android/iOS) **navega directamente a tu servidor
real** en la LAN -- exactamente como ya hace Electron con
`http://localhost:<puerto>`, pero aquí el móvil apunta a la IP/mDNS de
tu ordenador en vez de a sí mismo. Es literalmente "la misma app móvil
que ya usas desde el navegador, pero dentro de una carcasa nativa" --
nada del código de `public/`/`server/` se ha tocado para esto.

Por eso, todo lo que ya funciona en el navegador móvil sigue
funcionando igual aquí sin cambios: emparejamiento por código de 6
dígitos, el QR de reconexión multi-red, la copia local (IndexedDB) y
la sincronización manual, etc.

**Se prueban 3 cosas concretas** (las piezas de más riesgo real de que
algo se comporte distinto dentro de un WebView nativo empaquetado que
en Safari/Chrome normales):

1. El editor de notas con formato (`contenteditable` +
   `document.execCommand`) -- sobre todo en iOS, que usa WKWebView
   (motor Safari/WebKit), el único motor de este proyecto que nunca se
   ha probado hasta ahora (todo lo demás se prueba con Playwright, que
   usa Chromium -- el mismo motor que Android WebView, así que ahí el
   riesgo real es menor).
2. La sincronización con copia local (IndexedDB) -- forzar modo avión
   y comprobar que sigue funcionando igual que en el navegador.
3. Un aviso push de verdad con la app **cerrada del todo** -- aquí SÍ
   hace falta cambiar de mecanismo (ver más abajo), Web Push no es
   fiable dentro de un WebView empaquetado.

**Esto NO incluye** (fuera de alcance a propósito, para esta prueba
concreta): publicar nada en las tiendas, firmar para distribución
real, ni el pipeline de GitHub Actions -- eso llega después, solo si
esta prueba sale bien.

## Qué se hizo ya (en esta sesión, sin acceso a Android Studio/Xcode)

- Añadidas las dependencias de Capacitor (`@capacitor/core`,
  `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`) al
  `package.json`.
- `capacitor.config.json` creado (JSON plano, no `.ts` -- coherente
  con que este proyecto no usa build/TypeScript en ningún sitio).
- `android/` e `ios/` generados con `npx cap add android`/`ios` --
  **los dos se generaron bien en este contenedor**, aunque no tiene ni
  Android SDK ni Xcode instalados (solo hace falta el SDK/Xcode de
  verdad para COMPILAR/EJECUTAR, no para generar la plantilla del
  proyecto).
  - Dato útil: esta versión de Capacitor usa **Swift Package Manager**
    para iOS, no CocoaPods (no se generó ningún `Podfile`) -- no vas a
    necesitar instalar CocoaPods en tu Mac, Xcode resuelve los
    paquetes de Capacitor solo.
- `npx cap sync` corrido sin errores (copia `public/` a los dos
  proyectos nativos).
- 3 scripts nuevos en `package.json`: `npm run cap:sync`,
  `npm run cap:android` (abre Android Studio), `npm run cap:ios` (abre
  Xcode).

## Lo que tienes que hacer tú (esto sí necesita tu propio hardware)

### 1. Antes de nada: pon la dirección real de tu servidor

Abre `capacitor.config.json` y sustituye la URL de ejemplo por la
dirección real de tu ordenador -- la misma que ya ves impresa en la
consola cuando arrancas el servidor (`npm run dev`/`npm start`):
"Desde el movil (misma wifi, si el mDNS llega): ..." o la línea de
"por IP" justo debajo, como respaldo. Por ejemplo:

```json
"server": {
  "url": "http://remindmelater.local:3000",
  "cleartext": true
}
```

(`cleartext: true` hace falta porque Android bloquea HTTP plano por
defecto -- sin esto, el WebView rechazaría la conexión a tu servidor
LAN, que no tiene HTTPS.)

Después de cambiar esto, corre `npm run cap:sync` para que el cambio
llegue a los proyectos nativos.

### 2. Android (necesitas Android Studio instalado)

```
npm run cap:android
```
Esto abre el proyecto en Android Studio. Desde ahí, corre la app en un
emulador o en tu propio móvil (con tu servidor RemindMeLater
arrancado y en la misma wifi).

### 3. iOS (necesitas un Mac con Xcode)

```
npm run cap:ios
```
Esto abre el proyecto en Xcode. Corre la app en el Simulador o en tu
propio iPhone (con tu cuenta de Apple Developer, que ya tienes, de
sobra para firmar y probar localmente -- no hace falta TestFlight
todavía).

### 4. Checklist de qué probar en cada plataforma

- [ ] Emparejar el dispositivo con el código de 6 dígitos, igual que
      siempre.
- [ ] Abrir una nota, escribir, aplicar negrita/cursiva/subrayado/
      resaltado de color, listas, sangría, cita -- comprobar que todo
      se ve y se comporta igual que en el navegador móvil de siempre
      (esto es lo más importante de probar en **iOS**).
- [ ] Poner el dispositivo en modo avión, crear/editar una nota o un
      evento, volver a activar la conexión, y comprobar (con
      "Sincronizar ahora" en Archivos) que el cambio llega al
      ordenador.
- [ ] Cerrar la app del todo (no solo minimizarla) y comprobar qué
      pasa con los recordatorios -- **se espera que NO llegue ningún
      aviso** con Web Push tal cual está hoy; esto confirma que hace
      falta el paso siguiente.

### 5. Solo si el resto funciona bien: probar el push nativo

Esto necesita trabajo de consola que solo puedes hacer tú (no algo que
se pueda resolver a ciegas desde código):

- **Android**: crear un proyecto en [Firebase](https://firebase.google.com/)
  (gratis), descargar `google-services.json` y añadirlo al proyecto.
- **iOS**: subir una clave/certificado APNs a tu cuenta de Apple
  Developer (ya la tienes).

Con eso hecho, se añadiría el plugin `@capacitor/push-notifications` y
un botón de prueba simple ("pedir permiso + mostrar el token") para
confirmar que el plugin se integra bien, antes de conectar el envío
real desde `server/reminderChecker.js` (que hoy solo manda Web Push).

## Decisión pendiente

Cuando hayas probado esto en tu propio dispositivo, dime qué tal
(sobre todo el editor de notas en iOS) y decidimos si seguimos
adelante con el pipeline completo de GitHub Actions, o si hace falta
ajustar algo antes.
