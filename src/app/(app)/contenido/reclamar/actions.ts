"use server";

import { revalidatePath } from "next/cache";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  LIVE_DISPUTE_STATUSES,
  RECLAMO_ERRORS,
  claimFormSchema,
  isClaimConfirmed,
  parseEvidenceUrls,
  untypedSupabase,
} from "@/lib/integrity/disputes";

/**
 * =============================================================================
 * ABRIR UN RECLAMO DE COPYRIGHT (lado usuario)
 * =============================================================================
 *
 * TODO EL PODER ESTÁ EN LA RPC, NO ACÁ. `public.abrir_disputa_de_contenido`
 * (0086) es SECURITY DEFINER y deriva del servidor las tres cosas que el cliente
 * no puede elegir: el tenant (`app.current_tenant_id()`), el reclamante
 * (`auth.uid()`) y la contraparte (el uploader del asset, vía trigger). Esta
 * action NO manda ninguna de las tres, y por eso no hay forma de abrir un
 * reclamo a nombre de otro ni en la comunidad de otro — ni siquiera mandando los
 * campos a mano a este endpoint POST.
 *
 * LO QUE SÍ HACE ACÁ, Y POR QUÉ:
 *
 *   · GUARD DE TENANT PRIMERO. `requireTenantMatch()` va antes de consumir el
 *     rate limit y antes de tocar la base — regla del módulo (`lib/tenant/guard`):
 *     si el guard corriera después, un rechazo dejaría el efecto colateral
 *     huérfano.
 *   · PRE-CHEQUEO DE "ES MÍO" CON EL CLIENTE DEL USUARIO. `content_assets_select`
 *     (0061) sólo devuelve fila si sos el uploader (o staff). O sea que si la
 *     consulta trae algo Y el uploader sos vos, es tuyo — y se corta con un
 *     mensaje humano en vez de dejar que la RPC devuelva un `check_violation`
 *     crudo. Si NO trae nada no se concluye nada: puede ser ajeno, de otra
 *     comunidad o inexistente, y esa ambigüedad es deseable (no filtramos qué
 *     existe). La RPC decide.
 *   · PRE-CHEQUEO DE DUPLICADO. El índice único parcial de la 0086 ya lo impide,
 *     pero un 23505 crudo no le dice nada a nadie. Se consulta antes con el
 *     cliente del usuario (la policy de SELECT deja al reclamante ver sus
 *     propias disputas) y además se mapea el 23505 por si dos envíos corren a la
 *     par.
 *
 * NUNCA LANZA. Todo camino devuelve `{ status: "error", message }` legible; los
 * fallos inesperados se loguean con `console.error` y devuelven el genérico.
 * Un throw acá sería una pantalla de error de Next sobre un formulario que la
 * persona acaba de escribir entero.
 */

export type ReclamoState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; disputeId: string };

/** 5 reclamos por día y por persona. Un reclamo es un expediente, no un like. */
const MAX_RECLAMOS_POR_DIA = 5;

