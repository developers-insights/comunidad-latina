import { Suspense } from "react";
import Link from "next/link";
import { Megaphone } from "@phosphor-icons/react/dist/ssr";
import {
  Badge,
  CardMedia,
  EmptyState,
  SectionHeading,
  Skeleton,
  buttonVariants,
} from "@/components/ui";
import { FALLBACK_PHOTO } from "@/components/listings";
import { VENCIMIENTO_COPY, closedReasonForKind } from "@/lib/listings";
import { AVISO_PARAM } from "@/lib/notifications/entity";
import { cn } from "@/lib/utils";
import { fetchMisPublicaciones, type PublicacionPropia } from "./queries";
import { RenovarBoton } from "./renovar-boton";
import { CerrarBoton } from "./cerrar-boton";
import { puedeCerrarPublicacion } from "./puede-cerrar";

export const metadata = { title: "Mis publicaciones" };

const C = VENCIMIENTO_COPY;

/**
 * MIS PUBLICACIONES — el lugar donde se renueva (0098).
 *
 * Existe como pantalla propia y no como un bloque dentro de cada módulo porque
 * el problema es transversal: alguien tiene un aviso en Vivienda, dos en
 * Marketplace y uno en Empleos, y lo que necesita es UNA lista donde ver qué se
 * le está por vencer. Repartirlo obligaría a recorrer cinco pantallas para no
 * perder nada — y es también el destino del `href` de las dos notificaciones que
 * emite la base.
 *
 * Las vencidas van ARRIBA (lo ordena `fetchMisPublicaciones`): son las que
 * dejaron de mostrarse, y probablemente la persona todavía no lo sabe.
 *
 * `?aviso=<id>` DESTACA UNA (0151). Antes las dos notificaciones de vencimiento
 * llegaban acá con el href fijo `/publicaciones`: veinte avisos distintos que
 * aterrizaban en la misma lista, que es exactamente lo que el cliente describió
 * como «no sabés de qué notificación te está hablando». Con el parámetro, la
 * publicación del aviso queda PRIMERA y marcada — no hace falta scroll ni JS, que
 * es lo que rompería con el Suspense de abajo (el navegador no puede saltar a un
 * ancla que todavía no se renderizó).
 */
export default function MisPublicacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Contenido searchParams={searchParams} />
    </Suspense>
  );
}

/** El id llega de la URL: se usa sólo para comparar contra ids que ya trajo la
 *  base, nunca para consultar. Cortarlo evita arrastrar una cadena absurda. */
function parseAviso(sp: Record<string, string | string[] | undefined>): string | null {
  const raw = sp[AVISO_PARAM];
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return value ? value.slice(0, 64) : null;
}

/** Acento e ícono 3D de la sección (el mismo set del menú). */
const SECCION = {
  accent: "var(--accent-social)",
  image: "/icons/menu/social.webp",
} as const;

