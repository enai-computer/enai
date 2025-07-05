import { BrowserWindow, dialog } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { BaseService } from './base/BaseService';
import { logger } from '../utils/logger';
import { UpdateStatus } from '../shared/types/api.types';

interface UpdateServiceDeps {
  mainWindow?: BrowserWindow;
}

export class UpdateService extends BaseService<UpdateServiceDeps> {
  private updateStatus: UpdateStatus = {
    checking: false,
    updateAvailable: false,
    updateInfo: undefined,
    downloadProgress: undefined,
    error: undefined
  };

  private checkTimer: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
  private readonly STARTUP_DELAY = 30 * 1000; // 30 seconds

  constructor(deps: UpdateServiceDeps) {
    super('UpdateService', deps);
    this.configureAutoUpdater();
  }

  async initialize(): Promise<void> {
    this.logInfo('Initializing UpdateService...');
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Schedule initial check after startup delay
    setTimeout(() => {
      this.checkForUpdates().catch(error => {
        this.logError('Error during startup update check:', error);
      });
    }, this.STARTUP_DELAY);
    
    // Schedule periodic checks
    this.checkTimer = setInterval(() => {
      this.checkForUpdates().catch(error => {
        this.logError('Error during periodic update check:', error);
      });
    }, this.CHECK_INTERVAL);
    
    this.logInfo('UpdateService initialized successfully');
  }

  async cleanup(): Promise<void> {
    this.logInfo('Cleaning up UpdateService...');
    
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    
    // Remove all event listeners
    autoUpdater.removeAllListeners();
    
    this.logInfo('UpdateService cleanup complete');
  }

  async healthCheck(): Promise<boolean> {
    return true; // Auto-updater doesn't need health checks
  }

  /**
   * Configure the auto-updater settings
   */
  private configureAutoUpdater(): void {
    autoUpdater.autoDownload = false; // Manual download control
    autoUpdater.autoInstallOnAppQuit = true;
    
    // Auto-updater is automatically disabled in development by electron-updater
    if (process.env.NODE_ENV === 'development') {
      this.logInfo('Auto-updater disabled in development mode');
    }
  }

  /**
   * Configure GitHub releases as the update source
   */
  configureGitHubUpdates(owner: string, repo: string, isPrerelease: boolean = false): void {
    const feedUrl = `https://github.com/${owner}/${repo}`;
    autoUpdater.setFeedURL({
      provider: 'github',
      owner,
      repo,
      releaseType: isPrerelease ? 'prerelease' : 'release'
    });
    
    this.logInfo(`Configured GitHub updates: ${feedUrl}`);
  }

  /**
   * Set up event listeners for the auto-updater
   */
  private setupEventListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.logInfo('Checking for updates...');
      this.updateStatus.checking = true;
      this.updateStatus.error = undefined;
      this.notifyRenderer('update:checking');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.logInfo('Update available:', info.version);
      this.updateStatus.checking = false;
      this.updateStatus.updateAvailable = true;
      this.updateStatus.updateInfo = info;
      this.notifyRenderer('update:available', info);
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.logInfo('No updates available');
      this.updateStatus.checking = false;
      this.updateStatus.updateAvailable = false;
      this.updateStatus.updateInfo = info;
      this.notifyRenderer('update:not-available', info);
    });

    autoUpdater.on('error', (error: Error) => {
      this.logError('Update error:', error);
      this.updateStatus.checking = false;
      this.updateStatus.error = error.message;
      this.notifyRenderer('update:error', error.message);
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.logDebug('Download progress:', progress.percent);
      this.updateStatus.downloadProgress = {
        bytesPerSecond: progress.bytesPerSecond,
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total
      };
      this.notifyRenderer('update:download-progress', this.updateStatus.downloadProgress);
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.logInfo('Update downloaded:', info.version);
      this.updateStatus.downloadProgress = undefined;
      this.notifyRenderer('update:downloaded', info);
      
      // Show dialog to restart and install
      this.showUpdateDialog(info);
    });
  }

  /**
   * Notify the renderer process of update events
   */
  private notifyRenderer(event: string, data?: any): void {
    if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
      this.deps.mainWindow.webContents.send(event, data);
    }
  }

  /**
   * Show dialog when update is downloaded
   */
  private showUpdateDialog(info: UpdateInfo): void {
    const dialogOpts = {
      type: 'info' as const,
      title: 'Application Update',
      message: `A new version ${info.version} has been downloaded.`,
      detail: 'It will be installed when you restart the application. Would you like to restart now?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    };

    const mainWindow = this.deps.mainWindow;
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, dialogOpts).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    }
  }

  /**
   * Check for updates
   */
  async checkForUpdates(): Promise<UpdateStatus> {
    return this.execute('checkForUpdates', async () => {
      try {
        await autoUpdater.checkForUpdates();
      } catch (error) {
        this.logError('Failed to check for updates:', error);
        this.updateStatus.error = error instanceof Error ? error.message : 'Unknown error';
      }
      return this.updateStatus;
    });
  }

  /**
   * Download the available update
   */
  async downloadUpdate(): Promise<{ success: boolean }> {
    return this.execute('downloadUpdate', async () => {
      if (!this.updateStatus.updateAvailable) {
        throw new Error('No update available to download');
      }
      
      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error) {
        this.logError('Failed to download update:', error);
        throw error;
      }
    });
  }

  /**
   * Install the update and restart
   */
  async installUpdate(): Promise<{ success: boolean }> {
    return this.execute('installUpdate', async () => {
      try {
        autoUpdater.quitAndInstall();
        return { success: true };
      } catch (error) {
        this.logError('Failed to install update:', error);
        throw error;
      }
    });
  }

  /**
   * Get current update status
   */
  async getStatus(): Promise<UpdateStatus> {
    return this.updateStatus;
  }
}