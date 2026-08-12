"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import {
  ArrowSquareOut,
  CheckCircle,
  Circle,
  Prohibit,
  Question,
  ThumbsUp,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, Chip, Label, Textarea } from "@/components/ui";
import { formatAdminDate, formatAdminDateTime } from "@/components/admin/format";
import { PendingButton } from "@/components/admin/pending-button";
import { REASON_ADMIN_LABEL } from "@/lib/creators/eligibility-copy";
import type { EligibilityCheck } from "@/lib/creators/eligibility";
import { cn } from "@/lib/utils";
import { resolveCreatorActivation, type ResolveCreatorState } from "./actions";
import { NOTE_MAX_LENGTH, NOTE_MIN_LENGTH } from "./decisiones";

/**
 * =============================================================================
 * UNA SOLICITUD DE CREADOR, LISTA PARA DECIDIR
 * =============================================================================
 *
 * LA PREGUNTA QUE ESTA TARJETA TIENE QUE CONTESTAR SIN QUE NADIE ABRA OTRA
 * PESTAÑA: ¿por qué esta persona califica —o no— para cobrar en esta comunidad?
 *
 * Por eso el bloque grande no son los botones sino el detalle del gate: cada
 * requisito VIGENTE con su estado y su número. Una cola donde el moderador
 * tiene que adivinar por qué alguien no llega es una cola donde se aprueba por
 * cansancio.
 *
 * TRES ESTADOS POR REQUISITO, NUNCA DOS:
 *   · Cumple.
 *   · No cumple — con el número exacto que falta.
 *   · NO SE PUEDE VERIFICAR desde acá. La fecha de nacimiento y el apellido son
 *     datos privados (RLS solo-dueño) y ningún permiso de administración los
 *     abre. Pintar eso como "no cumple" sería acusar a alguien de incumplir con
 *     un dato que no tenemos. Se dice, y se cuenta aparte.
 *
 * LA APROBACIÓN DEL EQUIPO PESA MÁS QUE EL CORTE AUTOMÁTICO — y eso también se
 * dice. `admin_resolve_creator_activation` (0032) NO vuelve a evaluar el gate:
 * si el staff aprueba, se aprueba. Es una decisión de diseño de la base y
 * esconderla haría creer que el sistema frena algo que no frena.
 *
 * Accesibilidad: ningún estado se comunica solo con color — cada fila lleva su
 * ícono con `aria-label` y su texto. Los botones son `min-h` táctil vía el
 * `size="sm"` del design system (h-10) y el error va en `role="alert"`.
 */

export interface CreatorRequestCardData {
  profileId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  /** `profiles.created_at`. */
  memberSince: string | null;
  status: string;
  statusUpdatedAt: string | null;
  /**
   * Días en el estado actual, calculados EN EL SERVIDOR. Si se calcularan acá
   * contra `Date.now()`, el HTML del servidor y el del cliente podrían no
   * coincidir y React tiraría un mismatch de hidratación.
   */
  waitedDays: number | null;
  headline: string;
  categories: string[];
  rateHint: string | null;
  portfolioItems: number | null;
  creatorTermsAcceptedAt: string | null;
  /** Solo los requisitos VIGENTES según la configuración del tenant. */
  checks: EligibilityCheck[];
}

const COPY = {
  unknownName: "Cuenta sin perfil legible",
  waiting: (days: number) =>
    days <= 0 ? "Se actualizó hoy" : days === 1 ? "Espera hace 1 día" : `Espera hace ${days} días`,
  memberSince: "En la comunidad desde",
  presentedTitle: "Lo que presentó",
  noHeadline: "No escribió una presentación.",
  portfolio: (n: number) => (n === 1 ? "1 ejemplo de portafolio" : `${n} ejemplos de portafolio`),
  portfolioUnknown: "Portafolio sin contar",
  rate: "Tarifa orientativa",
  termsAccepted: "Términos de creador aceptados",
  requirementsTitle: "Requisitos de tu comunidad",
  requirementsNone:
    "Tu comunidad no exige ningún requisito automático: la decisión es toda tuya.",
  progress: (met: number, total: number) => `${met} de ${total} en verde`,
  missingNote: (n: number) =>
    n === 1
      ? "Le falta 1 requisito. Podés aprobarla igual: la decisión del equipo pesa más que el corte automático, y la base no la vuelve a chequear."
      : `Le faltan ${n} requisitos. Podés aprobarla igual: la decisión del equipo pesa más que el corte automático, y la base no la vuelve a chequear.`,
  unknownNote: (n: number) =>
    n === 1
      ? "Hay 1 requisito que no se puede verificar desde el panel. No cuenta como incumplido."
      : `Hay ${n} requisitos que no se pueden verificar desde el panel. No cuentan como incumplidos.`,
  viewProfile: "Ver su perfil de creador",
  noteLabel: "Motivo",
  noteHint: `Obligatorio para pedir datos, rechazar o suspender (mínimo ${NOTE_MIN_LENGTH} caracteres).`,
  noteWarning:
    "Todavía no se lo enviamos automáticamente: escribile por mensaje privado con este mismo texto para que sepa qué hacer.",
  notePlaceholder: "Ej.: las fotos del portafolio no muestran trabajos propios.",
  actions: {
    approve: "Aprobar",
    needsInfo: "Pedir más datos",
    reject: "Rechazar",
    suspend: "Suspender",
    reactivate: "Volver a aprobar",
  },
} as const;

