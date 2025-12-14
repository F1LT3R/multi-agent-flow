# Prompt Templating System

Multi-agent-flow supports a simple templating system for sharing common instructions across agent prompts.

## How It Works

Place shared instruction files in `templates/common/`:

```
templates/
├── common/
│   └── SHARED.md        # Shared by all agents
├── GENERATE_CODE.md
├── GENERATE_TESTS.md
└── ...
```

Use `{{NAME}}` placeholders in any agent prompt to inject content:

```markdown
# Role
You generate code.

{{SHARED}}

# Instructions
...
```

When the agent runs, `{{SHARED}}` is replaced with the contents of `templates/common/SHARED.md`.

## Placeholder Types

### File-Based Placeholders

Most placeholders load content from files in `templates/common/`:

```
{{SHARED}}  →  loads templates/common/SHARED.md
{{SAFETY}}  →  loads templates/common/SAFETY.md
{{FORMAT}}  →  loads templates/common/FORMAT.md
```

### Reserved Dynamic Placeholders

`{{INTENT}}` is a special reserved placeholder that is injected dynamically at runtime.

It contains the original user request from the `flow dev "intent"` command.

**Example:** If the user runs:
```bash
flow dev "Build a calculator with add and subtract"
```

Then `{{INTENT}}` will be replaced with:
```
Build a calculator with add and subtract
```

This ensures all agents have context of the original human request, not just the accumulated context from previous agents.

## Lifecycle

1. `flow init` copies `templates/` to `.flow/prompts/` (including `common/`)
2. `flow dev` validates all placeholders resolve before agents start
3. Each agent prompt is resolved at runtime (edits take effect immediately)

## Error Handling

If a placeholder references a missing file, the run fails immediately with:

```
Template validation failed:
GENERATE_CODE: placeholder {{MISSING}} requires missing file: common/MISSING.md
```

This happens BEFORE any agents execute, so you can fix errors without wasting API calls.

Note: `{{INTENT}}` is always valid (it's dynamic, not file-based).

## Creating Custom Shared Templates

Add any `.md` file to `templates/common/` and reference it with `{{FILENAME}}`:

```
templates/common/SAFETY.md → {{SAFETY}}
templates/common/FORMAT.md → {{FORMAT}}
```

Then add the placeholder to any agent prompt where you want the content injected.

## Default: SHARED.md

The default `SHARED.md` contains universal rules all agents should follow:

```markdown
## Universal Rules

1. Your FIRST action must be `list_directory('.')` to see the project structure
2. Check what files exist before creating new ones
3. Do NOT duplicate or overwrite work from previous agents

## Original Request

{{INTENT}}
```

This ensures every agent:
- Starts by understanding the project structure
- Avoids creating duplicate files
- Knows the original user request

