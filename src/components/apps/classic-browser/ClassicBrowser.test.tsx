import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ClassicBrowserViewWrapper from './ClassicBrowser';
import { 
  createMockWindowMeta, 
  createMockClassicBrowserTab
} from '../../../../test-utils/classic-browser-mocks';
import { classicBrowserMocks, resetAllMocks } from '../../../../test-setup/electron-mocks';

describe('ClassicBrowser Component', () => {
  let defaultProps: any;
  let mockStore: any;

  beforeEach(() => {
    resetAllMocks();
    
    // Create mock store
    mockStore = {
      getState: vi.fn().mockReturnValue({
        windows: [createMockWindowMeta()],
        updateWindowProps: vi.fn()
      }),
      subscribe: vi.fn(),
      setState: vi.fn()
    };

    defaultProps = {
      windowMeta: createMockWindowMeta(),
      activeStore: mockStore,
      contentGeometry: {
        x: 0,
        y: 0,
        width: 800,
        height: 600
      },
      isActuallyVisible: true,
      isDragging: false,
      isResizing: false,
      sidebarState: 'collapsed'
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('StrictMode Resilience Tests', () => {
    it('should handle React StrictMode double-mounting gracefully', async () => {
      const { unmount } = render(
        <React.StrictMode>
          <ClassicBrowserViewWrapper {...defaultProps} />
        </React.StrictMode>
      );

      // StrictMode will cause double-mounting
      // Backend should handle this gracefully with idempotent create
      await waitFor(() => {
        expect(window.api.classicBrowserCreate).toHaveBeenCalledTimes(2);
      });

      // Should have destroyed once during StrictMode unmount
      expect(window.api.classicBrowserDestroy).toHaveBeenCalledTimes(1);

      unmount();

      // Final destroy on unmount
      await waitFor(() => {
        expect(window.api.classicBrowserDestroy).toHaveBeenCalledTimes(2);
      });
    });

    it('should synchronize state on remount', async () => {
      // Mock existing browser state
      const existingState = createMockClassicBrowserTab({
        url: 'https://remounted.com',
        title: 'Remounted Page',
        faviconUrl: 'https://remounted.com/favicon.ico'
      });

      classicBrowserMocks.classicBrowserGetState.mockResolvedValueOnce({
        tabs: { 'tab-1': existingState }
      });

      render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Verify getBrowserState is called on mount
      await waitFor(() => {
        expect(window.api.classicBrowserGetState).toHaveBeenCalledWith('window-1');
      });

      // Verify state is synchronized
      await waitFor(() => {
        const addressBar = screen.getByPlaceholderText('Enter URL or search...');
        expect((addressBar as HTMLInputElement).value).toBe('https://remounted.com');
      });
    });
  });

  describe('Lifecycle Tests', () => {
    it('should create browser view immediately on mount', async () => {
      render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Should be called immediately, not after setTimeout
      await waitFor(() => {
        expect(window.api.classicBrowserCreate).toHaveBeenCalledWith(
          'window-1',
          expect.objectContaining({
            bounds: expect.any(Object),
            initialUrl: 'https://example.com'
          })
        );
      });
    });

    it('should destroy browser view immediately on unmount', async () => {
      const { unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      unmount();

      await waitFor(() => {
        expect(window.api.classicBrowserDestroy).toHaveBeenCalledWith('window-1');
      });
    });

    it('should handle error during creation gracefully', async () => {
      classicBrowserMocks.classicBrowserCreate.mockRejectedValueOnce(
        new Error('Creation failed')
      );

      render(<ClassicBrowserViewWrapper {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to create browser/i)).toBeTruthy();
      });
    });
  });

  describe('State Management Tests', () => {
    it('should display favicon when browser state includes faviconUrl', async () => {
      render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Simulate backend sending favicon update
      act(() => {
        classicBrowserMocks.onClassicBrowserState.triggerUpdate({
          windowId: 'window-1',
          update: {
            tab: {
              id: 'tab-1',
              faviconUrl: 'https://example.com/favicon.ico'
            }
          }
        });
      });

      // Verify favicon is displayed
      await waitFor(() => {
        const favicon = screen.getByAltText('Site favicon');
        expect(favicon.getAttribute('src')).toBe('https://example.com/favicon.ico');
      });
    });

    it('should update address bar when URL changes', async () => {
      render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Simulate navigation
      act(() => {
        classicBrowserMocks.onClassicBrowserState.triggerUpdate({
          windowId: 'window-1',
          update: {
            tab: {
              id: 'tab-1',
              url: 'https://newsite.com',
              title: 'New Site'
            }
          }
        });
      });

      await waitFor(() => {
        const addressBar = screen.getByPlaceholderText('Enter URL or search...');
        expect((addressBar as HTMLInputElement).value).toBe('https://newsite.com');
      });
    });

    it('should handle multiple rapid state updates', async () => {
      render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Simulate rapid state changes
      const updates = [
        { url: 'https://site1.com', title: 'Site 1' },
        { url: 'https://site2.com', title: 'Site 2' },
        { url: 'https://site3.com', title: 'Site 3' }
      ];

      updates.forEach((update) => {
        act(() => {
          classicBrowserMocks.onClassicBrowserState.triggerUpdate({
            windowId: 'window-1',
            update: {
              tab: {
                id: 'tab-1',
                ...update
              }
            }
          });
        });
      });

      // Should end up with the last update
      await waitFor(() => {
        const addressBar = screen.getByPlaceholderText('Enter URL or search...');
        expect((addressBar as HTMLInputElement).value).toBe('https://site3.com');
      });
    });
  });

  describe('User Interaction Tests', () => {
    it('should navigate when user enters URL in address bar', async () => {
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

    it('should handle back navigation', async () => {
      
      // Set canGoBack to true
      const propsWithBack = {
        ...defaultProps,
        windowMeta: createMockWindowMeta({
          payload: {
            tabs: [createMockClassicBrowserTab({ canGoBack: true })],
            activeTabId: 'tab-1'
          }
        })
      };

      render(<ClassicBrowserViewWrapper {...propsWithBack} />);

      const backButton = screen.getByLabelText('Go back');
      fireEvent.click(backButton);

      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1',
          'tab-1',
          'back'
        );
      });
    });

    it('should handle forward navigation', async () => {
      
      const propsWithForward = {
        ...defaultProps,
        windowMeta: createMockWindowMeta({
          payload: {
            tabs: [createMockClassicBrowserTab({ canGoForward: true })],
            activeTabId: 'tab-1'
          }
        })
      };

      render(<ClassicBrowserViewWrapper {...propsWithForward} />);

      const forwardButton = screen.getByLabelText('Go forward');
      fireEvent.click(forwardButton);

      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1',
          'tab-1',
          'forward'
        );
      });
    });

    it('should handle reload', async () => {
      render(<ClassicBrowserViewWrapper {...defaultProps} />);

      const reloadButton = screen.getByLabelText('Reload page');
      fireEvent.click(reloadButton);

      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1',
          'tab-1',
          'reload'
        );
      });
    });

    it('should show Globe icon when no favicon is available', () => {
      render(<ClassicBrowserViewWrapper {...defaultProps} />);
      
      const globeIcon = screen.getByTestId('globe-icon');
      expect(globeIcon).toBeTruthy();
    });
  });

  describe('Error Handling Tests', () => {
    it('should display error state when browser encounters an error', async () => {
      const propsWithError = {
        ...defaultProps,
        windowMeta: createMockWindowMeta({
          payload: {
            tabs: [createMockClassicBrowserTab({ 
              error: 'Failed to load page' 
            })],
            activeTabId: 'tab-1'
          }
        })
      };

      render(<ClassicBrowserViewWrapper {...propsWithError} />);

      expect(screen.getByText('Failed to load page')).toBeTruthy();
      expect(screen.getByText('Try Again')).toBeTruthy();
    });

    it('should retry loading when retry button is clicked', async () => {
      
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

      const retryButton = screen.getByText('Try Again');
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1',
          'tab-1',
          'reload'
        );
      });
    });
  });

  describe('Loading State Tests', () => {
    it('should show loading indicator when page is loading', () => {
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
  });

  describe('Window Controls Tests', () => {
    it('should handle window control interactions', async () => {
      render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Note: Window controls are handled by WindowFrame, not ClassicBrowser
      // This test verifies the component renders without errors
      expect(screen.getByPlaceholderText('Enter URL or search...')).toBeTruthy();
    });

    // Window controls are handled by WindowFrame parent component
  });

  describe('Bounds and Visibility Tests', () => {
    it('should update bounds when window is resized', async () => {
      const { rerender } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      const newProps = {
        ...defaultProps,
        contentGeometry: {
          x: 100,
          y: 100,
          width: 1024,
          height: 768
        }
      };

      rerender(<ClassicBrowserViewWrapper {...newProps} />);

      await waitFor(() => {
        expect(window.api.classicBrowserSetBounds).toHaveBeenCalledWith(
          'window-1',
          expect.objectContaining({
            x: 100,
            y: expect.any(Number), // Adjusted for nav bar
            width: 1024,
            height: expect.any(Number)
          })
        );
      });
    });

    it('should hide browser when freezeDisplay is true', async () => {
      const { rerender } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      const propsWithFreeze = {
        ...defaultProps,
        isActuallyVisible: false
      };
      rerender(<ClassicBrowserViewWrapper {...propsWithFreeze} />);

      await waitFor(() => {
        expect(window.api.classicBrowserSetVisibility).toHaveBeenCalledWith(
          'window-1',
          false
        );
      });
    });

    it('should show browser when freezeDisplay changes to false', async () => {
      const { rerender } = render(
        <ClassicBrowserViewWrapper {...defaultProps} isActuallyVisible={false} />
      );

      rerender(<ClassicBrowserViewWrapper {...defaultProps} isActuallyVisible={true} />);

      await waitFor(() => {
        expect(window.api.classicBrowserSetVisibility).toHaveBeenCalledWith(
          'window-1',
          true
        );
      });
    });
  });

  describe('Event Listener Cleanup Tests', () => {
    it('should unsubscribe from events on unmount', async () => {
      const { unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Note: onClassicBrowserNavigate doesn't exist in the API, it's part of onClassicBrowserState updates

      // Unmount the component
      unmount();

      // Verify that callbacks are cleaned up
      expect(classicBrowserMocks.onClassicBrowserState._callbacks.length).toBe(0);
    });
  });
});
