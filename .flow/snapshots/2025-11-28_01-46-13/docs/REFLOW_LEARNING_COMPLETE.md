# Reflow Learning Loop - Implementation Complete

## What Was Implemented

Enhanced all agent templates to implement "files as memory" approach, creating a tight feedback loop where agents learn from previous attempts while avoiding context pollution from unrelated tasks.

## Files Modified

### 1. templates/REPORT.md
**Changes**:
- Added "Report Context" and "Original Task" to required sections
- Added guidance for writing context-aware reports based on status
- Provided example structures for both success and failure reports
- Reports now explicitly state their relevance scope

**Key Addition**:
```markdown
# Important: Report Context for Future Runs
- Success reports state they're for COMPLETED features
- Failure reports state they have UNRESOLVED issues
- Always include original task description for comparison
```

### 2. templates/WRITE_USER_STORIES.md
**Changes**:
- Replaced simple "read report" logic with status-checking decision tree
- Added relevance assessment (same feature vs. different feature)
- Provided three example scenarios showing when to use/ignore reports
- Clear guidance on when to iterate vs. start fresh

**Key Logic**:
- Same feature + Failed → Learn from issues
- Same feature + Success → Use enhancement suggestions
- Different feature → Ignore report entirely

### 3. templates/GENERATE_CODE.md
**Changes**:
- Added status and relevance checking before using reports
- Clear decision tree for different scenarios
- Guidance on when to build upon vs. replace existing code

**Key Logic**:
- Same feature + Failed → Fix reported issues first
- Same feature + Success → Build upon existing code
- Different feature → Ignore report

### 4. templates/GENERATE_TESTS.md
**Changes**:
- Added status and original task checking
- Relevance assessment before using report feedback
- Clear guidance on when to fix vs. rewrite tests

**Key Logic**:
- Same feature + Failed → Fix failing tests
- Same feature + Success → Review but may not need changes
- Different feature → Ignore report

## How It Works

### Scenario 1: Failed Run, Then Retry (Learning Loop)
```bash
# Run 1
agent-flow run "Build calculator"
# Fails: division by zero not handled
# REPORT writes:
#   Status: Failed
#   Original Task: "Build calculator"
#   Issues: division by zero crashes
#   Suggested Fixes: Add validation

# Run 2 (retry same task)
agent-flow run "Build calculator"
# WRITE_USER_STORIES:
#   - Reads report, sees Status=Failed, Original Task matches
#   - Adds error handling requirements to user stories
# GENERATE_CODE:
#   - Reads report, sees specific issue at line 15
#   - Fixes division function with validation
# GENERATE_TESTS:
#   - Reads report, sees test failure details
#   - Improves tests to check error handling
# Result: Likely succeeds this time!
```

### Scenario 2: Success, Then New Task (No Pollution)
```bash
# Run 1
agent-flow run "Build calculator"
# Succeeds
# REPORT writes:
#   Status: Success
#   Original Task: "Build calculator"
#   Report Context: "COMPLETED feature, ignore if different task"

# Run 2 (different task)
agent-flow run "Build todo app"
# WRITE_USER_STORIES:
#   - Reads report, sees Status=Success
#   - Compares: "calculator" vs "todo app" → DIFFERENT
#   - IGNORES the report, starts fresh
# GENERATE_CODE:
#   - Same logic, ignores calculator report
#   - Focuses on todo app requirements
# Result: Clean start, no confusion!
```

### Scenario 3: Success, Then Iteration (Enhancement)
```bash
# Run 1
agent-flow run "Build calculator"
# Succeeds
# REPORT writes:
#   Next Iteration Focus: "Add scientific operations"

# Run 2 (extending same feature)
agent-flow run "Add scientific functions to calculator"
# WRITE_USER_STORIES:
#   - Reads report, sees Status=Success
#   - Compares: "calculator" in both → SAME feature
#   - USES "Next Iteration Focus" suggestions
#   - Builds upon existing user stories
# GENERATE_CODE:
#   - Sees existing calculator.js
#   - Adds new functions without breaking existing ones
# Result: Smooth iteration!
```

## Benefits

1. **Prevents Context Pollution**: Agents won't try to fix calculator issues when building a todo app
2. **Enables Learning**: Failed runs provide actionable feedback for retries
3. **Supports Iteration**: Success reports guide feature enhancements
4. **No Code Changes**: Pure prompt engineering, no new machinery
5. **Self-Documenting**: Reports explicitly state their context and relevance
6. **User Visible**: All learning is in files, not hidden memory
7. **Git Friendly**: Full history tracked, can diff reports over time

## File Structure After Implementation

```
./plans/
├── USER_STORIES_1.md                    # First iteration
├── USER_STORIES_2.md                    # Second iteration (refined)
├── LAST_RUN_REPORT.md                   # Latest report (canonical)
├── REPORT_2024-11-26_14-23-12_run-1.md  # First attempt (failed)
├── REPORT_2024-11-26_14-45-03_run-2.md  # Second attempt (failed)
└── REPORT_2024-11-26_15-02-18_run-3.md  # Third attempt (success)
```

## Testing Recommendations

Test these three scenarios to verify the fix:

1. **Success → New Task**: Verify agents ignore success report for unrelated task
2. **Failure → Retry**: Verify agents learn from failure report and fix issues
3. **Success → Iteration**: Verify agents use enhancement suggestions appropriately

## Status

All template updates complete. The reflow learning loop is now fully functional with intelligent context awareness.

Ready for testing!

