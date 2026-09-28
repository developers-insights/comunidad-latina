"use client";

import { useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react/dist/ssr";
import { Input, type InputProps } from "@/components/ui";
import { cn } from "@/lib/utils";

const COPY = {
  show: "Mostrar contraseña",
  hide: "Ocultar contraseña",
} as const;

const iconClass =
  "absolute transition-[opacity,transform] duration-(--duration-fast) ease-(--ease-out-premium) motion-reduce:transition-none";

export type PasswordInputProps = Omit<InputProps, "type"> & {
  showLabel?: string;
  hideLabel?: string;
};

export function PasswordInput({
  className,
  showLabel = COPY.show,
  hideLabel = COPY.hide,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-12", className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        aria-controls={props.id}
        // 32px visuales, 44px tocables: el ::after agranda el área sin agrandar
        // el ícono, que si crece se come el campo y el dedo cae en el input.
        className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-foreground-muted transition-colors after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <Eye
          size={18}
          aria-hidden="true"
          className={cn(iconClass, visible ? "scale-75 opacity-0" : "scale-100 opacity-100")}
        />
        <EyeSlash
          size={18}
          aria-hidden="true"
          className={cn(iconClass, visible ? "scale-100 opacity-100" : "scale-75 opacity-0")}
        />
      </button>
    </div>
  );
}
