"""Dos comprobaciones que no puede hacer el compilador desde aqui.

1) El pbxproj: en Linux no hay plutil, y un id duplicado o una referencia
   a un id que no existe no da un error legible -- deja el proyecto medio
   roto y Xcode se queja de otra cosa.

2) Las constantes que viajan entre JavaScript y Swift: el App Group, la
   clave del buzon y los "kind" de los widgets. Si una letra no coincide,
   NO hay ningun error: la app cree que refresca y el widget se queda con
   lo de antes, o se queda en blanco para siempre. Paso de verdad.
"""
import re, sys, io, json

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

# --- resultado -------------------------------------------------------
if fallos:
    print('FALLOS:')
    for f in fallos:
        print(' -', f)
    sys.exit(1)
print(f'Todo cuadra: {len(swift_widget)} archivos Swift en el widget, '
      f'{len(kinds_decl)} widgets, {len(destinos_swift)} destinos, '
      f'{len(claves_swift)} claves de JSON.')
