import { ReactNode } from "react";
import clsx from "clsx";

type CardProps = {
  children?: ReactNode;
  className?: string;
};

export default function Card({
  children,
  className,
}: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-slate-800 bg-[#101728]",
        "shadow-[0_10px_40px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      {children}
    </div>
  );
}