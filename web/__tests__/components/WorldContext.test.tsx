import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorldContext } from '@/components/WorldContext';

const baseProps = {
  nearbyEntities: '',
  nearbyBlocks: '',
  biome: 'plains',
  timeOfDay: 'day',
  isRaining: false,
};

describe('WorldContext', () => {
  it('renders the World heading', () => {
    render(<WorldContext {...baseProps} />);
    expect(screen.getByText('World')).toBeInTheDocument();
  });

  it('displays biome name', () => {
    render(<WorldContext {...baseProps} biome="dark_forest" />);
    expect(screen.getByText('dark_forest')).toBeInTheDocument();
  });

  it('displays time of day', () => {
    render(<WorldContext {...baseProps} timeOfDay="night" />);
    expect(screen.getByText('night')).toBeInTheDocument();
  });

  it('shows Clear when not raining', () => {
    render(<WorldContext {...baseProps} isRaining={false} />);
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('shows Raining when raining', () => {
    render(<WorldContext {...baseProps} isRaining={true} />);
    expect(screen.getByText('Raining')).toBeInTheDocument();
  });

  it('renders nearby entities with distances', () => {
    render(
      <WorldContext
        {...baseProps}
        nearbyEntities="zombie (5m), player:Steve (12m), cow (8m)"
      />,
    );
    expect(screen.getByText('zombie')).toBeInTheDocument();
    expect(screen.getByText('5m')).toBeInTheDocument();
    expect(screen.getByText('Steve')).toBeInTheDocument();
    expect(screen.getByText('12m')).toBeInTheDocument();
    expect(screen.getByText('cow')).toBeInTheDocument();
    expect(screen.getByText('8m')).toBeInTheDocument();
  });

  it('shows entity count in header', () => {
    render(
      <WorldContext
        {...baseProps}
        nearbyEntities="zombie (5m), skeleton (10m)"
      />,
    );
    expect(screen.getByText('Nearby (2)')).toBeInTheDocument();
  });

  it('does not render entities section when empty', () => {
    render(<WorldContext {...baseProps} nearbyEntities="" />);
    expect(screen.queryByText(/Nearby/)).not.toBeInTheDocument();
  });

  it('does not render entities section for "none"', () => {
    render(<WorldContext {...baseProps} nearbyEntities="none" />);
    expect(screen.queryByText(/Nearby/)).not.toBeInTheDocument();
  });

  it('renders nearby blocks', () => {
    render(
      <WorldContext
        {...baseProps}
        nearbyBlocks="dirt, grass_block, stone"
      />,
    );
    expect(screen.getByText('Blocks')).toBeInTheDocument();
    expect(screen.getByText('dirt')).toBeInTheDocument();
    expect(screen.getByText('grass block')).toBeInTheDocument();
    expect(screen.getByText('stone')).toBeInTheDocument();
  });

  it('does not render blocks section when empty', () => {
    render(<WorldContext {...baseProps} nearbyBlocks="" />);
    expect(screen.queryByText('Blocks')).not.toBeInTheDocument();
  });

  it('strips "player:" prefix from entity display names', () => {
    render(
      <WorldContext
        {...baseProps}
        nearbyEntities="player:Alex (3m)"
      />,
    );
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.queryByText('player:Alex')).not.toBeInTheDocument();
  });

  it('handles entities without distance', () => {
    render(
      <WorldContext
        {...baseProps}
        nearbyEntities="zombie"
      />,
    );
    expect(screen.getByText('zombie')).toBeInTheDocument();
  });
});
