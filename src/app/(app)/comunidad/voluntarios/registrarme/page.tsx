import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { PantallaDeRegistro } from "../../registros/pantalla";
import { VoluntarioForm } from "./voluntario-form";

export const metadata = { title: "Anotarme como voluntario" };

const V = COMUNIDAD_COPY.registros.voluntario;

/**
 * ALTA DE VOLUNTARIO (0131).
 *
 * «El voluntario tiene que poder registrarse, pero esa lista no la ve nadie,
 *  solo la plataforma.» (Cliente, 2026-09-03, 39:20.)
 *
 * Server Component flaco a propósito: la sesión y el «¿ya te anotaste?» los
 * resuelve `<PantallaDeRegistro>`, que hace lo mismo en los cuatro formularios.
 * Acá sólo vive lo que es de éste.
 */
export default function RegistrarmeVoluntarioPage() {
  return (
    <PantallaDeRegistro
      kind="volunteer"
      ruta="/comunidad/voluntarios/registrarme"
      title={V.title}
      subtitle={V.subtitle}
      abiertoBody={V.abiertoBody}
    >
      <VoluntarioForm />
    </PantallaDeRegistro>
  );
}
