import fs from 'fs/promises'
import { ProviderFactory } from '../ai-providers/provider-factory.mjs'
import { MCPClient } from './mcp-client.mjs'
import { TraceRecorder } from './trace-recorder.mjs'

/**
 * Agent Executor
 * Executes a single agent with turn loop and tool routing
 */
export class AgentExecutor {
	constructor(agentConfig, mcpClient, options = {}) {
		this.agentConfig = agentConfig
		this.mcpClient = mcpClient
		this.options = options
		this.provider = null
		this.messages = []
		this.turnCount = 0
		this.tools = []
		this.flowRunCount = options.flowRunCount || 1
		this.traceRecorder = new TraceRecorder(options.tracesDir || './traces')
		this.callbacks = options.callbacks || {}
	}

	/**
	 * Initialize the executor
	 */
	async initialize() {
		// Create AI provider
		this.provider = ProviderFactory.create(this.agentConfig.model)

		// Load system prompt
		const systemPrompt = await this._loadSystemPrompt()

		// Initialize messages with system prompt
		this.messages = [
			{
				role: 'system',
				content: systemPrompt,
			},
		]

		// Get available tools from MCP servers
		const allTools = await this.mcpClient.listTools()

		// Filter tools based on agent's mcp_tools config
		this.tools = this.mcpClient.filterTools(allTools, this.agentConfig.mcp_tools)

		console.log(
			`[${this.agentConfig.name}] Initialized with ${this.tools.length} available tools`
		)
	}

	/**
	 * Execute the agent with turn loop
	 */
	async execute(userInput) {
		await this.initialize()

		// Add user input as first message
		this.messages.push({
			role: 'user',
			content: userInput,
		})

		const results = {
			success: false,
			turns: [],
			finalMessage: null,
			error: null,
		}

		// Turn loop
		while (this.turnCount < this.agentConfig.max_turns) {
			try {
				const turnResult = await this._executeTurn()
				results.turns.push(turnResult)

				// Check if agent is done
				if (turnResult.finishReason === 'stop' || turnResult.finishReason === 'end_turn') {
					results.success = true
					results.finalMessage = turnResult.content
					break
				}

				// Check if agent wants to continue (tool calls)
				if (!turnResult.toolCalls || turnResult.toolCalls.length === 0) {
					results.success = true
					results.finalMessage = turnResult.content
					break
				}
			} catch (error) {
				results.error = error.message
				console.error(`[${this.agentConfig.name}] Error in turn ${this.turnCount}:`, error)
				break
			}
		}

		// Check if we hit max turns
		if (this.turnCount >= this.agentConfig.max_turns) {
			console.warn(
				`[${this.agentConfig.name}] Reached MAX_TURNS (${this.agentConfig.max_turns})`
			)
		}

		return results
	}

	/**
	 * Execute a single turn
	 */
	async _executeTurn() {
		this.turnCount++
		const startTime = new Date().toISOString()
		
		console.log(
			`[${this.agentConfig.name}] Turn ${this.turnCount}/${this.agentConfig.max_turns}`
		)

		// Notify callback
		if (this.callbacks.onTurnStart) {
			this.callbacks.onTurnStart(this.agentConfig.name, this.turnCount)
		}

		// Call AI provider
		const response = await this.provider.createCompletion(this.messages, this.tools)

		// Stream thinking to callback
		if (this.callbacks.onThinking && response.content) {
			this.callbacks.onThinking(response.content)
		}

		// Add assistant message to history
		this.messages.push({
			role: 'assistant',
			content: response.content || '',
			tool_calls: response.rawMessage.tool_calls,
		})

		const turnResult = {
			turn: this.turnCount,
			content: response.content,
			toolCalls: response.toolCalls,
			finishReason: response.finishReason,
			tokenUsage: response.usage,
		}

		// Execute tool calls if present
		if (response.toolCalls && response.toolCalls.length > 0) {
			const toolResults = await this._executeToolCalls(response.toolCalls)
			turnResult.toolResults = toolResults

			// Add tool results to message history
			for (let i = 0; i < response.toolCalls.length; i++) {
				const toolCall = response.toolCalls[i]
				const result = toolResults[i]

				this.messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify(result),
				})
			}
		}

		const endTime = new Date().toISOString()

		// Record trace
		await this._recordTrace(startTime, endTime, turnResult)

		// Notify callback
		if (this.callbacks.onTurnComplete) {
			this.callbacks.onTurnComplete(this.agentConfig.name, this.turnCount, turnResult)
		}

		return turnResult
	}

	/**
	 * Execute tool calls
	 */
	async _executeToolCalls(toolCalls) {
		const results = []

		for (const toolCall of toolCalls) {
			console.log(`[${this.agentConfig.name}] Calling tool: ${toolCall.name}`)

			// Notify callback
			if (this.callbacks.onToolCall) {
				this.callbacks.onToolCall(toolCall.name, toolCall.arguments)
			}

			try {
				const result = await this.mcpClient.callTool(toolCall.name, toolCall.arguments)
				results.push({
					tool: toolCall.name,
					success: true,
					result,
				})

				// Notify callback
				if (this.callbacks.onToolResult) {
					this.callbacks.onToolResult(toolCall.name, result, true)
				}
			} catch (error) {
				console.error(`[${this.agentConfig.name}] Tool error:`, error.message)
				results.push({
					tool: toolCall.name,
					success: false,
					error: error.message,
				})

				// Notify callback
				if (this.callbacks.onToolResult) {
					this.callbacks.onToolResult(toolCall.name, { error: error.message }, false)
				}
			}
		}

		return results
	}

	/**
	 * Record trace for this turn
	 */
	async _recordTrace(startTime, endTime, turnResult) {
		try {
			const traceData = {
				timestamp: startTime,
				startTime,
				endTime,
				model: this.agentConfig.model,
				maxTurns: this.agentConfig.max_turns,
				userInput: this.messages[1]?.content || null,
				systemPrompt: this.messages[0]?.content || null,
				response: turnResult.content,
				toolCalls: turnResult.toolCalls ? turnResult.toolCalls.map((tc, i) => ({
					name: tc.name,
					arguments: tc.arguments,
					result: turnResult.toolResults?.[i],
				})) : [],
				tokenUsage: turnResult.tokenUsage,
				finishReason: turnResult.finishReason,
			}

			await this.traceRecorder.recordTurn(
				this.agentConfig.name,
				this.flowRunCount,
				this.turnCount,
				traceData
			)
		} catch (error) {
			console.error(`[${this.agentConfig.name}] Failed to record trace:`, error.message)
		}
	}

	/**
	 * Load system prompt from file
	 */
	async _loadSystemPrompt() {
		try {
			const promptPath = this.agentConfig.prompt_file
			const content = await fs.readFile(promptPath, 'utf-8')

			// Replace variables
			let processed = content.replace(/{MAX_TURNS}/g, this.agentConfig.max_turns)

			return processed
		} catch (error) {
			console.warn(
				`[${this.agentConfig.name}] Failed to load prompt file: ${error.message}`
			)
			return `You are ${this.agentConfig.name}. ${this.agentConfig.goal}.`
		}
	}

	/**
	 * Get message history
	 */
	getMessages() {
		return this.messages
	}

	/**
	 * Get token usage
	 */
	getTokenUsage() {
		return this.provider ? this.provider.getTokenUsage() : null
	}
}

