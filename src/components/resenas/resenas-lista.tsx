import { Star, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard } from "@/components/ui";
import { RESENAS_COPY as C, type ResenaVista } from "@/lib/resenas";
import { cn } from "@/lib/utils";
import { Estrellas } from "./estrellas";
import { ResenaAcciones } from "./resena-acciones";

export interface ResenasListaProps {
  listingId: string;
  resenas: readonly ResenaVista[];
  /** Quien mira administra el aviso: le aparece "Responder" en cada reseña. */
  puedeResponder: boolean;
  /** Hay sesión: se puede reportar. */
  hayCuenta: boolean;
  /** Se muestra cuando la lista está vacía y el visitante podría escribir. */
  puedeEscribir: boolean;
  className?: string;
}

/**
 * La lista de reseñas.
 *
 * Server Component: no hay nada acá que necesite el navegador. Lo único
 * interactivo —responder y reportar— vive en `<ResenaAcciones>`, que es el único
 * cliente y sólo se monta cuando de verdad hay una acción disponible.
 *
 * EL VACÍO NO ES UN ERROR. Un negocio sin reseñas no está roto: nadie escribió
 * todavía. Se dice así, y con una salida —dejar la primera— sólo a quien puede
 * dejarla; a quien no, no se le ofrece una puerta que después se le cierra.
 */
export function ResenasLista({
  listingId,
  resenas,
  puedeResponder,
  hayCuenta,
  puedeEscribir,
  className,
}: ResenasListaProps) {
  if (resenas.length === 0) {
    return (
      <BezelCard coreClassName={cn("flex items-start gap-3 p-4", className)}>
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted">
          <Star size={20} />
        </span>
        <p className="text-sm leading-relaxed text-foreground-secondary">
          {puedeEscribir ? C.vacio : C.vacioSinCuenta}
        </p>
      </BezelCard>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ul className="flex flex-col gap-3">
        {resenas.map((resena) => (
          <li key={resena.id}>
            <BezelCard coreClassName="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                {/* Firmada por un negocio (0117): mismo glifo y mismo anillo
                    que el cambiador del header y que un comentario de negocio —
                    una sola gramática visual para "esto lo dice un local" en
                    toda la app. */}
                <Avatar
                  src={resena.autorAvatar}
                  name={resena.autorNombre}
                  size="md"
                  badge={
                    resena.esDeNegocio ? (
                      <span
                        aria-hidden="true"
                        className="cl-print-hide flex size-4 items-center justify-center rounded-full bg-brand text-brand-foreground ring-2 ring-surface"
                      >
                        <Storefront size={11} weight="fill" />
                      </span>
                    ) : undefined
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{resena.autorNombre}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Estrellas
                      valor={resena.puntaje}
                      size={14}
                      etiqueta={C.puntajeAria(resena.puntaje)}
                    />
                    <span className="text-xs text-foreground-muted">{resena.fecha}</span>
                  </div>
                </div>
              </div>

              {resena.texto && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                  {resena.texto}
                </p>
              )}

              {/* Respuesta del negocio: indentada y con su propio encabezado, para
                  que se lea como una réplica y no como una segunda reseña. */}
              {resena.respuesta && (
                <div className="rounded-md border-l-2 border-brand-subtle bg-surface-subtle p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                    {C.respuestaTitulo}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {resena.respuesta}
                  </p>
                  {resena.respuestaFecha && (
                    <p className="mt-1 text-xs text-foreground-muted">{resena.respuestaFecha}</p>
                  )}
                </div>
              )}

              <ResenaAcciones
                reviewId={resena.id}
                listingId={listingId}
                puedeResponder={puedeResponder}
                tieneRespuesta={Boolean(resena.respuesta)}
                respuestaActual={resena.respuesta}
                puedeReportar={hayCuenta && !resena.esMia}
              />
            </BezelCard>
          </li>
        ))}
      </ul>

      {/* La parte que no se puede suavizar: esto son opiniones, no una
          verificación nuestra. Mismo criterio legal que verification_checks. */}
      <p className="px-1 text-xs leading-relaxed text-foreground-muted">{C.descargo}</p>
    </div>
  );
}
