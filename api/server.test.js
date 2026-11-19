process.env.DB_FILE = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { app, extenderVigencia, crearUsuario, diasHasta } = require('./server');

test('extenderVigencia', () => {
  assert.equal(extenderVigencia(null, 1, 'meses', '2026-01-15'), '2026-02-15');          // sin membresía: desde hoy
  assert.equal(extenderVigencia('2026-01-10', 1, 'meses', '2026-01-15'), '2026-02-15');  // vencida: desde hoy
  assert.equal(extenderVigencia('2026-01-20', 1, 'meses', '2026-01-15'), '2026-02-20');  // vigente: se acumula
  assert.equal(extenderVigencia(null, 1, 'meses', '2026-01-31'), '2026-02-28');          // fin de mes
  assert.equal(extenderVigencia(null, 12, 'meses', '2026-11-30'), '2027-11-30');         // cambio de año
  assert.equal(extenderVigencia(null, 7, 'dias', '2026-12-28'), '2027-01-04');          // plan semanal
});

test('diasHasta', () => {
  assert.equal(diasHasta('2026-11-18', '2026-11-18'), 0);   // último día
  assert.equal(diasHasta('2026-12-18', '2026-11-18'), 30);
  assert.equal(diasHasta('2026-11-15', '2026-11-18'), -3);  // vencido hace 3 días
  assert.equal(diasHasta('2027-01-02', '2026-12-30'), 3);   // cambio de año
});

