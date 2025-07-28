import { useEffect } from 'react';
import type { StoreApi } from 'zustand';
import type { WindowStoreState } from '../store/windowStoreFactory';
import { logger } from '../../utils/logger';

/**
 * Hook that synchronizes window store changes with the main process
 * for WebContentsView lifecycle management.
 */
export function useWindowLifecycleSync(
  activeStore: StoreApi<WindowStoreState>
) {
  useEffect(() => {
    // Check if window.api is available
    if (!window.api?.windowLifecycleStateChanged) {
      logger.warn('[useWindowLifecycleSync] window.api.windowLifecycleStateChanged not available');
      return;
    }

    const unsubscribe = activeStore.subscribe((state) => {
      try {
        // Send the current window state to the main process
        window.api.windowLifecycleStateChanged(state.windows);
        logger.debug(`[useWindowLifecycleSync] Sent window state changes: ${state.windows.length} windows`);
      } catch (error) {
        logger.error('[useWindowLifecycleSync] Error sending window state changes:', error);
      }
    });

    // Send initial state
    try {
      const initialState = activeStore.getState();
      window.api.windowLifecycleStateChanged(initialState.windows);
      logger.debug(`[useWindowLifecycleSync] Sent initial window state: ${initialState.windows.length} windows`);
    } catch (error) {
      logger.error('[useWindowLifecycleSync] Error sending initial window state:', error);
    }

    return unsubscribe;
  }, [activeStore]);
}