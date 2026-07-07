/**
 * El mapeo trust_scores → UI vive en la fuente única @/lib/trust/signals.
 * Este archivo solo re-exporta para no romper los imports existentes de
 * @/components/messaging. NO redefinir la gramática de señales acá: un mismo
 * usuario debe mostrar exactamente las mismas señales en toda superficie.
 */
export { toTrustLevel, toTrustProps, buildTrustSignals } from "@/lib/trust/signals";
