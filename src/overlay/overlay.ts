// Lightweight context menu overlay script
import type { BrowserContextMenuData } from '../../shared/types/contextMenu.types';

interface MenuAction {
  windowId: string;
  action: string;
  context: BrowserContextMenuData;
}

interface MenuItem {
  label: string;
  action: string;
  enabled: boolean;
  type?: 'separator';
}

class ContextMenuOverlay {
  private windowId: string | null = null;
  private contextMenuData: BrowserContextMenuData | null = null;
  private menuElement: HTMLDivElement | null = null;
  private root: HTMLElement;
  private isShowingNewMenu: boolean = false;

  constructor() {
    console.log('[ContextMenuOverlay] Initializing overlay');
    
    // Get window ID from IPC - will be sent after page loads
    this.windowId = null;
    console.log('[ContextMenuOverlay] Waiting for window ID via IPC...');
    
    this.root = document.getElementById('context-menu-root')!;
    this.setupStyles();
    this.setupListeners();
    this.notifyReady();
  }

  private setupStyles(): void {
    // Set up transparent background
    Object.assign(document.body.style, {
      backgroundColor: 'transparent',
      pointerEvents: 'none',
      margin: '0',
      padding: '0',
      overflow: 'hidden',
      position: 'fixed',
      inset: '0'
    });

    // Add color system CSS variables and font faces
    const style = document.createElement('style');
    style.textContent = `
      @font-face {
        font-family: 'Soehne';
        src: url('./fonts/soehne-buch.woff2') format('woff2');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }
      
      @font-face {
        font-family: 'Soehne';
        src: url('./fonts/soehne-kraftig.woff2') format('woff2');
        font-weight: 500;
        font-style: normal;
        font-display: swap;
      }
      
      :root {
        /* Light mode colors */
        --step-1: #fdfdfc;
        --step-3: #f1f0ef;
        --step-6: #dad9d6;
        --step-11-5: #51504B;
      }
      
      @media (prefers-color-scheme: dark) {
        :root {
          /* Dark mode colors */
          --step-1: #111110;
          --step-3: #222221;
          --step-6: #3b3a37;
          --step-11-5: #D0CFCA;
        }
      }
      
      .dark {
        /* Dark mode colors when explicitly set */
        --step-1: #111110;
        --step-3: #222221;
        --step-6: #3b3a37;
        --step-11-5: #D0CFCA;
      }
    `;
    document.head.appendChild(style);
  }

