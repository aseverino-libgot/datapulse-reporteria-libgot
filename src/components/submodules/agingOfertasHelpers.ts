// src/components/submodules/agingOfertasHelpers.ts
// Lógica pura de Callcenter › Aging de ofertas: tipos, tabla por tramo, controles y export.
// Spec: docs/superpowers/specs/2026-11-26-tablero-aging-renovadores.md. Un país a la vez.
import { tasa, fmtNum, type Pais } from './upgradeOfertaHelpers';

export { PAISES, NOMBRE_PAIS, fmtNum, fmtPct, fmtFecha, tasa } from './upgradeOfertaHelpers';
export type { Pais } from './upgradeOfertaHelpers';

/** Tramos que devuelve el servidor (server/agingOfertasQuery.ts, único lugar donde vive la regla). */
export type Tramo = 'CONTROL' | '0-30' | '31-60' | '61-90' | '91-180' | '+180';
export const TRAMOS_HASTA_180: Tramo[] = ['0-30', '31-60', '61-90', '91-180'];

/** Fila del endpoint: país × tramo. Solo conteos. */
export interface FilaAging {
  pais: Pais;
  tramo: Tramo;
  ofertas_vivas: number;
  ventas_mes: number;
  con_oferta_posterior: number;
  vendio_despues: number;
}

export interface Conciliacion {
  ventas_vista: number;
  ventas_tabla_oficial: number;
  ventas_sin_oferta: number;
}

// ── Tabla ───────────────────────────────────────────────────────────────────────
/** subtotal = indicador principal (hasta 180 días); mas180 y total son secundarios. */
export type TipoFila = 'tramo' | 'subtotal' | 'mas180' | 'total' | 'control';

export interface FilaTabla {
  clave: string;
  etiqueta: string;
  tipo: TipoFila;
  ofertas: number;
  ventas: number;
  conversion: number | null; // ventas / ofertas del tramo
  peso: number | null;       // ventas del tramo / ventas totales del país (incluye +180)
}

export interface TablaAging {
  tramos: FilaTabla[];        // 0-30, 31-60, 61-90, 91-180
  subtotal: FilaTabla;        // hasta 180 días
  mas180: FilaTabla;
  total: FilaTabla;           // incluye +180 (y CONTROL, que debe estar vacía)
  control: FilaTabla | null;  // solo si tiene ofertas
  conOfertaPosterior: number; // ventas con oferta registrada después de la venta, contadas en 0-30
  vendioDespues: number;      // no vendidos del mes que vendieron después del cierre
  noVendidos: number;         // ofertas vivas − ventas del mes (incluye a los que compraron después del cierre)
  aExportar: number;          // filas esperadas del export = noVendidos − vendioDespues (siguen sin comprar)
}

const ETIQUETA: Record<Tramo, string> = {
  '0-30': '0-30 días',
  '31-60': '31-60 días',
  '61-90': '61-90 días',
  '91-180': '91-180 días',
  '+180': 'Más de 180 días',
  CONTROL: 'Control: oferta registrada más de 7 días después de la venta',
};

export function armarTabla(filas: FilaAging[], pais: Pais): TablaAging {
  const delPais = filas.filter(f => f.pais === pais);
  const sumar = (fs: FilaAging[], k: keyof Pick<FilaAging, 'ofertas_vivas' | 'ventas_mes' | 'con_oferta_posterior' | 'vendio_despues'>) =>
    fs.reduce((s, f) => s + f[k], 0);
  const ventasTotales = sumar(delPais, 'ventas_mes');

  const fila = (clave: string, etiqueta: string, tipo: TipoFila, fs: FilaAging[]): FilaTabla => {
    const ofertas = sumar(fs, 'ofertas_vivas');
    const ventas = sumar(fs, 'ventas_mes');
    return { clave, etiqueta, tipo, ofertas, ventas, conversion: tasa(ventas, ofertas), peso: tasa(ventas, ventasTotales) };
  };
  const de = (t: Tramo) => delPais.filter(f => f.tramo === t);

  const tramos = TRAMOS_HASTA_180.map(t => fila(t, ETIQUETA[t], 'tramo', de(t)));
  const control = fila('CONTROL', ETIQUETA.CONTROL, 'control', de('CONTROL'));
  const total = fila('total', 'Total', 'total', delPais);
  const vendioDespues = sumar(delPais, 'vendio_despues');
  const noVendidos = total.ofertas - total.ventas;

  return {
    tramos,
    subtotal: fila('subtotal', 'Subtotal hasta 180 días', 'subtotal', delPais.filter(f => TRAMOS_HASTA_180.includes(f.tramo))),
    mas180: fila('+180', ETIQUETA['+180'], 'mas180', de('+180')),
    total,
    control: control.ofertas > 0 ? control : null,
    conOfertaPosterior: sumar(delPais, 'con_oferta_posterior'),
    vendioDespues,
    noVendidos,
    aExportar: noVendidos - vendioDespues,
  };
}

