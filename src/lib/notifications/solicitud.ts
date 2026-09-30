export type EstadoSolicitud = "pendiente" | "aceptada" | "eliminada" | "no_disponible";

export type ActorDelAviso = {
  id: string;
  nombre: string;
  avatarUrl: string | null;
};

export type SolicitudDelAviso = {
  conversationId: string;
  estado: EstadoSolicitud;
  actor: ActorDelAviso;
};

export type DecisionSolicitud = "confirmar" | "eliminar";

export type ResponderSolicitudResult =
  | { ok: true; estado: "aceptada" | "eliminada" }
  | {
      ok: false;
      code: "invalid" | "unauthenticated" | "no_disponible" | "ya_resuelta" | "error";
      estado?: EstadoSolicitud;
    };

export const KIND_SOLICITUD = "contact_request";
export const KIND_SOLICITUD_ACEPTADA = "contact_accepted";

export function estadoDeSolicitud(status: string | null | undefined): EstadoSolicitud {
  switch (status) {
    case "pending":
      return "pendiente";
    case "accepted":
      return "aceptada";
    case "blocked":
    case "declined":
      return "eliminada";
    default:
      return "no_disponible";
  }
}

export function perfilHref(profileId: string): string {
  return `/perfil/${profileId}`;
}

export function chatHref(conversationId: string): string {
  return `/mensajes/${conversationId}`;
}

export function partirTituloPorActor(
  titulo: string,
  nombre: string,
): { conNombre: boolean; resto: string } {
  if (nombre && titulo.startsWith(`${nombre} `)) {
    return { conNombre: true, resto: titulo.slice(nombre.length + 1) };
  }
  return { conNombre: false, resto: titulo };
}
