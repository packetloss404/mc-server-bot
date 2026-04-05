'use client';

/** Reusable skeleton primitives for loading states */

export function SkeletonBox({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-zinc-800/60 rounded animate-pulse ${className}`} />
  );
}

export function SkeletonText({ width = 'w-32', className = '' }: { width?: string; className?: string }) {
  return (
    <div className={`h-3 bg-zinc-800/60 rounded animate-pulse ${width} ${className}`} />
  );
}

/** Grid of skeleton cards for dashboard/fleet-style pages */
export function SkeletonCardGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <SkeletonBox className="w-9 h-9 rounded-lg" />
            <div className="space-y-1.5 flex-1">
              <SkeletonText width="w-24" />
              <SkeletonText width="w-16" className="h-2" />
            </div>
          </div>
          <SkeletonBox className="h-2 w-full rounded-full" />
          <div className="flex gap-2">
            <SkeletonText width="w-12" className="h-2" />
            <SkeletonText width="w-16" className="h-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for stat summary rows */
export function SkeletonStatRow({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-${count} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 space-y-2">
          <SkeletonText width="w-20" className="h-2" />
          <SkeletonBox className="h-7 w-16 rounded" />
          <SkeletonText width="w-24" className="h-2" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton for list items */
export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 divide-y divide-zinc-800/40">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <SkeletonBox className="w-6 h-6 rounded" />
          <div className="space-y-1.5 flex-1">
            <SkeletonText width={i % 2 === 0 ? 'w-40' : 'w-28'} />
            <SkeletonText width="w-20" className="h-2" />
          </div>
          <SkeletonText width="w-12" className="h-2" />
        </div>
      ))}
    </div>
  );
}

/** Full-page centered loading spinner */
export function LoadingSpinner({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="py-16 text-center">
      <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
      <p className="text-xs text-zinc-500">{message}</p>
    </div>
  );
}
