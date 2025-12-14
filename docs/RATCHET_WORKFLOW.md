# Ratchet Workflow

The ratchet system manages test artifacts across flow runs, ensuring only approved changes get persisted.

## Test File Strategy

Write **one test file per operation/behavior**, not one per function.

### Correct (per operation)

```
add-positive-numbers.test.mjs     # Just: add(2, 3) === 5
add-negative-numbers.test.mjs     # Just: add(-1, -2) === -3
add-with-zero.test.mjs            # Just: add(0, 5) === 5
login-success.test.mjs            # Just: login with valid credentials
login-invalid-password.test.mjs   # Just: login with wrong password
```

### Avoid (per function)

```
add.test.mjs       # Contains ALL add tests (harder to ratchet individually)
login.test.mjs     # Contains ALL login tests
```

### Why Per-Operation?

1. **Atomic ratcheting** - Accept or reject individual behaviors
2. **Minimal agent context** - Agent only sees 5-15 lines per file
3. **Easier approval** - Review small, focused diffs
4. **Maps to user stories** - Each test = one acceptance criterion

## Ratchet Lifecycle

### Pre-Run (before Docker starts)

1. Clean orphaned `.new.test.*` files (from abandoned runs)
2. Copy `.flow/ratchet/tests/` → project root as **read-only** (chmod 444)
3. Read stories for orchestrator injection

### During Run

- Agent sees read-only test files
- To modify a test, agent creates `{name}.new.test.mjs`
- Both files exist side-by-side

### Post-Run Success

**Approval dialog appears for each `.new.test.*` file:**

```
═══════════════════════════════════════════════════════════════
  Test changes require approval (3 files)
═══════════════════════════════════════════════════════════════

[1/3] add-negative-numbers.test.mjs

--- (new file)
+++ add-negative-numbers.new.test.mjs
+import { add } from './calculator.js'
+import { test } from 'node:test'
+import assert from 'node:assert'
+
+test('add handles negative numbers', () => {
+  assert.strictEqual(add(-1, -2), -3)
+})

[A]ccept  [R]eject  [S]kip  [a]ccept-all  [q]uit: _
```

### Approval Options

| Key | Action | Result |
|-----|--------|--------|
| `A` | Accept | Promote `.new.test.mjs` → `.test.mjs`, ratchet it |
| `R` | Reject | Delete the `.new.test.mjs` file |
| `S` | Skip | Keep both files, don't ratchet (decide later) |
| `a` | Accept All | Accept this and all remaining without prompts |
| `q` | Quit | Skip all remaining files |

### Post-Run Failure

- All `.new.test.*` files preserved
- Agent can iterate on fixes in reflow
- Nothing gets ratcheted

## File Locations

| Path | Purpose |
|------|---------|
| `.flow/ratchet/tests/` | Blessed test files (persisted across runs) |
| `.flow/ratchet/stories/` | User stories (injected into agents) |
| `.flow/ratchet/reports/` | Generated reports |
| `*.test.mjs` (project root) | Staged tests (read-only during run) |
| `*.new.test.mjs` (project root) | Agent modifications (pending approval) |

## Example Workflow

```
# Run 1: Agent creates calculator tests
flow dev "Build a calculator"

# Agent creates:
#   add-basic.new.test.mjs
#   subtract-basic.new.test.mjs

# Approval:
#   [A] add-basic.new.test.mjs → approved, ratcheted
#   [A] subtract-basic.new.test.mjs → approved, ratcheted

# Run 2: Agent adds edge case tests
flow dev "Add negative number handling"

# Agent creates:
#   add-negative-numbers.new.test.mjs

# Approval:
#   [A] add-negative-numbers.new.test.mjs → approved, ratcheted

# Now .flow/ratchet/tests/ contains:
#   add-basic.test.mjs
#   subtract-basic.test.mjs
#   add-negative-numbers.test.mjs
```

