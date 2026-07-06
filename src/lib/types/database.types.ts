// GENERADO — se reemplaza con `supabase gen types typescript --project-id ktmbtpuhqqofdkisqseq`
// cuando las migraciones estén aplicadas. NO editar a mano después de eso.
//
// Mientras tanto: placeholder LAXO para que los clientes de Supabase ya lo importen
// y el reemplazo por los tipos reales sea un drop-in sin tocar imports.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;

/** Fila genérica mientras no hay tipos generados. */
export type TableRow = Record<string, Json | undefined>;
