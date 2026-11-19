import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, tap } from 'rxjs';

export interface Socio { id: number; nombre: string; apellido1: string | null; apellido2: string | null; nombre_completo: string; telefono?: string; vence: string | null; vigente: boolean;
  creado: string; tiene_foto: boolean; dias_restantes: number | null;
  plan_id: number | null; plan: string | null; saldo: number; // saldo > 0 a favor, < 0 pendiente
  activo: number; avisado: string | null; }
export type Metodo = 'efectivo' | 'tarjeta' | 'transferencia';
export const METODOS: Metodo[] = ['efectivo', 'tarjeta', 'transferencia'];
export interface Pago { id: number; fecha: string; plan: string; monto: number; cargo: number; metodo: Metodo; anulado: boolean; anulable: boolean; }
export interface FichaSocio extends Socio { entradas: string[]; ultimo_pago: { fecha: string; plan: string; monto: number } | null; pagos: Pago[]; }
export type Rol = 'admin' | 'recepcion';
export interface Usuario { id: number; usuario: string; nombre: string; rol: Rol; activo?: number; cambiar_clave?: boolean; }
export interface Movimiento { tipo: 'pago' | 'visita' | 'venta'; id: number; fecha: string; concepto: string; monto: number; metodo: Metodo; usuario: string; anulado: boolean; }
export interface Corte { movimientos: Movimiento[]; total: number; por_tipo: Record<string, number>; por_metodo: Record<string, number>; por_usuario: Record<string, number>; }
export type DatosSocio = { nombre: string; apellido1: string; apellido2: string | null; telefono: string };
export type Unidad = 'meses' | 'dias';
export interface Plan { id: number; nombre: string; duracion: number; unidad: Unidad; precio: number; activo: number; }
export type PlanNuevo = Omit<Plan, 'id' | 'activo'> & { activo?: boolean };
export interface Producto { id: number; nombre: string; precio: number; existencia: number; activo: number; }

@Injectable({ providedIn: 'root' })
export class GymService {
  private http = inject(HttpClient);
  usuario = signal<Usuario | null>(null);
  guardando = signal(0); // envíos en curso (POST/PUT/DELETE)

  login(usuario: string, clave: string) { return this.http.post<Usuario>('/api/login', { usuario, clave }).pipe(tap(u => this.usuario.set(u))); }
  yo() { return this.http.get<Usuario>('/api/yo').pipe(tap(u => this.usuario.set(u))); }
  cambiarClave(actual: string, nueva: string) {
    return this.http.put('/api/clave', { actual, nueva }).pipe(tap(() => this.usuario.update(u => u && { ...u, cambiar_clave: false })));
  }
  usuarios() { return this.http.get<Usuario[]>('/api/usuarios'); }
  crearUsuario(u: { usuario: string; nombre: string; clave: string; rol: Rol }) { return this.http.post<Usuario>('/api/usuarios', u); }
  editarUsuario(id: number, u: { nombre: string; rol: Rol; activo: boolean; clave?: string }) { return this.http.put<Usuario>(`/api/usuarios/${id}`, u); }
  logout() { return this.http.post('/api/logout', {}).pipe(tap(() => this.usuario.set(null))); }

