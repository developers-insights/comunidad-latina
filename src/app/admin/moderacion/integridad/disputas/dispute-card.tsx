"use client";

import { useActionState } from "react";
import {
  ArrowUUpLeft,
  Gavel,
  LinkSimple,
  MagnifyingGlass,
  ShieldWarning,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, Textarea } from "@/components/ui";
import { formatAdminDateTime } from "@/components/admin/format";
import { PendingButton } from "@/components/admin/pending-button";
import { licenseLabel } from "@/lib/integrity/declarations";
import {
  DISPUTAS_ADMIN_COPY,
  DISPUTE_DECISIONS,
  LIVE_DISPUTE_STATUSES,
  RESOLUTION_NOTE_MAX,
  assetReviewLabel,
  claimKindLabel,
  disputeStatusMeta,
  isSafeHttpUrl,
} from "@/lib/integrity/disputes";
import { resolveDispute, type ResolveDisputeState } from "./actions";

/**
 * =============================================================================
 * TARJETA DE UN RECLAMO DE CONTENIDO
 * =============================================================================
 *
 * LO QUE ESTA PANTALLA TIENE QUE LOGRAR EN UN VISTAZO: que no se lea como la
 * tarjeta de una alerta de huella. Son dos cosas distintas y quien decide decide
 * distinto en cada una:
 *
 *   · UNA ALERTA es una MEDICIÓN — dos archivos, una distancia en bits, cero
 *     opinión. El riesgo ahí es tratar una sospecha como una certeza.
 *   · UN RECLAMO es una AFIRMACIÓN — alguien dice algo que puede ser falso, y del
 *     otro lado hay una persona que puede tener razón. El riesgo acá es el
 *     inverso: tratar una acusación como un hecho.
 *
 * Por eso las dos partes se muestran SIMÉTRICAS —quién reclama y quién subió, con
 * el mismo peso visual— y la declaración del uploader va al lado del relato del
 * reclamante, no escondida abajo. Si el reclamo se viera solo, la herramienta
 * estaría empujando a fallar en su contra.
 *
 * ⚠️ LOS LINKS DE EVIDENCIA SE VUELVEN A VALIDAR ACÁ. La action de usuario ya
 * rechaza cualquier esquema que no sea http/https, pero esta tarjeta la mira
 * alguien con permisos de staff: un `javascript:` que entrara por otro camino
 * (una fila vieja, un INSERT directo) se convertiría en un click privilegiado.
 * Filtrar de nuevo en el render cuesta nada y cierra ese camino entero.
 */

export interface DisputeAssetData {
  reviewStatus: string;
  mediaKind: string;
  subjectKind: string;
  filename: string | null;
  shortHash: string | null;
  firstUploadedAt: string;
  originalityDeclared: boolean;
  licenseKind: string;
  licenseStatement: string | null;
}

export interface DisputeCardData {
  id: string;
  status: string;
  claimKind: string;
  claimText: string;
  evidenceUrls: string[];
  createdAt: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  claimantName: string | null;
  respondentName: string | null;
  asset: DisputeAssetData | null;
}

const INITIAL_STATE: ResolveDisputeState = { status: "idle" };

const DECISION_ICONS = {
  revisar: MagnifyingGlass,
  a_favor_reclamante: Gavel,
  a_favor_uploader: ArrowUUpLeft,
  descartar: XCircle,
} as const;

function PartyBlock({
  label,
  name,
  detail,
}: {
  label: string;
  name: string | null;
  detail?: string | null;
}) {
  return (
    <div className="rounded-md bg-surface-subtle px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-foreground">
        {name ?? DISPUTAS_ADMIN_COPY.deletedAccount}
      </p>
      {detail && <p className="text-xs text-foreground-secondary">{detail}</p>}
    </div>
  );
}

