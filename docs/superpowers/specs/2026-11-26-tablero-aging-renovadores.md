# Callcenter: submódulo "Aging de ofertas" (renovadores, ARG/COL)

Fecha: 2026-11-26
Rama: feature/tablero-aging-renovadores
Autor: Heber Zapata

## 1. Contexto y objetivo

Hoy no hay un tablero que muestre cómo fue un mes cerrado en ventas y conversión de
renovadores según la antigüedad (aging) de la oferta. Se quiere un submódulo nuevo
dentro de Callcenter, para ARG y COL, con selector de mes cerrado, y la posibilidad
de exportar a Excel la base de renovadores NO vendidos por mes.

Pregunta que responde: de las ofertas de renovación que estaban vivas en el mes, cuántas
convirtieron según su antigüedad, y cuánto pesa cada tramo en las ventas del mes.

## 2. Ubicación en la aplicación

- Submódulo nuevo dentro del módulo Callcenter.
- NO se modifica la estructura de Directorio ni los submódulos existentes. Solo se agrega
  uno nuevo y se le avisa al jefe.
- Nombre del submódulo: **Aging de ofertas** (lo define el equipo de BI). El texto de
  permisos debe coincidir exactamente con el que se cargue en la planilla de permisos;
  seguir el formato del submódulo Upgrade de oferta.
- Patrones a seguir (consultar, no modificar): `server/upgradeOfertaQuery.ts`,
  `src/components/submodules/CallcenterUpgradeOfertaSubmodule.tsx`,
  `src/components/submodules/upgradeOfertaHelpers.ts`, endpoint en `server.ts`,
  cliente en `src/services/api.ts`.

## 3. Alcance de la primera versión

- Tabla de aging por país (ARG y COL, lado a lado o con selector), para el mes elegido.
- Columnas: ofertas vivas, ventas del mes, conversión, peso en las ventas.
- Tramos: 0-30, 31-60, 61-90, 91-180, subtotal hasta 180 y "más de 180" aparte, más total.
- El subtotal hasta 180 días es el indicador principal (destacado). El total, que incluye
  el stock de más de 180 días, se muestra como dato secundario, porque en ARG ese stock
  nunca convierte y diluye la tasa.
- Selector de mes con todos los meses cerrados que tengan datos (no solo octubre); por
  defecto, el último mes cerrado. No se muestra el mes en curso. Octubre 2026 es solo
  el mes de validación.
- Aging medido desde el día comercial de la oferta de la vista (ver sección 5). Las ofertas
  generadas fuera de horario se cuentan al siguiente día hábil.
- Nota en pantalla cuando haya ventas con oferta registrada después de la venta
  (`con_oferta_posterior_a_la_venta` > 0): "Incluye N ventas con oferta registrada
  hasta 7 días después del desembolso, contadas en 0-30".
- Indicación en pantalla de la fecha de consulta (los datos reflejan el estado actual).
- Export a Excel de renovadores no vendidos del mes (ver sección 8).
- Control de conciliación contra las tablas oficiales de ventas (Query 2).

## 4. Fuera de alcance

- Cambiar la estructura de Directorio o submódulos existentes.
- Modificar el .md de otros specs ni los archivos del submódulo Upgrade de oferta.
- Cambios en master.
- Guardar una foto histórica de cada mes (la vista refleja el estado actual).
- Validación de permisos en el servidor (hoy ningún endpoint la hace; ver sección 8).

## 5. Fuente y lógica

### Fuente y unidad de análisis

- Vista: `gold.vw_vendedores_ventas`. Una fila por evento: una por cada oferta
  (`flag_oferta = 1`) y una por cada venta (`flag_venta = 1`).
- Las ofertas salen de `auxiliary_tables.lead_oferta_arg` y `lead_oferta_col` (campo
  `dia_oferta`); las ventas, de `gold.ventas_arg` y `gold.ventas_col` (campo
  `fecha_desembolso`). Por eso las ventas de la vista coinciden con las tablas oficiales.
