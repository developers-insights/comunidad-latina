"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SignOut, UserMinus, XCircle } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Avatar, Badge, Button, Dialog, useToast } from "@/components/ui";
import {
  cerrarGrupoAction,
  expulsarDelGrupoAction,
  invitarAlGrupoAction,
  salirDelGrupoAction,
} from "@/app/(app)/mensajes/grupos/actions";
import { administra, type RolEnGrupo } from "@/lib/messaging/grupos";
import { COPY } from "./copy";
import { PeopleSearch, type PersonaEncontrada } from "./people-search";

export type MiembroVisible = {
  profileId: string;
  role: RolEnGrupo;
  displayName: string;
  avatarUrl: string | null;
};

/**
 * LISTA DE MIEMBROS con la acción de sacar a alguien.
 *
 * La forma —foto, nombre, y el rol como dato menor a la derecha— sale de la
 * lista de participantes de la info de grupo de WhatsApp
 * (https://mobbin.com/screens/fe36a6c4-14d5-4ae9-aa30-7f307ab83266).
 *
 * Lo que NO se copió: ahí sacar a alguien está detrás de un toque largo sobre
 * la fila. Un gesto invisible es exactamente el problema que el cliente
 * reportó en el editor de fotos («si lo mueves un poquitico, se cierra todo»),
 * así que acá es un botón con nombre, visible sólo para quien administra.
 */
