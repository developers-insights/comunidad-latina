# Migraciones escritas que NO se aplican todavía

`scripts/apply-migrations.mjs` (o sea `npm run db:migrate`) lee **sólo**
`supabase/migrations/` y aplica todo lo pendiente en orden. Una migración que
está lista pero que hay que esperar para correr no puede vivir ahí: el próximo
`db:migrate` de cualquiera la aplicaría sin que nadie lo decida.

Por eso viven acá. Cada archivo explica en su encabezado **qué condición** hay
que cumplir antes de moverlo a `supabase/migrations/` y correrlo.

## En espera hoy

Ninguna. La carpeta queda vacía a propósito (no se borra: es el lugar donde
aparece la próxima migración que tenga que esperar).

## Movimientos recientes

### `0109_activar_gate_identidad.sql` → `supabase/migrations/0126_activar_gate_identidad.sql` (2026-08-31)

Esperaba desde el 2026-08-24 (ver el historial de este archivo para el motivo
original y las tres condiciones). El dueño del producto cerró la decisión el
2026-08-31: activar el gate de identidad AHORA, asumiendo el bloqueo —no es
que las tres condiciones se hayan terminado de cumplir, es una decisión de
negocio que pesa más. El archivo se movió con el mismo contenido y el
encabezado reescrito para reflejar ese estado; **no se aplicó a la base
todavía** — eso lo hace quien encargó la tarea, después de revisarlo.

Al mover el archivo se cablearon sus dos consumidores dentro de alcance:
`src/app/(app)/publicar/actions.ts` (property, job, event pago) y ya estaba
hecho en `src/app/(app)/marketplace/publicar/actions.ts` (product). Queda
pendiente `src/app/(app)/empleos/publicar/actions.ts` — archivo de otro
agente, reportado en la tarea que movió este archivo.
