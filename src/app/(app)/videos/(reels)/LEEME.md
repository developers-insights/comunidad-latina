`(reels)/` existe por el invariante de `src/app/loading-boundaries.test.ts`: un
`loading.tsx` cubre a TODO su subárbol, y `/videos/largos/[id]` (sección de
videos largos, feedback 2026-09-03) devuelve `notFound()`. Con el skeleton del
riel colgado de `videos/`, un id inexistente pintaba primero el esqueleto y
después el 404 (y la respuesta salía 200). El route group aísla el skeleton al
riel sin cambiar la URL `/videos`. Mismo patrón que `eventos/(lista)/`.
