# Directory Structure Fix

## Problem
Files were being created at `./project/project/calculator.js` instead of `./project/calculator.js`.

## Root Cause
- MCP File Ops Server was initialized with `projectRoot = './project'`
- Agent prompts told agents to write to `./project/file.js`
- Result: `projectRoot + './project/file.js'` = `./project/project/file.js`

## Solution

###  Fix 1: MCP Server Root
Changed `FileOpsServer` initialization from:
```javascript
new FileOpsServer(3100, config.paths.project)  // './project'
```

To:
```javascript
new FileOpsServer(3100, process.cwd())  // current directory
```

### Fix 2: Agent Prompts (NO CHANGE NEEDED)
Prompts already correctly tell agents to write to `./project/`:
- ✓ "implement them in `./project/`"
- ✓ "write files in `./project/tests/`"
- ✓ "read code in `./project`"

Now paths resolve correctly:
- Agent writes to: `./project/calculator.js`
- MCP resolves to: `process.cwd() + './project/calculator.js'` 
- Final path: `./project/calculator.js` ✓

## Impact
- ✓ No more nested `./project/project/` directories
- ✓ Clean output structure
- ✓ Prompts remain clear and intuitive

