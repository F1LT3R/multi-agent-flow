import { AgentExecutor } from './agent-executor.mjs'
import { DockerAgentExecutor } from './docker-agent-executor.mjs'
import { MCPClient } from './mcp-client.mjs'
import { CheckpointManager, createStateSnapshot, restoreStateFromSnapshot } from './checkpoint-manager.mjs'
import { DockerManager } from './docker-manager.mjs'
import readline from 'readline'
import chalk from 'chalk'
import fs from 'fs/promises'
import path from 'path'

/**
 * Flow Runner
 * Orchestrates the agent flow with reflow logic
 */
export class FlowRunner {
	constructor(config, flowName = 'development') {
		this.config = config
		this.flowName = flowName
		this.flow = config.flows[flowName]

		if (!this.flow) {
			throw new Error(`Flow '${flowName}' not found in configuration`)
		}

		this.mcpClient = new MCPClient()
		this.checkpointManager = new CheckpointManager(
			this.config.persistence.checkpoints || './.flow/logs/checkpoints'
		)
		this.dockerManager = new DockerManager(config)

		this.state = {
			flowName,
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

		console.log(chalk.blue.bold(`[FlowRunner] Starting flow: ${this.flowName}`))
		console.log(chalk.blue(`[FlowRunner] Run ID: ${runId}`))

		// Start Docker container (always required)
		console.log(chalk.cyan('\n[Docker] Starting container...'))
		try {
			await this.dockerManager.startContainer()
			await this.dockerManager.waitForHealthy()

			// Validate VM isolation before running agents
			await this._validateVMIsolation()
		} catch (error) {
			console.error(chalk.red('[Docker] Failed to start container:'), error.message)
			throw error
		}

		let flowSuccess = false

		try {
		// Flow run loop (handles reflows)
		while (this.state.flowRunCount < this.flow.max_flow_runs) {
			this.state.flowRunCount++
			console.log(`\n[FlowRunner] Flow Run ${this.state.flowRunCount}/${this.flow.max_flow_runs}`)

			const flowResult = await this._executeFlow(runId)

			// Check if we need to reflow
			if (flowResult.reflow) {
				console.log(`\n[FlowRunner] Review rejected. Reflow required.`)

			// Ask user if configured (unless auto-approve is set)
			if (this.flow.ask_before_reflow && process.env.AUTO_APPROVE !== 'true') {
				const shouldContinue = await this._askUserToReflow()
					if (!shouldContinue) {
						console.log('[FlowRunner] User declined reflow. Stopping.')
						break
					}
				} else if (process.env.AUTO_APPROVE === 'true') {
					console.log(chalk.yellow('[FlowRunner] Auto-approving reflow (non-interactive mode)'))
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
		console.error(chalk.red(`\n[FlowRunner] Max flow runs (${this.flow.max_flow_runs}) reached.`))
			return {
				success: false,
				flowRunCount: this.state.flowRunCount,
				results: this.state.agentResults,
				reason: 'max_flow_runs_exceeded',
			}
		} finally {
			// Stop Docker container (always required)
			console.log(chalk.cyan('\n[Docker] Stopping container...'))
			try {
				await this.dockerManager.stopContainer()
			} catch (error) {
				console.error(chalk.yellow('[Docker] Error stopping container:'), error.message)
			}
		}
	}

	/**
	 * Execute the agent flow
	 */
	async _executeFlow(runId) {
		const agentNames = this.flow.agents

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

		// Execute agent inside Docker VM for maximum isolation
		const mcpServerPorts = {
			fileOps: process.env.MCP_FILE_OPS_PORT || 3100,
			testRunner: process.env.MCP_TEST_RUNNER_PORT || 3101,
			analysis: process.env.MCP_ANALYSIS_PORT || 3102,
			internet: process.env.MCP_INTERNET_PORT || 3103,
		}

		const executor = new DockerAgentExecutor(
			agentConfig,
			this.dockerManager,
			mcpServerPorts,
			{
				flowRunCount: this.state.flowRunCount,
				tracesDir: this.config.paths.traces,
				callbacks: this._createCallbacks(agentName),
				pricingOverrides: this.config.pricing?.overrides || {},
			}
		)
		const result = await executor.execute(agentInput)

			// Save result
			result.agentName = agentName
			result.tokenUsage = executor.getTokenUsage()
			this.state.agentResults.push(result)

			// Save message history for potential reflow
			this.state.messageHistories[agentName] = executor.getMessages()

			// REPORT agent: Orchestrator saves the report files
			if (agentName === 'REPORT' && result.finalMessage) {
				await this._saveReportFiles(result.finalMessage)
			}

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
		await this._displayAgentSummary(result)
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
	async _displayAgentSummary(result) {
	console.log(chalk.cyan(`\n--- Agent Summary ---`))
	console.log(`Turns used: ${result.turns.length}`)
	console.log(`Success: ${result.success ? chalk.green('✓') : chalk.red('✗')}`)

	if (result.tokenUsage) {
		const promptTokens = result.tokenUsage.prompt_tokens || result.tokenUsage.prompt || 0
		const completionTokens = result.tokenUsage.completion_tokens || result.tokenUsage.completion || 0
		const totalTokens = result.tokenUsage.total_tokens || result.tokenUsage.total || 0
		
		console.log(
			`Tokens: ${promptTokens} in + ${completionTokens} out = ${totalTokens} total`
		)
		
		// Calculate and display cost
		const { getCost, getContextPercent } = await import('../data/model-pricing.mjs')
		const pricingOverrides = this.config.pricing?.overrides || {}
		const costData = getCost(result.model, promptTokens, completionTokens, pricingOverrides)
		
		// Calculate max context used
		let maxContextPct = 0
		if (result.turns) {
			for (const turn of result.turns) {
				if (turn.contextPercent > maxContextPct) {
					maxContextPct = turn.contextPercent
				}
			}
		}
		
		console.log(
			`Cost: $${costData.input_cost.toFixed(4)} in + $${costData.output_cost.toFixed(4)} out = $${costData.total_cost.toFixed(4)} total`
		)
		if (maxContextPct > 0) {
			console.log(`Max Context: ${maxContextPct.toFixed(1)}%`)
		}
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

	/**
	 * Save REPORT agent output to files (orchestrator responsibility)
	 */
	async _saveReportFiles(reportContent) {
		const now = new Date()
		const datePart = [
			now.getFullYear(),
			String(now.getMonth() + 1).padStart(2, '0'),
			String(now.getDate()).padStart(2, '0')
		].join('-')

		const timePart = [
			String(now.getHours()).padStart(2, '0'),
			String(now.getMinutes()).padStart(2, '0'),
			String(now.getSeconds()).padStart(2, '0')
		].join('-')

		const timestamp = `${datePart}_${timePart}`
		const runNumber = this.state.flowRunCount

		// Ensure stories directory exists
		const storiesDir = path.join(process.cwd(), 'stories')
		await fs.mkdir(storiesDir, { recursive: true })

		// Save to LAST_RUN_REPORT.md (canonical version)
		const lastRunPath = path.join(storiesDir, 'LAST_RUN_REPORT.md')
		await fs.writeFile(lastRunPath, reportContent, 'utf-8')

		// Save to timestamped archive
		const archivedPath = path.join(storiesDir, `${timestamp}_REPORT_r${runNumber}.md`)
		await fs.writeFile(archivedPath, reportContent, 'utf-8')

		console.log(chalk.green(`\n[Orchestrator] Report saved:`))
		console.log(chalk.gray(`  - ${lastRunPath}`))
		console.log(chalk.gray(`  - ${archivedPath}`))
	}

	/**
	 * Validate VM isolation before executing agents
	 * SECURITY: Ensures Docker mounts are configured correctly
	 */
	async _validateVMIsolation() {
		console.log(chalk.cyan('[Security] Validating VM isolation...'))

		try {
			// Test 1: Verify container is running
			const inspect = await this.dockerManager.container.inspect()
			if (!inspect.State.Running) {
				throw new Error('Container is not running')
			}

		// Test 2: Verify mounts are present
		const mounts = inspect.Mounts
	const requiredMounts = [
		{ path: '/project', mode: 'rw' },            // User project root
	]

		for (const required of requiredMounts) {
			const mount = mounts.find(m => m.Destination === required.path)
			if (!mount) {
				throw new Error(`Missing mount: ${required.path}`)
			}
			if (!mount.RW && required.mode === 'rw') {
				throw new Error(`Mount ${required.path} should be writable but is read-only`)
			}
			if (mount.RW && required.mode === 'ro') {
				throw new Error(`Mount ${required.path} should be read-only but is writable`)
			}
		}

	console.log(chalk.green('[Security] ✓ VM isolation validated'))
	console.log(chalk.gray(`  - User project: /project (Read-Write)`))
	console.log(chalk.gray(`  - Agent code: /workspace/agent (Built-in, isolated)`))
		} catch (error) {
			console.error(chalk.red('[Security] VM isolation validation failed:'), error.message)
			throw new Error(`VM isolation validation failed: ${error.message}`)
		}
	}
}

