# Multi-Agent Flow

An AI agent orchestration system where AI agents run in isolated environments and interact with the host system through custom MCP (Model Context Protocol) servers.

## Overview

Multi-Agent Flow automates software development through a sequence of specialized AI agents:

1. **WRITE_USER_STORIES** - Convert ideas into structured requirements
2. **GENERATE_CODE** - Implement features based on stories
3. **PLAN_TESTS** - Design test strategy
4. **GENERATE_TESTS** - Write and verify tests
5. **REVIEW** - Validate against user intent (gatekeeper)
6. **CLEAN_AND_REFACTOR** - Polish the codebase
7. **REPORT** - Summarize results

## Features

- 🔒 **Secure Isolation** - Agents run with limited file system access
- 🔄 **Self-Healing Flows** - Automatically loops back on review failures
- 💾 **State Persistence** - Resume flows from checkpoints
- 🛠️ **MCP Tool System** - Agents access host via HTTP-based MCP servers
- 📊 **Token Tracking** - Monitor AI API usage per agent
- 🧪 **Test Ratcheting** - Promote passing tests to permanent storage

## Installation

### Prerequisites

- Node.js 20+
- OpenAI API key
- Docker (optional, for full isolation)

### Global Installation (Recommended)

Install the CLI tool globally via npm:

```bash
npm install -g multi-agent-flow
```

This makes the `agent-flow` command available from any directory.

### Local Development

If you're developing the tool itself:

1. Clone the repository:
```bash
git clone <repository-url>
cd multi-agent-flow
```

2. Install dependencies:
```bash
npm install
```

3. Link for local testing:
```bash
npm link
```

## Quick Start

1. **Create a project directory**:
```bash
mkdir my-app
cd my-app
```

2. **Initialize agent-flow**:
```bash
agent-flow init
```

This creates:
- `./project/` - Where agents write code
- `./tests/` - Permanent test storage
- `./plans/` - User stories and requirements
- `./prompts/` - Customizable agent instructions (copied from templates)
- `agent-flow.config.mjs` - Configuration file

3. **Add your OpenAI API key** to `.env`:
```bash
OPENAI_API_KEY=your_key_here
```

4. **Run a flow**:
```bash
agent-flow run "Build a simple todo list CLI app"
```

## CLI Commands

### `agent-flow init`
Initialize agent-flow in the current directory. 

**What it creates:**
- `./project/` - Where agents write code (writable workspace)
- `./tests/` - Permanent test storage (ratcheted tests)
- `./plans/` - User stories and requirements
- `./prompts/` - Customizable agent instructions (copied from templates)
- `agent-flow.config.mjs` - Configuration file
- `./.agent-flow/` - Runtime state (logs, checkpoints) - gitignored

**Note:** The prompts are copied from the package's templates, so you can customize them without affecting the tool itself.

### `agent-flow run <description>`
Run the full agent sequence with your feature description.

Options:
- `-s, --sequence <name>` - Sequence to run (default: "development")

Example:
```bash
agent-flow run "Create a REST API for managing users"
```

### `agent-flow resume [run-id]`
Resume a flow from a checkpoint. If no run-id is provided, resumes the most recent checkpoint.

Example:
```bash
agent-flow resume run-2024-11-26T10-30-00-abc123
```

### `agent-flow mode <agent-name> <input>`
Run a single agent in isolation for debugging.

Example:
```bash
agent-flow mode GENERATE_CODE "Implement a User class with validation"
```

### `agent-flow list`
List all available checkpoints.

## Configuration

Edit `agent-flow.config.mjs` to customize:

- **Agents** - Model selection, max turns, tool access, gatekeeper roles
- **Sequences** - Agent order, reflow settings
- **Paths** - Directory locations
- **Persistence** - Checkpoint frequency

### Agent Configuration Fields

- `name` - Unique identifier for the agent
- `goal` - Human-readable description (shown in CLI)
- `model` - AI model to use (e.g., 'gpt-4o', 'gpt-4o-mini')
- `max_turns` - Maximum conversation turns before stopping
- `is_gatekeeper` - (Optional) If true, agent can trigger reflow by outputting "STATUS: REJECTED"
- `mcp_tools` - Tool access control (include/exclude categories)
- `prompt_file` - Path to markdown prompt file

