import path from 'path'
import { minimatch } from 'minimatch'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'

/**
 * Docker Agent Executor
 * Executes agents INSIDE the Docker VM for maximum isolation
 *
 * This executor builds and executes an agent script inside the Docker container,
 * ensuring that all AI provider calls and logic run in an isolated environment.
 *
 * Traces are written directly by the VM to /project/.flow/traces/ to avoid
 * JSON serialization limits when passing data back to the host.
 */
export class DockerAgentExecutor {
	constructor(agentConfig, dockerManager, options = {}) {
		this.agentConfig = agentConfig
		this.dockerManager = dockerManager
		this.options = options
		this.flowRunCount = options.flowRunCount || 1
		this.callbacks = options.callbacks || {}
		this.messages = []
		this.totalTokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
	}

	/**
	 * Execute the agent inside the Docker VM
	 */
	async execute(userInput) {
		console.log(`[${this.agentConfig.name}] Executing inside Docker VM...`)

		// Build the execution script
		const script = await this._buildExecutionScript(userInput)

		// Write script to container (in /workspace/agent so node_modules can be resolved)
		const scriptPath = `/workspace/agent/temp-script-${Date.now()}.mjs`
		await this._writeScriptToContainer(scriptPath, script)

	// Execute script in container with real-time streaming
	try {
		const chalk = (await import('chalk')).default
		const { marked } = await import('marked')
		const { default: TerminalRenderer } = await import('marked-terminal')

		// Configure marked for terminal rendering
		marked.setOptions({
			renderer: new TerminalRenderer({
				code: chalk.yellow,
				blockquote: chalk.gray.italic,
				heading: chalk.cyan.bold,
				list: chalk.white,
				listitem: chalk.white,
				strong: chalk.bold,
				em: chalk.italic,
				codespan: chalk.yellow,
			})
		})

		// Accumulate output into buffers for proper markdown rendering
		let agentOutput = ''
		const statusLines = []

		const output = await this.dockerManager.execStreaming(
			`node ${scriptPath}`,
			{
			onStderr: (line) => {
				// Classify line as status or agent output
				if (line.startsWith('[Turn') ||
					line.startsWith('🔧') ||
					line.startsWith('✓') ||
					line.startsWith('✗') ||
					line.startsWith('📊') ||
					line.startsWith('💰') ||
					line.startsWith('--- Test Output ---') ||
					line === '---' ||
					line.startsWith('[Templating]') ||
					line.startsWith('[Constraints]')) {
					// Status line - store with type for later rendering
					statusLines.push(line)

					// Render any accumulated agent output before status
					if (agentOutput.trim()) {
						console.log(marked(agentOutput))
						agentOutput = ''
					}

					// Display status line immediately with appropriate styling
					if (line.startsWith('[Turn')) {
						console.log(chalk.cyan(`\n▶ ${line}`))
					} else if (line.startsWith('✗')) {
						console.log(chalk.red(line))
					} else if (line.startsWith('💰')) {
						console.log(chalk.yellow(line))
					} else {
						console.log(chalk.gray(line))
					}
				} else {
					// Agent thinking/markdown content - accumulate
					agentOutput += line + '\n'
				}
			}
			}
		)

		// Render any remaining agent output as markdown block
		if (agentOutput.trim()) {
			console.log(marked(agentOutput))
		}

		// Log raw output for debugging
		if (!output.trim().startsWith('{')) {
			console.error(`[${this.agentConfig.name}] Script stdout is not JSON:`)
			console.error(`Length: ${output.length}`)
			console.error(`First 500 chars: ${output.substring(0, 500)}`)
			throw new Error(`Script execution failed. Stdout was not JSON (length: ${output.length})`)
		}

		let result
		try {
			result = JSON.parse(output)
		} catch (parseError) {
			console.error(`[${this.agentConfig.name}] JSON parse error at position ${parseError.message.match(/position (\d+)/)?.[1] || '?'}`)
			console.error(`Output length: ${output.length}`)
			// Show context around the error position
			const pos = parseInt(parseError.message.match(/position (\d+)/)?.[1] || '0')
			if (pos > 0) {
				console.error(`Context around error: ...${output.substring(Math.max(0, pos - 100), pos + 100)}...`)
			}
			throw parseError
		}

		// Add model to result for cost tracking
		result.model = this.agentConfig.model

		// Store messages and token usage for FlowRunner
		if (result.messages) {
			this.messages = result.messages
		}
		if (result.tokenUsage) {
			this.totalTokenUsage = result.tokenUsage
		}

		// Traces are now written directly by the VM to /project/.flow/traces/
		// No need for host-side trace recording

		// Log file creations for user visibility
		await this._logFileCreations(result)

		return result
	} catch (error) {
		console.error(`[${this.agentConfig.name}] VM execution failed:`, error)
		throw error
	}
	}

	/**
	 * Build the execution script that will run inside the VM
	 */
	async _buildExecutionScript(userInput) {
		// Read the template file
		const __filename = fileURLToPath(import.meta.url)
		const __dirname = path.dirname(__filename)
		const templatePath = path.join(__dirname, 'vm-script-template.mjs')
		let script = await fs.readFile(templatePath, 'utf-8')

		// Replace placeholders with actual values
		script = script.replace('__AGENT_CONFIG__', JSON.stringify(this.agentConfig))
		script = script.replace('__USER_INPUT__', JSON.stringify(userInput))
		script = script.replace('__PRICING_OVERRIDES__', JSON.stringify(this.options.pricingOverrides || {}))
		script = script.replace('__FLOW_RUN_COUNT__', this.flowRunCount.toString())

		return script
	}

	/**
	 * Write script to container
	 */
	async _writeScriptToContainer(containerPath, scriptContent) {
		const fs = await import('fs/promises')
		const { exec: execAsync } = await import('child_process')
		const { promisify } = await import('util')
		const execPromise = promisify(execAsync)

		// Create a temp file on host
		const tempFile = `/tmp/agent-script-${Date.now()}.mjs`
		await fs.writeFile(tempFile, scriptContent)

		// Copy to container using docker cp
		const containerName = this.dockerManager.container.id
		await execPromise(`docker cp ${tempFile} ${containerName}:${containerPath}`)

		// Clean up temp file
		await fs.unlink(tempFile)
	}

	/**
	 * Get message history (for FlowRunner compatibility)
	 */
	getMessages() {
		return this.messages
	}

	/**
	 * Get token usage (for FlowRunner compatibility)
	 */
	getTokenUsage() {
		return this.totalTokenUsage
	}

	/**
	 * Log file creations from tool calls
	 */
	async _logFileCreations(result) {
		const chalk = (await import('chalk')).default
		const filesCreated = []

		if (result.turns) {
			for (const turn of result.turns) {
				if (turn.toolCalls) {
					for (const toolCall of turn.toolCalls) {
						if (toolCall.name === 'write_file' && toolCall.result) {
							// Extract path from arguments
							const filePath = toolCall.arguments?.path || toolCall.arguments?.file
							if (filePath) {
								filesCreated.push(filePath)
							}
						}
					}
				}
			}
		}

		// Log unique files
		const uniqueFiles = [...new Set(filesCreated)]
		if (uniqueFiles.length > 0) {
			for (const file of uniqueFiles) {
				console.log(chalk.gray(`[${this.agentConfig.name}] ✓ Created ${file}`))
			}
		}
	}
}
