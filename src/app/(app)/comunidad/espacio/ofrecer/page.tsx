import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { PantallaDeRegistro } from "../../registros/pantalla";
import { EspacioForm } from "./espacio-form";

export const metadata = { title: "Ofrecer mi espacio" };

const E = COMUNIDAD_COPY.registros.espacio;

/** ALTA DE UN ESPACIO COMUNITARIO (0131). Sin listado público: sólo el equipo lo ve. */
export default function OfrecerEspacioPage() {
  return (
    <PantallaDeRegistro
      kind="space"
      ruta="/comunidad/espacio/ofrecer"
      title={E.title}
      subtitle={E.subtitle}
      abiertoBody={E.abiertoBody}
    >
      <EspacioForm />
    </PantallaDeRegistro>
  );
}
