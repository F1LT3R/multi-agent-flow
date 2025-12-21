/**
 * Base AI Provider Adapter Interface
 * Defines the contract for all AI provider implementations
 */
export class BaseAIAdapter {
	constructor(config) {
		this.config = config
		this.tokenUsage = {
			prompt: 0,
			completion: 0,
			total: 0,
		}
	}

	/**
	 * Create a chat completion with tool support
	 * @param {Array} messages - Chat messages
	 * @param {Array} tools - Available tools
	 * @param {Object} options - Provider-specific options
	 * @returns {Promise<Object>} Response with message and tool calls
	 * @property {string} content - Text content from the model
	 * @property {Array} images - Extracted images (if multimodal model)
	 * @property {Array} toolCalls - Tool calls made by the model
	 * @property {string} finishReason - Reason for completion
	 * @property {Object} usage - Token usage statistics
	 * @property {Object} rawMessage - Raw API response message
	 */
	async createCompletion(messages, tools, options = {}) {
		throw new Error('createCompletion must be implemented by subclass')
	}

	/**
	 * Get token usage statistics
	 */
	getTokenUsage() {
		return { ...this.tokenUsage }
	}

	/**
	 * Reset token usage statistics
	 */
	resetTokenUsage() {
		this.tokenUsage = {
			prompt: 0,
			completion: 0,
			total: 0,
		}
	}

	/**
	 * Update token usage
	 */
	_updateTokenUsage(promptTokens, completionTokens) {
		this.tokenUsage.prompt += promptTokens || 0
		this.tokenUsage.completion += completionTokens || 0
		this.tokenUsage.total += (promptTokens || 0) + (completionTokens || 0)
	}
}

