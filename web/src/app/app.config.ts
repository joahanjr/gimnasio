import { ApplicationConfig, inject } from '@angular/core';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(withInterceptors([(req, next) => {
    const router = inject(Router);
    // Sesión vencida a mitad de turno: de vuelta al login.
    return next(req).pipe(catchError((e: HttpErrorResponse) => {
      if (e.status === 401 && !req.url.endsWith('/login')) router.navigateByUrl('/login');
      return throwError(() => e);
    }));
  }]))]
};
