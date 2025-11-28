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
	constructor(agentConfig, dockerManager, mcpServerPorts, options = {}) {
		this.agentConfig = agentConfig
		this.dockerManager = dockerManager
		this.mcpServerPorts = mcpServerPorts
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

	// Execute script in container
	try {
		const output = await this.dockerManager.exec(`node ${scriptPath} 2>&1`)

		// Log raw output for debugging
		if (!output.trim().startsWith('{')) {
			console.error(`[${this.agentConfig.name}] Script output is not JSON:`)
			console.error(output.substring(0, 500)) // First 500 chars
			throw new Error(`Script execution failed. Output: ${output.substring(0, 200)}`)
		}

		const result = JSON.parse(output)

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
		const escapedMCPPorts = JSON.stringify(this.mcpServerPorts)

		return `
import { ProviderFactory } from '/workspace/agent/ai-providers/provider-factory.mjs'
import { MCPClient } from '/workspace/agent/core/mcp-client.mjs'
import fs from 'fs/promises'

// Wrap everything in try-catch to ensure JSON output even on error
async function main() {
	try {
		// Configuration
		const agentConfig = ${escapedAgentConfig}
		const userInput = ${escapedInput}
		const mcpServerPorts = ${escapedMCPPorts}

		// Initialize
		const provider = ProviderFactory.create(agentConfig.model)
		const mcpClient = new MCPClient({
			file_ops: mcpServerPorts.fileOps,
			run_tests: mcpServerPorts.testRunner,
			analysis: mcpServerPorts.analysis,
			internet: mcpServerPorts.internet,
		}, {
			host: process.env.MCP_HOST || 'http://host.docker.internal'
		})

		// Load system prompt (convert host path to VM path)
		// Host path: /Users/user/project/prompts/AGENT.md
		// VM path: /project/prompts/AGENT.md
		let promptPath = agentConfig.prompt_file
		if (!promptPath.startsWith('/project/')) {
			// Extract relative path after 'prompts/'
			const match = promptPath.match(/prompts\\/(.+)$/)
			if (match) {
				promptPath = '/project/prompts/' + match[1]
			} else {
				// Fallback: assume it's already a filename
				promptPath = '/project/prompts/' + promptPath
			}
		}
		const systemPrompt = await fs.readFile(promptPath, 'utf-8')

		// Initialize messages
		const messages = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userInput },
		]

		// Get available tools
		const allTools = await mcpClient.listTools()
		const tools = mcpClient.filterTools(allTools, agentConfig.mcp_tools)

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
				// Call AI provider
				const response = await provider.createCompletion(messages, tools)

				// Accumulate token usage
				if (response.usage) {
					results.tokenUsage.prompt_tokens += response.usage.prompt_tokens || 0
					results.tokenUsage.completion_tokens += response.usage.completion_tokens || 0
					results.tokenUsage.total_tokens += response.usage.total_tokens || 0
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
							const result = await mcpClient.callTool(toolCall.name, toolCall.arguments)
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

	// Output result as JSON
	console.log(JSON.stringify(results))
	} catch (error) {
		// If any error occurs during script execution, output error as JSON
		console.log(JSON.stringify({
			success: false,
			error: error.message,
			stack: error.stack,
			turns: [],
			finalMessage: null,
			messages: [],
			tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
		}))
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

