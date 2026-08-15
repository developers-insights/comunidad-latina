"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { CloudSlash } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState } from "@/components/ui";

/**
 * Error boundary del segmento (app) — el shell autenticado.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO, HABIENDO UNO EN LA RAÍZ
 * ---------------------------------------------------
 * Porque el de la raíz se come la app entera. Un `error.tsx` envuelve a los
 * HIJOS de su segmento y NO al layout de ese mismo segmento
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:
 * "It does not wrap the layout.js or template.js above it in the same segment").
 * Con el boundary sólo en la raíz, un fallo en /negocios/[id] se llevaba puesto
 * a `(app)/layout.tsx` —Header, BottomNav, todo— y dejaba una pantalla suelta,
 * sin tabs y sin forma de volver. En una PWA móvil eso no se lee como "una
 * pantalla falló": se lee como "la app se rompió".
 *
 * Puesto acá, el boundary es hijo de `(app)/layout.tsx`, así que el chrome
 * sobrevive: la persona ve el error DENTRO de la app, con su barra de abajo
 * intacta, y se va a otra sección con un toque. La caída del propio layout de
 * (app) —`getTenant()`, el gate de cuenta— sigue burbujeando al boundary de la
 * raíz, que es exactamente donde corresponde: si el shell no se puede armar, no
 * hay chrome que conservar.
 *
 * Reintentar: `unstable_retry()` es lo que prescribe la doc de esta versión
 * (Next 16.2, donde se agregó) porque vuelve a PEDIR el contenido; `reset()`
 * sólo limpia el estado y re-renderiza lo mismo, que ante un Server Component
 * caído es un botón que no arregla nada. Se acepta `reset` como respaldo para
 * no depender de un prop `unstable_`.
 */

const COPY = {
  title: "No pudimos cargar esta pantalla",
  message:
    "Es cosa nuestra, no tuya — ya nos llegó el aviso. Probá de nuevo; el resto de la app sigue andando.",
  retry: "Reintentar",
} as const;

export default function AppSegmentError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    // El copy dice "ya nos llegó el aviso", así que tiene que ser cierto: un
    // error de render en cliente lo atrapa este boundary y nunca llega a
    // `window.onerror`, o sea que el SDK no lo ve si no se lo damos. Sin DSN
    // configurado, `captureException` es un no-op.
    Sentry.captureException(error);
    console.error("[app] error de segmento", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  const retry = unstable_retry ?? reset;

  return (
    <div role="alert">
      <EmptyState
        icon={<CloudSlash weight="light" />}
        title={COPY.title}
        message={COPY.message}
        action={
          <Button variant="primary" size="md" onClick={() => retry()}>
            {COPY.retry}
          </Button>
        }
      />
    </div>
  );
}
