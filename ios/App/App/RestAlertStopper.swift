import Foundation
import MediaPlayer
import UserNotifications

// Callar la vibracion del fin de descanso con los MANDOS del auricular
// (peticion de Koku: "que se quite si toco el boton de pausa del
// auricular, sin que quite la musica, como hace el temporizador del
// iPhone").
//
// Por que vive en un archivo aparte y no dentro de RestAudioWatcher:
// ese se compila TAMBIEN en el target del widget, y MediaPlayer no se
// puede usar igual desde una extension. Asi que el watcher solo expone
// dos huecos (instalarParadaExtra / quitarParadaExtra) y este archivo,
// que solo se compila en la APP, los rellena. En el widget se quedan a
// nil y no pasa nada.
//
// El detalle importante: los mandos se registran SOLO durante los ~10
// segundos que dura la tanda de vibraciones, y el handler devuelve
// .commandFailed a proposito -- o sea, "yo no reproduzco nada". Lo que
// nos interesa es enterarnos de que has pulsado, no ponernos a mandar
// sobre la musica; Spotify sigue sonando.
enum RestAlertStopper {
    private static var comandos: [MPRemoteCommand] = []

    static func instalar() {
        RestAudioWatcher.instalarParadaExtra = { parar in
            let centro = MPRemoteCommandCenter.shared()
            let lista: [MPRemoteCommand] = [
                centro.togglePlayPauseCommand,
                centro.pauseCommand,
                centro.playCommand,
                centro.stopCommand,
            ]
            for comando in lista {
                _ = comando.addTarget { _ in
                    parar("mando")
                    return .commandFailed
                }
            }
            RestAlertStopper.comandos = lista
        }
        RestAudioWatcher.quitarParadaExtra = {
            for comando in RestAlertStopper.comandos { comando.removeTarget(nil) }
            RestAlertStopper.comandos = []
        }
        registrarCategoriaDelDescanso()
    }

    // Callar la vibracion al APARTAR el aviso de la pantalla (peticion de
    // Koku: "al subir la barra del banner que se quite tambien").
    //
    // Por que no bastaba con lo que ya habia: la deteccion existente
    // sondea getDeliveredNotifications, o sea que solo se entera cuando
    // el aviso desaparece DE VERDAD de la lista (quitarlo del centro de
    // notificaciones). Deslizar el banner hacia arriba NO lo quita de
    // ahi, solo lo esconde -- por eso ese gesto no callaba nada.
    //
    // La unica via que iOS ofrece para enterarse de que has apartado un
    // aviso es marcar su CATEGORIA con .customDismissAction: con esa
    // opcion, el sistema entrega al delegado la accion
    // UNNotificationDismissActionIdentifier. Aqui solo se registra la
    // categoria; el aviso que llega lo recoge el plugin de
    // notificaciones de Capacitor (que es quien tiene el delegado) y lo
    // reenvia a la web como "localNotificationActionPerformed" -- ahi lo
    // atiende gymHandleRestNotificationAction() en app.js.
    //
    // OJO con setNotificationCategories: SUSTITUYE la lista entera. Por
    // eso primero se leen las que ya haya (las que registre Capacitor) y
    // se anade la nuestra sin pisarlas.
    static let categoriaDescanso = "descanso"

    private static func registrarCategoriaDelDescanso() {
        let centro = UNUserNotificationCenter.current()
        centro.getNotificationCategories { existentes in
            // Tipo explicito: Set.filter devuelve un Set, pero dejarlo
            // escrito evita que el compilador tenga que deducirlo.
            var lista: Set<UNNotificationCategory> = existentes.filter { $0.identifier != RestAlertStopper.categoriaDescanso }
            lista.insert(UNNotificationCategory(
                identifier: RestAlertStopper.categoriaDescanso,
                actions: [],
                intentIdentifiers: [],
                options: [.customDismissAction]
            ))
            centro.setNotificationCategories(lista)
        }
    }
}
