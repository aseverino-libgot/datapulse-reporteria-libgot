// src/components/submodules/CallcenterUpgradeOfertaSubmodule.tsx
// Callcenter › Upgrade de oferta. Spec: docs/superpowers/specs/2026-11-25-callcenter-upgrade-ofertas.md
// Se piden los agregados una sola vez (inicio de datos → D-1, ambos países); país, rango y "tuvo upgrade disponible"
// se filtran en el cliente. Un país a la vez: los montos de ARG (ARS) y COL (COP) no se suman.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Loader2, AlertCircle, RefreshCcw, Info } from 'lucide-react';
import { Chart, registerables } from 'chart.js';
import DualScroll from '../ui/DualScroll';
import PageLoader from '../PageLoader';
import { fetchUpgradeOferta, refreshUpgradeOferta, type UpgradeOfertaResponse } from '../../services/api';
import {
  PAISES, NOMBRE_PAIS, COLOR_PAIS, SEGMENTOS_POR_FILTRO,
  filtrarFilas, totales, agruparPorPeriodo, serieDiaria,
  sumarDias, primerDiaDelMes, maxFecha, minFecha,
  tasa, fmtNum, fmtPct, fmtMonto, fmtFecha, fmtDiaCorto, fmtMes,
  type Pais, type FiltroUpgrade, type FilaUpgrade, type Filtros, type Totales, type SeleccionDetalle,
} from './upgradeOfertaHelpers';

Chart.register(...registerables);

interface Props {
  /** Segunda etapa (detalle de créditos). En la v1 no se pasa y nada es clickeable. */
  onSelectDetalle?: (sel: SeleccionDetalle) => void;
}

/** Hora de la primera oferta con upgrade en ARG el día de inicio (spec: día parcial). */
const NOTA_INICIO: Partial<Record<Pais, string>> = { ARG: 'ese día, desde las 14:12' };

