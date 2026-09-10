import WidgetKit
import SwiftUI

// El resumen que la app deja en el buzón compartido (App Group), leído
// por TODOS los widgets. Lo escribe public/widget-bridge.js.
//
// POR QUÉ ESTO EXISTE: un widget no puede leer la base de datos de la
// app. La base es SQLite compilado a WebAssembly y vive dentro de la
// webview, en IndexedDB; esto es un proceso nativo aparte que iOS ejecuta
// cuando la app ni siquiera está abierta. La única vía es el buzón.
//
// UN SOLO JSON para los cinco widgets, no uno por widget: son unos pocos
// cientos de bytes, y partirlo obligaría a cinco escrituras, cinco avisos
// a iOS y cinco nombres de clave donde equivocarse.

let grupoDeLaApp = "group.com.koku.remindmelater"
let claveResumen = "resumenApp"

// ---------------------------------------------------------------------
// TODO SE DECODIFICA A MANO, y no es manía
// ---------------------------------------------------------------------
// El decodificador que sintetiza Swift NO usa los valores por defecto
// cuando falta una clave: falla, y con él se cae el resumen entero. Y
// aquí el JSON lo escribe una versión de la app que puede ser más vieja
// que este widget: se instalan juntos, pero el resumen GUARDADO sobrevive
// a la actualización. Sin esto, la primera vez que se abre un widget tras
// actualizar se vería en blanco.
//
// El patrón es siempre `(try? c.decode(...)) ?? porDefecto`, y no
// decodeIfPresent, para que una clave que falte Y una que venga con el
// tipo cambiado caigan las dos en el valor por defecto.
private func leerTexto(_ c: KeyedDecodingContainer<ResumenDeLaApp.CodingKeys>,
                       _ k: ResumenDeLaApp.CodingKeys, _ porDefecto: String = "") -> String {
    (try? c.decode(String.self, forKey: k)) ?? porDefecto
}

struct ResumenDeLaApp: Decodable {
    var actualizado: Double = 0
    var acento: String = "#5b8cff"
    // Los colores del TEMA de la app (--surface y --surface-text). Vacíos
    // en un resumen escrito por una versión anterior: entonces el widget
    // se pinta con el material del sistema, como hacía antes.
    var fondo: String = ""
    var texto: String = ""
    // Cuál de las tres combinaciones eligió Koku en Configuración >
    // Widgets: "app", "sistema" o "mixto". Vacío o desconocido = "app",
    // que es lo de fábrica.
    var estiloWidget: String = "app"
    // Las DOS paletas de la pareja clara/oscura del tema, para "mixto".
    // Si el tema no tiene pareja las dos son iguales, y entonces "mixto"
    // se ve exactamente igual que "app" (la app ya lo avisa por escrito).
    var fondoClaro: String = ""
    var textoClaro: String = ""
    var fondoOscuro: String = ""
    var textoOscuro: String = ""
    // Los widgets de la tanda del 11/9/2026.
    var calendario: SeccionCalendario?
    var consistencia: SeccionConsistencia?
    var musculos: SeccionMusculos?
    var tareas: SeccionTareas?
    var finanzas: SeccionFinanzas?
    var lecturas: SeccionLecturas?
    var viajes: SeccionViajes?

    enum CodingKeys: String, CodingKey {
        case actualizado, acento, fondo, texto, tareas, finanzas, lecturas, viajes
        case calendario, consistencia, musculos
        case estiloWidget, fondoClaro, textoClaro, fondoOscuro, textoOscuro
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        actualizado = (try? c.decode(Double.self, forKey: .actualizado)) ?? 0
        acento = leerTexto(c, .acento, "#5b8cff")
        fondo = leerTexto(c, .fondo, "")
        self.texto = leerTexto(c, .texto, "")
        estiloWidget = leerTexto(c, .estiloWidget, "app")
        fondoClaro = leerTexto(c, .fondoClaro, "")
        textoClaro = leerTexto(c, .textoClaro, "")
        fondoOscuro = leerTexto(c, .fondoOscuro, "")
        textoOscuro = leerTexto(c, .textoOscuro, "")
        // Cada sección por separado: que Finanzas venga rota no puede
        // dejar sin datos al calendario.
        calendario = try? c.decode(SeccionCalendario.self, forKey: .calendario)
        consistencia = try? c.decode(SeccionConsistencia.self, forKey: .consistencia)
        musculos = try? c.decode(SeccionMusculos.self, forKey: .musculos)
        tareas = try? c.decode(SeccionTareas.self, forKey: .tareas)
        finanzas = try? c.decode(SeccionFinanzas.self, forKey: .finanzas)
        lecturas = try? c.decode(SeccionLecturas.self, forKey: .lecturas)
        viajes = try? c.decode(SeccionViajes.self, forKey: .viajes)
    }

