# Getting Started with Multi-Agent Flow

## Step-by-Step Setup Guide

### 1. Install the CLI Tool

Install globally via npm:

```bash
npm install -g multi-agent-flow
```

Or for local development:

```bash
git clone <repo-url>
cd multi-agent-flow
npm install
npm link
```

### 2. Create a New Project

```bash
mkdir my-app
cd my-app
flow init
```

This creates the project structure and copies prompt templates to `./prompts/`.

### 3. Configure Environment

Set your API key (add to `~/.zshrc` or `~/.bashrc` for persistence):

```bash
export OPENAI_API_KEY=sk-your-actual-api-key-here
```

Other supported providers:
```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Anthropic (Claude)
export GOOGLE_AI_API_KEY=...          # Google (Gemini)
export XAI_API_KEY=...                # xAI (Grok)
export DEEPSEEK_API_KEY=...           # DeepSeek
```

### 3. Make CLI Available Globally (Optional)

```bash
npm link
```

Or run directly with:
```bash
node agent/cli.mjs
```

### 4. Initialize a Project

Create a new directory for your project and initialize:

```bash
mkdir my-new-project
cd my-new-project
flow init
```

This creates:
- `.flow/flow.config.mjs` - Configuration file
- `.flow/prompts/` - Agent instruction templates
- `.flow/checkpoints/` - Resume state
- `.flow/snapshots/` - Rollback points
- `.flow/traces/` - Execution logs
- `.flow/ratchet/` - Blessed artifacts (stories, reports, tests)

### 5. Customize Prompts (Optional)

The `.flow/prompts/` directory contains instruction files for each agent, copied from the package templates. You can customize these to change agent behavior:

```bash
# Edit any prompt file
vim .flow/prompts/GENERATE_CODE.md
```

Your customizations are preserved when you update the tool.

### 6. Run Your First Flow

```bash
flow dev "Create a simple calculator CLI that can add, subtract, multiply, and divide"
```

This will:
1. Start MCP servers
2. Execute the agent sequence
3. Generate user stories
4. Write code
5. Create and run tests
6. Review the implementation
7. Refactor and clean
8. Generate a report

### 7. Review the Results

Check what was generated:

```bash
# View the user stories
cat .flow/ratchet/stories/USER_STORIES.md

# View the generated code
ls -la ./

# View the tests
ls -la .flow/ratchet/tests/

# View logs
ls -la .flow/traces/
```

## Advanced Usage

### Resume from Checkpoint

If a flow fails or is interrupted:

```bash
# List available checkpoints
flow list

# Resume from specific checkpoint
flow resume run-2024-11-26-...

# Or resume from latest
flow resume
```

### Run Single Agent for Debugging

```bash
flow mode GENERATE_CODE "Create a User class with email validation"
```

### Customize Configuration

Edit `.flow/flow.config.mjs`:

```javascript
export default {
  sequences: {
    development: {
      max_flow_runs: 5,  // Allow more reflows
      ask_before_reflow: false,  // Auto-reflow without asking
      agents: [
        'WRITE_USER_STORIES',
        'GENERATE_CODE',
        'GENERATE_TESTS',  // Skip PLAN_TESTS for speed
        'REVIEW',
        'CLEAN_AND_REFACTOR',
        'REPORT'
      ]
    }
  },
  agents: [
    {
      name: 'GENERATE_CODE',
      model: 'gpt-4o',  // Use more powerful model
      max_turns: 15,  // Give it more attempts
      // ... rest of config
    }
  ]
}
```

### Change Models

Edit the `model` field for any agent:

```javascript
{
  name: 'WRITE_USER_STORIES',
  model: 'gpt-4o',  // Use GPT-4o instead of default
  // ...
}
```

Currently supported:
- `gpt-4o` - OpenAI GPT-4 Optimized
- `gpt-4o-mini` - OpenAI GPT-4 Mini (cost-effective)
- `gpt-4-turbo` - OpenAI GPT-4 Turbo
- `o1-preview` - OpenAI O1 Preview (reasoning model)
- `o1-mini` - OpenAI O1 Mini

Coming soon: Anthropic Claude, Google Gemini, xAI Grok

## Example Projects

### Simple Todo CLI

```bash
flow dev "Build a todo list CLI app. Users can add, list, complete, and delete todos. Store in a JSON file."
```

### REST API

```bash
flow dev "Create a REST API for a blog. Endpoints: GET /posts, GET /posts/:id, POST /posts, PUT /posts/:id, DELETE /posts/:id. Use Express and store in memory."
```

### Data Processor

```bash
flow dev "Create a CSV to JSON converter. Read CSV file, parse it, and output formatted JSON. Handle errors gracefully."
```

## Troubleshooting

### Tests Fail During Flow

The `GENERATE_TESTS` agent will try to fix failing tests automatically (up to MAX_TURNS). If it can't:
- Check `.flow/traces/` for details
- Review the generated code
- Run `flow test "Fix the failing tests"` to try again

### Review Agent Rejects Implementation

This is normal! The system will:
1. Ask if you want to reflow (if `ask_before_reflow: true`)
2. Start over with WRITE_USER_STORIES
3. Preserve context from previous attempt

You can:
- Answer 'y' to try again with better requirements
- Answer 'n' to stop and review manually
- Increase `max_flow_runs` in config for more attempts

### Out of Tokens / Rate Limited

- Use `gpt-4o-mini` for cost-sensitive agents
- Reduce `max_turns` per agent
- Check your OpenAI usage dashboard

### Ports Already in Use

Change MCP server ports in `.env`:

```
MCP_FILE_OPS_PORT=4100
MCP_TEST_RUNNER_PORT=4101
MCP_ANALYSIS_PORT=4102
MCP_INTERNET_PORT=4103
```

## Next Steps

1. Read the [VISION.md](VISION.md) for architecture details
2. Read [DYNAMIC_FLOW_COMMANDS.md](DYNAMIC_FLOW_COMMANDS.md) for flow command options
3. Customize agent prompts in `.flow/prompts/`
4. Create custom flows for your workflow
5. Contribute improvements via GitHub

Happy automating! 🤖

