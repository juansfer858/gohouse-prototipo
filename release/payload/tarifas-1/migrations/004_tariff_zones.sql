UPDATE app_state
SET data = jsonb_set(
  data::jsonb,
  '{gohouse-data,config,tarifasZonas}',
  '[
    {"id":"estandar","nombre":"Servicio estándar","tarifa":4000,"activa":true,"predeterminada":true,"orden":1},
    {"id":"el-rocio","nombre":"El Rocío","tarifa":5000,"activa":true,"orden":2},
    {"id":"la-sonora","nombre":"La Sonora","tarifa":5000,"activa":true,"orden":3},
    {"id":"el-peaje","nombre":"El Peaje","tarifa":5000,"activa":true,"orden":4},
    {"id":"el-batallon","nombre":"El Batallón","tarifa":7000,"activa":true,"orden":5},
    {"id":"la-piedra","nombre":"La Piedra","tarifa":7000,"activa":true,"orden":6},
    {"id":"el-chaquiro","nombre":"El Chaquiro","tarifa":1000,"activa":true,"orden":7},
    {"id":"vallecitos","nombre":"Vallecitos","tarifa":17000,"activa":true,"orden":8},
    {"id":"santa-rosa","nombre":"Santa Rosa","tarifa":45000,"activa":true,"orden":9},
    {"id":"yarula","nombre":"Yarula","tarifa":50000,"activa":true,"orden":10},
    {"id":"san-jose","nombre":"San José","tarifa":45000,"activa":true,"orden":11}
  ]'::jsonb,
  true
),
version = version + 1,
updated_at = now()
WHERE id = 1
  AND (data::jsonb #> '{gohouse-data,config,tarifasZonas}') IS NULL;
