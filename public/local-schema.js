// local-schema.js — el esquema de la base, portado tal cual del
// servidor.
//
// Es una copia LITERAL del bloque de esquema y migraciones de
// server/db.js (33 tablas con CREATE TABLE IF NOT EXISTS, 42
// migraciones condicionales con PRAGMA table_info + ALTER TABLE, la
// fusion de temas antiguos y la siembra de los temas por defecto),
// envuelta en una funcion que recibe el `db` local (ver local-db.js,
// que imita la API de node:sqlite) en vez de abrir una base de Node.
//
// Se copia en vez de reescribirse a proposito: son ~1.100 lineas de SQL
// ya probado, y cualquier reescritura a mano solo podria introducir
// erratas. Lo unico que hacia falta comprobar era que no dependiera de
// nada de Node -- y no lo hace: su unica llamada externa es
// crypto.randomUUID(), que existe igual en el navegador.
//
// Si algun dia cambia el esquema del servidor, este archivo hay que
// volver a generarlo de la misma forma (mismo tramo de server/db.js).
function applyLocalSchema(db) {
  // --- Esquema -----------------------------------------------------------
  // Se ejecuta cada vez que arranca el servidor; CREATE TABLE IF NOT EXISTS
  // hace que sea seguro repetirlo (no borra nada si la tabla ya existe).
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      start_at TEXT NOT NULL,           -- fecha/hora ISO, ej. 2026-08-14T10:00:00
      end_at TEXT,                      -- puede ser NULL si no hay hora de fin
      all_day INTEGER NOT NULL DEFAULT 0,
      reminder_minutes_before INTEGER,  -- NULL = sin recordatorio
      reminder_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      paired_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#5b8cff',   -- hex, ej. #ff6b6b
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Biblioteca de temas de estilo, compartida entre todos los dispositivos.
    -- "colors" guarda un JSON con las 8 variables personalizables, ej.
    -- {"bg":"#0f1115","surface":"#171a21", ...}. Cada dispositivo elige por
    -- su cuenta cual de estos temas mostrar (ver devices.active_theme_id y
    -- app_settings mas abajo), asi que guardar uno no fuerza a nada mas.
    CREATE TABLE IF NOT EXISTS themes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      colors TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Almacen generico clave/valor para ajustes del "ordenador anfitrion"
    -- (el que corre el servidor y no pasa por el flujo de emparejamiento,
    -- asi que no tiene una fila en devices). De momento solo guardamos que
    -- tema tiene activo, pero sirve para cualquier ajuste futuro de ese tipo.
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Tu perfil: una sola fila (id fijo a 1). "name" es el nickname que
    -- eliges y puedes cambiar cuando quieras; "public_id" es un identificador
    -- estable que se genera UNA vez y no cambia, para poder diferenciarte si
    -- algun dia hay mas de una persona usando el calendario (o un origen
    -- automatico, tipo una integracion de WhatsApp) aunque compartan nombre.
    -- Se muestra oculto por defecto en la interfaz (ver Configuracion > Perfil).
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT '',
      public_id TEXT NOT NULL
    );

    -- Dias marcados a mano como festivo o especial (no hay forma de saber
    -- festivos automaticamente, asi que se marcan uno a uno desde el
    -- panel de dia). "date" en formato YYYY-MM-DD; compartido entre todos
    -- los dispositivos, como los grupos o los temas.
    CREATE TABLE IF NOT EXISTS special_days (
      date TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('holiday', 'special'))
    );

    -- Notas de "Mi espacio" (Fase 2): titulo + contenido, compartidas
    -- entre todos los dispositivos igual que eventos/tareas/grupos. Desde
    -- la Fase 4 el contenido puede llevar formato basico (negrita, cursiva,
    -- listas) como HTML saneado -- ver la migracion de body_format mas
    -- abajo y routes/notes.js.
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT,
      created_by_name TEXT,
      created_by_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Carpetas de notas (Fase 3): nombre + icono + color, sistema propio
    -- SEPARADO de los Grupos del calendario (esos son para eventos/tareas,
    -- estas son solo para organizar notas dentro de Mi espacio). Solo
    -- organizacion, sin PIN ni bloqueo -- eso es "ocultar" por nota
    -- individual (ver notes.hidden), un toggle simple sin contraseña.
    CREATE TABLE IF NOT EXISTS note_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT NOT NULL DEFAULT '#5b8cff',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Registro de cambios para la sincronizacion movil-ordenador (fase
    -- "movil"): cada vez que se crea/edita/borra algo en events, notes,
    -- groups, note_folders o special_days, se anade UNA fila aqui (ver
    -- recordSyncChange() mas abajo). El propio "id" de esta tabla hace de
    -- cursor -- un dispositivo recuerda "el ultimo id que ya vi" y pide
    -- "todo lo que tenga id mayor que ese" (routes/sync.js). "payload" es
    -- el mismo JSON que ya devuelve la ruta REST normal para esa fila (o
    -- NULL si op='delete': un borrado no tiene contenido, solo hace falta
    -- saber que paso). Es una tabla que solo CRECE (nunca se edita una
    -- fila ya escrita), asi que sirve tanto de historial como de cursor.
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
      payload TEXT,
      device_origin TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Extension "Gimnasio" (primera de las 3 anunciadas en la pantalla de
    -- Extensiones -- ver #extensions-view en index.html): registro de
    -- entrenamientos, con prefijo "gym_" para no chocar con nada de lo de
    -- arriba. Borrado en cascada A MANO en routes/, no con ON DELETE
    -- CASCADE de SQL -- mismo patron que groups/note_folders.
    --
    -- OJO (rediseno de Gimnasio, rama gimnasio-movil): a partir de aqui
    -- las tablas gym_* DIVERGEN de server/db.js (la copia del programa de
    -- escritorio). gym_blocks y las columnas nuevas de las otras tablas
    -- gym_* existen SOLO en esta version; cuando algun dia se fusionen
    -- las dos lineas habra que decidir que se lleva cada lado.
    CREATE TABLE IF NOT EXISTS gym_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      -- Grupo muscular: los ejercicios nuevos guardan un id de la
      -- taxonomia fija (GYM_MUSCLE_GROUPS en app.js, ej. "pecho"); los
      -- de antes del rediseno pueden traer texto libre (ej. "Pierna"),
      -- que se muestra tal cual hasta que se reediten.
      muscle_group TEXT,
      -- Si el ejercicio se importo de la libreria empaquetada
      -- (gym-exercise-library.json), aqui va su id de alli (slug tipo
      -- "Barbell_Squat") -- sirve para no importar dos veces el mismo.
      library_id TEXT,
      equipment TEXT,             -- opcional (ej. "Barra", "Mancuernas")
      -- Grupos musculares SECUNDARIOS (JSON array de ids de la
      -- taxonomia, ej. '["hombros","triceps"]') -- los rellena el import
      -- de la libreria y los usa el mapa de musculos (ponderados a 0.5).
      secondary_muscles TEXT,
      -- Nota FIJA del ejercicio ("polea altura 3", "banco posicion 2"):
      -- acompana siempre al ejercicio, a diferencia de la nota de sesion
      -- (exercise_notes en gym_sessions, que es de UNA sesion concreta).
      notes TEXT,
      -- Unilateral (un lado cada vez: mancuerna a una mano, prensa a una
      -- pierna...). Si ademas count_sides_separately = 1, cada lado se
      -- registra como su propia serie (gym_sets.side), y entre lado y
      -- lado corre un descanso corto propio (side_rest_seconds).
      unilateral INTEGER NOT NULL DEFAULT 0,
      count_sides_separately INTEGER NOT NULL DEFAULT 0,
      side_rest_seconds INTEGER,
      -- Configuracion POR DEFECTO del ejercicio (peticion de Koku): las
      -- series, repeticiones y descanso que sueles hacer con el. Al
      -- meterlo en un dia, esos tres campos llegan ya rellenos y no hay
      -- que escribirlos otra vez.
      --
      -- Ojo, son un PUNTO DE PARTIDA, no la verdad: lo que manda en un
      -- dia concreto sigue siendo lo que hay en gym_routine_exercises,
      -- que se puede cambiar ahi (5x5 el lunes y 3x12 el jueves con el
      -- mismo ejercicio). Y cambiar esto NO toca los dias que ya lo
      -- tenian metido -- decision de Koku, para que editar un ejercicio
      -- nunca te cambie un plan por sorpresa.
      default_sets INTEGER,
      default_reps INTEGER,
      default_rest_seconds INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Bloques de entrenamiento (rediseno de Gimnasio): una "etapa" con
    -- nombre propio (ej. "Volumen Invierno") que agrupa varios dias de
    -- entrenamiento (los gym_routines de abajo). Solo UN bloque puede
    -- estar activo a la vez (is_active = 1) -- es el que se ofrece al
    -- empezar a entrenar. El borrado en cascada de sus dias se hace a
    -- mano en routes-local/gymBlocks.js, como en todo el proyecto.
    CREATE TABLE IF NOT EXISTS gym_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Dias de entrenamiento reutilizables (ej. "Push 1", "Dia de pierna"),
    -- mismo patron icono+color+posicion que groups/note_folders. La tabla
    -- se sigue llamando gym_routines por compatibilidad con los datos ya
    -- guardados, pero en la interfaz del rediseno son los "dias" de un
    -- bloque (block_id). block_id puede ser NULL solo de forma transitoria:
    -- la migracion de mas abajo recoloca cualquier huerfano en el bloque
    -- "General".
    CREATE TABLE IF NOT EXISTS gym_routines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT NOT NULL DEFAULT '#5b8cff',
      position INTEGER NOT NULL DEFAULT 0,
      block_id INTEGER REFERENCES gym_blocks(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Que ejercicios lleva cada rutina, en que orden, con series/repeticiones
    -- ORIENTATIVAS (target_sets/target_reps, opcionales -- solo una sugerencia,
    -- lo que de verdad se hizo se registra en gym_sets al completar la sesion).
    CREATE TABLE IF NOT EXISTS gym_routine_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      routine_id INTEGER NOT NULL REFERENCES gym_routines(id),
      exercise_id INTEGER NOT NULL REFERENCES gym_exercises(id),
      position INTEGER NOT NULL DEFAULT 0,
      target_sets INTEGER,
      target_reps INTEGER,
      -- Descanso por defecto (segundos) entre series de ESTE ejercicio
      -- dentro de la rutina -- solo una sugerencia, igual que target_sets/
      -- target_reps; se copia como punto de partida a cada serie al crear
      -- una sesion desde esta rutina, y se puede cambiar libremente ahi.
      target_rest_seconds INTEGER,
      -- Oculto: el ejercicio sigue EN el dia (no se ha borrado), pero un
      -- entrenamiento nuevo no lo pre-carga -- para "aparcar" un ejercicio
      -- mientras se prueba otro (peticion de Koku). En el entreno en vivo
      -- se puede recuperar desde "Ejercicios ocultos".
      hidden INTEGER NOT NULL DEFAULT 0
    );

    -- Una sesion real en una fecha. routine_id es opcional: NULL = sesion
    -- libre (ejercicios sueltos elegidos sobre la marcha, sin plantilla).
    CREATE TABLE IF NOT EXISTS gym_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,                             -- YYYY-MM-DD
      routine_id INTEGER REFERENCES gym_routines(id),
      notes TEXT,
      -- Fase 3 (modo entrenar en vivo): cuando la sesion se registro
      -- entrenando en directo, aqui quedan la hora de inicio (ISO) y la
      -- duracion total en segundos; NULL en sesiones apuntadas a mano.
      started_at TEXT,
      duration_seconds INTEGER,
      -- Nota libre POR EJERCICIO de esa sesion ("subir peso la proxima",
      -- "molestia en el hombro"...): JSON {exerciseId: "texto"}. Es un
      -- dato puramente de presentacion, por eso va como JSON en una
      -- columna en vez de montar una tabla y rutas nuevas solo para esto.
      exercise_notes TEXT,
      -- Fase 4 (actividad rapida): una fila de gym_sessions puede ser un
      -- entrenamiento de pesas de siempre (type = 'gym', con sus series
      -- en gym_sets) o una actividad suelta sin series -- cardio, clase,
      -- deporte (type = 'activity', con activity_kind + activity_name y
      -- la duracion en duration_seconds). Comparte tabla a proposito:
      -- heatmap, racha y logros necesitan UNA sola fuente de "dias con
      -- actividad".
      type TEXT NOT NULL DEFAULT 'gym',
      activity_kind TEXT,
      activity_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cada serie registrada de verdad dentro de una sesion. weight_kg
    -- SIEMPRE se guarda en kilogramos -- la libra (ajuste por dispositivo,
    -- ver settings.js) es solo de entrada/presentacion en el cliente, para
    -- que las graficas de progreso comparen siempre la misma unidad.
    CREATE TABLE IF NOT EXISTS gym_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES gym_sessions(id),
      exercise_id INTEGER NOT NULL REFERENCES gym_exercises(id),
      set_number INTEGER NOT NULL,
      reps INTEGER,
      weight_kg REAL,
      -- Descanso de verdad tras esta serie (segundos), opcional -- nace del
      -- target_rest_seconds de la rutina al auto-rellenar la sesion (ver
      -- app.js), pero se guarda por serie porque se puede editar suelto.
      rest_seconds INTEGER,
      -- Fase 3: esfuerzo percibido de la serie (RPE, 1-10 con decimales,
      -- opcional) y tipo de serie (NULL = normal; 'warmup'/'dropset'/
      -- 'failure' reservados -- el calculo de PRs excluye warmup).
      rpe REAL,
      set_type TEXT,
      -- Segundos de descanso EXTRA anadidos con +30s durante el descanso
      -- de esta serie (rest_seconds guarda el planificado). Se ensena en
      -- el historial como "Serie 1: +60s" (peticion de Koku).
      extra_rest_seconds INTEGER,
      -- Cuanto DURO la serie en si (del boton "empezar serie" al
      -- "terminar serie" del entreno en vivo, descontando pausas). NULL
      -- en series apuntadas a mano o de versiones anteriores.
      duration_seconds INTEGER,
      -- Lado del cuerpo en ejercicios unilaterales contados por separado:
      -- 'left' / 'right' (NULL = serie normal, a dos lados).
      side TEXT,
      -- Nota de ESTA serie ("se me fue el codo"): al acabar el ejercicio
      -- se combinan todas en la nota del ejercicio de la sesion.
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Extension "Finanzas" (tercera tarjeta de #extensions-view): gastos,
    -- ingresos e inversiones. "initial_balance" es el saldo de partida al
    -- empezar a trackear esta cuenta -- el saldo de verdad NUNCA se guarda,
    -- se calcula sumando/restando finanzas_transactions y
    -- finanzas_investment_transactions de esa cuenta (ver
    -- routes/finanzasAccounts.js).
    CREATE TABLE IF NOT EXISTS finanzas_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT NOT NULL DEFAULT '#5b8cff',
      initial_balance REAL NOT NULL DEFAULT 0,
      -- Puramente informativa (ej. "Corriente", "Inversion") -- sin CHECK
      -- que la limite a una lista cerrada, para poder anadir un tipo nuevo
      -- el dia de mañana solo tocando el select en app.js, sin migracion.
      -- NO restringe en que movimiento se puede usar la cuenta.
      type TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Categorias de GASTO (no de ingreso), mismo patron icono+color que
    -- groups/note_folders -- las crea Koku, no hay lista fija.
    CREATE TABLE IF NOT EXISTS finanzas_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT NOT NULL DEFAULT '#5b8cff',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Gastos e ingresos normales de una cuenta. "amount" siempre positivo,
    -- el signo lo da "type". "counts_toward_budget" es el flag que pidio
    -- Koku ("si aplica o no sobre este gasto maximo") -- solo tiene
    -- sentido cuando type='expense', se ignora en ingresos.
    CREATE TABLE IF NOT EXISTS finanzas_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES finanzas_accounts(id),
      type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      category_id INTEGER REFERENCES finanzas_categories(id),
      counts_toward_budget INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Plantillas de gasto fijo recurrente: a diferencia del checkbox
    -- "Gasto fijo" (finanzas_transactions.is_fixed, marcado a mano en un
    -- movimiento suelto), esto SI genera la transaccion real sola, cada
    -- vez que toca (ver server/finanzasRecurringChecker.js). "day_of_month"
    -- se usa siempre (1-31, clampado al ultimo dia real de cada mes si
    -- hace falta -- ej. dia 31 en febrero); "month_of_year" (1-12) solo
    -- aplica si frequency='annual'. "end_date" es el "ultimo mes de pago"
    -- que pidio Koku -- NULL significa que sigue indefinidamente.
    -- "last_generated_period" guarda el periodo YA generado ('YYYY-MM' en
    -- mensual, 'YYYY' en anual) para no duplicar y para no rellenar hacia
    -- atras si el servidor estuvo apagado varios periodos.
    CREATE TABLE IF NOT EXISTS finanzas_recurring_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES finanzas_accounts(id),
      category_id INTEGER REFERENCES finanzas_categories(id),
      amount REAL NOT NULL,
      description TEXT,
      frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'annual')),
      day_of_month INTEGER NOT NULL,
      month_of_year INTEGER,
      start_date TEXT NOT NULL,
      end_date TEXT,
      counts_toward_budget INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      last_generated_period TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Compra/venta de un activo y dividendos recibidos. Solo registro
    -- MANUAL a proposito -- sin conectar a ninguna API externa de
    -- cotizaciones en vivo (confirmado con Koku, coherente con que el
    -- resto de la app es local-first). "asset_name" es texto libre (no
    -- una tabla de activos aparte, ej. "Apple (AAPL)"). quantity/
    -- price_per_unit son NULL en dividendos -- "amount" siempre lleva el
    -- total (quantity*price_per_unit en compra/venta, lo recibido en
    -- dividendo), para no tener que recalcularlo cada vez que se lee.
    CREATE TABLE IF NOT EXISTS finanzas_investment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES finanzas_accounts(id),
      asset_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'dividend')),
      quantity REAL,
      price_per_unit REAL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Limite de gasto mensual: una sola fila (igual que user_profile), sin
    -- historizar limites anteriores -- si lo cambias, aplica desde ese
    -- momento para cualquier calculo de "mes actual".
    CREATE TABLE IF NOT EXISTS finanzas_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      monthly_budget_limit REAL
    );

    -- Carteras de inversion, anidadas -- calco de note_folders (mismo
    -- parent_id auto-referenciado, mismas comprobaciones de ciclo en
    -- routes/finanzasPortfolios.js) pero SIN icono, mismo criterio que ya
    -- se aplico a note_folders (el icono generico de carpeta ya diferencia
    -- bien, no hacia falta elegir uno por carpeta). parent_id NULL =
    -- cartera de nivel raiz.
    CREATE TABLE IF NOT EXISTS finanzas_portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#5b8cff',
      position INTEGER NOT NULL DEFAULT 0,
      parent_id INTEGER REFERENCES finanzas_portfolios(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Activos como entidad real (antes de esta ronda, finanzas_investment_transactions.asset_name
    -- era solo texto libre sin identidad propia -- ver migracion mas abajo
    -- que crea una fila aqui por cada asset_name distinto ya usado).
    -- portfolio_id NULL = activo sin cartera asignada (nivel raiz del
    -- arbol de seleccion de la grafica de Inversiones).
    CREATE TABLE IF NOT EXISTS finanzas_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      portfolio_id INTEGER REFERENCES finanzas_portfolios(id),
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Actualizaciones MANUALES de precio de un activo, para llevar su
    -- evolucion en el tiempo -- sin conectar a ninguna cotizacion en vivo
    -- (mismo criterio que finanzas_investment_transactions: registro
    -- manual a proposito, "tendra su error pero es para mi"). Solo
    -- precio/unidad + fecha -- la cantidad NO se guarda aqui, ya se puede
    -- calcular de las transacciones de compra/venta si hiciera falta.
    CREATE TABLE IF NOT EXISTS finanzas_asset_valuations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL REFERENCES finanzas_assets(id),
      date TEXT NOT NULL,
      price_per_unit REAL NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Deudas de Finanzas: lo que Koku debe a alguien y lo que alguien le
    -- debe a el, en una unica tabla con "direction" para distinguirlas
    -- (mismo criterio que finanzas_transactions con "type"). account_id es
    -- OPCIONAL (confirmado con Koku): si se liga una deuda a una cuenta,
    -- marcarla como pagada genera un movimiento real en
    -- finanzas_transactions (gasto si direction='owed_by_me', ingreso si
    -- 'owed_to_me') -- transaction_id guarda cual, para poder borrarlo si
    -- se desmarca como pagada o se borra la deuda entera. Sin cuenta
    -- ligada, marcar como pagada solo cambia el booleano, es pura lista de
    -- seguimiento. "date" (cuando se genero la deuda) es opcional, tal
    -- como pidio Koku.
    CREATE TABLE IF NOT EXISTS finanzas_debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL CHECK (direction IN ('owed_by_me', 'owed_to_me')),
      person TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      date TEXT,
      account_id INTEGER REFERENCES finanzas_accounts(id),
      paid INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      transaction_id INTEGER REFERENCES finanzas_transactions(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Extension "Lecturas" (tercera tarjeta de #extensions-view): historial
    -- de entretenimiento en general, no solo libros -- manga, comic, libro,
    -- serie, anime, pelicula. Una "saga" es el contenedor OBLIGATORIO de
    -- todo (hasta algo suelto es una saga de un solo item), para poder
    -- agrupar bajo un mismo nombre cosas de tipos distintos (ej. el manga Y
    -- el anime de la misma obra) en vez de repetir el nombre en cada fila.
    CREATE TABLE IF NOT EXISTS lecturas_sagas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cada cosa concreta dentro de una saga (una temporada, un tomo, una
    -- pelicula suelta...). "genres" es un array JSON de texto libre (ej.
    -- ["Accion","Fantasia"]) en vez de una tabla de generos aparte -- mismo
    -- criterio que ya usa el proyecto para themes.colors, no hace falta
    -- normalizarlo para el volumen de una coleccion personal. "status"
    -- cubre tambien la lista de deseos (wishlist = todavia no lo tienes/no
    -- has empezado), sin una seccion aparte. "owned_count/owned_total" es
    -- una cantidad simple ("tengo 5 de 10"), sin marcar cuales exactamente.
    CREATE TABLE IF NOT EXISTS lecturas_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      saga_id INTEGER NOT NULL REFERENCES lecturas_sagas(id),
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('manga','comic','libro','serie','anime','pelicula')),
      description TEXT,
      rating REAL,
      status TEXT NOT NULL DEFAULT 'wishlist' CHECK (status IN ('wishlist','in_progress','completed','dropped')),
      genres TEXT,
      progress_current INTEGER,
      progress_total INTEGER,
      progress_unit TEXT,
      owned_count INTEGER,
      owned_total INTEGER,
      position INTEGER NOT NULL DEFAULT 0,
      -- Prestado a alguien: "loaned" es el interruptor (desmarcarlo = ya no
      -- esta prestado / te lo devolvieron, sin guardar una fecha de
      -- devolucion aparte -- Koku solo pidio saber a quien y desde cuando).
      loaned INTEGER NOT NULL DEFAULT 0,
      loaned_to TEXT,
      loaned_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Extension "Viajes" (avion en #extensions-view): un viaje puede tocar
    -- VARIOS paises (ej. un interrail), de ahi la tabla de union
    -- viajes_trip_countries en vez de una columna "country" directa en
    -- viajes_trips. country_code es el codigo ISO 3166-1 alfa-2 en
    -- minusculas (mismo formato que los "id" del mapa SVG en
    -- public/viajes-world-map.svg, normalizados a minuscula en el cliente
    -- -- el SVG en si los trae en mayusculas). Sin CHECK contra una lista
    -- cerrada de paises a proposito: el selector del cliente ya limita a
    -- los paises reales del mapa, y ser permisivo aqui evita tener que
    -- tocar el servidor si el mapa cambia de fuente el dia de mañana (como
    -- ya ha pasado una vez).
    CREATE TABLE IF NOT EXISTS viajes_trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#5b8cff',
      start_date TEXT,
      end_date TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS viajes_trip_countries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES viajes_trips(id),
      country_code TEXT NOT NULL,
      UNIQUE(trip_id, country_code)
    );

    -- Una entrada de "bitacora" = un dia (o momento) concreto dentro de un
    -- viaje. Contenido en texto plano simple (sin el editor de bloques/
    -- formato de Notas -- eso es otra pieza aparte del proyecto), de sobra
    -- para "que se ha hecho ese dia".
    CREATE TABLE IF NOT EXISTS viajes_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES viajes_trips(id),
      date TEXT NOT NULL,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Fotos dentro de una entrada -- mismo patron que note_images (nombre
    -- de archivo UUID en disco, ver routes/viajesEntries.js), guardadas en
    -- DATA_DIR/viajes-photos/. "amount" es opcional: si se rellena, este
    -- adjunto es un ticket/recibo (no una foto de recuerdo cualquiera), y
    -- puede enlazarse a un movimiento real de Finanzas
    -- (finanzas_transaction_id) SOLO si el ajuste global
    -- app_settings.viajesFinanzasLinked esta activado. Borrar el adjunto
    -- borra tambien el movimiento de Finanzas enlazado si lo tenia -- es
    -- "ese ticket concreto", no una plantilla que genera cosas por su
    -- cuenta (a diferencia de finanzas_recurring_expenses, que SI deja
    -- huerfanas sus transacciones generadas al borrarse la plantilla).
    CREATE TABLE IF NOT EXISTS viajes_entry_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES viajes_entries(id),
      filename TEXT NOT NULL,
      amount REAL,
      finanzas_transaction_id INTEGER REFERENCES finanzas_transactions(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Un movimiento (gasto o ingreso) dentro de una entrada de bitacora --
    -- tabla APARTE de viajes_entry_attachments a proposito: una foto y un
    -- movimiento son cosas distintas (no toda foto es un ticket, no todo
    -- gasto lleva foto), y en SQLite habria hecho falta reconstruir la
    -- tabla entera para volver "filename" opcional. "amount"/
    -- "finanzas_transaction_id" de viajes_entry_attachments quedan sin
    -- usar a partir de aqui (nunca se borran columnas en este proyecto) --
    -- ver la migracion de backfill mas abajo en este archivo, que traslada
    -- los tickets ya existentes a esta tabla nueva.
    CREATE TABLE IF NOT EXISTS viajes_entry_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES viajes_entries(id),
      type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
      amount REAL NOT NULL,
      description TEXT,
      counts_toward_budget INTEGER NOT NULL DEFAULT 1,
      attachment_id INTEGER REFERENCES viajes_entry_attachments(id),
      finanzas_transaction_id INTEGER REFERENCES finanzas_transactions(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migracion sencilla: group_id y active_theme_id se anadieron despues de
  // crear las tablas events/devices en versiones anteriores. SQLite no
  // tiene "ADD COLUMN IF NOT EXISTS", asi que miramos el esquema actual
  // (pragma table_info) y solo la anadimos si todavia no existe. Esto hace
  // seguro re-arrancar el servidor tanto en una base de datos nueva como
  // en una ya existente de antes.
  const eventColumns = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  if (!eventColumns.includes('group_id')) {
    db.exec('ALTER TABLE events ADD COLUMN group_id INTEGER REFERENCES groups(id)');
  }

  const deviceColumns = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
  if (!deviceColumns.includes('active_theme_id')) {
    db.exec('ALTER TABLE devices ADD COLUMN active_theme_id INTEGER REFERENCES themes(id)');
  }
  if (!deviceColumns.includes('icon')) {
    // Simbolo o emoji que se muestra JUNTO al nombre del dispositivo, no
    // como parte del nombre (por eso es su propia columna).
    db.exec('ALTER TABLE devices ADD COLUMN icon TEXT');
  }

  const groupColumns = db.prepare('PRAGMA table_info(groups)').all().map((c) => c.name);
  if (!groupColumns.includes('icon')) {
    db.exec('ALTER TABLE groups ADD COLUMN icon TEXT');
  }
  // completed_color: color opcional que usan las TAREAS de este grupo (ver
  // mas abajo) cuando se marcan como hechas, en vez del color normal del
  // grupo. Si se deja sin poner (NULL), la interfaz calcula un tono
  // atenuado del color normal del grupo como valor por defecto — esta
  // columna solo guarda un color EXPLICITO cuando lo has elegido tu.
  if (!groupColumns.includes('completed_color')) {
    db.exec('ALTER TABLE groups ADD COLUMN completed_color TEXT');
  }

  // created_by_*: quien (que nickname/perfil) creo cada evento. Se rellena
  // solo al crear el evento (ver routes/events.js), con el perfil de
  // user_profile en ese momento — asi que si luego cambias tu nickname, los
  // eventos antiguos se quedan con el nombre que tenian cuando se crearon,
  // como una "foto" de ese momento, no un enlace en vivo.
  if (!eventColumns.includes('created_by_name')) {
    db.exec('ALTER TABLE events ADD COLUMN created_by_name TEXT');
  }
  if (!eventColumns.includes('created_by_id')) {
    db.exec('ALTER TABLE events ADD COLUMN created_by_id TEXT');
  }

  // is_task / done: una tarea es, por dentro, una fila de events con
  // is_task = 1. Comparte titulo, grupo, etc. con los eventos normales, pero
  // ademas puede marcarse como hecha (done) y, a diferencia de un evento,
  // puede no tener fecha (ver la migracion de start_at mas abajo).
  const eventColumnsForTasks = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  if (!eventColumnsForTasks.includes('is_task')) {
    db.exec('ALTER TABLE events ADD COLUMN is_task INTEGER NOT NULL DEFAULT 0');
  }
  if (!eventColumnsForTasks.includes('done')) {
    db.exec('ALTER TABLE events ADD COLUMN done INTEGER NOT NULL DEFAULT 0');
  }

  // Migracion puntual: start_at pasa de obligatorio a opcional, porque las
  // tareas sueltas (sin fecha limite) no tienen que llevar ninguna — solo
  // viven en la lista de Tareas, no en el calendario. SQLite no permite
  // quitar un NOT NULL con un simple ALTER TABLE, asi que reconstruimos la
  // tabla entera: la copia nueva con el esquema correcto, se copian las
  // filas, se borra la vieja y se renombra la nueva. Se detecta si hace
  // falta mirando el "notnull" que da PRAGMA table_info para start_at; una
  // vez hecha, table_info ya no lo marca como NOT NULL y esto no se repite.
  const startAtInfo = db.prepare('PRAGMA table_info(events)').all().find((c) => c.name === 'start_at');
  if (startAtInfo && startAtInfo.notnull) {
    db.exec(`
      CREATE TABLE events_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        location TEXT,
        start_at TEXT,
        end_at TEXT,
        all_day INTEGER NOT NULL DEFAULT 0,
        reminder_minutes_before INTEGER,
        reminder_sent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        group_id INTEGER REFERENCES groups(id),
        created_by_name TEXT,
        created_by_id TEXT,
        is_task INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO events_new (id, title, description, location, start_at, end_at, all_day, reminder_minutes_before, reminder_sent, created_at, updated_at, group_id, created_by_name, created_by_id, is_task, done)
        SELECT id, title, description, location, start_at, end_at, all_day, reminder_minutes_before, reminder_sent, created_at, updated_at, group_id, created_by_name, created_by_id, is_task, done FROM events;
      DROP TABLE events;
      ALTER TABLE events_new RENAME TO events;
    `);
  }

  // inverse_colors: variante clara/oscura "pareja" de un tema, opcional. Ver
  // routes/themes.js para el saneado y routes/... para como se elige cual
  // de las dos ensenar (modo sistema/claro/oscuro, ajuste de cada dispositivo).
  const themeColumns = db.prepare('PRAGMA table_info(themes)').all().map((c) => c.name);
  if (!themeColumns.includes('inverse_colors')) {
    db.exec('ALTER TABLE themes ADD COLUMN inverse_colors TEXT');
  }
  // updated_at: para sincronizar la biblioteca de temas al movil (fase
  // "movil") -- no existia hasta ahora. Mismo patron que groups/note_folders
  // mas arriba: se anade sin default (ALTER TABLE no admite datetime('now')
  // como default) y se rellena con un UPDATE aparte.
  if (!themeColumns.includes('updated_at')) {
    db.exec('ALTER TABLE themes ADD COLUMN updated_at TEXT');
    db.exec("UPDATE themes SET updated_at = created_at WHERE updated_at IS NULL");
  }

  // hidden: nota marcada como "ocultar" (se ve borrosa en la lista hasta
  // que se "destapa" con un clic — ver routes/notes.js). No es un bloqueo
  // de verdad, solo evita que se lea a primera vista. Hubo una version con
  // contraseña compartida opcional para destapar (app_settings
  // notes_hide_password_*), pero se quito -- ver la limpieza de esas
  // claves mas abajo.
  const noteColumns = db.prepare('PRAGMA table_info(notes)').all().map((c) => c.name);
  if (!noteColumns.includes('hidden')) {
    db.exec('ALTER TABLE notes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
  }
  // folder_id: carpeta de la nota (Fase 3), opcional -- NULL = sin
  // carpeta (nivel raiz). Ver note_folders arriba.
  if (!noteColumns.includes('folder_id')) {
    db.exec('ALTER TABLE notes ADD COLUMN folder_id INTEGER REFERENCES note_folders(id)');
  }

  // parent_id: las carpetas pueden contener otras carpetas (navegacion
  // tipo explorador de archivos, ver routes/noteFolders.js) -- NULL =
  // carpeta de nivel raiz. La comprobacion de que no se formen ciclos (una
  // carpeta como su propio antepasado) se hace en routes/noteFolders.js,
  // no aqui: SQLite no tiene forma sencilla de expresarlo en el esquema.
  const noteFolderColumns = db.prepare('PRAGMA table_info(note_folders)').all().map((c) => c.name);
  if (!noteFolderColumns.includes('parent_id')) {
    db.exec('ALTER TABLE note_folders ADD COLUMN parent_id INTEGER REFERENCES note_folders(id)');
  }

  // favorite: nota o carpeta marcada como favorita, para que aparezca
  // primero en su listado (ver renderNotesView en app.js). Igual que
  // "hidden", es un simple 0/1 por fila, sin tabla aparte.
  if (!noteColumns.includes('favorite')) {
    db.exec('ALTER TABLE notes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
  }
  if (!noteFolderColumns.includes('favorite')) {
    db.exec('ALTER TABLE note_folders ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
  }

  // body_format (Fase 4 -- editor de notas con formato): 'text' = nota de
  // antes de la Fase 4, "body" es texto plano tal cual. 'html' = nota
  // creada o editada con el editor nuevo, "body" es HTML ya saneado (ver
  // sanitizeNoteBody en routes/notes.js). Se guarda explicitamente en vez
  // de adivinarlo mirando el contenido para no confundir una nota vieja
  // que por casualidad tenga un "<" o un "&" con HTML de verdad -- ver
  // openNoteModal en app.js, que usa este campo para decidir si hace falta
  // convertir saltos de linea/caracteres especiales antes de mostrarla en
  // el editor con formato.
  if (!noteColumns.includes('body_format')) {
    db.exec("ALTER TABLE notes ADD COLUMN body_format TEXT NOT NULL DEFAULT 'text'");
  }

  // updated_at para sincronizacion (fase "movil"): groups y note_folders
  // solo tenian created_at hasta ahora. SQLite no deja poner
  // datetime('now') como DEFAULT al anadir una columna con ALTER TABLE
  // (solo admite constantes), asi que se anade SIN default y se rellena
  // aparte con un UPDATE -- a partir de aqui, cada PUT de estas rutas
  // tiene que poner updated_at = datetime('now') a mano, igual que ya
  // hacen events/notes (ver routes/groups.js y routes/noteFolders.js).
  if (!groupColumns.includes('updated_at')) {
    db.exec('ALTER TABLE groups ADD COLUMN updated_at TEXT');
    db.exec("UPDATE groups SET updated_at = created_at WHERE updated_at IS NULL");
  }
  if (!noteFolderColumns.includes('updated_at')) {
    db.exec('ALTER TABLE note_folders ADD COLUMN updated_at TEXT');
    db.exec("UPDATE note_folders SET updated_at = created_at WHERE updated_at IS NULL");
  }

  // special_days no tenia ningun timestamp (su clave es la propia fecha
  // marcada, no un id). Para poder sincronizar hacen falta los dos, igual
  // que en el resto de tablas.
  const specialDayColumns = db.prepare('PRAGMA table_info(special_days)').all().map((c) => c.name);
  if (!specialDayColumns.includes('created_at')) {
    db.exec('ALTER TABLE special_days ADD COLUMN created_at TEXT');
    db.exec("UPDATE special_days SET created_at = datetime('now') WHERE created_at IS NULL");
  }
  if (!specialDayColumns.includes('updated_at')) {
    db.exec('ALTER TABLE special_days ADD COLUMN updated_at TEXT');
    db.exec("UPDATE special_days SET updated_at = datetime('now') WHERE updated_at IS NULL");
  }

  // last_sync_seq: hasta que fila de sync_log ha traido ya este
  // dispositivo emparejado (ver routes/sync.js) -- 0 significa "todavia
  // no ha sincronizado nada, mandale el historial completo".
  if (!deviceColumns.includes('last_sync_seq')) {
    db.exec('ALTER TABLE devices ADD COLUMN last_sync_seq INTEGER NOT NULL DEFAULT 0');
  }

  // Limpieza: se quito la opcion de contraseña compartida para destapar
  // notas ocultas (routes/notesSecurity.js ya no existe) -- si quedaban
  // estas claves de una instalacion anterior, se borran para no dejar
  // datos huerfanos sin usar.
  db.prepare("DELETE FROM app_settings WHERE key IN ('notes_hide_password_enabled', 'notes_hide_password_hash')").run();

  // push_subscription: el objeto que da el navegador al suscribirse a
  // notificaciones push (endpoint + claves p256dh/auth), como JSON. NULL
  // si ese dispositivo nunca se ha suscrito o desactivo el ajuste. Ver
  // routes/devices.js (guardarlo) y server/push.js + reminderChecker.js
  // (usarlo para mandar el aviso).
  if (!deviceColumns.includes('push_subscription')) {
    db.exec('ALTER TABLE devices ADD COLUMN push_subscription TEXT');
  }

  // email: para el "primer arranque" (pantalla de bienvenida) y, sobre
  // todo, como contacto tecnico obligatorio del protocolo Web Push
  // (VAPID) al mandar notificaciones push -- ver server/push.js. Nunca se
  // muestra en la interfaz ni se manda a nadie salvo a Google/Apple para
  // ese uso puntual. Opcional a proposito: sin el, simplemente no se
  // pueden activar las notificaciones push (ver routes/devices.js).
  const profileColumns = db.prepare('PRAGMA table_info(user_profile)').all().map((c) => c.name);
  if (!profileColumns.includes('email')) {
    db.exec('ALTER TABLE user_profile ADD COLUMN email TEXT');
  }

  // El perfil siempre tiene que existir (para poder firmar "creado por" en
  // los eventos desde el primer arranque). El public_id se genera una sola
  // vez aqui y ya no se vuelve a tocar.
  const hasProfile = db.prepare('SELECT 1 FROM user_profile WHERE id = 1').get();
  if (!hasProfile) {
    db.prepare('INSERT INTO user_profile (id, name, public_id) VALUES (1, ?, ?)').run(
      '',
      crypto.randomUUID()
    );
  }

  // is_salary/is_fixed (objetivo de ahorro): marcar un ingreso como
  // "salario" o un gasto como "fijo" es lo que usa el aviso de si el
  // objetivo de ahorro es realista (ver routes/finanzasSettings.js) --
  // solo tiene sentido el que aplica segun "type", el otro se queda
  // siempre en 0.
  const finanzasTransactionColumns = db.prepare('PRAGMA table_info(finanzas_transactions)').all().map((c) => c.name);
  if (!finanzasTransactionColumns.includes('is_salary')) {
    db.exec('ALTER TABLE finanzas_transactions ADD COLUMN is_salary INTEGER NOT NULL DEFAULT 0');
  }
  if (!finanzasTransactionColumns.includes('is_fixed')) {
    db.exec('ALTER TABLE finanzas_transactions ADD COLUMN is_fixed INTEGER NOT NULL DEFAULT 0');
  }

  // recurring_expense_id: enlaza una transaccion generada AUTOMATICAMENTE
  // con la plantilla que la creo (ver finanzas_recurring_expenses mas
  // arriba y server/finanzasRecurringChecker.js) -- nullable, ya que la
  // inmensa mayoria de transacciones se siguen creando a mano. La
  // transaccion generada es independiente de verdad: editarla o borrarla
  // no toca la plantilla ni afecta a las proximas generaciones (pedido
  // explicito de Koku con el ejemplo de "sube el precio de Netflix").
  if (!finanzasTransactionColumns.includes('recurring_expense_id')) {
    db.exec('ALTER TABLE finanzas_transactions ADD COLUMN recurring_expense_id INTEGER REFERENCES finanzas_recurring_expenses(id)');
  }

  // savings_goal_min: objetivo MINIMO de ahorro mensual (sin maximo --
  // Koku dijo explicitamente que ahorrar de mas nunca es un problema).
  const finanzasSettingsColumns = db.prepare('PRAGMA table_info(finanzas_settings)').all().map((c) => c.name);
  if (!finanzasSettingsColumns.includes('savings_goal_min')) {
    db.exec('ALTER TABLE finanzas_settings ADD COLUMN savings_goal_min REAL');
  }

  // counts_toward_budget en inversiones: igual que en gastos normales,
  // pero aqui empieza DESACTIVADA por defecto (0) -- invertir no se
  // trataba como "gasto" en el resto de la app hasta esta ronda, y solo
  // tiene sentido marcarlo en una Compra (ver routes/finanzasInvestments.js).
  const finanzasInvestmentColumns = db.prepare('PRAGMA table_info(finanzas_investment_transactions)').all().map((c) => c.name);
  if (!finanzasInvestmentColumns.includes('counts_toward_budget')) {
    db.exec('ALTER TABLE finanzas_investment_transactions ADD COLUMN counts_toward_budget INTEGER NOT NULL DEFAULT 0');
  }

  // asset_id: referencia a la entidad real finanzas_assets (Ronda
  // "Carteras de inversion"). asset_name se CONSERVA -- este proyecto
  // nunca hace DROP COLUMN -- pero pasa de ser la fuente de verdad a ser
  // una cache desnormalizada que se sigue escribiendo en cada
  // INSERT/UPDATE con el nombre ACTUAL del activo (ver
  // routes/finanzasInvestments.js), por si asset_id quedara huerfano
  // algun dia. Backfill: cada asset_name distinto ya usado se convierte en
  // una fila de finanzas_assets (sin cartera, portfolio_id NULL), y las
  // transacciones que coincidan por nombre se enlazan por asset_id.
  if (!finanzasInvestmentColumns.includes('asset_id')) {
    db.exec('ALTER TABLE finanzas_investment_transactions ADD COLUMN asset_id INTEGER REFERENCES finanzas_assets(id)');

    const distinctNames = db
      .prepare('SELECT DISTINCT asset_name FROM finanzas_investment_transactions WHERE asset_name IS NOT NULL')
      .all();
    const insertAsset = db.prepare('INSERT INTO finanzas_assets (name, portfolio_id, position) VALUES (?, NULL, 0)');
    const linkTransactions = db.prepare('UPDATE finanzas_investment_transactions SET asset_id = ? WHERE asset_name = ?');
    distinctNames.forEach(({ asset_name }) => {
      const info = insertAsset.run(asset_name);
      linkTransactions.run(info.lastInsertRowid, asset_name);
    });
  }

  // Igual que el perfil: el limite mensual de Finanzas es una sola fila
  // que siempre tiene que existir, para no tener que comprobar "y si no
  // existe todavia" en cada ruta que lo lee.
  const hasFinanzasSettings = db.prepare('SELECT 1 FROM finanzas_settings WHERE id = 1').get();
  if (!hasFinanzasSettings) {
    db.prepare('INSERT INTO finanzas_settings (id, monthly_budget_limit) VALUES (1, NULL)').run();
  }

  // Migracion puntual: en versiones anteriores el tema oscuro y el claro de
  // partida eran DOS temas sueltos ("Oscuro (por defecto)" y "Claro"), asi
  // que el interruptor Sistema/Claro/Oscuro no tenia nada que alternar en
  // ninguno de los dos. Aqui se fusionan en uno solo ("Predeterminado") con
  // variante inversa, reutilizando el id del oscuro (para que quien ya lo
  // tuviera activo no se quede sin tema) y redirigiendo a quien tuviera
  // "Claro" activo hacia el fusionado. Solo hace falta una vez: si ya existe
  // "Predeterminado" (instalacion nueva, o esta migracion ya corrio antes),
  // no hace nada.
  const yaFusionado = db.prepare('SELECT 1 FROM themes WHERE name = ?').get('Predeterminado');
  if (!yaFusionado) {
    const oscuroLegado = db.prepare('SELECT * FROM themes WHERE name = ?').get('Oscuro (por defecto)');
    const claroLegado = db.prepare('SELECT * FROM themes WHERE name = ?').get('Claro');
    if (oscuroLegado && claroLegado) {
      db.prepare('UPDATE themes SET name = ?, inverse_colors = ? WHERE id = ?').run(
        'Predeterminado',
        claroLegado.colors,
        oscuroLegado.id
      );
      db.prepare('UPDATE devices SET active_theme_id = ? WHERE active_theme_id = ?').run(
        oscuroLegado.id,
        claroLegado.id
      );
      db.prepare("UPDATE app_settings SET value = ? WHERE key = 'host_active_theme_id' AND value = ?").run(
        String(oscuroLegado.id),
        String(claroLegado.id)
      );
      db.prepare('DELETE FROM themes WHERE id = ?').run(claroLegado.id);
    }
  }

  // Migracion puntual: los temas se guardaban con un "texto principal" y un
  // "texto secundario" GLOBALES (claves text/textDim), compartidos por toda
  // la app sin importar sobre que fondo cayeran — eso es precisamente lo que
  // causaba el bug de contraste (un texto pensado para un fondo se aplicaba
  // tambien sobre otro fondo distinto del mismo tema). Ahora cada fondo real
  // (bg, surface, surface2, settingsMenuBg, accent, dayToday) lleva su propio
  // color de contraste. Aqui se migra cualquier tema guardado en el formato
  // viejo (tiene "text" pero no "bgText") copiando ese texto global a los
  // nuevos campos — es un punto de partida razonable, editable a mano
  // despues desde Configuracion. Idempotente: una vez migrado ya tiene
  // "bgText" y esta funcion lo deja tal cual.
  function migrateLegacyTextColors(colorsJson) {
    if (!colorsJson) return colorsJson;
    let colors;
    try {
      colors = JSON.parse(colorsJson);
    } catch {
      return colorsJson;
    }
    if (!colors || typeof colors !== 'object' || colors.bgText || !colors.text) return colorsJson;

    colors.bgText = colors.text;
    colors.surfaceText = colors.text;
    colors.surface2Text = colors.text;
    colors.settingsMenuText = colors.text;
    colors.accentText = colors.accentText || '#ffffff';
    colors.dayTodayText = colors.dayTodayText || '#ffffff';
    return JSON.stringify(colors);
  }

  const themeRowsToMigrate = db.prepare('SELECT id, colors, inverse_colors FROM themes').all();
  const updateThemeColors = db.prepare('UPDATE themes SET colors = ?, inverse_colors = ? WHERE id = ?');
  for (const row of themeRowsToMigrate) {
    const migratedColors = migrateLegacyTextColors(row.colors);
    const migratedInverse = migrateLegacyTextColors(row.inverse_colors);
    if (migratedColors !== row.colors || migratedInverse !== row.inverse_colors) {
      updateThemeColors.run(migratedColors, migratedInverse, row.id);
    }
  }

  // Semilla de temas de partida. Se comprueba UNO A UNO por nombre (no solo
  // "si la tabla esta vacia") para poder anadir temas nuevos en versiones
  // futuras — como Pastel y Neon aqui — sin duplicar los que ya tenga
  // alguien que actualiza una base de datos existente, y sin tocar temas
  // propios que se hayan creado a mano.
  const SEED_THEMES = [
    {
      name: 'Predeterminado',
      colors: {
        bg: '#0f1115',
        bgText: '#e8eaed',
        surface: '#171a21',
        surfaceText: '#e8eaed',
        surface2: '#1f232c',
        surface2Text: '#e8eaed',
        border: '#2a2f3a',
        accent: '#5b8cff',
        accentText: '#ffffff',
        danger: '#ff6b6b',
        settingsMenuBg: '#1f232c',
        settingsMenuText: '#e8eaed',
        dayToday: '#5b8cff',
        dayTodayText: '#ffffff',
        dayWeekend: '#1a1d27',
        dayHoliday: '#3a2020',
        daySpecial: '#2a1f3a',
      },
      inverseColors: {
        bg: '#f5f6f8',
        bgText: '#1a1d23',
        surface: '#ffffff',
        surfaceText: '#1a1d23',
        surface2: '#eef0f3',
        surface2Text: '#1a1d23',
        border: '#dfe3e8',
        accent: '#5b8cff',
        accentText: '#ffffff',
        danger: '#e0455b',
        settingsMenuBg: '#eef0f3',
        settingsMenuText: '#1a1d23',
        dayToday: '#5b8cff',
        dayTodayText: '#ffffff',
        dayWeekend: '#e8edfb',
        dayHoliday: '#fbeaea',
        daySpecial: '#f1eafc',
      },
    },
    {
      name: 'Pastel',
      colors: {
        bg: '#faf3f7',
        bgText: '#4a3b46',
        surface: '#ffffff',
        surfaceText: '#4a3b46',
        surface2: '#f3e6ef',
        surface2Text: '#4a3b46',
        border: '#e6d3e0',
        accent: '#f2a6c6',
        accentText: '#4a3b46',
        danger: '#e8909a',
        settingsMenuBg: '#f3e6ef',
        settingsMenuText: '#4a3b46',
        dayToday: '#f2a6c6',
        dayTodayText: '#4a3b46',
        dayWeekend: '#f0e6f5',
        dayHoliday: '#fbdfe0',
        daySpecial: '#e4e0fb',
      },
      inverseColors: {
        bg: '#231a20',
        bgText: '#f6e6ef',
        surface: '#2d222a',
        surfaceText: '#f6e6ef',
        surface2: '#3a2c36',
        surface2Text: '#f6e6ef',
        border: '#4d3b47',
        accent: '#f2a6c6',
        accentText: '#2b1a22',
        danger: '#e8909a',
        settingsMenuBg: '#3a2c36',
        settingsMenuText: '#f6e6ef',
        dayToday: '#f2a6c6',
        dayTodayText: '#2b1a22',
        dayWeekend: '#31252d',
        dayHoliday: '#3d2224',
        daySpecial: '#2a2440',
      },
    },
    {
      name: 'Neón',
      colors: {
        bg: '#0a0a12',
        bgText: '#e6e6ff',
        surface: '#12121e',
        surfaceText: '#e6e6ff',
        surface2: '#1a1a2e',
        surface2Text: '#e6e6ff',
        border: '#2d2d44',
        accent: '#00f0ff',
        accentText: '#0a0a12',
        danger: '#ff2079',
        settingsMenuBg: '#1a1a2e',
        settingsMenuText: '#e6e6ff',
        dayToday: '#00f0ff',
        dayTodayText: '#0a0a12',
        dayWeekend: '#14142a',
        dayHoliday: '#2a1020',
        daySpecial: '#10202a',
      },
      inverseColors: {
        bg: '#f4f4fb',
        bgText: '#14142a',
        surface: '#ffffff',
        surfaceText: '#14142a',
        surface2: '#e9e9f7',
        surface2Text: '#14142a',
        border: '#d3d3ec',
        accent: '#0090a0',
        accentText: '#ffffff',
        danger: '#c4145a',
        settingsMenuBg: '#e9e9f7',
        settingsMenuText: '#14142a',
        dayToday: '#0090a0',
        dayTodayText: '#ffffff',
        dayWeekend: '#eaeaf7',
        dayHoliday: '#fbe6ee',
        daySpecial: '#e4f2f6',
      },
    },
    // "Océano": azules profundos, el mas "de noche" de los frios. Con pareja clara y
    // oscura, asi que sigue el modo del sistema si lo tienes puesto.
    {
      name: 'Océano',
      colors: {
        bg: '#0b1622',
        bgText: '#e2edf7',
        surface: '#12202f',
        surfaceText: '#e2edf7',
        surface2: '#1a2c3e',
        surface2Text: '#e2edf7',
        border: '#263c52',
        accent: '#3fa9f5',
        accentText: '#04121d',
        danger: '#ff6b6b',
        settingsMenuBg: '#1a2c3e',
        settingsMenuText: '#e2edf7',
        dayToday: '#3fa9f5',
        dayTodayText: '#04121d',
        dayWeekend: '#132435',
        dayHoliday: '#33201f',
        daySpecial: '#1b2647',
      },
      inverseColors: {
        bg: '#f2f7fc',
        bgText: '#0e2233',
        surface: '#ffffff',
        surfaceText: '#0e2233',
        surface2: '#e6eff7',
        surface2Text: '#0e2233',
        border: '#cfe0ee',
        accent: '#0a6fb5',
        accentText: '#ffffff',
        danger: '#c62828',
        settingsMenuBg: '#e6eff7',
        settingsMenuText: '#0e2233',
        dayToday: '#0a6fb5',
        dayTodayText: '#ffffff',
        dayWeekend: '#e4eff8',
        dayHoliday: '#fbeaea',
        daySpecial: '#e7ecfa',
      },
    },
    // "Bosque": verdes apagados, descansa la vista. Con pareja clara y
    // oscura, asi que sigue el modo del sistema si lo tienes puesto.
    {
      name: 'Bosque',
      colors: {
        bg: '#0d1712',
        bgText: '#e4f0e7',
        surface: '#14211b',
        surfaceText: '#e4f0e7',
        surface2: '#1c2c24',
        surface2Text: '#e4f0e7',
        border: '#294034',
        accent: '#4caf7d',
        accentText: '#06150e',
        danger: '#ef6b5e',
        settingsMenuBg: '#1c2c24',
        settingsMenuText: '#e4f0e7',
        dayToday: '#4caf7d',
        dayTodayText: '#06150e',
        dayWeekend: '#152520',
        dayHoliday: '#2c1c1a',
        daySpecial: '#1a2438',
      },
      inverseColors: {
        bg: '#f3f8f4',
        bgText: '#12251b',
        surface: '#ffffff',
        surfaceText: '#12251b',
        surface2: '#e7f1ea',
        surface2Text: '#12251b',
        border: '#d2e3d7',
        accent: '#1f7a4d',
        accentText: '#ffffff',
        danger: '#c0392b',
        settingsMenuBg: '#e7f1ea',
        settingsMenuText: '#12251b',
        dayToday: '#1f7a4d',
        dayTodayText: '#ffffff',
        dayWeekend: '#e6f1e9',
        dayHoliday: '#fbeaea',
        daySpecial: '#e8ecf7',
      },
    },
    // "Atardecer": naranjas y ambar calidos. Con pareja clara y
    // oscura, asi que sigue el modo del sistema si lo tienes puesto.
    {
      name: 'Atardecer',
      colors: {
        bg: '#1a1210',
        bgText: '#f5e7de',
        surface: '#241814',
        surfaceText: '#f5e7de',
        surface2: '#31211b',
        surface2Text: '#f5e7de',
        border: '#453026',
        accent: '#ff8a45',
        accentText: '#1c0d05',
        danger: '#e0574f',
        settingsMenuBg: '#31211b',
        settingsMenuText: '#f5e7de',
        dayToday: '#ff8a45',
        dayTodayText: '#1c0d05',
        dayWeekend: '#291b16',
        dayHoliday: '#3a1e1c',
        daySpecial: '#241a33',
      },
      inverseColors: {
        bg: '#fdf6f1',
        bgText: '#2b1a12',
        surface: '#ffffff',
        surfaceText: '#2b1a12',
        surface2: '#f8ece3',
        surface2Text: '#2b1a12',
        border: '#eddacb',
        accent: '#c05215',
        accentText: '#ffffff',
        danger: '#c0392b',
        settingsMenuBg: '#f8ece3',
        settingsMenuText: '#2b1a12',
        dayToday: '#c05215',
        dayTodayText: '#ffffff',
        dayWeekend: '#faeade',
        dayHoliday: '#fbe6e4',
        daySpecial: '#f0e8f7',
      },
    },
    // "Lavanda": morados suaves. Con pareja clara y
    // oscura, asi que sigue el modo del sistema si lo tienes puesto.
    {
      name: 'Lavanda',
      colors: {
        bg: '#14111f',
        bgText: '#e9e5f6',
        surface: '#1d1930',
        surfaceText: '#e9e5f6',
        surface2: '#26213e',
        surface2Text: '#e9e5f6',
        border: '#3a3358',
        accent: '#9b7dff',
        accentText: '#0d0819',
        danger: '#f2678c',
        settingsMenuBg: '#26213e',
        settingsMenuText: '#e9e5f6',
        dayToday: '#9b7dff',
        dayTodayText: '#0d0819',
        dayWeekend: '#1f1a33',
        dayHoliday: '#33192a',
        daySpecial: '#1a2540',
      },
      inverseColors: {
        bg: '#f7f5fd',
        bgText: '#1e1930',
        surface: '#ffffff',
        surfaceText: '#1e1930',
        surface2: '#efeafa',
        surface2Text: '#1e1930',
        border: '#ded5f1',
        accent: '#6b46d6',
        accentText: '#ffffff',
        danger: '#c2185b',
        settingsMenuBg: '#efeafa',
        settingsMenuText: '#1e1930',
        dayToday: '#6b46d6',
        dayTodayText: '#ffffff',
        dayWeekend: '#efeafa',
        dayHoliday: '#fbe7ef',
        daySpecial: '#e6ecfa',
      },
    },
    // "Carbón": grises neutros sin color, el de mas contraste. Con pareja clara y
    // oscura, asi que sigue el modo del sistema si lo tienes puesto.
    {
      name: 'Carbón',
      colors: {
        bg: '#111111',
        bgText: '#ededed',
        surface: '#1b1b1b',
        surfaceText: '#ededed',
        surface2: '#242424',
        surface2Text: '#ededed',
        border: '#343434',
        accent: '#c8c8c8',
        accentText: '#141414',
        danger: '#ff6b6b',
        settingsMenuBg: '#242424',
        settingsMenuText: '#ededed',
        dayToday: '#c8c8c8',
        dayTodayText: '#141414',
        dayWeekend: '#1e1e1e',
        dayHoliday: '#2f1c1c',
        daySpecial: '#1c2333',
      },
      inverseColors: {
        bg: '#f6f6f6',
        bgText: '#1a1a1a',
        surface: '#ffffff',
        surfaceText: '#1a1a1a',
        surface2: '#ececec',
        surface2Text: '#1a1a1a',
        border: '#d6d6d6',
        accent: '#3d3d3d',
        accentText: '#ffffff',
        danger: '#c62828',
        settingsMenuBg: '#ececec',
        settingsMenuText: '#1a1a1a',
        dayToday: '#3d3d3d',
        dayTodayText: '#ffffff',
        dayWeekend: '#eeeeee',
        dayHoliday: '#fbeaea',
        daySpecial: '#e9edf6',
      },
    },
    // "Arena": tierras y dorado, calido pero sobrio. Con pareja clara y
    // oscura, asi que sigue el modo del sistema si lo tienes puesto.
    {
      name: 'Arena',
      colors: {
        bg: '#17140f',
        bgText: '#f0e8da',
        surface: '#211c15',
        surfaceText: '#f0e8da',
        surface2: '#2c261d',
        surface2Text: '#f0e8da',
        border: '#40382b',
        accent: '#d8a54a',
        accentText: '#1a1208',
        danger: '#e0654f',
        settingsMenuBg: '#2c261d',
        settingsMenuText: '#f0e8da',
        dayToday: '#d8a54a',
        dayTodayText: '#1a1208',
        dayWeekend: '#241f17',
        dayHoliday: '#33201c',
        daySpecial: '#1e2233',
      },
      inverseColors: {
        bg: '#faf7f0',
        bgText: '#241d12',
        surface: '#ffffff',
        surfaceText: '#241d12',
        surface2: '#f2ece0',
        surface2Text: '#241d12',
        border: '#e0d6c2',
        accent: '#8a6420',
        accentText: '#ffffff',
        danger: '#c0392b',
        settingsMenuBg: '#f2ece0',
        settingsMenuText: '#241d12',
        dayToday: '#8a6420',
        dayTodayText: '#ffffff',
        dayWeekend: '#f4eee1',
        dayHoliday: '#fbe9e4',
        daySpecial: '#eaecf6',
      },
    },
    // NOTA: aqui vivian dos temas mas ("EINES" y "Registro") sacados de
    // guias de diseño privadas de Koku. Se quitaron del sembrado a
    // proposito: no deben viajar dentro de la app para todo el mundo.
    // Ojo, quitarlos de esta lista NO los borra de una base de datos que
    // ya los tenga -- el sembrado de abajo solo inserta un tema si NO
    // existe ya uno con ese nombre, asi que en el movil de Koku siguen
    // intactos y su copia de seguridad los restaura tal cual.
  ];

  // ---------------------------------------------------------------------
  // Viajes: finanzas_linked POR VIAJE (sustituye al ajuste GLOBAL que
  // habia antes en app_settings, ver routes/viajesSettings.js) + backfill
  // de los tickets ya creados en viajes_entry_attachments hacia la tabla
  // nueva viajes_entry_movements (ver su CREATE TABLE mas arriba en este
  // archivo). El backfill es idempotente sin necesitar una bandera aparte:
  // cada fila migrada se limpia (amount/finanzas_transaction_id a NULL) en
  // el mismo paso, asi que una segunda ejecucion no encuentra nada que
  // migrar de nuevo.
  // ---------------------------------------------------------------------
  const viajesTripColumns = db.prepare('PRAGMA table_info(viajes_trips)').all().map((c) => c.name);
  if (!viajesTripColumns.includes('finanzas_linked')) {
    db.exec('ALTER TABLE viajes_trips ADD COLUMN finanzas_linked INTEGER NOT NULL DEFAULT 0');
  }
  // Cuenta por defecto para los gastos/ingresos de ESTE viaje -- sustituye
  // al ajuste GLOBAL que habia antes en app_settings (ver
  // routes/viajesSettings.js, ahora eliminado): Koku prefiere elegirla
  // viaje a viaje, igual que ya pasa con finanzas_linked.
  if (!viajesTripColumns.includes('default_account_id')) {
    db.exec('ALTER TABLE viajes_trips ADD COLUMN default_account_id INTEGER REFERENCES finanzas_accounts(id)');
  }

  const legacyViajesTickets = db.prepare('SELECT * FROM viajes_entry_attachments WHERE amount IS NOT NULL').all();
  if (legacyViajesTickets.length) {
    const insertViajesMovement = db.prepare(
      "INSERT INTO viajes_entry_movements (entry_id, type, amount, attachment_id, finanzas_transaction_id) VALUES (?, 'expense', ?, ?, ?)"
    );
    const clearLegacyViajesAttachment = db.prepare(
      'UPDATE viajes_entry_attachments SET amount = NULL, finanzas_transaction_id = NULL WHERE id = ?'
    );
    for (const att of legacyViajesTickets) {
      insertViajesMovement.run(att.entry_id, att.amount, att.id, att.finanzas_transaction_id);
      clearLegacyViajesAttachment.run(att.id);
    }
  }

  // ---------------------------------------------------------------------
  // La espalda pasa de UN grupo muscular a TRES (peticion de Koku el
  // 9/9/2026): espalda alta, espalda media y dorsales. "lumbar" no se
  // toca, esa ya existia y se queda igual.
  //
  // Los ejercicios que ya estan importados en la base guardan
  // muscle_group = 'espalda', que a partir de ahora no significa nada.
  // Reimportar la libreria NO los arregla: el import es idempotente por
  // library_id y devuelve la fila que ya hay sin tocarla (a proposito,
  // para no pisar los cambios que hayas hecho a mano). Asi que hay que
  // recolocarlos aqui.
  //
  // El reparto se calculo a partir del origen de la libreria
  // (free-exercise-db), que si distinguia "lats" de "middle back". Como
  // la INMENSA mayoria de los "lats" son dorsales, el valor por defecto
  // es ese y aqui solo se listan los que van a otro sitio -- 68 ids en
  // vez de los 100 y pico que habria que listar al reves.
  //
  // Es idempotente: cuando ya no queda ningun 'espalda' no hace nada.
  const ejerciciosConEspaldaVieja = db
    .prepare("SELECT id, library_id, secondary_muscles FROM gym_exercises WHERE muscle_group = 'espalda' OR secondary_muscles LIKE '%\"espalda\"%'")
    .all();
  if (ejerciciosConEspaldaVieja.length) {
    const ESPALDA_NO_DORSAL = {
    'Alternating_Kettlebell_Row': 'espalda_media',
    'Alternating_Renegade_Row': 'espalda_media',
    'Anti-Gravity_Press': 'espalda_media',
    'Atlas_Stones': 'espalda_media',
    'Axle_Deadlift': 'espalda_media',
    'Back_Flyes_-_With_Bands': 'espalda_media',
    'Band_Pull_Apart': 'espalda_media',
    'Barbell_Shrug_Behind_The_Back': 'espalda_media',
    'Bent_Over_Barbell_Row': 'espalda_media',
    'Bent_Over_Low-Pulley_Side_Lateral': 'espalda_media',
    'Bent_Over_One-Arm_Long_Bar_Row': 'espalda_media',
    'Bent_Over_Two-Arm_Long_Bar_Row': 'espalda_media',
    'Bent_Over_Two-Dumbbell_Row': 'espalda_media',
    'Bent_Over_Two-Dumbbell_Row_With_Palms_In': 'espalda_media',
    'Bodyweight_Mid_Row': 'espalda_media',
    'Cable_Rope_Rear-Delt_Rows': 'espalda_media',
    'Cable_Seated_Lateral_Raise': 'espalda_media',
    'Cat_Stretch': 'espalda_media',
    'Childs_Pose': 'espalda_media',
    'Clean_Deadlift': 'espalda_media',
    'Clean_and_Press': 'espalda_media',
    'Deadlift_with_Bands': 'espalda_media',
    'Deadlift_with_Chains': 'espalda_media',
    'Deficit_Deadlift': 'espalda_media',
    'Dumbbell_Incline_Row': 'espalda_media',
    'Dumbbell_Lying_One-Arm_Rear_Lateral_Raise': 'espalda_media',
    'Dynamic_Chest_Stretch': 'espalda_media',
    'Face_Pull': 'espalda_media',
    'Incline_Bench_Pull': 'espalda_media',
    'Inverted_Row': 'espalda_media',
    'Inverted_Row_with_Straps': 'espalda_media',
    'Keg_Load': 'espalda_media',
    'Kettlebell_Halo': 'espalda_media',
    'Kettlebell_Halo_With_Overhead_Extension': 'espalda_media',
    'Leverage_High_Row': 'espalda_alta',
    'Log_Lift': 'espalda_media',
    'Low_Pulley_Row_To_Neck': 'espalda_media',
    'Lying_Cambered_Barbell_Row': 'espalda_media',
    'Lying_T-Bar_Row': 'espalda_media',
    'Middle_Back_Shrug': 'espalda_alta',
    'Middle_Back_Stretch': 'espalda_media',
    'Mixed_Grip_Chin': 'espalda_media',
    'One-Arm_Dumbbell_Row': 'espalda_media',
    'One-Arm_Kettlebell_Row': 'espalda_media',
    'One-Arm_Long_Bar_Row': 'espalda_media',
    'One_Arm_Chin-Up': 'espalda_media',
    'Power_Clean': 'espalda_media',
    'Reverse_Grip_Bent-Over_Rows': 'espalda_media',
    'Rhomboids-SMR': 'espalda_alta',
    'Rowing_Stationary': 'espalda_media',
    'Sandbag_Load': 'espalda_media',
    'Seated_Cable_Rows': 'espalda_media',
    'Seated_One-arm_Cable_Pulley_Rows': 'espalda_media',
    'Sled_Overhead_Backward_Walk': 'espalda_media',
    'Sled_Row': 'espalda_media',
    'Smith_Machine_Bent_Over_Row': 'espalda_media',
    'Smith_Machine_Upright_Row': 'espalda_media',
    'Spinal_Stretch': 'espalda_media',
    'Straight_Bar_Bench_Mid_Rows': 'espalda_media',
    'Sumo_Deadlift': 'espalda_media',
    'Sumo_Deadlift_with_Bands': 'espalda_media',
    'Sumo_Deadlift_with_Chains': 'espalda_media',
    'Suspended_Row': 'espalda_media',
    'T-Bar_Row_with_Handle': 'espalda_media',
    'Two-Arm_Kettlebell_Row': 'espalda_media',
    'Upper_Back-Leg_Grab': 'espalda_alta',
    'Upper_Back_Stretch': 'espalda_alta',
    'Weighted_Ball_Hyperextension': 'espalda_media',
    };
    const actualizarEspalda = db.prepare('UPDATE gym_exercises SET muscle_group = ?, secondary_muscles = ? WHERE id = ?');
    for (const ej of ejerciciosConEspaldaVieja) {
      const destino = ESPALDA_NO_DORSAL[ej.library_id] || 'dorsales';
      const fila = db.prepare('SELECT muscle_group FROM gym_exercises WHERE id = ?').get(ej.id);
      const grupo = fila.muscle_group === 'espalda' ? destino : fila.muscle_group;
      let secundarios = ej.secondary_muscles;
      if (secundarios && secundarios.includes('"espalda"')) {
        try {
          const lista = JSON.parse(secundarios).map((m) => (m === 'espalda' ? destino : m));
          secundarios = JSON.stringify(lista);
        } catch (err) {
          // JSON roto de alguna version vieja: mejor dejarlo como esta
          // que romper el arranque de la app entera por esto.
        }
      }
      actualizarEspalda.run(grupo, secundarios, ej.id);
    }
  }

  // Segundo acto de lo de la espalda: la build #42 llego a repartir unos
  // pocos ejercicios a 'espalda_alta', y Koku deshizo esa franja el mismo
  // dia ("cambialo a hombro posterior y fusionalo con media"). Los que
  // se quedaron ahi vuelven a espalda media. Idempotente: cuando no
  // queda ninguno, no hace nada.
  const conEspaldaAlta = db
    .prepare("SELECT id, secondary_muscles FROM gym_exercises WHERE muscle_group = 'espalda_alta' OR secondary_muscles LIKE '%\"espalda_alta\"%'")
    .all();
  if (conEspaldaAlta.length) {
    const arreglar = db.prepare("UPDATE gym_exercises SET muscle_group = CASE WHEN muscle_group = 'espalda_alta' THEN 'espalda_media' ELSE muscle_group END, secondary_muscles = ? WHERE id = ?");
    for (const ej of conEspaldaAlta) {
      let secundarios = ej.secondary_muscles;
      if (secundarios && secundarios.includes('"espalda_alta"')) {
        try {
          secundarios = JSON.stringify(JSON.parse(secundarios).map((m) => (m === 'espalda_alta' ? 'espalda_media' : m)));
        } catch (err) {
          // JSON roto de alguna version vieja: mejor dejarlo como esta
          // que romper el arranque de la app entera por esto.
        }
      }
      arreglar.run(secundarios, ej.id);
    }
  }

  const existingThemeNames = new Set(db.prepare('SELECT name FROM themes').all().map((t) => t.name));
  const seedTheme = db.prepare('INSERT INTO themes (name, colors, inverse_colors) VALUES (?, ?, ?)');
  for (const theme of SEED_THEMES) {
    if (!existingThemeNames.has(theme.name)) {
      seedTheme.run(theme.name, JSON.stringify(theme.colors), theme.inverseColors ? JSON.stringify(theme.inverseColors) : null);
    }
  }

  // Migraciones puntuales de la ronda "Deudas + descanso en Gimnasio +
  // prestamos en Lecturas": las tablas de arriba (CREATE TABLE IF NOT
  // EXISTS) ya llevan las columnas nuevas para una instalacion desde cero,
  // pero una base de datos YA EXISTENTE necesita el ALTER TABLE de rigor.
  const gymRoutineExerciseColumns = db.prepare('PRAGMA table_info(gym_routine_exercises)').all().map((c) => c.name);
  if (!gymRoutineExerciseColumns.includes('target_rest_seconds')) {
    db.exec('ALTER TABLE gym_routine_exercises ADD COLUMN target_rest_seconds INTEGER');
  }
  if (!gymRoutineExerciseColumns.includes('hidden')) {
    db.exec('ALTER TABLE gym_routine_exercises ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
  }
  const gymSetColumns = db.prepare('PRAGMA table_info(gym_sets)').all().map((c) => c.name);
  if (!gymSetColumns.includes('rest_seconds')) {
    db.exec('ALTER TABLE gym_sets ADD COLUMN rest_seconds INTEGER');
  }
  const lecturasItemColumns = db.prepare('PRAGMA table_info(lecturas_items)').all().map((c) => c.name);
  if (!lecturasItemColumns.includes('loaned')) {
    db.exec('ALTER TABLE lecturas_items ADD COLUMN loaned INTEGER NOT NULL DEFAULT 0');
  }
  if (!lecturasItemColumns.includes('loaned_to')) {
    db.exec('ALTER TABLE lecturas_items ADD COLUMN loaned_to TEXT');
  }
  if (!lecturasItemColumns.includes('loaned_at')) {
    db.exec('ALTER TABLE lecturas_items ADD COLUMN loaned_at TEXT');
  }

  // ---- Migraciones del rediseno de Gimnasio (SOLO en esta linea movil,
  // ---- diverge de server/db.js -- ver el comentario junto a gym_blocks).
  // Fase 1: bloques de entrenamiento. La tabla gym_blocks ya la crea el
  // CREATE TABLE IF NOT EXISTS de arriba en instalaciones nuevas; aqui va
  // lo que una base YA EXISTENTE necesita ademas:
  //
  // 1) La columna block_id en gym_routines (los "dias").
  const gymRoutineColumns = db.prepare('PRAGMA table_info(gym_routines)').all().map((c) => c.name);
  if (!gymRoutineColumns.includes('block_id')) {
    db.exec('ALTER TABLE gym_routines ADD COLUMN block_id INTEGER REFERENCES gym_blocks(id)');
  }
  // 2) Recolocar en un bloque "General" cualquier dia que quedara suelto
  //    (los datos de antes del rediseno, o un huerfano de un borrado a
  //    medias). Es idempotente: si no hay huerfanos no hace nada, y el
  //    bloque "General" solo se crea si de verdad hace falta (se reutiliza
  //    si ya existe uno con ese nombre).
  const orphanRoutines = db.prepare('SELECT COUNT(*) AS n FROM gym_routines WHERE block_id IS NULL').get();
  if (orphanRoutines && orphanRoutines.n > 0) {
    let general = db.prepare("SELECT id FROM gym_blocks WHERE name = 'General' ORDER BY id ASC").get();
    if (!general) {
      // Nace activo solo si todavia no hay ningun otro bloque activo, para
      // no robarle el estado a uno que el usuario ya hubiera activado.
      const activeCount = db.prepare('SELECT COUNT(*) AS n FROM gym_blocks WHERE is_active = 1').get();
      const positionRow = db.prepare('SELECT COUNT(*) AS n FROM gym_blocks').get();
      db.prepare('INSERT INTO gym_blocks (name, position, is_active) VALUES (?, ?, ?)')
        .run('General', positionRow.n, activeCount.n > 0 ? 0 : 1);
      general = db.prepare("SELECT id FROM gym_blocks WHERE name = 'General' ORDER BY id ASC").get();
    }
    db.prepare('UPDATE gym_routines SET block_id = ? WHERE block_id IS NULL').run(general.id);
  }
  // 3) Indices para las consultas de progreso/heatmap que vienen en fases
  //    posteriores (baratos y seguros de crear ya).
  db.exec('CREATE INDEX IF NOT EXISTS idx_gym_sets_session ON gym_sets(session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_gym_sets_exercise ON gym_sets(exercise_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_gym_sessions_date ON gym_sessions(date)');
  // Fase 2: libreria de ejercicios -- columnas nuevas de gym_exercises
  // (library_id para el import idempotente, equipment para mostrar el
  // material del ejercicio).
  const gymExerciseColumns = db.prepare('PRAGMA table_info(gym_exercises)').all().map((c) => c.name);
  if (!gymExerciseColumns.includes('library_id')) {
    db.exec('ALTER TABLE gym_exercises ADD COLUMN library_id TEXT');
  }
  if (!gymExerciseColumns.includes('equipment')) {
    db.exec('ALTER TABLE gym_exercises ADD COLUMN equipment TEXT');
  }
  // Fase 6 (mapa de musculos): grupos secundarios del ejercicio.
  if (!gymExerciseColumns.includes('secondary_muscles')) {
    db.exec('ALTER TABLE gym_exercises ADD COLUMN secondary_muscles TEXT');
  }
  // Configuracion por defecto del ejercicio (series/reps/descanso). Se
  // quedan a NULL en lo que ya existe, que es justo lo que se quiere:
  // hasta que no las rellenes, un ejercicio se comporta como siempre.
  if (!gymExerciseColumns.includes('default_sets')) {
    db.exec('ALTER TABLE gym_exercises ADD COLUMN default_sets INTEGER');
  }
  if (!gymExerciseColumns.includes('default_reps')) {
    db.exec('ALTER TABLE gym_exercises ADD COLUMN default_reps INTEGER');
  }
  if (!gymExerciseColumns.includes('default_rest_seconds')) {
    db.exec('ALTER TABLE gym_exercises ADD COLUMN default_rest_seconds INTEGER');
  }
  if (!gymExerciseColumns.includes('notes')) {
    db.exec('ALTER TABLE gym_exercises ADD COLUMN notes TEXT');
  }
  if (!gymExerciseColumns.includes('unilateral')) {
    db.exec('ALTER TABLE gym_exercises ADD COLUMN unilateral INTEGER NOT NULL DEFAULT 0');
  }
  if (!gymExerciseColumns.includes('count_sides_separately')) {
    db.exec('ALTER TABLE gym_exercises ADD COLUMN count_sides_separately INTEGER NOT NULL DEFAULT 0');
  }
  if (!gymExerciseColumns.includes('side_rest_seconds')) {
    db.exec('ALTER TABLE gym_exercises ADD COLUMN side_rest_seconds INTEGER');
  }
  // Fase 3: modo entrenar en vivo -- RPE y tipo de serie en gym_sets,
  // hora de inicio/duracion/notas por ejercicio en gym_sessions.
  const gymSetColumns2 = db.prepare('PRAGMA table_info(gym_sets)').all().map((c) => c.name);
  if (!gymSetColumns2.includes('rpe')) {
    db.exec('ALTER TABLE gym_sets ADD COLUMN rpe REAL');
  }
  if (!gymSetColumns2.includes('set_type')) {
    db.exec('ALTER TABLE gym_sets ADD COLUMN set_type TEXT');
  }
  if (!gymSetColumns2.includes('extra_rest_seconds')) {
    db.exec('ALTER TABLE gym_sets ADD COLUMN extra_rest_seconds INTEGER');
  }
  if (!gymSetColumns2.includes('duration_seconds')) {
    db.exec('ALTER TABLE gym_sets ADD COLUMN duration_seconds INTEGER');
  }
  if (!gymSetColumns2.includes('side')) {
    db.exec('ALTER TABLE gym_sets ADD COLUMN side TEXT');
  }
  if (!gymSetColumns2.includes('notes')) {
    db.exec('ALTER TABLE gym_sets ADD COLUMN notes TEXT');
  }
  const gymSessionColumns = db.prepare('PRAGMA table_info(gym_sessions)').all().map((c) => c.name);
  if (!gymSessionColumns.includes('started_at')) {
    db.exec('ALTER TABLE gym_sessions ADD COLUMN started_at TEXT');
  }
  if (!gymSessionColumns.includes('duration_seconds')) {
    db.exec('ALTER TABLE gym_sessions ADD COLUMN duration_seconds INTEGER');
  }
  if (!gymSessionColumns.includes('exercise_notes')) {
    db.exec('ALTER TABLE gym_sessions ADD COLUMN exercise_notes TEXT');
  }
  // Fase 4: actividad rapida (cardio/clases/deporte sin series).
  if (!gymSessionColumns.includes('type')) {
    db.exec("ALTER TABLE gym_sessions ADD COLUMN type TEXT NOT NULL DEFAULT 'gym'");
  }
  if (!gymSessionColumns.includes('activity_kind')) {
    db.exec('ALTER TABLE gym_sessions ADD COLUMN activity_kind TEXT');
  }
  if (!gymSessionColumns.includes('activity_name')) {
    db.exec('ALTER TABLE gym_sessions ADD COLUMN activity_name TEXT');
  }

}
