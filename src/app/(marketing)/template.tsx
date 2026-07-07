import type { ReactNode } from "react";
import { PageTransition } from "@/components/experience/page-transition";

/**
 * Template del área pública: el header y footer del layout persisten; sólo el
 * contenido cruza el fade entre landing y guías.
 */
export default function MarketingTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
