# Callcenter: Upgrade de ofertas (tablero BI de ventas ARG/COL)

## Requerimiento (texto original)
Solicito el desarrollo de un tablero de Business Intelligence (BI) que permita visualizar y realizar el seguimiento de los montos de ventas correspondientes a Argentina y Colombia, contemplando los ajustes por upgrade y downgrade.

El tablero deberá permitir:
- Seguimiento diario: visualizar los montos de ventas con información actualizada a día vencido (D-1).
- Seguimiento mensual: analizar la evolución y los montos acumulados de ventas durante el mes en curso.
- Segmentación por país: identificar y comparar los resultados de Argentina y Colombia.
- Ajustes por upgrade y downgrade: reflejar el impacto de estos movimientos sobre los montos de ventas, permitiendo identificar el valor inicial y el monto ajustado.
- Evolución de ventas: visualizar gráficamente el comportamiento diario y mensual, facilitando la identificación de tendencias y desvíos.

El objetivo es contar con una herramienta de seguimiento que permita monitorear la evolución real de los montos de ventas, tanto a nivel individual por país como de manera consolidada, facilitando el análisis y la toma de decisiones.

## Notas propias (Heber)
- Ubicación: submódulo nuevo dentro de Callcenter.
- Las definiciones de abajo ("Definiciones validadas") se comprobaron contra el DWH el 2026-11-25 y prevalecen sobre cualquier otra.
- Permisos: la v1 sigue la convención actual de DataPulse (la grilla filtra por la planilla de permisos; el servidor no valida permisos). No agregar validación nueva por ahora.
- Consolidado: el texto original menciona resultados consolidados, pero no se consolida porque los montos de ARG y COL están en monedas distintas (ARS y COP) y no se suman. El filtro de país es ARG o COL, uno a la vez, sin opción "ambos".

## Notas de la reunión con el jefe (vigentes sobre el texto original)
- Fuente: lead_offers (en Redshift: core_arg.lead_offers_arg y core_col.lead_offers_col; campos max_amount y max_amount_increased).
- Módulo Callcenter, submódulo "Upgrade de oferta". Agrupado por fecha de creación de la oferta.
- Por día y por país (ARG y COL): cantidad de ofertas; cantidad de ventas de esas ofertas; ticket promedio; ofertas con upgrade disponible; ofertas con upgrade tomado; de las que tenían upgrade disponible, cuántas lo usaron.
- Filtros: país (ARG o COL, uno a la vez; sin opción "ambos" porque los montos no se suman entre países), fecha, si tuvo upgrade.
- Pregunta de negocio: ¿se usa el upgrade, cuánto, por país, por día? ¿Hay pocas ofertas con upgrade disponible o estando disponible no se usa?
- Estados de venta en loans: 20 y 39 en ARG; 22 y 24 en COL.
- Fuera de este trabajo: versionado de 3 números en la web (otra rama).

## Definiciones validadas contra el DWH (Redshift), 2026-11-25
Fuente: core_arg.lead_offers_arg / core_col.lead_offers_col, core_arg.loans_arg / core_col.loans_col, y platinum_ia.consultas_motor_multipais. NO usar auxiliary_tables (copias no normalizadas).

- Oferta: una fila por lead en lead_offers (verificado: ofertas = leads). Fecha de la oferta: created_at::date (ya está en hora local de cada país, ver Hallazgos).
- Venta: loan con status_id IN (20, 39) en ARG y (22, 24) en COL. Monto de la venta: loans_arg.amount en ARG, loans_col.total_amount en COL (en COL es igual a capital).
- Upgrade disponible: max_amount_increased > 0 (incluye los ya tomados). Pendiente: max_amount_increased > max_amount.
- Upgrade tomado: upgrade disponible (max_amount_increased > 0) y max_amount mayor al valor inicial del motor (el tope subió). Dos tipos: completo (max_amount = max_amount_increased) y parcial (valor inicial < max_amount < max_amount_increased); el cliente puede tomar menos que el aumentado disponible. Si la oferta no tiene dato del motor, se usa solo la regla de completo. Al tomarlo, el sistema actualiza la oferta (sube max_amount); las ventas de los completos salen por el monto aumentado.
- Valor inicial (tope): monto_max_ofertado del motor para el lead (platinum_ia.consultas_motor_multipais, cruce por lead_id::varchar y pais). Validado: coincide con max_amount en ofertas sin upgrade y con upgrade no tomado; en las tomadas es menor (ARG 60.000 -> 100.000; COL 250.000 -> 400.000). Las 25 ventas de ofertas con upgrade tomado (4 ARG, 21 COL) superaron todas el tope original del motor; entre las no tomadas solo 1 (ARG) y 2 (COL) lo superaron (residual, probables ajustes manuales).
  - ARG: la vista lee gold.consultas_motor_arg (desde risk_arg.risk_engine_arg), que guarda solo la PRIMERA ejecución por external_id (primer_valor = 1), excluye las políticas 10, 14 y 16, y deja lead_id vacío si external_type no es lead_id.
  - COL: la vista lee gold.consultas_motor_col (desde risk_col.risk_engine_col), que guarda TODAS las ejecuciones y excluye las políticas 16, 17 y 18; se toma la última ejecución.
  - La diferencia entre primera y última es inocua en los datos observados (0 leads en ARG y 1 en COL, ninguno entre los tomados).
  - La vista expone documento_cliente (DNI/cédula): NO usarlo en este módulo.
