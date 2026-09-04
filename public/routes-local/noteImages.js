// noteImages — portado de server/routes/noteImages.js.
//
// Igual que el resto de rutas portadas, pero con un cambio de fondo:
// los BYTES ya no van a una carpeta del disco del ordenador, van al
// almacen "noteAssets" de IndexedDB (ver assetPut/assetGet/assetDelete
// en db-local.js). El nombre sigue siendo el mismo <uuid>.<ext>, asi
// que el HTML que se guarda en la nota no cambia en absoluto -- lo
// unico distinto es de donde salen los bytes al mostrarla, que es lo
// que hace resolveAssetUrl() en app.js con una URL blob:.
//
// La ruta que SERVIA la imagen (GET /:filename) no se porta: sin
// servidor no hay nada que servir, y un <img> no puede pedirle nada a
// una funcion de JavaScript.
(function () {
  const router = createLocalRouter();

  const ALLOWED_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };

  router.post('/', async (req, res) => {
    const type = req.headers['content-type'];
    const ext = ALLOWED_TYPES[type];
    // En el servidor llegaba como un Buffer de Node (express.raw); aqui
    // api() convierte el File elegido a un Uint8Array antes de llamar.
    if (!ext || !ArrayBuffer.isView(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'invalid_image', message: 'Formato de imagen no soportado.' });
    }
    const filename = `${crypto.randomUUID()}.${ext}`;
    await assetPut(filename, req.body, type);
    res.status(201).json({ url: `/api/notes/images/${filename}` });
  });

  // Se monta con una ruta base MAS LARGA que la de notas: el
  // despachador ordena por longitud, asi que "/api/notes/images" gana a
  // "/api/notes" y no hay ambiguedad (ver dispatchLocalRequest).
  mountLocalRouter('/api/notes/images', router);
})();
