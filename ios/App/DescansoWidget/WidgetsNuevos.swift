import WidgetKit
import SwiftUI

// Los widgets de la tanda del 11/9/2026, pedidos por Koku:
//
//  - Calendario del mes, grande ("para ver bien todos los días, con su
//    color de evento").
//  - Consistencia del Gimnasio: las cifras arriba y el mapa de 26
//    semanas debajo, en ese orden ("creo que queda mejor").
//  - El mapa solo, y las cifras solas, cada uno en su widget ("haz 2
//    widgets más, uno de sólo el heatmap y otro de sólo el texto").
//  - El cuerpo del apartado de Progreso.
//
// Todos leen el MISMO resumen del buzón compartido que los de antes (ver
// ResumenDeLaApp.swift) y usan su mismo proveedor, así que no hay
// mecanismo nuevo: solo vistas.

// ---------------------------------------------------------------------
// Piezas compartidas
// ---------------------------------------------------------------------

// El tono de una celda del mapa de consistencia. UN solo matiz de claro
// a oscuro, nunca colores distintos: un mapa de magnitud se lee por
// intensidad, y con dos matices el ojo busca un significado que no hay.
private func tonoDeCelda(_ caracter: Character, acento: Color) -> Color {
    switch caracter {
    case "1": return acento.opacity(0.55)
    case "2": return acento
    case "9": return .clear          // ese día todavía no ha llegado
    default: return acento.opacity(0.12)
    }
}

// El mapa de 26 semanas, dibujado en un Canvas y no con 182 vistas.
// WidgetKit tiene un presupuesto de vistas por widget, y 182 rectángulos
// sueltos es mucho pedir para algo que son cuadraditos de color.
struct MapaDeConsistencia: View {
    let mapa: [String]
    let acento: Color

    var body: some View {
        Canvas { contexto, tamano in
            let filas = mapa.count
            guard filas > 0 else { return }
            let columnas = mapa.map { $0.count }.max() ?? 0
            guard columnas > 0 else { return }
            // Un hueco proporcional al lado de la celda: con un hueco
            // fijo, en un widget pequeño las celdas se comen entre ellas.
            let ladoX = tamano.width / CGFloat(columnas)
            let ladoY = tamano.height / CGFloat(filas)
            let lado = min(ladoX, ladoY)
            let hueco = max(1, lado * 0.16)
            // Centrado: si sobra ancho o alto, el mapa no se pega a una
            // esquina.
            let sobraX = (tamano.width - lado * CGFloat(columnas)) / 2
            let sobraY = (tamano.height - lado * CGFloat(filas)) / 2
            for (indiceFila, fila) in mapa.enumerated() {
                for (indiceColumna, caracter) in fila.enumerated() {
                    let color = tonoDeCelda(caracter, acento: acento)
                    if caracter == "9" { continue }
                    let rect = CGRect(
                        x: sobraX + CGFloat(indiceColumna) * lado,
                        y: sobraY + CGFloat(indiceFila) * lado,
                        width: lado - hueco,
                        height: lado - hueco
                    )
                    contexto.fill(
                        Path(roundedRect: rect, cornerRadius: max(1, lado * 0.22)),
                        with: .color(color)
                    )
                }
            }
        }
    }
}

// Una cifra con su rótulo debajo. Las cuatro (o cinco) de Consistencia
// se pintan todas con esto para que no se descuadren entre ellas.
struct CifraDeWidget: View {
    let valor: String
    let rotulo: String

