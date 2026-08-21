"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CalendarBlank,
  ChatCircleDots,
  Info,
  MapPin,
  ShieldCheck,
  ShieldWarning,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, BottomSheet, Button, CardMedia, buttonVariants } from "@/components/ui";
import {
  PublisherTrust,
  FALLBACK_PHOTO,
  // Etiqueta del gesto "tocar la foto abre el visor": la define el módulo de
  // avisos y la comparten sus dos cards (ListingCard y ésta) para decir lo
  // mismo con las mismas palabras.
  COPY as LISTINGS_COPY,
} from "@/components/listings";
// Las TRES acciones que la ficha monta ya estaban escritas, probadas y en uso
// en otras pantallas. Ninguna pide un campo nuevo del modelo: se resuelven con
// el id que la card ya tiene. Ver el docblock de `ListingSheetAction`.
import { InlineContact, listingMessageOutcome } from "@/components/messaging";
import { JobApplyInline } from "@/components/empleos/job-apply-inline";
import { ApplySheet } from "@/components/creators/apply-sheet";
import { sendListingMessageAction } from "@/app/(app)/mensajes/inline-actions";
import { useCloseOnBack } from "@/lib/design/use-overlay";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { useMediaViewer } from "./media-viewer";
import type { FeedListingModel } from "./helpers";

import type { Icon } from "@phosphor-icons/react";

const KIND_ICON: Record<string, Icon> = {
  business: Storefront,
  professional: UserGear,
  event: CalendarBlank,
  job: Briefcase,
  product: ShoppingBagOpen,
  creator_gig: Sparkle,
};

/**
 * Página completa de cada vertical. Ya NO es "el destino del CTA" —desde este
 * cambio el CTA abre la ficha en hoja— sino la URL CANÓNICA del aviso: la que
 * viaja en el `href` del disparador, la que se copia al compartir, la que abre
 * "en otra pestaña" y la que ofrece la propia hoja como salida deliberada.
 *
 * `business` entró acá el 2026-08-20 y merece nota aparte: no estaba porque
 * cuando se escribió esta card el negocio no tenía página propia, y por eso la
 * hoja terminaba empujando al DIRECTORIO entero. Existe `/negocios/[id]` desde
 * el 2026-07-30 (call del 29/7, 1:05: "si le das ver al negocio tiene que salir
 * el profile del negocio, toda la información"), así que el negocio dejó de ser
 * la excepción y esta tabla volvió a cubrir los seis verticales.
 */
const DETAIL_ROUTE: Record<string, (id: string) => string> = {
  business: (id) => `/negocios/${id}`,
  event: (id) => `/eventos/${id}`,
  professional: (id) => `/profesionales/${id}`,
  product: (id) => `/marketplace/${id}`,
  creator_gig: (id) => `/creadores/${id}`,
  job: (id) => `/empleos/${id}`,
};

/** Acento del módulo por vertical (para el CTA). Cubre los kinds de esta card. */
const LISTING_ACCENT: Record<string, string> = {
  business: "var(--accent-negocios)",
  professional: "var(--accent-profesionales)",
  event: "var(--accent-eventos)",
  job: "var(--accent-empleos)",
  product: "var(--accent-marketplace)",
  creator_gig: "var(--accent-creadores)",
};

/**
 * Rótulos que estrena la ficha en hoja.
 *
 * Viven acá y no en `copy.ts` por coordinación, no por diseño: ese archivo lo
 * está tocando otro frente en esta misma tanda. MOVER a `COPY.listing` cuando
 * se pueda editar. El precedente ya existe y es del mismo origen
 * (`COMMENT_THREAD_COPY`, en helpers.ts).
 *
 * "Ver el aviso completo" es hermano literal del "Ver la publicación completa"
 * de la hoja de publicación: la misma acción —salir a la página entera— tiene
 * que llamarse igual en las dos hojas, o quien la usa cree que son dos cosas
 * distintas.
 */
