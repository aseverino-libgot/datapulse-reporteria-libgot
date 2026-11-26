// server/upgradeOfertaQuery.ts
// Callcenter · Upgrade de oferta. Spec: docs/superpowers/specs/2026-11-25-callcenter-upgrade-ofertas.md
// ("Definiciones validadas" prevalece). Solo lectura: SELECT dentro de una transacción READ ONLY, con statement_timeout.
import type { Pool } from 'pg';

export type PaisUpgrade = 'ARG' | 'COL';
export type SegmentoUpgrade = 'sin_upgrade' | 'disponible_no_tomado' | 'tomado_parcial' | 'tomado_completo';

const STATEMENT_TIMEOUT_MS = 180_000;
/** Rango máximo aceptado por el endpoint (días, inclusive). */
export const MAX_DIAS_RANGO = 400;

/** Error de validación de parámetros: el endpoint lo traduce a HTTP 400. */
export class ParamError extends Error {}

interface PaisConfig {
  /** Primer día con datos reales (anteriores = registros de prueba, se descartan). Spec: "Datos disponibles". */
  inicio_datos: string;
  /** Zona horaria local. lead_offers.created_at está guardado en hora local (verificado en Fase 0). */
  tz: string;
}

/** Registro cerrado de países. */
export const PAISES: Record<PaisUpgrade, PaisConfig> = {
  ARG: { inicio_datos: '2026-10-28', tz: 'America/Argentina/Buenos_Aires' },
  COL: { inicio_datos: '2026-11-03', tz: 'America/Bogota' },
};

// ── SQL ─────────────────────────────────────────────────────────────────────────
// Parámetros: $1 desde ARG, $2 hasta ARG (exclusivo), $3 desde COL, $4 hasta COL (exclusivo). Todos 'YYYY-MM-DD'.
//
// BASE_CTE deja una fila por oferta (pais, fecha_oferta, lead_id, segmento, monto_motor, max_amount,
// max_amount_increased, loan_id, monto_venta). Q_AGREGADO la resume por día; la segunda etapa (detalle
// de créditos) debe reusar BASE_CTE para que la regla de segmentos viva en un solo lugar.
//
// - Oferta: una fila por lead en lead_offers, por fecha de creación (created_at::date, hora local).
// - Venta: loan con status 20/39 (ARG) o 22/24 (COL). Monto: amount (ARG) / total_amount (COL).
//   Se toma un loan por lead (el de mayor id) para que un lead nunca cuente dos veces.
// - Upgrade disponible: max_amount_increased > 0 (incluye los tomados).
// - Upgrade tomado (segmento calculado SOLO en `base`, lo reusa el detalle de la segunda etapa):
//     tomado_completo: max_amount = max_amount_increased.
//     tomado_parcial:  valor inicial < max_amount < max_amount_increased (el cliente tomó menos que el aumentado).
//   Sin dato del motor solo puede ser completo.
// - Valor inicial (tope): monto_max_ofertado de platinum_ia.consultas_motor_multipais por lead; se toma la fila más
//   reciente (rn = 1). En ARG la vista guarda solo la PRIMERA ejecución por lead (excluye políticas 10, 14 y 16); en COL
//   guarda todas (excluye 16, 17 y 18), así que en COL es la última. La diferencia es inocua en los datos observados.
//   La vista expone documento_cliente (DNI/cédula): no se selecciona.
//   Ventana del motor: [desde − 35 días, hasta + 2 días). Desfase máximo medido 28 días (ARG); +2 días por la
//   zona horaria del motor COL y reconsultas. Se filtra además por los lead_id del rango (semi-join), así un
//   rango largo agranda la ventana en lugar de perder el valor inicial.
// - Monto ajustado: max_amount actual de la oferta.
const BASE_CTE = `
WITH ofertas AS (
  SELECT 'ARG'::varchar(3) AS pais, o.lead_id, o.created_at::date AS fecha_oferta,
         o.max_amount, COALESCE(o.max_amount_increased, 0) AS max_amount_increased
  FROM core_arg.lead_offers_arg o
  WHERE o.created_at >= $1::date AND o.created_at < $2::date
  UNION ALL
  SELECT 'COL'::varchar(3), o.lead_id, o.created_at::date,
         o.max_amount, COALESCE(o.max_amount_increased, 0)
  FROM core_col.lead_offers_col o
  WHERE o.created_at >= $3::date AND o.created_at < $4::date
),
ventas AS (
  SELECT pais, lead_id, loan_id, monto_venta FROM (
    SELECT 'ARG'::varchar(3) AS pais, l.lead_id, l.id AS loan_id, l.amount AS monto_venta,
           ROW_NUMBER() OVER (PARTITION BY l.lead_id ORDER BY l.id DESC) AS rn
    FROM core_arg.loans_arg l
    WHERE l.status_id IN (20, 39) AND l.lead_id IN (SELECT lead_id FROM ofertas WHERE pais = 'ARG')
    UNION ALL
    SELECT 'COL'::varchar(3), l.lead_id, l.id, l.total_amount,
           ROW_NUMBER() OVER (PARTITION BY l.lead_id ORDER BY l.id DESC)
    FROM core_col.loans_col l
    WHERE l.status_id IN (22, 24) AND l.lead_id IN (SELECT lead_id FROM ofertas WHERE pais = 'COL')
  ) x
  WHERE rn = 1
),
motor AS (
  SELECT pais, lead_id, monto_max_ofertado,
         ROW_NUMBER() OVER (PARTITION BY pais, lead_id ORDER BY fecha_hora DESC) AS rn
  FROM platinum_ia.consultas_motor_multipais
  WHERE pais IN ('ARG', 'COL')
    AND fecha >= DATEADD(day, -35, LEAST($1::date, $3::date))
    AND fecha <  DATEADD(day, 2, GREATEST($2::date, $4::date))
    AND lead_id IN (SELECT lead_id::varchar FROM ofertas)
),
base AS (
  SELECT o.pais, o.fecha_oferta, o.lead_id, o.max_amount, o.max_amount_increased,
         CASE WHEN o.max_amount_increased > 0 AND o.max_amount = o.max_amount_increased THEN 'tomado_completo'
              WHEN o.max_amount_increased > 0 AND o.max_amount < o.max_amount_increased
                   AND m.monto_max_ofertado IS NOT NULL AND o.max_amount > m.monto_max_ofertado THEN 'tomado_parcial'
              WHEN o.max_amount_increased > 0 THEN 'disponible_no_tomado'
              ELSE 'sin_upgrade' END AS segmento,
         m.monto_max_ofertado AS monto_motor,
         v.loan_id, v.monto_venta
  FROM ofertas o
  LEFT JOIN ventas v ON v.pais = o.pais AND v.lead_id = o.lead_id
  LEFT JOIN motor m ON m.pais = o.pais AND m.lead_id = o.lead_id::varchar AND m.rn = 1
)`;

