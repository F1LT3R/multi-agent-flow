# Multi-Agent Flow System

Build a JavaScript/Node.js CLI orchestration system where AI agents run in an isolated Docker VM and interact with the host system exclusively through a custom, local Model Context Protocol (MCP) server. Each mode uses a configurable AI model (OpenAI, Anthropic, Google, xAI), with strict directory access controls.

**Distribution**: Installable globally via npm (`npm install -g multi-agent-flow`) for use across multiple projects.

**Configuration-First Design**: All agent behavior, sequences, and tools are defined via configuration, not hardcoded in the orchestrator.

## 1. Core Architecture & Security

### Isolation Strategy
- **Docker VM**: Agents execute inside a locked-down Docker container.
- **No Direct Access**: The container has NO direct filesystem access to the host OS outside of specific mounts.
- **MCP Bridge**: All operations (file I/O, test execution, code analysis) are routed through MCP servers running on the **Host**.
- **Network Bridge**: Agents communicate with Host MCP servers via a specialized Docker network bridge (HTTP/SSE) or proxied stdio.

### Directory Access Control
Permissions are enforced at two levels: VM Mounts (Docker) and MCP Application Logic (Node.js).

**Package Structure** (installed globally via npm):
```
multi-agent-flow/                # The npm package
├── agent/                       # Orchestrator code (hidden from users)
│   ├── cli.mjs                 # Entry point
│   ├── core/                   # Flow runner, executors
│   ├── mcp-servers/            # MCP server implementations
│   ├── ai-providers/           # AI adapter layer
│   ├── docker/                 # Docker integration
│   └── tests/                  # Orchestrator tests
└── templates/                   # Default prompt templates
    ├── WRITE_USER_STORIES.md
    └── ... (7 agent prompts)
```

**User Project Structure** (created by `flow init`):
```
my-app/                          # User's project directory
├── .flow/                       # Runtime state (gitignored)
│   ├── flow.config.mjs         # User configuration
│   ├── prompts/                 # Agent prompts
│   ├── traces/                  # Structured execution logs
│   └── checkpoints/            # State for resume capability
├── project/                     # Agent workspace - READ/WRITE
│   ├── src/                    # Generated source code
│   ├── tests/                  # Volatile tests (being developed)
│   └── package.json            # Project dependencies
├── prompts/                     # User's custom prompts (copied from templates)
├── plans/                       # Requirements/stories - READ_ONLY
└── tests/                       # Ratcheted tests (permanent) - READ_ONLY
    └── artifacts/              # Test failure artifacts
```

**Access Levels for Agents** (relative to user project root):
- `./project/` → **READ/WRITE** (Agent workspace)
- `./tests/` → **READ_ONLY** (Approved tests)
- `./plans/` → **READ_ONLY** (Requirements)
- `./prompts/` → **NOT MOUNTED** (Used by orchestrator, not agents)

The `./project` directory contains all source code being written. Agents see it as their root and create their own structure (`src/`, `lib/`, `dist/`, etc.).

### Docker User Mapping
- **UID/GID Handling**: The Docker container initiates the agent process using the Host User's UID/GID to ensure files created in `./project` are owned by the user, not `root`.

---

## 2. Terminology & Conventions

- **FLOW**: A defined order of agents (e.g., "development", "testing") in `.flow/flow.config.mjs`.
- **FLOW_RUN**: A single pass through the entire AGENT_SEQUENCE.
- **MAX_FLOW_RUNS**: Max times the flow can restart/loop back upon failure.
- **AGENT_TURN**: A single request/response cycle with the LLM.
- **MAX_TURNS**: Limit of turns an agent has to complete its task (prevents infinite loops).
- **RATCHETING**: The process of moving successful outputs (code/tests) from a volatile state to a permanent/read-only state.
- **GATEKEEPER**: An agent with `is_gatekeeper: true` that can trigger reflow by outputting "STATUS: REJECTED".
- **TEMPLATES**: Default prompt files in the npm package (`./templates/`).
- **USER PROMPTS**: Customizable prompt files in user's project (`./prompts/`, copied from templates).

**Date Format**: `YYYY/MM/DD HH:MM:SS` (Log display), `YYYY-MM-DD-HH-MM-SS` (Filenames).

---

## 3. Configuration System

The system is driven by `.flow/flow.config.mjs` in the user's project root.

