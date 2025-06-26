/**
 * Constants for media types used throughout the application.
 * These values must match the MediaType union in vector.types.ts
 * and the CHECK constraint in the SQLite objects table.
 */

import { MediaType } from '../types/vector.types';

/**
 * Object containing all valid media type values
 */
export const MEDIA_TYPES = {
  WEBPAGE: 'webpage',
  PDF: 'pdf',
  NOTEBOOK: 'notebook',
  NOTE: 'note',
  TAB_GROUP: 'tab_group',
  IMAGE: 'image'
} as const;

/**
 * Type guard to check if a string is a valid MediaType
 */
export function isValidMediaType(type: string): type is MediaType {
  return Object.values(MEDIA_TYPES).includes(type as MediaType);
}

/**
 * Get human-readable display name for a media type
 */
export function getMediaTypeDisplayName(type: MediaType): string {
  const displayNames: Record<MediaType, string> = {
    webpage: 'Web Page',
    pdf: 'PDF Document',
    notebook: 'Notebook',
    note: 'Note',
    tab_group: 'Tab Group',
    image: 'Image'
  };
  return displayNames[type] || type;
}