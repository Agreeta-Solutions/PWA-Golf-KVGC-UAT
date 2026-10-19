import React from 'react';

interface PestGaugeMetricCardProps {
  title: string;
  valueText: string;
  progress: number; // 0 to 1
  gaugeColor: string;
}

export const PestGaugeMetricCard: React.FC<PestGaugeMetricCardProps> = ({
  title,
  valueText,
  progress,
  gaugeColor
}) => {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  
  // Radius and circumference calculations for 270-degree arc
  // Total circumference for r=21: 2 * PI * 21 = 131.947
  // Arc length (270 / 360 = 0.75): 131.947 * 0.75 = 98.96
  const r = 21;
  const circumference = 2 * Math.PI * r;
  const arcTotal = circumference * 0.75;
  const arcProgress = clampedProgress * arcTotal;

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: '12px 6px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 0
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          color: '#64748B',
          letterSpacing: '0.4px',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
          marginBottom: 8
        }}
      >
        {title}
      </div>

      <div
        style={{
          position: 'relative',
          width: 54,
          height: 54,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <svg
          width="54"
          height="54"
          viewBox="0 0 54 54"
          style={{ transform: 'rotate(135deg)', position: 'absolute', top: 0, left: 0 }}
        >
          {/* Background arc ring (15% opacity) */}
          <circle
            cx="27"
            cy="27"
            r={r}
            fill="none"
            stroke={gaugeColor}
            strokeWidth="5"
            strokeOpacity="0.15"
            strokeDasharray={`${arcTotal} ${circumference - arcTotal}`}
            strokeLinecap="round"
          />

          {/* Active progress arc ring */}
          <circle
            cx="27"
            cy="27"
            r={r}
            fill="none"
            stroke={gaugeColor}
            strokeWidth="5"
            strokeDasharray={`${arcProgress} ${circumference}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.5s ease-out' }}
          />
        </svg>

        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: '#0F172A',
            zIndex: 1,
            pointerEvents: 'none'
          }}
        >
          {valueText}
        </span>
      </div>
    </div>
  );
};
