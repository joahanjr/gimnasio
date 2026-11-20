import { Component, Input, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FichaSocio, GymService, METODOS, Metodo, Pago, Plan, Socio, duracionTexto, enlaceWhatsApp, metodoTexto, aviso, enfocar } from '../gym.service';

// Las fechas de SQLite vienen como "YYYY-MM-DD HH:MM:SS"; DatePipe necesita la "T".
const iso = (f: string) => f.replace(' ', 'T');

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, CurrencyPipe],
  template: `
    <p><a routerLink="/">← Buscar otro cliente</a></p>
    @if (s(); as s) {
      <article class="ficha-completa">
        <div class="foto-grande">
          @if (s.tiene_foto) {
            <img class="foto" [src]="'/api/socios/' + s.id + '/foto?v=' + version()" [alt]="'Foto de ' + s.nombre_completo">
          } @else {
            <div class="foto sin-foto" aria-hidden="true">{{ s.nombre[0] }}{{ s.apellido1?.[0] }}</div>
          }
          <label class="boton-archivo">{{ s.tiene_foto ? 'Cambiar foto' : 'Agregar foto' }}
            <input type="file" accept="image/*" (change)="cambiarFoto($event)">
          </label>
        </div>

        <div class="datos">
          <h2>#{{ s.id }} {{ s.nombre_completo }}</h2>
          @if (!s.activo) { <p class="estado mal">Dado de baja</p> }
          <p [class]="'estado ' + (s.vigente ? 'ok' : 'mal')">
            @if (s.dias_restantes === null) { Sin pagos }
            @else if (s.dias_restantes > 1) { Le quedan {{ s.dias_restantes }} días }
            @else if (s.dias_restantes === 1) { Le queda 1 día }
            @else if (s.dias_restantes === 0) { Hoy es su último día }
            @else { Vencido hace {{ -s.dias_restantes }} {{ s.dias_restantes === -1 ? 'día' : 'días' }} }
          </p>
          <dl>
            <dt>Plan</dt><dd>{{ s.plan || '—' }}</dd>
            <dt>Saldo</dt>
            <dd [class]="s.saldo < 0 ? 'mal' : s.saldo > 0 ? 'ok' : ''">
              @if (s.saldo < 0) { Pendiente por pagar: {{ -s.saldo | currency }} }
              @else if (s.saldo > 0) { A favor: {{ s.saldo | currency }} }
              @else { Al corriente }
            </dd>
            <dt>Celular</dt><dd>{{ s.telefono || '—' }}</dd>
            <dt>Fecha de registro</dt><dd>{{ iso(s.creado) | date:'dd/MM/yyyy' }}</dd>
            <dt>Último pago</dt>
            <dd>@if (s.ultimo_pago; as p) { {{ iso(p.fecha) | date:'dd/MM/yyyy' }} · {{ p.plan }} · {{ p.monto | currency }} } @else { — }</dd>
            <dt>Vence su plan</dt><dd>{{ s.vence ? (s.vence + 'T00:00' | date:'dd/MM/yyyy') : '—' }}</dd>
            <dt>Veces que ha venido</dt><dd>{{ s.entradas.length }}</dd>
            @if (s.avisado) { <dt>Último aviso</dt><dd>{{ s.avisado + 'T00:00' | date:'dd/MM/yyyy' }}</dd> }
          </dl>
          <div class="botones">
            @if (s.activo) {
              <button (click)="entrar()">Registrar entrada</button>
              <button type="button" (click)="abrirCobro(s)" [attr.aria-expanded]="cobrando()">Cobrar membresía</button>
              @if (s.telefono) { <a class="boton" [href]="whatsapp(s)" target="_blank" rel="noopener" (click)="avisado()">Avisar por WhatsApp</a> }
            }
            <button type="button" (click)="abrirEdicion(s)" [attr.aria-expanded]="editando()">Editar datos</button>
            <button type="button" [class.peligro]="s.activo" (click)="guardar(s, !s.activo)">{{ s.activo ? 'Dar de baja' : 'Reactivar' }}</button>
          </div>
        </div>
      </article>

      <p role="status" [class]="mensaje().ok ? 'aviso ok' : 'aviso mal'">{{ mensaje().texto }}</p>

      @if (editando()) {
        <form ngNativeValidate class="panel edicion" (ngSubmit)="guardar(s, !!s.activo)">
          <h3>Editar datos</h3>
          <label>Nombre <input name="nombre" [(ngModel)]="datos.nombre" required autocomplete="off"></label>
          <label>Primer apellido <input name="apellido1" [(ngModel)]="datos.apellido1" required autocomplete="off"></label>
          <label>Segundo apellido <input name="apellido2" [(ngModel)]="datos.apellido2" autocomplete="off"></label>
          <label>Celular (10 dígitos)
            <input name="telefono" [(ngModel)]="datos.telefono" type="tel" inputmode="numeric" required pattern="[\\d\\s\\-]*" autocomplete="off">
          </label>
          <button>Guardar cambios</button>
          <button type="button" (click)="editando.set(false)">Cancelar</button>
        </form>
      }

      @if (cobrando()) {
        <form ngNativeValidate class="panel cobro" (ngSubmit)="pagar()">
          <h3>Cobrar membresía</h3>
          <label>Plan
            <select name="plan" [(ngModel)]="pago.plan_id" required>
              @for (p of planes(); track p.id) { <option [ngValue]="p.id">{{ p.nombre }} — {{ duracionTexto(p) }}</option> }
            </select>
          </label>
          @for (n of huecos(); track n) {
            <label>Acompañante {{ n + 1 }}
              <select [name]="'acompanante' + n" [(ngModel)]="pago.acompanantes[n]" required>
                @for (o of otros(s); track o.id) { <option [ngValue]="o.id">#{{ o.id }} {{ o.nombre_completo }}</option> }
              </select>
            </label>
          }
          @if (huecos().length) { <p>El cobro queda en {{ s.nombre_completo }}; a sus acompañantes se les activa la membresía igual.</p> }
          <label class="casilla"><input name="inscripcion" type="checkbox" [(ngModel)]="pago.inscripcion"> Cobrar inscripción ({{ inscripcion() | currency }})</label>
          <label>Descuento <input name="descuento" type="number" min="0" [max]="precio() + cuotaInscripcion()" step="0.01" [(ngModel)]="pago.descuento"></label>

          <dl class="desglose">
            <dt>Plan</dt><dd>{{ precio() | currency }}</dd>
            @if (pago.inscripcion) { <dt>Inscripción</dt><dd>{{ cuotaInscripcion() | currency }}</dd> }
            @if (descuento()) { <dt>Descuento</dt><dd>−{{ descuento() | currency }}</dd> }
            @if (s.saldo < 0) { <dt>Saldo pendiente anterior</dt><dd class="mal">+{{ -s.saldo | currency }}</dd> }
            @if (s.saldo > 0) { <dt>Saldo a favor</dt><dd class="ok">−{{ s.saldo | currency }}</dd> }
            <dt class="total">Total a pagar</dt><dd class="total">{{ total(s) | currency }}</dd>
          </dl>

          <label>Forma de pago
            <select name="metodo" [(ngModel)]="pago.metodo">@for (m of metodos; track m) { <option [value]="m">{{ metodoTexto(m) }}</option> }</select>
          </label>
          <label>Pagó <input name="pagado" type="number" min="0" step="0.01" [(ngModel)]="pago.pagado" required></label>
          <button type="button" (click)="pago.pagado = total(s)">Pagó completo ({{ total(s) | currency }})</button>
          @if (pago.pagado !== null) {
            <p [class]="saldoNuevo(s) < 0 ? 'mal' : 'ok'">
              @if (saldoNuevo(s) < 0) { Quedará un saldo pendiente de {{ -saldoNuevo(s) | currency }} }
              @else if (saldoNuevo(s) > 0) { Quedará un saldo a favor de {{ saldoNuevo(s) | currency }} }
              @else { Queda liquidado }
            </p>
          }
          <button>Registrar pago</button>
        </form>
      }

      <h3>Pagos</h3>
      <div class="tabla" tabindex="0" role="region" aria-label="Pagos"><table>
        <tr><th>Fecha</th><th>Plan</th><th>Cobro</th><th>Pagó</th><th>Forma de pago</th>@if (esAdmin()) { <th>Acciones</th> }</tr>
        @for (p of s.pagos; track p.id) {
          <tr [class.anulado]="p.anulado">
            <td>{{ iso(p.fecha) | date:'dd/MM/yyyy' }}</td>
            <td>{{ p.plan }}
              @if (p.acompanantes) { <br><small>Con {{ p.acompanantes }}</small> }
              @if (p.pagado_por) { <br><small>Lo pagó {{ p.pagado_por }}</small> }
            </td>
            @if (p.pagado_por) { <td>—</td><td>@if (p.anulado) { Anulado } @else { — }</td> }
            @else {
              <td>{{ p.cargo | currency }}</td>
              <td>@if (p.anulado) { <s>{{ p.monto | currency }}</s> Anulado } @else { {{ p.monto | currency }} }</td>
            }
            <td>{{ metodoTexto(p.metodo) }}</td>
            @if (esAdmin()) { <td>@if (p === ultimoVigente(s) && p.anulable) { <button type="button" class="peligro" (click)="anular(p)">Anular</button> }</td> }
          </tr>
        } @empty { <tr><td colspan="6">Sin pagos.</td></tr> }
      </table></div>

      <h3>Fechas en que ha venido</h3>
      @if (s.entradas.length) {
        <ol class="visitas">
          @for (f of s.entradas; track $index) { <li>{{ iso(f) | date:'dd/MM/yyyy, HH:mm' }}</li> }
        </ol>
      } @else { <p>Todavía no ha venido.</p> }
    } @else {
      <p role="status" [class]="errorCarga() ? 'aviso mal' : ''">{{ errorCarga() || 'Cargando…' }}</p>
    }
  `
})
export class SocioComponent {
  private gym = inject(GymService);
  @Input() id!: string; // viene de la ruta socio/:id
  s = signal<FichaSocio | null>(null);
  planes = signal<Plan[]>([]);
  inscripcion = signal(0);
  duracionTexto = duracionTexto;
  cobrando = signal(false);
  mensaje = aviso();
  errorCarga = signal(''); // este no se borra: sin ficha no hay nada más que mostrar
  pago = { plan_id: null as number | null, inscripcion: false, descuento: 0, pagado: null as number | null, metodo: 'efectivo' as Metodo, acompanantes: [] as number[] };
  socios = signal<Socio[]>([]); // para elegir acompañantes en un plan de grupo
  editando = signal(false);
  datos = { nombre: '', apellido1: '', apellido2: '' as string | null, telefono: '' };
  metodos = METODOS;
  metodoTexto = metodoTexto;
  whatsapp = enlaceWhatsApp;
  esAdmin = () => this.gym.usuario()?.rol === 'admin';
  // Solo el último pago vigente se puede anular (la API lo exige).
  ultimoVigente = (s: FichaSocio) => s.pagos.find(p => !p.anulado);
  version = signal(Date.now()); // cambia al subir foto para que el navegador no muestre la anterior
  iso = iso;

