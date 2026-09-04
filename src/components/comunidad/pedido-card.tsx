import Link from "next/link";
import { ChatCircleDots, MapPin } from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import { COMUNIDAD_COPY, HELP_TOPIC_LABEL, type HelpNotice } from "@/lib/comunidad";
import { cn } from "@/lib/utils";

const C = COMUNIDAD_COPY.pedirAyuda.card;

/**
 * =============================================================================
 * UN PEDIDO EN EL TABLÓN
 * =============================================================================
 *
 * La tarjeta tiene que contestar tres preguntas de un vistazo, en este orden:
 * DE QUÉ SE TRATA (el tema), QUÉ NECESITA (el título) y DÓNDE (la zona). Recién
 * después el texto, recortado, y al pie quién lo escribió y cuántos le
 * contestaron.
 *
 * ── DE DÓNDE SALE LA FORMA ──────────────────────────────────────────────────
 * Dos decisiones vienen de referencias reales y conviene decir cuáles:
 *
 *  · El CHIP DE TEMA arriba del título sale de Mindvalley "Network Discussions"
 *    (https://mobbin.com/screens/0ce3263e-3fcd-44fd-9681-9e45ebebdb97), donde
 *    cada posteo lleva su tema en una píldora sobre el título. Es lo que
 *    permite escanear un tablón mezclado sin leer: quien busca un dato de
 *    trámites saltea las diez tarjetas de comida sin procesarlas.
 *  · EL CONTADOR DE RESPUESTAS AL PIE, alineado a la derecha, sale de QUITTR
 *    "Community" (https://mobbin.com/screens/ba6982fb-4f59-48e4-85a0-c7cd623502b6),
 *    que pone el número en el borde derecho de cada tarjeta. Acá va más chico
 *    —no es un puntaje, es una invitación— pero en el mismo lugar, que es donde
 *    el ojo ya lo busca.
 *
 * Lo que NO viene de ninguna referencia y es criterio propio: que el texto se
 * recorte a tres líneas (un pedido de 1000 caracteres aplastaría a los cinco
 * que tiene abajo), que la zona vaya ARRIBA del cuerpo (es el segundo filtro
 * real después del tema: un dato de otro condado no sirve), y el "todavía nadie
 * contestó", que es lo contrario de esconder el cero — acá el cero es la mejor
 * razón para entrar.
 *
 * ── LA TARJETA ENTERA ES EL ENLACE ──────────────────────────────────────────
 * Mismo patrón que `<CasoCard>` de Perdido y encontrado, y por el mismo motivo:
 * dos destinos táctiles superpuestos en una tarjeta de 375 px son una mis-tap
 * garantizada. Un solo `<Link>` que envuelve todo, con su propio anillo de foco
 * — nada de "stretched link" con pseudo-elementos, que acá no compraría nada y
 * es un patrón que este repo no usa en ningún lado.
 *
 * ── LO QUE ESTA TARJETA NO MUESTRA ──────────────────────────────────────────
 * Ningún dato de contacto (no existe en la base), ningún puntaje de confianza y
 * ninguna foto:
 *
 *  · SIN TRUST SCORE. La `CasoCard` sí lo muestra, porque ahí alguien dice
 *    tener TUS documentos y la estafa clásica tiene plata adentro. Acá alguien
 *    pregunta algo. Ponerle nota a la necesidad es lo último que tiene que
 *    hacer esta pantalla.
 *  · SIN FOTO. Una cara identificable de una persona de esta población, al lado
 *    de su barrio y de lo que le falta, es exactamente el cruce que §5.4 pide
 *    no construir.
 */
export function PedidoCard({ pedido }: { pedido: HelpNotice }) {
  const resuelto = pedido.status === "archived";

  return (
    <Link
      href={`/comunidad/pedir-ayuda/${pedido.id}`}
      className={cn(
        "flex h-full flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-5 shadow-sm",
        "transition-[box-shadow,transform,opacity] duration-(--duration-base) ease-(--ease-out-premium)",
        "hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        resuelto && "opacity-70 hover:opacity-100",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chip size="sm" variant={resuelto ? "neutral" : "brand"}>
          {HELP_TOPIC_LABEL[pedido.topic]}
        </Chip>
        <span className="text-xs text-foreground-muted">{pedido.publishedAtLabel}</span>
      </div>

      <div className="space-y-1.5">
        <h3 className="font-display text-base font-semibold leading-snug text-foreground">
          {pedido.title}
        </h3>

        <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
          <MapPin size={16} aria-hidden="true" className="shrink-0" />
          {pedido.areaLabel}
        </p>
      </div>

      {/* Tres líneas y "…": el detalle completo se lee adentro. */}
      <p className="line-clamp-3 text-sm leading-relaxed text-foreground-secondary">
        {pedido.body}
      </p>

      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
        <span className="min-w-0 truncate text-sm font-medium text-foreground-secondary">
          {pedido.publisherName}
        </span>

        {pedido.replyCount > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-brand-ink">
            <ChatCircleDots size={16} weight="fill" aria-hidden="true" />
            {C.respuestas(pedido.replyCount)}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-foreground-muted">{C.sinRespuestas}</span>
        )}
      </footer>
    </Link>
  );
}
