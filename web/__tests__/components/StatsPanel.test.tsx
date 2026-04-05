import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsPanel } from '@/components/StatsPanel';

const emptyStats = {
  mined: {},
  crafted: {},
  smelted: {},
  placed: {},
  killed: {},
  deaths: 0,
  interrupts: 0,
  movementTimeouts: 0,
  damageTaken: 0,
};

const richStats = {
  mined: { stone: 150, iron_ore: 42, diamond_ore: 5 },
  crafted: { iron_ingot: 30, diamond_pickaxe: 2 },
  smelted: { iron_ingot: 20 },
  placed: { cobblestone: 80 },
  killed: { zombie: 12, skeleton: 8 },
  deaths: 3,
  interrupts: 2,
  movementTimeouts: 1,
  damageTaken: 45.6,
};

describe('StatsPanel', () => {
  it('renders "No stats recorded yet" when all stats are zero', () => {
    render(<StatsPanel stats={emptyStats} />);
    expect(screen.getByText('No stats recorded yet')).toBeInTheDocument();
  });

  it('renders Stats heading', () => {
    render(<StatsPanel stats={richStats} />);
    expect(screen.getByText('Stats')).toBeInTheDocument();
  });

  it('displays death count', () => {
    render(<StatsPanel stats={richStats} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Deaths')).toBeInTheDocument();
  });

  it('displays damage taken rounded', () => {
    render(<StatsPanel stats={richStats} />);
    expect(screen.getByText('46')).toBeInTheDocument();
    expect(screen.getByText('Damage')).toBeInTheDocument();
  });

  it('displays total mined count', () => {
    render(<StatsPanel stats={richStats} />);
    // 150 + 42 + 5 = 197
    expect(screen.getByText('197')).toBeInTheDocument();
    expect(screen.getByText('Mined')).toBeInTheDocument();
  });

  it('displays total crafted count', () => {
    render(<StatsPanel stats={richStats} />);
    // 30 + 2 = 32
    expect(screen.getByText('32')).toBeInTheDocument();
    expect(screen.getByText('Crafted')).toBeInTheDocument();
  });

  it('renders Top Mined section with entries', () => {
    render(<StatsPanel stats={richStats} />);
    expect(screen.getByText('Top Mined')).toBeInTheDocument();
  });

  it('renders Top Crafted section', () => {
    render(<StatsPanel stats={richStats} />);
    expect(screen.getByText('Top Crafted')).toBeInTheDocument();
  });

  it('renders Kills section with entries', () => {
    render(<StatsPanel stats={richStats} />);
    expect(screen.getByText('Kills')).toBeInTheDocument();
  });

  it('shows stats heading even with minimal data', () => {
    const minimalStats = { ...emptyStats, deaths: 1 };
    render(<StatsPanel stats={minimalStats} />);
    expect(screen.getByText('Stats')).toBeInTheDocument();
    expect(screen.queryByText('No stats recorded yet')).not.toBeInTheDocument();
  });
});
