import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Lock, PencilSimple, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { Avatar, Banner, Chip, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/messaging/copy";
import {
  GroupDangerActions,
  GroupInvite,
  GroupMemberList,
} from "@/components/messaging/group-manage";
import {
  ETIQUETA_DE_CATEGORIA,
  administra,
  esCategoriaDeGrupo,
  miembrosLabel,
} from "@/lib/messaging/grupos";
import { listarMiembros, obtenerGrupo } from "../../queries";

export const metadata: Metadata = { title: COPY.groups.infoTitle };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /mensajes/grupos/[id]/info — la ficha del grupo, quién está adentro y lo que
 * puede hacer quien administra.
 *
 * ── EL ORDEN DE LA PANTALLA, Y DE DÓNDE SALE ────────────────────────────────
 * Cabecera grande (foto, nombre, "N miembros"), después la descripción, y
 * recién ahí la lista de gente y las acciones. Es la estructura de la info de
 * grupo de WhatsApp (https://mobbin.com/screens/fe36a6c4-14d5-4ae9-aa30-7f307ab83266):
 * primero "qué es esto", después "quién está", al final "qué puedo hacer".
 *
 * Lo que NO se copió: la fila de cuatro botones circulares (Audio, Video,
 * Add, Search) que la referencia pone debajo del nombre. Tres de esas cuatro
 * cosas no existen en este producto, y una fila de acciones donde la mitad no
 * anda es peor que no tenerla.
 *
 * PÁGINA propia y no una hoja modal: la lista de miembros puede tener cien
 * filas y necesita scroll propio, URL compartible y back del sistema.
 */
export default async function InfoDelGrupoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const grupo = await obtenerGrupo(id, user.id);
  if (!grupo) notFound();

  // La info del grupo es para quien está adentro. Quien no es miembro va al
  // chat, que es la pantalla que sí le corresponde (ficha + botón de unirse).
  if (grupo.miRol === null) redirect(`/mensajes/grupos/${grupo.id}`);

  const miembros = await listarMiembros(grupo.id);
  const puedoAdministrar = administra(grupo.miRol);
  const categoria = esCategoriaDeGrupo(grupo.category)
    ? ETIQUETA_DE_CATEGORIA[grupo.category]
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Cabecera */}
      <header className="flex flex-col items-center gap-3 text-center">
        <Avatar src={grupo.avatar_url} name={grupo.name} size="xl" />
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
            {grupo.name}
          </h1>
          <p className="mt-0.5 text-sm text-foreground-muted">
            {miembrosLabel(grupo.member_count)}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {categoria && (
            <Chip size="sm" variant="brand">
              {categoria}
            </Chip>
          )}
          {grupo.visibility === "private" && (
            <Chip size="sm" icon={<Lock size={14} />}>
              {COPY.groups.privateBadge}
            </Chip>
          )}
        </div>

        <Link
          href={`/mensajes/grupos/${grupo.id}`}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        >
          <UsersThree size={16} aria-hidden="true" />
          Ir al chat
        </Link>
      </header>

      {grupo.status === "closed" && (
        <Banner variant="offline" className="rounded-lg">
          {COPY.groups.closedBanner}
        </Banner>
      )}

      {grupo.description && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-secondary">
          {grupo.description}
        </p>
      )}

      {puedoAdministrar && grupo.status === "active" && (
        <Link
          href={`/mensajes/grupos/${grupo.id}/editar`}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
        >
          <PencilSimple size={18} aria-hidden="true" />
          {COPY.groups.edit}
        </Link>
      )}

      {puedoAdministrar && grupo.status === "active" && (
        <section>
          <h2 className="mb-2 font-display text-base font-semibold text-foreground">
            {COPY.groups.invite}
          </h2>
          <GroupInvite groupId={grupo.id} />
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-base font-semibold text-foreground">
          {COPY.groups.membersTitle}
        </h2>
        <GroupMemberList
          groupId={grupo.id}
          miId={user.id}
          miRol={grupo.miRol}
          miembros={miembros.map((miembro) => ({
            profileId: miembro.profileId,
            role: miembro.role,
            displayName: miembro.displayName,
            avatarUrl: miembro.avatarUrl,
          }))}
        />
      </section>

      <section className="border-t border-border-subtle pt-5">
        <GroupDangerActions
          groupId={grupo.id}
          miRol={grupo.miRol}
          cerrado={grupo.status === "closed"}
        />
      </section>
    </div>
  );
}
