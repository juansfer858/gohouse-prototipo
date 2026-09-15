BEGIN;
SELECT set_config('gohouse.tariff_edit','allowed',true);
-- Seed only a previously unconfigured catalog; never overwrite saved references.
UPDATE app_state SET data=jsonb_set(data::jsonb,'{gohouse-data}',
  COALESCE(data::jsonb->'gohouse-data','{}'::jsonb) || jsonb_build_object('config',
    COALESCE(data::jsonb#>'{gohouse-data,config}','{}'::jsonb) || jsonb_build_object('tarifasZonas','[
      {"id":"estandar","nombre":"Servicio estándar","tarifa":4000,"activa":true,"predeterminada":true,"orden":1},
      {"id":"el-rocio","nombre":"El Rocío","tarifa":5000,"activa":true,"predeterminada":false,"orden":2},
      {"id":"la-sonora","nombre":"La Sonora","tarifa":5000,"activa":true,"predeterminada":false,"orden":3},
      {"id":"el-peaje","nombre":"El Peaje","tarifa":5000,"activa":true,"predeterminada":false,"orden":4},
      {"id":"el-batallon","nombre":"El Batallón","tarifa":7000,"activa":true,"predeterminada":false,"orden":5},
      {"id":"la-piedra","nombre":"La Piedra","tarifa":7000,"activa":true,"predeterminada":false,"orden":6},
      {"id":"el-chaquiro","nombre":"El Chaquiro","tarifa":1000,"activa":true,"predeterminada":false,"orden":7},
      {"id":"vallecitos","nombre":"Vallecitos","tarifa":17000,"activa":true,"predeterminada":false,"orden":8},
      {"id":"santa-rosa","nombre":"Santa Rosa","tarifa":45000,"activa":true,"predeterminada":false,"orden":9},
      {"id":"yarula","nombre":"Yarula","tarifa":50000,"activa":true,"predeterminada":false,"orden":10},
      {"id":"san-jose","nombre":"San José","tarifa":45000,"activa":true,"predeterminada":false,"orden":11}
    ]'::jsonb)),true),version=version+1,updated_at=now()
WHERE id=1 AND (data::jsonb#>'{gohouse-data,config,tarifasZonas}') IS NULL;

CREATE OR REPLACE FUNCTION gohouse_tariff_contract() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  zones jsonb := NEW.data::jsonb#>'{gohouse-data,config,tarifasZonas}';
  old_zones jsonb := OLD.data::jsonb#>'{gohouse-data,config,tarifasZonas}';
  orders jsonb := NEW.data::jsonb#>'{gohouse-data,orders}';
  old_orders jsonb := OLD.data::jsonb#>'{gohouse-data,orders}';
  old_map jsonb; result_orders jsonb := '[]'::jsonb;
  item jsonb; previous jsonb; zone jsonb; key text;
  pct numeric; fee numeric; house numeric; enriched boolean := false;
BEGIN
  IF zones IS DISTINCT FROM old_zones THEN
    IF current_setting('gohouse.tariff_edit',true) IS DISTINCT FROM 'allowed' THEN
      RAISE EXCEPTION 'TARIFF_SETTINGS_USE_PANEL' USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(zones) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'TARIFF_STANDARD_PROTECTED' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(zones) z WHERE z->>'id'='estandar'
       AND z->>'nombre'='Servicio estándar' AND z->'activa'='true'::jsonb AND z->'predeterminada'='true'::jsonb)
       OR (SELECT count(*) FROM jsonb_array_elements(zones) z WHERE z->'predeterminada'='true'::jsonb) <> 1 THEN
      RAISE EXCEPTION 'TARIFF_STANDARD_PROTECTED' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(zones) z WHERE jsonb_typeof(z->'tarifa') IS DISTINCT FROM 'number'
      OR NOT (COALESCE(z->>'tarifa','') ~ '^[0-9]+$') OR length(COALESCE(z->>'nombre','')) NOT BETWEEN 2 AND 80
      OR z->>'id' IS NULL OR jsonb_typeof(z->'activa') IS DISTINCT FROM 'boolean') THEN
      RAISE EXCEPTION 'TARIFF_INVALID_CATALOG' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(zones) z WHERE (z->>'tarifa')::numeric NOT BETWEEN 1 AND 10000000)
      OR (SELECT count(*) FROM jsonb_array_elements(zones)) <> (SELECT count(DISTINCT z->>'id') FROM jsonb_array_elements(zones) z) THEN
      RAISE EXCEPTION 'TARIFF_INVALID_CATALOG' USING ERRCODE='23514';
    END IF;
  END IF;
  IF orders IS NOT DISTINCT FROM old_orders OR jsonb_typeof(orders) IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
  SELECT COALESCE(jsonb_object_agg(o->>'id',o),'{}'::jsonb) INTO old_map
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(old_orders)='array' THEN old_orders ELSE '[]'::jsonb END) o WHERE o->>'id' IS NOT NULL;
  FOR item IN SELECT * FROM jsonb_array_elements(orders) LOOP
    previous := old_map->(item->>'id');
    IF previous->'tarifaFijada'='true'::jsonb THEN
      FOREACH key IN ARRAY ARRAY['zonaTarifaId','zonaTarifaNombre','tarifa','tarifaFijada','porcentajeCasaSnapshot','comisionCasa','gananciaDomiciliario'] LOOP
        IF item->key IS DISTINCT FROM previous->key THEN
          RAISE EXCEPTION 'TARIFF_ORDER_LOCKED' USING ERRCODE='23514';
        END IF;
      END LOOP;
    ELSIF previous IS NULL AND (item->'tarifaFijada'='true'::jsonb OR item ? 'zonaTarifaId') THEN
      SELECT z INTO zone FROM jsonb_array_elements(COALESCE(zones,'[]'::jsonb)) z
        WHERE z->>'id'=item->>'zonaTarifaId' AND z->'activa'='true'::jsonb;
      IF zone IS NULL OR item->'tarifa' IS DISTINCT FROM zone->'tarifa' OR item->>'zonaTarifaNombre' IS DISTINCT FROM zone->>'nombre' THEN
        RAISE EXCEPTION 'TARIFF_QUOTE_CHANGED' USING ERRCODE='23514';
      END IF;
      pct := COALESCE((NEW.data::jsonb#>>'{gohouse-data,config,porcentajeCasa}')::numeric,17.14);
      IF pct < 0 OR pct > 100 THEN RAISE EXCEPTION 'TARIFF_INVALID_COMMISSION' USING ERRCODE='23514'; END IF;
      fee := (zone->>'tarifa')::numeric; house := round(fee*pct/100);
      item := item || jsonb_build_object('tarifaFijada',true,'porcentajeCasaSnapshot',pct,'comisionCasa',house,'gananciaDomiciliario',fee-house);
      enriched := true;
    ELSIF previous IS NOT NULL AND item->'tarifaFijada'='true'::jsonb THEN
      -- Legacy orders keep their pre-release workflow; never reprice them retroactively.
      RAISE EXCEPTION 'TARIFF_LEGACY_ORDER' USING ERRCODE='23514';
    END IF;
    result_orders := result_orders || jsonb_build_array(item);
  END LOOP;
  IF enriched THEN NEW.data := jsonb_set(NEW.data::jsonb,'{gohouse-data,orders}',result_orders,true); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gohouse_tariff_contract_guard ON app_state;
CREATE TRIGGER gohouse_tariff_contract_guard BEFORE UPDATE OF data ON app_state
FOR EACH ROW EXECUTE FUNCTION gohouse_tariff_contract();
COMMIT;
