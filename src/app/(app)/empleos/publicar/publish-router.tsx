"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { SealCheck } from "@phosphor-icons/react/dist/ssr";
import { Button, Dialog, EmptyState, buttonVariants } from "@/components/ui";
import { SectionTopBar, SHELL_COPY } from "@/components/shell";
import { COPY } from "@/components/empleos/copy";
import type { EmpleosKind } from "@/components/empleos/helpers";
import { KindPicker } from "./kind-picker";
import type { WizardHandle } from "./wizard-handle";
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
  const [confirmarVuelta, setConfirmarVuelta] = useState(false);
  /**
   * Lo llena el formulario que esté montado (ver `wizard-handle.ts`). Con
   * `kind === null` no hay ninguno y queda en null, que es exactamente lo que
   * hace que Volver salga del flujo desde el selector.
   */
  const wizard = useRef<WizardHandle | null>(null);

  /**
   * El "Volver" de arriba, de adentro hacia afuera — un paso por toque, nunca
   * un salto al vacío:
   *   1. si el formulario puede retroceder un paso, retrocede (es el MISMO
   *      `goBack` que el "Atrás" del pie: un solo camino, dos disparadores);
   *   2. si ya está en el primer paso, vuelve al selector de Empleo/Servicio,
   *      preguntando antes si hay algo escrito;
   *   3. y recién desde el selector se devuelve `false`, que es como se le
   *      dice a la barra "esto ya es tuyo": ahí sale de /empleos/publicar.
   */
  function alVolver(): boolean {
    if (wizard.current?.retroceder()) return true;
    if (kind) {
      if (wizard.current?.hayDatos()) {
        setConfirmarVuelta(true);
        return true;
      }
      setKind(null);
      return true;
    }
    return false;
  }

  const barra = <SectionTopBar fallbackHref="/empleos" onBack={alVolver} />;

  if (!kind) {
    return (
      <>
        {barra}
        <KindPicker onSelect={setKind} />
      </>
    );
  }

  const C = kind === "service" ? COPY.servicePublish : COPY.publish;

  return (
    <div className="flex flex-col gap-6">
      {barra}

      <header className="flex flex-col gap-2">
        {/* Acá vivía un botón "Cambiar" que deshacía la elección de
            Empleo/Servicio. Se fue el 2026-09-04: la barra de arriba hace
            exactamente eso desde el primer paso, y dos controles que hacen lo
            mismo obligan a elegir entre ellos antes de tocar cualquiera. */}
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {C.title}
        </h1>
        <p className="text-sm text-foreground-secondary">{C.subtitle}</p>
      </header>

      {kind === "service" ? (
        <ServicePublishForm currency={currency} wizardRef={wizard} />
      ) : identidadVerificada ? (
        <JobPublishForm
          tenantId={tenantId}
          currency={currency}
          businesses={businesses}
          wizardRef={wizard}
        />
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

      {/* Volver al selector descarta el borrador (el formulario se desmonta), y
          eso hay que preguntarlo — pero SÓLO cuando hay algo escrito. */}
      <Dialog
        open={confirmarVuelta}
        onClose={() => setConfirmarVuelta(false)}
        title={SHELL_COPY.leaveFormTitle}
        description={SHELL_COPY.leaveFormBody}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmarVuelta(false)}>
              {SHELL_COPY.leaveFormCancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmarVuelta(false);
                setKind(null);
              }}
            >
              {SHELL_COPY.leaveFormConfirm}
            </Button>
          </>
        }
      />
    </div>
  );
}
