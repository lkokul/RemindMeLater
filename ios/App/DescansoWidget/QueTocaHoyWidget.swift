import WidgetKit
import SwiftUI
import AppIntents

// Widget "Qué toca hoy": el día del ciclo del bloque activo del Gimnasio,
// en la pantalla de inicio, en la de bloqueo y como botón del centro de
// control.
//
// LO PRIMERO QUE HAY QUE ENTENDER: un widget NO puede leer la base de
// datos de la app. La base es SQLite compilado a WebAssembly y vive
// dentro de la webview, en IndexedDB; esto es un proceso nativo aparte
// que iOS ejecuta cuando la app ni siquiera está abierta. La única forma
// de pasarle datos es un buzón compartido (App Group): la app deja ahí un
// resumen pequeño en JSON y esto lo lee. Ver WidgetBridgePlugin.swift en
// el target de la app, y public/widget-bridge.js del lado JavaScript.
//
// NO SE REFRESCA POR HORAS (decisión de Koku): quien lo repinta es la app
// cuando cambia algo (terminas un entreno, tocas el ciclo, cierras la
// app). Solo hay una relectura al día como red de seguridad, por si la
// app nunca consigue avisar — ver getTimeline.

private let grupoDeLaApp = "group.com.koku.remindmelater"
private let claveResumen = "resumenGimnasio"

// Tocar el widget abre la app aquí. SceneDelegate recoge la URL y deja la
// marca; el JavaScript la consume al despertar y arranca el entreno.
// Lo usan LOS DOS caminos: el toque en el widget (.widgetURL) y el botón
// del centro de control (OpenURLIntent), para que haya una sola entrada.
private let abrirEntrenoDeHoyURL = URL(string: "remindmelater://gym-hoy")

// La clave "gymPendingStartToday" ya NO se escribe desde aquí: el botón
// del centro de control pasó a abrir la URL de arriba, así que la marca la
// deja siempre SceneDelegate. El plugin de la app la sigue leyendo — si
// algún día se toca, mirar WidgetBridgePlugin.swift antes.

// ---------------------------------------------------------------------
// El resumen que escribe la app
// ---------------------------------------------------------------------
struct ResumenDelDia {
    var hayCiclo: Bool
    var esDescanso: Bool
    var nombre: String
    var bloque: String
    var color: String
    var icono: String
    var posicion: Int
    var total: Int
    var ejercicios: Int

    static let ejemplo = ResumenDelDia(
        hayCiclo: true, esDescanso: false, nombre: "Empuje", bloque: "Volumen",
        color: "#5b8cff", icono: "", posicion: 1, total: 3, ejercicios: 6
    )
}

// El decodificador se escribe A MANO con decodeIfPresent, no se deja
// sintetizar. Motivo: el decodificador automático de Swift NO usa los
// valores por defecto cuando falta una clave, falla. Y aquí quien
// escribe el JSON es una versión de la app que puede ser MÁS VIEJA que
// este widget (se actualizan juntos, pero el resumen guardado sobrevive
// a la actualización). Con esto, un resumen antiguo sin campos nuevos se
// lee igual en vez de dejar el widget en blanco.
extension ResumenDelDia: Decodable {
    enum CodingKeys: String, CodingKey {
        case hayCiclo, esDescanso, nombre, bloque, color, icono, posicion, total, ejercicios
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // decode + try? en vez de decodeIfPresent: así una clave que falte
        // Y una que venga con el tipo cambiado caen las dos en el valor por
        // defecto, en vez de reventar el resumen entero por un campo.
        func texto(_ k: CodingKeys, _ porDefecto: String) -> String {
            (try? c.decode(String.self, forKey: k)) ?? porDefecto
        }
        func numero(_ k: CodingKeys, _ porDefecto: Int) -> Int {
            (try? c.decode(Int.self, forKey: k)) ?? porDefecto
        }
        func siNo(_ k: CodingKeys, _ porDefecto: Bool) -> Bool {
            (try? c.decode(Bool.self, forKey: k)) ?? porDefecto
        }
        hayCiclo = siNo(.hayCiclo, false)
        esDescanso = siNo(.esDescanso, false)
        nombre = texto(.nombre, "")
        bloque = texto(.bloque, "")
        color = texto(.color, "#5b8cff")
        icono = texto(.icono, "")
        posicion = numero(.posicion, 0)
        total = numero(.total, 0)
        ejercicios = numero(.ejercicios, 0)
    }

    // nil si todavía no hay nada guardado (app recién instalada, o el App
    // Group no está disponible). Las vistas lo tratan con su propio texto,
    // no se quedan en blanco.
    static func leer() -> ResumenDelDia? {
        guard let defaults = UserDefaults(suiteName: grupoDeLaApp),
              let texto = defaults.string(forKey: claveResumen),
              let datos = texto.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ResumenDelDia.self, from: datos)
    }

}

