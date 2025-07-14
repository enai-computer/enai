import { ContextMenuTarget } from '@shared/types';

/**
 * Utility functions for detecting context menu targets
 */

/**
 * Checks if an element is a link or has a link ancestor
 */
export function isLinkElement(element: Element): boolean {
  return element.closest('a[href]') !== null;
}

/**
 * Checks if an element is an image
 */
export function isImageElement(element: Element): boolean {
  return element.tagName === 'IMG';
}

/**
 * Checks if there is text selected in the document
 */
export function hasTextSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && selection.toString().trim().length > 0;
}

/**
 * Gets the selected text from the document
 */
export function getSelectedText(): string {
  const selection = window.getSelection();
  return selection?.toString().trim() || '';
}

/**
 * Finds the closest link element to the target
 */
export function getClosestLink(element: Element): HTMLAnchorElement | null {
  return element.closest('a[href]') as HTMLAnchorElement | null;
}

/**
 * Gets the container element for a text selection
 */
export function getSelectionContainer(): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  
  const range = selection.getRangeAt(0);
  return range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer as HTMLElement;
}

/**
 * Checks if the element is part of a browser tab component
 */
export function isBrowserTabElement(element: Element): boolean {
  return element.closest('[data-browser-tab-id]') !== null;
}

/**
 * Gets browser tab data from element
 */
export function getBrowserTabData(element: Element): { tabId: string; title: string; url: string; inMemory: boolean } | null {
  const tabElement = element.closest('[data-browser-tab-id]');
  if (!tabElement) return null;
  
  const tabId = tabElement.getAttribute('data-browser-tab-id');
  const title = tabElement.getAttribute('data-tab-title') || '';
  const url = tabElement.getAttribute('data-tab-url') || '';
  const inMemory = tabElement.getAttribute('data-tab-in-memory') === 'true';
  
  if (!tabId) return null;
  
  return { tabId, title, url, inMemory };
}

/**
 * Determines the context menu target based on the clicked element
 */
export function detectContextTarget(element: HTMLElement): ContextMenuTarget {
  const targets: ContextMenuTarget[] = [];
  
  // Check for text selection first (highest priority for mixed contexts)
  if (hasTextSelection()) {
    const text = getSelectedText();
    const container = getSelectionContainer();
    targets.push({
      type: 'text-selection',
      text,
      container: container || undefined,
      element
    });
  }
  
  // Check for browser tab
  if (isBrowserTabElement(element)) {
    const tabData = getBrowserTabData(element);
    if (tabData) {
      targets.push({
        type: 'browser-tab',
        ...tabData,
        element
      });
    }
  }
  
  // Check for link
  if (isLinkElement(element)) {
    const linkElement = getClosestLink(element);
    if (linkElement) {
      targets.push({
        type: 'link',
        url: linkElement.href,
        text: linkElement.textContent || undefined,
        element
      });
    }
  }
  
  // Check for image
  if (isImageElement(element)) {
    const img = element as HTMLImageElement;
    targets.push({
      type: 'image',
      src: img.src,
      alt: img.alt || undefined,
      element
    });
  }
  
  // Handle multiple targets (mixed context)
  if (targets.length > 1) {
    const primary = targets[0]; // Text selection takes priority
    const secondary = targets.slice(1);
    return {
      type: 'mixed',
      primary,
      secondary,
      element
    };
  }
  
  // Return single target or default
  return targets[0] || { type: 'default', element };
}