import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";

export default function CobrosLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTopBar fallbackHref="/creadores/perfil" />
      {children}
    </>
  );
}
