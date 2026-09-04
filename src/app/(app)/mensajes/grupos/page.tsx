import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/messaging/copy";
import { GroupCard } from "@/components/messaging/group-card";
import { GroupJoinButton } from "@/components/messaging/group-join-button";
import { InboxTabs } from "@/components/messaging/inbox-tabs";
import {
  CATEGORIAS_DE_GRUPO,
  ETIQUETA_DE_CATEGORIA,
  esCategoriaDeGrupo,
} from "@/lib/messaging/grupos";
import { listarGruposPublicos, listarMisGrupos } from "./queries";

export const metadata: Metadata = { title: COPY.groups.title };

/**
 * /mensajes/grupos — la pestaña Grupos de la bandeja.
 *
 * DOS listas y en este orden: primero "Tus grupos" (a lo que ya pertenecés,
 * que es a lo que venís a entrar) y después "Para sumarte". La segunda excluye
 * los que ya son míos: una lista de descubrimiento que muestra grupos donde ya
 * estás es una lista que miente.
 *
 * El filtro por tema es una fila de chips que NAVEGAN (`?tema=`) y no un
 * estado de cliente: así el filtro se comparte, sobrevive al back del sistema
 * y no obliga a bajar los cuarenta grupos para mostrar cinco.
 */
export default async function GruposPage({
  searchParams,
}: {
  searchParams: Promise<{ tema?: string }>;
}) {
  const [{ tema }, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/entrar");

  const categoria = esCategoriaDeGrupo(tema) ? tema : null;

  const mios = await listarMisGrupos(user.id);
  const publicos = await listarGruposPublicos({
    categoria,
    excluir: mios.map((g) => g.id),
  });

  const miosVisibles = categoria
    ? mios.filter((grupo) => grupo.category === categoria)
    : mios;

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.inbox.title}
        </h1>
        <Link
          href="/mensajes/grupos/nuevo"
          className={cn(buttonVariants({ variant: "primary", size: "sm" }), "shrink-0")}
        >
          <Plus size={16} weight="bold" aria-hidden="true" />
          {COPY.groups.create}
        </Link>
      </div>

      <InboxTabs active="grupos" />

      {/* Filtro por tema. `scrollbar-none` + scroll horizontal: nueve chips no
          entran en 375px, y esconderlos detrás de un "Más" tapa justo la forma
          de encontrar un grupo. */}
      <nav aria-label={COPY.groups.filterLabel} className="mb-5">
        <ul className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
          <li className="shrink-0">
            <ChipLink href="/mensajes/grupos" activo={categoria === null}>
              {COPY.groups.allCategories}
            </ChipLink>
          </li>
          {CATEGORIAS_DE_GRUPO.map((valor) => (
            <li key={valor} className="shrink-0">
              <ChipLink
                href={`/mensajes/grupos?tema=${valor}`}
                activo={categoria === valor}
              >
                {ETIQUETA_DE_CATEGORIA[valor]}
              </ChipLink>
            </li>
          ))}
        </ul>
      </nav>

      <section className="mb-8">
        <h2 className="mb-3 font-display text-base font-semibold text-foreground">
          {COPY.groups.mine}
        </h2>
        {miosVisibles.length === 0 ? (
          <EmptyState
            title={COPY.groups.emptyMineTitle}
            message={COPY.groups.emptyMineMessage}
            action={
              <Link
                href="/mensajes/grupos/nuevo"
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                {COPY.groups.create}
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {miosVisibles.map((grupo) => (
              <GroupCard
                key={grupo.id}
                grupo={grupo}
                href={`/mensajes/grupos/${grupo.id}`}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-base font-semibold text-foreground">
          {COPY.groups.discover}
        </h2>
        {publicos.length === 0 ? (
          <EmptyState
            title={COPY.groups.emptyDiscoverTitle}
            message={COPY.groups.emptyDiscoverMessage}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {publicos.map((grupo) => (
              <GroupCard
                key={grupo.id}
                grupo={grupo}
                href={`/mensajes/grupos/${grupo.id}`}
                action={<GroupJoinButton groupId={grupo.id} />}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * Chip que navega. No usa `<Chip>` de ui porque ese es un `<span>` decorativo:
 * lo que hace falta acá es un enlace con estado y con área táctil de 44px
 * (§3.2), y envolver un span en un link duplicaría los estilos de foco.
 */
function ChipLink({
  href,
  activo,
  children,
}: {
  href: string;
  activo: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={activo ? "page" : undefined}
      scroll={false}
      className={cn(
        "inline-flex h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium",
        "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        activo
          ? "border-brand-strong bg-brand-tint text-brand-ink"
          : "border-border-subtle bg-surface text-foreground-secondary hover:border-border-strong hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
