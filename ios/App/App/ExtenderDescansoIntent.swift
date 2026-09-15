import Foundation
#if canImport(ActivityKit)
import ActivityKit
import AppIntents
import UserNotifications

// El "+30s" de la PANTALLA DE BLOQUEO (iOS 17+): los botones de una Live
// Activity ejecutan un App Intent, y un LiveActivityIntent corre en el
// proceso de LA APP (iOS la despierta en segundo plano si hace falta) --
// por eso este archivo se compila en la app Y en el widget: el widget
// necesita ver el tipo para pintar el boton, y la app es quien lo ejecuta.
//
// El JavaScript esta CONGELADO cuando esto corre (movil bloqueado), asi
// que el intent hace las tres cosas el mismo, en nativo:
// 1. Alarga la actividad 30s (la cuenta atras de la tarjeta se mueve sola).
// 2. Reprograma el aviso de fin de descanso (id 999999901) conservando su
//    contenido tal cual -- titulo, texto y el SONIDO que eligio el
//    usuario viajan dentro del content pendiente, sin tener que leer
//    ningun ajuste del webview.
// 3. Apunta los 30s en UserDefaults (gymPendingRestExtra): el JS los
//    recoge al despertar (consumeRestExtension en LiveActivityPlugin) y
//    pone al dia su propio temporizador y el "+Ns" de la serie.
@available(iOS 17.0, *)
struct ExtenderDescansoIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Añadir 30 segundos de descanso"
    // Solo tiene sentido desde el boton de la tarjeta, no como accion
    // suelta de Atajos/Spotlight.
    static var isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        guard let act = Activity<DescansoAttributes>.activities.first else { return .result() }
        let old = act.content.state
        let state = DescansoAttributes.ContentState(
            startAt: old.startAt,
            endAt: old.endAt.addingTimeInterval(30),
            extraSeconds: old.extraSeconds + 30
        )
        await act.update(ActivityContent(state: state, staleDate: state.endAt))

        // El aviso de fin puede ser 1 o 3 notificaciones (modo insistente,
        // ids 999999901/902/903 separadas 2s): se reprograman TODAS las
        // que hubiera pendientes, conservando su content (y su sonido).
        let center = UNUserNotificationCenter.current()
        let pendientes = await center.pendingNotificationRequests()
        let restante = max(1, state.endAt.timeIntervalSinceNow)
        let offsets: [String: TimeInterval] = ["999999901": 0, "999999902": 2, "999999903": 4]
        for req in pendientes {
            guard let offset = offsets[req.identifier] else { continue }
            center.removePendingNotificationRequests(withIdentifiers: [req.identifier])
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: restante + offset, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: req.identifier, content: req.content, trigger: trigger))
        }

        // Si la vigilancia de audio ("bajar la musica al acabar") esta en
        // marcha en este proceso, el final se retrasa con el descanso.
        RestAudioWatcher.shared.reschedule(endAt: state.endAt)

        let defaults = UserDefaults.standard
        defaults.set(defaults.integer(forKey: "gymPendingRestExtra") + 30, forKey: "gymPendingRestExtra")
        return .result()
    }
}
#endif
