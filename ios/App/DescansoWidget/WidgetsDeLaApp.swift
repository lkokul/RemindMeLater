import WidgetKit
import SwiftUI
import AppIntents

// Los cuatro widgets nuevos: Hoy (calendario), Tareas, Finanzas,
// Lecturas y Viajes. El del Gimnasio ("Qué toca hoy") vive aparte, en
// QueTocaHoyWidget.swift, porque tiene su propia lógica de ciclo.
//
// Todos leen el MISMO resumen (ver ResumenDeLaApp.swift) y comparten
// proveedor de línea temporal: lo único que cambia entre ellos es la
// vista y a dónde llevan al tocarlos.
//
// NO SE REFRESCAN POR HORAS (decisión de Koku para el primer widget, y
// aquí se mantiene): quien los repinta es la app cuando cambia algo. La
// única excepción es una relectura a medianoche, por dos motivos: si la
// app nunca consigue avisar, el widget se quedaría congelado para
// siempre; y "hoy" deja de ser hoy a las 00:00 aunque nadie toque nada.

// A dónde lleva cada widget. Son los mismos esquemas que ya usaba
// `remindmelater://gym-live` y `gym-hoy`: SceneDelegate recoge la URL y
// deja una marca, y el JavaScript la consume al despertar.
enum DestinoDeWidget: String {
    case hoy, tareas, finanzas, lecturas, viajes
    case nuevoEvento = "nuevo-evento"
    case nuevaNota = "nueva-nota"

    var url: URL? { URL(string: "remindmelater://\(rawValue)") }
}

// ---------------------------------------------------------------------
// El proveedor, uno para todos
// ---------------------------------------------------------------------
struct EntradaDeLaApp: TimelineEntry {
    let date: Date
    let resumen: ResumenDeLaApp?
    // true = ni siquiera hay App Group, o sea que no es que falten datos:
    // es que la app y el widget no comparten buzón. Distinguirlo hace que
    // la propia pantalla del widget diga cuál de los dos problemas es,
    // sin necesitar ni cable ni Xcode.
    var sinBuzon: Bool = false
}

struct ProveedorDeLaApp: TimelineProvider {
    func placeholder(in context: Context) -> EntradaDeLaApp {
        EntradaDeLaApp(date: Date(), resumen: ResumenDeLaApp.deEjemplo)
    }

    func getSnapshot(in context: Context, completion: @escaping (EntradaDeLaApp) -> Void) {
        // En la galería de widgets (isPreview) se enseña el ejemplo aunque
        // no haya nada guardado: un hueco vacío ahí no dice qué hace.
        let deRespaldo: ResumenDeLaApp? = context.isPreview ? ResumenDeLaApp.deEjemplo : nil
        completion(EntradaDeLaApp(
            date: Date(),
            resumen: ResumenDeLaApp.leer() ?? deRespaldo,
            sinBuzon: !ResumenDeLaApp.hayBuzon()
        ))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EntradaDeLaApp>) -> Void) {
        let manana = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date().addingTimeInterval(86400)
        let medianoche = Calendar.current.startOfDay(for: manana)
        completion(Timeline(
            entries: [EntradaDeLaApp(
                date: Date(),
                resumen: ResumenDeLaApp.leer(),
                sinBuzon: !ResumenDeLaApp.hayBuzon()
            )],
            policy: .after(medianoche)
        ))
    }
}

