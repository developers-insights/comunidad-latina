import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function MensajesGruposNuevoLoading() {
  return (
    <FormScreenSkeleton fields={3} textareaAt={[1]} />
  );
}
