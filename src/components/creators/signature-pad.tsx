"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { FLOW_COPY } from "./flow-copy";

const EXPORT_WIDTH = 600;
const EXPORT_HEIGHT = 200;

// La firma se guarda como PNG pero se muestra como máscara alfa (ver
// SignatureImage): sólo importa qué píxeles tienen tinta, no su color. Así la
// misma firma se lee en tema claro y oscuro sin guardar un color fijo.
export function SignatureImage({ png, label, className }: { png: string; label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("block bg-foreground", className)}
      style={{
        maskImage: `url(${png})`,
        WebkitMaskImage: `url(${png})`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}

export function SignaturePad({
  id,
  onChange,
  disabled = false,
}: {
  id: string;
  onChange: (png: string | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(canvas).color;
    ctx.lineWidth = 2.4;
  }, []);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function exportPng(): string | null {
    const source = canvasRef.current;
    if (!source) return null;
    const out = document.createElement("canvas");
    out.width = EXPORT_WIDTH;
    out.height = EXPORT_HEIGHT;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
    return out.toDataURL("image/png");
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = point(event);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    const next = point(event);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last.current = next;
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    setEmpty(false);
    onChange(exportPng());
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-2xl bg-surface ring-1 ring-border">
        <canvas
          id={id}
          ref={canvasRef}
          role="img"
          aria-label={FLOW_COPY.signing.signatureLabel}
          className={cn(
            "block h-40 w-full touch-none text-foreground",
            disabled ? "cursor-not-allowed" : "cursor-crosshair",
          )}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-dashed border-border-strong"
        />
        {empty && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs font-medium text-foreground-muted"
          >
            {FLOW_COPY.signing.signatureEmpty}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-foreground-muted">{FLOW_COPY.signing.signatureHint}</p>
        <button
          type="button"
          onClick={clear}
          disabled={empty || disabled}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-foreground-secondary transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-foreground disabled:opacity-40"
        >
          <ArrowCounterClockwise size={13} aria-hidden="true" />
          {FLOW_COPY.signing.clear}
        </button>
      </div>
    </div>
  );
}
