"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  CaretDown,
  Calendar,
  CheckCircle,
  Eye,
  Globe,
  House,
  ImageSquare,
  Key,
  MapPin,
  Megaphone,
  PencilSimple,
  RocketLaunch,
  Storefront,
  Tag,
  Ticket,
  Wrench,
  X,
} from "@phosphor-icons/react/dist/ssr";
import {
  BezelCard,
  Button,
  Field,
  Input,
  ProgressDots,
  Select,
  Textarea,
  buttonVariants,
  useToast,
} from "@/components/ui";
import { cn, DEFAULT_CURRENCY } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Celebration, useCelebration } from "@/components/motion";
import { COPY, formatListingPrice } from "@/components/listings";
import { MONETIZATION_COPY, FREE_MAX_PHOTOS } from "@/lib/monetization";
import { listingViewHref } from "@/lib/monetization/href";
import {
  EMPTY_DECLARATION_VALUE,
  OriginalityFields,
  type DeclarationValue,
} from "@/components/integrity/originality-fields";
import {
  DEFAULT_PUBLISHABLE_OPERATION,
  PROPERTY_TYPE_OPTIONS,
  PUBLISHABLE_PROPERTY_OPERATION_OPTIONS,
  normalizePropertyOperation,
  normalizePropertyType,
  propertyOperationLabel,
  propertyTypeLabel,
  type PropertyOperation,
} from "@/lib/propiedades/tipos";
import {
  FURNISHED_OPTIONS,
  MAX_DEPOSIT,
  MAX_EXTRA_FEES_LENGTH,
  RENTAL_REQUIREMENTS,
  RENTAL_UTILITIES,
  type FurnishedState,
} from "@/lib/propiedades/alquiler";
import { ADVERTISER_ROLE_OPTIONS, type AdvertiserRole } from "@/lib/propiedades/anunciante";
import { EVENT_AUDIENCES, EVENT_CATEGORIES } from "@/lib/eventos/categorias";
import {
  EVENT_MODE_OPTIONS,
  MAX_EVENT_CAPACITY,
  requiresVenue,
  type EventMode,
} from "@/lib/eventos/detalles";
import { createListingDraft, finalizeListing } from "./actions";

const C = COPY.publish;
const M = MONETIZATION_COPY;

// Campos específicos de professional/event (módulo DIRECTORIOS) — copy local
// para no tocar el COPY de vivienda.
const DIR_COPY = {
  professional: {
    categoryLabel: "Rubro",
    categoryError: "Elegí un rubro para tu perfil.",
    credentialsLabel: "Credenciales",
    credentialsPlaceholder: "Ej.: Matrícula NY #12345, CPA",
    credentialsHelp:
      "Separalas con comas. Si sos abogado o notario, después podés verificar tu matrícula en el centro de seguridad.",
  },
  /**
   * Quién publica (directorio "Agentes y propietarios"). Distinto de las
   * condiciones del alquiler de más abajo: no es algo que quien busca vivienda
   * necesite para decidir, es lo que alimenta ese directorio — por eso va
   * visible y no plegado adentro de "Condiciones del alquiler", pero con el
   * mismo criterio "opcional" que todo lo demás acá: publicar rápido sigue
   * siendo posible sin elegir nada.
   */
  advertiser: {
    label: "Publicás como",
    help: "Así te encuentran en el directorio de Agentes y propietarios.",
    placeholder: "Preferís no decirlo",
  },
  /**
   * Condiciones del alquiler. Todo lo de acá es OPCIONAL y vive plegado: son
   * las preguntas que hoy llegan por chat, no requisitos para poder publicar.
   * Obligarlas dejaría afuera al que sólo quiere publicar rápido, que es la
   * mitad del vertical.
   */
  rental: {
    onlyRentTitle: "Publicás un alquiler",
    onlyRentBody:
      "Por ahora en Comunidad Latina se publican solo alquileres: departamentos, cuartos y viviendas compartidas.",
    depositLabel: "Depósito",
    depositPlaceholder: "Ej.: 1500",
    depositHelp: "Poné 0 si no pedís depósito.",
    moreTitle: "Condiciones del alquiler",
    moreHint: "Opcional — evita que te pregunten lo mismo diez veces",
    furnishedLegend: "¿Viene amueblado?",
    availableLabel: "Disponible desde",
    extraFeesLabel: "Cargos aparte del alquiler",
    extraFeesPlaceholder: "Ej.: agua $30 y basura $15 por mes",
    extraFeesHelp: "Lo que se paga además del alquiler, si hay algo.",
    utilitiesLegend: "Servicios incluidos",
    utilitiesHelp: "Marcá lo que ya está dentro del alquiler.",
    requirementsLegend: "Qué pedís para alquilar",
    requirementsHelp: "Así quien busca sabe de entrada si califica.",
  },
  event: {
    dateLabel: "Fecha y hora del evento",
    dateError: "Decinos cuándo es el evento.",
    endsLabel: "Hasta (fin del evento)",
    endsHelp: "Si no sabés a qué hora termina, dejalo vacío.",
    endsError: "La hora de cierre tiene que ser posterior a la de inicio.",
    categoryLabel: "Categoría",
    categoryPlaceholder: "Elegí una categoría…",
    categoryError: "Elegí una categoría para el evento.",
    ticketLegend: "Entrada",
    ticketFree: "Gratis",
    ticketFreeHint: "Se entra sin pagar",
    ticketPaid: "Con entrada paga",
    ticketPaidHint: "Se cobra para entrar",
    ticketError: "Decinos si el evento es gratis o se cobra entrada.",
    ticketsUrlLabel: "Enlace de entradas o inscripción",
    ticketsUrlPlaceholder: "https://…",
    ticketsUrlHelp: "Dónde se sacan las entradas o se anota la gente.",
    ticketsUrlError: "Ese enlace no se entiende. Copialo completo, con https:// adelante.",
    modeLegend: "¿Dónde es?",
    modeError: "Decinos si el evento es en un lugar o en línea.",
    onlineUrlLabel: "Enlace del evento",
    onlineUrlPlaceholder: "https://…",
    onlineUrlHelp: "Por dónde se entra: Zoom, Meet, un vivo de Instagram…",
    onlineUrlError: "Pegá el enlace por donde se entra (tiene que empezar con https://).",
    moreTitle: "Más datos del evento",
    moreHint: "Opcional",
    /**
     * Lo que se guarda en `area_label` cuando el evento es en línea. La columna
     * es obligatoria (mínimo 3 caracteres) y no se puede dejar vacía, así que
     * en vez de inventar una zona falsa se escribe la modalidad, que es cierta
     * y es lo que la tarjeta va a mostrar donde iría el barrio.
     */
    virtualAreaLabel: "En línea",
    capacityLabel: "Cuánta gente entra",
    capacityPlaceholder: "Ej.: 80",
    capacityHelp: "Dejalo vacío si no hay cupo.",
    audienceLabel: "Para quién es",
    audiencePlaceholder: "Sin preferencia",
  },
  // Preselect por query param (menú crear-post del feed, ?kind=): link discreto
  // para volver al selector sin perder el resto del wizard. Copy local — no
  // toca COPY.publish (vivienda).
  changeType: "Cambiar tipo",
} as const;