  planes() { return this.http.get<Plan[]>('/api/planes'); }
  crearPlan(p: PlanNuevo) { return this.http.post<Plan>('/api/planes', p); }
  editarPlan(id: number, p: PlanNuevo) { return this.http.put<Plan>(`/api/planes/${id}`, p); }
  ajustes() { return this.http.get<{ inscripcion: number }>('/api/ajustes'); }
  guardarAjustes(a: { inscripcion: number }) { return this.http.put<{ inscripcion: number }>('/api/ajustes', a); }
  socios(q = '') { return this.http.get<Socio[]>('/api/socios', { params: { q } }); }
  crearSocio(s: { nombre: string; apellido1: string; apellido2: string; telefono: string; plan_id: number | null }) { return this.http.post<Socio>('/api/socios', s); }
  editarSocio(id: number, s: DatosSocio & { activo: boolean }) { return this.http.put<Socio>(`/api/socios/${id}`, s); }
  avisos(dias = 7) { return this.http.get<Socio[]>('/api/avisos', { params: { dias } }); }
  marcarAviso(id: number) { return this.http.post<Socio>(`/api/socios/${id}/aviso`, {}); }
  registrarEntrada(socio_id: number) { return this.http.post<Socio>('/api/entradas', { socio_id }); }
  ficha(id: number) { return this.http.get<FichaSocio>(`/api/socios/${id}`); }
  async guardarFoto(id: number, archivo: File) {
    const foto = await reducirFoto(archivo);
    await firstValueFrom(this.http.put(`/api/socios/${id}/foto`, foto, { headers: { 'Content-Type': foto.type } }));
  }
  pagar(p: { socio_id: number; plan_id: number; inscripcion: boolean; descuento: number; pagado: number; metodo: Metodo }) { return this.http.post<Socio>('/api/pagos', p); }
  vender(v: { producto_id: number; cantidad: number; metodo: Metodo }) { return this.http.post('/api/ventas', v); }
  productos() { return this.http.get<Producto[]>('/api/productos'); }
  agregarInventario(i: { nombre: string; cantidad: number; precio: number }) { return this.http.post<Producto>('/api/inventario', i); }
  editarProducto(id: number, p: { nombre: string; precio: number; existencia: number; activo: boolean }) { return this.http.put<Producto>(`/api/productos/${id}`, p); }
  registrarVisita(v: { nombre: string; monto: number; metodo: Metodo }) { return this.http.post('/api/visitas', v); }
  anular(tipo: Movimiento['tipo'], id: number) { return this.http.post(`/api/${tipo}s/${id}/anular`, {}); }
  corte(fecha: string) { return this.http.get<Corte>('/api/corte', { params: { fecha } }); }
}

// Reduce la foto a 480px en JPEG antes de subirla: las de celular pesan varios MB.
export async function reducirFoto(archivo: File, lado = 480): Promise<Blob> {
  const img = await createImageBitmap(archivo).catch(() => {
    throw new Error('el navegador no puede leer ese formato (las de iPhone suelen ser HEIC); mándala como JPG');
  });
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * escala);
  canvas.height = Math.round(img.height * escala);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, mal) => canvas.toBlob(b => b ? ok(b) : mal(new Error('No se pudo leer la foto')), 'image/jpeg', 0.85));
}

export const duracionTexto = (p: Plan) => `${p.duracion} ${p.unidad === 'dias' ? (p.duracion === 1 ? 'día' : 'días') : (p.duracion === 1 ? 'mes' : 'meses')}`;

export const metodoTexto = (m: string) => ({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' } as Record<string, string>)[m] ?? m;

// Abre WhatsApp con el recordatorio ya escrito; recepción solo pulsa enviar.
// shortcut: lada 52 fija (celulares de México, igual que la validación de la API)
export function enlaceWhatsApp(s: Pick<Socio, 'nombre' | 'telefono' | 'vence' | 'dias_restantes'>) {
  const fecha = s.vence ? s.vence.split('-').reverse().join('/') : '';
  const d = s.dias_restantes;
  const texto = d === null ? `Hola ${s.nombre}, te esperamos en el gimnasio para activar tu membresía.`
    : d < 0 ? `Hola ${s.nombre}, tu membresía del gimnasio venció el ${fecha}. ¡Te esperamos para renovarla!`
    : d === 0 ? `Hola ${s.nombre}, hoy es el último día de tu membresía del gimnasio. ¡Renuévala para no perder tu ritmo!`
    : `Hola ${s.nombre}, tu membresía del gimnasio vence el ${fecha} (en ${d} ${d === 1 ? 'día' : 'días'}). ¡Te esperamos para renovarla!`;
  return `https://wa.me/52${s.telefono}?text=${encodeURIComponent(texto)}`;
}

// Mensaje de éxito que se borra solo; los errores se quedan hasta el siguiente mensaje.
export function aviso(ms = 6000) {
  const vacio = { ok: true, texto: '' }, s = signal(vacio), set = s.set;
  let t: ReturnType<typeof setTimeout> | undefined;
  s.set = v => { clearTimeout(t); set(v); if (v.ok && v.texto) t = setTimeout(() => set(vacio), ms); };
  return s;
}

// Lleva el foco al primer campo de un formulario recién abierto (espera a que Angular lo pinte).
export const enfocar = (selector: string) =>
  setTimeout(() => document.querySelector<HTMLElement>(`${selector} :is(input, select)`)?.focus());
