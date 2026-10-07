import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function ComunidadVoluntariosRegistrarmeLoading() {
  return (
    <FormScreenSkeleton fields={4} textareaAt={[3]} />
  );
}
