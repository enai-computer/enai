'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useState, useCallback } from 'react'; // Import useCallback
import { toast } from 'sonner'; // Assuming sonner is installed
import { useDropzone } from 'react-dropzone';

export function BookmarkUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);

  // Use useCallback to prevent re-creating the function on every render
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length || isImporting) return;
    const file = acceptedFiles[0];

    console.log(`Attempting to import: ${file.name}`);
    setProgress(0); // Show progress indeterminate initially (optional)
    setIsImporting(true);
    toast.info(`Starting import of ${file.name}...`);

    try {
      // 1. Read file content
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer); // Ensure it's Uint8Array for the API

      // 2. Call saveTempFile API
      console.log(`[BookmarkDialog] Calling saveTempFile for ${file.name}`);
      if (!window.api?.saveTempFile) {
        throw new Error("Save temp file API is not available.");
      }
      const tempPath = await window.api.saveTempFile(file.name, data);
      console.log(`[BookmarkDialog] Temp file saved at: ${tempPath}`);
      // Provide some visual progress indication if possible
      setProgress(50); // Indicate progress after file save

      // 3. Call importBookmarks API
      console.log(`[BookmarkDialog] Calling importBookmarks for ${tempPath}`);
      if (!window.api?.importBookmarks) {
        throw new Error("Import bookmarks API is not available.");
      }
      const count = await window.api.importBookmarks(tempPath);
      console.log(`[BookmarkDialog] importBookmarks returned: ${count}`);
      setProgress(100);

      // 4. Show success toast and close
      if (count > 0) {
        toast.success(`Successfully imported ${count} new bookmark${count !== 1 ? 's' : ''} 🚀`);
      } else {
        toast.info(`No new bookmarks found in ${file.name}.`);
      }
      onOpenChange(false); // Close dialog on success

    } catch (error) {
      console.error('[BookmarkDialog] Import failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      toast.error(`Import failed: ${errorMessage}`);
      // Keep dialog open on error for user feedback
    } finally {
      // Reset state regardless of success or failure
      setIsImporting(false);
      setProgress(null);
    }
  }, [isImporting, onOpenChange]); // Add dependencies for useCallback

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'text/html': ['.html', '.htm'],
      'application/json': ['.json'],
    },
    multiple: false,
    onDrop,
    disabled: isImporting, // Disable dropzone while importing
  });

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => !isImporting && onOpenChange(isOpen)}> {/* Prevent closing while importing */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload bookmark export</DialogTitle>
        </DialogHeader>

        <div
          {...getRootProps()}
          className={`
            border-dashed border-2 rounded-md p-6 text-center 
            ${isImporting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
            ${isDragActive ? 'border-primary bg-muted/50' : 'border-muted hover:border-primary/50'}
          `}
        >
          <input {...getInputProps()} />
          {isImporting ? (
            <p>Importing, please wait...</p>
          ) : isDragActive ? (
            <p>Drop the file here to start import...</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Drag &amp; drop a <code>.html</code> or <code>.json</code> export file here,
              or click to select a file.
            </p>
          )}
        </div>

        {progress !== null && (
          <div className="mt-4 space-y-1">
            <p className="text-xs text-muted-foreground text-center">Importing...</p>
            {/* Use value={progress} for determinate or omit for indeterminate based on preference */}
            <Progress value={progress} className="w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
} 