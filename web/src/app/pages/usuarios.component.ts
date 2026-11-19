import { Component, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GymService, Plan, PlanNuevo, Producto, Rol, Usuario, duracionTexto } from '../gym.service';

@Component({
  standalone: true,
  imports: [FormsModule, CurrencyPipe],
  template: `
    @if (gym.usuario()?.cambiar_clave) {
      <p role="alert" class="aviso mal">Tu contraseña es temporal. Cámbiala para poder usar el sistema.</p>
    }
    <h2>Cambiar mi contraseña</h2>
    <form ngNativeValidate class="panel" (ngSubmit)="cambiarClave()">
      <label>Contraseña actual <input name="actual" type="password" [(ngModel)]="clave.actual" required autocomplete="current-password"></label>
      <label>Nueva contraseña <input name="nueva" type="password" minlength="4" [(ngModel)]="clave.nueva" required autocomplete="new-password"></label>
      <button>Guardar</button>
    </form>
    <p role="status" [class]="claveMsg().ok ? 'ok' : 'mal'">{{ claveMsg().texto }}</p>

    @if (gym.usuario()?.rol === 'admin' && !gym.usuario()?.cambiar_clave) {
      <h2>Personal</h2>
      <form ngNativeValidate class="panel" (ngSubmit)="guardarUsuario()">
        <h3>{{ editandoUsuario() ? 'Editar a ' + editandoUsuario()!.usuario : 'Nuevo usuario' }}</h3>
        <label>Nombre <span aria-hidden="true">*</span> <input name="nombre" [(ngModel)]="nuevo.nombre" required></label>
        @if (!editandoUsuario()) {
          <label>Usuario <span aria-hidden="true">*</span> <input name="usuario" [(ngModel)]="nuevo.usuario" required autocomplete="off"></label>
        }
        <label>{{ editandoUsuario() ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña' }} @if (!editandoUsuario()) { <span aria-hidden="true">*</span> }
          <input name="clave" type="password" minlength="4" [(ngModel)]="nuevo.clave" [required]="!editandoUsuario()" autocomplete="new-password">
        </label>
        <label>Rol
          <select name="rol" [(ngModel)]="nuevo.rol">
            <option value="recepcion">Recepción</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <p>La contraseña que pongas es temporal: el usuario tendrá que cambiarla al entrar.</p>
        <button>{{ editandoUsuario() ? 'Guardar cambios' : 'Crear usuario' }}</button>
        @if (editandoUsuario()) { <button type="button" (click)="limpiarUsuario()">Cancelar</button> }
      </form>
      <p role="alert" class="mal">{{ error() }}</p>

      <div class="tabla" tabindex="0" role="region" aria-label="Personal"><table>
        <tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr>
        @for (u of usuarios(); track u.id) {
          <tr>
            <td>{{ u.nombre }}</td><td>{{ u.usuario }}</td><td>{{ u.rol === 'admin' ? 'Administrador' : 'Recepción' }}</td>
            <td [class]="u.activo ? 'ok' : 'mal'">{{ u.activo ? 'Activo' : 'Inactivo' }}</td>
            <td class="botones">
              <button type="button" (click)="editarUsuario(u)">Editar</button>
              @if (u.id !== gym.usuario()?.id) { <button type="button" (click)="alternarUsuario(u)">{{ u.activo ? 'Desactivar' : 'Activar' }}</button> }
            </td>
          </tr>
        }
      </table></div>

      <h2>Productos</h2>
      <p>Para dar de alta productos o sumar mercancía usa «Agregar inventario» en la pantalla principal.</p>
      @if (producto(); as p) {
        <form ngNativeValidate class="panel" (ngSubmit)="guardarProducto(p)">
          <h3>Editar producto</h3>
          <label>Nombre <span aria-hidden="true">*</span> <input name="prnombre" [(ngModel)]="prod.nombre" required autocomplete="off"></label>
          <label>Precio <span aria-hidden="true">*</span> <input name="prprecio" type="number" min="0.01" step="0.01" [(ngModel)]="prod.precio" required></label>
          <label>Existencia (conteo físico) <span aria-hidden="true">*</span> <input name="prexistencia" type="number" min="0" step="1" [(ngModel)]="prod.existencia" required></label>
          <button>Guardar cambios</button>
          <button type="button" (click)="producto.set(null)">Cancelar</button>
        </form>
      }
      <p role="alert" class="mal">{{ errorProducto() }}</p>
      <div class="tabla" tabindex="0" role="region" aria-label="Productos"><table>
        <tr><th>Producto</th><th>Precio</th><th>Existencia</th><th>Estado</th><th></th></tr>
        @for (p of productos(); track p.id) {
          <tr>
            <td>{{ p.nombre }}</td><td>{{ p.precio | currency }}</td><td>{{ p.existencia }}</td>
            <td [class]="p.activo ? 'ok' : 'mal'">{{ p.activo ? 'Activo' : 'Inactivo' }}</td>
            <td class="botones">
              <button type="button" (click)="editarProducto(p)">Editar</button>
              <button type="button" (click)="guardarProducto(p, !p.activo)">{{ p.activo ? 'Desactivar' : 'Activar' }}</button>
            </td>
          </tr>
        } @empty { <tr><td colspan="5">Aún no hay productos.</td></tr> }
      </table></div>

      <h2>Planes</h2>
      <form ngNativeValidate class="panel" (ngSubmit)="guardarPlan()">
        <h3>{{ editando() ? 'Editar plan' : 'Nuevo plan' }}</h3>
        <label>Nombre <span aria-hidden="true">*</span> <input name="pnombre" [(ngModel)]="plan.nombre" required placeholder="Mensual, Semanal…" autocomplete="off"></label>
        <label>Duración <span aria-hidden="true">*</span> <input name="duracion" type="number" min="1" step="1" [(ngModel)]="plan.duracion" required></label>
        <label>Unidad
          <select name="unidad" [(ngModel)]="plan.unidad"><option value="meses">Meses</option><option value="dias">Días</option></select>
        </label>
        <label>Precio <span aria-hidden="true">*</span> <input name="precio" type="number" min="0.01" step="0.01" [(ngModel)]="plan.precio" required></label>
        <button>{{ editando() ? 'Guardar cambios' : 'Agregar plan' }}</button>
        @if (editando()) { <button type="button" (click)="limpiarPlan()">Cancelar</button> }
      </form>
      <p role="alert" class="mal">{{ errorPlan() }}</p>

      <div class="tabla" tabindex="0" role="region" aria-label="Planes"><table>
        <tr><th>Plan</th><th>Duración</th><th>Precio</th><th>Estado</th><th></th></tr>
        @for (p of planes(); track p.id) {
          <tr>
            <td>{{ p.nombre }}</td><td>{{ duracionTexto(p) }}</td><td>{{ p.precio | currency }}</td>
            <td [class]="p.activo ? 'ok' : 'mal'">{{ p.activo ? 'Activo' : 'Inactivo' }}</td>
            <td class="botones">
              <button type="button" (click)="editar(p)">Editar</button>
              <button type="button" (click)="alternar(p)">{{ p.activo ? 'Desactivar' : 'Activar' }}</button>
            </td>
          </tr>
        } @empty { <tr><td colspan="5">Aún no hay planes. Agrega al menos uno para poder registrar socios.</td></tr> }
      </table></div>

      <h2>Inscripción</h2>
      <form ngNativeValidate class="panel" (ngSubmit)="guardarInscripcion()">
        <label>Precio de la inscripción <input name="inscripcion" type="number" min="0" step="0.01" [(ngModel)]="inscripcion" required></label>
        <button>Guardar</button>
      </form>
      <p role="status" [class]="msgInscripcion().ok ? 'ok' : 'mal'">{{ msgInscripcion().texto }}</p>
    }
  `
})
export class UsuariosComponent {
  gym = inject(GymService);
  clave = { actual: '', nueva: '' };
  claveMsg = signal({ ok: true, texto: '' });
  nuevo = { nombre: '', usuario: '', clave: '', rol: 'recepcion' as Rol };
  usuarios = signal<Usuario[]>([]);
  error = signal('');

