# User Profile System Testing Guide

## Manual Testing Checklist

### 1. Activity Logging Tests

#### Intent Selection
- [ ] Type various intents in the intent line (e.g., "create notebook", "search for X")
- [ ] Press Enter to submit intents
- [ ] Verify activity logged with type 'intent_selected'

#### Notebook Operations
- [ ] Create a new notebook
- [ ] Open existing notebooks
- [ ] Verify 'notebook_created' and 'notebook_opened' activities

#### Chat Sessions
- [ ] Start chat conversations in different notebooks
- [ ] Have conversations of varying lengths (short vs long)
- [ ] Verify 'chat_topic_discussed' activities logged

#### Browser Navigation
- [ ] Navigate to different websites in ClassicBrowser
- [ ] Stay on same domain (should not log multiple times)
- [ ] Navigate to new domains (should log)
- [ ] Stay on a page for 30+ seconds (should log)

### 2. Profile Synthesis Tests

#### Initial Synthesis
- [ ] Start the app fresh
- [ ] Wait for initial profile synthesis (should run on startup)
- [ ] Check console logs for "[ProfileAgent] Starting profile synthesis"

#### Periodic Updates
- [ ] Leave app running for 15 minutes
- [ ] Check for periodic synthesis logs
- [ ] Verify profile updates with new activities

#### Content Synthesis
- [ ] Save several web pages
- [ ] Wait for content synthesis (runs every 30 minutes)
- [ ] Check for expertise areas being identified

### 3. AI Integration Tests

#### Chat with Context
- [ ] After profile is synthesized, start a new chat
- [ ] Ask questions related to your recent activities
- [ ] Verify AI responses reflect your profile context

## Quick Test Commands

### 1. Check Current Profile
```bash
# Run in project directory
npm run electron:dev
# Then in browser console:
window.electron.getProfile('default_user')
```

### 2. Check Recent Activities
```bash
# In electron console, check activity logs
```

### 3. Force Profile Synthesis
```bash
# In browser console:
window.electron.synthesizeProfile()
```

## Expected Behaviors

### Activity Logging
- Intents: Logged immediately on selection
- Notebooks: Logged on create/open
- Chats: Logged when conversation has 2+ messages
- Navigation: Only significant navigations (new domains or 30+ seconds)

### Profile Synthesis
- Runs on startup
- Updates every 15 minutes for activities/todos
- Updates every 30 minutes for content
- Only processes if changes detected

### AI Context
- Chat responses should reference your:
  - Current goals (from todos)
  - Recent interests (from activities)
  - Expertise areas (from content)
  - Preferred sources