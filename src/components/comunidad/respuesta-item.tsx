"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeSlash, Flag, Trash } from "@phosphor-icons/react/dist/ssr";
import { Button, Chip, useToast } from "@/components/ui";
import { ReportSheet } from "@/components/trust";
import { COMUNIDAD_COPY, type HelpReply } from "@/lib/comunidad";
import { borrarRespuesta } from "@/app/(app)/comunidad/pedir-ayuda/actions";
import { cn } from "@/lib/utils";

const C = COMUNIDAD_COPY.pedirAyuda.respuestas;

/**
 * =============================================================================
 * UNA RESPUESTA DEL HILO
 * =============================================================================
 *
 * Es lo más simple que puede ser, y eso es la decisión: nombre, cuándo, el
 * texto, y dos acciones chicas abajo. Sin avatar, sin puntaje, sin "me gusta",
 * sin responder-a-la-respuesta. Un hilo con métricas convierte ayudar en
 * competir, y anidar respuestas convierte un tablón en un foro — el cliente
 * pidió lo primero.
 *
 * ── EL TELÉFONO DE UNA OFICINA SE PUBLICA TAL CUAL ──────────────────────────
 * Y no es un olvido: el detector de datos de contacto NO corre sobre las
 * respuestas, a propósito (§6 de la 0130). La historia con la que el cliente
 * pidió esta sección es literalmente alguien pasando el número del consulado.
 * Lo que cubre al vivo que contesta "llamame al mío" es el botón de reportar
 * que está acá abajo, no un regex que además rompería el caso bueno.
 *
 * ── REPORTAR VA AL MISMO LUGAR QUE TODO LO DEMÁS ────────────────────────────
 * `<ReportSheet targetKind="profile">`, el flujo unificado de 2 taps. La RPC
 * `report_scam` (0014) tipa el objetivo en tres valores —listing, profile,
 * message— y ninguno es "respuesta": sumar uno significa tocar esa RPC, el
 * CHECK de `scam_reports` y la pausa automática por denuncias de la 0118, que
 * es donde vive el peso real de un reporte. Se reporta a la PERSONA que
 * escribió, con el pedido y el texto como contexto en `details`, que es lo que
 * el equipo lee. Es exactamente lo mismo que hace hoy el reporte de un producto
 * del Marketplace, y le llega al mismo lugar.
 *
 * ── BORRAR ES DEL AUTOR Y SE VE ─────────────────────────────────────────────
 * Una respuesta borrada no desaparece de la pantalla de quien la escribió: se
 * muestra tachada con "Borraste esta respuesta". Si desapareciera sin más,
 * borrar se sentiría como un error de carga.
 */
export function RespuestaItem({
  respuesta,
  tituloDelPedido,
  esAutorDelPedido,
}: {
  respuesta: HelpReply;
  /** Da contexto al equipo de moderación en el reporte. */
  tituloDelPedido: string;
  /** Quien escribió el pedido, marcado en su propio hilo. */
  esAutorDelPedido: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reportando, setReportando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [isPending, startTransition] = useTransition();

  const ocupado = enviando || isPending;
  const inactiva = respuesta.status !== "visible";

  async function borrar() {
    setEnviando(true);
    try {
      const resultado = await borrarRespuesta({ respuestaId: respuesta.id });
      if (!resultado.ok) {
        toast({ variant: "danger", title: resultado.error });
        return;
      }
      toast({ variant: "success", title: C.hecho.borrada });
      startTransition(() => router.refresh());
    } catch {
      toast({ variant: "danger", title: C.errors.borrar });
    } finally {
      setEnviando(false);
      setConfirmando(false);
    }
  }

  return (
    <article
      className={cn(
        "rounded-lg border border-border-subtle bg-surface p-4",
        inactiva && "opacity-60",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-foreground">{respuesta.authorName}</span>
        {esAutorDelPedido && (
          <Chip size="sm" variant="brand">
            {C.autorDelPedido}
          </Chip>
        )}
        <span className="text-xs text-foreground-muted">{respuesta.createdAtLabel}</span>
      </header>

      <p
        className={cn(
          "mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary",
          inactiva && "line-through",
        )}
      >
        {respuesta.body}
      </p>

      {/* Sólo lo ve su autor: la RLS no le manda a nadie más una fila inactiva. */}
      {inactiva && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-muted">
          {respuesta.status === "hidden" ? (
            <EyeSlash size={14} aria-hidden="true" />
          ) : (
            <Trash size={14} aria-hidden="true" />
          )}
          {respuesta.status === "hidden" ? C.oculta : C.borrada}
        </p>
      )}

      {!inactiva && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {respuesta.isOwner ? (
            confirmando ? (
              <>
                <span className="text-sm text-foreground-secondary">{C.confirmarBorrado}</span>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={ocupado}
                  aria-busy={ocupado}
                  onClick={borrar}
                >
                  {C.borrar}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => setConfirmando(false)}
                >
                  No
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmando(true)}
              >
                <Trash size={16} aria-hidden="true" />
                {C.borrar}
              </Button>
            )
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setReportando(true)}>
              <Flag size={16} aria-hidden="true" />
              {C.reportar.cta}
            </Button>
          )}
        </div>
      )}

      <ReportSheet
        open={reportando}
        onClose={() => setReportando(false)}
        targetKind="profile"
        targetId={respuesta.authorId}
        contextLabel={C.reportar.contexto(tituloDelPedido)}
        reasons={C.reportar.motivos}
      />
    </article>
  );
}