const PROFESSIONAL_CATEGORY_OPTIONS = [
  { value: "abogado", label: "Abogado" },
  { value: "contador", label: "Contador" },
  { value: "notario", label: "Notario" },
  { value: "salud", label: "Salud" },
  { value: "educacion", label: "Educación" },
  { value: "otro", label: "Otro" },
] as const;

type ProfessionalCategory = (typeof PROFESSIONAL_CATEGORY_OPTIONS)[number]["value"];

function isProfessionalCategory(value: string): value is ProfessionalCategory {
  return PROFESSIONAL_CATEGORY_OPTIONS.some((option) => option.value === value);
}

export type Kind = "property" | "business" | "professional" | "event" | "job";

const KIND_OPTIONS: Array<{ value: Kind; label: string; Icon: typeof House }> = [
  { value: "property", label: "Vivienda", Icon: House },
  { value: "business", label: "Negocio", Icon: Storefront },
  { value: "professional", label: "Profesional", Icon: Briefcase },
  { value: "event", label: "Evento", Icon: Calendar },
  { value: "job", label: "Trabajo", Icon: Wrench },
];

/**
 * Un aviso NACE gratuito — la policy `listings_insert` (0048) lo exige, y el
 * tier lo mueve el pago, no el formulario. Así que el tope de este wizard es
 * SIEMPRE el de gratis, y sale del módulo de monetización en vez de ser un 6
 * suelto que nadie sabe de dónde salió.
 *
 * El servidor vuelve a contar en `finalizeListing`: acá el número es UX (avisar
 * antes de que alguien elija 12 fotos), allá es el tope de verdad.
 */
const MAX_PHOTOS = FREE_MAX_PHOTOS;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** 0 tipo · 1 texto · 2 precio · 3 zona · 4 fotos · 5 vista previa. */
const STEP_PREVIEW = 5;
const TOTAL_STEPS = 6;

interface PhotoItem {
  file: File;
  previewUrl: string;
}

/** Redimensiona a ≤1600px y convierte a webp; si algo falla, sube el original. */
async function preparePhoto(file: File): Promise<{ blob: Blob; ext: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("sin canvas");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82),
    );
    if (blob) return { blob, ext: "webp" };
  } catch {
    // Caemos al original.
  }
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  return { blob: file, ext: ["webp", "jpg", "jpeg", "png"].includes(ext) ? ext : "jpg" };
}

// ---------------------------------------------------------------------------
// Controles compartidos del wizard
//
// Viven ACÁ y no en components/ui a propósito: son la resolución de un problema
// de ESTE formulario (no agrandarlo a quince campos) y no un patrón que el
// resto de la app haya pedido. Cada ruta de publicación del repo es
// autocontenida por la misma razón (ver `preparePhoto`, duplicado a propósito
// en cada wizard). Cuando una tercera pantalla los necesite, ahí sí suben.
// ---------------------------------------------------------------------------

/**
 * Bloque plegable de campos opcionales.
 *
 * Es un `<details>` NATIVO y no un acordeón a mano: el navegador ya le da el
 * toggle con teclado, el estado expandido al lector de pantalla y —lo que más
 * importa acá— el buscador del navegador puede abrirlo para encontrar texto
 * adentro. Un `useState` con `hidden` no hace nada de eso y hay que escribirlo.
 *
 * POR QUÉ PLEGADO Y NO EN UN PASO NUEVO: un paso más es un paso más que
 * atravesar aunque no interese; un bloque plegado ocupa una fila y se abre solo
 * si a la persona le sirve. La regla que sigue el wizard es: obligatorio a la
 * vista, opcional a un toque.
 */
function OptionalSection({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-border-subtle bg-surface-subtle">
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 py-3",
          "rounded-lg transition-colors duration-(--duration-fast)",
          "hover:bg-surface focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span aria-hidden="true" className="shrink-0 text-brand [&>svg]:size-[18px]">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-xs leading-snug text-foreground-muted">{hint}</span>
        </span>
        <CaretDown
          size={16}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-foreground-muted",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
            "group-open:rotate-180",
          )}
        />
      </summary>
      <div className="flex flex-col gap-4 border-t border-border-subtle px-4 pb-4 pt-4">
        {children}
      </div>
    </details>
  );
}

interface CardChoice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Grupo de opciones excluyentes con forma de tarjeta.
 *
 * Por debajo son radios NATIVOS dentro de un `<fieldset>` — el mismo criterio
 * que ya usaba el selector de operación de vivienda: se ven como tarjetas, pero
 * las flechas del teclado recorren las opciones, el lector anuncia "1 de 2" y
 * el grupo tiene nombre real, sin reimplementar nada de eso con `aria-checked`.
 */
