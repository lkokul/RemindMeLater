import Foundation
import Capacitor
import WidgetKit

// Puente entre el JavaScript y los widgets. Es un plugin LOCAL, sin
// paquete npm, registrado a mano en BridgeViewController.capacitorDidLoad()
// -- igual que LiveActivityPlugin, y con la misma lección detrás: sin ese
// registro el proxy de JS existe pero cada llamada responde "not
// implemented".
//
// POR QUÉ HACE FALTA ESTO: un widget no puede leer la base de datos de la
// app (SQLite en WebAssembly, dentro de la webview, en IndexedDB). Es un
// proceso nativo aparte que corre con la app cerrada. El único terreno
// común es un App Group: un buzón compartido entre la app y la extensión.
// Aquí la app deja un resumen pequeño en JSON, y QueTocaHoyWidget.swift
// lo lee.
//
// El App Group es una CAPACIDAD DE FIRMA, no solo código: los dos targets
// llevan su .entitlements declarándolo, y el App ID de Apple tiene que
// tenerla dada de alta. Si no lo está, UserDefaults(suiteName:) devuelve
// nil -- por eso todo aquí responde con {guardado:false} en vez de
// romperse: la app funciona igual, simplemente el widget no se entera.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "guardarResumen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumirApertura", returnType: CAPPluginReturnPromise)
    ]

    // Tienen que coincidir CARÁCTER A CARÁCTER con los de
    // QueTocaHoyWidget.swift. Están repetidos a propósito en vez de en un
    // archivo compartido: son tres constantes que no van a cambiar, y
    // compartir un archivo entre los dos targets complica el proyecto de
    // Xcode más de lo que ahorra.
    private static let grupo = "group.com.koku.remindmelater"
    private static let claveResumen = "resumenGimnasio"
    private static let claveEmpezarHoy = "gymPendingStartToday"

    // Guarda el resumen y pide a iOS que repinte el widget. El JSON llega
    // ya montado desde JavaScript: aquí no se interpreta, solo se guarda
    // -- así añadir un campo nuevo al resumen no obliga a tocar nada
    // nativo ni a recompilar para que la app lo mande.
    @objc func guardarResumen(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Falta json")
            return
        }
        guard let defaults = UserDefaults(suiteName: Self.grupo) else {
            // Sin App Group (capacidad no dada de alta en el App ID).
            call.resolve(["guardado": false, "motivo": "sin_grupo"])
            return
        }
        defaults.set(json, forKey: Self.claveResumen)
        // ofKind: y no reloadAllTimelines() para no despertar también la
        // Live Activity del descanso, que no tiene nada que ver con esto.
        WidgetCenter.shared.reloadTimelines(ofKind: "QueTocaHoyWidget")
        call.resolve(["guardado": true])
    }

    // ¿Se ha abierto la app desde el widget? Se mira en los DOS sitios
    // porque hay dos caminos distintos:
    //  - Tocar el widget (inicio o bloqueo) abre remindmelater://gym-hoy,
    //    y SceneDelegate deja la marca en UserDefaults.standard.
    //  - El botón del centro de control ejecuta un AppIntent que NO manda
    //    ninguna URL, así que deja la marca en el App Group.
    // Se consumen las dos (se ponen a false) para que no vuelva a saltar
    // en la siguiente vuelta a primer plano.
    @objc func consumirApertura(_ call: CAPPluginCall) {
        var empezarHoy = false

        let propios = UserDefaults.standard
        if propios.bool(forKey: Self.claveEmpezarHoy) {
            empezarHoy = true
            propios.set(false, forKey: Self.claveEmpezarHoy)
        }

        if let compartidos = UserDefaults(suiteName: Self.grupo),
           compartidos.bool(forKey: Self.claveEmpezarHoy) {
            empezarHoy = true
            compartidos.set(false, forKey: Self.claveEmpezarHoy)
        }

        call.resolve(["empezarHoy": empezarHoy])
    }
}