- Filtro: `tipo_cliente = 'renovador'`, separado por país (`pais = 'ARG'` / `'COL'`).
- Unidad: el lead. Verificado en ene-oct 2026: ningún lead tuvo más de una venta en el
  mes, así que contar leads vendidos equivale a contar créditos.
- Tipo de dato de `fecha`: `date` (verificado).

### Fechas de cada lead

- Fecha de venta: la primera venta de renovación del lead (`MIN(fecha)` con `flag_venta = 1`).
- Fecha de corte del lead: la fecha de venta si vendió en el mes; si no vendió en el mes,
  el último día del mes.
- Fecha de oferta: la ÚLTIMA oferta de renovación del lead hasta su fecha de corte
  (`MAX(fecha)` con `flag_oferta = 1` y `fecha <= fecha de corte`).
- La vista guarda hoy una sola fecha de oferta por lead (verificado: 0 leads con más de
  una fecha de oferta en toda la historia de ARG y COL). En la práctica, la última oferta
  es la fecha de oferta que figura en la vista; la regla se mantiene por robustez.

### Cómo se calcula `dia_oferta` (día comercial de la oferta)

`dia_oferta` no es la fecha exacta de creación de la oferta. Se calcula en el procedimiento
de `auxiliary_tables` (`lead_asignacion_arg`) a partir del `created_at` de la última oferta
de cada lead (`max(id)` por `lead_id`), llevado al siguiente día hábil comercial:

- lunes a viernes, oferta creada después de las 20:51: se cuenta al día siguiente (+1);
- sábado, creada después de las 16:51: se cuenta al lunes (+2);
- domingo: se cuenta al lunes (+1);
- en cualquier otro caso queda el mismo día.

Los cortes son los mismos en ARG y COL. Por eso no hay ofertas con `dia_oferta` en domingo.
El desfase máximo respecto de la creación real es de 2 días.

### Ofertas registradas después de la venta (sobre todo ARG)

- En ARG, entre 132 y 338 ventas por mes en 2026 (4% al 8% de las ventas; 275 en octubre)
  tienen `dia_oferta` 1 o 2 días posterior al desembolso. En COL ocurre de forma
  esporádica (de 0 a 12 por mes). En ene-oct 2026 ningún caso supera los 7 días.
- Causa (resuelta): es el efecto del corte horario descripto arriba. Una oferta creada
  fuera de horario pasa al siguiente día hábil comercial, y si el cliente compra antes de
  esa fecha la venta queda con fecha anterior a `dia_oferta`. Verificado en octubre (ARG):
  en las 275 ventas la oferta fue creada (`created_at`) hasta la fecha de la venta y no se
  actualizó después; ninguna es manual; todas estaban aceptadas; el capital vendido sobre la
  oferta es parecido al resto (0,76 contra 0,75). Distribución: 103 ventas de domingo
  (oferta pasada al lunes), 63 de sábado (oferta pasada al lunes) y 109 de lunes a viernes
  (+1 día). La oferta es la misma que se vendió: lo que está corrido es `dia_oferta`.
- Regla: si el desfase es de hasta 7 días, la venta se cuenta en el tramo 0-30 con aging 0.
  Si fuera mayor, queda en una fila de control "0. CONTROL" que debe estar vacía. La
  tolerancia de 7 días cubre de sobra el desfase máximo posible (2 días).
- La query informa cuántas ventas tuvieron este ajuste (`con_oferta_posterior_a_la_venta`).
- Borde de fin de mes: para los leads que vendieron en el mes, se aceptan ofertas
  registradas hasta 7 días después del cierre del mes (la misma tolerancia). Así, una
  venta del último día del mes con la oferta registrada al mes siguiente no queda fuera
  del universo ni del conteo de ventas. Para los leads que no vendieron en el mes, solo
  se consideran ofertas hasta el cierre.

### Universo: ofertas vivas en el mes

