/**
 * Custom energy-asset icons for the System Overview diagram (Dashboard UI
 * Refinement — Final Design Pass, second iteration). Deliberately not
 * `lucide-react`'s generic `Sun`/`Home`/`Zap` — the milestone explicitly
 * asked for icons that read as energy assets (a solar installation, a
 * transmission tower, a building), not menu-style UI glyphs. Same
 * stroke-based visual language as every other icon already in this app
 * (`currentColor`, rounded joins, ~1.5 stroke width) so they sit
 * comfortably next to `lucide-react` icons elsewhere on the page.
 */

type IconProps = { className?: string };

export function SolarPanelIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M7 9h10l3 6H4z" />
      <path d="M11 9l-1.3 6" />
      <path d="M13 9l1.3 6" />
      <path d="M5.5 12h13" />
      <path d="M12 15v4" />
      <path d="M8 19h8" />
    </svg>
  );
}

export function TransmissionTowerIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3 7 20" />
      <path d="M12 3l5 17" />
      <path d="M8.2 8h7.6" />
      <path d="M6.8 13h10.4" />
      <path d="M9 8l1.4 5" />
      <path d="M15 8l-1.4 5" />
      <path d="M6 20h12" />
    </svg>
  );
}

export function LoadBuildingIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="5" y="4" width="14" height="17" rx="1" />
      <rect x="8" y="7.5" width="2" height="2" />
      <rect x="14" y="7.5" width="2" height="2" />
      <rect x="8" y="11.5" width="2" height="2" />
      <rect x="14" y="11.5" width="2" height="2" />
      <rect x="10" y="16" width="4" height="5" />
    </svg>
  );
}
