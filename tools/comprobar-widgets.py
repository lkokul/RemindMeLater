"""Dos comprobaciones que no puede hacer el compilador desde aqui.

1) El pbxproj: en Linux no hay plutil, y un id duplicado o una referencia
   a un id que no existe no da un error legible -- deja el proyecto medio
   roto y Xcode se queja de otra cosa.

2) Las constantes que viajan entre JavaScript y Swift: el App Group, la
   clave del buzon y los "kind" de los widgets. Si una letra no coincide,
   NO hay ningun error: la app cree que refresca y el widget se queda con
   lo de antes, o se queda en blanco para siempre. Paso de verdad.
"""
import re, sys, io, json, os

fallos = []

# --- 1) pbxproj ------------------------------------------------------
p = 'ios/App/App.xcodeproj/project.pbxproj'
s = io.open(p, encoding='utf-8').read()

if s.count('{') != s.count('}'):
    fallos.append(f'pbxproj: llaves descuadradas ({s.count("{")} abren, {s.count("}")} cierran)')

# Secciones Begin/End emparejadas
begins = re.findall(r'/\* Begin (\w+) section \*/', s)
ends = re.findall(r'/\* End (\w+) section \*/', s)
if begins != ends:
    fallos.append(f'pbxproj: secciones descuadradas {begins} vs {ends}')

# Ids DEFINIDOS: "<ID> /* algo */ = {" o "<ID> = {"
definidos = set(re.findall(r'^\t\t([0-9A-F]{24})\s*(?:/\*.*?\*/)?\s*=\s*\{', s, re.M))
# Ids USADOS en cualquier sitio
usados = set(re.findall(r'\b([0-9A-F]{24})\b', s))
huerfanos = usados - definidos
if huerfanos:
    fallos.append(f'pbxproj: ids usados pero NO definidos: {sorted(huerfanos)}')

# Duplicados en las definiciones
todas = re.findall(r'^\t\t([0-9A-F]{24})\s*(?:/\*.*?\*/)?\s*=\s*\{', s, re.M)
dups = {i for i in todas if todas.count(i) > 1}
if dups:
    fallos.append(f'pbxproj: ids DEFINIDOS dos veces: {sorted(dups)}')

# Los archivos Swift del widget tienen que estar los cuatro en la fase
# de Sources de la extension.
import os
swift_widget = sorted(f for f in os.listdir('ios/App/DescansoWidget') if f.endswith('.swift'))
for f in swift_widget:
    if f'{f} in Sources */,' not in s:
        fallos.append(f'pbxproj: {f} no esta en ninguna fase de Sources')

# Los archivos que llevan un AppIntent que ejecuta el CENTRO DE CONTROL
# tienen que estar en LAS DOS fases de Sources (app + extension). Si solo
# estan en la extension, iOS no encuentra a quien ejecutarlos en el
# proceso de la app y el boton del centro de control no hace NADA, sin
# ningun error. Paso de verdad (build #55). Es la comprobacion mas barata
# que existe para un fallo que solo se ve con un iPhone en la mano.
for f in ('AbrirDesdeControl.swift', 'ExtenderDescansoIntent.swift'):
    veces = s.count(f'{f} in Sources */,')
    if veces != 2:
        fallos.append(
            f'pbxproj: {f} aparece en {veces} fase(s) de Sources, tienen que ser 2 '
            '(la app y la extension) o el centro de control se queda mudo')

# Y cada intent que use un boton de control tiene que existir de verdad
# en ese archivo compartido, no en el del widget.
intents = io.open('ios/App/App/AbrirDesdeControl.swift', encoding='utf-8').read()
for texto in (io.open('ios/App/DescansoWidget/WidgetsDeLaApp.swift', encoding='utf-8').read(),
              io.open('ios/App/DescansoWidget/QueTocaHoyWidget.swift', encoding='utf-8').read()):
    for accion in re.findall(r'ControlWidgetButton\(action:\s*(\w+)\(\)\)', texto):
        if f'struct {accion}: AppIntent' not in intents:
            fallos.append(f'{accion} no esta en AbrirDesdeControl.swift (el boton no haria nada)')
    if 'ControlWidgetButton(action: OpenURLIntent(' in texto:
        fallos.append('ControlWidgetButton con OpenURLIntent: iOS NO abre '
                      'esquemas propios desde un control, el boton se queda mudo')