// "#rrggbb" -> Color, igual que en la Live Activity: el color viaja en el
// resumen para que el widget siga el tema de la app.
private extension Color {
    init(hex: String) {
        var limpio = hex
        if limpio.hasPrefix("#") { limpio.removeFirst() }
        var valor: UInt64 = 0
        Scanner(string: limpio).scanHexInt64(&valor)
        self.init(
            red: Double((valor >> 16) & 0xFF) / 255,
            green: Double((valor >> 8) & 0xFF) / 255,
            blue: Double(valor & 0xFF) / 255
        )
    }
}

// containerBackground es OBLIGATORIO desde iOS 17 (sin él, el widget sale
// con el fondo en blanco o directamente no se dibuja), pero no existe
// antes. Este envoltorio evita repetir el #available en cada vista.
private extension View {
    @ViewBuilder
    func fondoDeWidget() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(.fill.tertiary, for: .widget)
        } else {
            self.padding()
        }
    }
}

// ---------------------------------------------------------------------
// La línea temporal
// ---------------------------------------------------------------------
struct QueTocaEntry: TimelineEntry {
    let date: Date
    let resumen: ResumenDelDia?
}

struct QueTocaProvider: TimelineProvider {
    func placeholder(in context: Context) -> QueTocaEntry {
        QueTocaEntry(date: Date(), resumen: .ejemplo)
    }

    func getSnapshot(in context: Context, completion: @escaping (QueTocaEntry) -> Void) {
        // En la galería de widgets (isPreview) se enseña el ejemplo aunque
        // no haya nada guardado: un hueco vacío ahí no dice qué hace.
        // El tipo va explícito porque en un ternario con nil Swift no
        // tiene de dónde deducirlo.
        let deRespaldo: ResumenDelDia? = context.isPreview ? ResumenDelDia.ejemplo : nil
        completion(QueTocaEntry(date: Date(), resumen: ResumenDelDia.leer() ?? deRespaldo))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QueTocaEntry>) -> Void) {
        // Quien lo repinta de verdad es la app al cambiar algo
        // (WidgetCenter.reloadTimelines desde WidgetBridgePlugin), tal como
        // pidió Koku: sin refresco por horas.
        //
        // Pero .never a secas tiene un filo: si por lo que sea la app NUNCA
        // consigue avisar, el widget se queda congelado para siempre y no
        // hay forma de que se recupere solo. Una relectura al día es
        // prácticamente gratis y sirve de red de seguridad.
        let mañana = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date().addingTimeInterval(86400)
        let medianoche = Calendar.current.startOfDay(for: mañana)
        completion(Timeline(
            entries: [QueTocaEntry(date: Date(), resumen: ResumenDelDia.leer())],
            policy: .after(medianoche)
        ))
    }
}

// ---------------------------------------------------------------------
// Las vistas, una por familia
// ---------------------------------------------------------------------
struct QueTocaHoyView: View {
    @Environment(\.widgetFamily) private var familia
    let entry: QueTocaEntry

    var body: some View {
        switch familia {
        case .accessoryInline:    inline
        case .accessoryCircular:  circular
        case .accessoryRectangular: rectangular
        case .systemMedium:       mediano
        default:                  pequeno
        }
    }

    // --- Lo que se enseña, en un sitio para no repetirlo ---
    private var resumen: ResumenDelDia? { entry.resumen }
    private var acento: Color { Color(hex: resumen?.color ?? "#5b8cff") }
    private var titulo: String {
        guard let r = resumen else { return "Abre la app" }
        if !r.hayCiclo { return "Sin ciclo" }
        return r.esDescanso ? "Descanso" : r.nombre
    }
    private var subtitulo: String {
        guard let r = resumen else { return "para preparar el widget" }
        if !r.hayCiclo { return "Elige tu día al entrenar" }
        if r.total > 0 { return "Día \(r.posicion) de \(r.total)" }
        return ""
    }

