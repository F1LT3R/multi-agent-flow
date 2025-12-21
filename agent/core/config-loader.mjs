import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'

// Single source of truth for default configuration
import DEFAULT_CONFIG from './flow.config.sample.mjs'
export { DEFAULT_CONFIG }

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

			// Validate tool_mode if present
			if (agent.tool_mode && !['native', 'prompt', 'auto'].includes(agent.tool_mode)) {
				throw new Error(`Agent '${agent.name}': tool_mode must be 'native', 'prompt', or 'auto'`)
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
	 * Copies the sample config from agent/core/flow.config.sample.mjs
	 */
	static async createDefaultConfig(projectRoot) {
		const destPath = path.join(projectRoot, '.flow/flow.config.mjs')

		// Ensure .flow directory exists
		await fs.mkdir(path.join(projectRoot, '.flow'), { recursive: true })

		// Check if already exists
		try {
			await fs.access(destPath)
			throw new Error('.flow/flow.config.mjs already exists')
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error
			}
		}

		// Copy sample config (single source of truth)
		const samplePath = new URL('./flow.config.sample.mjs', import.meta.url).pathname
		await fs.copyFile(samplePath, destPath)
		return destPath
	}
}

