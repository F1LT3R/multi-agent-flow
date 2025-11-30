import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'

/**
 * Default configuration based on VISION.md
 * Note: All paths are hardcoded relative to project root:
 * - .flow/prompts/       - Agent prompt files
 * - .flow/checkpoints/   - Resume state
 * - .flow/snapshots/     - Rollback points
 * - .flow/traces/        - Execution logs
 * - .flow/ratchet/       - Blessed artifacts (stories, reports, tests)
 */
export const DEFAULT_CONFIG = {
	persistence: {
		checkpoint_interval: 'every_turn',
	},
	pricing: {
		overrides: {},                               // User overrides for model pricing
	},
	flows: {
		development: {
			max_flow_runs: 3,
			ask_before_reflow: true,
			agents: [
				'WRITE_USER_STORIES',
				'GENERATE_CODE',
				'PLAN_TESTS',
				'GENERATE_TESTS',
				'REVIEW',
				'CLEAN_AND_REFACTOR',
				'REPORT',
			],
		},
	},
	agents: [
		{
			name: 'WRITE_USER_STORIES',
			goal: 'Convert input to structured requirements',
			model: 'gpt-4o',
			max_turns: 6,
			complete_turns: true,
			settings: {
				temperature: 0.5,  // Balanced for clear specs with some creative phrasing
			},
			mcp_tools: {
				include: ['file_ops', 'internet'],
				exclude: ['run_tests'],
			},
			prompt_file: './.flow/prompts/WRITE_USER_STORIES.md',
		},
		{
			name: 'GENERATE_CODE',
			goal: 'Write the implementation',
			model: 'gpt-4o-mini',
			max_turns: 9,
			settings: {
				temperature: 0.2,  // Low for consistent, precise code
			},
			mcp_tools: {
				include: ['file_ops', 'internet'],
				exclude: ['run_tests'],
			},
			prompt_file: './.flow/prompts/GENERATE_CODE.md',
		},
		{
			name: 'PLAN_TESTS',
			goal: 'Bridge the gap between stories and test code',
			model: 'gpt-4o',
			max_turns: 3,
			settings: {
				temperature: 0.3,  // Low for analytical, structured planning
			},
			mcp_tools: {
				include: ['file_ops'],
				exclude: ['run_tests'],
			},
			prompt_file: './.flow/prompts/PLAN_TESTS.md',
		},
		{
			name: 'GENERATE_TESTS',
			goal: 'Write and run the tests until they pass',
			model: 'gpt-4o-mini',
			max_turns: 12,
			settings: {
				temperature: 0.2,  // Low for precise, reproducible tests
			},
			mcp_tools: {
				include: ['file_ops', 'run_tests'],
				exclude: [],
			},
			prompt_file: './.flow/prompts/GENERATE_TESTS.md',
		},
		{
			name: 'REVIEW',
			goal: 'Audit the result before ratcheting',
			model: 'gpt-4o',
			max_turns: 3,
			is_gatekeeper: true,
			settings: {
				temperature: 0.1,  // Very low for deterministic, consistent gatekeeper decisions
			},
			mcp_tools: {
				include: ['file_ops', 'run_tests'],
				exclude: [],
			},
			prompt_file: './.flow/prompts/REVIEW.md',
		},
		{
			name: 'CLEAN_AND_REFACTOR',
			goal: 'Polish the codebase',
			model: 'gpt-4o',
			max_turns: 9,
			settings: {
				temperature: 0.3,  // Low for safe refactoring that preserves functionality
			},
			mcp_tools: {
				include: ['file_ops', 'run_tests'],
				exclude: [],
			},
			prompt_file: './.flow/prompts/CLEAN_AND_REFACTOR.md',
		},
		{
			name: 'REPORT',
			goal: 'Summarize for the human',
			model: 'gpt-4o',
			max_turns: 6,
			settings: {
				temperature: 0.5,  // Balanced for clear documentation with varied presentation
			},
			mcp_tools: {
				include: ['file_ops'],
				exclude: [],
			},
			prompt_file: './.flow/prompts/REPORT.md',
		},
	],
}

/**
 * Configuration Loader
 * Loads and validates flow.config.mjs
 */
export class ConfigLoader {
	constructor(projectRoot = process.cwd()) {
		this.projectRoot = projectRoot
		this.config = null
	}

	/**
	 * Get pricing overrides (merged with defaults)
	 */
	getPricingOverrides() {
		if (!this.config) {
			throw new Error('Configuration not loaded. Call load() first.')
		}
		return this.config.pricing?.overrides || {}
	}