- Monto ajustado: max_amount actual de la oferta.
- Datos disponibles: el upgrade existe desde 2026-10-28 en ARG (primera oferta con upgrade a las 14:12; 92 ese día y entre 140 y 190 por día desde entonces) y desde 2026-11-03 en COL. Hay 2 registros sueltos anteriores en ARG (2025-04 y 2026-03), probables pruebas: descartar. Las ofertas y ventas sin upgrade existen desde antes; el tablero cuenta desde la fecha de inicio por país. Confirmado por el negocio: el upgrade empezó a usarse en el último mes.
- Números de control (ARG del 2026-10-28 al 2026-11-24, COL del 2026-11-03 al 2026-11-24, medido el 2026-11-26): ARG 4.447 ofertas con upgrade, 17 tomados completos, 4 parciales (21 en total, 0,5 %), 46 sin dato del motor; COL 1.337 con upgrade, 41 completos, 9 parciales (50 en total, 3,7 %), 25 sin dato del motor. Los tomados de un día pueden crecer después, porque el cliente puede tomar el upgrade más tarde. Referencia de 30 días hasta D-1 (rango $1 = 2026-10-26, $2 = 2026-11-25): ARG 25.714 ofertas y 9.678 ventas; COL 17.754 ofertas y 5.991 ventas. Con el tablero (que cuenta desde el inicio del upgrade) los totales de ofertas y ventas son menores, por ejemplo ARG 24.144 ofertas.
- Downgrade: no se identifica en estos datos. Fuera de la primera versión.
- Filtro "tuvo upgrade": Sí = upgrade disponible (max_amount_increased > 0), lo haya tomado o no; No = sin upgrade.

## Hallazgos de la Fase 0 (solo lectura y agregados)
- Los números de control coinciden exacto y el cruce con loans no duplica filas.
- core_arg.activity_log_arg no guarda historial de ofertas (subject_type solo Lead, User y Customer); el valor inicial sigue saliendo del motor. Colombia no tiene tabla equivalente.
- Zona horaria: todas las fechas son timestamp sin zona. lead_offers.created_at está en hora local de cada país. El motor de ARG coincide con la oferta; el motor de COL está adelantado (probablemente UTC). Ningún módulo existente convierte zona horaria.
- Desfase entre la ejecución del motor y la oferta: ARG hasta 28 días (95 % menor a 1 hora); COL hasta 1 día. Ventana del motor: de $1 menos 35 días a $2 más 2 días.
- Ofertas sin ejecución del motor: 387 en ARG y 250 en COL en el rango de control; ninguna entre los tomados. Además, unas 1.250 ofertas de ARG tienen ejecución del motor pero sin monto (posible causa a verificar: ofertas manuales, campo is_manual); tampoco hay ninguna entre los tomados. Se muestran como "sin tope inicial".

## Segunda etapa (no se implementa ahora, la v1 la deja preparada)
Mostrar el detalle de los créditos, no solo las sumarizaciones. Diseñar la v1 para poder agregarlo sin rehacer: un endpoint de detalle con paginación en el servidor, país obligatorio y rango acotado, que reutilice la misma query base. Sin nombre, documento, teléfono ni email. Seguir la convención actual de permisos.

