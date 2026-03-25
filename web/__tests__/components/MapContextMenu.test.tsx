import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MapContextMenu from '@/components/map/MapContextMenu';

describe('MapContextMenu', () => {
  it('offers zone creation for terrain targets', () => {
    const onCreateZone = vi.fn();

    render(
      <MapContextMenu
        target={{ type: 'terrain', worldX: 12, worldZ: 34 }}
        screenX={100}
        screenY={120}
        selectedBot="Ada"
        onClose={vi.fn()}
        onWalkHere={vi.fn()}
        onCreateMarker={vi.fn()}
        onCreateZone={onCreateZone}
        onCopyCoords={vi.fn()}
        onFollow={vi.fn()}
        onMoveToMarker={vi.fn()}
        onEditMarker={vi.fn()}
        onDeleteMarker={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Zone' }));
    expect(onCreateZone).toHaveBeenCalledWith(12, 34);
  });
});
