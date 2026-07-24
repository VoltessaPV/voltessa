"use client";

type SectionNavLinkProps = {
  id: string;
  label: string;
};

/**
 * A Navbar link that smooth-scrolls to an on-page section by id, same
 * pattern as ContactNavLink (a real href="#id" so the link still works as
 * a plain jump before hydration or with JS disabled, preventDefault only
 * to take over with a smooth scroll once hydrated). Kept as its own tiny
 * client component so Navbar itself stays a Server Component.
 */
export function SectionNavLink({ id, label }: SectionNavLinkProps) {
  return (
    <a
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault();
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
      }}
      className="transition hover:text-white"
    >
      {label}
    </a>
  );
}
