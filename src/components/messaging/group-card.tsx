import type { ReactNode } from "react";
import Link from "next/link";
import { Lock, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Avatar, Chip } from "@/components/ui";
import {
  ETIQUETA_DE_CATEGORIA,
  esCategoriaDeGrupo,
  miembrosLabel,
  type GrupoRow,
} from "@/lib/messaging/grupos";
import { COPY } from "./copy";

/**
 * Tarjeta de un grupo, tanto en "Tus grupos" como en "Para sumarte".
 *
 * ── DECISIONES DE DISEÑO Y DE DÓNDE SALEN ───────────────────────────────────
 * La estructura —foto cuadrada con esquinas redondeadas a la izquierda, nombre
 * arriba, una línea de descripción, y el conteo de miembros como dato
 * secundario— sale de la pantalla de info de grupo de WhatsApp
 * (https://mobbin.com/screens/fe36a6c4-14d5-4ae9-aa30-7f307ab83266), donde el
 * nombre y "Group · 3 members" viven pegados y el resto es jerarquía menor.
 *
 * El TEMA como chip es propio, no de la referencia: WhatsApp no tiene
 * categorías porque sus grupos se descubren por gente conocida. Acá el
 * descubrimiento es entre desconocidos de la misma comunidad, así que "de qué
 * se trata" es la información que decide si entrás — y va donde se lee primero.
 *
 * La `action` la pasa quien la usa (unirse, o nada si ya sos miembro): la
 * tarjeta no sabe de acciones porque se renderiza en dos listas distintas.
 */
export function GroupCard({
  grupo,
  href,
  action,
  className,
}: {
  grupo: GrupoRow;
  href: string;
  action?: ReactNode;
  className?: string;
}) {
  const categoria = esCategoriaDeGrupo(grupo.category)
    ? ETIQUETA_DE_CATEGORIA[grupo.category]
    : null;

  return (
    <li
      className={cn(
        "rounded-lg border border-border-subtle bg-surface shadow-xs",
        className,
      )}
    >
      <Link
        href={href}
        className="flex items-start gap-3 rounded-lg p-4 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        {/* Se usa `Avatar` tal cual, circular. Se probó cuadrarlo para
            distinguir un grupo de una persona, pero el <img> de adentro lleva
            su propio `rounded-full`: quedaba una foto redonda dentro de una
            placa cuadrada. Distinguirlos es trabajo del chip de tema y del
            conteo de miembros, que además dicen algo. */}
        <Avatar src={grupo.avatar_url} name={grupo.name} size="lg" />

        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{grupo.name}</p>

          {grupo.description && (
            <p className="mt-0.5 line-clamp-2 text-sm text-foreground-secondary">
              {grupo.description}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {categoria && (
              <Chip size="sm" variant="brand">
                {categoria}
              </Chip>
            )}
            <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
              <UsersThree size={14} aria-hidden="true" />
              {miembrosLabel(grupo.member_count)}
            </span>
            {grupo.visibility === "private" && (
              <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
                <Lock size={14} aria-hidden="true" />
                {COPY.groups.privateBadge}
              </span>
            )}
          </div>
        </div>
      </Link>

      {action && (
        <div className="border-t border-border-subtle px-4 py-3">{action}</div>
      )}
    </li>
  );
}
