// server/agingOfertasQuery.ts
// Callcenter · Aging de ofertas (renovadores, ARG/COL). Spec: docs/superpowers/specs/2026-11-26-tablero-aging-renovadores.md
// Query 1 (sección 7) con el ajuste de +7 días al cierre, y Query 2 (conciliación), parametrizadas con $1/$2.
// Validado el 2026-11-26 contra la sección 10 (ene a oct 2026, ARG y COL): ofertas vivas, ventas y ofertas
// posteriores exactas, conciliación en 0 y fila CONTROL vacía.
// Solo lectura: SELECT dentro de una transacción READ ONLY, con statement_timeout.
import type { Pool, PoolClient } from 'pg';
import { hoyEn, PAISES } from './upgradeOfertaQuery';

export type PaisAging = 'ARG' | 'COL';
export const PAISES_AGING: PaisAging[] = ['ARG', 'COL'];

/** Tramos de aging. CONTROL = venta con oferta registrada más de 7 días después: debe quedar vacía. */
export type TramoAging = 'CONTROL' | '0-30' | '31-60' | '61-90' | '91-180' | '+180';

/** Primer mes del selector: rango validado contra las tablas oficiales (spec sección 10). Cambiar acá para ampliarlo. */
export const MES_INICIO = '2026-01';

/** Tope del export de no vendidos. Si se alcanza se corta con error, nunca se entrega un archivo incompleto. */
export const MAX_FILAS_EXPORT = 300_000;

const STATEMENT_TIMEOUT_MS = 180_000;
const TZ: Record<PaisAging, string> = { ARG: 'America/Argentina/Buenos_Aires', COL: 'America/Bogota' };

/** Error de validación de parámetros: el endpoint lo traduce a HTTP 400. */
export class ParamError extends Error {}

// ── SQL ─────────────────────────────────────────────────────────────────────────
// $1 = primer día del mes, $2 = último día del mes ('YYYY-MM-DD'). Fuente: gold.vw_vendedores_ventas, grano lead.
//
// Cambios respecto de la Query 1 del spec:
//  - Ofertas hasta fin de mes + 7 días, pero una oferta posterior al cierre solo entra si el lead vendió en el mes
//    (venta del último día con la oferta registrada 1 o 2 días después: atraso de carga de dia_oferta en ARG).
//    Para los no vendidos el universo es el mismo del spec. No cambió ningún número de ene a oct 2026.
//  - Se arrastran lead_id, f_previa y f_venta para el export. lead_id nunca sale en el agregado.
const BASE_CTE = `
WITH params AS (
  SELECT $1::date AS mes_ini, $2::date AS mes_fin
),
ofertas AS (   -- fechas de oferta de renovación por lead, hasta el cierre del mes + 7 días
  SELECT DISTINCT v.pais, v.lead_id, v.fecha AS f_oferta
  FROM gold.vw_vendedores_ventas v, params p
  WHERE v.tipo_cliente = 'renovador'
    AND v.flag_oferta = 1
    AND v.fecha <= DATEADD(day, 7, p.mes_fin)::date
),
ventas AS (    -- primera venta de renovación del lead
  SELECT pais, lead_id, MIN(fecha) AS f_venta
  FROM gold.vw_vendedores_ventas
  WHERE tipo_cliente = 'renovador'
    AND flag_venta = 1
  GROUP BY 1, 2
),
base AS (      -- ofertas vivas: el lead no había comprado antes del inicio del mes
  SELECT o.pais, o.lead_id, o.f_oferta, v.f_venta,
         CASE WHEN v.f_venta BETWEEN p.mes_ini AND p.mes_fin THEN 1 ELSE 0 END AS vendio_mes,
         CASE WHEN v.f_venta BETWEEN p.mes_ini AND p.mes_fin
              THEN v.f_venta ELSE p.mes_fin END AS f_corte
  FROM ofertas o
  CROSS JOIN params p
  LEFT JOIN ventas v ON v.pais = o.pais AND v.lead_id = o.lead_id
  WHERE (v.f_venta IS NULL OR v.f_venta >= p.mes_ini)
    AND (o.f_oferta <= p.mes_fin OR v.f_venta BETWEEN p.mes_ini AND p.mes_fin)
),
universo AS (  -- una fila por lead: última oferta hasta su corte (o la primera posterior)
  SELECT pais, lead_id, vendio_mes, f_corte, f_venta,
         MAX(CASE WHEN f_oferta <= f_corte THEN f_oferta END) AS f_previa,
         MIN(f_oferta)                                          AS f_min
  FROM base
  GROUP BY 1, 2, 3, 4, 5
),
aging AS (
  SELECT u.pais, u.lead_id, u.vendio_mes, u.f_previa,
         CASE WHEN u.vendio_mes = 0 AND u.f_venta > p.mes_fin THEN 1 ELSE 0 END AS vendio_despues,
         CASE WHEN u.f_previa IS NULL THEN 1 ELSE 0 END AS oferta_posterior,
         CASE WHEN u.f_previa IS NOT NULL                   THEN DATEDIFF(day, u.f_previa, u.f_corte)
              WHEN DATEDIFF(day, u.f_corte, u.f_min) <= 7   THEN 0
              ELSE NULL END AS dias
  FROM universo u CROSS JOIN params p
)`;

