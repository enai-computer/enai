'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useDropzone } from 'react-dropzone';
import type { PdfIngestProgressPayload, PdfIngestBatchCompletePayload } from '../../shared/types';

export function PdfUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [currentFile, setCurrentFile] = useState<string>('');
  const [processingStatus, setProcessingStatus] = useState<string>('');

  // Set up progress listeners
  useEffect(() => {
    if (!window.api) return;

    const unsubscribeProgress = window.api.onPdfIngestProgress((progress: PdfIngestProgressPayload) => {
      console.log('[PdfUploadDialog] Progress:', progress);
      
      // Update UI based on progress status
      switch (progress.status) {
        case 'starting_processing':
          setProcessingStatus(`Starting processing of ${progress.fileName}...`);
          setProgress(10);
          break;
        case 'parsing_text':
          setProcessingStatus(`Extracting text from ${progress.fileName}...`);
          setProgress(25);
          break;
        case 'generating_summary':
          setProcessingStatus(`AI is analyzing ${progress.fileName}...`);
          setProgress(50);
          break;
        case 'saving_metadata':
          setProcessingStatus(`Saving metadata for ${progress.fileName}...`);
          setProgress(75);
          break;
        case 'creating_embeddings':
          setProcessingStatus(`Creating searchable embeddings for ${progress.fileName}...`);
          setProgress(90);
          break;
        case 'complete':
          setProcessingStatus(`Completed ${progress.fileName}!`);
          setProgress(100);
          break;
        case 'duplicate':
          toast.info(`${progress.fileName} was already imported previously.`);
          setProgress(100); // Set progress to complete for duplicates
          break;
        case 'error':
          toast.error(`Error processing ${progress.fileName}: ${progress.error || 'Unknown error'}`);
          break;
        case 'queued':
          setProcessingStatus(`${progress.fileName} queued for processing...`);
          setProgress(5);
          break;
      }
    });

    const unsubscribeBatchComplete = window.api.onPdfIngestBatchComplete((result: PdfIngestBatchCompletePayload) => {
      console.log('[PdfUploadDialog] Batch complete:', result);
      
      if (result.successCount > 0) {
        toast.success(
          `Successfully imported ${result.successCount} PDF${result.successCount !== 1 ? 's' : ''} 📄`
        );
      }
      
      if (result.failureCount > 0) {
        toast.error(
          `Failed to import ${result.failureCount} PDF${result.failureCount !== 1 ? 's' : ''}`
        );
      }

      // Close dialog if all successful, otherwise keep open to show errors
      if (result.failureCount === 0) {
        setTimeout(() => onOpenChange(false), 1000);
      }
      
      setIsImporting(false);
      setProgress(null);
      setCurrentFile('');
      setProcessingStatus('');
    });

    return () => {
      unsubscribeProgress();
      unsubscribeBatchComplete();
    };
  }, [onOpenChange]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length || isImporting) return;

    console.log(`[PdfUploadDialog] Processing ${acceptedFiles.length} PDF files`);
    setIsImporting(true);
    setProgress(0);

    try {
      if (!window.api?.saveTempFile || !window.api?.ingestPdfs) {
        throw new Error("PDF ingestion APIs are not available.");
      }

      // Save files to temp locations
      const tempPaths: string[] = [];
      
      for (const file of acceptedFiles) {
        setCurrentFile(file.name);
        setProcessingStatus(`Saving ${file.name}...`);
        
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        const tempPath = await window.api.saveTempFile(file.name, data);
        tempPaths.push(tempPath);
        
        console.log(`[PdfUploadDialog] Saved ${file.name} to ${tempPath}`);
      }

      // Start PDF ingestion
      console.log(`[PdfUploadDialog] Starting ingestion of ${tempPaths.length} PDFs`);
      await window.api.ingestPdfs(tempPaths);
      
      // The batch complete event will handle state reset
      // Don't reset state here to avoid race conditions

    } catch (error) {
      console.error('[PdfUploadDialog] Import failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      toast.error(`Import failed: ${errorMessage}`);
      
      // Only reset state on error since batch complete won't fire
      setIsImporting(false);
      setProgress(null);
      setCurrentFile('');
      setProcessingStatus('');
    }
  }, [isImporting]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'application/pdf': ['.pdf'],
    },
    multiple: true, // Allow multiple PDFs
    onDrop,
    disabled: isImporting,
  });

  const handleCancel = useCallback(() => {
    if (isImporting && window.api?.cancelPdfIngest) {
      window.api.cancelPdfIngest();
      toast.info('PDF import cancelled');
    }
  }, [isImporting]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload PDF Documents</DialogTitle>
          <DialogDescription>
            Import and index PDF files for intelligent search
          </DialogDescription>
        </DialogHeader>

        <div
          {...getRootProps()}
          className={`
            border-dashed border-2 rounded-md p-6 text-center 
            ${isImporting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
            ${isDragActive ? 'border-step-11 bg-step-2/50' : 'border-step-2 hover:border-step-11/50'}
          `}
        >
          <input {...getInputProps()} />
          {isImporting ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{processingStatus}</p>
              <p className="text-xs text-step-10">{currentFile}</p>
            </div>
          ) : isDragActive ? (
            <p>Drop PDF files here to start import...</p>
          ) : (
            <div>
              <p className="text-sm text-step-10">
                Drag &amp; drop PDF files here, or click to select
              </p>
              <p className="text-xs text-step-10 mt-2">
                AI will read and summarize your PDFs for intelligent search
              </p>
            </div>
          )}
        </div>

        {progress !== null && (
          <div className="mt-4 space-y-1">
            <Progress value={progress} className="w-full" />
            {isImporting && (
              <button
                onClick={handleCancel}
                className="text-xs text-step-10 hover:text-step-11 underline"
              >
                Cancel import
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}