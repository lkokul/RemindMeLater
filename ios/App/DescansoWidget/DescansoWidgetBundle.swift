import WidgetKit
import SwiftUI
import ActivityKit

// Extension de widget que dibuja la Live Activity del descanso entre
// series: la tarjeta de la pantalla de bloqueo / centro de
// notificaciones, y las vistas de la isla dinamica (solo iPhone 14 Pro y
// posteriores -- en el resto simplemente no se usan).
//
// Este target tiene minimo iOS 16.2 (el primer iOS con la API estable de
// Live Activities), asi que aqui no hacen falta #available. En moviles
// mas viejos la extension no se carga y la app sigue funcionando igual.
//
// Lo importante: NADA de esto ejecuta codigo por segundo. Las fechas
// startAt/endAt llegan una vez y Text(timerInterval:) /
// ProgressView(timerInterval:) los mantiene el SISTEMA, con el movil
// bloqueado y la app congelada.

@main
struct DescansoWidgetBundle: WidgetBundle {
    var body: some Widget {
        DescansoLiveActivity()
    }
}

// "#rrggbb" -> Color. Es el acento del TEMA activo de la app, que viaja
// en los attributes de la actividad: asi la tarjeta sigue el estilo de la
// app (peticion de Koku).
private extension Color {
    init(hexAccent: String) {
        var hex = hexAccent
        if hex.hasPrefix("#") { hex.removeFirst() }
        var value: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&value)
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

// Tocar la tarjeta (o la isla) abre la app directamente en el entreno --
// ver marcarAperturaDesdeActividad en SceneDelegate.swift.
private let abrirEntrenoURL = URL(string: "remindmelater://gym-live")

struct DescansoLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DescansoAttributes.self) { context in
            // ----- Tarjeta de la pantalla de bloqueo (y centro de
            // notificaciones). Eleccion de Koku: cuenta atras grande +
            // barra de progreso + nombre del dia, con el acento del tema.
            let accent = Color(hexAccent: context.attributes.accentHex)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(context.attributes.dayName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("Descanso")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(accent)
                }
                HStack(alignment: .center, spacing: 10) {
                    Text(timerInterval: context.state.startAt...context.state.endAt, countsDown: true)
                        .font(.system(size: 42, weight: .bold, design: .rounded))
                        .monospacedDigit()
                    // Tiempo anadido con +30s, en otro color (como el tramo
                    // extra de la barra dentro de la app).
                    if context.state.extraSeconds > 0 {
                        Text("+\(context.state.extraSeconds)s")
                            .font(.callout.weight(.bold))
                            .foregroundStyle(.orange)
                    }
                    Spacer()
                    // El boton +30s: solo iOS 17+ (las Live Activities no
                    // admiten botones antes). Ejecuta ExtenderDescansoIntent
                    // sin desbloquear el movil.
                    if #available(iOS 17.0, *) {
                        Button(intent: ExtenderDescansoIntent()) {
                            Text("+30s")
                                .font(.callout.weight(.semibold))
                        }
                        .buttonStyle(.bordered)
                        .tint(accent)
                    }
                }
                ProgressView(timerInterval: context.state.startAt...context.state.endAt, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .tint(accent)
            }
            .padding(16)
            .widgetURL(abrirEntrenoURL)
        } dynamicIsland: { context in
            DynamicIsland {
                // Vista EXPANDIDA (dejar pulsada la isla).
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Descanso")
                            .font(.caption.weight(.semibold))
                        Text(context.attributes.dayName)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: context.state.startAt...context.state.endAt, countsDown: true)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .frame(maxWidth: 70, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 10) {
                        ProgressView(timerInterval: context.state.startAt...context.state.endAt, countsDown: true) {
                            EmptyView()
                        } currentValueLabel: {
                            EmptyView()
                        }
                        .tint(Color(hexAccent: context.attributes.accentHex))
                        if context.state.extraSeconds > 0 {
                            Text("+\(context.state.extraSeconds)s")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.orange)
                        }
                        if #available(iOS 17.0, *) {
                            Button(intent: ExtenderDescansoIntent()) {
                                Text("+30s")
                                    .font(.caption.weight(.semibold))
                            }
                            .buttonStyle(.bordered)
                            .tint(Color(hexAccent: context.attributes.accentHex))
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundStyle(Color(hexAccent: context.attributes.accentHex))
                    .widgetURL(abrirEntrenoURL)
            } compactTrailing: {
                // La cuenta atras compacta junto a la camara. El frame
                // fijo evita que la isla "respire" a cada segundo.
                Text(timerInterval: context.state.startAt...context.state.endAt, countsDown: true)
                    .monospacedDigit()
                    .frame(width: 44)
                    .widgetURL(abrirEntrenoURL)
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(Color(hexAccent: context.attributes.accentHex))
                    .widgetURL(abrirEntrenoURL)
            }
        }
    }
}