export default function CallcenterUpgradeOfertaSubmodule({ onSelectDetalle }: Props) {
  const [datos, setDatos] = useState<UpgradeOfertaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pais, setPais] = useState<Pais>('ARG');
  const [upgrade, setUpgrade] = useState<FiltroUpgrade>('todas');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const aplicarDatos = (d: UpgradeOfertaResponse, conservarRango: boolean) => {
    setDatos(d);
    if (!conservarRango || !desde || !hasta) {
      setDesde(d.desde);
      setHasta(d.hasta);
    }
  };

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError(null);
    fetchUpgradeOferta()
      .then(d => { if (!cancelado) aplicarDatos(d, false); })
      .catch((err: any) => { if (!cancelado) setError(err.message || 'Error al cargar el upgrade de oferta'); })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      aplicarDatos(await refreshUpgradeOferta(), true);
    } catch (err: any) {
      setError(err.message || 'Error al refrescar');
    } finally {
      setRefreshing(false);
    }
  };

  // Rango efectivo: el elegido, recortado a [inicio de datos, corte D-1] del país seleccionado.
  const infoPais = datos?.paises[pais];
  const minPais = infoPais?.inicio_datos ?? '';
  const maxPais = infoPais?.corte ?? '';
  const desdeEf = datos ? minFecha(maxFecha(desde, minPais), maxPais) : '';
  const hastaEf = datos ? maxFecha(minFecha(hasta, maxPais), desdeEf) : '';

  const filas: FilaUpgrade[] = datos?.filas ?? [];
  const filtros: Filtros = { pais, upgrade, desde: desdeEf, hasta: hastaEf };

  const filasRango = useMemo(() => filtrarFilas(filas, filtros), [filas, pais, upgrade, desdeEf, hastaEf]); // eslint-disable-line react-hooks/exhaustive-deps
  const filasTodoElPeriodo = useMemo(() => filtrarFilas(filas, filtros, { ignorarFechas: true }), [filas, pais, upgrade]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = useMemo(() => totales(filasRango), [filasRango]);
  const diario = useMemo(() => agruparPorPeriodo(filasRango, 'dia'), [filasRango]);
  const mensual = useMemo(() => agruparPorPeriodo(filasTodoElPeriodo, 'mes'), [filasTodoElPeriodo]);
  const serieDisp = useMemo(() => serieDiaria(filasRango, desdeEf, hastaEf, x => x.disponibles), [filasRango, desdeEf, hastaEf]);
  const serieTom = useMemo(() => serieDiaria(filasRango, desdeEf, hastaEf, x => x.tomados), [filasRango, desdeEf, hastaEf]);

  if (loading && !datos) return <PageLoader message="Cargando upgrade de oferta..." />;

  const mesEnCurso = maxPais.slice(0, 7);
  const segs = SEGMENTOS_POR_FILTRO[upgrade];
  const clickable = !!onSelectDetalle;
  const seleccionar = (sel: Partial<SeleccionDetalle>) =>
    onSelectDetalle?.({ pais, desde: desdeEf, hasta: hastaEf, segmentos: segs, ...sel });

  const presets: { label: string; desde: string }[] = datos ? [
    { label: 'Todo', desde: minPais },
    { label: 'Mes en curso', desde: maxFecha(primerDiaDelMes(maxPais), minPais) },
    { label: 'Últimos 7 días', desde: maxFecha(sumarDias(maxPais, -6), minPais) },
  ] : [];

  const iniProm = tasa(t.topeInicialTomado, t.tomadosConTope);
  const ajProm = tasa(t.topeAjustadoTomado, t.tomadosConTope);

  return (
    <div className="flex-1 flex flex-col p-6 gap-5 overflow-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="text-lg font-bold text-white">Callcenter › Upgrade de oferta</h2>
        <p className="text-zinc-500 text-sm mt-0.5">
          ¿Se usa el upgrade de oferta? Ofertas con upgrade disponible, cuántas lo tomaron y el impacto sobre el tope (motor → monto ajustado). Por fecha de creación de la oferta, a día vencido.
        </p>
      </motion.div>

      {/* Filtros */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}
        className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">País</span>
          <select value={pais} onChange={e => setPais(e.target.value as Pais)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500">
            {PAISES.map(p => <option key={p} value={p}>{NOMBRE_PAIS[p]}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider"
            title="Sí: ofertas con upgrade disponible, lo hayan tomado o no. No: ofertas sin upgrade.">Tuvo upgrade disponible</span>
          <div className="flex rounded-lg border border-slate-700 overflow-hidden">
            {([['todas', 'Todas'], ['si', 'Sí'], ['no', 'No']] as [FiltroUpgrade, string][]).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setUpgrade(v)}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${upgrade === v ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-zinc-400 hover:bg-slate-700'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {datos && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Fecha de la oferta</span>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={desdeEf} min={minPais} max={hastaEf}
                onChange={e => e.target.value && setDesde(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 [color-scheme:dark]" />
              <span className="text-zinc-600 text-xs">a</span>
              <input type="date" value={hastaEf} min={desdeEf} max={maxPais}
                onChange={e => e.target.value && setHasta(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 [color-scheme:dark]" />
              <div className="flex rounded-lg border border-slate-700 overflow-hidden">
                {presets.map(p => {
                  const activo = desdeEf === p.desde && hastaEf === maxPais;
                  return (
                    <button key={p.label} type="button" onClick={() => { setDesde(p.desde); setHasta(maxPais); }}
                      className={`px-2.5 py-1.5 text-[11px] font-bold transition-colors ${activo ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-zinc-400 hover:bg-slate-700'}`}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {datos && (
            <span className="text-[11px] text-zinc-500" title={`Consultado al DWH: ${new Date(datos.cached_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`}>
              Datos al <span className="text-zinc-300 font-semibold">{fmtFecha(maxPais)}</span> (D-1)
            </span>
          )}
          <button onClick={handleRefresh} disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-zinc-300 rounded-lg text-xs font-bold transition-colors disabled:opacity-50">
            {refreshing || loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
            Refrescar
          </button>
        </div>
      </motion.div>

      {error && (
        <div className="flex items-center gap-2 text-rose-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {datos && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-sky-800/60 bg-sky-950/30 text-[12px] text-sky-200">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-400" />
          <div className="flex flex-col gap-0.5">
            <span>
              Datos de upgrade de <b>{NOMBRE_PAIS[pais]}</b> desde el {fmtFecha(minPais)}
              {NOTA_INICIO[pais] && <span className="text-sky-300/80"> ({NOTA_INICIO[pais]})</span>}; antes de esa fecha no se muestran datos.
              Montos en {pais === 'ARG' ? 'pesos argentinos (ARS)' : 'pesos colombianos (COP)'}.
            </span>
            <span>
              Los tomados de los días más recientes pueden seguir creciendo: el cliente puede tomar el upgrade después de que se creó la oferta.
            </span>
          </div>
        </div>
      )}

      {datos && filasRango.length === 0 ? (
        <div className="text-zinc-500 text-sm text-center py-12">Sin datos para estos filtros.</div>
      ) : datos && (
        <>
          {/* Tarjetas */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Tarjeta titulo="Ofertas" valor={fmtNum(t.ofertas)}
              onClick={clickable ? () => seleccionar({}) : undefined} />
            <Tarjeta titulo="Ventas" valor={fmtNum(t.ventas)} sub={`${fmtPct(tasa(t.ventas, t.ofertas))} de las ofertas`} />
            <Tarjeta titulo="Ticket promedio" valor={fmtMonto(tasa(t.montoVendido, t.ventas), pais)}
              sub={`Monto vendido ${fmtMonto(t.montoVendido, pais)}`} />
            <Tarjeta titulo="Ofertas con upgrade disponible" valor={fmtNum(t.disponibles)}
              sub={`${fmtPct(tasa(t.disponibles, t.ofertas))} de las ofertas`}
              onClick={clickable ? () => seleccionar({ segmentos: segs.filter(s => s !== 'sin_upgrade') }) : undefined} />
            <Tarjeta titulo="Upgrades tomados" valor={fmtNum(t.tomados)} destacado
              sub={t.disponiblesSinMotor > 0
                ? `${fmtNum(t.disponiblesSinMotor)} ofertas con upgrade sin dato del motor: solo se evalúa completo`
                : undefined}
              onClick={clickable ? () => seleccionar({ segmentos: segs.filter(s => s === 'tomado_completo' || s === 'tomado_parcial') }) : undefined}>
              <span className="text-xs text-zinc-300 tabular-nums">
                Completos <b className="text-white">{fmtNum(t.completos)}</b> · Parciales <b className="text-white">{fmtNum(t.parciales)}</b>
              </span>
            </Tarjeta>
            <Tarjeta titulo="% de uso del upgrade" valor={fmtPct(tasa(t.tomados, t.disponibles))} destacado
              sub={`${fmtNum(t.tomados)} tomados de ${fmtNum(t.disponibles)} disponibles`} />
            <Tarjeta titulo="Ventas con upgrade tomado" valor={fmtNum(t.ventasTomado)}
              sub={`${fmtPct(tasa(t.ventasTomado, t.tomados))} de los tomados · ${fmtMonto(t.montoVendidoTomado, pais)}`} />
            <Tarjeta titulo="Tope inicial → ajustado (tomados, promedio)"
              sub={t.tomados > t.tomadosConTope
                ? `${fmtNum(t.tomados - t.tomadosConTope)} tomados sin dato del motor (excluidos)`
                : 'Inicial: motor · ajustado: oferta actual · completos y parciales'}>
              {iniProm === null || ajProm === null ? <span className="text-sm text-zinc-500">—</span> : (
                <span className="text-sm font-bold text-white tabular-nums whitespace-nowrap">
                  {fmtMonto(iniProm, pais)} → {fmtMonto(ajProm, pais)}{' '}
                  <span className="text-emerald-400 text-xs">(+{fmtPct(tasa(ajProm - iniProm, iniProm))})</span>
                </span>
              )}
            </Tarjeta>
          </motion.div>

          {/* Evolución diaria: dos gráficos con su propio eje (escalas muy distintas, sin doble eje) */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
            className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <GraficoDiario titulo="Ofertas con upgrade disponible, por día" fechas={serieDisp.fechas}
              valores={serieDisp.valores} color={COLOR_PAIS[pais]} />
            <GraficoDiario titulo="Upgrades tomados (completos + parciales), por día" fechas={serieTom.fechas}
              valores={serieTom.valores} color={COLOR_PAIS[pais]} />
          </motion.div>
          {upgrade === 'no' && (
            <p className="text-[11px] text-zinc-500 -mt-2">Con "Tuvo upgrade disponible: No" los gráficos quedan en cero: el filtro excluye las ofertas con upgrade.</p>
          )}

          {/* Vista mensual (todo el período disponible; el mes en curso es el acumulado al D-1) */}
          <Tabla titulo="Vista mensual" nota={`Todo el período disponible (no aplica el rango de fechas). ${fmtMes(mesEnCurso)}: acumulado del mes en curso al ${fmtFecha(maxPais)}.`}
            columnas={['Mes', 'Ofertas', 'Ventas', 'Ticket prom.', 'Monto vendido', 'Con upgrade', '% con upgrade', 'Tomados (C + P)', '% uso', 'Ventas c/ tomado']}>
            {mensual.map(g => (
              <tr key={g.clave} className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${g.clave === mesEnCurso ? 'bg-indigo-950/30' : ''}`}>
                <Td izq>
                  {fmtMes(g.clave)}
                  {g.clave === mesEnCurso && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300">en curso</span>}
                </Td>
                <Td>{fmtNum(g.t.ofertas)}</Td>
                <Td>{fmtNum(g.t.ventas)}</Td>
                <Td>{fmtMonto(tasa(g.t.montoVendido, g.t.ventas), pais)}</Td>
                <Td>{fmtMonto(g.t.montoVendido, pais)}</Td>
                <Td>{fmtNum(g.t.disponibles)}</Td>
                <Td>{fmtPct(tasa(g.t.disponibles, g.t.ofertas))}</Td>
                <Td><Tomados t={g.t} /></Td>
                <Td fuerte>{fmtPct(tasa(g.t.tomados, g.t.disponibles))}</Td>
                <Td>{fmtNum(g.t.ventasTomado)}</Td>
              </tr>
            ))}
          </Tabla>

          {/* Tabla diaria */}
          <Tabla titulo={`Detalle diario · ${NOMBRE_PAIS[pais]}`} nota={`${fmtFecha(desdeEf)} a ${fmtFecha(hastaEf)}. Topes: promedio de los upgrades tomados, completos y parciales (motor → oferta actual).`}
            columnas={['Fecha', 'Ofertas', 'Ventas', 'Ticket prom.', 'Con upgrade', 'Tomados (C + P)', '% uso', 'Ventas c/ tomado', 'Tope inicial', 'Tope ajustado']}>
            {diario.map(g => (
              <tr key={g.clave}
                onClick={clickable ? () => seleccionar({ desde: g.clave, hasta: g.clave }) : undefined}
                className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${clickable ? 'cursor-pointer' : ''}`}>
                <Td izq>{fmtFecha(g.clave)}</Td>
                <Td>{fmtNum(g.t.ofertas)}</Td>
                <Td>{fmtNum(g.t.ventas)}</Td>
                <Td>{fmtMonto(tasa(g.t.montoVendido, g.t.ventas), pais)}</Td>
                <Td>{fmtNum(g.t.disponibles)}</Td>
                <Td><Tomados t={g.t} /></Td>
                <Td fuerte>{fmtPct(tasa(g.t.tomados, g.t.disponibles))}</Td>
                <Td>{fmtNum(g.t.ventasTomado)}</Td>
                <Td>{fmtMonto(tasa(g.t.topeInicialTomado, g.t.tomadosConTope), pais)}</Td>
                <Td>{fmtMonto(tasa(g.t.topeAjustadoTomado, g.t.tomadosConTope), pais)}</Td>
              </tr>
            ))}
          </Tabla>

          <p className="text-[11px] text-zinc-600 leading-relaxed">
            Oferta: una por lead, por fecha de creación (hora local). Venta: crédito en estado 20/39 (ARG) o 22/24 (COL); monto amount (ARG) / total_amount (COL).
            Upgrade disponible: la oferta tiene monto aumentado (incluye los tomados). Tomado completo: el monto de la oferta subió hasta el aumentado;
            tomado parcial: subió por encima del tope del motor sin llegar al aumentado (sin dato del motor solo se evalúa completo).
            % de uso = tomados / disponibles. Tope inicial: monto máximo ofertado por el motor; ajustado: monto máximo actual de la oferta.
            Ticket promedio = Σ monto vendido / Σ ventas.
          </p>
        </>
      )}
    </div>
  );
}

// ── Componentes internos ────────────────────────────────────────────────────────
function Tarjeta({ titulo, valor, sub, destacado, onClick, children }: {
  titulo: string; valor?: string; sub?: string; destacado?: boolean; onClick?: () => void; children?: ReactNode;
}) {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick}
      className={`text-left flex flex-col gap-1.5 p-4 rounded-xl border ${destacado ? 'bg-indigo-950/30 border-indigo-800/50' : 'bg-slate-900 border-slate-800'} ${onClick ? 'hover:border-indigo-500 transition-colors' : ''}`}>
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{titulo}</span>
      {valor !== undefined && <span className="text-2xl font-bold text-white tabular-nums">{valor}</span>}
      {children && <div className="flex flex-col gap-1">{children}</div>}
      {sub && <span className="text-[11px] text-zinc-500">{sub}</span>}
    </Comp>
  );
}

/** Celda "Tomados": total y desglose completos + parciales en gris. */
function Tomados({ t }: { t: Totales }) {
  return (
    <>
      {fmtNum(t.tomados)}
      {t.tomados > 0 && <span className="text-zinc-500"> · {fmtNum(t.completos)} + {fmtNum(t.parciales)}</span>}
    </>
  );
}

function Tabla({ titulo, nota, columnas, children }: { titulo: string; nota?: string; columnas: string[]; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
      className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-800">
        <h3 className="text-sm font-bold text-white">{titulo}</h3>
        {nota && <p className="text-[11px] text-zinc-500 mt-0.5">{nota}</p>}
      </div>
      <DualScroll maxHeight="60vh">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr className="border-b border-slate-800">
              {columnas.map((h, i) => (
                <th key={h} className={`px-3 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </DualScroll>
    </motion.div>
  );
}

function Td({ children, izq, fuerte }: { children: ReactNode; izq?: boolean; fuerte?: boolean }) {
  return (
    <td className={`px-3 py-2.5 text-xs whitespace-nowrap tabular-nums ${izq ? 'text-left' : 'text-right'} ${fuerte ? 'font-bold text-white' : 'text-zinc-300'}`}>
      {children}
    </td>
  );
}

/** Barras diarias de una sola serie (un país), un solo eje. Sin leyenda: el título nombra la serie. */
function GraficoDiario({ titulo, fechas, valores, color }: {
  titulo: string; fechas: string[]; valores: number[]; color: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inst = useRef<Chart | null>(null);

  useEffect(() => {
    inst.current?.destroy();
    if (!ref.current || fechas.length === 0) return;
    inst.current = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: fechas.map(fmtDiaCorto),
        datasets: [{
          label: titulo,
          data: valores,
          backgroundColor: color,
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'bottom' as const,
          maxBarThickness: 18,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => fmtFecha(fechas[items[0].dataIndex]),
              label: ctx => ` ${fmtNum(ctx.parsed.y ?? 0)}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#6b7280', font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#6b7280', font: { size: 10 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
    });
    return () => { inst.current?.destroy(); };
  }, [fechas, valores, color, titulo]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-sm font-bold text-white mb-2">{titulo}</h3>
      <div className="h-64"><canvas ref={ref} role="img" aria-label={titulo} /></div>
    </div>
  );
}