extension ResumenDeLaApp {
    // Lo que se ve en la galería al elegir el widget. Con datos creíbles,
    // no con "Lorem ipsum": así se entiende de un vistazo qué enseña cada
    // uno antes de ponerlo.
    static var deEjemplo: ResumenDeLaApp {
        var r = ResumenDeLaApp()
        r.actualizado = Date().timeIntervalSince1970 * 1000
        r.hoy = SeccionHoy(
            eventos: [
                FilaDeEvento(titulo: "Dentista", hora: "10:30", color: "#5b8cff", todoElDia: false),
                FilaDeEvento(titulo: "Comida con Ana", hora: "14:00", color: "#f0883e", todoElDia: false),
                FilaDeEvento(titulo: "Gimnasio", hora: "19:00", color: "#a371f7", todoElDia: false),
            ],
            total: 4, tareas: 3
        )
        r.tareas = SeccionTareas(
            lista: [
                FilaDeTarea(titulo: "Llamar al banco", cuando: "", color: "#f85149", vencida: true, hoy: false),
                FilaDeTarea(titulo: "Comprar pan", cuando: "", color: "#5b8cff", vencida: false, hoy: true),
                FilaDeTarea(titulo: "Renovar el DNI", cuando: "", color: "#3fb950", vencida: false, hoy: false),
                FilaDeTarea(titulo: "Devolver el libro", cuando: "", color: "#f0883e", vencida: false, hoy: false),
            ],
            total: 7, vencidas: 1
        )
        r.finanzas = SeccionFinanzas(gastado: 420, limite: 700, ahorro: 180, objetivo: 200, diasRestantes: 12)
        r.lecturas = SeccionLecturas(
            lista: [
                FilaDeLectura(titulo: "Berserk", tipo: "manga", progreso: "34/42 tomos"),
                FilaDeLectura(titulo: "Dune", tipo: "libro", progreso: "210/620 págs"),
            ],
            total: 2
        )
        r.viajes = SeccionViajes(nombre: "Japón", dias: 24, enCurso: false, color: "#a371f7",
                                 duracion: 14, restantes: 0)
        return r
    }
}

// ---------------------------------------------------------------------
// Piezas de vista que se repiten
// ---------------------------------------------------------------------

// La cabecera de los widgets de la pantalla de inicio: un rótulo corto en
// el color de acento. Da a todos el mismo aire sin repetir el modificador
// cuatro veces.
struct RotuloDeWidget: View {
    let texto: String
    let color: Color
    var body: some View {
        Text(texto)
            .font(.caption2).fontWeight(.heavy)
            .foregroundStyle(color)
            .lineLimit(1)
    }
}

// Lo que se enseña cuando no hay nada que enseñar. Distingue los dos
// casos que antes se veían igual, que es justo lo que costó una tanda de
// builds averiguar.
struct VacioDeWidget: View {
    let sinBuzon: Bool
    let queFalta: String
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(sinBuzon ? "Sin buzón" : "Abre la app")
                .font(.headline)
            Text(sinBuzon ? "falta el App Group" : queFalta)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// El aviso de "esto es de otro día". El resumen solo se reescribe cuando
// la app se abre, así que tras un par de días sin abrirla los datos son
// viejos -- y decirlo es más honesto que enseñarlos como si fueran de hoy.
struct AvisoDeViejo: View {
    let resumen: ResumenDeLaApp?
    var body: some View {
        if let r = resumen, !r.esDeHoy {
            Text("sin actualizar")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
        }
    }
}

// ---------------------------------------------------------------------
// 1. Calendario · Hoy
// ---------------------------------------------------------------------
struct HoyWidget: Widget {
    static let kind = "HoyWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ProveedorDeLaApp()) { entry in
            VistaHoy(entry: entry)
        }
        .configurationDisplayName("Hoy")
        .description("Los eventos y tareas que tienes hoy.")
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

struct VistaHoy: View {
    @Environment(\.widgetFamily) private var familia
    let entry: EntradaDeLaApp

    private var seccion: SeccionHoy? { entry.resumen?.hoy }
    private var acento: Color { Color(hexDeLaApp: entry.resumen?.acento ?? "") }
    private var eventos: [FilaDeEvento] { seccion?.eventos ?? [] }
    private var tareas: Int { seccion?.tareas ?? 0 }

    // El resumen en una línea, que es lo que cabe en la pantalla de
    // bloqueo: "2 eventos · 3 tareas".
    private var enUnaLinea: String {
        guard let s = seccion else { return entry.sinBuzon ? "Sin buzón" : "Abre la app" }
        var trozos: [String] = []
        if s.total > 0 { trozos.append("\(s.total) evento\(s.total == 1 ? "" : "s")") }
        if s.tareas > 0 { trozos.append("\(s.tareas) tarea\(s.tareas == 1 ? "" : "s")") }
        return trozos.isEmpty ? "Día libre" : trozos.joined(separator: " · ")
    }

