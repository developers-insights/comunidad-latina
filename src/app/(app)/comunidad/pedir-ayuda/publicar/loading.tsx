import { Skeleton } from "@/components/ui";
import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function ComunidadPedirAyudaPublicarLoading() {
  return (
    <FormScreenSkeleton
      intro={<Skeleton className="mb-5 h-28 w-full rounded-xl" />}
      fields={5}
      textareaAt={[3]}
    />
  );
}
