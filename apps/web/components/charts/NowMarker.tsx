"use client";

/**
 * The "NOW" reference-line label — a small pill badge with a pulsing dot,
 * like a live terminal cursor. Extracted from `MarketPriceChart` (the
 * reference implementation) so any chart showing "where we are right now"
 * on a timeline uses the exact same marker, not a second visual language.
 * Optionally carries a short real-time annotation (a point-in-time value,
 * never a fabricated time series).
 */
export function NowLabel(props: {
  viewBox?: { x?: number; y?: number };
  annotation?: string;
}) {
  const { viewBox, annotation } = props;
  if (!viewBox || viewBox.x === undefined || viewBox.y === undefined) {
    return null;
  }

  if (!annotation) {
    return (
      <g transform={`translate(${viewBox.x}, ${viewBox.y - 6})`}>
        <rect x={-20} y={-16} width={40} height={16} rx={8} fill="#0891b2" />
        <circle cx={-11} cy={-8} r={2.5} fill="#5eead4">
          <animate
            attributeName="opacity"
            values="1;0.35;1"
            dur="1.6s"
            repeatCount="indefinite"
          />
        </circle>
        <text x={4} y={-4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#ecfeff">
          NOW
        </text>
      </g>
    );
  }

  const pillWidth = Math.max(70, annotation.length * 5.2 + 20);

  return (
    <g transform={`translate(${viewBox.x}, ${viewBox.y - 34})`}>
      <rect
        x={-pillWidth / 2}
        y={-1}
        width={pillWidth}
        height={30}
        rx={6}
        fill="#0891b2"
      />
      <circle cx={-pillWidth / 2 + 10} cy={11} r={2.5} fill="#5eead4">
        <animate
          attributeName="opacity"
          values="1;0.35;1"
          dur="1.6s"
          repeatCount="indefinite"
        />
      </circle>
      <text x={-pillWidth / 2 + 18} y={14} fontSize={9} fontWeight={700} fill="#ecfeff">
        NOW
      </text>
      <text x={0} y={24} textAnchor="middle" fontSize={9} fill="#cffafe">
        {annotation}
      </text>
    </g>
  );
}
