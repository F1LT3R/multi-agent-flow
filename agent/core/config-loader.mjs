import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'

/**
 * Default configuration based on VISION.md
 */
export const DEFAULT_CONFIG = {
	paths: {
		plans: './plans',
		project: './project',
		prompts: './prompts',
		tests: './tests',
		artifacts: './tests/artifacts',
	},
	persistence: {
		checkpoint_interval: 'every_turn',
		log_dir: './.agent-flow/logs',
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
			mcp_tools: {
				include: ['file_ops', 'internet'],
				exclude: ['run_tests'],
			},
			prompt_file: './prompts/WRITE_USER_STORIES.md',
		},
		{
			name: 'GENERATE_CODE',
			goal: 'Write the implementation',
			model: 'gpt-4o-mini',
			max_turns: 9,
			mcp_tools: {
				include: ['file_ops', 'internet'],
				exclude: ['run_tests'],
			},
			prompt_file: './prompts/GENERATE_CODE.md',
		},
		{
			name: 'PLAN_TESTS',
			goal: 'Bridge the gap between stories and test code',
			model: 'gpt-4o',
			max_turns: 3,
			mcp_tools: {
				include: ['file_ops'],
				exclude: ['run_tests'],
			},
			prompt_file: './prompts/PLAN_TESTS.md',
		},
		{
			name: 'GENERATE_TESTS',
			goal: 'Write and run the tests until they pass',
			model: 'gpt-4o-mini',
			max_turns: 12,
			mcp_tools: {
				include: ['file_ops', 'run_tests'],
				exclude: [],
			},
			prompt_file: './prompts/GENERATE_TESTS.md',
		},
		{
			name: 'REVIEW',
			goal: 'Audit the result before ratcheting',
			model: 'gpt-4o',
			max_turns: 3,
			is_gatekeeper: true,
			mcp_tools: {
				include: ['file_ops', 'run_tests'],
				exclude: [],
			},
			prompt_file: './prompts/REVIEW.md',
		},
		{
			name: 'CLEAN_AND_REFACTOR',
			goal: 'Polish the codebase',
			model: 'gpt-4o',
			max_turns: 9,
			mcp_tools: {
				include: ['file_ops', 'run_tests'],
				exclude: [],
			},
			prompt_file: './prompts/CLEAN_AND_REFACTOR.md',
		},
		{
			name: 'REPORT',
			goal: 'Summarize for the human',
			model: 'gpt-4o',
			max_turns: 6,
			mcp_tools: {
				include: ['file_ops'],
				exclude: [],
			},
			prompt_file: './prompts/REPORT.md',
		},
	],
}

/**
 * Configuration Loader
 * Loads and validates agent-flow.config.mjs
 */
export class ConfigLoader {
	constructor(projectRoot = process.cwd()) {
		this.projectRoot = projectRoot
		this.config = null
	}

	/**
	 * Load configuration from agent-flow.config.mjs
	 */
	async load() {
		const configPath = path.join(this.projectRoot, 'agent-flow.config.mjs')

		try {
			// Check if config file exists
			await fs.access(configPath)

			// Load the config file
			const configUrl = pathToFileURL(configPath).href
			const module = await import(configUrl)
			const userConfig = module.default || module

			// Merge with defaults
			this.config = this._mergeConfig(DEFAULT_CONFIG, userConfig)
		} catch (error) {
			if (error.code === 'ENOENT') {
				// Config file doesn't exist, use defaults
				console.warn('No agent-flow.config.mjs found, using default configuration')
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
	 * Get sequence configuration by name
	 */
	getSequence(name) {
		const sequence = this.config.sequences[name]
		if (!sequence) {
			throw new Error(`Sequence '${name}' not found in configuration`)
		}
		return sequence
	}

	/**
	 * Merge user config with defaults
	 */
	_mergeConfig(defaults, user) {
		return {
			paths: { ...defaults.paths, ...user.paths },
			persistence: { ...defaults.persistence, ...user.persistence },
			sequences: { ...defaults.sequences, ...user.sequences },
			agents: user.agents || defaults.agents,
		}
	}

	/**
	 * Validate configuration
	 */
	_validate() {
		// Validate paths
		if (!this.config.paths) {
			throw new Error('Config must include paths')
		}

		// Validate sequences
		if (!this.config.sequences || Object.keys(this.config.sequences).length === 0) {
			throw new Error('Config must include at least one sequence')
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
		}

		// Validate sequences reference valid agents
		for (const [seqName, sequence] of Object.entries(this.config.sequences)) {
			for (const agentName of sequence.agents) {
				if (!this.config.agents.find((a) => a.name === agentName)) {
					throw new Error(
						`Sequence '${seqName}' references unknown agent '${agentName}'`
					)
				}
			}
		}
	}

	/**
	 * Resolve relative paths to absolute
	 */
	_resolvePaths() {
		for (const [key, value] of Object.entries(this.config.paths)) {
			this.config.paths[key] = path.resolve(this.projectRoot, value)
		}

		// Resolve prompt files
		for (const agent of this.config.agents) {
			if (agent.prompt_file) {
				agent.prompt_file = path.resolve(this.projectRoot, agent.prompt_file)
			}
		}
	}

	/**
	 * Create default config file
	 */
	static async createDefaultConfig(projectRoot) {
		const configPath = path.join(projectRoot, 'agent-flow.config.mjs')

		// Check if already exists
		try {
			await fs.access(configPath)
			throw new Error('agent-flow.config.mjs already exists')
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error
			}
		}

		const configContent = `export default ${JSON.stringify(DEFAULT_CONFIG, null, '\t')}`

		await fs.writeFile(configPath, configContent, 'utf-8')
		return configPath
	}
}

