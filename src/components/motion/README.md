# `components/motion` — Primitivos de micro-interacción (el "juice" premium)

Client islands acotadas que hacen que tocar la app se sienta caro. **Todos** respetan
`prefers-reduced-motion` (con fallback sin movimiento o crossfade simple), mantienen foco y
`aria-*` intactos, usan los **motion tokens** de `globals.css` (`--ease-spring`,
`--ease-out-premium`, `--duration-*`) y no inventan curvas nuevas.

> Ownership: esta carpeta (+ `src/hooks/`) es del agente MICRO-INTERACCIONES. Otros módulos
> **adoptan** estos primitivos en SUS componentes; no hace falta editar nada de acá.

Import único:

```ts
import { TapScale, AnimatedNumber, LikeBurst, Celebration, Reveal, RevealGroup, Shimmer, useCelebration } from "@/components/motion";
```

## Reglas de oro al adoptar

1. Son **client components** (`"use client"`). Metélos como islas dentro de tu server component;
   no marques la página entera como client.
2. No rompen SSR: `AnimatedNumber` y `Reveal` renderizan el valor/contenido final en el server
   (sin flash), la animación arranca en el cliente.
3. Reduced-motion ya está resuelto adentro. No agregues tu propio gate salvo que quieras más.

## Primitivos

### `TapScale` — feedback de tap con spring
Envuelve cualquier tocable que no sea el `<Button>` de `ui/` (que ya lo trae). Da `active:scale(0.97)`
en <100ms con `--ease-spring`.
```tsx
<TapScale as="a" href={`/perfil/${id}`} className="block rounded-lg border p-4">…</TapScale>
```

### `AnimatedNumber` — conteo con `tabular-nums`
Trust Score, precios, contadores. Reduced-motion salta al valor. `aria-live="polite"`.
```tsx
<AnimatedNumber value={score} />                         // Trust Score
<AnimatedNumber value={precio} format={(n) => formatMoney(n)} />
<AnimatedNumber value={vistas} startOnView />            // anima al entrar al viewport
```
**Adopción sugerida en `trust/trust-score-badge.tsx`**: reemplazar el número plano del score por
`<AnimatedNumber value={score} />` (ya usa `tabular-nums`, mismo look, con conteo).

### `LikeBurst` — micro-celebración al reaccionar
Botón real con `aria-pressed`; el estado NO depende de la animación. Corazón hace pop + partículas
de marca. Vos renderizás el ícono según `active`.
```tsx
<LikeBurst active={liked} onToggle={setLiked} label="Me gusta">
  <Heart weight={liked ? "fill" : "regular"} className={liked ? "text-brand" : ""} size={22} />
</LikeBurst>
```
**Adopción sugerida en `feed/`**: envolver el botón de reacción del post con esto.

### `Celebration` + `useCelebration()` — logro elegante
Destello suave + check que se dibuja para momentos de logro (publicar aviso, verificar identidad,
completar onboarding). Reduced-motion: check estático con fade. `role="status"` anuncia el mensaje.
```tsx
const { celebrating, celebrate } = useCelebration();
// tras el éxito de la server action:
celebrate();
return <Celebration active={celebrating} message="¡Aviso publicado!" />;
```
**Adopción sugerida**: `propiedades/publicar/` (al publicar), onboarding `bienvenida/` (al completar),
`escudo/` identity (al verificar).

### `Reveal` / `RevealGroup` — scroll reveal liviano
IntersectionObserver + CSS (sin framer). Fade + `translateY` corto al entrar. Reduced-motion:
aparece sin animar. No hunde el LCP (el contenido está en el DOM).
```tsx
<Reveal><SeccionLanding /></Reveal>
<RevealGroup className="grid gap-4">
  {cards.map((c) => <Card key={c.id} {...c} />)}   // stagger automático
</RevealGroup>
```
**Adopción sugerida en `(marketing)/page.tsx`**: envolver secciones below-the-fold y grids de cards.
No envolver el hero/LCP.

### `Shimmer` — barrido de brillo puntual
Destaca un badge/pill premium con un sheen periódico sutil. NO es el skeleton (para carga usá
`<Skeleton>` de `ui/`). Reduced-motion o `disabled`: sin barrido.
```tsx
<Shimmer className="rounded-full bg-brand px-3 py-1 text-sm text-brand-foreground">Premium</Shimmer>
```

## Hooks (`src/hooks/`)
- `usePrefersReducedMotion()` — SSR-safe (`useSyncExternalStore`), fuente de verdad del gate de motion.
- `useCelebration()` — `{ celebrating, celebrate, reset }` para disparar `<Celebration>`.
