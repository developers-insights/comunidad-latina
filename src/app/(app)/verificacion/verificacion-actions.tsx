"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet, Button, ProximamentePremium } from "@/components/ui";
import { COPY_VERIFICACION } from "@/components/verificacion/copy";
import type { VerificacionTier } from "@/lib/verificacion/catalogo";
import { abrirPortalVerificacion, activarCheckAzul } from "./actions";

/**
 * Botonera del check azul: activar un escalón y gestionar-o-cancelar.
 *
 * Client component mínimo — todo lo que se puede pintar en el servidor (los
 * precios, el estado, qué significa la insignia) lo pinta la página. Acá vive
 * sólo lo que necesita un evento del usuario.
 *
 * TRES CAMINOS DE FALLA, TRES RESPUESTAS DISTINTAS Y VISIBLES:
 *   · `no_configurado` (Stripe sin claves, §5.6) → `<ProximamentePremium>`. No es
 *     un error: es una función que todavía no está.
 *   · `sin_identidad` → NO se pinta como error rojo, sino como el paso que
 *     falta, con su link. Es la diferencia entre "algo salió mal" y "te falta
 *     esto, hacelo acá".
 *   · `error` → el mensaje, en `role="alert"` para que el lector de pantalla lo
 *     anuncie. Nunca un `catch` mudo: cuando hay plata de por medio, un botón
 *     que no hace nada es lo peor que puede pasar.
 */
export function VerificacionActions({
  tier,
  yaActiva,
  tieneFacturacion,
}: {
  tier: VerificacionTier;
  /** Ya tiene el check encendido ⇒ no se ofrece contratar de nuevo. */
  yaActiva: boolean;
  /** Ya existe un customer en Stripe ⇒ tiene sentido ofrecer el portal. */
  tieneFacturacion: boolean;
}) {
  const router = useRouter();
  const [proximamenteOpen, setProximamenteOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [faltaIdentidad, setFaltaIdentidad] = useState<string | null>(null);
  const [pending, setPending] = useState<"activar" | "gestionar" | null>(null);
  const [, startTransition] = useTransition();

  function run(accion: "activar" | "gestionar") {
    if (pending) return;
    setErrorMessage(null);
    setFaltaIdentidad(null);
    setPending(accion);

    startTransition(async () => {
      const result =
        accion === "activar"
          ? await activarCheckAzul({ tier })
          : await abrirPortalVerificacion();

      switch (result.status) {
        case "redirect":
          // Se sale a Stripe: no se limpia `pending` a propósito, el botón queda
          // ocupado hasta que la navegación se lleva la página.
          window.location.assign(result.url);
          return;
        case "no_configurado":
          setProximamenteOpen(true);
          break;
        case "sin_sesion":
          router.push(`/entrar?next=${encodeURIComponent("/verificacion")}`);
          return;
        case "sin_identidad":
          setFaltaIdentidad(result.message);
          break;
        case "error":
          setErrorMessage(result.message);
          break;
      }
      setPending(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {errorMessage && (
        <p role="alert" className="text-sm font-medium text-danger-ink">
          {errorMessage}
        </p>
      )}

      {faltaIdentidad && (
        <div role="alert" className="rounded-xl bg-info-bg p-3">
          <p className="text-sm font-medium text-info-ink">{faltaIdentidad}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => router.push("/perfil/verificar")}
          >
            {COPY_VERIFICACION.identidad.faltaCta}
          </Button>
        </div>
      )}

      {/* Ancho completo, como el CTA de negocios/presencia: es el único botón
          de su tarjeta y el borde de la tarjeta es su blanco de tap. Antes
          quedaba encogido contra el margen izquierdo — un `inline-flex` dentro
          de una columna de 152px. */}
      {!yaActiva && (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={pending === "activar"}
          onClick={() => run("activar")}
        >
          {COPY_VERIFICACION.page.contratar}
        </Button>
      )}

      {tieneFacturacion && (
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          loading={pending === "gestionar"}
          onClick={() => run("gestionar")}
        >
          {COPY_VERIFICACION.page.gestionar}
        </Button>
      )}

      {/* Stripe sin configurar (HOY) → estado premium, nunca un error crudo. */}
      <BottomSheet
        open={proximamenteOpen}
        onClose={() => setProximamenteOpen(false)}
        ariaLabel="Los pagos, muy pronto"
      >
        <ProximamentePremium feature="el check azul" />
      </BottomSheet>
    </div>
  );
}