const SHEET_COPY = {
  openFull: "Ver el aviso completo",
  /** Disparador sin texto visible (la foto, o su marco cuando no hay foto). */
  openDetails: (title: string) => `Ver los detalles de ${title}`,
} as const;

/**
 * Copy del CONTACTO in-situ, por vertical y compartido.
 *
 * Vive acá, local al componente, por la misma razón que en `listings/contact-cta`
 * y `directory/directory-contact-cta`: el texto de cada código de error lo elige
 * la PANTALLA, nunca el action —"es tu propia publicación" y "este perfil es
 * tuyo" son el mismo código y dos frases distintas— y `copy.ts` de este módulo
 * lo está tocando otro frente en esta misma tanda.
 *
 * El rótulo dice a QUIÉN se le escribe y no "Contactar" a secas: en una ficha
 * que se abre desde un feed mezclado, quien la abre necesita saber si del otro
 * lado hay una persona que vende, un negocio o quien organiza algo.
 */
const CONTACT_KIND_COPY: Record<string, { trigger: string; placeholder: string }> = {
  product: {
    trigger: "Escribirle a quien vende",
    placeholder: "Hola, me interesa. ¿Sigue disponible?",
  },
  business: {
    trigger: "Escribirle al negocio",
    placeholder: "Hola, quería hacerles una consulta.",
  },
  professional: {
    trigger: "Consultar por el servicio",
    placeholder: "Hola, quería consultarte por tu servicio.",
  },
  event: {
    trigger: "Consultar por el evento",
    placeholder: "Hola, quería consultarte por el evento.",
  },
};

const CONTACT_COPY = {
  fieldLabel: "Escribí tu mensaje",
  send: "Enviar mensaje",
  cancel: "Cancelar",
  /**
   * Corta a propósito. Las otras pantallas dicen acá la frase larga con la
   * advertencia de plata, pero en esta ficha esa advertencia YA está —entera y
   * en su recuadro— tres dedos más arriba. Repetirla en 40px al pie sería
   * decirla dos veces y empujar el botón fuera de la vista, que es justo lo que
   * este cambio vino a arreglar. Mismo criterio que el chat de `ListingActions`.
   */
  hint: "Se abre un chat privado.",
  sentTitle: "Mensaje enviado",
  sentBody: "Te avisamos acá apenas te respondan.",
  // Ya venían hablando: se dice, no se disfraza de contacto nuevo.
  reusedTitle: "Lo sumamos al chat que ya tenían",
  reusedBody: "No abrimos nada nuevo: tu mensaje quedó en esa misma conversación.",
  threadLink: "Abrir el chat",
  retryLogin: "Entrar a mi cuenta",
  errors: {
    self: "Este aviso lo publicaste vos — no hace falta que te escribas.",
    blocked: "No podemos entregar este mensaje.",
    /**
     * NO dice "se cerró tu sesión", que es lo que dicen las pantallas de
     * detalle. Acá el mismo código cubre dos situaciones —la sesión venció, o
     * nunca hubo una— porque la ficha del feed no sabe cuál de las dos es (ver
     * `isLoggedIn="unknown"`). La frase es cierta en las dos, y la segunda
     * mitad es la que importa: lo que escribió no se perdió.
     */
    unauthenticated:
      "Necesitás tu cuenta para enviarlo. Entrá y lo mandamos tal como lo escribiste.",
    "tenant-mismatch": "Algo no cuadra con tu sesión. Salí y volvé a entrar.",
    invalid: "Escribí un poquito más antes de enviarlo.",
    error: "No pudimos enviarlo — no es tu culpa. Probá de nuevo en un ratito.",
  },
  /** Aviso de seed/API: del otro lado no hay cuenta, así que no hay chat. */
  external: (name: string) =>
    `${name} publicó este aviso fuera de la app, así que acá no hay chat. Los datos de contacto están en el aviso completo.`,
} as const;

