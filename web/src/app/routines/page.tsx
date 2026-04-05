'use client';

import { motion } from 'framer-motion';
import { PageHeader } from '@/components/PageHeader';

export default function RoutinesPage() {
  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-4xl">
      <PageHeader title="Routines" subtitle="Automated scheduled tasks for your bots" />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40"
      >
        <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <p className="text-sm text-zinc-500">No routines created</p>
        <p className="text-xs text-zinc-600 mt-1">Routines let you schedule recurring tasks for your bots</p>
        <p className="text-xs text-zinc-600 mt-3 max-w-xs mx-auto">
          This feature is coming soon. Use the <a href="/commander" className="text-emerald-500 hover:text-emerald-400">Commander</a> to issue one-time commands.
        </p>
      </motion.div>
    </div>
  );
}
