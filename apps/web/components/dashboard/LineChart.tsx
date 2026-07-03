export default function LineChart() {
  return (
    <svg
      viewBox="0 0 600 160"
      className="h-36 w-full"
      preserveAspectRatio="none"
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
            stopColor="#4F7CFF"
            stopOpacity="0.22"
          />

          <stop
            offset="100%"
            stopColor="#4F7CFF"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>

      {/* Area */}

      <path
        d="
M40 120
L55 120
L70 120
L85 120
L100 119
L115 116
L130 110
L145 100
L160 88
L175 74
L190 60
L205 48
L220 40
L232 42
L235 79
L237 38
L250 31
L265 29
L280 28
L290 30
L300 27
L305 65
L310 31
L320 28
L330 29
L335 45
L340 27
L350 30
L360 28
L365 38
L370 38
L370 160
L520 160
Z
"
        fill="url(#fill)"
      />

      {/* Line */}

      <path
        d="
M40 120
L55 120
L70 120
L85 120
L100 119
L115 116
L130 110
L145 100
L160 88
L175 74
L190 60
L205 48
L220 40
L232 42
L235 79
L237 38
L250 31
L265 29
L280 28
L290 30
L300 27
L305 65
L310 31
L320 28
L330 29
L335 45
L340 27
L350 30
L360 28
L365 38
L370 30
"
        fill="none"
        stroke="#4F7CFF"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* X axis */}

      <line
        x1="40"
        y1="120"
        x2="560"
        y2="120"
        stroke="#23314d"
      />

<g
  fill="#64748b"
  fontSize="10"
  textAnchor="middle"
>
  <text x="40"  y="140">03:00</text>
  <text x="120" y="140">06:00</text>
  <text x="200" y="140">09:00</text>
  <text x="280" y="140">12:00</text>
  <text x="360" y="140">15:00</text>
  <text x="440" y="140">18:00</text>
  <text x="520" y="140">21:00</text>
</g>
    </svg>
  );
}