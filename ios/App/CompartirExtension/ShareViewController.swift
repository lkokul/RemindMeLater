// CompartirExtension — la entrada de RemindMeLater en la hoja de
// compartir de iOS. Al elegir la app en el menu Compartir de cualquier
// otra app (un mensaje, una web...), esto recoge el texto compartido y
// abre la app principal con el (via el esquema de URL
// remindmelater://share?text=...). La app, al recibirlo, detecta la
// fecha/hora en el texto y abre el modal de evento nuevo ya rellenado
// (ver public/share-import.js).
//
// Sin ninguna interfaz propia a proposito: no hay nada que preguntar
// aqui — todo (revisar el titulo, cambiar la hora, elegir grupo) se
// hace en el modal de la app, que es donde ya estan esos controles.
import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        procesarLoCompartido()
    }

    private func procesarLoCompartido() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let providers = item.attachments, !providers.isEmpty else {
            terminar()
            return
        }

        // Primero texto plano (el caso normal: un mensaje seleccionado);
        // si no hay, una URL (compartir una pagina web) — su direccion
        // sirve igual como texto del que sacar el titulo.
        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] (data, _) in
                let texto = (data as? String) ?? ""
                DispatchQueue.main.async { self?.abrirApp(conTexto: texto) }
            }
            return
        }
        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] (data, _) in
                let texto = (data as? URL)?.absoluteString ?? ""
                DispatchQueue.main.async { self?.abrirApp(conTexto: texto) }
            }
            return
        }
        terminar()
    }

    private func abrirApp(conTexto texto: String) {
        let recortado = String(texto.prefix(1500)) // una URL no aguanta textos kilometricos
        var comps = URLComponents()
        comps.scheme = "remindmelater"
        comps.host = "share"
        comps.queryItems = [URLQueryItem(name: "text", value: recortado)]
        if let url = comps.url {
            abrirURL(url)
        }
        terminar()
    }

    // Una extension de compartir no puede llamar a UIApplication.open()
    // directamente (Apple lo reserva a la app principal). El camino
    // establecido es subir por la cadena de responders hasta dar con el
    // objeto de la aplicacion, que si sabe abrir URLs — es el mismo
    // truco que usan muchas apps con extension de compartir.
    private func abrirURL(_ url: URL) {
        let selector = NSSelectorFromString("openURL:")
        var responder: UIResponder? = self as UIResponder
        while let actual = responder {
            if actual.responds(to: selector), !(actual is UIViewController) {
                actual.perform(selector, with: url)
                return
            }
            responder = actual.next
        }
    }

    private func terminar() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
