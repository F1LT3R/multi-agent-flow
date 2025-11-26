# Multi-Agent Flow - Test Drive Guide

This guide will help you take the complete system for a test drive with Docker isolation, real-time streaming, and trace recording.

## Prerequisites

1. **Node.js 20+** installed
2. **Docker** installed and running
3. **OpenAI API key** (for testing with GPT models)

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment

Create a `.env` file in the project root:

```bash
# Copy the example
cp .env.example .env

# Edit and add your API key
echo "OPENAI_API_KEY=sk-your-actual-key-here" >> .env
```

### 3. Initialize Test Project

Create a test project directory:

```bash
# Create test directory
mkdir test-project
cd test-project

# Initialize
../agent/cli.mjs init

# Or if globally linked:
agent-flow init
```

This creates:
- `./project/` - Agent workspace
- `./tests/` - Permanent tests
- `./plans/` - Requirements
- `./prompts/` - Custom prompts (from templates)
- `./traces/` - Execution traces
- `agent-flow.config.mjs` - Configuration

### 4. Add API Key to Test Project

```bash
echo "OPENAI_API_KEY=sk-your-actual-key-here" > .env
```

## Test Scenarios

### Test 1: Simple Code Generation (No Docker)

Test without Docker to verify basic functionality:

```bash
SKIP_DOCKER=true agent-flow run "Create a simple hello.js file that prints 'Hello, World!'"
```

**What to observe:**
- ✅ MCP servers start on ports 3100-3103
- ✅ Agents execute sequentially
- ✅ Real-time streaming of agent thinking
- ✅ Tool calls displayed as they happen
- ✅ Files created in `./project/`
- ✅ Traces saved to `./traces/`

**Check results:**
```bash
# View generated code
ls -la project/

# View trace files
ls -la traces/

# Read a trace
cat traces/2024-*-GENERATE_CODE-r1-t1.md
```

### Test 2: With Docker Isolation

Test with full Docker isolation:

```bash
# Ensure Docker is running
docker ps

# Run with Docker
agent-flow run "Create a calculator.js with add, subtract, multiply, divide functions"
```

**What to observe:**
- ✅ Docker image builds with your UID/GID
- ✅ Container starts and becomes healthy
- ✅ Agents execute inside container
- ✅ Files in `./project/` owned by you (not root)
- ✅ Container stops after completion
- ✅ Traces recorded with full details

**Verify file ownership:**
```bash
ls -la project/
# Should show YOUR username, not root
```

### Test 3: Test Generation Flow

Test the complete flow with tests:

```bash
agent-flow run "Build a todo CLI: add, list, complete, and delete todos. Store in JSON file."
```

**What to observe:**
- ✅ USER_STORIES created in `./plans/`
- ✅ Code generated in `./project/`
- ✅ Tests generated in `./project/tests/`
- ✅ Tests run and pass
- ✅ Tests ratcheted to `./tests/`
- ✅ Complete trace history in `./traces/`

### Test 4: Resume from Checkpoint

Interrupt a flow and resume:

```bash
# Start a flow
agent-flow run "Create a REST API server"

# Press Ctrl+C to interrupt during execution

# List checkpoints
agent-flow list

# Resume
agent-flow resume
```

### Test 5: Single Agent Mode (Debugging)

Test a single agent in isolation:

```bash
agent-flow mode WRITE_USER_STORIES "Build a weather app"
```

## Verification Checklist

After running tests, verify:

### Docker Integration
- [ ] Image builds successfully
- [ ] Container starts and reports healthy
- [ ] Files created have correct ownership
- [ ] Can edit files in ./project/ without sudo
- [ ] Container stops cleanly

### Real-Time Streaming
- [ ] See agent thinking as it happens
- [ ] Tool calls displayed in real-time
- [ ] Token usage shown after each turn
- [ ] Color-coded output (thinking=gray, tools=yellow, success=green)

### Trace Recording
- [ ] Traces created in ./traces/
- [ ] Filename format: `YYYY-MM-DD-HH-MM-SS-AGENT_NAME-rX-tY.md`
- [ ] Traces contain full conversation history
- [ ] Tool calls and results captured
- [ ] Token usage recorded
- [ ] Timing information included

### MCP Servers
- [ ] File operations work (read, write, list)
- [ ] Test runner works (npm install, run tests)
- [ ] Code analysis works (lint, style check)
- [ ] Internet access works (wget, httpie)

### Agent Flow
- [ ] All 7 agents execute in sequence
- [ ] REVIEW agent can trigger reflow
- [ ] Tests are ratcheted after success
- [ ] Checkpoints can be resumed

## Troubleshooting

### Docker Issues

**"Docker not available"**
```bash
# Check Docker is running
docker ps

# If not, start Docker Desktop (Mac) or docker service (Linux)
```

**"Permission denied" on files**
```bash
# Check file ownership
ls -la project/

# Should show your username. If root, rebuild image:
docker rmi multi-agent-flow-agent
agent-flow run "test"
```

### API Key Issues

**"No OpenAI API key found"**
```bash
# Verify .env file exists
cat .env

# Should show: OPENAI_API_KEY=sk-...
```

### MCP Server Issues

**"Failed to connect to MCP server"**
```bash
# Check ports are available
lsof -i :3100-3103

# If in use, kill processes or change ports in .env
```

## Performance Notes

- First run with Docker will be slower (image build)
- Subsequent runs reuse the image
- GPT-4o costs more but gives better results
- GPT-4o-mini is faster and cheaper for code generation
- Traces can grow large - clean old traces periodically

## Success Criteria

You'll know it's working when:

1. ✅ Docker container starts without errors
2. ✅ Agents stream output in real-time
3. ✅ Files appear in ./project/ with correct ownership
4. ✅ Traces save to ./traces/ with full details
5. ✅ You can read and edit generated code normally
6. ✅ Tests run and ratchet to ./tests/

## Next Steps

After successful test drive:

1. Try more complex projects
2. Customize agent prompts in ./prompts/
3. Create custom agent sequences
4. Review traces to understand agent behavior
5. Report any issues or improvements

## Support

If you encounter issues:

1. Check traces in ./traces/ for detailed execution history
2. Check logs in ./.agent-flow/logs/
3. Run with SKIP_DOCKER=true to isolate Docker issues
4. Review this guide for troubleshooting steps

Enjoy building with Multi-Agent Flow! 🚀