const TRAMO_SQL = `
       CASE WHEN dias IS NULL THEN 'CONTROL'
            WHEN dias <= 30   THEN '0-30'
            WHEN dias <= 60   THEN '31-60'
            WHEN dias <= 90   THEN '61-90'
            WHEN dias <= 180  THEN '91-180'
            ELSE                   '+180' END`;

/** Agregado país × tramo. Solo conteos. */
const Q_AGREGADO = `${BASE_CTE}
SELECT pais,
       ${TRAMO_SQL} AS tramo,
       COUNT(*)              AS ofertas_vivas,
       SUM(vendio_mes)       AS ventas_mes,
       SUM(oferta_posterior) AS con_oferta_posterior,
       SUM(vendio_despues)   AS vendio_despues
FROM aging
GROUP BY 1, 2
ORDER BY 1, 2
LIMIT 100`;

/** Conciliación (Query 2 del spec): ventas de la vista vs. tabla oficial, y ventas sin oferta. */
const Q_CONCILIACION = `
WITH params AS (
  SELECT $1::date AS mes_ini, $2::date AS mes_fin
),
vista AS (
  SELECT v.pais, v.lead_id, v.loan_id
  FROM gold.vw_vendedores_ventas v, params p
  WHERE v.tipo_cliente = 'renovador' AND v.flag_venta = 1
    AND v.fecha BETWEEN p.mes_ini AND p.mes_fin
),
con_oferta AS (
  SELECT DISTINCT pais, lead_id
  FROM gold.vw_vendedores_ventas
  WHERE tipo_cliente = 'renovador' AND flag_oferta = 1
)
SELECT 'ARG' AS pais,
       (SELECT COUNT(DISTINCT loan_id) FROM vista WHERE pais = 'ARG') AS ventas_vista,
       (SELECT COUNT(DISTINCT loan_id) FROM gold.ventas_arg, params p
         WHERE flag_venta = 1 AND renovacion = 'RENOVADO'
           AND fecha_desembolso BETWEEN p.mes_ini AND p.mes_fin)      AS ventas_tabla_oficial,
       (SELECT COUNT(*) FROM vista v LEFT JOIN con_oferta c
          ON c.pais = v.pais AND c.lead_id = v.lead_id
         WHERE v.pais = 'ARG' AND c.lead_id IS NULL)                  AS ventas_sin_oferta
UNION ALL
SELECT 'COL',
       (SELECT COUNT(DISTINCT loan_id) FROM vista WHERE pais = 'COL'),
       (SELECT COUNT(DISTINCT loan_id) FROM gold.ventas_col, params p
         WHERE flag_venta = 1 AND renovacion ILIKE 'renov%'
           AND fecha_desembolso BETWEEN p.mes_ini AND p.mes_fin),
       (SELECT COUNT(*) FROM vista v LEFT JOIN con_oferta c
          ON c.pais = v.pais AND c.lead_id = v.lead_id
         WHERE v.pais = 'COL' AND c.lead_id IS NULL)
LIMIT 10`;