    var body: some View {
        VStack(spacing: 0) {
            Text(valor)
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(rotulo)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
    }
}

// ---------------------------------------------------------------------
// 1. Calendario del mes
// ---------------------------------------------------------------------
struct CalendarioWidget: Widget {
    static let kind = "CalendarioWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ProveedorDeLaApp()) { entry in
            VistaCalendario(entry: entry)
        }
        .configurationDisplayName("Calendario del mes")
        .description("El mes entero, con el color de los eventos de cada día.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct VistaCalendario: View {
    @Environment(\.widgetFamily) private var familia
    let entry: EntradaDeLaApp

    private var seccion: SeccionCalendario? { entry.resumen?.calendario }
    private var acento: Color { Color(hexDeLaApp: entry.resumen?.acento ?? "") }

    // Lunes primero, como el calendario de la app.
    private let cabeceras = ["L", "M", "X", "J", "V", "S", "D"]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                RotuloDeWidget(texto: (seccion?.nombreMes ?? "Calendario").uppercased(), color: acento)
                Spacer(minLength: 0)
                AvisoDeViejo(resumen: entry.resumen)
            }
            if let s = seccion {
                rejilla(s)
            } else {
                VacioDeWidget(sinBuzon: entry.sinBuzon, queFalta: "para ver tu mes")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .marcaDeAgua("calendar", acento)
        .fondoDeWidgetApp(entry.resumen.estiloDeWidget)
        .widgetURL(DestinoDeWidget.calendario.url)
    }