async function Contenido({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ publicaciones, autenticado }, sp] = await Promise.all([
    fetchMisPublicaciones(),
    searchParams,
  ]);
  const aviso = parseAviso(sp);

  if (!autenticado) {
    return (
      <>
        <Encabezado />
        <EmptyState
          icon={<Megaphone />}
          title={C.pagina.necesitaCuentaTitulo}
          message={C.pagina.necesitaCuentaCuerpo}
          action={
            <Link href="/entrar" className={cn(buttonVariants({ variant: "primary" }))}>
              {C.pagina.necesitaCuentaCta}
            </Link>
          }
        />
      </>
    );
  }

  if (publicaciones.length === 0) {
    return (
      <>
        <Encabezado />
        <EmptyState
          icon={<Megaphone />}
          title={C.pagina.vacioTitulo}
          message={C.pagina.vacioCuerpo}
          action={
            <Link href="/publicar" className={cn(buttonVariants({ variant: "primary" }))}>
              {C.pagina.vacioCta}
            </Link>
          }
        />
      </>
    );
  }

  // La del aviso primero, sin alterar el orden relativo del resto. Un `sort` con
  // comparador booleano bastaría, pero esto deja explícito que es UNA sola fila
  // la que se mueve y que un `?aviso=` que ya no existe no cambia nada.
  const destacada = aviso ? publicaciones.find((p) => p.id === aviso) : undefined;
  const ordenadas = destacada
    ? [destacada, ...publicaciones.filter((p) => p.id !== destacada.id)]
    : publicaciones;

  return (
    <>
      <Encabezado />
      <ul className="space-y-3">
        {ordenadas.map((publicacion) => (
          <li key={publicacion.id}>
            <Tarjeta
              publicacion={publicacion}
              destacada={publicacion.id === destacada?.id}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function Encabezado() {
  return (
    <div className="mb-4 space-y-3">
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={C.pagina.titulo}
        subtitle={C.pagina.bajada}
      />
    </div>
  );
}

/**
 * El chip de estado. Es texto + color, nunca sólo color: quien no distingue
 * rojo de ámbar tiene que poder leer "Vence en 2 días" igual (§3.2).
 */
function ChipDeEstado({ publicacion }: { publicacion: PublicacionPropia }) {
  const { estado, status, pausedReason, closedReason } = publicacion;
  switch (estado.estado) {
    case "vencida":
      return <Badge variant="danger">{C.estado.vencida}</Badge>;
    case "por_vencer":
      return <Badge variant="warning">{C.estado.porVencer(estado.diasRestantes)}</Badge>;
    case "vigente":
      return <Badge variant="success">{C.estado.vigente(estado.diasRestantes)}</Badge>;
    default:
      // `no_vence` cubre varias cosas distintas y hay que decir cuál: una
      // categoría que no caduca (un negocio), una publicación que ni siquiera
      // está publicada (borrador, en revisión, dada de baja), una pausada —a
      // mano o por reportes, que son dos carteles distintos (0118)— y una
      // cerrada, con su propio motivo (0117).
      if (status === "draft") return <Badge>{C.estado.borrador}</Badge>;
      if (status === "pending_review") return <Badge variant="info">{C.estado.enRevision}</Badge>;
      if (status === "paused" && pausedReason === "reports") {
        return <Badge variant="warning">{C.estado.pausadaPorReportes}</Badge>;
      }
      if (status === "paused") return <Badge>{C.estado.pausada}</Badge>;
      if (status === "removed") return <Badge>{C.estado.bajada}</Badge>;
      if (status === "closed") {
        return (
          <Badge variant="success">
            {closedReason ? C.cerrar.badge[closedReason] : C.estado.noVence}
          </Badge>
        );
      }
      return <Badge>{C.estado.noVence}</Badge>;
  }
}

/**
 * Vive acá y no en `VENCIMIENTO_COPY` porque es copy de ESTA pantalla y de este
 * parámetro: no lo lee ningún otro módulo, y `lib/listings` es compartido.
 */
const COPY_DESTACADA = "De esto te avisamos";

function Tarjeta({
  publicacion,
  destacada = false,
}: {
  publicacion: PublicacionPropia;
  destacada?: boolean;
}) {
  const vencida = publicacion.estado.estado === "vencida";
  const porVencer = publicacion.estado.estado === "por_vencer";
  const isClosed = publicacion.status === "closed";
  const pausadaPorReportes =
    publicacion.status === "paused" && publicacion.pausedReason === "reports";
  const puedeCerrar = puedeCerrarPublicacion(publicacion.status, pausadaPorReportes);

  return (
    <article
      // Borde y fondo tintado, nunca una sombra de color: una sombra teñida se
      // lee como neón, no como jerarquía.
      className={cn(
        "flex gap-3 rounded-2xl border p-3",
        destacada ? "border-brand bg-brand-tint/30" : "border-border bg-surface",
      )}
    >
      {/* CardMedia y no un <Image> pelado: los avisos sembrados traen fotos de
          hosts externos y next/image LANZA en runtime con un host fuera del
          allowlist. Ese componente ya resuelve el fallback y el chequeo
          (`isOptimizableSrc`) en un solo lugar. */}
      <div
        className={cn(
          "size-16 shrink-0 overflow-hidden rounded-xl",
          // Una publicación que dejó de mostrarse (o que ya se cerró) se ve
          // apagada: el estado se percibe antes de leer el chip.
          (vencida || isClosed) && "opacity-60",
        )}
      >
        <CardMedia
          src={publicacion.photo}
          fallbackSrc={FALLBACK_PHOTO}
          aspect="square"
          sizes="64px"
          quality={62}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {destacada && (
            <span className="cl-print-hide rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-brand-foreground">
              {COPY_DESTACADA}
            </span>
          )}
          <span className="text-xs font-medium text-foreground-muted">
            {C.modulos[publicacion.kind] ?? publicacion.kind}
          </span>
          <ChipDeEstado publicacion={publicacion} />
        </div>

        <Link
          href={publicacion.href}
          className="block truncate font-semibold text-foreground hover:underline"
        >
          {publicacion.title}
        </Link>

        {(vencida || porVencer) && (
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {vencida ? C.detalle.vencidaCuerpo : C.detalle.porVencerCuerpo}
          </p>
        )}

        {pausadaPorReportes && (
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {C.detalle.pausadaPorReportesCuerpo}
          </p>
        )}

        {publicacion.renewalCount > 0 && (
          <p className="text-xs text-foreground-muted">
            {C.detalle.renovadaVeces(publicacion.renewalCount)}
          </p>
        )}

        {(publicacion.renovable || puedeCerrar) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {publicacion.renovable && (
              <RenovarBoton
                listingId={publicacion.id}
                kind={publicacion.kind}
                vencida={vencida}
              />
            )}
            {/* NI "reanudar" NI "Cerrar" se ofrecen en `pausadaPorReportes`
                (0118): "reanudar" porque la policy lo rechazaría igual (sólo
                el moderador la devuelve al aire desestimando el reporte), y
                "Cerrar" porque el trigger `listings_guard_cierre` (0117)
                rechaza con excepción cualquier cierre que salga de una pausa
                por denuncias — un aviso bajo revisión no lo resuelve su
                dueño cerrándolo, lo resuelve el moderador. `puedeCerrar` ya
                descarta este caso arriba; el comentario queda para quien lea
                sólo este JSX y se pregunte por qué no hay ningún botón acá. */}
            {puedeCerrar && (
              <CerrarBoton
                listingId={publicacion.id}
                kind={publicacion.kind}
                closedReason={closedReasonForKind(publicacion.kind)}
              />
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-20 w-full rounded-2xl" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-24 w-full rounded-2xl" />
      ))}
    </div>
  );
}
