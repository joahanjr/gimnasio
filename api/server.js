const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');

const db = new Database(process.env.DB_FILE || 'gimnasio.db');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS socios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT,
    vence TEXT,                        -- YYYY-MM-DD, último día con acceso
    creado TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS entradas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    socio_id INTEGER NOT NULL REFERENCES socios(id),
    fecha TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    socio_id INTEGER NOT NULL REFERENCES socios(id),
    plan TEXT NOT NULL,
    meses INTEGER NOT NULL,
    monto REAL NOT NULL,
    fecha TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    concepto TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    monto REAL NOT NULL,               -- total de la venta
    fecha TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS fotos (    -- aparte de socios para no cargar imágenes en cada consulta
    socio_id INTEGER PRIMARY KEY REFERENCES socios(id),
    tipo TEXT NOT NULL,
    imagen BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS planes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
    duracion INTEGER NOT NULL,
    unidad TEXT NOT NULL,              -- 'meses' | 'dias'
    precio REAL NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1  -- se desactiva en vez de borrar: hay socios y pagos que lo usan
  );
  CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor REAL NOT NULL);
  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
    precio REAL NOT NULL,
    existencia INTEGER NOT NULL DEFAULT 0 CHECK (existencia >= 0)
  );
  CREATE TABLE IF NOT EXISTS visitas (   -- pase de un día, sin ser socio
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    monto REAL NOT NULL,
    usuario_id INTEGER REFERENCES usuarios(id),
    fecha TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    clave TEXT NOT NULL,               -- salt:hash (scrypt)
    rol TEXT NOT NULL DEFAULT 'recepcion'
  );
  CREATE TABLE IF NOT EXISTS sesiones (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    creado TEXT DEFAULT (datetime('now','localtime'))
  );
`);
// Columnas añadidas después del primer diseño: las bases ya existentes no las tienen.
function agregarColumna(tabla, columna, definicion) {
  if (!db.prepare(`PRAGMA table_xinfo(${tabla})`).all().some(c => c.name === columna))
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
}
agregarColumna('usuarios', 'rol', "TEXT NOT NULL DEFAULT 'recepcion'");
for (const t of ['entradas', 'pagos', 'ventas']) agregarColumna(t, 'usuario_id', 'INTEGER REFERENCES usuarios(id)'); // quién lo registró
agregarColumna('ventas', 'producto_id', 'INTEGER REFERENCES productos(id)');
agregarColumna('socios', 'apellido1', 'TEXT');
agregarColumna('socios', 'plan_id', 'INTEGER REFERENCES planes(id)');
// Desglose del cobro. monto = lo que pagó; cargo = lo que se le cobró. Pagos viejos no tienen cargo: se toma monto (saldo 0).
agregarColumna('pagos', 'plan_id', 'INTEGER REFERENCES planes(id)');
for (const c of ['precio', 'inscripcion', 'descuento', 'cargo']) agregarColumna('pagos', c, 'REAL');
agregarColumna('socios', 'apellido2', 'TEXT');
// Socios anteriores no tienen apellidos; concat_ws omite los NULL.
agregarColumna('socios', 'nombre_completo', "TEXT GENERATED ALWAYS AS (concat_ws(' ', nombre, apellido1, apellido2)) VIRTUAL");
// Bajas y anulaciones se marcan, no se borran: el historial de pagos y entradas se conserva.
for (const t of ['socios', 'usuarios', 'productos']) agregarColumna(t, 'activo', 'INTEGER NOT NULL DEFAULT 1');
agregarColumna('socios', 'avisado', 'TEXT');                       // último aviso de vencimiento (YYYY-MM-DD)
agregarColumna('usuarios', 'cambiar_clave', 'INTEGER NOT NULL DEFAULT 0');
for (const t of ['pagos', 'ventas', 'visitas']) {
  agregarColumna(t, 'metodo', "TEXT NOT NULL DEFAULT 'efectivo'");
  agregarColumna(t, 'anulado', 'INTEGER REFERENCES usuarios(id)'); // quién lo anuló; NULL = válido
}
// Vencimiento antes del pago, para poder anularlo. '' = no tenía; NULL = pago anterior a esta columna (no se puede anular).
agregarColumna('pagos', 'vence_antes', 'TEXT');
// Planes de pareja o grupo: uno paga y a los demás se les activa la membresía igual.
agregarColumna('planes', 'personas', 'INTEGER NOT NULL DEFAULT 1');
db.exec(`CREATE TABLE IF NOT EXISTS pago_acompanantes (
  pago_id INTEGER NOT NULL REFERENCES pagos(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  vence_antes TEXT NOT NULL,           -- para regresar su vencimiento si se anula el pago ('' = no tenía)
  PRIMARY KEY (pago_id, socio_id)
)`);
// Código secreto del QR de entrada. Hexadecimal en mayúsculas: el lector USB lo teclea igual con cualquier distribución de teclado.
const nuevoCodigo = () => crypto.randomBytes(8).toString('hex').toUpperCase();
const CODIGO = /^[0-9A-F]{16}$/;
agregarColumna('socios', 'codigo', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS socios_codigo ON socios(codigo)');
for (const { id } of db.prepare('SELECT id FROM socios WHERE codigo IS NULL').all())
  db.prepare('UPDATE socios SET codigo = ? WHERE id = ?').run(nuevoCodigo(), id);
// Último pago vigente que movió el vencimiento del socio, sea suyo o como acompañante.
const ultimoPagoDe = id => db.prepare(`SELECT max(id) FROM (
  SELECT id FROM pagos WHERE socio_id = $id AND anulado IS NULL
  UNION ALL SELECT a.pago_id FROM pago_acompanantes a JOIN pagos p ON p.id = a.pago_id WHERE a.socio_id = $id AND p.anulado IS NULL)`).pluck().get({ id });

function hashClave(clave, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(clave, salt, 64).toString('hex')}`;
}
function claveCorrecta(clave, guardada) {
  const [salt, hash] = guardada.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(clave, salt, 64));
}
function crearUsuario(usuario, nombre, clave, rol = 'recepcion', cambiarClave = false) {
  return db.prepare('INSERT INTO usuarios (usuario, nombre, clave, rol, cambiar_clave) VALUES (?, ?, ?, ?, ?)').run(usuario, nombre, hashClave(clave), rol, cambiarClave ? 1 : 0);
}
const ROLES = ['admin', 'recepcion'];
const METODOS = ['efectivo', 'tarjeta', 'transferencia'];
// Sin ningún admin (primer arranque): admin/admin, y la app obliga a cambiarla al entrar.
if (!db.prepare("SELECT 1 FROM usuarios WHERE rol = 'admin'").get()) crearUsuario('admin', 'Administrador', 'admin', 'admin', true);
// Bases creadas antes de esta regla: si el admin sigue con admin/admin, también se le obliga.
const admin = db.prepare("SELECT id, clave FROM usuarios WHERE usuario = 'admin'").get();
if (admin && claveCorrecta('admin', admin.clave)) db.prepare('UPDATE usuarios SET cambiar_clave = 1 WHERE id = ?').run(admin.id);

