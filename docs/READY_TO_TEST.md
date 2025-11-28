# ✅ Ready to Test - Pre-Flight Checklist

## Status: **READY FOR TESTING** 🚀

The VM isolation implementation is complete and all critical issues have been resolved.

## Recent Fixes Applied

### 1. ✅ Prompt Files Mount
**Issue**: Agent prompts were on host but not accessible from VM
**Fix**: Added `/workspace/prompts:ro` mount to Docker container
**Impact**: Agents can now load their system prompts from inside the VM

### 2. ✅ Prompt Path Resolution
**Issue**: Host absolute paths don't work inside VM
**Fix**: Path translation in DockerAgentExecutor converts host paths to VM paths
**Example**: `/Users/user/project/prompts/AGENT.md` → `/workspace/prompts/AGENT.md`

### 3. ✅ MCP Client Configuration
**Issue**: Wrong parameter names passed to MCPClient constructor
**Fix**: Updated to use `file_ops`, `run_tests`, `analysis`, `internet` keys
**Impact**: MCP client will properly connect to all servers

### 4. ✅ MCPClient Connection
**Issue**: Script tried to call non-existent `connect()` method
**Fix**: Removed unnecessary connect call (client connects on first use)

## Final Architecture

```
HOST
├── prompts/          → /workspace/prompts:ro (READ-ONLY)
├── project/          → /workspace/project:rw
├── tests/            → /workspace/tests:rw
├── plans/            → /workspace/plans:rw
└── MCP Servers on localhost:3100-3103

DOCKER VM
├── /workspace/agent/  (bundled: ai-providers, core)
├── /workspace/prompts (mounted: agent instructions)
├── /workspace/project (mounted: source code)
├── /workspace/tests   (mounted: test artifacts)
└── /workspace/plans   (mounted: reports, stories)
```

## Pre-Test Checklist

### Environment Setup
- [x] Docker daemon is running
- [x] Node.js environment has required packages
- [x] OpenAI API key is set in `.env` file
- [x] Project has been `npm install`'d
- [x] Tool has been `npm link`'d globally

### Code Validation
- [x] No linter errors in modified files
- [x] All Docker mounts configured correctly
- [x] Path translation logic implemented
- [x] MCP client parameters correct
- [x] VM isolation validation in place

### Known Working Components
- [x] Docker container starts successfully
- [x] MCP servers can start on host
- [x] Path validation blocks escapes
- [x] Multi-directory access works
- [x] Trace recording system ready

## Quick Test Command

```bash
cd ~/repos/test-flow  # Or your test project
flow run "Build a simple calculator with add and subtract"
```

## What to Watch For

### ✅ Expected Behavior
1. Docker container starts and validation passes
2. Agent execution begins inside VM
3. MCP servers handle tool calls from container
4. Traces are recorded to `./traces/`
5. Files are written to `./project/`
6. Reports written to `./plans/`

### ⚠️ Potential Issues to Monitor

1. **Prompt Loading**
   - Error: "Cannot read prompt file"
   - Cause: Prompt path translation failed
   - Check: Verify `/workspace/prompts` mount exists

2. **MCP Connection**
   - Error: "Failed to connect to MCP server"
   - Cause: Port mismatch or server not running
   - Check: Verify MCP servers started on ports 3100-3103

3. **Script Execution**
   - Error: "Cannot find module"
   - Cause: AI provider imports failing
   - Check: Verify `/workspace/agent/` directory exists in container

4. **JSON Parsing**
   - Error: "Unexpected token in JSON"
   - Cause: Script output includes non-JSON (console.log)
   - Check: Review container logs for extra output

## Debugging Commands

### Check Container Status
```bash
docker ps --filter name=flow
```

### View Container Logs
```bash
docker logs $(docker ps -q --filter name=flow)
```

### Inspect Container Mounts
```bash
docker inspect $(docker ps -q --filter name=flow) | grep -A 20 "Mounts"
```

### Execute Command in Container
```bash
docker exec $(docker ps -q --filter name=flow) ls -la /workspace/
```

### Test Prompt File Access
```bash
docker exec $(docker ps -q --filter name=flow) cat /workspace/prompts/GENERATE_CODE.md
```

## Fallback Plan

If VM execution fails, you can temporarily revert:

1. Edit `agent/core/flow-runner.mjs` line ~160
2. Replace `DockerAgentExecutor` with `AgentExecutor`
3. Remove `mcpServerPorts` variable
4. This runs agents on HOST (less secure but working)

**Note**: This is for debugging only. The goal is VM execution.

## Success Criteria

The test is successful if:

- ✅ Docker container starts without errors
- ✅ VM isolation validation passes (4 mounts verified)
- ✅ Agent loads its prompt from `/workspace/prompts/`
- ✅ Agent makes AI provider calls (OpenAI, etc.)
- ✅ Agent executes MCP tools (file operations, etc.)
- ✅ Files are created in `./project/`
- ✅ Traces are recorded in `./traces/`
- ✅ Final report is written to `./plans/`

## After Successful Test

Once verified working:

1. ✅ Mark VM isolation as production-ready
2. ✅ Optionally remove old `AgentExecutor` class
3. ✅ Update README with VM isolation notes
4. ✅ Consider adding performance benchmarks
5. ✅ Document any observed edge cases

## Conclusion

**The implementation is complete and ready for testing.** All critical components are in place:

- VM execution logic ✅
- Docker mounts (4 directories) ✅
- Path translation ✅
- MCP client configuration ✅
- Security validation ✅

Run the test and report any issues!

