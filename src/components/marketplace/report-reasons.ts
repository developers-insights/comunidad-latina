/**
 * MOTIVOS DE REPORTE DEL MARKETPLACE (spec §7).
 *
 * NO es un segundo sistema de reportes: es la MISMA lista de motivos que
 * consume `<ReportSheet>` (components/trust), la misma server action
 * (`reportTargetAction`) y la misma RPC `report_scam`. Lo único propio de acá es
 * QUÉ opciones se ofrecen, porque los motivos genéricos ("me trató mal") no
 * sirven para denunciar un producto falsificado.
 *
 * Cada motivo se corresponde 1:1 con una sección de la política de
 * `/legal/marketplace` — si se agrega uno acá, se agrega allá, y al revés.
 *
 * El `value` viaja tal cual a `report_scam.p_reason` y es lo que lee el equipo
 * de moderación: texto legible, no un código. El schema del server lo acota a
 * 80 caracteres (ver reportes/actions.ts), así que ninguno puede pasarse.
 */
export const MARKETPLACE_REPORT_REASONS = [
  "Producto falso o imitación",
  "Producto robado",
  "Es una estafa",
  "Fraude en el pago",
  "Publicidad engañosa",
  "Artículo prohibido",
  "Usa una marca o contenido que no le pertenece",
  "Otra cosa",
] as const;

export type MarketplaceReportReason = (typeof MARKETPLACE_REPORT_REASONS)[number];

/** Tope del schema de `reportTargetAction` — se verifica en los tests. */
export const REPORT_REASON_MAX_LENGTH = 80;
