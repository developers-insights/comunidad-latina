import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function EmpleosPublicarLoading() {
  return (
    <FormScreenSkeleton fields={4} textareaAt={[3]} />
  );
}