    private func rejilla(_ s: SeccionCalendario) -> some View {
        // Cuántas filas hacen falta de verdad: un mes ocupa 5 o 6
        // semanas según en qué día caiga el 1. Calcularlo (en vez de
        // pintar siempre 6) deja las casillas más altas cuando sobra una.
        let total = s.primerDiaSemana + s.diasDelMes
        let filas = max(1, Int(ceil(Double(total) / 7.0)))
        return VStack(spacing: 2) {
            HStack(spacing: 2) {
                ForEach(cabeceras, id: \.self) { d in
                    Text(d)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            ForEach(0..<filas, id: \.self) { fila in
                HStack(spacing: 2) {
                    ForEach(0..<7, id: \.self) { columna in
                        let n = fila * 7 + columna - s.primerDiaSemana + 1
                        if n >= 1 && n <= s.diasDelMes {
                            casilla(n, s: s)
                        } else {
                            Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                }
            }
        }
    }

    private func casilla(_ n: Int, s: SeccionCalendario) -> some View {
        let dia = s.delDia(n)
        let esHoy = n == s.diaDeHoy
        return VStack(spacing: 1) {
            Text("\(n)")
                .font(.system(size: familia == .systemLarge ? 12 : 10,
                              weight: esHoy ? .bold : .regular))
                .foregroundStyle(esHoy ? Color.white : Color.primary)
                .frame(width: 17, height: 17)
                .background(
                    Circle().fill(esHoy ? acento : Color.clear)
                )
            // Los puntos de color de los grupos. Solo en el grande: en el
            // mediano las casillas miden lo justo para el número, y unos
            // puntos ahí serían una mancha ilegible.
            if familia == .systemLarge {
                HStack(spacing: 1.5) {
                    ForEach(Array((dia?.colores ?? []).prefix(3).enumerated()), id: \.offset) { _, hex in
                        Circle()
                            .fill(Color(hexDeLaApp: hex))
                            .frame(width: 3.5, height: 3.5)
                    }
                }
                .frame(height: 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// ---------------------------------------------------------------------
// 2. Consistencia: las cifras arriba, el mapa debajo
// ---------------------------------------------------------------------
struct ConsistenciaWidget: Widget {
    static let kind = "ConsistenciaWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ProveedorDeLaApp()) { entry in
            VistaConsistencia(entry: entry)
        }
        .configurationDisplayName("Consistencia")
        .description("Tu racha y el mapa de las últimas 26 semanas.")
        .supportedFamilies([.systemLarge])
    }
}

struct VistaConsistencia: View {
    let entry: EntradaDeLaApp
    private var seccion: SeccionConsistencia? { entry.resumen?.consistencia }
    private var acento: Color { Color(hexDeLaApp: entry.resumen?.acento ?? "") }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                RotuloDeWidget(texto: "CONSISTENCIA", color: acento)
                Spacer(minLength: 0)
                AvisoDeViejo(resumen: entry.resumen)
            }
            if let s = seccion {
                // El texto ARRIBA y el mapa DEBAJO, tal como lo pidió
                // Koku al verlo descrito al revés.
                CuatroCifras(s: s)
                MapaDeConsistencia(mapa: s.mapa, acento: acento)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VacioDeWidget(sinBuzon: entry.sinBuzon, queFalta: "para ver tu consistencia")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .marcaDeAgua("flame.fill", acento)
        .fondoDeWidgetApp(entry.resumen.estiloDeWidget)
        .widgetURL(DestinoDeWidget.gimnasio.url)
    }
}

// Las CUATRO que caben cómodas en el grande. Fuera queda "días
// entrenados" en total, que es la que menos dice: solo sube, y nunca te
// cuenta cómo vas. En el widget de solo cifras sí está, porque allí sobra
// sitio.
struct CuatroCifras: View {
    let s: SeccionConsistencia

    var body: some View {
        HStack(spacing: 4) {
            CifraDeWidget(valor: "\(s.racha)", rotulo: "Racha (sem.)")
            CifraDeWidget(valor: "\(s.estaSemana)/\(max(1, s.objetivoSemanal))", rotulo: "Esta semana")
            CifraDeWidget(valor: "\(s.esteMes)", rotulo: "Este mes")
            CifraDeWidget(valor: s.trabajoDelMes.isEmpty ? "—" : s.trabajoDelMes, rotulo: "Trabajo del mes")
        }
    }
}

// ---------------------------------------------------------------------
// 3. Solo el mapa
// ---------------------------------------------------------------------
struct HeatmapWidget: Widget {
    static let kind = "HeatmapWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ProveedorDeLaApp()) { entry in
            VistaHeatmap(entry: entry)
        }
        .configurationDisplayName("Mapa de entrenos")
        .description("Las últimas 26 semanas, un cuadrito por día.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct VistaHeatmap: View {
    let entry: EntradaDeLaApp
    private var seccion: SeccionConsistencia? { entry.resumen?.consistencia }
    private var acento: Color { Color(hexDeLaApp: entry.resumen?.acento ?? "") }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                RotuloDeWidget(texto: "ENTRENOS", color: acento)
                Spacer(minLength: 0)
                if let s = seccion, s.racha > 0 {
                    Text("Racha \(s.racha)")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                AvisoDeViejo(resumen: entry.resumen)
            }
            if let s = seccion {
                MapaDeConsistencia(mapa: s.mapa, acento: acento)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VacioDeWidget(sinBuzon: entry.sinBuzon, queFalta: "para ver tus entrenos")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .marcaDeAgua("square.grid.3x3.fill", acento)
        .fondoDeWidgetApp(entry.resumen.estiloDeWidget)
        .widgetURL(DestinoDeWidget.gimnasio.url)
    }
}

// ---------------------------------------------------------------------
// 4. Solo las cifras
// ---------------------------------------------------------------------
struct EstadisticasWidget: Widget {
    static let kind = "EstadisticasWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ProveedorDeLaApp()) { entry in
            VistaEstadisticas(entry: entry)
        }
        .configurationDisplayName("Números del gimnasio")
        .description("Días entrenados, racha, esta semana, este mes y tiempo de trabajo.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct VistaEstadisticas: View {
    let entry: EntradaDeLaApp
    private var seccion: SeccionConsistencia? { entry.resumen?.consistencia }
    private var acento: Color { Color(hexDeLaApp: entry.resumen?.acento ?? "") }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                RotuloDeWidget(texto: "GIMNASIO", color: acento)
                Spacer(minLength: 0)
                AvisoDeViejo(resumen: entry.resumen)
            }
            if let s = seccion {
                // Aquí sí caben las CINCO: es el widget que Koku pidió
                // "de sólo el texto", justo para que se lean bien.
                VStack(spacing: 8) {
                    HStack(spacing: 4) {
                        CifraDeWidget(valor: "\(s.diasEntrenados)", rotulo: "Días entrenados")
                        CifraDeWidget(valor: "\(s.racha)", rotulo: "Racha (sem.)")
                        CifraDeWidget(valor: "\(s.estaSemana)/\(max(1, s.objetivoSemanal))", rotulo: "Esta semana")
                    }
                    HStack(spacing: 4) {
                        CifraDeWidget(valor: "\(s.esteMes)", rotulo: "Este mes")
                        CifraDeWidget(valor: s.trabajoDelMes.isEmpty ? "—" : s.trabajoDelMes, rotulo: "Trabajo este mes")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VacioDeWidget(sinBuzon: entry.sinBuzon, queFalta: "para ver tus números")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .marcaDeAgua("chart.bar.fill", acento)
        .fondoDeWidgetApp(entry.resumen.estiloDeWidget)
        .widgetURL(DestinoDeWidget.gimnasio.url)
    }
}

// ---------------------------------------------------------------------
// 5. El cuerpo
// ---------------------------------------------------------------------
struct MusculosWidget: Widget {
    static let kind = "MusculosWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ProveedorDeLaApp()) { entry in
            VistaMusculos(entry: entry)
        }
        .configurationDisplayName("Mapa de músculos")
        .description("Qué has trabajado últimamente, sobre las dos siluetas.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct VistaMusculos: View {
    let entry: EntradaDeLaApp
    private var seccion: SeccionMusculos? { entry.resumen?.musculos }
    private var acento: Color { Color(hexDeLaApp: entry.resumen?.acento ?? "") }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                RotuloDeWidget(texto: "MÚSCULOS", color: acento)
                Spacer(minLength: 0)
                if let s = seccion {
                    Text("\(s.ventanaDias) días")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                AvisoDeViejo(resumen: entry.resumen)
            }
            if let s = seccion {
                DibujoDelCuerpo(zonas: s.zonas, acento: acento)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VacioDeWidget(sinBuzon: entry.sinBuzon, queFalta: "para ver tus músculos")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .marcaDeAgua("figure.strengthtraining.traditional", acento)
        .fondoDeWidgetApp(entry.resumen.estiloDeWidget)
        .widgetURL(DestinoDeWidget.gimnasio.url)
    }
}

// Las dos siluetas con sus zonas teñidas. En un Canvas, igual que el
// mapa de consistencia: son 70 polígonos y algunos con veinte puntos.
//
// La geometría sale de CuerpoDelWidget.swift, que se GENERA de app.js
// (ver tools/generar-cuerpo-swift.py). Aquí solo llega la intensidad de
// cada músculo, de 0 a 1.
struct DibujoDelCuerpo: View {
    let zonas: [String: Double]
    let acento: Color

    var body: some View {
        Canvas { contexto, tamano in
            // Escala que respeta la proporción del lienzo original y
            // centra lo que sobre. Sin esto, en un widget mediano (mucho
            // más ancho que alto) el cuerpo saldría aplastado.
            let escala = min(tamano.width / anchoDelCuerpo, tamano.height / altoDelCuerpo)
            let desplazaX = (tamano.width - anchoDelCuerpo * escala) / 2
            let desplazaY = (tamano.height - altoDelCuerpo * escala) / 2

            func camino(_ poligono: PoligonoDelCuerpo) -> Path {
                var p = Path()
                let n = poligono.puntos.count / 2
                guard n >= 2 else { return p }
                for i in 0..<n {
                    let x = desplazaX + (poligono.puntos[i * 2] + poligono.tx) * escala
                    let y = desplazaY + poligono.puntos[i * 2 + 1] * escala
                    if i == 0 { p.move(to: CGPoint(x: x, y: y)) } else { p.addLine(to: CGPoint(x: x, y: y)) }
                }
                p.closeSubpath()
                return p
            }

            // Primero la silueta, apagada, y encima las zonas: así un
            // músculo sin datos no deja un agujero, se ve el cuerpo.
            for poligono in siluetaDelCuerpo {
                contexto.fill(camino(poligono), with: .color(acento.opacity(0.18)))
            }
            for zona in zonasDelCuerpo {
                let valor = zonas[zona.grupo] ?? 0
                // Misma escala que el mapa de la app: del 12% al 90% del
                // acento. Un músculo sin nada se queda en el gris de la
                // silueta en vez de teñirse de acento muy claro, que se
                // confundiría con "poco entrenado".
                let opacidad = valor > 0 ? 0.12 + 0.78 * min(1, valor) : 0.10
                for poligono in zona.poligonos {
                    contexto.fill(camino(poligono), with: .color(acento.opacity(opacidad)))
                }
            }
        }
    }
}
