import { Component, ElementRef, OnDestroy, ViewChild, AfterViewInit, inject, signal } from '@angular/core';
import jsQR from 'jsqr';
import { CODIGO_QR, Entrada, GymService, avisoEntrada } from '../gym.service';

// Modo entrada: la cámara web lee el QR del socio y registra su entrada.
// jsQR decodifica en JavaScript, así que funciona en Windows, Mac y cualquier navegador (no depende de BarcodeDetector).
@Component({
  standalone: true,
  template: `
    <h2>Modo entrada</h2>
    <p>Acerca tu código QR a la cámara.</p>
    <div class="camara" aria-live="polite">
      <video #video playsinline muted aria-label="Vista de la cámara"></video>
      @if (resultado(); as r) {
        <div class="resultado" [class.mal]="!aviso().ok">
          @if (r.tiene_foto) { <img [src]="'/api/socios/' + r.id + '/foto'" [alt]="'Foto de ' + r.nombre_completo"> }
          <p>{{ aviso().texto }}</p>
        </div>
      }
    </div>
    @if (!resultado()) { <p role="alert" class="aviso mal">{{ aviso().ok ? '' : aviso().texto }}</p> }
    @if (errorCamara()) {
      <p role="alert" class="aviso mal">{{ errorCamara() }}</p>
      <button type="button" (click)="encender()">Intentar de nuevo</button>
    }
  `
})
export class EntradaComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') private video!: ElementRef<HTMLVideoElement>;
  private gym = inject(GymService);
  private stream?: MediaStream;
  private timer?: ReturnType<typeof setInterval>;
  private lienzo = document.createElement('canvas');
  private ocupado = false;
  resultado = signal<Entrada | null>(null);
  aviso = signal({ ok: true, texto: '' });
  errorCamara = signal('');

  ngAfterViewInit() { this.encender(); }

  async encender() {
    this.errorCamara.set('');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      const v = this.video.nativeElement;
      v.srcObject = this.stream;
      await v.play();
      this.timer = setInterval(() => this.leer(), 250); // 4 lecturas por segundo: rápido sin cargar la compu
    } catch (e: any) {
      this.errorCamara.set(e?.name === 'NotAllowedError'
        ? 'El navegador no tiene permiso para usar la cámara. Permítelo en el candado de la barra de direcciones.'
        : 'No se encontró una cámara o la está usando otro programa.');
    }
  }

  private leer() {
    const v = this.video.nativeElement;
    if (this.ocupado || v.readyState < 2 || !v.videoWidth) return;
    this.lienzo.width = v.videoWidth; this.lienzo.height = v.videoHeight;
    const ctx = this.lienzo.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0);
    const qr = jsQR(ctx.getImageData(0, 0, v.videoWidth, v.videoHeight).data, v.videoWidth, v.videoHeight, { inversionAttempts: 'dontInvert' });
    if (!qr || !CODIGO_QR.test(qr.data)) return;
    this.ocupado = true;
    this.gym.entradaQR(qr.data).subscribe({
      next: s => { this.resultado.set(s); this.aviso.set(avisoEntrada(s)); this.pausa(); },
      error: e => { this.resultado.set(null); this.aviso.set({ ok: false, texto: e.error?.error ?? 'Error de conexión' }); this.pausa(); }
    });
  }

  // El resultado se queda unos segundos para que el socio (y recepción) lo vean; luego, a esperar al siguiente.
  private pausa() {
    setTimeout(() => { this.ocupado = false; this.resultado.set(null); this.aviso.set({ ok: true, texto: '' }); }, 4000);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach(t => t.stop()); // apaga la luz de la cámara al salir
  }
}
