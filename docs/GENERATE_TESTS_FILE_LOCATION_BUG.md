# GENERATE_TESTS File Location Bug

## Problem Discovered

During a successful calculator build in `~/repos/test-agent-flow/test-004`, the GENERATE_TESTS agent created source code files in the **ROOT directory** instead of only writing tests:

```
~/repos/test-agent-flow/test-004/
├── calculator.js          ← WRONG! Created by GENERATE_TESTS
└── project/
    ├── calculator.js      ← CORRECT! Created by GENERATE_CODE
    └── tests/
        └── calculator.test.js
```

## Root Cause

The GENERATE_TESTS prompt (line 39) says:

> "Adjust the SOURCE CODE if the implementation was wrong (you have permission to fix small bugs)"

But it didn't specify WHERE source code should be located. The agent:
1. Decided to "fix" the source code by rewriting it
2. Wrote it to `./calculator.js` instead of `./project/calculator.js`
3. Created an inferior version (the correct version was already in `./project/`)

## Evidence

**Trace File**: `traces/2025-11-27T00-42-21-GENERATE_TESTS-r1-t5.md` (line 106)

```json
{
  "path": "./calculator.js",  // WRONG LOCATION!
  "content": "// Calculator functions\n\nexport function add..."
}
```

**File Comparison**:
- `./calculator.js` (root) - Named exports, inline validation, simpler structure
- `./project/calculator.js` (correct) - Default export, helper function, cleaner (refactored by CLEAN_AND_REFACTOR)

The root file was an older/inferior version, suggesting the agent tried to "recreate" the source code instead of reading from `./project/`.

## Why This is Critical

1. **Wrong Location**: Files in root pollute the user's project
2. **Confusion**: Two versions of the same file with different content
3. **Loss of Improvements**: Overwrites/ignores refactored code
4. **Scope Creep**: Test agent should ONLY write tests, not rewrite source
5. **Breaks Isolation**: Source code should stay in `./project/`

## Solution

### Updated Prompt Template

**File**: `templates/GENERATE_TESTS.md`

**Added explicit file location rules** (after line 40):

```markdown
# CRITICAL: File Location Rules
- **Source code**: ALWAYS in `./project/` (e.g., `./project/calculator.js`, `./project/src/app.js`)
- **Test files**: ALWAYS in `./project/tests/` (e.g., `./project/tests/calculator.test.js`)
- **NEVER write files to the root directory** (not `./calculator.js`, not `./test.js`)
- When fixing source code bugs, modify the existing files in `./project/`, don't create new ones
```

**Clarified instruction** (line 39):

```markdown
- Adjust the SOURCE CODE **in `./project/`** if the implementation was wrong
```

### Updated User's Project

Copied the fixed template:
```bash
cp templates/GENERATE_TESTS.md ~/repos/test-agent-flow/test-004/prompts/GENERATE_TESTS.md
```

## Impact

This bug would cause:
- ✅ Tests to pass (they work against either version)
- ❌ Files in wrong locations (root pollution)
- ❌ Confusion about which file is "real"
- ❌ Potential for agents to use wrong version in future runs
- ❌ Git confusion (should root files be committed?)

## Testing the Fix

After the fix, GENERATE_TESTS should:
1. ✅ Write tests to `./project/tests/*.test.js`
2. ✅ Read source code from `./project/*.js`
3. ✅ If fixing bugs, modify files **in** `./project/`
4. ❌ Never write to root directory (`./`)

## Related Files to Check

Should verify other agent prompts don't have similar issues:

- ✅ **GENERATE_CODE.md** - Already says "implement them in `./project`"
- ✅ **CLEAN_AND_REFACTOR.md** - Need to check this one
- ✅ **REPORT.md** - Only reads, doesn't write source

## Additional Observations

The agent went through 12 turns to generate tests. This is excessive for a simple calculator. Possible reasons:
1. Test failures requiring multiple iterations
2. Agent rewriting source code multiple times
3. Confusion about file locations

The fix should reduce turn count by eliminating location confusion.

## Recommendation

Consider adding a **file path validator** in the MCP FileOpsServer that:
- Warns or rejects writes to paths that don't match expected patterns
- E.g., reject `./calculator.js`, suggest `./project/calculator.js`
- This would catch bugs at tool-call time, not just in prompts

