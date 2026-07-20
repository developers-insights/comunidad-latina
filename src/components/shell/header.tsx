import Image from "next/image";
import Link from "next/link";
import type { Tenant } from "@/lib/tenant/resolve";
import { createClient } from "@/lib/supabase/server";
import { HeaderActions } from "@/components/shell/header-actions";
import { NotificationBell } from "@/components/notifications";
import { ThemeToggle } from "@/components/theme";

const SUPABASE_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

/** ¿El src puede pasar por next/image? (local o del Storage de Supabase). */
function isOptimizableSrc(src: string): boolean {
  return (
    src.startsWith("/") ||
    (SUPABASE_ORIGIN.length > 0 && src.startsWith(`${SUPABASE_ORIGIN}/`))
  );
}

/** Count de notificaciones sin leer del usuario (RLS: solo las propias). */
async function getUnreadCount(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    return !error && typeof count === "number" ? count : 0;
  } catch {
    return 0; // Sin sesión o sin DB: campana sin badge, nunca un error.
  }
}

/**
 * Header del shell autenticado: zona de logo del tenant (única zona de marca
 * masiva permitida), selector de ubicación (placeholder, lo cablea SOCIAL),
 * toggle de tema y campana de notificaciones real (módulo NOTIFICACIONES).
 *
 * Superficie elevada: `bg-surface/85` (no canvas) + hairline `border-border`,
 * que voltean solos con el tema.
 *
 * El `sticky top-0 z-40` vive en el wrapper de `(app)/layout.tsx`, NO acá:
 * ese wrapper envuelve Header + ModuleRail juntos para que los dos queden
 * pegados como una sola pieza al hacer scroll — dos elementos sticky
 * independientes con el mismo `top:0` "compiten" por la misma posición
 * (el segundo no queda pegado inmediatamente debajo del primero sin además
 * calcularle un `top` igual a la altura exacta del primero). Un solo
 * contenedor sticky evita ese cálculo frágil.
 */
export async function Header({ tenant, className }: { tenant: Tenant; className?: string }) {
  const unread = await getUnreadCount();
  // Single-community: si el tenant no trae logo propio, cae al logo de la
  // plataforma (las tres figuras azul·amarillo·rojo).
  const logoSrc = tenant.logoUrl ?? "/brand/logo-mark.png";
  const headerClass = ["bg-surface/85 backdrop-blur-md", className]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClass}>
      <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-2 px-4">
        {/* min-w-0 + truncate: con tres controles a la derecha (44×44 cada uno),
            el nombre del tenant es lo que cede a 375px, no el layout. */}
        <Link
          href="/feed"
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          aria-label={tenant.name}
        >
          {isOptimizableSrc(logoSrc) ? (
            <Image
              src={logoSrc}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- logo en un dominio ajeno al allowlist de next/image (tenant custom)
            <img
              src={logoSrc}
              alt=""
              className="h-8 w-8 shrink-0 object-contain"
            />
          )}
          <span className="truncate text-base font-bold tracking-tight text-brand-ink">
            {tenant.name}
          </span>
        </Link>

        <HeaderActions />
        <ThemeToggle />
        <NotificationBell initialUnread={unread} />
      </div>
      {/* Firma tricolor de la marca: azul · amarillo · rojo (del logo). Reemplaza
          el hairline inferior del header y aparece en toda pantalla autenticada. */}
      <div
        aria-hidden="true"
        className="h-[3px] w-full"
        style={{
          background:
            "linear-gradient(90deg, var(--brand-blue) 0 33.34%, var(--brand-yellow) 33.34% 66.67%, var(--brand-red) 66.67% 100%)",
        }}
      />
    </header>
  );
}