// ── Controles ───────────────────────────────────────────────────────────────────
/** Problemas de conciliación (Query 2) y fila CONTROL. Vacío = todo cierra. */
export function revisarControles(c: Conciliacion | undefined, t: TablaAging): string[] {
  if (!c) return ['Sin datos de conciliación'];
  const p: string[] = [];
  if (c.ventas_vista !== c.ventas_tabla_oficial) {
    p.push(`Ventas en la vista (${c.ventas_vista.toLocaleString('es-AR')}) distintas de la tabla oficial (${c.ventas_tabla_oficial.toLocaleString('es-AR')})`);
  }
  if (t.total.ventas !== c.ventas_tabla_oficial) {
    p.push(`Ventas del tablero (${t.total.ventas.toLocaleString('es-AR')}) distintas de la tabla oficial (${c.ventas_tabla_oficial.toLocaleString('es-AR')})`);
  }
  if (c.ventas_sin_oferta > 0) p.push(`${c.ventas_sin_oferta.toLocaleString('es-AR')} ventas sin oferta registrada (no entran al tablero)`);
  if (t.control) p.push(`${t.control.ofertas.toLocaleString('es-AR')} ventas con oferta registrada más de 7 días después (fila de control)`);
  return p;
}

// ── Export ──────────────────────────────────────────────────────────────────────
/**
 * Fila del export: renovador con oferta viva en el mes que no compró en el mes ni después del cierre.
 * Incluye teléfono y email del cliente (datos personales): solo viajan al archivo, no se guardan en el estado.
 */
export interface FilaNoVendido {
  pais: Pais;
  lead_id: number;
  fecha_oferta: string; // 'YYYY-MM-DD'
  dias_aging: number;
  tramo_aging: Tramo;
  monto_oferta: number | null;           // lead_offers_*.max_amount
  monto_oferta_increased: number | null; // null = celda vacía (oferta anterior al inicio del upgrade); nulo en origen = 0
  telefono: string | null;               // tal como está en origen (texto)
  email: string | null;                  // tal como está en origen
}

/** Orden de columnas del Excel (confirmado). */
export const COLUMNAS_EXPORT: (keyof FilaNoVendido)[] = [
  'pais', 'lead_id', 'fecha_oferta', 'dias_aging', 'tramo_aging',
  'monto_oferta', 'monto_oferta_increased', 'telefono', 'email',
];

/**
 * Primer día con datos reales del upgrade por país, para la nota de la pantalla.
 * Deben coincidir con PAISES.inicio_datos de server/upgradeOfertaQuery.ts; si cambian allá, actualizar acá.
 */
export const INICIO_UPGRADE: Record<Pais, string> = { ARG: '2026-10-28', COL: '2026-11-03' };

/** Fecha de hoy en hora de Argentina, 'YYYYMMDD' (fecha de descarga para el nombre del archivo). */
const fechaDescarga = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date()).replace(/-/g, '');

/** renovadores_no_vendidos_{PAIS}_{YYYY-MM}_{YYYYMMDD}.xlsx (la última parte es la fecha de descarga). */
export const nombreArchivoExport = (pais: Pais, mes: string) =>
  `renovadores_no_vendidos_${pais}_${mes}_${fechaDescarga()}.xlsx`;

export interface RevisionExport {
  problemas: string[]; // no se cumple la regla: filas + excluidos = ofertas vivas − ventas del mes
  avisos: string[];    // los excluidos no coinciden con el tablero (venta nueva o caché): informativo, no es error grave
}

/**
 * Controles del export contra el tablero:
 *  1. Regla: filas del archivo + excluidos por venta posterior = ofertas vivas − ventas del mes.
 *  2. Cruce: excluidos del export = "vendieron después del cierre" del tablero. Puede diferir si entró una venta
 *     nueva o si el tablero viene de la caché: es un aviso, no un error.
 */
export function revisarExport(filas: FilaNoVendido[], excluidos: number, t: TablaAging): RevisionExport {
  const problemas: string[] = [];
  const avisos: string[] = [];
  if (filas.length + excluidos !== t.noVendidos) {
    problemas.push(
      `El archivo tiene ${fmtNum(filas.length)} filas y se excluyeron ${fmtNum(excluidos)} (suman ${fmtNum(filas.length + excluidos)}), ` +
      `pero el tablero indica ${fmtNum(t.noVendidos)} no vendidos del mes`,
    );
  }
  if (excluidos !== t.vendioDespues) {
    avisos.push(
      `Los excluidos del archivo (${fmtNum(excluidos)}) no coinciden con el tablero (${fmtNum(t.vendioDespues)}): ` +
      `puede deberse a una venta nueva o a la caché del tablero. Refrescar y volver a exportar.`,
    );
  }
  return { problemas, avisos };
}

// ── Formato ─────────────────────────────────────────────────────────────────────
const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
/** 'YYYY-MM' → 'Octubre 2026'. */
export const fmtMesLargo = (mes: string) => `${MESES_LARGOS[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;

/** ISO → 'dd/mm/yyyy hh:mm' (hora de Argentina), para la fecha de consulta. */
export const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-AR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
});
