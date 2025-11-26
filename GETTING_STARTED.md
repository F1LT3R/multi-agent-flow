# Getting Started with Multi-Agent Flow

## Step-by-Step Setup Guide

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the environment template and add your API key:

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:
```
OPENAI_API_KEY=sk-your-actual-api-key-here
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
agent-flow init
```

This creates:
- `agent-flow.config.mjs` - Configuration file
- `./project/` - Where agents write code
- `./tests/` - Permanent test storage  
- `./plans/` - User stories and planning docs
- `./prompts/` - Agent instruction templates

### 5. Customize Prompts (Optional)

The `./prompts/` directory contains instruction files for each agent. Copy from the main repo:

```bash
cp ../prompts/*.md ./prompts/
```

Or create your own custom prompts.

### 6. Run Your First Flow

```bash
agent-flow run "Create a simple calculator CLI that can add, subtract, multiply, and divide"
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
cat ./plans/USER_STORIES_*.md

# View the generated code
ls -la ./project/

# View the tests
ls -la ./tests/

# View logs
cat .agent-flow/logs/session-*.jsonl | jq
```

## Advanced Usage

### Resume from Checkpoint

If a flow fails or is interrupted:

```bash
# List available checkpoints
agent-flow list

# Resume from specific checkpoint
agent-flow resume run-2024-11-26-...

# Or resume from latest
agent-flow resume
```

### Run Single Agent for Debugging

```bash
agent-flow mode GENERATE_CODE "Create a User class with email validation"
```

### Customize Configuration

Edit `agent-flow.config.mjs`:

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
agent-flow run "Build a todo list CLI app. Users can add, list, complete, and delete todos. Store in a JSON file."
```

### REST API

```bash
agent-flow run "Create a REST API for a blog. Endpoints: GET /posts, GET /posts/:id, POST /posts, PUT /posts/:id, DELETE /posts/:id. Use Express and store in memory."
```

### Data Processor

```bash
agent-flow run "Create a CSV to JSON converter. Read CSV file, parse it, and output formatted JSON. Handle errors gracefully."
```

## Troubleshooting

### Tests Fail During Flow

The `GENERATE_TESTS` agent will try to fix failing tests automatically (up to MAX_TURNS). If it can't:
- Check `.agent-flow/logs/` for details
- Review the generated code in `./project/`
- Run `agent-flow mode GENERATE_TESTS "Fix the failing tests"` to try again

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
2. Customize agent prompts in `./prompts/`
3. Create custom sequences for your workflow
4. Contribute improvements via GitHub

Happy automating! 🤖

