# Quick Start - Test Your Multi-Agent Flow

The `agent-flow` command is now available globally! Follow these steps to test:

## Step 1: Set Your API Key

```bash
# In the multi-agent-flow repo root
echo "OPENAI_API_KEY=sk-your-actual-key-here" > .env
```

## Step 2: Initialize a Test Project

```bash
# Create test directory
mkdir ../test-agent-project
cd ../test-agent-project

# Initialize
agent-flow init
```

## Step 3: Add API Key to Test Project

```bash
echo "OPENAI_API_KEY=sk-your-actual-key-here" > .env
```

## Step 4: Run Without Docker First (Recommended)

Test the basic flow without Docker complexity:

```bash
# Note: You MUST be in the test project directory (not the multi-agent-flow repo)
cd ../test-agent-project  # if not already there

SKIP_DOCKER=true agent-flow run "Create a simple hello.js file that exports a greet function"
```

**What you'll see:**
- MCP servers starting on ports 3100-3103
- Each agent executing in sequence
- Real-time streaming of agent thoughts (gray text)
- Tool calls displayed (yellow with 🔧)
- Token usage after each turn
- Final summary

**What gets created:**
- `./plans/USER_STORIES_*.md` - Requirements
- `./project/hello.js` - Generated code
- `./traces/` - Complete execution traces

## Step 5: Run With Docker (Full Isolation)

Now test with Docker:

```bash
# Make sure Docker is running
docker ps

# Run with Docker
agent-flow run "Build a calculator with add, subtract, multiply, divide"
```

**What you'll see:**
- Docker image building (first time only)
- Container starting
- Same streaming output as before
- Container stopping at end

**Verify file ownership:**
```bash
ls -la project/
# Should show YOUR username, not root
```

## Step 6: Explore the Results

```bash
# View user stories
cat plans/USER_STORIES_*.md

# View generated code
cat project/*.js

# View traces (pick any file)
ls traces/
cat traces/2024-*-GENERATE_CODE-r1-t1.md
```

## Step 7: Review Traces

Traces show everything that happened:

```bash
# List all traces
ls -lt traces/

# View a specific agent's first turn
cat traces/*-WRITE_USER_STORIES-r1-t1.md

# See what code was generated
cat traces/*-GENERATE_CODE-r1-*.md
```

## Common Issues

### "OPENAI_API_KEY environment variable is required"
```bash
# Make sure .env exists in your test project
cat .env
# Should show: OPENAI_API_KEY=sk-...
```

### "Docker not available"
```bash
# Start Docker Desktop (Mac) or docker service (Linux)
docker ps

# Or skip Docker for testing
SKIP_DOCKER=true agent-flow run "..."
```

### "Port already in use"
```bash
# Find what's using the ports
lsof -i :3100-3103

# Kill the processes or change ports in .env
```

## Expected Behavior

### Without Docker (SKIP_DOCKER=true)
- ⚡ Faster (no container overhead)
- ✅ All features work
- ⚠️ No isolation (agents run directly on host)
- ✅ File ownership correct

### With Docker
- 🐳 First run slower (builds image)
- ✅ Full isolation
- ✅ Agents in containers
- ✅ File ownership correct (UID/GID mapping)
- 🔒 More secure

## Success Indicators

You'll know it's working when:

1. ✅ MCP servers start without errors
2. ✅ Agents execute sequentially  
3. ✅ You see real-time streaming output
4. ✅ Files appear in `./project/`
5. ✅ Traces appear in `./traces/`
6. ✅ You can read/edit generated files

## Try Different Prompts

```bash
# Simple
agent-flow run "Create a fibonacci function"

# Medium complexity
agent-flow run "Build a JSON config file reader with validation"

# Complex
agent-flow run "Create a CLI todo app with add, list, complete, delete commands"
```

## Next Steps

After successful test drive:

1. Review traces to understand agent behavior
2. Customize prompts in `./prompts/`
3. Adjust agent settings in `agent-flow.config.mjs`
4. Try the resume feature (Ctrl+C then `agent-flow resume`)

Have fun! 🚀