/**
 * LA ACCIÓN PRINCIPAL DEL VERTICAL, ADENTRO DE LA FICHA.
 *
 * Hallazgo BLOQUEANTE de la revisión de código (2026-08-20): la ficha en hoja
 * —que existe para que el feed no te expulse— había AGREGADO un paso a la única
 * cosa que convierte. Antes, "Ver detalles" llevaba a la página del aviso,
 * donde está el CTA de postularse o contactar: UN toque hasta la acción. Con la
 * ficha eran DOS, porque había que salir por "Ver el aviso completo" para
 * encontrarlo. Para LEER la ficha ganaba; para HACER empeoró los seis
 * verticales a la vez, que es exactamente lo contrario del pedido del cliente
 * ("mientras menos pasos mejor", 2026-08-20).
 *
 * La solución ya estaba escrita en esta misma rama, y por eso no hay ni una
 * consulta nueva ni un campo nuevo en `FeedListingModel`: las tres acciones se
 * montan con el ID que la card ya tiene y se resuelven contra el servidor
 * cuando alguien las toca.
 *
 *  · `job` → `JobApplyInline`. Pide su contexto al tocar y distingue los cuatro
 *    finales que no son un formulario: ya te postulaste, el aviso es tuyo, se
 *    despublicó, o no hay sesión. Vale también para un aviso de fuente externa:
 *    `/empleos/[id]` tampoco lo gatea, y una postulación no necesita bandeja de
 *    entrada del otro lado.
 *  · `creator_gig` → `ApplySheet` en su superficie `"card"`, la que estrenó el
 *    listado de creadores. Es la MISMA hoja y la misma action que
 *    `/creadores/[id]`, con el final honesto incluido ("ya te habías postulado:
 *    lo que escribiste ahora no se envió").
 *  · `product` · `business` · `professional` · `event` → `InlineContact`, el
 *    primitivo que ya usan las cuatro pantallas de contacto. Se elige el
 *    primitivo y no `listings/inline-message-cta` —que sería el atajo— por dos
 *    razones concretas: su prop `isLoggedIn` es `boolean` y esta ficha no puede
 *    afirmar ninguno de los dos valores, y su texto de sesión ("se cerró tu
 *    sesión") sería falso para quien nunca entró. Con el primitivo, el copy es
 *    de esta pantalla, que es como el resto del repo ya lo hace.
 *
 * ── LO QUE NO SE PUEDE MONTAR ACÁ, Y NO SE FINGE ────────────────────────────
 * En eventos la acción estrella es "Quiero ir", y NO está: `EventActions`
 * necesita saber si ESTA persona ya dijo que va y cuántos van, y ninguna de las
 * dos cosas viaja en `FeedListingModel`. Montarlo sin eso pintaría "Quiero ir"
 * apagado a quien ya se anotó —y el toque siguiente lo DESANOTARÍA—, que es el
 * defecto que este repo ya arregló tres veces. Queda a un toque, en "Ver el
 * aviso completo", igual que antes de esta rama; lo que se gana acá es
 * consultarle al organizador sin salir del feed.
 *
 * Y en los avisos de fuente externa no hay contacto que ofrecer: `request_contact`
 * rebota con `LISTING_HAS_NO_ACCOUNT` porque del otro lado no hay cuenta. En vez
 * de abrir un composer que va a fallar DESPUÉS de que la persona escriba, la
 * ficha lo dice antes (ver `externalNote` en la card).
 */
