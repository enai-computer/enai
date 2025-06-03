"use client"

import React from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
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
const titleStyle = "text-xs font-bold mb-1 text-step-11";
const contentStyle = "text-xs text-step-12";
const linkStyle = "hover:underline hover:text-birkin text-step-11 dark:text-step-11 transition-colors duration-200"; // Links should be light in dark mode

// Notebook cover specific styles
const notebookCoverCardStyle = "border rounded-md p-2 mb-2 bg-step-3 shadow-sm";
const notebookCoverTitleStyle = "text-xs font-bold mb-1 text-step-12";
const notebookCoverContentStyle = "text-xs text-step-11-5";
const notebookCoverLinkStyle = "hover:underline hover:text-birkin text-step-12 transition-colors duration-200";

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
    const currentCardStyle = isNotebookCover ? notebookCoverCardStyle : cardStyle;
    const currentTitleStyle = isNotebookCover ? notebookCoverTitleStyle : titleStyle;
    const currentContentStyle = isNotebookCover ? notebookCoverContentStyle : contentStyle;
    const currentLinkStyle = isNotebookCover ? notebookCoverLinkStyle : linkStyle;
    
    return (
      <motion.div 
        className={cn("pt-2", !isNotebookCover && "border-t", isNotebookCover ? "mt-20 pr-16" : "mt-2")}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {/* Container for slice cards - using flex-wrap */}
        <div className="flex flex-wrap gap-2">
          {slices.map((slice, index) => (
            <motion.div 
              key={slice.id} 
              className={cn(currentCardStyle, "flex-grow min-w-[200px]")}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ 
                duration: 0.6,
                delay: index * 0.1,
                ease: "easeOut"
              }}
            >
              {/* Source Title / Link */}
              <div className={currentTitleStyle}>
                {slice.sourceUri ? (
                  <a
                    href={slice.sourceUri}
                    onClick={(e) => handleSliceClick(e, slice)}
                    className={currentLinkStyle}
                    title={slice.sourceUri}
                  >
                    {slice.title || 'Untitled Source'}
                  </a>
                ) : (
                  slice.title || 'Untitled Source'
                )}
              </div>
              {/* Slice Content */}
              <div className={currentContentStyle}>
                 {/* Use MarkdownRenderer for content */}
                 {/* Be cautious if slice content contains complex markdown or interactive elements */}
                 <MarkdownRenderer>{slice.summary || slice.content}</MarkdownRenderer>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    );
  }

  // Loaded State - no slices, or Idle state
  // Render nothing in these cases according to the spec ("Otherwise, render nothing.")
  return null;
};

SliceContext.displayName = 'SliceContext';
