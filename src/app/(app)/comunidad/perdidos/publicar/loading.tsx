import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function ComunidadPerdidosPublicarLoading() {
  return (
    <FormScreenSkeleton fields={6} textareaAt={[4]} />
  );
}
