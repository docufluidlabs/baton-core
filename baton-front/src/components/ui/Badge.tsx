import clsx from 'clsx';

const VARIANT_STYLES = {
  green: 'bg-green-50 text-green-700',
  red: 'bg-red-50 text-red-700',
  yellow: 'bg-yellow-50 text-yellow-700',
  blue: 'bg-blue-50 text-blue-700',
  purple: 'bg-purple-50 text-purple-700',
  gray: 'bg-gray-100 text-gray-600',
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: keyof typeof VARIANT_STYLES;
  className?: string;
}

export function Badge({ children, variant = 'gray', className }: BadgeProps) {
  return (
    <span className={clsx('text-xs font-medium px-2.5 py-0.5 rounded-full', VARIANT_STYLES[variant], className)}>
      {children}
    </span>
  );
}

/** Map common status strings to badge variants */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, keyof typeof VARIANT_STYLES> = {
    healthy: 'green',
    active: 'green',
    completed: 'green',
    running: 'blue',
    pending: 'yellow',
    warning: 'yellow',
    paused: 'yellow',
    error: 'red',
    failed: 'red',
    disabled: 'gray',
    draft: 'gray',
    cancelled: 'gray',
  };
  return <Badge variant={map[status] || 'gray'}>{status}</Badge>;
}
