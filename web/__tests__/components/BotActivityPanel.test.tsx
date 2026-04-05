import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BotActivityPanel } from '@/components/BotActivityPanel';

const baseProps = {
  state: 'IDLE',
  voyager: null,
  combat: undefined,
  health: 20,
  accentColor: '#10B981',
};

describe('BotActivityPanel', () => {
  it('renders the state label', () => {
    render(<BotActivityPanel {...baseProps} state="EXECUTING_TASK" />);
    expect(screen.getByText('Working')).toBeInTheDocument();
  });

  it('renders idle description for IDLE state', () => {
    render(<BotActivityPanel {...baseProps} />);
    expect(screen.getByText(/Idle/)).toBeInTheDocument();
  });

  it('renders disconnected description', () => {
    render(<BotActivityPanel {...baseProps} state="DISCONNECTED" />);
    expect(screen.getByText('Bot is offline')).toBeInTheDocument();
  });

  it('renders spawning description', () => {
    render(<BotActivityPanel {...baseProps} state="SPAWNING" />);
    expect(screen.getByText('Spawning into the world...')).toBeInTheDocument();
  });

  it('displays current task when voyager has one', () => {
    const voyager = {
      isRunning: true,
      isPaused: false,
      currentTask: 'Mine 10 diamonds',
      completedTasks: [],
      failedTasks: [],
    };
    render(<BotActivityPanel {...baseProps} voyager={voyager} />);
    expect(screen.getByText('Current Task')).toBeInTheDocument();
    expect(screen.getByText('Mine 10 diamonds')).toBeInTheDocument();
  });

  it('shows Running indicator when voyager is running', () => {
    const voyager = {
      isRunning: true,
      isPaused: false,
      currentTask: 'Build house',
      completedTasks: [],
      failedTasks: [],
    };
    render(<BotActivityPanel {...baseProps} state="EXECUTING_TASK" voyager={voyager} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('shows Paused indicator when voyager is paused', () => {
    const voyager = {
      isRunning: true,
      isPaused: true,
      currentTask: 'Build house',
      completedTasks: [],
      failedTasks: [],
    };
    render(<BotActivityPanel {...baseProps} state="EXECUTING_TASK" voyager={voyager} />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('shows queued task count', () => {
    const voyager = {
      isRunning: true,
      isPaused: false,
      currentTask: null,
      queuedTaskCount: 3,
      completedTasks: [],
      failedTasks: [],
    };
    render(<BotActivityPanel {...baseProps} voyager={voyager} />);
    expect(screen.getByText('3 tasks queued')).toBeInTheDocument();
  });

  it('shows singular "task" for count of 1', () => {
    const voyager = {
      isRunning: true,
      isPaused: false,
      currentTask: null,
      queuedTaskCount: 1,
      completedTasks: [],
      failedTasks: [],
    };
    render(<BotActivityPanel {...baseProps} voyager={voyager} />);
    expect(screen.getByText('1 task queued')).toBeInTheDocument();
  });

  it('displays combat alert when under attack', () => {
    const combat = {
      lastAttackerName: 'zombie',
      lastAttackedAt: Date.now(),
      instinctActive: true,
    };
    render(<BotActivityPanel {...baseProps} combat={combat} health={8} />);
    expect(screen.getByText(/Under attack/)).toBeInTheDocument();
    expect(screen.getByText(/zombie/)).toBeInTheDocument();
    expect(screen.getByText('8/20')).toBeInTheDocument();
  });

  it('does not show combat alert when instinct is inactive', () => {
    const combat = {
      lastAttackerName: 'zombie',
      lastAttackedAt: Date.now(),
      instinctActive: false,
    };
    render(<BotActivityPanel {...baseProps} combat={combat} />);
    expect(screen.queryByText(/Under attack/)).not.toBeInTheDocument();
  });

  it('shows completed and failed task counts', () => {
    const voyager = {
      isRunning: false,
      isPaused: false,
      currentTask: null,
      completedTasks: ['task1', 'task2', 'task3'],
      failedTasks: ['task4'],
    };
    render(<BotActivityPanel {...baseProps} voyager={voyager} />);
    expect(screen.getByText('3 completed')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
  });

  it('does not show task summary when no tasks have been attempted', () => {
    const voyager = {
      isRunning: false,
      isPaused: false,
      currentTask: null,
      completedTasks: [],
      failedTasks: [],
    };
    render(<BotActivityPanel {...baseProps} voyager={voyager} />);
    expect(screen.queryByText(/completed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
  });
});
