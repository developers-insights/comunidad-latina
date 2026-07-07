/**
 * Razones canónicas del reporte de estafa (Escudo §3.3).
 * El `value` viaja tal cual a la RPC report_scam y es lo que lee el equipo
 * de moderación — texto legible, no un código.
 * Mantener en espejo con REASON_VALUES en app/(app)/escudo/reportar/actions.ts.
 */
export const REPORT_REASONS = [
  { key: "dinero", value: "Pidió dinero por adelantado" },
  { key: "direccion", value: "La dirección no existe" },
  { key: "suplantacion", value: "Se hace pasar por otra persona" },
  { key: "precio", value: "El precio es irreal" },
  { key: "otro", value: "Otro" },
] as const;

export type ReportReasonValue = (typeof REPORT_REASONS)[number]["value"];
