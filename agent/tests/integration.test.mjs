import { test } from 'node:test'
import assert from 'node:assert'
import { ConfigLoader } from '../core/config-loader.mjs'
import { ProviderFactory } from '../ai-providers/provider-factory.mjs'

test('ConfigLoader - loads default config', async (t) => {
	const loader = new ConfigLoader()
	const config = await loader.load()

	assert.ok(config, 'Config should be loaded')
	assert.ok(config.paths, 'Config should have paths')
	assert.ok(config.agents, 'Config should have agents')
	assert.ok(config.sequences, 'Config should have sequences')
	assert.strictEqual(config.agents.length, 7, 'Should have 7 default agents')
})

test('ConfigLoader - validates agent configuration', async (t) => {
	const loader = new ConfigLoader()
	await loader.load()

	for (const agent of loader.config.agents) {
		assert.ok(agent.name, 'Agent should have name')
		assert.ok(agent.model, 'Agent should have model')
		assert.ok(agent.max_turns > 0, 'Agent should have positive max_turns')
		assert.ok(agent.goal, 'Agent should have goal')
	}
})

test('ProviderFactory - creates OpenAI adapter', (t) => {
	// Set dummy API key
	const env = { OPENAI_API_KEY: 'sk-test-key' }

	const adapter = ProviderFactory.create('gpt-4o-mini', env)
	assert.ok(adapter, 'Should create adapter')
	assert.strictEqual(adapter.defaultModel, 'gpt-4o-mini', 'Should use correct model')
})

test('ProviderFactory - throws on missing API key', (t) => {
	const env = {}

	assert.throws(
		() => ProviderFactory.create('gpt-4o-mini', env),
		/OPENAI_API_KEY/,
		'Should throw on missing API key'
	)
})

test('ProviderFactory - throws on unsupported provider', (t) => {
	const env = { OPENAI_API_KEY: 'sk-test' }

	assert.throws(
		() => ProviderFactory.create('claude-sonnet-4-5', env),
		/not yet implemented/,
		'Should throw on unsupported provider'
	)
})