  planes = signal<Plan[]>([]);
  plan: PlanNuevo = { nombre: '', duracion: 1, unidad: 'meses', precio: 0 };
  editando = signal<Plan | null>(null);
  errorPlan = signal('');
  inscripcion = 0;
  msgInscripcion = signal({ ok: true, texto: '' });
  duracionTexto = duracionTexto;

  editandoUsuario = signal<Usuario | null>(null);
  productos = signal<Producto[]>([]);
  producto = signal<Producto | null>(null);
  prod = { nombre: '', precio: 0, existencia: 0 };
  errorProducto = signal('');

  constructor() { this.cargarTodo(); }

  // Tras cambiar una contraseña temporal, el admin ya puede ver el resto.
  private cargarTodo() {
    const u = this.gym.usuario();
    if (u?.rol !== 'admin' || u.cambiar_clave) return;
    this.cargar();
    this.cargarPlanes();
    this.cargarProductos();
    this.gym.ajustes().subscribe(a => this.inscripcion = a.inscripcion);
  }

  cargar() { this.gym.usuarios().subscribe(u => this.usuarios.set(u)); }
  cargarProductos() { this.gym.productos().subscribe(p => this.productos.set(p)); }

  limpiarUsuario() { this.nuevo = { nombre: '', usuario: '', clave: '', rol: 'recepcion' }; this.editandoUsuario.set(null); }