const hoy = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD en hora local

// Si la membresía sigue vigente se suma desde su vencimiento; si no, desde hoy.
function extenderVigencia(vence, duracion, unidad, fechaHoy = hoy()) {
  const base = vence && vence >= fechaHoy ? vence : fechaHoy;
  const [a, m, d] = base.split('-').map(Number);
  if (unidad === 'dias') return new Date(Date.UTC(a, m - 1, d + duracion)).toISOString().slice(0, 10);
  const meses = duracion;
  const fin = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() + 1, 0)).getUTCDate();
  fin.setUTCDate(Math.min(d, ultimoDia)); // 31 ene + 1 mes = 28/29 feb
  return fin.toISOString().slice(0, 10);
}

// dias_restantes: 0 = hoy es su último día; negativo = días que lleva vencido. Ambas fechas en UTC, la resta es exacta.
const diasHasta = (fecha, desde = hoy()) => Math.round((Date.parse(fecha) - Date.parse(desde)) / 864e5);
const conEstado = s => s && { ...s, vigente: !!s.vence && s.vence >= hoy(), dias_restantes: s.vence ? diasHasta(s.vence) : null };
const esMonto = n => typeof n === 'number' && n > 0;
const esCantidad = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const centavos = n => Math.round(n * 100) / 100;
const precioInscripcion = () => db.prepare("SELECT valor FROM ajustes WHERE clave = 'inscripcion'").pluck().get() ?? 0;
const texto = t => typeof t === 'string' && t.trim() !== '';

const app = express();
app.use(express.json());

const leerToken = req => (req.headers.cookie || '').match(/(?:^|;\s*)sesion=([a-f0-9]+)/)?.[1];
const DOCE_HORAS = 12 * 3600;

// Freno a quien prueba contraseñas: 5 fallos seguidos bloquean ese usuario desde esa IP 15 minutos.
// shortcut: en memoria, se reinicia con el servidor; pasarlo a la base si algún día hay varios procesos
const fallos = new Map();
const MAX_FALLOS = 5, BLOQUEO_MS = 15 * 60e3;

