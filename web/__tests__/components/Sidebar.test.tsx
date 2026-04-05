import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/Sidebar';
import { usePathname } from 'next/navigation';

// Mock the store
vi.mock('@/lib/store', () => ({
  useBotStore: vi.fn((selector: any) => {
    const state = {
      connected: true,
      botList: [{ name: 'Bot1' }, { name: 'Bot2' }],
      playerList: [
        { name: 'Steve', isOnline: true },
        { name: 'Alex', isOnline: false },
      ],
      unreadChats: 0,
    };
    return selector(state);
  }),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/');
  });

  it('renders the DyoCraft brand', () => {
    render(<Sidebar />);
    expect(screen.getByText('DyoCraft')).toBeInTheDocument();
    expect(screen.getByText('Control Panel')).toBeInTheDocument();
  });

  it('renders all navigation items', () => {
    render(<Sidebar />);
    const navLabels = ['Dashboard', 'World Map', 'Social', 'Skills', 'Chat', 'Activity', 'Stats', 'Manage'];
    for (const label of navLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows Live when connected', () => {
    render(<Sidebar />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows Offline when disconnected', () => {
    const { useBotStore } = require('@/lib/store');
    useBotStore.mockImplementation((selector: any) => {
      const state = {
        connected: false,
        botList: [],
        playerList: [],
        unreadChats: 0,
      };
      return selector(state);
    });
    render(<Sidebar />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('shows bot and player counts when connected', () => {
    render(<Sidebar />);
    expect(screen.getByText('2 bots')).toBeInTheDocument();
    expect(screen.getByText('1 player')).toBeInTheDocument();
  });

  it('highlights the active nav item based on pathname', () => {
    vi.mocked(usePathname).mockReturnValue('/map');
    render(<Sidebar />);
    const mapLink = screen.getByText('World Map').closest('a')!;
    expect(mapLink.className).toContain('text-white');
  });

  it('does not highlight non-active nav items', () => {
    vi.mocked(usePathname).mockReturnValue('/');
    render(<Sidebar />);
    const statsLink = screen.getByText('Stats').closest('a')!;
    expect(statsLink.className).toContain('text-zinc-400');
  });

  it('shows unread chat badge when unreadChats > 0', () => {
    const { useBotStore } = require('@/lib/store');
    useBotStore.mockImplementation((selector: any) => {
      const state = {
        connected: true,
        botList: [],
        playerList: [],
        unreadChats: 5,
      };
      return selector(state);
    });
    render(<Sidebar />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('caps unread badge display at 9+', () => {
    const { useBotStore } = require('@/lib/store');
    useBotStore.mockImplementation((selector: any) => {
      const state = {
        connected: true,
        botList: [],
        playerList: [],
        unreadChats: 15,
      };
      return selector(state);
    });
    render(<Sidebar />);
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('renders version in footer', () => {
    render(<Sidebar />);
    expect(screen.getByText('DyoCraft v0.1.0')).toBeInTheDocument();
  });

  it('navigates to correct paths', () => {
    render(<Sidebar />);
    expect(screen.getByText('Dashboard').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('World Map').closest('a')).toHaveAttribute('href', '/map');
    expect(screen.getByText('Manage').closest('a')).toHaveAttribute('href', '/manage');
  });
});
