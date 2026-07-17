import * as React from "react";
import { cn } from "../lib/utils";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional named alias for React.forwardRef's generic
export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  TextareaProps
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[120px] w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500",
      className
    )}
    {...props}
  />
));

Textarea.displayName = "Textarea";