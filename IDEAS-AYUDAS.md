# Botones "?" pendientes de decidir

Documento de trabajo para Koku: marca los que quieras y se hacen. No es
documentación del proyecto, es una lista para decidir.

**El patrón ya existe** y es el que se usaría en todos: un botón
redondo con `?` al lado del título o de la opción
(`class="icon-btn settings-help-btn"`), que abre un diálogo propio de la
app con `showAppAlert()`. Si el texto es largo, un modal aparte con
casilla de "no volver a mostrar" (como el del mapa de músculos del
Gimnasio).

Dónde está ya puesto hoy: las seis opciones de Configuración →
Notificaciones, y dos en Gimnasio (el entreno en vivo y el mapa de
músculos de Progreso).

---

## Los que yo pondría seguro

- [ ] **1. Los gestos de deslizar** — es lo menos adivinable de toda la
  app: que los bordes cambian de pestaña y el centro hace lo de cada
  pantalla. Propuesta: aviso la primera vez con "no volver a mostrar",
  más un "?" fijo en Configuración → Este dispositivo.
- [ ] **2. Copia de seguridad** — que no hay sincronización, que la
  copia es la única forma de pasar datos a otro aparato, y que importar
  **sustituye** todo lo que haya.
- [ ] **3. Notas ocultas** — que la contraseña **no es cifrado real**,
  solo evita que se lea a primera vista.
- [ ] **4. Temas de color** — el borrador en vivo: editar aplica al
  instante, cambiar de tema guarda el anterior solo, y salir de la
  sección también guarda.
- [ ] **5. Gestos del calendario** — deslizar en vertical cambia de
  mes/año (en el año va invertido a propósito, lo pediste así) y
  pellizcar sube de nivel.

## Los que dudo — dime sí o no

- [ ] **6. "Agrupar con flechas"** (Configuración → Vista). Es el ajuste
  más enrevesado de la app: las secciones que marcas se juntan en un
  hueco con flechas, las que no, se quedan sueltas.
- [ ] **7. Modo de Mi espacio** (Configuración → Vista): al lado del
  calendario, o a pantalla completa desde un botón.
- [ ] **8. Variante clara/oscura (◐)** y el botón ☀/☾ de la barra.
- [ ] **9. "Copiar estilo de otro dispositivo"**.
- [ ] **10. Notas: borrar una carpeta NO borra su contenido** — las
  notas y subcarpetas suben un nivel.
- [ ] **11. Notas: deslizar una fila** para Editar / Mover / Eliminar.
- [ ] **12. Editor de notas: los botones +Fila/-Fila/+Col/-Col** que
  salen al poner el cursor dentro de una tabla.
- [ ] **13. Editor de notas: quitar una imagen de una nota no libera el
  archivo** (limitación conocida y aceptada).
- [ ] **14. Finanzas: el saldo siempre se calcula**, nunca se guarda; y
  borrar una cuenta con historial se rechaza a propósito.
- [ ] **15. Finanzas: cuándo se generan los gastos fijos** (al abrir la
  app, no a una hora fija).
- [ ] **16. Viajes: enlazar un movimiento** con una transacción real de
  Finanzas.
- [ ] **17. Calendario: tareas vs. eventos** — por qué una tarea se ve
  con el borde en vez de rellena, y el color de "completada".
- [ ] **18. Calendario: los tres modos de densidad** del mes
  (Compacto / Apilado / Listado).
- [ ] **19. Eventos de varios días** — por qué los días de en medio
  salen arriba como "todo el día" y el último con su hora de fin.

## Los que NO pondría

Ya tienen un texto de ayuda debajo que lo dice todo; un "?" ahí sería
ruido:

- Gimnasio: unidad de peso y formato de tiempo.
- Barra inferior (qué herramienta va en el segundo hueco).
- Favoritos en Notas.
- Estilo de interacción.
- Animaciones.

---

## Aparte: los modales

Quedó en el aire si los diálogos (evento, tarea, carpeta, ejercicio...)
deberían cerrarse con un gesto. Lo normal en móvil es **deslizar hacia
abajo**, no hacia el lado. Dijiste que le darías una vuelta.

- [ ] Cerrar modales deslizando hacia abajo.