# El App Group esta escrito DOS veces a proposito (AbrirDesdeControl.swift
# se compila tambien en la app, y no puede importar el de la extension).
# Si las dos cadenas dejan de coincidir, el boton del centro de control
# escribe en un buzon que la app no mira -- que es exactamente el fallo
# que costo la build #56, y no da ningun error.
control = io.open('ios/App/App/AbrirDesdeControl.swift', encoding='utf-8').read()
m = re.search(r'let grupoDeLaAppParaControl = "([^"]+)"', control)
if not m:
    fallos.append('AbrirDesdeControl.swift: falta grupoDeLaAppParaControl')
else:
    m2 = re.search(r'let grupoDeLaApp = "([^"]+)"',
                   io.open('ios/App/DescansoWidget/ResumenDeLaApp.swift', encoding='utf-8').read())
    if not m2 or m.group(1) != m2.group(1):
        fallos.append(f'El App Group de AbrirDesdeControl ({m.group(1)}) no coincide con el del widget')

# Y las claves de la marca tienen que ser las MISMAS que consume el plugin.
plugin_txt = io.open('ios/App/App/WidgetBridgePlugin.swift', encoding='utf-8').read()
for clave in re.findall(r'forKey: "([^"]+)"', control):
    if f'"{clave}"' not in plugin_txt:
        fallos.append(f'AbrirDesdeControl escribe "{clave}" y el plugin no la consume')

# --- 2) constantes compartidas ---------------------------------------
def leer(ruta):
    return io.open(ruta, encoding='utf-8').read()

modelo = leer('ios/App/DescansoWidget/ResumenDeLaApp.swift')
plugin = leer('ios/App/App/WidgetBridgePlugin.swift')
widgets = leer('ios/App/DescansoWidget/WidgetsDeLaApp.swift')
gym = leer('ios/App/DescansoWidget/QueTocaHoyWidget.swift')
# Los widgets de la tanda del 11/9/2026 (calendario, consistencia, mapa,
# cifras, musculos). Se suman a `widgets` para que TODAS las
# comprobaciones de abajo -- kinds, registro en el bundle, claves del
# JSON -- los cubran igual que a los demas. La primera vez que se anadio
# este archivo sin hacer esto, el guion dio por bueno un bundle al que le
# faltaban cinco widgets.
nuevos = leer('ios/App/DescansoWidget/WidgetsNuevos.swift')
widgets = widgets + '\n' + nuevos
bundle = leer('ios/App/DescansoWidget/DescansoWidgetBundle.swift')
escena = leer('ios/App/App/SceneDelegate.swift')
puente = leer('public/widget-bridge.js')
entApp = leer('ios/App/App/App.entitlements')
entWid = leer('ios/App/DescansoWidget/DescansoWidget.entitlements')

def uno(patron, texto, que):
    m = re.search(patron, texto)
    if not m:
        fallos.append(f'no encuentro {que}')
        return None
    return m.group(1)

grupo_modelo = uno(r'let grupoDeLaApp = "([^"]+)"', modelo, 'el App Group del modelo')
grupo_plugin = uno(r'static let grupo = "([^"]+)"', plugin, 'el App Group del plugin')
if grupo_modelo and grupo_plugin and grupo_modelo != grupo_plugin:
    fallos.append(f'App Group distinto: modelo={grupo_modelo} plugin={grupo_plugin}')
for nombre, ent in (('app', entApp), ('widget', entWid)):
    if grupo_modelo and grupo_modelo not in ent:
        fallos.append(f'el App Group {grupo_modelo} no esta en los entitlements de la {nombre}')

clave_modelo = uno(r'let claveResumen = "([^"]+)"', modelo, 'la clave del buzon (modelo)')
clave_plugin = uno(r'static let claveResumen = "([^"]+)"', plugin, 'la clave del buzon (plugin)')
if clave_modelo and clave_plugin and clave_modelo != clave_plugin:
    fallos.append(f'clave del buzon distinta: modelo={clave_modelo} plugin={clave_plugin}')

