# Docker Container Exit Fix

## Problem

The Docker container was starting successfully but exiting immediately with code 0, causing the health check to timeout:

```
[Docker] Container started: agent-flow-1764202672663
[Docker] Failed to start container: Container health check timeout after 30000ms
```

Container logs showed:
```
[Docker MCP Client] Starting...
[Docker MCP Client] Connecting to host MCP servers...
[Docker MCP Client] Connected. Found 14 tools.
[Docker MCP Client] Ready to receive commands.
(container exits)
```

## Root Cause

The `mcp-client.mjs` script was completing its execution and exiting:

```javascript
// OLD CODE:
listTools()
    .then((tools) => {
        console.log('[Docker MCP Client] Ready to receive commands.')
        // Promise completes, script exits!
    })
```

The container needs to stay alive to:
1. Pass the health check (container must be running)
2. Be available for the orchestrator to execute agent commands
3. Maintain the connection to MCP servers

## Solution

Added a keep-alive mechanism to prevent the script from exiting:

**File**: `agent/docker/mcp-client.mjs` (lines 85-109)

```javascript
// NEW CODE:
listTools()
    .then((tools) => {
        console.log('[Docker MCP Client] Ready to receive commands.')
        
        // Keep the process alive indefinitely
        // The container will be stopped explicitly by the orchestrator
        setInterval(() => {
            // Heartbeat every 30 seconds to keep container alive
        }, 30000)
    })
    .catch((error) => {
        console.error('[Docker MCP Client] Failed to connect:', error.message)
        process.exit(1)
    })

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[Docker MCP Client] Received SIGTERM, shutting down...')
    process.exit(0)
})

process.on('SIGINT', () => {
    console.log('[Docker MCP Client] Received SIGINT, shutting down...')
    process.exit(0)
})
```

## Changes Made

1. **Keep-Alive Timer**: Added `setInterval()` to keep the Node.js event loop active
2. **Signal Handlers**: Added SIGTERM and SIGINT handlers for graceful shutdown
3. **Rebuilt Image**: Rebuilt the Docker image to include the fixed script

## How It Works

### Before Fix
```
Container starts → MCP client connects → Promise resolves → Script exits → Container exits (code 0)
```

### After Fix
```
Container starts → MCP client connects → Promise resolves → setInterval keeps process alive → Container stays running
```

The container now:
- ✅ Stays running indefinitely
- ✅ Passes health checks (container is running)
- ✅ Responds to shutdown signals (SIGTERM/SIGINT)
- ✅ Can be stopped cleanly by the orchestrator

## Rebuilding the Image

After making changes to `agent/docker/mcp-client.mjs`, rebuild:

```bash
cd /Users/user/repos/multi-agent-flow
docker build --build-arg UID=$(id -u) --build-arg GID=$(id -g) -t multi-agent-flow-agent agent/docker/
```

## Testing

### Before Fix
```bash
agent-flow run "task"
# [Docker] Container started: agent-flow-xxx
# [Docker] Failed to start container: Container health check timeout after 30000ms

docker ps -a | grep agent-flow
# Shows: Exited (0) 50 seconds ago
```

### After Fix
```bash
agent-flow run "task"
# [Docker] Container started: agent-flow-xxx
# [Docker] Container is running (no health check)
# Flow proceeds normally...

docker ps | grep agent-flow
# Shows: Up X seconds (container is running)
```

## Alternative Solutions Considered

1. **Use `tail -f /dev/null`**: Shell command to keep container alive
   - ❌ Rejected: Requires changing CMD to shell, loses Node.js process

2. **HTTP Server**: Run a simple HTTP server in the container
   - ❌ Rejected: Unnecessary complexity, we don't need HTTP endpoints

3. **stdin.resume()**: Keep stdin open to prevent exit
   - ❌ Rejected: Less reliable than setInterval, doesn't work in all environments

4. **process.stdin.on('data')**: Listen for input
   - ❌ Rejected: Requires stdin to be connected, not always available

## Current Solution Benefits

✅ **Simple**: Just a setInterval with empty callback
✅ **Reliable**: Event loop stays active indefinitely
✅ **Clean**: Responds to shutdown signals properly
✅ **Minimal**: No extra dependencies or complexity
✅ **Standard**: Common Node.js pattern for keep-alive

## Notes

- The 30-second interval is arbitrary (could be any value)
- The callback is empty because we only need to keep the event loop active
- The orchestrator explicitly stops the container when done
- Signal handlers ensure graceful shutdown when container is stopped

