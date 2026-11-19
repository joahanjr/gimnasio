import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GymService } from '../gym.service';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <h2>Iniciar sesión</h2>
    <form ngNativeValidate class="panel" (ngSubmit)="entrar()">
      <label>Usuario <input name="usuario" [(ngModel)]="usuario" required [autofocus]="!usuario" autocomplete="off" list="usuarios-guardados"></label>
      <datalist id="usuarios-guardados">@for (u of guardados; track u) { <option [value]="u"></option> }</datalist>
      <!-- new-password: que el navegador no autollene la de otra persona -->
      <label>Contraseña <input name="clave" type="password" [(ngModel)]="clave" required [autofocus]="!!usuario" autocomplete="new-password"></label>
      <button>Entrar</button>
    </form>
    <p role="alert" class="mal">{{ error() }}</p>
  `
})
export class LoginComponent {
  private gym = inject(GymService);
  private router = inject(Router);
  // Usuarios que ya entraron en esta computadora; las contraseñas nunca se guardan.
  guardados: string[] = leerGuardados();
  usuario = this.guardados[0] ?? '';
  clave = '';
  error = signal('');

  entrar() {
    this.gym.login(this.usuario, this.clave).subscribe({
      next: u => {
        try { localStorage.setItem('usuarios', JSON.stringify([u.usuario, ...this.guardados.filter(g => g !== u.usuario)])); } catch {}
        this.router.navigateByUrl('/');
      },
      error: e => { this.clave = ''; this.error.set(e.error?.error ?? 'Error de conexión'); }
    });
  }
}

function leerGuardados(): string[] {
  try { return JSON.parse(localStorage.getItem('usuarios') ?? '[]'); } catch { return []; }
}
