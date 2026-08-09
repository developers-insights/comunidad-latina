/**
 * Vocabulario de estados de `tenant_domains.status` (migración 0060).
 *
 * Vive en su propio módulo y no en `actions.ts` porque un archivo `"use server"`
 * sólo puede exportar funciones async: una constante exportada desde ahí rompe
 * la ruta entera en runtime (ver `src/app/admin/use-server-exports.test.ts`).
 *
 * Las tres consecuencias que se muestran al confirmar no son adorno: suspender
 * un dominio SACA EL SITIO DE AIRE para quien entra por ese host, y el pliego
 * pide esa acción con nombre propio. Quien la ejecuta tiene que leer qué pasa
 * antes de tocarla, no después.
 */

export const DOMAIN_STATUSES = ["active", "suspended", "archived"] as const;

export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export function isDomainStatus(value: unknown): value is DomainStatus {
  return DOMAIN_STATUSES.includes(value as DomainStatus);
}

export interface DomainStatusCopy {
  /** Etiqueta corta de la pastilla de estado. */
  label: string;
  /** Variante del <Badge> del design system. */
  badge: "success" | "warning" | "neutral";
  /** Verbo del botón que LLEVA a este estado. */
  action: string;
  /** Título del diálogo de confirmación. */
  confirmTitle: string;
  /** Qué va a pasar, en castellano y sin eufemismos. */
  consequence: string;
  /** Etiqueta del botón que confirma. */
  confirmLabel: string;
  /** true = la acción apaga el sitio para ese host (UI en tono de riesgo). */
  destructive: boolean;
}

export const DOMAIN_STATUS_COPY: Record<DomainStatus, DomainStatusCopy> = {
  active: {
    label: "En el aire",
    badge: "success",
    action: "Reactivar",
    confirmTitle: "¿Volvemos a poner este dominio en el aire?",
    consequence:
      "Quien entre por esta dirección va a llegar de nuevo a la comunidad, con su marca y su contenido. Si el dominio estaba apuntando a otro lado, revisá el DNS antes.",
    confirmLabel: "Sí, reactivar",
    destructive: false,
  },
  suspended: {
    label: "Suspendido",
    badge: "warning",
    action: "Suspender",
    confirmTitle: "¿Suspendemos este dominio?",
    consequence:
      "El sitio deja de responder por esta dirección: quien la visite va a ver la comunidad por defecto, no esta. Los datos y las cuentas quedan intactos y podés reactivarlo cuando quieras. El cambio queda guardado al instante, aunque algunos visitantes pueden seguir entrando unos minutos hasta que se refresque la caché.",
    confirmLabel: "Sí, suspender",
    destructive: true,
  },
  archived: {
    label: "Archivado",
    badge: "neutral",
    action: "Archivar",
    confirmTitle: "¿Archivamos este dominio?",
    consequence:
      "Es la baja definitiva de esta dirección: deja de responder y queda en la lista sólo como registro histórico. Se usa cuando el dominio venció o la comunidad cambió de marca. Nada se borra y podés reactivarlo, pero no es un “pausa y sigo”.",
    confirmLabel: "Sí, archivar",
    destructive: true,
  },
};
