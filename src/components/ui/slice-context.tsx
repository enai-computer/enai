"use client"

import React from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { ContextState, DisplaySlice } from '../../../shared/types'; // Adjust path as needed
import { MarkdownRenderer } from './markdown-renderer'; // Assuming it's in the same directory
import { cn } from '@/lib/utils'; // For utility classes

interface SliceContextProps {
  contextState?: ContextState<DisplaySlice[]>;
  isNotebookCover?: boolean;
  onWebLayerOpen?: (url: string) => void; // For notebook cover
}

// Basic styling for the cards - can be refined
const cardStyle = "border rounded-md p-2 mb-2 bg-step-2/50 shadow-sm";
const titleStyle = "text-xs font-semibold mb-1 text-step-11";
const contentStyle = "text-xs text-step-12";
const linkStyle = "hover:underline text-step-11 dark:text-step-11"; // Links should be light in dark mode

export const SliceContext: React.FC<SliceContextProps> = ({ 
  contextState, 
  isNotebookCover = false,
  onWebLayerOpen
}) => {
  if (!contextState) {
    return null; // Nothing to render if no state provided
  }

  const { status, data: slices } = contextState;
  
  const handleSliceClick = async (e: React.MouseEvent<HTMLAnchorElement>, slice: DisplaySlice) => {
    e.preventDefault();
    
    // Check if this is a local PDF (has sourceObjectId and filename ends with .pdf)
    const isPdf = slice.sourceType === 'local' && 
                  slice.sourceObjectId && 
                  slice.sourceUri?.toLowerCase().endsWith('.pdf');
    
    if (isPdf && slice.sourceObjectId) {
      try {
        // Fetch the full object details to get the internal file path
        const object = await window.api?.getObjectById(slice.sourceObjectId);
        
        if (object && object.internalFilePath) {
          // Use file:// protocol to open the PDF
          const fileUrl = `file://${object.internalFilePath}`;
          
          if (isNotebookCover && onWebLayerOpen) {
            onWebLayerOpen(fileUrl);
          } else if (!isNotebookCover && window.api?.setIntent) {
            window.api.setIntent({
              intentText: `open ${fileUrl}`,
              context: 'notebook'
            });
          }
        } else {
          console.error('PDF object not found or missing internal file path');
        }
      } catch (error) {
        console.error('Error fetching PDF object:', error);
      }
    } else if (slice.sourceUri) {
      // Non-PDF or web content - use the sourceUri as before
      if (isNotebookCover && onWebLayerOpen) {
        onWebLayerOpen(slice.sourceUri);
      } else if (!isNotebookCover && window.api?.setIntent) {
        window.api.setIntent({
          intentText: `open ${slice.sourceUri}`,
          context: 'notebook'
        });
      }
    }
  };

  // Loading State
  if (status === 'loading') {
    return (
      <div className="mt-2 flex items-center text-xs text-step-10 p-2 border-t">
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        Loading context...
      </div>
    );
  }

  // Error State
  if (status === 'error') {
    return (
      <div className="mt-2 flex items-center text-xs text-destructive p-2 border-t">
        <AlertCircle className="mr-2 h-3 w-3" />
        Error loading context.
      </div>
    );
  }

  // Loaded State - with slices
  if (status === 'loaded' && slices && slices.length > 0) {
    return (
      <div className="mt-2 border-t pt-2">
        {/* Container for slice cards - using flex-wrap */}
        <div className="flex flex-wrap gap-2">
          {slices.map((slice) => (
            <div key={slice.id} className={cn(cardStyle, "flex-grow min-w-[200px]")} > {/* Using id as key */}
              {/* Source Title / Link */}
              <div className={titleStyle}>
                {slice.sourceUri ? (
                  <a
                    href={slice.sourceUri}
                    onClick={(e) => handleSliceClick(e, slice)}
                    className={linkStyle}
                    title={slice.sourceUri}
                  >
                    {slice.title || 'Untitled Source'}
                  </a>
                ) : (
                  slice.title || 'Untitled Source'
                )}
              </div>
              {/* Slice Content */}
              <div className={contentStyle}>
                 {/* Use MarkdownRenderer for content */}
                 {/* Be cautious if slice content contains complex markdown or interactive elements */}
                 <MarkdownRenderer>{slice.content}</MarkdownRenderer>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Loaded State - no slices, or Idle state
  // Render nothing in these cases according to the spec ("Otherwise, render nothing.")
  return null;
};

SliceContext.displayName = 'SliceContext';