app.post('/api/login', (req, res) => {
  const { usuario, clave } = req.body;
  const clave_intento = `${req.ip}|${String(usuario ?? '').trim().toLowerCase()}`;
  const f = fallos.get(clave_intento);
  if (f && f.n >= MAX_FALLOS && Date.now() - f.desde < BLOQUEO_MS)
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos.' });
  const u = texto(usuario) && texto(clave) && db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(usuario.trim());
  if (!u || !claveCorrecta(clave, u.clave)) {
    const vigente = f && Date.now() - f.desde < BLOQUEO_MS;
    fallos.set(clave_intento, { n: vigente ? f.n + 1 : 1, desde: vigente ? f.desde : Date.now() });
    if (fallos.size > 10000) fallos.clear(); // que un ataque con miles de nombres no llene la memoria
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  fallos.delete(clave_intento);
  db.prepare("DELETE FROM sesiones WHERE creado <= datetime('now','localtime','-12 hours')").run(); // limpia las caducadas
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (token, usuario_id) VALUES (?, ?)').run(token, u.id);
  res.set('Set-Cookie', `sesion=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DOCE_HORAS}`);
  res.json({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, cambiar_clave: !!u.cambiar_clave });
});

// Todo lo demás de /api requiere sesión.
app.use('/api', (req, res, next) => {
  const u = db.prepare(`
    SELECT u.id, u.usuario, u.nombre, u.rol, u.cambiar_clave FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND u.activo = 1 AND s.creado > datetime('now','localtime','-12 hours')`).get(leerToken(req) ?? '');
  if (!u) return res.status(401).json({ error: 'Sesión no iniciada' });
  req.usuario = { ...u, cambiar_clave: !!u.cambiar_clave };
  // Con contraseña temporal (admin/admin o puesta por el admin) solo puede cambiarla.
  if (req.usuario.cambiar_clave && !['/yo', '/clave', '/logout'].includes(req.path))
    return res.status(403).json({ error: 'Cambia tu contraseña antes de continuar' });
  next();
});

app.get('/api/yo', (req, res) => res.json(req.usuario));

app.put('/api/clave', (req, res) => {
  const { actual, nueva } = req.body;
  const u = db.prepare('SELECT clave FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!texto(actual) || !claveCorrecta(actual, u.clave)) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
  if (!texto(nueva) || nueva.length < 4) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  if (nueva === actual) return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual' });
  db.prepare('UPDATE usuarios SET clave = ?, cambiar_clave = 0 WHERE id = ?').run(hashClave(nueva), req.usuario.id);
  res.status(204).end();
});

const soloAdmin = (req, res, next) => req.usuario.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo el administrador' });

app.get('/api/usuarios', soloAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, usuario, nombre, rol, activo FROM usuarios ORDER BY activo DESC, nombre').all());
});

app.put('/api/usuarios/:id', soloAdmin, (req, res) => {
  const { nombre, rol, activo, clave } = req.body;
  const id = Number(req.params.id);
  if (!texto(nombre)) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  const nuevaClave = texto(clave);
  if (nuevaClave && clave.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  // Así siempre queda al menos un administrador activo: el que está editando.
  if (id === req.usuario.id && (rol !== 'admin' || activo === false)) return res.status(400).json({ error: 'No puedes quitarte el rol de administrador ni desactivarte' });
  const u = db.transaction(() => {
    const u = db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ? RETURNING id, usuario, nombre, rol, activo')
      .get(nombre.trim(), rol, activo === false ? 0 : 1, id);
    if (!u) return null;
    // Contraseña puesta por el admin: es temporal, el usuario la cambia al entrar.
    if (nuevaClave) db.prepare('UPDATE usuarios SET clave = ?, cambiar_clave = 1 WHERE id = ?').run(hashClave(clave), id);
    if (!u.activo || nuevaClave) db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id); // lo saca de la app
    return u;
  })();
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(u);
});

app.post('/api/usuarios', soloAdmin, (req, res) => {
  const { usuario, nombre, clave, rol } = req.body;
  if (!texto(usuario) || !texto(nombre)) return res.status(400).json({ error: 'Usuario y nombre son obligatorios' });
  if (!texto(clave) || clave.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(usuario.trim())) return res.status(409).json({ error: 'Ese usuario ya existe' });
  const { lastInsertRowid } = crearUsuario(usuario.trim(), nombre.trim(), clave, rol, true); // la elige el admin: es temporal
  res.status(201).json({ id: lastInsertRowid, usuario: usuario.trim(), nombre: nombre.trim(), rol, activo: 1 });
});

app.post('/api/logout', (req, res) => {
  db.prepare('DELETE FROM sesiones WHERE token = ?').run(leerToken(req));
  res.set('Set-Cookie', 'sesion=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.status(204).end();
});

app.get('/api/planes', (req, res) => res.json(db.prepare('SELECT * FROM planes ORDER BY activo DESC, precio').all()));

function validarPlan({ nombre, duracion, unidad, precio, personas = 1 }) {
  if (![1, 2, 3, 4].includes(personas)) return 'El plan es para 1 a 4 personas';
  if (!texto(nombre)) return 'El nombre del plan es obligatorio';
  if (!Number.isInteger(duracion) || duracion < 1) return 'Duración inválida';
  if (!['meses', 'dias'].includes(unidad)) return 'Unidad inválida';
  if (!esMonto(precio)) return 'Precio inválido';
}
const nombreRepetido = (nombre, id = -1) => db.prepare('SELECT 1 FROM planes WHERE nombre = ? AND id != ?').get(nombre.trim(), id);

app.post('/api/planes', soloAdmin, (req, res) => {
  const error = validarPlan(req.body);
  if (error) return res.status(400).json({ error });
  const { nombre, duracion, unidad, precio, personas = 1 } = req.body;
  if (nombreRepetido(nombre)) return res.status(409).json({ error: 'Ya existe un plan con ese nombre' });
  res.status(201).json(db.prepare('INSERT INTO planes (nombre, duracion, unidad, precio, personas) VALUES (?, ?, ?, ?, ?) RETURNING *').get(nombre.trim(), duracion, unidad, precio, personas));
});

app.put('/api/planes/:id', soloAdmin, (req, res) => {
  const error = validarPlan(req.body);
  if (error) return res.status(400).json({ error });
  const { nombre, duracion, unidad, precio, activo, personas } = req.body;
  if (nombreRepetido(nombre, Number(req.params.id))) return res.status(409).json({ error: 'Ya existe un plan con ese nombre' });
  const plan = db.prepare('UPDATE planes SET nombre = ?, duracion = ?, unidad = ?, precio = ?, activo = ?, personas = coalesce(?, personas) WHERE id = ? RETURNING *')
    .get(nombre.trim(), duracion, unidad, precio, activo === false ? 0 : 1, personas ?? null, req.params.id); // sin `personas` se conserva
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
  res.json(plan);
});

app.get('/api/ajustes', (req, res) => res.json({ inscripcion: precioInscripcion() }));

app.put('/api/ajustes', soloAdmin, (req, res) => {
  if (!esCantidad(req.body.inscripcion)) return res.status(400).json({ error: 'Precio de inscripción inválido' });
  db.prepare("INSERT INTO ajustes (clave, valor) VALUES ('inscripcion', ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor").run(req.body.inscripcion);
  res.json({ inscripcion: req.body.inscripcion });
});

// saldo > 0: a favor del socio; saldo < 0: pendiente por pagar.
const FICHA = `SELECT s.*, EXISTS (SELECT 1 FROM fotos f WHERE f.socio_id = s.id) AS tiene_foto,
  (SELECT nombre FROM planes WHERE id = s.plan_id) AS plan,
  (SELECT round(coalesce(sum(monto - coalesce(cargo, monto)), 0), 2) FROM pagos p WHERE p.socio_id = s.id AND p.anulado IS NULL) AS saldo
  FROM socios s`;
const conFicha = s => s && conEstado({ ...s, tiene_foto: !!s.tiene_foto });
const fichaDe = id => conFicha(db.prepare(`${FICHA} WHERE s.id = ?`).get(id));
const metodoValido = m => m === undefined || METODOS.includes(m);

app.get('/api/socios', (req, res) => {
  const q = String(req.query.q || '').trim();
  const filas = q
    ? db.prepare(`${FICHA} WHERE s.id = ? OR s.nombre_completo LIKE ? ORDER BY s.nombre_completo LIMIT 50`).all(Number(q) || -1, `%${q}%`)
    : db.prepare(`${FICHA} ORDER BY s.nombre_completo`).all();
  res.json(filas.map(conFicha));
});

// Socios con membresía por vencer en los próximos `dias` o vencida hace 30 días o menos, para avisarles.
app.get('/api/avisos', (req, res) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 7, 0), 90);
  res.json(db.prepare(`${FICHA} WHERE s.activo = 1 AND s.vence BETWEEN date($hoy, '-30 days') AND date($hoy, '+' || $dias || ' days')
    ORDER BY s.vence`).all({ hoy: hoy(), dias }).map(conFicha));
});

