import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default function PlatformLayout({
  children,
}: Props) {
  return (
    <main className="min-h-screen bg-[#050816] text-white">
      {children}
    </main>
  );
}