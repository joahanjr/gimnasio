import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// La rueda del mouse no debe cambiar un monto sin querer.
document.addEventListener('wheel', () => {
  const a = document.activeElement;
  if (a instanceof HTMLInputElement && a.type === 'number') a.blur();
}, { passive: true });

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
