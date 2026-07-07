"use client";

import { ChatCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast } from "@/components/ui";

const COPY = {
  cta: "Enviar mensaje",
  soonTitle: (name: string) => `Muy pronto vas a poder escribirle a ${name} desde acá`,
  soonBody:
    "Por ahora el contacto protegido arranca desde un aviso publicado — estamos terminando esta parte.",
} as const;

/**
 * CTA del perfil público cuando todavía NO existe conversación con esa
 * persona. El contacto directo perfil→perfil llega con el módulo social;
 * mientras tanto: feedback honesto e inmediato (patrón AlertButton §5.6),
 * nunca un link que promete y no cumple.
 */
export function MessageCta({ firstName }: { firstName: string }) {
  const { toast } = useToast();

  return (
    <Button
      variant="primary"
      size="lg"
      className="w-full"
      onClick={() =>
        toast({
          title: COPY.soonTitle(firstName),
          description: COPY.soonBody,
        })
      }
    >
      <ChatCircle size={20} aria-hidden="true" />
      {COPY.cta}
    </Button>
  );
}