    init() {}

    // nil si no hay NADA guardado (app recién instalada) o si el buzón no
    // existe. Las vistas lo tratan con su propio texto, no se quedan en
    // blanco.
    static func leer() -> ResumenDeLaApp? {
        guard let defaults = UserDefaults(suiteName: grupoDeLaApp),
              let json = defaults.string(forKey: claveResumen),
              let datos = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ResumenDeLaApp.self, from: datos)
    }

    // ¿EXISTE SIQUIERA EL BUZÓN COMPARTIDO?
    //
    // UserDefaults(suiteName:) devuelve nil cuando el App Group no viajó
    // en la firma, y ese caso se veía EXACTAMENTE igual que "la app
    // todavía no ha escrito nada": el widget decía "Abre la app" y por
    // mucho que la abrieras no cambiaba nunca. Pasó de verdad (builds
    // #40-#52) y costó dar con ello porque en el iPhone no hay consola.
    static func hayBuzon() -> Bool {
        UserDefaults(suiteName: grupoDeLaApp) != nil
    }

    // ¿Los datos son de hoy? Si no, el widget lo dice en vez de fingir
    // que están al día -- el resumen solo se reescribe cuando la app se
    // abre, así que tras un par de días sin abrirla estaría viejo.
    var esDeHoy: Bool {
        guard actualizado > 0 else { return false }
        let cuando = Date(timeIntervalSince1970: actualizado / 1000)
        return Calendar.current.isDateInToday(cuando)
    }
}

// ---------------------------------------------------------------------
// Las secciones
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// El calendario del mes
// ---------------------------------------------------------------------
struct DiaDelCalendario: Decodable {
    var dia: Int = 0
    var colores: [String] = []
    var total: Int = 0

    enum CodingKeys: String, CodingKey { case dia, colores, total }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        dia = (try? c.decode(Int.self, forKey: .dia)) ?? 0
        colores = (try? c.decode([String].self, forKey: .colores)) ?? []
        total = (try? c.decode(Int.self, forKey: .total)) ?? 0
    }
    init(dia: Int, colores: [String], total: Int) {
        self.dia = dia; self.colores = colores; self.total = total
    }
}

struct SeccionCalendario: Decodable {
    var anio: Int = 0
    var mes: Int = 0
    var nombreMes: String = ""
    // En que columna cae el dia 1 con la semana empezando en LUNES
    // (0 = lunes ... 6 = domingo). Lo calcula el JavaScript porque alli
    // ya se sabe como pinta la app la semana; aqui solo se coloca.
    var primerDiaSemana: Int = 0
    var diasDelMes: Int = 30
    var diaDeHoy: Int = 0
    var dias: [DiaDelCalendario] = []

    enum CodingKeys: String, CodingKey {
        case anio, mes, nombreMes, primerDiaSemana, diasDelMes, diaDeHoy, dias
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        anio = (try? c.decode(Int.self, forKey: .anio)) ?? 0
        mes = (try? c.decode(Int.self, forKey: .mes)) ?? 0
        nombreMes = (try? c.decode(String.self, forKey: .nombreMes)) ?? ""
        primerDiaSemana = (try? c.decode(Int.self, forKey: .primerDiaSemana)) ?? 0
        diasDelMes = (try? c.decode(Int.self, forKey: .diasDelMes)) ?? 30
        diaDeHoy = (try? c.decode(Int.self, forKey: .diaDeHoy)) ?? 0
        dias = (try? c.decode([DiaDelCalendario].self, forKey: .dias)) ?? []
    }
    init(anio: Int, mes: Int, nombreMes: String, primerDiaSemana: Int, diasDelMes: Int, diaDeHoy: Int, dias: [DiaDelCalendario]) {
        self.anio = anio; self.mes = mes; self.nombreMes = nombreMes
        self.primerDiaSemana = primerDiaSemana; self.diasDelMes = diasDelMes
        self.diaDeHoy = diaDeHoy; self.dias = dias
    }

    // Lo de un dia concreto, o nada. Una busqueda lineal sobre 31 dias
    // como mucho: montar un diccionario para eso costaria mas.
    func delDia(_ n: Int) -> DiaDelCalendario? {
        dias.first(where: { $0.dia == n })
    }
}

