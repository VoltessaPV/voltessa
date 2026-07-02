export default function LineChart() {
  return (
    <svg
      viewBox="0 0 500 160"
      className="h-40 w-full"
    >
      <defs>
        <linearGradient
          id="fill"
          x1="0"
          x2="0"
          y1="0"
          y2="1"
        >
          <stop
            offset="0%"
            stopColor="#3b82f6"
            stopOpacity="0.35"
          />

          <stop
            offset="100%"
            stopColor="#3b82f6"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>

      <path
        d="
M0 140
L40 132
L80 128
L120 92
L160 76
L200 68
L240 79
L280 70
L320 58
L360 65
L400 55
L440 61
L500 48
"
        fill="none"
        stroke="#4f8cff"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}