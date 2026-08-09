import type { ReactNode } from "react";
import { GlobalSubnav } from "@/components/admin/global-subnav";
import { requireStaff } from "../guard";

/**
 * Shell del panel Global. El gate va acá ADEMÁS de en cada página: un layout
 * que verifica el rol cubre de una vez a todas las pantallas del segmento,
 * incluidas las que se agreguen después y a las que alguien se olvide de
 * ponerle el suyo. Las páginas igual llaman a `requireStaff` porque necesitan
 * el contexto (cliente, rol, tenant) — no porque este chequeo alcance solo.
 */
export default async function GlobalLayout({ children }: { children: ReactNode }) {
  await requireStaff("global_admin");

  return (
    <div>
      <GlobalSubnav />
      {children}
    </div>
  );
}