export function GroupMemberList({
  groupId,
  miembros,
  miId,
  miRol,
}: {
  groupId: string;
  miembros: MiembroVisible[];
  miId: string;
  miRol: RolEnGrupo | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [aSacar, setASacar] = useState<MiembroVisible | null>(null);
  const [enviando, startTransition] = useTransition();

  const puedoAdministrar = administra(miRol);

  function sacar(miembro: MiembroVisible) {
    startTransition(async () => {
      const resultado = await expulsarDelGrupoAction({
        groupId,
        profileId: miembro.profileId,
      });
      setASacar(null);

      if (resultado.ok) {
        toast({ title: COPY.groups.removed });
        router.refresh();
        return;
      }
      toast({ title: COPY.groups.removeError, variant: "danger" });
    });
  }

  return (
    <>
      <ul className="flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface">
        {miembros.map((miembro, index) => {
          const soyYo = miembro.profileId === miId;
          // Al owner no lo saca nadie (la policy de la 0133 también lo impide),
          // y nadie se saca a sí mismo desde acá: para eso está "Salir".
          const sePuedeSacar =
            puedoAdministrar && !soyYo && miembro.role !== "owner";

          return (
            <li
              key={miembro.profileId}
              className={cn(
                "flex items-center gap-3 p-3",
                index > 0 && "border-t border-border-subtle",
              )}
            >
              <Avatar src={miembro.avatarUrl} name={miembro.displayName} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {soyYo ? COPY.groups.you : miembro.displayName}
                </p>
                {miembro.role !== "member" && (
                  <p className="text-xs text-foreground-muted">
                    {miembro.role === "owner"
                      ? COPY.groups.roleOwner
                      : COPY.groups.roleAdmin}
                  </p>
                )}
              </div>

              {miembro.role === "owner" && (
                <Badge variant="neutral">{COPY.groups.roleOwner}</Badge>
              )}

              {sePuedeSacar && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={COPY.groups.removeConfirmTitle(miembro.displayName)}
                  onClick={() => setASacar(miembro)}
                >
                  <UserMinus size={18} aria-hidden="true" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={aSacar !== null}
        onClose={() => setASacar(null)}
        highRisk
        title={aSacar ? COPY.groups.removeConfirmTitle(aSacar.displayName) : ""}
        description={COPY.groups.removeConfirmBody}
        footer={
          <>
            <Button variant="outline" onClick={() => setASacar(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={enviando}
              onClick={() => aSacar && sacar(aSacar)}
            >
              {COPY.groups.removeConfirm}
            </Button>
          </>
        }
      />
    </>
  );
}

/**
 * INVITAR: el mismo buscador de personas de la bandeja, con otra acción.
 * Reusarlo no es sólo ahorro de código — es que las dos pantallas se comporten
 * igual (mismo debounce, misma cancelación, mismos resultados sin bloqueados).
 */
export function GroupInvite({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function invitar(persona: PersonaEncontrada) {
    if (ocupadoId) return;
    setOcupadoId(persona.id);

    startTransition(async () => {
      const resultado = await invitarAlGrupoAction({
        groupId,
        profileId: persona.id,
      });
      setOcupadoId(null);

      if (resultado.ok) {
        toast({ title: COPY.groups.invited(persona.displayName) });
        router.refresh();
        return;
      }
      if (resultado.code === "duplicate") {
        toast({ title: COPY.groups.alreadyMember, variant: "warning" });
        return;
      }
      if (resultado.code === "rate-limited") {
        toast({
          title: COPY.composer.rateLimitedTitle,
          description: COPY.composer.rateLimitedBody,
          variant: "warning",
        });
        return;
      }
      toast({ title: COPY.groups.inviteError, variant: "danger" });
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-foreground-secondary">{COPY.groups.inviteHelp}</p>
      <PeopleSearch
        onElegir={invitar}
        ocupadoId={ocupadoId}
        etiquetaAccion={COPY.groups.join}
      />
    </div>
  );
}

/**
 * SALIR y CERRAR, las dos al pie y con confirmación.
 *
 * No están arriba con el resto de las acciones a propósito: son las únicas dos
 * de esta pantalla que no se deshacen de un toque, y ponerlas al final es lo
 * que evita el toque por accidente mientras se lee la lista de miembros.
 */
export function GroupDangerActions({
  groupId,
  miRol,
  cerrado,
}: {
  groupId: string;
  miRol: RolEnGrupo | null;
  cerrado: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirmando, setConfirmando] = useState<"salir" | "cerrar" | null>(null);
  const [enviando, startTransition] = useTransition();

  const soyOwner = miRol === "owner";

  function salir() {
    startTransition(async () => {
      const resultado = await salirDelGrupoAction(groupId);
      setConfirmando(null);

      if (resultado.ok) {
        toast({ title: COPY.groups.left });
        router.push("/mensajes/grupos");
        router.refresh();
        return;
      }
      toast({
        title:
          resultado.code === "forbidden"
            ? COPY.groups.ownerCannotLeave
            : COPY.groups.leaveError,
        variant: "warning",
      });
    });
  }

  function cerrar() {
    startTransition(async () => {
      const resultado = await cerrarGrupoAction(groupId);
      setConfirmando(null);

      if (resultado.ok) {
        toast({ title: COPY.groups.closed });
        router.refresh();
        return;
      }
      toast({ title: COPY.groups.closeError, variant: "danger" });
    });
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {soyOwner ? (
          // El owner no puede salir (policy 0133): se le dice por qué, en vez
          // de darle un botón que va a fallar.
          <p className="rounded-lg border border-border-subtle bg-surface-subtle p-3 text-sm text-foreground-secondary">
            {COPY.groups.ownerCannotLeave}
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="md"
            className="w-full"
            onClick={() => setConfirmando("salir")}
          >
            <SignOut size={18} aria-hidden="true" />
            {COPY.groups.leave}
          </Button>
        )}

        {administra(miRol) && !cerrado && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="w-full text-danger"
            onClick={() => setConfirmando("cerrar")}
          >
            <XCircle size={18} aria-hidden="true" />
            {COPY.groups.close}
          </Button>
        )}
      </div>

      <Dialog
        open={confirmando !== null}
        onClose={() => setConfirmando(null)}
        highRisk
        title={
          confirmando === "cerrar"
            ? COPY.groups.closeConfirmTitle
            : COPY.groups.leaveConfirmTitle
        }
        description={
          confirmando === "cerrar"
            ? COPY.groups.closeConfirmBody
            : COPY.groups.leaveConfirmBody
        }
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmando(null)}
              disabled={enviando}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={enviando}
              onClick={() => (confirmando === "cerrar" ? cerrar() : salir())}
            >
              {confirmando === "cerrar"
                ? COPY.groups.closeConfirm
                : COPY.groups.leaveConfirm}
            </Button>
          </>
        }
      />
    </>
  );
}
