import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const COPY = {
  viewProfile: (name: string) => `Ver el perfil de ${name}`,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function profileHref(
  profileId: string | null | undefined,
  viewerId?: string | null,
): string | null {
  if (!profileId || !UUID.test(profileId)) return null;
  if (viewerId && viewerId === profileId) return "/perfil";
  return `/perfil/${profileId}`;
}

const VARIANTS = {
  name: cn(
    "relative inline-flex max-w-full min-w-0 items-center rounded-sm",
    "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
    "hover:underline underline-offset-2",
  ),
  avatar: cn(
    "relative inline-flex shrink-0 rounded-full",
    "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
  ),
  block: "",
} as const;

export interface ProfileLinkProps {
  profileId: string | null | undefined;
  name: string;
  viewerId?: string | null;
  variant?: keyof typeof VARIANTS;
  /**
   * Otro perfil de la MISMA persona (el de creador, `/creadores/perfil/<id>`).
   * Sólo se usa si `profileId` es válido: sin cuenta detrás no hay link.
   */
  href?: string;
  /**
   * Para el avatar que va al lado del nombre: mismo destino, así que sale del
   * orden de tabulación y del árbol de accesibilidad y el lector de pantalla
   * no anuncia dos links idénticos seguidos.
   */
  duplicate?: boolean;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

export function ProfileLink({
  profileId,
  name,
  viewerId,
  variant = "name",
  href: hrefOverride,
  duplicate = false,
  onClick,
  className,
  children,
}: ProfileLinkProps) {
  const profile = profileHref(profileId, viewerId);
  const href = profile && hrefOverride ? hrefOverride : profile;
  if (!href) {
    return <span className={cn("min-w-0", className)}>{children}</span>;
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={COPY.viewProfile(name)}
      aria-hidden={duplicate || undefined}
      tabIndex={duplicate ? -1 : undefined}
      className={cn(
        VARIANTS[variant],
        "cursor-pointer touch-manipulation",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      {children}
    </Link>
  );
}