app.post('/api/socios/:id/aviso', (req, res) => {
  const s = db.prepare('UPDATE socios SET avisado = ? WHERE id = ? RETURNING id').get(hoy(), req.params.id);
  if (!s) return res.status(404).json({ error: 'Socio no encontrado' });
  res.json(fichaDe(s.id));
});

app.get('/api/socios/:id', (req, res) => {
  const socio = fichaDe(req.params.id);
  if (!socio) return res.status(404).json({ error: 'Socio no encontrado' });
  res.json({
    ...socio,
    entradas: db.prepare('SELECT fecha FROM entradas WHERE socio_id = ? ORDER BY id DESC').pluck().all(socio.id),
    ultimo_pago: db.prepare('SELECT fecha, plan, monto FROM pagos WHERE socio_id = ? AND anulado IS NULL ORDER BY id DESC LIMIT 1').get(socio.id) ?? null,
    // pagado_por: en un plan de grupo, quién pagó (el acompañante no tiene cobro); acompanantes: a quiénes cubrió el pago.
    pagos: db.prepare(`SELECT p.id, p.fecha, p.plan, p.monto, coalesce(p.cargo, p.monto) AS cargo, p.metodo, p.anulado IS NOT NULL AS anulado,
        p.vence_antes IS NOT NULL AS anulable, NULL AS pagado_por,
        (SELECT group_concat('#' || s.id || ' ' || s.nombre_completo, ', ') FROM pago_acompanantes a JOIN socios s ON s.id = a.socio_id WHERE a.pago_id = p.id) AS acompanantes
      FROM pagos p WHERE p.socio_id = $id
      UNION ALL SELECT p.id, p.fecha, p.plan, 0, 0, p.metodo, p.anulado IS NOT NULL, 0, '#' || s.id || ' ' || s.nombre_completo, NULL
      FROM pago_acompanantes a JOIN pagos p ON p.id = a.pago_id JOIN socios s ON s.id = p.socio_id WHERE a.socio_id = $id
      ORDER BY 1 DESC`).all({ id: socio.id })
      .map(p => ({ ...p, anulado: !!p.anulado, anulable: !!p.anulable }))
  });
});

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
app.put('/api/socios/:id/foto', express.raw({ type: 'image/*', limit: '2mb' }), (req, res) => {
  const tipo = req.headers['content-type'];
  if (!TIPOS_FOTO.includes(tipo) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'La foto debe ser JPG, PNG o WebP' });
  if (!db.prepare('SELECT 1 FROM socios WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Socio no encontrado' });
  db.prepare('INSERT INTO fotos (socio_id, tipo, imagen) VALUES (?, ?, ?) ON CONFLICT (socio_id) DO UPDATE SET tipo = excluded.tipo, imagen = excluded.imagen')
    .run(Number(req.params.id), tipo, req.body);
  res.status(204).end();
});

