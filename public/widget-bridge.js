// widget-bridge.js — lo que la app le cuenta al widget de iOS.
//
// EL PROBLEMA QUE RESUELVE: un widget no puede leer la base de datos.
// Nuestra base es SQLite compilado a WebAssembly y vive dentro de la
// webview, en IndexedDB; el widget es código nativo aparte que iOS
// ejecuta cuando la app ni siquiera está abierta, así que no tiene forma
// de llegar hasta ahí.
//
// La solución es un buzón compartido (App Group): la app deja un resumen
// pequeño en JSON y el widget lo lee. Este archivo es quien prepara ese
// resumen y lo manda al plugin nativo (WidgetBridgePlugin.swift).
//
// En un navegador normal el plugin no existe y todo esto es no-op, igual
// que local-notifications.js.
//
// NO HAY REFRESCO POR HORAS (decisión de Koku): el widget no se repinta
// solo, lo repinta la app cuando cambia algo. Por eso importa llamar a
// actualizarWidgetDelDia() en los sitios donde ese "algo" ocurre, que
// están marcados en app.js.

// Mismo patrón perezoso que el resto de plugins locales: se registra una
// sola vez, y no al cargar el archivo (el puente nativo puede no estar
// listo todavía).
let widgetBridgePlugin = null;
let widgetBridgeNoDisponible = false;

function getWidgetBridgePlugin() {
  if (widgetBridgePlugin) return widgetBridgePlugin;
  if (widgetBridgeNoDisponible) return null;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) {
    widgetBridgeNoDisponible = true;
    return null;
  }
  if (cap.Plugins && cap.Plugins.WidgetBridge) {
    widgetBridgePlugin = cap.Plugins.WidgetBridge;
  } else if (window.capacitorExports && typeof window.capacitorExports.registerPlugin === 'function') {
    widgetBridgePlugin = window.capacitorExports.registerPlugin('WidgetBridge');
  } else {
    widgetBridgeNoDisponible = true;
  }
  return widgetBridgePlugin;
}

// El resumen que se manda. Sale de gymCicloDeHoy() (app.js), que es la
// MISMA fuente que usa la app para decidir qué ofrecerte al entrenar --
// así el widget nunca puede decir una cosa distinta de la pantalla.
//
// Los colores viajan en hexadecimal porque el widget no tiene acceso a
// las variables CSS del tema: es SwiftUI, no la webview.
function construirResumenDelDia() {
  const vacio = {
    hayCiclo: false, esDescanso: false, nombre: '', bloque: '',
    color: '#5b8cff', icono: '', posicion: 0, total: 0, ejercicios: 0,
  };
  if (typeof gymCicloDeHoy !== 'function') return vacio;
  const hoy = gymCicloDeHoy();
  if (!hoy) return vacio;

  // Cuántos ejercicios tiene el día (solo los visibles: los ocultos no se
  // pre-cargan al entrenar, así que contarlos engañaría).
  let ejercicios = 0;
  if (hoy.rutina && Array.isArray(hoy.rutina.exercises)) {
    ejercicios = hoy.rutina.exercises.filter((ex) => !ex.hidden).length;
  }

  return {
    hayCiclo: true,
    esDescanso: !!hoy.esDescanso,
    nombre: hoy.rutina ? String(hoy.rutina.name || '') : '',
    bloque: hoy.bloque ? String(hoy.bloque.name || '') : '',
    color: hoy.rutina && hoy.rutina.color ? String(hoy.rutina.color) : gymAcentoParaElWidget(),
    icono: hoy.rutina && hoy.rutina.icon ? String(hoy.rutina.icon) : '',
    posicion: Number(hoy.position) || 0,
    total: Number(hoy.length) || 0,
    ejercicios,
  };
}

// El acento del tema activo, para cuando el día no tiene color propio.
// gymThemeColorHex ya existe en app.js (lo usa la Live Activity).
function gymAcentoParaElWidget() {
  try {
    if (typeof gymThemeColorHex === 'function') return gymThemeColorHex('--accent', '#5b8cff');
  } catch { /* si el tema no está listo, el azul de siempre */ }
  return '#5b8cff';
}

// Manda el resumen. Silenciosa a propósito: que el widget no se entere no
// es motivo para molestar a nadie ni para romper el flujo que la llamó.
async function actualizarWidgetDelDia() {
  const plugin = getWidgetBridgePlugin();
  if (!plugin) return;
  try {
    await plugin.guardarResumen({ json: JSON.stringify(construirResumenDelDia()) });
  } catch (err) {
    // Sin App Group dado de alta, el plugin responde {guardado:false} en
    // vez de lanzar; si aun así lanza, aquí se queda.
  }
}

// ¿Se ha abierto la app desde el widget (o desde el botón del centro de
// control)? Devuelve true UNA sola vez por apertura: el nativo consume la
// marca al leerla.
async function widgetPideEmpezarHoy() {
  const plugin = getWidgetBridgePlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.consumirApertura();
    return !!(res && res.empezarHoy);
  } catch {
    return false;
  }
}