// ---------------------------------------------------------------------
// Consistencia del Gimnasio
// ---------------------------------------------------------------------
struct SeccionConsistencia: Decodable {
    var diasEntrenados: Int = 0
    var racha: Int = 0
    var estaSemana: Int = 0
    var objetivoSemanal: Int = 0
    var esteMes: Int = 0
    var trabajoDelMes: String = ""
    var trabajoDelMesSegundos: Int = 0
    // 7 cadenas (lunes a domingo) de 26 caracteres (semanas, la de ahora
    // a la derecha). Cada caracter: 0 sin entrenar, 1 una sesion, 2 dos o
    // mas, 9 todavia no ha llegado ese dia.
    var mapa: [String] = []

    enum CodingKeys: String, CodingKey {
        case diasEntrenados, racha, estaSemana, objetivoSemanal, esteMes
        case trabajoDelMes, trabajoDelMesSegundos, mapa
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        diasEntrenados = (try? c.decode(Int.self, forKey: .diasEntrenados)) ?? 0
        racha = (try? c.decode(Int.self, forKey: .racha)) ?? 0
        estaSemana = (try? c.decode(Int.self, forKey: .estaSemana)) ?? 0
        objetivoSemanal = (try? c.decode(Int.self, forKey: .objetivoSemanal)) ?? 0
        esteMes = (try? c.decode(Int.self, forKey: .esteMes)) ?? 0
        trabajoDelMes = (try? c.decode(String.self, forKey: .trabajoDelMes)) ?? ""
        trabajoDelMesSegundos = (try? c.decode(Int.self, forKey: .trabajoDelMesSegundos)) ?? 0
        mapa = (try? c.decode([String].self, forKey: .mapa)) ?? []
    }
    init(diasEntrenados: Int, racha: Int, estaSemana: Int, objetivoSemanal: Int,
         esteMes: Int, trabajoDelMes: String, trabajoDelMesSegundos: Int, mapa: [String]) {
        self.diasEntrenados = diasEntrenados; self.racha = racha
        self.estaSemana = estaSemana; self.objetivoSemanal = objetivoSemanal
        self.esteMes = esteMes; self.trabajoDelMes = trabajoDelMes
        self.trabajoDelMesSegundos = trabajoDelMesSegundos; self.mapa = mapa
    }
}

// ---------------------------------------------------------------------
// El mapa de musculos
// ---------------------------------------------------------------------
struct SeccionMusculos: Decodable {
    // id del grupo muscular -> intensidad de 0 a 1. Solo vienen los que
    // tienen algo; el resto se pintan como silueta apagada.
    var zonas: [String: Double] = [:]
    var ventanaDias: Int = 30
    var metrica: String = "series"

    enum CodingKeys: String, CodingKey { case zonas, ventanaDias, metrica }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        zonas = (try? c.decode([String: Double].self, forKey: .zonas)) ?? [:]
        ventanaDias = (try? c.decode(Int.self, forKey: .ventanaDias)) ?? 30
        metrica = (try? c.decode(String.self, forKey: .metrica)) ?? "series"
    }
    init(zonas: [String: Double], ventanaDias: Int, metrica: String) {
        self.zonas = zonas; self.ventanaDias = ventanaDias; self.metrica = metrica
    }
}

struct FilaDeTarea: Decodable {
    var titulo: String = ""
    var cuando: String = ""
    var color: String = ""
    var vencida: Bool = false
    var hoy: Bool = false

    enum CodingKeys: String, CodingKey { case titulo, cuando, color, vencida, hoy }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        titulo = (try? c.decode(String.self, forKey: .titulo)) ?? ""
        cuando = (try? c.decode(String.self, forKey: .cuando)) ?? ""
        color = (try? c.decode(String.self, forKey: .color)) ?? ""
        vencida = (try? c.decode(Bool.self, forKey: .vencida)) ?? false
        hoy = (try? c.decode(Bool.self, forKey: .hoy)) ?? false
    }
    init(titulo: String, cuando: String, color: String, vencida: Bool, hoy: Bool) {
        self.titulo = titulo; self.cuando = cuando; self.color = color
        self.vencida = vencida; self.hoy = hoy
    }
}

struct SeccionTareas: Decodable {
    var lista: [FilaDeTarea] = []
    var total: Int = 0
    var vencidas: Int = 0

