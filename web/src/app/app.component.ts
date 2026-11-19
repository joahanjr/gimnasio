import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { GymService } from './gym.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (gym.usuario(); as u) {
    <nav aria-label="Principal">
      <a routerLink="/"><strong>Gimnasio</strong></a>
      <a routerLink="/usuarios" routerLinkActive="activo" ariaCurrentWhenActive="page">{{ u.rol === 'admin' ? 'Usuarios' : 'Mi contraseña' }}</a>
      <span class="usuario">{{ u.rol === 'admin' ? 'Admin' : 'Recepción' }}: {{ u.nombre }} <button (click)="salir()">Cerrar sesión</button></span>
    </nav>
    }
    <main><router-outlet /></main>
  `
})
export class AppComponent {
  gym = inject(GymService);
  private router = inject(Router);
  salir() { this.gym.logout().subscribe(() => this.router.navigateByUrl('/login')); }
}
