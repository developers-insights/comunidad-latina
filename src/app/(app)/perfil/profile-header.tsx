import { MapPin } from "@phosphor-icons/react/dist/ssr";
import { Avatar } from "@/components/ui";
import { AnimatedNumber } from "@/components/motion";
import { IdentityBadge } from "@/components/auth/identity-badge";

export interface ProfileStat {
  label: string;
  value: number;
}

export interface ProfileHeaderProps {
  displayName: string;
  avatarUrl: string | null;
  identityVerified: boolean;
  /** Línea de ubicación ya armada: "Rep. Dominicana · Queens" (o solo la zona). */
  location: string | null;
  /** Contadores destacados (Publicaciones · Siguiendo). Números en `numeric`. */
  stats: ProfileStat[];
  /** Acciones contextuales bajo los contadores (editar/verificar/mensaje). */
  actions?: React.ReactNode;
  /** Slot arriba a la derecha (menú "⋯" del perfil público). */
  headerRight?: React.ReactNode;
}

/**
 * Cabecera de perfil tipo red social (feedback cliente 21/7): avatar grande,
 * nombre, verificación, ubicación y una fila de contadores con números
 * destacados. El nombre es el `h1` de la página — el perfil ES de esta persona.
 */
export function ProfileHeader({
  displayName,
  avatarUrl,
  identityVerified,
  location,
  stats,
  actions,
  headerRight,
}: ProfileHeaderProps) {
  return (
    <header className="flex flex-col gap-4">
      {headerRight && <div className="-mt-2 flex justify-end">{headerRight}</div>}

      <div className="flex flex-col items-center gap-3 text-center">
        <Avatar
          size="xl"
          src={avatarUrl}
          name={displayName}
          badge={identityVerified ? <IdentityBadge /> : undefined}
        />

        <div className="flex flex-col items-center gap-0.5">
          <h1 className="font-display text-xl font-bold text-foreground">
            {displayName}
          </h1>
          {location && (
            <p className="flex items-center justify-center gap-1 text-sm text-foreground-secondary">
              <MapPin size={14} aria-hidden="true" />
              {location}
            </p>
          )}
        </div>

        {/* Fila de contadores — el latido "red social" del perfil. */}
        {stats.length > 0 && (
          <ul className="flex items-stretch justify-center gap-8">
            {stats.map((stat) => (
              <li key={stat.label} className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className="numeric font-display text-xl font-bold text-foreground"
                >
                  <AnimatedNumber value={stat.value} silent />
                </span>
                <span
                  aria-hidden="true"
                  className="text-xs text-foreground-secondary"
                >
                  {stat.label}
                </span>
                {/* Un único nodo accesible por contador: "12 Publicaciones". */}
                <span className="sr-only">
                  {stat.value} {stat.label}
                </span>
              </li>
            ))}
          </ul>
        )}

        {actions && (
          <div className="mt-1 flex w-full flex-col items-stretch gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
