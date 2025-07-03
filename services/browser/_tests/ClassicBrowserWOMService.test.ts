import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClassicBrowserWOMService } from '../ClassicBrowserWOMService';
import { ObjectModel } from '../../../models/ObjectModel';
import { CompositeObjectEnrichmentService } from '../../CompositeObjectEnrichmentService';
import { ClassicBrowserStateService } from '../ClassicBrowserStateService';
import { BrowserEventBus } from '../BrowserEventBus';
import { logger } from '../../../utils/logger';
import { JeffersObject } from '../../../shared/types/object.types';
import { ClassicBrowserPayload, TabState } from '../../../shared/types/window.types';
import { MediaType } from '../../../shared/types/vector.types';

vi.mock('../../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('uuid', () => ({
    v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9))
}));

describe('ClassicBrowserWOMService', () => {
    let service: ClassicBrowserWOMService;
    let objectModel: ObjectModel;
    let compositeEnrichmentService: CompositeObjectEnrichmentService;
    let eventBus: BrowserEventBus;
    let stateService: ClassicBrowserStateService;
    
    // Store event handlers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eventHandlers: Map<string, (...args: any[]) => void> = new Map();

    // Test helpers
    const createTabState = (id: string, url: string, title = 'Page'): TabState => ({
        id,
        url,
        title,
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
    });

    const createBrowserState = (tabs: TabState[], activeTabId: string, tabGroupId?: string): ClassicBrowserPayload => ({
        tabs,
        activeTabId,
        freezeState: { type: 'ACTIVE' },
        tabGroupId
    });

    const createMockObject = (id: string, url: string, objectType: MediaType = 'webpage'): JeffersObject => ({
        id,
        sourceUri: url,
        objectType,
        title: 'Test Object',
        status: 'complete',
        rawContentRef: null,
        createdAt: new Date(),
        updatedAt: new Date()
    } as JeffersObject);

    beforeEach(async () => {
        // Create mocks
        objectModel = {
            findBySourceUri: vi.fn(),
            createOrUpdate: vi.fn(),
            updateLastAccessed: vi.fn(),
            updateChildIds: vi.fn(),
        } as unknown as ObjectModel;

        compositeEnrichmentService = {
            scheduleEnrichment: vi.fn(),
        } as unknown as CompositeObjectEnrichmentService;

        // Create a mock event bus that captures handlers
        eventHandlers = new Map();
        eventBus = {
            emit: vi.fn(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            on: vi.fn((event: string, handler: (...args: any[]) => void) => {
                eventHandlers.set(event, handler);
            }),
            once: vi.fn(),
            off: vi.fn(),
            removeAllListeners: vi.fn(),
        } as unknown as BrowserEventBus;

        stateService = {
            states: new Map(),
        } as unknown as ClassicBrowserStateService;

        // Create service
        service = new ClassicBrowserWOMService({
            objectModel,
            compositeEnrichmentService,
            eventBus,
            stateService,
        });
    });

    afterEach(async () => {
        await service.cleanup();
        vi.clearAllMocks();
    });

    describe('navigation handling', () => {
        it('should handle existing and new webpage navigation', async () => {
            const windowId = 'window-1';
            const tabId = 'tab-1';
            const tab = createTabState(tabId, 'https://existing.com');
            stateService.states.set(windowId, createBrowserState([tab], tabId));

            const handler = eventHandlers.get('view:did-navigate');
            
            // Existing webpage
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue(createMockObject('obj-1', 'https://existing.com'));
            await handler?.({ windowId, url: 'https://existing.com', title: 'Existing' });
            expect(objectModel.updateLastAccessed).toHaveBeenCalledWith('obj-1');
            expect(eventBus.emit).toHaveBeenCalledWith('webpage:needs-refresh', expect.any(Object));

            // New webpage
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue(null);
            await handler?.({ windowId, url: 'https://new.com', title: 'New' });
            expect(eventBus.emit).toHaveBeenCalledWith('webpage:needs-ingestion', expect.any(Object));
        });
    });

    describe('tab group management', () => {
        it('should create tab groups for multiple tabs only', async () => {
            const windowId = 'window-1';
            
            // Single tab - no group
            stateService.states.set(windowId, createBrowserState([createTabState('tab-1', 'https://page1.com')], 'tab-1'));
            await service.checkAndCreateTabGroup(windowId);
            expect(objectModel.createOrUpdate).not.toHaveBeenCalled();

            // Multiple tabs - create group
            const multiTabState = createBrowserState([
                createTabState('tab-1', 'https://page1.com'),
                createTabState('tab-2', 'https://page2.com')
            ], 'tab-1');
            stateService.states.set(windowId, multiTabState);
            
            vi.mocked(objectModel.createOrUpdate).mockResolvedValue(createMockObject('group-1', `tab-group://window-${windowId}`, 'tab_group'));
            await service.checkAndCreateTabGroup(windowId);
            
            expect(objectModel.createOrUpdate).toHaveBeenCalledWith(expect.objectContaining({
                objectType: 'tab_group',
                sourceUri: `tab-group://window-${windowId}`
            }));
            expect(multiTabState.tabGroupId).toBe('group-1');
        });
    });

    describe('tab group updates', () => {
        it('should debounce tab group children updates', async () => {
            const windowId = 'window-1';
            const tabGroupId = 'tab-group-1';
            
            // Setup browser state with tab group
            stateService.states.set(windowId, createBrowserState([
                createTabState('tab-1', 'https://page1.com'),
                createTabState('tab-2', 'https://page2.com')
            ], 'tab-1', tabGroupId));

            // Setup tab-to-object mappings
            const ingestionHandler = eventHandlers.get('webpage:ingestion-complete');
            await ingestionHandler?.({ tabId: 'tab-1', objectId: 'obj-1' });
            await ingestionHandler?.({ tabId: 'tab-2', objectId: 'obj-2' });

            // Trigger multiple navigations
            const navHandler = eventHandlers.get('view:did-navigate');
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue(createMockObject('obj-1', 'https://page1.com'));
            
            for (let i = 0; i < 3; i++) {
                await navHandler?.({ windowId, url: `https://page${i}.com`, title: `Page ${i}` });
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // Wait for debounce
            await new Promise(resolve => setTimeout(resolve, 600));

            // Should only update once
            expect(objectModel.updateChildIds).toHaveBeenCalledTimes(1);
            expect(objectModel.updateChildIds).toHaveBeenCalledWith(tabGroupId, expect.arrayContaining(['obj-1', 'obj-2']));
        });
    });

    describe('event handling', () => {
        it('should handle ingestion and refresh events', async () => {
            // Ingestion complete
            const ingestionHandler = eventHandlers.get('webpage:ingestion-complete');
            await ingestionHandler?.({ tabId: 'tab-1', objectId: 'obj-1' });
            expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Linked tab tab-1 to object obj-1'));

            // Refresh needed
            const refreshHandler = eventHandlers.get('webpage:needs-refresh');
            await refreshHandler?.({ objectId: 'obj-1', url: 'https://example.com' });
            expect(eventBus.emit).toHaveBeenCalledWith('wom:refresh-needed', expect.any(Object));
        });
    });

    describe('tab mapping management', () => {
        it('should manage tab-to-object mappings', async () => {
            const windowId = 'window-1';
            const ingestionHandler = eventHandlers.get('webpage:ingestion-complete');
            
            // Create mappings
            await ingestionHandler?.({ tabId: 'tab-1', objectId: 'obj-1' });
            await ingestionHandler?.({ tabId: 'tab-2', objectId: 'obj-2' });
            
            // Setup browser state
            stateService.states.set(windowId, createBrowserState([
                createTabState('tab-1', 'https://page1.com'),
                createTabState('tab-2', 'https://page2.com')
            ], 'tab-1', 'group-1'));
            
            // Remove one mapping
            service.removeTabMapping('tab-1');
            
            // Trigger update
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (service as any)['updateTabGroupChildren'](windowId);
            await new Promise(resolve => setTimeout(resolve, 0));
            
            // Should only include remaining mapping
            expect(objectModel.updateChildIds).toHaveBeenCalledWith('group-1', ['obj-2']);
        });

        it('should clear window-specific mappings', async () => {
            const windowId1 = 'window-1';
            const windowId2 = 'window-2';
            
            // Setup two windows
            stateService.states.set(windowId1, createBrowserState([
                createTabState('tab-1', 'https://page1.com'),
                createTabState('tab-2', 'https://page2.com')
            ], 'tab-1', 'group-1'));
            
            stateService.states.set(windowId2, createBrowserState([
                createTabState('tab-3', 'https://page3.com')
            ], 'tab-3', 'group-2'));
            
            // Create mappings
            const ingestionHandler = eventHandlers.get('webpage:ingestion-complete');
            await ingestionHandler?.({ tabId: 'tab-1', objectId: 'obj-1' });
            await ingestionHandler?.({ tabId: 'tab-2', objectId: 'obj-2' });
            await ingestionHandler?.({ tabId: 'tab-3', objectId: 'obj-3' });
            
            // Clear only window-1
            service.clearWindowTabMappings(windowId1);
            
            // Window-2 should still work
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue(createMockObject('obj-3', 'https://page3.com'));
            const navHandler = eventHandlers.get('view:did-navigate');
            await navHandler?.({ windowId: windowId2, url: 'https://page3.com', title: 'Page 3' });
            
            await new Promise(resolve => setTimeout(resolve, 600));
            expect(objectModel.updateChildIds).toHaveBeenCalledWith('group-2', ['obj-3']);
        });
    });

    describe('cleanup', () => {
        it('should clean up all resources', async () => {
            // Setup and trigger some timers
            const windowId = 'window-1';
            stateService.states.set(windowId, createBrowserState([createTabState('tab-1', 'https://page.com')], 'tab-1'));
            
            const navHandler = eventHandlers.get('view:did-navigate');
            await navHandler?.({ windowId, url: 'https://page.com', title: 'Page' });

            // Cleanup
            await service.cleanup();

            // Verify listeners removed
            expect(eventBus.removeAllListeners).toHaveBeenCalledWith('view:did-navigate');
            expect(eventBus.removeAllListeners).toHaveBeenCalledWith('webpage:ingestion-complete');
            expect(eventBus.removeAllListeners).toHaveBeenCalledWith('webpage:needs-refresh');

            // Verify no timers active
            await new Promise(resolve => setTimeout(resolve, 600));
            expect(objectModel.updateChildIds).not.toHaveBeenCalled();
        });
    });
});