import OpenAI from 'openai'
import { BaseAIAdapter } from './base-adapter.mjs'

/**
 * OpenAI Provider Adapter
 * Wraps OpenAI SDK for the Multi-Agent Flow system
 */
export class OpenAIAdapter extends BaseAIAdapter {
	constructor(apiKey, config = {}) {
		super(config)
		this.client = new OpenAI({ apiKey })
		this.defaultModel = config.model || 'gpt-4o-mini'
		this.maxRetries = config.maxRetries || 3
	}

	/**
	 * Create a chat completion with tool support
	 */
	async createCompletion(messages, tools = [], options = {}) {
		const model = options.model || this.defaultModel
		const temperature = options.temperature ?? 0.7
		const maxTokens = options.maxTokens

		let attempt = 0
		let lastError = null

		while (attempt < this.maxRetries) {
			try {
				const requestParams = {
					model,
					messages,
					temperature,
				}

				if (maxTokens) {
					requestParams.max_tokens = maxTokens
				}

				// Add tools if provided
				if (tools && tools.length > 0) {
					requestParams.tools = tools.map((tool) => ({
						type: 'function',
						function: {
							name: tool.name,
							description: tool.description,
							parameters: tool.inputSchema,
						},
					}))
					requestParams.tool_choice = 'auto'
				}

				const response = await this.client.chat.completions.create(requestParams)

				// Update token usage
				if (response.usage) {
					this._updateTokenUsage(
						response.usage.prompt_tokens,
						response.usage.completion_tokens
					)
				}

				const message = response.choices[0].message

				// Parse tool calls if present
				const toolCalls = message.tool_calls
					? message.tool_calls.map((tc) => ({
							id: tc.id,
							name: tc.function.name,
							arguments: JSON.parse(tc.function.arguments),
					  }))
					: []

				return {
					content: message.content,
					toolCalls,
					finishReason: response.choices[0].finish_reason,
					usage: response.usage,
					rawMessage: message,
				}
			} catch (error) {
				lastError = error
				attempt++

				// Check if it's a retryable error
				if (
					error.status === 429 || // Rate limit
					error.status === 500 || // Server error
					error.status === 503 // Service unavailable
				) {
					// Exponential backoff
					const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
					console.error(
						`OpenAI API error (attempt ${attempt}/${this.maxRetries}): ${error.message}. Retrying in ${delay}ms...`
					)
					await new Promise((resolve) => setTimeout(resolve, delay))
				} else {
					// Non-retryable error
					throw error
				}
			}
		}

		throw new Error(
			`OpenAI API failed after ${this.maxRetries} attempts: ${lastError.message}`
		)
	}

	/**
	 * Stream a chat completion (for future use)
	 */
	async *streamCompletion(messages, tools = [], options = {}) {
		const model = options.model || this.defaultModel
		const temperature = options.temperature ?? 0.7

		const requestParams = {
			model,
			messages,
			temperature,
			stream: true,
		}

		if (tools && tools.length > 0) {
			requestParams.tools = tools.map((tool) => ({
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.inputSchema,
				},
			}))
		}

		const stream = await this.client.chat.completions.create(requestParams)

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta) {
				yield {
					content: delta.content || '',
					toolCalls: delta.tool_calls || [],
					finishReason: chunk.choices[0]?.finish_reason,
				}
			}
		}
	}
}

