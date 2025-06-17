import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ProfileService } from '../ProfileService';
import { UserProfileModel } from '../../models/UserProfileModel';
import { UserProfile, UserProfileUpdatePayload } from '../../shared/types';
import runMigrations from '../../models/runMigrations';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// Mock logger to prevent console output during tests
vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock uuid to have predictable IDs in tests
vi.mock('uuid', () => ({
    v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9))
}));

describe('ProfileService', () => {
    let db: Database.Database;
    let userProfileModel: UserProfileModel;
    let profileService: ProfileService;

    beforeEach(async () => {
        // Create in-memory database
        db = new Database(':memory:');
        await runMigrations(db);
        
        // Initialize model
        userProfileModel = new UserProfileModel(db);
        
        // Create service with dependency injection
        profileService = new ProfileService({
            db,
            userProfileModel
        });
        
        // Initialize service
        await profileService.initialize();
    });

    afterEach(async () => {
        // Cleanup service
        await profileService.cleanup();
        
        // Close database
        if (db && db.open) {
            db.close();
        }
        
        vi.clearAllMocks();
    });

    describe('getProfile', () => {
        it('should create a default profile if none exists', async () => {
            const profile = await profileService.getProfile('test_user');
            
            expect(profile).toBeDefined();
            expect(profile.userId).toBe('test_user');
            expect(profile.name).toBe('friend');
            expect(profile.aboutMe).toBeNull();
            expect(profile.customInstructions).toBeNull();
        });

        it('should return existing profile', async () => {
            // Create a profile first
            userProfileModel.updateProfile('test_user', {
                name: 'John Doe',
                aboutMe: 'Software developer',
                customInstructions: 'Be concise'
            });

            const profile = await profileService.getProfile('test_user');
            
            expect(profile.name).toBe('John Doe');
            expect(profile.aboutMe).toBe('Software developer');
            expect(profile.customInstructions).toBe('Be concise');
        });

        it('should use default_user if no userId provided', async () => {
            const profile = await profileService.getProfile();
            
            expect(profile.userId).toBe('default_user');
            expect(profile.name).toBe('Default User');
        });

        it('should handle errors gracefully', async () => {
            // Mock the model to throw an error
            vi.spyOn(userProfileModel, 'getProfile').mockImplementation(() => {
                throw new Error('Database error');
            });

            await expect(profileService.getProfile()).rejects.toThrow('Database error');
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('[ProfileService] getProfile failed after'),
                expect.any(Error)
            );
        });
    });

    describe('updateProfile', () => {
        it('should update profile with all fields', async () => {
            const payload: UserProfileUpdatePayload = {
                userId: 'test_user',
                name: 'Jane Doe',
                aboutMe: 'Designer',
                customInstructions: 'Use examples',
                inferredUserGoals: [
                    { text: 'Learn TypeScript', confidence: 0.9 },
                    { text: 'Build projects', confidence: 0.8 }
                ],
                synthesizedInterests: ['Web development', 'AI'],
                synthesizedPreferredSources: ['MDN', 'Stack Overflow'],
                synthesizedRecentIntents: ['create component', 'debug error']
            };

            const updated = await profileService.updateProfile(payload);
            
            expect(updated.name).toBe('Jane Doe');
            expect(updated.aboutMe).toBe('Designer');
            expect(updated.customInstructions).toBe('Use examples');
            expect(updated.inferredUserGoals).toHaveLength(2);
            expect(updated.inferredUserGoals![0].text).toBe('Learn TypeScript');
            expect(updated.inferredUserGoals![1].text).toBe('Build projects');
            expect(updated.synthesizedInterests).toEqual(['Web development', 'AI']);
            expect(updated.synthesizedPreferredSources).toEqual(['MDN', 'Stack Overflow']);
            expect(updated.synthesizedRecentIntents).toEqual(['create component', 'debug error']);
        });

        it('should update partial fields', async () => {
            // Create initial profile
            await profileService.updateProfile({
                userId: 'test_user',
                name: 'Initial Name',
                aboutMe: 'Initial About'
            });

            // Update only name
            const updated = await profileService.updateProfile({
                userId: 'test_user',
                name: 'Updated Name'
            });
            
            expect(updated.name).toBe('Updated Name');
            expect(updated.aboutMe).toBe('Initial About'); // Should remain unchanged
        });

        it('should use default_user if userId not provided', async () => {
            const updated = await profileService.updateProfile({
                name: 'Test User'
            });
            
            expect(updated.userId).toBe('default_user');
            expect(updated.name).toBe('Test User');
        });

        it('should handle errors gracefully', async () => {
            vi.spyOn(userProfileModel, 'updateProfile').mockImplementation(() => {
                throw new Error('Update failed');
            });

            await expect(profileService.updateProfile({ name: 'Test' })).rejects.toThrow('Update failed');
            expect(logger.error).toHaveBeenCalledWith(
                '[ProfileService] Error updating profile:',
                expect.any(Error)
            );
        });
    });

    describe('updateExplicitFields', () => {
        it('should update only explicit user-provided fields', async () => {
            // Set up initial profile with both explicit and synthesized fields
            await profileService.updateProfile({
                userId: 'test_user',
                name: 'Initial Name',
                synthesizedInterests: ['Interest 1', 'Interest 2']
            });

            // Update only explicit fields
            const updated = await profileService.updateExplicitFields('test_user', {
                name: 'New Name',
                aboutMe: 'New about me',
                customInstructions: 'New instructions'
            });
            
            expect(updated.name).toBe('New Name');
            expect(updated.aboutMe).toBe('New about me');
            expect(updated.customInstructions).toBe('New instructions');
            expect(updated.synthesizedInterests).toEqual(['Interest 1', 'Interest 2']); // Should remain unchanged
        });

        it('should handle null values', async () => {
            // Create profile with values
            await profileService.updateProfile({
                userId: 'test_user',
                name: 'Test User',
                aboutMe: 'About me text',
                customInstructions: 'Instructions'
            });

            // Update to null
            const updated = await profileService.updateExplicitFields('test_user', {
                aboutMe: null,
                customInstructions: null
            });
            
            expect(updated.name).toBe('Test User'); // Should remain unchanged
            expect(updated.aboutMe).toBeNull();
            expect(updated.customInstructions).toBeNull();
        });
    });

    describe('updateSynthesizedFields', () => {
        it('should update only AI-generated synthesized fields', async () => {
            // Set up initial profile
            await profileService.updateProfile({
                userId: 'test_user',
                name: 'User Name',
                synthesizedInterests: ['Old Interest']
            });

            // Update synthesized fields
            const updated = await profileService.updateSynthesizedFields('test_user', {
                inferredUserGoals: [
                    { text: 'New Goal 1', confidence: 0.9 },
                    { text: 'New Goal 2', confidence: 0.85 }
                ],
                synthesizedInterests: ['AI', 'Machine Learning'],
                synthesizedPreferredSources: ['arXiv', 'Papers with Code'],
                synthesizedRecentIntents: ['research ML papers', 'implement algorithm']
            });
            
            expect(updated.name).toBe('User Name'); // Should remain unchanged
            expect(updated.inferredUserGoals).toHaveLength(2);
            expect(updated.inferredUserGoals![0].text).toBe('New Goal 1');
            expect(updated.inferredUserGoals![1].text).toBe('New Goal 2');
            expect(updated.synthesizedInterests).toEqual(['AI', 'Machine Learning']);
            expect(updated.synthesizedPreferredSources).toEqual(['arXiv', 'Papers with Code']);
            expect(updated.synthesizedRecentIntents).toEqual(['research ML papers', 'implement algorithm']);
        });
    });

    describe('getEnrichedProfileForAI', () => {
        it('should format profile data for AI context', async () => {
            // Create a comprehensive profile
            await profileService.updateProfile({
                userId: 'test_user',
                name: 'John Smith',
                aboutMe: 'Full-stack developer interested in AI',
                customInstructions: 'Explain concepts clearly',
                statedUserGoals: [
                    { id: '1', text: 'Master TypeScript', priority: 1, status: 'active', createdAt: Date.now() },
                    { id: '2', text: 'Learn Rust', priority: 2, status: 'completed', createdAt: Date.now() }
                ],
                inferredUserGoals: [
                    { text: 'Build AI applications', confidence: 0.85 },
                    { text: 'Contribute to open source', confidence: 0.72 }
                ],
                synthesizedInterests: ['Web Development', 'Machine Learning', 'DevOps'],
                inferredExpertiseAreas: ['JavaScript', 'Python', 'Cloud Computing'],
                synthesizedPreferredSources: ['MDN', 'HackerNews', 'GitHub'],
                preferredSourceTypes: ['technical_documentation', 'tutorials', 'code_examples'],
                synthesizedRecentIntents: ['implement auth system', 'optimize database queries'],
                timeBoundGoals: [
                    {
                        id: '5',
                        text: 'Complete project X',
                        createdAt: new Date().toISOString(),
                        timeHorizon: {
                            type: 'month',
                            startDate: '2024-01-01',
                            endDate: '2024-01-31'
                        }
                    }
                ]
            });

            const enrichedProfile = await profileService.getEnrichedProfileForAI('test_user');
            
            expect(enrichedProfile).toContain('User Name: John Smith');
            expect(enrichedProfile).toContain('About User: Full-stack developer interested in AI');
            expect(enrichedProfile).toContain('Custom Instructions: Explain concepts clearly');
            expect(enrichedProfile).toContain('Stated Goals: Master TypeScript'); // Only active goals
            expect(enrichedProfile).not.toContain('Learn Rust'); // Completed goal should not appear
            expect(enrichedProfile).toContain('Inferred Goals: Build AI applications (85% confidence)');
            expect(enrichedProfile).toContain('User Interests: Web Development, Machine Learning, DevOps');
            expect(enrichedProfile).toContain('Areas of Expertise: JavaScript, Python, Cloud Computing');
            expect(enrichedProfile).toContain('Preferred Sources: MDN, HackerNews, GitHub');
            expect(enrichedProfile).toContain('Preferred Source Types: technical_documentation, tutorials, code_examples');
            expect(enrichedProfile).toContain('Recent Focus Areas: implement auth system, optimize database queries');
            expect(enrichedProfile).toContain('Time-Bound Goals: Complete project X (month goal: 2024-01-01 to 2024-01-31)');
        });

        it('should return minimal message when profile is empty', async () => {
            const enrichedProfile = await profileService.getEnrichedProfileForAI('new_user');
            
            expect(enrichedProfile).toBe('User Name: friend');
        });

        it('should handle errors gracefully and return default message', async () => {
            vi.spyOn(profileService, 'getProfile').mockRejectedValue(new Error('Database error'));

            const enrichedProfile = await profileService.getEnrichedProfileForAI('test_user');
            
            expect(enrichedProfile).toBe('No user profile information available.');
            expect(logger.error).toHaveBeenCalledWith(
                '[ProfileService] Error getting enriched profile:',
                expect.any(Error)
            );
        });
    });

    describe('clearSynthesizedFields', () => {
        it('should clear all synthesized fields', async () => {
            // Create profile with synthesized fields
            await profileService.updateProfile({
                userId: 'test_user',
                name: 'User Name',
                aboutMe: 'About me',
                inferredUserGoals: [{ text: 'Goal 1', confidence: 0.8 }],
                synthesizedInterests: ['Interest 1', 'Interest 2'],
                synthesizedPreferredSources: ['Source 1'],
                synthesizedRecentIntents: ['Intent 1'],
                inferredExpertiseAreas: ['Area 1'],
                preferredSourceTypes: ['Type 1']
            });

            const cleared = await profileService.clearSynthesizedFields('test_user');
            
            // Explicit fields should remain
            expect(cleared.name).toBe('User Name');
            expect(cleared.aboutMe).toBe('About me');
            
            // Synthesized fields should be null
            expect(cleared.inferredUserGoals).toBeNull();
            expect(cleared.synthesizedInterests).toBeNull();
            expect(cleared.synthesizedPreferredSources).toBeNull();
            expect(cleared.synthesizedRecentIntents).toBeNull();
            expect(cleared.inferredExpertiseAreas).toBeNull();
            expect(cleared.preferredSourceTypes).toBeNull();
        });
    });

    describe('addTimeBoundGoals', () => {
        it('should add time-bound goals with calculated end dates', async () => {
            const goals = [
                { text: 'Daily goal', timeframeType: 'day' as const },
                { text: 'Weekly goal', timeframeType: 'week' as const },
                { text: 'Monthly goal', timeframeType: 'month' as const },
                { text: 'Quarterly goal', timeframeType: 'quarter' as const },
                { text: 'Yearly goal', timeframeType: 'year' as const }
            ];

            const updated = await profileService.addTimeBoundGoals('test_user', goals);
            
            expect(updated.timeBoundGoals).toHaveLength(5);
            
            // Check that each goal has proper structure
            updated.timeBoundGoals?.forEach((goal, index) => {
                expect(goal.id).toBeDefined();
                expect(goal.text).toBe(goals[index].text);
                expect(goal.createdAt).toBeDefined();
                expect(goal.timeHorizon.type).toBe(goals[index].timeframeType);
                expect(goal.timeHorizon.startDate).toBeDefined();
                expect(goal.timeHorizon.endDate).toBeDefined();
                
                // Verify end date is after start date
                const start = new Date(goal.timeHorizon.startDate);
                const end = new Date(goal.timeHorizon.endDate);
                expect(end.getTime()).toBeGreaterThan(start.getTime());
            });
        });

        it('should use provided start and end dates', async () => {
            const goals = [{
                text: 'Custom date goal',
                timeframeType: 'month' as const,
                startDate: '2024-03-01',
                endDate: '2024-03-15'
            }];

            const updated = await profileService.addTimeBoundGoals('test_user', goals);
            
            expect(updated.timeBoundGoals).toHaveLength(1);
            expect(updated.timeBoundGoals![0].timeHorizon.startDate).toBe('2024-03-01');
            expect(updated.timeBoundGoals![0].timeHorizon.endDate).toBe('2024-03-15');
        });

        it('should append to existing goals', async () => {
            // Add first goal
            await profileService.addTimeBoundGoals('test_user', [
                { text: 'First goal', timeframeType: 'week' as const }
            ]);

            // Add second goal
            const updated = await profileService.addTimeBoundGoals('test_user', [
                { text: 'Second goal', timeframeType: 'month' as const }
            ]);
            
            expect(updated.timeBoundGoals).toHaveLength(2);
            expect(updated.timeBoundGoals![0].text).toBe('First goal');
            expect(updated.timeBoundGoals![1].text).toBe('Second goal');
        });
    });

    describe('removeTimeBoundGoals', () => {
        it('should remove specified goals by ID', async () => {
            // Add multiple goals
            const profile = await profileService.addTimeBoundGoals('test_user', [
                { text: 'Goal 1', timeframeType: 'week' as const },
                { text: 'Goal 2', timeframeType: 'month' as const },
                { text: 'Goal 3', timeframeType: 'year' as const }
            ]);

            const goalIds = profile.timeBoundGoals!.slice(0, 2).map(g => g.id);

            // Remove first two goals
            const updated = await profileService.removeTimeBoundGoals('test_user', goalIds);
            
            expect(updated.timeBoundGoals).toHaveLength(1);
            expect(updated.timeBoundGoals![0].text).toBe('Goal 3');
        });

        it('should handle removing non-existent goal IDs gracefully', async () => {
            // Add a goal
            await profileService.addTimeBoundGoals('test_user', [
                { text: 'Goal 1', timeframeType: 'week' as const }
            ]);

            // Try to remove non-existent IDs
            const updated = await profileService.removeTimeBoundGoals('test_user', ['fake-id-1', 'fake-id-2']);
            
            expect(updated.timeBoundGoals).toHaveLength(1);
            expect(updated.timeBoundGoals![0].text).toBe('Goal 1');
        });

        it('should handle empty goal list', async () => {
            const updated = await profileService.removeTimeBoundGoals('test_user', ['some-id']);
            
            expect(updated.timeBoundGoals).toEqual([]);
        });
    });

    describe('profileModel getter', () => {
        it('should provide access to underlying model', () => {
            const model = profileService.profileModel;
            
            expect(model).toBe(userProfileModel);
            expect(model).toBeInstanceOf(UserProfileModel);
        });
    });
});