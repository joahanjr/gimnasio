# Gimnasio

Sistema de recepción para un gimnasio pequeño: socios, membresías, cobros, tienda, corte de caja y avisos de vencimiento por WhatsApp.

Pensado para usarse en la computadora de la recepción por dos tipos de usuario: **administrador** y **recepción**.

## Funciones

**Socios**
- Alta con foto, búsqueda por nombre, apellido o número de socio.
- Ficha con vigencia, saldo (pendiente o a favor), historial de pagos y de entradas.
- Editar datos, dar de baja y reactivar (el historial nunca se borra).
- Registro de entrada, con aviso si la membresía está vencida.

**Cobros**
- Planes por meses o por días, con precio de inscripción configurable.
- Planes de pareja o grupo (2 a 4 personas): uno paga y a los acompañantes se les activa la membresía; en su ficha queda quién pagó.
- Cobro de membresía con descuento y pago parcial; el vencimiento se acumula si sigue vigente.
- Pases de un día para quien no es socio.
- Tienda: inventario y ventas, sin permitir existencias negativas.
- Forma de pago: efectivo, tarjeta o transferencia.
- Anulación de pagos (el vencimiento regresa al anterior), ventas (la mercancía vuelve al inventario) y visitas. Solo el administrador.

**Corte de caja**
- Todo lo cobrado en un día, con totales por concepto, forma de pago y persona que cobró.

**Avisos por WhatsApp**
- Lista de socios con membresía por vencer o vencida en los últimos 30 días.
- Un botón abre WhatsApp con el recordatorio ya escrito; queda registrado a quién se le avisó.

**Administración y seguridad**
- Usuarios con rol de administrador o recepción; se pueden editar y desactivar.
- Contraseñas guardadas con `scrypt` y sesión en cookie `HttpOnly`, válida 12 horas.
- Las contraseñas temporales (la inicial o las que pone el administrador) obligan a cambiarlas al entrar.
- Bloqueo de 15 minutos tras 5 intentos de inicio de sesión fallidos.
- Respaldo automático diario de la base de datos (se conservan los últimos 14).

## Tecnologías

| Parte | Tecnología |
|-------|-----------|
| API | Node.js, Express 4, SQLite con `better-sqlite3` |
| Web | Angular 17 (componentes standalone y signals) |
| Pruebas | `node:test` |

## Estructura

```
gimnasio/
├── api/              API REST y base de datos
│   ├── server.js     rutas, validaciones y migraciones
│   └── server.test.js
└── web/              aplicación Angular
    └── src/app/
        ├── gym.service.ts   llamadas a la API y tipos
        └── pages/           inicio, socio, caja, avisos, usuarios, login
```

## Cómo ejecutarlo

Requisitos: Node.js 18 o superior.

**1. API** (puerto 3000)

```bash
cd api
npm install
npm start
```

La base de datos `gimnasio.db` se crea sola la primera vez.

**2. Web** (puerto 4200), en otra terminal

```bash
cd web
npm install
npm start
```

Abre http://localhost:4200. Las llamadas a `/api` se redirigen a la API mediante `proxy.conf.json`.

### Primer inicio de sesión

| Usuario | Contraseña |
|---------|-----------|
| `admin` | `admin`   |

La app pide cambiar esa contraseña antes de dejar hacer cualquier otra cosa. Después, desde **Usuarios**, da de alta los planes, el precio de inscripción y al personal de recepción.

## Configuración

Variables de entorno opcionales de la API:

| Variable | Por defecto | Para qué |
|----------|-------------|----------|
| `DB_FILE` | `gimnasio.db` | Archivo de la base de datos |
| `BACKUP_DIR` | `respaldos` | Carpeta de los respaldos diarios |

Conviene que `BACKUP_DIR` apunte a otro disco o a una carpeta sincronizada (Drive, Dropbox): si el respaldo está en el mismo disco que la base, una falla del disco se lleva los dos.

```bash
BACKUP_DIR="/Volumes/USB/respaldos-gimnasio" npm start
```

## Pruebas

```bash
cd api
npm test
```

Cubren el flujo completo (socio → pago → entrada), permisos por rol, anulaciones, corte de caja, avisos, el bloqueo por intentos fallidos, las migraciones y los respaldos.

## Limitaciones conocidas

- Los celulares se validan a 10 dígitos y los enlaces de WhatsApp usan la lada de México (52).
- Los avisos de WhatsApp se envían a mano desde el enlace; el envío automático requeriría la API de WhatsApp Business.
- El bloqueo por intentos fallidos vive en memoria y se reinicia al reiniciar la API.
- Pensado para una sola computadora o red local; no incluye configuración para publicarlo en internet (HTTPS, dominio).
