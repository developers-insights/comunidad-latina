import { Info, Warning, WifiSlash } from "@phosphor-icons/react/dist/ssr";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Banner de estado (§3.4): informa sin bloquear. El variant `offline`
 * acompaña el modo "mostrando lo último guardado".
 */
const bannerVariants = cva("flex items-start gap-3 px-4 py-3 text-sm", {
  variants: {
    variant: {
      info: "bg-info-bg text-foreground",
      warning: "bg-warning-bg text-foreground",
      offline: "bg-surface-subtle text-foreground-secondary",
    },
  },
  defaultVariants: {
    variant: "info",
  },
});

const DEFAULT_ICON: Record<
  NonNullable<VariantProps<typeof bannerVariants>["variant"]>,
  React.ReactNode
> = {
  info: <Info size={20} className="text-info" />,
  warning: <Warning size={20} className="text-warning" />,
  offline: <WifiSlash size={20} />,
};

export interface BannerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bannerVariants> {
  /** Reemplaza el ícono default del variant. */
  icon?: React.ReactNode;
  /** Acción opcional a la derecha (link o botón ghost chico). */
  action?: React.ReactNode;
}

export function Banner({
  className,
  variant,
  icon,
  action,
  children,
  ...props
}: BannerProps) {
  return (
    <div
      role="status"
      className={cn(bannerVariants({ variant }), className)}
      {...props}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        {icon ?? DEFAULT_ICON[variant ?? "info"]}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
