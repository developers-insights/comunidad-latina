"use client";

import { useActionState } from "react";
import { Check, Prohibit, MagnifyingGlass, XCircle } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui";
import { formatAdminDateTime } from "@/components/admin/format";
import { PendingButton } from "@/components/admin/pending-button";
import { licenseLabel } from "@/lib/integrity/declarations";
import { resolveIntegrityAlert, type ResolveIntegrityState } from "./actions";

/**
 * =============================================================================
 * TARJETA DE UNA ALERTA DE INTEGRIDAD
 * =============================================================================
 *
 * LO QUE ESTA PANTALLA TIENE QUE LOGRAR EN UN VISTAZO: que "es el mismo
 * archivo" y "se parece" NO se lean igual. Son dos cosas distintas y el
 * moderador decide distinto en cada una:
 *
 *   · MISMO ARCHIVO (sha256) — determinístico, sin margen de error. Los bytes
 *     son idénticos. Lo que queda por decidir es de QUIÉN es, no si son iguales.
 *   · SE PARECE (huella perceptual) — probabilístico. Puede ser la misma foto
 *     recomprimida… o dos fotos distintas del mismo lugar. La distancia se
 *     muestra siempre, en bits, porque un número sin escala no dice nada.
 *
 * Por eso el color, el ícono, el título y el texto explicativo cambian: si las
 * dos alertas se vieran igual, la herramienta estaría empujando al moderador a
 * tratar una sospecha como una certeza.
 *
 * ⚠️ EL AVISO QUE NO SE SACA. El pliego lo dice expresamente y está escrito en
 * la tarjeta: la huella es una herramienta técnica interna, NO una prueba de
 * propiedad intelectual. Nada acá puede leerse como "la plataforma determinó
 * que esto es robado".
 */

export interface IntegrityVersionData {
  version: number;
  createdAt: string;
  shortHash: string | null;
  reason: string | null;
}

export interface IntegrityAssetData {
  id: string;
  subjectKind: string;
  subjectId: string | null;
  mediaKind: string;
  uploaderName: string | null;
  firstUploadedAt: string;
  sourceHost: string;
  filename: string | null;
  shortHash: string | null;
  reviewStatus: string;
  originalityDeclared: boolean;
  licenseKind: string;
  licenseStatement: string | null;
  licenseUrl: string | null;
  versions: IntegrityVersionData[];
}

export interface IntegrityCounterpartData {
  uploaderName: string | null;
  firstUploadedAt: string;
  shortHash: string | null;
  subjectKind: string;
}

export interface IntegrityAlertData {
  id: string;
  kind: string;
  severity: string;
  status: string;
  detail: string | null;
  createdAt: string;
  algorithm: string | null;
  distance: number | null;
  asset: IntegrityAssetData;
  counterpart: IntegrityCounterpartData | null;
}

const COPY = {
  actions: {
    approve: "Aprobar",
    block: "Bloquear",
    investigate: "Investigar",
    dismiss: "Descartar",
  },
  disclaimer:
    "La huella es una herramienta interna para ordenar la revisión: no prueba quién es el autor ni si hay una infracción. Eso lo decidís vos, con el contexto.",
  uploadedBy: "Subió",
  from: "Desde",
  versionsTitle: "Versiones de este archivo",
  versionsEmpty: "Una sola versión: nunca se reemplazó.",
  declarationTitle: "Lo que declaró quien lo subió",
  declarationDisclaimer: "Es una afirmación suya. La plataforma no la verificó.",
  noDeclaration: "No declaró originalidad.",
  declaredOriginal: "Declaró que es material propio o con permiso.",
  counterpartTitle: "Archivo anterior con el que coincide",
  inInvestigation: "En investigación",
  blockWarning: "Bloquear también da de baja la publicación que usa este archivo.",
} as const;

/** Ancho de la huella según el algoritmo. Sin esto, la distancia no tiene escala. */
const ALGORITHM_BITS: Record<string, number> = {
  phash: 64,
  video_phash: 256,
  audio_phash: 256,
};

interface KindPresentation {
  title: string;
  explanation: string;
  badge: "danger" | "warning" | "neutral";
  badgeLabel: string;
}

function present(alert: IntegrityAlertData): KindPresentation {
  if (alert.kind === "duplicado_exacto") {
    return {
      title: "Es el mismo archivo",
      explanation:
        "Los dos archivos son idénticos byte a byte: tienen el mismo SHA-256. En esto no hay margen de error — lo que queda por decidir es de quién es.",
      badge: "danger",
      badgeLabel: "Mismo archivo",
    };
  }
  if (alert.kind === "coincidencia_similar") {
    const bits = ALGORITHM_BITS[alert.algorithm ?? "phash"] ?? 64;
    const distance = alert.distance ?? 0;
    return {
      title: "Se parece a otro archivo",
      explanation:
        `Las huellas se diferencian en ${distance} de ${bits} bits. Se parecen, pero NO son el mismo archivo: ` +
        "puede ser la misma foto recomprimida o recortada, o dos fotos distintas de lo mismo.",
      badge: "warning",
      badgeLabel: "Se parece",
    };
  }
  if (alert.kind === "licencia_faltante") {
    return {
      title: "Subió sin aclarar de dónde salió",
      explanation:
        "No declaró originalidad ni licencia. No es una falta en sí: es el caso que después cuesta defender si alguien reclama.",
      badge: "neutral",
      badgeLabel: "Sin declaración",
    };
  }
  return {
    title: "Revisión de originalidad",
    explanation: alert.detail ?? "El pipeline marcó este archivo para revisión.",
    badge: "warning",
    badgeLabel: "Originalidad",
  };
}

