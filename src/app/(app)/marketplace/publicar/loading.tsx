import { FormScreenSkeleton } from "@/components/ui/skeletons";

export default function MarketplacePublicarLoading() {
  return (
    <FormScreenSkeleton fields={7} textareaAt={[3]} />
  );
}
