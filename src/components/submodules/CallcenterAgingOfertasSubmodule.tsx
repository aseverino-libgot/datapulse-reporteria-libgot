// src/components/submodules/CallcenterAgingOfertasSubmodule.tsx
// Callcenter › Aging de ofertas. Spec: docs/superpowers/specs/2026-11-26-tablero-aging-renovadores.md
// Conversión de renovadores por aging de la oferta en un mes cerrado, un país a la vez.
// Indicador principal: subtotal hasta 180 días (el +180 se muestra aparte para no diluir la tasa con stock muerto).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Loader2, AlertCircle, RefreshCcw, Info, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import PageLoader from '../PageLoader';
import { fetchAgingOfertas, refreshAgingOfertas, fetchAgingNoVendidos, type AgingOfertasResponse } from '../../services/api';
import {
  PAISES, NOMBRE_PAIS, COLUMNAS_EXPORT, INICIO_UPGRADE,
  armarTabla, revisarControles, revisarExport, nombreArchivoExport,
  fmtNum, fmtPct, fmtMesLargo, fmtFechaHora, fmtFecha, tasa,
  type Pais, type FilaAging, type FilaTabla, type FilaNoVendido,
} from './agingOfertasHelpers';

interface ResultadoExport {
  filas: number;       // solo la cantidad: el arreglo de filas (con teléfono y email) nunca se guarda en el estado
  excluidos: number;   // compraron después del cierre: fuera del archivo (dato del export)
  problemas: string[]; // la regla no cierra: filas + excluidos ≠ ofertas vivas − ventas (ámbar)
  avisos: string[];    // excluidos ≠ tablero: venta nueva o caché (informativo)
}

