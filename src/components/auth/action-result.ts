/** Resultado tipado de las server actions del módulo AUTH. */
export type ActionResult =
  | { ok: true }
  | {
      ok: false;
      /** Error general del formulario, en español cálido. */
      formError?: string;
      /** Errores por campo (clave = name del input). */
      fieldErrors?: Record<string, string>;
    };