  editarUsuario(u: Usuario) {
    this.editandoUsuario.set(u);
    this.nuevo = { nombre: u.nombre, usuario: u.usuario, clave: '', rol: u.rol };
  }

  guardarUsuario() {
    const e = this.editandoUsuario();
    if (!e) return this.crear();
    this.gym.editarUsuario(e.id, { nombre: this.nuevo.nombre, rol: this.nuevo.rol, activo: !!e.activo, clave: this.nuevo.clave || undefined }).subscribe({
      next: () => { this.limpiarUsuario(); this.error.set(''); this.cargar(); },
      error: err => this.error.set(err.error?.error ?? 'Error de conexión')
    });
  }

  alternarUsuario(u: Usuario) {
    if (u.activo && !confirm(`¿Desactivar a ${u.nombre}? Ya no podrá entrar al sistema.`)) return;
    this.gym.editarUsuario(u.id, { nombre: u.nombre, rol: u.rol, activo: !u.activo }).subscribe({
      next: () => { this.error.set(''); this.cargar(); },
      error: err => this.error.set(err.error?.error ?? 'Error de conexión')
    });
  }

  editarProducto(p: Producto) {
    this.producto.set(p);
    this.prod = { nombre: p.nombre, precio: p.precio, existencia: p.existencia };
  }

  // Sin `activo`: guarda el formulario. Con `activo`: solo activa/desactiva desde la tabla.
  guardarProducto(p: Producto, activo?: boolean) {
    const datos = activo === undefined ? this.prod : p;
    this.gym.editarProducto(p.id, { nombre: datos.nombre, precio: Number(datos.precio), existencia: Number(datos.existencia), activo: activo ?? !!p.activo }).subscribe({
      next: () => { this.producto.set(null); this.errorProducto.set(''); this.cargarProductos(); },
      error: err => this.errorProducto.set(err.error?.error ?? 'Error de conexión')
    });
  }
  cargarPlanes() { this.gym.planes().subscribe(p => this.planes.set(p)); }

  limpiarPlan() { this.plan = { nombre: '', duracion: 1, unidad: 'meses', precio: 0 }; this.editando.set(null); }

  editar(p: Plan) {
    this.editando.set(p);
    this.plan = { nombre: p.nombre, duracion: p.duracion, unidad: p.unidad, precio: p.precio, activo: !!p.activo };
  }

  guardarPlan() {
    const p = { ...this.plan, duracion: Number(this.plan.duracion), precio: Number(this.plan.precio) };
    const e = this.editando();
    (e ? this.gym.editarPlan(e.id, p) : this.gym.crearPlan(p)).subscribe({
      next: () => { this.limpiarPlan(); this.errorPlan.set(''); this.cargarPlanes(); },
      error: err => this.errorPlan.set(err.error?.error ?? 'Error de conexión')
    });
  }

  alternar(p: Plan) {
    this.gym.editarPlan(p.id, { nombre: p.nombre, duracion: p.duracion, unidad: p.unidad, precio: p.precio, activo: !p.activo }).subscribe({
      next: () => this.cargarPlanes(),
      error: err => this.errorPlan.set(err.error?.error ?? 'Error de conexión')
    });
  }

  guardarInscripcion() {
    this.gym.guardarAjustes({ inscripcion: Number(this.inscripcion) }).subscribe({
      next: () => this.msgInscripcion.set({ ok: true, texto: 'Inscripción guardada' }),
      error: err => this.msgInscripcion.set({ ok: false, texto: err.error?.error ?? 'Error de conexión' })
    });
  }

  cambiarClave() {
    this.gym.cambiarClave(this.clave.actual, this.clave.nueva).subscribe({
      next: () => { this.clave = { actual: '', nueva: '' }; this.claveMsg.set({ ok: true, texto: 'Contraseña actualizada' }); this.cargarTodo(); },
      error: e => this.claveMsg.set({ ok: false, texto: e.error?.error ?? 'Error de conexión' })
    });
  }

  crear() {
    this.gym.crearUsuario(this.nuevo).subscribe({
      next: () => { this.nuevo = { nombre: '', usuario: '', clave: '', rol: 'recepcion' }; this.error.set(''); this.cargar(); },
      error: e => this.error.set(e.error?.error ?? 'Error de conexión')
    });
  }
}
