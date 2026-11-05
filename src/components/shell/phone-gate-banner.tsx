"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DeviceMobile } from "@phosphor-icons/react/dist/ssr";

/**
 * El pedido del teléfono: aparece al entrar y queda a la vista hasta verificar.
 *
 * No reemplaza la app como `AccountGate`: esta persona no hizo nada malo y puede
 * seguir leyendo. Por eso son dos cosas:
 *
 *   · LA PRIMERA VEZ de cada sesión la lleva a la pantalla de verificar, con
 *     `?next=` para volver adonde iba. Pasa acá y no en /entrar o /confirmar
 *     porque es el único punto común: contraseña, Google, Apple, enlace del
 *     correo, recuperar la cuenta y la app de iPhone terminan todos en (app).
 *   · DESPUÉS, un aviso fijo. Puede elegir "ahora no" y seguir leyendo, pero no
 *     se le esconde por qué no puede publicar.
 *
 * Esto es la cara del gate, no el gate: el corte real está en la base (0181).
 * Si `sessionStorage` falla, se queda sólo el aviso, que alcanza.
 */

const COPY = {
  pendiente: "Confirmá tu teléfono para publicar y escribir. Mientras, podés seguir leyendo.",
  cta: "Confirmar",
  sinSalida:
    "Por ahora no podemos confirmar teléfonos, y publicar o escribir está en pausa. Podés seguir leyendo: ya lo estamos resolviendo.",
} as const;

const PHONE_PATH = "/ajustes/telefono";
const SESSION_FLAG = "cl-telefono-pedido";

export interface PhoneGateBannerProps {
  status: "pendiente" | "sin_salida";
}

function debePedirAhora(): boolean {
  try {
    if (window.sessionStorage.getItem(SESSION_FLAG)) return false;
    window.sessionStorage.setItem(SESSION_FLAG, "1");
    return true;
  } catch {
    return false;
  }
}

export function PhoneGateBanner({ status }: PhoneGateBannerProps) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status !== "pendiente") return;
    // En Ajustes no se interrumpe: ahí está la baja de la cuenta y la privacidad.
    if (pathname === "/ajustes" || pathname.startsWith("/ajustes/")) return;
    // Navegar acá desmontaría la llamada en curso.
    if (pathname === "/llamadas" || pathname.startsWith("/llamadas/")) return;
    if (!debePedirAhora()) return;
    const destino = `${window.location.pathname}${window.location.search}`;
    router.push(`${PHONE_PATH}?next=${encodeURIComponent(destino)}`);
  }, [status, pathname, router]);

  if (pathname === PHONE_PATH) return null;

  return (
    <div
      role="status"
      className="cl-print-hide border-b border-border bg-brand-tint px-4 py-2 text-sm text-foreground"
    >
      <div className="mx-auto flex w-full max-w-lg items-center gap-3">
        <DeviceMobile size={20} aria-hidden="true" className="shrink-0 text-brand-ink" />
        <p className="min-w-0 flex-1 leading-snug">
          {status === "pendiente" ? COPY.pendiente : COPY.sinSalida}
        </p>
        {status === "pendiente" && (
          <Link
            href={PHONE_PATH}
            className="flex min-h-11 shrink-0 items-center rounded-full px-3 font-semibold text-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {COPY.cta}
          </Link>
        )}
      </div>
    </div>
  );
}
