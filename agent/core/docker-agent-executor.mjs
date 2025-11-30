import path from 'path'
import { TraceRecorder } from './trace-recorder.mjs'

/**
 * Docker Agent Executor
 * Executes agents INSIDE the Docker VM for maximum isolation
 *
 * This executor builds and executes an agent script inside the Docker container,
 * ensuring that all AI provider calls and logic run in an isolated environment.
 */
export class DockerAgentExecutor {
	constructor(agentConfig, dockerManager, options = {}) {
		this.agentConfig = agentConfig
		this.dockerManager = dockerManager
		this.options = options
		this.flowRunCount = options.flowRunCount || 1
		this.traceRecorder = new TraceRecorder(options.tracesDir || './traces')
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
		const script = this._buildExecutionScript(userInput)

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

		const output = await this.dockerManager.execStreaming(
			`node ${scriptPath}`,
			{
			onStderr: (line) => {
				// Stream stderr to console in real-time with formatting
				if (line.startsWith('[Turn')) {
					console.log(chalk.cyan(`\n▶ ${line}`))
				} else if (line.startsWith('🔧')) {
					console.log(chalk.gray(line))
				} else if (line.startsWith('✓')) {
					console.log(chalk.gray(line))
				} else if (line.startsWith('✗')) {
					console.log(chalk.red(line))
				} else if (line.startsWith('📊')) {
					console.log(chalk.gray(line))
				} else if (line.startsWith('💰')) {
					console.log(chalk.yellow(line))
				} else if (line.startsWith('--- Test Output ---') || line === '---') {
					// Test output delimiters - show as-is
					console.log(chalk.gray(line))
				} else {
					// Agent thinking text - render as markdown
					try {
						const rendered = marked.parseInline(line)
						process.stdout.write(rendered + '\n')
					} catch (err) {
						// If markdown parsing fails, show plain text
						process.stdout.write(chalk.gray(line + '\n'))
					}
				}
			}
			}
		)

		// Log raw output for debugging
		if (!output.trim().startsWith('{')) {
			console.error(`[${this.agentConfig.name}] Script stdout is not JSON:`)
			console.error(`Length: ${output.length}`)
			console.error(`First 500 chars: ${output.substring(0, 500)}`)
			throw new Error(`Script execution failed. Stdout was not JSON (length: ${output.length})`)
		}

		const result = JSON.parse(output)

		// Add model to result for cost tracking
		result.model = this.agentConfig.model

		// Store messages and token usage for FlowRunner
		if (result.messages) {
			this.messages = result.messages
		}
		if (result.tokenUsage) {
			this.totalTokenUsage = result.tokenUsage
		}

		// Record traces from VM execution
		if (result.turns) {
			for (const turn of result.turns) {
				await this._recordTraceFromVMTurn(turn)
			}
		}

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
	_buildExecutionScript(userInput) {
		// Escape user input for JSON
		const escapedInput = JSON.stringify(userInput)
		const escapedAgentConfig = JSON.stringify(this.agentConfig)
		const escapedPricing = JSON.stringify(this.options.pricingOverrides || {})

		return `
import { ProviderFactory } from '/workspace/agent/ai-providers/provider-factory.mjs'
import { callTool, getToolDefinitions } from '/workspace/agent/vm-tools/index.mjs'
import { getCost, getContextWindow, getContextPercent } from '/workspace/agent/data/model-pricing.mjs'
import fs from 'fs/promises'
import { writeFileSync } from 'fs'

// Wrap everything in try-catch to ensure JSON output even on error
async function main() {
	try {
		// Configuration
		const agentConfig = ${escapedAgentConfig}
		const userInput = ${escapedInput}
		const pricingOverrides = ${escapedPricing}

		// Initialize AI provider
		const provider = ProviderFactory.create(agentConfig.model)

		// Load system prompt (convert host path to VM path)
		// Host path: /Users/user/project/.flow/prompts/AGENT.md
		// VM path: /project/.flow/prompts/AGENT.md
		let promptPath = agentConfig.prompt_file
		if (!promptPath.startsWith('/project/')) {
			// Extract relative path after '.flow/prompts/'
			const match = promptPath.match(/\\.flow\\/prompts\\/(.+)$/)
			if (match) {
				promptPath = '/project/.flow/prompts/' + match[1]
			} else {
				// Fallback for old prompts/ path format
				const oldMatch = promptPath.match(/prompts\\/(.+)$/)
				if (oldMatch) {
					promptPath = '/project/.flow/prompts/' + oldMatch[1]
				} else {
					// Last fallback: assume it's already a filename
					promptPath = '/project/.flow/prompts/' + promptPath
				}
			}
		}
		const systemPrompt = await fs.readFile(promptPath, 'utf-8')

		// Initialize messages
		const messages = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userInput },
		]

		// Get available tools (direct import - no HTTP!)
		// Note: Provider handles conversion to OpenAI format
		const tools = getToolDefinitions(agentConfig.mcp_tools)

		// Result accumulator
		const results = {
			success: false,
			turns: [],
			finalMessage: null,
			error: null,
			messages: [],
			tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
		}

		// Turn loop
		let turnCount = 0
		while (turnCount < agentConfig.max_turns) {
			turnCount++

			try {
				// Log turn start to stderr for real-time visibility
				console.error('[Turn ' + turnCount + '/' + agentConfig.max_turns + ']')

				// Call AI provider with settings from agent config
				const response = await provider.createCompletion(messages, tools, agentConfig.settings || {})

				// Accumulate token usage
				if (response.usage) {
					results.tokenUsage.prompt_tokens += response.usage.prompt_tokens || 0
					results.tokenUsage.completion_tokens += response.usage.completion_tokens || 0
					results.tokenUsage.total_tokens += response.usage.total_tokens || 0
				}

				// Log agent thinking to stderr for real-time visibility
				if (response.content && response.content.trim()) {
					console.error(response.content)
				}

				// Add assistant message
				messages.push({
					role: 'assistant',
					content: response.content || '',
					tool_calls: response.rawMessage.tool_calls,
				})

				const turnResult = {
					turn: turnCount,
					timestamp: Date.now(),
					model: agentConfig.model,
					maxTurns: agentConfig.max_turns,
					content: response.content,
					toolCalls: response.toolCalls,
					finishReason: response.finishReason,
					tokenUsage: response.usage,
					toolResults: [],
				}

				// Execute tool calls if present
				if (response.toolCalls && response.toolCalls.length > 0) {
					for (let i = 0; i < response.toolCalls.length; i++) {
						const toolCall = response.toolCalls[i]
						try {
							// Log tool call start to stderr
							console.error('\\n🔧 ' + toolCall.name + '(...)')

						// Call tool directly (no HTTP - runs in VM!)
						const result = await callTool(toolCall.name, toolCall.arguments)

						// Log tool success to stderr
						console.error('✓ ' + toolCall.name + ' completed')

						// For test execution, log the output
						if (toolCall.name === 'run_node_tests' && result.stdout) {
							console.error('\\n--- Test Output ---')
							console.error(result.stdout)
							if (result.stderr) {
								console.error(result.stderr)
							}
							console.error('---\\n')
						}

							turnResult.toolResults.push({
								tool: toolCall.name,
								success: true,
								result,
							})

							// IMPORTANT: Add tool result to the toolCall itself for traces
							if (turnResult.toolCalls[i]) {
								turnResult.toolCalls[i].result = result
							}

							// Add tool result to messages
							messages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify(result),
							})
						} catch (error) {
							// Log tool failure to stderr
							console.error('✗ ' + toolCall.name + ' failed: ' + error.message)

							turnResult.toolResults.push({
								tool: toolCall.name,
								success: false,
								error: error.message,
							})

							// IMPORTANT: Add tool error to the toolCall itself for traces
							if (turnResult.toolCalls[i]) {
								turnResult.toolCalls[i].result = { error: error.message }
							}

							// CRITICAL: Still add tool message even on error
							// OpenAI requires a response for every tool_call_id
							messages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify({ error: error.message }),
							})
						}
					}
				}

			results.turns.push(turnResult)

			// Log token usage and cost to stderr after each turn
			if (response.usage && response.usage.total_tokens) {
				const promptTokens = response.usage.prompt_tokens || 0
				const completionTokens = response.usage.completion_tokens || 0
				const totalTokens = response.usage.total_tokens

				// Calculate cost
				const costData = getCost(agentConfig.model, promptTokens, completionTokens, pricingOverrides)
				const contextPct = getContextPercent(promptTokens, agentConfig.model, pricingOverrides)

				// Store cost in turn result
				turnResult.cost = costData.total_cost
				turnResult.contextPercent = contextPct

				// Log to stderr for real-time display
				console.error('📊 Tokens: ' + totalTokens + ' (' + promptTokens + '→' + completionTokens + ')')
				console.error('💰 Cost: $' + costData.total_cost.toFixed(4) + ' | Context: ' + contextPct.toFixed(1) + '%\\n')
			}

			// Check if done
				if (response.finishReason === 'stop' || response.finishReason === 'end_turn') {
					results.success = true
					results.finalMessage = response.content
					break
				}

				if (!response.toolCalls || response.toolCalls.length === 0) {
					results.success = true
					results.finalMessage = response.content
					break
				}
			} catch (error) {
				results.error = error.message
				break
			}
		}

		// Store final messages for FlowRunner
		results.messages = messages

		// Output result as JSON to stdout
		const jsonOutput = JSON.stringify(results)
		writeFileSync(1, jsonOutput + '\\n')
	} catch (error) {
		// If any error occurs during script execution, output error as JSON
		const errorOutput = JSON.stringify({
			success: false,
			error: error.message,
			stack: error.stack,
			turns: [],
			finalMessage: null,
			messages: [],
			tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
		})
		writeFileSync(1, errorOutput + '\\n')
	}
}

// Run main and ensure it completes
main().catch(error => {
	console.error('Fatal error:', error)
	process.exit(1)
})
`
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
	 * Record trace from VM turn data
	 */
	async _recordTraceFromVMTurn(turnData) {
		await this.traceRecorder.recordTurn(
			this.agentConfig.name,
			this.flowRunCount,
			turnData.turn,
			turnData
		)
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