# Los "kind": los que declara cada Widget vs los que refresca el plugin
# vs los que se registran en el bundle.
kinds_decl = set(re.findall(r'static let kind = "([^"]+)"', widgets + gym))
m = re.search(r'static let kinds = \[(.*?)\]', plugin, re.S)
kinds_plugin = set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()
if kinds_decl != kinds_plugin:
    fallos.append(f'los "kind" no cuadran:\n  declarados: {sorted(kinds_decl)}\n  refrescados: {sorted(kinds_plugin)}')

# Cada Widget declarado tiene que estar en el bundle, o no existe.
for tipo in re.findall(r'^struct (\w+): Widget \{', widgets + gym, re.M):
    if f'{tipo}()' not in bundle:
        fallos.append(f'{tipo} no esta registrado en DescansoWidgetBundle')

# Los destinos: los que declara el enum de Swift, los que reconoce
# SceneDelegate, y los que sabe atender el JavaScript.
# Un `case a, b, c` en una linea es tan valido como uno por linea, asi
# que hay que partir por comas y no fiarse de un regex por case.
bloque = re.search(r'enum DestinoDeWidget[^}]+\}', widgets, re.S).group(0)
destinos_swift = set()
for linea in bloque.splitlines():
    linea = linea.strip()
    if not linea.startswith('case '):
        continue
    for trozo in linea[5:].split(','):
        trozo = trozo.strip()
        if not trozo:
            continue
        m = re.match(r'\w+\s*=\s*"([^"]+)"', trozo)
        destinos_swift.add(m.group(1) if m else trozo)
m = re.search(r'let destinos = \[(.*?)\]', escena, re.S)
destinos_escena = set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()
if destinos_swift != destinos_escena:
    fallos.append(f'destinos descuadrados:\n  enum: {sorted(destinos_swift)}\n  SceneDelegate: {sorted(destinos_escena)}')

# Y que el JavaScript los atienda todos.
app = leer('public/app.js')
for d in sorted(destinos_swift):
    if f"'{d}'" not in app:
        fallos.append(f"el destino '{d}' no lo atiende app.js")

# Las claves del JSON: las que escribe el JS vs las que lee Swift.
#
# Se miran TODAS las lineas "case" de CADA enum CodingKeys, y en los DOS
# modelos (el resumen general y el del Gimnasio, que tiene el suyo). La
# version anterior de esto solo cogia la PRIMERA linea case de cada enum y
# solo miraba un archivo: al partir un enum en dos lineas dejo de ver
# cinco claves nuevas sin decir nada, que es justo el fallo que este
# guion existe para pillar.
claves_swift = set()
for texto_swift in (modelo, gym):
    for bloque in re.finditer(r'enum CodingKeys: String, CodingKey \{(.*?)\}', texto_swift, re.S):
        for linea in re.findall(r'case ([^\n]+)', bloque.group(1)):
            for c in linea.split(','):
                # "case fondo = "bg"" -> la clave del JSON es la de la
                # derecha; sin "=" es el propio nombre.
                c = c.split('=')[-1].strip().strip('"')
                if c:
                    claves_swift.add(c)
faltan = sorted(k for k in claves_swift if k not in puente)
if faltan:
    fallos.append(f'claves que Swift lee y el JavaScript no escribe: {faltan}')

# --- 3) nombres que se tapan entre si --------------------------------
#
# Esto tumbo la build #57 y no lo pillaba nada. En ResumenDeLaApp.swift
# habia una funcion de ARCHIVO llamada `texto(...)` (el ayudante que
# decodifica una cadena) y al struct se le anadio una PROPIEDAD tambien
# llamada `texto`. Dentro del struct, el nombre corto se resuelve a la
# propiedad, no a la funcion, asi que las ocho llamadas `texto(c, ...)`
# dejaron de compilar:
#
#   error: use of 'texto' refers to instance method rather than global
#          function 'texto' in module 'DescansoWidget'
#
# Ojo: en QueTocaHoyWidget.swift el mismo ayudante NO da problema porque
# alli es una funcion LOCAL declarada dentro del init, y esas si ganan a
# la propiedad. Por eso la regla mira solo las funciones de archivo.
SWIFT = ([f'ios/App/DescansoWidget/{f}' for f in swift_widget]
         + [f'ios/App/App/{f}' for f in sorted(os.listdir('ios/App/App'))
            if f.endswith('.swift')])
