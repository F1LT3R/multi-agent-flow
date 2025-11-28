# Restructure Summary

## Changes Completed

The project has been restructured to separate the orchestrator (npm package) from user projects, making it ready for global installation.

### ✅ What Changed

1. **Moved Orchestrator Tests**
   - `./tests/integration.test.mjs` → `./agent/tests/integration.test.mjs`
   - Updated imports to use relative paths from new location
   - `package.json` test script updated to `agent/tests/*.test.mjs`

2. **Renamed Prompts to Templates**
   - `./prompts/` → `./templates/`
   - These are now the **default templates** in the npm package
   - Users get their own `./prompts/` directory via `agent-flow init`

3. **Updated CLI Init Command**
   - Now copies templates from package to user's `./prompts/`
   - Detects if running from repo or installed globally
   - Handles existing prompts gracefully
   - Added step 3 in instructions: "Customize prompts in ./prompts/ (optional)"

4. **Updated Config Loader**
   - Clarified that `prompt_file` paths point to user's `./prompts/`
   - Not to the package's `./templates/`
   - Proper path resolution for both dev and global install

5. **Updated Package.json**
   - Added `preferGlobal: true`
   - Added `files` field to include only what should be published:
     - `agent/**/*` - orchestrator code
     - `templates/**/*` - default prompts
     - `.env.example` - environment template
   - Test script updated

6. **Updated .gitignore & .npmignore**
   - `.gitignore`: Added comments about user project directories
   - `.npmignore`: Explicitly exclude user dirs, include templates

7. **Updated Documentation**
   - **README.md**: 
     - Added "Global Installation" section
     - Clarified package vs project structure
     - Updated Quick Start with project creation step
     - Enhanced directory structure diagrams
   - **GETTING_STARTED.md**:
     - Updated for global installation workflow
     - Removed manual template copying instructions
     - Clarified prompt customization

## New Structure

### NPM Package (installed globally)
```
multi-agent-flow/
├── agent/                    # Orchestrator (hidden from users)
│   ├── cli.mjs
│   ├── core/
│   ├── mcp-servers/
│   ├── ai-providers/
│   ├── docker/
│   └── tests/               # ← Orchestrator tests
│       └── integration.test.mjs
├── templates/               # ← Default prompt templates
│   ├── WRITE_USER_STORIES.md
│   ├── GENERATE_CODE.md
│   └── ... (7 prompts)
├── package.json
└── README.md
```

### User Project (after `agent-flow init`)
```
my-app/
├── agent-flow.config.mjs    # User's config
├── .agent-flow/             # Runtime (gitignored)
│   ├── logs/
│   └── checkpoints/
├── project/                 # Agent workspace
│   ├── src/
│   └── tests/               # Volatile tests
├── prompts/                 # User's custom prompts (from templates)
├── plans/                   # Requirements
└── tests/                   # Ratcheted tests (permanent)
    └── artifacts/
```

## Benefits

1. **Clear Separation**: Tool code vs user code
2. **Global Installation**: Works from any directory
3. **Customization**: Users modify their prompts, not the tool's templates
4. **Updates**: User can update CLI without losing customizations
5. **Professional**: Matches standard npm global tool patterns

## Testing the Installation

To test global installation locally:

```bash
# From the repo root
npm pack

# This creates: multi-agent-flow-0.1.0.tgz

# Install globally
npm install -g ./multi-agent-flow-0.1.0.tgz

# Test in a clean directory
mkdir test-project
cd test-project
agent-flow init

# Verify structure
ls -la
# Should see: agent-flow.config.mjs, project/, tests/, plans/, prompts/

# Check templates were copied
ls prompts/
# Should see: WRITE_USER_STORIES.md, GENERATE_CODE.md, etc.
```

## Validation Checklist

- [x] Orchestrator tests moved to `agent/tests/`
- [x] Prompts renamed to `templates/`
- [x] CLI init copies templates to user's `prompts/`
- [x] Config loader uses correct paths
- [x] Package.json configured for global install
- [x] Documentation updated
- [ ] Test global installation (requires npm pack & install)
- [ ] Verify init creates correct structure
- [ ] Confirm template copying works
- [ ] Ensure tests pass after restructure

## Next Steps

1. Run `npm test` to verify orchestrator tests work
2. Run `npm pack` to create tarball
3. Test global installation in clean directory
4. Publish to npm (when ready)

## Breaking Changes

None for end users, as this is pre-release. However:

- Developers working on the tool need to know tests moved to `agent/tests/`
- Default prompts are now in `templates/`, not `prompts/`

