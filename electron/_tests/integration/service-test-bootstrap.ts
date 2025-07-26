import { vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { ClassicBrowserService } from '../../../services/browser/ClassicBrowserService';
import { ClassicBrowserViewManager } from '../../../services/browser/ClassicBrowserViewManager';
import { ClassicBrowserStateService } from '../../../services/browser/ClassicBrowserStateService';
import { ClassicBrowserNavigationService } from '../../../services/browser/ClassicBrowserNavigationService';
import { ClassicBrowserTabService } from '../../../services/browser/ClassicBrowserTabService';
import { ClassicBrowserWOMService } from '../../../services/browser/ClassicBrowserWOMService';
import { ClassicBrowserSnapshotService } from '../../../services/browser/ClassicBrowserSnapshotService';
import { BrowserEventBus } from '../../../services/browser/BrowserEventBus';
import { GlobalTabPool } from '../../../services/browser/GlobalTabPool';
import { ObjectModelCore } from '../../../models/ObjectModelCore';
import { ActivityLogService } from '../../../services/ActivityLogService';

// Mock dependencies
vi.mock('../../../models/ObjectModel');
vi.mock('../../../services/ActivityLogService');

export function bootstrapBrowserServices(mainWindow: BrowserWindow) {
  const eventBus = new BrowserEventBus();
  const globalTabPool = new GlobalTabPool();
  const viewManager = new ClassicBrowserViewManager({ mainWindow, eventBus, globalTabPool });
  const stateService = new ClassicBrowserStateService({ mainWindow, eventBus });
  const navigationService = new ClassicBrowserNavigationService({ stateService, globalTabPool, eventBus });
  const tabService = new ClassicBrowserTabService({ stateService });
  const womService = new ClassicBrowserWOMService({
    objectModelCore: {} as any,
    compositeEnrichmentService: {} as any,
    eventBus,
    stateService,
    womIngestionService: {} as any,
  });
  const snapshotService = new ClassicBrowserSnapshotService({ viewManager, stateService, navigationService });
  const activityLogService = new ActivityLogService({} as any);

  const browserService = new ClassicBrowserService({
    mainWindow,
    viewManager,
    stateService,
    navigationService,
    tabService,
    snapshotService,
  });

  return {
    browserService,
    viewManager,
    stateService,
    navigationService,
    tabService,
    womService,
    snapshotService,
    eventBus,
  };
}
