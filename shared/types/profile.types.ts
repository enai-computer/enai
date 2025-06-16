/** Types of activities that can be logged. */
export type ActivityType = 
  | 'notebook_visit'
  | 'notebook_created'
  | 'intent_selected'
  | 'chat_session_started'
  | 'chat_topic_discussed'
  | 'search_performed'
  | 'object_ingested'
  | 'content_saved'
  | 'browser_navigation'
  | 'info_slice_selected'
  | 'slice_viewed'
  | 'stated_goal_added'
  | 'stated_goal_updated'
  | 'stated_goal_completed'
  | 'todo_created'
  | 'todo_updated'
  | 'todo_completed'
  | 'todo_status_changed';

/** Represents a logged user activity. */
export interface UserActivity {
  id: string; // UUID v4
  timestamp: Date;
  activityType: ActivityType;
  detailsJson: string; // JSON string with activity-specific data
  userId: string; // For future multi-user support
}

/** Payload for logging an activity. */
export interface ActivityLogPayload {
  activityType: ActivityType;
  details: Record<string, any>; // Will be stringified before storage
  userId?: string; // Optional, defaults to 'default_user'
}

/** Represents a user-stated goal. */
export interface UserGoalItem {
  id: string; // UUID v4
  text: string;
  createdAt: number; // Unix timestamp
  status: 'active' | 'completed' | 'archived';
  priority?: number; // 1-5, lower is higher priority
}

/** Represents an AI-inferred goal with confidence. */
export interface InferredUserGoalItem {
  text: string;
  confidence?: number; // 0.0 to 1.0
  evidence?: string[]; // Brief pointers to supporting activities/todos
}

/** Represents a time-bound goal with absolute dates. */
export interface TimeBoundGoal {
  id: string; // UUID v4
  text: string;
  createdAt: string; // ISO date when goal was captured
  timeHorizon: {
    type: 'day' | 'week' | 'month' | 'quarter' | 'year';
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
  };
}

/** Represents the user's profile with explicit and synthesized data. */
export interface UserProfile {
  userId: string; // Primary key, e.g., "default_user"
  name?: string | null; // User's display name
  aboutMe?: string | null; // User's self-description
  customInstructions?: string | null; // Custom instructions for AI
  statedUserGoals?: UserGoalItem[] | null; // User-defined goals
  inferredUserGoals?: InferredUserGoalItem[] | null; // AI-inferred goals with probabilities
  timeBoundGoals?: TimeBoundGoal[] | null; // Goals with specific time horizons
  pastGoals?: TimeBoundGoal[] | null; // Historical goals (for future implementation)
  synthesizedInterests?: string[] | null; // AI-inferred interests  
  synthesizedPreferredSources?: string[] | null; // AI-inferred preferred sources
  synthesizedRecentIntents?: string[] | null; // AI-inferred recent intents
  inferredExpertiseAreas?: string[] | null; // AI-inferred areas of expertise from content
  preferredSourceTypes?: string[] | null; // AI-inferred preferred content types
  updatedAt: Date;
}

/** Payload for updating user profile. */
export interface UserProfileUpdatePayload {
  userId?: string; // Optional, defaults to 'default_user'
  name?: string | null;
  aboutMe?: string | null;
  customInstructions?: string | null;
  statedUserGoals?: UserGoalItem[] | null;
  inferredUserGoals?: InferredUserGoalItem[] | null;
  timeBoundGoals?: TimeBoundGoal[] | null;
  pastGoals?: TimeBoundGoal[] | null;
  synthesizedInterests?: string[] | null;
  synthesizedPreferredSources?: string[] | null;
  synthesizedRecentIntents?: string[] | null;
  inferredExpertiseAreas?: string[] | null;
  preferredSourceTypes?: string[] | null;
}