// ⚠️ `fetchResenasDeAviso` (de "./queries") NO va en este barril: ese módulo
// abre con `import "server-only"`, y un barril reexporta MÓDULOS, no nombres
// sueltos — cualquier consumidor `"use client"` que tome de acá (aunque sea
// otra exportación) arrastra "server-only" a su bundle. Rompió el build de
// producción una vez (2026-08-24, ver `src/test/server-only-boundary.test.ts`).
// Importá esa función directo de "@/components/resenas/queries".
export { Estrellas, type EstrellasProps } from "./estrellas";
export { ResumenPuntajeCard, type ResumenPuntajeProps } from "./resumen-puntaje";
export { SelectorPuntaje, type SelectorPuntajeProps } from "./selector-puntaje";
export { ResenaForm, type ResenaFormProps } from "./resena-form";
export { ResenaAcciones, type ResenaAccionesProps } from "./resena-acciones";
export { ResenasLista, type ResenasListaProps } from "./resenas-lista";
