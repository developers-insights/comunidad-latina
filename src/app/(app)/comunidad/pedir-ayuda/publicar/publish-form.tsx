"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import {
  BezelCard,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  buttonVariants,
} from "@/components/ui";
import { ReglasDeAyuda } from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  HELP_AREA_MAX,
  HELP_AREA_MIN,
  HELP_BODY_MAX,
  HELP_BODY_MIN,
  HELP_TITLE_MAX,
  HELP_TITLE_MIN,
  HELP_TOPICS,
  HELP_TOPIC_LABEL,
  primerDatoDeContacto,
  type HelpTopic,
} from "@/lib/comunidad";
import { publicarPedido } from "../actions";

const C = COMUNIDAD_COPY.escribirPedido;

const RUTA = "/comunidad/pedir-ayuda/publicar";

/**
 * =============================================================================
 * ESCRIBIR UN PEDIDO — CUATRO CAMPOS, UNA PANTALLA
 * =============================================================================
 *
 * ── POR QUÉ NO ES UN ASISTENTE DE DOS PASOS ────────────────────────────────
 * El formulario anterior (el de "Ayuda mutua") lo era, y arrancaba eligiendo de
 * qué lado estabas: «Quiero ayudar» o «Necesito manos». El cliente contó el
 * 2026-09-03 que esa bifurcación lo confundió, y con los ofrecimientos afuera
 * ya no hay dos lados que elegir. Lo que queda entra en una pantalla, y partir
 * cuatro campos en dos pasos sólo agregaría un botón "Seguir" entre la persona
 * y su pedido.
 *
 * ── EL DETECTOR DE CONTACTO CORRE ACÁ TAMBIÉN, Y NO ES LA DEFENSA ──────────
 * La defensa es el servidor (`publicarPedido` lo corre antes de tocar la base,
 * §6 de la 0130). Acá corre para AVISAR MIENTRAS SE ESCRIBE: escribir todo,
 * mandar, y recién ahí enterarte de que el teléfono no va, es la forma más
 * segura de que la persona lo intente otra vez con el número escrito distinto.
 * Es la MISMA función pura que usa la action, así que no pueden opinar
 * distinto.
 *
 * ── EL TEXTO NO SE PIERDE NUNCA ────────────────────────────────────────────
 * Si la action rechaza —moderación, cupo de 5 abiertos, sesión vencida— los
 * campos quedan como estaban con el error arriba del botón. La única salida que
 * los limpia es la pantalla de "listo, ya está publicado".
 */
export function PublishForm() {
  const router = useRouter();
  const baseId = useId();
  const [topic, setTopic] = useState<HelpTopic | "">("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [publicado, setPublicado] = useState<string | null>(null);

  const contacto = primerDatoDeContacto(title, body, areaLabel);

  const listo =
    topic !== "" &&
    title.trim().length >= HELP_TITLE_MIN &&
    body.trim().length >= HELP_BODY_MIN &&
    areaLabel.trim().length >= HELP_AREA_MIN &&
    !contacto;

  async function enviar() {
    // `listo` ya incluye `topic !== ""`, y TS lo sabe: repetir la guarda acá
    // da un error de comparación imposible, no un chequeo de más.
    if (!listo || enviando) return;
    setError(null);
    setEnviando(true);
    try {
      const resultado = await publicarPedido({
        topic,
        title: title.trim(),
        body: body.trim(),
        areaLabel: areaLabel.trim(),
      });
      if (!resultado.ok) {
        if (resultado.needsAuth) {
          router.push(`/entrar?next=${encodeURIComponent(RUTA)}`);
          return;
        }
        setError(resultado.error);
        return;
      }
      setPublicado(resultado.pedidoId);
    } catch {
      setError(C.errors.generic);
    } finally {
      setEnviando(false);
    }
  }

  if (publicado) {
    return (
      <BezelCard className="mt-6">
        <div className="flex items-start gap-3">
          <CheckCircle
            size={28}
            weight="fill"
            aria-hidden="true"
            className="shrink-0 text-success-ink"
          />
          <div>
            <h2 className="font-display text-base font-semibold text-foreground">
              {C.done.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
              {C.done.body}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/comunidad/pedir-ayuda/${publicado}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {C.done.verPedido}
          </Link>
          <Link
            href="/comunidad/pedir-ayuda"
            className={buttonVariants({ variant: "outline", size: "md" })}
          >
            {C.done.verTablon}
          </Link>
        </div>
      </BezelCard>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      <ReglasDeAyuda />

      <Field
        htmlFor={`${baseId}-tema`}
        label={C.campos.temaLabel}
        help={C.campos.temaHelp}
        error={topic === "" && error ? C.errors.topic : undefined}
      >
        <Select
          id={`${baseId}-tema`}
          value={topic}
          onChange={(event) => setTopic(event.target.value as HelpTopic | "")}
        >
          <option value="">{COMUNIDAD_COPY.pedirAyuda.filtros.todosLosTemas}</option>
          {HELP_TOPICS.map((tema) => (
            <option key={tema} value={tema}>
              {HELP_TOPIC_LABEL[tema]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        htmlFor={`${baseId}-titulo`}
        label={C.campos.tituloLabel}
        help={C.campos.tituloHelp}
      >
        <Input
          id={`${baseId}-titulo`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={C.campos.tituloPlaceholder}
          maxLength={HELP_TITLE_MAX}
        />
      </Field>

      <Field
        htmlFor={`${baseId}-detalle`}
        label={C.campos.detalleLabel}
        help={C.campos.detalleHelp}
      >
        <Textarea
          id={`${baseId}-detalle`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={C.campos.detallePlaceholder}
          maxLength={HELP_BODY_MAX}
          rows={5}
        />
      </Field>

      <Field
        htmlFor={`${baseId}-zona`}
        label={C.campos.zonaLabel}
        help={C.campos.zonaHelp}
      >
        <Input
          id={`${baseId}-zona`}
          value={areaLabel}
          onChange={(event) => setAreaLabel(event.target.value)}
          placeholder={C.campos.zonaPlaceholder}
          maxLength={HELP_AREA_MAX}
        />
      </Field>

      {/* El aviso del detector va como `status` y no como `alert`: aparece
          mientras se escribe, y un `alert` interrumpiría al lector de pantalla
          en cada tecla. El botón ya está deshabilitado, así que nadie se lo
          puede saltear sin leerlo. */}
      {contacto && (
        <p
          role="status"
          className="rounded-md bg-warning-bg px-3 py-2.5 text-sm leading-relaxed text-warning-ink"
        >
          {C.errors[contacto]}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger-ink"
        >
          {error}
        </p>
      )}

      <Button
        type="button"
        variant="primary"
        size="md"
        className="self-start"
        onClick={enviar}
        disabled={!listo || enviando}
        aria-busy={enviando}
        loading={enviando}
      >
        <PaperPlaneTilt size={18} weight="fill" aria-hidden="true" />
        {enviando ? C.submitting : C.submit}
      </Button>
    </div>
  );
}
