import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    // Tocar la tarjeta del descanso (Live Activity) abre la app con la URL
    // remindmelater://gym-live (ver .widgetURL en DescansoWidgetBundle y
    // CFBundleURLTypes en Info.plist). Aqui solo se deja una marca; el JS
    // la recoge en consumeRestExtension() y navega al entrenamiento.
    private func marcarAperturaDesdeActividad(_ contexts: Set<UIOpenURLContext>) {
        let nuestras = contexts.filter { $0.url.scheme == "remindmelater" }
        // gym-live: la tarjeta del descanso -> volver al entreno EN CURSO.
        if nuestras.contains(where: { $0.url.host == "gym-live" }) {
            UserDefaults.standard.set(true, forKey: "gymPendingOpenFromActivity")
        }
        // gym-hoy: el widget "Que toca hoy" -> EMPEZAR el entreno de hoy.
        // Son dos cosas distintas y por eso dos marcas: una reanuda algo
        // que ya estaba pasando y la otra arranca algo nuevo.
        if nuestras.contains(where: { $0.url.host == "gym-hoy" }) {
            UserDefaults.standard.set(true, forKey: "gymPendingStartToday")
        }
    }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        marcarAperturaDesdeActividad(connectionOptions.urlContexts)

        window = UIWindow(windowScene: windowScene)
        // BridgeViewController (subclase nuestra) y NO CAPBridgeViewController
        // a secas: la subclase es quien registra los plugins LOCALES
        // (LiveActivityPlugin). Aqui estuvo el bug de "LiveActivity plugin
        // is not implemented on ios": el controlador se crea AQUI por
        // codigo, asi que cambiar la clase solo en Main.storyboard no
        // servia de nada -- el storyboard ni se usa para esto.
        window?.rootViewController = BridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        marcarAperturaDesdeActividad(URLContexts)
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
