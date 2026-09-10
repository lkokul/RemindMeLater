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

// La URL que abrirá la app. Aquí NO se escribe ninguna marca: de eso se
// encarga SceneDelegate cuando le llega la URL, igual que con el toque en
// el widget.
//
// Se probó a dejarla también aquí (cinturón y tirantes) y se descartó a
// propósito: serían DOS escritores de la misma marca, y si el JavaScript
// llegara a leerla entre una escritura y la otra la consumiría, navegaría,
// y la segunda escritura le haría navegar OTRA VEZ. En "nuevo evento" eso
// es abrir el formulario dos veces y perder lo que hubieras escrito. Un
// solo escritor no tiene ese problema.
@available(iOS 18.0, *)
private func aperturaDeControl(_ destino: String) -> OpenURLIntent {
    OpenURLIntent(URL(string: "remindmelater://\(destino)")!)
}

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

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: aperturaDeControl("gym-hoy"))
    }
}

@available(iOS 18.0, *)
struct AbrirHoyIntent: AppIntent {
    static var title: LocalizedStringResource = "Ver el día de hoy"
    static var openAppWhenRun = true
    static var isDiscoverable = true

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: aperturaDeControl("hoy"))
    }
}

@available(iOS 18.0, *)
struct AbrirTareasIntent: AppIntent {
    static var title: LocalizedStringResource = "Ver mis tareas pendientes"
    static var openAppWhenRun = true
    static var isDiscoverable = true

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: aperturaDeControl("tareas"))
    }
}

@available(iOS 18.0, *)
struct NuevoEventoIntent: AppIntent {
    static var title: LocalizedStringResource = "Crear un evento nuevo"
    static var openAppWhenRun = true
    static var isDiscoverable = true

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: aperturaDeControl("nuevo-evento"))
    }
}

@available(iOS 18.0, *)
struct NuevaNotaIntent: AppIntent {
    static var title: LocalizedStringResource = "Crear una nota nueva"
    static var openAppWhenRun = true
    static var isDiscoverable = true

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: aperturaDeControl("nueva-nota"))
    }
}

#endif