/**
 * Export: renovadores con oferta viva en el mes que no compraron en el mes NI después del cierre (hoy siguen sin
 * comprar). $3 = país, $4 = inicio de datos reales del upgrade del país (PAISES[pais].inicio_datos, 'YYYY-MM-DD').
 * Filas = ofertas vivas − ventas del mes − vendieron después del cierre.
 * Los que vendieron después del cierre siguen contando en la tabla (Q_AGREGADO); acá solo se excluyen.
 *
 * Columnas agregadas (LEFT JOIN, no cambian la cantidad de filas; validado con conteos en oct-26 ARG/COL):
 *  - La oferta es la misma del aging: auxiliary_tables.lead_oferta_* (una fila por lead, la última oferta; de ahí sale
 *    dia_oferta) se une con core_*.lead_offers_* por id de la oferta Y lead_id. En ARG hay ids de oferta repetidos
 *    entre leads distintos (2 casos en lead_offers_arg, mismo branch_id): unir solo por id duplicaba una fila.
 *  - monto_oferta = lead_offers_*.max_amount y monto_oferta_increased = lead_offers_*.max_amount_increased, de la
 *    misma fila. El increased solo tiene datos reales desde inicio_datos: si la oferta se creó antes (created_at, hora
 *    local, igual que Upgrade de oferta) queda NULL = celda vacía; desde esa fecha, nulo = 0.
 *  - telefono / email = core_*.customers_*.cellphone / email vía leads_*.customer_id, tal como están en origen.
 *    Son datos personales: no se cachean ni se loguean.
 */
const Q_NO_VENDIDOS = `${BASE_CTE},
export_leads AS (  -- universo del export: siguen sin comprar
  SELECT pais, lead_id, f_previa, dias
  FROM aging
  WHERE vendio_mes = 0
    AND vendio_despues = 0
    AND pais = $3::varchar
),
datos AS (         -- oferta del aging → lead_offers (id + lead_id); lead → customer. Solo los leads del export.
  SELECT 'ARG'::varchar(3) AS pais, lo.lead_id,
         o.max_amount AS monto_oferta,
         CASE WHEN o.id IS NOT NULL AND lo.created_at >= $4::date
              THEN COALESCE(o.max_amount_increased, 0) END AS monto_oferta_increased,
         c.cellphone AS telefono,
         c.email
  FROM auxiliary_tables.lead_oferta_arg lo
  LEFT JOIN core_arg.lead_offers_arg o ON o.id = lo.id AND o.lead_id = lo.lead_id
  LEFT JOIN core_arg.leads_arg       l ON l.id = lo.lead_id
  LEFT JOIN core_arg.customers_arg   c ON c.id = l.customer_id
  WHERE $3::varchar = 'ARG' AND lo.lead_id IN (SELECT lead_id FROM export_leads)
  UNION ALL
  SELECT 'COL'::varchar(3), lo.lead_id,
         o.max_amount,
         CASE WHEN o.id IS NOT NULL AND lo.created_at >= $4::date
              THEN COALESCE(o.max_amount_increased, 0) END,
         c.cellphone,
         c.email
  FROM auxiliary_tables.lead_oferta_col lo
  LEFT JOIN core_col.lead_offers_col o ON o.id = lo.id AND o.lead_id = lo.lead_id
  LEFT JOIN core_col.leads_col       l ON l.id = lo.lead_id
  LEFT JOIN core_col.customers_col   c ON c.id = l.customer_id
  WHERE $3::varchar = 'COL' AND lo.lead_id IN (SELECT lead_id FROM export_leads)
)
SELECT e.pais,
       e.lead_id,
       TO_CHAR(e.f_previa, 'YYYY-MM-DD') AS fecha_oferta,
       e.dias                            AS dias_aging,
       ${TRAMO_SQL} AS tramo_aging,
       d.monto_oferta,
       d.monto_oferta_increased,
       d.telefono,
       d.email
FROM export_leads e
LEFT JOIN datos d ON d.pais = e.pais AND d.lead_id = e.lead_id
ORDER BY e.dias, e.lead_id
LIMIT ${MAX_FILAS_EXPORT + 1}`;

