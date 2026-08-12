"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Avatar, BottomSheet, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { summarizeTagged, type TaggedProfile } from "@/lib/social/post-tags";
import { removeTagAction } from "@/app/(app)/feed/tag-actions";
import { TAGGER_COPY as COPY } from "./people-tagger-copy";

/**
 * "con Ana y 2 más" — las personas etiquetadas, bajo la cabecera de la card.
 *
 * DECISIÓN DE NAVEGACIÓN (la misma que ya rige el feed, ver la memoria del
 * proyecto): tocar esto NO saca a nadie del feed. Abre una hoja con la lista, y
 * recién ahí, con la intención explícita, aparece el link a cada perfil. Poner
 * el nombre como link directo convertiría un renglón informativo en una trampa
 * de navegación en medio del scroll.
 *
 * ES UN COMPONENTE CLIENTE PORQUE ABRE UNA HOJA, y por eso se monta como isla
 * dentro de la card —que es server y no puede tener hooks—, igual que
 * PostActions o PollYesNo. No pide datos: los recibe ya resueltos.
 *
 * Cuando el que mira ES una de las personas etiquetadas, la hoja le ofrece
 * quitarse. Ese botón no es una cortesía: la etiqueta es un dato sobre ella y
 * `post_tags_delete` (0089) la habilita explícitamente a borrar su propia fila.
 */

export interface TaggedPeopleProps {
  postId: string;
  people: TaggedProfile[];
  /** Id de quien mira. Habilita "quitarme" cuando está en la lista. */
  viewerId?: string | null;
  className?: string;
}

export function TaggedPeople({ postId, people, viewerId, className }: TaggedPeopleProps) {
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Nada que decir: no se pinta un renglón vacío ni un separador huérfano.
  if (people.length === 0) return null;

  // Optimista: al quitarse, la línea desaparece en el acto. Si el servidor
  // rechaza, se vuelve a mostrar CON el error — nunca se traga el fallo.
  const visible = removed ? people.filter((person) => person.id !== viewerId) : people;
  if (visible.length === 0) return null;

  const label = COPY.card.label(summarizeTagged(visible));
  const viewerIsTagged = Boolean(viewerId) && visible.some((person) => person.id === viewerId);

  const removeSelf = () => {
    setFailed(false);
    startTransition(async () => {
      const result = await removeTagAction({ postId });
      if (result.ok) {
        setRemoved(true);
        setOpen(false);
      } else {
        setFailed(true);
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={COPY.card.openAria}
        className={cn(
          // Área táctil de 44px sin que el renglón OCUPE 44px en la card: el
          // relleno vertical es chico y el alcance se estira con un
          // pseudo-elemento. Mismo truco que las miniaturas del composer.
          "relative inline-flex max-w-full items-center rounded-sm py-0.5 text-left",
          "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
          "text-xs text-foreground-secondary",
          "transition-colors duration-(--duration-fast) hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          className,
        )}
      >
        <span className="truncate">{label}</span>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={COPY.card.sheetTitle}>
        <ul className="flex flex-col gap-0.5 pb-2">
          {visible.map((person) => (
            <li key={person.id}>
              <Link
                href={`/perfil/${person.id}`}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5",
                  "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                <Avatar size="sm" name={person.displayName} src={person.avatarUrl} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {person.displayName}
                </span>
                <span className="shrink-0 text-xs text-foreground-muted">
                  {COPY.card.viewProfile}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {viewerIsTagged && (
          <div className="border-t border-border-subtle pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 w-full"
              onClick={removeSelf}
              disabled={isPending}
              loading={isPending}
            >
              {isPending ? COPY.card.removeSelfPending : COPY.card.removeSelf}
            </Button>
            {failed && (
              <p role="status" className="mt-2 text-xs font-medium text-danger">
                {COPY.card.removeSelfError}
              </p>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