    var body: some View {
        switch familia {
        case .accessoryInline:
            Text(enUnaLinea).widgetURL(DestinoDeWidget.hoy.url)
        case .accessoryCircular:
            circular
        case .accessoryRectangular:
            rectangular
        case .systemMedium:
            deInicio(maxFilas: 4)
        default:
            deInicio(maxFilas: 2)
        }
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: -2) {
                Image(systemName: "calendar")
                    .font(.system(size: 13, weight: .semibold))
                Text("\((seccion?.total ?? 0) + tareas)")
                    .font(.system(size: 15, weight: .bold))
            }
        }
        .widgetURL(DestinoDeWidget.hoy.url)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Hoy").font(.caption2).fontWeight(.semibold).widgetAccentable()
            if let primero = eventos.first {
                Text(primero.hora.isEmpty ? primero.titulo : "\(primero.hora) \(primero.titulo)")
                    .font(.headline).lineLimit(1).minimumScaleFactor(0.7)
            } else {
                Text(enUnaLinea).font(.headline).lineLimit(1).minimumScaleFactor(0.7)
            }
            if eventos.count > 1 || tareas > 0 {
                Text(enUnaLinea).font(.caption2).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(DestinoDeWidget.hoy.url)
    }

    private func deInicio(maxFilas: Int) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                RotuloDeWidget(texto: "HOY", color: acento)
                Spacer(minLength: 0)
                AvisoDeViejo(resumen: entry.resumen)
            }
            if seccion == nil {
                VacioDeWidget(sinBuzon: entry.sinBuzon, queFalta: "para ver tu día")
            } else if eventos.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text(tareas > 0 ? "Sin eventos" : "Día libre")
                        .font(.headline)
                    if tareas > 0 {
                        Text("\(tareas) tarea\(tareas == 1 ? "" : "s") pendiente\(tareas == 1 ? "" : "s")")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(eventos.prefix(maxFilas).enumerated()), id: \.offset) { _, ev in
                        FilaEventoView(evento: ev)
                    }
                }
                Spacer(minLength: 0)
                if eventos.count > maxFilas || tareas > 0 {
                    Text(pieDelDia(maxFilas: maxFilas))
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .marcaDeAgua("calendar", acento)
        .fondoDeWidgetApp(entry.resumen.estiloDeWidget)
        .widgetURL(DestinoDeWidget.hoy.url)
    }

    private func pieDelDia(maxFilas: Int) -> String {
        var trozos: [String] = []
        let extra = (seccion?.total ?? 0) - maxFilas
        if extra > 0 { trozos.append("+\(extra) más") }
        if tareas > 0 { trozos.append("\(tareas) tarea\(tareas == 1 ? "" : "s")") }
        return trozos.joined(separator: " · ")
    }
}

// Una fila de evento: la pastilla de color del grupo, la hora y el
// título. La pastilla es lo que deja reconocer el grupo de un vistazo,
// igual que en el calendario.
struct FilaEventoView: View {
    let evento: FilaDeEvento
    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hexDeLaApp: evento.color))
                .frame(width: 3, height: 14)
            if !evento.hora.isEmpty {
                Text(evento.hora)
                    .font(.caption2).fontWeight(.semibold)
                    .foregroundStyle(.secondary)
            }
            Text(evento.titulo)
                .font(.caption)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }
}

// ---------------------------------------------------------------------
// 2. Tareas pendientes
// ---------------------------------------------------------------------
struct TareasWidget: Widget {
    static let kind = "TareasWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ProveedorDeLaApp()) { entry in
            VistaTareas(entry: entry)
        }
        .configurationDisplayName("Tareas")
        .description("Lo que te queda por hacer.")
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

struct VistaTareas: View {
    @Environment(\.widgetFamily) private var familia
    let entry: EntradaDeLaApp

    private var seccion: SeccionTareas? { entry.resumen?.tareas }
    private var acento: Color { Color(hexDeLaApp: entry.resumen?.acento ?? "") }
    private var lista: [FilaDeTarea] { seccion?.lista ?? [] }

    private var enUnaLinea: String {
        guard let s = seccion else { return entry.sinBuzon ? "Sin buzón" : "Abre la app" }
        if s.total == 0 { return "Nada pendiente" }
        if s.vencidas > 0 { return "\(s.total) pendientes · \(s.vencidas) vencida\(s.vencidas == 1 ? "" : "s")" }
        return "\(s.total) pendiente\(s.total == 1 ? "" : "s")"
    }

