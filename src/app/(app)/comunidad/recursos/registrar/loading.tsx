import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function ComunidadRecursosRegistrarLoading() {
  return (
    <FormScreenSkeleton fields={5} textareaAt={[4]} />
  );
}
