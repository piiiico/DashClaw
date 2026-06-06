import React from 'react';

const variants: Record<string, string> = {
  default: 'bg-zinc-500/10 text-secondary border-zinc-500/20',
  success: 'bg-success-subtle text-success border-success/20',
  warning: 'bg-warning-subtle text-warning border-warning/20',
  error: 'bg-error-subtle text-error border-error/20',
  info: 'bg-info-subtle text-info border-blue-500/20',
  brand: 'bg-brand/10 text-brand border-brand/20',
};

const sizes: Record<string, string> = {
  xs: 'text-[10px] px-1.5 py-0.5 rounded',
  sm: 'text-xs px-2 py-0.5 rounded-md',
};

interface BadgeProps {
  children?: React.ReactNode;
  variant?: string;
  size?: string;
  className?: string;
}

export function Badge({ children, variant = 'default', size = 'sm', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center font-medium border ${variants[variant] || variants.default} ${sizes[size] || sizes.sm} ${className}`}>
      {children}
    </span>
  );
}
