/**
 * =============================================================================
 * TÉRMINOS DE CREADOR — CONTENIDO Y VERSIONADO
 * =============================================================================
 *
 * Son un contrato APARTE de los términos generales de la plataforma: se aceptan
 * en otro momento, dicen otra cosa (cómo se cobra, quién se queda con qué, qué
 * pasa si no entregás) y uno puede cambiar sin el otro. Por eso 0064 les dio dos
 * columnas propias en `creator_profiles`: `creator_terms_accepted_at` y
 * `creator_terms_version`.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ HAY UNA VERSIÓN, Y QUÉ PASA EL DÍA QUE CAMBIA
 *
 * Sin versión, "aceptó los términos" deja de significar algo apenas los términos
 * cambian: no se puede saber qué firmó cada quien.
 *
 * El día que se editen estos textos se sube `CREATOR_TERMS.version` y pasa esto:
 *
 *   · Quien nunca aceptó         → sigue igual: tiene que aceptar.
 *   · Quien aceptó la versión vieja → la app le vuelve a pedir la aceptación, con
 *     un aviso de que los términos cambiaron. NO se le borra ni se le invalida
 *     nada: su fila conserva la fecha y la versión que firmó.
 *
 * Y —esto es lo importante— **nadie deja de ser elegible por un cambio de
 * versión**. El gate de la base (`app.creator_activation_eligible`) solo mira
 * que `creator_terms_accepted_at` no sea nulo, así que una aceptación vieja
 * sigue valiendo para la base. Pedir la aceptación de nuevo es una decisión de
 * la app —un recordatorio—, no una revocación. Si algún día el negocio quisiera
 * lo contrario (invalidar de verdad a los que firmaron la versión anterior),
 * eso es una migración, no un cambio acá: hay que enseñarle la versión al SQL.
 * =============================================================================
 */

export interface CreatorTermsSection {
  title: string;
  /** Párrafos. Texto plano a propósito: nada de HTML que haya que sanitizar. */
  body: string[];
}

export interface CreatorTermsDocument {
  /**
   * Fecha ISO de la revisión. Es la que se guarda en
   * `creator_profiles.creator_terms_version`. Formato fecha y no "v1/v2" para
   * que un reclamo de dentro de dos años se pueda fechar sin una tabla aparte.
   */
  version: string;
  /** Cómo se muestra la versión en pantalla. */
  label: string;
  summary: string;
  sections: CreatorTermsSection[];
}

export const CREATOR_TERMS: CreatorTermsDocument = {
  version: "2026-08-08",
  label: "Versión del 8 de agosto de 2026",
  summary:
    "Esto es lo que aceptás al empezar a trabajar como creador en la comunidad. Está escrito para leerse: son cinco puntos y ninguno tiene letra chica.",
  sections: [
    {
      title: "Qué hacés como creador",
      body: [
        "Publicás tu portafolio, te postulás a los trabajos que te interesan y acordás con cada negocio qué vas a entregar, en cuánto tiempo y por cuánto.",
        "El acuerdo queda escrito en un contrato con su propio número. Lo que no está en el contrato, no está acordado.",
      ],
    },
    {
      title: "Cómo se cobra",
      body: [
        "El negocio deposita el monto antes de que empieces. La plata queda retenida —no la tiene ni el negocio ni vos— hasta que entregues.",
        "Cuando el negocio da por recibido el trabajo, se libera tu pago menos la comisión de la plataforma, que ves en el contrato antes de aceptarlo.",
        "Si no entregás, el dinero vuelve al negocio. Si entregaste y el negocio no responde, escribinos: revisamos el caso con el contrato a la vista.",
      ],
    },
    {
      title: "Lo que publicás es tuyo, y es tu responsabilidad",
      body: [
        "Seguís siendo dueño de tu trabajo. Nos autorizás a mostrarlo dentro de la comunidad para que otros negocios te encuentren.",
        "Te comprometés a subir solo material propio o con permiso. Si aparece contenido de otro sin autorización, lo bajamos.",
      ],
    },
    {
      title: "Datos personales y contacto",
      body: [
        "El contacto con el negocio pasa por los mensajes de la plataforma hasta que haya contrato. No es burocracia: es lo que nos deja ayudarte si algo sale mal.",
        "Nunca envíes dinero por adelantado a nadie, ni aceptes cerrar un trato por fuera. Si te lo proponen, reportalo.",
      ],
    },
    {
      title: "Cuándo se termina",
      body: [
        "Podés dejar de ser creador cuando quieras: los contratos abiertos se terminan y tu perfil se saca del directorio.",
        "También podemos suspender una cuenta que incumple estas reglas. Siempre te decimos por qué y siempre podés apelar.",
      ],
    },
  ],
};

/** Compatibilidad de lectura para quien solo necesita el número de versión. */
export const CREATOR_TERMS_VERSION = CREATOR_TERMS.version;

export type CreatorTermsState = "never" | "outdated" | "current";

export interface CreatorTermsAcceptance {
  acceptedAt: string | null;
  version: string | null;
}

/**
 * En qué situación está una persona respecto de los términos vigentes.
 *
 * `outdated` incluye el caso de una aceptación SIN versión: en la base hay filas
 * anteriores a 0064 donde la columna todavía no existía. Tratarlas como
 * "current" sería asumir que firmaron algo que nunca vieron.
 */
export function creatorTermsState(
  acceptance: CreatorTermsAcceptance | null | undefined,
  currentVersion: string = CREATOR_TERMS.version,
): CreatorTermsState {
  if (!acceptance?.acceptedAt) return "never";
  if (acceptance.version !== currentVersion) return "outdated";
  return "current";
}

/** ¿Hay que mostrarle la pantalla de aceptación? */
export function needsCreatorTermsAcceptance(
  acceptance: CreatorTermsAcceptance | null | undefined,
  currentVersion: string = CREATOR_TERMS.version,
): boolean {
  return creatorTermsState(acceptance, currentVersion) !== "current";
}

/**
 * ¿La base considera aceptados los términos?
 *
 * Deliberadamente NO mira la versión: es el espejo exacto de lo que evalúa
 * `app.creator_activation_eligible()` (`creator_terms_accepted_at is not null`).
 * Tener las dos preguntas separadas es lo que permite pedir la aceptación de
 * nuevo sin dejar inelegible a quien firmó la versión anterior.
 */
export function satisfiesCreatorTermsGate(
  acceptance: CreatorTermsAcceptance | null | undefined,
): boolean {
  return Boolean(acceptance?.acceptedAt);
}