  private fallo = (e: any) => this.mensaje.set({ ok: false, texto: e.error?.error ?? e.message ?? 'Error de conexión' });

  ngOnInit() {
    this.cargar();
    this.gym.planes().subscribe(p => this.planes.set(p.filter(x => x.activo)));
    this.gym.ajustes().subscribe(a => this.inscripcion.set(a.inscripcion));
  }

  cargar() { this.gym.ficha(Number(this.id)).subscribe({ next: f => this.s.set(f), error: e => this.errorCarga.set(e.error?.error ?? 'Error de conexión') }); }

  entrar() {
    this.gym.registrarEntrada(Number(this.id)).subscribe({
      next: s => {
        this.mensaje.set(s.vigente ? { ok: true, texto: 'Entrada registrada. Bienvenido, ' + s.nombre }
                                   : { ok: false, texto: 'Entrada registrada, pero su membresía está vencida: cobrar antes de entrar' });
        this.cargar();
      },
      error: this.fallo
    });
  }

  // El total que ve recepción; la API recalcula el cargo con los precios guardados.
  precio = () => this.planes().find(p => p.id === this.pago.plan_id)?.precio ?? 0;
  // Un hueco por acompañante: plan de 3 personas → 2 selectores.
  huecos = () => [...Array(Math.max(0, (this.planes().find(p => p.id === this.pago.plan_id)?.personas ?? 1) - 1)).keys()];
  otros = (s: FichaSocio) => this.socios().filter(o => o.id !== s.id && o.activo);
  cuotaInscripcion = () => this.pago.inscripcion ? this.inscripcion() : 0;
  descuento = () => Number(this.pago.descuento) || 0;
  cargo = () => this.precio() + this.cuotaInscripcion() - this.descuento();
  total = (s: FichaSocio) => Math.max(0, this.cargo() - s.saldo);
  saldoNuevo = (s: FichaSocio) => Math.round((s.saldo + Number(this.pago.pagado) - this.cargo()) * 100) / 100;

