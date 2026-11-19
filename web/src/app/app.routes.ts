import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { GymService, Usuario } from './gym.service';
import { LoginComponent } from './pages/login.component';
import { InicioComponent } from './pages/inicio.component';
import { SocioComponent } from './pages/socio.component';
import { UsuariosComponent } from './pages/usuarios.component';
import { CajaComponent } from './pages/caja.component';
import { AvisosComponent } from './pages/avisos.component';

// Con contraseña temporal solo se puede ir a cambiarla (la API también lo exige).
const conSesion: CanActivateFn = (_ruta, estado) => {
  const gym = inject(GymService), router = inject(Router);
  const revisar = (u: Usuario) => u.cambiar_clave && estado.url !== '/usuarios' ? router.parseUrl('/usuarios') : true;
  const u = gym.usuario();
  return u ? revisar(u) : gym.yo().pipe(map(revisar), catchError(() => of(router.parseUrl('/login'))));
};

export const routes: Routes = [
  { path: 'login', component: LoginComponent, title: 'Iniciar sesión' },
  { path: '', component: InicioComponent, title: 'Clientes', canActivate: [conSesion] },
  { path: 'usuarios', component: UsuariosComponent, title: 'Usuarios', canActivate: [conSesion] },
  { path: 'socio/:id', component: SocioComponent, title: 'Socio', canActivate: [conSesion] },
  { path: 'caja', component: CajaComponent, title: 'Corte de caja', canActivate: [conSesion] },
  { path: 'avisos', component: AvisosComponent, title: 'Avisos de vencimiento', canActivate: [conSesion] },
  { path: '**', redirectTo: '' }
];
