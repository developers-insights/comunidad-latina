import { cn } from "@/lib/utils";

/**
 * Skeleton con shimmer (§5.2) — la silueta del layout final, nunca un
 * spinner centrado. Componer varios para replicar la card real.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton rounded-md", className)}
      {...props}
    />
  );
}
