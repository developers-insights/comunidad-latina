"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Button, Field, Input, Select, Textarea, buttonVariants } from "@/components/ui";
import {
  COMUNIDAD_COPY,
  HELP_AREA_MAX,
  HELP_AREA_MIN,
  HELP_BODY_MAX,
  HELP_BODY_MIN,
  HELP_TITLE_MAX,
  HELP_TITLE_MIN,
  HELP_TOPICS,
  HELP_TOPIC_HINT,
  HELP_TOPIC_LABEL,
  primerDatoDeContacto,
  type HelpTopic,
} from "@/lib/comunidad";
import { cn } from "@/lib/utils";
import { publicarPedido } from "../actions";

const C = COMUNIDAD_COPY.escribirPedido;

/**
 * =============================================================================
 * ESCRIBIR UN PEDIDO — un solo paso
 * =============================================================================
 *
 * Antes esto era un wizard de dos pasos, y el primero era «¿qué venís a hacer?»
 * con dos botones («Quiero ayudar» / «Necesito manos»). El cliente contó el
 * 2026-09-03 que esa bifurcación lo confundió, y con los ofrecimientos fuera
 * ese paso quedó sin nada que preguntar: hoy hay una sola cosa que se puede
 * hacer acá.
 *
 * Cuatro campos en una pantalla, sin pasos ni barra de progreso. Un wizard para
 * cuatro campos es un wizard que existe para justificar el wizard: quien está
 * pidiendo ayuda tiene que ver de una cuánto le falta para terminar.
 *
 * ── LA VALIDACIÓN DE CONTACTO CORRE ACÁ TAMBIÉN, Y NO ES DUPLICACIÓN INÚTIL ──
 * `primerDatoDeContacto` es la MISMA función que corre en el servidor (es
 * lógica pura, importable de los dos lados). Corre acá para que la persona vea
 * el problema con el campo a la vista, en vez de después de un viaje al
 * servidor. La regla la sigue haciendo cumplir el servidor: esto es cortesía,
 * aquello es el control.
 *
 * ── QUÉ PASA CON LO ESCRITO SI ALGO FALLA ───────────────────────────────────
 * Nada se pierde. El estado vive en este componente hasta que el envío sale
 * bien; si la action rechaza —por un teléfono en el texto, por el cupo, por la
 * moderación— el formulario se queda exactamente como estaba, con el error
 * arriba del botón.
 */
export function PedidoForm({ temaInicial }: { temaInicial: HelpTopic }) {
  const router = useRouter();

  const [tema, setTema] = useState<HelpTopic>(temaInicial);
  const [titulo, setTitulo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [zona, setZona] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicadoId, setPublicadoId] = useState<string | null>(null);

  function validar(): string | null {
    if (titulo.trim().length < HELP_TITLE_MIN) return C.errors.title;
    if (detalle.trim().length < HELP_BODY_MIN) return C.errors.body;
    if (zona.trim().length < HELP_AREA_MIN) return C.errors.area;

    const contacto = primerDatoDeContacto(titulo, detalle, zona);
    if (contacto) return C.errors[contacto];
    return null;
  }

  async function enviar() {
    const problema = validar();
    if (problema) {
      setError(problema);
      return;
    }
    setError(null);
    setEnviando(true);

    try {
      const resultado = await publicarPedido({
        topic: tema,
        title: titulo.trim(),
        body: detalle.trim(),
        areaLabel: zona.trim(),
      });

      if (!resultado.ok) {
        if (resultado.needsAuth) {
          router.push(
            `/entrar?next=${encodeURIComponent("/comunidad/pedir-ayuda/publicar")}`,
          );
          return;
        }
        setError(resultado.error);
        return;
      }
      setPublicadoId(resultado.pedidoId);
    } catch {
      setError(C.errors.generic);
    } finally {
      setEnviando(false);
    }
  }

  // -------------------------------------------------------------------------
  // Final — ya está publicado. Antes acá decía "lo estamos revisando": con la
  // 0130 el pedido se ve en el tablón desde este mismo segundo.
  // -------------------------------------------------------------------------
  if (publicadoId) {
    return (
      <BezelCard coreClassName="p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle size={40} weight="fill" aria-hidden="true" className="text-success" />
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            {C.done.title}
          </h2>
          <p className="text-sm leading-relaxed text-foreground-secondary">{C.done.body}</p>

          <div className="mt-2 flex w-full flex-col gap-2">
            <Link
              href={`/comunidad/pedir-ayuda/${publicadoId}`}
              className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
            >
              {C.done.verPedido}
            </Link>
            <Link
              href="/comunidad/pedir-ayuda"
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
            >
              {C.done.verTablon}
            </Link>
          </div>
        </div>
      </BezelCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Field htmlFor="pedido-tema" label={C.campos.temaLabel} help={HELP_TOPIC_HINT[tema]}>
        <Select
          id="pedido-tema"
          value={tema}
          onChange={(event) => setTema(event.target.value as HelpTopic)}
        >
          {HELP_TOPICS.map((valor) => (
            <option key={valor} value={valor}>
              {HELP_TOPIC_LABEL[valor]}
            </option>
          ))}
        </Select>
      </Field>

      <Field htmlFor="pedido-titulo" label={C.campos.tituloLabel} help={C.campos.tituloHelp}>
        <Input
          id="pedido-titulo"
          value={titulo}
          onChange={(event) => setTitulo(event.target.value)}
          placeholder={C.campos.tituloPlaceholder}
          maxLength={HELP_TITLE_MAX}
          autoComplete="off"
        />
      </Field>

      <Field htmlFor="pedido-detalle" label={C.campos.detalleLabel} help={C.campos.detalleHelp}>
        <Textarea
          id="pedido-detalle"
          value={detalle}
          onChange={(event) => setDetalle(event.target.value)}
          placeholder={C.campos.detallePlaceholder}
          maxLength={HELP_BODY_MAX}
          rows={5}
        />
      </Field>

      <Field htmlFor="pedido-zona" label={C.campos.zonaLabel} help={C.campos.zonaHelp}>
        <Input
          id="pedido-zona"
          value={zona}
          onChange={(event) => setZona(event.target.value)}
          placeholder={C.campos.zonaPlaceholder}
          minLength={HELP_AREA_MIN}
          maxLength={HELP_AREA_MAX}
          autoComplete="off"
        />
      </Field>

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
        onClick={enviar}
        disabled={enviando}
        aria-busy={enviando}
        loading={enviando}
      >
        <PaperPlaneTilt size={18} weight="fill" aria-hidden="true" />
        {enviando ? C.submitting : C.submit}
      </Button>
    </div>
  );
}