Un lead entra al universo si:
1. tiene una oferta creada hasta el último día del mes (o hasta 7 días después, si vendió
   en el mes; ver borde de fin de mes), y
2. no había comprado antes del primer día del mes (no tiene venta, o la venta es del mes
   o posterior).

Un lead que vende después del cierre del mes sigue siendo una oferta viva de ese mes
(no convirtió en él).

Las ofertas no vencen en la vista, por lo que el stock de ofertas vivas crece mes a mes
(ARG: de 39.421 en enero a 47.193 en octubre).

### Aging de la oferta

- Días entre la última oferta (hasta el corte) y la fecha de corte (mínimo 0, ver regla
  de ofertas posteriores).
- Tramos: 0-30, 31-60, 61-90, 91-180. Las de más de 180 días van aparte.
- Las ofertas de más de 180 días: en ARG nunca convirtieron en ene-oct 2026; en COL
  convierten entre 0,5% y 0,9%.

### Métricas

- Conversión del tramo: ventas del mes del tramo / ofertas vivas del tramo.
- Peso en las ventas: ventas del tramo / total de ventas del mes del país (incluye el
  tramo de más de 180).
- Indicador principal: subtotal hasta 180 días. Total: incluye más de 180 (dato secundario).

### Por qué no se usa "ventas del mes / ofertas del mes"

Da 92% en ARG y 89% en COL, pero mezcla cohortes: parte de las ventas del mes viene de
ofertas de meses anteriores (1.097 ventas en ARG en octubre). Ese número no mide conversión.

## 6. Resultado de referencia (Octubre 2026)

### Colombia

| Aging de la oferta | Ofertas vivas | Ventas Oct-26 | Conversión | Peso en las ventas |
|---|---|---|---|---|
| 0-30 días | 6.051 | 4.151 | 68,6% | 86,1% |
| 31-60 días | 1.150 | 235 | 20,4% | 4,9% |
| 61-90 días | 810 | 123 | 15,2% | 2,6% |
| 91-180 días | 2.187 | 200 | 9,1% | 4,1% |
| Subtotal hasta 180 días | 10.198 | 4.709 | 46,2% | 97,7% |
| Más de 180 días | 15.881 | 111 | 0,7% | 2,3% |
| Total | 26.079 | 4.820 | 18,5% | 100,0% |

### Argentina

| Aging de la oferta | Ofertas vivas | Ventas Oct-26 | Conversión | Peso en las ventas |
|---|---|---|---|---|
| 0-30 días (incluye 275 con oferta registrada posterior) | 7.189 | 5.597 | 77,9% | 92,6% |
| 31-60 días | 1.230 | 258 | 21,0% | 4,3% |
| 61-90 días | 895 | 94 | 10,5% | 1,6% |
| 91-180 días | 1.720 | 95 | 5,5% | 1,6% |
| Subtotal hasta 180 días | 11.034 | 6.044 | 54,8% | 100,0% |
| Más de 180 días | 36.159 | 0 | 0,0% | 0,0% |
| Total | 47.193 | 6.044 | 12,8% | 100,0% |

(Los pesos de ARG pueden sumar 100,1% por redondeo.)

## 7. Queries de referencia

Para cambiar el mes solo se modifica el CTE `params`. En la implementación las fechas
van como parámetros ($1/$2), nunca concatenadas.

### Query 1: conversión por aging (ARG y COL)

