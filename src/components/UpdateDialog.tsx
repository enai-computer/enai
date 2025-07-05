"use client";

import React from 'react';
import { useUpdater } from '@/hooks/useUpdater';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Download, RefreshCw } from 'lucide-react';

export function UpdateDialog() {
  const {
    updateStatus,
    isDownloading,
    downloadComplete,
    downloadUpdate,
    installUpdate
  } = useUpdater();

  const [isOpen, setIsOpen] = React.useState(false);
  const [userDismissed, setUserDismissed] = React.useState(false);

  // Show dialog when update is available and user hasn't dismissed it
  React.useEffect(() => {
    if (updateStatus.updateAvailable && !userDismissed && !isOpen) {
      setIsOpen(true);
    }
  }, [updateStatus.updateAvailable, userDismissed, isOpen]);

  const handleDismiss = () => {
    setIsOpen(false);
    setUserDismissed(true);
  };

  const handleDownload = async () => {
    await downloadUpdate();
  };

  const handleInstall = async () => {
    await installUpdate();
  };

  if (!updateStatus.updateAvailable) {
    return null;
  }

  const version = updateStatus.updateInfo?.version || 'Unknown';
  const releaseNotes = updateStatus.updateInfo?.releaseNotes;
  const downloadPercent = updateStatus.downloadProgress?.percent || 0;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Update Available</DialogTitle>
          <DialogDescription>
            Version {version} is available for download.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          {releaseNotes && (
            <div className="mb-4">
              <h4 className="text-sm font-medium mb-2">What&apos;s New:</h4>
              <div className="text-sm text-step-10 max-h-[200px] overflow-y-auto">
                {typeof releaseNotes === 'string' 
                  ? releaseNotes 
                  : releaseNotes.map?.((note: { note?: string }, index: number) => (
                      <div key={index} className="mb-2">
                        {note.note || note}
                      </div>
                    ))
                }
              </div>
            </div>
          )}

          {isDownloading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Downloading update...</span>
                <span>{Math.round(downloadPercent)}%</span>
              </div>
              <Progress value={downloadPercent} className="h-2" />
              {updateStatus.downloadProgress && (
                <p className="text-xs text-step-10">
                  {Math.round(updateStatus.downloadProgress.bytesPerSecond / 1024 / 1024 * 10) / 10} MB/s
                </p>
              )}
            </div>
          )}

          {downloadComplete && (
            <div className="p-4 bg-step-2 rounded-md">
              <p className="text-sm text-step-11">
                Update downloaded successfully. Restart Jeffers to apply the update.
              </p>
            </div>
          )}

          {updateStatus.error && (
            <div className="p-4 bg-destructive/10 text-destructive rounded-md">
              <p className="text-sm">{updateStatus.error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {!downloadComplete ? (
            <>
              <Button variant="outline" onClick={handleDismiss}>
                Later
              </Button>
              <Button 
                onClick={handleDownload} 
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <>
                    <RefreshCw className="animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download />
                    Download Update
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleDismiss}>
                Restart Later
              </Button>
              <Button onClick={handleInstall}>
                <RefreshCw />
                Restart Now
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}