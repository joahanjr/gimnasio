process.env.DB_FILE = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { app, extenderVigencia, crearUsuario, diasHasta, respaldar, totalesCorte } = require('./server');

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
    const primera = await post('/login', { usuario: 'admin', clave: 'admin' });
    assert.equal((await primera.clone().json()).cambiar_clave, true);
    cookie = primera.headers.get('set-cookie').split(';')[0];
    const put = (p, body) => fetch(url + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
    // Con admin/admin solo puede cambiar la contraseña.
    assert.equal((await get('/socios')).status, 403);
    assert.equal((await put('/clave', { actual: 'admin', nueva: 'admin' })).status, 400);
    assert.equal((await put('/clave', { actual: 'admin', nueva: 'nueva123' })).status, 204);
    assert.equal((await (await get('/yo')).json()).cambiar_clave, false);
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

    // Admin: crea personal y cambia su contraseña.
    assert.equal((await post('/login', { usuario: 'admin', clave: 'admin' })).status, 401);
    cookie = (await post('/login', { usuario: 'admin', clave: 'nueva123' })).headers.get('set-cookie').split(';')[0];
    assert.equal((await post('/usuarios', { usuario: 'luis', nombre: 'Luis', clave: '1234', rol: 'jefe' })).status, 400);
    const luis = await (await post('/usuarios', { usuario: 'luis', nombre: 'Luis', clave: '1234', rol: 'recepcion' })).json();
    assert.equal((await post('/usuarios', { usuario: 'luis', nombre: 'Otro', clave: '1234', rol: 'recepcion' })).status, 409);
    assert.equal((await (await get('/usuarios')).json()).length, 3);
    assert.equal((await put('/clave', { actual: 'mala', nueva: 'otra' })).status, 400);
    assert.equal((await (await post('/login', { usuario: 'luis', clave: '1234' })).json()).cambiar_clave, true); // la puso el admin

    // Editar y desactivar usuarios; el admin no puede quitarse a sí mismo.
    const yo = await (await get('/yo')).json();
    assert.equal((await put(`/usuarios/${yo.id}`, { nombre: 'Admin', rol: 'recepcion' })).status, 400);
    assert.equal((await put(`/usuarios/${yo.id}`, { nombre: 'Admin', rol: 'admin', activo: false })).status, 400);
    assert.equal((await put(`/usuarios/${luis.id}`, { nombre: 'Luis P.', rol: 'recepcion', activo: false })).status, 200);
    assert.equal((await post('/login', { usuario: 'luis', clave: '1234' })).status, 401); // desactivado
    assert.equal((await put('/usuarios/999', { nombre: 'X', rol: 'recepcion' })).status, 404);

    // Editar socio y darlo de baja.
    const editar = b => put(`/socios/${socio.id}`, { nombre: 'Ana', apellido1: 'Ruiz', apellido2: 'Gil', telefono: '5598765432', ...b });
    assert.equal((await editar({ telefono: '123' })).status, 400);
    assert.equal((await (await editar({})).json()).nombre_completo, 'Ana Ruiz Gil');
    assert.equal((await (await editar({ activo: false })).json()).activo, 0);
    assert.equal((await post('/entradas', { socio_id: socio.id })).status, 400);
    assert.equal((await pagar({ pagado: 500 })).status, 400);
    assert.equal((await (await editar({ activo: true })).json()).activo, 1);

    // Anular: solo el último pago, y el vencimiento regresa al de antes.
    const antes = await (await get(`/socios/${socio.id}`)).json();
    const nuevo = await (await pagar({ pagado: 500, metodo: 'tarjeta' })).json();
    assert.ok(nuevo.vence > antes.vence);
    assert.equal((await pagar({ pagado: 500, metodo: 'cheque' })).status, 400);
    const [ultimo, penultimo] = (await (await get(`/socios/${socio.id}`)).json()).pagos;
    assert.equal(ultimo.metodo, 'tarjeta');
    assert.equal((await post(`/pagos/${penultimo.id}/anular`)).status, 400);
    const anulado = await (await post(`/pagos/${ultimo.id}/anular`)).json();
    assert.equal(anulado.vence, antes.vence);
    assert.equal(anulado.saldo, antes.saldo);
    assert.equal((await post(`/pagos/${ultimo.id}/anular`)).status, 404);

    // Anular una venta devuelve la mercancía; los productos inactivos no se venden.
    const venta = (await (await get('/ventas')).json())[0];
    assert.equal((await post(`/ventas/${venta.id}/anular`)).status, 204);
    assert.equal((await (await get('/productos')).json())[0].existencia, 5);
    assert.equal((await put(`/productos/${agua.id}`, { nombre: 'Agua', precio: 18, existencia: 4, activo: false })).status, 200);
    assert.equal((await post('/ventas', { producto_id: agua.id, cantidad: 1 })).status, 404);

    // Corte de caja: membresías 550 + 600 (el de tarjeta se anuló), visita 50; la venta anulada no suma.
    const corte = await (await get('/corte')).json();
    assert.equal(corte.total, 1200);
    assert.deepEqual(corte.por_tipo, { pago: 1150, visita: 50 });
    assert.equal(corte.movimientos.filter(m => m.anulado).length, 2);

    // Avisos: Ana vence en ~2 meses, no sale a 7 días pero sí a 90.
    assert.equal((await (await get('/avisos')).json()).length, 0);
    assert.equal((await (await get('/avisos?dias=90')).json())[0].id, socio.id);
    assert.equal((await (await post(`/socios/${socio.id}/aviso`)).json()).avisado.length, 10);

    // Fuerza bruta: al 6.º intento fallido se bloquea aunque la contraseña sea correcta.
    for (let i = 0; i < 5; i++) assert.equal((await post('/login', { usuario: 'maria', clave: 'mala' })).status, 401);
    assert.equal((await post('/login', { usuario: 'maria', clave: 'secreta' })).status, 429);
  } finally {
    srv.close();
  }
});

