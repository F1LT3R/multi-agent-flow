# Multi-Agent Flow

A powerful multi-agent orchestration system that coordinates AI agents to complete complex tasks through structured workflows. Agents run in isolated Docker containers and can use different AI models for different stages of your workflow.

## Features

- **Multi-Agent Orchestration**: Chain multiple AI agents together in customizable flows
- **Docker Isolation**: Each agent runs in an isolated container for safety and reproducibility
- **Multiple AI Providers**: Support for OpenAI, OpenRouter (200+ models), and DeepSeek
- **Flexible Workflows**: Define custom flows for different use cases (development, testing, web design, etc.)
- **Context Injection**: Agents learn from feedback through automatic context sharing
- **Gatekeeper Pattern**: Review agents can approve or reject work, triggering automatic refinement
- **Cost Tracking**: Built-in token usage and cost monitoring
- **Checkpoint & Resume**: Save progress and resume from any point
- **Ratchet System**: Preserve approved artifacts across flow runs

## Quick Start

### Installation

```bash
npm install -g multi-agent-flow
```

### Setup

1. **Configure API Keys**

Set up your AI provider API keys:

```bash
# OpenAI (for GPT models)
export OPENAI_API_KEY="sk-..."

# OpenRouter (for 200+ models including Mistral, Claude, Gemini, etc.)
export OPENROUTER_API_KEY="sk-or-v1-..."

# DeepSeek (optional)
export DEEPSEEK_API_KEY="sk-..."
```

2. **Initialize a Project**

```bash
cd your-project
flow init
```

This creates a `flow.config.mjs` file and `.flow/` directory structure.

3. **Run Your First Flow**

```bash
flow run development "Create a calculator with add and multiply functions"
```

## Supported AI Providers

### OpenAI
- Models: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1-preview`, `o1-mini`
- Setup: Set `OPENAI_API_KEY` environment variable

### OpenRouter
- Models: 200+ models from multiple providers
  - `mistralai/mistral-large` - Mistral's largest model
  - `moonshotai/kimi-k2` - Moonshot's Kimi model
  - `google/gemini-3-pro-image-preview` - Google's Gemini with vision
  - `anthropic/claude-3.5-sonnet` - Anthropic's Claude via OpenRouter
  - `deepseek/deepseek-r1` - DeepSeek reasoning model
  - And 200+ more...
- Setup: Set `OPENROUTER_API_KEY` environment variable
- Format: Use `provider/model-name` format in config

### DeepSeek
- Models: `deepseek-chat`, `deepseek-coder`
- Setup: Set `DEEPSEEK_API_KEY` environment variable

## Built-in Flows

### Development Flow
Full-featured development with tests and code review.

```bash
flow run development "Build a REST API for user management"
```

**Agents:**
1. WRITE_USER_STORIES - Convert intent to structured requirements
2. GENERATE_CODE - Implement the features
3. PLAN_TESTS - Design test strategy
4. GENERATE_TESTS - Write and run tests
5. REVIEW - Approve or reject (gatekeeper)
6. CLEAN_AND_REFACTOR - Polish the code
7. REPORT - Summarize results

### Testing Flow
Write and fix tests for existing code.

```bash
flow run testing "Add tests for the authentication module"
```

**Agents:**
1. GENERATE_TESTS - Write and run tests
2. REVIEW - Approve or reject
3. CLEAN_AND_REFACTOR - Polish tests
4. REPORT - Summarize results

### WebUI Flow
Generate web designs with iterative refinement using multiple AI models.

```bash
flow run webui "Create a modern dashboard for analytics"
```

**Agents:**
1. DESIGN_DOC (Mistral Large) - Create structured design document
2. RENDER_VIEWS (Gemini Pro Image) - Generate visual mockups
3. PLAN_WORK (Mistral Large) - Plan implementation approach
4. EXECUTE_CODE (Kimi K2) - Implement the web UI
5. REVIEW_DESIGN (Mistral Large) - Review and approve/reject (gatekeeper)

**Loop behavior:** If REVIEW_DESIGN rejects, the flow loops back to EXECUTE_CODE with feedback until approved (max 5 runs).

## Configuration

Edit `flow.config.mjs` to customize your workflows:

```javascript
export default {
  default_flow: 'development',
  
  flows: {
    // Define custom flows
    myflow: {
      description: 'My custom workflow',
      aliases: ['custom'],
      max_flow_runs: 3,
      ask_before_reflow: true,
      agents: ['AGENT1', 'AGENT2', 'AGENT3'],
    },
  },
  
  agents: [
    {
      name: 'AGENT1',
      goal: 'What this agent does',
      model: 'gpt-4o-mini',  // or 'mistralai/mistral-large', etc.
      max_turns: 6,
      settings: {
        temperature: 0.5,
        // top_p: 1,
        // max_tokens: 4096,
      },
      context_injection: {
        REVIEW: true,  // Receive feedback from REVIEW agent
      },
      mcp_tools: {
        include: ['list_directory', 'read_file', 'write_file'],
      },
      file_constraints: {
        write_patterns: ['**/*.js'],
      },
      prompt_file: './.flow/prompts/AGENT1.md',
    },
  ],
  
  pricing: {
    overrides: {
      // Override model pricing if needed
      'mistralai/mistral-large': {
        input: 3.00,
        output: 9.00,
        context_window: 128000,
      },
    },
  },
}
```

## Using OpenRouter Models

OpenRouter provides access to 200+ AI models through a single API. To use OpenRouter:

1. **Get an API key** from [openrouter.ai](https://openrouter.ai)

2. **Set the environment variable:**
```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

