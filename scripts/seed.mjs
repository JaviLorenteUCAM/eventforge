#!/usr/bin/env node
/**
 * ============================================================================
 * EventForge · Semilla de datos
 * ----------------------------------------------------------------------------
 * Crea en tu proyecto de Supabase:
 *
 *   1. Los cuatro perfiles del equipo (usuarios reales de Supabase Auth).
 *   2. Un almacén de ejemplo: material, categorías y cajas con contenido.
 *   3. "Evento Demo 2026" completo: plano con objetos y cableado (con errores
 *      intencionados para ver el detector de incidencias), horarios, tareas y
 *      una carga de transporte.
 *
 * Uso:
 *     npm run seed              (crea lo que falte, no duplica nada)
 *     npm run seed -- --reset   (borra antes el evento demo y lo vuelve a crear)
 *     npm run seed -- --users   (solo los perfiles, sin datos demo)
 *
 * Requiere en .env:
 *     SUPABASE_URL
 *     SUPABASE_SERVICE_ROLE_KEY   <- Project Settings > API Keys > service_role
 *
 * La service_role key salta el RLS: se usa SOLO aquí, en tu ordenador.
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';

// --- Carga de .env sin dependencias externas --------------------------------
try {
  process.loadEnvFile('.env');
} catch {
  // Sin fichero .env: se usarán las variables del sistema.
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const RESET = args.includes('--reset');
const ONLY_USERS = args.includes('--users');

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};
const ok = (m) => console.log(`${c.green}✓${c.reset} ${m}`);
const info = (m) => console.log(`${c.cyan}·${c.reset} ${m}`);
const warn = (m) => console.log(`${c.yellow}!${c.reset} ${m}`);
const step = (m) => console.log(`\n${c.bold}${m}${c.reset}`);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(`${c.red}✗ Faltan variables de entorno.${c.reset}

Crea un fichero .env en la raíz del proyecto con:

  SUPABASE_URL=https://TU-PROYECTO.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJ...

Los valores están en Supabase → Project Settings → API Keys.
`);
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EVENT_NAME = 'Evento Demo 2026';

// UUIDs del catálogo base creado por supabase/migrations/0003_catalog.sql
const CAT = {
  electrico: 'a0000000-0000-4000-8000-000000000001',
  redes: 'a0000000-0000-4000-8000-000000000002',
  mobiliario: 'a0000000-0000-4000-8000-000000000003',
  av: 'a0000000-0000-4000-8000-000000000004',
  decoracion: 'a0000000-0000-4000-8000-000000000005',
  herramientas: 'a0000000-0000-4000-8000-000000000006',
};
const OBJ = {
  mesa: 'c0000000-0000-4000-8000-000000000001',
  silla: 'c0000000-0000-4000-8000-000000000003',
  barra: 'c0000000-0000-4000-8000-000000000005',
  mostrador: 'c0000000-0000-4000-8000-000000000007',
  pc: 'c0000000-0000-4000-8000-000000000010',
  monitor: 'c0000000-0000-4000-8000-000000000011',
  pantalla: 'c0000000-0000-4000-8000-000000000012',
  proyector: 'c0000000-0000-4000-8000-000000000013',
  altavoz: 'c0000000-0000-4000-8000-000000000014',
  cuadro: 'c0000000-0000-4000-8000-000000000020',
  toma: 'c0000000-0000-4000-8000-000000000021',
  regleta6: 'c0000000-0000-4000-8000-000000000022',
  regleta4: 'c0000000-0000-4000-8000-000000000023',
  alarg10: 'c0000000-0000-4000-8000-000000000024',
  alarg25: 'c0000000-0000-4000-8000-000000000025',
  switch8: 'c0000000-0000-4000-8000-000000000030',
  switch24: 'c0000000-0000-4000-8000-000000000031',
  router: 'c0000000-0000-4000-8000-000000000032',
  puntoRed: 'c0000000-0000-4000-8000-000000000034',
  planta: 'c0000000-0000-4000-8000-000000000040',
  photocall: 'c0000000-0000-4000-8000-000000000041',
};
const VEHICLE_TRANSIT = 'b0000000-0000-4000-8000-000000000002';

const PEOPLE = [
  { slug: 'juan', name: 'Juan Martín', role: 'Producción', color: '#6366f1', admin: true },
  { slug: 'maria', name: 'María López', role: 'Técnica', color: '#22d3ee', admin: false },
  { slug: 'pedro', name: 'Pedro Ruiz', role: 'Organización', color: '#f59e0b', admin: false },
  { slug: 'ana', name: 'Ana Torres', role: 'Diseño', color: '#f472b6', admin: false },
];

function randomPassword() {
  return `Ef-${crypto.randomUUID()}`;
}

function must(result, context) {
  if (result.error) {
    console.error(`${c.red}✗ ${context}${c.reset}\n  ${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// 1. PERFILES
// ---------------------------------------------------------------------------
async function seedProfiles() {
  step('1. Perfiles del equipo');

  const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) {
    console.error(`${c.red}✗ No se ha podido consultar la lista de usuarios: ${error.message}${c.reset}`);
    process.exit(1);
  }
  const byEmail = new Map(list.users.map((u) => [u.email, u]));
  const ids = {};

  for (const [index, person] of PEOPLE.entries()) {
    const email = `${person.slug}@eventforge.invalid`;
    let user = byEmail.get(email);

    if (!user) {
      const created = await db.auth.admin.createUser({
        email,
        password: randomPassword(),
        email_confirm: true,
        user_metadata: { name: person.name },
      });
      if (created.error) {
        console.error(`${c.red}✗ No se ha podido crear ${email}: ${created.error.message}${c.reset}`);
        process.exit(1);
      }
      user = created.data.user;
      ok(`Usuario creado · ${person.name} (${email})`);
    } else {
      info(`Usuario ya existía · ${person.name}`);
    }

    ids[person.slug] = user.id;

    must(
      await db.from('profiles').upsert(
        {
          id: user.id,
          name: person.name,
          role_title: person.role,
          color: person.color,
          is_active: true,
          is_admin: person.admin,
          sort_order: index * 10,
        },
        { onConflict: 'id' },
      ),
      `Guardar el perfil de ${person.name}`,
    );
  }

  ok(`${PEOPLE.length} perfiles listos`);
  return ids;
}

// ---------------------------------------------------------------------------
// 2. ALMACÉN
// ---------------------------------------------------------------------------
const ITEMS = [
  ['Mesa rectangular 2 m', CAT.mobiliario, OBJ.mesa, 14, 'ud', 2, 0.8, 0.75, 18, 'Nave A · Estante 1', 'MOB-MES-200'],
  ['Silla plegable', CAT.mobiliario, OBJ.silla, 80, 'ud', 0.45, 0.45, 0.9, 4.5, 'Nave A · Estante 2', 'MOB-SIL-001'],
  ['Mostrador recepción', CAT.mobiliario, OBJ.mostrador, 2, 'ud', 1.8, 0.7, 1.05, 40, 'Nave A · Suelo', 'MOB-MOS-180'],
  ['PC sobremesa', CAT.av, OBJ.pc, 6, 'ud', 0.2, 0.45, 0.45, 9, 'Nave B · Rack 1', 'AV-PC-001'],
  ['Monitor 27"', CAT.av, OBJ.monitor, 8, 'ud', 0.62, 0.2, 0.48, 5, 'Nave B · Rack 1', 'AV-MON-027'],
  ['Pantalla 55"', CAT.av, OBJ.pantalla, 3, 'ud', 1.24, 0.08, 0.72, 18, 'Nave B · Suelo', 'AV-PAN-055'],
  ['Proyector', CAT.av, OBJ.proyector, 2, 'ud', 0.38, 0.3, 0.12, 6, 'Nave B · Rack 2', 'AV-PRO-001'],
  ['Altavoz activo', CAT.av, OBJ.altavoz, 4, 'ud', 0.35, 0.32, 0.6, 14, 'Nave B · Suelo', 'AV-ALT-001'],
  ['Cuadro eléctrico', CAT.electrico, OBJ.cuadro, 2, 'ud', 0.4, 0.2, 0.6, 12, 'Nave C · Estante 1', 'ELE-CUA-001'],
  ['Regleta 6 tomas', CAT.electrico, OBJ.regleta6, 6, 'ud', 0.4, 0.06, 0.05, 0.6, 'Nave C · Caja CABLES-01', 'ELE-REG-006'],
  ['Regleta 4 tomas', CAT.electrico, OBJ.regleta4, 4, 'ud', 0.3, 0.06, 0.05, 0.45, 'Nave C · Caja CABLES-01', 'ELE-REG-004'],
  ['Alargadera 10 m', CAT.electrico, OBJ.alarg10, 5, 'ud', 0.25, 0.25, 0.12, 2.2, 'Nave C · Caja CABLES-01', 'ELE-ALA-010'],
  ['Alargadera 25 m', CAT.electrico, OBJ.alarg25, 2, 'ud', 0.3, 0.3, 0.15, 4.5, 'Nave C · Suelo', 'ELE-ALA-025'],
  ['Manguera 3G1.5', CAT.electrico, null, 120, 'm', 0, 0, 0, 0.1, 'Nave C · Bobina 1', 'ELE-CAB-315'],
  ['Switch 8 puertos', CAT.redes, OBJ.switch8, 2, 'ud', 0.2, 0.12, 0.04, 0.6, 'Nave B · Rack 2', 'RED-SWI-008'],
  ['Switch 24 puertos', CAT.redes, OBJ.switch24, 1, 'ud', 0.44, 0.2, 0.044, 3.2, 'Nave B · Rack 2', 'RED-SWI-024'],
  ['Router', CAT.redes, OBJ.router, 1, 'ud', 0.25, 0.18, 0.05, 0.9, 'Nave B · Rack 2', 'RED-ROU-001'],
  ['Punto de red', CAT.redes, OBJ.puntoRed, 10, 'ud', 0.1, 0.05, 0.1, 0.2, 'Nave C · Caja CABLES-01', 'RED-PUN-001'],
  ['Cat6 U/UTP', CAT.redes, null, 200, 'm', 0, 0, 0, 0.04, 'Nave C · Bobina 2', 'RED-CAB-CAT6'],
  ['Planta decorativa', CAT.decoracion, OBJ.planta, 6, 'ud', 0.6, 0.6, 1.4, 12, 'Nave A · Suelo', 'DEC-PLA-001'],
  ['Photocall 3×2,4 m', CAT.decoracion, OBJ.photocall, 1, 'ud', 3, 0.4, 2.4, 28, 'Nave A · Suelo', 'DEC-PHO-300'],
  ['Caja de herramientas', CAT.herramientas, null, 2, 'ud', 0.5, 0.25, 0.25, 11, 'Nave C · Estante 2', 'HER-CAJ-001'],
];

async function seedWarehouse() {
  step('2. Almacén');

  const existing = must(await db.from('warehouse_items').select('id, name'), 'Leer el almacén');
  const byName = new Map(existing.map((i) => [i.name, i.id]));
  const itemIds = {};

  for (const [name, categoryId, catalogId, qty, unit, l, w, h, kg, location, code] of ITEMS) {
    if (byName.has(name)) {
      itemIds[name] = byName.get(name);
      continue;
    }
    const row = must(
      await db
        .from('warehouse_items')
        .insert({
          name,
          category_id: categoryId,
          catalog_id: catalogId,
          quantity: qty,
          unit,
          length_m: l,
          width_m: w,
          height_m: h,
          weight_kg: kg,
          location,
          internal_code: code,
        })
        .select('id')
        .single(),
      `Crear material "${name}"`,
    );
    itemIds[name] = row.id;
  }
  ok(`${Object.keys(itemIds).length} referencias de material`);

  // --- Cajas ---------------------------------------------------------------
  const BOXES = [
    {
      code: 'CABLES-01',
      name: 'Cables y regletas',
      length_m: 0.6,
      width_m: 0.4,
      height_m: 0.4,
      empty_weight_kg: 3,
      color: '#f59e0b',
      location: 'Nave C · Estante 1',
      content: [
        ['Regleta 6 tomas', 4],
        ['Alargadera 10 m', 4],
        ['Punto de red', 8],
      ],
    },
    {
      code: 'TECNICA-01',
      name: 'Electrónica de red',
      length_m: 0.8,
      width_m: 0.6,
      height_m: 0.5,
      empty_weight_kg: 5,
      color: '#22d3ee',
      location: 'Nave B · Estante 3',
      content: [
        ['Switch 8 puertos', 2],
        ['Router', 1],
        ['Monitor 27"', 2],
      ],
    },
    {
      code: 'DECO-01',
      name: 'Decoración pequeña',
      length_m: 0.6,
      width_m: 0.4,
      height_m: 0.4,
      empty_weight_kg: 2.5,
      color: '#4ade80',
      location: 'Nave A · Estante 4',
      content: [['Caja de herramientas', 1]],
    },
  ];

  const existingBoxes = must(await db.from('warehouse_boxes').select('id, code'), 'Leer cajas');
  const boxByCode = new Map(existingBoxes.map((b) => [b.code, b.id]));

  for (const box of BOXES) {
    let boxId = boxByCode.get(box.code);
    if (!boxId) {
      const { content, ...fields } = box;
      const created = must(
        await db.from('warehouse_boxes').insert(fields).select('id').single(),
        `Crear caja ${box.code}`,
      );
      boxId = created.id;

      for (const [itemName, qty] of content) {
        if (!itemIds[itemName]) continue;
        must(
          await db
            .from('warehouse_box_items')
            .insert({ box_id: boxId, item_id: itemIds[itemName], quantity: qty }),
          `Añadir ${itemName} a ${box.code}`,
        );
      }
      ok(`Caja ${box.code} con ${content.length} referencias`);
    } else {
      info(`Caja ${box.code} ya existía`);
    }
  }

  return itemIds;
}

// ---------------------------------------------------------------------------
// 3. EVENTO DEMO
// ---------------------------------------------------------------------------
async function seedDemoEvent(profileIds, itemIds) {
  step('3. Evento demo');

  const previous = must(
    await db.from('events').select('id').eq('name', EVENT_NAME),
    'Buscar el evento demo',
  );

  if (previous.length && !RESET) {
    warn(`"${EVENT_NAME}" ya existe. Usa "npm run seed -- --reset" para regenerarlo.`);
    return;
  }
  if (previous.length && RESET) {
    must(
      await db
        .from('events')
        .delete()
        .in('id', previous.map((e) => e.id)),
      'Borrar el evento demo anterior',
    );
    info('Evento demo anterior eliminado');
  }

  // Fechas: siempre en el futuro respecto a hoy.
  const start = new Date();
  start.setDate(start.getDate() + 25);
  start.setHours(8, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  end.setHours(20, 0, 0, 0);

  const event = must(
    await db
      .from('events')
      .insert({
        name: EVENT_NAME,
        description:
          'Evento de demostración con plano, cableado eléctrico y de red, horarios, tareas y transporte. Incluye errores intencionados para probar el detector de incidencias.',
        location: 'Madrid · IFEMA Pabellón 5',
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: 'preparation',
        color: '#6366f1',
        notes: 'Acceso de carga por la puerta 3. Montaje permitido desde las 07:00.',
        created_by: profileIds.juan,
      })
      .select('id')
      .single(),
    'Crear el evento demo',
  );

  must(
    await db.from('event_members').upsert(
      Object.values(profileIds).map((id) => ({
        event_id: event.id,
        profile_id: id,
        role: id === profileIds.juan ? 'owner' : 'member',
      })),
      { onConflict: 'event_id,profile_id' },
    ),
    'Asignar responsables',
  );
  ok('Evento creado con los 4 responsables');

  // --- Plano ---------------------------------------------------------------
  const plan = must(
    await db
      .from('plans')
      .insert({
        event_id: event.id,
        name: 'Planta principal',
        width_m: 20,
        depth_m: 14,
        height_m: 4,
        grid_size_m: 0.5,
        is_default: true,
      })
      .select('id')
      .single(),
    'Crear el plano',
  );

  // OJO: en una inserción múltiple, PostgREST unifica las columnas de todas las
  // filas y rellena con NULL las que falten en alguna (no aplica el DEFAULT de
  // la columna). Por eso cada objeto debe llevar SIEMPRE el juego completo de
  // campos, aunque solo unos pocos cambien respecto al valor por defecto.
  const OBJECT_DEFAULTS = {
    catalog_id: null,
    warehouse_item_id: null,
    label: '',
    kind: 'generic',
    category_id: null,
    x: 0,
    y: 0,
    z: 0,
    rotation: 0,
    length_m: 1,
    width_m: 1,
    height_m: 1,
    weight_kg: 0,
    color: '#94a3b8',
    shape: 'box',
    requires_power: false,
    requires_network: false,
    power_w: 0,
    outlet_count: 0,
    port_count: 0,
    locked: false,
    props: {},
  };

  const o = (key, extra) => ({
    id: crypto.randomUUID(),
    plan_id: plan.id,
    ...OBJECT_DEFAULTS,
    ...extra,
    _key: key,
  });

  const objects = [
    // Electricidad
    o('cuadro', {
      catalog_id: OBJ.cuadro, label: 'Cuadro eléctrico', kind: 'power_source', category_id: CAT.electrico,
      x: 1, y: 1, length_m: 0.4, width_m: 0.2, height_m: 0.6, weight_kg: 12, color: '#f59e0b',
      outlet_count: 8,
    }),
    o('toma', {
      catalog_id: OBJ.toma, label: 'Toma de pared', kind: 'power_source', category_id: CAT.electrico,
      x: 19, y: 1, length_m: 0.1, width_m: 0.05, height_m: 0.1, weight_kg: 0.2, color: '#fbbf24',
      outlet_count: 2,
    }),
    o('regletaA', {
      catalog_id: OBJ.regleta6, label: 'Regleta A (control)', kind: 'power_strip', category_id: CAT.electrico,
      x: 5, y: 5.5, length_m: 0.4, width_m: 0.06, height_m: 0.05, weight_kg: 0.6, color: '#fbbf24',
      outlet_count: 6,
    }),
    o('regletaB', {
      catalog_id: OBJ.regleta6, label: 'Regleta B (escenario)', kind: 'power_strip', category_id: CAT.electrico,
      x: 12, y: 4, length_m: 0.4, width_m: 0.06, height_m: 0.05, weight_kg: 0.6, color: '#fbbf24',
      outlet_count: 6,
    }),
    o('regletaC', {
      // ERROR INTENCIONADO: esta regleta no está conectada a ninguna fuente.
      catalog_id: OBJ.regleta4, label: 'Regleta C (photocall)', kind: 'power_strip', category_id: CAT.electrico,
      x: 4, y: 11.5, length_m: 0.3, width_m: 0.06, height_m: 0.05, weight_kg: 0.45, color: '#fbbf24',
      outlet_count: 4,
    }),

    // Red
    o('router', {
      catalog_id: OBJ.router, label: 'Router', kind: 'network_router', category_id: CAT.redes,
      x: 4.2, y: 5, length_m: 0.25, width_m: 0.18, height_m: 0.05, weight_kg: 0.9, color: '#0891b2',
      requires_power: true, power_w: 18, port_count: 4,
    }),
    o('switch', {
      catalog_id: OBJ.switch8, label: 'Switch principal', kind: 'network_switch', category_id: CAT.redes,
      x: 5.6, y: 5, length_m: 0.2, width_m: 0.12, height_m: 0.04, weight_kg: 0.6, color: '#22d3ee',
      requires_power: true, power_w: 12, port_count: 8,
    }),

    // Puesto de control
    o('mesaControl', {
      catalog_id: OBJ.mesa, label: 'Mesa de control', kind: 'furniture', category_id: CAT.mobiliario,
      x: 5, y: 6.6, length_m: 2, width_m: 0.8, height_m: 0.75, weight_kg: 18, color: '#a78bfa',
    }),
    o('pc1', {
      catalog_id: OBJ.pc, warehouse_item_id: itemIds['PC sobremesa'] ?? null,
      label: 'PC Control 01', kind: 'av', category_id: CAT.av,
      x: 4.4, y: 6.6, z: 0.75, length_m: 0.2, width_m: 0.45, height_m: 0.45, weight_kg: 9, color: '#f472b6',
      requires_power: true, requires_network: true, power_w: 350,
    }),
    o('pc2', {
      catalog_id: OBJ.pc, label: 'PC Control 02', kind: 'av', category_id: CAT.av,
      x: 5.6, y: 6.6, z: 0.75, length_m: 0.2, width_m: 0.45, height_m: 0.45, weight_kg: 9, color: '#f472b6',
      requires_power: true, requires_network: true, power_w: 350,
    }),
    o('monitor1', {
      catalog_id: OBJ.monitor, label: 'Monitor control', kind: 'av', category_id: CAT.av,
      x: 5, y: 6.2, z: 0.75, length_m: 0.62, width_m: 0.2, height_m: 0.48, weight_kg: 5, color: '#ec4899',
      requires_power: true, power_w: 45,
    }),

    // Escenario
    o('pantalla', {
      // ERROR INTENCIONADO: alimentada desde la regleta C (que no tiene corriente)
      // y sin ningún cable de red.
      catalog_id: OBJ.pantalla, label: 'Pantalla Principal', kind: 'av', category_id: CAT.av,
      x: 10, y: 1.4, length_m: 1.24, width_m: 0.08, height_m: 0.72, z: 1, weight_kg: 18, color: '#db2777',
      requires_power: true, requires_network: true, power_w: 120,
    }),
    o('proyector', {
      catalog_id: OBJ.proyector, label: 'Proyector sala', kind: 'av', category_id: CAT.av,
      x: 10, y: 7.5, z: 2.6, length_m: 0.38, width_m: 0.3, height_m: 0.12, weight_kg: 6, color: '#f472b6',
      requires_power: true, requires_network: true, power_w: 300,
    }),
    o('altavozL', {
      catalog_id: OBJ.altavoz, label: 'Altavoz izquierdo', kind: 'av', category_id: CAT.av,
      x: 8, y: 2, length_m: 0.35, width_m: 0.32, height_m: 0.6, weight_kg: 14, color: '#ec4899',
      requires_power: true, power_w: 250,
    }),
    o('altavozR', {
      catalog_id: OBJ.altavoz, label: 'Altavoz derecho', kind: 'av', category_id: CAT.av,
      x: 12, y: 2, length_m: 0.35, width_m: 0.32, height_m: 0.6, weight_kg: 14, color: '#ec4899',
      requires_power: true, power_w: 250,
    }),

    // Mobiliario de sala
    ...[
      [8, 9.5], [11, 9.5], [14, 9.5],
      [8, 11.5], [11, 11.5], [14, 11.5],
    ].map(([x, y], i) =>
      o(`mesa${i}`, {
        catalog_id: OBJ.mesa, warehouse_item_id: itemIds['Mesa rectangular 2 m'] ?? null,
        label: `Mesa ${i + 1}`, kind: 'furniture', category_id: CAT.mobiliario,
        x, y, length_m: 2, width_m: 0.8, height_m: 0.75, weight_kg: 18, color: '#a78bfa',
      }),
    ),
    ...Array.from({ length: 12 }, (_, i) =>
      o(`silla${i}`, {
        catalog_id: OBJ.silla, label: `Silla ${i + 1}`, kind: 'furniture', category_id: CAT.mobiliario,
        x: 7.2 + (i % 6) * 1.5, y: i < 6 ? 8.6 : 10.6,
        length_m: 0.45, width_m: 0.45, height_m: 0.9, weight_kg: 4.5, color: '#8b5cf6',
      }),
    ),

    // Recepción y decoración
    o('mostrador', {
      catalog_id: OBJ.mostrador, label: 'Recepción', kind: 'furniture', category_id: CAT.mobiliario,
      x: 2.5, y: 2.5, rotation: 90, length_m: 1.8, width_m: 0.7, height_m: 1.05, weight_kg: 40, color: '#a78bfa',
    }),
    o('photocall', {
      catalog_id: OBJ.photocall, label: 'Photocall entrada', kind: 'decor', category_id: CAT.decoracion,
      x: 3, y: 12.5, length_m: 3, width_m: 0.4, height_m: 2.4, weight_kg: 28, color: '#22c55e',
    }),
    o('planta1', {
      catalog_id: OBJ.planta, label: 'Planta 1', kind: 'decor', category_id: CAT.decoracion, shape: 'cylinder',
      x: 1.2, y: 6, length_m: 0.6, width_m: 0.6, height_m: 1.4, weight_kg: 12, color: '#4ade80',
    }),
    o('planta2', {
      catalog_id: OBJ.planta, label: 'Planta 2', kind: 'decor', category_id: CAT.decoracion, shape: 'cylinder',
      x: 18.5, y: 6, length_m: 0.6, width_m: 0.6, height_m: 1.4, weight_kg: 12, color: '#4ade80',
    }),
  ];

  const byKey = Object.fromEntries(objects.map((obj) => [obj._key, obj.id]));
  must(
    await db.from('plan_objects').insert(objects.map(({ _key, ...row }) => row)),
    'Crear los objetos del plano',
  );
  ok(`${objects.length} objetos colocados en el plano`);

  // --- Cableado ------------------------------------------------------------
  const power = (from, to, length) => ({
    plan_id: plan.id, kind: 'power', from_object_id: byKey[from], to_object_id: byKey[to],
    cable_type: 'Manguera 3G1.5', length_m: length, color: '#f59e0b',
  });
  const net = (from, to, length) => ({
    plan_id: plan.id, kind: 'network', from_object_id: byKey[from], to_object_id: byKey[to],
    cable_type: 'Cat6 U/UTP', length_m: length, color: '#22d3ee',
  });

  const connections = [
    // Correcto: el cuadro alimenta las regletas A y B
    power('cuadro', 'regletaA', 8),
    power('cuadro', 'regletaB', 14),
    // Correcto: la regleta A da corriente al puesto de control
    power('regletaA', 'pc1', 2),
    power('regletaA', 'pc2', 2),
    power('regletaA', 'monitor1', 2),
    power('regletaA', 'switch', 1.5),
    power('regletaA', 'router', 1.5),
    // Correcto: la regleta B alimenta el escenario
    power('regletaB', 'proyector', 6),
    power('regletaB', 'altavozL', 5),
    power('regletaB', 'altavozR', 5),
    // ERROR INTENCIONADO: la pantalla cuelga de la regleta C, que no recibe corriente
    power('regletaC', 'pantalla', 12),

    // Red correcta
    net('router', 'switch', 1),
    net('switch', 'pc1', 3),
    net('switch', 'pc2', 3),
    net('switch', 'proyector', 12),
    // ERROR INTENCIONADO: la pantalla necesita red y no tiene ningún cable
  ];

  must(await db.from('plan_connections').insert(connections), 'Crear el cableado');
  ok(`${connections.length} cables (2 incidencias intencionadas para la demo)`);

  // --- Horarios ------------------------------------------------------------
  const dayRows = [0, 1, 2].map((i) => {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    return {
      event_id: event.id,
      day_index: i + 1,
      date: date.toISOString().slice(0, 10),
      label: ['Día 1 · Montaje', 'Día 2 · Pruebas', 'Día 3 · Evento'][i],
    };
  });
  const days = must(
    await db.from('schedule_days').insert(dayRows).select('id, day_index'),
    'Crear los días',
  );
  const dayId = Object.fromEntries(days.map((d) => [d.day_index, d.id]));

  const ACTIVITIES = [
    [1, 'Carga en almacén', '07:00', '09:00', '#f59e0b', ['juan', 'pedro']],
    [1, 'Viaje a Madrid', '09:00', '12:00', '#64748b', ['juan']],
    [1, 'Montaje de estructura', '13:00', '18:00', '#6366f1', ['juan', 'pedro', 'ana']],
    [2, 'Montaje técnico', '09:00', '14:00', '#22d3ee', ['maria']],
    [2, 'Cableado y pruebas', '15:00', '18:00', '#22d3ee', ['maria', 'juan']],
    [3, 'Apertura y evento', '09:00', '19:00', '#34d399', ['juan', 'maria', 'pedro', 'ana']],
    [3, 'Desmontaje', '19:00', '23:00', '#f472b6', ['juan', 'pedro']],
  ];

  for (const [day, title, from, to, color, people] of ACTIVITIES) {
    const activity = must(
      await db
        .from('schedule_activities')
        .insert({
          event_id: event.id,
          day_id: dayId[day],
          title,
          starts_at: from,
          ends_at: to,
          color,
          description: '',
        })
        .select('id')
        .single(),
      `Crear la actividad "${title}"`,
    );
    must(
      await db.from('schedule_activity_members').insert(
        people.map((slug) => ({ activity_id: activity.id, profile_id: profileIds[slug] })),
      ),
      `Asignar responsables a "${title}"`,
    );
  }
  ok(`3 días y ${ACTIVITIES.length} actividades`);

  // --- Tareas --------------------------------------------------------------
  const dueIn = (days2) => {
    const d = new Date();
    d.setDate(d.getDate() + days2);
    return d.toISOString().slice(0, 10);
  };

  const TASKS = [
    ['Preparar cableado eléctrico', 'Revisar mangueras y regletas. Faltan 2 regletas de 6 tomas.', 'maria', 'high', 'pending', 5],
    ['Revisar material audiovisual', 'Comprobar proyector y pantalla antes de cargar.', 'maria', 'urgent', 'in_progress', 3],
    ['Preparar transporte', 'Reservar furgoneta L2H2 y preparar cajas.', 'pedro', 'high', 'pending', 7],
    ['Confirmar acceso al recinto', 'Puerta 3, montaje desde las 07:00.', 'juan', 'medium', 'done', -2],
    ['Diseñar photocall', 'Enviar arte final a imprenta.', 'ana', 'medium', 'done', -5],
    ['Solicitar acreditaciones', 'Listado de 4 personas.', 'pedro', 'low', 'pending', 10],
    ['Comprar regletas que faltan', 'Se necesitan 2 regletas de 6 tomas adicionales.', 'juan', 'high', 'pending', 4],
    ['Plan de desmontaje', 'Repartir tareas del día 3.', 'juan', 'low', 'pending', 20],
  ];

  must(
    await db.from('tasks').insert(
      TASKS.map(([title, description, slug, priority, status, due], index) => ({
        event_id: event.id,
        title,
        description,
        assignee_id: profileIds[slug],
        priority,
        status,
        due_date: dueIn(due),
        position: index,
        created_by: profileIds.juan,
      })),
    ),
    'Crear las tareas',
  );
  ok(`${TASKS.length} tareas`);

  // --- Transporte ----------------------------------------------------------
  const load = must(
    await db
      .from('transport_loads')
      .insert({
        event_id: event.id,
        vehicle_id: VEHICLE_TRANSIT,
        name: 'Carga 1 · Furgoneta',
        notes: 'Cargar primero las mesas al fondo; las cajas van encima.',
      })
      .select('id')
      .single(),
    'Crear la carga de transporte',
  );

  const boxes = must(
    await db.from('warehouse_boxes').select('id, code, length_m, width_m, height_m, empty_weight_kg, color'),
    'Leer las cajas para el transporte',
  );
  const boxByCode = Object.fromEntries(boxes.map((b) => [b.code, b]));

  const cargo = [];
  // Cuatro mesas al fondo, tumbadas.
  for (let i = 0; i < 4; i++) {
    cargo.push({
      load_id: load.id, source_kind: 'item', item_id: itemIds['Mesa rectangular 2 m'] ?? null,
      label: `Mesa ${i + 1}`, quantity: 1,
      x: 0, y: 0, z: i * 0.1, rotation: 90,
      length_m: 2, width_m: 0.8, height_m: 0.1, weight_kg: 18, color: '#a78bfa',
    });
  }
  // Cajas apiladas.
  let cursor = 0;
  for (const code of ['CABLES-01', 'TECNICA-01', 'DECO-01']) {
    const box = boxByCode[code];
    if (!box) continue;
    cargo.push({
      load_id: load.id, source_kind: 'box', box_id: box.id, label: box.code, quantity: 1,
      x: cursor, y: 0.9, z: 0, rotation: 0,
      length_m: Number(box.length_m), width_m: Number(box.width_m), height_m: Number(box.height_m),
      weight_kg: Number(box.empty_weight_kg) + 12, color: box.color,
    });
    cursor += Number(box.length_m) + 0.02;
  }
  // Photocall de pie contra el lateral.
  cargo.push({
    load_id: load.id, source_kind: 'item', item_id: itemIds['Photocall 3×2,4 m'] ?? null,
    label: 'Photocall', quantity: 1,
    x: 0, y: 1.45, z: 0, rotation: 90,
    length_m: 3, width_m: 0.4, height_m: 0.25, weight_kg: 28, color: '#22c55e',
  });

  // Mismo motivo que en plan_objects: todas las filas con las mismas columnas.
  const CARGO_DEFAULTS = {
    item_id: null,
    box_id: null,
    label: '',
    quantity: 1,
    x: 0,
    y: 0,
    z: 0,
    rotation: 0,
    weight_kg: 0,
    color: '#38bdf8',
  };

  must(
    await db.from('transport_items').insert(cargo.map((c) => ({ ...CARGO_DEFAULTS, ...c }))),
    'Crear los bultos de la carga',
  );
  ok(`Carga con ${cargo.length} bultos`);
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`${c.bold}EventForge · semilla de datos${c.reset}`);
  console.log(`${c.dim}Proyecto: ${SUPABASE_URL}${c.reset}`);

  // Comprobamos que las migraciones están aplicadas.
  const check = await db.from('object_catalog').select('id').limit(1);
  if (check.error) {
    console.error(`\n${c.red}✗ No se puede leer la tabla object_catalog.${c.reset}
  Aplica primero las migraciones de supabase/migrations/ en el SQL Editor
  de Supabase (0001, 0002, 0003 y 0004, en ese orden).

  Detalle: ${check.error.message}\n`);
    process.exit(1);
  }
  if (!check.data?.length) {
    console.error(`\n${c.red}✗ La biblioteca de objetos está vacía.${c.reset}
  Ejecuta supabase/migrations/0003_catalog.sql antes de sembrar los datos.\n`);
    process.exit(1);
  }

  const profileIds = await seedProfiles();

  if (ONLY_USERS) {
    console.log(`\n${c.green}${c.bold}Listo.${c.reset} Perfiles creados.\n`);
    return;
  }

  const itemIds = await seedWarehouse();
  await seedDemoEvent(profileIds, itemIds);

  console.log(`\n${c.green}${c.bold}✓ Semilla completada.${c.reset}`);
  console.log(`
${c.bold}Siguiente paso${c.reset}
  1. Configura el secreto ACCESS_CODE de la Edge Function "access"
     (Supabase → Edge Functions → access → Secrets), o con el CLI:

       npx supabase secrets set ACCESS_CODE=tu-codigo

  2. Abre la aplicación, introduce ese código y elige tu perfil.

${c.dim}Los perfiles no tienen contraseña: la sesión se emite desde el servidor
tras validar el código de acceso.${c.reset}
`);
}

main().catch((err) => {
  console.error(`${c.red}✗ Error inesperado:${c.reset}`, err);
  process.exit(1);
});