### Structure
```mjs
{
    paths: {
        plans: './plans',
        project: './project',
        prompts: './prompts',
        tests: './tests',
        artifacts: './tests/artifacts',
    },
    // Settings for saving state
    persistence: {
        checkpoint_interval: "every_turn", // or "on_mode_complete" | "forever"
        traces_dir: "./.flow/traces"
    },
    sequences: {
        development: {
            max_flow_runs: 3,
            ask_before_reflow: true,
            agents: [
                'WRITE_USER_STORIES',
                'GENERATE_CODE',
                'PLAN_TESTS',
                'GENERATE_TESTS',
                'CODE_REVIEW',
                'CLEAN_UP_AND_REFACTOR',
                'REPORT'
            ]
        }
    },
    agents: [
        {
            name: "WRITE_USER_STORIES",
            goal: "Convert input to structured requirements",
            model: "claude-sonnet-4-5", // Maps to provider adapter
            max_turns: 6,
            complete_turns: true, // Force agent to use all turns?
            mcp_tools: {
                include: ['file_ops', 'internet'],
                exclude: ['run_tests']
            },
            prompt_file: './prompts/WRITE_USER_STORIES.md'
        },
        {
            name: "GENERATE_CODE",
            goal: "Write the implementation",
            model: "gpt-4o-mini",
            max_turns: 9,
            mcp_tools: {
                include: ['file_ops', 'run_tests', 'internet'], // Needs run_tests for self-correction? No, per prompt constraints they don't run tests. Clarify in config.
                exclude: []
            },
            prompt_file: './prompts/GENERATE_CODE.md'
        },
        {
            name: "PLAN_TESTS",
            goal: "Bridge the gap between stories and test code",
            model: "claude-sonnet-4-5",
            max_turns: 3,
            mcp_tools: {
                include: ['file_ops'],
                exclude: ['run_tests']
            },
            prompt_file: './prompts/PLAN_TESTS.md'
        },
        {
            name: "GENERATE_TESTS",
            goal: "Write and run the tests until they pass",
            model: "gpt-4o-mini",
            max_turns: 12,
            mcp_tools: {
                include: ['file_ops', 'run_tests'],
                exclude: []
            },
            prompt_file: './prompts/GENERATE_TESTS.md'
        },
        {
            name: "REVIEW",
            goal: "Audit the result before ratcheting",
            model: "gpt-4o",
            max_turns: 3,
            is_gatekeeper: true,  // ← Can trigger reflow on rejection
            mcp_tools: {
                include: ['file_ops', 'run_tests'],
                exclude: []
            },
            prompt_file: './prompts/REVIEW.md'
        },
        {
            name: "CLEAN_AND_REFACTOR",
            goal: "Polish the codebase",
            model: "claude-sonnet-4-5-thinking",
            max_turns: 9,
            mcp_tools: {
                include: ['file_ops', 'run_tests'],
                exclude: []
            },
            prompt_file: './prompts/CLEAN_AND_REFACTOR.md'
        },
        {
            name: "REPORT",
            goal: "Summarize for the human",
            model: "gpt-5.1-thinking",
            max_turns: 6,
            mcp_tools: {
                include: ['file_ops'],
                exclude: []
            },
            prompt_file: './prompts/REPORT.md'
        }
        // ... other agents
    ]
}
```

### Agent Configuration Fields