/** Agregado por país × día × segmento. Devuelve sumas y conteos (nunca promedios) para poder re-agregar en el cliente. */
const Q_AGREGADO = `${BASE_CTE}
SELECT pais,
       TO_CHAR(fecha_oferta, 'YYYY-MM-DD') AS fecha,
       segmento,
       COUNT(*) AS ofertas,
       COUNT(loan_id) AS ventas,
       SUM(monto_venta) AS monto_vendido,
       SUM(CASE WHEN monto_motor IS NULL THEN 1 ELSE 0 END) AS sin_tope_inicial,
       SUM(monto_motor) AS tope_inicial,
       SUM(CASE WHEN monto_motor IS NOT NULL THEN max_amount END) AS tope_ajustado
FROM base
GROUP BY pais, fecha_oferta, segmento
ORDER BY pais, fecha_oferta, segmento
LIMIT 5000`;

// ── Fechas ──────────────────────────────────────────────────────────────────────
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function esFechaValida(s: string): boolean {
  if (!RE_FECHA.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

const maxFecha = (a: string, b: string) => (a > b ? a : b);
const minFecha = (a: string, b: string) => (a < b ? a : b);

/** Fecha local de hoy en la zona horaria dada, 'YYYY-MM-DD'. */
export function hoyEn(tz: string, ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

/** Hoy local por país. El corte D-1 de cada país es el día anterior a este. */
export function hoyPorPais(ahora: Date = new Date()): Record<PaisUpgrade, string> {
  return { ARG: hoyEn(PAISES.ARG.tz, ahora), COL: hoyEn(PAISES.COL.tz, ahora) };
}

export interface RangoSolicitado {
  desde: string; // inclusive
  hasta: string; // inclusive
}

/**
 * Valida desde/hasta (opcionales, 'YYYY-MM-DD', inclusive).
 * Por defecto: desde el inicio de datos más antiguo hasta el último D-1. hasta se recorta al último D-1.
 */
export function parseRango(desdeRaw: unknown, hastaRaw: unknown, hoy: Record<PaisUpgrade, string>): RangoSolicitado {
  const ultimoD1 = sumarDias(maxFecha(hoy.ARG, hoy.COL), -1);
  const inicioMin = minFecha(PAISES.ARG.inicio_datos, PAISES.COL.inicio_datos);

  const vacio = (v: unknown) => v === undefined || v === null || v === '';
  let hasta = vacio(hastaRaw) ? ultimoD1 : String(hastaRaw);
  if (!esFechaValida(hasta)) throw new ParamError(`hasta no es una fecha válida (YYYY-MM-DD): "${hasta}"`);
  hasta = minFecha(hasta, ultimoD1);

  let desde: string;
  if (vacio(desdeRaw)) {
    desde = maxFecha(inicioMin, sumarDias(hasta, -(MAX_DIAS_RANGO - 1)));
  } else {
    desde = String(desdeRaw);
    if (!esFechaValida(desde)) throw new ParamError(`desde no es una fecha válida (YYYY-MM-DD): "${desde}"`);
  }
  if (desde > hasta) throw new ParamError(`desde (${desde}) es posterior a hasta (${hasta})`);
  if (diasEntre(desde, hasta) + 1 > MAX_DIAS_RANGO) {
    throw new ParamError(`El rango no puede superar ${MAX_DIAS_RANGO} días`);
  }
  return { desde, hasta };
}

// ── Resultado ───────────────────────────────────────────────────────────────────
export interface FilaUpgrade {
  pais: PaisUpgrade;
  fecha: string; // 'YYYY-MM-DD' (fecha de creación de la oferta, hora local)
  segmento: SegmentoUpgrade;
  ofertas: number;
  ventas: number;
  monto_vendido: number;    // moneda local del país
  sin_tope_inicial: number; // ofertas sin ejecución del motor en la ventana
  tope_inicial: number;     // Σ monto_max_ofertado (solo ofertas con motor)
  tope_ajustado: number;    // Σ max_amount actual (solo ofertas con motor, para comparar contra tope_inicial)
}

export interface RangoPais {
  inicio_datos: string;   // primer día con datos del país
  corte: string;          // D-1 local del país (último día incluido como máximo)
  desde: string | null;   // rango efectivo consultado (inclusive); null si el rango no cubre datos del país
  hasta: string | null;
}

export interface ResultadoUpgradeOferta {
  desde: string;
  hasta: string;
  paises: Record<PaisUpgrade, RangoPais>;
  filas: FilaUpgrade[];
}

const NUMERIC_FIELDS: (keyof FilaUpgrade)[] = [
  'ofertas', 'ventas', 'monto_vendido', 'sin_tope_inicial', 'tope_inicial', 'tope_ajustado',
];

/** Rango efectivo por país: [max(desde, inicio), min(hasta + 1, hoy local)), fin exclusivo. */
function rangoEfectivo(pais: PaisUpgrade, rango: RangoSolicitado, hoy: Record<PaisUpgrade, string>) {
  const desde = maxFecha(rango.desde, PAISES[pais].inicio_datos);
  const hastaExcl = minFecha(sumarDias(rango.hasta, 1), hoy[pais]);
  const vacio = desde >= hastaExcl;
  return {
    desde,
    hastaExcl: vacio ? desde : hastaExcl, // rango vacío: >= x AND < x no devuelve filas
    info: {
      inicio_datos: PAISES[pais].inicio_datos,
      corte: sumarDias(hoy[pais], -1),
      desde: vacio ? null : desde,
      hasta: vacio ? null : sumarDias(hastaExcl, -1),
    } as RangoPais,
  };
}

export async function runUpgradeOferta(
  pool: Pool, rango: RangoSolicitado, hoy: Record<PaisUpgrade, string>,
): Promise<ResultadoUpgradeOferta> {
  const arg = rangoEfectivo('ARG', rango, hoy);
  const col = rangoEfectivo('COL', rango, hoy);

  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout TO ${STATEMENT_TIMEOUT_MS}`); // constante numérica, no input
    await client.query('BEGIN READ ONLY');
    const result = await client.query(Q_AGREGADO, [arg.desde, arg.hastaExcl, col.desde, col.hastaExcl]);
    await client.query('ROLLBACK');

    const filas = result.rows.map((r: any) => {
      const out: any = { pais: String(r.pais), fecha: String(r.fecha), segmento: String(r.segmento) };
      for (const f of NUMERIC_FIELDS) out[f] = r[f] == null ? 0 : Number(r[f]); // bigint/numeric llegan como string
      return out as FilaUpgrade;
    });
    return { desde: rango.desde, hasta: rango.hasta, paises: { ARG: arg.info, COL: col.info }, filas };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('RESET statement_timeout').catch(() => {});
    client.release();
  }
}
