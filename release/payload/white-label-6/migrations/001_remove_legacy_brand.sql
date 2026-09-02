UPDATE app_state
SET data = jsonb_set(
  jsonb_set(
    data,
    ARRAY['gohouse-data','config','brandName'],
    to_jsonb('Domicilios'::text),
    true
  ),
  ARRAY['gohouse-data','config','shortName'],
  to_jsonb('Domicilios'::text),
  true
)
WHERE id = 1
  AND regexp_replace(
        lower(coalesce(data #>> ARRAY['gohouse-data','config','brandName'], '')),
        '[^a-z0-9]+', '', 'g'
      ) = 'gohouse';
