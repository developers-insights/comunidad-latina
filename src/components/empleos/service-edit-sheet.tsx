"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cargarServicioParaEditar,
  editarServicioAction,
  type ServicioEditable,
} from "@/app/(app)/empleos/editar-servicio-actions";
import {
  ServiceWhatFields,
  ServiceWhenFields,
  precioDeServicio,
  validarPasoDeServicio,
  type ServiceFormValues,
} from "@/app/(app)/empleos/publicar/service-fields";
import { BottomSheet, Button, useToast } from "@/components/ui";
import {
  ListingVideoField,
  useVideoDeAviso,
  type ListingVideoInputPayload,
} from "@/components/listings/listing-video-field";
import { listingVideoPublicUrl } from "@/lib/media/listing-video-policy";
import { isWorkDay } from "@/lib/empleos/detalles";
import { EDICION_COPY } from "@/lib/listings/edicion";

export type ServicioGuardado = ServiceFormValues & { status: string };

export const SERVICE_EDIT_COPY = {
  titulo: "Editar tu servicio",
  guardar: "Guardar cambios",
  guardando: "Guardando…",
  cancelar: "Cancelar",
} as const;

function valoresDe(servicio: ServicioEditable): ServiceFormValues {
  return {
    title: servicio.title,
    description: servicio.description,
    workMode: servicio.workMode,
    areaLabel: servicio.areaLabel,
    days: servicio.days.filter(isWorkDay),
    schedule: servicio.schedule,
    price: servicio.priceAmount === null ? "" : String(servicio.priceAmount),
    payPeriod: servicio.payPeriod,
  };
}

export function ServiceEditSheet({
  open,
  onClose,
  listingId,
  onGuardado,
}: {
  open: boolean;
  onClose: () => void;
  listingId: string;
  onGuardado?: (valores: ServicioGuardado, currency: string) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={SERVICE_EDIT_COPY.titulo} keyboardAware>
      <Cuerpo key={listingId} listingId={listingId} onClose={onClose} onGuardado={onGuardado} />
    </BottomSheet>
  );
}

function Cuerpo({
  listingId,
  onClose,
  onGuardado,
}: {
  listingId: string;
  onClose: () => void;
  onGuardado?: (valores: ServicioGuardado, currency: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [servicio, setServicio] = useState<ServicioEditable | null>(null);
  const [cargaFallida, setCargaFallida] = useState<string | null>(null);
  const [values, setValues] = useState<ServiceFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const videoDelAviso = useVideoDeAviso();
  const ponerVideo = videoDelAviso.setVideo;

  useEffect(() => {
    let vigente = true;
    void (async () => {
      const result = await cargarServicioParaEditar({ listingId });
      if (!vigente) return;
      if (!result.ok) {
        setCargaFallida(result.error);
        return;
      }
      setServicio(result.servicio);
      setValues(valoresDe(result.servicio));
      const guardado = result.servicio.video;
      ponerVideo(
        guardado
          ? {
              tipo: "guardado",
              path: guardado.path,
              posterPath: guardado.posterPath,
              url: listingVideoPublicUrl(guardado.path),
              posterUrl: guardado.posterPath ? listingVideoPublicUrl(guardado.posterPath) : null,
              seconds: guardado.seconds,
            }
          : null,
      );
    })();
    return () => {
      vigente = false;
    };
  }, [listingId, ponerVideo]);

  if (cargaFallida) {
    return (
      <p role="alert" className="pb-4 text-sm font-medium text-danger">
        {cargaFallida}
      </p>
    );
  }
  if (!servicio || !values) {
    return <p className="pb-4 text-sm text-foreground-muted">{EDICION_COPY.hoja.cargando}</p>;
  }

  const patch = (cambios: Partial<ServiceFormValues>) =>
    setValues((actual) => (actual ? { ...actual, ...cambios } : actual));

  const videoActual = videoDelAviso.video;
  const videoCambiado =
    servicio.videoDisponible &&
    (videoActual?.tipo === "nuevo" ||
      (videoActual?.tipo === "guardado" ? videoActual.path : null) !==
        (servicio.video?.path ?? null));

  const avisoDeRevision =
    servicio.status === "paused"
      ? EDICION_COPY.revision.pausada
      : servicio.status === "pending_review"
        ? EDICION_COPY.revision.enRevision
        : EDICION_COPY.revision.publicada;

  function guardar() {
    if (!servicio || !values || isPending) return;
    const problema = validarPasoDeServicio(values, 0) ?? validarPasoDeServicio(values, 1);
    if (problema) {
      setError(problema);
      return;
    }
    setError(null);

    startTransition(async () => {
      let video: ListingVideoInputPayload | null | undefined;
      if (videoCambiado) {
        const subido = await videoDelAviso.subir();
        if (!subido.ok) {
          setError(subido.error);
          return;
        }
        video = subido.input;
      }

      const precio = precioDeServicio(values);
      const result = await editarServicioAction({
        listingId,
        title: values.title.trim(),
        description: values.description.trim(),
        priceAmount: precio.valid ? precio.amount : null,
        payPeriod: values.payPeriod,
        workMode: values.workMode,
        areaLabel: values.areaLabel.trim() || null,
        days: values.days,
        schedule: values.schedule.trim() || null,
        ...(video !== undefined ? { video } : {}),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (result.sinCambios) {
        toast({ title: EDICION_COPY.hoja.sinCambios, variant: "info" });
        onClose();
        return;
      }

      onGuardado?.({ ...values, status: result.status }, servicio.currency);
      toast({
        title: EDICION_COPY.ok.guardadoTitulo,
        description:
          result.status === "pending_review"
            ? EDICION_COPY.ok.guardadoRevision
            : EDICION_COPY.ok.guardadoDirecto,
        variant: result.status === "pending_review" ? "info" : "success",
      });
      router.refresh();
      onClose();
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        guardar();
      }}
      className="flex flex-col gap-5 pb-2"
    >
      <ServiceWhatFields values={values} onChange={patch} disabled={isPending}>
        {servicio.videoDisponible && (
          <ListingVideoField
            value={videoDelAviso.video}
            onChange={videoDelAviso.setVideo}
            tier={servicio.tier}
            premiumHref={`/negocios/presencia/aviso/${servicio.id}`}
            disabled={isPending}
            progress={videoDelAviso.progress}
          />
        )}
      </ServiceWhatFields>

      <ServiceWhenFields
        values={values}
        onChange={patch}
        currency={servicio.currency}
        disabled={isPending}
      />

      <p className="rounded-md bg-surface-subtle px-3 py-2.5 text-xs text-foreground-secondary">
        {avisoDeRevision}
      </p>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={isPending}
          className="sm:min-w-28"
        >
          {SERVICE_EDIT_COPY.cancelar}
        </Button>
        <Button type="submit" variant="primary" loading={isPending} className="sm:min-w-40">
          {isPending ? SERVICE_EDIT_COPY.guardando : SERVICE_EDIT_COPY.guardar}
        </Button>
      </div>
    </form>
  );
}