interface StatusPresentation {
  label: string;
  badge: "neutral" | "brand" | "success" | "warning" | "danger" | "info";
}

const STATUS: Record<string, StatusPresentation> = {
  platform_review_pending: { label: "Para revisar", badge: "warning" },
  documents_pending: { label: "Faltan documentos", badge: "warning" },
  stripe_review_pending: { label: "Revisión de cobros", badge: "warning" },
  needs_info: { label: "Esperando su respuesta", badge: "info" },
  approved: { label: "Aprobada", badge: "success" },
  rejected: { label: "Rechazada", badge: "danger" },
  suspended: { label: "Suspendida", badge: "danger" },
};

/** Estados en los que la solicitud todavía está abierta. */
const OPEN_STATUSES = new Set([
  "platform_review_pending",
  "documents_pending",
  "stripe_review_pending",
  "needs_info",
]);

const numberFormat = new Intl.NumberFormat("es-US");
const num = (value: number) => numberFormat.format(value);

/**
 * El requisito dicho para quien REVISA, no para quien solicita.
 *
 * `eligibility-copy.ts` ya traduce los códigos, pero en segunda persona ("te
 * faltan 40 seguidores") porque su lector es el aspirante. Acá el lector es otro
 * y necesita otra cosa: el dato al lado del corte, corto, para comparar de un
 * vistazo. La etiqueta sí se reusa —`REASON_ADMIN_LABEL`, que existe justamente
 * para el panel— así que un código nuevo en una migración futura sigue teniendo
 * una sola fuente de nombres.
 */
function describeForReviewer(check: EligibilityCheck): string {
  if (check.status === "unknown") return "No se puede verificar desde el panel";

  const hasNumbers = check.current !== null && check.target !== null;
  if (check.status === "met") {
    return hasNumbers ? `Cumple — ${num(check.current!)} (se piden ${num(check.target!)})` : "Cumple";
  }
  if (hasNumbers) {
    return `Tiene ${num(check.current!)} y se piden ${num(check.target!)}`;
  }
  return "No cumple";
}

function CheckIcon({ status }: { status: EligibilityCheck["status"] }) {
  if (status === "met") {
    return (
      <CheckCircle size={16} weight="fill" aria-label="Cumple" className="mt-0.5 shrink-0 text-success" />
    );
  }
  if (status === "unknown") {
    return (
      <WarningCircle
        size={16}
        weight="fill"
        aria-label="Sin verificar"
        className="mt-0.5 shrink-0 text-foreground-muted"
      />
    );
  }
  return <Circle size={16} aria-label="No cumple" className="mt-0.5 shrink-0 text-warning" />;
}

const initialState: ResolveCreatorState = { status: "idle" };