## Decisiones abiertas
- Moneda: cada país se muestra en su moneda local (ARS y COP); no hay vista consolidada.
- Valor por defecto del filtro de país: ARG.
- Título y texto de permiso del submódulo: deben coincidir exactamente con la planilla de permisos.
- Hora de recarga de las tablas del motor (BI), para el corte D-1.

## Query base del tablero (por día y país)
$1 = inicio del rango, $2 = fin exclusivo del rango (parámetros, nunca texto concatenado). Para probarla a mano, reemplazar $1 y $2 por fechas reales, por ejemplo '2026-10-26' y '2026-11-25'. Al implementar, limitar además el motor a los lead_id de las ofertas del rango para que el costo dependa de las ofertas y no del largo del rango.

```sql
WITH motor AS (
  SELECT pais, lead_id, monto_max_ofertado,
         ROW_NUMBER() OVER (PARTITION BY pais, lead_id ORDER BY fecha_hora DESC) AS rn
  FROM platinum_ia.consultas_motor_multipais
  WHERE pais IN ('ARG', 'COL')
    AND fecha >= DATEADD('day', -35, $1::date)
    AND fecha < DATEADD('day', 2, $2::date)
),
base AS (
  SELECT 'ARG' AS pais, o.created_at::date AS fecha_oferta,
         o.max_amount, o.max_amount_increased, m.monto_max_ofertado AS monto_motor,
         l.id AS loan_id, l.amount AS monto_venta
  FROM core_arg.lead_offers_arg o
  LEFT JOIN core_arg.loans_arg l ON l.lead_id = o.lead_id AND l.status_id IN (20, 39)
  LEFT JOIN motor m ON m.pais = 'ARG' AND m.lead_id = o.lead_id::varchar AND m.rn = 1
  WHERE o.created_at >= $1::date AND o.created_at < $2::date
  UNION ALL
  SELECT 'COL', o.created_at::date,
         o.max_amount, o.max_amount_increased, m.monto_max_ofertado,
         l.id, l.total_amount
  FROM core_col.lead_offers_col o
  LEFT JOIN core_col.loans_col l ON l.lead_id = o.lead_id AND l.status_id IN (22, 24)
  LEFT JOIN motor m ON m.pais = 'COL' AND m.lead_id = o.lead_id::varchar AND m.rn = 1
  WHERE o.created_at >= $1::date AND o.created_at < $2::date
),
clasif AS (
  SELECT *,
         CASE
           WHEN max_amount_increased > 0 AND max_amount = max_amount_increased THEN 'tomado_completo'
           WHEN max_amount_increased > 0 AND max_amount < max_amount_increased
                AND monto_motor IS NOT NULL AND max_amount > monto_motor THEN 'tomado_parcial'
           WHEN max_amount_increased > 0 THEN 'disponible_no_tomado'
           ELSE 'sin_upgrade'
         END AS segmento
  FROM base
)
SELECT pais, fecha_oferta,
       COUNT(*) AS ofertas,
       COUNT(loan_id) AS ventas,
       ROUND(AVG(monto_venta), 0) AS ticket_promedio,
       SUM(CASE WHEN segmento <> 'sin_upgrade' THEN 1 ELSE 0 END) AS ofertas_con_upgrade,
       SUM(CASE WHEN segmento = 'tomado_completo' THEN 1 ELSE 0 END) AS upgrade_tomado_completo,
       SUM(CASE WHEN segmento = 'tomado_parcial' THEN 1 ELSE 0 END) AS upgrade_tomado_parcial,
       SUM(CASE WHEN loan_id IS NOT NULL AND segmento <> 'sin_upgrade' THEN 1 ELSE 0 END) AS ventas_con_upgrade,
       SUM(CASE WHEN loan_id IS NOT NULL AND segmento IN ('tomado_completo', 'tomado_parcial') THEN 1 ELSE 0 END) AS ventas_upgrade_tomado,
       SUM(monto_venta) AS monto_vendido,
       SUM(CASE WHEN segmento IN ('tomado_completo', 'tomado_parcial') THEN monto_motor END) AS tope_inicial_tomado,
       SUM(CASE WHEN segmento IN ('tomado_completo', 'tomado_parcial') THEN max_amount END) AS tope_ajustado_tomado,
       SUM(CASE WHEN segmento IN ('tomado_completo', 'tomado_parcial') THEN monto_venta END) AS monto_vendido_upgrade_tomado
FROM clasif
GROUP BY pais, fecha_oferta
ORDER BY pais, fecha_oferta DESC
LIMIT 100;
```