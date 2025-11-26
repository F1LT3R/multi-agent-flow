# Multi-Agent Flow System

Build a JavaScript/Node.js CLI orchestration system where AI agents run in an isolated Docker VM and interact with the host system exclusively through a custom, local Model Context Protocol (MCP) server. Each mode uses a configurable AI model (OpenAI, Anthropic, Google, xAI), with strict directory access controls.

## 1. Core Architecture & Security

### Isolation Strategy
- **Docker VM**: Agents execute inside a locked-down Docker container.
- **No Direct Access**: The container has NO direct filesystem access to the host OS outside of specific mounts.
- **MCP Bridge**: All operations (file I/O, test execution, code analysis) are routed through MCP servers running on the **Host**.
- **Network Bridge**: Agents communicate with Host MCP servers via a specialized Docker network bridge (HTTP/SSE) or proxied stdio.

### Directory Access Control
Permissions are enforced at two levels: VM Mounts (Docker) and MCP Application Logic (Node.js).

**Mounts relative to Project Root:**
- `./` (Root) → **NOT MOUNTED**
- `./agent` (Orchestrator code) → **NOT MOUNTED**
- `./project` (Source code) → **READ/WRITE** (Agents see this as their working root)
- `./tests` (Approved tests) → **READ_ONLY**
- `./tests/artifacts` (Failure screenshots/logs) → **READ_ONLY** (Agents write here via MCP only)
- `./plans` (Requirements/Stories) → **READ_ONLY**

### Docker User Mapping
- **UID/GID Handling**: The Docker container initiates the agent process using the Host User's UID/GID to ensure files created in `./project` are owned by the user, not `root`.

---

## 2. Terminology & Conventions

- **AGENT_SEQUENCE**: A defined order of agents (e.g., "Development", "Design") in `agent-flow.config.mjs`.
- **FLOW_RUN**: A single pass through the entire AGENT_SEQUENCE.
- **MAX_FLOW_RUNS**: Max times the flow can restart/loop back upon failure.
- **AGENT_TURN**: A single request/response cycle with the LLM.
- **MAX_TURNS**: Limit of turns an agent has to complete its task (prevents infinite loops).
- **RATCHETING**: The process of moving successful outputs (code/tests) from a volatile state to a permanent/read-only state.

**Date Format**: `YYYY/MM/DD HH:MM:SS` (Log display), `YYYY-MM-DD-HH-MM-SS` (Filenames).

---

## 3. Configuration System

The system is driven by `agent-flow.config.mjs` in the user's project root.

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
        log_dir: "./.agent-flow/logs"
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
            model: "gpt-5.1-thinking",
            max_turns: 3,
            is_gatekeeper: true,
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
    ]
}
```

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
- **Checkpoints**: The system saves the state (current turn, chat history, file snapshot) to `./.agent-flow/checkpoints/` after every turn.
- **Resume**: `agent-flow resume <run-id>` allows picking up after a crash or user interruption.

### CLI Interface
- `agent-flow init`: Scaffolds config and directories.
- `agent-flow run "feature description"`: Starts the flow.
- `agent-flow resume`: Resumes last session.
- `agent-flow mode <MODE>`: Debug a specific agent in isolation.

---

## 6. Flow Logic & Error Handling

1. **Initialization**: Load config, pull/build Docker image.
2. **Loop**: Iterate through `sequences.development.agents`.
3. **Execution**:
    - Agent generates tool calls.
    - Host executes tool calls via MCP.
    - Result returned to Agent.
4. **Success**: If Sequence completes, move `./project/tests` -> `./tests` (Ratcheting).
5. **Failure**:
    - If `REVIEW` fails: Increment `flow_run_count`. Jump back to `WRITE_USER_STORIES`.
    - If `MAX_TURNS` reached: Prompt user to continue or fail.
    - If `MAX_FLOW_RUNS` reached: Abort and generate failure report.

## 7. Dependencies

- **Core**: `commander`, `dotenv`, `chalk`, `ora`
- **AI**: `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`
- **Testing**: `puppeteer`
- **Communication**: Standard MCP SDK
- **Container**: `dockerode` (for managing the Agent VM programmatically)
