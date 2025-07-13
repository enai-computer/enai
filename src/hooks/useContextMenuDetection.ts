import { useState, useCallback, useEffect } from 'react';
import { ContextMenuEvent, UseContextMenuDetection, ContextMenuConfig, DEFAULT_CONTEXT_MENU_CONFIG } from '@shared/types';
import { detectContextTarget } from '@/utils/contextDetection';

/**
 * Hook for detecting and managing context menu events
 */
export function useContextMenuDetection(
  config: Partial<ContextMenuConfig> = {}
): UseContextMenuDetection {
  const [contextMenuEvent, setContextMenuEvent] = useState<ContextMenuEvent | null>(null);
  const finalConfig = { ...DEFAULT_CONTEXT_MENU_CONFIG, ...config };

  const clearContextMenu = useCallback(() => {
    setContextMenuEvent(null);
  }, []);

  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    
    const target = event.target as HTMLElement;
    if (!target) return;

    // Detect what was right-clicked
    const contextTarget = detectContextTarget(target);
    
    // Filter based on configuration
    if (!shouldShowContextMenu(contextTarget.type, finalConfig)) {
      return;
    }

    const contextEvent: ContextMenuEvent = {
      target: contextTarget,
      position: {
        x: event.clientX,
        y: event.clientY
      },
      preventDefault: () => event.preventDefault()
    };

    setContextMenuEvent(contextEvent);
  }, [finalConfig]);

  const handleClickOutside = useCallback((event: MouseEvent) => {
    // Close context menu when clicking outside
    if (contextMenuEvent) {
      setContextMenuEvent(null);
    }
  }, [contextMenuEvent]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Close context menu on Escape
    if (event.key === 'Escape' && contextMenuEvent) {
      setContextMenuEvent(null);
    }
  }, [contextMenuEvent]);

  useEffect(() => {
    // Add event listeners
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      // Cleanup event listeners
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleContextMenu, handleClickOutside, handleKeyDown]);

  return {
    contextMenuEvent,
    clearContextMenu
  };
}

/**
 * Determines if a context menu should be shown based on the target type and configuration
 */
function shouldShowContextMenu(
  targetType: string,
  config: ContextMenuConfig
): boolean {
  switch (targetType) {
    case 'text-selection':
      return config.enableTextSelection;
    case 'link':
      return config.enableLinkActions;
    case 'image':
      return config.enableImageActions;
    case 'browser-tab':
      return config.enableBrowserTabActions;
    case 'mixed':
      // For mixed contexts, show if any of the components are enabled
      return true;
    case 'default':
      // Always show default context menu
      return true;
    default:
      return false;
  }
}