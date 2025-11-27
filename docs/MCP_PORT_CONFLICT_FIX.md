# MCP Port Conflict Fix

## Problem

When `agent-flow run` was interrupted or crashed, the MCP servers (running on ports 3100-3103) would remain running in the background. The next run would fail with:

```
Error: listen EADDRINUSE: address already in use :::3100
```

This happened because:
1. MCP servers start on fixed ports (3100-3103)
2. If the process crashes or is killed with Ctrl+C, servers may not shut down cleanly
3. The next run tries to start new servers on the same ports → conflict

## Solution

### 1. Better Error Handling in CLI

**File**: `agent/cli.mjs` (lines 191-223)

Added try-catch around MCP server startup:

```javascript
try {
    const fileOpsServer = new FileOpsServer(3100, process.cwd())
    await fileOpsServer.start()
    // ... other servers ...
} catch (error) {
    if (error.code === 'EADDRINUSE') {
        console.error('❌ ERROR: MCP server ports are already in use')
        console.error('This usually means a previous run did not shut down cleanly.')
        console.error('To fix this, run:')
        console.error('  lsof -ti:3100,3101,3102,3103 | xargs kill -9')
        process.exit(1)
    }
    throw error
}
```

**Benefits**:
- Clear error message explaining what happened
- Provides exact command to fix the issue
- Exits gracefully instead of crashing with stack trace

### 2. New Cleanup Command

**File**: `agent/cli.mjs` (lines 449-481)

Added `agent-flow cleanup` command:

```javascript
program
    .command('cleanup')
    .description('Kill any stuck MCP server processes')
    .action(async () => {
        // Finds and kills processes on ports 3100-3103
        await execAsync('lsof -ti:3100,3101,3102,3103 | xargs kill -9')
    })
```

**Usage**:
```bash
agent-flow cleanup
```

**Benefits**:
- One simple command to fix the issue
- No need to remember port numbers or kill commands
- Works cross-platform (uses lsof which is available on macOS/Linux)

### 3. Updated Documentation

**File**: `QUICKSTART.md`

Added troubleshooting section:

```markdown
## Troubleshooting

**If you get "address already in use" errors:**

```bash
# Clean up stuck MCP servers
agent-flow cleanup
```
```

## Testing

### Before Fix
```bash
# Run 1
agent-flow run "task"
# Press Ctrl+C to interrupt

# Run 2
agent-flow run "task"
# Error: EADDRINUSE :::3100 (cryptic stack trace)
```

### After Fix
```bash
# Run 1
agent-flow run "task"
# Press Ctrl+C to interrupt

# Run 2
agent-flow run "task"
# ❌ ERROR: MCP server ports are already in use
# (Clear message with fix instructions)

# Run cleanup
agent-flow cleanup
# ✓ Killed processes on ports 3100-3103

# Run 3
agent-flow run "task"
# Works! ✓
```

## Alternative Solutions Considered

1. **Random Ports**: Use random available ports instead of fixed ones
   - ❌ Rejected: Harder to debug, need port discovery mechanism
   
2. **Auto-cleanup on Start**: Kill existing processes automatically
   - ❌ Rejected: Could kill legitimate processes, too aggressive
   
3. **PID Files**: Track server PIDs and clean them up
   - ❌ Rejected: More complex, PID files can become stale
   
4. **Port Reuse**: Use SO_REUSEADDR socket option
   - ❌ Rejected: Can cause race conditions, not a clean solution

## Current Solution Benefits

✅ **Simple**: One command to fix
✅ **Safe**: User explicitly runs cleanup
✅ **Clear**: Error messages explain what to do
✅ **Fast**: Immediate fix, no waiting
✅ **Documented**: Instructions in error message and docs

## Future Improvements

Potential enhancements:
- Add signal handlers to ensure clean shutdown on Ctrl+C
- Add `--force` flag to `agent-flow run` to auto-cleanup before starting
- Monitor server health and auto-restart if needed
- Use Unix domain sockets instead of TCP ports (eliminates port conflicts)

