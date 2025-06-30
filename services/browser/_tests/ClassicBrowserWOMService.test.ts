import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { ClassicBrowserWOMService } from '../ClassicBrowserWOMService';
import { ObjectModel } from '../../../models/ObjectModel';
import { CompositeObjectEnrichmentService } from '../../CompositeObjectEnrichmentService';
import { ClassicBrowserStateService } from '../ClassicBrowserStateService';
import { logger } from '../../../utils/logger';

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
    let eventEmitter: EventEmitter;
    let stateService: ClassicBrowserStateService;

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

        eventEmitter = new EventEmitter();

        stateService = {
            states: new Map(),
        } as unknown as ClassicBrowserStateService;

        // Create service
        service = new ClassicBrowserWOMService({
            objectModel,
            compositeEnrichmentService,
            eventEmitter,
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

            // Setup state
            stateService.states.set(windowId, {
                tabs: [{ id: tabId, url, title }],
                activeTabId: tabId,
            });

            // Mock existing webpage
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue({
                id: objectId,
                sourceUri: url,
            });

            // Emit navigation event
            eventEmitter.emit('view:did-navigate', { windowId, url, title });

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 0));

            // Verify object was updated
            expect(objectModel.updateLastAccessed).toHaveBeenCalledWith(objectId);
            expect(eventEmitter.listenerCount('webpage:needs-refresh')).toBeGreaterThan(0);
        });

        it('should emit ingestion event for new webpage', async () => {
            const windowId = 'window-1';
            const url = 'https://newpage.com';
            const title = 'New Page';
            const tabId = 'tab-1';

            // Setup state
            stateService.states.set(windowId, {
                tabs: [{ id: tabId, url, title }],
                activeTabId: tabId,
            });

            // Mock no existing webpage
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue(null);

            // Listen for ingestion event
            const ingestionSpy = vi.fn();
            eventEmitter.on('webpage:needs-ingestion', ingestionSpy);

            // Emit navigation event
            eventEmitter.emit('view:did-navigate', { windowId, url, title });

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 0));

            // Verify ingestion event was emitted
            expect(ingestionSpy).toHaveBeenCalledWith({
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
            stateService.states.set(windowId, {
                tabs: [],
                activeTabId: null,
            });

            // Emit navigation event
            eventEmitter.emit('view:did-navigate', { windowId, url, title });

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 0));

            // Verify no object operations
            expect(objectModel.findBySourceUri).not.toHaveBeenCalled();
        });
    });

    describe('tab group management', () => {
        it('should create tab group when window has multiple tabs', async () => {
            const windowId = 'window-1';
            const tabGroupId = 'tab-group-1';

            // Setup state with multiple tabs
            const browserState = {
                tabs: [
                    { id: 'tab-1', url: 'https://page1.com', title: 'Page 1' },
                    { id: 'tab-2', url: 'https://page2.com', title: 'Page 2' },
                ],
                activeTabId: 'tab-1',
                tabGroupId: null,
            };
            stateService.states.set(windowId, browserState);

            // Mock tab group creation
            vi.mocked(objectModel.createOrUpdate).mockResolvedValue({
                id: tabGroupId,
                objectType: 'tab_group',
                sourceUri: `tab-group://window-${windowId}`,
                title: 'Browser Window',
            });

            await service.checkAndCreateTabGroup(windowId);

            // Verify tab group was created
            expect(objectModel.createOrUpdate).toHaveBeenCalledWith({
                objectType: 'tab_group',
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
            stateService.states.set(windowId, {
                tabs: [{ id: 'tab-1', url: 'https://page1.com', title: 'Page 1' }],
                activeTabId: 'tab-1',
                tabGroupId: null,
            });

            await service.checkAndCreateTabGroup(windowId);

            // Verify no tab group was created
            expect(objectModel.createOrUpdate).not.toHaveBeenCalled();
        });

        it('should not create duplicate tab group', async () => {
            const windowId = 'window-1';

            // Setup state with existing tab group
            stateService.states.set(windowId, {
                tabs: [
                    { id: 'tab-1', url: 'https://page1.com', title: 'Page 1' },
                    { id: 'tab-2', url: 'https://page2.com', title: 'Page 2' },
                ],
                activeTabId: 'tab-1',
                tabGroupId: 'existing-group',
            });

            await service.checkAndCreateTabGroup(windowId);

            // Verify no new tab group was created
            expect(objectModel.createOrUpdate).not.toHaveBeenCalled();
        });

        it('should handle tab group creation errors', async () => {
            const windowId = 'window-1';

            // Setup state
            stateService.states.set(windowId, {
                tabs: [
                    { id: 'tab-1', url: 'https://page1.com', title: 'Page 1' },
                    { id: 'tab-2', url: 'https://page2.com', title: 'Page 2' },
                ],
                activeTabId: 'tab-1',
                tabGroupId: null,
            });

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
            stateService.states.set(windowId, {
                tabs: [
                    { id: 'tab-1', url: 'https://page1.com', title: 'Page 1' },
                    { id: 'tab-2', url: 'https://page2.com', title: 'Page 2' },
                ],
                activeTabId: 'tab-1',
                tabGroupId,
            });

            // Mock existing webpage
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue({
                id: objectId1,
                sourceUri: 'https://page1.com',
            });

            // Emit navigation event
            eventEmitter.emit('view:did-navigate', {
                windowId,
                url: 'https://page1.com',
                title: 'Page 1',
            });

            // Setup tab mappings
            eventEmitter.emit('webpage:ingestion-complete', { tabId: 'tab-1', objectId: objectId1 });
            eventEmitter.emit('webpage:ingestion-complete', { tabId: 'tab-2', objectId: objectId2 });

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
            stateService.states.set(windowId, {
                tabs: [{ id: 'tab-1' }],
                activeTabId: 'tab-1',
                tabGroupId,
            });

            // Mock existing webpage
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue({
                id: 'object-1',
                sourceUri: 'https://page.com',
            });

            // Emit multiple navigation events quickly
            for (let i = 0; i < 5; i++) {
                eventEmitter.emit('view:did-navigate', {
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
        it('should link tab to object on ingestion complete', () => {
            const tabId = 'tab-1';
            const objectId = 'object-1';

            eventEmitter.emit('webpage:ingestion-complete', { tabId, objectId });

            // Verify mapping was created
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining(`Linked tab ${tabId} to object ${objectId}`)
            );
        });

        it('should forward refresh events to WOM ingestion', () => {
            const objectId = 'object-1';
            const url = 'https://example.com';

            // Listen for forwarded event
            const refreshSpy = vi.fn();
            eventEmitter.on('wom:refresh-needed', refreshSpy);

            eventEmitter.emit('webpage:needs-refresh', { objectId, url });

            // Verify event was forwarded
            expect(refreshSpy).toHaveBeenCalledWith({ objectId, url });
        });
    });

    describe('tab mapping management', () => {
        it('should remove individual tab mapping', () => {
            const tabId = 'tab-1';
            const objectId = 'object-1';

            // Create and then remove mapping
            eventEmitter.emit('webpage:ingestion-complete', { tabId, objectId });
            
            // Verify mapping was created (through debug log)
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining(`Linked tab ${tabId} to object ${objectId}`)
            );

            // Remove the mapping
            service.removeTabMapping(tabId);

            // Create a new tab mapping to verify the old one was removed
            const tabId2 = 'tab-2';
            const objectId2 = 'object-2';
            eventEmitter.emit('webpage:ingestion-complete', { tabId: tabId2, objectId: objectId2 });

            // Now setup window state to test tab group update
            const windowId = 'window-1';
            stateService.states.set(windowId, {
                tabs: [
                    { id: tabId, url: 'https://page1.com' }, // removed mapping
                    { id: tabId2, url: 'https://page2.com' } // has mapping
                ],
                tabGroupId: 'group-1',
                activeTabId: tabId2,
            });

            // Manually trigger tab group update
            // @ts-expect-error - accessing private method for testing
            service['updateTabGroupChildren'](windowId);

            // Should only include tab2's object since tab1's mapping was removed
            expect(objectModel.updateChildIds).toHaveBeenCalledWith('group-1', [objectId2]);
        });

        it('should clear all window tab mappings', async () => {
            const windowId = 'window-1';
            const windowId2 = 'window-2';
            const tabs = [
                { id: 'tab-1', url: 'https://page1.com' },
                { id: 'tab-2', url: 'https://page2.com' },
                { id: 'tab-3', url: 'https://page3.com' },
            ];

            // Setup state for two windows
            stateService.states.set(windowId, {
                tabs,
                activeTabId: 'tab-1',
                tabGroupId: 'group-1',
            });

            stateService.states.set(windowId2, {
                tabs: [{ id: 'tab-4', url: 'https://page4.com' }],
                activeTabId: 'tab-4',
                tabGroupId: 'group-2',
            });

            // Create mappings for all tabs
            tabs.forEach((tab, index) => {
                eventEmitter.emit('webpage:ingestion-complete', {
                    tabId: tab.id,
                    objectId: `object-${index}`,
                });
            });
            eventEmitter.emit('webpage:ingestion-complete', {
                tabId: 'tab-4',
                objectId: 'object-4',
            });

            // Clear only window-1 mappings
            service.clearWindowTabMappings(windowId);

            // Mock webpage for window-2
            vi.mocked(objectModel.findBySourceUri).mockResolvedValue({
                id: 'object-4',
                sourceUri: 'https://page4.com',
            });
            
            // Trigger update for window-2 (should still have its mapping)
            eventEmitter.emit('view:did-navigate', {
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
            stateService.states.set(windowId, {
                tabs: [{ id: 'tab-1' }],
                activeTabId: 'tab-1',
            });

            // Create mappings
            eventEmitter.emit('webpage:ingestion-complete', {
                tabId: 'tab-1',
                objectId: 'object-1',
            });

            // Trigger navigation to create timer
            eventEmitter.emit('view:did-navigate', {
                windowId,
                url: 'https://page.com',
                title: 'Page',
            });

            // Perform cleanup
            await service.cleanup();

            // Verify all listeners were removed
            expect(eventEmitter.listenerCount('view:did-navigate')).toBe(0);
            expect(eventEmitter.listenerCount('webpage:ingestion-complete')).toBe(0);
            expect(eventEmitter.listenerCount('webpage:needs-refresh')).toBe(0);

            // Verify no timers are active (no updates should occur)
            await new Promise(resolve => setTimeout(resolve, 600));
            expect(objectModel.updateChildIds).not.toHaveBeenCalled();
        });
    });
});