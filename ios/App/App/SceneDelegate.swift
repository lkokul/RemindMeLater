import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

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
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
