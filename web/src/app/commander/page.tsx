'use client';

import { PageHeader } from '@/components/PageHeader';
import { CommanderPanel } from '@/components/CommanderPanel';
import { MissionComposer } from '@/components/MissionComposer';
import { CommandHistoryPanel } from '@/components/CommandHistoryPanel';

export default function CommanderPage() {
  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl">
      <PageHeader
        title="Commander"
        subtitle="Issue natural language commands and create missions for your bot fleet"
      />

      <CommanderPanel />

      <MissionComposer />

      <CommandHistoryPanel />
    </div>
  );
}
