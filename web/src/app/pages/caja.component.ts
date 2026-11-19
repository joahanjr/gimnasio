import { Component, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe, KeyValuePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Corte, GymService, Movimiento, metodoTexto, aviso } from '../gym.service';

const TIPOS: Record<string, string> = { pago: 'Membresías', visita: 'Visitas', venta: 'Ventas' };

@Component({
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe, KeyValuePipe],
  template: `
    <h2>Corte de caja</h2>
    <form class="panel" (ngSubmit)="cargar()">
      <label>Día <input name="fecha" type="date" [(ngModel)]="fecha" (change)="cargar()" required></label>
    </form>

    <p role="status" [class]="mensaje().ok ? 'aviso ok' : 'aviso mal'">{{ mensaje().texto }}</p>

    @if (corte(); as c) {
      <p class="total">Total cobrado: <strong>{{ c.total | currency }}</strong></p>
      <div class="totales">
        @for (g of grupos; track g.clave) {
          <div class="tabla" tabindex="0" role="region" [attr.aria-label]="g.titulo"><table>
            <tr><th>{{ g.titulo }}</th><th>Total</th></tr>
            @for (t of c[g.clave] | keyvalue; track t.key) { <tr><td>{{ g.texto(t.key) }}</td><td>{{ t.value | currency }}</td></tr> }
            @empty { <tr><td colspan="2">—</td></tr> }
          </table></div>
        }
      </div>

      <h3>Movimientos</h3>
      <div class="tabla" tabindex="0" role="region" aria-label="Movimientos del día"><table>
        <tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>Forma de pago</th><th>Cobró</th><th>Monto</th>@if (esAdmin()) { <th>Acciones</th> }</tr>
        @for (m of c.movimientos; track m.tipo + m.id) {
          <tr [class.anulado]="m.anulado">
            <td>{{ m.fecha.replace(' ', 'T') | date:'HH:mm' }}</td><td>{{ tipos[m.tipo] }}</td><td>{{ m.concepto }}</td>
            <td>{{ metodoTexto(m.metodo) }}</td><td>{{ m.usuario }}</td>
            <td>@if (m.anulado) { <s>{{ m.monto | currency }}</s> Anulado } @else { {{ m.monto | currency }} }</td>
            @if (esAdmin()) {
              <td>@if (!m.anulado && m.tipo !== 'pago') { <button type="button" class="peligro" (click)="anular(m)">Anular</button> }</td>
            }
          </tr>
        } @empty { <tr><td colspan="7">No hubo cobros ese día.</td></tr> }
      </table></div>
      @if (esAdmin()) { <p>Los pagos de membresía se anulan desde la ficha del socio, porque cambian su vencimiento.</p> }
    }
  `
})
export class CajaComponent {
  private gym = inject(GymService);
  fecha = new Date().toLocaleDateString('sv');
  corte = signal<Corte | null>(null);
  mensaje = aviso();
  esAdmin = () => this.gym.usuario()?.rol === 'admin';
  tipos = TIPOS;
  metodoTexto = metodoTexto;
  grupos: { clave: 'por_tipo' | 'por_metodo' | 'por_usuario'; titulo: string; texto: (k: string) => string }[] = [
    { clave: 'por_tipo', titulo: 'Concepto', texto: k => TIPOS[k] ?? k },
    { clave: 'por_metodo', titulo: 'Forma de pago', texto: metodoTexto },
    { clave: 'por_usuario', titulo: 'Cobró', texto: k => k }
  ];

  ngOnInit() { this.cargar(); }

  cargar() {
    if (this.fecha) this.gym.corte(this.fecha).subscribe({ next: c => this.corte.set(c), error: e => this.mensaje.set({ ok: false, texto: e.error?.error ?? 'Error de conexión' }) });
  }

  anular(m: Movimiento) {
    if (!confirm(`¿Anular "${m.concepto}" por $${m.monto}?`)) return;
    this.gym.anular(m.tipo, m.id).subscribe({
      next: () => { this.mensaje.set({ ok: true, texto: `${m.concepto}: anulado` }); this.cargar(); },
      error: e => this.mensaje.set({ ok: false, texto: e.error?.error ?? 'Error de conexión' })
    });
  }
}