    enum CodingKeys: String, CodingKey { case lista, total, vencidas }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        lista = (try? c.decode([FilaDeTarea].self, forKey: .lista)) ?? []
        total = (try? c.decode(Int.self, forKey: .total)) ?? 0
        vencidas = (try? c.decode(Int.self, forKey: .vencidas)) ?? 0
    }
    init(lista: [FilaDeTarea], total: Int, vencidas: Int) {
        self.lista = lista; self.total = total; self.vencidas = vencidas
    }
}

struct SeccionFinanzas: Decodable {
    var gastado: Double = 0
    var limite: Double = 0
    var ahorro: Double = 0
    var objetivo: Double = 0
    var diasRestantes: Int = 0

    enum CodingKeys: String, CodingKey { case gastado, limite, ahorro, objetivo, diasRestantes }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        gastado = (try? c.decode(Double.self, forKey: .gastado)) ?? 0
        limite = (try? c.decode(Double.self, forKey: .limite)) ?? 0
        ahorro = (try? c.decode(Double.self, forKey: .ahorro)) ?? 0
        objetivo = (try? c.decode(Double.self, forKey: .objetivo)) ?? 0
        diasRestantes = (try? c.decode(Int.self, forKey: .diasRestantes)) ?? 0
    }
    init(gastado: Double, limite: Double, ahorro: Double, objetivo: Double, diasRestantes: Int) {
        self.gastado = gastado; self.limite = limite; self.ahorro = ahorro
        self.objetivo = objetivo; self.diasRestantes = diasRestantes
    }

    var hayLimite: Bool { limite > 0 }
    // Cuánto del límite llevas gastado, de 0 a 1. Se recorta arriba
    // porque una barra al 130% no se puede dibujar -- que te has pasado
    // ya lo dice el color.
    var fraccion: Double {
        guard limite > 0 else { return 0 }
        return min(1, max(0, gastado / limite))
    }
    var pasado: Bool { limite > 0 && gastado > limite }
    var restante: Double { max(0, limite - gastado) }
}

struct FilaDeLectura: Decodable {
    var titulo: String = ""
    var tipo: String = ""
    var progreso: String = ""

    enum CodingKeys: String, CodingKey { case titulo, tipo, progreso }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        titulo = (try? c.decode(String.self, forKey: .titulo)) ?? ""
        tipo = (try? c.decode(String.self, forKey: .tipo)) ?? ""
        progreso = (try? c.decode(String.self, forKey: .progreso)) ?? ""
    }
    init(titulo: String, tipo: String, progreso: String) {
        self.titulo = titulo; self.tipo = tipo; self.progreso = progreso
    }
}

struct SeccionLecturas: Decodable {
    var lista: [FilaDeLectura] = []
    var total: Int = 0

    enum CodingKeys: String, CodingKey { case lista, total }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        lista = (try? c.decode([FilaDeLectura].self, forKey: .lista)) ?? []
        total = (try? c.decode(Int.self, forKey: .total)) ?? 0
    }
    init(lista: [FilaDeLectura], total: Int) { self.lista = lista; self.total = total }
}

struct SeccionViajes: Decodable {
    var nombre: String = ""
    var dias: Int = 0
    var enCurso: Bool = false
    var color: String = ""
    // Cuánto dura el viaje entero, y cuántos días le quedan si ya estás
    // dentro. Estando de viaje, "faltan 0 días" no dice nada; "te quedan
    // 3" sí.
    var duracion: Int = 0
    var restantes: Int = 0

    enum CodingKeys: String, CodingKey { case nombre, dias, enCurso, color, duracion, restantes }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        nombre = (try? c.decode(String.self, forKey: .nombre)) ?? ""
        dias = (try? c.decode(Int.self, forKey: .dias)) ?? 0
        enCurso = (try? c.decode(Bool.self, forKey: .enCurso)) ?? false
        color = (try? c.decode(String.self, forKey: .color)) ?? ""
        duracion = (try? c.decode(Int.self, forKey: .duracion)) ?? 0
        restantes = (try? c.decode(Int.self, forKey: .restantes)) ?? 0
    }
    init(nombre: String, dias: Int, enCurso: Bool, color: String,
         duracion: Int = 0, restantes: Int = 0) {
        self.nombre = nombre; self.dias = dias; self.enCurso = enCurso; self.color = color
        self.duracion = duracion; self.restantes = restantes
    }
}

// ---------------------------------------------------------------------
// Piezas compartidas por las vistas
// ---------------------------------------------------------------------

