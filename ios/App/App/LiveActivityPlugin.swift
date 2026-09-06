import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

// Puente entre el JavaScript del gimnasio y las Live Activities de iOS
// (la tarjeta con cuenta atras en la pantalla de bloqueo y la isla
// dinamica). Es un plugin LOCAL: vive dentro de la app, sin paquete npm.
// Se registra a mano en BridgeViewController.capacitorDidLoad() -- sin
// eso, el proxy de JS existiria pero cada llamada daria "not implemented"
// (la misma leccion que costo una ronda con LocalNotifications).
//
// Del lado JS se usa como registerPlugin('LiveActivity') con tres
// metodos: startRest / updateRest / endRest. En iOS < 16.2 (o si el
// usuario desactivo las Live Activities en Ajustes) todo responde
// {started:false} sin romper nada.
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startRest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateRest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endRest", returnType: CAPPluginReturnPromise)
    ]

    // Empieza (o reinicia) la actividad del descanso. startAt/endAt
    // llegan en milisegundos de epoch, como Date.now() en JS.
    @objc func startRest(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard let endMs = call.getDouble("endAt") else {
                call.reject("Falta endAt")
                return
            }
            let startMs = call.getDouble("startAt") ?? Date().timeIntervalSince1970 * 1000
            let dayName = call.getString("dayName") ?? "Entrenamiento"
            let state = DescansoAttributes.ContentState(
                startAt: Date(timeIntervalSince1970: startMs / 1000),
                endAt: Date(timeIntervalSince1970: endMs / 1000)
            )
            Task {
                // Solo puede haber UNA tarjeta de descanso: si quedaba
                // alguna de una serie anterior, fuera antes de crear la
                // nueva.
                for act in Activity<DescansoAttributes>.activities {
                    await act.end(nil, dismissalPolicy: .immediate)
                }
                guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                    call.resolve(["started": false])
                    return
                }
                do {
                    _ = try Activity.request(
                        attributes: DescansoAttributes(dayName: dayName),
                        // staleDate = el final del descanso: si la app no
                        // llega a cerrarla (movil bloqueado), el sistema
                        // la marca como pasada en vez de dejarla "viva".
                        content: .init(state: state, staleDate: state.endAt)
                    )
                    call.resolve(["started": true])
                } catch {
                    call.resolve(["started": false, "error": error.localizedDescription])
                }
            }
            return
        }
        #endif
        call.resolve(["started": false])
    }

    // Cambia las fechas de la actividad en curso (el boton +30s). Si no
    // hay ninguna (p. ej. iOS la descarto), no pasa nada: el JS llama a
    // startRest en su lugar cuando updated == false.
    @objc func updateRest(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard let endMs = call.getDouble("endAt") else {
                call.reject("Falta endAt")
                return
            }
            let startMs = call.getDouble("startAt") ?? Date().timeIntervalSince1970 * 1000
            let state = DescansoAttributes.ContentState(
                startAt: Date(timeIntervalSince1970: startMs / 1000),
                endAt: Date(timeIntervalSince1970: endMs / 1000)
            )
            Task {
                guard let act = Activity<DescansoAttributes>.activities.first else {
                    call.resolve(["updated": false])
                    return
                }
                await act.update(.init(state: state, staleDate: state.endAt))
                call.resolve(["updated": true])
            }
            return
        }
        #endif
        call.resolve(["updated": false])
    }

    // Quita la tarjeta (descanso saltado, serie desmarcada, entreno
    // terminado o descartado, o el descanso llego a cero con la app
    // despierta).
    @objc func endRest(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task {
                for act in Activity<DescansoAttributes>.activities {
                    await act.end(nil, dismissalPolicy: .immediate)
                }
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }
}
