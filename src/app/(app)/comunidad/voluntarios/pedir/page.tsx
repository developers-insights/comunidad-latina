import { Info } from "@phosphor-icons/react/dist/ssr";
import { Bubble } from "@/components/ui";
import { COMUNIDAD_ACCENT_VOLUNTARIOS } from "@/components/comunidad";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { PantallaDeRegistro } from "../../registros/pantalla";
import { PedirVoluntariosForm } from "./pedir-voluntarios-form";

export const metadata = { title: "Necesito voluntarios" };

const P = COMUNIDAD_COPY.registros.pedirVoluntarios;

/**
 * PEDIDO DE VOLUNTARIOS (0131).
 *
 * El aviso de que Comunidad Latina revisa de qué se trata va ARRIBA del
 * formulario y no en la confirmación: quien viene a buscar mano de obra gratis
 * tiene que enterarse antes de escribir, no después de que no le contestemos. Es
 * la misma doctrina que `<ReglasDeAyuda>` en el tablón.
 */
export default function PedirVoluntariosPage() {
  return (
    <PantallaDeRegistro
      kind="volunteer_request"
      ruta="/comunidad/voluntarios/pedir"
      title={P.title}
      subtitle={P.subtitle}
      abiertoBody={P.abiertoBody}
      aviso={
        <Bubble
          accent={COMUNIDAD_ACCENT_VOLUNTARIOS}
          tone="accentSoft"
          shape="tile"
          size="none"
          className="mb-5 flex items-start gap-2.5 p-4"
        >
          <Info
            size={18}
            weight="fill"
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[var(--bubble-ink)]"
          />
          <p className="text-sm leading-relaxed text-foreground-secondary">{P.aviso}</p>
        </Bubble>
      }
    >
      <PedirVoluntariosForm />
    </PantallaDeRegistro>
  );
}
