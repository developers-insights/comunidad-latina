"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CloudSlash } from "@phosphor-icons/react/dist/ssr";
import { ThemeToggle } from "@/components/theme";
import { Button, EmptyState, buttonVariants } from "@/components/ui";

/**
 * Error boundary global (§3.5): error cálido, jamás un stack trace ni jerga.
 * "No es tu culpa" es literal del design brief — nuestro público interpreta
 * pantallas rotas como estafa o como "hice algo mal". Reintentar via reset().
 *
 * El toggle de tema va acá, aunque los layouts ya lo monten: un `error.tsx`
 * reemplaza a los HIJOS del layout de su segmento, no al layout de arriba
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 * Este vive en la raíz, así que se come al de (app)/(marketing)/(auth)/admin —
 * con su header y su toggle— y sólo queda el root layout, que no monta ninguno.
 * Mismo remedio y misma posición que en (auth)/layout.tsx.
 */

const COPY = {
  title: "Algo no cargó bien de nuestro lado",
  message:
    "No es tu culpa. Ya quedó registrado para que lo revisemos — probá de nuevo en unos segundos.",
  retry: "Reintentar",
  home: "Ir al inicio",
} as const;

export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log técnico solo en consola (y a Sentry vía instrumentation cuando esté
    // configurado). Nunca PII: digest + message alcanzan para rastrear.
    console.error("[app] error boundary", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4">
      {/* Primero en el DOM porque es lo primero que se lee arriba a la derecha;
          `top` respeta el notch (el root layout usa viewportFit: cover). */}
      <ThemeToggle className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10" />
      <EmptyState
        icon={<CloudSlash weight="light" />}
        title={COPY.title}
        message={COPY.message}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" size="md" onClick={() => reset()}>
              {COPY.retry}
            </Button>
            <Link href="/" className={buttonVariants({ variant: "ghost", size: "md" })}>
              {COPY.home}
            </Link>
          </div>
        }
      />
    </div>
  );
}
