---
paths:
  - "src/app/(app)/**/page.tsx"
  - "src/app/(app)/**/queries.ts"
  - "src/components/**/*.tsx"
  - "supabase/migrations/**"
---

# `profiles` y `trust_scores` no se leen sin sesión (2026-11-06)

Desde la 0186 `anon` no toca esas tablas ni ejecuta `global_search`. En una pantalla pública, `.from("profiles")` deja la página sin autores sin tirar error visible.

- Autores y puntajes públicos: `perfilesPublicos` / `puntajesPublicos` de `@/lib/perfiles/publicos`. Piden por id, nunca listan.
- Los embeds `profiles!fk(...)` sólo sirven con sesión.
- Una tabla con una fila por persona no se abre a `anon`: sus ids son el padrón, y con ellos la RPC devuelve los nombres.

Por qué: la vara del 05/11 mostró que con la anon key se bajaban todas las personas de todas las comunidades.