/** Cantidad de no vendidos del mes que compraron después del cierre ($3 = país): se excluyen del export. Solo conteo. */
const Q_EXCLUIDOS_VENTA_POSTERIOR = `${BASE_CTE}
SELECT COUNT(*) AS excluidos
FROM aging
WHERE vendio_mes = 0
  AND vendio_despues = 1
  AND pais = $3::varchar
LIMIT 1`;

// ── Meses ───────────────────────────────────────────────────────────────────────
const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' + n meses. */
export function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Primer y último día del mes, 'YYYY-MM-DD'. */
export function rangoMes(mes: string): { ini: string; fin: string } {
  const [y, m] = mes.split('-').map(Number);
  return { ini: `${mes}-01`, fin: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

/** Último mes cerrado: el anterior al mes en curso según el "hoy" local más temprano entre ARG y COL. */
export function ultimoMesCerrado(ahora: Date = new Date()): string {
  const hoy = [hoyEn(TZ.ARG, ahora), hoyEn(TZ.COL, ahora)].sort()[0];
  return sumarMeses(hoy.slice(0, 7), -1);
}

/** Meses del selector, del más reciente a MES_INICIO. */
export function mesesDisponibles(ultimo: string): string[] {
  const out: string[] = [];
  for (let m = ultimo; m >= MES_INICIO; m = sumarMeses(m, -1)) out.push(m);
  return out;
}

/** Valida 'YYYY-MM' dentro de [MES_INICIO, último cerrado]. Vacío = último mes cerrado. */
export function parseMes(raw: unknown, ultimo: string): string {
  if (raw === undefined || raw === null || raw === '') return ultimo;
  const mes = String(raw);
  if (!RE_MES.test(mes)) throw new ParamError(`mes no es válido (YYYY-MM): "${mes}"`);
  if (mes < MES_INICIO || mes > ultimo) {
    throw new ParamError(`mes fuera de rango: debe estar entre ${MES_INICIO} y ${ultimo} (solo meses cerrados)`);
  }
  return mes;
}

export function parsePais(raw: unknown): PaisAging {
  const pais = String(raw ?? '').toUpperCase();
  if (pais !== 'ARG' && pais !== 'COL') throw new ParamError(`pais debe ser ARG o COL: "${String(raw ?? '')}"`);
  return pais;
}

// ── Resultado ───────────────────────────────────────────────────────────────────
export interface FilaAging {
  pais: PaisAging;
  tramo: TramoAging;
  ofertas_vivas: number;
  ventas_mes: number;
  con_oferta_posterior: number; // ventas con la oferta registrada después de la venta (≤ 7 días), contadas con aging 0
  vendio_despues: number;       // no vendieron en el mes pero sí después del cierre
}

export interface ConciliacionPais {
  ventas_vista: number;
  ventas_tabla_oficial: number;
  ventas_sin_oferta: number;
}

export interface ResultadoAgingOfertas {
  mes: string;     // 'YYYY-MM'
  mes_ini: string; // 'YYYY-MM-DD'
  mes_fin: string;
  filas: FilaAging[];
  conciliacion: Record<PaisAging, ConciliacionPais>;
}

export interface FilaNoVendido {
  pais: PaisAging;
  lead_id: number;
  fecha_oferta: string; // 'YYYY-MM-DD'
  dias_aging: number;
  tramo_aging: TramoAging;
  monto_oferta: number | null;           // lead_offers_*.max_amount
  monto_oferta_increased: number | null; // null = oferta anterior a inicio_datos (celda vacía); nulo en origen = 0
  telefono: string | null;               // customers_*.cellphone, tal como está en origen (texto, sin limpiar)
  email: string | null;                  // customers_*.email, tal como está en origen
}

export interface ResultadoNoVendidos {
  filas: FilaNoVendido[];
  excluidos_venta_posterior: number; // vendieron después del cierre: fuera del archivo, solo se informa el conteo
}

const num = (v: unknown) => (v == null ? 0 : Number(v)); // bigint/numeric llegan como string
const numONull = (v: unknown) => (v == null ? null : Number(v));
const textoONull = (v: unknown) => (v == null ? null : String(v)); // nunca Number: no perder ceros ni '+'

/** Ejecuta fn dentro de una transacción READ ONLY con statement_timeout; siempre ROLLBACK. */
async function enSoloLectura<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout TO ${STATEMENT_TIMEOUT_MS}`); // constante numérica, no input
    await client.query('BEGIN READ ONLY');
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('RESET statement_timeout').catch(() => {});
    client.release();
  }
}

export async function runAgingOfertas(pool: Pool, mes: string): Promise<ResultadoAgingOfertas> {
  const { ini, fin } = rangoMes(mes);
  return enSoloLectura(pool, async c => {
    const agg = await c.query(Q_AGREGADO, [ini, fin]);
    const conc = await c.query(Q_CONCILIACION, [ini, fin]);

    const filas: FilaAging[] = agg.rows.map((r: any) => ({
      pais: String(r.pais) as PaisAging,
      tramo: String(r.tramo) as TramoAging,
      ofertas_vivas: num(r.ofertas_vivas),
      ventas_mes: num(r.ventas_mes),
      con_oferta_posterior: num(r.con_oferta_posterior),
      vendio_despues: num(r.vendio_despues),
    }));

    const conciliacion = {} as Record<PaisAging, ConciliacionPais>;
    for (const p of PAISES_AGING) {
      const r: any = conc.rows.find((x: any) => x.pais === p);
      conciliacion[p] = {
        ventas_vista: num(r?.ventas_vista),
        ventas_tabla_oficial: num(r?.ventas_tabla_oficial),
        ventas_sin_oferta: num(r?.ventas_sin_oferta),
      };
    }
    return { mes, mes_ini: ini, mes_fin: fin, filas, conciliacion };
  });
}

/**
 * No vendidos del mes y país que siguen sin comprar, para el export, más el conteo de excluidos por venta posterior.
 * Las dos queries corren en la misma transacción READ ONLY. Datos a nivel lead con teléfono y email (datos
 * personales): no se cachean ni se loguean.
 */
export async function runNoVendidos(pool: Pool, mes: string, pais: PaisAging): Promise<ResultadoNoVendidos> {
  const { ini, fin } = rangoMes(mes);
  const { rows, excluidos } = await enSoloLectura(pool, async c => {
    const filas = await c.query(Q_NO_VENDIDOS, [ini, fin, pais, PAISES[pais].inicio_datos]);
    const exc = await c.query(Q_EXCLUIDOS_VENTA_POSTERIOR, [ini, fin, pais]);
    return { rows: filas.rows, excluidos: num(exc.rows[0]?.excluidos) };
  });
  if (rows.length > MAX_FILAS_EXPORT) {
    throw new Error(`El export supera ${MAX_FILAS_EXPORT.toLocaleString('es-AR')} filas; no se genera un archivo incompleto`);
  }
  return {
    filas: rows.map((r: any) => ({
      pais: String(r.pais) as PaisAging,
      lead_id: Number(r.lead_id),
      fecha_oferta: String(r.fecha_oferta),
      dias_aging: num(r.dias_aging),
      tramo_aging: String(r.tramo_aging) as TramoAging,
      monto_oferta: numONull(r.monto_oferta),
      monto_oferta_increased: numONull(r.monto_oferta_increased),
      telefono: textoONull(r.telefono),
      email: textoONull(r.email),
    })),
    excluidos_venta_posterior: excluidos,
  };
}
