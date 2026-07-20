import Image from "next/image";
import Link from "next/link";
import type { Tenant } from "@/lib/tenant/resolve";
import { createClient } from "@/lib/supabase/server";
import { isStaffRole } from "@/app/admin/guard";
import { HeaderActions } from "@/components/shell/header-actions";
import { AppMenu } from "@/components/shell/app-menu";

const SUPABASE_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

/** ¿El src puede pasar por next/image? (local o del Storage de Supabase). */
function isOptimizableSrc(src: string): boolean {
  return (
    src.startsWith("/") ||
    (SUPABASE_ORIGIN.length > 0 && src.startsWith(`${SUPABASE_ORIGIN}/`))
  );
}

interface MenuContext {
  user: { displayName: string; avatarUrl: string | null } | null;
  unread: number;
  isStaff: boolean;
}

/**
 * Lo que el menú necesita del server: identidad, notificaciones sin leer
 * (RLS: solo las propias) y si la cuenta es staff (el rol SIEMPRE del JWT,
 * nunca de `profiles.role`, que es informativa — mismo criterio que la RLS).
 * Sin sesión o sin DB devuelve un contexto vacío: el menú sigue sirviendo
 * para explorar, nunca un error.
 */
async function getMenuContext(): Promise<MenuContext> {
  const empty: MenuContext = { user: null, unread: 0, isStaff: false };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return empty;

    const [{ data: profile }, { count, error }] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle(),
      supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    ]);

    return {
      user: {
        displayName: profile?.display_name ?? "Tu cuenta",
        avatarUrl: profile?.avatar_url ?? null,
      },
      unread: !error && typeof count === "number" ? count : 0,
      isStaff: isStaffRole(user.app_metadata?.role),
    };
  } catch {
    return empty;
  }
}

/**
 * Header del shell autenticado: zona de logo del tenant (única zona de marca
 * masiva permitida), selector de ubicación (placeholder, lo cablea SOCIAL) y
 * el botón de menú.
 *
 * Un solo control a la derecha (feedback cliente 2026-07-20): el toggle de
 * tema y la campana se mudaron adentro del menú, junto con los 8 módulos que
 * antes vivían en el rail de cápsulas. El header respira y el nombre de la
 * comunidad deja de competir con tres botones.
 *
 * Superficie elevada: `bg-surface/85` (no canvas) + firma tricolor abajo,
 * que voltean solas con el tema.
 *
 * El `sticky top-0 z-40` vive en el wrapper de `(app)/layout.tsx`, NO acá.
 */
export async function Header({ tenant, className }: { tenant: Tenant; className?: string }) {
  const menu = await getMenuContext();
  // Single-community: si el tenant no trae logo propio, cae al logo de la
  // plataforma (las tres figuras azul·amarillo·rojo).
  const logoSrc = tenant.logoUrl ?? "/brand/logo-mark.png";
  const headerClass = ["bg-surface/85 backdrop-blur-md", className]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClass}>
      <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-2 px-4">
        {/* min-w-0 + truncate: el nombre del tenant es lo que cede a 375px,
            nunca el layout. */}
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
        <AppMenu user={menu.user} initialUnread={menu.unread} isStaff={menu.isStaff} />
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
