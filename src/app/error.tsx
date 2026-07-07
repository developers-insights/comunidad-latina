"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CloudSlash } from "@phosphor-icons/react";
import { Button, EmptyState, buttonVariants } from "@/components/ui";

/**
 * Error boundary global (§3.5): error cálido, jamás un stack trace ni jerga.
 * "No es tu culpa" es literal del design brief — nuestro público interpreta
 * pantallas rotas como estafa o como "hice algo mal". Reintentar via reset().
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
    <div className="flex min-h-dvh items-center justify-center px-4">
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