export async function abrirReclamoDeContenido(
  _prev: ReclamoState,
  formData: FormData,
): Promise<ReclamoState> {
  try {
    // ---- 1. Forma del input -------------------------------------------------
    const parsed = claimFormSchema.safeParse({
      assetId: formData.get("assetId"),
      claimKind: formData.get("claimKind"),
      claimText: formData.get("claimText"),
      evidence: formData.get("evidence") ?? undefined,
    });

    if (!parsed.success) {
      const paths = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
      if (paths.has("claimKind")) {
        return { status: "error", message: RECLAMO_ERRORS.invalidKind };
      }
      if (paths.has("claimText")) {
        const tooLong = parsed.error.issues.some(
          (issue) => issue.path[0] === "claimText" && issue.code === "too_big",
        );
        return {
          status: "error",
          message: tooLong ? RECLAMO_ERRORS.textTooLong : RECLAMO_ERRORS.invalidText,
        };
      }
      return { status: "error", message: RECLAMO_ERRORS.generic };
    }

    const { assetId, claimKind, claimText, evidence } = parsed.data;

    if (!isClaimConfirmed(formData.get("confirmed"))) {
      return { status: "error", message: RECLAMO_ERRORS.notConfirmed };
    }

    const evidenceResult = parseEvidenceUrls(evidence);
    if (!evidenceResult.ok) {
      return {
        status: "error",
        message:
          evidenceResult.reason === "too_many"
            ? RECLAMO_ERRORS.tooManyEvidence
            : RECLAMO_ERRORS.invalidEvidence(evidenceResult.offending),
      };
    }

    // ---- 2. Sesión y comunidad (antes de cualquier efecto) ------------------
    const guard = await requireTenantMatch();
    if (!guard.ok) {
      return {
        status: "error",
        message:
          guard.reason === "unauthenticated" ? RECLAMO_ERRORS.unauthenticated : guard.message,
      };
    }
    const { supabase, user } = guard;

    // ---- 3. Cuota ----------------------------------------------------------
    if (!limit(`reclamo-contenido:${user.id}`, MAX_RECLAMOS_POR_DIA, DAY_MS).ok) {
      return { status: "error", message: RECLAMO_ERRORS.tooMany };
    }

    // ---- 4. ¿Es mío? (ver la nota del módulo) ------------------------------
    const { data: ownAsset, error: assetError } = await supabase
      .from("content_assets")
      .select("id, uploader_id")
      .eq("id", assetId)
      .maybeSingle();

    if (assetError) {
      console.error("[reclamo] no se pudo verificar el asset:", assetError.message);
      return { status: "error", message: RECLAMO_ERRORS.generic };
    }
    if (ownAsset && ownAsset.uploader_id === user.id) {
      return { status: "error", message: RECLAMO_ERRORS.own };
    }

    // ---- 5. ¿Ya lo reclamé? ------------------------------------------------
    const { data: liveRows, error: liveError } = await untypedSupabase(supabase)
      .from("content_disputes")
      .select("id")
      .eq("asset_id", assetId)
      .eq("claimant_id", user.id)
      .in("status", [...LIVE_DISPUTE_STATUSES])
      .limit(1);

    if (liveError) {
      console.error("[reclamo] no se pudieron leer las disputas vivas:", liveError.message);
      return { status: "error", message: RECLAMO_ERRORS.generic };
    }
    if (Array.isArray(liveRows) && liveRows.length > 0) {
      return { status: "error", message: RECLAMO_ERRORS.duplicate };
    }

    // ---- 6. La RPC ---------------------------------------------------------
    const { data: disputeId, error } = await untypedSupabase(supabase).rpc(
      "abrir_disputa_de_contenido",
      {
        p_asset_id: assetId,
        p_claim_kind: claimKind,
        p_claim_text: claimText,
        p_evidence_urls: evidenceResult.urls,
      },
    );

    if (error) {
      // 23505 = el índice único parcial. Dos envíos a la par, o una pestaña
      // vieja: no es un fallo, es que ya está hecho.
      if (error.code === "23505") {
        return { status: "error", message: RECLAMO_ERRORS.duplicate };
      }
      // 23514 (check_violation) lo levanta `app.disputa_admisible`: el asset no
      // existe, no es de esta comunidad, o es propio. Las tres se cuentan igual
      // para no confirmarle a nadie qué existe y qué no.
      if (error.code === "23514" || /disputa sobre ese contenido|contenido propio/i.test(error.message)) {
        return { status: "error", message: RECLAMO_ERRORS.notFound };
      }
      if (error.code === "42501" || /Sesión sin tenant|insufficient/i.test(error.message)) {
        return { status: "error", message: RECLAMO_ERRORS.unauthenticated };
      }
      console.error("[reclamo] abrir_disputa_de_contenido falló:", error.message);
      return { status: "error", message: RECLAMO_ERRORS.generic };
    }

    // La página del reclamo pasa a mostrar "ya tenés uno abierto", y la cola del
    // staff tiene un caso más. Las dos leen de la base en cada request, así que
    // esto sólo purga el router cache del cliente.
    revalidatePath(`/contenido/reclamar/${assetId}`);
    revalidatePath("/admin/moderacion/integridad/disputas");

    return { status: "success", disputeId: typeof disputeId === "string" ? disputeId : "" };
  } catch (error) {
    // Nada de `catch {}` mudo: si esto salta, alguien tiene que poder verlo en
    // los logs. Quien envió el formulario ve un mensaje, no una pantalla rota.
    console.error(
      "[reclamo] error inesperado al abrir el reclamo:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return { status: "error", message: RECLAMO_ERRORS.generic };
  }
}
