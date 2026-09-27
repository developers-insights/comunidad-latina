"use client";

import { ArrowClockwise, Warning } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState } from "@/components/ui";

export default function ColaboracionError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      icon={<Warning />}
      title="No pudimos abrir la colaboración"
      message="Algo no cargó bien de nuestro lado — no es tu culpa. Tu contrato y tu pago están a salvo."
      action={
        <Button variant="primary" onClick={reset}>
          <ArrowClockwise size={16} aria-hidden="true" />
          Probar de nuevo
        </Button>
      }
      className="py-20"
    />
  );
}
