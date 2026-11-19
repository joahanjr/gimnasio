const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');

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

function hashClave(clave, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(clave, salt, 64).toString('hex')}`;
}
function claveCorrecta(clave, guardada) {
  const [salt, hash] = guardada.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(clave, salt, 64));
}
function crearUsuario(usuario, nombre, clave, rol = 'recepcion') {
  return db.prepare('INSERT INTO usuarios (usuario, nombre, clave, rol) VALUES (?, ?, ?, ?)').run(usuario, nombre, hashClave(clave), rol);
}
const ROLES = ['admin', 'recepcion'];
// Sin ningún admin (primer arranque): admin/admin, a cambiar desde la app.
if (!db.prepare("SELECT 1 FROM usuarios WHERE rol = 'admin'").get()) crearUsuario('admin', 'Administrador', 'admin', 'admin');

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

app.post('/api/login', (req, res) => {
  const { usuario, clave } = req.body;
  const u = texto(usuario) && texto(clave) && db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario.trim());
  if (!u || !claveCorrecta(clave, u.clave)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (token, usuario_id) VALUES (?, ?)').run(token, u.id);
  res.set('Set-Cookie', `sesion=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DOCE_HORAS}`);
  res.json({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol });
});

// Todo lo demás de /api requiere sesión.
app.use('/api', (req, res, next) => {
  req.usuario = db.prepare(`
    SELECT u.id, u.usuario, u.nombre, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND s.creado > datetime('now','localtime','-12 hours')`).get(leerToken(req) ?? '');
  if (!req.usuario) return res.status(401).json({ error: 'Sesión no iniciada' });
  next();
});

app.get('/api/yo', (req, res) => res.json(req.usuario));

app.put('/api/clave', (req, res) => {
  const { actual, nueva } = req.body;
  const u = db.prepare('SELECT clave FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!texto(actual) || !claveCorrecta(actual, u.clave)) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
  if (!texto(nueva) || nueva.length < 4) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  db.prepare('UPDATE usuarios SET clave = ? WHERE id = ?').run(hashClave(nueva), req.usuario.id);
  res.status(204).end();
});

const soloAdmin = (req, res, next) => req.usuario.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo el administrador' });

app.get('/api/usuarios', soloAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, usuario, nombre, rol FROM usuarios ORDER BY nombre').all());
});

app.post('/api/usuarios', soloAdmin, (req, res) => {
  const { usuario, nombre, clave, rol } = req.body;
  if (!texto(usuario) || !texto(nombre)) return res.status(400).json({ error: 'Usuario y nombre son obligatorios' });
  if (!texto(clave) || clave.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(usuario.trim())) return res.status(409).json({ error: 'Ese usuario ya existe' });
  const { lastInsertRowid } = crearUsuario(usuario.trim(), nombre.trim(), clave, rol);
  res.status(201).json({ id: lastInsertRowid, usuario: usuario.trim(), nombre: nombre.trim(), rol });
});

app.post('/api/logout', (req, res) => {
  db.prepare('DELETE FROM sesiones WHERE token = ?').run(leerToken(req));
  res.set('Set-Cookie', 'sesion=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.status(204).end();
});

app.get('/api/planes', (req, res) => res.json(db.prepare('SELECT * FROM planes ORDER BY activo DESC, precio').all()));

function validarPlan({ nombre, duracion, unidad, precio }) {
  if (!texto(nombre)) return 'El nombre del plan es obligatorio';
  if (!Number.isInteger(duracion) || duracion < 1) return 'Duración inválida';
  if (!['meses', 'dias'].includes(unidad)) return 'Unidad inválida';
  if (!esMonto(precio)) return 'Precio inválido';
}
const nombreRepetido = (nombre, id = -1) => db.prepare('SELECT 1 FROM planes WHERE nombre = ? AND id != ?').get(nombre.trim(), id);

app.post('/api/planes', soloAdmin, (req, res) => {
  const error = validarPlan(req.body);
  if (error) return res.status(400).json({ error });
  const { nombre, duracion, unidad, precio } = req.body;
  if (nombreRepetido(nombre)) return res.status(409).json({ error: 'Ya existe un plan con ese nombre' });
  res.status(201).json(db.prepare('INSERT INTO planes (nombre, duracion, unidad, precio) VALUES (?, ?, ?, ?) RETURNING *').get(nombre.trim(), duracion, unidad, precio));
});

app.put('/api/planes/:id', soloAdmin, (req, res) => {
  const error = validarPlan(req.body);
  if (error) return res.status(400).json({ error });
  const { nombre, duracion, unidad, precio, activo } = req.body;
  if (nombreRepetido(nombre, Number(req.params.id))) return res.status(409).json({ error: 'Ya existe un plan con ese nombre' });
  const plan = db.prepare('UPDATE planes SET nombre = ?, duracion = ?, unidad = ?, precio = ?, activo = ? WHERE id = ? RETURNING *')
    .get(nombre.trim(), duracion, unidad, precio, activo === false ? 0 : 1, req.params.id);
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
  (SELECT round(coalesce(sum(monto - coalesce(cargo, monto)), 0), 2) FROM pagos p WHERE p.socio_id = s.id) AS saldo
  FROM socios s`;
