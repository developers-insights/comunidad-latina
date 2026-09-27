"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { File as FileIcon, PaperPlaneTilt, Paperclip, X } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, Field, ProgressBar, Textarea, useToast } from "@/components/ui";
import { prepareDeliveryUpload, submitDelivery } from "@/app/(app)/creadores/colaboraciones/actions";
import {
  DELIVERY_BUCKET,
  DELIVERY_MIME_TYPES,
  MAX_FILES_PER_DELIVERY,
  isAllowedDeliveryFile,
} from "@/lib/creators/delivery-files";
import { createClient } from "@/lib/supabase/client";
import { FLOW_COPY } from "./flow-copy";

const D = FLOW_COPY.delivery;

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DeliverySheet({ contractId, open, onClose }: { contractId: string; open: boolean; onClose: () => void }) {
  const inputId = useId();
  const noteId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  function pick(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const rejected = incoming.find((f) => !isAllowedDeliveryFile(f));
    if (rejected) setError(D.badType(rejected.name));
    else setError(null);
    const merged = [...files, ...incoming.filter((f) => isAllowedDeliveryFile(f))];
    if (merged.length > MAX_FILES_PER_DELIVERY) setError(D.tooMany);
    setFiles(merged.slice(0, MAX_FILES_PER_DELIVERY));
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit() {
    if (files.length === 0 || busy) return;
    setError(null);
    setProgress({ done: 0, total: files.length });
    try {
      const prepared = await prepareDeliveryUpload(
        contractId,
        files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      );
      if (!prepared.ok) {
        setError(prepared.error);
        if (prepared.stale) router.refresh();
        return;
      }
      const supabase = createClient();
      for (let i = 0; i < prepared.uploads.length; i += 1) {
        const upload = prepared.uploads[i];
        const file = files[i];
        const { error: uploadError } = await supabase.storage
          .from(DELIVERY_BUCKET)
          .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type });
        if (uploadError) {
          console.error("[entrega] falló la subida", uploadError.message);
          setError(D.uploadFailed(file.name));
          return;
        }
        setProgress({ done: i + 1, total: files.length });
      }
      const result = await submitDelivery(contractId, {
        version: prepared.version,
        paths: prepared.uploads.map((u) => u.path),
        note,
      });
      if (!result.ok) {
        setError(result.error);
        if (result.stale) router.refresh();
        return;
      }
      toast({ variant: "success", title: D.done });
      setFiles([]);
      setNote("");
      onClose();
      router.refresh();
    } catch (err) {
      console.error("[entrega] error inesperado", err);
      setError(FLOW_COPY.generic);
    } finally {
      setProgress(null);
    }
  }

  return (
    <BottomSheet open={open} onClose={() => !busy && onClose()} title={D.title} size="tall" keyboardAware>
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-sm leading-relaxed text-foreground-secondary">{D.intro}</p>

        <label
          htmlFor={inputId}
          className="group flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-surface-subtle px-4 py-6 text-center transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-border-strong"
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-surface ring-1 ring-border transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-translate-y-0.5">
            <Paperclip size={20} aria-hidden="true" className="text-foreground-secondary" />
          </span>
          <span className="text-sm font-semibold text-foreground">{D.pick}</span>
          <span className="text-xs text-foreground-muted">{D.pickHint}</span>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            multiple
            accept={DELIVERY_MIME_TYPES.join(",")}
            className="sr-only"
            disabled={busy}
            onChange={(event) => pick(event.target.files)}
          />
        </label>

        {files.length > 0 && (
          <ul className="flex flex-col gap-2">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center gap-3 rounded-xl bg-surface-subtle px-3 py-2">
                <FileIcon size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{file.name}</span>
                <span className="numeric shrink-0 text-xs text-foreground-muted">{sizeLabel(file.size)}</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={D.remove(file.name)}
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                  className="rounded-full p-1 text-foreground-muted hover:text-foreground disabled:opacity-40"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Field htmlFor={noteId} label={D.note} optional>
          <Textarea
            id={noteId}
            rows={3}
            maxLength={2000}
            value={note}
            placeholder={D.notePlaceholder}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>

        {progress && (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <ProgressBar value={(progress.done / progress.total) * 100} label={D.uploading(progress.done, progress.total)} />
            <p className="text-xs text-foreground-muted">{D.uploading(progress.done, progress.total)}</p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <Button size="lg" className="w-full active:scale-[0.98]" loading={busy} disabled={files.length === 0} onClick={submit}>
          <PaperPlaneTilt size={18} weight="fill" aria-hidden="true" />
          {D.submit}
        </Button>
      </div>
    </BottomSheet>
  );
}