function ListingSheetAction({ listing }: { listing: FeedListingModel }) {
  if (listing.kind === "job") {
    return <JobApplyInline jobId={listing.id} jobTitle={listing.title} />;
  }

  if (listing.kind === "creator_gig") {
    return <ApplySheet gigId={listing.id} surface="card" gigTitle={listing.title} />;
  }

  const kindCopy = CONTACT_KIND_COPY[listing.kind];
  if (!kindCopy) return null;

  return (
    <InlineContact
      // La ficha se monta con el modelo del aviso y nada más: el viewer no
      // llega hasta acá. Ver el docblock de la prop — decir `false` le abriría
      // la hoja de sesión a quien ya entró, y eso es el paso de más otra vez.
      isLoggedIn="unknown"
      // `md` (44px) y no el `lg` de las barras stickies: acá abajo conviven con
      // los botones de postulación, que son `md`. Una sola altura de acción.
      triggerSize="md"
      triggerIcon={<ChatCircleDots size={18} aria-hidden="true" />}
      triggerAriaLabel={`${kindCopy.trigger} ${listing.title}`}
      copy={{
        trigger: kindCopy.trigger,
        placeholder: kindCopy.placeholder,
        fieldLabel: CONTACT_COPY.fieldLabel,
        send: CONTACT_COPY.send,
        cancel: CONTACT_COPY.cancel,
        hint: CONTACT_COPY.hint,
        sentTitle: CONTACT_COPY.sentTitle,
        sentBody: CONTACT_COPY.sentBody,
        reusedTitle: CONTACT_COPY.reusedTitle,
        reusedBody: CONTACT_COPY.reusedBody,
        threadLink: CONTACT_COPY.threadLink,
        retryLogin: CONTACT_COPY.retryLogin,
      }}
      onSend={async (body) =>
        listingMessageOutcome(
          await sendListingMessageAction({ listingId: listing.id, body }),
          CONTACT_COPY.errors,
        )
      }
    />
  );
}

/** Foto grande tocable = red social (§4.b, feedback 2026-07-24 / 2026-07-26). */
const MEDIA_LINK =
  "group block w-full text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.99]";

/**
 * DISPARADOR DE LA FICHA — abre la hoja SIN dejar de ser un link.
 *
 * Feedback cliente 2026-08-20: "no te tiene que mover a otra publicación; ahí
 * nomás dentro de pantalla se tiene que fluir sin sacarte del feed. Mientras
 * menos pasos mejor". Hasta hoy esta card cumplía eso sólo cuando NO había
 * página de detalle: entonces abría la hoja resumida. Con página, navegaba. O
 * sea que la buena solución estaba escrita, probada y usada como plan B —"la
 * inconsistencia demostrada en un solo archivo", en palabras de la revisión de
 * código del 2026-08-20. Ahora la hoja es el camino, siempre.
 *
 * Sigue siendo un `<a href>` de verdad —no un `<button>`— y eso no es un
 * detalle, es el contrato entero (mismo criterio y mismo código que
 * `PostSheetTrigger`, que ya resolvió esto para las miniaturas de posts):
 *
 *  · compartir y "copiar dirección del enlace" siguen dando la URL canónica del
 *    aviso;
 *  · con ctrl/cmd/shift/alt o botón del medio el navegador hace lo suyo y la
 *    hoja no se mete: "abrir en otra pestaña" tiene que seguir abriendo la
 *    página;
 *  · sin JS —el HTML que sale del servidor ES este ancla— el toque navega al
 *    detalle de siempre. La hoja MEJORA el camino; no es el único que hay.
 *
 * Sólo el toque simple se queda acá adentro. Y cuando el kind no tiene página
 * (uno nuevo que todavía no está en `DETAIL_ROUTE`) no hay `href` que fingir:
 * ahí el disparador es un botón honesto, que es lo que esta card ya hacía.
 */
function ListingSheetTrigger({
  detailHref,
  onOpen,
  ariaLabel,
  className,
  style,
  children,
}: {
  detailHref: string | null;
  onOpen: () => void;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (!detailHref) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={ariaLabel}
        className={className}
        style={style}
      >
        {children}
      </button>
    );
  }

  return (
    <Link
      href={detailHref}
      aria-label={ariaLabel}
      className={className}
      style={style}
      onClick={(event) => {
        // Modificadores y botón del medio: es un pedido explícito de "abrilo
        // como link". No se toca.
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
        onOpen();
      }}
    >
      {children}
    </Link>
  );
}

