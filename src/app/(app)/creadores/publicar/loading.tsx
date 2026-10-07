import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function CreadoresPublicarLoading() {
  return (
    <FormScreenSkeleton fields={6} textareaAt={[2]} />
  );
}
