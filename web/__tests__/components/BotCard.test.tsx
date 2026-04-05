import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BotCard } from '@/components/BotCard';
import type { BotLiveData } from '@/lib/store';

function makeBotData(overrides: Partial<BotLiveData> = {}): BotLiveData {
  return {
    name: 'TestBot',
    personality: 'farmer',
    mode: 'codegen' as const,
    state: 'IDLE',
    position: { x: 100, y: 64, z: -200 },
    health: 18,
    food: 15,
    inventory: [],
    ...overrides,
  };
}

describe('BotCard', () => {
  it('renders bot name and personality', () => {
    render(<BotCard bot={makeBotData()} />);
    expect(screen.getByText('TestBot')).toBeInTheDocument();
    expect(screen.getByText('farmer')).toBeInTheDocument();
  });

  it('renders state label', () => {
    render(<BotCard bot={makeBotData({ state: 'EXECUTING_TASK' })} />);
    expect(screen.getByText('Working')).toBeInTheDocument();
  });

  it('displays formatted coordinates', () => {
    render(<BotCard bot={makeBotData({ position: { x: 10.7, y: 64.2, z: -30.1 } })} />);
    expect(screen.getByText('11, 64, -30')).toBeInTheDocument();
  });

  it('shows --- when position is null', () => {
    render(<BotCard bot={makeBotData({ position: null })} />);
    expect(screen.getByText('---')).toBeInTheDocument();
  });

  it('renders health and food bars', () => {
    render(<BotCard bot={makeBotData({ health: 14, food: 10 })} />);
    expect(screen.getByText('HP')).toBeInTheDocument();
    expect(screen.getByText('FD')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders mode badge', () => {
    render(<BotCard bot={makeBotData({ mode: 'primitive' as any })} />);
    expect(screen.getByText('primitive')).toBeInTheDocument();
  });

  it('renders inventory items up to 4', () => {
    const inventory = [
      { name: 'oak_log', count: 32, slot: 0 },
      { name: 'stone', count: 64, slot: 1 },
      { name: 'iron_ingot', count: 12, slot: 2 },
      { name: 'diamond', count: 3, slot: 3 },
      { name: 'coal', count: 48, slot: 4 },
    ];
    render(<BotCard bot={makeBotData({ inventory })} />);
    expect(screen.getByText('oak log x32')).toBeInTheDocument();
    expect(screen.getByText('stone x64')).toBeInTheDocument();
    expect(screen.getByText('iron ingot x12')).toBeInTheDocument();
    expect(screen.getByText('diamond x3')).toBeInTheDocument();
    // 5th item should be hidden, replaced with "+1"
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.queryByText('coal x48')).not.toBeInTheDocument();
  });

  it('does not render inventory section when empty', () => {
    render(<BotCard bot={makeBotData({ inventory: [] })} />);
    expect(screen.queryByText(/x\d+/)).not.toBeInTheDocument();
  });

  it('links to bot detail page', () => {
    render(<BotCard bot={makeBotData({ name: 'MyBot' })} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/bots/MyBot');
  });

  it('shows active pulse indicator for active states', () => {
    const { container } = render(<BotCard bot={makeBotData({ state: 'EXECUTING_TASK' })} />);
    const pulseEl = container.querySelector('.animate-pulse');
    expect(pulseEl).toBeInTheDocument();
  });

  it('does not show pulse for idle state', () => {
    const { container } = render(<BotCard bot={makeBotData({ state: 'IDLE' })} />);
    const statusSpan = screen.getByText('Idle').parentElement;
    const pulseEl = statusSpan?.querySelector('.animate-pulse');
    expect(pulseEl).toBeNull();
  });
});