const conFicha = s => s && conEstado({ ...s, tiene_foto: !!s.tiene_foto });

app.get('/api/socios', (req, res) => {
  const q = String(req.query.q || '').trim();
  const filas = q
    ? db.prepare(`${FICHA} WHERE s.id = ? OR s.nombre_completo LIKE ? ORDER BY s.nombre_completo LIMIT 50`).all(Number(q) || -1, `%${q}%`)
    : db.prepare(`${FICHA} ORDER BY s.nombre_completo`).all();
  res.json(filas.map(conFicha));
});

app.get('/api/socios/:id', (req, res) => {
  const socio = conFicha(db.prepare(`${FICHA} WHERE s.id = ?`).get(req.params.id));
  if (!socio) return res.status(404).json({ error: 'Socio no encontrado' });
  res.json({
    ...socio,
    entradas: db.prepare('SELECT fecha FROM entradas WHERE socio_id = ? ORDER BY id DESC').pluck().all(socio.id),
    ultimo_pago: db.prepare('SELECT fecha, plan, monto FROM pagos WHERE socio_id = ? ORDER BY id DESC LIMIT 1').get(socio.id) ?? null
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

app.post('/api/socios', (req, res) => {
  const { nombre, apellido1, apellido2, telefono, plan_id } = req.body;
  if (!texto(nombre) || !texto(apellido1)) return res.status(400).json({ error: 'El nombre y el primer apellido son obligatorios' });
  if (!db.prepare('SELECT 1 FROM planes WHERE id = ? AND activo = 1').get(plan_id)) return res.status(400).json({ error: 'Elige el plan del socio' });
  const celular = String(telefono ?? '').replace(/\D/g, '');
  // shortcut: solo celulares de México a 10 dígitos, ampliar si hay socios con número extranjero
  if (celular.length !== 10) return res.status(400).json({ error: 'El celular debe tener 10 dígitos' });
  const { lastInsertRowid } = db.prepare('INSERT INTO socios (nombre, apellido1, apellido2, telefono, plan_id) VALUES (?, ?, ?, ?, ?)')
    .run(nombre.trim(), apellido1.trim(), texto(apellido2) ? apellido2.trim() : null, celular, plan_id);
  res.status(201).json(conFicha(db.prepare(`${FICHA} WHERE s.id = ?`).get(lastInsertRowid)));
});

app.post('/api/entradas', (req, res) => {
  const socio = conEstado(db.prepare('SELECT * FROM socios WHERE id = ?').get(req.body.socio_id));
  if (!socio) return res.status(404).json({ error: 'Socio no encontrado' });
  // La entrada se registra siempre; la recepción decide qué hacer si está vencido.
  db.prepare('INSERT INTO entradas (socio_id, usuario_id) VALUES (?, ?)').run(socio.id, req.usuario.id);
  res.status(201).json(socio);
});

app.get('/api/entradas', (req, res) => {
  res.json(db.prepare(`
    SELECT e.fecha, s.id AS socio_id, s.nombre_completo AS nombre, s.vence FROM entradas e
    JOIN socios s ON s.id = e.socio_id WHERE date(e.fecha) = $f
    UNION ALL SELECT fecha, NULL, nombre, NULL FROM visitas WHERE date(fecha) = $f
    ORDER BY fecha DESC`).all({ f: req.query.fecha || hoy() }));
});

app.post('/api/visitas', (req, res) => {
  const { nombre, monto } = req.body;
  if (!texto(nombre)) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!esMonto(monto)) return res.status(400).json({ error: 'Monto inválido' });
  db.prepare('INSERT INTO visitas (nombre, monto, usuario_id) VALUES (?, ?, ?)').run(nombre.trim(), monto, req.usuario.id);
  res.status(201).end();
});

app.get('/api/productos', (req, res) => res.json(db.prepare('SELECT * FROM productos ORDER BY nombre').all()));

// Entrada de mercancía: suma existencias; si el producto no existe lo crea. El precio se actualiza.
app.post('/api/inventario', (req, res) => {
  const { nombre, cantidad, precio } = req.body;
  if (!texto(nombre)) return res.status(400).json({ error: 'El producto es obligatorio' });
  if (!Number.isInteger(cantidad) || cantidad < 1) return res.status(400).json({ error: 'Cantidad inválida' });
  if (!esMonto(precio)) return res.status(400).json({ error: 'Precio inválido' });
  res.status(201).json(db.prepare(`
    INSERT INTO productos (nombre, precio, existencia) VALUES (?, ?, ?)
    ON CONFLICT (nombre) DO UPDATE SET existencia = existencia + excluded.existencia, precio = excluded.precio
    RETURNING *`).get(nombre.trim(), precio, cantidad));
});

app.post('/api/pagos', (req, res) => {
  const { socio_id, plan_id, inscripcion, descuento = 0, pagado } = req.body;
  // Los precios salen de la base, nunca del navegador.
  const plan = db.prepare('SELECT * FROM planes WHERE id = ? AND activo = 1').get(plan_id);
  if (!plan) return res.status(400).json({ error: 'Plan inválido' });
  const cuotaInscripcion = inscripcion === true ? precioInscripcion() : 0;
  if (!esCantidad(descuento) || descuento > plan.precio + cuotaInscripcion) return res.status(400).json({ error: 'Descuento inválido' });
  if (!esCantidad(pagado)) return res.status(400).json({ error: 'Monto pagado inválido' });
  const socio = db.prepare('SELECT * FROM socios WHERE id = ?').get(socio_id);
  if (!socio) return res.status(404).json({ error: 'Socio no encontrado' });
  const cargo = centavos(plan.precio + cuotaInscripcion - descuento);
  const vence = extenderVigencia(socio.vence, plan.duracion, plan.unidad);
  db.transaction(() => {
    db.prepare(`INSERT INTO pagos (socio_id, plan, meses, monto, usuario_id, plan_id, precio, inscripcion, descuento, cargo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(socio.id, plan.nombre, plan.unidad === 'meses' ? plan.duracion : 0, centavos(pagado), req.usuario.id, plan.id, plan.precio, cuotaInscripcion, descuento, cargo);
    db.prepare('UPDATE socios SET vence = ?, plan_id = ? WHERE id = ?').run(vence, plan.id, socio.id); // su plan pasa a ser el último que pagó
  })();
  res.status(201).json(conFicha(db.prepare(`${FICHA} WHERE s.id = ?`).get(socio.id)));
});

app.get('/api/pagos', (req, res) => {
  res.json(db.prepare(`
    SELECT p.*, s.nombre_completo AS nombre FROM pagos p JOIN socios s ON s.id = p.socio_id
    WHERE date(p.fecha) = ? ORDER BY p.id DESC`).all(req.query.fecha || hoy()));
});

app.post('/api/ventas', (req, res) => {
  const { producto_id, cantidad } = req.body;
  if (!Number.isInteger(cantidad) || cantidad < 1) return res.status(400).json({ error: 'Cantidad inválida' });
  const p = db.prepare('SELECT * FROM productos WHERE id = ?').get(producto_id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const vendido = db.transaction(() => {
    // Descuenta solo si alcanza; así dos ventas simultáneas no dejan existencia negativa.
    if (!db.prepare('UPDATE productos SET existencia = existencia - ? WHERE id = ? AND existencia >= ?').run(cantidad, p.id, cantidad).changes) return false;
    db.prepare('INSERT INTO ventas (concepto, cantidad, monto, producto_id, usuario_id) VALUES (?, ?, ?, ?, ?)')
      .run(p.nombre, cantidad, p.precio * cantidad, p.id, req.usuario.id);
    return true;
  })();
  if (!vendido) return res.status(400).json({ error: `Solo hay ${p.existencia} de ${p.nombre}` });
  res.status(201).end();
});

app.get('/api/ventas', (req, res) => {
  res.json(db.prepare('SELECT * FROM ventas WHERE date(fecha) = ? ORDER BY id DESC').all(req.query.fecha || hoy()));
});

if (require.main === module) app.listen(3000, () => console.log('API en http://localhost:3000'));

module.exports = { app, extenderVigencia, crearUsuario, diasHasta };