app.get('/api/socios/:id/foto', (req, res) => {
  const f = db.prepare('SELECT tipo, imagen FROM fotos WHERE socio_id = ?').get(req.params.id);
  if (!f) return res.status(404).end();
  res.type(f.tipo).send(f.imagen);
});

// Devuelve el error o los datos limpios.
function validarSocio({ nombre, apellido1, apellido2, telefono }) {
  if (!texto(nombre) || !texto(apellido1)) return { error: 'El nombre y el primer apellido son obligatorios' };
  const celular = String(telefono ?? '').replace(/\D/g, '');
  // shortcut: solo celulares de México a 10 dígitos, ampliar si hay socios con número extranjero
  if (celular.length !== 10) return { error: 'El celular debe tener 10 dígitos' };
  return { datos: [nombre.trim(), apellido1.trim(), texto(apellido2) ? apellido2.trim() : null, celular] };
}

app.post('/api/socios', (req, res) => {
  const { error, datos } = validarSocio(req.body);
  if (error) return res.status(400).json({ error });
  if (!db.prepare('SELECT 1 FROM planes WHERE id = ? AND activo = 1').get(req.body.plan_id)) return res.status(400).json({ error: 'Elige el plan del socio' });
  const { lastInsertRowid } = db.prepare('INSERT INTO socios (nombre, apellido1, apellido2, telefono, plan_id, codigo) VALUES (?, ?, ?, ?, ?, ?)')
    .run(...datos, req.body.plan_id, nuevoCodigo());
  res.status(201).json(fichaDe(lastInsertRowid));
});

// Corrige datos y da de baja (activo: false) o reactiva. El plan cambia al cobrar, no aquí.
app.put('/api/socios/:id', (req, res) => {
  const { error, datos } = validarSocio(req.body);
  if (error) return res.status(400).json({ error });
  const s = db.prepare('UPDATE socios SET nombre = ?, apellido1 = ?, apellido2 = ?, telefono = ?, activo = ? WHERE id = ? RETURNING id')
    .get(...datos, req.body.activo === false ? 0 : 1, req.params.id);
  if (!s) return res.status(404).json({ error: 'Socio no encontrado' });
  res.json(fichaDe(s.id));
});

const BAJA = 'El socio está dado de baja; reactívalo desde su ficha';

// Con el botón de la ficha llega socio_id; con el QR (lector USB o cámara), su código.
app.post('/api/entradas', (req, res) => {
  const { socio_id, codigo } = req.body, conQR = codigo !== undefined;
  const clave = conQR ? String(codigo).trim().toUpperCase() : null;
  if (conQR && !CODIGO.test(clave)) return res.status(400).json({ error: 'Código QR no válido' });
  const socio = conQR ? db.prepare('SELECT * FROM socios WHERE codigo = ?').get(clave) : db.prepare('SELECT * FROM socios WHERE id = ?').get(socio_id);
  if (!socio) return res.status(404).json({ error: conQR ? 'Código QR no reconocido; puede ser uno viejo' : 'Socio no encontrado' });
  if (!socio.activo) return res.status(400).json({ error: BAJA });
  // Un QR leído dos veces seguidas (la cámara lo ve varias veces) cuenta una sola entrada.
  const repetida = conQR && !!db.prepare("SELECT 1 FROM entradas WHERE socio_id = ? AND fecha > datetime('now', 'localtime', '-5 minutes')").get(socio.id);
  // La entrada se registra siempre; la recepción decide qué hacer si está vencido.
  if (!repetida) db.prepare('INSERT INTO entradas (socio_id, usuario_id) VALUES (?, ?)').run(socio.id, req.usuario.id);
  res.status(repetida ? 200 : 201).json({ ...fichaDe(socio.id), repetida });
});

