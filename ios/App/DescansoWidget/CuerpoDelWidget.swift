// GENERADO POR tools/generar-cuerpo-swift.py -- NO SE EDITA A MANO.
//
// Las siluetas y las zonas del mapa de musculos, copiadas de
// GYM_BODYMAP_ZONES / GYM_BODYMAP_SILHOUETTE de public/app.js.
//
// Estan aqui y no en el buzon compartido porque son geometria FIJA:
// ~6 KB que no cambian nunca. Lo que si viaja desde la app es la
// intensidad de cada musculo (0 a 1), que es lo unico que cambia con
// cada entreno.
//
// Si tocas el mapa en app.js, vuelve a lanzar el generador. Y si se te
// olvida, tools/comprobar-widgets.py te lo dice antes de compilar.

import SwiftUI

// El lienzo original del SVG de la app. El widget escala a su tamaño
// respetando la proporcion, asi que las coordenadas se usan tal cual.
let anchoDelCuerpo: CGFloat = 2120
let altoDelCuerpo: CGFloat = 2210

// Un poligono: los pares x,y seguidos, y cuanto hay que desplazarlo en
// horizontal (0 = figura de frente, 1120 = figura de espalda).
struct PoligonoDelCuerpo {
    let tx: CGFloat
    let puntos: [CGFloat]
}

// Una zona pintable, con el id del grupo muscular que le corresponde.
// Ese id es el mismo de GYM_MUSCLE_GROUPS en app.js y el mismo que
// llega en el resumen, asi que sirve de llave directa.
struct ZonaDelCuerpo {
    let grupo: String
    let poligonos: [PoligonoDelCuerpo]
}

let siluetaDelCuerpo: [PoligonoDelCuerpo] = [
    PoligonoDelCuerpo(tx: 0, puntos: [424, 29, 400, 118, 420, 196, 461, 233, 498, 253, 547, 224, 576, 192, 592, 102, 571, 24, 498, 0]),
    PoligonoDelCuerpo(tx: 0, puntos: [339, 1400, 347, 1433, 355, 1473, 363, 1510, 351, 1567, 298, 1567, 273, 1527, 273, 1473, 302, 1441]),
    PoligonoDelCuerpo(tx: 0, puntos: [657, 1400, 722, 1478, 722, 1522, 698, 1571, 649, 1567, 629, 1510]),
    PoligonoDelCuerpo(tx: 0, puntos: [714, 1604, 735, 1535, 767, 1612, 796, 1678, 784, 1878, 796, 1955, 747, 1955]),
    PoligonoDelCuerpo(tx: 0, puntos: [249, 1947, 278, 1649, 282, 1604, 261, 1543, 249, 1576, 224, 1616, 208, 1678, 220, 1882, 208, 1955]),
    PoligonoDelCuerpo(tx: 0, puntos: [727, 1951, 698, 1592, 653, 1584, 641, 1624, 641, 1653, 657, 1771]),
    PoligonoDelCuerpo(tx: 0, puntos: [355, 1584, 359, 1624, 359, 1669, 351, 1722, 351, 1767, 322, 1820, 306, 1873, 269, 1947, 273, 1878, 282, 1804, 286, 1755, 290, 1698, 298, 1641, 302, 1588]),
    PoligonoDelCuerpo(tx: 1120, puntos: [506, 0, 460, 9, 409, 55, 404, 128, 451, 200, 557, 200, 591, 136, 596, 47, 557, 13]),
    PoligonoDelCuerpo(tx: 1120, puntos: [345, 1532, 311, 1591, 336, 1664, 374, 1626]),
    PoligonoDelCuerpo(tx: 1120, puntos: [664, 1536, 630, 1630, 668, 1664, 694, 1591]),
]

