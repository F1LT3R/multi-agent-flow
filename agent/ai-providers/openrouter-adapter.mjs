import OpenAI from 'openai'
import chalk from 'chalk'
import { BaseAIAdapter } from './base-adapter.mjs'

/**
 * OpenRouter Provider Adapter
 * Wraps OpenRouter API (OpenAI-compatible) for the Multi-Agent Flow system
 * OpenRouter provides access to 200+ models through a unified API
 */
export class OpenRouterAdapter extends BaseAIAdapter {
	constructor(apiKey, config = {}) {
		super(config)
		// OpenRouter uses OpenAI-compatible API at different base URL
		this.client = new OpenAI({
			apiKey,
			baseURL: 'https://openrouter.ai/api/v1',
			defaultHeaders: {
				'HTTP-Referer': config.referer || 'https://github.com/multi-agent-flow',
				'X-Title': config.title || 'Multi-Agent Flow System',
			},
		})
		this.defaultModel = config.model || 'mistralai/mistral-large'
		this.maxRetries = config.maxRetries || 3
	}

	/**
	 * Create a chat completion with tool support
	 * @param {Array} messages - Chat messages
	 * @param {Array} tools - Available tools
	 * @param {Object} options - Model settings from agent config
	 * @param {number} options.temperature - Randomness (0-2)
	 * @param {number} options.top_p - Nucleus sampling (0-1)
	 * @param {number} options.max_tokens - Max output tokens
	 * @param {string[]} options.stop - Stop sequences (max 4)
	 * @param {string[]} options.modalities - Output modalities (e.g., ["image", "text"])
	 * @param {Object} options.image_config - Image generation config (e.g., {aspect_ratio: "3:4"})
	 */
	async createCompletion(messages, tools = [], options = {}) {
		const model = options.model || this.defaultModel

		let attempt = 0
		let lastError = null

		while (attempt < this.maxRetries) {
			try {
				const requestParams = {
					model,
					messages,
				}

				// Only add parameters if explicitly set (avoid sending defaults)
				if (options.temperature !== undefined) {
					requestParams.temperature = options.temperature
				}
				if (options.top_p !== undefined) {
					requestParams.top_p = options.top_p
				}
				if (options.max_tokens !== undefined) {
					requestParams.max_tokens = options.max_tokens
				}
			if (options.stop !== undefined) {
				requestParams.stop = options.stop
			}
			if (options.modalities !== undefined) {
				requestParams.modalities = options.modalities
			}
			if (options.image_config !== undefined) {
				requestParams.image_config = options.image_config
			}

			// Debug: Log image generation parameters
			if (requestParams.modalities || requestParams.image_config) {
				console.error('[OpenRouter] Image generation enabled:', {
					modalities: requestParams.modalities,
					image_config: requestParams.image_config,
					model: model
				})
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

		// Extract multimodal content (text + images)
		// Check both message.content (array format) and message.images (OpenRouter image generation format)
		const { textContent, images } = this._extractMultimodalContent(message.content, message.images)

			// Debug: Log if images were received
			if (requestParams.modalities && images.length === 0) {
				console.error('[OpenRouter] WARNING: Image generation was requested but no images were returned')
				console.error('[OpenRouter] Response content type:', typeof message.content)
				console.error('[OpenRouter] Response has images field:', !!message.images)
			} else if (images.length > 0) {
				console.error('[OpenRouter] Successfully received ' + images.length + ' image(s)')
			}

			return {
				content: textContent,
				images: images,
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
					this._logApiError(attempt, this.maxRetries, error.status, error.message, delay)
					await new Promise((resolve) => setTimeout(resolve, delay))
				} else {
					// Non-retryable error
					throw error
				}
			}
		}

		throw new Error(
			`OpenRouter API failed after ${this.maxRetries} attempts: ${lastError.message}`
		)
	}

	/**
	 * Stream a chat completion (for future use)
	 */
	async *streamCompletion(messages, tools = [], options = {}) {
		const model = options.model || this.defaultModel

		const requestParams = {
			model,
			messages,
			stream: true,
		}

		// Only add parameters if explicitly set
		if (options.temperature !== undefined) {
			requestParams.temperature = options.temperature
		}
		if (options.top_p !== undefined) {
			requestParams.top_p = options.top_p
		}
		if (options.max_tokens !== undefined) {
			requestParams.max_tokens = options.max_tokens
		}
		if (options.stop !== undefined) {
			requestParams.stop = options.stop
		}
		if (options.modalities !== undefined) {
			requestParams.modalities = options.modalities
		}
		if (options.image_config !== undefined) {
			requestParams.image_config = options.image_config
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

	/**
	 * Extract text and images from multimodal content
	 * OpenRouter returns content as either string or array of content parts
	 * For image generation, images are in a separate 'images' field
	 * @param {string|Array} content - Message content from API
	 * @param {Array} generatedImages - Separate images array from message.images (for image generation)
	 * @returns {Object} {textContent: string, images: Array}
	 */
	_extractMultimodalContent(content, generatedImages = null) {
		let textContent = ''
		let images = []

		// Handle text content
		if (typeof content === 'string') {
			textContent = content
		} else if (Array.isArray(content)) {
			// Multimodal content - array of parts
			const textParts = []
			for (const part of content) {
				if (part.type === 'text') {
					textParts.push(part.text)
				} else if (part.type === 'image_url') {
					images.push({
						url: part.image_url.url,      // data:image/png;base64,... or https://...
						detail: part.image_url.detail  // Optional: 'low', 'high', 'auto'
					})
				}
			}
			textContent = textParts.join('\n')
		} else {
			textContent = String(content || '')
		}

		// Handle generated images (OpenRouter image generation format)
		// Images come in message.images array with format: [{type: 'image_url', image_url: {url: '...'}}]
		if (generatedImages && Array.isArray(generatedImages)) {
			for (const img of generatedImages) {
				if (img.type === 'image_url' && img.image_url?.url) {
					images.push({
						url: img.image_url.url,
						detail: img.image_url.detail
					})
				}
			}
		}

		return { textContent, images }
	}

	/**
	 * Display API error in a prominent red box
	 */
	_logApiError(attempt, maxRetries, status, message, delay) {
		const W = 60
		const line = (c) => `║  ${c.padEnd(W - 4)}  ║`

		const title =
			status === 429
				? 'API ERROR - Rate Limit (429)'
				: status === 500
					? 'API ERROR - Server Error (500)'
					: status === 503
						? 'API ERROR - Service Unavailable (503)'
						: `API ERROR (${status})`

		console.error(chalk.red(`\n╔${'═'.repeat(W)}╗`))
		console.error(chalk.red(line(title)))
		console.error(chalk.red(`╠${'═'.repeat(W)}╣`))
		console.error(chalk.red(line('')))
		// Truncate message to fit, show first meaningful part
		const shortMsg = message.length > W - 6 ? message.substring(0, W - 9) + '...' : message
		console.error(chalk.red(line(shortMsg)))
		console.error(chalk.red(line(`Retrying in ${delay}ms... (attempt ${attempt}/${maxRetries})`)))
		console.error(chalk.red(line('')))
		console.error(chalk.red(`╚${'═'.repeat(W)}╝\n`))
	}
}

