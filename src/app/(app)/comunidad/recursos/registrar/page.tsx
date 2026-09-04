import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { PantallaDeRegistro } from "../../registros/pantalla";
import { LugarForm } from "./lugar-form";

export const metadata = { title: "Registrar mi lugar" };

const L = COMUNIDAD_COPY.registros.lugar;

/**
 * ALTA DE UN LUGAR DEL DIRECTORIO (0131).
 *
 * Vive bajo `/comunidad/recursos` y no bajo una sección propia porque es la
 * puerta de entrada de ESE directorio: se llega desde el vacío de «Bancos de
 * comida» y de «Centro de acopio», que son las dos tarjetas que hoy están
 * vacías y que este formulario existe para empezar a llenar.
 *
 * El aviso de que el lugar SÍ se publica si el equipo lo aprueba no va acá
 * arriba sino pegado al campo de teléfono, dentro del formulario: es ahí donde
 * alguien duda si dejarlo.
 */
export default function RegistrarLugarPage() {
  return (
    <PantallaDeRegistro
      kind="place"
      ruta="/comunidad/recursos/registrar"
      title={L.title}
      subtitle={L.subtitle}
      abiertoBody={L.abiertoBody}
    >
      <LugarForm />
    </PantallaDeRegistro>
  );
}
