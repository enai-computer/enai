-- Migration: Add time_bound_goals_json and past_goals_json columns to user_profiles table
-- This allows storing goals with absolute temporal context
-- time_bound_goals_json: Current active goals with timeframes
-- past_goals_json: Historical goals (for future implementation)

ALTER TABLE user_profiles 
ADD COLUMN time_bound_goals_json TEXT DEFAULT NULL;

ALTER TABLE user_profiles 
ADD COLUMN past_goals_json TEXT DEFAULT NULL;

-- Structure for time_bound_goals_json:
-- {
--   "goals": [
--     {
--       "id": "uuid",
--       "text": "enhance the chat UI",
--       "createdAt": "2025-06-03T04:11:35.758Z",
--       "timeHorizon": {
--         "type": "week",
--         "startDate": "2025-06-03",
--         "endDate": "2025-06-09"
--       }
--     }
--   ]
-- }
--
-- Future: Logic to move expired goals to past_goals_json