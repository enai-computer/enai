import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ClassicBrowserViewWrapper from '../ClassicBrowser';
import { 
  createMockWindowMeta, 
  createMockClassicBrowserTab
} from '../../../../../test-utils/classic-browser-mocks';
import { classicBrowserMocks, resetAllMocks } from '../../../../../test-setup/electron-mocks';

describe('ClassicBrowser Component', () => {
  let defaultProps: any;

  beforeEach(() => {
    resetAllMocks();

    defaultProps = {
      windowMeta: createMockWindowMeta(),
      activeStore: {
        getState: vi.fn().mockReturnValue({
          windows: [createMockWindowMeta()]
        }),
        subscribe: vi.fn(),
        setState: vi.fn()
      },
      contentGeometry: { x: 0, y: 0, width: 800, height: 600 },
      isActuallyVisible: true,
      isDragging: false,
      isResizing: false,
      sidebarState: 'collapsed'
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Browser Lifecycle', () => {
    it('should create and destroy browser view on mount/unmount', async () => {
      const { unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      await waitFor(() => {
        expect(window.api.classicBrowserCreate).toHaveBeenCalledWith(
          'window-1',
          expect.objectContaining({ initialUrl: 'https://example.com' })
        );
      });

      unmount();

      await waitFor(() => {
        expect(window.api.classicBrowserDestroy).toHaveBeenCalledWith('window-1');
      });
    });
  });

  describe('Browser State Updates', () => {
    it('should update UI when navigation occurs', async () => {
      render(<ClassicBrowserViewWrapper {...defaultProps} />);

      act(() => {
        classicBrowserMocks.onClassicBrowserState.triggerUpdate({
          windowId: 'window-1',
          update: {
            tab: {
              id: 'tab-1',
              url: 'https://newsite.com',
              title: 'New Site',
              faviconUrl: 'https://newsite.com/favicon.ico'
            }
          }
        });
      });

      await waitFor(() => {
        const addressBar = screen.getByPlaceholderText('Enter URL or search...');
        expect((addressBar as HTMLInputElement).value).toBe('https://newsite.com');
        
        const favicon = screen.getByAltText('Site favicon');
        expect(favicon.getAttribute('src')).toBe('https://newsite.com/favicon.ico');
      });
    });
  });

  describe('User Navigation', () => {
    it('should navigate when user enters URL', async () => {
      render(<ClassicBrowserViewWrapper {...defaultProps} />);

      const addressBar = screen.getByPlaceholderText('Enter URL or search...');
      fireEvent.change(addressBar, { target: { value: 'https://newurl.com' } });
      fireEvent.keyPress(addressBar, { key: 'Enter', code: 'Enter', charCode: 13 });

      await waitFor(() => {
        expect(window.api.classicBrowserLoadUrl).toHaveBeenCalledWith(
          'window-1',
          'tab-1',
          'https://newurl.com'
        );
      });
    });

    it('should handle navigation controls', async () => {
      const propsWithHistory = {
        ...defaultProps,
        windowMeta: createMockWindowMeta({
          payload: {
            tabs: [createMockClassicBrowserTab({ 
              canGoBack: true, 
              canGoForward: true 
            })],
            activeTabId: 'tab-1'
          }
        })
      };

      render(<ClassicBrowserViewWrapper {...propsWithHistory} />);

      // Test back navigation
      fireEvent.click(screen.getByLabelText('Go back'));
      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1', 'tab-1', 'back'
        );
      });

      // Test forward navigation
      fireEvent.click(screen.getByLabelText('Go forward'));
      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1', 'tab-1', 'forward'
        );
      });

      // Test reload
      fireEvent.click(screen.getByLabelText('Reload page'));
      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1', 'tab-1', 'reload'
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('should show error state and allow retry', async () => {
      const propsWithError = {
        ...defaultProps,
        windowMeta: createMockWindowMeta({
          payload: {
            tabs: [createMockClassicBrowserTab({ 
              error: 'Failed to load page',
              url: 'https://failed.com'
            })],
            activeTabId: 'tab-1'
          }
        })
      };

      render(<ClassicBrowserViewWrapper {...propsWithError} />);

      expect(screen.getByText('Failed to load page')).toBeTruthy();
      
      fireEvent.click(screen.getByText('Try Again'));
      
      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1', 'tab-1', 'reload'
        );
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading indicator during navigation', () => {
      const propsWithLoading = {
        ...defaultProps,
        windowMeta: createMockWindowMeta({
          payload: {
            tabs: [createMockClassicBrowserTab({ isLoading: true })],
            activeTabId: 'tab-1'
          }
        })
      };

      render(<ClassicBrowserViewWrapper {...propsWithLoading} />);
      expect(screen.getByTestId('loading-spinner')).toBeTruthy();
    });
    
    it('should show default icon when no favicon available', () => {
      render(<ClassicBrowserViewWrapper {...defaultProps} />);
      expect(screen.getByTestId('globe-icon')).toBeTruthy();
    });
  });

  describe('Window Management', () => {
    it('should update browser bounds when window resizes', async () => {
      const { rerender } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      rerender(<ClassicBrowserViewWrapper {...defaultProps} 
        contentGeometry={{ x: 100, y: 100, width: 1024, height: 768 }} 
      />);

      await waitFor(() => {
        expect(window.api.classicBrowserSetBounds).toHaveBeenCalledWith(
          'window-1',
          expect.objectContaining({ width: 1024 })
        );
      });
    });

    it('should toggle visibility based on window state', async () => {
      const { rerender } = render(
        <ClassicBrowserViewWrapper {...defaultProps} isActuallyVisible={false} />
      );

      await waitFor(() => {
        expect(window.api.classicBrowserSetVisibility).toHaveBeenCalledWith(
          'window-1', false
        );
      });

      rerender(<ClassicBrowserViewWrapper {...defaultProps} isActuallyVisible={true} />);

      await waitFor(() => {
        expect(window.api.classicBrowserSetVisibility).toHaveBeenCalledWith(
          'window-1', true
        );
      });
    });
  });

  describe('Component Cleanup', () => {
    it('should clean up event listeners on unmount', async () => {
      const { unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);
      
      unmount();
      
      expect(classicBrowserMocks.onClassicBrowserState._callbacks.length).toBe(0);
    });
  });
});