  private setupListeners(): void {
    console.log('[ContextMenuOverlay] Setting up listeners');
    console.log('[ContextMenuOverlay] window.api available?', !!window.api);
    console.log('[ContextMenuOverlay] window.api.browserContextMenu available?', !!window.api?.browserContextMenu);
    
    // Listen for context menu data from main process
    if (window.api?.browserContextMenu) {
      window.api.browserContextMenu.onShow((data: BrowserContextMenuData) => {
        console.log('[ContextMenuOverlay] Received context menu data:', data);
        this.contextMenuData = data;
        this.showContextMenu(data);
      });
      console.log('[ContextMenuOverlay] Subscribed to onShow event');

      // Note: We don't listen for hide events from main process to avoid circular loops
      // The overlay manages its own hide behavior through click/escape handlers
    } else {
      console.error('[ContextMenuOverlay] window.api.browserContextMenu not available!');
      console.error('[ContextMenuOverlay] window.api:', window.api);
    }

    // Handle clicks outside the menu
    document.addEventListener('click', (e) => {
      if (this.menuElement && !this.menuElement.contains(e.target as Node)) {
        this.hideContextMenu();
      }
    });

    // Handle escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideContextMenu();
      }
    });
  }

  private notifyReady(): void {
    if (window.api?.browserContextMenu?.notifyReady) {
      window.api.browserContextMenu.notifyReady();
      console.log('[Overlay] Notified main process that overlay is ready');
    }
  }

  public setWindowId(windowId: string): void {
    this.windowId = windowId;
    console.log('[ContextMenuOverlay] Window ID set to:', windowId);
  }

  private showContextMenu(data: BrowserContextMenuData): void {
    // Hide any existing menu without notifying (we're about to show a new one)
    this.isShowingNewMenu = true;
    this.hideContextMenu();
    this.isShowingNewMenu = false;

    // Create menu container
    this.menuElement = document.createElement('div');
    this.menuElement.className = 'browser-context-menu';
    this.menuElement.style.cssText = `
      position: fixed;
      left: ${data.x}px;
      top: ${data.y}px;
      background: var(--step-1);
      border: 1px solid var(--step-3);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      padding: 4px 0;
      min-width: 200px;
      z-index: 10000;
      pointer-events: auto;
      font-family: 'Soehne', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create menu items based on context
    const items = this.getMenuItems(data);
    
    items.forEach((item) => {
      if (item.type === 'separator') {
        const separator = document.createElement('div');
        separator.style.cssText = `
          height: 1px;
          background: var(--step-6);
          margin: 4px 8px;
        `;
        this.menuElement!.appendChild(separator);
      } else {
        const menuItem = document.createElement('div');
        menuItem.className = 'menu-item';
        menuItem.textContent = item.label;
        menuItem.style.cssText = `
          padding: 8px 16px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 400;
          color: var(--step-11-5);
          white-space: nowrap;
          user-select: none;
          transition: background-color 0.1s ease;
        `;

        if (item.enabled === false) {
          menuItem.style.opacity = '0.4';
          menuItem.style.cursor = 'default';
        } else {
          menuItem.addEventListener('mouseenter', () => {
            menuItem.style.backgroundColor = 'var(--step-3)';
          });
          menuItem.addEventListener('mouseleave', () => {
            menuItem.style.backgroundColor = 'transparent';
          });
          menuItem.addEventListener('click', () => {
            this.handleMenuClick(item.action);
          });
        }

        this.menuElement!.appendChild(menuItem);
      }
    });

    // Add to DOM
    this.root.appendChild(this.menuElement);

    // Adjust position if menu would go off-screen
    requestAnimationFrame(() => {
      if (!this.menuElement) return;
      
      const rect = this.menuElement.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      if (rect.right > windowWidth) {
        this.menuElement.style.left = `${Math.max(0, data.x - rect.width)}px`;
      }
      if (rect.bottom > windowHeight) {
        this.menuElement.style.top = `${Math.max(0, data.y - rect.height)}px`;
      }
    });
  }

  private hideContextMenu(): void {
    if (this.menuElement) {
      this.menuElement.remove();
      this.menuElement = null;
    }
    this.contextMenuData = null;
    
    // Only notify main process if we're not about to show a new menu
    if (!this.isShowingNewMenu && window.api?.browserContextMenu?.notifyClosed) {
      window.api.browserContextMenu.notifyClosed();
    }
  }

  private getMenuItems(data: BrowserContextMenuData): MenuItem[] {
    const items: MenuItem[] = [];

    // Link context menu
    if (data.browserContext.linkURL) {
      items.push(
        { label: 'Open Link in New Tab', action: 'openInNewTab', enabled: true },
        { label: 'Open Link in Background', action: 'openInBackground', enabled: true },
        { type: 'separator' } as MenuItem,
        { label: 'Copy Link', action: 'copyLink', enabled: true }
      );
    }

    // Image context menu
    if (data.browserContext.srcURL && data.browserContext.mediaType === 'image') {
      if (items.length > 0) items.push({ type: 'separator' } as MenuItem);
      items.push(
        { label: 'Open Image in New Tab', action: 'openImageInNewTab', enabled: true },
        { label: 'Copy Image URL', action: 'copyImageURL', enabled: true },
        { label: 'Save Image As...', action: 'saveImageAs', enabled: true }
      );
    }

    // Text selection context menu
    if (data.browserContext.selectionText) {
      if (items.length > 0) items.push({ type: 'separator' } as MenuItem);
      const truncatedText = data.browserContext.selectionText.substring(0, 20) + (data.browserContext.selectionText.length > 20 ? '...' : '');
      items.push(
        { label: 'Copy', action: 'copy', enabled: true },
        { label: `Search for "${truncatedText}"`, action: 'searchSelection', enabled: true }
      );
    }

    // Page context menu (when nothing specific is clicked)
    if (items.length === 0) {
      items.push(
        { label: 'Back', action: 'goBack', enabled: data.browserContext.canGoBack ?? false },
        { label: 'Forward', action: 'goForward', enabled: data.browserContext.canGoForward ?? false },
        { label: 'Reload', action: 'reload', enabled: true },
        { type: 'separator' } as MenuItem,
        { label: 'Copy Page URL', action: 'copyPageURL', enabled: true },
        { label: 'View Page Source', action: 'viewSource', enabled: true }
      );
    }

    // Always add inspect element at the end
    items.push(
      { type: 'separator' } as MenuItem,
      { label: 'Inspect Element', action: 'inspect', enabled: true }
    );

    return items;
  }

  private handleMenuClick(action: string): void {
    console.log('[Overlay] Menu action clicked:', action);
    
    if (!this.windowId || !this.contextMenuData) return;

    // Send action to main process
    if (window.api?.browserContextMenu?.sendAction) {
      const menuAction: MenuAction = {
        windowId: this.windowId,
        action: action,
        context: this.contextMenuData
      };
      window.api.browserContextMenu.sendAction(action, menuAction);
    }

    // Hide menu after action
    this.hideContextMenu();
  }
}

// Initialize overlay when DOM is ready
let overlayInstance: ContextMenuOverlay;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    overlayInstance = new ContextMenuOverlay();
    (window as any).overlayInstance = overlayInstance;
  });
} else {
  overlayInstance = new ContextMenuOverlay();
  (window as any).overlayInstance = overlayInstance;
}