/**
 * CTA en píldora con el ACENTO del módulo (feedback cliente 2026-07-21: el botón
 * "Ver detalles" deja de ser gris). El acento viaja en el borde/tinte y en la
 * flecha; el texto queda en `text-foreground` para no arriesgar contraste (mismo
 * criterio AA que EntityKindChip — el amarillo de negocios no sería AA como texto).
 *
 * El rótulo no cambió y no tenía por qué: "Ver detalles" describe igual de bien
 * abrir la ficha que abrir la página. Lo que cambió es a dónde te deja.
 *
 * POR QUÉ NO ES EL `AccentLink` DE `@/components/ui`. Ese componente —extraído
 * de acá mismo para que lo compartan todas las cards de directorio— es a
 * propósito "sólo un <Link>, sin estado ni handlers", y sin handler no hay
 * interceptación posible: sería volver a navegar. Las clases y el `style` son
 * los MISMOS, copiados carácter por carácter, así que las dos píldoras se ven
 * idénticas; si alguien toca una, tiene que tocar la otra. La forma de que eso
 * deje de depender de la memoria de alguien es que `AccentLink` acepte un
 * `onClick` opcional y esta card lo use — no se hizo acá porque ese archivo es
 * de otro frente en esta misma tanda.
 */
function AccentCta({
  accent,
  detailHref,
  onOpen,
  children,
}: {
  accent: string;
  detailHref: string | null;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <ListingSheetTrigger
      detailHref={detailHref}
      onOpen={onOpen}
      className={cn(
        "mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold text-foreground",
        "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
      style={{
        borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${accent} 12%, transparent)`,
      }}
    >
      {children}
      <ArrowRight size={16} aria-hidden="true" style={{ color: accent }} />
    </ListingSheetTrigger>
  );
}

/**
 * Card de listing NO-property para el feed (§4.b): misma gramática visual que la
 * ListingCard de VIVIENDA. Foto protagonista en 4:5 (retrato, como el resto del
 * directorio desde 37fea5c) con el título/precio/zona en la franja de VIDRIO
 * sobre su borde inferior; el kind y la verificación quedan arriba.
 *
 * DOS destinos, uno por gesto (feedback 2026-07-26, sigue en pie): tocar la FOTO
 * abre el visor a pantalla completa; la píldora abre la FICHA. Ninguno de los
 * dos navega ya, así que los dos cumplen el pedido del 2026-08-20 — la
 * diferencia es qué querés mirar, no cuántos pasos te cuesta.
 *
 * Si el aviso no trajo foto, el marco cae al mismo destino que la píldora:
 * abrir un visor del fallback genérico no le daría nada a nadie. Y si el visor
 * no está montado (árbol sin `MediaViewerProvider`), la foto tampoco queda
 * muerta: cae también a la ficha, que es lo más parecido a lo que la persona
 * pidió.
 *
 * Los listings de propiedades usan SIEMPRE la ListingCard real.
 */
export function FeedListingCard({ listing }: { listing: FeedListingModel }) {
  const [open, setOpen] = useState(false);
  const viewer = useMediaViewer();
  const KindIcon = KIND_ICON[listing.kind] ?? Storefront;
  const kindLabel = COPY.listing.kindLabel[listing.kind] ?? listing.kind;
  const detailHref = DETAIL_ROUTE[listing.kind]?.(listing.id) ?? null;
  const accent = LISTING_ACCENT[listing.kind] ?? "var(--accent-feed)";
  const photoUrl = listing.photoUrl;
  /** El gesto "foto → visor" sólo existe si hay foto Y hay visor que abrir. */
  const canOpenPhotos = Boolean(photoUrl) && viewer.available;

  /**
   * Aviso traído por una fuente externa (seed/API, `created_by` nulo): tiene
   * nombre de quien publica pero NO tiene cuenta, y por lo tanto no tiene
   * bandeja de entrada. `publisherTrust` es la señal fiable —lo arma
   * `toFeedListingModel` sólo cuando hay autor con perfil— y es la misma
   * distinción que hacen las páginas de detalle con `isExternal`.
   */
  const externalName = listing.publisherTrust ? null : listing.publisherName;
  const canContactHere = Boolean(CONTACT_KIND_COPY[listing.kind]) && externalName === null;
  /** Los kinds que escriben un mensaje: son los únicos que abren teclado acá. */
  const hasComposer = canContactHere;
  const externalNote =
    CONTACT_KIND_COPY[listing.kind] && externalName
      ? CONTACT_COPY.external(externalName)
      : null;
  /**
   * `null` = este kind no tiene acción in-situ (uno nuevo, o un aviso externo
   * sin cuenta a la que escribirle). Entonces la hoja no dibuja el pie: la
   * ficha queda como estaba, de una sola pieza scrolleable.
   */
  const sheetAction =
    listing.kind === "job" || listing.kind === "creator_gig" || canContactHere ? (
      <ListingSheetAction listing={listing} />
    ) : null;

  function openSheet() {
    setOpen(true);
  }

  function closeSheet() {
    setOpen(false);
  }

  /**
   * EL "ATRÁS" DEL TELÉFONO CIERRA LA FICHA, NO LA PANTALLA.
   *
   * Es la contracara obligatoria de haber dejado de navegar: antes, el "atrás"
   * de Android devolvía el feed porque el CTA había hecho una navegación de
   * verdad. Sin esto, ese mismo gesto —el más usado del teléfono— sacaría del
   * feed entero con la ficha abierta, que es justo lo que este cambio vino a
   * eliminar. `useCloseOnBack` es el par pushState/popstate compartido que ya
   * usan el visor de medios y la hoja de publicación: con otra hoja encima, un
   * "atrás" cierra sólo la de arriba.
   */
  useCloseOnBack(open, closeSheet);

  function openPhotos() {
    if (!photoUrl) return;
    viewer.open({
      items: [{ kind: "image", url: photoUrl }],
      authorName: listing.title,
    });
  }

  const media = (
    <CardMedia
      src={listing.photoUrl}
      fallbackSrc={FALLBACK_PHOTO}
      aspect="portrait"
      quality={62}
      overlayTopLeft={
        <>
          <Badge variant="neutral">
            <KindIcon size={13} aria-hidden="true" />
            {kindLabel}
          </Badge>
          {listing.verifiedDateLabel && (
            <Badge variant="success">
              <ShieldCheck size={13} aria-hidden="true" />
              {COPY.listing.verifiedChip(listing.verifiedDateLabel)}
            </Badge>
          )}
        </>
      }
      overlayBottom={
        <div>
          <h3 className="font-display text-base font-bold leading-snug line-clamp-2">
            {listing.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            {listing.priceLabel && (
              <span className="numeric text-lg font-bold">{listing.priceLabel}</span>
            )}
            {listing.areaLabel && (
              <span className="flex items-center gap-1 text-sm opacity-90">
                <MapPin size={14} aria-hidden="true" className="shrink-0" />
                {listing.areaLabel}
              </span>
            )}
          </div>
        </div>
      }
    />
  );

  return (
    <>
      <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel">
        <article
          aria-label={listing.title}
          className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface shadow-[inset_0_1px_0_var(--cl-bezel-highlight)]"
        >
          {canOpenPhotos ? (
            <button
              type="button"
              onClick={openPhotos}
              aria-label={LISTINGS_COPY.list.openPhotos(listing.title)}
              className={MEDIA_LINK}
            >
              {media}
            </button>
          ) : (
            <ListingSheetTrigger
              detailHref={detailHref}
              onOpen={openSheet}
              ariaLabel={SHEET_COPY.openDetails(listing.title)}
              className={MEDIA_LINK}
            >
              {media}
            </ListingSheetTrigger>
          )}

          <div className="flex flex-col gap-2.5 p-4">
            {listing.publisherTrust ? (
              <div className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
                <span className="truncate">{listing.publisherTrust.displayName}</span>
                <PublisherTrust
                  displayName={listing.publisherTrust.displayName}
                  firstName={listing.publisherTrust.firstName}
                  score={listing.publisherTrust.score}
                  level={listing.publisherTrust.level}
                  signals={listing.publisherTrust.signals}
                  profileId={listing.publisherTrust.profileId}
                  size="inline"
                />
              </div>
            ) : listing.publisherName ? (
              <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
                <Storefront size={16} aria-hidden="true" className="shrink-0" />
                {COPY.listing.externalPublisher(listing.publisherName)}
              </p>
            ) : null}

            <AccentCta accent={accent} detailHref={detailHref} onOpen={openSheet}>
              {COPY.listing.viewDetails}
            </AccentCta>
          </div>
        </article>
      </div>

      {/*
        LA FICHA. Antes existía sólo para los kinds sin página; ahora es lo que
        ve todo el mundo, así que tiene que alcanzar para DECIDIR sin ir a
        ningún lado — ese es el objetivo, no "mostrar un resumen". Por eso
        estrena las dos cosas que la card mostraba y ella no: la FOTO y el sello
        de licencia. Sin ellas, tocar "Ver detalles" abría una ficha con MENOS
        información de la que ya estaba en pantalla.

        Y desde el 2026-08-21 muestra lo que le faltaba —el contacto y la
        postulación—, que era la mitad que convertía. No hizo falta ningún campo
        nuevo del modelo: ver `ListingSheetAction`.

        ── POR QUÉ EL CUERPO SE PARTE EN DOS ────────────────────────────────
        La acción va en un PIE ANCLADO, no al final del scroll. En un teléfono
        de 375px la ficha entra de sobra en 85dvh sólo si el aviso es corto: con
        foto, precio y una descripción de verdad, cualquier cosa que esté al
        final nace abajo del pliegue. Dejar la acción ahí sería cambiar "un
        toque de más" por "un scroll de más", que para el caso es lo mismo. El
        pie deja el CTA a la vista desde que la hoja abre, igual que la barra
        sticky de las páginas de detalle, y el resto sigue scrolleando detrás.

        `keyboardAware` sólo para los kinds que escriben: con el composer
        abierto, el teclado de iOS tapaba el campo (el visual viewport no achica
        el layout viewport). Es la misma prop que ya usa la hoja de comentarios,
        y se pide sólo cuando hay campo — no es gratis, escucha `visualViewport`.
      */}
      <BottomSheet
        open={open}
        onClose={closeSheet}
        title={listing.title}
        keyboardAware={hasComposer}
        // El cuerpo toma el control del layout: zona scrolleable + pie fijo.
        // Sin esto el BottomSheet scrollea todo junto y el CTA se va abajo.
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-5 pt-4">
          {photoUrl && (
            /*
              16:9 y no el 4:5 de la card, a propósito: acá la foto es la
              CONFIRMACIÓN de que estás mirando lo que creías, no la vidriera.
              En un teléfono de 375px un retrato empuja el precio y la
              descripción abajo del pliegue, y esos son los datos que traen a
              alguien a la ficha. La foto entera sigue a un toque de distancia,
              en el visor de siempre.
            */
            <div className="overflow-hidden rounded-lg">
              {viewer.available ? (
                <button
                  type="button"
                  onClick={openPhotos}
                  aria-label={LISTINGS_COPY.list.openPhotos(listing.title)}
                  className="block w-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring"
                >
                  <CardMedia src={photoUrl} fallbackSrc={FALLBACK_PHOTO} aspect="video" quality={62} />
                </button>
              ) : (
                <CardMedia src={photoUrl} fallbackSrc={FALLBACK_PHOTO} aspect="video" quality={62} />
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">
              <KindIcon size={13} aria-hidden="true" />
              {kindLabel}
            </Badge>
            {/* §11: nunca "Verificado" a secas — la afirmación es sobre la
                licencia, y decirla acá evita que la ficha parezca menos
                confiable que la card de la que se abrió. */}
            {listing.verifiedDateLabel && (
              <Badge variant="success">
                <ShieldCheck size={13} aria-hidden="true" />
                {COPY.listing.verifiedChip(listing.verifiedDateLabel)}
              </Badge>
            )}
            {listing.areaLabel && (
              <span className="flex items-center gap-1 text-sm text-foreground-secondary">
                <MapPin size={14} aria-hidden="true" />
                {listing.areaLabel}
              </span>
            )}
          </div>

          {listing.priceLabel && (
            <p className="numeric text-2xl font-bold text-brand">{listing.priceLabel}</p>
          )}

          {listing.description && (
            // `break-words`: una dirección o un teléfono pegado sin espacios
            // ensancha el panel y saca la ficha de los 375px con scroll
            // horizontal. El texto se parte antes de que eso pase.
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground-secondary">
              {listing.description}
            </p>
          )}

          {(listing.publisherTrust || listing.publisherName) && (
            <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                {COPY.listing.sheetPublishedBy}
              </p>
              {listing.publisherTrust ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {listing.publisherTrust.displayName}
                  </span>
                  <PublisherTrust
                    displayName={listing.publisherTrust.displayName}
                    firstName={listing.publisherTrust.firstName}
                    score={listing.publisherTrust.score}
                    level={listing.publisherTrust.level}
                    signals={listing.publisherTrust.signals}
                    profileId={listing.publisherTrust.profileId}
                    size="inline"
                  />
                </div>
              ) : (
                <p className="mt-2 text-sm text-foreground-secondary">
                  {COPY.listing.externalPublisher(listing.publisherName ?? "")}
                </p>
              )}
            </div>
          )}

          {/*
            SE DICE ANTES, NO DESPUÉS.

            Un aviso de fuente externa no tiene cuenta del otro lado:
            `request_contact` lo rechaza con `LISTING_HAS_NO_ACCOUNT`. Abrir el
            composer igual sería dejar que alguien escriba un mensaje entero
            para recién ahí enterarse — y `listingMessageOutcome` traduce ese
            código al error genérico, así que ni siquiera se enteraría de POR
            QUÉ. La ficha lo aclara acá, gratis y a cero toques, que es más de
            lo que daba la página de detalle (donde hay que tocar "Contactar"
            para que lo explique una hoja).
          */}
          {externalNote && (
            <p className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-4 text-sm leading-relaxed text-foreground-secondary">
              <Info
                size={20}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-foreground-muted"
              />
              {externalNote}
            </p>
          )}

          <div
            role="note"
            aria-label="Aviso de seguridad"
            className="flex items-start gap-3 rounded-lg bg-warning-bg p-4"
          >
            <ShieldWarning
              size={22}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-warning"
            />
            <p className="text-sm text-foreground">{COPY.listing.sheetSafety}</p>
          </div>

          {/*
            LA ÚNICA SALIDA, Y ES DELIBERADA.

            Acá vivía "Ver el directorio de negocios", que sacaba a `/negocios`:
            una salida DENTRO de la hoja que existe para evitar salidas, y encima
            hacia la lista de TODOS los negocios — o sea, ni siquiera hacia el
            aviso que se estaba mirando. Se fue por las dos razones. La que la
            reemplaza es la misma para los seis verticales, dice a dónde lleva y
            está último, después de haber podido decidir sin usarla: quien
            necesita la página entera (galería, horarios, reseñas, el menú de
            administración) la tiene a un toque; quien no, ya se fue con lo que
            vino a buscar.
          */}
          {detailHref && (
            <Link
              href={detailHref}
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
            >
              {SHEET_COPY.openFull}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}

          <Button variant="secondary" className="w-full" onClick={closeSheet}>
            {COPY.listing.sheetClose}
          </Button>
        </div>

        {/*
          EL PIE: lo único que la persona vino a hacer.

          Hairline arriba y nada más —ni caja, ni sombra, ni fondo propio—: es
          la misma superficie de la hoja, así que se lee como el final del
          panel y no como un segundo panel encima. La separación la hace el
          borde y el aire, que es como se separan las cosas en esta app.

          El padding lateral es el mismo `px-6` del cuerpo para que el botón
          quede alineado con el texto de arriba; abajo no lleva ninguno porque
          el panel ya reserva el safe-area del teléfono.
        */}
        {sheetAction && (
          <div className="shrink-0 border-t border-border-subtle px-6 pt-3">
            {sheetAction}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
