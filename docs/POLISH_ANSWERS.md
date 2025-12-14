# Polish & Improvements

## 1. Directory Nesting Fix ✅ DONE

**Problem**: `./project/project/calculator.js` instead of `./project/calculator.js`

**Solution**: Changed MCP File Ops Server initialization from `config.paths.project` to `process.cwd()`.

**Files Changed**:
- `agent/cli.mjs` - All 3 FileOpsServer initializations
- See `DIRECTORY_STRUCTURE_FIX.md` for details

## 2. Test/Plan Ratcheting

**Your Understanding is Correct** ✓

Tests and plans only get ratcheted when `result.success === true`, which happens when:
- Flow completes all agents successfully
- REVIEW agent approves (doesn't call `request_reflow`)
- No errors occur

**Current Flow**:
1. User stories → plans/
2. Code → project/
3. Tests → project/tests/
4. REVIEW agent evaluates
5. If approved: **Ratchet** project/tests/ → tests/ (permanent)
6. If rejected: **Reflow** (start over, tests discarded)

**Your run likely**:
- Didn't reach REVIEW agent, OR
- REVIEW rejected and would have triggered reflow, OR
- Hit an error before completion

## 3. Non-Interactive Automation

**Current Behavior**:
System asks for confirmation before reflows when `ask_before_reflow: true` in config.

**Solution Options**:

### Option A: Config Flag (Recommended)
```javascript
// In agent-flow.config.mjs
sequences: {
  development: {
    ask_before_reflow: false,  // ← Set to false
    max_flow_runs: 3,
    // ...
  }
}
```

### Option B: CLI Flag (Better for CI/CD)
```bash
flow dev "..." --auto-approve
# or
flow dev "..." --yes
```

### Option C: Environment Variable
```bash
AUTO_APPROVE=true flow dev "..."
```

**Recommended**: Implement Option B (CLI flag) + honor Option A (config).

This allows:
- CI/CD: `--auto-approve` overrides config
- Dev: Set `ask_before_reflow: false` in config
- Safety: Defaults to asking (fail-safe)

## Implementation for Option B

**Add to agent/cli.mjs**:

```javascript
program
  .command('run')
  .description('Run agent flow')
  .argument('<description>', 'Feature description')
  .option('-y, --yes', 'Auto-approve all prompts (non-interactive)')
  .option('--auto-approve', 'Alias for --yes')
  .action(async (description, options) => {
    // Set environment variable that flow-runner checks
    if (options.yes || options.autoApprove) {
      process.env.AUTO_APPROVE = 'true'
    }
    // ... rest of command
  })
```

**Update flow-runner.mjs**:

```javascript
if (this.sequence.ask_before_reflow && process.env.AUTO_APPROVE !== 'true') {
  const shouldContinue = await this._askUserToReflow()
  // ...
} else if (process.env.AUTO_APPROVE === 'true') {
  console.log('[FlowRunner] Auto-approving reflow (non-interactive mode)')
}
```

## Benefit
- `flow dev "..." --yes` for full automation
- No more waiting for confirmations
- Perfect for CI/CD pipelines

