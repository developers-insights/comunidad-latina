import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function NegociosCopilotoLoading() {
  return (
    <FormScreenSkeleton fields={3} textareaAt={[1]} />
  );
}
