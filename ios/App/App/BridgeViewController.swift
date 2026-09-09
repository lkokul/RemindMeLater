import UIKit
import Capacitor

// Controlador raiz de la app: identico al CAPBridgeViewController de
// serie salvo por dos cosas -- registra los plugins LOCALES (los que
// viven en este proyecto, sin paquete npm) y bloquea la rotacion. Es el
// mecanismo oficial de Capacitor para plugins propios: Main.storyboard
// apunta a esta clase en vez de a CAPBridgeViewController directamente.
class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(RestAudioPlugin())
        // Mandos del auricular para callar la vibracion del descanso:
        // solo existe en el target de la app (ver RestAlertStopper).
        RestAlertStopper.instalar()
    }

    // SOLO VERTICAL, pedido por Koku. Va en codigo y no solo en el
    // Info.plist por un motivo muy concreto: App Store Connect RECHAZA
    // la subida (error 90474) si el bundle dice que vale para iPad y su
    // lista de orientaciones no trae las cuatro, porque las exige para
    // el multitarea de iPad. Paso de verdad con la build #39: compilo y
    // exporto bien, y reboto justo al subir.
    //
    // Asi que el Info.plist declara lo que Apple pide y la ultima
    // palabra la tiene esto, que manda por encima de esa lista: iOS
    // pregunta al controlador que se esta viendo, y aqui se contesta
    // "vertical y punto" en cualquier aparato.
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return .portrait
    }

    // Con lo de arriba ya bastaria, pero decirlo tambien aqui evita que
    // iOS llegue siquiera a lanzar la animacion de girar.
    override var shouldAutorotate: Bool {
        return false
    }
}