```sql
-- Conversión de ofertas de renovación por aging de la oferta
-- Fuente: gold.vw_vendedores_ventas | Grano: lead | Países: ARG y COL
WITH params AS (
  SELECT '2026-10-01'::date AS mes_ini,
         '2026-10-31'::date AS mes_fin
),
ofertas AS (   -- fechas de oferta por lead, hasta 7 días después del cierre del mes
  SELECT DISTINCT v.pais, v.lead_id, v.fecha AS f_oferta
  FROM gold.vw_vendedores_ventas v, params p
  WHERE v.tipo_cliente = 'renovador'
    AND v.flag_oferta = 1
    AND v.fecha <= DATEADD(day, 7, p.mes_fin)
),
ventas AS (    -- primera venta de renovación del lead
  SELECT pais, lead_id, MIN(fecha) AS f_venta
  FROM gold.vw_vendedores_ventas
  WHERE tipo_cliente = 'renovador'
    AND flag_venta = 1
  GROUP BY 1, 2
),
base AS (      -- ofertas vivas: el lead no había comprado antes del inicio del mes
  SELECT o.pais, o.lead_id, o.f_oferta,
         CASE WHEN v.f_venta BETWEEN p.mes_ini AND p.mes_fin THEN 1 ELSE 0 END AS vendio_mes,
         CASE WHEN v.f_venta BETWEEN p.mes_ini AND p.mes_fin
              THEN v.f_venta ELSE p.mes_fin END AS f_corte
  FROM ofertas o
  CROSS JOIN params p
  LEFT JOIN ventas v ON v.pais = o.pais AND v.lead_id = o.lead_id
  WHERE (v.f_venta IS NULL OR v.f_venta >= p.mes_ini)
    AND (o.f_oferta <= p.mes_fin
         OR v.f_venta BETWEEN p.mes_ini AND p.mes_fin)
),
universo AS (  -- una fila por lead: última oferta hasta su corte (o la primera posterior)
  SELECT pais, lead_id, vendio_mes, f_corte,
         MAX(CASE WHEN f_oferta <= f_corte THEN f_oferta END) AS f_previa,
         MIN(f_oferta)                                          AS f_min
  FROM base
  GROUP BY 1, 2, 3, 4
),
aging AS (
  SELECT pais, vendio_mes,
         CASE WHEN f_previa IS NULL THEN 1 ELSE 0 END AS oferta_posterior,
         CASE WHEN f_previa IS NOT NULL                     THEN DATEDIFF(day, f_previa, f_corte)
              WHEN DATEDIFF(day, f_corte, f_min) <= 7       THEN 0
              ELSE NULL END AS dias
  FROM universo
)
SELECT pais,
       CASE WHEN dias IS NULL THEN '0. CONTROL: oferta posterior a la venta (más de 7 días)'
            WHEN dias <= 30   THEN '1. 0-30'
            WHEN dias <= 60   THEN '2. 31-60'
            WHEN dias <= 90   THEN '3. 61-90'
            WHEN dias <= 180  THEN '4. 91-180'
            ELSE                   '5. +180 (fuera del subtotal)' END AS aging,
       COUNT(*)                                        AS ofertas_vivas,
       SUM(vendio_mes)                                 AS ventas_mes,
       ROUND(SUM(vendio_mes)::numeric / COUNT(*), 4)   AS conversion,
       SUM(oferta_posterior)                           AS con_oferta_posterior_a_la_venta
FROM aging
GROUP BY 1, 2
ORDER BY 1, 2;
```

### Query 2: control de conciliación

```sql
WITH params AS (
  SELECT '2026-10-01'::date AS mes_ini, '2026-10-31'::date AS mes_fin
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
         WHERE v.pais = 'COL' AND c.lead_id IS NULL);
```

Resultado esperado para octubre 2026:

| País | Ventas en la vista | Ventas en la tabla oficial | Ventas sin oferta |
|---|---|---|---|
| ARG | 6.044 | 6.044 | 0 |
| COL | 4.820 | 4.820 | 0 |

## 8. Export a Excel: renovadores no vendidos por mes

- Universo: ofertas vivas del mes con `vendio_mes = 0` (mismo universo de la Query 1) que
  tampoco vendieron después del cierre (`vendio_despues = 0`): renovadores que hoy siguen
  sin comprar.
- Los que vendieron después del cierre se excluyen del archivo. En la tabla de aging y en
  la Query 1 siguen contando como ofertas vivas no convertidas del mes (eso no cambia). En
  pantalla, junto al botón del export, se informa solo su cantidad: "Se excluyeron N
  renovadores que compraron después del cierre".
