"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUUpLeft, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/empleos/copy";
import type { EmpleosKind } from "@/components/empleos/helpers";
import { cn } from "@/lib/utils";
import { KindPicker } from "./kind-picker";
import { JobPublishForm, type BusinessOption } from "./publish-form";
import { ServicePublishForm } from "./service-form";

/**
 * /empleos/publicar — elegir PRIMERO qué se publica, y recién después el
 * formulario que corresponde.
 *
 * ── POR QUÉ EL GATE DE IDENTIDAD SE MUDÓ ACÁ ───────────────────────────────
 * Antes lo resolvía `page.tsx` y cortaba la PANTALLA ENTERA: publicar un empleo
 * exige identidad verificada (`job` ∈ VERTICALES_QUE_EXIGEN_IDENTIDAD, y la
 * policy `listings_insert` de la 0126 la exige igual), así que ofrecer los
 * cuatro pasos a quien no puede publicar era hacerle escribir el puesto, el
 * sueldo y las preguntas para rechazarlo al final.
 *
 * Con el selector arriba eso deja de ser cierto: un SERVICIO no está en esa
 * lista —ni en la policy— y cortar la pantalla completa le cerraría la puerta al
 * jardinero por un requisito que su aviso no tiene. Así que el bloqueo baja un
 * nivel: se muestra cuando alguien elige "Empleo", que es exactamente cuando
 * empieza a regir, y sigue apareciendo ANTES del formulario y no al enviarlo.
 *
 * El estado vive en `useState` y no en la URL a propósito: es una elección de
 * UN toque que se deshace con "Cambiar", y un `?tipo=` acá dejaría links
 * compartibles a medio wizard que después no se pueden retomar (el borrador vive
 * en la memoria del formulario hasta que se crea).
 */
export function PublishRouter({
  tenantId,
  currency,
  businesses = [],
  identidadVerificada,
}: {
  tenantId: string;
  currency: string;
  businesses?: readonly BusinessOption[];
  /**
   * Lo resuelve el servidor con `requireIdentidadVerificada` — la MISMA función
   * que usa la server action. Una sola fuente para la regla, dos momentos para
   * preguntarla.
   */
  identidadVerificada: boolean;
}) {
  const [kind, setKind] = useState<EmpleosKind | null>(null);

  if (!kind) return <KindPicker onSelect={setKind} />;

  const C = kind === "service" ? COPY.servicePublish : COPY.publish;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        {/* "Cambiar" es del SELECTOR, no el "volver atrás" general de la app:
            deshace la única decisión que este wizard toma antes de empezar.
            Va arriba del título porque ahí es donde se busca al darse cuenta de
            que se eligió mal. */}
        <button
          type="button"
          onClick={() => setKind(null)}
          className={cn(
            "-ml-1 flex w-max min-h-11 items-center gap-1.5 rounded-full px-2.5",
            "text-sm font-semibold text-foreground-secondary",
            "transition-colors duration-(--duration-fast) hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <ArrowUUpLeft size={16} weight="bold" aria-hidden="true" />
          {COPY.kindPicker.change}
        </button>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {C.title}
        </h1>
        <p className="text-sm text-foreground-secondary">{C.subtitle}</p>
      </header>

      {kind === "service" ? (
        <ServicePublishForm currency={currency} />
      ) : identidadVerificada ? (
        <JobPublishForm tenantId={tenantId} currency={currency} businesses={businesses} />
      ) : (
        <EmptyState
          icon={<SealCheck />}
          title={COPY.publish.needIdentityTitle}
          message={COPY.publish.needIdentityBody}
          action={
            <Link
              href={`/perfil/verificar?next=${encodeURIComponent("/empleos/publicar")}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {COPY.publish.needIdentityCta}
            </Link>
          }
          className="py-14"
        />
      )}
    </div>
  );
}
