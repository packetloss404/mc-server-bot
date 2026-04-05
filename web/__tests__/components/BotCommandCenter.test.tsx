import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BotCommandCenter } from '@/components/BotCommandCenter';

// Mock the API module
vi.mock('@/lib/api', () => ({
  api: {
    pauseBot: vi.fn().mockResolvedValue({ success: true }),
    resumeBot: vi.fn().mockResolvedValue({ success: true }),
    stopBot: vi.fn().mockResolvedValue({ success: true }),
    followPlayer: vi.fn().mockResolvedValue({ success: true }),
    walkTo: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Mock the store
vi.mock('@/lib/store', () => ({
  useBotStore: vi.fn((selector: any) => {
    const state = {
      playerList: [
        { name: 'Steve', isOnline: true, position: null },
        { name: 'Alex', isOnline: false, position: null },
      ],
    };
    return selector(state);
  }),
}));

import { api } from '@/lib/api';

describe('BotCommandCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    botName: 'TestBot',
    state: 'EXECUTING_TASK',
    voyagerPaused: false,
    voyagerRunning: true,
    mode: 'codegen',
  };

  it('renders the Commands heading', () => {
    render(<BotCommandCenter {...defaultProps} />);
    expect(screen.getByText('Commands')).toBeInTheDocument();
  });

  it('renders Pause button when voyager is running and not paused', () => {
    render(<BotCommandCenter {...defaultProps} />);
    expect(screen.getByText('Pause')).toBeInTheDocument();
  });

  it('renders Resume button when voyager is paused', () => {
    render(<BotCommandCenter {...defaultProps} voyagerPaused={true} />);
    expect(screen.getByText('Resume')).toBeInTheDocument();
  });

  it('does not render Pause/Resume when not codegen mode', () => {
    render(<BotCommandCenter {...defaultProps} mode="primitive" />);
    expect(screen.queryByText('Pause')).not.toBeInTheDocument();
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
  });

  it('renders Stop, Follow, and Go To buttons', () => {
    render(<BotCommandCenter {...defaultProps} />);
    expect(screen.getByText('Stop')).toBeInTheDocument();
    expect(screen.getByText('Follow')).toBeInTheDocument();
    expect(screen.getByText('Go To')).toBeInTheDocument();
  });

  it('disables buttons when disconnected', () => {
    render(<BotCommandCenter {...defaultProps} state="DISCONNECTED" />);
    const stopBtn = screen.getByText('Stop').closest('button')!;
    expect(stopBtn).toBeDisabled();
  });

  it('calls pauseBot when Pause is clicked', async () => {
    const user = userEvent.setup();
    render(<BotCommandCenter {...defaultProps} />);
    await user.click(screen.getByText('Pause'));
    expect(api.pauseBot).toHaveBeenCalledWith('TestBot');
  });

  it('calls stopBot when Stop is clicked', async () => {
    const user = userEvent.setup();
    render(<BotCommandCenter {...defaultProps} state="WANDERING" />);
    await user.click(screen.getByText('Stop'));
    expect(api.stopBot).toHaveBeenCalledWith('TestBot');
  });

  it('toggles walk input when Go To is clicked', async () => {
    const user = userEvent.setup();
    render(<BotCommandCenter {...defaultProps} />);
    await user.click(screen.getByText('Go To'));
    expect(screen.getByPlaceholderText('x, z  or  x, y, z')).toBeInTheDocument();
  });

  it('submits walk coordinates', async () => {
    const user = userEvent.setup();
    render(<BotCommandCenter {...defaultProps} />);
    await user.click(screen.getByText('Go To'));
    const input = screen.getByPlaceholderText('x, z  or  x, y, z');
    await user.type(input, '100, 64, -200');
    await user.click(screen.getByText('Go'));
    expect(api.walkTo).toHaveBeenCalledWith('TestBot', 100, 64, -200);
  });

  it('toggles follow input and shows online players', async () => {
    const user = userEvent.setup();
    render(<BotCommandCenter {...defaultProps} />);
    await user.click(screen.getByText('Follow'));
    expect(screen.getByText('Select player to follow:')).toBeInTheDocument();
    // Only online players should appear
    expect(screen.getByText('Steve')).toBeInTheDocument();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
  });

  it('calls followPlayer when a player is selected', async () => {
    const user = userEvent.setup();
    render(<BotCommandCenter {...defaultProps} />);
    await user.click(screen.getByText('Follow'));
    await user.click(screen.getByText('Steve'));
    expect(api.followPlayer).toHaveBeenCalledWith('TestBot', 'Steve');
  });

  it('shows success feedback after command', async () => {
    const user = userEvent.setup();
    render(<BotCommandCenter {...defaultProps} state="WANDERING" />);
    await user.click(screen.getByText('Stop'));
    await waitFor(() => {
      expect(screen.getByText('Stop sent')).toBeInTheDocument();
    });
  });

  it('shows error feedback when command fails', async () => {
    vi.mocked(api.stopBot).mockRejectedValueOnce(new Error('Connection lost'));
    const user = userEvent.setup();
    render(<BotCommandCenter {...defaultProps} state="WANDERING" />);
    await user.click(screen.getByText('Stop'));
    await waitFor(() => {
      expect(screen.getByText('Connection lost')).toBeInTheDocument();
    });
  });
});
