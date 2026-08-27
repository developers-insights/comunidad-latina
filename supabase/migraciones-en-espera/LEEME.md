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

#### Estado de las tres condiciones — revisado el 2026-08-26 (migración 0121)

| # | Condición | Estado |
|---|---|---|
| 1 | Stripe cargado y `/perfil/verificar` probado de punta a punta | ❌ **No** — `STRIPE_SECRET_KEY` sigue vacía y la base sigue con 0 identidades verificadas sobre 20 perfiles (medido el 2026-08-26). |
| 2 | Las server actions que publican traducen el rechazo a copy | ❌ **No** — `grep -rn requireIdentidadVerificada src/` devuelve sólo su definición y su test: sigue sin un solo consumidor. |
| 3 | Saber a quién le cierra la puerta | ⏳ Sin cambios — la consulta del encabezado del archivo hay que correrla el día que se aplique, no antes. |

**Ninguna se cumplió. La 0109 sigue esperando y NO se movió.**

#### Qué cambió igual (0121, 2026-08-26)

La 0121 no enciende el gate, pero le mueve el piso en tres cosas y por eso el
archivo de acá al lado **fue editado**:

1. **La rama B pregunta por la CARA ACTIVA, no por la persona.**
   `app.identidad_verificada((select auth.uid()))` pasó a ser
   `app.identidad_verificada_activa()`. Es el pedido del cliente («según cada
   perfil») y la doctrina de la 0116/0117: si el aviso sale firmado por tu
   negocio, la puerta pregunta por tu negocio. La 0121 ya cambió
   `public.puedo_publicar_vertical()` —lo que consulta la UI— para usar la
   misma función; dejar la policy con el predicado viejo habría hecho que la
   pantalla y la base dijeran cosas distintas.

2. **La rama C dice lo mismo y significa otra cosa.** El texto de la policy no
   se tocó: lo que cambió es el CUERPO de `app.ya_tiene_ficha_de_negocio()`,
   que ahora bloquea cuando hay tantas fichas vivas como cuentas de negocio
   (con piso en una) en vez de cuando hay al menos una. Se hizo así a propósito
   para que la 0109 y la 0121 se puedan aplicar **en cualquier orden** sin que
   una revierta a la otra.

3. **La condición 1 ahora abre dos puertas.** Sin documento validado por Stripe
   no sólo no hay escudo verde: tampoco se puede reclamar la verificación de un
   negocio (`public.verificar_identidad_de_negocio`, 0121). La llave sigue
   siendo una sola, pero de ella cuelga más cosa que antes.

#### Lo que sí se acerca a destrabar la condición 2

La 0121 le dio a `/perfil/verificar` una lista de **"Tus perfiles"**: la persona
y cada uno de sus negocios, con su estado y con el botón para resolverlo. O sea
que el DESTINO al que las server actions tienen que mandar a alguien rechazado
ya existe y ya sabe qué hacer con cada perfil. Lo que falta sigue siendo el
origen: llamar a `requireIdentidadVerificada()` desde `publicar/actions.ts`,
`empleos/publicar/actions.ts` y `marketplace/publicar/actions.ts`.

Esos tres archivos no son de este trabajo — quedan anotados acá para que quien
los tome sepa que el otro extremo del camino ya está construido.
