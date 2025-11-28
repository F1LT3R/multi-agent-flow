# Test Framework Clarification Fix

## Problem

The REVIEW agent suggested using "Mocha or Jest" for tests:

```
2. Ensure these tests use a Node.js test runner like Mocha or Jest for consistency with the plan.
```

This contradicts the system design, which specifies:
- Use Node.js built-in `node:test` module for CLI/logic tests
- Use Puppeteer for browser interaction tests
- **NO external test frameworks** (Mocha, Jest, etc.)

## Why This Matters

1. **Dependency Bloat**: External test frameworks add unnecessary dependencies
2. **Consistency**: All agents should follow the same testing approach
3. **Simplicity**: Built-in `node:test` is simpler and faster to set up
4. **Confusion**: Mixed messages lead to agents making wrong choices

## Root Cause

The REVIEW prompt template didn't explicitly state which test framework to use, so the AI made assumptions based on common industry practices (Mocha/Jest are popular).

## Solution

### 1. Updated REVIEW Template

**File**: `templates/REVIEW.md` (line 45)

Added explicit constraint:

```markdown
# Constraints
- **Be strict**: It is better to loop back now than ship bad code
- **Be specific**: Don't just say "add error handling" - specify exactly where and what
- **Be actionable**: Every issue should have a clear fix
- **Be thorough**: Check code quality, not just test results
- **Test Framework**: Tests should use Node.js built-in `node:test` module (NOT Mocha/Jest/etc) for CLI/logic tests, and Puppeteer for browser tests
```

### 2. Updated Rejection Example

**File**: `templates/REVIEW.md` (lines 72-74)

Changed from:
```markdown
3. Add test cases for: zero division, string inputs, null/undefined inputs
4. Update USER_STORIES_N.md to specify exact error types and messages expected
```

To:
```markdown
3. Create test files in `./project/tests/` using Node.js built-in `node:test` module
4. Add test cases for: zero division, string inputs, null/undefined inputs
5. Update USER_STORIES_N.md to specify exact error types and messages expected
```

### 3. Updated User's Project

Copied the updated template to the user's project:
```bash
cp templates/REVIEW.md ~/repos/test-agent-flow/test-002/prompts/REVIEW.md
```

## Verification

### Before Fix
```
REVIEW agent output:
"Ensure these tests use a Node.js test runner like Mocha or Jest"
❌ Wrong framework suggested
```

### After Fix
```
REVIEW agent should output:
"Create test files using Node.js built-in node:test module"
✅ Correct framework specified
```

## Other Prompts Already Correct

Checked other templates - they already specify the correct framework:

**`templates/GENERATE_TESTS.md` (lines 32-34)**:
```markdown
1. Write test files in `./project/tests/`
   - Use `node:test` for CLI/Logic tests
   - Use `puppeteer` for browser interaction tests
```

**`templates/PLAN_TESTS.md` (line 13)**:
```markdown
- **Tool Selection**: decide which tests should be CLI tests (Node test runner) vs Web interactions (Puppeteer).
```

Only REVIEW was missing the explicit constraint.

## Impact

- ✅ REVIEW agent will now give correct guidance about test frameworks
- ✅ Consistent messaging across all agent prompts
- ✅ No confusion about which testing tools to use
- ✅ Simpler dependency management (no external test frameworks)

## For New Projects

When users run `agent-flow init`, they get the updated templates automatically. Existing projects need to update their prompts manually or re-run init.

## Testing the Fix

To verify the fix works:

1. Answer "y" to the reflow prompt
2. The GENERATE_TESTS agent should create tests using `node:test`
3. The REVIEW agent should not mention Mocha or Jest
4. Tests should use `import test from 'node:test'` and `import assert from 'node:assert'`

Example correct test file:
```javascript
import test from 'node:test'
import assert from 'node:assert'
import { add, subtract } from '../calculator.js'

test('addition works', () => {
  assert.strictEqual(add(2, 3), 5)
})

test('division by zero throws error', () => {
  assert.throws(() => divide(1, 0), {
    name: 'Error',
    message: 'Division by zero'
  })
})
```

