import { cn } from "@/lib/utils";
import { fieldControlClass } from "./input";

export type TextareaProps =
  React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(fieldControlClass, "min-h-24 px-4 py-3", className)}
      {...props}
    />
  );
}
