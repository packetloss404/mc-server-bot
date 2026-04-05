import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { SocketProvider } from '@/components/SocketProvider';
import { getSocket } from '@/lib/socket';

// Mock API
vi.mock('@/lib/api', () => ({
  api: {
    getBots: vi.fn().mockResolvedValue({ bots: [] }),
    getWorld: vi.fn().mockResolvedValue({ timeOfDay: 'day', isRaining: false }),
    getPlayers: vi.fn().mockResolvedValue({ players: [] }),
  },
}));

// Mock the store with individual function mocks
const storeMocks = {
  setBots: vi.fn(),
  updatePosition: vi.fn(),
  updateHealth: vi.fn(),
  updateState: vi.fn(),
  updateInventory: vi.fn(),
  pushEvent: vi.fn(),
  setConnected: vi.fn(),
  setWorld: vi.fn(),
  setPlayers: vi.fn(),
  updatePlayerPosition: vi.fn(),
  addPlayer: vi.fn(),
  removePlayer: vi.fn(),
  incrementUnreadChats: vi.fn(),
};

vi.mock('@/lib/store', () => ({
  useBotStore: vi.fn(() => storeMocks),
}));

import { api } from '@/lib/api';

describe('SocketProvider', () => {
  let mockSocket: Record<string, any>;
  const eventHandlers: Record<string, Function> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Set up mock socket that captures event handlers
    mockSocket = {
      on: vi.fn((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      }),
      off: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      connected: false,
    };
    vi.mocked(getSocket).mockReturnValue(mockSocket as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children', () => {
    const { getByText } = render(
      <SocketProvider>
        <div>Child Content</div>
      </SocketProvider>,
    );
    expect(getByText('Child Content')).toBeInTheDocument();
  });

  it('fetches initial data on mount', () => {
    render(
      <SocketProvider>
        <div />
      </SocketProvider>,
    );
    expect(api.getBots).toHaveBeenCalledTimes(1);
    expect(api.getWorld).toHaveBeenCalledTimes(1);
    expect(api.getPlayers).toHaveBeenCalledTimes(1);
  });

  it('registers socket event listeners', () => {
    render(
      <SocketProvider>
        <div />
      </SocketProvider>,
    );
    expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('bot:position', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('bot:health', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('bot:state', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('bot:inventory', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('activity', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('bot:chat', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('player:join', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('player:leave', expect.any(Function));
  });

  it('calls setConnected(true) on socket connect', () => {
    render(
      <SocketProvider>
        <div />
      </SocketProvider>,
    );
    eventHandlers['connect']();
    expect(storeMocks.setConnected).toHaveBeenCalledWith(true);
  });

  it('calls setConnected(false) on socket disconnect', () => {
    render(
      <SocketProvider>
        <div />
      </SocketProvider>,
    );
    eventHandlers['disconnect']();
    expect(storeMocks.setConnected).toHaveBeenCalledWith(false);
  });

  it('dispatches bot:position events to store', () => {
    render(
      <SocketProvider>
        <div />
      </SocketProvider>,
    );
    eventHandlers['bot:position']({ bot: 'TestBot', x: 10, y: 64, z: -20 });
    expect(storeMocks.updatePosition).toHaveBeenCalledWith('TestBot', 10, 64, -20);
  });

  it('dispatches bot:health events to store', () => {
    render(
      <SocketProvider>
        <div />
      </SocketProvider>,
    );
    eventHandlers['bot:health']({ bot: 'TestBot', health: 15, food: 18 });
    expect(storeMocks.updateHealth).toHaveBeenCalledWith('TestBot', 15, 18);
  });

  it('polls bots every 5 seconds', () => {
    render(
      <SocketProvider>
        <div />
      </SocketProvider>,
    );
    // Initial call
    expect(api.getBots).toHaveBeenCalledTimes(1);
    // Advance 5s
    vi.advanceTimersByTime(5000);
    expect(api.getBots).toHaveBeenCalledTimes(2);
    // Advance another 5s
    vi.advanceTimersByTime(5000);
    expect(api.getBots).toHaveBeenCalledTimes(3);
  });

  it('cleans up intervals and socket listeners on unmount', () => {
    const { unmount } = render(
      <SocketProvider>
        <div />
      </SocketProvider>,
    );
    unmount();
    expect(mockSocket.off).toHaveBeenCalledWith('connect');
    expect(mockSocket.off).toHaveBeenCalledWith('disconnect');
    expect(mockSocket.off).toHaveBeenCalledWith('bot:position');
    expect(mockSocket.off).toHaveBeenCalledWith('bot:health');
    expect(mockSocket.off).toHaveBeenCalledWith('bot:state');
    expect(mockSocket.off).toHaveBeenCalledWith('bot:inventory');
    expect(mockSocket.off).toHaveBeenCalledWith('activity');
    expect(mockSocket.off).toHaveBeenCalledWith('bot:chat');

    // Ensure polling stops (no more calls after unmount)
    const callCount = vi.mocked(api.getBots).mock.calls.length;
    vi.advanceTimersByTime(10000);
    expect(api.getBots).toHaveBeenCalledTimes(callCount);
  });

  it('increments unread chats on bot:chat event', () => {
    render(
      <SocketProvider>
        <div />
      </SocketProvider>,
    );
    eventHandlers['bot:chat']();
    expect(storeMocks.incrementUnreadChats).toHaveBeenCalledTimes(1);
  });
});
