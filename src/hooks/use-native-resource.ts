import { useRef, useEffect } from 'react';

/**
 * Hook for managing native resource lifecycle with StrictMode compatibility
 * 
 * This hook handles the creation and destruction of native resources (like BrowserViews)
 * with a 50ms delay to gracefully handle React StrictMode's double-mounting behavior.
 * 
 * @param onMount - Callback to create/initialize the native resource
 * @param onUnmount - Callback to destroy/cleanup the native resource
 * @param dependencies - Dependencies array that will trigger recreation when changed
 * @param options - Optional configuration
 */
export function useNativeResource<T = void>(
  onMount: () => T | Promise<T>,
  onUnmount: (resource?: T) => void | Promise<void>,
  dependencies: React.DependencyList,
  options?: {
    /** Delay in milliseconds before executing unmount (default: 50ms) */
    unmountDelay?: number;
    /** Whether to execute cleanup immediately on final unmount, bypassing the delay */
    immediateCleanupOnFinalUnmount?: boolean;
    /** Whether to log lifecycle events for debugging */
    debug?: boolean;
    /** Debug label for logging */
    debugLabel?: string;
  }
) {
  const unmountTimerRef = useRef<NodeJS.Timeout | null>(null);
  const resourceRef = useRef<T | undefined>(undefined);
  const isMountedRef = useRef(false);
  
  const { unmountDelay = 50, debug = false, debugLabel = 'NativeResource' } = options || {};

  useEffect(() => {
    // Cancel any pending destruction from a previous unmount (StrictMode)
    if (unmountTimerRef.current) {
      if (debug) console.log(`[${debugLabel}] Cancelling pending destruction timer`);
      clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = null;
    }

    // Mark as mounted
    isMountedRef.current = true;

    // Execute mount callback
    const mountResource = async () => {
      try {
        if (debug) console.log(`[${debugLabel}] Mounting resource`);
        const resource = await onMount();
        resourceRef.current = resource;
        if (debug) console.log(`[${debugLabel}] Resource mounted successfully`, resource);
      } catch (error) {
        console.error(`[${debugLabel}] Error mounting resource:`, error);
      }
    };

    mountResource();

    // Cleanup function
    return () => {
      if (debug) console.log(`[${debugLabel}] Cleanup triggered, scheduling delayed unmount`);
      
      // Mark as unmounted
      isMountedRef.current = false;
      
      // Clear any existing timer before setting a new one
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
      }

      // Schedule destruction with a delay to handle React StrictMode gracefully
      unmountTimerRef.current = setTimeout(async () => {
        if (debug) console.log(`[${debugLabel}] Executing delayed unmount`);
        try {
          await onUnmount(resourceRef.current);
          resourceRef.current = undefined;
          if (debug) console.log(`[${debugLabel}] Resource unmounted successfully`);
        } catch (error) {
          console.error(`[${debugLabel}] Error unmounting resource:`, error);
        }
        unmountTimerRef.current = null;
      }, unmountDelay);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  // Final cleanup effect to ensure timer is cleared on component unmount
  useEffect(() => {
    return () => {
      // This runs only on final unmount when component is removed from tree
      if (unmountTimerRef.current) {
        if (debug) console.log(`[${debugLabel}] Final cleanup: clearing unmount timer`);
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
        
        // If configured, execute cleanup immediately on final unmount
        if (options?.immediateCleanupOnFinalUnmount) {
          if (debug) console.log(`[${debugLabel}] Final unmount: executing immediate cleanup`);
          const executeCleanup = async () => {
            try {
              await onUnmount(resourceRef.current);
              if (debug) console.log(`[${debugLabel}] Final unmount cleanup completed successfully`);
            } catch (error) {
              console.error(`[${debugLabel}] Error during final unmount cleanup:`, error);
            }
          };
          executeCleanup();
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps means this only runs on final unmount

  return {
    /** Whether the resource is currently mounted */
    isMounted: isMountedRef.current,
    /** Reference to the resource (if any was returned by onMount) */
    resource: resourceRef.current,
  };
}

