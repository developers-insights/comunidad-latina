"use client";

import { useState, useTransition } from "react";
import { CheckCircle, PaperPlaneTilt, Warning } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { JobApplySheet } from "./job-apply-sheet";
import { loadJobApplyContextAction, type JobApplyContext } from "@/app/(app)/empleos/apply-context-action";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import type { ApplicantProfilePreview } from "@/app/(app)/empleos/queries";
import type { JobQuestion } from "./helpers";

/**
 * POSTULARSE SIN SALIR DE LA LISTA (cliente 2026-08-20: "mientras menos pasos
 * mejor. Fijate dónde podés aplicar esa mejora").
 *
 * La hoja de postulación ya estaba hecha y probada; lo único que estaba mal era
 * DÓNDE se podía abrir. Hasta hoy, postularse eran dos pantallas: tocar "Ver
 * empleo", esperar el detalle, y recién ahí encontrar el botón. Ahora el botón
 * está donde la persona ya decidió —sobre el aviso que está mirando— y la URL no
 * cambia: si cierra la hoja sigue en el mismo lugar del listado, con el mismo
 * scroll. Leer el aviso completo pasa a ser lo que siempre debió ser: una
 * opción, no un peaje.
 *
 * Es la misma idea que `listings/inline-message-cta` (escribirle a alguien sin
 * ir a /mensajes) y que los tiles `kind:"quick"` de `shell/create-menu`:
 * resolver en el lugar cuando la pantalla que hace falta ya existe.
 *
 * ── POR QUÉ EL CONTEXTO SE PIDE AL TOCAR, Y NO ANTES ──────────────────────
 * Postular necesita las preguntas del aviso y el perfil de quien se postula, y
 * ninguna de las dos cosas está en `JobCardModel`. Traerlas al armar el listado
 * costaría 12 lecturas por página para un botón que la mayoría no toca. Se
 * piden en un solo viaje cuando alguien toca "Postularme" —el botón muestra su
 * spinner mientras tanto— y la respuesta también trae los casos en los que no
 * hay formulario que abrir: ya se postuló, el aviso es suyo, o se despublicó.
 */

/** Copy local al componente: `copy.ts` del módulo lo comparten varios flujos. */
const COPY_INLINE = {
  cta: "Postularme",
  ctaAria: (title: string) => `Postularme a ${title}`,
  applied: "Ya te postulaste",
  ownJob: "Este aviso es tuyo.",
  unavailable: "Este aviso ya no está disponible.",
  generic: "No pudimos abrir la postulación. Probá de nuevo en un ratito.",
} as const;

/** Lo que la hoja necesita y la card no tiene, ya resuelto. */
type SheetContext = {
  questions: JobQuestion[];
  profile: ApplicantProfilePreview | null;
};

export interface JobApplyInlineProps {
  jobId: string;
  /** Título del aviso — el botón se nombra con él para el lector de pantalla. */
  jobTitle: string;
}

export function JobApplyInline({ jobId, jobTitle }: JobApplyInlineProps) {
  const requireAuth = useRequireAuth();
  const [sheet, setSheet] = useState<SheetContext | null>(null);
  const [applied, setApplied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setNotice(null);
    startTransition(async () => {
      let context: JobApplyContext;
      try {
        context = await loadJobApplyContextAction(jobId);
      } catch {
        setNotice(COPY_INLINE.generic);
        return;
      }

      switch (context.state) {
        case "ready":
          setSheet({ questions: context.questions, profile: context.profile });
          return;
        case "already-applied":
          setApplied(true);
          return;
        case "own-job":
          setNotice(COPY_INLINE.ownJob);
          return;
        case "unavailable":
          setNotice(COPY_INLINE.unavailable);
          return;
        case "unauthenticated":
          /**
           * Sin sesión tampoco se navega (2026-08-20): la hoja de
           * autenticación se abre ENCIMA del listado y, al volver, se reintenta
           * solo. Así postularse es cero navegaciones también para quien
           * todavía no tiene cuenta — que en un tablero de empleos es la mitad
           * de la gente que llega.
           *
           * El reintento vuelve a entrar por `open()` a propósito: el contexto
           * (preguntas del aviso + perfil de quien postula) hay que pedirlo de
           * nuevo, porque el primer viaje se resolvió como anónimo. No hay
           * bucle: si la sesión quedó hecha, el server ya no devuelve
           * "unauthenticated".
           */
          requireAuth({ reason: AUTH_REASON.apply, onAuthenticated: open });
      }
    });
  }

  return (
    <>
      {applied ? (
        <p
          role="status"
          className="mt-1 flex min-h-11 items-center justify-center gap-2 rounded-full border border-success/25 bg-success-bg px-4 text-sm font-semibold text-success-ink"
        >
          <CheckCircle size={17} weight="fill" aria-hidden="true" className="shrink-0" />
          {COPY_INLINE.applied}
        </p>
      ) : (
        <Button
          variant="primary"
          className="mt-1 w-full"
          loading={pending}
          aria-label={COPY_INLINE.ctaAria(jobTitle)}
          onClick={open}
        >
          {!pending && <PaperPlaneTilt size={18} weight="fill" aria-hidden="true" />}
          {COPY_INLINE.cta}
        </Button>
      )}

      {notice && (
        <p
          role="status"
          className="flex items-start gap-1.5 text-xs font-medium text-foreground-secondary"
        >
          <Warning size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          {notice}
        </p>
      )}

      {/* La hoja se DESMONTA al cerrarse: la próxima vez el contexto se vuelve a
          leer, y para entonces puede haber cambiado (otra pestaña, otro día). */}
      {sheet && (
        <JobApplySheet
          jobId={jobId}
          questions={sheet.questions}
          profile={sheet.profile}
          isLoggedIn
          openOnMount
          onApplied={() => setApplied(true)}
          onDismiss={() => setSheet(null)}
        />
      )}
    </>
  );
}
