# La base de producción es la del cliente

Desde el 06/11/2026 Comunidad Latina corre en `vnfqzlcxpmofvsoxnptf` (org del cliente, dueño
ecosistemalatino@gmail.com). Las migraciones nuevas van ahí.

`ktmbtpuhqqofdkisqseq` es la base vieja y es compartida con caughtcode (`*_caughtcode`) y
error-manager (`e_manager_*`). `fg_*` y `fogoneros` tampoco son de este repo.

- Las tablas de Comunidad Latina en la base vieja quedan congeladas con el trigger `zz_mudanza` y sus crons apagados, como respaldo.
- No borres ni modifiques nada que no sea de Comunidad Latina.
- No uses su tabla de migraciones como referencia: mezcla los tres productos.
- `supabase/migrations/` no reconstruye la base real desde cero: el esquema vigente es el de producción.
- Nunca borres nada del origen sin aprobación de Manuel.

Detalle en `docs/decisiones/migracion-supabase-cliente.md`.
