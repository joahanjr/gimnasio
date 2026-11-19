import { Component, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { GymService, Plan, Producto, Socio, duracionTexto } from '../gym.service';

type Accion = 'socio' | 'venta' | 'inventario' | 'visita';

@Component({
  standalone: true,
  host: { class: 'inicio' },
  imports: [FormsModule, CurrencyPipe, RouterLink],
  template: `
    <h2>Buscar cliente</h2>
    <form ngNativeValidate role="search" (ngSubmit)="buscar()">
      <label>Nombre, apellido o número de socio
        <input name="q" [(ngModel)]="q" autofocus autocomplete="off">
      </label>
      <button>Buscar</button>
    </form>

    @if (resultados().length > 1) { <p>{{ resultados().length }} socios encontrados. Elige por la foto:</p> }
    <ul class="lista-socios">
      @for (s of resultados(); track s.id) {
        <li><a [routerLink]="['/socio', s.id]">
          @if (s.tiene_foto) { <img class="miniatura" [src]="'/api/socios/' + s.id + '/foto'" alt=""> }
          @else { <span class="miniatura sin-foto" aria-hidden="true">{{ s.nombre[0] }}{{ s.apellido1?.[0] }}</span> }
          <span><strong>#{{ s.id }} {{ s.nombre_completo }}</strong><br>
            <span [class]="s.vigente ? 'ok' : 'mal'">{{ s.vigente ? 'Vigente hasta ' + s.vence : (s.vence ? 'Vencido' : 'Sin pagos') }}</span> · Cel. {{ s.telefono || '—' }}</span>
        </a></li>
      }
    </ul>

    <p role="status" [class]="mensaje().ok ? 'aviso ok' : 'aviso mal'">{{ mensaje().texto }}</p>

    @switch (accion()) {
      @case ('socio') {
        <form ngNativeValidate class="panel" (ngSubmit)="crearSocio()">
          <h3>Nuevo socio</h3>
          <label>Nombre <span aria-hidden="true">*</span> <input name="nombre" [(ngModel)]="socio.nombre" required autocomplete="off"></label>
          <label>Primer apellido <span aria-hidden="true">*</span> <input name="apellido1" [(ngModel)]="socio.apellido1" required autocomplete="off"></label>
          <label>Segundo apellido <input name="apellido2" [(ngModel)]="socio.apellido2" autocomplete="off"></label>
          <label>Celular (10 dígitos) <span aria-hidden="true">*</span>
            <input name="telefono" [(ngModel)]="socio.telefono" type="tel" inputmode="numeric" required pattern="[\\d\\s-]*" autocomplete="off">
          </label>
          <label>Plan <span aria-hidden="true">*</span>
            <select name="plan" [(ngModel)]="socio.plan_id" required>
              @for (p of planesActivos(); track p.id) { <option [ngValue]="p.id">{{ p.nombre }} — {{ duracionTexto(p) }} — {{ p.precio | currency }}</option> }
            </select>
          </label>
          @if (!planesActivos().length) { <p class="mal">El administrador aún no ha dado de alta planes.</p> }
          <label>Foto <input name="foto" type="file" accept="image/*" (change)="fotoNueva = $any($event.target).files[0] ?? null"></label>
          <button>Guardar socio</button>
        </form>
      }
      @case ('venta') {
        <form ngNativeValidate class="panel" (ngSubmit)="vender()">
          <h3>Agregar venta</h3>
          <label>Producto <span aria-hidden="true">*</span>
            <select name="producto" [(ngModel)]="venta.producto" required>
              @for (p of productos(); track p.id) {
                <option [ngValue]="p" [disabled]="!p.existencia">{{ p.nombre }} — {{ p.precio | currency }} ({{ p.existencia }} disponibles)</option>
              }
            </select>
          </label>
          <label>Cantidad <span aria-hidden="true">*</span> <input name="cantidad" type="number" min="1" [max]="venta.producto?.existencia ?? null" step="1" [(ngModel)]="venta.cantidad" required></label>
          <p>Total: <strong>{{ (venta.producto?.precio ?? 0) * venta.cantidad | currency }}</strong></p>
          <button>Registrar venta</button>
        </form>
      }
      @case ('inventario') {
        <form ngNativeValidate class="panel" (ngSubmit)="agregarInventario()">
          <h3>Agregar inventario</h3>
          <label>Producto <span aria-hidden="true">*</span> <input name="nombre" [(ngModel)]="inventario.nombre" required list="productos" autocomplete="off" placeholder="Nuevo o existente"></label>
          <datalist id="productos">@for (p of productos(); track p.id) { <option [value]="p.nombre"></option> }</datalist>
          <label>Cantidad que entra <span aria-hidden="true">*</span> <input name="cantidad" type="number" min="1" step="1" [(ngModel)]="inventario.cantidad" required></label>
          <label>Precio de venta <span aria-hidden="true">*</span> <input name="precio" type="number" min="0.01" step="0.01" [(ngModel)]="inventario.precio" required></label>
          <button>Guardar</button>
        </form>
      }
      @case ('visita') {
        <form ngNativeValidate class="panel" (ngSubmit)="registrarVisita()">
          <h3>Visita (pase de un día)</h3>
          <label>Nombre <span aria-hidden="true">*</span> <input name="nombre" [(ngModel)]="visita.nombre" required autocomplete="off"></label>
          <label>Monto <span aria-hidden="true">*</span> <input name="monto" type="number" min="1" step="0.01" [(ngModel)]="visita.monto" required></label>
          <button>Cobrar visita</button>
        </form>
      }
    }

    <div class="acciones">
      <button [attr.aria-expanded]="accion() === 'socio'" (click)="abrir('socio')">Nuevo socio</button>
      <button [attr.aria-expanded]="accion() === 'venta'" (click)="abrir('venta')">Agregar venta</button>
      <button [attr.aria-expanded]="accion() === 'inventario'" (click)="abrir('inventario')">Agregar inventario</button>
      <button [attr.aria-expanded]="accion() === 'visita'" (click)="abrir('visita')">Visita</button>
    </div>
  `
})
export class InicioComponent {
  private gym = inject(GymService);
  private router = inject(Router);
  q = '';
  resultados = signal<Socio[]>([]);
  productos = signal<Producto[]>([]);
  planesActivos = signal<Plan[]>([]);
  duracionTexto = duracionTexto;
  accion = signal<Accion | null>(null);
  mensaje = signal({ ok: true, texto: '' });

  socio = { nombre: '', apellido1: '', apellido2: '', telefono: '', plan_id: null as number | null };
  venta: { producto: Producto | null; cantidad: number } = { producto: null, cantidad: 1 };
  inventario = { nombre: '', cantidad: 1, precio: 0 };
  visita = { nombre: '', monto: 0 };

  fotoNueva: File | null = null;

  private ok = (texto: string) => this.mensaje.set({ ok: true, texto });
  private fallo = (e: any) => this.mensaje.set({ ok: false, texto: e.error?.error ?? 'Error de conexión' });

  abrir(a: Accion) {
    this.accion.set(this.accion() === a ? null : a);
    if (a === 'venta' || a === 'inventario') this.gym.productos().subscribe(p => this.productos.set(p));
    if (a === 'socio') this.gym.planes().subscribe(p => this.planesActivos.set(p.filter(x => x.activo)));
  }

  buscar() {
    if (this.q.trim()) this.gym.socios(this.q).subscribe(r => {
      // Un solo resultado: directo a su ficha. Varios (mismo nombre): se elige por la foto.
      if (r.length === 1) this.router.navigate(['/socio', r[0].id]);
      this.resultados.set(r);
      this.mensaje.set(r.length ? { ok: true, texto: '' } : { ok: false, texto: 'No se encontró ningún socio' });
    });
  }

  crearSocio() {
    this.gym.crearSocio(this.socio).subscribe({
      next: async s => {
        const foto = this.fotoNueva;
        this.socio = { nombre: '', apellido1: '', apellido2: '', telefono: '', plan_id: null as number | null };
        this.fotoNueva = null;
        // El socio ya quedó guardado aunque la foto falle; se avisa y se puede reintentar desde su ficha.
        try { if (foto) await this.gym.guardarFoto(s.id, foto); }
        catch (e: any) { return this.fallo({ error: { error: `Socio #${s.id} guardado, pero la foto no: ${e.error?.error ?? e.message}` } }); }
        this.router.navigate(['/socio', s.id]);
      },
      error: this.fallo
    });
  }

  vender() {
    const { producto, cantidad } = this.venta;
    if (!producto) return;
    this.gym.vender({ producto_id: producto.id, cantidad: Number(cantidad) }).subscribe({
      next: () => { this.ok(`Venta registrada: ${cantidad} × ${producto.nombre}`); this.venta = { producto: null, cantidad: 1 }; this.accion.set(null); },
      error: this.fallo
    });
  }

  agregarInventario() {
    const { nombre, cantidad, precio } = this.inventario;
    this.gym.agregarInventario({ nombre, cantidad: Number(cantidad), precio: Number(precio) }).subscribe({
      next: p => { this.ok(`${p.nombre}: ${p.existencia} en existencia`); this.inventario = { nombre: '', cantidad: 1, precio: 0 }; this.accion.set(null); },
      error: this.fallo
    });
  }

  registrarVisita() {
    this.gym.registrarVisita({ nombre: this.visita.nombre, monto: Number(this.visita.monto) }).subscribe({
      next: () => { this.ok(`Visita de ${this.visita.nombre} registrada`); this.visita = { nombre: '', monto: 0 }; this.accion.set(null); },
      error: this.fallo
    });
  }
}