export function SolicitudCard({ request }: { request: CreatorRequestCardData }) {
  const [state, formAction] = useActionState(resolveCreatorActivation, initialState);
  const [note, setNote] = useState("");
  const noteId = useId();
  const noteHintId = useId();

  const view = STATUS[request.status] ?? { label: request.status, badge: "neutral" as const };
  const name = request.displayName ?? COPY.unknownName;
  const met = request.checks.filter((check) => check.status === "met").length;
  const missing = request.checks.filter((check) => check.status === "missing").length;
  const unknown = request.checks.filter((check) => check.status === "unknown").length;

  const isOpen = OPEN_STATUSES.has(request.status);
  const noteReady = note.trim().length >= NOTE_MIN_LENGTH;

  return (
    <article className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      {/* ---- Quién es ------------------------------------------------------ */}
      <header className="flex flex-wrap items-start gap-3">
        <Avatar src={request.avatarUrl} name={name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-display text-base font-bold text-foreground">{name}</h3>
            {request.username && (
              <span className="text-sm text-foreground-muted">@{request.username}</span>
            )}
            <Badge variant={view.badge}>{view.label}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-foreground-secondary">
            {request.memberSince && (
              <>
                {COPY.memberSince} {formatAdminDate(request.memberSince)}
              </>
            )}
            {request.memberSince && request.waitedDays !== null && (
              <span aria-hidden="true"> · </span>
            )}
            {request.waitedDays !== null && (
              <span className="numeric">{COPY.waiting(request.waitedDays)}</span>
            )}
          </p>
          {request.statusUpdatedAt && (
            <p className="text-xs tabular-nums text-foreground-muted">
              {formatAdminDateTime(request.statusUpdatedAt)}
            </p>
          )}
        </div>
        <Link
          href={`/creadores/perfil/${request.profileId}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground-secondary transition-colors duration-(--duration-fast) ease-(--ease-out-premium) hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          {COPY.viewProfile}
          <ArrowSquareOut size={14} aria-hidden="true" />
        </Link>
      </header>

      {/* ---- Lo que presentó ----------------------------------------------- */}
      <section className="mt-3 rounded-md bg-surface-subtle px-3 py-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          {COPY.presentedTitle}
        </h4>
        <p
          className={cn(
            "mt-1 text-sm leading-relaxed",
            request.headline ? "text-foreground" : "text-foreground-muted",
          )}
        >
          {request.headline || COPY.noHeadline}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {request.categories.map((category) => (
            <Chip key={category} size="sm" variant="brand">
              {category}
            </Chip>
          ))}
          <Chip size="sm" variant={request.portfolioItems === null ? "warning" : "neutral"}>
            {request.portfolioItems === null
              ? COPY.portfolioUnknown
              : COPY.portfolio(request.portfolioItems)}
          </Chip>
          {request.rateHint && (
            <Chip size="sm" variant="neutral">
              {COPY.rate}: {request.rateHint}
            </Chip>
          )}
          {request.creatorTermsAcceptedAt && (
            <Chip size="sm" variant="success">
              {COPY.termsAccepted}
            </Chip>
          )}
        </div>
      </section>

      {/* ---- El gate, requisito por requisito ------------------------------ */}
      <section className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            {COPY.requirementsTitle}
          </h4>
          {request.checks.length > 0 && (
            <Badge variant={missing === 0 && unknown === 0 ? "success" : "neutral"}>
              {COPY.progress(met, request.checks.length)}
            </Badge>
          )}
        </div>

        {request.checks.length === 0 ? (
          <p className="mt-1 text-sm text-foreground-secondary">{COPY.requirementsNone}</p>
        ) : (
          <ul className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {request.checks.map((check) => (
              <li key={check.reason} className="flex items-start gap-2">
                <CheckIcon status={check.status} />
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      check.status === "met" ? "text-foreground-secondary" : "text-foreground",
                    )}
                  >
                    {REASON_ADMIN_LABEL[check.reason]}
                  </p>
                  <p className="text-xs leading-relaxed text-foreground-secondary">
                    {describeForReviewer(check)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {missing > 0 && (
          <p className="mt-2.5 rounded-md bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning-ink">
            {COPY.missingNote(missing)}
          </p>
        )}
        {unknown > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-foreground-muted">
            {COPY.unknownNote(unknown)}
          </p>
        )}
      </section>

      {/* ---- La decisión ---------------------------------------------------- */}
      <form action={formAction} className="mt-4 border-t border-border-subtle pt-3">
        <input type="hidden" name="profileId" value={request.profileId} />

        <Label htmlFor={noteId}>{COPY.noteLabel}</Label>
        <Textarea
          id={noteId}
          name="note"
          rows={2}
          maxLength={NOTE_MAX_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-describedby={noteHintId}
          placeholder={COPY.notePlaceholder}
          className="mt-1"
        />
        <p id={noteHintId} className="mt-1 text-xs leading-relaxed text-foreground-muted">
          {COPY.noteHint}{" "}
          <span className="numeric">
            {note.trim().length}/{NOTE_MAX_LENGTH}
          </span>
          <br />
          {COPY.noteWarning}
        </p>

        {state.status === "error" && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {state.message}
          </p>
        )}
        {state.status === "success" && (
          <p role="status" className="mt-2 text-sm text-success-ink">
            {state.message}
          </p>
        )}

        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {isOpen && (
            <>
              <PendingButton
                variant="outline"
                size="sm"
                type="submit"
                name="decision"
                value="rejected"
                disabled={!noteReady}
                className="border-danger/40 text-danger hover:bg-danger-bg"
              >
                <XCircle size={16} aria-hidden="true" />
                {COPY.actions.reject}
              </PendingButton>
              <PendingButton
                variant="outline"
                size="sm"
                type="submit"
                name="decision"
                value="needs_info"
                disabled={!noteReady}
              >
                <Question size={16} aria-hidden="true" />
                {COPY.actions.needsInfo}
              </PendingButton>
              <PendingButton variant="primary" size="sm" type="submit" name="decision" value="approved">
                <ThumbsUp size={16} aria-hidden="true" />
                {COPY.actions.approve}
              </PendingButton>
            </>
          )}

          {request.status === "approved" && (
            <PendingButton
              variant="outline"
              size="sm"
              type="submit"
              name="decision"
              value="suspended"
              disabled={!noteReady}
              className="border-danger/40 text-danger hover:bg-danger-bg"
            >
              <Prohibit size={16} aria-hidden="true" />
              {COPY.actions.suspend}
            </PendingButton>
          )}

          {(request.status === "rejected" || request.status === "suspended") && (
            <PendingButton variant="secondary" size="sm" type="submit" name="decision" value="approved">
              <ThumbsUp size={16} aria-hidden="true" />
              {COPY.actions.reactivate}
            </PendingButton>
          )}
        </div>
      </form>
    </article>
  );
}
