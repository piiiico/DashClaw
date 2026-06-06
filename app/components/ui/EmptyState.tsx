import React from 'react';

interface EmptyStateProps {
  icon?: React.ElementType;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12">
      {Icon && <Icon size={28} className="mb-3 text-disabled" strokeWidth={1.5} />}
      <div className="text-sm font-medium text-secondary">{title}</div>
      {description && (
        <div className="mt-1.5 max-w-sm text-center text-xs text-tertiary">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
