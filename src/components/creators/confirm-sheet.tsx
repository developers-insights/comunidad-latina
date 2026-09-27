"use client";

import { useId, useState } from "react";
import { BottomSheet, Button, Field, Textarea } from "@/components/ui";
import { FLOW_COPY } from "./flow-copy";

export interface ConfirmSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  loading?: boolean;
  note?: { label: string; placeholder: string; minLength?: number };
  onConfirm: (note: string) => void;
}

export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  tone = "primary",
  loading = false,
  note,
  onConfirm,
}: ConfirmSheetProps) {
  const noteId = useId();
  const [text, setText] = useState("");
  const min = note?.minLength ?? 10;
  const blocked = Boolean(note) && text.trim().length < min;

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        if (!loading) onClose();
      }}
      title={title}
      keyboardAware
    >
      <div className="flex flex-col gap-4 pb-2">
        {body && <p className="text-sm leading-relaxed text-foreground-secondary">{body}</p>}
        {note && (
          <Field htmlFor={noteId} label={note.label} help={`Al menos ${min} caracteres.`}>
            <Textarea
              id={noteId}
              rows={4}
              maxLength={2000}
              value={text}
              placeholder={note.placeholder}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
        )}
        <div className="flex flex-col gap-2">
          <Button
            variant={tone}
            size="lg"
            className="w-full active:scale-[0.98]"
            loading={loading}
            disabled={blocked}
            onClick={() => onConfirm(text.trim())}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" className="w-full" disabled={loading} onClick={onClose}>
            {FLOW_COPY.common.back}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
