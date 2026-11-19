import { ApplicationConfig, inject } from '@angular/core';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { EMPTY, catchError, finalize, throwError } from 'rxjs';
import { GymService } from './gym.service';

const enCurso = new Set<string>();

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(withInterceptors([(req, next) => {
    const router = inject(Router), gym = inject(GymService);
    // Doble clic en «Registrar pago»: el segundo envío idéntico se ignora mientras el primero sigue en curso.
    const envio = req.method !== 'GET', clave = `${req.method} ${req.urlWithParams} ${JSON.stringify(req.body)}`;
    if (envio) {
      if (enCurso.has(clave)) return EMPTY;
      enCurso.add(clave); gym.guardando.update(n => n + 1);
    }
    // Sesión vencida a mitad de turno: de vuelta al login.
    return next(req).pipe(catchError((e: HttpErrorResponse) => {
      if (e.status === 401 && !req.url.endsWith('/login')) router.navigateByUrl('/login');
      return throwError(() => e);
    }), finalize(() => { if (envio && enCurso.delete(clave)) gym.guardando.update(n => n - 1); }));
  }]))]
};
