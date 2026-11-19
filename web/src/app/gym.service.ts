import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, tap } from 'rxjs';

export interface Socio { id: number; nombre: string; apellido1: string | null; apellido2: string | null; nombre_completo: string; telefono?: string; vence: string | null; vigente: boolean;
  creado: string; tiene_foto: boolean; dias_restantes: number | null;
  plan_id: number | null; plan: string | null; saldo: number; } // saldo > 0 a favor, < 0 pendiente
export interface FichaSocio extends Socio { entradas: string[]; ultimo_pago: { fecha: string; plan: string; monto: number } | null; }
export type Rol = 'admin' | 'recepcion';
export interface Usuario { id: number; usuario: string; nombre: string; rol: Rol; }
export type Unidad = 'meses' | 'dias';
export interface Plan { id: number; nombre: string; duracion: number; unidad: Unidad; precio: number; activo: number; }
export type PlanNuevo = Omit<Plan, 'id' | 'activo'> & { activo?: boolean };
export interface Producto { id: number; nombre: string; precio: number; existencia: number; }

@Injectable({ providedIn: 'root' })
export class GymService {
  private http = inject(HttpClient);
  usuario = signal<Usuario | null>(null);

  login(usuario: string, clave: string) { return this.http.post<Usuario>('/api/login', { usuario, clave }).pipe(tap(u => this.usuario.set(u))); }
  yo() { return this.http.get<Usuario>('/api/yo').pipe(tap(u => this.usuario.set(u))); }
  cambiarClave(actual: string, nueva: string) { return this.http.put('/api/clave', { actual, nueva }); }
  usuarios() { return this.http.get<Usuario[]>('/api/usuarios'); }
  crearUsuario(u: { usuario: string; nombre: string; clave: string; rol: Rol }) { return this.http.post<Usuario>('/api/usuarios', u); }
  logout() { return this.http.post('/api/logout', {}).pipe(tap(() => this.usuario.set(null))); }

  planes() { return this.http.get<Plan[]>('/api/planes'); }
  crearPlan(p: PlanNuevo) { return this.http.post<Plan>('/api/planes', p); }
  editarPlan(id: number, p: PlanNuevo) { return this.http.put<Plan>(`/api/planes/${id}`, p); }
  ajustes() { return this.http.get<{ inscripcion: number }>('/api/ajustes'); }
  guardarAjustes(a: { inscripcion: number }) { return this.http.put<{ inscripcion: number }>('/api/ajustes', a); }
  socios(q = '') { return this.http.get<Socio[]>('/api/socios', { params: { q } }); }
  crearSocio(s: { nombre: string; apellido1: string; apellido2: string; telefono: string; plan_id: number | null }) { return this.http.post<Socio>('/api/socios', s); }
  registrarEntrada(socio_id: number) { return this.http.post<Socio>('/api/entradas', { socio_id }); }
  ficha(id: number) { return this.http.get<FichaSocio>(`/api/socios/${id}`); }
  async guardarFoto(id: number, archivo: File) {
    const foto = await reducirFoto(archivo);
    await firstValueFrom(this.http.put(`/api/socios/${id}/foto`, foto, { headers: { 'Content-Type': foto.type } }));
  }
  pagar(p: { socio_id: number; plan_id: number; inscripcion: boolean; descuento: number; pagado: number }) { return this.http.post<Socio>('/api/pagos', p); }
  vender(v: { producto_id: number; cantidad: number }) { return this.http.post('/api/ventas', v); }
  productos() { return this.http.get<Producto[]>('/api/productos'); }
  agregarInventario(i: { nombre: string; cantidad: number; precio: number }) { return this.http.post<Producto>('/api/inventario', i); }
  registrarVisita(v: { nombre: string; monto: number }) { return this.http.post('/api/visitas', v); }
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
