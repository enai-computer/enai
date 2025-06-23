import { useEffect, useCallback } from 'react';
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
    const unsubscribe = activeStore.subscribe(
      (state) => {
        const window = state.windows.find(w => w.id === windowId);
        return window?.isFocused;
      },
      (isFocused, prevIsFocused) => {
        if (isFocused === prevIsFocused) return;
        
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
    );

    return unsubscribe;
  }, [windowId, activeStore, getWindowMeta, setBrowserFreezeState]);

  // Watch for state changes and trigger side effects
  useEffect(() => {
    const unsubscribe = activeStore.subscribe(
      (state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (!window || window.type !== 'classic-browser') return undefined;
        const payload = window.payload as ClassicBrowserPayload;
        return payload.freezeState;
      },
      async (freezeState, prevFreezeState) => {
        if (!freezeState || freezeState === prevFreezeState) return;
        
        logger.debug(`[useBrowserWindowController] Freeze state changed for ${windowId}: ${freezeState.type}`);
        
        switch (freezeState.type) {
          case 'CAPTURING':
            // Capture the snapshot
            try {
              const snapshotUrl = await window.api.captureSnapshot(windowId);
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
            }
            break;
            
          case 'ACTIVE':
            // Show and focus the view
            try {
              await window.api.showAndFocusView(windowId);
            } catch (error) {
              logger.error(`[useBrowserWindowController] Error showing view for ${windowId}:`, error);
            }
            break;
        }
      }
    );

    return unsubscribe;
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