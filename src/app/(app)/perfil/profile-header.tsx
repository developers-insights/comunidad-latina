import Link from "next/link";
import { CalendarBlank, MapPin } from "@phosphor-icons/react/dist/ssr";
import { Avatar } from "@/components/ui";
import { AnimatedNumber } from "@/components/motion";
import { IdentityBadge } from "@/components/auth/identity-badge";

export interface ProfileStat {
  label: string;
  value: number;
  /**
   * Si está, el contador es un ENLACE a su pestaña. Seguidores y Siguiendo
   * llevan a la lista; Publicaciones a la grilla. Es la convención de cualquier
   * red social y evita el callejón sin salida de ver "128 seguidores" sin poder
   * tocarlos.
   */
  href?: string;
}

export interface ProfileHeaderProps {
  displayName: string;
  /** El handle, sin arroba. `null` cuando todavía no eligió uno. */
  username?: string | null;
  avatarUrl: string | null;
  /** Foto de portada (banner). `null` = la cabecera va sin banner, como antes. */
  coverUrl?: string | null;
  identityVerified: boolean;
  /** Línea de ubicación ya armada: "Rep. Dominicana · Queens" (o solo la zona). */
  location: string | null;
  /**
   * "marzo de 2026" — mes y año. La fecha completa de alta NO se muestra
   * (§9: nada de datos personales finos en el perfil público).
   */
  memberSince?: string | null;
  /** Contadores destacados (Publicaciones · Seguidores · Siguiendo). */
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
  username,
  avatarUrl,
  coverUrl,
  identityVerified,
  location,
  memberSince,
  stats,
  actions,
  headerRight,
}: ProfileHeaderProps) {
  return (
    <header className="flex flex-col gap-4">
      {headerRight && <div className="-mt-2 flex justify-end">{headerRight}</div>}

      {/* Portada. El alto se reserva con `aspect-[3/1]` ANTES de que la imagen
          llegue: sin eso, el avatar y los contadores saltan hacia abajo cuando
          carga (CLS). Sin portada no se dibuja nada — un rectángulo gris vacío
          es peor que la cabecera de siempre. */}
      {coverUrl && (
        <div className="rounded-2xl bg-surface-subtle p-1.5 ring-1 ring-border-subtle">
          <div className="relative aspect-[3/1] w-full overflow-hidden rounded-[calc(1rem-0.375rem)] bg-surface">
            {/*
              `<img>` y no `next/image`: la URL sale del bucket público de
              Supabase, cuyo host cambia por tenant y habría que declararlo uno
              por uno en la config. El CDN de Storage ya la sirve, y el alto lo
              reserva el `aspect-[3/1]` de arriba, que es lo que evita el salto
              de layout.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverUrl} alt="" className="size-full object-cover" />
          </div>
        </div>
      )}

      <div
        className={
          coverUrl
            ? // Con portada, el avatar monta sobre el borde inferior del banner:
              // es la gramática que cualquiera reconoce de una red social.
              "-mt-12 flex flex-col items-center gap-3 text-center"
            : "flex flex-col items-center gap-3 text-center"
        }
      >
        <span className={coverUrl ? "rounded-full ring-4 ring-background" : undefined}>
          <Avatar
            size="xl"
            src={avatarUrl}
            name={displayName}
            badge={identityVerified ? <IdentityBadge /> : undefined}
          />
        </span>

        <div className="flex flex-col items-center gap-0.5">
          <h1 className="font-display text-xl font-bold text-foreground">
            {displayName}
          </h1>
          {/* El handle debajo del nombre y en tono secundario: es la dirección,
              no la identidad. La arroba va acá y no en la columna. */}
          {username && (
            <p className="text-sm text-foreground-muted">@{username}</p>
          )}
          {location && (
            <p className="flex items-center justify-center gap-1 text-sm text-foreground-secondary">
              <MapPin size={14} aria-hidden="true" />
              {location}
            </p>
          )}
          {/* "Miembro desde" (pedido del cliente, 52:31). Es una señal de
              confianza —cuánto hace que esta persona está en la comunidad— y
              por eso va en la cabecera y no escondido en Información. Mes y
              año: el día exacto del alta no le sirve a nadie y es un dato más. */}
          {memberSince && (
            <p className="flex items-center justify-center gap-1 text-xs text-foreground-muted">
              <CalendarBlank size={13} aria-hidden="true" />
              Miembro desde {memberSince}
            </p>
          )}
        </div>

        {/* Fila de contadores — el latido "red social" del perfil. */}
        {stats.length > 0 && (
          <ul className="flex items-stretch justify-center gap-8">
            {stats.map((stat) => {
              const body = (
                <>
                  <span
                    aria-hidden="true"
                    className="numeric font-display text-xl font-bold text-foreground"
                  >
                    <AnimatedNumber value={stat.value} silent />
                  </span>
                  <span aria-hidden="true" className="text-xs text-foreground-secondary">
                    {stat.label}
                  </span>
                  {/* Un único nodo accesible por contador: "12 Publicaciones". */}
                  <span className="sr-only">
                    {stat.value} {stat.label}
                  </span>
                </>
              );

              return (
                <li key={stat.label} className="flex">
                  {stat.href ? (
                    <Link
                      href={stat.href}
                      scroll={false}
                      // min-h-11 = 44px de target aunque el número sea "0".
                      className="flex min-h-11 flex-col items-center rounded-lg px-2 transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                    >
                      {body}
                    </Link>
                  ) : (
                    <span className="flex flex-col items-center px-2">{body}</span>
                  )}
                </li>
              );
            })}
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
