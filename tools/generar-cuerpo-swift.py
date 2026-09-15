#!/usr/bin/env python3
"""Genera la geometria del mapa de musculos para el widget de iOS.

POR QUE EXISTE ESTO
-------------------
El widget del cuerpo dibuja las MISMAS siluetas y las mismas zonas que el
mapa de la pestana Progreso. Esa geometria son ~6 KB de coordenadas que
NO cambian nunca, asi que mandarlas 24 veces al dia por el buzon
compartido seria tirar espacio: lo que viaja es solo la intensidad de
cada musculo (un numero de 0 a 1), y las coordenadas viven en el Swift.

El precio de esa decision es que hay DOS copias de lo mismo, y dos copias
se separan. Por eso no se escriben a mano: se generan de app.js con este
guion, y tools/comprobar-widgets.py vuelve a generarlas y falla si lo que
hay en el repositorio no coincide. O sea que tocar el mapa en app.js y
olvidarse del widget da un error ruidoso, no un cuerpo mal dibujado.

USO
---
    python3 tools/generar-cuerpo-swift.py            # escribe el .swift
    python3 tools/generar-cuerpo-swift.py --comprobar # solo compara
"""
import re
import sys
import os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_JS = os.path.join(RAIZ, 'public', 'app.js')
DESTINO = os.path.join(RAIZ, 'ios', 'App', 'DescansoWidget', 'CuerpoDelWidget.swift')


def bloque(texto, nombre):
    """El array literal de `const NOMBRE = [ ... ];` de app.js.

    Se busca el corchete de cierre contando corchetes, no con un regex:
    dentro hay corchetes anidados y un regex perezoso cortaria por el
    primero.
    """
    inicio = texto.index(f'const {nombre} = [')
    i = texto.index('[', inicio)
    nivel = 0
    for j in range(i, len(texto)):
        if texto[j] == '[':
            nivel += 1
        elif texto[j] == ']':
            nivel -= 1
            if nivel == 0:
                return texto[i:j + 1]
    raise SystemExit(f'No se pudo leer {nombre} de app.js')


def sin_comentarios(texto):
    return re.sub(r'//[^\n]*', '', texto)


def zonas(texto):
    """[(grupo, tx, [poligonos])] de GYM_BODYMAP_ZONES."""
    crudo = sin_comentarios(bloque(texto, 'GYM_BODYMAP_ZONES'))
    salida = []
    for m in re.finditer(r"\{\s*g:\s*'([^']+)'\s*,\s*tx:\s*(\d+)\s*,\s*polys:\s*\[(.*?)\]\s*,?\s*\}", crudo, re.S):
        polys = re.findall(r"'([^']+)'", m.group(3))
        salida.append((m.group(1), int(m.group(2)), polys))
    return salida


def silueta(texto):
    """[(tx, [poligonos])] de GYM_BODYMAP_SILHOUETTE."""
    crudo = sin_comentarios(bloque(texto, 'GYM_BODYMAP_SILHOUETTE'))
    salida = []
    for m in re.finditer(r"\{\s*tx:\s*(\d+)\s*,\s*polys:\s*\[(.*?)\]\s*,?\s*\}", crudo, re.S):
        polys = re.findall(r"'([^']+)'", m.group(2))
        salida.append((int(m.group(1)), polys))
    return salida


def puntos_swift(cadena):
    """"518 416 510 551" -> "[518, 416, 510, 551]" (pares x,y)."""
    numeros = [n for n in cadena.replace(',', ' ').split() if n]
    if len(numeros) % 2 != 0:
        raise SystemExit(f'Poligono con un numero impar de coordenadas: {cadena[:40]}...')
    return '[' + ', '.join(numeros) + ']'


def generar():
    texto = open(APP_JS, encoding='utf-8').read()
    zs = zonas(texto)
    sil = silueta(texto)
    if not zs or not sil:
        raise SystemExit('app.js no trajo ni zonas ni silueta: ¿cambio el formato?')

    lineas = []
    a = lineas.append
    a('// GENERADO POR tools/generar-cuerpo-swift.py -- NO SE EDITA A MANO.')
    a('//')
    a('// Las siluetas y las zonas del mapa de musculos, copiadas de')
    a('// GYM_BODYMAP_ZONES / GYM_BODYMAP_SILHOUETTE de public/app.js.')
    a('//')
    a('// Estan aqui y no en el buzon compartido porque son geometria FIJA:')
    a('// ~6 KB que no cambian nunca. Lo que si viaja desde la app es la')
    a('// intensidad de cada musculo (0 a 1), que es lo unico que cambia con')
    a('// cada entreno.')
    a('//')
    a('// Si tocas el mapa en app.js, vuelve a lanzar el generador. Y si se te')
    a('// olvida, tools/comprobar-widgets.py te lo dice antes de compilar.')
    a('')
    a('import SwiftUI')
    a('')
    a('// El lienzo original del SVG de la app. El widget escala a su tamaño')
    a('// respetando la proporcion, asi que las coordenadas se usan tal cual.')
    a('let anchoDelCuerpo: CGFloat = 2120')
    a('let altoDelCuerpo: CGFloat = 2210')
    a('')
    a('// Un poligono: los pares x,y seguidos, y cuanto hay que desplazarlo en')
    a('// horizontal (0 = figura de frente, 1120 = figura de espalda).')
    a('struct PoligonoDelCuerpo {')
    a('    let tx: CGFloat')
    a('    let puntos: [CGFloat]')
    a('}')
    a('')
    a('// Una zona pintable, con el id del grupo muscular que le corresponde.')
    a('// Ese id es el mismo de GYM_MUSCLE_GROUPS en app.js y el mismo que')
    a('// llega en el resumen, asi que sirve de llave directa.')
    a('struct ZonaDelCuerpo {')
    a('    let grupo: String')
    a('    let poligonos: [PoligonoDelCuerpo]')
    a('}')
    a('')
    a('let siluetaDelCuerpo: [PoligonoDelCuerpo] = [')
    for tx, polys in sil:
        for poly in polys:
            a(f'    PoligonoDelCuerpo(tx: {tx}, puntos: {puntos_swift(poly)}),')
    a(']')
    a('')
    a('let zonasDelCuerpo: [ZonaDelCuerpo] = [')
    for grupo, tx, polys in zs:
        a(f'    ZonaDelCuerpo(grupo: "{grupo}", poligonos: [')
        for poly in polys:
            a(f'        PoligonoDelCuerpo(tx: {tx}, puntos: {puntos_swift(poly)}),')
        a('    ]),')
    a(']')
    a('')
    return '\n'.join(lineas)


if __name__ == '__main__':
    nuevo = generar()
    if '--comprobar' in sys.argv:
        try:
            actual = open(DESTINO, encoding='utf-8').read()
        except FileNotFoundError:
            print('FALTA CuerpoDelWidget.swift: lanza python3 tools/generar-cuerpo-swift.py')
            sys.exit(1)
        if actual != nuevo:
            print('CuerpoDelWidget.swift NO coincide con el mapa de app.js.')
            print('Vuelve a generarlo: python3 tools/generar-cuerpo-swift.py')
            sys.exit(1)
        print('El cuerpo del widget coincide con el de app.js.')
    else:
        open(DESTINO, 'w', encoding='utf-8').write(nuevo)
        print(f'Escrito {os.path.relpath(DESTINO, RAIZ)}')