    var body: some View {
        switch familia {
        case .accessoryInline:
            Text(enUnaLinea).widgetURL(DestinoDeWidget.tareas.url)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: -2) {
                    Image(systemName: "checklist").font(.system(size: 12, weight: .semibold))
                    Text("\(seccion?.total ?? 0)").font(.system(size: 15, weight: .bold))
                }
            }
            .widgetURL(DestinoDeWidget.tareas.url)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("Tareas").font(.caption2).fontWeight(.semibold).widgetAccentable()
                Text(lista.first?.titulo ?? enUnaLinea)
                    .font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                if !lista.isEmpty { Text(enUnaLinea).font(.caption2).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(DestinoDeWidget.tareas.url)
        case .systemMedium:
            deInicio(maxFilas: 4)
        default:
            deInicio(maxFilas: 3)
        }
    }

    private func deInicio(maxFilas: Int) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                RotuloDeWidget(texto: "TAREAS", color: acento)
                Spacer(minLength: 0)
                if let s = seccion, s.vencidas > 0 {
                    // El número de vencidas es lo único que se pinta en
                    // rojo en todo el widget: si algo tiene que saltar a
                    // la vista, es eso.
                    Text("\(s.vencidas)")
                        .font(.caption2).fontWeight(.bold)
                        .foregroundStyle(.red)
                }
            }
            if seccion == nil {
                VacioDeWidget(sinBuzon: entry.sinBuzon, queFalta: "para ver tus tareas")
            } else if lista.isEmpty {
                Text("Nada pendiente")
                    .font(.headline)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(lista.prefix(maxFilas).enumerated()), id: \.offset) { _, t in
                        HStack(spacing: 6) {
                            Image(systemName: "square")
                                .font(.system(size: 10))
                                .foregroundStyle(Color(hexDeLaApp: t.color))
                            Text(t.titulo)
                                .font(.caption)
                                .lineLimit(1)
                                .foregroundStyle(t.vencida ? Color.red : Color.primary)
                            Spacer(minLength: 0)
                        }
                    }
                }
                Spacer(minLength: 0)
                // El pie dice siempre algo: cuántas quedan sin enseñar y,
                // si las hay, cuántas están vencidas. Un widget que se
                // corta sin avisar hace pensar que eso es todo lo que
                // tienes pendiente.
                if !pieDeTareas(maxFilas: maxFilas).isEmpty {
                    Text(pieDeTareas(maxFilas: maxFilas))
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .marcaDeAgua("checklist", acento)
        .fondoDeWidgetApp(entry.resumen.estiloDeWidget)
        .widgetURL(DestinoDeWidget.tareas.url)
    }

    private func pieDeTareas(maxFilas: Int) -> String {
        guard let s = seccion else { return "" }
        var trozos: [String] = []
        let extra = s.total - maxFilas
        if extra > 0 { trozos.append("+\(extra) más") }
        if s.vencidas > 0 { trozos.append("\(s.vencidas) vencida\(s.vencidas == 1 ? "" : "s")") }
        return trozos.joined(separator: " · ")
    }
}

// ---------------------------------------------------------------------
// 3. Finanzas · este mes
// ---------------------------------------------------------------------
struct FinanzasWidget: Widget {
    static let kind = "FinanzasWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ProveedorDeLaApp()) { entry in
            VistaFinanzas(entry: entry)
        }
        .configurationDisplayName("Finanzas")
        .description("Lo gastado este mes frente a tu límite. Ojo: se ve en la pantalla de bloqueo.")
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

struct VistaFinanzas: View {
    @Environment(\.widgetFamily) private var familia
    let entry: EntradaDeLaApp

    private var seccion: SeccionFinanzas? { entry.resumen?.finanzas }
    private var acento: Color { Color(hexDeLaApp: entry.resumen?.acento ?? "") }
    // Verde mientras vas bien, rojo si te pasaste. Es el único sitio del
    // widget donde el color significa algo, así que no compite con nada.
    private var colorBarra: Color {
        guard let s = seccion else { return acento }
        return s.pasado ? .red : acento
    }

    private var enUnaLinea: String {
        guard let s = seccion else { return entry.sinBuzon ? "Sin buzón" : "Abre la app" }
        if !s.hayLimite { return "Gastado \(importeCorto(s.gastado))" }
        return s.pasado
            ? "Pasado \(importeCorto(s.gastado - s.limite))"
            : "Quedan \(importeCorto(s.restante))"
    }

