import { AgentExecutor } from './agent-executor.mjs'
import { MCPClient } from './mcp-client.mjs'
import { CheckpointManager, createStateSnapshot, restoreStateFromSnapshot } from './checkpoint-manager.mjs'
import { DockerManager } from './docker-manager.mjs'
import readline from 'readline'
import chalk from 'chalk'

/**
 * Flow Runner
 * Orchestrates the agent sequence with reflow logic
 */
export class FlowRunner {
	constructor(config, sequenceName = 'development') {
		this.config = config
		this.sequenceName = sequenceName
		this.sequence = config.sequences[sequenceName]
		
		if (!this.sequence) {
			throw new Error(`Sequence '${sequenceName}' not found in configuration`)
		}

		this.mcpClient = new MCPClient()
		this.checkpointManager = new CheckpointManager(
			this.config.paths.checkpointDir || './.agent-flow/checkpoints'
		)
		this.dockerManager = new DockerManager(config)
		this.useDocker = process.env.SKIP_DOCKER !== 'true'
		
		this.state = {
			sequenceName,
			flowRunCount: 0,
			currentAgentIndex: 0,
			agentResults: [],
			userInput: null,
			startTime: null,
			messageHistories: {},
		}
	}

	/**
	 * Run the flow
	 */
	async run(userInput, runId = null) {
		// Initialize
		await this.checkpointManager.initialize()

		// Load from checkpoint if resuming
		if (runId) {
			console.log(`[FlowRunner] Resuming from checkpoint: ${runId}`)
			const savedState = await this.checkpointManager.load(runId)
			this.state = restoreStateFromSnapshot(savedState)
		} else {
			this.state.userInput = userInput
			this.state.startTime = new Date().toISOString()
			runId = CheckpointManager.generateRunId()
		}

		console.log(chalk.blue.bold(`[FlowRunner] Starting flow: ${this.sequenceName}`))
		console.log(chalk.blue(`[FlowRunner] Run ID: ${runId}`))

		// Start Docker container if enabled
		if (this.useDocker) {
			console.log(chalk.cyan('\n[Docker] Starting container...'))
			try {
				await this.dockerManager.startContainer()
				await this.dockerManager.waitForHealthy()
			} catch (error) {
				console.error(chalk.red('[Docker] Failed to start container:'), error.message)
				throw error
			}
		}

		let flowSuccess = false

		try {
			// Flow run loop (handles reflows)
			while (this.state.flowRunCount < this.sequence.max_flow_runs) {
			this.state.flowRunCount++
			console.log(`\n[FlowRunner] Flow Run ${this.state.flowRunCount}/${this.sequence.max_flow_runs}`)

			const flowResult = await this._executeFlow(runId)

			// Check if we need to reflow
			if (flowResult.reflow) {
				console.log(`\n[FlowRunner] Review rejected. Reflow required.`)

				// Ask user if configured
				if (this.sequence.ask_before_reflow) {
					const shouldContinue = await this._askUserToReflow()
					if (!shouldContinue) {
						console.log('[FlowRunner] User declined reflow. Stopping.')
						break
					}
				}

				// Reset to beginning but preserve context
				this.state.currentAgentIndex = 0
				this.state.agentResults = []

				console.log('[FlowRunner] Starting new flow run...')
				continue
			}

				// Flow completed successfully
				console.log(chalk.green.bold('\n[FlowRunner] Flow completed successfully!'))
				flowSuccess = true
				return {
					success: true,
					flowRunCount: this.state.flowRunCount,
					results: this.state.agentResults,
				}
			}

			// Max flow runs reached
			console.error(chalk.red(`\n[FlowRunner] Max flow runs (${this.sequence.max_flow_runs}) reached.`))
			return {
				success: false,
				flowRunCount: this.state.flowRunCount,
				results: this.state.agentResults,
				reason: 'max_flow_runs_exceeded',
			}
		} finally {
			// Stop Docker container if enabled
			if (this.useDocker) {
				console.log(chalk.cyan('\n[Docker] Stopping container...'))
				try {
					await this.dockerManager.stopContainer()
				} catch (error) {
					console.error(chalk.yellow('[Docker] Error stopping container:'), error.message)
				}
			}
		}
	}

