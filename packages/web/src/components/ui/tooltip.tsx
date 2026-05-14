import { cn } from '@/lib/utils';

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({ children }: { children: React.ReactNode }) {
  return <span className="relative inline-flex items-center group">{children}</span>;
}

export function TooltipTrigger({
  children,
  asChild: _asChild,
}: {
  children: React.ReactNode;
  asChild?: boolean;
}) {
  return <>{children}</>;
}

export function TooltipContent({
  children,
  className,
  side = 'top',
}: {
  children: React.ReactNode;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  const posClass =
    side === 'right'
      ? 'left-full top-1/2 -translate-y-1/2 ml-2'
      : side === 'bottom'
        ? 'top-full left-1/2 -translate-x-1/2 mt-2'
        : side === 'left'
          ? 'right-full top-1/2 -translate-y-1/2 mr-2'
          : 'bottom-full left-1/2 -translate-x-1/2 mb-2';

  return (
    <span
      role="tooltip"
      className={cn(
        'pointer-events-none absolute z-50 max-w-64 rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md',
        'opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-200',
        'whitespace-normal text-left',
        posClass,
        className,
      )}
    >
      {children}
    </span>
  );
}