    var body: some View {
        switch familia {
        case .accessoryInline:
            Text(enUnaLinea).widgetURL(DestinoDeWidget.finanzas.url)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                if let s = seccion, s.hayLimite {
                    // El anillo dice cuánto del mes llevas gastado sin
                    // necesidad de leer ninguna cifra.
                    Gauge(value: s.fraccion) {
                        Image(systemName: "eurosign")
                    }
                    .gaugeStyle(.accessoryCircularCapacity)
                } else {
                    Image(systemName: "eurosign.circle").font(.system(size: 18, weight: .semibold))
                }
            }
            .widgetURL(DestinoDeWidget.finanzas.url)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("Este mes").font(.caption2).fontWeight(.semibold).widgetAccentable()
                Text(seccion.map { importeCorto($0.gastado) } ?? enUnaLinea)
                    .font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                if seccion != nil { Text(enUnaLinea).font(.caption2).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(DestinoDeWidget.finanzas.url)
        case .systemMedium:
            deInicio(ancho: true)
        default:
            deInicio(ancho: false)
        }
    }

    private func deInicio(ancho: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                RotuloDeWidget(texto: "ESTE MES", color: acento)
                Spacer(minLength: 0)
                AvisoDeViejo(resumen: entry.resumen)
            }
            if let s = seccion {
                Text(importeCorto(s.gastado))
                    .font(ancho ? .title : .title2).fontWeight(.bold)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                if s.hayLimite {
                    // Barra a mano y no ProgressView: hace falta que el
                    // color cambie al pasarse, y así se controla el alto.
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.secondary.opacity(0.25))
                            Capsule().fill(colorBarra)
                                .frame(width: max(2, geo.size.width * s.fraccion))
                        }
                    }
                    .frame(height: 6)
                    Text(s.pasado
                         ? "\(importeCorto(s.gastado - s.limite)) por encima de \(importeCorto(s.limite))"
                         : "de \(importeCorto(s.limite)) · quedan \(importeCorto(s.restante))")
                        .font(.caption2).foregroundStyle(.secondary)
                        .lineLimit(2)
                } else {
                    Text("Sin límite mensual puesto")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if !pieDelMes(s).isEmpty {
                    Text(pieDelMes(s))
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            } else {
                VacioDeWidget(sinBuzon: entry.sinBuzon, queFalta: "para ver tus gastos")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .marcaDeAgua("eurosign.circle", acento)
        .fondoDeWidgetApp(entry.resumen.estiloDeWidget)
        .widgetURL(DestinoDeWidget.finanzas.url)
    }

    // El pie del mes. Lo interesante no es "quedan 12 días" ni "quedan
    // 300 €" por separado, sino el reparto: cuánto puedes gastar al día
    // sin pasarte. Sale de datos que YA viajan, no hace falta mandar nada
    // nuevo.
    private func pieDelMes(_ s: SeccionFinanzas) -> String {
        guard s.diasRestantes > 0 else { return "Último día del mes" }
        let dias = "\(s.diasRestantes) día\(s.diasRestantes == 1 ? "" : "s") de mes"
        guard s.hayLimite, !s.pasado, s.restante > 0 else { return dias }
        let porDia = s.restante / Double(s.diasRestantes)
        return "\(dias) · \(importeCorto(porDia))/día"
    }
}

// ---------------------------------------------------------------------
// 4. Lecturas · lo que tienes empezado
// ---------------------------------------------------------------------
struct LecturasWidget: Widget {
    static let kind = "LecturasWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ProveedorDeLaApp()) { entry in
            VistaLecturas(entry: entry)
        }
        .configurationDisplayName("Lecturas")
        .description("Lo que estás leyendo o viendo ahora.")
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

struct VistaLecturas: View {
    @Environment(\.widgetFamily) private var familia
    let entry: EntradaDeLaApp

    private var seccion: SeccionLecturas? { entry.resumen?.lecturas }
    private var acento: Color { Color(hexDeLaApp: entry.resumen?.acento ?? "") }
    private var lista: [FilaDeLectura] { seccion?.lista ?? [] }

    private var enUnaLinea: String {
        guard let s = seccion else { return entry.sinBuzon ? "Sin buzón" : "Abre la app" }
        guard let primera = s.lista.first else { return "Nada empezado" }
        return primera.progreso.isEmpty ? primera.titulo : "\(primera.titulo) · \(primera.progreso)"
    }