Example:
```javascript
export default {
  agents: [
    {
      name: 'WRITE_USER_STORIES',
      model: 'gpt-4o',
      max_turns: 6,
      mcp_tools: {
        include: ['file_ops'],
        exclude: []
      }
    },
    {
      name: 'REVIEW',
      model: 'gpt-4o',
      max_turns: 3,
      is_gatekeeper: true,  // Triggers reflow on rejection
      mcp_tools: {
        include: ['file_ops', 'run_tests'],
        exclude: []
      }
    }
  ],
  sequences: {
    development: {
      max_flow_runs: 3,
      ask_before_reflow: true,
      agents: ['WRITE_USER_STORIES', 'GENERATE_CODE', ...]
    }
  }
}
```

## Architecture

### MCP Servers

Four HTTP-based MCP servers provide tools to agents:

1. **File Operations** (port 3100)
   - read_file, write_file, list_directory, delete_file, move_file, grep

2. **Test Runner** (port 3101)
   - run_node_tests, run_puppeteer, install_dependencies, get_test_results

3. **Code Analysis** (port 3102)
   - lint_code, check_style

4. **Internet Resources** (port 3103)
   - wget, httpie

### Directory Structure

**NPM Package Structure** (installed globally):
```
multi-agent-flow/
├── agent/                  # Orchestrator code (hidden from user)
│   ├── cli.mjs            # Main CLI entry point
│   ├── core/              # Core orchestration
│   ├── mcp-servers/       # MCP server implementations
│   ├── ai-providers/      # AI provider adapters
│   ├── docker/            # Docker isolation
│   └── tests/             # Orchestrator tests
└── templates/             # Default prompt templates
```

**User Project Structure** (created by `agent-flow init`):
```
my-app/
├── agent-flow.config.mjs  # Your configuration
├── .agent-flow/           # Runtime state (gitignored)
│   ├── logs/              # Structured execution logs
│   └── checkpoints/       # Saved states for resume
├── project/               # Agent workspace (writable)
│   ├── src/               # Generated source code
│   ├── tests/             # Volatile tests (being worked on)
│   └── package.json       # Project dependencies
├── prompts/               # Your custom agent instructions
├── plans/                 # User stories, requirements
└── tests/                 # Ratcheted tests (permanent, read-only)
    └── artifacts/         # Test failure artifacts
```

## Flow Logic

1. User provides feature description
2. Flow executes agent sequence
3. Each agent has MAX_TURNS to complete its task
4. REVIEW agent validates work:
   - **APPROVE** → Continue to next agent
   - **REJECT** → Loop back to WRITE_USER_STORIES (up to MAX_FLOW_RUNS)
5. On success, tests are ratcheted to `./tests`

## Customization

### Custom Prompts

Edit files in `./prompts/` to customize agent behavior:
- `WRITE_USER_STORIES.md`
- `GENERATE_CODE.md`
- `PLAN_TESTS.md`
- etc.

**Note:** These files are copied from the package's `templates/` directory during `agent-flow init`. You can safely modify them without affecting the tool. If you update multi-agent-flow, your custom prompts are preserved.

### Custom Sequences

Add new sequences in `agent-flow.config.mjs`:

```javascript
sequences: {
  design: {
    max_flow_runs: 2,
    agents: ['READ_USER_STORIES', 'CREATE_WIREFRAMES', 'GENERATE_DESIGNS']
  }
}
```

## Troubleshooting

### "No OpenAI API key found"
Add `OPENAI_API_KEY=your_key` to `.env` file.

### "Port already in use"
MCP servers use ports 3100-3103. Ensure these are available or change them in `.env`:
```
MCP_FILE_OPS_PORT=4100
MCP_TEST_RUNNER_PORT=4101
MCP_ANALYSIS_PORT=4102
MCP_INTERNET_PORT=4103
```

### "Agent exceeded MAX_TURNS"
Increase `max_turns` for the agent in `agent-flow.config.mjs`.

### Viewing Logs
Structured logs are saved to `.agent-flow/logs/`:
```bash
cat .agent-flow/logs/session-*.jsonl | jq
```

## Development

### Running Tests
```bash
npm test
```

### Adding a New Agent
1. Create prompt file in `./prompts/NEW_AGENT.md`
2. Add agent config to `agent-flow.config.mjs`
3. Add agent to desired sequence

### Adding a New AI Provider
1. Create adapter in `agent/ai-providers/`
2. Implement `BaseAIAdapter` interface
3. Update `ProviderFactory` to recognize model prefix

## Documentation

- [Vision & Architecture](docs/VISION.md) - Comprehensive system design
- [Getting Started Guide](docs/GETTING_STARTED.md) - Step-by-step tutorial
- [Implementation Summary](docs/IMPLEMENTATION_SUMMARY.md) - Technical details
- [Restructure Summary](docs/RESTRUCTURE_SUMMARY.md) - Package reorganization details

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

---

Built with ❤️ using Node.js, OpenAI, and MCP
