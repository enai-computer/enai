import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClassicBrowserViewManager } from '../../services/browser/ClassicBrowserViewManager';
import { BrowserEventBus } from '../../services/browser/BrowserEventBus';
import { WebContentsView, BrowserWindow } from 'electron';

// Mock Electron components
vi.mock('electron', () => ({
  WebContentsView: vi.fn(),
  BrowserWindow: {
    fromId: vi.fn(),
  },
}));

describe('ClassicBrowserViewManager', () => {
  let viewManager: ClassicBrowserViewManager;
  let mockEventBus: BrowserEventBus;
  let mockMainWindow: any;

  beforeEach(() => {
    mockEventBus = new BrowserEventBus();
    mockMainWindow = {
      addWebContentsView: vi.fn(),
      removeWebContentsView: vi.fn(),
    };
    (BrowserWindow.fromId as vi.Mock).mockReturnValue(mockMainWindow);

    viewManager = new ClassicBrowserViewManager({
      mainWindow: mockMainWindow,
      eventBus: mockEventBus,
    });
  });

  it('should create a new view', () => {
    const windowId = 'test-window';
    const mockView = { setBounds: vi.fn(), webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() } };
    (WebContentsView as any).mockImplementation(() => mockView);

    const view = viewManager.createView(windowId);

    expect(WebContentsView).toHaveBeenCalled();
    expect(view).toBe(mockView);
    expect(viewManager.getView(windowId)).toBe(mockView);
  });

  it('should not create a view if it already exists', () => {
    const windowId = 'test-window';
    const mockView = { setBounds: vi.fn(), webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() } };
    (WebContentsView as any).mockImplementation(() => mockView);

    const view1 = viewManager.createView(windowId);
    const view2 = viewManager.createView(windowId);

    expect(view1).toBe(view2);
    expect(WebContentsView).toHaveBeenCalledTimes(1);
  });

  it('should destroy a view', () => {
    const windowId = 'test-window';
    const mockView = {
      webContents: {
        isDestroyed: () => false,
        destroy: vi.fn(),
      },
    };
    (WebContentsView as any).mockImplementation(() => mockView);

    viewManager.createView(windowId);
    viewManager.destroyView(windowId);

    expect(mockView.webContents.destroy).toHaveBeenCalled();
    expect(viewManager.getView(windowId)).toBeUndefined();
  });
});
