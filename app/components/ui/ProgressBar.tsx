import React from 'react';

const colorMap: Record<string, string> = {
  brand: 'bg-brand',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  info: 'bg-status-info',
  purple: 'bg-purple-500',
};

interface ProgressBarProps {
  value?: number;
  color?: string;
  className?: string;
}

export function ProgressBar({ value = 0, color = 'brand', className = '' }: ProgressBarProps) {
  const clampedValue = Math.min(100, Math.max(0, value));

  return (
    <div className={`w-full bg-white/5 rounded-full h-1.5 ${className}`}>
      <div
        className={`h-1.5 rounded-full transition-all duration-500 ${colorMap[color] || colorMap.brand}`}
        style={{ width: `${clampedValue}%` }}
      />
    </div>
  );
}
