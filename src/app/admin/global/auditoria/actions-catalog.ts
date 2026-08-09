/**
 * Diccionario de `audit_log.action` → castellano.
 *
 * El registro guarda códigos (`tenant_domain.status_changed`) porque un código
 * es estable y se puede consultar; una pantalla que se los muestre crudos a
 * quien administra, no. Esto traduce, y lo que no está traducido se muestra tal
 * cual — un código feo es mejor que ocultar una acción que sí pasó.
 *
 * `tone` NO es decoración: separa lo que apaga o saca algo (`removes`) de lo
 * que crea o habilita (`grants`). Escaneando la lista, el ojo tiene que poder
 * encontrar "quién suspendió qué" sin leer cada fila.
 */

export type AuditTone = "grants" | "removes" | "neutral";

export interface AuditActionCopy {
  label: string;
  tone: AuditTone;
}

export const AUDIT_ACTIONS: Record<string, AuditActionCopy> = {
  // Plataforma
  "tenant.created": { label: "Creó una comunidad", tone: "grants" },
  "tenant.created_without_domain": {
    label: "Creó una comunidad (sin dominio)",
    tone: "neutral",
  },
  "tenant.modules_updated": { label: "Cambió los módulos de la comunidad", tone: "neutral" },
  "broadcast.created": { label: "Envió un anuncio global", tone: "neutral" },

  // Dominios
  "tenant_domain.added": { label: "Agregó un dominio", tone: "grants" },
  "tenant_domain.primary_changed": { label: "Cambió el dominio principal", tone: "neutral" },
  "tenant_domain.status_changed": { label: "Cambió el estado de un dominio", tone: "removes" },

  // Permisos
  "staff.granted": { label: "Dio permisos del panel", tone: "grants" },
  "staff.revoked": { label: "Quitó permisos del panel", tone: "removes" },

  // Cuentas
  "member.suspended": { label: "Suspendió una cuenta", tone: "removes" },
  "member.banned": { label: "Dio de baja una cuenta", tone: "removes" },
  "member.reactivated": { label: "Reactivó una cuenta", tone: "grants" },

  // Contenido
  "listing.approved": { label: "Aprobó un aviso", tone: "grants" },
  "listing.rejected": { label: "Rechazó un aviso", tone: "removes" },
  "moderation.approved": { label: "Aprobó un caso de moderación", tone: "grants" },
  "moderation.rejected": { label: "Rechazó un caso de moderación", tone: "removes" },
  "scam_report.upheld": { label: "Confirmó un reporte de estafa", tone: "removes" },
  "scam_report.dismissed": { label: "Desestimó un reporte de estafa", tone: "neutral" },

  // Empleos y creadores
  "job_applications.viewed": { label: "Abrió las postulaciones de un aviso", tone: "neutral" },
  "job_application.accepted": { label: "Aceptó una postulación", tone: "grants" },
  "job_application.declined": { label: "Rechazó una postulación", tone: "removes" },
  "creator_eligibility.updated": {
    label: "Cambió los requisitos para creadores",
    tone: "neutral",
  },
};

export function auditCopy(action: string): AuditActionCopy {
  return AUDIT_ACTIONS[action] ?? { label: action, tone: "neutral" };
}

/** Sobre qué se actuó. Se muestra sólo si aporta; nunca reemplaza a la acción. */
export const SUBJECT_LABEL: Record<string, string> = {
  tenant: "comunidad",
  tenant_domain: "dominio",
  profile: "persona",
  listing: "aviso",
  post: "publicación",
  broadcast: "anuncio",
  message: "mensaje",
  job_application: "postulación",
};
