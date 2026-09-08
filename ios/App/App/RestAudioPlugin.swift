import Foundation
import Capacitor

// Puente JS <-> RestAudioWatcher (bajar la musica al acabar el descanso).
// Registrado a mano en BridgeViewController, como LiveActivityPlugin.
// Del lado JS: registerPlugin('RestAudio') con startWatch({endAt}),
// updateWatch({endAt}) y cancelWatch().
@objc(RestAudioPlugin)
public class RestAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestAudioPlugin"
    public let jsName = "RestAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelWatch", returnType: CAPPluginReturnPromise)
    ]

    @objc func startWatch(_ call: CAPPluginCall) {
        guard let endMs = call.getDouble("endAt") else {
            call.reject("Falta endAt")
            return
        }
        // duck = bajar la musica al acabar; vibrate = vibracion larga
        // (varios pulsos seguidos, sin notificaciones extra).
        let duck = call.getBool("duck") ?? true
        let vibrate = call.getBool("vibrate") ?? false
        DispatchQueue.main.async {
            let ok = RestAudioWatcher.shared.start(
                endAt: Date(timeIntervalSince1970: endMs / 1000),
                duck: duck,
                vibrate: vibrate
            )
            call.resolve(["watching": ok])
        }
    }

    // Mover el final (+30s): si no habia vigilancia (p. ej. la app se
    // relanzo a mitad de descanso), se arranca de cero.
    @objc func updateWatch(_ call: CAPPluginCall) {
        guard let endMs = call.getDouble("endAt") else {
            call.reject("Falta endAt")
            return
        }
        let duck = call.getBool("duck") ?? true
        let vibrate = call.getBool("vibrate") ?? false
        DispatchQueue.main.async {
            let end = Date(timeIntervalSince1970: endMs / 1000)
            if RestAudioWatcher.shared.watching {
                RestAudioWatcher.shared.reschedule(endAt: end)
            } else {
                RestAudioWatcher.shared.start(endAt: end, duck: duck, vibrate: vibrate)
            }
            call.resolve()
        }
    }

    @objc func cancelWatch(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            RestAudioWatcher.shared.cancel()
            call.resolve()
        }
    }
}
