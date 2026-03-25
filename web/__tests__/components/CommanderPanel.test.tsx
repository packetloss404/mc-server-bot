import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommanderPanel } from '@/components/CommanderPanel';
import type { CommanderPlan } from '@/lib/api';

const basePlan: CommanderPlan = {
  id: 'plan-1',
  input: 'Send Ada to base',
  parsedIntent: 'Move Ada to base',
  confidence: 0.6,
  requiresConfirmation: true,
  warnings: ['Marker may be ambiguous'],
  commands: [
    {
      id: 'cmd-1',
      type: 'move_to_marker',
      scope: 'bot',
      targets: ['Ada'],
      payload: { markerId: 'base' },
      priority: 'normal',
      source: 'commander',
      status: 'queued',
      createdAt: Date.now(),
    },
  ],
  missions: [],
};

describe('CommanderPanel', () => {
  it('shows clarification guidance and summary counts', () => {
    render(
      <CommanderPanel plan={basePlan} onExecute={vi.fn()} onCancel={vi.fn()} executing={false} />,
    );

    expect(screen.getByText('Clarification Recommended')).toBeInTheDocument();
    expect(screen.getByText('Commands')).toBeInTheDocument();
    expect(screen.getByText('Warnings')).toBeInTheDocument();
    expect(screen.getByText('Move Ada to base')).toBeInTheDocument();
  });

  it('requires double confirmation before execute callback', () => {
    const onExecute = vi.fn();
    render(
      <CommanderPanel plan={basePlan} onExecute={onExecute} onCancel={vi.fn()} executing={false} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Execute' }));
    expect(onExecute).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });
});
