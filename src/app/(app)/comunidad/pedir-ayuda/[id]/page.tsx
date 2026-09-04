import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle, ChatCircleDots, MapPin, SignIn } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Chip, EmptyState, buttonVariants } from "@/components/ui";
import {
  EscribirBoton,
  ReglasDeAyuda,
  ResponderForm,
  RespuestaItem,
  RespuestasSkeleton,
} from "@/components/comunidad";
import { COMUNIDAD_COPY, HELP_TOPIC_LABEL } from "@/lib/comunidad";
import { getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchHelpNotice, fetchHelpReplies } from "../../queries";

const C = COMUNIDAD_COPY.pedirAyuda;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * =============================================================================
 * UN PEDIDO Y SUS RESPUESTAS
 * =============================================================================
 *
 * Es la pantalla que el módulo no tenía y por la que el cliente lo pidió de
 * nuevo: «la gente pone lo que necesita y la gente le contesta». Sin esta
 * pantalla, la 0120 era un tablón donde nadie podía decir nada.
 *
 * ── EL ORDEN DE LA PÁGINA, Y POR QUÉ ────────────────────────────────────────
 *   1. El pedido completo (sin recortar: acá se viene a leerlo).
 *   2. Las reglas, cortas, ANTES de la caja de escribir — la que importa es
 *      "quien te contesta es un vecino", y tiene que leerse antes de que
 *      alguien se mueva por un dato.
 *   3. La caja de responder.
 *   4. El hilo.
 *
 * La caja va ANTES del hilo y no después: en un pedido con veinte respuestas,
 * un composer al final obliga a scrollear todo para contestar. Es un desvío
 * consciente del patrón de Glassdoor —ver la cabecera de `<ResponderForm>`—
 * porque su barra fija al pie chocaría con la navegación de la app.
 *
 * ── EL HILO VA EN SU PROPIO SUSPENSE ────────────────────────────────────────
 * El pedido y las respuestas son dos consultas y el pedido es lo que la
 * persona vino a leer: no tiene por qué esperar a que se resuelva el hilo. Es
 * el mismo criterio que los contadores de la portada del módulo.
 *
 * ── QUÉ VE QUIÉN ────────────────────────────────────────────────────────────
 * La RLS manda: un pedido oculto o resuelto sólo lo abre su autor (y el
 * equipo). Para cualquier otro, `fetchHelpNotice` devuelve null y esta pantalla
 * muestra "ese pedido ya no está" — nunca confirma que exista algo que no se
 * puede ver.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: C.title };

  const [tenant, viewerId] = await Promise.all([getTenant(), getAuthUserId()]);
  const { pedido } = await fetchHelpNotice({ id, tenantId: tenant.id, viewerId });
  return { title: pedido?.title ?? C.title };
}

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Un id que ni siquiera tiene forma de uuid no llega a la base: el `where`
  // fallaría con un error de tipo de Postgres en vez de con un 404.
  if (!UUID_RE.test(id)) notFound();

  const [tenant, viewerId] = await Promise.all([getTenant(), getAuthUserId()]);
  const { pedido, needsSession } = await fetchHelpNotice({ id, tenantId: tenant.id, viewerId });

  if (needsSession) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={COMUNIDAD_COPY.escribirPedido.sinSesion.title}
        message={COMUNIDAD_COPY.escribirPedido.sinSesion.message}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent(`/comunidad/pedir-ayuda/${id}`)}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COMUNIDAD_COPY.escribirPedido.sinSesion.cta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  if (!pedido) {
    return (
      <EmptyState
        icon={<ChatCircleDots size={32} weight="light" aria-hidden="true" />}
        title={C.detalle.noEncontrado.title}
        message={C.detalle.noEncontrado.message}
        action={
          <Link
            href="/comunidad/pedir-ayuda"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {C.detalle.noEncontrado.cta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  const resuelto = pedido.status === "archived";
  const abierto = pedido.status === "approved";

  return (
    <>
      <BezelCard coreClassName="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant={resuelto ? "neutral" : "brand"}>
              {HELP_TOPIC_LABEL[pedido.topic]}
            </Chip>
            {resuelto && (
              <Chip
                size="sm"
                variant="success"
                icon={<CheckCircle size={14} weight="fill" aria-hidden="true" />}
              >
                {C.card.resuelto}
              </Chip>
            )}
          </div>
          <span className="text-xs text-foreground-muted">{pedido.publishedAtLabel}</span>
        </div>

        <h1 className="font-display text-xl font-bold leading-snug tracking-tight text-foreground">
          {pedido.title}
        </h1>

        <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
          <MapPin size={16} aria-hidden="true" className="shrink-0" />
          {pedido.areaLabel}
        </p>

        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
          {pedido.body}
        </p>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
          <p className="min-w-0 text-sm text-foreground-muted">
            <span className="font-medium text-foreground-secondary">{pedido.publisherName}</span>
          </p>

          {/* El dueño no se escribe a sí mismo; y en un pedido cerrado no hay a
              qué sumarse. El canal privado es SECUNDARIO frente a responder en
              público: lo público le sirve a los próximos veinte. */}
          {!pedido.isOwner && abierto && (
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <EscribirBoton pedidoId={pedido.id} />
              <span className="text-xs text-foreground-muted">{C.card.escribirHint}</span>
            </div>
          )}

          {pedido.isOwner && (
            <Link
              href="/comunidad/pedir-ayuda/mios"
              className="text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
            >
              {C.misPedidosCta}
            </Link>
          )}
        </footer>
      </BezelCard>

      <section aria-labelledby="respuestas-title" className="mt-6">
        <h2
          id="respuestas-title"
          className="font-display text-lg font-bold tracking-tight text-foreground"
        >
          {C.respuestas.title}
        </h2>

        <ReglasDeAyuda variante="lectura" className="mt-3" />

        {abierto ? (
          <div className="mt-4">
            {viewerId ? (
              <ResponderForm pedidoId={pedido.id} />
            ) : (
              <EmptyState
                icon={<SignIn />}
                title={C.respuestas.sinSesion.title}
                message={C.respuestas.sinSesion.message}
                action={
                  <Link
                    href={`/entrar?next=${encodeURIComponent(`/comunidad/pedir-ayuda/${id}`)}`}
                    className={buttonVariants({ variant: "primary", size: "md" })}
                  >
                    {C.respuestas.sinSesion.cta}
                  </Link>
                }
              />
            )}
          </div>
        ) : null}

        <Suspense fallback={<RespuestasSkeleton />}>
          <Hilo
            noticeId={pedido.id}
            tenantId={tenant.id}
            viewerId={viewerId}
            tituloDelPedido={pedido.title}
            autorDelPedido={pedido.publisherId}
            puedeResponder={abierto}
          />
        </Suspense>
      </section>
    </>
  );
}

async function Hilo({
  noticeId,
  tenantId,
  viewerId,
  tituloDelPedido,
  autorDelPedido,
  puedeResponder,
}: {
  noticeId: string;
  tenantId: string;
  viewerId: string | null;
  tituloDelPedido: string;
  autorDelPedido: string;
  puedeResponder: boolean;
}) {
  const respuestas = await fetchHelpReplies({ noticeId, tenantId, viewerId });

  if (respuestas.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-border-subtle px-4 py-6 text-center text-sm leading-relaxed text-foreground-muted">
        <span className="block font-medium text-foreground-secondary">
          {C.respuestas.vacioTitle}
        </span>
        {/* El vacío sólo invita cuando todavía se puede contestar. En un pedido
            resuelto, invitar a escribir sería ofrecer algo que la base rechaza. */}
        {puedeResponder && <span className="mt-1 block">{C.respuestas.vacioMessage}</span>}
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {respuestas.map((respuesta) => (
        <RespuestaItem
          key={respuesta.id}
          respuesta={respuesta}
          tituloDelPedido={tituloDelPedido}
          esAutorDelPedido={respuesta.authorId === autorDelPedido}
        />
      ))}
    </div>
  );
}
