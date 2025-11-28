/**
 * Model Pricing Data
 * Pricing in USD per 1M tokens (as of November 2024)
 * 
 * Sources:
 * - OpenAI: https://openai.com/pricing
 * - Anthropic: https://www.anthropic.com/pricing
 */

export const MODEL_PRICING = {
	// OpenAI GPT-4o family
	'gpt-4o': {
		input: 2.50,
		output: 10.00,
		context_window: 128000,
	},
	'gpt-4o-mini': {
		input: 0.15,
		output: 0.60,
		context_window: 128000,
	},
	'gpt-4o-2024-11-20': {
		input: 2.50,
		output: 10.00,
		context_window: 128000,
	},
	'gpt-4o-2024-08-06': {
		input: 2.50,
		output: 10.00,
		context_window: 128000,
	},

	// OpenAI GPT-4 Turbo
	'gpt-4-turbo': {
		input: 10.00,
		output: 30.00,
		context_window: 128000,
	},
	'gpt-4-turbo-2024-04-09': {
		input: 10.00,
		output: 30.00,
		context_window: 128000,
	},

	// OpenAI GPT-4
	'gpt-4': {
		input: 30.00,
		output: 60.00,
		context_window: 8192,
	},
	'gpt-4-0613': {
		input: 30.00,
		output: 60.00,
		context_window: 8192,
	},

	// OpenAI o1 family (reasoning models)
	'o1-preview': {
		input: 15.00,
		output: 60.00,
		context_window: 128000,
	},
	'o1-mini': {
		input: 3.00,
		output: 12.00,
		context_window: 128000,
	},

	// Anthropic Claude (future - estimated pricing)
	'claude-sonnet-4': {
		input: 3.00,
		output: 15.00,
		context_window: 200000,
	},
	'claude-3-5-sonnet': {
		input: 3.00,
		output: 15.00,
		context_window: 200000,
	},
	'claude-3-opus': {
		input: 15.00,
		output: 75.00,
		context_window: 200000,
	},
}

/**
 * Calculate cost for a completion
 * @param {string} model - Model name
 * @param {number} promptTokens - Input tokens
 * @param {number} completionTokens - Output tokens
 * @param {Object} overrides - Optional pricing overrides
 * @returns {Object} Cost breakdown
 */
export function getCost(model, promptTokens, completionTokens, overrides = {}) {
	// Check for override pricing first
	const pricing = overrides[model] || MODEL_PRICING[model]

	if (!pricing) {
		return {
			input_cost: 0,
			output_cost: 0,
			total_cost: 0,
			warning: `Unknown model: ${model}`,
		}
	}

	const inputCost = (promptTokens / 1_000_000) * pricing.input
	const outputCost = (completionTokens / 1_000_000) * pricing.output
	const totalCost = inputCost + outputCost

	return {
		input_cost: inputCost,
		output_cost: outputCost,
		total_cost: totalCost,
	}
}

/**
 * Get context window size for a model
 * @param {string} model - Model name
 * @param {Object} overrides - Optional pricing overrides
 * @returns {number} Context window size in tokens
 */
export function getContextWindow(model, overrides = {}) {
	const pricing = overrides[model] || MODEL_PRICING[model]
	return pricing?.context_window || 128000 // Default to 128K
}

/**
 * Calculate context window usage percentage
 * @param {number} tokens - Number of tokens used
 * @param {string} model - Model name
 * @param {Object} overrides - Optional pricing overrides
 * @returns {number} Percentage of context window used (0-100)
 */
export function getContextPercent(tokens, model, overrides = {}) {
	const contextWindow = getContextWindow(model, overrides)
	return (tokens / contextWindow) * 100
}

/**
 * Get list of all supported models
 * @returns {Array<string>} Model names
 */
export function getSupportedModels() {
	return Object.keys(MODEL_PRICING)
}

/**
 * Check if a model is supported
 * @param {string} model - Model name
 * @returns {boolean}
 */
export function isModelSupported(model) {
	return model in MODEL_PRICING
}

