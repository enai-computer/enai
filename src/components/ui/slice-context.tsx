"use client"

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { ContextState, SliceDetail } from '../../../shared/types'; // Adjust path as needed
import { MarkdownRenderer } from './markdown-renderer'; // Assuming it's in the same directory
import { cn } from '@/lib/utils'; // For utility classes

interface SliceContextProps {
  contextState?: ContextState;
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
  
  const handleSliceClick = async (e: React.MouseEvent<HTMLAnchorElement>, slice: SliceDetail) => {
    e.preventDefault();
    
    // Check if this is a local PDF (has sourceObjectId and filename ends with .pdf)
    const isPdf = slice.sourceObjectId && 
                  slice.sourceObjectUri?.toLowerCase().endsWith('.pdf');
    
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
    } else if (slice.sourceObjectUri) {
      // Non-PDF or web content - use the sourceObjectUri as before
      if (isNotebookCover && onWebLayerOpen) {
        onWebLayerOpen(slice.sourceObjectUri);
      } else if (!isNotebookCover && window.api?.setIntent) {
        window.api.setIntent({
          intentText: `open ${slice.sourceObjectUri}`,
          context: 'notebook'
        });
      }
    }
  };

  // Loading State - render nothing
  if (status === 'loading') {
    return null;
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
              key={slice.chunkId} 
              className={cn(currentCardStyle, "flex-grow min-w-[200px]")}
              initial={{ opacity: 0 }}
              animate={{ 
                opacity: [0, 0.8, 1]
              }}
              transition={{ 
                duration: 1.8,
                delay: index * 0.1,
                times: [0, 0.5, 1],
                ease: "easeOut"
              }}
            >
              {/* Source Title / Link */}
              <div className={currentTitleStyle}>
                {slice.sourceObjectUri ? (
                  <a
                    href={slice.sourceObjectUri}
                    onClick={(e) => handleSliceClick(e, slice)}
                    className={currentLinkStyle}
                    title={slice.sourceObjectUri}
                  >
                    {slice.sourceObjectTitle || 'Untitled Source'}
                  </a>
                ) : (
                  slice.sourceObjectTitle || 'Untitled Source'
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