const initialState: ResolveIntegrityState = { status: "idle" };

export function IntegrityAlertCard({ alert }: { alert: IntegrityAlertData }) {
  const [state, formAction] = useActionState(resolveIntegrityAlert, initialState);
  const view = present(alert);
  const { asset } = alert;

  return (
    <article className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant={view.badge}>{view.badgeLabel}</Badge>
        {alert.status === "en_investigacion" && (
          <Badge variant="info">{COPY.inInvestigation}</Badge>
        )}
        <span className="ml-auto text-xs tabular-nums text-foreground-muted">
          {formatAdminDateTime(alert.createdAt)}
        </span>
      </header>

      <h3 className="mt-3 font-display text-base font-bold text-foreground">{view.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
        {view.explanation}
      </p>

      {/* ---- Evidencia: los dos archivos, lado a lado ------------------- */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md bg-surface-subtle px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            Este archivo
          </p>
          <p className="mt-1 text-sm text-foreground">
            {COPY.uploadedBy} {asset.uploaderName ?? "una cuenta borrada"}
          </p>
          <p className="text-xs tabular-nums text-foreground-secondary">
            {formatAdminDateTime(asset.firstUploadedAt)}
          </p>
          <p className="text-xs text-foreground-muted">
            {COPY.from} {asset.sourceHost}
          </p>
          {asset.shortHash && (
            <p className="mt-1 font-mono text-xs text-foreground-muted">{asset.shortHash}…</p>
          )}
        </div>

        {alert.counterpart && (
          <div className="rounded-md bg-surface-subtle px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {COPY.counterpartTitle}
            </p>
            <p className="mt-1 text-sm text-foreground">
              {COPY.uploadedBy} {alert.counterpart.uploaderName ?? "una cuenta borrada"}
            </p>
            <p className="text-xs tabular-nums text-foreground-secondary">
              {formatAdminDateTime(alert.counterpart.firstUploadedAt)}
            </p>
            {alert.counterpart.shortHash && (
              <p className="mt-1 font-mono text-xs text-foreground-muted">
                {alert.counterpart.shortHash}…
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---- Historial de versiones -------------------------------------- */}
      <section className="mt-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          {COPY.versionsTitle}
        </h4>
        {asset.versions.length === 0 ? (
          <p className="mt-1 text-sm text-foreground-muted">{COPY.versionsEmpty}</p>
        ) : (
          <ol className="mt-1 flex flex-col gap-1">
            {asset.versions.map((version) => (
              <li
                key={version.version}
                className="flex flex-wrap items-baseline gap-2 text-sm text-foreground-secondary"
              >
                <span className="font-semibold tabular-nums text-foreground">
                  v{version.version}
                </span>
                <span className="text-xs tabular-nums">
                  {formatAdminDateTime(version.createdAt)}
                </span>
                {version.shortHash && (
                  <span className="font-mono text-xs text-foreground-muted">
                    {version.shortHash}…
                  </span>
                )}
                {version.reason && <span className="text-xs">{version.reason}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ---- Declaración del que subió ----------------------------------- */}
      <section className="mt-3 rounded-md border border-border-subtle px-3 py-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          {COPY.declarationTitle}
        </h4>
        <p className="mt-1 text-sm text-foreground">
          {asset.originalityDeclared ? COPY.declaredOriginal : COPY.noDeclaration}
        </p>
        <p className="text-sm text-foreground-secondary">{licenseLabel(asset.licenseKind)}</p>
        {asset.licenseStatement && (
          <p className="mt-1 break-words text-sm text-foreground-secondary">
            “{asset.licenseStatement}”
          </p>
        )}
        {asset.licenseUrl && (
          <p className="mt-1 break-all text-xs text-foreground-muted">{asset.licenseUrl}</p>
        )}
        <p className="mt-1.5 text-xs text-foreground-muted">{COPY.declarationDisclaimer}</p>
      </section>

      <p className="mt-3 text-xs leading-relaxed text-foreground-muted">{COPY.disclaimer}</p>

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.message}
        </p>
      )}

      <form action={formAction} className="mt-4 flex flex-wrap justify-end gap-2">
        <input type="hidden" name="alertId" value={alert.id} />
        <PendingButton variant="ghost" size="sm" name="decision" value="descartar" type="submit">
          <XCircle size={16} aria-hidden="true" />
          {COPY.actions.dismiss}
        </PendingButton>
        <PendingButton
          variant="outline"
          size="sm"
          name="decision"
          value="investigar"
          type="submit"
        >
          <MagnifyingGlass size={16} aria-hidden="true" />
          {COPY.actions.investigate}
        </PendingButton>
        <PendingButton
          variant="outline"
          size="sm"
          name="decision"
          value="bloquear"
          type="submit"
          title={COPY.blockWarning}
          className="border-danger/40 text-danger hover:bg-danger-bg"
        >
          <Prohibit size={16} aria-hidden="true" />
          {COPY.actions.block}
        </PendingButton>
        <PendingButton variant="secondary" size="sm" name="decision" value="aprobar" type="submit">
          <Check size={16} aria-hidden="true" />
          {COPY.actions.approve}
        </PendingButton>
      </form>
      <p className="mt-1.5 text-right text-xs text-foreground-muted">{COPY.blockWarning}</p>
    </article>
  );
}