// "#rrggbb" -> Color. Los colores viajan en hexadecimal porque aquí no
// hay variables CSS: esto es SwiftUI, no la webview.
extension Color {
    init(hexDeLaApp: String, porDefecto: String = "#5b8cff") {
        var limpio = hexDeLaApp.isEmpty ? porDefecto : hexDeLaApp
        if limpio.hasPrefix("#") { limpio.removeFirst() }
        // Un hex corto o con basura dejaría un color negro sin avisar; con
        // esto cae en el azul de siempre, que al menos se ve.
        if limpio.count != 6 { limpio = porDefecto.replacingOccurrences(of: "#", with: "") }
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
//
// Y ADEMÁS pinta el widget con los colores del TEMA de la app (petición
// de Koku: *"no sigue demasiado el tema de la app, antes estaba en claro,
// pero el sistema está en modo oscuro"*). Con `.fill.tertiary` a secas el
// widget seguía el modo claro/oscuro del SISTEMA, que es lo que hacen casi
// todos los widgets de iOS, pero aquí choca: la app puede estar en un tema
// claro y el widget salir oscuro al lado.
//
// Los dos colores viajan en el resumen (`fondo` y `texto`, sacados de
// --surface y --surface-text). Si no llegan -- un resumen viejo, escrito
// por una versión anterior de la app -- se cae al material del sistema de
// siempre, que es exactamente lo que había antes.
//
// El texto se pone con `.foregroundStyle` en la RAÍZ a propósito: los
// `.secondary` de dentro son estilos JERÁRQUICOS, así que se derivan solos
// de ese color en vez de quedarse con el gris del sistema. Un solo sitio
// tiñe el widget entero.
//
// Esto es SOLO para la pantalla de inicio. En la de bloqueo iOS pinta todo
// en monocromo y con su propio tratamiento, y meterle colores ahí solo
// quita legibilidad -- por eso las vistas de bloqueo no llaman a esto.
// Las TRES combinaciones que eligió Koku (Configuración > Widgets). Se
// resuelven aquí, en un ViewModifier de verdad y no en un `func` suelto,
// porque "mixto" necesita `@Environment(\.colorScheme)` -- o sea, saber
// cómo está el MÓVIL en el momento de pintar, que es algo que solo se
// puede leer desde dentro de una vista.
//
//  - app     → los colores del tema tal y como está puesto en la app.
//  - sistema → el material de iOS de siempre. Es lo que había antes.
//  - mixto   → la paleta de la app, pero eligiendo su variante clara u
//              oscura según el móvil. Si el tema no tiene pareja, las dos
//              paletas llegan iguales y se ve como "app" (la app lo avisa).
//
// El TEXTO se pone con `.foregroundStyle` en la RAÍZ: los `.secondary` de
// dentro son estilos JERÁRQUICOS y se derivan solos de ese color, en vez
// de quedarse con el gris del sistema. Un solo sitio tiñe el widget entero.
//
// Y si los colores llegan vacíos -- un resumen escrito por una versión
// anterior de la app -- se cae al material del sistema. Mandar un blanco
// fijo dejaría el widget blanco al lado de una app oscura, peor que no
// hacer nada.
// Los siete datos del estilo, juntos. Struct y no una tupla larga porque
// la comparten los DOS modelos (el resumen general y el del Gimnasio, que
// tiene el suyo propio) y una tupla de siete no hay quien la lea.
struct EstiloDeWidget {
    var estilo: String = "app"
    var fondo: String = ""
    var texto: String = ""
    var fondoClaro: String = ""
    var textoClaro: String = ""
    var fondoOscuro: String = ""
    var textoOscuro: String = ""
}

struct FondoDeWidget: ViewModifier {
    @Environment(\.colorScheme) private var esquema
    let estilo: EstiloDeWidget

    private var elegidos: (fondo: String, texto: String) {
        switch estilo.estilo {
        case "sistema":
            return ("", "")
        case "mixto":
            let oscuro = esquema == .dark
            let f = oscuro ? estilo.fondoOscuro : estilo.fondoClaro
            let x = oscuro ? estilo.textoOscuro : estilo.textoClaro
            // Sin pareja guardada se usa la paleta normal, que es lo que
            // hay: quedarse en blanco sería peor.
            return f.isEmpty || x.isEmpty ? (estilo.fondo, estilo.texto) : (f, x)
        default:
            return (estilo.fondo, estilo.texto)
        }
    }

    func body(content: Content) -> some View {
        let (fondoHex, textoHex) = elegidos
        let conTema = !fondoHex.isEmpty && !textoHex.isEmpty
        if #available(iOS 17.0, *) {
            if conTema {
                content
                    .foregroundStyle(Color(hexDeLaApp: textoHex))
                    .containerBackground(Color(hexDeLaApp: fondoHex), for: .widget)
            } else {
                content.containerBackground(.fill.tertiary, for: .widget)
            }
        } else {
            content.padding()
        }
    }
}

extension View {
    // containerBackground es OBLIGATORIO desde iOS 17 (sin él el widget
    // sale en blanco o no se dibuja), pero no existe antes: el
    // #available vive dentro del modifier.
    //
    // Esto es SOLO para la pantalla de INICIO. En la de bloqueo iOS pinta
    // todo en monocromo con su propio tratamiento, y meterle colores ahí
    // solo quita legibilidad -- por eso las vistas de bloqueo no llaman
    // a esto.
    func fondoDeWidgetApp(_ estilo: EstiloDeWidget) -> some View {
        modifier(FondoDeWidget(estilo: estilo))
    }
}

extension ResumenDeLaApp {
    var estiloDeWidget: EstiloDeWidget {
        EstiloDeWidget(estilo: estiloWidget, fondo: fondo, texto: texto,
                       fondoClaro: fondoClaro, textoClaro: textoClaro,
                       fondoOscuro: fondoOscuro, textoOscuro: textoOscuro)
    }
}

// Sin resumen todavía: el material del sistema, que es lo neutro.
extension Optional where Wrapped == ResumenDeLaApp {
    var estiloDeWidget: EstiloDeWidget {
        self?.estiloDeWidget ?? EstiloDeWidget(estilo: "sistema")
    }
}

// LA MARCA DE AGUA: el icono de cada widget, grande y muy tenue, en la
// esquina de abajo a la derecha.
//
// Koku, viendo el mediano del Gimnasio en un día de descanso: "lo veo
// algo vacío, se podría poner alguna cosa... No sólo para ese, para el
// resto también". Ese hueco existe de verdad -- en un día de entreno lo
// tapa el botón "Empezar", y en cuanto no hay botón queda medio widget
// en blanco.
//
// Cuatro decisiones, para que no se deshagan sin querer:
//
// - Va de FONDO (.background), no dentro del VStack: así no empuja ni
//   recorta nada de lo que ya había, y si algún día el contenido crece
//   hasta llenar el widget la marca simplemente queda detrás.
// - Opacidad muy baja y el color del ACENTO, no gris: tiene que leerse
//   como una textura del tema, no como un icono que se pueda tocar. Con
//   más opacidad compite con el texto, y en un widget de 4 líneas eso se
//   nota enseguida.
// - Se sale por la esquina a propósito (el offset positivo): un icono
//   entero y centrado parece un elemento más; cortado, es fondo. WidgetKit
//   recorta al borde redondeado, así que no se desborda.
// - SOLO en la pantalla de INICIO. En la de bloqueo iOS pinta todo en
//   monocromo y con muy poco contraste; una marca de agua ahí se come la
//   poca legibilidad que queda.
struct MarcaDeAgua: ViewModifier {
    let simbolo: String
    let color: Color
    func body(content: Content) -> some View {
        content.background(alignment: .bottomTrailing) {
            Image(systemName: simbolo)
                .font(.system(size: 84, weight: .semibold))
                .foregroundStyle(color.opacity(0.12))
                .offset(x: 16, y: 12)
                // Es decoración: para VoiceOver no existe.
                .accessibilityHidden(true)
        }
    }
}

extension View {
    func marcaDeAgua(_ simbolo: String, _ color: Color) -> some View {
        modifier(MarcaDeAgua(simbolo: simbolo, color: color))
    }
}

// Importes cortos: en un widget pequeño no cabe "1.234,56 €", y los
// céntimos no aportan nada de un vistazo.
func importeCorto(_ valor: Double) -> String {
    let redondeado = valor.rounded()
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.maximumFractionDigits = 0
    f.locale = Locale(identifier: "es_ES")
    let numero = f.string(from: NSNumber(value: redondeado)) ?? String(Int(redondeado))
    return "\(numero) €"
}

// "en 3 días" / "mañana" / "hoy", que es como se lee de verdad.
func cuantoFalta(_ dias: Int) -> String {
    if dias <= 0 { return "hoy" }
    if dias == 1 { return "mañana" }
    return "en \(dias) días"
}