  abrirCobro(s: FichaSocio) {
    if (this.cobrando()) return this.cobrando.set(false);
    const suPlan = this.planes().some(p => p.id === s.plan_id) ? s.plan_id : null;
    this.pago = { plan_id: suPlan, inscripcion: !s.ultimo_pago, descuento: 0, pagado: null, metodo: 'efectivo', acompanantes: [] }; // inscripción solo en su primer pago
    this.gym.socios().subscribe(l => this.socios.set(l));
    this.cobrando.set(true);
    enfocar('form.cobro');
  }

  pagar() {
    const { plan_id, inscripcion, descuento, pagado, metodo } = this.pago, acompanantes = this.pago.acompanantes.slice(0, this.huecos().length);
    if (plan_id === null || pagado === null) return;
    this.gym.pagar({ socio_id: Number(this.id), plan_id, inscripcion, descuento: Number(descuento) || 0, pagado: Number(pagado), metodo, acompanantes }).subscribe({
      next: s => {
        const saldo = s.saldo < 0 ? `, saldo pendiente ${(-s.saldo).toFixed(2)}` : s.saldo > 0 ? `, saldo a favor ${s.saldo.toFixed(2)}` : '';
        this.mensaje.set({ ok: s.saldo >= 0, texto: `Pago registrado, vigente hasta ${s.vence}${saldo}` });
        this.cobrando.set(false);
        this.cargar();
      },
      error: this.fallo
    });
  }

