import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isLinkElement,
  isImageElement,
  hasTextSelection,
  getSelectedText,
  getClosestLink,
  isBrowserTabElement,
  getBrowserTabData,
  detectContextTarget
} from '../contextDetection';

// Mock window.getSelection
const mockGetSelection = vi.fn();
Object.defineProperty(window, 'getSelection', {
  value: mockGetSelection,
  writable: true
});

describe('contextDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('isLinkElement', () => {
    it('should return true for anchor elements', () => {
      const link = document.createElement('a');
      link.href = 'https://example.com';
      document.body.appendChild(link);
      
      expect(isLinkElement(link)).toBe(true);
    });

    it('should return true for elements inside anchor elements', () => {
      const link = document.createElement('a');
      link.href = 'https://example.com';
      const span = document.createElement('span');
      link.appendChild(span);
      document.body.appendChild(link);
      
      expect(isLinkElement(span)).toBe(true);
    });

    it('should return false for non-link elements', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      
      expect(isLinkElement(div)).toBe(false);
    });
  });

  describe('isImageElement', () => {
    it('should return true for img elements', () => {
      const img = document.createElement('img');
      expect(isImageElement(img)).toBe(true);
    });

    it('should return false for non-img elements', () => {
      const div = document.createElement('div');
      expect(isImageElement(div)).toBe(false);
    });
  });

  describe('hasTextSelection', () => {
    it('should return true when text is selected', () => {
      mockGetSelection.mockReturnValue({
        toString: () => 'selected text'
      });
      
      expect(hasTextSelection()).toBe(true);
    });

    it('should return false when no text is selected', () => {
      mockGetSelection.mockReturnValue({
        toString: () => ''
      });
      
      expect(hasTextSelection()).toBe(false);
    });

    it('should return false when selection is null', () => {
      mockGetSelection.mockReturnValue(null);
      
      expect(hasTextSelection()).toBe(false);
    });
  });

  describe('getSelectedText', () => {
    it('should return selected text', () => {
      mockGetSelection.mockReturnValue({
        toString: () => 'selected text'
      });
      
      expect(getSelectedText()).toBe('selected text');
    });

    it('should return empty string when no selection', () => {
      mockGetSelection.mockReturnValue(null);
      
      expect(getSelectedText()).toBe('');
    });
  });

  describe('isBrowserTabElement', () => {
    it('should return true for elements with browser tab data attribute', () => {
      const div = document.createElement('div');
      div.setAttribute('data-browser-tab-id', 'tab-123');
      document.body.appendChild(div);
      
      expect(isBrowserTabElement(div)).toBe(true);
    });

    it('should return true for child elements of browser tabs', () => {
      const container = document.createElement('div');
      container.setAttribute('data-browser-tab-id', 'tab-123');
      const child = document.createElement('span');
      container.appendChild(child);
      document.body.appendChild(container);
      
      expect(isBrowserTabElement(child)).toBe(true);
    });

    it('should return false for elements without browser tab data', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      
      expect(isBrowserTabElement(div)).toBe(false);
    });
  });

  describe('getBrowserTabData', () => {
    it('should extract browser tab data from element', () => {
      const div = document.createElement('div');
      div.setAttribute('data-browser-tab-id', 'tab-123');
      div.setAttribute('data-tab-title', 'Example Page');
      div.setAttribute('data-tab-url', 'https://example.com');
      div.setAttribute('data-tab-in-memory', 'true');
      document.body.appendChild(div);
      
      const result = getBrowserTabData(div);
      expect(result).toEqual({
        tabId: 'tab-123',
        title: 'Example Page',
        url: 'https://example.com',
        inMemory: true
      });
    });

    it('should return null for elements without tab data', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      
      expect(getBrowserTabData(div)).toBeNull();
    });
  });

  describe('detectContextTarget', () => {
    it('should detect link context', () => {
      const link = document.createElement('a');
      link.href = 'https://example.com';
      link.textContent = 'Example Link';
      document.body.appendChild(link);
      
      mockGetSelection.mockReturnValue({ toString: () => '' });
      
      const result = detectContextTarget(link);
      expect(result.type).toBe('link');
      if (result.type === 'link') {
        expect(result.url).toBe('https://example.com/');
        expect(result.text).toBe('Example Link');
      }
    });

    it('should detect image context', () => {
      const img = document.createElement('img');
      img.src = 'https://example.com/image.jpg';
      img.alt = 'Example Image';
      document.body.appendChild(img);
      
      mockGetSelection.mockReturnValue({ toString: () => '' });
      
      const result = detectContextTarget(img);
      expect(result.type).toBe('image');
      if (result.type === 'image') {
        expect(result.src).toBe('https://example.com/image.jpg');
        expect(result.alt).toBe('Example Image');
      }
    });

    it('should detect text selection context', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      
      mockGetSelection.mockReturnValue({
        toString: () => 'selected text',
        rangeCount: 1,
        getRangeAt: () => ({
          commonAncestorContainer: div
        })
      });
      
      const result = detectContextTarget(div);
      expect(result.type).toBe('text-selection');
      if (result.type === 'text-selection') {
        expect(result.text).toBe('selected text');
      }
    });

    it('should detect mixed context (text selection + link)', () => {
      const link = document.createElement('a');
      link.href = 'https://example.com';
      link.textContent = 'Example Link';
      document.body.appendChild(link);
      
      mockGetSelection.mockReturnValue({
        toString: () => 'selected text',
        rangeCount: 1,
        getRangeAt: () => ({
          commonAncestorContainer: link
        })
      });
      
      const result = detectContextTarget(link);
      expect(result.type).toBe('mixed');
      if (result.type === 'mixed') {
        expect(result.primary.type).toBe('text-selection');
        expect(result.secondary).toHaveLength(1);
        expect(result.secondary[0].type).toBe('link');
      }
    });

    it('should return default context for plain elements', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      
      mockGetSelection.mockReturnValue({ toString: () => '' });
      
      const result = detectContextTarget(div);
      expect(result.type).toBe('default');
    });
  });
});