for ruta in sorted(SWIFT):
    txt = leer(ruta)
    # Funciones declaradas al ras del archivo (sin sangria).
    funcs = set(re.findall(r'^(?:private |internal |public |fileprivate )*func (\w+)\(', txt, re.M))
    if not funcs:
        continue
    # Propiedades almacenadas de cualquier tipo del mismo archivo (con
    # sangria, que es lo que las distingue de una variable de archivo).
    props = set(re.findall(r'^\s+(?:var|let) (\w+)\s*[:=]', txt, re.M))
    choque = sorted(funcs & props)
    if choque:
        fallos.append(
            f'{ruta}: {choque} es a la vez funcion de archivo y propiedad; '
            'dentro del tipo gana la propiedad y las llamadas no compilan '
            '(renombra la funcion, p. ej. leerTexto)')

# --- 4) equilibrio de llaves en el Swift ------------------------------
#
# Aqui no hay Xcode, asi que un parentesis o una llave de menos no se
# descubre hasta que falla la compilacion en el runner -- y eso son 15
# minutos y una build gastada. Este recorrido va caracter a caracter
# llevando la cuenta de lo que un regex NO sabe llevar:
#
# - los comentarios de bloque de Swift ANIDAN (/* /* */ */),
# - las cadenas admiten interpolacion \(...) con parentesis dentro,
#   comillas dentro y hasta otra cadena dentro,
# - y las cadenas de tres comillas se comen todo lo demas.
#
# Sin esto, un `\(n == 1 ? "" : "s")` se traga medio archivo.
def equilibrio(txt):
    pila = []          # llaves/parentesis/corchetes abiertos
    interp = []        # profundidad de parentesis de cada \( abierta
    i, n = 0, len(txt)
    comentario = 0     # nivel de /* anidado
    cadena = None      # None, '"' o '"""'
    linea = 1
    while i < n:
        c = txt[i]
        if c == '\n':
            linea += 1
        if comentario:
            if txt.startswith('/*', i):
                comentario += 1; i += 2; continue
            if txt.startswith('*/', i):
                comentario -= 1; i += 2; continue
            i += 1; continue
        if cadena:
            if c == '\\':
                # \( abre interpolacion: se vuelve a codigo hasta cerrarla
                if txt.startswith('\\(', i):
                    interp.append(len(pila))
                    pila.append(('(', linea))
                    cadena = None
                    i += 2; continue
                i += 2; continue   # cualquier otro escape
            if cadena == '"""' and txt.startswith('"""', i):
                cadena = None; i += 3; continue
            if cadena == '"' and c == '"':
                cadena = None; i += 1; continue
            i += 1; continue
        # --- codigo normal ---
        if txt.startswith('//', i):
            j = txt.find('\n', i)
            i = n if j < 0 else j; continue
        if txt.startswith('/*', i):
            comentario = 1; i += 2; continue
        if txt.startswith('"""', i):
            cadena = '"""'; i += 3; continue
        if c == '"':
            cadena = '"'; i += 1; continue
        if c in '([{':
            pila.append((c, linea)); i += 1; continue
        if c in ')]}':
            if not pila:
                return f'linea {linea}: sobra un "{c}"'
            abierto, donde = pila.pop()
            if abierto != {')': '(', ']': '[', '}': '{'}[c]:
                return f'linea {linea}: "{c}" cierra un "{abierto}" abierto en la linea {donde}'
            # Se cerro el parentesis de una interpolacion: vuelve la cadena
            if interp and len(pila) == interp[-1]:
                interp.pop()
                cadena = '"'
            i += 1; continue
        i += 1
    if pila:
        abierto, donde = pila[-1]
        return f'se queda sin cerrar un "{abierto}" abierto en la linea {donde}'
    if comentario:
        return 'se queda un /* sin cerrar'
    if cadena:
        return 'se queda una cadena sin cerrar'
    return None

