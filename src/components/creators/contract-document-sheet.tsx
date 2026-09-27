"use client";

import { useState } from "react";
import { FileText } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FLOW_COPY } from "./flow-copy";
import { SignatureImage } from "./signature-pad";

export interface SignatureView {
  role: "client" | "creator";
  legalName: string;
  signedAtLabel: string;
  signaturePng: string;
  termsHash: string;
}

export function ContractDocumentSheet({
  text,
  signatures,
  triggerLabel = FLOW_COPY.signing.fullContract,
  triggerClassName,
  version,
}: {
  text: string;
  signatures: SignatureView[];
  triggerLabel?: string;
  triggerClassName?: string;
  version?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className={cn(triggerClassName)} onClick={() => setOpen(true)}>
        <FileText size={16} aria-hidden="true" />
        {triggerLabel}
      </Button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={FLOW_COPY.contractSheet.title} size="tall">
        <div className="flex flex-col gap-4 pb-4">
          {version && <p className="text-xs text-foreground-muted">{version}</p>}
          <article className="rounded-2xl bg-surface p-5 text-[13px] leading-relaxed text-foreground ring-1 ring-border">
            <pre className="whitespace-pre-wrap font-sans">{text}</pre>
          </article>
          {signatures.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="font-display text-base font-bold text-foreground">{FLOW_COPY.contractSheet.signatures}</h3>
              <ul className="grid gap-3 sm:grid-cols-2">
                {signatures.map((signature) => (
                  <li key={`${signature.role}-${signature.termsHash}`} className="rounded-2xl bg-surface-subtle p-3">
                    <p className="text-xs font-medium text-foreground-muted">
                      {signature.role === "client" ? FLOW_COPY.signing.client : FLOW_COPY.signing.creator}
                    </p>
                    <div className="mt-2 rounded-xl bg-surface p-1 ring-1 ring-border-subtle">
                      <SignatureImage png={signature.signaturePng} label={`Firma de ${signature.legalName}`} className="h-16 w-full" />
                    </div>
                    <p className="mt-2 text-sm font-semibold text-foreground">{signature.legalName}</p>
                    <p className="text-xs text-foreground-muted">{FLOW_COPY.signing.signedAt(signature.signedAtLabel)}</p>
                    <p className="numeric mt-1 truncate text-[10px] text-foreground-muted">
                      {FLOW_COPY.signing.fingerprint} {signature.termsHash.slice(0, 16)}…
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
