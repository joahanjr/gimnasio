import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GymService, Socio, enlaceWhatsApp } from '../gym.service';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <h2>Avisos de vencimiento</h2>
    <form class="panel" (ngSubmit)="cargar()">
      <label>Vencen en los próximos
        <select name="dias" [(ngModel)]="dias" (change)="cargar()">
          @for (d of [3, 7, 15, 30]; track d) { <option [ngValue]="d">{{ d }} días</option> }
        </select>
      </label>
    </form>
    <p>Pulsa «Avisar por WhatsApp»: se abre el chat con el mensaje escrito y solo falta enviarlo.</p>
    <p role="status" class="aviso mal">{{ error() }}</p>

    @for (g of grupos(); track g.titulo) {
      <h3>{{ g.titulo }} ({{ g.socios.length }})</h3>
      <ul class="lista-avisos">
        @for (s of g.socios; track s.id) {
          <li>
            <a [routerLink]="['/socio', s.id]"><strong>#{{ s.id }} {{ s.nombre_completo }}</strong></a>
            <span [class]="s.vigente ? 'ok' : 'mal'">{{ estado(s) }}</span> · Cel. {{ s.telefono || '—' }}
            @if (s.avisado) { · <span>Avisado el {{ s.avisado.split('-').reverse().join('/') }}</span> }
            @if (s.telefono) {
              <a class="boton" [href]="whatsapp(s)" target="_blank" rel="noopener" (click)="avisado(s)">
                {{ s.avisado ? 'Avisar de nuevo' : 'Avisar por WhatsApp' }}
              </a>
            }
          </li>
        } @empty { <li>Nadie.</li> }
      </ul>
    }
  `
})
export class AvisosComponent {
  private gym = inject(GymService);
  dias = 7;
  socios = signal<Socio[]>([]);
  error = signal('');
  grupos = computed(() => [
    { titulo: 'Por vencer', socios: this.socios().filter(s => s.vigente) },
    { titulo: 'Vencidos en los últimos 30 días', socios: this.socios().filter(s => !s.vigente) }
  ]);
  whatsapp = enlaceWhatsApp;

  ngOnInit() { this.cargar(); }

  cargar() { this.gym.avisos(this.dias).subscribe({ next: s => this.socios.set(s), error: e => this.error.set(e.error?.error ?? 'Error de conexión') }); }

  estado(s: Socio) {
    const d = s.dias_restantes ?? 0;
    return d > 1 ? `Vence en ${d} días` : d === 1 ? 'Vence mañana' : d === 0 ? 'Vence hoy' : `Vencido hace ${-d} ${d === -1 ? 'día' : 'días'}`;
  }

  // El enlace se abre solo; aquí únicamente se registra que ya se le avisó.
  avisado(s: Socio) {
    this.gym.marcarAviso(s.id).subscribe({
      next: n => this.socios.update(l => l.map(x => x.id === n.id ? n : x)),
      error: e => this.error.set(e.error?.error ?? 'Error de conexión')
    });
  }
}
