import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => {
  const React = require('react');
  const actual = {
    motion: new Proxy(
      {},
      {
        get: (_target: any, prop: string) => {
          return React.forwardRef((props: any, ref: any) => {
            const { initial, animate, exit, transition, variants, whileHover, whileTap, layoutId, ...rest } = props;
            return React.createElement(prop, { ...rest, ref });
          });
        },
      },
    ),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  };
  return actual;
});

// Mock next/link
vi.mock('next/link', () => {
  const React = require('react');
  return {
    default: React.forwardRef(({ children, href, ...props }: any, ref: any) => {
      return React.createElement('a', { href, ref, ...props }, children);
    }),
  };
});

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  })),
}));

// Mock socket.io
vi.mock('@/lib/socket', () => ({
  getSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  })),
}));
