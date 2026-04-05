import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EquipmentDisplay } from '@/components/EquipmentDisplay';

const emptyArmor = {
  helmet: null,
  chestplate: null,
  leggings: null,
  boots: null,
};

const fullArmor = {
  helmet: { name: 'diamond_helmet', count: 1 },
  chestplate: { name: 'iron_chestplate', count: 1 },
  leggings: { name: 'leather_leggings', count: 1 },
  boots: { name: 'golden_boots', count: 1 },
};

const baseProps = {
  botName: 'TestBot',
  armor: emptyArmor,
  mainHand: null,
  offhand: null,
  accentColor: '#10B981',
};

describe('EquipmentDisplay', () => {
  it('renders all slot labels', () => {
    render(<EquipmentDisplay {...baseProps} />);
    expect(screen.getByText('Head')).toBeInTheDocument();
    expect(screen.getByText('Chest')).toBeInTheDocument();
    expect(screen.getByText('Legs')).toBeInTheDocument();
    expect(screen.getByText('Feet')).toBeInTheDocument();
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('renders bot skin image', () => {
    render(<EquipmentDisplay {...baseProps} botName="Steve" />);
    const img = screen.getByAltText('Steve');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://mc-heads.net/body/Steve/180');
  });

  it('renders equipped armor item names (last word)', () => {
    render(<EquipmentDisplay {...baseProps} armor={fullArmor} />);
    // formatItemName + split + last word gives: Helmet, Chestplate, Leggings, Boots
    expect(screen.getByText('Helmet')).toBeInTheDocument();
    expect(screen.getByText('Chestplate')).toBeInTheDocument();
    expect(screen.getByText('Leggings')).toBeInTheDocument();
    expect(screen.getByText('Boots')).toBeInTheDocument();
  });

  it('renders main hand item', () => {
    render(
      <EquipmentDisplay
        {...baseProps}
        mainHand={{ name: 'diamond_sword', count: 1 }}
      />,
    );
    expect(screen.getByText('Sword')).toBeInTheDocument();
  });

  it('renders offhand item', () => {
    render(
      <EquipmentDisplay
        {...baseProps}
        offhand={{ name: 'shield', count: 1 }}
      />,
    );
    expect(screen.getByText('Shield')).toBeInTheDocument();
  });

  it('shows count for stacked items', () => {
    render(
      <EquipmentDisplay
        {...baseProps}
        mainHand={{ name: 'torch', count: 32 }}
      />,
    );
    expect(screen.getByText('32')).toBeInTheDocument();
  });

  it('does not show count when count is 1', () => {
    render(
      <EquipmentDisplay
        {...baseProps}
        mainHand={{ name: 'diamond_sword', count: 1 }}
      />,
    );
    // Only "1" should not appear as a standalone count text
    const allText = screen.queryByText('1');
    expect(allText).toBeNull();
  });

  it('renders empty slot placeholders when no items equipped', () => {
    const { container } = render(<EquipmentDisplay {...baseProps} />);
    // Empty slots have opacity-20 placeholder text
    const placeholders = container.querySelectorAll('.opacity-20');
    expect(placeholders.length).toBeGreaterThan(0);
  });
});