for ruta in sorted(SWIFT):
    mal = equilibrio(leer(ruta))
    if mal:
        fallos.append(f'{ruta}: {mal}')

# --- 5) el cuerpo del widget no puede separarse del de la app ---------
#
# CuerpoDelWidget.swift son las MISMAS coordenadas que GYM_BODYMAP_ZONES
# y GYM_BODYMAP_SILHOUETTE de app.js, generadas por
# tools/generar-cuerpo-swift.py. Estan duplicadas a proposito (son 6 KB
# de geometria fija que no tiene sentido mandar por el buzon 24 veces al
# dia), y el precio de duplicar es que se separan. Esto lo impide: se
# vuelve a generar y se compara.
import subprocess
try:
    r = subprocess.run(
        [sys.executable, os.path.join('tools', 'generar-cuerpo-swift.py'), '--comprobar'],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        fallos.append('el cuerpo del widget no coincide con el de app.js: '
                      + (r.stdout.strip() or r.stderr.strip()))
except Exception as err:  # noqa: BLE001
    fallos.append(f'no se pudo comprobar el cuerpo del widget: {err}')

# --- 6) manifiestos de privacidad y limpieza de red ------------------
#
# PrivacyInfo.xcprivacy es OBLIGATORIO desde el 1 de mayo de 2024 para
# cualquier app que use "APIs de motivo requerido" (aqui, UserDefaults: el
# buzon del App Group). Si falta, App Store Connect avisa por correo y
# acaba rechazando la subida, pero TestFlight interno pasa igual: o sea que
# se puede perder sin que nada chille durante meses. Esto lo impide.
#
# De paso se vigila que no vuelvan los restos del programa
# cliente-servidor. La app no hace NINGUNA peticion de red, y si alguien
# vuelve a meter una excepcion de ATS, la copia automatica de Android o un
# CDN, se entera aqui y no en la revision de Apple.
# Ver SEGURIDAD-Y-PRIVACIDAD.md.

# Sin los comentarios: el propio Info.plist EXPLICA en un comentario por
# que ya no lleva esas claves, y buscar el nombre a secas daba un falso
# positivo contra ese mismo texto.
def sin_comentarios_css(txt):
    return re.sub(r'/\*.*?\*/', '', txt, flags=re.S)

def sin_comentarios_xml(txt):
    return re.sub(r'<!--.*?-->', '', txt, flags=re.S)

for ruta, target in (
    ('ios/App/App/PrivacyInfo.xcprivacy', 'la app'),
    ('ios/App/DescansoWidget/PrivacyInfo.xcprivacy', 'el widget'),
):
    if not os.path.exists(ruta):
        fallos.append(f'falta el manifiesto de privacidad de {target} ({ruta})')
        continue
    manifiesto = leer(ruta)
    if 'NSPrivacyAccessedAPICategoryUserDefaults' not in manifiesto:
        fallos.append(f'el manifiesto de {target} no declara UserDefaults, que '
                      'es la API de motivo requerido que usa el App Group')
    if 'CA92.1' not in manifiesto:
        fallos.append(f'el manifiesto de {target} no trae el motivo CA92.1')

# Y que esten de verdad en una fase de Resources, no solo en el disco: un
# archivo suelto en la carpeta no viaja dentro del .ipa.
if s.count('PrivacyInfo.xcprivacy in Resources */,') != 2:
    fallos.append('esperaba los DOS manifiestos de privacidad en fases de '
                  'Resources (app y widget): si no, no viajan en el .ipa')

plist_app = sin_comentarios_xml(leer('ios/App/App/Info.plist'))
if 'NSAllowsArbitraryLoads' in plist_app:
    fallos.append('vuelve a haber NSAllowsArbitraryLoads en el Info.plist: la '
                  'app no habla con ningun servidor, esa excepcion solo suma '
                  'superficie de ataque y preguntas en la revision')
if 'NSLocalNetworkUsageDescription' in plist_app:
    fallos.append('vuelve a haber NSLocalNetworkUsageDescription: describe una '
                  'sincronizacion que esta app ya no hace')

android = sin_comentarios_xml(leer('android/app/src/main/AndroidManifest.xml'))
if 'android:allowBackup="true"' in android:
    fallos.append('allowBackup vuelve a estar en true: eso sube la base de '
                  'datos entera a la copia automatica de Google')
if 'usesCleartextTraffic="true"' in android:
    fallos.append('usesCleartextTraffic vuelve a estar en true')
if not os.path.exists('android/app/src/main/res/xml/data_extraction_rules.xml'):
    fallos.append('falta data_extraction_rules.xml (Android 12+ ignora '
                  'allowBackup y mira este archivo)')

indice = sin_comentarios_xml(leer('public/index.html'))

# La CSP es la red que salva cuando el saneador falla. Si alguien la quita
# o la relaja, la app sigue funcionando exactamente igual -- por eso se
# puede perder sin que nadie se entere, y por eso se comprueba aqui.
if 'Content-Security-Policy' not in indice:
    fallos.append('index.html se ha quedado sin Content-Security-Policy')
else:
    csp = re.search(r'Content-Security-Policy"\s+content="([^"]+)"', indice)
    csp = csp.group(1) if csp else ''
    if "script-src 'self' 'wasm-unsafe-eval'" not in csp:
        fallos.append("la CSP tiene que llevar script-src 'self' 'wasm-unsafe-eval' "
                      '(sin wasm-unsafe-eval sql.js no arranca; con unsafe-inline '
                      'la CSP deja de servir para nada)')
    if "'unsafe-inline'" in csp.split('style-src')[0]:
        fallos.append("la CSP lleva 'unsafe-inline' en script-src: eso deja pasar "
                      'justo lo que la CSP existe para parar (onerror=, onfocus=...)')
    if "connect-src 'self'" not in csp:
        fallos.append("la CSP tiene que llevar connect-src 'self': es lo que impide "
                      'que un codigo inyectado se mande la base a un servidor')
# Con esa CSP, un <script> en linea NO se ejecuta: el arranque tiene que
# seguir viviendo en arranque.js.
if re.search(r'<script>\s*\n', indice):
    fallos.append('index.html vuelve a tener un <script> en linea: la CSP lo '
                  'bloquearia en silencio (el arranque va en arranque.js)')
if re.search(r'<[a-z]+[^>]*\son[a-z]+\s*=', indice):
    fallos.append('index.html tiene un manejador on*= en linea: la CSP lo bloquea')
for cdn in ('fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net',
            'cdnjs.cloudflare.com', 'unpkg.com'):
    if cdn in indice:
        fallos.append(f'index.html vuelve a cargar algo de {cdn}: nada de CDN, '
                      'se vendoriza dentro de public/ (criterio de sql.js)')

# --- 7) en esta rama SOLO vive la app movil --------------------------
#
# El visor de escritorio (server/, electron/, la topbar, el panel lateral)
# vive en la rama `escritorio`. Aqui no, y el resto que quedaba -- un corte
# de 860px en el CSS y en el JS -- no era codigo muerto inofensivo: con el
# movil puesto en una tele la app se estiraba y se quedaba a medias,
# perdiendo los accesos rapidos del calendario y los gestos de navegacion.
# Un merge desde otra rama lo devolveria sin que nadie se diera cuenta.
css = leer('public/styles.css')
if re.search(r'@media[^{]*min-width', sin_comentarios_css(css)):
    fallos.append('vuelve a haber una media query de anchura en styles.css: '
                  'en esta rama la app es la misma a cualquier ancho (el visor '
                  'de escritorio vive en la rama escritorio)')
for carpeta in ('server', 'electron'):
    if os.path.isdir(carpeta):
        fallos.append(f'ha vuelto la carpeta {carpeta}/: es el programa de '
                      'escritorio, y esta rama es solo la app movil')

app_js = leer('public/app.js')
if app_js.count('function isMobileLayout') != 1:
    fallos.append('hay mas de una isMobileLayout(): en JavaScript gana la '
                  'ultima declaracion, asi que la otra queda muerta sin avisar '
                  '(ya paso una vez)')

# --- 8) el :hover no puede quedarse fuera de (hover: hover) ----------
#
# iOS aplica los estilos de :hover al TOCAR y los deja puestos hasta que
# tocas otra cosa: una regla :hover suelta hace que un boton se quede
# "pulsado" en el movil. Ya pasaba con la barra de abajo. Aqui se
# comprueba que TODA regla :hover vive dentro de @media (hover: hover).
css_crudo = sin_comentarios_css(leer('public/styles.css'))
abiertos = []
sueltas = []
for k, ch in enumerate(css_crudo):
    if ch == '{':
        anterior = css_crudo[max(0, k - 60):k]
        abiertos.append('hover' if re.search(r'@media\s*\(hover:\s*hover\)\s*$', anterior) else 'otro')
    elif ch == '}':
        if abiertos:
            abiertos.pop()
    elif css_crudo.startswith(':hover', k) and 'hover' not in abiertos:
        sueltas.append(css_crudo[max(0, k - 70):k + 6].replace('\n', ' ').strip()[-70:])
if sueltas:
    fallos.append(f'{len(sueltas)} regla(s) :hover fuera de @media (hover: hover) -- '
                  f'en el movil se quedan pegadas al tocar. La primera: {sueltas[0]}')

# Y que la escala tipografica no se salte por la calle de en medio.
if 'font-size: var(--t-' not in css_crudo:
    fallos.append('styles.css ya no usa los tokens de la escala tipografica')
sueltos = re.findall(r'font-size:\s*[0-9.]+rem', css_crudo)
if sueltos:
    fallos.append(f'{len(sueltos)} font-size en rem fuera de la escala: usa uno de '
                  f'los ocho tokens (--t-micro ... --t-titulo-grande). Ej: {sueltos[0]}')

# --- 9) nada de colores del SISTEMA dentro de los widgets ------------
#
# fondoDeWidgetApp pone el color del tema con .foregroundStyle en la RAIZ,
# y todo lo de dentro lo hereda. Un Color.primary/.white/.black escrito a
# mano PISA esa herencia con el color del SISTEMA, que no tiene nada que
# ver con el tema de la app.
#
# Paso de verdad: con el tema de la app en claro (fondo blanco) y el movil
# en modo oscuro, Color.primary es BLANCO, asi que los numeros de los dias
# del widget del calendario se volvieron invisibles. Solo se veia el
# circulo del dia de hoy. Lo mismo le pasaba al widget de Tareas.
#
# Lo que SI vale: .foreground (hereda), .secondary y .tertiary (son
# jerarquicos, se derivan del color de la raiz), Color.red para un aviso, y
# los colores que vienen del propio resumen (Color(hexDeLaApp:)).
for archivo, texto in (('WidgetsNuevos.swift', widgets),
                       ('QueTocaHoyWidget.swift', gym)):
    for linea in texto.split('\n'):
        limpia = linea.split('//')[0]
        if 'foregroundStyle' not in limpia and 'foregroundColor' not in limpia:
            continue
        for malo in ('Color.primary', 'Color.white', 'Color.black'):
            if malo in limpia:
                fallos.append(f'{archivo}: {malo} en un foregroundStyle pisa el color '
                              f'del tema que pone la raiz (con tema claro y movil en '
                              f'oscuro el texto se vuelve invisible). Usa .foreground, '
                              f'.secondary, o un color del resumen. Linea: {limpia.strip()[:70]}')

# --- resultado -------------------------------------------------------
if fallos:
    print('FALLOS:')
    for f in fallos:
        print(' -', f)
    sys.exit(1)
print(f'Todo cuadra: {len(swift_widget)} archivos Swift en el widget, '
      f'{len(kinds_decl)} widgets, {len(destinos_swift)} destinos, '
      f'{len(claves_swift)} claves de JSON.')
