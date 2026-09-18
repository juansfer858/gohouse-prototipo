-- V29 · elimina el nombre comercial heredado de la configuración persistida.
-- Idempotente: sólo cambia campos que todavía contengan la marca anterior.
DO $$
DECLARE
  d jsonb;
  cfg jsonb;
BEGIN
  SELECT data INTO d FROM app_state WHERE id=1 FOR UPDATE;
  IF d IS NULL THEN RETURN; END IF;

  cfg := COALESCE(d #> '{gohouse-data,config}', '{}'::jsonb);
  IF cfg = '{}'::jsonb THEN RETURN; END IF;

  IF COALESCE(cfg->>'brandName','') ~* 'go!?[[:space:]]*house|gohouse' THEN
    cfg := jsonb_set(cfg,'{brandName}',to_jsonb('Domicilios Llanos'::text),true);
  END IF;
  IF COALESCE(cfg->>'shortName','') ~* 'go!?[[:space:]]*house|gohouse' THEN
    cfg := jsonb_set(cfg,'{shortName}',to_jsonb('Domicilios'::text),true);
  END IF;
  IF COALESCE(cfg->>'legalName','') ~* 'go!?[[:space:]]*house|gohouse' THEN
    cfg := jsonb_set(cfg,'{legalName}',to_jsonb('Domicilios Llanos'::text),true);
  END IF;
  IF COALESCE(cfg->>'supportText','') ~* 'go!?[[:space:]]*house|gohouse' THEN
    cfg := jsonb_set(cfg,'{supportText}',to_jsonb(regexp_replace(cfg->>'supportText','¡?GO!?[[:space:]]*HOUSE|GOHOUSE','Domicilios Llanos','gi')),true);
  END IF;

  d := jsonb_set(d,'{gohouse-data,config}',cfg,true);
  UPDATE app_state SET data=d, updated_at=NOW() WHERE id=1;
END $$;