	/**
	 * Load configuration from .flow/flow.config.mjs
	 */
	async load() {
		const configPath = path.join(this.projectRoot, '.flow/flow.config.mjs')

		try {
			// Check if config file exists
			await fs.access(configPath)

		// Load the config file
		const configUrl = pathToFileURL(configPath).href
		const module = await import(configUrl)
		const userConfig = module.default

		// Merge with defaults
		this.config = this._mergeConfig(DEFAULT_CONFIG, userConfig)
		} catch (error) {
			if (error.code === 'ENOENT') {
				// Config file doesn't exist, use defaults
				console.warn('No .flow/flow.config.mjs found, using default configuration')
				this.config = DEFAULT_CONFIG
			} else {
				throw new Error(`Failed to load config: ${error.message}`)
			}
		}

		// Validate config
		this._validate()

		// Resolve paths
		this._resolvePaths()

		return this.config
	}

	/**
	 * Get the loaded configuration
	 */
	getConfig() {
		if (!this.config) {
			throw new Error('Configuration not loaded. Call load() first.')
		}
		return this.config
	}

	/**
	 * Get agent configuration by name
	 */
	getAgent(name) {
		const agent = this.config.agents.find((a) => a.name === name)
		if (!agent) {
			throw new Error(`Agent '${name}' not found in configuration`)
		}
		return agent
	}

	/**
	 * Get flow configuration by name
	 */
	getFlow(name) {
		const flow = this.config.flows[name]
		if (!flow) {
			throw new Error(`Flow '${name}' not found in configuration`)
		}
		return flow
	}

	/**
	 * @deprecated Use getFlow() instead
	 */
	getSequence(name) {
		console.warn('getSequence() is deprecated. Use getFlow() instead.')
		return this.getFlow(name)
	}

	/**
	 * Merge user config with defaults
	 */
	_mergeConfig(defaults, user) {
		return {
			persistence: { ...defaults.persistence, ...user.persistence },
			pricing: {
				overrides: { ...(defaults.pricing?.overrides || {}), ...(user.pricing?.overrides || {}) },
			},
			flows: { ...defaults.flows, ...user.flows, ...user.sequences }, // Support old "sequences" key
			agents: user.agents || defaults.agents,
		}
	}

	/**
	 * Validate configuration
	 */
	_validate() {
		// Validate flows
		if (!this.config.flows || Object.keys(this.config.flows).length === 0) {
			throw new Error('Config must include at least one flow')
		}

		// Validate agents
		if (!this.config.agents || this.config.agents.length === 0) {
			throw new Error('Config must include at least one agent')
		}

		// Validate each agent
		for (const agent of this.config.agents) {
			if (!agent.name) {
				throw new Error('Agent must have a name')
			}
			if (!agent.model) {
				throw new Error(`Agent '${agent.name}' must have a model`)
			}
			if (!agent.max_turns || agent.max_turns < 1) {
				throw new Error(`Agent '${agent.name}' must have max_turns >= 1`)
			}

			// Validate settings if present
			if (agent.settings) {
				const { temperature, top_p, max_tokens, stop } = agent.settings
				if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
					throw new Error(`Agent '${agent.name}': temperature must be between 0 and 2`)
				}
				if (top_p !== undefined && (top_p < 0 || top_p > 1)) {
					throw new Error(`Agent '${agent.name}': top_p must be between 0 and 1`)
				}
				if (max_tokens !== undefined && max_tokens < 1) {
					throw new Error(`Agent '${agent.name}': max_tokens must be positive`)
				}
				if (stop !== undefined && (!Array.isArray(stop) || stop.length > 4)) {
					throw new Error(`Agent '${agent.name}': stop must be an array with max 4 sequences`)
				}
			}
		}

