import Foundation
import MediaPlayer

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
    }
}
