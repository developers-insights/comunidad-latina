import { Suspense } from "react";
import Link from "next/link";
import { CaretLeft, Megaphone } from "@phosphor-icons/react/dist/ssr";
import {
  Badge,
  CardMedia,
  EmptyState,
  SectionHeading,
  Skeleton,
  buttonVariants,
} from "@/components/ui";
import { FALLBACK_PHOTO } from "@/components/listings";
import { VENCIMIENTO_COPY, type EstadoVencimiento } from "@/lib/listings";
import { cn } from "@/lib/utils";
import { fetchMisPublicaciones, type PublicacionPropia } from "./queries";
import { RenovarBoton } from "./renovar-boton";

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
 */
export default function MisPublicacionesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Contenido />
    </Suspense>
  );
}

/** Acento e ícono 3D de la sección (el mismo set del menú). */
const SECCION = {
  accent: "var(--accent-social)",
  image: "/icons/menu/social.webp",
} as const;

async function Contenido() {
  const { publicaciones, autenticado } = await fetchMisPublicaciones();

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

  return (
    <>
      <Encabezado />
      <ul className="space-y-3">
        {publicaciones.map((publicacion) => (
          <li key={publicacion.id}>
            <Tarjeta publicacion={publicacion} />
          </li>
        ))}
      </ul>
    </>
  );
}

function Encabezado() {
  return (
    <div className="mb-4 space-y-3">
      <Link
        href="/feed"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-foreground-secondary"
      >
        <CaretLeft size={16} aria-hidden="true" />
        {C.pagina.volver}
      </Link>
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
function ChipDeEstado({ estado, status }: { estado: EstadoVencimiento; status: string }) {
  switch (estado.estado) {
    case "vencida":
      return <Badge variant="danger">{C.estado.vencida}</Badge>;
    case "por_vencer":
      return <Badge variant="warning">{C.estado.porVencer(estado.diasRestantes)}</Badge>;
    case "vigente":
      return <Badge variant="success">{C.estado.vigente(estado.diasRestantes)}</Badge>;
    default:
      // `no_vence` cubre dos cosas distintas y hay que decir cuál: una categoría
      // que no caduca (un negocio) y una publicación que ni siquiera está
      // publicada (borrador, en revisión, pausada, dada de baja).
      if (status === "draft") return <Badge>{C.estado.borrador}</Badge>;
      if (status === "pending_review") return <Badge variant="info">{C.estado.enRevision}</Badge>;
      if (status === "paused") return <Badge>{C.estado.pausada}</Badge>;
      if (status === "removed") return <Badge>{C.estado.bajada}</Badge>;
      return <Badge>{C.estado.noVence}</Badge>;
  }
}

function Tarjeta({ publicacion }: { publicacion: PublicacionPropia }) {
  const vencida = publicacion.estado.estado === "vencida";
  const porVencer = publicacion.estado.estado === "por_vencer";

  return (
    <article className="flex gap-3 rounded-2xl border border-border bg-surface p-3">
      {/* CardMedia y no un <Image> pelado: los avisos sembrados traen fotos de
          hosts externos y next/image LANZA en runtime con un host fuera del
          allowlist. Ese componente ya resuelve el fallback y el chequeo
          (`isOptimizableSrc`) en un solo lugar. */}
      <div
        className={cn(
          "size-16 shrink-0 overflow-hidden rounded-xl",
          // Una publicación que dejó de mostrarse se ve apagada: el estado se
          // percibe antes de leer el chip.
          vencida && "opacity-60",
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
          <span className="text-xs font-medium text-foreground-muted">
            {C.modulos[publicacion.kind] ?? publicacion.kind}
          </span>
          <ChipDeEstado estado={publicacion.estado} status={publicacion.status} />
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

        {publicacion.renewalCount > 0 && (
          <p className="text-xs text-foreground-muted">
            {C.detalle.renovadaVeces(publicacion.renewalCount)}
          </p>
        )}

        {publicacion.renovable && (
          <div className="pt-1">
            <RenovarBoton
              listingId={publicacion.id}
              kind={publicacion.kind}
              vencida={vencida}
            />
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
