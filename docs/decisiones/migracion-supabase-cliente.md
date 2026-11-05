# Migración de Supabase a la cuenta del cliente

Estado al 2026-11-05: **plan listo, migración sin empezar.** Ni el origen ni el destino se tocaron.
El motivo es de acceso: la Mac donde se trabajó no tiene `envkit` y ninguna credencial de Supabase
de `developers@insightsapps.tech`. Ver "Qué falta para arrancar".

| | Origen (producción hoy) | Destino (cuenta del cliente) |
|---|---|---|
| Ref | `ktmbtpuhqqofdkisqseq` | `vnfqzlcxpmofvsoxnptf` |
| Org | `thmokrmynbamoukloork` (INSIGHTS manu) | `mfgffszuxbixgogcchdr` (dueño ecosistemalatino) |
| Región / Postgres | us-west-2 / 17 | us-west-2 / 17.6 |

## Decisiones

- **La base de origen es compartida.** `*_caughtcode`, `e_manager_*` y sus buckets no se migran ni se tocan.
  `fg_*` y el bucket `fogoneros` no aparecen en este repo: no son de Comunidad Latina.
- **La verdad del esquema son `supabase/migrations/`** (hoy hasta la 0183), no la tabla de migraciones del
  origen, que mezcla las de los tres productos.
- **Nunca se borra nada del origen.** A la semana de estar estable, proponer la limpieza en Kairo.
- **Sin Docker.** `pg_dump`/`psql` 17 nativos, por session pooler, y Management API para chequeos.
- **Se conservan los UUID y `encrypted_password`.** Las sesiones no se migran: todos vuelven a entrar.

## Lo que ya se verificó en el código

- **App de iPhone:** `ios-app/capacitor.config.json` carga `https://www.comunidadlatina.com` en remoto.
  No tiene la URL de Supabase compilada: **no hace falta build nuevo para las tiendas.**
- **CSP e imágenes:** `next.config.ts` usa `*.supabase.co` y `wss://*.supabase.co`. No hay que tocarlos.
- **Ref fijo en el código a cambiar en el corte:** `scripts/apply-migrations.mjs:13`,
  `scripts/dryrun-migraciones.mjs:17`, `scripts/rls-enumerator.mjs:36`, `scripts/encolar-huerfanos.mjs:13`,
  `src/lib/pricing/cross-tenant-admin.test.ts:37`. Además, comentarios en `scripts/rls-enumerator.test.ts`
  y `src/lib/media/video-upload-limits.ts`.
- **Crons:** 17 migraciones llaman a `cron.schedule`. `vercel.json` tiene además `/api/cron/creadores`.
- **Vault:** las migraciones leen `push_dispatch_url` y `push_dispatch_secret`.

## Qué falta para arrancar

Cualquiera de las dos:

1. Seguir desde la PC con `envkit` (`SUPABASE_ACCESS_TOKEN` en `_global`, namespace `comunidad_latina`), o
2. Conseguir en esta Mac un token válido de `developers@` y las claves del namespace.

## Orden de ejecución

Importa porque el código nuevo y las migraciones dependen entre sí.

1. Inventario del origen sólo de Comunidad Latina: guardarlo acá abajo.
2. Resetear la contraseña del destino y guardarla en envkit.
3. Extensiones y migraciones 0001 a 0182 en el destino. Comparar objeto por objeto contra el origen.
4. Copiar `auth.users`, `auth.identities`, `auth.mfa_*`, y las tablas de `public` con
   `session_replication_role = replica`. Sincronizar secuencias. Reescribir URLs al ref nuevo.
5. Copiar storage con conteo por bucket.
6. En el destino: correr el `SELECT` de `docs/decisiones/limpieza-links-compra.sql`, revisar, limpiar,
   y recién ahí aplicar la 0183. Con filas sucias la 0183 frena a propósito.
7. Recrear crons y vault con los valores del destino. Correr `get_advisors` y `npm run check:rls`.
8. Config de auth igual al origen: `site_url`, allow list, SMTP Resend, plantillas, rate limits, JWT,
   Google y Twilio.
9. Corte: congelar escrituras, última sincronización, cambiar las 4 envs, un solo deploy.
10. Verificar en producción con las cuentas de QA de Henry.

## Volver atrás

Restaurar `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y
`SUPABASE_DB_PASSWORD` desde sus copias `_VIEJO` en envkit, y redeployar. Lo escrito en la base nueva
después del corte no vuelve solo.

## Teléfono obligatorio: se prende aparte

La 0181 no cambia nada al aplicarse: `tenants.phone_required` nace en `false`. Para prender:

1. Publicar la política de privacidad actualizada, que hoy dice "No pedimos teléfono", y actualizar
   `docs/ARQUITECTURA.md` §4.
2. Poner `PHONE_VERIFICATION_ENABLED=true` y probar un SMS real.
3. Prender por comunidad: `update public.tenants set phone_required = true where slug = '…';`

`dominicanos` no se prende hasta tener WhatsApp de Twilio: los números de República Dominicana no reciben
SMS y quedarían en modo lectura sin salida. Para apagar: primero la columna, después la env.

## Inventario del origen

Pendiente: requiere acceso a la base.
