// src/components/submodules/upgradeOfertaHelpers.ts
// Lógica pura de Callcenter › Upgrade de oferta: tipos, filtros, agregaciones y formato.
// Se muestra un país a la vez: los montos (ARS / COP) no se suman entre países.

export type Pais = 'ARG' | 'COL';
export type FiltroUpgrade = 'todas' | 'si' | 'no';
/** Calculado en el servidor (BASE_CTE de server/upgradeOfertaQuery.ts), único lugar donde vive la regla. */
export type Segmento = 'sin_upgrade' | 'disponible_no_tomado' | 'tomado_parcial' | 'tomado_completo';

export const PAISES: Pais[] = ['ARG', 'COL'];
export const NOMBRE_PAIS: Record<Pais, string> = { ARG: 'Argentina', COL: 'Colombia' };

/** Color por país (sigue a la entidad). Slots 1 y 2 de la paleta categórica, pasos para fondo oscuro. */
export const COLOR_PAIS: Record<Pais, string> = { ARG: '#338ced', COL: '#e76624' };

export const esTomado = (s: Segmento) => s === 'tomado_completo' || s === 'tomado_parcial';

/** Filtro "Tuvo upgrade disponible": Sí = upgrade disponible (lo haya tomado o no); No = sin upgrade. */
export const SEGMENTOS_POR_FILTRO: Record<FiltroUpgrade, Segmento[]> = {
  todas: ['sin_upgrade', 'disponible_no_tomado', 'tomado_parcial', 'tomado_completo'],
  si: ['disponible_no_tomado', 'tomado_parcial', 'tomado_completo'],
  no: ['sin_upgrade'],
};

/** Fila del endpoint: país × día de creación de la oferta × segmento. Solo sumas y conteos. */
export interface FilaUpgrade {
  pais: Pais;
  fecha: string; // 'YYYY-MM-DD'
  segmento: Segmento;
  ofertas: number;
  ventas: number;
  monto_vendido: number;
  sin_tope_inicial: number;
  tope_inicial: number;
  tope_ajustado: number;
}

/** Selección para el detalle de créditos (segunda etapa). En la v1 nadie la consume. */
export interface SeleccionDetalle {
  pais: Pais;
  desde: string;
  hasta: string;
  segmentos: Segmento[];
}

export interface Filtros {
  pais: Pais;
  upgrade: FiltroUpgrade;
  desde: string; // inclusive
  hasta: string; // inclusive
}

export function filtrarFilas(filas: FilaUpgrade[], f: Filtros, { ignorarFechas = false } = {}): FilaUpgrade[] {
  const segs = SEGMENTOS_POR_FILTRO[f.upgrade];
  return filas.filter(r =>
    r.pais === f.pais
    && segs.includes(r.segmento)
    && (ignorarFechas || (r.fecha >= f.desde && r.fecha <= f.hasta)));
}

// ── Agregación (un país; montos en su moneda local) ─────────────────────────────
export interface Totales {
  ofertas: number;
  ventas: number;
  montoVendido: number;
  disponibles: number;        // ofertas con upgrade disponible (incluye tomados)
  disponiblesSinMotor: number;// con upgrade disponible pero sin dato del motor: solo pueden ser completas
  tomados: number;            // completos + parciales
  completos: number;
  parciales: number;
  ventasTomado: number;
  montoVendidoTomado: number;
  tomadosConTope: number;     // tomados con dato del motor
  topeInicialTomado: number;  // Σ tope del motor de los tomados
  topeAjustadoTomado: number; // Σ max_amount actual de los tomados (con dato del motor)
}

export const totalesVacios = (): Totales => ({
  ofertas: 0, ventas: 0, montoVendido: 0, disponibles: 0, disponiblesSinMotor: 0, tomados: 0, completos: 0,
  parciales: 0, ventasTomado: 0, montoVendidoTomado: 0, tomadosConTope: 0, topeInicialTomado: 0, topeAjustadoTomado: 0,
});

export function acumular(t: Totales, r: FilaUpgrade): Totales {
  t.ofertas += r.ofertas;
  t.ventas += r.ventas;
  t.montoVendido += r.monto_vendido;
  if (r.segmento !== 'sin_upgrade') {
    t.disponibles += r.ofertas;
    t.disponiblesSinMotor += r.sin_tope_inicial;
  }
  if (esTomado(r.segmento)) {
    t.tomados += r.ofertas;
    if (r.segmento === 'tomado_completo') t.completos += r.ofertas; else t.parciales += r.ofertas;
    t.ventasTomado += r.ventas;
    t.montoVendidoTomado += r.monto_vendido;
    t.tomadosConTope += r.ofertas - r.sin_tope_inicial;
    t.topeInicialTomado += r.tope_inicial;
    t.topeAjustadoTomado += r.tope_ajustado;
  }
  return t;
}

export function totales(filas: FilaUpgrade[]): Totales {
  const t = totalesVacios();
  for (const r of filas) acumular(t, r);
  return t;
}

export interface FilaPeriodo {
  clave: string; // fecha 'YYYY-MM-DD' o mes 'YYYY-MM'
  t: Totales;
}

/** Agrupa por día o mes. Orden: más reciente primero. */
export function agruparPorPeriodo(filas: FilaUpgrade[], nivel: 'dia' | 'mes'): FilaPeriodo[] {
  const m = new Map<string, FilaPeriodo>();
  for (const r of filas) {
    const clave = nivel === 'dia' ? r.fecha : r.fecha.slice(0, 7);
    let g = m.get(clave);
    if (!g) { g = { clave, t: totalesVacios() }; m.set(clave, g); }
    acumular(g.t, r);
  }
  return [...m.values()].sort((a, b) => b.clave.localeCompare(a.clave));
}

/** Serie diaria para el gráfico: todas las fechas del rango (ascendentes), 0 si ese día no hubo ofertas del filtro. */
export function serieDiaria(filas: FilaUpgrade[], desde: string, hasta: string, valor: (t: Totales) => number) {
  const porDia = new Map(agruparPorPeriodo(filas, 'dia').map(g => [g.clave, g.t]));
  const fechas: string[] = [];
  if (desde && hasta) for (let d = desde; d <= hasta; d = sumarDias(d, 1)) fechas.push(d);
  return { fechas, valores: fechas.map(f => { const t = porDia.get(f); return t ? valor(t) : 0; }) };
}

// ── Fechas ──────────────────────────────────────────────────────────────────────
export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const primerDiaDelMes = (fecha: string) => `${fecha.slice(0, 7)}-01`;
export const maxFecha = (a: string, b: string) => (a > b ? a : b);
export const minFecha = (a: string, b: string) => (a < b ? a : b);

// ── Formato (miles con punto, decimales con coma) ───────────────────────────────
export const tasa = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export const fmtNum = (n: number) => Math.round(n).toLocaleString('es-AR');

export const fmtPct = (v: number | null, decimales = 1) =>
  v === null ? '—' : `${(v * 100).toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}%`;

/** Monto en la moneda local del país: ARS con "$", COP con "COP". */
export const fmtMonto = (v: number | null, pais: Pais) =>
  v === null ? '—' : `${pais === 'ARG' ? '$' : 'COP'} ${Math.round(v).toLocaleString('es-AR')}`;

/** 'YYYY-MM-DD' → 'dd/mm/yyyy'. */
export const fmtFecha = (f: string) => f.split('-').reverse().join('/');

/** 'YYYY-MM-DD' → 'dd/mm'. */
export const fmtDiaCorto = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
/** 'YYYY-MM' → 'Nov-26'. */
export const fmtMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}-${mes.slice(2, 4)}`;
