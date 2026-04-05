'use client';

import { PageHeader } from '@/components/PageHeader';
import { CommandHistoryPanel } from '@/components/CommandHistoryPanel';

export default function HistoryPage() {
  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl">
      <PageHeader
        title="Command History"
        subtitle="View past commands and mission history across all bots"
      />

      <CommandHistoryPanel />
    </div>
  );
}
