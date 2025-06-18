import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpenInNotebookButton } from '../open-in-notebook-button';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock window.api
global.window.api = {
  getRecentlyViewedNotebooks: vi.fn().mockResolvedValue([
    { id: '1', title: 'Test Notebook 1' },
    { id: '2', title: 'Test Notebook 2' },
  ]),
  composeNotebook: vi.fn().mockResolvedValue({ notebookId: '3' }),
  setIntent: vi.fn().mockResolvedValue(undefined),
} as any;

describe('OpenInNotebookButton', () => {
  it('renders the button with correct text', () => {
    render(<OpenInNotebookButton url="https://example.com" />);
    expect(screen.getByText('Open in notebook')).toBeDefined();
  });

  it('accepts a custom className', () => {
    const { container } = render(
      <OpenInNotebookButton url="https://example.com" className="custom-class" />
    );
    const button = container.querySelector('button');
    expect(button?.className).toContain('custom-class');
  });

  it('renders with ExternalLink icon', () => {
    const { container } = render(<OpenInNotebookButton url="https://example.com" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeDefined();
  });
});