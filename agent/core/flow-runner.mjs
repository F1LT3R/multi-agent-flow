import { DockerAgentExecutor } from './docker-agent-executor.mjs'
import { CheckpointManager, createStateSnapshot, restoreStateFromSnapshot } from './checkpoint-manager.mjs'
import { DockerManager } from './docker-manager.mjs'
import { Ratchet } from './ratchet.mjs'
import { SnapshotManager } from './snapshot-manager.mjs'
import { promptForApproval } from './diff-approval.mjs'
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

		this.checkpointManager = new CheckpointManager('./.flow/checkpoints')
		this.dockerManager = new DockerManager(config)
		this.ratchet = new Ratchet()

		this.state = {
			flowName,
			flowRunCount: 0,
			currentAgentIndex: 0,
			agentResults: [],
			userInput: null,
			startTime: null,
			messageHistories: {},
			stories: {},  // Injected from ratchet
		}
	}

	/**
	 * Validate template placeholders before running agents
	 * Fails fast if any placeholder references a missing file
	 */
	async validateTemplates() {
		const RESERVED_PLACEHOLDERS = ['INTENT']  // Dynamic placeholders, not file-based
		const promptsDir = path.join(process.cwd(), '.flow/prompts')
		const commonDir = path.join(promptsDir, 'common')
		const pattern = /\{\{(\w+)\}\}/g
		const errors = []

		// Check each agent's prompt file
		for (const agent of this.config.agents) {
			// Extract filename from prompt_file path
			let promptFile = agent.prompt_file
			if (promptFile.includes('.flow/prompts/')) {
				promptFile = promptFile.split('.flow/prompts/').pop()
			} else if (promptFile.includes('prompts/')) {
				promptFile = promptFile.split('prompts/').pop()
			}
			const promptPath = path.join(promptsDir, promptFile)

			try {
				const content = await fs.readFile(promptPath, 'utf-8')
				let match
				while ((match = pattern.exec(content)) !== null) {
					const name = match[1]

					// Skip reserved dynamic placeholders
					if (RESERVED_PLACEHOLDERS.includes(name)) continue

					const commonPath = path.join(commonDir, `${name}.md`)
					try {
						await fs.access(commonPath)
					} catch {
						errors.push(`${agent.name}: placeholder {{${name}}} requires missing file: common/${name}.md`)
					}
				}
			} catch (error) {
				// Prompt file doesn't exist yet - skip validation
				// (cli.mjs will copy templates during init)
			}
		}

		if (errors.length > 0) {
			throw new Error(`Template validation failed:\n${errors.join('\n')}`)
		}
	}

	/**
	 * Run the flow
	 */
	async run(userInput, runId = null) {
		// Validate templates before anything else
		await this.validateTemplates()

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

		// Prepare ratchet (copy tests, read stories) BEFORE Docker starts
		const isNewRun = !runId || this.state.flowRunCount === 0
		const ratchetPrep = await this.ratchet.prepareRun(isNewRun)
		this.state.stories = ratchetPrep.stories

		// Start Docker container (always required)
		console.log(chalk.cyan('\n[Docker] Starting container...'))
		try {
			await this.dockerManager.startContainer()
			await this.dockerManager.waitForHealthy()

			// Run security checks before running agents
			await this._runSecurityChecks()
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

				// Check for test file changes that need approval
				const newTestFiles = await this.ratchet.findNewTestFiles()
				if (newTestFiles.length > 0) {
					// Prompt user to approve test changes
					const decisions = await promptForApproval(
						newTestFiles,
						this.ratchet.testsRatchet,
						this.ratchet.projectRoot
					)
					await this.ratchet.finalizeWithApprovals(decisions)
				} else {
					// No new test files - just ratchet existing tests
					await this.ratchet.finalizeSuccess()
				}

				// Create snapshot of successful run
				try {
					console.log(chalk.cyan('\nCreating snapshot of successful run...'))
					const snapshotManager = new SnapshotManager('./.flow/snapshots')
					const snapshotTimestamp = await snapshotManager.createSnapshot()
					console.log(chalk.green(`✓ Snapshot created: ${snapshotTimestamp}`))
				} catch (error) {
					console.error(chalk.red(`✗ Failed to create snapshot: ${error.message}`))
					console.error(chalk.gray('Stack trace:'))
					console.error(error.stack)
					console.error(chalk.gray('Continuing without snapshot...'))
				}

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
			// Stop Docker container
			// On failure: keep container for investigation
			// On success: clean up container
			if (flowSuccess) {
				console.log(chalk.cyan('\n[Docker] Stopping container...'))
				try {
					await this.dockerManager.stopContainer()
				} catch (error) {
					console.error(chalk.yellow('[Docker] Error stopping container:'), error.message)
				}
			} else {
				console.log(chalk.yellow('\n[Docker] Keeping container for investigation...'))
				console.log(chalk.gray(`  Container: ${this.dockerManager.containerName}`))
				console.log(chalk.gray(`  Inspect: docker exec -it ${this.dockerManager.containerName} sh`))
				console.log(chalk.gray(`  Logs: docker logs ${this.dockerManager.containerName}`))
				console.log(chalk.gray(`  Stop: docker stop ${this.dockerManager.containerName} && docker rm ${this.dockerManager.containerName}`))
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
		// Tools now run directly inside the VM - no HTTP MCP servers needed!
		const executor = new DockerAgentExecutor(
			agentConfig,
			this.dockerManager,
			{
				flowRunCount: this.state.flowRunCount,
				tracesDir: './.flow/traces',
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

			// WRITE_USER_STORIES agent: Orchestrator saves the stories
			if (agentName === 'WRITE_USER_STORIES' && result.finalMessage) {
				await this._saveStoryFiles(result.finalMessage)
			}

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
		// First agent gets the original user input with injected stories
		if (agentIndex === 0) {
			let input = this.state.userInput

			// Inject previous stories from ratchet if available
			if (this.state.stories && Object.keys(this.state.stories).length > 0) {
				let storiesSection = `## PREVIOUS STORIES (from ratchet)\n\n`
				for (const [name, content] of Object.entries(this.state.stories)) {
					storiesSection += `### ${name}\n${content}\n\n`
				}
				storiesSection += `---\n\n`
				input = storiesSection + input
			}

			return input
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
	 * Reports are saved to .flow/ratchet/reports/
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

		// Ensure reports directory exists in ratchet
		const reportsDir = path.join(process.cwd(), '.flow/ratchet/reports')
		await fs.mkdir(reportsDir, { recursive: true })

		// Save to LAST_RUN_REPORT.md (canonical version)
		const lastRunPath = path.join(reportsDir, 'LAST_RUN_REPORT.md')
		await fs.writeFile(lastRunPath, reportContent, 'utf-8')

		// Save to timestamped archive
		const archivedPath = path.join(reportsDir, `${timestamp}_REPORT_r${runNumber}.md`)
		await fs.writeFile(archivedPath, reportContent, 'utf-8')

		console.log(chalk.green(`\n[Orchestrator] Report saved:`))
		console.log(chalk.gray(`  - ${lastRunPath}`))
		console.log(chalk.gray(`  - ${archivedPath}`))
	}

	/**
	 * Save WRITE_USER_STORIES agent output to ratchet (orchestrator responsibility)
	 * Stories are saved to .flow/ratchet/stories/
	 */
	async _saveStoryFiles(storyContent) {
		const storiesDir = path.join(process.cwd(), '.flow/ratchet/stories')
		await fs.mkdir(storiesDir, { recursive: true })

		// Save to USER_STORIES.md (canonical version)
		const storyPath = path.join(storiesDir, 'USER_STORIES.md')
		await fs.writeFile(storyPath, storyContent, 'utf-8')

		console.log(chalk.green(`\n[Orchestrator] Stories saved: ${storyPath}`))
	}

	/**
	 * Run comprehensive security checks before executing agents
	 * SECURITY: Validates VM isolation with active escape tests
	 * All checks must pass or the container is immediately terminated
	 */
	async _runSecurityChecks() {
		const W = 44 // Inner width
		const line = (content) => `║${content.padEnd(W)}║`
		const divider = () => `╠${'═'.repeat(W)}╣`

		const logCheck = (id, name, passed) => {
			const status = passed ? 'PASS' : 'FAIL'
			// Build row without colors first, then colorize after padding
			const row = `  ${id}  ${name.padEnd(26)}${status}  `.padEnd(W)
			const colored = passed
				? row.replace(status, chalk.green(status))
				: row.replace(status, chalk.red(status))
			console.log(`║${colored}║`)
		}

		// Box top
		console.log(chalk.cyan.bold(`\n╔${'═'.repeat(W)}╗`))
		console.log(chalk.cyan.bold(line('           SECURITY VALIDATION              ')))
		console.log(chalk.cyan.bold(divider()))

		// SEC-01: Container running
		let inspect
		try {
			inspect = await this.dockerManager.container.inspect()
			logCheck('SEC-01', 'Container running', inspect.State.Running)
			if (!inspect.State.Running) {
				await this._securityFailure('SEC-01', 'Container is not running')
			}
		} catch (error) {
			logCheck('SEC-01', 'Container running', false)
			await this._securityFailure('SEC-01', error.message)
		}

		// SEC-02: Mount /project verified
		const mount = inspect.Mounts.find(m => m.Destination === '/project')
		const mountValid = !!mount && mount.RW
		logCheck('SEC-02', 'Mount /project', mountValid)
		if (!mountValid) {
			await this._securityFailure('SEC-02', 'Mount /project missing or not writable')
		}

		// SEC-03 to SEC-07: Active escape tests (run inside container)
		const escapeTests = [
			{ id: 'SEC-03', name: 'Absolute path blocked', path: '/tmp/escape.txt', shouldFail: true },
			{ id: 'SEC-04', name: 'Parent traversal', path: '../escape.txt', shouldFail: true },
			{ id: 'SEC-05', name: 'Nested traversal', path: 'a/b/../../../escape.txt', shouldFail: true },
			{ id: 'SEC-06', name: 'Protected dir (.flow/)', path: '.flow/breach.txt', shouldFail: true },
			{ id: 'SEC-07', name: 'Valid write allowed', path: '.security-check-temp.txt', shouldFail: false },
		]

		for (const test of escapeTests) {
			const result = await this._testWriteEscape(test.path)
			const passed = test.shouldFail ? !result.success : result.success
			logCheck(test.id, test.name, passed)

			if (!passed) {
				await this._securityFailure(test.id, `Write escape ${test.shouldFail ? 'succeeded' : 'failed'} with path "${test.path}"`)
			}
		}

		// Cleanup temp file from SEC-07
		await this._cleanupSecurityTestFile('.security-check-temp.txt')

		// Success footer with spacing
		console.log(chalk.cyan.bold(divider()))
		console.log(chalk.cyan.bold(line('')))
		console.log(chalk.green.bold(line('          ALL CHECKS PASSED                 ')))
		console.log(chalk.green.bold(line('             Agents OK                      ')))
		console.log(chalk.cyan.bold(line('')))
		console.log(chalk.cyan.bold(`╚${'═'.repeat(W)}╝\n`))
	}

	/**
	 * Handle security check failure - terminate container and throw
	 */
	async _securityFailure(checkId, reason) {
		const W = 44
		const line = (content) => `║${content.padEnd(W)}║`
		const divider = () => `╠${'═'.repeat(W)}╣`

		console.log(chalk.red.bold(divider()))
		console.log(chalk.red.bold(line('')))
		console.log(chalk.red.bold(line('        Container terminated.               ')))
		console.log(chalk.red.bold(line(`        ${reason.substring(0, 34)}`)))
		console.log(chalk.red.bold(line('')))
		console.log(chalk.red.bold(`╚${'═'.repeat(W)}╝`))

		try {
			await this.dockerManager.stopContainer()
		} catch (err) {
			// Ignore errors during emergency shutdown
		}

		throw new Error(`SECURITY BREACH: ${checkId} failed - ${reason}. Container terminated.`)
	}

	/**
	 * Test if a write to the given path succeeds or is blocked
	 * Runs the actual vm-tools write_file inside the container
	 */
	async _testWriteEscape(testPath) {
		// Escape the path for use in the script
		const escapedPath = testPath.replace(/'/g, "\\'")
		const script = `
			import { callTool } from '/workspace/agent/vm-tools/index.mjs';
			try {
				await callTool('write_file', { path: '${escapedPath}', content: 'SECURITY_TEST' });
				console.log('SUCCESS');
			} catch (e) {
				console.log('BLOCKED:' + e.message);
			}
		`.replace(/\n/g, ' ').replace(/\t/g, ' ')

		try {
			const result = await this.dockerManager.exec(`node --input-type=module -e "${script}"`)
			return {
				success: result.includes('SUCCESS'),
				error: result.includes('BLOCKED:') ? result.split('BLOCKED:')[1].trim() : null
			}
		} catch (error) {
			return {
				success: false,
				error: error.message
			}
		}
	}

	/**
	 * Cleanup the security test temp file
	 */
	async _cleanupSecurityTestFile(fileName) {
		try {
			const script = `
				import { callTool } from '/workspace/agent/vm-tools/index.mjs';
				try {
					await callTool('delete_file', { path: '${fileName}' });
					console.log('CLEANED');
				} catch (e) {
					console.log('SKIP');
				}
			`.replace(/\n/g, ' ').replace(/\t/g, ' ')

			await this.dockerManager.exec(`node --input-type=module -e "${script}"`)
		} catch (error) {
			// Ignore cleanup errors
		}
	}
}

