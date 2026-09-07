import Foundation
import AVFoundation

// "Baja un poco la musica al acabar el descanso" (peticion de Koku): el
// truco de iOS para esto es el audio DUCKING -- activar una sesion de
// audio con .duckOthers hace que el sistema atenue lo que este sonando
// (Spotify, Musica...), y desactivarla con .notifyOthersOnDeactivation
// lo devuelve a su volumen. Como en el GPS cuando habla por encima de
// la musica.
//
// La pega: para hacerlo JUSTO al acabar, la app tiene que estar
// despierta en ese momento -- y con el movil bloqueado iOS congela la
// app. La solucion (estandar en apps de intervalos): durante el descanso
// se reproduce EN BUCLE el silencio.wav a volumen 0 con la sesion en
// .mixWithOthers (no toca la musica), lo que con el modo de fondo
// "audio" (Info.plist) mantiene la app viva; el temporizador nativo
// llega al final, cambia la sesion a .duckOthers 3 segundos (la musica
// baja) y luego la suelta (la musica vuelve). Consumo de bateria
// despreciable: solo dura lo que dura el descanso.
//
// Es un singleton SIN Capacitor a proposito: lo usan el plugin
// (RestAudioPlugin) y el intent del +30s de la pantalla de bloqueo
// (ExtenderDescansoIntent, que corre en el proceso de la app), y ademas
// se compila tambien en el target del widget (el intent vive en ambos),
// donde simplemente nunca hay un watch activo.
final class RestAudioWatcher {
    static let shared = RestAudioWatcher()
    private init() {}

    private var player: AVAudioPlayer?
    private var duckTimer: Timer?
    private var restoreTimer: Timer?
    private(set) var watching = false

    // Empieza (o reinicia) la vigilancia de un descanso que acaba en
    // endAt. Devuelve false si el audio no se pudo preparar.
    @discardableResult
    func start(endAt: Date) -> Bool {
        teardown(deactivate: false)
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            return false
        }
        if let url = Bundle.main.url(forResource: "silencio", withExtension: "wav"),
           let p = try? AVAudioPlayer(contentsOf: url) {
            p.numberOfLoops = -1
            p.volume = 0
            p.play()
            player = p
        }
        let delay = max(0.5, endAt.timeIntervalSinceNow)
        let t = Timer(timeInterval: delay, repeats: false) { [weak self] _ in
            self?.duckNow()
        }
        RunLoop.main.add(t, forMode: .common)
        duckTimer = t
        watching = true
        return true
    }

    // El +30s (desde la app o desde la pantalla de bloqueo) mueve el
    // final: solo se retrasa el temporizador si ya habia vigilancia.
    func reschedule(endAt: Date) {
        guard watching else { return }
        duckTimer?.invalidate()
        let t = Timer(timeInterval: max(0.5, endAt.timeIntervalSinceNow), repeats: false) { [weak self] _ in
            self?.duckNow()
        }
        RunLoop.main.add(t, forMode: .common)
        duckTimer = t
    }

    // Descanso saltado/desmarcado o entreno terminado: se suelta todo.
    func cancel() {
        teardown(deactivate: true)
    }

    private func duckNow() {
        watching = false
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, options: [.mixWithOthers, .duckOthers])
            try session.setActive(true)
        } catch { /* si falla, al menos no rompemos nada */ }
        let t = Timer(timeInterval: 3.0, repeats: false) { [weak self] _ in
            self?.teardown(deactivate: true)
        }
        RunLoop.main.add(t, forMode: .common)
        restoreTimer = t
    }

    private func teardown(deactivate: Bool) {
        duckTimer?.invalidate(); duckTimer = nil
        restoreTimer?.invalidate(); restoreTimer = nil
        player?.stop(); player = nil
        watching = false
        if deactivate {
            // notifyOthersOnDeactivation es lo que le dice a la musica
            // "ya puedes volver a tu volumen".
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }
}
