# Quick Start

## Prerequisites

**Docker is required** - agent-flow runs AI agents in isolated containers for safety.

1. Install Docker Desktop: https://www.docker.com/products/docker-desktop
2. Start Docker
3. Verify: `docker info` should run without errors

Without Docker, agent-flow will exit with an error.

## Test the Calculator Example

```bash
# 1. Create a fresh test directory
mkdir ~/test-calc
cd ~/test-calc

# 2. Initialize the project
agent-flow init

# 3. Set your API key (if not already in ~/.zshrc or ~/.bashrc)
export OPENAI_API_KEY=sk-your-key-here

# 4. Run it
agent-flow run "Build a calculator with add, subtract, multiply, divide"

# 5. Check the output
ls project/        # Your code
ls tests/          # Ratcheted tests
ls plans/          # User stories and reports
ls traces/         # Agent execution logs
```

## What to Expect

- Agents will write user stories, generate code, create tests, and review
- If review fails, it will reflow and try again (up to 3 times)
- When successful, code and tests get "ratcheted" (saved permanently)
- Check `./traces/` to see what each agent did

## Run Again (Test Iteration)

```bash
# Try a different feature
agent-flow run "Build a todo list app"

# Or iterate on the calculator
agent-flow run "Add scientific functions to the calculator"
```

## Skip Reflow Prompts

```bash
# Auto-approve reflowing without asking
agent-flow run "your task" --yes
```

## Troubleshooting

**If you get "address already in use" errors:**

```bash
# Clean up stuck MCP servers
agent-flow cleanup
```

This kills any processes still running on ports 3100-3103 from a previous run that didn't shut down cleanly.

That's it!