- Un archivo por país y mes: el del país y mes elegidos en pantalla. Nombre:
  `renovadores_no_vendidos_{PAIS}_{YYYY-MM}_{YYYYMMDD}.xlsx` (la última parte es la fecha
  de descarga).
- Columnas, en este orden: `pais`, `lead_id`, `fecha_oferta`, `dias_aging` (al cierre),
  `tramo_aging`, `monto_oferta`, `monto_oferta_increased`, `telefono`, `email`. No incluye
  tipo de cliente (son todos renovadores).
- Fuentes de las columnas agregadas (LEFT JOIN, no cambian la cantidad de filas; validado
  con conteos en oct-26: ARG 40.305 y COL 19.754 filas antes y después del cruce):
  - La oferta es la misma del aging: `auxiliary_tables.lead_oferta_arg/col` (una fila por
    lead, la última oferta, de donde sale `dia_oferta`) se une con
    `core_arg.lead_offers_arg` / `core_col.lead_offers_col` por id de la oferta **y**
    `lead_id`.
  - `monto_oferta` = `lead_offers_*.max_amount` y `monto_oferta_increased` =
    `lead_offers_*.max_amount_increased`, de la misma fila. `monto_oferta` coincide con el
    `monto_oferta` de `gold.vw_vendedores_ventas` en el 100% de las filas (oct-26).
  - `telefono` = `cellphone` y `email` = `email` de `core_arg.customers_arg` /
    `core_col.customers_col`, vía `core_arg.leads_arg` / `core_col.leads_col`
    (`leads.id = lead_id`, `customers.id = leads.customer_id`).
- Nota (id de oferta repetido): en ARG hay ids de oferta repetidos entre leads distintos
  (2 casos en `lead_offers_arg`, con el mismo `branch_id`). Unir solo por id duplicaba una
  fila del export; por eso la unión con `lead_offers_*` usa `id` y `lead_id`.
- Nota (monto increased): solo tiene datos reales desde el 2026-10-28 en ARG y desde el
  2026-11-03 en COL (las mismas fechas de `PAISES.inicio_datos` en
  `server/upgradeOfertaQuery.ts`). En ofertas creadas antes la celda queda **vacía** (sin
  texto ni 0); desde esas fechas se exporta el valor, con nulo = 0. Se decide con el
  `created_at` de la oferta (`timestamp` sin zona, en hora local, igual que Upgrade de
  oferta), no con el valor del monto.
- Nota (teléfono y email): se exportan tal como están en origen, sin limpiar ni
  concatenar; si están vacíos quedan vacíos. Los teléfonos con formato irregular salen como
  están. En ARG, `customers_arg` tiene además una columna `area` que no se exporta.
- El archivo contiene datos personales (teléfono y email). No se cachean ni se loguean en
  el servidor (`Cache-Control: no-store`, el log del export muestra solo conteos) y en la
  pantalla no se guardan las filas en el estado, solo la cantidad.
- Control: filas del archivo + excluidos por venta posterior = ofertas vivas − ventas del
  mes (Query 1). Si no se cumple, la pantalla lo marca y sugiere refrescar y volver a
  exportar. Además, los excluidos del export se cruzan con "vendieron después del cierre"
  del tablero. Si difieren (venta nueva o caché del tablero), se muestra un aviso
  informativo, no un error.
- Los números del export cambian día a día a medida que los clientes compran: la
  verificación usa la regla anterior y el cruce con el tablero del mismo momento, no
  valores fijos. Referencia (oct-26, consulta del 27/11/2026): ARG 40.305 filas y 844
  excluidos; COL 19.754 filas y 1.505 excluidos.
- Quién puede descargarlo: quien vea el submódulo, igual que Upgrade de oferta. Hoy la
  convención de DataPulse es que la grilla filtra por la planilla de permisos y el
  servidor no valida permisos; el endpoint del export no agrega validación, aunque ahora
  incluye teléfono y email (decisión 7).
