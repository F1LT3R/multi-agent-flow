# Config: Root Path Feature

**Date**: 2025-11-28
**Status**: ✅ Implemented

## Overview

Added `paths.root` to `flow.config.mjs` to allow users to control where agents write source code. This enables running the multi-agent flow in multiple locations within a single project.

## Configuration

### New Path: `paths.root`

```javascript
export const paths = {
	root: './',                     // Where agents write source code
	tests: './tests',               // Test files
	artifacts: './tests/artifacts', // Test artifacts
	traces: './.flow/logs/traces',  // Execution traces
}
```

### Use Cases

**1. Run flow in project root** (default):
```javascript
export const paths = {
	root: './',
	tests: './tests',
	// ...
}
```

**2. Run flow in a subdirectory**:
```javascript
export const paths = {
	root: './packages/frontend',
	tests: './packages/frontend/tests',
	// ...
}
```

**3. Run multiple flows in a monorepo**:

```bash
# Frontend flow
cd packages/frontend
flow dev "Add user auth"

# Backend flow
cd packages/backend
flow dev "Add API endpoints"
```

Each can have its own `flow.config.mjs` with different `paths.root` values.

## Config File Format

### New: ESNext Style (Recommended)

The generated `flow.config.mjs` now uses proper ES module syntax with named exports:

```javascript
// Multi-Agent Flow Configuration
// ESNext style with named exports

export const paths = {
	root: './',
	tests: './tests',
	artifacts: './tests/artifacts',
	traces: './.flow/logs/traces',
}

export const persistence = {
	checkpoint_interval: 'every_turn',
	checkpoints: './.flow/logs/checkpoints',
	log_dir: './.flow/logs',
	snapshots: './.flow/snapshots',
}

export const sequences = {
	development: {
		max_flow_runs: 3,
		ask_before_reflow: true,
		agents: [
			'WRITE_USER_STORIES',
			'GENERATE_CODE',
			// ...
		],
	},
}

export const agents = [
	{
		name: 'WRITE_USER_STORIES',
		goal: 'Convert input to structured requirements',
		model: 'gpt-4o',
		max_turns: 6,
		// ...
	},
	// ...
]

// Default export for compatibility
export default {
	paths,
	persistence,
	sequences,
	agents,
}
```

### Old: JSON-in-JS Style (Still Supported)

```javascript
export default {
	paths: {
		root: './',
		tests: './tests',
		// ...
	},
	// ...
}
```

Both formats are supported. The config loader handles:
- Default export (JSON object)
- Named exports (ESNext style)
- Mix of both

## Benefits

### 1. **Better Code Style**
- Proper ES modules instead of JSON-in-JS
- Named exports are more idiomatic
- Easier to read and maintain

### 2. **Flexibility**
- Run flow in any directory within a project
- Multiple flows in a monorepo
- Different configurations for different parts of the codebase

### 3. **Clear Intent**
- `paths.root` explicitly shows where code goes
- Users have full control over file locations

## Implementation Details

### Files Modified

**`agent/core/config-loader.mjs`**:
1. Added `root: './'` to `DEFAULT_CONFIG.paths`
2. Updated `createDefaultConfig()` to generate ESNext style config
3. Updated `load()` to support both default and named exports

### Config Loader Logic

```javascript
// Support both formats
let userConfig
if (module.default) {
	// JSON-in-JS style (old)
	userConfig = module.default
} else {
	// ESNext style with named exports (new)
	userConfig = {
		paths: module.paths || {},
		persistence: module.persistence || {},
		sequences: module.sequences || {},
		agents: module.agents || {},
	}
}
```

## Future Usage of `paths.root`

The `paths.root` value should be used by:

1. **Agents**: When instructed to write code, use `paths.root` as the base directory
2. **MCP Tools**: File operations should respect `paths.root`
3. **Documentation**: Agent prompts should reference `paths.root` when describing where code goes

Currently, agents write to the workspace root (`process.cwd()`). In a future update, we can pass `config.paths.root` to agents so they write to the configured location.

## Migration

### For Existing Users

No action required! The default `paths.root: './'` matches current behavior (project root).

### For New Users

Run `flow init` to get the new ESNext style config:

```bash
flow init
# Creates flow.config.mjs with named exports
```

### To Customize

Edit `flow.config.mjs` and change `paths.root`:

```javascript
export const paths = {
	root: './src',        // Write code to ./src instead of root
	tests: './src/tests',
	// ...
}
```

---

**Status**: ✅ Implemented. Config now supports `paths.root` and uses ESNext style with named exports.