// QR perdido o compartido: se genera otro y el anterior deja de funcionar.
app.post('/api/socios/:id/codigo', (req, res) => {
  const s = db.prepare('UPDATE socios SET codigo = ? WHERE id = ? RETURNING id').get(nuevoCodigo(), req.params.id);
  if (!s) return res.status(404).json({ error: 'Socio no encontrado' });
  res.json(fichaDe(s.id));
});

app.get('/api/socios/:id/qr', async (req, res) => {
  const s = db.prepare('SELECT codigo FROM socios WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Socio no encontrado' });
  res.set('Cache-Control', 'no-store').type('png').send(await QRCode.toBuffer(s.codigo, { width: 600, margin: 2, errorCorrectionLevel: 'M' }));
});

app.get('/api/entradas', (req, res) => {
  res.json(db.prepare(`
    SELECT e.fecha, s.id AS socio_id, s.nombre_completo AS nombre, s.vence FROM entradas e
    JOIN socios s ON s.id = e.socio_id WHERE date(e.fecha) = $f
    UNION ALL SELECT fecha, NULL, nombre, NULL FROM visitas WHERE date(fecha) = $f AND anulado IS NULL
    ORDER BY fecha DESC`).all({ f: req.query.fecha || hoy() }));
});

app.post('/api/visitas', (req, res) => {
  const { nombre, monto, metodo } = req.body;
  if (!texto(nombre)) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!esMonto(monto)) return res.status(400).json({ error: 'Monto inválido' });
  if (!metodoValido(metodo)) return res.status(400).json({ error: 'Forma de pago inválida' });
  db.prepare('INSERT INTO visitas (nombre, monto, usuario_id, metodo) VALUES (?, ?, ?, ?)').run(nombre.trim(), monto, req.usuario.id, metodo ?? 'efectivo');
  res.status(201).end();
});

app.post('/api/visitas/:id/anular', soloAdmin, (req, res) => {
  const v = db.prepare('UPDATE visitas SET anulado = ? WHERE id = ? AND anulado IS NULL RETURNING id').get(req.usuario.id, req.params.id);
  if (!v) return res.status(404).json({ error: 'Visita no encontrada o ya anulada' });
  res.status(204).end();
});

app.get('/api/productos', (req, res) => res.json(db.prepare('SELECT * FROM productos ORDER BY activo DESC, nombre').all()));

// Entrada de mercancía: suma existencias; si el producto no existe lo crea (o lo reactiva). El precio se actualiza.
app.post('/api/inventario', (req, res) => {
  const { nombre, cantidad, precio } = req.body;
  if (!texto(nombre)) return res.status(400).json({ error: 'El producto es obligatorio' });
  if (!Number.isInteger(cantidad) || cantidad < 1) return res.status(400).json({ error: 'Cantidad inválida' });
  if (!esMonto(precio)) return res.status(400).json({ error: 'Precio inválido' });
  res.status(201).json(db.prepare(`
    INSERT INTO productos (nombre, precio, existencia) VALUES (?, ?, ?)
    ON CONFLICT (nombre) DO UPDATE SET existencia = existencia + excluded.existencia, precio = excluded.precio, activo = 1
    RETURNING *`).get(nombre.trim(), precio, cantidad));
});

