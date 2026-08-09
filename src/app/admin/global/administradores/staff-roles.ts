/**
 * Roles que ESTA pantalla puede otorgar y quitar.
 *
 * Módulo aparte de `actions.ts` porque un archivo `"use server"` sólo puede
 * exportar funciones async (ver `src/app/admin/use-server-exports.test.ts`).
 *
 * `global_admin` NO está en la lista, y no es un olvido: el dueño de la
 * plataforma no se nombra desde una pantalla de la plataforma. Sumar otro súper
 * admin es una decisión de propiedad, no de operación, y se hace con acceso
 * directo a Supabase por quien ya lo es.
 */

export const ASSIGNABLE_ROLES = ["member", "moderator", "domain_admin"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(value: unknown): value is AssignableRole {
  return ASSIGNABLE_ROLES.includes(value as AssignableRole);
}

export interface RoleCopy {
  label: string;
  /** Qué puede hacer, en una línea y sin jerga. */
  summary: string;
  badge: "brand" | "info" | "neutral";
  confirmTitle: string;
  confirmLabel: string;
}

export const ROLE_COPY: Record<AssignableRole, RoleCopy> = {
  domain_admin: {
    label: "Administra la comunidad",
    summary:
      "Ve el panel completo de su comunidad: miembros, avisos, empleos, módulos y métricas. No ve las demás comunidades.",
    badge: "brand",
    confirmTitle: "¿Le damos la administración de esta comunidad?",
    confirmLabel: "Sí, hacerla administradora",
  },
  moderator: {
    label: "Modera",
    summary:
      "Revisa la cola de moderación y el listado de miembros de su comunidad. No toca módulos ni configuración.",
    badge: "info",
    confirmTitle: "¿Le damos permisos de moderación?",
    confirmLabel: "Sí, hacerla moderadora",
  },
  member: {
    label: "Miembro",
    summary: "Usa la comunidad como cualquier persona. Sin acceso al panel.",
    badge: "neutral",
    confirmTitle: "¿Le sacamos los permisos del panel?",
    confirmLabel: "Sí, quitar permisos",
  },
};

/** Roles que se muestran como "equipo" de una comunidad. */
export const STAFF_ROLES = ["moderator", "domain_admin", "global_admin"] as const;
