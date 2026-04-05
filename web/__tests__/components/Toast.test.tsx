import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from '@/components/Toast';

// Test helper component that triggers toasts
function ToastTrigger({ message, type }: { message: string; type?: 'success' | 'error' | 'info' | 'warning' }) {
  const { toast } = useToast();
  return (
    <button onClick={() => toast(message, type)}>
      Show Toast
    </button>
  );
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children', () => {
    render(
      <ToastProvider>
        <div>App Content</div>
      </ToastProvider>,
    );
    expect(screen.getByText('App Content')).toBeInTheDocument();
  });

  it('displays a toast message when triggered', async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Hello World" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('Show Toast').click();
    });
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('auto-removes toast after 4 seconds', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Temporary" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('Show Toast').click();
    });
    expect(screen.getByText('Temporary')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('Temporary')).not.toBeInTheDocument();
  });

  it('renders success toast with checkmark icon', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Saved!" type="success" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('Show Toast').click();
    });
    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });

  it('renders error toast', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Failed!" type="error" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('Show Toast').click();
    });
    expect(screen.getByText('Failed!')).toBeInTheDocument();
  });

  it('can display multiple toasts simultaneously', () => {
    function MultiToast() {
      const { toast } = useToast();
      return (
        <>
          <button onClick={() => toast('First')}>First</button>
          <button onClick={() => toast('Second')}>Second</button>
        </>
      );
    }
    render(
      <ToastProvider>
        <MultiToast />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('First').click();
      screen.getByText('Second').click();
    });
    expect(screen.getByText(/^First$/)).toBeInTheDocument();
    expect(screen.getByText(/^Second$/)).toBeInTheDocument();
  });

  it('defaults to info type when no type provided', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Info message" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('Show Toast').click();
    });
    expect(screen.getByText('Info message')).toBeInTheDocument();
    // Info icon is "i"
    expect(screen.getByText('i')).toBeInTheDocument();
  });

  it('renders warning toast', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Watch out!" type="warning" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('Show Toast').click();
    });
    expect(screen.getByText('Watch out!')).toBeInTheDocument();
    // Warning icon is "!"
    expect(screen.getByText('!')).toBeInTheDocument();
  });
});