- `name` - Unique identifier (used in sequences)
- `goal` - Human-readable description (displayed in CLI)
- `model` - AI model identifier (e.g., 'gpt-4o', 'claude-sonnet-4-5')
- `max_turns` - Maximum conversation turns before stopping
- `is_gatekeeper` - (Optional) If true, can trigger reflow by outputting "STATUS: REJECTED"
- `complete_turns` - (Optional) Encourage agent to use all turns
- `mcp_tools` - Tool access control (include/exclude by category or tool name)
- `prompt_file` - Path to markdown prompt file (relative to user's project)

---

## 4. Agent Modes (The Sequence)

Context is cleared between FLOW_RUNS, but short-term memory (last 3 turns) is preserved on failure for debugging.

### 1. WRITE_USER_STORIES
- **Goal**: Convert input to structured requirements.
- **Model**: GPT-5.1 Thinking (High Reasoning).
- **Output**: Markdown file in `./plans/USER_STORIES_{iter}_{ts}.md`.
- **Behavior**: Verifies with user before proceeding.

### 2. GENERATE_CODE
- **Goal**: Implement features based on stories.
- **Model**: GPT-4o Mini (Cost-effective generation).
- **Output**: Source files in `./project`.
- **Style**: ES Modules, no classes (unless required), tab indentation.
- **Dependencies**: *Must* use `install_dependencies` tool if `package.json` changes.

### 3. PLAN_TESTS
- **Goal**: Strategy for testing user behaviors.
- **Model**: Claude Sonnet 4.5.
- **Output**: Test plan document/context.
- **Philosophy**: Test from user perspective, not implementation details.

### 4. GENERATE_TESTS
- **Goal**: Create and verify tests.
- **Model**: GPT-4o Mini.
- **Max Turns**: 12.
- **Tools**: CLI Runner (Node built-in), Puppeteer.
- **Logic**: Loops until tests pass or max turns reached.
- **Artifacts**: Saves `.txt` (errors) and `.png` (screenshots) to `./project/tests/artifacts`.

### 5. REVIEW (Gatekeeper)
- **Goal**: Validate code against User Stories and Intent.
- **Model**: GPT-5.1 Thinking.
- **Logic**:
  - **If Fail**: Triggers `REFLOW` (Back to WRITE_USER_STORIES).
  - **If Pass**: Proceeds to Refactor.

### 6. CLEAN_AND_REFACTOR
- **Goal**: Polish code, remove unused files, ensure DRY.
- **Model**: Claude Sonnet 4.5 Thinking.
- **Logic**: Validates that tests still pass after changes.

### 7. REPORT
- **Goal**: Summary of the run.
- **Output**: CLI summary and Report Markdown.

---

## 5. Technical Implementation

### AI Service Layer
- Unified Adapter Interface for:
    - OpenAI (GPT-4o/5)
    - Anthropic (Claude Sonnet)
    - Google (Gemini Pro)
    - Grok / xAI
- **Cost Tracking**: Logs token usage per turn.

### MCP Server Implementation (Host Side)
The host runs 3 distinct MCP Servers.

#### 1. File Operations Server (`mcp-file-server.js`)
- **Tools**: `read_file`, `write_file`, `list_directory`, `delete_file`, `move_file`, `grep`.
- **Safety**: Chroots all operations to `./project`.

#### 2. Test Runner & System Server (`mcp-system-server.js`)
- **Tools**:
    - `run_node_tests`: Executes Node test runner.
    - `run_puppeteer`: Runs browser tests.
    - `install_dependencies`: Runs `npm install` in the VM context.
    - `get_test_results`: Parses tap/json output.

#### 3. Code Analysis Server (`mcp-analysis-server.js`)
- **Tools**: `lint_code` (ESLint), `check_style`.

#### 4. Internet Resources Server
- **Tools**: `wget` (simple fetch), `httpie` (complex requests).

### State Persistence
- **Checkpoints**: The system saves the state (current turn, chat history, file snapshot) to `./.flow/checkpoints/` after every turn.
- **Resume**: `flow resume <run-id>` allows picking up after a crash or user interruption.

### CLI Interface
- `flow init`: Scaffolds config and directories.
- `flow dev "feature description"`: Starts the development flow.
- `flow test "fix tests"`: Starts the testing flow (no new code).
- `flow resume`: Resumes last session.
- `flow mode <MODE>`: Debug a specific agent in isolation.

---

## 6. Flow Logic & Error Handling

1. **Initialization**: Load config, start MCP servers.
2. **Loop**: Iterate through configured agent sequence.
3. **Execution**:
    - Agent generates tool calls.
    - Host executes tool calls via MCP.
    - Result returned to Agent.
4. **Gatekeeper Check**: If agent has `is_gatekeeper: true` and outputs "STATUS: REJECTED":
    - Increment `flow_run_count`
    - Jump back to first agent in sequence
    - Ask user for confirmation if `ask_before_reflow: true`
5. **Success**: If sequence completes, move `./project/tests` → `./tests` (Ratcheting).
6. **Failure Conditions**:
    - If `MAX_TURNS` reached: Agent stops, flow continues to next agent.
    - If `MAX_FLOW_RUNS` reached: Abort and generate failure report.

**Configuration-Driven Design:**
- No hardcoded agent names (e.g., "REVIEW") in flow runner
- Any agent can be a gatekeeper via `is_gatekeeper` flag
- Agent task descriptions come from prompt files, not flow runner code
- Enables custom sequences without modifying orchestrator code

## 7. Dependencies

- **Core**: `commander`, `dotenv`, `chalk`, `ora`
- **AI**: `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`
- **Testing**: `puppeteer`
- **MCP**: `express`, `cors` (HTTP-based MCP servers)
- **Container**: `dockerode` (for managing the Agent VM programmatically)

## 8. Installation & Usage

### For End Users

**Install globally:**
```bash
npm install -g multi-agent-flow
```

**Create a project:**
```bash
mkdir my-app
cd my-app
flow init
```

**Add API key:**
```bash
echo "OPENAI_API_KEY=sk-..." > .env
```

**Run:**
```bash
flow dev "Build a calculator CLI"
```

### For Developers

**Clone and develop:**
```bash
git clone <repo-url>
cd multi-agent-flow
npm install
npm link
```

**Run tests:**
```bash
npm test  # Runs agent/tests/*.test.mjs
```

## 9. Design Principles

### Configuration-First Architecture
- **No hardcoded agent names** - Flow runner is completely agnostic to agent names
- **Extensible sequences** - Users create custom workflows without code changes
- **Gatekeeper pattern** - Any agent can trigger reflow, not just "REVIEW"
- **Tool permissions** - Per-agent MCP tool access control
- **Prompt autonomy** - Each agent's behavior defined by its prompt file

### Package vs Project Separation
- **Templates** - Default prompts in npm package (`./templates/`)
- **User Prompts** - Customizable copies in user project (`./prompts/`)
- **Orchestrator Tests** - In package (`./agent/tests/`)
- **User Tests** - In user project (`./tests/`)
- **Update Safety** - Users can update tool without losing customizations

### Benefits
- Reusable agents across different workflows
- Custom agent types for different domains (design, security, documentation)
- Multiple user projects with single global installation
- Tool updates don't overwrite user customizations
