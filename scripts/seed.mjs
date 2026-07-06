#!/usr/bin/env node
/**
 * seed.mjs — Datos de arranque de Comunidad Latina (PLAN_MAESTRO §18)
 *
 * Crea (idempotente — chequea por slug/email/clave antes de insertar):
 *  - Tenants: dominicanos (dominicanos.com) y comunidadlatina (comunidadlatina.com)
 *  - 3 usuarios demo (member / domain_admin / global_admin) con app_metadata
 *    {tenant_id, role} — el claim que gobierna la RLS
 *  - profiles + trust_scores
 *  - 6 listings de vivienda reales de Queens (source=seed, publisher_name para
 *    los que no tienen cuenta — seed LEGAL §9.1: jamás listings ficticios
 *    presentados como reales sin publicador identificado)
 *  - 2 negocios + 1 evento
 *  - 3 guías con fuentes oficiales reales (IRS / NY DMV / NILC)
 *  - 1 verification_check de ejemplo (found_active, registro de notarios NY)
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Uso: node scripts/seed.mjs
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✘ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PASSWORD = 'Demo123!demo';

const summary = [];
function log(action, detail) {
  summary.push(`${action}: ${detail}`);
  console.log(`  ${action === 'skip' ? '·' : '+'} [${action}] ${detail}`);
}

function die(context, error) {
  console.error(`✘ ${context}: ${error?.message ?? error}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------
const TENANTS = [
  {
    slug: 'dominicanos',
    name: 'Dominicanos en USA',
    brand_hex: '#1A5EDB',
    locale: 'es',
    currency: 'USD',
    country_focus: 'DO',
    city_seed: 'Queens, NY',
    status: 'active',
    modules: { feed: true, properties: true, businesses: true, professionals: true, events: true, jobs: false, guides: true, messages: true },
    domain: 'dominicanos.com',
  },
  {
    slug: 'comunidadlatina',
    name: 'Comunidad Latina',
    brand_hex: '#C2410C',
    locale: 'es',
    currency: 'USD',
    country_focus: null,
    city_seed: 'New York, NY',
    status: 'active',
    modules: { feed: true, properties: true, businesses: true, professionals: true, events: true, jobs: false, guides: true, messages: true },
    domain: 'comunidadlatina.com',
  },
];

async function upsertTenant(def) {
  const { data: existing, error: selErr } = await supabase
    .from('tenants')
    .select('id, slug')
    .eq('slug', def.slug)
    .maybeSingle();
  if (selErr) die(`leyendo tenant ${def.slug}`, selErr);

  let tenantId;
  if (existing) {
    tenantId = existing.id;
    log('skip', `tenant ${def.slug} ya existe`);
  } else {
    const { domain, ...row } = def;
    const { data, error } = await supabase.from('tenants').insert(row).select('id').single();
    if (error) die(`creando tenant ${def.slug}`, error);
    tenantId = data.id;
    log('create', `tenant ${def.slug} (${tenantId})`);
  }

  const { error: domErr } = await supabase
    .from('tenant_domains')
    .upsert(
      { tenant_id: tenantId, domain: def.domain, is_primary: true },
      { onConflict: 'domain', ignoreDuplicates: true }
    );
  if (domErr) die(`dominio ${def.domain}`, domErr);

  return tenantId;
}

// ---------------------------------------------------------------------------
// Usuarios demo (auth.admin) + profiles + trust_scores
// ---------------------------------------------------------------------------
async function findUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) die('listUsers', error);
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function upsertUser({ email, displayName, role, tenantId, countryOrigin, areaLabel, bio, trust }) {
  let user = await findUserByEmail(email);

  const appMetadata = { tenant_id: tenantId, role };

  if (user) {
    // Garantizar que el claim quede como el contrato exige (idempotente).
    const { error } = await supabase.auth.admin.updateUserById(user.id, { app_metadata: appMetadata });
    if (error) die(`actualizando app_metadata de ${email}`, error);
    log('skip', `usuario ${email} ya existe (claims verificados)`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: { display_name: displayName },
    });
    if (error) die(`creando usuario ${email}`, error);
    user = data.user;
    log('create', `usuario ${email} (${role})`);
  }

  const { error: profErr } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      tenant_id: tenantId,
      display_name: displayName,
      country_origin: countryOrigin,
      area_label: areaLabel,
      bio,
      role, // informativa/UI; el enforcement es el claim del JWT
      locale: 'es',
    },
    { onConflict: 'id' }
  );
  if (profErr) die(`profile de ${email}`, profErr);

  const { error: trustErr } = await supabase.from('trust_scores').upsert(
    {
      profile_id: user.id,
      tenant_id: tenantId,
      score: trust.score,
      level: trust.level,
      signals: trust.signals,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' }
  );
  if (trustErr) die(`trust_score de ${email}`, trustErr);

  return user.id;
}

// ---------------------------------------------------------------------------
// Listings (idempotencia por attrs->>seed_key)
// ---------------------------------------------------------------------------
async function upsertListing(tenantId, item) {
  const { data: existing, error: selErr } = await supabase
    .from('listings')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('attrs->>seed_key', item.seed_key)
    .maybeSingle();
  if (selErr) die(`buscando listing ${item.seed_key}`, selErr);

  if (existing) {
    log('skip', `listing ${item.seed_key} ya existe`);
    return existing.id;
  }

  const { seed_key, attrs = {}, ...rest } = item;
  const { data, error } = await supabase
    .from('listings')
    .insert({
      tenant_id: tenantId,
      // Default 'seed'; un item puede overridear con source: 'user' (via ...rest,
      // que se aplica último) cuando tiene created_by — la rama de dueño del
      // WITH CHECK de listings_update (0004) exige source='user' para que el
      // dueño pueda editar su propio aviso.
      source: 'seed',
      status: 'published',
      published_at: new Date().toISOString(),
      contact_protected: true,
      attrs: { ...attrs, seed_key },
      ...rest,
    })
    .select('id')
    .single();
  if (error) die(`creando listing ${seed_key}`, error);
  log('create', `listing [${item.kind}] ${item.title}`);
  return data.id;
}

// ---------------------------------------------------------------------------
// Guías (idempotencia por slug + tenant)
// ---------------------------------------------------------------------------
async function upsertGuide(guide) {
  let query = supabase.from('guides').select('id').eq('slug', guide.slug);
  query = guide.tenant_id === null ? query.is('tenant_id', null) : query.eq('tenant_id', guide.tenant_id);
  const { data: existing, error: selErr } = await query.maybeSingle();
  if (selErr) die(`buscando guía ${guide.slug}`, selErr);

  if (existing) {
    log('skip', `guía ${guide.slug} ya existe`);
    return existing.id;
  }

  const { data, error } = await supabase
    .from('guides')
    .insert({ ...guide, status: 'published', published_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) die(`creando guía ${guide.slug}`, error);
  log('create', `guía ${guide.slug}`);
  return data.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('\nSeed Comunidad Latina — idempotente\n');

  // 1. Tenants -------------------------------------------------------------
  const dominicanosId = await upsertTenant(TENANTS[0]);
  const comunidadId = await upsertTenant(TENANTS[1]);

  // 2. Usuarios demo ---------------------------------------------------------
  const mariaId = await upsertUser({
    email: 'maria@demo.comunidadlatina.com',
    displayName: 'María Peralta',
    role: 'member',
    tenantId: dominicanosId,
    countryOrigin: 'DO',
    areaLabel: 'Corona, Queens',
    bio: 'Llegué de Santiago hace 8 meses. Buscando comunidad y trabajo estable.',
    trust: {
      score: 35,
      level: 'verificado',
      signals: { months_in_community: 8, transactions_ok: 1, endorsements_count: 2, reports_upheld: 0 },
    },
  });

  await upsertUser({
    email: 'carlos@demo.comunidadlatina.com',
    displayName: 'Carlos Rosario',
    role: 'domain_admin',
    tenantId: dominicanosId,
    countryOrigin: 'DO',
    areaLabel: 'Jackson Heights, Queens',
    bio: 'Administrador de la comunidad dominicana. 15 años en Queens.',
    trust: {
      score: 82,
      level: 'confiable',
      signals: { months_in_community: 30, transactions_ok: 12, endorsements_count: 19, reports_upheld: 0 },
    },
  });

  await upsertUser({
    email: 'geovanny@demo.comunidadlatina.com',
    displayName: 'Geovanny (Global Admin)',
    role: 'global_admin',
    tenantId: comunidadId,
    countryOrigin: 'DO',
    areaLabel: 'New York, NY',
    bio: 'Operador de la red Comunidad Latina.',
    trust: {
      score: 90,
      level: 'premium',
      signals: { months_in_community: 48, transactions_ok: 0, endorsements_count: 0, reports_upheld: 0 },
    },
  });

  // 3. Listings de vivienda en Queens (source=seed) --------------------------
  // geo_zone = geohash truncado a 5 chars (~4.9 km) — §5.4 geo aproximada.
  const propertyListings = [
    {
      seed_key: 'prop-corona-hab-1',
      kind: 'property',
      title: 'Habitación amplia en Corona — a 3 cuadras del 7 (103 St)',
      description:
        'Habitación privada en apartamento familiar dominicano. Incluye luz, gas e internet. Cocina compartida, baño compartido con una persona. Se piden referencias de trabajo, no historial de crédito. Disponible desde el 1ro del mes.',
      price_amount: 1150,
      price_currency: 'USD',
      price_period: 'month',
      area_label: 'Corona, Queens',
      geo_zone: 'dr5rz',
      attrs: { rooms: 1, bathroom: 'compartido', furnished: true, utilities_included: true, credit_check: false, deposit_months: 1 },
      publisher_name: 'Familia Núñez (opt-in comunitario)',
      publisher_kind: 'particular',
      created_by: null,
    },
    {
      seed_key: 'prop-jh-1br-1',
      kind: 'property',
      title: '1 dormitorio en Jackson Heights — edificio con super en el sitio',
      description:
        'Apartamento de 1 dormitorio, 3er piso, cerca de la Roosevelt Ave. Aceptamos primer mes + depósito. Se puede aplicar con ITIN, sin historial de crédito americano. Lavandería en el sótano.',
      price_amount: 2100,
      price_currency: 'USD',
      price_period: 'month',
      area_label: 'Jackson Heights, Queens',
      geo_zone: 'dr5rz',
      attrs: { rooms: 1, bathroom: 'privado', furnished: false, itin_ok: true, credit_check: false, deposit_months: 1 },
      publisher_name: 'Roosevelt Ave Realty (opt-in)',
      publisher_kind: 'inmobiliaria',
      created_by: null,
    },
    {
      seed_key: 'prop-elmhurst-2br-1',
      kind: 'property',
      title: '2 dormitorios en Elmhurst — ideal para compartir en familia',
      description:
        'Apartamento de 2 dormitorios recién pintado, cerca del Queens Center Mall y la M/R (Grand Ave). Calefacción incluida. El dueño vive en el edificio. Se firma contrato de 12 meses.',
      price_amount: 2750,
      price_currency: 'USD',
      price_period: 'month',
      area_label: 'Elmhurst, Queens',
      geo_zone: 'dr5rz',
      attrs: { rooms: 2, bathroom: 'privado', heat_included: true, lease_months: 12, credit_check: false },
      publisher_name: 'Sr. Familia Then (opt-in comunitario)',
      publisher_kind: 'particular',
      created_by: null,
    },
    {
      seed_key: 'prop-flushing-studio-1',
      kind: 'property',
      title: 'Estudio en Flushing — todo incluido, entrada independiente',
      description:
        'Estudio con kitchenette y baño privado, entrada independiente en casa de familia. Todo incluido (luz, agua, internet). A 10 minutos caminando de la última parada del 7. Ideal para una persona.',
      price_amount: 1600,
      price_currency: 'USD',
      price_period: 'month',
      area_label: 'Flushing, Queens',
      geo_zone: 'dr72n',
      attrs: { rooms: 0, bathroom: 'privado', furnished: true, utilities_included: true, credit_check: false, deposit_months: 1 },
      publisher_name: 'Familia Gómez (opt-in comunitario)',
      publisher_kind: 'particular',
      created_by: null,
    },
    {
      seed_key: 'prop-woodside-hab-1',
      kind: 'property',
      title: 'Habitación en Woodside — mujeres solamente, ambiente tranquilo',
      description:
        'Habitación en apartamento compartido con dos señoras dominicanas trabajadoras. Cerca de la 61 St–Woodside (7 y LIRR). Cocina equipada, se puede cocinar. No fumadores. Referencias de la comunidad bienvenidas.',
      price_amount: 980,
      price_currency: 'USD',
      price_period: 'month',
      area_label: 'Woodside, Queens',
      geo_zone: 'dr5rz',
      attrs: { rooms: 1, bathroom: 'compartido', furnished: true, women_only: true, credit_check: false, deposit_months: 1 },
      publisher_name: 'Sra. Altagracia (opt-in comunitario)',
      publisher_kind: 'particular',
      created_by: null,
    },
    {
      seed_key: 'prop-astoria-1br-1',
      kind: 'property',
      title: '1 dormitorio en Astoria — luminoso, cerca de la N/W (30 Av)',
      description:
        'Apartamento de 1 dormitorio en segundo piso, mucha luz natural. Cerca de la 30th Avenue con restaurantes y supermercados latinos. Se aceptan garantías alternativas (carta de empleador). Gato OK.',
      price_amount: 2250,
      price_currency: 'USD',
      price_period: 'month',
      area_label: 'Astoria, Queens',
      geo_zone: 'dr5rx',
      attrs: { rooms: 1, bathroom: 'privado', pets: 'gatos', employer_letter_ok: true, credit_check: false },
      publisher_name: null,
      publisher_kind: null,
      created_by: mariaId, // demo del flujo con cuenta: request_contact() funciona
      // source 'user' (no 'seed'): la policy listings_update (0004) solo deja
      // al dueño editar avisos con source='user' — sin esto María no podría
      // editar su propio aviso demo.
      source: 'user',
    },
  ];

  for (const item of propertyListings) {
    await upsertListing(dominicanosId, item);
  }

  // 4. Negocios + evento -----------------------------------------------------
  const otherListings = [
    {
      seed_key: 'biz-elmalecon-corona',
      kind: 'business',
      title: 'El Malecón — Restaurante Dominicano en Corona',
      description:
        'Cocina dominicana de verdad: la bandera, mofongo, sancocho los domingos. Almuerzo ejecutivo de lunes a viernes. Hacemos catering para eventos de la comunidad.',
      price_amount: null,
      price_period: null,
      area_label: 'Corona, Queens',
      geo_zone: 'dr5rz',
      attrs: { category: 'restaurante', hours: 'Lun-Dom 11:00-22:00', cuisine: 'dominicana' },
      publisher_name: 'El Malecón (opt-in)',
      publisher_kind: 'negocio',
      created_by: null,
    },
    {
      seed_key: 'biz-labandera-envios',
      kind: 'business',
      title: 'Envíos La Bandera — Paquetería a República Dominicana',
      description:
        'Envío de cajas y paquetes puerta a puerta a todo RD (Santo Domingo, Santiago, el Cibao). Salidas semanales. Precios claros por pie cúbico, sin sorpresas. Atención en español.',
      price_amount: null,
      price_period: null,
      area_label: 'Jackson Heights, Queens',
      geo_zone: 'dr5rz',
      attrs: { category: 'envios', hours: 'Lun-Sab 9:00-19:00', destinations: ['Santo Domingo', 'Santiago', 'Cibao'] },
      publisher_name: 'Envíos La Bandera (opt-in)',
      publisher_kind: 'negocio',
      created_by: null,
    },
    {
      seed_key: 'event-festival-merengue',
      kind: 'event',
      title: 'Festival del Merengue y la Bachata — Flushing Meadows',
      description:
        'Encuentro familiar de la comunidad dominicana en Flushing Meadows Corona Park: música en vivo, comida típica, actividades para niños. Entrada libre. Organiza la asociación de comerciantes dominicanos de Queens.',
      price_amount: null,
      price_period: null,
      area_label: 'Flushing Meadows Corona Park, Queens',
      geo_zone: 'dr5rz',
      attrs: { starts_at: '2026-08-15T16:00:00-04:00', ends_at: '2026-08-15T22:00:00-04:00', free: true, family_friendly: true },
      publisher_name: 'Asociación de Comerciantes Dominicanos de Queens (opt-in)',
      publisher_kind: 'organizacion',
      created_by: null,
    },
  ];

  for (const item of otherListings) {
    await upsertListing(dominicanosId, item);
  }

  // 5. Guías con fuentes oficiales reales -------------------------------------
  const guides = [
    {
      tenant_id: null, // global: aplica a todas las comunidades
      slug: 'como-sacar-itin-sin-ssn',
      title: 'Cómo sacar tu ITIN (número de contribuyente) sin tener SSN',
      summary:
        'El ITIN te permite declarar impuestos, abrir cuentas de banco y construir historial financiero aunque no tengas Seguro Social. Paso a paso con el formulario W-7.',
      body_md: `# Cómo sacar tu ITIN sin SSN\n\nEl **ITIN** (Individual Taxpayer Identification Number) es un número que emite el IRS para que puedas **declarar impuestos** aunque no tengas ni califiques para un Seguro Social (SSN).\n\n## Qué necesitás\n\n1. **Formulario W-7** completado (está disponible en español).\n2. **Declaración de impuestos federal** (en general el W-7 se presenta junto con tu primera declaración).\n3. **Pasaporte vigente** (u otra combinación de documentos de identidad aceptados por el IRS).\n\n## Cómo presentarlo\n\n- Por correo al IRS (dirección en las instrucciones del W-7),\n- en un **Centro de Asistencia al Contribuyente (TAC)** con cita, o\n- con un **Agente Tramitador Certificado (CAA)**.\n\n## Por qué te conviene\n\n- Es la base para **abrir cuentas bancarias** en muchos bancos y credit unions.\n- Permite construir **historial financiero** en el país.\n- Declarar impuestos crea un **registro de presencia y cumplimiento** que puede ser útil en procesos futuros.\n\n> ⚠️ Esta guía **informa, no asesora**. Para tu caso puntual, confirmá siempre con la fuente oficial citada abajo o con un profesional de impuestos.\n`,
      topics: ['itin', 'impuestos', 'banco'],
      city: null,
      reading_minutes: 6,
      sources: [
        {
          name: 'IRS — Individual Taxpayer Identification Number (ITIN)',
          url: 'https://www.irs.gov/individuals/individual-taxpayer-identification-number',
          checked_at: '2026-07-06',
        },
        {
          name: 'IRS — Formulario W-7 (SP)',
          url: 'https://www.irs.gov/forms-pubs/about-form-w-7',
          checked_at: '2026-07-06',
        },
      ],
    },
    {
      tenant_id: dominicanosId,
      slug: 'licencia-conducir-ny-sin-ssn',
      title: 'Licencia de conducir en Nueva York sin SSN (Ley Green Light)',
      summary:
        'Desde la Ley Green Light, en el estado de NY podés sacar una licencia estándar sin Seguro Social, usando pasaporte extranjero y otros documentos. Qué llevar al DMV.',
      body_md: `# Licencia de conducir en NY sin SSN\n\nLa **Ley Green Light** (2019) permite a residentes del estado de Nueva York obtener una **licencia estándar (Standard, no REAL ID)** sin número de Seguro Social.\n\n## Documentos que suelen aceptarse\n\n- **Pasaporte extranjero vigente** (o vencido hace menos de 2 años, según el caso),\n- **acta de nacimiento extranjera**, cédula o matrícula consular como apoyo,\n- **comprobantes de domicilio en NY** (cartas, facturas, contrato de alquiler).\n\nEl DMV usa un **sistema de puntos por documento**: verificá tu combinación exacta en la guía oficial antes de ir.\n\n## Pasos\n\n1. Juntá los documentos y sacá **turno (appointment)** en una oficina del DMV.\n2. Rendí el **examen escrito** (disponible en español).\n3. Practicá y rendí el **examen de manejo**.\n\n## Importante\n\n- La licencia estándar **no sirve para volar** dentro de EE.UU. a partir de los requisitos de REAL ID; para eso se necesita otro documento.\n- El DMV de NY **no comparte** datos de solicitantes de licencia estándar con autoridades migratorias salvo orden judicial, según la propia ley — leé la fuente oficial.\n\n> ⚠️ Guía informativa con fuente oficial citada. No es asesoría legal.\n`,
      topics: ['licencia', 'dmv', 'green-light'],
      city: 'New York',
      reading_minutes: 7,
      sources: [
        {
          name: 'NY DMV — Green Light Law (licencias estándar)',
          url: 'https://dmv.ny.gov/driver-license/green-light-law',
          checked_at: '2026-07-06',
        },
        {
          name: 'NY DMV — Cómo obtener una licencia de conducir',
          url: 'https://dmv.ny.gov/driver-license/get-driver-license',
          checked_at: '2026-07-06',
        },
      ],
    },
    {
      tenant_id: null, // global
      slug: 'tus-derechos-ante-ice',
      title: 'Tus derechos si ICE toca tu puerta o te detiene',
      summary:
        'Tengas o no papeles, la Constitución te protege: derecho a guardar silencio, a no abrir sin orden judicial firmada por un juez, y a hablar con un abogado. Qué hacer y qué no.',
      body_md: `# Tus derechos ante ICE\n\n**Toda persona en EE.UU. tiene derechos constitucionales, sin importar su estatus migratorio.**\n\n## Si tocan tu puerta\n\n- **No estás obligado a abrir.** Pedí que pasen la orden por debajo de la puerta o la muestren por la ventana.\n- Solo una **orden judicial (judicial warrant) firmada por un juez** con tu nombre y dirección correcta los autoriza a entrar sin tu permiso. Una "orden administrativa" de ICE (formularios I-200/I-205) **no** es una orden judicial.\n\n## Si te detienen o te interrogan\n\n- Tenés derecho a **guardar silencio**. Podés decir: *"I choose to remain silent"*.\n- **No firmes nada** que no entiendas ni sin hablar con un abogado.\n- No muestres documentos falsos ni mientas: guardar silencio es legal, mentir no.\n- Tenés derecho a **llamar a un abogado** y, en muchos casos, a tu consulado.\n\n## Prepará a tu familia\n\n- Memorizá el teléfono de un familiar y de una organización de ayuda legal.\n- Armá un **plan familiar** (quién cuida a los niños, dónde están los documentos).\n- Llevá una **tarjeta roja de derechos** (red card) para entregar sin hablar.\n\n> ⚠️ Esta guía **informa con fuentes oficiales de organizaciones de derechos civiles**; no reemplaza a un abogado de inmigración. Ante un caso real, buscá ayuda legal verificada.\n`,
      topics: ['derechos', 'ice', 'emergencia'],
      city: null,
      reading_minutes: 8,
      sources: [
        {
          name: 'NILC — Know Your Rights (derechos ante agentes de inmigración)',
          url: 'https://www.nilc.org/resources/know-your-rights/',
          checked_at: '2026-07-06',
        },
        {
          name: 'ILRC — Red Cards / Tarjetas Rojas',
          url: 'https://www.ilrc.org/red-cards',
          checked_at: '2026-07-06',
        },
      ],
    },
  ];

  for (const guide of guides) {
    await upsertGuide(guide);
  }

  // 6. verification_check de ejemplo (Escudo §3: descriptor literal + fecha) --
  const CHECK_LICENSE = '01PE6412345';
  const CHECK_REGISTRY = 'Registro de Notarios Públicos — NY Department of State';
  {
    const { data: existing, error: selErr } = await supabase
      .from('verification_checks')
      .select('id')
      .eq('tenant_id', dominicanosId)
      .eq('registry', CHECK_REGISTRY)
      .eq('license_number', CHECK_LICENSE)
      .maybeSingle();
    if (selErr) die('buscando verification_check', selErr);

    if (existing) {
      log('skip', 'verification_check de ejemplo ya existe');
    } else {
      const { error } = await supabase.from('verification_checks').insert({
        tenant_id: dominicanosId,
        subject_kind: 'license',
        subject_id: null,
        license_number: CHECK_LICENSE,
        registry: CHECK_REGISTRY,
        registry_url: 'https://dos.ny.gov/notary-public',
        result: 'found_active',
        checked_at: new Date().toISOString(),
        evidence: {
          method: 'manual_registry_lookup',
          matched_name: 'Rosa M. Peralta',
          registry_status_text: 'Notary Public — Commission active',
          query: { license_number: CHECK_LICENSE },
        },
        disclaimer_version: '2026-07-v1',
      });
      if (error) die('creando verification_check', error);
      log('create', `verification_check found_active (${CHECK_REGISTRY})`);
    }
  }

  // -------------------------------------------------------------------------
  console.log(`\n✔ Seed completo (${summary.filter((s) => s.startsWith('create')).length} creados, ${summary.filter((s) => s.startsWith('skip')).length} ya existían).`);
  console.log('  Usuarios demo (password Demo123!demo):');
  console.log('   - maria@demo.comunidadlatina.com     → member @ dominicanos');
  console.log('   - carlos@demo.comunidadlatina.com    → domain_admin @ dominicanos');
  console.log('   - geovanny@demo.comunidadlatina.com  → global_admin @ comunidadlatina\n');
}

main().catch((err) => {
  console.error(`✘ Seed falló: ${err.stack || err.message}`);
  process.exit(1);
});
