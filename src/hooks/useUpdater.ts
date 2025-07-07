"use client";

import { useState, useEffect, useCallback } from 'react';
import { UpdateStatus } from '../../shared/types/api.types';
import { UpdateInfo } from 'electron-updater';

export function useUpdater() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    checking: false,
    updateAvailable: false,
    updateInfo: undefined,
    downloadProgress: undefined,
    error: undefined
  });

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadComplete, setDownloadComplete] = useState(false);

  // Check for updates
  const checkForUpdates = useCallback(async () => {
    try {
      const status = await window.api.update.checkForUpdates();
      setUpdateStatus(status);
    } catch (error) {
      console.error('Failed to check for updates:', error);
      setUpdateStatus((prev: UpdateStatus) => ({ ...prev, error: 'Failed to check for updates' }));
    }
  }, []);

  // Download update
  const downloadUpdate = useCallback(async () => {
    try {
      setIsDownloading(true);
      await window.api.update.downloadUpdate();
    } catch (error) {
      console.error('Failed to download update:', error);
      setUpdateStatus((prev: UpdateStatus) => ({ ...prev, error: 'Failed to download update' }));
      setIsDownloading(false);
    }
  }, []);

  // Install update
  const installUpdate = useCallback(async () => {
    try {
      await window.api.update.installUpdate();
    } catch (error) {
      console.error('Failed to install update:', error);
      setUpdateStatus((prev: UpdateStatus) => ({ ...prev, error: 'Failed to install update' }));
    }
  }, []);

  // Get current status
  const getStatus = useCallback(async () => {
    try {
      const status = await window.api.update.getStatus();
      setUpdateStatus(status);
    } catch (error) {
      console.error('Failed to get update status:', error);
    }
  }, []);

  // Set up event listeners
  useEffect(() => {
    // Get initial status
    getStatus();

    // Subscribe to update events
    const unsubscribeChecking = window.api.update.onChecking(() => {
      setUpdateStatus((prev: UpdateStatus) => ({ ...prev, checking: true, error: undefined }));
    });

    const unsubscribeAvailable = window.api.update.onUpdateAvailable((info: UpdateInfo) => {
      setUpdateStatus((prev: UpdateStatus) => ({
        ...prev,
        checking: false,
        updateAvailable: true,
        updateInfo: info
      }));
    });

    const unsubscribeNotAvailable = window.api.update.onUpdateNotAvailable((info: UpdateInfo) => {
      setUpdateStatus((prev: UpdateStatus) => ({
        ...prev,
        checking: false,
        updateAvailable: false,
        updateInfo: info
      }));
    });

    const unsubscribeError = window.api.update.onError((error: string) => {
      setUpdateStatus((prev: UpdateStatus) => ({
        ...prev,
        checking: false,
        error
      }));
      setIsDownloading(false);
    });

    const unsubscribeProgress = window.api.update.onDownloadProgress((progress) => {
      setUpdateStatus((prev: UpdateStatus) => ({ ...prev, downloadProgress: progress }));
    });

    const unsubscribeDownloaded = window.api.update.onUpdateDownloaded((info: UpdateInfo) => {
      setUpdateStatus((prev: UpdateStatus) => ({
        ...prev,
        downloadProgress: undefined,
        updateInfo: info
      }));
      setIsDownloading(false);
      setDownloadComplete(true);
    });

    // Cleanup
    return () => {
      unsubscribeChecking();
      unsubscribeAvailable();
      unsubscribeNotAvailable();
      unsubscribeError();
      unsubscribeProgress();
      unsubscribeDownloaded();
    };
  }, [getStatus]);

  return {
    updateStatus,
    isDownloading,
    downloadComplete,
    checkForUpdates,
    downloadUpdate,
    installUpdate
  };
}