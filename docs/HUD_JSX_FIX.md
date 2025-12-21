# HUD JSX to React.createElement Fix

## Issue

The HUD feature failed on first run with:

```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".jsx" for /Users/user/repos/multi-agent-flow/agent/core/hud-component.jsx
```

## Root Cause

Node.js doesn't natively support `.jsx` files in ES module contexts. While JSX is great for readability, it requires transpilation which wasn't set up in this project.

## Solution

Converted the HUD component from JSX syntax to `React.createElement()` calls:

1. **Renamed file**: `hud-component.jsx` → `hud-component.mjs`
2. **Converted JSX to React.createElement**: Replaced all JSX tags with explicit `React.createElement()` calls
3. **Updated import**: Changed import in `hud-manager.mjs` from `.jsx` to `.mjs`

## Example Transformation

**Before (JSX):**
```javascript
return (
  <Box flexDirection="column" borderStyle="round">
    <Text bold color="cyan">AGENT FLOW</Text>
    {state.agents?.map((agent, idx) => (
      <Box key={idx} flexDirection="row">
        <Text color={getStatusColor(agent.status)}>
          {getStatusIcon(agent.status)} {agent.displayName}
        </Text>
      </Box>
    ))}
  </Box>
)
```

**After (React.createElement):**
```javascript
return React.createElement(
  Box,
  { flexDirection: "column", borderStyle: "round" },
  React.createElement(Text, { bold: true, color: "cyan" }, "AGENT FLOW"),
  ...(state.agents?.map((agent, idx) =>
    React.createElement(
      Box,
      { key: idx, flexDirection: "row" },
      React.createElement(
        Text,
        { color: getStatusColor(agent.status) },
        `${getStatusIcon(agent.status)} ${agent.displayName}`
      )
    )
  ) || [])
)
```

## Benefits of This Approach

1. **No transpilation needed** - Works natively with Node.js ESM
2. **No additional dependencies** - Doesn't require esbuild, swc, or other transpilers
3. **Same functionality** - Ink components work identically with `React.createElement`
4. **Better compatibility** - Aligns with the project's ESM-only architecture

## Files Changed

- `agent/core/hud-component.jsx` → `agent/core/hud-component.mjs` (converted JSX)
- `agent/core/hud-manager.mjs` (updated import path)
- `docs/HUD_IMPLEMENTATION_COMPLETE.md` (updated documentation)
- `docs/HUD_FEATURE.md` (updated documentation)

## Testing

All tests pass:
```bash
$ node agent/tests/hud-test.mjs
✅ All StreamBuffer tests passed!
✅ All HUDManager tests passed!
🎉 All tests completed successfully!
```

## Status

✅ **Fixed and verified** - The HUD feature now works correctly with Node.js ESM.
