"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui";

/**
 * Botón de submit para forms de server actions del panel: muestra el spinner
 * fino del design system mientras la action está en vuelo (useFormStatus).
 * En un form con dos decisiones (Aprobar/Rechazar) ambos quedan ocupados
 * durante el submit — nadie dispara la segunda decisión a mitad de la primera.
 */
export function PendingButton(props: ButtonProps) {
  const { pending } = useFormStatus();
  return <Button {...props} loading={pending || props.loading} />;
}