- Durante el desarrollo, Claude Code NO debe mostrar ni imprimir filas de esta base. Para
  verificar el export se usan solo conteos (cantidad de filas, excluidos y nombres de
  columnas).

## 9. Decisiones tomadas y puntos abiertos

Decisiones:
1. Aging desde la última oferta hasta la fecha de corte (hoy equivale a la fecha de oferta
   de la vista, que es única por lead).
2. La vista refleja el estado actual y los números de meses ya cerrados pueden
   actualizarse cuando se registren ventas con fecha dentro de ese mes. Es esperable
   y no se guarda foto histórica. En pantalla se indica la fecha de consulta.
3. Ventas con oferta registrada hasta 7 días después: se cuentan en el tramo 0-30 con
   aging 0, y se informa la cantidad en pantalla. Mismo criterio para el borde de fin
   de mes (sección 5).
4. El submódulo muestra todos los meses cerrados con datos, no solo octubre. No se muestra
   el mes en curso.
5. El export de no vendidos incluye solo a quienes siguen sin comprar: se excluyen los que
   vendieron después del cierre, y en pantalla se informa solo su cantidad. Columnas
   (sin `vendio_despues_del_cierre` ni tipo de cliente): las 5 de aging más
   `monto_oferta`, `monto_oferta_increased`, `telefono` y `email`, pedidas por el jefe el
   27/11/2026 (ver sección 8). La tabla de aging no cambia: ahí siguen contando como
   ofertas vivas.
6. Nombre del submódulo: "Aging de ofertas" (lo define BI).
7. Descarga del export abierta a quien vea el submódulo (convención actual, sin validación
   en servidor). Se mantiene esta convención aunque el export ahora incluya teléfono y
   email: decisión explícita del 27/11/2026, sin validación de permisos en el servidor.
8. El subtotal hasta 180 días es el indicador principal; el total es secundario.

Puntos resueltos / informativos:
9. **`dia_oferta` posterior a la fecha de venta (ARG) — Resuelto / informativo.**
   `dia_oferta` no es la fecha real de creación de la oferta. Se calcula en el
   procedimiento de `auxiliary_tables` (`lead_asignacion_arg`) a partir del
   `created_at` de la última oferta de cada lead (`max(id)` por `lead_id`),
   llevado al siguiente día hábil comercial:
   - lunes a viernes, oferta creada después de las 20:51: se cuenta al día siguiente (+1);
   - sábado, creada después de las 16:51: se cuenta al lunes (+2);
   - domingo: se cuenta al lunes (+1);
   - en cualquier otro caso queda el mismo día.
   Los cortes son los mismos en ARG y COL.
   Por eso existen ventas con fecha de 0 a 2 días anterior a `dia_oferta`
   (Oct-26 ARG: 275 casos; en esos casos la oferta existía antes de la venta,
   estaba aceptada y no era manual). La tolerancia de +7 días del tablero lo
   cubre de sobra (desfase máximo posible: 2 días). Esas ventas se cuentan en
   el tramo 0-30 con aging 0.
   Consecuencia de definición: el aging del tablero se mide desde el día
   comercial de la oferta, no desde su creación exacta.
10. **Vencimiento de ofertas +180 días (ARG) — Resuelto.**
    Solo 12 de las 36.159 ofertas sin vender de más de 180 días siguen
    `is_active`. En la práctica estas ofertas ya no están vigentes y no
    convierten (0 ventas en 10 meses), por eso el tablero las muestra
    aparte ("+180") y fuera del subtotal ≤180.
11. **Recarga de la tabla de ofertas — Informativo.**
    `auxiliary_tables.lead_oferta_arg/col` se borra y se recarga completa en
    cada corrida del procedimiento, con la última oferta de cada lead. Si a un
    lead le generan una oferta nueva, su `dia_oferta` se mueve y el aging se
    reinicia. Es coherente con la decisión de trabajar con la última oferta,
    pero las cifras de meses cerrados pueden variar levemente entre consultas.

