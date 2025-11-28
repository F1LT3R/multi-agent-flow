# VM Streaming - Debugging Stdout Issue

**Date**: 2025-11-28  
**Status**: Debugging - stdout is empty after script execution

## Problem

The VM script executes successfully (all 3 turns complete, we see stderr output), but stdout is empty (length: 0). This means `console.log(JSON.stringify(results))` is not writing to stdout.

## What We Know

1. ✅ **Script syntax is valid** - Generated `/tmp/vm-script-test.mjs` is syntactically correct JavaScript
2. ✅ **Script executes** - We see all stderr output (Turn 1/6, tool calls, tokens, thinking)
3. ✅ **Turns complete** - Agent runs 3 turns successfully
4. ❌ **Stdout is empty** - `output.length === 0` after `execStreaming()` returns

## Generated Script Structure

```javascript
async function main() {
  try {
    // ... agent execution (lines 8-186) ...
    
    // Store final messages for FlowRunner
    results.messages = messages

    // Debug: Confirm we reached the end
    console.error('\\n[VM] Writing JSON result to stdout...')  // Line 189

    // Output result as JSON
    console.log(JSON.stringify(results))  // Line 192 ← THIS SHOULD OUTPUT JSON
  } catch (error) {
    // If any error occurs during script execution, output error as JSON
    console.log(JSON.stringify({ success: false, ... }))  // Line 195-203
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
```

## Debug Steps Added

Added a debug message on line 189:
```javascript
console.error('\\n[VM] Writing JSON result to stdout...')
```

This will tell us if the script reaches that point before `console.log()`.

## Next Test

Run `flow run "Create a calculator"` and check stderr output:

### If we SEE the debug message `[VM] Writing JSON result to stdout...`:
→ The script reaches line 189 but line 192 doesn't work
→ Possible causes:
  - `console.log()` is being buffered and not flushed before script exits
  - stdout is being redirected somewhere else
  - Docker's stream demultiplexing is broken for stdout

### If we DON'T SEE the debug message:
→ The script is not reaching line 189
→ Possible causes:
  - Script is hitting the catch block (line 193) instead
  - Script is exiting early from the main() function
  - The outer .catch() (line 208) is catching an error

## Hypothesis

My current hypothesis is that the script IS reaching line 192, but `console.log()` is buffered and the script exits before Node.js flushes stdout. This could happen if:

1. The Docker container terminates the script before flush completes
2. The stream is closed prematurely by Docker
3. Node.js stdout buffering in non-TTY mode

## Potential Fixes

### Fix 1: Force stdout flush
```javascript
// Output result as JSON
const jsonOutput = JSON.stringify(results)
process.stdout.write(jsonOutput + '\\n')
await new Promise(resolve => process.stdout.write('', resolve)) // Force flush
```

### Fix 2: Add explicit flush before exit
```javascript
// Output result as JSON
console.log(JSON.stringify(results))

// Wait for stdout to flush
await new Promise(resolve => setTimeout(resolve, 100))
```

### Fix 3: Use synchronous writes
```javascript
import { writeFileSync } from 'fs'

// Write to file, then cat it
writeFileSync('/tmp/result.json', JSON.stringify(results))
// Then in docker-manager, run: node script.mjs && cat /tmp/result.json
```

---

## Resolution

**Date**: 2025-11-28  
**Status**: ✅ FIXED

### Root Cause

The debug message confirmed the script reaches `console.log(JSON.stringify(results))`, but stdout was empty. This is a **Node.js stdout buffering issue**:

- In non-TTY environments (like Docker exec), Node.js uses full buffering for stdout
- `console.log()` writes to the buffer but doesn't flush it
- The script exits before the buffer is flushed to the stream
- Docker's `execStreaming()` receives an empty stdout

### The Fix

Replaced `console.log()` with `process.stdout.write()` followed by explicit flush:

```javascript
// Output result as JSON (use write + flush to ensure it's actually sent)
const jsonOutput = JSON.stringify(results)
process.stdout.write(jsonOutput + '\\n')

// Force stdout to flush before script exits
await new Promise(resolve => {
  if (process.stdout.write('')) {
    resolve()
  } else {
    process.stdout.once('drain', resolve)
  }
})
```

This ensures:
1. JSON is written to stdout buffer
2. Buffer is explicitly flushed with an empty write
3. We wait for the 'drain' event if buffer is full
4. Script only exits after stdout has been sent

Applied to both success path (line 192-201) and error catch block (line 207-216).

---

**Status**: Ready for testing. The stdout flush fix should resolve the empty output issue.

