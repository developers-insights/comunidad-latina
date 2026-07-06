"use client";

import { useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const avatarVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center overflow-visible rounded-full bg-brand-100 align-middle font-display font-semibold text-brand-800 select-none",
  {
    variants: {
      size: {
        xs: "size-6 text-[10px]",
        sm: "size-8 text-xs",
        md: "size-10 text-sm",
        lg: "size-14 text-lg",
        xl: "size-20 text-2xl",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export interface AvatarProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof avatarVariants> {
  src?: string | null;
  /** Nombre completo — alimenta las iniciales de fallback y el aria-label. */
  name: string;
  /** Slot para badge de verificación (esquina inferior derecha, §3.3). */
  badge?: React.ReactNode;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({
  className,
  size,
  src,
  name,
  badge,
  ...props
}: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(src) && !broken;

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(avatarVariants({ size }), className)}
      {...props}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- tamaños chicos y fuentes externas variadas; el LCP no pasa por avatares
        <img
          src={src as string}
          alt=""
          className="size-full rounded-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-hidden="true">{initialsOf(name)}</span>
      )}
      {badge && (
        <span className="absolute -bottom-0.5 -right-0.5">{badge}</span>
      )}
    </span>
  );
}
