import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function AjustesSoporteLoading() {
  return (
    <FormScreenSkeleton fields={3} textareaAt={[2]} />
  );
}