	/**
	 * Execute the agent sequence
	 */
	async _executeFlow(runId) {
		const agentNames = this.sequence.agents

		// Start from current agent index (for resuming)
		for (let i = this.state.currentAgentIndex; i < agentNames.length; i++) {
			this.state.currentAgentIndex = i
			const agentName = agentNames[i]
			const agentConfig = this.config.agents.find((a) => a.name === agentName)

			if (!agentConfig) {
				throw new Error(`Agent '${agentName}' not found in configuration`)
			}

			console.log(chalk.blue(`\n${'='.repeat(60)}`))
			console.log(chalk.blue.bold(`Agent: ${agentName}`))
			console.log(chalk.blue(`Goal: ${agentConfig.goal}`))
			console.log(chalk.blue(`${'='.repeat(60)}\n`))

			// Prepare input for agent
			const agentInput = this._prepareAgentInput(agentName, i)

			// Execute agent with streaming callbacks
			const executor = new AgentExecutor(agentConfig, this.mcpClient, {
				flowRunCount: this.state.flowRunCount,
				tracesDir: this.config.paths.traces,
				callbacks: this._createCallbacks(agentName),
			})
			const result = await executor.execute(agentInput)

			// Save result
			result.agentName = agentName
			result.tokenUsage = executor.getTokenUsage()
			this.state.agentResults.push(result)

			// Save message history for potential reflow
			this.state.messageHistories[agentName] = executor.getMessages()

			// Checkpoint after each agent
			if (this.config.persistence?.checkpoint_interval === 'every_turn') {
				await this.checkpointManager.save(runId, createStateSnapshot(this.state))
			}

			// Check for gatekeeper rejection (triggers reflow)
			if (agentConfig.is_gatekeeper && result.finalMessage) {
				if (result.finalMessage.includes('STATUS: REJECTED')) {
					return { reflow: true, reason: 'gatekeeper_rejected' }
				}
			}

			// Display agent summary
			this._displayAgentSummary(result)
		}

		return { reflow: false }
	}

	/**
	 * Prepare input for agent based on previous results
	 */
	_prepareAgentInput(agentName, agentIndex) {
		// First agent gets the original user input
		if (agentIndex === 0) {
			return this.state.userInput
		}

		// Subsequent agents get context from previous agents
		const previousResults = this.state.agentResults
		let context = `Original User Request:\n${this.state.userInput}\n\n`

		// Add relevant previous agent outputs
		for (const result of previousResults) {
			if (result.finalMessage) {
				context += `\n--- ${result.agentName} Output ---\n${result.finalMessage}\n`
			}
		}

		// The agent's prompt file defines its specific task
		// No need to inject task descriptions here
		return context
	}

	/**
	 * Create streaming callbacks for real-time output
	 */
	_createCallbacks(agentName) {
		return {
			onTurnStart: (agent, turn) => {
				console.log(chalk.cyan(`\n▶ Turn ${turn}`))
			},
			onThinking: (text) => {
				// Stream agent thinking in gray
				process.stdout.write(chalk.gray(text))
			},
			onToolCall: (name, args) => {
				console.log(chalk.yellow(`\n🔧 ${name}(${JSON.stringify(args).substring(0, 100)}...)`))
			},
			onToolResult: (name, result, success) => {
				if (success) {
					console.log(chalk.green(`✓ ${name} completed`))
				} else {
					console.log(chalk.red(`✗ ${name} failed`))
				}
			},
			onTurnComplete: (agent, turn, result) => {
				if (result.tokenUsage) {
					console.log(chalk.gray(`\n📊 Tokens: ${result.tokenUsage.total_tokens || result.tokenUsage.total || 0}`))
				}
			},
		}
	}

	/**
	 * Display agent summary
	 */
	_displayAgentSummary(result) {
		console.log(chalk.cyan(`\n--- Agent Summary ---`))
		console.log(`Turns used: ${result.turns.length}`)
		console.log(`Success: ${result.success ? chalk.green('✓') : chalk.red('✗')}`)
		
		if (result.tokenUsage) {
			console.log(
				`Tokens: ${result.tokenUsage.prompt_tokens || result.tokenUsage.prompt || 0} prompt + ${result.tokenUsage.completion_tokens || result.tokenUsage.completion || 0} completion = ${result.tokenUsage.total_tokens || result.tokenUsage.total || 0} total`
			)
		}

		if (result.error) {
			console.error(chalk.red(`Error: ${result.error}`))
		}

		console.log(``)
	}

	/**
	 * Ask user if they want to reflow
	 */
	async _askUserToReflow() {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		})

		return new Promise((resolve) => {
			rl.question(
				'\nThe REVIEW agent rejected the implementation. Start a new flow run? (y/n): ',
				(answer) => {
					rl.close()
					resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
				}
			)
		})
	}
}

