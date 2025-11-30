# Flow Architecture

This document explains the flow system's directory structure and how files are organized.

> **Note**: This system targets Linux-like systems only (Linux, macOS). Windows is not supported.

## Directory Structure

When you run `flow init`, the following structure is created:

```
my-project/                 # Your project root (where you run flow init)
├── .flow/                  # All flow-related files
│   ├── flow.config.mjs     # Configuration file
│   ├── prompts/            # Agent prompt templates
│   │   ├── WRITE_USER_STORIES.md
│   │   ├── GENERATE_CODE.md
│   │   ├── PLAN_TESTS.md
│   │   ├── GENERATE_TESTS.md
│   │   ├── REVIEW.md
│   │   ├── CLEAN_AND_REFACTOR.md
│   │   └── REPORT.md
│   ├── checkpoints/        # Operational state for resuming runs
│   ├── traces/             # Execution logs (disposable)
│   ├── snapshots/          # Versioned project rollback points
│   │   └── {timestamp}/    # Each snapshot mirrors project structure
│   └── ratchet/            # "Blessed" artifacts from successful runs
│       ├── stories/        # User stories
│       ├── reports/        # Run reports
│       └── tests/          # Ratcheted test files
│
├── calculator.js           # Your source code
├── calculator.test.mjs     # Tests alongside code
└── package.json            # Your project dependencies
```

## Key Concepts

### The `.flow/` Directory

All flow-related files live in `.flow/`. This keeps your project root clean and makes flow artifacts easily identifiable. The `.flow/` directory is created wherever you run `flow init`.

### Ratcheting

"Ratcheting" is the process of promoting outputs from a successful run to a permanent, versioned state:

- **Tests**: Successful test files are copied from your project to `.flow/ratchet/tests/`
- **Stories**: User stories are stored in `.flow/ratchet/stories/`
- **Reports**: Run reports are archived in `.flow/ratchet/reports/`

At the start of each run, ratcheted tests are copied back into your project as **read-only**. If you need to modify a ratcheted test, create a `.new.test.mjs` file instead.

### Snapshots

Snapshots are versioned copies of your project for rollback. Each snapshot includes:

- Your source code (mirroring project structure)
- `.flow/flow.config.mjs`
- `.flow/prompts/`
- `.flow/ratchet/`

Snapshots exclude:
- `.flow/checkpoints/` (operational state)
- `.flow/traces/` (disposable logs)
- `.flow/snapshots/` (no nesting)
- `node_modules/`, `.git/`

### Checkpoints

Checkpoints store operational state for resuming interrupted runs:

- Flow sequence position
- Agent results
- Message histories

Checkpoints are **not** included in snapshots - they're purely for run recovery.

### Traces

Traces are detailed execution logs for debugging:

- API calls
- Tool usage
- Costs

Traces are **disposable** and not included in snapshots.

## Order of Operations

When you run `flow run "your task"`:

1. **Config Loading** - `.flow/flow.config.mjs` is loaded
2. **Ratchet Preparation** - Ratcheted tests are copied to project root (read-only)
3. **Docker Container Start** - Container is created with your project mounted at `/project`
4. **Agent Loop** - For each agent in the flow:
   - Agent executes in the VM
   - Stories/reports are injected into agent context
   - Agent output is captured
5. **Ratchet Finalization** - On success, new tests/stories/reports are copied to ratchet
6. **Snapshot Creation** - On success, a snapshot is created
7. **Container Cleanup** - On success, container is stopped. On failure, container is preserved.

## Protected Directories

Agents **cannot** access these paths:

| Path | Reason |
|------|--------|
| `.flow/` | Internal state, config, prompts |
| `prompts/` | Read-only templates |

Any attempt to read, write, list, or delete files in these directories will be blocked.

## File Operations in the VM

Inside the Docker VM, your project is mounted at `/project`. All file operations are relative to this mount:

```javascript
// These paths all work in the VM:
write_file('calculator.js', ...)        // → /project/calculator.js
write_file('src/app.js', ...)           // → /project/src/app.js
write_file('lib/utils.js', ...)         // → /project/lib/utils.js
```

## Tests Alongside Code

Tests are written alongside source code, not in a separate directory:

| Source | Test |
|--------|------|
| `./calculator.js` | `./calculator.test.mjs` |
| `./src/app.js` | `./src/app.test.mjs` |
| `./lib/utils.js` | `./lib/utils.test.mjs` |

This convention:
- Makes it easy to find tests for a given module
- Ensures import paths work naturally
- Simplifies the test discovery process

## Modifying Ratcheted Tests

Ratcheted tests are copied as read-only at the start of each run. If you need to change a ratcheted test:

1. Create a new file with `.new.test.mjs` suffix
2. Example: To change `./calc.test.mjs`, create `./calc.new.test.mjs`
3. The `.new.test.mjs` file is reviewed and promoted on success

### `.new.test.mjs` Lifecycle

- **On reflow** (retry): Kept for agent to see previous attempts
- **On success**: Promoted (replaces original, then deleted)
- **On new run**: Orphaned `.new.test.mjs` files are cleaned up

## For Developers

### Key Files

| File | Purpose |
|------|---------|
| `agent/core/cli.mjs` | Creates directory structure on `flow init` |
| `agent/core/config-loader.mjs` | Loads `.flow/flow.config.mjs` |
| `agent/core/flow-runner.mjs` | Orchestrates agent execution |
| `agent/core/ratchet.mjs` | Manages test/story/report ratcheting |
| `agent/core/snapshot-manager.mjs` | Creates/restores snapshots |
| `agent/vm-tools/file-operations.mjs` | Enforces file access rules |

### Security Enforcement

Path validation in `file-operations.mjs`:

- Blocks access to `.flow/`
- Blocks access to `prompts/`
- Prevents path traversal (`../`)
- Blocks absolute paths
- Detects writes to read-only ratcheted tests

