import { Flask } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/**
 * Sello "Modo demostración" (decisión de producto: los pagos corren en demo en
 * esta fase — la máquina de estados es real, el dinero no se mueve). Honesto por
 * diseño: aparece en cada pantalla de contrato para que nadie crea que ya cobra.
 */
export function DemoSeal({ className }: { className?: string }) {
  return (
    <Badge variant="neutral" className={cn("shrink-0", className)}>
      <Flask size={12} weight="fill" aria-hidden="true" />
      {COPY.contract.demoSeal}
    </Badge>
  );
}
