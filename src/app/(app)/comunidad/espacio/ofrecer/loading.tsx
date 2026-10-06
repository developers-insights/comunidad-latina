import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function ComunidadEspacioOfrecerLoading() {
  return (
    <FormScreenSkeleton fields={4} textareaAt={[3]} />
  );
}