		// Validate flows reference valid agents
		for (const [flowName, flow] of Object.entries(this.config.flows)) {
			for (const agentName of flow.agents) {
				if (!this.config.agents.find((a) => a.name === agentName)) {
					throw new Error(
						`Flow '${flowName}' references unknown agent '${agentName}'`
					)
				}
			}
		}
	}

	/**
	 * Resolve relative paths to absolute
	 */
	_resolvePaths() {
		// Resolve prompt files
		// Prompts should be in user's project (.flow/prompts/)
		for (const agent of this.config.agents) {
			if (agent.prompt_file) {
				agent.prompt_file = path.resolve(this.projectRoot, agent.prompt_file)
			}
		}
	}

	/**
	 * Create default config file in .flow/flow.config.mjs
	 */
	static async createDefaultConfig(projectRoot) {
		const configPath = path.join(projectRoot, '.flow/flow.config.mjs')

		// Ensure .flow directory exists
		await fs.mkdir(path.join(projectRoot, '.flow'), { recursive: true })

		// Check if already exists
		try {
			await fs.access(configPath)
			throw new Error('.flow/flow.config.mjs already exists')
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error
			}
		}

		const configContent = `// Multi-Agent Flow Configuration
// All paths are hardcoded relative to project root:
// - .flow/prompts/       - Agent prompt files
// - .flow/checkpoints/   - Resume state
// - .flow/snapshots/     - Rollback points
// - .flow/traces/        - Execution logs
// - .flow/ratchet/       - Blessed artifacts (stories, reports, tests)

export default {
	persistence: {
		checkpoint_interval: 'every_turn',
	},

	pricing: {
		// Override model pricing (optional)
		// Defaults are loaded from agent/data/model-pricing.mjs
		// Use this if you have negotiated rates or want custom estimates
		overrides: {
			// Example:
			// 'gpt-4o': {
			//   input: 2.50,           // USD per 1M input tokens
			//   output: 10.00,          // USD per 1M output tokens
			//   context_window: 128000, // Max tokens
			// },
		},
	},

	flows: {
		development: {
			max_flow_runs: 3,
			ask_before_reflow: true,
			agents: [
				'WRITE_USER_STORIES',
				'GENERATE_CODE',
				'PLAN_TESTS',
				'GENERATE_TESTS',
				'REVIEW',
				'CLEAN_AND_REFACTOR',
				'REPORT',
			],
		},
	},

	agents: [
		{
			name: 'WRITE_USER_STORIES',
			goal: 'Convert input to structured requirements',
			model: 'gpt-4o',
			max_turns: 6,
			complete_turns: true,
			settings: {
				temperature: 0.5,  // Balanced for clear specs with some creative phrasing
			},
			mcp_tools: {
				include: ['file_ops', 'internet'],
				exclude: ['run_tests'],
			},
			prompt_file: './.flow/prompts/WRITE_USER_STORIES.md',
		},
		{
			name: 'GENERATE_CODE',
			goal: 'Write the implementation',
			model: 'gpt-4o-mini',
			max_turns: 9,
			settings: {
				temperature: 0.2,  // Low for consistent, precise code
				// top_p: 1,            // Nucleus sampling 0-1 (alternative to temperature)
				// max_tokens: 4096,    // Max output tokens
				// stop: ['---END---'], // Stop sequences (array, max 4)
			},
			mcp_tools: {
				include: ['file_ops', 'internet'],
				exclude: ['run_tests'],
			},
			prompt_file: './.flow/prompts/GENERATE_CODE.md',
		},
		{
			name: 'PLAN_TESTS',
			goal: 'Bridge the gap between stories and test code',
			model: 'gpt-4o',
			max_turns: 3,
			settings: {
				temperature: 0.3,  // Low for analytical, structured planning
			},
			mcp_tools: {
				include: ['file_ops'],
				exclude: ['run_tests'],
			},
			prompt_file: './.flow/prompts/PLAN_TESTS.md',
		},
		{
			name: 'GENERATE_TESTS',
			goal: 'Write and run the tests until they pass',
			model: 'gpt-4o-mini',
			max_turns: 12,
			settings: {
				temperature: 0.2,  // Low for precise, reproducible tests
			},
			mcp_tools: {
				include: ['file_ops', 'run_tests'],
				exclude: [],
			},
			prompt_file: './.flow/prompts/GENERATE_TESTS.md',
		},
		{
			name: 'REVIEW',
			goal: 'Audit the result before ratcheting',
			model: 'gpt-4o',
			max_turns: 3,
			is_gatekeeper: true,
			settings: {
				temperature: 0.1,  // Very low for deterministic, consistent gatekeeper decisions
			},
			mcp_tools: {
				include: ['file_ops', 'run_tests'],
				exclude: [],
			},
			prompt_file: './.flow/prompts/REVIEW.md',
		},
		{
			name: 'CLEAN_AND_REFACTOR',
			goal: 'Polish the codebase',
			model: 'gpt-4o',
			max_turns: 9,
			settings: {
				temperature: 0.3,  // Low for safe refactoring that preserves functionality
			},
			mcp_tools: {
				include: ['file_ops', 'run_tests'],
				exclude: [],
			},
			prompt_file: './.flow/prompts/CLEAN_AND_REFACTOR.md',
		},
		{
			name: 'REPORT',
			goal: 'Summarize for the human',
			model: 'gpt-4o',
			max_turns: 6,
			settings: {
				temperature: 0.5,  // Balanced for clear documentation with varied presentation
			},
			mcp_tools: {
				include: ['file_ops'],
				exclude: [],
			},
			prompt_file: './.flow/prompts/REPORT.md',
		},
	],
}
`

		await fs.writeFile(configPath, configContent, 'utf-8')
		return configPath
	}
}