export function DisputeCard({ dispute }: { dispute: DisputeCardData }) {
  const [state, formAction] = useActionState(resolveDispute, INITIAL_STATE);
  const meta = disputeStatusMeta(dispute.status);
  const { asset } = dispute;
  const isLive = LIVE_DISPUTE_STATUSES.includes(
    dispute.status as (typeof LIVE_DISPUTE_STATUSES)[number],
  );
  const safeEvidence = dispute.evidenceUrls.filter(isSafeHttpUrl);
  const noteId = `dispute-note-${dispute.id}`;

  return (
    <article className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant={meta.badge}>{meta.label}</Badge>
        <Badge variant="neutral">{claimKindLabel(dispute.claimKind)}</Badge>
        <span className="ml-auto text-xs tabular-nums text-foreground-muted">
          {formatAdminDateTime(dispute.createdAt)}
        </span>
      </header>

      <p className="mt-2 text-sm text-foreground-secondary">{meta.meaning}</p>

      {/* ---- Las dos partes, con el mismo peso -------------------------- */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <PartyBlock label={DISPUTAS_ADMIN_COPY.claimant} name={dispute.claimantName} />
        <PartyBlock label={DISPUTAS_ADMIN_COPY.respondent} name={dispute.respondentName} />
      </div>

      {/* ---- Lo que dice quien reclama ---------------------------------- */}
      <section className="mt-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          {DISPUTAS_ADMIN_COPY.claimTextTitle}
        </h4>
        <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-foreground">
          {dispute.claimText}
        </p>
      </section>

      {/* ---- Evidencia --------------------------------------------------- */}
      <section className="mt-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          {DISPUTAS_ADMIN_COPY.evidenceTitle}
        </h4>
        {safeEvidence.length === 0 ? (
          <p className="mt-1 text-sm text-foreground-muted">
            {DISPUTAS_ADMIN_COPY.evidenceEmpty}
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {safeEvidence.map((url) => (
              <li key={url} className="flex min-w-0 items-start gap-1.5">
                <LinkSimple
                  size={14}
                  aria-hidden="true"
                  className="mt-1 shrink-0 text-foreground-muted"
                />
                <a
                  href={url}
                  target="_blank"
                  // `noreferrer` además de `noopener`: la URL del panel no viaja
                  // al sitio que aportó quien reclama.
                  rel="noopener noreferrer nofollow"
                  className="min-w-0 break-all text-sm text-info underline decoration-info/40 underline-offset-2 transition-colors duration-(--duration-fast) hover:decoration-info focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- El archivo y lo que declaró quien lo subió ------------------- */}
      {asset && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <section className="rounded-md border border-border-subtle px-3 py-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {DISPUTAS_ADMIN_COPY.assetTitle}
            </h4>
            <p className="mt-1 text-sm font-medium text-foreground">
              {assetReviewLabel(asset.reviewStatus)}
            </p>
            <p className="text-xs text-foreground-secondary">
              {asset.mediaKind} · {asset.subjectKind}
            </p>
            <p className="text-xs tabular-nums text-foreground-muted">
              {formatAdminDateTime(asset.firstUploadedAt)}
            </p>
            {asset.filename && (
              <p className="mt-1 break-all text-xs text-foreground-muted">{asset.filename}</p>
            )}
            {asset.shortHash && (
              <p className="font-mono text-xs text-foreground-muted">{asset.shortHash}…</p>
            )}
          </section>

          <section className="rounded-md border border-border-subtle px-3 py-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {DISPUTAS_ADMIN_COPY.declarationTitle}
            </h4>
            <p className="mt-1 text-sm text-foreground">
              {asset.originalityDeclared
                ? DISPUTAS_ADMIN_COPY.declaredOriginal
                : DISPUTAS_ADMIN_COPY.noDeclaration}
            </p>
            <p className="text-sm text-foreground-secondary">{licenseLabel(asset.licenseKind)}</p>
            {asset.licenseStatement && (
              <p className="mt-1 break-words text-sm text-foreground-secondary">
                “{asset.licenseStatement}”
              </p>
            )}
            <p className="mt-1.5 text-xs text-foreground-muted">
              {DISPUTAS_ADMIN_COPY.declarationDisclaimer}
            </p>
          </section>
        </div>
      )}

      {/* ---- Si ya está resuelto, el rastro de la decisión ---------------- */}
      {!isLive && (
        <section className="mt-3 rounded-md bg-surface-subtle px-3 py-2.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            {DISPUTAS_ADMIN_COPY.resolutionTitle}
          </h4>
          <p className="mt-1 text-sm text-foreground">
            {dispute.resolvedByName ?? DISPUTAS_ADMIN_COPY.deletedAccount}
            {dispute.resolvedAt && (
              <span className="text-foreground-secondary">
                {" · "}
                {DISPUTAS_ADMIN_COPY.resolvedAt} {formatAdminDateTime(dispute.resolvedAt)}
              </span>
            )}
          </p>
          {dispute.resolutionNote && (
            <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground-secondary">
              “{dispute.resolutionNote}”
            </p>
          )}
        </section>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-foreground-muted">
        <ShieldWarning size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
        {DISPUTAS_ADMIN_COPY.disclaimer}
      </p>

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.message}
        </p>
      )}

      {isLive && (
        <form action={formAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="disputeId" value={dispute.id} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor={noteId} className="text-xs font-semibold text-foreground">
              {DISPUTAS_ADMIN_COPY.noteLabel}
            </label>
            <Textarea
              id={noteId}
              name="note"
              rows={2}
              maxLength={RESOLUTION_NOTE_MAX}
              placeholder={DISPUTAS_ADMIN_COPY.notePlaceholder}
              aria-describedby={`${noteId}-help`}
            />
            <p id={`${noteId}-help`} className="text-xs text-foreground-muted">
              {DISPUTAS_ADMIN_COPY.noteHelp}
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {(Object.keys(DISPUTE_DECISIONS) as (keyof typeof DISPUTE_DECISIONS)[]).map(
              (decision) => {
                const spec = DISPUTE_DECISIONS[decision];
                const IconComponent = DECISION_ICONS[decision];
                const isBlocking = decision === "a_favor_reclamante";
                return (
                  <PendingButton
                    key={decision}
                    variant={decision === "descartar" ? "ghost" : "outline"}
                    size="sm"
                    name="decision"
                    value={decision}
                    type="submit"
                    title={spec.hint}
                    className={isBlocking ? "border-danger/40 text-danger hover:bg-danger-bg" : undefined}
                  >
                    <IconComponent size={16} aria-hidden="true" />
                    {spec.label}
                  </PendingButton>
                );
              },
            )}
          </div>

          <p className="text-right text-xs text-foreground-muted">
            {DISPUTE_DECISIONS.a_favor_reclamante.hint}
          </p>
        </form>
      )}
    </article>
  );
}