// Corrige nombre, precio o existencia (conteo físico) y desactiva productos que ya no se venden.
app.put('/api/productos/:id', soloAdmin, (req, res) => {
  const { nombre, precio, existencia, activo } = req.body;
  if (!texto(nombre)) return res.status(400).json({ error: 'El producto es obligatorio' });
  if (!esMonto(precio)) return res.status(400).json({ error: 'Precio inválido' });
  if (!Number.isInteger(existencia) || existencia < 0) return res.status(400).json({ error: 'Existencia inválida' });
  if (db.prepare('SELECT 1 FROM productos WHERE nombre = ? AND id != ?').get(nombre.trim(), Number(req.params.id)))
    return res.status(409).json({ error: 'Ya existe un producto con ese nombre' });
  const p = db.prepare('UPDATE productos SET nombre = ?, precio = ?, existencia = ?, activo = ? WHERE id = ? RETURNING *')
    .get(nombre.trim(), precio, existencia, activo === false ? 0 : 1, req.params.id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(p);
});

app.post('/api/pagos', (req, res) => {
  const { socio_id, plan_id, inscripcion, descuento = 0, pagado, metodo, acompanantes = [] } = req.body;
  if (!metodoValido(metodo)) return res.status(400).json({ error: 'Forma de pago inválida' });
  // Los precios salen de la base, nunca del navegador.
  const plan = db.prepare('SELECT * FROM planes WHERE id = ? AND activo = 1').get(plan_id);
  if (!plan) return res.status(400).json({ error: 'Plan inválido' });
  const cuotaInscripcion = inscripcion === true ? precioInscripcion() : 0;
  if (!esCantidad(descuento) || descuento > plan.precio + cuotaInscripcion) return res.status(400).json({ error: 'Descuento inválido' });
  if (!esCantidad(pagado)) return res.status(400).json({ error: 'Monto pagado inválido' });
  const socio = db.prepare('SELECT * FROM socios WHERE id = ?').get(socio_id);
  if (!socio) return res.status(404).json({ error: 'Socio no encontrado' });
  if (!socio.activo) return res.status(400).json({ error: BAJA });
  // Plan de grupo: hacen falta exactamente (personas - 1) acompañantes distintos, activos y que no sean quien paga.
  const faltan = plan.personas - 1;
  if (!Array.isArray(acompanantes) || !acompanantes.every(Number.isInteger) || acompanantes.length !== faltan || new Set([socio.id, ...acompanantes]).size !== plan.personas)
    return res.status(400).json({ error: faltan ? `Elige ${faltan} ${faltan === 1 ? 'acompañante distinto' : 'acompañantes distintos'}` : 'Este plan es individual' });
  const otros = acompanantes.map(id => db.prepare('SELECT * FROM socios WHERE id = ?').get(id));
  if (otros.includes(undefined)) return res.status(404).json({ error: 'Acompañante no encontrado' });
  const inactivo = otros.find(o => !o.activo);
  if (inactivo) return res.status(400).json({ error: `${inactivo.nombre_completo}: ${BAJA}` });
  const cargo = centavos(plan.precio + cuotaInscripcion - descuento);
  const vence = extenderVigencia(socio.vence, plan.duracion, plan.unidad);
  db.transaction(() => {
    const { lastInsertRowid: pagoId } = db.prepare(`INSERT INTO pagos (socio_id, plan, meses, monto, usuario_id, plan_id, precio, inscripcion, descuento, cargo, metodo, vence_antes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(socio.id, plan.nombre, plan.unidad === 'meses' ? plan.duracion : 0, centavos(pagado), req.usuario.id, plan.id, plan.precio, cuotaInscripcion, descuento, cargo,
        metodo ?? 'efectivo', socio.vence ?? '');
    // Su plan pasa a ser el último que pagó; el aviso de vencimiento ya no aplica.
    db.prepare('UPDATE socios SET vence = ?, plan_id = ?, avisado = NULL WHERE id = ?').run(vence, plan.id, socio.id);
    for (const o of otros) {
      db.prepare('INSERT INTO pago_acompanantes (pago_id, socio_id, vence_antes) VALUES (?, ?, ?)').run(pagoId, o.id, o.vence ?? '');
      db.prepare('UPDATE socios SET vence = ?, plan_id = ?, avisado = NULL WHERE id = ?').run(extenderVigencia(o.vence, plan.duracion, plan.unidad), plan.id, o.id);
    }
  })();
  res.status(201).json(fichaDe(socio.id));
});

// Solo el último pago vigente del socio: así su vencimiento vuelve exactamente al de antes.
app.post('/api/pagos/:id/anular', soloAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM pagos WHERE id = ? AND anulado IS NULL').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Pago no encontrado o ya anulado' });
  if (p.vence_antes === null) return res.status(400).json({ error: 'Este pago es anterior a las anulaciones y no se puede anular' });
  if (ultimoPagoDe(p.socio_id) !== p.id) return res.status(400).json({ error: 'Solo se puede anular el último pago del socio' });
  // En un plan de grupo, cada acompañante también debe seguir con el vencimiento que le dio este pago.
  const acomp = db.prepare('SELECT a.*, s.nombre_completo FROM pago_acompanantes a JOIN socios s ON s.id = a.socio_id WHERE a.pago_id = ?').all(p.id);
  const movido = acomp.find(a => ultimoPagoDe(a.socio_id) !== p.id);
  if (movido) return res.status(400).json({ error: `${movido.nombre_completo} ya tiene un pago posterior; anúlalo primero` });
  db.transaction(() => {
    db.prepare('UPDATE pagos SET anulado = ? WHERE id = ?').run(req.usuario.id, p.id);
    db.prepare('UPDATE socios SET vence = ? WHERE id = ?').run(p.vence_antes || null, p.socio_id);
    for (const a of acomp) db.prepare('UPDATE socios SET vence = ? WHERE id = ?').run(a.vence_antes || null, a.socio_id);
  })();
  res.json(fichaDe(p.socio_id));
});

app.get('/api/pagos', (req, res) => {
  res.json(db.prepare(`
    SELECT p.*, s.nombre_completo AS nombre FROM pagos p JOIN socios s ON s.id = p.socio_id
    WHERE date(p.fecha) = ? ORDER BY p.id DESC`).all(req.query.fecha || hoy()));
});

app.post('/api/ventas', (req, res) => {
  const { producto_id, cantidad, metodo } = req.body;
  if (!Number.isInteger(cantidad) || cantidad < 1) return res.status(400).json({ error: 'Cantidad inválida' });
  if (!metodoValido(metodo)) return res.status(400).json({ error: 'Forma de pago inválida' });
  const p = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(producto_id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const vendido = db.transaction(() => {
    // Descuenta solo si alcanza; así dos ventas simultáneas no dejan existencia negativa.
    if (!db.prepare('UPDATE productos SET existencia = existencia - ? WHERE id = ? AND existencia >= ?').run(cantidad, p.id, cantidad).changes) return false;
    db.prepare('INSERT INTO ventas (concepto, cantidad, monto, producto_id, usuario_id, metodo) VALUES (?, ?, ?, ?, ?, ?)')
      .run(p.nombre, cantidad, centavos(p.precio * cantidad), p.id, req.usuario.id, metodo ?? 'efectivo');
    return true;
  })();
  if (!vendido) return res.status(400).json({ error: `Solo hay ${p.existencia} de ${p.nombre}` });
  res.status(201).end();
});

// Anula la venta y devuelve la mercancía al inventario.
app.post('/api/ventas/:id/anular', soloAdmin, (req, res) => {
  const ok = db.transaction(() => {
    const v = db.prepare('UPDATE ventas SET anulado = ? WHERE id = ? AND anulado IS NULL RETURNING *').get(req.usuario.id, req.params.id);
    if (v?.producto_id) db.prepare('UPDATE productos SET existencia = existencia + ? WHERE id = ?').run(v.cantidad, v.producto_id);
    return !!v;
  })();
  if (!ok) return res.status(404).json({ error: 'Venta no encontrada o ya anulada' });
  res.status(204).end();
});

app.get('/api/ventas', (req, res) => {
  res.json(db.prepare('SELECT * FROM ventas WHERE date(fecha) = ? ORDER BY id DESC').all(req.query.fecha || hoy()));
});

// Corte de caja: todo lo cobrado en el día. Los anulados se listan pero no suman.
app.get('/api/corte', (req, res) => {
  const movimientos = db.prepare(`
    WITH mov AS (
      SELECT 'pago' AS tipo, p.id, p.fecha, s.nombre_completo || ' · ' || p.plan
          || coalesce(' (con ' || (SELECT group_concat(o.nombre_completo, ', ') FROM pago_acompanantes a JOIN socios o ON o.id = a.socio_id WHERE a.pago_id = p.id) || ')', '') AS concepto, p.monto, p.metodo, p.usuario_id, p.anulado
        FROM pagos p JOIN socios s ON s.id = p.socio_id WHERE date(p.fecha) = $f
      UNION ALL SELECT 'visita', id, fecha, 'Visita: ' || nombre, monto, metodo, usuario_id, anulado FROM visitas WHERE date(fecha) = $f
      UNION ALL SELECT 'venta', id, fecha, cantidad || ' × ' || concepto, monto, metodo, usuario_id, anulado FROM ventas WHERE date(fecha) = $f
    )
    SELECT mov.tipo, mov.id, mov.fecha, mov.concepto, mov.monto, mov.metodo, coalesce(u.nombre, '—') AS usuario, mov.anulado IS NOT NULL AS anulado
    FROM mov LEFT JOIN usuarios u ON u.id = mov.usuario_id ORDER BY mov.fecha DESC`).all({ f: req.query.fecha || hoy() })
    .map(m => ({ ...m, anulado: !!m.anulado }));
  res.json({ movimientos, ...totalesCorte(movimientos) });
});

function totalesCorte(movimientos) {
  const t = { total: 0, por_tipo: {}, por_metodo: {}, por_usuario: {} };
  for (const m of movimientos.filter(m => !m.anulado)) {
    t.total += m.monto;
    for (const [grupo, clave] of [['por_tipo', m.tipo], ['por_metodo', m.metodo], ['por_usuario', m.usuario]])
      t[grupo][clave] = centavos((t[grupo][clave] ?? 0) + m.monto);
  }
  t.total = centavos(t.total);
  return t;
}

// Copia diaria de la base (una por día, se guardan las últimas `conservar`).
// BACKUP_DIR conviene que apunte a otro disco o a una carpeta sincronizada (Drive, Dropbox).
async function respaldar(dir = process.env.BACKUP_DIR || 'respaldos', conservar = 14) {
  fs.mkdirSync(dir, { recursive: true });
  await db.backup(path.join(dir, `gimnasio-${hoy()}.db`));
  const viejos = fs.readdirSync(dir).filter(f => /^gimnasio-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -conservar);
  for (const f of viejos) fs.unlinkSync(path.join(dir, f));
}

if (require.main === module) {
  const copia = () => respaldar().catch(e => console.error('No se pudo hacer el respaldo:', e.message));
  copia();
  setInterval(copia, 6 * 3600e3); // cada 6 h: si la compu se apaga de noche, igual sale la del día
  app.listen(3000, () => console.log('API en http://localhost:3000'));
}

module.exports = { app, extenderVigencia, crearUsuario, diasHasta, respaldar, totalesCorte };
