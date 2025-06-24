import { useEffect, useCallback, useRef } from 'react';
import type { StoreApi } from 'zustand';
import { logger } from '../../utils/logger';
import type { WindowStoreState } from '../store/windowStoreFactory';
import type { WindowMeta, ClassicBrowserPayload, BrowserFreezeState } from '../../shared/types/window.types';

/**
 * Controller hook that manages the browser window freeze/unfreeze state machine.
 * This is the single owner of all freeze/unfreeze logic, eliminating race conditions.
 */
export function useBrowserWindowController(
  windowId: string,
  activeStore: StoreApi<WindowStoreState>
) {
  // Lock to prevent concurrent operations (especially in React Strict Mode)
  const operationInProgress = useRef<boolean>(false);
  // Helper to get current window metadata
  const getWindowMeta = useCallback((): WindowMeta | undefined => {
    return activeStore.getState().windows.find(w => w.id === windowId);
  }, [windowId, activeStore]);

  // Helper to update the browser freeze state
  const setBrowserFreezeState = useCallback((newState: BrowserFreezeState) => {
    const currentMeta = getWindowMeta();
    if (!currentMeta || currentMeta.type !== 'classic-browser') {
      logger.warn(`[useBrowserWindowController] Cannot update freeze state for non-browser window ${windowId}`);
      return;
    }

    const currentPayload = currentMeta.payload as ClassicBrowserPayload;
    
    activeStore.getState().updateWindowProps(windowId, {
      payload: {
        ...currentPayload,
        freezeState: newState
      }
    });
    
    logger.debug(`[useBrowserWindowController] Updated freeze state for ${windowId} to ${newState.type}`);
  }, [windowId, activeStore, getWindowMeta]);

  // Watch for focus changes and trigger state transitions
  useEffect(() => {
    let previousFocused: boolean | undefined;
    
    const unsubscribe = activeStore.subscribe((state) => {
      const window = state.windows.find(w => w.id === windowId);
      const isFocused = window?.isFocused;
      
      // Check if focus changed
      if (isFocused !== previousFocused && previousFocused !== undefined) {
        const windowMeta = getWindowMeta();
        if (!windowMeta || windowMeta.type !== 'classic-browser') return;
        
        const payload = windowMeta.payload as ClassicBrowserPayload;
        
        if (!isFocused && payload.freezeState.type === 'ACTIVE') {
          // Window lost focus - start capture process
          logger.info(`[useBrowserWindowController] Window ${windowId} lost focus, starting capture`);
          setBrowserFreezeState({ type: 'CAPTURING' });
        } else if (isFocused && payload.freezeState.type !== 'ACTIVE') {
          // Window gained focus - activate it
          logger.info(`[useBrowserWindowController] Window ${windowId} gained focus, activating`);
          setBrowserFreezeState({ type: 'ACTIVE' });
        }
      }
      
      previousFocused = isFocused;
    });

    return unsubscribe;
  }, [windowId, activeStore, getWindowMeta, setBrowserFreezeState]);

  // Watch for state changes and trigger side effects
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let timeoutId: NodeJS.Timeout | undefined;
    
    // Wait for window.api to be available
    const checkApi = () => {
      if (!window.api) {
        logger.warn(`[useBrowserWindowController] window.api not available yet for ${windowId}, retrying...`);
        timeoutId = setTimeout(checkApi, 100);
        return;
      }
      
      // Capture the API reference
      const api = window.api;
      let previousFreezeState: BrowserFreezeState | undefined;
      
      unsubscribe = activeStore.subscribe(async (state) => {
        const windowState = state.windows.find(w => w.id === windowId);
        if (!windowState || windowState.type !== 'classic-browser') return;
        
        const payload = windowState.payload as ClassicBrowserPayload;
        const freezeState = payload.freezeState;
        
        // Check if freeze state changed
        if (previousFreezeState && freezeState.type !== previousFreezeState.type) {
          logger.debug(`[useBrowserWindowController] Freeze state changed for ${windowId}: ${freezeState.type}`);
          
          // Check if an operation is already in progress
          if (operationInProgress.current) {
            logger.debug(`[useBrowserWindowController] Operation already in progress for ${windowId}, skipping duplicate`);
            return;
          }
          
          switch (freezeState.type) {
            case 'CAPTURING':
              // Lock before async operation
              operationInProgress.current = true;
              
              // Capture the snapshot
              try {
                const snapshotUrl = await api.captureSnapshot(windowId);
                if (snapshotUrl) {
                  // Move to awaiting render state
                  setBrowserFreezeState({ type: 'AWAITING_RENDER', snapshotUrl });
                } else {
                  // Capture failed, go back to active
                  logger.error(`[useBrowserWindowController] Failed to capture snapshot for ${windowId}`);
                  setBrowserFreezeState({ type: 'ACTIVE' });
                }
              } catch (error) {
                logger.error(`[useBrowserWindowController] Error capturing snapshot for ${windowId}:`, error);
                setBrowserFreezeState({ type: 'ACTIVE' });
              } finally {
                // Always release the lock
                operationInProgress.current = false;
              }
              break;
              
            case 'ACTIVE':
              // Lock before async operation
              operationInProgress.current = true;
              
              // Show and focus the view
              try {
                await api.showAndFocusView(windowId);
              } catch (error) {
                logger.error(`[useBrowserWindowController] Error showing view for ${windowId}:`, error);
              } finally {
                // Always release the lock
                operationInProgress.current = false;
              }
              break;
          }
        }
        
        previousFreezeState = freezeState;
      });
    };
    
    // Start checking for API
    checkApi();
    
    // Cleanup
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
    };
  }, [windowId, activeStore, setBrowserFreezeState]);

  // Callback for when the snapshot has been rendered
  const handleSnapshotLoaded = useCallback(() => {
    const windowMeta = getWindowMeta();
    if (!windowMeta || windowMeta.type !== 'classic-browser') return;
    
    const payload = windowMeta.payload as ClassicBrowserPayload;
    
    if (payload.freezeState.type === 'AWAITING_RENDER') {
      logger.info(`[useBrowserWindowController] Snapshot rendered for ${windowId}, marking as frozen`);
      setBrowserFreezeState({ 
        type: 'FROZEN', 
        snapshotUrl: payload.freezeState.snapshotUrl 
      });
    }
  }, [windowId, getWindowMeta, setBrowserFreezeState]);

  return {
    handleSnapshotLoaded
  };
}