3. **Use provider/model-name format in your config:**
```javascript
{
  name: 'MY_AGENT',
  model: 'mistralai/mistral-large',  // OpenRouter format
  // ... rest of config
}
```

4. **Popular OpenRouter models:**
- `mistralai/mistral-large` - Great for reasoning and planning
- `anthropic/claude-3.5-sonnet` - Excellent for code and analysis
- `google/gemini-3-pro-image-preview` - Vision capabilities
- `deepseek/deepseek-r1` - Strong reasoning model
- `moonshotai/kimi-k2` - Long context support

See [openrouter.ai/models](https://openrouter.ai/models) for the complete list.

## CLI Commands

```bash
# Initialize a new project
flow init

# Run a flow
flow run <flow-name> "your task description"

# List available flows
flow list

# Resume from checkpoint
flow resume

# Show cost summary
flow cost

# Create a snapshot (rollback point)
flow snapshot create "description"

# Rollback to a snapshot
flow snapshot rollback <snapshot-id>
```

## Advanced Features

### Context Injection
Agents can receive outputs from previous agents on reflow:

```javascript
context_injection: {
  REVIEW: true,  // Get feedback when REVIEW rejects
  REPORT: true,  // Learn from previous run reports
}
```

### Gatekeeper Pattern
Mark an agent as a gatekeeper to enforce quality:

```javascript
{
  name: 'REVIEW',
  is_gatekeeper: true,  // Can trigger reflow by rejecting
  // ...
}
```

### File Constraints
Control what files agents can modify:

```javascript
file_constraints: {
  write_patterns: ['**/*.js', '**/*.mjs'],
  exclusions: [
    {
      patterns: ['**/*test*.js'],
      message: 'Do not write test files',
    },
  ],
}
```

### Model Settings
Fine-tune model behavior per agent:

```javascript
settings: {
  temperature: 0.2,      // 0-2, lower = more deterministic
  top_p: 1,              // 0-1, nucleus sampling
  max_tokens: 4096,      // Maximum output tokens
  stop: ['---END---'],   // Stop sequences (max 4)
}
```

## Directory Structure

```
your-project/
├── flow.config.mjs          # Your workflow configuration
├── .flow/
│   ├── prompts/             # Agent prompt templates
│   ├── checkpoints/         # Resume state
│   ├── snapshots/           # Rollback points
│   ├── traces/              # Execution logs
│   ├── ratchet/             # Blessed artifacts
│   └── context/             # Working memory
└── your-code/               # Your project files
```

## Example: Custom WebUI Flow

Here's how the webui flow orchestrates multiple models:

```javascript
flows: {
  webui: {
    description: 'Generate web designs with iterative refinement',
    max_flow_runs: 5,
    agents: [
      'DESIGN_DOC',      // Mistral Large - design thinking
      'RENDER_VIEWS',    // Gemini - visual mockups
      'PLAN_WORK',       // Mistral Large - technical planning
      'EXECUTE_CODE',    // Kimi K2 - implementation
      'REVIEW_DESIGN',   // Mistral Large - quality gate
    ],
  },
}
```

**Flow execution:**
1. User provides design intent
2. Mistral Large creates detailed design document
3. Gemini generates visual mockups from design
4. Mistral Large plans the implementation approach
5. Kimi K2 implements the code
6. Mistral Large reviews against design
7. If rejected, loop back to step 5 with feedback
8. If approved, flow completes

## Cost Management

Monitor costs in real-time:

```bash
flow cost
```

Override pricing in your config:

```javascript
pricing: {
  overrides: {
    'mistralai/mistral-large': {
      input: 3.00,   // USD per 1M input tokens
      output: 9.00,  // USD per 1M output tokens
    },
  },
}
```

## Troubleshooting

### Docker Issues
Make sure Docker is running:
```bash
docker ps
```

### API Key Issues
Verify your API keys are set:
```bash
echo $OPENAI_API_KEY
echo $OPENROUTER_API_KEY
```

### Flow Not Found
List available flows:
```bash
flow list
```

### Resume from Checkpoint
If a flow is interrupted:
```bash
flow resume
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Documentation](docs/)
- [OpenRouter Models](https://openrouter.ai/models)
- [OpenAI Pricing](https://openai.com/pricing)
- [GitHub Repository](https://github.com/your-org/multi-agent-flow)
