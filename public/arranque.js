// ARRANQUE: lo que tiene que pasar ANTES de pintar nada.
//
// Vivia en un <script> en linea dentro de index.html. Se saco a un archivo
// propio al poner la Content-Security-Policy: la CSP no lleva
// 'unsafe-inline' en script-src (que es justo lo que mata un onerror=
// inyectado), asi que un script en linea quedaria bloqueado. Un <script
// src> normal en el <head> es igual de sincrono y bloqueante, o sea que
// sigue ejecutandose antes de la primera pintura: el efecto es identico y
// no hace falta relajar la CSP.
//
// No se le pueden meter dependencias: se ejecuta antes que todo lo demas.

  // Aplica el tema que este dispositivo tuviera guardado ANTES de que se
  // pinte nada, para no ver un parpadeo del tema oscuro por defecto y
  // luego el tuyo. settings.js hace despues la comprobacion "de verdad"
  // desde la base local; esto es solo para que la primera pintura ya
  // salga con tus colores.
  (function () {
    try {
      var cached = localStorage.getItem('activeThemeColors');
      if (!cached) return;
      var colors = JSON.parse(cached);
      var root = document.documentElement;
      var map = {
        bg: '--bg', bgText: '--bg-text',
        surface: '--surface', surfaceText: '--surface-text',
        surface2: '--surface-2', surface2Text: '--surface-2-text',
        border: '--border',
        accent: '--accent', accentText: '--accent-text',
        danger: '--danger',
        settingsMenuBg: '--settings-menu-bg', settingsMenuText: '--settings-menu-text',
        dayToday: '--day-today', dayTodayText: '--day-today-text',
        dayWeekend: '--day-weekend', dayHoliday: '--day-holiday', daySpecial: '--day-special',
      };
      // Si la cache es de antes de que cada fondo tuviera su propio color
      // de contraste (formato viejo, con "text"/"textDim" globales), o de
      // una variante inversa a la que le falta algun dato, rellenamos con
      // el mismo patron de "heredar de la superficie mas parecida DE ESTE
      // MISMO tema" que usa sanitizeColors() en themes.js — asi un tema
      // incompleto no se queda con contraste del tema oscuro por defecto
      // aunque el resto sea claro.
      if (!colors.settingsMenuBg) colors.settingsMenuBg = colors.surface2;
      if (!colors.bgText) colors.bgText = colors.text;
      if (!colors.surfaceText) colors.surfaceText = colors.surfaceText || colors.bgText || colors.text;
      if (!colors.surface2Text) colors.surface2Text = colors.surface2Text || colors.surfaceText || colors.text;
      if (!colors.settingsMenuText) colors.settingsMenuText = colors.settingsMenuText || colors.surface2Text || colors.text;
      if (!colors.accentText) colors.accentText = colors.accentText || '#ffffff';
      if (!colors.dayTodayText) colors.dayTodayText = colors.dayTodayText || colors.accentText || '#ffffff';
      Object.keys(map).forEach(function (key) {
        if (colors[key]) root.style.setProperty(map[key], colors[key]);
      });
    } catch (e) {
      // Si algo falla, nos quedamos con los colores por defecto del CSS.
    }

    // Estilo de interaccion (Neon/Directo/Cristal, ver Configuracion >
    // Estilo): igual que el tema de color, se aplica antes de pintar para
    // que no haya un parpadeo. "directo" es el valor por defecto si
    // todavia no has elegido ninguno.
    try {
      document.documentElement.dataset.uiStyle = localStorage.getItem('uiStylePreference') || 'directo';
    } catch (e) {
      document.documentElement.dataset.uiStyle = 'directo';
    }

    // Interruptor de animaciones (Configuracion > Este dispositivo). Va
    // AQUI, antes de pintar, por el mismo motivo que el tema: si se
    // pusiera mas tarde, con el interruptor apagado se llegaria a ver un
    // trozo de animacion antes de que el atributo llegase. Marca el
    // <html> con data-animations="off" y de eso se encarga UNA regla
    // global de styles.css que apaga TODAS las animaciones y
    // transiciones de la app de golpe (ver applyAnimationsPreference()
    // en app.js).
    try {
      if (localStorage.getItem('animationsEnabled') === 'false') {
        document.documentElement.dataset.animations = 'off';
      }
    } catch (e) { /* sin localStorage, animaciones encendidas */ }
  })();
