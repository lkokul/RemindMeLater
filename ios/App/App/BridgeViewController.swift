import UIKit
import Capacitor

// Controlador raiz de la app: identico al CAPBridgeViewController de
// serie salvo por una cosa -- registra los plugins LOCALES (los que viven
// en este proyecto, sin paquete npm). Es el mecanismo oficial de
// Capacitor para plugins propios: Main.storyboard apunta a esta clase en
// vez de a CAPBridgeViewController directamente.
class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(RestAudioPlugin())
    }
}
