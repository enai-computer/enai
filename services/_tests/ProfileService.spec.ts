import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ProfileService } from '../ProfileService';
import { UserProfileModel } from '../../models/UserProfileModel';
import { UserProfile, UserProfileUpdatePayload } from '../../shared/types';
import { logger } from '../../utils/logger';

// Mock logger to prevent console output during tests
vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('ProfileService with Dependency Injection', () => {
    let db: Database.Database;
    let userProfileModel: UserProfileModel;
    let profileService: ProfileService;

    beforeEach(() => {
        // Create in-memory database
        db = new Database(':memory:');
        
        // Run minimal schema setup for testing
        db.exec(`
            CREATE TABLE user_profiles (
                user_id TEXT PRIMARY KEY,
                name TEXT,
                about_me TEXT,
                custom_instructions TEXT,
                inferred_user_goals TEXT,
                synthesized_interests TEXT,
                inferred_expertise_areas TEXT,
                synthesized_preferred_sources TEXT,
                preferred_source_types TEXT,
                synthesized_recent_intents TEXT,
                time_bound_goals TEXT,
                stated_user_goals TEXT,
                created_at INTEGER,
                updated_at INTEGER
            );
        `);
        
        // Create mock UserProfileModel
        userProfileModel = new UserProfileModel(db);
        
        // Create ProfileService with dependency injection
        profileService = new ProfileService({
            db,
            userProfileModel
        });
    });

    afterEach(() => {
        // Close database
        if (db && db.open) {
            db.close();
        }
        vi.clearAllMocks();
    });

    describe('Constructor and BaseService integration', () => {
        it('should initialize with proper dependencies', () => {
            expect(profileService).toBeDefined();
            expect(profileService.profileModel).toBe(userProfileModel);
            expect(logger.info).toHaveBeenCalledWith('[ProfileService] Initialized.');
        });

        it('should inherit BaseService functionality', async () => {
            // Test that execute wrapper works
            const profile = await profileService.getProfile('test_user');
            
            // Should log the operation with new execute wrapper format
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('[ProfileService] getProfile started')
            );
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('[ProfileService] getProfile completed')
            );
        });
    });

    describe('Lifecycle methods', () => {
        it('should support initialize method', async () => {
            // ProfileService doesn't override initialize, so it should be a no-op
            await expect(profileService.initialize()).resolves.toBeUndefined();
        });

        it('should support cleanup method', async () => {
            // ProfileService doesn't override cleanup, so it should be a no-op
            await expect(profileService.cleanup()).resolves.toBeUndefined();
        });

        it('should support health check', async () => {
            const isHealthy = await profileService.healthCheck();
            expect(isHealthy).toBe(true);
        });
    });

    describe('Error handling with BaseService', () => {
        it('should use execute wrapper for error handling', async () => {
            // Mock the model to throw an error
            vi.spyOn(userProfileModel, 'getProfile').mockImplementation(() => {
                throw new Error('Database connection lost');
            });

            await expect(profileService.getProfile('test_user')).rejects.toThrow('Database connection lost');
            
            // Should log the error with proper context
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('[ProfileService] getProfile failed'),
                expect.any(Error)
            );
        });
    });

    describe('Dependency injection patterns', () => {
        it('should work with mocked dependencies', async () => {
            // Create a fully mocked UserProfileModel
            const mockUserProfileModel = {
                getProfile: vi.fn().mockReturnValue({
                    userId: 'mock_user',
                    name: 'Mock User',
                    aboutMe: 'Mocked profile',
                    customInstructions: null,
                    updatedAt: Date.now()
                }),
                updateProfile: vi.fn(),
                deleteProfile: vi.fn()
            } as unknown as UserProfileModel;

            // Create service with mocked dependencies
            const serviceWithMocks = new ProfileService({
                db,
                userProfileModel: mockUserProfileModel
            });

            const profile = await serviceWithMocks.getProfile('mock_user');
            
            expect(mockUserProfileModel.getProfile).toHaveBeenCalledWith('mock_user');
            expect(profile.name).toBe('Mock User');
            expect(profile.aboutMe).toBe('Mocked profile');
        });

        it('should allow testing without database', async () => {
            // Create a stub model that doesn't need a real database
            const stubModel = {
                getProfile: vi.fn().mockReturnValue(null),
                updateProfile: vi.fn().mockImplementation((userId, updates) => ({
                    userId,
                    ...updates,
                    updatedAt: Date.now()
                }))
            } as unknown as UserProfileModel;

            const serviceWithStub = new ProfileService({
                db: {} as Database.Database, // Dummy db object
                userProfileModel: stubModel
            });

            // Should create default profile when none exists
            const profile = await serviceWithStub.getProfile('new_user');
            
            expect(stubModel.getProfile).toHaveBeenCalledWith('new_user');
            expect(stubModel.updateProfile).toHaveBeenCalledWith('new_user', {
                name: 'friend'
            });
        });
    });

    describe('Integration with real model', () => {
        it('should perform database operations through injected model', async () => {
            // This tests the real integration
            const payload: UserProfileUpdatePayload = {
                userId: 'integration_test_user',
                name: 'Integration Test',
                aboutMe: 'Testing DI pattern'
            };

            const updated = await profileService.updateProfile(payload);
            
            expect(updated.userId).toBe('integration_test_user');
            expect(updated.name).toBe('Integration Test');
            expect(updated.aboutMe).toBe('Testing DI pattern');

            // Verify it's persisted
            const retrieved = await profileService.getProfile('integration_test_user');
            expect(retrieved.name).toBe('Integration Test');
        });
    });
});