import { ReactNode } from "react";
import clsx from "clsx";

type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary";
};

export default function Button({
  children,
  variant = "primary",
}: ButtonProps) {
  const styles = clsx(
    "rounded-xl px-7 py-4 font-semibold transition duration-200",
    {
      "bg-blue-600 text-white hover:bg-blue-500":
        variant === "primary",

      "border border-slate-700 text-white hover:bg-slate-900":
        variant === "secondary",
    }
  );

  return <button className={styles}>{children}</button>;
}