    var body: some View {
        switch familia {
        case .accessoryInline:
            Text(enUnaLinea).widgetURL(DestinoDeWidget.lecturas.url)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: -2) {
                    Image(systemName: "book").font(.system(size: 12, weight: .semibold))
                    Text("\(seccion?.total ?? 0)").font(.system(size: 15, weight: .bold))
                }
            }
            .widgetURL(DestinoDeWidget.lecturas.url)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("Leyendo").font(.caption2).fontWeight(.semibold).widgetAccentable()
                Text(lista.first?.titulo ?? enUnaLinea)
                    .font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                if let p = lista.first?.progreso, !p.isEmpty {
                    Text(p).font(.caption2).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(DestinoDeWidget.lecturas.url)
        case .systemMedium:
            deInicio(maxFilas: 4)
        default:
            deInicio(maxFilas: 2)
        }
    }

    private func deInicio(maxFilas: Int) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                RotuloDeWidget(texto: "LEYENDO", color: acento)
                Spacer(minLength: 0)
                AvisoDeViejo(resumen: entry.resumen)
            }
            if seccion == nil {
                VacioDeWidget(sinBuzon: entry.sinBuzon, queFalta: "para ver tus lecturas")
            } else if lista.isEmpty {
                Text("Nada empezado")
                    .font(.headline)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(Array(lista.prefix(maxFilas).enumerated()), id: \.offset) { _, it in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(it.titulo).font(.caption).fontWeight(.semibold).lineLimit(1)
                            if !it.progreso.isEmpty {
                                Text(it.progreso).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
                if let s = seccion {
                    Text(s.total > maxFilas
                         ? "+\(s.total - maxFilas) más empezado\(s.total - maxFilas == 1 ? "" : "s")"
                         : "\(s.total) empezado\(s.total == 1 ? "" : "s")")
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .marcaDeAgua("books.vertical.fill", acento)
        .fondoDeWidgetApp(entry.resumen.estiloDeWidget)
        .widgetURL(DestinoDeWidget.lecturas.url)
    }
}

// ---------------------------------------------------------------------
// 5. Viajes · el próximo (o el que está en marcha)
// ---------------------------------------------------------------------
struct ViajesWidget: Widget {
    static let kind = "ViajesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ProveedorDeLaApp()) { entry in
            VistaViajes(entry: entry)
        }
        .configurationDisplayName("Viajes")
        .description("El viaje que tienes en marcha, o cuánto falta para el siguiente.")
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

struct VistaViajes: View {
    @Environment(\.widgetFamily) private var familia
    let entry: EntradaDeLaApp

    private var seccion: SeccionViajes? { entry.resumen?.viajes }
    private var acento: Color {
        guard let s = seccion, !s.color.isEmpty else {
            return Color(hexDeLaApp: entry.resumen?.acento ?? "")
        }
        return Color(hexDeLaApp: s.color)
    }
    private var hayViaje: Bool { !(seccion?.nombre ?? "").isEmpty }

    private var enUnaLinea: String {
        guard let s = seccion else { return entry.sinBuzon ? "Sin buzón" : "Abre la app" }
        if s.nombre.isEmpty { return "Sin viajes" }
        return s.enCurso ? "\(s.nombre) · ahora" : "\(s.nombre) · \(cuantoFalta(s.dias))"
    }

    var body: some View {
        switch familia {
        case .accessoryInline:
            Text(enUnaLinea).widgetURL(DestinoDeWidget.viajes.url)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: -2) {
                    Image(systemName: "airplane").font(.system(size: 12, weight: .semibold))
                    if let s = seccion, hayViaje, !s.enCurso {
                        Text("\(s.dias)").font(.system(size: 14, weight: .bold))
                    }
                }
            }
            .widgetURL(DestinoDeWidget.viajes.url)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("Viaje").font(.caption2).fontWeight(.semibold).widgetAccentable()
                Text(seccion?.nombre.isEmpty == false ? seccion!.nombre : enUnaLinea)
                    .font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                if let s = seccion, hayViaje {
                    Text(s.enCurso ? "en marcha" : cuantoFalta(s.dias)).font(.caption2).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(DestinoDeWidget.viajes.url)
        default:
            deInicio
        }
    }

    private var deInicio: some View {
        VStack(alignment: .leading, spacing: 4) {
            RotuloDeWidget(texto: seccion?.enCurso == true ? "DE VIAJE" : "PRÓXIMO VIAJE", color: acento)
            if seccion == nil {
                VacioDeWidget(sinBuzon: entry.sinBuzon, queFalta: "para ver tus viajes")
            } else if !hayViaje {
                Text("Sin viajes")
                    .font(.headline)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            } else if let s = seccion {
                Spacer(minLength: 0)
                Text(s.nombre)
                    .font(.title3).fontWeight(.bold)
                    .minimumScaleFactor(0.6).lineLimit(2)
                if s.enCurso {
                    // Estando DENTRO del viaje, "faltan 0 días" no dice
                    // nada: lo que quieres saber es cuánto te queda.
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        if s.restantes > 0 {
                            Text("\(s.restantes)").font(.title2).fontWeight(.heavy).foregroundStyle(acento)
                            Text(s.restantes == 1 ? "día por delante" : "días por delante")
                                .font(.caption).foregroundStyle(.secondary)
                        } else {
                            Text("Último día").font(.caption).foregroundStyle(acento)
                        }
                    }
                } else {
                    // El número grande y la palabra pequeña: de un vistazo
                    // lo que importa es cuántos días faltan.
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text("\(s.dias)").font(.title2).fontWeight(.heavy).foregroundStyle(acento)
                        Text(s.dias == 1 ? "día" : "días").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                if s.duracion > 0 {
                    Text("Dura \(s.duracion) día\(s.duracion == 1 ? "" : "s")")
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .marcaDeAgua("airplane", acento)
        .fondoDeWidgetApp(entry.resumen.estiloDeWidget)
        .widgetURL(DestinoDeWidget.viajes.url)
    }
}

// ---------------------------------------------------------------------
// Botones del centro de control
// ---------------------------------------------------------------------
// #if compiler(>=6.0) y no solo @available: ControlWidget NO EXISTE en el
// SDK de iOS 17 y anteriores, así que con un Xcode viejo esto no es que
// no se ejecute -- es que no compila. Xcode 16 (el primero con el SDK de
// iOS 18) trae Swift 6, así que esa condición es la forma de preguntar
// "¿tengo el SDK nuevo?" desde el propio código.
//
// Todos ejecutan un AppIntent NUESTRO (ver AbrirDesdeControl.swift), no
// un OpenURLIntent directo. No es un capricho: desde un control, iOS NO
// abre esquemas de URL propios -- el botón se queda mudo, sin ningún
// error, aunque en el simulador funcione. El intent abre la app y ES ÉL,
// ya dentro, quien abre la URL de siempre, así que el camino de entrada
// sigue siendo único (SceneDelegate -> UserDefaults -> el JavaScript).
// Ese archivo se compila en la app Y aquí: si vive solo en la extensión,
// iOS no tiene a quién ejecutarlo y el botón vuelve a no hacer nada.
#if compiler(>=6.0)

@available(iOS 18.0, *)
struct AbrirHoyControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.koku.remindmelater.AbrirHoy") {
            ControlWidgetButton(action: AbrirHoyIntent()) {
                Label("Hoy", systemImage: "calendar")
            }
        }
        .displayName("Hoy")
        .description("Abre RemindMeLater en el día de hoy.")
    }
}

@available(iOS 18.0, *)
struct NuevoEventoControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.koku.remindmelater.NuevoEvento") {
            ControlWidgetButton(action: NuevoEventoIntent()) {
                Label("Nuevo evento", systemImage: "calendar.badge.plus")
            }
        }
        .displayName("Nuevo evento")
        .description("Abre RemindMeLater con un evento nuevo empezado.")
    }
}

@available(iOS 18.0, *)
struct NuevaNotaControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.koku.remindmelater.NuevaNota") {
            ControlWidgetButton(action: NuevaNotaIntent()) {
                Label("Nueva nota", systemImage: "square.and.pencil")
            }
        }
        .displayName("Nueva nota")
        .description("Abre RemindMeLater con una nota nueva empezada.")
    }
}

@available(iOS 18.0, *)
struct VerTareasControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.koku.remindmelater.VerTareas") {
            ControlWidgetButton(action: AbrirTareasIntent()) {
                Label("Tareas", systemImage: "checklist")
            }
        }
        .displayName("Tareas")
        .description("Abre RemindMeLater en tus tareas pendientes.")
    }
}

#endif
