import Foundation
import AppIntents

// Los botones del CENTRO DE CONTROL (iOS 18+): qué se ejecuta al tocarlos.
//
// POR QUÉ EXISTE ESTE ARCHIVO, y por qué se compila en los DOS targets.
// Esto costó dos intentos fallidos en el iPhone de Koku, así que conviene
// leerlo entero antes de "simplificarlo".
//
// Lo primero que se probó fue lo que parece obvio:
//
//     ControlWidgetButton(action: OpenURLIntent(remindmelater://hoy))
//
// El botón aparece, se puede añadir al centro de control, se ve bien...
// y al tocarlo NO PASA NADA. Sin error, sin traza, sin nada. La causa no
// es del código: **desde un control, iOS no abre esquemas de URL propios**
// (los `remindmelater://` de esta app). Solo acepta universal links, que
// exigen un dominio web con su archivo de asociación -- y esta app no
// tiene servidor ni dominio, así que esa puerta está cerrada de fábrica.
// Lo peor del fallo es que en el SIMULADOR sí funciona, así que parece
// que está bien hasta que se prueba en un teléfono de verdad.
//
// La vuelta que sí funciona es invertir el orden: el botón ya no abre la
// URL, ejecuta un AppIntent NUESTRO con `openAppWhenRun`. iOS abre la app
// y ejecuta el intent DENTRO de ella, y desde dentro de la app el esquema
// propio sí vale. O sea: el mismo camino de siempre (URL -> SceneDelegate
// -> marca -> JavaScript), solo que arrancado desde dentro.
//
// Y LA PIEZA QUE DECIDE SI FUNCIONA O NO, que no es nada evidente:
// **el intent tiene que estar compilado en la app Y en la extensión.**
// Si vive solo en la extensión (que es lo natural, porque es la que pinta
// el botón), iOS no encuentra a quién ejecutarlo en el proceso de la app
// y el botón se queda mudo -- otra vez sin ningún error. Por eso este
// archivo aparece DOS VECES en el project.pbxproj, una por target, igual
// que ExtenderDescansoIntent.swift (el "+30s" de la pantalla de bloqueo,
// que necesita lo mismo por el mismo motivo).
//
// Si algún día se añade un botón de centro de control nuevo, su intent va
// AQUÍ, no en el archivo del widget.

// ControlWidget y OpenURLIntent no existen en SDKs anteriores al de iOS
// 18: con un Xcode viejo esto no es que no se ejecute, es que no compila.
// `@available` no basta para eso, hace falta la condición de compilación.
#if compiler(>=6.0)

// Deja apuntado a dónde hay que ir. Y NO devuelve ninguna URL: la app la
// abre `openAppWhenRun`, que ya funciona.
//
// TERCER INTENTO, y este viene de una pista que dio el propio Koku sin
// buscarla. En el intento anterior el botón SÍ abría la app pero no
// llevaba a ningún sitio, y a la vez **en Atajos no aparecía ni uno de
// estos cinco intents** pese a llevar `isDiscoverable = true`. Eso
// segundo es lo que lo explica todo: si iOS no los ve registrados en la
// APP, es que `perform()` no está corriendo en el proceso de la app --
// corre en el de la EXTENSIÓN. Y `UserDefaults.standard` de la extensión
// NO es el de la app: son dos cajones distintos. La marca se escribía,
// sí, pero en un sitio que la app no mira nunca.
//
// Por eso ahora se escribe en LOS DOS SITIOS: en el propio
// `UserDefaults.standard` (que vale si de verdad corre en la app) y en el
// **App Group**, que es el único terreno común de los dos procesos y que
// desde la build #55 sabemos que funciona. `consumirApertura` del plugin
// ya miraba los dos, así que del lado del JavaScript no cambia nada.
//
// Y se quita el `OpenURLIntent` que devolvía antes: sin él hay un ÚNICO
// escritor de la marca. Con él, si la URL llegaba a SceneDelegate, este
// la escribía otra vez y el JavaScript podía navegar DOS veces -- en
// "nuevo evento" eso es abrir el formulario de nuevo y perder lo escrito.
@available(iOS 18.0, *)
private func apuntarDestinoDeControl(_ destino: String) {
    // "gym-hoy" tiene su propia marca porque no es "abrir una pantalla",
    // es "arrancar el entreno de hoy" -- ver WidgetBridgePlugin.
    let clave = destino == "gym-hoy" ? "gymPendingStartToday" : "widgetPendingDestino"
    let valor: Any = destino == "gym-hoy" ? true : destino

    UserDefaults.standard.set(valor, forKey: clave)
    // El buzón compartido: es el que de verdad cruza de la extensión a la
    // app. Si no existiera (App Group mal firmado), esto es un no-op y no
    // rompe nada.
    UserDefaults(suiteName: grupoDeLaAppParaControl)?.set(valor, forKey: clave)
}

// Repetido a propósito y no importado de ResumenDeLaApp.swift: ese
// archivo vive solo en la extensión, y este tiene que compilar TAMBIÉN en
// la app. Son dos targets, no uno.
let grupoDeLaAppParaControl = "group.com.koku.remindmelater"

// Los cinco son iguales salvo el título y el destino. Se escriben uno a
// uno, sin factorizar en un protocolo con un perform() por defecto, a
// propósito: la metadata de App Intents se genera EN COMPILACIÓN mirando
// cada tipo, y los atajos de herencia ahí dan sorpresas caras (un botón
// que no hace nada, sin ningún error) que aquí no se pueden depurar.

@available(iOS 18.0, *)
struct EmpezarEntrenoDeHoyIntent: AppIntent {
    static var title: LocalizedStringResource = "Empezar el entreno de hoy"
    static var openAppWhenRun = true
    static var isDiscoverable = true

    func perform() async throws -> some IntentResult {
        apuntarDestinoDeControl("gym-hoy")
        return .result()
    }
}

@available(iOS 18.0, *)
struct AbrirHoyIntent: AppIntent {
    static var title: LocalizedStringResource = "Ver el día de hoy"
    static var openAppWhenRun = true
    static var isDiscoverable = true

    func perform() async throws -> some IntentResult {
        apuntarDestinoDeControl("hoy")
        return .result()
    }
}

@available(iOS 18.0, *)
struct AbrirTareasIntent: AppIntent {
    static var title: LocalizedStringResource = "Ver mis tareas pendientes"
    static var openAppWhenRun = true
    static var isDiscoverable = true

    func perform() async throws -> some IntentResult {
        apuntarDestinoDeControl("tareas")
        return .result()
    }
}

@available(iOS 18.0, *)
struct NuevoEventoIntent: AppIntent {
    static var title: LocalizedStringResource = "Crear un evento nuevo"
    static var openAppWhenRun = true
    static var isDiscoverable = true

    func perform() async throws -> some IntentResult {
        apuntarDestinoDeControl("nuevo-evento")
        return .result()
    }
}

@available(iOS 18.0, *)
struct NuevaNotaIntent: AppIntent {
    static var title: LocalizedStringResource = "Crear una nota nueva"
    static var openAppWhenRun = true
    static var isDiscoverable = true

    func perform() async throws -> some IntentResult {
        apuntarDestinoDeControl("nueva-nota")
        return .result()
    }
}

#endif
