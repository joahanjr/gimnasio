import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { GymService } from './gym.service';
import { LoginComponent } from './pages/login.component';
import { InicioComponent } from './pages/inicio.component';
import { SocioComponent } from './pages/socio.component';
import { UsuariosComponent } from './pages/usuarios.component';

const conSesion = () => {
  const gym = inject(GymService), router = inject(Router);
  return gym.usuario() ? true : gym.yo().pipe(map(() => true), catchError(() => of(router.parseUrl('/login'))));
};

export const routes: Routes = [
  { path: 'login', component: LoginComponent, title: 'Iniciar sesión' },
  { path: '', component: InicioComponent, title: 'Clientes', canActivate: [conSesion] },
  { path: 'usuarios', component: UsuariosComponent, title: 'Usuarios', canActivate: [conSesion] },
  { path: 'socio/:id', component: SocioComponent, title: 'Socio', canActivate: [conSesion] },
  { path: '**', redirectTo: '' }
];
