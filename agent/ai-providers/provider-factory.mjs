import { OpenAIAdapter } from './openai-adapter.mjs'
import { OpenRouterAdapter } from './openrouter-adapter.mjs'

/**
 * Factory for creating AI provider adapters
 */
export class ProviderFactory {
	/**
	 * Create an AI adapter based on model name
	 * @param {string} model - Model identifier (e.g., 'gpt-4o-mini', 'claude-sonnet-4-5')
	 * @param {Object} env - Environment variables
	 * @returns {BaseAIAdapter} AI adapter instance
	 */
	static create(model, env = process.env) {
		// Determine provider from model name
		if (model.startsWith('gpt-') || model.startsWith('o1-')) {
			// OpenAI models
			const apiKey = env.OPENAI_API_KEY
			if (!apiKey) {
				throw new Error('OPENAI_API_KEY environment variable is required for OpenAI models')
			}
			return new OpenAIAdapter(apiKey, { model })
		} else if (model.startsWith('openrouter/') || model.includes('/')) {
			// OpenRouter models - supports any model with provider/model-name format
			const apiKey = env.OPENROUTER_API_KEY
			if (!apiKey) {
				throw new Error('OPENROUTER_API_KEY environment variable is required for OpenRouter models')
			}
			return new OpenRouterAdapter(apiKey, { model })
		} else if (model.startsWith('claude-')) {
			// Anthropic models (future implementation)
			throw new Error('Anthropic provider not yet implemented. Coming soon!')
		} else if (model.startsWith('gemini-')) {
			// Google models (future implementation)
			throw new Error('Google Gemini provider not yet implemented. Coming soon!')
		} else if (model.startsWith('grok-')) {
			// xAI models (future implementation)
			throw new Error('xAI/Grok provider not yet implemented. Coming soon!')
		} else if (model.startsWith('deepseek-')) {
			// DeepSeek models - uses OpenAI-compatible API
			const apiKey = env.DEEPSEEK_API_KEY
			if (!apiKey) {
				throw new Error('DEEPSEEK_API_KEY environment variable is required for DeepSeek models')
			}
			return new OpenAIAdapter(apiKey, { model, baseUrl: 'https://api.deepseek.com/v1' })
		} else {
			throw new Error(`Unknown model: ${model}. Cannot determine provider.`)
		}
	}

	/**
	 * Get list of supported providers
	 */
	static getSupportedProviders() {
		return [
			{
				name: 'OpenAI',
				models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini'],
				envVar: 'OPENAI_API_KEY',
				supported: true,
			},
			{
				name: 'OpenRouter',
				models: [
					'mistralai/mistral-large',
					'moonshotai/kimi-k2',
					'google/gemini-3-pro-image-preview',
					'anthropic/claude-3.5-sonnet',
					'deepseek/deepseek-r1',
					'...200+ models',
				],
				envVar: 'OPENROUTER_API_KEY',
				supported: true,
			},
			{
				name: 'Anthropic',
				models: ['claude-sonnet-4-5', 'claude-3-5-sonnet', 'claude-3-opus'],
				envVar: 'ANTHROPIC_API_KEY',
				supported: false,
			},
			{
				name: 'Google',
				models: ['gemini-pro', 'gemini-pro-vision'],
				envVar: 'GOOGLE_AI_API_KEY',
				supported: false,
			},
			{
				name: 'xAI',
				models: ['grok-1', 'grok-2'],
				envVar: 'XAI_API_KEY',
				supported: false,
			},
			{
				name: 'DeepSeek',
				models: ['deepseek-chat', 'deepseek-coder'],
				envVar: 'DEEPSEEK_API_KEY',
				supported: true,
			},
		]
	}
}

