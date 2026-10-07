import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

/*
 * Siluetas de pantalla completa para los `loading.tsx` y para los fallbacks de
 * `<Suspense>` de las páginas de detalle. Las alturas son las de las pantallas
 * reales (título 32px, input 48px, chip 44px) para que al llegar el contenido
 * no haya salto. El shimmer ya respeta prefers-reduced-motion por la regla
 * global de globals.css.
 */

export function SkeletonScreen({
  className,
  label = "Cargando…",
  children,
}: {
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Misma caja que `SectionTopBar`, para las pantallas que la dibujan dentro de la página y no en un layout. */
export function TopBarSkeleton({ withTitle = false }: { withTitle?: boolean }) {
  return (
    <div className="-mx-4 -mt-4 mb-3 flex min-h-12 items-center gap-2 border-b border-border-subtle px-2">
      <Skeleton className="h-8 w-20 rounded-full" />
      {withTitle && <Skeleton className="h-4 w-40" />}
    </div>
  );
}

export function ScreenHeaderSkeleton({
  subtitle = true,
  className,
}: {
  subtitle?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("mb-5", className)}>
      <Skeleton className="h-8 w-3/5 max-w-64" />
      {subtitle && <Skeleton className="mt-2 h-4 w-4/5 max-w-80" />}
    </div>
  );
}

/** Cabecera tipo burbuja de sección (ícono + título + bajada), la de Buscar y los módulos de Comunidad. */
export function SectionHeadingSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3",
        className,
      )}
    >
      <Skeleton className="size-14 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-2 h-4 w-full" />
      </div>
    </div>
  );
}

export function TabsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="mb-4 flex gap-2">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-11 rounded-full", index === 1 ? "w-28" : "w-24")}
        />
      ))}
    </div>
  );
}

export function FormSkeleton({
  fields = 5,
  textareaAt = [],
  submit = true,
  className,
}: {
  fields?: number;
  textareaAt?: number[];
  submit?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton
            className={cn(
              "w-full rounded-lg",
              textareaAt.includes(index) ? "h-28" : "h-12",
            )}
          />
        </div>
      ))}
      {submit && <Skeleton className="mt-1 h-12 w-full rounded-full" />}
    </div>
  );
}

export function FormScreenSkeleton({
  topBar = false,
  header = true,
  intro,
  fields = 5,
  textareaAt,
  submit,
  label,
}: {
  topBar?: boolean;
  header?: boolean;
  intro?: ReactNode;
  fields?: number;
  textareaAt?: number[];
  submit?: boolean;
  label?: string;
}) {
  return (
    <SkeletonScreen label={label}>
      {topBar && <TopBarSkeleton />}
      {header && <ScreenHeaderSkeleton className="mb-6" />}
      {intro}
      <FormSkeleton fields={fields} textareaAt={textareaAt} submit={submit} />
    </SkeletonScreen>
  );
}

export function RowCardSkeleton({
  avatar = true,
  className,
}: {
  avatar?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border-subtle bg-surface p-4 shadow-xs",
        className,
      )}
    >
      {avatar && <Skeleton className="size-10 shrink-0 rounded-full" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-2 h-3 w-1/2" />
      </div>
    </div>
  );
}

export function MediaCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-xs",
        className,
      )}
    >
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

export function ListScreenSkeleton({
  topBar = false,
  header = "text",
  tabs = 0,
  rows = 4,
  variant = "row",
}: {
  topBar?: boolean;
  header?: "text" | "section" | "none";
  tabs?: number;
  rows?: number;
  variant?: "row" | "media" | "block";
}) {
  return (
    <SkeletonScreen>
      {topBar && <TopBarSkeleton />}
      {header === "text" && <ScreenHeaderSkeleton />}
      {header === "section" && <SectionHeadingSkeleton className="mb-5" />}
      {tabs > 0 && <TabsSkeleton count={tabs} />}
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, index) =>
          variant === "media" ? (
            <MediaCardSkeleton key={index} />
          ) : variant === "block" ? (
            <Skeleton key={index} className="h-24 w-full rounded-lg" />
          ) : (
            <RowCardSkeleton key={index} />
          ),
        )}
      </div>
    </SkeletonScreen>
  );
}

export function SettingsRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-4">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="mt-2 h-3 w-4/5" />
          </div>
          <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SettingsScreenSkeleton({
  topBar = false,
  sections = 2,
  rows = 4,
}: {
  topBar?: boolean;
  sections?: number;
  rows?: number;
}) {
  return (
    <SkeletonScreen className="flex flex-col gap-6">
      {topBar && <TopBarSkeleton />}
      <ScreenHeaderSkeleton className="mb-0" />
      {Array.from({ length: sections }, (_, index) => (
        <section key={index}>
          <Skeleton className="mb-2 ml-1 h-3 w-24" />
          <SettingsRowsSkeleton rows={rows} />
        </section>
      ))}
    </SkeletonScreen>
  );
}

export function SearchScreenSkeleton() {
  return (
    <SkeletonScreen>
      <SectionHeadingSkeleton />
      <Skeleton className="mt-3 h-12 w-full rounded-full" />
      <Skeleton className="mb-2 ml-1 mt-5 h-3 w-24" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="aspect-square w-full rounded-lg" />
        ))}
      </div>
    </SkeletonScreen>
  );
}

