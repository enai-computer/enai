import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClassicBrowser } from './ClassicBrowser';
import { 
  createMockWindowMeta, 
  createMockBrowserStateUpdate,
  createMockClassicBrowserTab
} from '../../../../test-utils/classic-browser-mocks';
import { classicBrowserMocks, resetAllMocks } from '../../../../test-setup/electron-mocks';

describe('ClassicBrowser Component', () => {
  let defaultProps: any;

  beforeEach(() => {
    resetAllMocks();
    defaultProps = {
      windowMeta: createMockWindowMeta(),
      isDragging: false,
      isResizing: false,
      freezeDisplay: false,
      onClose: vi.fn(),
      onMinimize: vi.fn(),
      onMaximize: vi.fn(),
      isMinimized: false,
      isMaximized: false
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('StrictMode Resilience Tests', () => {
    it('should handle React StrictMode double-mounting gracefully', async () => {
      const { unmount } = render(
        <React.StrictMode>
          <ClassicBrowser {...defaultProps} />
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

      render(<ClassicBrowser {...defaultProps} />);

      // Verify getBrowserState is called on mount
      await waitFor(() => {
        expect(window.api.classicBrowserGetState).toHaveBeenCalledWith('window-1');
      });

      // Verify state is synchronized
      await waitFor(() => {
        const addressBar = screen.getByPlaceholderText('Enter URL or search...');
        expect(addressBar).toHaveValue('https://remounted.com');
      });
    });
  });

  describe('Lifecycle Tests', () => {
    it('should create browser view immediately on mount', async () => {
      render(<ClassicBrowser {...defaultProps} />);

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
      const { unmount } = render(<ClassicBrowser {...defaultProps} />);

      unmount();

      await waitFor(() => {
        expect(window.api.classicBrowserDestroy).toHaveBeenCalledWith('window-1');
      });
    });

    it('should handle error during creation gracefully', async () => {
      classicBrowserMocks.classicBrowserCreate.mockRejectedValueOnce(
        new Error('Creation failed')
      );

      render(<ClassicBrowser {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to create browser/i)).toBeInTheDocument();
      });
    });
  });

  describe('State Management Tests', () => {
    it('should display favicon when browser state includes faviconUrl', async () => {
      render(<ClassicBrowser {...defaultProps} />);

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
        expect(favicon).toHaveAttribute('src', 'https://example.com/favicon.ico');
      });
    });

    it('should update address bar when URL changes', async () => {
      render(<ClassicBrowser {...defaultProps} />);

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
        expect(addressBar).toHaveValue('https://newsite.com');
      });
    });

    it('should handle multiple rapid state updates', async () => {
      render(<ClassicBrowser {...defaultProps} />);

      // Simulate rapid state changes
      const updates = [
        { url: 'https://site1.com', title: 'Site 1' },
        { url: 'https://site2.com', title: 'Site 2' },
        { url: 'https://site3.com', title: 'Site 3' }
      ];

      updates.forEach((update, index) => {
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
        expect(addressBar).toHaveValue('https://site3.com');
      });
    });
  });

  describe('User Interaction Tests', () => {
    it('should navigate when user enters URL in address bar', async () => {
      const user = userEvent.setup();
      render(<ClassicBrowser {...defaultProps} />);

      const addressBar = screen.getByPlaceholderText('Enter URL or search...');
      
      await user.clear(addressBar);
      await user.type(addressBar, 'https://newurl.com{enter}');

      await waitFor(() => {
        expect(window.api.classicBrowserLoadUrl).toHaveBeenCalledWith(
          'window-1',
          'tab-1',
          'https://newurl.com'
        );
      });
    });

    it('should handle back navigation', async () => {
      const user = userEvent.setup();
      
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

      render(<ClassicBrowser {...propsWithBack} />);

      const backButton = screen.getByLabelText('Go back');
      await user.click(backButton);

      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1',
          'tab-1',
          'back'
        );
      });
    });

    it('should handle forward navigation', async () => {
      const user = userEvent.setup();
      
      const propsWithForward = {
        ...defaultProps,
        windowMeta: createMockWindowMeta({
          payload: {
            tabs: [createMockClassicBrowserTab({ canGoForward: true })],
            activeTabId: 'tab-1'
          }
        })
      };

      render(<ClassicBrowser {...propsWithForward} />);

      const forwardButton = screen.getByLabelText('Go forward');
      await user.click(forwardButton);

      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1',
          'tab-1',
          'forward'
        );
      });
    });

    it('should handle reload', async () => {
      const user = userEvent.setup();
      render(<ClassicBrowser {...defaultProps} />);

      const reloadButton = screen.getByLabelText('Reload page');
      await user.click(reloadButton);

      await waitFor(() => {
        expect(window.api.classicBrowserNavigate).toHaveBeenCalledWith(
          'window-1',
          'tab-1',
          'reload'
        );
      });
    });

    it('should show Globe icon when no favicon is available', () => {
      render(<ClassicBrowser {...defaultProps} />);
      
      const globeIcon = screen.getByTestId('globe-icon');
      expect(globeIcon).toBeInTheDocument();
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

      render(<ClassicBrowser {...propsWithError} />);

      expect(screen.getByText('Failed to load page')).toBeInTheDocument();
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('should retry loading when retry button is clicked', async () => {
      const user = userEvent.setup();
      
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

      render(<ClassicBrowser {...propsWithError} />);

      const retryButton = screen.getByText('Try Again');
      await user.click(retryButton);

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

      render(<ClassicBrowser {...propsWithLoading} />);
      
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });
  });

  describe('Window Controls Tests', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      render(<ClassicBrowser {...defaultProps} />);

      const closeButton = screen.getByLabelText('Close');
      await user.click(closeButton);

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should call onMinimize when minimize button is clicked', async () => {
      const user = userEvent.setup();
      render(<ClassicBrowser {...defaultProps} />);

      const minimizeButton = screen.getByLabelText('Minimize');
      await user.click(minimizeButton);

      expect(defaultProps.onMinimize).toHaveBeenCalled();
    });

    it('should call onMaximize when maximize button is clicked', async () => {
      const user = userEvent.setup();
      render(<ClassicBrowser {...defaultProps} />);

      const maximizeButton = screen.getByLabelText('Maximize');
      await user.click(maximizeButton);

      expect(defaultProps.onMaximize).toHaveBeenCalled();
    });
  });

  describe('Bounds and Visibility Tests', () => {
    it('should update bounds when window is resized', async () => {
      const { rerender } = render(<ClassicBrowser {...defaultProps} />);

      const newProps = {
        ...defaultProps,
        windowMeta: {
          ...defaultProps.windowMeta,
          x: 100,
          y: 100,
          width: 1024,
          height: 768
        }
      };

      rerender(<ClassicBrowser {...newProps} />);

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
      const { rerender } = render(<ClassicBrowser {...defaultProps} />);

      rerender(<ClassicBrowser {...defaultProps} freezeDisplay={true} />);

      await waitFor(() => {
        expect(window.api.classicBrowserSetVisibility).toHaveBeenCalledWith(
          'window-1',
          false
        );
      });
    });

    it('should show browser when freezeDisplay changes to false', async () => {
      const { rerender } = render(
        <ClassicBrowser {...defaultProps} freezeDisplay={true} />
      );

      rerender(<ClassicBrowser {...defaultProps} freezeDisplay={false} />);

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
      const { unmount } = render(<ClassicBrowser {...defaultProps} />);

      // Get the unsubscribe functions
      const unsubscribeState = window.api.onClassicBrowserState.mock.results[0].value;
      const unsubscribeNavigate = window.api.onClassicBrowserNavigate.mock.results[0].value;

      // Mock them to track calls
      const mockUnsubState = vi.fn();
      const mockUnsubNavigate = vi.fn();
      window.api.onClassicBrowserState.mockReturnValueOnce(mockUnsubState);
      window.api.onClassicBrowserNavigate.mockReturnValueOnce(mockUnsubNavigate);

      // Remount and unmount to test cleanup
      const { unmount: unmount2 } = render(<ClassicBrowser {...defaultProps} />);
      unmount2();

      // Original unsubscribe functions should be called
      expect(classicBrowserMocks.onClassicBrowserState._callbacks.length).toBe(0);
      expect(classicBrowserMocks.onClassicBrowserNavigate._callbacks.length).toBe(0);
    });
  });
});