test('plan de pareja o grupo: uno paga y a los demás se les activa', async () => {
  const srv = app.listen(0);
  const url = `http://localhost:${srv.address().port}/api`;
  let cookie = '';
  const req = (metodo, p, body) => fetch(url + p, { method: metodo, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
  const post = (p, b) => req('POST', p, b), get = p => req('GET', p), json = r => r.then(x => x.json());
  try {
    cookie = (await post('/login', { usuario: 'admin', clave: 'nueva123' })).headers.get('set-cookie').split(';')[0];
    assert.equal((await post('/planes', { nombre: 'Grupo 5', duracion: 1, unidad: 'meses', precio: 1, personas: 5 })).status, 400);
    const pareja = await json(post('/planes', { nombre: 'Pareja', duracion: 1, unidad: 'meses', precio: 800, personas: 2 }));
    const trio = await json(post('/planes', { nombre: 'Trío', duracion: 1, unidad: 'meses', precio: 1100, personas: 3 }));
    const solo = (await json(get('/planes'))).find(p => p.nombre === 'Mensual');
    assert.equal(solo.personas, 1); // los planes de antes quedan individuales
    const alta = n => json(post('/socios', { nombre: n, apellido1: 'Grupo', telefono: '5511112222', plan_id: pareja.id }));
    const [luz, sol, mar] = [await alta('Luz'), await alta('Sol'), await alta('Mar')];
    const pagar = b => post('/pagos', { socio_id: luz.id, plan_id: pareja.id, pagado: 800, ...b });

    // Validaciones: número exacto de acompañantes, distintos, que existan y no sea quien paga.
    assert.equal((await pagar({})).status, 400);
    assert.equal((await pagar({ acompanantes: [luz.id] })).status, 400);
    assert.equal((await pagar({ acompanantes: [sol.id, mar.id] })).status, 400);
    assert.equal((await pagar({ acompanantes: ['x'] })).status, 400);
    assert.equal((await pagar({ acompanantes: [9999] })).status, 404);
    assert.equal((await pagar({ plan_id: solo.id, pagado: 500, acompanantes: [sol.id] })).status, 400);
    assert.equal((await post('/pagos', { socio_id: luz.id, plan_id: trio.id, pagado: 1100, acompanantes: [sol.id, sol.id] })).status, 400);

    // Paga Luz: a Sol se le activa igual, sin cobro ni saldo.
    const pagoLuz = await json(pagar({ acompanantes: [sol.id] }));
    const fichaSol = await json(get(`/socios/${sol.id}`));
    assert.equal(fichaSol.vence, pagoLuz.vence);
    assert.equal(fichaSol.vigente, true);
    assert.equal(fichaSol.saldo, 0);
    assert.equal(fichaSol.plan, 'Pareja');
    assert.match(fichaSol.pagos[0].pagado_por, /Luz Grupo/);
    const fichaLuz = await json(get(`/socios/${luz.id}`));
    assert.equal(fichaLuz.saldo, 0);
    assert.match(fichaLuz.pagos[0].acompanantes, /Sol Grupo/);
    assert.match((await json(get('/corte'))).movimientos.find(m => m.id === fichaLuz.pagos[0].id && m.tipo === 'pago').concepto, /con Sol Grupo/);

    // Si Sol paga después por su cuenta, el pago de pareja no se puede anular hasta anular el de Sol.
    const pagoSol = await json(post('/pagos', { socio_id: sol.id, plan_id: solo.id, pagado: 500 }));
    assert.ok(pagoSol.vence > fichaSol.vence);
    const idPareja = fichaLuz.pagos[0].id;
    assert.equal((await post(`/pagos/${idPareja}/anular`)).status, 400);
    assert.equal((await post(`/pagos/${(await json(get(`/socios/${sol.id}`))).pagos[0].id}/anular`)).status, 200);
    // Ya sin el pago de Sol, se anula el de pareja y los dos regresan a como estaban.
    assert.equal((await post(`/pagos/${idPareja}/anular`)).status, 200);
    assert.equal((await json(get(`/socios/${luz.id}`))).vence, null);
    assert.equal((await json(get(`/socios/${sol.id}`))).vence, null);
    assert.equal((await json(get(`/socios/${sol.id}`))).pagos[1].anulado, true);
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

test('totalesCorte ignora anulados y redondea a centavos', () => {
  const t = totalesCorte([
    { tipo: 'pago', metodo: 'efectivo', usuario: 'Ana', monto: 0.1, anulado: false },
    { tipo: 'venta', metodo: 'tarjeta', usuario: 'Ana', monto: 0.2, anulado: false },
    { tipo: 'venta', metodo: 'efectivo', usuario: 'Luis', monto: 99, anulado: true }
  ]);
  assert.equal(t.total, 0.3);
  assert.deepEqual(t.por_metodo, { efectivo: 0.1, tarjeta: 0.2 });
  assert.deepEqual(Object.keys(t.por_usuario), ['Ana']);
});

test('respaldar guarda la copia del día y conserva solo las últimas', async () => {
  const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resp-'));
  try {
    for (let d = 1; d <= 5; d++) fs.writeFileSync(path.join(dir, `gimnasio-2020-01-0${d}.db`), '');
    fs.writeFileSync(path.join(dir, 'otro.txt'), '');
    await respaldar(dir, 3);
    const quedan = fs.readdirSync(dir).sort();
    assert.deepEqual(quedan, ['gimnasio-2020-01-04.db', 'gimnasio-2020-01-05.db', `gimnasio-${new Date().toLocaleDateString('sv')}.db`, 'otro.txt'].sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
