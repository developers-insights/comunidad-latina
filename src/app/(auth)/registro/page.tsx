import { redirect } from "next/navigation";

export const metadata = { title: "Entrar" };

/**
 * El alta de cuentas nuevas está en pausa (todavía nadie puede crear una): esta
 * ruta ya no dibuja el formulario, redirige directo a /entrar. El mecanismo de
 * alta (`registerAction`, `RegistroClient`) queda intacto para reactivarlo el
 * día que corresponda — lo único que se apaga es el camino para llegar acá.
 */
export default function RegistroPage() {
  redirect("/entrar");
}