function ChoiceCards<T extends string>({
  name,
  legend,
  help,
  options,
  value,
  onChange,
  iconFor,
  columns = 2,
}: {
  name: string;
  legend: string;
  help?: string;
  options: readonly CardChoice<T>[];
  value: T | "";
  onChange: (value: T) => void;
  iconFor?: (value: T) => React.ReactNode;
  columns?: 2 | 3;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-semibold text-foreground">{legend}</legend>
      <div className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {options.map((option) => {
          const selected = value === option.value;
          const icon = iconFor?.(option.value);
          return (
            <div key={option.value} className="relative">
              <input
                type="radio"
                id={`${name}-${option.value}`}
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <label
                htmlFor={`${name}-${option.value}`}
                className={cn(
                  "flex h-full min-h-16 cursor-pointer flex-col justify-center gap-0.5 rounded-lg border p-3",
                  "transition-[border-color,background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                  "active:scale-[0.98] peer-focus-visible:ring-[3px] peer-focus-visible:ring-focus-ring",
                  selected
                    ? "border-brand bg-brand-tint text-brand-ink"
                    : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {icon}
                  {option.label}
                </span>
                {option.hint && (
                  <span className="text-xs leading-snug text-foreground-muted">{option.hint}</span>
                )}
              </label>
            </div>
          );
        })}
      </div>
      {help && <p className="text-sm text-foreground-muted">{help}</p>}
    </fieldset>
  );
}

/**
 * Selección múltiple con chips.
 *
 * Chips y no una lista de casillas: siete servicios en casillas apiladas son
 * siete filas de scroll; en chips entran en tres renglones y se marcan con el
 * pulgar. Cada chip es un `aria-pressed` real, así que el lector de pantalla
 * anuncia el estado sin que haga falta describirlo con texto.
 *
 * `min-h-11` en cada chip: 44px es el mínimo táctil y no se negocia por
 * estética, ni siquiera en un control secundario.
 */
function ToggleChips<T extends string>({
  legend,
  help,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  help?: string;
  options: readonly { value: T; label: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-semibold text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(option.value)}
              className={cn(
                "min-h-11 rounded-full border px-3.5 text-sm font-semibold",
                "transition-[border-color,background-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                "active:scale-[0.96] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                active
                  ? "border-brand bg-brand-tint text-brand-ink"
                  : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {help && <p className="text-sm text-foreground-muted">{help}</p>}
    </fieldset>
  );
}

/** Alterna un valor dentro de una lista, sin mutar. */
function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export interface PublishFormProps {
  tenantId: string;
  /**
   * Los verticales que ESTE tenant tiene prendidos, ya resueltos por el
   * servidor (`page.tsx`, vía `moduleAvailability`). Sin la lista, el wizard
   * ofrece los cinco.
   *
   * El menú "+" ya filtra sus tiles por módulo, pero esta pantalla —el destino
   * de esos tiles, y una URL que se puede escribir a mano o llegar por un link
   * viejo— los ofrecía TODOS. O sea que una comunidad con Eventos apagado no
   * veía el tile de Evento y sin embargo podía publicar uno: el aviso nacía en
   * un módulo que después no lo muestra en ningún lado. La promesa y la entrega
   * tienen que salir de la misma fuente.
   */
  allowedKinds?: readonly Kind[];
  /**
   * Preselect por query param (?kind=, menú crear-post del feed — page.tsx ya
   * lo validó). Con un kind fijado, el wizard arranca en el paso 1 (el
   * selector del paso 0 queda salteado); "Cambiar tipo" vuelve a mostrarlo.
   * Sin param (uso de siempre desde /publicar a mano), todo igual que antes.
   */
  initialKind?: Kind | null;
}

export function PublishForm({
  tenantId,
  initialKind = null,
  allowedKinds,
}: PublishFormProps) {
  // Orden del catálogo, no el que venga en la prop: el selector se lee siempre
  // igual. Nunca queda vacío — con los cinco módulos apagados este componente
  // ni se monta (page.tsx corta con un estado vacío antes), así que la lista
  // completa es la degradación correcta para el resto de los casos raros.
  const kindOptions = (() => {
    if (!allowedKinds || allowedKinds.length === 0) return KIND_OPTIONS;
    const filtered = KIND_OPTIONS.filter((option) => allowedKinds.includes(option.value));
    return filtered.length > 0 ? filtered : KIND_OPTIONS;
  })();

  const { toast } = useToast();
  const { celebrating, celebrate } = useCelebration();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(initialKind ? 1 : 0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{
    status: "published" | "pending_review";
    kind: Kind;
    listingId: string;
  } | null>(null);

  const [kind, setKind] = useState<Kind | null>(initialKind);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [period, setPeriod] = useState("month");
  /**
   * Vivienda. Ya NO arranca vacío: con una sola operación publicable, dejarlo
   * sin valor obligaría a pedir que la persona "elija" entre una cosa, y eso no
   * es una elección, es un trámite. Se asume y se DICE en una línea arriba del
   * paso, que es más honesto que un grupo de radios de una sola opción.
   *
   * El día que vuelva a haber dos, `PUBLISHABLE_PROPERTY_OPERATION_OPTIONS`
   * tendrá dos elementos, el grupo de opciones reaparece solo (ver el paso 2) y
   * esta línea es lo único que habría que volver a poner en "".
   */
  const [operation, setOperation] = useState<PropertyOperation | "">(
    DEFAULT_PUBLISHABLE_OPERATION,
  );
  const [propertyType, setPropertyType] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [sqft, setSqft] = useState("");
  // Condiciones del alquiler — todas opcionales, todas plegadas.
  const [deposit, setDeposit] = useState("");
  const [extraFees, setExtraFees] = useState("");
  const [utilities, setUtilities] = useState<string[]>([]);
  const [requirements, setRequirements] = useState<string[]>([]);
  const [furnished, setFurnished] = useState<FurnishedState | "">("");
  const [availableFrom, setAvailableFrom] = useState("");
  // Quién publica (directorio "Agentes y propietarios") — opcional, ver DIR_COPY.advertiser.
  const [advertiserRole, setAdvertiserRole] = useState<AdvertiserRole | "">("");
  const [areaLabel, setAreaLabel] = useState("");
  const [exactAddress, setExactAddress] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  // Declaración de originalidad y licencia (pliego / Content Integrity).
  const [declaration, setDeclaration] = useState<DeclarationValue>(EMPTY_DECLARATION_VALUE);
  // Campos específicos de professional/event
  const [category, setCategory] = useState("");
  const [credentials, setCredentials] = useState("");
  const [eventStartsAt, setEventStartsAt] = useState("");
  const [eventEndsAt, setEventEndsAt] = useState("");
  const [eventCategory, setEventCategory] = useState("");
  const [eventMode, setEventMode] = useState<EventMode | "">("");
  const [eventOnlineUrl, setEventOnlineUrl] = useState("");
  const [eventTicketsUrl, setEventTicketsUrl] = useState("");
  /**
   * Gratis / pago como TERCER estado ("" = todavía no eligió). La spec pide que
   * la elección sea explícita, y un booleano con default pondría en boca de
   * quien organiza una respuesta que no dio: preseleccionar "gratis" publicaría
   * eventos gratis por descuido, y preseleccionar "pago" es peor.
   */
  const [eventTicket, setEventTicket] = useState<"gratis" | "pago" | "">("");
  const [eventCapacity, setEventCapacity] = useState("");
  const [eventAudience, setEventAudience] = useState("");

  // El borrador se crea una sola vez — reintentos no duplican avisos.
  const [draftId, setDraftId] = useState<string | null>(null);

  const isProperty = kind === "property";
  const isEvent = kind === "event";
  /**
   * Una VENTA no tiene frecuencia: el precio es uno solo. Hoy la venta no se
   * puede publicar, así que `isSale` es siempre falso — la lógica se conserva
   * igual porque el estado `operation` sigue existiendo y porque el día que la
   * venta vuelva, la contradicción precio/operación vuelve con ella.
   */
  const isSale = isProperty && operation === "venta";
  /**
   * ¿Hay más de una operación publicable? Con una sola, el paso 2 no dibuja el
   * grupo de opciones y muestra la línea explicativa. La condición se lee del
   * catálogo y no de un booleano a mano para que la UI no pueda desincronizarse
   * de la política que aplica el servidor.
   */
  const showOperationChoice = PUBLISHABLE_PROPERTY_OPERATION_OPTIONS.length > 1;
  // La frecuencia (por mes/semana/día) es lenguaje de alquileres y sueldos.
  // Para negocio/profesional/evento se oculta y el precio queda como único —
  // el cliente eligió "Negocio" y le apareció "Por mes" como si fuera una
  // propiedad (feedback 2026-07-21).
  const hasPriceFrequency = (isProperty && !isSale) || kind === "job";
  /**
   * Un evento GRATIS no muestra el campo de precio. No se trata de esconder un
   * control: es que el precio de un evento gratis no existe, y dejarlo ahí
   * invita a escribir un número que después contradice el chip "Gratis".
   */
  const isFreeEvent = isEvent && eventTicket === "gratis";
  const isOnlineEvent = isEvent && eventMode === "virtual";
  /**
   * La zona (paso 3) deja de tener sentido en un evento EN LÍNEA: no hay lugar
   * al que ir. En vez de pedirla igual —y que alguien escriba "Zoom" en un
   * campo de ubicación— el paso muestra el enlace de acceso, que es el "dónde"
   * de verdad de ese evento.
   */
  const zoneStepIsVirtual = isOnlineEvent;

  /**
   * La frecuencia que se va a guardar. Una sola fuente para el borrador y para
   * la vista previa: si se calculaban por separado, la vista previa podía decir
   * una cosa y el aviso publicado otra.
   */
  const savedPeriod: "month" | "week" | "day" | "one_time" = hasPriceFrequency
    ? (period as "month" | "week" | "day" | "one_time")
    : "one_time";

  /**
   * Se arma con el MISMO helper que pinta la tarjeta ya publicada
   * (`formatListingPrice`), no a mano. Cuando se armaba acá con
   * `"$" + toLocaleString` pasaban dos cosas: un precio con un decimal salía
   * "$950.9" en vez de "$950.90", y el sufijo estaba clavado en "/mes", así que
   * quien alquilaba "por semana" o "por día" veía sólo "$200" — el número suelto
   * se lee como el total, no como lo que se paga por semana.
   */
  const priceAmount = price ? Number(price) : Number.NaN;
  const pricePreview =
    !isFreeEvent && Number.isFinite(priceAmount)
      ? formatListingPrice(priceAmount, DEFAULT_CURRENCY, savedPeriod)
      : null;

  /**
   * ¿El enlace se entiende como una dirección de internet?
   *
   * Chequeo LAXO y deliberadamente distinto del del servidor: acá sólo evita
   * que se avance con algo que claramente no es un enlace. La validación real
   * —origen resuelto, protocolo, no-interno— la hace `normalizeEventUrl` en la
   * server action, que es donde no se puede saltear. Duplicar ahí la regla
   * completa arrastraría `safeExternalHref` al bundle del cliente sin agregar
   * ninguna garantía.
   */
  function looksLikeUrl(value: string): boolean {
    return /^https?:\/\/\S+\.\S+/i.test(value.trim());
  }

  function validateStep(current: number): string | null {
    if (current === 0 && !kind) return C.errors.kindRequired;
    if (current === 1) {
      if (title.trim().length < 8) return C.errors.titleShort;
      if (description.trim().length < 30) return C.errors.descriptionShort;
    }
    if (current === 2 && isProperty) {
      // El orden de los chequeos sigue al orden visual del paso: el primer
      // error que se muestra es siempre el del campo que está más arriba.
      if (!operation) return C.errors.operationRequired;
      if (!propertyType) return C.errors.typeRequired;
      const amount = Number(price);
      if (!Number.isFinite(amount) || amount <= 0) return C.errors.priceRequired;
    }
    if (current === 2 && kind === "professional" && !category) {
      return DIR_COPY.professional.categoryError;
    }
    if (current === 2 && isEvent) {
      // Mismo criterio que vivienda: el orden de los chequeos sigue al orden
      // visual, así el primer error señalado es el del campo de más arriba.
      if (!eventCategory) return DIR_COPY.event.categoryError;
      if (!eventStartsAt) return DIR_COPY.event.dateError;
      if (eventEndsAt && new Date(eventEndsAt).getTime() <= new Date(eventStartsAt).getTime()) {
        return DIR_COPY.event.endsError;
      }
      if (!eventTicket) return DIR_COPY.event.ticketError;
      if (eventTicketsUrl.trim() && !looksLikeUrl(eventTicketsUrl)) {
        return DIR_COPY.event.ticketsUrlError;
      }
      if (!eventMode) return DIR_COPY.event.modeError;
    }
    if (current === 3) {
      if (zoneStepIsVirtual) {
        if (!looksLikeUrl(eventOnlineUrl)) return DIR_COPY.event.onlineUrlError;
        // Un evento en línea NO necesita zona: el "dónde" es el enlace.
        return null;
      }
      if (areaLabel.trim().length < 3) return C.errors.zoneShort;
    }
    return null;
  }

  function goNext() {
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((value) => Math.min(TOTAL_STEPS - 1, value + 1));
  }

  function goBack() {
    setError(null);
    setStep((value) => Math.max(0, value - 1));
  }

  /** "Cambiar tipo" (solo visible si arrancamos con un kind preseleccionado). */
  function changeType() {
    setError(null);
    setStep(0);
  }

  function addPhotos(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    setPhotos((current) => {
      const next = [...current];
      for (const file of incoming) {
        if (next.length >= MAX_PHOTOS) {
          // Copy del módulo de monetización: dice el número real Y qué se gana
          // con premium, en vez del "hasta 6 fotos" hardcodeado de antes.
          toast({ title: M.tier.photoLimitReached(MAX_PHOTOS), variant: "warning" });
          break;
        }
        if (file.size > MAX_PHOTO_BYTES) {
          toast({ title: C.steps.photos.tooBig, variant: "warning" });
          continue;
        }
        next.push({ file, previewUrl: URL.createObjectURL(file) });
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  }

  function resetForm() {
    photos.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setStep(0);
    setError(null);
    setDone(null);
    setKind(null);
    setTitle("");
    setDescription("");
    setPrice("");
    setPeriod("month");
    setOperation(DEFAULT_PUBLISHABLE_OPERATION);
    setPropertyType("");
    setBedrooms("");
    setBathrooms("");
    setSqft("");
    setDeposit("");
    setExtraFees("");
    setUtilities([]);
    setRequirements([]);
    setFurnished("");
    setAvailableFrom("");
    setAreaLabel("");
    setExactAddress("");
    setPhotos([]);
    setCategory("");
    setCredentials("");
    setEventStartsAt("");
    setEventEndsAt("");
    setEventCategory("");
    setEventMode("");
    setEventOnlineUrl("");
    setEventTicketsUrl("");
    setEventTicket("");
    setEventCapacity("");
    setEventAudience("");
    setDraftId(null);
  }

  async function handleSubmit() {
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // 1) Borrador (idempotente dentro de la sesión del formulario)
      let listingId = draftId;
      if (!listingId) {
        const result = await createListingDraft({
          kind: kind as Kind,
          title: title.trim(),
          description: description.trim(),
          priceAmount: price ? Number(price) : null,
          pricePeriod: price
            ? hasPriceFrequency
              ? (period as "month" | "week" | "day" | "one_time")
              : "one_time"
            : null,
          // Los normalizadores devuelven el valor tipado o null: el estado del
          // form es `string`, así que ésta es la única frontera donde puede
          // colarse algo que no está en el catálogo.
          propertyType: isProperty ? normalizePropertyType(propertyType) : null,
          operation: isProperty ? normalizePropertyOperation(operation) : null,
          bedrooms: isProperty && bedrooms ? Number(bedrooms) : null,
          bathrooms: isProperty && bathrooms ? Number(bathrooms) : null,
          sqft: isProperty && sqft ? Number(sqft) : null,
          // El depósito se compara contra "" y no con un truthy: `"0"` es
          // truthy pero `Number("0")` es 0, y 0 es el valor que MÁS importa
          // conservar acá ("no pido depósito"). Un `deposit ? … : null` lo
          // hubiera mandado como null y la afirmación se perdería.
          deposit: isProperty && deposit !== "" ? Number(deposit) : null,
          extraFees: isProperty ? extraFees.trim() || null : null,
          utilities: isProperty ? utilities : null,
          requirements: isProperty ? requirements : null,
          furnished: isProperty && furnished ? furnished : null,
          availableFrom: isProperty && availableFrom ? availableFrom : null,
          advertiserRole: isProperty && advertiserRole ? advertiserRole : null,
          // Evento en línea: no hay zona que declarar, así que se manda la
          // etiqueta de modalidad. `areaLabel` es NOT NULL con mínimo 3 en el
          // esquema y en la base, y un evento sin ella no podría publicarse.
          areaLabel: zoneStepIsVirtual
            ? DIR_COPY.event.virtualAreaLabel
            : areaLabel.trim(),
          exactAddress: zoneStepIsVirtual ? null : exactAddress.trim() || null,
          category:
            kind === "professional" && isProfessionalCategory(category) ? category : null,
          credentials: kind === "professional" ? credentials.trim() || null : null,
          eventStartsAt: isEvent && eventStartsAt ? eventStartsAt : null,
          eventEndsAt: isEvent && eventEndsAt ? eventEndsAt : null,
          eventCategory: isEvent ? eventCategory || null : null,
          eventMode: isEvent && eventMode ? eventMode : null,
          eventOnlineUrl: isOnlineEvent ? eventOnlineUrl.trim() || null : null,
          eventTicketsUrl: isEvent ? eventTicketsUrl.trim() || null : null,
          // `null` mientras no eligió (el paso 2 no deja avanzar sin elegir, así
          // que sólo pasa si el kind no es evento).
          eventFree: isEvent && eventTicket ? eventTicket === "gratis" : null,
          eventCapacity: isEvent && eventCapacity ? Number(eventCapacity) : null,
          eventAudience: isEvent ? eventAudience || null : null,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        listingId = result.listingId;
        setDraftId(result.listingId);
      }

      // 2) Fotos → bucket listing-photos, path {tenant_id}/{listing_id}/{uuid}.{ext}
      const supabase = createClient();
      const photoPaths: string[] = [];
      for (const item of photos) {
        const { blob, ext } = await preparePhoto(item.file);
        const path = `${tenantId}/${listingId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("listing-photos")
          .upload(path, blob, {
            contentType: blob.type || item.file.type || "image/webp",
            upsert: false,
          });
        if (uploadError) {
          setError(C.errors.uploadFailed);
          return;
        }
        photoPaths.push(path);
      }

      // 3) Cierre: estado final según moderación/degradación elegante
      const finalized = await finalizeListing({ listingId, photoPaths, declaration });
      if (!finalized.ok) {
        setError(finalized.error);
        return;
      }
      setDone({
        status: finalized.status,
        kind: (finalized.kind as Kind) ?? (kind as Kind),
        listingId,
      });
      // Celebración sutil solo cuando el aviso quedó publicado de verdad (no en
      // "queda en revisión", que es un estado de espera, no un logro cerrado).
      if (finalized.status === "published") celebrate();
    } catch {
      setError(C.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  // -------------------------------------------------------------------------
  // Pantalla de éxito
  // -------------------------------------------------------------------------
  if (done) {
    const published = done.status === "published";
    const viewHref = listingViewHref(done.kind, done.listingId);
    return (
      <>
        {published && (
          <Celebration active={celebrating} message={C.success.publishedTitle} />
        )}
        <div className="flex flex-col gap-4">
          <BezelCard
            variant={published ? "success" : "default"}
            coreClassName="flex flex-col items-center gap-3 px-6 py-9 text-center"
          >
            <CheckCircle
              size={56}
              weight="fill"
              aria-hidden="true"
              className={published ? "text-success" : "text-brand"}
            />
            <h2 className="font-display text-xl font-bold text-foreground">
              {published ? C.success.publishedTitle : C.success.reviewTitle}
            </h2>
            <p className="max-w-[40ch] text-sm text-foreground-secondary">
              {published ? C.success.publishedBody : C.success.reviewBody}
            </p>
            <Link
              href={viewHref}
              className={cn(
                buttonVariants({ variant: "primary", size: "md" }),
                "mt-2 w-full",
              )}
            >
              <Eye size={18} aria-hidden="true" />
              {M.success.viewCta}
            </Link>
          </BezelCard>

          {/* Pedido literal de la call (1:00:07): "cuando dice publicar aviso,
              debería haber un botón acá y otro acá… crear campaña o impulsar
              este anuncio". Aplica a los 5 verticales del wizard.

              Sólo si el aviso YA está publicado: las dos rutas exigen
              status='published' (la RLS de campaigns_insert y el gate de
              /impulsar), así que ofrecerlas en revisión sería mandar a alguien
              a una pantalla que le dice que no. Cuando está en revisión se lo
              decimos con una línea, que es más honesto que un botón muerto. */}
          {published ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <PromoteCard
                href={`/impulsar/${done.listingId}`}
                icon={<RocketLaunch size={20} weight="fill" aria-hidden="true" />}
                title={M.success.boostCta}
                hint={M.success.boostHint}
              />
              <PromoteCard
                href={`/impulsar/${done.listingId}?modo=campana`}
                icon={<Megaphone size={20} weight="fill" aria-hidden="true" />}
                title={M.success.campaignCta}
                hint={M.success.campaignHint}
              />
            </div>
          ) : (
            <p className="text-center text-xs leading-relaxed text-foreground-muted">
              {M.success.laterNote}
            </p>
          )}

          <Button variant="ghost" className="w-full" onClick={resetForm}>
            {C.success.publishAnother}
          </Button>
        </div>
      </>
    );
  }

  // -------------------------------------------------------------------------
  // Formulario multi-paso
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2">
        <ProgressDots total={TOTAL_STEPS} current={step + 1} />
        <p className="text-xs text-foreground-muted">{C.stepLabel(step + 1, TOTAL_STEPS)}</p>
      </div>

      {step === 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-display text-xl font-bold text-foreground">
            {C.steps.kind.title}
          </legend>
          <p className="-mt-1 text-sm text-foreground-secondary">{C.steps.kind.help}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {kindOptions.map(({ value, label, Icon }) => {
              const selected = kind === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setKind(value)}
                  className={cn(
                    "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border p-3",
                    "transition-[border-color,background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                    "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    selected
                      ? "border-brand bg-brand-tint text-brand-ink"
                      : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
                  )}
                >
                  <Icon size={26} weight={selected ? "fill" : "regular"} aria-hidden="true" />
                  <span className="text-sm font-semibold">{label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl font-bold text-foreground">
              {C.steps.text.title(kind)}
            </h2>
            {/* Solo con preselect (?kind= del menú crear-post): el paso 0 quedó
                salteado, así que ofrecemos volver a él sin usar "Atrás". */}
            {initialKind && (
              <button
                type="button"
                onClick={changeType}
                className={cn(
                  "shrink-0 text-xs font-semibold text-foreground-muted underline-offset-2",
                  "transition-colors duration-(--duration-fast) hover:text-brand-ink hover:underline",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                {DIR_COPY.changeType}
              </button>
            )}
          </div>
          <Field htmlFor="pub-title" label={C.steps.text.titleLabel} help={C.steps.text.titleHelp}>
            <Input
              id="pub-title"
              value={title}
              maxLength={120}
              placeholder={C.steps.text.titlePlaceholder(kind)}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field
            htmlFor="pub-description"
            label={C.steps.text.descriptionLabel}
            help={C.steps.text.descriptionHelp}
          >
            <Textarea
              id="pub-description"
              rows={6}
              value={description}
              maxLength={4000}
              placeholder={C.steps.text.descriptionPlaceholder(kind)}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">{C.steps.price.title}</h2>

          {isProperty && (
            <>
              {/* OPERACIÓN. Con una sola publicable no se dibuja un grupo de
                  opciones: elegir entre una cosa no es elegir, es un trámite con
                  forma de pregunta. Se dice en una línea y se sigue. El grupo
                  vuelve solo el día que el catálogo tenga dos otra vez —
                  ver PUBLISHABLE_PROPERTY_OPERATION_OPTIONS. */}
              {showOperationChoice ? (
                <ChoiceCards
                  name="pub-operation"
                  legend={C.steps.price.operationLabel}
                  help={C.steps.price.operationHelp}
                  options={PUBLISHABLE_PROPERTY_OPERATION_OPTIONS}
                  value={operation}
                  onChange={setOperation}
                  iconFor={(value) => {
                    const OptionIcon = value === "venta" ? Tag : Key;
                    return (
                      <OptionIcon
                        size={18}
                        weight={operation === value ? "fill" : "regular"}
                        aria-hidden="true"
                      />
                    );
                  }}
                />
              ) : (
                <div className="flex items-start gap-2.5 rounded-lg bg-brand-tint px-4 py-3">
                  <Key
                    size={18}
                    weight="fill"
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-brand"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand-ink">
                      {DIR_COPY.rental.onlyRentTitle}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-foreground-secondary">
                      {DIR_COPY.rental.onlyRentBody}
                    </p>
                  </div>
                </div>
              )}

              <Field
                htmlFor="pub-property-type"
                label={C.steps.price.typeLabel}
                help={C.steps.price.typeHelp}
              >
                <Select
                  id="pub-property-type"
                  value={propertyType}
                  onChange={(event) => setPropertyType(event.target.value)}
                >
                  <option value="" disabled>
                    {C.steps.price.typePlaceholder}
                  </option>
                  {PROPERTY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>

              {/* Quién publica (directorio "Agentes y propietarios", requisito
                  del cliente) — opcional, ver DIR_COPY.advertiser. */}
              <Field
                htmlFor="pub-advertiser-role"
                label={DIR_COPY.advertiser.label}
                help={DIR_COPY.advertiser.help}
                optional
              >
                <Select
                  id="pub-advertiser-role"
                  value={advertiserRole}
                  onChange={(event) =>
                    setAdvertiserRole(event.target.value as AdvertiserRole | "")
                  }
                >
                  <option value="">{DIR_COPY.advertiser.placeholder}</option>
                  {ADVERTISER_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}

          {/* Un evento GRATIS no lleva precio. El campo no se "deshabilita": se
              va. Un input vacío y apagado sigue invitando a preguntarse qué
              habría que poner ahí. */}
          {!isFreeEvent && (
            <div className={cn("grid gap-3", hasPriceFrequency ? "grid-cols-2" : "grid-cols-1")}>
              <Field htmlFor="pub-price" label={C.steps.price.priceLabel} optional={!isProperty}>
                <Input
                  id="pub-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={price}
                  placeholder={C.steps.price.pricePlaceholder}
                  onChange={(event) => setPrice(event.target.value)}
                  className="numeric"
                />
              </Field>
              {hasPriceFrequency && (
                <Field htmlFor="pub-period" label={C.steps.price.periodLabel}>
                  <Select
                    id="pub-period"
                    value={period}
                    onChange={(event) => setPeriod(event.target.value)}
                  >
                    <option value="month">Por mes</option>
                    <option value="week">Por semana</option>
                    <option value="day">Por día</option>
                    <option value="one_time">Precio único</option>
                  </Select>
                </Field>
              )}
            </div>
          )}

          {/* El DEPÓSITO va acá arriba y no plegado con el resto: después del
              alquiler es la pregunta que más se hace, y en muchos casos es la
              que decide si la persona sigue mirando. Esconderlo con los
              opcionales lo dejaría sin contestar en casi todos los avisos. */}
          {isProperty && (
            <Field
              htmlFor="pub-deposit"
              label={DIR_COPY.rental.depositLabel}
              help={DIR_COPY.rental.depositHelp}
              optional
            >
              <Input
                id="pub-deposit"
                type="number"
                inputMode="decimal"
                min={0}
                max={MAX_DEPOSIT}
                value={deposit}
                placeholder={DIR_COPY.rental.depositPlaceholder}
                onChange={(event) => setDeposit(event.target.value)}
                className="numeric"
              />
            </Field>
          )}

          {isProperty && (
            <div className="grid grid-cols-3 gap-3">
              <Field htmlFor="pub-bedrooms" label={C.steps.price.bedroomsLabel} optional>
                <Input
                  id="pub-bedrooms"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20}
                  value={bedrooms}
                  onChange={(event) => setBedrooms(event.target.value)}
                  className="numeric"
                />
              </Field>
              <Field htmlFor="pub-bathrooms" label={C.steps.price.bathroomsLabel} optional>
                <Input
                  id="pub-bathrooms"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20}
                  value={bathrooms}
                  onChange={(event) => setBathrooms(event.target.value)}
                  className="numeric"
                />
              </Field>
              <Field htmlFor="pub-sqft" label={C.steps.price.sqftLabel} optional>
                <Input
                  id="pub-sqft"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={sqft}
                  onChange={(event) => setSqft(event.target.value)}
                  className="numeric"
                />
              </Field>
            </div>
          )}

          {isProperty && (
            <OptionalSection
              title={DIR_COPY.rental.moreTitle}
              hint={DIR_COPY.rental.moreHint}
              icon={<Key weight="fill" />}
            >
              <ChoiceCards
                name="pub-furnished"
                legend={DIR_COPY.rental.furnishedLegend}
                options={FURNISHED_OPTIONS}
                value={furnished}
                onChange={setFurnished}
                columns={3}
              />

              <Field
                htmlFor="pub-available-from"
                label={DIR_COPY.rental.availableLabel}
                optional
              >
                <Input
                  id="pub-available-from"
                  type="date"
                  value={availableFrom}
                  onChange={(event) => setAvailableFrom(event.target.value)}
                  className="numeric"
                />
              </Field>

              <Field
                htmlFor="pub-extra-fees"
                label={DIR_COPY.rental.extraFeesLabel}
                help={DIR_COPY.rental.extraFeesHelp}
                optional
              >
                <Input
                  id="pub-extra-fees"
                  value={extraFees}
                  maxLength={MAX_EXTRA_FEES_LENGTH}
                  placeholder={DIR_COPY.rental.extraFeesPlaceholder}
                  onChange={(event) => setExtraFees(event.target.value)}
                />
              </Field>

              <ToggleChips
                legend={DIR_COPY.rental.utilitiesLegend}
                help={DIR_COPY.rental.utilitiesHelp}
                options={RENTAL_UTILITIES}
                selected={utilities}
                onToggle={(value) => setUtilities((current) => toggleInList(current, value))}
              />

              <ToggleChips
                legend={DIR_COPY.rental.requirementsLegend}
                help={DIR_COPY.rental.requirementsHelp}
                options={RENTAL_REQUIREMENTS}
                selected={requirements}
                onToggle={(value) => setRequirements((current) => toggleInList(current, value))}
              />
            </OptionalSection>
          )}

          {kind === "professional" && (
            <>
              <Field htmlFor="pub-category" label={DIR_COPY.professional.categoryLabel}>
                <Select
                  id="pub-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="" disabled>
                    Elegí un rubro…
                  </option>
                  {PROFESSIONAL_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                htmlFor="pub-credentials"
                label={DIR_COPY.professional.credentialsLabel}
                help={DIR_COPY.professional.credentialsHelp}
                optional
              >
                <Input
                  id="pub-credentials"
                  value={credentials}
                  maxLength={200}
                  placeholder={DIR_COPY.professional.credentialsPlaceholder}
                  onChange={(event) => setCredentials(event.target.value)}
                />
              </Field>
            </>
          )}

          {isEvent && (
            <>
              <Field htmlFor="pub-event-category" label={DIR_COPY.event.categoryLabel}>
                <Select
                  id="pub-event-category"
                  value={eventCategory}
                  onChange={(event) => setEventCategory(event.target.value)}
                >
                  <option value="" disabled>
                    {DIR_COPY.event.categoryPlaceholder}
                  </option>
                  {EVENT_CATEGORIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field htmlFor="pub-event-date" label={DIR_COPY.event.dateLabel}>
                <Input
                  id="pub-event-date"
                  type="datetime-local"
                  value={eventStartsAt}
                  onChange={(event) => setEventStartsAt(event.target.value)}
                  className="numeric"
                />
              </Field>

              <Field
                htmlFor="pub-event-ends"
                label={DIR_COPY.event.endsLabel}
                help={DIR_COPY.event.endsHelp}
                optional
              >
                <Input
                  id="pub-event-ends"
                  type="datetime-local"
                  value={eventEndsAt}
                  // `min` acota el calendario nativo a lo que tiene sentido: es
                  // ayuda, no defensa. La regla real la aplican validateStep y
                  // resolveEventDates en el servidor.
                  min={eventStartsAt || undefined}
                  onChange={(event) => setEventEndsAt(event.target.value)}
                  className="numeric"
                />
              </Field>

              {/* GRATIS O PAGO. Sin preselección: la spec pide la elección
                  explícita, y un default publicaría eventos gratis por descuido.
                  Elegir "Gratis" hace desaparecer el campo de precio de arriba. */}
              <ChoiceCards
                name="pub-event-ticket"
                legend={DIR_COPY.event.ticketLegend}
                options={[
                  {
                    value: "gratis" as const,
                    label: DIR_COPY.event.ticketFree,
                    hint: DIR_COPY.event.ticketFreeHint,
                  },
                  {
                    value: "pago" as const,
                    label: DIR_COPY.event.ticketPaid,
                    hint: DIR_COPY.event.ticketPaidHint,
                  },
                ]}
                value={eventTicket}
                onChange={setEventTicket}
                iconFor={(value) => (
                  <Ticket
                    size={18}
                    weight={eventTicket === value ? "fill" : "regular"}
                    aria-hidden="true"
                  />
                )}
              />

              {/* Enlace de entradas: BASE y gratis para todos, guardado en
                  attrs.tickets_url. El botón premium vive en la columna
                  cta_tickets_url, que la base le prohíbe a un aviso free. La
                  precedencia entre los dos está en resolveEventTicketsUrl(). */}
              <Field
                htmlFor="pub-event-tickets-url"
                label={DIR_COPY.event.ticketsUrlLabel}
                help={DIR_COPY.event.ticketsUrlHelp}
                optional
              >
                <Input
                  id="pub-event-tickets-url"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  value={eventTicketsUrl}
                  maxLength={500}
                  placeholder={DIR_COPY.event.ticketsUrlPlaceholder}
                  onChange={(event) => setEventTicketsUrl(event.target.value)}
                />
              </Field>

              {/* DÓNDE. Va acá y no en el paso 3 porque decide QUÉ muestra el
                  paso 3: presencial pide zona y dirección, en línea pide el
                  enlace de acceso. */}
              <ChoiceCards
                name="pub-event-mode"
                legend={DIR_COPY.event.modeLegend}
                options={EVENT_MODE_OPTIONS}
                value={eventMode}
                onChange={setEventMode}
                iconFor={(value) => {
                  const ModeIcon = requiresVenue(value) ? MapPin : Globe;
                  return (
                    <ModeIcon
                      size={18}
                      weight={eventMode === value ? "fill" : "regular"}
                      aria-hidden="true"
                    />
                  );
                }}
              />

              <OptionalSection
                title={DIR_COPY.event.moreTitle}
                hint={DIR_COPY.event.moreHint}
                icon={<Calendar weight="fill" />}
              >
                <Field
                  htmlFor="pub-event-capacity"
                  label={DIR_COPY.event.capacityLabel}
                  help={DIR_COPY.event.capacityHelp}
                  optional
                >
                  <Input
                    id="pub-event-capacity"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_EVENT_CAPACITY}
                    value={eventCapacity}
                    placeholder={DIR_COPY.event.capacityPlaceholder}
                    onChange={(event) => setEventCapacity(event.target.value)}
                    className="numeric"
                  />
                </Field>

                <Field htmlFor="pub-event-audience" label={DIR_COPY.event.audienceLabel} optional>
                  <Select
                    id="pub-event-audience"
                    value={eventAudience}
                    onChange={(event) => setEventAudience(event.target.value)}
                  >
                    <option value="">{DIR_COPY.event.audiencePlaceholder}</option>
                    {EVENT_AUDIENCES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </OptionalSection>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">{C.steps.zone.title}</h2>

          {/* El "dónde" de un evento EN LÍNEA es su enlace, no un barrio. El
              paso entero cambia en vez de mostrar una zona que nadie puede
              contestar — pedirla igual sólo consigue que alguien escriba "Zoom"
              en un campo de ubicación. */}
          {zoneStepIsVirtual ? (
            <Field
              htmlFor="pub-event-online-url"
              label={DIR_COPY.event.onlineUrlLabel}
              help={DIR_COPY.event.onlineUrlHelp}
            >
              <Input
                id="pub-event-online-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                value={eventOnlineUrl}
                maxLength={500}
                placeholder={DIR_COPY.event.onlineUrlPlaceholder}
                onChange={(event) => setEventOnlineUrl(event.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field
                htmlFor="pub-zone"
                label={C.steps.zone.zoneLabel}
                help={C.steps.zone.zoneHelp}
              >
                <Input
                  id="pub-zone"
                  value={areaLabel}
                  maxLength={80}
                  placeholder={C.steps.zone.zonePlaceholder}
                  onChange={(event) => setAreaLabel(event.target.value)}
                />
              </Field>
              <Field
                htmlFor="pub-address"
                label={C.steps.zone.addressLabel}
                help={C.steps.zone.addressHelp}
                optional
              >
                <Input
                  id="pub-address"
                  value={exactAddress}
                  maxLength={200}
                  placeholder={C.steps.zone.addressPlaceholder}
                  onChange={(event) => setExactAddress(event.target.value)}
                />
              </Field>
            </>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">
            {C.steps.photos.title}
          </h2>
          {/* El número sale del módulo de monetización, no de un string fijo:
              C.steps.photos.help sigue diciendo "6" y lo comparte con otros
              wizards que todavía tienen ese tope. */}
          <p className="-mt-2 text-sm text-foreground-secondary">
            {M.tier.photoStepHelp(MAX_PHOTOS)}
          </p>

          <div className="grid grid-cols-3 gap-2">
            {photos.map((item, index) => (
              <div key={item.previewUrl} className="relative aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob URL) */}
                <img
                  src={item.previewUrl}
                  alt={`Foto ${index + 1}`}
                  className="size-full rounded-md object-cover"
                />
                <button
                  type="button"
                  aria-label={`${C.steps.photos.removeLabel} ${index + 1}`}
                  onClick={() => removePhoto(index)}
                  // Área táctil a 44px con ::after y no agrandando el botón: acá
                  // taparía la miniatura. `touch-hitbox` no sirve porque fuerza
                  // `position: relative` y este botón es `absolute`.
                  className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-media-scrim text-on-media after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ))}

            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center gap-1.5 rounded-md",
                  "border border-dashed border-border text-foreground-muted",
                  "transition-colors duration-(--duration-fast) hover:border-brand hover:text-brand-ink",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                <ImageSquare size={24} aria-hidden="true" />
                <span className="text-xs font-semibold">{C.steps.photos.addLabel}</span>
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label={C.steps.photos.addLabel}
            onChange={(event) => addPhotos(event.target.files)}
          />

          {photos.length > 0 && (
            <p className="text-xs text-foreground-muted">{C.steps.photos.reviewNote}</p>
          )}

          {/* Declaración de originalidad y licencia. Va en el paso de FOTOS, no
              en el de vista previa: es de las fotos que habla, y acá la persona
              todavía las tiene delante. */}
          <OriginalityFields
            idPrefix="aviso-declaracion"
            value={declaration}
            onChange={setDeclaration}
          />
        </div>
      )}


      {step === STEP_PREVIEW && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground">
              {M.preview.title}
            </h2>
            <p className="mt-0.5 text-sm text-foreground-secondary">{M.preview.help}</p>
          </div>

          {/* La tarjeta imita el aviso real —foto, título, precio, zona— para que
              "así te va a quedar" sea literal y no una lista de campos. */}
          <BezelCard coreClassName="overflow-hidden">
            {photos.length > 0 ? (
              <div className="relative aspect-[4/3] w-full bg-surface-subtle">
                {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob URL) */}
                <img
                  src={photos[0].previewUrl}
                  alt=""
                  className="size-full object-cover"
                />
              </div>
            ) : (
              <div className="flex aspect-[4/3] w-full items-center justify-center gap-2 bg-surface-subtle text-foreground-muted">
                <ImageSquare size={22} aria-hidden="true" />
                <span className="text-sm font-medium">{M.preview.photosNone}</span>
              </div>
            )}

            <div className="flex flex-col gap-1.5 p-4">
              <p className="font-display text-lg font-bold leading-snug text-foreground">
                {title.trim() || "—"}
              </p>
              {photos.length > 1 && (
                // El contador va en el cuerpo y NO encima de la foto: sobre la
                // imagen pedía `text-on-media`, que es tinta clara por
                // definición y desaparece al imprimir sin su relleno
                // (src/test/print-contract.test.ts). Acá se lee siempre.
                <p className="text-xs text-foreground-muted">
                  {M.preview.photoCount(photos.length)}
                </p>
              )}
              {/* Operación y tipo, juntos y arriba del precio: es el orden en
                  que se leen en el aviso publicado, así "así te va a quedar"
                  no miente por omisión. */}
              {isProperty && (operation || propertyType) && (
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-semibold text-foreground-secondary">
                  {operation && <span>{propertyOperationLabel(operation)}</span>}
                  {operation && propertyType && (
                    <span aria-hidden="true" className="text-foreground-muted">
                      ·
                    </span>
                  )}
                  {propertyType && <span>{propertyTypeLabel(propertyType)}</span>}
                </p>
              )}
              {/* Un evento gratis muestra "Gratis" donde iría el precio, no un
                  hueco: la ausencia de precio y "no cuesta nada" se ven igual, y
                  son cosas distintas. */}
              {isFreeEvent ? (
                <p className="text-2xl font-bold text-brand">{DIR_COPY.event.ticketFree}</p>
              ) : (
                pricePreview && (
                  <p className="numeric text-2xl font-bold text-brand">{pricePreview}</p>
                )
              )}
              {/* La vista previa dice lo MISMO que se va a guardar: en un evento
                  en línea, `area_label` es la etiqueta de modalidad, así que eso
                  es lo que tiene que leerse acá. */}
              {zoneStepIsVirtual ? (
                <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
                  <Globe size={14} aria-hidden="true" />
                  {DIR_COPY.event.virtualAreaLabel}
                </p>
              ) : (
                areaLabel.trim() && (
                  <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
                    <MapPin size={14} aria-hidden="true" />
                    {areaLabel.trim()}
                  </p>
                )
              )}
              {description.trim() && (
                <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
                  {description.trim()}
                </p>
              )}
            </div>
          </BezelCard>

          {/* Contacto: en gratis es el chat y nada más. Se dice ACÁ, antes de
              publicar, para que nadie descubra después que su teléfono no
              aparece por ningún lado. */}
          <div className="rounded-lg bg-surface-subtle px-4 py-3">
            <p className="text-sm text-foreground">{M.tier.freeContactNote}</p>
            <p className="mt-1 text-xs text-foreground-muted">{M.tier.upgradeTeaser}</p>
          </div>

          <Button variant="outline" className="w-full" onClick={() => setStep(1)}>
            <PencilSimple size={18} aria-hidden="true" />
            {M.preview.edit}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {step > 0 && (
          <Button variant="ghost" onClick={goBack} disabled={submitting}>
            {C.nav.back}
          </Button>
        )}
        {step < TOTAL_STEPS - 1 ? (
          <Button variant="primary" className="ml-auto min-w-32" onClick={goNext}>
            {C.nav.next}
          </Button>
        ) : (
          <Button
            variant="primary"
            className="ml-auto min-w-40"
            loading={submitting}
            onClick={handleSubmit}
          >
            {submitting ? C.nav.submitting : C.nav.submit}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de promoción de la pantalla de éxito
// ---------------------------------------------------------------------------

/**
 * Las dos rutas de "Promocionar", una al lado de la otra y con su diferencia
 * escrita. Son tarjetas y no dos botones apilados a propósito: impulsar y armar
 * una campaña no son la misma acción con distinto precio, y dos botones
 * idénticos invitan a elegir el de arriba sin leer.
 */
function PromoteCard({
  href,
  icon,
  title,
  hint,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-11 items-start gap-3 rounded-lg border border-border-subtle bg-surface p-4 text-left",
        "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:border-brand hover:bg-brand-tint active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      <span className="mt-0.5 shrink-0 text-brand">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground group-hover:text-brand-ink">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-foreground-secondary">
          {hint}
        </span>
      </span>
    </Link>
  );
}
