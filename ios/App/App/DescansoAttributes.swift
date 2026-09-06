import Foundation
#if canImport(ActivityKit)
import ActivityKit

// La "forma" de la Live Activity del descanso entre series. Este archivo
// se compila DOS veces (en la app y en el widget DescansoWidget): ambos
// lados tienen que ver exactamente la misma estructura para que iOS los
// conecte, y compartir el archivo es la manera de que no se desincronicen.
//
// El truco que hace que todo funcione sin que la app este despierta:
// startAt/endAt son fechas, y el widget pinta la cuenta atras y la barra
// con Text(timerInterval:)/ProgressView(timerInterval:), que el SISTEMA
// actualiza solo cada segundo. La app solo habla con la actividad al
// empezar el descanso, al sumarle 30s y al terminarlo.
@available(iOS 16.2, *)
struct DescansoAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var startAt: Date
        var endAt: Date
    }

    // Nombre del dia de entreno ("Torso", "Sesion libre"...): fijo
    // durante toda la actividad, por eso va en attributes y no en state.
    var dayName: String
}
#endif
