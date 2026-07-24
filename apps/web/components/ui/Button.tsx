import { ReactNode } from "react";
import clsx from "clsx";

export type ButtonVariant = "primary" | "secondary";

type ButtonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
};

/** Shared so any other component that needs to render a Voltessa-styled button without wrapping this one (e.g. RequestDemoButton, which renders react-calendly's own <button>) stays visually identical instead of duplicating these classes. */
export function buttonClassName(variant: ButtonVariant = "primary", className?: string): string {
  return clsx(
    "rounded-xl px-7 py-4 font-semibold transition duration-200",
    {
      "bg-blue-600 text-white hover:bg-blue-500":
        variant === "primary",

      "border border-slate-700 text-white hover:bg-slate-900":
        variant === "secondary",
    },
    className
  );
}

export default function Button({
  children,
  variant = "primary",
  className,
}: ButtonProps) {
  return <button className={buttonClassName(variant, className)}>{children}</button>;
}