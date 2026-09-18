-- ============================================================================
-- EventForge · 0003_catalog.sql
-- Datos de sistema: categorias de material + biblioteca base de objetos.
-- Idempotente: usa UUIDs deterministas y ON CONFLICT DO UPDATE.
-- (Los datos DEMO del evento se generan con `npm run seed`.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Categorias de material
-- ---------------------------------------------------------------------------
insert into public.material_categories (id, name, slug, color, icon, sort_order) values
  ('a0000000-0000-4000-8000-000000000001', 'Eléctrico',   'electrico',   '#f59e0b', 'zap',        10),
  ('a0000000-0000-4000-8000-000000000002', 'Redes',       'redes',       '#22d3ee', 'network',    20),
  ('a0000000-0000-4000-8000-000000000003', 'Mobiliario',  'mobiliario',  '#a78bfa', 'armchair',   30),
  ('a0000000-0000-4000-8000-000000000004', 'Audiovisual', 'audiovisual', '#f472b6', 'monitor',    40),
  ('a0000000-0000-4000-8000-000000000005', 'Decoración',  'decoracion',  '#4ade80', 'sparkles',   50),
  ('a0000000-0000-4000-8000-000000000006', 'Herramientas','herramientas','#94a3b8', 'wrench',     60),
  ('a0000000-0000-4000-8000-000000000007', 'Otros',       'otros',       '#64748b', 'package',    70)
on conflict (id) do update set
  name = excluded.name, slug = excluded.slug, color = excluded.color,
  icon = excluded.icon, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Biblioteca base de objetos (is_system = true)
--   length_m = largo (eje X)  ·  width_m = fondo (eje Y)  ·  height_m = alto
-- ---------------------------------------------------------------------------
insert into public.object_catalog
  (id, name, category_id, kind, length_m, width_m, height_m, weight_kg, color,
   material, shape, requires_power, requires_network, power_w, outlet_count, port_count, is_system, notes)
values
  -- ---------------------------- MOBILIARIO ---------------------------------
  ('c0000000-0000-4000-8000-000000000001','Mesa rectangular 2 m','a0000000-0000-4000-8000-000000000003','furniture',
   2.000,0.800,0.750,18,'#a78bfa','Madera','box',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000002','Mesa redonda Ø1,6 m','a0000000-0000-4000-8000-000000000003','furniture',
   1.600,1.600,0.750,22,'#a78bfa','Madera','cylinder',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000003','Silla','a0000000-0000-4000-8000-000000000003','furniture',
   0.450,0.450,0.900,4.5,'#8b5cf6','Polipropileno','box',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000004','Sofá 2 plazas','a0000000-0000-4000-8000-000000000003','furniture',
   2.000,0.900,0.800,45,'#7c3aed','Tela','box',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000005','Barra 2 m','a0000000-0000-4000-8000-000000000003','furniture',
   2.000,0.600,1.100,35,'#9333ea','Melamina','box',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000006','Módulo tarima 2×1 m','a0000000-0000-4000-8000-000000000003','furniture',
   2.000,1.000,0.400,32,'#6d28d9','Aluminio','box',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000007','Mostrador recepción','a0000000-0000-4000-8000-000000000003','furniture',
   1.800,0.700,1.050,40,'#a78bfa','Melamina','box',false,false,0,0,0,true,''),

  -- --------------------------- AUDIOVISUAL ---------------------------------
  ('c0000000-0000-4000-8000-000000000010','PC sobremesa','a0000000-0000-4000-8000-000000000004','av',
   0.200,0.450,0.450,9,'#f472b6','Metal','box',true,true,350,0,0,true,'Requiere corriente y red'),
  ('c0000000-0000-4000-8000-000000000011','Monitor 27"','a0000000-0000-4000-8000-000000000004','av',
   0.620,0.200,0.480,5,'#ec4899','Plástico','box',true,false,45,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000012','Pantalla 55"','a0000000-0000-4000-8000-000000000004','av',
   1.240,0.080,0.720,18,'#db2777','Plástico','box',true,true,120,0,0,true,'Señalización digital'),
  ('c0000000-0000-4000-8000-000000000013','Proyector','a0000000-0000-4000-8000-000000000004','av',
   0.380,0.300,0.120,6,'#f472b6','Plástico','box',true,true,300,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000014','Altavoz activo','a0000000-0000-4000-8000-000000000004','av',
   0.350,0.320,0.600,14,'#ec4899','Madera','box',true,false,250,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000015','Portátil','a0000000-0000-4000-8000-000000000004','av',
   0.360,0.250,0.030,2,'#f9a8d4','Aluminio','box',true,true,90,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000016','Trípode pantalla','a0000000-0000-4000-8000-000000000004','av',
   0.700,0.700,1.600,9,'#be185d','Acero','box',false,false,0,0,0,true,''),

  -- --------------------------- ELECTRICIDAD --------------------------------
  ('c0000000-0000-4000-8000-000000000020','Cuadro eléctrico','a0000000-0000-4000-8000-000000000001','power_source',
   0.400,0.200,0.600,12,'#f59e0b','Metal','box',false,false,0,8,0,true,'Fuente de alimentación principal'),
  ('c0000000-0000-4000-8000-000000000021','Toma de pared','a0000000-0000-4000-8000-000000000001','power_source',
   0.100,0.050,0.100,0.2,'#fbbf24','PVC','box',false,false,0,2,0,true,'Punto de suministro del recinto'),
  ('c0000000-0000-4000-8000-000000000022','Regleta 6 tomas','a0000000-0000-4000-8000-000000000001','power_strip',
   0.400,0.060,0.050,0.6,'#fbbf24','PVC','box',false,false,0,6,0,true,''),
  ('c0000000-0000-4000-8000-000000000023','Regleta 4 tomas','a0000000-0000-4000-8000-000000000001','power_strip',
   0.300,0.060,0.050,0.45,'#fbbf24','PVC','box',false,false,0,4,0,true,''),
  ('c0000000-0000-4000-8000-000000000024','Alargadera 10 m','a0000000-0000-4000-8000-000000000001','power_strip',
   0.250,0.250,0.120,2.2,'#f97316','PVC','cylinder',false,false,0,1,0,true,''),
  ('c0000000-0000-4000-8000-000000000025','Alargadera 25 m','a0000000-0000-4000-8000-000000000001','power_strip',
   0.300,0.300,0.150,4.5,'#ea580c','PVC','cylinder',false,false,0,1,0,true,''),
  ('c0000000-0000-4000-8000-000000000026','Punto de luz LED','a0000000-0000-4000-8000-000000000001','generic',
   0.200,0.200,0.150,1.2,'#fde047','Aluminio','cylinder',true,false,50,0,0,true,''),

  -- ------------------------------- REDES -----------------------------------
  ('c0000000-0000-4000-8000-000000000030','Switch 8 puertos','a0000000-0000-4000-8000-000000000002','network_switch',
   0.200,0.120,0.040,0.6,'#22d3ee','Metal','box',true,false,12,0,8,true,''),
  ('c0000000-0000-4000-8000-000000000031','Switch 24 puertos','a0000000-0000-4000-8000-000000000002','network_switch',
   0.440,0.200,0.044,3.2,'#06b6d4','Metal','box',true,false,30,0,24,true,'Formato rack 1U'),
  ('c0000000-0000-4000-8000-000000000032','Router','a0000000-0000-4000-8000-000000000002','network_router',
   0.250,0.180,0.050,0.9,'#0891b2','Plástico','box',true,false,18,0,4,true,'Salida a Internet'),
  ('c0000000-0000-4000-8000-000000000033','Rack 6U','a0000000-0000-4000-8000-000000000002','generic',
   0.600,0.600,0.400,18,'#155e75','Metal','box',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000034','Punto de red','a0000000-0000-4000-8000-000000000002','network_node',
   0.100,0.050,0.100,0.2,'#67e8f9','PVC','box',false,false,0,0,1,true,''),
  ('c0000000-0000-4000-8000-000000000035','Punto de acceso WiFi','a0000000-0000-4000-8000-000000000002','network_node',
   0.200,0.200,0.040,0.4,'#22d3ee','Plástico','cylinder',true,true,15,0,0,true,''),

  -- ---------------------------- DECORACION ---------------------------------
  ('c0000000-0000-4000-8000-000000000040','Planta decorativa','a0000000-0000-4000-8000-000000000005','decor',
   0.600,0.600,1.400,12,'#4ade80','Natural','cylinder',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000041','Photocall 3×2,4 m','a0000000-0000-4000-8000-000000000005','decor',
   3.000,0.400,2.400,28,'#22c55e','Aluminio + lona','box',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000042','Alfombra 3×2 m','a0000000-0000-4000-8000-000000000005','decor',
   3.000,2.000,0.010,14,'#16a34a','Textil','plane',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000043','Cartel vertical','a0000000-0000-4000-8000-000000000005','decor',
   0.800,0.400,2.000,9,'#15803d','Aluminio','box',false,false,0,0,0,true,''),

  -- --------------------------- HERRAMIENTAS --------------------------------
  ('c0000000-0000-4000-8000-000000000050','Caja de herramientas','a0000000-0000-4000-8000-000000000006','tool',
   0.500,0.250,0.250,11,'#94a3b8','Metal','box',false,false,0,0,0,true,''),
  ('c0000000-0000-4000-8000-000000000051','Escalera 2 m','a0000000-0000-4000-8000-000000000006','tool',
   0.600,0.200,2.000,9,'#64748b','Aluminio','box',false,false,0,0,0,true,'')
on conflict (id) do update set
  name = excluded.name, category_id = excluded.category_id, kind = excluded.kind,
  length_m = excluded.length_m, width_m = excluded.width_m, height_m = excluded.height_m,
  weight_kg = excluded.weight_kg, color = excluded.color, material = excluded.material,
  shape = excluded.shape, requires_power = excluded.requires_power,
  requires_network = excluded.requires_network, power_w = excluded.power_w,
  outlet_count = excluded.outlet_count, port_count = excluded.port_count,
  is_system = true, notes = excluded.notes;

-- ---------------------------------------------------------------------------
-- Vehiculos plantilla
-- ---------------------------------------------------------------------------
insert into public.transport_vehicles
  (id, name, vehicle_type, length_m, width_m, height_m, max_weight_kg, is_template)
values
  ('b0000000-0000-4000-8000-000000000001','Furgoneta corta (Caddy)','van',   1.700,1.200,1.100,  650,true),
  ('b0000000-0000-4000-8000-000000000002','Furgoneta L2H2 (Transit)','van',  3.000,1.700,1.800, 1100,true),
  ('b0000000-0000-4000-8000-000000000003','Furgón 12 m³','truck',            4.100,1.900,1.900, 1400,true),
  ('b0000000-0000-4000-8000-000000000004','Camión 20 m³','truck',            6.000,2.400,2.400, 3500,true)
on conflict (id) do update set
  name = excluded.name, vehicle_type = excluded.vehicle_type,
  length_m = excluded.length_m, width_m = excluded.width_m, height_m = excluded.height_m,
  max_weight_kg = excluded.max_weight_kg, is_template = true;