/** Texto largo con secciones: términos, guías, pantallas informativas de Escudo. */
export function ArticleScreenSkeleton({
  topBar = false,
  hero = false,
  sections = 3,
}: {
  topBar?: boolean;
  hero?: boolean;
  sections?: number;
}) {
  return (
    <SkeletonScreen>
      {topBar && <TopBarSkeleton />}
      {hero && <Skeleton className="mb-4 aspect-video w-full rounded-xl" />}
      <ScreenHeaderSkeleton />
      <div className="flex flex-col gap-6 rounded-xl border border-border-subtle bg-surface p-5">
        {Array.from({ length: sections }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}

/** Detalle de aviso con galería (marketplace, propiedades, eventos, negocios, empleos, profesionales). */
export function DetailScreenSkeleton({
  gallery = "photo",
  facts = 3,
  action = true,
  topBar = true,
}: {
  gallery?: "photo" | "hero" | "none";
  facts?: number;
  action?: boolean;
  topBar?: boolean;
}) {
  return (
    <SkeletonScreen className="pb-24">
      {topBar && <TopBarSkeleton withTitle />}
      {gallery === "photo" && <Skeleton className="aspect-[4/3] w-full rounded-xl" />}
      {gallery === "hero" && <Skeleton className="aspect-video w-full rounded-xl" />}
      <Skeleton className={cn("h-7 w-4/5", gallery === "none" ? "mt-1" : "mt-4")} />
      <Skeleton className="mt-3 h-6 w-28" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
      </div>
      {facts > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          {Array.from({ length: facts }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}
      <div className="mt-5 flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <div className="mt-5 flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      </div>
      {action && <Skeleton className="mt-5 h-12 w-full rounded-full" />}
    </SkeletonScreen>
  );
}

/** Perfil de persona, creador o profesional: portada, avatar, contadores, acciones y grilla. */
export function ProfileScreenSkeleton({
  cover = true,
  grid = true,
}: {
  cover?: boolean;
  grid?: boolean;
}) {
  return (
    <SkeletonScreen className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3">
        {cover && <Skeleton className="-mx-4 h-32 w-[calc(100%+2rem)] rounded-none" />}
        <Skeleton
          className={cn("size-20 rounded-full", cover && "-mt-12 border-4 border-canvas")}
        />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-28" />
        <div className="flex justify-center gap-8">
          <Skeleton className="h-10 w-16 rounded-lg" />
          <Skeleton className="h-10 w-16 rounded-lg" />
          <Skeleton className="h-10 w-16 rounded-lg" />
        </div>
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
      {grid && (
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="aspect-square w-full rounded-lg" />
          ))}
        </div>
      )}
    </SkeletonScreen>
  );
}

/** Publicación abierta: barra de volver, card del post y comentarios. */
export function PostDetailSkeleton() {
  return (
    <SkeletonScreen>
      <div className="mb-4 flex items-center">
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-xs">
        <Skeleton className="aspect-[4/5] w-full rounded-none" />
        <div className="flex items-center gap-2.5 p-4 pb-0">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-1.5 h-3 w-16" />
          </div>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/5" />
          <div className="mt-2 flex gap-4">
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-6 w-12" />
          </div>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-4 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}

/** Conversación (directa o de grupo): encabezado, burbujas alternadas y caja de escribir. */
export function ChatScreenSkeleton({
  group = false,
  header = true,
}: {
  group?: boolean;
  header?: boolean;
}) {
  const widths = ["w-3/5", "w-2/5", "w-4/5", "w-1/2", "w-2/3"];
  return (
    <SkeletonScreen className="flex min-h-[70dvh] flex-col">
      {header && (
        <div className="-mx-4 -mt-4 flex min-h-14 items-center gap-3 border-b border-border-subtle px-4">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <Skeleton className={cn("size-10 shrink-0 rounded-full", group && "rounded-xl")} />
          <div className="flex-1">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-1.5 h-3 w-20" />
          </div>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-3 py-4">
        {widths.map((width, index) => (
          <Skeleton
            key={index}
            className={cn(
              "h-12 rounded-2xl",
              width,
              index % 2 === 1 && "self-end",
            )}
          />
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-full" />
    </SkeletonScreen>
  );
}

/** Estadísticas de un aviso o campaña: tarjetas de números, gráfico y filas. */
export function StatsScreenSkeleton({ topBar = true }: { topBar?: boolean }) {
  return (
    <SkeletonScreen className="flex flex-col gap-6 pb-8">
      {topBar && <TopBarSkeleton />}
      <ScreenHeaderSkeleton className="mb-0" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    </SkeletonScreen>
  );
}

/** Pantalla del panel de administración: encabezado de 2xl, filtros opcionales y filas de trabajo. */
export function AdminScreenSkeleton({
  back = false,
  tabs = 0,
  rows = 4,
}: {
  back?: boolean;
  tabs?: number;
  rows?: number;
}) {
  return (
    <SkeletonScreen className="flex flex-col gap-4">
      <div>
        {back && <Skeleton className="mb-1 h-11 w-36 rounded-full" />}
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="mt-2 h-4 w-full max-w-lg" />
      </div>
      {tabs > 0 && (
        <div className="flex gap-2">
          {Array.from({ length: tabs }, (_, index) => (
            <Skeleton key={index} className="h-11 w-24 rounded-full" />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="h-4 w-4/5" />
            <div className="flex gap-2">
              <Skeleton className="h-11 w-24 rounded-full" />
              <Skeleton className="h-11 w-24 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