export default function CallcenterAgingOfertasSubmodule() {
  const [datos, setDatos] = useState<AgingOfertasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pais, setPais] = useState<Pais>('ARG');
  const [mes, setMes] = useState(''); // '' = el servidor elige el último mes cerrado

  const [exportando, setExportando] = useState(false);
  const [resultadoExport, setResultadoExport] = useState<ResultadoExport | null>(null);

  // Carga inicial y cambio de mes. Al llegar la primera respuesta se fija `mes` y no se vuelve a pedir.
  useEffect(() => {
    if (datos && datos.mes === mes) return;
    let cancelado = false;
    setLoading(true);
    setError(null);
    setResultadoExport(null);
    fetchAgingOfertas(mes || undefined)
      .then(d => { if (!cancelado) { setDatos(d); setMes(d.mes); } })
      .catch((err: any) => { if (!cancelado) setError(err.message || 'Error al cargar el aging de ofertas'); })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [mes]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    if (!datos) return;
    setRefreshing(true);
    setError(null);
    setResultadoExport(null);
    try {
      setDatos(await refreshAgingOfertas(datos.mes));
    } catch (err: any) {
      setError(err.message || 'Error al refrescar');
    } finally {
      setRefreshing(false);
    }
  };

  const filas: FilaAging[] = (datos?.filas ?? []) as FilaAging[];
  const tabla = useMemo(() => armarTabla(filas, pais), [filas, pais]);
  const problemas = useMemo(() => revisarControles(datos?.conciliacion[pais], tabla), [datos, pais, tabla]);

  const handleExport = async () => {
    if (!datos) return;
    setExportando(true);
    setError(null);
    setResultadoExport(null);
    try {
      const r = await fetchAgingNoVendidos(datos.mes, pais);
      // Las filas (datos personales) viven solo dentro de esta función: se escriben al Excel y se descartan.
      const filasExport = r.filas as FilaNoVendido[];
      const ws = XLSX.utils.json_to_sheet(filasExport, { header: COLUMNAS_EXPORT as string[] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `No vendidos ${pais}`);
      XLSX.writeFile(wb, nombreArchivoExport(pais, datos.mes));
      const excluidos = r.excluidos_venta_posterior;
      setResultadoExport({ filas: filasExport.length, excluidos, ...revisarExport(filasExport, excluidos, tabla) });
    } catch (err: any) {
      setError(err.message || 'Error al generar el export');
    } finally {
      setExportando(false);
    }
  };

  if (loading && !datos) return <PageLoader message="Cargando aging de ofertas..." />;

  const cambiandoMes = loading && !!datos;
  const mesLargo = datos ? fmtMesLargo(datos.mes) : '';
  // Antes de exportar, el dato del tablero; después, el que devolvió el export (más reciente).
  const excluidos = resultadoExport?.excluidos ?? tabla.vendioDespues;

  return (
    <div className="flex-1 flex flex-col p-6 gap-5 overflow-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="text-lg font-bold text-white">Callcenter › Aging de ofertas</h2>
        <p className="text-zinc-500 text-sm mt-0.5">
          De las ofertas de renovación vivas en el mes, cuántas convirtieron según la antigüedad de la oferta y cuánto pesa cada tramo en las ventas del mes.
        </p>
      </motion.div>

      {/* Filtros */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}
        className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">País</span>
          <div className="flex rounded-lg border border-slate-700 overflow-hidden">
            {PAISES.map(p => (
              <button key={p} type="button" onClick={() => { setPais(p); setResultadoExport(null); }}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${pais === p ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-zinc-400 hover:bg-slate-700'}`}>
                {NOMBRE_PAIS[p]}
              </button>
            ))}
          </div>
        </div>

        {datos && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Mes (cerrado)</span>
            <select value={mes} onChange={e => setMes(e.target.value)} disabled={loading || refreshing}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50">
              {datos.meses_disponibles.map(m => (
                <option key={m} value={m}>{fmtMesLargo(m)}{m === datos.ultimo_mes_cerrado ? ' (último cerrado)' : ''}</option>
              ))}
            </select>
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {datos && (
            <span className="text-[11px] text-zinc-500">
              Consultado el <span className="text-zinc-300 font-semibold">{fmtFechaHora(datos.cached_at)}</span>
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
        <div className={`flex flex-col gap-5 transition-opacity ${cambiandoMes ? 'opacity-50 pointer-events-none' : ''}`}>
          {/* Notas */}
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-sky-800/60 bg-sky-950/30 text-[12px] text-sky-200">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-400" />
            <div className="flex flex-col gap-0.5">
              <span>
                Los datos reflejan el estado actual de la vista al momento de la consulta: los números de un mes cerrado pueden
                actualizarse si se registran ventas con fecha dentro de ese mes. Solo se muestran meses cerrados.
              </span>
              {tabla.conOfertaPosterior > 0 && (
                <span>
                  Incluye <b>{fmtNum(tabla.conOfertaPosterior)}</b> ventas con oferta registrada después del desembolso (hasta 7 días), contadas en 0-30.
                </span>
              )}
            </div>
          </div>

          {/* Controles de conciliación */}
          {problemas.length > 0 ? (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-rose-800/60 bg-rose-950/30 text-[12px] text-rose-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <div className="flex flex-col gap-0.5">
                <span className="font-bold">Los controles no cierran para {NOMBRE_PAIS[pais]} · {mesLargo}:</span>
                {problemas.map(p => <span key={p}>{p}</span>)}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Conciliado con la tabla oficial de ventas: {fmtNum(tabla.total.ventas)} ventas de renovación en {mesLargo}, todas con oferta registrada.
            </div>
          )}

          {/* Tarjetas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Tarjeta titulo="Conversión hasta 180 días" valor={fmtPct(tabla.subtotal.conversion)} destacado
              sub={`${fmtNum(tabla.subtotal.ventas)} ventas de ${fmtNum(tabla.subtotal.ofertas)} ofertas vivas`} />
            <Tarjeta titulo={`Ventas de ${mesLargo}`} valor={fmtNum(tabla.total.ventas)}
              sub={`${fmtPct(tasa(tabla.subtotal.ventas, tabla.total.ventas))} en ofertas de hasta 180 días`} />
            <Tarjeta titulo="Conversión total (incluye +180)" valor={fmtPct(tabla.total.conversion)}
              sub={`${fmtNum(tabla.total.ofertas)} ofertas vivas, ${fmtNum(tabla.mas180.ofertas)} de más de 180 días`} />
          </div>

          {/* Tabla por tramo */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white">Conversión por aging de la oferta · {NOMBRE_PAIS[pais]} · {mesLargo}</h3>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Indicador principal: subtotal hasta 180 días. Las ofertas de más de 180 días se muestran aparte porque casi no convierten y diluyen la tasa.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-slate-800">
                    {['Aging de la oferta', 'Ofertas vivas', `Ventas ${mesLargo}`, 'Conversión', 'Peso en las ventas'].map((h, i) => (
                      <th key={h} className={`px-3 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabla.tramos.map(f => <FilaTramo key={f.clave} f={f} />)}
                  <FilaTramo f={tabla.subtotal} />
                  <FilaTramo f={tabla.mas180} />
                  <FilaTramo f={tabla.total} />
                  {tabla.control && <FilaTramo f={tabla.control} />}
                </tbody>
              </table>
            </div>
          </div>

          {/* Export */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-col gap-0.5 flex-1 min-w-[260px]">
                <h3 className="text-sm font-bold text-white">Renovadores no vendidos · {NOMBRE_PAIS[pais]} · {mesLargo}</h3>
                <p className="text-[11px] text-zinc-500">
                  Renovadores con oferta viva en el mes que no compraron en el mes ni después del cierre: hoy siguen sin
                  comprar ({fmtNum(tabla.aExportar)}). Base a nivel lead con monto de la oferta, monto increased, teléfono
                  y email del cliente. Contiene datos personales: manejalo con cuidado.
                </p>
                <p className="text-[11px] text-zinc-500">
                  Monto increased vacío: la oferta se creó antes del inicio del upgrade
                  ({NOMBRE_PAIS[pais]}: {fmtFecha(INICIO_UPGRADE[pais])}), cuando todavía no había datos reales.
                  Desde esa fecha, 0 = la oferta no tuvo upgrade.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <button onClick={handleExport} disabled={exportando || loading || refreshing || tabla.aExportar === 0}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50">
                  {exportando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Exportar a Excel
                </button>
                <span className="text-[11px] text-zinc-500">
                  {excluidos === 1
                    ? 'Se excluyó 1 renovador que compró después del cierre'
                    : `Se excluyeron ${fmtNum(excluidos)} renovadores que compraron después del cierre`}
                </span>
              </div>
            </div>
            {resultadoExport && (
              <div className="flex flex-col gap-1.5">
                {resultadoExport.problemas.length === 0 && (
                  <div className="flex items-center gap-2 text-[12px] text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    Archivo generado: {fmtNum(resultadoExport.filas)} filas.{resultadoExport.avisos.length === 0 && ' Coincide con el tablero.'}
                  </div>
                )}
                {resultadoExport.avisos.length > 0 && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-sky-800/60 bg-sky-950/30 text-[12px] text-sky-200">
                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-400" />
                    <div className="flex flex-col gap-0.5">
                      {resultadoExport.avisos.map(a => <span key={a}>{a}</span>)}
                    </div>
                  </div>
                )}
                {resultadoExport.problemas.length > 0 && (
                  <div className="flex items-start gap-2 text-[12px] text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-0.5">
                      {resultadoExport.problemas.map(p => <span key={p}>{p}</span>)}
                      <span className="text-amber-300/80">Puede deberse a que la vista se actualizó después de la consulta: refrescá el tablero y volvé a exportar.</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <p className="text-[11px] text-zinc-600 leading-relaxed">
            Fuente: gold.vw_vendedores_ventas, renovadores, un registro por lead. Oferta viva en el mes: oferta creada hasta el último día del mes
            y sin compra antes del primer día. Aging: días entre la última oferta y la fecha de corte (fecha de venta si vendió en el mes; si no,
            fin de mes). Conversión = ventas del mes / ofertas vivas del tramo. Peso = ventas del tramo / ventas del mes del país (incluye +180).
            El aging se cuenta desde el día comercial de la oferta: las ofertas generadas fuera de horario se cuentan al siguiente día hábil.
            Un lead que vende después del cierre sigue contando como oferta viva no convertida de este mes. No es comparable con Directorio ›
            Conversión de renovadores, que mide el paso de crédito n a n+1 con ventanas desde la primera oferta.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Componentes internos ────────────────────────────────────────────────────────
function Tarjeta({ titulo, valor, sub, destacado }: { titulo: string; valor: string; sub?: string; destacado?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 p-4 rounded-xl border ${destacado ? 'bg-indigo-950/40 border-indigo-700/60' : 'bg-slate-900 border-slate-800'}`}>
      <span className={`text-[10px] font-bold uppercase tracking-wider ${destacado ? 'text-indigo-300' : 'text-zinc-500'}`}>{titulo}</span>
      <span className={`font-bold tabular-nums ${destacado ? 'text-3xl text-white' : 'text-2xl text-zinc-200'}`}>{valor}</span>
      {sub && <span className="text-[11px] text-zinc-500">{sub}</span>}
    </div>
  );
}

/** Estilo por tipo: subtotal destacado (indicador principal); +180 y total atenuados (secundarios); control en rojo. */
const ESTILO_FILA: Record<FilaTabla['tipo'], { tr: string; td: string; conv: string }> = {
  tramo:    { tr: 'border-b border-slate-800/50', td: 'text-zinc-300', conv: 'font-bold text-white' },
  subtotal: { tr: 'border-y-2 border-indigo-700/60 bg-indigo-950/40', td: 'font-bold text-white', conv: 'font-bold text-white text-base' },
  mas180:   { tr: 'border-b border-slate-800/50', td: 'text-zinc-500', conv: 'text-zinc-500' },
  total:    { tr: 'border-b border-slate-800/50', td: 'text-zinc-500 italic', conv: 'text-zinc-500 italic' },
  control:  { tr: 'bg-rose-950/30', td: 'text-rose-300', conv: 'text-rose-300' },
};

function FilaTramo({ f }: { f: FilaTabla }) {
  const e = ESTILO_FILA[f.tipo];
  return (
    <tr className={e.tr}>
      <Td izq clase={e.td}>{f.etiqueta}</Td>
      <Td clase={e.td}>{fmtNum(f.ofertas)}</Td>
      <Td clase={e.td}>{fmtNum(f.ventas)}</Td>
      <Td clase={e.conv}>{fmtPct(f.conversion)}</Td>
      <Td clase={e.td}>{fmtPct(f.peso)}</Td>
    </tr>
  );
}

function Td({ children, izq, clase }: { children: ReactNode; izq?: boolean; clase: string }) {
  return (
    <td className={`px-3 py-2.5 text-xs whitespace-nowrap tabular-nums ${izq ? 'text-left' : 'text-right'} ${clase}`}>{children}</td>
  );
}
