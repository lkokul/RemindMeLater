import Foundation
import AVFoundation
import AudioToolbox
import UserNotifications

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
    private var pulseTimer: Timer?
    private var pulsesLeft = 0
    private var duckEnabled = true
    private var vibrateEnabled = false
    private(set) var watching = false

    // Vigilancia para CALLAR la vibracion (peticion de Koku: "que se
    // quite si toco el boton de apagado, si le doy a la pausa del
    // auricular o si quito la notificacion, no solo pinchando en ella").
    private var stopObservers: [NSObjectProtocol] = []
    private var volumeObserver: NSKeyValueObservation?
    private var bannerTimer: Timer?
    private var bannerSeen = false
    private var stopArmedAt = Date.distantFuture
    // Id de la notificacion del fin de descanso (el mismo reservado que
    // usa gymScheduleRestNotification en app.js).
    private static let restNotificationId = "999999901"

    // Cuantas vibraciones seguidas y cada cuanto, cuando esta activada la
    // vibracion larga. 6 pulsos separados 0.8s = casi 5 segundos de aviso
    // notable, sin mandar ni una notificacion extra.
    private static let pulseCount = 6
    private static let pulseInterval: TimeInterval = 0.8

    // Empieza (o reinicia) la vigilancia de un descanso que acaba en
    // endAt. Devuelve false si el audio no se pudo preparar.
    @discardableResult
    func start(endAt: Date, duck: Bool = true, vibrate: Bool = false) -> Bool {
        duckEnabled = duck
        vibrateEnabled = vibrate
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
        if duckEnabled {
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setCategory(.playback, options: [.mixWithOthers, .duckOthers])
                try session.setActive(true)
            } catch { /* si falla, al menos no rompemos nada */ }
        }
        // Vibracion LARGA: varios pulsos seguidos en vez de mandar una
        // notificacion por vibracion (peticion de Koku). iOS no permite
        // alargar la vibracion de una notificacion, pero como la app esta
        // despierta durante el descanso (el silencio en bucle de arriba),
        // aqui si se puede repetir la vibracion del sistema a mano.
        if vibrateEnabled {
            pulsesLeft = RestAudioWatcher.pulseCount
            vibrarPulso()
            let p = Timer(timeInterval: RestAudioWatcher.pulseInterval, repeats: true) { [weak self] t in
                guard let self = self else { t.invalidate(); return }
                if self.pulsesLeft <= 0 { t.invalidate(); self.pulseTimer = nil; return }
                self.vibrarPulso()
            }
            RunLoop.main.add(p, forMode: .common)
            pulseTimer = p
            empezarVigilanciaDeParada()
        }
        // Se suelta el audio cuando ya han pasado el duck y los pulsos.
        let espera = vibrateEnabled
            ? Double(RestAudioWatcher.pulseCount) * RestAudioWatcher.pulseInterval + 0.5
            : 3.0
        let t = Timer(timeInterval: espera, repeats: false) { [weak self] _ in
            self?.teardown(deactivate: true)
        }
        RunLoop.main.add(t, forMode: .common)
        restoreTimer = t
    }

    private func vibrarPulso() {
        pulsesLeft -= 1
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
    }

    // --- Callar la vibracion sin tener que abrir la app ----------------
    // Koku pidio que la tanda de vibraciones se corte como se corta el
    // temporizador del iPhone. iOS no expone "han pulsado el boton de
    // apagado", asi que se vigila todo lo que SI se puede ver y que
    // significa "ya me he enterado":
    //   - la app pasa a primer plano (abrirla o tocar la notificacion),
    //   - se desbloquea el telefono (lo que pasa justo despues de darle
    //     al boton de apagado/encendido y volver a mirar),
    //   - se toca un boton de volumen (se observa outputVolume),
    //   - el audio principal se para o arranca -- es lo que ocurre al
    //     darle a la pausa del auricular; como esta app suena como audio
    //     SECUNDARIO (silencio en bucle con .mixWithOthers), iOS avisa
    //     con silenceSecondaryAudioHint. La musica no se toca: quien
    //     pausa es Spotify, nosotros solo nos enteramos.
    //   - la notificacion del descanso desaparece del centro de avisos
    //     (la has descartado deslizandola), que se comprueba preguntando
    //     por las entregadas cada poco.
    private func empezarVigilanciaDeParada() {
        pararVigilanciaDeParada()
        // Margen de cortesia: activar la sesion de audio y encender la
        // pantalla justo al empezar el aviso pueden disparar alguna de
        // estas senales por si mismos, y el aviso se callaria antes de
        // notarse.
        stopArmedAt = Date().addingTimeInterval(1.2)
        let centro = NotificationCenter.default
        // Nombres por cadena a proposito: este archivo se compila tambien
        // en el target del widget, donde parte de UIApplication no esta
        // disponible; el nombre de la notificacion si vale igual.
        let nombres = [
            Notification.Name("UIApplicationDidBecomeActiveNotification"),
            Notification.Name("UIApplicationProtectedDataDidBecomeAvailable"),
            AVAudioSession.silenceSecondaryAudioHintNotification,
        ]
        for nombre in nombres {
            stopObservers.append(centro.addObserver(forName: nombre, object: nil, queue: .main) { [weak self] _ in
                self?.pararAviso()
            })
        }

        let sesion = AVAudioSession.sharedInstance()
        let volumenInicial = sesion.outputVolume
        volumeObserver = sesion.observe(\.outputVolume, options: [.new]) { [weak self] _, cambio in
            guard let nuevo = cambio.newValue else { return }
            // Solo si de verdad ha cambiado (el KVO tambien dispara al
            // activar la sesion con el mismo valor).
            if abs(nuevo - volumenInicial) > 0.001 {
                DispatchQueue.main.async { self?.pararAviso() }
            }
        }

        bannerSeen = false
        let b = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.comprobarBanner()
        }
        RunLoop.main.add(b, forMode: .common)
        bannerTimer = b
    }

    private func comprobarBanner() {
        UNUserNotificationCenter.current().getDeliveredNotifications { [weak self] entregadas in
            guard let self = self else { return }
            let sigue = entregadas.contains { $0.request.identifier == RestAudioWatcher.restNotificationId }
            DispatchQueue.main.async {
                if sigue {
                    self.bannerSeen = true
                } else if self.bannerSeen {
                    // Estaba y ya no: la has quitado de la pantalla.
                    self.pararAviso()
                }
            }
        }
    }

    private func pararVigilanciaDeParada() {
        for o in stopObservers { NotificationCenter.default.removeObserver(o) }
        stopObservers.removeAll()
        volumeObserver?.invalidate(); volumeObserver = nil
        bannerTimer?.invalidate(); bannerTimer = nil
        bannerSeen = false
        stopArmedAt = Date.distantFuture
    }

    // Corta la tanda de vibraciones y devuelve la musica a su volumen ya
    // mismo, sin esperar a que se acaben los pulsos.
    private func pararAviso() {
        guard pulseTimer != nil || pulsesLeft > 0 else { return }
        guard Date() >= stopArmedAt else { return }
        teardown(deactivate: true)
    }

    private func teardown(deactivate: Bool) {
        pararVigilanciaDeParada()
        duckTimer?.invalidate(); duckTimer = nil
        restoreTimer?.invalidate(); restoreTimer = nil
        pulseTimer?.invalidate(); pulseTimer = nil
        pulsesLeft = 0
        player?.stop(); player = nil
        watching = false
        if deactivate {
            // notifyOthersOnDeactivation es lo que le dice a la musica
            // "ya puedes volver a tu volumen".
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }
}
