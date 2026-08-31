"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  HandHeart,
  HandsClapping,
  PaperPlaneTilt,
  Translate,
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
} from "@/components/ui";
import {
  COMUNIDAD_COPY,
  HELP_AREA_MAX,
  HELP_AREA_MIN,
  HELP_AVAILABILITY_MAX,
  HELP_BODY_MAX,
  HELP_BODY_MIN,
  HELP_DIRECTION_COPY,
  HELP_LANGUAGES,
  HELP_ORG_MAX,
  HELP_TITLE_MAX,
  HELP_TITLE_MIN,
  HELP_TOPICS,
  HELP_TOPIC_LABEL,
  primerDatoDeContacto,
  type HelpDirection,
  type HelpTopic,
} from "@/lib/comunidad";
import { cn } from "@/lib/utils";
import { guardarYEnviarAvisoDeAyuda } from "../actions";

const C = COMUNIDAD_COPY.ofrecerse;
const TOTAL_PASOS = 2;

const ACCENT = "var(--accent-comunidad-manos)";
const ACCENT_TINT = `color-mix(in oklab, ${ACCENT} 12%, transparent)`;
const ACCENT_EDGE = `color-mix(in oklab, ${ACCENT} 42%, transparent)`;

type Idioma = (typeof HELP_LANGUAGES)[number];

export interface BorradorInicial {
  avisoId: string;
  direction: HelpDirection;
  topic: HelpTopic;
  resourceId: string | null;
  title: string;
  body: string;
  areaLabel: string;
  availability: string;
  orgName: string;
  languages: string[];
}

export interface LugarOption {
  id: string;
  name: string;
  topic: string;
}

