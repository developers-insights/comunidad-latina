export const ELIMINAR_COPY = {
  generico: "No pudimos eliminar el aviso. Probá de nuevo en un ratito.",
  necesitaCuenta: "Entrá a tu cuenta para administrar tus avisos.",
  noEsTuyo: "Solo quien publicó el aviso puede eliminarlo.",
  negocio: "La ficha de un negocio se administra desde su propia página.",
  tuvoPagos:
    "Este aviso tuvo publicidad o premium pagos, así que queda guardado con su historial. Podés pausarlo o marcarlo como cerrado desde Mis publicaciones.",
  demasiado: "Eliminaste varios avisos seguidos. Esperá un ratito y probá de nuevo.",
} as const;

export const TABLAS_CON_PAGOS = ["boosts", "campaigns", "listing_premiums"] as const;
