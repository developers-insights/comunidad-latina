# Migraciones escritas que NO se aplican todavía

`scripts/apply-migrations.mjs` (o sea `npm run db:migrate`) lee **sólo**
`supabase/migrations/` y aplica todo lo pendiente en orden. Una migración que
está lista pero que hay que esperar para correr no puede vivir ahí: el próximo
`db:migrate` de cualquiera la aplicaría sin que nadie lo decida.

Por eso viven acá. Cada archivo explica en su encabezado **qué condición** hay
que cumplir antes de moverlo a `supabase/migrations/` y correrlo.

## En espera hoy

### `0109_activar_gate_identidad.sql`

Enchufa a `listings_insert` la exigencia de identidad verificada para publicar
alquileres, artículos, empleos y eventos pagos — que es lo que pide la spec.

**Por qué espera:** el 2026-08-24 había **0 identidades verificadas sobre 20
perfiles**, y verificarse depende de Stripe Identity, que está sin claves.
Aplicarla hoy dejaría a todo el mundo sin poder publicar nada de eso, con un
error técnico crudo y sin ninguna forma de destrabarse. Un candado sin llave.

**Antes de moverla**, las tres condiciones del encabezado del archivo:
Stripe cargado y el flujo de verificación probado · las server actions
traduciendo el rechazo a copy · saber a quién le cierra la puerta.
