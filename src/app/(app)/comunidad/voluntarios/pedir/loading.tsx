import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function ComunidadVoluntariosPedirLoading() {
  return (
    <FormScreenSkeleton fields={4} textareaAt={[3]} />
  );
}
