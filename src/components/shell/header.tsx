import Image from "next/image";
import Link from "next/link";
import { ChatCircle } from "@phosphor-icons/react/dist/ssr";
import type { Tenant } from "@/lib/tenant/resolve";
import { BRAND_NAME } from "@/lib/brand";
import { Avatar } from "@/components/ui";
import { HeaderActions } from "@/components/shell/header-actions";
import { NotificationBell } from "@/components/notifications";
import { getShellContext } from "@/components/shell/shell-context";
import { t } from "@/lib/i18n";

const COPY = {
  profile: "Tu perfil",
  signIn: "Entrar",
} as const;

const SUPABASE_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

/** ¿El src puede pasar por next/image? (local o del Storage de Supabase). */
function isOptimizableSrc(src: string): boolean {
  return (
    src.startsWith("/") ||
    (SUPABASE_ORIGIN.length > 0 && src.startsWith(`${SUPABASE_ORIGIN}/`))
  );
}

/**
 * Header del shell autenticado: zona de logo del tenant (única zona de marca
 * masiva permitida), selector de ubicación (placeholder, lo cablea SOCIAL),
 * Mensajes y el avatar de perfil.
 *
 * Historia de esta esquina derecha, porque cambió dos veces:
 *  · 2026-07-20 — el rail de módulos, el toggle de tema y la campana se fueron
 *    adentro de UN botón de menú, para que el header respirara.
 *  · 2026-07-29 — ese menú se eliminó (pedido de Manuel): su contenido se
 *    repartió entre /buscar (los módulos) y /ajustes (cuenta, notificaciones,
 *    tema, sesión), y su lugar lo tomó el avatar. Mensajes subió acá al mismo
 *    tiempo, porque salió del bottom nav.
 *
 * Superficie elevada: `bg-surface/85` (no canvas) + firma tricolor abajo,
 * que voltean solas con el tema.
 *
 * El `sticky top-0 z-40` vive en el wrapper de `(app)/layout.tsx`, NO acá.
 */
export async function Header({ tenant, className }: { tenant: Tenant; className?: string }) {
  const menu = await getShellContext();
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
          aria-label={BRAND_NAME}
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
          {/* La MARCA, no el nombre del tenant: el header dice siempre
              "Comunidad Latina", sirva la comunidad que sirva. Ver
              @/lib/brand. */}
          <span className="truncate text-base font-bold tracking-tight text-brand-ink">
            {BRAND_NAME}
          </span>
        </Link>

        <HeaderActions />

        <NotificationBell />

        {/* Mensajes: bajó del menú lateral y subió acá porque es adonde apunta
            CADA CTA de contacto de la app (la tarjeta de un negocio, la de una
            propiedad, el mensaje inline del feed) y salió del bottom nav para
            hacerle lugar a Ajustes. Sin globito de "sin leer": la tabla
            `messages` no guarda estado de lectura (0006), y un punto que no
            responde a nada es peor que ninguno. */}
        <Link
          href="/mensajes"
          aria-label={t("nav", "messages")}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-secondary transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <ChatCircle size={24} aria-hidden="true" />
        </Link>

        {/* Perfil, en el lugar donde estaba el botón de menú (pedido de Manuel,
            2026-07-29). El avatar es el control de identidad más reconocible que
            existe en una app social: dice de quién es la sesión ANTES de tocarlo,
            cosa que un ícono de hamburguesa nunca hizo. Sin sesión, la misma
            posición invita a entrar. */}
        {menu.user ? (
          <Link
            href="/perfil"
            aria-label={COPY.profile}
            className="flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            <Avatar size="sm" name={menu.user.displayName} src={menu.user.avatarUrl} />
          </Link>
        ) : (
          <Link
            href="/entrar"
            className="flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-brand-ink transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {COPY.signIn}
          </Link>
        )}
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