  abrirEdicion(s: FichaSocio) {
    this.datos = { nombre: s.nombre, apellido1: s.apellido1 ?? '', apellido2: s.apellido2, telefono: s.telefono ?? '' };
    this.editando.set(!this.editando());
    if (this.editando()) enfocar('form.edicion');
  }

  // Guarda los datos y, de paso, el estado de alta/baja.
  guardar(s: FichaSocio, activo: boolean) {
    if (!activo && !confirm(`¿Dar de baja a ${s.nombre_completo}? Su historial se conserva y se puede reactivar.`)) return;
    const datos = this.editando() ? this.datos : { nombre: s.nombre, apellido1: s.apellido1 ?? '', apellido2: s.apellido2, telefono: s.telefono ?? '' };
    this.gym.editarSocio(s.id, { ...datos, activo }).subscribe({
      next: () => {
        this.mensaje.set({ ok: true, texto: activo === !!s.activo ? 'Datos guardados' : activo ? 'Socio reactivado' : 'Socio dado de baja' });
        this.editando.set(false);
        this.cargar();
      },
      error: this.fallo
    });
  }

  avisado() { this.gym.marcarAviso(Number(this.id)).subscribe({ next: () => this.cargar(), error: this.fallo }); }

  anular(p: Pago) {
    if (!confirm(`¿Anular el pago de ${p.plan} por $${p.monto}? Su vencimiento regresa al de antes de ese pago.`)) return;
    this.gym.anular('pago', p.id).subscribe({ next: () => { this.mensaje.set({ ok: true, texto: 'Pago anulado' }); this.cargar(); }, error: this.fallo });
  }

  async cambiarFoto(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      await this.gym.guardarFoto(Number(this.id), f);
      this.version.set(Date.now());
      this.mensaje.set({ ok: true, texto: 'Foto guardada' });
      this.cargar();
    } catch (err: any) {
      this.fallo({ error: { error: 'No se pudo guardar la foto: ' + (err.error?.error ?? err.message) } });
    }
  }
}
