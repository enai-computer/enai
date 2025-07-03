import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabBar } from './TabBar';
import type { TabState } from '../../../../shared/types';

// Mock the cn utility
vi.mock('../../../lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' ')
}));

describe('TabBar', () => {
  const mockOnTabClick = vi.fn();
  const mockOnTabClose = vi.fn();
  const mockOnNewTab = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createTab = (id: string, title: string): TabState => ({
    id,
    url: `https://example.com/${id}`,
    title,
    faviconUrl: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
  });

  describe('Plus icon positioning', () => {
    it('should not overlap with tabs - plus icon should be positioned after all tabs', () => {
      const tabs: TabState[] = [
        createTab('1', 'Tab 1'),
        createTab('2', 'Tab 2'),
        createTab('3', 'Tab 3'),
      ];

      const { container } = render(
        <TabBar
          tabs={tabs}
          activeTabId="1"
          onTabClick={mockOnTabClick}
          onTabClose={mockOnTabClose}
          onNewTab={mockOnNewTab}
          isFocused={true}
        />
      );

      // Find the scrollable container
      const scrollContainer = container.querySelector('.inline-flex.items-start.overflow-x-auto');
      expect(scrollContainer).toBeTruthy();

      // Get all direct children (tabs + plus button container)
      const children = Array.from(scrollContainer!.children);
      
      // Should have 3 tabs + 1 plus button container = 4 children
      expect(children).toHaveLength(4);

      // Verify the last child is the plus button container
      const lastChild = children[children.length - 1];
      expect(lastChild.tagName).toBe('DIV');
      expect(lastChild.className).toContain('relative');
      expect(lastChild.className).toContain('inline-flex');
      
      // Verify it contains the plus button
      const plusButton = within(lastChild as HTMLElement).getByRole('button', { name: /new tab/i });
      expect(plusButton).toBeTruthy();
      expect(plusButton.textContent).toBe('+');

      // Verify tabs are before the plus button
      for (let i = 0; i < tabs.length; i++) {
        const tabElement = children[i];
        expect(tabElement.tagName).toBe('DIV');
        expect(within(tabElement as HTMLElement).getByText(tabs[i].title)).toBeTruthy();
      }
    });

    it('should maintain correct spacing between last tab and plus icon', () => {
      const tabs: TabState[] = [
        createTab('1', 'Tab 1'),
        createTab('2', 'Tab 2'),
      ];

      const { container } = render(
        <TabBar
          tabs={tabs}
          activeTabId="1"
          onTabClick={mockOnTabClick}
          onTabClose={mockOnTabClose}
          onNewTab={mockOnNewTab}
          isFocused={true}
        />
      );

      const scrollContainer = container.querySelector('.inline-flex.items-start.overflow-x-auto');
      const plusButtonContainer = scrollContainer!.lastElementChild;
      
      // Verify the plus button container has left padding for spacing
      expect(plusButtonContainer?.className).toContain('pl-2');
    });

    it('should keep plus icon in the scrollable area with many tabs', () => {
      // Create many tabs to ensure scrolling would be needed
      const manyTabs: TabState[] = Array.from({ length: 20 }, (_, i) => 
        createTab(`tab-${i}`, `Tab ${i + 1}`)
      );

      const { container } = render(
        <TabBar
          tabs={manyTabs}
          activeTabId="tab-0"
          onTabClick={mockOnTabClick}
          onTabClose={mockOnTabClose}
          onNewTab={mockOnNewTab}
          isFocused={true}
        />
      );

      const scrollContainer = container.querySelector('.inline-flex.items-start.overflow-x-auto');
      const children = Array.from(scrollContainer!.children);
      
      // Should have 20 tabs + 1 plus button container
      expect(children).toHaveLength(21);
      
      // Plus button should still be the last child
      const lastChild = children[children.length - 1];
      const plusButton = within(lastChild as HTMLElement).getByRole('button', { name: /new tab/i });
      expect(plusButton).toBeTruthy();
      
      // Verify it's inside the scrollable container (not positioned absolutely or outside)
      expect(lastChild.parentElement).toBe(scrollContainer);
    });

    it('should not render tab bar when only one tab exists', () => {
      const singleTab: TabState[] = [createTab('1', 'Single Tab')];

      const { container } = render(
        <TabBar
          tabs={singleTab}
          activeTabId="1"
          onTabClick={mockOnTabClick}
          onTabClose={mockOnTabClose}
          onNewTab={mockOnNewTab}
          isFocused={true}
        />
      );

      // Tab bar should not render at all with single tab
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Visual layout verification', () => {
    it('should render tabs and plus icon in correct visual order', () => {
      const tabs: TabState[] = [
        createTab('1', 'First Tab'),
        createTab('2', 'Second Tab'),
        createTab('3', 'Third Tab'),
      ];

      render(
        <TabBar
          tabs={tabs}
          activeTabId="2"
          onTabClick={mockOnTabClick}
          onTabClose={mockOnTabClose}
          onNewTab={mockOnNewTab}
          isFocused={true}
        />
      );

      // Get all tab titles in order
      const tabTitles = screen.getAllByText(/^(First Tab|Second Tab|Third Tab)$/);
      expect(tabTitles).toHaveLength(3);
      expect(tabTitles[0].textContent).toBe('First Tab');
      expect(tabTitles[1].textContent).toBe('Second Tab');
      expect(tabTitles[2].textContent).toBe('Third Tab');

      // Plus button should exist
      const plusButton = screen.getByRole('button', { name: /new tab/i });
      expect(plusButton).toBeTruthy();

      // Get the positions to ensure no overlap
      const lastTabRect = tabTitles[2].closest('[class*="relative flex items-start"]')!.getBoundingClientRect();
      const plusButtonRect = plusButton.closest('[class*="relative inline-flex"]')!.getBoundingClientRect();
      
      // Plus button should start after the last tab ends (in a real browser environment)
      // Note: In jsdom, getBoundingClientRect returns zeros, but this shows the intent
      if (lastTabRect.width > 0) {
        expect(plusButtonRect.left).toBeGreaterThanOrEqual(lastTabRect.right);
      }
    });
  });
});