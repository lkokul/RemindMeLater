import Foundation
import UIKit
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
    private static let claveResumen = "resumenApp"
    private static let claveEmpezarHoy = "gymPendingStartToday"
    // Dónde deja SceneDelegate el destino cuando abres la app desde
    // cualquiera de los widgets nuevos. Es una cadena y no un booleano
    // por widget: con cinco widgets y cuatro botones de centro de
    // control, una marca por cada uno serían nueve claves que consumir.
    private static let claveDestino = "widgetPendingDestino"

    // Los "kind" de TODOS los widgets. Tienen que coincidir carácter a
    // carácter con los `static let kind` de cada Widget: si uno no
    // coincide, la app cree que lo refresca y ese widget se queda con lo
    // de antes hasta que iOS decida repintarlo por su cuenta.
    private static let kinds = [
        "QueTocaHoyWidget", "TareasWidget",
        "FinanzasWidget", "LecturasWidget", "ViajesWidget",
        "CalendarioWidget", "ConsistenciaWidget", "HeatmapWidget",
        "EstadisticasWidget", "MusculosWidget",
    ]

    // AVISAR AL JAVASCRIPT DE QUE VUELVE A HABER QUE MIRAR EL BUZÓN.
    //
    // El agujero que encontró Koku: "me gustaría saber si los botones del
    // panel de control sólo funcionan cuando la app está cerrada o en
    // segundo plano. Porque si no, cuando está en primer plano no
    // funcionan correctamente". Y tenía razón, y la causa es esta:
    //
    // Con la app YA DELANTE, abrir el centro de control no la manda a
    // segundo plano -- solo la deja "inactiva" con la cortinilla encima.
    // Al cerrarse esa cortinilla no llega NI `resume` NI
    // `visibilitychange` a la webview, que son los dos únicos avisos que
    // tenía el JavaScript para ir a mirar si hay una marca pendiente. O
    // sea que el botón sí escribía el destino, pero nadie iba a leerlo
    // hasta la siguiente vez que salieras y volvieras a entrar en la app.
    //
    // `didBecomeActiveNotification` SÍ llega en ese caso (es justo la
    // transición inactivo -> activo), así que es la señal que faltaba.
    // Se manda como evento del plugin y el JavaScript lo escucha; no se
    // consume nada aquí, solo se avisa -- quien decide sigue siendo
    // comprobarAperturaDesdeElWidget() en app.js, para que haya un único
    // sitio que navegue.
    override public func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(laAppVuelveAEstarActiva),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    @objc private func laAppVuelveAEstarActiva() {
        notifyListeners("revisarApertura", data: [:])
    }

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
        // Uno por uno y no reloadAllTimelines() para no despertar también
        // la Live Activity del descanso, que no tiene nada que ver con
        // esto y está en la misma extensión.
        for kind in Self.kinds {
            WidgetCenter.shared.reloadTimelines(ofKind: kind)
        }
        call.resolve(["guardado": true])
    }

    // ¿Se ha abierto la app desde el widget? Se mira en los DOS sitios
    // porque hay dos caminos distintos:
    //  - Tocar el widget (inicio o bloqueo) abre remindmelater://gym-hoy,
    //    y SceneDelegate deja la marca en UserDefaults.standard.
    //  - El botón del centro de control ejecuta un AppIntent nuestro
    //    (AbrirDesdeControl.swift) que apunta el destino a mano en LOS
    //    DOS almacenes -- el suyo y el App Group -- porque ese intent
    //    corre en el proceso de la EXTENSIÓN, y el UserDefaults.standard
    //    de la extensión no es el de la app. El App Group es el único
    //    terreno común de los dos. (Tercer intento; los dos anteriores,
    //    y por qué fallaron, están en CLAUDE.md.)
    // Se consumen las dos (se ponen a false) para que no vuelva a saltar
    // en la siguiente vuelta a primer plano.
    @objc func consumirApertura(_ call: CAPPluginCall) {
        var empezarHoy = false
        var destino = ""

        let propios = UserDefaults.standard
        if propios.bool(forKey: Self.claveEmpezarHoy) {
            empezarHoy = true
            propios.set(false, forKey: Self.claveEmpezarHoy)
        }
        if let d = propios.string(forKey: Self.claveDestino), !d.isEmpty {
            destino = d
            propios.removeObject(forKey: Self.claveDestino)
        }

        // El App Group: es POR AQUÍ por donde llega de verdad el botón
        // del centro de control (ver arriba). Se consume igual que el
        // propio, y con el mismo cuidado: la marca se borra en cuanto se
        // lee, para que no vuelva a saltar en la siguiente vuelta.
        if let compartidos = UserDefaults(suiteName: Self.grupo) {
            if compartidos.bool(forKey: Self.claveEmpezarHoy) {
                empezarHoy = true
                compartidos.set(false, forKey: Self.claveEmpezarHoy)
            }
            if let d = compartidos.string(forKey: Self.claveDestino), !d.isEmpty {
                if destino.isEmpty { destino = d }
                compartidos.removeObject(forKey: Self.claveDestino)
            }
        }

        // "gym-hoy" gana si están las dos marcas: arrancar un entreno es
        // más específico que abrir una pantalla, y quien tocó el widget
        // del Gimnasio quiere entrenar.
        if empezarHoy { destino = "gym-hoy" }

        call.resolve(["empezarHoy": empezarHoy, "destino": destino])
    }
}