test('flujo socio → pago → entrada', async () => {
  const srv = app.listen(0);
  const url = `http://localhost:${srv.address().port}/api`;
  let cookie = '';
  const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  const get = p => fetch(url + p, { headers: { cookie } });
  try {
    crearUsuario('maria', 'María', 'secreta');
    assert.equal((await get('/socios')).status, 401);

    // El admin da de alta los planes y la inscripción.
    cookie = (await post('/login', { usuario: 'admin', clave: 'admin' })).headers.get('set-cookie').split(';')[0];
    const put = (p, body) => fetch(url + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
    assert.equal((await post('/planes', { nombre: 'Mensual', duracion: 0, unidad: 'meses', precio: 500 })).status, 400);
    const mensual = await (await post('/planes', { nombre: 'Mensual', duracion: 1, unidad: 'meses', precio: 500 })).json();
    assert.equal((await post('/planes', { nombre: 'mensual', duracion: 1, unidad: 'meses', precio: 400 })).status, 409);
    const viejo = await (await post('/planes', { nombre: 'Viejo', duracion: 7, unidad: 'dias', precio: 150 })).json();
    assert.equal((await put(`/planes/${viejo.id}`, { ...viejo, activo: false })).status, 200);
    assert.equal((await put('/ajustes', { inscripcion: 200 })).status, 200);
    assert.equal((await post('/logout')).status, 204);

    assert.equal((await post('/login', { usuario: 'maria', clave: 'mala' })).status, 401);
    assert.equal((await post('/login', { usuario: 'nadie', clave: 'secreta' })).status, 401);
    const login = await post('/login', { usuario: 'maria', clave: 'secreta' });
    cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await get('/yo')).json()).nombre, 'María');
    assert.equal((await get('/usuarios')).status, 403);  // recepción no administra usuarios
    assert.equal((await post('/planes', { nombre: 'X', duracion: 1, unidad: 'meses', precio: 1 })).status, 403);
    assert.equal((await post('/socios', { nombre: 'Ana', telefono: '5512345678' })).status, 400);              // sin apellido
    assert.equal((await post('/socios', { nombre: 'Ana', apellido1: 'Ruiz', telefono: '55 1234', plan_id: mensual.id })).status, 400); // celular corto
    assert.equal((await post('/socios', { nombre: 'Ana', apellido1: 'Ruiz', telefono: '5512345678' })).status, 400);  // sin plan
    assert.equal((await post('/socios', { nombre: 'Ana', apellido1: 'Ruiz', telefono: '5512345678', plan_id: viejo.id })).status, 400); // plan inactivo
    const socio = await (await post('/socios', { nombre: 'Ana', apellido1: 'Ruiz', telefono: '55 1234 5678', plan_id: mensual.id })).json();
    assert.equal(socio.plan, 'Mensual');
    assert.equal(socio.nombre_completo, 'Ana Ruiz');
    assert.equal(socio.telefono, '5512345678');
    assert.equal((await (await get('/socios?q=ruiz')).json()).length, 1);
    assert.equal(socio.vigente, false);
    const pagar = b => post('/pagos', { socio_id: socio.id, plan_id: mensual.id, ...b });
    assert.equal((await pagar({ pagado: -5 })).status, 400);
    assert.equal((await pagar({ pagado: 100, descuento: 800 })).status, 400);  // descuento mayor que el cobro
    // 500 plan + 200 inscripción − 100 descuento = 600; paga 550 → debe 50
    const pagado = await (await pagar({ inscripcion: true, descuento: 100, pagado: 550 })).json();
    assert.equal(pagado.vigente, true);
    assert.equal(pagado.saldo, -50);
    // Siguiente mes: cargo 500, paga 600 → queda 50 a favor
    assert.equal((await (await pagar({ pagado: 600 })).json()).saldo, 50);
    const entrada = await (await post('/entradas', { socio_id: socio.id })).json();
    const foto = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const subir = (tipo, body) => fetch(`${url}/socios/${socio.id}/foto`, { method: 'PUT', headers: { 'Content-Type': tipo, cookie }, body });
    assert.equal((await subir('text/plain', 'hola')).status, 400);
    assert.equal((await subir('image/jpeg', foto)).status, 204);
    assert.deepEqual(Buffer.from(await (await get(`/socios/${socio.id}/foto`)).arrayBuffer()), foto);
    assert.equal((await (await get('/socios?q=ana')).json())[0].tiene_foto, true);
    const ficha = await (await get(`/socios/${socio.id}`)).json();
    assert.equal(ficha.entradas.length, 1);
    assert.ok(ficha.dias_restantes >= 58);
    assert.equal(ficha.ultimo_pago.plan, 'Mensual');
    assert.equal((await get('/socios/999')).status, 404);
    assert.equal(entrada.nombre, 'Ana');
    assert.equal((await (await get('/entradas')).json()).length, 1);
    assert.equal((await post('/entradas', { socio_id: 999 })).status, 404);

    assert.equal((await post('/visitas', { nombre: 'Pedro', monto: 0 })).status, 400);
    assert.equal((await post('/visitas', { nombre: 'Pedro', monto: 50 })).status, 201);
    assert.deepEqual((await (await get('/entradas')).json()).map(e => e.nombre).sort(), ['Ana Ruiz', 'Pedro']);

    const agua = await (await post('/inventario', { nombre: 'Agua', cantidad: 2, precio: 15 })).json();
    assert.equal((await (await post('/inventario', { nombre: 'agua', cantidad: 3, precio: 20 })).json()).existencia, 5); // mismo producto
    assert.equal((await post('/ventas', { producto_id: agua.id, cantidad: 6 })).status, 400);  // no alcanza
    assert.equal((await post('/ventas', { producto_id: agua.id, cantidad: 2 })).status, 201);
    assert.equal((await (await get('/productos')).json())[0].existencia, 3);
    assert.equal((await (await get('/ventas')).json())[0].monto, 40);
    assert.equal((await post('/logout')).status, 204);
    assert.equal((await get('/yo')).status, 401);

    // Admin por defecto: crea personal y cambia su contraseña.
    cookie = (await post('/login', { usuario: 'admin', clave: 'admin' })).headers.get('set-cookie').split(';')[0];
    assert.equal((await post('/usuarios', { usuario: 'luis', nombre: 'Luis', clave: '1234', rol: 'jefe' })).status, 400);
    assert.equal((await post('/usuarios', { usuario: 'luis', nombre: 'Luis', clave: '1234', rol: 'recepcion' })).status, 201);
    assert.equal((await post('/usuarios', { usuario: 'luis', nombre: 'Otro', clave: '1234', rol: 'recepcion' })).status, 409);
    assert.equal((await (await get('/usuarios')).json()).length, 3);
    assert.equal((await put('/clave', { actual: 'mala', nueva: 'nueva123' })).status, 400);
    assert.equal((await put('/clave', { actual: 'admin', nueva: 'nueva123' })).status, 204);
    assert.equal((await post('/login', { usuario: 'admin', clave: 'admin' })).status, 401);
    assert.equal((await post('/login', { usuario: 'admin', clave: 'nueva123' })).status, 200);
  } finally {
    srv.close();
  }
});

test('las migraciones se pueden correr varias veces sobre la misma base', () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-'));
  const env = { ...process.env, DB_FILE: path.join(dir, 'prueba.db') };
  try {
    for (let i = 0; i < 2; i++) execFileSync(process.execPath, ['-e', "require('./server')"], { cwd: __dirname, env });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
