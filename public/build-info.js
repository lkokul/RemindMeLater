// EL NUMERO DE COMPILACION, escrito por el workflow justo antes de
// empaquetar la app (.github/workflows/ios-testflight.yml).
//
// En el repositorio esta a null a proposito: sirviendo public/ como
// estatico (o abriendo la app en un navegador) no hay ninguna
// compilacion detras, asi que no hay numero que enseñar y la linea de
// version se queda como siempre.
//
// Es el MISMO numero que el de TestFlight (GITHUB_RUN_NUMBER, ver
// CURRENT_PROJECT_VERSION en el workflow), que es justo lo que hace falta
// para poder decir "esto me pasa en la build 63".
window.APP_BUILD = null;
