'use client';

import Link from 'next/link';

interface Props {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, children }: Props) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-zinc-600 mb-3">
        <Link href="/" className="hover:text-zinc-300 transition-colors">Dashboard</Link>
        <span>/</span>
        <span className="text-zinc-400">{title}</span>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{title}</h1>
          {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