const TAP_CARD = cn(
  "flex min-h-11 flex-1 flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left",
  "transition-[border-color,background-color,transform,color] duration-(--duration-fast) ease-(--ease-spring)",
  "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

/**
 * =============================================================================
 * WIZARD DE /comunidad/ayuda-mutua/publicar — DOS pasos, mobile-first
 * =============================================================================
 *
 *   1. Qué venís a hacer  (ofrecer / pedir + tema + lugar opcional)
 *   2. Contalo            (título + detalle + zona + cuándo + idiomas)
 *
 * Dos y no tres —Perdido y encontrado tiene tres— porque acá no hay fotos: el
 * tercer paso de aquel formulario es la subida, y esta sección no acepta
 * imágenes a propósito (una cara identificable al lado de un barrio y un tema
 * es el cruce que §5.4 pide no construir).
 *
 * ── LA VALIDACIÓN DE CONTACTO CORRE ACÁ TAMBIÉN, Y NO ES DUPLICACIÓN INÚTIL ──
 * `primerDatoDeContacto` es la MISMA función que corre en el servidor (es
 * lógica pura, importable de los dos lados). Corre acá para que la persona vea
 * el problema en el paso donde lo escribió, con el campo a la vista, en vez de
 * después de un viaje al servidor y con el formulario ya cerrado. La regla la
 * sigue haciendo cumplir el servidor: esto es cortesía, aquello es el control.
 *
 * ── QUÉ PASA CON LO ESCRITO SI ALGO FALLA ───────────────────────────────────
 * Nada se pierde. El estado vive en este componente hasta que el envío sale
 * bien; si la action rechaza —por un teléfono en el texto, por el cupo, por la
 * moderación— el formulario se queda exactamente como estaba, con el error
 * arriba del botón. Del lado del servidor, además, la fila ya creada queda
 * como borrador y se puede retomar desde "Mis avisos".
 */
export function AyudaPublishForm({
  lugares,
  modoInicial,
  temaInicial,
  lugarInicial,
  borrador,
}: {
  lugares: LugarOption[];
  modoInicial: HelpDirection;
  temaInicial: HelpTopic;
  lugarInicial: string | null;
  borrador: BorradorInicial | null;
}) {
  const router = useRouter();

  const [paso, setPaso] = useState(0);
  const [direccion, setDireccion] = useState<HelpDirection>(modoInicial);
  const [tema, setTema] = useState<HelpTopic>(temaInicial);
  const [lugar, setLugar] = useState<string>(lugarInicial ?? "");
  const [titulo, setTitulo] = useState(borrador?.title ?? "");
  const [detalle, setDetalle] = useState(borrador?.body ?? "");
  const [zona, setZona] = useState(borrador?.areaLabel ?? "");
  const [cuando, setCuando] = useState(borrador?.availability ?? "");
  const [nombreLugar, setNombreLugar] = useState(borrador?.orgName ?? "");
  const [idiomas, setIdiomas] = useState<Idioma[]>(
    (borrador?.languages ?? []).filter((item): item is Idioma =>
      (HELP_LANGUAGES as readonly string[]).includes(item),
    ),
  );

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const esPedido = direccion === "need";

  // Los lugares del tema elegido. Se filtra en memoria porque ya vinieron
  // todos: cambiar de tema no debería disparar una consulta a mitad del
  // formulario.
  const lugaresDelTema = useMemo(
    () => lugares.filter((item) => item.topic === tema),
    [lugares, tema],
  );

  function elegirTema(nuevo: HelpTopic) {
    setTema(nuevo);
    // El lugar pertenece a UN tema (lo exige el trigger de la 0120): al cambiar
    // de tema, el lugar elegido deja de ser válido y se limpia. Dejarlo puesto
    // haría que el envío fallara con un error que nadie entendería.
    setLugar("");
  }

  function validarPaso(indice: number): string | null {
    if (indice === 1) {
      if (titulo.trim().length < HELP_TITLE_MIN) return C.errors.title;
      if (detalle.trim().length < HELP_BODY_MIN) return C.errors.body;
      if (zona.trim().length < HELP_AREA_MIN) return C.errors.area;
      if (esPedido && nombreLugar.trim().length < 2) return C.errors.orgName;

      const contacto = primerDatoDeContacto(titulo, detalle, cuando, nombreLugar);
      if (contacto) return C.errors[contacto];
    }
    return null;
  }

  function siguiente() {
    const problema = validarPaso(paso);
    if (problema) {
      setError(problema);
      return;
    }
    setError(null);
    setPaso((actual) => Math.min(actual + 1, TOTAL_PASOS - 1));
  }

  async function enviar() {
    // Se revalida TODO: se puede volver atrás y vaciar un campo ya aprobado.
    for (let indice = 0; indice < TOTAL_PASOS; indice += 1) {
      const problema = validarPaso(indice);
      if (problema) {
        setPaso(indice);
        setError(problema);
        return;
      }
    }
    setError(null);
    setEnviando(true);

    try {
      const resultado = await guardarYEnviarAvisoDeAyuda({
        avisoId: borrador?.avisoId,
        direction: direccion,
        topic: tema,
        resourceId: lugar || null,
        title: titulo.trim(),
        body: detalle.trim(),
        areaLabel: zona.trim(),
        availability: cuando.trim() || null,
        orgName: esPedido ? nombreLugar.trim() : null,
        languages: idiomas,
      });

      if (!resultado.ok) {
        if (resultado.needsAuth) {
          router.push(
            `/entrar?next=${encodeURIComponent("/comunidad/ayuda-mutua/publicar")}`,
          );
          return;
        }
        setError(resultado.error);
        return;
      }
      setListo(true);
    } catch {
      setError(C.errors.generic);
    } finally {
      setEnviando(false);
    }
  }

  // -------------------------------------------------------------------------
  // Final — SIEMPRE "lo estamos revisando". Acá nada se publica solo.
  // -------------------------------------------------------------------------
  if (listo) {
    return (
      <BezelCard coreClassName="p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Clock size={40} weight="fill" aria-hidden="true" className="text-foreground-muted" />
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            {C.done.title}
          </h2>
          <p className="text-sm leading-relaxed text-foreground-secondary">{C.done.body}</p>

          <div className="mt-2 flex w-full flex-col gap-2">
            <Link
              href="/comunidad/ayuda-mutua/mios"
              className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
            >
              {C.done.verMios}
            </Link>
            <Link
              href="/comunidad/ayuda-mutua"
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
            >
              {C.done.verTablon}
            </Link>
          </div>
        </div>
      </BezelCard>
    );
  }

  // -------------------------------------------------------------------------
  // Wizard
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-5">
      <ProgressDots total={TOTAL_PASOS} current={paso} />

      {paso === 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            {C.steps.lado.title}
          </h2>

          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{C.steps.lado.title}</legend>
            <div className="flex flex-col gap-2 sm:flex-row">
              {(
                [
                  {
                    value: "offer" as const,
                    icon: <HandHeart size={18} weight="fill" aria-hidden="true" />,
                  },
                  {
                    value: "need" as const,
                    icon: <HandsClapping size={18} weight="fill" aria-hidden="true" />,
                  },
                ] satisfies { value: HelpDirection; icon: React.ReactNode }[]
              ).map((opcion) => {
                const activo = direccion === opcion.value;
                const copy = HELP_DIRECTION_COPY[opcion.value];
                return (
                  <button
                    key={opcion.value}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => setDireccion(opcion.value)}
                    className={cn(
                      TAP_CARD,
                      activo
                        ? "text-foreground"
                        : "border-border bg-surface text-foreground-secondary hover:bg-surface-subtle",
                    )}
                    style={
                      activo ? { backgroundColor: ACCENT_TINT, borderColor: ACCENT_EDGE } : undefined
                    }
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <span aria-hidden="true" style={{ color: activo ? ACCENT : undefined }}>
                        {opcion.icon}
                      </span>
                      {copy.elegir}
                    </span>
                    <span className="text-xs leading-snug text-foreground-muted">
                      {copy.elegirHint}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field
            htmlFor="ayuda-tema"
            label={C.steps.lado.temaLabel}
            help={C.steps.lado.temaHelp}
          >
            <Select
              id="ayuda-tema"
              value={tema}
              onChange={(event) => elegirTema(event.target.value as HelpTopic)}
            >
              {HELP_TOPICS.map((valor) => (
                <option key={valor} value={valor}>
                  {HELP_TOPIC_LABEL[valor]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            htmlFor="ayuda-lugar"
            label={C.steps.lado.lugarLabel}
            help={
              lugaresDelTema.length > 0 ? C.steps.lado.lugarHelp : C.steps.lado.lugarVacio
            }
            optional
          >
            <Select
              id="ayuda-lugar"
              value={lugar}
              disabled={lugaresDelTema.length === 0}
              onChange={(event) => setLugar(event.target.value)}
            >
              <option value="">{C.steps.lado.lugarNinguno}</option>
              {lugaresDelTema.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        </section>
      )}

      {paso === 1 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            {C.steps.contar.title}
          </h2>

          {esPedido && (
            <Field
              htmlFor="ayuda-lugar-nombre"
              label={C.steps.contar.lugarNombreLabel}
              help={C.steps.contar.lugarNombreHelp}
            >
              <Input
                id="ayuda-lugar-nombre"
                value={nombreLugar}
                onChange={(event) => setNombreLugar(event.target.value)}
                maxLength={HELP_ORG_MAX}
                autoComplete="off"
              />
            </Field>
          )}

          <Field
            htmlFor="ayuda-titulo"
            label={C.steps.contar.tituloLabel}
            help={C.steps.contar.tituloHelp}
          >
            <Input
              id="ayuda-titulo"
              value={titulo}
              onChange={(event) => setTitulo(event.target.value)}
              placeholder={
                esPedido
                  ? C.steps.contar.tituloPlaceholderNeed
                  : C.steps.contar.tituloPlaceholderOffer
              }
              maxLength={HELP_TITLE_MAX}
              autoComplete="off"
            />
          </Field>

          <Field
            htmlFor="ayuda-detalle"
            label={C.steps.contar.detalleLabel}
            help={C.steps.contar.detalleHelp}
          >
            <Textarea
              id="ayuda-detalle"
              value={detalle}
              onChange={(event) => setDetalle(event.target.value)}
              placeholder={
                esPedido
                  ? C.steps.contar.detallePlaceholderNeed
                  : C.steps.contar.detallePlaceholderOffer
              }
              maxLength={HELP_BODY_MAX}
              rows={5}
            />
          </Field>

          <Field
            htmlFor="ayuda-zona-alta"
            label={C.steps.contar.zonaLabel}
            help={C.steps.contar.zonaHelp}
          >
            <Input
              id="ayuda-zona-alta"
              value={zona}
              onChange={(event) => setZona(event.target.value)}
              placeholder={C.steps.contar.zonaPlaceholder}
              minLength={HELP_AREA_MIN}
              maxLength={HELP_AREA_MAX}
              autoComplete="off"
            />
          </Field>

          <Field
            htmlFor="ayuda-cuando"
            label={esPedido ? C.steps.contar.cuandoLabelNeed : C.steps.contar.cuandoLabel}
            optional
          >
            <Input
              id="ayuda-cuando"
              value={cuando}
              onChange={(event) => setCuando(event.target.value)}
              placeholder={C.steps.contar.cuandoPlaceholder}
              maxLength={HELP_AVAILABILITY_MAX}
              autoComplete="off"
            />
          </Field>

          {/* Idiomas: lista cerrada de botones con `aria-pressed`, no un
              `<select multiple>` —que en móvil es de lo peor que hay— ni texto
              libre, que convertiría "español" y "Español" en dos idiomas. */}
          <fieldset>
            <legend className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Translate size={16} aria-hidden="true" className="text-foreground-muted" />
              {esPedido ? C.steps.contar.idiomasLabelNeed : C.steps.contar.idiomasLabel}
            </legend>
            <div className="flex flex-wrap gap-2">
              {HELP_LANGUAGES.map((idioma) => {
                const activo = idiomas.includes(idioma);
                return (
                  <button
                    key={idioma}
                    type="button"
                    aria-pressed={activo}
                    onClick={() =>
                      setIdiomas((actual) =>
                        actual.includes(idioma)
                          ? actual.filter((item) => item !== idioma)
                          : [...actual, idioma],
                      )
                    }
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium",
                      "transition-[border-color,background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                      "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                      activo
                        ? "text-foreground"
                        : "border-border bg-surface text-foreground-secondary hover:bg-surface-subtle",
                    )}
                    style={
                      activo ? { backgroundColor: ACCENT_TINT, borderColor: ACCENT_EDGE } : undefined
                    }
                  >
                    {idioma}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger-ink"
        >
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {paso > 0 && (
          <Button
            type="button"
            variant="outline"
            size="md"
            className="flex-1"
            onClick={() => {
              setError(null);
              setPaso((actual) => Math.max(actual - 1, 0));
            }}
            disabled={enviando}
          >
            {C.back}
          </Button>
        )}

        {paso < TOTAL_PASOS - 1 ? (
          <Button type="button" variant="primary" size="md" className="flex-1" onClick={siguiente}>
            {C.next}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="md"
            className="flex-1"
            onClick={enviar}
            disabled={enviando}
            aria-busy={enviando}
            loading={enviando}
          >
            <PaperPlaneTilt size={18} weight="fill" aria-hidden="true" />
            {enviando ? C.submitting : C.submit}
          </Button>
        )}
      </div>
    </div>
  );
}
