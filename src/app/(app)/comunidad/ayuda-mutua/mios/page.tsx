import { permanentRedirect } from "next/navigation";

/** "Mis avisos de ayuda" → "Mis pedidos". Ver el redirect de la carpeta padre. */
export default function MisAvisosRedirect() {
  permanentRedirect("/comunidad/pedir-ayuda/mios");
}
