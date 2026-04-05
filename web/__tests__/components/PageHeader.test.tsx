import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '@/components/PageHeader';

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="World Map" />);
    // Title appears in breadcrumb AND as heading
    const headings = screen.getAllByText('World Map');
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('renders breadcrumb with Dashboard link', () => {
    render(<PageHeader title="Skills" />);
    const dashLink = screen.getByText('Dashboard');
    expect(dashLink.closest('a')).toHaveAttribute('href', '/');
  });

  it('renders subtitle when provided', () => {
    render(<PageHeader title="Bots" subtitle="Manage your fleet" />);
    expect(screen.getByText('Manage your fleet')).toBeInTheDocument();
  });

  it('does not render subtitle element when not provided', () => {
    const { container } = render(<PageHeader title="Stats" />);
    const subtitleEl = container.querySelector('.text-zinc-500.mt-1');
    expect(subtitleEl).toBeNull();
  });

  it('renders children in the action area', () => {
    render(
      <PageHeader title="Manage">
        <button>Create Bot</button>
      </PageHeader>,
    );
    expect(screen.getByText('Create Bot')).toBeInTheDocument();
  });

  it('renders breadcrumb separator', () => {
    render(<PageHeader title="Chat" />);
    expect(screen.getByText('/')).toBeInTheDocument();
  });

  it('renders without children', () => {
    render(<PageHeader title="Activity" />);
    expect(screen.getByText('Activity')).toBeInTheDocument();
  });
});