    // --- Pantalla de inicio, pequeño ---
    private var pequeno: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("HOY")
                .font(.caption2).fontWeight(.heavy)
                .foregroundStyle(acento)
            Spacer(minLength: 0)
            Text(titulo)
                .font(.title3).fontWeight(.bold)
                .minimumScaleFactor(0.6)
                .lineLimit(2)
            if !subtitulo.isEmpty {
                Text(subtitulo)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if let r = resumen, r.hayCiclo, !r.esDescanso, r.ejercicios > 0 {
                Text("\(r.ejercicios) ejercicio\(r.ejercicios == 1 ? "" : "s")")
                    .font(.caption2)
                    .foregroundStyle(acento)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .fondoDeWidget()
        .widgetURL(abrirEntrenoDeHoyURL)
    }

    // --- Pantalla de inicio, mediano ---
    private var mediano: some View {
        HStack(spacing: 14) {
            // La barra de color a la izquierda es el color del día, igual
            // que en la lista de días de la app.
            RoundedRectangle(cornerRadius: 3)
                .fill(acento)
                .frame(width: 5)
            VStack(alignment: .leading, spacing: 5) {
                Text(resumen?.bloque.isEmpty == false ? resumen!.bloque : "Gimnasio")
                    .font(.caption2).fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(titulo)
                    .font(.title2).fontWeight(.bold)
                    .minimumScaleFactor(0.6)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if !subtitulo.isEmpty {
                        Text(subtitulo).font(.caption).foregroundStyle(.secondary)
                    }
                    if let r = resumen, r.hayCiclo, !r.esDescanso, r.ejercicios > 0 {
                        Text("·").font(.caption).foregroundStyle(.secondary)
                        Text("\(r.ejercicios) ejercicios").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Spacer(minLength: 0)
            if let r = resumen, r.hayCiclo, !r.esDescanso {
                Text("Empezar")
                    .font(.caption).fontWeight(.semibold)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(acento, in: Capsule())
                    .foregroundStyle(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .fondoDeWidget()
        .widgetURL(abrirEntrenoDeHoyURL)
    }

    // --- Bloqueo: una línea junto a la hora ---
    private var inline: some View {
        // En inline solo cabe texto plano y iOS lo tiñe él: nada de
        // colores ni fuentes propias aquí.
        Text(subtitulo.isEmpty ? titulo : "\(titulo) · \(subtitulo)")
            .widgetURL(abrirEntrenoDeHoyURL)
    }

    // --- Bloqueo: el círculo ---
    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Image(systemName: (resumen?.esDescanso ?? false) ? "moon.zzz.fill" : "dumbbell.fill")
                    .font(.system(size: 15, weight: .semibold))
                if let r = resumen, r.hayCiclo, r.total > 0 {
                    Text("\(r.posicion)/\(r.total)")
                        .font(.system(size: 10, weight: .medium))
                }
            }
        }
        .widgetURL(abrirEntrenoDeHoyURL)
    }

    // --- Bloqueo: el rectángulo ---
    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Hoy")
                .font(.caption2).fontWeight(.semibold)
                .widgetAccentable()
            Text(titulo)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if !subtitulo.isEmpty {
                Text(subtitulo).font(.caption2).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(abrirEntrenoDeHoyURL)
    }
}

struct QueTocaHoyWidget: Widget {
    // El "kind" tiene que ser EXACTAMENTE el mismo que usa
    // WidgetCenter.reloadTimelines(ofKind:) en WidgetBridgePlugin.swift:
    // si no coinciden, la app cree que lo refresca y el widget se queda
    // con lo de antes hasta que iOS decida repintarlo por su cuenta.
    static let kind = "QueTocaHoyWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: QueTocaProvider()) { entry in
            QueTocaHoyView(entry: entry)
        }
        .configurationDisplayName("Qué toca hoy")
        .description("El entrenamiento que te toca hoy según tu ciclo. Tócalo para empezarlo.")
        // Las accessory* son las de la pantalla de bloqueo. No llevan
        // #available porque este target ya exige iOS 16.2 (lo pide la Live
        // Activity del descanso), y ahí existen todas.
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

// ---------------------------------------------------------------------
// El botón del centro de control (iOS 18)
// ---------------------------------------------------------------------
// #if compiler(>=6.0) y no solo @available: ControlWidget no EXISTE en el
// SDK de iOS 17 y anteriores, así que con un Xcode viejo esto no es que
// no se ejecute -- es que no compila. Xcode 16 (el primero con el SDK de
// iOS 18) trae Swift 6, así que esa condición es la forma de preguntar
// "¿tengo el SDK nuevo?" desde el propio código.
#if compiler(>=6.0)

@available(iOS 18.0, *)
struct EmpezarEntrenoControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.koku.remindmelater.EmpezarEntreno") {
            // OpenURLIntent, el intent del SISTEMA, en vez de uno propio.
            //
            // Antes había aquí un AppIntent nuestro con openAppWhenRun que
            // dejaba una marca en el App Group. Koku lo probó y NO ABRÍA NI
            // HACÍA NADA, y además tenía un defecto de diseño: dependía de
            // que el App Group funcionara, que es justo lo que puede
            // fallar. Con esto el botón abre la MISMA URL que el toque en
            // el widget, así que hay un único camino de entrada
            // (SceneDelegate -> UserDefaults.standard -> el JavaScript) y
            // el botón funciona aunque el buzón compartido no exista.
            ControlWidgetButton(action: OpenURLIntent(abrirEntrenoDeHoyURL!)) {
                Label("Entrenar", systemImage: "dumbbell.fill")
            }
        }
        .displayName("Entrenar hoy")
        .description("Abre RemindMeLater en el entrenamiento que te toca hoy.")
    }
}

#endif