Puntos abiertos:
12. Avisar al jefe del submódulo nuevo en Callcenter y cargar el texto de permisos en la
    planilla.
13. A quién incluir en el export según las marcas de contacto: hoy no se filtra. Columnas
    disponibles: `opt_in` (`leads_arg` / `leads_col`), `banned` (`customers_arg`),
    `contact_enabled` y `has_blocked_renovation` (`customers_col`), y las blacklists de
    `auxiliary_tables`. Definir si se excluye a alguien antes de usar el archivo para
    contactar.

## 10. Controles y verificación

Verificado para enero a octubre 2026 (ARG y COL):
- `fecha` es de tipo date.
- En cada mes, las ventas de la Query 1 coinciden con `gold.ventas_arg` y `gold.ventas_col`
  (diferencia 0) y la fila "0. CONTROL" queda vacía.
- COL reproduce exacto la tabla original medida desde la primera oferta (octubre).
- Ningún lead con más de una venta en el mes.
- Ningún lead con más de una fecha de oferta en toda la historia.
- La conversión baja al subir el tramo en todos los meses y países.

Valores de referencia (pueden variar levemente porque la vista refleja el estado actual,
ver punto 11 de la sección 9):

| Mes | ARG ofertas vivas | ARG ventas | ARG con oferta posterior | COL ofertas vivas | COL ventas | COL con oferta posterior |
|---|---|---|---|---|---|---|
| Ene-26 | 39.421 | 3.274 | 144 | 23.538 | 5.786 | 2 |
| Feb-26 | 39.508 | 3.108 | 132 | 23.547 | 4.902 | 0 |
| Mar-26 | 39.905 | 3.221 | 151 | 23.995 | 5.859 | 0 |
| Abr-26 | 40.341 | 3.316 | 144 | 23.829 | 5.392 | 1 |
| May-26 | 41.491 | 3.960 | 299 | 24.449 | 5.679 | 2 |
| Jun-26 | 42.702 | 4.273 | 227 | 24.750 | 4.980 | 7 |
| Jul-26 | 44.223 | 5.063 | 272 | 25.178 | 5.074 | 0 |
| Ago-26 | 45.437 | 5.503 | 338 | 25.109 | 4.772 | 0 |
| Sep-26 | 46.590 | 5.936 | 270 | 25.481 | 4.798 | 12 |
| Oct-26 | 47.193 | 6.044 | 275 | 26.079 | 4.820 | 0 |

Rangos esperados de conversión por tramo (ene-oct 2026):

| Tramo | ARG | COL |
|---|---|---|
| 0-30 | 72,6% a 77,9% | 60,5% a 75,7% |
| 31-60 | 17,9% a 28,7% | 19% a 29% |
| 61-90 | 9,6% a 18% | 12,7% a 21,0% |
| 91-180 | 4,5% a 6,7% | 6,8% a 10,7% |
| +180 | 0% | 0,5% a 0,9% |

Criterio de aceptación del desarrollo: para cada mes de ene a oct 2026 y para ARG y COL,
las ventas y ofertas vivas que muestra el submódulo coinciden con la tabla de referencia
(tolerancia: pequeñas variaciones por ser una vista en vivo). Verificar con conteos
agregados, sin IDs ni datos de clientes.

Verificación del desarrollo:
- `npm run lint` sin errores.
- Probar el endpoint y la UI en el navegador (ARG, COL, cambio de mes, export).
- Comparar contra una línea base guardada fuera del repo para confirmar que lo existente
  no cambió.

## 11. Reglas de trabajo

- Consultas al DWH (Redshift): solo SELECT dentro de transacción READ ONLY, con timeout y
  LIMIT, solo conteos agregados, sin IDs ni datos de clientes. Mostrar la query antes de
  ejecutarla. Parámetros con $1/$2.
- No abrir, mostrar ni subir `.env`.
- Claude Code no hace commit ni push.
- Recordar: el backend (`npm run dev`) no recarga solo; reiniciarlo tras cambiar `server/`.