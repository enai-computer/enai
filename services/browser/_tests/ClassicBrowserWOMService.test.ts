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

// Mock logger to prevent console output during tests
vi.mock('../../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock uuid for predictable IDs in tests
vi.mock('uuid', () => ({
    v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9))
}));

describe('ClassicBrowserWOMService', () => {
    let service: ClassicBrowserWOMService;
    let objectModel: ObjectModel;
    let compositeEnrichmentService: CompositeObjectEnrichmentService;
    let eventBus: BrowserEventBus;
    let stateService: ClassicBrowserStateService;
    
    // Store event handlers registered during service initialization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eventHandlers: Map<string, (...args: any[]) => void> = new Map();

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
        it('should update existing webpage object on navigation', async () => {
            const windowId = 'window-1';
            const url = 'https://example.com';
            const title = 'Example Page';
            const tabId = 'tab-1';
            const objectId = 'object-1';

            // Setup state with proper TabState
            const tabState: TabState = {
                id: tabId, 
                url, 
                title,
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState: ClassicBrowserPayload = {
                tabs: [tabState],
                activeTabId: tabId,
                freezeState: { type: 'ACTIVE' },
                tabGroupId: undefined
            };
            stateService.states.set(windowId, browserState);

            // Mock existing webpage
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue({
                id: objectId,
                sourceUri: url,
                objectType: 'webpage' as MediaType,
                title,
                status: 'complete',
                rawContentRef: null,
                createdAt: new Date(),
                updatedAt: new Date()
            } as JeffersObject);

            // Get the handler and call it
            const handler = eventHandlers.get('view:did-navigate');
            await handler?.({ windowId, url, title });

            // Verify object was updated
            expect(objectModel.updateLastAccessed).toHaveBeenCalledWith(objectId);
            expect(eventBus.emit).toHaveBeenCalledWith('webpage:needs-refresh', { 
                objectId, 
                url, 
                windowId, 
                tabId 
            });
        });

        it('should emit ingestion event for new webpage', async () => {
            const windowId = 'window-1';
            const url = 'https://newpage.com';
            const title = 'New Page';
            const tabId = 'tab-1';

            // Setup state
            const tabState: TabState = {
                id: tabId, 
                url, 
                title,
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState: ClassicBrowserPayload = {
                tabs: [tabState],
                activeTabId: tabId,
                freezeState: { type: 'ACTIVE' },
                tabGroupId: undefined
            };
            stateService.states.set(windowId, browserState);

            // Mock no existing webpage
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue(null);

            // Get the handler and call it
            const handler = eventHandlers.get('view:did-navigate');
            await handler?.({ windowId, url, title });

            // Verify ingestion event was emitted
            expect(eventBus.emit).toHaveBeenCalledWith('webpage:needs-ingestion', {
                url,
                title,
                windowId,
                tabId,
            });
        });

        it('should ignore navigation without tabId', async () => {
            const windowId = 'window-1';
            const url = 'https://example.com';
            const title = 'Example Page';

            // Setup state with no active tab
            const browserState: ClassicBrowserPayload = {
                tabs: [],
                activeTabId: 'non-existent',
                freezeState: { type: 'ACTIVE' },
                tabGroupId: undefined
            };
            stateService.states.set(windowId, browserState);

            // Get the handler and call it
            const handler = eventHandlers.get('view:did-navigate');
            await handler?.({ windowId, url, title });

            // Verify no object operations
            expect(objectModel.findBySourceUri).not.toHaveBeenCalled();
        });
    });

    describe('tab group management', () => {
        it('should create tab group when window has multiple tabs', async () => {
            const windowId = 'window-1';
            const tabGroupId = 'tab-group-1';

            // Setup state with multiple tabs
            const tab1: TabState = {
                id: 'tab-1',
                url: 'https://page1.com',
                title: 'Page 1',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const tab2: TabState = {
                id: 'tab-2',
                url: 'https://page2.com',
                title: 'Page 2',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState: ClassicBrowserPayload = {
                tabs: [tab1, tab2],
                activeTabId: 'tab-1',
                freezeState: { type: 'ACTIVE' },
                tabGroupId: undefined
            };
            stateService.states.set(windowId, browserState);

            // Mock tab group creation
            vi.mocked(objectModel.createOrUpdate).mockResolvedValue({
                id: tabGroupId,
                objectType: 'tab_group' as MediaType,
                sourceUri: `tab-group://window-${windowId}`,
                title: 'Browser Window',
                status: 'new',
                rawContentRef: null,
                createdAt: new Date(),
                updatedAt: new Date()
            } as JeffersObject);

            await service.checkAndCreateTabGroup(windowId);

            // Verify tab group was created
            expect(objectModel.createOrUpdate).toHaveBeenCalledWith({
                objectType: 'tab_group' as MediaType,
                sourceUri: `tab-group://window-${windowId}`,
                title: 'Browser Window',
                status: 'new',
                rawContentRef: null,
            });
            expect(browserState.tabGroupId).toBe(tabGroupId);
        });

        it('should not create tab group for single tab', async () => {
            const windowId = 'window-1';

            // Setup state with single tab
            const tabState: TabState = {
                id: 'tab-1',
                url: 'https://page1.com',
                title: 'Page 1',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState: ClassicBrowserPayload = {
                tabs: [tabState],
                activeTabId: 'tab-1',
                freezeState: { type: 'ACTIVE' },
                tabGroupId: undefined
            };
            stateService.states.set(windowId, browserState);

            await service.checkAndCreateTabGroup(windowId);

            // Verify no tab group was created
            expect(objectModel.createOrUpdate).not.toHaveBeenCalled();
        });

        it('should not create duplicate tab group', async () => {
            const windowId = 'window-1';

            // Setup state with existing tab group
            const tab1: TabState = {
                id: 'tab-1',
                url: 'https://page1.com',
                title: 'Page 1',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const tab2: TabState = {
                id: 'tab-2',
                url: 'https://page2.com',
                title: 'Page 2',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState: ClassicBrowserPayload = {
                tabs: [tab1, tab2],
                activeTabId: 'tab-1',
                freezeState: { type: 'ACTIVE' },
                tabGroupId: 'existing-group'
            };
            stateService.states.set(windowId, browserState);

            await service.checkAndCreateTabGroup(windowId);

            // Verify no new tab group was created
            expect(objectModel.createOrUpdate).not.toHaveBeenCalled();
        });

        it('should handle tab group creation errors', async () => {
            const windowId = 'window-1';

            // Setup state
            const tab1: TabState = {
                id: 'tab-1',
                url: 'https://page1.com',
                title: 'Page 1',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const tab2: TabState = {
                id: 'tab-2',
                url: 'https://page2.com',
                title: 'Page 2',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState: ClassicBrowserPayload = {
                tabs: [tab1, tab2],
                activeTabId: 'tab-1',
                freezeState: { type: 'ACTIVE' },
                tabGroupId: undefined
            };
            stateService.states.set(windowId, browserState);

            // Mock error
            vi.mocked(objectModel.createOrUpdate).mockRejectedValue(new Error('Database error'));

            await service.checkAndCreateTabGroup(windowId);

            // Verify error was logged
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to create tab group'),
                expect.any(Error)
            );
        });
    });

    describe('tab group updates', () => {
        it('should update tab group children after navigation', async () => {
            const windowId = 'window-1';
            const tabGroupId = 'tab-group-1';
            const objectId1 = 'object-1';
            const objectId2 = 'object-2';

            // Setup state with tab group
            const tab1: TabState = {
                id: 'tab-1',
                url: 'https://page1.com',
                title: 'Page 1',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const tab2: TabState = {
                id: 'tab-2',
                url: 'https://page2.com',
                title: 'Page 2',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState: ClassicBrowserPayload = {
                tabs: [tab1, tab2],
                activeTabId: 'tab-1',
                freezeState: { type: 'ACTIVE' },
                tabGroupId
            };
            stateService.states.set(windowId, browserState);

            // Mock existing webpage
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue({
                id: objectId1,
                sourceUri: 'https://page1.com',
                objectType: 'webpage' as MediaType,
                title: 'Page 1',
                status: 'complete',
                rawContentRef: null,
                createdAt: new Date(),
                updatedAt: new Date()
            } as JeffersObject);

            // Get handlers
            const navHandler = eventHandlers.get('view:did-navigate');
            const ingestionHandler = eventHandlers.get('webpage:ingestion-complete');
            
            // Emit navigation event
            await navHandler?.({
                windowId,
                url: 'https://page1.com',
                title: 'Page 1',
            });

            // Setup tab mappings
            await ingestionHandler?.({ tabId: 'tab-1', objectId: objectId1 });
            await ingestionHandler?.({ tabId: 'tab-2', objectId: objectId2 });

            // Wait for debounced update
            await new Promise(resolve => setTimeout(resolve, 600));

            // Verify tab group was updated
            expect(objectModel.updateChildIds).toHaveBeenCalledWith(
                tabGroupId,
                expect.arrayContaining([objectId1, objectId2])
            );
            expect(compositeEnrichmentService.scheduleEnrichment).toHaveBeenCalledWith(tabGroupId);
        });

        it('should debounce multiple tab group updates', async () => {
            const windowId = 'window-1';
            const tabGroupId = 'tab-group-1';

            // Setup state
            const tabState: TabState = {
                id: 'tab-1',
                url: 'https://page.com',
                title: 'Page',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState: ClassicBrowserPayload = {
                tabs: [tabState],
                activeTabId: 'tab-1',
                freezeState: { type: 'ACTIVE' },
                tabGroupId
            };
            stateService.states.set(windowId, browserState);

            // Mock existing webpage
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue({
                id: 'object-1',
                sourceUri: 'https://page.com',
                objectType: 'webpage' as MediaType,
                title: 'Page',
                status: 'complete',
                rawContentRef: null,
                createdAt: new Date(),
                updatedAt: new Date()
            } as JeffersObject);

            // Get handler
            const navHandler = eventHandlers.get('view:did-navigate');
            
            // Emit multiple navigation events quickly
            for (let i = 0; i < 5; i++) {
                await navHandler?.({
                    windowId,
                    url: `https://page${i}.com`,
                    title: `Page ${i}`,
                });
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // Wait for debounced update
            await new Promise(resolve => setTimeout(resolve, 600));

            // Verify only one update occurred
            expect(objectModel.updateChildIds).toHaveBeenCalledTimes(1);
        });
    });

    describe('event handling', () => {
        it('should link tab to object on ingestion complete', async () => {
            const tabId = 'tab-1';
            const objectId = 'object-1';

            // Get handler
            const handler = eventHandlers.get('webpage:ingestion-complete');
            await handler?.({ tabId, objectId });

            // Verify mapping was created
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining(`Linked tab ${tabId} to object ${objectId}`)
            );
        });

        it('should forward refresh events to WOM ingestion', async () => {
            const objectId = 'object-1';
            const url = 'https://example.com';

            // Get handler
            const handler = eventHandlers.get('webpage:needs-refresh');
            await handler?.({ objectId, url });

            // Verify event was forwarded
            expect(eventBus.emit).toHaveBeenCalledWith('wom:refresh-needed', { objectId, url });
        });
    });

    describe('tab mapping management', () => {
        it('should remove individual tab mapping', async () => {
            const tabId = 'tab-1';
            const objectId = 'object-1';

            // Create mapping
            const ingestionHandler = eventHandlers.get('webpage:ingestion-complete');
            await ingestionHandler?.({ tabId, objectId });
            
            // Verify mapping was created (through debug log)
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining(`Linked tab ${tabId} to object ${objectId}`)
            );

            // Remove the mapping
            service.removeTabMapping(tabId);

            // Create a new tab mapping to verify the old one was removed
            const tabId2 = 'tab-2';
            const objectId2 = 'object-2';
            await ingestionHandler?.({ tabId: tabId2, objectId: objectId2 });

            // Now setup window state to test tab group update
            const windowId = 'window-1';
            const tab1: TabState = {
                id: tabId,
                url: 'https://page1.com',
                title: 'Page 1',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const tab2: TabState = {
                id: tabId2,
                url: 'https://page2.com',
                title: 'Page 2',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState: ClassicBrowserPayload = {
                tabs: [tab1, tab2],
                activeTabId: tabId2,
                freezeState: { type: 'ACTIVE' },
                tabGroupId: 'group-1'
            };
            stateService.states.set(windowId, browserState);

            // Manually trigger tab group update using private method access
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (service as any)['updateTabGroupChildren'](windowId);

            // Wait for any async operations
            await new Promise(resolve => setTimeout(resolve, 0));

            // Should only include tab2's object since tab1's mapping was removed
            expect(objectModel.updateChildIds).toHaveBeenCalledWith('group-1', [objectId2]);
        });

        it('should clear all window tab mappings', async () => {
            const windowId = 'window-1';
            const windowId2 = 'window-2';
            
            const tab1: TabState = {
                id: 'tab-1',
                url: 'https://page1.com',
                title: 'Page 1',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const tab2: TabState = {
                id: 'tab-2',
                url: 'https://page2.com',
                title: 'Page 2',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const tab3: TabState = {
                id: 'tab-3',
                url: 'https://page3.com',
                title: 'Page 3',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };

            // Setup state for two windows
            const browserState1: ClassicBrowserPayload = {
                tabs: [tab1, tab2, tab3],
                activeTabId: 'tab-1',
                freezeState: { type: 'ACTIVE' },
                tabGroupId: 'group-1'
            };
            stateService.states.set(windowId, browserState1);

            const tab4: TabState = {
                id: 'tab-4',
                url: 'https://page4.com',
                title: 'Page 4',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState2: ClassicBrowserPayload = {
                tabs: [tab4],
                activeTabId: 'tab-4',
                freezeState: { type: 'ACTIVE' },
                tabGroupId: 'group-2'
            };
            stateService.states.set(windowId2, browserState2);

            // Create mappings for all tabs
            const ingestionHandler = eventHandlers.get('webpage:ingestion-complete');
            const tabs = [tab1, tab2, tab3];
            for (let i = 0; i < tabs.length; i++) {
                await ingestionHandler?.({
                    tabId: tabs[i].id,
                    objectId: `object-${i}`,
                });
            }
            await ingestionHandler?.({
                tabId: 'tab-4',
                objectId: 'object-4',
            });

            // Clear only window-1 mappings
            service.clearWindowTabMappings(windowId);

            // Mock webpage for window-2
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue({
                id: 'object-4',
                sourceUri: 'https://page4.com',
                objectType: 'webpage' as MediaType,
                title: 'Page 4',
                status: 'complete',
                rawContentRef: null,
                createdAt: new Date(),
                updatedAt: new Date()
            } as JeffersObject);
            
            // Trigger update for window-2 (should still have its mapping)
            const navHandler = eventHandlers.get('view:did-navigate');
            await navHandler?.({
                windowId: windowId2,
                url: 'https://page4.com',
                title: 'Page 4',
            });

            // Wait for update
            await new Promise(resolve => setTimeout(resolve, 600));
            
            // Window-2 should still have its mapping
            expect(objectModel.updateChildIds).toHaveBeenCalledWith('group-2', ['object-4']);
        });
    });

    describe('cleanup', () => {
        it('should clean up all resources', async () => {
            const windowId = 'window-1';

            // Setup some state and timers
            const tabState: TabState = {
                id: 'tab-1',
                url: 'https://page.com',
                title: 'Page',
                faviconUrl: null,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
                error: null
            };
            
            const browserState: ClassicBrowserPayload = {
                tabs: [tabState],
                activeTabId: 'tab-1',
                freezeState: { type: 'ACTIVE' },
                tabGroupId: undefined
            };
            stateService.states.set(windowId, browserState);

            // Create mappings
            const ingestionHandler = eventHandlers.get('webpage:ingestion-complete');
            await ingestionHandler?.({
                tabId: 'tab-1',
                objectId: 'object-1',
            });

            // Trigger navigation to create timer
            const navHandler = eventHandlers.get('view:did-navigate');
            await navHandler?.({
                windowId,
                url: 'https://page.com',
                title: 'Page',
            });

            // Perform cleanup
            await service.cleanup();

            // Verify all listeners were removed
            expect(eventBus.removeAllListeners).toHaveBeenCalledWith('view:did-navigate');
            expect(eventBus.removeAllListeners).toHaveBeenCalledWith('webpage:ingestion-complete');
            expect(eventBus.removeAllListeners).toHaveBeenCalledWith('webpage:needs-refresh');

            // Verify no timers are active (no updates should occur)
            await new Promise(resolve => setTimeout(resolve, 600));
            expect(objectModel.updateChildIds).not.toHaveBeenCalled();
        });
    });
});