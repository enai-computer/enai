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

// Note: window.api is already mocked in test-setup/electron-mocks.ts
// We only need to update specific mock implementations here if needed
const mockGetRecentlyViewedNotebooks = window.api.getRecentlyViewedNotebooks as ReturnType<typeof vi.fn>;
const mockComposeNotebook = window.api.composeNotebook as ReturnType<typeof vi.fn>;
const mockSetIntent = window.api.setIntent as ReturnType<typeof vi.fn>;

// Set specific return values for these tests
mockGetRecentlyViewedNotebooks.mockResolvedValue([
  { id: '1', title: 'Test Notebook 1' },
  { id: '2', title: 'Test Notebook 2' },
]);
mockComposeNotebook.mockResolvedValue({ notebookId: '3' });
mockSetIntent.mockResolvedValue(undefined);

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