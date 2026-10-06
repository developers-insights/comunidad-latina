import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function PublicarLoading() {
  return (
    <FormScreenSkeleton fields={6} textareaAt={[2]} />
  );
}