let zonasDelCuerpo: [ZonaDelCuerpo] = [
    ZonaDelCuerpo(grupo: "pecho", poligonos: [
        PoligonoDelCuerpo(tx: 0, puntos: [518, 416, 510, 551, 580, 580, 678, 555, 706, 473, 620, 416]),
        PoligonoDelCuerpo(tx: 0, puntos: [298, 465, 314, 555, 408, 580, 482, 551, 478, 420, 376, 420]),
    ]),
    ZonaDelCuerpo(grupo: "core", poligonos: [
        PoligonoDelCuerpo(tx: 0, puntos: [686, 633, 673, 571, 588, 596, 600, 641, 604, 833, 657, 788, 665, 698]),
        PoligonoDelCuerpo(tx: 0, puntos: [339, 784, 331, 718, 310, 633, 322, 571, 408, 592, 392, 633, 392, 837]),
        PoligonoDelCuerpo(tx: 0, puntos: [563, 592, 580, 641, 584, 780, 584, 927, 563, 984, 551, 1041, 514, 1078, 510, 845, 506, 673, 510, 571]),
        PoligonoDelCuerpo(tx: 0, puntos: [437, 588, 486, 571, 490, 673, 486, 845, 482, 1073, 445, 1037, 408, 914, 408, 784, 412, 645]),
    ]),
    ZonaDelCuerpo(grupo: "biceps", poligonos: [
        PoligonoDelCuerpo(tx: 0, puntos: [167, 682, 180, 714, 229, 661, 290, 539, 278, 494, 204, 559]),
        PoligonoDelCuerpo(tx: 0, puntos: [714, 494, 702, 547, 763, 661, 816, 718, 829, 690, 788, 555]),
    ]),
    ZonaDelCuerpo(grupo: "triceps", poligonos: [
        PoligonoDelCuerpo(tx: 0, puntos: [694, 555, 694, 616, 759, 727, 776, 702, 755, 673]),
        PoligonoDelCuerpo(tx: 0, puntos: [224, 694, 298, 555, 298, 608, 229, 731]),
    ]),
    ZonaDelCuerpo(grupo: "trapecio", poligonos: [
        PoligonoDelCuerpo(tx: 0, puntos: [555, 237, 506, 335, 506, 392, 616, 400, 706, 449, 694, 367, 633, 351, 584, 306]),
        PoligonoDelCuerpo(tx: 0, puntos: [290, 449, 302, 371, 363, 351, 412, 302, 445, 245, 490, 339, 486, 392, 380, 396]),
    ]),
    ZonaDelCuerpo(grupo: "hombros", poligonos: [
        PoligonoDelCuerpo(tx: 0, puntos: [784, 531, 796, 478, 792, 412, 759, 380, 710, 363, 722, 429, 714, 473]),
        PoligonoDelCuerpo(tx: 0, puntos: [282, 473, 212, 531, 200, 478, 204, 408, 245, 371, 286, 371, 269, 433]),
    ]),
    ZonaDelCuerpo(grupo: "aductores", poligonos: [
        PoligonoDelCuerpo(tx: 0, puntos: [527, 1102, 543, 1249, 600, 1102, 620, 1000, 649, 943, 600, 927, 567, 1045]),
        PoligonoDelCuerpo(tx: 0, puntos: [478, 1106, 449, 1253, 420, 1159, 404, 1131, 396, 1073, 380, 1024, 347, 939, 396, 922, 416, 992, 437, 1053]),
    ]),
    ZonaDelCuerpo(grupo: "cuadriceps", poligonos: [
        PoligonoDelCuerpo(tx: 0, puntos: [347, 988, 371, 1082, 371, 1278, 343, 1371, 310, 1327, 294, 1200, 282, 1114, 294, 1008, 322, 947]),
        PoligonoDelCuerpo(tx: 0, puntos: [633, 1057, 645, 1000, 669, 947, 702, 1012, 710, 1118, 682, 1331, 653, 1376, 624, 1286, 620, 1114]),
        PoligonoDelCuerpo(tx: 0, puntos: [388, 1294, 384, 1122, 412, 1184, 445, 1294, 429, 1351, 400, 1461, 363, 1465, 355, 1400]),
        PoligonoDelCuerpo(tx: 0, puntos: [596, 1457, 555, 1290, 608, 1139, 612, 1302, 641, 1396, 629, 1465]),
        PoligonoDelCuerpo(tx: 0, puntos: [327, 1384, 265, 1457, 257, 1367, 257, 1273, 269, 1143, 294, 1335]),
        PoligonoDelCuerpo(tx: 0, puntos: [718, 1131, 739, 1241, 739, 1404, 727, 1457, 665, 1384, 702, 1335]),
    ]),
    ZonaDelCuerpo(grupo: "antebrazo", poligonos: [
        PoligonoDelCuerpo(tx: 0, puntos: [61, 886, 102, 751, 147, 702, 163, 743, 192, 735, 45, 976, 0, 1000]),
        PoligonoDelCuerpo(tx: 0, puntos: [845, 698, 833, 735, 800, 731, 951, 984, 1000, 1004, 935, 894, 898, 763]),
        PoligonoDelCuerpo(tx: 0, puntos: [776, 722, 776, 776, 804, 841, 853, 898, 922, 1012, 947, 996]),
        PoligonoDelCuerpo(tx: 0, puntos: [69, 1012, 135, 906, 188, 841, 216, 771, 212, 718, 49, 988]),
    ]),
    ZonaDelCuerpo(grupo: "trapecio", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [447, 217, 477, 217, 472, 383, 477, 647, 383, 532, 353, 409, 311, 366, 391, 332, 438, 272]),
        PoligonoDelCuerpo(tx: 1120, puntos: [523, 217, 557, 217, 566, 272, 609, 328, 689, 366, 647, 404, 617, 532, 523, 647, 532, 383]),
    ]),
    ZonaDelCuerpo(grupo: "hombro_posterior", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [294, 370, 230, 391, 174, 443, 183, 536, 243, 494, 272, 464]),
        PoligonoDelCuerpo(tx: 1120, puntos: [711, 370, 783, 396, 826, 447, 817, 536, 749, 489, 723, 451]),
    ]),
    ZonaDelCuerpo(grupo: "espalda_media", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [311, 387, 281, 489, 285, 553, 287, 560, 383, 560, 366, 540, 336, 413]),
        PoligonoDelCuerpo(tx: 1120, puntos: [689, 387, 719, 494, 715, 560, 621, 560, 634, 545, 664, 417]),
    ]),
    ZonaDelCuerpo(grupo: "dorsales", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [287, 560, 340, 753, 472, 711, 472, 664, 383, 560]),
        PoligonoDelCuerpo(tx: 1120, puntos: [715, 560, 660, 753, 528, 711, 528, 664, 621, 560]),
    ]),
    ZonaDelCuerpo(grupo: "triceps", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [268, 498, 179, 557, 145, 723, 166, 817, 217, 638, 268, 557]),
        PoligonoDelCuerpo(tx: 1120, puntos: [736, 502, 821, 557, 860, 732, 834, 821, 779, 630, 732, 557]),
        PoligonoDelCuerpo(tx: 1120, puntos: [268, 583, 268, 685, 230, 753, 191, 774, 226, 655]),
        PoligonoDelCuerpo(tx: 1120, puntos: [728, 583, 770, 647, 804, 774, 766, 753, 728, 689]),
    ]),
    ZonaDelCuerpo(grupo: "lumbar", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [477, 728, 345, 770, 353, 834, 494, 1021, 468, 830]),
        PoligonoDelCuerpo(tx: 1120, puntos: [523, 728, 655, 770, 647, 834, 506, 1021, 532, 838]),
    ]),
    ZonaDelCuerpo(grupo: "antebrazo", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [864, 757, 911, 834, 932, 940, 1000, 1064, 962, 1043, 881, 894, 843, 838]),
        PoligonoDelCuerpo(tx: 1120, puntos: [136, 757, 89, 838, 68, 936, 0, 1064, 38, 1043, 123, 885, 157, 830]),
        PoligonoDelCuerpo(tx: 1120, puntos: [813, 796, 774, 779, 791, 847, 911, 1038, 932, 1089, 945, 1047]),
        PoligonoDelCuerpo(tx: 1120, puntos: [187, 796, 221, 779, 209, 843, 94, 1030, 68, 1085, 51, 1047]),
    ]),
    ZonaDelCuerpo(grupo: "abductores", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [330, 1070, 288, 1130, 282, 1230, 316, 1290, 356, 1180]),
        PoligonoDelCuerpo(tx: 1120, puntos: [670, 1070, 712, 1130, 718, 1230, 684, 1290, 644, 1180]),
    ]),
    ZonaDelCuerpo(grupo: "gluteo", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [447, 996, 302, 1085, 298, 1187, 315, 1260, 472, 1213, 494, 1149]),
        PoligonoDelCuerpo(tx: 1120, puntos: [553, 991, 511, 1145, 523, 1209, 681, 1260, 698, 1191, 694, 1085]),
    ]),
    ZonaDelCuerpo(grupo: "aductores", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [481, 1230, 447, 1230, 413, 1255, 451, 1443, 485, 1357, 489, 1294]),
        PoligonoDelCuerpo(tx: 1120, puntos: [519, 1226, 557, 1234, 591, 1260, 549, 1443, 519, 1362, 511, 1294]),
    ]),
    ZonaDelCuerpo(grupo: "isquios", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [289, 1221, 311, 1294, 366, 1260, 353, 1353, 345, 1502, 294, 1583, 289, 1468, 277, 1413, 272, 1315]),
        PoligonoDelCuerpo(tx: 1120, puntos: [715, 1217, 694, 1289, 638, 1260, 655, 1366, 664, 1502, 711, 1583, 715, 1477, 728, 1421, 736, 1319]),
        PoligonoDelCuerpo(tx: 1120, puntos: [387, 1255, 443, 1460, 404, 1668, 362, 1528, 370, 1353]),
        PoligonoDelCuerpo(tx: 1120, puntos: [617, 1255, 634, 1362, 643, 1532, 600, 1668, 562, 1464]),
    ]),
    ZonaDelCuerpo(grupo: "gemelos", poligonos: [
        PoligonoDelCuerpo(tx: 1120, puntos: [294, 1604, 285, 1672, 247, 1796, 238, 1928, 255, 1970, 285, 1932, 298, 1800, 319, 1711, 319, 1668]),
        PoligonoDelCuerpo(tx: 1120, puntos: [374, 1651, 353, 1677, 332, 1719, 311, 1804, 302, 1919, 340, 2000, 387, 1906, 391, 1689]),
        PoligonoDelCuerpo(tx: 1120, puntos: [630, 1651, 613, 1685, 617, 1906, 664, 1996, 706, 1919, 689, 1796, 668, 1702]),
        PoligonoDelCuerpo(tx: 1120, puntos: [706, 1604, 723, 1685, 757, 1791, 766, 1928, 745, 1966, 723, 1936, 706, 1796, 681, 1681]),
        PoligonoDelCuerpo(tx: 1120, puntos: [285, 1957, 302, 1957, 336, 2017, 306, 2200, 285, 2136, 268, 1983]),
        PoligonoDelCuerpo(tx: 1120, puntos: [698, 1957, 719, 1957, 736, 1983, 719, 2132, 702, 2196, 672, 2021]),
    ]),
]
